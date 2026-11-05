/**
 * Clinical Feature & Symptom Extractor for Patient Similarity Model.
 *
 * Extracts structured clinical features, symptom polarity (present / absent),
 * cited transcript segment IDs, de-identified clinical narrative, and semantic
 * embeddings from:
 * 1. Pre-visit questionnaire responses & free-text notes
 * 2. Laboratory metrics & maternity card baseline
 * 3. Longitudinal vitals & antenatal visit records (calculating deltas)
 * 4. Consultation transcripts (doctor + patient segments)
 *
 * Supports production providers:
 * - 'gemini': Google Gemini API (schema-enforced JSON + text-embedding-004)
 * - 'local': Local Ollama / Qwen JSON API
 * - 'fake': Deterministic clinical NLP & negation-aware extractor (zero network I/O)
 *
 * Safety & Privacy (AGENTS.md):
 * - Flags and prioritises; NEVER states a diagnosis.
 * - Zero transcript text, names, or clinical numbers in logs.
 * - Every transcript-derived symptom must cite valid segment_ids; uncited items are dropped.
 */

const { z } = require('zod');
const config = require('../../config/patientSimilarity.config');
const logger = require('../../utils/logger');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const embeddingCache = new Map();

const ExtractedSymptomItemSchema = z.object({
  symptom_key: z.string().min(1),
  status: z.enum(['present', 'absent']),
  severity: z.enum(['mild', 'moderate', 'severe', 'unspecified']).default('unspecified'),
  source: z.enum(['transcript', 'pre_visit', 'history']).default('transcript'),
  cited_segment_ids: z.array(z.string()).default([]),
});

const ExtractionResultSchema = z.object({
  extracted_symptoms: z.array(ExtractedSymptomItemSchema).default([]),
  standardized_narrative: z.string().default(''),
});

const GEMINI_EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    extracted_symptoms: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          symptom_key: {
            type: 'STRING',
            enum: config.canonicalSymptomKeys,
          },
          status: {
            type: 'STRING',
            enum: ['present', 'absent'],
          },
          severity: {
            type: 'STRING',
            enum: ['mild', 'moderate', 'severe', 'unspecified'],
          },
          source: {
            type: 'STRING',
            enum: ['transcript', 'pre_visit', 'history'],
          },
          cited_segment_ids: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['symptom_key', 'status', 'severity', 'source', 'cited_segment_ids'],
      },
    },
    standardized_narrative: { type: 'STRING' },
  },
  required: ['extracted_symptoms', 'standardized_narrative'],
};

/**
 * Normalizes dipstick / ordinal strings such as "Nil", "Negative", "Trace", "+1", "1+".
 */
function normalizeOrdinalDipstick(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'not tested') return null;
  if (['nil', 'negative', 'neg', 'none', '0', 'normal', 'absent'].includes(s)) return 'nil';
  if (s.includes('trace') || s === 'tr' || s === '+/-') return 'trace';
  if (s === '1+' || s === '+1' || s === '+') return '1+';
  if (s === '2+' || s === '+2' || s === '++') return '2+';
  if (s === '3+' || s === '+3' || s === '+++') return '3+';
  if (s === '4+' || s === '+4' || s === '++++') return '4+';
  return null;
}

function normalizeBooleanCategory(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'boolean') return val ? 'yes' : 'no';
  const s = String(val).trim().toLowerCase();
  if (['yes', 'true', 'present', '1', 'positive', 'confirmed'].includes(s)) return 'yes';
  if (['no', 'false', 'absent', '0', 'negative', 'none'].includes(s)) return 'no';
  return null;
}

function toFiniteNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizes raw structured patient inputs (labs, vitals, previousVitals, baseline)
 * into the canonical structured feature map + longitudinal deltas.
 */
