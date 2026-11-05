/**
 * Accepting an appointment invite links the patient to the clinician, which
 * opens the patient's records to them. A returning patient must consent with
 * their own current password, checked on a throwaway anon-key client.
 */

const request = require('supertest');
const { createClient } = require('@supabase/supabase-js');
const app = require('../app');
const env = require('../config/env');
const supabaseAdmin = require('../config/supabaseAdminClient');
const { ok, mockTables } = require('./helpers/supabaseMock');

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

jest.mock('../config/supabaseAdminClient', () => ({
  auth: {
    admin: { listUsers: jest.fn(), createUser: jest.fn() },
    signInWithPassword: jest.fn(),
    getUser: jest.fn(),
  },
  from: jest.fn(),
}));

describe('POST /api/auth/accept-invite', () => {
  const token = 'invite-token-0123456789';
  const invite = {
    id: 'invite-1',
    patient_email: 'returning@example.test',
    patient_full_name: 'Synthetic Patient',
    used_at: null,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    appointments: { id: 'appt-1', patient_id: null, status: 'invited' },
  };

  let anonSignIn;

  beforeEach(() => {
    jest.clearAllMocks();
    anonSignIn = jest.fn();
    createClient.mockReturnValue({
      auth: { signInWithPassword: anonSignIn, signOut: jest.fn().mockResolvedValue({}) },
    });
    supabaseAdmin.auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ id: 'patient-9', email: invite.patient_email }] },
      error: null,
    });
  });

  const accept = (password) =>
    request(app).post('/api/auth/accept-invite').send({ token, password });

  it('refuses a returning patient whose password is wrong, without linking anyone', async () => {
    anonSignIn.mockResolvedValue({
      data: { session: null },
      error: { status: 400, code: 'invalid_credentials' },
    });
    const chains = mockTables(supabaseAdmin, { appointment_invites: ok(invite) });

    const res = await accept('not-their-password');

    expect(res.status).toBe(401);
    expect(chains.appointments).toBeUndefined();
    expect(chains.appointment_invites).toHaveLength(1); // read only, not marked used
  });

  it('checks the password on an anon-key client, never the service-role client', async () => {
    anonSignIn.mockResolvedValue({ data: { session: null }, error: { status: 400 } });
    mockTables(supabaseAdmin, { appointment_invites: ok(invite) });

    await accept('whatever-password');

    expect(createClient).toHaveBeenCalledWith(env.supabaseUrl, env.supabaseAnonKey, expect.any(Object));
    expect(supabaseAdmin.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('links a returning patient who confirms their password', async () => {
    anonSignIn.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null });
    const chains = mockTables(supabaseAdmin, {
      appointment_invites: ok(invite),
      profiles: ok({ id: 'patient-9', full_name: 'Synthetic Patient', role: 'patient' }),
      appointments: ok(null),
    });

    const res = await accept('correct-password');

    expect(res.status).toBe(200);
    expect(res.body.isReturningPatient).toBe(true);
    expect(chains.appointments[0].update).toHaveBeenCalledWith({ patient_id: 'patient-9', status: 'active' });
    expect(supabaseAdmin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('refuses to link a staff account as a patient', async () => {
    anonSignIn.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null });
    const chains = mockTables(supabaseAdmin, {
      appointment_invites: ok(invite),
      profiles: ok({ id: 'patient-9', full_name: 'Synthetic Clinician', role: 'clinician' }),
    });

    const res = await accept('correct-password');

    expect(res.status).toBe(409);
    expect(chains.appointments).toBeUndefined();
  });

  it('surfaces an auth outage instead of treating it as a wrong password', async () => {
    anonSignIn.mockResolvedValue({ data: null, error: { status: 503, code: 'unavailable' } });
    mockTables(supabaseAdmin, { appointment_invites: ok(invite) });

    const res = await accept('correct-password');
    expect(res.status).toBe(503);
  });
});
