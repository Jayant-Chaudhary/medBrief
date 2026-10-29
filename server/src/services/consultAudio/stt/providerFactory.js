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
  const chosen = (providerName || config.sttProvider || 'fake').toLowerCase();

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
