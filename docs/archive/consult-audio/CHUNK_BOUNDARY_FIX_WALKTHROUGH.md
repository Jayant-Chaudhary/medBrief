# Doctor recorder chunk boundary fix

## Failure and changes

Short recordings could convert successfully, while recordings crossing the 25-second hard cap produced invalid WebM chunks. The old recorder's `dataavailable` callback wrote into the shared active buffer after the next recorder had replaced it. Its `stop` callback could then package the next recorder's data instead of its own container header and final bytes.

`client/src/services/consultAudio/webRecorder.js` now gives each MediaRecorder its own buffer, including the last asynchronous `dataavailable` event. Finalization enqueues chunks in sequence even when recorder stop callbacks arrive out of order. Stop waits for finalization and the upload queue before posting the final marker; repeated Stop calls share the same operation. A recorder finalization failure is reported and prevents a false final marker.

Malformed large chunks also exposed a separate server crash: ffmpeg can close its input pipe while Node is still writing, causing an asynchronous, unhandled `EPIPE`. `server/src/utils/audioConverter.js` now handles stdin errors, rejects once with a controlled code, and drains ffmpeg diagnostics without exposing input contents. The worker preserves these known conversion error codes for its existing retry/failure handling.

No routes, schema, provider selection, OCR, authentication or dashboard code changed for this fix. No dependencies or new configuration were needed. Supabase remains persistent storage. Phase 5 has not started.

## Executed verification

All generated test audio and recorder fixtures were synthetic. No existing consultation audio or transcripts were downloaded.

- The new client regression tests initially failed on the old implementation. After the fix, all 12 client tests passed, including five asynchronous recorder tests: buffer isolation, final data/upload ordering, reversed stop callback order, repeated Stop and recorder stop failure.
- All 499 backend tests passed with `RUN_REDIS_INTEGRATION=true`, including five real Redis checks and three real ffmpeg conversion checks. The malformed-input test uses a separate Node process to detect an unhandled pipe crash.
- `npm run build` in `client` passed. Vite reported its bundle size warning. Neither package defines separate lint or type-check scripts.
- A standalone headless Chrome check used a Web Audio oscillator stream for a real 55-second recording, with cuts at approximately 25, 50 and 55 seconds. Each emitted chunk started with a WebM header, decoded through the server's ffmpeg utility, and received HTTP 200 from local Whisper. Decoded durations were 24,900 ms, 24,960 ms and 4,980 ms. Event order was `chunk:0`, `chunk:1`, `chunk:2`, `final:3`. The check stubbed the upload queue and final-marker transport, so it validates real browser packaging/conversion and Whisper acceptance, not a live Supabase upload. Client regression tests exercise HTTP ordering with mocked acknowledgements.
- Docker Compose's local Redis container was healthy on loopback port 6379. The API and local CUDA Whisper health endpoints responded successfully. The current server environment still has the optional Redis cache disabled; a running Redis container does not enable the cache automatically.

Re-run automated tests from the repository root:

```bash
cd server
RUN_REDIS_INTEGRATION=true npm test -- --runInBand --coverage=false
```

```bash
cd client
npm test -- --pool=forks --poolOptions.forks.singleFork=true
npm run build
```

The Redis integration command requires the local container:

```bash
docker compose -f server/docker-compose.redis.yml up -d --wait
```

## Remaining manual verification

1. Reload the doctor web app to load the fixed recorder. Restart the Node server if its process does not reload source changes automatically. Keep local Whisper running.
2. Start a new synthetic consultation in Chrome. Speak invented, nonclinical test phrases continuously for at least 55 seconds, then stop. Continuous speech forces the 25-second hard caps; pauses can cut earlier under the existing chunker rules.
3. In browser Network tools, confirm ordered chunk requests, successful responses, and a final marker whose count matches the received chunks. Check that the new chunks reach `transcribed` and the synthetic phrases appear in the transcript view, including after the first boundary. Do not copy transcript text into logs or issue reports.
4. Run the existing Phase 4 acceptance check: record three minutes, disconnect the network for 20 seconds, restore it, stop, and compare uploaded chunk count with the final marker.

The tone-based browser check does not establish speech accuracy, microphone quality, or phone/Edge support. Existing corrupted recordings are not repaired by this change. The existing retry-exhaustion policy still discards a chunk after its configured attempts and reports an error; this fix does not add durable browser buffering or change that policy.
