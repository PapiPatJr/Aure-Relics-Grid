# Issue #9 — Task 1: display projection + shared board renderer

## Branch/base

Branch `v09-09-dm-player-visibility`, based on `origin/main` at `98ad3722f3cc2c8fcaf4b6337d41dd07aada4579`. Verify before starting: `git fetch origin && git rev-parse origin/main` must equal that hash, and your working tree must be based on it (not on any pre-merge 8C/8D/8E branch). If it does not match, stop and report the mismatch rather than proceeding.

Read first, do not modify:
- `docs/superpowers/plans/2026-09-24-issue-09-dm-player-visibility.md` — the full plan; this prompt is Task 1 of it. Read the whole plan, not just this section, so you understand why the interfaces below are shaped this way (in particular the "one deliberate deviation" note explaining why `script.js` is never touched by this Issue).
- `src/realtime/boardBridge.js` — the `BoardView` shape you are transforming/rendering. Do not re-derive its logic; import and reuse its exported JSDoc `@typedef` conceptually (this task has no runtime dependency on `boardBridge.js`, only a shape dependency).
- `script.js` lines 2605–2778 — the existing DM-side renderer you are **not** modifying, but whose exact CSS class names and `data-realtime-action`/`data-token-id`/`data-character-id`/`data-delta` dataset attributes you must reproduce exactly, so `src/realtime/boardActions.js` (unmodified, bound on `document` by default) wires up buttons you render without any further work.
- `tests/realtime-board-bridge.test.js` lines 100–230 — the existing jsdom test pattern for this codebase's DOM-touching tests, for style reference only (you are not editing this file).

## Owned files (you may create/edit these and only these)

- `src/board/displayView.js` (new)
- `src/board/boardViewRenderer.js` (new)
- `tests/display-view.test.js` (new)
- `tests/board-view-renderer.test.js` (new)

## Forbidden files

Do not create, edit, or even inspect-with-intent-to-edit: `src/entry/app.js`, `src/screens/**`, `script.js`, anything under `supabase/**`, `style.css`. If you find yourself needing to touch any of these, stop — that means the interface below is wrong, and you should report the mismatch rather than expanding your own scope.

## Allowed interfaces (exact — implement to this, do not redesign)

```js
// src/board/displayView.js
/**
 * @param {object|null} view A BoardView from src/realtime/boardBridge.js's createBoardView, or null.
 * @param {'dm'|'player'} presentationMode
 * @returns {object|null}
 */
export function deriveDisplayView(view, presentationMode) { }
```
Contract:
- `presentationMode === 'dm'`: return `view` unchanged, by reference (`===`). Do not clone.
- `presentationMode === 'player'`: return a new object equal to `view` except `dm` is `null`. `authority` must be the exact same reference as `view.authority` — never cloned, never mutated, never re-derived. Nothing else about `view` is altered.
- `view === null`: return `null`.
- Any other `presentationMode` value: throw an `Error`.
- The input `view` object itself must never be mutated. Prove this in your tests with `Object.freeze(view)` before calling — the function must not throw and the original object's properties must be unchanged afterward.

```js
// src/board/boardViewRenderer.js
/**
 * @param {HTMLElement} container Caller-owned. Only ever set container.hidden and replace its children.
 * @param {object|null} displayView Already the *output* of deriveDisplayView — this function does
 *   not call deriveDisplayView itself.
 * @param {{ presentationMode: 'dm'|'player' }} options
 */
export function renderBoardView(container, displayView, options) { }
```
Contract:
- `displayView == null`: set `container.hidden = true` and clear its children (`container.innerHTML = ''` or equivalent). Mirrors `script.js`'s `applyRealtimeSnapshot(null)` exactly.
- Otherwise: `container.hidden = false`, clear then rebuild children from `displayView.roundNumber`/`.tokens`/`.characters`/`.initiative`/`.authority`/`.dm`.
- Manage-only controls — a button with `data-realtime-action="advance-round"`, one per visible token with `data-realtime-action="toggle-token-visible"` + `data-token-id="<id>"`, and a button with `data-realtime-action="clear-initiative"` — render **only** when `options.presentationMode === 'dm'` **and** `displayView.authority?.canManage` is truthy. Both conditions are required; neither one alone is sufficient. This is intentionally stricter than `script.js`'s own renderer (which only checks `authority.canManage`) — the extra `presentationMode` check is the mechanism that makes the DM's "preview as player" mode hide these controls without touching `authority` at all.
- A section with class `realtime-dm-section` and `aria-label="DM-only projection"` renders **only** when `options.presentationMode === 'dm'` **and** `displayView.dm` is truthy. Same double-condition reasoning.
- Own-character HP controls (`data-realtime-action="adjust-own-hp"` with `data-character-id` and `data-delta="-1"`/`"1"`) render whenever `displayView.authority?.ownCharacterId === character.id`, for **any** `presentationMode` — this is the player's own legitimate action and is not DM-only, so it must not be gated by mode.
- Reuse these exact class names, verbatim, from `script.js`'s existing renderer (do not invent new ones): `realtime-token-list`, `realtime-token-row`, `realtime-token-label`, `realtime-token-kind`, `realtime-token-condition`, `realtime-character-list`, `realtime-character-card`, `realtime-character-statuses`, `realtime-character-hp-controls`, `realtime-initiative-list`, `realtime-initiative-row`, `active-combatant`, `realtime-action-button`.
- Text content only ever via `.textContent` (never `innerHTML` with interpolated data) — matching the `escapeHtml` discipline used everywhere else in this codebase's rendering code.

