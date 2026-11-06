# Render cloud configuration: implementation plan and hosting guide

Status: planning only; application edits await approval under `AGENTS.md`.
Prepared: 6 November 2026. This is one deployment/configuration phase; it does not start another consultation feature phase.

## Confirmed choices

- Host on Render using the user's available Render credits.
- Keep Python/PaddleOCR, hosted privately on Render.
- Replace active local language-model dependencies with Gemini; use Sarvam for consultation speech-to-text.
- Use separate credentials for pre-visit summaries and consultation notes.
- Prefer `gemini-2.5-flash` for both. If either project cannot generate with it, ask before changing the model.
- Preserve local provider implementations for explicit development use; deployed services must not silently fall back to localhost.

## Findings from this checkout

- `server` is Express/Node; `client` is React/Vite; both have lockfiles and `npm start` scripts. The frontend builds with `npm run build`.
- `server/src/app.js` exposes `/health`, binds a configurable host and port, and starts transcription/orchestration in the API process.
- Pre-visit summaries, consultation drafting and patient similarity currently share `GEMINI_API_KEY`. The assistant already supports `LLM_API_KEY`.
- Community screening only supports local Ollama. Identity/safety entrypoints bind loopback, and their internal HTTP client requires HTTPS for non-loopback hosts.
- Community database calls execute `psql`; npm dependencies alone do not provide that executable. Its API, identity, safety and jobs credentials must remain isolated.
- `PaddleOCRFastAPI/Dockerfile` needs the repository root as its build context because it copies `ocr/`. It includes the models at build time and uses `PORT`, defaulting to 8000.
- The STT factory hardcodes `saaras:v4`, ignoring `sarvamModel`, and silently switches to local Whisper when the Sarvam key is absent. The config module separately defaults to `saarika:v2`. These disagree and need reconciliation after spec verification.
- The Render verification script requires `JWT_SECRET` but misses actual runtime/encryption requirements. A remote health success does not validate remote ffmpeg, credentials, WebSockets or persistence.
- Patient similarity defaults to `text-embedding-004`; Google's deprecation table lists its shutdown and recommends `gemini-embedding-2`. Check replacement compatibility and embedding consistency before enabling dense similarity.
- No lint/typecheck scripts were found in the two package manifests. Do not report these checks as passed.

## Proposed credential routing for approval

These are **new proposed variables**, not working settings in the current checkout.

| Workload | Proposed credential | Model/provider |
| --- | --- | --- |
| Pre-visit summary | `CHECKIN_GEMINI_API_KEY` | `GEMINI_MODEL=gemini-2.5-flash` |
| Consultation notes, patient summary and flags | `CONSULT_GEMINI_API_KEY` | `GEMINI_DRAFT_MODEL=gemini-2.5-flash` |
| Patient similarity | `PATIENT_SIMILARITY_GEMINI_API_KEY` | Explicit configured Gemini extraction and embedding models |
| In-app assistant | Existing `LLM_API_KEY` | `LLM_PROVIDER=gemini`; explicit model |
| Community redaction and screening | `COMMUNITY_GEMINI_API_KEY` on safety service only | Explicit configured Gemini model |
| Audio transcription | Existing `SARVAM_API_KEY` | `STT_PROVIDER=sarvam` |

The first two keys must not fall back to each other. For the other workloads, separate key fields allow independent rotation; the operator can explicitly reuse an appropriate key if desired. Any such reuse shares the associated project's quota. Assistant and community requests can consume several model calls per user action, so keeping them off the two summary projects is preferable.

Google applies request limits per project, not per key. Two keys in one project do not provide two daily quotas. Confirm the reported 200 requests/day in each actual project's AI Studio dashboard. Do not create projects to evade provider limits. Render credits cover eligible Render charges; Gemini, Sarvam, Supabase and email have separate accounts/billing.

Google currently lists Gemini 2.0 Flash as shut down. Access to 2.5 models is restricted to projects that actively used them previously. Confirm a successful synthetic `generateContent` request for each intended key; merely listing the model is insufficient. No automatic model substitution.

