/**
 * Any server speaking the OpenAI /chat/completions shape: hosted APIs, vLLM,
 * or Ollama's /v1 endpoint. The reply is requested as JSON matching `schema`.
 */

const { LlmProvider, ProviderError } = require('./provider.interface');
const { postJson } = require('./httpJson');

class OpenAiCompatibleProvider extends LlmProvider {
  constructor({ baseUrl, apiKey, model, maxOutputTokens }) {
    super();
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.maxOutputTokens = maxOutputTokens;
  }

  async complete({ messages, schema, timeoutMs }) {
    const data = await postJson(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        messages,
        temperature: 0,
        max_tokens: this.maxOutputTokens,
        response_format: { type: 'json_schema', json_schema: { name: 'assistant_route', schema, strict: true } },
      },
      { timeoutMs, headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {} }
    );
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new ProviderError('BAD_RESPONSE');
    return text;
  }
}

module.exports = OpenAiCompatibleProvider;
