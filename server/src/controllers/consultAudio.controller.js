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
    const appointmentId = req.body.appointmentId || req.body.appointment_id;
    const patientRequired = req.body.patientRequired !== undefined
      ? req.body.patientRequired
      : (req.body.patient_required !== undefined ? req.body.patient_required : true);
    const languageCode = req.body.languageCode || req.body.language_code || null;

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
    const roomCode = req.body.roomCode || req.body.room_code;
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
    const consentTextVersion = req.body.consentTextVersion || req.body.consent_text_version;
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
  const now = Date.now();
  res.status(200).json({
    serverTimeMs: now,
    server_time_ms: now,
  });
}

/**
 * POST /api/consults/:id/devices/:device/ready
 * Device marks readiness after mic and level check.
 */
async function markDeviceReady(req, res, next) {
  try {
    const { id: sessionId, device } = req.params;
    const offset = req.body.offset_ms !== undefined ? req.body.offset_ms : req.body.offsetMs;
    const rtt = req.body.rtt_ms !== undefined ? req.body.rtt_ms : req.body.rttMs;

    const updatedDevice = await sessionService.markDeviceReady({
      sessionId,
      device,
      offsetMs: Number(offset) || 0,
      rttMs: Number(rtt) || 0,
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
    const doctorUserId = req.user?.id || req.sessionToken?.userId;

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
 * POST /api/consults/:id/end
 * Doctor signals end of consultation, transitioning to ENDING.
 */
async function endConsultation(req, res, next) {
  try {
    const sessionId = req.params.id;
    const doctorUserId = req.user?.id || req.sessionToken?.userId;

    const session = await sessionService.endConsultation({
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
    const captureZero = req.body.capture_zero_device_ms !== undefined
      ? req.body.capture_zero_device_ms
      : req.body.captureZeroDeviceMs;

    if (captureZero === undefined || captureZero === null) {
      return res.status(400).json({ error: 'capture_zero_device_ms is required' });
    }

    const updatedDevice = await sessionService.recordCaptureStarted({
      sessionId,
      device,
      captureZeroDeviceMs: Number(captureZero),
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
 * GET /api/consults/:id/transcript
 * Returns ordered transcript segments for a consultation.
 */
async function getTranscript(req, res, next) {
  try {
    const sessionId = req.params.id;
    const doctorUserId = req.user?.id || req.sessionToken?.userId;
    const result = await sessionService.getSessionTranscript(sessionId, doctorUserId);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/consults/:id/chunks
 * Device streams audio chunk with metadata headers (or query fallbacks).
 */
async function uploadChunk(req, res, next) {
  try {
    const sessionId = req.params.id;
    const tokenDevice = req.sessionToken?.device;
    const deviceHeader = req.headers['x-device'] || req.query.device || tokenDevice;

    if (!deviceHeader || deviceHeader !== tokenDevice) {
      return res.status(403).json({ error: 'x-device header does not match scoped session token' });
    }

    const seq = req.headers['x-seq'] !== undefined ? req.headers['x-seq'] : req.query.seq;
    const startMs = req.headers['x-start-ms'] !== undefined ? req.headers['x-start-ms'] : (req.query.start_ms || req.query.startMs);
    const durationMs = req.headers['x-duration-ms'] !== undefined ? req.headers['x-duration-ms'] : (req.query.duration_ms || req.query.durationMs);
    const avgDbfs = req.headers['x-avg-dbfs'] !== undefined ? req.headers['x-avg-dbfs'] : (req.query.avg_dbfs || req.query.avgDbfs);
    const codec = req.headers['x-codec'] || req.query.codec || req.headers['content-type'] || 'audio/wav';
    const isSilent = req.headers['x-silent'] !== undefined ? (req.headers['x-silent'] === 'true') : (req.query.is_silent === 'true' || req.query.isSilent === 'true');

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
    const totalChunks = req.body.total_chunks !== undefined ? req.body.total_chunks : req.body.totalChunks;

    if (totalChunks === undefined || totalChunks === null) {
      return res.status(400).json({ error: 'total_chunks is required' });
    }

    const result = await chunkIngestService.recordDeviceFinalMarker({
      sessionId,
      device,
      totalChunks: Number(totalChunks),
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/consults/by-appointment/:appointmentId
 * Returns latest consultation session for an appointment.
 */
async function getSessionByAppointment(req, res, next) {
  try {
    const { appointmentId } = req.params;
    const doctorUserId = req.user?.id || req.sessionToken?.userId;
    const result = await sessionService.getLatestSessionByAppointment(appointmentId, doctorUserId);
    res.status(200).json({ ok: true, session: result });
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
  endConsultation,
  recordCaptureStarted,
  getSessionState,
  getTranscript,
  getSessionByAppointment,
  uploadChunk,
  recordFinalMarker,
};
