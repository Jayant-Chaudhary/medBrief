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
const { STATES, transitionSession, activePatientDevice, patientParticipates } = require('./stateMachine');
const socketService = require('./socket.service');
const orchestratorService = require('./orchestrator.service');
const { mergeSegments } = require('./mergeSegments');
const logger = require('../../utils/logger');

/**
 * Creates a consultation session for an appointment.
 */
/** States in which a session has not started recording and can still be (re)opened. */
const OPEN_STATES = [STATES.CREATED, STATES.WAITING, STATES.READY];

const asList = (rows) => (Array.isArray(rows) ? rows : (rows ? [rows] : []));

function doctorSessionPayload(session, doctorToken, { reused = false, devices = [] } = {}) {
  const patient = activePatientDevice(devices);
  return {
    sessionId: session.id,
    session_id: session.id,
    id: session.id,
    status: session.status,
    reused,
    roomCode: session.room_code,
    room_code: session.room_code,
    roomCodeExpiresAt: session.room_code_expires_at,
    expires_at: session.room_code_expires_at,
    doctorToken,
    doctor_token: doctorToken,
    token: doctorToken,
    patientRequired: session.patient_required,
    patient_required: session.patient_required,
    patientJoined: Boolean(patient),
    patientReady: patient?.status === 'ready',
  };
}

/** A fresh room code for an open session nobody is using it to join. */
async function refreshRoomCode(session) {
  const roomCode = generateRoomCode();
  const roomCodeExpiresAt = getRoomCodeExpiry();
  const { data: updated, error } = await supabaseAdmin
    .from('consult_sessions')
    .update({ room_code: roomCode, room_code_expires_at: roomCodeExpiresAt })
    .eq('id', session.id)
    .select()
    .single();
  if (error) throw new Error(`Failed to refresh room code: ${error.message}`);
  return { ...session, ...(updated || {}), room_code: roomCode, room_code_expires_at: roomCodeExpiresAt };
}

/**
 * Creates a consultation session for an appointment, or reopens the doctor's
 * session for it that has not started recording yet. Reopening means closing
 * and reopening the dialog keeps one room: the patient who already joined stays
 * joined, and finished visits are never buried under empty new sessions.
 *
 * When forceNew is true, any unstarted open session is cancelled and a fresh
 * session is created so the doctor can record again.
 */
async function createSession({ appointmentId, doctorId, patientRequired = false, languageCode = null, forceNew = false }) {
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

  if (forceNew) {
    // When forcing a new session, cancel any lingering unstarted sessions for this appointment
    await supabaseAdmin
      .from('consult_sessions')
      .update({ status: STATES.CANCELLED })
      .eq('appointment_id', appointmentId)
      .eq('doctor_id', doctorId)
      .in('status', OPEN_STATES);
  } else {
    const { data: openSession } = await supabaseAdmin
      .from('consult_sessions')
      .select('*')
      .eq('appointment_id', appointmentId)
      .eq('doctor_id', doctorId)
      .in('status', OPEN_STATES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openSession && OPEN_STATES.includes(openSession.status)) {
      const { data: devices } = await supabaseAdmin
        .from('session_devices')
        .select('device, status')
        .eq('session_id', openSession.id);
      const deviceList = asList(devices);

      let session = openSession;

      // If reopening a session where patient is optional (default for doctor),
      // update existing session's patient_required so the doctor can record alone.
      if (!patientRequired && session.patient_required) {
        await supabaseAdmin
          .from('consult_sessions')
          .update({ patient_required: false })
          .eq('id', session.id);
        session = { ...session, patient_required: false };
      }

      const codeExpired = !session.room_code
        || (session.room_code_expires_at && new Date(session.room_code_expires_at) < new Date());
      if (codeExpired && !activePatientDevice(deviceList)) {
        session = await refreshRoomCode(session);
      }

      const doctorToken = signSessionToken({
        sessionId: session.id,
        device: 'doctor',
        role: 'doctor',
        userId: doctorId,
      });
      logger.info('Reopened consult session', { scope: 'consult-audio', sessionId: session.id, status: session.status });
      return doctorSessionPayload(session, doctorToken, { reused: true, devices: deviceList });
    }
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

  return doctorSessionPayload(session, doctorToken);
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

  // Check state: patients join only before recording starts. A doctor who is
  // already ready (READY) does not lock the patient out.
  if (!OPEN_STATES.includes(session.status)) {
    recordFailedAttempt(rateLimitKey);
    const err = new Error(`Cannot join session in '${session.status}' state`);
    err.status = 409;
    throw err;
  }

  // Check patient ownership: if session has a designated patient, caller must match
  if (session.patient_id && session.patient_id !== patientUser.id) {
    recordFailedAttempt(rateLimitKey);
    const err = new Error('Not authorized: signed-in patient does not match this consultation');
    err.status = 403;
    throw err;
  }

  // Burn room code conditionally (single-use, race-free)
  const { data: updatedSession, error: updateErr } = await supabaseAdmin
    .from('consult_sessions')
    .update({
      room_code: null,
      room_code_expires_at: null,
      patient_id: patientUser.id,
      status: session.status === STATES.CREATED ? STATES.WAITING : session.status,
    })
    .eq('id', session.id)
    .eq('room_code', normCode)
    .in('status', OPEN_STATES)
    .select('id, status')
    .maybeSingle();

  if (updateErr || !updatedSession) {
    recordFailedAttempt(rateLimitKey);
    const err = new Error('Room code has already been consumed');
    err.status = 409;
    throw err;
  }

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
    status: updatedSession.status || STATES.WAITING,
  });
  socketService.emitDeviceEvent(session.id, 'device_joined', 'patient');

  return {
    sessionId: session.id,
    session_id: session.id,
    id: session.id,
    patientToken,
    patient_token: patientToken,
    token: patientToken,
  };
}

