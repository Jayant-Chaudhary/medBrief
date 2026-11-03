/**
 * Public Maternal Dataset Importer & Converter CLI
 *
 * Converts open public datasets (UCI Maternal Health Risk CSV and MTS-Dialog / ACI-Bench
 * consultation dialogue CSV) into MedBrief's Patient Similarity JSON schema.
 *
 * Usage:
 *   node scripts/importPublicMaternalDataset.js
 *   node scripts/importPublicMaternalDataset.js --uci-csv=/path/to/MaternalHealthRisk.csv --mts-csv=/path/to/MTS-Dialog.csv
 *   node scripts/importPublicMaternalDataset.js --fetch-uci
 */

const fs = require('fs');
const path = require('path');
require('../src/config/env');
const {
  parseCsvRecords,
  adaptPublicDatasetBatch,
  PUBLIC_FORMAT_SAMPLE_CSV,
} = require('../src/services/patientSimilarity/publicDatasetAdapter');
const { evaluateDirectSimilarity } = require('../src/services/patientSimilarity/patientSimilarity.service');
const { SAMPLE_DEMO_QUERIES } = require('../src/services/patientSimilarity/syntheticCohort.fixtures');

const UCI_DATASET_URL =
  'https://archive.ics.uci.edu/ml/machine-learning-databases/00639/Maternal%20Health%20Risk%20Data%20Set.csv';

async function loadUciCsvText() {
  const fileArg = process.argv.find((a) => a.startsWith('--uci-csv='))?.split('=')[1];
  if (fileArg) {
    return fs.readFileSync(path.resolve(fileArg), 'utf8');
  }
  if (process.argv.includes('--fetch-uci')) {
    try {
      const res = await fetch(UCI_DATASET_URL);
      if (res.ok) {
        return await res.text();
      }
    } catch {
      console.warn('Could not reach UCI ML repository over network; using built-in UCI-format sample CSV.');
    }
  }
  return PUBLIC_FORMAT_SAMPLE_CSV.uciMaternalCsv;
}

function loadMtsCsvText() {
  const fileArg = process.argv.find((a) => a.startsWith('--mts-csv='))?.split('=')[1];
  if (fileArg) {
    return fs.readFileSync(path.resolve(fileArg), 'utf8');
  }
  return PUBLIC_FORMAT_SAMPLE_CSV.mtsDialogCsv;
}

async function main() {
  console.log('================================================================================');
  console.log(' MEDBRIEF — PUBLIC DATASET ADAPTER (UCI MATERNAL + MTS-DIALOG FORMAT)');
  console.log('================================================================================\n');

  const uciCsv = await loadUciCsvText();
  const mtsCsv = loadMtsCsvText();

  const uciRows = parseCsvRecords(uciCsv);
  const dialogueRows = parseCsvRecords(mtsCsv);

  const adaptedCohort = adaptPublicDatasetBatch({ uciRows, dialogueRows });

  console.log(`[1] Adapted ${adaptedCohort.length} records from UCI Maternal + MTS-Dialog formats.`);
  console.log('    Sample Adapted Record #1:');
  console.log('   ', JSON.stringify(adaptedCohort[0], null, 2).split('\n').join('\n    '));

  const evalRes = await evaluateDirectSimilarity({
    queryPatient: SAMPLE_DEMO_QUERIES.elevatedBpAndHeadacheScenario.queryPatient,
    referenceCohort: adaptedCohort,
    options: { topK: 3, extractorProvider: 'fake' },
  });

  console.log('\n[2] Similarity Search Against Adapted Public-Format Cohort:');
  for (const [idx, m] of evalRes.topMatches.entries()) {
    console.log(
      `    #${idx + 1} ${m.caseLabel} -> Score: ${m.similarityPercent}% (${m.similarityScore}) | Matched: ${m.matchedFactors.map((f) => `${f.label}[w=${f.weight}]`).join(', ')}`
    );
  }
  console.log('\n================================================================================');
}

main().catch((err) => {
  console.error('Importer failed:', err.message);
  process.exit(1);
});
