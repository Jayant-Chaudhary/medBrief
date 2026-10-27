import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/app_theme.dart';
import '../home/appointment_repository.dart';
import 'ocr_preview_sheet.dart';
import 'report_controller.dart';
import 'report_repository.dart';

class ReportsPage extends StatefulWidget {
  const ReportsPage({
    super.key,
    required this.controller,
    required this.appointments,
    this.activeAppointment,
    this.onSelectAppointment,
  });

  final ReportController controller;
  final List<Appointment> appointments;
  final Appointment? activeAppointment;
  final ValueChanged<Appointment>? onSelectAppointment;

  @override
  State<ReportsPage> createState() => _ReportsPageState();
}

class _ReportsPageState extends State<ReportsPage> {
  final ImagePicker _picker = ImagePicker();

  @override
  void initState() {
    super.initState();
    widget.controller.load();
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final xFile = await _picker.pickImage(source: source, imageQuality: 85);
      if (xFile == null) return;
      final bytes = await xFile.readAsBytes();
      if (!mounted) return;
      await widget.controller.uploadReport(
        bytes: bytes,
        filename: xFile.name,
        appointmentId: widget.activeAppointment?.id,
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Could not access image: $e'),
          backgroundColor: const Color(0xFFDC2626),
        ),
      );
    }
  }

  void _uploadSampleReport(String name, String content) {
    widget.controller.uploadReport(
      bytes: content.codeUnits,
      filename: '$name.txt',
      appointmentId: widget.activeAppointment?.id,
    );
  }

  void _showUploadOptions() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Text(
                  'Upload Lab Report',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFEDF5F4),
                  child: Icon(Icons.camera_alt_outlined, color: primary),
                ),
                title: const Text('Take a photo of printed report'),
                subtitle: const Text('Capture your physical lab document'),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickImage(ImageSource.camera);
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFEDF5F4),
                  child: Icon(Icons.photo_library_outlined, color: primary),
                ),
                title: const Text('Choose from photo gallery'),
                subtitle: const Text('Select a report image from your phone'),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickImage(ImageSource.gallery);
                },
              ),
              const Divider(height: 16, color: line),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                child: Text(
                  'Instant Test Samples',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: muted,
                  ),
                ),
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFF1EDE6),
                  child: Icon(Icons.description_outlined, color: ink),
                ),
                title: const Text('Sample CBC Blood Panel'),
                subtitle: const Text('Hemoglobin, WBC, Platelets test values'),
                onTap: () {
                  Navigator.pop(ctx);
                  _uploadSampleReport(
                    'cbc_blood_panel',
                    'Complete Blood Count: WBC 6.8 10^3/uL, Hemoglobin 14.2 g/dL, Platelets 240 10^3/uL',
                  );
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFFF1EDE6),
                  child: Icon(Icons.description_outlined, color: ink),
                ),
                title: const Text('Sample Lipid Profile'),
                subtitle: const Text('Cholesterol, HDL, LDL, Triglycerides'),
                onTap: () {
                  Navigator.pop(ctx);
                  _uploadSampleReport(
                    'lipid_profile',
                    'Lipid Profile: Total Cholesterol 185 mg/dL, HDL 55 mg/dL, LDL 110 mg/dL',
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showSharePicker(LabReport report) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Share with Appointments',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: ink),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Choose which visits your clinician can see this report for:',
                      style: TextStyle(fontSize: 13, color: muted),
                    ),
                    const SizedBox(height: 16),
                    if (widget.appointments.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: Text(
                          'No upcoming appointments to share with.',
                          style: TextStyle(color: muted),
                        ),
                      )
                    else
                      ...widget.appointments.map((appt) {
                        final isShared = report.isSharedWith(appt.id);
                        return CheckboxListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            appt.clinicianName != null
                                ? 'Visit with ${appt.clinicianName}'
                                : 'Upcoming Appointment',
                            style: const TextStyle(fontWeight: FontWeight.w600, color: ink),
                          ),
                          subtitle: Text(
                            '${appt.scheduledAt.month}/${appt.scheduledAt.day}/${appt.scheduledAt.year}',
                            style: const TextStyle(fontSize: 12, color: muted),
                          ),
                          value: isShared,
                          activeColor: primary,
                          onChanged: (val) {
                            if (val == null) return;
                            widget.controller.toggleShare(report, appt.id, val);
                            setSheetState(() {});
                          },
                        );
                      }),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: () => Navigator.pop(ctx),
                        child: const Text('Done'),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _confirmDelete(LabReport report) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove Report'),
        content: const Text(
          'Are you sure you want to remove this lab report? Clinicians will no longer have access to it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            onPressed: () {
              Navigator.pop(ctx);
              widget.controller.removeReport(report.id);
            },
            child: const Text('Remove'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final controller = widget.controller;

        return RefreshIndicator(
          onRefresh: controller.load,
          color: primary,
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            children: [
              // Header
              const Text(
                'Lab Reports',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: ink,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Upload a report once. Choose which appointments each one is shared with.',
                style: TextStyle(fontSize: 14, color: muted),
              ),
              const SizedBox(height: 16),

              // Upload Action Card
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: line),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.02),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: const BoxDecoration(
                        color: Color(0xFFEDF5F4),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.cloud_upload_outlined, color: primary, size: 28),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Upload a Lab Report',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Take a photo of your printed lab report or choose an image.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 13, color: muted),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: controller.isUploading ? null : _showUploadOptions,
                        icon: controller.isUploading
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.add_a_photo_outlined, size: 18),
                        label: Text(
                          controller.isUploading ? 'Reading document…' : 'Upload Report',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Messages
              if (controller.message != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEDF5F4),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFD4E6E4)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.check_circle_outline, color: primary, size: 20),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          controller.message!,
                          style: const TextStyle(color: primary, fontWeight: FontWeight.w600, fontSize: 13),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, size: 16, color: primary),
                        onPressed: controller.clearMessage,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              if (controller.errorMessage != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF2F2),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFFCA5A5)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline, color: Color(0xFFDC2626), size: 20),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          controller.errorMessage!,
                          style: const TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.w600, fontSize: 13),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, size: 16, color: Color(0xFFDC2626)),
                        onPressed: controller.clearMessage,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // Reports List Section
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Your Documents (${controller.reports.length})',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              if (controller.isLoading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (controller.reports.isEmpty)
                Container(
                  padding: const EdgeInsets.all(32),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: line),
                  ),
                  child: Column(
                    children: const [
                      Icon(Icons.insert_drive_file_outlined, size: 48, color: muted),
                      SizedBox(height: 12),
                      Text(
                        'No reports yet',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: ink,
                        ),
                      ),
                      SizedBox(height: 6),
                      Text(
                        'Upload a photo of your printed lab report and we will read the test values automatically.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 13, color: muted),
                      ),
                    ],
                  ),
                )
              else
                ...controller.reports.map((report) => _ReportCard(
                      report: report,
                      onPreview: () => OcrPreviewSheet.show(context, report),
                      onShare: () => _showSharePicker(report),
                      onDelete: () => _confirmDelete(report),
                    )),

              const SizedBox(height: 40),
            ],
          ),
        );
      },
    );
  }
}

