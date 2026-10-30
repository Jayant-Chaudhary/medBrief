import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_theme.dart';
import 'appointment_repository.dart';
import 'home_controller.dart';

/// Reusable appointment status badge label matching the web client.
const _statusLabel = {
  'invited': 'Invited',
  'active': 'Scheduled',
  'checked_in': 'Checked in',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
};

// ---------------------------------------------------------------------------
// Appointments Tab (Dedicated Visits Screen)
// ---------------------------------------------------------------------------

class AppointmentsTab extends StatefulWidget {
  const AppointmentsTab({
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
  State<AppointmentsTab> createState() => _AppointmentsTabState();
}

class _AppointmentsTabState extends State<AppointmentsTab> {
  String _filter = 'all'; // 'all', 'upcoming', 'past'

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;

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

    final upcoming = controller.appointments.upcoming;
    final past = controller.appointments.past;
    final allCount = controller.appointments.all.length;

    return RefreshIndicator(
      onRefresh: controller.refresh,
      color: primary,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
        children: [
          // ── Title & Intro ────────────────────────────────────────
          const Text(
            'Appointments',
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w800,
              color: ink,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Manage your upcoming visits, complete check-in, and view past summaries.',
            style: TextStyle(fontSize: 14, color: muted),
          ),
          const SizedBox(height: 18),

          // ── Filter Chips ─────────────────────────────────────────
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _FilterTabPill(
                  label: 'All ($allCount)',
                  selected: _filter == 'all',
                  onTap: () => setState(() => _filter = 'all'),
                ),
                const SizedBox(width: 8),
                _FilterTabPill(
                  label: 'Upcoming (${upcoming.length})',
                  selected: _filter == 'upcoming',
                  onTap: () => setState(() => _filter = 'upcoming'),
                ),
                const SizedBox(width: 8),
                _FilterTabPill(
                  label: 'Past visits (${past.length})',
                  selected: _filter == 'past',
                  onTap: () => setState(() => _filter = 'past'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // ── Upcoming Appointments Section ────────────────────────
          if (_filter == 'all' || _filter == 'upcoming') ...[
            SectionHeader(
              title: 'Upcoming appointments',
              subtitle: _filter == 'all'
                  ? 'Complete check-in or share reports before your visit.'
                  : null,
            ),
            const SizedBox(height: 12),
            if (upcoming.isEmpty)
              const EmptyStateWidget(
                icon: Icons.calendar_today_outlined,
                title: 'No upcoming appointments',
                body: 'When your clinic schedules a visit, it will appear here.',
              )
            else
              ...upcoming.map(
                (appt) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: AppointmentCard(
                    appointment: appt,
                    isSelected: appt.id == controller.activeAppointment?.id,
                    onTap: () => controller.selectAppointment(appt.id),
                    onCheckin: widget.onCheckin,
                    onViewSummary: widget.onViewSummary,
                    onShareReports: (a) {
                      controller.selectAppointment(a.id);
                      widget.onNavigate('/reports');
                    },
                  ),
                ),
              ),
          ],

          // ── Past Appointments Section ────────────────────────────
          if (_filter == 'all' || _filter == 'past') ...[
            if (_filter == 'all' && upcoming.isNotEmpty)
              const SizedBox(height: 20),
            SectionHeader(
              title: 'Past visits',
              subtitle: _filter == 'all'
                  ? 'Access doctor notes, prescriptions, and next steps.'
                  : null,
            ),
            const SizedBox(height: 12),
            if (past.isEmpty)
              const EmptyStateWidget(
                icon: Icons.history_outlined,
                title: 'No past visits',
                body: 'Summaries for completed visits will be saved here.',
              )
            else
              ...past.map(
                (appt) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: AppointmentCard(
                    appointment: appt,
                    isSelected: appt.id == controller.activeAppointment?.id,
                    onTap: () => controller.selectAppointment(appt.id),
                    onCheckin: widget.onCheckin,
                    onViewSummary: widget.onViewSummary,
                    onShareReports: (a) {
                      controller.selectAppointment(a.id);
                      widget.onNavigate('/reports');
                    },
                  ),
                ),
              ),
          ],

          if (widget.onSignOut != null) ...[
            const SizedBox(height: 32),
            Center(
              child: OutlinedButton.icon(
                onPressed: widget.onSignOut,
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
// Filter Tab Pill
// ---------------------------------------------------------------------------

class _FilterTabPill extends StatelessWidget {
  const _FilterTabPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      selected: selected,
      showCheckmark: false,
      backgroundColor: Colors.white,
      selectedColor: const Color(0xFFE8F3F1),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: selected ? primary : line,
          width: selected ? 1.5 : 1,
        ),
      ),
      label: Text(
        label,
        style: TextStyle(
          fontSize: 13,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          color: selected ? primary : ink,
        ),
      ),
      onSelected: (_) => onTap(),
    );
  }
}

// ---------------------------------------------------------------------------
// Rich Appointment Card (With Contextual Action Buttons)
// ---------------------------------------------------------------------------

class AppointmentCard extends StatelessWidget {
  const AppointmentCard({
    super.key,
    required this.appointment,
    required this.isSelected,
    required this.onTap,
    this.onCheckin,
    this.onViewSummary,
    this.onShareReports,
  });

  final Appointment appointment;
  final bool isSelected;
  final VoidCallback onTap;
  final void Function(Appointment appt)? onCheckin;
  final void Function(Appointment appt)? onViewSummary;
  final void Function(Appointment appt)? onShareReports;

  @override
  Widget build(BuildContext context) {
    final daysUntil = appointment.scheduledAt
        .difference(DateTime.now())
        .inDays;
    final when = whenLabel(daysUntil);
    final status = appointment.status;
    final label = _statusLabel[status] ?? status;
    final isUpcoming = appointment.isUpcoming;

    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFFF9FDFD) : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: isSelected ? primary : line,
            width: isSelected ? 1.8 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Top row: Date & Status Badge ───────────────────────
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        formatAppointmentDate(appointment.scheduledAt),
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                          color: ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${formatAppointmentTime(appointment.scheduledAt)} · $when',
                        style: const TextStyle(fontSize: 13, color: muted),
                      ),
                    ],
                  ),
                ),
                StatusBadge(label: label, isUpcoming: isUpcoming),
              ],
            ),
            const Divider(height: 20, color: line),

            // ── Clinician row ──────────────────────────────────────
            Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8F3F1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.medical_services_outlined,
                    size: 16,
                    color: primary,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        appointment.clinicianName ?? 'Your clinician',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: ink,
                        ),
                      ),
                      Text(
                        isUpcoming
                            ? 'Scheduled consultation'
                            : (status == 'completed'
                                ? 'Completed visit'
                                : 'Visit record'),
                        style: const TextStyle(fontSize: 12, color: muted),
                      ),
                    ],
                  ),
                ),
                if (isSelected)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE8F3F1),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Text(
                      'ACTIVE',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        color: primary,
                        letterSpacing: 0.8,
                      ),
                    ),
                  ),
              ],
            ),

            // ── Contextual Action Buttons ──────────────────────────
            if (status == 'invited' || status == 'active') ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  if (onCheckin != null)
                    Expanded(
                      flex: 3,
                      child: FilledButton.icon(
                        onPressed: () => onCheckin!(appointment),
                        icon: const Icon(Icons.checklist_rounded, size: 18),
                        label: const Text('Check in'),
                        style: FilledButton.styleFrom(
                          backgroundColor: primary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                    ),
                  if (onCheckin != null && onShareReports != null)
                    const SizedBox(width: 8),
                  if (onShareReports != null)
                    Expanded(
                      flex: 2,
                      child: OutlinedButton(
                        onPressed: () => onShareReports!(appointment),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: primary),
                          foregroundColor: primary,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: const Text('Reports'),
                      ),
                    ),
                ],
              ),
            ] else if (status == 'checked_in') ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEAF4EC),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFB2D4CF)),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.check_circle_rounded,
                          size: 15,
                          color: Color(0xFF15803D),
                        ),
                        SizedBox(width: 6),
                        Text(
                          'Checked in',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF15803D),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  if (onShareReports != null)
                    OutlinedButton.icon(
                      onPressed: () => onShareReports!(appointment),
                      icon: const Icon(Icons.description_outlined, size: 16),
                      label: const Text('Share reports'),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: primary),
                        foregroundColor: primary,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 8,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                ],
              ),
            ] else if (status == 'completed') ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  if (onViewSummary != null)
                    Expanded(
                      flex: 3,
                      child: FilledButton.icon(
                        onPressed: () => onViewSummary!(appointment),
                        icon: const Icon(Icons.summarize_outlined, size: 18),
                        label: const Text('View summary'),
                        style: FilledButton.styleFrom(
                          backgroundColor: primary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                    ),
                  if (onViewSummary != null && onShareReports != null)
                    const SizedBox(width: 8),
                  if (onShareReports != null)
                    Expanded(
                      flex: 2,
                      child: OutlinedButton(
                        onPressed: () => onShareReports!(appointment),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: primary),
                          foregroundColor: primary,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: const Text('Reports'),
                      ),
                    ),
                ],
              ),
            ] else if (status == 'cancelled') ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF2F2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.cancel_outlined, size: 15, color: Color(0xFFDC2626)),
                    SizedBox(width: 6),
                    Text(
                      'This visit was cancelled.',
                      style: TextStyle(fontSize: 12, color: Color(0xFFDC2626)),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.label,
    required this.isUpcoming,
  });

  final String label;
  final bool isUpcoming;

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color border;
    Color text;

    if (label == 'Completed') {
      bg = const Color(0xFFF3F4F6);
      border = const Color(0xFFD1D5DB);
      text = muted;
    } else if (label == 'Cancelled') {
      bg = const Color(0xFFFEF2F2);
      border = const Color(0xFFFCA5A5);
      text = const Color(0xFFDC2626);
    } else if (label == 'Checked in') {
      bg = const Color(0xFFEAF4EC);
      border = const Color(0xFFB2D4CF);
      text = const Color(0xFF15803D);
    } else {
      bg = const Color(0xFFE8F3F1);
      border = const Color(0xFFB2D4CF);
      text = const Color(0xFF1E5A54);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: border),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: text,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers & Empty State
