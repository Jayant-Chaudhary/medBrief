# Consultation audio: Redis cache implementation plan

Status: approved after the developer confirmed Supabase persistence; implementation and validation are recorded in `REDIS_CACHE_WALKTHROUGH.md`.

This is one bounded enhancement to the Phase 3 transcription worker, including its required hook in the existing chunk ingest service. It does not start another consultation-audio phase.

## 1. Agreed outcome

The doctor device sends chunks only to the authenticated Node HTTP endpoint. Node stores the persistent copy and supplies a temporary Redis copy for processing. The worker normally reads Redis instead of downloading the same bytes from Supabase.

```text
Doctor/patient device
        |
        | HTTPS POST /api/consults/:id/chunks
        v
Authenticated Node server
        |
        +--> private Supabase Storage: persistent compressed audio
        +--> Redis: temporary compressed audio bytes
        +--> Postgres: chunk metadata and existing transcription job
                              |
                              v
                         Node worker
                              |
                  Redis GET --+-- miss/error --> Supabase download
                              |
                      in-memory WAV conversion
                              |
                       Whisper or Sarvam
                              |
                     transcript --> Postgres
                              |
                      delete cached audio
```

Supabase Storage holds audio objects; Postgres holds metadata, jobs and transcripts. The server performs all writes. Redis is an optional cache, not the durable source or a new job queue.

## 2. What the repository already does

- `client/src/services/consultAudio/webRecorder.js` uploads to Node and discards an uploaded chunk after the HTTP success response. No direct device-to-Supabase upload needs removing.
- `server/src/services/consultAudio/chunkIngest.service.js` uploads non-silent bytes to the private `consult-audio` bucket, inserts `audio_chunks`, then inserts `transcription_jobs`.
- `server/src/services/consultAudio/transcriptionWorker.js` claims database jobs, downloads bytes from Storage, converts to WAV in memory and calls the provider interface.
- Existing identity is `(session_id, device, seq)`. Silent chunks have metadata only.
- The worker poll interval defaults to 1,000 ms. Caching removes the Storage read on a hit; it does not remove durable upload latency, database polling or provider execution time.
- The current enqueue path can acknowledge an upload despite a job insertion error. It also returns early for duplicate chunks. This needs a small, explicit retry repair as part of reliable integration, described below.

## 3. Implementation steps

### A. Local Redis and dependency

1. Add `server/docker-compose.redis.yml`, containing only a local Redis service.
2. Bind its port to `127.0.0.1`; the doctor browser and phone never connect to Redis. Add a health check.
3. Disable AOF and RDB snapshots and do not mount an audio data volume. Persistent audio already exists in Supabase; a Redis restart should simply empty the cache.
4. Set a configurable memory limit and `allkeys-lru` eviction. Eviction is safe because this instance contains only recoverable cached bytes, not durable queue state.
5. Add the maintained official `redis` Node client, initially pinned to verified stable `6.2.1`; use official Redis image `8.10.3-alpine`. Recheck release availability before installing and record the resolved versions. The client requires Node >=20, matching `server/package.json`; this workspace reports Node v24.14.0 and Docker Compose v5.2.0.
6. Do not introduce BullMQ, another worker queue or a Python Redis dependency.

### B. Cache configuration and connection lifecycle

1. Add a shared Redis connection module and a small audio-cache service with `put`, `get`, `remove` and `close` operations.
2. Store original compressed `Buffer` bytes, not base64 or JSON containing audio. Read them back as a `Buffer`.
3. Use namespaced keys derived only from session ID, device and sequence. Use an atomic write with expiry; duplicate requests must not replace a populated cache entry.
4. Put application settings in `consultAudio.config.js` and document them in `server/.env.example`:

   | Setting | Proposed default | Purpose |
   | --- | --- | --- |
   | `CONSULT_AUDIO_CACHE_ENABLED` | `false` | Explicit opt-in and rollback switch |
   | `REDIS_URL` | `redis://127.0.0.1:6379` | Server-side connection; never log credentials |
   | `AUDIO_CACHE_TTL_SEC` | `1800` | Maximum cache lifetime; fallback permits later retries |
   | `REDIS_CONNECT_TIMEOUT_MS` | `500` | Bound initial connection attempts |
   | `REDIS_COMMAND_TIMEOUT_MS` | `200` | Bound cache operations |
   | `REDIS_RECONNECT_MAX_DELAY_MS` | `5000` | Bound reconnect backoff |

   Local deployment sizing: `REDIS_MAXMEMORY_MB=256` in the Compose configuration, overridable through the server environment. These are operational starting points, not measured requirements.

