# Issue #10 Fog of War Implementation Plan

> **For implementation:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to execute this plan task-by-task. Do not skip the red-green-refactor steps or the verification gates.

**Base:** `origin/main` at `14c922cea28cd98a865c946bb41a6b8b29a67866` (`docs: add v0.9 fog of war architecture design`). Verified before writing this plan.

**Recommended branch:** `v09-10-fog-of-war`

**Approved design:** `docs/superpowers/specs/2026-09-25-fog-of-war-design.md`

**Goal:** Implement secure, persistent, DM-controlled Fog of War for v0.9 using the existing Issue #8/#9 snapshot, authorization, revision, and realtime lifecycle. Fog must support irregular cell painting, named areas, inheritance/defaults, player-safe masking, stale-write protection, and a DM Fog Mode without creating a second realtime or authorization system.

**Architecture:** `public.fog_cells` stays the canonical current per-cell state and `private.fog_areas` stays the saved-area definition. Backend-authorized fog commands extend the existing `mutate_session` contract and produce sanitized session invalidations through the existing lifecycle. Player snapshots receive only the active level's compact fog presentation state. Manager snapshots additionally receive DM-only fog-management metadata. The same player fog renderer is used by the real Player Screen and DM Player Preview. The DM's legacy map receives a separate editing overlay/controller, composed from `src/entry/app.js`, while `src/screens/dm-screen.js` remains presentation-only.

**Tech stack:** PostgreSQL/Supabase migrations and pgTAP, plain JavaScript ES modules, existing Supabase JS client and realtime engine, `node:test`, jsdom, Playwright, Vite. No new dependency.

---

## Global Constraints

- [ ] Do not create a second realtime engine, websocket/channel lifecycle, presence subsystem, event bus, or authorization path. Fog extends the existing Issue #8/#9 lifecycle only.
- [ ] Do not make client-side visibility calculations authoritative. The server decides which gameplay entities are projected to a player.
- [ ] Do not expose `private.fog_areas`, hidden entity rows, secret metadata, DM notes, or non-active-level fog masks to Player Screens.
- [ ] Do not let clients write `public.fog_cells` or `private.fog_areas` directly after this issue. All fog writes go through validated DM-only mutation commands.
- [ ] Do not weaken RLS, anonymous-user restrictions, or the existing manager/player authority model.
- [ ] Preserve exact decimal-string session revisions. Never coerce revision watermarks through JavaScript `Number`.
- [ ] Preserve the existing rule that invalidations contain no game state. Hydrated snapshots remain the only authoritative state.
- [ ] Preserve `src/screens/dm-screen.js` as a presentation-only module. It must not import the realtime engine, Supabase adapter/client, lifecycle, or mutation bridge.
- [ ] Preserve the existing offline/local board path. Fog online integration must not make offline mode depend on Supabase.
- [ ] Keep `script.js` changes at zero unless implementation proves there is no safe module-level alternative. The planned implementation uses an overlay on `.grid-frame/#grid` and should not require a legacy-script rewrite.
- [ ] Do not implement Issue #11 terrain/hazard/trap authoring or Issue #13 full multi-level navigation. Only expose the contracts those later issues need.
- [ ] Fog and object disclosure stay separate. Disabling fog never changes `is_visible` or reveals DM-hidden objects.
- [ ] Discrete creature/object tokens use the approved "whole token once any occupied cell is spatially exposed" rule. Area effects remain clipped by the fog mask. Do not globally weaken rectangle visibility for future terrain/effects.
- [ ] Named-area create/edit/rename changes definitions only. It must not silently alter current live fog.
- [ ] `Reset to Defaults` uses deterministic Hidden-wins overlap precedence.
- [ ] Maximum supported board remains 200x200. Avoid per-cell network mutations, per-cell realtime invalidations, and 40,000 DOM nodes.
- [ ] Routine brush and named-area Reveal/Hide actions require no confirmation. Reveal All, Hide All, and Reset require confirmation.
- [ ] **Conservative v0.9 note:** the current realtime stack has no trustworthy presence primitive for deciding whether any players are connected. Therefore `Disable Fog` should always require confirmation in v0.9. This is intentionally stricter than the approved "confirm when players are connected" behavior and avoids inventing a second presence/realtime system solely for this ticket. A later presence feature may suppress the confirmation only when it can prove the DM is alone.
- [ ] A projection/auth failure must fail closed. Never fall back to an unmasked map or locally guessed authorization.

## Review Focus

Every task review should explicitly check:

1. **Security boundary:** hidden gameplay state is omitted server-side, not merely hidden with CSS/canvas.
2. **Mutation atomicity:** one completed brush stroke or broad action is one backend mutation and cannot partially commit.
3. **Realtime storm prevention:** no row-level `fog_cells` trigger produces one projection refresh per cell.
4. **Stale-write behavior:** 40001/40P01 conflicts rehydrate exactly once and never auto-replay the fog mutation.
5. **Projection scope:** players receive active-level fog presentation only; managers may receive DM-only management data.
6. **Preview parity:** DM Player Preview and real Player Screen use the same fog mask/rendering implementation.
7. **Disclosure separation:** fog enable/disable/reveal never changes hidden-object disclosure.
8. **Legacy isolation:** offline/local board and legacy interaction remain functional outside DM Fog Mode.
9. **Large-board cost:** compact row-run transport and canvas rendering remain bounded on 200x200 levels.
10. **No scope creep:** no terrain system, LOS engine, dynamic lighting, exploration-memory state, or secure map-tile streaming is introduced.

