import 'dart:async';
import 'dart:convert';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../core/api_client.dart';
import 'consult_audio_config.dart';
import 'consult_audio_controller.dart';
import 'consult_audio_repository.dart';

abstract class ForegroundServiceManager {
  Stream<Map<String, dynamic>> get events;
  Future<void> init();
  Future<bool> start({
    required String title,
    required String text,
    bool uploadOnly = false,
  });
  Future<bool> stop();
  Future<bool> isRunning();
  Future<NotificationPermission> checkOrRequestPermission();
  void command(String command);
  Future<void> shutdown();
}

class FlutterForegroundServiceManager implements ForegroundServiceManager {
  static final _events = StreamController<Map<String, dynamic>>.broadcast();
  static bool _bound = false;
  @override
  Stream<Map<String, dynamic>> get events => _events.stream;
  static void _receive(Object data) {
    if (data is Map) _events.add(Map<String, dynamic>.from(data));
  }

  @override
  Future<void> init() async {
    if (!_bound) {
      FlutterForegroundTask.initCommunicationPort();
      FlutterForegroundTask.addTaskDataCallback(_receive);
      _bound = true;
    }
    // _bound is our communication guard; configuring these options is idempotent.
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'recording',
        channelName: 'Recording',
        channelDescription: 'Shows an active recording or pending transfer.',
        onlyAlertOnce: true,
        channelImportance: NotificationChannelImportance.LOW,
        priority: NotificationPriority.LOW,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: false,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.nothing(),
        autoRunOnBoot: false,
        autoRunOnMyPackageReplaced: false,
        allowAutoRestart: false,
        allowWakeLock: true,
        allowWifiLock: true,
      ),
    );
  }

  @override
  Future<bool> start({
    required String title,
    required String text,
    bool uploadOnly = false,
  }) async {
    await init();
    if (await isRunning()) {
      final runningId = await FlutterForegroundTask.getData<String>(
        key: 'runningSessionId',
      );
      final descriptor = await const FlutterSecureStorage().read(
        key: 'consult_task_active',
      );
      final expectedId = descriptor == null
          ? null
          : (jsonDecode(descriptor) as Map)['sessionId'];
      if (runningId == null || runningId != expectedId) return false;
      command('status');
      return true;
    }
    final result = await FlutterForegroundTask.startService(
      serviceId: 256,
      serviceTypes: [
        uploadOnly
            ? ForegroundServiceTypes.dataSync
            : ForegroundServiceTypes.microphone,
      ],
      notificationTitle: title,
      notificationText: text,
      callback: startPatientAudioTask,
    );
    return result is ServiceRequestSuccess;
  }

  @override
  Future<bool> stop() async =>
      await FlutterForegroundTask.stopService() is ServiceRequestSuccess;
  @override
  Future<bool> isRunning() => FlutterForegroundTask.isRunningService;
  @override
  void command(String command) => FlutterForegroundTask.sendDataToTask(command);
  @override
  Future<void> shutdown() async {
    if (!await isRunning()) return;
    final stopped = events.firstWhere((data) => data['stopped'] == true);
    command('shutdown');
    try {
      const config = ConsultAudioConfig.defaultInstance;
      await stopped.timeout(
        Duration(
          milliseconds: config.encoderDrainTimeoutMs + config.httpTimeoutMs,
        ),
      );
    } finally {
      await stop();
    }
  }

  @override
  Future<NotificationPermission> checkOrRequestPermission() async {
    final current = await FlutterForegroundTask.checkNotificationPermission();
    return current == NotificationPermission.granted
        ? current
        : FlutterForegroundTask.requestNotificationPermission();
  }
}

@pragma('vm:entry-point')
void startPatientAudioTask() {
  FlutterForegroundTask.setTaskHandler(PatientAudioTaskHandler());
}

