import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createFogEditor, gridLineCells } from '../src/fog/fogEditor.js';
import { brushCells } from '../src/fog/fogMask.js';

const SOURCE_PATH = 'src/fog/fogEditor.js';
const CSS_PATH = 'src/fog/fog.css';
const levelId = '66666666-6666-4666-8666-666666666666';
const otherLevelId = '77777777-7777-4777-8777-777777777777';

function sortCells(cells) {
  return [...cells].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
}

// jsdom's PointerEvent support is inconsistent (see tests/realtime-board-bridge.test.js); this
// codebase's convention is a plain MouseEvent carrying the type/fields the handlers actually
// read (clientX/clientY/button, optionally pointerId).
function pointerEvent(win, type, { clientX = 0, clientY = 0, button = 0, pointerId } = {}) {
  const event = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button });
  if (pointerId !== undefined) Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

function keyEvent(win, type, key) {
  return new win.KeyboardEvent(type, { bubbles: true, cancelable: true, key });
}

/**
 * Build a synthetic `.grid-frame`/`#grid` pair with controlled `getBoundingClientRect` values,
 * per plan step 5.1 ("Use jsdom with a synthetic .grid-frame/#grid and controlled
 * getBoundingClientRect values"). Default: a 20x20 board rendered at exactly 20px/cell starting
 * at the viewport origin, so cell (x,y) sits at client pixels [x*20, (x+1)*20).
 */
function buildBoard({ width = 20, height = 20, cellSize = 20, left = 0, top = 0 } = {}) {
  const dom = new JSDOM('<!doctype html><div class="grid-frame"><div id="grid"></div></div>');
  const { window } = dom;
  const frame = window.document.querySelector('.grid-frame');
  const grid = window.document.getElementById('grid');

  frame.getBoundingClientRect = () => ({ left: 0, top: 0, right: width * cellSize, bottom: height * cellSize, width: width * cellSize, height: height * cellSize });
  grid.getBoundingClientRect = () => ({ left, top, right: left + width * cellSize, bottom: top + height * cellSize, width: width * cellSize, height: height * cellSize });

  return { dom, window, frame, grid, width, height, cellSize };
}

function baseFog(overrides = {}) {
  return { levelId, width: 20, height: 20, enabled: true, revealedRuns: [], ...overrides };
}

function strokesRecorder() {
  const calls = [];
  const onStroke = stroke => calls.push(stroke);
  onStroke.calls = calls;
  return onStroke;
}

function clientPointFor(cellSize, x, y) {
  return { clientX: x * cellSize + cellSize / 2, clientY: y * cellSize + cellSize / 2 };
}

function drag(window, canvas, cellSize, cells, { pointerId = 1 } = {}) {
  const [first, ...rest] = cells;
  canvas.dispatchEvent(pointerEvent(window, 'pointerdown', { ...clientPointFor(cellSize, ...first), pointerId }));
  for (const cell of rest) {
    canvas.dispatchEvent(pointerEvent(window, 'pointermove', { ...clientPointFor(cellSize, ...cell), pointerId }));
  }
}

function release(window, canvas, cellSize, cell, { pointerId = 1 } = {}) {
  canvas.dispatchEvent(pointerEvent(window, 'pointerup', { ...clientPointFor(cellSize, ...cell), pointerId }));
}

function cellSetOf(cells) {
  return new Set(cells.map(([x, y]) => `${x},${y}`));
}

function assertSameCellSet(actualCells, expectedSet, message) {
  assert.deepEqual(cellSetOf(actualCells), expectedSet, message);
}

/**
 * Independent oracle for "which grid cells does a continuous straight pointer path cross between
 * two sampled cells". This exists specifically so the sparse-vs-dense traversal tests below cannot
 * pass merely because they compare the production `gridLineCells` helper against itself (10E-FIX2:
 * QA found the prior nontrivial-slope test did exactly that, and it could not have caught an
 * incorrect traversal implementation as a result).
 *
 * It reimplements only the trivial, uncontroversial coordinate mapping every pointer handler in
 * this codebase already uses — `floor(clientPixel / cellSize)` — and densely samples many points
 * along the real client-space straight line between the two cells' centers, exactly as if the
 * pointer had fired thousands of pointermove events along that route instead of one coalesced
 * jump. It never calls `gridLineCells`, `addBrushAt`, or any other piece of the production
 * interpolation, so it is a genuine independent ground truth, not a restatement of the code under
 * test.
 */
