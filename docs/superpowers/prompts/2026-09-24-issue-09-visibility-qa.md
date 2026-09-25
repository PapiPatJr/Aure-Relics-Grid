# Issue #9 — Task 4: Visibility QA (Playwright)

## Branch/base

Branch `v09-09-dm-player-visibility`, based on `origin/main` at `98ad3722f3cc2c8fcaf4b6337d41dd07aada4579`. Verify with `git fetch origin && git rev-parse origin/main` before starting.

**Dependency:** Tasks 1, 2, and 3 must all be merged into this branch before you start — you are testing the real `play/<sessionId>` route, the real DM presentation toggle, and the real shared renderer, not mocks of them. If any of `src/board/displayView.js`, `src/board/boardViewRenderer.js`, `src/screens/player-screen.js`, `src/screens/dm-screen.js`, or the `play` route in `src/entry/app.js` is missing or its own unit tests are failing, stop and report rather than writing tests against a moving target.

Read first, do not modify beyond what's listed under "Owned files":
- `docs/superpowers/plans/2026-09-24-issue-09-dm-player-visibility.md` — full plan; this is Task 4.
- `tests/e2e/realtime-harness.js` in full (181 lines) — every helper you extend or reuse: `createMultiplayerSession`, `expectIsolatedIdentities`, `expectGuestBoardIsolated`, `startProductionSession`, `waitForLifecycleStatus`, `waitForCharacterSnapshot`, `lifecycleState`, `forceLifecycleHydrate`, `stopProductionSession`, `observeSessionInvalidations`, `waitForInvalidation`, `closeInvalidationObserver`.
- `tests/e2e/realtime.spec.js` in full (183 lines) — in particular `openDmRealtimeBoard()`, `submitAndApproveCharacter()`, `updateOwnCharacter()`, and the full revocation test (`'a revoked player loses hydrated state...'`) — your new stale-approval test for the player screen is the same scenario, asserted through the real UI instead of `startProductionSession`.
- `tests/e2e/fixtures.js` — the `actors` fixture (`actor()`, `host()`, `request()`, `expectHttp()`, `rpc()`) you build on; do not modify it.
- `playwright.config.js` — confirm the existing desktop/narrow Chromium viewport profiles so your "repeat at narrow viewport" cases target the correct, already-configured profile names rather than inventing a new one.
- The real implementations of `src/screens/player-screen.js` and `src/screens/dm-screen.js` (Tasks 2 and 3's actual code, not just the plan sketch) — confirm the exact DOM ids/classes they produce (`#playerBoardPanel`, `#dmPreviewPanel`, `.dm-presentation-toggle`) before writing selectors against them.

## Owned files

- `tests/e2e/visibility.spec.js` (new)
- `tests/e2e/realtime-harness.js` — additive only: new exported helper functions appended to the file. Do not change the signature, behavior, or body of any existing exported function.
- `docs/testing/issue-09-verification.md` (new — written last, after all tests actually pass, with real observed results)

## Forbidden files

Every file under `src/**`, `script.js`, `style.css`, anything under `supabase/**`, `tests/e2e/fixtures.js`, `tests/e2e/realtime.spec.js` (read-only reference; do not edit it — if one of its existing tests seems to need updating for your changes, that means you introduced a regression, and you should stop and report rather than editing it to compensate).

## New harness helpers to add to `tests/e2e/realtime-harness.js` (additive; exact signatures)

```js
export async function openPlayerScreen(actor, sessionId) {
  await actor.page.goto(`/#play/${sessionId}`);
  await expect(actor.page.locator('#playerBoardPanel')).toBeVisible();
}

export async function expectNoDmProjection(actor, panelSelector = '#playerBoardPanel') {
  await expect(actor.page.locator(`${panelSelector} .realtime-dm-section`)).toHaveCount(0);
  await expect(actor.page.locator(
    `${panelSelector} [data-realtime-action="advance-round"], ` +
    `${panelSelector} [data-realtime-action="toggle-token-visible"], ` +
    `${panelSelector} [data-realtime-action="clear-initiative"]`
  )).toHaveCount(0);
}

export async function togglePresentationMode(actor) {
  const wasVisible = await actor.page.locator('#dmPreviewPanel').isVisible().catch(() => false);
  await actor.page.locator('.dm-presentation-toggle').click();
  if (wasVisible) await expect(actor.page.locator('#dmPreviewPanel')).toBeHidden();
  else await expect(actor.page.locator('#dmPreviewPanel')).toBeVisible();
}

