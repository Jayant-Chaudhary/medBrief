import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/features/home/appointment_repository.dart';
import 'package:health_on_patient/features/reports/report_controller.dart';
import 'package:health_on_patient/features/reports/report_repository.dart';
import 'package:health_on_patient/features/reports/reports_page.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class FakeReportRepository extends ReportRepository {
  FakeReportRepository({
    this.reports,
    this.rejectNameMismatch = false,
    this.rejectUnreadableName = false,
  });

  List<LabReport>? reports;
  final bool rejectNameMismatch;
  final bool rejectUnreadableName;
  final confirmedUploads = <bool>[];
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
    bool confirmNameMismatch = false,
  }) async {
    uploadCalled = true;
    confirmedUploads.add(confirmNameMismatch);
    if (rejectNameMismatch && !confirmNameMismatch) {
      throw const AppException(
        'We could not complete that request. Please try again.',
        status: 409,
        code: 'REPORT_NAME_MISMATCH',
        details: {'nameOnReport': 'Someone Else', 'nameOnAccount': 'Test Patient'},
      );
    }
    if (rejectUnreadableName && !confirmNameMismatch) {
      throw const AppException(
        'We could not complete that request. Please try again.',
        status: 409,
        code: 'REPORT_NAME_UNREADABLE',
        details: {'nameOnReport': null, 'nameOnAccount': 'Test Patient'},
      );
    }
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

  test('A name mismatch waits for the user, and saves nothing until they proceed', () async {
    final repo = FakeReportRepository(rejectNameMismatch: true);
    final controller = ReportController(repo: repo);

    final saved = await controller.uploadReport(bytes: [1, 2, 3], filename: 'report.pdf');
    expect(saved, isFalse);
    expect(controller.errorMessage, isNull);
    expect(controller.isUploading, isFalse);
    expect(controller.nameMismatch?.nameOnReport, 'Someone Else');
    expect(controller.nameMismatch?.nameOnAccount, 'Test Patient');

    expect(await controller.proceedWithNameMismatch(), isTrue);
    expect(repo.confirmedUploads, [false, true]);
    expect(controller.nameMismatch, isNull);
  });

  test('A report with no readable name also waits for the user', () async {
    final repo = FakeReportRepository(rejectUnreadableName: true);
    final controller = ReportController(repo: repo);

    final saved = await controller.uploadReport(bytes: [1, 2, 3], filename: 'report.pdf');
    expect(saved, isFalse);
    expect(controller.errorMessage, isNull);
    expect(controller.nameMismatch?.nameOnReport, isEmpty);
    expect(controller.nameMismatch?.nameOnAccount, 'Test Patient');

    expect(await controller.proceedWithNameMismatch(), isTrue);
    expect(repo.confirmedUploads, [false, true]);
  });

  testWidgets('The dialog says when no name could be read', (tester) async {
    tester.view.physicalSize = const Size(430, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = FakeReportRepository(rejectUnreadableName: true);
    final controller = ReportController(repo: repo);
    await controller.uploadReport(bytes: const [1, 2, 3], filename: 'report.pdf');

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReportsPage(controller: controller, appointments: const []),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('We could not read a patient name on this report, so we cannot check that it is yours.'),
      findsOneWidget,
    );
    expect(find.textContaining('Name on the report'), findsNothing);
    expect(find.text('Name on your account: Test Patient'), findsOneWidget);
  });

  test('Cancelling a name mismatch does not send the report again', () async {
    final repo = FakeReportRepository(rejectNameMismatch: true);
    final controller = ReportController(repo: repo);

    await controller.uploadReport(bytes: [1, 2, 3], filename: 'report.pdf');
    controller.cancelNameMismatch();

    expect(repo.confirmedUploads, [false]);
    expect(controller.nameMismatch, isNull);
    expect(controller.message, contains('not saved'));
  });

  test('LabReportMetric reads confidence from the database column', () {
    final metric = LabReportMetric.fromJson(const {
      'id': 'm-1',
      'raw_key': 'Hb',
      'confidence_score': 0.92,
    });
    expect(metric.confidence, 0.92);
  });

  group('reportContentType', () {
    test('recognizes the file types the server accepts', () {
      expect(reportContentType(const [0xFF, 0xD8, 0xFF, 0xE0, 0x00]), 'image/jpeg');
      expect(reportContentType(const [0x89, 0x50, 0x4E, 0x47, 0x0D]), 'image/png');
      expect(reportContentType(utf8.encode('%PDF-1.7')), 'application/pdf');
    });

    test('has no answer for anything else', () {
      expect(reportContentType(utf8.encode('plain text')), isNull);
      expect(reportContentType(const [0xFF]), isNull);
      expect(reportContentType(const []), isNull);
    });
  });

  test('ReportRepository sends a photo as an image, with the confirmation when given', () async {
    late String body;
    final api = ApiClient(
      baseUrl: 'https://api.example',
      accessToken: () => 'token',
      client: MockClient((request) async {
        body = utf8.decode(request.bodyBytes, allowMalformed: true);
        return http.Response('{"metrics":[]}', 201);
      }),
    );
    addTearDown(api.close);
    final repo = ReportRepository(api: api);

    await repo.uploadReport(bytes: const [0xFF, 0xD8, 0xFF, 0xE0], filename: 'photo.jpg');
    expect(body, contains('content-type: image/jpeg'));
    expect(body, isNot(contains('confirmNameMismatch')));

    await repo.uploadReport(
      bytes: const [0xFF, 0xD8, 0xFF, 0xE0],
      filename: 'photo.jpg',
      confirmNameMismatch: true,
    );
    expect(body, contains('name="confirmNameMismatch"'));
  });

  group('ReportsPage name mismatch dialog', () {
    Future<FakeReportRepository> reachDialog(WidgetTester tester) async {
      tester.view.physicalSize = const Size(430, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final repo = FakeReportRepository(rejectNameMismatch: true);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReportsPage(
              controller: ReportController(repo: repo),
              appointments: const [],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Upload Report'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sample CBC Blood Panel'));
      await tester.pumpAndSettle();
      return repo;
    }

    testWidgets('shows both names and sends the report again on Upload anyway', (tester) async {
      final repo = await reachDialog(tester);

      expect(find.text('Is this report yours?'), findsOneWidget);
      expect(find.text('Name on the report: Someone Else'), findsOneWidget);
      expect(find.text('Name on your account: Test Patient'), findsOneWidget);
      expect(repo.confirmedUploads, [false]);

      await tester.tap(find.text('Upload anyway'));
      await tester.pumpAndSettle();

      expect(find.text('Is this report yours?'), findsNothing);
      expect(repo.confirmedUploads, [false, true]);
    });

    testWidgets('asks when the page opens if the upload finished while another tab was open', (tester) async {
      tester.view.physicalSize = const Size(430, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final repo = FakeReportRepository(rejectNameMismatch: true);
      final controller = ReportController(repo: repo);
      await controller.uploadReport(bytes: const [1, 2, 3], filename: 'report.pdf');

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReportsPage(controller: controller, appointments: const []),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Is this report yours?'), findsOneWidget);
    });

    testWidgets('does not ask again once answered, even after another upload', (tester) async {
      final repo = await reachDialog(tester);

      await tester.tap(find.text('Upload anyway'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Upload Report'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sample Lipid Profile'));
      await tester.pumpAndSettle();

      // The new file gets its own warning; the answered one is not reused.
      expect(find.text('Is this report yours?'), findsOneWidget);
      expect(repo.confirmedUploads, [false, true, false]);
    });

    testWidgets('does not send anything more on Cancel upload', (tester) async {
      final repo = await reachDialog(tester);

      await tester.tap(find.text('Cancel upload'));
      await tester.pumpAndSettle();

      expect(find.text('Is this report yours?'), findsNothing);
      expect(find.text('Upload cancelled. The report was not saved.'), findsOneWidget);
      expect(repo.confirmedUploads, [false]);
    });
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

