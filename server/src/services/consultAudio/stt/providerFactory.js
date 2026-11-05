/**
 * STT Provider Factory.
 *
 * Instantiates and returns the configured Speech-to-Text provider
 * (local faster-whisper, Sarvam REST, or fake mock).
 */

const config = require('../../../config/consultAudio.config');
const FakeProvider = require('./fakeProvider');
const LocalProvider = require('./localProvider');
const SarvamProvider = require('./sarvamProvider');

function getProvider(providerName = null) {
  const defaultProvider = process.env.NODE_ENV === 'test' ? 'fake' : 'local';
  let chosen = (providerName || (process.env.NODE_ENV === 'test' ? 'fake' : config.sttProvider) || defaultProvider).toLowerCase();

  // If sarvam is requested but no API key is provided, gracefully fall back to local Whisper (or fake in test)
  if (chosen === 'sarvam' && !config.sarvamApiKey) {
    chosen = process.env.NODE_ENV === 'test' ? 'fake' : 'local';
  }

  switch (chosen) {
    case 'local':
      return new LocalProvider(config.whisperServiceUrl);
    case 'sarvam':
      return new SarvamProvider(config.sarvamApiKey, 'saaras:v4');
    case 'fake':
    default:
      return new FakeProvider();
  }
}

module.exports = {
  getProvider,
};
