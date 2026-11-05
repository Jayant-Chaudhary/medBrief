#!/usr/bin/env node
/**
 * Sarvam Batch Speech-to-Text Benchmark Tool
 *
 * Times a synthetic 10-minute consultation through the Sarvam Batch STT API:
 * 1. Job initialization (with_diarization=true, num_speakers=2)
 * 2. Audio upload
 * 3. Processing start
 * 4. Status polling until completion
 * 5. Result download and diarization validation
 *
 * Supports --dry-run and --help
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../server/.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const DEFAULT_AUDIO = path.resolve(__dirname, 'fixtures/sample-20s.wav');
const SARVAM_BATCH_BASE = 'https://api.sarvam.ai/speech-to-text/job/v1';

function printHelp() {
  console.log(`
Usage: node tools/measure/sarvam-batch.js [options]

Options:
  --help             Show this help message
  --dry-run          Simulate the full batch cycle without contacting the API or requiring keys
  --key=<key>        Sarvam API subscription key (defaults to SARVAM_API_KEY in .env)
  --file=<path>      Path to audio file (defaults to fixtures/sample-20s.wav or synthetic file)
  --model=<model>    Model identifier (default: saaras:v4)
  --language=<lang>  Language code (default: auto-detect)
  --speakers=<num>   Number of distinct speakers for diarization (default: 2)
  --poll-interval=<s> Polling interval in seconds (default: 5)

Example:
  node tools/measure/sarvam-batch.js --dry-run
  node tools/measure/sarvam-batch.js --key=your_key --file=./path/to/consultation.wav
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    help: false,
    dryRun: false,
    key: process.env.SARVAM_API_KEY,
    file: DEFAULT_AUDIO,
    model: 'saaras:v4',
    language: null,
    speakers: 2,
    pollIntervalSec: 5,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--key=')) options.key = arg.split('=')[1];
    else if (arg.startsWith('--file=')) options.file = path.resolve(arg.split('=')[1]);
    else if (arg.startsWith('--model=')) options.model = arg.split('=')[1];
    else if (arg.startsWith('--language=')) options.language = arg.split('=')[1];
    else if (arg.startsWith('--speakers=')) options.speakers = parseInt(arg.split('=')[1], 10) || 2;
    else if (arg.startsWith('--poll-interval=')) options.pollIntervalSec = parseInt(arg.split('=')[1], 10) || 5;
  }
  return options;
}

async function runDryRun(options) {
  console.log('\n[1/5] Initializing Batch STT Job (Diarization: enabled, Speakers: 2)...');
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 250));
  const jobId = 'mock-job-' + Math.random().toString(36).substring(2, 10);
  console.log(`  Job created successfully: ${jobId} (${Date.now() - t0} ms)`);

  console.log('\n[2/5] Uploading Audio File to Sarvam Storage...');
  const t1 = Date.now();
  await new Promise((r) => setTimeout(r, 1200));
  console.log(`  Upload complete: 10-minute synthetic audio stream (${Date.now() - t1} ms)`);

  console.log('\n[3/5] Starting Batch Job Execution...');
  const t2 = Date.now();
  await new Promise((r) => setTimeout(r, 300));
  console.log(`  Job transitioned to RUNNING (${Date.now() - t2} ms)`);

  console.log(`\n[4/5] Polling Job Status (Simulating execution)...`);
  const tPollStart = Date.now();
  const stages = ['queued', 'processing', 'completed'];
  for (let i = 0; i < stages.length; i++) {
    await new Promise((r) => setTimeout(r, 800));
    const stage = stages[i];
    const elapsed = ((Date.now() - tPollStart) / 1000).toFixed(1);
    console.log(`  Status check at ${elapsed}s: status=${stage}`);
  }
  const pollDuration = Date.now() - tPollStart;

  console.log('\n[5/5] Downloading Diarized Output...');
  const tDownload = Date.now();
  await new Promise((r) => setTimeout(r, 400));

  const mockSegments = [
    { speaker: 'speaker_1', start_ms: 0, end_ms: 4500, text: 'Good morning, please have a seat. How have you been feeling since last week?' },
    { speaker: 'speaker_2', start_ms: 4800, end_ms: 9200, text: 'Good morning doctor. I have had mild swelling in my ankles in the evening.' },
    { speaker: 'speaker_1', start_ms: 9500, end_ms: 14000, text: 'Let us check your blood pressure and look at your latest lab report.' },
  ];

  const totalTimeMs = Date.now() - t0;

  return {
    jobId,
    totalTimeMs,
    pollDurationMs: pollDuration,
    segments: mockSegments,
  };
}

async function runRealBatch(options) {
  const headers = {
    'api-subscription-key': options.key,
    'Content-Type': 'application/json',
  };

  const t0 = Date.now();

  // 1. Create Job
  console.log('\n[1/5] Initiating Batch Job...');
  const createPayload = {
    model: options.model,
    with_diarization: true,
    num_speakers: options.speakers,
    mode: 'transcribe',
  };
  if (options.language) createPayload.language_code = options.language;

  const initRes = await fetch(SARVAM_BATCH_BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(createPayload),
  });

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Failed to create batch job (${initRes.status}): ${err}`);
  }
  const initData = await initRes.json();
  const jobId = initData.job_id || initData.id;
  console.log(`  Created Job ID: ${jobId}`);

  // 2. Upload Audio File
  console.log('\n[2/5] Uploading Audio File...');
  const tUploadStart = Date.now();
  const audioData = fs.readFileSync(options.file);
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([audioData], { type: 'audio/wav' }), path.basename(options.file));

  const uploadRes = await fetch(`${SARVAM_BATCH_BASE}/${jobId}/upload`, {
    method: 'POST',
    headers: { 'api-subscription-key': options.key },
    body: uploadForm,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Upload failed (${uploadRes.status}): ${err}`);
  }
  console.log(`  Upload finished in ${Date.now() - tUploadStart} ms`);

  // 3. Start Job
  console.log('\n[3/5] Starting Batch Job...');
  const startRes = await fetch(`${SARVAM_BATCH_BASE}/${jobId}/start`, {
    method: 'POST',
    headers,
  });
  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Start failed (${startRes.status}): ${err}`);
  }

  // 4. Poll Status
  console.log('\n[4/5] Polling status...');
  const tPollStart = Date.now();
  let status = 'pending';
  let attempts = 0;
  while (status !== 'completed' && status !== 'failed' && attempts < 120) {
    attempts++;
    await new Promise((r) => setTimeout(r, options.pollIntervalSec * 1000));
    const statusRes = await fetch(`${SARVAM_BATCH_BASE}/${jobId}`, { headers });
    if (!statusRes.ok) continue;
    const statusData = await statusRes.json();
    status = statusData.status?.toLowerCase() || 'running';
    console.log(`  Status check (${attempts * options.pollIntervalSec}s): ${status}`);
    if (status === 'completed') break;
    if (status === 'failed') throw new Error(`Batch job marked failed: ${JSON.stringify(statusData)}`);
  }

  // 5. Download Results
  console.log('\n[5/5] Downloading Output...');
  const downloadRes = await fetch(`${SARVAM_BATCH_BASE}/${jobId}/download`, { headers });
  if (!downloadRes.ok) {
    const err = await downloadRes.text();
    throw new Error(`Download failed (${downloadRes.status}): ${err}`);
  }
  const resultData = await downloadRes.json();
  const totalTimeMs = Date.now() - t0;

  return {
    jobId,
    totalTimeMs,
    pollDurationMs: Date.now() - tPollStart,
    segments: resultData.segments || resultData.output || [],
  };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('='.repeat(70));
  console.log('SARVAM BATCH SPEECH-TO-TEXT BENCHMARK (DIARIZATION)');
  console.log('='.repeat(70));
  console.log(`Mode:            ${options.dryRun ? 'DRY-RUN (Simulated)' : 'LIVE API'}`);
  console.log(`Audio File:      ${options.file}`);
  console.log(`Model:           ${options.model}`);
  console.log(`Diarization:     enabled (${options.speakers} speakers)`);
  console.log('='.repeat(70));

  if (!options.dryRun) {
    if (!options.key) {
      console.error('Error: No Sarvam API key provided. Set SARVAM_API_KEY or use --key=<key> or run with --dry-run.');
      process.exit(1);
    }
    if (!fs.existsSync(options.file)) {
      console.error(`Error: Audio file not found at ${options.file}`);
      process.exit(1);
    }
  }

  const result = options.dryRun ? await runDryRun(options) : await runRealBatch(options);

  console.log('\n' + '='.repeat(70));
  console.log('BATCH BENCHMARK RESULTS');
  console.log('='.repeat(70));
  console.log(`Job ID:                   ${result.jobId}`);
  console.log(`Total End-to-End Latency: ${(result.totalTimeMs / 1000).toFixed(1)} s`);
  console.log(`Processing Wait Time:     ${(result.pollDurationMs / 1000).toFixed(1)} s`);
  console.log(`Total Diarized Segments:  ${result.segments.length}`);

  const speakersFound = new Set(result.segments.map((s) => s.speaker || s.speaker_id));
  console.log(`Distinct Speakers Found:  ${Array.from(speakersFound).join(', ')}`);

  console.log('\nSample Diarized Dialogue:');
  result.segments.slice(0, 3).forEach((s) => {
    console.log(`  [${s.speaker || s.speaker_id}] (${s.start_ms || 0}ms - ${s.end_ms || 0}ms): "${s.text}"`);
  });

  console.log('\nPipeline Evaluation:');
  if (result.totalTimeMs < 60000) {
    console.log('  -> Batch turnaround is fast (< 60s); viable for both fallback and cross-check.');
  } else {
    console.log('  -> Batch turnaround exceeds 60s; best utilized as an asynchronous cross-check');
    console.log('     and one-device fallback, while per-chunk streaming STT powers the immediate 1-2 min draft.');
  }
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('Fatal error during batch benchmark:', err.message);
  process.exit(1);
});
