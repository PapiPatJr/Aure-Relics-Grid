# Issue #9 verification — DM God Screen / Player Screen visibility split

Branch: `v09-09-dm-player-visibility` (production) at `d5e89dd641f0415b0e66f42771146890c3ecb440`;
QA branch: `v09-09-visibility-qa`, fast-forwarded onto that same commit before this file was
written. Base: `origin/main` `98ad3722f3cc2c8fcaf4b6337d41dd07aada4579`. Plan:
`docs/superpowers/plans/2026-09-24-issue-09-dm-player-visibility.md`.

## Scope

Delivers, on top of the already-merged Issue #8 realtime stack: a real Player Screen
(`play/<sessionId>`), a DM presentation toggle (DM View ⇄ Player View) on the existing
`board/<sessionId>` route, a shared player-facing board renderer used by both, and a Playwright
visibility/security suite proving the split is structural, not cosmetic. No Supabase migration,
RLS policy, or RPC was touched by any task in this plan; `script.js` has zero diff against
`origin/main`.

## Commits on this branch (base → tip)

```
bbc78d8 plan: add Issue #9 DM/player visibility plan and execution prompts
5b34629 feat: add display-mode projection and shared board renderer      (Task 1)
a7bbe76 feat: add DM presentation toggle (dm-screen.js)                  (Task 3)
f8c87a5 feat: add player screen and play/<sessionId> route               (Task 2)
58f58f1 fix: show approved player screen on play route                   (QA-found defect #1, fixed)
d5e89dd fix: rerender DM presentation immediately on toggle              (QA-found defect #2, fixed)
```

Two production defects were found during Task 4 QA and fixed on the production branch before
this file was written (both described under "Production defects found and fixed" below) — this
is not a QA-only pass; it exercised and corrected real integration bugs between Tasks 1–3.

## Production defects found and fixed during Task 4 QA

**1. Player Screen mounted under a hidden ancestor (`58f58f1`).** `mountPlayerScreen(root)` mounts
`#playerBoardPanel` inside `root` (`#onlineEntry`), but the `play` route set `root.hidden = true`,
so the panel could never become visible — reproduced consistently on both desktop and narrow
Chromium. Fixed by keeping `root` visible and clearing its stale Campaign Hall shell markup
(`root.innerHTML = ''`) instead of hiding it. Regression test added directly to
`tests/entry-ui.test.js` (unit level, `jsdom`), asserting no hidden ancestor and no stale shell
markup — this is why the Playwright suite below never needed to assert DOM ancestry itself; the
unit test already pins it structurally.

**2. DM presentation toggle was a silent, indefinite no-op (`d5e89dd`).** Clicking
`.dm-presentation-toggle` flipped internal state and the button label but never re-rendered —
`#dmPreviewPanel` was only created inside `render(view)`, which was only reached from a fresh
realtime snapshot, and `src/realtime/engine.js` suppresses `onSnapshot` when the revision is
unchanged. With no other session activity, the toggle produced **zero visible change,
indefinitely** (confirmed empirically: waited 35s, past the 30s periodic-hydrate interval — the
preview panel never appeared). Fixed by having `dm-screen.js` remember the last-rendered,
already-authorized `BoardView` and immediately re-render it under the new mode when
`setPresentationMode` is called — presentation-only, no hydrate/subscribe/mutate/network call
added. Regression tests added to `tests/dm-screen.test.js`, proven RED (5 failing) before the fix
and GREEN (12/12) after.

Both defects were root-caused by reading the actual implementation (not guessed), reproduced
before being called defects, and fixed on the production branch/worktree — never worked around
from the QA worktree.

## Environment note: local Supabase stack state (not an Aure Relics regression)

Mid-QA, every realtime-dependent Playwright test (including the pre-existing, unmodified
`realtime.spec.js`) failed with `RealtimeDisabledForConfiguration`. Root-caused via
`docker exec supabase_db_... psql -c "SELECT pubname, tablename FROM pg_publication_tables..."`:
the running local Postgres container had been restored from a stale backup snapshot in which
`session_events` was never added to the `supabase_realtime` publication, even though
`supabase/migrations/20260924031958_realtime_security.sql` does contain
`alter publication supabase_realtime add table public.session_events;`. This was purely local
container/backup state, not a code defect — confirmed by running `npm run db:reset` (replays all
migrations from scratch) and re-verifying the publication via the same `psql` query, then
re-running `realtime.spec.js` (all 3 tests green) before touching `visibility.spec.js` again. On
resuming QA after the toggle fix, the publication and container set were re-checked first and
found already correct — no reset was necessary the second time. Flagging this for whoever next
sets up this stack from a snapshot rather than fresh migrations: a `supabase db reset --local`
is the reliable way to guarantee the publication membership matches the migrations.

## Files changed (Issue #9, `git diff --stat origin/main..HEAD`)

