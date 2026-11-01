/** Opt-in smoke test against an isolated real Redis cache. No Supabase/API keys. */
const { randomUUID } = require('crypto');
const { createRedisConnection } = require('../../config/redisClient');
const { createAudioCache } = require('../../services/consultAudio/audioCache.service');
const config = require('../../config/consultAudio.config');
const audioCache = require('../../services/consultAudio/audioCache.service');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const { ingestChunk } = require('../../services/consultAudio/chunkIngest.service');
const { processJob } = require('../../services/consultAudio/transcriptionWorker');
const { convertTo16kHzMonoWav } = require('../../utils/audioConverter');
const FakeProvider = require('../../services/consultAudio/stt/fakeProvider');

jest.mock('../../config/supabaseAdminClient', () => ({ from: jest.fn(), storage: { from: jest.fn() } }));
jest.mock('../../utils/audioConverter', () => ({ convertTo16kHzMonoWav: jest.fn() }));

const describeRedis = process.env.RUN_REDIS_INTEGRATION === 'true' ? describe : describe.skip;

describeRedis('Real Redis binary audio cache', () => {
  let connection;
  let cache;
  let identity;
  beforeAll(async () => {
    connection = createRedisConnection({ ...config, audioCacheEnabled: true });
    cache = createAudioCache(connection, { ...config, audioCacheTtlSec: 1 });
    identity = { sessionId: `synthetic-redis-test-${randomUUID()}`, device: 'doctor', seq: 0 };
    expect(await connection.start()).toBe(true);
  });
  afterAll(async () => {
    if (cache && identity) await cache.remove(identity);
    connection?.close();
  });
  afterEach(() => jest.restoreAllMocks());

  test('round-trips binary bytes, preserves NX, deletes and expires without flushing other keys', async () => {
    const bytes = Buffer.from([0, 255, 128, 13, 10, 0]);
    expect(await cache.put(identity, bytes)).toBe(true);
    expect(await cache.get(identity)).toEqual(bytes);
    expect(await cache.put(identity, Buffer.from('replacement'))).toBe(false);
    expect(await cache.get(identity)).toEqual(bytes);
    expect(await cache.remove(identity)).toBe(true);
    expect(await cache.get(identity)).toBeNull();
    expect(await cache.put(identity, bytes)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await cache.get(identity)).toBeNull();
  });

  test('reconnects after a lost connection without retaining commands offline', async () => {
    const bytes = Buffer.from('synthetic-reconnect');
    await cache.put(identity, bytes);
    await connection.execute((client) => client.destroy());
    expect(await connection.start()).toBe(true);
    expect(await cache.get(identity)).toEqual(bytes);
    await cache.remove(identity);
  });

  test.each(['hit', 'miss'])('ingest through worker uses real Redis (%s) and mocked persistent storage', async (mode) => {
    const fixture = mockPersistence();
    jest.spyOn(audioCache, 'put').mockImplementation(cache.put);
    jest.spyOn(audioCache, 'get').mockImplementation(cache.get);
    jest.spyOn(audioCache, 'remove').mockImplementation(cache.remove);
    const bytes = Buffer.from([0, 255, 128, 1, 2, 3]);
    convertTo16kHzMonoWav.mockResolvedValue(Buffer.from('synthetic-wav-buffer'));
    await ingestChunk({
      ...identity, startMs: 0, durationMs: 15000, codec: 'audio/wav', audioBuffer: bytes,
    });
    expect(fixture.upload).toHaveBeenCalledTimes(1);
    expect(await cache.get(identity)).toEqual(bytes);
    if (mode === 'miss') await cache.remove(identity);
    const result = await processJob(fixture.job(), new FakeProvider());
    expect(result.ok).toBe(true);
    expect(result.audioSource).toBe(mode === 'hit' ? 'redis' : 'storage');
    expect(fixture.download).toHaveBeenCalledTimes(mode === 'hit' ? 0 : 1);
    expect(fixture.segments().length).toBeGreaterThan(0);
    expect(fixture.job().status).toBe('completed');
    expect(await cache.get(identity)).toBeNull();
    expect(convertTo16kHzMonoWav).toHaveBeenCalledWith(bytes);
  });

  test('a real blocked command times out and its connection is released', async () => {
    const blocked = createRedisConnection({ ...config, audioCacheEnabled: true, redisCommandTimeoutMs: 30 });
    let guard;
    try {
      expect(await blocked.start()).toBe(true);
      const result = await Promise.race([
        blocked.execute((client) => client.blPop(`synthetic-blocked-${randomUUID()}`, 0)),
        new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('Command did not time out')), 1000); }),
      ]);
      expect(result).toBeNull();
    } finally {
      clearTimeout(guard);
      blocked.close();
    }
  });
});

/** In-memory synthetic Supabase stand-in. Real Redis is intentionally not mocked. */
function mockPersistence() {
  let chunk;
  let job;
  let segments = [];
  let storedBytes;
  const upload = jest.fn(async (_path, bytes) => {
    storedBytes = Buffer.from(bytes);
    return { error: null };
  });
  const download = jest.fn(async () => ({
    data: { arrayBuffer: async () => storedBytes }, error: null,
  }));
  supabaseAdmin.storage.from.mockReturnValue({ upload, download });
  supabaseAdmin.from.mockImplementation((table) => {
    let action = 'read';
    let payload;
    function finish() {
      if (action === 'insert') {
        if (table === 'audio_chunks') chunk = { ...payload, id: randomUUID() };
        if (table === 'transcription_jobs') job = { ...payload };
        if (table === 'segments') segments.push(...payload);
      }
      if (action === 'update') Object.assign(table === 'audio_chunks' ? chunk : job, payload);
      const data = table === 'audio_chunks' ? chunk
        : table === 'transcription_jobs' ? job
          : table === 'consult_sessions' ? { status: 'recording', language_code: 'hi' } : null;
      return { data, error: null };
    }
    return {
      select() { return this; }, eq() { return this; },
      insert(value) { action = 'insert'; payload = value; return this; },
      update(value) { action = 'update'; payload = value; return this; },
      single: async () => finish(), maybeSingle: async () => finish(),
      limit: async () => ({ data: job ? [job] : [], error: null }),
      then(resolve, reject) { return Promise.resolve(finish()).then(resolve, reject); },
    };
  });
  return { upload, download, job: () => job, segments: () => segments };
}
