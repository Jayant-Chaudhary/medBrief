import 'package:flutter/material.dart';
import '../../core/app_theme.dart';
import '../home/appointment_repository.dart';
import 'summary_controller.dart';

class SummaryPage extends StatefulWidget {
  const SummaryPage({
    super.key,
    required this.controller,
    required this.completedAppointments,
  });

  final SummaryController controller;
  final List<Appointment> completedAppointments;

  @override
  State<SummaryPage> createState() => _SummaryPageState();
}

class _SummaryPageState extends State<SummaryPage> {
  @override
  void initState() {
    super.initState();
    _initSelection();
  }

  @override
  void didUpdateWidget(covariant SummaryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.controller.selectedAppointmentId == null &&
        widget.completedAppointments.isNotEmpty) {
      _initSelection();
    }
  }

  void _initSelection() {
    if (widget.completedAppointments.isNotEmpty) {
      final selected = widget.controller.selectedAppointmentId;
      final exists = widget.completedAppointments.any((a) => a.id == selected);
      if (!exists) {
        widget.controller.selectAppointment(widget.completedAppointments.first.id);
      }
    }
  }

  String _formatDate(DateTime dt) {
    final months = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return '${months[dt.month]} ${dt.day}, ${dt.year}';
  }

  Widget _buildSummaryContent(SummaryController controller, PostVisitSummary summary) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Doctor's Notes Card
        _CardContainer(
          icon: Icons.description_outlined,
          iconColor: primary,
          title: "Doctor's Notes",
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFFBF8F5),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: line),
            ),
            child: Text(
              summary.notes?.notesText.isNotEmpty == true
                  ? summary.notes!.notesText
                  : 'No notes were added for this visit.',
              style: TextStyle(
                fontSize: 14,
                height: 1.5,
                color: summary.notes?.notesText.isNotEmpty == true ? ink : muted,
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Covered in your visit
        if (summary.consultationChecklist.isNotEmpty) ...[
          _CardContainer(
            icon: Icons.medical_services_outlined,
            iconColor: primary,
            title: 'Covered in your visit',
            child: Column(
              children: summary.consultationChecklist.map((item) {
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.check_circle_rounded,
                        size: 18,
                        color: Color(0xFF15803D),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          item.label,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w500,
                            color: ink,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 16),
        ],

        // Prescriptions
        if (summary.prescriptions.isNotEmpty) ...[
          ...summary.prescriptions.map((rx) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: _CardContainer(
                icon: Icons.medication_outlined,
                iconColor: const Color(0xFFD97706),
                title: 'Prescription',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (rx.typedInstructions?.isNotEmpty == true)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          rx.typedInstructions!,
                          style: const TextStyle(fontSize: 14, height: 1.5, color: ink),
                        ),
                      ),
                    if (rx.signedUrl != null)
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFBF8F5),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: line),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              rx.isPdf
                                  ? Icons.picture_as_pdf_outlined
                                  : Icons.image_outlined,
                              color: primary,
                              size: 24,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                rx.isPdf
                                    ? 'Prescription Document (PDF)'
                                    : 'Prescription Image',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 13,
                                  color: ink,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            );
          }),
        ],

        // Your Next Steps Card
        _CardContainer(
          icon: Icons.checklist_rounded,
          iconColor: const Color(0xFF0284C7),
          title: 'Your Next Steps',
          child: summary.actionItems.isEmpty
              ? const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    'No next steps assigned for this visit.',
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                )
              : Column(
                  children: summary.actionItems.map((action) {
                    return CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      visualDensity: VisualDensity.compact,
                      value: action.isCompleted,
                      activeColor: primary,
                      title: Text(
                        action.label,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: action.isCompleted ? FontWeight.w400 : FontWeight.w600,
                          color: action.isCompleted ? muted : ink,
                          decoration: action.isCompleted
                              ? TextDecoration.lineThrough
                              : TextDecoration.none,
                        ),
                      ),
                      onChanged: (_) => controller.toggleActionItem(action),
                    );
                  }).toList(),
                ),
        ),
        const SizedBox(height: 32),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final controller = widget.controller;

        if (widget.completedAppointments.isEmpty) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: const [
                  Icon(Icons.history_edu_outlined, size: 56, color: muted),
                  SizedBox(height: 16),
                  Text(
                    'No visit summaries yet',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Your doctor will share a summary with notes, prescriptions, and next steps once your appointment concludes.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: muted),
                  ),
                ],
              ),
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: () async {
            if (controller.selectedAppointmentId != null) {
              await controller.selectAppointment(controller.selectedAppointmentId!);
            }
          },
          color: primary,
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            children: [
              // Header
              const Text(
                'Visit History',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: ink,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Review past doctor notes and manage your next steps.',
                style: TextStyle(fontSize: 14, color: muted),
              ),
              const SizedBox(height: 16),

              // Visit chips / horizontal selector
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: widget.completedAppointments.map((appt) {
                    final isSelected = controller.selectedAppointmentId == appt.id;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChip(
                        selected: isSelected,
                        showCheckmark: false,
                        backgroundColor: Colors.white,
                        selectedColor: const Color(0xFFEDF5F4),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: BorderSide(
                            color: isSelected ? primary : line,
                            width: isSelected ? 1.5 : 1,
                          ),
                        ),
                        avatar: Icon(
                          Icons.calendar_today_outlined,
                          size: 16,
                          color: isSelected ? primary : muted,
                        ),
                        label: Text(
                          _formatDate(appt.scheduledAt),
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                            color: isSelected ? primary : ink,
                          ),
                        ),
                        onSelected: (_) => controller.selectAppointment(appt.id),
                      ),
                    );
                  }).toList(),
                ),
              ),
              const SizedBox(height: 20),

              // Summary body
              if (controller.isLoading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(48),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (controller.errorMessage != null)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF2F2),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFFCA5A5)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline, color: Color(0xFFDC2626)),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          controller.errorMessage!,
                          style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                )
              else if (controller.summary == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Text('Select an appointment to view summary.', style: TextStyle(color: muted)),
                  ),
                )
              else
                _buildSummaryContent(controller, controller.summary!),
            ],
          ),
        );
      },
    );
  }
}

class _CardContainer extends StatelessWidget {
  const _CardContainer({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.child,
  });

  final IconData icon;
  final Color iconColor;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: line),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: iconColor, size: 20),
              const SizedBox(width: 8),
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
            ],
          ),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }
}