function denseOracleCellSet(cellSize, x0, y0, x1, y1, samples = 4000) {
  const start = clientPointFor(cellSize, x0, y0);
  const end = clientPointFor(cellSize, x1, y1);
  const cells = new Set();
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const clientX = start.clientX + t * (end.clientX - start.clientX);
    const clientY = start.clientY + t * (end.clientY - start.clientY);
    cells.add(`${Math.floor(clientX / cellSize)},${Math.floor(clientY / cellSize)}`);
  }
  return cells;
}

// --- Structural guarantee: no player-renderer/editor crossover, no mutation-bridge coupling ---

test('structural guarantee: fogEditor.js never references the player renderer or a mutation bridge', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  const forbidden = ['renderPlayerFog', 'buildPlayerFogStage', 'fog-player-stage', 'fog-player-canvas', 'fogMutations', 'realtime/engine', 'mutationBridge', 'Supabase', 'supabase'];
  for (const token of forbidden) {
    assert.ok(!source.includes(token), `${SOURCE_PATH} must not reference "${token}"`);
  }
});

// --- Fog Mode activation / suppression (plan Task 5 review checkpoint) ---

test('inactive editor has pointer-events:none and does not intercept legacy board interaction', () => {
  const { frame } = buildBoard();
  const onStroke = strokesRecorder();
  createFogEditor({ frame, grid: frame.querySelector('#grid'), onStroke });
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  assert.equal(canvas.style.pointerEvents, 'none');
});

test('active Fog Mode sets pointer-events:auto and owns pointer painting', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  assert.equal(canvas.style.pointerEvents, 'auto');

  const event = pointerEvent(window, 'pointerdown', { ...clientPointFor(cellSize, 2, 2), pointerId: 1 });
  canvas.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, 'active Fog Mode must prevent the underlying map drag gesture');
});

test('no suppression while inactive: dispatching pointer events on the overlay is a no-op', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvas, cellSize, [[1, 1], [2, 2]]);
  release(window, canvas, cellSize, [2, 2]);
  assert.equal(onStroke.calls.length, 0);
});

test('pan/zoom remains available: the editor never blocks wheel events', () => {
  const { window, frame, grid } = buildBoard();
  const editor = createFogEditor({ frame, grid, onStroke: strokesRecorder() });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  const wheelEvent = new window.WheelEvent('wheel', { bubbles: true, cancelable: true });
  canvas.dispatchEvent(wheelEvent);
  assert.equal(wheelEvent.defaultPrevented, false);
});

// --- Touch navigation coexistence (10E-FIX defect 3): no blanket touch-action block ---

test('the overlay installs no inline touch-action, active or inactive', () => {
  const { frame, grid } = buildBoard();
  const editor = createFogEditor({ frame, grid, onStroke: strokesRecorder() });
  editor.setFog(baseFog());
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  assert.equal(canvas.style.touchAction, '', 'inactive: no inline touch-action');

  editor.setActive(true);
  assert.equal(canvas.style.touchAction, '', 'active: still no inline touch-action');
});

test("fog.css's real cascade resolves the overlay to touch-action:auto, never :none", () => {
  // Exercises the actual shipped stylesheet's cascade (not a hand-copied assumption) through
  // jsdom's real CSSOM, the same way a real browser would resolve `.fog-editor-canvas`'s computed
  // style. This is what a blanket `touch-action: none` rule broke: the whole board would report
  // 'none' here regardless of the individual object being touched.
  const css = readFileSync(CSS_PATH, 'utf8');
  const dom = new JSDOM(`<!doctype html><style>${css}</style><div class="grid-frame"><div id="grid"></div></div>`);
  const { window } = dom;
  const frame = window.document.querySelector('.grid-frame');
  const grid = window.document.getElementById('grid');
  createFogEditor({ frame, grid, onStroke: strokesRecorder() });
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  assert.equal(window.getComputedStyle(canvas).touchAction, 'auto');
});

test('fog.css never reintroduces touch-action:none on the editor overlay rule', () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const ruleMatch = css.match(/\.fog-editor-canvas\s*\{[^}]*\}/);
  assert.ok(ruleMatch, '.fog-editor-canvas rule must exist in fog.css');
  assert.ok(!ruleMatch[0].includes('touch-action'), '.fog-editor-canvas must not set touch-action at all');
});