```
docs/superpowers/plans/2026-09-24-issue-09-dm-player-visibility.md   | new
docs/superpowers/prompts/2026-09-24-issue-09-dm-screen.md            | new
docs/superpowers/prompts/2026-09-24-issue-09-player-screen-routing.md| new
docs/superpowers/prompts/2026-09-24-issue-09-renderer-display.md     | new
docs/superpowers/prompts/2026-09-24-issue-09-visibility-qa.md        | new
docs/testing/issue-09-verification.md                                | new (this file)
src/board/boardViewRenderer.js                                       | new (165 lines)
src/board/displayView.js                                             | new (22 lines)
src/entry/app.js                                                     | modified (+29/-3)
src/screens/dm-screen.js                                              | new (110 lines)
src/screens/player-screen.js                                          | new (27 lines)
style.css                                                             | modified, additive (+104)
tests/board-view-renderer.test.js                                    | new (6 tests)
tests/display-view.test.js                                           | new (7 tests)
tests/dm-screen.test.js                                              | new (12 tests)
tests/entry-ui.test.js                                               | modified, additive (+108 lines / 8 new tests)
tests/player-screen.test.js                                          | new (4 tests)
tests/e2e/realtime-harness.js                                        | modified, additive (4 new exported helpers)
tests/e2e/visibility.spec.js                                          | new (11 tests)
```

Confirmed **zero diff** against `origin/main` for: `script.js`, everything under `supabase/**`,
`package.json`, `package-lock.json`, `playwright.config.js`, `tests/e2e/realtime.spec.js`,
`tests/e2e/fixtures.js`, and everything under `src/realtime/**`.

## Unit test results (`node --test`, per new file)

| File | Tests |
| --- | --- |
| `tests/display-view.test.js` | 7/7 |
| `tests/board-view-renderer.test.js` | 6/6 |
| `tests/player-screen.test.js` | 4/4 |
| `tests/dm-screen.test.js` | 12/12 (includes the source-scan structural guarantee and 5 toggle-rerender regression tests) |
| `tests/entry-ui.test.js` | 21/21 (13 pre-existing Issue #8 tests unmodified + 8 new `play`-route tests) |

`npm.cmd run check` (scaffold check + full `tests/*.test.js`): **PASS, 167/167**.

## Playwright targeted visibility suite

Command: `npx playwright test tests/e2e/visibility.spec.js --project=<desktop|narrow>`

**Desktop:** PASS, 11/11 (3.5m)
**Narrow** (`playwright.config.js`'s existing `narrow` project, 390×844): PASS, 11/11 (3.4m)

All 11 cases from `docs/superpowers/prompts/2026-09-24-issue-09-visibility-qa.md` are covered,
including the previously-blocked DM presentation-toggle cases, which now pass with **no sleeps
and no forced hydration** — the toggle's own click handler produces the visible state change
immediately (see defect #2 above):

1. DM God Screen shows management state (advance-round, clear-initiative, DM section all present)
2. Toggle hides DM-only DOM and shows the player-mode preview
3. Toggle produces zero `get_session_snapshot`/`mutate_session` requests, zero websocket
   connections, and an unchanged channel count (`channelCount(dm)` before === after)
4. Toggling back restores DM View with no stale preview DOM
5. Player A reaches the real Player Screen with authorized content
6. Player A's DOM contains no DM projection or management controls
7. DM's public round change propagates live to Player A (no reload)
8. Player A's own-character HP mutation propagates to both DM and Player B
9. Player B reload restores current (not stale) synchronized state
10. Revocation clears Player B with no stale-data flash (`MutationObserver`-based, catching every
    DOM mutation, not a single post-hoc snapshot)
11. A revoked player cannot restore the Player Screen through direct navigation to `#play/<id>`

## Full E2E suite (`npm.cmd run test:e2e`, all specs × both projects)

PASS, **36/36** (10.5m):

- `tests/e2e/characters.spec.js` — 1 test × 2 projects, green
- `tests/e2e/entry.spec.js` — 3 tests × 2 projects, green
- `tests/e2e/realtime.spec.js` (Issue #8, pre-existing, **unmodified**) — 3 tests × 2 projects, green
- `tests/e2e/visibility.spec.js` (this issue) — 11 tests × 2 projects, green

## Issue #8 regression confirmation

`tests/e2e/realtime.spec.js`'s three pre-existing tests are byte-for-byte unmodified
(`git diff --stat origin/main..HEAD -- tests/e2e/realtime.spec.js` is empty) and pass on both
projects as part of the full suite above.

## Build / audit

| Check | Result |
| --- | --- |
| `npm.cmd run build` | PASS; Vite 6.4.3, 69 modules transformed |
| `npm.cmd run audit` | PASS; 0 vulnerabilities |

## Known limitations

- The DM presentation toggle's zero-network assertion (case 3) uses a Playwright `request`
  listener plus a `ws://`/`wss://` URL-prefix check; Playwright's `request` event does not
  actually fire for WebSocket upgrades (those are a separate `websocket` event), so that specific
  prefix check is dead code in practice. The test's `channelCount(dm)` before/after comparison is
  the assertion that actually proves no new realtime channel was created by the toggle, and does
  fire correctly.
- Case 3's `page.waitForTimeout(250)` settle window before asserting zero recorded requests is a
  fixed delay, not a polled condition — acceptable here because the assertion is "nothing
  happened," not "something eventually happened," but noted as a minor test-quality point for any
  future hardening pass.
- No fog/movement/terrain/locations projection exists for either screen — unchanged scope
  carried over from Issue #8, not addressed here.
- `docs/testing/issue-08e-final-review.md`'s previously-flagged `denied`-vs-`error` classification
  nuance (hydrate-time 42501 vs. adapter-observed channel-status heuristic) is unchanged by this
  issue; both production defects found here were presentation/rendering bugs, not authorization
  bugs, and neither touched `src/realtime/**`.
