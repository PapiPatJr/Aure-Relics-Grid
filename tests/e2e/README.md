# Aure Relics browser acceptance

Uses pinned **Playwright 1.63.0** and Chromium. Four scenarios run at desktop
1440×1000 and narrow 390×844, for eight tests:

1. Complete DM/guest lifecycle, security denials, and legacy board interaction.
2. Branded local assets, layout, keyboard focus, loading and login error states.
3. Board return-button/logo separation and reachable combat controls above the dock.
4. Character submission, portrait, persistence, reclaim, code rotation/revocation,
   campaign/assignment/storage isolation, and owner recovery/replacement.

## Run

From the repository root, with the Aure local Supabase stack already running:

```powershell
npm.cmd install
npm.cmd exec -- playwright install chromium
npm.cmd run test:e2e
# Optional interactive run:
npm.cmd run test:e2e:headed
# Focused rerun:
npm.cmd run test:e2e -- --project=narrow
```

The runner starts and stops its own Vite server on `127.0.0.1:5179`. It refuses to
reuse an existing server. Your normal app on 5173 is not touched. No database reset
is performed. Run DB/API suites separately, after E2E finishes, since they share
the local database.

`local-stack.mjs` verifies the configured CLI project, API port 56321, database port
56322, public-key role and frontend environment. Hosted frontend configuration or
another local project fails before tests start. An absent frontend environment is
allowed: the test server injects the verified local API/public key. It never injects
the service-role key. Do not pass a hosted URL or key to these tests.

Each actor gets a new browser context with independent Auth/localStorage. The main
scenario uses DM A, DM B, approved guest, rejected guest and invitation probe. The
character scenario adds five isolated actors per viewport: **24 contexts per full suite**.
Users/passwords/campaign names are unique per run. Auth identities and campaign IDs
are collected from successful UI responses. Campaign deletion uses the owning DM's
normal authenticated client; the local Node-only admin client deletes only this
run's recorded Auth identities and uploaded character portrait paths. Portrait objects
are removed before campaign rows. Closing a browser context cannot skip DB cleanup.
No personal browser profile or existing local scene data is accessed.

All browser HTTP traffic is restricted to the app and Aure API origins. Uncaught
page errors, unexpected console errors, HTTP failures, or failed requests fail the
test. HTTP denials are allowed only through explicit, consumed one-use path/status
expectations; assertions also verify the error UI or empty RPC result. Navigation
cancellations (`net::ERR_ABORTED`) are ignored. Real successful API calls are never
mocked; one login request is delayed to inspect the loading state.

## Reports and privacy

`playwright-report/index.html` is the HTML report. Use
`npm.cmd exec -- playwright show-report` to open it. `test-results/` contains
screenshots and failure traces. Playwright automatically captures all contexts in
the failure trace. Successful runs keep visual screenshots and a
`browser-observations` attachment containing browser version, context labels,
expected denials, local assets and any problems/cleanup failures.

Both artifact directories are Git-ignored. Failure traces/screenshots can contain
generated local test passwords, invitations and Auth tokens. **Do not commit or
publish them.** The routine success screenshots mask invitation/password and issued
character-code inputs.
Only runtime-generated credentials are used; no secrets are checked into tests.

Narrow viewport coverage uses desktop Chromium resized to 390 pixels, not a claim
of iOS/WebKit or Android-device verification. Hosted email confirmation and public
deployment abuse controls remain deployment checks.
