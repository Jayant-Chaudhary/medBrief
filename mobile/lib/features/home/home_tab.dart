import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../checkin/checkin_models.dart';
import 'appointment_repository.dart';
import 'appointments_tab.dart';
import 'home_controller.dart';

/// Patient Home Dashboard tab.
///
/// Welcomes the patient, spotlights their next appointment with immediate
/// actions, provides quick vitals logging, dynamic check-in cadence, and shows a preview of upcoming visits.
class HomeTab extends StatelessWidget {
  const HomeTab({
    super.key,
    required this.controller,
    required this.onNavigate,
    this.onCheckin,
    this.onPeriodicCheckin,
    this.onQuickPulse,
    this.onLogConcern,
    this.onViewSummary,
    this.onSignOut,
  });

  final HomeController controller;
  final void Function(String route) onNavigate;
  final void Function(Appointment appointment)? onCheckin;
  final VoidCallback? onPeriodicCheckin;
  final VoidCallback? onQuickPulse;
  final VoidCallback? onLogConcern;
  final void Function(Appointment appointment)? onViewSummary;
  final VoidCallback? onSignOut;

  @override
  Widget build(BuildContext context) {
    if (controller.stage == HomeStage.loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (controller.stage == HomeStage.error) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined, size: 48, color: muted),
              const SizedBox(height: 16),
              Text(
                controller.error ?? 'Something went wrong.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: muted),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: controller.refresh,
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'),
              ),
            ],
          ),
        ),
      );
    }

    final firstName =
        controller.profile.fullName.trim().split(' ').first.isEmpty
            ? 'there'
            : controller.profile.fullName.trim().split(' ').first;

    final activeAppt = controller.activeAppointment;

    return RefreshIndicator(
      onRefresh: controller.refresh,
      color: primary,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 100),
        children: [
          // ── Greeting header ──────────────────────────────────────
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Welcome, $firstName',
                      style: const TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                        color: ink,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      greetingLabel(),
                      style: const TextStyle(
                        fontSize: 14,
                        color: primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                width: 52,
                height: 52,
                decoration: const BoxDecoration(
                  color: primary,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    firstName.isNotEmpty ? firstName[0].toUpperCase() : '?',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // ── Action Banner for active appointment ─────────────────
          if (activeAppt != null) ...[
            _HomeActionBanner(
              appointment: activeAppt,
              onNavigate: onNavigate,
              onCheckin: onCheckin != null ? () => onCheckin!(activeAppt) : null,
              onViewSummary: onViewSummary != null
                  ? () => onViewSummary!(activeAppt)
                  : null,
            ),
            const SizedBox(height: 24),
          ],

          // ── Dynamic Cadence Check-In Card ───────────────────────
          _DynamicCheckinCadenceCard(
            cadence: controller.cadenceStatus,
            onStartWeekly: onPeriodicCheckin,
            onStartPulse: onQuickPulse,
          ),
          const SizedBox(height: 12),

          // ── 24/7 Spontaneous Concern Card ────────────────────────
          _LogConcernCard(
            onLog: onLogConcern,
          ),
          const SizedBox(height: 24),

          // ── Upcoming visits preview ──────────────────────────────
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Text(
                  'Upcoming appointments',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
              ),
              if (controller.appointments.upcoming.isNotEmpty)
                TextButton(
                  onPressed: () => onNavigate('/appointments'),
                  child: const Text('See all'),
                ),
            ],
          ),
          const SizedBox(height: 8),
          if (controller.appointments.upcoming.isEmpty)
            const EmptyStateWidget(
              icon: Icons.calendar_today_outlined,
              title: 'No upcoming appointments',
              body: 'When your clinic schedules a visit, it will appear here.',
            )
          else
            ...controller.appointments.upcoming.take(2).map(
              (appt) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: AppointmentCard(
                  appointment: appt,
                  isSelected: appt.id == controller.activeAppointment?.id,
                  onTap: () => controller.selectAppointment(appt.id),
                  onCheckin: onCheckin,
                  onViewSummary: onViewSummary,
                  onShareReports: (a) {
                    controller.selectAppointment(a.id);
                    onNavigate('/reports');
                  },
                ),
              ),
            ),

          // ── Past visits section (if exists) ──────────────────────
          if (controller.appointments.past.isNotEmpty) ...[
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Expanded(
                  child: Text(
                    'Past visits',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                ),
                TextButton(
                  onPressed: () => onNavigate('/appointments'),
                  child: const Text('See all'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ...controller.appointments.past.take(1).map(
              (appt) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: AppointmentCard(
                  appointment: appt,
                  isSelected: appt.id == controller.activeAppointment?.id,
                  onTap: () => controller.selectAppointment(appt.id),
                  onCheckin: onCheckin,
                  onViewSummary: onViewSummary,
                  onShareReports: (a) {
                    controller.selectAppointment(a.id);
                    onNavigate('/reports');
                  },
                ),
              ),
            ),
          ],

          if (onSignOut != null) ...[
            const SizedBox(height: 28),
            Center(
              child: OutlinedButton.icon(
                onPressed: onSignOut,
                icon: const Icon(Icons.logout_rounded, size: 18),
                label: const Text('Sign out'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Action Banner
// ---------------------------------------------------------------------------

class _HomeActionBanner extends StatelessWidget {
  const _HomeActionBanner({
    required this.appointment,
    required this.onNavigate,
    this.onCheckin,
    this.onViewSummary,
  });

  final Appointment appointment;
  final void Function(String route) onNavigate;
  final VoidCallback? onCheckin;
  final VoidCallback? onViewSummary;

  @override
  Widget build(BuildContext context) {
    final status = appointment.status;

    Color bg;
    Color border;
    IconData icon;
    String title;
    String body;
    String primaryText;
    VoidCallback? primaryAction;
    String? secondaryText;
    VoidCallback? secondaryAction;

    if (status == 'completed') {
      bg = const Color(0xFFF1F8F5);
      border = const Color(0xFFD3EADB);
      icon = Icons.check_circle_outline_rounded;
      title = 'Visit completed';
      body = 'Your doctor has finalized this consultation note and recommendations.';
      primaryText = 'View visit summary';
      primaryAction = onViewSummary ?? () => onNavigate('/summary');
    } else if (status == 'checked_in') {
      bg = const Color(0xFFEEF5FD);
      border = const Color(0xFFD0E3FA);
      icon = Icons.hourglass_top_rounded;
      title = 'You are checked in';
      body = 'The clinic has been notified. Feel free to review or share your lab reports.';
      primaryText = 'Share lab reports';
      primaryAction = () => onNavigate('/reports');
      secondaryText = 'Check in details';
      secondaryAction = onCheckin;
    } else {
      bg = const Color(0xFFFBF4ED);
      border = const Color(0xFFF4DECD);
      icon = Icons.calendar_today_rounded;
      title = 'Next appointment';
      body = 'Complete pre-visit check-in so your care team is prepared.';
      primaryText = 'Pre-visit check-in';
      primaryAction = onCheckin ?? () => onNavigate('/checkin');
      secondaryText = 'Upload reports';
      secondaryAction = () => onNavigate('/reports');
    }

    return Container(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: line),
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: ink, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
              ),
              Text(
                formatAppointmentDate(appointment.scheduledAt),
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: muted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            body,
            style: const TextStyle(fontSize: 13, color: muted, height: 1.4),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 10,
            runSpacing: 8,
            children: [
              FilledButton(
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, 38),
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                onPressed: primaryAction,
                child: Text(primaryText, style: const TextStyle(fontSize: 13)),
              ),
              if (secondaryText != null && secondaryAction != null)
                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 38),
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  onPressed: secondaryAction,
                  child: Text(secondaryText),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Dynamic Checkin Cadence Card
// ---------------------------------------------------------------------------

class _DynamicCheckinCadenceCard extends StatelessWidget {
  const _DynamicCheckinCadenceCard({
    required this.cadence,
    this.onStartWeekly,
    this.onStartPulse,
  });

  final CheckinCadenceStatus cadence;
  final VoidCallback? onStartWeekly;
  final VoidCallback? onStartPulse;

  @override
  Widget build(BuildContext context) {
    final isWeeklyDue = cadence.isWeeklyDue;
    final isPulseDue = cadence.isQuickPulseDue;
    final isCaughtUp = !isWeeklyDue && !isPulseDue && cadence.totalCompleted > 0;

    String title;
    String subtitle;
    String buttonText;
    VoidCallback? onAction;
    IconData icon;
    Color iconBg;

    if (isWeeklyDue) {
      title = 'Weekly Check-In Due';
      subtitle = 'Comprehensive milestone review for doctor (2 mins)';
      buttonText = 'Start (2m)';
      onAction = onStartWeekly;
      icon = Icons.favorite_rounded;
      iconBg = primary;
    } else if (isPulseDue) {
      title = 'Quick Pulse Due';
      subtitle = 'How are you and baby feeling today? (30 secs)';
      buttonText = 'Quick Check';
      onAction = onStartPulse;
      icon = Icons.bolt_rounded;
      iconBg = const Color(0xFF007A65);
    } else if (isCaughtUp) {
      final days = cadence.daysSinceLastCheckin ?? 0;
      title = 'You\'re all caught up!';
      subtitle = days == 0
          ? 'Check-in recorded today • Next pulse in ${cadence.nextDueInDays} days'
          : 'Last check-in $days days ago • Next pulse in ${cadence.nextDueInDays} days';
      buttonText = '';
      onAction = null;
      icon = Icons.check_circle_rounded;
      iconBg = const Color(0xFF2E7D32);
    } else {
      title = 'Prenatal Check-In';
      subtitle = 'Record how you and baby feel (2 mins)';
      buttonText = 'Start';
      onAction = onStartWeekly;
      icon = Icons.favorite_rounded;
      iconBg = primary;
    }

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFE8F3F1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFD0E6E3)),
      ),
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color: Colors.white,
              size: 24,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontSize: 12,
                    color: muted,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          if (onAction != null)
            FilledButton(
              style: FilledButton.styleFrom(
                minimumSize: const Size(72, 38),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                backgroundColor: isCaughtUp ? Colors.white : primary,
                foregroundColor: isCaughtUp ? ink : Colors.white,
                side: isCaughtUp ? const BorderSide(color: Color(0xFFB9D8D3)) : null,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              onPressed: onAction,
              child: Text(buttonText, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// 24/7 Spontaneous Concern Card
// ---------------------------------------------------------------------------

class _LogConcernCard extends StatelessWidget {
  const _LogConcernCard({this.onLog});

  final VoidCallback? onLog;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: line),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.edit_note_rounded, color: primary, size: 20),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Have a concern right now?',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
                Text(
                  'Log a symptom or note for your doctor anytime',
                  style: TextStyle(fontSize: 11, color: muted),
                ),
              ],
            ),
          ),
          OutlinedButton(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(0, 32),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            onPressed: onLog,
            child: const Text('Log Concern', style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}
