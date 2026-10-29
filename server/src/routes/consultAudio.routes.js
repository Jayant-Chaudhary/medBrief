/**
 * Consultation Audio Routes.
 * Mounted on:
 *   /api/consults
 *   /api/time
 */

const express = require('express');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const sessionTokenGuard = require('../middleware/sessionTokenGuard');
const controller = require('../controllers/consultAudio.controller');
const { verifySessionToken } = require('../services/consultAudio/token.service');

const consultRouter = express.Router();
const timeRouter = express.Router();

/**
 * Flexible guard for reading session state:
 * Accepts either standard Supabase bearer token OR scoped session token.
 */
async function flexibleSessionAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  // Try scoped token first
  try {
    const claims = verifySessionToken(token);
    if (req.params.id && req.params.id !== claims.sessionId) {
      return res.status(403).json({ error: 'Token is not authorized for this session' });
    }
    req.sessionToken = claims;
    return next();
  } catch (scopedErr) {
    // If not scoped token, fall back to standard authGuard
    return authGuard(req, res, next);
  }
}

const config = require('../config/consultAudio.config');

const rawAudioParser = express.raw({
  type: ['audio/*', 'application/octet-stream'],
  limit: config.chunkMaxBytes,
});

// Clock handshake endpoint
timeRouter.get('/', controller.getServerTime);

// Consultation session endpoints
consultRouter.post('/', authGuard, roleGuard('clinician'), controller.createSession);
consultRouter.post('/join', authGuard, roleGuard('patient'), controller.joinSession);
consultRouter.post('/:id/consent', sessionTokenGuard, controller.recordConsent);
consultRouter.post('/:id/devices/:device/ready', sessionTokenGuard, controller.markDeviceReady);
consultRouter.post('/:id/start', authGuard, roleGuard('clinician'), controller.startConsultation);
consultRouter.post('/:id/devices/:device/capture-started', sessionTokenGuard, controller.recordCaptureStarted);
consultRouter.post('/:id/chunks', sessionTokenGuard, rawAudioParser, controller.uploadChunk);
consultRouter.post('/:id/devices/:device/final', sessionTokenGuard, controller.recordFinalMarker);
consultRouter.get('/:id/state', flexibleSessionAuth, controller.getSessionState);

module.exports = {
  consultRouter,
  timeRouter,
};
