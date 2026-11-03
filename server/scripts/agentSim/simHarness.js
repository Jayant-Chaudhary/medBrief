const { ClinicSimulator } = require('./clinicState');
const assistant = require('../../src/services/assistant/assistant.service');
const { getProvider } = require('../../src/services/assistant/llm/providerFactory');
const config = require('../../src/config/assistant.config');

/**
 * Runs a natural language prompt through the multi-round agent loop against the simulated clinic.
 */
async function runAgentSim(prompt, {
  initialPage = 'visit',
  initialPatient = 'Asha Example',
  maxRounds = 8,
  provider = getProvider(),
  settings = config,
} = {}) {
  const sim = new ClinicSimulator({ initialPage, initialPatient });
  let round = 0;
  let checklist = [];
  let note = '';
  let results = [];
  let lastReply = null;

  while (round < maxRounds) {
    const page = sim.getSnapshot();
    const reply = await assistant.handleStep({
      message: prompt,
      role: 'clinician',
      userId: 'dr-test',
      currentPath: `/clinician/${sim.currentPage}`,
      page,
      round,
      checklist,
      note,
      results,
      provider,
      directory: async () => sim.patients,
      settings: { ...settings, agentLoop: true },
    });

    lastReply = reply;
    checklist = reply.checklist || checklist;
    note = reply.note || note;

    if (reply.type === 'unsupported' || reply.type === 'answer') {
      break;
    }

    if (reply.type === 'done') {
      break;
    }

    const actionsToRun = [];
    if (reply.type === 'navigate') {
      let pageId = reply.path.replace('/clinician/', '').replace('/clinician', 'dashboard');
      if (pageId === 'appointments/new') pageId = 'new_appointment';
      actionsToRun.push({ op: 'go', pageId });
    } else if (reply.steps && reply.steps.length > 0) {
      for (const s of reply.steps) {
        if (s.page?.actions) {
          actionsToRun.push(...s.page.actions);
        } else if (s.path) {
          let pageId = s.path.replace('/clinician/', '').replace('/clinician', 'dashboard');
          if (pageId === 'appointments/new') pageId = 'new_appointment';
          actionsToRun.push({ op: 'go', pageId });
        }
      }
    }

    // Apply actions to the simulator
    results = actionsToRun.map((act) => sim.applyAction(act));

    if (!reply.continue) {
      break;
    }

    round += 1;
  }

  return {
    sim,
    lastReply,
    rounds: round + 1,
    done: lastReply?.type === 'done' || (lastReply?.type === 'run' && !lastReply?.continue),
    unsupported: lastReply?.type === 'unsupported',
  };
}

module.exports = { runAgentSim };
