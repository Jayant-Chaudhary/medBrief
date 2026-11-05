import 'dart:async';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import '../checkin/checkin_models.dart';
import '../home/appointment_repository.dart';
import 'notification_config.dart';

/// Decision outcome for whether and when to schedule a reminder slot.
class ScheduledReminderDecision {
  const ScheduledReminderDecision({
    required this.shouldSchedule,
    this.scheduledDate,
    this.title,
    this.body,
    this.payload,
    this.isImmediate = false,
  });

  final bool shouldSchedule;
  final DateTime? scheduledDate;
  final String? title;
  final String? body;
  final String? payload;
  final bool isImmediate;
}

/// Abstract platform client to allow clean testability without requiring
/// native Android binary bridges during unit testing.
abstract class NotificationPlatformClient {
  Future<bool?> initialize({
    void Function(String payload)? onNotificationTapped,
  });

  Future<bool> requestPermission();

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
  });

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
  });

  Future<void> cancel(int id);

  Future<void> cancelAll();
}

/// Production implementation of [NotificationPlatformClient] using
/// flutter_local_notifications and timezone.
class DefaultNotificationPlatformClient implements NotificationPlatformClient {
  DefaultNotificationPlatformClient({FlutterLocalNotificationsPlugin? plugin})
      : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  bool _timeZonesInitialized = false;

  void _ensureTimeZones() {
    if (!_timeZonesInitialized) {
      try {
        tz_data.initializeTimeZones();
        _timeZonesInitialized = true;
      } catch (_) {
        // Safe fallback if already initialized or running in synthetic harness
      }
    }
  }

  @override
  Future<bool?> initialize({
    void Function(String payload)? onNotificationTapped,
  }) async {
    _ensureTimeZones();
    const androidSettings =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);

    final result = await _plugin.initialize(
      settings: initSettings,
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload != null && payload.isNotEmpty) {
          onNotificationTapped?.call(payload);
        }
      },
    );

    final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();

    await androidPlugin?.createNotificationChannel(
      const AndroidNotificationChannel(
        NotificationConfig.appointmentsChannelId,
        NotificationConfig.appointmentsChannelName,
        description: NotificationConfig.appointmentsChannelDesc,
        importance: Importance.high,
      ),
    );

    await androidPlugin?.createNotificationChannel(
      const AndroidNotificationChannel(
        NotificationConfig.checkinsChannelId,
        NotificationConfig.checkinsChannelName,
        description: NotificationConfig.checkinsChannelDesc,
        importance: Importance.defaultImportance,
      ),
    );

    return result;
  }

  @override
  Future<bool> requestPermission() async {
    final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    final granted = await androidPlugin?.requestNotificationsPermission();
    return granted ?? false;
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
    _ensureTimeZones();
    final androidDetails = AndroidNotificationDetails(
      channelId,
      channelName,
      channelDescription: channelDescription,
      importance: highPriority ? Importance.high : Importance.defaultImportance,
      priority: highPriority ? Priority.high : Priority.defaultPriority,
      groupKey: groupKey,
      onlyAlertOnce: true,
      autoCancel: true,
    );

    final tzDateTime = tz.TZDateTime.from(scheduledDate, tz.local);

    await _plugin.zonedSchedule(
      id: id,
      title: title,
      body: body,
      scheduledDate: tzDateTime,
      notificationDetails: NotificationDetails(android: androidDetails),
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      payload: payload,
    );
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
    final androidDetails = AndroidNotificationDetails(
      channelId,
      channelName,
      channelDescription: channelDescription,
      importance: highPriority ? Importance.high : Importance.defaultImportance,
      priority: highPriority ? Priority.high : Priority.defaultPriority,
      groupKey: groupKey,
      onlyAlertOnce: true,
      autoCancel: true,
    );

    await _plugin.show(
      id: id,
      title: title,
      body: body,
      notificationDetails: NotificationDetails(android: androidDetails),
      payload: payload,
    );
  }

  @override
  Future<void> cancel(int id) async {
    await _plugin.cancel(id: id);
  }

  @override
  Future<void> cancelAll() async {
    await _plugin.cancelAll();
  }
}

/// Central service managing patient reminders.
///
/// Features strict deterministic slotting to prevent drawer flooding:
/// - Slot 1001: Appointment reminder (24h or 1h)
/// - Slot 1002: Check-in / Quick pulse prompt
class PatientNotificationService {
  PatientNotificationService({NotificationPlatformClient? client})
      : _client = client ?? DefaultNotificationPlatformClient();

