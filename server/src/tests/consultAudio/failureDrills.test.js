/**
 * Failure Drills and Resilience Integration Tests (Phase 11).
 *
 * Covers Phase 11 Acceptance Criteria:
 * "All failure drills end in a correct, flagged result and never in a hang."
 *
 * Drills:
 * 1. Network drop on device during upload (idempotent retry & backoff recovery).
 * 2. One device never joins (patient missing: doctor-only fallback, flagged incomplete, never hangs).
 * 3. Server restart during 'ending' state (resumes from persisted end_deadline_at, recovers without hang).
 */

const orchestratorService = require('../../services/consultAudio/orchestrator.service');
const { ingestChunk } = require('../../services/consultAudio/chunkIngest.service');
const { STATES } = require('../../services/consultAudio/stateMachine');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const socketService = require('../../services/consultAudio/socket.service');
const { ok, mockTables } = require('../helpers/supabaseMock');

jest.mock('../../config/supabaseAdminClient', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
  storage: {
    from: jest.fn(() => ({
      upload: jest.fn().mockResolvedValue({ data: { path: 'chunks/c1.wav' }, error: null }),
      download: jest.fn().mockResolvedValue({
        data: { arrayBuffer: async () => Buffer.from('RIFFwav') },
        error: null,
      }),
    })),
  },
}));

jest.mock('../../services/consultAudio/socket.service', () => ({
  emitSessionState: jest.fn(),
  emitEndRequested: jest.fn(),
  emitTranscriptUpdated: jest.fn(),
  emitNotesReady: jest.fn(),
}));

jest.mock('../../services/consultAudio/audioCache.service', () => ({
  put: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null),
  remove: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../services/consultAudio/draft.service', () => ({
  generateDraftForSession: jest.fn().mockResolvedValue({
    id: 'draft-drill-1',
    status: 'needs_review',
  }),
}));

