/**
 * Draft Provider Factory (Phase 8).
 *
 * Resolves and instantiates the configured LLM draft provider:
 * - 'gemini': Google Gemini Flash API with schema enforcement
 * - 'local': Local LLM endpoint (e.g. Qwen3:8b via Ollama)
 * - 'fake': Deterministic zero-network provider for tests
 */

const GeminiDraftProvider = require('./geminiDraftProvider');
const LocalDraftProvider = require('./localDraftProvider');
const FakeDraftProvider = require('./fakeDraftProvider');
const config = require('../../../config/consultAudio.config');

function getDraftProvider(providerName = null, options = {}) {
  const chosenProvider = (providerName || config.draftModelProvider || 'gemini').toLowerCase();

  switch (chosenProvider) {
    case 'gemini':
      return new GeminiDraftProvider(options);
    case 'local':
      return new LocalDraftProvider(options);
    case 'fake':
      return new FakeDraftProvider(options);
    default:
      throw new Error(`Unsupported draft model provider: ${chosenProvider}`);
  }
}

module.exports = {
  getDraftProvider,
  GeminiDraftProvider,
  LocalDraftProvider,
  FakeDraftProvider,
};
