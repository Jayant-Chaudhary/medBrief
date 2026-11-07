/**
 * Google Gemini Flash Draft Provider (Phase 8).
 *
 * Implements clinical note drafting using the Gemini REST API with schema-enforced JSON output.
 * Models: gemini-1.5-flash / gemini-2.0-flash.
 *
 * Safety & Privacy:
 * - Prompts enforce: The product flags and prioritises; it NEVER diagnoses.
 * - Every plan item and clinical flag must cite exact supporting segment_ids.
 * - Tracers: Verified numbers must link to tracer IDs; unverified numbers labeled 'stated verbally, unverified'.
 */

const DraftProviderInterface = require('./draftProvider.interface');
const config = require('../../../config/consultAudio.config');
const {
  DoctorNotesSchema,
  PatientSummarySchema,
  ClinicalFlagsSchema,
  dropUncitedFlags,
  dropUncitedRecommendations,
  GEMINI_DOCTOR_NOTES_SCHEMA,
  GEMINI_PATIENT_SUMMARY_SCHEMA,
  GEMINI_CLINICAL_FLAGS_SCHEMA,
} = require('./draftSchemas');
const logger = require('../../../utils/logger');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

class GeminiDraftProvider extends DraftProviderInterface {
  constructor(options = {}) {
    super();
    this.name = 'gemini';
    this.apiKey = options.apiKey || config.geminiApiKey;
    this.modelVersion = options.model || config.geminiDraftModel || 'gemini-3.5-flash-lite';
    this.timeoutMs = options.timeoutMs || config.draftTimeoutMs || 60000;
  }

  async _callGeminiApi(promptText, responseSchema) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.2,
      },
    };

    const maxRetries = 3;
    const candidateModels = [
      this.modelVersion,
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash',
    ].filter((m, idx, arr) => arr.indexOf(m) === idx);

    let lastError;

    for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
      const model = candidateModels[mIdx];
      const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${this.apiKey}`;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errText = await res.text();
            if ((res.status === 503 || res.status === 429) && attempt < maxRetries) {
              const backoffMs = attempt * 2000;
              logger.warn(`Gemini API returned ${res.status} for ${model}, retrying in ${backoffMs}ms (attempt ${attempt}/${maxRetries})`);
              await new Promise((r) => setTimeout(r, backoffMs));
              continue;
            }
            throw new Error(`Gemini API error (${res.status}): ${errText}`);
          }

          const data = await res.json();
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!rawText) {
            throw new Error('Empty response from Gemini API');
          }

          return JSON.parse(rawText);
        } catch (err) {
          if (err.name === 'AbortError') {
            lastError = new Error(`Gemini request timed out after ${this.timeoutMs}ms`);
          } else {
            lastError = err;
          }

          const isModelUnavailable = lastError.message.includes('404') || lastError.message.includes('503');
          if (attempt === maxRetries && isModelUnavailable && mIdx < candidateModels.length - 1) {
            logger.warn(`Model ${model} unavailable, falling back to ${candidateModels[mIdx + 1]}`);
            break;
          }

          if (attempt === maxRetries || (!lastError.message.includes('503') && !lastError.message.includes('429'))) {
            if (mIdx === candidateModels.length - 1) {
              throw lastError;
            }
            break;
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    throw lastError;
  }

  async generateDoctorNotes({ transcript, structuredContext, tracerCatalog }) {
    const start = Date.now();
    const prompt = `
You are a clinical documentation assistant for a maternal health platform.
Your role is to summarize the consultation and draft clinician notes based on the merged transcript and verified records.

CRITICAL CLINICAL SAFETY RULES:
1. NEVER STATE A MEDICAL DIAGNOSIS. The platform flags and prioritizes observations; it does not diagnose.
2. Every item in plan_and_recommendations MUST cite the exact segment_id values from the transcript that evidence it.
3. If quoting verified clinical lab, ultrasound, or vital values, use the provided TRACER CATALOG.
4. Any clinical numbers spoken in the consultation that are NOT in the tracer catalog must be labeled "stated verbally, unverified".
5. Any unverified lab or ultrasound test discussed must read "[value pending verification]".

TRACER CATALOG (VERIFIED DATA):
${JSON.stringify(tracerCatalog, null, 2)}

STRUCTURED INTAKE CONTEXT:
${JSON.stringify(structuredContext, null, 2)}

CONSULTATION TRANSCRIPT:
${JSON.stringify(transcript.map((s) => ({ segment_id: s.id || s.segment_id, speaker: s.speaker, text: s.text })), null, 2)}
`;

    const rawData = await this._callGeminiApi(prompt, GEMINI_DOCTOR_NOTES_SCHEMA);
    const { raw, dropped } = dropUncitedRecommendations(rawData);
    const validated = DoctorNotesSchema.parse(raw);
    return { data: validated, droppedUncited: dropped, latencyMs: Date.now() - start };
  }

  async generatePatientSummary({ transcript, structuredContext, tracerCatalog }) {
    const start = Date.now();
    const prompt = `
You are an empathetic maternal health communication assistant.
Generate an accessible, clear patient summary, practical action checklist, and warning signs based on the consultation transcript.

CRITICAL RULES:
1. Use clear, warm, patient-friendly language without medical jargon.
2. Emphasize warning signs that require contacting clinical triage immediately (e.g., severe headache, sudden swelling, bleeding).
3. Do not invent diagnoses.

TRACER CATALOG (VERIFIED DATA):
${JSON.stringify(tracerCatalog, null, 2)}

CONSULTATION TRANSCRIPT:
${JSON.stringify(transcript.map((s) => ({ segment_id: s.id || s.segment_id, speaker: s.speaker, text: s.text })), null, 2)}
`;

    const rawData = await this._callGeminiApi(prompt, GEMINI_PATIENT_SUMMARY_SCHEMA);
    const validated = PatientSummarySchema.parse(rawData);
    return { data: validated, latencyMs: Date.now() - start };
  }

  async generateClinicalFlags({ transcript, structuredContext, tracerCatalog }) {
    const start = Date.now();
    const prompt = `
You are an operational clinical triage safety assistant.
Review the consultation transcript and verified records to identify operational risk flags (e.g., borderline hemoglobin, missed supplements, swelling symptoms, elevated BP).

CRITICAL RULES:
1. Operational flags only (e.g. "borderline_hemoglobin", "mild_pedal_edema"). NEVER STATE A DIAGNOSIS.
2. Severity must be one of: "low", "medium", "high".
3. Every flag MUST cite the exact segment_id values from the transcript supporting it.

TRACER CATALOG (VERIFIED DATA):
${JSON.stringify(tracerCatalog, null, 2)}

CONSULTATION TRANSCRIPT:
${JSON.stringify(transcript.map((s) => ({ segment_id: s.id || s.segment_id, speaker: s.speaker, text: s.text })), null, 2)}
`;

    const rawData = await this._callGeminiApi(prompt, GEMINI_CLINICAL_FLAGS_SCHEMA);
    const { raw, dropped } = dropUncitedFlags(rawData);
    const validated = ClinicalFlagsSchema.parse(raw);
    return { data: validated, droppedUncited: dropped, latencyMs: Date.now() - start };
  }
}

module.exports = GeminiDraftProvider;
