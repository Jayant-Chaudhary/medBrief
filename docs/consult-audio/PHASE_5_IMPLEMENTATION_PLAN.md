# Phase 5: Patient Android recorder

Status: proposed; awaiting approval before source-code changes.

This plan implements only Phase 5 of `IMPLEMENTATION.md`. The existing doctor recorder and Node transcription worker remain the other ends of the pipeline. The recent doctor chunk-boundary fix and Redis work are preserved.

## Outcome

A signed-in patient opens **Join consultation**, enters the doctor's room code, accepts consent, grants microphone and notification permissions, checks microphone levels and becomes ready. After the doctor starts, the phone records and uploads independently, including with the screen locked. When the doctor ends, the phone flushes the last chunk and declares its final count. Disconnections retain unacknowledged chunks for retry. Interruptions are recorded as gaps rather than invented silence or speech.

Audio flow remains phone → HTTPS Node endpoint → private Supabase Storage and metadata; the optional server Redis cache accelerates processing. The phone never uploads directly to Supabase or Redis.

## Repository findings

- Mobile features use `mobile/lib/features/<feature>/` with repositories, controllers and pages. `mobile/lib/features/home/home_page.dart` is the current authenticated shell; `signed_in_page.dart` is not the shell selected by `mobile/lib/app.dart`.
- `mobile/lib/core/api_client.dart` supports user-authenticated JSON and multipart requests. Scoped consultation tokens and raw binary uploads need explicit support, while retaining its generic error mapping and injectable HTTP client.
- The Android manifest has Internet and notification permissions, but no microphone permission or microphone foreground service.
- Existing Node routes already support patient join, consent, ready, capture-started, chunks, final marker and state. The scoped token guard binds requests to the session and device. Socket events already include start/end notifications; state is also available over HTTP.
- Chunk identity is `(session_id, device, seq)`. Successful ingestion acknowledges private Storage and metadata persistence before the client may delete its copy.
- There is no persisted interruption-gap contract. An empty upload is currently treated as silence, which cannot truthfully represent a microphone interruption.
- Patient join currently overwrites `patient_id` when consuming a code and does not check that the signed-in patient matches the appointment's patient. Add an ownership check and conditional single-use consumption before exposing the mobile join flow.
- Installed tooling checked: Flutter 3.47.8, Dart 3.13.7; existing Kotlin 2.2.20 and Gradle 8.14. `adb devices -l` returned no attached devices. No Phase 5 tests have been run or claimed yet.

## Dependencies and compatibility

Use published versions, not unreleased repository branches; resolve and commit the lockfile during implementation.

