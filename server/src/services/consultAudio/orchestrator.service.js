/**
 * End-of-Visit Orchestrator Service.
 *
 * Coordinates reliable, time-boxed conclusion of consultation sessions:
 * - Persisted deadline management surviving server restarts.
 * - Early completion fast-path when all expected chunks are transcribed.
 * - Missing chunk sequence detection recorded as explicit timeline gaps.
 * - Incomplete side flagging in consult_sessions and segment flags.
 * - Doctor-only mode handling.
 * - Late chunk ingestion and draft_outdated flagging.
 *
 * Adheres strictly to privacy rules: zero transcript text, health values, or patient names in logs or socket events.
 */

const crypto = require('crypto');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const config = require('../../config/consultAudio.config');
const { STATES, transitionSession } = require('./stateMachine');
const socketService = require('./socket.service');
const { recordGap } = require('./gap.service');
const logger = require('../../utils/logger');

const activeTimers = new Map();
const finalizingSessions = new Set();
let pollIntervalId = null;

/**
 * Starts the orchestrator background scheduler.
 * Recovers pending ending sessions on startup and launches periodic audit poll.
 */
async function start() {
  if (pollIntervalId) return;

  await resumePendingEndingSessions();
  if (process.env.NODE_ENV !== 'test') void resumeProcessingWithoutDraft();

  const pollIntervalMs = config.orchestratorPollMs || 1000;
  pollIntervalId = setInterval(async () => {
    try {
      await pollOverdueSessions();
    } catch (err) {
      logger.error('Error during orchestrator poll iteration', {
        scope: 'consult-orchestrator',
        errorCode: 'ERR_ORCHESTRATOR_POLL',
      });
    }
  }, pollIntervalMs);

  if (typeof pollIntervalId.unref === 'function') {
    pollIntervalId.unref();
  }

  logger.info('End-of-visit orchestrator started', {
    scope: 'consult-orchestrator',
    pollIntervalMs,
  });
}

/**
 * Stops the orchestrator and clears all active timers and background intervals.
 */
function stop() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  for (const [sessionId, timer] of activeTimers.entries()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  finalizingSessions.clear();

  logger.info('End-of-visit orchestrator stopped', {
    scope: 'consult-orchestrator',
  });
}

/**
 * Resumes all sessions stuck in 'ending' state after a server restart.
 */
async function resumePendingEndingSessions() {
  try {
    const { data: endingSessions, error } = await supabaseAdmin
      .from('consult_sessions')
      .select('id, status, end_deadline_at')
      .eq('status', STATES.ENDING);

    if (error || !endingSessions || endingSessions.length === 0) return 0;

    const now = Date.now();
    let resumedCount = 0;

    for (const session of endingSessions) {
      const deadlineMs = session.end_deadline_at ? new Date(session.end_deadline_at).getTime() : 0;
      if (deadlineMs <= now) {
        // Deadline already expired while server was offline: finalize immediately
        void finalizeEndingSession(session.id, { isOverdue: true }).catch((err) => {
          logger.error('Failed to finalize overdue session on startup', {
            scope: 'consult-orchestrator',
            sessionId: session.id,
            errorCode: 'ERR_STARTUP_FINALIZE',
          });
        });
      } else {
        // Schedule timer for remaining duration
        registerEndingSession(session.id, session.end_deadline_at);
      }
      resumedCount++;
    }

    if (resumedCount > 0) {
      logger.info('Resumed pending ending sessions', {
        scope: 'consult-orchestrator',
        resumedCount,
      });
    }

    return resumedCount;
  } catch (_err) {
    logger.error('Failed to query ending sessions on startup', {
      scope: 'consult-orchestrator',
      errorCode: 'ERR_RESUME_ENDING',
    });
    return 0;
  }
}

/**
 * Polls for any ending sessions whose deadline has passed (safety catch for timer drift).
 */
async function pollOverdueSessions() {
  const nowIso = new Date().toISOString();
  const { data: overdueSessions, error } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, end_deadline_at')
    .eq('status', STATES.ENDING)
    .lte('end_deadline_at', nowIso);

  if (error || !overdueSessions || overdueSessions.length === 0) return;

  for (const session of overdueSessions) {
    if (!finalizingSessions.has(session.id)) {
      await finalizeEndingSession(session.id, { isOverdue: true });
    }
  }
}

/**
 * Registers an ending session with the orchestrator when a doctor requests end.
 */
