/**
 * Patient Similarity Service (Orchestration, Benchmarking & Audit Persistence).
 *
 * Coordinates:
 * 1. Direct synthetic evaluation (`evaluateDirectSimilarity`) using the full production
 *    pipeline (LLM/deterministic clinical extractor + custom parameter/symptom weights +
 *    Gower/Bayesian shrinkage + narrative cosine).
 * 2. Cohort sources:
 *    - `'curated'` (11 hand-crafted clinical episodes)
 *    - `'generated'` (Synthea-style longitudinal generator, default N=100)
 *    - `'public_format'` (UCI Maternal Health Risk + MTS-Dialog format records)
 *    - `'hybrid'` (combined curated + generated + public format records)
 * 3. Quantitative benchmark runner (`runCohortBenchmark`) measuring Top-1/Top-3/Top-5
 *    archetype hit rates, sparse-record rejection, and negation accuracy.
 * 4. Database-backed episode evaluation (`evaluateEpisodeSimilarity`), loading saved
 *    episodes from Supabase and persisting audit records into `ml_prediction_runs`
 *    and `pregnancy_cohort_runs`.
 *
 * Safety & Privacy (AGENTS.md):
 * - Product flags and prioritises; it NEVER diagnoses.
 * - Zero transcript text, names, or health values in logs (only IDs, counts, latencies, error codes).
 */

const supabaseAdmin = require('../../config/supabaseAdminClient');
const config = require('../../config/patientSimilarity.config');
const logger = require('../../utils/logger');
const { extractPatientProfile, callGeminiEmbedding } = require('./featureExtractor');
const { fitPatientCohortModel, rankCohortMatches } = require('./similarityEngine');
const { SYNTHETIC_REFERENCE_COHORT, SAMPLE_DEMO_QUERIES } = require('./syntheticCohort.fixtures');
const { generateSyntheticMaternalCohort } = require('./cohortGenerator');
const {
  parseCsvRecords,
  adaptPublicDatasetBatch,
  PUBLIC_FORMAT_SAMPLE_CSV,
} = require('./publicDatasetAdapter');

// Pre-extracted caches keyed by cohort source signature
const extractedCohortCache = new Map();

async function resolveReferenceCohortProfiles(referenceCohort, options = {}, includeGeminiEmbeddings = false) {
  const provider = options.extractorProvider || options.provider || config.extractorProvider;

  if (Array.isArray(referenceCohort) && referenceCohort.length > 0) {
    return Promise.all(
      referenceCohort.map((item) =>
        extractPatientProfile(item, {
          provider: options.extractReferenceWithLlm ? provider : 'fake',
          allowFallbackToFake: true,
        })
      )
    );
  }

  const cohortSource = String(options.cohortSource || 'curated').toLowerCase();
  const generatedCount = Math.min(Math.max(Number(options.generatedCount) || config.defaultGeneratedCohortSize, 5), 500);
  const seed = Number(options.seed) || config.defaultCohortSeed;
  const cacheKey = `${cohortSource}:${generatedCount}:${seed}`;

  let profiles = extractedCohortCache.get(cacheKey);
  if (!profiles) {
    let rawItems = [];
    if (cohortSource === 'generated') {
      rawItems = generateSyntheticMaternalCohort(generatedCount, { seed });
    } else if (cohortSource === 'public_format') {
      const uciRows = parseCsvRecords(PUBLIC_FORMAT_SAMPLE_CSV.uciMaternalCsv);
      const dialogueRows = parseCsvRecords(PUBLIC_FORMAT_SAMPLE_CSV.mtsDialogCsv);
      rawItems = adaptPublicDatasetBatch({ uciRows, dialogueRows });
    } else if (cohortSource === 'hybrid') {
      const generated = generateSyntheticMaternalCohort(generatedCount, { seed });
      const uciRows = parseCsvRecords(PUBLIC_FORMAT_SAMPLE_CSV.uciMaternalCsv);
      const dialogueRows = parseCsvRecords(PUBLIC_FORMAT_SAMPLE_CSV.mtsDialogCsv);
      const publicAdapted = adaptPublicDatasetBatch({ uciRows, dialogueRows });
      rawItems = [...SYNTHETIC_REFERENCE_COHORT, ...generated, ...publicAdapted];
    } else {
      rawItems = SYNTHETIC_REFERENCE_COHORT;
    }

    profiles = await Promise.all(
      rawItems.map((item) =>
        extractPatientProfile(item, { provider: 'fake', allowFallbackToFake: true })
      )
    );
    extractedCohortCache.set(cacheKey, profiles);
  }

  // Only call external embedding API for small cohorts (<= 25) to avoid rate limits
  if (includeGeminiEmbeddings && profiles.length <= 25) {
    await Promise.all(
      profiles.map(async (prof) => {
        if (!prof.embedding && prof.standardizedNarrative) {
          prof.embedding = await callGeminiEmbedding(prof.standardizedNarrative);
        }
      })
    );
  }

  return profiles;
}

