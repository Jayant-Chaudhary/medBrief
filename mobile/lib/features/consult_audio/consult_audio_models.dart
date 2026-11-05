/// Data models for the consultation audio recording pipeline.
/// No patient names, audio contents, or clinical diagnosis text.
library;

import 'dart:math';

String newOpaqueId() {
  final random = Random.secure();
  final bytes = List.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final value = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${value.substring(0, 8)}-${value.substring(8, 12)}-${value.substring(12, 16)}-${value.substring(16, 20)}-${value.substring(20)}';
}

enum ConsultSessionState {
  created,
  waiting,
  ready,
  recording,
  ending,
  processing,
  draftReady,
  completed,
  cancelled,
  failed,
  unknown;

  static ConsultSessionState fromString(String? value) => switch (value) {
    'created' => ConsultSessionState.created,
    'waiting' => ConsultSessionState.waiting,
    'ready' => ConsultSessionState.ready,
    'recording' => ConsultSessionState.recording,
    'ending' => ConsultSessionState.ending,
    'processing' => ConsultSessionState.processing,
    'draft_ready' => ConsultSessionState.draftReady,
    'completed' => ConsultSessionState.completed,
    'cancelled' => ConsultSessionState.cancelled,
    'failed' => ConsultSessionState.failed,
    _ => ConsultSessionState.unknown,
  };
}

class LoudnessSample {
  const LoudnessSample({required this.timestampMs, required this.dbfs});

  final int timestampMs;
  final double dbfs;

  Map<String, dynamic> toJson() => {'timestampMs': timestampMs, 'dbfs': dbfs};

  factory LoudnessSample.fromJson(Map<String, dynamic> json) => LoudnessSample(
    timestampMs: (json['timestampMs'] as num).toInt(),
    dbfs: (json['dbfs'] as num).toDouble(),
  );
}

class ClockSyncResult {
  const ClockSyncResult({required this.offsetMs, required this.minRttMs});

  final int offsetMs;
  final int minRttMs;
}

class PendingChunk {
  PendingChunk({
    required this.seq,
    required this.clientChunkId,
    required this.chunkStartMs,
    required this.chunkEndMs,
    required this.isSilent,
    required this.avgDbfs,
    required this.filePath,
    required this.fileSizeBytes,
    required this.createdAt,
    this.attempts = 0,
  });

  final int seq;
  final String clientChunkId;
  final int chunkStartMs;
  final int chunkEndMs;
  final bool isSilent;
  final double avgDbfs;
  final String filePath;
  final int fileSizeBytes;
  final DateTime createdAt;
  int attempts;

  Map<String, dynamic> toJson() => {
    'seq': seq,
    'clientChunkId': clientChunkId,
    'chunkStartMs': chunkStartMs,
    'chunkEndMs': chunkEndMs,
    'isSilent': isSilent,
    'avgDbfs': avgDbfs,
    'filePath': filePath,
    'fileSizeBytes': fileSizeBytes,
    'createdAt': createdAt.toIso8601String(),
    'attempts': attempts,
  };

  factory PendingChunk.fromJson(Map<String, dynamic> json) => PendingChunk(
    seq: (json['seq'] as num).toInt(),
    clientChunkId: json['clientChunkId'] as String,
    chunkStartMs: (json['chunkStartMs'] as num).toInt(),
    chunkEndMs: (json['chunkEndMs'] as num).toInt(),
    isSilent: json['isSilent'] as bool? ?? false,
    avgDbfs: (json['avgDbfs'] as num).toDouble(),
    filePath: json['filePath'] as String,
    fileSizeBytes: (json['fileSizeBytes'] as num).toInt(),
    createdAt: DateTime.parse(json['createdAt'] as String),
    attempts: (json['attempts'] as num?)?.toInt() ?? 0,
  );
}

class InterruptionGap {
  const InterruptionGap({
    required this.gapId,
    required this.startMs,
    required this.durationMs,
    required this.reasonCode,
  });

  final String gapId;
  final int startMs;
  final int durationMs;
  final String reasonCode;

  Map<String, dynamic> toJson() => {
    'gap_id': gapId,
    'start_ms': startMs,
    'duration_ms': durationMs,
    'reason_code': reasonCode,
  };

  factory InterruptionGap.fromJson(
    Map<String, dynamic> json,
  ) => InterruptionGap(
    gapId: (json['gap_id'] ?? json['gapId']) as String,
    startMs: ((json['start_ms'] ?? json['startMs']) as num).toInt(),
    durationMs: ((json['duration_ms'] ?? json['durationMs']) as num).toInt(),
    reasonCode:
        ((json['reason_code'] ?? json['reasonCode']) as String?) ?? 'unknown',
  );
}

class ConsultSessionSummary {
  const ConsultSessionSummary({
    required this.id,
    required this.status,
    this.roomCode,
    this.doctorReady = false,
    this.patientReady = false,
    this.doctorConsent = false,
    this.patientConsent = false,
    this.captureStartedAtDeviceMs,
  });

  final String id;
  final ConsultSessionState status;
  final String? roomCode;
  final bool doctorReady;
  final bool patientReady;
  final bool doctorConsent;
  final bool patientConsent;
  final int? captureStartedAtDeviceMs;

  factory ConsultSessionSummary.fromJson(Map<String, dynamic> json) {
    final sessionMap = json['session'] as Map<String, dynamic>? ?? json;
    final devices = (json['devices'] as List<dynamic>?) ?? [];
    final consents = (json['consents'] as List<dynamic>?) ?? [];

    bool docReady = false;
    bool patReady = false;
    for (final d in devices) {
      if (d is Map<String, dynamic>) {
        if (d['device'] == 'doctor' && d['status'] == 'ready') docReady = true;
        if (d['device'] == 'patient' && d['status'] == 'ready') patReady = true;
      }
    }

    bool docConsent = false;
    bool patConsent = false;
    for (final c in consents) {
      if (c is Map<String, dynamic>) {
        if (c['role'] == 'doctor') docConsent = true;
        if (c['role'] == 'patient') patConsent = true;
      }
    }

    return ConsultSessionSummary(
      id: sessionMap['id'] as String,
      status: ConsultSessionState.fromString(sessionMap['status'] as String?),
      roomCode: sessionMap['room_code'] as String?,
      doctorReady: docReady,
      patientReady: patReady,
      doctorConsent: docConsent,
      patientConsent: patConsent,
      captureStartedAtDeviceMs:
          (sessionMap['capture_started_at_device_ms'] as num?)?.toInt(),
    );
  }
}