| Package | Proposed version | Purpose and evidence |
| --- | --- | --- |
| `record` | 7.1.2 | Maintained recorder; published 22 days before this review. Android supports AAC-LC streaming with ADTS headers and amplitude samples. [Package](https://pub.dev/packages/record). |
| `flutter_foreground_task` | 11.0.3 | Dedicated Android foreground service; published 55 days before review. Requires Flutter ≥3.44, Dart ≥3.12, Kotlin ≥2.2.20 and Gradle ≥8.11.1; installed SDK and repository build settings meet those stated requirements. [Package](https://pub.dev/packages/flutter_foreground_task). |
| `socket_io_client` | 3.1.6 | Its compatibility table maps Dart client 3.x to Socket.IO server 4.7–4.x; this repository uses server 4.8.4. [Compatibility](https://pub.dev/packages/socket_io_client). |
| `path_provider` | 2.1.6 | App-private pending-upload directory; official Flutter publisher. Its current Android support starts at SDK 24, so make the app's minimum explicit at 24. [Package](https://pub.dev/packages/path_provider). |

Reuse `http`, `flutter_secure_storage` and `flutter_test`. No new Node dependencies. Update the mobile Dart SDK floor to match the selected packages if resolution requires it; validate with `flutter pub get`, analysis and an Android build before claiming full compatibility.

The recorder's [background-recording documentation](https://github.com/llfbandit/record/blob/main/doc/bg_recording.md) recommends an external foreground-service package. Follow [Android's microphone foreground-service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#microphone): request microphone permission and start the service while the activity is visible. A background socket event must not attempt an illegal microphone-service launch.

The DevRelay research connector is unavailable in this session. Package choices above use official package documentation and local repository/toolchain evidence; no community claims are assumed.

## Implementation

### 1. Configuration, API and entry point

- Add one consultation entry point in `HomePage`, retaining the existing navigation, auth and other feature behavior.
- Add a consultation config module for chunk minimum/hard cap, pause, silence threshold, sample/bit rate, meter interval, HTTP timeout, state polling, retry schedule, pending storage limit and short pending-file retention. Make values overrideable through build configuration; document matching server settings. Reuse the existing audio defaults rather than introducing clinical thresholds.
- Extend `ApiClient` with an explicit scoped bearer-token option and raw byte upload method; normal requests continue to use Supabase access tokens. Map response failures to generic messages rather than displaying server internals.
- Join uses normal patient auth. All later consultation HTTP requests and the socket use the returned patient-scoped token. Keep the token in secure storage only for the active/pending session, isolated from normal sign-in credentials.
- Perform the existing five-round clock handshake and select the smallest RTT. Anchor epoch milliseconds once and use elapsed monotonic time for chunk offsets; do not send bare uptime as `capture_zero_device_ms`.

### 2. Consent and foreground lifecycle

- Flow: join → consent → microphone/notification permission → local level check → clock sync and ready → wait for doctor → recording → flushing/pending uploads → complete or recoverable error.
- Consent states that pending chunks are temporarily stored on the phone until acknowledged. No room audio is captured before the patient's consent. Microphone checking happens after consent, stays local and is discarded; no STT test upload is required.
- Start the microphone foreground service from the visible readiness action, after permissions. While waiting for the doctor it can own the connection/state checks but must not capture room audio. Recording additionally requires authoritative `recording` state and the required room consents. Start/end actions are idempotent.
- The foreground task owns recorder subscriptions, chunking, upload retries and state reconciliation; widget disposal or screen lock must not stop these tasks. UI messages contain status/counts only.
- Use a persistent generic notification, such as **Recording active**, with no names, health terms or transcript. If notification permission is denied, explain and prevent this recording flow because its visible recording indicator is required.
- Disable automatic microphone restart on boot. Stop capture on a terminal session state, explicit local stop, revoked permission or sign-out. A local stop flushes this device and does not call the doctor-only end route. Pending work remains explicitly visible until acknowledged or discarded under the documented retention policy.

### 3. Independently decodable chunks

- Use a single `record` AAC-LC stream with ADTS framing, configured initially for mono audio. Check encoder support before becoming ready; unsupported devices receive an explicit error rather than a silent format fallback.
- Parse complete ADTS frames across arbitrary stream callback splits; a callback is not a chunk boundary. Validate header/frame length and actual sample rate. Retain incomplete frame bytes until the next callback; report truncated end data as a gap/error.
- Port the pure web chunk-boundary and silence rules to Dart. Close chunks only between complete frames. Use encoded frame duration to respect the hard cap, with pause decisions derived from timestamped amplitude samples. Keep capture timing, gaps and codec timing distinct.
- Each `.aac` file contains its own complete ADTS frames and can be converted independently. Do not split an MP4/WebM container arbitrarily or restart the Android microphone at every boundary.
- Drain the encoder's final events before packaging the last partial chunk, then wait for acknowledged uploads before the final marker. Repeated stop events must share one flush operation, following the browser race fix.
- Store silence as metadata-only chunks using the existing silent-upload contract. Never label a recorder interruption as silence.

### 4. Temporary queue and retries

- Write pending chunks and a minimal manifest atomically to an app-private directory, excluded from backup. Use opaque session/device/sequence filenames; no patient details or transcripts. Do not use shared/external storage or gallery paths.
- One serial HTTP queue, stable sequence and metadata across retries. Delete the file and manifest entry only after a successful durable acknowledgement, including a duplicate acknowledgement. A timeout after successful server persistence retries the same chunk identity.
- Network/server failures retry using the central backoff schedule. Retain retryable files rather than discarding them on an attempt count. Authentication or permanent validation errors stop automatic retries and show a recoverable error. Never claim a complete flush while files remain unacknowledged.
- Bound pending storage and retention using configuration. If the limit is reached, stop capture and flag the missing interval; do not silently evict unacknowledged audio. Explicit discard/expiry deletes local data and records lost capture as incomplete metadata when reachable. Startup recovery retries eligible pending files, removes acknowledged leftovers and expires stale ones; it never automatically starts the microphone.
- Preserve capture-start and final-marker requests for retry as well as chunk bytes. Do not redefine capture zero on a stream restart or socket reconnect.

### 5. HTTP state fallback and interruptions

- Socket.IO receives push events only, with no app state-changing emits. Reconcile using `/state` on initial connection, reconnect and a bounded polling schedule; process the `sessionState` returned by chunk uploads. Recording and stopping must work when Socket.IO is unavailable.
- The foreground task handles recorder pause/stop/error events and the package's interruption support. Flush complete captured frames, retain timeline continuity, record the interval without capture and resume only when permission/audio focus and authoritative session state permit it. Do not request call-log or phone-number permissions.
- Add proposed `POST /api/consults/:id/devices/:device/gaps`, protected by the existing scoped token guard, with `{gap_id, start_ms, duration_ms, reason_code}`. Require a stable client-generated UUID for idempotency; validate nonnegative integer times, a positive duration and an allowlisted reason code. Derive session/device/user from the authenticated context and reject mismatches. Gaps are timeline metadata, independent of the contiguous audio chunk sequence and final chunk count.
- Add `consult_audio_gaps` with session FK, device, client gap UUID, start/duration, reason code and received timestamp; unique by session/device/client gap UUID. Enable RLS, allow participant reads and keep writes through the authenticated Node endpoint. Add a doctor-readable status representation and generic count pushes without publishing microphone details or health content in socket payloads.
- This phase stores and exposes interruption evidence. Phase 6 deadline orchestration and Phase 7 transcript gap merging remain separate; this phase does not implement them.

## Files to create

- `mobile/lib/features/consult_audio/consult_audio_config.dart`
- `mobile/lib/features/consult_audio/consult_audio_models.dart`
- `mobile/lib/features/consult_audio/consult_audio_repository.dart`
- `mobile/lib/features/consult_audio/consult_audio_controller.dart`
- `mobile/lib/features/consult_audio/consult_audio_page.dart`
- `mobile/lib/features/consult_audio/audio_chunker.dart`
- `mobile/lib/features/consult_audio/adts_chunk_assembler.dart`
- `mobile/lib/features/consult_audio/pending_audio_store.dart`
- `mobile/lib/features/consult_audio/audio_upload_queue.dart`
- `mobile/lib/features/consult_audio/patient_recorder.dart`
- `mobile/lib/features/consult_audio/consult_foreground_task.dart`
- `mobile/lib/features/consult_audio/consult_socket.dart`
- `mobile/test/consult_audio_chunker_test.dart`
- `mobile/test/consult_audio_adts_test.dart`
- `mobile/test/consult_audio_queue_test.dart`
- `mobile/test/consult_audio_flow_test.dart`
- `mobile/test/consult_audio_repository_test.dart`
- `mobile/test/consult_audio_privacy_test.dart`
- `tools/simulate-device/fixtures/chunker-cases.json`: shared synthetic input/expected cases for Dart and JavaScript.
- `server/src/services/consultAudio/gap.service.js`
- `server/src/tests/consultAudio/gaps.test.js`
- `supabase/migrations/20261101000000_consult_audio_gaps.sql`: verify the timestamp is unused before creating it.
- `docs/consult-audio/PHASE_5_WALKTHROUGH.md`

## Existing files to change

- `mobile/pubspec.yaml`, `mobile/pubspec.lock`: dependencies and resolved versions.
- `mobile/android/app/src/main/AndroidManifest.xml`: microphone/service permissions and nonexported microphone foreground service.
- `mobile/android/app/build.gradle.kts`: explicit supported minimum Android SDK.
- `mobile/lib/core/api_client.dart`, `mobile/test/api_client_test.dart`: scoped tokens/raw uploads with existing behavior protected.
- `mobile/lib/main.dart`, `mobile/lib/app.dart`: foreground communication initialization and feature dependency wiring.
- `mobile/lib/features/home/home_page.dart`: consultation entry and status access.
- `mobile/config.example.json`, `mobile/README.md`: nonsecret configuration and run instructions.
- `server/src/routes/consultAudio.routes.js`, `server/src/controllers/consultAudio.controller.js`: scoped gap HTTP endpoint.
- `server/src/services/consultAudio/session.service.js`: participant-safe join and gap status exposure; conditional single-use code consumption.
- `server/src/services/consultAudio/chunkIngest.service.js`: correct `.aac` extension for ADTS `audio/aac`, retaining `.m4a` for MP4 audio.
- Existing consultation API/ingest tests: join ownership, duplicate code consumption, device authorization and AAC handling.
- `server/src/tests/consultAudio/audioConverter.test.js`: prove independently packaged synthetic AAC chunks convert through the existing ffmpeg path.
- `client/src/tests/audioChunker.test.js`: consume shared fixtures alongside existing regression tests.
- `docs/consult-audio/FILES_AND_PURPOSE.md`, `docs/consult-audio/LOCAL_TESTING_GUIDE.md`, `docs/consult-audio/IMPLEMENTATION.md`: new files, contracts and manual checks.

## Verification and acceptance

Automated checks after implementation:

1. Shared chunker cases pass in Dart and JavaScript: minimum duration, pause cuts, hard cap, silence and end flush.
2. ADTS tests split headers/frames across callbacks, cross multiple hard caps, flush the final tail and reject malformed/truncated streams. Real ffmpeg decodes each generated synthetic chunk independently, including chunks after 25 seconds.
3. Queue/controller tests cover delayed final data, out-of-order callbacks, duplicate Stop, final marker ordering, offline/retry/duplicate acknowledgements, pending-file recovery/deletion, storage/retention limits, denied permissions, consent gating, interruption gaps and sign-out cleanup.
4. API tests prove scoped token isolation, correct patient device headers, generic error handling, gap idempotency and participant access. Wrong appointment patients cannot consume a room code; only one concurrent join succeeds.
5. Privacy tests capture new logs/errors/notification text and assert synthetic audio contents, transcript text, tokens, names and health values are absent. Inspect the new migration's RLS policies and run its access checks against a local test database if available; report explicitly if only static verification is possible.
6. Run `flutter analyze`, `flutter test`, and `flutter build apk --debug` from `mobile`; run both existing client tests and build, and the backend suite (including local Redis checks when available). Report command results and any baseline failures separately.

Real-phone checks are required for completion of native acceptance; no device is connected during planning:

1. Join a synthetic appointment with a six-character code, consent and become ready. Verify no capture before consent/start and a visible persistent generic recording notification.
2. Record beyond two 25-second boundaries; compare server chunk count, sequence, independent decode and final marker. Use invented nonclinical speech and do not copy transcript contents into logs.
3. Lock the screen for five minutes while recording; verify the service continues and uploads remain ordered.
4. Enable airplane mode for 30 seconds, restore it and stop; verify retained files upload without duplicates and are deleted after acknowledgements.
5. Take an incoming call, return and resume; verify the server exposes a capture gap rather than a silent substitute, and the capture timeline does not reset.
6. Disable socket connectivity while keeping HTTP available; verify start/end reconciliation still works. Check sign-out, process termination, restart recovery and denied microphone/notification permission.

Finish with the walkthrough, executed evidence and explicit native/manual gaps. Do not begin Phase 6, notes drafting, transcript merge or a Sarvam provider rewrite.
