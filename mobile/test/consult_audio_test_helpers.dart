import 'dart:async';
import 'dart:typed_data';
import 'package:record/record.dart';
import 'package:health_on_patient/features/consult_audio/patient_recorder.dart';
import 'package:health_on_patient/features/consult_audio/consult_audio_repository.dart';

Uint8List syntheticAdtsFrame({int payloadLength = 30}) {
  final size = payloadLength + 7;
  final bytes = Uint8List(size);
  bytes.setAll(0, [
    255,
    241,
    96,
    64 | (size >> 11),
    (size >> 3) & 255,
    ((size & 7) << 5) | 31,
    252,
  ]);
  return bytes;
}

class MemoryTokens implements ScopedTokenStorage {
  final values = <String, String>{};
  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}

class SyntheticRecorderSource implements RecorderSource {
  bool allowed = true;
  int starts = 0;
  Completer<void>? startGate;
  List<int> tail = [];
  StreamController<List<int>>? bytes;
  final states = StreamController<RecordState>.broadcast(sync: true);
  @override
  Stream<RecordState> get stateChanges => states.stream;
  @override
  Future<bool> hasPermission({bool request = true}) async => allowed;
  @override
  Future<bool> isEncoderSupported(AudioEncoder encoder) async => true;
  @override
  Future<Stream<List<int>>> startStream(RecordConfig config) async {
    if (!allowed) throw StateError('ERR_AUDIO_PERMISSION');
    starts++;
    bytes = StreamController<List<int>>();
    await startGate?.future;
    return bytes!.stream;
  }

  void emit(List<int> value) => bytes!.add(value);
  @override
  Future<Amplitude> getAmplitude() async => Amplitude(current: -15, max: -10);
  @override
  Future<void> stop() async {
    if (bytes != null && !bytes!.isClosed) {
      if (tail.isNotEmpty) bytes!.add(tail);
      await bytes!.close();
    }
  }

  @override
  Future<void> dispose() async {
    await stop();
    if (!states.isClosed) await states.close();
  }
}
