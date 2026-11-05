# Review of Changes: Tasks T2, T3, and T4

Diff base: `8d8e156` (`pre-flash-backup`)
Current head: `044d1a4` (branch `assistant/flash`)

---

## 1. Overview of Tasks

- **Task T2 (`cfc2638`)**: Removed unsafe Slice 6 edits while preserving invariants.
  - Eliminated directory first-name matching fallback in `agent/actions.js` to prevent guessing ungrounded patients.
  - Removed message-keyword kind-guessing in `open_record` actions.
  - Removed bare words (`visit`, `record`, `card`) from checklist tick matching in `execution.js`.
  - Re-enforced strict `open_row` grounding matching.
  - Restored `finish()` patient-specific check in `assistant.service.js`.
  - Verified with new safety test suite `server/src/tests/agent/flashSafety.test.js`.

- **Task T3 (`1bd9314`)**: Made "New Visit" reachable by natural phrasing and registered identifier.
  - Kept page id `new_appointment`, updated label to `"New visit"`.
  - Added Hindi/Hinglish and colloquial aliases (`new visit`, `new visits`, `naya visit`, `nayi visit`, `नई विज़िट`, `new visit tab`, `book visit`, `schedule visit`, etc.) while keeping all legacy appointment aliases.
  - Updated `findPage` in `pages.registry.js` to normalize spaces/underscores/dashes and match by id, label, or alias.
  - Added checklist tick mapping for `new visit` and `naya visit` in `execution.js`.
  - Added navigator prompt examples in `buildMessages` and `agent/navigator.js`.
  - Verified with new test suite `server/src/tests/agent/newVisit.test.js`.

- **Task T4 (`044d1a4`)**: Enabled Record Consultation modal opening while enforcing strict manual recording guards.
  - In `pageSnapshot.js`: replaced bare `record|recording` in `NEVER` with explicit action phrases (`start recording`, `stop recording`, `pause recording`, `resume recording`, `record audio`, `mic check`, `mic test`, `stt test`, `start consultation`, `stop consultation`, `end consultation`, `confirm ready`), allowing harmless elements ("Maternity record", "Record Consultation" button) to be `free` or `confirm` rather than blocked.
  - Added `maternity record` and `antenatal record` to `FREE` in `pageSnapshot.js`.
  - In `controls.registry.js`: updated `open_audio_consult` under `dashboard` to `effect: 'send'`, updated `sideEffect` text to `"This will open the consultation recording window. Recording stays manual."`, and added aliases (`record consultation`, `open recording`, `audio consult`).
  - In `ClinicianDashboard.jsx`: tagged "Record Consultation" button with `data-assistant-id="dashboard.open_audio_consult"`, `data-assistant-effect="send"`, and `data-assistant-side-effect="This will open the consultation recording window. Recording stays manual."`; tagged "Transcript Logs" button with `data-assistant-effect="free"`.
  - In `DoctorConsultationModal.jsx`: marked navigation tabs, close/cancel buttons, copy code, and refresh transcript with `data-assistant-effect="free"`; marked mic check, STT test, consent checkbox, confirm ready, start recording, stop consultation, and transcript download with `data-assistant-effect="never"`; marked transcript segments feed with `data-assistant-private`.
  - In `pageReader.js`: propagated `data-assistant-side-effect` into snapshot elements.
  - Verified with server test suite `server/src/tests/agent/recordConsult.test.js` and client test suite `client/src/tests/recordConsult.test.js`.

---

## 2. Line-by-Line Changes & Rationale

### `server/src/services/assistant/agent/actions.js`
- **Lines 82-84**: Extended `resolveDeclaredButton` to inspect `btn.aliases`. Enables actions and phrases like `press("open recording")` or `press("record consultation")` to resolve cleanly to declared button `open_audio_consult`.
- **Lines 148-150 (T2)**: Removed directory first-name matching block. Prevents the assistant from picking an arbitrary patient matching a common word or partial name.
- **Lines 154-159 (T2, T3)**: Removed message-keyword kind-guessing; added explicit mapping `['appointment', 'book', 'new_visit'].includes(kind) -> kind = 'new_appointment'`.

### `server/src/services/assistant/execution.js`
- **Lines 18-24 (T2, T3)**: Cleaned up `labels` dictionary. Removed bare words `'visit'`, `'record'`, and `'card'` that caused false checklist ticks (e.g., last visit ticking next visit). Added `'new visit'` and `'naya visit'` to `labels.new_appointment`.
- **Lines 26-30 (T2)**: Enforced strict grounding on `open_row` checklist matching (`hasPat` required).