function registerEndingSession(sessionId, deadlineAt) {
  if (!sessionId || !deadlineAt) return;

  // Clear any existing timer for this session
  if (activeTimers.has(sessionId)) {
    clearTimeout(activeTimers.get(sessionId));
    activeTimers.delete(sessionId);
  }

  const deadlineMs = new Date(deadlineAt).getTime();
  const delayMs = Math.max(0, deadlineMs - Date.now());

  const timer = setTimeout(() => {
    activeTimers.delete(sessionId);
    void finalizeEndingSession(sessionId, { isOverdue: true }).catch((err) => {
      logger.error('Failed to finalize ending session at deadline', {
        scope: 'consult-orchestrator',
        sessionId,
        errorCode: 'ERR_DEADLINE_FINALIZE',
      });
    });
  }, delayMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  activeTimers.set(sessionId, timer);

  // Check if all expected chunks are already uploaded and transcribed (fast-path)
  void checkCompleteness(sessionId).catch((_err) => {});
}

/**
 * Checks whether all expected chunks for active devices have been received and transcribed.
 * If complete, triggers early finalization to 'processing' before the deadline expires.
 */
async function checkCompleteness(sessionId) {
  if (!sessionId || finalizingSessions.has(sessionId)) return false;

  const { data: session, error: sessErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, status, patient_required')
    .eq('id', sessionId)
    .single();

  if (sessErr || !session || session.status !== STATES.ENDING) {
    return false;
  }

  const { data: devices, error: devErr } = await supabaseAdmin
    .from('session_devices')
    .select('device, status, expected_chunks')
    .eq('session_id', sessionId);

  if (devErr || !devices) return false;

  const expectedDevices = getExpectedDevices(session, devices);

  for (const devName of expectedDevices) {
    const devRow = devices.find((d) => d.device === devName);
    // Device must have posted final marker
    if (!devRow || devRow.expected_chunks === null || devRow.expected_chunks === undefined) {
      return false;
    }

    const expectedTotal = devRow.expected_chunks;

    // Check all chunks for this device
    const { data: chunks, error: chunkErr } = await supabaseAdmin
      .from('audio_chunks')
      .select('seq, status, silent')
      .eq('session_id', sessionId)
      .eq('device', devName);

    if (chunkErr || !chunks) return false;

    if (chunks.length < expectedTotal) {
      return false; // Still missing chunks in flight
    }

    // Every chunk must be transcribed or silent
    const allTranscribed = chunks.every(
      (c) => c.status === 'transcribed' || c.silent === true
    );

    if (!allTranscribed) {
      return false;
    }
  }

  // All expected devices have received all chunks and all are transcribed!
  logger.info('Early completion: all expected chunks transcribed before deadline', {
    scope: 'consult-orchestrator',
    sessionId,
  });

  // Cancel deadline timer
  if (activeTimers.has(sessionId)) {
    clearTimeout(activeTimers.get(sessionId));
    activeTimers.delete(sessionId);
  }

  await finalizeEndingSession(sessionId, { isOverdue: false });
  return true;
}

/**
 * Finalizes an ending session, records missing chunk gaps, flags incomplete sides,
 * and transitions session state to 'processing'.
 */
async function finalizeEndingSession(sessionId, { isOverdue = false, autoDraft = (process.env.NODE_ENV !== 'test') } = {}) {
  if (!sessionId || finalizingSessions.has(sessionId)) return null;

  finalizingSessions.add(sessionId);

  // Clear timer if still present
  if (activeTimers.has(sessionId)) {
    clearTimeout(activeTimers.get(sessionId));
    activeTimers.delete(sessionId);
  }

  try {
    const { data: session, error: sessErr } = await supabaseAdmin
      .from('consult_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessErr || !session || session.status !== STATES.ENDING) {
      return null;
    }

    const { data: devices } = await supabaseAdmin
      .from('session_devices')
      .select('*')
      .eq('session_id', sessionId);

    const { data: chunks } = await supabaseAdmin
      .from('audio_chunks')
      .select('id, seq, device, start_ms, duration_ms, status, silent')
      .eq('session_id', sessionId)
      .order('seq', { ascending: true });

    const chunkList = chunks || [];
    const deviceList = devices || [];
    const expectedDevices = getExpectedDevices(session, deviceList);

    const incompleteSides = [];
    const defaultChunkDurationMs = (config.chunkMinSec || 15) * 1000;

    for (const devName of expectedDevices) {
      const devRow = deviceList.find((d) => d.device === devName);
      const devChunks = chunkList.filter((c) => c.device === devName);
      const receivedSeqMap = new Map(devChunks.map((c) => [c.seq, c]));

      let sideIsIncomplete = false;

      if (!devRow || devRow.expected_chunks === null || devRow.expected_chunks === undefined) {
        // Device never uploaded final marker before deadline
        sideIsIncomplete = true;

        // If some chunks arrived, identify internal missing sequence gaps
        if (devChunks.length > 0) {
          const maxSeq = Math.max(...devChunks.map((c) => c.seq));
          for (let seq = 0; seq <= maxSeq; seq++) {
            if (!receivedSeqMap.has(seq)) {
              await recordMissingChunkGap({
                sessionId,
                device: devName,
                seq,
                receivedSeqMap,
                defaultDurationMs: defaultChunkDurationMs,
              });
            }
          }
        }
      } else {
        const expectedTotal = devRow.expected_chunks;

        // Check for missing sequence numbers in 0 .. expectedTotal - 1
        for (let seq = 0; seq < expectedTotal; seq++) {
          if (!receivedSeqMap.has(seq)) {
            sideIsIncomplete = true;
            await recordMissingChunkGap({
              sessionId,
              device: devName,
              seq,
              receivedSeqMap,
              defaultDurationMs: defaultChunkDurationMs,
            });
          } else {
            const chunk = receivedSeqMap.get(seq);
            if (chunk.status !== 'transcribed' && !chunk.silent && isOverdue) {
              sideIsIncomplete = true;
            }
          }
        }
      }

      if (sideIsIncomplete) {
        incompleteSides.push(devName);
      }
    }

    const nowIso = new Date().toISOString();

    // Transition session to PROCESSING with incomplete_sides
    const updatedSession = await transitionSession({
      sessionId,
      toState: STATES.PROCESSING,
      patch: {
        incomplete_sides: incompleteSides,
        ended_at: session.ended_at || nowIso,
      },
      socketEmitter: socketService,
    });

    // Tag segments for incomplete sides
    if (incompleteSides.length > 0) {
      await tagSegmentsForIncompleteSides(sessionId, incompleteSides);
    }

    logger.info('Ending consultation session finalized to processing', {
      scope: 'consult-orchestrator',
      sessionId,
      isOverdue,
      incompleteSidesCount: incompleteSides.length,
    });

    if (autoDraft) {
      void draftWithRetries(sessionId);
    }

    return updatedSession;
  } catch (err) {
    logger.error('Failed to finalize ending session', {
      scope: 'consult-orchestrator',
      sessionId,
      errorCode: 'ERR_FINALIZE_SESSION',
    });
    throw err;
  } finally {
    finalizingSessions.delete(sessionId);
  }
}

/** Sessions with a drafting attempt in flight, so retries never overlap. */
const draftingSessions = new Set();

/**
 * Drafts notes for a processing session, retrying a few times. A failed
 * draft used to leave the session in 'processing' for good. If every attempt
 * fails, the session stays in 'processing' and the doctor can ask again from
 * the dashboard. Logs error names and codes only, never model output.
 */
async function draftWithRetries(sessionId, { retries = config.draftAutoRetries, delayMs = config.draftRetryDelayMs } = {}) {
  if (!sessionId || draftingSessions.has(sessionId)) return null;
  draftingSessions.add(sessionId);
  const draftService = require('./draft.service');
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, delayMs * attempt).unref?.());
      try {
        return await draftService.generateDraftForSession(sessionId);
      } catch (err) {
        // A session that moved on (draft made by a manual request) needs no retry.
        if (err?.status === 400 || err?.status === 404) return null;
        logger.warn('Auto draft generation failed', {
          scope: 'consult-orchestrator',
          sessionId,
          attempt: attempt + 1,
          errorCode: 'ERR_AUTO_DRAFT',
          errorName: err?.name || 'Error',
          upstreamStatus: Number(String(err?.message || '').match(/\((\d{3})\)/)?.[1]) || undefined,
        });
      }
    }
    return null;
  } finally {
    draftingSessions.delete(sessionId);
  }
}

