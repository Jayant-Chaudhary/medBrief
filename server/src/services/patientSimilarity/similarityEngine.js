/**
 * Hybrid Patient Similarity Engine (`hybrid-gower-shrinkage-v2`).
 *
 * Combines:
 * 1. Gestational-Age Window Pre-Filtering
 * 2. Range-Normalized Gower Distance on Verified Structured Labs, Vitals & Deltas
 *    with custom per-parameter edge weights (fitted strictly on reference cohort)
 * 3. Asymmetric Missing-Value Weighting & Bayesian Coverage Shrinkage ("No Value" handling)
 * 4. Polarity-Aware Symptom Overlap with per-symptom custom clinical weights and
 *    severity multipliers (distinguishing active present symptoms, explicitly denied
 *    pertinent negatives, and unmentioned/null symptoms)
 * 5. Semantic Clinical Narrative Similarity (Dense Embedding Cosine or Clinical Bigram Cosine)
 * 6. Unchecked Clinical Factor Discovery (factors missing in the query patient that are
 *    prevalent across the top matched historical cases)
 *
 * Safety & Privacy (AGENTS.md):
 * - Descriptive decision-support similarity only; never diagnoses or prescribes.
 */

const config = require('../../config/patientSimilarity.config');

/**
 * Fits observed min/max numeric ranges strictly on the historical reference cohort.
 * The query patient's values are NEVER included in range fitting.
 *
 * @param {Array<Object>} referenceProfiles - Extracted historical patient profiles
 * @param {Object} [customFeatureDefs] - Optional overrides for structuredFeatures
 * @returns {Object} Fitted cohort model
 */
function fitPatientCohortModel(referenceProfiles = [], customFeatureDefs = null) {
  const featureDefs = customFeatureDefs || config.structuredFeatures;
  const symptomDefs = config.symptomDefinitions;
  const ranges = {};

  for (const [featureKey, def] of Object.entries(featureDefs)) {
    if (def.type !== 'number') continue;
    let min = Infinity;
    let max = -Infinity;
    let count = 0;

    for (const ref of referenceProfiles) {
      const val = ref?.structured?.[featureKey];
      if (typeof val === 'number' && Number.isFinite(val)) {
        if (val < min) min = val;
        if (val > max) max = val;
        count++;
      }
    }

    if (count > 0) {
      ranges[featureKey] = { min, max, span: max - min, count };
    } else {
      ranges[featureKey] = { min: 0, max: 0, span: 0, count: 0 };
    }
  }

  return {
    version: config.modelVersion,
    featureDefs,
    symptomDefs,
    ranges,
    references: referenceProfiles,
  };
}

/**
 * Computes cosine similarity between two dense embedding vectors.
 */
function denseCosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return null;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'was', 'were', 'are', 'has', 'had', 'have',
  'patient', 'presents', 'context', 'weeks', 'gestation',
]);

/**
 * Deterministic clinical unigram + bigram cosine similarity on standardized narratives
 * when dense embeddings are not present.
 */
function narrativeTextCosineSimilarity(textA, textB) {
  const tok = (str) => {
    const words = String(str || '')
      .toLowerCase()
      .replace(/[^a-z0-9+_-]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    const grams = [...words];
    for (let i = 0; i < words.length - 1; i++) {
      grams.push(`${words[i]}_${words[i + 1]}`);
    }
    return grams;
  };

  const tokensA = tok(textA);
  const tokensB = tok(textB);
  if (tokensA.length === 0 || tokensB.length === 0) return null;

  const freqA = new Map();
  const freqB = new Map();
  for (const t of tokensA) freqA.set(t, (freqA.get(t) || 0) + 1);
  for (const t of tokensB) freqB.set(t, (freqB.get(t) || 0) + 1);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, countA] of freqA.entries()) {
    normA += countA * countA;
    if (freqB.has(k)) {
      dot += countA * freqB.get(k);
    }
  }
  for (const countB of freqB.values()) {
    normB += countB * countB;
  }

  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

/**
 * Applies Bayesian Coverage Shrinkage:
 * S_shrunk = (W_compared * S_raw + K * S_0) / (W_compared + K)
 *
 * Ensures sparse historical records (low W_compared) cannot achieve 100% similarity
 * from a single lucky matching field.
 */
