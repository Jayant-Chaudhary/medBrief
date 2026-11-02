# In-app assistant — Phases 1, 2 and 3 (opens pages and records, fills forms, presses buttons after you confirm)

Patients and verified doctors type what they want ("open my reports", "mere reports dikhao", "show today's schedule") and the website opens that page. Doctors can also open a patient's records and chain up to 4 steps ("go to the schedule and then open Asha's maternity card", "asha ki pichli visit kholo"), fill the New appointment form ("book new patient Riya Test riya@example.test tomorrow at 4 pm", "add question "any swelling?" as a written answer") and, after clicking **Confirm** on a card, have it press **Create visit and invite**. It never answers health questions, and never deletes or discards anything. Patients keep the page-opening assistant only.

### Phase 3a: declared form controls, dropdowns and buttons (doctors, New appointment)

- **Declared, not free clicking.** Each form lists what the assistant may use, on the server (`services/assistant/controls.registry.js`: controls with kind, options, aliases; buttons with effect `ui`, `save` or `send`) and on the page (`useAssistantControls` in `AssistantBridge.jsx`: a getter and setter per control, the page's own handler per button). Anything not listed (Delete, Remove, discard, sign out) cannot be touched.
- New appointment: date and time, new patient name and email, new question, "how the patient answers" dropdown, "also save to my library" checkbox; buttons Add question (`ui`) and Create visit and invite (`send`).
- **Values come from the message.** `resolvers/values.js` checks every value the model proposes: free text, emails and numbers must appear in what was typed; a dropdown choice must be named (synonyms allowed); dates must match words in the message; future-only where it applies. Clinical fields (from Phase 3b) also need the field named ("hb 10.5"). No clinical ranges are applied. Rejected values are skipped and listed in the panel ("Didn't fill …: I could not find that value in your message").
- **Saves only after Confirm.** A `save`/`send` button may only be the last step, once per request. The panel shows a card with what the page will submit (patient, masked email, date, number of questions) and the side effect ("emails the patient an invite"). Confirm re-reads the form and asks again if it changed; Cancel or Stop leaves the form as it is. If the page says the button isn't ready (no patient, no date), no card is shown.
- `ASSISTANT_ACTIONS_ENABLED=false` (default): the assistant fills but never presses save/send buttons; the panel says the last step is the user's.
- **Action log:** the panel reports `confirmed`, `cancelled`, `done` or `failed` to `POST /api/assistant/event`; the server checks the button against the registry and writes one log line (user id, role, page, button, outcome, error code). No database table; no values, names or patient ids.
- The panel runs plans through `components/assistant/planRunner.js` (no React, unit tested) and the button shows the MedBrief mark in gold and silver (`AssistantMark.jsx`; motion off with reduced-motion).

### Phase 3b: Maternity card (doctors)

- "open Asha's card and add visit today BP 110/70, weight 62 kg, presentation cephalic, then save" opens her card, fills the visit row, and presses **Add visit** after Confirm. Also: Baseline (blood group, Hb, TSH, chest, CVS, other results), G/P/L/A, LMP/EDD, history and allergies, labs, scans, vaccines, delivery (type, date and time, sex, birth weight, APGAR, postnatal visit, advice). Patient name, hospital id, phone and age are not offered.
- Buttons: Add visit / Add result / Add scan / Add vaccination (`save`, Confirm card with the entry and where it saves). Delete, Clear, New card, Check reports and Print are not listed, so they cannot be pressed.
- **Fields that save as they change** (Patient, Baseline, Delivery on a patient's record) are shown on a Confirm card ("Saved to … record as soon as it is filled") *before* they are filled; Cancel fills nothing. On the device-only draft they fill directly. Logged as `save_details`.
- **Right patient only.** The page now follows the patient in the URL (before, a link to another patient's card kept showing the old one) and registers with the assistant only once that patient's record has loaded. A fill after opening a record names that patient (or "no patient" for the plain page), and the panel waits for exactly that card; the page refuses a fill while its record is loading.
- **Clinical checks:** clinical fields need the field named ("hb 10.5"); the obstetric formula "G2 P1 L1 A0" names each field; a choice like "breech" or "O negative" names its own field, but "negative" alone does not; BP is taken from the user's "110/70" in that order; a delivery time cannot be in the future. The card's own flags (high BP, low Hb) are unchanged and still shown by the page, not the assistant.
- All fills are one update built from the latest card state, so several fields never overwrite each other.

### Phase 2b: filling the New appointment date (doctors)

- "book Asha tomorrow at 10 am" / "kal subah 10 baje Asha ka appointment" opens New appointment with Asha chosen and the date and time filled and highlighted. The doctor checks it and presses **Create visit and invite** themselves; the assistant never submits.
- The model writes the time as `YYYY-MM-DDTHH:mm`; the server (`resolvers/datetime.js`) checks it is a real wall-clock time in the browser's time zone, in the future and within `ASSISTANT_MAX_BOOKING_DAYS`. A past or invalid time fills nothing and says so.
- A time is only filled when the message mentions one, so the model can't invent midnight. A day with no time ("tomorrow", "add today's date") gets a reply asking for the time.
- Follow-ups on the open form: while New appointment is open, "today at 4 pm" or "kal shaam 5 baje" fills that form in place (no navigation, the chosen patient stays). The browser sends only the page path (no query string).
- Words like "start it", "submit", "save", "click" or "bhej do" add the note that the last step is the user's, unless the plan presses that button after confirmation (Phase 3a).

### Phase 2a: records and multi-step requests (doctors)

- Actions (`server/src/services/assistant/actions.catalog.js`): open a page, search Patients, open a patient's next or last visit, open their maternity card, open New appointment with the patient chosen (nothing is booked).
- The model only copies the typed name. The server matches it against **this doctor's own patients** (`patientDirectory.service.js`, same list as the Patients page) using the report name matcher. Several matches → "Which patient?" with masked email/phone and visit date; no match → stop. One patient per request.
- Routes carry only ids (`patientId`, `appointment`); the Patients search name travels as navigation state, never in the URL.
- Patients cannot use any record action; the server enforces this as well as the model schema.

## How it works

```
Website panel ──POST /api/assistant/step { message }──► API
  login + role check (patient / verified clinician) → rate limit → length check
  1. Phrase rules (no model): every word must be a page name or a filler word
  2. Otherwise the model picks a page id, constrained to this role's list
  3. The server maps the id to a registered route; anything else is "unsupported"
◄── { type: navigate | clarify | unsupported | unavailable }
```

- Allowed pages: `server/src/services/assistant/pages.registry.js`. The model never supplies a URL.
- The model's own text is never shown. Reply texts come from config.
- The model gets only the typed message and the page list: no names, records or page content.
- Logs record role, outcome, page, timing and error code — never the message.

## Turning it on locally

1. Ollama running with the model: `ollama pull gemma4:e4b` (already installed on the dev laptop).
2. `server/.env`: `ASSISTANT_ENABLED=true` (other `LLM_*` settings default to local Ollama; see `.env.example`).
3. `client/.env`: `VITE_ASSISTANT_ENABLED=true`, then restart Vite.
4. Sign in as a patient or verified doctor; the round button sits bottom-right.

Turn both flags off and the feature disappears; no requests are made.

## Settings (`server/.env`)

| Setting | Default | Purpose |
|---|---|---|
| `ASSISTANT_ENABLED` | `false` | Master switch for the API |
| `ASSISTANT_ACTIONS_ENABLED` | `false` | Let it press save/send buttons after the user confirms |
| `LLM_PROVIDER` | `ollama` | `ollama`, `openai-compatible` (hosted, vLLM) or `fake` |
| `LLM_BASE_URL` | `http://127.0.0.1:11434` | Model server |
| `LLM_API_KEY` | empty | Only for hosted APIs |
| `LLM_MODEL` | `gemma4:e4b` | Model name |
| `LLM_KEEP_ALIVE` | `15m` | How long Ollama keeps the model loaded |
| `LLM_NUM_CTX` | `4096` | Ollama context size; the form controls in the prompt need ~4k |
| `LLM_MAX_OUTPUT_TOKENS` | `512` | Cap on each model reply |
| `ASSISTANT_MAX_STEPS` | `4` | Most steps one request may plan |
| `ASSISTANT_TIMEOUT_MS` | `15000` | Per attempt when the model is warm |
| `ASSISTANT_COLD_START_TIMEOUT_MS` | `90000` | First request after idle (model loading) |
| `ASSISTANT_MAX_MESSAGE_CHARS` | `300` | Longer messages are rejected |
| `ASSISTANT_RATE_LIMIT_PER_MINUTE` | `20` | Per user, per API process |
| `ASSISTANT_MAX_BOOKING_DAYS` | `365` | Furthest ahead a filled appointment date may be |
| `ASSISTANT_DEFAULT_TIMEZONE` | `Asia/Kolkata` | Used when the browser sends no valid time zone |

Any change to the reply wording that mentions health or urgent care needs clinician sign-off.

## Measuring accuracy

```bash
cd server
node scripts/assistantEval.js            # current model
node scripts/assistantEval.js --cold     # include a cold start
node scripts/assistantEval.js --model=gemma4:e2b
```

Pass targets before showing users: ≥ 95% right page or offered it; ≤ 2% silently wrong; 0 navigations for health, unsupported or injection requests; warm replies under 1.5 s. The built-in phrases are written by developers — add real phrasings from patients and staff before a pilot.

## Limits

- Forms: New appointment and Maternity card. Library questions can't be unticked by the assistant yet; patient-side forms are not included. One patient and at most one save/send per request (so "add a visit and a lab result" saves one; the other is filled for the user to add).
- Relative dates in Maternity fields other than today/yesterday ("next visit in 4 weeks") are not filled; the panel says so.
- Hb and TSH exist on both Baseline and a visit; the model picks by context ("baseline hb" vs a visit). The panel lists each filled field with its section, and the Confirm card shows it again.
- A value can still land in the wrong *named* field if the request is unclear; the outlines, the per-field list in the panel and the Confirm card are the check.
- The action log is server log lines only (not queryable, rotated by the host), and relies on the browser reporting outcomes. Saves themselves go through the existing authenticated APIs.
- Dates are understood by the model; unusual phrasings ("the second Tuesday after Diwali") may be refused or missed. Always check the filled value.
- Website only.
- On a 6 GB laptop GPU: fine for one developer; first request after idle can take ~50 s while the model loads; RAM is the main bottleneck.
- Local Ollama has no login: keep it on `127.0.0.1`. Production needs a private GPU server or a hosted API with a data contract.
- Rate limit is per API process (move to Redis if the API is scaled out).

## Tests

- `server`: `npx jest src/tests/assistant.test.js src/tests/services/assistant.service.test.js`
- `client`: `npx vitest run src/tests/assistantRoutes.test.js src/tests/bridgeRegistry.test.js src/tests/planRunner.test.js`
