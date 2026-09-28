import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BOARD_DIMENSION,
  decodeRevealedRuns,
  isCellRevealed,
  collapseCells,
  brushCells,
  applyFogPreview,
  frontierSegments,
} from '../src/fog/fogMask.js';

function countRevealed(mask) {
  let count = 0;
  for (const byte of mask) if (byte === 1) count += 1;
  return count;
}

// --- decodeRevealedRuns: valid compact-mask interpretation -----------------------------------

test('decodes a sparse revealed board into a fixed-size mask matching the compact runs exactly', () => {
  const fog = { levelId: 'lvl-1', width: 5, height: 3, enabled: true, revealedRuns: [[0, 1, 3], [2, 0, 5]] };
  const decoded = decodeRevealedRuns(fog);

  assert.equal(decoded.valid, true);
  assert.equal(decoded.levelId, 'lvl-1');
  assert.equal(decoded.width, 5);
  assert.equal(decoded.height, 3);
  assert.equal(decoded.enabled, true);
  assert.ok(decoded.mask instanceof Uint8Array);
  assert.equal(decoded.mask.length, 15);

  const expectedRevealed = [[1, 0], [2, 0], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2]];
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      const shouldBeRevealed = expectedRevealed.some(([ex, ey]) => ex === x && ey === y);
      assert.equal(isCellRevealed(decoded.mask, decoded.width, x, y), shouldBeRevealed, `(${x},${y})`);
    }
  }
});

test('a fully hidden board (empty revealedRuns) reveals no cell', () => {
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 4, height: 4, enabled: true, revealedRuns: [] });
  assert.equal(decoded.valid, true);
  assert.equal(countRevealed(decoded.mask), 0);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) assert.equal(isCellRevealed(decoded.mask, decoded.width, x, y), false);
  }
});

test('enabled:false is represented separately from the stored revealed mask', () => {
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 4, height: 4, enabled: false, revealedRuns: [[0, 0, 2]] });
  assert.equal(decoded.valid, true);
  assert.equal(decoded.enabled, false);
  // Stored revealed cells persist even while fog is disabled — decode must not clear them.
  assert.equal(isCellRevealed(decoded.mask, decoded.width, 0, 0), true);
  assert.equal(isCellRevealed(decoded.mask, decoded.width, 1, 0), true);
});

test('a maximum 200x200 board decodes to a fixed-size mask without one allocation per cell', () => {
  const decoded = decodeRevealedRuns({
    levelId: 'lvl-1',
    width: MAX_BOARD_DIMENSION,
    height: MAX_BOARD_DIMENSION,
    enabled: true,
    revealedRuns: [[0, 0, MAX_BOARD_DIMENSION], [199, 0, MAX_BOARD_DIMENSION]],
  });
  assert.equal(decoded.valid, true);
  assert.equal(decoded.mask.length, 40000);
  assert.equal(countRevealed(decoded.mask), 400);
  assert.equal(isCellRevealed(decoded.mask, decoded.width, 199, 199), true);
  assert.equal(isCellRevealed(decoded.mask, decoded.width, 0, 100), false);
});

// --- fail-closed rejection -------------------------------------------------------------------

test('malformed runs fail closed to a fully hidden mask, not a thrown error or full visibility', () => {
  const cases = [
    [[0, 1]], // wrong length
    [['0', 1, 3]], // non-integer member
    [[0, 1, 1]], // empty/reversed run (xStart >= xEnd)
    ['not-a-run'],
    null,
  ];
  for (const revealedRuns of cases) {
    const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 5, height: 5, enabled: true, revealedRuns });
    assert.equal(decoded.valid, false, JSON.stringify(revealedRuns));
    assert.equal(countRevealed(decoded.mask), 0);
    assert.equal(decoded.width, 5); // known-good geometry is preserved for rendering a full hidden cover
    assert.equal(decoded.height, 5);
  }
});

test('out-of-bounds runs are rejected and fail closed rather than clamped or partially trusted', () => {
  const cases = [
    [[5, 0, 3]], // y == height
    [[-1, 0, 3]], // negative y
    [[0, -1, 3]], // negative xStart
    [[0, 0, 6]], // xEnd > width
  ];
  for (const revealedRuns of cases) {
    const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 5, height: 5, enabled: true, revealedRuns });
    assert.equal(decoded.valid, false, JSON.stringify(revealedRuns));
    assert.equal(countRevealed(decoded.mask), 0);
  }
});