function normalizeStructuredFeatures(rawPatient = {}) {
  const structured = {};
  const vitals = rawPatient.vitals || {};
  const prevVitals = rawPatient.previousVitals || {};
  const labs = rawPatient.labs || {};
  const prevLabs = rawPatient.previousLabs || {};
  const baseline = rawPatient.baseline || rawPatient.maternityCard || {};

  const setNum = (key, candidateVal) => {
    const n = toFiniteNumber(candidateVal);
    if (n !== null) structured[key] = n;
  };

  // Gestational & Obstetric Baseline
  setNum('gestational_weeks', rawPatient.gestationalWeeks ?? rawPatient.gestational_weeks ?? baseline.gestationalWeeks ?? baseline.gestational_weeks ?? vitals.gestational_weeks);
  setNum('age_years', rawPatient.age ?? rawPatient.age_years ?? baseline.age ?? baseline.age_years);
  setNum('gravida', rawPatient.gravida ?? baseline.gravida);
  setNum('para', rawPatient.para ?? rawPatient.parity ?? baseline.para ?? baseline.parity);
  setNum('abortions', rawPatient.abortions ?? baseline.abortions);
  setNum('bmi', rawPatient.bmi ?? baseline.bmi ?? vitals.bmi);

  // Vitals
  setNum('bp_systolic', vitals.bp_systolic ?? vitals.systolic ?? rawPatient.bp_systolic);
  setNum('bp_diastolic', vitals.bp_diastolic ?? vitals.diastolic ?? rawPatient.bp_diastolic);
  setNum('weight_kg', vitals.weight_kg ?? vitals.weight ?? rawPatient.weight_kg);
  setNum('fundal_height_cm', vitals.fundal_height_cm ?? vitals.fundal ?? rawPatient.fundal_height_cm);
  setNum('fetal_heart_rate_bpm', vitals.fetal_heart_rate_bpm ?? vitals.fhr ?? rawPatient.fetal_heart_rate_bpm);

  // Longitudinal Vital Deltas (Current - Previous)
  const prevSys = toFiniteNumber(prevVitals.bp_systolic ?? prevVitals.systolic);
  if (structured.bp_systolic !== undefined && prevSys !== null) {
    structured.bp_systolic_delta = Math.round((structured.bp_systolic - prevSys) * 10) / 10;
  } else {
    setNum('bp_systolic_delta', vitals.bp_systolic_delta ?? rawPatient.bp_systolic_delta);
  }

  const prevDia = toFiniteNumber(prevVitals.bp_diastolic ?? prevVitals.diastolic);
  if (structured.bp_diastolic !== undefined && prevDia !== null) {
    structured.bp_diastolic_delta = Math.round((structured.bp_diastolic - prevDia) * 10) / 10;
  } else {
    setNum('bp_diastolic_delta', vitals.bp_diastolic_delta ?? rawPatient.bp_diastolic_delta);
  }

  // Labs
  setNum('hemoglobin', labs.hemoglobin ?? labs.hb ?? vitals.hemoglobin_g_dl ?? rawPatient.hemoglobin);
  const prevHb = toFiniteNumber(prevLabs.hemoglobin ?? prevLabs.hb);
  if (structured.hemoglobin !== undefined && prevHb !== null) {
    structured.hemoglobin_delta = Math.round((structured.hemoglobin - prevHb) * 100) / 100;
  } else {
    setNum('hemoglobin_delta', labs.hemoglobin_delta ?? rawPatient.hemoglobin_delta);
  }

  setNum('platelets', labs.platelets ?? rawPatient.platelets);
  setNum('fasting_glucose', labs.fasting_glucose ?? labs.blood_glucose_fasting ?? rawPatient.fasting_glucose);
  setNum('post_meal_glucose', labs.post_meal_glucose ?? labs.blood_glucose_pp ?? rawPatient.post_meal_glucose);
  setNum('hba1c', labs.hba1c ?? rawPatient.hba1c);
  setNum('tsh', labs.tsh ?? vitals.tsh ?? rawPatient.tsh);
  setNum('creatinine', labs.creatinine ?? rawPatient.creatinine);
  setNum('alt', labs.alt ?? rawPatient.alt);
  setNum('ast', labs.ast ?? rawPatient.ast);

  // Ordinal & Categorical Factors
  const uAlbumin = normalizeOrdinalDipstick(
    labs.urine_albumin ?? labs.urine_protein ?? vitals.urine_albumin ?? rawPatient.urine_albumin
  );
  if (uAlbumin) structured.urine_albumin = uAlbumin;

  const uSugar = normalizeOrdinalDipstick(
    labs.urine_sugar ?? vitals.urine_sugar ?? rawPatient.urine_sugar
  );
  if (uSugar) structured.urine_sugar = uSugar;

  const bloodGroup = rawPatient.blood_group ?? baseline.blood_group ?? baseline.bloodGroup;
  if (bloodGroup && typeof bloodGroup === 'string' && bloodGroup.trim()) {
    structured.blood_group = bloodGroup.trim().toUpperCase();
  }

  const prevCs = normalizeBooleanCategory(baseline.previous_cs ?? rawPatient.previous_cs);
  if (prevCs) structured.previous_cs = prevCs;

  const prevPreEc = normalizeBooleanCategory(baseline.previous_preeclampsia ?? rawPatient.previous_preeclampsia);
  if (prevPreEc) structured.previous_preeclampsia = prevPreEc;

  const prevGdm = normalizeBooleanCategory(baseline.previous_gdm ?? rawPatient.previous_gdm);
  if (prevGdm) structured.previous_gdm = prevGdm;

  const knownThyroid = normalizeBooleanCategory(baseline.known_thyroid_condition ?? rawPatient.known_thyroid_condition);
  if (knownThyroid) structured.known_thyroid_condition = knownThyroid;

  return structured;
}

