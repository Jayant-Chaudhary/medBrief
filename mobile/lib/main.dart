import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'core/api_client.dart';
import 'core/app_config.dart';
import 'core/secure_session_storage.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/auth_repository.dart';
import 'features/community/community_push.dart';
import 'features/community/community_repository.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const config = AppConfig.fromEnvironment();
  if (!config.isConfigured) {
    runApp(
      const HealthOnApp(
        setupError:
            'Sign-in is not configured for this build. Please contact your clinic.',
      ),
    );
    return;
  }

  try {
    await Supabase.initialize(
      url: config.supabaseUrl,
      publishableKey: config.supabaseKey,
      authOptions: FlutterAuthClientOptions(
        detectSessionInUri: false,
        localStorage: SecureSessionStorage(
          storageKey: 'medbrief-${Uri.parse(config.supabaseUrl).host}-session',
        ),
      ),
    );
  } catch (_) {
    runApp(
      const HealthOnApp(
        setupError: 'We could not open secure sign-in. Please restart the app.',
      ),
    );
    return;
  }

  final supabase = Supabase.instance.client;
  final api = ApiClient(
    baseUrl: config.apiBaseUrl,
    accessToken: () => supabase.auth.currentSession?.accessToken,
  );
  final auth = AuthController(
    SupabaseAuthRepository(supabase: supabase, api: api),
  );
  final push = CommunityPush(CommunityRepository(api), auth);
  runApp(HealthOnApp(auth: auth, api: api, push: push));
  unawaited(auth.start());
}
