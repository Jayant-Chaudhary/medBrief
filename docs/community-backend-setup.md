# Set up the community backend on another computer

This guide assumes Ubuntu/Linux (or a Linux environment on another computer), the
latest MedBrief working copy, and the **same hosted Supabase project** we already
configured. All backend processes run on that new computer. This is the development
setup; using real participants requires the normal screening and clinic safety setup.

If you reuse the same Supabase project, the users, posts, tags, roles, migrations and
clinic settings are already there. Do not rerun the demo seed, recreate the database,
reset login passwords or apply existing migrations again just to change computers.

The username chooser needs `supabase/migrations/20261028000011_community_username.sql`
followed by `supabase/migrations/20261028000012_community_username_lock.sql`. Apply
each pending file once in Supabase SQL Editor before using **Choose username**. Do not
reapply 11 if it is already installed. The current restricted application logins
cannot install it; an administrator must run it. This adds a function for changing the
current member's own username; it does not expose the private identity mapping.
The first choice locks the name; another choice is allowed only after an approved
identity reveal rotates it, and that new choice locks it again.

## 1. Get the latest code and required tools

Transfer the latest project or clone its repository. **Uncommitted changes on the old
computer do not arrive through `git clone`**: include the current community code and
pending migrations when transferring the working copy. Do not copy `node_modules`;
install dependencies on the new machine.

