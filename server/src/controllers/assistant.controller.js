const config = require('../config/assistant.config');
const assistant = require('../services/assistant/assistant.service');
const { createRateLimiter } = require('../services/assistant/rateLimit');
const { findButton } = require('../services/assistant/controls.registry');
const log = require('../utils/logger').child({ scope: 'assistant' });

const allow = createRateLimiter({ limit: config.rateLimitPerMinute });

function rateLimited(req, res) {
  if (allow(req.user.id)) return false;
  res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  return true;
}

/** One typed request -> navigate, clarify, unsupported or unavailable. Never logs the message. */
async function step(req, res, next) {
  try {
    if (rateLimited(req, res)) return;
    const started = Date.now();
    const result = await assistant.handleStep({
      message: req.validated.message,
      role: req.user.role,
      userId: req.user.id,
      timeZone: req.validated.timeZone,
      // Path only (the client sends no query string), so the open form can be filled.
      currentPath: req.validated.currentPath,
    });
    const { attempts, errorCode, source, ...reply } = result;

    log.info('assistant step', {
      reqId: req.id,
      role: req.user.role,
      outcome: reply.type,
      source,
      path: reply.path,
      steps: reply.steps?.length,
      filled: reply.steps?.reduce((n, s) => n + Object.keys(s.fill?.fields || {}).length, 0) || undefined,
      skipped: reply.steps?.reduce((n, s) => n + (s.skipped?.length || 0), 0) || undefined,
      press: reply.steps?.find((s) => s.press)?.press.id,
      choices: reply.options?.length,
      attempts,
      errorCode,
      durationMs: Date.now() - started,
    });
    res.json({ ...reply, source });
  } catch (err) {
    next(err);
  }
}

/**
 * The panel reports what happened to a button press it proposed (confirmed,
 * cancelled, done, failed). This is the action log: one line, ids and outcome
 * only, never values, names or patient ids.
 */
function event(req, res) {
  if (rateLimited(req, res)) return;
  const { page, button, outcome, errorCode } = req.validated;
  const known = findButton(req.user.role, page, button);
  if (!known || known.effect === 'ui') return res.status(400).json({ error: 'Unknown assistant action' });
  log.info('assistant action', { reqId: req.id, userId: req.user.id, role: req.user.role, page, button, effect: known.effect, outcome, errorCode });
  return res.status(204).end();
}

/** Loads the model when the panel opens. Answers at once; loading continues in the background. */
function warm(req, res) {
  if (rateLimited(req, res)) return;
  assistant.warmUp().catch((err) => log.warn('assistant warm-up failed', { reqId: req.id, errorCode: err.code || 'ERROR' }));
  res.status(202).json({ warming: true });
}

module.exports = { step, warm, event };
