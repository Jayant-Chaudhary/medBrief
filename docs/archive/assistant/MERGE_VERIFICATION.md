# Assistant merge verification

Source: `test/merge-master-web-automation`, initially `b2dd10c`.
Target: local `master`, initially `0b211ba` (already an ancestor of the source).
Protection branch: `backup/pre-assistant-master-merge-20261105` at `b2dd10c`.
Author and committer for the new fix and merge commits: Pramit.

## Included fixes

- Execute one navigator action, accept its signed result without a model call,
  render the verified checklist, then request the next action.
- Keep the current checklist visible across navigation and continuation cards;
  stop pending work and confirmation when the request is cancelled or expires.
- Bind field evidence and successful-write hashes to the correct task and record.
  Preserve existing notes and prevent duplicate writes within a request.
- Recover named patient navigation without using another patient's open record.
- Keep appointment date requirements off the Schedule page. Verified progress
  resets loop detection; repeated visits without progress still stop.
- Resolve clear relative appointment times through `checkValue`, in the doctor's
  time zone, and verify the draft fill separately from opening the form.
- Read actual maternity bridge values to verify fills.
- Keep the existing API response shape unless the panel requests execution
  metadata. Internal execution bindings remain in signed continuation state.

## Compatibility checks

The first focused server run found 11 failures. Fixes preserved existing
assertions: execution metadata became opt-in; public checklist items retain
their display shape; synthetic recording-window fixtures now supply an open
patient record; memory replay acknowledges navigation before writing; model
fallback tests isolate deterministic routing; maternity fixtures acknowledge
separate fill and press rounds; empty-memory parameterization no longer
accidentally invokes Jest's callback convention.

New tests cover request cancellation, visible progress ordering, hard page-wait
deadlines, task binding, form evidence, patient scope, memory identity/resumption,
navigation requirements, metadata opt-in, and relative appointment dates.

## Measured validation

```text
cd server
npm.cmd test -- --runInBand --coverage=false
Test Suites: 1 skipped, 74 passed, 74 of 75 total
Tests:       5 skipped, 1134 passed, 1139 total
Snapshots:   0 total
Time:        53.385 s

cd ../client
npm.cmd test -- --run src/tests
Test Files  24 passed (24)
Tests       126 passed (126)
Duration    3.42s

npm.cmd run build
2421 modules transformed
built in 9.44s
```

`git diff --check` passed. The build emitted a non-blocking bundle-size warning.
Browser, device, live-provider and end-to-end acceptance were not run; passing
unit tests and a production build do not guarantee every live workflow.

No dependencies, migrations or tables were added. No secrets or real patient
fixtures were added. `.claude/settings.local.json` remains untracked and is
excluded from the commit. The merge is local; no push, rebase or force operation
is part of this work. Existing branch histories and tags are retained.