## Implementation scope

1. **Separate credentials and make cloud selection explicit.** Update `server/src/config/checkin.config.js`, `consultAudio.config.js`, `patientSimilarity.config.js`, and `assistant.config.js`; update affected providers' missing-key errors. Add cloud deployment validation that reports setting names/error codes without values. Missing cloud keys must not select local/fake providers in production. Keep tunable limits in configuration.
2. **Community Gemini provider.** Extend `server/src/community/screening.js` with explicit provider/key/model/timeout configuration, preserving schema validation, deterministic rule priority and fail-closed redaction. Update `identity-service.js` and `safety-service.js` to support Render host/port settings and content-free health endpoints. Keep service authentication and HTTPS between deployed API and community services. Do not relax the existing internal HTTPS policy.
3. **Container packaging.** Add `server/Dockerfile` and `.dockerignore` with Node 24, the PostgreSQL client and `ffmpeg-static` installed through the lockfile. Reuse that image for API, identity, safety and the one-shot jobs command. No new npm dependency is planned. Keep Python OCR's existing image; verify its binding on Render and only adjust the startup host if necessary.
4. **Deployment configuration and examples.** Add a root `render.yaml` for frontend, API, private OCR, authenticated HTTPS identity/safety services and scheduled community jobs. Keep all credentials service-specific. Add placeholder-only production examples; update `server/.env.example`, `client/.env.example`, and `server/src/community/community.env.example` with the new fields. Do not modify local `.env` files or private credentials.
5. **Readiness and privacy.** Correct `tools/verify-render-deployment.js` and related smoke checks so they distinguish local and remote evidence. Scrub upstream error bodies and file names from the provider/OCR error paths touched by this deployment; preserve error codes/status/timing only. Never log request content, transcripts, names or keys. Check frontend debug logging is disabled.
6. **Validate and document.** Exercise key isolation with synthetic mocked provider requests, production missing-key failures, cloud provider selection, community screening failures and authentication, plus existing regression suites. Write a short walkthrough with actual results and remaining manual checks. No clinical thresholds or new database tables are planned.

### Verification commands and acceptance

Run from the repository root after implementation:

```bash
npm --prefix server test -- --runInBand
npm --prefix client test
npm --prefix client run build
docker build -f server/Dockerfile -t medbrief-api server
docker build -f PaddleOCRFastAPI/Dockerfile -t medbrief-ocr .
```

New focused tests will verify distinct pre-visit/consultation keys reach only their intended requests; production cannot silently use Whisper/Ollama/fake; synthetic upstream failures do not leak text; community rules remain effective when Gemini fails. Extend the existing `checkin`, `consultAudio/draftProviders`, `consultAudio/logScrub` and community tests, and add focused config tests where needed.

Deployment acceptance also requires a live two-device consultation, successful synthetic OCR extraction, clinician draft review, storage readback after restart, authenticated community posts/jobs, and WebSocket reconnection with HTTP polling still working. A Render account, configured secrets and a phone are needed for those checks. None has been run in this planning phase.

### Sarvam specification prerequisite

The two specification URLs in `docs/consult-audio/IMPLEMENTATION.md` were inaccessible during discovery. The current official SDK guide advertises `https://docs.sarvam.ai/openapi.json` and `https://docs.sarvam.ai/asyncapi.json`; those also could not be retrieved in this environment. The official REST/model reference was readable and describes `saaras:v4`, but that does not satisfy the repository's requirement to read both schemas before Sarvam client edits. Obtain and inspect both official schemas before changing the STT factory/provider. Report any request/response differences before implementation. Do not claim spec compliance yet.

## Step-by-step hosting guide

This is the target procedure **after the approved implementation above**. The current checkout does not yet contain the backend container, Blueprint or new key routing. Do not expect the new variable names to work before those edits.

### 1. Prepare provider projects and Render billing

