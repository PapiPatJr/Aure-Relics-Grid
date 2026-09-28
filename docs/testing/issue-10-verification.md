# Issue #10 Fog of War — Verification (Task 7)

Package: 10G-BUILD. Executes Task 7 of
`docs/superpowers/plans/2026-09-25-issue-10-fog-of-war.md` against the approved
`docs/superpowers/specs/2026-09-25-fog-of-war-design.md`.

## Environment / branch

- Repository: `PapiPatJr/Aure-Relics-Grid`
- Branch: `v09-10-fog-of-war`
- Starting SHA: `8b2569e419906675800243eb9e7d057e7e2e230f` (`fix: revalidate authoritative level context for Delete Area's async confirmation (10F-FIX3)`)
- Final Task 7 SHA: recorded in the commit message / final report after `git commit`.
- Local stack: `supabase status --workdir .` (project `aure-relics-v09-foundation`), API `http://127.0.0.1:56321`, DB port `56322`.
- Node/browser: Playwright 1.63.0, pinned Chromium, `tests/e2e/serve.mjs` Vite server on `127.0.0.1:5179`.

## Fixture-setup limitations bridged for this task (not production changes)

v0.9 has no production UI/RPC path to:

- create a `public.locations`/`public.levels` row or set `sessions.active_level_id` (Issue #13 owns level authoring), and
- place a `public.tokens` row (already documented as a gap in `tests/e2e/visibility.spec.js`).

`public.locations`/`public.levels` also carry no INSERT policy for any client role, and a
service-role REST insert against them is independently rejected with Postgres `42501`
(`permission denied for table locations` — confirmed empirically while building this task;
`service_role` is never granted direct table access in this project's own migrations). Rather
than add a schema grant or a new dependency (a Postgres client library) to work around this,
`tests/e2e/realtime-harness.js`'s new Task 7 helpers (`createFogLevel`, `createExtraLevel`,
`insertHiddenToken`, `countSessionEvents`) shell out to the **already-installed** `supabase` CLI's
own `db query --local` (the same binary `local-stack.mjs` already spawns for `status`), which
connects as the local Postgres superuser and bypasses RLS/grants entirely for fixture setup only.
Every fog *mutation* and every projection assertion in `tests/e2e/fog.spec.js` still goes through
the real authenticated app/RPC surface (`get_session_snapshot`/`mutate_session`); only fixture
setup (and, for the non-presented-level scenario, one raw `mutate_session` RPC call representing a
manager editing a level the v0.9 UI has no switcher for — an explicitly backend-only contract per
design §11) is short-circuited. `createFogLevel` also sets `sessions.status='active'` by default,
for the same reason: v0.9 has no flow that ever leaves `status='lobby'`, and without it a token
could never reach a player regardless of fog, making the disclosure-separation scenario vacuously
true rather than a real check.

No production file, migration, RLS policy, or grant was changed to make any of this work.

## Database verification

Command:

```powershell
npm.cmd run test:db
```

Result: **PASS** — `Files=7, Tests=264`, all suites green, including the pre-existing
`06_fog_of_war.test.sql` / `07_fog_mutations.test.sql` suites from Tasks 1-2 (unchanged by Task 7).

## Focused unit/client verification

Command:

```powershell
node --test tests/fog-mask.test.js tests/fog-mutations.test.js tests/fog-renderer.test.js tests/fog-editor.test.js tests/fog-controller.test.js tests/realtime-mutation-bridge.test.js tests/realtime-board-bridge.test.js tests/display-view.test.js tests/board-view-renderer.test.js tests/dm-screen.test.js
```

Result: **PASS** — `tests 271, pass 271, fail 0`.

## Full check

Command:

```powershell
npm.cmd run check
```

Result: **PASS** — `tests 393, pass 393, fail 0` (scaffold verify + every `tests/*.test.js` file).

## Build

Command:

```powershell
npm.cmd run build
```

Result: **PASS** — Vite build succeeded in ~0.8s, no errors/warnings.

## Playwright

Real filenames used, per plan step 7.4 ("use the repository's actual existing test filenames"):
`tests/e2e/fog.spec.js` (new, Task 7), `tests/e2e/visibility.spec.js`, `tests/e2e/realtime.spec.js`.
Both configured projects (`desktop` 1440x1000, `narrow` 390x844) were run.

Command:

```powershell
npx playwright test tests/e2e/fog.spec.js tests/e2e/visibility.spec.js tests/e2e/realtime.spec.js
```

| Suite | Project | Tests | Result |
|---|---|---|---|
| `fog.spec.js` | desktop | 14 | PASS |
| `fog.spec.js` | narrow | 14 | PASS |
| `visibility.spec.js` + `realtime.spec.js` | desktop | 16 | PASS |
| `visibility.spec.js` + `realtime.spec.js` | narrow | 16 | PASS |

Combined runs (`fog.spec.js` + `visibility.spec.js` + `realtime.spec.js`, one worker each):
- desktop: **30 passed in 10.2m.**
- narrow: **30 passed in 10.1m.**

60/60 total across both configured projects.

Observation: one isolated rerun of `fog.spec.js` alone on `desktop` hit a single transient
`net::ERR_NO_BUFFER_SPACE` on a realtime websocket handshake for one actor, during a period of many
back-to-back Playwright runs against the same local stack while iterating on this task. Rerunning
the exact same test immediately afterward passed cleanly with no code change. This is local
Windows socket-exhaustion under rapid repeated runs, not a product or test defect — it did not
recur in the final full combined runs recorded above.

`tests/e2e/fog-pixel.spec.js` (pre-existing, from an earlier Issue #10 QA-fix pass, see "Visual
leak evidence" below) also passes and was exercised during this task's iteration; it is not one of
the three filenames plan step 7.4 names as the minimum, so it is not re-listed in the table above,
but nothing in Task 7 required changing it.

### TDD evidence

Tasks 1-6 already implemented and unit-tested the fog feature itself (see their own commits' RED
evidence: `test: define fog projection contract`, `test: define atomic fog mutation contract`,
and the RED/GREEN pairs inside `tests/fog-*.test.js`). Task 7's job is full-stack E2E proof, not
new production behavior, so its RED phase is "the new file/scenario does not exist or does not yet
correctly exercise the real DOM/RPC contract" rather than "the feature is unimplemented":

- `tests/e2e/fog.spec.js` did not exist before this task; every scenario's first run was
  necessarily RED (file not found).
- Scenario 1 (initial hidden mask): first real run failed RED for the right reason — a genuine
  fixture-setup permission error (`42501 permission denied for table locations`) surfaced *before*
  any fog assertion ran, from the service-role-REST fixture approach. Diagnosed as a real
  Postgres/PostgREST grant boundary (not a bug in the fog feature), fixed by switching fixture
  setup to `supabase db query --local` (see "Fixture-setup limitations" above); GREEN afterward.
- Scenario 5 (Reveal All/Hide All/Reset): failed RED on `clickPaintCell` timing out — a real
  defect in the *test*, not the app (Fog Mode was never entered via `activateFogMode` before
  attempting to paint, so the overlay's `pointer-events:none` correctly ignored the pointer).
  Fixed by activating Fog Mode first; GREEN afterward.
- Scenario 7 (re-enable preserves mask): failed RED twice for two different real reasons — (1) two
  back-to-back paint strokes from the same window without waiting for the first to commit raced
  their own `expectedRevision` (a genuine, reproducible 40001 self-conflict, confirmed against the
  server logs), fixed by waiting for each stroke's committed effect before starting the next; (2)
  the final "still hidden at (0,0)" assertion was checked once immediately rather than polled, and
  (3,3)/(4,4) being revealed is identical in both the "still disabled" and "correctly re-enabled"
  frames, so it raced the real re-render. Fixed by polling the actually-distinguishing pixel;
  GREEN afterward.
- Scenario 9 (stale manager window): first real run against the true server surfaced a genuine,
  previously-unexercised platform fact — PostgREST maps a raised `40001` (SQLSTATE class `40`,
  transaction rollback) to HTTP `500`, not `400`/`409` — which the existing `fixtures.js` harness
  correctly flagged as an *unexpected* HTTP status until explicitly allow-listed via
  `actors.expectHttp`, exactly as the harness already requires for other intentional denials. No
  suite in this repository had exercised a live stale-revision conflict through the real HTTP
  layer before this task; the app's own client code already treats this correctly (`error.code`,
  not HTTP status, per `mutateWithConflictRecovery`/`isRevisionConflict`), so this was a test-only
  fix (register the expected status), not a product defect. GREEN afterward, and the finished
  scenario is exactly the required proof: the rejected attempt is exactly one request never
  auto-retried, and an explicit retry after a real rehydrate succeeds.
- Scenario 13 (200x200): a copy/paste-wrong expectation (`revealedRuns` equal to a single row
  after a level-wide Reveal All, instead of one run per of the 200 rows) failed RED against the
  real, *correct* server output; fixed the test's expected value; GREEN afterward.

Every other scenario passed on its first real run against the live stack — i.e., Tasks 1-6's
implementation already satisfied the contract; Task 7 needed no additional production code path
beyond confirming it end-to-end. No production file was modified to make any scenario pass.

## Three-client results

All 12 required scenarios below use one DM, Player A, and Player B, real local Supabase/Auth
contexts (`tests/e2e/fog.spec.js`, run against the live stack, not mocked).

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Initial hidden mask | PASS | Both players' `.fog-player-canvas` is exactly `level.width`x`level.height` and fully opaque `PLAYER_FOG_FILL` at corners; raw player snapshot's `fog` is `{levelId,width,height,enabled:true,revealedRuns:[]}`. |
| 2 | Local-only drag preview, one commit | PASS | Mid-drag (after pointerdown, through several pointermoves, before release): zero `mutate_session` requests observed, both players' pixels for every stroke cell still opaque fog. After release: exactly one `mutate_session` POST for the whole 6-cell stroke, both players see all 6 cells revealed. |
| 3 | Reveal Area / Hide Area sync, no confirmation | PASS | Real New Area → drag-select → name → default → Save workflow; `window.confirm` listener recorded zero dialogs across create/Reveal Area/Hide Area; both players' pixels flip correctly each way. |
| 4 | Mixed named-area status | PASS | Area created Hidden; after directly painting one of its two cells, the area row's server-supplied `status` text changes to "Mixed"; after painting the second, to "Revealed" — value comes straight from `dm.fog.areas[].status`, computed server-side by `private.fog_area_status`. |
| 5 | Reveal All / Hide All / Reset: confirm + one sync each | PASS | Each of the three toolbar actions produced exactly one `window.confirm` dialog with the approved product copy and exactly one `mutate_session` POST; both players observed the resulting state. |
| 6 | Disable Fog disclosure separation | PASS | With fog fully revealed (isolating the check from fog visibility) and a DM-hidden (`is_visible:false`) token present: player's raw snapshot `tokens` stays `[]` and the DOM never contains its label, both before and after Disable Fog; the DM's own snapshot shows the token's `isVisible:false`/`publicVisible:false` unchanged across the Disable Fog mutation (fog commands never touch `public.tokens`, confirmed by reading `20260925223100_fog_mutations.sql`). |
| 7 | Re-enable preserves stored mask | PASS | Two specific cells revealed, then Disable (everything visible), then Enable: the exact two cells are revealed again and every other sampled cell is hidden again — never a reset mask. |
| 8 | Refresh/reconnect persistence | PASS | Both players reloaded after a real paint; exact same revealed/hidden pixels reconstruct with no fallback/guessed state. |
| 9 | Two-manager stale-write | PASS | A second real authenticated DM browser context/session (same account) had its snapshot frozen at its own just-hydrated state; window A committed a real change; window B's next mutation attempt genuinely raced its own stale `expectedRevision` and was rejected (`40001`, surfaced as HTTP 500 with `{"code":"40001",...}` — see TDD evidence) exactly once, never auto-retried; after an explicit real rehydrate, an explicit retry succeeded. |
| 10 | Non-presented-level isolation | PASS | A raw, backend-authorized `fog.revealAll` against a second (never-presented) level bumped only that level's entry in `dm.fog.levelRevisions`; the manager's own presented-level `fog` block was byte-identical before/after; the real player's snapshot `fog` and `revision` were both byte-identical before/after (the content-diffed `refresh_session_sync` never re-invalidated them because nothing player-visible changed); the second level's id never appears anywhere in the player's serialized snapshot. |
| 11 | DM Player Preview parity | PASS | For the same authoritative snapshot, every sampled cell's pixel on the DM's Player Preview (`#dmPreviewPanel`) exactly matches the real Player Screen's pixel (both mount via the same `buildPlayerFogStage`/`renderPlayerFog`); a full-canvas scan found zero pixels matching the DM-only gold frontier color. |
| 12 | Player snapshot secrecy | PASS | The real player-authorized `get_session_snapshot` response has `dm: null`; `fog` has exactly the five documented keys (no `areas`/management data); `tokens` excludes the hidden token; the full serialized JSON contains none of the named area's name, the hidden token's label, `cellRuns`, `revealedByDefault`, `levelRevisions`, `"areas"`, `dmNotes`, `tokenDetails`, `locationOverride`, `levelOverride`, or `campaignEnabled`. |

## Maximum-board results

Scenario 13, a real 200x200 level (the schema's own maximum, `grid_width`/`grid_height` check
`between 1 and 200`):

- **200x200 confirmed**: level created with `grid_width=200,grid_height=200`; both players'
  `.fog-player-canvas` backing store is exactly `200x200` native pixels.
- **Broad actions**: Reveal All, Hide All, and Reset to Defaults each triggered through the real DM
  toolbar (with confirmation), each completed, and each player-visible pixel change was verified
  (corner and interior cells).
- **Event/realtime behavior**: `public.session_events` row count for the session increased by at
  most a handful (bounded `<=10` in the assertion; the three real recipients — DM, Player A, Player
  B — mean the true number is on the order of 1-3 per action) for each of the three broad actions on
  a 40,000-cell board — never anywhere near one row per cell.
- **Compact transport**: after Reveal All, the real player snapshot's `fog.revealedRuns` has
  exactly 200 entries (one full-width run per row), each spanning the full `200` columns — never
  40,000 `{x,y}` objects. After Reset (with one 50-cell revealed-by-default named area seeded via
  the real `fog.area.create` RPC — dragging thousands of synthetic pointer events was not the
  point of this scenario), `revealedRuns` is exactly `[[0,0,50]]`.
- **DOM/canvas cost**: each player's `.fog-player-stage` contains at most 3 DOM nodes total (stage
  + base substrate + one canvas) regardless of board size — never one node per cell.
- Each broad action was also confirmed to be exactly **one** `mutate_session` POST from the DM's
  click.

## Visual leak evidence

- **Automated assertion (real Player Screen, `fog.spec.js` scenario 14)**: with one cell revealed
  on a 20x20 board, every one of its 6 immediate neighbors reads back as exactly opaque
  `PLAYER_FOG_FILL` (`rgb(16,13,10)`, alpha 255) from the canvas's own backing store (not a
  screenshot, so no CSS-scaling interpolation can hide a real leak or fake one). A full-canvas scan
  (400 pixels) found every pixel is either exactly that fog color or exactly fully transparent
  (alpha 0) — never a third/blended value — and found zero pixels matching the DM-only gold
  frontier color anywhere.
