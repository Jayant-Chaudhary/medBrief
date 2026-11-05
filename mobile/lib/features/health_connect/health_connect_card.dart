import 'package:flutter/material.dart';
import '../../core/app_theme.dart';
import 'health_connect_models.dart';
import 'health_connect_repository.dart';
import 'health_connect_service.dart';

/// Card widget displayed on the Patient Home tab showing Health Connect sync status,
/// genuine daily wearable statistics (steps, resting HR, sleep), and a one-tap sync trigger.
class HealthConnectCard extends StatefulWidget {
  const HealthConnectCard({
    super.key,
    this.service,
    this.repository,
    this.initialConnected = false,
    this.initialMetric,
  });

  final HealthConnectService? service;
  final HealthConnectRepository? repository;
  final bool initialConnected;
  final DailyDeviceMetric? initialMetric;

  @override
  State<HealthConnectCard> createState() => _HealthConnectCardState();
}

class _HealthConnectCardState extends State<HealthConnectCard> {
  late final HealthConnectService _service;
  late final HealthConnectRepository _repository;

  bool _isConnected = false;
  bool _isSyncing = false;
  DailyDeviceMetric? _latestMetric;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? HealthConnectService();
    _repository = widget.repository ?? const HealthConnectRepository();
    _isConnected = widget.initialConnected;
    _latestMetric = widget.initialMetric;

    _checkInitialStatus();
  }

  Future<void> _checkInitialStatus() async {
    if (_isConnected) return;
    final hasPerm = await _service.hasPermissions();
    if (mounted) {
      setState(() {
        _isConnected = hasPerm;
      });
      if (hasPerm && _latestMetric == null) {
        _performSync(silent: true);
      }
    }
  }

  Future<void> _performSync({bool silent = false}) async {
    if (_isSyncing) return;

    setState(() {
      _isSyncing = true;
    });

    try {
      final available = await _service.isAvailable();
      if (!available) {
        if (!silent && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Health Connect is not available on this device.'),
              backgroundColor: Colors.orange,
            ),
          );
        }
        setState(() => _isSyncing = false);
        return;
      }

      final hasPerm = await _service.hasPermissions();
      if (!hasPerm) {
        final granted = await _service.requestPermissions();
        if (!granted) {
          if (!silent && mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Health permissions were not granted.'),
                backgroundColor: Colors.grey,
              ),
            );
          }
          setState(() {
            _isSyncing = false;
            _isConnected = false;
          });
          return;
        }
      }

      // Query latest 14 days of daily metrics
      final metrics = await _service.fetchRecentDailyMetrics(days: 14);

      if (metrics.isNotEmpty) {
        final success = await _repository.syncDeviceMetrics(metrics);
        if (mounted) {
          if (success) {
            setState(() {
              _latestMetric = metrics.first;
              _isConnected = true;
            });
            if (!silent) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Synced ${metrics.length} days of activity with your doctor.'),
                  backgroundColor: primary,
                ),
              );
            }
          } else {
            if (!silent) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Server failed to save health data. Please check database connection.'),
                  backgroundColor: Colors.redAccent,
                ),
              );
            }
          }
        }
      } else {
        if (mounted) {
          setState(() {
            _isConnected = true;
          });
          if (!silent) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Health Connect connected, but no recorded activity was found in the past 14 days.'),
                backgroundColor: Colors.orange,
              ),
            );
          }
        }
      }
    } catch (e) {
      if (!silent && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to sync device metrics. Please try again.'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSyncing = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: line),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: const Color(0x1F2F6F6B),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.watch_rounded, color: primary, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Physical Activity & Vitals',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _isConnected ? 'Health Connect connected' : 'Sync wearable data with doctor',
                      style: const TextStyle(
                        fontSize: 12,
                        color: muted,
                      ),
                    ),
                  ],
                ),
              ),
              if (_isSyncing)
                const SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2.5),
                )
              else
                TextButton.icon(
                  onPressed: () => _performSync(),
                  icon: Icon(
                    _isConnected ? Icons.sync_rounded : Icons.link_rounded,
                    size: 16,
                    color: primary,
                  ),
                  label: Text(
                    _isConnected ? 'Sync' : 'Connect',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    foregroundColor: primary,
                  ),
                ),
            ],
          ),
          if (_latestMetric != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
              decoration: BoxDecoration(
                color: const Color(0xFFF7FBF9),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFE2EFE7)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _MetricTile(
                    icon: Icons.directions_walk_rounded,
                    label: 'Steps',
                    value: _latestMetric?.steps != null ? '${_latestMetric!.steps}' : '--',
                  ),
                  Container(width: 1, height: 28, color: const Color(0xFFD2E6DC)),
                  _MetricTile(
                    icon: Icons.favorite_outline_rounded,
                    label: 'Resting HR',
                    value: _latestMetric?.restingHeartRate != null
                        ? '${_latestMetric!.restingHeartRate!.round()} bpm'
                        : '--',
                  ),
                  Container(width: 1, height: 28, color: const Color(0xFFD2E6DC)),
                  _MetricTile(
                    icon: Icons.bedtime_outlined,
                    label: 'Sleep',
                    value: _latestMetric?.sleepMinutes != null
                        ? '${(_latestMetric!.sleepMinutes! / 60).toStringAsFixed(1)} h'
                        : '--',
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: primary),
            const SizedBox(width: 4),
            Text(
              label,
              style: const TextStyle(fontSize: 11, color: muted, fontWeight: FontWeight.w500),
            ),
          ],
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: ink,
          ),
        ),
      ],
    );
  }
}
