import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_theme.dart';
import '../auth/auth_widgets.dart';
import 'appointment_repository.dart';
import 'home_controller.dart';

/// Reusable appointment status badge label, matching the web client labels.
const _statusLabel = {
  'invited': 'Invited',
  'active': 'Scheduled',
  'checked_in': 'Checked in',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
};

// ---------------------------------------------------------------------------
// Action Banner
// ---------------------------------------------------------------------------

class _ActionBanner extends StatelessWidget {
  const _ActionBanner({required this.appointment, required this.onNavigate});

  final Appointment appointment;
  final void Function(String route) onNavigate;

  @override
  Widget build(BuildContext context) {
    final daysUntil = appointment.scheduledAt
        .difference(DateTime.now())
        .inDays;
    final status = appointment.status;

    String title;
    String subtitle;
    String btnText;
    String btnRoute;
    String? secondaryText;
    String? secondaryRoute;
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
        btnRoute = '/checkin';
        secondaryText = 'Share lab reports';
        secondaryRoute = '/reports';
        bg = const Color(0xFFE8F3F1);
        borderColor = Colors.transparent;
      case 'checked_in':
        title = "You're all set for your visit";
        subtitle = 'Check-in complete';
        btnText = 'Review shared reports';
        btnRoute = '/reports';
        bg = const Color(0xFFEAF4EC);
        borderColor = Colors.transparent;
      case 'completed':
        title = 'Your visit summary is ready';
        subtitle = 'Doctor notes and next steps available';
        btnText = 'View summary';
        btnRoute = '/summary';
        secondaryText = 'Add lab reports';
        secondaryRoute = '/reports';
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
            style: const TextStyle(fontSize: 13, color: primary, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          // Appointment date chip
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
                  _formatDate(appointment.scheduledAt),
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
            onPressed: () => onNavigate(btnRoute),
            child: Text(btnText),
          ),
          if (secondaryText != null) ...[
            const SizedBox(height: 8),
            OutlinedButton(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(double.infinity, 48),
                side: const BorderSide(color: primary),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              onPressed: () => onNavigate(secondaryRoute!),
              child: Text(secondaryText),
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Appointment Card
// ---------------------------------------------------------------------------

class _AppointmentCard extends StatelessWidget {
  const _AppointmentCard({
    required this.appointment,
    required this.isSelected,
    required this.onTap,
  });

  final Appointment appointment;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final daysUntil = appointment.scheduledAt
        .difference(DateTime.now())
        .inDays;
    final whenText = _whenLabel(daysUntil);
    final label = _statusLabel[appointment.status] ?? appointment.status;
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
          color: isSelected ? const Color(0xFFE8F3F1) : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: isSelected ? primary : line,
            width: isSelected ? 2 : 1,
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
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _formatDate(appointment.scheduledAt),
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                          color: ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${_formatTime(appointment.scheduledAt)} · $whenText',
                        style: const TextStyle(fontSize: 13, color: muted),
                      ),
                    ],
                  ),
                ),
                _StatusBadge(label: label, isUpcoming: isUpcoming),
              ],
            ),
            const Divider(height: 20, color: line),
            Row(
              children: [
                const Icon(Icons.medical_services_outlined, size: 16, color: primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    appointment.clinicianName ?? 'Your clinician',
                    style: const TextStyle(fontSize: 13, color: ink),
                  ),
                ),
              ],
            ),
            if (isSelected) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.check_circle_rounded, size: 14, color: primary),
                  const SizedBox(width: 6),
                  Text(
                    'SELECTED',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: primary,
                      letterSpacing: 1.2,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.label, required this.isUpcoming});

  final String label;
  final bool isUpcoming;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: isUpcoming
            ? const Color(0xFFE8F3F1)
            : const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isUpcoming
              ? const Color(0xFFB2D4CF)
              : const Color(0xFFD1D5DB),
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: isUpcoming ? const Color(0xFF1E5A54) : muted,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Vitals Card
// ---------------------------------------------------------------------------

class _VitalsCard extends StatefulWidget {
  const _VitalsCard({required this.controller});

  final HomeController controller;

  @override
  State<_VitalsCard> createState() => _VitalsCardState();
}

class _VitalsCardState extends State<_VitalsCard> {
  late double _weight;
  final _systolic = TextEditingController();
  final _diastolic = TextEditingController();
  bool _showBp = false;

  @override
  void initState() {
    super.initState();
    _weight = widget.controller.vitals.weight?.value ?? 65.0;
  }

