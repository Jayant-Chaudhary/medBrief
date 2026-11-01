const config = require('../../config/consultAudio.config');
const connection = require('../../config/redisClient');

function createAudioCache(redis = connection, settings = config) {
  function keyFor({ sessionId, session_id: sessionIdDb, device, seq }) {
    const session = sessionId || sessionIdDb;
    if (!session || !['doctor', 'patient'].includes(device)
        || !Number.isSafeInteger(Number(seq)) || Number(seq) < 0) {
      throw new Error('Invalid audio cache identity');
    }
    return `consult-audio:raw:${encodeURIComponent(session)}:${device}:${Number(seq)}`;
  }

  function validBuffer(bytes, expectedSize) {
    return Buffer.isBuffer(bytes) && bytes.length > 0
      && bytes.length <= settings.chunkMaxBytes
      && (expectedSize == null || bytes.length === Number(expectedSize));
  }

  async function put(identity, bytes) {
    if (!validBuffer(bytes)) return false;
    const result = await redis.execute((client) => client.set(keyFor(identity), bytes, {
      EX: settings.audioCacheTtlSec,
      NX: true,
    }));
    return result === 'OK' || (Buffer.isBuffer(result) && result.toString() === 'OK');
  }

  async function get(identity) {
    const bytes = await redis.execute((client) => client.get(keyFor(identity)));
    return validBuffer(bytes, identity.size_bytes) ? bytes : null;
  }

  async function remove(identity) {
    return await redis.execute((client) => client.del(keyFor(identity))) !== null;
  }

  return { put, get, remove, start: redis.start, close: redis.close };
}

module.exports = { ...createAudioCache(), createAudioCache };
