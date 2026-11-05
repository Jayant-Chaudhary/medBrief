/**
 * Fake STT Provider for Testing.
 *
 * Provides deterministic, instant speech-to-text segments without
 * external network requests or GPU requirements.
 */

const SttProvider = require('./provider.interface');

class FakeProvider extends SttProvider {
  constructor(options = {}) {
    super();
    this.name = 'fake';
    this.customText = options.customText || null;
    this.simulateLatencyMs = options.simulateLatencyMs || 0;
  }

  async transcribe(wavPath, options = {}) {
    if (options.forceError) {
      const err = new Error('Simulated STT provider failure');
      err.code = 'ERR_STT_SIMULATED_FAILURE';
      throw err;
    }

    if (this.simulateLatencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.simulateLatencyMs));
    }

    const durationMs = options.durationMs || 15000;
    const text = this.customText || (options.device === 'doctor'
      ? 'Namaste Sunita ji, please have a seat. Let us examine your vitals.'
      : 'Thank you doctor, my nausea is better but my feet feel slightly swollen.');

    return [
      {
        start_ms: 0,
        end_ms: durationMs,
        text,
        confidence: 0.985,
      },
    ];
  }

  getCapabilities() {
    return {
      name: 'fake',
      supportsDiarization: false,
      supportsStreaming: false,
    };
  }
}

module.exports = FakeProvider;
