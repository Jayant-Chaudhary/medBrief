/**
 * Transcription Worker Unit & Integration Tests.
 *
 * Verifies job claiming, audio conversion, FakeProvider transcription,
 * timeline mapping, retry with backoff, and crash recovery.
 */

const {
  claimNextJob,
  processJob,
  recoverStuckJobs,
  runWorkerIteration,
} = require('../../services/consultAudio/transcriptionWorker');
const FakeProvider = require('../../services/consultAudio/stt/fakeProvider');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const { convertTo16kHzMonoWav } = require('../../utils/audioConverter');

jest.mock('../../config/supabaseAdminClient');
jest.mock('../../utils/audioConverter');

describe('Consult Audio — Transcription Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    convertTo16kHzMonoWav.mockResolvedValue(Buffer.from('RIFF mock wav data'));
  });

  describe('claimNextJob', () => {
    it('returns null if no queued jobs are found', async () => {
      supabaseAdmin.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const job = await claimNextJob();
      expect(job).toBeNull();
    });

    it('claims candidate job atomically', async () => {
      const mockCandidate = { id: 'job-1', chunk_id: 'chunk-1', attempts: 0 };
      const mockClaimed = { id: 'job-1', chunk_id: 'chunk-1', attempts: 1, status: 'transcribing' };

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'transcription_jobs') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockImplementation((col, val) => {
              if (col === 'status' && val === 'queued') {
                return {
                  lte: jest.fn().mockReturnThis(),
                  order: jest.fn().mockReturnThis(),
                  limit: jest.fn().mockResolvedValue({ data: [mockCandidate], error: null }),
                  select: jest.fn().mockReturnThis(),
                  single: jest.fn().mockResolvedValue({ data: mockClaimed, error: null }),
                };
              }
              return {
                eq: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                single: jest.fn().mockResolvedValue({ data: mockClaimed, error: null }),
              };
            }),
            update: jest.fn().mockReturnThis(),
          };
        }
        return {};
      });

      const job = await claimNextJob();
      expect(job).not.toBeNull();
      expect(job.status).toBe('transcribing');
    });
  });

  describe('processJob', () => {
    it('handles silent chunks without invoking STT', async () => {
      const mockJob = { id: 'job-silent', chunk_id: 'chunk-silent', attempts: 1 };
      const mockChunk = {
        id: 'chunk-silent',
        session_id: 'sess-1',
        device: 'doctor',
        seq: 0,
        start_ms: 0,
        duration_ms: 15000,
        storage_path: null,
        silent: true,
        status: 'received',
      };

      const updateJobMock = jest.fn().mockReturnThis();
      const updateChunkMock = jest.fn().mockReturnThis();

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'audio_chunks') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockChunk, error: null }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        if (table === 'consult_sessions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'sess-1' }, error: null }),
            }),
          };
        }
        if (table === 'session_devices') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === 'transcription_jobs') {
          return {
            update: updateJobMock.mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        return {};
      });

      const fakeProvider = new FakeProvider();
      const spyTranscribe = jest.spyOn(fakeProvider, 'transcribe');

      const result = await processJob(mockJob, fakeProvider);

      expect(result.ok).toBe(true);
      expect(result.silent).toBe(true);
      expect(spyTranscribe).not.toHaveBeenCalled();
      expect(convertTo16kHzMonoWav).not.toHaveBeenCalled();
    });

    it('processes non-silent chunk, calls STT, and inserts mapped segments', async () => {
      const mockJob = { id: 'job-audio', chunk_id: 'chunk-audio', attempts: 1 };
      const mockChunk = {
        id: 'chunk-audio',
        session_id: 'sess-1',
        device: 'doctor',
        seq: 1,
        start_ms: 15000,
        duration_ms: 15000,
        storage_path: 'consults/sess-1/doctor/1.wav',
        silent: false,
        status: 'received',
      };

      const mockSession = {
        id: 'sess-1',
        language_code: 'hi',
        started_at: '2026-10-29T10:00:00.000Z',
      };

      const mockDevice = {
        device: 'doctor',
        offset_ms: 50,
        capture_zero_device_ms: new Date('2026-10-29T10:00:00.000Z').getTime(),
      };

      const mockAudioBlob = {
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      };

      supabaseAdmin.storage = {
        from: jest.fn().mockReturnValue({
          download: jest.fn().mockResolvedValue({ data: mockAudioBlob, error: null }),
        }),
      };

      let insertedSegments = null;
      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'audio_chunks') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockChunk, error: null }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        if (table === 'consult_sessions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockSession, error: null }),
            }),
          };
        }
        if (table === 'session_devices') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: mockDevice, error: null }),
          };
        }
        if (table === 'segments') {
          return {
            insert: jest.fn().mockImplementation((rows) => {
              insertedSegments = rows;
              return Promise.resolve({ data: rows, error: null });
            }),
          };
        }
        if (table === 'transcription_jobs') {
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        return {};
      });

      const fakeProvider = new FakeProvider();
      const result = await processJob(mockJob, fakeProvider);

      expect(result.ok).toBe(true);
      expect(result.segmentsCount).toBe(1);
      expect(convertTo16kHzMonoWav).toHaveBeenCalled();
      expect(insertedSegments).not.toBeNull();
      expect(insertedSegments[0].session_id).toBe('sess-1');
      expect(insertedSegments[0].device).toBe('doctor');
      // Timeline check: offset_ms = 50, start_ms = 15000 -> 15050
      expect(insertedSegments[0].start_ms).toBe(15050);
    });

    it('retries with exponential backoff on provider failure if attempts < max', async () => {
      const mockJob = { id: 'job-fail', chunk_id: 'chunk-fail', attempts: 1 };
      const mockChunk = {
        id: 'chunk-fail',
        session_id: 'sess-1',
        device: 'doctor',
        seq: 1,
        start_ms: 0,
        duration_ms: 15000,
        storage_path: 'consults/sess-1/doctor/1.wav',
        silent: false,
      };

      supabaseAdmin.storage = {
        from: jest.fn().mockReturnValue({
          download: jest.fn().mockResolvedValue({
            data: { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) },
            error: null,
          }),
        }),
      };

      let updatedJobData = null;
      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'audio_chunks') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockChunk, error: null }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        if (table === 'consult_sessions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'sess-1' }, error: null }),
            }),
          };
        }
        if (table === 'session_devices') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === 'transcription_jobs') {
          return {
            update: jest.fn().mockImplementation((data) => {
              updatedJobData = data;
              return { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
            }),
          };
        }
        return {};
      });

      const failingProvider = {
        name: 'failing',
        transcribe: jest.fn().mockRejectedValue(new Error('Provider timeout')),
      };

      const result = await processJob(mockJob, failingProvider);

      expect(result.ok).toBe(false);
      expect(updatedJobData).not.toBeNull();
      expect(updatedJobData.status).toBe('queued'); // Requeued with backoff
      expect(updatedJobData.next_attempt_at).toBeDefined();
    });

    it('marks permanently failed when attempts reach max', async () => {
      const mockJob = { id: 'job-max', chunk_id: 'chunk-max', attempts: 3 };
      const mockChunk = {
        id: 'chunk-max',
        session_id: 'sess-1',
        device: 'doctor',
        seq: 1,
        start_ms: 0,
        duration_ms: 15000,
        storage_path: 'consults/sess-1/doctor/1.wav',
        silent: false,
      };

      supabaseAdmin.storage = {
        from: jest.fn().mockReturnValue({
          download: jest.fn().mockResolvedValue({
            data: { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) },
            error: null,
          }),
        }),
      };

      let updatedJobData = null;
      let updatedChunkData = null;

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'audio_chunks') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockChunk, error: null }),
            }),
            update: jest.fn().mockImplementation((data) => {
              updatedChunkData = data;
              return { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
            }),
          };
        }
        if (table === 'consult_sessions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'sess-1' }, error: null }),
            }),
          };
        }
        if (table === 'session_devices') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === 'transcription_jobs') {
          return {
            update: jest.fn().mockImplementation((data) => {
              updatedJobData = data;
              return { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
            }),
          };
        }
        return {};
      });

      const failingProvider = {
        name: 'failing',
        transcribe: jest.fn().mockRejectedValue(new Error('Fatal STT error')),
      };

      const result = await processJob(mockJob, failingProvider);

      expect(result.ok).toBe(false);
      expect(updatedJobData.status).toBe('failed');
      expect(updatedChunkData.status).toBe('failed');
    });
  });

  describe('recoverStuckJobs', () => {
    it('recovers stuck jobs and requeues them', async () => {
      const stuckJobs = [{ id: 'stuck-1', attempts: 1 }];

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'transcription_jobs') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            lt: jest.fn().mockResolvedValue({ data: stuckJobs, error: null }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          };
        }
        return {};
      });

      const count = await recoverStuckJobs();
      expect(count).toBe(1);
    });
  });
});
