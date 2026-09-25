# Issue #9 — DM God Screen / Player Screen visibility split

**Base:** `origin/main` `98ad3722f3cc2c8fcaf4b6337d41dd07aada4579` (`[v0.9][08] Realtime board sync and role-based session state` — the squashed merge of Issues #8A–#8E). Verified via `git fetch origin && git rev-parse origin/main`.
**Branch:** `v09-09-dm-player-visibility`, created from this exact commit in worktree `aure-relics-09-visibility`.
**Reads for context, does not modify:** `docs/issue-08a-realtime-contract.md`, `docs/testing/issue-08a-verification.md` through `issue-08e-final-review.md`, `supabase/**`.
**Does not modify:** any Supabase migration, RLS policy, or RPC. Issue #9 is a pure presentation/routing layer on top of the already-merged, already-tested Issue #8 realtime stack. No backend file is touched anywhere in this plan.

## Goal

Deliver, for the first time in this project:

1. A real **Player Screen** — an approved player can open `play/<sessionId>` and see a live, backend-authorized board/HUD.
2. The **DM God Screen** — the existing DM `board/<sessionId>` route, now with an explicit DM View ⇄ Player View presentation toggle.
3. Strict, structurally-provable DM/player visibility separation, with the backend snapshot (`get_session_snapshot`, Issue #8A) remaining the sole security boundary.
4. Both screens driven by the one realtime lifecycle Issue #8 already built (`createSyncEngine` + `createSessionLifecycle` + `createSupabaseSyncAdapter`) — no second engine instance, no new subscription per screen.

## Architecture

### What Issue #8 already gives us (verified against the merged code, not the old pre-merge branches)

- `src/realtime/boardBridge.js` (`createBoardView`/`reconcileBoardView`, 81 lines, unchanged since 8C): pure snapshot → `BoardView` transform with replacement semantics. `dm` is `null` for a player projection and passed through unchanged for an owner projection — never fabricated.
- `src/realtime/engine.js` (280 lines, includes 8E's fixes): `hydrate`/`subscribe`/`mutate`/`disconnect` plus `getStatus`/`getSessionId`/`getContext`/`getAppliedRevision`/`getObservedRevision`. **Denial is already fully handled**: `enterDenied()` tears down the live subscription, clears both revision watermarks, and cancels any coalesced follow-up hydrate — reachable either from an adapter-pushed `DENIED` status or from a hydrate rejection carrying SQLSTATE `42501` (`isAccessDeniedError`).
- `src/realtime/sessionLifecycle.js` (112 lines): wraps the engine with focus/periodic hydration and forwards `onSnapshot`/`onStatus`/`onError` unchanged; on `DENIED` it cancels its own timers (the engine already tore down the subscription).
- `src/realtime/boardActions.js` (77 lines) + `src/realtime/mutationBridge.js` (61 lines): click-delegating wiring for the four supported commands (`session.setRound`, `token.setPublicState`, `initiative.set`, `character.update`), gated client-side only by `view.authority.canManage`/`view.authority.ownCharacterId` — **UX convenience only**, the backend re-validates every mutation regardless. `wireRealtimeBoardActions(engine, getSessionId, getView, root = document, onResult)` binds its click listener on `root` (default `document`) and matches **any** `[data-realtime-action]` element anywhere in that root, not just ones inside a specific panel.
- `script.js` (2778 lines; realtime block is lines 2605–2778, **unchanged since 8C.1**): `applyRealtimeSnapshot`/`renderRealtimeTokenRow`/`renderRealtimeCharacterCard`/`renderRealtimeInitiativeRow` build the DM's `#realtimeSessionPanel` from a `BoardView`. Exposed only as `window.aureRelicsApplyRealtimeSnapshot` because `script.js` is a plain classic script (no `type="module"`, no imports) — this is deliberate, so the offline/local board keeps working with zero Vite dependency.
- `src/entry/app.js` (308 lines): owns the **one** realtime engine/lifecycle instance for the whole app (`ensureRealtimeLifecycle()`, lazily created, reused across navigations). `stopRealtimeBoard()` runs at the top of every `load()` (line 126), on logout, on external auth-state change, and on `pagehide` — so at most one session is ever live. Today `onSnapshot`/`onStatus` unconditionally call `window.aureRelicsApplyRealtimeSnapshot`, and the whole realtime path (including the `board` route itself) is gated to `isDm(user)` at line 134. **There is currently no route an approved player can reach that renders board state at all** — `refresh()`'s lobby-approved state (line 211) literally says "online battle play is not available yet."
- `tests/e2e/realtime-harness.js` / `tests/e2e/realtime.spec.js`: three-actor (DM, Player A, Player B) Playwright fixture already exercising the production engine/adapter directly via `startProductionSession()` (constructs its own engine+adapter+lifecycle inside `page.evaluate`, independent of `src/entry/app.js`'s singleton), plus `lifecycleState()` (exposes `status`, `appliedRevision`, `observedRevision`, `currentSnapshot`, `channelCount`), `expectGuestBoardIsolated()` (asserts `#legacyBoard` hidden and zero `.cell` elements), and a full stale-approval/revocation scenario already covered **at the engine level**. There is no `AURE_REALTIME_READY` gate any more (retired during 8D/8E merge).

### The one deliberate deviation from the pre-merge sketch, and why

The Issue #8C-era chat plan sketched extracting `script.js`'s renderer into a shared ES module that `script.js` itself would delegate to. Having now read the merged code and its exact test coverage, **this plan does not touch `script.js` at all**. Reason: `tests/realtime-board-bridge.test.js` loads `index.html` + `script.js` in isolation via `JSDOM` (`runScripts: 'outside-only'`) with **no ES module and no `src/entry/app.js` present**, and asserts directly on `window.aureRelicsApplyRealtimeSnapshot`'s DOM output (manager-vs-non-manager gating, DM-section absence, offline-path non-interference). Making `script.js` delegate to a global set by an ES module would leave that global undefined in exactly this test's bootstrap, breaking it or forcing an edit to an Issue #8 test file for no functional gain. Instead:

- The DM's **DM View** rendering stays exactly what it is today: `script.js`'s existing `#realtimeSessionPanel` via `window.aureRelicsApplyRealtimeSnapshot`. Zero changes to `script.js`, zero risk to its tests.
- A **new**, independent, dependency-free renderer (`src/board/boardViewRenderer.js`) is built for the parts that are actually new: the real Player Screen, and the DM's **Player View preview**. Both consume the same renderer — this is what satisfies "one shared board renderer" (Locked Rule F) for the part of the system where sharing actually matters (the player-facing projection), without destabilizing the proven DM-authoring rendering path.
- The new renderer reuses the exact same CSS class names and `data-realtime-action`/`data-token-id`/`data-character-id`/`data-delta` dataset attributes `script.js` already uses, so the **existing, unmodified** `wireRealtimeBoardActions` (bound on `document` by default) wires up buttons rendered by the new renderer automatically — no second mutation-wiring module is needed anywhere.

This is exactly the kind of "better file boundary, documented before changing the proposed structure" call the kickoff asked for: `script.js` moves from "likely modified" to **not modified at all**.

### Locked rules → concrete mechanisms

| Locked rule | Mechanism |
|---|---|
| A. Backend snapshot is authoritative | Unchanged: `get_session_snapshot` (8A) is the only source of `authority`/`dm`. Issue #9 adds no authorization logic anywhere. |
| B. Presentation must never change authority | `deriveDisplayView(view, presentationMode)` never touches `view.authority` — only ever nulls `view.dm` for `'player'` mode. `mutationBridge`/`boardActions.js` are untouched and continue to read the original authoritative `BoardView`, never the derived display view. |
| C. DM preview-as-player is presentation only | `src/screens/dm-screen.js` holds **no reference at all** to `engine.js`/`supabaseAdapter.js`/`sessionLifecycle.js`/the Supabase client — it only ever receives already-hydrated `BoardView` objects and an `apply()` callback. This is a structural guarantee (enforced by a source-scan test, see Task 3), not a runtime check: the module cannot possibly hydrate, subscribe, or mutate, because it never imports anything that could. |
| D. Lobby approval is not authorization | The `play/<sessionId>` route mounts the player screen and starts the realtime lifecycle *after* an `api.lobby(id).status === 'approved'` check, exactly mirroring the existing `lobby/<id>` route's own gate — but the actual data render is driven exclusively by `sessionLifecycle`'s `onSnapshot`/`onStatus`. A stale-approved-but-backend-revoked player's `hydrate()` call fails with `42501` → `engine.js` already (8E) enters `DENIED`, tears down the subscription, and clears both watermarks → `sessionLifecycle`'s `onStatus('denied')` fires → `app.js`'s existing handler nulls the tracked `BoardView` and re-renders `null` through whichever screen is mounted. **No new denial-handling code is needed** — Issue #9 only needs to make sure `onStatus`/`onSnapshot` dispatch to the player screen exactly the way they already dispatch to the DM screen today. |
| E. Player must never boot legacy DM board | The `play/<sessionId>` route branch in `app.js` never calls `bootBoard()` and never sets `board.hidden = false` (the `#legacyBoard` element stays hidden the entire time this route is active). Regression-tested by reusing `tests/e2e/realtime-harness.js`'s existing `expectGuestBoardIsolated()` unchanged. |
| F. One shared board renderer | `src/board/boardViewRenderer.js` is the single renderer for every player-facing projection: the real Player Screen and the DM's Player View preview both call it with the same `deriveDisplayView(view, 'player')` input. (The DM's own management rendering intentionally keeps using `script.js`'s existing, separately-tested renderer — see deviation note above.) |

## Tech stack

No new dependency. Plain JavaScript ES modules (`src/**`), the existing classic `script.js`, Vitest-free `node --test` unit tests (matching every existing `tests/*.test.js`), `jsdom` (already a devDependency, already used by `tests/realtime-board-bridge.test.js`) for the two DOM-touching new test files, and Playwright (`tests/e2e/**`) extending the existing three-actor fixture.

## Spec references

- `docs/issue-08a-realtime-contract.md` — snapshot/authority/mutation contract (read-only reference; explicitly reserves "DM God Screen... Issue #9+" as its own non-goal, which this plan now fulfills without touching that file).
- `docs/testing/issue-08c-verification.md` — exact current shape of `boardBridge`/`boardActions`/`mutationBridge`/the `script.js` panel, and the "Remaining work before 8D/8E" section this plan closes the last open item of (routing/ownership decisions for `sessionLifecycle`/`mutationBridge` in `app.js` — already resolved by 8C.1; Issue #9 extends that resolved ownership to a second route rather than reopening it).
- `docs/testing/issue-08e-final-review.md` — confirms no open Critical/Important Issue #8 defect and no backend/client contract mismatch as of the merge base.
- `tests/e2e/realtime-harness.js`, `tests/e2e/realtime.spec.js` — reused test infrastructure and precedent for the new Playwright suite.

## Global constraints

- No Supabase migration, RLS policy, or RPC changes. If implementation discovers a genuine backend blocker, stop and report it rather than patching around it client-side.
- `script.js` is not modified by any task in this plan.
- `view.authority` is never mutated or re-derived anywhere client-side, for any reason, including for display purposes.
- Every new rendering path must be reachable with `authority.canManage === false` and `dm === null` and produce **zero** DM-only DOM nodes — this is asserted structurally (`querySelector` absence), never by CSS `hidden`/`display:none`.
- At most one realtime engine/lifecycle instance exists in the running app at any time (the existing `app.js` singleton), for both the DM route and the new player route.
- All existing Issue #8 tests (`npm run check`'s 130 `node --test` cases, the full `npm run build`/`npm run audit`, and the existing three Playwright specs in `tests/e2e/realtime.spec.js`) must remain green, unmodified in behavior, for the entire plan.

## Review focus

When reviewing any diff produced under this plan, check specifically for:
1. Any code path that reads `view.authority.canManage`/`ownCharacterId` from a *display-derived* view instead of the original authoritative `BoardView` passed to `mutationBridge`/`boardActions`.
2. Any import of `src/realtime/engine.js`, `src/realtime/supabaseAdapter.js`, or `src/realtime/sessionLifecycle.js` inside `src/screens/dm-screen.js` (forbidden — see Locked Rule C).
3. Any DOM assertion in a new test that checks `hidden`/CSS visibility instead of node absence for DM-only content.
4. Any change to `script.js`, any Supabase migration, or any RLS policy (all forbidden in this plan).
5. Two tasks touching `src/entry/app.js` concurrently (only Task 2 touches it — see ownership table).

## Exact file ownership

| Task | Creates | Modifies | Forbidden |
|---|---|---|---|
| 1. Renderer + display projection | `src/board/displayView.js`, `src/board/boardViewRenderer.js`, `tests/display-view.test.js`, `tests/board-view-renderer.test.js` | — | `src/entry/app.js`, `src/screens/**`, `script.js` |
| 2. Player screen + routing | `src/screens/player-screen.js`, `tests/player-screen.test.js` | `src/entry/app.js`, `style.css`, `tests/entry-ui.test.js` (additive tests only) | `script.js`, `src/screens/dm-screen.js`, `supabase/**` |
| 3. DM screen (presentation toggle) | `src/screens/dm-screen.js`, `tests/dm-screen.test.js` | `style.css` (additive; coordinate with Task 2 to avoid a literal merge conflict — see below) | `src/entry/app.js`, `script.js`, `supabase/**` |
| 4. Visibility QA | `tests/e2e/visibility.spec.js` | `tests/e2e/realtime-harness.js` (additive exported helpers only) | any `src/**` file, `script.js`, `supabase/**` |
| — (integration, done last, by whichever task lands last or a short follow-up) | `docs/testing/issue-09-verification.md` | — | — |

**Sequencing** (this is a pipeline, not four truly-simultaneous workers, because `src/entry/app.js` is a hard single-owner integration point):

```
Task 1 (foundation, no dependencies)
   │
   ├──► Task 3 (dm-screen.js: imports Task 1's two modules; never touches app.js)
   │
   └──► Task 2 (player-screen.js + app.js: imports Task 1's two modules AND Task 3's
                 createDmScreen — must start after Task 3's interface exists, but Task 3's
                 exact interface is fixed below, so Task 2 can be coded against the contract
                 as soon as Task 3's file exists, even mid-implementation)
                   │
                   └──► Task 4 (visibility.spec.js: exercises the real routes/DOM Tasks 2+3 build)
```

Recommended real-world order: **1 → 3 → 2 → 4**. Tasks 1 and 3 have zero file overlap with Task 2, so they can genuinely run concurrently with each other; Task 2 needs Task 3's file to exist (not just its interface) before `app.js` can `import` it and before `npm run check` can pass; Task 4 needs 2 and 3 both merged.

**style.css overlap**: Tasks 2 and 3 both append new, disjoint rule blocks (Task 2: `.player-board-panel`, `.realtime-*` base styling shared by both new panels; Task 3: `.dm-preview-panel`, `.dm-presentation-toggle`). To avoid a literal merge conflict, Task 2 owns and writes the shared `.realtime-*` base rules (token/character/initiative list styling used by both the player panel and the DM preview panel) since it lands first per the sequencing above; Task 3 only ever *appends* its own two new, uniquely-named rule blocks at the end of the file and must not edit any rule Task 2 added.

## Interfaces between tasks (exact signatures — no task may deviate without updating this section first)

```js
// src/board/displayView.js (Task 1)
/**
 * @param {import('../realtime/boardBridge.js').BoardView|null} view
 * @param {'dm'|'player'} presentationMode
 * @returns {import('../realtime/boardBridge.js').BoardView|null}
 *   'dm': returns `view` unchanged, by reference (===).
 *   'player': returns a new object equal to `view` except `dm` is `null`; `authority` is the
 *     exact same reference as `view.authority` (never cloned, never mutated).
 *   null input: returns null. Invalid presentationMode: throws.
 */
export function deriveDisplayView(view, presentationMode) { /* ... */ }
```

```js
// src/board/boardViewRenderer.js (Task 1)
/**
 * @param {HTMLElement} container Owned by the caller; this function only ever sets
 *   container.hidden and replaces container's children. Never touches anything outside container.
 * @param {import('../realtime/boardBridge.js').BoardView|null} displayView Already display-derived
 *   (the caller is responsible for calling deriveDisplayView first — this function does not call it).
 * @param {{ presentationMode: 'dm'|'player' }} options
 *   null/undefined displayView: hides container and clears its children (mirrors
 *   script.js's applyRealtimeSnapshot(null) contract exactly).
 *   Manage-only controls (advance-round / toggle-token-visible / clear-initiative) render only
 *   when presentationMode === 'dm' AND displayView.authority?.canManage.
 *   The DM section renders only when presentationMode === 'dm' AND displayView.dm is truthy.
 *   Own-character HP controls render whenever displayView.authority?.ownCharacterId matches a
 *   character's id, regardless of presentationMode.
 *   Uses the exact class names/dataset attributes script.js's renderer already uses:
 *   realtime-token-list/-row/-label/-kind/-condition, realtime-character-list/-card/-statuses/
 *   -hp-controls, realtime-initiative-list/-row, active-combatant, realtime-dm-section,
 *   realtime-action-button, data-realtime-action, data-token-id, data-character-id, data-delta —
 *   so the existing, unmodified wireRealtimeBoardActions wires any buttons this renders.
 */
export function renderBoardView(container, displayView, { presentationMode }) { /* ... */ }
```

```js
// src/screens/player-screen.js (Task 2)
/**
 * @param {HTMLElement} root Mount point (app.js passes the #onlineEntry root).
 * @returns {{ render(view: BoardView|null): void, dispose(): void }}
 *   Creates one <section id="playerBoardPanel" class="realtime-session-panel player-board-panel">
 *   appended to root, hidden by default. render(view) calls
 *   renderBoardView(panel, deriveDisplayView(view, 'player'), { presentationMode: 'player' }).
 *   dispose() removes the panel and is idempotent; render() after dispose() is a no-op.
 */
export function mountPlayerScreen(root) { /* ... */ }
```

```js
// src/screens/dm-screen.js (Task 3)
/**
 * @param {{ apply: (view: BoardView|null) => void, container: HTMLElement }} options
 *   `apply` is window.aureRelicsApplyRealtimeSnapshot (or a test double) — called with the
 *   original, undisplay-derived BoardView whenever presentationMode is 'dm', and with `null`
 *   whenever presentationMode is 'player' (hides the DM's own panel while previewing).
 *   `container` is the element the presentation-toggle button is appended into (app.js passes
 *   document.querySelector('.app-header')).
 * @returns {{
 *   activate(): void,     // shows the toggle button; idempotent; does not itself render anything
 *   deactivate(): void,   // hides the toggle button and any preview panel; resets mode to 'dm'
 *   render(view: BoardView|null): void, // dispatches to `apply` or the preview renderer per mode
 *   getPresentationMode(): 'dm'|'player',
 *   setPresentationMode(mode: 'dm'|'player'): void, // same effect as clicking the toggle; test hook
 * }}
 *
 * MUST NOT import src/realtime/engine.js, src/realtime/supabaseAdapter.js, or
 * src/realtime/sessionLifecycle.js, or reference any Supabase client — this file receives only
 * already-hydrated BoardView objects, never anything it could use to hydrate/subscribe/mutate.
 * Owns and lazily creates its own preview panel: a <section id="dmPreviewPanel"
 * class="realtime-session-panel dm-preview-panel"> appended to document.body, hidden by default,
 * rendered via boardViewRenderer.renderBoardView with presentationMode: 'player' — never via
 * script.js's renderer.
 */
export function createDmScreen({ apply, container }) { /* ... */ }
```

## Checkbox task breakdown

### Task 1 — Renderer + display projection

- [ ] Write failing test: `tests/display-view.test.js` — `deriveDisplayView` contract exactly as specified above (dm-mode pass-through by reference; player-mode nulls only `dm`; `authority` reference untouched; null input; invalid mode throws; input object never mutated — assert via `Object.freeze(view)` before calling and expect no throw).
- [ ] Implement `src/board/displayView.js` to make it pass.
- [ ] Write failing test: `tests/board-view-renderer.test.js` (jsdom, detached `<div>` container — no `index.html`/`script.js` involved) covering: hides+clears on `null`; renders tokens/characters/initiative from a bare player-shaped view with zero manage buttons and no `.realtime-dm-section`; a DM-shaped `displayView` (has `dm`, `authority.canManage: true`) rendered with `presentationMode: 'player'` still produces **zero** manage buttons and **zero** `.realtime-dm-section` (the defense-in-depth case — this is the single most important test in this task); the same DM-shaped view rendered with `presentationMode: 'dm'` produces the manage buttons and the DM section; own-character HP controls render only for the matching character id, in both modes; re-rendering with a new view fully replaces prior DOM (no stale nodes from a previous token/character list survive).
- [ ] Implement `src/board/boardViewRenderer.js` to make it pass.
- [ ] Run `node --test tests/display-view.test.js tests/board-view-renderer.test.js` — all green.
- [ ] Run `npm run check` — unchanged 130/130 baseline plus the new tests, all green (proves zero regression; these two new files import nothing from the existing codebase).
- [ ] Commit: `feat: add display-mode projection and shared board renderer`.

### Task 2 — Player screen + routing (depends on Task 1 and Task 3's file existing)

- [ ] Write failing test: `tests/player-screen.test.js` (jsdom) — `mountPlayerScreen(root)` appends exactly one panel to `root`, hidden by default; `render(view)` with a DM-shaped view (defense-in-depth input, same as Task 1's key test) produces zero DM-only DOM; `render(null)` hides/clears; `dispose()` removes the panel and is idempotent; `render()` after `dispose()` is a no-op.
- [ ] Implement `src/screens/player-screen.js` to make it pass.
- [ ] In `src/entry/app.js`:
  - [ ] Import `mountPlayerScreen` from `../screens/player-screen.js` and `createDmScreen` from `../screens/dm-screen.js`.
  - [ ] Create `dmScreen = createDmScreen({ apply: view => window.aureRelicsApplyRealtimeSnapshot?.(view), container: document.querySelector('.app-header') })` once, at `startEntry()` setup time (next to where `back` is created).
  - [ ] Add `renderTarget` state (`'dm'|'player'|null`) and a `playerScreen` variable (lazily created via `ensurePlayerScreen()`, mirroring `ensureRealtimeLifecycle()`'s laziness).
  - [ ] Replace the hardcoded `window.aureRelicsApplyRealtimeSnapshot?.(...)` calls inside `ensureRealtimeLifecycle()`'s `onSnapshot`/`onStatus` with a `renderCurrent(view)` dispatcher that calls `ensurePlayerScreen().render(view)` when `renderTarget === 'player'`, or `dmScreen.render(view)` when `renderTarget === 'dm'`, or does nothing when `renderTarget === null`.
  - [ ] In the `board` route branch (existing `page === 'board'` handling, line ~159): call `dmScreen.activate(); renderTarget = 'dm';` before `startRealtimeBoard(session.id)`.
  - [ ] Add a new `page === 'play'` branch, reached only when the earlier DM-only redirect (line 134) did not already redirect `page` away — i.e. for any truthy `user`, DM or not: look up `const lobby = await api.lobby(id); if (stamp !== epoch) return;` — if `lobby?.status !== 'approved'`, `go(`lobby/${id}`); return;` (send them to the existing lobby flow instead, exactly like an unapproved/pending player already experiences on any other route); otherwise set `activeSession = { id }`, hide `root`, **do not** touch `board`/`#legacyBoard` (leave it hidden), show `back`, set `renderTarget = 'player'`, call `startRealtimeBoard(id)`.
  - [ ] In `stopRealtimeBoard()`: call `renderCurrent(null)` before clearing `realtimeBoardView`/`realtimeSessionId`; additionally, `ensurePlayerScreen()`'s panel is disposed (not merely hidden) — `playerScreen?.dispose(); playerScreen = null;` — and `dmScreen.deactivate(); renderTarget = null;`, mirroring the existing full-teardown convention `clearCharacters()` already uses elsewhere in this file.
- [ ] Add `style.css` rules for `.realtime-session-panel`, `.player-board-panel`, and the shared `.realtime-token-list`/`.realtime-character-card`/`.realtime-initiative-list`/`.realtime-dm-section`/`.realtime-action-button` classes (base styling used by both the new player panel and the DM preview panel Task 3 mounts).
- [ ] Add tests to `tests/entry-ui.test.js` (additive; do not remove/alter any existing test): an approved player can reach `#play/<sessionId>` and the player panel becomes visible with rendered content; a pending/revoked/no-lobby visitor hitting `#play/<sessionId>` is redirected to `#lobby/<sessionId>` and the player panel is never created; entering `play` never sets `board.hidden = false` and never invokes `bootBoard` (assert the injected `bootBoard` spy's call count is unchanged); leaving the `play` route (navigating elsewhere) tears down the panel and the subscription (reuse the exact assertion style 8C.1 already added for the `board` route's own teardown — real `channel()`/`removeChannel()` calls through the fake Supabase client).
- [ ] Run `node --test tests/player-screen.test.js tests/entry-ui.test.js` — all green.
- [ ] Run `npm run check` and `npm run build` — full regression green.
- [ ] Commit: `feat: add player screen and play/<sessionId> route`.

### Task 3 — DM screen presentation toggle (depends on Task 1 only; no dependency on Task 2)

- [ ] Write failing test: `tests/dm-screen.test.js` (jsdom, detached container; a spy `apply` function) covering: `activate()` appends exactly one toggle button into `container`, idempotently; default mode is `'dm'` and `render(view)` calls `apply(view)` with the exact original view, never creating/showing a preview panel; `setPresentationMode('player')` then `render(view)` calls `apply(null)` (not the real view) and shows a preview panel containing `view`'s tokens/characters/initiative rendered via `presentationMode: 'player'` — asserted to contain **zero** `.realtime-dm-section` and **zero** manage-only buttons even though the `view` passed in has `dm` populated and `authority.canManage: true`; toggling back to `'dm'` calls `apply(view)` again and hides+clears the preview panel with no leftover nodes; `deactivate()` hides the toggle and preview panel and resets mode to `'dm'`; a **source-scan test** asserting `readFileSync('src/screens/dm-screen.js', 'utf8')` contains none of the strings `realtime/engine`, `supabaseAdapter`, `sessionLifecycle`, or `getSupabaseClient` (structural proof of Locked Rule C — mirrors this repo's existing `localStorage`-absence source-scan tests).
- [ ] Implement `src/screens/dm-screen.js` to make it pass, importing only `deriveDisplayView` and `renderBoardView` from Task 1's modules.
- [ ] Add `style.css` rules for `.dm-preview-panel` and `.dm-presentation-toggle` only (do not edit any rule Task 2 added).
- [ ] Run `node --test tests/dm-screen.test.js` — all green.
- [ ] Run `npm run check` — full regression green (this task never touches `app.js`, so no route-level regression is possible from it alone).
- [ ] Commit: `feat: add DM presentation toggle (dm-screen.js)`.

### Task 4 — Visibility QA (depends on Tasks 1–3 merged)

- [ ] Add new exported helpers to `tests/e2e/realtime-harness.js` (additive only — do not modify any existing export's behavior):
  - `openPlayerScreen(actor, sessionId)` — `await actor.page.goto(`/#play/${sessionId}`)`; `await expect(actor.page.locator('#playerBoardPanel')).toBeVisible()`.
  - `expectNoDmProjection(actor, selector = '#playerBoardPanel')` — asserts `actor.page.locator(`${selector} .realtime-dm-section`)` has count 0 and `actor.page.locator(`${selector} [data-realtime-action="advance-round"], ${selector} [data-realtime-action="toggle-token-visible"], ${selector} [data-realtime-action="clear-initiative"]`)` has count 0.
  - `togglePresentationMode(actor)` — clicks the DM's presentation-toggle button (`.dm-presentation-toggle`) and waits for `#dmPreviewPanel` visibility to flip.
  - `channelCount(actor)` — `actor.page.evaluate(async () => { const { getSupabaseClient } = await import('/src/supabase/client.js'); return getSupabaseClient().getChannels().length; })` (same technique `lifecycleState()` already uses for its own `channelCount` field).
- [ ] Write `tests/e2e/visibility.spec.js` with the following cases, reusing `createMultiplayerSession`, `submitAndApproveCharacter`-equivalent setup, and the new helpers above:
  1. DM opens the God Screen (`openDmRealtimeBoard`-equivalent navigation to `#board/<id>`) and sees management controls + DM section.
  2. DM toggles to Player View: DM-only DOM (`.realtime-dm-section`, manage buttons) disappears from the visible panel.
  3. Toggling produces **zero** new channel/hydration/write activity: capture `channelCount(dm)` and `dm.page.evaluate(...) → engine's getAppliedRevision()`-equivalent (via a small inline evaluate against `window.__aureRelicsQaRuntimes`-style access is not available for the *real* app singleton, so instead assert via Playwright network interception: `page.on('request', ...)` recording matches for `rest/v1/rpc/(get_session_snapshot|mutate_session)` or a websocket frame, armed immediately before the toggle click and asserted empty immediately after) before and after the toggle click — no new RPC/websocket activity attributable to the toggle.
  4. Toggling back to DM View restores management controls with no stale player-mode DOM left behind.
  5. Player A opens `play/<sessionId>` (via `openPlayerScreen`) and receives authorized live state (tokens/characters/initiative visible).
  6. Player A's DOM contains no DM projection data (`expectNoDmProjection`).
  7. DM changes public state (e.g. `toggle-token-visible`) and Player A's panel updates via the existing invalidation → hydrate flow, no reload.
  8. Player A performs a permitted own-character mutation (`adjust-own-hp`) and it reaches the DM and Player B.
  9. Player B reloads/reconnects and receives the correct current state (mirrors the existing `realtime.spec.js` reload assertion, via the real player route this time instead of `startProductionSession`).
  10. A revoked player (reusing the existing `'a revoked player...'` test's approve-then-revoke setup) loses board state with no stale-data flash: assert `#playerBoardPanel` becomes hidden/empty immediately, with no intermediate frame containing the pre-revocation token/character list (poll via `waitForFunction` checking the panel's `innerHTML` never re-contains the pre-revocation character name after the revoke action commits).
  11. Repeat cases 5, 6, 8, 10 at the existing narrow-viewport Chromium profile already configured in `playwright.config.js`.
- [ ] Run `npm run test:e2e -- tests/e2e/visibility.spec.js` — all green, both desktop and narrow profiles.
- [ ] Run the full existing suite: `npm run test:e2e` — the pre-existing three specs in `realtime.spec.js` remain green, unmodified.
- [ ] Write `docs/testing/issue-09-verification.md` (mirroring the structure of `docs/testing/issue-08c-verification.md`): scope, exact results table, files changed, known limitations (if any survive review), remaining work for Issue #10+ (if any).
- [ ] Commit: `test/docs: verify Issue 9 DM/player visibility`.

## Exact test commands

```
node --test tests/display-view.test.js tests/board-view-renderer.test.js   # Task 1
node --test tests/player-screen.test.js tests/entry-ui.test.js             # Task 2
node --test tests/dm-screen.test.js                                        # Task 3
npm.cmd run check                                                          # after every task
npm.cmd run build                                                          # after every task
npm.cmd run audit                                                          # before the final commit
npm.cmd run test:e2e -- tests/e2e/visibility.spec.js                       # Task 4
npm.cmd run test:e2e                                                       # Task 4, full regression
```

## Commit points

1. `feat: add display-mode projection and shared board renderer` (Task 1)
2. `feat: add DM presentation toggle (dm-screen.js)` (Task 3)
3. `feat: add player screen and play/<sessionId> route` (Task 2)
4. `test/docs: verify Issue 9 DM/player visibility` (Task 4)

## Post-review architecture amendment (corrective pass, branch `v09-09-review-fixes`)

Independent review of the original implementation (production tip `d5e89dd`, QA-verified in
`docs/testing/issue-09-verification.md`) found two Important defects, both root-caused against the
actual merged code before being treated as confirmed:

1. **DM "Preview as Player" was not actually a safe player-facing projection.** `deriveDisplayView`
   only ever nulled `view.dm` for `'player'` mode; every other field passed through unchanged. The
   DM's own manager-shaped `BoardView` (from `get_session_snapshot` as the campaign owner)
   legitimately contains hidden tokens, fog-hidden tokens, unapproved characters and initiative
   entries tied to those hidden tokens — `private.session_projection`'s `manager or (...)`
   conditions include all of that for a manager, by design, so the DM can manage it. Feeding that
   same object into `boardViewRenderer.renderBoardView` with `presentationMode: 'player'` rendered
   all of it, because the renderer only gates the *DM section* and *manage controls* on
   presentationMode/authority — it was never told to filter the underlying arrays at all.
2. **The preview was not structurally read-only.** `renderCharacterCard` rendered `adjust-own-hp`
   whenever `authority.ownCharacterId` matched a character, with no presentationMode gate at all.
   `wireRealtimeBoardActions` is bound on `document` (not scoped to a panel) and wires *any*
   `[data-realtime-action]` element using the original authoritative `BoardView`. In practice a
   DM's own `ownCharacterId` is normally `null`, so this was not a reachable production mutation —
   but the invariant "the preview can never mutate" was not structurally enforced, only true by
   incidental data shape.

**Superseded constraint:** the original plan's "no Supabase migration... Issue #9 is a pure
presentation/routing layer" (Global constraints, above) is explicitly superseded for this one,
narrow reason: a client-side filter cannot faithfully reconstruct the backend's fog-visibility and
campaign/session-approval predicates without duplicating (and risking drift from) logic that only
`private.session_projection` can evaluate correctly. Approximating it client-side (e.g.
`tokens.filter(t => t.isVisible)`) was considered and rejected — it cannot express fog-rect
visibility or approval-chain membership at all, so it would either over- or under-hide entities.

**Resolution:**

- `supabase/migrations/20260925103000_session_projection_public_visibility.sql` extends
  `private.session_projection` to stamp every token/character/initiative entry with an
  authoritative `publicVisible` boolean, computed with the exact predicates the function already
  used to decide whether a *non-manager* recipient may see that entity (token: session active +
  `is_visible` + `private.sync_rect_visible`; character: approved + approved session-player +
  approved campaign-member; initiative: its token's `publicVisible`). No predicate is duplicated
  inconsistently — each is copied verbatim from the function's own existing WHERE clauses. A real
  (non-manager) recipient's own array is unaffected in authorization shape: it already only ever
  contained publicly-visible tokens/approved characters (plus their own character via the existing
  own-character rule), so `publicVisible` is simply always `true` for every token they receive, and
  may legitimately be `false` for their own not-yet-approved character while it still appears via
  the unchanged own-character rule. The migration also force-refreshes every campaign's cached
  `private.session_sync` projection/revision (mirroring how the predecessor migration bootstrapped
  clocks before first publishing `session_events`), so the change-detection baseline is never left
  referencing the pre-migration shape.
- `src/board/displayView.js`'s `deriveDisplayView(view, 'player')` now branches on
  `view.authority?.canManage`: a real player-shaped view (`canManage: false`) is untouched beyond
  nulling `dm`, exactly as before — it is already the backend's authorized recipient projection.
  A manager-shaped view (`canManage: true`) is additionally reduced to only the entries whose
  `publicVisible` is `true` (tokens, characters, and initiative entries whose token survived), with
  `authority` still passed through by the same reference and the input never mutated. This makes
  the DM preview a **generic public player-facing projection**, not an impersonation of any one
  player — it never sets or infers an `ownCharacterId`.
- `src/board/boardViewRenderer.js` gained a second, independent `options.interactionMode`
  (`'interactive'`, the default, or `'readOnly'`). In `'readOnly'` mode the renderer emits **zero**
  `[data-realtime-action]` elements of any kind — manage controls and own-character HP controls
  alike — regardless of what `authority` contains. `authority` itself is never read, mutated, or
  re-derived for this decision; it is a rendering-only gate.
- `src/screens/dm-screen.js`'s preview panel now renders with `interactionMode: 'readOnly'`. The
  real Player Screen (`src/screens/player-screen.js`) renders `'interactive'` for a genuine
  player-shaped view (so own-character HP controls keep working) and `'readOnly'` for the edge case
  of a manager-shaped view reaching that route directly (e.g. a DM navigating straight to
  `play/<sessionId>`) — the same generic-public-projection treatment applies regardless of entry
  point.
- Structural proof: `tests/dm-screen.test.js` adds an integrated mutation-boundary test that wires
  the real, unmodified `wireRealtimeBoardActions` against the preview panel with an adversarial
  `authority: { canManage: true, ownCharacterId: <a real character id> }` view and a stub
  `engine.mutate` that throws if ever called, then dispatches click events on every element in the
  panel — proving no click path can reach `engine.mutate`, not merely that today's data shape
  happens not to trigger one.
- E2E: `tests/e2e/visibility.spec.js` adds a case proving an unapproved (non-public) character is
  absent from the preview while still visible in the DM's own management panel (achievable with the
  existing submit-without-approve flow — no new UI needed) and a case proving the preview panel
  contains zero `[data-realtime-action]` elements at all. A hidden-token/fog-blocked-token E2E case
  was **not** added: this app has no production UI or RPC path that creates a `public.tokens` row
  at all (unchanged scope carried over from Issue #8; adding one is out of scope for this
  corrective pass and would be Issue #10 UI). That case is instead covered at the
  backend/integration level by `supabase/tests/database/05_public_visibility.test.sql`, per this
  plan's own allowance for exactly this situation.

## Acceptance criteria

- An approved player can open `play/<sessionId>` and see live tokens, public character info, initiative, round number, and their own permitted character controls — with zero account required, matching how `lobby/<sessionId>` already works today.
- No test, and no manual DOM inspection, finds `.realtime-dm-section`, a manage-only `[data-realtime-action]` button, or any `dm`-shaped data anywhere under `#playerBoardPanel`.
- The DM can toggle DM View ⇄ Player View on the God Screen with a single click, with no additional network request, websocket frame, hydrate, or mutation attributable to the toggle, and no authority change of any kind.
- A stale-approved-but-backend-revoked player's board view clears with no flash of previously-visible content, via the existing (unmodified) `engine.js`/`sessionLifecycle.js` denial path.
- `script.js` has zero diff against `origin/main`.
- No Supabase migration, RLS policy, or RPC has any diff against `origin/main`.
- `npm run check`, `npm run build`, `npm run audit`, and the full `npm run test:e2e` suite (existing specs + the new `visibility.spec.js`, both viewport profiles) all pass.
- `docs/testing/issue-09-verification.md` exists with real, executed results (not projected/assumed results).
