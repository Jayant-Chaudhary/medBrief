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
import 'features/notifications/patient_notification_service.dart';
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
    this.notificationService,
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
  final PatientNotificationService? notificationService;
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
              AuthStage.restoring => Scaffold(
                backgroundColor: canvas,
                body: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: line),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x0D000000),
                              blurRadius: 16,
                              offset: Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Image.asset(
                          'assets/logo-mark.png',
                          excludeFromSemantics: true,
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'MedBrief',
                        style: TextStyle(
                          color: primary,
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 24),
                      const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: primary,
                        ),
                      ),
                    ],
                  ),
                ),
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
                notificationService: notificationService,
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

