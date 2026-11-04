import 'package:flutter/material.dart';

import '../../../core/app_theme.dart';

/// Clinical/friendly gestational milestones & fruit/veggie size comparisons.
class PregnancyMilestone {
  const PregnancyMilestone({
    required this.fruit,
    required this.emoji,
    required this.lengthCm,
    required this.highlight,
  });

  final String fruit;
  final String emoji;
  final double lengthCm;
  final String highlight;

  static PregnancyMilestone forWeek(int week) {
    if (week < 6) {
      return const PregnancyMilestone(
        fruit: 'Poppy seed',
        emoji: '🌱',
        lengthCm: 0.2,
        highlight: 'Tiny embryo is nestling safely and early cell structures are forming.',
      );
    } else if (week < 10) {
      return const PregnancyMilestone(
        fruit: 'Raspberry',
        emoji: '🫐',
        lengthCm: 1.6,
        highlight: 'Tiny webbed fingers and toes are forming with rapid brain development.',
      );
    } else if (week < 14) {
      return const PregnancyMilestone(
        fruit: 'Lime',
        emoji: '🍋',
        lengthCm: 5.4,
        highlight: 'Baby can move fingers and curl toes; facial features are taking shape.',
      );
    } else if (week < 18) {
      return const PregnancyMilestone(
        fruit: 'Avocado',
        emoji: '🥑',
        lengthCm: 11.6,
        highlight: 'Baby’s eyes can make small movements and early hearing is developing.',
      );
    } else if (week < 22) {
      return const PregnancyMilestone(
        fruit: 'Banana',
        emoji: '🍌',
        lengthCm: 25.0,
        highlight: 'Halfway milestone! You may start feeling gentle fluttering kicks.',
      );
    } else if (week < 26) {
      return const PregnancyMilestone(
        fruit: 'Ear of corn',
        emoji: '🌽',
        lengthCm: 30.0,
        highlight: 'Baby’s hearing is sharp; they can hear your voice and heartbeat.',
      );
    } else if (week < 28) {
      return const PregnancyMilestone(
        fruit: 'Eggplant',
        emoji: '🍆',
        lengthCm: 35.0,
        highlight: 'Baby is practicing gentle breathing motions and opening their eyes.',
      );
    } else if (week < 32) {
      return const PregnancyMilestone(
        fruit: 'Acorn squash',
        emoji: '🥬',
        lengthCm: 38.0,
        highlight: 'Entering Trimester 3! Rapid brain and sleep-wake cycles are underway.',
      );
    } else if (week < 36) {
      return const PregnancyMilestone(
        fruit: 'Jicama',
        emoji: '🥥',
        lengthCm: 43.0,
        highlight: 'Baby has full fingernails and hair; bones are fully hardening.',
      );
    } else if (week < 39) {
      return const PregnancyMilestone(
        fruit: 'Papaya',
        emoji: '🍈',
        lengthCm: 48.0,
        highlight: 'Lungs are nearly mature; baby is settling comfortably for arrival.',
      );
    } else {
      return const PregnancyMilestone(
        fruit: 'Watermelon',
        emoji: '🍉',
        lengthCm: 51.0,
        highlight: 'Full term! Baby is fully formed and ready to meet the world.',
      );
    }
  }
}

/// A warm, reassuring pregnancy milestone card displaying weekly growth,
/// trimester progress, and gentle developmental notes.
class PregnancyMilestoneCard extends StatelessWidget {
  const PregnancyMilestoneCard({
    super.key,
    required this.dueDateString,
    this.onSetDueDate,
  });

  final String? dueDateString;
  final VoidCallback? onSetDueDate;

  @override
  Widget build(BuildContext context) {
    final edd = _parseDate(dueDateString);

    if (edd == null) {
      return _buildEmptyState(context);
    }

    final today = DateTime.now();
    final todayMidnight = DateTime(today.year, today.month, today.day);
    final eddMidnight = DateTime(edd.year, edd.month, edd.day);
    final daysRemaining = eddMidnight.difference(todayMidnight).inDays;

    // Gestational age calculation based on standard 280-day cycle
    final gestationalDays = 280 - daysRemaining;
    final week = (gestationalDays / 7).clamp(1, 42).floor();
    final progress = (gestationalDays / 280.0).clamp(0.0, 1.0);

    final String trimesterLabel;
    if (week <= 13) {
      trimesterLabel = 'Trimester 1';
    } else if (week <= 27) {
      trimesterLabel = 'Trimester 2';
    } else {
      trimesterLabel = 'Trimester 3';
    }

    final String daysRemainingLabel = daysRemaining > 0
        ? '$daysRemaining days to go'
        : (daysRemaining == 0 ? 'Due today!' : 'Past due date');

    final milestone = PregnancyMilestone.forWeek(week);

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x08000000),
            blurRadius: 10,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: Week Pill & Trimester / Countdown
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  'Week $week',
                  style: const TextStyle(
                    color: primary,
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '$trimesterLabel • $daysRemainingLabel',
                  style: const TextStyle(
                    color: ink,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Progress bar (40 weeks)
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 7,
              backgroundColor: const Color(0xFFF0EBE2),
              valueColor: const AlwaysStoppedAnimation<Color>(primary),
            ),
          ),
          const SizedBox(height: 14),

          // Fruit / Baby size row & development highlight
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: const Color(0xFFF9F7F4),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: line),
                ),
                child: Center(
                  child: Text(
                    milestone.emoji,
                    style: const TextStyle(fontSize: 22),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Baby is the size of a ${milestone.fruit.toLowerCase()} (~${milestone.lengthCm.toStringAsFixed(1)} cm)',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      milestone.highlight,
                      style: const TextStyle(
                        fontSize: 12,
                        color: muted,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: line),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Center(
              child: Icon(Icons.favorite_rounded, color: primary, size: 22),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Track Baby’s Milestones',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  'Add your estimated due date in your profile to view weekly growth comparisons.',
                  style: TextStyle(fontSize: 12, color: muted, height: 1.3),
                ),
                if (onSetDueDate != null) ...[
                  const SizedBox(height: 8),
                  GestureDetector(
                    onTap: onSetDueDate,
                    child: const Text(
                      'Set due date →',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: primary,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  DateTime? _parseDate(String? s) {
    if (s == null || s.trim().isEmpty) return null;
    try {
      return DateTime.parse(s.trim());
    } catch (_) {
      return null;
    }
  }
}
