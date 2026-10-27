import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/features/home/appointment_repository.dart';
import 'package:health_on_patient/features/summary/summary_controller.dart';
import 'package:health_on_patient/features/summary/summary_page.dart';

class FakeSummaryRepository extends SummaryRepository {
  FakeSummaryRepository({this.summary});

  PostVisitSummary? summary;
  final toggledItems = <Map<String, dynamic>>[];

  @override
  Future<PostVisitSummary?> getVisitSummary(String appointmentId) async {
    return summary ??
        const PostVisitSummary(
          appointmentId: 'appt-past-1',
          notes: ConsultationNotes(
            notesText: 'Patient vitals stable. Recommended drinking 2L water daily and light cardio.',
          ),
          consultationChecklist: [
            ConsultationChecklistItem(
              id: 'c-1',
              label: 'Reviewed blood pressure trend',
              isCompleted: true,
            ),
          ],
          prescriptions: [
            Prescription(
              id: 'rx-1',
              typedInstructions: 'Take 1 tablet daily in the morning with food.',
              signedUrl: 'https://example.com/rx.jpg',
            ),
          ],
          actionItems: [
            ActionItem(
              id: 'act-1',
              label: 'Schedule follow-up lipid panel in 3 months',
              isCompleted: false,
            ),
          ],
        );
  }

  @override
  Future<void> toggleNextStep(String itemId, bool isCompleted) async {
    toggledItems.add({'id': itemId, 'isCompleted': isCompleted});
  }
}

void main() {
  final pastAppointment = Appointment(
    id: 'appt-past-1',
    status: 'completed',
    scheduledAt: DateTime(2026, 9, 15),
    clinicianName: 'Dr. Jane Smith',
  );

  test('SummaryController loads summary and handles action item toggles', () async {
    final repo = FakeSummaryRepository();
    final controller = SummaryController(repo: repo);

    await controller.selectAppointment('appt-past-1');
    expect(controller.summary, isNotNull);
    expect(controller.summary!.notes?.notesText, contains('Patient vitals stable'));
    expect(controller.summary!.actionItems.length, 1);
    expect(controller.summary!.actionItems.first.isCompleted, isFalse);

    // Toggle next step
    final item = controller.summary!.actionItems.first;
    await controller.toggleActionItem(item);
    expect(controller.summary!.actionItems.first.isCompleted, isTrue);
    expect(repo.toggledItems.first['isCompleted'], isTrue);
  });

  testWidgets('SummaryPage renders visit summary cards and toggles next steps', (tester) async {
    tester.view.physicalSize = const Size(430, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = FakeSummaryRepository();
    final controller = SummaryController(repo: repo);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SummaryPage(
            controller: controller,
            completedAppointments: [pastAppointment],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify header & sections
    expect(find.text('Visit History'), findsOneWidget);
    expect(find.text('Doctor\'s Notes'), findsOneWidget);
    expect(find.textContaining('Patient vitals stable'), findsOneWidget);
    expect(find.text('Covered in your visit'), findsOneWidget);
    expect(find.text('Reviewed blood pressure trend'), findsOneWidget);
    expect(find.text('Prescription'), findsOneWidget);
    expect(find.textContaining('Take 1 tablet daily'), findsOneWidget);
    expect(find.text('Your Next Steps'), findsOneWidget);
    expect(find.text('Schedule follow-up lipid panel in 3 months'), findsOneWidget);

    // Toggle next step checkbox
    await tester.tap(find.text('Schedule follow-up lipid panel in 3 months'));
    await tester.pumpAndSettle();

    expect(repo.toggledItems.isNotEmpty, isTrue);
    expect(repo.toggledItems.last['isCompleted'], isTrue);
  });

  testWidgets('SummaryPage shows empty state when no completed appointments exist', (tester) async {
    final repo = FakeSummaryRepository();
    final controller = SummaryController(repo: repo);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SummaryPage(
            controller: controller,
            completedAppointments: const [],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No visit summaries yet'), findsOneWidget);
  });
}

