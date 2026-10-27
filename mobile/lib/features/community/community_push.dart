import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../auth/auth_controller.dart';
import 'community_repository.dart';

/// Push contains generic notifications only. Message bodies are fetched after login.
class CommunityPush {
  CommunityPush(this.repository, this.auth) {
    auth.addListener(_sessionChanged);
    auth.beforeSignOut = disable;
  }
  final CommunityRepository repository;
  final AuthController auth;
  final inboxRequests = ValueNotifier<int>(0);
  final enabled = ValueNotifier<bool>(false);
  final _storage = const FlutterSecureStorage();
  StreamSubscription<String>? _registration;
  StreamSubscription<RemoteMessage>? _opened;
  String? _fid;
  bool _restoring = false;
  bool _active = false;
  int _generation = 0;

  void _sessionChanged() {
    if (auth.stage == AuthStage.signedIn && !_restoring && !_active) {
      _restoring = true;
      unawaited(() async {
        try {
          if (await _storage.read(key: 'community_push_enabled') == 'true') {
            await enable(requestPermission: false);
          }
        } catch (_) {
          /* Inbox remains available; no sensitive error logging. */
        } finally {
          _restoring = false;
        }
      }());
    } else if (auth.stage == AuthStage.signedOut && _active) {
      unawaited(disable());
    }
  }

  Future<bool> enable({bool requestPermission = true}) async {
    if (auth.stage != AuthStage.signedIn) return false;
    // Confirm current community consent before registering a device externally.
    await repository.get('/me');
    try {
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
      final messaging = FirebaseMessaging.instance;
      final permission = requestPermission
          ? await messaging.requestPermission(
              alert: true,
              badge: true,
              sound: true,
            )
          : await messaging.getNotificationSettings();
      if (permission.authorizationStatus != AuthorizationStatus.authorized &&
          permission.authorizationStatus != AuthorizationStatus.provisional) {
        return false;
      }
      final generation = ++_generation;
      _active = true;
      await _registration?.cancel();
      final registered = Completer<bool>();
      _registration = messaging.onRegistered.listen(
        (fid) async {
          if (!_active ||
              generation != _generation ||
              auth.stage != AuthStage.signedIn) {
            return;
          }
          try {
            await repository.send('/devices', {'token': fid});
            if (!_active || generation != _generation) return;
            _fid = fid;
            enabled.value = true;
            await _storage.write(key: 'community_push_enabled', value: 'true');
            if (!registered.isCompleted) registered.complete(true);
          } catch (_) {
            enabled.value = false;
            if (!registered.isCompleted) registered.complete(false);
          }
        },
        onError: (Object _) {
          if (!registered.isCompleted) registered.complete(false);
        },
      );
      await _opened?.cancel();
      _opened = FirebaseMessaging.onMessageOpenedApp.listen((_) {
        if (auth.stage == AuthStage.signedIn) inboxRequests.value++;
      });
      // Set auto-init only after the mother enables notifications.
      await messaging.setAutoInitEnabled(true);
      await messaging.register();
      if (!await registered.future.timeout(const Duration(seconds: 20))) {
        throw StateError('Registration unavailable');
      }
      if (await messaging.getInitialMessage() != null &&
          auth.stage == AuthStage.signedIn) {
        inboxRequests.value++;
      }
      return true;
    } catch (_) {
      await disable();
      return false;
    }
  }

  Future<void> disable() async {
    _active = false;
    _generation++;
    enabled.value = false;
    await _registration?.cancel();
    _registration = null;
    await _opened?.cancel();
    _opened = null;
    final oldFid = _fid;
    _fid = null;
    try {
      await _storage.delete(key: 'community_push_enabled');
    } catch (_) {}
    if (oldFid != null) {
      try {
        await repository.send('/devices/remove', {'token': oldFid});
      } catch (_) {}
    }
    if (Firebase.apps.isNotEmpty) {
      try {
        await FirebaseMessaging.instance.setAutoInitEnabled(false);
        await FirebaseMessaging.instance.unregister();
      } catch (_) {}
    }
  }
}
