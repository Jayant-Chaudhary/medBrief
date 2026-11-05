/**
 * Central Configuration for Consultation Audio Pipeline.
 *
 * All tunable parameters (chunk lengths, thresholds, timeouts, concurrency)
 * live in this module and can be overridden via environment variables.
 */

const env = process.env;

function positiveInteger(name, fallback) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid positive integer configuration: ${name}`);
  }
  return value;
}

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
  orchestratorPollMs: Number(env.ORCHESTRATOR_POLL_MS || 1000),

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
  // 'auto' lets the provider detect the language; otherwise a code such as 'en' or 'hi'.
  sttDefaultLanguage: env.STT_DEFAULT_LANGUAGE || 'auto',
  whisperServiceUrl: env.WHISPER_SERVICE_URL || 'http://localhost:8001',
  sarvamApiKey: env.SARVAM_API_KEY || '',
  sarvamModel: env.SARVAM_MODEL || 'saarika:v2',
  transcribeConcurrency: Number(env.TRANSCRIBE_CONCURRENCY || 3),
  transcribeMaxAttempts: Number(env.TRANSCRIBE_MAX_ATTEMPTS || 3),
  transcribeWorkerPollMs: Number(env.TRANSCRIBE_WORKER_POLL_MS || 1000),
  transcribeJobTimeoutMs: Number(env.TRANSCRIBE_JOB_TIMEOUT_MS || 30000),

  // Optional, disposable audio cache. Supabase remains the durable source.
  audioCacheEnabled: env.CONSULT_AUDIO_CACHE_ENABLED === 'true',
  redisUrl: env.REDIS_URL || 'redis://127.0.0.1:6379',
  audioCacheTtlSec: positiveInteger('AUDIO_CACHE_TTL_SEC', 1800),
  redisConnectTimeoutMs: positiveInteger('REDIS_CONNECT_TIMEOUT_MS', 500),
  redisCommandTimeoutMs: positiveInteger('REDIS_COMMAND_TIMEOUT_MS', 200),
  redisReconnectMaxDelayMs: positiveInteger('REDIS_RECONNECT_MAX_DELAY_MS', 5000),
  redisMaxPendingCommands: positiveInteger('REDIS_MAX_PENDING_COMMANDS', 128),

  // Deduplication & Crosstalk Handling
  dedupeMinOverlap: Number(env.DEDUPE_MIN_OVERLAP || 0.5),
  dedupeMinSimilarity: Number(env.DEDUPE_MIN_SIMILARITY || 0.8),
  lowConfidenceThreshold: Number(env.LOW_CONFIDENCE_THRESHOLD || 0.65),
  // Segments below this confidence are treated as noise and left out of the merged timeline (counted in stats).
  noiseConfidenceFloor: Number(env.NOISE_CONFIDENCE_FLOOR || 0.25),
  // Acoustic bleed between two mics in one room.
  crosstalkPartialSimilarity: Number(env.CROSSTALK_PARTIAL_SIMILARITY || 0.25),
  crosstalkPartialLoudnessDb: Number(env.CROSSTALK_PARTIAL_LOUDNESS_DB || 6),
  crosstalkDominantLoudnessDb: Number(env.CROSSTALK_DOMINANT_LOUDNESS_DB || 10),

  // Clinical Notes Drafting (Phase 8)
  draftModelProvider: env.DRAFT_MODEL_PROVIDER || 'gemini', // 'gemini' | 'local' | 'fake'
  geminiDraftModel: env.GEMINI_DRAFT_MODEL || 'gemini-3.5-flash-lite',
  geminiApiKey: env.GEMINI_API_KEY || '',
  localLlmUrl: env.LOCAL_LLM_URL || 'http://localhost:11434/api/chat',
  localLlmModel: env.LOCAL_LLM_MODEL || 'qwen3:8b',
  // Qwen3 'thinking' mode is slow for structured notes; off by default (Ollama /api/chat only).
  localLlmThink: env.LOCAL_LLM_THINK === 'true',
  draftTimeoutMs: Number(env.DRAFT_TIMEOUT_MS || 60000),

  // Audio Retention
  audioRetentionAfterReviewHours: Number(env.AUDIO_RETENTION_AFTER_REVIEW_HOURS || 24),
};
