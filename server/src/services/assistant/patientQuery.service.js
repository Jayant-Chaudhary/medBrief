/**
 * Service to answer clinician questions about any patient's recorded lab results,
 * routine visit vitals, and maternity investigations (e.g. Haemoglobin, Ferritin,
 * Blood Pressure, Platelets, TSH, Blood Group, Weight, Rubella, etc.).
 *
 * Safety & Privacy (AGENTS.md):
 * - Factual retrieval only: value/text, unit, date, and source record.
 * - Never diagnoses, interprets normality, or prescribes.
 * - Zero health values or patient names in server logs.
 */

const defaultSupabase = require('../../config/supabaseAdminClient');
const { reportIdsSharedWithClinician } = require('../reportSharing.service');

// Phrases that ask for medical opinion, diagnosis, or normality interpretation
const DIAGNOSTIC_PATTERN = /\b(?:is\s+.*?\b(?:normal|abnormal|high|low|safe|dangerous|concerning|okay)\b|diagnos\w*|does\s+(?:she|he)\s+have|what\s+should\s+i\s+(?:prescribe|give)|treatment\s+for|medicine\s+for|cure)\b/i;

// Action commands (opening, filling, adding, booking, searching) are never Q&A requests
const ACTION_COMMANDS = /\b(?:add|save|open|book|type|click|fill|write|create|go\s+to|press|enter|submit|tick|untick|finish|mark|find|search)\b/i;