/**
 * Deterministic Symptom & Negation Rules for Fake / Fallback Provider
 * and Pre-Visit Questionnaire mapping.
 */
const SYMPTOM_PATTERNS = [
  {
    key: 'headache',
    patterns: [/\bheadache(?:s)?\b/i, /\bhead\s+pain\b/i, /\bfrontal\s+ache\b/i, /\bmigraine\b/i],
  },
  {
    key: 'visual_disturbance',
    patterns: [
      /\bblur(?:red|ry)?\s+vision\b/i,
      /\bvisual\s+(?:disturbance|change|changes|spots)\b/i,
      /\bflashing\s+lights\b/i,
      /\bseeing\s+spots\b/i,
      /\bvision\s+problem(?:s)?\b/i,
    ],
  },
  {
    key: 'pedal_edema',
    patterns: [
      /\bpedal\s+(?:edema|oedema)\b/i,
      /\b(?:ankle|foot|feet|leg|lower\s+limb)\s+swelling\b/i,
      /\bswollen\s+(?:ankles|feet|legs)\b/i,
    ],
  },
  {
    key: 'facial_or_hand_swelling',
    patterns: [
      /\b(?:face|facial|hand|hands|finger|fingers|periorbital)\s+swelling\b/i,
      /\bswollen\s+(?:face|hands|fingers)\b/i,
      /\bpuffiness\s+in\s+face\b/i,
    ],
  },
  {
    key: 'epigastric_pain',
    patterns: [
      /\bepigastric\s+pain\b/i,
      /\bupper\s+abdominal\s+pain\b/i,
      /\bright\s+upper\s+quadrant\s+pain\b/i,
      /\bruq\s+pain\b/i,
      /\bpain\s+under\s+(?:the\s+)?ribs\b/i,
    ],
  },
  {
    key: 'nausea_vomiting',
    patterns: [/\bnausea\b/i, /\bvomit(?:ing)?\b/i, /\bmorning\s+sickness\b/i, /\bthrowing\s+up\b/i],
  },
  {
    key: 'reduced_fetal_movement',
    patterns: [
      /\breduced\s+fetal\s+movement(?:s)?\b/i,
      /\bdecreased\s+(?:fetal|baby)\s+movement(?:s)?\b/i,
      /\bbaby\s+moving\s+less\b/i,
      /\bless\s+kicks\b/i,
      /\bfetal\s+movement(?:s)?\b/i,
    ],
  },
  {
    key: 'vaginal_bleeding',
    patterns: [/\bvaginal\s+bleeding\b/i, /\bspotting\b/i, /\bbleeding\b/i],
  },
  {
    key: 'fluid_leakage',
    patterns: [/\bfluid\s+leak(?:age|ing)?\b/i, /\bleaking\s+fluid\b/i, /\bwater\s+broke\b/i, /\bvaginal\s+discharge\b/i],
  },
  {
    key: 'contractions_cramping',
    patterns: [/\bcontraction(?:s)?\b/i, /\babdominal\s+cramp(?:s|ing)?\b/i, /\bpelvic\s+cramp(?:s|ing)?\b/i, /\btightening\b/i],
  },
  {
    key: 'fatigue_weakness',
    patterns: [/\bfatigue\b/i, /\btired(?:ness)?\b/i, /\bexhaust(?:ed|ion)\b/i, /\bweak(?:ness)?\b/i, /\bletharg(?:y|ic)\b/i],
  },
  {
    key: 'breathlessness',
    patterns: [
      /\bbreathless(?:ness)?\b/i,
      /\bshort(?:ness)?\s+of\s+breath\b/i,
      /\bdyspnea\b/i,
      /\bdifficulty\s+breathing\b/i,
    ],
  },
  {
    key: 'dizziness_palpitations',
    patterns: [/\bdizz(?:y|iness)\b/i, /\blightheaded\b/i, /\bpalpitation(?:s)?\b/i, /\bheart\s+racing\b/i, /\bfaint(?:ing)?\b/i],
  },
  {
    key: 'dysuria_urinary_symptoms',
    patterns: [
      /\bdysuria\b/i,
      /\bburning\s+(?:on\s+|during\s+)?urination\b/i,
      /\bpain(?:ful)?\s+urination\b/i,
      /\burinary\s+frequency\b/i,
    ],
  },
  {
    key: 'fever_chills',
    patterns: [/\bfever(?:ish)?\b/i, /\bchills\b/i, /\bhigh\s+temperature\b/i],
  },
  {
    key: 'itching_cholestasis',
    patterns: [/\bitch(?:ing|y)\s+(?:palms|soles|skin|hands|feet)\b/i, /\bpruritus\b/i, /\bsevere\s+itching\b/i],
  },
];

