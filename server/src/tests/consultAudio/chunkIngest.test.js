/**
 * Audio Chunk Ingestion & Final Marker Integration Tests.
 */

const request = require('supertest');
const app = require('../../app');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const { signSessionToken } = require('../../services/consultAudio/token.service');
const { ok } = require('../helpers/supabaseMock');
const audioCache = require('../../services/consultAudio/audioCache.service');

jest.mock('../../services/consultAudio/audioCache.service', () => ({
  put: jest.fn().mockResolvedValue(true),
  remove: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../config/supabaseAdminClient', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
  storage: {
    from: jest.fn(),
  },
}));

describe('Audio Chunk Ingestion & Final Markers', () => {
  const sessionId = 'sess-chunk-test-1';
  const doctorToken = signSessionToken({
    sessionId,
    device: 'doctor',
    role: 'doctor',
    userId: 'user-doc-1',
  });
  const patientToken = signSessionToken({
    sessionId,
    device: 'patient',
    role: 'patient',
    userId: 'user-pt-1',
  });

  const mockStorageUpload = jest.fn();
  const mockJobInsert = jest.fn();
  const mockJobLookup = jest.fn();
  const jobQuery = () => ({
    insert: mockJobInsert,
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: mockJobLookup,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockJobInsert.mockResolvedValue(ok(null));
    mockJobLookup.mockResolvedValue(ok([{ id: 'legacy-job' }]));
    supabaseAdmin.storage.from.mockReturnValue({
      upload: mockStorageUpload.mockResolvedValue({ data: { path: 'path/to/chunk' }, error: null }),
    });
  });

  describe('POST /api/consults/:id/chunks', () => {
    const sampleAudioBytes = Buffer.alloc(1024, 0x11);

    test('successfully ingests audio chunk in recording state', async () => {
      // Mock consult_sessions query
      const sessionQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(ok({ id: sessionId, status: 'recording' })),
      };

      // Mock audio_chunks idempotency check (not found) and insert
      const chunkSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue(ok(null)),
      };
      const chunkInsertQuery = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(ok({
          id: 'chunk-uuid-1',
          session_id: sessionId,
          device: 'doctor',
          seq: 0,
          status: 'received',
          is_late: false,
        })),
      };

      let chunkCallCount = 0;
      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'transcription_jobs') return jobQuery();
        if (table === 'consult_sessions') return sessionQuery;
        if (table === 'audio_chunks') {
          chunkCallCount++;
          return chunkCallCount === 1 ? chunkSelectQuery : chunkInsertQuery;
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await request(app)
        .post(`/api/consults/${sessionId}/chunks`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('x-device', 'doctor')
        .set('x-seq', '0')
        .set('x-start-ms', '0')
        .set('x-duration-ms', '15000')
        .set('x-avg-dbfs', '-22.5')
        .set('Content-Type', 'audio/wav')
        .send(sampleAudioBytes);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.duplicated).toBe(false);
      expect(res.body.seq).toBe(0);
      expect(res.body.status).toBe('received');
      expect(res.body.sessionState).toBe('recording');

      // Verify storage upload was called with proper path
      expect(mockStorageUpload).toHaveBeenCalledWith(
        `consults/${sessionId}/doctor/0.wav`,
        expect.any(Buffer),
        expect.objectContaining({ contentType: 'audio/wav', upsert: true })
      );
      expect(audioCache.put).toHaveBeenCalledWith(
        { sessionId, device: 'doctor', seq: 0 }, sampleAudioBytes,
      );
      expect(mockStorageUpload.mock.invocationCallOrder[0]).toBeLessThan(audioCache.put.mock.invocationCallOrder[0]);
      expect(audioCache.put.mock.invocationCallOrder[0]).toBeLessThan(mockJobInsert.mock.invocationCallOrder[0]);
      expect(mockJobInsert).toHaveBeenCalledWith(expect.objectContaining({
        id: 'chunk-uuid-1', chunk_id: 'chunk-uuid-1', status: 'queued',
      }));
    });

    test('is idempotent: same chunk twice returns 200 with duplicated: true without re-uploading file', async () => {
      const sessionQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(ok({ id: sessionId, status: 'recording' })),
      };

      // Existing chunk already present in database
      const existingChunkQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue(ok({
          id: 'existing-chunk-1',
          seq: 0,
          status: 'received',
          silent: false,
        })),
      };

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'transcription_jobs') return jobQuery();
        if (table === 'consult_sessions') return sessionQuery;
        if (table === 'audio_chunks') return existingChunkQuery;
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await request(app)
        .post(`/api/consults/${sessionId}/chunks`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('x-device', 'doctor')
        .set('x-seq', '0')
        .set('x-start-ms', '0')
        .set('x-duration-ms', '15000')
        .set('Content-Type', 'audio/wav')
        .send(sampleAudioBytes);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.duplicated).toBe(true);
      expect(res.body.chunkId).toBe('existing-chunk-1');

      // Storage upload should NOT have been invoked on duplicate
      expect(mockStorageUpload).not.toHaveBeenCalled();
      expect(audioCache.put).not.toHaveBeenCalled();
      expect(mockJobInsert).not.toHaveBeenCalled();
    });

    test('rejects chunk when x-device does not match scoped token device', async () => {
      const res = await request(app)
        .post(`/api/consults/${sessionId}/chunks`)
        .set('Authorization', `Bearer ${patientToken}`) // patient token
        .set('x-device', 'doctor') // trying to send as doctor
        .set('x-seq', '0')
        .set('x-start-ms', '0')
        .set('x-duration-ms', '15000')
        .send(sampleAudioBytes);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/does not match scoped session token/i);
    });

    test('rejects chunk when session has not started (e.g. state is waiting)', async () => {
      const sessionQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(ok({ id: sessionId, status: 'waiting' })),
      };

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'transcription_jobs') return jobQuery();
        if (table === 'consult_sessions') return sessionQuery;
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await request(app)
        .post(`/api/consults/${sessionId}/chunks`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('x-device', 'doctor')
        .set('x-seq', '0')
        .set('x-start-ms', '0')
        .set('x-duration-ms', '15000')
        .send(sampleAudioBytes);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/session is in 'waiting' state/i);
    });

    test('handles silent chunk: creates metadata row with status silent, no storage upload', async () => {
      const sessionQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(ok({ id: sessionId, status: 'recording' })),
      };

      const chunkSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue(ok(null)),
      };
      const chunkInsertQuery = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockImplementation((payload) => {
          return Promise.resolve(ok({
            id: 'silent-chunk-1',
            session_id: sessionId,
            device: 'doctor',
            seq: 1,
            status: 'silent',
            silent: true,
            storage_path: null,
          }));
        }),
      };

      let chunkCallCount = 0;
      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'consult_sessions') return sessionQuery;
        if (table === 'audio_chunks') {
          chunkCallCount++;
          return chunkCallCount === 1 ? chunkSelectQuery : chunkInsertQuery;
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await request(app)
        .post(`/api/consults/${sessionId}/chunks`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('x-device', 'doctor')
        .set('x-seq', '1')
        .set('x-start-ms', '15000')
        .set('x-duration-ms', '15000')
        .set('x-silent', 'true')
        .send(Buffer.alloc(0)); // empty body

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe('silent');
      expect(mockStorageUpload).not.toHaveBeenCalled();
      expect(audioCache.put).not.toHaveBeenCalled();
      expect(mockJobInsert).not.toHaveBeenCalled();
    });

    test('accepts late chunk when session is in processing and marks isLate = true', async () => {
      const sessionQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(ok({ id: sessionId, status: 'processing' })),
      };

      const chunkSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue(ok(null)),
      };
      const chunkInsertQuery = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(ok({
          id: 'late-chunk-1',
          seq: 5,
          status: 'received',
          is_late: true,
        })),
      };

      let chunkCallCount = 0;
      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'transcription_jobs') return jobQuery();
        if (table === 'consult_sessions') return sessionQuery;
        if (table === 'audio_chunks') {
          chunkCallCount++;
          return chunkCallCount === 1 ? chunkSelectQuery : chunkInsertQuery;
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await request(app)
        .post(`/api/consults/${sessionId}/chunks`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .set('x-device', 'doctor')
        .set('x-seq', '5')
        .set('x-start-ms', '75000')
        .set('x-duration-ms', '15000')
        .set('Content-Type', 'audio/wav')
        .send(sampleAudioBytes);

      expect(res.status).toBe(200);
      expect(res.body.isLate).toBe(true);
      expect(res.body.sessionState).toBe('processing');
    });
  });

  describe('POST /api/consults/:id/devices/:device/final (Final Marker)', () => {
    test('successfully records expected chunks and marks device flushed', async () => {
      const sessionQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(ok({ id: sessionId, status: 'ending' })),
      };

      const deviceUpdateQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue(ok({
          session_id: sessionId,
          device: 'doctor',
          expected_chunks: 10,
          status: 'flushed',
        })),
      };

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'consult_sessions') return sessionQuery;
        if (table === 'session_devices') return deviceUpdateQuery;
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await request(app)
        .post(`/api/consults/${sessionId}/devices/doctor/final`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ total_chunks: 10 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.expectedChunks).toBe(10);
      expect(res.body.sessionState).toBe('ending');
    });

    test('rejects missing total_chunks parameter', async () => {
      const res = await request(app)
        .post(`/api/consults/${sessionId}/devices/doctor/final`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/total_chunks is required/i);
    });
  });

  describe('Cache and durable acknowledgement failures', () => {
    const bytes = Buffer.from('synthetic-audio-marker');
    const storedChunk = {
      id: 'synthetic-chunk', session_id: sessionId, device: 'doctor', seq: 0,
      status: 'received', silent: false, storage_path: 'consults/synthetic/doctor/0.wav',
    };

    function setup({ existing = false, metadataError = null } = {}) {
      let persisted = existing;
      const metadataInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(async () => {
            if (metadataError) return { data: null, error: metadataError };
            persisted = true;
            return ok(storedChunk);
          }),
        }),
      });
      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'consult_sessions') return {
          select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue(ok({ id: sessionId, status: 'recording' })),
        };
        if (table === 'audio_chunks') return {
          select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn(async () => ok(persisted ? storedChunk : null)),
          insert: metadataInsert,
        };
        if (table === 'transcription_jobs') return jobQuery();
        throw new Error('Unexpected mock table');
      });
      return { metadataInsert };
    }

    function upload({ token = doctorToken, body = bytes } = {}) {
      const call = request(app).post(`/api/consults/${sessionId}/chunks`)
        .set('Content-Type', 'audio/wav').set('x-device', 'doctor')
        .set('x-seq', '0').set('x-start-ms', '0').set('x-duration-ms', '15000');
      if (token) call.set('Authorization', `Bearer ${token}`);
      return call.send(body);
    }

    test('cache unavailable does not prevent durable upload and job creation', async () => {
      setup();
      audioCache.put.mockResolvedValueOnce(false);
      expect((await upload()).status).toBe(200);
      expect(mockStorageUpload).toHaveBeenCalledTimes(1);
      expect(mockJobInsert).toHaveBeenCalledTimes(1);
    });

    test('storage failure is retryable, sanitized and never cached or queued', async () => {
      setup();
      mockStorageUpload.mockResolvedValueOnce({ error: { message: 'synthetic-sensitive-marker' } });
      const response = await upload();
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.body)).not.toContain('synthetic-sensitive-marker');
      expect(audioCache.put).not.toHaveBeenCalled();
      expect(mockJobInsert).not.toHaveBeenCalled();
    });

    test('metadata failure is retryable and removes abandoned cached bytes', async () => {
      setup({ metadataError: { message: 'synthetic-sensitive-marker' } });
      const response = await upload();
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.body)).not.toContain('synthetic-sensitive-marker');
      expect(audioCache.remove).toHaveBeenCalledWith({ sessionId, device: 'doctor', seq: 0 });
      expect(mockJobInsert).not.toHaveBeenCalled();
    });

    test('failed job publication is repaired on upload retry without a second storage upload', async () => {
      setup();
      mockJobLookup.mockResolvedValue(ok([]));
      mockJobInsert.mockResolvedValueOnce({ error: { message: 'synthetic-sensitive-marker' } });
      expect((await upload()).status).toBe(503);
      const response = await upload();
      expect(response.status).toBe(200);
      expect(response.body.duplicated).toBe(true);
      expect(mockStorageUpload).toHaveBeenCalledTimes(1);
      expect(audioCache.put).toHaveBeenCalledTimes(1);
      expect(mockJobInsert).toHaveBeenCalledTimes(2);
      expect(mockJobInsert.mock.calls[0][0].id).toBe(mockJobInsert.mock.calls[1][0].id);
    });

    test('simultaneous duplicate repairs use the same job primary key', async () => {
      setup({ existing: true });
      mockJobLookup.mockResolvedValue(ok([]));
      mockJobInsert.mockResolvedValueOnce(ok(null)).mockResolvedValueOnce({ error: { code: '23505' } });
      const results = await Promise.all([upload(), upload()]);
      expect(results.map((value) => value.status)).toEqual([200, 200]);
      expect(mockJobInsert.mock.calls.map(([job]) => job.id)).toEqual([storedChunk.id, storedChunk.id]);
      expect(mockStorageUpload).not.toHaveBeenCalled();
      expect(audioCache.put).not.toHaveBeenCalled();
    });

    test.each([
      ['unauthorized', { token: null }, 401],
      ['wrong session', { token: signSessionToken({ sessionId: 'other-session', device: 'doctor', role: 'doctor', userId: 'synthetic-doctor' }) }, 403],
      ['oversized', { body: Buffer.alloc(2000001) }, 413],
    ])('%s uploads never reach cache or storage', async (_name, options, status) => {
      setup();
      expect((await upload(options)).status).toBe(status);
      expect(audioCache.put).not.toHaveBeenCalled();
      expect(mockStorageUpload).not.toHaveBeenCalled();
      expect(mockJobInsert).not.toHaveBeenCalled();
    });
  });
});
