/**
 * Consult Audio HTTP Controller.
 *
 * Implements endpoints for consultation sessions, pairing, device clock sync,
 * consent registration, readiness, and start triggers.
 */

const sessionService = require('../services/consultAudio/session.service');
const chunkIngestService = require('../services/consultAudio/chunkIngest.service');
const { verifySessionToken } = require('../services/consultAudio/token.service');
const logger = require('../utils/logger');

/**
 * POST /api/consults
 * Doctor creates a session for an appointment.
 */
async function createSession(req, res, next) {
  try {
    const { appointmentId, patientRequired = true, languageCode = null } = req.body;
    if (!appointmentId) {
      return res.status(400).json({ error: 'appointmentId is required' });
    }

    const doctorId = req.user.id;
    const result = await sessionService.createSession({
      appointmentId,
      doctorId,
      patientRequired: patientRequired !== false,
      languageCode,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/consults/join
 * Patient joins a session using a single-use room code.
 */
async function joinSession(req, res, next) {
  try {
    const { roomCode } = req.body;
    if (!roomCode) {
      return res.status(400).json({ error: 'roomCode is required' });
    }

    const patientUser = req.user;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    const result = await sessionService.joinSessionByRoomCode({
      roomCode,
      patientUser,
      clientIp,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/consults/:id/consent
 * Caller records consent for their role.
 */
async function recordConsent(req, res, next) {
  try {
    const sessionId = req.params.id;
    const { consentTextVersion } = req.body;
    const { role, userId } = req.sessionToken;

    const consent = await sessionService.recordSessionConsent({
      sessionId,
      role,
      userId,
      consentTextVersion,
    });

    res.status(200).json({ ok: true, consent });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/time
 * Clock handshake for device clock offset estimation.
 */
function getServerTime(req, res) {
  res.status(200).json({
    serverTimeMs: Date.now(),
  });
}

/**
 * POST /api/consults/:id/devices/:device/ready
 * Device marks readiness after mic and level check.
 */
async function markDeviceReady(req, res, next) {
  try {
    const { id: sessionId, device } = req.params;
    const { offset_ms = 0, rtt_ms = 0 } = req.body;

    const updatedDevice = await sessionService.markDeviceReady({
      sessionId,
      device,
      offsetMs: Number(offset_ms) || 0,
      rttMs: Number(rtt_ms) || 0,
    });

    res.status(200).json({ ok: true, device: updatedDevice });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/consults/:id/start
 * Doctor triggers recording start once readiness is established.
 */
async function startConsultation(req, res, next) {
  try {
    const sessionId = req.params.id;
    const doctorUserId = req.user.id;

    const session = await sessionService.startConsultation({
      sessionId,
      doctorUserId,
    });

    res.status(200).json({ ok: true, session });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/consults/:id/devices/:device/capture-started
 * Device reports monotonic zero clock point upon audio capture start.
 */
async function recordCaptureStarted(req, res, next) {
  try {
    const { id: sessionId, device } = req.params;
    const { capture_zero_device_ms } = req.body;

    if (capture_zero_device_ms === undefined || capture_zero_device_ms === null) {
      return res.status(400).json({ error: 'capture_zero_device_ms is required' });
    }

    const updatedDevice = await sessionService.recordCaptureStarted({
      sessionId,
      device,
      captureZeroDeviceMs: Number(capture_zero_device_ms),
    });

    res.status(200).json({ ok: true, device: updatedDevice });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/consults/:id/state
 * Fetches current session state, devices, and consents.
 */
async function getSessionState(req, res, next) {
  try {
    const sessionId = req.params.id;
    const state = await sessionService.getSessionState(sessionId);
    res.status(200).json(state);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/consults/:id/chunks
 * Device streams audio chunk with metadata headers.
 */
async function uploadChunk(req, res, next) {
  try {
    const sessionId = req.params.id;
    const deviceHeader = req.headers['x-device'];
    const tokenDevice = req.sessionToken?.device;

    if (!deviceHeader || deviceHeader !== tokenDevice) {
      return res.status(403).json({ error: 'x-device header does not match scoped session token' });
    }

    const seq = req.headers['x-seq'];
    const startMs = req.headers['x-start-ms'];
    const durationMs = req.headers['x-duration-ms'];
    const avgDbfs = req.headers['x-avg-dbfs'];
    const codec = req.headers['x-codec'] || req.headers['content-type'] || 'audio/wav';
    const isSilent = req.headers['x-silent'] === 'true';

    const audioBuffer = req.body && Buffer.isBuffer(req.body) ? req.body : null;

    const result = await chunkIngestService.ingestChunk({
      sessionId,
      device: tokenDevice,
      seq,
      startMs,
      durationMs,
      avgDbfs,
      codec,
      isSilent,
      audioBuffer,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/consults/:id/devices/:device/final
 * Device reports total chunks uploaded (final marker).
 */
async function recordFinalMarker(req, res, next) {
  try {
    const { id: sessionId, device } = req.params;
    const { total_chunks } = req.body;

    if (total_chunks === undefined || total_chunks === null) {
      return res.status(400).json({ error: 'total_chunks is required' });
    }

    const result = await chunkIngestService.recordDeviceFinalMarker({
      sessionId,
      device,
      totalChunks: total_chunks,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSession,
  joinSession,
  recordConsent,
  getServerTime,
  markDeviceReady,
  startConsultation,
  recordCaptureStarted,
  getSessionState,
  uploadChunk,
  recordFinalMarker,
};
