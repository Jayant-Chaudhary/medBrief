/**
 * Unit Tests for Request Logger Middleware (Phase 8).
 *
 * Verifies:
 * 1. URL sanitization scrubs path tokens (invite tokens, reset password tokens, long hashes).
 * 2. Sensitive query parameters (tokens, keys, secrets, passwords, patient IDs, emails) are redacted.
 * 3. Log lines and meta objects never contain credentials or patient identifiers.
 * 4. Safe correlation ID handling via X-Request-Id.
 */

const requestLogger = require('../middleware/requestLogger');
const { sanitizeUrl } = require('../middleware/requestLogger');
const logger = require('../utils/logger');

describe('Request Logger Middleware & URL Sanitizer (Phase 8)', () => {
  describe('sanitizeUrl()', () => {
    test('scrubs invite and password reset tokens in path', () => {
      const inviteUrl = '/api/auth/invite/0123456789abcdef0123456789abcdef';
      expect(sanitizeUrl(inviteUrl)).toBe('/api/auth/invite/:token');

      const resetUrl = '/api/auth/reset-password/fedcba9876543210fedcba9876543210';
      expect(sanitizeUrl(resetUrl)).toBe('/api/auth/reset-password/:token');
    });

    test('scrubs generic long hex or opaque token path segments (> 24 chars)', () => {
      const tokenUrl = '/api/verify/48492049102481024810248102481024';
      expect(sanitizeUrl(tokenUrl)).toBe('/api/verify/:token');

      // UUID paths should be preserved as standard IDs
      const uuidUrl = '/api/consults/12345678-1234-1234-1234-123456789abc/state';
      expect(sanitizeUrl(uuidUrl)).toBe('/api/consults/12345678-1234-1234-1234-123456789abc/state');
    });

    test('redacts sensitive query parameters while preserving non-sensitive parameters', () => {
      const raw = '/api/consults/sess-1/chunks?device=doctor&seq=0&token=secret-token-xyz&patient_id=pat-99';
      const sanitized = sanitizeUrl(raw);

      expect(sanitized).toContain('device=doctor');
      expect(sanitized).toContain('seq=0');
      expect(sanitized).toContain('token=%5BREDACTED%5D');
      expect(sanitized).toContain('patient_id=%5BREDACTED%5D');
      expect(sanitized).not.toContain('secret-token-xyz');
      expect(sanitized).not.toContain('pat-99');
    });

    test('handles URLs without query strings cleanly', () => {
      expect(sanitizeUrl('/health')).toBe('/health');
      expect(sanitizeUrl('/api/appointments')).toBe('/api/appointments');
    });
  });

  describe('requestLogger middleware execution', () => {
    let req, res, next, loggedLines, logSpies;

    beforeEach(() => {
      loggedLines = [];
      const capture = (level) => (msg, meta) => {
        loggedLines.push({ level, msg, meta });
      };

      logSpies = [
        jest.spyOn(logger, 'debug').mockImplementation(capture('debug')),
        jest.spyOn(logger, 'info').mockImplementation(capture('info')),
        jest.spyOn(logger, 'warn').mockImplementation(capture('warn')),
        jest.spyOn(logger, 'error').mockImplementation(capture('error')),
      ];

      req = {
        method: 'GET',
        originalUrl: '/api/auth/invite/secret-invite-token-12345678901234567890?auth_token=super-secret',
        path: '/api/auth/invite/secret-invite-token-12345678901234567890',
        get: jest.fn().mockReturnValue(null),
      };

      const listeners = {};
      res = {
        statusCode: 200,
        setHeader: jest.fn(),
        on: jest.fn((event, cb) => {
          listeners[event] = cb;
        }),
        emitFinish: () => listeners['finish']?.(),
      };

      next = jest.fn();
    });

    afterEach(() => {
      logSpies.forEach((s) => s.mockRestore());
    });

    test('scrubs credentials from both request started and request completed logs', () => {
      requestLogger(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));

      // Trigger finish
      res.emitFinish();

      expect(loggedLines.length).toBeGreaterThanOrEqual(2);

      for (const line of loggedLines) {
        // Must never leak the raw token or query secret
        expect(line.msg).not.toContain('secret-invite-token');
        expect(line.msg).not.toContain('super-secret');
        if (line.meta && line.meta.url) {
          expect(line.meta.url).not.toContain('secret-invite-token');
          expect(line.meta.url).not.toContain('super-secret');
        }
      }

      // Completed request message should contain sanitized route
      const finishLine = loggedLines.find((l) => l.level === 'info');
      expect(finishLine).toBeDefined();
      expect(finishLine.msg).toContain('/api/auth/invite/:token');
    });
  });
});
