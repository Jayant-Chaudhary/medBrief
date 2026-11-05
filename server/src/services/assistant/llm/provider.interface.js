/**
 * Language model provider interface for the assistant.
 *
 * Every provider (local Ollama, any OpenAI-compatible API, fake) implements
 * this shape so they can be swapped by configuration.
 */

class ProviderError extends Error {
  /**
   * @param {string} code - Short, loggable reason: TIMEOUT, NETWORK, HTTP_<status>, BAD_RESPONSE
   */
  constructor(code, message) {
    super(message || code);
    this.name = 'ProviderError';
    this.code = code;
  }
}

class LlmProvider {
  /**
   * Returns the model's raw text reply, constrained to `schema` where the
   * provider supports it. Throws ProviderError on any failure.
   *
   * @param {{ messages: Array<{ role: string, content: string }>, schema: object, timeoutMs: number }} request
   * @returns {Promise<string>}
   */
  async complete(request) {
    throw new Error('complete() must be implemented by LlmProvider subclass');
  }

  /** Loads the model ahead of the first request, where the provider supports it. */
  async warmUp() {}
}

module.exports = { LlmProvider, ProviderError };
