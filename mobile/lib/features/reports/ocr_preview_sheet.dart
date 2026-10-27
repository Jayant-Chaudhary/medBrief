import 'package:flutter/material.dart';
import '../../core/app_theme.dart';
import 'report_repository.dart';

class OcrPreviewSheet extends StatelessWidget {
  const OcrPreviewSheet({super.key, required this.report});

  final LabReport report;

  static void show(BuildContext context, LabReport report) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => OcrPreviewSheet(report: report),
    );
  }

  String _formatEngine(String? engine) {
    switch (engine) {
      case 'digital':
        return 'Read from the PDF text';
      case 'ocr':
        return 'Read by scanning the image';
      case 'none':
        return 'Could not be read';
      default:
        return engine ?? 'Automated OCR';
    }
  }

  @override
  Widget build(BuildContext context) {
    final raw = report.rawOcrPayload ?? {};
    final metrics = report.metrics;
    final warnings = (raw['warnings'] is List)
        ? (raw['warnings'] as List).map((w) => w.toString()).toList()
        : <String>[];
    final error = raw['error']?.toString();
    final engine = raw['engine'] as String?;
    final confidence = raw['confidence'] as num?;
    final flaggedCount = metrics.where((m) => m.needsReview).length;

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              // Handle bar
              Container(
                margin: const EdgeInsets.only(top: 12, bottom: 8),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: line,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),

              // Header
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'What we read from your report',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: ink,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, color: muted),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1, color: line),

              // Content
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.all(20),
                  children: [
                    // Status Badges
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        if (engine != null)
                          _Badge(
                            label: _formatEngine(engine),
                            color: ink,
                            backgroundColor: const Color(0xFFF1EDE6),
                          ),
                        if (confidence != null)
                          _Badge(
                            label: 'Overall confidence ${(confidence * 100).round()}%',
                            color: ink,
                            backgroundColor: const Color(0xFFF1EDE6),
                          ),
                        if (flaggedCount > 0)
                          _Badge(
                            label: '$flaggedCount value${flaggedCount == 1 ? '' : 's'} for doctor to review',
                            color: const Color(0xFFB45309),
                            backgroundColor: const Color(0xFFFEF3C7),
                          ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Error warning
                    if (error != null) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF3C7),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFFDE68A)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.warning_amber_rounded, size: 20, color: Color(0xFFD97706)),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                error.isNotEmpty
                                    ? error
                                    : 'We could not read this document automatically. Your doctor will review the original file.',
                                style: const TextStyle(fontSize: 13, color: ink),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Warnings
                    if (warnings.isNotEmpty) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFBEB),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFFDE68A)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: warnings
                              .map(
                                (w) => Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 2),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Icon(Icons.info_outline, size: 16, color: Color(0xFFD97706)),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          w,
                                          style: const TextStyle(fontSize: 13, color: ink),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Metrics table header
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Values found (${metrics.length})',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: ink,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    if (metrics.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(24),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFBF8F5),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: line),
                        ),
                        child: const Center(
                          child: Text(
                            'No test values were recognized in this document.',
                            style: TextStyle(color: muted, fontSize: 13),
                          ),
                        ),
                      )
                    else
                      Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: line),
                        ),
                        child: ListView.separated(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: metrics.length,
                          separatorBuilder: (context, index) => const Divider(height: 1, color: line),
                          itemBuilder: (context, index) {
                            final m = metrics[index];
                            final needsReview = m.needsReview;
                            return Container(
                              color: needsReview ? const Color(0xFFFFFBEB) : Colors.transparent,
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    flex: 3,
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          m.label,
                                          style: TextStyle(
                                            fontWeight: FontWeight.w600,
                                            fontSize: 14,
                                            color: needsReview ? const Color(0xFF92400E) : ink,
                                          ),
                                        ),
                                        if (m.displayName != null && m.rawKey != m.displayName)
                                          Text(
                                            'as printed: ${m.rawKey}',
                                            style: const TextStyle(fontSize: 11, color: muted),
                                          ),
                                      ],
                                    ),
                                  ),
                                  Expanded(
                                    flex: 2,
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.end,
                                      children: [
                                        Text(
                                          '${m.displayValue} ${m.displayUnit}'.trim(),
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w700,
                                            fontSize: 14,
                                            color: ink,
                                          ),
                                        ),
                                        if (m.confidence != null)
                                          Text(
                                            '${(m.confidence! * 100).round()}% conf.',
                                            style: const TextStyle(fontSize: 11, color: muted),
                                          ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),

                    const SizedBox(height: 32),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({
    required this.label,
    required this.color,
    required this.backgroundColor,
  });

  final String label;
  final Color color;
  final Color backgroundColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}

