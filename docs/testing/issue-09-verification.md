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

## Post-review corrective pass (branch `v09-09-review-fixes`)

Starting SHA (QA tip, base of this branch): `51dd10d77fbce8946c9ba0878cdaedbfd77ec171`.

Independent review of the branch above found two Important defects. Root cause for both is
confirmed against the actual merged code (not assumed) and detailed in the "Post-review
architecture amendment" section of
`docs/superpowers/plans/2026-09-24-issue-09-dm-player-visibility.md`, which this section
summarizes with real, executed results.

**1. DM Player View preview was not a safe generic public projection.** `deriveDisplayView`
only nulled `dm`; the DM's own manager-shaped snapshot (hidden tokens, fog-hidden tokens,
unapproved characters, and initiative tied to those) passed through unfiltered into the
player-facing renderer.

**2. The preview was not structurally read-only.** `adjust-own-hp` rendered whenever
`authority.ownCharacterId` matched a character, with no presentationMode/interactionMode gate;
`wireRealtimeBoardActions` is document-scoped and would wire any such control using the original
authoritative view. Not reachable in production today (a DM's `ownCharacterId` is normally `null`),
but not structurally prevented either.

### Architecture amendment: this pass *does* touch Supabase

The original plan's "no Supabase migration" constraint is explicitly superseded for this corrective
pass — see the plan document's amendment for the full rationale. Summary: a client-side filter
cannot faithfully reconstruct fog-visibility or approval-chain predicates without duplicating (and
risking drift from) `private.session_projection`'s own logic, so the backend now supplies
authoritative `publicVisible` metadata instead.

### Exact migration / database changes

`supabase/migrations/20260925103000_session_projection_public_visibility.sql`:

- `create or replace function private.session_projection(...)`: adds a `publicVisible` boolean to
  every token, character, and initiative entry, computed with the exact predicates the function
  already used to gate a non-manager recipient's own arrays (copied verbatim, not re-derived):
  - token: `s.status='active' and t.is_visible and private.sync_rect_visible(...)`
  - character: exists an approved `session_players`+`campaign_members` link for that character with
    `c.approved = true`
  - initiative: the flag of its own `tokenId` in the already-computed `token_rows`
  - No RLS policy, grant, or authorization predicate changed; no existing predicate was weakened.
- A `do $$ ... perform private.refresh_session_sync(c.id) ... $$` bootstrap loop (mirroring the
  predecessor migration's own clock-bootstrap pattern) forces every campaign's cached
  `private.session_sync` projection/revision to the new shape immediately, so the realtime
  change-detection baseline is never left referencing the pre-migration shape. `get_session_snapshot`
  itself always recomputes fresh on every call regardless, so no client reconnect was ever required
  for correctness — this bootstrap is about the invalidation-event baseline, not snapshot
  correctness.

### How public visibility is authoritatively determined

Entirely backend-side, in `private.session_projection`, using the predicates above. The client
(`src/board/displayView.js`) only ever reads the `publicVisible` flag the backend already attached
— it never recomputes, approximates, or guesses visibility.

### Revision / deployment handling

Covered by the migration's bootstrap loop above. Verified via the pgTAP test
(`supabase/tests/database/05_public_visibility.test.sql`) and via `npm run db:reset` replaying all
migrations from scratch, then re-running the full `supabase test db`, `test:api`,
`test:realtime-api`, and `test:realtime-concurrency` suites, all green (see results below).

### Display projection changes (`src/board/displayView.js`)

`deriveDisplayView(view, 'player')` now branches on `view.authority?.canManage`:

- `canManage: false` (a real player's own backend-authorized recipient view): unchanged behavior —
  only `dm` is nulled, `authority` passed through by reference, nothing else touched.
- `canManage: true` (a manager-shaped view, e.g. the DM's own snapshot): additionally filtered to
  only `publicVisible === true` tokens/characters, and initiative entries that are themselves
  `publicVisible === true` **and** reference a surviving public token. `authority` is still the same
  reference; the input is never mutated (covered by a frozen-input test).

### Read-only preview changes

`src/board/boardViewRenderer.js` gained `options.interactionMode` (`'interactive'` default, or
`'readOnly'`). In `'readOnly'` mode the renderer emits **zero** `[data-realtime-action]` elements
of any kind, independent of `presentationMode`/`authority` — manage controls and own-character HP
controls alike. `authority` itself is never touched. `src/screens/dm-screen.js`'s preview panel now
always renders with `interactionMode: 'readOnly'`. `src/screens/player-screen.js` renders
`'interactive'` for a genuine player-shaped view and `'readOnly'` for the (currently unreachable in
normal use, but now structurally handled) case of a manager-shaped view reaching that route
directly.

### Additional fix found during this corrective pass's own verification

Running the full `npm run test:e2e` suite (not just the targeted `visibility.spec.js`) surfaced one
break in the pre-existing, otherwise-unmodified `tests/e2e/realtime.spec.js`:
`expectPlayerProjection`'s exact-key-list assertion on a player's own character card
(`Object.keys(card).sort()`) did not yet include `publicVisible` — an expected, additive
consequence of the new migration, not a defect in the migration itself. Fixed by adding
`'publicVisible'` to that expected key list (one line, `tests/e2e/realtime.spec.js:64-68`), with a
comment pointing at this plan's architecture amendment. This means `tests/e2e/realtime.spec.js` is
**not** byte-for-byte unmodified by this corrective pass (unlike the rest of `src/realtime/**`,
`script.js`, and `playwright.config.js`, which remain untouched) — its behavior is otherwise
identical; only the expected shape of one already-intentionally-changed field list was updated. No
other exact-shape assertion in the repo (checked via a full-repo `Object.keys(` grep across
`tests/**` and `scripts/**`) references the token/character/initiative projection shape, so this was
the only place requiring this update.

### RED → GREEN evidence

- `tests/display-view.test.js`: 3 new tests added (manager-view filtering, fail-closed on missing
  `publicVisible`, real player-shaped view never re-filtered) — confirmed failing against the
  pre-fix `deriveDisplayView` (manual inspection: the pre-fix implementation only ever nulled `dm`,
  so the filtering assertions could not have passed), green after the fix: **10/10**.
- `tests/board-view-renderer.test.js`: 3 new tests (adversarial `readOnly` zero-actions, `readOnly`
  still renders content, `interactive` default preserved) — green after adding `interactionMode`:
  **9/9**.
- `tests/dm-screen.test.js`: 3 new tests (publicVisible-based filtering in the preview panel,
  adversarial zero-actions, integrated mutation-boundary click sweep proving `engine.mutate` is
  unreachable) — green after wiring `interactionMode: 'readOnly'` into the preview render call:
  **15/15**.
- `tests/player-screen.test.js`: 2 new tests (manager-shaped input renders read-only, real
  player-shaped input stays interactive) — green: **6/6**.
- `supabase/tests/database/05_public_visibility.test.sql` (new pgTAP file, 14 assertions): run
  against the local stack **before** the migration was applied — **10/14 failed** with `have: NULL`
  (the `publicVisible` key did not exist yet), confirming the test actually exercises the new
  behavior. After `npm run db:reset` (replaying the new migration): **14/14 pass**.

### Supabase/security test results

`npm run test:db` (`supabase test db`, all 5 pgTAP files): **PASS, 218/218** (the pre-existing 204
across `01_security`/`02_enrollment`/`03_characters`/`04_realtime` unchanged and green, plus the 14
new `05_public_visibility` assertions).

`npm run test:api`: **PASS, 92/92** character API checks.
`npm run test:realtime-api`: **PASS, 41/41** realtime/API security checks.
`npm run test:realtime-concurrency`: **PASS**, 1/1 (deterministic concurrent watermark/notification
check).

### `npm run check` result

**PASS, 178/178** `node --test` cases (167 pre-existing + 11 new across the four unit-test files
above), plus the scaffold check.

### Build result

`npm run build`: **PASS** — Vite 6.4.3, 69 modules transformed (unchanged module count from the
prior verification; no new runtime dependency).

### Audit result

`npm run audit`: **PASS**, 0 vulnerabilities.

### Full E2E result

`npm run test:e2e` (all specs × both `desktop`/`narrow` projects): **PASS, 40/40** (11.6m) —
`characters.spec.js` (1×2), `entry.spec.js` (3×2), `realtime.spec.js` (3×2, after the
`publicVisible` key-list fix above), `visibility.spec.js` (13×2, up from 11 — the 2 new
corrective-pass cases). The targeted `tests/e2e/visibility.spec.js`-only run passed **13/13 on both
`desktop` and `narrow`** independently before the full-suite run above.

### Issue #8 regression result

`tests/e2e/realtime.spec.js`'s 3 tests × 2 projects passed as part of the full-suite run above,
after the one-line `publicVisible` key-list fix described above (see "Additional fix found during
this corrective pass's own verification"). No other behavior in that file was touched.

### Issue #9 visibility result (this corrective pass)

13/13 on both projects, including the two new cases:

1. **DM Player View preview excludes an unapproved (non-public) character while the DM's own
   management view still shows it** — exercised via the existing submit-without-approve character
   flow (no new UI needed): a character submitted but not yet DM-approved appears in
   `#realtimeSessionPanel` but not in `#dmPreviewPanel` after toggling to Player View.
2. **DM Player View preview renders zero actionable controls of any kind** — asserts
   `#dmPreviewPanel [data-realtime-action]` has count 0 after toggling, with a real approved
   character present (so the panel has real content to click on, not just an empty state).

A hidden-token / fog-blocked-token E2E case was intentionally **not** added: this app has no
production UI or RPC path that creates a `public.tokens` row at all today (tokens are seeded only
by direct DB access in test scripts) — unchanged scope carried over from Issue #8, and adding a
token-creation UI is explicitly out of scope for this corrective pass (that would be Issue #10
work). That case is instead covered at the backend/integration level by the new pgTAP file
(`05_public_visibility.test.sql`), which directly proves the `publicVisible` predicate for a hidden
token, a fog-blocked token, and their initiative entries — the plan document explicitly allows this
substitution when fog cannot be exercised through existing E2E UI without pulling Issue #10 scope
in.

### Exact files changed (this corrective pass, `git diff --stat 51dd10d..HEAD`)

```
docs/superpowers/plans/2026-09-24-issue-09-dm-player-visibility.md   | modified (+amendment section)
docs/testing/issue-09-verification.md                                | modified (this section)
supabase/migrations/20260925103000_session_projection_public_visibility.sql | new
supabase/tests/database/05_public_visibility.test.sql                | new (14 assertions)
src/board/displayView.js                                             | modified
src/board/boardViewRenderer.js                                       | modified
src/screens/dm-screen.js                                             | modified
src/screens/player-screen.js                                         | modified
tests/display-view.test.js                                           | modified, additive (+3 tests)
tests/board-view-renderer.test.js                                    | modified, additive (+3 tests)
tests/dm-screen.test.js                                               | modified, additive (+3 tests)
tests/player-screen.test.js                                           | modified, additive (+2 tests)
tests/e2e/visibility.spec.js                                          | modified, additive (+2 tests)
tests/e2e/realtime.spec.js                                            | modified (+1 line: publicVisible key)
```

No other file has any diff against `51dd10d`; `script.js`, `src/realtime/**`, `playwright.config.js`,
`package.json`, and `package-lock.json` remain byte-for-byte unchanged.

### Known limitations

- No E2E (Playwright) coverage for hidden-token/fog-blocked-token exclusion from the DM preview —
  see rationale above; covered instead at the backend/integration level.
- The pre-existing known limitations from the original `docs/testing/issue-09-verification.md`
  section above (dead-code `request`-event WebSocket check in the zero-network toggle test; fixed
  `waitForTimeout(250)` settle window; no fog/movement/terrain/locations projection for either
  screen) are unchanged by this corrective pass.

### READY FOR INDEPENDENT RE-REVIEW or NOT READY

**READY FOR INDEPENDENT RE-REVIEW.** This corrective pass does not merge, does not start Issue #10,
and does not constitute final Sol review.
