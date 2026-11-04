// Models for longitudinal prenatal check-in and AI pre-visit clinical briefs.

class CheckinAnswerPayload {
  const CheckinAnswerPayload({
    required this.category,
    required this.questionKey,
    required this.questionText,
    required this.answerType,
    this.boolValue,
    this.scaleValue,
    this.textValue,
    this.isRedFlag = false,
  });

  final String category; // 'physical' | 'mental' | 'medical' | 'concern'
  final String questionKey;
  final String questionText;
  final String answerType; // 'boolean' | 'scale' | 'text'
  final bool? boolValue;
  final int? scaleValue;
  final String? textValue;
  final bool isRedFlag;

  Map<String, dynamic> toJson() => {
    'category': category,
    'questionKey': questionKey,
    'questionText': questionText,
    'answerType': answerType,
    if (boolValue != null) 'boolValue': boolValue,
    if (scaleValue != null) 'scaleValue': scaleValue,
    if (textValue != null && textValue!.isNotEmpty) 'textValue': textValue,
    'isRedFlag': isRedFlag,
  };
}

class CheckinSessionResult {
  const CheckinSessionResult({
    required this.id,
    required this.status,
    required this.hasRedFlag,
    this.appointmentId,
    this.sessionType = 'routine_weekly',
    this.gestationalWeek,
    this.completedAt,
  });

  factory CheckinSessionResult.fromJson(Map<String, dynamic> json) {
    final session = json['session'] as Map<String, dynamic>? ?? json;
    return CheckinSessionResult(
      id: session['id'] as String? ?? '',
      status: session['status'] as String? ?? 'completed',
      hasRedFlag:
          json['hasRedFlag'] == true || session['status'] == 'flagged_urgent',
      appointmentId: session['appointment_id'] as String?,
      sessionType: session['session_type'] as String? ?? 'routine_weekly',
      gestationalWeek: (session['gestational_week'] as num?)?.toInt(),
      completedAt: session['completed_at'] != null
          ? DateTime.tryParse(session['completed_at'] as String)
          : null,
    );
  }

  final String id;
  final String status;
  final bool hasRedFlag;
  final String? appointmentId;
  final String sessionType;
  final int? gestationalWeek;
  final DateTime? completedAt;

  bool get isUrgent => status == 'flagged_urgent' || hasRedFlag;
}

class CheckinCadenceStatus {
  const CheckinCadenceStatus({
    this.lastCheckinDate,
    this.lastSessionType,
    this.daysSinceLastCheckin,
    this.nextDueType = 'routine_weekly',
    this.isWeeklyDue = true,
    this.isQuickPulseDue = true,
    this.nextDueInDays = 0,
    this.totalCompleted = 0,
  });

  factory CheckinCadenceStatus.fromJson(Map<String, dynamic> json) =>
      CheckinCadenceStatus(
        lastCheckinDate: json['lastCheckinDate'] != null
            ? DateTime.tryParse(json['lastCheckinDate'] as String)
            : null,
        lastSessionType: json['lastSessionType'] as String?,
        daysSinceLastCheckin: (json['daysSinceLastCheckin'] as num?)?.toInt(),
        nextDueType: json['nextDueType'] as String? ?? 'routine_weekly',
        isWeeklyDue: json['isWeeklyDue'] == true,
        isQuickPulseDue: json['isQuickPulseDue'] == true,
        nextDueInDays: (json['nextDueInDays'] as num?)?.toInt() ?? 0,
        totalCompleted: (json['totalCompleted'] as num?)?.toInt() ?? 0,
      );

  final DateTime? lastCheckinDate;
  final String? lastSessionType;
  final int? daysSinceLastCheckin;
  final String nextDueType; // 'routine_weekly' | 'quick_pulse' | 'none'
  final bool isWeeklyDue;
  final bool isQuickPulseDue;
  final int nextDueInDays;
  final int totalCompleted;

  bool get isDue => isWeeklyDue || isQuickPulseDue;
}

class VisitAiSummary {
  const VisitAiSummary({
    required this.id,
    required this.appointmentId,
    required this.clinicalRiskLevel,
    required this.redFlags,
    required this.mentalHealthAssessment,
    required this.physicalSymptomTrajectory,
    required this.medicationCompliance,
    required this.patientTopQuestions,
    required this.doctorTalkingPoints,
    this.intervalStart,
    this.intervalEnd,
    this.intervalDescription,
    this.generatedAt,
  });

  factory VisitAiSummary.fromJson(Map<String, dynamic> json) => VisitAiSummary(
    id: json['id'] as String? ?? '',
    appointmentId: json['appointment_id'] as String? ?? '',
    clinicalRiskLevel: json['clinical_risk_level'] as String? ?? 'low',
    redFlags: (json['red_flags'] as List<dynamic>?)
            ?.map((e) => e.toString())
            .toList() ??
        const [],
    mentalHealthAssessment: json['mental_health_assessment'] as String? ?? '',
    physicalSymptomTrajectory:
        json['physical_symptom_trajectory'] as String? ?? '',
    medicationCompliance: json['medication_compliance'] as String? ?? '',
    patientTopQuestions: (json['patient_top_questions'] as List<dynamic>?)
            ?.map((e) => e.toString())
            .toList() ??
        const [],
    doctorTalkingPoints: json['doctor_talking_points'] as String? ?? '',
    intervalStart: json['interval_start'] != null
        ? DateTime.tryParse(json['interval_start'] as String)
        : null,
    intervalEnd: json['interval_end'] != null
        ? DateTime.tryParse(json['interval_end'] as String)
        : null,
    intervalDescription: json['interval_description'] as String?,
    generatedAt: json['generated_at'] != null
        ? DateTime.tryParse(json['generated_at'] as String)
        : null,
  );

  final String id;
  final String appointmentId;
  final String clinicalRiskLevel;
  final List<String> redFlags;
  final String mentalHealthAssessment;
  final String physicalSymptomTrajectory;
  final String medicationCompliance;
  final List<String> patientTopQuestions;
  final String doctorTalkingPoints;
  final DateTime? intervalStart;
  final DateTime? intervalEnd;
  final String? intervalDescription;
  final DateTime? generatedAt;

  bool get hasRedFlags =>
      redFlags.isNotEmpty ||
      clinicalRiskLevel == 'urgent' ||
      clinicalRiskLevel == 'high';
}
