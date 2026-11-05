# AGENTS.md

Standing rules for every agent working in this repository (MedBrief maternal health platform).
Put this file at the repo root. It is read by Antigravity and other coding agents.

## Current work

The consultation audio pipeline (doctor and patient devices record, chunks upload, speech-to-text, notes draft).
Full instructions, in phases: `docs/consult-audio/IMPLEMENTATION.md`.

- Work on **one phase at a time**. Do not start the next phase unless asked.
- Begin each phase in **Planning mode**: write an implementation plan and wait for approval before editing code.
- At the end of a phase give a short walkthrough with test evidence and known gaps.

## Ground rules

- **Discover, do not assume.** Read the repo for layout, naming, migrations, tests and lint before writing code. Never guess a file path, table name or API shape.
- For Sarvam, read the official OpenAPI and AsyncAPI specs first (links are in the implementation doc). If the spec and the doc disagree, follow the spec and tell the developer.
- Check that packages are maintained and version-compatible (especially Socket.IO server, React client and Flutter client) before adopting them.
- If something is blocked, ambiguous or marked "ask", stop and ask. Do not choose silently.
- Keep changes small. Do not rewrite existing OCR, auth or dashboard code unless the phase needs it, and say exactly what you touched.
- Never claim a test passed or a feature works unless you ran it. If you cannot run something (phone, GPU, API key), say so and give exact manual steps.

## Safety and privacy (never break these)

- The product **flags and prioritises. It never diagnoses.** No UI text or output may state a diagnosis.
- No audio, transcript text, names or health values in logs, errors, analytics or notification text. Log ids, counts, timings and error codes only.
- Tests and fixtures use **synthetic data only.**
- Do not invent clinical values or thresholds. Use clearly named configured placeholders.
- Secrets come from environment variables. Never commit keys. Keep `.env.example` current without real values.
- Every new table has row level security. Every route checks authentication and role.
- Store chunk audio in Supabase Storage (private bucket), never on Render's local disk.

## Architecture rules

- Backend is Node.js, hosted on Render. Python is only for OCR and an optional local Whisper service.
- Socket.IO is for **push messages from server to client only**. All state changes are HTTP requests. The socket is never a dependency.
- Audio chunks upload by HTTPS POST, one chunk per request, safe to retry (idempotent by session, device, sequence).
- Speech-to-text goes through one provider interface. Sarvam and a local model must be swappable by config. Do not depend on word-level timestamps.
- Tunable numbers (chunk lengths, thresholds, timeouts, concurrency) live in the config module, not in code bodies.

## Definition of done

Acceptance tests pass, lint and type checks pass, no sensitive data in logs, config and `.env.example` updated, walkthrough written, no silent TODOs.