/**
 * After a restart, drafts notes for sessions left in 'processing' without one
 * (the process stopped mid-draft, or every earlier attempt failed).
 */
async function resumeProcessingWithoutDraft() {
  try {
    const { data: processing, error } = await supabaseAdmin
      .from('consult_sessions')
      .select('id')
      .eq('status', STATES.PROCESSING);
    if (error || !processing?.length) return 0;

    let resumed = 0;
    for (const { id } of processing) {
      const { data: drafts } = await supabaseAdmin
        .from('consult_drafts')
        .select('id')
        .eq('session_id', id)
        .limit(1);
      if (drafts?.length) continue;
      void draftWithRetries(id);
      resumed += 1;
    }
    if (resumed) logger.info('Resumed drafting for processing sessions', { scope: 'consult-orchestrator', resumed });
    return resumed;
  } catch (_err) {
    logger.error('Failed to resume processing sessions', { scope: 'consult-orchestrator', errorCode: 'ERR_RESUME_PROCESSING' });
    return 0;
  }
}

/**
 * Resolves which devices are expected for a session.
 * Doctor is always expected.
 * Patient is expected if patient_required=true or if a patient device joined.
 */
function getExpectedDevices(session, devices) {
  const expected = ['doctor'];
  const patientJoined = (devices || []).some(
    (d) => d.device === 'patient' && d.status !== 'gone'
  );

  if (session.patient_required || patientJoined) {
    expected.push('patient');
  }

  return expected;
}

