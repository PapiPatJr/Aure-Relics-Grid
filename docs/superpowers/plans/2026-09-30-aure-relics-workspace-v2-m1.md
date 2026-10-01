# Aure Relics Workspace V2 Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first isolated Aure Relics Workspace V2 proof: a professional board-first canvas with smooth camera controls, top-bar workspace chrome, reusable dockable/floating panels, a movable radial quick-tool menu, and existing realtime `BoardView` token rendering without touching the current playable version.

**Architecture:** Keep the existing Supabase/auth/realtime/security stack intact and add a separate V2 browser entry that never imports the legacy `script.js`. V2 consumes the existing normalized `BoardView`, renders through Konva using one shared world camera, and keeps all workspace layout/camera state local to the client. Milestone 1 proves the new presentation architecture only; session readiness, Character/Ally identity, and full tool ports remain separate Milestone 2/3 plans.

**Tech Stack:** Vite, plain JavaScript ES modules, Supabase JS 2.116.0, Konva 10.7.0, Node test runner, JSDOM, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-aure-relics-workspace-v2-design.md`

## Global Constraints

- Work only on branch `v2-workspace`, based on `832877d6d881cc0db536a931efba0e98d8486217`.
- Recommended local clone: `C:\Users\patlo\Desktop\Aure Relics\aure-relics-v2`.
- Do not modify the current live checkout, `main`, the current release branch, production Netlify, or hosted production Supabase.
- Keep V2 in Vite + plain JavaScript; do not migrate to React.
- Add only `konva@10.7.0` as the Milestone 1 product dependency.
- V2 must not import or boot root-level `script.js`.
- Existing `BoardView` remains the rendering boundary for synchronized session state.
- Camera state and panel/workspace layout remain local presentation state.
- All board layers share exactly one world camera transform.
- No full terrain authoring rewrite, full fog authoring port, initiative port, session-start flow, Character/Ally token work, or production deployment in Milestone 1.
- Use `npm.cmd` / `npx.cmd` on Windows, not PowerShell shim scripts.
- Detailed command output should go to `%TEMP%` log files; terminal summaries should stay concise.

## Review Focus

1. **Unexpected viewport sizes / orientation changes:** resize must preserve world coordinates and keep the canvas usable rather than clipping or resetting state. Covered in Tasks 2, 4, and 8.
2. **Zoom extremes / malformed camera values:** camera math must clamp zoom to `0.25..3` and never emit `NaN`/`Infinity`. Covered in Task 2.
3. **Pointer-mode collisions:** wheel zoom, middle-drag, Space+drag, touch pinch, and active tool interaction must not all fire for the same gesture. Covered in Task 4.
4. **Panel overflow on narrow screens:** a docked desktop panel must degrade to an overlay/sheet rather than permanently crushing the board. Covered in Tasks 5 and 8.
5. **Security projection drift:** V2 rendering must not read raw Supabase rows or `view.dm` secrets when rendering player-visible state. Covered in Tasks 6 and 7.

---

## File Structure Locked for Milestone 1

Create:

- `v2.html` — isolated V2 browser entry.
- `vite.config.js` — multi-page Vite build input for current app + V2.
- `src/workspace-v2/main.js` — V2 startup and route selection.
- `src/workspace-v2/workspace.css` — board-first responsive shell styling.
- `src/workspace-v2/camera.js` — pure camera/world-screen math.
- `src/workspace-v2/sceneModel.js` — layer names/order and BoardView-to-scene projection.
- `src/workspace-v2/stage.js` — Konva Stage/layer lifecycle and scene renderer.
- `src/workspace-v2/cameraControls.js` — mouse/trackpad/touch camera gesture wiring.
- `src/workspace-v2/panelManager.js` — pure panel-state model.
- `src/workspace-v2/workspaceChrome.js` — top bar + panel host DOM.
- `src/workspace-v2/radialMenu.js` — movable/collapsible quick-tool control.
- `src/workspace-v2/realtimeWorkspace.js` — existing realtime engine/lifecycle adapter for V2.
- `tests/workspace-v2-camera.test.js`
- `tests/workspace-v2-scene.test.js`
- `tests/workspace-v2-panels.test.js`
- `tests/workspace-v2-radial.test.js`
- `tests/workspace-v2-realtime.test.js`
- `tests/e2e/workspace-v2.spec.js`

Modify:

- `package.json` — add Konva and focused V2 scripts.
- `package-lock.json` — dependency lock update.

Do not modify in Milestone 1 unless a test proves integration requires it:

- `index.html`
- `script.js`
- `src/main.js`
- `src/entry/app.js`
- Supabase migrations
- production configuration

---

### Task 1: Isolated V2 Entry and Build Boundary

**Files:**
- Create: `v2.html`
- Create: `vite.config.js`
- Create: `src/workspace-v2/main.js`
- Create: `src/workspace-v2/workspace.css`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/workspace-v2-bootstrap.test.js`