1. In the intended Render workspace, verify your credits, expiry and eligible usage in Billing before creating paid services.
2. In AI Studio, obtain the pre-visit and consultation keys from their intended projects. Confirm both model access and actual daily/minute/token limits. Store keys in your password manager and later in Render environment settings; do not paste them into chat.
3. Obtain a Sarvam subscription key and ensure that account has usable credit/quota.
4. Set up credentials for assistant, similarity and community screening if those features are enabled. Keep the community key on the safety service only.
5. Reuse the current storage RSA keypair and key ID if existing encrypted files must remain readable. Do not replace them during a host migration. For a brand-new environment, generate the pair locally with `npm --prefix server run generate-keys` and store it securely; this command prints the private key, so do not run it in hosted build logs.

### 2. Prepare Supabase

Keep Supabase for Auth, Postgres and private Storage; a Render database is not required for the existing core app.

From the repository root, after confirming the target project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase migration list
supabase db push --dry-run
```

Inspect pending migrations and the remote history before `supabase db push`. Existing projects may have older manually applied filenames; reconcile history instead of rerunning schema changes. Never use a linked database reset. Check that `lab-reports`, `prescriptions` and `consult-audio` are private and the expected RLS/storage policies are installed.

For community, use the dedicated API, identity, safety and jobs DB logins described in `docs/community-backend-setup.md`. Keep clinic configuration and approved rules intact. Transfer them securely; never combine the three trust domains' credentials in one service or environment group. The current community adapter also requires database privacy logging settings; preserve and verify those.

### 3. Push the approved application changes

Commit application/container/Blueprint/example changes to the deployment branch and push to GitHub. Do not commit `.env`, private rules/credentials, Firebase service-account files, local virtual environments or test exports.

### 4. Create the Python OCR private service

Render → New → Private Service → connect this repository:

| Setting | Value |
| --- | --- |
| Runtime | Docker |
| Root directory / Docker build context | Repository root (`.`) |
| Dockerfile | `PaddleOCRFastAPI/Dockerfile` |
| Port | `PORT=8000` |
| Device | `OCR_DEVICE=cpu` |
| Region | Same as API |
| Initial compute recommendation | Paid 1 CPU / 2 GB RAM; profile larger scans before real use |

The repository's previous measurements report roughly 960 MB after first OCR, so 512 MB is unsuitable. The 2 GB choice is a starting recommendation, not a load-test result. Do not expose OCR publicly: its existing endpoints do not authenticate callers. Copy its actual internal hostname from Render and use `http://ACTUAL_INTERNAL_HOST:8000` for the API's `OCR_SERVICE_URL`.

### 5. Create community services and jobs

Use the proposed backend Dockerfile with root/build context `server` and Dockerfile `Dockerfile`:

| Service | Type | Docker command |
| --- | --- | --- |
| Identity | Paid Web Service, authenticated HTTPS | `node src/community/identity-service.js` |
| Safety | Paid Web Service, authenticated HTTPS | `node src/community/safety-service.js` |
| Jobs | Cron Job | `node src/community/worker.js` |

The proposed host/port changes are needed before these start on Render. Keep identity/safety authentication on every business endpoint. The API must use their actual HTTPS URLs, matching the existing client's HTTPS requirement. Do not use a plain HTTP private-service URL with the current client.

Identity gets its own DB URL/key plus Supabase URL/anon key. Safety gets its own worker-role DB URL, safety service key, Gemini settings and approved rules JSON as a Render secret file (`COMMUNITY_RULES_FILE=/etc/secrets/community-rules.json`). Jobs gets its separate jobs DB login and, if push is enabled, a Firebase secret file (`COMMUNITY_FCM_CREDENTIALS_FILE=/etc/secrets/firebase-worker.json`). Do not give identity/safety/jobs the API's Supabase service-role key.

Set `NODE_ENV=production` and `COMMUNITY_LLM_BYPASS=false` on safety. Configure the jobs schedule explicitly; `* * * * *` is an example one-minute publication/notification poll, not a clinical response threshold. Confirm that cadence with the approved operational workflow before real use. The worker is one-shot; do not deploy it as an unsupervised always-running process. Test FCM delivery before claiming push works.

### 6. Create the main API

