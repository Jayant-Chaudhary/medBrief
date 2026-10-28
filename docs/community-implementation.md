# Community implementation and launch guide

## What is implemented

One shared tagged feed, threaded comments, immutable screened revisions, author-only
pending posts, private professional outreach, a patient Care inbox and a separate React
workspace at `/community-care`. The patient app opens Community from its signed-in
landing page. There are no circles or member-to-member direct messages.

Community uses the existing Supabase Postgres database. It does not use a Storage
bucket for text. The existing hosted project was configured manually through
`20261028000010_community_configuration.sql`. The new username capability needs
`20261028000011_community_username.sql` followed by
`20261028000012_community_username_lock.sql` applied separately by an administrator.
Automated migration/permission/rollback tests run against disposable PostgreSQL.

## Identity and database boundary

The original identity migration is followed by the `20261028*` workflow migrations.
All community tables have forced RLS and deny direct client/legacy service-role access.
The new runtime and worker roles have **function execution only**, with no table grants.
Fixed-search-path security-definer functions perform ownership, professional-role,
assignment, consent and expiry checks and return explicit response fields.s

The isolated identity service validates Supabase sessions and issues a random internal
capability valid for 60 seconds. Only its hash is stored. It contains no encoded identity
and is never sent to Flutter or React. PostgreSQL validates the capability against the
private table. Callers cannot choose an actor through a session variable. Each capability
use rechecks active membership and current consent. Database administrators remain trusted.

The database stores:

| Group | Tables |
| --- | --- |
| Identity (existing) | members, community_links, username_history, role_grants, consent_records |
| Public discussions | tags, posts, post_tags, comments |
| Content workflow | revisions, reports, idempotency |
| Professional care | cases, case_events, care_threads, care_participants, messages, responses, receipts |
| Operations | jobs, operations_alerts, notification_outbox, devices, settings |
| Private authorization | capabilities, reveal_requests, reveal_decisions, reveal_reviewers, reveal_grants, reveal_audit |

Posts/comments have public random content IDs and internal author IDs. Names are looked
up from current membership; rotation changes every historical display. Member IDs and
mapping rows are never returned. Feed timestamps are bucketed using clinic configuration.
Replies must belong to the same post as their parent, and parents cannot be changed.

## Services and credentials

Use three separate OS service accounts or isolated containers; do not load all credentials
into the existing public Node process. Keep request/body logging disabled on internal
reverse proxies and APM. Internal HTTP is loopback-only; remote internal URLs require TLS.

| Process | Database capability | Start command from server/ |
| --- | --- | --- |
| Existing public Express API | medbrief_community_runtime | `npm start` |
| Isolated identity/reveal service | medbrief_reveal_service | `node src/community/identity-service.js` |
| Isolated redaction/classification service | medbrief_community_worker | `node src/community/safety-service.js` |
| Scheduled jobs / generic push sender | medbrief_community_worker | `node src/community/worker.js` |

`src/community/community.env.example` lists environment variable names. Load only each
process's subset. Identity service needs the Supabase publishable/anon key, not the broad
service-role key. Service authentication secrets must be independently generated and at
least 32 characters. Internal services bind to loopback by default.

For the current local setup, start the identity service from `server/` using its
dedicated file, rather than the public API's `.env`:

```bash
node --env-file=/home/jayant/medbrief-private/identity.env src/community/identity-service.js
```

Use Node 20 or later, as required by the server. `node -r dotenv/config` alone reads
the API's `.env`, which does not contain the isolated identity database URL. The service
now checks its required settings before listening, so this mistake fails at startup.

The database adapter uses the installed `psql` executable and no shell. Parameters are
encoded and sent over stdin, never command arguments; errors returned to clients are
fixed codes. It opens a process/connection per bounded function call. This is suitable
for the one-clinic MVP; a future pooled adapter can preserve the same function boundary.
No `pg` Node dependency was installed.

For each process, an administrator must provision a dedicated LOGIN role with INHERIT,
NOSUPERUSER, NOCREATEDB, NOCREATEROLE and NOBYPASSRLS, then grant **only** the corresponding
capability role above. Never grant postgres, service_role, authenticator or the unused
old medbrief_community_reader role to these logins. Do not grant new capabilities to
Supabase's client roles. Credentials are not generated or committed by migrations.

