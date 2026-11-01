import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'consult_audio_config.dart';
import 'consult_audio_models.dart';

class StorageCapacityExceededException implements Exception {
  const StorageCapacityExceededException(this.message);
  final String message;
}

/// One owner (the foreground task) serializes every manifest mutation. Audio
/// stays in app-private storage only until durable acknowledgement or expiry.
class PendingAudioStore {
  PendingAudioStore({
    required this.sessionId,
    this.baseDirectory,
    this.config = ConsultAudioConfig.defaultInstance,
  });
  final String sessionId;
  final Directory? baseDirectory;
  final ConsultAudioConfig config;
  Directory? _sessionDir;
  final List<PendingChunk> _manifest = [];
  final Map<String, dynamic> control = {};
  Future<void> _writes = Future.value();
  Directory get sessionDirectory =>
      _sessionDir ?? (throw StateError('ERR_AUDIO_STORE_NOT_READY'));
  File get _manifestFile => File('${sessionDirectory.path}/manifest.json');
  int get nextSeq => (control['nextSeq'] as int?) ?? 0;
  int get totalPendingBytes =>
      _manifest.fold(0, (sum, c) => sum + c.fileSizeBytes);

  Future<T> _mutate<T>(Future<T> Function() action) {
    final result = _writes.then((_) => action());
    _writes = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return result;
  }

