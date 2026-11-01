/// Consultation Audio Pipeline Configuration for Flutter Patient Recorder.
///
/// Mirrors backend `server/src/config/consultAudio.config.js`.
/// No clinical values, thresholds or diagnosis text.
class ConsultAudioConfig {
  const ConsultAudioConfig({
    this.chunkMinMs = const int.fromEnvironment(
      'CHUNK_MIN_MS',
      defaultValue: 15000,
    ),
    this.chunkHardCapMs = const int.fromEnvironment(
      'CHUNK_HARD_CAP_MS',
      defaultValue: 25000,
    ),
    this.pauseMs = const int.fromEnvironment('PAUSE_MS', defaultValue: 500),
    this._silenceDbfs = -45.0,
    this.sampleRate = const int.fromEnvironment(
      'AUDIO_SAMPLE_RATE',
      defaultValue: 16000,
    ),
    this.bitRate = const int.fromEnvironment(
      'AUDIO_BIT_RATE',
      defaultValue: 32000,
    ),
    this.meterIntervalMs = const int.fromEnvironment(
      'AUDIO_METER_INTERVAL_MS',
      defaultValue: 100,
    ),
    this.clockHandshakeRounds = const int.fromEnvironment(
      'AUDIO_CLOCK_ROUNDS',
      defaultValue: 5,
    ),
    this.statePollIntervalMs = const int.fromEnvironment(
      'AUDIO_STATE_POLL_MS',
      defaultValue: 5000,
    ),
    this.maxPendingStorageBytes = const int.fromEnvironment(
      'AUDIO_PENDING_MAX_BYTES',
      defaultValue: 50 * 1024 * 1024,
    ),
    this.storageRetentionHours = const int.fromEnvironment(
      'AUDIO_PENDING_RETENTION_HOURS',
      defaultValue: 2,
    ),
    this.consentTextVersion = const String.fromEnvironment(
      'AUDIO_CONSENT_VERSION',
      defaultValue: 'v1.0',
    ),
    this._retryBackoffMs = const [1000, 2000, 4000, 8000, 30000],
    this.httpTimeoutMs = const int.fromEnvironment(
      'AUDIO_HTTP_TIMEOUT_MS',
      defaultValue: 30000,
    ),
    this.encoderDrainTimeoutMs = const int.fromEnvironment(
      'AUDIO_ENCODER_DRAIN_MS',
      defaultValue: 5000,
    ),
    this.chunkMaxBytes = const int.fromEnvironment(
      'CHUNK_MAX_BYTES',
      defaultValue: 2000000,
    ),
    this.levelCheckMs = const int.fromEnvironment(
      'AUDIO_LEVEL_CHECK_MS',
      defaultValue: 2000,
    ),
  });

  /// Minimum audio chunk length (15s).
  final int chunkMinMs;

  /// Hard cap after which chunk must cut (25s).
  final int chunkHardCapMs;

  /// Silence duration required after chunkMinMs to cut on pause (500ms).
  final int pauseMs;

  /// Loudness threshold in dBFS considered silence (-45 dBFS).
  final double _silenceDbfs;
  double get silenceDbfs =>
      double.tryParse(const String.fromEnvironment('SILENCE_DBFS')) ??
      _silenceDbfs;

  /// Target recording sample rate in Hz (16 kHz).
  final int sampleRate;

  /// Target bit rate in bps (32 kbps AAC-LC mono).
  final int bitRate;

  /// Mic meter sampling interval in milliseconds.
  final int meterIntervalMs;

  /// Number of rounds for NTP-style clock sync.
  final int clockHandshakeRounds;

  /// Polling interval for HTTP /state fallback.
  final int statePollIntervalMs;

  /// Maximum disk storage for unacknowledged pending chunks (50 MB).
  final int maxPendingStorageBytes;

  /// Max hours to retain pending chunks before discarding.
  final int storageRetentionHours;

  /// Required consent text version.
  final String consentTextVersion;

  /// Exponential retry backoff intervals in milliseconds.
  final List<int> _retryBackoffMs;
  List<int> get retryBackoffMs {
    const value = String.fromEnvironment('UPLOAD_BACKOFF_MS');
    return value.isEmpty
        ? _retryBackoffMs
        : value.split(',').map(int.parse).toList();
  }

  final int httpTimeoutMs;
  final int encoderDrainTimeoutMs;
  final int chunkMaxBytes;
  final int levelCheckMs;

  static const notificationTitle = 'Recording';
  static const notificationWaiting = 'Ready. Tap to return.';
  static const notificationActive = 'Recording active. Tap to return.';
  static const notificationPending = 'Sending files. Tap to return.';

  static const defaultInstance = ConsultAudioConfig();
}
