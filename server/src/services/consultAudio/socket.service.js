/**
 * Socket.IO Server for Consultation Audio Control Channel.
 *
 * Sockets are strictly PUSH-ONLY (server to client).
 * Authenticates connections using scoped session tokens.
 * Sockets join room `session:{sessionId}`.
 * No health data or transcripts in any event payload.
 */

const { Server } = require('socket.io');
const { verifySessionToken } = require('./token.service');
const logger = require('../../utils/logger');

let ioInstance = null;

function initSocketServer(httpServer, corsOptions) {
  ioInstance = new Server(httpServer, {
    cors: corsOptions || {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  // Authentication Middleware
  ioInstance.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) {
      return next(new Error('Authentication error: Missing scoped session token'));
    }

    try {
      const claims = verifySessionToken(token);
      socket.session = claims; // { sessionId, device, role, userId }
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid or expired session token'));
    }
  });

  ioInstance.on('connection', (socket) => {
    const { sessionId, device, role } = socket.session;
    const roomName = `session:${sessionId}`;
    socket.join(roomName);

    logger.debug('Socket client connected to session room', {
      scope: 'consult-socket',
      sessionId,
      device,
      role,
    });

    // Notify connected client of successful join
    socket.emit('connected', {
      sessionId,
      device,
      serverTimeMs: Date.now(),
    });

    socket.on('disconnect', () => {
      logger.debug('Socket client disconnected', {
        scope: 'consult-socket',
        sessionId,
        device,
      });
    });
  });

  return ioInstance;
}

function getIO() {
  return ioInstance;
}

// Push Event Emitters (Server to Client Only)

function emitSessionState(sessionId, statePayload) {
  if (!ioInstance) return;
  const roomName = `session:${sessionId}`;
  ioInstance.to(roomName).emit('session_state', statePayload);
}

function emitSessionStarted(sessionId, startedAtServerMs) {
  if (!ioInstance) return;
  const roomName = `session:${sessionId}`;
  ioInstance.to(roomName).emit('session_started', {
    started_at_server_ms: startedAtServerMs,
  });
}

function emitEndRequested(sessionId, deadlineAt) {
  if (!ioInstance) return;
  const roomName = `session:${sessionId}`;
  ioInstance.to(roomName).emit('end_requested', {
    deadline_at: deadlineAt,
  });
}

function emitStatusUpdate(sessionId, statusPayload) {
  if (!ioInstance) return;
  const roomName = `session:${sessionId}`;
  ioInstance.to(roomName).emit('status', statusPayload);
}

function emitNotesReady(sessionId) {
  if (!ioInstance) return;
  const roomName = `session:${sessionId}`;
  ioInstance.to(roomName).emit('notes_ready', {
    session_id: sessionId,
  });
}

module.exports = {
  initSocketServer,
  getIO,
  emitSessionState,
  emitSessionStarted,
  emitEndRequested,
  emitStatusUpdate,
  emitNotesReady,
};