5. Disable the client's offline command queue. Use supported bounded/abortable operations rather than leaving timed-out commands accumulating in memory.
6. Redis being disabled or unavailable must not prevent Node or the transcription worker from starting. Limit reconnect/log frequency and close the connection during graceful shutdown.
7. Register an error listener, but log only controlled error codes and timings. Never log raw Redis errors, connection URLs, buffers, provider responses or transcripts.

### C. Ingest: persistence and cache before job publication

For a new non-silent chunk:

1. Preserve existing authentication, device matching, validation, session gating and idempotency checks.
2. Upload the compressed bytes from Node to private Supabase Storage.
3. Attempt a bounded Redis cache write. Continue if Redis is unavailable, full or disabled.
4. Insert the existing chunk metadata and publish its existing database transcription job only after the cache attempt has completed. This avoids the normal worker racing ahead of cache population.
5. Return HTTP success only after persistent upload, chunk metadata and transcription-job publication have succeeded. A cache failure alone does not fail the request.

Handle Supabase's returned `error` objects as well as thrown errors. If metadata/job publication fails, return a controlled retryable error, not a false success. Best-effort cache cleanup and TTL cover incomplete ingests.

For duplicate uploads, keep the existing successful response and avoid uploading a second file. If a previous request persisted the chunk but failed before creating its job, repair the missing job. Use the chunk UUID as the primary-key ID for newly published jobs, and check for pre-existing legacy jobs by `chunk_id`, so concurrent repairs cannot create duplicate new jobs. Do not reset completed/active jobs or bypass the configured retry policy.

Silent chunks continue to create metadata only: no Redis bytes, Storage upload or provider call. No new table, route, schema migration or client request shape is proposed.

### D. Worker: cache first, durable fallback

1. Preserve the existing database job claim and concurrency control.
2. For a non-silent chunk, request cached bytes using its session/device/sequence identity.
3. On a cache hit, use the buffer directly and make zero Supabase Storage download calls.
4. On a miss, expiry, eviction, disabled cache, empty value or Redis error, download the durable copy through the existing path. Reject an invalid cached buffer rather than treating it as silence; fall back to Storage.
5. Keep in-memory WAV conversion, session timeline mapping, provider configuration and transcript storage behavior.
6. Delete cached bytes only after segment persistence and job/chunk completion updates report success. Cleanup failure must not turn a completed transcription into another provider call; TTL handles leftovers.
7. Retain cached audio during retryable processing failures. On terminal failure, attempt cache removal; the persistent copy remains available for an explicit later retry.
8. Check errors from completion writes before treating processing as complete. Remove raw provider error-message logging from the touched worker error path; use controlled error codes only.
9. Record source (`redis` or `storage`), counts and retrieval timings without health data. Do not add transcript text or audio to telemetry.

## 4. Files to create or change

| File | Planned change |
| --- | --- |
| `server/docker-compose.redis.yml` (new) | Loopback-only local Redis, health check, memory bound, no snapshots/AOF |
| `server/package.json`, `server/package-lock.json` | Official Redis client dependency |
| `server/src/config/consultAudio.config.js` | Validated cache settings and timeout/backoff defaults |
| `server/.env.example` | Placeholder Redis settings and local sizing |
| `server/src/config/redisClient.js` (new) | Shared connection, bounded operations, reconnect and shutdown |
| `server/src/services/consultAudio/audioCache.service.js` (new) | Binary cache keys, expiry, reads and deletion |
| `server/src/services/consultAudio/chunkIngest.service.js` | Cache population, checked job publication and duplicate retry repair |
| `server/src/services/consultAudio/transcriptionWorker.js` | Cache-first reads, fallback, cleanup and safe error reporting |
| `server/src/app.js` | Optional cache startup and shutdown integration |
| `server/src/tests/consultAudio/audioCache.test.js` (new) | Cache behavior, binary fidelity and bounded failure handling |
| `server/src/tests/consultAudio/audioCache.integration.test.js` (new) | Opt-in real Redis smoke test; explicit skip without test flag |
| `server/src/tests/consultAudio/chunkIngest.test.js` | Cache population, duplicate retry repair and durable acknowledgement |
| `server/src/tests/consultAudio/transcriptionWorker.test.js` | Hit/miss/outage paths, retry retention and completion cleanup |
| `docs/consult-audio/LOCAL_TESTING_GUIDE.md` | Setup, smoke test, restart drill, rollback and timing procedure |
| `docs/consult-audio/FILES_AND_PURPOSE.md` | New files and changed responsibilities |
| `docs/consult-audio/IMPLEMENTATION.md` | Record the approved cache addition without advancing phases |
| `docs/consult-audio/REDIS_CACHE_WALKTHROUGH.md` (new at completion) | Actual changes, executed checks, timings and remaining gaps |

