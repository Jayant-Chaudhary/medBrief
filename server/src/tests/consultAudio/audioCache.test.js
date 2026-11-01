const net = require('net');
const { createAudioCache } = require('../../services/consultAudio/audioCache.service');
const { createRedisConnection } = require('../../config/redisClient');
const logger = require('../../utils/logger');

const settings = {
  audioCacheEnabled: true,
  redisUrl: 'redis://user:synthetic-secret@127.0.0.1:6379',
  audioCacheTtlSec: 1800,
  chunkMaxBytes: 1024,
  redisConnectTimeoutMs: 30,
  redisCommandTimeoutMs: 30,
  redisReconnectMaxDelayMs: 100,
  redisMaxPendingCommands: 8,
};

describe('Disposable audio cache', () => {
  let client;
  let cache;
  const identity = { sessionId: 'synthetic-session', device: 'doctor', seq: 0 };

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
    };
    cache = createAudioCache({ execute: (operation) => operation(client) }, settings);
  });

  test('keeps binary bytes intact and writes with atomic expiry and NX', async () => {
    const bytes = Buffer.from([0, 255, 128, 1]);
    expect(await cache.put(identity, bytes)).toBe(true);
    const [key, storedBytes, options] = client.set.mock.calls[0];
    expect(storedBytes).toEqual(bytes);
    expect(options).toEqual({ EX: 1800, NX: true });
    client.get.mockResolvedValue(storedBytes);
    expect(await cache.get({ ...identity, size_bytes: bytes.length })).toEqual(bytes);
    expect(client.get).toHaveBeenCalledWith(key);
    await cache.remove(identity);
    expect(client.del).toHaveBeenCalledWith(key);
  });

  test('does not refresh an existing entry or its lifetime', async () => {
    client.set.mockResolvedValue(null);
    expect(await cache.put(identity, Buffer.from('synthetic'))).toBe(false);
    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set.mock.calls[0][2]).toEqual({ EX: 1800, NX: true });
  });

  test.each([null, '', 'not-binary', Buffer.alloc(0), Buffer.alloc(1025)])(
    'treats missing or invalid cached bytes as a miss (%#)', async (value) => {
      client.get.mockResolvedValue(value);
      expect(await cache.get(identity)).toBeNull();
    },
  );

  test('treats a length mismatch as a miss', async () => {
    client.get.mockResolvedValue(Buffer.from('synthetic'));
    expect(await cache.get({ ...identity, size_bytes: 10 })).toBeNull();
  });

  test('does not send empty, oversized or non-binary data to Redis', async () => {
    for (const value of [null, '', Buffer.alloc(0), Buffer.alloc(1025)]) {
      expect(await cache.put(identity, value)).toBe(false);
    }
    expect(client.set).not.toHaveBeenCalled();
  });

  test('isolates sessions, devices and sequences, including separator characters', async () => {
    for (const value of [identity, { ...identity, sessionId: 'other:session' },
      { ...identity, device: 'patient' }, { ...identity, seq: 1 }]) {
      await cache.put(value, Buffer.from('synthetic'));
    }
    expect(new Set(client.set.mock.calls.map(([key]) => key)).size).toBe(4);
  });
});

describe('Optional Redis connection', () => {
  let connections;
  beforeEach(() => { connections = []; });
  afterEach(() => {
    connections.forEach((connection) => connection.close());
    jest.restoreAllMocks();
  });

  function connection(factory, overrides = {}) {
    const value = createRedisConnection({ ...settings, ...overrides }, factory);
    connections.push(value);
    return value;
  }

  test('disabled cache never creates a client', async () => {
    const factory = jest.fn();
    const redis = connection(factory, { audioCacheEnabled: false });
    expect(await redis.start()).toBe(false);
    expect(await redis.execute(jest.fn())).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  test('connection errors fall back, back off and never log credentials or raw errors', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const factory = jest.fn(() => { throw new Error(settings.redisUrl); });
    const redis = connection(factory);
    expect(await redis.start()).toBe(false);
    expect(await redis.start()).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-secret');
    expect(await redis.execute(jest.fn())).toBeNull();
  });

  test('command failures release the connection and stop accepting queued commands', async () => {
    const client = {
      isOpen: true, isReady: true,
      withTypeMapping: jest.fn().mockReturnThis(), on: jest.fn(),
      connect: jest.fn().mockResolvedValue(), destroy: jest.fn(),
    };
    const factory = jest.fn().mockReturnValue(client);
    const redis = connection(factory);
    expect(await redis.start()).toBe(true);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      disableOfflineQueue: true, commandsQueueMaxLength: 8,
      commandOptions: { timeout: 30 },
    }));
    expect(await redis.execute(() => Promise.reject(new Error('synthetic audio marker')))).toBeNull();
    expect(client.destroy).toHaveBeenCalledTimes(1);
    const operation = jest.fn();
    expect(await redis.execute(operation)).toBeNull();
    expect(operation).not.toHaveBeenCalled();
    redis.close();
    expect(await redis.start()).toBe(false);
  });

  test('a real unresponsive TCP peer cannot hang the Redis handshake', async () => {
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const redis = connection(undefined, { redisUrl: `redis://127.0.0.1:${server.address().port}` });
    let guard;
    try {
      const result = await Promise.race([
        redis.start(),
        new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('Handshake did not time out')), 1000); }),
      ]);
      expect(result).toBe(false);
    } finally {
      clearTimeout(guard);
      redis.close();
      sockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
