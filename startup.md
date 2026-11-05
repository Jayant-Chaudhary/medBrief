# MedBrief local startup

Setting up a different computer? Use [the community backend setup guide](docs/community-backend-setup.md)
for dependency installation, private configuration transfer and new device networking.

Project: `/home/jayant/Code/health-on/health-on-project`

Private community configuration: `/home/jayant/medbrief-private`

Username policy: a mother chooses once, then the name stays locked until an approved
identity reveal rotates it. Apply pending migrations
`20261028000011_community_username.sql` and then
`20261028000012_community_username_lock.sql` once in Supabase SQL Editor; skip any
already applied file. The app defaults to locked if the status capability is missing.

This guide uses the existing hosted Supabase database and the configuration files
already created. You do not need to start a local Supabase instance or reapply the
migrations each time. Run each long-lived service in a separate terminal, and leave
that terminal open. Check whether a service is already running before starting another
copy on the same port.

## 1. Select the installed Node version

In every terminal that will run Node/npm commands:

```bash
source /home/jayant/.nvm/nvm.sh
nvm use 24
node --version
```

The installed version is Node `v24.14.0`. The system `/usr/bin/node` may be older and
reject `--env-file`; use the nvm version. If nvm is unavailable in a particular shell,
the installed executable is:

```text
/home/jayant/.nvm/versions/node/v24.14.0/bin/node
```

Use that full path instead of `node` in the commands below if necessary.

## 2. Configuration files and service ports

| Service | Configuration file | Local address |
| --- | --- | --- |
| Public Node API | `server/.env` | `http://localhost:4000` |
| Community identity/reveal service | `/home/jayant/medbrief-private/identity.env` | `http://127.0.0.1:4101` |
| Community safety service | `/home/jayant/medbrief-private/saftey.env` | `http://127.0.0.1:4102` |
| Community jobs/push worker | `/home/jayant/medbrief-private/jobs.env` | No HTTP port |
| Ollama, when full screening is enabled | Model settings in `saftey.env` | `http://127.0.0.1:11434` |
| OCR FastAPI | Existing Docker Compose or Python environment | `http://127.0.0.1:8000` |
| React dashboard | `client/.env` | `http://localhost:5173` |
| Flutter patient app | `mobile/config.json` | Connects to the public API |

These are the current/default ports; change the corresponding client/service URLs if
you override them. **`saftey.env` is the current filename**, including that spelling.

Keep each process's database credentials separate. Do not `source` all private env
files into one shell or copy all credentials into `server/.env`. `--env-file` loads the
chosen file into that Node process. Do not commit or share populated env/config files.

### Required settings by process

| File | Settings |
| --- | --- |
| `server/.env` | Existing Supabase/API/OCR/SMTP settings; `COMMUNITY_DATABASE_URL` for the runtime login; `COMMUNITY_IDENTITY_URL`, `COMMUNITY_IDENTITY_SERVICE_KEY`, `COMMUNITY_SAFETY_URL`, `COMMUNITY_SAFETY_SERVICE_KEY` |
| `identity.env` | `COMMUNITY_IDENTITY_DATABASE_URL`, `COMMUNITY_IDENTITY_SERVICE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`; optional `COMMUNITY_IDENTITY_PORT=4101` |
| `saftey.env` | `COMMUNITY_WORKER_DATABASE_URL`, `COMMUNITY_SAFETY_SERVICE_KEY`, `COMMUNITY_RULES_FILE`; optional `COMMUNITY_SAFETY_PORT=4102`; model or bypass settings below |
| `jobs.env` | `COMMUNITY_WORKER_DATABASE_URL`; `COMMUNITY_FCM_CREDENTIALS_FILE` for configured Android push delivery |

The API's identity service key must match the one in `identity.env`; its safety service
key must match the one in `saftey.env`. Each service key must be at least 32 characters.
Use the dedicated restricted database login for each service, as already provisioned.

`COMMUNITY_RULES_FILE` points to `/home/jayant/medbrief-private/community-rules.json`.
The existing push credential file is `/home/jayant/medbrief-private/firebase-worker.json`;
its path belongs in `jobs.env`, not in Flutter or React.

## 3. Terminal A: start the identity service

```bash
cd /home/jayant/Code/health-on/health-on-project/server
node --env-file=/home/jayant/medbrief-private/identity.env \
  src/community/identity-service.js
```

It listens on `127.0.0.1:4101`. A quiet terminal is normal while it is waiting for
requests. The service checks required configuration before listening.

**Do not start it using just `node -r dotenv/config src/community/identity-service.js`.**
That reads the public API's `.env`, which lacks `COMMUNITY_IDENTITY_DATABASE_URL`.
This was the cause of the Android “Community unavailable” error.

## 4. Terminal B: start the safety service

Choose exactly one mode. Both modes use the same safety service and port.

### Mode A: test other features without Ollama

