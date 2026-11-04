import 'package:health_on_patient/features/auth/auth_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/features/checkin/ad_hoc_concern_sheet.dart';
import 'package:health_on_patient/features/checkin/checkin_repository.dart';
import 'package:health_on_patient/features/checkin/guided_checkin_page.dart';
import 'package:health_on_patient/features/checkin/prenatal_questions.dart';
import 'package:health_on_patient/features/checkin/quick_pulse_sheet.dart';
import 'package:health_on_patient/features/home/appointment_repository.dart';
import 'package:health_on_patient/features/home/home_controller.dart';
import 'package:health_on_patient/features/home/home_tab.dart';

class FakeCheckinRepo extends CheckinRepository {
  List<CheckinAnswerPayload>? lastSubmittedAnswers;
  String? lastSessionType;
  int? lastGestationalWeek;
  String? lastAppointmentId;
  String? lastAdHocDescription;
  int? lastComfortRating;

  @override
  Future<CheckinSessionResult> submitPeriodicCheckin({
    String? appointmentId,
    required String sessionType,
    int? gestationalWeek,
    required List<CheckinAnswerPayload> answers,
  }) async {
    lastAppointmentId = appointmentId;
    lastSessionType = sessionType;
    lastGestationalWeek = gestationalWeek;
    lastSubmittedAnswers = answers;
    return CheckinSessionResult(
      id: 'session-fake-123',
      status: answers.any((a) => a.isRedFlag) ? 'flagged_urgent' : 'completed',
      hasRedFlag: answers.any((a) => a.isRedFlag),
      appointmentId: appointmentId,
      sessionType: sessionType,
      gestationalWeek: gestationalWeek,
    );
  }

  @override
  Future<CheckinSessionResult> submitAdHocConcern({
    required String description,
    String category = 'concern',
    String severity = 'mild',
    int? gestationalWeek,
  }) async {
    lastAdHocDescription = description;
    return CheckinSessionResult(
      id: 'session-fake-adhoc',
      status: severity == 'severe' ? 'flagged_urgent' : 'completed',
      hasRedFlag: severity == 'severe',
      sessionType: 'ad_hoc_concern',
    );
  }

  @override
  Future<CheckinSessionResult> submitQuickPulse({
    required int comfortRating,
    List<String> discomforts = const [],
    String? notes,
    int? gestationalWeek,
  }) async {
    lastComfortRating = comfortRating;
    return const CheckinSessionResult(
      id: 'session-fake-pulse',
      status: 'completed',
      hasRedFlag: false,
      sessionType: 'quick_pulse',
    );
  }

  @override
  Future<CheckinCadenceStatus> getCheckinStatus() async {
    return const CheckinCadenceStatus(
      nextDueType: 'routine_weekly',
      isWeeklyDue: true,
      isQuickPulseDue: true,
      totalCompleted: 2,
    );
  }
}

class FakeAppointmentRepo extends AppointmentRepository {
  @override
  Future<AppointmentSet> getAppointments() async => AppointmentSet.empty();

  @override
  Future<LatestVitals> getLatestVitals() async => LatestVitals();
}

void main() {
  group('Prenatal Questions Bank', () {
    test('filters questions based on gestational age', () {
      final t1Questions = PrenatalQuestionsBank.forGestationalWeek(10);
      expect(t1Questions.any((q) => q.key == 'fetal_movement'), isFalse);

      final t3Questions = PrenatalQuestionsBank.forGestationalWeek(28);
      expect(t3Questions.any((q) => q.key == 'fetal_movement'), isTrue);
      expect(t3Questions.any((q) => q.key == 'sudden_swelling'), isTrue);
    });
  });

  group('GuidedCheckinPage Widget', () {
    late FakeCheckinRepo fakeRepo;

    setUp(() {
      fakeRepo = FakeCheckinRepo();
    });

    testWidgets('renders check-in title and progress', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: GuidedCheckinPage(
            gestationalWeek: 28,
            repository: fakeRepo,
            onCompleted: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Week 28 Check-In'), findsOneWidget);
      expect(find.textContaining('Question 1 of'), findsOneWidget);
    });

    testWidgets('triggers emergency intercept alert on red-flag answer',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: GuidedCheckinPage(
            gestationalWeek: 28,
            emergencyContactPhone: '+1 555-0199',
            repository: fakeRepo,
            onCompleted: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      final noButton = find.widgetWithText(InkWell, 'No');
      expect(noButton, findsOneWidget);
      await tester.tap(noButton);
      await tester.pumpAndSettle();

      expect(find.text('Important Clinical Alert'), findsOneWidget);
      expect(find.textContaining('+1 555-0199'), findsOneWidget);

      await tester.tap(find.text('Continue Check-in'));
      await tester.pumpAndSettle();

      expect(find.text('Important Clinical Alert'), findsNothing);
    });

    testWidgets('allows progressing and completing check-in', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: GuidedCheckinPage(
            gestationalWeek: 12,
            repository: fakeRepo,
            onCompleted: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(InkWell, 'No'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Next Question'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Question 2 of'), findsOneWidget);
    });
  });

  group('Ad-Hoc Concern Sheet', () {
    testWidgets('submits spontaneous patient concern', (tester) async {
      final fakeRepo = FakeCheckinRepo();
      bool submitted = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AdHocConcernSheet(
              repository: fakeRepo,
              gestationalWeek: 24,
              onSubmitted: () => submitted = true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Log a Concern Anytime'), findsOneWidget);

      await tester.enterText(
        find.byType(TextField),
        'Felt stomach aches regularly after lunch',
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save for Doctor'));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastAdHocDescription, contains('Felt stomach aches'));
      expect(submitted, isTrue);
    });
  });

  group('Quick Pulse Sheet', () {
    testWidgets('logs 30-second comfort pulse', (tester) async {
      final fakeRepo = FakeCheckinRepo();
      bool submitted = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: QuickPulseSheet(
              repository: fakeRepo,
              gestationalWeek: 24,
              onSubmitted: () => submitted = true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Quick 30s Pulse Check'), findsOneWidget);

      await tester.tap(find.text("Save Today's Pulse (Done)"));
      await tester.pumpAndSettle();

      expect(fakeRepo.lastComfortRating, 4);
      expect(submitted, isTrue);
    });
  });

  group('HomeTab Periodic Check-In Card', () {
    testWidgets('renders Dynamic Cadence Card on dashboard', (tester) async {
      final apptRepo = FakeAppointmentRepo();
      final checkinRepo = FakeCheckinRepo();
      final controller = HomeController(
        repo: apptRepo,
        checkinRepo: checkinRepo,
        profile: const PatientProfile(id: 'p-1', role: 'patient', fullName: 'Maya Sharma'),
      );
      await controller.load();
      bool startedWeekly = false;
      bool startedConcern = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: HomeTab(
              controller: controller,
              onNavigate: (_) {},
              onPeriodicCheckin: () {
                startedWeekly = true;
              },
              onLogConcern: () {
                startedConcern = true;
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Weekly Check-In Due'), findsOneWidget);
      expect(
        find.text('Comprehensive milestone review for doctor (2 mins)'),
        findsOneWidget,
      );

      await tester.tap(find.text('Start (2m)'));
      expect(startedWeekly, isTrue);

      expect(find.text('Have a concern right now?'), findsOneWidget);
      await tester.tap(find.text('Log Concern'));
      expect(startedConcern, isTrue);
    });
  });
}
