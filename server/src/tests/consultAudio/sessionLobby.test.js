/**
 * Lobby behaviour: the doctor can start alone, reopening the dialog keeps one
 * room, and a patient can leave the room before recording. Synthetic ids only.
 */
const request = require('supertest');
const app = require('../../app');
const db = require('../../config/supabaseAdminClient');
const sessions = require('../../services/consultAudio/session.service');
const { assertCanTransition, STATES } = require('../../services/consultAudio/stateMachine');
const { signSessionToken } = require('../../services/consultAudio/token.service');
const { ok, mockTables } = require('../helpers/supabaseMock');

jest.mock('../../config/supabaseAdminClient', () => ({ auth: { getUser: jest.fn() }, from: jest.fn() }));
jest.mock('../../utils/audioConverter', () => ({
  convertTo16kHzMonoWav: jest.fn(), checkFfmpegInstalled: jest.fn().mockResolvedValue(true),
}));

const future = () => new Date(Date.now() + 600000).toISOString();
const appointment = { id: 'synthetic-appt', clinician_id: 'doctor', patient_id: 'patient' };
const base = {
  id: 'synthetic-session', appointment_id: 'synthetic-appt', doctor_id: 'doctor', patient_id: 'patient',
  patient_required: false, room_code: 'SYN123', room_code_expires_at: future(),
};

describe('Doctor can start without the patient', () => {
  test('doctor alone reaches READY and RECORDING when the patient is optional', () => {
    const consents = [{ role: 'doctor' }];
    const devices = [{ device: 'doctor', status: 'ready' }];
    expect(assertCanTransition({ session: { ...base, status: 'created' }, consents, devices, toState: STATES.READY }).valid).toBe(true);
    expect(assertCanTransition({ session: { ...base, status: 'ready' }, consents, devices, toState: STATES.RECORDING }).valid).toBe(true);
  });

  test('a patient who joined but is not ready does not block the doctor', () => {
    const consents = [{ role: 'doctor' }];
    const devices = [{ device: 'doctor', status: 'ready' }, { device: 'patient', status: 'joined' }];
    expect(assertCanTransition({ session: { ...base, status: 'waiting' }, consents, devices, toState: STATES.READY }).valid).toBe(true);
  });

  test('a patient-required session still waits for a present, consenting patient', () => {
    const session = { ...base, status: 'waiting', patient_required: true };
    const devices = [{ device: 'doctor', status: 'ready' }, { device: 'patient', status: 'gone' }];
    const result = assertCanTransition({ session, consents: [{ role: 'doctor' }, { role: 'patient' }], devices, toState: STATES.READY });
    expect(result.valid).toBe(false);
  });

  test('new sessions default to doctor-only start', async () => {
    const chains = mockTables(db, {
      appointments: ok(appointment),
      consult_sessions: [ok(null), ok({ ...base, status: 'created' })],
      session_devices: ok(null),
    });
    const result = await sessions.createSession({ appointmentId: 'synthetic-appt', doctorId: 'doctor' });
    expect(chains.consult_sessions[1].insert).toHaveBeenCalledWith(expect.objectContaining({ patient_required: false }));
    expect(result.reused).toBe(false);
  });

  test('starting drops a joined patient who has not consented, so they are never recorded', async () => {
    const ready = { ...base, status: 'ready' };
    const chains = mockTables(db, {
      consult_sessions: [ok(ready), ok(ready), ok({ ...ready, status: 'recording' })],
      session_consents: ok([{ role: 'doctor' }]),
      session_devices: [
        ok([{ device: 'doctor', status: 'ready' }, { device: 'patient', status: 'joined' }]),
        ok(null),
        ok([{ device: 'doctor', status: 'ready' }, { device: 'patient', status: 'gone' }]),
      ],
    });
    const updated = await sessions.startConsultation({ sessionId: base.id, doctorUserId: 'doctor' });
    expect(updated.status).toBe('recording');
    expect(chains.session_devices[1].update).toHaveBeenCalledWith({ status: 'gone' });
  });

  test('a consenting, ready patient is kept when the doctor starts', async () => {
    const ready = { ...base, status: 'ready' };
    const devices = [{ device: 'doctor', status: 'ready' }, { device: 'patient', status: 'ready' }];
    const chains = mockTables(db, {
      consult_sessions: [ok(ready), ok(ready), ok({ ...ready, status: 'recording' })],
      session_consents: ok([{ role: 'doctor' }, { role: 'patient' }]),
      session_devices: ok(devices),
    });
    await sessions.startConsultation({ sessionId: base.id, doctorUserId: 'doctor' });
    expect(chains.session_devices.some((c) => c.update.mock.calls.length > 0)).toBe(false);
  });
});

describe('Reopening the consultation dialog keeps one room', () => {
  test('an open session for the appointment is reused instead of creating another', async () => {
    const open = { ...base, status: 'waiting', room_code: null, room_code_expires_at: null };
    const chains = mockTables(db, {
      appointments: ok(appointment),
      consult_sessions: ok(open),
      session_devices: ok([{ device: 'doctor', status: 'ready' }, { device: 'patient', status: 'joined' }]),
    });
    const result = await sessions.createSession({ appointmentId: 'synthetic-appt', doctorId: 'doctor' });
    expect(result).toMatchObject({ sessionId: base.id, reused: true, patientJoined: true, patientReady: false });
    expect(result.doctorToken).toEqual(expect.any(String));
    expect(chains.consult_sessions.some((c) => c.insert.mock.calls.length > 0)).toBe(false);
    // The patient is in the room, so their consumed code is not replaced.
    expect(chains.consult_sessions.some((c) => c.update.mock.calls.length > 0)).toBe(false);
  });

  test('an expired code is refreshed when nobody is in the room', async () => {
    const open = { ...base, status: 'created', room_code_expires_at: new Date(Date.now() - 1000).toISOString() };
    const chains = mockTables(db, {
      appointments: ok(appointment),
      consult_sessions: [ok(open), ok({ ...open, room_code: 'NEW456' })],
      session_devices: ok([{ device: 'doctor', status: 'joined' }]),
    });
    const result = await sessions.createSession({ appointmentId: 'synthetic-appt', doctorId: 'doctor' });
    expect(chains.consult_sessions[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ room_code: expect.stringMatching(/^[A-Z0-9]{6}$/) })
    );
    expect(result.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(result.roomCode).not.toBe('SYN123');
  });
});

