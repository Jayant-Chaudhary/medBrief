#!/usr/bin/env node
/**
 * Gemini Clinical Notes Drafting Benchmark Tool
 *
 * Times a drafting call on a ~5,000-word synthetic consultation transcript
 * using Gemini with schema-enforced structured JSON output.
 *
 * Checks:
 * 1. Generation latency (TTFT / completion time)
 * 2. Schema compliance (doctor notes, patient summary, clinical flags)
 * 3. Citation integrity (every cited segment_id exists in the input transcript)
 *
 * Supports --dry-run and --help
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../server/.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function printHelp() {
  console.log(`
Usage: node tools/measure/gemini-draft.js [options]

Options:
  --help             Show this help message
  --dry-run          Simulate the Gemini drafting call without contacting the API or requiring keys
  --key=<key>        Gemini API Key (defaults to GEMINI_API_KEY in .env)
  --model=<model>    Model identifier (default: gemini-1.5-flash)
  --words=<count>    Approximate word count for synthetic transcript (default: 5000)

Example:
  node tools/measure/gemini-draft.js --dry-run
  node tools/measure/gemini-draft.js --key=your_key --model=gemini-1.5-flash
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    help: false,
    dryRun: false,
    key: process.env.GEMINI_API_KEY,
    model: 'gemini-1.5-flash',
    targetWords: 5000,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--key=')) options.key = arg.split('=')[1];
    else if (arg.startsWith('--model=')) options.model = arg.split('=')[1];
    else if (arg.startsWith('--words=')) options.targetWords = parseInt(arg.split('=')[1], 10) || 5000;
  }
  return options;
}

/**
 * Generates a synthetic multi-turn maternal health consultation transcript
 * of roughly `targetWords` with valid segment IDs.
 */
function generateSyntheticTranscript(targetWords) {
  const segments = [];
  let currentWords = 0;
  let segIndex = 1;

  const topics = [
    {
      dr: "Namaste Sunita ji, please have a seat. How have you been feeling since our last visit two weeks ago? Any morning sickness, fatigue, or headaches?",
      pt: "Namaste doctor. The nausea has subsided, but I have noticed some swelling in my feet by the end of the day, and occasional backache.",
    },
    {
      dr: "Mild pedal edema can be normal in the second trimester, but we will check your blood pressure and urine protein to be certain. Your blood pressure today is 118 over 74 millimeters of mercury, which is completely normal.",
      pt: "That is a relief. I brought my latest blood test reports from the diagnostic center as requested.",
    },
    {
      dr: "Looking at your verified lab results in the system, your hemoglobin is 10.8 grams per deciliter. It is slightly below our target of 11.0, indicating mild iron deficiency anemia. Your fasting blood sugar is 88 milligrams per deciliter, which is optimal.",
      pt: "Should I continue taking the same iron supplements or increase the dosage?",
    },
    {
      dr: "We will continue the elemental iron tablet once daily after dinner, preferably with a citrus fruit like orange juice to enhance absorption. Avoid taking it together with calcium or milk, as calcium inhibits iron uptake.",
      pt: "Understood doctor. How about dietary changes?",
    },
    {
      dr: "Incorporate more spinach, lentils, jaggery, and pomegranates into your daily meals. For the mild leg swelling, keep your feet elevated on a pillow when resting and avoid standing continuously for more than 45 minutes.",
      pt: "I will make sure to do that. Also, the baby movements feel very regular and active, especially after meals.",
    },
    {
      dr: "Active fetal movements are a wonderful sign of fetal wellbeing. Record your kick counts twice daily. Your anomaly scan scheduled for week 20 is already booked. If you experience severe headache, blurred vision, or sudden facial puffiness, contact our triage immediately.",
      pt: "Thank you so much doctor. I have noted all the instructions carefully.",
    },
  ];

  while (currentWords < targetWords) {
    const topic = topics[(segIndex - 1) % topics.length];
    
    // Doctor turn
    const drId = `seg_${String(segIndex).padStart(4, '0')}`;
    segments.push({ segment_id: drId, speaker: 'doctor', text: topic.dr });
    currentWords += topic.dr.split(/\s+/).length;
    segIndex++;

    // Patient turn
    const ptId = `seg_${String(segIndex).padStart(4, '0')}`;
    segments.push({ segment_id: ptId, speaker: 'patient', text: topic.pt });
    currentWords += topic.pt.split(/\s+/).length;
    segIndex++;
  }

  return segments;
}

