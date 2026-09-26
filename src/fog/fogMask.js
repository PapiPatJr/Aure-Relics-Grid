/**
 * Pure client-side interpretation of the authoritative Issue #10 fog projection
 * (`docs/superpowers/specs/2026-09-25-fog-of-war-design.md` §8.3, planned shape in
 * `docs/superpowers/plans/2026-09-25-issue-10-fog-of-war.md`). Nothing here talks to the
 * network, DOM or realtime engine — see `fogMutations.js` for the mutation bridge and the
 * later Fog Mode editor/renderer for presentation.
 *
 * The server is the sole authority on visibility. This module never manufactures reveal
 * state that was not present in the authoritative `revealedRuns`: any malformed or
 * out-of-bounds input fails closed to a fully hidden mask rather than guessing or falling
 * back to "show everything".
 */

/** Maximum supported board edge length in either dimension (design §8.3 / plan Global Constraints). */
export const MAX_BOARD_DIMENSION = 200;

/** The only brush footprints the approved plan defines (design §5.1). */
export const BRUSH_SIZES = Object.freeze([1, 2, 3, 5]);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeDimension(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_BOARD_DIMENSION;
}

function isSafeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Decode the compact `[y, xStartInclusive, xEndExclusive]` revealed-run projection into a
 * fixed-size `Uint8Array` mask (one byte per cell, `1` = revealed, `0` = hidden), addressed
 * `mask[y * width + x]`. Never allocates one object per cell, so it stays bounded on a
 * 200x200 board.
 *
 * Fail-closed contract: if the board dimensions themselves cannot be trusted, everything
 * about the payload is unusable and the result reports a 0x0 empty mask. If the dimensions
 * are trustworthy but `enabled`/`revealedRuns` is malformed or any run is out of bounds, the
 * result keeps the known-good `width`/`height` (so a renderer can still cover the real board)
 * but the mask is entirely hidden and `valid` is `false`. A caller must treat `valid: false`
 * the same as "hidden everywhere" — never as "unknown, so show it".
 *
 * `enabled` is surfaced separately from the mask on purpose (design §8.3 / plan 3.1): stored
 * revealed cells persist even while fog is disabled, so decoding never conflates "fog is off"
 * with "nothing has been revealed".
 *
 * @param {unknown} fog Planned snapshot shape: `{ levelId, width, height, enabled, revealedRuns }`.
 * @returns {{ valid: boolean, levelId: string|null, width: number, height: number, enabled: boolean, mask: Uint8Array }}
 */
export function decodeRevealedRuns(fog) {
  if (!isPlainObject(fog)) {
    return { valid: false, levelId: null, width: 0, height: 0, enabled: true, mask: new Uint8Array(0) };
  }

  const levelId = typeof fog.levelId === 'string' ? fog.levelId : null;
  const { width, height } = fog;
  if (!isSafeDimension(width) || !isSafeDimension(height)) {
    return { valid: false, levelId, width: 0, height: 0, enabled: true, mask: new Uint8Array(0) };
  }

  const hiddenFallback = enabledValue => ({
    valid: false,
    levelId,
    width,
    height,
    enabled: typeof enabledValue === 'boolean' ? enabledValue : true,
    mask: new Uint8Array(width * height), // zero-filled by construction: fully hidden
  });

  if (typeof fog.enabled !== 'boolean') return hiddenFallback(true);
  if (!Array.isArray(fog.revealedRuns)) return hiddenFallback(fog.enabled);

  const mask = new Uint8Array(width * height);
  for (const run of fog.revealedRuns) {
    if (!Array.isArray(run) || run.length !== 3) return hiddenFallback(fog.enabled);
    const [y, xStart, xEnd] = run;
    if (!isSafeInteger(y) || !isSafeInteger(xStart) || !isSafeInteger(xEnd)) return hiddenFallback(fog.enabled);
    if (y < 0 || y >= height || xStart < 0 || xEnd > width || xStart >= xEnd) return hiddenFallback(fog.enabled);
    mask.fill(1, y * width + xStart, y * width + xEnd);
  }

  return { valid: true, levelId, width, height, enabled: fog.enabled, mask };
}

