import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api_client.dart';
import 'auth_repository.dart';

enum AuthStage { restoring, signedOut, onboarding, signedIn, unavailable }

class AuthController extends ChangeNotifier {
  AuthController(this.repository);
  final AuthRepository repository;
  Future<void> Function()? beforeSignOut;
  AuthStage stage = AuthStage.restoring;
  PatientProfile? profile;
  String? error;
  bool busy = false;
  StreamSubscription<bool>? _subscription;
  bool _disposed = false;
  int _generation = 0;

  Future<void> start() async {
    _subscription = repository.sessionChanges.listen(
      (signedIn) {
        if (!signedIn) {
          _generation++;
          profile = null;
          stage = AuthStage.signedOut;
          _notify();
        } else if (!busy && stage == AuthStage.signedOut) {
          unawaited(restore());
        }
      },
      onError: (Object _) {
        error = 'Your session could not be refreshed. Please try again.';
        _notify();
      },
    );
    await restore();
  }

  Future<void> restore() async {
    await _run(() async {
      await repository.restoreSession();
      if (!repository.hasSession) {
        stage = AuthStage.signedOut;
        return;
      }
      await _loadProfile();
    }, restoring: true);
  }

  Future<void> signIn(String email, String password) => _run(() async {
    await repository.signIn(email.trim(), password);
    await _loadProfile();
  });

  Future<void> _loadProfile() async {
    final generation = _generation;
    final loaded = await repository.getProfile();
    if (_disposed || generation != _generation) return;
    // Trust the API's stored role, never editable user_metadata.
    if (loaded.role != 'patient') {
      await repository.signOut();
      throw const AppException(
        'This app is for patients. Please use the clinician website for this account.',
      );
    }
    profile = loaded;
    stage = loaded.needsOnboarding ? AuthStage.onboarding : AuthStage.signedIn;
  }

  Future<void> completeProfile(String name, String phone) => _run(() async {
    profile = await repository.completeProfile(name.trim(), phone.trim());
    stage = AuthStage.signedIn;
  });

  Future<void> signOut() => _run(() async {
    await beforeSignOut?.call();
    await repository.signOut();
    _generation++;
    profile = null;
    stage = AuthStage.signedOut;
  });

  Future<void> _run(
    Future<void> Function() action, {
    bool restoring = false,
  }) async {
    if (busy) return;
    busy = true;
    error = null;
    if (restoring) stage = AuthStage.restoring;
    _notify();
    try {
      await action();
    } catch (failure) {
      error = authErrorMessage(failure);
      // A network failure must not destroy a recoverable session or admit
      // someone before their server-side role has been checked.
      if (profile == null) {
        stage = repository.hasSession
            ? AuthStage.unavailable
            : AuthStage.signedOut;
      }
    } finally {
      busy = false;
      _notify();
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _subscription?.cancel();
    super.dispose();
  }
}
