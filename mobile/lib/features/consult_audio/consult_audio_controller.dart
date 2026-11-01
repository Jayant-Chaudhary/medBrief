import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import '../../core/api_client.dart';
import 'audio_upload_queue.dart';
import 'consult_audio_config.dart';
import 'consult_audio_models.dart';
import 'consult_audio_repository.dart';
import 'consult_foreground_task.dart';
import 'consult_socket.dart';
import 'patient_recorder.dart';
import 'pending_audio_store.dart';

enum PatientConsultStage {
  entry,
  joining,
  consent,
  permissions,
  levelCheck,
  syncing,
  readyWait,
  recording,
  ending,
  pending,
  completed,
  error,
}

/// UI instance handles consent/permissions only. Once ready, a separate instance
/// in the foreground isolate owns capture, persistence, HTTP and state polling.
class ConsultAudioController extends ChangeNotifier {
  ConsultAudioController({
    required this.repository,
    this.store,
    this.recorder,
    ForegroundServiceManager? foregroundService,
    this.config = ConsultAudioConfig.defaultInstance,
    this.enableBackgroundServices = true,
    this.ownerId = 'synthetic-patient',
  }) : _foreground = foregroundService ?? FlutterForegroundServiceManager() {
    if (enableBackgroundServices) {
      _updates = _foreground.events.listen(_receive);
    }
  }
  final ConsultAudioRepository repository;
  final ConsultAudioConfig config;
  final bool enableBackgroundServices;
  final String ownerId;
  final ForegroundServiceManager _foreground;
  PendingAudioStore? store;
  PatientRecorder? recorder;
  PatientConsultStage _stage = PatientConsultStage.entry;
  PatientConsultStage get stage => _stage;
  String? _sessionId, _scopedToken, _errorMessage;
  String? get sessionId => _sessionId;
  String? get scopedToken => _scopedToken;
  String? get errorMessage => _errorMessage;
  double _micLevelDbfs = -100;
  double get micLevelDbfs => _micLevelDbfs;
  bool _permissionRequestBusy = false;
  bool _micCheckReady = false;
  bool get micCheckReady => _micCheckReady;
  int _clockOffsetMs = 0;
  int get clockOffsetMs => _clockOffsetMs;
  int _uploadedChunksCount = 0;
  int get uploadedChunksCount => _uploadedChunksCount;
  int get pendingChunksCount =>
      store?.getPendingChunks().length ?? _remotePending;
  int _remotePending = 0;
  bool get incomplete =>
      store?.control['incomplete'] == true || _remoteIncomplete;
  bool _remoteIncomplete = false;
  bool _disposed = false,
      _polling = false,
      _starting = false,
      _runtime = false,
      _recorderFailed = false;
  bool _canRecord = false;
  bool _shuttingDown = false;
  AudioUploadQueue? _queue;
  ConsultSocket? _socket;
  Timer? _pollTimer;
  StreamSubscription<Map<String, dynamic>>? _updates;
  Future<void>? _ending;
  Future<void>? _startOperation;
  final _captureClock = Stopwatch();

  Map<String, dynamic> get snapshot => {
    'sessionId': _sessionId,
    'stage': _stage.name,
    'uploaded': _uploadedChunksCount,
    'pending': pendingChunksCount,
    'incomplete': incomplete,
    'error': _errorMessage,
  };
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void setStage(PatientConsultStage value) {
    _stage = value;
    _notify();
  }

  void _receive(Map<String, dynamic> data) {
    if (data['sessionId'] != _sessionId &&
        !(data['sessionId'] == null && data['stage'] == 'error')) {
      return;
    }
    _stage = PatientConsultStage.values.firstWhere(
      (s) => s.name == data['stage'],
      orElse: () => _stage,
    );
    _uploadedChunksCount = data['uploaded'] as int? ?? 0;
    _remotePending = data['pending'] as int? ?? 0;
    _remoteIncomplete = data['incomplete'] == true;
    _errorMessage = data['error'] as String?;
    // Do not keep a stale UI manifest while the foreground isolate is writing.
    if (!_runtime) store = null;
    _notify();
  }

  Future<void> restoreActive() async {
    final active = await repository.activeFor(ownerId);
    if (active == null) return;
    _sessionId = active['sessionId'] as String;
    _scopedToken = await repository.getStoredScopedToken(_sessionId!);
    if (_scopedToken == null) {
      _errorMessage = 'Please contact the clinic to reconnect this visit.';
      setStage(PatientConsultStage.error);
      return;
    }
    if (await _foreground.isRunning()) {
      _foreground.command('status');
      return;
    }
    store = PendingAudioStore(sessionId: _sessionId!, config: config);
    await store!.initialize();
    if (store!.control['captureZero'] != null ||
        store!.control['finalCount'] != null) {
      setStage(PatientConsultStage.pending);
    } else {
      setStage(
        store!.control['consented'] == true
            ? PatientConsultStage.permissions
            : PatientConsultStage.consent,
      );
    }
  }

