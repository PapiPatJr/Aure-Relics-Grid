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

## Current Test Status

`realtime harness creates three isolated approved identities in one session` is
expected to pass before Issue #8 integration. It proves setup/approval isolation,
independent anonymous identities, peer roster visibility, and guest board
isolation.

The remaining tests are strict expected failures unless
`AURE_REALTIME_READY=1` is set:

- public character update reaches the DM and Player B, then still reaches Player
  B after browser reload
- a revoked participant cannot retrieve the session panel, reach the local board,
  or establish a new Realtime subscription

This branch intentionally has no Realtime publication, so a subscription timeout,
channel error, or missing event is an **expected missing-feature failure**. Do not
weaken the event, reload, or projection assertions to make it pass.

A **harness defect** is any failure in the prerequisite test, cleanup, local-only
traffic enforcement, identity isolation, expected-denial accounting, or parsing.
Fix those defects in this package before integration.

## Realtime Contract Exercised

The acceptance probe uses each browser's normal configured Supabase client. It
subscribes to `public.characters` `UPDATE` changes filtered by campaign ID and
waits for the expected `id` and `hp` values. The test requires:

1. DM and approved Player B can subscribe to the permitted public character row.
2. Player A's permitted character update reaches both subscribers.
3. The received row contains the public ID/campaign/HP fields and no `code_hash`,
   `dm_notes`, `private_notes`, or `secret` field.
4. Player B can reload, resubscribe as the same identity, and receive the next
   permitted change.
5. After session revocation, Player B cannot retrieve `get_character_panel` or
   establish a new Realtime subscription.

The test does not assert fog, movement, terrain, locations, levels, hidden-token
rendering, or a fabricated board UI. Those need their own implemented surfaces.
Existing Issue #6/#7 E2E coverage remains the authority for DM-B campaign
isolation, route manipulation, code handling, and character ownership denials.

## Integration Sequence

1. 8A publishes only authorized public state and makes revocation close or deny
   new subscriptions. Never publish private schemas, code rows, DM notes, exact
   enemy HP, or unprojected snapshots.
2. 8B consumes the same authorized projection for hydration/reconnect and keeps
   its own state transitions separate from these browser probes.
3. Start the local Aure Supabase stack, then run the prerequisite test:

```powershell
npm.cmd run test:e2e -- tests/e2e/realtime.spec.js -g "realtime harness"
```

4. Run the complete realtime acceptance suite in strict mode after 8A/8B merge:

```powershell
$env:AURE_REALTIME_READY = '1'
npm.cmd run test:e2e -- tests/e2e/realtime.spec.js
Remove-Item Env:AURE_REALTIME_READY
```

Without that variable, Playwright reports the feature cases as expected failures;
with it, any failure is a real integration failure. An unexpected pass while the
variable is absent is also intentionally surfaced, forcing the expected-failure
gate to be removed during integration.

Desktop Chromium runs at 1440x1000 and narrow Chromium at 390x844. Narrow testing
is a resized desktop Chromium viewport and does not claim native mobile coverage.