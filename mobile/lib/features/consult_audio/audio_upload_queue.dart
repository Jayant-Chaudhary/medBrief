import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import '../../core/api_client.dart';
import 'consult_audio_config.dart';
import 'consult_audio_models.dart';
import 'pending_audio_store.dart';

/// Durable acknowledgement gates deletion. HTTP 409 is a state error, never
/// evidence of a duplicate; duplicates use the server's successful JSON reply.
class AudioUploadQueue {
  AudioUploadQueue({
    required this.api,
    required this.store,
    required this.sessionId,
    required this.scopedToken,
    this.config = ConsultAudioConfig.defaultInstance,
    this.onChunkAcknowledged,
    this.onSessionState,
    this.onError,
    this.onPermanentFailure,
  });
  final ApiClient api;
  final PendingAudioStore store;
  final String sessionId, scopedToken;
  final ConsultAudioConfig config;
  final void Function(int seq, int remaining)? onChunkAcknowledged;
  final void Function(ConsultSessionSummary state)? onSessionState;
  final void Function(String message)? onError;
  final void Function()? onPermanentFailure;
  Future<void>? _work;
  bool _disposed = false;
  int _lastAcknowledgedSeq = -1;
  int get lastAcknowledgedSeq => _lastAcknowledgedSeq;
  Completer<void>? _wake;
  bool get hasPending =>
      store.getPendingChunks().isNotEmpty ||
      store.gaps.isNotEmpty ||
      (store.control['captureZero'] != null &&
          store.control['captureAck'] != true) ||
      (store.control['finalCount'] != null &&
          store.control['finalAck'] != true);

  void trigger() {
    if (_disposed || _work != null) return;
    final future = _run();
    _work = future;
    unawaited(
      future.then<void>(
        (_) {
          _work = null;
        },
        onError: (Object _, StackTrace _) {
          _work = null;
          onError?.call(
            'Files are pending. Reconnect or retry before leaving.',
          );
        },
      ),
    );
  }

  Future<dynamic> _post(String suffix, Map<String, dynamic> body) =>
      api.request(
        '/api/consults/$sessionId$suffix',
        method: 'POST',
        bearerToken: scopedToken,
        body: body,
        timeout: Duration(milliseconds: config.httpTimeoutMs),
      );

  Future<void> _run() async {
    int attempt = 0;
    while (!_disposed && hasPending) {
      try {
        await store.pruneStaleChunks();
        if (store.control['captureZero'] != null &&
            store.control['captureAck'] != true) {
          await _post('/devices/patient/capture-started', {
            'capture_zero_device_ms': store.control['captureZero'],
          });
          await store.updateControl({'captureAck': true});
        } else if (store.getPendingChunks().isNotEmpty) {
          final chunk = store.getPendingChunks().first;
          final file = File(chunk.filePath);
          if (!await file.exists()) {
            await store.addGap(
              InterruptionGap(
                gapId: newOpaqueId(),
                startMs: chunk.chunkStartMs,
                durationMs: chunk.chunkEndMs - chunk.chunkStartMs,
                reasonCode: 'storage_lost',
              ),
            );
            await store.updateControl({'incomplete': true});
            await store.deleteChunk(chunk.seq);
            continue;
          }
          final response = await api.uploadBytes(
            '/api/consults/$sessionId/chunks',
            bytes: chunk.isSilent ? [] : await file.readAsBytes(),
            bearerToken: scopedToken,
            timeout: Duration(milliseconds: config.httpTimeoutMs),
            headers: {
              'Content-Type': 'audio/aac',
              'x-codec': 'audio/aac',
              'x-device': 'patient',
              'x-seq': '${chunk.seq}',
              'x-start-ms': '${chunk.chunkStartMs}',
              'x-duration-ms': '${chunk.chunkEndMs - chunk.chunkStartMs}',
              'x-silent': '${chunk.isSilent}',
              'x-avg-dbfs': '${chunk.avgDbfs}',
            },
          );
          if (response is! Map ||
              response['ok'] != true ||
              response['seq'] != chunk.seq ||
              response['chunkId'] is! String) {
            throw const AppException(
              'Upload acknowledgement could not be verified.',
              status: 422,
            );
          }
          _lastAcknowledgedSeq = math.max(_lastAcknowledgedSeq, chunk.seq);
          await store.acknowledgeChunk(chunk.seq);
          onChunkAcknowledged?.call(chunk.seq, store.getPendingChunks().length);
          // The actual server reply is a status string, not a full state object.
          if (response['sessionState'] is String) {
            onSessionState?.call(
              ConsultSessionSummary(
                id: sessionId,
                status: ConsultSessionState.fromString(
                  response['sessionState'] as String,
                ),
              ),
            );
          }
        } else if (store.gaps.isNotEmpty) {
          final gap = store.gaps.first;
          await _post('/devices/patient/gaps', gap.toJson());
          await store.acknowledgeGap(gap.gapId);
        } else if (store.control['finalCount'] != null &&
            store.control['finalAck'] != true) {
          final response = await _post('/devices/patient/final', {
            'total_chunks': store.control['finalCount'],
          });
          if (response is! Map || response['ok'] != true) {
            throw const AppException(
              'Final acknowledgement could not be verified.',
              status: 422,
            );
          }
          await store.updateControl({'finalAck': true});
        }
        attempt = 0;
      } on AppException catch (error) {
        if (_disposed) rethrow;
        if (error.status != null &&
            error.status! < 500 &&
            error.status != 408 &&
            error.status != 429) {
          onPermanentFailure?.call();
          rethrow;
        }
        onError?.call('Connection unavailable. Files are retained for retry.');
        final index = math.min(attempt++, config.retryBackoffMs.length - 1);
        _wake = Completer<void>();
        await Future.any([
          Future<void>.delayed(
            Duration(milliseconds: config.retryBackoffMs[index]),
          ),
          _wake!.future,
        ]);
      } catch (_) {
        throw const AppException(
          'Could not read or save pending files. Please retry.',
        );
      }
    }
    if (_disposed && hasPending) {
      throw const AppException('Files remain pending.');
    }
  }

  Future<void> waitUntilDrained({Duration? timeout}) async {
    trigger();
    final future = _work ?? Future<void>.value();
    if (timeout != null) {
      await future.timeout(timeout);
    } else {
      await future;
    }
    if (hasPending) throw const AppException('Files remain pending.');
  }

  Future<bool> sendFinalMarker(int totalChunks) async {
    await store.updateControl({'finalCount': totalChunks});
    await waitUntilDrained();
    return store.control['finalAck'] == true;
  }

  void dispose() {
    _disposed = true;
    if (!(_wake?.isCompleted ?? true)) _wake!.complete();
  }

  Future<void> stopAndWait() async {
    dispose();
    try {
      await _work;
    } catch (_) {
      /* Pending work remains committed for recovery. */
    }
  }
}
