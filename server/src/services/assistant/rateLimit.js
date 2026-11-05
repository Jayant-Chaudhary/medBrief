/**
 * In-memory, per-user sliding-window limiter. Fine for a single API process;
 * a multi-instance deployment would move this to Redis.
 */

function createRateLimiter({ limit, windowMs = 60 * 1000, now = () => Date.now() }) {
  const hits = new Map();

  return function allow(key) {
    const current = now();
    const recent = (hits.get(key) || []).filter((time) => current - time < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(current);
    hits.set(key, recent);
    return true;
  };
}

module.exports = { createRateLimiter };