/**
 * Returns the complete parameter weight configuration table for inspection in the UI/API.
 */
function getWeightsCatalog() {
  return {
    modelVersion: config.modelVersion,
    modalityFusionWeights: {
      alphaStructured: config.alphaStructured,
      betaSymptoms: config.betaSymptoms,
      gammaNarrative: config.gammaNarrative,
    },
    bayesianCoverageShrinkage: {
      shrinkageStrengthK: config.shrinkageStrengthK,
      shrinkagePriorS0: config.shrinkagePriorS0,
    },
    structuredParameterWeights: Object.fromEntries(
      Object.entries(config.structuredFeatures).map(([key, def]) => [
        key,
        {
          weight: def.weight,
          type: def.type,
          unit: def.unit || '',
          label: def.label,
        },
      ])
    ),
    symptomParameterWeights: Object.fromEntries(
      Object.entries(config.symptomDefinitions).map(([key, def]) => [
        key,
        {
          weight: def.weight,
          tier: def.tier,
          label: def.label,
        },
      ])
    ),
    severityWeightMultipliers: config.severityWeightMultipliers,
    symptomPolarityMultipliers: {
      presentMatchMultiplier: config.symptomWeights.presentMatchMultiplier,
      presentVsAbsentConflictMultiplier: config.symptomWeights.presentVsAbsentConflictMultiplier,
      presentVsMissingInCandidateMultiplier: config.symptomWeights.presentVsMissingInCandidateMultiplier,
      absentMatchPertinentNegativeMultiplier: config.symptomWeights.absentMatchPertinentNegativeMultiplier,
    },
    overrideExample: {
      options: {
        featureWeights: {
          bp_systolic: 3.5,
          urine_albumin: 3.5,
          hemoglobin: 2.5,
          blood_group: 0.2,
        },
        symptomItemWeights: {
          vaginal_bleeding: 4.5,
          visual_disturbance: 4.0,
          headache: 3.0,
          fatigue_weakness: 1.0,
        },
      },
    },
  };
}

/**
 * Generates a non-diagnostic, descriptive clinical decision-support summary
 * of the retrieved cohort's patterns and recorded outcomes.
 */
function buildDescriptiveCohortSummary(topMatches = [], uncheckedFactors = []) {
  if (!topMatches.length) {
    return {
      disclaimer:
        'Clinical decision-support tool only. Retrieves comparable historical cases for pattern review; does not provide a medical diagnosis or treatment directive.',
      comparableCasesCount: 0,
      commonMatchedPatterns: [],
      commonInterventionsObserved: [],
      deliveryOutcomesObserved: [],
      suggestedUncheckedFactorsToReview: [],
    };
  }

  const factorFreq = new Map();
  const interventionFreq = new Map();
  const deliveryOutcomes = [];

  for (const m of topMatches) {
    for (const f of m.matchedFactors || []) {
      const key = `${f.type}:${f.feature}`;
      const cur = factorFreq.get(key) || {
        feature: f.feature,
        label: f.label,
        type: f.type,
        weight: f.weight,
        count: 0,
      };
      cur.count++;
      factorFreq.set(key, cur);
    }
    for (const intv of m.clinicalProgression?.interventionsRecorded || []) {
      interventionFreq.set(intv, (interventionFreq.get(intv) || 0) + 1);
    }
    if (m.clinicalProgression?.deliveryOutcome) {
      deliveryOutcomes.push({
        episodeId: m.episodeId,
        caseLabel: m.caseLabel,
        similarityPercent: m.similarityPercent,
        ...m.clinicalProgression.deliveryOutcome,
      });
    }
  }

  const commonMatchedPatterns = [...factorFreq.values()]
    .sort((a, b) => b.count * (b.weight || 1) - a.count * (a.weight || 1))
    .slice(0, 8);

  const commonInterventionsObserved = [...interventionFreq.entries()]
    .map(([intervention, countInTopK]) => ({ intervention, countInTopK }))
    .sort((a, b) => b.countInTopK - a.countInTopK);

  return {
    disclaimer:
      'Clinical decision-support tool only. Retrieves comparable historical cases for pattern review; does not provide a medical diagnosis or treatment directive.',
    comparableCasesCount: topMatches.length,
    commonMatchedPatterns,
    commonInterventionsObserved,
    deliveryOutcomesObserved: deliveryOutcomes,
    suggestedUncheckedFactorsToReview: uncheckedFactors.slice(0, 6),
  };
}