Install Node 24, matching the major version used by this project, using your existing
nvm setup or the [official Node download instructions](https://nodejs.org/en/download).
With nvm already installed:

```bash
nvm install 24
nvm use 24
node --version
npm --version
```

Install the PostgreSQL CLI and basic tools on Ubuntu/Debian:

```bash
sudo apt update
sudo apt install postgresql-client ca-certificates curl git
psql --version
```

`psql` must be available to **each** backend process. The community adapter launches
it directly; npm packages alone are insufficient. You do not need to run a local
PostgreSQL server. Ollama is optional while the development LLM bypass is enabled.

Choose these paths on the new computer. Change the project path if you cloned elsewhere;
run these exports in every service terminal:

```bash
export MEDBRIEF_PROJECT_DIR="$HOME/Code/medbrief"
export MEDBRIEF_PRIVATE_DIR="$HOME/medbrief-private"
```

From the new project:

```bash
cd "$MEDBRIEF_PROJECT_DIR/server"
npm ci
mkdir -p "$MEDBRIEF_PRIVATE_DIR"
chmod 700 "$MEDBRIEF_PRIVATE_DIR"
```

## 2. Transfer private configuration separately

Use a secure transfer method such as SSH/SFTP or your password manager. These files
are not supplied by Git:

| Old computer | Destination on new computer |
| --- | --- |
| `server/.env` | New project's `server/.env` |
| `/home/jayant/medbrief-private/identity.env` | `$MEDBRIEF_PRIVATE_DIR/identity.env` |
| `/home/jayant/medbrief-private/saftey.env` | `$MEDBRIEF_PRIVATE_DIR/saftey.env` |
| `/home/jayant/medbrief-private/jobs.env` | `$MEDBRIEF_PRIVATE_DIR/jobs.env` |
| `/home/jayant/medbrief-private/community-rules.json` | `$MEDBRIEF_PRIVATE_DIR/community-rules.json` |
| `/home/jayant/medbrief-private/firebase-worker.json` | `$MEDBRIEF_PRIVATE_DIR/firebase-worker.json`, if testing push |
| `/home/jayant/medbrief-private/community-test-accounts.json` | Optional: private synthetic test login credentials |

Keep the existing filename **`saftey.env`**, including that spelling, to match the commands
below. If you rename it, update every command accordingly. Do not transfer old backup
env files in place of the corrected files.

After transfer, restrict permissions on the files you copied:

```bash
chmod 600 "$MEDBRIEF_PROJECT_DIR/server/.env"
find "$MEDBRIEF_PRIVATE_DIR" -maxdepth 1 -type f -exec chmod 600 {} +
```

Keep the private directory outside the repository. Never combine all database credentials
in one env file or export them all into a shared shell. In production, isolate these
services further with separate OS users/containers and service-specific file permissions.

If recreating files manually instead, use the variable checklist below and the existing
[API example](../server/.env.example) and [community example](../server/src/community/community.env.example).
Those examples contain placeholders, not working credentials.

## 3. Edit paths and verify each env file

Values inside env files need **literal absolute paths on the new computer**. Do not
leave `/home/jayant/...` paths there unless the new computer actually uses those paths.
Do not assume `$HOME` or `$MEDBRIEF_PRIVATE_DIR` expands inside an env-file value.

### Public API: `server/.env`

Retain the existing API's required Supabase, OCR and other application settings. Check
these community entries:

```dotenv
PORT=4000
NODE_ENV=development
COMMUNITY_DATABASE_URL=REPLACE_WITH_RUNTIME_LOGIN_CONNECTION_URL
COMMUNITY_IDENTITY_URL=http://127.0.0.1:4101
COMMUNITY_IDENTITY_SERVICE_KEY=REPLACE_WITH_IDENTITY_SERVICE_SECRET
COMMUNITY_SAFETY_URL=http://127.0.0.1:4102
COMMUNITY_SAFETY_SERVICE_KEY=REPLACE_WITH_SAFETY_SERVICE_SECRET
```

The existing API also uses `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `CLIENT_APP_URL`, `OCR_SERVICE_URL` and
`OCR_CONFIDENCE_REVIEW_THRESHOLD`. Copy the working settings rather than overwriting
them with the example's dummy values. The broad Supabase service-role key stays in
the existing server only; it is not a community database login or a mobile key.

### Identity service: `identity.env`

```dotenv
COMMUNITY_IDENTITY_DATABASE_URL=REPLACE_WITH_IDENTITY_LOGIN_CONNECTION_URL
COMMUNITY_IDENTITY_SERVICE_KEY=REPLACE_WITH_SAME_IDENTITY_SECRET_AS_API
COMMUNITY_IDENTITY_PORT=4101
SUPABASE_URL=REPLACE_WITH_EXISTING_PROJECT_URL
SUPABASE_ANON_KEY=REPLACE_WITH_EXISTING_ANON_KEY
```

The startup check requires all four identity DB/key/Supabase values. Do not use the
public API's `.env` as a substitute for this file.

### Safety service: `saftey.env`

```dotenv
NODE_ENV=development
COMMUNITY_WORKER_DATABASE_URL=REPLACE_WITH_SAFETY_LOGIN_CONNECTION_URL
COMMUNITY_SAFETY_SERVICE_KEY=REPLACE_WITH_SAME_SAFETY_SECRET_AS_API
COMMUNITY_SAFETY_PORT=4102
COMMUNITY_RULES_FILE=/home/NEW_USER/medbrief-private/community-rules.json
COMMUNITY_LLM_BYPASS=true
```

Replace `NEW_USER` and all placeholders. For the current synthetic testing mode,
`NODE_ENV=development` plus `COMMUNITY_LLM_BYPASS=true` allows testing without Ollama.
Phone/email/link removal and keyword rules remain active. Names/locations are not
reliably removed and model-only concerns are not detected in bypass mode.

### Jobs worker: `jobs.env`

```dotenv
COMMUNITY_WORKER_DATABASE_URL=REPLACE_WITH_JOBS_LOGIN_CONNECTION_URL
COMMUNITY_FCM_CREDENTIALS_FILE=/home/NEW_USER/medbrief-private/firebase-worker.json
```

Update the Firebase path if using push. If you are not configuring push yet, omit
`COMMUNITY_FCM_CREDENTIALS_FILE` rather than pointing it at a missing/dummy file. The
worker can still process publication jobs; push attempts cannot succeed without credentials.

The API and identity service must share the same identity secret; the API and safety
service must share the same safety secret. The two secrets should be different from
each other and each at least 32 characters. Reusing the securely transferred working
values is sufficient for this development move. If generating replacement secrets,
update both corresponding files on the new backend before starting.

## 4. Check database logins and network access

Use the existing dedicated login/password in each connection URL:

| Process | Login | Granted capability role |
| --- | --- | --- |
| Public API | `medbrief_api_login` | `medbrief_community_runtime` |
| Identity/reveal | `medbrief_identity_login` | `medbrief_reveal_service` |
| Safety | `medbrief_safety_login` | `medbrief_community_worker` |
| Jobs worker | `medbrief_jobs_login` | `medbrief_community_worker` |

The safety login is **`medbrief_safety_login`**, not `medbrief_saftey_login`. The filename
is `saftey.env`, but the database login uses the correct spelling. That URL typo caused
the “Your post could not be submitted” error even while feed reads worked.

Get connection details from your project's **Connect** dialog. For an IPv4-only new
network, Supabase's session pooler is an alternative to the direct IPv6 connection.
Custom roles through the shared pooler use `ROLE.PROJECT_REF` as their username;
direct connections use the role name. Copy the actual host/port rather than guessing
them, and percent-encode reserved characters in the password. See
[Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

Keep a TLS-verifying configuration. If the existing URLs use `sslmode=verify-full`,
transfer/download the project root certificate and set its new absolute path through
`PGSSLROOTCERT` in each DB-using process's env file. This adapter forwards that environment
variable to `psql`; it does **not** forward arbitrary connection URL options such as
`sslrootcert`. See the [Supabase SSL instructions](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl).
Do not disable verification to work around an incorrect certificate path.

If the project restricts database client IPs, allow the new computer's approved outgoing
IP. Its network must also reach Supabase Auth/HTTPS, the selected database endpoint,
and Firebase/Google HTTPS endpoints if push is enabled.

Existing database login settings must retain `log_statement=none` and
`log_min_error_statement=panic`. The adapter refuses database calls otherwise.
Moving machines does not reset these settings on the same hosted database.

In Supabase SQL Editor, these read-only checks reveal no patient mappings:

```sql
select community_private.ready() as community_ready;

select rolname, rolcanlogin, rolsuper, rolbypassrls
from pg_roles
where rolname in (
  'medbrief_api_login', 'medbrief_identity_login',
  'medbrief_safety_login', 'medbrief_jobs_login'
)
order by rolname;
```

Readiness should be `true`; all four login roles should have `rolcanlogin=true`,
`rolsuper=false` and `rolbypassrls=false`. Membership/grants remain enforced by the
existing migrations and administrative setup; do not grant direct table access or
use the `postgres` account to make a runtime failure disappear.

## 5. Start each backend process

Run the path exports from section 1 in each terminal. Ensure the selected `node` is
Node 24 in each shell. Start only one copy per service port.

### Terminal A: identity

```bash
cd "$MEDBRIEF_PROJECT_DIR/server"
node --env-file="$MEDBRIEF_PRIVATE_DIR/identity.env" src/community/identity-service.js
```

### Terminal B: safety, with development LLM bypass

```bash
cd "$MEDBRIEF_PROJECT_DIR/server"
NODE_ENV=development COMMUNITY_LLM_BYPASS=true \
  node --env-file="$MEDBRIEF_PRIVATE_DIR/saftey.env" src/community/safety-service.js
```

### Terminal C: public API

```bash
cd "$MEDBRIEF_PROJECT_DIR/server"
node --env-file=.env src/app.js
```

### Terminal D: repeated worker runs for local testing

```bash
cd "$MEDBRIEF_PROJECT_DIR/server"
COMMUNITY_WORKER_POLL_SECONDS=10
while true; do
  node --env-file="$MEDBRIEF_PRIVATE_DIR/jobs.env" src/community/worker.js
  sleep "$COMMUNITY_WORKER_POLL_SECONDS"
done
```

The worker is one-shot. This loop runs it repeatedly; 10 seconds is an adjustable local
polling interval, not a clinical response threshold. Use an existing scheduler instead
if one is configured. Investigate failures and operational alerts. Due publication,
outreach timers and push jobs need the worker even when the LLM is bypassed.

The identity/safety ports remain on loopback (`4101`/`4102`). Do not expose them to
Android, Postman or the public network; those clients use the Node API on port `4000`.
These instructions intentionally keep the internal processes on the same machine.

## 6. Restore local-model screening when required

Install Ollama using its [official instructions](https://docs.ollama.com/quickstart).
Use the local model; this backend does not require an Ollama cloud account/API key.
Check for an already running instance before starting another:

```bash
curl --fail --max-time 5 http://127.0.0.1:11434/api/tags
```

If needed, start Ollama in another terminal:

```bash
ollama serve
```

Download the model on the new machine; downloading the source code does not download
Ollama model weights:

```bash
ollama pull qwen3:8b
ollama list
```

Set these in the safety file, keeping its existing rules path and credentials:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
COMMUNITY_MODEL=qwen3:8b
COMMUNITY_MODEL_VERSION=REPLACE_WITH_YOUR_TESTED_MODEL_AND_RULES_VERSION
COMMUNITY_LLM_BYPASS=false
```

Replace the version placeholder. Stop terminal B with `Ctrl+C` and restart it as:

```bash
cd "$MEDBRIEF_PROJECT_DIR/server"
COMMUNITY_LLM_BYPASS=false \
  node --env-file="$MEDBRIEF_PRIVATE_DIR/saftey.env" src/community/safety-service.js
```

The current model call timeout is 10 seconds per call. Test the actual new machine:
a cold or slow model can exceed it. A post screens both body and title, so one successful
Ollama health check is not enough to prove posting works. Do not treat development
bypass as full moderation or use it for real participant content.

## 7. Verify the new backend with Postman

First check the public API:

```bash
curl --fail --max-time 5 http://localhost:4000/health
ss -ltnp | rg ':4000|:4101|:4102'
```

The port-listing command needs `rg`; if unavailable, inspect `ss -ltnp` directly.
The internal services have no public `/health` route. API health returning 200 is
only the first check, not proof that community database writes work.

Import the [collection](postman/MedBrief.community.postman_collection.json) and
[environment template](postman/MedBrief.community.postman_environment.json).
Set Postman's `baseUrl` to the new API's reachable address. Use a synthetic account
from the securely transferred test credential file, or create a separate synthetic
patient account. Accounts/posts already in the same Supabase project do not need seeding
again. The temporary scripts previously used to create samples are not required to run
this backend and are not part of the repository setup.

Send requests individually in order:

1. Login; the collection saves `session.access_token` locally.
2. Read `/api/community/notice`; expect `enabled: true`.
3. Accept the current consent notice with `/api/community/enrol`.
4. Read `/api/community/me`, `/tags` and `/posts`.
5. Submit a **new fictional post**. Expect HTTP 200 and `state: pending` for normal content.
6. Read `/posts/mine`, wait for the configured publication delay, then confirm the worker
   has run and the post appears in `/posts`.
7. Submit/read a reply. Check the private inbox if your synthetic account has a case.

The collection stores a separate request UUID per write. Clear the appropriate stored
key for a different logical post/reply; retain it when retrying the same write.
Only enable optional help-case tests on an isolated test setup. See the
[Postman guide](postman/README.md) for bodies, expected responses and authorization checks.

## 8. Point Android and the dashboard at the new computer

In the Flutter app's `mobile/config.json`, keep the same public Supabase settings and
change only `API_BASE_URL` as needed:

| Client location | API base URL |
| --- | --- |
| Emulator running on the new backend computer | `http://10.0.2.2:4000` |
| Physical phone on the same development LAN | `http://NEW_BACKEND_LAN_IP:4000` |
| Emulator on the old computer, API on the new one | `http://NEW_BACKEND_LAN_IP:4000` |
| Phone connected by USB to the new backend computer, with adb reverse | `http://127.0.0.1:4000` |

For USB development, run on the new computer:

```bash
adb reverse tcp:4000 tcp:4000
```

For LAN testing, find the new computer's local IP and allow only the required local
development access to API port 4000 in its firewall. Do not expose identity/safety,
Ollama or a database port. `localhost` on a phone refers to the phone itself unless
you set up USB reverse. With WSL/VMs, also verify host-to-guest port forwarding.

Restart the app with the new compiled config:

```bash
cd "$MEDBRIEF_PROJECT_DIR/mobile"
flutter run --dart-define-from-file=config.json
```

Rebuild/reinstall if testing an APK. HTTP is allowed only by this project's debug
Android configuration; a hosted/release backend requires HTTPS. Public HTTPS is also
needed for clients outside your development network.

For React, set `VITE_API_BASE_URL` in `client/.env` to the new reachable API URL and
restart Vite. Keep `CLIENT_APP_URL` in `server/.env` aligned with the dashboard origin
for CORS and invitation links. OCR is separate; community tests do not need it. See
[startup.md](../startup.md) for OCR, dashboard and Android startup details.

Android push additionally needs the same Firebase project configuration in
`mobile/android/app/google-services.json` when building the app, the private service
account file for the worker, notification permission and device registration. Moving
the backend alone does not require replacing the Firebase project.

## 9. If using a completely new Supabase project instead

This is a separate database setup, not just moving the backend. First apply the
existing base application migrations needed by Auth/profiles. The community migrations
then run in this order, exactly once:

```text
20261027000000_community_identity.sql
20261028000000_community_storage.sql
20261028000001_community_capabilities.sql
20261028000002_community_read.sql
20261028000003_community_submit.sql
20261028000004_community_actions.sql
20261028000005_community_care.sql
20261028000006_community_jobs.sql
20261028000007_community_reveal.sql
20261028000008_community_launch_gate.sql
20261028000009_community_management.sql
20261028000010_community_configuration.sql
20261028000011_community_username.sql
20261028000012_community_username_lock.sql
```

Check for any later community migrations in the transferred working copy and apply
those in filename order too. An administrator must then create the four restricted
LOGIN roles, grant only the capabilities listed above, configure their privacy logging
settings, and populate the clinic's approved configuration/professional roster. Keep
RLS and private-schema isolation intact; do not expose community schemas through the
Supabase Data API to bypass the Node backend.

Use the [implementation guide](community-implementation.md) and
[configuration template](community-settings.example.json) for the required settings.
For an empty **synthetic test project only**, `supabase/seeds/community_demo.sql` is a
manual bootstrap: edit its `test_doctor_auth_id` to an actual test doctor's Auth ID
before running. It currently contains an old project-specific UUID, not a portable
working doctor account. Do not run it against an existing populated community.

A new Supabase project has new URLs/keys, database credentials and users. Update every
env/client config consistently. Existing test users, posts and professional roles do
not automatically appear there.

## Troubleshooting

| Symptom | First checks |
| --- | --- |
| `bad option: --env-file` | Wrong Node executable; select Node 24 in that terminal. |
| `psql` missing or every DB call fails | Install the PostgreSQL client and make it available in each service's `PATH`. |
| Missing identity DB configuration | Start with `identity.env`, not the public API's `.env`. |
| Feed works but submission fails | Safety DB URL: correct `medbrief_safety_login`, its password, grants and privacy log settings. |
| 403 between internal services | Matching API/service secrets, minimum key length, correct service URL. |
| Database connection failure only on the new computer | Network reachability, pooler/direct username format, IP restrictions, TLS certificate path and encoded password. |
| Notice `enabled: false` | Same Supabase project? Required settings/verified on-call roster? Bypass does not skip readiness. |
| New post stays pending | Worker running repeatedly? Configured delay elapsed? Read My posts for held revisions. |
| Safety fails without bypass | Local Ollama, installed `qwen3:8b`, valid version/rules and model latency. |
| Rules/FCM file not found | Replace old `/home/jayant/...` paths with literal absolute paths on the new machine. |
| Postman works on the host, Android does not | Emulator versus LAN/USB URL, firewall, debug HTTP and app config rebuild. |
| Inbox works but no push | Firebase credentials/project, app config, permission/registration, worker and operations alerts. |

Stop foreground processes/worker loops with `Ctrl+C`. Once the new backend is verified,
stop the old development processes if handing over to this machine; otherwise both
backends still operate on the same shared Supabase data.
