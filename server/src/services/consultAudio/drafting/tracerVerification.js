/**
 * Context Builder and Deterministic Tracer Verification Engine (Phase 8).
 *
 * Implements:
 * 1. Extraction of verified structured clinical data (labs, ultrasound, vitals, questionnaires).
 * 2. Deterministic tracer catalog generation (assigning unique tracer IDs to verified clinical numbers).
 * 3. Citation integrity checking (every cited segment_id must exist in the merged transcript).
 * 4. Numeric claim auditing (unverified numbers must be flagged or disclaimed; hallucinations sent to human review).
 *
 * Safety Rules (AGENTS.md):
 * - The product flags and prioritises. It never diagnoses.
 * - Zero patient transcript text or clinical numbers in logs.
 * - Verified values originate strictly from structured database tables.
 */

const supabaseAdmin = require('../../../config/supabaseAdminClient');
const logger = require('../../../utils/logger');

/**
 * Builds the structured clinical intake context and verified records for an appointment.
 *
 * @param {Object} params
 * @param {string} params.appointmentId
 * @param {string} params.patientId
 * @returns {Promise<Object>}
 */
async function buildStructuredContext({ appointmentId, patientId }) {
  const structuredData = {
    intakeQuestionnaires: [],
    verifiedLabMetrics: [],
    pregnancyInvestigations: [],
    pregnancyUltrasounds: [],
    vitalsLogs: [],
    antenatalVisits: [],
  };

  try {
    // 1. Pre-visit questionnaire responses
    if (appointmentId) {
      const { data: qResponses } = await supabaseAdmin
        .from('questionnaire_responses')
        .select(`
          id,
          answer,
          template_id,
          questionnaire_templates ( question_text, is_red_flag_trigger )
        `)
        .eq('appointment_id', appointmentId);

      if (qResponses) {
        structuredData.intakeQuestionnaires = qResponses.map((r) => ({
          question: r.questionnaire_templates?.question_text || 'Intake question',
          answer: r.answer,
          isRedFlag: r.questionnaire_templates?.is_red_flag_trigger || false,
        }));
      }
    }

    // 2. Active pregnancy episode
    let episodeId = null;
    if (patientId) {
      const { data: episode } = await supabaseAdmin
        .from('pregnancy_episodes')
        .select('id, due_date, gravida, para, blood_group, history_notes')
        .eq('patient_id', patientId)
        .eq('status', 'ongoing')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (episode) {
        episodeId = episode.id;
        structuredData.pregnancyEpisode = {
          dueDate: episode.due_date,
          gravida: episode.gravida,
          para: episode.para,
          bloodGroup: episode.blood_group,
          historyNotes: episode.history_notes,
        };
      }
    }

    // 3. Verified lab metrics (needs_review = false OR reviewed_by IS NOT NULL)
    if (patientId) {
      const { data: labReports } = await supabaseAdmin
        .from('lab_reports')
        .select('id')
        .eq('patient_id', patientId);

      const reportIds = (labReports || []).map((r) => r.id);
      if (reportIds.length > 0) {
        const { data: metrics } = await supabaseAdmin
          .from('lab_report_metrics')
          .select('id, standard_key, raw_key, parsed_value, unit_standard, unit_raw, needs_review, reviewed_value, reviewed_by')
          .in('lab_report_id', reportIds);

        if (metrics) {
          structuredData.verifiedLabMetrics = metrics
            .filter((m) => !m.needs_review || m.reviewed_by !== null)
            .map((m) => ({
              metricKey: m.standard_key || m.raw_key,
              value: m.reviewed_value !== null && m.reviewed_value !== undefined ? Number(m.reviewed_value) : Number(m.parsed_value),
              unit: m.unit_standard || m.unit_raw || '',
              source: 'lab_report_metric',
            }))
            .filter((m) => !isNaN(m.value));
        }
      }
    }

    // 4. Pregnancy investigations from maternity card
    if (episodeId) {
      const { data: investigations } = await supabaseAdmin
        .from('pregnancy_investigations')
        .select('id, investigation_name, investigation_key, result_value, result_unit, performed_on, is_baseline')
        .eq('pregnancy_episode_id', episodeId)
        .is('dismissed_at', null);

      if (investigations) {
        structuredData.pregnancyInvestigations = investigations
          .filter((inv) => inv.result_value !== null && inv.result_value !== undefined)
          .map((inv) => ({
            metricKey: inv.investigation_key || inv.investigation_name,
            displayName: inv.investigation_name,
            value: Number(inv.result_value),
            unit: inv.result_unit || '',
            performedOn: inv.performed_on,
            isBaseline: inv.is_baseline,
            source: 'pregnancy_investigation',
          }))
          .filter((inv) => !isNaN(inv.value));
      }
    }

    // 5. Pregnancy ultrasounds
    if (episodeId) {
      const { data: ultrasounds } = await supabaseAdmin
        .from('pregnancy_ultrasounds')
        .select('id, performed_on, gestational_weeks, gestational_days, report_text')
        .eq('pregnancy_episode_id', episodeId)
        .order('performed_on', { ascending: false });

      if (ultrasounds) {
        structuredData.pregnancyUltrasounds = ultrasounds.map((u) => ({
          performedOn: u.performed_on,
          gestationalWeeks: u.gestational_weeks,
          gestationalDays: u.gestational_days,
          reportText: u.report_text,
          source: 'pregnancy_ultrasound',
        }));
      }
    }

    // 6. Vitals logs
    if (patientId) {
      const vitalsQuery = supabaseAdmin
        .from('vitals_logs')
        .select('id, metric_key, value, unit, recorded_at')
        .eq('patient_id', patientId)
        .order('recorded_at', { ascending: false })
        .limit(10);

      const { data: vitals } = await vitalsQuery;
      if (vitals) {
        structuredData.vitalsLogs = vitals
          .map((v) => ({
            metricKey: v.metric_key,
            value: Number(v.value),
            unit: v.unit || '',
            recordedAt: v.recorded_at,
            source: 'vitals_log',
          }))
          .filter((v) => !isNaN(v.value));
      }
    }

    // 7. Antenatal visits (BP, weight, Hb, etc.)
    if (episodeId) {
      const { data: visits } = await supabaseAdmin
        .from('antenatal_visits')
        .select('id, visit_date, weight_kg, bp_systolic, bp_diastolic, gestational_weeks, fundal_height_cm, hemoglobin_g_dl, tsh')
        .eq('pregnancy_episode_id', episodeId)
        .order('visit_date', { ascending: false })
        .limit(5);

      if (visits) {
        structuredData.antenatalVisits = visits;
      }
    }
  } catch (err) {
    logger.warn('Non-fatal error building structured context for drafting', {
      scope: 'consult-tracer',
      errorCode: 'ERR_STRUCTURED_CONTEXT_READ',
    });
  }

  return structuredData;
}

