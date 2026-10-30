import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../auth/auth_widgets.dart';
import 'appointment_repository.dart';
import 'appointments_tab.dart';
import 'home_controller.dart';

/// Patient Home Dashboard tab.
///
/// Welcomes the patient, spotlights their next appointment with immediate
/// actions, provides quick vitals logging, and shows a preview of upcoming visits.
class HomeTab extends StatelessWidget {
  const HomeTab({
    super.key,
    required this.controller,
    required this.onNavigate,
    this.onCheckin,
    this.onViewSummary,
    this.onSignOut,
  });

  final HomeController controller;
  final void Function(String route) onNavigate;
  final void Function(Appointment appointment)? onCheckin;
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
    final daysUntil = appointment.scheduledAt
        .difference(DateTime.now())
        .inDays;
    final status = appointment.status;

    String title;
    String subtitle;
    String btnText;
    VoidCallback? btnAction;
    String? secondaryText;
    VoidCallback? secondaryAction;
    Color bg;
    Color borderColor;

    switch (status) {
      case 'invited':
      case 'active':
        title = daysUntil >= 0
            ? 'Your appointment is in $daysUntil day${daysUntil == 1 ? '' : 's'}'
            : 'Your appointment is due';
        subtitle = 'Pre-visit check-in not started';
        btnText = 'Start pre-visit check-in';
        btnAction = onCheckin ?? () => onNavigate('/checkin');
        secondaryText = 'Share lab reports';
        secondaryAction = () => onNavigate('/reports');
        bg = const Color(0xFFE8F3F1);
        borderColor = Colors.transparent;
      case 'checked_in':
        title = "You're all set for your visit";
        subtitle = 'Check-in complete';
        btnText = 'Review shared reports';
        btnAction = () => onNavigate('/reports');
        bg = const Color(0xFFEAF4EC);
        borderColor = Colors.transparent;
      case 'completed':
        title = 'Your visit summary is ready';
        subtitle = 'Doctor notes and next steps available';
        btnText = 'View summary';
        btnAction = onViewSummary ?? () => onNavigate('/summary');
        secondaryText = 'Add lab reports';
        secondaryAction = () => onNavigate('/reports');
        bg = const Color(0xFFFBF8F5);
        borderColor = primary;
      default:
        return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: borderColor, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: ink,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: const TextStyle(
              fontSize: 13,
              color: primary,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.65),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  formatAppointmentDate(appointment.scheduledAt),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
                if (appointment.clinicianName != null)
                  Text(
                    appointment.clinicianName!,
                    style: const TextStyle(fontSize: 12, color: muted),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: btnAction,
            child: Text(btnText),
          ),
          if (secondaryText != null && secondaryAction != null) ...[
            const SizedBox(height: 8),
            OutlinedButton(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(double.infinity, 48),
                side: const BorderSide(color: primary),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              onPressed: secondaryAction,
              child: Text(secondaryText),
            ),
          ],
        ],
      ),
    );
  }
}