Render → New → Web Service → same repository:

| Setting | Target value |
| --- | --- |
| Runtime | Docker, using proposed `server/Dockerfile` |
| Root directory/build context | `server` |
| Docker command | `npm start` |
| Health check path | `/health` |
| Region | Same as OCR |
| Instances | One initially; the current app has process-local state |
| Compute | Paid, always-on; start with 1 CPU / 2 GB for OCR uploads/audio concurrency and measure |

Render sets the public service's `PORT`; the app must bind `0.0.0.0`. Do not pin it to a developer laptop address. The proposed container supplies `psql` and ffmpeg. No persistent disk is needed for consultation audio: Supabase is the durable storage.

Required/important API environment settings after implementation:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
LOG_LEVEL=info
LOG_FORMAT=json
DEMO_SELF_VERIFY=false
SUPABASE_URL=<project URL>
SUPABASE_ANON_KEY=<public anon key>
SUPABASE_SERVICE_ROLE_KEY=<server-only service key>
CLIENT_APP_URL=<exact frontend HTTPS origin; no trailing slash>
OCR_SERVICE_URL=http://<actual private OCR hostname>:8000
OCR_TIMEOUT_MS=180000
OCR_CONFIDENCE_REVIEW_THRESHOLD=<existing approved value>

SESSION_TOKEN_SECRET=<secure random secret>
STORAGE_PROXY_HMAC_SECRET=<different secure random secret>
STORAGE_ENCRYPTION_KEY_ID=<existing key ID, or v1 for a new environment>
STORAGE_ENCRYPTION_RSA_PUBLIC_KEY=<existing base64 PEM public key>
STORAGE_ENCRYPTION_RSA_PRIVATE_KEY=<existing base64 PEM private key>

STT_PROVIDER=sarvam
SARVAM_API_KEY=<Sarvam key>
DRAFT_MODEL_PROVIDER=gemini
CHECKIN_GEMINI_API_KEY=<pre-visit key; proposed setting>
GEMINI_MODEL=gemini-2.5-flash
CONSULT_GEMINI_API_KEY=<consultation key; proposed setting>
GEMINI_DRAFT_MODEL=gemini-2.5-flash

LLM_PROVIDER=gemini
LLM_API_KEY=<assistant key>
LLM_MODEL=gemini-2.5-flash
LLM_MAX_OUTPUT_TOKENS=2048
LLM_FALLBACK_MODEL=
LLM_THINKING_LEVEL=
ASSISTANT_ENABLED=<true or false>
ASSISTANT_CONTINUATION_SECRET=<stable random secret if assistant enabled>

PATIENT_SIMILARITY_PROVIDER=gemini
PATIENT_SIMILARITY_GEMINI_API_KEY=<similarity key; proposed setting>
PATIENT_SIMILARITY_GEMINI_MODEL=gemini-2.5-flash
PATIENT_SIMILARITY_EMBEDDING_MODEL=<verified supported embedding model>
PATIENT_SIMILARITY_USE_SYNTHETIC_DATA=false
CONSULT_AUDIO_CACHE_ENABLED=false

