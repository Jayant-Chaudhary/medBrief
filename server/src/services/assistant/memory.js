/**
 * Tab-scoped session memory helper for the Assistant (Slice 5).
 *
 * Responsibilities:
 * - Filters out expired memory entries older than `maxAgeMinutes` (default 120) and bounds to `maxItems` (default 10).
 * - Resolves patient names against the clinician's own directory, redacting unknown names just like `pageSnapshot.js`.
 * - Answers "which patient was that?" directly from the most recent memory entry with a verified patient.
 * - Resolves follow-up requests ("do the same for Asha", "also add calcium", "go back to the last patient",
 *   "repeat that", "finish what failed") safely without ever re-running a save without Confirm or inventing values.
 * - Formats the `"Earlier in this session: ..."` block for the planner and navigator prompts.
 * - Allows typed values from an earlier request's own words ONLY when the doctor explicitly points to them
 *   (e.g. "same notes as before", "repeat that", "do the same", "finish what failed").
 */

const { resolvePatient } = require('./resolvers/patients');
const { isGrounded } = require('./agent/actions');
const config = require('../../config/assistant.config');

const EXPLICIT_MEMORY_VALUE_REF = /\b(same\s+(?:notes?|text|words?|value|dose|prescription|instructions?|advice|as\s+before)|repeat\s+that|do\s+the\s+same|finish\s+what\s+failed|retry\s+what\s+failed|what\s+failed)\b/i;

const ASKS_WHICH_PATIENT = /^(?:which|who|what)\s+(?:patient|person)\s+(?:was\s+that|was\s+it|did\s+we\s+(?:just\s+)?(?:see|open|work\s+on)|is\s+this)\s*\??$/i;
const GO_BACK_LAST_PATIENT = /\b(?:go\s+back\s+to|reopen|open|return\s+to)\s+(?:the\s+)?(?:last|previous)\s+patient(?:'s\s+(?:record|visit|card))?\b/i;
const DO_SAME_FOR = /\b(?:do\s+the\s+same|same\s+thing|repeat\s+that)\s+for\s+(\p{L}[\p{L}'.-]*(?:\s+\p{L}[\p{L}'.-]*){0,3})/iu;
const REPEAT_THAT = /^(?:please\s+)?(?:repeat\s+that|do\s+that\s+again|do\s+the\s+same(?:\s+thing)?)\s*[.!]?$/i;
const FINISH_FAILED = /\b(?:finish|complete|retry|do)\s+what\s+(?:failed|didn'?t\s+finish|was\s+left)\b/i;
const ALSO_FOLLOWUP = /^(?:and\s+|also\s+|now\s+)?(?:also\s+)?(?:add|write|append|tick|check|fill|set|open)\b/i;

/**
 * Filters, bounds, and sanitizes client-supplied tab memory against the clinician's directory.
 * Never logs memory. Unknown patient names are stripped; known patient names are verified.
 */
function sanitizeMemory(rawMemory = [], patients = [], { now = Date.now(), settings = config } = {}) {
  if (!Array.isArray(rawMemory) || !rawMemory.length) return [];
  const maxItems = settings.memoryItems || config.memoryItems || 10;
  const maxAgeMs = (settings.memoryMaxAgeMin || config.memoryMaxAgeMin || 120) * 60 * 1000;

  const valid = [];
  for (const item of rawMemory) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.at === 'number') {
      if (item.at > now + 60000 || now - item.at > maxAgeMs) continue;
    }
    const message = String(item.message || '').trim().slice(0, settings.maxMessageChars || 600);
    if (!message) continue;

    let verifiedPatient = null;
    if (item.patient && typeof item.patient === 'object') {
      const byId = item.patient.id ? patients.find((p) => p.id === item.patient.id) : null;
      if (byId) {
        verifiedPatient = {
          id: byId.id,
          name: String(item.patient.name || byId.fullName).slice(0, 120),
          fullName: byId.fullName,
        };
      } else if (item.patient.name) {
        const match = resolvePatient(item.patient.name, patients);
        if (match.status === 'one') {
          verifiedPatient = {
            id: match.patient.id,
            name: String(item.patient.name).slice(0, 120),
            fullName: match.patient.fullName,
          };
        }
      }
    }
    if (!verifiedPatient && patients.length) {
      const found = patients.find((p) =>
        [p.fullName, String(p.fullName || '').split(' ')[0]].some((n) => n && isGrounded(n, message))
      );
      if (found) {
        verifiedPatient = { id: found.id, name: found.fullName, fullName: found.fullName };
      }
    }

    const record = item.record && typeof item.record === 'object' && ['visit', 'maternity', 'new_appointment'].includes(item.record.kind) && item.record.id
      ? {
          kind: item.record.kind,
          id: String(item.record.id).slice(0, 100),
          ...(verifiedPatient ? { patientId: verifiedPatient.id } : {}),
        }
      : null;

    const page = item.page ? String(item.page).slice(0, 80) : null;
    const checklist = Array.isArray(item.checklist)
      ? item.checklist.slice(0, 8).map((c) => ({
          text: String(c?.text || '').trim().slice(0, 160),
          done: Boolean(c?.done),
          ...(c?.reason ? { reason: String(c.reason).trim().slice(0, 160) } : {}),
        })).filter((c) => c.text)
      : [];

    valid.push({
      message,
      patient: verifiedPatient,
      record,
      page,
      checklist,
      ...(typeof item.at === 'number' ? { at: item.at } : {}),
    });
  }

  return valid.slice(-maxItems);
}

