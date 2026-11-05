import { describe, it, expect } from 'vitest';
import {
  evaluateChunkBoundary,
  isChunkSilent,
  calculateLoudnessFromByteData,
  DEFAULT_CHUNKER_CONFIG,
} from '../utils/audioChunker';

describe('audioChunker - Pure Function Boundary & Silence Evaluator', () => {
  it('does not cut chunk before chunkMinMs (15s) even with silence', () => {
    const samples = [
      { timestampMs: 5000, dbfs: -60 },
      { timestampMs: 6000, dbfs: -60 },
      { timestampMs: 7000, dbfs: -60 },
    ];

    const result = evaluateChunkBoundary({
      samples,
      chunkStartMs: 0,
      currentMs: 7000,
    });

    expect(result.shouldCut).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('cuts chunk after 15s upon detecting a pause of >= 500ms', () => {
    // 15 seconds of speech (-20 dBFS) followed by 600ms pause (-60 dBFS)
    const samples = [
      { timestampMs: 14000, dbfs: -20 },
      { timestampMs: 14500, dbfs: -20 },
      { timestampMs: 15000, dbfs: -20 },
      { timestampMs: 15200, dbfs: -60 },
      { timestampMs: 15400, dbfs: -60 },
      { timestampMs: 15700, dbfs: -60 },
    ];

    const result = evaluateChunkBoundary({
      samples,
      chunkStartMs: 0,
      currentMs: 15700,
    });

    expect(result.shouldCut).toBe(true);
    expect(result.reason).toBe('pause');
    expect(result.cutMs).toBe(15700);
  });

  it('does not cut after 15s if pause is shorter than pauseMs (< 500ms)', () => {
    const samples = [
      { timestampMs: 14500, dbfs: -20 },
      { timestampMs: 15000, dbfs: -20 },
      { timestampMs: 15200, dbfs: -60 },
      { timestampMs: 15400, dbfs: -20 }, // Speech resumed!
    ];

    const result = evaluateChunkBoundary({
      samples,
      chunkStartMs: 0,
      currentMs: 15400,
    });

    expect(result.shouldCut).toBe(false);
  });

  it('cuts chunk at hard cap (25s) even when speech is continuous', () => {
    // Continuous speech with no pauses at all
    const samples = [
      { timestampMs: 20000, dbfs: -15 },
      { timestampMs: 22000, dbfs: -15 },
      { timestampMs: 24000, dbfs: -15 },
      { timestampMs: 25100, dbfs: -15 },
    ];

    const result = evaluateChunkBoundary({
      samples,
      chunkStartMs: 0,
      currentMs: 25100,
    });

    expect(result.shouldCut).toBe(true);
    expect(result.reason).toBe('hard_cap');
  });

  it('correctly classifies silent chunks', () => {
    const silentSamples = [
      { timestampMs: 1000, dbfs: -55 },
      { timestampMs: 5000, dbfs: -60 },
      { timestampMs: 15000, dbfs: -52 },
    ];

    expect(isChunkSilent(silentSamples, -45)).toBe(true);
    expect(isChunkSilent([], -45)).toBe(true);
  });

  it('correctly classifies active speech chunks as non-silent', () => {
    const speechSamples = [
      { timestampMs: 1000, dbfs: -55 },
      { timestampMs: 5000, dbfs: -18 }, // Vocal peak
      { timestampMs: 10000, dbfs: -22 },
      { timestampMs: 15000, dbfs: -52 },
    ];

    expect(isChunkSilent(speechSamples, -45)).toBe(false);
  });

  it('calculates RMS and dBFS accurately from byte array', () => {
    // Pure silence array (all centered at 128)
    const silentBytes = new Uint8Array(1024).fill(128);
    const silentLoudness = calculateLoudnessFromByteData(silentBytes);
    expect(silentLoudness.rms).toBe(0);
    expect(silentLoudness.dbfs).toBe(-100);

    // Sine-like or active signal (alternating 0 and 255)
    const activeBytes = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      activeBytes[i] = i % 2 === 0 ? 0 : 255;
    }
    const activeLoudness = calculateLoudnessFromByteData(activeBytes);
    expect(activeLoudness.rms).toBeGreaterThan(0.9);
    expect(activeLoudness.dbfs).toBeGreaterThan(-5); // Near 0 dBFS
  });

  describe('Shared Cross-Platform Fixtures (chunker-cases.json)', () => {
    const fixture = require('../../../tools/simulate-device/fixtures/chunker-cases.json');

    fixture.boundaryCases.forEach((tc) => {
      it(`boundary: ${tc.name}`, () => {
        const result = evaluateChunkBoundary({
          samples: tc.samples,
          chunkStartMs: tc.chunkStartMs,
          currentMs: tc.currentMs,
        });
        expect(result.shouldCut).toBe(tc.expected.shouldCut);
        expect(result.reason).toBe(tc.expected.reason);
        expect(result.cutMs).toBe(tc.expected.cutMs);
      });
    });

    fixture.silenceCases.forEach((tc) => {
      it(`silence: ${tc.name}`, () => {
        const isSilent = isChunkSilent(tc.samples, tc.silenceDbfs);
        expect(isSilent).toBe(tc.expectedSilent);
      });
    });
  });
});
