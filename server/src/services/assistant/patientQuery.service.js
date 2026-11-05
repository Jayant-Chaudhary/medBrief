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
const assistantConfig = require('../../config/assistant.config');
const { safeTimeZone } = require('./resolvers/datetime');

// Phrases that ask for medical opinion, diagnosis, or normality interpretation
// "Does she have a report uploaded?" asks about the app's records, not about a condition.
const DIAGNOSTIC_PATTERN = /\b(?:is\s+.*?\b(?:normal|abnormal|high|low|safe|dangerous|concerning|okay)\b|diagnos\w*|does\s+(?:she|he)\s+have(?!\s+(?:an?\s+|any\s+|another\s+|the\s+)?(?:lab\s+)?(?:reports?|appointments?|visits?|follow[\s-]?ups?|uploads?|files?|records?)\b)|what\s+should\s+i\s+(?:prescribe|give)|treatment\s+for|medicine\s+for|cure)\b/i;

// Action commands (opening, filling, adding, booking, searching) are never Q&A requests.
// "Blood type" and "Rh type" name a result, not the "type into a field" command.
const ACTION_COMMANDS = /\b(?:add|save|open|book|prepare|schedule|append|replace|set|change|update|(?<!\b(?:blood|rh)\s+)type|click|fill|write|create|new\s+(?:visit|appointment)|go\s+to|press|enter|submit|tick|untick|finish|mark|find|search)\b/i;

// Phrased as a question rather than an instruction.
const ASKS_A_QUESTION = /\?\s*$|^\s*(?:is|are|was|were|does|do|did|should|shall|can|could|would|will|what|why|how)\b/i;