```bash
cd /home/jayant/Code/health-on/health-on-project/server
NODE_ENV=development COMMUNITY_LLM_BYPASS=true \
  node --env-file=/home/jayant/medbrief-private/saftey.env \
  src/community/safety-service.js
```

This works without Ollama or model configuration. The startup warning confirms that
the bypass is enabled. The flag is allowed only in `development` or `test` and defaults
to off. The inline settings above apply to this command without editing the env file.

Phone/email/link removal and keyword rules still run; `COMMUNITY_RULES_FILE` is still
required. Rules can hold content and create review/outreach work. Model-based removal
of names/locations and model classification are skipped, so use synthetic test accounts
and fictional content only. The stored screening record marks the bypass explicitly.

### Mode B: normal screening using local Qwen3:8b

First check whether Ollama is already serving:

```bash
curl --fail --max-time 5 http://127.0.0.1:11434/api/tags
```

If it is not running, start it in an additional terminal and leave it open:

```bash
ollama serve
```

If an existing system service already serves Ollama, use that instance. To download
the model once, or confirm it is installed:

```bash
ollama pull qwen3:8b
ollama list
```

Keep these model settings in `saftey.env`:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
COMMUNITY_MODEL=qwen3:8b
# Use a nonempty version label for your tested model/rules combination.
COMMUNITY_MODEL_VERSION=REPLACE_WITH_YOUR_TESTED_VERSION_LABEL
COMMUNITY_LLM_BYPASS=false
```

Replace the version placeholder, then start the safety service:

```bash
cd /home/jayant/Code/health-on/health-on-project/server
COMMUNITY_LLM_BYPASS=false \
  node --env-file=/home/jayant/medbrief-private/saftey.env \
  src/community/safety-service.js
```

To switch between modes, stop the existing safety process with `Ctrl+C`, then start
the other command. Restarting changes screening for new submissions; it does not
rescreen earlier content. A worker or Flutter restart is not needed just to change
this flag.

## 5. Terminal C: start the public Node API

```bash
cd /home/jayant/Code/health-on/health-on-project/server
node --env-file=.env src/app.js
```

For automatic reloads while editing server code, use this instead:

```bash
cd /home/jayant/Code/health-on/health-on-project/server
npm run dev
```

Choose one API command, not both. The existing `npm run dev` loads `server/.env`
through the application's dotenv setup. Both start the same API on port 4000 by default.
If Node dependencies are missing, run `npm ci` in `server/` once before starting.

## 6. Terminal D: run the community worker

The worker handles due publication jobs, safety timers and generic push delivery.
It is **a one-shot command**, not an HTTP server:

```bash
cd /home/jayant/Code/health-on/health-on-project/server
node --env-file=/home/jayant/medbrief-private/jobs.env \
  src/community/worker.js
```

Successful runs can exit quietly. Run it after the configured publication delay to
publish a normal post/reply. Running it before the due time does not publish early.

For repeated runs during local development, leave this loop open in its own terminal:

```bash
cd /home/jayant/Code/health-on/health-on-project/server
COMMUNITY_WORKER_POLL_SECONDS=10
while true; do
  node --env-file=/home/jayant/medbrief-private/jobs.env src/community/worker.js
  sleep "$COMMUNITY_WORKER_POLL_SECONDS"
done
```

Ten seconds here is only an adjustable local polling interval, not a clinical response
deadline. The clinic's configured publication delays, tier hours and reveal policies
remain in Supabase. If you already have a scheduler, use it instead of this loop.
Investigate worker failures/operations alerts; do not treat quiet inboxes as proof that
notifications were delivered. Push needs valid Firebase credentials and a registered
Android installation; the Care inbox works without push setup.

## 7. Start OCR when testing reports

OCR is separate from community and is not required to open the feed or Care inbox.
Choose Docker or your existing local Python environment, not both on the same port.

### Docker

From the repository root, start the existing Compose service:

```bash
cd /home/jayant/Code/health-on/health-on-project
docker compose -f PaddleOCRFastAPI/docker-compose.yml up -d --build
```

The first build may download dependencies/models. Subsequent starts can use `up -d`
without `--build` when the image does not need rebuilding.

### Existing Python environment

If you already installed OCR dependencies in `PaddleOCRFastAPI/.venv`:

```bash
cd /home/jayant/Code/health-on/health-on-project/PaddleOCRFastAPI
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

For first-time environment installation, follow [OCR integration](server/OCR_INTEGRATION.md).
Keep `OCR_SERVICE_URL=http://localhost:8000` in `server/.env` for this local setup.
The OCR health response reports model loading separately from HTTP readiness.

## 8. Start the React dashboard

```bash
cd /home/jayant/Code/health-on/health-on-project/client
npm run dev
```

If dependencies are missing, run `npm ci` in `client/` once. Vite normally prints
`http://localhost:5173`; check its output in case that port is occupied.
`client/.env` must have the existing public Supabase settings and
`VITE_API_BASE_URL=http://localhost:4000`.