  Future<void> submitRoomCode(String code) async {
    if (_stage != PatientConsultStage.entry) return;
    if (!RegExp(r'^[A-Za-z0-9]{6}$').hasMatch(code.trim())) {
      _errorMessage = 'Please enter a valid 6-character room code.';
      _notify();
      return;
    }
    setStage(PatientConsultStage.joining);
    _errorMessage = null;
    try {
      final result = await repository.joinSession(code);
      _sessionId = result.sessionId;
      _scopedToken = result.scopedToken;
      store ??= PendingAudioStore(sessionId: _sessionId!, config: config);
      await store!.initialize();
      await repository.rememberActive(_sessionId!, ownerId);
      setStage(PatientConsultStage.consent);
    } catch (_) {
      _errorMessage = 'Could not join. Check the code and your connection.';
      setStage(PatientConsultStage.error);
    }
  }

  Future<void> acceptConsent() async {
    if (_stage != PatientConsultStage.consent) return;
    try {
      await repository.recordConsent(
        sessionId: _sessionId!,
        scopedToken: _scopedToken!,
      );
      await store!.updateControl({'consented': true});
      setStage(PatientConsultStage.permissions);
    } catch (_) {
      _errorMessage = 'Could not save consent. Please retry.';
      _notify();
    }
  }

  PatientRecorder _makeRecorder() => PatientRecorder(config: config);
  Future<void> requestPermissions() async {
    if (_stage != PatientConsultStage.permissions || _permissionRequestBusy) {
      return;
    }
    _permissionRequestBusy = true;
    _micCheckReady = false;
    recorder ??= _makeRecorder();
    recorder!.onLoudnessSample = (value) {
      _micLevelDbfs = value;
      _notify();
    };
    try {
      if (!await recorder!.checkPrerequisites()) {
        throw const AppException(
          'Microphone access and AAC recording support are required.',
        );
      }
      if ((await _foreground.checkOrRequestPermission()).name != 'granted') {
        throw const AppException(
          'Allow notifications to see the recording indicator.',
        );
      }
      _errorMessage = null;
      setStage(PatientConsultStage.levelCheck);
      await recorder!.checkLevels();
      _micCheckReady = true;
      _notify();
    } catch (error) {
      _errorMessage = error is AppException
          ? error.message
          : 'Could not check the microphone. Please retry.';
      setStage(PatientConsultStage.permissions);
    } finally {
      _permissionRequestBusy = false;
    }
  }

  Future<void> confirmMicAndSyncClock() async {
    if (_stage != PatientConsultStage.levelCheck || !_micCheckReady) return;
    setStage(PatientConsultStage.syncing);
    try {
      final sync = await repository.performClockSync();
      _clockOffsetMs = sync.offsetMs;
      if (enableBackgroundServices) {
        await recorder?.dispose();
        recorder = null;
        await repository.rememberActive(_sessionId!, ownerId);
        await _foreground.init();
        if (!await _foreground.start(
          title: ConsultAudioConfig.notificationTitle,
          text: ConsultAudioConfig.notificationWaiting,
        )) {
          throw StateError('ERR_AUDIO_SERVICE');
        }
      }
      await repository.markReady(
        sessionId: _sessionId!,
        scopedToken: _scopedToken!,
        offsetMs: sync.offsetMs,
        rttMs: sync.minRttMs,
      );
      if (!enableBackgroundServices) {
        await _foreground.start(
          title: ConsultAudioConfig.notificationTitle,
          text: ConsultAudioConfig.notificationWaiting,
        );
        await beginRuntime(
          sessionId: _sessionId!,
          token: _scopedToken!,
          connectSocket: false,
        );
      } else {
        setStage(PatientConsultStage.readyWait);
        _foreground.command('status');
      }
    } catch (_) {
      _errorMessage = 'Could not become ready. Please retry.';
      setStage(PatientConsultStage.error);
    }
  }