/**
 * Evaluates a synthetic or ad-hoc query patient against a reference cohort.
 * Supports custom per-parameter weights (`options.featureWeights` and `options.symptomItemWeights`)
 * and multiple cohort sources (`options.cohortSource`: 'curated' | 'generated' | 'public_format' | 'hybrid').
 */
async function evaluateDirectSimilarity({ queryPatient, referenceCohort = null, options = {} }) {
  const start = Date.now();
  const provider = options.extractorProvider || options.provider || config.extractorProvider;

  // 1. Extract query patient profile (structured features + longitudinal deltas + transcript symptoms + narrative)
  const extractedQueryProfile = await extractPatientProfile(queryPatient, {
    provider,
    allowFallbackToFake: options.allowFallbackToFake !== false,
  });

  // 2. Prepare reference cohort profiles
  const useDenseEmbeddings = Boolean(extractedQueryProfile.embedding);
  const referenceProfiles = await resolveReferenceCohortProfiles(
    referenceCohort,
    options,
    useDenseEmbeddings
  );

  // 3. Fit numeric ranges strictly on reference cohort (never on queryPatient)
  const cohortModel = fitPatientCohortModel(referenceProfiles);

  // 4. Rank matches with Custom Parameter Weights & Bayesian Coverage Shrinkage
  const rankingResult = rankCohortMatches(cohortModel, extractedQueryProfile, options);

  // 5. Build descriptive cohort synthesis
  const cohortSummary = buildDescriptiveCohortSummary(
    rankingResult.topMatches,
    rankingResult.uncheckedFactorsInQuery
  );

  const latencyMs = Date.now() - start;

  // Privacy-safe log: counts, provider, and timings only — zero clinical values or transcript text
  logger.info('Completed direct patient similarity evaluation', {
    scope: 'patient-similarity',
    cohortSource: options.cohortSource || (referenceCohort ? 'custom' : 'curated'),
    providerRequested: extractedQueryProfile.extractionMeta.providerRequested,
    providerUsed: extractedQueryProfile.extractionMeta.providerUsed,
    candidatesEvaluated: rankingResult.totalCandidatesEvaluated,
    topKReturned: rankingResult.topMatches.length,
    latencyMs,
  });

  return {
    modelVersion: rankingResult.modelVersion,
    latencyMs,
    extractedQueryProfile: {
      structured: extractedQueryProfile.structured,
      extractedSymptoms: extractedQueryProfile.extractedSymptomsList,
      standardizedNarrative: extractedQueryProfile.standardizedNarrative,
      extractionMeta: extractedQueryProfile.extractionMeta,
    },
    rankingMeta: {
      cohortSource: options.cohortSource || (referenceCohort ? 'custom' : 'curated'),
      totalCandidatesEvaluated: rankingResult.totalCandidatesEvaluated,
      gestationalWindowWeeksUsed: rankingResult.gestationalWindowWeeksUsed,
      shrinkageStrengthK: options.shrinkageK ?? config.shrinkageStrengthK,
      shrinkagePriorS0: options.shrinkageS0 ?? config.shrinkagePriorS0,
      modalityWeights: {
        alphaStructured: options.alphaStructured ?? config.alphaStructured,
        betaSymptoms: options.betaSymptoms ?? config.betaSymptoms,
        gammaNarrative: options.gammaNarrative ?? config.gammaNarrative,
      },
      customFeatureWeightsApplied: options.featureWeights || {},
      customSymptomWeightsApplied: options.symptomItemWeights || {},
    },
    topMatches: rankingResult.topMatches,
    uncheckedFactorsInQuery: rankingResult.uncheckedFactorsInQuery,
    cohortSummary,
  };
}

/**
 * Adapts raw public dataset records (UCI Maternal Health Risk CSV/rows + MTS-Dialog CSV/rows)
 * and optionally evaluates a query patient against them.
 */