// ---------------------------------------------------------------------------

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: ink,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(subtitle!, style: const TextStyle(fontSize: 13, color: muted)),
          ],
        ],
      );
}

class EmptyStateWidget extends StatelessWidget {
  const EmptyStateWidget({
    super.key,
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: const Color(0xFFFBF8F5),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: line),
        ),
        child: Column(
          children: [
            Icon(icon, size: 36, color: muted),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(fontWeight: FontWeight.w600, color: ink),
            ),
            const SizedBox(height: 6),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: muted),
            ),
          ],
        ),
      );
}

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

String greetingLabel() {
  final hour = DateTime.now().hour;
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

String formatAppointmentDate(DateTime dt) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  final weekday = days[dt.weekday - 1];
  return '$weekday, ${months[dt.month - 1]} ${dt.day}, ${dt.year}';
}

String formatAppointmentTime(DateTime dt) {
  final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  final minute = dt.minute.toString().padLeft(2, '0');
  final period = dt.hour < 12 ? 'AM' : 'PM';
  return '$hour:$minute $period';
}

String whenLabel(int days) {
  if (days == 0) return 'Today';
  if (days == 1) return 'Tomorrow';
  if (days > 1) return 'In $days days';
  if (days == -1) return 'Yesterday';
  return '${days.abs()} days ago';
}
