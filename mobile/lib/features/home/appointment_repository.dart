import '../../core/api_client.dart';

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

/// One appointment returned by GET /api/appointments.
class Appointment {
  const Appointment({
    required this.id,
    required this.status,
    required this.scheduledAt,
    this.clinicianName,
  });

  factory Appointment.fromJson(Map<String, dynamic> json) => Appointment(
    id: json['id'] as String,
    status: json['status'] as String? ?? 'active',
    scheduledAt: DateTime.parse(json['scheduled_at'] as String),
    clinicianName: (json['clinician'] as Map<String, dynamic>?)?['full_name']
        as String?,
  );

  final String id;
  final String status;
  final DateTime scheduledAt;
  final String? clinicianName;

  bool get isUpcoming =>
      status == 'invited' || status == 'active' || status == 'checked_in';
  bool get isPast => status == 'completed' || status == 'cancelled';
}

/// Grouped appointment list, mirroring patientService.getAppointments() on web.
class AppointmentSet {
  const AppointmentSet({
    required this.all,
    required this.upcoming,
    required this.past,
  });

  factory AppointmentSet.empty() => const AppointmentSet(
    all: [],
    upcoming: [],
    past: [],
  );

  final List<Appointment> all;
  final List<Appointment> upcoming;
  final List<Appointment> past;
}

/// One vitals reading. GET /api/vitals returns newest-first; we keep the first
/// occurrence of each metric_key, matching getLatestVitals() on the web client.
class VitalReading {
  const VitalReading({
    required this.metricKey,
    required this.value,
    this.unit,
    required this.recordedAt,
  });

  factory VitalReading.fromJson(Map<String, dynamic> json) => VitalReading(
    metricKey: json['metric_key'] as String,
    value: double.tryParse(json['value']?.toString() ?? '') ?? 0,
    unit: json['unit'] as String?,
    recordedAt: DateTime.parse(json['recorded_at'] as String),
  );

  final String metricKey;
  final double value;
  final String? unit;
  final DateTime recordedAt;
}

/// Latest reading per metric_key. Null means no data yet.
class LatestVitals {
  const LatestVitals({this.weight, this.bpSystolic, this.bpDiastolic});

  final VitalReading? weight;
  final VitalReading? bpSystolic;
  final VitalReading? bpDiastolic;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

class AppointmentRepository {
  const AppointmentRepository({this.api});
  final ApiClient? api;

  Future<AppointmentSet> getAppointments() async {
    final client = api;
    if (client == null) return AppointmentSet.empty();

    final raw = await client.request('/api/appointments');
    final list = (raw as List)
        .cast<Map<String, dynamic>>()
        .map(Appointment.fromJson)
        .toList();

    // Newest first for display; upcoming sorted ascending (soonest first).
    final sorted = [...list]
      ..sort((a, b) => b.scheduledAt.compareTo(a.scheduledAt));
    final upcoming = sorted.where((a) => a.isUpcoming).toList()
      ..sort((a, b) => a.scheduledAt.compareTo(b.scheduledAt));
    final past = sorted.where((a) => a.isPast).toList();

    return AppointmentSet(all: sorted, upcoming: upcoming, past: past);
  }

  Future<LatestVitals> getLatestVitals() async {
    final client = api;
    if (client == null) return const LatestVitals();

    final raw = await client.request('/api/vitals');
    final rows = (raw as List).cast<Map<String, dynamic>>();

    final seen = <String, VitalReading>{};
    for (final row in rows) {
      final key = row['metric_key'] as String;
      if (!seen.containsKey(key)) {
        seen[key] = VitalReading.fromJson(row);
      }
    }

    return LatestVitals(
      weight: seen['weight'],
      bpSystolic: seen['blood_pressure_systolic'],
      bpDiastolic: seen['blood_pressure_diastolic'],
    );
  }

  /// Log a single vital. [appointmentId] may be null.
  Future<void> logVital({
    required String metricKey,
    required double value,
    required String unit,
    String? appointmentId,
  }) async {
    final client = api;
    if (client == null) return;

    await client.request(
      '/api/vitals',
      method: 'POST',
      body: {
        'metricKey': metricKey,
        'value': value,
        'unit': unit,
        '?appointmentId': appointmentId,
      },
    );
  }

  /// Patient-settable status update (only 'checked_in' is allowed).
  Future<void> updateStatus(String appointmentId, String status) async {
    final client = api;
    if (client == null) return;

    await client.request(
      '/api/appointments/$appointmentId/status',
      method: 'PATCH',
      body: {'status': status},
    );
  }
}
