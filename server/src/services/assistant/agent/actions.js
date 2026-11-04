/**
 * Actions mapping & validation for the Assistant Phase 6 Agent Loop.
 *
 * Responsibilities:
 * Validates the actions returned by the Navigator model:
 * - click(ref): Checks element existence, risk classification (never/free/confirm).
 * - type(ref, text) / append(ref, text) / replace(ref, find, text): Text must be grounded in user message.
 * - select(ref, option): Option must exist and be mentioned.
 * - check(ref): Element must be checkbox. Untick is forbidden.
 * - key(ref, "Enter"): Only allowed on search or non-saving inputs.
 * - go(pageId): Open menu page via pages.registry.js.
 * - open_record(kind, patient): Resolves patient record and builds navigation step.
 * - open_row(patient): Matches private patient row (browser-side matching).
 *
 * Enforces single-confirm limit: at most one confirm action (or fields: group) per round.
 */

const { classify, confirmGroup, NEVER } = require('../pageSnapshot');
const { norm, mentions } = require('../resolvers/values');
const { findPage } = require('../pages.registry');
const { resolvePatient, describePatient } = require('../resolvers/patients');

const REASONS = {
  never: 'that action must be performed manually',
  gone: 'element is not present on the current page',
  notInMessage: 'values typed must come directly from your request',
  badOption: 'selected option is not available',
  disabled: 'control is currently disabled',
  badKey: 'key action is only supported for Enter on search fields',
  unknownPage: 'requested page is not recognised',
  patientNotFound: 'could not find a matching patient in your directory',
  badPatientRecord: 'record type is not supported',
  wrongOp: 'that does not work on this kind of field',
};

/** Normalised check if text or its words are mentioned in the message. */
function isGrounded(text, message) {
  if (!text) return true;
  const rawText = String(text).trim();
  if (!rawText) return true;
  const escaped = rawText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'iu').test(String(message));
}

/**
 * Validates a list of proposed actions from Navigator against active page and safety invariants.
 *
 * @param {Array<object>} rawActions - Up to 3 proposed actions
 * @param {object} page - Snapshot of open page { title, headings, elements }
 * @param {string} message - Original user request
 * @param {Array<object>} clinicianPatients - Clinician's patients directory
 * @param {string} role - 'clinician' | 'patient'
 * @returns {object} { pageActions, navigationSteps, disambiguation, refused, cut }
 */