function applyBayesianShrinkage(rawSimilarity, comparedWeight, shrinkageK, priorS0) {
  if (rawSimilarity === null || comparedWeight <= 0) return null;
  return (comparedWeight * rawSimilarity + shrinkageK * priorS0) / (comparedWeight + shrinkageK);
}

/**
 * Resolves the custom base weight for a given symptom key, allowing per-request overrides
 * in `options.symptomItemWeights` or `options.featureWeights`.
 */
function resolveSymptomBaseWeight(symKey, symptomDefs = {}, options = {}) {
  const customSymWeights = options.symptomItemWeights || {};
  const customFeatureWeights = options.featureWeights || {};
  if (Number.isFinite(customSymWeights[symKey]) && customSymWeights[symKey] >= 0) {
    return Number(customSymWeights[symKey]);
  }
  if (Number.isFinite(customFeatureWeights[symKey]) && customFeatureWeights[symKey] >= 0) {
    return Number(customFeatureWeights[symKey]);
  }
  const defWeight = symptomDefs[symKey]?.weight;
  return Number.isFinite(defWeight) ? defWeight : config.symptomWeights.presentMatch;
}

/**
 * Scores similarity between a Query Patient ($A$) and a Historical Reference ($B$).
 *
 * Implements custom per-parameter & per-symptom weights and asymmetric missing-value handling:
 * - Features missing (`null`) in Query Patient $A$ have weight 0 in $A$'s similarity denominator,
 *   and if present in $B$, are recorded as `missingInQueryButPresentInRef` for unchecked-factor surfacing.
 * - Features present in Query Patient $A$ but missing (`null`) in Historical Candidate $B$
 *   reduce $B$'s `comparedWeight` (penalized via Bayesian Shrinkage $K$ and coverage ratio),
 *   and for active symptoms in $A$ that are unmentioned in $B$, add an explicit missing-in-candidate
 *   penalty weight (`baseSymptomWeight * presentVsMissingInCandidateMultiplier`).
 */
