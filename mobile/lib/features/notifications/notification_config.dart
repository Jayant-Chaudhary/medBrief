/// Configuration for patient notifications and local scheduled reminders.
///
/// Tunable parameters (channels, deterministic slot IDs, reminder offsets,
/// and privacy-compliant generic copy) are centralized here per AGENTS.md rules.
class NotificationConfig {
  const NotificationConfig._();

  // Deterministic notification slot IDs (prevents notification drawer flooding)
  static const int appointmentSlotId = 1001;
  static const int checkinSlotId = 1002;

  // Shared Android notification group key (collapses all MedBrief reminders)
  static const String groupKey = 'com.healthon.medbrief.PATIENT_REMINDERS';

  // Android Notification Channels
  static const String appointmentsChannelId = 'medbrief_appointments';
  static const String appointmentsChannelName = 'Visit Reminders';
  static const String appointmentsChannelDesc =
      'Reminders for your scheduled clinical consultations';

  static const String checkinsChannelId = 'medbrief_checkins';
  static const String checkinsChannelName = 'Check-in Prompts';
  static const String checkinsChannelDesc =
      'Cadence prompts for prenatal check-ins and quick pulse updates';

  // Tunable lead times for upcoming appointments
  static const Duration appointmentAdvanceFirst = Duration(hours: 24);
  static const Duration appointmentAdvanceSecond = Duration(hours: 1);

  // Preferred time of day for scheduled routine check-in prompts (10:00 AM local)
  static const int checkinPromptHour = 10;
  static const int checkinPromptMinute = 0;

  // Generic, privacy-compliant notification copy (no patient names, no clinical values)
  static const String appointment24hTitle = 'Upcoming Consultation';
  static const String appointment24hBody =
      'You have a consultation scheduled for tomorrow. Tap to review your visit checklist.';

  static const String appointment1hTitle = 'Consultation in 1 Hour';
  static const String appointment1hBody =
      'Your consultation is in 1 hour. Tap to view your pre-visit preparation.';

  static const String checkinWeeklyTitle = 'Prenatal Health Check-in';
  static const String checkinWeeklyBody =
      'Your scheduled health check-in is ready. Tap to share how you are feeling.';

  static const String checkinPulseTitle = 'Quick Health Pulse';
  static const String checkinPulseBody =
      'Take 30 seconds to log your wellness update today.';

  // Deep link payload identifiers
  static const String payloadAppointments = 'navigate:appointments';
  static const String payloadCheckin = 'navigate:checkin';
  static const String payloadQuickPulse = 'navigate:quick_pulse';
}

