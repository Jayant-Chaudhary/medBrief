import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('profile uses the current bearer token and existing endpoint', () async {
    final api = ApiClient(
      baseUrl: 'https://api.example/',
      accessToken: () => 'current-token',
      client: MockClient((request) async {
        expect(request.url.toString(), 'https://api.example/api/profile');
        expect(request.headers['Authorization'], 'Bearer current-token');
        return http.Response('{"role":"patient"}', 200);
      }),
    );
    addTearDown(api.close);
    expect(await api.request('/api/profile'), {'role': 'patient'});
  });

  test(
    'public invitation calls do not attach an existing account token',
    () async {
      final api = ApiClient(
        baseUrl: 'https://api.example',
        accessToken: () => 'private-token',
        client: MockClient((request) async {
          expect(request.headers.containsKey('Authorization'), isFalse);
          expect(jsonDecode(request.body), {
            'token': 'invite',
            'password': 'secret',
          });
          return http.Response('{}', 200);
        }),
      );
      addTearDown(api.close);
      await api.request(
        '/api/auth/accept-invite',
        method: 'POST',
        authenticated: false,
        body: {'token': 'invite', 'password': 'secret'},
      );
    },
  );

  test('server errors do not expose raw backend details', () async {
    final api = ApiClient(
      baseUrl: 'https://api.example',
      accessToken: () => 'token',
      client: MockClient(
        (_) async =>
            http.Response('{"error":"sensitive database internals"}', 500),
      ),
    );
    addTearDown(api.close);
    await expectLater(
      api.request('/api/profile'),
      throwsA(
        isA<AppException>().having(
          (error) => error.message,
          'message',
          isNot(contains('sensitive')),
        ),
      ),
    );
  });
}
