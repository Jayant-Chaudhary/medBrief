const { z } = require('zod');
const config = require('../config/assistant.config');

const label = (max) => z.string().max(max);

// The open page as the browser reads it: labels and non-patient nearby text only.
const pageElementSchema = z.object({
  ref: z.string().regex(/^r\d{1,4}$/),
  kind: z.enum(['button', 'link', 'summary', 'tab', 'checkbox', 'radio', 'select', 'text', 'textarea', 'number', 'date', 'datetime', 'email', 'tel', 'search']),
  name: label(120),
  section: label(120).optional(),
  options: z.array(label(80)).max(30).optional(),
  effect: z.enum(['save', 'send', 'never', 'free']).optional(),
  required: z.boolean().optional(),
  private: z.boolean().optional(),
  // Many buttons enable once a field is filled ("Add" next to a text box).
  disabled: z.boolean().optional(),
  // Non-patient nearby text (descriptions, status messages, template scores).
  text: label(160).optional(),
});

const pageSchema = z.object({
  title: label(160).optional(),
  headings: z.array(label(120)).max(20).optional(),
  elements: z.array(pageElementSchema).max(config.maxPageElements),
  text: z.array(label(160)).max(20).optional(),
});

const checklistItemSchema = z.object({
  text: label(160),
  done: z.boolean(),
});

const actionResultSchema = z.object({
  actionId: label(40).optional(),
  ref: z.string().optional(),
  op: z.string().optional(),
  name: label(120).optional(),
  page: label(80).optional(),
  path: label(120).optional(),
  kind: label(80).optional(),
  result: z.enum(['ok', 'not_found', 'label_changed', 'disabled', 'no_change', 'cancelled', 'refused']),
  reason: label(120).optional(),
});

const assistantStepSchema = z.object({
  originRecord: z.object({ kind: z.enum(['visit','maternity','new_appointment']), id: label(100) }).nullable().optional(),
  currentRecord: z.object({ kind: z.enum(['visit','maternity','new_appointment']), id: label(100) }).nullable().optional(),
  written: z.array(z.object({ field: label(64), op: z.enum(['type','append','replace','fill']), hash: z.string().regex(/^[a-f0-9]{64}$/) })).max(config.maxWrittenEntries).optional(),
  message: z.string().trim().min(1).max(config.maxMessageChars),
  currentPath: z.string().max(200).optional(),
  // The browser's IANA time zone, so filled dates match the user's clock.
  timeZone: z.string().max(64).optional(),
  page: pageSchema.optional(),
  startedAt: z.number().int().nonnegative().optional(),
  mode: z.literal('agent').optional(),
  continuationToken: z.string().max(config.continuationMaxChars).optional(),
  // Follow-up rounds of the same request: which round, and what was done so far.
  round: z.number().int().min(0).max(config.maxRounds).optional(),
  progress: z.array(label(160)).max(40).optional(),

  // Phase 6 Agent Loop state:
  checklist: z.array(checklistItemSchema).max(8).optional(),
  note: label(200).optional(),
  results: z.array(actionResultSchema).max(10).optional(),
  pageHash: label(64).optional(),
});

// What happened to a button press the assistant proposed. Ids and outcomes only.
const assistantEventSchema = z.object({
  page: z.string().max(40),
  button: z.string().max(40),
  outcome: z.enum(['confirmed', 'cancelled', 'done', 'failed']),
  errorCode: z.string().regex(/^[A-Z0-9_]{1,40}$/).optional(),
});

module.exports = { assistantStepSchema, assistantEventSchema };
