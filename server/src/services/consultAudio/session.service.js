/**
 * Consult Audio Session Management Service.
 *
 * Implements business operations for creating sessions, joining via room codes,
 * recording consent, updating device clock/readiness, and starting consultations.
 */

const supabaseAdmin = require('../../config/supabaseAdminClient');
const config = require('../../config/consultAudio.config');
const { generateRoomCode, getRoomCodeExpiry, checkRateLimit, recordFailedAttempt, clearRateLimit } = require('./roomCode.service');
const { signSessionToken } = require('./token.service');
const { STATES, transitionSession } = require('./stateMachine');
const socketService = require('./socket.service');
const logger = require('../../utils/logger');

/**
 * Creates a consultation session for an appointment.
 */
async function createSession({ appointmentId, doctorId, patientRequired = true, languageCode = null }) {
  if (!appointmentId) throw new Error('appointmentId is required');
  if (!doctorId) throw new Error('doctorId is required');

  // Verify appointment access
  const { data: appointment, error: aptErr } = await supabaseAdmin
    .from('appointments')
    .select('id, clinician_id, patient_id')
    .eq('id', appointmentId)
    .single();

  if (aptErr || !appointment) {
    const err = new Error('Appointment not found');
    err.status = 404;
    throw err;
  }

  if (appointment.clinician_id !== doctorId) {
    const err = new Error('Not authorized: clinician does not own this appointment');
    err.status = 403;
    throw err;
  }

  const roomCode = generateRoomCode();
  const roomCodeExpiresAt = getRoomCodeExpiry();

  const { data: session, error: sessErr } = await supabaseAdmin
    .from('consult_sessions')
    .insert({
      appointment_id: appointmentId,
      doctor_id: doctorId,
      patient_id: appointment.patient_id,
      status: STATES.CREATED,
      room_code: roomCode,
      room_code_expires_at: roomCodeExpiresAt,
      patient_required: patientRequired,
      language_code: languageCode,
    })
    .select()
    .single();

  if (sessErr) {
    throw new Error(`Failed to create consult session: ${sessErr.message}`);
  }

  // Register doctor device as joined
  await supabaseAdmin
    .from('session_devices')
    .insert({
      session_id: session.id,
      device: 'doctor',
      status: 'joined',
    });

  // Generate scoped token for doctor device
  const doctorToken = signSessionToken({
    sessionId: session.id,
    device: 'doctor',
    role: 'doctor',
    userId: doctorId,
  });

  return {
    sessionId: session.id,
    roomCode: session.room_code,
    roomCodeExpiresAt: session.room_code_expires_at,
    doctorToken,
    patientRequired: session.patient_required,
  };
}

/**
 * Patient joins a session using a single-use room code.
 */
async function joinSessionByRoomCode({ roomCode, patientUser, clientIp = 'unknown' }) {
  const normCode = (roomCode || '').trim().toUpperCase();
  const rateLimitKey = `${clientIp}:${normCode}`;

  const rateCheck = checkRateLimit(rateLimitKey);
  if (!rateCheck.allowed) {
    const err = new Error(`Too many join attempts. Please wait ${rateCheck.retryAfterSec} seconds.`);
    err.status = 429;
    throw err;
  }

  const { data: session, error: sessErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('*')
    .eq('room_code', normCode)
    .maybeSingle();

  if (sessErr || !session) {
    recordFailedAttempt(rateLimitKey);
    const err = new Error('Invalid or expired room code');
    err.status = 404;
    throw err;
  }

  // Check expiration
  if (new Date(session.room_code_expires_at) < new Date()) {
    recordFailedAttempt(rateLimitKey);
    const err = new Error('Room code has expired');
    err.status = 410;
    throw err;
  }

  // Check state: patient cannot join an already ending/processing/draft_ready session
  if (![STATES.CREATED, STATES.WAITING].includes(session.status)) {
    recordFailedAttempt(rateLimitKey);
    const err = new Error(`Cannot join session in '${session.status}' state`);
    err.status = 409;
    throw err;
  }

  // Burn room code (single-use)
  await supabaseAdmin
    .from('consult_sessions')
    .update({
      room_code: null,
      room_code_expires_at: null,
      patient_id: patientUser.id,
      status: STATES.WAITING,
    })
    .eq('id', session.id);

  clearRateLimit(rateLimitKey);

  // Register patient device
  await supabaseAdmin
    .from('session_devices')
    .upsert({
      session_id: session.id,
      device: 'patient',
      status: 'joined',
    }, { onConflict: 'session_id,device' });

  // Generate scoped token for patient device
  const patientToken = signSessionToken({
    sessionId: session.id,
    device: 'patient',
    role: 'patient',
    userId: patientUser.id,
  });

  socketService.emitSessionState(session.id, {
    sessionId: session.id,
    status: STATES.WAITING,
  });

  return {
    sessionId: session.id,
    patientToken,
  };
}

/**
 * Records doctor or patient consent for a session.
 */
async function recordSessionConsent({ sessionId, role, userId, consentTextVersion }) {
  const version = consentTextVersion || config.consentTextVersion;

  const { data: consent, error } = await supabaseAdmin
    .from('session_consents')
    .upsert({
      session_id: sessionId,
      role,
      user_id: userId,
      consent_text_version: version,
      accepted_at: new Date().toISOString(),
    }, { onConflict: 'session_id,role' })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to record consent: ${error.message}`);
  }

  // Check if session can transition to READY
  await evaluateAndTransitionToReady(sessionId);

  return consent;
}

/**
 * Marks a device ready after mic and level check with its clock handshake results.
 */
async function markDeviceReady({ sessionId, device, offsetMs = 0, rttMs = 0 }) {
  const { data: updatedDevice, error } = await supabaseAdmin
    .from('session_devices')
    .update({
      status: 'ready',
      offset_ms: offsetMs,
      rtt_ms: rttMs,
    })
    .eq('session_id', sessionId)
    .eq('device', device)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to mark device ready: ${error.message}`);
  }

  // Check if session can transition to READY
  await evaluateAndTransitionToReady(sessionId);

  return updatedDevice;
}

