/**
 * Configuration for the in-app assistant (opens pages and records, fills the
 * appointment time; never submits).
 *
 * All tunable values live here and can be overridden by environment
 * variables. The assistant is off unless ASSISTANT_ENABLED=true.
 */

const env = process.env;

function positiveInteger(name, fallback) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid positive integer configuration: ${name}`);
  }
  return value;
}

const provider = (env.LLM_PROVIDER || 'ollama').toLowerCase();

module.exports = {
  enabled: env.ASSISTANT_ENABLED === 'true',
  // Separate switch for pressing buttons that save or send (always after the
  // user confirms). Off: the assistant fills forms and the user presses.
  actionsEnabled: env.ASSISTANT_ACTIONS_ENABLED === 'true',

  // 'ollama' (native API, local), 'gemini' (Google Gemini API),
  // 'openai-compatible' (hosted/vLLM), or 'fake' (tests).
  provider,
  baseUrl: (env.LLM_BASE_URL || (provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:11434/v1')).replace(/\/+$/, ''),
  apiKey: env.LLM_API_KEY || env.GEMINI_API_KEY || '',
  model: env.LLM_MODEL || (provider === 'gemini' ? 'gemini-1.5-flash' : 'gemma4:e4b'),

  // Ollama only: how long the model stays loaded after a request, and the
  // context window. Form controls in the prompt need ~4k; the warm-up uses the
  // same value so the model is not reloaded.
  keepAlive: env.LLM_KEEP_ALIVE || '15m',
  numCtx: positiveInteger('LLM_NUM_CTX', 4096),
  // A plan is ~30 tokens per step plus ~15 per filled field; the cap stops a stuck model running on.
  maxOutputTokens: positiveInteger('LLM_MAX_OUTPUT_TOKENS', 512),
  // Most steps one request may plan (Phase 2a: all read-only).
  maxSteps: positiveInteger('ASSISTANT_MAX_STEPS', 4),
  // Dates the assistant may fill into a form: future only, up to this many days ahead.
  maxBookingDays: positiveInteger('ASSISTANT_MAX_BOOKING_DAYS', 365),
  // Used when the browser does not send a valid time zone.
  defaultTimeZone: env.ASSISTANT_DEFAULT_TIMEZONE || 'Asia/Kolkata',

  // A warm model answers in under a second; a cold one can take ~50 s to load
  // on a 6 GB laptop GPU, so the first request after idle gets longer.
  timeoutMs: positiveInteger('ASSISTANT_TIMEOUT_MS', 15000),
  coldStartTimeoutMs: positiveInteger('ASSISTANT_COLD_START_TIMEOUT_MS', 90000),
  warmWindowMs: positiveInteger('ASSISTANT_WARM_WINDOW_MS', 10 * 60 * 1000),

  maxMessageChars: positiveInteger('ASSISTANT_MAX_MESSAGE_CHARS', 300),
  rateLimitPerMinute: positiveInteger('ASSISTANT_RATE_LIMIT_PER_MINUTE', 20),

  // Shown instead of any model-written text. Deliberately gives no health
  // guidance: wording about urgent care needs clinician sign-off first.
  unsupportedMessage:
    env.ASSISTANT_UNSUPPORTED_MESSAGE ||
    "Sorry, I can't do that here. I can open pages and records for you.",
  unavailableMessage:
    env.ASSISTANT_UNAVAILABLE_MESSAGE ||
    'The assistant is not available right now. You can still use the menu.',
};