**Interfaces:**
- Produces: `startWorkspaceV2()` exported from `src/workspace-v2/main.js`.
- V2 route forms: `v2.html#demo` and `v2.html#session/<uuid>`.
- `#demo` requires no Supabase config; `#session/<uuid>` requires the existing Supabase client.

- [ ] **Step 1: Write the failing bootstrap test**

Assert that importing the V2 bootstrap does not import or execute `bootLegacyPrototype`, and that route parsing returns `{ mode: 'demo' }` for `#demo` and `{ mode: 'session', sessionId }` for `#session/<uuid>`.

- [ ] **Step 2: Run the focused bootstrap test and confirm failure**

Run with output redirected to `%TEMP%\aure-v2-task1.log`.

Expected summary: `FAIL: V2 bootstrap not implemented`.

- [ ] **Step 3: Add `konva@10.7.0`, `v2.html`, and multi-page Vite config**

`vite.config.js` must build both `index.html` and `v2.html`. `v2.html` imports only `src/workspace-v2/main.js` and V2 CSS.

- [ ] **Step 4: Implement `parseWorkspaceRoute(hash)` and `startWorkspaceV2()`**

`startWorkspaceV2()` must mount into `#workspaceV2`, never reference `#legacyBoard`, and never import `script.js`.

- [ ] **Step 5: Run focused test, then production build**

Expected: focused test PASS; build contains both `dist/index.html` and `dist/v2.html`.

- [ ] **Step 6: Commit**

Commit message: `feat(v2): add isolated workspace entry`

---

### Task 2: Pure Camera Model and Coordinate Math

**Files:**
- Create: `src/workspace-v2/camera.js`
- Create: `tests/workspace-v2-camera.test.js`

**Interfaces:**
- Produces:
  - `createCamera({ x = 0, y = 0, zoom = 1, minZoom = 0.25, maxZoom = 3 })`
  - `worldToScreen(point, camera)`
  - `screenToWorld(point, camera)`
  - `panBy(camera, delta)`
  - `zoomAt(camera, screenPoint, nextZoom)`
  - `fitBounds(camera, bounds, viewport, padding = 48)`
  - `clampCamera(camera)`
- Camera object shape: `{ x, y, zoom, minZoom, maxZoom }`.

- [ ] **Step 1: Write failing camera tests**

Cover inverse world/screen conversion, cursor-anchor preservation during zoom, pan deltas, fit-bounds centering, zoom clamping at `0.25` and `3`, and rejection/sanitization of non-finite camera inputs.

- [ ] **Step 2: Run focused tests and confirm failure**

Expected summary: `FAIL: camera module not implemented`.

- [ ] **Step 3: Implement the pure camera functions**

No DOM, Konva, Supabase, or global state in this module.

- [ ] **Step 4: Run focused tests**

