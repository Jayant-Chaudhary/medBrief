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

const STORAGE_BUCKET = 'consult-audio';

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
    .select('id, session_id, device, seq, start_ms, duration_ms, storage_path, silent, status')
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

  // Update chunk status to transcribing
  await supabaseAdmin
    .from('audio_chunks')
    .update({ status: 'transcribing' })
    .eq('id', chunk.id);

  // 3. Handle silent chunks directly without audio conversion or STT
  if (chunk.silent || !chunk.storage_path) {
    await markJobCompleted(job, chunk.id);
    await supabaseAdmin
      .from('audio_chunks')
      .update({ status: 'silent' })
      .eq('id', chunk.id);

    return { ok: true, segmentsCount: 0, silent: true };
  }

  try {
    // 4. Download audio bytes from Supabase Storage
    const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .download(chunk.storage_path);

    if (downloadErr || !fileData) {
      throw new Error(`Storage download failed: ${downloadErr?.message || 'Empty file data'}`);
    }

    const rawBuffer = Buffer.from(await fileData.arrayBuffer());

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
          throw new Error(`Failed to insert segments: ${insSegErr.message}`);
        }
      }
    }

    // 9. Mark Job & Chunk completed
    await markJobCompleted(job, chunk.id);
    await supabaseAdmin
      .from('audio_chunks')
      .update({ status: 'transcribed' })
      .eq('id', chunk.id);

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
    });

    return {
      ok: true,
      jobId: job.id,
      chunkId: chunk.id,
      segmentsCount: segments.length,
      processingMs,
    };
  } catch (err) {
    const errorCode = err.code || 'ERR_TRANSCRIBE_PROCESS';
    logger.error('Transcription job attempt failed', {
      scope: 'transcription-worker',
      jobId: job.id,
      chunkId: chunk.id,
      attempt: job.attempts,
      errorCode,
      errorMessage: err.message,
    });

    await handleJobError(job, chunk.id, errorCode);
    return { ok: false, error: errorCode };
  }
}

/**
 * Marks job and chunk completed.
 */
async function markJobCompleted(job, chunkId) {
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from('transcription_jobs')
    .update({
      status: 'completed',
      locked_at: null,
      updated_at: nowIso,
    })
    .eq('id', job.id);
}

/**
 * Handles error with retry or failure marking.
 */
async function handleJobError(job, chunkId, errorCode) {
  const nowIso = new Date().toISOString();
  const maxAttempts = config.transcribeMaxAttempts || 3;

  if (job.attempts >= maxAttempts) {
    // Mark failed permanently
    await supabaseAdmin
      .from('transcription_jobs')
      .update({
        status: 'failed',
        last_error_code: errorCode,
        locked_at: null,
        updated_at: nowIso,
      })
      .eq('id', job.id);

    await supabaseAdmin
      .from('audio_chunks')
      .update({ status: 'failed' })
      .eq('id', chunkId);
  } else {
    // Requeue with exponential backoff
    const backoffMs = Math.pow(2, job.attempts) * 1000;
    const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();

    await supabaseAdmin
      .from('transcription_jobs')
      .update({
        status: 'queued',
        next_attempt_at: nextAttemptAt,
        last_error_code: errorCode,
        locked_at: null,
        updated_at: nowIso,
      })
      .eq('id', job.id);

    await supabaseAdmin
      .from('audio_chunks')
      .update({ status: 'queued' })
      .eq('id', chunkId);
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