## Planned Data/Command Contracts

Use these exact command names unless a test-backed reason requires a documented adjustment:

```text
fog.paint
fog.area.create
fog.area.update
fog.area.delete
fog.area.setVisibility
fog.revealAll
fog.hideAll
fog.resetDefaults
fog.setCampaignEnabled
fog.setLocationOverride
fog.setLevelOverride
```

Planned active-level player projection:

```js
fog: {
  levelId: '<uuid>',
  width: 20,
  height: 20,
  enabled: true,
  revealedRuns: [
    // [y, xStartInclusive, xEndExclusive]
    [2, 3, 8],
    [3, 3, 5]
  ]
}
```

Planned manager-only fog metadata inside `dm.fog`:

```js
{
  campaignEnabled: true,
  locationId: '<uuid>',
  locationOverride: null,
  levelOverride: true,
  effectiveEnabled: true,
  initialized: true,
  areas: [
    {
      id: '<uuid>',
      levelId: '<uuid>',
      name: 'Starting Room',
      cellRuns: [[1, 1, 5]],
      revealedByDefault: true,
      status: 'Revealed'
    }
  ],
  levelRevisions: [
    { levelId: '<uuid>', revision: '7' }
  ]
}
```

`levelRevisions` exists so a manager editing a non-presented level still advances that manager's session projection watermark and a second stale manager window cannot silently overwrite it. Real players do not receive this array.

---

## Task 1: Add authoritative fog projection primitives and compact mask output

**Files:**
- Create: `supabase/migrations/20260925223000_fog_projection.sql`
- Create: `supabase/tests/database/06_fog_of_war.test.sql`
- Modify: `supabase/README.md`

### Steps

- [ ] **1.1 Write failing pgTAP coverage first.** Add the first section of `06_fog_of_war.test.sql` covering:
  - effective inheritance resolves Level -> Location -> Campaign;
  - an active fog-enabled level with no revealed cells projects an enabled, fully hidden mask;
  - revealed cells serialize as deterministic row runs `[y,start,endExclusive]`;
  - a real player snapshot contains top-level `fog` for the active level only;
  - a player snapshot contains no named-area definitions/names/default flags;
  - a manager snapshot contains `dm.fog` management metadata;
  - Hidden/Revealed/Mixed named-area status is derived from canonical current cells;
  - a visible discrete token with a 2x2 footprint becomes public when at least one occupied cell is revealed;
  - an `is_visible=false` token remains non-public even when fog is revealed;
  - `private.sync_rect_visible` still requires the full rectangle and is not weakened globally.

- [ ] **1.2 Run the targeted database test and confirm red.**

```powershell
npm.cmd run db:reset
npm.cmd run test:db
```

Expected: `06_fog_of_war.test.sql` fails because the new projection shape/helpers do not exist yet. Existing earlier database suites should stay green up to the new assertions.

- [ ] **1.3 Add `private.fog_level_state`.** In `20260925223000_fog_projection.sql` create:

```sql
private.fog_level_state (
  campaign_id uuid not null,
  level_id uuid primary key,
  initialized boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  foreign key (campaign_id, level_id)
    references public.levels(campaign_id, id) on delete cascade
)
```

Enable RLS and revoke direct API-role access. Backfill existing levels with a deterministic state row. Existing currently-used levels should be treated as initialized from their canonical `fog_cells`; absent revealed rows mean Hidden. New/future levels may begin uninitialized and fail closed until an explicit initialization/reset workflow establishes defaults.

- [ ] **1.4 Add pure backend fog helpers.** Add private, non-API helpers with empty `search_path`:
  - `private.fog_effective_enabled(level_id)`
  - `private.fog_revealed_runs(level_id)` returning compact JSON runs from canonical revealed cells
  - a helper for compacting arbitrary area cells into row runs for manager projection
  - a helper for derived named-area status
  - `private.sync_rect_exposed(level,x,y,w,h)` for discrete-token exposure

Keep `private.sync_rect_visible(...)` as the full-footprint predicate. If refactoring it to reuse the effective-enable helper, preserve its existing full-rectangle behavior exactly.

- [ ] **1.5 Replace `private.session_projection` with the Issue #10 shape.** Start from the latest Issue #9 `publicVisible` implementation, not the older Issue #8 body. Add top-level active-level `fog` for every authorized recipient and manager-only `dm.fog` metadata.

For token filtering/public visibility only, replace the discrete-token fog test with `private.sync_rect_exposed`. Do not use this helper for terrain/effects yet.

- [ ] **1.6 Keep named-area definitions private.** `dm.fog.areas` may expose compact `cellRuns` to managers, but the real player projection must contain no `fog_areas` data, names, default flags, or hidden geometry.

- [ ] **1.7 Refresh cached projections once after the migration.** Because the projection shape changes, run `private.refresh_session_sync(campaign)` once per campaign at migration end, following the established Issue #9 migration precedent.

- [ ] **1.8 Run database tests green.**

```powershell
npm.cmd run test:db
```

Expected: all database suites pass, including the new projection/security assertions.

- [ ] **1.9 Run database lint/security checks before commit.**

