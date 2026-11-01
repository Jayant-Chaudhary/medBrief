const request = require('supertest');
const app = require('../../app');
const db = require('../../config/supabaseAdminClient');
const sessions = require('../../services/consultAudio/session.service');
const { signSessionToken } = require('../../services/consultAudio/token.service');
const { ok, mockTables, queryChain } = require('../helpers/supabaseMock');

jest.mock('../../config/supabaseAdminClient', () => ({ auth: { getUser: jest.fn() }, from: jest.fn() }));
jest.mock('../../utils/audioConverter', () => ({
  convertTo16kHzMonoWav: jest.fn(), checkFfmpegInstalled: jest.fn().mockResolvedValue(true),
}));
const session = { id: 'synthetic-session', doctor_id: 'doctor', patient_id: 'patient',
  status: 'created', room_code: 'SYN123', room_code_expires_at: new Date(Date.now() + 600000).toISOString() };

describe('Patient consultation access and single-use join', () => {
  beforeEach(() => jest.clearAllMocks());
  test('another patient cannot consume or reassign the appointment room', async () => {
    const chains = mockTables(db, { consult_sessions: ok(session) });
    await expect(sessions.joinSessionByRoomCode({roomCode: 'SYN123', patientUser: {id: 'other'}, clientIp: 'ownership'}))
      .rejects.toMatchObject({ status: 403 });
    expect(chains.consult_sessions[0].update).not.toHaveBeenCalled();
  });
  test('concurrent joins conditionally consume the code exactly once', async () => {
    let consumed = false;
    const updates = [];
    db.from.mockImplementation((table) => {
      const chain = queryChain(ok(null));
      if (table === 'session_devices') return chain;
      let updating = false;
      chain.update.mockImplementation(() => { updating = true; updates.push(chain); return chain; });
      chain.maybeSingle.mockImplementation(async () => {
        if (!updating) return ok(session);
        if (consumed) return ok(null);
        consumed = true; return ok({ id: session.id, status: 'waiting' });
      });
      return chain;
    });
    const results = await Promise.allSettled([0,1].map(() => sessions.joinSessionByRoomCode({
      roomCode:'SYN123', patientUser:{id:'patient'}, clientIp:'concurrent'})));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.status).toBe(409);
    for (const chain of updates) {
      expect(chain.eq).toHaveBeenCalledWith('room_code', 'SYN123');
      expect(chain.in).toHaveBeenCalledWith('status', ['created', 'waiting']);
    }
  });
  test('a scoped session token cannot read state after its user loses membership', async () => {
    mockTables(db, { consult_sessions: ok(session) });
    const token = signSessionToken({sessionId:session.id, device:'patient', role:'patient', userId:'other'});
    const response = await request(app).get(`/api/consults/${session.id}/state`).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403); expect(response.body.session).toBeUndefined();
  });
});
