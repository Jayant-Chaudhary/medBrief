import 'dart:math' as math;

import 'consult_audio_config.dart';
import 'consult_audio_models.dart';

/// Pure Function Audio Chunker.
///
/// Implements deterministic chunk-cutting logic and silence checks
/// based on consultation pipeline rules (min 15s, pause 500ms, hard cap 25s, -45 dBFS).
///
/// Completely decoupled from device APIs for deterministic unit testing.

class ChunkBoundaryDecision {
  const ChunkBoundaryDecision({
    required this.shouldCut,
    this.reason,
    this.cutMs,
  });

  final bool shouldCut;
  final String? reason; // 'hard_cap', 'pause', or null
  final int? cutMs;
}

class LoudnessResult {
  const LoudnessResult({required this.rms, required this.dbfs});

  final double rms;
  final double dbfs;
}

/// Evaluates whether an active recording chunk should be cut.
ChunkBoundaryDecision evaluateChunkBoundary({
  List<LoudnessSample> samples = const [],
  int chunkStartMs = 0,
  required int currentMs,
  ConsultAudioConfig config = ConsultAudioConfig.defaultInstance,
}) {
  final elapsedMs = math.max(0, currentMs - chunkStartMs);

  // Rule 1: Hard Cap (25 seconds) — must cut regardless of speech
  if (elapsedMs >= config.chunkHardCapMs) {
    return ChunkBoundaryDecision(
      shouldCut: true,
      reason: 'hard_cap',
      cutMs: currentMs,
    );
  }

  // Rule 2: Minimum duration (15 seconds) not yet reached
  if (elapsedMs < config.chunkMinMs) {
    return const ChunkBoundaryDecision(
      shouldCut: false,
      reason: null,
      cutMs: null,
    );
  }

  // Rule 3: After chunkMinMs, look for a pause of at least pauseMs
  if (samples.isEmpty) {
    return const ChunkBoundaryDecision(
      shouldCut: false,
      reason: null,
      cutMs: null,
    );
  }

  // Count backwards from latest sample to find consecutive silence duration
  int silenceDurationMs = 0;
  for (int i = samples.length - 1; i >= 0; i--) {
    final s = samples[i];
    if (s.dbfs <= config.silenceDbfs) {
      final prevTime = i > 0 ? samples[i - 1].timestampMs : chunkStartMs;
      silenceDurationMs += math.max(0, s.timestampMs - prevTime);
      if (silenceDurationMs >= config.pauseMs) {
        return ChunkBoundaryDecision(
          shouldCut: true,
          reason: 'pause',
          cutMs: currentMs,
        );
      }
    } else {
      // Encountered vocal speech; pause was broken
      break;
    }
  }

  return const ChunkBoundaryDecision(
    shouldCut: false,
    reason: null,
    cutMs: null,
  );
}

/// Checks whether an array of loudness samples constitutes a silent chunk.
bool isChunkSilent(List<LoudnessSample> samples, [double silenceDbfs = -45.0]) {
  if (samples.isEmpty) return true;

  double totalDbfs = 0.0;
  bool hasVoice = false;

  for (final s in samples) {
    totalDbfs += s.dbfs;
    if (s.dbfs > silenceDbfs) {
      hasVoice = true;
    }
  }

  final avgDbfs = totalDbfs / samples.length;
  return !hasVoice || avgDbfs <= silenceDbfs;
}

/// Calculates RMS and dBFS from raw 8-bit time-domain byte array.
LoudnessResult calculateLoudnessFromByteData(List<int> byteData) {
  if (byteData.isEmpty) {
    return const LoudnessResult(rms: 0.0, dbfs: -100.0);
  }

  double sumSquares = 0.0;
  for (int i = 0; i < byteData.length; i++) {
    final norm = (byteData[i] - 128) / 128.0;
    sumSquares += norm * norm;
  }

  final rms = math.sqrt(sumSquares / byteData.length);
  final dbfs = rms > 0.00001
      ? math.max(-100.0, 20.0 * (math.log(rms) / math.ln10))
      : -100.0;

  return LoudnessResult(rms: rms, dbfs: dbfs);
}
