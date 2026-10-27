import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/features/home/appointment_repository.dart';
import 'package:health_on_patient/features/reports/report_controller.dart';
import 'package:health_on_patient/features/reports/report_repository.dart';
import 'package:health_on_patient/features/reports/reports_page.dart';

class FakeReportRepository extends ReportRepository {
  FakeReportRepository({this.reports});

  List<LabReport>? reports;
  final sharedCalls = <Map<String, dynamic>>[];
  final unsharedCalls = <Map<String, dynamic>>[];
  final removedCalls = <String>[];
  bool uploadCalled = false;

  @override
  Future<List<LabReport>> getReports() async {
    return reports ??
        [
          LabReport(
            id: 'rep-1',
            ocrStatus: 'success',
            reportDate: DateTime(2026, 10, 20),
            sharedAppointmentIds: const ['appt-1'],
            rawOcrPayload: const {
              'engine': 'ocr',
              'confidence': 0.95,
              'warnings': ['Slight glare on bottom edge'],
            },
            metrics: const [
              LabReportMetric(
                id: 'm-1',
                rawKey: 'WBC',
                displayName: 'White Blood Cell Count',
                reviewedValue: 6.8,
                unitStandard: '10^3/uL',
                confidence: 0.98,
              ),
              LabReportMetric(
                id: 'm-2',
                rawKey: 'Hb',
                displayName: 'Hemoglobin',
                parsedValue: 14.2,
                unitStandard: 'g/dL',
                confidence: 0.92,
                needsReview: true,
              ),
            ],
          ),
        ];
  }

  @override
  Future<Map<String, dynamic>> uploadReport({
    required List<int> bytes,
    required String filename,
    String? appointmentId,
  }) async {
    uploadCalled = true;
    return {
      'metrics': [{'id': 'm-new'}],
    };
  }

  @override
  Future<void> shareWithAppointment(String reportId, String appointmentId) async {
    sharedCalls.add({'reportId': reportId, 'appointmentId': appointmentId});
  }

  @override
  Future<void> unshareFromAppointment(String reportId, String appointmentId) async {
    unsharedCalls.add({'reportId': reportId, 'appointmentId': appointmentId});
  }

  @override
  Future<void> removeReport(String reportId) async {
    removedCalls.add(reportId);
  }
}

void main() {
  final testAppointment = Appointment(
    id: 'appt-1',
    status: 'active',
    scheduledAt: DateTime.now().add(const Duration(days: 3)),
    clinicianName: 'Dr. Jane Smith',
  );

  test('ReportController manages reports loading, uploading, sharing, and removal', () async {
    final repo = FakeReportRepository();
    final controller = ReportController(repo: repo);

    await controller.load();
    expect(controller.stage, ReportStage.ready);
    expect(controller.reports.length, 1);
    expect(controller.reports.first.metrics.length, 2);

    // Toggle share off
    await controller.toggleShare(controller.reports.first, 'appt-1', false);
    expect(controller.reports.first.sharedAppointmentIds.contains('appt-1'), isFalse);
    expect(repo.unsharedCalls.length, 1);

    // Toggle share on
    await controller.toggleShare(controller.reports.first, 'appt-2', true);
    expect(controller.reports.first.sharedAppointmentIds.contains('appt-2'), isTrue);
    expect(repo.sharedCalls.length, 1);

    // Upload
    final success = await controller.uploadReport(
      bytes: [1, 2, 3],
      filename: 'sample.txt',
    );
    expect(success, isTrue);
    expect(repo.uploadCalled, isTrue);
    expect(controller.message, contains('1 value read'));

    // Remove
    final removed = await controller.removeReport('rep-1');
    expect(removed, isTrue);
    expect(repo.removedCalls.contains('rep-1'), isTrue);
  });

  testWidgets('ReportsPage displays reports, opens OCR preview and share dialog', (tester) async {
    tester.view.physicalSize = const Size(430, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = FakeReportRepository();
    final controller = ReportController(repo: repo);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReportsPage(
            controller: controller,
            appointments: [testAppointment],
            activeAppointment: testAppointment,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify reports list & cards
    expect(find.text('Lab Reports'), findsOneWidget);
    expect(find.text('Upload a Lab Report'), findsOneWidget);
    expect(find.text('2 values read'), findsOneWidget);
    expect(find.text('White Blood Cell Count: 6.8'), findsOneWidget);

    // Tap Preview to open OCR Preview modal
    await tester.tap(find.text('Preview'));
    await tester.pumpAndSettle();

    expect(find.text('What we read from your report'), findsOneWidget);
    expect(find.text('Overall confidence 95%'), findsOneWidget);
    expect(find.text('1 value for doctor to review'), findsOneWidget);
    expect(find.text('Values found (2)'), findsOneWidget);
    expect(find.text('White Blood Cell Count'), findsOneWidget);

    // Close preview
    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pumpAndSettle();

    // Tap Share icon
    await tester.tap(find.byIcon(Icons.share_outlined).first);
    await tester.pumpAndSettle();

    expect(find.text('Share with Appointments'), findsOneWidget);
    expect(find.text('Visit with Dr. Jane Smith'), findsOneWidget);

    // Dismiss share sheet
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
  });
}