Before runtime calls, the adapter checks database logging: `log_statement` must be `none`
and `log_min_error_statement` must be `panic`. Have the database administrator configure
these for the dedicated login roles, and disable SQL parameter/body capture in any
additional audit/APM tooling. Otherwise the adapter fails closed. PostgreSQL CLI must
be present in each service's deployment image. Use TLS-verifying database connection
configuration for hosted connections. Verify Supabase permits the chosen per-role
logging settings in staging before deployment.

## Clinic configuration and professional bootstrap

`community-settings.example.json` contains placeholders only. Populate corresponding
`community_private.settings(key,value)` entries administratively after the clinic has
approved them. All timings and thresholds remain unset in the repository.

Supply the consent version, approved outreach/helpline text, per-tier hours, reporter
threshold and account age, publication delay range, timestamp bucket size, retention
procedure, emergency protocol, reveal duration and single/dual-approver policy.

Bootstrap the clinic's verified professional administratively: create their community
member and private account link, then a role_grants row with role doctor/therapist,
verification_status verified, a recorded grantor and nonempty public display_name.
This is privileged administration, not an endpoint a user can invoke to award a badge.
Place the professional's internal community ID in the private `on_call` JSON array.
Configure a moderator separately if they need tag-management access. Do not paste these
mapping IDs into logs or application responses.

Set enabled=true only after the roster and settings are valid. Readiness fails closed
for missing, malformed or nonpositive required values and missing named on-call staff.
The membership bootstrap must precede enablement. Seed topic tags using the moderator
workspace after the deployment is ready.

The retention setting documents the clinic-approved operating procedure; automated
purging and account erasure require that policy to be specified and separately validated.
Foreign keys deliberately prevent silent cascading loss of safety/audit records.

## Public username choice and inline discussions

Apply `20261028000011_community_username.sql`, then
`20261028000012_community_username_lock.sql` once after the earlier community
migrations. The paired rollbacks preserve current names and reserved history;
rolling back the lock migration restores the previous unrestricted chooser policy.
`POST /api/community/username` accepts
`{requestKey,username}` under the patient's bearer token. Only the current actor can
change their name; authentication, current consent and active membership still apply.
Names use 3–32 lowercase letters/digits/underscores, starting with a letter. Long digit
runs and reserved staff/service prefixes are rejected. Taken or retired names return
409 without revealing who owns them. Old names remain reserved, including those
retired after an approved identity reveal. Historical posts/replies look up the new
public name; the account-to-community mapping is unchanged.

A mother may choose once initially. Saving locks the name. Only a new
`approved_reveal` history event from the human-approved reveal/rotation transaction
unlocks one new choice; choosing again locks it immediately. Flags, outreach, reveal
requests, denial, grant expiry and repeated contact reads do not unlock it. Choices
do not accumulate across multiple reveals. The server row-locks this state, so two
concurrent requests cannot both change it. Idempotent retries remain valid. Existing
chosen names are locked during upgrade; ambiguous legacy history stays locked until
a later approved rotation. Previously exposed names remain unavailable.

`GET /api/community/username/status` returns only the current actor's
`{canChooseUsername}`. The app disables its chooser when false, and defaults to locked
if this check fails. Database enforcement returns 403 for a different name while
locked, including requests from old/modified clients. Refresh after a rotation to
retrieve the new status. No new identity mapping access is granted.

Flutter offers the chooser from the community avatar and the username row. Failed saves
retain the proposed name. Read discussion expands below its post, with nested reply
branches, collapse/expand controls, child pagination and inline reply composition.
Only published replies are visible; submitted replies still pass screening and the
normal publication worker. There are no added votes, awards, shares or member DMs.

## Safety and private messages

The isolated processor strips deterministic contact patterns and asks the local model
for exact identifying substrings to remove. It then runs both the private phrase rules
and the classifier; the higher tier wins. No cloud model path is implemented. Configure
COMMUNITY_RULES_FILE to a private JSON array of `{phrase,tier,code}` records, using
clinician-reviewed Hindi, English and Hinglish coverage. Configure a local Ollama model
and a model/rules version. Do not treat the synthetic test phrases as a production list.

Redaction failure rejects the submission without storing raw text. Classifier failure
holds cleaned content and creates review/operations work. Normal content publishes via
an idempotent scheduled job after the configured random delay. Edits create new revisions;
a stale job cannot overwrite a later revision. A professional may approve a held revision
with a reason; error revisions require successful reprocessing/resubmission rather than
bypassing a failed safety check. A human closes each safety case.