test('a native touch-pan takeover (pointercancel) discards the stroke cleanly, coexisting with navigation', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[6, 6], [7, 6]]);
  // The browser recognized the touch gesture as a pan/scroll and took it over natively, which
  // fires pointercancel at whatever element had the pointer — exactly like Escape/mode-exit, this
  // must discard the uncommitted stroke rather than fight the browser for the gesture.
  canvas.dispatchEvent(pointerEvent(window, 'pointercancel', { ...clientPointFor(cellSize, 7, 6), pointerId: 1 }));
  release(window, canvas, cellSize, [7, 6]);

  assert.equal(onStroke.calls.length, 0, 'a takeover-cancelled stroke must never commit');
});

// --- Reveal / Hide strokes and brush sizes ---

test('a completed Reveal stroke invokes onStroke exactly once with the completed cell set', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  editor.setMode('reveal');
  editor.setBrushSize(1);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[5, 5]]);
  release(window, canvas, cellSize, [5, 5]);

  assert.equal(onStroke.calls.length, 1);
  assert.deepEqual(onStroke.calls[0], { purpose: 'fog', levelId, mode: 'reveal', cells: [[5, 5]] });
});

test('a completed Hide stroke invokes onStroke exactly once with mode hide', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  editor.setMode('hide');
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[3, 4]]);
  release(window, canvas, cellSize, [3, 4]);

  assert.equal(onStroke.calls.length, 1);
  assert.deepEqual(onStroke.calls[0], { purpose: 'fog', levelId, mode: 'hide', cells: [[3, 4]] });
});

for (const size of [1, 2, 3, 5]) {
  test(`brush size ${size}x${size} reuses fogMask.brushCells geometry`, () => {
    const { window, frame, grid, cellSize } = buildBoard();
    const onStroke = strokesRecorder();
    const editor = createFogEditor({ frame, grid, onStroke });
    editor.setFog(baseFog());
    editor.setActive(true);
    editor.setBrushSize(size);
    const canvas = frame.querySelector('canvas.fog-editor-canvas');

    drag(window, canvas, cellSize, [[10, 10]]);
    release(window, canvas, cellSize, [10, 10]);

    const expected = brushCells({ x: 10, y: 10, size, width: 20, height: 20 }).sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    assert.deepEqual(onStroke.calls[0].cells, expected);
  });
}

// --- Sparse pointer sampling: supercover grid traversal between coalesced samples ---
// (10E-FIX defect 1, corrected in 10E-FIX2: independent re-verification found the prior
// Bresenham-based interpolation could omit cells a truly continuous pointer path crosses, and
// that the prior nontrivial-slope test used the production traversal function as its own
// expected value, so it could not have caught that gap. Every arbitrary-slope assertion below is
// checked against `denseOracleCellSet`, which never calls `gridLineCells`.)