```powershell
npm.cmd exec -- supabase db lint --local --schema public,private --fail-on warning
npm.cmd exec -- supabase db advisors --local --type security --level warn --fail-on error
```

- [ ] **1.10 Commit Task 1.**

```bash
git add supabase/migrations/20260925223000_fog_projection.sql supabase/tests/database/06_fog_of_war.test.sql supabase/README.md
git commit -m "feat: add authoritative fog projection"
```

### Task 1 review checkpoint

- [ ] Player projection contains no DM fog-area metadata.
- [ ] Manager projection includes enough active-level management data and all-level fog revision watermarks.
- [ ] Whole-token exposure is implemented only for discrete tokens.
- [ ] `sync_rect_visible` remains available for full-footprint consumers.
- [ ] Compact runs are deterministic and bounded for 200x200 boards.

---

## Task 2: Add atomic DM-only fog mutations and eliminate per-cell realtime storms

**Files:**
- Create: `supabase/migrations/20260925223100_fog_mutations.sql`
- Modify: `supabase/tests/database/06_fog_of_war.test.sql`
- Modify: `supabase/README.md`

### Steps

- [ ] **2.1 Extend pgTAP with failing mutation/security tests first.** Add assertions for:
  - non-manager `fog.*` mutation returns `42501`;
  - cross-campaign and invalid-level targets are rejected;
  - malformed cells, non-integer coordinates, and out-of-bounds coordinates return `22023`;
  - duplicate submitted cells are canonicalized;
  - stale session revision returns `40001`;
  - a failed batch leaves no partial `fog_cells` changes;
  - manager/player direct DML against `fog_cells` is denied through API-role grants;
  - direct API-role writes to `private.fog_areas` / `private.fog_level_state` are denied;
  - named-area create/update does not alter current `fog_cells`;
  - Reveal/Hide Area mutates selected canonical cells in one logical operation;
  - Reset applies Hidden-everywhere, then revealed defaults, then hidden-default overlap precedence;
  - Reveal All and Hide All work across a maximum 200x200 level;
  - Disable/re-enable changes effective presentation without deleting stored revealed cells;
  - disabling fog does not alter `tokens.is_visible`;
  - one broad fog action advances each affected recipient's projection at most once, not once per cell;
  - changing fog on a non-presented level advances manager revision via `dm.fog.levelRevisions` but leaves a real player's active-level projection/revision unchanged when nothing player-visible changed.

- [ ] **2.2 Run the targeted DB suite and confirm red.**

```powershell
npm.cmd run test:db
```

- [ ] **2.3 Remove the generic row-level fog invalidation trigger.** In the new migration:

```sql
drop trigger if exists sync_changed on public.fog_cells;
```

This is mandatory. A 200x200 Reveal All must not call `refresh_session_sync` 40,000 times.

- [ ] **2.4 Lock down canonical fog tables.** Revoke direct `SELECT/INSERT/UPDATE/DELETE` on `public.fog_cells` from API roles where necessary so clients receive fog through `get_session_snapshot` only. Revoke direct mutation access to `private.fog_areas` and `private.fog_level_state`. Preserve internal security-definer access required by approved RPCs.

- [ ] **2.5 Add internal validation/canonicalization helpers.** Implement bounded cell validation for at most 40,000 unique cells, exact `[x,y]` integer pairs, campaign/level ownership, and grid bounds. Normalize area names to trimmed 1-80 characters. Reject unknown payload keys.

- [ ] **2.6 Define sparse canonical storage.** After this migration, current revealed state is stored sparsely:
  - Revealed cell = row present with `is_revealed=true`.
  - Hidden cell = row absent.
  - Normalize/delete legacy `is_revealed=false` rows in the migration or ensure they are ignored and never written by the new command layer.

- [ ] **2.7 Add one level-revision bump helper.** A successful fog mutation bumps `private.fog_level_state.revision` exactly once for each affected level. It also marks the level initialized when the command establishes a current state.

Initialization rules for this issue:
  - existing/backfilled active levels use their current canonical state;
  - `fog.resetDefaults` explicitly initializes an uninitialized level from named defaults;
  - paint / Reveal All / Hide All establish current state explicitly and mark initialized;
  - named-area definition edits alone do not initialize or change live fog;
  - future Issue #13 level-presentation code must initialize/reset a brand-new prepared level before first live presentation if it wants Revealed-by-Default areas applied automatically. Until then, uninitialized presentation fails closed as Hidden.

- [ ] **2.8 Extend the latest `private.mutate_session` implementation.** Add exact command validation and handlers for:

```text
fog.paint                { levelId, mode, cells }
fog.area.create          { levelId, name, cells, revealedByDefault }
fog.area.update          { levelId, areaId, name, cells, revealedByDefault }
fog.area.delete          { levelId, areaId }
fog.area.setVisibility   { levelId, areaId, revealed }
fog.revealAll            { levelId }
fog.hideAll              { levelId }
fog.resetDefaults        { levelId }
fog.setCampaignEnabled   { enabled }
fog.setLocationOverride  { locationId, enabled: boolean|null }
fog.setLevelOverride     { levelId, enabled: boolean|null }
```

All fog commands are manager-only. Every target must belong to the session's campaign.

