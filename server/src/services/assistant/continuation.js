const crypto = require('crypto');
// Only a signing key is retained, never request content. A restart expires tokens.
const key = process.env.ASSISTANT_CONTINUATION_SECRET || crypto.randomBytes(32);
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
function issue(userId, message, state) {
  const body = Buffer.from(JSON.stringify({ ...state, owner: digest(userId), request: digest(message) })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', key).update(body).digest('base64url')}`;
}
function read(token, userId, message) {
  try {
    const [body, mac] = String(token || '').split('.');
    const expected = crypto.createHmac('sha256', key).update(body).digest();
    const supplied = Buffer.from(mac || '', 'base64url');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    const state = JSON.parse(Buffer.from(body, 'base64url').toString());
    return state.owner === digest(userId) && state.request === digest(message) ? state : null;
  } catch { return null; }
}
module.exports = { issue, read, digest };
