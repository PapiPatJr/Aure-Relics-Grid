/**
 * DM-only Fog Mode editor interaction layer (Issue #10E, plan Task 5 —
 * `docs/superpowers/plans/2026-09-25-issue-10-fog-of-war.md`). This module owns pointer/stroke
 * state, brush behavior, local DM preview state, and named-area selection interaction for the
 * DM's Fog Mode board overlay. It does **not** own final app/controller wiring (toolbar UI,
 * safety confirmations, or calling the mutation bridge) — that is Issue #10F's
 * `fogController.js`. This module never imports the fog mutation bridge or the realtime engine: it
 * reports a completed stroke through the caller-supplied `onStroke` callback and lets the
 * controller decide whether/how to mutate.
 *
 * Hard architectural gate (design §5.3 / plan Task 5 review checkpoint): while the DM drags a
 * stroke, only local preview state changes. `onStroke` fires exactly once, on pointer release,
 * with the normalized, deduplicated cell set for the whole stroke — never once per
 * `pointermove`. A 50-cell drag is one `onStroke` call, not fifty.
 *
 * Coordinate model: pointer position is mapped into grid cells from `grid.getBoundingClientRect()`
 * divided by the authoritative `fog.width`/`fog.height` (plan step 5.4), not from the legacy
 * `--cell-size` custom property — this stays correct under arbitrary CSS/board scaling without
 * inventing a second coordinate system, and fails closed (no cell) if the grid has no live layout
 * box yet, exactly like `fogMask.js`'s own fail-closed leaves.
 *
 * Brush geometry is never reimplemented here: every brush application calls
 * `fogMask.brushCells`, and dedup/ordering reuses `fogMask.collapseCells`, so this module and the
 * server's own canonicalization (`private.fog_canonical_cells`) agree on what a stroke contains.
 *
 * Sparse pointer sampling (10E-FIX defect 1 / 10E-FIX2): browsers coalesce/drop `pointermove`
 * events under fast motion, so two consecutive samples can land on non-adjacent grid cells.
 * `gridLineCells` (a supercover/grid-traversal walk — see its own docstring for why this is not
 * plain Bresenham) reconstructs every grid cell the pointer's path actually crossed between the
 * previous sampled cell and the new one, and a brush is applied at every one of those cells —
 * never just the two sampled endpoints. This keeps a fast flick and a slow, densely-sampled drag
 * along the same route producing the same painted path.
 *
 * Authoritative-context safety (10E-FIX defect 2): a stroke captures the level identity and board
 * dimensions it began under. If `setFog()` delivers a new authoritative projection for a
 * *different* level (or a differently-shaped board) while a stroke is active, the local cells
 * accumulated so far were addressed against a context that no longer exists — carrying them
 * forward and re-addressing them to the new level would be exactly the "reveal unintended cells"
 * failure mode design §13.2 forbids. The in-progress stroke is discarded (never committed, never
 * migrated) the moment such a change arrives; a later stray pointer release naturally emits
 * nothing because there is no active stroke left for it to complete.
 *
 * Shift inversion (design §5.1): Reveal+Shift behaves as Hide and Hide+Shift behaves as Reveal.
 * Because one committed stroke is one mutation with a single `mode`, this implementation samples
 * the Shift key exactly once, at `pointerdown`, and that stroke's effective mode is fixed for its
 * duration — a mid-drag Shift press/release changes only the *next* stroke, not cells already
 * queued in the current one. This keeps "one pointer release = one mutation opportunity" (plan
 * Task 5 review checkpoint) simple and unambiguous rather than needing to split one drag into
 * mixed-mode sub-batches. See `docs/testing/issue-10-verification.md` / the 10E handoff notes for
 * this call flagged explicitly for the 10F controller.
 *
 * Named-area selection purpose (design §5.2 / plan step 5.3): `setPurpose('area')` reuses the
 * exact same pointerdown/move/up accumulation, brush math, and Shift inversion as fog painting,
 * but reports `{ purpose: 'area', action: 'add' | 'remove', cells }` instead of
 * `{ purpose: 'fog', mode, cells }`. Reveal maps to Add and Hide maps to Remove. This module never
 * calls `fog.paint` and never mutates live fog for an `area`-purpose stroke — it only ever calls
 * `onStroke`, and the payload's `purpose` tag is how the 10F controller tells the two intents
 * apart without guessing.
 *
 * Rendering reuses `renderManagementFog` from `fogRenderer.js` (10D) for the DM-only translucent
 * overlay, gold frontier, and selected-area highlight, with a caller-controlled `globalAlpha`
 * layered on top via `setOpacity` — `fogRenderer.js` itself is untouched, so the shared player
 * renderer stays exactly as Issue #10D left it. This module never references
 * the player-facing renderer/stage exports `fogRenderer.js` provides for the real Player Screen
 * and DM Player Preview, or their DOM class names: editor preview must never contaminate those
 * surfaces (design §8/§11).
 *
 * Like `fogRenderer.js`'s player-stage builder, drawing degrades gracefully when the environment
 * has no real 2D canvas backend (e.g. jsdom without the optional `canvas` package): the overlay
 * canvas is still created/sized/positioned correctly, but nothing is drawn. This module's own
 * tests exercise the interaction/state contract rather than pixel output, matching how Task 4
 * covered `renderManagementFog`'s actual pixels directly against a fake context.
 */

