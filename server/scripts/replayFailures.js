const fs = require('fs');
const path = require('path');
const { runAgentSim } = require('./agentSim/simHarness');
const { getProvider } = require('../src/services/assistant/llm/providerFactory');
const { verifyTask, checkThermalBreaker, getGpuTemp } = require('./runAgentEval');

// Prompt check mappings from agentFuzz.js
const PROMPT_CHECKS = {
  'open schedule and then view patients': 'page:patients',
  'go to dashboard and open schedule': 'page:schedule',
  'dashboard par jao aur schedule open karo': 'page:schedule',
  'mark BP check as done': 'checklist:BP check',
  'mark BP check': 'checklist:BP check',
  'tick BP check': 'checklist:BP check',
  'add to consultation notes: no signs of pallor': 'notes:no signs of pallor',
  'write advised anomaly scan at 20 weeks in notes': 'notes:advised anomaly scan at 20 weeks',
  'add   paracetmol  500 mg': 'medicines:paracetmol',
  'write resting pulse 78 in notes and check iron advice': 'multi:notes_checklist',
  'open notes, write follow up in 1 week, tick BP check, and check iron advice': 'multi:notes_checklist',
  'open notes, write mild fever for 2 days, and tick BP check': 'multi:notes_checklist',
  'add calcium tablet 500 mg and write review in 1 month in notes': 'multi:notes_med',
  'iron advice tick karo aur notes me likho hari sabji khaye': 'multi:notes_checklist',
  'give ranitidine 150 mg twice daily': 'medicines:ranitidine',
  'tick iron advice, write diet counseling in notes, and add calcium tablet 500 mg': 'multi:notes_checklist',
  'consultation notes me likho patient ko mild fever hai 2 din se aur BP check tick karo': 'multi:notes_checklist',
  'write headache in notes, add paracetamol 500 mg, and tick iron advice': 'multi:notes_med',
};

async function replayFailures() {
  const logPath = path.join(__dirname, '..', '..', 'docs', 'assistant', 'OVERNIGHT_LOG.md');
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n').filter((l) => l.includes('| FAIL |'));

  console.log(`\n=== Replaying Last Night's ${lines.length} Failures ===`);
  const initialGpu = getGpuTemp();
  console.log(`Initial GPU Temp: ${initialGpu}°C (relying on GPU limit; ACPI CPU sensor invalid)`);

  const provider = getProvider();
  let passed = 0;
  let failed = 0;
  const results = [];

  for (let i = 0; i < lines.length; i += 1) {
    checkThermalBreaker();
    const parts = lines[i].split('|').map((s) => s.trim());
    const promptRaw = parts[3];
    const prompt = promptRaw.replace(/^"|"$/g, '').replace(/\\"/g, '"');
    const check = PROMPT_CHECKS[prompt] || 'notes:' + prompt;

    const t0 = Date.now();
    let ok = false;
    let simOutcome = null;

    try {
      simOutcome = await runAgentSim(prompt, {
        initialPage: 'visit',
        provider,
        maxRounds: 15,
      });
      ok = verifyTask(simOutcome.sim, simOutcome.lastReply, check);
    } catch (err) {
      ok = false;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (ok) passed += 1;
    else failed += 1;

    const statusTag = ok ? 'PASS' : 'FAIL';
    console.log(`[${statusTag}] (${i + 1}/${lines.length}) (${elapsed}s) - "${prompt}"`);
    results.push({ prompt, status: statusTag, elapsed });
  }

  const finalGpu = getGpuTemp();
  console.log(`\n=== Replay Summary ===`);
  console.log(`Total Replayed: ${lines.length}`);
  console.log(`Passed Now: ${passed} / ${lines.length} (${Math.round((passed / lines.length) * 100)}%)`);
  console.log(`Failed Remaining: ${failed}`);
  console.log(`Final GPU Temp: ${finalGpu}°C\n`);

  return { total: lines.length, passed, failed, results };
}

if (require.main === module) {
  replayFailures().catch(console.error);
}

module.exports = { replayFailures };