COMMUNITY_DATABASE_URL=<dedicated API DB login URL>
COMMUNITY_IDENTITY_URL=https://<actual identity service hostname>
COMMUNITY_IDENTITY_SERVICE_KEY=<identity service shared secret>
COMMUNITY_SAFETY_URL=https://<actual safety service hostname>
COMMUNITY_SAFETY_SERVICE_KEY=<different safety shared secret>
```

The storage keys and signing secrets must remain stable across redeploys. Generate each new signing secret locally using `openssl rand -hex 32`; keep the output private. Copy existing approved thresholds instead of inventing replacements. Keep existing encryption legacy-read policy when migrating old files; change it only after verifying legacy data requirements.

Add working `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` for invitation delivery. Set the provider's allowed sender and test delivery. The app's production clinician verification must use its existing administrator workflow, not demo self-verification.

Redis is optional. Leave its cache disabled initially. If enabling it later, create Render Key Value, set its real internal URL and verify the adapter; never leave enabled Redis pointing to `127.0.0.1`. Do not deploy Whisper or Ollama for this cloud configuration.

### 7. Create the frontend static site

Render → New → Static Site → same repository:

| Setting | Value |
| --- | --- |
| Root directory | `client` |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |
| Rewrite | Source `/*`, destination `/index.html`, action **Rewrite** |

Set these build-time environment values:

```dotenv
VITE_SUPABASE_URL=<same Supabase project URL>
VITE_SUPABASE_ANON_KEY=<public anon key>
VITE_API_BASE_URL=https://<actual API hostname>
VITE_DEBUG_API=false
VITE_ASSISTANT_ENABLED=<match server's enabled setting>
VITE_PATIENT_SIMILARITY_ENABLED=<match server feature>
VITE_PATIENT_SIMILARITY_USE_SYNTHETIC_DATA=false
```

Only public settings belong in `VITE_*`; they are compiled into browser JavaScript. All Gemini/Sarvam keys, private RSA keys and Supabase service-role credentials stay out of the client. Rebuild after changing these values. Use Node 24 for the frontend build to match backend tooling.

### 8. Connect URLs and mobile

1. Set API `CLIENT_APP_URL` to the frontend's exact HTTPS origin and redeploy API. This controls CORS and invitation links.
2. In Supabase Auth URL Configuration, set Site URL to the frontend URL and add the application's intended redirects on that domain. Test invitation/password links on the hosted app.
3. In the Flutter configuration matching `mobile/config.example.json`, set `API_BASE_URL` to the HTTPS API and use the same public Supabase URL/key. Rebuild/distribute the app using the existing mobile workflow. Never include provider secrets in mobile config.
4. If adding a custom domain later, repeat the frontend build/API origin/Auth redirect updates.

### 9. Smoke-test with synthetic data

```bash
curl --fail --silent --show-error https://YOUR_API_HOST/health
```

Then verify patient and verified-clinician login, invitation delivery, frontend deep-link refresh, a synthetic report upload with OCR, pre-visit generation, and a two-device consultation through Sarvam to clinician-reviewed notes. Check each Google project's usage separately to prove the key split. Restart the API and confirm stored files remain readable. Test community consent, posting, moderation and scheduled jobs. Test Socket.IO over WSS and verify HTTP status polling still works after disconnect.

An HTTP 200 at `/health` only proves the Express process is reachable. This planning phase has not deployed or tested the application. The old Render verifier must be corrected before treating it as release evidence.

## Official references checked

- [Render first deployment and service settings](https://render.com/docs/your-first-deploy)
- [Render compute plans](https://render.com/docs/compute-plans)
- [Render environment variables](https://render.com/docs/configure-environment-variables)
- [Render static-site rewrites](https://render.com/docs/redirects-rewrites)
- [Render WebSockets](https://render.com/docs/websocket)
- [Vite environment variables](https://vite.dev/guide/env-and-mode)
- [Google Gemini models and legacy access](https://ai.google.dev/gemini-api/docs/models?hl=en)
- [Google project-level rate limits](https://ai.google.dev/gemini-api/docs/rate-limits?hl=en)
- [Google model deprecations](https://ai.google.dev/gemini-api/docs/deprecations?authuser=8&hl=en)
- [Sarvam SDK guide and schema locations](https://docs.sarvam.ai/api/getting-started/sdks)
- [Sarvam REST reference](https://docs.sarvam.ai/api-reference/speech-to-text/transcribe)
- [Supabase migration deployment](https://supabase.com/docs/guides/deployment/database-migrations)

Community Wisdom research could not run: the installed skill's DevRelay tools were absent from this session. No community-source claims are made.

## Approval boundary

Approve the single implementation phase above, including its proposed routing for assistant/similarity/community keys and the service layout. Application/config/container changes start only after that approval. Sarvam client/factory edits additionally require access to the official schemas; if unavailable, leave those edits pending and report the gap. Model access checks with actual credentials and Render deployment remain manual until an authorized account/runtime is available.
