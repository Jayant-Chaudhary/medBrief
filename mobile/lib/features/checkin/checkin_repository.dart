import '../../core/api_client.dart';

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

class QuestionTemplate {
  const QuestionTemplate({
    required this.id,
    required this.questionText,
    required this.responseType,
    required this.isRedFlagTrigger,
    this.sortOrder = 0,
  });

  factory QuestionTemplate.fromJson(Map<String, dynamic> json) => QuestionTemplate(
    id: json['id'] as String,
    questionText: json['question_text'] as String,
    responseType: json['response_type'] as String? ?? 'yes_no',
    isRedFlagTrigger: json['is_red_flag_trigger'] == true,
    sortOrder: (json['sort_order'] as num?)?.toInt() ?? 0,
  );

  final String id;
  final String questionText;
  final String responseType; // 'yes_no' | 'text'
  final bool isRedFlagTrigger;
  final int sortOrder;

  bool get isText => responseType == 'text';
}

class QuestionResponseAnswer {
  const QuestionResponseAnswer({
    required this.templateId,
    this.answer,
    this.detail,
    this.text,
  });

  final String templateId;
  final bool? answer;
  final String? detail;
  final String? text;

  Map<String, dynamic> toJson() {
    if (text != null) {
      return {'templateId': templateId, 'text': text!.trim()};
    }
    return {
      'templateId': templateId,
      'answer': answer ?? false,
      if (detail != null && detail!.trim().isNotEmpty) 'detail': detail!.trim(),
    };
  }
}

class ChecklistItem {
  const ChecklistItem({
    required this.id,
    required this.label,
    required this.source,
    required this.isCompleted,
    this.appointmentId,
  });

  factory ChecklistItem.fromJson(Map<String, dynamic> json) => ChecklistItem(
    id: json['id'] as String,
    label: json['label'] as String,
    source: json['source'] as String? ?? 'static',
    isCompleted: json['is_completed'] == true,
    appointmentId: json['appointment_id'] as String?,
  );

  final String id;
  final String label;
  final String source; // 'static' | 'ai_generated'
  final bool isCompleted;
  final String? appointmentId;

  bool get isAiGenerated => source == 'ai_generated';

  ChecklistItem copyWith({bool? isCompleted}) => ChecklistItem(
    id: id,
    label: label,
    source: source,
    isCompleted: isCompleted ?? this.isCompleted,
    appointmentId: appointmentId,
  );
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

class CheckinRepository {
  const CheckinRepository({this.api});
  final ApiClient? api;

  /// The questions selected by the clinician for this appointment.
  Future<List<QuestionTemplate>> getQuestions(String appointmentId) async {
    final client = api;
    if (client == null) return const [];
    final res = await client.request('/api/questionnaire/appointment/$appointmentId');
    if (res is! List) return const [];
    return res
        .cast<Map<String, dynamic>>()
        .map(QuestionTemplate.fromJson)
        .toList();
  }

  /// Any answers previously submitted for this appointment (for resuming check-in).
  Future<List<Map<String, dynamic>>> getPreviousResponses(String appointmentId) async {
    final client = api;
    if (client == null) return const [];
    final res = await client.request('/api/questionnaire/responses/$appointmentId');
    if (res is! List) return const [];
    return res.cast<Map<String, dynamic>>();
  }

  /// Save answers to the symptoms questionnaire.
  Future<void> saveResponses(
    String appointmentId,
    List<QuestionResponseAnswer> responses,
  ) async {
    final client = api;
    if (client == null || responses.isEmpty) return;
    await client.request(
      '/api/questionnaire/responses',
      method: 'POST',
      body: {
        'appointmentId': appointmentId,
        'responses': responses.map((r) => r.toJson()).toList(),
      },
    );
  }

  /// Pre-visit checklist items for the appointment.
  Future<List<ChecklistItem>> getChecklist(String appointmentId) async {
    final client = api;
    if (client == null) return const [];
    final res = await client.request('/api/checklist/$appointmentId');
    if (res is! List) return const [];
    return res
        .cast<Map<String, dynamic>>()
        .map(ChecklistItem.fromJson)
        .toList();
  }

  /// Toggle an individual checklist item.
  Future<void> toggleChecklistItem(String itemId, bool isCompleted) async {
    final client = api;
    if (client == null) return;
    await client.request(
      '/api/checklist/items/$itemId',
      method: 'PATCH',
      body: {'isCompleted': isCompleted},
    );
  }

  /// Update appointment status to 'checked_in'.
  Future<void> completeCheckin(String appointmentId) async {
    final client = api;
    if (client == null) return;
    await client.request(
      '/api/appointments/$appointmentId/status',
      method: 'PATCH',
      body: {'status': 'checked_in'},
    );
  }

  /// Best-effort sharing of all prior patient lab reports with this visit.
  Future<void> shareAllReports(String appointmentId) async {
    final client = api;
    if (client == null) return;
    try {
      await client.request(
        '/api/lab-reports/share-all',
        method: 'POST',
        body: {'appointmentId': appointmentId},
      );
    } catch (_) {
      // Best-effort; do not block the patient if this fails
    }
  }
}

