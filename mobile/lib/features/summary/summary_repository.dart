import '../../core/api_client.dart';

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

class ConsultationNotes {
  const ConsultationNotes({required this.notesText});

  factory ConsultationNotes.fromJson(Map<String, dynamic> json) =>
      ConsultationNotes(
        notesText: (json['notes_text'] ?? json['notesText'] ?? '') as String,
      );

  final String notesText;
}

class Prescription {
  const Prescription({
    required this.id,
    this.typedInstructions,
    this.storagePath,
    this.signedUrl,
  });

  factory Prescription.fromJson(Map<String, dynamic> json) => Prescription(
        id: json['id'] as String,
        typedInstructions: json['typed_instructions'] as String?,
        storagePath: json['storage_path'] as String?,
        signedUrl: json['signed_url'] as String?,
      );

  final String id;
  final String? typedInstructions;
  final String? storagePath;
  final String? signedUrl;

  bool get isPdf =>
      storagePath?.toLowerCase().endsWith('.pdf') == true ||
      signedUrl?.toLowerCase().contains('.pdf') == true;
}

class ActionItem {
  const ActionItem({
    required this.id,
    required this.label,
    required this.isCompleted,
    this.appointmentId,
  });

  factory ActionItem.fromJson(Map<String, dynamic> json) => ActionItem(
        id: json['id'] as String,
        label: json['label'] as String? ?? '',
        isCompleted: json['is_completed'] == true,
        appointmentId: json['appointment_id'] as String?,
      );

  final String id;
  final String label;
  final bool isCompleted;
  final String? appointmentId;

  ActionItem copyWith({bool? isCompleted}) => ActionItem(
        id: id,
        label: label,
        isCompleted: isCompleted ?? this.isCompleted,
        appointmentId: appointmentId,
      );
}

class ConsultationChecklistItem {
  const ConsultationChecklistItem({
    required this.id,
    required this.label,
    required this.isCompleted,
  });

  factory ConsultationChecklistItem.fromJson(Map<String, dynamic> json) =>
      ConsultationChecklistItem(
        id: json['id'] as String,
        label: json['label'] as String? ?? '',
        isCompleted: json['is_completed'] == true,
      );

  final String id;
  final String label;
  final bool isCompleted;
}

class PostVisitSummary {
  const PostVisitSummary({
    required this.appointmentId,
    this.notes,
    this.prescriptions = const [],
    this.actionItems = const [],
    this.consultationChecklist = const [],
  });

  factory PostVisitSummary.fromJson(String apptId, Map<String, dynamic> json) {
    final rawNotes = json['notes'];
    final ConsultationNotes? notes = rawNotes is Map<String, dynamic>
        ? ConsultationNotes.fromJson(rawNotes)
        : null;

    final rawRx = json['prescriptions'];
    final prescriptions = rawRx is List
        ? rawRx
            .cast<Map<String, dynamic>>()
            .map(Prescription.fromJson)
            .toList()
        : <Prescription>[];

    final rawActions = json['actionItems'];
    final actionItems = rawActions is List
        ? rawActions
            .cast<Map<String, dynamic>>()
            .map(ActionItem.fromJson)
            .toList()
        : <ActionItem>[];

    final rawChecklist = json['consultationChecklist'];
    final consultationChecklist = rawChecklist is List
        ? rawChecklist
            .cast<Map<String, dynamic>>()
            .map(ConsultationChecklistItem.fromJson)
            .toList()
        : <ConsultationChecklistItem>[];

    return PostVisitSummary(
      appointmentId: apptId,
      notes: notes,
      prescriptions: prescriptions,
      actionItems: actionItems,
      consultationChecklist: consultationChecklist,
    );
  }

  final String appointmentId;
  final ConsultationNotes? notes;
  final List<Prescription> prescriptions;
  final List<ActionItem> actionItems;
  final List<ConsultationChecklistItem> consultationChecklist;

  PostVisitSummary copyWith({
    List<ActionItem>? actionItems,
  }) =>
      PostVisitSummary(
        appointmentId: appointmentId,
        notes: notes,
        prescriptions: prescriptions,
        actionItems: actionItems ?? this.actionItems,
        consultationChecklist: consultationChecklist,
      );
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

class SummaryRepository {
  const SummaryRepository({this.api});
  final ApiClient? api;

  Future<PostVisitSummary?> getVisitSummary(String appointmentId) async {
    final client = api;
    if (client == null) return null;
    final res = await client.request('/api/post-visit/$appointmentId');
    if (res is! Map<String, dynamic>) return null;
    return PostVisitSummary.fromJson(appointmentId, res);
  }

  Future<void> toggleNextStep(String itemId, bool isCompleted) async {
    final client = api;
    if (client == null) return;
    await client.request(
      '/api/post-visit/action-items/$itemId',
      method: 'PATCH',
      body: {'isCompleted': isCompleted},
    );
  }
}

