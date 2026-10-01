# Aure Relics V2 Milestone 2: Relic Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Aure Relics visual identity to the proven Workspace V2 shell, improve canvas/token presentation, and fix radial-menu edge clipping without changing multiplayer/backend behavior.

**Architecture:** Preserve the Milestone 1 interaction model and branch isolation. This milestone changes presentation and one localized radial-clamping behavior only. Work is split into non-overlapping worker packages so Claude/Copilot can do most implementation, deterministic tests do routine verification, and Codex is reserved for escalation.

**Tech Stack:** Vite, plain JavaScript ES modules, Konva 10.7.0, Node test runner, JSDOM, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-aure-relics-v2-relic-workspace-design.md`

## Global Constraints

- Work only on branch `v2-workspace` in `C:\Users\patlo\Desktop\Aure Relics\aure-relics-v2`.
- Start from the current remote `v2-workspace` head after synchronizing the local clone with `git pull --ff-only origin v2-workspace`.
- Do not modify `main`, the legacy/live checkout, production Netlify, hosted production Supabase, migrations, auth policy, realtime authority, or session lifecycle behavior.
- Do not add dependencies unless explicitly approved.
- Keep Vite + plain JavaScript + Konva.
- Preserve top-bar information architecture, panel modes, camera behavior, responsive behavior, and the board-first layout already accepted on desktop, Surface/tablet, and phone.
- Use `npm.cmd` / `npx.cmd` on Windows.
- Redirect detailed verification output to `%TEMP%` logs and print one concise PASS/FAIL terminal line.
- Do not let two workers edit the same file concurrently.
- No production deployment. Staging deployment occurs only after the milestone gate and explicit approval.

## Review Focus

1. **Narrow/mobile layouts:** visual polish must not make the command bar, sheets, camera controls, or radial menu collide or shrink the board into unusability. Covered in Tasks 1, 3, and 4.
2. **Radial menu at every edge/corner:** the expanded tool footprint must remain visible, not merely the center button. Covered in Task 3.
3. **Interaction regression from styling:** panel dock/float/minimize/close, zoom, pan, Hand mode, and tool selection must behave exactly as before. Covered in Tasks 1, 3, and 4.
4. **Token contrast at different zoom levels:** Character/player, NPC, Enemy, and Boss placeholders must remain distinguishable and readable without professional art. Covered in Task 2.
5. **Backend/production isolation drift:** visual workers must not touch Supabase/realtime/auth/migrations/legacy entry points or deployment configuration. Covered by every task and the final protected-file audit.

---

## File Ownership and Worker Order

Execute in this exact order. Do not start the next package until the previous package is committed and its focused verification passes.

1. **Worker 2A, Visual Foundation**
   - Owns: `src/workspace-v2/workspace.css`, narrow structural hooks in `src/workspace-v2/workspaceChrome.js`, and any focused panel/E2E assertions needed for those hooks.
   - Must not edit `stage.js` or `radialMenu.js`.
2. **Worker 2B, Canvas and Token Presentation**
   - Owns: `src/workspace-v2/stage.js` and focused scene/E2E assertions for canvas/token presentation.
   - Must not edit `workspace.css`, `workspaceChrome.js`, or `radialMenu.js` unless the lead explicitly reassigns ownership.
3. **Worker 2C, Radial Edge Safety**
   - Owns: `src/workspace-v2/radialMenu.js` and `tests/workspace-v2-radial.test.js`; may add a narrow E2E assertion in `tests/e2e/workspace-v2.spec.js` only after confirming no uncommitted edits from another worker.
   - Must not edit `workspace.css`.
4. **Automated Gate**
   - No AI interpretation unless a command fails.
5. **Independent Review**
   - CodeRabbit first. A fresh-context reviewer may be used if CodeRabbit findings are incomplete or ambiguous.
6. **Repair**
   - Return simple findings to the worker who owns the affected file. Escalate to Codex only for non-obvious regressions, architecture-sensitive defects, or failing tests the owning worker cannot resolve efficiently.
7. **Final Gate and Staging**
   - Run the full Milestone 2 verification gate. Deploy only to `aure-relics-v2-staging` after explicit approval.

---

### Task 1: Worker 2A, Aure Relics Visual Foundation

**Files:**
- Modify: `src/workspace-v2/workspace.css`
- Modify only if needed for styling hooks: `src/workspace-v2/workspaceChrome.js`
- Test/verify: `tests/workspace-v2-panels.test.js`
- Test/verify: `tests/e2e/workspace-v2.spec.js`

**Interfaces:**
- Existing class names and panel-state attributes remain stable.
- Existing top-bar labels remain exactly: `Party`, `Encounter`, `Tokens`, `Terrain`, `Map`, `Fog`, `Measure`, `Notes`, `Session`, `View`.
- Existing panel actions remain dock-left, dock-right, float, minimize, close.

- [ ] **Step 1: Record the baseline focused tests**
  Run `npm.cmd run test:v2` and the Workspace V2 Playwright spec with output redirected to `%TEMP%` logs. Confirm the current baseline passes before editing.

- [ ] **Step 2: Implement reusable Aure Relics CSS tokens**
  Add CSS custom properties for void/stone surfaces, raised/inset panels, bronze/gold accents, text hierarchy, arcane/selection, ally/success, danger/enemy, boss, focus, shadows, radii, and transition timing. Replace repeated literal UI colors where practical without broad unrelated refactoring.

- [ ] **Step 3: Restyle the top bar and panel system without changing layout behavior**
  Apply the approved dark relic-workbench treatment. Keep the top bar height at 52px. Preserve horizontal overflow, mobile behavior, panel modes, touch targets, ARIA semantics, and keyboard focus visibility.

- [ ] **Step 4: Restyle camera controls and radial-menu surfaces in CSS only**
  Make controls visually coherent and Aure Relics themed, but do not change radial positioning logic in this task.

- [ ] **Step 5: Add reduced-motion handling and supported scrollbar/form-control polish**
  Nonessential transitions must honor `prefers-reduced-motion`.

- [ ] **Step 6: Run focused tests and build**
  Required: `npm.cmd run test:v2`, `npm.cmd run test:e2e:v2`, `npm.cmd run build`.
  Expected: PASS with no behavior regression.

- [ ] **Step 7: Commit**
  Commit message: `style(v2): forge Aure Relics workspace identity`

**Worker 2A acceptance:** visual identity is clearly Aure Relics, the board remains dominant, controls remain readable/touch-friendly, and no backend/gameplay files changed.

---

### Task 2: Worker 2B, Canvas and Token Presentation

**Files:**
- Modify: `src/workspace-v2/stage.js`
- Test/verify: `tests/workspace-v2-scene.test.js`
- Test/verify: `tests/e2e/workspace-v2.spec.js` only if a new behavioral assertion is required and the file is clean before editing.

**Interfaces:**
- Keep `createWorkspaceStage({ container, width, height, cellSize, gridWidth, gridHeight, camera })` unchanged.
- Keep stage controller methods unchanged: `setCamera`, `resize`, `render`, `destroy`.
- Current backend `player` kind renders visually as Character for compatibility in Milestone 2.
- No backend taxonomy migration.

- [ ] **Step 1: Verify current scene tests pass before editing**
  Run the focused scene test and record the baseline.

- [ ] **Step 2: Improve the empty-board presentation with Konva primitives only**
  Use a dark intentional board base, subtle boundary treatment, restrained depth/vignette, quieter minor grid lines, and clearer five-cell major intervals. Do not add large image assets.

- [ ] **Step 3: Improve placeholder token rendering**
  Implement visually distinct role treatment for current kinds: `player` as Character, `npc`, `enemy`, `boss`. Prepare the color/style mapping so a later Ally kind can be added cleanly without migration in this milestone. Improve rings, initials, contrast, and hidden/low-visibility treatment.

- [ ] **Step 4: Preserve world-coordinate behavior**
  Do not add screen-space interaction logic, token ownership, combat behavior, or new listeners.

- [ ] **Step 5: Run scene tests, V2 tests, and build**
  Expected: PASS.

- [ ] **Step 6: Commit**
  Commit message: `style(v2): refine board and token presentation`

**Worker 2B acceptance:** empty board looks intentional, token roles are distinguishable, camera/layer behavior remains unchanged, and only presentation code changed.

---

### Task 3: Worker 2C, Radial Edge Safety

**Files:**
- Modify: `src/workspace-v2/radialMenu.js`
- Modify: `tests/workspace-v2-radial.test.js`
- Optional narrow E2E assertion: `tests/e2e/workspace-v2.spec.js`

**Interfaces:**
- Keep `mountRadialMenu({ root, tools, activeTool, onSelect })` unchanged.
- Keep returned methods `collapse`, `expand`, `setPosition`, `destroy` unchanged.
- Existing center-drag, collapse/expand, selection, and resize behavior must remain intact.

- [ ] **Step 1: Add failing radial footprint tests**
  Add tests that place an expanded five-tool radial menu at left, right, top, bottom, and all four corners of an 800x600 root. Assert the stored center position is clamped far enough inward for the expanded orbit plus button radius to remain within bounds.

- [ ] **Step 2: Run the focused test and confirm the new edge cases fail against the current `EDGE_MARGIN = 48` behavior**

- [ ] **Step 3: Implement footprint-aware clamping**
  Derive the required margin from the tool orbit radius and button size rather than relying on the current center-only 48px margin. Clamp on `setPosition`, expand, and resize/orientation changes. Keep collapsed behavior usable near edges without allowing expansion to clip.

- [ ] **Step 4: Preserve pointer-drag semantics**
  Existing drag must still move the menu without toggling collapse or moving the world camera.

- [ ] **Step 5: Run radial tests and V2 E2E**
  Expected: new edge/corner tests PASS and existing quick-tool tests remain green.

- [ ] **Step 6: Commit**
  Commit message: `fix(v2): keep radial tools inside viewport`

**Worker 2C acceptance:** expanded quick tools remain visible at every edge/corner and after resize/orientation changes, with no camera or selection regression.

---

### Task 4: Automated Milestone Gate

**Files:** none unless a deterministic verification script already exists and the lead explicitly requests a narrow update.

- [ ] **Step 1: Verify branch and cleanliness**
  Confirm branch is `v2-workspace` and tree is clean before gate execution.

- [ ] **Step 2: Run focused V2 unit suite**
  Command: `npm.cmd run test:v2`.

- [ ] **Step 3: Run V2 E2E suite**
  Command: `npm.cmd run test:e2e:v2`.

- [ ] **Step 4: Run project check**
  Command: `npm.cmd run check`.

- [ ] **Step 5: Run production build**
  Command: `npm.cmd run build`.

- [ ] **Step 6: Protected-file audit**
  Compare Milestone 2 changes against the pre-M2 baseline and fail if edits appear in Supabase migrations/config, auth/realtime authority code, legacy entry points, production Netlify config, or unrelated files.

- [ ] **Step 7: Emit one concise terminal line**
  Required terminal style: `PASS: M2 automated gate complete` or `FAIL: M2 automated gate - inspect <log>`.

---

### Task 5: Independent Review and Repair

**Reviewer:** CodeRabbit first.

**Review scope:** all commits from the Milestone 2 start commit through the current head.

Reviewer must focus on:
- interaction regressions hidden by visual changes
- mobile/tablet overflow
- keyboard/focus/accessibility regressions
- radial clamping correctness
- accidental backend/production scope changes
- unnecessary CSS/JS complexity or duplicated literal values

- [ ] **Step 1: Run independent review**
- [ ] **Step 2: Classify findings as blocker, important, minor, or optional polish**
- [ ] **Step 3: Return file-specific fixes to the owning worker**
- [ ] **Step 4: Use Codex only if a finding is technically difficult, architecture-sensitive, or repeatedly unresolved**
- [ ] **Step 5: Re-run only the focused tests for each repair, then repeat Task 4 once all findings are resolved**

---

### Task 6: Staging and Manual Acceptance

**Target:** separate Netlify project `aure-relics-v2-staging` only.

- [ ] **Step 1: Confirm final gate PASS and clean tree**
- [ ] **Step 2: Obtain explicit staging-deploy approval**
- [ ] **Step 3: Deploy `dist` to the already-linked staging project**
- [ ] **Step 4: Verify `/v2.html#demo` returns HTTP 200**
- [ ] **Step 5: Manual device pass**
  Test desktop mouse/keyboard, Surface landscape, Surface portrait, phone portrait, and phone landscape where practical.
- [ ] **Step 6: Accept or log small visual follow-ups**
  Do not reopen architecture for taste-only tweaks unless a usability defect is found.

## Milestone 2 Completion Criteria

Milestone 2 closes only when:
- Aure Relics visual identity is coherent across top bar, panels, canvas, camera controls, radial control, and token placeholders.
- Zoom/pan and panel placement still feel like the accepted Milestone 1 staging build.
- Expanded radial tools cannot clip off-screen.
- Desktop, Surface/tablet, and phone remain usable.
- V2 unit, V2 E2E, project check, build, and protected-file audit pass.
- Independent-review findings are resolved or explicitly accepted.
- Staging manual acceptance is complete.
- No production or backend authority behavior changed.
