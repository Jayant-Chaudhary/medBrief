import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/features/home/appointment_repository.dart';
import 'package:health_on_patient/features/profile/profile_controller.dart';
import 'package:health_on_patient/features/profile/profile_page.dart';
import 'package:health_on_patient/features/profile/profile_repository.dart';

class FakeAppointmentRepo extends AppointmentRepository {
  double? lastLoggedWeight;
  double? lastLoggedSystolic;
  double? lastLoggedDiastolic;

  @override
  Future<LatestVitals> getLatestVitals() async => LatestVitals(
        weight: VitalReading(
          metricKey: 'weight',
          value: 70.0,
          unit: 'kg',
          recordedAt: DateTime(2026, 1, 1),
        ),
        bpSystolic: VitalReading(
          metricKey: 'blood_pressure_systolic',
          value: 120.0,
          unit: 'mmHg',
          recordedAt: DateTime(2026, 1, 1),
        ),
        bpDiastolic: VitalReading(
          metricKey: 'blood_pressure_diastolic',
          value: 80.0,
          unit: 'mmHg',
          recordedAt: DateTime(2026, 1, 1),
        ),
      );

  @override
  Future<void> logVital({
    required String metricKey,
    required double value,
    required String unit,
    String? appointmentId,
  }) async {
    if (metricKey == 'weight') lastLoggedWeight = value;
    if (metricKey == 'blood_pressure_systolic') lastLoggedSystolic = value;
    if (metricKey == 'blood_pressure_diastolic') lastLoggedDiastolic = value;
  }
}

class FakeProfileRepository extends ProfileRepository {
  FakeProfileRepository({this.profile});

  PatientProfileData? profile;
  Map<String, dynamic>? lastUpdated;

  @override
  Future<PatientProfileData?> getProfile() async {
    return profile ??
        const PatientProfileData(
          fullName: 'Jane Doe',
          phone: '+1 555-0199',
          dateOfBirth: '1992-04-12',
          bloodType: 'O+',
          address: '742 Evergreen Terrace',
          emergencyContactName: 'John Doe',
          emergencyContactPhone: '+1 555-0188',
        );
  }

  @override
  Future<void> updateProfile(Map<String, dynamic> changes) async {
    lastUpdated = changes;
  }
}

void main() {
  test('ProfileController handles load and save lifecycle', () async {
    final repo = FakeProfileRepository();
    final controller = ProfileController(repo: repo);

    await controller.load();
    expect(controller.profile, isNotNull);
    expect(controller.profile!.fullName, 'Jane Doe');
    expect(controller.profile!.bloodType, 'O+');

    final updated = const PatientProfileData(
      fullName: 'Jane Smith',
      phone: '+1 555-9999',
    );
    final saved = await controller.save(updated);
    expect(saved, isTrue);
    expect(controller.profile!.fullName, 'Jane Smith');
    expect(repo.lastUpdated?['fullName'], 'Jane Smith');
    expect(controller.successMessage, isNotNull);
  });

  testWidgets('ProfilePage displays form fields, validates input, and saves updates', (tester) async {
    tester.view.physicalSize = const Size(430, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = FakeProfileRepository();
    final controller = ProfileController(repo: repo);
    bool signedOut = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProfilePage(
            controller: controller,
            onSignOut: () => signedOut = true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify fields
    expect(find.text('Jane Doe'), findsWidgets);
    expect(find.text('+1 555-0199'), findsOneWidget);
    expect(find.text('O+'), findsOneWidget);
    expect(find.text('742 Evergreen Terrace'), findsOneWidget);
    expect(find.text('John Doe'), findsOneWidget);

    // Edit full name
    await tester.enterText(find.widgetWithText(TextFormField, 'Jane Doe'), 'Jane Roe');
    await tester.pumpAndSettle();

    // Tap Save Changes
    await tester.ensureVisible(find.text('Save Changes'));
    await tester.tap(find.text('Save Changes'));
    await tester.pumpAndSettle();

    expect(repo.lastUpdated?['fullName'], 'Jane Roe');

    // Tap Sign Out button
    await tester.ensureVisible(find.text('Sign Out'));
    await tester.tap(find.text('Sign Out'));
    await tester.pumpAndSettle();

    expect(find.text('Sign out?'), findsOneWidget);
    // Confirm in dialog
    await tester.tap(find.widgetWithText(FilledButton, 'Sign out'));
    await tester.pumpAndSettle();

    expect(signedOut, isTrue);
  });

  testWidgets(
      'ProfilePage supports 0.5 step adjustment, manual weight typing, and logging',
      (tester) async {
    tester.view.physicalSize = const Size(430, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final profileRepo = FakeProfileRepository();
    final profileCtrl = ProfileController(repo: profileRepo);
    final apptRepo = FakeAppointmentRepo();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProfilePage(
            controller: profileCtrl,
            appointmentRepository: apptRepo,
            onSignOut: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify initial weight loaded from appointment repo (70.0)
    expect(find.text('70.0'), findsOneWidget);

    // Tap + to increment by 0.5
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    expect(find.text('70.5'), findsOneWidget);

    // Tap - to decrement by 0.5
    await tester.tap(find.byIcon(Icons.remove));
    await tester.pumpAndSettle();
    expect(find.text('70.0'), findsOneWidget);

    // Manually enter weight
    await tester.enterText(find.widgetWithText(TextField, '70.0'), '68.5');
    await tester.pumpAndSettle();
    expect(find.text('68.5'), findsOneWidget);

    // Tap Log weight
    await tester.tap(find.text('Log weight'));
    await tester.pumpAndSettle();
    expect(apptRepo.lastLoggedWeight, 68.5);
  });

  testWidgets('ProfilePage supports blood pressure inputting and logging', (tester) async {
    tester.view.physicalSize = const Size(430, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final profileRepo = FakeProfileRepository();
    final profileCtrl = ProfileController(repo: profileRepo);
    final apptRepo = FakeAppointmentRepo();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProfilePage(
            controller: profileCtrl,
            appointmentRepository: apptRepo,
            onSignOut: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify BP tracker is displayed
    expect(find.text('Blood Pressure Tracker'), findsOneWidget);
    expect(find.text('Last: 120/80 mmHg'), findsOneWidget);

    // Enter new BP values
    await tester.enterText(find.widgetWithText(TextField, '120'), '130');
    await tester.enterText(find.widgetWithText(TextField, '80'), '85');
    await tester.pumpAndSettle();

    // Tap Log blood pressure
    await tester.ensureVisible(find.text('Log blood pressure'));
    await tester.tap(find.text('Log blood pressure'));
    await tester.pumpAndSettle();

    expect(apptRepo.lastLoggedSystolic, 130.0);
    expect(apptRepo.lastLoggedDiastolic, 85.0);
  });
}

