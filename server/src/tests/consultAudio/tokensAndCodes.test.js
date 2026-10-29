/**
 * Scoped Tokens, Guards, and Room Codes Unit Tests.
 */

const jwt = require('jsonwebtoken');
const { signSessionToken, verifySessionToken } = require('../../services/consultAudio/token.service');
const {
  generateRoomCode,
  getRoomCodeExpiry,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
} = require('../../services/consultAudio/roomCode.service');
const sessionTokenGuard = require('../../middleware/sessionTokenGuard');

describe('Scoped Session Tokens & Room Codes', () => {
  describe('signSessionToken & verifySessionToken', () => {
    test('signs and successfully verifies a valid scoped token', () => {
      const claims = {
        sessionId: 'sess-abc-123',
        device: 'doctor',
        role: 'doctor',
        userId: 'user-doc-1',
      };

      const token = signSessionToken(claims);
      expect(typeof token).toBe('string');

      const verified = verifySessionToken(token);
      expect(verified.sessionId).toBe(claims.sessionId);
      expect(verified.device).toBe(claims.device);
      expect(verified.role).toBe(claims.role);
      expect(verified.userId).toBe(claims.userId);
    });

    test('rejects missing claims during signing', () => {
      expect(() => signSessionToken({ sessionId: '123' })).toThrow(/Missing required claims/);
    });

    test('rejects tampered or forged tokens', () => {
      const token = signSessionToken({
        sessionId: 'sess-abc-123',
        device: 'patient',
        role: 'patient',
        userId: 'user-pt-1',
      });

      const tampered = token.slice(0, -5) + 'abcde';
      expect(() => verifySessionToken(tampered)).toThrow();
    });

    test('rejects tokens signed with different secret', () => {
      const badToken = jwt.sign(
        { sessionId: 'sess-abc-123', device: 'doctor', role: 'doctor', userId: 'user-1', type: 'consult_device_token' },
        'wrong-secret'
      );
      expect(() => verifySessionToken(badToken)).toThrow();
    });
  });

  describe('sessionTokenGuard Middleware', () => {
    const validClaims = {
      sessionId: 'sess-target-1',
      device: 'doctor',
      role: 'doctor',
      userId: 'user-1',
    };
    const validToken = signSessionToken(validClaims);

    function createMockReqRes({ authHeader, params = {} }) {
      const req = {
        headers: authHeader ? { authorization: authHeader } : {},
        params,
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();
      return { req, res, next };
    }

    test('returns 401 when Authorization header is missing', () => {
      const { req, res, next } = createMockReqRes({ authHeader: null });
      sessionTokenGuard(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when token is invalid', () => {
      const { req, res, next } = createMockReqRes({ authHeader: 'Bearer invalid-token' });
      sessionTokenGuard(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 403 when session id in token does not match route param', () => {
      const { req, res, next } = createMockReqRes({
        authHeader: `Bearer ${validToken}`,
        params: { id: 'different-session-id' },
      });
      sessionTokenGuard(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/not authorized for this session/i) }));
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 403 when device in token does not match route param', () => {
      const { req, res, next } = createMockReqRes({
        authHeader: `Bearer ${validToken}`,
        params: { id: 'sess-target-1', device: 'patient' }, // token is for 'doctor'
      });
      sessionTokenGuard(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/not authorized for this device/i) }));
      expect(next).not.toHaveBeenCalled();
    });

    test('attaches req.sessionToken and calls next() on valid token and matching params', () => {
      const { req, res, next } = createMockReqRes({
        authHeader: `Bearer ${validToken}`,
        params: { id: 'sess-target-1', device: 'doctor' },
      });
      sessionTokenGuard(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.sessionToken.sessionId).toBe('sess-target-1');
      expect(req.sessionToken.device).toBe('doctor');
    });
  });

  describe('Room Codes & Rate Limiting', () => {
    test('generates 6-character unambiguous uppercase codes', () => {
      for (let i = 0; i < 20; i++) {
        const code = generateRoomCode();
        expect(code).toHaveLength(6);
        expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/);
        // Ensure no ambiguous chars: 0, O, 1, I, L
        expect(code).not.toMatch(/[0O1IL]/);
      }
    });

    test('generates valid future expiry ISO string', () => {
      const expiry = getRoomCodeExpiry();
      const expiryDate = new Date(expiry);
      expect(expiryDate.getTime()).toBeGreaterThan(Date.now());
    });

    test('rate limits after max failed join attempts', () => {
      const testKey = 'test-ip-123:CODE99';
      clearRateLimit(testKey);

      for (let i = 0; i < 5; i++) {
        const check = checkRateLimit(testKey);
        expect(check.allowed).toBe(true);
        recordFailedAttempt(testKey);
      }

      const blockedCheck = checkRateLimit(testKey);
      expect(blockedCheck.allowed).toBe(false);
      expect(blockedCheck.retryAfterSec).toBeGreaterThan(0);

      clearRateLimit(testKey);
    });
  });
});
