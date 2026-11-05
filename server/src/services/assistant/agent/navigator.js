/**
 * Navigator for the Assistant Phase 6 Agent Loop.
 *
 * Responsibilities:
 * Every round, the navigator inspects:
 * 1. The original user request.
 * 2. The checklist with completion ticks ([✓] or [ ]).
 * 3. Results of the last executed actions (ok, not_found, disabled, no_change, cancelled, refused).
 * 4. Its own persistent note from the prior round (<= 200 chars).
 * 5. Current page elements, declared form controls/buttons, and available destinations.
 *
 * It outputs:
 * - note: concise summary of progress / next intent (<= 200 chars)
 * - actions: one action for the first unfinished task
 * - status: "continue" | "done" | "ask" | "cannot"
 * - question / reason (optional)
 */

const { describeElements } = require('../pageSnapshot');
const { pagesFor } = require('../pages.registry');
const { formFor, pressableButtons } = require('../controls.registry');
const { nowInWords } = require('../resolvers/datetime');
const { formatMemoryForPrompt } = require('../memory');
const config = require('../../../config/assistant.config');

const NAVIGATOR_SCHEMA = {
  type: 'object',
  properties: {
    note: { type: 'string', maxLength: 200 },
    actions: {
      type: 'array',
      maxItems: 1,
      items: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['click', 'type', 'append', 'replace', 'select', 'check', 'key', 'go', 'open_record', 'open_row', 'fill', 'press'],
          },
          ref: { type: 'string' },
          control: { type: 'string', maxLength: 100 },
          value: { type: 'string', maxLength: 300 },
          button: { type: 'string', maxLength: 100 },
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

function describeDeclaredForm(role, onPage) {
  const form = onPage ? formFor(role, onPage) : null;
  if (!form) return '';
  const lines = [];
  if (form.controls?.length) {
    lines.push('Declared Form Controls (use fill(control, value); these ids are NEVER element refs):');
    for (const c of form.controls) {
      const opts = c.options?.length ? ` [options: ${c.options.map((o) => o.label).join(', ')}]` : '';
      const fmt = c.kind === 'datetime' ? ' (format: YYYY-MM-DDTHH:mm)' : c.kind === 'date' ? ' (format: YYYY-MM-DD)' : '';
      lines.push(`- ${c.id}: "${c.label}" (${c.kind}${fmt})${opts}`);
    }
  }
  const buttons = pressableButtons(onPage);
  if (buttons.length) {
    lines.push('Declared Form Buttons (use press(button)):');
    for (const b of buttons) {
      lines.push(`- ${b.id}: "${b.label}" (${b.effect})`);
    }
  }
  return lines.join('\n');
}

function formatChecklist(checklist = []) {
  if (!checklist.length) return 'None';
  return checklist.map((item, idx) => `${idx + 1}. [${item.done ? '✓' : ' '}] ${item.text}`).join('\n');
}

function formatResults(results = []) {
  if (!results.length) return 'None (round 0 or no previous actions)';
  return results
    .map((r) => {
      const target = r.ref || r.control || r.button || r.id ? ` ${r.ref || r.control || r.button || r.id}` : '';
      const label = r.name ? ` "${r.name}"` : '';
      const op = r.op ? ` ${r.op}` : '';
      const reason = r.reason ? `: ${r.reason}` : '';
      return `- ${op}${target}${label} -> ${r.result}${reason}`;
    })
    .join('\n');
}

function buildNavigatorMessages({
  message,
  checklist = [],
  note = '',
  results = [],
  page,
  onPage = null,
  clock = null,
  memory = [],
  hasOpenRecord = null,
  role = 'clinician',
}) {
  const pages = pagesFor(role);
  const pageList = pages.map((p) => `- ${p.id}: ${p.label} (${p.description})`).join('\n');
  const elements = page?.elements?.length ? describeElements(page.elements) : 'No interactive elements read from page.';
  const declared = describeDeclaredForm(role, onPage);
  const pageTitle = page?.title ? `Page Title: "${page.title}"` : 'Page Title: (unknown)';
  const recordStatusLine = hasOpenRecord
    ? `Current Record Status: The active patient's ${hasOpenRecord} is already open on this page.`
    : '';
  const clockLines = role === 'clinician' && clock?.now
    ? [
        `- Now is ${nowInWords(clock.now, clock.timeZone)}. For date/datetime fields write the requested date and time as YYYY-MM-DDTHH:mm (or YYYY-MM-DD for date) in that time zone (24-hour clock), working out words like "tomorrow" or "kal" from now.`,
      ]
    : [];

  const system = [
    'You are the Navigator for a clinic web assistant. Select exactly ONE action for the FIRST unfinished checklist item, or a prerequisite needed for that item. Never start a later item. The browser verifies the result and displays the updated checklist before you are asked again.',
    'For a task with several fields, fill one remaining field now. Already verified fields must not be filled again. Saving is a separate action after all requested fields are verified.',
    'At each round, evaluate what the user asked, what checklist items are still pending, the last action results, your prior note, and the elements on screen.',
    '',
    'Action Set (only these may be returned):',
    '- click(ref): Press button, tab, link, option, or summary on page. NEVER use click on a textarea or input field.',
    '- type(ref, text): Fill text field (text must be taken directly from user request).',
    '- append(ref, text): Append newline + text to textarea (text must be taken directly from user request).',
    '- replace(ref, find, text): Replace substring "find" with "text" in a field.',
    '- select(ref, option): Choose an option in a dropdown.',
    '- check(ref): Tick an unticked checkbox.',
    '- key(ref, "Enter"): Submit search box (Enter key).',
    '- fill(control, value): Fill a declared form control on the open page by its control id (e.g. "scheduledAt", "visit.systolic", "visit.weight"). Split "BP 110/70" into fill("visit.systolic", "110") and fill("visit.diastolic", "70").',
    '- press(button): Press a declared form button on the open page by its button id (e.g. "save_visit", "create_visit"). At most one save/send button per round.',
    '- go(page): Open a menu page by id. go("return") returns to the record this request started on; if none was open, ask which patient.',
    '- Patient-specific work requires a patient named in the request or a record already open.',
    '- Private controls cannot be clicked or filled. Use open_row with a name from the request or open_record.',
    '- open_record(kind, patient): Open a patient visit, card, or appointment directly by name (kind: "last_visit"|"next_visit"|"maternity"|"new_appointment"). Always use open_record directly when asked to view/open a patient record or visit, instead of manually searching on the patients page. Note: Consultation notes is NOT a record kind; to open consultation notes, click the "Consultation notes" button on screen.',
    '- open_row(patient): Click a patient row in the directory table matching the patient name.',
    ...clockLines,
    '',
    'Rules:',
    '1. Grounding: Never invent doses, numbers, text, or patient names. All text and values must come verbatim from the user request.',
    '2. Safety: Never delete, clear, discard, sign out, or record audio (start, stop, pause recording, mic check, or consent). Opening the recording window ("record consultation", "open recording") is allowed via a confirmation card, but starting or stopping recording must be refused: return status: "cannot" with a clear explanation in reason.',
    '3. Progress: Do not repeat actions that already succeeded or checklist items already marked [✓]. Never re-press a button or re-fill a field that already succeeded in prior results. When a pending checklist item asks to return or go to a page (e.g. "back to dashboard"), use go(page) (e.g. go("dashboard")). Never append the same text to notes twice. Check the checklist ticks and prior results.',
    '4. When all items of the checklist are completed, return status: "done" and actions: [].',
    '5. Consultation Notes & Prescription: To open consultation notes or view notes, use click(ref) on the "Consultation notes" button visible on the visit page. To write observations or general notes ("write ... in notes", "open notes and write ..."), ALWAYS use append(ref, text) on the "Consultancy notes" textarea (only use "Patient instructions / counseling" or "Follow-up advice / recommended investigations" when the user explicitly names "patient instructions" or "follow-up advice"). To add a medicine when no medicine row is visible yet, click the "Add medicine" button; once "Prescription · Medicine 1" fields (Name, Dose, Frequency, Duration) appear on screen, use type(ref, text) to fill Name, Dose, Frequency, and Duration.',
    '6. Ref format: Output only the exact ref identifier (e.g. "r1", "r2") for ref, never append labels, tags, or extra words to ref.',
    '7. Return JSON only conforming to the response schema.',
    '',
    'Examples:',
    '- "open new visit" -> actions: [{ op: "go", page: "new_appointment" }]',
    '- "new visit for Test Person tomorrow at 5 pm" -> first actions: [{ op: "open_record", kind: "new_appointment", patient: "Test Person" }]; after verified arrival, actions: [{ op: "fill", control: "scheduledAt", value: "<tomorrow>T17:00" }]',
    '- "back to dashboard" -> actions: [{ op: "go", page: "dashboard" }]',
    '',
    `Available Menu Pages:\n${pageList}`,
  ].join('\n');

  const memoryBlock = formatMemoryForPrompt(memory);
  const userPrompt = [
    ...(memoryBlock ? [memoryBlock, ''] : []),
    `User Request: "${message}"`,
    '',
    `Checklist Status:\n${formatChecklist(checklist)}`,
    `Work on this item only: ${checklist.find(item => !item.done)?.text || '(none)'}`,
    `Already verified fields for this item: ${(checklist.find(item => !item.done)?.completed || []).join(', ') || '(none)'}`,
    '',
    `Previous Action Results:\n${formatResults(results)}`,
    '',
    `Your Last Note: "${note || '(none)'}"`,
    '',
    `${pageTitle}`,
    ...(recordStatusLine ? [recordStatusLine] : []),
    ...(declared ? [`${declared}\n`] : []),
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
 * @param {object} params - { message, checklist, note, results, page, onPage, clock, role, provider, settings }
 * @returns {Promise<{ note: string, actions: Array<object>, status: string, question?: string, reason?: string }>}
 */
async function navigateRound({
  message,
  checklist = [],
  note = '',
  results = [],
  page,
  onPage = null,
  clock = null,
  memory = [],
  hasOpenRecord = null,
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

  const messages = buildNavigatorMessages({ message, checklist, note, results, page, onPage, clock, memory, hasOpenRecord, role });

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
        let actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 1) : [];
        // Backward compatibility with Phase 5 pageActions in test helpers:
        if (!actions.length && Array.isArray(parsed.pageActions)) {
          actions = parsed.pageActions.map((a) => ({
            op: a.op,
            ref: a.ref,
            text: a.value,
            value: a.value,
            find: a.find,
            option: a.value,
          })).slice(0, 1);
        }
        let status = ['continue', 'done', 'ask', 'cannot'].includes(parsed.status) ? parsed.status : null;
        if (actions.length > 0 && status === 'cannot') {
          status = 'continue';
        }
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
    } catch (_err) {
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
  describeDeclaredForm,
  NAVIGATOR_SCHEMA,
};
