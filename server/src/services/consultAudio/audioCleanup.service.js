/**
 * Consult Audio Retention Cleanup Service.
 *
 * Implements privacy-compliant audio lifecycle management:
 * - Retention countdown starts strictly upon clinician draft approval.
 * - Sessions with unreviewed or rejected drafts retain audio for draft regeneration.
 * - Safely deletes chunk audio from Supabase Storage and clears Redis cache.
 * - Retains transcripts, clinical notes, and chunk metadata.
 * - Marks consult_sessions.audio_cleaned_at only after Storage confirms deletion.
 * - Defaults to dry-run; requires apply: true for permanent deletion.
 * - Logs identifiers, counts, timings, and safe error codes only.
 */

const supabaseAdmin = require('../../config/supabaseAdminClient');
const config = require('../../config/consultAudio.config');
const audioCache = require('./audioCache.service');
const logger = require('../../utils/logger');

const STORAGE_BUCKET = 'consult-audio';

/**
 * Discovers sessions eligible for audio retention cleanup.
 *
 * @param {Object} options
 * @param {number} [options.retentionHours]
 * @param {Date} [options.now]
 * @param {number} [options.batchSize]
 * @returns {Promise<Array<Object>>}
 */
async function findEligibleSessions({
  retentionHours = config.audioRetentionAfterReviewHours,
  now = new Date(),
  batchSize = 50,
} = {}) {
  const cutoffTime = new Date(now.getTime() - retentionHours * 60 * 60 * 1000).toISOString();

  let { data: candidates, error: sessionErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, status, created_at')
    .is('audio_cleaned_at', null)
    .limit(batchSize);

  if (sessionErr && sessionErr.code === '42703') {
    // Graceful fallback if migration adding audio_cleaned_at is still pending
    const fallback = await supabaseAdmin
      .from('consult_sessions')
      .select('id, status, created_at')
      .limit(batchSize);
    candidates = fallback.data;
    sessionErr = fallback.error;
  }

  if (sessionErr) {
    logger.error('Failed to query uncleaned consult sessions', {
      scope: 'consult-audio-cleanup',
      errorCode: sessionErr.code || 'ERR_CLEANUP_CANDIDATE_QUERY',
    });
    throw sessionErr;
  }

  if (!candidates || candidates.length === 0) {
    return [];
  }

  const eligible = [];

  for (const session of candidates) {
    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('consult_drafts')
      .select('id, status, updated_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draftErr || !draft) {
      continue;
    }

    // Retention policy: draft must be 'approved' and approval timestamp <= cutoffTime
    if (draft.status === 'approved' && draft.updated_at <= cutoffTime) {
      eligible.push({
        session,
        approvedAt: draft.updated_at,
        draftId: draft.id,
      });
    }
  }

  return eligible;
}

/**
 * Runs audio retention cleanup.
 *
 * @param {Object} options
 * @param {boolean} [options.apply=false]
 * @param {number} [options.retentionHours]
 * @param {number} [options.batchSize=50]
 * @param {Date} [options.now=new Date()]
 * @returns {Promise<Object>}
 */
async function cleanupExpiredAudio({
  apply = false,
  retentionHours = config.audioRetentionAfterReviewHours,
  batchSize = 50,
  now = new Date(),
} = {}) {
  const startTime = Date.now();
  const eligibleSessions = await findEligibleSessions({ retentionHours, now, batchSize });

  const summary = {
    dryRun: !apply,
    eligibleSessionsCount: eligibleSessions.length,
    deletedSessionsCount: 0,
    deletedObjectsCount: 0,
    cleanedSessionIds: [],
    errors: [],
  };

  logger.info('Starting audio retention cleanup run', {
    scope: 'consult-audio-cleanup',
    dryRun: !apply,
    eligibleCount: eligibleSessions.length,
    retentionHours,
  });

  for (const { session } of eligibleSessions) {
    const sessionId = session.id;

    const { data: chunks, error: chunkErr } = await supabaseAdmin
      .from('audio_chunks')
      .select('id, device, seq, storage_path')
      .eq('session_id', sessionId);

    if (chunkErr) {
      logger.error('Failed to fetch chunks for audio cleanup', {
        scope: 'consult-audio-cleanup',
        sessionId,
        errorCode: chunkErr.code || 'ERR_FETCH_CHUNKS',
      });
      summary.errors.push({ sessionId, errorCode: chunkErr.code || 'ERR_FETCH_CHUNKS' });
      continue;
    }

    const storagePaths = (chunks || []).map((c) => c.storage_path).filter(Boolean);

    if (!apply) {
      summary.deletedObjectsCount += storagePaths.length;
      summary.deletedSessionsCount += 1;
      summary.cleanedSessionIds.push(sessionId);
      continue;
    }

    // Apply mode: delete storage objects from private bucket
    if (storagePaths.length > 0) {
      const { error: removeErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .remove(storagePaths);

      if (removeErr) {
        logger.error('Failed to remove audio objects from storage bucket', {
          scope: 'consult-audio-cleanup',
          sessionId,
          objectCount: storagePaths.length,
          errorCode: removeErr.code || 'ERR_STORAGE_REMOVE',
        });
        summary.errors.push({ sessionId, errorCode: removeErr.code || 'ERR_STORAGE_REMOVE' });
        continue;
      }
    }

    // Clear Redis cache keys
    for (const chunk of chunks || []) {
      try {
        await audioCache.remove({
          sessionId,
          device: chunk.device,
          seq: chunk.seq,
        });
      } catch (_cacheErr) {
        // Ephemeral cache errors are ignored
      }
    }

    // Mark session as cleaned
    const { error: updateErr } = await supabaseAdmin
      .from('consult_sessions')
      .update({ audio_cleaned_at: new Date().toISOString() })
      .eq('id', sessionId);

    if (updateErr && updateErr.code !== '42703') {
      logger.error('Failed to update audio_cleaned_at on session', {
        scope: 'consult-audio-cleanup',
        sessionId,
        errorCode: updateErr.code || 'ERR_MARK_CLEANED',
      });
      summary.errors.push({ sessionId, errorCode: updateErr.code || 'ERR_MARK_CLEANED' });
    } else {
      summary.deletedObjectsCount += storagePaths.length;
      summary.deletedSessionsCount += 1;
      summary.cleanedSessionIds.push(sessionId);
    }
  }

  summary.durationMs = Date.now() - startTime;
  logger.info('Completed audio retention cleanup run', {
    scope: 'consult-audio-cleanup',
    dryRun: !apply,
    deletedSessionsCount: summary.deletedSessionsCount,
    deletedObjectsCount: summary.deletedObjectsCount,
    durationMs: summary.durationMs,
  });

  return summary;
}

module.exports = {
  findEligibleSessions,
  cleanupExpiredAudio,
  STORAGE_BUCKET,
};
