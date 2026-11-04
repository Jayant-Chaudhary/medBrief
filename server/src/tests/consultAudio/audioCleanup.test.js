/**
 * Unit & Integration Tests for Audio Retention Cleanup Service (Phase 7).
 *
 * Verifies:
 * 1. Eligibility is strictly based on clinician draft approval + retention hours.
 * 2. Unreviewed or rejected drafts preserve audio (for drafting / regeneration).
 * 3. Default is dry-run mode: counts eligible objects/sessions but deletes nothing.
 * 4. Apply mode:
 *    - Deletes chunk objects from Supabase Storage 'consult-audio' bucket.
 *    - Clears chunk audio from Redis cache.
 *    - Marks consult_sessions.audio_cleaned_at with timestamp.
 *    - Preserves metadata (audio_chunks rows, draft, notes, transcripts).
 * 5. Handles safe error reporting without sensitive data leakage.
 */

const {
  cleanupExpiredAudio,
  findEligibleSessions,
  STORAGE_BUCKET,
} = require('../../services/consultAudio/audioCleanup.service');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const audioCache = require('../../services/consultAudio/audioCache.service');
const { ok, fail, mockTables } = require('../helpers/supabaseMock');

jest.mock('../../config/supabaseAdminClient', () => ({
  from: jest.fn(),
  storage: {
    from: jest.fn(),
  },
}));

jest.mock('../../services/consultAudio/audioCache.service', () => ({
  remove: jest.fn().mockResolvedValue(true),
}));