Expected: all camera tests PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(v2): add world camera model`

---

### Task 3: Konva Stage, Layer Stack, and Grid

**Files:**
- Create: `src/workspace-v2/sceneModel.js`
- Create: `src/workspace-v2/stage.js`
- Create: `tests/workspace-v2-scene.test.js`
- Modify: `src/workspace-v2/main.js`
- Modify: `src/workspace-v2/workspace.css`

**Interfaces:**
- `SCENE_LAYER_ORDER` must be exactly:
  `background, grid, terrain, structure, difficultTerrain, hazard, trap, token, fog, measurement, interaction`.
- Produces:
  - `createSceneModel(view)`
  - `createWorkspaceStage({ container, width, height, cellSize = 64, gridWidth = 40, gridHeight = 40, camera })`
  - stage controller methods: `setCamera(camera)`, `resize(width, height)`, `render(scene)`, `destroy()`.

- [ ] **Step 1: Write failing scene-model tests**

Assert exact layer order, stable grid dimensions, token normalization, and that `createSceneModel` does not copy arbitrary `view.dm` properties into the render model.

- [ ] **Step 2: Run focused test and confirm failure**

- [ ] **Step 3: Implement scene model and Konva Stage**

Create all 11 Konva layers up front. Non-interactive presentation layers should use `listening: false` where appropriate. Render a large grid using world coordinates, not individual DOM cells.

- [ ] **Step 4: Mount demo stage in `#demo` mode**

The demo must show a 40x40 grid and at least two sample tokens solely for visual/manual verification.

- [ ] **Step 5: Run scene tests and build**

Expected: PASS; no legacy board boot on `/v2.html#demo`.

- [ ] **Step 6: Commit**

Commit message: `feat(v2): add layered Konva stage`

---

### Task 4: Professional Camera Interaction Controls

**Files:**
- Create: `src/workspace-v2/cameraControls.js`
- Modify: `src/workspace-v2/main.js`
- Modify: `src/workspace-v2/workspace.css`
- Test: `tests/e2e/workspace-v2.spec.js`

**Interfaces:**
- Produces: `attachCameraControls({ element, getCamera, setCamera, screenToWorld, options }) -> cleanup`.
- Gesture contract:
  - wheel: cursor-centered zoom
  - middle mouse drag: pan
  - Space + left drag: pan
  - explicit Hand tool mode: one-pointer pan
  - touch: two-pointer pan/pinch
  - one-finger touch remains available to active board tools
- Zoom range remains `0.25..3`.

- [ ] **Step 1: Add failing Playwright camera tests**

Test wheel zoom anchor, middle-drag pan, Space+drag pan, `100%`, `Fit`, resize stability, and that a normal left click does not pan when Hand mode is off.

- [ ] **Step 2: Run only the V2 E2E file and confirm failure**

- [ ] **Step 3: Implement gesture arbitration and camera controls**

Use Pointer Events where possible. Track active pointers explicitly so pinch gestures do not also trigger one-finger tool actions.

- [ ] **Step 4: Add compact viewport controls**

Render `−`, zoom percentage, `+`, `Fit`, and Hand/Pan in the workspace shell. `100%` restores zoom to `1` while preserving viewport center.

- [ ] **Step 5: Run focused E2E**