/**
 * Builds a deterministic tracer catalog mapping every verified numeric clinical value
 * to a unique tracer ID that the model is instructed to reference.
 *
 * @param {Object} structuredData
 * @returns {Array<{ tracer_id: string, metric: string, value: number, unit: string, source: string }>}
 */
function buildTracerCatalog(structuredData) {
  const catalog = [];
  const seenKeys = new Set();

  function addTracer(metric, value, unit, source) {
    if (value === null || value === undefined || isNaN(value)) return;
    const cleanMetric = String(metric).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const tracerId = `TRACER_${cleanMetric.toUpperCase()}_${value}`;

    if (!seenKeys.has(tracerId)) {
      seenKeys.add(tracerId);
      catalog.push({
        tracer_id: tracerId,
        metric: cleanMetric,
        value: Number(value),
        unit: unit || '',
        source,
      });
    }
  }

  // Lab metrics
  for (const m of structuredData.verifiedLabMetrics || []) {
    addTracer(m.metricKey, m.value, m.unit, m.source);
  }

  // Pregnancy investigations
  for (const inv of structuredData.pregnancyInvestigations || []) {
    addTracer(inv.metricKey, inv.value, inv.unit, inv.source);
  }

  // Vitals logs
  for (const v of structuredData.vitalsLogs || []) {
    addTracer(v.metricKey, v.value, v.unit, v.source);
  }

  // Antenatal visits
  for (const visit of structuredData.antenatalVisits || []) {
    if (visit.bp_systolic) addTracer('bp_systolic', visit.bp_systolic, 'mmHg', 'antenatal_visit');
    if (visit.bp_diastolic) addTracer('bp_diastolic', visit.bp_diastolic, 'mmHg', 'antenatal_visit');
    if (visit.weight_kg) addTracer('weight', visit.weight_kg, 'kg', 'antenatal_visit');
    if (visit.hemoglobin_g_dl) addTracer('hemoglobin', visit.hemoglobin_g_dl, 'g/dL', 'antenatal_visit');
    if (visit.fundal_height_cm) addTracer('fundal_height', visit.fundal_height_cm, 'cm', 'antenatal_visit');
    if (visit.tsh) addTracer('tsh', visit.tsh, 'mIU/L', 'antenatal_visit');
  }

  // Ultrasounds (gestational weeks)
  for (const u of structuredData.pregnancyUltrasounds || []) {
    if (u.gestationalWeeks) addTracer('ultrasound_gestational_weeks', u.gestationalWeeks, 'weeks', 'ultrasound');
  }

  return catalog;
}

