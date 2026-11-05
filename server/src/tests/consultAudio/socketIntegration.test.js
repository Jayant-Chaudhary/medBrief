/**
 * Socket.IO Room & Push Notification Integration Tests.
 */

const { io: Client } = require('socket.io-client');
const app = require('../../app');
const { signSessionToken } = require('../../services/consultAudio/token.service');
const socketService = require('../../services/consultAudio/socket.service');

describe('Socket.IO Consult Room Control Channel', () => {
  let server;
  let port;
  const sessionId = 'sess-test-socket-room-1';

  beforeAll((done) => {
    server = app.server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  test('two clients in one room both receive session_started push event', (done) => {
    const doctorToken = signSessionToken({
      sessionId,
      device: 'doctor',
      role: 'doctor',
      userId: 'user-doc-1',
    });

    const patientToken = signSessionToken({
      sessionId,
      device: 'patient',
      role: 'patient',
      userId: 'user-pt-1',
    });

    const doctorSocket = Client(`http://localhost:${port}`, {
      auth: { token: doctorToken },
      transports: ['websocket'],
    });

    const patientSocket = Client(`http://localhost:${port}`, {
      auth: { token: patientToken },
      transports: ['websocket'],
    });

    let doctorReceived = false;
    let patientReceived = false;
    const testTimestamp = 1770000000000;

    function checkDone() {
      if (doctorReceived && patientReceived) {
        doctorSocket.disconnect();
        patientSocket.disconnect();
        done();
      }
    }

    doctorSocket.on('session_started', (data) => {
      expect(data.started_at_server_ms).toBe(testTimestamp);
      doctorReceived = true;
      checkDone();
    });

    patientSocket.on('session_started', (data) => {
      expect(data.started_at_server_ms).toBe(testTimestamp);
      patientReceived = true;
      checkDone();
    });

    // Wait until both connect, then emit event
    let connectedCount = 0;
    const onConnect = () => {
      connectedCount++;
      if (connectedCount === 2) {
        // Emit from server service
        socketService.emitSessionStarted(sessionId, testTimestamp);
      }
    };

    doctorSocket.on('connected', onConnect);
    patientSocket.on('connected', onConnect);
  });

  test('rejects connection with invalid or missing session token', (done) => {
    const badSocket = Client(`http://localhost:${port}`, {
      auth: { token: 'invalid-or-forged-token' },
      transports: ['websocket'],
    });

    badSocket.on('connect_error', (err) => {
      expect(err.message).toMatch(/Authentication error/i);
      badSocket.disconnect();
      done();
    });

    badSocket.on('connect', () => {
      badSocket.disconnect();
      done(new Error('Bad socket should not have connected'));
    });
  });
});
