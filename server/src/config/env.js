require('dotenv').config();
const logger = require('../utils/logger');

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLIENT_APP_URL',
  'OCR_SERVICE_URL',
  'OCR_CONFIDENCE_REVIEW_THRESHOLD',
];

for (const key of required) {
  if (!process.env[key]) {
    logger.warn(`Missing environment variable ${key}; using default fallback if applicable`, { scope: 'config' });
  }
}

module.exports = {
  host: process.env.HOST || '0.0.0.0',
  port: process.env.PORT || 4000,
  ocrServiceUrl: process.env.OCR_SERVICE_URL || 'http://localhost:8000',
  supabaseUrl: process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'placeholder-anon-key',
  clientAppUrl: process.env.CLIENT_APP_URL || 'http://localhost:5173', // used to build invite links + CORS origin
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'no-reply@medbrief.app',
  },
  inviteTokenTtlHours: Number(process.env.INVITE_TOKEN_TTL_HOURS || 72),
  ocrMetricReviewThreshold: Number(process.env.OCR_CONFIDENCE_REVIEW_THRESHOLD || 0.85),
  ocr: {
    // Extraction runs in the OCR service (PaddleOCRFastAPI) at ocrServiceUrl.
    // A multi-page scan on CPU takes ~10s a page, and uploads queue behind
    // each other there, so this is generous on purpose.
    timeoutMs: Number(process.env.OCR_TIMEOUT_MS || 180000),
    // Shortest word in a report's patient name where a one-letter difference
    // is treated as a misread rather than as a different name.
    nameTypoMinLength: Number(process.env.OCR_NAME_TYPO_MIN_LENGTH || 6),
    // How long a scan waits in memory for the uploader to answer a name
    // mismatch, and how many may wait at once. Past either, they rescan.
    pendingExtractionTtlMs: Number(process.env.OCR_PENDING_EXTRACTION_TTL_MS || 10 * 60 * 1000),
    pendingExtractionMax: Number(process.env.OCR_PENDING_EXTRACTION_MAX || 100),
  },
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024),
  nodeEnv: process.env.NODE_ENV || 'development',
  _demoSelfVerify: process.env.DEMO_SELF_VERIFY === 'true',
  isSelfVerifyPermitted() {
    const currentEnv = process.env.NODE_ENV || this.nodeEnv || 'development';
    if (currentEnv !== 'development' && currentEnv !== 'test') {
      return false;
    }
    const configured = this._demoSelfVerify !== undefined
      ? this._demoSelfVerify
      : process.env.DEMO_SELF_VERIFY === 'true';
    return Boolean(configured);
  },
  // Demo only: lets a clinician verify their own account from the
  // verification-pending page in development. Requires both NODE_ENV=development (or test)
  // and DEMO_SELF_VERIFY=true.
  // Production unconditionally disables self-verification even if DEMO_SELF_VERIFY is set.
  get demoSelfVerify() {
    return this.isSelfVerifyPermitted();
  },
  set demoSelfVerify(val) {
    this._demoSelfVerify = val;
  },

  // Patient Similarity Model Feature Flags
  isPatientSimilarityEnabled() {
    return process.env.PATIENT_SIMILARITY_ENABLED !== 'false';
  },
  isSimilaritySyntheticDataAllowed() {
    return process.env.PATIENT_SIMILARITY_USE_SYNTHETIC_DATA !== 'false';
  },
  get patientSimilarityEnabled() {
    return this.isPatientSimilarityEnabled();
  },
  get patientSimilarityUseSyntheticData() {
    return this.isSimilaritySyntheticDataAllowed();
  },
};
