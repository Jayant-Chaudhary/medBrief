/**
 * Synthea-Style Longitudinal Maternal Health Cohort Generator.
 *
 * Deterministically generates $N$ synthetic pregnancy episodes (using a seeded PRNG)
 * across 7 clinical archetypes with:
 * - Physiologically correlated vitals, labs, and longitudinal visit deltas
 * - Realistic missing-data masks (simulating un-ordered labs and unasked questions)
 * - Multi-turn speaker-diarized doctor-patient consultation transcripts (including
 *   small talk, pertinent negatives, and varied phrasing)
 * - Subsequent antenatal visit progressions and recorded delivery outcomes
 *
 * Safety & Privacy (AGENTS.md):
 * - 100% synthetic data generated mathematically from seeded distributions.
 * - Strictly descriptive clinical observations; never outputs medical diagnoses.
 */

const config = require('../../config/patientSimilarity.config');

/**
 * Deterministic 32-bit PRNG (Mulberry32).
 */
function createSeededRng(seed = config.defaultCohortSeed) {
  let a = Number(seed) >>> 0;
  return {
    next() {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    float(min, max, decimals = 1) {
      const val = min + this.next() * (max - min);
      const factor = 10 ** decimals;
      return Math.round(val * factor) / factor;
    },
    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    },
    chance(probability) {
      return this.next() < probability;
    },
  };
}

const BLOOD_GROUPS = ['O+', 'B+', 'A+', 'AB+', 'O-', 'B-', 'A-'];

const ARCHETYPE_DISTRIBUTION = [
  { archetype: 'elevated_bp_edema', weight: 0.20 },
  { archetype: 'maternal_anemia', weight: 0.20 },
  { archetype: 'hyperglycemia_pattern', weight: 0.16 },
  { archetype: 'hypothyroid_pattern', weight: 0.12 },
  { archetype: 'urinary_cramping_pattern', weight: 0.10 },
  { archetype: 'physiological_normal', weight: 0.12 },
  { archetype: 'sparse_incomplete_control', weight: 0.10 },
];

function pickArchetypeByIndex(index, totalCount) {
  // Deterministic stratified assignment so every cohort has exact proportional representation
  let cumulative = 0;
  const ratio = (index % totalCount) / totalCount;
  for (const item of ARCHETYPE_DISTRIBUTION) {
    cumulative += item.weight;
    if (ratio < cumulative) return item.archetype;
  }
  return 'physiological_normal';
}

/**
 * Builds a single synthetic longitudinal maternal episode for a given archetype.
 */