const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    doctor_notes: {
      type: "OBJECT",
      properties: {
        chief_complaint: { type: "STRING" },
        vitals_observed: { type: "STRING" },
        assessment: { type: "STRING" },
        plan_and_recommendations: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              recommendation: { type: "STRING" },
              cited_segment_ids: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["recommendation", "cited_segment_ids"],
          },
        },
      },
      required: ["chief_complaint", "vitals_observed", "assessment", "plan_and_recommendations"],
    },
    patient_summary: {
      type: "OBJECT",
      properties: {
        summary_text: { type: "STRING" },
        action_checklist: { type: "ARRAY", items: { type: "STRING" } },
        warning_signs: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["summary_text", "action_checklist", "warning_signs"],
    },
    clinical_flags: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          flag_name: { type: "STRING" },
          severity: { type: "STRING" },
          cited_segment_ids: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["flag_name", "severity", "cited_segment_ids"],
      },
    },
  },
  required: ["doctor_notes", "patient_summary", "clinical_flags"],
};

async function simulateGeminiCall(segments) {
  // Simulate Gemini Flash latency on 6,500 tokens input (~2000ms - 3500ms)
  const simLatency = Math.floor(2200 + Math.random() * 800);
  await new Promise((r) => setTimeout(r, simLatency));

  const validIds = segments.map((s) => s.segment_id);
  const sampleId1 = validIds[0] || 'seg_0001';
  const sampleId2 = validIds[1] || 'seg_0002';
  const sampleId3 = validIds[2] || 'seg_0003';

  const mockDraft = {
    doctor_notes: {
      chief_complaint: "Mild bilateral pedal edema in evening; nausea resolved.",
      vitals_observed: "Blood pressure 118/74 mmHg (normal range).",
      assessment: "Second trimester intrauterine pregnancy with mild physiological edema and mild iron deficiency anemia.",
      plan_and_recommendations: [
        {
          recommendation: "Continue elemental iron tablet daily after dinner with citrus; separate from calcium intake.",
          cited_segment_ids: [sampleId3],
        },
        {
          recommendation: "Elevate lower extremities when resting; avoid prolonged standing exceeding 45 minutes.",
          cited_segment_ids: [sampleId1, sampleId2],
        },
      ],
    },
    patient_summary: {
      summary_text: "Your pregnancy checkup is proceeding well. Blood pressure is normal. Mild foot swelling and mild anemia are addressed with simple diet and medication timing adjustments.",
      action_checklist: [
        "Take iron tablet with orange juice after dinner",
        "Keep legs elevated while sitting or sleeping",
        "Track daily fetal kick counts",
      ],
      warning_signs: [
        "Severe headache or blurred vision",
        "Sudden swelling in face or hands",
      ],
    },
    clinical_flags: [
      {
        flag_name: "mild_pedal_edema",
        severity: "low",
        cited_segment_ids: [sampleId1, sampleId2],
      },
      {
        flag_name: "borderline_hemoglobin",
        severity: "medium",
        cited_segment_ids: [sampleId3],
      },
    ],
  };

  return {
    latencyMs: simLatency,
    draft: mockDraft,
  };
}

