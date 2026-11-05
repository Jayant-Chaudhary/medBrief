# Assistant Phase 2 plan — multi-step requests, field filling and button actions

Status: **proposal, not approved**. Nothing here is built yet. Phase 1 (open one page) is in `README.md`.

## Goal

Let a doctor or patient type one request that takes several steps, and watch the assistant do them in the real UI:

- "Book Test Patient for tomorrow at 10" → open New appointment → select the patient → fill date/time → **confirm** → submit
- "Open Priya's maternity card" → find Priya among *this doctor's* patients → open her card
- "Open the next visit for Test Patient" → find the patient → open that visit on the dashboard
- Patient: "Share my latest report with my next appointment" → open Reports → pick report and appointment → **confirm** → share

## Principles (unchanged from Phase 1, plus three new ones)

1. The model proposes; the server validates; the user decides. The model never supplies a URL, an id or an API call.
2. **Actions, not raw clicks.** "Clicking a button" means calling the page's own registered handler (the same code the button runs), with the button highlighted. No synthetic DOM clicks, so a layout change cannot make the agent click the wrong thing.
3. **Every step that saves data or contacts someone stops for confirmation.** The card shows exactly what will happen, including side effects ("An invite email will be sent to t…@example.com"). Nothing irreversible runs without a click from the user.
4. **Records are found by the server, not the model.** The model extracts "Priya"; the server searches only the signed-in doctor's patients (existing `/api/patients` logic). Several matches → the user picks. No match → stop. Never a guess.
5. **Every executed or cancelled action is audited** (ids and outcomes only, never message text).

## What is in scope