class PatientAudioTaskHandler extends TaskHandler {
  ConsultAudioController? _controller;
  ApiClient? _api;
  bool _closing = false;
  String? _taskSessionId;
  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    if (starter != TaskStarter.developer) {
      await FlutterForegroundTask.stopService();
      return;
    }
    try {
      const secure = FlutterSecureStorage();
      final value = await secure.read(key: 'consult_task_active');
      if (value == null) throw StateError('ERR_AUDIO_SESSION');
      final active = jsonDecode(value) as Map<String, dynamic>;
      final sessionId = active['sessionId'] as String;
      _taskSessionId = sessionId;
      await FlutterForegroundTask.saveData(
        key: 'runningSessionId',
        value: sessionId,
      );
      final token = await secure.read(key: 'consult_scoped_token_$sessionId');
      if (token == null) throw StateError('ERR_AUDIO_TOKEN');
      _api = ApiClient(
        baseUrl: active['baseUrl'] as String,
        accessToken: () => null,
      );
      _controller = ConsultAudioController(
        repository: ConsultAudioRepository(api: _api!),
        foregroundService: FakeForegroundServiceManager(),
        enableBackgroundServices: false,
        ownerId: active['ownerId'] as String,
      );
      _controller!.addListener(_publish);
      await _controller!.beginRuntime(
        sessionId: sessionId,
        token: token,
        uploadOnly: active['uploadOnly'] == true,
      );
    } catch (_) {
      FlutterForegroundTask.sendDataToMain({
        'sessionId': _taskSessionId,
        'stage': 'error',
        'error': 'Recording could not start. Open the app and retry.',
      });
      await FlutterForegroundTask.stopService();
    }
  }

  void _publish() {
    final controller = _controller;
    if (controller == null) return;
    FlutterForegroundTask.sendDataToMain(controller.snapshot);
    final text = controller.stage == PatientConsultStage.recording
        ? ConsultAudioConfig.notificationActive
        : controller.stage == PatientConsultStage.readyWait
        ? ConsultAudioConfig.notificationWaiting
        : ConsultAudioConfig.notificationPending;
    unawaited(
      FlutterForegroundTask.updateService(
        notificationTitle: ConsultAudioConfig.notificationTitle,
        notificationText: text,
      ),
    );
    if (controller.stage == PatientConsultStage.completed && !_closing) {
      _closing = true;
      unawaited(FlutterForegroundTask.stopService());
    }
  }

  @override
  void onRepeatEvent(DateTime timestamp) {}
  @override
  void onReceiveData(Object data) {
    if (data == 'status') _publish();
    if (data == 'stop') unawaited(_controller?.endConsultation());
    if (data == 'retry') unawaited(_controller?.retry());
    if (data == 'shutdown') unawaited(_shutdown());
  }

  Future<void> _shutdown() async {
    try {
      await _controller?.shutdown();
    } catch (_) {
      // The native service is stopped even if persistence or encoder drain fails.
    } finally {
      FlutterForegroundTask.sendDataToMain({
        'sessionId': _controller?.sessionId,
        'stopped': true,
      });
    }
  }

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {
    try {
      await _controller?.shutdown();
    } catch (_) {
      // Recovery retains its last committed manifest and flags interrupted capture.
    } finally {
      _controller?.dispose();
      _api?.close();
      if (await FlutterForegroundTask.getData<String>(
            key: 'runningSessionId',
          ) ==
          _taskSessionId) {
        await FlutterForegroundTask.removeData(key: 'runningSessionId');
      }
    }
  }

  @override
  void onNotificationPressed() => FlutterForegroundTask.launchApp();
}

/// Injectable service boundary; tests never launch Android plugins.
class FakeForegroundServiceManager implements ForegroundServiceManager {
  bool _running = false;
  @override
  Stream<Map<String, dynamic>> get events => const Stream.empty();
  @override
  Future<void> init() async {}
  @override
  Future<bool> start({
    required String title,
    required String text,
    bool uploadOnly = false,
  }) async {
    _running = true;
    return true;
  }

  @override
  Future<bool> stop() async {
    _running = false;
    return true;
  }

  @override
  Future<bool> isRunning() async => _running;
  @override
  Future<NotificationPermission> checkOrRequestPermission() async =>
      NotificationPermission.granted;
  @override
  void command(String command) {}
  @override
  Future<void> shutdown() async {
    _running = false;
  }
}