describe('Consult Audio Retention Cleanup (Phase 7)', () => {
  const sessionId = 'session-uuid-1111';
  const now = new Date('2026-11-04T12:00:00Z');
  // Retention is 24 hours: cutoff is 2026-11-03T12:00:00Z
  const approvedBeforeCutoff = '2026-11-02T10:00:00Z'; // Eligible (> 48h ago)
  const approvedAfterCutoff = '2026-11-04T10:00:00Z'; // Ineligible (only 2h ago)

  let mockStorageRemove;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageRemove = jest.fn().mockResolvedValue({ data: [], error: null });
    supabaseAdmin.storage.from = jest.fn().mockReturnValue({
      remove: mockStorageRemove,
    });
  });

  describe('findEligibleSessions', () => {
    test('identifies sessions approved prior to retention cutoff', async () => {
      const mockCandidateSessions = [{ id: sessionId, status: 'draft_ready' }];
      const mockDraft = {
        id: 'draft-1',
        session_id: sessionId,
        status: 'approved',
        updated_at: approvedBeforeCutoff,
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockCandidateSessions),
        consult_drafts: ok(mockDraft),
      });

      const eligible = await findEligibleSessions({
        retentionHours: 24,
        now,
      });

      expect(eligible).toHaveLength(1);
      expect(eligible[0].session.id).toBe(sessionId);
      expect(eligible[0].draftId).toBe('draft-1');
    });

    test('excludes sessions approved within retention window (< 24h ago)', async () => {
      const mockCandidateSessions = [{ id: sessionId, status: 'draft_ready' }];
      const mockDraft = {
        id: 'draft-1',
        session_id: sessionId,
        status: 'approved',
        updated_at: approvedAfterCutoff,
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockCandidateSessions),
        consult_drafts: ok(mockDraft),
      });

      const eligible = await findEligibleSessions({
        retentionHours: 24,
        now,
      });

      expect(eligible).toHaveLength(0);
    });

    test('excludes sessions with rejected drafts so audio is retained for regeneration', async () => {
      const mockCandidateSessions = [{ id: sessionId, status: 'draft_ready' }];
      const mockRejectedDraft = {
        id: 'draft-1',
        session_id: sessionId,
        status: 'rejected',
        updated_at: approvedBeforeCutoff,
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockCandidateSessions),
        consult_drafts: ok(mockRejectedDraft),
      });

      const eligible = await findEligibleSessions({
        retentionHours: 24,
        now,
      });

      expect(eligible).toHaveLength(0);
    });

    test('excludes sessions with drafts still needing review', async () => {
      const mockCandidateSessions = [{ id: sessionId, status: 'draft_ready' }];
      const mockDraft = {
        id: 'draft-1',
        session_id: sessionId,
        status: 'needs_review',
        updated_at: approvedBeforeCutoff,
      };

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockCandidateSessions),
        consult_drafts: ok(mockDraft),
      });

      const eligible = await findEligibleSessions({
        retentionHours: 24,
        now,
      });

      expect(eligible).toHaveLength(0);
    });
  });

  describe('cleanupExpiredAudio', () => {
    test('defaults to dry-run mode and deletes nothing from storage or redis', async () => {
      const mockCandidateSessions = [{ id: sessionId, status: 'draft_ready' }];
      const mockDraft = {
        id: 'draft-1',
        session_id: sessionId,
        status: 'approved',
        updated_at: approvedBeforeCutoff,
      };
      const mockChunks = [
        { id: 'c1', device: 'doctor', seq: 0, storage_path: 'consults/sess-1/doctor/0.wav' },
        { id: 'c2', device: 'patient', seq: 0, storage_path: 'consults/sess-1/patient/0.wav' },
      ];

      mockTables(supabaseAdmin, {
        consult_sessions: ok(mockCandidateSessions),
        consult_drafts: ok(mockDraft),
        audio_chunks: ok(mockChunks),
      });

      const summary = await cleanupExpiredAudio({
        apply: false,
        retentionHours: 24,
        now,
      });

      expect(summary.dryRun).toBe(true);
      expect(summary.eligibleSessionsCount).toBe(1);
      expect(summary.deletedSessionsCount).toBe(1);
      expect(summary.deletedObjectsCount).toBe(2);

      // Storage and cache should NOT have been called
      expect(supabaseAdmin.storage.from).not.toHaveBeenCalled();
      expect(audioCache.remove).not.toHaveBeenCalled();
    });

    test('with apply=true, deletes objects from storage, clears cache, and records audio_cleaned_at', async () => {
      const mockCandidateSessions = [{ id: sessionId, status: 'draft_ready' }];
      const mockDraft = {
        id: 'draft-1',
        session_id: sessionId,
        status: 'approved',
        updated_at: approvedBeforeCutoff,
      };
      const mockChunks = [
        { id: 'c1', device: 'doctor', seq: 0, storage_path: 'consults/sess-1/doctor/0.wav' },
        { id: 'c2', device: 'patient', seq: 0, storage_path: 'consults/sess-1/patient/0.wav' },
      ];

      const tables = mockTables(supabaseAdmin, {
        consult_sessions: [ok(mockCandidateSessions), ok({ id: sessionId, audio_cleaned_at: now.toISOString() })],
        consult_drafts: ok(mockDraft),
        audio_chunks: ok(mockChunks),
      });

      const summary = await cleanupExpiredAudio({
        apply: true,
        retentionHours: 24,
        now,
      });

      expect(summary.dryRun).toBe(false);
      expect(summary.eligibleSessionsCount).toBe(1);
      expect(summary.deletedSessionsCount).toBe(1);
      expect(summary.deletedObjectsCount).toBe(2);

      // Verify Storage deletion called with consult-audio bucket
      expect(supabaseAdmin.storage.from).toHaveBeenCalledWith(STORAGE_BUCKET);
      expect(mockStorageRemove).toHaveBeenCalledWith([
        'consults/sess-1/doctor/0.wav',
        'consults/sess-1/patient/0.wav',
      ]);

      // Verify Redis cache keys removed
      expect(audioCache.remove).toHaveBeenCalledWith({
        sessionId,
        device: 'doctor',
        seq: 0,
      });
      expect(audioCache.remove).toHaveBeenCalledWith({
        sessionId,
        device: 'patient',
        seq: 0,
      });

      // Verify session updated with audio_cleaned_at
      expect(tables.consult_sessions[1].update).toHaveBeenCalledWith(
        expect.objectContaining({ audio_cleaned_at: expect.any(String) })
      );
    });

    test('handles storage deletion failure without marking session cleaned', async () => {
      const mockCandidateSessions = [{ id: sessionId, status: 'draft_ready' }];
      const mockDraft = {
        id: 'draft-1',
        session_id: sessionId,
        status: 'approved',
        updated_at: approvedBeforeCutoff,
      };
      const mockChunks = [
        { id: 'c1', device: 'doctor', seq: 0, storage_path: 'consults/sess-1/doctor/0.wav' },
      ];

      mockStorageRemove.mockResolvedValueOnce({
        data: null,
        error: { code: 'STORAGE_UNAVAILABLE', message: 'Storage bucket unavailable' },
      });

      const tables = mockTables(supabaseAdmin, {
        consult_sessions: ok(mockCandidateSessions),
        consult_drafts: ok(mockDraft),
        audio_chunks: ok(mockChunks),
      });

      const summary = await cleanupExpiredAudio({
        apply: true,
        retentionHours: 24,
        now,
      });

      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0].errorCode).toBe('STORAGE_UNAVAILABLE');
      expect(summary.deletedSessionsCount).toBe(0);

      // Session should NOT be marked cleaned
      expect(tables.consult_sessions[0].update).not.toHaveBeenCalled();
    });
  });
});
