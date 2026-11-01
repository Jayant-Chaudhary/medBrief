/**
 * Consult Audio Chunk Ingestion Service.
 *
 * Implements reliable, idempotent chunk ingestion directly into Supabase Storage
 * and the audio_chunks metadata table, with late chunk detection and silent chunk handling.
 */

const supabaseAdmin = require('../../config/supabaseAdminClient');
const config = require('../../config/consultAudio.config');
const { STATES } = require('./stateMachine');
const logger = require('../../utils/logger');
const audioCache = require('./audioCache.service');

const STORAGE_BUCKET = 'consult-audio';

function ingestError(code) {
  const err = new Error('Audio chunk could not be saved; retry upload');
  err.code = code;
  err.status = 503;
  return err;
}

async function publishJob(chunk, repair = false) {
  if (chunk.silent || ['silent', 'transcribed', 'failed', 'transcribing'].includes(chunk.status)) return;
  try {
    if (repair) {
      // Preserve jobs made by older versions, whose IDs were random UUIDs.
      const { data, error } = await supabaseAdmin.from('transcription_jobs')
        .select('id').eq('chunk_id', chunk.id).limit(1);
      if (error) throw ingestError('ERR_CHUNK_JOB_LOOKUP');
      if (data?.length) return;
    }
    // The existing primary key makes concurrent retry repairs idempotent.
    const { error } = await supabaseAdmin.from('transcription_jobs').insert({
      id: chunk.id,
      chunk_id: chunk.id,
      status: 'queued',
      attempts: 0,
    });
    if (error && error.code !== '23505') throw ingestError('ERR_CHUNK_JOB_PUBLISH');
  } catch (_err) {
    throw ingestError('ERR_CHUNK_JOB_PUBLISH');
  }
}

/**
 * Maps audio MIME types to file extensions.
 */
function getExtensionFromCodec(codec = '') {
  const norm = codec.toLowerCase();
  if (norm.includes('wav')) return 'wav';
  if (norm.includes('webm')) return 'webm';
  if (norm.includes('ogg') || norm.includes('opus')) return 'ogg';
  if (norm.includes('mp4') || norm.includes('m4a') || norm.includes('aac')) return 'm4a';
  return 'bin';
}

/**
 * Ingests an audio chunk from a consultation device.
 *
 * Safe to retry: Idempotent by (sessionId, device, seq).
 */
