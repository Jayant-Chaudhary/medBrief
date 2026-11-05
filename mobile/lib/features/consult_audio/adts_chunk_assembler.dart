import 'dart:typed_data';

class AssembledAdtsChunk {
  const AssembledAdtsChunk({
    required this.bytes,
    required this.frameCount,
    required this.durationMs,
    required this.sampleRate,
    required this.channels,
  });
  final Uint8List bytes;
  final int frameCount, durationMs, sampleRate, channels;
}

/// Callback packets may split headers or contain many frames. Only complete,
/// validated AAC-LC frames enter a chunk. Corruption is never skipped silently.
class AdtsChunkAssembler {
  AdtsChunkAssembler({
    this.fallbackSampleRate = 16000,
    this.channels = 1,
    this.onFrame,
  }) : _sampleRate = fallbackSampleRate;
  final int fallbackSampleRate, channels;
  final void Function()? onFrame;
  int _sampleRate;
  int get sampleRate => _sampleRate;
  final _pending = BytesBuilder(copy: false);
  final _active = BytesBuilder(copy: false);
  int _frames = 0;
  int get activeFrameCount => _frames;
  int get activeBytesLength => _active.length;
  int get pendingBytesLength => _pending.length;
  int get activeDurationMs => (_frames * 1024 * 1000 / _sampleRate).round();
  double get frameDurationMs => 1024 * 1000 / _sampleRate;
  static const adtsSampleRates = [
    96000,
    88200,
    64000,
    48000,
    44100,
    32000,
    24000,
    22050,
    16000,
    12000,
    11025,
    8000,
    7350,
  ];

  int ingestBytes(List<int> bytes) {
    _pending.add(bytes);
    final data = _pending.takeBytes();
    int offset = 0, count = 0;
    while (data.length - offset >= 7) {
      if (data[offset] != 255 || (data[offset + 1] & 0xf6) != 0xf0) {
        throw const FormatException('ERR_AUDIO_ADTS_HEADER');
      }
      final rateIndex = (data[offset + 2] >> 2) & 15;
      final channelCount =
          ((data[offset + 2] & 1) << 2) | (data[offset + 3] >> 6);
      if (rateIndex >= adtsSampleRates.length ||
          channelCount != channels ||
          (data[offset + 2] >> 6) != 1 ||
          (data[offset + 6] & 3) != 0) {
        throw const FormatException('ERR_AUDIO_ADTS_FORMAT');
      }
      final rate = adtsSampleRates[rateIndex];
      if (rate != fallbackSampleRate) {
        throw const FormatException('ERR_AUDIO_SAMPLE_RATE');
      }
      _sampleRate = rate;
      final header = (data[offset + 1] & 1) == 1 ? 7 : 9;
      final length =
          ((data[offset + 3] & 3) << 11) |
          (data[offset + 4] << 3) |
          (data[offset + 5] >> 5);
      if (length <= header) {
        throw const FormatException('ERR_AUDIO_ADTS_LENGTH');
      }
      if (offset + length > data.length) break;
      _active.add(Uint8List.sublistView(data, offset, offset + length));
      _frames++;
      offset += length;
      count++;
      onFrame?.call();
    }
    if (offset < data.length) _pending.add(Uint8List.sublistView(data, offset));
    return count;
  }

  AssembledAdtsChunk? sealActiveChunk() {
    if (_frames == 0) return null;
    final chunk = AssembledAdtsChunk(
      bytes: _active.takeBytes(),
      frameCount: _frames,
      durationMs: activeDurationMs,
      sampleRate: _sampleRate,
      channels: channels,
    );
    _frames = 0;
    return chunk;
  }

  AssembledAdtsChunk? flush() {
    if (_pending.isNotEmpty) {
      throw const FormatException('ERR_AUDIO_ADTS_TRUNCATED');
    }
    return sealActiveChunk();
  }

  void reset() {
    _pending.clear();
    _active.clear();
    _frames = 0;
  }
}
