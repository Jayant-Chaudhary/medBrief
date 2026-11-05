import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:health/health.dart';
import 'health_connect_models.dart';

/// Service interfacing with Health Connect on Android (and HealthKit on iOS)
/// through the `health` package, grouping raw measurements into daily metrics.
class HealthConnectService {
  final Health _health;
  final bool _syntheticMode;

  HealthConnectService({Health? health, bool syntheticMode = false})
      : _health = health ?? Health(),
        _syntheticMode = syntheticMode;

  /// The health data types requested by MedBrief for prenatal monitoring.
  static final List<HealthDataType> types = [
    HealthDataType.STEPS,
    HealthDataType.RESTING_HEART_RATE,
    HealthDataType.SLEEP_SESSION,
    HealthDataType.BLOOD_PRESSURE_SYSTOLIC,
    HealthDataType.BLOOD_PRESSURE_DIASTOLIC,
    HealthDataType.WEIGHT,
  ];

  static final List<HealthDataAccess> permissions = [
    HealthDataAccess.READ,
    HealthDataAccess.READ,
    HealthDataAccess.READ,
    HealthDataAccess.READ,
    HealthDataAccess.READ,
    HealthDataAccess.READ,
  ];

  /// Check if Health Connect or platform health data is available.
  Future<bool> isAvailable() async {
    if (_syntheticMode) return true;
    try {
      if (Platform.isAndroid) {
        final status = await _health.getHealthConnectSdkStatus();
        return status == HealthConnectSdkStatus.sdkAvailable;
      }
      return true;
    } catch (e) {
      debugPrint('[HealthConnect] Error checking availability: $e');
      return false;
    }
  }

  /// Request user authorization for Health Connect permissions.
  Future<bool> requestPermissions() async {
    if (_syntheticMode) return true;
    try {
      final granted = await _health.requestAuthorization(types, permissions: permissions);
      return granted;
    } catch (e) {
      debugPrint('[HealthConnect] Error requesting authorization: $e');
      return false;
    }
  }

  /// Check if required permissions are already granted.
  Future<bool> hasPermissions() async {
    if (_syntheticMode) return true;
    try {
      final has = await _health.hasPermissions(types, permissions: permissions);
      return has == true;
    } catch (e) {
      return false;
    }
  }