test('gridLineCells: horizontal path is every intervening cell in order', () => {
  assert.deepEqual(gridLineCells(1, 1, 5, 1), [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
});

test('gridLineCells: vertical path is every intervening cell in order', () => {
  assert.deepEqual(gridLineCells(1, 1, 1, 5), [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
});

test('gridLineCells: exact diagonal path steps one cell per axis at a time', () => {
  assert.deepEqual(gridLineCells(0, 0, 4, 4), [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
});

test('gridLineCells: a single point (no movement) is just that one cell', () => {
  assert.deepEqual(gridLineCells(3, 3, 3, 3), [[3, 3]]);
});

test('gridLineCells: every step stays adjacent to the previous cell (path is always connected)', () => {
  for (const [x0, y0, x1, y1] of [[2, 9, 17, 3], [0, 0, 4, 2], [8, 8, 2, 5], [1, 1, 8, 3]]) {
    const path = gridLineCells(x0, y0, x1, y1);
    for (let i = 1; i < path.length; i += 1) {
      const [px, py] = path[i - 1];
      const [x, y] = path[i];
      assert.ok(Math.abs(x - px) <= 1 && Math.abs(y - py) <= 1, `[${x0},${y0}]->[${x1},${y1}] step ${i} [${px},${py}]->[${x},${y}] is not adjacent`);
    }
  }
});

test('gridLineCells: forward and backward traversal always produce the same cell set (property check)', () => {
  // Unlike plain Bresenham, this supercover traversal's step decision at each point depends only
  // on the magnitudes (nx, ny), never on direction — so reversing the endpoints always reverses
  // the emitted order without ever changing the set of cells, for every slope, not only
  // axis-aligned/45-degree ones.
  const pairs = [
    [1, 1, 5, 1], [1, 1, 1, 5], [0, 0, 4, 4], // axis-aligned / exact diagonal
    [0, 0, 4, 2], [1, 1, 8, 3], [2, 1, 4, 9], [8, 8, 2, 5], [3, 7, 11, 2], // arbitrary slopes
    [5, 5, 5, 5], // no movement
  ];
  for (const [x0, y0, x1, y1] of pairs) {
    const forward = cellSetOf(gridLineCells(x0, y0, x1, y1));
    const backward = cellSetOf(gridLineCells(x1, y1, x0, y0));
    assert.deepEqual(forward, backward, `[${x0},${y0}] <-> [${x1},${y1}] must be symmetric`);
  }
});

test('sparse horizontal pointer movement fills every intervening cell', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  // Only two samples arrive (pointerdown at (1,1), one coalesced pointermove at (5,1)) — the
  // browser dropped every intermediate pointermove under fast motion.
  drag(window, canvas, cellSize, [[1, 1], [5, 1]]);
  release(window, canvas, cellSize, [5, 1]);

  assert.deepEqual(onStroke.calls[0].cells, [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
});

test('sparse vertical pointer movement fills every intervening cell', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[1, 1], [1, 5]]);
  release(window, canvas, cellSize, [1, 5]);

  assert.deepEqual(onStroke.calls[0].cells, [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
});

test('sparse diagonal pointer movement produces a continuous path', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[0, 0], [4, 4]]);
  release(window, canvas, cellSize, [4, 4]);

  assert.deepEqual(onStroke.calls[0].cells, [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
});

// --- Arbitrary-slope traversal, verified against the independent dense-sampling oracle ---

test('(0,0) -> (4,2): sparse jump matches the independently sampled dense-path reference exactly', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[0, 0], [4, 2]]);
  release(window, canvas, cellSize, [4, 2]);

  const expected = [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [3, 2], [4, 2]];
  assert.deepEqual(onStroke.calls[0].cells, expected, 'must match the independently expected cell set exactly, including [1,0] and [3,1]');
  assertSameCellSet(onStroke.calls[0].cells, denseOracleCellSet(cellSize, 0, 0, 4, 2));
});

test('(4,2) -> (0,0): the reverse jump produces the exact same cell set as the forward direction', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[4, 2], [0, 0]]);
  release(window, canvas, cellSize, [0, 0]);

  const expected = [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [3, 2], [4, 2]]; // same set as the forward test above
  assert.deepEqual(onStroke.calls[0].cells, expected);
  assertSameCellSet(onStroke.calls[0].cells, denseOracleCellSet(cellSize, 4, 2, 0, 0));
});

test('(1,1) -> (8,3): a shallow slope includes every cell the dense oracle crosses', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[1, 1], [8, 3]]);
  release(window, canvas, cellSize, [8, 3]);

  const expected = [[1, 1], [2, 1], [3, 1], [3, 2], [4, 2], [5, 2], [6, 2], [6, 3], [7, 3], [8, 3]];
  assert.deepEqual(onStroke.calls[0].cells, expected);
  assertSameCellSet(onStroke.calls[0].cells, denseOracleCellSet(cellSize, 1, 1, 8, 3));
});

test('(2,1) -> (4,9): a steep slope includes every cell the dense oracle crosses', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[2, 1], [4, 9]]);
  release(window, canvas, cellSize, [4, 9]);

  const expected = [[2, 1], [2, 2], [2, 3], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7], [4, 7], [4, 8], [4, 9]];
  assert.deepEqual(onStroke.calls[0].cells, expected);
  assertSameCellSet(onStroke.calls[0].cells, denseOracleCellSet(cellSize, 2, 1, 4, 9));
});

test('(8,8) -> (2,5): a negative-direction slope includes every cell the dense oracle crosses', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[8, 8], [2, 5]]);
  release(window, canvas, cellSize, [2, 5]);

  const expected = [[2, 5], [3, 5], [3, 6], [4, 6], [5, 6], [5, 7], [6, 7], [7, 7], [7, 8], [8, 8]];
  assert.deepEqual(onStroke.calls[0].cells, expected);
  assertSameCellSet(onStroke.calls[0].cells, denseOracleCellSet(cellSize, 8, 8, 2, 5));
});

