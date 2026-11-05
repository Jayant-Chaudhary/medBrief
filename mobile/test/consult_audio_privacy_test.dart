import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_config.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test(
    'hostile backend messages cannot reach user errors or console output',
    () async {
      final output = <String>[];
      await runZoned(
        () async {
          final api = ApiClient(
            baseUrl: 'https://api.example',
            accessToken: () => 'synthetic-secret',
            client: MockClient(
              (_) async => http.Response(
                '{"error":"synthetic-name synthetic-health-value synthetic-secret"}',
                503,
              ),
            ),
          );
          try {
            await api.request('/api/consults/synthetic/state');
            fail('Expected controlled failure');
          } on AppException catch (error) {
            expect(
              error.message,
              'We could not complete that request. Please try again.',
            );
            expect(error.message.contains('synthetic'), false);
          }
        },
        zoneSpecification: ZoneSpecification(
          print: (_, _, _, text) {
            output.add(text);
          },
        ),
      );
      expect(output, isEmpty);
    },
  );
  test(
    'all notification text is generic and independent of session contents',
    () {
      final notifications = [
        ConsultAudioConfig.notificationTitle,
        ConsultAudioConfig.notificationWaiting,
        ConsultAudioConfig.notificationActive,
        ConsultAudioConfig.notificationPending,
      ];
      for (final text in notifications) {
        expect(
          RegExp(
            r'consultation|patient|doctor|transcript|diagnos|blood|synthetic',
            caseSensitive: false,
          ).hasMatch(text),
          false,
        );
      }
    },
  );
}