function scorePatientPair(cohortModel, queryProfile, referenceProfile, options = {}) {
  const featureDefs = cohortModel.featureDefs;
  const symptomDefs = cohortModel.symptomDefs || config.symptomDefinitions;
  const weightOverrides = options.featureWeights || {};
  const shrinkageK = options.shrinkageK ?? config.shrinkageStrengthK;
  const priorS0 = options.shrinkageS0 ?? config.shrinkagePriorS0;
  const symWeights = { ...config.symptomWeights, ...(options.symptomWeights || {}) };
  const sevMultipliers = { ...config.severityWeightMultipliers, ...(options.severityWeightMultipliers || {}) };

  const queryStruct = queryProfile.structured || {};
  const refStruct = referenceProfile.structured || {};

  // --- 1. Structured Numeric, Ordinal & Categorical Scoring ---
  let structComparedWeight = 0;
  let structTotalQueryWeight = 0;
  let structWeightedSum = 0;
  let structComparedCount = 0;
  let structQueryKnownCount = 0;

  const structuredDetails = [];
  const missingInCandidate = [];
  const missingInQueryButPresentInRef = [];

  for (const [key, def] of Object.entries(featureDefs)) {
    const weight =
      Number.isFinite(weightOverrides[key]) && weightOverrides[key] >= 0
        ? Number(weightOverrides[key])
        : def.weight;
    if (weight === 0) continue;

    const valA = queryStruct[key];
    const valB = refStruct[key];

    const hasA = valA !== undefined && valA !== null && valA !== '';
    const hasB = valB !== undefined && valB !== null && valB !== '';

    if (!hasA) {
      if (hasB) {
        missingInQueryButPresentInRef.push({
          featureKey: key,
          label: def.label || key,
          kind: 'structured',
          weight,
          referenceValue: valB,
          unit: def.unit || '',
        });
      }
      continue;
    }

    // Feature is known in Query Patient A
    structQueryKnownCount++;
    structTotalQueryWeight += weight;

    if (!hasB) {
      missingInCandidate.push({
        featureKey: key,
        label: def.label || key,
        kind: 'structured',
        queryValue: valA,
        unit: def.unit || '',
        weight,
        effect: 'unrecorded_in_historical_case_shrunk_by_coverage',
      });
      structuredDetails.push({
        featureKey: key,
        label: def.label || key,
        queryValue: valA,
        referenceValue: null,
        unit: def.unit || '',
        weight,
        similarity: null,
        status: 'missing_in_reference',
      });
      continue;
    }

    let sim = null;
    if (def.type === 'number') {
      const rangeObj = cohortModel.ranges[key];
      const span = rangeObj && rangeObj.span > 0 ? rangeObj.span : 0;
      if (span > 0) {
        sim = Math.max(0, 1 - Math.abs(Number(valA) - Number(valB)) / span);
      } else {
        sim = Number(valA) === Number(valB) ? 1 : 0;
      }
    } else if (def.type === 'ordinal' && Array.isArray(def.order)) {
      const idxA = def.order.indexOf(String(valA).toLowerCase());
      const idxB = def.order.indexOf(String(valB).toLowerCase());
      if (idxA >= 0 && idxB >= 0) {
        const maxSpan = Math.max(1, def.order.length - 1);
        sim = Math.max(0, 1 - Math.abs(idxA - idxB) / maxSpan);
      } else {
        sim = String(valA).toLowerCase() === String(valB).toLowerCase() ? 1 : 0;
      }
    } else {
      sim = String(valA).toLowerCase() === String(valB).toLowerCase() ? 1 : 0;
    }

    structComparedCount++;
    structComparedWeight += weight;
    structWeightedSum += weight * sim;

    structuredDetails.push({
      featureKey: key,
      label: def.label || key,
      queryValue: valA,
      referenceValue: valB,
      unit: def.unit || '',
      weight,
      similarity: Math.round(sim * 1000) / 1000,
      status: sim >= 0.75 ? 'matched' : sim >= 0.4 ? 'partial' : 'divergent',
    });
  }

  const structRawSimilarity = structComparedWeight > 0 ? structWeightedSum / structComparedWeight : null;
  const structCoverage = structTotalQueryWeight > 0 ? structComparedWeight / structTotalQueryWeight : 0;
  // Combine coverage ratio and Bayesian shrinkage so missing candidate labs are penalized smoothly
  const structShrunk =
    structRawSimilarity === null
      ? null
      : applyBayesianShrinkage(
          structRawSimilarity * (0.5 + 0.5 * structCoverage),
          structComparedWeight,
          shrinkageK,
          priorS0
        );

  // --- 2. Asymmetric Symptom & Phenotype Scoring (Per-Symptom Custom Weight + Severity Multiplier) ---
  const querySym = queryProfile.symptoms || {};
  const refSym = referenceProfile.symptoms || {};
  const allSymptomKeys = new Set([...Object.keys(querySym), ...Object.keys(refSym)]);

  let symActiveWeight = 0;
  let symWeightedSum = 0;
  const symptomDetails = [];

  for (const symKey of allSymptomKeys) {
    const qItem = querySym[symKey] || null;
    const rItem = refSym[symKey] || null;
    const baseWeight = resolveSymptomBaseWeight(symKey, symptomDefs, options);
    if (baseWeight === 0) continue;
    const symLabel = symptomDefs[symKey]?.label || symKey.replaceAll('_', ' ');

    if (!qItem && rItem) {
      // Missing (not asked / not reported) in Query Patient A, but recorded in Historical Patient B
      if (rItem.status === 'present') {
        missingInQueryButPresentInRef.push({
          featureKey: symKey,
          label: symLabel,
          kind: 'symptom',
          weight: baseWeight,
          referenceValue: `present (${rItem.severity || 'unspecified'})`,
          unit: '',
        });
      }
      continue;
    }

    const sevMultiplier = sevMultipliers[qItem.severity] || 1.0;

    if (qItem.status === 'present') {
      if (rItem && rItem.status === 'present') {
        // Both patients actively have this symptom
        const w = Math.round(baseWeight * sevMultiplier * symWeights.presentMatchMultiplier * 100) / 100;
        const sevMatch =
          qItem.severity === 'unspecified' ||
          rItem.severity === 'unspecified' ||
          qItem.severity === rItem.severity
            ? symWeights.severityExactBonus
            : symWeights.severityPartialFactor;
        symActiveWeight += w;
        symWeightedSum += w * sevMatch;
        symptomDetails.push({
          symptomKey: symKey,
          label: symLabel,
          queryStatus: 'present',
          querySeverity: qItem.severity,
          referenceStatus: 'present',
          referenceSeverity: rItem.severity,
          baseWeight,
          weight: w,
          similarity: sevMatch,
          matchType: 'shared_present_symptom',
          citedSegmentIds: qItem.cited_segment_ids || [],
        });
      } else if (rItem && rItem.status === 'absent') {
        // Explicit contradiction: present in A, explicitly denied in B
        const w = Math.round(baseWeight * sevMultiplier * symWeights.presentVsAbsentConflictMultiplier * 100) / 100;
        symActiveWeight += w;
        symptomDetails.push({
          symptomKey: symKey,
          label: symLabel,
          queryStatus: 'present',
          querySeverity: qItem.severity,
          referenceStatus: 'absent',
          baseWeight,
          weight: w,
          similarity: 0,
          matchType: 'present_vs_absent_conflict',
          citedSegmentIds: qItem.cited_segment_ids || [],
        });
      } else {
        // Present in A, unmentioned (null) in B -> moderate penalty weight scaled by symptom's custom weight
        const w =
          Math.round(baseWeight * sevMultiplier * symWeights.presentVsMissingInCandidateMultiplier * 100) / 100;
        symActiveWeight += w;
        missingInCandidate.push({
          featureKey: symKey,
          label: symLabel,
          kind: 'symptom',
          queryValue: 'present',
          weight: w,
          effect: 'active_symptom_unmentioned_in_historical_case',
        });
        symptomDetails.push({
          symptomKey: symKey,
          label: symLabel,
          queryStatus: 'present',
          querySeverity: qItem.severity,
          referenceStatus: null,
          baseWeight,
          weight: w,
          similarity: 0,
          matchType: 'present_in_query_unmentioned_in_reference',
          citedSegmentIds: qItem.cited_segment_ids || [],
        });
      }
    } else if (qItem.status === 'absent') {
      if (rItem && rItem.status === 'absent') {
        // Shared pertinent negative (scaled by symptom's custom baseWeight * absentMatchPertinentNegativeMultiplier)
        const w = Math.round(baseWeight * symWeights.absentMatchPertinentNegativeMultiplier * 100) / 100;
        symActiveWeight += w;
        symWeightedSum += w * 1.0;
        symptomDetails.push({
          symptomKey: symKey,
          label: symLabel,
          queryStatus: 'absent',
          referenceStatus: 'absent',
          baseWeight,
          weight: w,
          similarity: 1.0,
          matchType: 'shared_pertinent_negative',
          citedSegmentIds: qItem.cited_segment_ids || [],
        });
      } else if (rItem && rItem.status === 'present') {
        // Explicitly denied in A, but actively present in B -> contradiction scaled by rItem's severity & baseWeight
        const refSevMult = sevMultipliers[rItem.severity] || 1.0;
        const w =
          Math.round(baseWeight * refSevMult * symWeights.presentVsAbsentConflictMultiplier * 100) / 100;
        symActiveWeight += w;
        symptomDetails.push({
          symptomKey: symKey,
          label: symLabel,
          queryStatus: 'absent',
          referenceStatus: 'present',
          referenceSeverity: rItem.severity,
          baseWeight,
          weight: w,
          similarity: 0,
          matchType: 'absent_vs_present_conflict',
          citedSegmentIds: qItem.cited_segment_ids || [],
        });
      }
      // Note: When qItem.status === 'absent' and rItem is null (unmentioned in B),
      // effective weight is 0.0 (silence in B's transcript is consistent with absence).
    }
  }

  const symRawSimilarity = symActiveWeight > 0 ? symWeightedSum / symActiveWeight : null;
  const symShrunk =
    symRawSimilarity === null
      ? null
      : applyBayesianShrinkage(symRawSimilarity, symActiveWeight, Math.min(2.5, shrinkageK * 0.5), priorS0);

  // --- 3. Semantic Clinical Narrative Similarity ---
  let narrativeSimilarity = denseCosineSimilarity(queryProfile.embedding, referenceProfile.embedding);
  let narrativeMethod = 'dense_embedding_cosine';
  if (narrativeSimilarity === null) {
    narrativeSimilarity = narrativeTextCosineSimilarity(
      queryProfile.standardizedNarrative,
      referenceProfile.standardizedNarrative
    );
    narrativeMethod = 'clinical_ngram_cosine';
  }

  // --- 4. Dynamic Modality Fusion (Redistributes weight if a modality has no inputs) ---
  const alpha = options.alphaStructured ?? config.alphaStructured;
  const beta = options.betaSymptoms ?? config.betaSymptoms;
  const gamma = options.gammaNarrative ?? config.gammaNarrative;

  let activeWeightSum = 0;
  let compositeSum = 0;

  if (structShrunk !== null) {
    activeWeightSum += alpha;
    compositeSum += alpha * structShrunk;
  }
  if (symShrunk !== null) {
    activeWeightSum += beta;
    compositeSum += beta * symShrunk;
  }
  if (narrativeSimilarity !== null) {
    activeWeightSum += gamma;
    compositeSum += gamma * narrativeSimilarity;
  }

  const compositeSimilarity = activeWeightSum > 0 ? compositeSum / activeWeightSum : 0;

  // Build human-readable match reasons for doctors & audit table (`pregnancy_cohort_members.match_reasons`)
  const matchedFactors = [
    ...structuredDetails
      .filter((d) => d.status === 'matched')
      .sort((a, b) => b.weight * b.similarity - a.weight * a.similarity)
      .map((d) => ({
        type: 'structured',
        feature: d.featureKey,
        label: d.label,
        weight: d.weight,
        queryValue: `${d.queryValue}${d.unit ? ' ' + d.unit : ''}`,
        referenceValue: `${d.referenceValue}${d.unit ? ' ' + d.unit : ''}`,
        similarity: d.similarity,
      })),
    ...symptomDetails
      .filter((s) => s.similarity > 0)
      .sort((a, b) => b.weight - a.weight)
      .map((s) => ({
        type: s.matchType === 'shared_present_symptom' ? 'symptom_present' : 'pertinent_negative',
        feature: s.symptomKey,
        label: s.label,
        weight: s.weight,
        queryValue: s.queryStatus === 'present' ? `present (${s.querySeverity})` : 'absent',
        referenceValue: s.referenceStatus === 'present' ? `present (${s.referenceSeverity})` : 'absent',
        similarity: s.similarity,
        citedSegmentIds: s.citedSegmentIds,
      })),
  ];

  const conflictingFactors = [
    ...structuredDetails
      .filter((d) => d.status === 'divergent')
      .map((d) => ({
        type: 'structured_divergent',
        feature: d.featureKey,
        label: d.label,
        weight: d.weight,
        queryValue: d.queryValue,
        referenceValue: d.referenceValue,
        similarity: d.similarity,
      })),
    ...symptomDetails
      .filter((s) => s.similarity === 0)
      .map((s) => ({
        type: s.matchType,
        feature: s.symptomKey,
        label: s.label,
        weight: s.weight,
        queryValue: s.queryStatus,
        referenceValue: s.referenceStatus ?? 'unmentioned',
      })),
  ];

  return {
    episodeId: referenceProfile.id,
    caseLabel: referenceProfile.label || referenceProfile.id,
    archetype: referenceProfile.archetype || null,
    similarityScore: Math.round(compositeSimilarity * 1000) / 1000,
    similarityPercent: Math.round(compositeSimilarity * 100),
    subScores: {
      structuredRaw: structRawSimilarity !== null ? Math.round(structRawSimilarity * 1000) / 1000 : null,
      structuredShrunk: structShrunk !== null ? Math.round(structShrunk * 1000) / 1000 : null,
      symptomRaw: symRawSimilarity !== null ? Math.round(symRawSimilarity * 1000) / 1000 : null,
      symptomShrunk: symShrunk !== null ? Math.round(symShrunk * 1000) / 1000 : null,
      narrativeCosine: narrativeSimilarity !== null ? Math.round(narrativeSimilarity * 1000) / 1000 : null,
      narrativeMethod,
    },
    coverage: {
      structuredComparedCount: structComparedCount,
      structuredQueryKnownCount: structQueryKnownCount,
      structuredCoverageRatio: Math.round(structCoverage * 1000) / 1000,
      structuredComparedWeight: Math.round(structComparedWeight * 100) / 100,
      symptomActiveWeight: Math.round(symActiveWeight * 100) / 100,
    },
    matchedFactors,
    conflictingFactors,
    missingInCandidate,
    missingInQueryButPresentInRef,
    detailedBreakdown: {
      structured: structuredDetails,
      symptoms: symptomDetails,
    },
    historicalSnapshot: {
      structured: referenceProfile.structured,
      symptoms: referenceProfile.extractedSymptomsList,
      standardizedNarrative: referenceProfile.standardizedNarrative,
    },
    clinicalProgression: {
      progressionSummary: referenceProfile.progressionSummary || null,
      subsequentVisits: referenceProfile.subsequentVisits || [],
      interventionsRecorded: referenceProfile.interventionsRecorded || [],
      deliveryOutcome: referenceProfile.deliveryOutcome || null,
    },
  };
}