test('sparse single-jump strokes match the independent dense-sampling oracle across a range of slopes (property check)', () => {
  const pairs = [
    [0, 0, 4, 2], [4, 2, 0, 0], [1, 1, 8, 3], [2, 1, 4, 9], [8, 8, 2, 5], [3, 7, 11, 2],
    [0, 0, 9, 1], [0, 0, 1, 9], [1, 1, 5, 1], [1, 1, 1, 5], [0, 0, 4, 4], [6, 6, 6, 6],
  ];
  for (const [x0, y0, x1, y1] of pairs) {
    const { window, frame, grid, cellSize } = buildBoard();
    const onStroke = strokesRecorder();
    const editor = createFogEditor({ frame, grid, onStroke });
    editor.setFog(baseFog());
    editor.setActive(true);
    const canvas = frame.querySelector('canvas.fog-editor-canvas');

    drag(window, canvas, cellSize, [[x0, y0], [x1, y1]]);
    release(window, canvas, cellSize, [x1, y1]);

    assertSameCellSet(
      onStroke.calls[0].cells,
      denseOracleCellSet(cellSize, x0, y0, x1, y1),
      `[${x0},${y0}]->[${x1},${y1}] sparse result must equal the independent dense-path oracle`,
    );
  }
});

test('reverse-direction movement within one stroke still produces the full continuous path once, deduped', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  // Sparse jump out to (5,1), then a sparse jump back past the start to (0,1): the two directions
  // overlap heavily and must collapse to one deduped, deterministic path.
  drag(window, canvas, cellSize, [[1, 1], [5, 1], [0, 1]]);
  release(window, canvas, cellSize, [0, 1]);

  assert.deepEqual(onStroke.calls[0].cells, [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
});

test('a larger brush stays continuous under an arbitrary sparse path, verified against the independent oracle', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  editor.setBrushSize(3);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[2, 2], [9, 5]]); // arbitrary slope, not axis-aligned
  release(window, canvas, cellSize, [9, 5]);

  // The path itself comes from the independent oracle (never from gridLineCells); only the brush
  // expansion at each oracle cell reuses the existing, already-covered fogMask.brushCells.
  const oraclePath = Array.from(denseOracleCellSet(cellSize, 2, 2, 9, 5)).map(key => key.split(',').map(Number));
  const expected = new Map();
  for (const [x, y] of oraclePath) {
    for (const cell of brushCells({ x, y, size: 3, width: 20, height: 20 })) {
      expected.set(`${cell[0]},${cell[1]}`, cell);
    }
  }
  assert.deepEqual(onStroke.calls[0].cells, sortCells(Array.from(expected.values())));
});

test('a backtracked/repeated sparse path still normalizes to the deduped set with no duplicates', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  // Sparse forward jump, then a sparse jump that backtracks entirely over the same span twice.
  drag(window, canvas, cellSize, [[3, 3], [8, 3], [3, 3], [8, 3]]);
  release(window, canvas, cellSize, [8, 3]);

  const cells = onStroke.calls[0].cells;
  const keys = cells.map(([x, y]) => `${x},${y}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate cells in the committed payload');
  assert.deepEqual(cells, [[3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3]]);
});

test('a backtracked arbitrary-slope path also normalizes to the deduped set with no duplicates', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  // Sparse diagonal-ish forward jump, then a jump that retraces the same span, then forward again.
  drag(window, canvas, cellSize, [[0, 0], [4, 2], [0, 0], [4, 2]]);
  release(window, canvas, cellSize, [4, 2]);

  const cells = onStroke.calls[0].cells;
  const keys = cells.map(([x, y]) => `${x},${y}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate cells in the committed payload');
  assertSameCellSet(cells, denseOracleCellSet(cellSize, 0, 0, 4, 2));
});

// --- Shift temporary inversion ---

test('Shift temporarily inverts Reveal to Hide for the stroke', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  editor.setMode('reveal');
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  window.document.dispatchEvent(keyEvent(window, 'keydown', 'Shift'));
  drag(window, canvas, cellSize, [[6, 6]]);
  release(window, canvas, cellSize, [6, 6]);

  assert.equal(onStroke.calls[0].mode, 'hide');
});

test('Shift temporarily inverts Hide to Reveal for the stroke', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  editor.setMode('hide');
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  window.document.dispatchEvent(keyEvent(window, 'keydown', 'Shift'));
  drag(window, canvas, cellSize, [[7, 7]]);
  release(window, canvas, cellSize, [7, 7]);

  assert.equal(onStroke.calls[0].mode, 'reveal');
});

