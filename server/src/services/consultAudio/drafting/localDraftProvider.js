/**
 * Local LLM Draft Provider for Qwen3:8b / Local Testing (Phase 8).
 *
 * Connects to a locally running LLM HTTP service (e.g. Ollama or OpenAI-compatible endpoint).
 * Default model: qwen3:8b (or qwen2.5:8b).
 * Default endpoint: http://localhost:11434/api/chat.
 *
 * Enforces JSON mode and validates responses against Zod schemas.
 */

const DraftProviderInterface = require('./draftProvider.interface');
const config = require('../../../config/consultAudio.config');
const {
  DoctorNotesSchema,
  PatientSummarySchema,
  ClinicalFlagsSchema,
  dropUncitedFlags,
  dropUncitedRecommendations,
} = require('./draftSchemas');
const logger = require('../../../utils/logger');

class LocalDraftProvider extends DraftProviderInterface {
  constructor(options = {}) {
    super();
    this.name = 'local';
    this.url = options.url || config.localLlmUrl || 'http://localhost:11434/api/chat';
    this.modelVersion = options.model || config.localLlmModel || 'qwen3:8b';
    this.timeoutMs = options.timeoutMs || config.draftTimeoutMs || 30000;
  }

  async _callLocalLlm(systemPrompt, userPrompt) {
    const isOllamaChat = this.url.includes('/api/chat');
    const isOpenAiCompat = this.url.includes('/v1/chat/completions');

    let requestBody;
    if (isOpenAiCompat) {
      requestBody = {
        model: this.modelVersion,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      };
    } else {
      // Default Ollama chat format
      requestBody = {
        model: this.modelVersion,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        format: 'json',
        stream: false,
        think: Boolean(config.localLlmThink),
        options: {
          temperature: 0.2,
        },
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Local LLM error (${res.status}): ${errText}`);
      }

      const responseJson = await res.json();
      let rawContent;

      if (isOpenAiCompat) {
        rawContent = responseJson.choices?.[0]?.message?.content;
      } else {
        rawContent = responseJson.message?.content || responseJson.response;
      }

      if (!rawContent) {
        throw new Error('Empty response from local LLM service');
      }

      return JSON.parse(rawContent);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Local LLM request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateDoctorNotes({ transcript, structuredContext, tracerCatalog }) {
    const start = Date.now();
    const systemPrompt = `
You are a clinical documentation assistant for a maternal health platform.
Generate a JSON object conforming strictly to this schema:
{
  "chief_complaint": string,
  "vitals_observed": string,
  "assessment": string,
  "plan_and_recommendations": [
    {
      "recommendation": string,
      "cited_segment_ids": string[]
    }
  ]
}
RULES:
1. NEVER STATE A MEDICAL DIAGNOSIS. Assessment must be descriptive only.
2. Every plan recommendation MUST cite supporting segment_ids from the transcript.
3. Unverified numbers spoken must be labeled "stated verbally, unverified".
4. Unverified lab/ultrasound values must read "[value pending verification]".
`;

    const userPrompt = `
TRACER CATALOG (VERIFIED DATA):
${JSON.stringify(tracerCatalog, null, 2)}

STRUCTURED INTAKE CONTEXT:
${JSON.stringify(structuredContext, null, 2)}

CONSULTATION TRANSCRIPT:
${JSON.stringify(transcript.map((s) => ({ segment_id: s.id || s.segment_id, speaker: s.speaker, text: s.text })), null, 2)}
`;

    const rawData = await this._callLocalLlm(systemPrompt, userPrompt);
    const { raw, dropped } = dropUncitedRecommendations(rawData);
    const validated = DoctorNotesSchema.parse(raw);
    return { data: validated, droppedUncited: dropped, latencyMs: Date.now() - start };
  }

  async generatePatientSummary({ transcript, structuredContext, tracerCatalog }) {
    const start = Date.now();
    const systemPrompt = `
You are an empathetic maternal health communication assistant.
Generate a JSON object conforming strictly to this schema:
{
  "summary_text": string,
  "action_checklist": string[],
  "warning_signs": string[]
}
RULES:
1. Use clear, warm patient-friendly language.
2. Emphasize warning signs that require contacting clinical triage immediately.
3. Do not state medical diagnoses.
`;

    const userPrompt = `
TRACER CATALOG (VERIFIED DATA):
${JSON.stringify(tracerCatalog, null, 2)}

CONSULTATION TRANSCRIPT:
${JSON.stringify(transcript.map((s) => ({ segment_id: s.id || s.segment_id, speaker: s.speaker, text: s.text })), null, 2)}
`;

    const rawData = await this._callLocalLlm(systemPrompt, userPrompt);
    const validated = PatientSummarySchema.parse(rawData);
    return { data: validated, latencyMs: Date.now() - start };
  }

  async generateClinicalFlags({ transcript, structuredContext, tracerCatalog }) {
    const start = Date.now();
    const systemPrompt = `
You are an operational clinical triage safety assistant.
Generate a JSON object conforming strictly to this schema:
{
  "flags": [
    {
      "flag_name": string,
      "severity": "low" | "medium" | "high",
      "description": string,
      "cited_segment_ids": string[]
    }
  ]
}
RULES:
1. Operational flags only. NEVER STATE A DIAGNOSIS.
2. Every flag MUST cite supporting segment_ids from the transcript.
`;

    const userPrompt = `
TRACER CATALOG (VERIFIED DATA):
${JSON.stringify(tracerCatalog, null, 2)}

CONSULTATION TRANSCRIPT:
${JSON.stringify(transcript.map((s) => ({ segment_id: s.id || s.segment_id, speaker: s.speaker, text: s.text })), null, 2)}
`;

    const rawData = await this._callLocalLlm(systemPrompt, userPrompt);
    const { raw, dropped } = dropUncitedFlags(rawData);
    const validated = ClinicalFlagsSchema.parse(raw);
    return { data: validated, droppedUncited: dropped, latencyMs: Date.now() - start };
  }
}

module.exports = LocalDraftProvider;