- [ ] **2.9 Make cell/area operations atomic and refresh once.** For paint, area visibility, broad actions, and reset:
  1. acquire the same campaign/session concurrency protections used by `mutate_session`;
  2. validate expected session revision;
  3. mutate canonical rows in set-based SQL;
  4. bump the level fog revision once;
  5. call `private.refresh_session_sync(campaign)` exactly once after final state.

Do not manually insert `session_events` and do not publish command payloads.

- [ ] **2.10 Handle inheritance-setting mutations without duplicate refresh.** For `fog.setCampaignEnabled`, `fog.setLocationOverride`, and `fog.setLevelOverride`, bump the affected level revision rows before updating the campaign/location/level setting. Let the existing single row `sync_changed` trigger on that setting row perform the one projection refresh. Do not add a second explicit refresh for the same command.

- [ ] **2.11 Preserve stored cells on Disable Fog.** None of the setting commands delete or rewrite `fog_cells`. Re-enable must restore the exact stored mask.

- [ ] **2.12 Run DB tests and security/lint gates.**

```powershell
npm.cmd run test:db
npm.cmd exec -- supabase db lint --local --schema public,private --fail-on warning
npm.cmd exec -- supabase db advisors --local --type security --level warn --fail-on error
```

- [ ] **2.13 Commit Task 2.**

```bash
git add supabase/migrations/20260925223100_fog_mutations.sql supabase/tests/database/06_fog_of_war.test.sql supabase/README.md
git commit -m "feat: add atomic fog mutations"
```

### Task 2 review checkpoint

- [ ] No direct player/DM client writes to fog tables remain.
- [ ] No per-cell realtime projection refresh remains.
- [ ] One successful stroke/broad action is atomic.
- [ ] Stale writes fail before mutation.
- [ ] Hidden-wins reset precedence is tested.
- [ ] Non-active-level manager edits cannot be silently overwritten by a stale manager tab.

---

## Task 3: Add pure client fog-mask logic and the fog mutation bridge

**Files:**
- Create: `src/fog/fogMask.js`
- Create: `src/fog/fogMutations.js`
- Create: `tests/fog-mask.test.js`
- Create: `tests/fog-mutations.test.js`
- Modify: `src/realtime/types.js`

### Steps

- [ ] **3.1 Write failing pure mask tests.** Cover:
  - decoding row runs into a fixed-size `Uint8Array`;
  - invalid/missing enabled fog fails closed;
  - `enabled:false` is represented separately from the stored revealed mask;
  - 1x1, 2x2, 3x3, 5x5 brush cell generation clips to bounds;
  - brush cell generation is deterministic at edges/corners;
  - applying local Reveal/Hide preview never mutates the authoritative input mask;
  - frontier segment generation returns only Hidden/Revealed boundaries;
  - 200x200 decode/preview stays fixed-size and does not allocate one DOM object per cell.

Use a documented deterministic even-brush anchor. Recommended for 2x2: pointer cell is the top-left member of the 2x2 brush. For odd sizes, center around the pointer cell.

- [ ] **3.2 Run mask tests and confirm red.**

```powershell
node --test tests/fog-mask.test.js
```

- [ ] **3.3 Implement `src/fog/fogMask.js`.** Export focused pure helpers such as:

```js
decodeRevealedRuns(fog)
isCellRevealed(mask, width, x, y)
brushCells({ x, y, size, width, height })
applyFogPreview(mask, width, cells, revealed)
frontierSegments(mask, width, height)
```

Reject malformed dimensions/runs safely. Rendering consumers must get a fully hidden result when an enabled fog payload is invalid.

- [ ] **3.4 Make mask tests green.**

```powershell
node --test tests/fog-mask.test.js
```

- [ ] **3.5 Write failing fog-mutation bridge tests.** Reuse `createSyncEngine` + `createFakeAdapter`. Assert every bridge method emits the exact command type/payload and that `expectedRevision` is attached by the existing engine rather than supplied by the bridge.

Also assert:
  - `40001` and `40P01` use existing `mutateWithConflictRecovery` behavior;
  - conflict hydrates once and never replays automatically;
  - a failed mutation does not fabricate authoritative fog state locally.

- [ ] **3.6 Implement `src/fog/fogMutations.js`.** Export `createFogMutationBridge(engine)` and use the existing `mutateWithConflictRecovery` helper for UI-facing mutations. Do not modify core engine conflict behavior.

- [ ] **3.7 Update JSDoc only in `src/realtime/types.js`.** Document the new top-level snapshot `fog` field and manager `dm.fog` shape. Do not add fog-specific logic to the generic engine.

- [ ] **3.8 Run focused tests.**

```powershell
node --test tests/fog-mask.test.js tests/fog-mutations.test.js tests/realtime-mutation-bridge.test.js
```

- [ ] **3.9 Commit Task 3.**

```bash
git add src/fog/fogMask.js src/fog/fogMutations.js src/realtime/types.js tests/fog-mask.test.js tests/fog-mutations.test.js
git commit -m "feat: add fog mask and mutation client"
```

### Task 3 review checkpoint

- [ ] No new Supabase client calls exist in the fog bridge. It talks only through the existing engine.
- [ ] No conflict is auto-replayed.
- [ ] Mask parsing fails closed.
- [ ] Brush math is pure and independently testable.

---

## Task 4: Add the shared player fog renderer and BoardView/display integration