// Regex patterns to identify a clinical metric question and extract the test/vital name
const QUESTION_INDICATOR = /\b(?:what(?:'?s|\s+is|\s+was)?|how\s+much\s+is|show\s+me|tell\s+me)\b|^(?:check|get)\b/i;

// Words to strip when extracting the analyte / test name
const FILLER_WORDS = /^(?:the|her|his|patient(?:'?s)?|latest|recent|last|recorded|current|value\s+of|level\s+of|result\s+of|reading\s+of|status\s+of)\s+/i;
const TRAILING_WORDS = /\s+(?:of|for|in|from)\s+(?:this\s+patient|her|him|the\s+patient|patient)\??$/i;

// Common standardized alias normalization & typos
const ALIASES = {
  'hb': 'haemoglobin',
  'hgb': 'haemoglobin',
  'hemoglobin': 'haemoglobin',
  'hameoglobin': 'haemoglobin',
  'heamoglobin': 'haemoglobin',
  'hemaglobin': 'haemoglobin',
  'bp': 'blood pressure',
  'systolic': 'blood pressure',
  'diastolic': 'blood pressure',
  'fhr': 'fetal heart rate',
  'fetal heart': 'fetal heart rate',
  'wt': 'weight',
  'wight': 'weight',
  'sugar': 'blood glucose',
  'blood sugar': 'blood glucose',
  'fasting sugar': 'fasting blood glucose',
  'fasting blood sugar': 'fasting blood glucose',
  'fbs': 'fasting blood glucose',
  'rbs': 'random blood glucose',
  'blood group': 'blood group',
  'blood type': 'blood group',
  'bloog group': 'blood group',
  'rh': 'blood group',
  'edd': 'due date',
  'expected date': 'due date',
  'gestation': 'gestational age',
  'weeks': 'gestational age',
};

/**
 * Checks if a typed message is asking for a patient metric or test value.
 * @param {string} message
 * @returns {{ isQuery: boolean, isDiagnostic?: boolean, metricTerm?: string, rawTerm?: string, candidateName?: string }}
 */
function detectClinicalQuery(message) {
  const text = String(message || '').trim();
  if (!text) return { isQuery: false };

  // Diagnostic requests must be flagged and safely refused
  if (DIAGNOSTIC_PATTERN.test(text)) {
    return { isQuery: true, isDiagnostic: true };
  }

  // Action commands must never be intercepted as questions
  if (ACTION_COMMANDS.test(text)) {
    return { isQuery: false };
  }

  // Must have a question indicator or end with '?'
  const hasQuestion = QUESTION_INDICATOR.test(text) || text.endsWith('?');
  if (!hasQuestion) {
    return { isQuery: false };
  }

  // Clean the prompt to extract the analyte / test term
  let cleaned = text
    .replace(/[?!.]+$/g, '')
    .replace(QUESTION_INDICATOR, '')
    .trim();

  // Extract candidate patient name if present
  let candidateName = null;
  const nameOfMatch = cleaned.match(/(?:of|for)\s+([a-zA-Z\s]+)$/i);
  if (nameOfMatch && !/^(?:this\s+patient|her|him|the\s+patient|patient)$/i.test(nameOfMatch[1].trim())) {
    candidateName = nameOfMatch[1].trim();
    cleaned = cleaned.replace(nameOfMatch[0], '').trim();
  } else {
    const posApos = cleaned.match(/^([a-zA-Z\s]+?)'s\s+/i);
    const posHindi = cleaned.match(/^([a-zA-Z\s]+?)\s+(?:ke|ki|ka)\s+/i);
    const posSingle = cleaned.match(/^([A-Z][a-z]{2,})s\s+/);
    if (posApos) {
      if (!/^(?:what|how|patient|her|his|this)$/i.test(posApos[1].trim())) {
        candidateName = posApos[1].trim();
        cleaned = cleaned.replace(posApos[0], '').trim();
      }
    } else if (posHindi) {
      candidateName = posHindi[1].trim();
      cleaned = cleaned.replace(posHindi[0], '').trim();
    } else if (posSingle && !/^(?:this|what|his)$/i.test(posSingle[1].toLowerCase())) {
      candidateName = posSingle[1];
      cleaned = cleaned.replace(posSingle[0], '').trim();
    }
  }

  cleaned = cleaned.replace(TRAILING_WORDS, '').trim();

  // Strip multiple filler words iteratively (e.g. "her last bp" -> "last bp" -> "bp")
  while (FILLER_WORDS.test(cleaned)) {
    cleaned = cleaned.replace(FILLER_WORDS, '').trim();
  }
  cleaned = cleaned.replace(/^(?:the|her|his)\s+/i, '').trim();
  cleaned = cleaned.replace(/\s+(?:status|value|level|result|reading)$/i, '').trim();

  if (!cleaned || cleaned.length < 2) {
    return { isQuery: false };
  }

  const rawTerm = cleaned.toLowerCase();
  const metricTerm = ALIASES[rawTerm] || rawTerm;

  return {
    isQuery: true,
    isDiagnostic: false,
    metricTerm,
    rawTerm,
    candidateName,
  };
}

/**
 * Searches all available patient records (visits, investigations, uploaded lab reports, vitals)
 * for the most recent reading matching the metric term.
 */
async function queryPatientMetric(clinicianId, patientId, metricTerm, options = {}) {
  const supabase = options.supabaseClient || defaultSupabase;
  const getSharedReports = options.reportIdsFn || reportIdsSharedWithClinician;
  const term = String(metricTerm || '').toLowerCase().trim();

  const candidates = [];

  // 1. Check Pregnancy Episode (Blood Group, Due Date, Gestation, History)
  try {
    const { data: episode } = await supabase
      .from('pregnancy_episodes')
      .select('id, blood_group, due_date, last_menstrual_period, created_at')
      .eq('patient_id', patientId)
      .eq('clinician_id', clinicianId)
      .eq('status', 'ongoing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (episode) {
      if (term.includes('blood group') || term.includes('blood type') || term === 'rh' || term === 'abo') {
        if (episode.blood_group) {
          candidates.push({
            name: 'Blood Group',
            value: episode.blood_group,
            unit: '',
            date: episode.created_at ? episode.created_at.split('T')[0] : null,
            source: 'Maternity Record',
            sourceType: 'maternity',
          });
        }
      }
      if (term.includes('due date') || term.includes('edd')) {
        if (episode.due_date) {
          candidates.push({
            name: 'Expected Delivery Date',
            value: episode.due_date,
            unit: '',
            date: episode.due_date,
            source: 'Maternity Record',
            sourceType: 'maternity',
          });
        }
      }
      if (term.includes('lmp') || term.includes('last menstrual')) {
        if (episode.last_menstrual_period) {
          candidates.push({
            name: 'Last Menstrual Period (LMP)',
            value: episode.last_menstrual_period,
            unit: '',
            date: episode.last_menstrual_period,
            source: 'Maternity Record',
            sourceType: 'maternity',
          });
        }
      }

      // Check Antenatal Visits for this episode
      const { data: visits } = await supabase
        .from('antenatal_visits')
        .select('*')
        .eq('pregnancy_episode_id', episode.id)
        .order('visit_date', { ascending: false });

      if (visits?.length) {
        for (const v of visits) {
          if ((term.includes('haemoglobin') || term.includes('hemoglobin') || term === 'hb') && v.hemoglobin_g_dl != null) {
            candidates.push({
              name: 'Haemoglobin',
              value: v.hemoglobin_g_dl,
              unit: 'g/dL',
              date: v.visit_date,
              source: 'Antenatal Visit',
              sourceType: 'maternity',
            });
            break;
          }
          if ((term.includes('blood pressure') || term === 'bp' || term === 'systolic' || term === 'diastolic') && (v.bp_systolic != null || v.bp_diastolic != null)) {
            candidates.push({
              name: 'Blood Pressure',
              value: `${v.bp_systolic || '—'}/${v.bp_diastolic || '—'}`,
              unit: 'mmHg',
              date: v.visit_date,
              source: 'Antenatal Visit',
              sourceType: 'maternity',
            });
            break;
          }
          if (term.includes('weight') && v.weight_kg != null) {
            candidates.push({
              name: 'Weight',
              value: v.weight_kg,
              unit: 'kg',
              date: v.visit_date,
              source: 'Antenatal Visit',
              sourceType: 'maternity',
            });
            break;
          }
          if (term.includes('tsh') && v.tsh != null) {
            candidates.push({
              name: 'TSH',
              value: v.tsh,
              unit: 'mIU/L',
              date: v.visit_date,
              source: 'Antenatal Visit',
              sourceType: 'maternity',
            });
            break;
          }
          if ((term.includes('fetal heart') || term === 'fhr') && v.fetal_heart_rate) {
            candidates.push({
              name: 'Fetal Heart Rate',
              value: v.fetal_heart_rate,
              unit: 'bpm',
              date: v.visit_date,
              source: 'Antenatal Visit',
              sourceType: 'maternity',
            });
            break;
          }
          if (term.includes('fundal') && v.fundal_height_cm != null) {
            candidates.push({
              name: 'Fundal Height',
              value: v.fundal_height_cm,
              unit: 'cm',
              date: v.visit_date,
              source: 'Antenatal Visit',
              sourceType: 'maternity',
            });
            break;
          }
          if (term.includes('albumin') && v.urine_albumin) {
            candidates.push({
              name: 'Urine Albumin',
              value: v.urine_albumin,
              unit: '',
              date: v.visit_date,
              source: 'Antenatal Visit',
              sourceType: 'maternity',
            });
            break;
          }
          if (term.includes('gestation') || term.includes('week')) {
            if (v.gestational_weeks != null) {
              const days = v.gestational_days ? ` +${v.gestational_days}d` : '';
              candidates.push({
                name: 'Gestational Age',
                value: `${v.gestational_weeks}w${days}`,
                unit: '',
                date: v.visit_date,
                source: 'Antenatal Visit',
                sourceType: 'maternity',
              });
              break;
            }
          }
        }
      }

      // Check Pregnancy Investigations for this episode
      const { data: investigations } = await supabase
        .from('pregnancy_investigations')
        .select('investigation_name, investigation_key, result_value, result_text, result_unit, performed_on')
        .eq('pregnancy_episode_id', episode.id)
        .order('performed_on', { ascending: false });

      if (investigations?.length) {
        for (const inv of investigations) {
          const invName = String(inv.investigation_name || '').toLowerCase();
          const invKey = String(inv.investigation_key || '').toLowerCase();
          if (invName.includes(term) || invKey.includes(term) || term.includes(invName) || term.includes(invKey)) {
            const val = inv.result_value ?? inv.result_text;
            if (val != null && val !== '') {
              candidates.push({
                name: inv.investigation_name,
                value: val,
                unit: inv.result_unit || '',
                date: inv.performed_on,
                source: 'Maternity Investigations',
                sourceType: 'maternity',
              });
              break;
            }
          }
        }
      }
    }
  } catch (_) {
    // Non-fatal if maternity lookup encounters missing fields
  }

  // 2. Check Uploaded Lab Reports (lab_report_metrics)
  try {
    const sharedIds = await getSharedReports(clinicianId, patientId);
    if (sharedIds?.length) {
      const { data: metrics } = await supabase
        .from('lab_report_metrics')
        .select('raw_key, standard_key, parsed_value, raw_value, reviewed_value, unit_standard, unit_raw, created_at, lab_reports ( id, report_date, uploaded_at )')
        .in('lab_report_id', sharedIds)
        .order('created_at', { ascending: false });

      if (metrics?.length) {
        for (const m of metrics) {
          const rawKey = String(m.raw_key || '').toLowerCase();
          const stdKey = String(m.standard_key || '').toLowerCase();
          if (rawKey.includes(term) || stdKey.includes(term) || term.includes(rawKey) || (stdKey && term.includes(stdKey))) {
            const val = m.reviewed_value ?? m.parsed_value ?? m.raw_value;
            const unit = m.unit_standard || m.unit_raw || '';
            const reportDate = m.lab_reports?.report_date || (m.lab_reports?.uploaded_at ? m.lab_reports.uploaded_at.split('T')[0] : null);
            if (val != null && val !== '') {
              candidates.push({
                name: m.standard_key || m.raw_key,
                value: val,
                unit,
                date: reportDate,
                source: 'Lab Report',
                sourceType: 'lab_report',
                reportId: m.lab_reports?.id,
              });
              break;
            }
          }
        }
      }
    }
  } catch (_) {
    // Non-fatal if lab report sharing query fails
  }

  // 3. Check Vitals Logs
  try {
    const { data: vitals } = await supabase
      .from('vitals_logs')
      .select('metric_key, value, unit, recorded_at')
      .eq('patient_id', patientId)
      .order('recorded_at', { ascending: false });

    if (vitals?.length) {
      for (const v of vitals) {
        const vKey = String(v.metric_key || '').toLowerCase();
        if (vKey.includes(term) || term.includes(vKey)) {
          candidates.push({
            name: v.metric_key,
            value: v.value,
            unit: v.unit || '',
            date: v.recorded_at ? v.recorded_at.split('T')[0] : null,
            source: 'Vitals Log',
            sourceType: 'vitals',
          });
          break;
        }
      }
    }
  } catch (_) {
    // Non-fatal
  }

  if (!candidates.length) return null;

  // Pick the most recent record (date descending)
  candidates.sort((a, b) => {
    const timeA = a.date ? new Date(a.date).getTime() : 0;
    const timeB = b.date ? new Date(b.date).getTime() : 0;
    return timeB - timeA;
  });

  return candidates[0];
}

/**
 * Formats a factual, grounded response for the doctor.
 */
function formatMetricAnswer(patientName, metricTerm, record, patientId) {
  const name = patientName || 'The patient';
  if (!record) {
    const displayTerm = metricTerm ? metricTerm.charAt(0).toUpperCase() + metricTerm.slice(1) : 'value';
    return {
      text: `No recorded ${displayTerm} found in ${name}'s uploaded reports or visits.`,
      recordPath: patientId ? `/clinician/maternity?patientId=${encodeURIComponent(patientId)}` : null,
      recordLabel: 'Open Maternity Card',
    };
  }

  const testName = record.name ? record.name.charAt(0).toUpperCase() + record.name.slice(1) : metricTerm;
  const unitStr = record.unit ? ` ${record.unit}` : '';
  const dateStr = record.date ? ` on ${new Date(record.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
  const sourceStr = record.source ? ` from ${record.source}` : '';

  const text = `${name}'s latest recorded ${testName} is ${record.value}${unitStr}${dateStr}${sourceStr}.`;

  let recordPath = null;
  let recordLabel = 'View Record';

  if (record.sourceType === 'maternity' && patientId) {
    recordPath = `/clinician/maternity?patientId=${encodeURIComponent(patientId)}`;
    recordLabel = 'Open Maternity Card';
  } else if (record.sourceType === 'lab_report') {
    recordPath = '/clinician/reports';
    recordLabel = 'Open Lab Reports';
  } else if (patientId) {
    recordPath = `/clinician/maternity?patientId=${encodeURIComponent(patientId)}`;
    recordLabel = 'View Patient Record';
  }

  return { text, recordPath, recordLabel };
}

module.exports = {
  detectClinicalQuery,
  queryPatientMetric,
  formatMetricAnswer,
  ALIASES,
};