Expected: all camera interaction scenarios PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(v2): add canvas zoom and pan controls`

---

### Task 5: Top Bar and Unified Panel Manager

**Files:**
- Create: `src/workspace-v2/panelManager.js`
- Create: `src/workspace-v2/workspaceChrome.js`
- Create: `tests/workspace-v2-panels.test.js`
- Modify: `src/workspace-v2/main.js`
- Modify: `src/workspace-v2/workspace.css`

**Interfaces:**
- Top bar labels: `Party`, `Encounter`, `Tokens`, `Terrain`, `Map`, `Fog`, `Measure`, `Notes`, `Session`, `View`.
- Panel modes: `dropdown | dock-left | dock-right | floating | minimized | closed`.
- Produces:
  - `createPanelManager(initialPanels = [])`
  - methods `open(id)`, `dock(id, side)`, `float(id, position)`, `minimize(id)`, `close(id)`, `getState()`.
  - `mountWorkspaceChrome({ root, panelManager, onToolSelect })`.

- [ ] **Step 1: Write failing panel-state tests**

Assert mode transitions, one active dropdown at a time, dock-left/right exclusivity per panel, floating position retention, minimize/restore behavior, and safe handling of unknown panel ids.

- [ ] **Step 2: Run focused tests and confirm failure**

- [ ] **Step 3: Implement pure panel manager**

Do not put DOM state inside the state machine.

- [ ] **Step 4: Implement top bar and one real reusable panel shell**

Use `Fog` as the first sample tool panel. The panel body can contain placeholder controls for Milestone 1, but every shell action must work: dropdown, dock left, dock right, float, minimize, close.

- [ ] **Step 5: Add E2E assertions for panel behavior**

Test that docking does not remove canvas access and closing returns board space.

- [ ] **Step 6: Commit**

Commit message: `feat(v2): add adaptive workspace panels`

---

### Task 6: Movable Radial Quick-Tool Menu

**Files:**
- Create: `src/workspace-v2/radialMenu.js`
- Create: `tests/workspace-v2-radial.test.js`
- Modify: `src/workspace-v2/main.js`
- Modify: `src/workspace-v2/workspace.css`

**Interfaces:**
- Initial tools: `select`, `token`, `fog`, `measure`, `pan`.
- Produces: `mountRadialMenu({ root, tools, activeTool, onSelect })` with methods `collapse()`, `expand()`, `setPosition({ x, y })`, `destroy()`.

- [ ] **Step 1: Write failing radial-menu tests**

Assert expand/collapse, tool selection callback, draggable position clamping inside viewport, touch/pointer compatibility, and preservation of position after collapse/expand.

- [ ] **Step 2: Run focused tests and confirm failure**

- [ ] **Step 3: Implement the radial menu**

Dragging the center moves the menu. Clicking/tapping the center toggles collapse. Tool wedges change the active tool but do not mutate shared session state.

- [ ] **Step 4: Add Playwright smoke assertions**

Verify drag, collapse, expand, and Pan tool activation.

- [ ] **Step 5: Commit**

Commit message: `feat(v2): add movable quick-tool menu`

---

### Task 7: Existing BoardView and Realtime Session Integration

**Files:**
- Create: `src/workspace-v2/realtimeWorkspace.js`
- Create: `tests/workspace-v2-realtime.test.js`
- Modify: `src/workspace-v2/main.js`
- Modify: `src/workspace-v2/sceneModel.js`
- Modify: `src/workspace-v2/stage.js`
- Test: `tests/e2e/workspace-v2.spec.js`

**Interfaces:**
- Reuse without changing contracts:
  - `createSyncEngine(createSupabaseSyncAdapter(client))`
  - `createSessionLifecycle(engine, callbacks)`
  - `reconcileBoardView(previousView, snapshot)`
- Produces: `mountRealtimeWorkspace({ client, sessionId, onView, onStatus, onError }) -> { stop() }`.
- V2 rendering consumes only the resulting `BoardView`, never raw table queries.

- [ ] **Step 1: Write failing realtime adapter tests**

Use the existing fake adapter patterns to prove snapshot -> `BoardView` -> scene render, replacement semantics on newer revisions, no update on stale revisions, and cleanup stops subscriptions.

- [ ] **Step 2: Add security/projection assertions**

Assert that scene rendering does not inspect `view.dm` to reconstruct player-hidden tokens. A player-shaped BoardView containing no secret token must produce no secret render node.

- [ ] **Step 3: Implement realtime workspace adapter**

Do not duplicate engine/lifecycle behavior. V2 subscribes through the existing modules and forwards reconciled BoardView to the stage renderer.

- [ ] **Step 4: Wire `v2.html#session/<uuid>`**

Require existing authenticated session access. Unauthorized/denied status renders a V2 access-denied state and clears the scene.

- [ ] **Step 5: Add focused local-stack E2E**

Create one test session through existing fixtures, open V2 as the DM, create/move one token through existing authorized commands, and verify the V2 token updates without page reload.

- [ ] **Step 6: Commit**

