import 'dart:async';

import 'package:health_on_patient/features/auth/auth_repository.dart';

class FakeAuthRepository implements AuthRepository {
  bool session = false;
  int signInCalls = 0;
  int signUpCalls = 0;
  int acceptCalls = 0;
  String? signedInEmail;
  String? signedInPassword;
  Object? signInError;
  Object? profileError;
  Completer<void>? signInGate;
  PatientProfile profile = const PatientProfile(
    id: 'patient-1',
    role: 'patient',
    fullName: 'Asha',
  );
  AppointmentInvite invite = const AppointmentInvite(
    email: 'asha@example.com',
    name: 'Asha',
    isUsed: false,
    isExpired: false,
    isReturningPatient: false,
  );
  final events = StreamController<bool>.broadcast();

  @override
  bool get hasSession => session;
  @override
  Stream<bool> get sessionChanges => events.stream;
  @override
  Future<void> restoreSession() async {}

  @override
  Future<void> signIn(String email, String password) async {
    signInCalls++;
    signedInEmail = email;
    signedInPassword = password;
    if (signInGate != null) await signInGate!.future;
    if (signInError != null) throw signInError!;
    session = true;
  }

  @override
  Future<void> signOut() async {
    session = false;
    events.add(false);
  }

  @override
  Future<PatientProfile> getProfile() async {
    if (profileError != null) throw profileError!;
    return profile;
  }

  @override
  Future<PatientProfile> completeProfile(String name, String phone) async {
    profile = PatientProfile(
      id: profile.id,
      role: profile.role,
      fullName: name,
      phone: phone,
    );
    return profile;
  }

  @override
  Future<AppointmentInvite> getInvite(String token) async => invite;

  @override
  Future<void> acceptInvite(String token, String password) async {
    acceptCalls++;
  }

  @override
  Future<void> signUp({
    required String email,
    required String password,
    String? fullName,
    String? phone,
  }) async {
    signUpCalls++;
    if (fullName != null && fullName.trim().isNotEmpty) {
      profile = PatientProfile(
        id: profile.id,
        role: profile.role,
        fullName: fullName.trim(),
        phone: phone?.trim(),
      );
    }
  }
}