**Files:**
- Create: `src/fog/fogRenderer.js`
- Create: `src/fog/fog.css`
- Create: `tests/fog-renderer.test.js`
- Modify: `src/realtime/boardBridge.js`
- Modify: `src/board/displayView.js`
- Modify: `src/board/boardViewRenderer.js`
- Modify: `src/main.js`
- Modify: `tests/realtime-board-bridge.test.js`
- Modify: `tests/display-view.test.js`
- Modify: `tests/board-view-renderer.test.js`

### Steps

- [ ] **4.1 Write failing BoardView/display tests first.** Assert:
  - `createBoardView` carries `snapshot.fog` through as top-level `view.fog`;
  - replacement semantics remove/replace old fog on newer snapshot;
  - player derivation retains top-level fog;
  - manager Player Preview strips `dm.fog` because `dm` becomes null;
  - real player-shaped view is not re-filtered or re-authorized client-side.

- [ ] **4.2 Write failing renderer tests.** In jsdom/canvas-testable boundaries assert:
  - enabled fully hidden fog produces an opaque player mask;
  - revealed runs create transparent/revealed rectangles only inside authoritative cells;
  - `enabled:false` displays the full base stage while keeping hidden gameplay entities absent because they never entered the projection;
  - malformed enabled fog renders fully concealed;
  - DM frontier styling is never produced by player rendering;
  - the real Player Screen and DM Player Preview call the same player fog rendering entry point;
  - read-only DM preview still produces zero `[data-realtime-action]` controls.

Keep visual feathering optional in the first implementation. If added, feather opacity inward into the revealed region only. Never clear pixels outward into a hidden cell.

- [ ] **4.3 Run focused tests and confirm red.**

```powershell
node --test tests/realtime-board-bridge.test.js tests/display-view.test.js tests/board-view-renderer.test.js tests/fog-renderer.test.js
```

- [ ] **4.4 Extend `BoardView`.** Add `fog: snapshot.fog ?? null` to `src/realtime/boardBridge.js`, preserving all current sorting/revision semantics.

- [ ] **4.5 Implement `src/fog/fogRenderer.js`.** Use one canvas per rendered board stage, not one DOM element per cell. Provide a player rendering function and a DM-management rendering function that share mask decoding but have distinct visual treatment.

Player treatment:
  - dark charcoal/black fantasy concealment;
  - fully opaque over hidden cells;
  - no gold frontier;
  - optional brief presentation-only fade after authoritative update;
  - no hidden-content sampling outside revealed cells.

DM management treatment:
  - translucent dark overlay;
  - thin Aure Relics gold frontier;
  - selected-area boundary support;
  - caller-controlled opacity.

- [ ] **4.6 Add a lightweight player board stage to `boardViewRenderer`.** The Player Screen currently renders lists/cards only and does not boot the legacy board. Add a `.fog-player-stage` with a base grid/theme substrate sized from `fog.width`/`fog.height`, with the shared player fog canvas above it. Issue #11 may later render map art/terrain beneath this same mask.

Do not port the entire legacy DM board into the player route in this issue.

- [ ] **4.7 Import `src/fog/fog.css` from `src/main.js`.** Keep styling additive and module-owned.

- [ ] **4.8 Run focused renderer/bridge tests green.**

```powershell
node --test tests/realtime-board-bridge.test.js tests/display-view.test.js tests/board-view-renderer.test.js tests/fog-renderer.test.js
```

- [ ] **4.9 Run build.**

```powershell
npm.cmd run build
```

- [ ] **4.10 Commit Task 4.**

```bash
git add src/fog/fogRenderer.js src/fog/fog.css src/realtime/boardBridge.js src/board/displayView.js src/board/boardViewRenderer.js src/main.js tests/fog-renderer.test.js tests/realtime-board-bridge.test.js tests/display-view.test.js tests/board-view-renderer.test.js
git commit -m "feat: render player fog safely"
```

### Task 4 review checkpoint

- [ ] Actual Player Screen and DM Player Preview use the exact same player fog renderer.
- [ ] Player hidden cells are truly opaque in the renderer.
- [ ] Player projection still omits hidden entities server-side.
- [ ] DM-only gold frontier never appears in player rendering.

---

## Task 5: Build the DM Fog Mode editor interaction layer

**Files:**
- Create: `src/fog/fogEditor.js`
- Create: `tests/fog-editor.test.js`
- Modify: `src/fog/fog.css`

### Steps

- [ ] **5.1 Write failing interaction tests.** Use jsdom with a synthetic `.grid-frame`/`#grid` and controlled `getBoundingClientRect` values. Cover:
  - inactive editor has `pointer-events:none` and does not intercept legacy board interaction;
  - active Fog Mode owns pointer painting and prevents underlying map drag gestures;
  - pointerdown + pointermove accumulates a de-duplicated continuous stroke;
  - pointerup invokes `onStroke` exactly once with the completed cell set;
  - no `onStroke` callback occurs during intermediate pointermove;
  - Shift temporarily inverts Reveal/Hide and restores on key release;
  - brush sizes 1,2,3,5 use `fogMask.brushCells`;
  - Esc cancels an unfinished stroke with no commit;
  - `deactivate()`/`dispose()` discard uncommitted preview;
  - named-area selection purpose uses the same pointer engine for Add/Remove but performs no backend mutation itself;
  - overlay opacity and selected-area preview can be updated without altering authoritative input.

