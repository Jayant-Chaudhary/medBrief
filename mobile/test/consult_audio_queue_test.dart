import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/features/consult_audio/audio_upload_queue.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_config.dart';
import 'package:health_on_patient/features/consult_audio/pending_audio_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  late Directory directory;
  late PendingAudioStore store;
  AudioUploadQueue? queue;
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('synthetic-audio-');
    store = PendingAudioStore(
      sessionId: 'synthetic-session',
      baseDirectory: directory,
    );
    await store.initialize();
  });
  tearDown(() async {
    queue?.dispose();
    queue = null;
    await directory.delete(recursive: true);
  });
  Future<void> add(int seq) => store
      .saveChunk(
        seq: seq,
        clientChunkId: 'synthetic-$seq',
        chunkStartMs: seq * 1000,
        chunkEndMs: (seq + 1) * 1000,
        isSilent: false,
        avgDbfs: -20,
        bytes: [1, 2, 3],
      )
      .then((_) {});
  AudioUploadQueue build(
    Future<http.Response> Function(http.Request) handler,
  ) => queue = AudioUploadQueue(
    api: ApiClient(
      baseUrl: 'https://api.example',
      accessToken: () => null,
      client: MockClient(handler),
    ),
    store: store,
    sessionId: store.sessionId,
    scopedToken: 'synthetic-token',
    config: const ConsultAudioConfig(retryBackoffMs: [1, 2]),
  );
  http.Response ack(http.Request request) {
    final seq = int.parse(request.headers['x-seq']!);
    return http.Response(
      jsonEncode({
        'ok': true,
        'chunkId': 'row-$seq',
        'seq': seq,
        'duplicated': true,
        'sessionState': 'recording',
      }),
      200,
    );
  }

  test(
    'writes are serialized, next sequence persists after acknowledgement',
    () async {
      await Future.wait([add(0), add(1)]);
      await store.deleteChunk(0);
      await store.deleteChunk(1);
      final recovered = PendingAudioStore(
        sessionId: store.sessionId,
        baseDirectory: directory,
      );
      await recovered.initialize();
      expect(recovered.nextSeq, 2);
      expect(recovered.getPendingChunks(), isEmpty);
    },
  );
  test(
    'actual server headers, capture zero and final markers survive restart',
    () async {
      await store.updateControl({'captureZero': 123, 'finalCount': 2});
      await Future.wait([add(0), add(1)]);
      final recovered = PendingAudioStore(
        sessionId: store.sessionId,
        baseDirectory: directory,
      );
      await recovered.initialize();
      store = recovered;
      final events = <String>[];
      build((request) async {
        expect(request.headers['Authorization'], 'Bearer synthetic-token');
        if (request.url.path.endsWith('/capture-started')) {
          events.add('capture');
          expect(jsonDecode(request.body), {'capture_zero_device_ms': 123});
        } else if (request.url.path.endsWith('/chunks')) {
          events.add('chunk:${request.headers['x-seq']}');
          expect(request.headers['x-device'], 'patient');
          expect(request.headers['x-duration-ms'], '1000');
          expect(request.headers['x-silent'], 'false');
          expect(request.headers['x-codec'], 'audio/aac');
          return ack(request);
        } else {
          events.add('final');
          expect(jsonDecode(request.body), {'total_chunks': 2});
        }
        return http.Response('{"ok":true}', 200);
      });
      await queue!.waitUntilDrained();
      expect(events, ['capture', 'chunk:0', 'chunk:1', 'final']);
      expect(store.control['finalAck'], true);
      expect(store.getPendingChunks(), isEmpty);
    },
  );
  test(
    'delayed chunk acknowledgement prevents final marker and file deletion',
    () async {
      await add(0);
      final release = Completer<http.Response>();
      final sent = Completer<http.Request>();
      var finalSeen = false;
      build((request) async {
        if (request.url.path.endsWith('/chunks')) {
          sent.complete(request);
          return release.future;
        }
        finalSeen = true;
        return http.Response('{"ok":true}', 200);
      });
      final completion = queue!.sendFinalMarker(1);
      final request = await sent.future;
      expect(finalSeen, false);
      expect(File(store.getPendingChunks().single.filePath).existsSync(), true);
      release.complete(ack(request));
      expect(await completion, true);
      expect(finalSeen, true);
    },
  );
  test(
    'HTTP conflict retains audio and cannot produce a final marker',
    () async {
      await add(0);
      var finals = 0;
      build((request) async {
        if (request.url.path.endsWith('/final')) finals++;
        return http.Response('{"error":"conflict"}', 409);
      });
      await expectLater(
        queue!.sendFinalMarker(1),
        throwsA(isA<AppException>()),
      );
      expect(store.getPendingChunks().length, 1);
      expect(finals, 0);
    },
  );
  test(
    'malformed successful reply cannot delete an unacknowledged file',
    () async {
      await add(0);
      build((_) async => http.Response('{"ok":true}', 200));
      await expectLater(
        queue!.waitUntilDrained(),
        throwsA(isA<AppException>()),
      );
      expect(store.getPendingChunks().length, 1);
    },
  );
  test(
    'transient errors retry the same sequence until duplicate success',
    () async {
      await add(0);
      final sequences = <String>[];
      build((request) async {
        sequences.add(request.headers['x-seq']!);
        if (sequences.length == 1) {
          return http.Response('{"error":"retry"}', 503);
        }
        return ack(request);
      });
      await queue!.waitUntilDrained();
      expect(sequences, ['0', '0']);
      expect(store.getPendingChunks(), isEmpty);
    },
  );
  test('capacity stops capture without evicting pending audio', () async {
    store = PendingAudioStore(
      sessionId: 'small',
      baseDirectory: directory,
      config: const ConsultAudioConfig(maxPendingStorageBytes: 4),
    );
    await store.initialize();
    await add(0);
    await expectLater(add(1), throwsA(isA<StorageCapacityExceededException>()));
    expect(store.getPendingChunks().single.seq, 0);
  });
  test(
    'retention expiry removes audio and persists explicit missing interval',
    () async {
      store = PendingAudioStore(
        sessionId: 'expiry',
        baseDirectory: directory,
        config: const ConsultAudioConfig(storageRetentionHours: 0),
      );
      await store.initialize();
      await add(0);
      await store.pruneStaleChunks();
      expect(store.getPendingChunks(), isEmpty);
      expect(store.gaps.single.reasonCode, 'retention_expired');
      expect(store.control['incomplete'], true);
      expect(store.nextSeq, 1);
    },
  );
  test(
    'explicit discard deletes only unsent files and preserves missing intervals',
    () async {
      await add(0);
      await add(1);
      await store.acknowledgeChunk(0);
      await store.discardUnsent();
      expect(store.getPendingChunks(), isEmpty);
      expect(store.gaps.single.reasonCode, 'user_discarded');
      expect(store.gaps.single.startMs, 1000);
      expect(store.control['acknowledged'], 1);
      expect(store.control['finalCount'], 2);
      expect(store.control['incomplete'], true);
    },
  );
}
