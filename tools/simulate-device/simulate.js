#!/usr/bin/env node
/**
 * Consultation Device Simulator CLI
 *
 * Emulates the doctor or patient device:
 * 1. Reads a source WAV audio recording
 * 2. Cuts the audio into chunks (respecting CHUNK_MIN_SEC and CHUNK_HARD_CAP_SEC)
 * 3. Uploads each chunk to POST /api/consults/:id/chunks with metadata headers
 * 4. Simulates network jitter, configurable latency, and random drop/retry
 * 5. Sends POST /api/consults/:id/devices/:device/final marker
 *
 * Supports --dry-run, --help, and --both (dual-device parallel simulation)
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_AUDIO = path.resolve(__dirname, 'fixtures/sample-consult-5min.wav');
const BACKOFF_MS = [500, 1000, 2000, 4000];

function printHelp() {
  console.log(`
Usage: node tools/simulate-device/simulate.js [options]

Options:
  --help             Show this help message
  --dry-run          Simulate slicing and upload flow without sending network requests
  --file=<path>      Path to source WAV file (default: fixtures/sample-consult-5min.wav)
  --device=<name>    Device identifier: 'doctor' or 'patient' (default: doctor)
  --both             Simulate both doctor and patient devices simultaneously
  --session=<id>     Consultation session UUID
  --token=<jwt>      Scoped session token for the device
  --doctor-token=<>  Scoped session token for doctor (when using --both)
  --patient-token=<> Scoped session token for patient (when using --both)
  --url=<baseUrl>    Server base URL (default: http://localhost:4000)
  --chunk-min=<sec>  Minimum chunk length in seconds (default: 15)
  --chunk-max=<sec>  Hard cap chunk length in seconds (default: 25)
  --delay-ms=<ms>    Artificial upload latency in ms (default: 100)
  --loss-rate=<0..1> Simulated upload packet drop rate for testing retry (default: 0.0)

Examples:
  node tools/simulate-device/simulate.js --dry-run
  node tools/simulate-device/simulate.js --dry-run --both
  node tools/simulate-device/simulate.js --session=UUID --token=JWT --device=doctor
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    help: false,
    dryRun: false,
    both: false,
    file: DEFAULT_AUDIO,
    device: 'doctor',
    sessionId: 'sess-sim-100',
    token: null,
    doctorToken: null,
    patientToken: null,
    url: 'http://localhost:4000',
    chunkMinSec: 15,
    chunkHardCapSec: 25,
    delayMs: 100,
    lossRate: 0.0,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--both') options.both = true;
    else if (arg.startsWith('--file=')) options.file = path.resolve(arg.split('=')[1]);
    else if (arg.startsWith('--device=')) options.device = arg.split('=')[1];
    else if (arg.startsWith('--session=')) options.sessionId = arg.split('=')[1];
    else if (arg.startsWith('--token=')) options.token = arg.split('=')[1];
    else if (arg.startsWith('--doctor-token=')) options.doctorToken = arg.split('=')[1];
    else if (arg.startsWith('--patient-token=')) options.patientToken = arg.split('=')[1];
    else if (arg.startsWith('--url=')) options.url = arg.split('=')[1].replace(/\/+$/, '');
    else if (arg.startsWith('--chunk-min=')) options.chunkMinSec = parseInt(arg.split('=')[1], 10) || 15;
    else if (arg.startsWith('--chunk-max=')) options.chunkHardCapSec = parseInt(arg.split('=')[1], 10) || 25;
    else if (arg.startsWith('--delay-ms=')) options.delayMs = parseInt(arg.split('=')[1], 10) || 100;
    else if (arg.startsWith('--loss-rate=')) options.lossRate = parseFloat(arg.split('=')[1]) || 0.0;
  }
  return options;
}

/**
 * Calculates average dBFS of 16-bit PCM buffer.
 */
function calculateDbfs(buffer) {
  let sumSquare = 0;
  const numSamples = Math.floor(buffer.length / 2);
  if (numSamples === 0) return -90;

  for (let i = 0; i < numSamples; i++) {
    const sample = buffer.readInt16LE(i * 2);
    sumSquare += sample * sample;
  }

  const rms = Math.sqrt(sumSquare / numSamples);
  if (rms <= 0) return -90;
  return Number((20 * Math.log10(rms / 32768)).toFixed(2));
}

/**
 * Wraps raw PCM data into a valid 16kHz 16-bit mono WAV container.
 */
