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

  function addBrushAt(cell) {
    if (!cell) return;
    const [x, y] = cell;
    for (const painted of brushCells({ x, y, size: brushSize, width: decoded.width, height: decoded.height })) {
      strokeCells.set(`${painted[0]},${painted[1]}`, painted);
    }
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
    const levelId = decoded.levelId;
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
     * only: never mutates live fog, only what the editor draws and what bounds it paints within. */
    setFog(fog) {
      rawFog = fog ?? null;
      decoded = rawFog ? decodeRevealedRuns(rawFog) : EMPTY_DECODED;
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
