import 'package:flutter_test/flutter_test.dart';
import 'package:health_on_patient/features/checkin/checkin_models.dart';
import 'package:health_on_patient/features/home/appointment_repository.dart';
import 'package:health_on_patient/features/notifications/notification_config.dart';
import 'package:health_on_patient/features/notifications/patient_notification_service.dart';

class FakeNotificationPlatformClient implements NotificationPlatformClient {
  final Map<int, Map<String, dynamic>> scheduled = {};
  final Map<int, Map<String, dynamic>> displayed = {};
  final List<int> cancelled = [];
  bool permissionRequested = false;
  bool allCancelled = false;

  @override
  Future<bool?> initialize({
    void Function(String payload)? onNotificationTapped,
  }) async =>
      true;

  @override
  Future<bool> requestPermission() async {
    permissionRequested = true;
    return true;
  }

  @override
  Future<void> schedule({
    required int id,
    required String title,
    required String body,
    required DateTime scheduledDate,
    required String channelId,
    required String channelName,
    required String channelDescription,
    required String groupKey,
    String? payload,
    bool highPriority = false,
  }) async {
    scheduled[id] = {
      'id': id,
      'title': title,
      'body': body,
      'scheduledDate': scheduledDate,
      'channelId': channelId,
      'channelName': channelName,
      'groupKey': groupKey,
      'payload': payload,
      'highPriority': highPriority,
    };
  }

  @override
  Future<void> show({
    required int id,
    required String title,
    required String body,
    required String channelId,
    required String channelName,
    required String channelDescription,
    required String groupKey,
    String? payload,
    bool highPriority = false,
  }) async {
    displayed[id] = {
      'id': id,
      'title': title,
      'body': body,
      'channelId': channelId,
      'channelName': channelName,
      'groupKey': groupKey,
      'payload': payload,
      'highPriority': highPriority,
    };
  }

  @override
  Future<void> cancel(int id) async {
    cancelled.add(id);
    scheduled.remove(id);
    displayed.remove(id);
  }

  @override
  Future<void> cancelAll() async {
    allCancelled = true;
    scheduled.clear();
    displayed.clear();
  }
}

