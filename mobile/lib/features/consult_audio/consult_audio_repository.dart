import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/api_client.dart';
import 'consult_audio_config.dart';
import 'consult_audio_models.dart';

abstract class ScopedTokenStorage {
  Future<void> write(String key, String value);
  Future<String?> read(String key);
  Future<void> delete(String key);
}

class FlutterScopedTokenStorage implements ScopedTokenStorage {
  const FlutterScopedTokenStorage([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class ConsultAudioRepository {
  ConsultAudioRepository({
    required this.api,
    ScopedTokenStorage? secureStorage,
    this.config = ConsultAudioConfig.defaultInstance,
  }) : _secureStorage = secureStorage ?? const FlutterScopedTokenStorage();

  final ApiClient api;
  final ScopedTokenStorage _secureStorage;
  final ConsultAudioConfig config;

  Future<dynamic> _request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    bool authenticated = true,
    String? bearerToken,
  }) => api.request(
    path,
    method: method,
    body: body,
    authenticated: authenticated,
    bearerToken: bearerToken,
    timeout: Duration(milliseconds: config.httpTimeoutMs),
  );

  String _tokenStorageKey(String sessionId) =>
      'consult_scoped_token_$sessionId';

  /// Joins a consultation session using a 6-character room code.
  Future<
    ({String sessionId, String scopedToken, ConsultSessionSummary session})
  >
  joinSession(String roomCode) async {
    final normCode = roomCode.trim().toUpperCase();
    final res = await _request(
      '/api/consults/join',
      method: 'POST',
      body: {'room_code': normCode},
    );

    if (res is! Map<String, dynamic> ||
        res['token'] is! String ||
        res['sessionId'] is! String) {
      throw const AppException('Invalid response joining consultation.');
    }

    final scopedToken = res['token'] as String;
    final session = ConsultSessionSummary(
      id: res['sessionId'] as String,
      status: ConsultSessionState.waiting,
    );

    await _secureStorage.write(_tokenStorageKey(session.id), scopedToken);

    return (sessionId: session.id, scopedToken: scopedToken, session: session);
  }

  /// Records patient audio recording consent.
  Future<void> recordConsent({
    required String sessionId,
    required String scopedToken,
    String? consentTextVersion,
  }) async {
    await _request(
      '/api/consults/$sessionId/consent',
      method: 'POST',
      bearerToken: scopedToken,
      body: {
        'consent_text_version': consentTextVersion ?? config.consentTextVersion,
      },
    );
  }

  /// Performs NTP-style 5-round clock synchronization with the server.
  Future<ClockSyncResult> performClockSync() async {
    int bestRtt = 1000000;
    int bestOffset = 0;

    for (int i = 0; i < config.clockHandshakeRounds; i++) {
      final t0 = DateTime.now().millisecondsSinceEpoch;
      final elapsed = Stopwatch()..start();
      try {
        final res = await _request('/api/time', authenticated: false);
        final rtt = elapsed.elapsedMilliseconds;
        final serverTime =
            (res as Map<String, dynamic>)['server_time_ms'] as int;

        final offset = serverTime - (t0 + (rtt / 2)).round();

        if (rtt < bestRtt) {
          bestRtt = rtt;
          bestOffset = offset;
        }
      } catch (_) {
        // Continue handshake round on failure
      }
    }

    if (bestRtt == 1000000) {
      throw const AppException(
        'Could not synchronize. Please check your connection.',
      );
    }

    return ClockSyncResult(
      offsetMs: bestOffset,
      minRttMs: bestRtt == 1000000 ? 0 : bestRtt,
    );
  }

  /// Signals patient device readiness with clock offset and RTT.
  Future<void> markReady({
    required String sessionId,
    required String scopedToken,
    required int offsetMs,
    required int rttMs,
  }) async {
    await _request(
      '/api/consults/$sessionId/devices/patient/ready',
      method: 'POST',
      bearerToken: scopedToken,
      body: {'offset_ms': offsetMs, 'rtt_ms': rttMs},
    );
  }

  /// Records the device's authoritative capture zero millisecond timestamp.
  Future<void> recordCaptureStarted({
    required String sessionId,
    required String scopedToken,
    required int captureStartedAtDeviceMs,
  }) async {
    await _request(
      '/api/consults/$sessionId/devices/patient/capture-started',
      method: 'POST',
      bearerToken: scopedToken,
      body: {'capture_zero_device_ms': captureStartedAtDeviceMs},
    );
  }

  /// Records an explicit timeline capture interruption gap.
  Future<void> recordInterruptionGap({
    required String sessionId,
    required String scopedToken,
    required InterruptionGap gap,
  }) async {
    await _request(
      '/api/consults/$sessionId/devices/patient/gaps',
      method: 'POST',
      bearerToken: scopedToken,
      body: gap.toJson(),
    );
  }

  /// Fetches current consultation session state.
  Future<ConsultSessionSummary> getSessionState({
    required String sessionId,
    required String scopedToken,
  }) async {
    final res = await _request(
      '/api/consults/$sessionId/state',
      bearerToken: scopedToken,
    );
    return ConsultSessionSummary.fromJson(res as Map<String, dynamic>);
  }

  /// Retrieves cached scoped token from secure storage.
  Future<String?> getStoredScopedToken(String sessionId) =>
      _secureStorage.read(_tokenStorageKey(sessionId));

  /// Clears scoped consultation token.
  Future<void> clearScopedToken(String sessionId) =>
      _secureStorage.delete(_tokenStorageKey(sessionId));

  Future<void> rememberActive(
    String sessionId,
    String ownerId, {
    bool uploadOnly = false,
  }) async {
    final descriptor = jsonEncode({
      'sessionId': sessionId,
      'ownerId': ownerId,
      'baseUrl': api.baseUrl,
      'uploadOnly': uploadOnly,
    });
    await _secureStorage.write('consult_active_$ownerId', descriptor);
    await _secureStorage.write('consult_task_active', descriptor);
  }

  Future<Map<String, dynamic>?> activeFor(String ownerId) async {
    final value = await _secureStorage.read('consult_active_$ownerId');
    if (value == null) return null;
    return Map<String, dynamic>.from(jsonDecode(value) as Map);
  }

  Future<void> forgetActive(String ownerId) =>
      _secureStorage.delete('consult_active_$ownerId');
}