describe('Patient leaves the room', () => {
  test('leaving marks the device gone, withdraws consent and reopens the room with a new code', async () => {
    const waiting = { ...base, status: 'waiting', room_code: null };
    const chains = mockTables(db, {
      consult_sessions: [ok(waiting), ok(waiting), ok({ ...waiting, status: 'created' })],
      session_devices: [ok(null), ok([{ device: 'doctor', status: 'ready' }, { device: 'patient', status: 'gone' }])],
      session_consents: [ok(null), ok([{ role: 'doctor' }])],
    });
    await expect(sessions.leaveSession({ sessionId: base.id, userId: 'patient' })).resolves.toEqual({ ok: true });
    expect(chains.session_devices[0].update).toHaveBeenCalledWith({ status: 'gone' });
    expect(chains.session_consents[0].delete).toHaveBeenCalled();
    expect(chains.session_consents[0].eq).toHaveBeenCalledWith('role', 'patient');
    expect(chains.consult_sessions[2].update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'created', room_code: expect.stringMatching(/^[A-Z0-9]{6}$/) })
    );
  });

  test('leaving is refused once recording has started', async () => {
    const chains = mockTables(db, { consult_sessions: ok({ ...base, status: 'recording' }) });
    await expect(sessions.leaveSession({ sessionId: base.id, userId: 'patient' }))
      .rejects.toMatchObject({ status: 409, code: 'ERR_SESSION_NOT_OPEN' });
    expect(chains.consult_sessions[0].update).not.toHaveBeenCalled();
  });

  test('a patient who left cannot mark their old device ready', async () => {
    const chains = mockTables(db, {
      consult_sessions: ok({ ...base, status: 'created' }),
      session_devices: ok({ status: 'gone' }),
    });
    await expect(sessions.markDeviceReady({ sessionId: base.id, device: 'patient' }))
      .rejects.toMatchObject({ status: 409, code: 'ERR_NOT_IN_ROOM' });
    expect(chains.session_devices.some((c) => c.upsert.mock.calls.length > 0)).toBe(false);
  });

  test('a patient who left cannot record consent', async () => {
    mockTables(db, {
      consult_sessions: ok({ ...base, status: 'created' }),
      session_devices: ok({ status: 'gone' }),
    });
    await expect(sessions.recordSessionConsent({ sessionId: base.id, role: 'patient', userId: 'patient' }))
      .rejects.toMatchObject({ status: 409, code: 'ERR_NOT_IN_ROOM' });
  });

  test('POST /leave accepts only the patient device token and returns the error code', async () => {
    mockTables(db, { consult_sessions: ok({ ...base, status: 'recording' }) });
    const doctorToken = signSessionToken({ sessionId: base.id, device: 'doctor', role: 'doctor', userId: 'doctor' });
    const asDoctor = await request(app).post(`/api/consults/${base.id}/leave`).set('Authorization', `Bearer ${doctorToken}`);
    expect(asDoctor.status).toBe(403);

    const patientToken = signSessionToken({ sessionId: base.id, device: 'patient', role: 'patient', userId: 'patient' });
    const asPatient = await request(app).post(`/api/consults/${base.id}/leave`).set('Authorization', `Bearer ${patientToken}`);
    expect(asPatient.status).toBe(409);
    expect(asPatient.body.code).toBe('ERR_SESSION_NOT_OPEN');
  });

  test('createSession with forceNew cancels existing open session and creates brand new session', async () => {
    const chains = mockTables(db, {
      appointments: ok(appointment),
      consult_sessions: [
        ok(null), // update cancelling prior open sessions
        ok({ ...base, id: 'new-session-id', status: 'created' }), // insert new session
      ],
      session_devices: ok(null),
    });
    const result = await sessions.createSession({
      appointmentId: 'synthetic-appt',
      doctorId: 'doctor',
      forceNew: true,
    });
    expect(chains.consult_sessions[0].update).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(chains.consult_sessions[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'created', room_code: expect.stringMatching(/^[A-Z0-9]{6}$/) })
    );
    expect(result.sessionId).toBe('new-session-id');
    expect(result.reused).toBe(false);
  });

  test('refreshSessionRoomCode generates fresh code for open session and POST /refresh-code returns it', async () => {
    mockTables(db, {
      consult_sessions: [
        ok({ ...base, status: 'created', room_code: null }), // select existing
        ok({ ...base, status: 'created', room_code: 'NEW123', room_code_expires_at: future() }), // update with new code
      ],
    });
    const doctorToken = signSessionToken({ sessionId: base.id, device: 'doctor', role: 'doctor', userId: 'doctor' });
    const res = await request(app)
      .post(`/api/consults/${base.id}/refresh-code`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.roomCode).toMatch(/^[A-Z0-9]{6}$/);
  });
});