  /// Called only by the service handler (or injected tests). No permission
  /// prompts occur here, and an unexpected service restart never restarts capture.
  Future<void> beginRuntime({
    required String sessionId,
    required String token,
    bool uploadOnly = false,
    bool connectSocket = true,
  }) async {
    _runtime = true;
    _sessionId = sessionId;
    _scopedToken = token;
    store ??= PendingAudioStore(sessionId: sessionId, config: config);
    await store!.initialize();
    await store!.pruneStaleChunks();
    await store!.cleanOrphans();
    _uploadedChunksCount = store!.control['acknowledged'] as int? ?? 0;
    recorder ??= _makeRecorder();
    recorder!.onChunkReady = _saveChunk;
    recorder!.onInterruption = (gap) async {
      await store!.addGap(gap);
      _queue?.trigger();
    };
    recorder!.onError = (_) {
      _recorderFailed = true;
      if (_shuttingDown) return;
      unawaited(endConsultation());
    };
    _queue = AudioUploadQueue(
      api: repository.api,
      store: store!,
      sessionId: sessionId,
      scopedToken: token,
      config: config,
      onSessionState: (state) {
        if (state.status != ConsultSessionState.recording) {
          unawaited(_pollState());
        }
      },
      onChunkAcknowledged: (_, remaining) {
        _uploadedChunksCount = store!.control['acknowledged'] as int? ?? 0;
        _notify();
      },
      onError: (message) {
        _errorMessage = message;
        _notify();
      },
      onPermanentFailure: () {
        if (_shuttingDown) return;
        _recorderFailed = true;
        unawaited(endConsultation());
      },
    );
    if (uploadOnly || store!.control['captureZero'] != null) {
      if (store!.control['wasRecording'] == true) {
        final start = store!.control['lastEndMs'] as int? ?? 0;
        final now =
            DateTime.now().millisecondsSinceEpoch -
            (store!.control['captureZero'] as int);
        await store!.addGap(
          InterruptionGap(
            gapId: newOpaqueId(),
            startMs: start,
            durationMs: math.max(1, now - start),
            reasonCode: 'recorder_error',
          ),
        );
        await store!.updateControl({'incomplete': true, 'wasRecording': false});
      }
      await store!.updateControl({'finalCount': store!.nextSeq});
      unawaited(endConsultation());
      return;
    }
    setStage(PatientConsultStage.readyWait);
    if (connectSocket) {
      _socket = ConsultSocket(
        baseUrl: repository.api.baseUrl,
        sessionId: sessionId,
        scopedToken: token,
        onReconcile: () => unawaited(_pollState()),
      );
      _socket!.connect();
    }
    _pollTimer = Timer.periodic(
      Duration(milliseconds: config.statePollIntervalMs),
      (_) => _pollState(),
    );
    await _pollState();
  }

  Future<void> reconcile() => _pollState();
  Future<void> _pollState() async {
    if (_polling || _disposed || _sessionId == null) return;
    _polling = true;
    try {
      final state = await repository.getSessionState(
        sessionId: _sessionId!,
        scopedToken: _scopedToken!,
      );
      _canRecord =
          state.status == ConsultSessionState.recording &&
          state.doctorConsent &&
          state.patientConsent;
      if (state.status == ConsultSessionState.recording &&
          state.doctorConsent &&
          state.patientConsent &&
          _stage == PatientConsultStage.readyWait) {
        await startRecording();
      }
      if ([
            ConsultSessionState.ending,
            ConsultSessionState.processing,
            ConsultSessionState.draftReady,
            ConsultSessionState.cancelled,
            ConsultSessionState.failed,
            ConsultSessionState.completed,
          ].contains(state.status) &&
          (_stage == PatientConsultStage.recording ||
              _stage == PatientConsultStage.readyWait)) {
        unawaited(endConsultation());
      }
    } catch (_) {
      /* HTTP is retried on the next configured poll. */
    } finally {
      _polling = false;
    }
  }

  Future<void> startRecording() {
    if (!_runtime ||
        !_canRecord ||
        _stage != PatientConsultStage.readyWait ||
        _starting) {
      return Future.value();
    }
    return _startOperation ??= _startCapture();
  }

  Future<void> _startCapture() async {
    _starting = true;
    try {
      final zero = DateTime.now().millisecondsSinceEpoch;
      await store!.updateControl({
        'captureZero': zero,
        'captureAck': false,
        'wasRecording': true,
      });
      _captureClock
        ..reset()
        ..start();
      await recorder!.startRecording(initialTimelineMs: 0);
      if (_stage == PatientConsultStage.readyWait) {
        setStage(PatientConsultStage.recording);
      }
      _queue!.trigger();
    } catch (_) {
      _recorderFailed = true;
      unawaited(endConsultation());
    } finally {
      _starting = false;
    }
  }

