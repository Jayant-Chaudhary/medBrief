import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/features/community/community_page.dart';
import 'package:health_on_patient/features/community/community_repository.dart';

void main() {
  test('retry keeps an idempotency key after a failed submission', () async {
    final keys = <String>[];
    final api = ApiClient(
      baseUrl: 'https://synthetic.invalid',
      accessToken: () => 'synthetic',
      client: MockClient((req) async {
        keys.add(jsonDecode(req.body)['requestKey'] as String);
        return keys.length == 1
            ? http.Response('{}', 503)
            : http.Response('{}', 200);
      }),
    );
    final repository = CommunityRepository(api);
    await expectLater(
      repository.send('/care/messages', {'id': 'synthetic', 'body': 'Test'}),
      throwsA(isA<AppException>()),
    );
    await repository.send('/care/messages', {
      'id': 'synthetic',
      'body': 'Test',
    });
    expect(keys[0], keys[1]);
    api.close();
  });

  testWidgets(
    'disabled community explains availability without requesting enrolment',
    (tester) async {
      final api = ApiClient(
        baseUrl: 'https://synthetic.invalid',
        accessToken: () => 'synthetic',
        client: MockClient(
          (req) async => http.Response(
            jsonEncode({'enabled': false, 'version': null, 'text': 'Consent'}),
            200,
          ),
        ),
      );
      await tester.pumpWidget(
        MaterialApp(home: CommunityPage(repository: CommunityRepository(api))),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('not available yet'), findsOneWidget);
      expect(find.text('I understand and agree'), findsNothing);
      api.close();
    },
  );

  testWidgets('explicit consent precedes community membership and feed', (
    tester,
  ) async {
    var enrolled = false;
    final calls = <String>[];
    final api = ApiClient(
      baseUrl: 'https://synthetic.invalid',
      accessToken: () => 'synthetic',
      client: MockClient((req) async {
        calls.add(req.url.path);
        if (req.url.path.endsWith('/notice')) {
          return http.Response(
            jsonEncode({
              'enabled': true,
              'version': 'test-v1',
              'text': 'Pseudonymous community consent',
            }),
            200,
          );
        }
        if (req.url.path.endsWith('/enrol')) {
          enrolled = true;
          expect(jsonDecode(req.body)['noticeVersion'], 'test-v1');
          return http.Response('{}', 200);
        }
        if (req.url.path.endsWith('/me')) {
          return enrolled
              ? http.Response('{"username":"synthetic_mother"}', 200)
              : http.Response('{}', 403);
        }
        return http.Response('[]', 200);
      }),
    );
    await tester.pumpWidget(
      MaterialApp(home: CommunityPage(repository: CommunityRepository(api))),
    );
    await tester.pumpAndSettle();
    expect(calls.where((p) => p.endsWith('/posts')), isEmpty);
    await tester.tap(find.text('I understand and agree'));
    await tester.pumpAndSettle();
    expect(find.text('Posting as synthetic_mother'), findsOneWidget);
    expect(find.text('Care inbox'), findsOneWidget);
    api.close();
  });

  testWidgets(
    'inbox listing does not acknowledge messages; opening the conversation does',
    (tester) async {
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      var opened = 0;
      final api = ApiClient(
        baseUrl: 'https://synthetic.invalid',
        accessToken: () => 'synthetic',
        client: MockClient((req) async {
          final path = req.url.path;
          if (path.endsWith('/notice')) {
            return http.Response(
              '{"enabled":true,"version":"v1","text":"Consent"}',
              200,
            );
          }
          if (path.endsWith('/me')) {
            return http.Response('{"username":"synthetic_mother"}', 200);
          }
          if (path.endsWith('/care/threads')) {
            return http.Response(
              '[{"id":"synthetic-thread","closed":false}]',
              200,
            );
          }
          if (path.endsWith('/messages')) {
            return http.Response(
              '[{"id":"synthetic-message","senderType":"system","body":"Synthetic outreach"}]',
              200,
            );
          }
          if (path.endsWith('/care/respond')) {
            opened++;
            expect(jsonDecode(req.body)['kind'], 'opened');
            return http.Response('{}', 200);
          }
          return http.Response('[]', 200);
        }),
      );
      await tester.pumpWidget(
        MaterialApp(home: CommunityPage(repository: CommunityRepository(api))),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Care inbox'));
      await tester.pumpAndSettle();
      expect(opened, 0);
      await tester.tap(find.text('Private care conversation'));
      await tester.pumpAndSettle();
      expect(opened, 1);
      expect(find.text("I'm okay"), findsOneWidget);
      expect(find.text('I need help'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      api.close();
    },
  );
}
