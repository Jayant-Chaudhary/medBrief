import 'package:flutter/material.dart';
import '../../core/app_theme.dart';
import 'checkin_repository.dart';

const dangerColor = Color(0xFFC0392B);

/// 24/7 Modal Bottom Sheet for logging spontaneous patient symptoms or concerns.
class AdHocConcernSheet extends StatefulWidget {
  const AdHocConcernSheet({
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
        child: AdHocConcernSheet(
          repository: repository,
          gestationalWeek: gestationalWeek,
          onSubmitted: onSubmitted,
        ),
      ),
    );
  }

  @override
  State<AdHocConcernSheet> createState() => _AdHocConcernSheetState();
}

class _AdHocConcernSheetState extends State<AdHocConcernSheet> {
  final _textController = TextEditingController();
  String _selectedCategory = 'Stomach / Cramps';
  String _severity = 'mild';
  bool _isSubmitting = false;
  String? _errorMessage;

  static const _categories = [
    'Stomach / Cramps',
    'Headache / Vision',
    'Baby Movement',
    'Nausea / Fatigue',
    'Swelling / Pain',
    'Other Concern',
  ];

  static const _emergencyKeywords = [
    'bleeding',
    'blood',
    'fluid leak',
    'severe pain',
    'severe headache',
    'blurry',
    'vision',
    'fever',
    'chest pain',
    'no movement',
  ];

  bool get _hasEmergencySignals {
    if (_severity == 'severe') return true;
    final text = _textController.text.toLowerCase();
    return _emergencyKeywords.any((kw) => text.contains(kw));
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    final text = _textController.text.trim();
    if (text.length < 2) {
      setState(() => _errorMessage = 'Please describe what you are experiencing.');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final result = await widget.repository.submitAdHocConcern(
        category: 'concern',
        description: '[$_selectedCategory] $text',
        severity: _severity,
        gestationalWeek: widget.gestationalWeek,
      );

      if (!mounted) return;
      Navigator.of(context).pop();

      widget.onSubmitted?.call();

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.isUrgent
                ? 'Concern recorded and flagged urgent for your care team.'
                : 'Note saved for your doctor to review before your next visit.',
          ),
          backgroundColor: result.isUrgent ? dangerColor : primary,
          duration: const Duration(seconds: 4),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _errorMessage = 'Could not save note. Please check your connection and retry.';
      });
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
            // Drag handle
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

            // Title
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.edit_note_rounded, color: primary, size: 24),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Log a Concern Anytime',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: ink,
                        ),
                      ),
                      Text(
                        'Share a symptom or question for your doctor',
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
            const SizedBox(height: 16),

            // Category Chips
            const Text(
              'What are you noticing?',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: ink),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _categories.map((cat) {
                final isSelected = cat == _selectedCategory;
                return ChoiceChip(
                  label: Text(cat),
                  selected: isSelected,
                  selectedColor: primary.withValues(alpha: 0.15),
                  labelStyle: TextStyle(
                    color: isSelected ? primary : ink,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    fontSize: 13,
                  ),
                  onSelected: (val) {
                    if (val) setState(() => _selectedCategory = cat);
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 16),

            // Severity Level
            const Text(
              'How severe does it feel?',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: ink),
            ),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'mild', label: Text('Mild')),
                ButtonSegment(value: 'moderate', label: Text('Moderate')),
                ButtonSegment(value: 'severe', label: Text('Severe')),
              ],
              selected: {_severity},
              onSelectionChanged: (val) {
                setState(() => _severity = val.first);
              },
            ),
            const SizedBox(height: 16),

            // Description Input
            TextField(
              controller: _textController,
              maxLines: 3,
              textInputAction: TextInputAction.done,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'e.g., Today I felt stomach aches regularly after lunch...',
                hintStyle: const TextStyle(color: muted, fontSize: 14),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: line),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: primary, width: 2),
                ),
                filled: true,
                fillColor: const Color(0xFFF9FAFB),
              ),
            ),
            if (_errorMessage != null) ...[
              const SizedBox(height: 8),
              Text(
                _errorMessage!,
                style: const TextStyle(color: dangerColor, fontSize: 12),
              ),
            ],

            // Emergency Safety Intercept
            if (_hasEmergencySignals) ...[
              const SizedBox(height: 14),
              Container(
                decoration: BoxDecoration(
                  color: dangerColor.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: dangerColor.withValues(alpha: 0.3)),
                ),
                padding: const EdgeInsets.all(12),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.warning_amber_rounded, color: dangerColor, size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Urgent alert: If you are experiencing heavy bleeding, sudden visual loss, or extreme pain, please contact clinic emergency triage immediately.',
                        style: TextStyle(
                          fontSize: 12,
                          color: dangerColor,
                          fontWeight: FontWeight.w600,
                          height: 1.3,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 20),

            // Submit Button
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton.icon(
                onPressed: _isSubmitting ? null : _handleSubmit,
                icon: _isSubmitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.send_rounded, size: 18),
                label: Text(
                  _isSubmitting ? 'Saving Note...' : 'Save for Doctor',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
