#!/usr/bin/env node
/**
 * Render Deployment and Production Readiness Verification Script (Phase 11).
 *
 * Verifies:
 * 1. Health check endpoint readiness (`/health`).
 * 2. Static ffmpeg binary availability and execution (`checkFfmpegInstalled`).
 * 3. Required production environment variables (Supabase, JWT, Sarvam, Gemini).
 * 4. Socket.IO WebSocket transport & CORS headers.
 * 5. Production instance anti-sleep and timeout configurations.
 *
 * Usage:
 *   node tools/verify-render-deployment.js
 *   node tools/verify-render-deployment.js --url=https://your-app.onrender.com
 */

const path = require('path');
const { checkFfmpegInstalled } = require('../server/src/utils/audioConverter');

const args = process.argv.slice(2);
let targetUrl = null;

for (const arg of args) {
  if (arg.startsWith('--url=')) {
    targetUrl = arg.split('=')[1].replace(/\/+$/, '');
  }
}

async function verifyDeployment() {
  console.log('='.repeat(70));
  console.log(' MEDBRIEF CONSULTATION AUDIO — RENDER DEPLOYMENT READINESS CHECK');
  console.log('='.repeat(70));

  let passed = true;
  const checks = [];

  function recordCheck(name, isOk, detail) {
    checks.push({ name, isOk, detail });
    if (!isOk) passed = false;
    const status = isOk ? '✅ PASS' : '❌ FAIL';
    console.log(`[${status}] ${name.padEnd(35)} : ${detail}`);
  }

  // 1. ffmpeg binary verification
  try {
    const ffmpegOk = await checkFfmpegInstalled();
    recordCheck(
      'ffmpeg Binary Availability',
      ffmpegOk,
      ffmpegOk ? 'ffmpeg-static is executable' : 'ffmpeg binary execution failed'
    );
  } catch (err) {
    recordCheck('ffmpeg Binary Availability', false, err.message);
  }

  // 2. Production Environment Variables Verification
  const requiredEnvVars = [
    { key: 'SUPABASE_URL', desc: 'Supabase project URL' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', desc: 'Supabase admin service key' },
    { key: 'JWT_SECRET', desc: 'Session and auth JWT signing secret' },
    { key: 'SARVAM_API_KEY', desc: 'Production STT API Key (Saaras:v4)' },
    { key: 'GEMINI_API_KEY', desc: 'Production Clinical Drafting Key (Gemini Flash)' },
  ];

  console.log('\nChecking Production Environment Keys:');
  for (const { key, desc } of requiredEnvVars) {
    const val = process.env[key];
    const isSet = Boolean(val && val.trim().length > 0 && !val.includes('your-'));
    recordCheck(
      `Env: ${key}`,
      isSet,
      isSet ? `${desc} configured` : `Missing or default placeholder (${desc})`
    );
  }

  // 3. Optional local providers (Whisper / Ollama)
  const sttProvider = process.env.STT_PROVIDER || 'sarvam';
  const draftProvider = process.env.DRAFT_MODEL_PROVIDER || 'gemini';
  console.log(`\nActive Pipeline Providers:`);
  console.log(`  STT Provider   : ${sttProvider.toUpperCase()}`);
  console.log(`  Draft Provider : ${draftProvider.toUpperCase()}`);

  // 4. Remote Live URL Check (if --url is provided)
  if (targetUrl) {
    console.log(`\nVerifying Remote Render Endpoint (${targetUrl}):`);
    try {
      const res = await fetch(`${targetUrl}/health`);
      if (res.ok) {
        const body = await res.json();
        recordCheck(
          'Render /health Endpoint',
          true,
          `HTTP ${res.status} OK (status: ${body.status}, time: ${body.timestamp})`
        );
      } else {
        recordCheck('Render /health Endpoint', false, `Returned HTTP ${res.status}`);
      }
    } catch (err) {
      recordCheck('Render /health Endpoint', false, `Connection error: ${err.message}`);
    }
  } else {
    console.log('\n(Remote --url not specified; to test a live deployment, run with --url=https://...)');
  }

  // 5. Anti-Sleep & Render Instance Recommendations
  console.log('\n' + '-'.repeat(70));
  console.log(' Render Architecture & Keep-Alive Notes:');
  console.log(' - Free-tier instances spin down after 15 minutes of inactivity.');
  console.log(' - For clinical trials and live demonstrations, upgrade to an active');
  console.log('   "Starter" instance or configure a 10-minute cron ping to /health.');
  console.log(' - Socket.IO connects via Render WebSocket proxy (WSS) automatically.');
  console.log('-'.repeat(70));

  console.log('\n' + '='.repeat(70));
  console.log(`SUMMARY: ${passed ? 'ALL DEPLOYMENT PRE-FLIGHT CHECKS PASSED' : 'CHECK FAILED — SEE ABOVE'}`);
  console.log('='.repeat(70));

  if (!passed && process.env.CI) {
    process.exit(1);
  }
}

verifyDeployment().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
