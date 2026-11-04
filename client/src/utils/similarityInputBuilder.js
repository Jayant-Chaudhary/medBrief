/**
 * Clinical Similarity Input Builder.
 *
 * Implements a strict clinical contract for extracting patient features
 * without fabricating measurements (no hardcoded defaults like age 26, gestation 28,
 * gravida 1, BMI 24, BP 120/80, HR 78).
 *
 * Safety & Precision:
 * 1. Missing clinical observations remain undefined/null.
 * 2. Legitimate zero values (e.g. para: 0, abortions: 0) are strictly preserved.
 * 3. Reads OCR lab metrics from parsed_value (with reviewed_value precedence) and excludes unreviewed items.
 * 4. Selects newest lab reading by date/timestamp.
 * 5. Preserves boolean false in questionnaire answers and retains detail/answer_text.
 * 6. Returns insufficientData: true when essential comparison anchors are absent.
 */

function toFiniteNumber(val) {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

export function buildSimilarityQueryPatient(data) {
  if (!data?.patient) return null;
  const patient = data.patient;
  const appointment = data.appointment;
  const vitals = appointment?.vitals || data.vitals || {};
  const maternity = data.maternityCard || data.maternity || {};

  // Extract recorded obstetric baseline without default fabrication
  const age = toFiniteNumber(patient.age ?? maternity.age ?? data.age);
  const gestationalWeeks = toFiniteNumber(
    appointment?.gestationalAgeWeeks ??
    patient.gestationalWeeks ??
    patient.gestational_weeks ??
    maternity.gestational_weeks ??
    vitals.gestational_weeks
  );
  const gravida = toFiniteNumber(patient.gravida ?? maternity.gravida);
  const para = toFiniteNumber(patient.para ?? patient.parity ?? maternity.para ?? maternity.parity);
  const bmi = toFiniteNumber(patient.bmi ?? maternity.bmi ?? vitals.bmi);

  // Vitals without fabricated 120/80 or 78 bpm defaults
  const bp_systolic = toFiniteNumber(vitals.systolic ?? vitals.bp_systolic);
  const bp_diastolic = toFiniteNumber(vitals.diastolic ?? vitals.bp_diastolic);
  const heart_rate = toFiniteNumber(vitals.heartRate ?? vitals.heart_rate);

  // Process lab reports: sort newest first by report_date or uploaded_at
  const labs = {};
  const historyReports = Array.isArray(data.historyReports) ? [...data.historyReports] : [];
  historyReports.sort((a, b) => {
    const dateA = new Date(a.report_date || a.uploaded_at || 0).getTime();
    const dateB = new Date(b.report_date || b.uploaded_at || 0).getTime();
    return dateB - dateA;
  });

  for (const report of historyReports) {
    for (const m of report.lab_report_metrics || []) {
      // Exclude metrics requiring review that have not been signed off by a clinician
      if (m.needs_review && (m.reviewed_by === null || m.reviewed_by === undefined)) {
        continue;
      }

      const key = String(m.standard_key || m.standardKey || m.metric_key || m.name || '').toLowerCase();
      // Read reviewed_value first, fallback to parsed_value (database column), then value
      const rawNum = m.reviewed_value !== null && m.reviewed_value !== undefined
        ? m.reviewed_value
        : (m.parsed_value !== null && m.parsed_value !== undefined ? m.parsed_value : m.value);
      const val = toFiniteNumber(rawNum);

      if (val !== undefined) {
        if ((key.includes('hemoglobin') || key === 'hb') && labs.hemoglobin === undefined) labs.hemoglobin = val;
        if (key.includes('platelet') && labs.platelets === undefined) labs.platelets = val;
        if ((key.includes('fasting') || key.includes('fbs')) && labs.fasting_glucose === undefined) labs.fasting_glucose = val;
        if ((key.includes('post_meal') || key.includes('ppbs') || key.includes('post_prandial')) && labs.post_meal_glucose === undefined) labs.post_meal_glucose = val;
        if (key.includes('tsh') && labs.tsh === undefined) labs.tsh = val;
        if (key.includes('creatinine') && labs.creatinine === undefined) labs.creatinine = val;
      }

      if ((key.includes('urine_albumin') || key.includes('urine_protein')) && labs.urine_albumin === undefined) {
        labs.urine_albumin = m.reviewed_value ?? m.parsed_value ?? m.value;
      }
    }
  }

  // Pre-visit questionnaire responses with boolean & detail preservation
  const rawAnswers = data.questionnaire?.answers || [];
  const questionnaireResponses = rawAnswers.map((ans) => {
    let resolvedAnswer = null;
    if (typeof ans.answer === 'boolean') {
      resolvedAnswer = ans.answer;
    } else if (ans.value === 'yes' || ans.answer === 'yes' || ans.answerText?.toLowerCase() === 'yes') {
      resolvedAnswer = true;
    } else if (ans.value === 'no' || ans.answer === 'no' || ans.answerText?.toLowerCase() === 'no') {
      resolvedAnswer = false;
    } else if (ans.answer !== undefined && ans.answer !== null && ans.answer !== '') {
      resolvedAnswer = ans.answer;
    } else if (ans.answerText) {
      resolvedAnswer = ans.answerText;
    }

    return {
      question: ans.questionText || ans.question || '',
      answer: resolvedAnswer,
      detail: ans.detail || ans.notes || '',
      answer_text: ans.answer_text || ans.answerText || (typeof resolvedAnswer === 'string' ? resolvedAnswer : ''),
    };
  });

  // Track available vs missing factors
  const availableFactors = [];
  const missingFactors = [];

  if (age !== undefined) availableFactors.push('age'); else missingFactors.push('age');
  if (gestationalWeeks !== undefined) availableFactors.push('gestational_age'); else missingFactors.push('gestational_age');
  if (bp_systolic !== undefined && bp_diastolic !== undefined) availableFactors.push('blood_pressure'); else missingFactors.push('blood_pressure');
  if (gravida !== undefined) availableFactors.push('gravida'); else missingFactors.push('gravida');
  if (para !== undefined) availableFactors.push('parity'); else missingFactors.push('parity');
  if (bmi !== undefined) availableFactors.push('bmi'); else missingFactors.push('bmi');
  if (Object.keys(labs).length > 0) availableFactors.push('lab_metrics'); else missingFactors.push('lab_metrics');
  if (questionnaireResponses.length > 0) availableFactors.push('symptoms_questionnaire'); else missingFactors.push('symptoms_questionnaire');

  // Insufficient data is flagged when neither gestational age nor vitals are present
  const insufficientData = gestationalWeeks === undefined && bp_systolic === undefined && Object.keys(labs).length === 0;

  return {
    patientId: patient.id,
    age,
    gestationalWeeks,
    gestational_weeks: gestationalWeeks,
    gravida,
    para,
    parity: para,
    bmi,
    vitals: {
      bp_systolic,
      bp_diastolic,
      heart_rate,
    },
    labs,
    questionnaireResponses,
    preVisitNotes: [data.aiSummary?.summary, data.notes?.text].filter(Boolean).join('\n'),
    availableFactors,
    missingFactors,
    insufficientData,
  };
}
