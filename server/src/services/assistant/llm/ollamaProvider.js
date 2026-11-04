/**
 * Local Ollama through its native API, which (unlike its OpenAI-compatible
 * endpoint) accepts keep_alive, a context size, and a JSON schema that the
 * model's output is constrained to.
 */

const { LlmProvider, ProviderError } = require('./provider.interface');
const { postJson } = require('./httpJson');

class OllamaProvider extends LlmProvider {
  constructor({ baseUrl, model, keepAlive, numCtx, maxOutputTokens }) {
    super();
    this.baseUrl = baseUrl;
    this.model = model;
    this.keepAlive = keepAlive;
    this.numCtx = numCtx;
    this.maxOutputTokens = maxOutputTokens;
  }

  async complete({ messages, schema, timeoutMs = 30000 }) {
    const data = await postJson(
      `${this.baseUrl}/api/chat`,
      {
        model: this.model,
        messages,
        format: schema,
        stream: false,
        think: false,
        keep_alive: this.keepAlive,
        options: { temperature: 0, num_ctx: this.numCtx, num_predict: this.maxOutputTokens },
      },
      { timeoutMs }
    );
    const text = data?.message?.content;
    if (typeof text !== 'string') throw new ProviderError('BAD_RESPONSE');
    return text;
  }

  /**
   * An empty generate request loads the model without producing output. It
   * must use the same context size as complete(): a different one makes
   * Ollama reload the whole model on the next real request.
   */
  async warmUp(timeoutMs) {
    await postJson(
      `${this.baseUrl}/api/generate`,
      { model: this.model, keep_alive: this.keepAlive, options: { num_ctx: this.numCtx } },
      { timeoutMs }
    );
  }
}

module.exports = OllamaProvider;
