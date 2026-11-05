import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Persist the SDK's session (including refresh token) in Android secure storage.
/// Passwords and patient profiles are never persisted here.
class SecureSessionStorage extends LocalStorage {
  const SecureSessionStorage({required this.storageKey});
  final String storageKey;
  static const _storage = FlutterSecureStorage();

  @override
  Future<void> initialize() async {}

  @override
  Future<bool> hasAccessToken() async =>
      await _storage.containsKey(key: storageKey);

  @override
  Future<String?> accessToken() => _storage.read(key: storageKey);

  @override
  Future<void> persistSession(String persistSessionString) =>
      _storage.write(key: storageKey, value: persistSessionString);

  @override
  Future<void> removePersistedSession() => _storage.delete(key: storageKey);
}