test('invalid board dimensions are rejected entirely', () => {
  const badDimensions = [
    { width: 0, height: 5 },
    { width: 5, height: 0 },
    { width: -1, height: 5 },
    { width: 5.5, height: 5 },
    { width: 201, height: 5 },
    { width: '5', height: 5 },
  ];
  for (const dims of badDimensions) {
    const decoded = decodeRevealedRuns({ levelId: 'lvl-1', enabled: true, revealedRuns: [], ...dims });
    assert.equal(decoded.valid, false, JSON.stringify(dims));
    assert.equal(decoded.width, 0);
    assert.equal(decoded.height, 0);
    assert.equal(decoded.mask.length, 0);
  }
});

test('a non-object, null, or missing fog payload fails closed with an empty mask', () => {
  for (const bad of [null, undefined, 'fog', 42, []]) {
    const decoded = decodeRevealedRuns(bad);
    assert.equal(decoded.valid, false);
    assert.equal(decoded.mask.length, 0);
  }
});

test('a malformed enabled flag fails closed and forces enabled:true so a renderer keeps masking', () => {
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 5, height: 5, enabled: 'yes', revealedRuns: [] });
  assert.equal(decoded.valid, false);
  assert.equal(decoded.enabled, true);
  assert.equal(countRevealed(decoded.mask), 0);
});

test('a malformed revealedRuns container fails closed', () => {
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 5, height: 5, enabled: true, revealedRuns: 'nope' });
  assert.equal(decoded.valid, false);
  assert.equal(countRevealed(decoded.mask), 0);
});

test('QA regression: malformed disabled fog cannot bypass masking — an invalid projection never reports enabled:false', () => {
  const decoded = decodeRevealedRuns({ levelId: 'level', width: 2, height: 2, enabled: false, revealedRuns: 'bad' });
  assert.equal(decoded.valid, false);
  // The projection itself is malformed, so a consumer must never be able to read this as
  // "fog disabled, show everything" — enabled is unconditionally forced true when invalid.
  assert.equal(decoded.enabled, true);
  assert.equal(countRevealed(decoded.mask), 0);
});

test('QA regression: a missing or unusable level identity is rejected, not silently defaulted', () => {
  const cases = [
    {}, // no levelId at all
    { levelId: null },
    { levelId: '' },
    { levelId: '   ' }, // whitespace-only is not a usable identity
    { levelId: 42 },
  ];
  for (const overrides of cases) {
    const decoded = decodeRevealedRuns({ width: 5, height: 5, enabled: true, revealedRuns: [], ...overrides });
    assert.equal(decoded.valid, false, JSON.stringify(overrides));
    assert.equal(decoded.levelId, null);
    assert.equal(decoded.width, 0);
    assert.equal(decoded.height, 0);
    assert.equal(decoded.enabled, true);
    assert.equal(decoded.mask.length, 0);
  }
});

test('QA regression: noncanonical revealed-run ordering is rejected, never sorted into validity', () => {
  // Rows out of order.
  const outOfRowOrder = decodeRevealedRuns({
    levelId: 'lvl-1', width: 5, height: 5, enabled: true,
    revealedRuns: [[1, 0, 1], [0, 0, 1]],
  });
  assert.equal(outOfRowOrder.valid, false);
  assert.equal(countRevealed(outOfRowOrder.mask), 0);

  // Same row, unsorted xStart.
  const unsortedWithinRow = decodeRevealedRuns({
    levelId: 'lvl-1', width: 5, height: 5, enabled: true,
    revealedRuns: [[0, 3, 4], [0, 0, 1]],
  });
  assert.equal(unsortedWithinRow.valid, false);

  // Same row, overlapping runs.
  const overlapping = decodeRevealedRuns({
    levelId: 'lvl-1', width: 5, height: 5, enabled: true,
    revealedRuns: [[0, 0, 3], [0, 2, 4]],
  });
  assert.equal(overlapping.valid, false);

  // Same row, touching (unmerged) runs — the server always emits maximal merged runs.
  const touching = decodeRevealedRuns({
    levelId: 'lvl-1', width: 5, height: 5, enabled: true,
    revealedRuns: [[0, 0, 2], [0, 2, 4]],
  });
  assert.equal(touching.valid, false);

  // Canonical order (strictly increasing rows, strictly increasing/non-overlapping within a row) still decodes.
  const canonical = decodeRevealedRuns({
    levelId: 'lvl-1', width: 5, height: 5, enabled: true,
    revealedRuns: [[0, 0, 1], [0, 2, 3], [1, 0, 1]],
  });
  assert.equal(canonical.valid, true);
  assert.equal(isCellRevealed(canonical.mask, canonical.width, 0, 0), true);
  assert.equal(isCellRevealed(canonical.mask, canonical.width, 2, 0), true);
  assert.equal(isCellRevealed(canonical.mask, canonical.width, 0, 1), true);
});

