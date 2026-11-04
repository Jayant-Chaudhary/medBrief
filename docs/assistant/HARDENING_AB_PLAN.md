# Assistant hardening: slice A + B

Status: slice 1 approved by the user's execution prompt and implemented. The
execution prompt supersedes the draft approval checkpoints below. Work is
authorized through slice 3 only; slices 4-6 await the user's later review.

Starting point: `assistant/agent-loop`, commit `bf4d7b8`.

## Goal and scope

Restore reliable single-request form planning and establish one explicit router
for clinician requests. This is the first slice of the supplied hardening plan.
The remaining slices stay in order: F, D + E, C, H, G. Each requires its own
implementation plan, approval, implementation, and walkthrough.

This slice does not establish whole-site coverage or fix the remaining agent
safety gaps. No deployment, live patient mutations, migrations, or provider
changes are included.

## Findings checked against the current branch

- `buildMessages()` still contains the new-patient name/email/date example.
  Preserve it and test it; do not add duplicate examples.
- Its maternity example uses `visit.weightKg`, while the registry defines
  `visit.weight`. Correct that example and add the missing scenarios.
- `assistant.config.js` already defines `agentLoop` from
  `ASSISTANT_AGENT_LOOP`. The browser also sends `agentLoop: true`, and the
  controller overrides server configuration with that value.
- `handleStep()` also infers agent mode from checklist, results, and note.
  This diverts single form requests away from the existing form planner.
- `partsDone`, `nextPart()`, and `withPatient()` still implement a separate
  multi-step interpreter across the API and dock.
- Existing `hasMultipleInstructions()` treats multiple mentioned page names
  and comma-separated fragments as multiple instructions. A booking request
  with a name, email, date, and save instruction needs more careful handling.
- The server and client package scripts expose tests; the client also exposes
  a production build. Neither package declares a lint or type-check script.

## A. Restore and validate prompt examples

1. Use the actual field/button definitions in `controls.registry.js`.
2. Correct `visit.weightKg` to `visit.weight`.
3. Restore examples for:
   - An open New appointment form: `kal 11 baje` to `scheduledAt`, calculated
     from the injected clock and browser time zone.
   - New patient name, email, and scheduled date/time; retain the existing
     example and its explicit invite confirmation behavior.
   - A maternity visit with date, BP, weight, and `save_visit` (Add visit).
   - Baseline Hb and blood group, and G/P/L/A using `patient.*` field ids.
4. Keep examples restricted to forms offered in that request, with synthetic
   names and values. Prompt examples are data-entry illustrations, not clinical
   thresholds or recommendations.
5. Test generated assistant-example JSON against the registry: each form,
   control, and non-`none` button must exist and be available to the role and
   offered form. Check the corresponding schema choices as well.
6. Test that example values survive the existing interpretation and value
   validation where applicable, including time-zone boundaries, past-date
   rejection, BP ordering, and explicit clinical field naming.

## B. Establish the router

The server configuration is authoritative. Keep `ASSISTANT_ENABLED` as the
master feature switch. Document `ASSISTANT_AGENT_LOOP=true` in `.env.example`
and preserve the current opt-in configuration default. Remove the browser's
forced override and the public request-body override. Tests must demonstrate
that request state cannot enable an agent loop disabled by server config.

Routing when the loop is enabled:

1. A continuing agent request stays in the agent loop; do not replay initial
   rules or the legacy form planner. Continuation state carries progress,
   rather than serving as a substitute feature flag.
2. A new single instruction tries page navigation, page action phrase rules,
   and explicit patient search rules.
3. A new single form/record instruction uses the existing planner and existing
   interpretation/value/patient checks.
4. A compound request enters the agent loop at round zero, before page rules
   or the legacy planner can consume just one part.
5. A single request that the legacy planner cannot handle can enter the agent
   loop at round zero. Do not bypass an explicit safety refusal, failed value
   validation, ambiguous patient selection, or provider unavailability by
   treating those outcomes as a generic capability miss.
6. If a single rule-driven action needs subsequent page reads, transfer its
   remaining work to the same agent loop without replaying completed actions.
7. With the loop disabled, retain supported single-request behavior and return
   an explicit unsupported outcome for work requiring the retired multi-step
   interpreter. Patients retain their existing navigation-only behavior.

Instruction classification must distinguish multiple goals from fields in a
single form task. Cover `and`, `then`, Hinglish connectors, punctuation, date
and time conjunctions, multiple form values, and final save/invite wording.
Do not classify a request as compound solely because it contains commas or
mentions a field/page name incidentally. Preserve genuine either/or page
ambiguity as clarification.

