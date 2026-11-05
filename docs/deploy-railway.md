# Deploying MedBrief on Railway

One Railway project, three services, all built from this repo on every push
to `master`. Each service carries its build and deploy settings in a
`railway.json`; watch paths mean a push only rebuilds what it touched.

| Service | Root directory | Config file | Public domain |
|---|---|---|---|
| `ocr` | `/` (repo root) | `/PaddleOCRFastAPI/railway.json` | **None**: private network only |
| `api` | `/server` | `/server/railway.json` | Yes |
| `web` | `/client` | `/client/railway.json` | Yes |

Set both **Root Directory** and **Config file path** under each service's
Settings. The config file path is always from the repo root.

## Services

### `ocr` (PaddleOCRFastAPI)

Built from `PaddleOCRFastAPI/Dockerfile` with the repo root as the build
context, so the image also carries the lab-report pipeline in `ocr/`. The
PaddleOCR models are downloaded **during the build** and baked into the image,
so a deploy never waits on a model download and needs no volume.

The service has no authentication, so it must not get a public domain. The
API reaches it over Railway's private network.

| Variable | Value | Why |
|---|---|---|
| `PORT` | `8000` | Fixed, so the API can reference it |
| `OCR_DEVICE` | `cpu` | Railway has no GPUs (already the image default) |

`/health` answers as soon as the API is up; `ocr_models` in its body turns
from `pending` to `ready` once the models are loaded (a few seconds, since
they are already on disk).

### `api` (server)

Railpack detects Node and runs `npm start`. Healthcheck: `/health`.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `LOG_FORMAT` / `LOG_LEVEL` | `json` / `info` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from the Supabase project |
| `CLIENT_APP_URL` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `OCR_SERVICE_URL` | `http://${{ocr.RAILWAY_PRIVATE_DOMAIN}}:${{ocr.PORT}}` |
| `OCR_TIMEOUT_MS` | `180000` |
| `OCR_CONFIDENCE_REVIEW_THRESHOLD` | `0.85` |
| `INVITE_TOKEN_TTL_HOURS` | `72` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | optional; without SMTP the invite link is shown to the clinician instead |
| `DEMO_SELF_VERIFY` | `true` for the demo; **`false` afterwards** |

`CLIENT_APP_URL` builds invite links and sets the allowed CORS origin, so it
must be the web service's real domain.

### `web` (client)

Railpack runs `npm run build`, then `npm start`, which serves `dist/` with
`serve -s`. The `-s` flag sends every unknown path to `index.html`, so
reloading a deep link such as `/clinician/schedule` works.

Vite bakes these into the bundle **at build time**. Change one and you must
redeploy `web`.

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | from the Supabase project |
| `VITE_API_BASE_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` |
| `VITE_DEBUG_API` | `false` |

## Supabase

- **Auth → URL Configuration:** set the site URL to the web domain and add
  `https://<web domain>/**` to the redirect URLs.
- **Migrations:** every file in `supabase/migrations/` must be applied to the
  hosted project (`supabase db push`), including the latest
  `20260925000000`, `20260925000001` and `20260926000000`.
- **Storage:** the `lab-reports` and `prescriptions` buckets must exist
  (a migration creates them).

## First deploy, in order

1. **`ocr`:** the slow build (Paddle wheels and models). Wait for the
   deployment to go healthy.
2. **`api`:** generate its public domain under Settings → Networking.
3. **`web`:** generate its public domain. `VITE_API_BASE_URL` resolves from
   the API's domain.
4. **Redeploy `api`** so `CLIENT_APP_URL` picks up the web domain, then
   update the Supabase auth URLs.

## Size, memory and cost

Measured on the built `ocr` image:

| | |
|---|---|
| Image | 2.78 GB on disk, 662 MB compressed (under every plan's 4 GB image cap) |
| RAM, idle with models loaded | ~350 MB |
| RAM after the first OCR (stays there) | ~960 MB; larger or multi-page scans need more |
| One-page photo, OCR end to end | ~1.5 s on a desktop CPU; expect a few times that on Railway |

Railway plans (docs.railway.com/reference/pricing/plans):

| Plan | Price | RAM per service | Fits `ocr`? |
|---|---|---|---|
| Free | $0 | 0.5 GB | **No**: runs out of memory on the first OCR |
| Trial | $5 one-time credit | 1 GB | Barely: ~960 MB after one photo, so a bigger scan can crash it |
| Hobby | $5/month, includes $5 usage | 48 GB | **Yes** |

Usage is billed at $10 per GB of RAM per month and $20 per vCPU per month.
Running all the time, `ocr` at ~1 GB is about $10 a month, and `api` plus `web`
add roughly $1–2. On Hobby that is about $12 a month: the $5 fee, which covers
$5 of usage, plus about $7 more. To cut that for a demo, turn on
**Serverless** for `ocr` (Settings → Deploy). It sleeps when idle and is
billed only while awake; the first upload after a sleep waits for it to start
and load the models, well inside the API's 180 s OCR timeout.

## Checking a deploy

- **API:** `https://<api domain>/health` returns `{"status":"ok", …}`.
- **Upload:** sign in on the web domain as a patient and upload a lab report.
  The values should appear, the `ocr` logs show the request, and the `api`
  logs show `document processed` with a metric count.
- **Deep link:** reload `/clinician/schedule`; the app should load, not a 404.
- **Privacy:** confirm `ocr` has no public domain.

## Running the OCR image locally

```bash
docker build -f PaddleOCRFastAPI/Dockerfile -t medbrief-ocr .   # from the repo root
docker run --rm -p 8000:8000 medbrief-ocr
curl localhost:8000/health
```

`docker compose up` inside `PaddleOCRFastAPI/` does the same.