test('releasing Shift restores the selected base tool for the next stroke', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  editor.setMode('reveal');
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  window.document.dispatchEvent(keyEvent(window, 'keydown', 'Shift'));
  window.document.dispatchEvent(keyEvent(window, 'keyup', 'Shift'));
  drag(window, canvas, cellSize, [[8, 8]]);
  release(window, canvas, cellSize, [8, 8]);

  assert.equal(onStroke.calls[0].mode, 'reveal');
});

test('the base tool itself never changes because of a temporary Shift inversion', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  editor.setMode('reveal');
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  window.document.dispatchEvent(keyEvent(window, 'keydown', 'Shift'));
  drag(window, canvas, cellSize, [[1, 1]]);
  release(window, canvas, cellSize, [1, 1]);
  window.document.dispatchEvent(keyEvent(window, 'keyup', 'Shift'));

  // No explicit setMode('reveal') call here: the base tool was never overwritten by Shift.
  drag(window, canvas, cellSize, [[2, 2]]);
  release(window, canvas, cellSize, [2, 2]);

  assert.equal(onStroke.calls[0].mode, 'hide'); // inverted stroke
  assert.equal(onStroke.calls[1].mode, 'reveal'); // base tool, unaffected
});

// --- Local preview only / one mutation opportunity ---

test('pointer movement updates local preview only: no onStroke during intermediate pointermove', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.equal(onStroke.calls.length, 0, 'no mutation opportunity before pointer release');

  release(window, canvas, cellSize, [3, 0]);
  assert.equal(onStroke.calls.length, 1, 'exactly one mutation opportunity on completed stroke');
});

test('a drag across many cells produces exactly one onStroke call, not one per cell', () => {
  const { window, frame, grid, cellSize } = buildBoard({ width: 60, height: 60 });
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog({ width: 60, height: 60 }));
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  const cells = Array.from({ length: 50 }, (_, i) => [i, 0]);
  drag(window, canvas, cellSize, cells);
  release(window, canvas, cellSize, [49, 0]);

  assert.equal(onStroke.calls.length, 1);
  assert.equal(onStroke.calls[0].cells.length, 50);
});

test('duplicate cells from pointer movement collapse before commit', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  // Drag back and forth over the same three cells repeatedly.
  drag(window, canvas, cellSize, [[4, 4], [5, 4], [4, 4], [5, 4], [6, 4], [5, 4], [4, 4]]);
  release(window, canvas, cellSize, [4, 4]);

  assert.deepEqual(onStroke.calls[0].cells, [[4, 4], [5, 4], [6, 4]]);
});

test('a stroke produces a deterministic payload regardless of the drag path direction', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStrokeA = strokesRecorder();
  const editorA = createFogEditor({ frame, grid, onStroke: onStrokeA });
  editorA.setFog(baseFog());
  editorA.setActive(true);
  const canvasA = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvasA, cellSize, [[2, 2], [3, 2], [4, 2]]);
  release(window, canvasA, cellSize, [4, 2]);

  const { window: window2, frame: frame2, grid: grid2, cellSize: cellSize2 } = buildBoard();
  const onStrokeB = strokesRecorder();
  const editorB = createFogEditor({ frame: frame2, grid: grid2, onStroke: onStrokeB });
  editorB.setFog(baseFog());
  editorB.setActive(true);
  const canvasB = frame2.querySelector('canvas.fog-editor-canvas');
  drag(window2, canvasB, cellSize2, [[4, 2], [3, 2], [2, 2]]);
  release(window2, canvasB, cellSize2, [2, 2]);

  assert.deepEqual(onStrokeA.calls[0].cells, onStrokeB.calls[0].cells);
});

test('no cells painted (pointer never enters a valid cell) commits nothing', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  canvas.dispatchEvent(pointerEvent(window, 'pointerdown', { clientX: -500, clientY: -500, pointerId: 1 }));
  canvas.dispatchEvent(pointerEvent(window, 'pointerup', { clientX: -500, clientY: -500, pointerId: 1 }));

  assert.equal(onStroke.calls.length, 0);
});

// --- Cancel behavior ---

test('Escape cancels an unfinished stroke with no commit', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[9, 9], [10, 9]]);
  window.document.dispatchEvent(keyEvent(window, 'keydown', 'Escape'));
  release(window, canvas, cellSize, [10, 9]); // a stray pointerup after Escape must not resurrect the stroke

  assert.equal(onStroke.calls.length, 0);
});

