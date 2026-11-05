// Models for Health Connect and wearable device physical metrics.
// All fields are typed, null-safe, and serializable for MedBrief server API.

class DailyDeviceMetric {
  final String metricDate; // YYYY-MM-DD
  final int? steps;
  final double? distanceMeters;
  final int? activeMinutes;
  final double? restingHeartRate;
  final int? sleepMinutes;
  final double? weightKg;
  final int? bloodPressureSystolic;
  final int? bloodPressureDiastolic;
  final double? bloodGlucoseMgDl;
  final String source;

  const DailyDeviceMetric({
    required this.metricDate,
    this.steps,
    this.distanceMeters,
    this.activeMinutes,
    this.restingHeartRate,
    this.sleepMinutes,
    this.weightKg,
    this.bloodPressureSystolic,
    this.bloodPressureDiastolic,
    this.bloodGlucoseMgDl,
    this.source = 'health_connect',
  });

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'metricDate': metricDate,
      'source': source,
    };
    if (steps != null) map['steps'] = steps;
    if (distanceMeters != null) map['distanceMeters'] = distanceMeters;
    if (activeMinutes != null) map['activeMinutes'] = activeMinutes;
    if (restingHeartRate != null) map['restingHeartRate'] = restingHeartRate;
    if (sleepMinutes != null) map['sleepMinutes'] = sleepMinutes;
    if (weightKg != null) map['weightKg'] = weightKg;
    if (bloodPressureSystolic != null) map['bloodPressureSystolic'] = bloodPressureSystolic;
    if (bloodPressureDiastolic != null) map['bloodPressureDiastolic'] = bloodPressureDiastolic;
    if (bloodGlucoseMgDl != null) map['bloodGlucoseMgDl'] = bloodGlucoseMgDl;
    return map;
  }

  factory DailyDeviceMetric.fromJson(Map<String, dynamic> json) {
    return DailyDeviceMetric(
      metricDate: json['metricDate'] as String? ?? json['metric_date'] as String? ?? '',
      steps: json['steps'] as int?,
      distanceMeters: (json['distanceMeters'] ?? json['distance_meters']) != null
          ? (json['distanceMeters'] ?? json['distance_meters'] as num).toDouble()
          : null,
      activeMinutes: (json['activeMinutes'] ?? json['active_minutes']) as int?,
      restingHeartRate: (json['restingHeartRate'] ?? json['resting_heart_rate']) != null
          ? (json['restingHeartRate'] ?? json['resting_heart_rate'] as num).toDouble()
          : null,
      sleepMinutes: (json['sleepMinutes'] ?? json['sleep_minutes']) as int?,
      weightKg: (json['weightKg'] ?? json['weight_kg']) != null
          ? (json['weightKg'] ?? json['weight_kg'] as num).toDouble()
          : null,
      bloodPressureSystolic: (json['bloodPressureSystolic'] ?? json['blood_pressure_systolic']) as int?,
      bloodPressureDiastolic: (json['bloodPressureDiastolic'] ?? json['blood_pressure_diastolic']) as int?,
      bloodGlucoseMgDl: (json['bloodGlucoseMgDl'] ?? json['blood_glucose_mg_dl']) != null
          ? (json['bloodGlucoseMgDl'] ?? json['blood_glucose_mg_dl'] as num).toDouble()
          : null,
      source: json['source'] as String? ?? 'health_connect',
    );
  }

  DailyDeviceMetric copyWith({
    String? metricDate,
    int? steps,
    double? distanceMeters,
    int? activeMinutes,
    double? restingHeartRate,
    int? sleepMinutes,
    double? weightKg,
    int? bloodPressureSystolic,
    int? bloodPressureDiastolic,
    double? bloodGlucoseMgDl,
    String? source,
  }) {
    return DailyDeviceMetric(
      metricDate: metricDate ?? this.metricDate,
      steps: steps ?? this.steps,
      distanceMeters: distanceMeters ?? this.distanceMeters,
      activeMinutes: activeMinutes ?? this.activeMinutes,
      restingHeartRate: restingHeartRate ?? this.restingHeartRate,
      sleepMinutes: sleepMinutes ?? this.sleepMinutes,
      weightKg: weightKg ?? this.weightKg,
      bloodPressureSystolic: bloodPressureSystolic ?? this.bloodPressureSystolic,
      bloodPressureDiastolic: bloodPressureDiastolic ?? this.bloodPressureDiastolic,
      bloodGlucoseMgDl: bloodGlucoseMgDl ?? this.bloodGlucoseMgDl,
      source: source ?? this.source,
    );
  }
}

class DeviceMetricsTrajectory {
  final bool hasData;
  final int daysTracked;
  final int? avgRecentSteps;
  final int? avgPriorSteps;
  final int? stepsTrendPercent;
  final double? avgRestingHr;
  final double? peakRestingHr;
  final double? avgSleepHours;
  final List<String> flags;
  final bool mobilityAlert;
  final bool tachycardiaAlert;
  final bool sleepDeficitAlert;
  final bool bpAlert;
  final bool weightGainAlert;

  const DeviceMetricsTrajectory({
    required this.hasData,
    this.daysTracked = 0,
    this.avgRecentSteps,
    this.avgPriorSteps,
    this.stepsTrendPercent,
    this.avgRestingHr,
    this.peakRestingHr,
    this.avgSleepHours,
    this.flags = const [],
    this.mobilityAlert = false,
    this.tachycardiaAlert = false,
    this.sleepDeficitAlert = false,
    this.bpAlert = false,
    this.weightGainAlert = false,
  });

  factory DeviceMetricsTrajectory.fromJson(Map<String, dynamic> json) {
    return DeviceMetricsTrajectory(
      hasData: json['hasData'] as bool? ?? false,
      daysTracked: json['daysTracked'] as int? ?? 0,
      avgRecentSteps: json['avgRecentSteps'] as int?,
      avgPriorSteps: json['avgPriorSteps'] as int?,
      stepsTrendPercent: json['stepsTrendPercent'] as int?,
      avgRestingHr: json['avgRestingHr'] != null ? (json['avgRestingHr'] as num).toDouble() : null,
      peakRestingHr: json['peakRestingHr'] != null ? (json['peakRestingHr'] as num).toDouble() : null,
      avgSleepHours: json['avgSleepHours'] != null ? (json['avgSleepHours'] as num).toDouble() : null,
      flags: (json['flags'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? const [],
      mobilityAlert: json['mobilityAlert'] as bool? ?? false,
      tachycardiaAlert: json['tachycardiaAlert'] as bool? ?? false,
      sleepDeficitAlert: json['sleepDeficitAlert'] as bool? ?? false,
      bpAlert: json['bpAlert'] as bool? ?? false,
      weightGainAlert: json['weightGainAlert'] as bool? ?? false,
    );
  }
}