/**
 * Checks whether a matched symptom phrase in a sentence is negated (e.g. "no headache",
 * "denies blurred vision or epigastric pain", "without any bleeding").
 */
function isMatchNegated(text, matchIndex) {
  // Split into clauses on sentence boundaries or contrasting conjunctions ("but", "however", "although")
  const prefix = text.slice(Math.max(0, matchIndex - 75), matchIndex).toLowerCase();
  const lastClauseBoundary = Math.max(
    prefix.lastIndexOf('.'),
    prefix.lastIndexOf(';'),
    prefix.lastIndexOf(' but '),
    prefix.lastIndexOf(' however '),
    prefix.lastIndexOf(' although '),
    prefix.lastIndexOf(' except ')
  );
  const clausePrefix = lastClauseBoundary >= 0 ? prefix.slice(lastClauseBoundary + 1) : prefix;

  return /\b(?:no|not|never|denies|denied|deny|without|nil|absent|free\s+of|negative\s+for|doesn't\s+have|don't\s+have|haven't\s+had|hasn't\s+had)\b/.test(
    clausePrefix
  );
}

function detectSeverityInClause(text, matchIndex) {
  const windowText = text.slice(Math.max(0, matchIndex - 35), Math.min(text.length, matchIndex + 45)).toLowerCase();
  if (/\b(?:severe|intense|worst|unbearable|heavy|marked|constant)\b/.test(windowText)) return 'severe';
  if (/\b(?:moderate|persistent|throbbing|noticeable|frequent)\b/.test(windowText)) return 'moderate';
  if (/\b(?:mild|slight|occasional|little|minor|light)\b/.test(windowText)) return 'mild';
  return 'unspecified';
}

/**
 * Deterministic extraction from pre-visit questionnaires, notes, and transcript segments.
 * Also used by 'fake' provider and merged with LLM extraction for pre-visit questionnaires.
 */
