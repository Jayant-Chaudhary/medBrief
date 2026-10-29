/**
 * Local Whisper STT Provider.
 *
 * Calls the local faster-whisper microservice over HTTP (default: http://localhost:8001).
 * Supports GPU acceleration on CUDA (e.g. RTX 5050) with sub-second turnaround.
 */

const fs = require('fs');
const path = require('path');
const SttProvider = require('./provider.interface');
const logger = require('../../../utils/logger');

class LocalProvider extends SttProvider {
  constructor(serviceUrl = 'http://localhost:8001') {
    super();
    this.name = 'local';
    this.serviceUrl = serviceUrl.replace(/\/+$/, '');
  }

  async transcribe(wavInput, options = {}) {
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
      throw new Error('Invalid wavInput provided to LocalProvider: must be a Buffer or file path');
    }

    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', blob, fileName);

    if (options.languageCode) {
      formData.append('language', options.languageCode);
    }
    formData.append('vad_filter', options.vadFilter === false ? 'false' : 'true');

    const startTimer = Date.now();
    let res;
    try {
      res = await fetch(`${this.serviceUrl}/transcribe`, {
        method: 'POST',
        body: formData,
      });
    } catch (networkErr) {
      const err = new Error(`Local Whisper service unavailable at ${this.serviceUrl}: ${networkErr.message}`);
      err.code = 'ERR_LOCAL_STT_UNAVAILABLE';
      throw err;
    }

    const latencyMs = Date.now() - startTimer;

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Local Whisper error (${res.status}): ${errText}`);
      err.code = 'ERR_LOCAL_STT_FAILED';
      throw err;
    }

    const data = await res.json();

    logger.debug('Local Whisper transcription complete', {
      scope: 'stt-local',
      latencyMs,
      language: data.language,
      segmentCount: (data.segments || []).length,
    });

    const segments = (data.segments || []).map((s) => ({
      start_ms: Number(s.start_ms) || 0,
      end_ms: Number(s.end_ms) || 0,
      text: (s.text || '').trim(),
      confidence: s.confidence !== null && s.confidence !== undefined ? Number(s.confidence) : 0.95,
      language: data.language,
    }));

    // If whole chunk produced one text without segments
    if (segments.length === 0 && data.text && data.text.trim()) {
      segments.push({
        start_ms: 0,
        end_ms: Math.round((data.duration_sec || 15) * 1000),
        text: data.text.trim(),
        confidence: 0.95,
        language: data.language,
      });
    }

    return segments;
  }

  getCapabilities() {
    return {
      name: 'local',
      supportsDiarization: false,
      supportsStreaming: false,
    };
  }
}

module.exports = LocalProvider;