| Role | Action | Saves data? | Confirmation |
|---|---|---|---|
| Both | `open_page` (Phase 1) | No | No |
| Doctor | `find_patient` (fills the Patients search box) | No | No |
| Doctor | `open_patient_visit` (next or last visit → `/clinician?appointment=<id>`) | No | No |
| Doctor | `open_maternity_card` (→ `/clinician/maternity?patientId=<id>`) | No | No |
| Doctor | `prepare_appointment` (open New appointment with `?patient=<id>`, fill date/time; new patients: name + email) | No | No |
| Doctor | `submit_appointment` (runs the form's own submit) | **Yes — creates the visit and sends an invite email** | **Always** |
| Patient | `share_report` (choose report + appointment on Reports) | **Yes — the doctor can then see it** | **Always** |
| Patient | `open_visit_summary` / `open_checkin` | No | No |

Out of scope, by decision: prescribing, ending a visit, consultation notes, deleting anything, entering clinical values (maternity card, check-in answers, vitals), sending messages, community, account/password changes. Those requests open the page and say "please do this yourself".

## How it works

```
Panel: "book Test Patient tomorrow at 10"
  │ POST /api/assistant/plan { message, currentPath }
  ▼
Server
  1. Phase 1 rules for single-page requests (no model)
  2. Model → JSON plan (≤ 4 steps), constrained to this role's action catalog;
     slots are text only: patient_name, when ("tomorrow at 10" + ISO guess), report, appointment
  3. Validate: known actions, allowed for role, ≤ 4 steps, at most one saving step, saving step last
  4. Resolve: patient name → matching patients of THIS doctor (fuzzy, reusing the name
     matcher from reportNameCheck.service); date → must be a valid future time; report/appointment → owned by this patient
  5. Audit "proposed"; return steps with resolved ids and display text
  ▼
Panel executor (one step at a time, visible, Stop at any time)
  - navigate to the step's route
  - wait (≤ 8 s) for the page to register its assistant actions
  - run the handler: fill fields / select patient, each highlighted briefly
  - saving step: show confirmation card → user clicks Confirm
      → POST /api/assistant/confirm (audit) → page's own submit handler → existing API
  - report each step ✓ / ✗ in the panel; on any failure, stop and leave the form as is
```

Pages expose actions through a small bridge:

```js
// inside NewAppointment.jsx
useAssistantActions('new_appointment', {
  selectPatient: (id) => setChosenPatient(patients.find((p) => p.id === id)),
  fillDateTime: (iso) => setForm((f) => ({ ...f, scheduledAt: toLocalInput(iso) })),
  submit: () => submitAppointment(),          // the same function the button calls
}, { ready: patientsLoaded });
```

Only three pages need the bridge in Phase 2: `NewAppointment.jsx`, `ClinicianPatients.jsx`, `ReportsPage.jsx`. The others are reached by URL.

## Files

Server
- `services/assistant/actions.catalog.js` — actions per role: id, description, slots, `saves` flag, route builder
- `services/assistant/planner.service.js` — prompt, plan schema, validation
- `services/assistant/resolvers/` — `patients.js` (doctor's patients, fuzzy name match), `datetime.js` (ISO, future, sanity limits), `reports.js` (patient's own reports and appointments)
- `controllers/assistant.controller.js` — new `plan` and `confirm` handlers; `routes/assistant.routes.js` — new routes
- `supabase/migrations/<date>_assistant_actions.sql` — audit table with RLS; matching file in `supabase/rollbacks/`
- Config: `ASSISTANT_MAX_STEPS=4`, `ASSISTANT_PAGE_READY_TIMEOUT_MS=8000`, `ASSISTANT_ACTIONS_ENABLED=false` (separate switch from Phase 1)

Website
- `components/assistant/AssistantBridge.jsx` — context + `useAssistantActions` hook
- `components/assistant/planExecutor.js` — pure state machine (testable without a browser)
- `components/assistant/ConfirmCard.jsx` — confirmation UI
- `AssistantDock.jsx` — show plan steps, progress, Stop, confirmation
- Bridge hooks added to `NewAppointment.jsx`, `ClinicianPatients.jsx`, `ReportsPage.jsx`; the appointment submit is split out of the form handler so the button and the assistant call the same function

Database (`assistant_actions`)
- `id, user_id, role, action, patient_id, appointment_id, report_id, outcome (proposed|confirmed|cancelled|failed), created_at`
- RLS: users read their own rows; writes only through the server. No message text, names or values.

## Privacy and safety

- Patient names in typed requests reach the model. With local Ollama they stay on the machine; **a hosted model must not be used for Phase 2 without a data contract and redaction**.
- The model never sees patient records, emails or lists — only the user's text and the action catalog. Matching happens on the server.
- Wrong-patient protection: confirmation cards show full name, masked email and next-visit date; ambiguous names always ask.
- Date safety: the card shows the resolved date in words ("Tue 3 Nov 2026, 10:00"); past dates are rejected.
- Invite emails are irreversible, so `submit_appointment` is always confirmed, and confirmation is required again if any field changes after the card is shown.
- Stop cancels immediately; unsaved form changes stay visible for the user to finish or discard.

## Delivery in three slices (each approved and tested separately)

1. **2a — find and open records (read-only):** `find_patient`, `open_patient_visit`, `open_maternity_card`, `open_visit_summary`. No saving, no migration. Lowest risk, most daily value.
2. **2b — fill forms without saving:** bridge + `prepare_appointment`; the user still clicks the real button themselves.
3. **2c — confirmed actions:** `submit_appointment`, `share_report`, confirmation card, audit table and migration.

## Verification

- Server tests (fake model): plan validation (unknown action, wrong role, too many steps, saving step not last), patient resolution (only own patients, ambiguity, no match), date validation, audit rows contain no text.
- Client tests: executor state machine (stop, timeout waiting for a page, failure mid-plan, confirm/cancel, field changed after confirmation).
- Browser harness with stubbed APIs: full "book … tomorrow at 10" flow; Cancel → no API call; Confirm → exactly one create call.
- Eval script extended with ~40 synthetic multi-step requests in English, Hinglish and Hindi, including dates ("kal subah 10 baje"), ambiguous names and requests that must be refused.
- Pass targets: ≥ 90% correct plans; **0 wrong-patient actions; 0 saving actions without confirmation** (enforced in code, not just measured).

## Known limits after Phase 2

- One patient and at most one saving action per request.
- Only the actions in the table; "click anything on any page" is deliberately not supported.
- Date phrases in Hindi/Hinglish are the least tested part; the confirmation card is the safety net.
- Laptop GPU: plans take about 1 s; the executor itself is instant.
