/**
 * Scoped Session Token Route Guard.
 *
 * Verifies that the request carries a valid scoped token issued for this
 * consultation session and matches the device/session specified in URL parameters.
 */

const { verifySessionToken } = require('../services/consultAudio/token.service');

function sessionTokenGuard(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid scoped session token header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const claims = verifySessionToken(token);

    // Validate parameter matches if present in path
    if (req.params.id && req.params.id !== claims.sessionId) {
      return res.status(403).json({ error: 'Token is not authorized for this session' });
    }

    if (req.params.device && req.params.device !== claims.device) {
      return res.status(403).json({ error: 'Token is not authorized for this device' });
    }

    req.sessionToken = claims;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired scoped session token' });
  }
}

module.exports = sessionTokenGuard;