void main() {
  group('PatientNotificationService - Anti-Clutter & Scheduling', () {
    late FakeNotificationPlatformClient client;
    late PatientNotificationService service;

    setUp(() {
      client = FakeNotificationPlatformClient();
      service = PatientNotificationService(client: client);
    });

    test('replaces appointment slot 1001 with 24h reminder if visit is >24h away', () async {
      final now = DateTime(2026, 11, 4, 10, 0);
      final visitTime = now.add(const Duration(hours: 30)); // 30 hours away
      final appt = Appointment(
        id: 'appt-1',
        status: 'active',
        scheduledAt: visitTime,
        clinicianName: 'Dr. Synthetic Provider',
      );

      await service.syncAppointmentReminders([appt], now: now);

      expect(client.scheduled.containsKey(NotificationConfig.appointmentSlotId), isTrue);
      final item = client.scheduled[NotificationConfig.appointmentSlotId]!;
      expect(item['title'], equals(NotificationConfig.appointment24hTitle));
      expect(item['scheduledDate'], equals(visitTime.subtract(const Duration(hours: 24))));
      expect(item['groupKey'], equals(NotificationConfig.groupKey));
      expect(item['channelId'], equals(NotificationConfig.appointmentsChannelId));
    });

    test('replaces appointment slot 1001 with 1h reminder if visit is between 1h and 24h away', () async {
      final now = DateTime(2026, 11, 4, 10, 0);
      final visitTime = now.add(const Duration(hours: 8)); // 8 hours away
      final appt = Appointment(
        id: 'appt-2',
        status: 'active',
        scheduledAt: visitTime,
      );

      await service.syncAppointmentReminders([appt], now: now);

      expect(client.scheduled.containsKey(NotificationConfig.appointmentSlotId), isTrue);
      final item = client.scheduled[NotificationConfig.appointmentSlotId]!;
      expect(item['title'], equals(NotificationConfig.appointment1hTitle));
      expect(item['scheduledDate'], equals(visitTime.subtract(const Duration(hours: 1))));
    });

    test('cancels appointment slot 1001 if visit is in less than 1 hour or no upcoming visits', () async {
      final now = DateTime(2026, 11, 4, 10, 0);
      final visitTime = now.add(const Duration(minutes: 30));
      final appt = Appointment(
        id: 'appt-imminent',
        status: 'active',
        scheduledAt: visitTime,
      );

      await service.syncAppointmentReminders([appt], now: now);

      expect(client.cancelled.contains(NotificationConfig.appointmentSlotId), isTrue);
      expect(client.scheduled.containsKey(NotificationConfig.appointmentSlotId), isFalse);
    });

    test('targets closest upcoming visit when multiple are present without creating duplicate slots', () async {
      final now = DateTime(2026, 11, 4, 10, 0);
      final visit1 = Appointment(
        id: 'appt-sooner',
        status: 'active',
        scheduledAt: now.add(const Duration(days: 2)),
      );
      final visit2 = Appointment(
        id: 'appt-later',
        status: 'active',
        scheduledAt: now.add(const Duration(days: 10)),
      );

      await service.syncAppointmentReminders([visit2, visit1], now: now);

      // Must have exactly 1 scheduled appointment reminder, for visit1
      expect(client.scheduled.length, equals(1));
      expect(client.scheduled.keys.single, equals(NotificationConfig.appointmentSlotId));
      expect(
        client.scheduled[NotificationConfig.appointmentSlotId]!['scheduledDate'],
        equals(visit1.scheduledAt.subtract(const Duration(hours: 24))),
      );
    });

    test('schedules check-in prompt on deterministic slot 1002 when due in future days', () async {
      final now = DateTime(2026, 11, 4, 9, 0);
      const cadence = CheckinCadenceStatus(
        isWeeklyDue: false,
        isQuickPulseDue: false,
        nextDueInDays: 3,
        nextDueType: 'quick_pulse',
      );

      await service.syncCheckinReminders(cadence, now: now);

      expect(client.scheduled.containsKey(NotificationConfig.checkinSlotId), isTrue);
      final item = client.scheduled[NotificationConfig.checkinSlotId]!;
      expect(item['title'], equals(NotificationConfig.checkinPulseTitle));
      final expectedDate = DateTime(2026, 11, 7, 10, 0);
      expect(item['scheduledDate'], equals(expectedDate));
      expect(item['channelId'], equals(NotificationConfig.checkinsChannelId));
    });

    test('triggers immediate prompt on slot 1002 if check-in is due today and prompt hour passed', () async {
      final now = DateTime(2026, 11, 4, 14, 0); // 2:00 PM (after 10:00 AM)
      const cadence = CheckinCadenceStatus(
        isWeeklyDue: true,
        isQuickPulseDue: true,
      );

      await service.syncCheckinReminders(cadence, now: now);

      expect(client.displayed.containsKey(NotificationConfig.checkinSlotId), isTrue);
      final item = client.displayed[NotificationConfig.checkinSlotId]!;
      expect(item['title'], equals(NotificationConfig.checkinWeeklyTitle));
      expect(item['payload'], equals(NotificationConfig.payloadCheckin));
    });

    test('cancels check-in slot 1002 when check-in is complete and not due', () async {
      final now = DateTime(2026, 11, 4, 10, 0);
      const cadence = CheckinCadenceStatus(
        isWeeklyDue: false,
        isQuickPulseDue: false,
        nextDueInDays: 0,
      );

      await service.syncCheckinReminders(cadence, now: now);

      expect(client.cancelled.contains(NotificationConfig.checkinSlotId), isTrue);
    });
  });

  group('PatientNotificationService - Privacy & Safety Audits', () {
    test('all appointment and check-in copy is strictly generic with no health terms', () {
      final allCopy = [
        NotificationConfig.appointment24hTitle,
        NotificationConfig.appointment24hBody,
        NotificationConfig.appointment1hTitle,
        NotificationConfig.appointment1hBody,
        NotificationConfig.checkinWeeklyTitle,
        NotificationConfig.checkinWeeklyBody,
        NotificationConfig.checkinPulseTitle,
        NotificationConfig.checkinPulseBody,
      ];

      // Sensitive terms forbidden on lock screen per AGENTS.md
      final forbiddenTerms = [
        'diagnosis',
        'disease',
        'preeclampsia',
        'hypertension',
        'bleeding',
        'dr.',
        'doctor',
        'blood pressure',
        'heart rate',
        'glucose',
        'hemoglobin',
      ];

      for (final text in allCopy) {
        final lower = text.toLowerCase();
        for (final term in forbiddenTerms) {
          expect(
            lower.contains(term),
            isFalse,
            reason: 'Notification text "$text" must not contain sensitive term "$term"',
          );
        }
      }
    });
  });
}

