/**
 * Abstract Base Speech-to-Text Provider Interface.
 *
 * All STT engines (Sarvam REST, Local Whisper, Fake Test Provider)
 * implement this exact interface so they can be seamlessly swapped by config.
 */

class SttProvider {
  /**
   * Transcribes a 16 kHz mono WAV audio file into segments.
   *
   * @param {string} wavPath - Path to 16 kHz mono WAV file on local disk
   * @param {Object} options - Options { languageCode?: string, sessionTimeOffsetMs?: number }
   * @returns {Promise<Array<{ start_ms: number, end_ms: number, text: string, confidence?: number }>>}
   */
  async transcribe(wavPath, options = {}) {
    throw new Error('transcribe() must be implemented by SttProvider subclass');
  }

  /**
   * Returns provider capabilities.
   */
  getCapabilities() {
    return {
      name: 'base',
      supportsDiarization: false,
      supportsStreaming: false,
    };
  }
}

module.exports = SttProvider;
