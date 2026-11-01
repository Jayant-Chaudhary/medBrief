/**
 * Consult Audio Transcription Worker.
 *
 * Polls queued transcription jobs, fetches chunk audio from Supabase Storage,
 * converts audio to 16 kHz mono WAV via ffmpeg, calls the configured STT provider,
 * maps segments to the session timeline, and inserts rows into the segments table.
 *
 * Implements exponential backoff retry up to TRANSCRIBE_MAX_ATTEMPTS.
 * Adheres strictly to privacy rules: zero transcript text or clinical data in logs.
 */

const supabaseAdmin = require('../../config/supabaseAdminClient');
const config = require('../../config/consultAudio.config');
const { getProvider } = require('./stt/providerFactory');
const { convertTo16kHzMonoWav } = require('../../utils/audioConverter');
const logger = require('../../utils/logger');
const audioCache = require('./audioCache.service');

const STORAGE_BUCKET = 'consult-audio';
const SAFE_ERROR_CODES = new Set([
  'ERR_FILE_NOT_FOUND', 'ERR_LOCAL_STT_UNAVAILABLE', 'ERR_LOCAL_STT_FAILED',
  'ERR_SARVAM_KEY_MISSING', 'ERR_SARVAM_NETWORK', 'ERR_SARVAM_RATE_LIMITED',
  'ERR_SARVAM_API_ERROR', 'ERR_STT_SIMULATED_FAILURE', 'ERR_CHUNK_STORAGE_READ',
  'ERR_SEGMENTS_SAVE', 'ERR_CHUNK_STATUS_SAVE', 'ERR_JOB_STATUS_SAVE',
  'ERR_AUDIO_INPUT_INVALID', 'ERR_FFMPEG_UNAVAILABLE', 'ERR_FFMPEG_START',
  'ERR_AUDIO_CONVERSION', 'ERR_AUDIO_OUTPUT_EMPTY',
]);

function workerError(code) {
  return Object.assign(new Error(code), { code });
}

async function checkedUpdate(table, id, payload, code) {
  const { error } = await supabaseAdmin.from(table).update(payload).eq('id', id);
  if (error) throw workerError(code);
}

async function removeCachedAudio(chunk) {
  try {
    await audioCache.remove(chunk);
  } catch (_err) {
    // Cleanup is best effort. TTL must not turn a completed job into a retry.
    logger.warn('Audio cache cleanup deferred to expiry', {
      scope: 'transcription-worker', chunkId: chunk.id, errorCode: 'ERR_AUDIO_CACHE_CLEANUP',
    });
  }
}

let isRunning = false;
let workerTimer = null;
let activeJobsCount = 0;

/**
 * Recovers jobs stuck in 'transcribing' state past their timeout (e.g. from worker crash).
 */