function extractDeterministicSymptoms(rawPatient = {}) {
  const byKey = new Map();

  const recordSymptom = ({ symptom_key, status, severity = 'unspecified', source, cited_segment_ids = [] }) => {
    const existing = byKey.get(symptom_key);
    if (!existing) {
      byKey.set(symptom_key, {
        symptom_key,
        status,
        severity: status === 'absent' ? 'unspecified' : severity,
        source,
        cited_segment_ids: [...new Set(cited_segment_ids)],
      });
      return;
    }
    // If already recorded, merge citations and let an explicit patient report override a question
    const mergedCitations = [...new Set([...existing.cited_segment_ids, ...cited_segment_ids])];
    const nextStatus = existing.status === 'present' || status === 'present' ? 'present' : 'absent';
    const severityOrder = { unspecified: 0, mild: 1, moderate: 2, severe: 3 };
    const nextSeverity =
      nextStatus === 'absent'
        ? 'unspecified'
        : (severityOrder[severity] || 0) > (severityOrder[existing.severity] || 0)
          ? severity
          : existing.severity;

    byKey.set(symptom_key, {
      symptom_key,
      status: nextStatus,
      severity: nextSeverity,
      source: existing.source === 'transcript' || source === 'transcript' ? 'transcript' : existing.source,
      cited_segment_ids: mergedCitations,
    });
  };

  // 1. Explicit symptoms map if passed directly in synthetic data
  if (rawPatient.symptoms && typeof rawPatient.symptoms === 'object' && !Array.isArray(rawPatient.symptoms)) {
    for (const [key, val] of Object.entries(rawPatient.symptoms)) {
      if (!config.canonicalSymptomKeys.includes(key)) continue;
      if (typeof val === 'string') {
        const lower = val.toLowerCase();
        if (lower === 'absent' || lower === 'no' || lower === 'none') {
          recordSymptom({ symptom_key: key, status: 'absent', source: 'pre_visit' });
        } else if (lower.startsWith('present')) {
          const sev = lower.split(':')[1] || 'unspecified';
          recordSymptom({
            symptom_key: key,
            status: 'present',
            severity: ['mild', 'moderate', 'severe'].includes(sev) ? sev : 'unspecified',
            source: 'pre_visit',
          });
        } else if (['mild', 'moderate', 'severe'].includes(lower)) {
          recordSymptom({ symptom_key: key, status: 'present', severity: lower, source: 'pre_visit' });
        }
      } else if (typeof val === 'boolean') {
        recordSymptom({ symptom_key: key, status: val ? 'present' : 'absent', source: 'pre_visit' });
      } else if (val && typeof val === 'object') {
        recordSymptom({
          symptom_key: key,
          status: val.status === 'absent' ? 'absent' : 'present',
          severity: val.severity || 'unspecified',
          source: val.source || 'pre_visit',
          cited_segment_ids: Array.isArray(val.cited_segment_ids) ? val.cited_segment_ids : [],
        });
      }
    }
  }

  // 2. Pre-visit questionnaire responses
  for (const q of rawPatient.questionnaireResponses || []) {
    const qText = String(q.question || q.question_text || '');
    const detailText = String(q.detail || q.answer_text || '');
    const combined = `${qText} ${detailText}`.trim();

    for (const { key, patterns } of SYMPTOM_PATTERNS) {
      if (patterns.some((rx) => rx.test(combined))) {
        const isTrue = q.answer === true || q.answer === 'yes' || q.value === 'yes' || q.answer === 'true';
        const isFalse = q.answer === false || q.answer === 'no' || q.value === 'no' || q.answer === 'false';

        if (isTrue) {
          recordSymptom({
            symptom_key: key,
            status: 'present',
            severity: detectSeverityInClause(detailText || qText, 0),
            source: 'pre_visit',
          });
        } else if (isFalse) {
          // Special case: "Is baby moving normally?" -> true means normal, false means reduced movement
          if (key === 'reduced_fetal_movement' && /\bmoving\s+well|normal\s+movement/i.test(qText)) {
            recordSymptom({ symptom_key: key, status: 'present', source: 'pre_visit' });
          } else {
            recordSymptom({ symptom_key: key, status: 'absent', source: 'pre_visit' });
          }
        }
      }
    }
  }

  // 3. Pre-visit / History free-text notes
  const freeNotes = [rawPatient.preVisitNotes, rawPatient.historyNotes, rawPatient.baseline?.history_notes]
    .filter(Boolean)
    .join('. ');
  if (freeNotes) {
    for (const { key, patterns } of SYMPTOM_PATTERNS) {
      for (const rx of patterns) {
        const match = rx.exec(freeNotes);
        if (match) {
          const negated = isMatchNegated(freeNotes, match.index);
          recordSymptom({
            symptom_key: key,
            status: negated ? 'absent' : 'present',
            severity: negated ? 'unspecified' : detectSeverityInClause(freeNotes, match.index),
            source: 'history',
          });
          break;
        }
      }
    }
  }

  // 4. Consultation Transcript Segments
  const segments = Array.isArray(rawPatient.transcriptSegments) ? rawPatient.transcriptSegments : [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segId = seg.segment_id || seg.id || `seg_${i + 1}`;
    const text = String(seg.text || '');
    const speaker = String(seg.speaker || 'unknown').toLowerCase();

    // If a doctor asks a question ("Any blurry vision?") and the next patient turn is a short "No" or "Yes"
    const isDoctorQuestion = speaker === 'doctor' && text.includes('?');
    const nextSeg = segments[i + 1];
    const nextText = nextSeg ? String(nextSeg.text || '').trim().toLowerCase() : '';
    const nextSegId = nextSeg ? nextSeg.segment_id || nextSeg.id || `seg_${i + 2}` : null;

    for (const { key, patterns } of SYMPTOM_PATTERNS) {
      for (const rx of patterns) {
        const match = rx.exec(text);
        if (!match) continue;

        if (isDoctorQuestion) {
          // Check if next patient turn directly answers yes/no
          if (nextSeg && String(nextSeg.speaker || '').toLowerCase() === 'patient') {
            if (/^(?:no|nope|not\s+at\s+all|none|nothing\s+like\s+that)\b/.test(nextText)) {
              recordSymptom({
                symptom_key: key,
                status: 'absent',
                source: 'transcript',
                cited_segment_ids: [segId, nextSegId].filter(Boolean),
              });
            } else if (/^(?:yes|yeah|a\s+little|sometimes|i\s+do|i\s+have)\b/.test(nextText)) {
              recordSymptom({
                symptom_key: key,
                status: 'present',
                severity: detectSeverityInClause(nextText, 0),
                source: 'transcript',
                cited_segment_ids: [segId, nextSegId].filter(Boolean),
              });
            }
          }
          break;
        }

        const negated = isMatchNegated(text, match.index);
        // Handle "baby is moving well / active kicks" as absent reduced_fetal_movement
        if (
          key === 'reduced_fetal_movement' &&
          !negated &&
          /\b(?:moving\s+well|good\s+movement|active|normal\s+movement)\b/i.test(text)
        ) {
          recordSymptom({
            symptom_key: key,
            status: 'absent',
            source: 'transcript',
            cited_segment_ids: [segId],
          });
          break;
        }

        recordSymptom({
          symptom_key: key,
          status: negated ? 'absent' : 'present',
          severity: negated ? 'unspecified' : detectSeverityInClause(text, match.index),
          source: 'transcript',
          cited_segment_ids: [segId],
        });
        break;
      }
    }
  }

  return [...byKey.values()];
}

