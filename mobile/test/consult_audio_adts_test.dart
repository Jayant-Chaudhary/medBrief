import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:record/record.dart';
import 'package:health_on_patient/features/consult_audio/adts_chunk_assembler.dart';
import 'package:health_on_patient/features/consult_audio/patient_recorder.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_config.dart';
import 'consult_audio_test_helpers.dart';

void main() {
  test('ADTS headers and frames split across callbacks retain every byte', () {
    final assembler = AdtsChunkAssembler();
    final frame = syntheticAdtsFrame();
    for (final value in frame) {
      assembler.ingestBytes([value]);
    }
    expect(assembler.activeFrameCount, 1);
    expect(assembler.activeDurationMs, 64);
    expect(assembler.flush()!.bytes, frame);
  });
  test('corrupt, truncated and incompatible ADTS are explicit failures', () {
    expect(
      () => AdtsChunkAssembler().ingestBytes(List.filled(10, 1)),
      throwsFormatException,
    );
    final truncated = AdtsChunkAssembler()
      ..ingestBytes(syntheticAdtsFrame().sublist(0, 10));
    expect(truncated.flush, throwsFormatException);
    final invalidRate = syntheticAdtsFrame()..[2] = 124;
    expect(
      () => AdtsChunkAssembler().ingestBytes(invalidRate),
      throwsFormatException,
    );
  });
  test(
    'stop drains the final encoder event and awaits asynchronous chunk persistence',
    () async {
      final source = SyntheticRecorderSource()..tail = syntheticAdtsFrame();
      final saved = Completer<void>();
      final delivered = Completer<void>();
      final recorder = PatientRecorder(
        source: source,
        onChunkReady: (chunk) async {
          expect(chunk.frameCount, 1);
          delivered.complete();
          await saved.future;
        },
      );
      await recorder.startRecording(initialTimelineMs: 0);
      var stopped = false;
      final first = recorder.stopRecording().then((_) {
        stopped = true;
      });
      final second = recorder.stopRecording();
      await delivered.future;
      expect(stopped, false);
      saved.complete();
      await Future.wait([first, second]);
      expect(stopped, true);
      await recorder.dispose();
    },
  );
  test('one callback can contain multiple independently cut chunks', () async {
    final source = SyntheticRecorderSource();
    final chunks = <PreparedChunkData>[];
    final recorder = PatientRecorder(
      source: source,
      config: const ConsultAudioConfig(chunkHardCapMs: 128),
      onChunkReady: (chunk) async {
        chunks.add(chunk);
      },
    );
    await recorder.startRecording(initialTimelineMs: 0);
    source.emit([for (int i = 0; i < 5; i++) ...syntheticAdtsFrame()]);
    await recorder.stopRecording();
    expect(chunks.map((c) => c.frameCount), [2, 2, 1]);
    expect(chunks.map((c) => c.chunkStartMs), [0, 128, 256]);
    expect(
      chunks.every((c) => !c.isSilent),
      true,
      reason: 'No meter samples cannot prove silence',
    );
    await recorder.dispose();
  });
  test(
    'a focus interruption is explicit and does not reset sequence timing',
    () async {
      final source = SyntheticRecorderSource();
      final gaps = <int>[];
      final chunks = <PreparedChunkData>[];
      final recorder = PatientRecorder(
        source: source,
        onChunkReady: (chunk) async {
          chunks.add(chunk);
        },
        onInterruption: (gap) async {
          gaps.add(gap.durationMs);
        },
      );
      await recorder.startRecording(initialTimelineMs: 100);
      source.emit(syntheticAdtsFrame());
      await Future<void>.delayed(Duration.zero);
      source.states.add(RecordState.pause);
      await Future<void>.delayed(const Duration(milliseconds: 2));
      source.states.add(RecordState.record);
      source.emit(syntheticAdtsFrame());
      await recorder.stopRecording();
      expect(gaps.single, greaterThan(0));
      expect(
        chunks.last.chunkStartMs,
        greaterThanOrEqualTo(chunks.first.chunkEndMs),
      );
      await recorder.dispose();
    },
  );
  test(
    'real ffmpeg decodes every Dart-assembled chunk across a 55 second stream',
    () async {
      final locate = await Process.run('node', [
        '-p',
        "require('ffmpeg-static')",
      ], workingDirectory: '../server');
      expect(locate.exitCode, 0);
      final executable = (locate.stdout as String).trim();
      final encode = await Process.run(executable, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=16000:duration=55',
        '-ac',
        '1',
        '-c:a',
        'aac',
        '-b:a',
        '32000',
        '-f',
        'adts',
        'pipe:1',
      ], stdoutEncoding: null);
      expect(encode.exitCode, 0);
      final input = encode.stdout as List<int>;
      final chunks = <AssembledAdtsChunk>[];
      late AdtsChunkAssembler parser;
      parser = AdtsChunkAssembler(
        onFrame: () {
          if (parser.activeDurationMs + parser.frameDurationMs > 25000) {
            chunks.add(parser.sealActiveChunk()!);
          }
        },
      );
      final sizes = [1, 7, 13, 1024, 31, 8192];
      int offset = 0, index = 0;
      while (offset < input.length) {
        final end = (offset + sizes[index++ % sizes.length]).clamp(
          0,
          input.length,
        );
        parser.ingestBytes(input.sublist(offset, end));
        offset = end;
      }
      chunks.add(parser.flush()!);
      expect(chunks.length, 3);
      expect(chunks.every((c) => c.durationMs <= 25000), true);
      expect(chunks.fold(0, (int n, c) => n + c.bytes.length), input.length);
      for (final chunk in chunks) {
        final child = await Process.start(executable, [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-ar',
          '16000',
          '-ac',
          '1',
          '-f',
          'wav',
          'pipe:1',
        ]);
        final output = child.stdout.fold<BytesBuilder>(
          BytesBuilder(),
          (b, data) => b..add(data),
        );
        final diagnostics = child.stderr.drain<void>();
        child.stdin.add(chunk.bytes);
        await child.stdin.close();
        expect(await child.exitCode, 0);
        final wav = (await output).takeBytes();
        await diagnostics;
        expect(String.fromCharCodes(wav.sublist(0, 4)), 'RIFF');
        expect(wav.length, greaterThan(44));
      }
    },
    timeout: const Timeout(Duration(seconds: 30)),
  );
}