## Tests required (write these first; they must fail before you implement, then pass after)

`tests/display-view.test.js` (plain `node --test`, no DOM needed):
1. `deriveDisplayView(view, 'dm')` returns the exact same reference as `view`.
2. `deriveDisplayView(view, 'player')` returns `dm: null` for a `view` where `dm` was a populated object.
3. `deriveDisplayView(view, 'player').authority === view.authority` (reference equality, not deep equality).
4. `deriveDisplayView(view, 'player')` on an already-player-shaped view (`dm: null` already) is a safe no-op producing an equivalent object.
5. `deriveDisplayView(null, 'player')` returns `null`.
6. `deriveDisplayView(view, 'nonsense')` throws.
7. `Object.freeze(view); deriveDisplayView(view, 'player')` does not throw and `view.dm`/`view.authority` are unchanged after the call.

`tests/board-view-renderer.test.js` (jsdom — `import { JSDOM } from 'jsdom'; const dom = new JSDOM('<!doctype html><div id="root"></div>'); const container = dom.window.document.getElementById('root');`):
1. `renderBoardView(container, null, { presentationMode: 'player' })` → `container.hidden === true`, no children.
2. A player-shaped `displayView` (`authority: { canManage: false, ownCharacterId: null }, dm: null`) with one token/character/initiative entry renders visible rows for each, and zero manage buttons, and zero `.realtime-dm-section`.
3. **The critical defense-in-depth case**: a DM-shaped `displayView` (`authority: { canManage: true, ownCharacterId: null }, dm: { tokenDetails: [], notes: [], activity: [] }`) rendered with `presentationMode: 'player'` still produces **zero** manage buttons and **zero** `.realtime-dm-section`. Assert this with `container.querySelector('[data-realtime-action="advance-round"]') === null` etc., and `container.querySelector('.realtime-dm-section') === null` — not by checking `hidden`.
4. The exact same DM-shaped `displayView` rendered with `presentationMode: 'dm'` produces the manage buttons and the DM section.
5. Own-character HP controls render only for the character whose `id` matches `authority.ownCharacterId`, in both `'dm'` and `'player'` mode.
6. Calling `renderBoardView` twice with two different views fully replaces the DOM — no node from the first render survives into the second (assert e.g. a first-render-only token id's row is absent after the second render).

## Completion report format

When done, report:
1. Files created (exact paths).
2. Test file contents summary: number of test cases per file, and confirmation each failed before implementation and passes after.
3. Exact commands run and their output tail: `node --test tests/display-view.test.js tests/board-view-renderer.test.js`, then `npm.cmd run check`.
4. Confirmation that `npm run check`'s total test count increased by exactly the number of new tests you added, with no other file's test count changed (proof of zero regression and zero incidental edits elsewhere).
5. Any deviation from the interfaces specified above, with rationale — do not silently deviate.

## STOP condition

Stop and report (do not proceed further, do not start Task 2/3/4, do not touch `src/entry/app.js` or `src/screens/**` under any circumstance) once:
- Both new test files pass.
- `npm run check` passes with the expected increased test count and no other regressions.
- You have committed exactly one commit: `feat: add display-mode projection and shared board renderer`.

Do not start Issue #10 work. Do not implement anything beyond these two modules and their tests.
