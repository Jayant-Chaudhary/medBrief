import 'package:flutter/foundation.dart';
import '../../core/api_client.dart';
import 'report_repository.dart';

enum ReportStage { loading, ready, uploading, error }

class ReportController extends ChangeNotifier {
  ReportController({required this.repo});

  final ReportRepository repo;

  ReportStage stage = ReportStage.loading;
  List<LabReport> reports = [];
  String? errorMessage;
  String? message;

  bool get isLoading => stage == ReportStage.loading;
  bool get isUploading => stage == ReportStage.uploading;

  Future<void> load() async {
    stage = ReportStage.loading;
    errorMessage = null;
    notifyListeners();

    try {
      reports = await repo.getReports();
      stage = ReportStage.ready;
    } catch (e) {
      errorMessage = e is AppException ? e.message : 'Could not load your reports.';
      stage = ReportStage.error;
    }
    notifyListeners();
  }

  Future<bool> uploadReport({
    required List<int> bytes,
    required String filename,
    String? appointmentId,
  }) async {
    stage = ReportStage.uploading;
    errorMessage = null;
    message = null;
    notifyListeners();

    try {
      final res = await repo.uploadReport(
        bytes: bytes,
        filename: filename,
        appointmentId: appointmentId,
      );

      final metrics = (res['metrics'] as List?)?.length ?? 0;
      message = metrics > 0
          ? 'Report added — $metrics value${metrics == 1 ? '' : 's'} read from it.'
          : 'Report added. Doctor will review the original file.';

      await load();
      return true;
    } catch (e) {
      errorMessage = e is AppException ? e.message : 'Failed to upload report.';
      stage = ReportStage.ready;
      notifyListeners();
      return false;
    }
  }

  Future<void> toggleShare(
    LabReport report,
    String appointmentId,
    bool shouldShare,
  ) async {
    final previous = List<String>.from(report.sharedAppointmentIds);
    final next = shouldShare
        ? [...previous, appointmentId]
        : previous.where((id) => id != appointmentId).toList();

    // Optimistic UI update
    final index = reports.indexWhere((r) => r.id == report.id);
    if (index != -1) {
      reports[index] = report.copyWith(sharedAppointmentIds: next);
      notifyListeners();
    }

    try {
      if (shouldShare) {
        await repo.shareWithAppointment(report.id, appointmentId);
      } else {
        await repo.unshareFromAppointment(report.id, appointmentId);
      }
    } catch (e) {
      // Rollback on failure
      if (index != -1) {
        reports[index] = report.copyWith(sharedAppointmentIds: previous);
      }
      errorMessage = e is AppException ? e.message : 'Could not update sharing.';
      notifyListeners();
    }
  }

  Future<bool> removeReport(String reportId) async {
    final prevReports = List<LabReport>.from(reports);
    reports.removeWhere((r) => r.id == reportId);
    notifyListeners();

    try {
      await repo.removeReport(reportId);
      message = 'Report removed.';
      notifyListeners();
      return true;
    } catch (e) {
      reports = prevReports;
      errorMessage = e is AppException ? e.message : 'Could not remove report.';
      notifyListeners();
      return false;
    }
  }

  void clearMessage() {
    message = null;
    errorMessage = null;
    notifyListeners();
  }
}

