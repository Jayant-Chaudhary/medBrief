import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/features/checkin/checkin_controller.dart';
import 'package:health_on_patient/features/checkin/checkin_page.dart';
import 'package:health_on_patient/features/checkin/checkin_repository.dart';
import 'package:health_on_patient/features/home/appointment_repository.dart';

class FakeCheckinRepository extends CheckinRepository {
  FakeCheckinRepository({
    this.questions,
    this.checklist,
    this.previousResponses,
  });

  List<QuestionTemplate>? questions;
  List<ChecklistItem>? checklist;
  List<Map<String, dynamic>>? previousResponses;

  final submittedResponses = <Map<String, dynamic>>[];
  final toggledItems = <Map<String, dynamic>>[];
  bool checkinCompleted = false;
  bool sharedReports = false;

  @override
  Future<List<QuestionTemplate>> getQuestions(String appointmentId) async {
    return questions ??
        [
          const QuestionTemplate(
            id: 'q-1',
            questionText: 'Have you experienced any severe headaches?',
            responseType: 'yes_no',
            isRedFlagTrigger: true,
            sortOrder: 1,
          ),
          const QuestionTemplate(
            id: 'q-2',
            questionText: 'Any other symptoms you would like the doctor to know about?',
            responseType: 'text',
            isRedFlagTrigger: false,
            sortOrder: 2,
          ),
        ];
  }

  @override
  Future<List<Map<String, dynamic>>> getPreviousResponses(String appointmentId) async {
    return previousResponses ?? [];
  }

  @override
  Future<void> saveResponses(
    String appointmentId,
    List<QuestionResponseAnswer> responses,
  ) async {
    submittedResponses.addAll(responses.map((r) => r.toJson()));
  }

  @override
  Future<List<ChecklistItem>> getChecklist(String appointmentId) async {
    return checklist ??
        [
          const ChecklistItem(
            id: 'item-1',
            label: 'Bring your physical ID',
            source: 'static',
            isCompleted: false,
          ),
          const ChecklistItem(
            id: 'item-2',
            label: 'Bring previous ultrasound scan',
            source: 'ai_generated',
            isCompleted: true,
          ),
        ];
  }

  @override
  Future<void> toggleChecklistItem(String itemId, bool isCompleted) async {
    toggledItems.add({'id': itemId, 'isCompleted': isCompleted});
  }

  @override
  Future<void> completeCheckin(String appointmentId) async {
    checkinCompleted = true;
  }

  @override
  Future<void> shareAllReports(String appointmentId) async {
    sharedReports = true;
  }
}

void main() {
  final testAppointment = Appointment(
    id: 'appt-1',
    status: 'active',
    scheduledAt: DateTime.now().add(const Duration(days: 2)),
    clinicianName: 'Dr. Jane Smith',
  );

  test('CheckinController manages symptoms validation and submission lifecycle', () async {
    final repo = FakeCheckinRepository();
    final controller = CheckinController(repo: repo, appointmentId: 'appt-1');

    await controller.load();
    expect(controller.stage, CheckinStage.ready);
    expect(controller.step, CheckinStep.symptoms);
    expect(controller.questions.length, 2);
    expect(controller.checklist.length, 2);
    expect(controller.allSymptomsAnswered, isFalse);

    // Answer Q1 with 'yes' and notes
    controller.setYesNo('q-1', 'yes');
    controller.setNotes('q-1', 'Started this morning');
    expect(controller.allSymptomsAnswered, isFalse); // Q2 still empty

    // Answer Q2 with text
    controller.setText('q-2', 'Mild nausea after meals');
    expect(controller.allSymptomsAnswered, isTrue);

    // Save and advance to checklist
    await controller.saveSymptomsAndContinue();
    expect(controller.step, CheckinStep.checklist);
    expect(repo.submittedResponses.length, 2);
    expect(repo.submittedResponses[0]['answer'], isTrue);
    expect(repo.submittedResponses[0]['detail'], 'Started this morning');
    expect(repo.submittedResponses[1]['text'], 'Mild nausea after meals');

    // Toggle checklist item
    final item = controller.checklist[0];
    await controller.toggleChecklistItem(item);
    expect(controller.checklist[0].isCompleted, isTrue);
    expect(repo.toggledItems.first['isCompleted'], isTrue);

    // Complete check-in
    await controller.completeCheckin();
    expect(controller.step, CheckinStep.done);
    expect(repo.checkinCompleted, isTrue);
  });

  testWidgets('CheckinPage renders steps and handles complete flow', (tester) async {
    tester.view.physicalSize = const Size(430, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = FakeCheckinRepository();
    bool finished = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CheckinPage(
            appointment: testAppointment,
            repository: repo,
            onFinished: () => finished = true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Step 1: Symptoms view
    expect(find.text('How are you feeling today?'), findsOneWidget);
    expect(find.text('Have you experienced any severe headaches?'), findsOneWidget);
    expect(find.text('Any other symptoms you would like the doctor to know about?'), findsOneWidget);

    // Initially continue button is disabled
    final continueButton = find.widgetWithText(FilledButton, 'Please answer all questions');
    expect(continueButton, findsOneWidget);

    // Tap "Yes" on Q1 -> reveals detail input
    await tester.tap(find.text('Yes'));
    await tester.pumpAndSettle();
    expect(find.text('Please provide a few details:'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).first, 'Pain behind eyes');

    // Enter text in Q2
    await tester.enterText(find.byType(TextFormField).last, 'Mild fatigue');
    await tester.pumpAndSettle();

    // Now button should be enabled with "Continue to Checklist"
    expect(find.text('Continue to Checklist'), findsOneWidget);
    await tester.tap(find.text('Continue to Checklist'));
    await tester.pumpAndSettle();

    // Step 2: Checklist view
    expect(find.text('Pre-Visit Checklist'), findsOneWidget);
    expect(find.text('Bring your physical ID'), findsOneWidget);
    expect(find.text('Bring previous ultrasound scan'), findsOneWidget);
    expect(find.text('Report follow-up'), findsOneWidget);

    // Toggle checklist item
    await tester.tap(find.text('Bring your physical ID'));
    await tester.pumpAndSettle();
    expect(repo.toggledItems.isNotEmpty, isTrue);

    // Tap Complete check-in
    await tester.tap(find.text('Complete check-in'));
    await tester.pumpAndSettle();

    // Step 3: Done view
    expect(find.text('You’re all set!'), findsOneWidget);
    expect(find.text('What happens next?'), findsOneWidget);
    expect(find.text('Back to Dashboard'), findsOneWidget);

    // Tap Back to Dashboard
    await tester.tap(find.text('Back to Dashboard'));
    await tester.pumpAndSettle();
    expect(finished, isTrue);
  });
}

