# Try the in-app assistant (10-minute setup)

The assistant is the gold button at the bottom right of MedBrief. Type what you want ("open Asha's maternity card and add today's visit, BP 110/70") and it opens the page, fills the fields, and asks you to confirm before it saves anything. It runs on a local AI model on your own computer; nothing is sent to an outside service.

## You need

- MedBrief already running for you (server and client, with your Supabase `.env` files).
- A verified doctor account in that Supabase project (the assistant only shows for verified doctors and patients).
- [Ollama](https://ollama.com/download). An NVIDIA GPU with 6 GB or more makes replies take under a second; without one it still works, at 5–20 seconds per reply.

## Setup

1. Get the code and packages:
   ```bash
   git pull
   cd server && npm install
   cd ../client && npm install
   ```
2. Download the model (about 3 GB, one time):
   ```bash
   ollama pull gemma4:e4b
   ```
   Already have a different Gemma? Use it and set `LLM_MODEL=<its name>` (from `ollama list`) in `server/.env`.
3. Turn the assistant on. Add to `server/.env`:
   ```
   ASSISTANT_ENABLED=true
   ASSISTANT_ACTIONS_ENABLED=true
   ```
   and to `client/.env`:
   ```
   VITE_ASSISTANT_ENABLED=true
   ```
   (`ASSISTANT_ACTIONS_ENABLED` lets it press Save or Send buttons, always after you click Confirm. Leave it out and it only fills forms.)
4. Start everything: open Ollama, then run `npm run dev` in `server` and in `client`.
5. Optional check, from `server`: `node scripts/assistantEval.js`. It runs 97 made-up requests and prints accuracy and speed (about 97/97 and under 1 s on a GPU laptop).

## Things to try

Use a test patient; these save to your database. Replace `<patient>` with one of your patients.

- `show today's schedule`
- `<patient> ka maternity card kholo aur aaj ki visit add karo: BP 110/70, weight 62 kg, FHR 140, presentation cephalic, phir save karo`
- On a maternity card: `G2 P1 L1 A0, lmp 12 march, blood group O negative`
- On a maternity card: `delivered yesterday at 9:30 pm by c-section, baby boy 3.1 kg, apgar 8 and 9`
- `book new patient Test Person, <your own email>, tomorrow at 5 pm and send the invite` (sends a real invite email)
- Try to break it: `delete the last visit`, `is her hb normal?`, `add 10.5`

## What it will and won't do

- It fills only fields a page lists for it, using values you typed. If it can't find a value in your message, it skips the field and says why.
- Anything that saves or sends shows a Confirm card first. Cancel leaves the form as it was.
- It never deletes, never answers medical questions, and only finds your own patients.

## If something's off

| Problem | Fix |
|---|---|
| No gold button | `VITE_ASSISTANT_ENABLED=true` in `client/.env`, restart Vite, sign in as a verified doctor |
| "The assistant is not available right now" | Ollama isn't running, or `LLM_MODEL` doesn't match `ollama list` |
| Replies take 10+ seconds | Run `ollama ps`. If it says CPU, plug in the laptop and restart Ollama |
| It fills nothing | Name the field and the value ("hb 10.5", "tomorrow at 5 pm") |

More detail: `docs/assistant/README.md`.
