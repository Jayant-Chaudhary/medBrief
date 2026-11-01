/** Optional cache connection. No credentials, raw errors or audio reach logs. */
const { createClient, RESP_TYPES } = require('redis');
const config = require('./consultAudio.config');
const logger = require('../utils/logger');

function createRedisConnection(settings = config, clientFactory = createClient) {
  let client = null;
  let connecting = null;
  let stopped = false;
  let retryAt = 0;
  let failures = 0;

  function discard(current) {
    if (client === current) client = null;
    if (current?.isOpen) current.destroy();
  }

  function backoff() {
    failures += 1;
    retryAt = Date.now() + Math.min(
      settings.redisReconnectMaxDelayMs,
      settings.redisConnectTimeoutMs * (2 ** Math.min(failures - 1, 10)),
    );
  }

  function start() {
    if (!settings.audioCacheEnabled || stopped) return Promise.resolve(false);
    if (client?.isReady) return Promise.resolve(true);
    if (connecting) return connecting;
    if (Date.now() < retryAt) return Promise.resolve(false);

    // No offline queue or indefinite reconnect loop. A later operation retries
    // after the cooldown; database jobs continue through Storage meanwhile.
    connecting = (async () => {
      let current;
      let deadline;
      let warned = false;
      const warn = () => {
        if (warned) return;
        warned = true;
        logger.warn('Audio cache unavailable; using persistent storage', {
          scope: 'audio-cache', errorCode: 'ERR_AUDIO_CACHE_UNAVAILABLE',
        });
      };
      try {
        current = clientFactory({
          url: settings.redisUrl,
          disableOfflineQueue: true,
          commandsQueueMaxLength: settings.redisMaxPendingCommands,
          commandOptions: { timeout: settings.redisCommandTimeoutMs },
          socket: {
            connectTimeout: settings.redisConnectTimeoutMs,
            reconnectStrategy: false,
          },
        }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
        client = current;
        current.on('error', warn);
        // connectTimeout covers TCP establishment, not every handshake phase.
        // Destroying the client also rejects its pending handshake commands.
        deadline = setTimeout(() => discard(current), settings.redisConnectTimeoutMs);
        deadline.unref();
        await current.connect();
        if (stopped) {
          discard(current);
          return false;
        }
        failures = 0;
        logger.info('Audio cache connected', { scope: 'audio-cache' });
        return true;
      } catch (_err) {
        warn();
        discard(current);
        backoff();
        return false;
      } finally {
        clearTimeout(deadline);
      }
    })().finally(() => { connecting = null; });
    return connecting;
  }

  async function execute(operation) {
    if (!settings.audioCacheEnabled || stopped) return null;
    if (!client?.isReady) {
      void start();
      return null;
    }
    const current = client;
    // The client's queue timeout does not cover every sent command. Enforce a
    // response deadline too, releasing the socket and all outstanding replies.
    const deadline = setTimeout(() => {
      if (client !== current) return;
      discard(current);
      backoff();
      logger.warn('Audio cache response deadline exceeded; using persistent storage', {
        scope: 'audio-cache', errorCode: 'ERR_AUDIO_CACHE_TIMEOUT',
      });
    }, settings.redisCommandTimeoutMs);
    deadline.unref();
    try {
      return await operation(current);
    } catch (_err) {
      // Closing also releases sent-but-unanswered commands after a timeout.
      // Do not leave unbounded pending replies on an unhealthy connection.
      if (client === current) {
        discard(current);
        backoff();
        logger.warn('Audio cache operation failed; using persistent storage', {
          scope: 'audio-cache', errorCode: 'ERR_AUDIO_CACHE_OPERATION',
        });
      }
      return null;
    } finally {
      clearTimeout(deadline);
    }
  }

  function close() {
    stopped = true;
    discard(client);
  }

  return { start, execute, close };
}

module.exports = { ...createRedisConnection(), createRedisConnection };
