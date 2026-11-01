/**
 * Web Audio Recording Engine for Doctor Device.
 *
 * Implements:
 * 1. Dual-recorder handover so every audio chunk has a valid container header (WebM/Opus).
 * 2. Real-time loudness metering (dBFS) for the microphone check.
 * 3. Chunker boundary evaluation using evaluateChunkBoundary().
 * 4. In-memory serial upload queue with exponential backoff retries.
 * 5. Final flush marker upon consultation completion.
 */

import {
  evaluateChunkBoundary,
  isChunkSilent,
  calculateLoudnessFromByteData,
  DEFAULT_CHUNKER_CONFIG,
} from '../../utils/audioChunker';

const DEFAULT_UPLOAD_BACKOFF_MS = [1000, 2000, 4000, 8000, 30000];

export class WebRecorder {
  /**
   * @param {Object} options
   * @param {string} options.sessionId - Consultation session UUID.
   * @param {string} options.sessionToken - JWT session token for doctor.
   * @param {string} [options.apiBaseUrl] - Base API URL (e.g. http://localhost:4000).
   * @param {Function} [options.onLoudness] - Callback for real-time dBFS level meter.
   * @param {Function} [options.onChunkReady] - Callback when chunk is packaged.
   * @param {Function} [options.onChunkUploaded] - Callback when chunk upload succeeds.
   * @param {Function} [options.onError] - Callback on fatal recorder/upload error.
   * @param {Object} [options.chunkerConfig] - Chunker settings overrides.
   */
  constructor(options = {}) {
    this.sessionId = options.sessionId;
    this.sessionToken = options.sessionToken;
    this.device = options.device || 'doctor';
    this.apiBaseUrl = (options.apiBaseUrl || '').replace(/\/+$/, '');
    this.onLoudness = options.onLoudness || (() => {});
    this.onChunkReady = options.onChunkReady || (() => {});
    this.onChunkUploaded = options.onChunkUploaded || (() => {});
    this.onError = options.onError || (() => {});
    this.chunkerConfig = { ...DEFAULT_CHUNKER_CONFIG, ...(options.chunkerConfig || {}) };

    this.mediaStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.meterInterval = null;

    this.isRecording = false;
    this.currentSeq = 0;
    this.chunkStartWallMs = 0;
    this.sessionStartWallMs = 0;
    this.activeSamples = [];
    this.activeRecorder = null;
    this.activeChunksData = [];

    this.uploadQueue = [];
    this.isUploading = false;
    this.totalChunksExpected = 0;
    this.chunkFinalization = Promise.resolve();
    this.finalizationError = null;
    this.stopPromise = null;
  }

