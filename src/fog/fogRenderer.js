/**
 * Shared player-facing fog rendering for Issue #10 Task 4. This module owns the *only* code
 * path that turns an authoritative `fog` projection (see `src/fog/fogMask.js` and
 * `src/realtime/types.js`'s `FogProjection`) into pixels for a player. Both the real Player
 * Screen (`src/screens/player-screen.js`) and the DM's read-only Player Preview
 * (`src/screens/dm-screen.js`) reach this module through the exact same call in
 * `src/board/boardViewRenderer.js` — there is no second implementation to keep in sync and no
 * DM-only conditional inside `renderPlayerFog` itself.
 *
 * Rendering uses one canvas per board stage, never one DOM node per cell (plan Global
 * Constraints: bounded for a 200x200 board, no 40,000-node DOM fog implementation). The pure
 * drawing functions (`renderPlayerFog`, `renderManagementFog`) accept a 2D-context-shaped object
 * (`fillStyle`, `fillRect`, `clearRect`, `strokeStyle`, `lineWidth`, `beginPath`, `moveTo`,
 * `lineTo`, `stroke`) rather than a `<canvas>` element, so they are exercised directly in tests
 * without depending on jsdom's optional native canvas backend. `buildPlayerFogStage` is the thin,
 * DOM-owning adapter that a browser actually uses; it degrades to "draw nothing" (never "draw
 * everything") if `getContext('2d')` is unavailable.
 *
 * `renderManagementFog` exists here (per plan Task 4.5) because it shares mask decoding with the
 * player renderer, but nothing in this package wires it into the DM board yet — that is Issue
 * #10E/10F's Fog Mode editor/controller, explicitly out of scope for this package.
 */

import { decodeRevealedRuns, frontierSegments } from './fogMask.js';

/** Matches the legacy board's `--cell-size` (style.css `:root`) so a future shared-art layer aligns. */
export const DEFAULT_CELL_SIZE = 32;

/** Dark charcoal/black fantasy concealment (design §9) — always fully opaque, never a fixed
 * value. Callers are never allowed to be passed the *management* palette below, and vice versa: a
 * single flat value here means player fog can never leak information by taking on a value derived
 * from anything the payload controls. */
export const PLAYER_FOG_FILL = '#100d0a';

/** DM-only translucent management overlay tint. Never referenced by `renderPlayerFog`. */
export const DM_MANAGEMENT_FILL = 'rgba(10, 8, 6, 0.55)';

/** The Aure Relics gold management frontier (style.css `--gold`). DM-only; never referenced by
 * `renderPlayerFog` (design §9 / plan Task 4 review checkpoint: "DM-only gold frontier never
 * appears in player rendering"). */
export const DM_FRONTIER_COLOR = '#c9a95c';

/** Subtle boundary highlight for a selected named area in the DM management view. DM-only. */
export const DM_SELECTED_AREA_COLOR = '#f5d98b';

function pixelSize(decoded, cellSize) {
  return { pixelWidth: decoded.width * cellSize, pixelHeight: decoded.height * cellSize };
}

/**
 * Draw the player-facing fog treatment for one decoded `fog` projection onto `context`.
 *
 * Fail-closed contract (mirrors `decodeRevealedRuns`): an invalid payload (bad shape, malformed
 * runs, out-of-order runs) is rendered exactly like "enabled, nothing revealed" — a single
 * opaque fill and no holes punched. This function never throws and never renders a see-through
 * board for a payload it cannot trust. A trustworthy `enabled: false` payload draws nothing at
 * all (transparent), which visually restores whatever the caller's own base stage/theme layer
 * shows underneath — it does not and cannot re-expose any gameplay entity, because entities the
 * DM has not disclosed were never present in the projection this fog data came from in the first
 * place (fog is a WHERE gate; disclosure is a separate WHETHER gate enforced server-side).
 *
 * Revealed rectangles are punched directly from the already-validated `fog.revealedRuns` — no
 * per-cell loop over a decoded mask — so this stays O(runs), not O(width*height), on a 200x200
 * board.
 *
 * @param {{ fillStyle: string, fillRect: Function, clearRect: Function }} context
 * @param {unknown} fog Planned snapshot shape, see `src/realtime/types.js` `FogProjection`.
 * @param {{ cellSize?: number }} [options]
 */
export function renderPlayerFog(context, fog, { cellSize = DEFAULT_CELL_SIZE } = {}) {
  const decoded = decodeRevealedRuns(fog);
  if (decoded.width === 0 || decoded.height === 0) return;
  const { pixelWidth, pixelHeight } = pixelSize(decoded, cellSize);

  if (decoded.valid && decoded.enabled === false) {
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    return;
  }

  context.fillStyle = PLAYER_FOG_FILL;
  context.fillRect(0, 0, pixelWidth, pixelHeight);

  if (!decoded.valid) return; // fail closed: opaque fill stands, no cell is ever punched out

  for (const [y, xStart, xEnd] of fog.revealedRuns) {
    context.clearRect(xStart * cellSize, y * cellSize, (xEnd - xStart) * cellSize, cellSize);
  }
}

