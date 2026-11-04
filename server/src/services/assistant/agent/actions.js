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
};

/** Normalised check if text or its words are mentioned in the message. */
function isGrounded(text, message) {
  if (!text) return true;
  const rawText = String(text).trim();
  if (!rawText) return true;
  if (norm(message).includes(norm(rawText))) return true;
  const parts = rawText.split(/\s+/).filter((w) => w.length > 2);
  if (!parts.length) return true;
  return mentions(message, parts);
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
function validateAgentActions(rawActions = [], page = {}, message = '', clinicianPatients = [], role = 'clinician') {
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
      const patientName = String(act.patient || '').trim();
      const kind = act.kind;
      if (!patientName) {
        refused.push({ name: 'patient record', reason: REASONS.patientNotFound });
        continue;
      }

      const match = resolvePatient(patientName, clinicianPatients);
      if (match.status === 'none') {
        refused.push({ name: patientName, reason: REASONS.patientNotFound });
        continue;
      }

      if (match.status === 'many') {
        // Disambiguation needed
        disambiguation = {
          type: 'choose',
          prompt: 'Which patient do you mean?',
          options: match.matches.map((p) => {
            let path = '/clinician';
            if (kind === 'maternity') path = `/clinician/maternity?patientId=${p.id}`;
            else if (kind === 'new_appointment') path = `/clinician/appointments/new?patient=${p.id}`;
            else if (kind === 'next_visit' && p.nextVisit?.appointmentId) path = `/clinician?appointment=${p.nextVisit.appointmentId}`;
            else if (kind === 'last_visit' && p.lastVisit?.appointmentId) path = `/clinician?appointment=${p.lastVisit.appointmentId}`;
            return {
              label: p.fullName,
              detail: describePatient(p),
              steps: [{ path, label: `${p.fullName} · record` }],
            };
          }),
        };
        break;
      }

      const p = match.patient;
      let path = '/clinician';
      let label = `Open ${p.fullName}`;
      if (kind === 'maternity') {
        path = `/clinician/maternity?patientId=${p.id}`;
        label = `Maternity card · ${p.fullName}`;
      } else if (kind === 'new_appointment') {
        path = `/clinician/appointments/new?patient=${p.id}`;
        label = `New appointment · ${p.fullName}`;
      } else if (kind === 'next_visit') {
        if (p.nextVisit?.appointmentId) {
          path = `/clinician?appointment=${p.nextVisit.appointmentId}`;
          label = `Next visit · ${p.fullName}`;
        } else {
          path = '/clinician';
          label = `Visit · ${p.fullName}`;
        }
      } else if (kind === 'last_visit') {
        if (p.lastVisit?.appointmentId) {
          path = `/clinician?appointment=${p.lastVisit.appointmentId}`;
          label = `Last visit · ${p.fullName}`;
        } else {
          path = '/clinician';
          label = `Visit · ${p.fullName}`;
        }
      }

      navigationSteps.push({ path, label, op: 'open_record', kind, patient: p.fullName });
      continue;
    }

    // 3. Open row: open_row(patient)
    if (op === 'open_row') {
      const patientName = String(act.patient || '').trim();
      if (!patientName || !isGrounded(patientName, message)) {
        refused.push({ name: patientName || 'row', reason: REASONS.notInMessage });
        continue;
      }
      pageActions.push({
        op: 'open_row',
        name: patientName,
        value: patientName,
        risk: 'free',
        effect: 'free',
      });
      continue;
    }

    // 4. Element-based actions: click, type, append, replace, select, check, key
    const ref = act.ref;
    const element = byRef.get(ref);
    if (!element) {
      refused.push({ name: ref || 'element', reason: REASONS.gone });
      continue;
    }

    if (element.disabled) {
      refused.push({ name: element.name, reason: REASONS.disabled });
      continue;
    }

    if (element.kind === 'checkbox' && (op === 'click' || op === 'check')) {
      op = 'check';
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
      if (value && !isGrounded(value, message)) {
        refused.push({ name: element.name, reason: REASONS.notInMessage });
        continue;
      }
      if (op === 'replace' && find && !isGrounded(find, message)) {
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
      if (act.key !== 'Enter' || element.effect === 'save' || element.effect === 'send') {
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