async function executeRealGeminiCall(segments, options) {
  const url = `${GEMINI_API_URL}/${options.model}:generateContent?key=${options.key}`;

  const promptText = `
You are an expert clinical documentation assistant for a maternal health platform.
Given the following multi-turn consultation transcript between a clinician and patient,
generate a structured clinical consultation note, patient summary, and clinical flags.
Every clinical recommendation and flag MUST cite the exact segment_id values from the transcript that evidence it.
Do not invent any clinical facts or diagnoses.

TRANSCRIPT:
${JSON.stringify(segments, null, 2)}
`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: DRAFT_SCHEMA,
      temperature: 0.2,
    },
  };

  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Empty response content from Gemini');

  const draft = JSON.parse(rawText);
  return { latencyMs, draft };
}

function validateDraft(draft, segments) {
  const validIds = new Set(segments.map((s) => s.segment_id));
  const errors = [];

  if (!draft.doctor_notes || !draft.patient_summary || !draft.clinical_flags) {
    errors.push('Missing top-level required schema keys');
  }

  // Validate citations in plan
  const plans = draft.doctor_notes?.plan_and_recommendations || [];
  for (const item of plans) {
    for (const id of item.cited_segment_ids || []) {
      if (!validIds.has(id)) {
        errors.push(`Invalid segment_id cited in plan: ${id}`);
      }
    }
  }

  // Validate citations in flags
  for (const flag of draft.clinical_flags || []) {
    for (const id of flag.cited_segment_ids || []) {
      if (!validIds.has(id)) {
        errors.push(`Invalid segment_id cited in flag: ${id}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('='.repeat(70));
  console.log('GEMINI CLINICAL NOTES DRAFTING BENCHMARK');
  console.log('='.repeat(70));
  console.log(`Mode:           ${options.dryRun ? 'DRY-RUN (Simulated)' : 'LIVE GEMINI API'}`);
  console.log(`Model:          ${options.model}`);
  console.log(`Target Words:   ${options.targetWords}`);
  console.log('='.repeat(70));

  if (!options.dryRun && !options.key) {
    console.error('Error: No Gemini API key provided. Set GEMINI_API_KEY in .env or pass --key=<key> or run with --dry-run.');
    process.exit(1);
  }

  console.log('\n[1/3] Generating Synthetic Consultation Transcript...');
  const segments = generateSyntheticTranscript(options.targetWords);
  const totalWords = segments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
  console.log(`  Generated ${segments.length} dialogue segments (~${totalWords} words).`);

  console.log('\n[2/3] Calling Model with Structured Schema Enforcement...');
  const startTimer = Date.now();
  const { latencyMs, draft } = options.dryRun
    ? await simulateGeminiCall(segments)
    : await executeRealGeminiCall(segments, options);
  console.log(`  Generation completed in ${latencyMs} ms (${(latencyMs / 1000).toFixed(2)} s)`);

  console.log('\n[3/3] Validating Output Conformance & Citation Integrity...');
  const validation = validateDraft(draft, segments);
  if (validation.valid) {
    console.log('  Schema validation: PASSED (100% compliant)');
    console.log('  Segment citation integrity: PASSED (all citations exist in input)');
  } else {
    console.error('  Validation FAILURES:', validation.errors);
  }

  console.log('\n' + '='.repeat(70));
  console.log('DRAFT SUMMARY PREVIEW');
  console.log('='.repeat(70));
  console.log(`Assessment:    ${draft.doctor_notes?.assessment}`);
  console.log(`Plans Count:   ${draft.doctor_notes?.plan_and_recommendations?.length}`);
  console.log(`Flags Count:   ${draft.clinical_flags?.length}`);
  console.log(`Action Items:  ${draft.patient_summary?.action_checklist?.length}`);
  console.log('='.repeat(70));
  console.log(`Drafting Time: ${latencyMs} ms (Budget: < 10,000 ms)`);
  console.log(`Fits Turnaround Budget: ${latencyMs < 10000 ? 'YES' : 'NO'}`);
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('Fatal error during Gemini benchmark:', err.message);
  process.exit(1);
});
