import 'package:flutter/material.dart';

import 'core/app_theme.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/auth_widgets.dart';
import 'features/auth/login_page.dart';
import 'features/auth/onboarding_page.dart';
import 'features/home/signed_in_page.dart';

class HealthOnApp extends StatelessWidget {
  const HealthOnApp({super.key, this.auth, this.setupError});
  final AuthController? auth;
  final String? setupError;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'MedBrief',
    debugShowCheckedModeBanner: false,
    theme: buildTheme(),
    home: auth == null
        ? LoginPage(auth: null, setupError: setupError)
        : ListenableBuilder(
            listenable: auth!,
            builder: (context, _) => switch (auth!.stage) {
              AuthStage.restoring => const Scaffold(
                body: Center(child: CircularProgressIndicator()),
              ),
              AuthStage.signedOut => LoginPage(auth: auth),
              AuthStage.onboarding => OnboardingPage(auth: auth!),
              AuthStage.signedIn => SignedInPage(auth: auth!),
              AuthStage.unavailable => AuthFrame(
                children: [
                  const BrandHeader(),
                  const SizedBox(height: 40),
                  const Text(
                    'Let’s reconnect',
                    style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 20),
                  ErrorNotice(auth!.error),
                  FilledButton(
                    onPressed: auth!.busy ? null : auth!.restore,
                    child: const Text('Try again'),
                  ),
                  TextButton(
                    onPressed: auth!.busy ? null : auth!.signOut,
                    child: const Text('Use another account'),
                  ),
                ],
              ),
            },
          ),
  );
}
