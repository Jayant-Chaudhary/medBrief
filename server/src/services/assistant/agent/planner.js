/**
 * Planner for the Assistant Phase 6 Agent Loop.
 *
 * Responsibilities:
 * 1. Round 0: Formulates a concise, ordered checklist (<= 8 items) from the user's
 *    typed request in their own words, resolving pronouns (his/her/their/uska/unki)
 *    to the patient named in the request.
 * 2. Done Check: When Navigator emits status "done" or when stall occurs, checks
 *    if all checklist items are completed or adequately explained.
 */

const config = require('../../../config/assistant.config');
const { formatMemoryForPrompt } = require('../memory');

const CHECKLIST_SCHEMA = {
  type: 'object',
  properties: {
    checklist: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', maxLength: 160 },
    },
  },
  required: ['checklist'],
  additionalProperties: false,
};

const DONE_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    explanation: { type: 'string', maxLength: 200 },
    remaining: {
      type: 'array',
      items: { type: 'string', maxLength: 160 },
    },
  },
  required: ['done'],
  additionalProperties: false,
};

const PLANNER_SYSTEM = [
  'You turn a doctor\'s request in a clinic web app into a short ordered checklist (at most 8 items) in the user\'s own words.',
  'Rules:',
  '- Keep the original intent and wording where possible.',
  '- Resolve pronouns ("his", "her", "their", "uska", "unki") to the patient named in the request (e.g. "open his visit" -> "Open Soham\'s visit").',
  '- Split composite instructions into individual distinct actions (search, open record, open notes, add template, write in notes).',
  '- When an instruction writes into consultation notes (e.g. "open notes and write ..."), include "in notes" on the write item (e.g. "Write ... in notes").',
  '- At most 8 items, each <= 160 characters.',
  '- Reply with JSON matching the response schema only.',
].join('\n');

const PLANNER_EXAMPLES = [
  {
    role: 'user',
    content: 'find soham in patients, open his last visit, open notes, add the most similar template and write review in 2 weeks',
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      checklist: [
        'Find Soham in patients',
        "Open Soham's last visit",
        'Open consultation notes',
        'Add the most similar template',
        'Write review in 2 weeks in notes',
      ],
    }),
  },
  {
    role: 'user',
    content: 'open today\'s schedule',
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      checklist: ["Open today's schedule"],
    }),
  },
  {
    role: 'user',
    content: 'asha ka maternity card kholo aur BP 120/80 likho',
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      checklist: [
        "Open Asha's maternity card",
        'Write BP 120/80 in maternity card',
      ],
    }),
  },
,
  {
    role: 'user',
    content: 'open recording and check transcript logs',
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      checklist: [
        'Open recording',
        'Check transcript logs',
      ],
    }),
  },
];

const LEADING_FILLER = /^(?:and\s+then|then|after\s+that|afterwards|lastly|finally|also|aur|phir)\b,?\s*/i;

const FORBIDDEN_WORDS = /\b(delete|remove all|discard|clear all|archive|sign ?out|log ?out|reset database|diagnos\w*|safe\s+(?:\w+\s+)?(?:dose|dosage)|dosage|safe to take|treat\w*|cure)\b/i;

/**
 * Generates an ordered checklist from the user request at Round 0.
 *
 * @param {string} message - User request
 * @param {object} options - { provider, settings }
 * @returns {Promise<Array<{ text: string, done: boolean }>>}
 */
async function planChecklist(message, { provider, settings = config, memory = [] } = {}) {
  const text = String(message || '').trim();
  if (!text || FORBIDDEN_WORDS.test(text)) return [];

  const memoryPrompt = formatMemoryForPrompt(memory);
  // Single short commands don't need a heavy multi-step split unless they reference earlier memory
  if (!memoryPrompt && !/\b(and|then|also|phir|aur|after\s+that|afterwards|lastly|finally)\b|[,;]/i.test(text) && text.length < 50) {
    return [{ text: text.slice(0, 160), done: false }];
  }

  if (!provider) {
    return fallbackChecklist(text);
  }

  const messages = [
    { role: 'system', content: PLANNER_SYSTEM },
    ...PLANNER_EXAMPLES,
    { role: 'user', content: memoryPrompt ? `${memoryPrompt}\n\nCurrent request: ${text}` : text },
  ];

  const timeoutMs = settings.modelCallTimeoutMs || settings.timeoutMs || 30000;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await provider.complete({
        messages,
        schema: CHECKLIST_SCHEMA,
        timeoutMs,
      });
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed?.checklist) && parsed.checklist.length > 0) {
        return parsed.checklist
          .filter((item) => typeof item === 'string' && item.trim().length > 0)
          .slice(0, 8)
          .map((item) => ({ text: item.trim().slice(0, 160), done: false }));
      }
      break;
    } catch (_err) {
      if (attempt === 1) break;
      // Retry once on timeout
    }
  }

  return fallbackChecklist(text);
}

/** Fallback heuristic checklist if model call fails. */
function fallbackChecklist(message) {
  const parts = String(message || '')
    .split(/\b(?:and\s+then|then|after\s+that|afterwards|lastly|finally|phir|aur)\b|[,;]+/i)
    .map((p) => p.trim().replace(LEADING_FILLER, '').trim())
    .filter(Boolean);
  if (!parts.length) return [{ text: message.slice(0, 160), done: false }];
  return parts.slice(0, 8).map((p) => ({ text: p.slice(0, 160), done: false }));
}

/**
 * Checks whether all checklist items are complete or explained.
 * Fast-paths when all items already have done === true.
 *
 * @param {string} message - Original user request
 * @param {Array<{ text: string, done: boolean }>} checklist - Active checklist
 * @param {object} context - { note, lastResults, rounds, provider, settings }
 * @returns {Promise<{ done: boolean, message?: string, remaining?: string[] }>}
 */
async function checkDone(message, checklist = [], { note = '', lastResults = [], rounds = 0, provider, settings = config } = {}) {
  if (!checklist.length) {
    return { done: true, message: 'All done.' };
  }

  const allTicked = checklist.every((item) => item.done);
  if (allTicked) {
    return { done: true, message: 'All done.' };
  }

  const pending = checklist.filter((item) => !item.done).map((item) => item.text);

  return { done: false, message: pending.map(text => "Couldn't: " + text + ' because no verified result completed it').join('\n'), remaining: pending };
}

module.exports = {
  planChecklist,
  checkDone,
  fallbackChecklist,
  CHECKLIST_SCHEMA,
  DONE_CHECK_SCHEMA,
};
