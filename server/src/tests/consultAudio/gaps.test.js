/**
 * Consultation Audio Gaps Integration and Unit Tests.
 */

const request = require('supertest');
const app = require('../../app');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const { signSessionToken } = require('../../services/consultAudio/token.service');
const { ok, mockTables } = require('../helpers/supabaseMock');

jest.mock('../../config/supabaseAdminClient', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
}));

jest.mock('../../utils/audioConverter', () => ({
  convertTo16kHzMonoWav: jest.fn((buf) => Promise.resolve(buf)),
  checkFfmpegInstalled: jest.fn().mockResolvedValue(true),
}));

describe('Consult Audio Gaps API', () => {
  const sessionId = '00000000-0000-4000-8000-000000000001';
  const otherSessionId = '00000000-0000-4000-8000-000000000002';
  const patientUserId = 'patient-user-1';
  const validGapId = '11111111-1111-4111-8111-111111111111';

  let patientToken;

  beforeEach(() => {
    jest.clearAllMocks();
    patientToken = signSessionToken({
      sessionId,
      device: 'patient',
      role: 'patient',
      userId: patientUserId,
    });
  });

  describe('POST /api/consults/:id/devices/:device/gaps', () => {
    test('successfully records an interruption gap', async () => {
      mockTables(supabaseAdmin, {
        consult_audio_gaps: ok({
          id: 'gap-row-1',
          session_id: sessionId,
          device: 'patient',
          gap_id: validGapId,
          start_ms: 12500,
          duration_ms: 3000,
          reason_code: 'phone_call',
          received_at: new Date().toISOString(),
        }),
      });

      const res = await request(app)
        .post(`/api/consults/${sessionId}/devices/patient/gaps`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          gap_id: validGapId,
          start_ms: 12500,
          duration_ms: 3000,
          reason_code: 'phone_call',
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.duplicate).toBe(false);
      expect(res.body.gap.reason_code).toBe('phone_call');
      expect(res.body.gap.duration_ms).toBe(3000);
    });

    test('handles idempotent duplicate gap submission', async () => {
      // Simulate unique constraint violation error 23505
      const duplicateError = new Error('duplicate key value violates unique constraint');
      duplicateError.code = '23505';

      const existingRecord = {
        id: 'gap-row-1',
        session_id: sessionId,
        device: 'patient',
        gap_id: validGapId,
        start_ms: 12500,
        duration_ms: 3000,
        reason_code: 'phone_call',
        received_at: new Date().toISOString(),
      };

      mockTables(supabaseAdmin, {
        consult_audio_gaps: [
          { data: null, error: duplicateError },
          ok(existingRecord),
        ],
      });

      const res = await request(app)
        .post(`/api/consults/${sessionId}/devices/patient/gaps`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          gap_id: validGapId,
          start_ms: 12500,
          duration_ms: 3000,
          reason_code: 'phone_call',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.duplicate).toBe(true);
    });

    test('rejects request with invalid UUID gap_id', async () => {
      const res = await request(app)
        .post(`/api/consults/${sessionId}/devices/patient/gaps`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          gap_id: 'not-a-uuid',
          start_ms: 5000,
          duration_ms: 1000,
          reason_code: 'phone_call',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid UUID/i);
    });

    test('rejects request with negative start_ms', async () => {
      const res = await request(app)
        .post(`/api/consults/${sessionId}/devices/patient/gaps`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          gap_id: validGapId,
          start_ms: -50,
          duration_ms: 1000,
          reason_code: 'phone_call',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-negative/i);
    });

    test('rejects request with non-positive duration_ms', async () => {
      const res = await request(app)
        .post(`/api/consults/${sessionId}/devices/patient/gaps`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          gap_id: validGapId,
          start_ms: 1000,
          duration_ms: 0,
          reason_code: 'phone_call',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/positive integer/i);
    });

    test('rejects request with unapproved reason_code', async () => {
      const res = await request(app)
        .post(`/api/consults/${sessionId}/devices/patient/gaps`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          gap_id: validGapId,
          start_ms: 1000,
          duration_ms: 2000,
          reason_code: 'sleeping',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/reason_code/i);
    });

    test('rejects request if token sessionId does not match path', async () => {
      const res = await request(app)
        .post(`/api/consults/${otherSessionId}/devices/patient/gaps`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          gap_id: validGapId,
          start_ms: 1000,
          duration_ms: 2000,
          reason_code: 'focus_lost',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not authorized for this session/i);
    });

    test('rejects request if token device does not match path', async () => {
      const res = await request(app)
        .post(`/api/consults/${sessionId}/devices/doctor/gaps`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          gap_id: validGapId,
          start_ms: 1000,
          duration_ms: 2000,
          reason_code: 'focus_lost',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not authorized for this device/i);
    });
  });

  test.each([null, '', '1', 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects malformed start values without coercion: %p', async (start) => {
    const response = await request(app).post(`/api/consults/${sessionId}/devices/patient/gaps`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({gap_id:validGapId, start_ms:start, duration_ms:1000, reason_code:'unknown'});
    expect(response.status).toBe(400);
  });

  test('does not acknowledge a duplicate when the durable lookup fails', async () => {
    mockTables(supabaseAdmin, {consult_audio_gaps: [
      {data:null, error:{code:'23505'}}, {data:null, error:{code:'untrusted'}}]});
    const response = await request(app).post(`/api/consults/${sessionId}/devices/patient/gaps`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({gap_id:validGapId, start_ms:0, duration_ms:1000, reason_code:'unknown'});
    expect(response.status).toBe(503); expect(response.body.ok).toBeUndefined();
  });

  describe('GET /api/consults/:id/devices/:device/gaps', () => {
    test('retrieves recorded gaps for a device', async () => {
      mockTables(supabaseAdmin, {
        consult_audio_gaps: ok([
          {
            id: 'gap-row-1',
            session_id: sessionId,
            device: 'patient',
            gap_id: validGapId,
            start_ms: 12500,
            duration_ms: 3000,
            reason_code: 'phone_call',
            received_at: new Date().toISOString(),
          },
        ]),
      });

      const res = await request(app)
        .get(`/api/consults/${sessionId}/devices/patient/gaps`)
        .set('Authorization', `Bearer ${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.gaps)).toBe(true);
      expect(res.body.gaps.length).toBe(1);
      expect(res.body.gaps[0].reason_code).toBe('phone_call');
    });
  });
});