  Future<void> _saveChunk(PreparedChunkData chunk) async {
    await store!.saveChunk(
      seq: store!.nextSeq,
      clientChunkId: newOpaqueId(),
      chunkStartMs: chunk.chunkStartMs,
      chunkEndMs: chunk.chunkEndMs,
      isSilent: chunk.isSilent,
      avgDbfs: chunk.avgDbfs,
      bytes: chunk.bytes,
    );
    _notify();
    _queue!.trigger();
  }

  Future<void> endConsultation() {
    if (!_runtime) {
      _foreground.command('stop');
      setStage(PatientConsultStage.ending);
      return Future.value();
    }
    return _ending ??= _finishRuntime();
  }

  Future<void> _finishRuntime() async {
    if (_stage == PatientConsultStage.completed) return;
    setStage(PatientConsultStage.ending);
    _pollTimer?.cancel();
    _socket?.dispose();
    try {
      await _startOperation;
      try {
        await recorder?.stopRecording();
      } catch (_) {
        _recorderFailed = true;
        try {
          await recorder?.dispose();
        } catch (_) {}
      }
      _captureClock.stop();
      if (_recorderFailed) {
        final start = store!.control['lastEndMs'] as int? ?? 0;
        await store!.addGap(
          InterruptionGap(
            gapId: newOpaqueId(),
            startMs: start,
            durationMs: math.max(1, _captureClock.elapsedMilliseconds - start),
            reasonCode: 'recorder_error',
          ),
        );
        await store!.updateControl({'incomplete': true});
      }
      await store!.updateControl({'wasRecording': false});
      setStage(PatientConsultStage.pending);
      await _queue!.sendFinalMarker(store!.nextSeq);
      await repository.clearScopedToken(_sessionId!);
      await repository.forgetActive(ownerId);
      await _foreground.stop();
      setStage(PatientConsultStage.completed);
    } catch (_) {
      _errorMessage = 'Files are still pending. Reconnect and retry.';
      setStage(PatientConsultStage.pending);
      _ending = null;
    }
  }

  Future<void> retry() async {
    _errorMessage = null;
    if (_sessionId == null) {
      setStage(PatientConsultStage.entry);
      return;
    }
    if (_runtime) {
      _ending = null;
      await endConsultation();
      return;
    }
    if (await _foreground.isRunning()) {
      _foreground.command('retry');
      return;
    }
    store ??= PendingAudioStore(sessionId: _sessionId!, config: config);
    await store!.initialize();
    if (store!.control['captureZero'] != null ||
        store!.control['finalCount'] != null) {
      if ((await _foreground.checkOrRequestPermission()).name != 'granted') {
        _errorMessage = 'Allow notifications to continue sending files.';
        _notify();
        return;
      }
      await repository.rememberActive(_sessionId!, ownerId, uploadOnly: true);
      await _foreground.init();
      await _foreground.start(
        title: ConsultAudioConfig.notificationTitle,
        text: ConsultAudioConfig.notificationPending,
        uploadOnly: true,
      );
    } else {
      setStage(
        store!.control['consented'] == true
            ? PatientConsultStage.permissions
            : PatientConsultStage.consent,
      );
    }
  }

  Future<void> shutdown() async {
    if (!_runtime) {
      await _foreground.shutdown();
      return;
    }
    _pollTimer?.cancel();
    _socket?.dispose();
    _shuttingDown = true;
    _queue?.dispose();
    try {
      await _startOperation;
      await recorder?.stopRecording();
      if (store != null) {
        await store!.updateControl({
          'wasRecording': false,
          'finalCount': store!.nextSeq,
        });
      }
    } finally {
      await _queue?.stopAndWait();
    }
  }

  /// Called only after an explicit UI choice. Relinquish the service's file
  /// ownership before opening a second manifest instance in the UI isolate.
  Future<void> discardPending() async {
    if (_runtime ||
        _sessionId == null ||
        _stage != PatientConsultStage.pending) {
      return;
    }
    try {
      await _foreground.shutdown();
      store = PendingAudioStore(sessionId: _sessionId!, config: config);
      await store!.initialize();
      await store!.discardUnsent();
      await repository.rememberActive(_sessionId!, ownerId, uploadOnly: true);
      await retry();
    } catch (_) {
      _errorMessage = 'Could not remove pending files. Please retry.';
      _notify();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _updates?.cancel();
    if (_runtime) {
      _pollTimer?.cancel();
      _queue?.dispose();
      _socket?.dispose();
    }
    if (recorder != null) {
      unawaited(recorder!.dispose().catchError((Object _) {}));
    }
    super.dispose();
  }
}