/**
 * Formats the compact "Earlier in this session: ..." block for Planner and Navigator prompts.
 */
function formatMemoryForPrompt(memory = []) {
  if (!Array.isArray(memory) || !memory.length) return '';
  const lines = memory.map((entry, idx) => {
    const who = entry.patient ? ` [patient: ${entry.patient.fullName}]` : '';
    const where = entry.record
      ? ` [record: ${entry.record.kind}]`
      : entry.page
      ? ` [page: ${entry.page}]`
      : '';
    const items = entry.checklist?.length
      ? ` -> ${entry.checklist.map((c) => `[${c.done ? '✓' : '✗'}] ${c.text}${c.reason ? ` (${c.reason})` : ''}`).join('; ')}`
      : '';
    return `${idx + 1}. "${entry.message}"${who}${where}${items}`;
  });
  return `Earlier in this session:\n${lines.join('\n')}`;
}

/**
 * Finds any patient explicitly named in the current message.
 * A different patient named now always beats memory.
 */
function findNamedPatientInMessage(message, patients = []) {
  const msg = String(message || '');
  for (const p of patients) {
    const names = [p.fullName, String(p.fullName || '').split(' ')[0]].filter(Boolean);
    for (const name of names) {
      if (isGrounded(name, msg)) return p;
    }
  }
  return null;
}

/**
 * Computes the effective grounding text for value checks:
 * Typed values must be in the current request, OR come from an earlier request's own words
 * when the doctor explicitly points to them ("same notes as before", "do the same for Asha", "repeat that", "finish what failed").
 */
function effectiveGroundingMessage(message, memory = []) {
  const msg = String(message || '');
  if (!Array.isArray(memory) || !memory.length) return msg;
  if (EXPLICIT_MEMORY_VALUE_REF.test(msg)) {
    const last = memory[memory.length - 1];
    if (last?.message) return `${msg}\n${last.message}`;
  }
  return msg;
}

/**
 * Inspects the current request and sanitized memory to see if a memory follow-up applies:
 * - "which patient was that?" -> direct answer from memory
 * - "go back to the last patient" -> navigate/open_record to the last patient's record
 * - "do the same for <Name>" -> adapts the last request's checklist/message to <Name>
 * - "repeat that" -> repeats the last request's steps (still requires Confirm on any save)
 * - "finish what failed" -> runs the failed/unticked items from the last request
 * - "also add calcium" -> inherits the last patient/record if none is named now
 */