function wrapPcmWithWavHeader(pcmBuffer, sampleRate = 16000) {
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Parses WAV file and slices PCM data into chunks.
 */
function sliceAudioIntoChunks(wavFilePath, chunkMinSec, chunkHardCapSec) {
  const fileBuffer = fs.readFileSync(wavFilePath);

  // Skip 44-byte WAV header
  const pcmData = fileBuffer.slice(44);
  const sampleRate = 16000;
  const bytesPerSec = sampleRate * 2; // 16-bit mono = 2 bytes/sec

  const chunks = [];
  let offset = 0;
  let seq = 0;
  let currentStartMs = 0;

  const minBytes = chunkMinSec * bytesPerSec;
  const maxBytes = chunkHardCapSec * bytesPerSec;

  while (offset < pcmData.length) {
    const remaining = pcmData.length - offset;
    // Aim for 20s chunk (between min and max)
    const targetLength = Math.min(maxBytes, Math.max(minBytes, Math.min(20 * bytesPerSec, remaining)));
    const chunkBytes = pcmData.slice(offset, offset + targetLength);
    const durationMs = Math.round((chunkBytes.length / bytesPerSec) * 1000);
    const avgDbfs = calculateDbfs(chunkBytes);

    const wavContainer = wrapPcmWithWavHeader(chunkBytes, sampleRate);

    chunks.push({
      seq,
      startMs: currentStartMs,
      durationMs,
      avgDbfs,
      audioBuffer: wavContainer,
      isSilent: avgDbfs < -50,
    });

    offset += targetLength;
    currentStartMs += durationMs;
    seq++;
  }

  return chunks;
}

/**
 * Simulates uploading chunks for a single device.
 */
async function runDeviceSimulation(device, options, tokenOverride = null) {
  const token = tokenOverride || options.token || `mock-token-${device}`;
  const chunks = sliceAudioIntoChunks(options.file, options.chunkMinSec, options.chunkHardCapSec);

  console.log(`\n[${device.toUpperCase()}] Sliced audio into ${chunks.length} chunks:`);
  console.log(`  Source: ${options.file}`);
  console.log(`  Total Audio Duration: ~${(chunks.reduce((acc, c) => acc + c.durationMs, 0) / 1000).toFixed(1)} s`);

  let uploadedCount = 0;
  let retryCount = 0;

  for (const chunk of chunks) {
    const chunkDesc = `seq=${chunk.seq} (${chunk.durationMs}ms, ${chunk.avgDbfs} dBFS)`;

    if (options.dryRun) {
      // Simulate artificial delay
      await new Promise((r) => setTimeout(r, options.delayMs));
      uploadedCount++;
      process.stdout.write(`  [${device}] Uploaded ${chunkDesc} -> OK (simulated)\n`);
      continue;
    }

    // Live HTTP Upload with Retry
    let attempt = 0;
    let uploaded = false;

    while (!uploaded && attempt < 4) {
      attempt++;
      try {
        // Simulate random loss if configured
        if (options.lossRate > 0 && Math.random() < options.lossRate) {
          throw new Error('Simulated network packet drop');
        }

        const res = await fetch(`${options.url}/api/consults/${options.sessionId}/chunks`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-device': device,
            'x-seq': String(chunk.seq),
            'x-start-ms': String(chunk.startMs),
            'x-duration-ms': String(chunk.durationMs),
            'x-avg-dbfs': String(chunk.avgDbfs),
            'x-codec': 'audio/wav',
            'Content-Type': 'audio/wav',
          },
          body: chunk.audioBuffer,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Server returned HTTP ${res.status}: ${errText}`);
        }

        const body = await res.json();
        uploaded = true;
        uploadedCount++;
        process.stdout.write(`  [${device}] Uploaded ${chunkDesc} -> HTTP 200 (state: ${body.sessionState})\n`);
      } catch (err) {
        retryCount++;
        const wait = BACKOFF_MS[attempt - 1] || 1000;
        console.warn(`  [${device}] Upload failed for seq=${chunk.seq} (attempt ${attempt}): ${err.message}. Retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    if (!uploaded) {
      throw new Error(`[${device}] Failed to upload chunk seq=${chunk.seq} after ${attempt} attempts`);
    }

    if (options.delayMs > 0) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
  }

  // Send Final Marker
  console.log(`\n[${device.toUpperCase()}] Sending Final Marker (total_chunks: ${chunks.length})...`);
  if (options.dryRun) {
    console.log(`  [${device}] Final marker sent -> OK (simulated)`);
  } else {
    const res = await fetch(`${options.url}/api/consults/${options.sessionId}/devices/${device}/final`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ total_chunks: chunks.length }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to send final marker (${res.status}): ${errText}`);
    }

    const data = await res.json();
    console.log(`  [${device}] Final marker acknowledged by server: expectedChunks=${data.expectedChunks}`);
  }

  return {
    device,
    totalChunks: chunks.length,
    uploadedCount,
    retryCount,
  };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('='.repeat(70));
  console.log('CONSULTATION DEVICE SIMULATOR');
  console.log('='.repeat(70));
  console.log(`Mode:        ${options.dryRun ? 'DRY-RUN (Simulated)' : 'LIVE HTTP'}`);
  console.log(`Target:      ${options.both ? 'BOTH (Doctor + Patient parallel)' : options.device.toUpperCase()}`);
  console.log(`Session ID:  ${options.sessionId}`);
  console.log(`Audio File:  ${options.file}`);
  console.log('='.repeat(70));

  if (!fs.existsSync(options.file)) {
    console.error(`Error: Source audio file not found at ${options.file}`);
    process.exit(1);
  }

  const startTime = Date.now();

  let results = [];
  if (options.both) {
    // Run both devices in parallel
    results = await Promise.all([
      runDeviceSimulation('doctor', options, options.doctorToken),
      runDeviceSimulation('patient', options, options.patientToken),
    ]);
  } else {
    const res = await runDeviceSimulation(options.device, options);
    results = [res];
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('SIMULATION SUMMARY');
  console.log('='.repeat(70));
  console.log(`Elapsed Time: ${elapsedSec} s`);

  results.forEach((r) => {
    console.log(`  Device [${r.device}]:`);
    console.log(`    Total Chunks Sliced: ${r.totalChunks}`);
    console.log(`    Chunks Uploaded:     ${r.uploadedCount}`);
    console.log(`    Retries Triggered:   ${r.retryCount}`);
    console.log(`    Status:              ${r.totalChunks === r.uploadedCount ? 'PASSED (100% matched)' : 'MISMATCH'}`);
  });

  const allMatched = results.every((r) => r.totalChunks === r.uploadedCount);
  console.log(`\nOverall Ingest Match: ${allMatched ? 'SUCCESS' : 'FAILED'}`);
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('Fatal error during device simulation:', err.message);
  process.exit(1);
});
