import { supabase } from './supabaseClient.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

// Traces every API call to the console in dev, or anywhere with VITE_DEBUG_API=true.
// Set VITE_DEBUG_API=false to silence it in dev.
const DEBUG_API =
  import.meta.env.VITE_DEBUG_API === 'true' ||
  (import.meta.env.DEV && import.meta.env.VITE_DEBUG_API !== 'false');

export class ApiError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // Matches the server's log lines for this request.
    this.requestId = requestId;
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
  return new ApiError(payload.error || `${fallback} (${response.status})`, response.status, requestId);
}

async function authHeader() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** Thin fetch wrapper: attaches the Supabase JWT and unwraps JSON errors. */
export async function request(path, { method = 'GET', body, signal } = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    signal,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeader()),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  trace(method, path, response, startedAt);
  if (!response.ok) throw await toApiError(response, 'Request failed');

  return response.status === 204 ? null : response.json();
}

/**
 * Multipart upload. The browser must set its own multipart boundary, so this
 * deliberately does not send a Content-Type header.
 */
export async function upload(path, formData, { method = 'POST' } = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: await authHeader(),
    body: formData,
  });

  trace(method, path, response, startedAt);
  if (!response.ok) throw await toApiError(response, 'Upload failed');

  return response.json();
}
