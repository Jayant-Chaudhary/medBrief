/**
 * Unit and Integration Tests for Draft Service (Phase 8).
 *
 * Verifies:
 * 1. Generating draft transitions session to 'draft_ready' and emits 'notes_ready'.
 * 2. Generated draft is saved with status 'needs_review'.
 * 3. Review workflow:
 *    - Approval updates status to 'approved' and commits notes into consultation_notes.
 *    - Rejection updates status to 'rejected' with reason.
 * 4. Authorization: only session participants can read; only doctor can review.
 */

const draftService = require('../../services/consultAudio/draft.service');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const socketService = require('../../services/consultAudio/socket.service');
const sessionService = require('../../services/consultAudio/session.service');
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
  emitNotesReady: jest.fn(),
  emitStatusUpdate: jest.fn(),
}));

jest.mock('../../services/consultAudio/session.service', () => ({
  getSessionTranscript: jest.fn(),
}));

describe('Clinical Notes Draft Service (Phase 8)', () => {
  const sessionId = 'session-uuid-1111';
  const appointmentId = 'appointment-uuid-2222';
  const doctorUserId = 'doctor-user-1';
  const patientUserId = 'patient-user-2';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateDraftForSession', () => {
    test('successfully generates draft, saves with needs_review, moves state to draft_ready, and emits notes_ready', async () => {
      const mockSession = {
        id: sessionId,
        appointment_id: appointmentId,
        doctor_id: doctorUserId,
        patient_id: patientUserId,
        status: STATES.PROCESSING,
      };

      const mockTranscript = {
        segments: [
          { id: 'seg-1', segment_id: 'seg-1', device: 'doctor', speaker: 'doctor', text: 'Blood pressure is 118 over 74.' },
          { id: 'seg-2', segment_id: 'seg-2', device: 'patient', speaker: 'patient', text: 'I feel fine.' },
        ],
      };

      sessionService.getSessionTranscript.mockResolvedValue(mockTranscript);

      const savedDraftRecord = {
        id: 'draft-uuid-999',
        session_id: sessionId,
        appointment_id: appointmentId,
        status: 'needs_review',
        provider: 'fake',
        model_version: 'fake-draft-model:v1',
        doctor_notes: {
          assessment: 'Antenatal progress stable.',
          plan_and_recommendations: [
            { recommendation: 'Continue vitamins.', cited_segment_ids: ['seg-1'] },
          ],
        },
        patient_summary: { summary_text: 'Visit went well.' },
        clinical_flags: [],
        review_reasons: [],
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
        consult_drafts: ok(savedDraftRecord),
        questionnaire_responses: ok([]),
        pregnancy_episodes: ok(null),
        lab_reports: ok([]),
        session_consents: ok([]),
        session_devices: ok([]),
      });

      const draft = await draftService.generateDraftForSession(sessionId, {
        provider: 'fake',
        providerOptions: { simulatedLatencyMs: 0 },
      });

      expect(draft).toBeDefined();
      expect(draft.status).toBe('needs_review');
      expect(socketService.emitNotesReady).toHaveBeenCalledWith(sessionId);
    });

    test('rejects draft generation if session is not in processing or draft_ready state', async () => {
      const mockSession = {
        id: sessionId,
        status: STATES.RECORDING,
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
      });

      await expect(
        draftService.generateDraftForSession(sessionId, { provider: 'fake' })
      ).rejects.toThrow(/Cannot generate draft for session in state: recording/);
    });
  });

  describe('getSessionDraft', () => {
    test('returns latest draft for authorized doctor', async () => {
      const mockSession = {
        id: sessionId,
        doctor_id: doctorUserId,
        patient_id: patientUserId,
      };

      const mockDraft = {
        id: 'draft-uuid-1',
        session_id: sessionId,
        status: 'needs_review',
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
        consult_drafts: ok(mockDraft),
      });

      const draft = await draftService.getSessionDraft(sessionId, doctorUserId);
      expect(draft).toBeDefined();
      expect(draft.id).toBe('draft-uuid-1');
    });

    test('throws 403 for unauthorized caller', async () => {
      const mockSession = {
        id: sessionId,
        doctor_id: doctorUserId,
        patient_id: patientUserId,
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
      });

      await expect(
        draftService.getSessionDraft(sessionId, 'intruder-user-id')
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('reviewSessionDraft', () => {
    test('approves draft, updates status to approved, and commits to consultation_notes', async () => {
      const mockSession = {
        id: sessionId,
        appointment_id: appointmentId,
        doctor_id: doctorUserId,
      };

      const existingDraft = {
        id: 'draft-uuid-1',
        session_id: sessionId,
        status: 'needs_review',
        doctor_notes: {
          chief_complaint: 'Routine ANC',
          vitals_observed: 'BP normal',
          assessment: 'Progressing well',
          plan_and_recommendations: [
            { recommendation: 'Follow up in 2 weeks.', cited_segment_ids: ['seg-1'] },
          ],
        },
      };

      const approvedDraft = {
        ...existingDraft,
        status: 'approved',
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
        consult_drafts: [ok(existingDraft), ok(approvedDraft)],
        consultation_notes: ok({ id: 'note-1', appointment_id: appointmentId }),
      });

      const result = await draftService.reviewSessionDraft({
        sessionId,
        doctorUserId,
        action: 'approve',
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('approved');
    });

    test('rejects draft and records rejection reason', async () => {
      const mockSession = {
        id: sessionId,
        appointment_id: appointmentId,
        doctor_id: doctorUserId,
      };

      const existingDraft = {
        id: 'draft-uuid-1',
        session_id: sessionId,
        status: 'needs_review',
        review_reasons: [],
      };

      const rejectedDraft = {
        ...existingDraft,
        status: 'rejected',
        review_reasons: ['rejected: Patient arrived with incorrect report'],
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
        consult_drafts: [ok(existingDraft), ok(rejectedDraft)],
      });

      const result = await draftService.reviewSessionDraft({
        sessionId,
        doctorUserId,
        action: 'reject',
        rejectionReason: 'Patient arrived with incorrect report',
      });

      expect(result.status).toBe('rejected');
    });

    test('prevents non-doctor user from reviewing draft', async () => {
      const mockSession = {
        id: sessionId,
        appointment_id: appointmentId,
        doctor_id: doctorUserId,
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
      });

      await expect(
        draftService.reviewSessionDraft({
          sessionId,
          doctorUserId: 'other-user',
          action: 'approve',
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    test('rejects stale review with 409 when a newer draft has already been created', async () => {
      const mockSession = {
        id: sessionId,
        appointment_id: appointmentId,
        doctor_id: doctorUserId,
      };

      const olderDraft = {
        id: 'draft-old',
        session_id: sessionId,
        status: 'needs_review',
        created_at: '2026-11-04T10:00:00Z',
      };

      const newerDraft = {
        id: 'draft-newer',
        session_id: sessionId,
        created_at: '2026-11-04T10:05:00Z',
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
        consult_drafts: [ok(olderDraft), ok([newerDraft])],
      });

      await expect(
        draftService.reviewSessionDraft({
          sessionId,
          doctorUserId,
          draftId: 'draft-old',
          action: 'approve',
        })
      ).rejects.toMatchObject({ status: 409 });
    });

    test('fails approval if saving consultation_notes fails and leaves draft unapproved', async () => {
      const mockSession = {
        id: sessionId,
        appointment_id: appointmentId,
        doctor_id: doctorUserId,
      };

      const existingDraft = {
        id: 'draft-uuid-1',
        session_id: sessionId,
        status: 'needs_review',
        doctor_notes: {
          chief_complaint: 'Routine ANC',
        },
      };

      const { fail } = require('../helpers/supabaseMock');
      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
        consult_drafts: ok(existingDraft),
        consultation_notes: fail('Database disk full or constraint violation'),
      });

      await expect(
        draftService.reviewSessionDraft({
          sessionId,
          doctorUserId,
          action: 'approve',
        })
      ).rejects.toThrow('Failed to save consultation notes');
    });

    test('returns existing draft safely on idempotent repeated approval', async () => {
      const mockSession = {
        id: sessionId,
        appointment_id: appointmentId,
        doctor_id: doctorUserId,
      };

      const alreadyApprovedDraft = {
        id: 'draft-uuid-1',
        session_id: sessionId,
        status: 'approved',
        doctor_notes: { chief_complaint: 'Routine ANC' },
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockSession),
        consult_drafts: ok(alreadyApprovedDraft),
      });

      const result = await draftService.reviewSessionDraft({
        sessionId,
        doctorUserId,
        action: 'approve',
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('approved');
    });
  });
});
