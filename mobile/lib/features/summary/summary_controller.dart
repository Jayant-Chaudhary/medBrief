import 'package:flutter/foundation.dart';
import '../../core/api_client.dart';
import 'summary_repository.dart';

export 'summary_repository.dart';

class SummaryController extends ChangeNotifier {
  SummaryController({required this.repo});

  final SummaryRepository repo;

  String? selectedAppointmentId;
  PostVisitSummary? summary;
  bool isLoading = false;
  String? errorMessage;

  Future<void> selectAppointment(String appointmentId) async {
    selectedAppointmentId = appointmentId;
    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      summary = await repo.getVisitSummary(appointmentId);
    } catch (e) {
      errorMessage = e is AppException ? e.message : 'Could not load visit summary.';
      summary = null;
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<void> toggleActionItem(ActionItem item) async {
    final current = summary;
    if (current == null) return;

    final nextState = !item.isCompleted;
    final updatedList = current.actionItems
        .map((i) => i.id == item.id ? i.copyWith(isCompleted: nextState) : i)
        .toList();

    // Optimistic update
    summary = current.copyWith(actionItems: updatedList);
    notifyListeners();

    try {
      await repo.toggleNextStep(item.id, nextState);
    } catch (e) {
      // Rollback on failure
      final rolledBack = current.actionItems
          .map((i) => i.id == item.id ? i.copyWith(isCompleted: !nextState) : i)
          .toList();
      summary = current.copyWith(actionItems: rolledBack);
      errorMessage = e is AppException ? e.message : 'Could not update that step.';
      notifyListeners();
    }
  }
}
