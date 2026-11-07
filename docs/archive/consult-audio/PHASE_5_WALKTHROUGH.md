# Phase 5: patient Android recorder — 2026-11-02

The approved Phase 5 code is implemented in the working tree. Automated checks cover the Flutter pipeline and Node contracts. Android native compilation and real-phone acceptance remain pending; this document does not mark those checks complete.

## Infrastructure reused

The [pre-implementation audit](PHASE_5_INFRA_READINESS.md) found an existing Phase 5 draft, resolved packages, a working Flutter SDK, all seven Supabase audio tables and a private `consult-audio` bucket. Local API, Whisper and Docker/Redis processes were unavailable at audit time. The Android SDK path contained platform tools but lacked the full build toolchain. No Android phone was attached.

The server still persists compressed audio to Supabase before acknowledging an upload. Redis remains optional and is disabled in the current environment. No consultation audio, transcript text or clinical rows were downloaded for this work. Supabase checks inspected schema availability and bucket metadata only.

## Changes

- The patient Home page exposes Join consultation. Consent, microphone/notification permission, a local microphone level check, clock sync and ready precede room recording. Readiness waits for the level check to finish. Recovery is associated with the signed-in patient account.
- A real `flutter_foreground_task` entry point owns a separate recorder/controller, serial upload queue, HTTP polling and optional Socket.IO connection. The page receives status/counts only. Sockets request state reconciliation; there are no application state-changing client emits. Boot/system restart cannot automatically start the microphone.
- `record` streams mono AAC-LC with ADTS framing. The assembler validates headers, channels, sample rate, complete frames and partial callback boundaries. Encoded frame duration enforces the hard cap. A real 55-second synthetic stream is split into three independently decodable chunks in the Dart test.
- Stop retains the stream subscription until the encoder closes, awaits asynchronous chunk persistence, and then drains acknowledged uploads before the final marker. Duplicate Stop and Stop during native startup are handled. Unobserved microphone levels do not falsely classify audio as silence.
- The phone uses the existing flat join response, `capture_zero_device_ms`, `x-seq`, `x-start-ms`, `x-duration-ms`, `x-codec` and `x-silent` contracts. Scoped tokens are separate from Supabase login tokens and stored securely. The configured API URL is used throughout.
- Pending files and control requests survive process loss in private app storage. Manifest mutations are serialized and atomic. Successful duplicate replies count as acknowledgements; HTTP 409 and malformed success responses do not. Authentication/permanent rejection stops capture and automatic retries. Pending files are not silently evicted at capacity.
- Default local retention is two hours; expiry or an explicit pending-file discard deletes unsent audio and records an explicit missing interval. Cleanup runs during retries and at the next app launch; an OS force-stop cannot execute cleanup until the app runs again. Recovery sends existing files and gaps without automatically restarting capture.
- Audio-focus pause/resume events produce gap metadata. Recorder/storage failures flag incomplete capture. The scoped gap endpoint validates UUIDs, integer ranges, allowlisted reasons and idempotent duplicates. Session state exposes gaps to participants and now checks membership before returning them.
- Patient joins reject a different appointment patient and conditionally consume the code once. The room state machine also requires a required patient to join and consent, rather than skipping the patient check when its device is absent. A patient who joins an optional-device room must consent too; explicit doctor-only rooms without a patient device remain supported.
- Notifications are generic. Consent accurately states temporary local storage and use of the clinic's configured transcription service. No audio/transcript text, names, tokens or health values are added to logs or notifications.

Code is confined to the consultation feature, its API/Android setup, patient Home entry, tests and documentation. Shared `ApiClient` gained scoped tokens, raw uploads and configurable deadlines. Existing OCR, auth implementation, community and doctor dashboard code were not rewritten. The draft's existing unused import removal in `home_tab.dart` remains. Phase 6 orchestration, transcript merge and notes drafting were not started.

## Verification

- `flutter analyze`: no issues.
- `flutter test`: **86 passed, two skipped**. Includes the real ffmpeg/55-second AAC test, shared Dart/JavaScript fixtures, encoder-tail flush, delayed acknowledgements, offline retry, retention/capacity, explicit discard, consent gating, HTTP-only start/end, recovery without microphone restart and startup/Stop races. The two skipped tests are existing preview tests outside this feature.
- Backend Jest with `RUN_REDIS_INTEGRATION=true`: **521 passed, none skipped**. Includes all five real Redis checks, patient ownership, concurrent room-code consumption, membership, gap validation and conversion checks. The Redis checks use isolated synthetic keys and mocked Supabase persistence; no shared database is flushed.
- Client Vitest: **19 passed**. Client production build passed with the existing bundle-size warning.
- `git diff --check` and syntax checks on the touched Node services passed.
- `flutter build apk --debug` was attempted and failed during Android configuration: NDK `28.2.13676358` licence not accepted. Native code compilation has not been verified. Flutter also reported upcoming support changes for the existing AGP/Kotlin versions; those versions were preserved.