// --- isCellRevealed: fail closed on bad queries -----------------------------------------------

test('isCellRevealed reports hidden for any out-of-bounds or malformed query rather than throwing', () => {
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 3, height: 3, enabled: true, revealedRuns: [[0, 0, 3]] });
  assert.equal(isCellRevealed(decoded.mask, decoded.width, -1, 0), false);
  assert.equal(isCellRevealed(decoded.mask, decoded.width, 3, 0), false);
  assert.equal(isCellRevealed(decoded.mask, decoded.width, 0, 3), false);
  assert.equal(isCellRevealed(decoded.mask, decoded.width, 1.5, 0), false);
  assert.equal(isCellRevealed(null, decoded.width, 0, 0), false);
  assert.equal(isCellRevealed(decoded.mask, 0, 0, 0), false);
});

test('QA regression: a ragged mask (length not a multiple of width) fails closed instead of reporting a revealed cell', () => {
  // length 5 is not a whole number of width-2 rows; row 2 (index 4) is a partial row.
  const ragged = Uint8Array.from([0, 0, 0, 0, 1]);
  assert.equal(isCellRevealed(ragged, 2, 0, 2), false);
  // Every other query against the same ragged mask must also fail closed.
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 2; x += 1) assert.equal(isCellRevealed(ragged, 2, x, y), false, `(${x},${y})`);
  }
});

// --- brush footprints ---------------------------------------------------------------------

test('1x1 brush addresses exactly the pointer cell', () => {
  assert.deepEqual(brushCells({ x: 4, y: 4, size: 1, width: 10, height: 10 }), [[4, 4]]);
});

test('2x2 brush anchors the pointer cell at its top-left member', () => {
  const cells = brushCells({ x: 4, y: 4, size: 2, width: 10, height: 10 });
  assert.deepEqual(cells.sort(), [[4, 4], [4, 5], [5, 4], [5, 5]].sort());
});

test('3x3 brush centers on the pointer cell', () => {
  const cells = brushCells({ x: 4, y: 4, size: 3, width: 10, height: 10 });
  const expected = [];
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) expected.push([4 + dx, 4 + dy]);
  assert.deepEqual(cells.sort(), expected.sort());
  assert.equal(cells.length, 9);
});

test('5x5 brush centers on the pointer cell', () => {
  const cells = brushCells({ x: 10, y: 10, size: 5, width: 20, height: 20 });
  assert.equal(cells.length, 25);
  assert.ok(cells.some(([x, y]) => x === 10 && y === 10));
  assert.ok(cells.some(([x, y]) => x === 8 && y === 8));
  assert.ok(cells.some(([x, y]) => x === 12 && y === 12));
});

test('brush footprints clip to bounds at edges and corners instead of rejecting the whole brush', () => {
  // Bottom-right corner: only the in-bounds member of a 2x2 brush survives.
  assert.deepEqual(brushCells({ x: 9, y: 9, size: 2, width: 10, height: 10 }), [[9, 9]]);

  // Top-left corner: a 3x3 brush clips to the 2x2 quadrant that stays on-board.
  const topLeft = brushCells({ x: 0, y: 0, size: 3, width: 10, height: 10 });
  assert.deepEqual(topLeft.sort(), [[0, 0], [1, 0], [0, 1], [1, 1]].sort());

  // A 5x5 brush at the very corner clips to a 3x3 quadrant.
  const corner5 = brushCells({ x: 0, y: 0, size: 5, width: 10, height: 10 });
  assert.equal(corner5.length, 9);
  assert.ok(corner5.every(([x, y]) => x >= 0 && x <= 2 && y >= 0 && y <= 2));
});

test('brush footprints are deterministic and contain no duplicate cells', () => {
  for (const size of [1, 2, 3, 5]) {
    const cells = brushCells({ x: 5, y: 5, size, width: 20, height: 20 });
    const keys = cells.map(([x, y]) => `${x},${y}`);
    assert.equal(new Set(keys).size, keys.length, `size ${size} produced duplicates`);
  }
});

test('an unsupported brush size yields no cells rather than guessing a footprint', () => {
  assert.deepEqual(brushCells({ x: 5, y: 5, size: 4, width: 20, height: 20 }), []);
});

// --- duplicate-cell normalization -----------------------------------------------------------

