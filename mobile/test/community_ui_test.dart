import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/app.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/core/app_theme.dart';
import 'package:health_on_patient/features/auth/auth_controller.dart';
import 'package:health_on_patient/features/community/community_page.dart';
import 'package:health_on_patient/features/community/community_repository.dart';
import 'package:health_on_patient/features/home/appointment_repository.dart';
import 'package:health_on_patient/features/home/home_page.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'fake_auth_repository.dart';

const syntheticCommunityPosts = [
  {
    'id': 'post-one',
    'username': 'quiet_garden',
    'title': 'What helped you feel prepared for your first visit?',
    'body':
        'I am making a little list of questions and packing a notebook. What helped you feel more at ease?',
    'owned': false,
    'replyCount': 3,
    'badges': <String>[],
    'tags': [
      {'id': 'tag-one', 'name': 'First pregnancy'},
    ],
  },
  {
    'id': 'post-two',
    'username': 'gentle_sunrise',
    'title': 'Small moments that made today a little brighter',
    'body':
        'A warm cup of tea and a short call with a friend made a difference today. Sharing a little encouragement with everyone here.',
    'owned': false,
    'replyCount': 1,
    'badges': <String>[],
    'tags': [
      {'id': 'tag-two', 'name': 'Everyday support'},
    ],
  },
];

class CommunityUiFixture {
  final calls = <http.Request>[];
  bool failSubmission = false;
  bool usernameTaken = false;
  String username = 'calm_meadow';
  bool canChooseUsername = true;
  bool usernameStatusFails = false;
  late final api = ApiClient(
    baseUrl: 'https://synthetic.invalid',
    accessToken: () => 'synthetic',
    client: MockClient((req) async {
      calls.add(req);
      final path = req.url.path;
      dynamic result = <dynamic>[];
      if (path.endsWith('/notice')) {
        result = {
          'enabled': true,
          'version': 'test-v1',
          'text': 'Synthetic pseudonymous consent notice.',
        };
      } else if (path.endsWith('/me')) {
        result = {'username': username, 'professional': false};
      } else if (path.endsWith('/username')) {
        if (!canChooseUsername) return http.Response('{}', 403);
        if (usernameTaken) return http.Response('{}', 409);
        username = jsonDecode(req.body)['username'] as String;
        canChooseUsername = false;
        result = {'username': username};
      } else if (path.endsWith('/username/status')) {
        if (usernameStatusFails) return http.Response('{}', 503);
        result = {'canChooseUsername': canChooseUsername};
      } else if (path.endsWith('/tags')) {
        result = [
          {'id': 'tag-one', 'name': 'First pregnancy'},
          {'id': 'tag-two', 'name': 'Everyday support'},
        ];
      } else if (path.endsWith('/posts') && req.method == 'GET') {
        result = req.url.queryParameters['tag'] == 'tag-one'
            ? [syntheticCommunityPosts.first]
            : syntheticCommunityPosts;
      } else if (path.endsWith('/posts') && req.method == 'POST') {
        return http.Response('{}', failSubmission ? 503 : 200);
      } else if (path.endsWith('/posts/post-one')) {
        result = [syntheticCommunityPosts.first];
      } else if (path.endsWith('/posts/post-two')) {
        result = [syntheticCommunityPosts.last];
      } else if (path.endsWith('/comments') && req.method == 'GET') {
        result = req.url.queryParameters['parentId'] == 'reply-one'
            ? [
                {
                  'id': 'nested-one',
                  'parentId': 'reply-one',
                  'username': 'soft_cloud',
                  'body': 'A small list worked for me as well.',
                  'owned': false,
                  'hasReplies': false,
                },
              ]
            : [
                {
                  'id': 'reply-one',
                  'username': 'kind_horizon',
                  'body': 'A notebook helped me remember my questions too.',
                  'owned': false,
                  'hasReplies': true,
                },
              ];
      } else if (path.endsWith('/care/threads')) {
        result = [
          {'id': 'thread-one', 'closed': false},
        ];
      } else if (path.endsWith('/messages')) {
        result = [
          {
            'id': 'message-one',
            'senderType': 'system',
            'body': 'Synthetic outreach: how are you feeling today?',
          },
        ];
      }
      return http.Response(jsonEncode(result), 200);
    }),
  );
  Future<void> pumpPage(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: CommunityPage(repository: CommunityRepository(api)),
      ),
    );
    await tester.pumpAndSettle();
  }
}

class EmptyCommunityAppointments extends AppointmentRepository {
  @override
  Future<AppointmentSet> getAppointments() async => AppointmentSet.empty();
  @override
  Future<LatestVitals> getLatestVitals() async => const LatestVitals();
}

