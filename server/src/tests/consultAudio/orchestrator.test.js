/**
 * End-of-Visit Orchestrator Unit and Integration Tests.
 *
 * Covers Phase 6 Acceptance Criteria:
 * 1. Simulated slow patient device: processing starts at the deadline, patient side flagged incomplete.
 * 2. Restart the server during ending: the session still finishes on time.
 * 3. A late chunk updates the transcript and marks the draft outdated.
 * 4. Fast path: all chunks transcribed early, session moves to processing before deadline.
 * 5. Doctor-only mode: wait only for doctor device when patient_required=false.
 * 6. Privacy & Safety: zero transcript text or clinical data in logs or socket events.
 */

const orchestratorService = require('../../services/consultAudio/orchestrator.service');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const socketService = require('../../services/consultAudio/socket.service');
const logger = require('../../utils/logger');
const { STATES } = require('../../services/consultAudio/stateMachine');
const { ok, mockTables } = require('../helpers/supabaseMock');

jest.mock('../../config/supabaseAdminClient', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
}));

jest.mock('../../services/consultAudio/socket.service', () => ({
  emitSessionState: jest.fn(),
  emitEndRequested: jest.fn(),
  emitTranscriptUpdated: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('Consultation End-of-Visit Orchestrator (Phase 6)', () => {
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const doctorUserId = 'doc-user-1';
  const patientUserId = 'patient-user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    orchestratorService.stop();
  });

  afterEach(() => {
    orchestratorService.stop();
  });

  describe('Fast Path: Early Completion Before Deadline', () => {
    test('transitions immediately to processing when all expected chunks are transcribed', async () => {
      const endingSession = {
        id: sessionId,
        status: STATES.ENDING,
        doctor_id: doctorUserId,
        patient_id: patientUserId,
        patient_required: true,
        end_deadline_at: new Date(Date.now() + 15000).toISOString(),
      };

      const devices = [
        { device: 'doctor', status: 'flushed', expected_chunks: 2 },
        { device: 'patient', status: 'flushed', expected_chunks: 2 },
      ];

      const chunks = [
        { seq: 0, device: 'doctor', status: 'transcribed', silent: false, start_ms: 0, duration_ms: 15000 },
        { seq: 1, device: 'doctor', status: 'transcribed', silent: false, start_ms: 15000, duration_ms: 15000 },
        { seq: 0, device: 'patient', status: 'transcribed', silent: false, start_ms: 0, duration_ms: 15000 },
        { seq: 1, device: 'patient', status: 'silent', silent: true, start_ms: 15000, duration_ms: 15000 },
      ];

      const processingSession = {
        ...endingSession,
        status: STATES.PROCESSING,
        incomplete_sides: [],
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
          ok(chunks.filter((c) => c.device === 'doctor')),  // check doctor chunks
          ok(chunks.filter((c) => c.device === 'patient')), // check patient chunks
          ok(chunks),                                      // finalize fetch all chunks
        ],
        consult_audio_gaps: ok([]),
        segments: ok([]),
      });

      const completed = await orchestratorService.checkCompleteness(sessionId);

      expect(completed).toBe(true);
      expect(socketService.emitSessionState).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          status: STATES.PROCESSING,
        })
      );
    });
  });

  describe('Acceptance Criterion 1: Simulated Slow Patient Device', () => {
    test('deadline expires, marks patient incomplete, and records missing sequence gaps', async () => {
      const endingSession = {
        id: sessionId,
        status: STATES.ENDING,
        doctor_id: doctorUserId,
        patient_id: patientUserId,
        patient_required: true,
        end_deadline_at: new Date(Date.now() - 1000).toISOString(), // expired
      };

      const devices = [
        { device: 'doctor', status: 'flushed', expected_chunks: 2 },
        { device: 'patient', status: 'recording', expected_chunks: 3 }, // Patient declared 3 chunks but only uploaded 1
      ];

      // Doctor uploaded seq 0, 1. Patient only uploaded seq 0 (seq 1, 2 are missing!)
      const chunks = [
        { id: 'c-d0', seq: 0, device: 'doctor', status: 'transcribed', silent: false, start_ms: 0, duration_ms: 15000 },
        { id: 'c-d1', seq: 1, device: 'doctor', status: 'transcribed', silent: false, start_ms: 15000, duration_ms: 15000 },
        { id: 'c-p0', seq: 0, device: 'patient', status: 'transcribed', silent: false, start_ms: 0, duration_ms: 15000 },
      ];

      const patientSegments = [
        { id: 'seg-p0', session_id: sessionId, device: 'patient', flags: [] },
      ];

      const processingSession = {
        ...endingSession,
        status: STATES.PROCESSING,
        incomplete_sides: ['patient'],
      };

      mockTables(supabaseAdmin, {
        consult_sessions: [
          ok(endingSession),     // finalize select
          ok(endingSession),     // transitionSession fetch
          ok(processingSession), // transitionSession update
        ],
        session_devices: [
          ok(devices), // finalize devices
          ok(devices), // transitionSession assertCanTransition
        ],
        session_consents: ok([]),
        audio_chunks: ok(chunks),
        consult_audio_gaps: ok({ id: 'gap-1' }),
        segments: [
          ok(patientSegments), // tagSegments select
          ok(patientSegments), // tagSegments update
        ],
      });

      const finalized = await orchestratorService.finalizeEndingSession(sessionId, { isOverdue: true });

      expect(finalized).toBeDefined();
      expect(finalized.status).toBe(STATES.PROCESSING);
      expect(finalized.incomplete_sides).toEqual(['patient']);
    });
  });

  describe('Acceptance Criterion 2: Server Restart Resumption', () => {
    test('immediately finalizes sessions whose deadline expired while server was offline', async () => {
      const expiredSession = {
        id: sessionId,
        status: STATES.ENDING,
        doctor_id: doctorUserId,
        patient_required: false,
        end_deadline_at: new Date(Date.now() - 5000).toISOString(),
      };

      const devices = [
        { device: 'doctor', status: 'flushed', expected_chunks: 1 },
      ];

      const chunks = [
        { id: 'c-1', seq: 0, device: 'doctor', status: 'transcribed', silent: false, start_ms: 0, duration_ms: 15000 },
      ];

      const processingSession = {
        ...expiredSession,
        status: STATES.PROCESSING,
        incomplete_sides: [],
      };

      mockTables(supabaseAdmin, {
        consult_sessions: [
          ok([expiredSession]),  // resumePendingEndingSessions
          ok(expiredSession),    // finalizeEndingSession select
          ok(expiredSession),    // transitionSession fetch
          ok(processingSession), // transitionSession update
        ],
        session_devices: [
          ok(devices), // finalize devices
          ok(devices), // transitionSession devices
        ],
        session_consents: ok([]),
        audio_chunks: ok(chunks),
        consult_audio_gaps: ok([]),
        segments: ok([]),
      });

      const resumedCount = await orchestratorService.resumePendingEndingSessions();

      expect(resumedCount).toBe(1);
    });

    test('schedules timer for sessions whose deadline is still in the future', async () => {
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

  describe('Acceptance Criterion 3: Late Chunk Updates Transcript & Flags Draft Outdated', () => {
    test('marks consult_sessions draft_outdated=true and adds late flag to segments', async () => {
      const lateChunk = {
        id: 'late-chunk-1',
        session_id: sessionId,
        device: 'patient',
        seq: 2,
        is_late: true,
      };

      const existingSegments = [
        { id: 'seg-late-1', flags: [] },
      ];

      mockTables(supabaseAdmin, {
        segments: [
          ok(existingSegments), // select segments for chunk
          ok({ id: 'seg-late-1', flags: ['late'] }), // update segment flags
        ],
        consult_sessions: ok({ id: sessionId, draft_outdated: true }),
      });

      await orchestratorService.handleLateChunkTranscribed(lateChunk);

      expect(socketService.emitTranscriptUpdated).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          draftOutdated: true,
          lateChunk: {
            device: 'patient',
            seq: 2,
          },
        })
      );
    });
  });

  describe('Doctor-Only Mode', () => {
    test('waits only for doctor device when patient_required is false and no patient joined', async () => {
      const doctorOnlySession = {
        id: sessionId,
        status: STATES.ENDING,
        doctor_id: doctorUserId,
        patient_required: false,
        end_deadline_at: new Date(Date.now() + 15000).toISOString(),
      };

      const devices = [
        { device: 'doctor', status: 'flushed', expected_chunks: 1 },
      ];

      const chunks = [
        { seq: 0, device: 'doctor', status: 'transcribed', silent: false, start_ms: 0, duration_ms: 15000 },
      ];

      const processingSession = {
        ...doctorOnlySession,
        status: STATES.PROCESSING,
        incomplete_sides: [],
      };

      mockTables(supabaseAdmin, {
        consult_sessions: [
          ok(doctorOnlySession), // checkCompleteness
          ok(doctorOnlySession), // finalize
          ok(doctorOnlySession), // transitionSession
          ok(processingSession), // update
        ],
        session_devices: [
          ok(devices),
          ok(devices),
          ok(devices),
        ],
        session_consents: ok([]),
        audio_chunks: [
          ok(chunks), // check doctor chunks
          ok(chunks), // finalize chunks
        ],
        consult_audio_gaps: ok([]),
        segments: ok([]),
      });

      const completed = await orchestratorService.checkCompleteness(sessionId);

      expect(completed).toBe(true);
      expect(socketService.emitSessionState).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          status: STATES.PROCESSING,
        })
      );
    });
  });

  describe('Privacy & Safety Compliance', () => {
    test('orchestrator logs and emits strictly metadata and error codes only', async () => {
      const lateChunk = {
        id: 'chunk-priv-1',
        session_id: sessionId,
        device: 'patient',
        seq: 1,
        is_late: true,
      };

      mockTables(supabaseAdmin, {
        segments: ok([]),
        consult_sessions: ok({ id: sessionId, draft_outdated: true }),
      });

      await orchestratorService.handleLateChunkTranscribed(lateChunk);

      // Check all logger calls
      const allLogCalls = [
        ...logger.info.mock.calls,
        ...logger.error.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.debug.mock.calls,
      ];

      for (const call of allLogCalls) {
        const payloadStr = JSON.stringify(call);
        expect(payloadStr).not.toMatch(/diagnosis|patient_name|prescription|transcript_text/i);
      }

      // Check socket calls
      const socketCalls = socketService.emitTranscriptUpdated.mock.calls;
      for (const call of socketCalls) {
        const payloadStr = JSON.stringify(call);
        expect(payloadStr).not.toMatch(/transcript_text|patient_name|blood_pressure/i);
      }
    });
  });
});
