/**
 * Authoritative State Machine for Consult Audio Sessions.
 *
 * State flow:
 *   created -> waiting -> ready -> recording -> ending -> processing -> draft_ready
 *                                      \-> cancelled / failed (from any state before draft_ready)
 */

const supabaseAdmin = require('../../config/supabaseAdminClient');
const logger = require('../../utils/logger');

const STATES = {
  CREATED: 'created',
  WAITING: 'waiting',
  READY: 'ready',
  RECORDING: 'recording',
  ENDING: 'ending',
  PROCESSING: 'processing',
  DRAFT_READY: 'draft_ready',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
};

const ALLOWED_TRANSITIONS = {
  [STATES.CREATED]: [STATES.WAITING, STATES.READY, STATES.CANCELLED, STATES.FAILED],
  // -> CREATED: the patient left the room before recording started.
  [STATES.WAITING]: [STATES.READY, STATES.CREATED, STATES.CANCELLED, STATES.FAILED],
  [STATES.READY]: [STATES.RECORDING, STATES.WAITING, STATES.CREATED, STATES.CANCELLED, STATES.FAILED],
  [STATES.RECORDING]: [STATES.ENDING, STATES.CANCELLED, STATES.FAILED],
  [STATES.ENDING]: [STATES.PROCESSING, STATES.FAILED],
  [STATES.PROCESSING]: [STATES.DRAFT_READY, STATES.FAILED],
  [STATES.DRAFT_READY]: [], // Terminal state
  [STATES.CANCELLED]: [],   // Terminal state
  [STATES.FAILED]: [],      // Terminal state
};

/** A patient device that is in the room (not one that left or was dropped). */
function activePatientDevice(devices = []) {
  return (devices || []).find((d) => d.device === 'patient' && d.status !== 'gone') || null;
}

/**
 * Whether the patient's device takes part in recording: it joined, is ready,
 * and the patient consented. A doctor can always record alone unless the
 * session was explicitly created with patient_required.
 */
function patientParticipates(consents = [], devices = []) {
  const device = activePatientDevice(devices);
  const consent = (consents || []).some((c) => c.role === 'patient');
  return Boolean(device && device.status === 'ready' && consent);
}

/**
 * Checks whether a state transition is syntactically allowed in the graph.
 */
function isValidTransition(fromState, toState) {
  const allowed = ALLOWED_TRANSITIONS[fromState];
  if (!allowed) return false;
  return allowed.includes(toState);
}

/**
 * Validates preconditions required to move into a given state.
 *
 * @param {Object} params
 * @param {Object} params.session - consult_sessions row
 * @param {Array} params.consents - session_consents rows
 * @param {Array} params.devices - session_devices rows
 * @param {string} params.toState - desired target state
 * @returns {{ valid: boolean, error?: string }}
 */
function assertCanTransition({ session, consents = [], devices = [], toState }) {
  if (!session) {
    return { valid: false, error: 'Session not found' };
  }

  // Preconditions for moving to RECORDING:
  // Must be in READY state before recording can start
  if (toState === STATES.RECORDING && session.status !== STATES.READY) {
    return { valid: false, error: `Cannot start recording from state '${session.status}', must be 'ready'` };
  }

  if (!isValidTransition(session.status, toState)) {
    return {
      valid: false,
      error: `Invalid state transition from '${session.status}' to '${toState}'`,
    };
  }

  const consentList = Array.isArray(consents) ? consents : (consents ? [consents] : []);
  const deviceList = Array.isArray(devices) ? devices : (devices ? [devices] : []);

  // Preconditions for moving to READY
  if (toState === STATES.READY) {
    const doctorConsent = consentList.find((c) => c.role === 'doctor');
    if (!doctorConsent) {
      return { valid: false, error: 'Doctor consent required before session is ready' };
    }

    const doctorDevice = deviceList.find((d) => d.device === 'doctor');
    if (!doctorDevice || doctorDevice.status !== 'ready') {
      return { valid: false, error: 'Doctor device must be ready' };
    }

    // A patient in the room who is not ready yet does not block the doctor;
    // only an explicitly patient-required session waits for them.
    if (session.patient_required) {
      const patientConsent = consentList.find((c) => c.role === 'patient');
      if (!patientConsent) {
        return { valid: false, error: 'Patient consent required before session is ready' };
      }

      const patientDevice = activePatientDevice(deviceList);
      if (!patientDevice || patientDevice.status !== 'ready') {
        return { valid: false, error: 'Patient device must be ready' };
      }
    }
  }

  // Preconditions for moving to RECORDING
  if (toState === STATES.RECORDING) {
    const doctorConsent = consentList.find((c) => c.role === 'doctor');
    if (!doctorConsent) {
      return { valid: false, error: 'Cannot record without doctor consent' };
    }

    if (session.patient_required) {
      const patientConsent = consentList.find((c) => c.role === 'patient');
      if (!patientConsent) {
        return { valid: false, error: 'Cannot record without patient consent' };
      }
      const patientDevice = activePatientDevice(deviceList);
      if (!patientDevice || patientDevice.status !== 'ready') {
        return { valid: false, error: 'Patient device must be ready before recording' };
      }
    }
  }

  return { valid: true };
}

/**
 * Executes a verified state transition, updates database, and broadcasts
 * the state change event via Socket.IO if available.
 */
async function transitionSession({ sessionId, toState, patch = {}, socketEmitter = null }) {
  // Fetch current session, consents, devices
  const { data: session, error: sErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sErr || !session) {
    throw new Error(`Session ${sessionId} not found for transition: ${sErr?.message}`);
  }

  const { data: consents, error: cErr } = await supabaseAdmin
    .from('session_consents')
    .select('*')
    .eq('session_id', sessionId);

  if (cErr) throw new Error(`Failed to load consents: ${cErr.message}`);

  const { data: devices, error: dErr } = await supabaseAdmin
    .from('session_devices')
    .select('*')
    .eq('session_id', sessionId);

  if (dErr) throw new Error(`Failed to load devices: ${dErr.message}`);

  // Validate preconditions
  const check = assertCanTransition({ session, consents, devices, toState });
  if (!check.valid) {
    const err = new Error(check.error);
    err.status = 400;
    throw err;
  }

  // Prepare database updates
  const updatePayload = {
    status: toState,
    ...patch,
  };

  const { data: updatedSession, error: uErr } = await supabaseAdmin
    .from('consult_sessions')
    .update(updatePayload)
    .eq('id', sessionId)
    .select()
    .single();

  if (uErr) {
    throw new Error(`Failed to update session status to ${toState}: ${uErr.message}`);
  }

  logger.info('Consult session state transition', {
    scope: 'consult-audio',
    sessionId,
    fromState: session.status,
    toState,
  });

  // Emit event via Socket.IO (server to client push)
  if (socketEmitter && typeof socketEmitter.emitSessionState === 'function') {
    socketEmitter.emitSessionState(sessionId, {
      sessionId,
      status: toState,
      startedAt: updatedSession.started_at,
      endedAt: updatedSession.ended_at,
      endDeadlineAt: updatedSession.end_deadline_at,
    });
  }

  return updatedSession;
}

module.exports = {
  STATES,
  ALLOWED_TRANSITIONS,
  activePatientDevice,
  patientParticipates,
  isValidTransition,
  assertCanTransition,
  transitionSession,
};