async function recoverStuckJobs() {
  const timeoutThreshold = new Date(Date.now() - config.transcribeJobTimeoutMs).toISOString();

  const { data: stuckJobs, error } = await supabaseAdmin
    .from('transcription_jobs')
    .select('id, attempts')
    .eq('status', 'transcribing')
    .lt('locked_at', timeoutThreshold);

  if (error || !stuckJobs || stuckJobs.length === 0) return 0;

  let recovered = 0;
  for (const job of stuckJobs) {
    if (job.attempts >= config.transcribeMaxAttempts) {
      await supabaseAdmin
        .from('transcription_jobs')
        .update({
          status: 'failed',
          last_error_code: 'ERR_JOB_TIMEOUT_MAX_ATTEMPTS',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    } else {
      await supabaseAdmin
        .from('transcription_jobs')
        .update({
          status: 'queued',
          locked_at: null,
          last_error_code: 'ERR_JOB_TIMEOUT_REQUEUED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      recovered++;
    }
  }

  if (recovered > 0) {
    logger.info('Recovered stuck transcription jobs', {
      scope: 'transcription-worker',
      recoveredCount: recovered,
    });
  }

  // Also re-queue any jobs that previously failed due to missing Sarvam key or connection error
  try {
    const { data: misconfiguredJobs } = await supabaseAdmin
      .from('transcription_jobs')
      .select('id, chunk_id')
      .eq('status', 'failed')
      .in('last_error_code', ['ERR_SARVAM_KEY_MISSING', 'ERR_LOCAL_STT_UNAVAILABLE']);

    if (misconfiguredJobs && misconfiguredJobs.length > 0) {
      for (const job of misconfiguredJobs) {
        await supabaseAdmin
          .from('transcription_jobs')
          .update({
            status: 'queued',
            attempts: 0,
            locked_at: null,
            next_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        if (job.chunk_id) {
          await supabaseAdmin
            .from('audio_chunks')
            .update({ status: 'queued' })
            .eq('id', job.chunk_id);
        }
        recovered++;
      }
    }
  } catch (_e) {
    // Ignore query error in test environments
  }

  return recovered;
}

/**
 * Claims and locks the next available queued job safely.
 */
async function claimNextJob() {
  const nowIso = new Date().toISOString();

  // Find candidate queued job whose next_attempt_at is due
  const { data: candidates, error: findErr } = await supabaseAdmin
    .from('transcription_jobs')
    .select('id, chunk_id, attempts')
    .eq('status', 'queued')
    .lte('next_attempt_at', nowIso)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findErr || !candidates || candidates.length === 0) {
    return null;
  }

  const candidate = candidates[0];

  // Atomically claim lock
  const nextAttempts = (candidate.attempts || 0) + 1;
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('transcription_jobs')
    .update({
      status: 'transcribing',
      locked_at: nowIso,
      attempts: nextAttempts,
      updated_at: nowIso,
    })
    .eq('id', candidate.id)
    .eq('status', 'queued') // Optimistic lock condition
    .select()
    .single();

  if (claimErr || !claimed) {
    return null; // Another worker claimed it concurrently
  }

  return claimed;
}

/**
 * Processes a single claimed transcription job.
 *
 * @param {Object} job - The claimed transcription_jobs record.
 * @param {Object} [overrideProvider] - Optional STT provider instance (for unit testing).
 */
async function processJob(job, overrideProvider = null) {
  const startTime = Date.now();

  // 1. Fetch chunk metadata
  const { data: chunk, error: chunkErr } = await supabaseAdmin
    .from('audio_chunks')
    .select('id, session_id, device, seq, start_ms, duration_ms, storage_path, silent, status, size_bytes')
    .eq('id', job.chunk_id)
    .single();

  if (chunkErr || !chunk) {
    await markJobFailed(job, 'ERR_CHUNK_NOT_FOUND');
    return { ok: false, error: 'Chunk not found' };
  }

  // 2. Fetch session and device offset metadata for timeline mapping
  const { data: session } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, language_code, started_at, status')
    .eq('id', chunk.session_id)
    .single();

  const { data: deviceRecord } = await supabaseAdmin
    .from('session_devices')
    .select('device, offset_ms, capture_zero_device_ms')
    .eq('session_id', chunk.session_id)
    .eq('device', chunk.device)
    .maybeSingle();

  try {
    await checkedUpdate('audio_chunks', chunk.id, { status: 'transcribing' }, 'ERR_CHUNK_STATUS_SAVE');

    // Only explicitly silent chunks bypass STT. Missing audio is a failure.
    if (chunk.silent) {
      await checkedUpdate('audio_chunks', chunk.id, { status: 'silent' }, 'ERR_CHUNK_STATUS_SAVE');
      await markJobCompleted(job);
      return { ok: true, segmentsCount: 0, silent: true };
    }

    // 4. Read compressed bytes from Redis first; Storage is the durable fallback.
    const retrievalStart = Date.now();
    let rawBuffer;
    try {
      rawBuffer = await audioCache.get(chunk);
    } catch (_err) {
      rawBuffer = null;
    }
    const audioSource = rawBuffer ? 'redis' : 'storage';
    if (!rawBuffer) {
      if (!chunk.storage_path) throw workerError('ERR_CHUNK_STORAGE_READ');
      const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(chunk.storage_path);
      if (downloadErr || !fileData) throw workerError('ERR_CHUNK_STORAGE_READ');
      rawBuffer = Buffer.from(await fileData.arrayBuffer());
    }
    const retrievalMs = Date.now() - retrievalStart;

    // 5. Convert to 16 kHz mono WAV in-memory
    const wavBuffer = await convertTo16kHzMonoWav(rawBuffer);

    // 6. Transcribe using STT provider
    const provider = overrideProvider || getProvider();
    const sttResult = await provider.transcribe(wavBuffer, {
      languageCode: session?.language_code || 'hi',
      durationMs: chunk.duration_ms,
      device: chunk.device,
    });

    const segments = Array.isArray(sttResult) ? sttResult : sttResult?.segments || [];

    // 7. Calculate timeline mapping
    // Formula: session_ms = (capture_zero_device_ms + offset_ms + chunk.start_ms) - session_started_server_ms
    let chunkSessionStartMs = Number(chunk.start_ms);
    if (deviceRecord?.capture_zero_device_ms && session?.started_at) {
      const sessionStartedMs = new Date(session.started_at).getTime();
      const offsetMs = Number(deviceRecord.offset_ms || 0);
      const captureZeroMs = Number(deviceRecord.capture_zero_device_ms);
      chunkSessionStartMs = Math.max(
        0,
        captureZeroMs + offsetMs + Number(chunk.start_ms) - sessionStartedMs
      );
    }

    // 8. Insert segments into database
    if (segments.length > 0) {
      const segmentRows = segments
        .filter((seg) => seg && typeof seg.text === 'string' && seg.text.trim().length > 0)
        .map((seg) => {
          const startMs = chunkSessionStartMs + Math.round(Number(seg.start_ms) || 0);
          const rawEndMs = chunkSessionStartMs + Math.round(Number(seg.end_ms) || (Number(seg.start_ms) + 100));
          const endMs = Math.max(rawEndMs, startMs + 100);

          return {
            session_id: chunk.session_id,
            chunk_id: chunk.id,
            device: chunk.device,
            speaker: chunk.device, // Refined during Phase 7 deduplication/merge
            start_ms: startMs,
            end_ms: endMs,
            text: seg.text.trim(),
            source: 'chunk',
            provider: provider.name || config.sttProvider,
            language: seg.language || session?.language_code || 'hi',
            confidence: seg.confidence !== undefined ? seg.confidence : 0.95,
            flags: seg.flags || [],
          };
        });

      if (segmentRows.length > 0) {
        const { error: insSegErr } = await supabaseAdmin
          .from('segments')
          .insert(segmentRows);

        if (insSegErr) {
          throw workerError('ERR_SEGMENTS_SAVE');
        }
      }
    }

    // 9. Mark Job & Chunk completed
    await checkedUpdate('audio_chunks', chunk.id, { status: 'transcribed' }, 'ERR_CHUNK_STATUS_SAVE');
    await markJobCompleted(job);
    await removeCachedAudio(chunk);

    const processingMs = Date.now() - startTime;
    logger.info('Chunk successfully transcribed', {
      scope: 'transcription-worker',
      jobId: job.id,
      chunkId: chunk.id,
      sessionId: chunk.session_id,
      device: chunk.device,
      seq: chunk.seq,
      segmentsCount: segments.length,
      processingMs,
      audioSource,
      retrievalMs,
    });

    return {
      ok: true,
      jobId: job.id,
      chunkId: chunk.id,
      segmentsCount: segments.length,
      processingMs,
      audioSource,
      retrievalMs,
    };
  } catch (err) {
    const errorCode = SAFE_ERROR_CODES.has(err.code) ? err.code : 'ERR_TRANSCRIBE_PROCESS';
    logger.error('Transcription job attempt failed', {
      scope: 'transcription-worker',
      jobId: job.id,
      chunkId: chunk.id,
      attempt: job.attempts,
      errorCode,
    });

    const terminal = await handleJobError(job, chunk.id, errorCode);
    if (terminal) await removeCachedAudio(chunk);
    return { ok: false, error: errorCode };
  }
}

/**
 * Marks job and chunk completed.
 */
async function markJobCompleted(job) {
  const nowIso = new Date().toISOString();
  await checkedUpdate('transcription_jobs', job.id, {
    status: 'completed',
    locked_at: null,
    updated_at: nowIso,
  }, 'ERR_JOB_STATUS_SAVE');
}

/**
 * Handles error with retry or failure marking.
 */
async function handleJobError(job, chunkId, errorCode) {
  const nowIso = new Date().toISOString();
  const maxAttempts = config.transcribeMaxAttempts || 3;

  if (job.attempts >= maxAttempts) {
    // Mark failed permanently
    await checkedUpdate('transcription_jobs', job.id, {
      status: 'failed',
      last_error_code: errorCode,
      locked_at: null,
      updated_at: nowIso,
    }, 'ERR_JOB_STATUS_SAVE');

    await checkedUpdate('audio_chunks', chunkId, { status: 'failed' }, 'ERR_CHUNK_STATUS_SAVE');
    return true;
  } else {
    // Requeue with exponential backoff
    const backoffMs = Math.pow(2, job.attempts) * 1000;
    const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();

    await checkedUpdate('transcription_jobs', job.id, {
      status: 'queued',
      next_attempt_at: nextAttemptAt,
      last_error_code: errorCode,
      locked_at: null,
      updated_at: nowIso,
    }, 'ERR_JOB_STATUS_SAVE');

    await checkedUpdate('audio_chunks', chunkId, { status: 'queued' }, 'ERR_CHUNK_STATUS_SAVE');
    return false;
  }
}

/**
 * Marks a job failed when chunk cannot be loaded.
 */
async function markJobFailed(job, errorCode) {
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from('transcription_jobs')
    .update({
      status: 'failed',
      last_error_code: errorCode,
      locked_at: null,
      updated_at: nowIso,
    })
    .eq('id', job.id);
}

/**
 * Runs a single iteration of the worker: processes up to transcribeConcurrency jobs.
 */
async function runWorkerIteration(overrideProvider = null) {
  if (activeJobsCount >= config.transcribeConcurrency) {
    return;
  }

  const availableSlots = config.transcribeConcurrency - activeJobsCount;
  const promises = [];

  for (let i = 0; i < availableSlots; i++) {
    const job = await claimNextJob();
    if (!job) break;

    activeJobsCount++;
    promises.push(
      processJob(job, overrideProvider)
        .finally(() => {
          activeJobsCount = Math.max(0, activeJobsCount - 1);
        })
    );
  }

  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

/**
 * Starts the background polling worker.
 */
function startWorker(pollMs = null) {
  if (isRunning) return;
  isRunning = true;

  const interval = pollMs || config.transcribeWorkerPollMs || 1000;
  logger.info('Transcription worker started', {
    scope: 'transcription-worker',
    pollIntervalMs: interval,
    concurrency: config.transcribeConcurrency,
    provider: config.sttProvider,
  });

  const poll = async () => {
    if (!isRunning) return;
    try {
      await recoverStuckJobs();
      await runWorkerIteration();
    } catch (err) {
      logger.error('Worker iteration encountered error', {
        scope: 'transcription-worker',
        errorCode: err.code || 'ERR_WORKER_ITERATION',
      });
    } finally {
      if (isRunning) {
        workerTimer = setTimeout(poll, interval);
      }
    }
  };

  poll();
}

/**
 * Stops the background worker.
 */
function stopWorker() {
  isRunning = false;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  logger.info('Transcription worker stopped', { scope: 'transcription-worker' });
}

module.exports = {
  claimNextJob,
  processJob,
  runWorkerIteration,
  recoverStuckJobs,
  startWorker,
  stopWorker,
};
