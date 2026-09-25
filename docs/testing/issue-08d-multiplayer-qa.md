# Issue #8D Multiplayer QA Harness

## Purpose

This package adds browser acceptance infrastructure for Issue #8 without changing
production synchronization, database policy, migrations, API runners, or shared
Playwright infrastructure. It uses three isolated Chromium contexts in the same
campaign/session:

- DM: permanent authenticated campaign owner
- Player A: approved anonymous session participant
- Player B: separate approved anonymous session participant

The existing `tests/e2e/fixtures.js` fixture remains the cleanup authority. It
creates unique users/campaigns, blocks non-local traffic, tracks expected HTTP
denials, captures failure artifacts, and deletes only artifacts recorded by the
test run.

## Files

- `tests/e2e/realtime-harness.js`: reusable DM/Player A/Player B setup, identity
  assertions, board-isolation checks, and browser-local Realtime probes.
- `tests/e2e/realtime.spec.js`: Issue #8 acceptance coverage.

No shared fixture/configuration file is modified.

## Realtime Contract Exercised

The transport is `public.session_events` INSERT only. Each row is an invalidation
with exactly `schema_version`, `id`, `session_id`, `revision`, and `type`; it is
not state and contains no entity IDs, values, labels, private fields, or secrets.
The harness observes these events only as transport diagnostics.

All state assertions use the production `createSupabaseSyncAdapter` →
`createSyncEngine` → `createSessionLifecycle` path, whose only authority is
`get_session_snapshot`. The DM enters the actual 8C.1 board route and its rendered
realtime panel is asserted after Player A updates a character. Player A and Player
B run the same production lifecycle in their isolated browser contexts because the
current app intentionally starts the lifecycle only on the DM board route; the
player route remains the Issue #6 lobby.

The strict acceptance suite proves:

1. Three isolated identities share one campaign/session and both players are
   approved.
2. Player A's permitted character update emits sanitized invalidations to the DM
   and Player B, then both authorized lifecycles hydrate the updated character.
3. Player snapshots contain no DM projection and character cards expose only the
   explicit public field set.
4. Player B reloads, returns to the normal approved lobby, re-establishes the
   production lifecycle, and receives the next invalidation plus hydrated state.
5. Revoking Player B makes `get_session_snapshot` fail with `42501`; a forced
   production-lifecycle hydrate reaches `denied`, clears its watermarks and
   consumer snapshot, and removes the active realtime channel.
6. Reload and an explicit re-entry attempt without renewed approval remain
   denied. The test does not require a realtime socket attempt itself to fail.

The suite does not fabricate fog, movement, terrain, locations, levels, or a
player board UI. Existing Issue #6/#7 E2E coverage remains the authority for DM-B
campaign isolation, route manipulation, code handling, and character ownership
denials.

## Run

Start the disposable isolated 8A stack described in `docs/testing/issue-08a-verification.md`, then run the full strict suite against it:

```powershell
$env:AURE_TEST_STACK = '08a'
npm.cmd run test:e2e -- tests/e2e/realtime.spec.js
Remove-Item Env:AURE_TEST_STACK
```

There is no `AURE_REALTIME_READY` switch and no expected-failure mode. Any suite
failure is a harness, production integration, authorization, projection, or local
environment failure that must be classified rather than masked.

`tests/e2e/local-stack.mjs` accepts only `foundation` (the pre-Issue-8 default)
or the explicit `08a` isolated project. It rejects hosted endpoints, arbitrary
stack names, mismatched project IDs, database ports, and non-public frontend keys.

The current 8C.1 route ownership is a product-integration limitation rather than
a server authorization defect: player browsers do not automatically start a
session lifecycle through their normal lobby route. The QA harness therefore uses
the actual production lifecycle directly in those contexts. A future player board
route should replace that test-only mounting path, not duplicate its sync engine.

Desktop Chromium runs at 1440x1000 and narrow Chromium at 390x844. Narrow testing
is a resized desktop Chromium viewport and does not claim native mobile coverage.