Commit message: `feat(v2): render realtime BoardView on canvas`

---

### Task 8: Responsive Workspace and Milestone 1 Gate

**Files:**
- Modify: `src/workspace-v2/workspace.css`
- Modify: `src/workspace-v2/workspaceChrome.js`
- Modify: `src/workspace-v2/stage.js`
- Modify: `tests/e2e/workspace-v2.spec.js`
- Modify: `package.json`

**Interfaces:**
- Add scripts:
  - `test:v2`: focused Node tests for `tests/workspace-v2-*.test.js`
  - `test:e2e:v2`: Playwright V2 spec only

- [ ] **Step 1: Add failing responsive E2E cases**

Viewport set:
- 1440x900 desktop
- 1024x768 landscape tablet
- 768x1024 portrait tablet
- 844x390 phone landscape
- 390x844 phone portrait

Assert no horizontal document overflow, canvas remains visible, desktop docks degrade to overlay/sheet on constrained widths, and orientation resize preserves a known token's world position.

- [ ] **Step 2: Implement responsive workspace rules**

Do not shrink desktop side docks indefinitely. On constrained widths, render panels as overlay/sheet surfaces over the canvas. Keep the top bar compact and allow overflow grouping without hiding essential camera controls.

- [ ] **Step 3: Run focused V2 unit tests**

Redirect full output to `%TEMP%\aure-v2-unit.log`.

Expected terminal summary: `PASS: V2 focused unit gate`.

- [ ] **Step 4: Run focused V2 Playwright**

Redirect full output to `%TEMP%\aure-v2-e2e.log`.

Expected terminal summary: `PASS: V2 browser gate`.

- [ ] **Step 5: Run existing project check and production build once at milestone boundary**

Redirect to `%TEMP%\aure-v2-check.log` and `%TEMP%\aure-v2-build.log`.

Expected terminal summary: `PASS: V2 Milestone 1 gate`.

Do **not** run the full legacy 47-test Playwright suite as part of routine Task 8 unless a V2 change touched legacy runtime files unexpectedly.

- [ ] **Step 6: Audit isolation**

Confirm no diff in `script.js`, `src/main.js`, `src/entry/app.js`, Supabase migrations, Netlify configuration, or production environment files.

- [ ] **Step 7: Commit**

Commit message: `feat(v2): complete workspace canvas proof`

---

## Milestone 1 Manual Acceptance Checklist

Before Milestone 2 planning begins, manually verify in the clean V2 clone:

- `/v2.html#demo` opens without loading the legacy board.
- Grid fills the workspace and feels like a canvas, not a fixed webpage.
- Wheel zoom is smooth and cursor-centered.
- Middle drag and Space+drag pan correctly.
- `−`, `100%`, `+`, and `Fit` work.
- Touch/pinch is usable on at least one real touch device.
- Top bar has no permanent left/right rails.
- Fog sample panel can dropdown, dock left, dock right, float, minimize, and close.
- Radial menu moves and collapses.
- A real authorized session can render a synchronized token through existing BoardView/realtime state.
- Desktop, tablet portrait/landscape, and phone portrait/landscape remain usable.
- Existing playable version remains untouched.

## Explicitly Deferred to Milestone 2

- Player Ready / Not Ready
- DM Start Session
- lobby -> live board orchestration
- Session Player -> Character -> Character Token binding
- generic Player UI replacement with Character
- real `ally` token kind and Ally authoring
- token placement state in Party panel

## Explicitly Deferred to Milestone 3

- full Fog panel port
- full Terrain authoring port
- Initiative panel port
- Map/scene controls
- DM notes/history
- full token inspector/combat actions
- workspace presets persistence
- Sync View / Focus Party
- undo/redo

## Execution Recommendation

Use **Native/sequential execution for Milestone 1**, with one task implemented at a time and an independent whole-milestone review before promotion. The tasks build directly on each other's interfaces, the branch is isolated, and the current live table is protected, so sequential execution is the fastest route without sacrificing review discipline.
