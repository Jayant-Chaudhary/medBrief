/**
 * Public Dataset Adapter for Patient Similarity Benchmarking.
 *
 * Adapts open clinical & maternal health dataset formats into MedBrief's
 * unified Patient Similarity input schema:
 * 1. UCI Maternal Health Risk Dataset (tabular vitals/glucose: Age, SystolicBP,
 *    DiastolicBP, BS in mmol/L, BodyTemp, HeartRate).
 *    - Converts BS (mmol/L) -> fasting_glucose (mg/dL) via factor 18.018 when < 35.
 *    - Strips `RiskLevel` so zero diagnostic labels enter the platform (AGENTS.md).
 * 2. MTS-Dialog / ACI-Bench / PriMock57 Consultation Dialogue format
 *    (multi-turn `Doctor: ... / Patient: ...` dialogue strings + clinical section notes).
 *
 * Safety & Privacy (AGENTS.md):
 * - Never imports diagnostic target labels (`RiskLevel`, ICD diagnoses).
 * - Built-in sample records are 100% synthetic representations of public schemas.
 */

const MMOLL_TO_MGDL = 18.018;

/**
 * RFC-4180 compatible CSV parser (handles quoted fields containing commas and newlines).
 *
 * @param {string} csvText
 * @returns {Array<Object<string, string>>}
 */
function parseCsvRecords(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      if (ch === '\r') i++;
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell !== '')) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.replace(/^["']|["']$/g, '').trim());

  return rows.slice(1).map((cells) => {
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = cells[c] ?? '';
    }
    return obj;
  });
}

/**
 * Converts a single row from the UCI Maternal Health Risk Dataset
 * (`Age,SystolicBP,DiastolicBP,BS,BodyTemp,HeartRate,RiskLevel`)
 * into a MedBrief structured patient snapshot.
 *
 * Note: `RiskLevel` is intentionally discarded (AGENTS.md: never state or import diagnoses).
 *
 * @param {Object} rawRow
 * @param {number} [index=0]
 * @returns {Object} Normalized patient record
 */