class _ReportCard extends StatelessWidget {
  const _ReportCard({
    required this.report,
    required this.onPreview,
    required this.onShare,
    required this.onDelete,
  });

  final LabReport report;
  final VoidCallback onPreview;
  final VoidCallback onShare;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final metrics = report.metrics;
    final metricCount = metrics.length;
    final status = report.ocrStatus;

    final Color statusColor;
    final Color statusBg;
    final IconData statusIcon;
    final String statusLabel;

    if (status == 'success' && metricCount > 0) {
      statusColor = const Color(0xFF15803D);
      statusBg = const Color(0xFFDCFCE7);
      statusIcon = Icons.check_circle_outline;
      statusLabel = '$metricCount value${metricCount == 1 ? '' : 's'} read';
    } else if (status == 'partial') {
      statusColor = const Color(0xFFB45309);
      statusBg = const Color(0xFFFEF3C7);
      statusIcon = Icons.warning_amber_rounded;
      statusLabel = 'Partly read';
    } else if (status == 'failed') {
      statusColor = const Color(0xFFB45309);
      statusBg = const Color(0xFFFEF3C7);
      statusIcon = Icons.warning_amber_rounded;
      statusLabel = 'Doctor will review';
    } else {
      statusColor = muted;
      statusBg = const Color(0xFFF1EDE6);
      statusIcon = Icons.insert_drive_file_outlined;
      statusLabel = 'Uploaded';
    }

    final dateStr = report.reportDate != null
        ? 'Report from ${report.reportDate!.month}/${report.reportDate!.day}/${report.reportDate!.year}'
        : 'Lab report';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: statusBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(statusIcon, color: statusColor, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      dateStr,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                        color: ink,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 6,
                      runSpacing: 2,
                      children: [
                        Text(
                          statusLabel,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: statusColor,
                          ),
                        ),
                        const Text('•', style: TextStyle(color: muted, fontSize: 10)),
                        Text(
                          'shared with ${report.sharedAppointmentIds.length} visit${report.sharedAppointmentIds.length == 1 ? '' : 's'}',
                          style: const TextStyle(fontSize: 12, color: muted),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),

          // Metric Chips
          if (metrics.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                ...metrics.take(3).map(
                      (m) => Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFBF8F5),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: line),
                        ),
                        child: Text(
                          '${m.label}: ${m.displayValue}',
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: ink),
                        ),
                      ),
                    ),
                if (metrics.length > 3)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      '+${metrics.length - 3} more',
                      style: const TextStyle(fontSize: 11, color: muted, fontWeight: FontWeight.w600),
                    ),
                  ),
              ],
            ),
          ],

          const SizedBox(height: 12),
          const Divider(height: 1, color: line),
          const SizedBox(height: 8),

          // Action Row
          Row(
            children: [
              TextButton.icon(
                onPressed: onPreview,
                icon: const Icon(Icons.document_scanner_outlined, size: 16, color: primary),
                label: const Text('Preview', style: TextStyle(color: primary, fontWeight: FontWeight.w600)),
              ),
              const Spacer(),
              IconButton(
                tooltip: 'Share with visit',
                icon: Icon(
                  Icons.share_outlined,
                  size: 20,
                  color: report.sharedAppointmentIds.isNotEmpty ? primary : muted,
                ),
                onPressed: onShare,
              ),
              IconButton(
                tooltip: 'Remove',
                icon: const Icon(Icons.delete_outline, size: 20, color: muted),
                onPressed: onDelete,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

