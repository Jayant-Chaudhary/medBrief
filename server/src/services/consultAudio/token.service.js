/**
 * Scoped Session Token Service.
 *
 * Issues and validates signed, short-lived tokens containing session_id,
 * device ('doctor'|'patient'), role, and user_id. Device endpoints and
 * Socket.IO authenticate solely with this scoped token.
 */

const jwt = require('jsonwebtoken');
const config = require('../../config/consultAudio.config');

const TOKEN_TYPE = 'consult_device_token';

/**
 * Signs a scoped session token for a device in a consultation session.
 */
function signSessionToken({ sessionId, device, role, userId }) {
  if (!sessionId || !device || !role || !userId) {
    throw new Error('Missing required claims to sign session token');
  }

  const payload = {
    sessionId,
    device,
    role,
    userId,
    type: TOKEN_TYPE,
  };

  return jwt.sign(payload, config.sessionTokenSecret, {
    expiresIn: config.sessionTokenTtlSec,
  });
}

/**
 * Verifies a scoped session token. Throws or returns decoded payload.
 */
function verifySessionToken(token) {
  if (!token) {
    throw new Error('Token is required');
  }

  const decoded = jwt.verify(token, config.sessionTokenSecret);
  if (decoded.type !== TOKEN_TYPE) {
    throw new Error('Invalid token type');
  }

  return {
    sessionId: decoded.sessionId,
    device: decoded.device,
    role: decoded.role,
    userId: decoded.userId,
  };
}

module.exports = {
  signSessionToken,
  verifySessionToken,
  TOKEN_TYPE,
};
