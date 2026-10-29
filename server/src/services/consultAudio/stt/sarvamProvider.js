/**
 * Sarvam REST Speech-to-Text Provider.
 *
 * Calls Sarvam REST API (saaras:v4) synchronously per chunk (up to 30s).
 */

const fs = require('fs');
const path = require('path');
const SttProvider = require('./provider.interface');
const logger = require('../../../utils/logger');

const SARVAM_URL = 'https://api.sarvam.ai/speech-to-text';

class SarvamProvider extends SttProvider {
  constructor(apiKey, model = 'saaras:v4') {
    super();
    this.name = 'sarvam';
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(wavInput, options = {}) {
    if (!this.apiKey) {
      const err = new Error('SARVAM_API_KEY is not configured');
      err.code = 'ERR_SARVAM_KEY_MISSING';
      throw err;
    }

    let audioBuffer;
    let fileName = 'chunk.wav';

    if (Buffer.isBuffer(wavInput)) {
      audioBuffer = wavInput;
    } else if (typeof wavInput === 'string') {
      if (!fs.existsSync(wavInput)) {
        const err = new Error(`Audio file not found: ${wavInput}`);
        err.code = 'ERR_FILE_NOT_FOUND';
        throw err;
      }
      audioBuffer = fs.readFileSync(wavInput);
      fileName = path.basename(wavInput);
    } else {
      throw new Error('Invalid wavInput provided to SarvamProvider: must be a Buffer or file path');
    }

    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('model', this.model);
    formData.append('mode', 'transcribe');
    formData.append('with_timestamps', 'true');

    if (options.languageCode) {
      formData.append('language_code', options.languageCode);
    }

    const startTimer = Date.now();
    let res;
    try {
      res = await fetch(SARVAM_URL, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
        },
        body: formData,
      });
    } catch (networkErr) {
      const err = new Error(`Sarvam STT network failure: ${networkErr.message}`);
      err.code = 'ERR_SARVAM_NETWORK';
      throw err;
    }

    const latencyMs = Date.now() - startTimer;

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Sarvam STT error (${res.status}): ${errText}`);
      err.code = res.status === 429 ? 'ERR_SARVAM_RATE_LIMITED' : 'ERR_SARVAM_API_ERROR';
      throw err;
    }

    const data = await res.json();
    const rawTranscript = (data.transcript || '').trim();

    logger.debug('Sarvam STT chunk transcribed', {
      scope: 'stt-sarvam',
      latencyMs,
      language: data.language_code,
    });

    // If timestamps are provided by Sarvam
    if (Array.isArray(data.timestamps) && data.timestamps.length > 0) {
      return data.timestamps.map((t) => ({
        start_ms: Math.round((t.start_time_seconds || 0) * 1000),
        end_ms: Math.round((t.end_time_seconds || 0) * 1000),
        text: (t.sentence || t.text || rawTranscript).trim(),
        confidence: 0.95,
        language: data.language_code,
      }));
    }

    // Default: map full chunk duration
    const durationMs = options.durationMs || 15000;
    return [
      {
        start_ms: 0,
        end_ms: durationMs,
        text: rawTranscript,
        confidence: 0.95,
        language: data.language_code,
      },
    ];
  }

  getCapabilities() {
    return {
      name: 'sarvam',
      supportsDiarization: false,
      supportsStreaming: false,
    };
  }
}

module.exports = SarvamProvider;
