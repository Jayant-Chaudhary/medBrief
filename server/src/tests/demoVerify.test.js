const request = require('supertest');
const app = require('../app');
const supabaseAdmin = require('../config/supabaseAdminClient');
const env = require('../config/env');
const { ok, mockTables, profileRow } = require('./helpers/supabaseMock');

jest.mock('../config/supabaseAdminClient', () => ({
  auth: { getUser: jest.fn() },
  from: jest.fn(),
}));

describe('Clinician self-verification and profile capability', () => {
  const user = { id: 'dr-1', email: 'dr@example.com' };
  const sendVerify = (token = 'Bearer t') =>
    request(app)
      .post('/api/profile/demo-verify')
      .set(token ? { Authorization: token } : {});
  const sendGetProfile = (token = 'Bearer t') =>
    request(app)
      .get('/api/profile')
      .set(token ? { Authorization: token } : {});

  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
    env.demoSelfVerify = true;
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('POST /api/profile/demo-verify', () => {
    it('should verify an unverified clinician when in development and demo switch is on', async () => {
      const chains = mockTables(supabaseAdmin, {
        profiles: profileRow('clinician', { verified: false }),
        clinician_details: ok(null),
      });

      const response = await sendVerify();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ isVerified: true });
      expect(chains.clinician_details[0].upsert).toHaveBeenCalledWith(
        { profile_id: user.id, is_verified: true },
        { onConflict: 'profile_id' }
      );
    });

    it('should refuse when the demo switch is off', async () => {
      env.demoSelfVerify = false;
      const chains = mockTables(supabaseAdmin, {
        profiles: profileRow('clinician', { verified: false }),
        clinician_details: ok(null),
      });

      const response = await sendVerify();

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/Self-verification is turned off/);
      expect(chains.clinician_details).toBeUndefined();
    });

    it('should refuse in production even if demoSelfVerify is set to true', async () => {
      process.env.NODE_ENV = 'production';
      env.demoSelfVerify = true;

      const chains = mockTables(supabaseAdmin, {
        profiles: profileRow('clinician', { verified: false }),
        clinician_details: ok(null),
      });

      const response = await sendVerify();

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/Self-verification is turned off/);
      expect(chains.clinician_details).toBeUndefined();
    });

    it('should refuse a patient', async () => {
      mockTables(supabaseAdmin, { profiles: profileRow('patient') });

      const response = await sendVerify();

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/Only clinician accounts are verified/);
    });

    it('should refuse unauthenticated calls', async () => {
      const response = await sendVerify(null);

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/profile canSelfVerify capability flag', () => {
    it('returns canSelfVerify: true for unverified clinician in development', async () => {
      mockTables(supabaseAdmin, {
        profiles: [
          profileRow('clinician', { verified: false }),
          ok({ id: user.id, role: 'clinician', full_name: 'Dr. Test', phone: '123' }),
        ],
        clinician_details: ok({ profile_id: user.id, is_verified: false, specialty: 'OBGYN' }),
      });

      const response = await sendGetProfile();

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('clinician');
      expect(response.body.isVerified).toBe(false);
      expect(response.body.canSelfVerify).toBe(true);
    });

    it('returns canSelfVerify: false when clinician is already verified', async () => {
      mockTables(supabaseAdmin, {
        profiles: [
          profileRow('clinician', { verified: true }),
          ok({ id: user.id, role: 'clinician', full_name: 'Dr. Test', phone: '123' }),
        ],
        clinician_details: ok({ profile_id: user.id, is_verified: true, specialty: 'OBGYN' }),
      });

      const response = await sendGetProfile();

      expect(response.status).toBe(200);
      expect(response.body.isVerified).toBe(true);
      expect(response.body.canSelfVerify).toBe(false);
    });

    it('returns canSelfVerify: false in production', async () => {
      process.env.NODE_ENV = 'production';
      env.demoSelfVerify = true;

      mockTables(supabaseAdmin, {
        profiles: [
          profileRow('clinician', { verified: false }),
          ok({ id: user.id, role: 'clinician', full_name: 'Dr. Test', phone: '123' }),
        ],
        clinician_details: ok({ profile_id: user.id, is_verified: false, specialty: 'OBGYN' }),
      });

      const response = await sendGetProfile();

      expect(response.status).toBe(200);
      expect(response.body.isVerified).toBe(false);
      expect(response.body.canSelfVerify).toBe(false);
    });

    it('does not offer canSelfVerify to patients', async () => {
      mockTables(supabaseAdmin, {
        profiles: [
          profileRow('patient', { fullName: 'Patient Test' }),
          ok({ id: user.id, role: 'patient', full_name: 'Patient Test', phone: '123' }),
        ],
        patient_details: ok({ profile_id: user.id, date_of_birth: '1995-01-01' }),
      });

      const response = await sendGetProfile();

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('patient');
      expect(response.body.canSelfVerify).toBeUndefined();
    });
  });

  describe('Unverified clinician action gating', () => {
    it('blocks unverified clinician from clinical actions via roleGuard', async () => {
      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician', { verified: false }),
      });

      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', 'Bearer t')
        .send({
          patientEmail: 'patient@example.com',
          patientFullName: 'Jane Doe',
          scheduledAt: new Date().toISOString(),
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/Clinician account is pending verification/);
    });
  });
});
