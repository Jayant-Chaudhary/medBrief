import 'package:flutter/material.dart';

import 'core/api_client.dart';
import 'core/app_theme.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/auth_widgets.dart';
import 'features/auth/login_page.dart';
import 'features/auth/onboarding_page.dart';
import 'features/checkin/checkin_repository.dart';
import 'features/community/community_push.dart';
import 'features/home/appointment_repository.dart';
import 'features/home/home_page.dart';
import 'features/profile/profile_repository.dart';
import 'features/reports/report_repository.dart';
import 'features/summary/summary_repository.dart';

class HealthOnApp extends StatelessWidget {
  const HealthOnApp({
    super.key,
    this.auth,
    this.api,
    this.push,
    this.appointmentRepository,
    this.checkinRepository,
    this.reportRepository,
    this.summaryRepository,
    this.profileRepository,
    this.setupError,
  });

  final AuthController? auth;
  final ApiClient? api;
  final CommunityPush? push;
  final AppointmentRepository? appointmentRepository;
  final CheckinRepository? checkinRepository;
  final ReportRepository? reportRepository;
  final SummaryRepository? summaryRepository;
  final ProfileRepository? profileRepository;
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
              AuthStage.signedIn => HomePage(
                auth: auth!,
                api: api,
                push: push,
                repository: appointmentRepository,
                checkinRepository: checkinRepository,
                reportRepository: reportRepository,
                summaryRepository: summaryRepository,
                profileRepository: profileRepository,
              ),
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