A concern report immediately creates review work; abuse reports require the configured
number of distinct reporters. Reporting eligibility uses community membership age.
A case sends the configured private outreach to the mother and creates an on-call queue
item. Only the subject and currently assigned verified professionals can read a care
conversation. Unassigned on-call staff see only case ID and tier until they claim it.
Moderators/volunteers cannot read private care messages based on their badges.

Opening, replying, 'I'm okay' and 'I need help' all record a response. They never close a
case. 'I need help' raises the queue tier. Messages pass through the same local screening
boundary. No contact details are required for pseudonymous outreach.

### Testing other features without Ollama

The safety service supports `COMMUNITY_LLM_BYPASS=true` only when `NODE_ENV` is
explicitly `development` or `test`. The flag defaults to off. A production or unspecified
environment refuses to start with the bypass enabled; this is a server setting, never
a client-supplied option.

From `server/`, stop the existing safety-service process and start it using your safety
environment file (the current local filename is `saftey.env`):

```bash
NODE_ENV=development COMMUNITY_LLM_BYPASS=true \
  node --env-file=/home/jayant/medbrief-private/saftey.env \
  src/community/safety-service.js
```

This skips both model calls, so Ollama and model configuration are unnecessary. Keep
`COMMUNITY_RULES_FILE` configured: keyword rules and phone/email/link removal still run.
Rules can still hold a post and trigger the existing professional review/outreach flow.
Normal posts still need the scheduled worker and configured publication delay. Identity,
consent, authorization, job processing and human reveal approval are unchanged. No SQL
migration or Flutter rebuild is needed.

Use synthetic posts and test accounts only: names, hospitals and locations are not
reliably removed in this mode, and model-only concerns are not detected. Each screened
revision/message records `screening.model.bypassed=true` and version
`development-llm-bypass-v1`, rather than claiming that an actual model approved it. The
service prints a generic startup warning without submitted text or identifiers.

To restore full screening, restart the same service with `COMMUNITY_LLM_BYPASS=false`
(or remove the flag) and the normal Ollama/model configuration. This affects new
submissions; it does not rescreen earlier test content. Keep test content out of any
future live rollout.

Only a professional can record that a case is eligible for reveal review. Reports by
themselves cannot do so. A no-response job may create a request, never an identity reveal.
Human approval requires a reason, rechecks late responses and follows the configured
single/dual-approver policy. Second reviewers explicitly take review context before
voting. Votes are tied to the response snapshot; outdated votes do not satisfy approval.
Single approval requires a written explanation for the missing second approver.

Approval atomically reserves the old username, rotates it and issues expiring access
for the assigned professional. The isolated reveal function returns only name, phone
and expiry, logs each view, and refuses expired/revoked grants or closed/ineligible cases.
There is no direct profile-table SELECT grant for the service. Contact details are not
stored in the browser, are cleared on expiry/tab hiding and never enter clinical dashboards.
Screenshots and recognition from stories remain residual risks.

Run the worker repeatedly using the deployment scheduler. The workspace polls the queue
while visible. Failed jobs and notification deliveries create operational alerts; a crashed
worker must also be monitored by the host scheduler. Operators investigate alerts and retry
failed jobs under the clinic's procedure; there is no automatic reveal or silent closure.

## Android push setup

Approved packages: firebase_core and firebase_messaging. The installed SDK uses Firebase
Installation IDs (FIDs); the API's `token` field stores that FID and the sender uses HTTP v1
`message.fid`. Push text is always 'You have a new message.' and contains no post/case IDs.
Delivery success is not read acknowledgment. Delivery is recorded per recipient.

1. Register Android package `com.healthon.health_on_patient` in the clinic's Firebase project.
2. Download its `google-services.json` into `mobile/android/app/`; it is gitignored.
3. Provide a Firebase service-account credentials file only to the notification worker.
4. Enable the required messaging API/IAM permission for that service account.
5. Rebuild/install on a Google Play services device and enable 'Generic message notifications'
   in Community. The app requests OS permission, registers its FID and handles refreshes.
6. Verify background/terminated notification delivery, tapping to the authenticated inbox,
   permission denial, FID changes and sign-out. Auto-init and analytics collection default off.

The Google services Gradle plugin applies only when configuration is present, so a build
without Firebase project configuration still supports the inbox. Sign-out removes the
server registration when possible, disables auto-init and unregisters FCM. No message body
is downloaded or acknowledged simply because a push arrived. Care professionals use the
visible web queue; browser push registration is not part of this Android-first slice.

## API summary

