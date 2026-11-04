import '../../core/api_client.dart';
import 'health_connect_models.dart';

class HealthConnectRepository {
  final ApiClient? api;

  const HealthConnectRepository({this.api});

  /// Syncs a batch of daily wearable/physical metrics to MedBrief server.
  Future<bool> syncDeviceMetrics(List<DailyDeviceMetric> metrics) async {
    if (metrics.isEmpty) return true;

    final client = api;
    if (client == null) {
      // Offline/demo fallback
      return true;
    }

    try {
      final res = await client.request(
        '/api/checkin/device-metrics/sync',
        method: 'POST',
        body: {
          'metrics': metrics.map((m) => m.toJson()).toList(),
        },
      );

      if (res is Map<String, dynamic> && res['success'] == true) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /// Fetches longitudinal physical trajectory and alert flags from server.
  Future<DeviceMetricsTrajectory?> fetchTrajectory({String? appointmentId}) async {
    final client = api;
    if (client == null) {
      return null;
    }

    try {
      final path = appointmentId != null
          ? '/api/checkin/device-metrics/trajectory?appointmentId=$appointmentId'
          : '/api/checkin/device-metrics/trajectory';

      final res = await client.request(path, method: 'GET');
      if (res is Map<String, dynamic>) {
        return DeviceMetricsTrajectory.fromJson(res);
      }
      return null;
    } catch (e) {
      return null;
    }
  }
}

