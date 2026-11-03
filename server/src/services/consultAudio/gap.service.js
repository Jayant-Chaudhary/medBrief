/**
 * Consult Audio Gap Service.
 *
 * Records and retrieves explicit timeline capture interruptions (e.g. phone call,
 * audio focus lost, permission revoked) without inventing synthetic silence or speech.
 * Idempotent per (session_id, device, gap_id).
 */

const supabaseAdmin = require('../../config/supabaseAdminClient');
const socketService = require('./socket.service');
const logger = require('../../utils/logger');

const ALLOWED_REASON_CODES = new Set([
  'phone_call',
  'focus_lost',
  'permission_revoked',
  'recorder_error',
  'unknown',
  'retention_expired',
  'storage_lost',
  'user_discarded',
  'missing_chunk',
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateGapPayload({ sessionId, device, gapId, startMs, durationMs, reasonCode }) {
  if (!sessionId || typeof sessionId !== 'string') {
    const err = new Error('Invalid or missing sessionId');
    err.status = 400;
    throw err;
  }
  if (!['doctor', 'patient'].includes(device)) {
    const err = new Error('Device must be doctor or patient');
    err.status = 400;
    throw err;
  }
  if (!gapId || typeof gapId !== 'string' || !UUID_REGEX.test(gapId)) {
    const err = new Error('gap_id must be a valid UUID');
    err.status = 400;
    throw err;
  }
  const parsedStart = startMs;
  if (!Number.isSafeInteger(parsedStart) || parsedStart < 0) {
    const err = new Error('start_ms must be a non-negative integer');
    err.status = 400;
    throw err;
  }
  const parsedDuration = durationMs;
  if (!Number.isSafeInteger(parsedDuration) || parsedDuration <= 0 || parsedDuration > 2147483647) {
    const err = new Error('duration_ms must be a positive integer');
    err.status = 400;
    throw err;
  }
  if (!reasonCode || !ALLOWED_REASON_CODES.has(reasonCode)) {
    const err = new Error(`Invalid reason_code. Allowed: ${Array.from(ALLOWED_REASON_CODES).join(', ')}`);
    err.status = 400;
    throw err;
  }

  return {
    sessionId,
    device,
    gapId,
    startMs: parsedStart,
    durationMs: parsedDuration,
    reasonCode,
  };
}

/**
 * Records an audio capture gap.
 * Idempotent on (session_id, device, gap_id).
 */
async function recordGap({ sessionId, device, gapId, startMs, durationMs, reasonCode }) {
  const validated = validateGapPayload({ sessionId, device, gapId, startMs, durationMs, reasonCode });

  const record = {
    session_id: validated.sessionId,
    device: validated.device,
    gap_id: validated.gapId,
    start_ms: validated.startMs,
    duration_ms: validated.durationMs,
    reason_code: validated.reasonCode,
  };

  const { data, error } = await supabaseAdmin
    .from('consult_audio_gaps')
    .insert(record)
    .select('*')
    .single();

  if (error) {
    // Unique constraint violation: duplicate gap submission
    if (error.code === '23505') {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from('consult_audio_gaps')
        .select('*')
        .eq('session_id', validated.sessionId)
        .eq('device', validated.device)
        .eq('gap_id', validated.gapId)
        .maybeSingle();

      if (lookupError || !existing) {
        throw Object.assign(new Error('ERR_GAP_LOOKUP'), { status: 503 });
      }
      if (Number(existing.start_ms) !== record.start_ms || Number(existing.duration_ms) !== record.duration_ms ||
          existing.reason_code !== record.reason_code) {
        throw Object.assign(new Error('ERR_GAP_ID_REUSED'), { status: 409 });
      }
      return { ok: true, gap: existing, duplicate: true };
    }

    logger.error('Failed to record consultation gap', {
      scope: 'consult-gap',
      sessionId: validated.sessionId,
      device: validated.device,
      errorCode: 'ERR_GAP_SAVE',
    });
    const dbErr = new Error('Failed to record capture gap');
    dbErr.status = 500;
    throw dbErr;
  }

  // Push notification through Socket.IO (generic timing/code only, no health terms)
  socketService.emitGapRecorded?.(validated.sessionId, {
    sessionId: validated.sessionId,
    device: validated.device,
    gapId: validated.gapId,
  });

  return { ok: true, gap: data, duplicate: false };
}

/**
 * Returns recorded gaps for a session and optional device.
 */
async function getGaps({ sessionId, device = null }) {
  let query = supabaseAdmin
    .from('consult_audio_gaps')
    .select('id, session_id, device, gap_id, start_ms, duration_ms, reason_code, received_at')
    .eq('session_id', sessionId)
    .order('start_ms', { ascending: true });

  if (device) {
    query = query.eq('device', device);
  }

  const { data, error } = await query;
  if (error) {
    logger.error('Failed to fetch consultation gaps', {
      scope: 'consult-gap',
      sessionId,
      errorCode: 'ERR_GAP_READ',
    });
    const dbErr = new Error('Failed to fetch capture gaps');
    dbErr.status = 500;
    throw dbErr;
  }

  return data || [];
}

module.exports = {
  recordGap,
  getGaps,
  ALLOWED_REASON_CODES,
};