export async function channelCount(actor) {
  return actor.page.evaluate(async () => {
    const { getSupabaseClient } = await import('/src/supabase/client.js');
    return getSupabaseClient().getChannels().length;
  });
}
```

Add these exactly as shown (adjust only if the real implementation's selectors differ from the plan's assumed ids/classes — if so, note the discrepancy in your completion report).

## Test cases required in `tests/e2e/visibility.spec.js`

Import from `./fixtures.js` and `./realtime-harness.js` (both existing exports and the four new ones above). Build each test on `createMultiplayerSession(actors)` exactly as `realtime.spec.js` already does.

1. **DM God Screen shows management state.** `openDmRealtimeBoard`-equivalent: navigate DM to `#board/<sessionId>`, confirm `#realtimeSessionPanel` visible with manage controls present (reuse the exact assertions `realtime.spec.js`'s `openDmRealtimeBoard` already makes, plus assert at least one `[data-realtime-action]` manage button is present).
2. **Toggle hides DM-only DOM.** Click `.dm-presentation-toggle` (via `togglePresentationMode`); assert `#realtimeSessionPanel` hidden (or empty) and `#dmPreviewPanel` visible with **zero** DM-only DOM (`expectNoDmProjection(dm, '#dmPreviewPanel')`).
3. **Toggle produces zero new network activity.** Immediately before the click, register a Playwright request listener (`page.on('request', ...)`) filtered to URLs matching `/rest/v1/rpc/(get_session_snapshot|mutate_session)/` or any websocket upgrade; click the toggle; assert the listener recorded zero matching requests attributable to the click (allow a short settle window, then assert the recorded list is empty before removing the listener). Also assert `channelCount(dm)` is identical before and after the click.
4. **Toggle back restores DM View.** Toggle again; assert `#realtimeSessionPanel` visible with manage controls again and `#dmPreviewPanel` hidden/empty with no leftover nodes.
5. **Player A reaches the real Player Screen.** `await submitAndApproveCharacter(room)`-equivalent setup, then `openPlayerScreen(room.playerA, room.hosted.session)`; assert visible content (round number, the approved character).
6. **No DM projection in the player DOM.** `expectNoDmProjection(room.playerA)` on the same page.
7. **Public state changes propagate.** DM performs `toggle-token-visible` (or another manage action) on the God Screen; assert Player A's `#playerBoardPanel` reflects the change without a page reload (poll via `expect(...).toContainText(...)` or `waitForFunction`, matching the existing invalidation→hydrate timing style already used in `realtime.spec.js`).
8. **Own-character mutation propagates.** Player A performs `adjust-own-hp` on their own character; assert it reaches both the DM's God Screen and Player B's screen (mirrors `realtime.spec.js`'s existing HP-propagation test, but through the real player-screen buttons instead of `startProductionSession`/direct character-form editing).
9. **Reload/reconnect.** Player B reloads mid-session; assert `#playerBoardPanel` re-establishes and shows current (not stale) state after reload.
10. **Revocation clears with no stale flash.** Reuse the exact approve-then-revoke sequence from `realtime.spec.js`'s `'a revoked player loses hydrated state...'` test, but with Player B having actually opened `#play/<sessionId>` first (via `openPlayerScreen`) instead of only `startProductionSession`. After the DM's revoke action commits, assert `#playerBoardPanel` becomes hidden/empty and that its `innerHTML` never re-contains the pre-revocation character's name at any polled point after the revoke click (use `page.waitForFunction` polling the panel's `textContent`, not a single post-hoc snapshot, to catch a transient flash).
11. **Narrow viewport repeat.** Repeat cases 5, 6, 8, and 10 using the existing narrow Chromium profile already defined in `playwright.config.js` (do not invent a new profile — use whatever the config already names).

## Exact test commands

```
npm.cmd run test:e2e -- tests/e2e/visibility.spec.js
npm.cmd run test:e2e
```
Both must pass in full before you write `docs/testing/issue-09-verification.md`.

## `docs/testing/issue-09-verification.md`

Write this last, mirroring the structure of `docs/testing/issue-08c-verification.md`: scope, a results table with real executed output (test counts, pass/fail, exact commands run), files changed across all four tasks (list them from `git diff --stat origin/main`), any known limitation, and confirmation that `npm run check`, `npm run build`, `npm run audit`, and the full `npm run test:e2e` suite all pass with the branch in its final state. Do not write projected or assumed results — only what you actually observed running the commands.

## Completion report format

1. New/modified files (exact paths).
2. Full list of the 11+ test cases actually written, with pass/fail status for each.
3. `npm run test:e2e -- tests/e2e/visibility.spec.js` output tail (desktop and narrow profiles).
4. `npm run test:e2e` full-suite output tail, confirming the three pre-existing `realtime.spec.js` tests are still green and unmodified.
5. Any discrepancy between the assumed selectors/ids in this prompt and what Tasks 2/3 actually produced, and how you resolved it.
6. Whether `docs/testing/issue-09-verification.md` is complete with real (not assumed) results.

## STOP condition

Stop and report once:
- `tests/e2e/visibility.spec.js` passes in full, both viewport profiles.
- `npm run test:e2e` (full suite) passes with zero regressions in `realtime.spec.js`.
- `docs/testing/issue-09-verification.md` is written with real results.
- Exactly one commit made: `test/docs: verify Issue 9 DM/player visibility`.

Do not start Issue #10 work. Do not modify any `src/**` file to make a test pass — if a test only passes after you change production code, that means Tasks 1–3 have a bug; report it instead of fixing it yourself unless explicitly asked to.