- **DM Player Preview**: scenario 11 performs the same full-canvas gold-frontier scan against the
  Preview's own canvas — zero matches — and confirms pixel-for-pixel parity with the real Player
  Screen for the same snapshot.
- **Conclusion, hidden-cell bleed**: none found, under both a single-mask-boundary probe and a
  full-canvas exhaustive scan, reading the canvas's own drawing operations directly.
- **Conclusion, DM frontier leakage**: none found on either the real Player Screen or the DM Player
  Preview, across two independent scans (scenario 11 and scenario 14).
- **CSS-scaling antialiasing bleed (out of this file's scope by design)**: `renderPlayerFog`/
  `buildPlayerFogStage` back the canvas at exactly one native pixel per cell and rely on
  `image-rendering: pixelated` CSS scaling (see `fogRenderer.js`'s module docstring). That specific
  browser-compositor interpolation risk is not observable by reading canvas pixel data directly (it
  only happens during the browser's own upscaling of the rendered canvas element to its CSS size),
  so it is deliberately left to the existing dedicated regression,
  `tests/e2e/fog-pixel.spec.js` (a real-screenshot-decode test at a 200x200 board scaled to a
  non-integer 303 CSS px, added during an earlier Issue #10 QA-fix pass), which remains green — see
  the Playwright results table above. This is the documented split described in plan step 7.3: the
  security assertion above is never weakened to accommodate antialiasing; the antialiasing-specific
  case has its own deterministic, focused coverage instead.

## Build/security verification

| Check | Command | Result |
|---|---|---|
| Build | `npm.cmd run build` | PASS |
| DB lint | `npm.cmd exec -- supabase db lint --local --schema public,private --fail-on warning` | PASS — no schema errors found |
| DB security advisors | `npm.cmd exec -- supabase db advisors --local --type security --level warn --fail-on error` | PASS — no issues found |
| npm audit | `npm.cmd audit` | PASS — 0 vulnerabilities |
| Diff check | `git diff --check <base>...HEAD` | PASS — no whitespace/conflict-marker issues |

Diff/scope note: this working copy is a single-branch clone (`remote.origin.fetch` scoped to only
`v09-10-fog-of-war`), so `origin/main` is not resolvable here. The plan's own written base commit,
`14c922cea28cd98a865c946bb41a6b8b29a67866` ("docs: add v0.9 fog of war architecture design" — also
directly verified as `fd7d0a7`'s parent, the first Issue #10 commit), was used in its place for the
diff-check/diff-stat commands; it is the exact commit the plan document itself was written against.

## Known limitations

- **Disable Fog always requires confirmation** because the current realtime system has no
  trustworthy presence primitive proving the DM is alone. This is the intentional, conservative
  v0.9 rule from the approved plan's Global Constraints and design §7 — no presence subsystem was
  introduced to change it, and none should be for this issue.
- v0.9 has no production UI/RPC to create locations/levels, move a session off `lobby`, or place a
  token; Task 7's E2E fixtures bridge this with direct local-Postgres-superuser fixture setup (see
  "Fixture-setup limitations" above) rather than inventing any of those UI/RPC surfaces, which
  would be Issue #13 (and partially Issue #11) scope.
- The CSS-scaling/antialiasing fog-boundary bleed class of bug is covered by the pre-existing
  `tests/e2e/fog-pixel.spec.js`, not by new assertions in `fog.spec.js` (see "Visual leak evidence").
- One transient local `net::ERR_NO_BUFFER_SPACE` websocket flake was observed on a single isolated
  rerun during iteration (see Playwright results); not reproducible and not present in the final
  recorded runs.
- `dm.fog.initialized` (whether `private.fog_level_state` has ever recorded an explicit action for
  a level) is exercised at the database layer (`06_fog_of_war.test.sql`/`07_fog_mutations.test.sql`)
  but has no dedicated Task 7 E2E assertion; it is bookkeeping metadata only and does not gate any
  player-visible or security-relevant behavior (an uninitialized level still fails closed to fully
  Hidden, per design §2.1, which scenario 1 does verify end-to-end).