## 5. Acceptance and verification

Use synthetic data only. Do not assume the existing audio fixtures are synthetic without verifying their provenance.

Automated checks must establish:

- A valid upload is sent by Node to Storage, cached byte-for-byte and queued once; job publication occurs after the cache attempt.
- A cache hit causes no Storage download and produces the same provider input and mapped transcript as the fallback path.
- Redis disabled, connection failure, command timeout, expiry, eviction or memory-pressure write rejection still allow processing from Storage.
- A persistent upload failure is not acknowledged or queued. A job publication failure is not acknowledged; retry repairs it without re-uploading or publishing duplicate jobs.
- Unauthorized, wrong-device and oversized requests do not write to Redis or Storage.
- Silent chunks do not enter Redis or invoke STT.
- Retryable provider or transcript-save errors do not prematurely remove cached bytes. Successful completion deletes them. A failed delete does not retry a successful provider call.
- Separate sessions/devices/sequences cannot reuse one another's cache keys. Duplicate requests do not extend the cache lifetime indefinitely.
- Log capture contains no synthetic audio marker, transcript marker, name marker, health value or Redis URL credentials, including injected failures.
- Real Redis testing verifies binary round-trip, TTL, explicit deletion and availability after reconnect; it uses an isolated test prefix and never flushes unrelated data.

Planned commands from `server/`:

```bash
docker compose -f docker-compose.redis.yml config
docker compose -f docker-compose.redis.yml up -d
npm test -- --runInBand src/tests/consultAudio/
RUN_REDIS_INTEGRATION=true npm test -- --runInBand src/tests/consultAudio/audioCache.integration.test.js
npm test -- --runInBand
```

Run `git diff --check` and syntax checks for changed JavaScript. No lint/typecheck scripts or project configurations were found in the inspected Node package setup; report those checks as unavailable rather than claiming they passed. Do not introduce a repository-wide tooling migration for this change.

Manual smoke test: upload synthetic chunks through Node using the existing simulator, verify Storage object and metadata, process with the fake provider, verify cache cleanup, then restart Redis and repeat queued processing to exercise Storage fallback. Use counts and timing output, not transcript dumps. If a live Supabase or Redis environment cannot be used, report the exact unexecuted steps.

Compare Redis-hit versus forced-cache-miss retrieval latency for the same synthetic inputs and record cache hit rate, Storage download count and processing time. Separate retrieval time from conversion/provider latency. Do not promise a speedup before measuring it. A real Whisper/GPU or Sarvam smoke test is optional and must be reported separately from fake-provider test evidence.

## 6. Boundaries and known limitations

- No React/Flutter upload changes, consent changes, new sockets, provider API changes, queue replacement or automatic provider switching.
- No audio files written to Render disk. No Redis persistence or backups for this disposable cache. Production Redis must be privately reachable from the Node server; localhost configuration is for local development only.
- This change preserves the existing persistent audio retention policy; it does not promise permanent retention or implement deletion after doctor review. That is separate from Redis expiry.
- The existing worker can leave partially committed transcript segments if it crashes between database writes. This plan does not claim exactly-once transcript persistence or silently expand into a transcript transaction/schema redesign. Cache fallback preserves audio recovery; transactional transcript completion remains a separately scoped follow-up.
- Unrelated existing readiness, transcript-viewer and failed-job auto-requeue issues stay outside this cache change.
- Disable `CONSULT_AUDIO_CACHE_ENABLED` and restart Node to roll back to Storage-only reads. Old cache entries expire naturally; persistent objects and jobs remain intact.

## 7. References checked during planning

- [Official node-redis releases](https://github.com/redis/node-redis/releases) and [stable 6.2.1 package/Node requirement](https://raw.githubusercontent.com/redis/node-redis/redis@6.2.1/packages/redis/package.json).
- [Official Redis Docker image tags](https://raw.githubusercontent.com/docker-library/official-images/master/library/redis).
- [Official Node client configuration](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md) and [production usage](https://redis.io/docs/latest/develop/clients/nodejs/produsage/): connection/error handling and bounded cache behavior.
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/): disabling disk persistence is appropriate here because Supabase owns the durable copy.
- DevRelay tools are not available in this session, so no community-source findings are claimed.

Planning evidence only: repository/code/test inspection, official documentation checks, `node --version` and `docker compose version`. No dependency installation, service startup, product code changes or acceptance tests have been performed for this plan.