  Future<void> initialize() async {
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,80}$').hasMatch(sessionId)) {
      throw const FormatException('ERR_AUDIO_SESSION_ID');
    }
    final root = baseDirectory ?? await getApplicationSupportDirectory();
    _sessionDir = Directory('${root.path}/consult_pending_chunks/$sessionId');
    await sessionDirectory.create(recursive: true);
    _manifest.clear();
    control.clear();
    if (await _manifestFile.exists()) {
      try {
        final value = jsonDecode(await _manifestFile.readAsString());
        final chunks = value is List ? value : value['chunks'] as List;
        if (value is Map) {
          control.addAll(Map<String, dynamic>.from(value['control'] as Map));
        }
        for (final item in chunks) {
          final chunk = PendingChunk.fromJson(
            Map<String, dynamic>.from(item as Map),
          );
          if (chunk.seq < 0 || chunk.filePath != _chunkPath(chunk.seq)) {
            throw const FormatException('ERR_AUDIO_MANIFEST');
          }
          _manifest.add(chunk);
          if (nextSeq <= chunk.seq) control['nextSeq'] = chunk.seq + 1;
        }
      } catch (_) {
        throw const FormatException('ERR_AUDIO_MANIFEST');
      }
    }
  }

  String _chunkPath(int seq) =>
      '${sessionDirectory.path}/chunk_${sessionId}_patient_$seq.aac';
  Future<void> _save() async {
    final temp = File('${_manifestFile.path}.tmp');
    await temp.writeAsString(
      jsonEncode({
        'chunks': _manifest.map((c) => c.toJson()).toList(),
        'control': control,
      }),
      flush: true,
    );
    await temp.rename(_manifestFile.path);
  }

  Future<void> updateControl(Map<String, dynamic> updates) => _mutate(() async {
    control.addAll(updates);
    await _save();
  });
  List<PendingChunk> getPendingChunks() =>
      [..._manifest]..sort((a, b) => a.seq.compareTo(b.seq));
  List<InterruptionGap> get gaps => ((control['gaps'] as List?) ?? [])
      .map((g) => InterruptionGap.fromJson(Map<String, dynamic>.from(g as Map)))
      .toList();
  Future<void> addGap(InterruptionGap gap) => _mutate(() async {
    control['gaps'] = [
      ...gaps.where((g) => g.gapId != gap.gapId).map((g) => g.toJson()),
      gap.toJson(),
    ];
    await _save();
  });
  Future<void> acknowledgeGap(String id) => _mutate(() async {
    control['gaps'] = gaps
        .where((g) => g.gapId != id)
        .map((g) => g.toJson())
        .toList();
    await _save();
  });

  Future<PendingChunk> saveChunk({
    required int seq,
    required String clientChunkId,
    required int chunkStartMs,
    required int chunkEndMs,
    required bool isSilent,
    required double avgDbfs,
    required List<int> bytes,
  }) => _mutate(() async {
    final savedBytes = isSilent ? <int>[] : bytes;
    if (savedBytes.length > config.chunkMaxBytes ||
        totalPendingBytes + savedBytes.length > config.maxPendingStorageBytes) {
      throw const StorageCapacityExceededException('ERR_AUDIO_STORAGE_LIMIT');
    }
    if (seq < nextSeq || _manifest.any((c) => c.seq == seq)) {
      throw StateError('ERR_AUDIO_SEQUENCE_REUSE');
    }
    final target = File(_chunkPath(seq));
    final temp = File('${target.path}.tmp');
    await temp.writeAsBytes(savedBytes, flush: true);
    await temp.rename(target.path);
    final chunk = PendingChunk(
      seq: seq,
      clientChunkId: clientChunkId,
      chunkStartMs: chunkStartMs,
      chunkEndMs: chunkEndMs,
      isSilent: isSilent,
      avgDbfs: avgDbfs,
      filePath: target.path,
      fileSizeBytes: savedBytes.length,
      createdAt: DateTime.now(),
    );
    _manifest.add(chunk);
    control['nextSeq'] = seq + 1;
    control['lastEndMs'] = chunkEndMs;
    await _save();
    return chunk;
  });

  /// Commit removal first. A crash can leave an acknowledged orphan file, never
  /// a manifest that claims an unacknowledged missing file succeeded.
  Future<void> deleteChunk(int seq) => _mutate(() async {
    final chunk = _manifest.where((c) => c.seq == seq).firstOrNull;
    if (chunk == null) return;
    _manifest.remove(chunk);
    await _save();
    final file = File(chunk.filePath);
    if (await file.exists()) await file.delete();
  });

  Future<void> acknowledgeChunk(int seq) => _mutate(() async {
    final chunk = _manifest.where((c) => c.seq == seq).firstOrNull;
    if (chunk == null) return;
    _manifest.remove(chunk);
    control['acknowledged'] = (control['acknowledged'] as int? ?? 0) + 1;
    await _save();
    final file = File(chunk.filePath);
    if (await file.exists()) await file.delete();
  });

  Future<void> pruneStaleChunks() async {
    final cutoff = DateTime.now().subtract(
      Duration(hours: config.storageRetentionHours),
    );
    for (final chunk in getPendingChunks().where(
      (c) => c.createdAt.isBefore(cutoff),
    )) {
      await addGap(
        InterruptionGap(
          gapId: newOpaqueId(),
          startMs: chunk.chunkStartMs,
          durationMs: chunk.chunkEndMs - chunk.chunkStartMs,
          reasonCode: 'retention_expired',
        ),
      );
      await deleteChunk(chunk.seq);
      await updateControl({'incomplete': true});
    }
  }

  Future<void> discardUnsent() async {
    for (final chunk in getPendingChunks()) {
      await addGap(
        InterruptionGap(
          gapId: newOpaqueId(),
          startMs: chunk.chunkStartMs,
          durationMs: chunk.chunkEndMs - chunk.chunkStartMs,
          reasonCode: 'user_discarded',
        ),
      );
      await deleteChunk(chunk.seq);
    }
    await updateControl({
      'incomplete': true,
      'wasRecording': false,
      'finalCount': nextSeq,
    });
  }

  /// Run only at recovery, before the recorder/queue begins mutating files.
  Future<void> cleanOrphans() async {
    // Acknowledged files left behind by a crash may be removed. Untracked audio
    // means a capture write was interrupted, so recovery must flag the interval.
    await for (final file in sessionDirectory.list()) {
      if (file is File &&
          (file.path.endsWith('.aac') || file.path.endsWith('.tmp')) &&
          !_manifest.any((c) => c.filePath == file.path)) {
        final match = RegExp(r'_patient_(\d+)\.aac$').firstMatch(file.path);
        if (match != null && int.parse(match[1]!) >= nextSeq) {
          await updateControl({'incomplete': true});
        }
        await file.delete();
      }
    }
  }

  /// Retention is enforced while running and again at the next launch. An OS
  /// force-stop cannot execute deletion until the app runs again.
  static Future<void> pruneAll({
    String? skipSessionId,
    Directory? baseDirectory,
    ConsultAudioConfig config = ConsultAudioConfig.defaultInstance,
  }) async {
    final base = baseDirectory ?? await getApplicationSupportDirectory();
    final root = Directory('${base.path}/consult_pending_chunks');
    if (!await root.exists()) return;
    await for (final entry in root.list(followLinks: false)) {
      if (entry is! Directory) continue;
      final id = entry.path.split(Platform.pathSeparator).last;
      if (id == skipSessionId) continue;
      final pending = PendingAudioStore(
        sessionId: id,
        baseDirectory: base,
        config: config,
      );
      try {
        await pending.initialize();
        await pending.pruneStaleChunks();
        await pending.cleanOrphans();
      } catch (_) {
        // Corrupt metadata is a visible recovery error, not permission to keep
        // stale audio forever. Do not infer success or overwrite the manifest.
        final cutoff = DateTime.now().subtract(
          Duration(hours: config.storageRetentionHours),
        );
        await for (final file in entry.list(followLinks: false)) {
          if (file is File &&
              file.path.endsWith('.aac') &&
              (await file.lastModified()).isBefore(cutoff)) {
            await file.delete();
          }
        }
      }
    }
  }

  Future<void> clearSession() => _mutate(() async {
    _manifest.clear();
    control.clear();
    if (await sessionDirectory.exists()) {
      await sessionDirectory.delete(recursive: true);
    }
  });
}
