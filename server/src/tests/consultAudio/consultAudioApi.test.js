/**
 * Consult Audio HTTP API Integration Tests.
 */

const request = require('supertest');
const app = require('../../app');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const { signSessionToken } = require('../../services/consultAudio/token.service');
const { ok, mockTables, profileRow } = require('../helpers/supabaseMock');

jest.mock('../../config/supabaseAdminClient', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
}));

describe('Consult Audio HTTP Endpoints', () => {
  const doctorUser = { id: 'doc-user-1', email: 'doctor@example.com' };
  const patientUser = { id: 'patient-user-1', email: 'patient@example.com' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/time (Clock Handshake)', () => {
    test('returns server time in milliseconds', async () => {
      const res = await request(app).get('/api/time');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('serverTimeMs');
      expect(typeof res.body.serverTimeMs).toBe('number');
    });
  });

  describe('POST /api/consults (Create Session)', () => {
    test('doctor creates session for an appointment', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: doctorUser }, error: null });

      const mockAppointment = {
        id: 'appt-100',
        clinician_id: doctorUser.id,
        patient_id: patientUser.id,
      };

      const mockCreatedSession = {
        id: 'sess-100',
        appointment_id: 'appt-100',
        doctor_id: doctorUser.id,
        patient_id: patientUser.id,
        status: 'created',
        room_code: 'ABC890',
        room_code_expires_at: new Date(Date.now() + 600000).toISOString(),
        patient_required: true,
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        appointments: ok(mockAppointment),
        consult_sessions: ok(mockCreatedSession),
        session_devices: ok({ id: 'dev-1' }),
      });

      const res = await request(app)
        .post('/api/consults')
        .set('Authorization', 'Bearer valid-doctor-auth-token')
        .send({ appointmentId: 'appt-100', patientRequired: true });

      expect(res.status).toBe(201);
      expect(res.body.sessionId).toBe('sess-100');
      expect(res.body.roomCode).toBe('ABC890');
      expect(res.body).toHaveProperty('doctorToken');
      expect(res.body.patientRequired).toBe(true);
    });

    test('rejects creation when appointmentId is missing', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: doctorUser }, error: null });
      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
      });

      const res = await request(app)
        .post('/api/consults')
        .set('Authorization', 'Bearer valid-doctor-auth-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/appointmentId is required/i);
    });

    test('rejects creation if caller is not clinician on the appointment', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: doctorUser }, error: null });

      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        appointments: ok({ id: 'appt-100', clinician_id: 'other-doctor-id' }),
      });

      const res = await request(app)
        .post('/api/consults')
        .set('Authorization', 'Bearer valid-doctor-auth-token')
        .send({ appointmentId: 'appt-100' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/does not own this appointment/i);
    });
  });

  describe('POST /api/consults/join (Patient Join)', () => {
    test('patient joins using valid room code', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: patientUser }, error: null });

      const mockSession = {
        id: 'sess-100',
        status: 'created',
        room_code: 'ABC890',
        room_code_expires_at: new Date(Date.now() + 600000).toISOString(),
        patient_required: true,
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        consult_sessions: ok(mockSession),
        session_devices: ok({ id: 'dev-pt-1' }),
      });

      const res = await request(app)
        .post('/api/consults/join')
        .set('Authorization', 'Bearer valid-patient-auth-token')
        .send({ roomCode: 'ABC890' });

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBe('sess-100');
      expect(res.body).toHaveProperty('patientToken');
    });

    test('rejects expired room code', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: patientUser }, error: null });

      const expiredSession = {
        id: 'sess-100',
        status: 'created',
        room_code: 'EXP999',
        room_code_expires_at: new Date(Date.now() - 60000).toISOString(), // expired 1m ago
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        consult_sessions: ok(expiredSession),
      });

      const res = await request(app)
        .post('/api/consults/join')
        .set('Authorization', 'Bearer valid-patient-auth-token')
        .send({ roomCode: 'EXP999' });

      expect(res.status).toBe(410);
      expect(res.body.error).toMatch(/expired/i);
    });

    test('rejects unknown room code with 404', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: patientUser }, error: null });

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        consult_sessions: ok(null),
      });

      const res = await request(app)
        .post('/api/consults/join')
        .set('Authorization', 'Bearer valid-patient-auth-token')
        .send({ roomCode: 'NOTFND' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/invalid or expired/i);
    });
  });

  describe('POST /api/consults/:id/consent (Consent Recording)', () => {
    test('records consent using scoped session token', async () => {
      const doctorToken = signSessionToken({
        sessionId: 'sess-100',
        device: 'doctor',
        role: 'doctor',
        userId: doctorUser.id,
      });

      mockTables(supabaseAdmin, {
        session_consents: ok({
          id: 'consent-1',
          session_id: 'sess-100',
          role: 'doctor',
          consent_text_version: 'v1.0',
        }),
        consult_sessions: ok({ id: 'sess-100', status: 'created', patient_required: false }),
        session_devices: ok([]),
      });

      const res = await request(app)
        .post('/api/consults/sess-100/consent')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ consentTextVersion: 'v1.0' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.consent.role).toBe('doctor');
    });
  });

  describe('POST /api/consults/:id/devices/:device/ready', () => {
    test('marks device ready after mic and level check', async () => {
      const doctorToken = signSessionToken({
        sessionId: 'sess-100',
        device: 'doctor',
        role: 'doctor',
        userId: doctorUser.id,
      });

      mockTables(supabaseAdmin, {
        session_devices: ok({
          session_id: 'sess-100',
          device: 'doctor',
          status: 'ready',
          offset_ms: 120,
          rtt_ms: 45,
        }),
        consult_sessions: ok({ id: 'sess-100', status: 'created', patient_required: false }),
        session_consents: ok([]),
      });

      const res = await request(app)
        .post('/api/consults/sess-100/devices/doctor/ready')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ offset_ms: 120, rtt_ms: 45 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.device.status).toBe('ready');
    });
  });

  describe('POST /api/consults/:id/start (Start Consultation)', () => {
    test('starts consultation when session is ready', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: doctorUser }, error: null });

      const readySession = {
        id: 'sess-100',
        doctor_id: doctorUser.id,
        status: 'ready',
        patient_required: true,
      };

      const consents = [{ role: 'doctor' }, { role: 'patient' }];
      const devices = [
        { device: 'doctor', status: 'ready' },
        { device: 'patient', status: 'ready' },
      ];

      const recordingSession = {
        ...readySession,
        status: 'recording',
        started_at: new Date().toISOString(),
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        consult_sessions: [ok(readySession), ok(readySession), ok(recordingSession)],
        session_consents: ok(consents),
        session_devices: ok(devices),
      });

      const res = await request(app)
        .post('/api/consults/sess-100/start')
        .set('Authorization', 'Bearer valid-doctor-auth-token');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.session.status).toBe('recording');
    });

    test('rejects start if caller is not the session doctor', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: 'other-doc' } }, error: null });

      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        consult_sessions: ok({ id: 'sess-100', doctor_id: doctorUser.id, status: 'ready' }),
      });

      const res = await request(app)
        .post('/api/consults/sess-100/start')
        .set('Authorization', 'Bearer valid-other-doc-token');

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/only the session doctor can start/i);
    });

    test('rejects start if session is not ready (missing consents/readiness)', async () => {
      supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: doctorUser }, error: null });

      const waitingSession = {
        id: 'sess-100',
        doctor_id: doctorUser.id,
        status: 'waiting', // not ready
        patient_required: true,
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        consult_sessions: [ok(waitingSession), ok(waitingSession)],
        session_consents: ok([]),
        session_devices: ok([]),
      });

      const res = await request(app)
        .post('/api/consults/sess-100/start')
        .set('Authorization', 'Bearer valid-doctor-auth-token');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/must be 'ready'|Invalid state transition/i);
    });
  });

  describe('GET /api/consults/:id/state', () => {
    test('returns session state with scoped token', async () => {
      const doctorToken = signSessionToken({
        sessionId: 'sess-100',
        device: 'doctor',
        role: 'doctor',
        userId: doctorUser.id,
      });

      mockTables(supabaseAdmin, {
        consult_sessions: ok({
          id: 'sess-100',
          status: 'recording',
          patient_required: true,
          language_code: 'hi-IN',
          started_at: new Date().toISOString(),
        }),
        session_devices: ok([
          { device: 'doctor', status: 'recording', offset_ms: 10, rtt_ms: 20 },
        ]),
        session_consents: ok([
          { role: 'doctor', accepted_at: new Date().toISOString(), consent_text_version: 'v1.0' },
        ]),
      });

      const res = await request(app)
        .get('/api/consults/sess-100/state')
        .set('Authorization', `Bearer ${doctorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe('recording');
      expect(res.body.devices).toHaveLength(1);
      expect(res.body.consents).toHaveLength(1);
    });
  });
});
