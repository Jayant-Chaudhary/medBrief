# Staging environment setup

Use a separate Supabase project for synthetic workflow testing. Do not restore or copy production patient data into it.

## 1. Create the Supabase staging project

In the Supabase Dashboard, create a new project such as `healthon-staging`. Save its database password in a password manager. In Project Settings, copy the staging Project URL and API keys. Keep the service-role key on the server only.

## 2. Create local staging env files

Copy the examples, then fill them in locally:

```powershell
Copy-Item server/.env.staging.example server/.env.staging
Copy-Item client/.env.staging.example client/.env.staging
```

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `server/.env.staging` to the staging project values. Set `SUPABASE_SERVICE_ROLE_KEY` to that project's server-only secret key. In `client/.env.staging`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the same staging project URL and public key. Leave `VITE_API_BASE_URL=http://localhost:4000` for local testing.

Never put the service-role key in a `VITE_*` variable, the client env file, source control, or chat. The `.env.staging` files are ignored by Git.

## 3. Start the app in staging mode

In separate PowerShell windows:

```powershell
Set-Location server
npm run dev:staging
```

```powershell
Set-Location client
npm run dev:staging
```

Keep the OCR service running at the URL configured by `OCR_SERVICE_URL` (default `http://localhost:8000`) to test report extraction. The patient and clinician accounts must be created in the staging project's Auth, with the expected profile roles and patient-clinician link.

## 4. Database migrations

The migration filenames have been reconciled to unique timestamps and prerequisite order. From `supaBase`, set `SUPABASE_DB_URL` to the staging project's database connection string and run a dry run first. Inspect the migration list and confirm it targets the new staging project before applying anything. For a project that already has migration history, compare it with the local files before pushing; do not assume a renamed migration is unapplied.

Do not run `db reset --linked` against a hosted project; it is destructive.

## 5. Verify the target before creating test records

Confirm both client and server project URLs contain the staging project's ref and match one another. Log in with the staging patient and clinician accounts. The demo records should have clearly synthetic names and report PDFs marked `SYNTHETIC TEST DATA — NOT A REAL PATIENT — NOT FOR CLINICAL USE`.

Keep the 6–7 medication templates in draft until the clinician approves them. Template suggestions are decision support; the clinician decides whether a draft applies to a patient.
