import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_config.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_controller.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_page.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_repository.dart';
import 'package:health_on_patient/features/consult_audio/consult_foreground_task.dart';

const fixture = 'http://127.0.0.1:4460';
const recordSeconds = int.fromEnvironment(
  'EMULATOR_RECORD_SECONDS',
  defaultValue: 55,
);
const startDelaySeconds = int.fromEnvironment(
  'EMULATOR_START_DELAY_SECONDS',
  defaultValue: 0,
);
const disableSocket = bool.fromEnvironment('EMULATOR_DISABLE_SOCKET');

Future<Map<String, dynamic>> control(String route, {bool post = false}) async {
  final url = Uri.parse('$fixture/__test__/$route');
  const headers = {'Authorization': 'Bearer synthetic-emulator-control'};
  final response = await (post
      ? http.post(url, headers: headers)
      : http.get(url, headers: headers));
  if (response.statusCode != 200) throw StateError('ERR_EMULATOR_CONTROL');
  return jsonDecode(response.body) as Map<String, dynamic>;
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  testWidgets('native AAC capture, foreground ownership and final delivery', (
    tester,
  ) async {
    // Refuse to write credentials or start capture inside the signed-in app.
    final process = String.fromCharCodes(
      await File('/proc/self/cmdline').readAsBytes(),
    ).split('\u0000').first;
    expect(process, 'com.healthon.health_on_patient.emulator_test');
    expect(ConsultAudioConfig.defaultInstance.silenceDbfs, -200);
    final service = FlutterForegroundServiceManager();
    await service.init();
    expect(await service.isRunning(), false);
    final bootstrap = await control('reset', post: true);
    final api = ApiClient(
      baseUrl: fixture,
      accessToken: () => 'synthetic-emulator-patient',
    );
    final controller = ConsultAudioController(
      repository: ConsultAudioRepository(api: api),
      ownerId: 'synthetic-emulator-patient',
    );
    addTearDown(() async {
      await service.shutdown();
      controller.dispose();
      api.close();
    });
    await tester.pumpWidget(
      MaterialApp(home: ConsultAudioPage(controller: controller)),
    );
    await tester.pump();
    await controller.submitRoomCode(bootstrap['roomCode'] as String);
    expect(controller.stage, PatientConsultStage.consent);
    await controller.acceptConsent();
    expect(controller.stage, PatientConsultStage.permissions);
    await controller.requestPermissions();
    expect(
      controller.stage,
      PatientConsultStage.levelCheck,
      reason: controller.errorMessage,
    );
    expect(controller.micCheckReady, true);
    await controller.confirmMicAndSyncClock();
    Future<void> until(bool Function() condition, Duration timeout) async {
      final watch = Stopwatch()..start();
      while (!condition()) {
        if (watch.elapsed > timeout) {
          throw StateError('ERR_EMULATOR_WAIT_${controller.stage.name}');
        }
        await Future<void>.delayed(const Duration(milliseconds: 250));
      }
    }

    await until(
      () => controller.stage == PatientConsultStage.readyWait,
      const Duration(seconds: 30),
    );
    if (disableSocket) await control('socket_off', post: true);
    await control('observed_ready', post: true);
    await Future<void>.delayed(const Duration(seconds: startDelaySeconds));
    await control('start', post: true);
    await until(
      () => controller.stage == PatientConsultStage.recording,
      const Duration(seconds: 30),
    );
    final recording = Stopwatch()..start();
    await control('observed_recording', post: true);
    while (recording.elapsed < const Duration(seconds: recordSeconds)) {
      await Future<void>.delayed(const Duration(seconds: 1));
      expect(
        controller.stage,
        PatientConsultStage.recording,
        reason: controller.errorMessage,
      );
    }
    await control('end', post: true);
    await until(
      () => controller.stage == PatientConsultStage.completed,
      const Duration(seconds: 60),
    );
    final processing = Stopwatch()..start();
    Map<String, dynamic> status;
    while (true) {
      status = await control('status');
      final chunks = status['chunks'] as List;
      final outcomes = status['outcomes'] as List;
      if (outcomes.length == chunks.where((c) => c['silent'] == false).length) {
        break;
      }
      if (processing.elapsed > const Duration(seconds: 90)) {
        throw StateError('ERR_EMULATOR_STT_TIMEOUT');
      }
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    final chunks = (status['chunks'] as List).cast<Map<String, dynamic>>();
    expect(chunks.length, greaterThanOrEqualTo(recordSeconds ~/ 25));
    if (recordSeconds == 55) expect(chunks.length, 3);
    expect(status['expected'], chunks.length);
    expect(status['device'], 'flushed');
    expect(
      chunks.every((c) => c['silent'] == false && (c['bytes'] as num) > 0),
      true,
    );
    expect(chunks.every((c) => (c['durationMs'] as num) <= 25000), true);
    expect(chunks.map((c) => c['seq']), List.generate(chunks.length, (i) => i));
    expect((status['outcomes'] as List).every((o) => o['ok'] == true), true);
    expect((status['events'] as List).last, 'final');
    final support = await getApplicationSupportDirectory();
    final pending = Directory(
      '${support.path}/consult_pending_chunks/${bootstrap['sessionId']}',
    );
    final files = await pending
        .list()
        .where((f) => f.path.endsWith('.aac'))
        .length;
    expect(files, 0);
    binding.reportData = {
      'chunks': chunks.length,
      'expected': status['expected'],
      'convertedAndProcessed': (status['outcomes'] as List).length,
      'recordSeconds': recordSeconds,
      'gaps': (status['gaps'] as List).length,
      'pendingAudioFiles': files,
      'finalAfterChunks': true,
    };
    await tester.pump(const Duration(seconds: 1));
    expect(await service.isRunning(), false);
  }, timeout: const Timeout(Duration(minutes: 12)));
}