/**
 * Builds a deterministic, de-identified clinical summary narrative from structured
 * features and extracted symptoms.
 */
function buildStandardizedNarrative(structured = {}, extractedSymptoms = [], rawNotes = '') {
  const parts = [];
  if (structured.gestational_weeks !== undefined) {
    parts.push(`${structured.gestational_weeks} weeks gestation`);
  }
  if (structured.gravida !== undefined || structured.para !== undefined) {
    parts.push(`G${structured.gravida ?? '?'}P${structured.para ?? '?'}`);
  }
  if (structured.bp_systolic !== undefined && structured.bp_diastolic !== undefined) {
    const deltaStr =
      structured.bp_systolic_delta !== undefined
        ? ` (systolic delta ${structured.bp_systolic_delta >= 0 ? '+' : ''}${structured.bp_systolic_delta} mmHg)`
        : '';
    parts.push(`BP ${structured.bp_systolic}/${structured.bp_diastolic} mmHg${deltaStr}`);
  }
  if (structured.hemoglobin !== undefined) {
    parts.push(`Hb ${structured.hemoglobin} g/dL`);
  }
  if (structured.urine_albumin !== undefined) {
    parts.push(`urine albumin ${structured.urine_albumin}`);
  }
  if (structured.fasting_glucose !== undefined) {
    parts.push(`fasting glucose ${structured.fasting_glucose} mg/dL`);
  }
  if (structured.post_meal_glucose !== undefined) {
    parts.push(`post-meal glucose ${structured.post_meal_glucose} mg/dL`);
  }
  if (structured.tsh !== undefined) {
    parts.push(`TSH ${structured.tsh} mIU/L`);
  }

  const present = extractedSymptoms
    .filter((s) => s.status === 'present')
    .map((s) => `${s.symptom_key.replaceAll('_', ' ')}${s.severity !== 'unspecified' ? ` (${s.severity})` : ''}`);
  const absent = extractedSymptoms
    .filter((s) => s.status === 'absent')
    .map((s) => s.symptom_key.replaceAll('_', ' '));

  if (present.length) {
    parts.push(`Present symptoms: ${present.join(', ')}`);
  }
  if (absent.length) {
    parts.push(`Pertinent negatives: ${absent.join(', ')}`);
  }
  if (rawNotes && typeof rawNotes === 'string' && rawNotes.trim()) {
    parts.push(`Context: ${rawNotes.trim()}`);
  }

  return parts.join('. ') + (parts.length ? '.' : '');
}

/**
 * Verifies citation integrity on LLM-extracted symptoms:
 * - Any symptom with source === 'transcript' MUST cite at least one valid segment_id
 *   present in the input transcript.
 * - Uncited transcript symptoms are dropped and counted (never logged by content).
 */
function verifyAndFilterExtractedSymptoms(rawSymptoms = [], validSegmentIds = new Set()) {
  const validSet = validSegmentIds instanceof Set ? validSegmentIds : new Set(validSegmentIds);
  const kept = [];
  let droppedUncitedCount = 0;

  for (const item of rawSymptoms) {
    if (!item || !config.canonicalSymptomKeys.includes(item.symptom_key)) continue;
    if (item.source === 'transcript') {
      const validCitations = (item.cited_segment_ids || []).filter((id) => validSet.has(id));
      if (validCitations.length === 0) {
        droppedUncitedCount++;
        continue;
      }
      kept.push({ ...item, cited_segment_ids: validCitations });
    } else {
      kept.push({ ...item, cited_segment_ids: [] });
    }
  }

  return { kept, droppedUncitedCount };
}

/**
 * Calls Google Gemini API for structured symptom & narrative extraction.
 */
