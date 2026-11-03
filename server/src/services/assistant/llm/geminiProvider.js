/**
 * Google Gemini API Provider for the Assistant.
 *
 * Calls Google's Gemini generateContent API with structured JSON output,
 * allowing seamless switching between local Gemma (Ollama) and cloud Gemini.
 */

const { LlmProvider, ProviderError } = require('./provider.interface');
const { postJson } = require('./httpJson');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

class GeminiProvider extends LlmProvider {
  constructor({ apiKey, model, maxOutputTokens }) {
    super();
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    this.model = model || 'gemini-1.5-flash';
    this.maxOutputTokens = maxOutputTokens || 512;
  }

  async complete({ messages, schema, timeoutMs }) {
    if (!this.apiKey) {
      throw new ProviderError('CONFIG_ERROR', 'GEMINI_API_KEY is not configured');
    }

    // Convert messages to Gemini format
    // System message instructions
    const systemMessage = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    const contents = userMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const url = `${GEMINI_API_BASE}/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: this.maxOutputTokens,
        responseMimeType: 'application/json',
      },
    };

    if (systemMessage) {
      requestBody.systemInstruction = {
        parts: [{ text: systemMessage.content }],
      };
    }

    if (schema) {
      requestBody.generationConfig.responseSchema = schema;
    }

    try {
      const response = await postJson(url, requestBody, { timeoutMs });
      const candidate = response?.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;

      if (!text || typeof text !== 'string') {
        throw new ProviderError('BAD_RESPONSE', 'Empty response from Gemini');
      }

      return text;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(err.code || 'HTTP_ERROR', err.message);
    }
  }

  async warmUp() {
    // Gemini API is cloud-hosted; no local model loading needed
  }
}

module.exports = GeminiProvider;