- [ ] **5.2 Run test and confirm red.**

```powershell
node --test tests/fog-editor.test.js
```

- [ ] **5.3 Implement `createFogEditor`.** Recommended contract:

```js
createFogEditor({ frame, grid, onStroke })
```

Return methods:

```js
setFog(fog)
setActive(boolean)
setPurpose('fog' | 'area')
setMode('reveal' | 'hide')
setBrushSize(1 | 2 | 3 | 5)
setSelectedCells(cells)
setOpacity(number)
cancelPreview()
dispose()
```

For `purpose:'area'`, interpret Reveal as Add and Hide as Remove internally, or expose labels in the controller while reusing the same cell engine.

- [ ] **5.4 Attach a single overlay canvas to `.grid-frame`.** Use `getBoundingClientRect()` to map pointer position into authoritative grid coordinates. Resize the canvas to the grid's visual size and redraw on snapshot/preview/resize. Do not modify `script.js` token/terrain handlers.

- [ ] **5.5 Ensure pan/zoom remains available.** Only intercept gestures intended for fog painting. If the current legacy board uses wheel/touch scrolling outside the overlay, preserve those browser/grid behaviors. The overlay must not create a second board coordinate system.

- [ ] **5.6 Make tests green.**

```powershell
node --test tests/fog-editor.test.js tests/fog-mask.test.js
```

- [ ] **5.7 Commit Task 5.**

```bash
git add src/fog/fogEditor.js src/fog/fog.css tests/fog-editor.test.js
git commit -m "feat: add dm fog paint editor"
```

### Task 5 review checkpoint

- [ ] Underlying token/terrain manipulation is suppressed only while Fog Mode is active.
- [ ] Intermediate strokes remain local only.
- [ ] One pointer release yields one mutation request opportunity.
- [ ] Named-area editing reuses the same cell engine without changing live fog.

---

## Task 6: Add the Fog Mode controller, named-area/config UI, and app composition

**Files:**
- Create: `src/fog/fogController.js`
- Create: `tests/fog-controller.test.js`
- Modify: `src/entry/app.js`
- Modify: `src/screens/dm-screen.js`
- Modify: `tests/dm-screen.test.js`
- Modify: `src/fog/fog.css`
- Modify: `tests/e2e/realtime-harness.js` only for additive reusable fog helpers if needed by Task 7

### Steps

- [ ] **6.1 Write failing controller tests first.** Cover:
  - Fog Mode controls render only for manager views;
  - toolbar exposes Reveal/Hide, 1/2/3/5 brush sizes, overlay opacity, named areas, Reveal All, Hide All, Reset, and current inheritance settings;
  - a completed live stroke calls `fog.paint` exactly once;
  - failed/conflicted stroke discards local preview and renders authoritative rehydrated state;
  - named area New/Edit changes a local cell selection and only creates/updates on Save;
  - Cancel area edit produces no mutation;
  - Reveal Area / Hide Area do not confirm;
  - Reveal All / Hide All / Reset confirm before mutation;
  - Disable Fog always confirms in v0.9;
  - Enable Fog may proceed without the exposure confirmation because it restores the stored mask;
  - campaign setting is On/Off; location/level settings offer On/Off/Inherit;
  - controller targets explicit `levelId` from manager data rather than guessing from DOM;
  - controller deactivates and discards preview on denial/navigation;
  - presentation mode `player` suspends/hides DM fog editing controls/overlay without changing authority or making a network request.

- [ ] **6.2 Run controller tests and confirm red.**

```powershell
node --test tests/fog-controller.test.js
```

- [ ] **6.3 Implement `createFogController`.** Recommended composition contract:

```js
createFogController({
  engine,
  getSessionId,
  getView,
  frame,
  grid,
  host,
  confirmAction,
  onResult
})
```

Return:

```js
activate()
deactivate()
render(view)
setPresentationMode('dm' | 'player')
dispose()
```

The controller owns `createFogMutationBridge(engine)` and `createFogEditor(...)`. It never creates an engine, adapter, subscription, or Supabase client.

- [ ] **6.4 Build named-area UX.** Required workflow:

```text
New Area -> paint/select cells -> name -> default Hidden/Revealed -> Save
```

Existing areas support Edit, Rename through edit, Delete, Reveal Area, Hide Area. Display server-derived status: Hidden / Revealed / Mixed. Editing area geometry/defaults does not call live Reveal/Hide.

Use compact `cellRuns` from `dm.fog.areas` to initialize editor selections.

- [ ] **6.5 Build broad safety confirmations.** Use clear action-specific copy. Do not use a generic "Clear Fog" term. `Disable Fog` confirmation should explicitly say that the full base map becomes visible while DM-hidden objects remain hidden.

- [ ] **6.6 Extend `createDmScreen` with an optional presentation-mode callback only.** Suggested signature:

```js
createDmScreen({ apply, container, onPresentationModeChange = () => {} })
```

Call it after the local mode changes. Keep all existing structural guarantees: no engine/Supabase imports, no mutation capability, and Player Preview stays read-only.

- [ ] **6.7 Write/adjust `dm-screen` tests before implementation change.** Add source-scan/behavior assertions that the callback works but the module still contains none of the forbidden realtime/Supabase imports. Existing preview read-only tests must remain green.

