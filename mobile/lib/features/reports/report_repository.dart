import '../../core/api_client.dart';

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

class LabReportMetric {
  const LabReportMetric({
    required this.id,
    required this.rawKey,
    this.standardKey,
    this.rawValue,
    this.parsedValue,
    this.reviewedValue,
    this.unitRaw,
    this.unitStandard,
    this.confidence,
    this.needsReview = false,
    this.displayName,
    this.category,
  });

  factory LabReportMetric.fromJson(Map<String, dynamic> json) {
    final dict = json['metric_dictionary'] as Map<String, dynamic>?;
    return LabReportMetric(
      id: json['id'] as String,
      rawKey: json['raw_key'] as String? ?? 'Unknown',
      standardKey: json['standard_key'] as String?,
      rawValue: json['raw_value']?.toString(),
      parsedValue: json['parsed_value'] as num?,
      reviewedValue: json['reviewed_value'] as num?,
      unitRaw: json['unit_raw'] as String?,
      unitStandard: json['unit_standard'] as String?,
      confidence: json['confidence'] as num?,
      needsReview: json['needs_review'] == true,
      displayName: dict?['display_name'] as String?,
      category: dict?['category'] as String?,
    );
  }

  final String id;
  final String rawKey;
  final String? standardKey;
  final String? rawValue;
  final num? parsedValue;
  final num? reviewedValue;
  final String? unitRaw;
  final String? unitStandard;
  final num? confidence;
  final bool needsReview;
  final String? displayName;
  final String? category;

  String get label => displayName ?? standardKey ?? rawKey;
  String get displayValue => (reviewedValue ?? parsedValue ?? rawValue ?? '—').toString();
  String get displayUnit => unitStandard ?? unitRaw ?? '';
}

class LabReport {
  const LabReport({
    required this.id,
    this.patientId,
    this.appointmentId,
    this.storagePath,
    this.reportDate,
    this.ocrStatus = 'uploaded',
    this.rawOcrPayload,
    this.signedUrl,
    this.sharedAppointmentIds = const [],
    this.uploadedAt,
    this.metrics = const [],
  });

  factory LabReport.fromJson(Map<String, dynamic> json) {
    final rawShared = json['shared_appointment_ids'];
    final sharedList = rawShared is List
        ? rawShared.map((e) => e.toString()).toList()
        : <String>[];

    final rawMetrics = json['lab_report_metrics'];
    final metricsList = rawMetrics is List
        ? rawMetrics
            .cast<Map<String, dynamic>>()
            .map(LabReportMetric.fromJson)
            .toList()
        : <LabReportMetric>[];

    return LabReport(
      id: json['id'] as String,
      patientId: json['patient_id'] as String?,
      appointmentId: json['appointment_id'] as String?,
      storagePath: json['storage_path'] as String?,
      reportDate: json['report_date'] != null
          ? DateTime.tryParse(json['report_date'] as String)
          : null,
      ocrStatus: json['ocr_status'] as String? ?? 'uploaded',
      rawOcrPayload: json['raw_ocr_payload'] as Map<String, dynamic>?,
      signedUrl: json['signed_url'] as String?,
      sharedAppointmentIds: sharedList,
      uploadedAt: json['uploaded_at'] != null
          ? DateTime.tryParse(json['uploaded_at'] as String)
          : null,
      metrics: metricsList,
    );
  }

  final String id;
  final String? patientId;
  final String? appointmentId;
  final String? storagePath;
  final DateTime? reportDate;
  final String ocrStatus;
  final Map<String, dynamic>? rawOcrPayload;
  final String? signedUrl;
  final List<String> sharedAppointmentIds;
  final DateTime? uploadedAt;
  final List<LabReportMetric> metrics;

  bool isSharedWith(String appointmentId) =>
      sharedAppointmentIds.contains(appointmentId);

  LabReport copyWith({
    List<String>? sharedAppointmentIds,
  }) =>
      LabReport(
        id: id,
        patientId: patientId,
        appointmentId: appointmentId,
        storagePath: storagePath,
        reportDate: reportDate,
        ocrStatus: ocrStatus,
        rawOcrPayload: rawOcrPayload,
        signedUrl: signedUrl,
        sharedAppointmentIds:
            sharedAppointmentIds ?? this.sharedAppointmentIds,
        uploadedAt: uploadedAt,
        metrics: metrics,
      );
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

class ReportRepository {
  const ReportRepository({this.api});
  final ApiClient? api;

  Future<List<LabReport>> getReports() async {
    final client = api;
    if (client == null) return const [];
    final res = await client.request('/api/lab-reports');
    if (res is! List) return const [];
    return res
        .cast<Map<String, dynamic>>()
        .map(LabReport.fromJson)
        .toList();
  }

  Future<List<LabReport>> getReportsForAppointment(String appointmentId) async {
    final client = api;
    if (client == null) return const [];
    final res = await client.request('/api/lab-reports?appointmentId=$appointmentId');
    if (res is! List) return const [];
    return res
        .cast<Map<String, dynamic>>()
        .map(LabReport.fromJson)
        .toList();
  }

  Future<Map<String, dynamic>> uploadReport({
    required List<int> bytes,
    required String filename,
    String? appointmentId,
  }) async {
    final client = api;
    if (client == null) return {};
    final fields = <String, String>{};
    if (appointmentId != null) fields['appointmentId'] = appointmentId;

    final res = await client.uploadMultipart(
      '/api/lab-reports/upload',
      fieldName: 'file',
      bytes: bytes,
      filename: filename,
      fields: fields,
    );
    if (res is Map<String, dynamic>) return res;
    return {};
  }

  Future<void> shareWithAppointment(String reportId, String appointmentId) async {
    final client = api;
    if (client == null) return;
    await client.request(
      '/api/lab-reports/$reportId/share',
      method: 'POST',
      body: {'appointmentId': appointmentId},
    );
  }

  Future<void> unshareFromAppointment(String reportId, String appointmentId) async {
    final client = api;
    if (client == null) return;
    await client.request(
      '/api/lab-reports/$reportId/share/$appointmentId',
      method: 'DELETE',
    );
  }

  Future<void> removeReport(String reportId) async {
    final client = api;
    if (client == null) return;
    await client.request(
      '/api/lab-reports/$reportId',
      method: 'DELETE',
    );
  }
}

