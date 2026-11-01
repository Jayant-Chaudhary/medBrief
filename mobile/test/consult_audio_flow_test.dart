import 'dart:async';
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

void main() {
  late Directory directory;
  late ConsultAudioController controller;
  late SyntheticRecorderSource source;
  late FakeForegroundServiceManager foreground;
  String state = 'ready';
  bool consent = true;
  final events = <String>[];
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('synthetic-flow-');
    source = SyntheticRecorderSource();
    foreground = FakeForegroundServiceManager();
    state = 'ready';
    consent = true;
    events.clear();
    const config = ConsultAudioConfig(clockHandshakeRounds: 1, levelCheckMs: 0);
    final api = ApiClient(
      baseUrl: 'https://api.example',
      accessToken: () => 'synthetic-auth',
      client: MockClient((request) async {
        if (request.url.path.endsWith('/join')) {
          return http.Response(
            '{"sessionId":"synthetic-session","token":"synthetic-token"}',
            200,
          );
        }
        if (request.url.path == '/api/time') {
          return http.Response(
            jsonEncode({
              'server_time_ms': DateTime.now().millisecondsSinceEpoch,
            }),
            200,
          );
        }
        if (request.url.path.endsWith('/state')) {
          return http.Response(
            jsonEncode({
              'session': {'id': 'synthetic-session', 'status': state},
              'consents': consent
                  ? [
                      {'role': 'doctor'},
                      {'role': 'patient'},
                    ]
                  : [],
              'devices': [],
            }),
            200,
          );
        }
        if (request.url.path.endsWith('/chunks')) {
          events.add('chunk:${request.headers['x-seq']}');
          return http.Response(
            jsonEncode({
              'ok': true,
              'chunkId': 'row',
              'seq': int.parse(request.headers['x-seq']!),
              'sessionState': 'recording',
            }),
            200,
          );
        }
        if (request.url.path.endsWith('/capture-started')) {
          events.add('capture');
        }
        if (request.url.path.endsWith('/final')) events.add('final');
        return http.Response('{"ok":true}', 200);
      }),
    );
    controller = ConsultAudioController(
      repository: ConsultAudioRepository(
        api: api,
        secureStorage: MemoryTokens(),
        config: config,
      ),
      config: config,
      store: PendingAudioStore(
        sessionId: 'synthetic-session',
        baseDirectory: directory,
      ),
      recorder: PatientRecorder(source: source, config: config),
      foregroundService: foreground,
      enableBackgroundServices: false,
    );
  });
  tearDown(() async {
    controller.dispose();
    await Future<void>.delayed(Duration.zero);
    await directory.delete(recursive: true);
  });
  Future<void> ready() async {
    await controller.submitRoomCode('SYN123');
    await controller.acceptConsent();
    await controller.requestPermissions();
    await controller.confirmMicAndSyncClock();
  }

  test(
    'consent, permissions and authoritative room state gate actual capture',
    () async {
      await controller.startRecording();
      expect(source.starts, 0);
      await ready();
      expect(controller.stage, PatientConsultStage.readyWait);
      expect(source.starts, 1, reason: 'Only the local level check ran');
      state = 'recording';
      consent = false;
      await controller.reconcile();
      expect(source.starts, 1);
      consent = true;
      await controller.reconcile();
      expect(source.starts, 2);
      expect(controller.stage, PatientConsultStage.recording);
      source.tail = syntheticAdtsFrame();
      await controller.endConsultation();
      expect(controller.stage, PatientConsultStage.completed);
      expect(events, ['capture', 'chunk:0', 'final']);
      expect(await foreground.isRunning(), false);
    },
  );
  test(
    'denied microphone permission cannot start a level check or ready service',
    () async {
      await controller.submitRoomCode('SYN123');
      await controller.acceptConsent();
      source.allowed = false;
      await controller.requestPermissions();
      expect(controller.stage, PatientConsultStage.permissions);
      expect(source.starts, 0);
      expect(await foreground.isRunning(), false);
    },
  );
  test('HTTP reconciliation stops and flushes even without a socket', () async {
    await ready();
    state = 'recording';
    await controller.reconcile();
    source.tail = syntheticAdtsFrame();
    state = 'ending';
    await controller.reconcile();
    await controller.endConsultation();
    expect(controller.stage, PatientConsultStage.completed);
    expect(events.last, 'final');
  });
  test(
    'process recovery uploads pending files and gaps without restarting the microphone',
    () async {
      final store = controller.store!;
      await store.initialize();
      await store.updateControl({
        'captureZero': DateTime.now().millisecondsSinceEpoch - 1000,
        'captureAck': false,
        'wasRecording': true,
      });
      await store.saveChunk(
        seq: 0,
        clientChunkId: 'synthetic',
        chunkStartMs: 0,
        chunkEndMs: 64,
        isSilent: false,
        avgDbfs: -20,
        bytes: syntheticAdtsFrame(),
      );
      await controller.beginRuntime(
        sessionId: 'synthetic-session',
        token: 'synthetic-token',
        uploadOnly: true,
        connectSocket: false,
      );
      await controller.endConsultation();
      expect(source.starts, 0);
      expect(controller.incomplete, true);
      expect(controller.stage, PatientConsultStage.completed);
      expect(events, ['capture', 'chunk:0', 'final']);
    },
  );

  test(
    'stop during asynchronous native startup cannot leave the microphone running',
    () async {
      await ready();
      final gate = Completer<void>();
      source.startGate = gate;
      state = 'recording';
      final starting = controller.reconcile();
      while (source.starts < 2) {
        await Future<void>.delayed(Duration.zero);
      }
      final stopping = controller.endConsultation();
      gate.complete();
      await starting;
      await stopping;
      expect(source.bytes!.isClosed, true);
      expect(controller.stage, PatientConsultStage.completed);
      expect(events.last, 'final');
    },
  );

  test('readiness waits for the local microphone check to finish', () async {
    await controller.submitRoomCode('SYN123');
    await controller.acceptConsent();
    final gate = Completer<void>();
    source.startGate = gate;
    final permission = controller.requestPermissions();
    while (controller.stage != PatientConsultStage.levelCheck) {
      await Future<void>.delayed(Duration.zero);
    }
    await controller.confirmMicAndSyncClock();
    expect(controller.stage, PatientConsultStage.levelCheck);
    expect(controller.micCheckReady, false);
    gate.complete();
    await permission;
    expect(controller.micCheckReady, true);
  });

  testWidgets(
    'pending state offers upload recovery and does not claim completion',
    (tester) async {
      controller.setStage(PatientConsultStage.pending);
      await tester.pumpWidget(
        MaterialApp(home: ConsultAudioPage(controller: controller)),
      );
      expect(find.text('Resume uploads'), findsOneWidget);
      expect(find.text('Visit Finished'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
