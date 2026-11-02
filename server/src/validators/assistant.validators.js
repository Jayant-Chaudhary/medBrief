const { z } = require('zod');
const config = require('../config/assistant.config');

const assistantStepSchema = z.object({
  message: z.string().trim().min(1).max(config.maxMessageChars),
  currentPath: z.string().max(200).optional(),
  // The browser's IANA time zone, so filled dates match the user's clock.
  timeZone: z.string().max(64).optional(),
});

// What happened to a button press the assistant proposed. Ids and outcomes only.
const assistantEventSchema = z.object({
  page: z.string().max(40),
  button: z.string().max(40),
  outcome: z.enum(['confirmed', 'cancelled', 'done', 'failed']),
  errorCode: z.string().regex(/^[A-Z0-9_]{1,40}$/).optional(),
});

module.exports = { assistantStepSchema, assistantEventSchema };
