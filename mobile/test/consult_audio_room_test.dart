import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_config.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_controller.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_page.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_repository.dart';
import 'package:health_on_patient/features/consult_audio/consult_foreground_task.dart';
import 'package:health_on_patient/features/consult_audio/patient_recorder.dart';
import 'package:health_on_patient/features/consult_audio/pending_audio_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'consult_audio_test_helpers.dart';

/// Leaving a room and dropping a stale one. Synthetic ids only.
void main() {
  late Directory directory;
  late ConsultAudioController controller;
  late MemoryTokens tokens;
  late List<String> calls;
  late int leaveStatus;
  late String serverStatus;
  late String? patientDeviceStatus;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('synthetic-room-');
    tokens = MemoryTokens();
    calls = [];
    leaveStatus = 200;
    serverStatus = 'waiting';
    patientDeviceStatus = 'joined';
    const config = ConsultAudioConfig(clockHandshakeRounds: 1, levelCheckMs: 0);
    final api = ApiClient(
      baseUrl: 'https://api.example',
      accessToken: () => 'synthetic-auth',
      client: MockClient((request) async {
        calls.add('${request.method} ${request.url.path}');
        if (request.url.path.endsWith('/join')) {
          return http.Response(
            '{"sessionId":"synthetic-session","token":"synthetic-token"}',
            200,
          );
        }
        if (request.url.path.endsWith('/leave')) {
          return http.Response(
            leaveStatus == 200
                ? '{"ok":true}'
                : '{"error":"x","code":"ERR_SESSION_NOT_OPEN"}',
            leaveStatus,
          );
        }
        if (request.url.path.endsWith('/state')) {
          return http.Response(
            jsonEncode({
              'session': {'id': 'synthetic-session', 'status': serverStatus},
              'consents': [],
              'devices': [
                {'device': 'doctor', 'status': 'ready'},
                if (patientDeviceStatus != null)
                  {'device': 'patient', 'status': patientDeviceStatus},
              ],
            }),
            200,
          );
        }
        return http.Response('{"ok":true}', 200);
      }),
    );
    controller = ConsultAudioController(
      repository: ConsultAudioRepository(
        api: api,
        secureStorage: tokens,
        config: config,
      ),
      config: config,
      store: PendingAudioStore(
        sessionId: 'synthetic-session',
        baseDirectory: directory,
      ),
      recorder: PatientRecorder(source: SyntheticRecorderSource(), config: config),
      foregroundService: FakeForegroundServiceManager(),
      enableBackgroundServices: false,
      ownerId: 'synthetic-patient',
    );
  });

  tearDown(() async {
    controller.dispose();
    await Future<void>.delayed(Duration.zero);
    await directory.delete(recursive: true);
  });

  Future<void> joinRoom() async {
    await controller.submitRoomCode('SYN123');
    expect(controller.stage, PatientConsultStage.consent);
  }

  test('a patient can leave a room they joined and is back at code entry', () async {
    await joinRoom();
    expect(controller.canLeaveRoom, isTrue);
    expect(tokens.values.keys, contains('consult_active_synthetic-patient'));

    await controller.leaveRoom();

    expect(calls, contains('POST /api/consults/synthetic-session/leave'));
    expect(controller.stage, PatientConsultStage.entry);
    expect(controller.sessionId, isNull);
    expect(controller.canLeaveRoom, isFalse);
    expect(tokens.values.keys, isNot(contains('consult_active_synthetic-patient')));
    // A new code can be entered straight away. (Tests inject the store: the
    // real one resolves its folder through a platform plugin.)
    controller.store = PendingAudioStore(
      sessionId: 'synthetic-session',
      baseDirectory: directory,
    );
    await controller.submitRoomCode('SYN456');
    expect(controller.stage, PatientConsultStage.consent);
  });

  test('leaving still forgets the room when the server says it is closed', () async {
    await joinRoom();
    leaveStatus = 409;
    await controller.leaveRoom();
    expect(controller.stage, PatientConsultStage.entry);
    expect(controller.sessionId, isNull);
  });

  test('a network failure keeps the room and explains', () async {
    await joinRoom();
    leaveStatus = 500;
    await controller.leaveRoom();
    expect(controller.stage, PatientConsultStage.consent);
    expect(controller.sessionId, 'synthetic-session');
    expect(controller.errorMessage, contains('Could not leave'));
  });

  test('reopening drops a room the doctor closed', () async {
    await joinRoom();
    serverStatus = 'cancelled';
    await controller.refreshRoom();
    expect(controller.stage, PatientConsultStage.entry);
    expect(controller.errorMessage, contains('no longer open'));
  });

  test('reopening drops a room this patient was removed from', () async {
    await joinRoom();
    patientDeviceStatus = 'gone';
    await controller.refreshRoom();
    expect(controller.stage, PatientConsultStage.entry);
  });

  test('reopening keeps a room that is still open', () async {
    await joinRoom();
    await controller.refreshRoom();
    expect(controller.stage, PatientConsultStage.consent);
    expect(controller.sessionId, 'synthetic-session');
  });

  testWidgets('the room screen offers leaving with confirmation', (tester) async {
    await tester.runAsync(joinRoom);
    await tester.pumpWidget(
      MaterialApp(home: ConsultAudioPage(controller: controller)),
    );
    expect(find.byKey(const Key('leave-room')), findsOneWidget);
    await tester.tap(find.byKey(const Key('leave-room')));
    await tester.pumpAndSettle();
    expect(find.text('Leave this room?'), findsOneWidget);
    await tester.tap(find.text('Stay'));
    await tester.pumpAndSettle();
    expect(controller.stage, PatientConsultStage.consent);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('code entry shows no leave option', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: ConsultAudioPage(controller: controller)),
    );
    expect(find.byKey(const Key('leave-room')), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
}
