import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:record/record.dart';
import 'adts_chunk_assembler.dart';
import 'audio_chunker.dart';
import 'consult_audio_config.dart';
import 'consult_audio_models.dart';

abstract class RecorderSource {
  Future<bool> hasPermission({bool request = true});
  Future<bool> isEncoderSupported(AudioEncoder encoder);
  Future<Stream<List<int>>> startStream(RecordConfig config);
  Stream<RecordState> get stateChanges;
  Future<Amplitude> getAmplitude();
  Future<void> stop();
  Future<void> dispose();
}

class RecordPackageRecorderSource implements RecorderSource {
  RecordPackageRecorderSource([AudioRecorder? recorder])
    : _recorder = recorder ?? AudioRecorder();
  final AudioRecorder _recorder;
  @override
  Future<bool> hasPermission({bool request = true}) =>
      _recorder.hasPermission(request: request);
  @override
  Future<bool> isEncoderSupported(AudioEncoder encoder) =>
      _recorder.isEncoderSupported(encoder);
  @override
  Future<Stream<List<int>>> startStream(RecordConfig config) =>
      _recorder.startStream(config);
  @override
  Stream<RecordState> get stateChanges => _recorder.onStateChanged();
  @override
  Future<Amplitude> getAmplitude() => _recorder.getAmplitude();
  @override
  Future<void> stop() async {
    await _recorder.stop();
  }

  @override
  Future<void> dispose() => _recorder.dispose();
}

class PreparedChunkData {
  const PreparedChunkData({
    required this.bytes,
    required this.chunkStartMs,
    required this.chunkEndMs,
    required this.isSilent,
    required this.avgDbfs,
    required this.frameCount,
  });
  final Uint8List bytes;
  final int chunkStartMs, chunkEndMs, frameCount;
  final bool isSilent;
  final double avgDbfs;
}

/// All tail events and asynchronous file writes finish before stop resolves.
class PatientRecorder {
  PatientRecorder({
    RecorderSource? source,
    this.config = ConsultAudioConfig.defaultInstance,
    this.onChunkReady,
    this.onLoudnessSample,
    this.onError,
    this.onInterruption,
  }) : _source = source ?? RecordPackageRecorderSource() {
    _assembler = AdtsChunkAssembler(
      fallbackSampleRate: config.sampleRate,
      onFrame: _onFrame,
    );
  }
  final RecorderSource _source;
  final ConsultAudioConfig config;
  late final AdtsChunkAssembler _assembler;
  Future<void> Function(PreparedChunkData chunk)? onChunkReady;
  void Function(double dbfs)? onLoudnessSample;
  void Function(String code)? onError;
  Future<void> Function(InterruptionGap gap)? onInterruption;
  StreamSubscription<List<int>>? _streamSubscription;
  StreamSubscription<RecordState>? _stateSubscription;
  Timer? _meterTimer;
  Completer<void>? _streamDone;
  Future<void>? _stop;
  Future<void> _delivery = Future.value();
  final _clock = Stopwatch();
  final List<LoudnessSample> _samples = [];
  bool _recording = false,
      _stopping = false,
      _meterBusy = false,
      _failed = false;
  int _timelineBase = 0, _chunkStart = 0;
  int? _gapStart;
  bool get isRecording => _recording;
  int get timelineNow => _timelineBase + _clock.elapsedMilliseconds;

  Future<bool> checkPrerequisites({bool request = true}) async =>
      await _source.hasPermission(request: request) &&
      await _source.isEncoderSupported(AudioEncoder.aacLc);

  RecordConfig get _recordConfig => RecordConfig(
    encoder: AudioEncoder.aacLc,
    sampleRate: config.sampleRate,
    bitRate: config.bitRate,
    numChannels: 1,
    audioInterruption: AudioInterruptionMode.pauseResume,
  );

  Future<void> checkLevels() async {
    if (!await checkPrerequisites(request: false)) {
      throw StateError('ERR_AUDIO_PERMISSION');
    }
    final done = Completer<void>();
    final stream = await _source.startStream(_recordConfig);
    final subscription = stream.listen(
      (_) {},
      onDone: () => done.complete(),
      onError: (Object _) {
        if (!done.isCompleted) done.complete();
      },
    );
    final timer = Timer.periodic(
      Duration(milliseconds: config.meterIntervalMs),
      (_) async {
        try {
          onLoudnessSample?.call((await _source.getAmplitude()).current);
        } catch (_) {}
      },
    );
    try {
      await Future<void>.delayed(Duration(milliseconds: config.levelCheckMs));
    } finally {
      timer.cancel();
      await _source.stop();
      await done.future.timeout(
        Duration(milliseconds: config.encoderDrainTimeoutMs),
      );
      await subscription.cancel();
    }
  }

