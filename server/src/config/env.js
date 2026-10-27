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
  },
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024),
  ml: {
    // Optional until a maternal-health model service is available.
    serviceUrl: process.env.ML_SERVICE_URL || '',
    maternalRiskUrl: process.env.ML_MATERNAL_RISK_URL || '',
    patientSimilarityUrl: process.env.ML_PATIENT_SIMILARITY_URL || '',
    templateRecommendationUrl: process.env.ML_TEMPLATE_RECOMMENDATION_URL || '',
    apiKey: process.env.ML_SERVICE_API_KEY || '',
    timeoutMs: Number(process.env.ML_TIMEOUT_MS || 10000),
  },
  // Demo only: lets a clinician verify their own account from the
  // verification-pending page. Set DEMO_SELF_VERIFY=false to switch it off
  // once real (administrator) verification is in place.
  demoSelfVerify: process.env.DEMO_SELF_VERIFY !== 'false',
};
