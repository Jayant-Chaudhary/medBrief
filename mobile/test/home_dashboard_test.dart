import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/features/auth/auth_repository.dart';
import 'package:health_on_patient/features/home/appointment_repository.dart';
import 'package:health_on_patient/features/home/appointments_tab.dart';
import 'package:health_on_patient/features/home/home_controller.dart';
import 'package:health_on_patient/features/home/home_tab.dart';

class FakeAppointmentRepository extends AppointmentRepository {
  FakeAppointmentRepository({
    this.appointments,
    this.vitals,
  });

  AppointmentSet? appointments;
  LatestVitals? vitals;
  final loggedVitals = <Map<String, dynamic>>[];

  @override
  Future<AppointmentSet> getAppointments() async {
    return appointments ??
        AppointmentSet(
          all: [
            Appointment(
              id: 'appt-1',
              status: 'active',
              scheduledAt: DateTime.now().add(const Duration(days: 3)),
              clinicianName: 'Dr. Jane Smith',
            ),
            Appointment(
              id: 'appt-2',
              status: 'completed',
              scheduledAt: DateTime.now().subtract(const Duration(days: 10)),
              clinicianName: 'Dr. Jane Smith',
            ),
          ],
          upcoming: [
            Appointment(
              id: 'appt-1',
              status: 'active',
              scheduledAt: DateTime.now().add(const Duration(days: 3)),
              clinicianName: 'Dr. Jane Smith',
            ),
          ],
          past: [
            Appointment(
              id: 'appt-2',
              status: 'completed',
              scheduledAt: DateTime.now().subtract(const Duration(days: 10)),
              clinicianName: 'Dr. Jane Smith',
            ),
          ],
        );
  }

  @override
  Future<LatestVitals> getLatestVitals() async {
    return vitals ??
        LatestVitals(
          weight: VitalReading(
            metricKey: 'weight',
            value: 68.5,
            unit: 'kg',
            recordedAt: DateTime.now(),
          ),
          bpSystolic: VitalReading(
            metricKey: 'blood_pressure_systolic',
            value: 120,
            unit: 'mmHg',
            recordedAt: DateTime.now(),
          ),
          bpDiastolic: VitalReading(
            metricKey: 'blood_pressure_diastolic',
            value: 80,
            unit: 'mmHg',
            recordedAt: DateTime.now(),
          ),
        );
  }

  @override
  Future<void> logVital({
    required String metricKey,
    required double value,
    required String unit,
    String? appointmentId,
  }) async {
    loggedVitals.add({
      'metricKey': metricKey,
      'value': value,
      'unit': unit,
      'appointmentId': appointmentId,
    });
  }
}

void main() {
  const testProfile = PatientProfile(
    id: 'patient-1',
    role: 'patient',
    fullName: 'Asha Sharma',
    phone: '+91 9876543210',
  );

  test('HomeController loads appointments and auto-selects active appointment', () async {
    final repo = FakeAppointmentRepository();
    final controller = HomeController(repo: repo, profile: testProfile);

    expect(controller.stage, HomeStage.loading);
    await controller.load();
    expect(controller.stage, HomeStage.ready);
    expect(controller.appointments.all.length, 2);
    expect(controller.appointments.upcoming.length, 1);
    expect(controller.appointments.past.length, 1);
    expect(controller.activeAppointment?.id, 'appt-1');
    expect(controller.vitals.weight?.value, 68.5);
  });

  test('HomeController logs weight and blood pressure', () async {
    final repo = FakeAppointmentRepository();
    final controller = HomeController(repo: repo, profile: testProfile);
    await controller.load();

    await controller.logVitals(
      weight: 69.0,
      bpSystolic: 122,
      bpDiastolic: 82,
    );

    expect(repo.loggedVitals.length, 3);
    expect(repo.loggedVitals[0]['metricKey'], 'weight');
    expect(repo.loggedVitals[0]['value'], 69.0);
    expect(repo.loggedVitals[1]['metricKey'], 'blood_pressure_systolic');
    expect(repo.loggedVitals[2]['metricKey'], 'blood_pressure_diastolic');
  });

  testWidgets('HomeTab renders dashboard elements accurately', (tester) async {
    tester.view.physicalSize = const Size(430, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = FakeAppointmentRepository();
    final controller = HomeController(repo: repo, profile: testProfile);
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomeTab(
            controller: controller,
            onNavigate: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Greeting
    expect(find.text('Welcome, Asha'), findsOneWidget);
    // Action Banner
    expect(find.text('Start pre-visit check-in'), findsOneWidget);
    expect(find.text('Share lab reports'), findsOneWidget);
    // Vitals moved to profile section
    expect(find.text('Quick Vitals Update'), findsNothing);
    expect(find.text('Weight (kg)'), findsNothing);
    // Appointments list (shown once in banner, once in upcoming, once in past)
    expect(find.text('Upcoming appointments'), findsOneWidget);
    expect(find.text('Past visits'), findsOneWidget);
    expect(find.text('Dr. Jane Smith'), findsNWidgets(3));
    expect(find.text('Scheduled'), findsOneWidget);
    expect(find.text('Completed'), findsOneWidget);
  });

  testWidgets('AppointmentsTab displays visits with Check in and View summary actions', (tester) async {
    tester.view.physicalSize = const Size(430, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = FakeAppointmentRepository();
    final controller = HomeController(repo: repo, profile: testProfile);
    await controller.load();

    Appointment? checkedInAppt;
    Appointment? summarizedAppt;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppointmentsTab(
            controller: controller,
            onNavigate: (_) {},
            onCheckin: (a) => checkedInAppt = a,
            onViewSummary: (a) => summarizedAppt = a,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Appointments'), findsOneWidget);
    expect(find.text('All (2)'), findsOneWidget);
    expect(find.text('Upcoming (1)'), findsOneWidget);
    expect(find.text('Past visits (1)'), findsOneWidget);
    expect(find.text('Check in'), findsOneWidget);
    expect(find.text('View summary'), findsOneWidget);

    await tester.tap(find.text('Check in'));
    await tester.pumpAndSettle();
    expect(checkedInAppt?.id, 'appt-1');

    await tester.tap(find.text('View summary'));
    await tester.pumpAndSettle();
    expect(summarizedAppt?.id, 'appt-2');
  });
}
