/**
 * Security defaults must fail closed: an unset NODE_ENV is production, and a
 * missing signing secret stops startup outside development and test.
 */

describe('runtime environment gates', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  const load = (path) => {
    jest.resetModules();
    return require(path);
  };

  describe('isDevOrTest', () => {
    it.each([
      ['development', true],
      ['test', true],
      ['production', false],
      ['staging', false],
      [undefined, false],
    ])('NODE_ENV=%s -> %s', (value, expected) => {
      if (value === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = value;
      expect(load('../config/runtimeEnv').isDevOrTest()).toBe(expected);
    });
  });

  describe('signing secrets', () => {
    it('refuses to load consult config without SESSION_TOKEN_SECRET when NODE_ENV is unset', () => {
      delete process.env.NODE_ENV;
      delete process.env.SESSION_TOKEN_SECRET;
      expect(() => load('../config/consultAudio.config')).toThrow(/SESSION_TOKEN_SECRET/);
    });

    it('refuses to load storage config without an HMAC secret in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.STORAGE_PROXY_HMAC_SECRET;
      delete process.env.SESSION_TOKEN_SECRET;
      expect(() => load('../config/storageEncryption.config')).toThrow(/STORAGE_PROXY_HMAC_SECRET/);
    });

    it('uses the configured secret in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.STORAGE_PROXY_HMAC_SECRET = 'synthetic-test-secret';
      expect(load('../config/storageEncryption.config').proxyHmacSecret).toBe('synthetic-test-secret');
    });

    it('keeps the local fallback in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.SESSION_TOKEN_SECRET;
      expect(load('../config/consultAudio.config').sessionTokenSecret).toMatch(/^dev-/);
    });
  });

  describe('clinician self-verification', () => {
    it('is off when NODE_ENV is unset, even with DEMO_SELF_VERIFY=true', () => {
      process.env.SESSION_TOKEN_SECRET = 'synthetic-test-secret';
      delete process.env.NODE_ENV;
      process.env.DEMO_SELF_VERIFY = 'true';
      jest.resetModules();
      // As on a host with no .env file: a local .env would refill NODE_ENV.
      jest.doMock('dotenv', () => ({ config: jest.fn() }));
      expect(require('../config/env').isSelfVerifyPermitted()).toBe(false);
    });
  });
});