async function ingestChunk({
  sessionId,
  device,
  seq,
  startMs,
  durationMs,
  avgDbfs = null,
  codec = 'audio/wav',
  isSilent = false,
  audioBuffer = null,
}) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!device) throw new Error('device is required');
  if (seq === undefined || seq === null) throw new Error('seq is required');
  if (startMs === undefined || startMs === null) throw new Error('startMs is required');
  if (durationMs === undefined || durationMs === null) throw new Error('durationMs is required');

  const parsedSeq = Number(seq);
  const parsedStartMs = Number(startMs);
  const parsedDurationMs = Number(durationMs);
  const parsedDbfs = avgDbfs !== null && avgDbfs !== undefined ? Number(avgDbfs) : null;

  // 1. Fetch current session status
  const { data: session, error: sessErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .single();

  if (sessErr || !session) {
    const err = new Error('Consultation session not found');
    err.status = 404;
    throw err;
  }

  // 2. State gating
  const currentStatus = session.status;
  const isLate = [STATES.PROCESSING, STATES.DRAFT_READY].includes(currentStatus);
  const isAllowedState = [STATES.RECORDING, STATES.ENDING, STATES.PROCESSING, STATES.DRAFT_READY].includes(currentStatus);

  if (!isAllowedState) {
    const err = new Error(`Cannot ingest chunk: session is in '${currentStatus}' state`);
    err.status = 409;
    throw err;
  }

  // 3. Idempotency Check on (session_id, device, seq)
  const { data: existingChunk, error: lookupErr } = await supabaseAdmin
    .from('audio_chunks')
    .select('id, seq, status, silent, storage_path')
    .eq('session_id', sessionId)
    .eq('device', device)
    .eq('seq', parsedSeq)
    .maybeSingle();

  if (lookupErr) throw ingestError('ERR_CHUNK_LOOKUP');

  if (existingChunk) {
    await publishJob(existingChunk, true);
    logger.debug('Duplicate chunk upload received (idempotent)', {
      scope: 'consult-ingest',
      sessionId,
      device,
      seq: parsedSeq,
    });

    return {
      ok: true,
      duplicated: true,
      chunkId: existingChunk.id,
      seq: existingChunk.seq,
      status: existingChunk.status,
      sessionState: currentStatus,
    };
  }

  // 4. Handle Silent vs. Audio Upload
  const hasAudio = audioBuffer && Buffer.isBuffer(audioBuffer) && audioBuffer.length > 0;
  const silentChunk = Boolean(isSilent) || !hasAudio;

  let storagePath = null;
  let status = silentChunk ? 'silent' : 'received';
  let sizeBytes = 0;

  if (!silentChunk) {
    sizeBytes = audioBuffer.length;

    if (sizeBytes > config.chunkMaxBytes) {
      const err = new Error(`Chunk size (${sizeBytes} bytes) exceeds limit (${config.chunkMaxBytes} bytes)`);
      err.status = 413;
      throw err;
    }

    const ext = getExtensionFromCodec(codec);
    storagePath = `consults/${sessionId}/${device}/${parsedSeq}.${ext}`;

    try {
      const { error: uploadErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, audioBuffer, {
          contentType: codec,
          upsert: true,
        });
      if (uploadErr) throw ingestError('ERR_CHUNK_STORAGE');
    } catch (_err) {
      throw ingestError('ERR_CHUNK_STORAGE');
    }

    // Finish cache population before a database worker can claim the new job.
    // This cache is optional; persistent upload remains the acknowledgement gate.
    await audioCache.put({ sessionId, device, seq: parsedSeq }, audioBuffer);
  }

  // 5. Insert audio_chunks metadata row
  let insertedChunk;
  let insErr;
  try {
    ({ data: insertedChunk, error: insErr } = await supabaseAdmin
      .from('audio_chunks')
      .insert({
        session_id: sessionId,
        device,
        seq: parsedSeq,
        start_ms: parsedStartMs,
        duration_ms: parsedDurationMs,
        avg_dbfs: parsedDbfs,
        codec,
        size_bytes: sizeBytes,
        silent: silentChunk,
        storage_path: storagePath,
        status,
        is_late: isLate,
      })
      .select()
      .single());
  } catch (_err) {
    await audioCache.remove({ sessionId, device, seq: parsedSeq });
    throw ingestError('ERR_CHUNK_METADATA');
  }

  if (!insertedChunk && !insErr) insErr = { code: 'ERR_CHUNK_METADATA' };

  if (insErr) {
    // If concurrent request inserted the exact same seq, return idempotent duplicate
    if (insErr.code === '23505') {
      const { data: retryChunk } = await supabaseAdmin
        .from('audio_chunks')
        .select('id, seq, status, silent, storage_path')
        .eq('session_id', sessionId)
        .eq('device', device)
        .eq('seq', parsedSeq)
        .single();

      if (!retryChunk) throw ingestError('ERR_CHUNK_LOOKUP');
      await publishJob(retryChunk, true);

      return {
        ok: true,
        duplicated: true,
        chunkId: retryChunk?.id,
        seq: parsedSeq,
        status: retryChunk?.status || status,
        sessionState: currentStatus,
      };
    }
    await audioCache.remove({ sessionId, device, seq: parsedSeq });
    throw ingestError('ERR_CHUNK_METADATA');
  }

  // 6. Enqueue transcription job for audio chunks
  if (!silentChunk && insertedChunk) {
    await publishJob(insertedChunk);
  }

  logger.info('Audio chunk received and stored', {
    scope: 'consult-ingest',
    sessionId,
    device,
    seq: parsedSeq,
    sizeBytes,
    isLate,
    silent: silentChunk,
  });

  return {
    ok: true,
    duplicated: false,
    chunkId: insertedChunk.id,
    seq: parsedSeq,
    status: insertedChunk.status,
    isLate,
    sessionState: currentStatus,
  };
}

/**
 * Records device final marker declaring total expected chunks.
 */
async function recordDeviceFinalMarker({ sessionId, device, totalChunks }) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!device) throw new Error('device is required');
  if (totalChunks === undefined || totalChunks === null) {
    throw new Error('totalChunks is required');
  }

  const parsedTotal = Math.max(0, parseInt(totalChunks, 10));

  const { data: session, error: sessErr } = await supabaseAdmin
    .from('consult_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .single();

  if (sessErr || !session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  const { data: updatedDevice, error: devErr } = await supabaseAdmin
    .from('session_devices')
    .update({
      expected_chunks: parsedTotal,
      final_received_at: new Date().toISOString(),
      status: 'flushed',
    })
    .eq('session_id', sessionId)
    .eq('device', device)
    .select()
    .single();

  if (devErr) {
    throw new Error(`Failed to record final device marker: ${devErr.message}`);
  }

  logger.info('Device final marker recorded', {
    scope: 'consult-ingest',
    sessionId,
    device,
    expectedChunks: parsedTotal,
  });

  return {
    ok: true,
    device,
    expectedChunks: parsedTotal,
    sessionState: session.status,
  };
}

module.exports = {
  ingestChunk,
  recordDeviceFinalMarker,
  STORAGE_BUCKET,
};
