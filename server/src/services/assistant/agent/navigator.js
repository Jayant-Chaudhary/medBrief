/**
 * Navigator for the Assistant Phase 6 Agent Loop.
 *
 * Responsibilities:
 * Every round, the navigator inspects:
 * 1. The original user request.
 * 2. The checklist with completion ticks ([✓] or [ ]).
 * 3. Results of the last executed actions (ok, not_found, disabled, no_change, cancelled, refused).
 * 4. Its own persistent note from the prior round (<= 200 chars).
 * 5. Current page elements and available destinations.
 *
 * It outputs:
 * - note: concise summary of progress / next intent (<= 200 chars)
 * - actions: 1 to 3 actions from the approved action set
 * - status: "continue" | "done" | "ask" | "cannot"
 * - question / reason (optional)
 */

const { describeElements } = require('../pageSnapshot');
const { pagesFor } = require('../pages.registry');
const config = require('../../../config/assistant.config');

const NAVIGATOR_SCHEMA = {
  type: 'object',
  properties: {
    note: { type: 'string', maxLength: 200 },
    actions: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['click', 'type', 'append', 'replace', 'select', 'check', 'key', 'go', 'open_record', 'open_row'],
          },
          ref: { type: 'string' },
          text: { type: 'string', maxLength: 300 },
          find: { type: 'string', maxLength: 300 },
          option: { type: 'string', maxLength: 100 },
          key: { type: 'string', enum: ['Enter'] },
          page: { type: 'string' },
          kind: { type: 'string', enum: ['last_visit', 'next_visit', 'maternity', 'new_appointment'] },
          patient: { type: 'string', maxLength: 120 },
        },
        required: ['op'],
        additionalProperties: false,
      },
    },
    status: { type: 'string', enum: ['continue', 'done', 'ask', 'cannot'] },
    question: { type: 'string', maxLength: 200 },
    reason: { type: 'string', maxLength: 300 },
  },
  required: ['note', 'actions', 'status'],
  additionalProperties: false,
};

function formatChecklist(checklist = []) {
  if (!checklist.length) return 'None';
  return checklist.map((item, idx) => `${idx + 1}. [${item.done ? '✓' : ' '}] ${item.text}`).join('\n');
}

function formatResults(results = []) {
  if (!results.length) return 'None (round 0 or no previous actions)';
  return results
    .map((r) => {
      const target = r.ref ? ` ${r.ref}` : '';
      const op = r.op ? ` ${r.op}` : '';
      const reason = r.reason ? `: ${r.reason}` : '';
      return `- ${op}${target} -> ${r.result}${reason}`;
    })
    .join('\n');
}

function buildNavigatorMessages({
  message,
  checklist = [],
  note = '',
  results = [],
  page,
  role = 'clinician',
}) {
  const pages = pagesFor(role);
  const pageList = pages.map((p) => `- ${p.id}: ${p.label} (${p.description})`).join('\n');
  const elements = page?.elements?.length ? describeElements(page.elements) : 'No interactive elements read from page.';
  const pageTitle = page?.title ? `Page Title: "${page.title}"` : 'Page Title: (unknown)';

  const system = [
    'You are the Navigator for a clinic web assistant. You help the doctor by selecting 1 to 3 actions each round.',
    'At each round, evaluate what the user asked, what checklist items are still pending, the last action results, your prior note, and the elements on screen.',
    '',
    'Action Set (only these may be returned):',
    '- click(ref): Press button, tab, link, option, or summary on page.',
    '- type(ref, text): Fill text field (text must be taken directly from user request).',
    '- append(ref, text): Append newline + text to textarea (text must be taken directly from user request).',
    '- replace(ref, find, text): Replace substring "find" with "text" in a field.',
    '- select(ref, option): Choose an option in a dropdown.',
    '- check(ref): Tick an unticked checkbox.',
    '- key(ref, "Enter"): Submit search box (Enter key).',
    '- go(page): Open a menu page by id.',
    '- open_record(kind, patient): Open patient record (kind: "last_visit"|"next_visit"|"maternity"|"new_appointment").',
    '- open_row(patient): Click a private patient row matching the patient name.',
    '',
    'Rules:',
    '1. Grounding: Never invent doses, numbers, text, or patient names. All text and values must come verbatim from the user request.',
    '2. Safety: Never delete, clear, discard, sign out, or record audio. If asked to do so, set status: "cannot" with a clear explanation in reason.',
    '3. Progress: Do not repeat actions that already succeeded. Check the checklist ticks and prior results.',
    '4. When all items of the checklist are completed, return status: "done" and actions: [].',
    '5. Return JSON only conforming to the response schema.',
    '',
    `Available Menu Pages:\n${pageList}`,
  ].join('\n');

  const userPrompt = [
    `User Request: "${message}"`,
    '',
    `Checklist Status:\n${formatChecklist(checklist)}`,
    '',
    `Previous Action Results:\n${formatResults(results)}`,
    '',
    `Your Last Note: "${note || '(none)'}"`,
    '',
    `${pageTitle}`,
    `Visible Page Elements:\n${elements}`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Executes one Navigator reasoning step using the LLM provider.
 *
 * @param {object} params - { message, checklist, note, results, page, role, provider, settings }
 * @returns {Promise<{ note: string, actions: Array<object>, status: string, question?: string, reason?: string }>}
 */
async function navigateRound({
  message,
  checklist = [],
  note = '',
  results = [],
  page,
  role = 'clinician',
  provider,
  settings = config,
}) {
  if (!provider) {
    return {
      note: 'No model provider available',
      actions: [],
      status: 'cannot',
      reason: settings.unavailableMessage || 'Assistant is currently unavailable.',
    };
  }

  const messages = buildNavigatorMessages({ message, checklist, note, results, page, role });

  const timeoutMs = settings.modelCallTimeoutMs || settings.timeoutMs || 30000;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await provider.complete({
        messages,
        schema: NAVIGATOR_SCHEMA,
        timeoutMs,
      });

      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') {
        let actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 3) : [];
        // Backward compatibility with Phase 5 pageActions in test helpers:
        if (!actions.length && Array.isArray(parsed.pageActions)) {
          actions = parsed.pageActions.map((a) => ({
            op: a.op,
            ref: a.ref,
            text: a.value,
            value: a.value,
            find: a.find,
            option: a.value,
          })).slice(0, 3);
        }
        let status = ['continue', 'done', 'ask', 'cannot'].includes(parsed.status) ? parsed.status : null;
        if (!status) {
          status = parsed.next || parsed.action === 'run' ? 'continue' : 'done';
        }
        const cleanNote = String(parsed.note || '').slice(0, 200);
        return {
          note: cleanNote,
          actions,
          status,
          ...(parsed.question && { question: String(parsed.question).slice(0, 200) }),
          ...(parsed.reason && { reason: String(parsed.reason).slice(0, 300) }),
        };
      }
    } catch (err) {
      if (attempt === 0) continue; // Retry once on timeout/error
      return {
        note: "Couldn't finish: the model didn't answer",
        actions: [],
        status: 'cannot',
        reason: "Couldn't finish: the model didn't answer",
      };
    }
  }

  return {
    note: 'Invalid model response',
    actions: [],
    status: 'cannot',
    reason: 'Could not parse assistant instructions.',
  };
}

module.exports = {
  navigateRound,
  buildNavigatorMessages,
  NAVIGATOR_SCHEMA,
};
