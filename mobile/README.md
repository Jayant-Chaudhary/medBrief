# MedBrief patient app — Android

The Flutter companion to the existing patient website. This first slice implements
email/password login, secure session persistence, patient-role checks, invitation
acceptance, basic profile completion, and sign-out. The screen after login is an
authentication landing screen; the appointment dashboard is the next feature.

## Authentication: reuse what is already there

No new Android-specific API or database is required:

| Operation | Existing service |
| --- | --- |
| Sign in, refresh session, sign out | Supabase Auth, as on the React website |
| Read authoritative account role and profile | `GET /api/profile` with Supabase bearer token |
| Complete basic profile | `PATCH /api/profile` |
| Look up clinic invitation | `GET /api/auth/invite/:token` |
| Set up a new invited account | `POST /api/auth/accept-invite` |

The Node `/api/auth/login` endpoint also exists, but the website signs in directly
through Supabase. Flutter follows that established path so the SDK manages token
refresh and session lifecycle. Account credentials work on both clients.

New invite: paste clinic link → inspect appointment → set and confirm password →
sign in → complete profile if the stored name is empty → authenticated landing.

Returning invite: paste clinic link → sign in with existing password. The mobile
app never calls the password-creation endpoint for a returning patient.

Used invitations offer sign-in; expired invitations for new patients ask the
patient to contact the clinic. The API remains authoritative if an invite expires
or is consumed after the screen loaded.

Passwords stay in memory while submitted; the Supabase session is persisted using
`flutter_secure_storage`. Android backups are disabled. A profile lookup failure
offers retry without admitting the user or destroying their session. Only a
server-returned `patient` role is admitted, and other roles are signed out locally.

## Run

Install the stable Flutter SDK and Android toolchain, then run `flutter doctor`.
The initial scaffold was generated with Flutter 3.47.8 / Dart 3.13.7.

From `mobile/`:

```bash
cp config.example.json config.json
flutter pub get
flutter run --dart-define-from-file=config.json
```

Fill `config.json` with the same Supabase project URL and public/legacy anon key
as `client/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Never use a
service-role key in an app. The config file is ignored by Git, but public keys
are included in the installed app; database access still requires RLS policies.

Start the existing server using its existing `server/.env`:

```bash
cd ../server
npm run dev
```

For the Android emulator, `http://10.0.2.2:4000` reaches Express on the host.
For a USB-connected physical phone, use `adb reverse tcp:4000 tcp:4000` and set
`API_BASE_URL` to `http://127.0.0.1:4000`. Hosted API builds should use HTTPS.
Only debug Android builds allow cleartext HTTP for local development.

Running without configuration displays the login layout with sign-in disabled;
it never connects to a placeholder Supabase project or pretends login succeeded.

```bash
flutter analyze
flutter test
flutter build apk --debug --dart-define-from-file=config.json
```

## Scope and next steps

- Existing email links continue opening the website. In the app, choose **I have
  a clinic invitation** and paste the same link. Automatic Android App Links need
  the deployed website domain, Android signing certificate fingerprint, and an
  `assetlinks.json` hosted on that domain; this is not configured yet.
- Self-service sign-up and password reset are not part of this first mobile
  slice. Existing website accounts can sign in and new patients can join via
  their clinic invitation. Help text directs patients to the clinic without
  presenting a nonfunctional reset button.
- No changes to backend auth, Supabase schema, FCM, reports, community, or the
  appointment dashboard in this slice.
- Release signing still uses Flutter's development scaffold. Configure clinic
  application identity and production signing before distribution.

## Structure

```text
lib/
  core/             configuration, API client, theme, secure session storage
  features/auth/    repository, session controller, login/invite/onboarding
  features/home/    authenticated landing for this first slice
  app.dart          routes by validated authentication state
  main.dart         Supabase and API initialisation
test/               controller, API-contract, and widget-flow tests
android/            standard Flutter Android host
```

Reference: [Supabase Flutter password sign-in](https://supabase.com/docs/reference/dart/auth-signinwithpassword),
[custom session storage](https://pub.dev/documentation/supabase_flutter/latest/),
[Flutter Android setup](https://docs.flutter.dev/platform-integration/android/setup).


## Patient consultation recording (Phase 5)

The Home/account consultation entry joins a doctor-created room using the same
patient account as the appointment. Complete consent, permissions and the local
mic check, then wait for the doctor to start. The Android foreground task owns
recording and transfers; returning to another page does not dispose capture.
Pending files offer resume or explicit deletion with missing audio flagged.

The app sends AAC chunks to Node, which persists them to private Supabase Storage.
It never connects directly to Redis or uploads audio through the Supabase SDK.
Successful acknowledgements remove local files. Pending audio has a configurable
two-hour retention period while the app runs, with cleanup again at next launch.
Recovery resumes transfers without automatically activating the microphone.

Copy the nonsecret settings from `config.example.json` into local `config.json`.
Mobile chunk lengths are in milliseconds; match the server's seconds settings.
`API_BASE_URL` must be reachable from the phone (USB: `adb reverse tcp:4000 tcp:4000`
and `http://127.0.0.1:4000` in debug; hosted builds: HTTPS).

See [the infrastructure audit](../docs/consult-audio/PHASE_5_INFRA_READINESS.md)
and [the implementation walkthrough](../docs/consult-audio/PHASE_5_WALKTHROUGH.md)
for migration, SDK/NDK setup, executed tests and the required real-phone checklist.
Native acceptance is pending: the attempted APK build stopped at Android SDK/NDK
licence setup, and no phone was attached. Do not infer lock-screen or incoming-call
success from unit tests.
