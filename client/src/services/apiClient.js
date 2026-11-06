import { supabase } from './supabaseClient.js';

export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
}

export const BASE_URL = getApiBaseUrl();

// Traces every API call to the console in dev, or anywhere with VITE_DEBUG_API=true.
// Set VITE_DEBUG_API=false to silence it in dev.
const DEBUG_API =
  import.meta.env.VITE_DEBUG_API === 'true' ||
  (import.meta.env.DEV && import.meta.env.VITE_DEBUG_API !== 'false');

export class ApiError extends Error {
  constructor(message, status, requestId, details, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // Matches the server's log lines for this request.
    this.requestId = requestId;
    // validateBody's per-field messages, when the body was rejected.
    this.details = details;
    // Set when the UI has something to do besides show the message.
    this.code = code;
  }
}

function trace(method, path, response, startedAt) {
  if (!DEBUG_API || path.startsWith('/api/community')) return;
  const ms = Math.round(performance.now() - startedAt);
  const requestId = response.headers.get('X-Request-Id');
  const log = response.ok ? console.debug : console.warn;
  log(`[api] ${method} ${path} → ${response.status} (${ms}ms)`, requestId ? { requestId } : '');
}

async function toApiError(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  const requestId = payload.requestId || response.headers.get('X-Request-Id') || undefined;
  return new ApiError(payload.error || `${fallback} (${response.status})`, response.status, requestId, payload.details, payload.code);
}

async function authHeader() {
  try {
    let { data } = await supabase.auth.getSession();
    let session = data?.session;
    // Proactively refresh if access token is expired or expiring within 60s
    if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (!error && refreshed?.session) {
        session = refreshed.session;
      }
    }
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** Thin fetch wrapper: attaches the Supabase JWT and unwraps JSON errors. */
export async function request(path, { method = 'GET', body, signal, accessToken, _retry = false } = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    signal,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : await authHeader()),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  trace(method, path, response, startedAt);

  // If 401 occurs, attempt a silent token refresh and retry once
  if (response.status === 401 && !_retry) {
    try {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (!error && refreshed?.session?.access_token) {
        return request(path, { method, body, signal, accessToken, _retry: true });
      }
    } catch {
      // refresh error, fall through to throwing
    }
  }

  if (!response.ok) throw await toApiError(response, 'Request failed');

  return response.status === 204 ? null : response.json();
}

/**
 * Multipart upload. The browser must set its own multipart boundary, so this
 * deliberately does not send a Content-Type header.
 */
export async function upload(path, formData, { method = 'POST', _retry = false } = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: await authHeader(),
    body: formData,
  });

  trace(method, path, response, startedAt);

  // If 401 occurs, attempt a silent token refresh and retry once
  if (response.status === 401 && !_retry) {
    try {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (!error && refreshed?.session?.access_token) {
        return upload(path, formData, { method, _retry: true });
      }
    } catch {
      // refresh error, fall through to throwing
    }
  }

  if (!response.ok) throw await toApiError(response, 'Upload failed');

  return response.json();
}
