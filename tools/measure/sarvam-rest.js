#!/usr/bin/env node
/**
 * Sarvam REST Speech-to-Text Benchmark Tool
 *
 * Measures latency and rate limits for Sarvam STT REST API:
 * 1. 5 sequential requests with a 20s audio clip
 * 2. 3 concurrent requests in parallel
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
const SARVAM_URL = 'https://api.sarvam.ai/speech-to-text';

function printHelp() {
  console.log(`
Usage: node tools/measure/sarvam-rest.js [options]

Options:
  --help             Show this help message
  --dry-run          Simulate requests without contacting the API or requiring keys
  --key=<key>        Sarvam API subscription key (defaults to SARVAM_API_KEY in .env)
  --file=<path>      Path to 20-second audio file (defaults to fixtures/sample-20s.wav)
  --model=<model>    Model identifier (default: saaras:v4)
  --language=<lang>  Language code (default: auto-detect)
  --mode=<mode>      Output mode (default: transcribe)

Example:
  node tools/measure/sarvam-rest.js --dry-run
  node tools/measure/sarvam-rest.js --key=your_key --file=./path/to/clip.wav
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
    mode: 'transcribe',
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--key=')) options.key = arg.split('=')[1];
    else if (arg.startsWith('--file=')) options.file = path.resolve(arg.split('=')[1]);
    else if (arg.startsWith('--model=')) options.model = arg.split('=')[1];
    else if (arg.startsWith('--language=')) options.language = arg.split('=')[1];
    else if (arg.startsWith('--mode=')) options.mode = arg.split('=')[1];
  }
  return options;
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function simulateRequest(runIndex) {
  // Simulate network latency between 1100ms and 2200ms
  const simLatency = Math.floor(1100 + Math.random() * 1100);
  await new Promise((r) => setTimeout(r, simLatency));
  return {
    run: runIndex,
    latencyMs: simLatency,
    status: 200,
    rateLimitRemaining: '99',
    rateLimitLimit: '100',
    transcriptLength: 42,
  };
}

async function executeRealRequest(runIndex, options) {
  const audioBuffer = fs.readFileSync(options.file);
  const blob = new Blob([audioBuffer], { type: 'audio/wav' });
  const formData = new FormData();
  formData.append('file', blob, path.basename(options.file));
  formData.append('model', options.model);
  formData.append('mode', options.mode);
  if (options.language) {
    formData.append('language_code', options.language);
  }

  const start = Date.now();
  const res = await fetch(SARVAM_URL, {
    method: 'POST',
    headers: {
      'api-subscription-key': options.key,
    },
    body: formData,
  });
  const latencyMs = Date.now() - start;

  const rateLimitRemaining = res.headers.get('x-ratelimit-remaining') || res.headers.get('ratelimit-remaining') || 'N/A';
  const rateLimitLimit = res.headers.get('x-ratelimit-limit') || res.headers.get('ratelimit-limit') || 'N/A';

  let transcriptLength = 0;
  if (res.ok) {
    const data = await res.json();
    transcriptLength = (data.transcript || '').length;
  } else {
    const errText = await res.text();
    console.error(`Run ${runIndex} failed (${res.status}): ${errText}`);
  }

  return {
    run: runIndex,
    latencyMs,
    status: res.status,
    rateLimitRemaining,
    rateLimitLimit,
    transcriptLength,
  };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('='.repeat(70));
  console.log('SARVAM REST SPEECH-TO-TEXT BENCHMARK');
  console.log('='.repeat(70));
  console.log(`Mode:           ${options.dryRun ? 'DRY-RUN (Simulated)' : 'LIVE API'}`);
  console.log(`Audio File:     ${options.file}`);
  console.log(`Model:          ${options.model}`);
  console.log(`Output Mode:    ${options.mode}`);
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

  const requestFn = options.dryRun ? simulateRequest : (idx) => executeRealRequest(idx, options);

  // 1. Sequential Benchmark (5 runs)
  console.log('\n[1/2] Running 5 Sequential Requests...');
  const seqResults = [];
  for (let i = 1; i <= 5; i++) {
    process.stdout.write(`  Run ${i}/5 ... `);
    const result = await requestFn(i);
    seqResults.push(result);
    console.log(`${result.latencyMs} ms (HTTP ${result.status}, Remaining: ${result.rateLimitRemaining})`);
  }

  const seqLatencies = seqResults.map((r) => r.latencyMs);
  const minSeq = Math.min(...seqLatencies);
  const maxSeq = Math.max(...seqLatencies);
  const p50Seq = percentile(seqLatencies, 50);
  const p95Seq = percentile(seqLatencies, 95);

  console.log('\nSequential Summary:');
  console.log(`  Min:  ${minSeq} ms`);
  console.log(`  Max:  ${maxSeq} ms`);
  console.log(`  p50:  ${p50Seq} ms`);
  console.log(`  p95:  ${p95Seq} ms`);

  // 2. Concurrent Benchmark (3 parallel requests)
  console.log('\n[2/2] Running 3 Concurrent Requests in Parallel...');
  const concStart = Date.now();
  const concPromises = [requestFn('C1'), requestFn('C2'), requestFn('C3')];
  const concResults = await Promise.all(concPromises);
  const concTotalMs = Date.now() - concStart;

  concResults.forEach((r) => {
    console.log(`  Worker ${r.run}: ${r.latencyMs} ms (HTTP ${r.status}, Remaining: ${r.rateLimitRemaining})`);
  });
  console.log(`Total Parallel Elapsed Time: ${concTotalMs} ms`);

  console.log('\n' + '='.repeat(70));
  console.log('RECOMMENDATION & SUMMARY');
  console.log('='.repeat(70));
  console.log(`Single Chunk p50 Latency:  ${p50Seq} ms (Target: < 3000 ms)`);
  console.log(`Single Chunk p95 Latency:  ${p95Seq} ms`);
  console.log(`3-Worker Concurrency Time: ${concTotalMs} ms`);
  const fitsBudget = p50Seq < 3000 ? 'YES - Optimal for 15-25s streaming chunks' : 'CAUTION - Latency high';
  console.log(`Fits Pipeline Time Budget: ${fitsBudget}`);
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('Fatal error during benchmark:', err);
  process.exit(1);
});
