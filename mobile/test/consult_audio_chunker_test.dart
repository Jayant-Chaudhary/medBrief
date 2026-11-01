import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/features/consult_audio/audio_chunker.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_config.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_models.dart';

void main() {
  group('audioChunker - Pure Function Boundary & Silence Evaluator (Dart)', () {
    test('does not cut chunk before chunkMinMs (15s) even with silence', () {
      final samples = [
        const LoudnessSample(timestampMs: 5000, dbfs: -60),
        const LoudnessSample(timestampMs: 6000, dbfs: -60),
        const LoudnessSample(timestampMs: 7000, dbfs: -60),
      ];

      final result = evaluateChunkBoundary(
        samples: samples,
        chunkStartMs: 0,
        currentMs: 7000,
      );

      expect(result.shouldCut, isFalse);
      expect(result.reason, isNull);
    });

    test('cuts chunk after 15s upon detecting a pause of >= 500ms', () {
      final samples = [
        const LoudnessSample(timestampMs: 14000, dbfs: -20),
        const LoudnessSample(timestampMs: 14500, dbfs: -20),
        const LoudnessSample(timestampMs: 15000, dbfs: -20),
        const LoudnessSample(timestampMs: 15200, dbfs: -60),
        const LoudnessSample(timestampMs: 15400, dbfs: -60),
        const LoudnessSample(timestampMs: 15700, dbfs: -60),
      ];

      final result = evaluateChunkBoundary(
        samples: samples,
        chunkStartMs: 0,
        currentMs: 15700,
      );

      expect(result.shouldCut, isTrue);
      expect(result.reason, 'pause');
      expect(result.cutMs, 15700);
    });

    test(
      'does not cut after 15s if pause is shorter than pauseMs (< 500ms)',
      () {
        final samples = [
          const LoudnessSample(timestampMs: 14500, dbfs: -20),
          const LoudnessSample(timestampMs: 15000, dbfs: -20),
          const LoudnessSample(timestampMs: 15200, dbfs: -60),
          const LoudnessSample(timestampMs: 15400, dbfs: -20),
        ];

        final result = evaluateChunkBoundary(
          samples: samples,
          chunkStartMs: 0,
          currentMs: 15400,
        );

        expect(result.shouldCut, isFalse);
      },
    );

    test('cuts chunk at hard cap (25s) even when speech is continuous', () {
      final samples = [
        const LoudnessSample(timestampMs: 20000, dbfs: -15),
        const LoudnessSample(timestampMs: 22000, dbfs: -15),
        const LoudnessSample(timestampMs: 24000, dbfs: -15),
        const LoudnessSample(timestampMs: 25100, dbfs: -15),
      ];

      final result = evaluateChunkBoundary(
        samples: samples,
        chunkStartMs: 0,
        currentMs: 25100,
      );

      expect(result.shouldCut, isTrue);
      expect(result.reason, 'hard_cap');
      expect(result.cutMs, 25100);
    });

    test('correctly classifies silent chunks', () {
      final silentSamples = [
        const LoudnessSample(timestampMs: 1000, dbfs: -55),
        const LoudnessSample(timestampMs: 5000, dbfs: -60),
        const LoudnessSample(timestampMs: 15000, dbfs: -52),
      ];

      expect(isChunkSilent(silentSamples, -45), isTrue);
      expect(isChunkSilent([], -45), isTrue);
    });

    test('correctly classifies active speech chunks as non-silent', () {
      final speechSamples = [
        const LoudnessSample(timestampMs: 1000, dbfs: -55),
        const LoudnessSample(timestampMs: 5000, dbfs: -18),
        const LoudnessSample(timestampMs: 10000, dbfs: -22),
        const LoudnessSample(timestampMs: 15000, dbfs: -52),
      ];

      expect(isChunkSilent(speechSamples, -45), isFalse);
    });

    test('calculates RMS and dBFS accurately from byte array', () {
      final silentBytes = List<int>.filled(1024, 128);
      final silentLoudness = calculateLoudnessFromByteData(silentBytes);
      expect(silentLoudness.rms, 0.0);
      expect(silentLoudness.dbfs, -100.0);

      final activeBytes = List<int>.generate(1024, (i) => i.isEven ? 0 : 255);
      final activeLoudness = calculateLoudnessFromByteData(activeBytes);
      expect(activeLoudness.rms, greaterThan(0.9));
      expect(activeLoudness.dbfs, greaterThan(-5.0));
    });

    test('matches shared cross-platform fixture (chunker-cases.json)', () {
      final fixtureFile = File(
        '../tools/simulate-device/fixtures/chunker-cases.json',
      );
      expect(
        fixtureFile.existsSync(),
        isTrue,
        reason: 'chunker-cases.json must exist',
      );

      final jsonContent =
          jsonDecode(fixtureFile.readAsStringSync()) as Map<String, dynamic>;
      final boundaryCases = (jsonContent['boundaryCases'] as List<dynamic>)
          .cast<Map<String, dynamic>>();
      final silenceCases = (jsonContent['silenceCases'] as List<dynamic>)
          .cast<Map<String, dynamic>>();

      for (final tc in boundaryCases) {
        final samples = (tc['samples'] as List<dynamic>)
            .map((s) => LoudnessSample.fromJson(s as Map<String, dynamic>))
            .toList();
        final res = evaluateChunkBoundary(
          samples: samples,
          chunkStartMs: (tc['chunkStartMs'] as num).toInt(),
          currentMs: (tc['currentMs'] as num).toInt(),
          config: ConsultAudioConfig.defaultInstance,
        );

        final expected = tc['expected'] as Map<String, dynamic>;
        expect(
          res.shouldCut,
          expected['shouldCut'],
          reason: tc['name'] as String,
        );
        expect(res.reason, expected['reason'], reason: tc['name'] as String);
        expect(res.cutMs, expected['cutMs'], reason: tc['name'] as String);
      }

      for (final tc in silenceCases) {
        final samples = (tc['samples'] as List<dynamic>)
            .map((s) => LoudnessSample.fromJson(s as Map<String, dynamic>))
            .toList();
        final silenceDbfs = (tc['silenceDbfs'] as num).toDouble();
        final res = isChunkSilent(samples, silenceDbfs);
        expect(res, tc['expectedSilent'], reason: tc['name'] as String);
      }
    });
  });
}