test('leaving Fog Mode discards uncommitted preview without mutating', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[11, 11], [12, 11]]);
  editor.setActive(false);
  release(window, canvas, cellSize, [12, 11]); // listeners detached: this is a no-op anyway

  assert.equal(onStroke.calls.length, 0);
});

test('cancelPreview() is callable directly and discards without mutating', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[13, 13]]);
  editor.cancelPreview();
  release(window, canvas, cellSize, [13, 13]);

  assert.equal(onStroke.calls.length, 0);
});

// --- Authoritative-context safety: a level/board change mid-stroke cancels it (10E-FIX defect 2) ---

test('a level change mid-stroke cancels the stroke: the stray pointerup emits nothing', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog({ levelId }));
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[4, 4], [5, 4]]); // accumulate cells under `levelId`
  editor.setFog(baseFog({ levelId: otherLevelId })); // authoritative context now targets a different level
  release(window, canvas, cellSize, [5, 4]); // stray pointerup for the now-cancelled stroke

  assert.equal(onStroke.calls.length, 0, 'no stale cells may be committed to the new level');
});

test('a board-dimension change mid-stroke also cancels the stroke', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog({ levelId, width: 20, height: 20 }));
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[4, 4]]);
  editor.setFog(baseFog({ levelId, width: 30, height: 30 })); // same level, but now a different shape
  release(window, canvas, cellSize, [4, 4]);

  assert.equal(onStroke.calls.length, 0);
});

test('an ordinary same-level fog refresh mid-stroke does NOT cancel the in-progress stroke', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog({ levelId }));
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[4, 4]]);
  // Same level/dimensions, only the revealed content differs — e.g. another manager's committed
  // stroke arriving over realtime. This must not discard an unrelated in-progress local stroke.
  editor.setFog(baseFog({ levelId, revealedRuns: [[0, 0, 1]] }));
  release(window, canvas, cellSize, [4, 4]);

  assert.equal(onStroke.calls.length, 1);
  assert.equal(onStroke.calls[0].levelId, levelId);
});

test('a fresh stroke on the new level works normally after a mid-stroke cancellation', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog({ levelId }));
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[4, 4], [5, 4]]);
  editor.setFog(baseFog({ levelId: otherLevelId }));
  release(window, canvas, cellSize, [5, 4]); // cancelled: emits nothing

  drag(window, canvas, cellSize, [[9, 9]]);
  release(window, canvas, cellSize, [9, 9]);

  assert.equal(onStroke.calls.length, 1);
  assert.deepEqual(onStroke.calls[0], { purpose: 'fog', levelId: otherLevelId, mode: 'reveal', cells: [[9, 9]] });
});

test('no stale cells from the cancelled stroke survive into the fresh stroke on the new level', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog({ levelId }));
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[1, 1], [2, 1]]); // old-level cells that must never resurface
  editor.setFog(baseFog({ levelId: otherLevelId }));
  release(window, canvas, cellSize, [2, 1]);

  drag(window, canvas, cellSize, [[10, 10]]);
  release(window, canvas, cellSize, [10, 10]);

  assert.deepEqual(onStroke.calls[0].cells, [[10, 10]], 'only the fresh stroke\'s own cell, no carry-over from the cancelled one');
});

// --- Named-area selection interaction ---

test('area purpose reports add/remove without ever using fog paint semantics', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  editor.setPurpose('area');
  editor.setMode('reveal');
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[14, 14]]);
  release(window, canvas, cellSize, [14, 14]);

  assert.deepEqual(onStroke.calls[0], { purpose: 'area', levelId, action: 'add', cells: [[14, 14]] });
});

test('area purpose Hide reports remove', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  editor.setPurpose('area');
  editor.setMode('hide');
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[15, 15]]);
  release(window, canvas, cellSize, [15, 15]);

  assert.deepEqual(onStroke.calls[0], { purpose: 'area', levelId, action: 'remove', cells: [[15, 15]] });
});

test('switching purpose mid-stroke discards the in-progress stroke rather than reinterpret it', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[16, 16]]);
  editor.setPurpose('area');
  release(window, canvas, cellSize, [16, 16]);

  assert.equal(onStroke.calls.length, 0);
});

test('overlay opacity and selected-area preview update without altering authoritative input or bounds', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  assert.doesNotThrow(() => editor.setOpacity(0.35));
  assert.doesNotThrow(() => editor.setSelectedCells([[1, 1], [2, 2]]));

  drag(window, canvas, cellSize, [[5, 5]]);
  release(window, canvas, cellSize, [5, 5]);

  assert.deepEqual(onStroke.calls[0], { purpose: 'fog', levelId, mode: 'reveal', cells: [[5, 5]] });
});

