/**
 * Google Gemini API Provider for the Assistant.
 *
 * Calls Google's Gemini generateContent API with structured JSON output,
 * allowing seamless switching between local Gemma (Ollama) and cloud Gemini.
 *
 * The API key goes in a request header, never the URL, so it cannot end up in
 * logs or error messages. Gemini accepts a subset of JSON Schema for the reply
 * shape, so our schema is converted first (see toGeminiSchema).
 *
 * Busy or failing models (503, 429, 500, network) are tried once more on the
 * fallback model, so one overloaded model does not take the assistant down.
 */

const { LlmProvider, ProviderError } = require('./provider.interface');
const { postJson } = require('./httpJson');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// "-latest" names follow Google's current model; dated names are retired for new keys.
const DEFAULT_MODEL = 'gemini-flash-lite-latest';

// Keywords Gemini's response schema understands; anything else (additionalProperties,
// maxLength, maxItems, ...) is dropped. Array limits make Gemini refuse the whole schema
// ("invalid argument") once it has several arrays; server-side validation enforces every limit.
const KEPT = new Set(['type', 'enum', 'items', 'properties', 'required', 'description', 'nullable', 'format']);
// Worth one more try on the fallback model.
const RETRY_ON = new Set(['HTTP_429', 'HTTP_500', 'HTTP_503', 'NETWORK']);

/** Our JSON Schema in the form Gemini's `responseSchema` accepts (types in upper case). */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!KEPT.has(key)) continue;
    if (key === 'type') out.type = String(value).toUpperCase();
    else if (key === 'properties') out.properties = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, toGeminiSchema(sub)]));
    else if (key === 'items') out.items = toGeminiSchema(value);
    else out[key] = value;
  }
  return out;
}

/** The reply text: the answer parts joined, leaving out the model's thought parts. */
function replyText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => !part.thought && typeof part.text === 'string').map((part) => part.text).join('');
}

class GeminiProvider extends LlmProvider {
  constructor({ apiKey, model, fallbackModel, maxOutputTokens, thinkingLevel }) {
    super();
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    this.model = model || DEFAULT_MODEL;
    this.fallbackModel = fallbackModel && fallbackModel !== this.model ? fallbackModel : null;
    // Thinking tokens count against this cap, so it is larger than the reply needs.
    this.maxOutputTokens = maxOutputTokens || 2048;
    this.thinkingLevel = thinkingLevel || null;
  }

  async complete({ messages, schema, timeoutMs }) {
    if (!this.apiKey) {
      throw new ProviderError('CONFIG_ERROR', 'GEMINI_API_KEY is not configured');
    }

    // Gemini takes the system instructions separately from the conversation.
    const systemMessage = messages.find((m) => m.role === 'system');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const buildBody = (includeSchema) => ({
      contents,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: this.maxOutputTokens,
        responseMimeType: 'application/json',
        ...(includeSchema && schema && { responseSchema: toGeminiSchema(schema) }),
        ...(this.thinkingLevel && { thinkingConfig: { thinkingLevel: this.thinkingLevel } }),
      },
      ...(systemMessage && { systemInstruction: { parts: [{ text: systemMessage.content }] } }),
    });

    const headers = { 'x-goog-api-key': this.apiKey };
    const deadline = Date.now() + (timeoutMs || 15000);
    const ask = async (model) => {
      const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
      const remaining = () => Math.max(1000, deadline - Date.now());
      try {
        return await postJson(url, buildBody(true), { headers, timeoutMs: remaining() });
      } catch (err) {
        // A schema the model refuses: plain JSON mode; the server still validates the reply.
        if (err.code === 'HTTP_400' && schema) return postJson(url, buildBody(false), { headers, timeoutMs: remaining() });
        throw err;
      }
    };

    let response;
    try {
      response = await ask(this.model);
    } catch (err) {
      if (!this.fallbackModel || !RETRY_ON.has(err.code) || Date.now() >= deadline) throw err;
      response = await ask(this.fallbackModel);
    }

    const text = replyText(response);
    if (!text) throw new ProviderError('BAD_RESPONSE', 'Empty response from Gemini');
    return text;
  }

  async warmUp() {
    // Gemini API is cloud-hosted; no local model loading needed
  }
}

module.exports = GeminiProvider;
module.exports.toGeminiSchema = toGeminiSchema;
