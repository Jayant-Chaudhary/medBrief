# Codex assistant fix report

Completed on `assistant/flash`, starting at `3632c63`. Protection tag:
`pre-codex-fix` at that starting commit. The user approved leaving the untracked
`.claude/settings.local.json` untouched and authorized the specific assertion
updates described below. No browser or end-to-end acceptance is claimed.

## F1 — named search completion and recovery

Commit: `b35a4a2` — `fix(assistant): F1 continue named searches and recover refused rounds`

Files: `server/src/services/assistant/{execution.js,assistant.service.js}`, its
`agent/{actions.js,navigator.js}`, `server/src/config/assistant.config.js`,
`server/.env.example`, and `server/src/tests/agent/{findThenOpen.test.js,safety.test.js}`.

- Search writes tick a find/search/look up/dhundo item only when its name words
  match the written value. BP and Hb remain target words.
- Navigation carrying `state.assistantQuery` can tick the matching named find
  item; plain Patients navigation cannot.
- Exact successful actions are remembered as request-bound digests and omitted
  when proposed again. Their matching item can be ticked without executing the
  action again. Value grounding and duplicate-write blocking remain in place.
- Consecutive refused-only rounds retain feedback for the navigator. The
  configurable `ASSISTANT_MAX_REFUSED_ROUNDS=2` stops at the configured count;
  attempted items retain refusal reasons, and unattempted items say `not reached`.
- A current-page declared control id used as a ref routes through the checked
  fill path. Unknown refs remain refused. The navigator now explicitly forbids
  using declared control ids as element refs.

Five added tests cover the synthetic Sarthak three-item flow, a successful search
repeat, named navigation versus plain navigation, exact declared-control routing,
BP targeting, and one versus two refused rounds. Focused F1 verification:

```text
cd server
npm.cmd test -- --runInBand --coverage=false src/tests/agent/findThenOpen.test.js src/tests/agent/safety.test.js
Test Suites: 2 passed, 2 total
Tests:       20 passed, 20 total
```

The authorized duplicate-notes expectation now requires continuation and no
duplicate page action/fill. Its original assertions that the written item is
ticked and the later item remains pending are retained. The direct duplicate
write guard assertions are unchanged.

## F2 — confirm opening consultation windows

Commit: `1c38d55` — `fix(assistant): F2 confirm consultation window session creation`

Files: `client/src/pages/clinician/ClinicianDashboard.jsx`,
`server/src/services/assistant/{controls.registry.js,pageSnapshot.js}`, and
`server/src/tests/agent/{consultWindowConfirm.test.js,recordConsult.test.js}`.

Both Record Consultation and Transcript Logs now declare saving effects with
the requested session-creation wording. Transcript Logs has a declared bridge
button. Existing UI click handlers were preserved. Opening either window asks
for Confirm; recording, consent, mic/STT tests, readiness, and download remain
manual. The three existing side-effect wording expectations were updated with
explicit user approval. Added 11 small cases cover the two saving buttons and
the nine manual-only controls; all 11 passed in the focused run.

## F3 — baseline failures and dependency isolation

Commit: `efb9b78` — `fix(assistant): F3 isolate recording tests and preserve opening controls`

Files: `server/src/tests/agent/recordConsult.test.js` and
`server/src/services/assistant/pageSnapshot.js`.

The baseline required server command measured 537 passing and 2 failing tests
across 25 suites (16.594 s). The previously reported seven failures were not
reproduced. Both measured failures were 5000 ms timeouts in the parameterized
dashboard mapping test: `record consultation` and `open recording`.

These calls omitted both injected dependencies, causing the real patient
directory lookup during page preparation and leaving the real provider as a
fallback. They now use an empty synthetic directory and FakeProvider configured
to fail if contacted. No timeout was increased; all original safety/Confirm
assertions remain.

The first final regression run also found that the broad F2 saving-effect check
changed the existing Templates/Review opening behavior. The code now recognizes
declared saving button metadata while preserving generic opening controls inside
saving regions. That existing test's assertions were not edited.

## Final required verification

Commands use `npm.cmd`, the Windows npm launcher. Results are from the actual
commands below. Browser and end-to-end checks are left to the developer.

```text
cd server
npm.cmd test -- --runInBand --coverage=false src/tests/assistant.test.js src/tests/services src/tests/agent
Test Suites: 27 passed, 27 total
Tests:       555 passed, 555 total
Snapshots:   0 total
Time:        4.72 s

cd ../client
npm.cmd test -- --run src/tests
Test Files  14 passed (14)
     Tests  89 passed (89)
  Duration  1.61s

npm.cmd run build
vite v5.4.21 building for production...
2410 modules transformed.
built in 9.63s
```

The build passed with Vite's warning about chunks larger than 500 kB.
`git diff --check` passed. No lint/type-check success is claimed.

## Remaining and scope

F1-F3 are implemented and unit-tested. The real browser flow, real model behavior,
and end-to-end confirmation/session creation still require the developer's
acceptance checks. No live-model accuracy numbers are reported. Successful-repeat
evidence lasts only for the signed request continuation; it does not authorize
replaying saves across separate requests.

No migrations or tables were added. Nothing was pushed, merged, or rebased.
`assistant/agent-loop` was untouched; all commits were on `assistant/flash`.
Tests added here use synthetic data. No secrets were added or printed, and no
sensitive logging was introduced. `.claude/settings.local.json` was neither read
nor modified nor committed.
