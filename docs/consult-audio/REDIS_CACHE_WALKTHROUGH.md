# Redis audio cache walkthrough

Implemented 2026-11-01 as the approved Phase 3 worker enhancement. No later phase was started.

## Result

```text
Device -> authenticated Node upload
              -> private Supabase Storage (persistent compressed audio)
              -> optional Redis (temporary compressed audio)
              -> Postgres chunk + existing transcription job

Worker -> Redis hit, otherwise Storage download
       -> in-memory WAV conversion -> configured STT provider
       -> Postgres transcript + completion updates -> delete cache entry
```

The device already uploaded through Node. No React/Flutter or provider API changes were necessary. No new table or migration was introduced. Supabase remains the durable audio source, and Postgres remains the metadata/job/transcript store.

## Changes

- Added `server/docker-compose.redis.yml`: official Redis `8.10.3-alpine`, loopback-only port, configurable 256 MB memory ceiling, LRU eviction, no AOF/snapshots.
- Installed the official `redis` client pinned to `6.2.1`; npm confirms Node >=20 compatibility.
- Added `server/src/config/redisClient.js` and `server/src/services/consultAudio/audioCache.service.js`: optional connection, binary bytes, namespaced keys, atomic NX/expiry, size validation, bounded pending commands, reconnect cooldown, safe error codes and shutdown.
- Added independently enforced handshake and command-response deadlines. Actual socket tests showed that the library's TCP/queue timeouts alone did not bound all waits; expiration now closes the affected socket and releases pending operations.
- Updated ingest to populate cache before job publication, check Supabase job insertion errors and return retryable failure instead of false success. Retrying a persisted chunk repairs an absent job using a deterministic primary key while preserving legacy/active/completed jobs.
- Updated the worker to prefer Redis, fall back to Storage, report retrieval source/time, check completion writes and remove cached bytes after successful processing or terminal failure. Retryable failures retain cache entries; failed cleanup does not retry a completed transcription.
- Removed raw provider error messages/codes from the touched worker failure log path. Cache errors never log connection credentials or raw messages.
- Added config/env examples, startup/shutdown integration, cache/failure/real Redis tests and local setup/manual verification instructions.

Application settings default to cache disabled for explicit opt-in and rollback. Redis unavailability does not block durable uploads or database workers. See `LOCAL_TESTING_GUIDE.md`, section **Optional server-side Redis audio cache**, for activation.

## Observed verification

| Check | Observed result |
| --- | --- |
| Baseline consultation suite before implementation | 6 suites, 60 tests passed |
| Final consultation suite with real Redis enabled | 8 suites, 95 tests passed |
| Final complete backend suite with real Redis enabled | 29 suites, 496 tests passed |
| JavaScript syntax | `node --check` passed for all 10 changed/new JavaScript files |
| Patch whitespace | `git diff --check` passed |
| Compose configuration | `docker compose -f docker-compose.redis.yml config` passed |
| Compose startup | Could not start: Docker Desktop engine/socket unavailable, including after an attempted Desktop start |
| Alternative real Redis verification | Official Redis 8.10.3 source downloaded and built under `/tmp`, run on loopback port 6399 with persistence disabled, and shut down after verification |

Tests using local HTTP/TCP sockets initially encountered sandbox `EPERM` and were rerun with the required execution permission. This was an execution-environment restriction, not a product failure.

Final backend command, from `server/`, against the temporary real Redis process:

```bash
RUN_REDIS_INTEGRATION=true REDIS_URL=redis://127.0.0.1:6399 npm test -- --runInBand --coverage=false
```

The real Redis tests cover binary round-trip, duplicate NX behavior, expiry, deletion, connection loss/reconnect and a blocked command deadline. Ingest-through-worker tests use real Redis, a fake STT provider, synthetic bytes, mocked conversion and mocked Supabase persistence. They establish zero Storage downloads on a cache hit, one on a forced miss, byte-equivalent provider input, saved transcript/completion and cache cleanup. They do not establish live Supabase or STT-provider behavior.

Additional tests cover disabled/unavailable cache, invalid buffers, key isolation, durable upload/metadata/publication failures, duplicate repair/concurrent repair, unauthorized/oversized uploads, silent chunks, retry retention, failed completion writes and safe logging with synthetic sensitive markers.

## Measured local retrieval

A scratch benchmark made 100 sequential reads of 64,000 synthetic bytes through the actual cache service against the temporary loopback Redis server:

| Metric | Observed value |
| --- | --- |
| Redis retrieval p50 | 0.046 ms |
| Redis retrieval p95 | 0.131 ms |

This is a local microbenchmark, not an overall consultation speedup or a cloud comparison. Live Supabase retrieval latency, production cache hit rate and real conversion/provider timings were not measured. The normal cache-hit path eliminates the Storage download; durable upload, database polling and provider latency remain.

## Remaining manual/deployment checks and boundaries

- Start a functioning Docker engine, then follow the guide's Compose startup and `server/.env` opt-in steps. The project container was not started successfully in this environment. The temporary `/tmp` source build is test infrastructure, not the project deployment.
- Follow the guide's live Supabase synthetic-session upload and Redis restart/outage drills. No live Supabase project, microphone, real Whisper/GPU service or Sarvam API was exercised in this change. Existing audio fixture provenance was not assumed; tests use generated synthetic data.
- No lint or typecheck scripts/configuration are defined for this Node package. Those checks are unavailable, rather than claimed as passed; syntax and executed regression tests provide the available validation.
- Persistent audio retention is unchanged and separate from Redis TTL. No automatic deletion after doctor review was added.
- Existing transcript writes are not one database transaction. A crash after segment insertion but before job completion can still cause repeated segments on retry; exactly-once persistence is a separate follow-up, not a cache guarantee.
- Existing failed-job auto-requeue, readiness and transcript-viewer issues were not changed. Provider adapters and pre-flight STT endpoints were not modified or globally audited for logging in this increment.
- DevRelay tools were unavailable in this session; no community-source findings are claimed. Dependency behavior was checked against the installed official client and real Redis.

Rollback: set `CONSULT_AUDIO_CACHE_ENABLED=false` and restart Node. Storage and database jobs remain available; disposable Redis keys expire naturally.
