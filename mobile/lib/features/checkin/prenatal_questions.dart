enum CheckinDimension { physical, mental, medical, agenda }

class PrenatalCheckinQuestion {
  const PrenatalCheckinQuestion({
    required this.key,
    required this.dimension,
    required this.title,
    required this.prompt,
    required this.answerType,
    this.isRedFlagTrigger = false,
    this.flagIfTrue = true,
    this.minWeek,
    this.maxWeek,
    this.scaleMinLabel = 'Low',
    this.scaleMaxLabel = 'High',
  });

  final String key;
  final CheckinDimension dimension;
  final String title;
  final String prompt;
  final String answerType; // 'boolean' | 'scale' | 'text'
  final bool isRedFlagTrigger;
  final bool flagIfTrue;
  final int? minWeek;
  final int? maxWeek;
  final String scaleMinLabel;
  final String scaleMaxLabel;

  bool isApplicable(int? gestationalWeek) {
    if (gestationalWeek == null) return true;
    if (minWeek != null && gestationalWeek < minWeek!) return false;
    if (maxWeek != null && gestationalWeek > maxWeek!) return false;
    return true;
  }
}

/// Clinical questions bank for prenatal check-ins.
class PrenatalQuestionsBank {
  static const List<PrenatalCheckinQuestion> allQuestions = [
    // ── Physical / Obstetric ────────────────────────────────────────────────
    PrenatalCheckinQuestion(
      key: 'fetal_movement',
      dimension: CheckinDimension.physical,
      title: "Baby's Movements",
      prompt:
          'Are you feeling your baby move and kick regularly throughout the day?',
      answerType: 'boolean',
      isRedFlagTrigger: true,
      flagIfTrue: false, // "No" is a red flag!
      minWeek: 24,
    ),
    PrenatalCheckinQuestion(
      key: 'severe_headache_vision',
      dimension: CheckinDimension.physical,
      title: 'Headache & Vision',
      prompt:
          'Have you experienced a persistent, severe headache that does not ease with rest, or visual spots/blurriness?',
      answerType: 'boolean',
      isRedFlagTrigger: true,
      flagIfTrue: true,
    ),
    PrenatalCheckinQuestion(
      key: 'bleeding_fluid_leak',
      dimension: CheckinDimension.physical,
      title: 'Bleeding or Fluid Leakage',
      prompt:
          'Have you noticed any vaginal bleeding, sudden spotting, or watery fluid leaking?',
      answerType: 'boolean',
      isRedFlagTrigger: true,
      flagIfTrue: true,
    ),
    PrenatalCheckinQuestion(
      key: 'sudden_swelling',
      dimension: CheckinDimension.physical,
      title: 'Sudden Swelling',
      prompt:
          'Have you noticed sudden puffiness or swelling in your face, fingers, or hands?',
      answerType: 'boolean',
      isRedFlagTrigger: true,
      flagIfTrue: true,
      minWeek: 20,
    ),
    PrenatalCheckinQuestion(
      key: 'contractions_cramping',
      dimension: CheckinDimension.physical,
      title: 'Contractions or Cramps',
      prompt:
          'Are you experiencing painful contractions, intense cramps, or tightenings occurring regularly (more than 4 in an hour)?',
      answerType: 'boolean',
      isRedFlagTrigger: true,
      flagIfTrue: true,
      minWeek: 22,
    ),

    // ── Mental / Emotional ──────────────────────────────────────────────────
    PrenatalCheckinQuestion(
      key: 'mood_positivity',
      dimension: CheckinDimension.mental,
      title: 'Emotional Well-Being',
      prompt:
          'Over the past week, how has your mood and emotional resilience been?',
      answerType: 'scale',
      scaleMinLabel: 'Struggling / Low',
      scaleMaxLabel: 'Calm & Positive',
    ),
    PrenatalCheckinQuestion(
      key: 'anxiety_overwhelmed',
      dimension: CheckinDimension.mental,
      title: 'Anxiety & Worry',
      prompt:
          'Have you felt anxious, panicked, or excessively worried without a clear reason?',
      answerType: 'scale',
      scaleMinLabel: 'Not at all',
      scaleMaxLabel: 'Constantly / Severe',
    ),
    PrenatalCheckinQuestion(
      key: 'sleep_restfulness',
      dimension: CheckinDimension.mental,
      title: 'Sleep Quality',
      prompt:
          'How has your sleep quality been lately (apart from regular bathroom visits)?',
      answerType: 'scale',
      scaleMinLabel: 'Severe Insomnia',
      scaleMaxLabel: 'Deep & Restful',
    ),

    // ── Medical / Daily Routine ─────────────────────────────────────────────
    PrenatalCheckinQuestion(
      key: 'prenatal_supplements',
      dimension: CheckinDimension.medical,
      title: 'Prenatal Vitamins',
      prompt:
          'Have you taken your daily prenatal vitamins, iron, and prescribed supplements as instructed?',
      answerType: 'boolean',
      isRedFlagTrigger: false,
    ),
    PrenatalCheckinQuestion(
      key: 'dizziness_breathlessness',
      dimension: CheckinDimension.medical,
      title: 'Dizziness & Breathlessness',
      prompt:
          'Have you experienced severe lightheadedness upon standing or unusual breathlessness at rest?',
      answerType: 'boolean',
      isRedFlagTrigger: true,
      flagIfTrue: true,
    ),

    // ── Doctor Agenda ───────────────────────────────────────────────────────
    PrenatalCheckinQuestion(
      key: 'patient_agenda',
      dimension: CheckinDimension.agenda,
      title: 'Questions for Your Doctor',
      prompt:
          'What is the #1 question or concern you want to make sure your doctor addresses at your next visit?',
      answerType: 'text',
    ),
  ];

  static List<PrenatalCheckinQuestion> forGestationalWeek(int? week) {
    return allQuestions.where((q) => q.isApplicable(week)).toList();
  }
}