async function callGeminiExtractor({ rawPatient, structured, options = {} }) {
  const apiKey = options.apiKey || config.geminiApiKey;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const model = options.model || config.geminiModel;
  const timeoutMs = options.timeoutMs || config.extractorTimeoutMs;
  const segments = (rawPatient.transcriptSegments || []).map((s, idx) => ({
    segment_id: s.segment_id || s.id || `seg_${idx + 1}`,
    speaker: s.speaker || 'unknown',
    text: s.text || '',
  }));

  const prompt = `
You are a clinical decision-support feature extraction assistant for a maternal health platform.
Extract canonical maternal symptoms (both PRESENT and explicitly denied ABSENT pertinent negatives) and a brief de-identified clinical narrative from the pre-visit data and consultation transcript.

CRITICAL SAFETY RULES:
1. NEVER STATE A MEDICAL DIAGNOSIS. Only describe reported symptoms, observations, and lab/vital measurements.
2. Do NOT include any patient names, phone numbers, or personally identifiable information in standardized_narrative.
3. Every symptom extracted from the transcript (source = "transcript") MUST cite the exact segment_id values where it was discussed.
4. Distinguish carefully between "present" (patient has the symptom) and "absent" (patient denied the symptom).

STRUCTURED METRICS:
${JSON.stringify(structured, null, 2)}

PRE-VISIT QUESTIONNAIRE & NOTES:
${JSON.stringify(
  {
    questionnaireResponses: rawPatient.questionnaireResponses || [],
    preVisitNotes: rawPatient.preVisitNotes || '',
    historyNotes: rawPatient.historyNotes || '',
  },
  null,
  2
)}

CONSULTATION TRANSCRIPT:
${JSON.stringify(segments, null, 2)}
`;

  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_EXTRACTION_SCHEMA,
          temperature: 0.1,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Gemini extractor API error (${res.status})`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('Empty response from Gemini extractor API');
    }

    return ExtractionResultSchema.parse(JSON.parse(rawText));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls Google Gemini Embedding API (`text-embedding-004`) on the de-identified clinical narrative.
 */
async function callGeminiEmbedding(narrativeText, options = {}) {
  const apiKey = options.apiKey || config.geminiApiKey;
  if (!apiKey || !narrativeText || !narrativeText.trim()) return null;

  const model = options.embeddingModel || config.geminiEmbeddingModel;
  const cacheKey = `${model}:${narrativeText.trim()}`;
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey);
  }

  const timeoutMs = options.timeoutMs || config.extractorTimeoutMs;
  const url = `${GEMINI_API_BASE}/${model}:embedContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: narrativeText }] },
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const data = await res.json();
    const values = data.embedding?.values;
    if (Array.isArray(values) && values.length > 0) {
      embeddingCache.set(cacheKey, values);
      return values;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls Local Ollama / OpenAI-compatible LLM for structured symptom & narrative extraction.
 */
async function callLocalExtractor({ rawPatient, structured, options = {} }) {
  const url = options.url || config.localLlmUrl;
  const model = options.model || config.localLlmModel;
  const timeoutMs = options.timeoutMs || config.extractorTimeoutMs;
  const segments = (rawPatient.transcriptSegments || []).map((s, idx) => ({
    segment_id: s.segment_id || s.id || `seg_${idx + 1}`,
    speaker: s.speaker || 'unknown',
    text: s.text || '',
  }));

  const systemPrompt = `
You are a clinical feature extraction assistant for a maternal health platform.
Return ONLY a JSON object matching:
{
  "extracted_symptoms": [
    {
      "symptom_key": one of ${JSON.stringify(config.canonicalSymptomKeys)},
      "status": "present" | "absent",
      "severity": "mild" | "moderate" | "severe" | "unspecified",
      "source": "transcript" | "pre_visit" | "history",
      "cited_segment_ids": string[]
    }
  ],
  "standardized_narrative": string
}
RULES:
1. NEVER state a diagnosis.
2. Every symptom with source="transcript" MUST cite valid segment_id strings from the transcript.
`;

  const userPrompt = JSON.stringify({
    structured,
    questionnaireResponses: rawPatient.questionnaireResponses || [],
    preVisitNotes: rawPatient.preVisitNotes || '',
    transcriptSegments: segments,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const isOpenAi = url.includes('/v1/chat/completions');
    const body = isOpenAi
      ? {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }
      : {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          format: 'json',
          stream: false,
          think: Boolean(config.localLlmThink),
          options: { temperature: 0.1 },
        };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Local LLM extractor error (${res.status})`);
    }

    const json = await res.json();
    const content = isOpenAi ? json.choices?.[0]?.message?.content : json.message?.content || json.response;
    return ExtractionResultSchema.parse(JSON.parse(content));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full extraction pipeline for a patient profile (query or historical reference).
 *
 * @param {Object} rawPatient
 * @param {Object} [options]
 * @param {string} [options.provider] - 'gemini' | 'local' | 'fake'
 * @param {boolean} [options.allowFallbackToFake=true] - Falls back to deterministic extractor if API key is missing/offline
 * @returns {Promise<Object>} Normalized Patient Feature Profile
 */
async function extractPatientProfile(rawPatient = {}, options = {}) {
  const start = Date.now();
  const structured = normalizeStructuredFeatures(rawPatient);
  const segments = Array.isArray(rawPatient.transcriptSegments) ? rawPatient.transcriptSegments : [];
  const validSegmentIds = new Set(segments.map((s, idx) => s.segment_id || s.id || `seg_${idx + 1}`));

  const requestedProvider = String(options.provider || config.extractorProvider || 'gemini').toLowerCase();
  const allowFallback = options.allowFallbackToFake !== false;

  let providerUsed = requestedProvider;
  let extractedSymptoms = [];
  let standardizedNarrative = '';
  let droppedUncitedCount = 0;
  let embedding = Array.isArray(rawPatient.embedding) ? rawPatient.embedding : null;

  const hasTranscriptOrNotes =
    segments.length > 0 ||
    (Array.isArray(rawPatient.questionnaireResponses) && rawPatient.questionnaireResponses.length > 0) ||
    Boolean(rawPatient.preVisitNotes) ||
    Boolean(rawPatient.historyNotes);

  if (requestedProvider === 'gemini' && hasTranscriptOrNotes) {
    try {
      const llmOut = await callGeminiExtractor({ rawPatient, structured, options });
      const verified = verifyAndFilterExtractedSymptoms(llmOut.extracted_symptoms, validSegmentIds);
      extractedSymptoms = verified.kept;
      droppedUncitedCount = verified.droppedUncitedCount;
      standardizedNarrative = llmOut.standardized_narrative;
      if (!embedding && standardizedNarrative) {
        embedding = await callGeminiEmbedding(standardizedNarrative, options);
      }
    } catch (err) {
      if (!allowFallback) throw err;
      logger.warn('Gemini extractor unavailable; falling back to deterministic clinical extractor', {
        scope: 'patient-similarity',
        errorCode: 'WARN_EXTRACTOR_FALLBACK_FAKE',
      });
      providerUsed = 'fake';
    }
  } else if (requestedProvider === 'local' && hasTranscriptOrNotes) {
    try {
      const llmOut = await callLocalExtractor({ rawPatient, structured, options });
      const verified = verifyAndFilterExtractedSymptoms(llmOut.extracted_symptoms, validSegmentIds);
      extractedSymptoms = verified.kept;
      droppedUncitedCount = verified.droppedUncitedCount;
      standardizedNarrative = llmOut.standardized_narrative;
    } catch (err) {
      if (!allowFallback) throw err;
      logger.warn('Local LLM extractor unavailable; falling back to deterministic clinical extractor', {
        scope: 'patient-similarity',
        errorCode: 'WARN_LOCAL_EXTRACTOR_FALLBACK_FAKE',
      });
      providerUsed = 'fake';
    }
  } else {
    providerUsed = 'fake';
  }

  // Merge or run deterministic extraction so explicit pre-visit answers and structured symptom maps are never lost
  const deterministicSymptoms = extractDeterministicSymptoms(rawPatient);
  if (providerUsed === 'fake' || extractedSymptoms.length === 0) {
    const verifiedDet = verifyAndFilterExtractedSymptoms(deterministicSymptoms, validSegmentIds);
    extractedSymptoms = verifiedDet.kept;
    droppedUncitedCount += verifiedDet.droppedUncitedCount;
  } else {
    // Ensure any explicit pre-visit questionnaire symptoms not emitted by LLM are preserved
    const existingKeys = new Set(extractedSymptoms.map((s) => s.symptom_key));
    for (const det of deterministicSymptoms) {
      if (!existingKeys.has(det.symptom_key) && det.source !== 'transcript') {
        extractedSymptoms.push(det);
      }
    }
  }

  if (!standardizedNarrative) {
    standardizedNarrative =
      rawPatient.clinicalNarrative ||
      buildStandardizedNarrative(structured, extractedSymptoms, rawPatient.preVisitNotes);
  }

  // Convert symptom array into fast lookup map: { [symptom_key]: { status, severity, source, cited_segment_ids } }
  const symptomMap = {};
  for (const item of extractedSymptoms) {
    symptomMap[item.symptom_key] = item;
  }

  return {
    id: rawPatient.id || rawPatient.episodeId || null,
    label: rawPatient.label || rawPatient.caseCode || null,
    archetype: rawPatient.archetype || null,
    structured,
    symptoms: symptomMap,
    extractedSymptomsList: extractedSymptoms,
    standardizedNarrative,
    embedding,
    extractionMeta: {
      providerRequested: requestedProvider,
      providerUsed,
      droppedUncitedCount,
      latencyMs: Date.now() - start,
    },
    // Preserve historical outcomes if this is a reference cohort member
    progressionSummary: rawPatient.progressionSummary || null,
    subsequentVisits: rawPatient.subsequentVisits || [],
    interventionsRecorded: rawPatient.interventionsRecorded || [],
    deliveryOutcome: rawPatient.deliveryOutcome || null,
  };
}

module.exports = {
  normalizeOrdinalDipstick,
  normalizeStructuredFeatures,
  extractDeterministicSymptoms,
  verifyAndFilterExtractedSymptoms,
  buildStandardizedNarrative,
  callGeminiEmbedding,
  extractPatientProfile,
};
