import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_config.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_models.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_repository.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class FakeSecureStorage implements ScopedTokenStorage {
  final Map<String, String> _data = {};

  @override
  Future<void> write(String key, String value) async {
    _data[key] = value;
  }

  @override
  Future<String?> read(String key) async => _data[key];

  @override
  Future<void> delete(String key) async => _data.remove(key);
}

void main() {
  group('ConsultAudioRepository Tests', () {
    test(
      'joinSession parses scoped token, returns summary, and stores token',
      () async {
        final fakeStorage = FakeSecureStorage();
        final api = ApiClient(
          baseUrl: 'https://api.example',
          accessToken: () => 'patient-jwt',
          client: MockClient((request) async {
            expect(request.url.path, '/api/consults/join');
            expect(request.method, 'POST');
            return http.Response(
              '{"sessionId":"sess-1","session_id":"sess-1","patientToken":"scoped-token-123","token":"scoped-token-123"}',
              200,
            );
          }),
        );

        final repo = ConsultAudioRepository(
          api: api,
          secureStorage: fakeStorage,
        );
        final result = await repo.joinSession('ab12cd');

        expect(result.sessionId, 'sess-1');
        expect(result.scopedToken, 'scoped-token-123');
        expect(result.session.status, ConsultSessionState.waiting);

        final stored = await repo.getStoredScopedToken('sess-1');
        expect(stored, 'scoped-token-123');
      },
    );

    test('recordConsent sends scoped token and consent version', () async {
      final api = ApiClient(
        baseUrl: 'https://api.example',
        accessToken: () => 'patient-jwt',
        client: MockClient((request) async {
          expect(request.url.path, '/api/consults/sess-1/consent');
          expect(request.headers['Authorization'], 'Bearer scoped-token-123');
          expect(request.body, '{"consent_text_version":"v1.0"}');
          return http.Response('{"ok":true}', 200);
        }),
      );

      final repo = ConsultAudioRepository(
        api: api,
        secureStorage: FakeSecureStorage(),
      );
      await repo.recordConsent(
        sessionId: 'sess-1',
        scopedToken: 'scoped-token-123',
        consentTextVersion: 'v1.0',
      );
    });

    test(
      'performClockSync selects smallest RTT round and calculates offset',
      () async {
        int round = 0;
        final api = ApiClient(
          baseUrl: 'https://api.example',
          accessToken: () => 'token',
          client: MockClient((request) async {
            round++;
            final now = DateTime.now().millisecondsSinceEpoch;
            return http.Response('{"server_time_ms":${now + 100}}', 200);
          }),
        );

        final repo = ConsultAudioRepository(
          api: api,
          secureStorage: FakeSecureStorage(),
          config: const ConsultAudioConfig(clockHandshakeRounds: 3),
        );

        final result = await repo.performClockSync();
        expect(round, 3);
        expect(result.minRttMs, greaterThanOrEqualTo(0));
        expect(result.offsetMs, greaterThanOrEqualTo(50));
      },
    );

    test('recordInterruptionGap sends gap metadata to gaps endpoint', () async {
      final api = ApiClient(
        baseUrl: 'https://api.example',
        accessToken: () => 'token',
        client: MockClient((request) async {
          expect(request.url.path, '/api/consults/sess-1/devices/patient/gaps');
          expect(request.headers['Authorization'], 'Bearer scoped-token-123');
          return http.Response('{"ok":true}', 201);
        }),
      );

      final repo = ConsultAudioRepository(
        api: api,
        secureStorage: FakeSecureStorage(),
      );
      await repo.recordInterruptionGap(
        sessionId: 'sess-1',
        scopedToken: 'scoped-token-123',
        gap: const InterruptionGap(
          gapId: 'gap-uuid-1',
          startMs: 12000,
          durationMs: 3000,
          reasonCode: 'phone_call',
        ),
      );
    });
  });
}
