/**
 * 100% Synthetic Maternal Health Reference Cohort & Sample Query Scenarios.
 *
 * Used for demonstrating, testing, and benchmarking the Patient Similarity Model
 * without real patient data.
 *
 * Safety & Privacy (AGENTS.md):
 * - All records, transcripts, lab numbers, and outcomes are completely synthetic.
 * - Progression and outcomes are strictly descriptive historical observations.
 */

const SYNTHETIC_REFERENCE_COHORT = [
  // =========================================================================
  // CLUSTER 1: Third-Trimester Elevated BP + Albuminuria + Headache / Edema
  // =========================================================================
  {
    id: 'syn-ep-001',
    label: 'Case SYN-001 (29w, G2P1 — Elevated BP + Frontal Headache + Pedal Edema)',
    archetype: 'elevated_bp_edema',
    gestationalWeeks: 29,
    age: 29,
    gravida: 2,
    para: 1,
    abortions: 0,
    bmi: 26.8,
    blood_group: 'O+',
    previous_cs: false,
    previous_preeclampsia: false,
    previous_gdm: false,
    vitals: {
      bp_systolic: 142,
      bp_diastolic: 92,
      weight_kg: 68.5,
      fundal_height_cm: 29,
      fetal_heart_rate_bpm: 144,
    },
    previousVitals: {
      bp_systolic: 124,
      bp_diastolic: 78,
    },
    labs: {
      hemoglobin: 11.2,
      platelets: 195,
      urine_albumin: '1+',
      urine_sugar: 'nil',
      creatinine: 0.72,
      alt: 24,
      ast: 26,
      tsh: 2.1,
    },
    previousLabs: {
      hemoglobin: 11.5,
    },
    questionnaireResponses: [
      { question: 'Have you noticed ankle or foot swelling?', answer: true, detail: 'Mild swelling in both ankles by evening' },
      { question: 'Have you had any vaginal bleeding?', answer: false },
    ],
    transcriptSegments: [
      { segment_id: 'syn001_s1', speaker: 'patient', text: 'Doctor, I have had a moderate frontal headache for the past three days and swollen ankles.' },
      { segment_id: 'syn001_s2', speaker: 'doctor', text: 'Have you noticed any blurred vision, seeing spots, or pain under your ribs?' },
      { segment_id: 'syn001_s3', speaker: 'patient', text: 'No blurred vision and no upper abdominal pain at all, and the baby is moving well.' },
    ],
    progressionSummary:
      'Followed twice-weekly for blood pressure and repeat urine protein checks. BP stabilized between 132/84 and 136/86 mmHg with close outpatient monitoring and rest; liver enzymes and platelets remained within normal range.',
    subsequentVisits: [
      { weeks: 31, bp: '136/86 mmHg', urine_albumin: 'trace', notes: 'Headache resolved; fetal growth scan appropriate for gestational age.' },
      { weeks: 34, bp: '134/84 mmHg', urine_albumin: 'trace', notes: 'Continued twice-weekly home BP log; no visual or epigastric symptoms.' },
      { weeks: 37, bp: '138/88 mmHg', urine_albumin: '1+', notes: 'Planned inpatient observation at 38 weeks.' },
    ],
    interventionsRecorded: [
      'Twice-weekly home and clinic blood pressure monitoring',
      'Repeat spot urine protein-to-creatinine ratio and platelet/LFT panel',
      'Triage warning-sign counseling (visual changes, severe headache, epigastric pain)',
    ],
    deliveryOutcome: {
      deliveredAtWeeks: 38.4,
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Term gestation with monitored gestational blood pressure elevation',
      babyWeightKg: 2.95,
      apgar1Min: 8,
      apgar5Min: 9,
      postnatalCourse: 'Postpartum BP normalized within 72 hours; discharged on day 3.',
    },
  },
  {
    id: 'syn-ep-002',
    label: 'Case SYN-002 (28w, G1P0 — Borderline BP Rise + Trace Albumin + Pedal Edema)',
    archetype: 'elevated_bp_edema',
    gestationalWeeks: 28,
    age: 27,
    gravida: 1,
    para: 0,
    abortions: 0,
    bmi: 25.4,
    blood_group: 'B+',
    previous_cs: false,
    previous_preeclampsia: false,
    previous_gdm: false,
    vitals: {
      bp_systolic: 138,
      bp_diastolic: 88,
      weight_kg: 65.0,
      fundal_height_cm: 28,
      fetal_heart_rate_bpm: 148,
    },
    previousVitals: {
      bp_systolic: 122,
      bp_diastolic: 76,
    },
    labs: {
      hemoglobin: 10.8,
      platelets: 210,
      urine_albumin: 'trace',
      urine_sugar: 'nil',
      creatinine: 0.68,
      alt: 20,
      ast: 22,
      tsh: 1.9,
    },
    previousLabs: {
      hemoglobin: 11.1,
    },
    questionnaireResponses: [
      { question: 'Do you have headache or dizziness?', answer: true, detail: 'Moderate headache since yesterday' },
      { question: 'Have you noticed swelling in feet or ankles?', answer: true, detail: 'Mild pedal edema after standing' },
    ],
    transcriptSegments: [
      { segment_id: 'syn002_s1', speaker: 'patient', text: 'I started getting a moderate headache yesterday and mild ankle swelling in the evenings.' },
      { segment_id: 'syn002_s2', speaker: 'doctor', text: 'Any blurred vision or epigastric pain?' },
      { segment_id: 'syn002_s3', speaker: 'patient', text: 'No, my vision is completely fine and I have no epigastric pain or bleeding.' },
    ],
    progressionSummary:
      'Repeat BP check at 48 hours and weekly antenatal visits. Urine albumin cleared to nil at week 30; mild pedal edema managed conservatively with elevation and hydration.',
    subsequentVisits: [
      { weeks: 30, bp: '130/82 mmHg', urine_albumin: 'nil', notes: 'Headache subsided; laboratory panel unremarkable.' },
      { weeks: 35, bp: '132/84 mmHg', urine_albumin: 'trace', notes: 'Fetal biometry and amniotic fluid index normal.' },
    ],
    interventionsRecorded: [
      '48-hour repeat blood pressure and dipstick protein verification',
      'Baseline renal and hepatic function panel',
      'Daily fetal movement counting log',
    ],
    deliveryOutcome: {
      deliveredAtWeeks: 39.1,
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Spontaneous labor at term',
      babyWeightKg: 3.1,
      apgar1Min: 9,
      apgar5Min: 9,
      postnatalCourse: 'Uncomplicated postnatal recovery.',
    },
  },
  {
    id: 'syn-ep-003',
    label: 'Case SYN-003 (30w, G3P1 — Severe BP Elevation + Visual Disturbance + 2+ Albumin)',
    archetype: 'elevated_bp_edema',
    gestationalWeeks: 30,
    age: 33,
    gravida: 3,
    para: 1,
    abortions: 1,
    bmi: 29.2,
    blood_group: 'A+',
    previous_cs: true,
    previous_preeclampsia: true,
    previous_gdm: false,
    vitals: {
      bp_systolic: 156,
      bp_diastolic: 102,
      weight_kg: 76.0,
      fundal_height_cm: 29,
      fetal_heart_rate_bpm: 138,
    },
    previousVitals: {
      bp_systolic: 134,
      bp_diastolic: 86,
    },
    labs: {
      hemoglobin: 11.6,
      platelets: 135,
      urine_albumin: '2+',
      urine_sugar: 'nil',
      creatinine: 0.92,
      alt: 58,
      ast: 64,
      tsh: 2.4,
    },
    transcriptSegments: [
      { segment_id: 'syn003_s1', speaker: 'patient', text: 'I have a severe throbbing headache, swollen face and hands, and blurred vision since this morning.' },
      { segment_id: 'syn003_s2', speaker: 'patient', text: 'I also feel mild epigastric pain under my ribs.' },
    ],
    progressionSummary:
      'Admitted immediately for inpatient maternal-fetal stabilization, serial laboratory surveillance, and fetal Doppler monitoring.',
    subsequentVisits: [
      { weeks: 31, bp: '144/94 mmHg', urine_albumin: '2+', notes: 'Inpatient monitoring; corticosteroid course completed.' },
    ],
    interventionsRecorded: [
      'Immediate inpatient admission for maternal-fetal surveillance',
      'Serial platelet, creatinine, and transaminase monitoring every 12-24h',
      'Fetal growth and umbilical artery Doppler assessment',
    ],
    deliveryOutcome: {
      deliveredAtWeeks: 34.2,
      deliveryType: 'Repeat Cesarean section',
      indication: 'Worsening maternal laboratory trend and persistent severe blood pressure elevation',
      babyWeightKg: 2.15,
      apgar1Min: 7,
      apgar5Min: 8,
      postnatalCourse: 'Close postnatal blood pressure monitoring; discharged on day 6.',
    },
  },

  // =========================================================================
  // CLUSTER 2: Maternal Iron-Deficiency Anemia (Falling Hb + Fatigue / Dyspnea)
  // =========================================================================
  {
    id: 'syn-ep-004',
    label: 'Case SYN-004 (26w, G2P1 — Moderate Anemia Hb 8.8 + Fatigue & Breathlessness)',
    archetype: 'maternal_anemia',
    gestationalWeeks: 26,
    age: 25,
    gravida: 2,
    para: 1,
    abortions: 0,
    bmi: 21.3,
    blood_group: 'O+',
    previous_cs: false,
    previous_preeclampsia: false,
    vitals: {
      bp_systolic: 110,
      bp_diastolic: 70,
      weight_kg: 54.5,
      fundal_height_cm: 26,
      fetal_heart_rate_bpm: 146,
    },
    previousVitals: {
      bp_systolic: 112,
      bp_diastolic: 72,
    },
    labs: {
      hemoglobin: 8.8,
      platelets: 260,
      urine_albumin: 'nil',
      urine_sugar: 'nil',
      fasting_glucose: 82,
      tsh: 1.8,
    },
    previousLabs: {
      hemoglobin: 10.1,
    },
    questionnaireResponses: [
      { question: 'Have you experienced unusual tiredness or weakness?', answer: true, detail: 'Constant fatigue and dizziness when standing' },
    ],
    transcriptSegments: [
      { segment_id: 'syn004_s1', speaker: 'patient', text: 'I feel constant fatigue and shortness of breath when climbing even one flight of stairs, plus occasional dizziness.' },
      { segment_id: 'syn004_s2', speaker: 'doctor', text: 'Have you had any vaginal bleeding, headache, or swelling in your legs?' },
      { segment_id: 'syn004_s3', speaker: 'patient', text: 'No bleeding, no headache, and no ankle swelling.' },
    ],
    progressionSummary:
      'Evaluated for iron-deficiency indices and compliance barriers; adjusted iron regimen with vitamin C co-administration and dietary counseling. Hemoglobin rose to 10.6 g/dL by week 34.',
    subsequentVisits: [
      { weeks: 30, bp: '112/72 mmHg', hb: '9.8 g/dL', notes: 'Fatigue and breathlessness improving; tolerating adjusted iron schedule.' },
      { weeks: 34, bp: '114/74 mmHg', hb: '10.6 g/dL', notes: 'Energy levels restored; fetal growth on 50th percentile.' },
    ],
    interventionsRecorded: [
      'Peripheral smear and serum ferritin assessment',
      'Therapeutic iron supplementation adjustment with absorption guidance',
      'Repeat hemoglobin check at 4-week intervals',
    ],
    deliveryOutcome: {
      deliveredAtWeeks: 39.3,
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Term labor',
      babyWeightKg: 3.05,
      apgar1Min: 9,
      apgar5Min: 9,
      postnatalCourse: 'Pre-delivery Hb 10.9 g/dL; uncomplicated postpartum course.',
    },
  },
  {
    id: 'syn-ep-005',
    label: 'Case SYN-005 (27w, G3P2 — Anemia Hb 9.1 + Fatigue & Palpitations)',
    archetype: 'maternal_anemia',
    gestationalWeeks: 27,
    age: 28,
    gravida: 3,
    para: 2,
    abortions: 0,
    bmi: 22.0,
    blood_group: 'B+',
    previous_cs: false,
    vitals: {
      bp_systolic: 108,
      bp_diastolic: 68,
      weight_kg: 56.0,
      fundal_height_cm: 27,
      fetal_heart_rate_bpm: 150,
    },
    previousVitals: {
      bp_systolic: 110,
      bp_diastolic: 70,
    },
    labs: {
      hemoglobin: 9.1,
      platelets: 245,
      urine_albumin: 'nil',
      urine_sugar: 'nil',
      tsh: 2.0,
    },
    previousLabs: {
      hemoglobin: 10.3,
    },
    transcriptSegments: [
      { segment_id: 'syn005_s1', speaker: 'patient', text: 'I have been feeling very tired and weak lately, with breathlessness and occasional palpitations.' },
      { segment_id: 'syn005_s2', speaker: 'patient', text: 'I had mild nausea with the morning iron tablet so I missed several doses. No headache or bleeding.' },
    ],
    progressionSummary:
      'Switched iron formulation to evening dosing after meals; Hb improved from 9.1 to 10.7 g/dL over 6 weeks.',
    subsequentVisits: [
      { weeks: 31, bp: '112/70 mmHg', hb: '10.0 g/dL', notes: 'Palpitations resolved; good adherence to evening iron.' },
      { weeks: 36, bp: '116/74 mmHg', hb: '10.7 g/dL', notes: 'Asymptomatic.' },
    ],
    interventionsRecorded: [
      'Changed iron dosing schedule to reduce GI side effects',
      '4-week follow-up CBC',
    ],
    deliveryOutcome: {
      deliveredAtWeeks: 38.6,
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Term labor',
      babyWeightKg: 2.9,
      apgar1Min: 8,
      apgar5Min: 9,
      postnatalCourse: 'Continued postpartum iron for 3 months.',
    },
  },

  // =========================================================================
  // CLUSTER 3: Second/Third-Trimester Hyperglycemia / Elevated OGTT & HbA1c
  // =========================================================================
  {
    id: 'syn-ep-006',
    label: 'Case SYN-006 (26w, G2P1 — Elevated Fasting/Post-Meal Glucose + Urine Sugar 1+)',
    archetype: 'hyperglycemia_pattern',
    gestationalWeeks: 26,
    age: 31,
    gravida: 2,
    para: 1,
    abortions: 0,
    bmi: 28.4,
    blood_group: 'A+',
    previous_cs: false,
    previous_gdm: true,
    vitals: {
      bp_systolic: 122,
      bp_diastolic: 78,
      weight_kg: 72.0,
      fundal_height_cm: 27,
      fetal_heart_rate_bpm: 142,
    },
    labs: {
      hemoglobin: 11.8,
      fasting_glucose: 106,
      post_meal_glucose: 158,
      hba1c: 5.9,
      urine_albumin: 'nil',
      urine_sugar: '1+',
      tsh: 2.2,
    },
    transcriptSegments: [
      { segment_id: 'syn006_s1', speaker: 'patient', text: 'My sugar test came back higher than last time, and I have been feeling tired after meals with frequent urination.' },
      { segment_id: 'syn006_s2', speaker: 'patient', text: 'I do not have any burning urination, fever, or headache.' },
    ],
    progressionSummary:
      'Initiated structured medical nutrition therapy, post-meal walking protocol, and 4-point home capillary glucose log. Fasting values maintained <92 mg/dL and 2-hour post-meal <125 mg/dL.',
    subsequentVisits: [
      { weeks: 28, bp: '120/76 mmHg', fasting_glucose: '90 mg/dL', post_meal_glucose: '122 mg/dL', notes: 'Glycemic targets achieved with diet and activity.' },
      { weeks: 34, bp: '122/78 mmHg', fasting_glucose: '88 mg/dL', notes: 'Serial growth scan normal; no polyhydramnios or macrosomia.' },
    ],
    interventionsRecorded: [
      'Medical nutrition therapy and carbohydrate distribution plan',
      'Home fasting and 2-hour post-prandial capillary glucose monitoring',
      '32- and 36-week fetal growth and amniotic fluid ultrasound',
    ],
    deliveryOutcome: {
      deliveredAtWeeks: 39.0,
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Term gestation with well-controlled glycemic profile',
      babyWeightKg: 3.35,
      apgar1Min: 9,
      apgar5Min: 9,
      postnatalCourse: 'Neonatal blood glucose normal; maternal 6-week OGTT scheduled.',
    },
  },
  {
    id: 'syn-ep-007',
    label: 'Case SYN-007 (25w, G1P0 — Elevated Post-Meal Glucose 152 mg/dL)',
    archetype: 'hyperglycemia_pattern',
    gestationalWeeks: 25,
    age: 30,
    gravida: 1,
    para: 0,
    abortions: 0,
    bmi: 27.6,
    blood_group: 'O+',
    previous_cs: false,
    previous_gdm: false,
    vitals: {
      bp_systolic: 118,
      bp_diastolic: 76,
      weight_kg: 69.0,
      fundal_height_cm: 25,
      fetal_heart_rate_bpm: 145,
    },
    labs: {
      hemoglobin: 12.0,
      fasting_glucose: 101,
      post_meal_glucose: 152,
      hba1c: 5.7,
      urine_albumin: 'nil',
      urine_sugar: 'trace',
      tsh: 1.7,
    },
    transcriptSegments: [
      { segment_id: 'syn007_s1', speaker: 'patient', text: 'I noticed mild fatigue in the afternoons, and my lab report showed elevated fasting and post-meal glucose.' },
      { segment_id: 'syn007_s2', speaker: 'patient', text: 'No headache, no ankle swelling, and baby movements are active.' },
    ],
    progressionSummary:
      'Managed with dietary modification and biweekly fasting/post-meal glucose monitoring; values remained within target range through delivery.',
    subsequentVisits: [
      { weeks: 29, bp: '118/74 mmHg', fasting_glucose: '89 mg/dL', post_meal_glucose: '118 mg/dL', notes: 'Well controlled on nutritional plan.' },
    ],
    interventionsRecorded: [
      'Nutritional counseling and home glucometer log review every 2 weeks',
    ],
    deliveryOutcome: {
      deliveredAtWeeks: 39.4,
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Spontaneous term labor',
      babyWeightKg: 3.2,
      apgar1Min: 9,
      apgar5Min: 9,
      postnatalCourse: 'Normoglycemic postpartum.',
    },
  },

  // =========================================================================
  // CLUSTER 4: Maternal Hypothyroidism (Elevated TSH + Fatigue)
  // =========================================================================
  {
    id: 'syn-ep-008',
    label: 'Case SYN-008 (16w, G1P0 — Elevated TSH 5.8 mIU/L + Fatigue)',
    archetype: 'hypothyroid_pattern',
    gestationalWeeks: 16,
    age: 26,
    gravida: 1,
    para: 0,
    abortions: 0,
    bmi: 23.5,
    blood_group: 'AB+',
    known_thyroid_condition: true,
    vitals: {
      bp_systolic: 114,
      bp_diastolic: 72,
      weight_kg: 59.0,
      fetal_heart_rate_bpm: 152,
    },
    labs: {
      hemoglobin: 11.9,
      tsh: 5.8,
      fasting_glucose: 84,
      urine_albumin: 'nil',
      urine_sugar: 'nil',
    },
    transcriptSegments: [
      { segment_id: 'syn008_s1', speaker: 'patient', text: 'I have been feeling mild fatigue, and my latest thyroid TSH test came back elevated at 5.8.' },
      { segment_id: 'syn008_s2', speaker: 'patient', text: 'No nausea or vomiting now, and no bleeding or cramping.' },
    ],
    progressionSummary:
      'Thyroid supplementation dose titrated with 4-weekly TSH checks; TSH normalized to 1.8 mIU/L by week 22.',
    subsequentVisits: [
      { weeks: 20, bp: '114/72 mmHg', tsh: '2.3 mIU/L', notes: 'Anomaly scan normal; fatigue resolved.' },
      { weeks: 28, bp: '116/74 mmHg', tsh: '1.8 mIU/L', notes: 'Euthyroid on stable dose.' },
    ],
    interventionsRecorded: [
      'Levothyroxine dose titration and fasting administration counseling (separate from iron/calcium by 4 hours)',
      'Repeat TSH every 4 weeks until mid-gestation',
    ],
    deliveryOutcome: {
      deliveredAtWeeks: 39.6,
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Term labor',
      babyWeightKg: 3.15,
      apgar1Min: 9,
      apgar5Min: 9,
      postnatalCourse: 'Returned to pre-pregnancy thyroid dosing postpartum.',
    },
  },

  // =========================================================================
  // CLUSTER 5: Urinary Symptoms / Dysuria + Cramping
  // =========================================================================
  {
    id: 'syn-ep-009',
    label: 'Case SYN-009 (24w, G2P1 — Dysuria + Mild Lower Abdominal Cramping)',
    archetype: 'urinary_cramping_pattern',
    gestationalWeeks: 24,
    age: 27,
    gravida: 2,
    para: 1,
    abortions: 0,
    bmi: 23.0,
    blood_group: 'O+',
    vitals: {
      bp_systolic: 112,
      bp_diastolic: 70,
      weight_kg: 60.0,
      fundal_height_cm: 24,
      fetal_heart_rate_bpm: 148,
    },
    labs: {
      hemoglobin: 11.7,
      urine_albumin: 'trace',
      urine_sugar: 'nil',
      tsh: 1.6,
    },
    transcriptSegments: [
      { segment_id: 'syn009_s1', speaker: 'patient', text: 'For two days I have had burning on urination and mild pelvic cramping.' },
      { segment_id: 'syn009_s2', speaker: 'patient', text: 'I do not have fever or chills, and no vaginal bleeding or fluid leakage.' },
    ],
    progressionSummary:
      'Urine routine microscopy and culture sent; treated per sensitivity with oral hydration. Symptoms resolved in 72 hours and repeat culture negative.',
    subsequentVisits: [
      { weeks: 26, bp: '112/72 mmHg', urine_albumin: 'nil', notes: 'Test-of-cure urine culture negative; cramping resolved.' },
    ],
    interventionsRecorded: [
      'Midstream urine routine microscopy and culture/sensitivity',
      'Test-of-cure repeat urine culture after completion of therapy',
    ],
    deliveryOutcome: {
      deliveredAtWeeks: 39.2,
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Term labor',
      babyWeightKg: 3.25,
      apgar1Min: 9,
      apgar5Min: 9,
      postnatalCourse: 'Uncomplicated.',
    },
  },

  // =========================================================================
  // CLUSTER 6: Physiological Controls & Sparse-Record Edge Case
  // =========================================================================
  {
    id: 'syn-ep-010',
    label: 'Case SYN-010 (28w, G2P1 — Uncomplicated Physiological Antenatal Visit)',
    archetype: 'physiological_normal',
    gestationalWeeks: 28,
    age: 28,
    gravida: 2,
    para: 1,
    abortions: 0,
    bmi: 24.0,
    blood_group: 'O+',
    previous_cs: false,
    previous_preeclampsia: false,
    previous_gdm: false,
    vitals: {
      bp_systolic: 116,
      bp_diastolic: 74,
      weight_kg: 63.0,
      fundal_height_cm: 28,
      fetal_heart_rate_bpm: 144,
    },
    previousVitals: {
      bp_systolic: 114,
      bp_diastolic: 72,
    },
    labs: {
      hemoglobin: 12.2,
      platelets: 240,
      fasting_glucose: 84,
      post_meal_glucose: 114,
      urine_albumin: 'nil',
      urine_sugar: 'nil',
      tsh: 1.5,
      creatinine: 0.65,
    },
    previousLabs: {
      hemoglobin: 12.3,
    },
    transcriptSegments: [
      { segment_id: 'syn010_s1', speaker: 'patient', text: 'I feel great overall, baby is moving well, and I have no headache, no ankle swelling, and no blurred vision.' },
    ],
    progressionSummary: 'Routine 4-weekly and then biweekly antenatal visits with normal maternal and fetal parameters.',
    subsequentVisits: [
      { weeks: 32, bp: '118/76 mmHg', urine_albumin: 'nil', notes: 'Routine antenatal check normal.' },
      { weeks: 36, bp: '118/76 mmHg', urine_albumin: 'nil', notes: 'Cephalic presentation; normal growth.' },
    ],
    interventionsRecorded: ['Routine iron, calcium, and antenatal follow-up schedule'],
    deliveryOutcome: {
      deliveredAtWeeks: 39.5,
      deliveryType: 'Spontaneous vaginal delivery',
      indication: 'Spontaneous term labor',
      babyWeightKg: 3.28,
      apgar1Min: 9,
      apgar5Min: 9,
      postnatalCourse: 'Routine discharge.',
    },
  },
  {
    id: 'syn-ep-011',
    label: 'Case SYN-011 (28w, G2P1 — Sparse Record Control: Only Gestational Age & Blood Group Recorded)',
    archetype: 'sparse_incomplete_control',
    gestationalWeeks: 28,
    gravida: 2,
    para: 1,
    blood_group: 'O+',
    vitals: {},
    labs: {},
    transcriptSegments: [],
    progressionSummary:
      'Sparse historical record with minimal lab/symptom coverage (included to verify Bayesian shrinkage prevents sparse records from outranking rich clinical matches).',
    subsequentVisits: [],
    interventionsRecorded: [],
    deliveryOutcome: null,
  },
];