- [ ] **6.8 Compose the controller in `src/entry/app.js`.** Reuse the already-created singleton `realtimeEngine`. Only on the DM `board/<sessionId>` route, after the legacy board is booted, construct/activate the Fog Mode controller using:
  - `.grid-frame`
  - `#grid`
  - an appropriate DM toolbar host near the board/header
  - `() => realtimeSessionId`
  - `() => realtimeBoardView`

Feed every authoritative manager `BoardView` into `fogController.render(view)` from the existing snapshot render path. On denial/navigation/logout/pagehide, deactivate/dispose it and clear uncommitted preview.

- [ ] **6.9 Wire presentation-mode callback.** When DM switches to Player Preview, call `fogController.setPresentationMode('player')`; when returning, set `dm`. This changes only local DM editing presentation and must not hydrate/mutate/subscribe.

- [ ] **6.10 Do not mount the DM fog controller on `#play/<sessionId>`.** Player route receives only the shared player fog stage through `boardViewRenderer`.

- [ ] **6.11 Run focused client tests.**

```powershell
node --test tests/fog-controller.test.js tests/fog-editor.test.js tests/fog-mutations.test.js tests/dm-screen.test.js tests/board-view-renderer.test.js tests/display-view.test.js tests/realtime-board-bridge.test.js tests/realtime-mutation-bridge.test.js
```

- [ ] **6.12 Run build.**

```powershell
npm.cmd run build
```

- [ ] **6.13 Commit Task 6.**

```bash
git add src/fog/fogController.js src/fog/fog.css src/entry/app.js src/screens/dm-screen.js tests/fog-controller.test.js tests/dm-screen.test.js tests/e2e/realtime-harness.js
git commit -m "feat: wire dm fog mode"
```

### Task 6 review checkpoint

- [ ] One existing realtime engine/lifecycle is still the only live session engine.
- [ ] `dm-screen.js` is still presentation-only.
- [ ] Controller never runs for a real player route.
- [ ] Player Preview suspends DM editing but does not change authority.
- [ ] Broad confirmations match the approved product language.

---

## Task 7: Add three-client fog QA, maximum-board checks, visual leak tests, and verification docs

**Files:**
- Create: `tests/e2e/fog.spec.js`
- Create: `docs/testing/issue-10-verification.md`
- Modify: `tests/e2e/realtime-harness.js` if Task 6 did not already add required reusable helpers
- Modify: `docs/testing/v09-test-checklist.md`
- Modify: `supabase/README.md` if final implementation details differ from its Task 1/2 updates

### Steps

- [ ] **7.1 Write failing Playwright scenarios before final integration fixes.** Use one DM + Player A + Player B with real local Supabase/Auth contexts. Required scenarios:
  1. brand-new/current hidden mask appears on both player clients;
  2. long DM drag remains DM-only during pointer movement and reaches players only after release/commit;
  3. Reveal Area / Hide Area sync to both players;
  4. manually changing some area cells yields manager status Mixed;
  5. Reveal All, Hide All, Reset require confirmation and sync exactly once logically;
  6. Disable Fog confirmation exposes base stage but a DM-hidden token remains absent;
  7. re-enable restores the previously stored mask;
  8. refresh/reconnect restores exact current fog;
  9. two manager-authorized views produce stale-write rejection and rehydrate, with no blind replay;
  10. editing a non-presented level changes manager data only and does not push that mask to players;
  11. DM Player Preview mask behavior matches actual Player Screen for the same authoritative snapshot;
  12. source/player snapshot inspection confirms no named-area metadata/secret hidden object data reaches player context.

- [ ] **7.2 Add maximum-board coverage.** Create/use a 200x200 level through test fixtures/RPC setup. Verify:
  - Reveal All / Hide All / Reset complete without a per-cell session-event storm;
  - compact row-run mask reconstructs exactly;
  - player payload does not contain 40,000 `{x,y}` objects;
  - client mask uses one canvas/stage rather than 40,000 fog DOM nodes.

- [ ] **7.3 Add visual leak coverage.** Under hidden fog, deliberately place or simulate visually distinctive base content and ensure the player fog canvas is fully opaque over hidden cells. At edges, verify no hidden-color/silhouette bleed. Verify no gold DM frontier appears on either real Player Screen or DM Player Preview.

If pixel-level assertions are stable, use screenshots with focused clipping. If platform antialiasing makes exact pixels flaky, assert canvas mask geometry plus screenshot/manual evidence in `issue-10-verification.md` rather than weakening the security assertion.

- [ ] **7.4 Run the focused Playwright suite.** Use the actual current filenames present in the repository. At minimum:

```powershell
npx playwright test tests/e2e/fog.spec.js tests/e2e/visibility.spec.js tests/e2e/realtime.spec.js
```

If a referenced existing file has a different current name, use the repository's real equivalent and record it in verification docs. Do not create duplicate tests merely to match this command spelling.

- [ ] **7.5 Update the v0.9 checklist.** Replace the obsolete Fog of War item `Clear all fog` with the approved controls:
  - Reveal All
  - Hide All
  - Reset to Defaults
  - Disable/re-enable preserving state

Add brush sizes, Shift inversion, named-area Mixed status, persistence across sessions, object-disclosure separation, and player leak checks.