  /// Formats a local date key (YYYY-MM-DD) avoiding UTC shifts.
  static String formatDateKey(DateTime dt) {
    final local = dt.toLocal();
    final y = local.year.toString().padLeft(4, '0');
    final m = local.month.toString().padLeft(2, '0');
    final d = local.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  /// Fetch aggregated daily device metrics for the past [days] window.
  /// Uses Health Connect's native deduplication engine (`getTotalStepsInInterval`)
  /// to eliminate double-counting across multiple sources (e.g. Google Fit + phone OEM sensors).
  Future<List<DailyDeviceMetric>> fetchRecentDailyMetrics({int days = 14}) async {
    if (_syntheticMode) {
      return _generateSyntheticMetrics(days);
    }

    final now = DateTime.now();
    final todayMidnight = DateTime(now.year, now.month, now.day);
    final startTime = todayMidnight.subtract(Duration(days: days));

    try {
      // 1. Query point events (resting heart rate, sleep, BP, weight)
      final points = await _health.getHealthDataFromTypes(
        types: types,
        startTime: startTime,
        endTime: now,
      );

      final dailyList = aggregateDataPointsToDaily(points);
      final Map<String, DailyDeviceMetric> dailyMap = {
        for (final m in dailyList) m.metricDate: m,
      };

      // 2. Query deduplicated step count per day via Health Connect's native Aggregate API
      for (int i = 0; i < days; i++) {
        final dayStart = todayMidnight.subtract(Duration(days: i));
        final dayEnd = (i == 0)
            ? now
            : dayStart.add(const Duration(days: 1)).subtract(const Duration(milliseconds: 1));
        final dateKey = formatDateKey(dayStart);

        try {
          final totalSteps = await _health.getTotalStepsInInterval(dayStart, dayEnd);
          if (totalSteps != null && totalSteps >= 0) {
            if (dailyMap.containsKey(dateKey)) {
              dailyMap[dateKey] = dailyMap[dateKey]!.copyWith(steps: totalSteps);
            } else {
              dailyMap[dateKey] = DailyDeviceMetric(
                metricDate: dateKey,
                steps: totalSteps,
                source: 'health_connect',
              );
            }
          }
        } catch (e) {
          debugPrint('[HealthConnect] Error querying deduplicated steps for $dateKey: $e');
        }
      }

      final list = dailyMap.values.toList();
      list.sort((a, b) => b.metricDate.compareTo(a.metricDate));
      return list;
    } catch (e) {
      debugPrint('[HealthConnect] Error querying health points: $e');
      return [];
    }
  }

  /// Aggregates fine-grained HealthDataPoint records into day-level records (YYYY-MM-DD).
  static List<DailyDeviceMetric> aggregateDataPointsToDaily(List<HealthDataPoint> points) {
    if (points.isEmpty) return [];

    final Map<String, _DailyAccumulator> map = {};

    for (final p in points) {
      final dateKey = formatDateKey(p.dateFrom);
      final acc = map.putIfAbsent(dateKey, () => _DailyAccumulator(dateKey));

      switch (p.type) {
        case HealthDataType.STEPS:
          if (p.value is NumericHealthValue) {
            acc.steps += (p.value as NumericHealthValue).numericValue.toInt();
          }
          break;
        case HealthDataType.RESTING_HEART_RATE:
          if (p.value is NumericHealthValue) {
            acc.restingHeartRates.add((p.value as NumericHealthValue).numericValue.toDouble());
          }
          break;
        case HealthDataType.SLEEP_SESSION:
        case HealthDataType.SLEEP_ASLEEP:
          final durationMinutes = p.dateTo.difference(p.dateFrom).inMinutes;
          if (durationMinutes > 0 && durationMinutes < 1440) {
            acc.sleepMinutes += durationMinutes;
          }
          break;
        case HealthDataType.BLOOD_PRESSURE_SYSTOLIC:
          if (p.value is NumericHealthValue) {
            acc.latestSystolic = (p.value as NumericHealthValue).numericValue.toInt();
          }
          break;
        case HealthDataType.BLOOD_PRESSURE_DIASTOLIC:
          if (p.value is NumericHealthValue) {
            acc.latestDiastolic = (p.value as NumericHealthValue).numericValue.toInt();
          }
          break;
        case HealthDataType.WEIGHT:
          if (p.value is NumericHealthValue) {
            acc.latestWeight = (p.value as NumericHealthValue).numericValue.toDouble();
          }
          break;
        default:
          break;
      }
    }

    final list = map.values.map((a) => a.toMetric()).toList();
    list.sort((a, b) => b.metricDate.compareTo(a.metricDate));
    return list;
  }

  List<DailyDeviceMetric> _generateSyntheticMetrics(int days) {
    final now = DateTime.now();
    return List.generate(days, (i) {
      final date = now.subtract(Duration(days: i)).toIso8601String().substring(0, 10);
      return DailyDeviceMetric(
        metricDate: date,
        steps: 4500 + (i * 200) % 3000,
        distanceMeters: 3200,
        activeMinutes: 30,
        restingHeartRate: 76.0 + (i % 6),
        sleepMinutes: 420 + (i % 40),
        source: 'simulator',
      );
    });
  }
}

class _DailyAccumulator {
  final String date;
  int steps = 0;
  List<double> restingHeartRates = [];
  int sleepMinutes = 0;
  int? latestSystolic;
  int? latestDiastolic;
  double? latestWeight;

  _DailyAccumulator(this.date);

  DailyDeviceMetric toMetric() {
    double? avgRhr;
    if (restingHeartRates.isNotEmpty) {
      avgRhr = restingHeartRates.reduce((a, b) => a + b) / restingHeartRates.length;
      avgRhr = double.parse(avgRhr.toStringAsFixed(1));
    }

    return DailyDeviceMetric(
      metricDate: date,
      steps: steps > 0 ? steps : null,
      restingHeartRate: avgRhr,
      sleepMinutes: sleepMinutes > 0 ? sleepMinutes : null,
      bloodPressureSystolic: latestSystolic,
      bloodPressureDiastolic: latestDiastolic,
      weightKg: latestWeight,
      source: 'health_connect',
    );
  }
}