  @override
  void dispose() {
    _systolic.dispose();
    _diastolic.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    final sys = double.tryParse(_systolic.text);
    final dia = double.tryParse(_diastolic.text);

    await widget.controller.logVitals(
      weight: _weight,
      bpSystolic: _showBp ? sys : null,
      bpDiastolic: _showBp ? dia : null,
    );

    if (!mounted) return;
    if (widget.controller.saveError == null) {
      if (_showBp) {
        _systolic.clear();
        _diastolic.clear();
        setState(() => _showBp = false);
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Vitals saved.'),
          behavior: SnackBarBehavior.floating,
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final saving = widget.controller.saving;
    final saveError = widget.controller.saveError;
    final lastBpSys = widget.controller.vitals.bpSystolic;
    final lastBpDia = widget.controller.vitals.bpDiastolic;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: line),
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
          Row(
            children: [
              const Icon(Icons.monitor_heart_outlined, color: primary, size: 20),
              const SizedBox(width: 8),
              const Text(
                'Quick Vitals Update',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                  color: ink,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // ── Weight stepper ──────────────────────────────────────
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFFFBF8F5),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Expanded(
                  child: Text(
                    'Weight (kg)',
                    style: TextStyle(fontWeight: FontWeight.w500, color: ink),
                  ),
                ),
                _StepButton(
                  icon: Icons.remove,
                  onTap: saving
                      ? null
                      : () => setState(
                            () => _weight =
                                double.parse((_weight - 0.1).toStringAsFixed(1)),
                          ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 54,
                  child: Text(
                    _weight.toStringAsFixed(1),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                _StepButton(
                  icon: Icons.add,
                  onTap: saving
                      ? null
                      : () => setState(
                            () => _weight =
                                double.parse((_weight + 0.1).toStringAsFixed(1)),
                          ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // ── Blood pressure toggle ────────────────────────────────
          GestureDetector(
            onTap: saving ? null : () => setState(() => _showBp = !_showBp),
            child: Row(
              children: [
                Icon(
                  _showBp
                      ? Icons.expand_less_rounded
                      : Icons.expand_more_rounded,
                  size: 20,
                  color: primary,
                ),
                const SizedBox(width: 6),
                const Expanded(
                  child: Text(
                    'Add blood pressure reading',
                    style: TextStyle(
                      color: primary,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
                if (lastBpSys != null && !_showBp) ...[
                  const SizedBox(width: 6),
                  Text(
                    '${lastBpSys.value.toStringAsFixed(0)}/'
                    '${lastBpDia?.value.toStringAsFixed(0) ?? '–'} mmHg',
                    style: const TextStyle(fontSize: 12, color: muted),
                  ),
                ],
              ],
            ),
          ),

          if (_showBp) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _systolic,
                    enabled: !saving,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Systolic',
                      hintText: '120',
                      suffixText: 'mmHg',
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _diastolic,
                    enabled: !saving,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Diastolic',
                      hintText: '80',
                      suffixText: 'mmHg',
                    ),
                  ),
                ),
              ],
            ),
          ],

          if (saveError != null) ...[
            const SizedBox(height: 10),
            ErrorNotice(saveError),
          ],
          const SizedBox(height: 14),

          FilledButton(
            onPressed: saving ? null : _save,
            child: saving
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Save vitals'),
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 4,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Icon(icon, size: 20, color: onTap == null ? muted : primary),
    ),
  );
}

// ---------------------------------------------------------------------------
// Appointments Tab (the main scrollable content)
// ---------------------------------------------------------------------------

class AppointmentsTab extends StatelessWidget {
  const AppointmentsTab({
    super.key,
    required this.controller,
    required this.onNavigate,
    this.onSignOut,
  });

  final HomeController controller;
  final void Function(String route) onNavigate;
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
                      _greeting(),
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
                    firstName.isNotEmpty
                        ? firstName[0].toUpperCase()
                        : '?',
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
          if (controller.activeAppointment != null) ...[
            _ActionBanner(
              appointment: controller.activeAppointment!,
              onNavigate: onNavigate,
            ),
            const SizedBox(height: 24),
          ],

          // ── Vitals quick-logger ──────────────────────────────────
          _VitalsCard(controller: controller),
          const SizedBox(height: 28),

          // ── Upcoming appointments ────────────────────────────────
          _SectionHeader(
            title: 'Upcoming appointments',
            subtitle: 'Select one to check in or share reports with it.',
          ),
          const SizedBox(height: 12),
          if (controller.appointments.upcoming.isEmpty)
            _EmptyState(
              icon: Icons.calendar_today_outlined,
              title: 'No upcoming appointments',
              body: 'When your clinic schedules a visit, it will appear here.',
            )
          else
            ...controller.appointments.upcoming.map(
              (appt) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _AppointmentCard(
                  appointment: appt,
                  isSelected: appt.id == controller.activeAppointment?.id,
                  onTap: () => controller.selectAppointment(appt.id),
                ),
              ),
            ),

          // ── Past appointments ────────────────────────────────────
          if (controller.appointments.past.isNotEmpty) ...[
            const SizedBox(height: 24),
            const _SectionHeader(title: 'Past visits'),
            const SizedBox(height: 12),
            ...controller.appointments.past.map(
              (appt) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _AppointmentCard(
                  appointment: appt,
                  isSelected: appt.id == controller.activeAppointment?.id,
                  onTap: () => controller.selectAppointment(appt.id),
                ),
              ),
            ),
          ],
          if (onSignOut != null) ...[
            const SizedBox(height: 32),
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
// Small helpers
// ---------------------------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.subtitle});

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
      if (subtitle != null)
        Text(subtitle!, style: const TextStyle(fontSize: 13, color: muted)),
    ],
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Container(
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
// Formatting helpers (no intl dependency needed)
// ---------------------------------------------------------------------------

String _greeting() {
  final hour = DateTime.now().hour;
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

String _formatDate(DateTime dt) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  final weekday = days[dt.weekday - 1];
  return '$weekday, ${months[dt.month - 1]} ${dt.day}, ${dt.year}';
}

String _formatTime(DateTime dt) {
  final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  final minute = dt.minute.toString().padLeft(2, '0');
  final period = dt.hour < 12 ? 'AM' : 'PM';
  return '$hour:$minute $period';
}

String _whenLabel(int days) {
  if (days == 0) return 'Today';
  if (days == 1) return 'Tomorrow';
  if (days > 1) return 'In $days days';
  if (days == -1) return 'Yesterday';
  return '${days.abs()} days ago';
}