Once that router and its continuation tests pass, remove the obsolete
`partsDone`/`part`/`partDone` transport and `nextPart()`/`withPatient()` path.
Remove split helpers only if repository-wide search proves they have no
remaining caller; do not delete shared helpers just because their old router
caller is gone. Replace legacy split-path tests with behavior tests of the
new router.

## Expected files

- `server/src/services/assistant/assistant.service.js`: examples, routing,
  removal of the obsolete multi-step interpreter.
- `server/src/config/assistant.config.js`: clarify the switch's role if needed;
  no unrelated config changes.
- `server/src/controllers/assistant.controller.js` and
  `server/src/validators/assistant.validators.js`: remove client config override
  and retired transport fields.
- `client/src/services/assistantService.js` and
  `client/src/components/assistant/AssistantDock.jsx`: align request and
  continuation payloads; remove legacy split tracking.
- Assistant/agent/API tests and focused client tests where the payload changes.
- `server/.env.example`, `docs/assistant/README.md`, and
  `docs/assistant/SETUP.md`: describe actual routing/config behavior for this
  slice. Full coverage documentation remains in G.
- `pageSnapshot.js` only for helpers made unused by router retirement.

No changes to OCR, authentication logic, clinician dashboard, form bridges,
provider implementation, or database schema are planned.

## Acceptance and verification

- Registry validation catches a deliberately invalid example control/button.
- Open booking form dates and new-patient details use the legacy form planner
  even with the loop enabled; date-only ambiguity does not invent a time.
- Maternity examples use existing ids, and Add visit retains confirmation.
- Single known page/checkbox/notes/search rules work without a model call when
  no additional page read is needed.
- Compound requests reach the checklist/navigator from round zero.
- Capability fallback occurs once, and no unsafe/invalid result becomes a
  fallback that executes the rejected operation.
- Later rounds use the active agent path without repeating initial rules.
- Server config cannot be overridden through `agentLoop`, checklist, or results.
- Patient role remains restricted; existing confirmation gates and value
  grounding remain exercised by regression tests.
- Retired payloads and helper paths have no remaining production callers.

Run the focused server assistant service, page, API, and agent suites with
`--runInBand --coverage=false`. Run client assistant routes, bridge, runner,
reader, and action tests, plus focused transport tests if added. Run the client
production build after client edits. Report lint/type checks as unavailable
unless existing repository tooling is discovered; do not invent passing checks.

Use injected clocks, fake providers, and synthetic directories for deterministic
regressions. Live Gemma validation is a separate measured check against a local
synthetic simulator or synthetic browser data. Do not send real data or execute
real saves/invites to establish this slice's acceptance. Record exact commands,
counts, failures, model/config where used, and limitations in the walkthrough.

### Baseline run before implementation

- Server: `npm.cmd test -- --runInBand --coverage=false
  src/tests/assistant.test.js src/tests/services/assistant.service.test.js
  src/tests/services/assistant.page.test.js src/tests/agent`.
  Result: 264 passed, 5 failed, 269 total; 7 suites passed, 1 failed.
  All five failures are 5-second timeouts in `agent/phase1Bugs.test.js`.
  Those tests omit the directory dependency and therefore reach the default
  Supabase lookup. Jest also reported unfinished asynchronous operations.
  Add an injected synthetic directory or mock in this test suite during A + B;
  do not increase timeouts to hide the dependency.
- Client: `npm.cmd test -- src/tests/assistantRoutes.test.js
  src/tests/bridgeRegistry.test.js src/tests/planRunner.test.js
  src/tests/pageReader.test.js src/tests/pageActions.test.js`.
  Result: 46 passed, 0 failed, across 5 suites.
- These are focused baseline results, not whole-website or live-model evidence.

## Boundaries for later slice plans

- F must verify actual state change/arrival before emitting `ok`; catching DOM
  exceptions alone does not establish success. Client `startedAt` and execution
  claims are untrusted, and the deadline must also constrain active model calls.
- D + E need stable field/record identity for write deduplication; DOM refs can
  change each snapshot. Hashes do not make low-entropy clinical data anonymous.
  Return navigation must be role/ownership checked and keep private-row metadata
  through validation and redaction.
- C adds declared form actions to the agent; A + B alone cannot make multi-step
  date/maternity filling work. Relative-date values reuse existing validation.
- H uses bounded, expiring React-state memory, resolves every patient against
  the current directory, and reuses previous values only when explicitly
  requested. No automatic replay of saves.
- G must distinguish read-only permitted tasks, confirmed saves, and forbidden
  controls in its inventory. Grade observed state and confirmation events;
  forbidden operations do not become executable just to obtain coverage.

## Approval checkpoint

Approve this A + B slice before source-code edits. After implementation, deliver
the test evidence and known gaps, then stop for the next slice's planning step.
