import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/features/profile/profile_controller.dart';
import 'package:health_on_patient/features/profile/profile_page.dart';
import 'package:health_on_patient/features/profile/profile_repository.dart';

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
    tester.view.physicalSize = const Size(430, 1400);
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
    await tester.tap(find.text('Save Changes'));
    await tester.pumpAndSettle();

    expect(repo.lastUpdated?['fullName'], 'Jane Roe');

    // Tap Sign Out button
    await tester.tap(find.text('Sign Out'));
    await tester.pumpAndSettle();

    expect(find.text('Sign out?'), findsOneWidget);
    // Confirm in dialog
    await tester.tap(find.widgetWithText(FilledButton, 'Sign out'));
    await tester.pumpAndSettle();

    expect(signedOut, isTrue);
  });
}