/**
 * Records a timeline gap row for a missing audio chunk sequence.
 */
async function recordMissingChunkGap({ sessionId, device, seq, receivedSeqMap, defaultDurationMs }) {
  let estimatedStartMs = seq * defaultDurationMs;
  let estimatedDurationMs = defaultDurationMs;

  const prevChunk = receivedSeqMap.get(seq - 1);
  if (prevChunk && prevChunk.start_ms !== undefined && prevChunk.duration_ms !== undefined) {
    estimatedStartMs = Number(prevChunk.start_ms) + Number(prevChunk.duration_ms);
  }

  const nextChunk = receivedSeqMap.get(seq + 1);
  if (nextChunk && nextChunk.start_ms !== undefined) {
    const diff = Number(nextChunk.start_ms) - estimatedStartMs;
    if (diff > 0) {
      estimatedDurationMs = diff;
    }
  }

  try {
    await recordGap({
      sessionId,
      device,
      gapId: crypto.randomUUID(),
      startMs: estimatedStartMs,
      durationMs: estimatedDurationMs,
      reasonCode: 'missing_chunk',
    });
  } catch (_err) {
    logger.warn('Failed to record gap for missing chunk sequence', {
      scope: 'consult-orchestrator',
      sessionId,
      device,
      seq,
      errorCode: 'ERR_RECORD_MISSING_GAP',
    });
  }
}

/**
 * Appends 'incomplete_side' flag to segments belonging to incomplete devices.
 */
async function tagSegmentsForIncompleteSides(sessionId, incompleteSides) {
  if (!incompleteSides || incompleteSides.length === 0) return;

  for (const device of incompleteSides) {
    const { data: segments, error } = await supabaseAdmin
      .from('segments')
      .select('id, flags')
      .eq('session_id', sessionId)
      .eq('device', device);

    if (error || !segments) continue;

    for (const seg of segments) {
      const flags = Array.isArray(seg.flags) ? seg.flags : [];
      if (!flags.includes('incomplete_side')) {
        await supabaseAdmin
          .from('segments')
          .update({
            flags: [...flags, 'incomplete_side'],
          })
          .eq('id', seg.id);
      }
    }
  }
}

/**
 * Handles a late-arriving chunk that has been transcribed after processing/draft_ready.
 * Flags the segment as 'late', marks the draft as outdated, and pushes transcript_updated.
 */
async function handleLateChunkTranscribed(chunk) {
  if (!chunk || !chunk.session_id) return;

  try {
    // 1. Tag segments for this chunk with 'late'
    const { data: segments } = await supabaseAdmin
      .from('segments')
      .select('id, flags')
      .eq('chunk_id', chunk.id);

    if (segments && segments.length > 0) {
      for (const seg of segments) {
        const flags = Array.isArray(seg.flags) ? seg.flags : [];
        if (!flags.includes('late')) {
          await supabaseAdmin
            .from('segments')
            .update({ flags: [...flags, 'late'] })
            .eq('id', seg.id);
        }
      }
    }

    // 2. Mark consult_sessions draft_outdated = true
    await supabaseAdmin
      .from('consult_sessions')
      .update({ draft_outdated: true })
      .eq('id', chunk.session_id);

    // 3. Emit transcript_updated push event with metadata only
    socketService.emitTranscriptUpdated(chunk.session_id, {
      draftOutdated: true,
      lateChunk: {
        device: chunk.device,
        seq: chunk.seq,
      },
    });

    logger.info('Late chunk processed, marked draft outdated', {
      scope: 'consult-orchestrator',
      sessionId: chunk.session_id,
      device: chunk.device,
      seq: chunk.seq,
    });
  } catch (err) {
    logger.error('Failed to handle late chunk transcribed', {
      scope: 'consult-orchestrator',
      sessionId: chunk.session_id,
      errorCode: 'ERR_LATE_CHUNK_HANDLE',
    });
  }
}

module.exports = {
  start,
  stop,
  registerEndingSession,
  checkCompleteness,
  finalizeEndingSession,
  resumePendingEndingSessions,
  resumeProcessingWithoutDraft,
  draftWithRetries,
  handleLateChunkTranscribed,
};