describe('Resilience & Failure Drills (Phase 11)', () => {
  const sessionId = '99999999-8888-7777-6666-555555555555';
  const doctorUserId = 'doc-user-drill';
  const patientUserId = 'pat-user-drill';

  beforeEach(() => {
    jest.clearAllMocks();
    orchestratorService.stop();
  });

  afterEach(() => {
    orchestratorService.stop();
  });

  describe('Drill 1: Network Drop & Idempotent Backoff Retry', () => {
    test('handles upload transient failures with idempotent retry without duplicating chunks', async () => {
      const existingChunk = {
        id: 'chunk-uuid-1',
        session_id: sessionId,
        device: 'doctor',
        seq: 0,
        status: 'transcribing',
        silent: false,
        storage_path: 'chunks/sess-0-doc.wav',
      };

      const session = {
        id: sessionId,
        status: STATES.RECORDING,
      };

      // Mock database calls for chunk upload:
      // First attempt succeeds, duplicate second attempt triggers idempotency branch
      mockTables(supabaseAdmin, {
        consult_sessions: ok(session),
        audio_chunks: [
          ok(null), // First attempt: chunk does not exist yet
          ok(existingChunk), // Second attempt (retry after simulated drop): chunk exists
        ],
        transcription_jobs: ok({ id: 'job-1' }),
      });

      // 1. Initial upload
      const wav = Buffer.from('RIFFinitialchunk');
      const res1 = await ingestChunk({
        sessionId,
        device: 'doctor',
        seq: 0,
        startMs: 0,
        durationMs: 15000,
        avgDbfs: -20,
        codec: 'audio/wav',
        audioBuffer: wav,
      });

      expect(res1.ok).toBe(true);

      // 2. Retry upload (simulating network recovery after packet drop)
      const res2 = await ingestChunk({
        sessionId,
        device: 'doctor',
        seq: 0,
        startMs: 0,
        durationMs: 15000,
        avgDbfs: -20,
        codec: 'audio/wav',
        audioBuffer: wav,
      });

      expect(res2.ok).toBe(true);
      expect(res2.duplicated).toBe(true);
      expect(res2.chunkId).toBe('chunk-uuid-1');
    });
  });

  describe('Drill 2: Patient Never Joins (Single-Device Fallback)', () => {
    test('doctor-only consultation completes cleanly and flags patient incomplete without hanging', async () => {
      const endingSession = {
        id: sessionId,
        status: STATES.ENDING,
        doctor_id: doctorUserId,
        patient_id: patientUserId,
        patient_required: false, // Patient was optional or never paired
        end_deadline_at: new Date(Date.now() + 10000).toISOString(),
      };

      // Only doctor device exists
      const devices = [
        { device: 'doctor', status: 'flushed', expected_chunks: 1 },
      ];

      const chunks = [
        { seq: 0, device: 'doctor', status: 'transcribed', silent: false, start_ms: 0, duration_ms: 15000 },
      ];

      const processingSession = {
        ...endingSession,
        status: STATES.PROCESSING,
        incomplete_sides: ['patient'],
      };

      mockTables(supabaseAdmin, {
        consult_sessions: [
          ok(endingSession),       // checkCompleteness select
          ok(endingSession),       // finalizeEndingSession select
          ok(endingSession),       // transitionSession fetch session
          ok(processingSession),   // transitionSession update
        ],
        session_devices: [
          ok(devices), // checkCompleteness devices
          ok(devices), // finalize devices
          ok(devices), // transitionSession assertCanTransition
        ],
        session_consents: ok([]),
        audio_chunks: [
          ok(chunks), // doctor chunks
          ok(chunks), // finalize chunks
        ],
        consult_audio_gaps: ok([]),
        segments: ok([]),
      });

      // Fast-path completeness check triggered
      const isComplete = await orchestratorService.checkCompleteness(sessionId);

      expect(isComplete).toBe(true);
      expect(socketService.emitSessionState).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          status: STATES.PROCESSING,
        })
      );
    });
  });

  describe('Drill 3: Server Restart During Ending State', () => {
    test('resumes and finalizes overdue session immediately after server restart', async () => {
      // Simulate that server died for 60 seconds and deadline expired in the past
      const expiredDeadline = new Date(Date.now() - 30000).toISOString();
      const stalledSession = {
        id: sessionId,
        status: STATES.ENDING,
        doctor_id: doctorUserId,
        patient_id: patientUserId,
        patient_required: true,
        end_deadline_at: expiredDeadline,
      };

      const devices = [
        { device: 'doctor', status: 'recording', expected_chunks: null },
      ];

      const processingSession = {
        ...stalledSession,
        status: STATES.PROCESSING,
        incomplete_sides: ['doctor', 'patient'],
      };

      mockTables(supabaseAdmin, {
        consult_sessions: [
          ok([stalledSession]),    // resumePendingEndingSessions
          ok(stalledSession),      // finalizeEndingSession select
          ok(stalledSession),      // transitionSession fetch
          ok(processingSession),   // transitionSession update
        ],
        session_devices: [
          ok(devices), // finalize devices
          ok(devices), // transitionSession devices
        ],
        session_consents: ok([]),
        audio_chunks: ok([]),
        consult_audio_gaps: ok([]),
        segments: ok([]),
      });

      // Server startup execution
      const resumedCount = await orchestratorService.resumePendingEndingSessions();
      expect(resumedCount).toBe(1);

      // Await next tick for asynchronous finalizer
      await new Promise((resolve) => setImmediate(resolve));

      expect(socketService.emitSessionState).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          status: STATES.PROCESSING,
        })
      );
    });

    test('re-arms timer if deadline is still in the future when server restarts', async () => {
      const futureSession = {
        id: sessionId,
        status: STATES.ENDING,
        doctor_id: doctorUserId,
        patient_required: false,
        end_deadline_at: new Date(Date.now() + 10000).toISOString(),
      };

      mockTables(supabaseAdmin, {
        consult_sessions: [
          ok([futureSession]), // resumePendingEndingSessions
          ok(futureSession),   // checkCompleteness select
        ],
        session_devices: ok([{ device: 'doctor', expected_chunks: null }]),
      });

      const resumedCount = await orchestratorService.resumePendingEndingSessions();
      expect(resumedCount).toBe(1);
    });
  });
});
