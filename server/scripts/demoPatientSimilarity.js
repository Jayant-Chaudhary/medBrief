/**
 * Patient Similarity Model — Interactive Demo & Smoke Script
 *
 * Runs the production Patient Similarity pipeline (including Gemini API if GEMINI_API_KEY
 * is set in .env, or falling back gracefully) on synthetic maternal health scenarios
 * and prints the extracted features, missing-value handling, and ranked cohort matches.
 *
 * Usage:
 *   node scripts/demoPatientSimilarity.js
 *   node scripts/demoPatientSimilarity.js --provider=gemini
 *   node scripts/demoPatientSimilarity.js --provider=fake
 */

require('../src/config/env');
const { evaluateDirectSimilarity } = require('../src/services/patientSimilarity/patientSimilarity.service');
const { SAMPLE_DEMO_QUERIES } = require('../src/services/patientSimilarity/syntheticCohort.fixtures');

async function main() {
  const providerArg = process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1] || undefined;

  console.log('================================================================================');
  console.log(' MEDBRIEF — PATIENT SIMILARITY MODEL DEMO (SYNTHETIC COHORT)');
  console.log('================================================================================\n');

  for (const [scenarioKey, scenario] of Object.entries(SAMPLE_DEMO_QUERIES)) {
    console.log(`>>> SCENARIO: ${scenarioKey}`);
    console.log(`    ${scenario.description}\n`);

    const result = await evaluateDirectSimilarity({
      queryPatient: scenario.queryPatient,
      options: {
        topK: 4,
        ...(providerArg ? { extractorProvider: providerArg } : {}),
      },
    });

    console.log(
      `[1] EXTRACTION SUMMARY (providerRequested=${result.extractedQueryProfile.extractionMeta.providerRequested}, providerUsed=${result.extractedQueryProfile.extractionMeta.providerUsed}, latency=${result.latencyMs}ms)`
    );
    console.log('    Structured Features & Deltas:', JSON.stringify(result.extractedQueryProfile.structured));
    console.log(
      '    Extracted Symptoms (Pre-Visit + Transcript):',
      result.extractedQueryProfile.extractedSymptoms
        .map(
          (s) =>
            `${s.symptom_key}:${s.status}${s.severity !== 'unspecified' ? `(${s.severity})` : ''}[${s.source}${s.cited_segment_ids.length ? ':' + s.cited_segment_ids.join(',') : ''}]`
        )
        .join(', ')
    );
    console.log(`    Standardized Narrative: "${result.extractedQueryProfile.standardizedNarrative}"\n`);

    console.log('[2] TOP SIMILAR HISTORICAL CASES:');
    for (const [idx, m] of result.topMatches.entries()) {
      console.log(
        `    #${idx + 1} ${m.caseLabel} -> Score: ${m.similarityPercent}% (${m.similarityScore}) | SubScores: [Struct=${m.subScores.structuredShrunk}, Sym=${m.subScores.symptomShrunk}, Narr=${m.subScores.narrativeCosine}] | Coverage: ${m.coverage.structuredComparedCount}/${m.coverage.structuredQueryKnownCount}`
      );
      console.log(
        `       Matched Factors: ${m.matchedFactors.map((f) => `${f.label} (${f.queryValue} vs ${f.referenceValue})`).join(' | ')}`
      );
      if (m.clinicalProgression?.progressionSummary) {
        console.log(`       Progression: ${m.clinicalProgression.progressionSummary}`);
      }
      if (m.clinicalProgression?.deliveryOutcome) {
        const d = m.clinicalProgression.deliveryOutcome;
        console.log(
          `       Delivery Outcome: ${d.deliveryType} at ${d.deliveredAtWeeks}w (Baby: ${d.babyWeightKg}kg, APGAR: ${d.apgar1Min}/${d.apgar5Min})`
        );
      }
    }

    console.log('\n[3] UNCHECKED FACTORS IN QUERY PATIENT (Missing in current visit, present in top matches):');
    for (const u of result.uncheckedFactorsInQuery.slice(0, 5)) {
      console.log(
        `    - ${u.label} (${u.featureKey}): recorded in ${u.presentInTopKCount}/${result.topMatches.length} similar cases (e.g. ${u.sampleValuesInSimilarCases.join(', ')})`
      );
    }
    console.log('\n--------------------------------------------------------------------------------\n');
  }
}

main().catch((err) => {
  console.error('Demo script failed:', err.message);
  process.exit(1);
});