- [ ] **7.6 Write `docs/testing/issue-10-verification.md`.** Record exact commands/results, database test totals, focused unit totals, Playwright results, build/audit result, known limitations, and the deliberate v0.9 `Disable Fog` always-confirm behavior due absence of a trustworthy presence primitive.

- [ ] **7.7 Run final branch verification from a clean working tree.**

```powershell
npm.cmd run test:db
node --test tests/fog-mask.test.js tests/fog-mutations.test.js tests/fog-renderer.test.js tests/fog-editor.test.js tests/fog-controller.test.js tests/realtime-mutation-bridge.test.js tests/realtime-board-bridge.test.js tests/display-view.test.js tests/board-view-renderer.test.js tests/dm-screen.test.js
npm.cmd run check
npm.cmd run build
npx playwright test tests/e2e/fog.spec.js tests/e2e/visibility.spec.js tests/e2e/realtime.spec.js
npm.cmd exec -- supabase db lint --local --schema public,private --fail-on warning
npm.cmd exec -- supabase db advisors --local --type security --level warn --fail-on error
npm.cmd audit
```

Do not replace focused verification with a giant unrelated rerun. If `npm run check` already includes the focused unit tests, the explicit focused command is still useful once for readable Issue #10 evidence, but do not repeat it unnecessarily after no code changes.

- [ ] **7.8 Confirm working tree and diff scope.**

```bash
git status --short
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: only Issue #10 implementation/tests/docs plus intentional shared-contract changes.

- [ ] **7.9 Commit final QA/docs.**

```bash
git add tests/e2e/fog.spec.js tests/e2e/realtime-harness.js docs/testing/issue-10-verification.md docs/testing/v09-test-checklist.md supabase/README.md
git commit -m "test: verify fog of war end to end"
```

---

## Final Acceptance Gate Before PR

- [ ] Every approved product rule from `docs/superpowers/specs/2026-09-25-fog-of-war-design.md` maps to either an automated test or an explicit manual verification item.
- [ ] `public.fog_cells` remains canonical current cell truth; named areas remain definitions only.
- [ ] Hidden/Revealed is the only v0.9 fog state.
- [ ] Level -> Location -> Campaign inheritance is implemented and tested.
- [ ] Fog persists across reloads/sessions and Disable Fog preserves the stored mask.
- [ ] Hidden-by-default wins overlapping Reset defaults.
- [ ] Brush preview is local-only; release is one atomic batch.
- [ ] Shift inversion and 1/2/3/5 brush sizes work.
- [ ] Players cannot mutate fog or read DM fog-management data.
- [ ] Player projection contains only active-level fog presentation data.
- [ ] Whole discrete token appears only after DM disclosure plus spatial exposure; area effects remain prepared for fog clipping without weakening full-rectangle helpers.
- [ ] Hidden objects stay hidden when fog is disabled.
- [ ] DM sees full map with translucent management overlay and gold frontier.
- [ ] Real Player Screen and DM Player Preview share the exact player fog renderer.
- [ ] No hidden visual bleed at fog boundaries.
- [ ] No per-cell realtime storm on broad actions.
- [ ] Stale manager mutations fail/rehydrate and never auto-replay.
- [ ] Non-presented-level fog edits do not shift or leak to the current player table.
- [ ] Existing Issue #8 realtime and Issue #9 visibility tests remain green.
- [ ] Offline/local board still works.
- [ ] No new dependency and no second realtime/presence architecture was added.

## Integration / PR Rules

- [ ] Implement on an isolated Issue #10 branch/worktree from the verified base.
- [ ] Keep the seven task commits reviewable. Do not squash locally while implementing.
- [ ] Open one Issue #10 PR after all task gates pass.
- [ ] Run a fresh final review focused on security, projection leakage, concurrency, and realtime storm prevention before merge.
- [ ] Patrick performs the final integration decision/merge unless explicitly delegated.
- [ ] When approved, use the project's normal squash-merge integration history for the durable `main` commit.

## Suggested Execution Order

```text
Task 1  Backend projection primitives
  |
  v
Task 2  Atomic mutation/security surface
  |
  +--------------------------+
  |                          |
  v                          v
Task 3  Mask/mutation client  Task 4 can begin after Task 1 projection shape is stable,
  |                          but should consume Task 3 mask helpers before landing
  +------------+-------------+
               v
Task 5  DM editor interaction
               |
               v
Task 6  Controller + app composition
               |
               v
Task 7  Three-client QA + verification
```

For lowest merge risk, execute **1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7**. Tasks 3 and early Task 4 test scaffolding can be prepared in parallel only if they do not edit the same files and both consume the frozen snapshot/mask contract from Tasks 1-2.

## Plan Self-Review Checklist

Before implementation begins, reviewer should confirm:

- [ ] No task contradicts the approved architecture spec.
- [ ] Every backend write is manager-authorized and revision-protected.
- [ ] Direct fog-table access is removed from browser clients.
- [ ] The proposed `fog_level_state` solves offscreen stale-edit detection without becoming a competing fog truth source.
- [ ] `initialized` is lifecycle metadata only; `fog_cells` remains current visibility truth.
- [ ] Named-area edits cannot affect live fog until an explicit fog action.
- [ ] Player rendering does not depend on manager metadata.
- [ ] The planned always-confirm behavior for Disable Fog is accepted as the conservative v0.9 implementation detail.
- [ ] No unnecessary Issue #11/#13 implementation has leaked into this ticket.