  /**
   * Requests microphone access and prepares the AudioContext & Analyser.
   */
  async initMicrophone() {
    if (this.mediaStream) return true;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      return true;
    } catch (err) {
      this.onError(new Error(`Microphone access denied or unavailable: ${err.message}`));
      return false;
    }
  }

  /**
   * Starts real-time loudness metering (for placement and level checking).
   */
  startLevelMeter() {
    if (this.meterInterval) return;

    const dataArray = new Uint8Array(this.analyser ? this.analyser.fftSize : 512);

    this.meterInterval = setInterval(() => {
      if (!this.analyser) return;

      this.analyser.getByteTimeDomainData(dataArray);
      const { dbfs } = calculateLoudnessFromByteData(dataArray);

      this.onLoudness(dbfs);

      // If active recording, also record samples for chunk boundary evaluation
      if (this.isRecording) {
        const now = Date.now();
        this.activeSamples.push({ timestampMs: now, dbfs });
        this.checkChunkBoundary(now);
      }
    }, 100); // Sample every 100ms
  }

  /**
   * Stops real-time level metering.
   */
  stopLevelMeter() {
    if (this.meterInterval) {
      clearInterval(this.meterInterval);
      this.meterInterval = null;
    }
  }

  /**
   * Records a short audio sample to test the speech-to-text pipeline.
   *
   * @param {number} [durationMs=3000]
   * @param {Function} [onCountdown] - Callback receiving remaining seconds (e.g. 3, 2, 1).
   * @returns {Promise<Blob>}
   */
  async recordTestSample(durationMs = 3000, onCountdown = null) {
    if (!this.mediaStream) {
      const ok = await this.initMicrophone();
      if (!ok) throw new Error('Microphone not initialized');
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    let mimeType = 'audio/webm;codecs=opus';
    if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    }

    return new Promise((resolve, reject) => {
      try {
        const recorder = new MediaRecorder(this.mediaStream, mimeType ? { mimeType } : undefined);
        const chunks = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        recorder.onstop = () => {
          const finalBlob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          resolve(finalBlob);
        };

        recorder.onerror = (e) => {
          reject(e.error || new Error('Test recording error'));
        };

        recorder.start();

        const totalSeconds = Math.ceil(durationMs / 1000);
        let remaining = totalSeconds;
        if (onCountdown) onCountdown(remaining);

        const countdownInterval = setInterval(() => {
          remaining -= 1;
          if (onCountdown && remaining >= 0) onCountdown(remaining);
          if (remaining <= 0) {
            clearInterval(countdownInterval);
          }
        }, 1000);

        setTimeout(() => {
          clearInterval(countdownInterval);
          if (recorder.state === 'recording') {
            recorder.stop();
          }
        }, durationMs);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Starts consultation recording.
   */
  async startRecording() {
    if (!this.mediaStream) {
      const ok = await this.initMicrophone();
      if (!ok) return false;
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.isRecording = true;
    this.currentSeq = 0;
    this.sessionStartWallMs = Date.now();
    this.chunkStartWallMs = this.sessionStartWallMs;
    this.activeSamples = [];
    this.uploadQueue = [];
    this.chunkFinalization = Promise.resolve();
    this.finalizationError = null;
    this.stopPromise = null;

    this.startLevelMeter();
    this.startFreshChunkRecorder();

    // Report capture zero device clock timestamp to backend
    fetch(`${this.apiBaseUrl}/api/consults/${this.sessionId}/devices/${this.device}/capture-started`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        capture_zero_device_ms: this.sessionStartWallMs,
        captureZeroDeviceMs: this.sessionStartWallMs,
      }),
    }).catch((err) => {
      console.warn('capture-started notification warning:', err.message);
    });

    return true;
  }

  /**
   * Starts a fresh MediaRecorder instance for a chunk.
   */
  startFreshChunkRecorder() {
    if (!this.mediaStream) return;

    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    }

    const recorder = new MediaRecorder(this.mediaStream, mimeType ? { mimeType } : undefined);
    const chunkData = [];
    this.activeRecorder = recorder;
    this.activeChunksData = chunkData;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        // This recorder owns this buffer, including data delivered after stop().
        // A subsequent recorder must never receive its predecessor's bytes.
        chunkData.push(event.data);
      }
    };

    recorder.start(100); // Collect slice every 100ms
  }

  /**
   * Checks whether the current chunk has reached boundary conditions.
   */
  checkChunkBoundary(now) {
    if (!this.isRecording) return;

    const evaluation = evaluateChunkBoundary({
      samples: this.activeSamples,
      chunkStartMs: this.chunkStartWallMs,
      currentMs: now,
      config: this.chunkerConfig,
    });

    if (evaluation.shouldCut) {
      this.cutAndHandoverChunk(now);
    }
  }

  /**
   * Cuts current chunk and hands over to next recorder seamlessly.
   */
  cutAndHandoverChunk(now, isFinal = false) {
    const prevRecorder = this.activeRecorder;
    const prevData = this.activeChunksData;
    const prevSamples = [...this.activeSamples];
    const seq = this.currentSeq;
    const startMs = this.chunkStartWallMs - this.sessionStartWallMs;
    const durationMs = Math.max(100, now - this.chunkStartWallMs);

    // 1. Advance state for next chunk
    this.currentSeq++;
    this.chunkStartWallMs = now;
    this.activeSamples = [];

    // 2. Start next recorder BEFORE stopping previous (zero audio gap!)
    if (!isFinal && this.isRecording) {
      this.startFreshChunkRecorder();
    } else {
      this.activeRecorder = null;
    }

    const finalizationError = () => Object.assign(
      new Error('Audio chunk could not be finalized'), { code: 'ERR_AUDIO_CHUNK_FINALIZE' },
    );

    // 3. Wait for the old recorder's final dataavailable event followed by stop.
    // Resolve errors as values here so an out-of-order event cannot cause an
    // unhandled rejection while an earlier chunk is still finalizing.
    const dataReady = new Promise((resolve) => {
      if (!prevRecorder || prevRecorder.state === 'inactive') {
        resolve({ error: finalizationError() });
        return;
      }
      prevRecorder.onerror = () => resolve({ error: finalizationError() });
      prevRecorder.onstop = () => {
        const mimeType = prevRecorder.mimeType || 'audio/webm';
        const blob = new Blob(prevData, { type: mimeType });
        prevData.length = 0;
        prevRecorder.ondataavailable = null;
        prevRecorder.onstop = null;
        prevRecorder.onerror = null;
        const silent = isChunkSilent(prevSamples, this.chunkerConfig.silenceDbfs);

        const chunkPayload = {
          seq,
          startMs,
          durationMs,
          blob,
          codec: mimeType,
          isSilent: silent,
          avgDbfs: prevSamples.length > 0
            ? prevSamples.reduce((sum, s) => sum + s.dbfs, 0) / prevSamples.length
            : null,
        };

        resolve({ chunkPayload });
      };

      try {
        prevRecorder.stop();
      } catch (_err) {
        resolve({ error: finalizationError() });
      }
    });

    // Package and upload in sequence even if overlapping recorders fire stop
    // events out of order. Stop must await this entire chain before the marker.
    this.chunkFinalization = this.chunkFinalization.then(async () => {
      const result = await dataReady;
      if (result.error) throw result.error;
      this.onChunkReady(result.chunkPayload);
      this.enqueueUpload(result.chunkPayload);
    });
    this.chunkFinalization.catch((err) => {
      if (!this.finalizationError) {
        this.finalizationError = err;
        this.onError(err);
      }
    });
    return this.chunkFinalization;
  }

  /**
   * Enqueues a chunk payload for sequential HTTP upload.
   */
  enqueueUpload(chunkPayload) {
    this.uploadQueue.push(chunkPayload);
    this.processUploadQueue();
  }

  /**
   * Processes the upload queue sequentially with exponential backoff.
   */
  async processUploadQueue() {
    if (this.isUploading || this.uploadQueue.length === 0) return;
    this.isUploading = true;

    const chunk = this.uploadQueue[0];
    let attempts = 0;
    const maxAttempts = DEFAULT_UPLOAD_BACKOFF_MS.length;

    while (attempts < maxAttempts) {
      try {
        const url = new URL(`${this.apiBaseUrl}/api/consults/${this.sessionId}/chunks`);
        url.searchParams.set('device', 'doctor');
        url.searchParams.set('seq', String(chunk.seq));
        url.searchParams.set('start_ms', String(chunk.startMs));
        url.searchParams.set('duration_ms', String(chunk.durationMs));
        url.searchParams.set('codec', chunk.codec);
        url.searchParams.set('is_silent', String(chunk.isSilent));
        if (chunk.avgDbfs !== null) {
          url.searchParams.set('avg_dbfs', String(chunk.avgDbfs.toFixed(1)));
        }

        const headers = {
          Authorization: `Bearer ${this.sessionToken}`,
          'Content-Type': chunk.codec || 'audio/webm',
          'x-device': this.device,
          'x-seq': String(chunk.seq),
          'x-start-ms': String(chunk.startMs),
          'x-duration-ms': String(chunk.durationMs),
          'x-codec': chunk.codec,
          'x-silent': String(chunk.isSilent),
          'x-avg-dbfs': chunk.avgDbfs !== null ? String(chunk.avgDbfs.toFixed(1)) : '0',
        };

        const res = await fetch(url.toString(), {
          method: 'POST',
          headers,
          body: chunk.blob,
        });

        if (!res.ok) {
          throw new Error(`Upload HTTP error ${res.status}`);
        }

        const data = await res.json();

        // Successfully uploaded! Remove from queue and notify
        this.uploadQueue.shift();
        this.onChunkUploaded({
          seq: chunk.seq,
          chunkId: data.chunkId,
          status: data.status,
          remainingQueue: this.uploadQueue.length,
        });

        break; // Exit retry loop
      } catch (uploadErr) {
        attempts++;
        if (attempts >= maxAttempts) {
          this.onError(new Error(`Failed to upload chunk ${chunk.seq} after ${maxAttempts} attempts: ${uploadErr.message}`));
          this.uploadQueue.shift(); // Drop failing chunk to avoid stalling whole queue
          break;
        }

        const backoffMs = DEFAULT_UPLOAD_BACKOFF_MS[attempts - 1] || 1000;
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    this.isUploading = false;

    // Process next chunk if queue has more
    if (this.uploadQueue.length > 0) {
      this.processUploadQueue();
    }
  }

  /**
   * Stops consultation recording, flushes final chunk, and posts the final marker.
   */
  stopRecording() {
    if (this.stopPromise) return this.stopPromise;
    if (!this.isRecording) return Promise.resolve();
    this.isRecording = false;

    const now = Date.now();
    this.stopPromise = (async () => {
      try {
        this.cutAndHandoverChunk(now, true);
        this.totalChunksExpected = this.currentSeq;
        this.stopLevelMeter();
        await this.chunkFinalization;

        // All recorder callbacks have enqueued their chunks before this check.
        while (this.uploadQueue.length > 0 || this.isUploading) {
          await new Promise((r) => setTimeout(r, 200));
        }
        await this.sendFinalMarker(this.totalChunksExpected);
      } finally {
        this.cleanup();
      }
    })();
    return this.stopPromise;
  }

  /**
   * Sends final device marker declaring total expected chunks.
   */
  async sendFinalMarker(totalChunks) {
    try {
      const url = `${this.apiBaseUrl}/api/consults/${this.sessionId}/devices/${this.device}/final`;
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          total_chunks: totalChunks,
          totalChunks,
        }),
      });
    } catch (err) {
      this.onError(new Error(`Failed to record final marker: ${err.message}`));
    }
  }

  /**
   * Releases microphone tracks and AudioContext resources.
   */
  cleanup() {
    this.stopLevelMeter();

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {}
      this.audioContext = null;
    }

    this.analyser = null;
    this.activeRecorder = null;
  }
}