function adaptUciMaternalRow(rawRow = {}, index = 0) {
  const getCaseInsensitive = (keys) => {
    for (const k of Object.keys(rawRow)) {
      if (keys.includes(k.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        return rawRow[k];
      }
    }
    return undefined;
  };

  const age = Number(getCaseInsensitive(['age']));
  const sysBp = Number(getCaseInsensitive(['systolicbp', 'sbp', 'bpsystolic']));
  const diaBp = Number(getCaseInsensitive(['diastolicbp', 'dbp', 'bpdiastolic']));
  const bsRaw = Number(getCaseInsensitive(['bs', 'bloodsugar', 'bloodglucose', 'glucose']));
  const heartRate = Number(getCaseInsensitive(['heartrate', 'hr', 'pulse']));
  const gestWeeks = Number(getCaseInsensitive(['gestationalweeks', 'weeks']));

  // UCI BS is in mmol/L (typically 6.0 to 19.0). Convert to mg/dL if < 35.
  let fastingGlucoseMgDl = null;
  if (Number.isFinite(bsRaw) && bsRaw > 0) {
    fastingGlucoseMgDl = bsRaw < 35 ? Math.round(bsRaw * MMOLL_TO_MGDL) : Math.round(bsRaw);
  }

  const vitals = {};
  if (Number.isFinite(sysBp) && sysBp > 0) vitals.bp_systolic = sysBp;
  if (Number.isFinite(diaBp) && diaBp > 0) vitals.bp_diastolic = diaBp;

  const labs = {};
  if (fastingGlucoseMgDl !== null) labs.fasting_glucose = fastingGlucoseMgDl;

  return {
    id: rawRow.id || `uci-mat-${String(index + 1).padStart(4, '0')}`,
    label:
      rawRow.label ||
      `UCI-Maternal-${String(index + 1).padStart(4, '0')} (Age ${Number.isFinite(age) ? age : '?'}, BP ${vitals.bp_systolic ?? '?'}/${vitals.bp_diastolic ?? '?'}, Glucose ${fastingGlucoseMgDl ?? '?'} mg/dL)`,
    sourceDataset: 'uci_maternal_health_format',
    gestationalWeeks: Number.isFinite(gestWeeks) && gestWeeks > 0 ? gestWeeks : 28,
    age: Number.isFinite(age) && age > 0 ? age : undefined,
    vitals,
    labs,
    metadata: {
      originalBsMmolL: Number.isFinite(bsRaw) && bsRaw < 35 ? bsRaw : null,
      maternalHeartRateBpm: Number.isFinite(heartRate) && heartRate > 0 ? heartRate : null,
    },
    transcriptSegments: [],
  };
}

/**
 * Parses a multi-turn clinical conversation string (MTS-Dialog / ACI-Bench / PriMock57 format)
 * into MedBrief's speaker-diarized `transcriptSegments` array.
 *
 * Recognizes speaker prefixes such as:
 *   "Doctor: ...", "Physician: ...", "Clinician: ...", "D: ...", "[doctor]"
 *   "Patient: ...", "Pt: ...", "P: ...", "[patient]"
 *
 * @param {string} dialogueText
 * @param {string} [idPrefix='mts']
 * @returns {Array<{ segment_id: string, speaker: 'doctor' | 'patient', text: string }>}
 */
function adaptDialogueTextToSegments(dialogueText, idPrefix = 'mts') {
  if (!dialogueText || typeof dialogueText !== 'string') return [];

  const normalized = dialogueText.replace(/\\n/g, '\n');
  const lines = normalized
    .split(/\r?\n|(?=\b(?:Doctor|Physician|Clinician|Patient|Pt)\s*:)/i)
    .map((l) => l.trim())
    .filter(Boolean);

  const segments = [];
  let currentSpeaker = 'patient';

  for (const line of lines) {
    const docMatch = /^(?:\[?(?:doctor|physician|clinician|dr|d)\]?\s*[:\-])\s*(.+)$/i.exec(line);
    const patMatch = /^(?:\[?(?:patient|pt|p|mother)\]?\s*[:\-])\s*(.+)$/i.exec(line);

    let text = line;
    if (docMatch) {
      currentSpeaker = 'doctor';
      text = docMatch[1].trim();
    } else if (patMatch) {
      currentSpeaker = 'patient';
      text = patMatch[1].trim();
    }

    if (text) {
      segments.push({
        segment_id: `${idPrefix}_seg_${segments.length + 1}`,
        speaker: currentSpeaker,
        text,
      });
    }
  }

  return segments;
}

/**
 * Adapts a batch of UCI-format rows and optional MTS-Dialog-format rows into
 * MedBrief patient similarity records.
 */
function adaptPublicDatasetBatch({ uciRows = [], dialogueRows = [] } = {}) {
  const adapted = uciRows.map((row, idx) => adaptUciMaternalRow(row, idx));

  for (let i = 0; i < dialogueRows.length; i++) {
    const dRow = dialogueRows[i] || {};
    const dialogueStr = dRow.dialogue || dRow.transcript || dRow.conversation || '';
    const noteStr = dRow.section_text || dRow.note || dRow.summary || '';
    const segments = adaptDialogueTextToSegments(dialogueStr, `mts_${i + 1}`);

    if (i < adapted.length) {
      adapted[i].transcriptSegments = segments;
      if (noteStr) adapted[i].preVisitNotes = String(noteStr).trim();
    } else {
      adapted.push({
        id: dRow.id || `mts-dialog-${String(i + 1).padStart(4, '0')}`,
        label: dRow.label || `MTS-Dialog-${String(i + 1).padStart(4, '0')}`,
        sourceDataset: 'mts_dialog_format',
        gestationalWeeks: Number(dRow.gestationalWeeks) || 28,
        vitals: {},
        labs: {},
        preVisitNotes: String(noteStr).trim(),
        transcriptSegments: segments,
      });
    }
  }

  return adapted;
}

/**
 * Built-in synthetic benchmark samples formatted in exact UCI Maternal Health Risk CSV
 * and MTS-Dialog CSV schemas so offline CLI and unit tests can verify public-dataset
 * ingestion without requiring external network downloads.
 */
const PUBLIC_FORMAT_SAMPLE_CSV = {
  uciMaternalCsv: [
    'Age,SystolicBP,DiastolicBP,BS,BodyTemp,HeartRate,RiskLevel',
    '29,140,90,6.8,98.0,78,high risk',
    '27,138,88,6.5,98.0,76,mid risk',
    '25,110,70,4.6,98.0,82,low risk',
    '31,122,78,8.8,98.0,74,high risk',
    '28,116,74,4.7,98.0,72,low risk',
  ].join('\n'),

  mtsDialogCsv: [
    'ID,section_header,section_text,dialogue',
    '1,HPI,"28 weeks gestation presenting with frontal headache and mild pedal edema; denies visual disturbance.","Doctor: How have you been feeling since your last antenatal check?\\nPatient: I have had a moderate headache in my forehead and mild ankle swelling in the evening.\\nDoctor: Any blurred vision or epigastric pain?\\nPatient: No blurred vision and no epigastric pain at all."',
    '2,HPI,"27 weeks gestation with evening ankle swelling and headache.","Doctor: Any new symptoms this week?\\nPatient: Yes doctor, mild pedal edema and a moderate headache.\\nDoctor: Do you have any vision changes or vaginal bleeding?\\nPatient: No vision problems and no bleeding."',
    '3,HPI,"26 weeks gestation with exertional breathlessness and fatigue.","Doctor: Tell me what brings you in today.\\nPatient: I feel severe fatigue and breathlessness when climbing stairs, plus occasional dizziness.\\nDoctor: Any bleeding or headache?\\nPatient: No bleeding and no headache."',
    '4,HPI,"31yo pregnant patient with elevated blood glucose and post-meal fatigue.","Doctor: We reviewed your glucose tolerance results.\\nPatient: I have been feeling tired after meals and noticing frequent urination, but no burning urination or fever."',
    '5,HPI,"Routine 28-week antenatal visit, asymptomatic.","Doctor: How are things going at 28 weeks?\\nPatient: Feeling well, the baby is moving well, and I have no headache, no swelling, and no bleeding."',
  ].join('\n'),
};

module.exports = {
  MMOLL_TO_MGDL,
  parseCsvRecords,
  adaptUciMaternalRow,
  adaptDialogueTextToSegments,
  adaptPublicDatasetBatch,
  PUBLIC_FORMAT_SAMPLE_CSV,
};
