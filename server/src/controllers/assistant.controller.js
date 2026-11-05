const config = require('../config/assistant.config');
const assistant = require('../services/assistant/assistant.service');
const { createRateLimiter } = require('../services/assistant/rateLimit');
const { findButton } = require('../services/assistant/controls.registry');
const log = require('../utils/logger').child({ scope: 'assistant' });
const continuation = require('../services/assistant/continuation');

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
      // The open page's labels and what this request already did; never logged.
      page: req.validated.page,
      round: req.validated.round,
      progress: req.validated.progress,
      startedAt: req.validated.startedAt,
      originRecord: req.validated.originRecord,
      currentRecord: req.validated.currentRecord,
      patientChoice: req.validated.patientChoice,
      written: req.validated.written,
      memory: req.validated.memory,
      mode: req.validated.mode,
      continuationToken: req.validated.continuationToken,
      acknowledgeOnly: req.validated.acknowledgeOnly,
      checklist: req.validated.checklist,
      note: req.validated.note,
      results: req.validated.results,
      pageHash: req.validated.pageHash,
      settings: config,
    });
    const { attempts, errorCode, source, ...reply } = result;
    const pageSteps = (reply.steps || []).filter((s) => s.page);
    const allRefused = pageSteps.flatMap((s) => s.page.refused || []);
    if (allRefused.length > 0) {
      log.warn('assistant actions refused', { reqId: req.id, refusedCount: allRefused.length });
    }

    log.info('assistant step', {
      reqId: req.id,
      role: req.user.role,
      outcome: reply.type,
      source,

      steps: reply.steps?.length,
      filled: reply.steps?.reduce((n, s) => n + Object.keys(s.fill?.fields || {}).length, 0) || undefined,
      skipped: reply.steps?.reduce((n, s) => n + (s.skipped?.length || 0), 0) || undefined,
      press: reply.steps?.find((s) => s.press)?.press.id,
      pageElements: req.validated.page?.elements?.length,
      pageActions: pageSteps.reduce((n, s) => n + s.page.actions.length, 0) || undefined,
      refused: pageSteps.reduce((n, s) => n + s.page.refused.length, 0) || undefined,
      round: req.validated.round,
      checklistItems: reply.checklist?.length || undefined,
      continues: reply.continue || undefined,
      choices: reply.options?.length,
      attempts,
      errorCode,
      durationMs: Date.now() - started,
    });
    const state = continuation.read(req.validated.continuationToken || req.validated.patientChoice?.token, req.user.id, req.validated.message);
    const requestStart = Math.min(state?.startedAt ?? req.validated.startedAt ?? started, started);
    const executionMetadata = req.validated.includeExecutionMetadata ? {
      expiresAt: requestStart + config.requestTimeoutMs,
      uiTiming: { settleQuietMs: config.settleQuietMs, settleTimeoutMs: config.settleTimeoutMs, progressPauseMs: config.progressPauseMs },
    } : {};
    res.json({ ...reply, source, ...executionMetadata });
  } catch (err) {
    log.warn('assistant failed', { reqId: req.id, errorCode: 'ASSISTANT_FAILED' });
    next(Object.assign(new Error('Assistant request failed'), { status: 500, code: 'ASSISTANT_FAILED' }));
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
  // A confirmed action on a button the assistant read from the page (doctors only, Phase 5).
  const pageAction = button === 'page_action' && req.user.role === 'clinician' && /^[a-z_]{1,40}$/.test(page);
  const known = pageAction ? { effect: 'confirm' } : findButton(req.user.role, page, button);
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
