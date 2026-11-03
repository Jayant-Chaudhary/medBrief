/**
 * Patient Similarity Model — Large-Scale Synthea-Style Cohort Benchmark CLI
 *
 * Evaluates:
 * 1. Custom Per-Parameter & Per-Symptom Edge Weights
 * 2. Leave-One-Out Retrieval Accuracy across 111 Longitudinal Maternal Cases
 *    (100 Synthea-style generated + 11 curated across 7 clinical archetypes)
 * 3. Sparse-Record Top-3 Rejection Rate (Bayesian Shrinkage verification)
 * 4. Custom Weight Override Sensitivity Demo
 *
 * Usage:
 *   node scripts/benchmarkPatientSimilarity.js
 *   node scripts/benchmarkPatientSimilarity.js --size=150
 */

require('../src/config/env');
const {
  getWeightsCatalog,
  runCohortBenchmark,
  evaluateDirectSimilarity,
} = require('../src/services/patientSimilarity/patientSimilarity.service');
const { SAMPLE_DEMO_QUERIES } = require('../src/services/patientSimilarity/syntheticCohort.fixtures');

async function main() {
  const sizeArg = Number(process.argv.find((a) => a.startsWith('--size='))?.split('=')[1]) || 100;

  console.log('================================================================================');
  console.log(' MEDBRIEF — PATIENT SIMILARITY MODEL BENCHMARK & CUSTOM WEIGHTS REPORT');
  console.log('================================================================================\n');

  const weightsCatalog = getWeightsCatalog();
  console.log('[1] CONFIGURED CUSTOM EDGE WEIGHTS:');
  console.log(
    '    Structured Parameters:',
    Object.entries(weightsCatalog.structuredParameterWeights)
      .map(([k, v]) => `${k}=${v.weight}`)
      .join(', ')
  );
  console.log(
    '    Symptom Parameters:   ',
    Object.entries(weightsCatalog.symptomParameterWeights)
      .map(([k, v]) => `${k}=${v.weight}(${v.tier})`)
      .join(', ')
  );
  console.log('    Severity Multipliers: ', JSON.stringify(weightsCatalog.severityWeightMultipliers));
  console.log('    Modality Weights:     ', JSON.stringify(weightsCatalog.modalityFusionWeights), '\n');

  console.log(`[2] RUNNING LEAVE-ONE-OUT BENCHMARK (Generated N=${sizeArg} + 11 Curated)...`);
  const bench = await runCohortBenchmark({ cohortSize: sizeArg });

  console.log(`    Total Cohort Evaluated:         ${bench.totalCohortSize} episodes (${bench.sparseControlsCount} sparse controls)`);
  console.log(`    Clinical Queries Evaluated:     ${bench.clinicalQueriesEvaluated}`);
  console.log(`    Execution Time:                 ${bench.latencyMs} ms`);
  console.log(`    Top-1 Archetype Hit Rate:       ${(bench.metrics.top1ArchetypeHitRate * 100).toFixed(1)}%`);
  console.log(`    Top-3 Archetype Hit Rate:       ${(bench.metrics.top3ArchetypeHitRate * 100).toFixed(1)}%`);
  console.log(`    Top-5 Archetype Hit Rate:       ${(bench.metrics.top5ArchetypeHitRate * 100).toFixed(1)}%`);
  console.log(
    `    Sparse-Record Top-3 Leak Rate:  ${(bench.metrics.sparseRecordTop3ContaminationRate * 100).toFixed(1)}% (Target: 0.0%)`
  );
  console.log(
    `    Transcript Negation Accuracy:   ${(bench.metrics.transcriptNegationAccuracy * 100).toFixed(1)}%\n`
  );

  console.log('    Per-Archetype Breakdown:');
  for (const [arch, stats] of Object.entries(bench.perArchetypeBreakdown)) {
    console.log(
      `      - ${arch.padEnd(26)} (n=${String(stats.queriesEvaluated).padStart(2)}): Top-1=${(stats.top1HitRate * 100).toFixed(1)}% | Top-3=${(stats.top3HitRate * 100).toFixed(1)}% | Top-5=${(stats.top5HitRate * 100).toFixed(1)}%`
    );
  }

  console.log('\n[3] CUSTOM WEIGHT OVERRIDE DEMO (Testing on Hybrid 116-Case Cohort):');
  const customEval = await evaluateDirectSimilarity({
    queryPatient: SAMPLE_DEMO_QUERIES.elevatedBpAndHeadacheScenario.queryPatient,
    options: {
      cohortSource: 'hybrid',
      generatedCount: 100,
      topK: 3,
      extractorProvider: 'fake',
      featureWeights: {
        bp_systolic: 4.0,
        bp_diastolic: 4.0,
        bp_systolic_delta: 3.0,
        blood_group: 0.1,
      },
      symptomItemWeights: {
        headache: 3.8,
        pedal_edema: 3.2,
      },
    },
  });

  console.log(
    `    Evaluated ${customEval.rankingMeta.totalCandidatesEvaluated} hybrid candidates with custom weights:`
  );
  for (const [i, match] of customEval.topMatches.entries()) {
    console.log(
      `    #${i + 1} ${match.caseLabel} [archetype=${match.archetype}] -> Score: ${match.similarityPercent}% (${match.similarityScore})`
    );
    console.log(
      `       Top Weighted Matches: ${match.matchedFactors
        .slice(0, 5)
        .map((f) => `${f.label}[w=${f.weight}, sim=${f.similarity}]`)
        .join(' | ')}`
    );
  }
  console.log('\n================================================================================');
}

main().catch((err) => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
