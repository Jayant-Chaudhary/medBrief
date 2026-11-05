import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'app.dart';
import 'core/api_client.dart';
import 'core/app_config.dart';
import 'core/secure_session_storage.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/auth_repository.dart';
import 'features/community/community_push.dart';
import 'features/community/community_repository.dart';
import 'features/consult_audio/consult_foreground_task.dart';
import 'features/consult_audio/pending_audio_store.dart';
import 'features/notifications/patient_notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final recordingService = FlutterForegroundServiceManager();
  if (Platform.isAndroid) {
    await recordingService.init();
    try {
      String? activeId;
      if (await recordingService.isRunning()) {
        final value = await const FlutterSecureStorage().read(
          key: 'consult_task_active',
        );
        if (value != null) {
          activeId = (jsonDecode(value) as Map)['sessionId'] as String?;
        }
      }
      await PendingAudioStore.pruneAll(skipSessionId: activeId);
    } catch (_) {
      /* Pending recovery reports inaccessible storage in the visit flow. */
    }
  }
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
  final notificationService = PatientNotificationService();
  if (Platform.isAndroid) {
    try {
      await notificationService.init();
    } catch (_) {
      // Best-effort notification service initialization
    }
  }
  final existingSignOut = auth.beforeSignOut;
  auth.beforeSignOut = () async {
    await recordingService.shutdown();
    await notificationService.cancelAll();
    await existingSignOut?.call();
  };
  auth.addListener(() {
    if (auth.stage == AuthStage.signedOut) {
      unawaited(recordingService.shutdown().catchError((Object _) {}));
    }
  });
  runApp(
    HealthOnApp(
      auth: auth,
      api: api,
      push: push,
      notificationService: notificationService,
    ),
  );
  unawaited(auth.start());
}