/**
 * Draw the DM-only fog *management* treatment: a translucent overlay (never fully opaque, since
 * the DM always sees the full map underneath — design §6) over hidden cells, plus the thin gold
 * hidden/revealed frontier and an optional selected-named-area boundary highlight. Shares
 * `decodeRevealedRuns` with `renderPlayerFog` but is otherwise a fully separate code path with no
 * shared visual constants — this function is simply not called anywhere in this package yet (see
 * module docstring); it exists now only because Task 4 asks the two treatments to share mask
 * decoding.
 *
 * @param {{ fillStyle: string, fillRect: Function, strokeStyle: string, lineWidth: number, beginPath: Function, moveTo: Function, lineTo: Function, stroke: Function, strokeRect: Function }} context
 * @param {unknown} fog
 * @param {{ cellSize?: number, opacity?: number, selectedCells?: number[][] }} [options]
 */
export function renderManagementFog(context, fog, { cellSize = DEFAULT_CELL_SIZE, selectedCells = [] } = {}) {
  const decoded = decodeRevealedRuns(fog);
  if (decoded.width === 0 || decoded.height === 0) return;

  context.fillStyle = DM_MANAGEMENT_FILL;
  for (let y = 0; y < decoded.height; y += 1) {
    let runStart = null;
    for (let x = 0; x <= decoded.width; x += 1) {
      const hidden = x < decoded.width && decoded.mask[y * decoded.width + x] !== 1;
      if (hidden && runStart === null) runStart = x;
      if (!hidden && runStart !== null) {
        context.fillRect(runStart * cellSize, y * cellSize, (x - runStart) * cellSize, cellSize);
        runStart = null;
      }
    }
  }

  if (decoded.valid) {
    context.strokeStyle = DM_FRONTIER_COLOR;
    context.lineWidth = 1;
    for (const [x1, y1, x2, y2] of frontierSegments(decoded.mask, decoded.width, decoded.height)) {
      context.beginPath();
      context.moveTo(x1 * cellSize, y1 * cellSize);
      context.lineTo(x2 * cellSize, y2 * cellSize);
      context.stroke();
    }
  }

  if (Array.isArray(selectedCells) && selectedCells.length) {
    context.strokeStyle = DM_SELECTED_AREA_COLOR;
    context.lineWidth = 2;
    for (const cell of selectedCells) {
      if (!Array.isArray(cell) || cell.length !== 2) continue;
      const [x, y] = cell;
      if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
      if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) continue;
      context.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
}

/**
 * Build the player-facing `.fog-player-stage` DOM: a base substrate sized from `fog.width`/
 * `fog.height` (Issue #11 may later render map art/terrain here) with the shared player fog
 * canvas above it. Returns `null` when `fog`'s identity/dimensions cannot be trusted at all
 * (`decodeRevealedRuns` reports `width`/`height` of `0`) — there is no coherent board size to
 * stage, and omitting the stage leaks nothing because no base content is rendered by this package
 * (a bare placeholder substrate, not real map art) for a board this function declines to build.
 *
 * If the environment cannot provide a real 2D canvas context (for example jsdom without its
 * optional native canvas backend, as in this project's unit tests), the canvas element is still
 * created and correctly sized, but nothing is drawn — never "everything is drawn", never "fall
 * back to unmasked". `renderPlayerFog` itself is covered directly against a fake context object
 * for the actual pixel-level fail-closed contract; see `tests/fog-renderer.test.js`.
 *
 * @param {Document} doc
 * @param {unknown} fog
 * @param {{ cellSize?: number }} [options]
 * @returns {HTMLElement|null}
 */
export function buildPlayerFogStage(doc, fog, { cellSize = DEFAULT_CELL_SIZE } = {}) {
  const decoded = decodeRevealedRuns(fog);
  if (decoded.width === 0 || decoded.height === 0) return null;

  const stage = doc.createElement('div');
  stage.className = 'fog-player-stage';
  stage.style.setProperty('--fog-cols', String(decoded.width));
  stage.style.setProperty('--fog-rows', String(decoded.height));

  const base = doc.createElement('div');
  base.className = 'fog-player-stage-base';
  stage.appendChild(base);

  const canvas = doc.createElement('canvas');
  canvas.className = 'fog-player-canvas';
  canvas.width = decoded.width * cellSize;
  canvas.height = decoded.height * cellSize;
  stage.appendChild(canvas);

  const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (context) renderPlayerFog(context, fog, { cellSize });

  return stage;
}
