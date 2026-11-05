import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../core/api_client.dart';
import 'checkin_repository.dart';

enum CheckinStep { symptoms, checklist, done }
enum CheckinStage { loading, ready, submitting, error }

class UserAnswer {
  UserAnswer({
    this.value,
    this.notes = '',
    this.text = '',
  });

  String? value; // 'yes' | 'no' | null
  String notes;  // details if value == 'yes'
  String text;   // text response if response_type == 'text'

  bool isComplete(QuestionTemplate q) {
    if (q.isText) {
      return text.trim().isNotEmpty;
    }
    return value == 'yes' || value == 'no';
  }
}

class CheckinController extends ChangeNotifier {
  CheckinController({
    required this.repo,
    required this.appointmentId,
  });

  final CheckinRepository repo;
  final String appointmentId;

  CheckinStep step = CheckinStep.symptoms;
  CheckinStage stage = CheckinStage.loading;
  String? errorMessage;

  List<QuestionTemplate> questions = [];
  final Map<String, UserAnswer> answers = {};
  List<ChecklistItem> checklist = [];

  bool get isLoading => stage == CheckinStage.loading;
  bool get isSubmitting => stage == CheckinStage.submitting;

  /// True if every question has been answered.
  bool get allSymptomsAnswered {
    if (questions.isEmpty) return true;
    return questions.every((q) {
      final ans = answers[q.id];
      return ans != null && ans.isComplete(q);
    });
  }

  Future<void> load() async {
    stage = CheckinStage.loading;
    errorMessage = null;
    notifyListeners();

    try {
      // Best-effort report sharing in background
      unawaited(repo.shareAllReports(appointmentId));

      final results = await Future.wait([
        repo.getQuestions(appointmentId),
        repo.getPreviousResponses(appointmentId),
        repo.getChecklist(appointmentId),
      ]);

      questions = results[0] as List<QuestionTemplate>;
      final prevResponses = results[1] as List<Map<String, dynamic>>;
      checklist = results[2] as List<ChecklistItem>;

      // Initialize answers map for each question
      for (final q in questions) {
        answers[q.id] = UserAnswer();
      }

      // Prefill with previous answers if available
      for (final row in prevResponses) {
        final templateId = row['template_id'] as String?;
        if (templateId != null && answers.containsKey(templateId)) {
          final isText = row['answer_text'] != null;
          if (isText) {
            answers[templateId]!.text = row['answer_text'] as String;
          } else if (row['answer'] != null) {
            answers[templateId]!.value = (row['answer'] == true) ? 'yes' : 'no';
            answers[templateId]!.notes = (row['detail'] as String?) ?? '';
          }
        }
      }

      stage = CheckinStage.ready;
    } catch (e) {
      errorMessage = e is AppException ? e.message : 'Could not load check-in details.';
      stage = CheckinStage.error;
    }
    notifyListeners();
  }

  void setYesNo(String templateId, String val) {
    final ans = answers.putIfAbsent(templateId, UserAnswer.new);
    ans.value = val;
    notifyListeners();
  }

  void setNotes(String templateId, String notes) {
    final ans = answers.putIfAbsent(templateId, UserAnswer.new);
    ans.notes = notes;
    notifyListeners();
  }

  void setText(String templateId, String text) {
    final ans = answers.putIfAbsent(templateId, UserAnswer.new);
    ans.text = text;
    notifyListeners();
  }

  /// Saves symptoms and advances to checklist.
  Future<void> saveSymptomsAndContinue() async {
    if (!allSymptomsAnswered || isSubmitting) return;

    stage = CheckinStage.submitting;
    errorMessage = null;
    notifyListeners();

    try {
      if (questions.isNotEmpty) {
        final responsesToSubmit = <QuestionResponseAnswer>[];
        for (final q in questions) {
          final ans = answers[q.id]!;
          if (q.isText) {
            responsesToSubmit.add(
              QuestionResponseAnswer(templateId: q.id, text: ans.text),
            );
          } else {
            final isYes = ans.value == 'yes';
            responsesToSubmit.add(
              QuestionResponseAnswer(
                templateId: q.id,
                answer: isYes,
                detail: isYes ? ans.notes : null,
              ),
            );
          }
        }
        await repo.saveResponses(appointmentId, responsesToSubmit);
      }
      step = CheckinStep.checklist;
      stage = CheckinStage.ready;
    } catch (e) {
      errorMessage = e is AppException ? e.message : 'Could not save your answers. Please try again.';
      stage = CheckinStage.ready;
    }
    notifyListeners();
  }

  /// Optimistically toggle a checklist item.
  Future<void> toggleChecklistItem(ChecklistItem item) async {
    final nextState = !item.isCompleted;
    final index = checklist.indexWhere((i) => i.id == item.id);
    if (index == -1) return;

    // Optimistic update
    checklist[index] = item.copyWith(isCompleted: nextState);
    notifyListeners();

    try {
      await repo.toggleChecklistItem(item.id, nextState);
    } catch (_) {
      // Rollback on failure
      checklist[index] = item.copyWith(isCompleted: !nextState);
      notifyListeners();
    }
  }

  /// Submits the final check-in, updating appointment status to 'checked_in'.
  Future<void> completeCheckin() async {
    if (isSubmitting) return;

    stage = CheckinStage.submitting;
    errorMessage = null;
    notifyListeners();

    try {
      await repo.completeCheckin(appointmentId);
      step = CheckinStep.done;
      stage = CheckinStage.ready;
    } catch (e) {
      errorMessage = e is AppException ? e.message : 'Could not complete check-in. Please try again.';
      stage = CheckinStage.ready;
    }
    notifyListeners();
  }

  void backToSymptoms() {
    step = CheckinStep.symptoms;
    notifyListeners();
  }
}

