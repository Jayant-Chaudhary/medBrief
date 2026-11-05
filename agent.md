# AGENTS.md (MedBrief)

## Project
Maternal health app. Flutter patient app (Android), React doctor dashboard, Node.js/Express API, Supabase (Postgres, Auth, Storage, RLS), Python FastAPI services, Ollama local LLM, Firebase Cloud Messaging.
Repo layout: [fill in after inspecting, e.g. apps/, api/, services/, supabase/migrations/]

## Commands
- Install: [fill in]
- Test: [fill in]
- Lint: [fill in]
- Apply migrations locally: [fill in]
Run tests and lint after every change. Never finish a task with failing tests.

## Privacy and safety rules (never break)
- No personal or health data in logs, error messages or analytics.
- Community identity has three layers: Supabase auth ID, a random server-side community ID, and a public username.
- The community ID and the ID mapping never appear in any client-facing response, log line or doctor-facing query.
- The mapping table lives in a private schema the API does not expose. Only the reveal service role can read it.
- Doctors, therapists and moderators never read the mapping, including a mother's own doctor.
- Never reveal identity automatically. A reveal needs an approved request, and every reveal is logged and rotates the username.
- Auth middleware and role checks on every route. Row-level security on every table.
- Notification text is generic, with no health terms on the lock screen.
- Tests and fixtures use synthetic data only.
- Do not invent clinical values or thresholds. Use configuration with clearly marked placeholders.
- The system flags and prioritises. It never diagnoses.

## Working agreements
- Plan first, then implement in small steps.
- Migrations must be reversible.
- Every new endpoint and every RLS policy gets tests, including tests that doctor, therapist and moderator roles cannot read the mapping.
- Ask before adding dependencies.
- End each task with the changed files and open questions.