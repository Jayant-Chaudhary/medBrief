/**
 * Configuration for prenatal check-in and AI pre-visit summarization.
 * Tunable parameters (lookback period, timeouts, cadence intervals, emergency keywords) are kept here.
 */

module.exports = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  lookbackDays: Number(process.env.CHECKIN_LOOKBACK_DAYS || 28),
  quickPulseIntervalDays: Number(process.env.CHECKIN_QUICK_PULSE_DAYS || 3),
  weeklyCheckinIntervalDays: Number(process.env.CHECKIN_WEEKLY_INTERVAL_DAYS || 7),
  requestTimeoutMs: Number(process.env.CHECKIN_AI_TIMEOUT_MS || 15000),
  maxOutputTokens: Number(process.env.CHECKIN_AI_MAX_TOKENS || 2048),
  emergencyKeywords: [
    'bleeding',
    'blood',
    'leak',
    'fluid leaking',
    'fever',
    'severe pain',
    'severe ache',
    'severe headache',
    'vision',
    'blurry',
    'scotoma',
    'swelling face',
    'swelling hands',
    'no movement',
    'reduced movement',
    'less movement',
    'chest pain',
    'faint',
    'convulsion',
    'seizure',
    'contractions',
  ],
};
