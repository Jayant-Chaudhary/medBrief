const crypto = require('node:crypto');
const { CommunityError } = require('./database');

function internalAuth(secret) {
  return (req, res, next) => {
    const received = Buffer.from(req.get('X-Community-Service-Key') || '');
    const expected = Buffer.from(secret || '');
    if (expected.length < 32 || received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      return res.status(403).json({ error: 'access_denied' });
    }
    next();
  };
}
function createInternalClient(url, secret) {
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Internal services require HTTPS or loopback');
  }
  return async (path, body) => {
    if (!url || !secret || secret.length < 32) throw new CommunityError(503, 'community_unavailable');
    let response;
    try {
      response = await fetch(new URL(path, url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Community-Service-Key': secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000), redirect: 'error' });
    } catch { throw new CommunityError(503, 'community_unavailable'); }
    if (!response.ok) throw new CommunityError([400,401,403,404,409,422].includes(response.status) ? response.status : 503, 'community_request_failed');
    return response.json();
  };
}
function safeErrors(error, req, res, next) { // eslint-disable-line no-unused-vars
  const status = error instanceof CommunityError ? error.status : error?.name === 'ZodError' ? 400 : 503;
  res.status(status).json({ error: status === 400 ? 'invalid_request' : 'community_unavailable_or_access_denied' });
}
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
module.exports = { internalAuth, createInternalClient, safeErrors, wrap };