Open `/community-care` on that dashboard with the configured professional account
to review the queue. A normal patient account cannot access professional cases.

## 9. Start the Android patient app

From a Flutter/Android-configured terminal:

```bash
cd /home/jayant/Code/health-on/health-on-project/mobile
flutter run --dart-define-from-file=config.json
```

If Flutter is not on `PATH`, the installed executable is
`/home/jayant/snap/flutter/common/flutter/bin/flutter`.
The known local Android paths, if your shell needs them, are:

```bash
export JAVA_HOME=/mnt/CollegeWork/AndroidDev/android-studio/jbr
export ANDROID_HOME=/mnt/CollegeWork/AndroidDev/AndroidSDK
```

Use the same public Supabase project/key as the website in `mobile/config.json`.
For the Android emulator, set `API_BASE_URL` to `http://10.0.2.2:4000`.
For a USB-connected physical Android device, run:

```bash
/mnt/CollegeWork/AndroidDev/AndroidSDK/platform-tools/adb reverse tcp:4000 tcp:4000
```

Then set `API_BASE_URL` to `http://127.0.0.1:4000` and restart the Flutter run with
`--dart-define-from-file=config.json`. These settings are compiled into the app;
changing the JSON alone does not update an already installed APK.

Backend restarts or changes to the safety-service bypass do not require an APK rebuild.
Refresh/reopen Community after services are available. Android push additionally needs
`mobile/android/app/google-services.json`, the configured jobs credentials and notification
permission; see [the Firebase setup guide](docs/community-implementation.md#android-push-setup).

## 10. Verify startup

Public API health:

```bash
curl --fail --max-time 5 http://localhost:4000/health
```

Optional OCR health:

```bash
curl --fail --max-time 5 http://127.0.0.1:8000/health
```

Check listening ports without dumping environment files or request data:

```bash
ss -ltnp | rg ':4000|:4101|:4102|:8000|:11434|:5173'
```

The identity and safety services do not expose a public `/health` endpoint. Seeing
their ports listening does not by itself prove database configuration is correct.
Use the [Postman collection and environment](docs/postman/README.md) with a synthetic
patient account to verify the full path:

1. Login and save the session access token.
2. `GET /api/community/notice` should return `enabled: true`.
3. Accept the current notice with `POST /api/community/enrol`.
4. `GET /api/community/me` should return the public username.
5. Submit a fictional post, check My posts, then run the worker after its publication delay.
6. Read the published feed and test replies. Use the collection's explicitly enabled
   synthetic outreach tests only on a test setup.

`GET /health` returning 200 only confirms that the main API is running. It does not
verify identity/safety connectivity, clinic readiness, posting or notification delivery.

## Troubleshooting and stopping

| Symptom | Check |
| --- | --- |
| `node: bad option: --env-file` | Select Node 24 through nvm, or use its full executable path above. |
| Identity configuration missing | Use `identity.env`, not the public API's `.env`. |
| `EADDRINUSE` / address already in use | A copy already owns that port. Stop that service in its own terminal; do not start duplicates. |
| Community unavailable / 503 | API-to-identity/safety URLs and matching keys; correct per-service DB login/config; required Supabase settings. |
| Notice says `enabled: false` | Clinic configuration and verified on-call readiness in Supabase; the LLM bypass does not skip this gate. |
| 401 | Sign in again; use the session access token rather than an anon/service-role key. |
| 403 | Consent, membership, ownership or professional role/assignment. |
| Submitted post absent from feed | Check My posts for held content; otherwise wait for publication delay and run the worker. |
| Feed loads but posting returns 503 | Check `COMMUNITY_WORKER_DATABASE_URL` in `saftey.env`. The current safety login is `medbrief_safety_login`, not `medbrief_saftey_login`; restart the safety service after correcting its env file. |
| Normal mode fails but bypass works | Ollama availability, installed model, configured model version and screening timeout. |
| Inbox works but push does not | Firebase credentials/project, Android configuration, permission/device registration and worker alerts. |
| Android cannot reach the API | Emulator `10.0.2.2` versus physical-device USB reverse; configured port; compiled app config. |

Stop foreground services and the worker loop with `Ctrl+C` in their own terminals.
For OCR started with Docker:

```bash
cd /home/jayant/Code/health-on/health-on-project
docker compose -f PaddleOCRFastAPI/docker-compose.yml stop
```

Stop a manually started Ollama server in its terminal. An existing system-managed
Ollama instance can remain running. Do not delete database data, env files or Docker
volumes just to stop the application.

For the current **community-only testing** setup, the minimum is: identity service,
safety service in bypass mode, public API, repeated worker runs and the Android app
or Postman. Add OCR for reports, React for the professional dashboard, and Ollama
when you restore full screening.