  Future<void> startRecording({required int initialTimelineMs}) async {
    if (_recording) return;
    if (!await checkPrerequisites(request: false)) {
      throw StateError('ERR_AUDIO_PERMISSION');
    }
    _stop = null;
    _stopping = false;
    _failed = false;
    _assembler.reset();
    _samples.clear();
    _delivery = Future.value();
    _timelineBase = initialTimelineMs;
    _chunkStart = initialTimelineMs;
    _clock
      ..reset()
      ..start();
    _streamDone = Completer<void>();
    _stateSubscription = _source.stateChanges.listen(
      _onState,
      onError: (Object _) => _fail('ERR_AUDIO_STATE'),
    );
    final stream = await _source.startStream(_recordConfig);
    _recording = true;
    _streamSubscription = stream.listen(
      (bytes) {
        if (!_recording || _failed) return;
        try {
          _assembler.ingestBytes(bytes);
        } catch (_) {
          _fail('ERR_AUDIO_FORMAT');
        }
      },
      onError: (Object _) => _fail('ERR_AUDIO_STREAM'),
      onDone: () {
        if (!_streamDone!.isCompleted) _streamDone!.complete();
        if (!_stopping) _fail('ERR_AUDIO_STREAM_ENDED');
      },
    );
    _meterTimer = Timer.periodic(
      Duration(milliseconds: config.meterIntervalMs),
      (_) => _meter(),
    );
  }

  void _onFrame() {
    if (_assembler.activeBytesLength > config.chunkMaxBytes) {
      _fail('ERR_AUDIO_CHUNK_SIZE');
      return;
    }
    final duration = _assembler.activeDurationMs;
    final shouldCut =
        duration + _assembler.frameDurationMs > config.chunkHardCapMs ||
        evaluateChunkBoundary(
          samples: _samples,
          chunkStartMs: _chunkStart,
          currentMs: _chunkStart + duration,
          config: config,
        ).shouldCut;
    if (shouldCut) _seal();
  }

  Future<void> _meter() async {
    if (!_recording || _stopping || _meterBusy || _gapStart != null) return;
    _meterBusy = true;
    try {
      final dbfs = (await _source.getAmplitude()).current;
      if (dbfs.isFinite) {
        _samples.add(LoudnessSample(timestampMs: timelineNow, dbfs: dbfs));
        onLoudnessSample?.call(dbfs);
      }
    } catch (_) {
      _fail('ERR_AUDIO_METER');
    } finally {
      _meterBusy = false;
    }
  }

  void _queueDelivery(Future<void> Function() action) {
    _delivery = _delivery.then((_) => action());
    unawaited(
      _delivery.catchError((Object _) {
        _fail('ERR_AUDIO_SAVE');
      }),
    );
  }

  void _seal() {
    final chunk = _assembler.sealActiveChunk();
    if (chunk == null) return;
    // An unobserved microphone level is not proof of silence: retain audio.
    final silent =
        _samples.isNotEmpty && isChunkSilent(_samples, config.silenceDbfs);
    final avg = _samples.isEmpty
        ? config.silenceDbfs
        : _samples.fold(0.0, (sum, sample) => sum + sample.dbfs) /
              _samples.length;
    final start = _chunkStart;
    _chunkStart += chunk.durationMs;
    final data = PreparedChunkData(
      bytes: chunk.bytes,
      chunkStartMs: start,
      chunkEndMs: _chunkStart,
      isSilent: silent,
      avgDbfs: avg,
      frameCount: chunk.frameCount,
    );
    _samples.clear();
    _queueDelivery(() async {
      await onChunkReady?.call(data);
    });
  }

  void _onState(RecordState state) {
    if (!_recording || _stopping) return;
    if (state == RecordState.pause && _gapStart == null) {
      _seal();
      _gapStart = math.max(_chunkStart, timelineNow);
    } else if (state == RecordState.record && _gapStart != null) {
      final end = math.max(_gapStart! + 1, timelineNow);
      final gap = InterruptionGap(
        gapId: newOpaqueId(),
        startMs: _gapStart!,
        durationMs: end - _gapStart!,
        reasonCode: 'focus_lost',
      );
      _gapStart = null;
      _chunkStart = end;
      _queueDelivery(() async {
        await onInterruption?.call(gap);
      });
    } else if (state == RecordState.stop) {
      _fail('ERR_AUDIO_STOPPED');
    }
  }

  void _fail(String code) {
    if (_failed) return;
    _failed = true;
    onError?.call(code);
  }

  Future<void> stopRecording() => _stop ??= _finish();
  Future<void> _finish() async {
    if (!_recording) return;
    _stopping = true;
    _meterTimer?.cancel();
    try {
      // Keep the subscription alive: record explicitly requires its close event
      // to receive all encoder output, including bytes emitted by stop().
      await _source.stop();
      await _streamDone!.future.timeout(
        Duration(milliseconds: config.encoderDrainTimeoutMs),
      );
      _seal();
      if (_assembler.pendingBytesLength != 0) _fail('ERR_AUDIO_TRUNCATED');
      if (_gapStart != null) {
        final end = math.max(_gapStart! + 1, timelineNow);
        final gap = InterruptionGap(
          gapId: newOpaqueId(),
          startMs: _gapStart!,
          durationMs: end - _gapStart!,
          reasonCode: 'focus_lost',
        );
        _queueDelivery(() async {
          await onInterruption?.call(gap);
        });
        _gapStart = null;
      }
      await _delivery;
    } finally {
      _recording = false;
      _clock.stop();
      await _streamSubscription?.cancel();
      await _stateSubscription?.cancel();
    }
  }

  Future<void> dispose() async {
    if (_recording) await stopRecording();
    _meterTimer?.cancel();
    await _streamSubscription?.cancel();
    await _stateSubscription?.cancel();
    await _source.dispose();
  }
}
