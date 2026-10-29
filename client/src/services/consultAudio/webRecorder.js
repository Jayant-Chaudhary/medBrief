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
    this.activeRecorder = recorder;
    this.activeChunksData = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.activeChunksData.push(event.data);
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
    const prevData = [...this.activeChunksData];
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

    // 3. Stop previous recorder and package chunk
    if (prevRecorder && prevRecorder.state !== 'inactive') {
      prevRecorder.onstop = () => {
        const mimeType = prevRecorder.mimeType || 'audio/webm';
        const blob = new Blob(this.activeChunksData.length > 0 ? this.activeChunksData : prevData, { type: mimeType });
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

        this.onChunkReady(chunkPayload);
        this.enqueueUpload(chunkPayload);
      };

      try {
        prevRecorder.stop();
      } catch (err) {
        // Safe to ignore if already stopped
      }
    }
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
  async stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    const now = Date.now();
    this.totalChunksExpected = this.currentSeq + 1;

    // Cut final partial chunk
    this.cutAndHandoverChunk(now, true);
    this.stopLevelMeter();

    // Wait for upload queue to drain
    while (this.uploadQueue.length > 0 || this.isUploading) {
      await new Promise((r) => setTimeout(r, 200));
    }

    // Send final marker to backend
    await this.sendFinalMarker(this.totalChunksExpected);

    // Release microphone tracks
    this.cleanup();
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
