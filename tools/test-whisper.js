#!/usr/bin/env node
/**
 * Test CLI for Local Whisper Speech-to-Text Pipeline.
 *
 * Usage:
 *   node tools/test-whisper.js
 *   node tools/test-whisper.js <path-to-audio-file>
 *   node tools/test-whisper.js --file=path/to/audio.wav --lang=hi
 */

const fs = require('fs');
const path = require('path');
const LocalProvider = require('../server/src/services/consultAudio/stt/localProvider');
const { convertTo16kHzMonoWav, checkFfmpegInstalled } = require('../server/src/utils/audioConverter');

const DEFAULT_AUDIO = path.resolve(__dirname, 'measure/fixtures/sample-speech.wav');
const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://localhost:8001';

// Parse command line arguments
const args = process.argv.slice(2);
let audioPath = DEFAULT_AUDIO;
let language = null;

for (const arg of args) {
  if (arg.startsWith('--file=')) {
    audioPath = path.resolve(arg.split('=')[1]);
  } else if (arg.startsWith('--lang=')) {
    language = arg.split('=')[1];
  } else if (!arg.startsWith('--')) {
    audioPath = path.resolve(arg);
  }
}

async function run() {
  console.log('============================================================');
  console.log(' MEDBRIEF LOCAL WHISPER STT TESTER');
  console.log('============================================================');
  console.log(`Service URL : ${WHISPER_SERVICE_URL}`);
  console.log(`Input Audio : ${audioPath}`);
  if (language) console.log(`Language    : ${language}`);
  console.log('------------------------------------------------------------');

  if (!fs.existsSync(audioPath)) {
    console.error(`Error: Audio file not found at: ${audioPath}`);
    process.exit(1);
  }

  // 1. Check Whisper microservice health
  try {
    const healthRes = await fetch(`${WHISPER_SERVICE_URL}/health`);
    if (!healthRes.ok) {
      throw new Error(`HTTP ${healthRes.status}`);
    }
    const health = await healthRes.json();
    console.log(`Status      : ONLINE (${health.device.toUpperCase()} - ${health.model})`);
    console.log(`CUDA Device : ${health.cuda_available ? 'Detected (GPU Accelerated)' : 'CPU Mode'}`);
  } catch (err) {
    console.error(`\n❌ Error: Cannot connect to Whisper service at ${WHISPER_SERVICE_URL}`);
    console.error('Make sure the whisper microservice is running:');
    console.error('  bash whisper-service/run.sh\n');
    process.exit(1);
  }

  // 2. Load audio bytes
  console.log('\nLoading and preparing audio...');
  const rawBytes = fs.readFileSync(audioPath);
  console.log(`Raw audio size: ${(rawBytes.length / 1024).toFixed(1)} KB`);

  // 3. Convert to 16 kHz mono WAV via ffmpeg
  const startConvert = Date.now();
  const wavBuffer = await convertTo16kHzMonoWav(rawBytes);
  console.log(`Converted to 16 kHz mono WAV in ${Date.now() - startConvert} ms (${(wavBuffer.length / 1024).toFixed(1)} KB)`);

  // 4. Send to LocalProvider STT
  console.log('\nTranscribing via LocalProvider...');
  const provider = new LocalProvider(WHISPER_SERVICE_URL);

  const startStt = Date.now();
  const segments = await provider.transcribe(wavBuffer, {
    languageCode: language,
    vadFilter: true,
  });
  const sttLatencyMs = Date.now() - startStt;

  console.log('------------------------------------------------------------');
  console.log(`Transcription completed in ${sttLatencyMs} ms`);
  console.log(`Total segments recognized: ${segments.length}`);
  console.log('============================================================\n');

  if (segments.length === 0) {
    console.log('(No speech detected in audio)');
  } else {
    segments.forEach((seg, index) => {
      const formatTime = (ms) => {
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const s = (totalSec % 60).toString().padStart(2, '0');
        const msFrac = (ms % 1000).toString().padStart(3, '0');
        return `${m}:${s}.${msFrac}`;
      };

      console.log(`[${formatTime(seg.start_ms)} -> ${formatTime(seg.end_ms)}] (lang: ${seg.language || 'auto'})`);
      console.log(`  "${seg.text}"\n`);
    });
  }

  console.log('============================================================');
}

run().catch((err) => {
  console.error('\n❌ Transcription failed:', err.message);
  process.exit(1);
});
