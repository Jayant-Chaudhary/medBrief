import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
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

  test('restores a patient session and checks the API profile', () async {
    repository.session = true;
    await auth.start();
    expect(auth.stage, AuthStage.signedIn);
    expect(auth.profile?.id, 'patient-1');
  });

  test('rejects clinician accounts and clears their local session', () async {
    repository.profile = const PatientProfile(
      id: 'doctor-1',
      role: 'clinician',
      fullName: 'Doctor',
    );
    await auth.start();
    await auth.signIn('doctor@example.com', 'password');
    expect(auth.stage, AuthStage.signedOut);
    expect(repository.hasSession, isFalse);
    expect(auth.profile, isNull);
    expect(auth.error, contains('clinician website'));
  });

  test(
    'missing name routes to onboarding then saves through repository',
    () async {
      repository.profile = const PatientProfile(
        id: 'patient-1',
        role: 'patient',
        fullName: '',
      );
      await auth.start();
      await auth.signIn(' asha@example.com ', '  password  ');
      expect(auth.stage, AuthStage.onboarding);
      expect(repository.signedInEmail, 'asha@example.com');
      expect(repository.signedInPassword, '  password  ');
      await auth.completeProfile(' Asha ', ' +91 9999999999 ');
      expect(auth.stage, AuthStage.signedIn);
      expect(auth.profile?.fullName, 'Asha');
    },
  );

  test(
    'a profile outage preserves session but does not admit patient',
    () async {
      repository.session = true;
      repository.profileError = const AppException('Service unavailable');
      await auth.start();
      expect(auth.stage, AuthStage.unavailable);
      expect(auth.profile, isNull);
      expect(repository.session, isTrue);
      repository.profileError = null;
      await auth.restore();
      expect(auth.stage, AuthStage.signedIn);
    },
  );

  test('concurrent submissions produce only one sign-in call', () async {
    await auth.start();
    repository.signInGate = Completer<void>();
    final pending = auth.signIn('asha@example.com', 'password');
    await auth.signIn('asha@example.com', 'password');
    expect(repository.signInCalls, 1);
    repository.signInGate!.complete();
    await pending;
    expect(auth.stage, AuthStage.signedIn);
  });

  test('external sign-out removes patient from the app', () async {
    repository.session = true;
    await auth.start();
    repository.session = false;
    repository.events.add(false);
    await Future<void>.delayed(Duration.zero);
    expect(auth.stage, AuthStage.signedOut);
    expect(auth.profile, isNull);
  });

  test('parses website invitations without fetching the pasted host', () {
    final token = 'a' * 64;
    expect(parseInviteToken('https://clinic.example/invite/$token'), token);
    expect(parseInviteToken(' $token '), token);
    expect(
      () => parseInviteToken('https://example.com/other/$token'),
      throwsA(isA<AppException>()),
    );
    expect(
      () => parseInviteToken('javascript:alert(1)'),
      throwsA(isA<AppException>()),
    );
  });
}
