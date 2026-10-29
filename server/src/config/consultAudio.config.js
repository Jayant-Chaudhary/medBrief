/**
 * Central Configuration for Consultation Audio Pipeline.
 *
 * All tunable parameters (chunk lengths, thresholds, timeouts, concurrency)
 * live in this module and can be overridden via environment variables.
 */

const env = process.env;

module.exports = {
  // Audio Chunking
  chunkMinSec: Number(env.CHUNK_MIN_SEC || 15),
  chunkHardCapSec: Number(env.CHUNK_HARD_CAP_SEC || 25),
  pauseMs: Number(env.PAUSE_MS || 500),
  silenceDbfs: Number(env.SILENCE_DBFS || -45),
  chunkMaxBytes: Number(env.CHUNK_MAX_BYTES || 2000000), // 2 MB

  // Session & Room Code
  roomCodeTtlMin: Number(env.ROOM_CODE_TTL_MIN || 10),
  roomCodeLength: Number(env.ROOM_CODE_LENGTH || 6),
  maxJoinAttempts: Number(env.MAX_JOIN_ATTEMPTS || 5),
  endDeadlineSec: Number(env.END_DEADLINE_SEC || 15),

  // Scoped Session Tokens
  sessionTokenSecret: env.SESSION_TOKEN_SECRET || 'dev-consult-session-secret-change-in-prod',
  sessionTokenTtlSec: Number(env.SESSION_TOKEN_TTL_SEC || 7200), // 2 hours

  // Consent Version
  consentTextVersion: env.CONSENT_TEXT_VERSION || 'v1.0',

  // Device Upload & Retry
  uploadBackoffMs: (env.UPLOAD_BACKOFF_MS || '1000,2000,4000,8000,30000')
    .split(',')
    .map((s) => Number(s.trim())),

  // Speech-to-Text & Transcription
  sttProvider: env.STT_PROVIDER || 'sarvam', // 'sarvam' | 'fake' | 'local'
  transcribeConcurrency: Number(env.TRANSCRIBE_CONCURRENCY || 3),
  transcribeMaxAttempts: Number(env.TRANSCRIBE_MAX_ATTEMPTS || 3),

  // Deduplication & Crosstalk Handling
  dedupeMinOverlap: Number(env.DEDUPE_MIN_OVERLAP || 0.5),
  dedupeMinSimilarity: Number(env.DEDUPE_MIN_SIMILARITY || 0.8),

  // Audio Retention
  audioRetentionAfterReviewHours: Number(env.AUDIO_RETENTION_AFTER_REVIEW_HOURS || 0),
};
