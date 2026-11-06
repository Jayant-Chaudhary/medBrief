# Tab memory and hosting

Assistant memory lives in React state in each browser tab. Hosting does not
require a server session store or a new database table. Each request sends a
bounded memory block; the server checks patient identities and record access
again. Memory is not written to localStorage, sessionStorage, server storage,
logs or analytics. The separately saved dock position contains coordinates only.

Defaults retain the last 10 requests and reject entries older than 120 minutes.
Sign-out and Forget clear memory; refreshing, closing the tab or reloading the
application loses React state. Separate tabs, browsers and devices have separate
memory. This is session context, not permanent conversation history.

Q&A replies carry the resolved query patient's id/name and a suitable verified
record, separately from the page currently open. Only the doctor's own question
and this context enter memory; retrieved lab/vital values do not. App-help and
memory-answer replies do not overwrite the remembered patient. Returning to a
remembered record verifies ownership and patient identity; an inherited write
opens the remembered patient's record before acting and still needs Confirm.

## Hosted configuration

- The browser must reach the authenticated assistant API using the existing API
  URL and auth configuration. No special memory endpoint is required.
- Keep `VITE_ASSISTANT_MEMORY_ITEMS` and `VITE_ASSISTANT_MEMORY_MAX_AGE_MIN` aligned
  with `ASSISTANT_MEMORY_ITEMS` and `ASSISTANT_MEMORY_MAX_AGE_MIN` if changing the
  defaults. Vite variables are applied when building the client.
- Set `ASSISTANT_CONTINUATION_SECRET` to the same long random secret on every
  backend instance. Store the real value only in deployment environment settings.
  It signs action continuations and patient choices; it does not store memory.
  Without it, process-local signing keys invalidate pending tokens on instance
  changes or restarts. Rotating the configured key likewise expires pending work.
- Backend restarts do not erase tab React state, though pending actions may need
  restarting when their token expires. A frontend reload clears tab memory.

No cross-tab or cross-device persistence is provided or implied.

## Verification

The app-help compatibility fix is commit `a55c596`. New server/client memory
tests cover patient B queried while patient A is open, repeated memory questions,
return navigation, a patient mismatch in a remembered visit, and Confirm after
inheriting patient context. Existing expiry, Forget and bounds tests remain.

Measured after these changes:

```text
cd server
npm.cmd test -- --runInBand --coverage=false
Test Suites: 1 skipped, 83 passed, 83 of 84 total
Tests:       5 skipped, 1217 passed, 1222 total
Time:        59.213 s

cd ../client
npm.cmd test -- --run src/tests
Test Files  26 passed (26)
Tests       132 passed (132)
Duration    4.02s

npm.cmd run build
2421 modules transformed
built in 12.22s
```

The build reports a non-blocking bundle-size warning. Hosted/browser acceptance
was not run; the checks above use local tests with synthetic data.
