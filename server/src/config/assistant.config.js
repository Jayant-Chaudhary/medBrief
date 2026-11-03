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
  model: env.LLM_MODEL || (provider === 'gemini' ? 'gemini-flash-lite-latest' : 'gemma4:e4b'),
  // Optional planner model: Gemini Flash plans, Flash Lite navigates; empty uses main model.
  plannerModel: env.LLM_PLANNER_MODEL || '',
  // Gemini only: tried once when the main model is busy (503/429) or fails; empty turns it off.
  fallbackModel: env.LLM_FALLBACK_MODEL ?? (provider === 'gemini' ? 'gemini-3.1-flash-lite' : ''),
  // Gemini only: 'low' or 'high' (empty = the model's default). Older 2.5 models do not take it.
  thinkingLevel: env.LLM_THINKING_LEVEL || '',

  // Ollama only: how long the model stays loaded after a request, and the
  // context window. Agent loop prompts + page snapshot + history need ~8k.
  keepAlive: env.LLM_KEEP_ALIVE || '15m',
  numCtx: positiveInteger('LLM_NUM_CTX', 8192),
  // A plan is ~30 tokens per step plus ~15 per filled field; the cap stops a stuck model running on.
  // Gemini counts its thinking against the cap, so it gets more room.
  maxOutputTokens: positiveInteger('LLM_MAX_OUTPUT_TOKENS', provider === 'gemini' ? 2048 : 512),
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

  maxMessageChars: positiveInteger('ASSISTANT_MAX_MESSAGE_CHARS', 600),
  // One request can take several read-and-act rounds, each a request of its own.
  rateLimitPerMinute: positiveInteger('ASSISTANT_RATE_LIMIT_PER_MINUTE', 60),

  // Page reading & agent loop (Phase 6):
  maxPageElements: positiveInteger('ASSISTANT_MAX_PAGE_ELEMENTS', 120),
  maxPageActions: positiveInteger('ASSISTANT_MAX_PAGE_ACTIONS', 8),
  maxRounds: positiveInteger('ASSISTANT_MAX_ROUNDS', 15),
  stallLimit: positiveInteger('ASSISTANT_STALL_LIMIT', 2),
  settleQuietMs: positiveInteger('ASSISTANT_SETTLE_QUIET_MS', 300),
  settleTimeoutMs: positiveInteger('ASSISTANT_SETTLE_TIMEOUT_MS', 3000),
  snapshotTokenBudget: positiveInteger('ASSISTANT_SNAPSHOT_TOKEN_BUDGET', 1500),
  // App-help replies are short and never about health.
  maxAnswerChars: positiveInteger('ASSISTANT_MAX_ANSWER_CHARS', 300),

  // Shown instead of any model-written text. Deliberately gives no health
  // guidance: wording about urgent care needs clinician sign-off first.
  unsupportedMessage:
    env.ASSISTANT_UNSUPPORTED_MESSAGE ||
    "Sorry, I can't do that here. I can open pages and records for you.",
  unavailableMessage:
    env.ASSISTANT_UNAVAILABLE_MESSAGE ||
    'The assistant is not available right now. You can still use the menu.',
};