test('collapseCells removes duplicate [x, y] pairs, preserving first-seen order', () => {
  const input = [[1, 1], [2, 2], [1, 1], [3, 3], [2, 2], [1, 1]];
  assert.deepEqual(collapseCells(input), [[1, 1], [2, 2], [3, 3]]);
});

test('collapseCells ignores malformed entries rather than throwing', () => {
  assert.deepEqual(collapseCells([[1, 1], 'bad', [1], [1, 1, 1], [1.5, 1], null, [2, 2]]), [[1, 1], [2, 2]]);
  assert.deepEqual(collapseCells('not an array'), []);
});

// --- local preview never mutates the authoritative input mask ---------------------------------

test('applyFogPreview returns a new mask and never mutates the authoritative input', () => {
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 4, height: 4, enabled: true, revealedRuns: [] });
  const before = decoded.mask.slice();

  const previewed = applyFogPreview(decoded.mask, decoded.width, [[1, 1], [2, 2]], true);

  assert.deepEqual(decoded.mask, before); // untouched
  assert.notEqual(previewed, decoded.mask);
  assert.equal(isCellRevealed(previewed, decoded.width, 1, 1), true);
  assert.equal(isCellRevealed(previewed, decoded.width, 2, 2), true);
  assert.equal(isCellRevealed(decoded.mask, decoded.width, 1, 1), false);
});

test('applyFogPreview can hide previously revealed cells without touching the input', () => {
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 4, height: 4, enabled: true, revealedRuns: [[0, 0, 4]] });
  const previewed = applyFogPreview(decoded.mask, decoded.width, [[1, 0]], false);
  assert.equal(isCellRevealed(previewed, decoded.width, 1, 0), false);
  assert.equal(isCellRevealed(previewed, decoded.width, 0, 0), true);
  assert.equal(isCellRevealed(decoded.mask, decoded.width, 1, 0), true); // input unchanged
});

test('applyFogPreview clips out-of-bounds cells instead of throwing or corrupting the mask', () => {
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 4, height: 4, enabled: true, revealedRuns: [] });
  const previewed = applyFogPreview(decoded.mask, decoded.width, [[-1, 0], [4, 4], [2, 2]], true);
  assert.equal(previewed.length, decoded.mask.length);
  assert.equal(isCellRevealed(previewed, decoded.width, 2, 2), true);
});

test('a 200x200 preview stays fixed-size and bounded', () => {
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 200, height: 200, enabled: true, revealedRuns: [] });
  const cells = brushCells({ x: 100, y: 100, size: 5, width: 200, height: 200 });
  const previewed = applyFogPreview(decoded.mask, decoded.width, cells, true);
  assert.equal(previewed.length, 40000);
  assert.equal(countRevealed(previewed), 25);
});

// --- frontier segments: only Hidden/Revealed boundaries ----------------------------------------

test('frontierSegments reports only internal Hidden/Revealed boundaries, never the outer board edge', () => {
  // 3x3, only the center cell revealed: 4 internal boundaries, no boundary at the board edge.
  const decoded = decodeRevealedRuns({ levelId: 'lvl-1', width: 3, height: 3, enabled: true, revealedRuns: [[1, 1, 2]] });
  const segments = frontierSegments(decoded.mask, decoded.width, decoded.height);
  assert.equal(segments.length, 4);
  const asSet = new Set(segments.map(s => s.join(',')));
  assert.ok(asSet.has([1, 1, 2, 1].join(','))); // left edge of the revealed cell
  assert.ok(asSet.has([2, 1, 2, 2].join(','))); // right edge
  assert.ok(asSet.has([1, 1, 2, 1].join(',')));
});

test('a fully hidden or fully revealed board has no frontier', () => {
  const hidden = decodeRevealedRuns({ levelId: 'lvl-1', width: 4, height: 4, enabled: true, revealedRuns: [] });
  assert.deepEqual(frontierSegments(hidden.mask, hidden.width, hidden.height), []);

  const revealed = decodeRevealedRuns({ levelId: 'lvl-1', width: 4, height: 4, enabled: true, revealedRuns: [[0, 0, 4], [1, 0, 4], [2, 0, 4], [3, 0, 4]] });
  assert.deepEqual(frontierSegments(revealed.mask, revealed.width, revealed.height), []);
});

test('frontierSegments fails safe (empty) on malformed input rather than throwing', () => {
  assert.deepEqual(frontierSegments(null, 4, 4), []);
  assert.deepEqual(frontierSegments(new Uint8Array(15), 4, 4), []); // length mismatch
});
