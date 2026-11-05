/**
 * Assistant LLM provider factory: picks the provider named in configuration.
 */

const config = require('../../../config/assistant.config');
const OllamaProvider = require('./ollamaProvider');
const OpenAiCompatibleProvider = require('./openAiCompatibleProvider');
const GeminiProvider = require('./geminiProvider');
const FakeProvider = require('./fakeProvider');

function getProvider(settings = config) {
  switch (settings.provider) {
    case 'ollama':
      return new OllamaProvider(settings);
    case 'gemini':
      return new GeminiProvider(settings);
    case 'openai-compatible':
      return new OpenAiCompatibleProvider(settings);
    case 'fake':
      return new FakeProvider();
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${settings.provider}`);
  }
}

module.exports = { getProvider };
