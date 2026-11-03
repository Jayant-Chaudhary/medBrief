/**
 * Central Configuration for Patient Similarity Model.
 *
 * All tunable parameters (gestational windows, Bayesian coverage shrinkage,
 * per-parameter structured weights, per-symptom clinical weights, severity
 * multipliers, and LLM provider defaults) live here and can be overridden via
 * environment variables or per-request API options.
 *
 * Safety & Privacy (AGENTS.md):
 * - No clinical diagnostic thresholds are invented here; weights govern descriptive
 *   similarity ranking only.
 */

const consultConfig = require('./consultAudio.config');

const env = process.env;

function num(envKey, fallback) {
  const val = Number(env[envKey] ?? fallback);
  return Number.isFinite(val) ? val : fallback;
}

const SYMPTOM_DEFINITIONS = Object.freeze({
  vaginal_bleeding: {
    weight: 4.0,
    tier: 'high_priority',
    label: 'Vaginal Bleeding / Spotting',
  },
  visual_disturbance: {
    weight: 3.8,
    tier: 'high_priority',
    label: 'Visual Disturbance / Blurred Vision',
  },
  reduced_fetal_movement: {
    weight: 3.8,
    tier: 'high_priority',
    label: 'Reduced Fetal Movements',
  },
  epigastric_pain: {
    weight: 3.6,
    tier: 'high_priority',
    label: 'Epigastric / Right Upper Quadrant Pain',
  },
  fluid_leakage: {
    weight: 3.5,
    tier: 'high_priority',
    label: 'Per-Vaginal Fluid Leakage',
  },
  facial_or_hand_swelling: {
    weight: 3.3,
    tier: 'high_priority',
    label: 'Facial or Hand Swelling',
  },
  headache: {
    weight: 2.8,
    tier: 'moderate_priority',
    label: 'Headache',
  },
  contractions_cramping: {
    weight: 2.8,
    tier: 'moderate_priority',
    label: 'Uterine Contractions / Pelvic Cramping',
  },
  fever_chills: {
    weight: 2.8,
    tier: 'moderate_priority',
    label: 'Fever or Chills',
  },
  breathlessness: {
    weight: 2.6,
    tier: 'moderate_priority',
    label: 'Breathlessness / Dyspnea on Exertion',
  },
  itching_cholestasis: {
    weight: 2.6,
    tier: 'moderate_priority',
    label: 'Palmar / Plantar Itching (Pruritus)',
  },
  pedal_edema: {
    weight: 2.5,
    tier: 'moderate_priority',
    label: 'Pedal / Ankle Edema',
  },
  dysuria_urinary_symptoms: {
    weight: 2.4,
    tier: 'moderate_priority',
    label: 'Dysuria / Urinary Frequency',
  },
  dizziness_palpitations: {
    weight: 2.0,
    tier: 'general_symptom',
    label: 'Dizziness or Palpitations',
  },
  nausea_vomiting: {
    weight: 1.6,
    tier: 'general_symptom',
    label: 'Nausea or Vomiting',
  },
  fatigue_weakness: {
    weight: 1.5,
    tier: 'general_symptom',
    label: 'Fatigue / Generalized Weakness',
  },
});