/**
 * Query a decoded mask. Any malformed input (wrong mask type, non-integer/negative
 * coordinates, coordinates outside `width`/the mask's implied height) reports `false`
 * (hidden) rather than throwing or guessing — this is the fail-closed leaf every renderer
 * should call through rather than indexing `mask` directly.
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function isCellRevealed(mask, width, x, y) {
  if (!(mask instanceof Uint8Array) || !isSafeInteger(width) || width <= 0) return false;
  if (!isSafeInteger(x) || !isSafeInteger(y) || x < 0 || y < 0 || x >= width) return false;
  const index = y * width + x;
  if (index < 0 || index >= mask.length) return false;
  return mask[index] === 1;
}

/**
 * Remove duplicate `[x, y]` pairs, preserving first-seen order. Mirrors the canonicalization
 * `private.fog_canonical_cells` performs server-side (`supabase/migrations/20260925223100_fog_mutations.sql`)
 * so a client-collapsed stroke and the server's own de-duplication agree, and so a locally
 * collapsed cell list is cheap to preview before it is ever sent as a mutation payload.
 * @param {unknown} cells
 * @returns {number[][]}
 */
export function collapseCells(cells) {
  if (!Array.isArray(cells)) return [];
  const seen = new Set();
  const result = [];
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length !== 2) continue;
    const [x, y] = cell;
    if (!isSafeInteger(x) || !isSafeInteger(y)) continue;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([x, y]);
  }
  return result;
}

/**
 * Generate the `[x, y]` footprint of a brush centered/anchored on `(x, y)`, clipped to
 * `width`/`height` and de-duplicated. Even sizes have no true center, so by documented
 * convention (plan 3.1) the pointer cell is the brush's top-left member; odd sizes are
 * centered on the pointer cell. Clipping never wraps or rejects the whole brush at an edge or
 * corner — it simply omits the out-of-bounds members.
 * @param {{ x: number, y: number, size: 1|2|3|5, width: number, height: number }} args
 * @returns {number[][]}
 */
export function brushCells({ x, y, size, width, height }) {
  if (!BRUSH_SIZES.includes(size)) return [];
  if (!isSafeDimension(width) || !isSafeDimension(height)) return [];
  if (!isSafeInteger(x) || !isSafeInteger(y)) return [];

  const offsets = [];
  if (size === 1) {
    offsets.push([0, 0]);
  } else if (size === 2) {
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) offsets.push([dx, dy]);
    }
  } else {
    const radius = (size - 1) / 2;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) offsets.push([dx, dy]);
    }
  }

  const cells = [];
  for (const [dx, dy] of offsets) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
    cells.push([cx, cy]);
  }
  return collapseCells(cells);
}

/**
 * Apply a local Reveal/Hide preview over `mask` without mutating it — the DM's in-progress
 * drag preview must stay disposable (design §5.3 / §13.1) and never corrupt the authoritative
 * mask a stale preview was based on. Out-of-bounds cells in `cells` are silently ignored, the
 * same clip-not-reject behavior as `brushCells`.
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {unknown} cells `[x, y]` pairs, e.g. from `brushCells`.
 * @param {boolean} revealed
 * @returns {Uint8Array} A new mask; `mask` itself is never modified.
 */
export function applyFogPreview(mask, width, cells, revealed) {
  if (!(mask instanceof Uint8Array) || !isSafeInteger(width) || width <= 0) {
    return mask instanceof Uint8Array ? mask.slice() : new Uint8Array(0);
  }
  const next = mask.slice();
  const height = mask.length / width;
  const value = revealed ? 1 : 0;
  for (const [x, y] of collapseCells(cells)) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    next[y * width + x] = value;
  }
  return next;
}

/**
 * Compute the Hidden/Revealed frontier as grid-corner line segments `[x1, y1, x2, y2]`,
 * emitted once per internal boundary (never at the outer edge of the board, which is not a
 * Hidden/Revealed transition). This is presentation-agnostic boundary math only — the DM-only
 * gold frontier styling and canvas drawing belong to the later fog renderer/editor, not here.
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @returns {number[][]}
 */
export function frontierSegments(mask, width, height) {
  if (!(mask instanceof Uint8Array) || !isSafeInteger(width) || !isSafeInteger(height) || width <= 0 || height <= 0) {
    return [];
  }
  if (mask.length !== width * height) return [];

  const revealed = (x, y) => mask[y * width + x] === 1;
  const segments = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      if (revealed(x, y) !== revealed(x + 1, y)) segments.push([x + 1, y, x + 1, y + 1]);
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height - 1; y += 1) {
      if (revealed(x, y) !== revealed(x, y + 1)) segments.push([x, y + 1, x + 1, y + 1]);
    }
  }
  return segments;
}
