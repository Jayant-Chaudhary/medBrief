import 'package:socket_io_client/socket_io_client.dart' as io;

/// The server joins the scoped room. Application events never emit from here.
class ConsultSocket {
  ConsultSocket({
    required this.baseUrl,
    required this.sessionId,
    required this.scopedToken,
    required this.onReconcile,
  });
  final String baseUrl, sessionId, scopedToken;
  final void Function() onReconcile;
  io.Socket? _socket;
  void connect() {
    _socket = io.io(
      baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': scopedToken})
          .disableAutoConnect()
          .enableForceNew()
          .enableReconnection()
          .build(),
    );
    _socket!.onConnect((_) => onReconcile());
    for (final event in [
      'session_started',
      'end_requested',
      'session_state',
      'status',
    ]) {
      _socket!.on(event, (_) => onReconcile());
    }
    _socket!.connect();
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
  }
}