// --- Coordinate correctness ---

test('coordinate mapping accounts for board scaling (CSS size independent of cell count)', () => {
  // A 10x10 board displayed at 250x250 CSS pixels: 25px/cell, not the native 20px default.
  const { window, frame, grid } = buildBoard({ width: 10, height: 10, cellSize: 25 });
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog({ width: 10, height: 10 }));
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, 25, [[6, 3]]);
  release(window, canvas, 25, [6, 3]);

  assert.deepEqual(onStroke.calls[0].cells, [[6, 3]]);
});

test('edge cells map correctly at the top-left and bottom-right corners', () => {
  const { window, frame, grid, width, height, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[0, 0]]);
  release(window, canvas, cellSize, [0, 0]);
  assert.deepEqual(onStroke.calls[0].cells, [[0, 0]]);

  drag(window, canvas, cellSize, [[width - 1, height - 1]]);
  release(window, canvas, cellSize, [width - 1, height - 1]);
  assert.deepEqual(onStroke.calls[1].cells, [[width - 1, height - 1]]);
});

test('pointer positions outside the grid entirely never resolve to an out-of-bounds cell', () => {
  const { window, frame, grid, width, height, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  // Start just past the bottom-right edge, drag into a valid corner cell.
  canvas.dispatchEvent(pointerEvent(window, 'pointerdown', { clientX: width * cellSize + 100, clientY: height * cellSize + 100, pointerId: 1 }));
  canvas.dispatchEvent(pointerEvent(window, 'pointermove', { ...clientPointFor(cellSize, width - 1, height - 1), pointerId: 1 }));
  release(window, canvas, cellSize, [width - 1, height - 1]);

  assert.deepEqual(onStroke.calls[0].cells, [[width - 1, height - 1]]);
});

test('a 200x200 board clips brush coordinates to authoritative bounds at the corner', () => {
  const { window, frame, grid, cellSize } = buildBoard({ width: 200, height: 200, cellSize: 4 });
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog({ width: 200, height: 200 }));
  editor.setActive(true);
  editor.setBrushSize(5);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[0, 0]]);
  release(window, canvas, cellSize, [0, 0]);

  for (const [x, y] of onStroke.calls[0].cells) {
    assert.ok(x >= 0 && x < 200 && y >= 0 && y < 200, `cell [${x},${y}] must stay within [0,200)`);
  }
  // 5x5 centered on (0,0) clips to the 3x3 quadrant that stays in bounds.
  assert.equal(onStroke.calls[0].cells.length, 9);
});

test('a 200x200 board clips brush coordinates to authoritative bounds at the far corner', () => {
  const { window, frame, grid, cellSize } = buildBoard({ width: 200, height: 200, cellSize: 4 });
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog({ width: 200, height: 200 }));
  editor.setActive(true);
  editor.setBrushSize(5);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[199, 199]]);
  release(window, canvas, cellSize, [199, 199]);

  for (const [x, y] of onStroke.calls[0].cells) {
    assert.ok(x >= 0 && x < 200 && y >= 0 && y < 200, `cell [${x},${y}] must stay within [0,200)`);
  }
  assert.equal(onStroke.calls[0].cells.length, 9);
});

test('no cell is painted before setFog establishes authoritative board dimensions', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setActive(true); // no setFog() call yet
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[5, 5]]);
  release(window, canvas, cellSize, [5, 5]);

  assert.equal(onStroke.calls.length, 0);
});

// --- Editor teardown ---

test('dispose() removes the overlay canvas and stops reacting to further events', () => {
  const { window, frame, grid, cellSize } = buildBoard();
  const onStroke = strokesRecorder();
  const editor = createFogEditor({ frame, grid, onStroke });
  editor.setFog(baseFog());
  editor.setActive(true);
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[3, 3]]);
  editor.dispose();

  assert.equal(frame.querySelector('canvas.fog-editor-canvas'), null);
  assert.doesNotThrow(() => release(window, canvas, cellSize, [3, 3]));
  assert.equal(onStroke.calls.length, 0, 'no ghost stroke survives teardown');
});

test('dispose() is idempotent', () => {
  const { frame, grid } = buildBoard();
  const editor = createFogEditor({ frame, grid, onStroke: strokesRecorder() });
  editor.setFog(baseFog());
  editor.dispose();
  assert.doesNotThrow(() => editor.dispose());
});