function resolveMemoryFollowUp(message, memory = [], patients = []) {
  const text = String(message || '').trim();
  if (!Array.isArray(memory) || !memory.length) return null;

  const last = memory[memory.length - 1];
  const lastWithPatient = [...memory].reverse().find((m) => m.patient);
  const namedNow = findNamedPatientInMessage(text, patients);

  // 1. "which patient was that?"
  if (ASKS_WHICH_PATIENT.test(text)) {
    if (lastWithPatient?.patient) {
      const rec = lastWithPatient.record?.kind ? ` (${lastWithPatient.record.kind.replace('_', ' ')})` : '';
      return {
        kind: 'answer',
        text: `That was ${lastWithPatient.patient.fullName}${rec}.`,
      };
    }
    return {
      kind: 'answer',
      text: 'No patient was opened earlier in this session.',
    };
  }

  // 2. "go back to the last patient"
  if (GO_BACK_LAST_PATIENT.test(text) && !namedNow) {
    if (lastWithPatient?.record) {
      return {
        kind: 'return_patient',
        patient: lastWithPatient.patient,
        record: lastWithPatient.record,
        checklist: [{ text: `Open ${lastWithPatient.patient.fullName}'s record`, done: false }],
      };
    }
    if (lastWithPatient?.patient) {
      return {
        kind: 'open_patient',
        patient: lastWithPatient.patient,
        checklist: [{ text: `Open ${lastWithPatient.patient.fullName}'s last visit`, done: false }],
      };
    }
  }

  // 3. "do the same for <Patient>"
  const sameForMatch = DO_SAME_FOR.exec(text);
  if (sameForMatch && last) {
    const targetName = sameForMatch[1].trim();
    const resolved = resolvePatient(targetName, patients);
    const targetPatient = resolved.status === 'one' ? resolved.patient : namedNow;
    const prevName = last.patient?.fullName || last.patient?.name || '';
    const prevFirst = prevName.split(' ')[0];
    const stripForPatient = (str) => String(str || '').replace(/\s+(?:for|of)\s+\p{L}[\p{L}'.-]*(?:\s+\p{L}[\p{L}'.-]*){0,3}$/iu, '').trim();
    const replaceName = (str) => {
      if (!prevName) return `${str} for ${targetPatient?.fullName || targetName}`;
      let out = str;
      if (prevName) out = out.replace(new RegExp(prevName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), targetPatient?.fullName || targetName);
      if (prevFirst) out = out.replace(new RegExp(`\\b${prevFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), targetPatient?.fullName || targetName);
      return out;
    };
    const checklist = (last.checklist?.length ? last.checklist : [{ text: last.message, done: false }]).map((c) => ({
      text: stripForPatient(replaceName(c.text)),
      done: false,
    }));
    return {
      kind: 'rewrite',
      expandedMessage: stripForPatient(replaceName(last.message)),
      checklist,
      patient: targetPatient ? { id: targetPatient.id, name: targetPatient.fullName, fullName: targetPatient.fullName } : null,
      allowEarlierValues: true,
    };
  }

  // 4. "repeat that"
  if (REPEAT_THAT.test(text) && last) {
    const targetPatient = namedNow || last.patient;
    const checklist = (last.checklist?.length ? last.checklist : [{ text: last.message, done: false }]).map((c) => ({
      text: c.text,
      done: false,
    }));
    return {
      kind: 'rewrite',
      expandedMessage: last.message,
      checklist,
      patient: targetPatient,
      record: namedNow ? null : last.record,
      allowEarlierValues: true,
    };
  }

  // 5. "finish what failed"
  if (FINISH_FAILED.test(text) && last) {
    const failedItems = (last.checklist || []).filter((c) => !c.done);
    const items = failedItems.length ? failedItems : [{ text: last.message, done: false }];
    const targetPatient = namedNow || last.patient;
    return {
      kind: 'rewrite',
      expandedMessage: `${items.map((c) => c.text).join(' then ')} (from: ${last.message})`,
      checklist: items.map((c) => ({ text: c.text, done: false })),
      patient: targetPatient,
      record: namedNow ? null : last.record,
      allowEarlierValues: true,
    };
  }

  // 6. Contextual patient inheritance (e.g., "also add calcium"):
  // If a different patient is named now, it always beats memory!
  if (!namedNow && lastWithPatient?.patient && ALSO_FOLLOWUP.test(text)) {
    const cleanStep = text.replace(/^(?:and\s+|also\s+|now\s+)+/i, '').trim();
    const capitalized = cleanStep ? cleanStep.charAt(0).toUpperCase() + cleanStep.slice(1) : text;
    return {
      kind: 'inherit_context',
      patient: lastWithPatient.patient,
      record: lastWithPatient.record,
      checklist: [{ text: capitalized, done: false }],
    };
  }

  return null;
}

module.exports = {
  sanitizeMemory,
  formatMemoryForPrompt,
  findNamedPatientInMessage,
  effectiveGroundingMessage,
  resolveMemoryFollowUp,
};

