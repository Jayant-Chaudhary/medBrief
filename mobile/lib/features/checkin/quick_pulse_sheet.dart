import 'package:flutter/material.dart';
import '../../core/app_theme.dart';
import 'checkin_repository.dart';

const dangerColor = Color(0xFFC0392B);

/// 30-Second Quick Pulse Check-In (prompted every 2-4 days).
class QuickPulseSheet extends StatefulWidget {
  const QuickPulseSheet({
    super.key,
    required this.repository,
    this.gestationalWeek,
    this.onSubmitted,
  });

  final CheckinRepository repository;
  final int? gestationalWeek;
  final VoidCallback? onSubmitted;

  static Future<void> show(
    BuildContext context, {
    required CheckinRepository repository,
    int? gestationalWeek,
    VoidCallback? onSubmitted,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(ctx).viewInsets.bottom,
        ),
        child: QuickPulseSheet(
          repository: repository,
          gestationalWeek: gestationalWeek,
          onSubmitted: onSubmitted,
        ),
      ),
    );
  }

  @override
  State<QuickPulseSheet> createState() => _QuickPulseSheetState();
}

class _QuickPulseSheetState extends State<QuickPulseSheet> {
  int _comfortRating = 4; // default: good
  final Set<String> _selectedDiscomforts = {};
  final _noteController = TextEditingController();
  bool _isSubmitting = false;

  static const _discomfortOptions = [
    'None',
    'Nausea',
    'Back pain',
    'Pelvic pressure',
    'Swelling',
    'Headache',
    'Fatigue',
    'Heartburn',
  ];

  static const _ratingLabels = [
    'Very rough',
    'Uneasy',
    'Okay',
    'Feeling good',
    'Great',
  ];

  static const _ratingIcons = [
    Icons.sentiment_very_dissatisfied_rounded,
    Icons.sentiment_dissatisfied_rounded,
    Icons.sentiment_neutral_rounded,
    Icons.sentiment_satisfied_rounded,
    Icons.sentiment_very_satisfied_rounded,
  ];

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    setState(() => _isSubmitting = true);

    final discomfortsList = _selectedDiscomforts.contains('None')
        ? <String>[]
        : _selectedDiscomforts.toList();

    try {
      final result = await widget.repository.submitQuickPulse(
        comfortRating: _comfortRating,
        discomforts: discomfortsList,
        notes: _noteController.text.trim(),
        gestationalWeek: widget.gestationalWeek,
      );

      if (!mounted) return;
      Navigator.of(context).pop();

      widget.onSubmitted?.call();

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.isUrgent
                ? 'Quick pulse logged and flagged for your doctor.'
                : 'Quick pulse logged! Next check-in in 2-3 days.',
          ),
          backgroundColor: result.isUrgent ? dangerColor : primary,
        ),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSubmitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not save check-in. Please retry.'),
          backgroundColor: dangerColor,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8F3F1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.bolt_rounded, color: primary, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Quick 30s Pulse Check',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: ink,
                        ),
                      ),
                      Text(
                        'How are you and baby feeling today?',
                        style: TextStyle(fontSize: 13, color: muted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded, color: muted),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Comfort Scale
            const Text(
              'Overall comfort today',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: ink),
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: List.generate(5, (index) {
                final rating = index + 1;
                final isSelected = _comfortRating == rating;
                return InkWell(
                  onTap: () => setState(() => _comfortRating = rating),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    width: 58,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: isSelected ? primary.withValues(alpha: 0.15) : const Color(0xFFF9FAFB),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isSelected ? primary : line,
                        width: isSelected ? 2 : 1,
                      ),
                    ),
                    child: Column(
                      children: [
                        Icon(
                          _ratingIcons[index],
                          color: isSelected ? primary : muted,
                          size: 28,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '$rating',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: isSelected ? FontWeight.w800 : FontWeight.w500,
                            color: isSelected ? primary : muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }),
            ),
            const SizedBox(height: 6),
            Center(
              child: Text(
                _ratingLabels[_comfortRating - 1],
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: primary,
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Symptoms / Discomforts Chips
            const Text(
              'Any noticeable discomforts?',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: ink),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _discomfortOptions.map((opt) {
                final isSelected = _selectedDiscomforts.contains(opt);
                return FilterChip(
                  label: Text(opt),
                  selected: isSelected,
                  selectedColor: primary.withValues(alpha: 0.15),
                  labelStyle: TextStyle(
                    color: isSelected ? primary : ink,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    fontSize: 13,
                  ),
                  onSelected: (val) {
                    setState(() {
                      if (opt == 'None') {
                        _selectedDiscomforts.clear();
                        if (val) _selectedDiscomforts.add('None');
                      } else {
                        _selectedDiscomforts.remove('None');
                        if (val) {
                          _selectedDiscomforts.add(opt);
                        } else {
                          _selectedDiscomforts.remove(opt);
                        }
                      }
                    });
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 16),

            // Optional note
            TextField(
              controller: _noteController,
              maxLines: 2,
              decoration: InputDecoration(
                hintText: 'Add an optional quick note for doctor...',
                hintStyle: const TextStyle(color: muted, fontSize: 13),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: line),
                ),
                filled: true,
                fillColor: const Color(0xFFF9FAFB),
              ),
            ),
            const SizedBox(height: 20),

            // Submit
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton(
                onPressed: _isSubmitting ? null : _handleSubmit,
                child: _isSubmitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'Save Today\'s Pulse (Done)',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