### `server/src/services/assistant/pages.registry.js`
- **Lines 22-33 (T3)**: Kept page id `new_appointment`, set label to `"New visit"`. Added aliases `new visit`, `new visits`, `add visit`, `create visit`, `create a visit`, `schedule visit`, `schedule a visit`, `book visit`, `book a visit`, `naya visit`, `nayi visit`, `नई विज़िट`, `new visit tab`.
- **Lines 45-60 (T3)**: Generalized `findPage(role, id)` to normalize identifiers (underscores, spaces, dashes) and match against `page.id`, `page.label`, or any entry in `page.aliases`.

### `server/src/services/assistant/controls.registry.js`
- **Line 220 (T4)**: Configured `open_audio_consult` under `dashboard`:
  - `effect: 'send'` (triggers explicit confirmation card).
  - `sideEffect`: `"This will open the consultation recording window. Recording stays manual."`
  - `aliases`: `['record consultation', 'open recording', 'open audio consult', 'audio consult', 'recording']`.

### `server/src/services/assistant/pageSnapshot.js`
- **Line 20 (T4)**: Refined `NEVER` regex. Replaced bare `record|recording` with explicit manual recording actions: `start recording|stop recording|pause recording|resume recording|record audio|mic check|mic test|stt test|start consultation|stop consultation|end consultation|confirm ready`.
- **Line 22 (T4)**: Added `maternity record` and `antenatal record` to `FREE` regex.
- **Line 224 (T4)**: In `checkPageActions`, propagated `element.sideEffect` onto action objects for Confirm cards.
- **Lines 369-376 (T4)**: Added phrase rule in `matchPageCommand` recognizing `AUDIO_CONSULT` phrases (`record consultation`, `open recording`) on dashboard.

### `server/src/services/assistant/assistant.service.js`
- **Lines 237-238 (T3)**: Added navigator prompt examples for `"open new visit"` and `"new visit for Test Person tomorrow at 5 pm"`.
- **Lines 500-506 (T4)**: Added `ruled.openAudioConsult` handler in `pageRules` to return declared button press for dashboard audio consultation.
- **Lines 840-848 (T2)**: Restored `patientSpecific` check to only evaluate `pageActions.some(...)`.

### `client/src/pages/clinician/ClinicianDashboard.jsx`
- **Lines 675-677 (T4)**: Added `data-assistant-id="dashboard.open_audio_consult"`, `data-assistant-effect="send"`, and `data-assistant-side-effect="This will open the consultation recording window. Recording stays manual."` on "Record Consultation" button.
- **Line 691 (T4)**: Added `data-assistant-effect="free"` on "Transcript Logs" button.

### `client/src/components/consultAudio/DoctorConsultationModal.jsx`
- **Lines 542, 554, 620, 647, 949, 990 (T4)**: Added `data-assistant-effect="free"` on Record tab, Transcript Logs tab, Copy room code, Cancel button, Return to Patient Record button, and Refresh transcript button.
- **Lines 657, 772, 822, 845, 855, 903, 1007 (T4)**: Added `data-assistant-effect="never"` on Proceed to Mic Check, Run STT test, Informed Consent checkbox, Confirm Readiness, Start Consultation, End Consultation, and Download transcript.
- **Line 1048 (T4)**: Added `data-assistant-private` to transcript segments feed.

### `client/src/components/ui/Modal.jsx`
- **Line 29 (T4)**: Added `data-assistant-effect="free"` to close button.

### `client/src/components/assistant/pageReader.js`
- **Lines 163, 189 (T4)**: Added extraction and attachment of `data-assistant-side-effect` to element snapshots.

---

## 3. Test Suites Added

1. **`server/src/tests/agent/flashSafety.test.js` (5 tests)**
   - Unnamed `open_record` returns "Which patient?", never picks from directory.
   - Ambiguous matches return choose card.
   - Missing record kind refused or asked.
   - Checklist items strictly matched to action kinds.
   - Patient rows only tick matching opening items.

2. **`server/src/tests/agent/newVisit.test.js` (15 tests)**
   - English, Hindi, and Hinglish phrases open `new_appointment`.
   - Date and patient prefilled for scheduled visits.
   - Agent `go("new_visit")` and aliases resolve to `new_appointment`.
   - Checklists tick only on matching action kinds.

3. **`server/src/tests/agent/recordConsult.test.js` (19 tests)**
   - `classify()` returns `never` for all sensitive/recording operations.
   - `classify()` returns `free` for Maternity record tabs/links.
   - "record consultation" and "open recording" map to `open_audio_consult` with Confirm card.
   - `validateAgentActions` handles declared button press with side-effect explanation.

4. **`client/src/tests/recordConsult.test.js` (3 tests)**
   - Modal controls marked `never` read as `effect: 'never'`.
   - Harmless modal controls read as `effect: 'free'`.
   - Transcript container is `data-assistant-private` (no PII in snapshots).
