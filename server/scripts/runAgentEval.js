const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runAgentSim } = require('./agentSim/simHarness');
const { getProvider } = require('../src/services/assistant/llm/providerFactory');

const MAX_SAFE_TEMP = 78.0;
const RESUME_TEMP = 65.0;
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function getTemps() {
  let gpu = null;
  try {
    const out = execSync('nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    gpu = parseFloat(out.trim());
  } catch (e) {}

  let cpu = null;
  try {
    const out = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation).Temperature"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const val = parseFloat(out.trim().split(/\r?\n/)[0]);
    if (!isNaN(val) && val > 200) {
      cpu = Math.round((val - 273.15) * 10) / 10;
    }
  } catch (e) {}

  return { gpu, cpu };
}

function checkThermalBreaker() {
  const { gpu, cpu } = getTemps();
  const maxTemp = Math.max(gpu || 0, cpu || 0);

  if (maxTemp >= MAX_SAFE_TEMP) {
    console.warn(`\n[THERMAL ALERT] High temperature detected: GPU ${gpu}°C, CPU ${cpu}°C (threshold: ${MAX_SAFE_TEMP}°C).`);
    console.warn(`[THERMAL ALERT] Stopping all process execution for 10 minutes to cool down...`);
    const startPause = Date.now();
    while (Date.now() - startPause < COOLDOWN_MS) {
      const waitRemaining = Math.round((COOLDOWN_MS - (Date.now() - startPause)) / 1000);
      process.stdout.write(`\rCooling down... ${waitRemaining}s remaining. Current temps: GPU ${getTemps().gpu}°C, CPU ${getTemps().cpu}°C   `);
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
  const initialTemps = getTemps();
  console.log(`Initial Temperatures: GPU: ${initialTemps.gpu}°C | CPU: ${initialTemps.cpu}°C`);
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
  const finalTemps = getTemps();
  console.log(`Final Temperatures: GPU: ${finalTemps.gpu}°C | CPU: ${finalTemps.cpu}°C\n`);

  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal eval error:', err);
    process.exit(1);
  });
}

module.exports = { runAgentEval: main, verifyTask, getTemps, checkThermalBreaker };