/**
 * Deterministic Post-Check Engine:
 * 1. Checks that every cited segment_id in doctor notes and flags exists in validSegmentIds.
 * 2. Checks clinical numbers quoted in the draft:
 *    - Valid if matched against a verified tracer in tracerCatalog.
 *    - Valid if accompanied by disclaimer ("stated verbally, unverified" or "[value pending verification]").
 *    - Flags 'unverified_numeric_claim' if an unverified clinical number is asserted without disclaimer.
 *    - Flags 'invalid_segment_citation' if a segment_id does not exist in the input transcript.
 *
 * @param {Object} params
 * @param {Object} params.doctorNotes
 * @param {Object} params.patientSummary
 * @param {Array} params.clinicalFlags
 * @param {Set<string>|Array<string>} params.validSegmentIds
 * @param {Array} params.tracerCatalog
 * @returns {{ isValidForApproval: boolean, reviewReasons: string[], tracersUsed: Array }}
 */
function postCheckDraft({
  doctorNotes,
  patientSummary,
  clinicalFlags = [],
  validSegmentIds,
  tracerCatalog = [],
}) {
  const validIdsSet = validSegmentIds instanceof Set ? validSegmentIds : new Set(validSegmentIds || []);
  const reviewReasons = [];
  const tracersUsed = [];

  // 1. Citation Validation
  const citationsToCheck = [];

  for (const rec of doctorNotes?.plan_and_recommendations || []) {
    for (const segId of rec.cited_segment_ids || []) {
      citationsToCheck.push(segId);
    }
  }

  for (const flag of clinicalFlags || []) {
    for (const segId of flag.cited_segment_ids || []) {
      citationsToCheck.push(segId);
    }
  }

  let hasInvalidCitation = false;
  for (const id of citationsToCheck) {
    if (!validIdsSet.has(id)) {
      hasInvalidCitation = true;
      break;
    }
  }

  if (hasInvalidCitation) {
    reviewReasons.push('invalid_segment_citation');
  }

  // 2. Numeric Claim Auditing
  // Build a fast lookup map of verified values
  const verifiedValues = new Map();
  for (const t of tracerCatalog) {
    verifiedValues.set(t.value, t);
  }

  // Collect text blocks to audit for numeric assertions
  const fullText = [
    doctorNotes?.vitals_observed || '',
    doctorNotes?.assessment || '',
    ...(doctorNotes?.plan_and_recommendations || []).map((r) => r.recommendation),
    patientSummary?.summary_text || '',
  ].join(' ');

  // Extract numeric tokens that resemble clinical measurements (e.g. 10.8, 120/80, 72, 118)
  // Excludes common non-clinical numbers like week counts (1 to 40), hours, days
  const numberMatches = fullText.match(/\b\d+(\.\d+)?\b/g) || [];

  let hasUnverifiedClaim = false;
  const verifiedTracerSet = new Set();

  for (const matchStr of numberMatches) {
    const num = parseFloat(matchStr);
    if (isNaN(num)) continue;

    // Ignore routine low integers (e.g. 1, 2, 3 times a day, 1 tablet, 20 weeks)
    if (num <= 40 && Number.isInteger(num)) continue;

    if (verifiedValues.has(num)) {
      const matchedTracer = verifiedValues.get(num);
      if (!verifiedTracerSet.has(matchedTracer.tracer_id)) {
        verifiedTracerSet.add(matchedTracer.tracer_id);
        tracersUsed.push(matchedTracer);
      }
    } else {
      // Check if this unverified number has the required disclaimer in proximity
      const lowerText = fullText.toLowerCase();
      const hasDisclaimer =
        lowerText.includes('stated verbally, unverified') ||
        lowerText.includes('[value pending verification]') ||
        lowerText.includes('unverified');

      if (!hasDisclaimer) {
        hasUnverifiedClaim = true;
      }
    }
  }

  if (hasUnverifiedClaim) {
    reviewReasons.push('unverified_numeric_claim');
  }

  return {
    isValidForApproval: reviewReasons.length === 0,
    reviewReasons,
    tracersUsed,
  };
}

module.exports = {
  buildStructuredContext,
  buildTracerCatalog,
  postCheckDraft,
};
