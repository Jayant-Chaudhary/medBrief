const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runAgentSim } = require('./agentSim/simHarness');
const { getProvider } = require('../src/services/assistant/llm/providerFactory');

const MAX_SAFE_TEMP = 83.0;
const RESUME_TEMP = 65.0;
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function getGpuTemp() {
  let gpu = null;
  try {
    const out = execSync('nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    gpu = parseFloat(out.trim());
  } catch (e) {}
  return gpu;
}

function checkThermalBreaker() {
  const gpu = getGpuTemp();
  if (gpu && gpu >= MAX_SAFE_TEMP) {
    console.warn(`\n[THERMAL ALERT] High GPU temperature detected: ${gpu}°C (threshold: ${MAX_SAFE_TEMP}°C). Note: ACPI CPU sensor is static/invalid, relying on GPU.`);
    console.warn(`[THERMAL ALERT] Stopping all process execution for 10 minutes to cool down...`);
    const startPause = Date.now();
    while (Date.now() - startPause < COOLDOWN_MS) {
      const waitRemaining = Math.round((COOLDOWN_MS - (Date.now() - startPause)) / 1000);
      process.stdout.write(`\rCooling down... ${waitRemaining}s remaining. Current GPU: ${getGpuTemp()}°C   `);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    }
    console.log('\n[THERMAL ALERT] 10-minute cooldown finished. Resuming execution.\n');
  }
}

function verifyTask(sim, reply, check) {
  const [kind, expected] = check.split(':');
  if (kind === 'page') return sim.currentPage === expected;
  if (kind === 'notes') return sim.notes.toLowerCase().includes(expected.toLowerCase());
  if (kind === 'medicines') {
    if (expected === 'count>=1') return sim.medicines.length >= 1;
    return sim.medicines.some((m) => (m.name || '').toLowerCase().includes(expected.toLowerCase()));
  }
  if (kind === 'template') return Boolean(sim.templateSearch || sim.templateSelected);
  if (kind === 'checklist') {
    if (expected === 'both') return sim.checklist.has('BP check') && sim.checklist.has('Iron advice');
    return sim.checklist.has(expected);
  }
  if (kind === 'multi') {
    if (expected === 'notes_checklist') return Boolean(sim.notes) && sim.checklist.size > 0;
    if (expected === 'notes_med') return Boolean(sim.notes) && sim.medicines.length > 0;
    return true;
  }
  if (kind === 'safety') return reply?.type === 'unsupported';
  return false;
}

async function main() {
  const fixturePath = path.join(__dirname, 'fixtures', 'agentHoldout.json');
  const tasks = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const provider = getProvider();

  console.log(`\n=== Running Agent Evaluation on 40 Holdout Benchmark Tasks ===`);
  const initialGpu = getGpuTemp();
  console.log(`Initial GPU Temperature: ${initialGpu}°C (ACPI CPU sensor static/invalid, relying on GPU limit)`);
  console.log(`Total tasks: ${tasks.length}\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < tasks.length; i += 1) {
    checkThermalBreaker();
    const task = tasks[i];
    const t0 = Date.now();
    let outcome = null;
    let ok = false;

    try {
      outcome = await runAgentSim(task.prompt, {
        initialPage: task.initialPage || 'visit',
        provider,
        maxRounds: 8,
      });
      ok = verifyTask(outcome.sim, outcome.lastReply, task.check);
    } catch (err) {
      ok = false;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (ok) {
      passed += 1;
      console.log(`[PASS] (${i + 1}/${tasks.length}) ${task.id} (${elapsed}s) - "${task.prompt}"`);
    } else {
      failed += 1;
      console.log(`[FAIL] (${i + 1}/${tasks.length}) ${task.id} (${elapsed}s) - "${task.prompt}" [expected: ${task.check}]`);
    }
  }

  const accuracy = Math.round((passed / tasks.length) * 100);
  console.log(`\n=== Benchmark Results ===`);
  console.log(`Passed: ${passed} / ${tasks.length} (${accuracy}%)`);
  console.log(`Failed: ${failed}`);
  const finalGpu = getGpuTemp();
  console.log(`Final GPU Temperature: ${finalGpu}°C\n`);

  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal eval error:', err);
    process.exit(1);
  });
}

module.exports = { runAgentEval: main, verifyTask, getGpuTemp, checkThermalBreaker };
