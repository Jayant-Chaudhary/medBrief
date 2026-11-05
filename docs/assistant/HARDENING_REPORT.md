# Assistant hardening report

Scope authorized for this run: slices 1-6. Starting HEAD: `bf4d7b8`.

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

## Slice 3: safe writing, private rows and return to record

Commit: `f2ad042` (`2026-11-04 13:27:41 +0530`).

Plan: enforce append-only writing on textareas (`type` converted to `append`),
prevent duplicate writes of the same value into the same field across rounds via
SHA-256 digests (`server/src/services/assistant/writes.js`), enforce strict
`private: true` refusal on `data-assistant-private` elements across both browser
and server while allowing named `open_row` only from the request text, verify
starting record ownership before allowing `go("return")` (`recordContext.js`),
and prompt `"Which patient?"` when a patient-scoped action has no open record or
named patient.

Changed:
- Added `server/src/services/assistant/writes.js` and `server/src/services/assistant/recordContext.js`
- Added `client/src/components/assistant/recordContext.js`
- Updated `pageReader.js`, `pageActions.js`, `planRunner.js`, `AssistantDock.jsx`, `bridgeRegistry.js`, `assistantService.js`
- Updated `agent/actions.js`, `agent/navigator.js`, `assistant.service.js`, `execution.js`, `pageSnapshot.js`, `assistant.controller.js`, `assistant.validators.js`, `assistant.config.js`, `server/.env.example`
- Added `server/src/tests/agent/safety.test.js` and `client/src/tests/assistantSafety.test.js`, plus updated `actions.test.js`, `assistant.page.test.js`, and `pageActions.test.js`

Measured verification:

```powershell
cd server
npm test -- --runInBand --coverage=false src/tests/assistant.test.js src/tests/services src/tests/agent
# 20 suites, 484 tests passed
cd ../client
npm test -- --run src/tests
# 12 suites, 83 tests passed
npm run build
# passed (4.95s; same Vite chunk size warning)
```

Known gaps: declared form controls (`data-assistant-id`) and bridge buttons are
still hidden from the agent loop navigator (addressed in Slice 4); tab-scoped
session memory is Slice 5; full clinician-side coverage evaluation and live
browser verification are Slice 6.

## Slice 4: forms and buttons inside the agent loop

Commit: `77d67c3` (`2026-11-04 13:40:47 +0530`).

Plan: expose the current page's declared controls and pressable buttons from
`controls.registry.js` in the Navigator prompt (with control id, label, kind,
options, date format `YYYY-MM-DDTHH:mm`, and current date/time), while keeping
`[data-assistant-id]` fields hidden from `pageReader.js` so they are never listed
twice; add `fill(control, value)` and `press(button)` to `NAVIGATOR_SCHEMA` and
`validateAgentActions` checked by `checkValue` and `findButton`, emitting bridge
`fill`/`press` steps with patient context, Slice 2 execution evidence, Slice 3
duplicate write guard, and single-Confirm enforcement.

Changed:
- Updated `server/src/services/assistant/agent/navigator.js` (`describeDeclaredForm`, `fill`/`press` schema and prompt)
- Updated `server/src/services/assistant/agent/actions.js` (`fill(control, value)` and `press(button)` validation, BP pair split, single-Confirm cut)
- Updated `server/src/services/assistant/assistant.service.js` (`formStep` integration and `writes.guard` on agent `fill` steps)
- Updated `server/src/services/assistant/execution.js` (`pendingActions` field/hash tracking and `matchingItem` support for `fill`/`press`)
- Updated `client/src/components/assistant/AssistantDock.jsx` (hash tracking for confirmed bridge fills)
- Added `server/src/tests/agent/forms.test.js` (6 tests covering prompt declaration, multi-round booking, maternity BP split + Confirm, round 2+ relative date conversion, ungrounded value refusal, and past/future date rules)

Measured verification:

```powershell
cd server
npm test -- --runInBand --coverage=false src/tests/assistant.test.js src/tests/services src/tests/agent
# 21 suites, 490 tests passed
cd ../client
npm test -- --run src/tests
# 12 suites, 83 tests passed
npm run build
# passed (4.84s; same Vite chunk size warning)
```

Known gaps: tab-scoped session memory of previous requests is Slice 5; full
clinician-side coverage evaluation and live browser verification are Slice 6.

## Slice 5: memory of previous requests (this browser tab only)

Commit: `696cb14` (`2026-11-04 13:48:25 +0530`).

Plan: keep the last `ASSISTANT_MEMORY_ITEMS` (default 10) requests in React state
only inside `AssistantDock.jsx` (no `localStorage`, no server storage, no
database migration), expiring entries older than `ASSISTANT_MEMORY_MAX_AGE_MIN`
(default 120 minutes) and clearing on tab close, sign-out, or a **Forget** button
in the panel header; bound and validate the compact `memory` payload in
`assistant.validators.js`, never log it, verify/redact patient names against the
clinician directory in `server/src/services/assistant/memory.js`, include
`"Earlier in this session: …"` in Planner and Navigator prompts, and support
follow-ups (`"do the same for Asha"`, `"also add calcium"`, `"go back to the last
patient"`, `"repeat that"`, `"finish what failed"`, `"which patient was that?"`)
while enforcing that a newly named patient always beats memory, typed values must
come from the current request or explicitly referenced earlier words, and every
save still requires a Confirm card.

Changed:
- Added `server/src/services/assistant/memory.js` and `client/src/components/assistant/memoryState.js`
- Updated `server/src/config/assistant.config.js`, `server/.env.example`, `server/src/validators/assistant.validators.js`, `server/src/controllers/assistant.controller.js`
- Updated `server/src/services/assistant/assistant.service.js`, `server/src/services/assistant/agent/planner.js`, `server/src/services/assistant/agent/navigator.js`
- Updated `client/src/components/assistant/AssistantDock.jsx` and `client/src/services/assistantService.js`
- Added `server/src/tests/agent/memory.test.js`, `client/src/tests/assistantMemory.test.js`, and log-redaction test in `server/src/tests/assistant.test.js`

Measured verification:

```powershell
cd server
npm test -- --runInBand --coverage=false src/tests/assistant.test.js src/tests/services src/tests/agent
# 22 suites, 499 tests passed
cd ../client
npm test -- --run src/tests
# 13 suites, 86 tests passed
npm run build
# passed (4.89s; same Vite chunk size warning)
```

Known gaps: full clinician-side coverage inventory, simulator upgrades, coverage
eval on local Ollama `gemma4:e4b`, and live browser verification are Slice 6.