  final NotificationPlatformClient _client;
  void Function(String payload)? onNotificationTapped;

  Future<void> init({void Function(String payload)? onTapped}) async {
    onNotificationTapped = onTapped;
    await _client.initialize(
      onNotificationTapped: (payload) {
        onNotificationTapped?.call(payload);
      },
    );
  }

  Future<bool> requestPermission() => _client.requestPermission();

  /// Computes the exact reminder decision for upcoming appointments.
  ///
  /// Guarantees that at most one reminder is active, targeting the closest upcoming visit.
  ScheduledReminderDecision calculateAppointmentReminder(
    List<Appointment> upcoming, {
    DateTime? now,
  }) {
    final current = now ?? DateTime.now();
    final validUpcoming = upcoming
        .where((a) => a.isUpcoming && a.scheduledAt.isAfter(current))
        .toList()
      ..sort((a, b) => a.scheduledAt.compareTo(b.scheduledAt));

    if (validUpcoming.isEmpty) {
      return const ScheduledReminderDecision(shouldSchedule: false);
    }

    final closest = validUpcoming.first;
    final scheduledAt = closest.scheduledAt;
    final tMinus24h =
        scheduledAt.subtract(NotificationConfig.appointmentAdvanceFirst);
    final tMinus1h =
        scheduledAt.subtract(NotificationConfig.appointmentAdvanceSecond);

    if (tMinus24h.isAfter(current)) {
      return ScheduledReminderDecision(
        shouldSchedule: true,
        scheduledDate: tMinus24h,
        title: NotificationConfig.appointment24hTitle,
        body: NotificationConfig.appointment24hBody,
        payload: NotificationConfig.payloadAppointments,
      );
    } else if (tMinus1h.isAfter(current)) {
      return ScheduledReminderDecision(
        shouldSchedule: true,
        scheduledDate: tMinus1h,
        title: NotificationConfig.appointment1hTitle,
        body: NotificationConfig.appointment1hBody,
        payload: NotificationConfig.payloadAppointments,
      );
    }

    // Appointment is within 1 hour or starting; no advance reminder needed.
    return const ScheduledReminderDecision(shouldSchedule: false);
  }

  /// Computes the exact reminder decision for prenatal check-in and quick pulse.
  ScheduledReminderDecision calculateCheckinReminder(
    CheckinCadenceStatus cadence, {
    DateTime? now,
  }) {
    final current = now ?? DateTime.now();

    if (cadence.isDue) {
      final isWeekly = cadence.isWeeklyDue;
      final title = isWeekly
          ? NotificationConfig.checkinWeeklyTitle
          : NotificationConfig.checkinPulseTitle;
      final body = isWeekly
          ? NotificationConfig.checkinWeeklyBody
          : NotificationConfig.checkinPulseBody;
      final payload = isWeekly
          ? NotificationConfig.payloadCheckin
          : NotificationConfig.payloadQuickPulse;

      // Target preferred notification hour today
      final todayPrompt = DateTime(
        current.year,
        current.month,
        current.day,
        NotificationConfig.checkinPromptHour,
        NotificationConfig.checkinPromptMinute,
      );

      if (todayPrompt.isAfter(current)) {
        return ScheduledReminderDecision(
          shouldSchedule: true,
          scheduledDate: todayPrompt,
          title: title,
          body: body,
          payload: payload,
        );
      } else {
        // If preferred hour has already passed today, prompt immediately
        return ScheduledReminderDecision(
          shouldSchedule: true,
          isImmediate: true,
          title: title,
          body: body,
          payload: payload,
        );
      }
    }

    if (cadence.nextDueInDays > 0) {
      final isWeekly = cadence.nextDueType == 'routine_weekly';
      final title = isWeekly
          ? NotificationConfig.checkinWeeklyTitle
          : NotificationConfig.checkinPulseTitle;
      final body = isWeekly
          ? NotificationConfig.checkinWeeklyBody
          : NotificationConfig.checkinPulseBody;
      final payload = isWeekly
          ? NotificationConfig.payloadCheckin
          : NotificationConfig.payloadQuickPulse;

      final targetDate = DateTime(
        current.year,
        current.month,
        current.day + cadence.nextDueInDays,
        NotificationConfig.checkinPromptHour,
        NotificationConfig.checkinPromptMinute,
      );

      return ScheduledReminderDecision(
        shouldSchedule: true,
        scheduledDate: targetDate,
        title: title,
        body: body,
        payload: payload,
      );
    }

    return const ScheduledReminderDecision(shouldSchedule: false);
  }