function validateAgentActions(rawActions = [], page = {}, message = '', clinicianPatients = [], role = 'clinician', context = {}) {
  const elements = page?.elements || [];
  const byRef = new Map(elements.map((el) => [el.ref, el]));

  const pageActions = [];
  const navigationSteps = [];
  const refused = [];
  let disambiguation = null;
  let confirmGroupSeen = null;
  let cut = false;

  for (const act of rawActions) {
    if (!act || typeof act !== 'object' || !act.op) continue;
    let op = act.op;

    // 1. Menu navigation: go(pageId)
    if (op === 'go') {
      if (act.page === 'return') {
        if (context.originRecord) navigationSteps.push({ op: 'return_record', recordTarget: context.originRecord, recordId: context.originRecord.id, label: 'Return to starting record' });
        else disambiguation = { type: 'clarify', message: 'Which patient?', options: [] };
        continue;
      }
      const targetPage = findPage(role, act.page);
      if (!targetPage) {
        refused.push({ name: act.page || 'page', reason: REASONS.unknownPage });
        continue;
      }
      navigationSteps.push({
        path: targetPage.path,
        label: targetPage.label,
        pageId: targetPage.id,
        op: 'go',
      });
      continue;
    }

    // 2. Open record: open_record(kind, patient)
    if (op === 'open_record') {
      if (act.kind === 'consultation_notes') {
        const button = elements.find(el => el.kind === 'button' && /consultation notes/i.test(el.name) && !el.private);
        if (button) pageActions.push({ ref: button.ref, op: 'click', name: button.name, kind: button.kind, risk: classify(button, 'click'), effect: button.effect });
        else refused.push({ name: 'notes', reason: REASONS.gone });
        continue;
      }
      let patientName = String(act.patient || '').trim();
      const named = clinicianPatients.flatMap(p => [p.fullName, String(p.fullName || '').split(' ')[0]]).find(name => name && isGrounded(name, message));
      if (!patientName) patientName = named || clinicianPatients.find(p => p.id === context.currentRecord?.patientId)?.fullName || '';
      if (!patientName) { disambiguation = { type: 'clarify', message: 'Which patient?', options: [] }; break; }
      const match = resolvePatient(patientName, clinicianPatients);
      const fromCurrent = !named && match.status === 'one' && match.patient.id === context.currentRecord?.patientId;
      if (!isGrounded(patientName, message) && !fromCurrent) { refused.push({ name: 'patient record', reason: REASONS.notInMessage }); continue; }
      const kind = act.kind || act.ref;
      if (!['last_visit','next_visit','maternity','new_appointment'].includes(kind)) { refused.push({ name: 'record', reason: REASONS.badPatientRecord }); continue; }
      const build = p => {
        const visit = kind === 'last_visit' ? p.lastVisit : p.nextVisit;
        if (['last_visit','next_visit'].includes(kind) && !visit?.appointmentId) return null;
        const recordId = ['last_visit','next_visit'].includes(kind) ? visit.appointmentId : p.id;
        const path = kind === 'maternity' ? '/clinician/maternity?patientId=' + encodeURIComponent(p.id)
          : kind === 'new_appointment' ? '/clinician/appointments/new?patient=' + encodeURIComponent(p.id)
          : '/clinician?appointment=' + encodeURIComponent(recordId);
        return { path, label: 'Open record', op: 'open_record', kind, recordId };
      };
      if (match.status === 'many') {
        disambiguation = { type: 'choose', prompt: 'Which patient do you mean?', options: match.matches.flatMap(p => {
          const step = build(p); return step ? [{ label: p.fullName, detail: describePatient(p), steps: [step] }] : [];
        }) };
        break;
      }
      const step = match.status === 'one' ? build(match.patient) : null;
      if (step) navigationSteps.push(step);
      else refused.push({ name: 'patient record', reason: REASONS.patientNotFound });
      continue;
    }

    // 3. Open row: open_row(patient)
    if (op === 'open_row') {
      let patientName = String(act.patient || act.name || act.value || '').trim();
      if (!patientName || !isGrounded(patientName, message)) {
        refused.push({ name: 'patient row', reason: REASONS.notInMessage }); continue;
      }
      const match = resolvePatient(patientName, clinicianPatients);
      if (match.status !== 'one') {
        disambiguation = { type: 'clarify', message: 'Which patient?', options: [] }; break;
      }
      pageActions.push({
        op: 'open_row',
        name: patientName,
        value: patientName,
        patient: patientName,
        risk: 'free',
        effect: 'free',
      });
      continue;
    }

    // 4. Element-based actions: click, type, append, replace, select, check, key
    let ref = String(act.ref || '').trim();
    let element = byRef.get(ref);
    if (!element) {
      // 1. Try extracting leading ref token (e.g. 'r2 button "..."' -> 'r2')
      const token = ref.match(/^(r\d+|nav_[a-z0-9_]+|btn_[a-z0-9_]+|inp_[a-z0-9_]+|row_[a-z0-9_]+)\b/i)?.[1];
      if (token && byRef.has(token)) {
        element = byRef.get(token);
        ref = token;
      }
    }
    if (!element) {
      // 2. Try matching by element name if ref includes or matches it
      for (const [elRef, el] of byRef.entries()) {
        if (el.name && (ref.toLowerCase().includes(el.name.toLowerCase()) || (act.name && el.name.toLowerCase() === act.name.toLowerCase()))) {
          element = el;
          ref = elRef;
          break;
        }
      }
    }
    if (!element) {
      refused.push({ name: ref || 'element', reason: REASONS.gone });
      continue;
    }

    if (element.private) { refused.push({ name: 'private control', reason: REASONS.never }); continue; }
    if (op === 'type' && element.kind === 'textarea') op = 'append';
    const fits = ({ click: ['button','link','summary','tab','checkbox','radio','textarea','text'], type: ['text','search','email','tel','number','date','datetime'], append: ['textarea','text'], replace: ['textarea','text'], select: ['select'], check: ['checkbox','radio'], key: ['search'] })[op]?.includes(element.kind);
    if (!fits) { refused.push({ name: element.name, reason: REASONS.wrongOp }); continue; }
    if (element.disabled) {
      refused.push({ name: element.name, reason: REASONS.disabled });
      continue;
    }

    const CLICK_KINDS = new Set(['button', 'link', 'summary', 'tab', 'checkbox', 'radio']);

    if (element.kind === 'checkbox' && (op === 'click' || op === 'check')) {
      op = 'check';
    } else if (op === 'click' && (element.kind === 'textarea' || element.kind === 'text')) {
      const textVal = act.text !== undefined ? act.text : act.value;
      if (textVal) {
        op = element.kind === 'textarea' ? 'append' : 'type';
      } else {
        refused.push({ name: element.name, reason: REASONS.wrongOp });
        continue;
      }
    } else if (op === 'click' && !CLICK_KINDS.has(element.kind)) {
      refused.push({ name: element.name, reason: REASONS.wrongOp });
      continue;
    }

    // Risk check
    const risk = classify(element, op);
    if (risk === 'never' || NEVER.test(element.name)) {
      refused.push({ name: element.name, reason: REASONS.never });
      continue;
    }

    let value = act.text !== undefined ? act.text : act.value;
    let find = act.find;

    // Grounding check for text operations
    if (['type', 'append', 'replace'].includes(op)) {
      if (!value || !isGrounded(value, message)) {
        refused.push({ name: element.name, reason: REASONS.notInMessage });
        continue;
      }
      if (op === 'replace' && (!find || !isGrounded(find, message))) {
        refused.push({ name: element.name, reason: REASONS.notInMessage });
        continue;
      }
    } else if (op === 'select') {
      const option = act.option || value;
      const available = element.options || [];
      const matchOpt = available.find((o) => norm(o) === norm(option));
      if (!matchOpt) {
        refused.push({ name: element.name, reason: REASONS.badOption });
        continue;
      }
      if (!isGrounded(matchOpt, message)) {
        refused.push({ name: element.name, reason: REASONS.notInMessage });
        continue;
      }
      value = matchOpt;
    } else if (op === 'key') {
      const keyName = String(act.key || act.text || 'Enter').trim();
      if (keyName.toLowerCase() !== 'enter' || element.effect === 'save' || element.effect === 'send') {
        refused.push({ name: element.name, reason: REASONS.badKey });
        continue;
      }
    }

    // Enforce single-confirm rule
    let currentGroup;
    if (risk === 'confirm') {
      currentGroup = confirmGroup(element, op);
      if (confirmGroupSeen && (currentGroup !== confirmGroupSeen || !confirmGroupSeen.startsWith('fields:'))) {
        cut = true;
        break;
      }
      confirmGroupSeen = currentGroup;
    }

    const hasValue = value !== undefined && value !== '' && op !== 'click' && op !== 'check';
    pageActions.push({
      ref: element.ref,
      op,
      name: element.name,
      kind: element.kind,
      risk,
      ...(hasValue && { value }),
      ...(find !== undefined && find !== '' && { find }),
      ...(act.key && { key: act.key }),
      ...(element.section && { section: element.section }),
      ...(element.effect && { effect: element.effect }),
      ...(currentGroup && { group: currentGroup }),
    });
  }

  return {
    pageActions,
    navigationSteps,
    disambiguation,
    refused,
    cut,
  };
}

module.exports = {
  validateAgentActions,
  isGrounded,
  REASONS,
};
