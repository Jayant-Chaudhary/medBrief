import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health/health.dart';
import 'package:health_on_patient/core/api_client.dart';
import 'package:health_on_patient/features/health_connect/health_connect_card.dart';
import 'package:health_on_patient/features/health_connect/health_connect_models.dart';
import 'package:health_on_patient/features/health_connect/health_connect_repository.dart';
import 'package:health_on_patient/features/health_connect/health_connect_service.dart';

class MockApiClient extends ApiClient {
  MockApiClient() : super(baseUrl: 'http://localhost:4000', accessToken: () => 'mock-token');

  dynamic cannedResponse;
  String? lastPath;
  String? lastMethod;
  dynamic lastBody;

  @override
  Future<dynamic> request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    bool authenticated = true,
    String? bearerToken,
    Map<String, String>? headers,
    Duration timeout = const Duration(seconds: 25),
  }) async {
    lastPath = path;
    lastMethod = method;
    lastBody = body;
    return cannedResponse;
  }
}

void main() {
  group('Health Connect Models & Serialization', () {
    test('DailyDeviceMetric serializes and deserializes cleanly', () {
      const metric = DailyDeviceMetric(
        metricDate: '2026-11-04',
        steps: 7250,
        distanceMeters: 5100.5,
        activeMinutes: 45,
        restingHeartRate: 74.5,
        sleepMinutes: 430,
        weightKg: 64.2,
        bloodPressureSystolic: 118,
        bloodPressureDiastolic: 76,
        source: 'health_connect',
      );

      final json = metric.toJson();
      expect(json['metricDate'], '2026-11-04');
      expect(json['steps'], 7250);
      expect(json['restingHeartRate'], 74.5);
      expect(json['source'], 'health_connect');

      final reconstructed = DailyDeviceMetric.fromJson(json);
      expect(reconstructed.metricDate, '2026-11-04');
      expect(reconstructed.steps, 7250);
      expect(reconstructed.restingHeartRate, 74.5);
      expect(reconstructed.weightKg, 64.2);
    });

    test('DeviceMetricsTrajectory parses trajectory and flags', () {
      final json = {
        'hasData': true,
        'daysTracked': 14,
        'avgRecentSteps': 3200,
        'avgPriorSteps': 6100,
        'stepsTrendPercent': -47,
        'avgRestingHr': 88.5,
        'peakRestingHr': 104.0,
        'avgSleepHours': 5.2,
        'flags': ['Marked physical mobility drop: daily steps reduced by 47%'],
        'mobilityAlert': true,
        'tachycardiaAlert': true,
        'sleepDeficitAlert': true,
      };

      final trajectory = DeviceMetricsTrajectory.fromJson(json);
      expect(trajectory.hasData, true);
      expect(trajectory.daysTracked, 14);
      expect(trajectory.avgRecentSteps, 3200);
      expect(trajectory.stepsTrendPercent, -47);
      expect(trajectory.mobilityAlert, true);
      expect(trajectory.tachycardiaAlert, true);
      expect(trajectory.flags.length, 1);
    });
  });

  group('HealthConnectService Aggregation', () {
    test('aggregates fine-grained HealthDataPoint records to daily metrics', () {
      final now = DateTime(2026, 11, 4, 10, 0);

      final points = [
        HealthDataPoint(
          uuid: '1',
          value: NumericHealthValue(numericValue: 3000),
          type: HealthDataType.STEPS,
          unit: HealthDataUnit.COUNT,
          dateFrom: now.subtract(const Duration(hours: 4)),
          dateTo: now.subtract(const Duration(hours: 3)),
          sourcePlatform: HealthPlatformType.googleHealthConnect,
          sourceDeviceId: 'device-1',
          sourceId: 'src-1',
          sourceName: 'Watch',
        ),
        HealthDataPoint(
          uuid: '2',
          value: NumericHealthValue(numericValue: 2500),
          type: HealthDataType.STEPS,
          unit: HealthDataUnit.COUNT,
          dateFrom: now.subtract(const Duration(hours: 2)),
          dateTo: now.subtract(const Duration(hours: 1)),
          sourcePlatform: HealthPlatformType.googleHealthConnect,
          sourceDeviceId: 'device-1',
          sourceId: 'src-1',
          sourceName: 'Watch',
        ),
        HealthDataPoint(
          uuid: '3',
          value: NumericHealthValue(numericValue: 76),
          type: HealthDataType.RESTING_HEART_RATE,
          unit: HealthDataUnit.BEATS_PER_MINUTE,
          dateFrom: now.subtract(const Duration(hours: 3)),
          dateTo: now.subtract(const Duration(hours: 3)),
          sourcePlatform: HealthPlatformType.googleHealthConnect,
          sourceDeviceId: 'device-1',
          sourceId: 'src-1',
          sourceName: 'Watch',
        ),
      ];

      final daily = HealthConnectService.aggregateDataPointsToDaily(points);
      expect(daily.length, 1);
      expect(daily.first.metricDate, '2026-11-04');
      expect(daily.first.steps, 5500); // 3000 + 2500
      expect(daily.first.restingHeartRate, 76.0);
    });
  });

  group('HealthConnectRepository API Integration', () {
    test('syncDeviceMetrics posts to server endpoint', () async {
      final mockClient = MockApiClient();
      mockClient.cannedResponse = {'success': true, 'syncedCount': 2};

      final repo = HealthConnectRepository(api: mockClient);
      final metrics = [
        const DailyDeviceMetric(metricDate: '2026-11-04', steps: 6000),
        const DailyDeviceMetric(metricDate: '2026-11-03', steps: 5800),
      ];

      final ok = await repo.syncDeviceMetrics(metrics);
      expect(ok, true);
      expect(mockClient.lastPath, '/api/checkin/device-metrics/sync');
      expect(mockClient.lastMethod, 'POST');
      expect(mockClient.lastBody['metrics'].length, 2);
    });

    test('fetchTrajectory retrieves longitudinal trajectory from server', () async {
      final mockClient = MockApiClient();
      mockClient.cannedResponse = {
        'hasData': true,
        'daysTracked': 7,
        'avgRecentSteps': 4500,
        'tachycardiaAlert': false,
        'flags': [],
      };

      final repo = HealthConnectRepository(api: mockClient);
      final trajectory = await repo.fetchTrajectory(appointmentId: 'appt-1');

      expect(trajectory, isNotNull);
      expect(trajectory!.hasData, true);
      expect(trajectory.daysTracked, 7);
      expect(mockClient.lastPath, contains('appointmentId=appt-1'));
    });
  });

  group('HealthConnectCard Widget', () {
    testWidgets('renders HealthConnectCard with initial metrics', (tester) async {
      const metric = DailyDeviceMetric(
        metricDate: '2026-11-04',
        steps: 6840,
        restingHeartRate: 78.0,
        sleepMinutes: 450, // 7.5 hrs
      );

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: HealthConnectCard(
              initialConnected: true,
              initialMetric: metric,
            ),
          ),
        ),
      );

      expect(find.text('Physical Activity & Vitals'), findsOneWidget);
      expect(find.text('Health Connect connected'), findsOneWidget);
      expect(find.text('6840'), findsOneWidget);
      expect(find.text('78 bpm'), findsOneWidget);
      expect(find.text('7.5 h'), findsOneWidget);
    });
  });
}
