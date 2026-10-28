# Community tests in Postman

These requests use the existing API; no test-only endpoint or migration is required.
Use synthetic accounts and content against a test setup. The collection writes actual
posts and replies to the configured database. Optional help requests create actual
cases/outreach there, so run requests individually rather than running the entire
collection against a clinic.

## Import and configure

1. Import `MedBrief.community.postman_collection.json` and
   `MedBrief.community.postman_environment.json` into Postman.
2. Select **MedBrief Community — LOCAL TEST ONLY** as the active environment.
3. Set `baseUrl` to the public Node API, without a trailing slash. Its default port is
   `http://localhost:4000`; use your configured port if different. This is the public
   API port, not Ollama or internal service ports 4101/4102.
4. Put an existing synthetic patient login in the local `testEmail` and `testPassword`
   values. Keep credentials/tokens local; do not share/export a populated environment.
   Alternatively, skip request 02 and supply the patient's Supabase session access
   token as `accessToken`. Never use the Supabase service-role key.
5. Start the main API, identity service and safety service using their separate existing
   environment files. The safety service can use the development-only LLM bypass
   described in `../community-implementation.md`. Keep the scheduled worker available.

## Send these in order

| Request | What it establishes |
| --- | --- |
| 01 API health | Main API responds; this alone does not prove community readiness. |
| 02 Login | Saves `session.access_token` as the local `accessToken`. |
| 03 Notice | Checks `enabled=true` and saves the current `noticeVersion`. |
| 04 Enrol | Records acceptance of the notice for the synthetic account. |
| 05 Me | Returns the public community username, with no private identity mapping. |
| 06 Tags | Returns active tags; selects the first for the test post if available. |
| 07 Create post | Saves `postId`; normal content returns `state: pending`. |
| 08 My posts | Shows the latest own revision before it is publicly visible. |
| 09 Feed | Lists published posts. An empty array is valid before publication. |
| 10 Post detail | Confirms the created post was published; run after the worker. |
| 11 Create reply | Requires a published parent; saves `commentId`. |
| 12 Replies | Lists published replies; run after the worker again. |
| 13 Care inbox | Lists visible private threads. `[]` is valid with no case. |
| 14 Care messages | Requires `threadId`; reading does not record a response. |

Most successful requests return HTTP 200. A write returning 200 proves acceptance,
not publication or notification delivery. The collection saves IDs and tests response
shapes automatically; it never prints credentials or tokens to the Postman console.

After a normal post/reply submission, wait for your configured publication delay, then
run the worker from `server/` (or let your existing scheduler run it):

```bash
node --env-file=/home/jayant/medbrief-private/jobs.env src/community/worker.js
```

The worker runs once per invocation. Running it before the due time does not publish
the item early; invoke it again after the delay. `posts/mine` exposes the latest revision
state (`normal`, `held`, `published`, etc.), so a `normal` own revision can still be pending
publication. A `held` post requires review; the LLM bypass retains keyword rules.

Each write has its own stored UUID request key. Retain it to retry the same logical
write after a network failure. To create a new post/reply/message, or change its payload,
clear that action's environment key first; the pre-request script generates a new one.
Reusing an old key returns the previous action's result.

## Optional synthetic Care inbox test

1. Use an isolated test setup with a synthetic on-call professional. Set
   `allowSafetyTest` to the string `true` in the local Postman environment.
2. Send **OPTIONAL Create a synthetic help case on own post**. It uses `postId` and
   creates an urgent case even when Ollama is bypassed. No identity reveal occurs.
3. Re-run **13 Read Care inbox**. When exactly one thread exists, the collection saves
   its `threadId`. With multiple threads, manually select the intended test thread ID.
4. Send **14 Read private care messages** to inspect the configured private outreach.
5. The two optional requests can record opening the message and sending a reply. These
   count as actual responses in the test case. They do not close it.
6. Use the professional workspace to review/close the synthetic case. The worker is
   required for push attempts; an inbox message alone does not prove FCM delivery.
7. Restore `allowSafetyTest=false` when finished. Test posts/cases need to stay out of
   any future live rollout.

The authorization folder checks that missing tokens return 401 and an ordinary patient
cannot read the professional queue (403). The latter expects no verified professional
role on the synthetic patient account. The collection deliberately omits identity
reveal/contact actions.

The optional username folder uses `POST /api/community/username`. First apply
`20261028000011_community_username.sql` followed by
`20261028000012_community_username_lock.sql`, then set `chosenUsername` to a pseudonym.
`GET /api/community/username/status` returns `{canChooseUsername}` for the signed-in
member. The first successful choice locks the name. A different name with a new request
key returns 403 until an approved reveal rotates it; then one new choice is allowed.
Reusing the same request key retries the original write. A taken/retired name returns
409 when a new choice is permitted. Successful choices rename past posts/replies.

## If a request fails

| Result | Check |
| --- | --- |
| Connection refused | `baseUrl`, port and whether the public API is running. |
| 400 | JSON shape, valid UUIDs, current consent version, active tag IDs. |
| 401 | Login again and check `accessToken`; it must be the session access token. |
| 403 | Consent/membership, ownership, account eligibility or professional assignment. |
| 404 or empty post detail | Correct content ID and whether the post is published. |
| 503 | Identity/safety service connectivity, separate DB roles and clinic configuration. |
| Notice `enabled=false` | Required settings, verified on-call staff and launch gate. |
| Write works but feed is empty | Publication delay, worker execution, or a held revision. |

These collection files contain no credentials and have been checked against the
current Node routes and request validators. Importing them does not execute requests.
Live integration results depend on your running services and test credentials.
