# Assistant hardening report

Scope authorized for this run: slices 1-3, then stop for review. Starting HEAD:
`bf4d7b8`. Slices 4-6 (agent form actions, tab memory, whole-site coverage) are
outside this batch. No live-model scores are claimed.

## Slice 1: examples and routing

Commit: `7ea3955`.

Restored booking-date and baseline examples, fixed maternity weight and Add
visit ids, and retained the new-patient example. Added registry and date tests.
The server owns the feature switch. Agent continuations use an explicit mode
and an authenticated, request/user-bound token, with no request storage.
Removed the old split/partsDone interpreter and client configuration override.
Isolated the old agent regression tests from the Supabase directory dependency.

Changed: assistant service/pageSnapshot, continuation helper, controller,
validator, client dock/transport, env example, assistant tests and this plan/report.

Measured verification:

```powershell
cd server
npm.cmd test -- --runInBand --coverage=false src/tests/assistant.test.js src/tests/services/assistant.service.test.js src/tests/services/assistant.page.test.js src/tests/agent
# 9 suites, 271 tests passed
cd ../client
npm.cmd test -- src/tests/assistantRoutes.test.js src/tests/bridgeRegistry.test.js src/tests/planRunner.test.js src/tests/pageReader.test.js src/tests/pageActions.test.js
# 5 suites, 46 tests passed
npm.cmd run build
# passed; Vite reported chunks larger than 500 kB
```

Known gaps: completion evidence and stop rules are slice 2; private rows and
writing safety are slice 3; multi-step declared form filling is slice 4.
Neither package declares lint/type-check scripts. No live Gemma/browser
acceptance or full-site coverage has been measured.

## Slice 2: execution evidence and bounded requests

Plan: replace round-wide success with per-action observations; accept only issued
actions; match ticks to targets; stop repeated actions/pages and expired requests.

Implemented an execution helper, signed pending actions/checklist/history, real
DOM and bridge results, verified navigation arrival, and cancellation results.
The model cannot mark a pending item complete. A false done gets one bounded
navigator retry, then a reason for each pending item. Start time is pinned in
the signed continuation. Calls and directory reads are bounded by the remaining
request budget. Removed refusal-content and raw error-stack logging.

Tests cover forged completion/results, wrong targets, cancellation, unchanged
clicks, asynchronous changes, partially successful rounds, bridge field results,
repeated actions/pages, deadline reset attempts, and a provider ignoring timeout.

Known limit: browser observations establish UI changes, not a database commit
receipt for DOM-triggered autosaves. Bridge presses can report their own explicit
success; unobservable changes are reported as no_change. Completion matching is
conservative and may leave a valid but ambiguously worded task pending. No live
browser/model acceptance has been measured yet.

Measured: the server command above passed 279/279 tests in 10 suites. The client
command above with `src/tests/actionEvidence.test.js` appended passed 51/51 in
6 suites. `npm.cmd run build` passed (same large-chunk warning).