// Regex patterns to identify question phrases
const QUESTION_INDICATOR = /\b(?:what(?:'?s|\s+is|\s+was)?|how\s+much\s+is|show\s+me|tell\s+me|give\s+me)\b|^(?:check|get)\b/i;

// Common standardized alias normalization & typos
const ALIASES = {
  'hb': 'haemoglobin',
  'hgb': 'haemoglobin',
  'hemoglobin': 'haemoglobin',
  'hameoglobin': 'haemoglobin',
  'heamoglobin': 'haemoglobin',
  'hemaglobin': 'haemoglobin',
  'bp': 'blood pressure',
  'systolic': 'blood pressure systolic',
  'diastolic': 'blood pressure diastolic',
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
  'rh type': 'blood group',
  'edd': 'due date',
  'expected date': 'due date',
  'gestation': 'gestational age',
  'weeks': 'gestational age',
  'vit d': 'vitamin d',
  'vit b12': 'vitamin b12',
  'b12': 'vitamin b12',
  'sgpt': 'alt',
  'sgot': 'ast',
};

const MATCH_ALIASES = {
  ...ALIASES,
  // Whole-label equivalents used by the existing metric dictionary/schema.
  'platelet count': 'platelets',
  'plt': 'platelets',
  'serum ferritin': 'ferritin',
  'ferritin serum': 'ferritin',
  'serum iron': 'iron',
  'total calcium': 'calcium',
  'calcium total': 'calcium',
  'calcium, total': 'calcium',
  'serum calcium': 'calcium',
  'blood glucose fasting': 'fasting blood glucose',
  'blood glucose random': 'random blood glucose',
  'blood glucose pp': 'postprandial blood glucose',
};

// Set of recognized clinical nutrients and metrics
const KNOWN_METRIC_KEYWORDS = new Set([
  'hemoglobin', 'haemoglobin', 'hb', 'hgb', 'bp', 'blood pressure', 'systolic', 'diastolic',
  'fhr', 'fetal heart', 'fetal heart rate', 'weight', 'wt', 'sugar', 'blood sugar',
  'glucose', 'blood glucose', 'fbs', 'rbs', 'blood group', 'blood type', 'rh', 'edd',
  'due date', 'expected date', 'gestation', 'weeks', 'lmp', 'last menstrual', 'creatinine',
  'urea', 'uric acid', 'ast', 'alt', 'sgot', 'sgpt', 'alp', 'bilirubin', 'calcium',
  'vitamin d', 'vitamin b12', 'tsh', 'albumin', 'globulin', 'total protein', 'platelets',
  'wbc', 'rbc', 'hematocrit', 'mcv', 'mch', 'mchc', 'ferritin', 'iron', 'esr', 'crp',
  'sodium', 'potassium', 'chloride', 'cholesterol', 'triglycerides', 'urine albumin', 'proteinuria'
]);

/**
 * Checks whether a candidate metric name/key matches the target search term.
 * Normalizes British/American spellings (e.g. haemoglobin vs hemoglobin) and guards against empty strings.
 */
function matchesMetricName(candidateKey, candidateName, targetTerm) {
  const identity = value => {
    const label = String(value || '').normalize('NFKC').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return (MATCH_ALIASES[label] || label).replace(/haem/g, 'hem').replace(/[^a-z0-9]/g, '');
  };
  const term = identity(targetTerm);
  if (!term || term.length < 2) return false;
  // A recorded standard key takes precedence over its display label. Never
  // conflate two tests because one name contains part of another name.
  return identity(candidateKey || candidateName) === term;
}

/**
 * Differentiates the patient name from the nutrient / analyte term in a query.
 * @param {string} message
 * @param {Array} patients
 */
function extractPatientAndMetric(message, patients = []) {
  let text = String(message || '').trim();
  if (!text) return { candidateName: null, matchedPatients: [], metricTerm: '' };

  let matchedPatients = [];
  let candidateName = null;

  // 1. Check among known clinic patients (longer names first)
  const sortedPatients = [...(patients || [])].sort((a, b) => (b.fullName || '').length - (a.fullName || '').length);

  for (const p of sortedPatients) {
    if (!p.fullName) continue;
    const fullName = p.fullName.trim();
    const firstName = fullName.split(/\s+/)[0];

    const escFull = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escFirst = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const fullRegex = new RegExp(`\\b${escFull}\\b(?:['’]s\\b)?`, 'i');
    const firstRegex = firstName.length >= 3 ? new RegExp(`\\b${escFirst}\\b(?:['’]s\\b)?`, 'i') : null;

    if (fullRegex.test(text)) {
      matchedPatients.push(p);
      if (!candidateName) {
        candidateName = fullName;
        text = text.replace(fullRegex, ' ');
      }
    } else if (firstRegex && firstRegex.test(text)) {
      matchedPatients.push(p);
      if (!candidateName) {
        candidateName = firstName;
        text = text.replace(firstRegex, ' ');
      }
    }
  }

  // 2. Also check standard linguistic patterns like "of <Name>" or "<Name>'s" if no directory patient matched
  if (!candidateName) {
    const ofMatch = text.match(/(?:of|for)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)(?:\s|$|[?!.])/i);
    const aposMatch = text.match(/(?:^|\b(?:is|was|me))\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)'s\b/i) || text.match(/^([a-zA-Z]+(?:\s+[a-zA-Z]+)?)'s\b/i);
    const hindiMatch = text.match(/\b([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(?:ka|ki|ke)\b/i);
    if (ofMatch && !/^(?:this|her|him|the|patient|my|this\s+patient|the\s+patient|her\s+patient)$/i.test(ofMatch[1].trim())) {
      candidateName = ofMatch[1].trim();
      text = text.replace(ofMatch[0], ' ');
    } else if (aposMatch && !/^(?:what|her|his|this|patient|this\s+patient)$/i.test(aposMatch[1].trim())) {
      candidateName = aposMatch[1].trim();
      text = text.replace(aposMatch[0], ' ');
    } else if (hindiMatch && !/^(?:what|her|his|this|patient|this\s+patient)$/i.test(hindiMatch[1].trim())) {
      candidateName = hindiMatch[1].trim();
      text = text.replace(hindiMatch[0], ' ');
    }
  }

  // 3. Clean text to leave the nutrient / analyte / metric term
  let cleaned = text
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\b(?:for|of|in|about)\s+(?:this\s+patient|the\s+patient|her|him|patient)\b/gi, ' ')
    .replace(/\b(?:what(?:'?s|\s+is|\s+was)?|tell\s+me|show\s+me|check|get|how\s+much\s+is|give\s+me)\b/gi, ' ')
    .replace(/\b(?:of|for|in|from|ka|ki|ke|hai|kya|batao|dikhao|level|status|value|reading|test|report|score|number)\b/gi, ' ')
    .replace(/\b(?:the|her|his|this|patient|latest|recent|last|recorded|current)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    candidateName,
    matchedPatients,
    metricTerm: cleaned.toLowerCase(),
  };
}

/**
 * Checks if a typed message is asking for a patient metric or test value.
 * @param {string} message
 * @param {Array} patients
 * @returns {{ isQuery: boolean, isDiagnostic?: boolean, metricTerm?: string, rawTerm?: string, candidateName?: string, matchedPatients?: Array }}
 */
function detectClinicalQuery(message, patients = []) {
  const text = String(message || '').trim();
  if (!text) return { isQuery: false };

  // An instruction ("Add to notes: BP is normal") carries the clinician's own
  // words for a form; it asks the assistant for no opinion. Questions still
  // reach the diagnostic refusal below, even when they mention an action.
  const isInstruction = ACTION_COMMANDS.test(text) && !ASKS_A_QUESTION.test(text);
  if (isInstruction) {
    return { isQuery: false };
  }

  // Diagnostic requests must be flagged and safely refused
  if (DIAGNOSTIC_PATTERN.test(text)) {
    return { isQuery: true, isDiagnostic: true };
  }

  // Action commands must never be intercepted as questions
  if (ACTION_COMMANDS.test(text)) {
    return { isQuery: false };
  }

  // Differentiate Name and Nutrient/Metric
  const parsed = extractPatientAndMetric(text, patients);
  const rawTerm = parsed.metricTerm;
  const canonicalTerm = ALIASES[rawTerm] || rawTerm;

  const hasQuestion = QUESTION_INDICATOR.test(text) || text.endsWith('?');
  const isKnownMetric = KNOWN_METRIC_KEYWORDS.has(rawTerm) || KNOWN_METRIC_KEYWORDS.has(canonicalTerm) || Object.hasOwn(MATCH_ALIASES, rawTerm);

  // Before loading the directory, recognize shorthand ending in a known
  // metric. An arbitrary patient name plus arbitrary leftover words is not
  // evidence of a clinical question (e.g. "Asha's card" or "next visit Asha").
  const knownSuffix = !patients?.length && [...KNOWN_METRIC_KEYWORDS, ...Object.keys(MATCH_ALIASES)].some(metric => {
    const escaped = metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\s)${escaped}$`, 'i').test(rawTerm);
  });
  // A question mark alone does not make app help a clinical question. Unknown
  // analytes remain supported when the question names/refers to a patient or
  // explicitly asks about clinical results; ordinary UI help stays with the
  // existing planner.
  const patientReference = Boolean(parsed.candidateName) || /\b(?:her|his|their|this\s+patient|the\s+patient)\b/i.test(text);
  const clinicalContext = /\b(?:lab(?:oratory)?|analyte|vitals?|test\s+results?|blood\s+results?|measurements?)\b/i.test(text);
  const isClinicalQuery = isKnownMetric || knownSuffix || (hasQuestion && (patientReference || clinicalContext));

  if (!isClinicalQuery || !rawTerm || rawTerm.length < 2) {
    return { isQuery: false };
  }

  return {
    isQuery: true,
    isDiagnostic: false,
    metricTerm: canonicalTerm,
    rawTerm,
    candidateName: parsed.candidateName,
    matchedPatients: parsed.matchedPatients,
  };
}

/**
 * The newest home blood pressure as one "systolic/diastolic" reading. The
 * patient apps save each side as its own vitals row, a moment apart; a side
 * with no partner within the window is shown with a dash for the other.
 */
function latestHomeBloodPressure(vitals, pairWindowMs) {
  const time = (row) => Date.parse(row.recorded_at);
  const sideOf = (row) => (matchesMetricName(row.metric_key, row.metric_key, 'blood pressure systolic') ? 'systolic'
    : matchesMetricName(row.metric_key, row.metric_key, 'blood pressure diastolic') ? 'diastolic' : null);
  const sides = vitals.filter((row) => sideOf(row) && Number.isFinite(time(row)) && row.value != null);
  if (!sides.length) return null;

  const newest = sides.reduce((a, b) => (time(b) > time(a) ? b : a));
  const otherSide = sideOf(newest) === 'systolic' ? 'diastolic' : 'systolic';
  const partner = sides
    .filter((row) => sideOf(row) === otherSide && Math.abs(time(row) - time(newest)) <= pairWindowMs)
    .sort((a, b) => Math.abs(time(a) - time(newest)) - Math.abs(time(b) - time(newest)))[0];
  const systolic = sideOf(newest) === 'systolic' ? newest : partner;
  const diastolic = sideOf(newest) === 'diastolic' ? newest : partner;

  return {
    name: 'Blood Pressure',
    value: `${systolic?.value ?? '—'}/${diastolic?.value ?? '—'}`,
    unit: 'mmHg',
    date: newest.recorded_at,
    source: 'Vitals Log',
    sourceType: 'vitals',
  };
}

/**
 * Searches all available patient records (visits, investigations, uploaded lab reports, vitals)
 * for the most recent reading matching the metric term.
 */
async function queryPatientMetric(clinicianId, patientId, targetTerm, options = {}) {
  const supabase = options.supabaseClient || defaultSupabase;
  const getSharedReports = options.reportIdsFn || reportIdsSharedWithClinician;

  const term = String(targetTerm || '').toLowerCase().trim();
  const canonical = ALIASES[term] || term;
  const candidates = [];
  const lookupFailure = () => Object.assign(new Error('Patient record lookup failed'), { code: 'PATIENT_METRIC_LOOKUP_FAILED' });

  // 1. Check Pregnancy Episode (Blood Group, Due Date, Gestation, History)
  try {
    const { data: episode, error: episodeError } = await supabase
      .from('pregnancy_episodes')
      .select('id, blood_group, due_date, last_menstrual_period, created_at')
      .eq('patient_id', patientId)
      .eq('clinician_id', clinicianId)
      .eq('status', 'ongoing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (episodeError) throw lookupFailure();

    if (episode) {
      if (canonical === 'blood group' && episode.blood_group) {
        candidates.push({
          name: 'Blood Group',
          value: episode.blood_group,
          unit: '',
          date: episode.created_at ? episode.created_at.split('T')[0] : null,
          source: 'Maternity Record',
          sourceType: 'maternity',
        });
      }
      if (canonical === 'due date' && episode.due_date) {
        candidates.push({
          name: 'Expected Delivery Date',
          value: episode.due_date,
          unit: '',
          date: episode.due_date,
          source: 'Maternity Record',
          sourceType: 'maternity',
        });
      }
      if ((canonical === 'gestational age' || canonical === 'lmp') && episode.last_menstrual_period) {
        candidates.push({
          name: 'Last Menstrual Period (LMP)',
          value: episode.last_menstrual_period,
          unit: '',
          date: episode.last_menstrual_period,
          source: 'Maternity Record',
          sourceType: 'maternity',
        });
      }

      // Check Antenatal Visits for this episode
      const { data: visits, error: visitsError } = await supabase
        .from('antenatal_visits')
        .select('*')
        .eq('pregnancy_episode_id', episode.id)
        .order('visit_date', { ascending: false });
      if (visitsError) throw lookupFailure();

      if (visits?.length) {
        for (const v of visits) {
          if ((canonical === 'haemoglobin' || canonical === 'hemoglobin') && v.hemoglobin_g_dl != null) {
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
          if (canonical === 'blood pressure' && (v.bp_systolic != null || v.bp_diastolic != null)) {
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
          if (['blood pressure systolic', 'blood pressure diastolic'].includes(canonical)) {
            const value = canonical === 'blood pressure systolic' ? v.bp_systolic : v.bp_diastolic;
            if (value != null) {
              candidates.push({ name: canonical === 'blood pressure systolic' ? 'Systolic blood pressure' : 'Diastolic blood pressure',
                value, unit: 'mmHg', date: v.visit_date, source: 'Antenatal Visit', sourceType: 'maternity' });
              break;
            }
          }
          if (canonical === 'weight' && v.weight_kg != null) {
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
          if (canonical === 'tsh' && v.tsh != null) {
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
          if (canonical === 'fetal heart rate' && v.fetal_heart_rate) {
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
          if (canonical === 'fundal height' && v.fundal_height_cm != null) {
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
          if (canonical === 'urine albumin' && v.urine_albumin) {
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
          if (canonical === 'blood glucose' && v.blood_glucose_mg_dl != null) {
            candidates.push({
              name: 'Blood Glucose',
              value: v.blood_glucose_mg_dl,
              unit: 'mg/dL',
              date: v.visit_date,
              source: 'Antenatal Visit',
              sourceType: 'maternity',
            });
            break;
          }
          if (canonical === 'gestational age' && v.gestational_weeks != null) {
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

      // Check Pregnancy Investigations for this episode
      const { data: investigations, error: investigationsError } = await supabase
        .from('pregnancy_investigations')
        .select('investigation_name, investigation_key, result_value, result_text, result_unit, performed_on')
        .eq('pregnancy_episode_id', episode.id)
        .order('performed_on', { ascending: false, nullsFirst: false });
      if (investigationsError) throw lookupFailure();

      if (investigations?.length) {
        for (const inv of investigations) {
          if (matchesMetricName(inv.investigation_key, inv.investigation_name, canonical)) {
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
            }
          }
        }
      }
    }
  } catch (_) {
    throw lookupFailure();
  }

  // 2. Check Uploaded Lab Reports (lab_report_metrics)
  try {
    const sharedIds = await getSharedReports(clinicianId, patientId);
    if (sharedIds?.length) {
      const { data: metrics, error: metricsError } = await supabase
        .from('lab_report_metrics')
        .select('raw_key, standard_key, parsed_value, raw_value, reviewed_value, unit_standard, unit_raw, created_at, lab_reports ( id, report_date, uploaded_at )')
        .in('lab_report_id', sharedIds)
        .order('created_at', { ascending: false });
      if (metricsError) throw lookupFailure();

      if (metrics?.length) {
        for (const m of metrics) {
          if (matchesMetricName(m.standard_key, m.raw_key, canonical)) {
            const val = m.reviewed_value ?? m.parsed_value ?? m.raw_value;
            const unit = m.unit_standard || m.unit_raw || '';
            const reportDate = m.lab_reports?.report_date || null;
            if (val != null && val !== '') {
              candidates.push({
                name: m.standard_key || m.raw_key,
                value: val,
                unit,
                date: reportDate,
                source: 'Lab Report',
                sourceType: 'lab_report',
                reportId: m.lab_reports?.id,
                uploadedAt: m.lab_reports?.uploaded_at || null,
              });
            }
          }
        }
      }
    }
  } catch (_) {
    throw lookupFailure();
  }

  // 3. Check Vitals Logs
  try {
    const { data: vitals, error: vitalsError } = await supabase
      .from('vitals_logs')
      .select('metric_key, value, unit, recorded_at')
      .eq('patient_id', patientId)
      .order('recorded_at', { ascending: false });
    if (vitalsError) throw lookupFailure();

    if (vitals?.length) {
      if (canonical === 'blood pressure') {
        const homeBp = latestHomeBloodPressure(vitals, options.homeBpPairWindowMs || assistantConfig.homeBpPairWindowMs);
        if (homeBp) candidates.push(homeBp);
      }
      for (const v of vitals) {
        if (matchesMetricName(v.metric_key, v.metric_key, canonical)) {
          candidates.push({
            name: v.metric_key,
            value: v.value,
            unit: v.unit || '',
            date: v.recorded_at || null,
            source: 'Vitals Log',
            sourceType: 'vitals',
          });
        }
      }
    }
  } catch (_) {
    throw lookupFailure();
  }

  if (!candidates.length) return null;

  // Compare measurement dates across ALL matching reports. Upload order cannot
  // identify the latest reading, and an undated report must not displace a
  // dated measurement just because it was uploaded recently.
  const timeOf = date => date && Number.isFinite(Date.parse(date)) ? Date.parse(date) : null;
  candidates.sort((a, b) => {
    const timeA = timeOf(a.date);
    const timeB = timeOf(b.date);
    if (timeA == null) return timeB == null ? (timeOf(b.uploadedAt) || 0) - (timeOf(a.uploadedAt) || 0) : 1;
    if (timeB == null) return -1;
    return timeB - timeA;
  });
  if (candidates.some(candidate => timeOf(candidate.date) == null)) candidates[0].hasUndatedResults = true;
  return candidates[0];
}

/**
 * Formats a factual, grounded response for the doctor.
 */
function formatMetricAnswer(patientName, metricTerm, record, patientId, options = {}) {
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
  const validDate = record.date && Number.isFinite(Date.parse(record.date));
  const dateStr = validDate ? ` on ${new Date(record.date).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(record.date) ? 'UTC' : safeTimeZone(options.timeZone, assistantConfig.defaultTimeZone),
  })}` : '';
  const sourceStr = record.source ? ` from ${record.source}` : '';

  const recency = validDate ? (record.hasUndatedResults ? 'latest dated' : 'latest recorded') : 'recorded';
  const dateNote = !validDate ? ' Measurement date unavailable.' : record.hasUndatedResults ? ' Other matching results have no measurement date.' : '';
  const text = `${name}'s ${recency} ${testName} is ${record.value}${unitStr}${dateStr}${sourceStr}.${dateNote}`;

  let recordPath = null;
  let recordLabel = 'View Record';

  if (record.sourceType === 'maternity' && patientId) {
    recordPath = `/clinician/maternity?patientId=${encodeURIComponent(patientId)}`;
    recordLabel = 'Open Maternity Card';
  } else if (record.sourceType === 'lab_report') {
    // Reports live in the owned appointment's history tab; there is no
    // clinician/reports route. Without a verified visit, omit the link.
    recordPath = options.appointmentId ? `/clinician?appointment=${encodeURIComponent(options.appointmentId)}&tab=flowsheet` : null;
    recordLabel = 'Open Report History';
  } else if (patientId) {
    recordPath = `/clinician/maternity?patientId=${encodeURIComponent(patientId)}`;
    recordLabel = 'View Patient Record';
  }

  return { text, recordPath, recordLabel };
}

module.exports = {
  detectClinicalQuery,
  extractPatientAndMetric,
  matchesMetricName,
  queryPatientMetric,
  formatMetricAnswer,
  ALIASES,
};
