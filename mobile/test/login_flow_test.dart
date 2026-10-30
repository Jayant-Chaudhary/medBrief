import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/app.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/features/auth/auth_controller.dart';
import 'package:health_on_patient/features/auth/auth_repository.dart';

import 'fake_auth_repository.dart';

void main() {
  late FakeAuthRepository repository;
  late AuthController auth;

  setUp(() {
    repository = FakeAuthRepository();
    auth = AuthController(repository);
  });

  tearDown(() async {
    auth.dispose();
    await repository.events.close();
  });

  Future<void> launch(WidgetTester tester) async {
    tester.view.resetPhysicalSize();
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await auth.start();
    await tester.pumpWidget(HealthOnApp(auth: auth));
    await tester.pumpAndSettle();
  }

  testWidgets('invalid form never sends credentials', (tester) async {
    await launch(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your email address.'), findsOneWidget);
    expect(find.text('Enter your password.'), findsOneWidget);
    expect(repository.signInCalls, 0);
  });

  testWidgets('login works and sign-out removes the authenticated view', (
    tester,
  ) async {
    await launch(tester);
    await tester.enterText(
      find.byType(TextFormField).first,
      'asha@example.com',
    );
    await tester.enterText(find.byType(TextFormField).last, 'password');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome, Asha'), findsOneWidget);
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Welcome, Asha'), findsNothing);
  });

  testWidgets('failed login shows a recoverable error', (tester) async {
    repository.signInError = const AppException(
      'The email or password is incorrect.',
    );
    await launch(tester);
    await tester.enterText(
      find.byType(TextFormField).first,
      'asha@example.com',
    );
    await tester.enterText(find.byType(TextFormField).last, 'wrong');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('The email or password is incorrect.'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Sign in'), findsOneWidget);
  });

  testWidgets('returning invite never asks for or resets password', (
    tester,
  ) async {
    repository.invite = const AppointmentInvite(
      email: 'asha@example.com',
      name: 'Asha',
      isUsed: false,
      isExpired: false,
      isReturningPatient: true,
    );
    await launch(tester);
    await tester.tap(find.text('I have a clinic invitation'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField),
      'https://clinic.example/invite/${'a' * 64}',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm password'), findsNothing);
    await tester.tap(find.text('Go to sign in'));
    await tester.pumpAndSettle();
    expect(repository.acceptCalls, 0);
    expect(find.text('asha@example.com'), findsOneWidget);
  });

  testWidgets(
    'new invitation validates confirmation and creates account once',
    (tester) async {
      await launch(tester);
      await tester.tap(find.text('I have a clinic invitation'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField),
        'https://clinic.example/invite/${'b' * 64}',
      );
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).first, 'password123');
      await tester.enterText(find.byType(TextFormField).last, 'different123');
      await tester.tap(find.text('Create my account'));
      await tester.pumpAndSettle();
      expect(find.text('The two passwords do not match.'), findsOneWidget);
      expect(repository.acceptCalls, 0);
      await tester.enterText(find.byType(TextFormField).last, 'password123');
      await tester.tap(find.text('Create my account'));
      await tester.pumpAndSettle();
      expect(repository.acceptCalls, 1);
      expect(find.text('Your account is ready'), findsOneWidget);
      expect(repository.signInCalls, 0);
    },
  );

  testWidgets('expired new invitation does not allow account creation', (
    tester,
  ) async {
    repository.invite = const AppointmentInvite(
      email: 'asha@example.com',
      name: 'Asha',
      isUsed: false,
      isExpired: true,
      isReturningPatient: false,
    );
    await launch(tester);
    await tester.tap(find.text('I have a clinic invitation'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField),
      'https://clinic.example/invite/${'c' * 64}',
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Create my account'), findsNothing);
    expect(
      find.textContaining('Ask your clinic for a new link'),
      findsOneWidget,
    );
    expect(repository.acceptCalls, 0);
  });

  testWidgets('small screens and large text can scroll without overflow', (
    tester,
  ) async {
    await launch(tester);
    tester.view.physicalSize = const Size(320, 568);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: HealthOnApp(auth: auth),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('I have a clinic invitation'));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'direct patient sign up from login page creates account and signs in',
      (tester) async {
    await launch(tester);
    await tester.ensureVisible(find.text('Sign up for an account'));
    await tester.tap(find.text('Sign up for an account'));
    await tester.pumpAndSettle();

    expect(find.text('Create your account'), findsOneWidget);

    // Fill form
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Jane Doe'), 'Jane Doe');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'you@example.com'),
        'patient@example.com');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Password'), 'password123');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Confirm password'), 'password123');

    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await tester.pumpAndSettle();

    expect(repository.signUpCalls, 1);
    expect(repository.signInCalls, 1);
    expect(find.text('Welcome, Jane'), findsOneWidget);
  });
}
