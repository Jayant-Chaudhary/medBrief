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
  notesOpen = null,
  originRecord = undefined,
  confirmCancel = false,
  memory = [],
  sim: existingSim = null,
  maxRounds = config.maxRounds || 15,
  provider = getProvider(),
  settings = config,
} = {}) {
  const sim = existingSim || new ClinicSimulator({ initialPage, initialPatient, notesOpen, originRecord, confirmCancel });
  let round = 0;
  let checklist = [];
  let note = '';
  let results = [];
  let written = [];
  let continuationToken = null;
  let mode = undefined;
  let lastReply = null;
  const replies = [];
  const actionsExecuted = [];

  const recordLookup = async (id, userId) => {
    for (const p of sim.patients) {
      if (p.lastVisit?.appointmentId === id || p.nextVisit?.appointmentId === id) {
        return { id, patient_id: p.id, clinician_id: userId };
      }
    }
    if (id === 'v-101') return { id: 'v-101', patient_id: 'p-asha', clinician_id: userId };
    return null;
  };

  while (round < maxRounds) {
    const page = sim.getSnapshot();
    const reply = await assistant.handleStep({
      message: prompt,
      role: 'clinician',
      userId: 'dr-test',
      currentPath: sim.getCurrentPath(),
      currentRecord: sim.currentRecord,
      originRecord: sim.originRecord,
      page,
      round,
      mode,
      continuationToken,
      checklist,
      note,
      results,
      written,
      memory,
      provider,
      directory: async () => sim.patients,
      recordLookup,
      settings: { ...settings, agentLoop: true, actionsEnabled: true },
    });

    replies.push(reply);
    lastReply = reply;
    checklist = reply.checklist || checklist;
    note = reply.note || note;
    continuationToken = reply.continuationToken || continuationToken;
    mode = reply.mode || mode;

    if (reply.type === 'unsupported' || reply.type === 'answer' || reply.type === 'choose' || reply.type === 'clarify') {
      break;
    }

    if (reply.type === 'done') {
      break;
    }

    const actionsToRun = [];
    if (reply.type === 'navigate') {
      actionsToRun.push({
        actionId: reply.actionId,
        op: reply.op || 'go',
        path: reply.path,
        pageId: reply.pageId,
        recordTarget: reply.recordTarget,
      });
    } else if (reply.steps && reply.steps.length > 0) {
      for (const s of reply.steps) {
        if (s.path || s.recordTarget) {
          actionsToRun.push({
            actionId: s.actionId,
            op: s.op || (s.recordTarget ? 'return_record' : 'go'),
            path: s.path,
            pageId: s.pageId,
            recordTarget: s.recordTarget,
            kind: s.kind,
            patientId: s.patientId,
            recordId: s.recordId,
          });
        }
        if (s.fill && s.fill.fields) {
          for (const [ctrl, val] of Object.entries(s.fill.fields)) {
            const meta = s.fill.filled?.find((f) => f.id === ctrl);
            const autoSaveMaternity = s.fill.page === 'maternity' && Boolean(sim.activePatient) && /^(patient|baseline|delivery)\./.test(ctrl);
            actionsToRun.push({
              actionId: s.fill.actionIds?.[ctrl],
              op: 'fill',
              control: ctrl,
              value: val,
              page: s.fill.page,
              risk: (s.fill.confirm || autoSaveMaternity) ? 'confirm' : 'free',
              field: meta?.field,
              hash: meta?.hash,
            });
          }
        }
        if (s.press) {
          actionsToRun.push({
            actionId: s.press.actionId,
            op: 'press',
            id: s.press.id,
            effect: s.press.effect,
            risk: (s.press.effect === 'save' || s.press.effect === 'send') ? 'confirm' : 'free',
          });
        }
        if (s.page?.actions) {
          actionsToRun.push(...s.page.actions);
        }
      }
    }

    results = [];
    for (const act of actionsToRun) {
      const res = sim.applyAction(act);
      results.push(res);
      actionsExecuted.push({ ...act, result: res.result });
      if (res.result === 'ok' && act.field && act.hash) {
        if (written.some((w) => w.field === act.field && w.hash === act.hash)) {
          sim.duplicateWrites.push({ field: act.field, hash: act.hash });
        } else {
          written.push({ field: act.field, hash: act.hash });
        }
      }
      if (res.result === 'cancelled') {
        break;
      }
    }

    if (!reply.continue) {
      break;
    }

    round += 1;
  }

  return {
    sim,
    lastReply,
    replies,
    actionsExecuted,
    rounds: round + 1,
    done: lastReply?.type === 'done' || (lastReply?.type === 'run' && !lastReply?.continue),
    unsupported: lastReply?.type === 'unsupported',
  };
}

module.exports = { runAgentSim };