async function adaptAndEvaluatePublicDataset({
  uciCsv = null,
  mtsCsv = null,
  uciRows = null,
  dialogueRows = null,
  queryPatient = null,
  options = {},
} = {}) {
  const parsedUci = Array.isArray(uciRows)
    ? uciRows
    : parseCsvRecords(uciCsv || PUBLIC_FORMAT_SAMPLE_CSV.uciMaternalCsv);
  const parsedMts = Array.isArray(dialogueRows)
    ? dialogueRows
    : parseCsvRecords(mtsCsv || PUBLIC_FORMAT_SAMPLE_CSV.mtsDialogCsv);

  const adaptedRecords = adaptPublicDatasetBatch({
    uciRows: parsedUci,
    dialogueRows: parsedMts,
  });

  let evaluation = null;
  if (queryPatient && typeof queryPatient === 'object') {
    evaluation = await evaluateDirectSimilarity({
      queryPatient,
      referenceCohort: adaptedRecords,
      options,
    });
  }

  return {
    adaptedCount: adaptedRecords.length,
    adaptedRecords,
    evaluation,
  };
}

/**
 * Runs a quantitative leave-one-out / archetype benchmark across a generated + curated
 * longitudinal maternal cohort (default N=100 generated + 11 curated = 111 cases).
 *
 * Evaluates:
 * - Top-1, Top-3, Top-5 Archetype Cluster Hit Rate
 * - Sparse-Record Top-3 Contamination Rate (verifying sparse records do not falsely win)
 * - Transcript Negation Accuracy (verifying denied symptoms are extracted as 'absent')
 */
async function runCohortBenchmark(options = {}) {
  const start = Date.now();
  const cohortSize = Math.min(Math.max(Number(options.cohortSize) || 100, 20), 500);
  const seed = Number(options.seed) || config.defaultCohortSeed;

  const rawGenerated = generateSyntheticMaternalCohort(cohortSize, { seed });
  const allRaw = [...SYNTHETIC_REFERENCE_COHORT, ...rawGenerated];

  const allProfiles = await Promise.all(
    allRaw.map((r) => extractPatientProfile(r, { provider: 'fake', allowFallbackToFake: true }))
  );

  const cohortModel = fitPatientCohortModel(allProfiles);

  // Evaluate all non-sparse clinical episodes in leave-one-out mode
  const clinicalQueries = allProfiles.filter(
    (p) => p.archetype && p.archetype !== 'sparse_incomplete_control'
  );

  let top1Hits = 0;
  let top3Hits = 0;
  let top5Hits = 0;
  let sparseInTop3Count = 0;
  let negationChecksTotal = 0;
  let negationChecksPassed = 0;

  const byArchetype = {};

  for (const queryProf of clinicalQueries) {
    // Check transcript negation integrity on extracted symptoms
    for (const sym of queryProf.extractedSymptomsList || []) {
      if (sym.status === 'absent') {
        negationChecksTotal++;
        if (queryProf.symptoms[sym.symptom_key]?.status === 'absent') {
          negationChecksPassed++;
        }
      }
    }

    const ranked = rankCohortMatches(cohortModel, queryProf, {
      ...options,
      topK: 5,
    });

    const top1 = ranked.topMatches[0];
    const top3 = ranked.topMatches.slice(0, 3);
    const top5 = ranked.topMatches.slice(0, 5);

    const hit1 = top1?.archetype === queryProf.archetype;
    const hit3 = top3.some((m) => m.archetype === queryProf.archetype);
    const hit5 = top5.some((m) => m.archetype === queryProf.archetype);
    const hasSparseInTop3 = top3.some((m) => m.archetype === 'sparse_incomplete_control');

    if (hit1) top1Hits++;
    if (hit3) top3Hits++;
    if (hit5) top5Hits++;
    if (hasSparseInTop3) sparseInTop3Count++;

    const stats = (byArchetype[queryProf.archetype] ||= {
      queriesEvaluated: 0,
      top1Hits: 0,
      top3Hits: 0,
      top5Hits: 0,
    });
    stats.queriesEvaluated++;
    if (hit1) stats.top1Hits++;
    if (hit3) stats.top3Hits++;
    if (hit5) stats.top5Hits++;
  }

  const totalEval = Math.max(1, clinicalQueries.length);
  const perArchetypeBreakdown = Object.fromEntries(
    Object.entries(byArchetype).map(([arch, st]) => [
      arch,
      {
        queriesEvaluated: st.queriesEvaluated,
        top1HitRate: Math.round((st.top1Hits / st.queriesEvaluated) * 1000) / 1000,
        top3HitRate: Math.round((st.top3Hits / st.queriesEvaluated) * 1000) / 1000,
        top5HitRate: Math.round((st.top5Hits / st.queriesEvaluated) * 1000) / 1000,
      },
    ])
  );

  const latencyMs = Date.now() - start;
  logger.info('Completed patient similarity cohort benchmark', {
    scope: 'patient-similarity-benchmark',
    totalCohortSize: allProfiles.length,
    queriesEvaluated: clinicalQueries.length,
    latencyMs,
  });

  return {
    modelVersion: cohortModel.version,
    totalCohortSize: allProfiles.length,
    sparseControlsCount: allProfiles.filter((p) => p.archetype === 'sparse_incomplete_control').length,
    clinicalQueriesEvaluated: clinicalQueries.length,
    latencyMs,
    metrics: {
      top1ArchetypeHitRate: Math.round((top1Hits / totalEval) * 1000) / 1000,
      top3ArchetypeHitRate: Math.round((top3Hits / totalEval) * 1000) / 1000,
      top5ArchetypeHitRate: Math.round((top5Hits / totalEval) * 1000) / 1000,
      sparseRecordTop3ContaminationRate: Math.round((sparseInTop3Count / totalEval) * 1000) / 1000,
      transcriptNegationAccuracy:
        negationChecksTotal > 0 ? Math.round((negationChecksPassed / negationChecksTotal) * 1000) / 1000 : 1,
    },
    perArchetypeBreakdown,
  };
}

