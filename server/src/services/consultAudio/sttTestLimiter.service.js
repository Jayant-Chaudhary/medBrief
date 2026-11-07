/**
 * Per-user limit on the pre-consultation STT test, which sends audio to the
 * paid speech-to-text provider. In memory, fixed window: enough to stop one
 * account burning provider credit, not a distributed limiter.
 */

const config = require('../../config/consultAudio.config');

const usage = new Map(); // userId -> { count, resetAt }

function takeSttTestSlot(userId, now = Date.now()) {
  let entry = usage.get(userId);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + config.sttTestWindowMs };
    usage.set(userId, entry);
  }

  if (entry.count >= config.sttTestMaxPerWindow) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { allowed: true };
}

function resetSttTestLimits() {
  usage.clear();
}

module.exports = { takeSttTestSlot, resetSttTestLimits };