All routes are under `/api/community`, require a Supabase bearer token, and set no-store.
Write endpoints use requestKey UUIDs except consent, reveal decisions/contact and tag
upserts. Content writes reject client-supplied screening/author fields. Idempotency keys
must not be reused for a different operation. Clients retain keys across failed retries.

- GET notice, me, tags, posts (`tag`, `before`), posts/mine, posts/:id,
  posts/:id/comments (`parentId`, `before`).
- POST enrol `{noticeVersion}`; posts `{requestKey,title,body,tags}`;
  posts/edit adds `id`; comments `{requestKey,postId,parentId?,body}`;
  comments/edit `{requestKey,id,body}`; posts/remove and comments/remove `{requestKey,id}`.
- POST reports `{requestKey,id,targetType,category}`; help `{requestKey,id,targetType}`.
- GET care/threads and care/threads/:id/messages (`before`);
  POST care/messages `{requestKey,id,body}` and care/respond `{requestKey,id,kind}`.
- POST devices and devices/remove `{requestKey,token}`.
- GET professional/queue, professional/cases, professional/alerts,
  professional/cases/:id/revisions; POST professional/claim `{requestKey,id}`.
- POST professional/outreach, assess_case, close_case, review_revision with
  `{requestKey,id,reason}` plus targetType, eligible, or revisionId/publish as applicable.
- GET professional/reveals; POST professional/reveals/context `{id}`,
  decides at `professional/reveals/decide` with `{id,decision,reason,reassessed,singleApproverReason?}`,
  and contact `{id}`. These delegate to the isolated identity service.
- GET moderator/tags; POST moderator/tags `{slug,name,active}`.

## Validation and deployment

Commands from repository root:

```sh
bash supabase/tests/run-community-identity.sh
bash supabase/tests/run-community-workflows.sh
cd server
npm test -- --runInBand --coverage=false
```

Also run `flutter analyze`, `flutter test` and an Android build in mobile/, and `npm run
build` in client/. The database tests use disposable Unix-socket PostgreSQL with synthetic
accounts, never hosted credentials. They include migration rollback and reapplication.

Run `node src/community/evaluate.js /secure/deidentified-labelled-cases.json` in the safety
service environment to measure missed urgent tiers, unflagged urgent cases and false flags.
This prints aggregate counts only. Clinical validation on doctor-labelled multilingual
cases, redaction recall, adversarial prompts, indirect distress and mixed-language speech
must pass clinician-agreed acceptance criteria before launch. Unit tests do not establish
clinical sensitivity or reliable removal of every identifier.

For Supabase, inspect `supabase migration list` and `supabase db push --dry-run` before any
push. The existing repository has two older migrations with version `20260924000000`;
reconcile their hosted history before deployment. Do not blindly push or independently
paste these files into SQL Editor. Keep community/identity schemas out of exposed schemas.
The development-only workflow rollback is in supabase/rollbacks; it deletes these tables
and must never be run against retained production records without an approved data plan.

Launch still requires hosted migration/grant verification, Firebase project configuration,
real-device delivery testing, the private rules/model evaluation, clinic operational settings
and legal review of consent, emergency processing, retention and applicable DPDP provisions.

## Threat model

| Leak/failure | Implemented control / remaining limitation |
| --- | --- |
| API author identifiers | Explicit DB projections, response guard, no direct table grants |
| Forged ownership | Expiring opaque capabilities from session-verified identity service |
| Private inbox access | Subject/assigned-professional check; moderator badge gives no access |
| Logs/APM | Community bypasses identified logger; fixed errors; database logging gate; operators must also configure proxy/APM |
| Timing correlation | Random publication delay and coarse public times; small-clinic inference remains possible |
| Post contents | Contact stripping plus local entity redaction; test recall, never promise perfect anonymity |
| Username rotation | Current-name lookup and no-store responses; screenshots cannot be erased |
| Push/lock screen | Generic text, no case/content IDs; recipient-specific delivery tracking |
| Failed jobs | Durable states and human-visible operational alerts; monitor scheduler outages externally |
| Database owner compromise | Owners remain trusted; restrict administrator access/backups and separate service credentials |
| Model prompt injection | Structured output validation, rules floor and fail-closed handling; clinical/adversarial evaluation still required |

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Firebase Flutter registration](https://firebase.google.com/docs/cloud-messaging/flutter/get-started),
[Firebase HTTP v1](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send),
[Ollama structured output](https://registry.ollama.com/blog/structured-outputs).