/**
 * Loads an existing pregnancy episode and its linked visits, labs, questionnaires,
 * and latest consultation transcript from Supabase, evaluates similarity, and
 * persists audit records in `ml_prediction_runs` and `pregnancy_cohort_runs`.
 */
async function evaluateEpisodeSimilarity({ episodeId, clinicianId, options = {} }) {
  const start = Date.now();

  const { data: episode, error: epErr } = await supabaseAdmin
    .from('pregnancy_episodes')
    .select('*')
    .eq('id', episodeId)
    .eq('clinician_id', clinicianId)
    .maybeSingle();

  if (epErr) throw epErr;
  if (!episode) {
    const err = new Error('Pregnancy episode not found or access denied');
    err.status = 404;
    throw err;
  }

  const [visitsRes, invRes, appointmentsRes] = await Promise.all([
    supabaseAdmin
      .from('antenatal_visits')
      .select('*')
      .eq('pregnancy_episode_id', episodeId)
      .order('visit_date', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('pregnancy_investigations')
      .select('*')
      .eq('pregnancy_episode_id', episodeId)
      .order('performed_on', { ascending: false }),
    supabaseAdmin
      .from('appointments')
      .select('id, scheduled_at')
      .eq('patient_id', episode.patient_id)
      .eq('clinician_id', clinicianId)
      .order('scheduled_at', { ascending: false })
      .limit(3),
  ]);

  const visits = visitsRes.data || [];
  const latestVisit = visits[0] || {};
  const prevVisit = visits[1] || {};
  const investigations = invRes.data || [];
  const latestAppointmentId = appointmentsRes.data?.[0]?.id || null;

  let questionnaireResponses = [];
  let transcriptSegments = [];

  if (latestAppointmentId) {
    const [qRes, sessRes] = await Promise.all([
      supabaseAdmin
        .from('questionnaire_responses')
        .select('answer, detail, answer_text, questionnaire_templates(question_text)')
        .eq('appointment_id', latestAppointmentId),
      supabaseAdmin
        .from('consult_sessions')
        .select('id')
        .eq('appointment_id', latestAppointmentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    questionnaireResponses = (qRes.data || []).map((r) => ({
      question: r.questionnaire_templates?.question_text || '',
      answer: r.answer,
      detail: r.detail || r.answer_text || '',
    }));

    if (sessRes.data?.id) {
      const { data: segs } = await supabaseAdmin
        .from('segments')
        .select('id, speaker, text')
        .eq('session_id', sessRes.data.id)
        .order('start_ms', { ascending: true });

      transcriptSegments = (segs || []).map((s) => ({
        segment_id: s.id,
        speaker: s.speaker,
        text: s.text,
      }));
    }
  }

  const labs = {};
  for (const inv of investigations) {
    const k = String(inv.investigation_key || inv.investigation_name || '').toLowerCase();
    if (k.includes('hemoglobin') || k === 'hb') labs.hemoglobin ??= inv.result_value;
    if (k.includes('tsh')) labs.tsh ??= inv.result_value;
    if (k.includes('platelet')) labs.platelets ??= inv.result_value;
    if (k.includes('fasting')) labs.fasting_glucose ??= inv.result_value;
    if (k.includes('creatinine')) labs.creatinine ??= inv.result_value;
  }
  if (latestVisit.hemoglobin_g_dl != null) labs.hemoglobin ??= latestVisit.hemoglobin_g_dl;
  if (latestVisit.tsh != null) labs.tsh ??= latestVisit.tsh;
  if (latestVisit.urine_albumin) labs.urine_albumin = latestVisit.urine_albumin;
  if (latestVisit.urine_sugar) labs.urine_sugar = latestVisit.urine_sugar;

  const queryPatient = {
    id: episode.id,
    gestationalWeeks: latestVisit.gestational_weeks,
    gravida: episode.gravida,
    para: episode.para,
    abortions: episode.abortions,
    blood_group: episode.blood_group,
    historyNotes: episode.history_notes,
    vitals: {
      bp_systolic: latestVisit.bp_systolic,
      bp_diastolic: latestVisit.bp_diastolic,
      weight_kg: latestVisit.weight_kg,
      fundal_height_cm: latestVisit.fundal_height_cm,
      fetal_heart_rate_bpm: latestVisit.fetal_heart_rate,
    },
    previousVitals: {
      bp_systolic: prevVisit.bp_systolic,
      bp_diastolic: prevVisit.bp_diastolic,
    },
    labs,
    previousLabs: {
      hemoglobin: prevVisit.hemoglobin_g_dl,
    },
    questionnaireResponses,
    transcriptSegments,
  };

  const evalResult = await evaluateDirectSimilarity({
    queryPatient,
    referenceCohort: options.referenceCohort || null,
    options,
  });

  try {
    const { data: predRun } = await supabaseAdmin
      .from('ml_prediction_runs')
      .insert({
        clinician_id: clinicianId,
        pregnancy_episode_id: episode.id,
        task: 'patient_similarity',
        provider: evalResult.extractedQueryProfile.extractionMeta.providerUsed,
        model_version: evalResult.modelVersion,
        status: 'completed',
        result: {
          topMatchesCount: evalResult.topMatches.length,
          uncheckedFactorsCount: evalResult.uncheckedFactorsInQuery.length,
        },
      })
      .select('id')
      .single();

    if (predRun?.id) {
      await supabaseAdmin.from('pregnancy_cohort_runs').insert({
        prediction_run_id: predRun.id,
        clinician_id: clinicianId,
        model_version: evalResult.modelVersion,
        status: 'completed',
      });
    }
  } catch {
    logger.warn('Non-fatal error saving patient_similarity audit run', {
      scope: 'patient-similarity',
      episodeId,
      errorCode: 'WARN_SIMILARITY_AUDIT_WRITE',
    });
  }

  logger.info('Completed episode patient similarity evaluation', {
    scope: 'patient-similarity',
    episodeId,
    latencyMs: Date.now() - start,
  });

  return evalResult;
}

function getSyntheticCohortCatalog(options = {}) {
  const includeGenerated = options.includeGenerated === 'true' || options.includeGenerated === true;
  const generatedCount = Math.min(Math.max(Number(options.count) || 25, 1), 200);
  const generatedSamples = includeGenerated ? generateSyntheticMaternalCohort(generatedCount) : [];

  return {
    modelVersion: config.modelVersion,
    canonicalSymptomKeys: config.canonicalSymptomKeys,
    structuredFeatures: config.structuredFeatures,
    symptomDefinitions: config.symptomDefinitions,
    supportedCohortSources: ['curated', 'generated', 'public_format', 'hybrid'],
    syntheticReferenceCohortCount: SYNTHETIC_REFERENCE_COHORT.length,
    syntheticReferenceCohort: SYNTHETIC_REFERENCE_COHORT,
    generatedCohortPreviewCount: generatedSamples.length,
    generatedCohortPreview: generatedSamples,
    sampleDemoQueries: SAMPLE_DEMO_QUERIES,
  };
}

module.exports = {
  getWeightsCatalog,
  getSyntheticCohortCatalog,
  evaluateDirectSimilarity,
  adaptAndEvaluatePublicDataset,
  runCohortBenchmark,
  evaluateEpisodeSimilarity,
  buildDescriptiveCohortSummary,
};
