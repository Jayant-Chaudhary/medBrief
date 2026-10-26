import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api_client.dart';

class PatientProfile {
  const PatientProfile({
    required this.id,
    required this.role,
    required this.fullName,
    this.phone,
  });

  factory PatientProfile.fromJson(Map<String, dynamic> json) => PatientProfile(
    id: json['id'] as String,
    role: json['role'] as String,
    fullName: json['fullName'] as String? ?? '',
    phone: json['phone'] as String?,
  );

  final String id;
  final String role;
  final String fullName;
  final String? phone;
  bool get needsOnboarding => fullName.trim().isEmpty;
}

class AppointmentInvite {
  const AppointmentInvite({
    required this.email,
    required this.name,
    required this.isUsed,
    required this.isExpired,
    required this.isReturningPatient,
    this.scheduledAt,
  });

  factory AppointmentInvite.fromJson(Map<String, dynamic> json) =>
      AppointmentInvite(
        email: json['patientEmail'] as String,
        name: json['patientFullName'] as String? ?? '',
        isUsed: json['isUsed'] == true,
        isExpired: json['isExpired'] == true,
        isReturningPatient: json['isReturningPatient'] == true,
        scheduledAt: DateTime.tryParse(json['scheduledAt'] as String? ?? ''),
      );

  final String email;
  final String name;
  final bool isUsed;
  final bool isExpired;
  final bool isReturningPatient;
  final DateTime? scheduledAt;
}

/// Accept the existing website's /invite/<64-character token> links.
/// Only the token is sent to our configured API; pasted URLs are never fetched.
String parseInviteToken(String input) {
  final text = input.trim();
  final tokenPattern = RegExp(r'^[a-fA-F0-9]{64}$');
  if (tokenPattern.hasMatch(text)) return text;
  final uri = Uri.tryParse(text);
  if (uri != null &&
      (uri.scheme == 'https' || uri.scheme == 'http') &&
      uri.hasAuthority &&
      uri.pathSegments.length == 2 &&
      uri.pathSegments.first == 'invite' &&
      tokenPattern.hasMatch(uri.pathSegments.last)) {
    return uri.pathSegments.last;
  }
  throw const AppException(
    'Paste the complete invitation link from your clinic.',
  );
}

abstract class AuthRepository {
  bool get hasSession;
  Stream<bool> get sessionChanges;
  Future<void> restoreSession();
  Future<void> signIn(String email, String password);
  Future<void> signOut();
  Future<PatientProfile> getProfile();
  Future<PatientProfile> completeProfile(String name, String phone);
  Future<AppointmentInvite> getInvite(String token);
  Future<void> acceptInvite(String token, String password);
}

class SupabaseAuthRepository implements AuthRepository {
  SupabaseAuthRepository({required this.supabase, required this.api});
  final SupabaseClient supabase;
  final ApiClient api;

  @override
  bool get hasSession => supabase.auth.currentSession != null;

  @override
  Stream<bool> get sessionChanges =>
      supabase.auth.onAuthStateChange.map((state) => state.session != null);

  @override
  Future<void> restoreSession() async {
    if (supabase.auth.currentSession?.isExpired == true) {
      await supabase.auth.refreshSession();
    }
  }

  @override
  Future<void> signIn(String email, String password) async {
    await supabase.auth.signInWithPassword(email: email, password: password);
  }

  @override
  Future<void> signOut() => supabase.auth.signOut(scope: SignOutScope.local);

  @override
  Future<PatientProfile> getProfile() async => PatientProfile.fromJson(
    Map<String, dynamic>.from(await api.request('/api/profile') as Map),
  );

  @override
  Future<PatientProfile> completeProfile(String name, String phone) async =>
      PatientProfile.fromJson(
        Map<String, dynamic>.from(
          await api.request(
                '/api/profile',
                method: 'PATCH',
                body: {'fullName': name, 'phone': phone},
              )
              as Map,
        ),
      );

  @override
  Future<AppointmentInvite> getInvite(String token) async =>
      AppointmentInvite.fromJson(
        Map<String, dynamic>.from(
          await api.request(
                '/api/auth/invite/${Uri.encodeComponent(token)}',
                authenticated: false,
              )
              as Map,
        ),
      );

  @override
  Future<void> acceptInvite(String token, String password) async {
    await api.request(
      '/api/auth/accept-invite',
      method: 'POST',
      authenticated: false,
      body: {'token': token, 'password': password},
    );
  }
}

String authErrorMessage(Object error) {
  if (error is AppException) return error.message;
  if (error is AuthException) {
    return switch (error.code) {
      'invalid_credentials' => 'The email or password is incorrect.',
      'email_not_confirmed' =>
        'Please verify your email before signing in. Check your inbox.',
      'over_request_rate_limit' || 'over_email_send_rate_limit' =>
        'Too many attempts. Please wait a moment and try again.',
      _ => 'We could not sign you in. Please try again.',
    };
  }
  return 'Could not connect to your care team. Please try again.';
}