/**
 * Checks all conditions (consents + device readiness) and moves session to READY if fulfilled.
 */
async function evaluateAndTransitionToReady(sessionId) {
  const { data: session } = await supabaseAdmin
    .from('consult_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (!session || ![STATES.CREATED, STATES.WAITING].includes(session.status)) {
    return;
  }

  const { data: consents } = await supabaseAdmin
    .from('session_consents')
    .select('*')
    .eq('session_id', sessionId);

  const { data: devices } = await supabaseAdmin
    .from('session_devices')
    .select('*')
    .eq('session_id', sessionId);

  const consentList = Array.isArray(consents) ? consents : (consents ? [consents] : []);
  const deviceList = Array.isArray(devices) ? devices : (devices ? [devices] : []);

  const doctorConsent = consentList.some((c) => c.role === 'doctor');
  const doctorDevice = deviceList.find((d) => d.device === 'doctor');
  const doctorReady = doctorConsent && doctorDevice?.status === 'ready';

  let patientReady = true;
  if (session.patient_required) {
    const patientConsent = consentList.some((c) => c.role === 'patient');
    const patientDevice = deviceList.find((d) => d.device === 'patient');
    patientReady = patientConsent && patientDevice?.status === 'ready';
  }

  if (doctorReady && patientReady) {
    await transitionSession({
      sessionId,
      toState: STATES.READY,
      socketEmitter: socketService,
    });
  }
}

/**
 * Doctor starts the consultation session.
 */
async function startConsultation({ sessionId, doctorUserId }) {
  const { data: session } = await supabaseAdmin
    .from('consult_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (!session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  if (session.doctor_id !== doctorUserId) {
    const err = new Error('Not authorized: only the session doctor can start consultation');
    err.status = 403;
    throw err;
  }

  const nowServerMs = Date.now();
  const startedAt = new Date(nowServerMs).toISOString();

  // Transitions session to RECORDING
  const updatedSession = await transitionSession({
    sessionId,
    toState: STATES.RECORDING,
    patch: { started_at: startedAt },
    socketEmitter: socketService,
  });

  // Emit session_started event with exact server start timestamp
  socketService.emitSessionStarted(sessionId, nowServerMs);

  return updatedSession;
}

/**
 * Device reports monotonic zero clock point after capture start.
 */
async function recordCaptureStarted({ sessionId, device, captureZeroDeviceMs }) {
  const { data, error } = await supabaseAdmin
    .from('session_devices')
    .update({
      status: 'recording',
      capture_zero_device_ms: captureZeroDeviceMs,
    })
    .eq('session_id', sessionId)
    .eq('device', device)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to record capture started: ${error.message}`);
  }

  return data;
}

/**
 * Fetches current session state, devices, and consents.
 */
async function getSessionState(sessionId) {
  const { data: session, error: sErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sErr || !session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  const { data: devices } = await supabaseAdmin
    .from('session_devices')
    .select('*')
    .eq('session_id', sessionId);

  const { data: consents } = await supabaseAdmin
    .from('session_consents')
    .select('role, accepted_at, consent_text_version')
    .eq('session_id', sessionId);

  return {
    session: {
      id: session.id,
      status: session.status,
      patientRequired: session.patient_required,
      languageCode: session.language_code,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      endDeadlineAt: session.end_deadline_at,
    },
    devices: (devices || []).map((d) => ({
      device: d.device,
      status: d.status,
      offsetMs: d.offset_ms,
      rttMs: d.rtt_ms,
    })),
    consents: consents || [],
  };
}

module.exports = {
  createSession,
  joinSessionByRoomCode,
  recordSessionConsent,
  markDeviceReady,
  startConsultation,
  recordCaptureStarted,
  getSessionState,
};
