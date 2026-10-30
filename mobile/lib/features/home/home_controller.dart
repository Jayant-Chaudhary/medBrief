import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api_client.dart';
import '../auth/auth_repository.dart';
import 'appointment_repository.dart';

enum HomeStage { loading, ready, error }

/// State machine for the patient home screen.
///
/// Loads appointments + vitals in parallel. Exposes helpers that the UI calls
/// to log vitals, select an appointment, and refresh without re-logging in.
class HomeController extends ChangeNotifier {
  HomeController({required this.repo, required this.profile});

  final AppointmentRepository repo;
  final PatientProfile profile;

  HomeStage stage = HomeStage.loading;
  String? error;

  AppointmentSet _appointments = AppointmentSet.empty();
  LatestVitals _vitals = const LatestVitals();
  String? _selectedId;

  bool _saving = false;
  String? _saveError;

  AppointmentSet get appointments => _appointments;
  LatestVitals get vitals => _vitals;
  bool get saving => _saving;
  String? get saveError => _saveError;

  /// The appointment the action banner and vitals act on.
  Appointment? get activeAppointment =>
      _appointments.all.where((a) => a.id == _selectedId).firstOrNull;

  Future<void> load() async {
    stage = HomeStage.loading;
    error = null;
    notifyListeners();
    try {
      final results = await Future.wait([
        repo.getAppointments(),
        repo.getLatestVitals().catchError((_) => const LatestVitals()),
      ]);
      _appointments = results[0] as AppointmentSet;
      _vitals = results[1] as LatestVitals;
      // Auto-select the first upcoming appointment if nothing is selected yet.
      _selectedId ??=
          _appointments.upcoming.firstOrNull?.id ?? _appointments.all.firstOrNull?.id;
      stage = HomeStage.ready;
    } catch (e) {
      error = e is AppException ? e.message : 'Could not load your appointments.';
      stage = HomeStage.error;
    }
    notifyListeners();
  }

  void selectAppointment(String id) {
    _selectedId = id;
    notifyListeners();
  }

  /// Log weight (kg) and optionally blood pressure.
  Future<void> logVitals({
    double? weight,
    double? bpSystolic,
    double? bpDiastolic,
    bool logWeight = true,
  }) async {
    if (_saving) return;
    _saving = true;
    _saveError = null;
    notifyListeners();

    try {
      final apptId = _selectedId;
      final futures = <Future<void>>[];

      if (logWeight && weight != null) {
        futures.add(
          repo.logVital(
            metricKey: 'weight',
            value: weight,
            unit: 'kg',
            appointmentId: apptId,
          ),
        );
      }
      if (bpSystolic != null) {
        futures.add(
          repo.logVital(
            metricKey: 'blood_pressure_systolic',
            value: bpSystolic,
            unit: 'mmHg',
            appointmentId: apptId,
          ),
        );
      }
      if (bpDiastolic != null) {
        futures.add(
          repo.logVital(
            metricKey: 'blood_pressure_diastolic',
            value: bpDiastolic,
            unit: 'mmHg',
            appointmentId: apptId,
          ),
        );
      }

      await Future.wait(futures);
      // Reload vitals to reflect the new readings.
      _vitals = await repo.getLatestVitals().catchError((_) => _vitals);
    } catch (e) {
      _saveError =
          e is AppException ? e.message : 'Could not save your vitals. Please try again.';
    } finally {
      _saving = false;
      notifyListeners();
    }
  }

  /// Refresh everything (pull-to-refresh).
  Future<void> refresh() => load();
}