void main() {
  testWidgets(
    'locked username cannot open the chooser; a new reveal status enables one choice',
    (tester) async {
      final fixture = CommunityUiFixture()..canChooseUsername = false;
      await fixture.pumpPage(tester);
      expect(find.byTooltip('Community username locked'), findsOneWidget);
      expect(find.text('Choose username'), findsNothing);
      await tester.tap(find.byTooltip('Community username locked'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      fixture.canChooseUsername =
          true; // Simulate server status after approved rotation.
      await tester.tap(find.byTooltip('Refresh'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Choose community username'), findsOneWidget);
      await tester.tap(find.byTooltip('Choose community username'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Community username'),
        'fresh_garden',
      );
      await tester.tap(find.text('Save username'));
      await tester.pumpAndSettle();
      expect(find.text('Posting as fresh_garden'), findsOneWidget);
      expect(find.byTooltip('Community username locked'), findsOneWidget);
      fixture.api.close();
    },
  );
  testWidgets(
    'failed username status check keeps the name locked without hiding the feed',
    (tester) async {
      final fixture = CommunityUiFixture()..usernameStatusFails = true;
      await fixture.pumpPage(tester);
      expect(find.byTooltip('Community username locked'), findsOneWidget);
      expect(find.byTooltip('Choose community username'), findsNothing);
      expect(
        find.text(syntheticCommunityPosts.first['title'] as String),
        findsOneWidget,
      );
      fixture.api.close();
    },
  );
  testWidgets(
    'generated username offers a blank chooser instead of a long code',
    (tester) async {
      final generated = 'mother_${List.filled(24, 'a').join()}';
      final fixture = CommunityUiFixture()..username = generated;
      await fixture.pumpPage(tester);
      expect(find.text('Pick your community username'), findsOneWidget);
      expect(find.text('Posting as $generated'), findsNothing);
      await tester.tap(find.byTooltip('Choose community username'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(
              find.widgetWithText(TextField, 'Community username'),
            )
            .controller!
            .text,
        isEmpty,
      );
      fixture.api.close();
    },
  );
  testWidgets(
    'discussion stays below the post and nested replies collapse independently',
    (tester) async {
      final fixture = CommunityUiFixture();
      await fixture.pumpPage(tester);
      await tester.ensureVisible(find.text('Read discussion').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Read discussion').first);
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byType(AppBar),
          matching: find.text('Community'),
        ),
        findsOneWidget,
      );
      expect(find.text('Hide discussion'), findsOneWidget);
      await tester.ensureVisible(find.text('Show replies'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Show replies'));
      await tester.pumpAndSettle();
      expect(find.text('A small list worked for me as well.'), findsOneWidget);
      expect(
        fixture.calls.any(
          (r) => r.url.queryParameters['parentId'] == 'reply-one',
        ),
        isTrue,
      );
      await tester.ensureVisible(find.byTooltip('Collapse thread').first);
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Collapse thread').first);
      await tester.pumpAndSettle();
      expect(find.text('Thread collapsed'), findsOneWidget);
      expect(find.text('A small list worked for me as well.'), findsNothing);
      await tester.tap(find.byTooltip('Expand thread'));
      await tester.pumpAndSettle();
      expect(find.text('A small list worked for me as well.'), findsOneWidget);
      await tester.ensureVisible(find.text('Hide discussion'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hide discussion'));
      await tester.pumpAndSettle();
      expect(find.text('Discussion'), findsNothing);
      expect(tester.takeException(), isNull);
      fixture.api.close();
    },
  );
  testWidgets('replying to a comment sends its parent ID', (tester) async {
    final fixture = CommunityUiFixture();
    await fixture.pumpPage(tester);
    await tester.ensureVisible(find.text('Read discussion').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Read discussion').first);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Reply').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reply').first);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Your reply'),
      'Synthetic nested reply',
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Send reply'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send reply'));
    await tester.pumpAndSettle();
    final request = fixture.calls.firstWhere(
      (r) => r.method == 'POST' && r.url.path.endsWith('/comments'),
    );
    expect(jsonDecode(request.body), containsPair('parentId', 'reply-one'));
    expect(jsonDecode(request.body), containsPair('postId', 'post-one'));
    fixture.api.close();
  });
  testWidgets(
    'username conflicts retain the choice and successful save refreshes the public name',
    (tester) async {
      final fixture = CommunityUiFixture()..usernameTaken = true;
      await fixture.pumpPage(tester);
      await tester.tap(find.byTooltip('Choose community username'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Community username'),
        'calm_garden',
      );
      await tester.tap(find.text('Save username'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('That username is unavailable'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<TextField>(
              find.widgetWithText(TextField, 'Community username'),
            )
            .controller!
            .text,
        'calm_garden',
      );
      fixture.usernameTaken = false;
      await tester.tap(find.text('Save username'));
      await tester.pumpAndSettle();
      expect(find.text('Posting as calm_garden'), findsOneWidget);
      expect(find.byTooltip('Community username locked'), findsOneWidget);
      expect(find.byTooltip('Choose community username'), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), isNull);
      fixture.api.close();
    },
  );
  testWidgets(
    'Community is a main navigation destination and exposes only a pseudonym',
    (tester) async {
      final fixture = CommunityUiFixture();
      final repository = FakeAuthRepository()..session = true;
      final auth = AuthController(repository);
      await auth.start();
      await tester.pumpWidget(
        MaterialApp(
          theme: buildTheme(),
          home: HomePage(
            auth: auth,
            api: fixture.api,
            repository: EmptyCommunityAppointments(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(NavigationDestination), findsNWidgets(6));
      await tester.tap(find.widgetWithText(NavigationDestination, 'Community'));
      await tester.pumpAndSettle();
      expect(find.text('Posting as calm_meadow'), findsOneWidget);
      expect(find.textContaining('Asha'), findsNothing);
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      auth.dispose();
      await repository.events.close();
      fixture.api.close();
    },
  );
  testWidgets(
    'topic filtering, local search and discussion use actual API data',
    (tester) async {
      final fixture = CommunityUiFixture();
      await fixture.pumpPage(tester);
      await tester.enterText(find.byType(TextField).first, 'prepared');
      await tester.pumpAndSettle();
      expect(
        find.text(syntheticCommunityPosts.first['title'] as String),
        findsOneWidget,
      );
      expect(
        find.text(syntheticCommunityPosts.last['title'] as String),
        findsNothing,
      );
      await tester.tap(find.byTooltip('Clear search'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ChoiceChip, 'First pregnancy'));
      await tester.pumpAndSettle();
      expect(
        fixture.calls.any((r) => r.url.queryParameters['tag'] == 'tag-one'),
        isTrue,
      );
      await tester.tap(
        find.text(syntheticCommunityPosts.first['title'] as String),
      );
      await tester.pumpAndSettle();
      expect(find.text('Discussion'), findsOneWidget);
      expect(
        find.text('A notebook helped me remember my questions too.'),
        findsOneWidget,
      );
      await tester.tap(find.byTooltip('Report this post'));
      await tester.pumpAndSettle();
      expect(find.text("I'm worried about this person"), findsOneWidget);
      fixture.api.close();
    },
  );
  testWidgets('failed post submission retains the draft and retry key', (
    tester,
  ) async {
    final fixture = CommunityUiFixture()..failSubmission = true;
    await fixture.pumpPage(tester);
    await tester.tap(find.text('+ Ask'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Title'),
      'Synthetic title',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Your post'),
      'A synthetic experience to share.',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Submit for review'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Your draft is still here'), findsOneWidget);
    expect(find.text('Synthetic title'), findsOneWidget);
    fixture.failSubmission = false;
    await tester.tap(find.text('Submit for review'));
    await tester.pumpAndSettle();
    final submissions = fixture.calls
        .where((r) => r.method == 'POST' && r.url.path.endsWith('/posts'))
        .toList();
    expect(submissions, hasLength(2));
    expect(
      jsonDecode(submissions[0].body)['requestKey'],
      jsonDecode(submissions[1].body)['requestKey'],
    );
    expect(find.textContaining('Your draft is still here'), findsNothing);
    expect(
      find.textContaining('follow its status in My posts'),
      findsOneWidget,
    );
    fixture.api.close();
  });
  testWidgets(
    'narrow screens, larger text and an open keyboard stay scrollable',
    (tester) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final fixture = CommunityUiFixture();
      await tester.pumpWidget(
        MaterialApp(
          theme: buildTheme(),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: CommunityPage(repository: CommunityRepository(fixture.api)),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('+ Ask'));
      await tester.pumpAndSettle();
      tester.view.viewInsets = const FakeViewPadding(bottom: 280);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      tester.view.resetViewInsets();
      fixture.api.close();
    },
  );
  testWidgets('signing out disposes the community composer and its draft', (
    tester,
  ) async {
    final fixture = CommunityUiFixture();
    final repository = FakeAuthRepository()..session = true;
    final auth = AuthController(repository);
    await auth.start();
    await tester.pumpWidget(
      HealthOnApp(
        auth: auth,
        api: fixture.api,
        appointmentRepository: EmptyCommunityAppointments(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(NavigationDestination, 'Community'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('+ Ask'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Your post'),
      'Private synthetic draft',
    );
    await auth.signOut();
    await tester.pumpAndSettle();
    expect(find.text('Private synthetic draft'), findsNothing);
    expect(find.text('Share with the community'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    auth.dispose();
    await repository.events.close();
    fixture.api.close();
  });
}