/**
 * Ranks a cohort of historical patient profiles against a query profile,
 * surfaces top-K matches, and aggregates unchecked factors in the query patient.
 */
function rankCohortMatches(cohortModel, queryProfile, options = {}) {
  const topK = Math.min(options.topK || config.defaultTopK, config.maxTopK);
  const gestWindow = options.gestationalWindowWeeks ?? config.defaultGestationalWindowWeeks;
  const queryWeeks = queryProfile.structured?.gestational_weeks;

  // Stage A: Optional Gestational Window Filter (unless disabled or query has no gestational_weeks)
  const eligibleReferences = cohortModel.references.filter((ref) => {
    if (ref.id && queryProfile.id && ref.id === queryProfile.id) return false; // Exclude self
    if (options.disableGestationalFilter || queryWeeks === undefined || queryWeeks === null) return true;
    const refWeeks = ref.structured?.gestational_weeks;
    if (refWeeks === undefined || refWeeks === null) return true;
    return Math.abs(Number(queryWeeks) - Number(refWeeks)) <= gestWindow;
  });

  // Fallback to all references if gestational window was too narrow
  const pool = eligibleReferences.length > 0 ? eligibleReferences : cohortModel.references;

  const scored = pool
    .map((ref) => scorePatientPair(cohortModel, queryProfile, ref, options))
    .sort(
      (a, b) =>
        b.similarityScore - a.similarityScore ||
        b.coverage.structuredComparedWeight - a.coverage.structuredComparedWeight ||
        String(a.episodeId || '').localeCompare(String(b.episodeId || ''))
    );

  const topMatches = scored.slice(0, topK);

  // Aggregate Unchecked Factors in Query Patient across Top-K matches (sorted by prevalence * weight)
  const uncheckedCounts = new Map();
  for (const match of topMatches) {
    for (const item of match.missingInQueryButPresentInRef || []) {
      const entry = uncheckedCounts.get(item.featureKey) || {
        featureKey: item.featureKey,
        label: item.label,
        kind: item.kind,
        weight: item.weight || 1.0,
        presentInTopKCount: 0,
        sampleValuesInSimilarCases: [],
      };
      entry.presentInTopKCount++;
      const formattedVal = `${item.referenceValue}${item.unit ? ' ' + item.unit : ''}`;
      if (entry.sampleValuesInSimilarCases.length < 3 && !entry.sampleValuesInSimilarCases.includes(formattedVal)) {
        entry.sampleValuesInSimilarCases.push(formattedVal);
      }
      uncheckedCounts.set(item.featureKey, entry);
    }
  }

  const uncheckedFactorsInQuery = [...uncheckedCounts.values()]
    .filter((u) => u.presentInTopKCount >= 1)
    .sort((a, b) => b.presentInTopKCount * b.weight - a.presentInTopKCount * a.weight);

  return {
    modelVersion: cohortModel.version,
    totalCandidatesEvaluated: pool.length,
    gestationalWindowWeeksUsed:
      queryWeeks !== undefined && !options.disableGestationalFilter ? gestWindow : null,
    topMatches,
    uncheckedFactorsInQuery,
  };
}

module.exports = {
  fitPatientCohortModel,
  denseCosineSimilarity,
  narrativeTextCosineSimilarity,
  applyBayesianShrinkage,
  resolveSymptomBaseWeight,
  scorePatientPair,
  rankCohortMatches,
};