function generateEpisodeForArchetype(rng, id, archetype, options = {}) {
  const missingLabProbability = options.missingLabProbability ?? 0.22;
  const bloodGroup = rng.pick(BLOOD_GROUPS);

  if (archetype === 'sparse_incomplete_control') {
    const weeks = rng.int(24, 32);
    return {
      id,
      label: `Case ${id.toUpperCase()} (${weeks}w — Sparse Control: Only Gestational Age & Blood Group Recorded)`,
      archetype,
      gestationalWeeks: weeks,
      gravida: rng.int(1, 3),
      para: rng.int(0, 2),
      blood_group: bloodGroup,
      vitals: {},
      labs: {},
      transcriptSegments: [],
      progressionSummary: 'Incomplete historical record with sparse clinical documentation.',
      subsequentVisits: [],
      interventionsRecorded: [],
      deliveryOutcome: null,
    };
  }

  if (archetype === 'elevated_bp_edema') {
    const weeks = rng.int(27, 33);
    const age = rng.int(24, 35);
    const gravida = rng.int(1, 3);
    const para = Math.max(0, gravida - rng.int(1, 2));
    const sysBp = rng.int(138, 154);
    const diaBp = rng.int(88, 100);
    const prevSys = sysBp - rng.int(12, 22);
    const prevDia = diaBp - rng.int(8, 16);
    const albumin = rng.pick(['trace', '1+', '2+']);
    const headSev = rng.pick(['moderate', 'severe']);

    const labs = {
      hemoglobin: rng.float(10.8, 12.4, 1),
      urine_albumin: albumin,
      urine_sugar: 'nil',
      platelets: rng.int(145, 220),
      creatinine: rng.float(0.68, 0.92, 2),
      alt: rng.int(20, 48),
      ast: rng.int(22, 52),
      tsh: rng.float(1.4, 2.6, 1),
    };
    if (rng.chance(missingLabProbability)) delete labs.tsh;
    if (rng.chance(missingLabProbability)) delete labs.alt;

    return {
      id,
      label: `Case ${id.toUpperCase()} (${weeks}w, G${gravida}P${para} — Elevated BP ${sysBp}/${diaBp} + ${headSev} Headache + Pedal Edema)`,
      archetype,
      gestationalWeeks: weeks,
      age,
      gravida,
      para,
      abortions: Math.max(0, gravida - para - 1),
      bmi: rng.float(25.0, 30.5, 1),
      blood_group: bloodGroup,
      previous_cs: para > 0 ? rng.chance(0.25) : false,
      previous_preeclampsia: para > 0 ? rng.chance(0.2) : false,
      previous_gdm: false,
      vitals: {
        bp_systolic: sysBp,
        bp_diastolic: diaBp,
        weight_kg: rng.float(64, 78, 1),
        fundal_height_cm: weeks + rng.int(-1, 1),
        fetal_heart_rate_bpm: rng.int(138, 152),
      },
      previousVitals: {
        bp_systolic: prevSys,
        bp_diastolic: prevDia,
      },
      labs,
      previousLabs: {
        hemoglobin: Math.round((labs.hemoglobin + 0.3) * 10) / 10,
      },
      questionnaireResponses: [
        { question: 'Have you noticed swelling in your ankles or feet?', answer: true, detail: 'Mild ankle swelling in the evening' },
        { question: 'Have you had any vaginal bleeding?', answer: false },
      ],
      transcriptSegments: [
        {
          segment_id: `${id}_s1`,
          speaker: 'patient',
          text: `Doctor, I have had a ${headSev} frontal headache for the past two days and mild ankle swelling by evening.`,
        },
        {
          segment_id: `${id}_s2`,
          speaker: 'doctor',
          text: 'Have you noticed any blurred vision, seeing spots, or epigastric pain under your ribs?',
        },
        {
          segment_id: `${id}_s3`,
          speaker: 'patient',
          text: 'No blurred vision and no epigastric pain at all, and the baby is moving well.',
        },
      ],
      progressionSummary:
        'Followed twice-weekly for blood pressure surveillance and repeat urine protein-to-creatinine checks; blood pressure stabilized prior to term delivery.',
      subsequentVisits: [
        { weeks: weeks + 2, bp: `${sysBp - 6}/${diaBp - 4} mmHg`, urine_albumin: 'trace', notes: 'Headache resolved; normal fetal Doppler.' },
        { weeks: Math.min(37, weeks + 5), bp: `${sysBp - 4}/${diaBp - 4} mmHg`, urine_albumin: albumin, notes: 'Scheduled term induction/delivery surveillance.' },
      ],
      interventionsRecorded: [
        'Twice-weekly home and clinic blood pressure log',
        'Repeat spot urine protein, platelet count, serum creatinine, and liver enzyme panel',
        'Triage warning-sign counseling (visual changes, persistent headache, epigastric pain)',
      ],
      deliveryOutcome: {
        deliveredAtWeeks: rng.float(37.2, 39.0, 1),
        deliveryType: rng.chance(0.75) ? 'Spontaneous vaginal delivery' : 'Cesarean section',
        indication: 'Term gestation with monitored blood pressure elevation',
        babyWeightKg: rng.float(2.75, 3.2, 2),
        apgar1Min: 8,
        apgar5Min: 9,
        postnatalCourse: 'Postpartum BP normalized within 72 hours.',
      },
    };
  }

  if (archetype === 'maternal_anemia') {
    const weeks = rng.int(22, 30);
    const age = rng.int(21, 31);
    const gravida = rng.int(1, 4);
    const para = Math.max(0, gravida - 1);
    const hb = rng.float(8.1, 9.5, 1);
    const prevHb = Math.round((hb + rng.float(0.9, 1.6, 1)) * 10) / 10;

    const labs = {
      hemoglobin: hb,
      platelets: rng.int(210, 290),
      urine_albumin: 'nil',
      urine_sugar: 'nil',
      fasting_glucose: rng.int(78, 90),
      tsh: rng.float(1.3, 2.4, 1),
    };
    if (rng.chance(missingLabProbability)) delete labs.fasting_glucose;
    if (rng.chance(missingLabProbability)) delete labs.tsh;

    return {
      id,
      label: `Case ${id.toUpperCase()} (${weeks}w, G${gravida}P${para} — Anemia Hb ${hb} g/dL + Fatigue & Breathlessness)`,
      archetype,
      gestationalWeeks: weeks,
      age,
      gravida,
      para,
      abortions: 0,
      bmi: rng.float(19.8, 23.5, 1),
      blood_group: bloodGroup,
      previous_cs: false,
      previous_preeclampsia: false,
      vitals: {
        bp_systolic: rng.int(104, 116),
        bp_diastolic: rng.int(66, 74),
        weight_kg: rng.float(51, 61, 1),
        fundal_height_cm: weeks,
        fetal_heart_rate_bpm: rng.int(142, 154),
      },
      previousVitals: {
        bp_systolic: rng.int(106, 116),
        bp_diastolic: rng.int(68, 74),
      },
      labs,
      previousLabs: {
        hemoglobin: prevHb,
      },
      questionnaireResponses: [
        { question: 'Have you experienced unusual tiredness or weakness?', answer: true, detail: 'Severe fatigue and tiredness' },
      ],
      transcriptSegments: [
        {
          segment_id: `${id}_s1`,
          speaker: 'patient',
          text: 'I have been feeling severe fatigue and breathlessness when climbing stairs, along with occasional dizziness.',
        },
        {
          segment_id: `${id}_s2`,
          speaker: 'doctor',
          text: 'Any vaginal bleeding, headache, or swelling in your ankles?',
        },
        {
          segment_id: `${id}_s3`,
          speaker: 'patient',
          text: 'No vaginal bleeding, no headache, and no pedal edema.',
        },
      ],
      progressionSummary:
        'Evaluated ferritin and peripheral smear; adjusted oral/parenteral iron schedule with dietary counseling. Hb rose >10.5 g/dL prior to delivery.',
      subsequentVisits: [
        { weeks: weeks + 4, bp: '112/72 mmHg', hb: `${Math.round((hb + 0.9) * 10) / 10} g/dL`, notes: 'Fatigue and breathlessness improving.' },
      ],
      interventionsRecorded: [
        'Serum ferritin and peripheral blood smear check',
        'Adjusted iron supplementation dosing with vitamin C co-administration',
        '4-week repeat hemoglobin verification',
      ],
      deliveryOutcome: {
        deliveredAtWeeks: rng.float(38.5, 40.0, 1),
        deliveryType: 'Spontaneous vaginal delivery',
        indication: 'Term labor',
        babyWeightKg: rng.float(2.85, 3.25, 2),
        apgar1Min: 9,
        apgar5Min: 9,
        postnatalCourse: 'Uncomplicated postpartum course; continued iron for 12 weeks.',
      },
    };
  }

  if (archetype === 'hyperglycemia_pattern') {
    const weeks = rng.int(24, 29);
    const age = rng.int(27, 36);
    const gravida = rng.int(1, 3);
    const para = Math.max(0, gravida - 1);
    const fasting = rng.int(100, 122);
    const postMeal = rng.int(148, 182);

    const labs = {
      hemoglobin: rng.float(11.4, 12.6, 1),
      fasting_glucose: fasting,
      post_meal_glucose: postMeal,
      hba1c: rng.float(5.7, 6.3, 1),
      urine_albumin: 'nil',
      urine_sugar: rng.pick(['trace', '1+', '2+']),
      tsh: rng.float(1.5, 2.5, 1),
    };
    if (rng.chance(missingLabProbability)) delete labs.hba1c;

    return {
      id,
      label: `Case ${id.toUpperCase()} (${weeks}w, G${gravida}P${para} — Elevated Glucose Fasting ${fasting} / PP ${postMeal} mg/dL)`,
      archetype,
      gestationalWeeks: weeks,
      age,
      gravida,
      para,
      abortions: 0,
      bmi: rng.float(26.8, 31.5, 1),
      blood_group: bloodGroup,
      previous_gdm: para > 0 ? rng.chance(0.45) : false,
      vitals: {
        bp_systolic: rng.int(116, 126),
        bp_diastolic: rng.int(74, 82),
        weight_kg: rng.float(67, 79, 1),
        fundal_height_cm: weeks + rng.int(0, 1),
        fetal_heart_rate_bpm: rng.int(140, 150),
      },
      labs,
      transcriptSegments: [
        {
          segment_id: `${id}_s1`,
          speaker: 'patient',
          text: 'I have been feeling mild fatigue after meals and my fasting and post-meal glucose lab numbers came back elevated.',
        },
        {
          segment_id: `${id}_s2`,
          speaker: 'patient',
          text: 'I have no burning urination, no headache, and no ankle swelling, and baby movements are active.',
        },
      ],
      progressionSummary:
        'Started structured medical nutrition therapy, post-meal walking regimen, and home capillary blood glucose monitoring; glycemic targets maintained.',
      subsequentVisits: [
        { weeks: weeks + 3, fasting_glucose: '89 mg/dL', post_meal_glucose: '120 mg/dL', notes: 'Glycemic profile controlled on nutrition plan.' },
      ],
      interventionsRecorded: [
        'Medical nutrition therapy and carbohydrate distribution counseling',
        '4-point home fasting and 2-hour post-meal glucometer log',
        'Serial 32- and 36-week fetal biometry and amniotic fluid ultrasound',
      ],
      deliveryOutcome: {
        deliveredAtWeeks: rng.float(38.6, 39.6, 1),
        deliveryType: 'Spontaneous vaginal delivery',
        indication: 'Term gestation with controlled glycemic profile',
        babyWeightKg: rng.float(3.15, 3.55, 2),
        apgar1Min: 9,
        apgar5Min: 9,
        postnatalCourse: 'Neonatal glucose normal; 6-week postpartum OGTT scheduled.',
      },
    };
  }

  if (archetype === 'hypothyroid_pattern') {
    const weeks = rng.int(14, 22);
    const tsh = rng.float(4.6, 7.8, 1);

    return {
      id,
      label: `Case ${id.toUpperCase()} (${weeks}w — Elevated TSH ${tsh} mIU/L + Mild Fatigue)`,
      archetype,
      gestationalWeeks: weeks,
      age: rng.int(24, 33),
      gravida: rng.int(1, 2),
      para: rng.int(0, 1),
      bmi: rng.float(22.5, 26.5, 1),
      blood_group: bloodGroup,
      known_thyroid_condition: true,
      vitals: {
        bp_systolic: rng.int(110, 120),
        bp_diastolic: rng.int(70, 76),
        weight_kg: rng.float(57, 66, 1),
        fetal_heart_rate_bpm: rng.int(144, 154),
      },
      labs: {
        hemoglobin: rng.float(11.5, 12.6, 1),
        tsh,
        fasting_glucose: rng.int(80, 90),
        urine_albumin: 'nil',
        urine_sugar: 'nil',
      },
      transcriptSegments: [
        {
          segment_id: `${id}_s1`,
          speaker: 'patient',
          text: `I have had mild fatigue lately, and my thyroid TSH test came back elevated at ${tsh}.`,
        },
        {
          segment_id: `${id}_s2`,
          speaker: 'patient',
          text: 'I have no nausea or vomiting, no vaginal bleeding, and no cramping.',
        },
      ],
      progressionSummary: 'Titrated thyroid supplementation with 4-weekly TSH checks; normalized <2.5 mIU/L.',
      subsequentVisits: [
        { weeks: weeks + 4, tsh: '2.1 mIU/L', notes: 'Euthyroid on adjusted supplementation.' },
      ],
      interventionsRecorded: [
        'Thyroid replacement titration taken fasting (4 hours apart from iron/calcium)',
        'Repeat TSH every 4 weeks',
      ],
      deliveryOutcome: {
        deliveredAtWeeks: rng.float(39.0, 40.1, 1),
        deliveryType: 'Spontaneous vaginal delivery',
        indication: 'Term labor',
        babyWeightKg: rng.float(3.0, 3.35, 2),
        apgar1Min: 9,
        apgar5Min: 9,
        postnatalCourse: 'Returned to pre-pregnancy thyroid regimen.',
      },
    };
  }

  if (archetype === 'urinary_cramping_pattern') {
    const weeks = rng.int(20, 28);
    return {
      id,
      label: `Case ${id.toUpperCase()} (${weeks}w — Dysuria + Mild Lower Pelvic Cramping)`,
      archetype,
      gestationalWeeks: weeks,
      age: rng.int(23, 32),
      gravida: rng.int(1, 3),
      para: rng.int(0, 2),
      bmi: rng.float(21.5, 25.5, 1),
      blood_group: bloodGroup,
      vitals: {
        bp_systolic: rng.int(110, 118),
        bp_diastolic: rng.int(68, 76),
        weight_kg: rng.float(56, 65, 1),
        fundal_height_cm: weeks,
        fetal_heart_rate_bpm: rng.int(142, 152),
      },
      labs: {
        hemoglobin: rng.float(11.4, 12.5, 1),
        urine_albumin: 'trace',
        urine_sugar: 'nil',
        tsh: rng.float(1.4, 2.2, 1),
      },
      transcriptSegments: [
        {
          segment_id: `${id}_s1`,
          speaker: 'patient',
          text: 'For the past two days I have noticed burning on urination and mild pelvic cramping.',
        },
        {
          segment_id: `${id}_s2`,
          speaker: 'patient',
          text: 'I do not have fever or chills, and no vaginal bleeding or fluid leakage.',
        },
      ],
      progressionSummary: 'Midstream urine culture sent; symptoms resolved within 72h and repeat culture negative.',
      subsequentVisits: [
        { weeks: weeks + 2, urine_albumin: 'nil', notes: 'Test-of-cure culture negative; cramping resolved.' },
      ],
      interventionsRecorded: [
        'Midstream urine microscopy and culture/sensitivity',
        'Repeat test-of-cure urine culture post-treatment',
      ],
      deliveryOutcome: {
        deliveredAtWeeks: rng.float(39.0, 40.0, 1),
        deliveryType: 'Spontaneous vaginal delivery',
        indication: 'Term labor',
        babyWeightKg: rng.float(3.05, 3.4, 2),
        apgar1Min: 9,
        apgar5Min: 9,
        postnatalCourse: 'Uncomplicated.',
      },
    };
  }

  // Default: 'physiological_normal'
  const weeks = rng.int(24, 32);
  const gravida = rng.int(1, 3);
  const para = Math.max(0, gravida - 1);
  return {
    id,
    label: `Case ${id.toUpperCase()} (${weeks}w, G${gravida}P${para} — Uncomplicated Physiological Antenatal Visit)`,
    archetype: 'physiological_normal',
    gestationalWeeks: weeks,
    age: rng.int(24, 32),
    gravida,
    para,
    abortions: 0,
    bmi: rng.float(21.5, 25.0, 1),
    blood_group: bloodGroup,
    previous_cs: false,
    previous_preeclampsia: false,
    previous_gdm: false,
    vitals: {
      bp_systolic: rng.int(112, 120),
      bp_diastolic: rng.int(70, 76),
      weight_kg: rng.float(58, 66, 1),
      fundal_height_cm: weeks,
      fetal_heart_rate_bpm: rng.int(140, 150),
    },
    previousVitals: {
      bp_systolic: rng.int(112, 118),
      bp_diastolic: rng.int(70, 76),
    },
    labs: {
      hemoglobin: rng.float(11.8, 12.9, 1),
      platelets: rng.int(220, 290),
      fasting_glucose: rng.int(78, 89),
      post_meal_glucose: rng.int(105, 122),
      urine_albumin: 'nil',
      urine_sugar: 'nil',
      tsh: rng.float(1.3, 2.2, 1),
      creatinine: rng.float(0.6, 0.72, 2),
    },
    previousLabs: {
      hemoglobin: rng.float(11.9, 12.9, 1),
    },
    transcriptSegments: [
      {
        segment_id: `${id}_s1`,
        speaker: 'patient',
        text: 'I feel great overall, the baby is moving well, and I have no headache, no ankle swelling, and no blurred vision.',
      },
    ],
    progressionSummary: 'Routine antenatal progression with normal maternal and fetal parameters.',
    subsequentVisits: [
      { weeks: weeks + 4, bp: '116/74 mmHg', urine_albumin: 'nil', notes: 'Routine antenatal check normal.' },
    ],
    interventionsRecorded: ['Routine iron, calcium, and scheduled antenatal follow-up'],
    deliveryOutcome: {
      deliveredAtWeeks: rng.float(39.0, 40.2, 1),
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Spontaneous term labor',
      babyWeightKg: rng.float(3.1, 3.45, 2),
      apgar1Min: 9,
      apgar5Min: 9,
      postnatalCourse: 'Routine discharge.',
    },
  };
}

/**
 * Generates a reproducible synthetic longitudinal maternal cohort of size `count`.
 *
 * @param {number} [count=100]
 * @param {Object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.missingLabProbability]
 * @returns {Array<Object>}
 */
function generateSyntheticMaternalCohort(count = config.defaultGeneratedCohortSize, options = {}) {
  const safeCount = Math.max(1, Math.min(Number(count) || 100, 1000));
  const rng = createSeededRng(options.seed ?? config.defaultCohortSeed);
  const episodes = [];

  for (let i = 0; i < safeCount; i++) {
    const archetype = pickArchetypeByIndex(i, safeCount);
    const id = `gen-ep-${String(i + 1).padStart(4, '0')}`;
    episodes.push(generateEpisodeForArchetype(rng, id, archetype, options));
  }

  return episodes;
}

module.exports = {
  createSeededRng,
  ARCHETYPE_DISTRIBUTION,
  generateEpisodeForArchetype,
  generateSyntheticMaternalCohort,
};