/**
 * Records doctor or patient consent for a session.
 */
/**
 * A patient may only act in a room they are still in, before recording starts.
 * Stops a patient who left (or was dropped when the doctor started alone) from
 * reviving their device with an old token.
 */
async function assertPatientStillInRoom(sessionId) {
  const { data: session } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .single();
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (!OPEN_STATES.includes(session.status)) {
    throw Object.assign(new Error('This consultation has already started or ended'), {
      status: 409,
      code: 'ERR_SESSION_NOT_OPEN',
    });
  }
  const { data: device } = await supabaseAdmin
    .from('session_devices')
    .select('status')
    .eq('session_id', sessionId)
    .eq('device', 'patient')
    .maybeSingle();
  if (!device || device.status === 'gone') {
    throw Object.assign(new Error('You are no longer in this consultation room. Join again with a new code.'), {
      status: 409,
      code: 'ERR_NOT_IN_ROOM',
    });
  }
}

async function recordSessionConsent({ sessionId, role, userId, consentTextVersion }) {
  const version = consentTextVersion || config.consentTextVersion;
  if (role === 'patient') await assertPatientStillInRoom(sessionId);

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
  if (device === 'patient') {
    await assertPatientStillInRoom(sessionId);
  } else {
    const { data: session } = await supabaseAdmin
      .from('consult_sessions')
      .select('id, status')
      .eq('id', sessionId)
      .single();
    if (session && !OPEN_STATES.includes(session.status)) {
      throw Object.assign(new Error('This consultation has already started or ended'), {
        status: 409,
        code: 'ERR_SESSION_NOT_OPEN',
      });
    }
  }

  const { data: updatedDevice, error } = await supabaseAdmin
    .from('session_devices')
    .upsert({
      session_id: sessionId,
      device,
      status: 'ready',
      offset_ms: offsetMs,
      rtt_ms: rttMs,
    }, { onConflict: 'session_id,device' })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to mark device ready: ${error.message}`);
  }

  socketService.emitDeviceEvent(sessionId, 'device_ready', device);

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

  // The doctor never waits for a patient unless the session requires one.
  const patientReady = session.patient_required
    ? patientParticipates(consentList, deviceList)
    : true;

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

  if (doctorUserId && session.doctor_id !== doctorUserId) {
    const err = new Error('Not authorized: only the session doctor can start consultation');
    err.status = 403;
    throw err;
  }

  // Ensure solo doctor can start if patient has not joined or is not ready
  const [{ data: initialConsents }, { data: initialDevices }] = await Promise.all([
    supabaseAdmin.from('session_consents').select('role').eq('session_id', sessionId),
    supabaseAdmin.from('session_devices').select('device, status').eq('session_id', sessionId),
  ]);
  const consentList = asList(initialConsents);
  const deviceList = asList(initialDevices);
  const patientJoinedAndReady = patientParticipates(consentList, deviceList);

  if (!patientJoinedAndReady) {
    if (session.patient_required) {
      await supabaseAdmin
        .from('consult_sessions')
        .update({ patient_required: false })
        .eq('id', sessionId);
      session.patient_required = false;
    }

    if (activePatientDevice(deviceList)) {
      await supabaseAdmin
        .from('session_devices')
        .update({ status: 'gone' })
        .eq('session_id', sessionId)
        .eq('device', 'patient');
      socketService.emitDeviceEvent(sessionId, 'device_left', 'patient');
      logger.info('Starting without unready patient device', { scope: 'consult-audio', sessionId });
    }
  }

  // If session is still in CREATED or WAITING, evaluate if it can transition to READY first
  if ([STATES.CREATED, STATES.WAITING].includes(session.status)) {
    await evaluateAndTransitionToReady(sessionId);
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
 * Doctor requests a fresh room code for an open session.
 */
async function refreshSessionRoomCode({ sessionId, doctorUserId }) {
  const { data: session, error } = await supabaseAdmin
    .from('consult_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error || !session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  if (doctorUserId && session.doctor_id !== doctorUserId) {
    const err = new Error('Not authorized: only the session doctor can refresh room code');
    err.status = 403;
    throw err;
  }

  if (!OPEN_STATES.includes(session.status)) {
    const err = new Error(`Cannot refresh room code for session in state '${session.status}'`);
    err.status = 409;
    throw err;
  }

  const refreshed = await refreshRoomCode(session);

  return {
    sessionId: refreshed.id,
    session_id: refreshed.id,
    id: refreshed.id,
    roomCode: refreshed.room_code,
    room_code: refreshed.room_code,
    roomCodeExpiresAt: refreshed.room_code_expires_at,
    expires_at: refreshed.room_code_expires_at,
    status: refreshed.status,
  };
}

/**
 * Patient leaves the room before recording starts.
 *
 * Their device is marked gone and their consent withdrawn, so the doctor is
 * not left waiting on them and recording never uses that consent. The room
 * gets a new single-use code, so the patient (or the right patient, if the
 * wrong one joined) can come back in.
 */
async function leaveSession({ sessionId, userId }) {
  const { data: session } = await supabaseAdmin
    .from('consult_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (userId && session.patient_id && session.patient_id !== userId) {
    throw Object.assign(new Error('Not authorized for this consultation'), { status: 403 });
  }
  if (!OPEN_STATES.includes(session.status)) {
    throw Object.assign(new Error('This consultation has already started or ended'), {
      status: 409,
      code: 'ERR_SESSION_NOT_OPEN',
    });
  }

  await supabaseAdmin
    .from('session_devices')
    .update({ status: 'gone' })
    .eq('session_id', sessionId)
    .eq('device', 'patient');
  await supabaseAdmin
    .from('session_consents')
    .delete()
    .eq('session_id', sessionId)
    .eq('role', 'patient');

  const roomPatch = { room_code: generateRoomCode(), room_code_expires_at: getRoomCodeExpiry() };
  if (session.status === STATES.WAITING) {
    // Nobody is in the room but the doctor any more.
    await transitionSession({ sessionId, toState: STATES.CREATED, patch: roomPatch, socketEmitter: socketService });
  } else {
    await supabaseAdmin.from('consult_sessions').update(roomPatch).eq('id', sessionId);
  }

  socketService.emitDeviceEvent(sessionId, 'device_left', 'patient');
  logger.info('Patient left consult room', { scope: 'consult-audio', sessionId });
  return { ok: true };
}

/**
 * Doctor requests end of the consultation session.
 * Moves state from RECORDING -> ENDING, stores end_deadline_at, and emits end_requested push event.
 */
async function endConsultation({ sessionId, doctorUserId }) {
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

  if (doctorUserId && session.doctor_id !== doctorUserId) {
    const err = new Error('Not authorized: only the session doctor can end consultation');
    err.status = 403;
    throw err;
  }

  const deadlineMs = Date.now() + (config.endDeadlineSec * 1000);
  const endDeadlineAt = new Date(deadlineMs).toISOString();

  const updatedSession = await transitionSession({
    sessionId,
    toState: STATES.ENDING,
    patch: { end_deadline_at: endDeadlineAt },
    socketEmitter: socketService,
  });

  socketService.emitEndRequested(sessionId, endDeadlineAt);
  orchestratorService.registerEndingSession(sessionId, endDeadlineAt);

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
async function getSessionState(sessionId, callerUserId) {
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

  if (!callerUserId || ![session.doctor_id, session.patient_id].includes(callerUserId)) {
    throw Object.assign(new Error('Not authorized for this consultation'), { status: 403 });
  }

  const { data: devices } = await supabaseAdmin
    .from('session_devices')
    .select('*')
    .eq('session_id', sessionId);

  const { data: consents } = await supabaseAdmin
    .from('session_consents')
    .select('role, accepted_at, consent_text_version')
    .eq('session_id', sessionId);

  const { data: gaps, error: gapError } = await supabaseAdmin
    .from('consult_audio_gaps')
    .select('device, gap_id, start_ms, duration_ms, reason_code')
    .eq('session_id', sessionId);
  if (gapError) throw Object.assign(new Error('ERR_GAP_READ'), { status: 503 });

  // Only the doctor's own view carries the room code to show the patient.
  const isDoctor = callerUserId === session.doctor_id;
  const patientDevice = activePatientDevice(asList(devices));

  // If the session is open, caller is doctor, no patient has joined, and room code is missing or expired,
  // auto-refresh the room code so a valid code is always available.
  let currentSession = session;
  if (isDoctor && OPEN_STATES.includes(session.status) && !patientDevice) {
    const codeMissingOrExpired = !session.room_code
      || (session.room_code_expires_at && new Date(session.room_code_expires_at) < new Date());
    if (codeMissingOrExpired) {
      try {
        currentSession = await refreshRoomCode(session);
      } catch (refreshErr) {
        logger.warn('Failed to auto-refresh room code in getSessionState', { error: refreshErr.message });
      }
    }
  }

  return {
    session: {
      id: currentSession.id,
      sessionId: currentSession.id,
      session_id: currentSession.id,
      status: currentSession.status,
      ...(isDoctor && {
        roomCode: currentSession.room_code,
        room_code: currentSession.room_code,
        roomCodeExpiresAt: currentSession.room_code_expires_at,
      }),
      patientJoined: Boolean(patientDevice),
      patientReady: patientDevice?.status === 'ready',
      patientRequired: currentSession.patient_required,
      patient_required: currentSession.patient_required,
      languageCode: currentSession.language_code,
      language_code: currentSession.language_code,
      startedAt: currentSession.started_at,
      started_at: currentSession.started_at,
      endedAt: currentSession.ended_at,
      ended_at: currentSession.ended_at,
      endDeadlineAt: currentSession.end_deadline_at,
      end_deadline_at: currentSession.end_deadline_at,
      incompleteSides: currentSession.incomplete_sides || [],
      incomplete_sides: currentSession.incomplete_sides || [],
      draftOutdated: currentSession.draft_outdated || false,
      draft_outdated: currentSession.draft_outdated || false,
    },
    devices: (devices || []).map((d) => ({
      device: d.device,
      status: d.status,
      offsetMs: d.offset_ms,
      offset_ms: d.offset_ms,
      rttMs: d.rtt_ms,
      rtt_ms: d.rtt_ms,
    })),
    consents: consents || [],
    gaps: gaps || [],
  };
}

/**
 * Fetches ordered transcript segments for a session.
 */
async function getSessionTranscript(sessionId, doctorUserId = null) {
  const { data: session, error: sErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, doctor_id, status, incomplete_sides, draft_outdated')
    .eq('id', sessionId)
    .single();

  if (sErr || !session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  if (doctorUserId && session.doctor_id !== doctorUserId) {
    const err = new Error('Not authorized to access transcript for this session');
    err.status = 403;
    throw err;
  }

  const { data: segments, error: segErr } = await supabaseAdmin
    .from('segments')
    .select('*')
    .eq('session_id', sessionId)
    .order('start_ms', { ascending: true });

  if (segErr) {
    throw new Error(`Failed to fetch segments: ${segErr.message}`);
  }

  // Fetch audio chunks to associate loudness (avg_dbfs) and calculate progress
  let totalChunks = 0;
  let transcribedChunks = 0;
  let isProcessing = ['recording', 'ending', 'processing'].includes(session.status);
  let chunkList = [];

  try {
    const { data: chunks } = await supabaseAdmin
      .from('audio_chunks')
      .select('id, status, silent, seq, device, avg_dbfs, start_ms, duration_ms')
      .eq('session_id', sessionId);

    chunkList = chunks || [];
    totalChunks = chunkList.length;
    transcribedChunks = chunkList.filter((c) => c.status === 'transcribed' || c.silent).length;
    if (totalChunks > 0 && transcribedChunks < totalChunks) {
      isProcessing = true;
    }
  } catch (_chunkErr) {
    totalChunks = segments?.length || 0;
    transcribedChunks = segments?.length || 0;
  }

  // Fetch explicit timeline gaps
  let gapsList = [];
  try {
    const { data: gaps } = await supabaseAdmin
      .from('consult_audio_gaps')
      .select('id, gap_id, device, start_ms, duration_ms, reason_code, received_at')
      .eq('session_id', sessionId);
    gapsList = gaps || [];
  } catch (_gapErr) {
    gapsList = [];
  }

  // Associate chunk avg_dbfs with segments if not already on the segment
  const chunkDbfsMap = new Map(chunkList.map((c) => [c.id, c.avg_dbfs]));
  const enrichedSegments = (segments || []).map((s) => ({
    ...s,
    avg_dbfs: s.avg_dbfs !== undefined && s.avg_dbfs !== null ? s.avg_dbfs : chunkDbfsMap.get(s.chunk_id),
  }));

  const doctorSegments = enrichedSegments.filter((s) => s.device === 'doctor');
  const patientSegments = enrichedSegments.filter((s) => s.device === 'patient');
  const failedChunks = chunkList.filter((c) => c.status === 'failed');

  const merged = mergeSegments(doctorSegments, patientSegments, {
    gaps: gapsList,
    failedChunks,
    dedupeMinOverlap: config.dedupeMinOverlap,
    dedupeMinSimilarity: config.dedupeMinSimilarity,
    lowConfidenceThreshold: config.lowConfidenceThreshold,
  });

  return {
    sessionId,
    status: session.status,
    incompleteSides: session.incomplete_sides || [],
    incomplete_sides: session.incomplete_sides || [],
    draftOutdated: session.draft_outdated || false,
    draft_outdated: session.draft_outdated || false,
    totalChunks,
    transcribedChunks,
    isProcessing,
    segments: merged,
    stats: merged.stats,
  };
}

/**
 * Fetches the latest consultation session for an appointment.
 */
async function getLatestSessionByAppointment(appointmentId, doctorUserId = null) {
  const { data: session, error } = await supabaseAdmin
    .from('consult_sessions')
    .select('*')
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !session) {
    return null;
  }

  if (doctorUserId && session.doctor_id !== doctorUserId) {
    const err = new Error('Not authorized to access this session');
    err.status = 403;
    throw err;
  }

  const { data: chunks } = await supabaseAdmin
    .from('audio_chunks')
    .select('id, status, is_silent')
    .eq('session_id', session.id);

  const chunkList = chunks || [];
  const totalChunks = chunkList.length;
  const transcribedChunks = chunkList.filter((c) => c.status === 'transcribed' || c.is_silent).length;

  return {
    sessionId: session.id,
    session_id: session.id,
    id: session.id,
    status: session.status,
    roomCode: session.room_code,
    room_code: session.room_code,
    patientRequired: session.patient_required,
    patient_required: session.patient_required,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    totalChunks,
    transcribedChunks,
    createdAt: session.created_at,
  };
}

/**
 * Throws 404/403 unless the user is this session's doctor (or, when
 * doctorOnly is false, its patient). For routes reached with a normal
 * login token, which is not bound to a session the way scoped tokens are.
 */
async function assertSessionParticipant(sessionId, userId, { doctorOnly = false } = {}) {
  const { data: session, error } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, doctor_id, patient_id')
    .eq('id', sessionId)
    .maybeSingle();

  if (error || !session) {
    throw Object.assign(new Error('Session not found'), { status: 404 });
  }

  const allowed = doctorOnly ? [session.doctor_id] : [session.doctor_id, session.patient_id];
  if (!userId || !allowed.includes(userId)) {
    throw Object.assign(new Error('Not authorized for this consultation'), { status: 403 });
  }
  return session;
}

module.exports = {
  assertSessionParticipant,
  createSession,
  refreshSessionRoomCode,
  joinSessionByRoomCode,
  recordSessionConsent,
  markDeviceReady,
  startConsultation,
  leaveSession,
  endConsultation,
  recordCaptureStarted,
  getSessionState,
  getSessionTranscript,
  getLatestSessionByAppointment,
};