/**
 * Ready-to-use sample query scenarios for immediate API / demo testing.
 */
const SAMPLE_DEMO_QUERIES = {
  elevatedBpAndHeadacheScenario: {
    description:
      '28-week G2P1 patient with rising BP (140/90 from 124/78), frontal headache, mild ankle swelling, denied blurred vision, and missing urine_albumin/creatinine (demonstrates transcript extraction + unchecked factor discovery).',
    queryPatient: {
      gestationalWeeks: 28,
      age: 28,
      gravida: 2,
      para: 1,
      abortions: 0,
      bmi: 26.2,
      blood_group: 'O+',
      previous_cs: false,
      previous_preeclampsia: false,
      vitals: {
        bp_systolic: 140,
        bp_diastolic: 90,
        weight_kg: 67.0,
        fundal_height_cm: 28,
        fetal_heart_rate_bpm: 146,
      },
      previousVitals: {
        bp_systolic: 124,
        bp_diastolic: 78,
      },
      labs: {
        hemoglobin: 11.0,
        // Note: urine_albumin, platelets, creatinine, alt/ast intentionally left null ("no value")
        // so we can verify both missing-value weighting and `uncheckedFactorsInQuery`!
      },
      previousLabs: {
        hemoglobin: 11.3,
      },
      questionnaireResponses: [
        {
          question: 'Have you noticed any swelling in your ankles or feet?',
          answer: true,
          detail: 'Mild ankle swelling in the evening for the last 4 days',
        },
        {
          question: 'Have you had any vaginal bleeding?',
          answer: false,
        },
      ],
      transcriptSegments: [
        {
          segment_id: 'demo_seg_1',
          speaker: 'doctor',
          text: 'Good morning! I see from your check-in note that your ankles have been slightly swollen. How else have you been feeling this week?',
        },
        {
          segment_id: 'demo_seg_2',
          speaker: 'patient',
          text: 'Yes doctor, my ankles are mildly swollen by evening, and I have had a moderate headache across my forehead for the last two days.',
        },
        {
          segment_id: 'demo_seg_3',
          speaker: 'doctor',
          text: 'Have you noticed any blurred vision, seeing spots, or epigastric pain under your ribs?',
        },
        {
          segment_id: 'demo_seg_4',
          speaker: 'patient',
          text: 'No blurred vision at all, and I do not have any epigastric pain. The baby is moving well.',
        },
      ],
    },
  },

  anemiaAndFatigueScenario: {
    description:
      '26-week G2P1 patient with falling Hemoglobin (8.9 g/dL down from 10.2 g/dL), fatigue, breathlessness on stairs, and dizziness.',
    queryPatient: {
      gestationalWeeks: 26,
      age: 26,
      gravida: 2,
      para: 1,
      blood_group: 'O+',
      vitals: {
        bp_systolic: 110,
        bp_diastolic: 70,
        weight_kg: 55.0,
        fundal_height_cm: 26,
        fetal_heart_rate_bpm: 148,
      },
      previousVitals: {
        bp_systolic: 112,
        bp_diastolic: 70,
      },
      labs: {
        hemoglobin: 8.9,
        urine_albumin: 'nil',
        urine_sugar: 'nil',
      },
      previousLabs: {
        hemoglobin: 10.2,
      },
      transcriptSegments: [
        {
          segment_id: 'anemia_seg_1',
          speaker: 'patient',
          text: 'Doctor, I have been feeling severe fatigue and breathlessness whenever I walk up the stairs, and sometimes I feel dizzy.',
        },
        {
          segment_id: 'anemia_seg_2',
          speaker: 'doctor',
          text: 'Any vaginal bleeding, headache, or swelling in your feet?',
        },
        {
          segment_id: 'anemia_seg_3',
          speaker: 'patient',
          text: 'No bleeding, no headache, and no pedal edema.',
        },
      ],
    },
  },
};

module.exports = {
  SYNTHETIC_REFERENCE_COHORT,
  SAMPLE_DEMO_QUERIES,
};