module.exports = Object.freeze({
  modelVersion: 'hybrid-gower-shrinkage-v2',

  // Provider configuration (aligned with consultAudio.config.js)
  extractorProvider: env.PATIENT_SIMILARITY_PROVIDER || consultConfig.draftModelProvider || 'gemini',
  geminiModel: env.PATIENT_SIMILARITY_GEMINI_MODEL || consultConfig.geminiDraftModel || 'gemini-3.5-flash-lite',
  geminiEmbeddingModel: env.PATIENT_SIMILARITY_EMBEDDING_MODEL || 'text-embedding-004',
  geminiApiKey: env.GEMINI_API_KEY || consultConfig.geminiApiKey || '',
  localLlmUrl: env.LOCAL_LLM_URL || consultConfig.localLlmUrl || 'http://localhost:11434/api/chat',
  localLlmModel: env.LOCAL_LLM_MODEL || consultConfig.localLlmModel || 'qwen3:8b',
  localLlmThink: consultConfig.localLlmThink || false,
  extractorTimeoutMs: num('PATIENT_SIMILARITY_TIMEOUT_MS', consultConfig.draftTimeoutMs || 30000),

  // Retrieval & Cohort Filtering
  defaultTopK: num('PATIENT_SIMILARITY_TOP_K', 5),
  maxTopK: num('PATIENT_SIMILARITY_MAX_TOP_K', 25),
  defaultGestationalWindowWeeks: num('PATIENT_SIMILARITY_GEST_WINDOW_WEEKS', 6),
  defaultGeneratedCohortSize: num('PATIENT_SIMILARITY_GENERATED_COHORT_SIZE', 100),
  defaultCohortSeed: num('PATIENT_SIMILARITY_COHORT_SEED', 20261103),

  // Bayesian Coverage Shrinkage for Missing Values ("No Value" regularization)
  // S_shrunk = (W_compared * S_raw + K * S_0) / (W_compared + K)
  shrinkageStrengthK: num('PATIENT_SIMILARITY_SHRINKAGE_K', 4.5),
  shrinkagePriorS0: num('PATIENT_SIMILARITY_SHRINKAGE_S0', 0.32),

  // Hybrid Sub-Score Fusion Weights (sum to 1.0 when all three modalities are active)
  alphaStructured: num('PATIENT_SIMILARITY_ALPHA_STRUCTURED', 0.45),
  betaSymptoms: num('PATIENT_SIMILARITY_BETA_SYMPTOMS', 0.35),
  gammaNarrative: num('PATIENT_SIMILARITY_GAMMA_NARRATIVE', 0.20),

  // Per-Symptom Custom Clinical Weights & Metadata
  symptomDefinitions: SYMPTOM_DEFINITIONS,

  // Canonical Symptom Keys recognized across pre-visit questionnaires and transcripts
  canonicalSymptomKeys: Object.freeze(Object.keys(SYMPTOM_DEFINITIONS)),

  // Severity Multipliers applied on top of each symptom's custom weight when status === 'present'
  severityWeightMultipliers: Object.freeze({
    severe: 1.25,
    moderate: 1.0,
    mild: 0.85,
    unspecified: 1.0,
  }),

  // Polarity & Interaction Multipliers for Symptom Comparison
  symptomWeights: Object.freeze({
    // Multipliers relative to the symptom's custom weight in symptomDefinitions
    presentMatchMultiplier: num('SYMPTOM_MULT_PRESENT_MATCH', 1.0),
    presentVsAbsentConflictMultiplier: num('SYMPTOM_MULT_CONFLICT', 1.0),
    presentVsMissingInCandidateMultiplier: num('SYMPTOM_MULT_MISSING_IN_CANDIDATE', 0.5),
    absentMatchPertinentNegativeMultiplier: num('SYMPTOM_MULT_ABSENT_MATCH', 0.18),

    // Legacy fallback constants if a caller overrides raw numbers
    presentMatch: num('SYMPTOM_WEIGHT_PRESENT_MATCH', 3.0),
    presentVsAbsentConflict: num('SYMPTOM_WEIGHT_CONFLICT', 3.0),
    presentVsMissingInCandidate: num('SYMPTOM_WEIGHT_MISSING_IN_CANDIDATE', 1.5),
    absentMatchPertinentNegative: num('SYMPTOM_WEIGHT_ABSENT_MATCH', 0.5),
    severityExactBonus: 1.0,
    severityPartialFactor: 0.8,
  }),

  // Structured Numeric & Categorical Feature Definitions + Custom Edge Weights
  structuredFeatures: Object.freeze({
    // Gestational & Obstetric Baseline
    gestational_weeks: { type: 'number', unit: 'weeks', weight: 1.5, label: 'Gestational Age' },
    age_years: { type: 'number', unit: 'years', weight: 1.0, label: 'Maternal Age' },
    gravida: { type: 'number', unit: '', weight: 1.0, label: 'Gravida' },
    para: { type: 'number', unit: '', weight: 1.0, label: 'Para' },
    abortions: { type: 'number', unit: '', weight: 0.8, label: 'Previous Losses' },
    bmi: { type: 'number', unit: 'kg/m2', weight: 1.2, label: 'BMI' },

    // Vitals & Longitudinal Deltas
    bp_systolic: { type: 'number', unit: 'mmHg', weight: 2.5, label: 'Systolic BP' },
    bp_diastolic: { type: 'number', unit: 'mmHg', weight: 2.5, label: 'Diastolic BP' },
    bp_systolic_delta: { type: 'number', unit: 'mmHg', weight: 2.0, label: 'Systolic BP Change' },
    bp_diastolic_delta: { type: 'number', unit: 'mmHg', weight: 2.0, label: 'Diastolic BP Change' },
    weight_kg: { type: 'number', unit: 'kg', weight: 0.8, label: 'Maternal Weight' },
    fundal_height_cm: { type: 'number', unit: 'cm', weight: 1.0, label: 'Fundal Height' },
    fetal_heart_rate_bpm: { type: 'number', unit: 'bpm', weight: 1.0, label: 'Fetal Heart Rate' },

    // Laboratory Metrics & Longitudinal Deltas
    hemoglobin: { type: 'number', unit: 'g/dL', weight: 2.5, label: 'Hemoglobin (Hb)' },
    hemoglobin_delta: { type: 'number', unit: 'g/dL', weight: 1.8, label: 'Hemoglobin Change' },
    platelets: { type: 'number', unit: '10^3/uL', weight: 1.8, label: 'Platelet Count' },
    fasting_glucose: { type: 'number', unit: 'mg/dL', weight: 2.2, label: 'Fasting Blood Glucose' },
    post_meal_glucose: { type: 'number', unit: 'mg/dL', weight: 2.2, label: 'Post-Meal Blood Glucose' },
    hba1c: { type: 'number', unit: '%', weight: 1.8, label: 'HbA1c' },
    tsh: { type: 'number', unit: 'mIU/L', weight: 2.0, label: 'TSH' },
    creatinine: { type: 'number', unit: 'mg/dL', weight: 1.5, label: 'Serum Creatinine' },
    alt: { type: 'number', unit: 'U/L', weight: 1.4, label: 'ALT' },
    ast: { type: 'number', unit: 'U/L', weight: 1.4, label: 'AST' },

    // Categorical / Dipstick / History Factors
    urine_albumin: {
      type: 'ordinal',
      order: ['nil', 'trace', '1+', '2+', '3+', '4+'],
      weight: 2.5,
      label: 'Urine Albumin / Protein',
    },
    urine_sugar: {
      type: 'ordinal',
      order: ['nil', 'trace', '1+', '2+', '3+', '4+'],
      weight: 1.6,
      label: 'Urine Sugar',
    },
    blood_group: { type: 'categorical', weight: 0.5, label: 'Blood Group' },
    previous_cs: { type: 'categorical', weight: 1.5, label: 'Previous Cesarean Section' },
    previous_preeclampsia: { type: 'categorical', weight: 2.0, label: 'Previous Pre-eclampsia History' },
    previous_gdm: { type: 'categorical', weight: 2.0, label: 'Previous Gestational Diabetes History' },
    known_thyroid_condition: { type: 'categorical', weight: 1.6, label: 'Known Thyroid History' },
  }),
});