  /// Synchronizes appointment reminders using the deterministic appointment slot (1001).
  Future<void> syncAppointmentReminders(
    List<Appointment> upcoming, {
    DateTime? now,
  }) async {
    final decision = calculateAppointmentReminder(upcoming, now: now);

    if (decision.shouldSchedule && decision.scheduledDate != null) {
      await _client.schedule(
        id: NotificationConfig.appointmentSlotId,
        title: decision.title!,
        body: decision.body!,
        scheduledDate: decision.scheduledDate!,
        channelId: NotificationConfig.appointmentsChannelId,
        channelName: NotificationConfig.appointmentsChannelName,
        channelDescription: NotificationConfig.appointmentsChannelDesc,
        groupKey: NotificationConfig.groupKey,
        payload: decision.payload,
        highPriority: true,
      );
    } else {
      await cancelAppointmentReminder();
    }
  }

  /// Synchronizes check-in reminders using the deterministic check-in slot (1002).
  Future<void> syncCheckinReminders(
    CheckinCadenceStatus cadence, {
    DateTime? now,
  }) async {
    final decision = calculateCheckinReminder(cadence, now: now);

    if (!decision.shouldSchedule) {
      await cancelCheckinReminder();
      return;
    }

    if (decision.isImmediate) {
      await _client.show(
        id: NotificationConfig.checkinSlotId,
        title: decision.title!,
        body: decision.body!,
        channelId: NotificationConfig.checkinsChannelId,
        channelName: NotificationConfig.checkinsChannelName,
        channelDescription: NotificationConfig.checkinsChannelDesc,
        groupKey: NotificationConfig.groupKey,
        payload: decision.payload,
        highPriority: false,
      );
    } else if (decision.scheduledDate != null) {
      await _client.schedule(
        id: NotificationConfig.checkinSlotId,
        title: decision.title!,
        body: decision.body!,
        scheduledDate: decision.scheduledDate!,
        channelId: NotificationConfig.checkinsChannelId,
        channelName: NotificationConfig.checkinsChannelName,
        channelDescription: NotificationConfig.checkinsChannelDesc,
        groupKey: NotificationConfig.groupKey,
        payload: decision.payload,
        highPriority: false,
      );
    }
  }

  /// Synchronizes both appointment and check-in reminders.
  Future<void> syncReminders({
    required List<Appointment> upcoming,
    required CheckinCadenceStatus cadence,
    DateTime? now,
  }) async {
    await syncAppointmentReminders(upcoming, now: now);
    await syncCheckinReminders(cadence, now: now);
  }

  /// Clears the appointment reminder from the notification shade and alarm queue.
  Future<void> cancelAppointmentReminder() =>
      _client.cancel(NotificationConfig.appointmentSlotId);

  /// Clears the check-in prompt from the notification shade and alarm queue.
  Future<void> cancelCheckinReminder() =>
      _client.cancel(NotificationConfig.checkinSlotId);

  /// Clears all MedBrief scheduled alarms and drawer notifications.
  Future<void> cancelAll() => _client.cancelAll();

  /// For developer testing: schedules a test reminder firing in [delaySeconds].
  Future<void> sendTestReminder({int delaySeconds = 5}) async {
    final fireTime = DateTime.now().add(Duration(seconds: delaySeconds));
    await _client.schedule(
      id: NotificationConfig.appointmentSlotId,
      title: NotificationConfig.appointment1hTitle,
      body: NotificationConfig.appointment1hBody,
      scheduledDate: fireTime,
      channelId: NotificationConfig.appointmentsChannelId,
      channelName: NotificationConfig.appointmentsChannelName,
      channelDescription: NotificationConfig.appointmentsChannelDesc,
      groupKey: NotificationConfig.groupKey,
      payload: NotificationConfig.payloadAppointments,
      highPriority: true,
    );
  }

  /// For immediate testing: directly displays an active notification in the shade.
  Future<void> triggerImmediateNotification() async {
    await _client.show(
      id: NotificationConfig.checkinSlotId,
      title: NotificationConfig.checkinWeeklyTitle,
      body: NotificationConfig.checkinWeeklyBody,
      channelId: NotificationConfig.checkinsChannelId,
      channelName: NotificationConfig.checkinsChannelName,
      channelDescription: NotificationConfig.checkinsChannelDesc,
      groupKey: NotificationConfig.groupKey,
      payload: NotificationConfig.payloadCheckin,
      highPriority: true,
    );
  }
}