No real-phone, live two-device upload, live RLS access or local Whisper runtime success is claimed for Phase 5. Tests use synthetic input and mocked persistence/HTTP except the real Redis and in-memory ffmpeg checks.

A final runtime recheck found Redis healthy on loopback port 6379. The API and Whisper health endpoints were still unavailable, no phone was attached, and the optional cache flag remained disabled. Provider configuration was still `local`; no explicit server session-token secret was configured.

## Schema and configuration

The draft adds `20261101000000_consult_audio_gaps.sql`. That table already existed in the audited project. A follow-up migration, `20261102000000_consult_audio_gap_recovery.sql`, permits `retention_expired` / `storage_lost` / `user_discarded`, removes direct client insertion and revokes client write privileges. RLS participant reads remain. Apply pending migrations through the repository's normal Supabase migration workflow before exercising recovery gaps. This task did not apply migrations remotely or change remote policies.

`mobile/config.example.json` lists the build settings. Mobile chunk durations use milliseconds; match server `CHUNK_MIN_SEC` / `CHUNK_HARD_CAP_SEC` after multiplying by 1000. Keep pause, silence, consent version and upload limits aligned. Build with `--dart-define-from-file=config.json`; do not put service-role credentials or provider keys in mobile configuration.

The server environment currently lacks an explicit `SESSION_TOKEN_SECRET`; set a strong environment value before deployment. The existing scoped-token TTL is configurable on the server. Expired scoped tokens stop retries and surface pending recovery; the existing API has no token-renewal route. Choose a TTL covering the intended visit/retry window and verify expiry behavior. No permanent browser/phone archive is added.

## Android setup and acceptance steps

1. Install Android command-line tools in a writable SDK location through Android Studio's SDK Manager. This Flutter SDK targets/compiles Android API **36** and selects NDK **28.2.13676358**. Install the required platform/build tools and NDK. Point `flutter config --android-sdk <sdk-path>` and `mobile/android/local.properties` (`sdk.dir`) at that same SDK. Preserve its `flutter.sdk` entry.
2. Review and accept the Android SDK/NDK licences interactively with `flutter doctor --android-licenses`. Run `flutter doctor` and resolve Android toolchain failures. The app now requires Android SDK 24 or later.
3. From `mobile`, run `flutter pub get`, `flutter analyze`, `flutter test`, and `flutter build apk --debug --dart-define-from-file=config.json`. A successful APK build is still required.
4. Apply pending Supabase migrations. Start local Whisper with `bash whisper-service/run.sh`, then the Node API with `npm run dev` in `server`. Confirm `/health` on ports 8001 and 4000 before testing. For optional cache checks, start Docker Desktop and run `docker compose -f server/docker-compose.redis.yml up -d --wait`; enabling the cache additionally requires its environment flag and a backend restart.
5. Connect a physical Android phone; confirm `adb devices -l` lists it. With USB use `adb reverse tcp:4000 tcp:4000` and mobile `API_BASE_URL=http://127.0.0.1:4000` for a debug build. The phone calls Node only; it does not need direct access to Whisper or Redis. Use HTTPS for hosted builds.
6. Create a synthetic appointment for the same signed-in patient. On the doctor client create a room requiring the patient. Join using its six-character code, consent, grant permissions, complete the local level check and become ready. Check no room capture before required consent/start and a persistent generic notification while active.
7. Start from the doctor. Record invented nonclinical phrases continuously for 55 seconds, then end. Confirm ordered patient chunks, independent conversion after both 25-second boundaries, and a final marker whose count matches the device's emitted sequence. Review synthetic speech accuracy without copying transcript text into logs.
8. Repeat with the screen locked for five minutes; airplane mode for 30 seconds followed by reconnect; an incoming call with resume; and sockets unavailable while HTTP works. Compare server chunks, gap intervals and final counts. Check pending files disappear after successful acknowledgements.
9. Check denied/revoked permissions, sign-out while recording, process termination, account switching and recovery of pending files. Recovery must not turn on the microphone automatically. Confirm pending/error states never claim all audio was sent; incomplete capture is explicitly flagged.

The real-phone checks above are outstanding acceptance work, not inferred from unit-test success.
