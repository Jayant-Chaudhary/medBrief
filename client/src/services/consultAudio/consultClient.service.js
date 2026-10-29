/**
 * Client Service for Consultation Audio Flow & Real-Time Socket.IO.
 *
 * Manages:
 * - Session creation, consent, clock handshake, and readiness
 * - Start/End consultation controls
 * - Socket.IO push event handling (control room)
 */

import { io } from 'socket.io-client';
import { request } from '../apiClient.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

/**
 * Creates a consultation audio session for an appointment.
 */
export async function createConsultSession(appointmentId) {
  return request('/api/consults', {
    method: 'POST',
    body: {
      appointmentId,
      appointment_id: appointmentId,
    },
  });
}

function assertValidSession(sessionId, token) {
  if (!sessionId || sessionId === 'undefined') {
    throw new Error('Valid sessionId is required for consultation audio actions');
  }
  if (!token || token === 'undefined') {
    throw new Error('Valid session token is required for consultation audio actions');
  }
}

/**
 * Records doctor consent for the consultation.
 */
export async function recordDoctorConsent({ sessionId, token, consentVersion = 'v1.0' }) {
  assertValidSession(sessionId, token);
  const res = await fetch(`${BASE_URL}/api/consults/${sessionId}/consent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      role: 'doctor',
      consent_text_version: consentVersion,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to record consent (${res.status})`);
  }

  return res.json();
}

/**
 * Executes a 5-round clock synchronization handshake against /api/time.
 * Keeps the round with the smallest round-trip time (RTT).
 *
 * @returns {Promise<{offset_ms: number, rtt_ms: number}>}
 */
export async function performClockHandshake(rounds = 5) {
  let best = null;

  for (let i = 0; i < rounds; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/time`);
      const t3 = Date.now();
      const rtt = Math.max(0, t3 - t0);

      if (res.ok) {
        const data = await res.json();
        const serverTime = Number(data.server_time_ms || data.serverTimeMs);
        const estimatedLocalTime = t0 + Math.round(rtt / 2);
        const offset = serverTime - estimatedLocalTime;

        if (!best || rtt < best.rtt_ms) {
          best = { offset_ms: offset, rtt_ms: rtt };
        }
      }
    } catch (e) {
      // Continue to next round
    }

    if (i < rounds - 1) {
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  return best || { offset_ms: 0, rtt_ms: 0 };
}

/**
 * Signals doctor device readiness after mic check and clock handshake.
 */
export async function setDoctorReady({ sessionId, token, offsetMs, rttMs, captureZeroDeviceMs }) {
  assertValidSession(sessionId, token);
  const res = await fetch(`${BASE_URL}/api/consults/${sessionId}/devices/doctor/ready`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      offset_ms: offsetMs,
      rtt_ms: rttMs,
      capture_zero_device_ms: captureZeroDeviceMs,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to set ready state (${res.status})`);
  }

  return res.json();
}

/**
 * Starts recording consultation.
 */
export async function startConsultation({ sessionId, token }) {
  assertValidSession(sessionId, token);
  const res = await fetch(`${BASE_URL}/api/consults/${sessionId}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to start consultation (${res.status})`);
  }

  return res.json();
}

/**
 * Requests end of consultation.
 */
export async function endConsultation({ sessionId, token }) {
  assertValidSession(sessionId, token);
  const res = await fetch(`${BASE_URL}/api/consults/${sessionId}/end`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to end consultation (${res.status})`);
  }

  return res.json();
}

/**
 * Connects to the Socket.IO server and joins the consultation control room.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.token
 * @param {Function} params.onEvent - (eventName, data) => void
 * @returns {Socket}
 */
export function connectConsultationSocket({ sessionId, token, onEvent }) {
  const socket = io(BASE_URL, {
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    socket.emit('join_control_room', { sessionId, token });
  });

  const forward = (name) => {
    socket.on(name, (data) => onEvent(name, data));
  };

  forward('device_joined');
  forward('device_ready');
  forward('session_started');
  forward('end_requested');
  forward('status');

  return socket;
}

/**
 * Fetches current consultation session state, device statuses, and consents.
 */
export async function getConsultationState({ sessionId, token }) {
  assertValidSession(sessionId, token);
  const res = await fetch(`${BASE_URL}/api/consults/${sessionId}/state`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch session state (${res.status})`);
  }

  return res.json();
}

/**
 * Fetches merged consultation transcript segments.
 */
export async function getConsultationTranscript({ sessionId, token }) {
  assertValidSession(sessionId, token);
  const res = await fetch(`${BASE_URL}/api/consults/${sessionId}/transcript`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch transcript (${res.status})`);
  }

  return res.json();
}