import { decodeRevealedRuns, brushCells, collapseCells, BRUSH_SIZES } from './fogMask.js';
import { renderManagementFog } from './fogRenderer.js';

const EMPTY_DECODED = Object.freeze({ valid: false, levelId: null, width: 0, height: 0, enabled: true, mask: new Uint8Array(0) });

function invertMode(mode) {
  return mode === 'hide' ? 'reveal' : 'hide';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp01(value) {
  return isFiniteNumber(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/**
 * Supercover grid traversal from cell `(x0, y0)` to cell `(x1, y1)` inclusive of both endpoints:
 * every grid cell the straight continuous line between the two cells' centers actually passes
 * through, not merely a representative raster approximation of it (10E-FIX2).
 *
 * A prior version of this helper used standard Bresenham, which deliberately picks one
 * "representative" cell per major-axis step and is allowed to skip a cell a real continuous
 * pointer path would still cross — e.g. Bresenham from `(0,0)` to `(4,2)` yields
 * `[[0,0],[1,1],[2,1],[3,2],[4,2]]`, omitting `[1,0]` and `[3,1]`, both of which a densely-sampled
 * pointer moving along that same straight line does cross. That gap is exactly the class of bug
 * this rewrite fixes: sparse pointer sampling (this module's whole reason for interpolating at
 * all) must produce the same logical painted cell set a hypothetically infinitely-dense sampling
 * of the same path would.
 *
 * The algorithm below is the standard integer supercover/grid-traversal construction: walking from
 * one cell to the next, at each step it asks whether the line crosses the next vertical grid line,
 * the next horizontal grid line, or both at once (an exact corner crossing), by comparing
 * `(1 + 2*ixStep) * ny` against `(1 + 2*iyStep) * nx` — the sign-independent, magnitude-only
 * comparison that is what makes this traversal exactly symmetric under swapping the two endpoints
 * (A→B and B→A always produce the identical *set* of cells, only in reverse order), unlike
 * Bresenham's tie-breaking. Every step moves to an orthogonally- or diagonally-adjacent cell, so
 * the returned path is always fully connected — horizontal, vertical, and exact-diagonal segments
 * degrade to the same simple continuous walk they always were.
 *
 * Exported for direct unit coverage; the only caller is `addBrushAt`'s path interpolation below.
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {number[][]}
 */
export function gridLineCells(x0, y0, x1, y1) {
  const cells = [[x0, y0]];
  const nx = Math.abs(x1 - x0);
  const ny = Math.abs(y1 - y0);
  const sx = x1 > x0 ? 1 : -1;
  const sy = y1 > y0 ? 1 : -1;
  let x = x0;
  let y = y0;
  let ixStep = 0;
  let iyStep = 0;
  while (ixStep < nx || iyStep < ny) {
    const lhs = (1 + 2 * ixStep) * ny;
    const rhs = (1 + 2 * iyStep) * nx;
    if (lhs < rhs) {
      x += sx;
      ixStep += 1;
    } else if (lhs > rhs) {
      y += sy;
      iyStep += 1;
    } else {
      // Exact corner crossing: the line passes precisely through the shared corner of four
      // cells, so only the one diagonal neighbor is entered, never both orthogonal ones.
      x += sx;
      y += sy;
      ixStep += 1;
      iyStep += 1;
    }
    cells.push([x, y]);
  }
  return cells;
}

/**
 * @param {{ frame: HTMLElement, grid: HTMLElement, onStroke: (stroke: object) => void }} args
 *   `frame` is `.grid-frame` (the overlay canvas is attached here, never inside `#grid`, so it
 *   never disturbs the legacy CSS-grid children). `grid` is `#grid`, used only to read
 *   `getBoundingClientRect()` for coordinate mapping and overlay sizing. `onStroke` is called
 *   exactly once per completed, non-empty stroke.
 */
export function createFogEditor({ frame, grid, onStroke }) {
  if (!frame || !grid || typeof onStroke !== 'function') {
    throw new TypeError('createFogEditor requires { frame, grid, onStroke }');
  }

  const doc = frame.ownerDocument;
  const win = doc.defaultView || null;

  const canvas = doc.createElement('canvas');
  canvas.className = 'fog-editor-canvas'; // static layout in fog.css; runtime geometry/pointer-events set below
  canvas.style.pointerEvents = 'none';
  frame.appendChild(canvas);

  let disposed = false;
  let active = false;
  let purpose = 'fog'; // 'fog' | 'area'
  let mode = 'reveal'; // 'reveal' | 'hide' — the DM-selected base tool, unaffected by Shift
  let brushSize = 1;
  let opacity = 1;
  let selectedCells = [];
  let shiftHeld = false;

  let rawFog = null;
  let decoded = EMPTY_DECODED;

  let strokeActive = false;
  let strokePointerId = null;
  let strokeEffectiveMode = 'reveal';
  let strokeCells = new Map();
  let strokeLastCell = null; // last sampled grid cell, for path interpolation between samples
  let strokeLevelId = null; // authoritative context the stroke began under (10E-FIX defect 2)
  let strokeWidth = 0;
  let strokeHeight = 0;

  function ctx2d() {
    return typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  }

  // One native pixel per board cell (same convention as the player-stage builder's 10D-FIX), then
  // CSS-positioned/sized to sit exactly over `#grid` regardless of frame scroll/padding: the
  // difference between two `getBoundingClientRect()` calls is scroll-independent because both are
  // viewport-relative, so this stays correct while the frame is scrolled.
  function syncGeometry() {
    if (disposed || decoded.width <= 0 || decoded.height <= 0) return;
    if (canvas.width !== decoded.width) canvas.width = decoded.width;
    if (canvas.height !== decoded.height) canvas.height = decoded.height;
    const gridRect = grid.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const scrollLeft = frame.scrollLeft || 0;
    const scrollTop = frame.scrollTop || 0;
    canvas.style.left = `${gridRect.left - frameRect.left + scrollLeft}px`;
    canvas.style.top = `${gridRect.top - frameRect.top + scrollTop}px`;
    canvas.style.width = `${gridRect.width}px`;
    canvas.style.height = `${gridRect.height}px`;
  }

  function redraw() {
    if (disposed) return;
    syncGeometry();
    const context = ctx2d();
    if (!context) return; // no real canvas backend (e.g. jsdom): draw nothing, never guess
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (rawFog) {
      context.save();
      context.globalAlpha = clamp01(opacity);
      renderManagementFog(context, rawFog, { cellSize: 1, selectedCells });
      context.restore();
    }
    if (strokeActive && strokeCells.size) {
      context.save();
      context.fillStyle = strokeEffectiveMode === 'hide' ? 'rgba(120, 20, 20, 0.55)' : 'rgba(60, 200, 120, 0.4)';
      for (const [x, y] of strokeCells.values()) context.fillRect(x, y, 1, 1);
      context.restore();
    }
  }

  /** Fail-closed: no trustworthy board identity/dimensions, no live layout box, or the point
   * falls outside the authoritative board -> no cell, never a guessed/clamped-into-range cell. */
  function pointToCell(clientX, clientY) {
    if (decoded.width <= 0 || decoded.height <= 0) return null;
    if (!isFiniteNumber(clientX) || !isFiniteNumber(clientY)) return null;
    const rect = grid.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    const cellWidth = rect.width / decoded.width;
    const cellHeight = rect.height / decoded.height;
    const x = Math.floor((clientX - rect.left) / cellWidth);
    const y = Math.floor((clientY - rect.top) / cellHeight);
    if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) return null;
    return [x, y];
  }

  function applyBrush(x, y) {
    for (const painted of brushCells({ x, y, size: brushSize, width: decoded.width, height: decoded.height })) {
      strokeCells.set(`${painted[0]},${painted[1]}`, painted);
    }
  }

  /** Apply the current brush at `cell`, and — if a previous sample exists for this stroke — at
   * every grid cell `gridLineCells` reconstructs between that previous sample and `cell`, so a
   * sparse/coalesced pointermove still paints a continuous path (10E-FIX defect 1). */
  function addBrushAt(cell) {
    if (!cell) return;
    if (strokeLastCell) {
      for (const [x, y] of gridLineCells(strokeLastCell[0], strokeLastCell[1], cell[0], cell[1])) {
        applyBrush(x, y);
      }
    } else {
      applyBrush(cell[0], cell[1]);
    }
    strokeLastCell = cell;
  }

  function releasePointerCaptureSafely() {
    if (strokePointerId === null) return;
    try {
      if (typeof canvas.releasePointerCapture === 'function') canvas.releasePointerCapture(strokePointerId);
    } catch {
      // Pointer capture is a progressive enhancement only (unsupported in some test/DOM
      // environments); losing it never affects stroke correctness, only drag robustness.
    }
  }

  function resetStroke() {
    strokeActive = false;
    strokePointerId = null;
    strokeCells = new Map();
    strokeLastCell = null;
    strokeLevelId = null;
    strokeWidth = 0;
    strokeHeight = 0;
  }

  /** Discard any uncommitted preview without ever calling `onStroke` (design §5.3/§13.1, plan
   * Task 5: Escape, mode exit, and teardown must all be able to do this). Idempotent. */
  function cancelPreview() {
    if (!strokeActive && strokeCells.size === 0) return;
    releasePointerCaptureSafely();
    resetStroke();
    redraw();
  }

  /** The one and only place `onStroke` is called — exactly once per completed stroke (plan Task
   * 5 review checkpoint: "one pointer release yields one mutation request opportunity"). */
  function commitStroke() {
    const cells = collapseCells(Array.from(strokeCells.values()));
    // Deterministic payload regardless of the pointer's actual drag path/direction (plan step
    // 3.10 / 10E instructions §10): sort by row then column.
    cells.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    const effectiveMode = strokeEffectiveMode;
    const levelId = strokeLevelId; // the context this stroke actually began under, never the
    // possibly-since-changed `decoded.levelId` (10E-FIX defect 2) — though by this point they are
    // always equal, because setFog() would already have cancelled the stroke on any mismatch.
    releasePointerCaptureSafely();
    resetStroke();
    redraw();
    if (cells.length === 0) return; // pointer never touched a valid cell: nothing to report
    if (purpose === 'area') {
      onStroke({ purpose: 'area', levelId, action: effectiveMode === 'hide' ? 'remove' : 'add', cells });
    } else {
      onStroke({ purpose: 'fog', levelId, mode: effectiveMode, cells });
    }
  }

  function onPointerDown(event) {
    if (typeof event.button === 'number' && event.button !== 0) return;
    strokeActive = true;
    strokePointerId = event.pointerId ?? null;
    strokeEffectiveMode = shiftHeld ? invertMode(mode) : mode; // locked for this stroke's duration
    strokeCells = new Map();
    strokeLastCell = null;
    strokeLevelId = decoded.levelId; // context this stroke is only ever valid under (defect 2)
    strokeWidth = decoded.width;
    strokeHeight = decoded.height;
    addBrushAt(pointToCell(event.clientX, event.clientY));
    redraw();
    event.preventDefault();
    if (strokePointerId !== null && typeof canvas.setPointerCapture === 'function') {
      try { canvas.setPointerCapture(strokePointerId); } catch { /* progressive enhancement only */ }
    }
  }

  function onPointerMove(event) {
    if (!strokeActive) return;
    const cell = pointToCell(event.clientX, event.clientY);
    if (cell) {
      addBrushAt(cell);
      redraw(); // local preview only — never calls onStroke
    }
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!strokeActive) return;
    commitStroke();
    event.preventDefault();
  }

  function onPointerCancel() {
    cancelPreview();
  }

  function onKeyDown(event) {
    if (event.key === 'Shift') {
      shiftHeld = true;
      return;
    }
    if (event.key === 'Escape') cancelPreview();
  }

  function onKeyUp(event) {
    if (event.key === 'Shift') shiftHeld = false;
  }

  function attachListeners() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);
    if (win) win.addEventListener('resize', syncGeometry);
  }

  function detachListeners() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('keyup', onKeyUp);
    if (win) win.removeEventListener('resize', syncGeometry);
  }

  return {
    /** Feed the latest authoritative manager `fog` projection (Task 1/2 shape). Presentation
     * only: never mutates live fog, only what the editor draws and what bounds it paints within.
     *
     * If a stroke is active and this new projection targets a different level or a differently
     * shaped board than the one the stroke began under, the stroke is discarded rather than
     * silently re-addressed to the new context (10E-FIX defect 2) — its accumulated cells were
     * only ever meaningful under the context captured at `pointerdown`. */
    setFog(fog) {
      const nextRawFog = fog ?? null;
      const nextDecoded = nextRawFog ? decodeRevealedRuns(nextRawFog) : EMPTY_DECODED;
      if (strokeActive && (nextDecoded.levelId !== strokeLevelId || nextDecoded.width !== strokeWidth || nextDecoded.height !== strokeHeight)) {
        cancelPreview();
      }
      rawFog = nextRawFog;
      decoded = nextDecoded;
      syncGeometry();
      redraw();
    },

    /** Enter/exit Fog Mode. Inactive: `pointer-events: none`, no listeners attached, normal
     * board interaction is fully unaffected (design §6/plan Task 5 review checkpoint). Active:
     * the overlay owns pointer painting; leaving Fog Mode discards any uncommitted preview. */
    setActive(value) {
      const next = Boolean(value);
      if (next === active) return;
      active = next;
      canvas.style.pointerEvents = active ? 'auto' : 'none';
      if (active) {
        attachListeners();
        syncGeometry();
      } else {
        cancelPreview();
        detachListeners();
        shiftHeld = false;
      }
      redraw();
    },

    /** 'fog' paints live Reveal/Hide; 'area' drives named-area cell selection through the same
     * pointer engine without ever touching live fog (design §5.2/§7). Switching purpose discards
     * any in-progress stroke rather than let it commit under the old purpose's meaning. */
    setPurpose(value) {
      if (value !== 'fog' && value !== 'area') return;
      if (value === purpose) return;
      cancelPreview();
      purpose = value;
    },

    /** The DM-selected base tool. Unaffected by a temporary Shift inversion (design §5.1). */
    setMode(value) {
      if (value !== 'reveal' && value !== 'hide') return;
      mode = value;
    },

    setBrushSize(value) {
      if (!BRUSH_SIZES.includes(value)) return;
      brushSize = value;
    },

    /** Presentation-only named-area highlight (design §6: "selected named areas receive a
     * subtle boundary highlight"). Never affects authoritative fog input or bounds. */
    setSelectedCells(cells) {
      selectedCells = collapseCells(cells);
      redraw();
    },

    /** Caller-controlled DM management overlay opacity, layered via canvas `globalAlpha` on top
     * of `renderManagementFog`'s fixed palette — `fogRenderer.js` itself stays untouched. */
    setOpacity(value) {
      opacity = value;
      redraw();
    },

    cancelPreview,

    /** Remove editor-owned listeners/state and the overlay canvas. Idempotent. No ghost stroke
     * survives teardown: any uncommitted preview is discarded first, never committed. */
    dispose() {
      if (disposed) return;
      cancelPreview();
      detachListeners();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      disposed = true;
    },
  };
}
