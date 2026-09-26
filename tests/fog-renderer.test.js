import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderPlayerFog,
  renderManagementFog,
  buildPlayerFogStage,
  PLAYER_FOG_FILL,
  DM_FRONTIER_COLOR,
  DM_MANAGEMENT_FILL,
  DEFAULT_CELL_SIZE,
} from '../src/fog/fogRenderer.js';

const levelId = '55555555-5555-4555-8555-555555555555';

function baseFog(overrides = {}) {
  return {
    levelId,
    width: 4,
    height: 3,
    enabled: true,
    revealedRuns: [],
    ...overrides,
  };
}

/** Fake 2D-context-shaped recorder — no real canvas backend needed to test drawing logic. */
function createFakeContext() {
  const calls = [];
  let fillStyle = null;
  let strokeStyle = null;
  let lineWidth = null;
  return {
    calls,
    get fillStyle() { return fillStyle; },
    set fillStyle(value) { fillStyle = value; calls.push(['fillStyle', value]); },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(value) { strokeStyle = value; calls.push(['strokeStyle', value]); },
    get lineWidth() { return lineWidth; },
    set lineWidth(value) { lineWidth = value; calls.push(['lineWidth', value]); },
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    strokeRect: (...args) => calls.push(['strokeRect', ...args]),
    beginPath: (...args) => calls.push(['beginPath', ...args]),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    stroke: (...args) => calls.push(['stroke', ...args]),
  };
}

// --- renderPlayerFog: fail-closed contract ---

test('enabled fully hidden fog paints one opaque fill and punches nothing', () => {
  const ctx = createFakeContext();
  renderPlayerFog(ctx, baseFog());
  assert.deepEqual(ctx.calls, [
    ['fillStyle', PLAYER_FOG_FILL],
    ['fillRect', 0, 0, 4 * DEFAULT_CELL_SIZE, 3 * DEFAULT_CELL_SIZE],
  ]);
});

test('revealed runs punch transparent rectangles only inside the authoritative cells', () => {
  const ctx = createFakeContext();
  const cellSize = 10;
  renderPlayerFog(ctx, baseFog({ revealedRuns: [[1, 1, 3]] }), { cellSize });
  assert.deepEqual(ctx.calls, [
    ['fillStyle', PLAYER_FOG_FILL],
    ['fillRect', 0, 0, 40, 30],
    ['clearRect', 10, 10, 20, 10],
  ]);
});

test('multiple revealed runs across rows each punch their own authoritative rectangle only', () => {
  const ctx = createFakeContext();
  renderPlayerFog(ctx, baseFog({ revealedRuns: [[0, 0, 2], [2, 1, 4]] }), { cellSize: 1 });
  const clears = ctx.calls.filter(c => c[0] === 'clearRect');
  assert.deepEqual(clears, [
    ['clearRect', 0, 0, 2, 1],
    ['clearRect', 1, 2, 3, 1],
  ]);
});

test('valid enabled:false fog clears the stage and draws no opaque fill (base stage shows through)', () => {
  const ctx = createFakeContext();
  renderPlayerFog(ctx, baseFog({ enabled: false, revealedRuns: [[0, 0, 4]] }));
  assert.deepEqual(ctx.calls, [
    ['clearRect', 0, 0, 4 * DEFAULT_CELL_SIZE, 3 * DEFAULT_CELL_SIZE],
  ]);
  assert.ok(!ctx.calls.some(c => c[0] === 'fillStyle'), 'enabled:false never sets an opaque fill');
});

test('malformed revealedRuns (invalid payload) renders fully concealed, never partially revealed', () => {
  const ctx = createFakeContext();
  renderPlayerFog(ctx, baseFog({ revealedRuns: 'not-an-array' }));
  assert.deepEqual(ctx.calls, [
    ['fillStyle', PLAYER_FOG_FILL],
    ['fillRect', 0, 0, 4 * DEFAULT_CELL_SIZE, 3 * DEFAULT_CELL_SIZE],
  ]);
});

test('out-of-order/overlapping runs (invalid canonical form) render fully concealed', () => {
  const ctx = createFakeContext();
  renderPlayerFog(ctx, baseFog({ revealedRuns: [[1, 2, 4], [0, 0, 2]] }));
  assert.deepEqual(ctx.calls, [
    ['fillStyle', PLAYER_FOG_FILL],
    ['fillRect', 0, 0, 4 * DEFAULT_CELL_SIZE, 3 * DEFAULT_CELL_SIZE],
  ]);
});

test('a malformed enabled flag (non-boolean) renders fully concealed regardless of revealedRuns', () => {
  const ctx = createFakeContext();
  renderPlayerFog(ctx, baseFog({ enabled: 'nope', revealedRuns: [[0, 0, 4]] }));
  assert.deepEqual(ctx.calls, [
    ['fillStyle', PLAYER_FOG_FILL],
    ['fillRect', 0, 0, 4 * DEFAULT_CELL_SIZE, 3 * DEFAULT_CELL_SIZE],
  ]);
});

test('completely unusable fog (missing levelId/dimensions) draws nothing (0x0, nothing to expose)', () => {
  const ctx = createFakeContext();
  renderPlayerFog(ctx, { enabled: true, revealedRuns: [] });
  assert.deepEqual(ctx.calls, []);
});

test('null/undefined fog draws nothing', () => {
  const ctx = createFakeContext();
  renderPlayerFog(ctx, null);
  renderPlayerFog(ctx, undefined);
  assert.deepEqual(ctx.calls, []);
});

// --- DM-only gold frontier must never appear in player rendering ---

test('renderPlayerFog never references the DM gold frontier or management fill under any input', () => {
  const scenarios = [
    baseFog(),
    baseFog({ revealedRuns: [[0, 0, 4], [1, 1, 3], [2, 0, 4]] }),
    baseFog({ enabled: false }),
    baseFog({ revealedRuns: 'garbage' }),
    { garbage: true },
    null,
  ];
  for (const fog of scenarios) {
    const ctx = createFakeContext();
    renderPlayerFog(ctx, fog);
    const styleValues = ctx.calls.filter(c => c[0] === 'fillStyle' || c[0] === 'strokeStyle').map(c => c[1]);
    assert.ok(!styleValues.includes(DM_FRONTIER_COLOR), 'no gold frontier color used');
    assert.ok(!styleValues.includes(DM_MANAGEMENT_FILL), 'no DM management fill used');
    assert.equal(typeof ctx.calls.find(c => c[0] === 'strokeRect' || c[0] === 'stroke'), 'undefined', 'no stroke drawing at all in player rendering');
  }
});

// --- 200x200 stays bounded: O(runs), never one draw call per cell ---

test('a 200x200 board with sparse revealed runs issues a bounded number of draw calls, not one per cell', () => {
  const ctx = createFakeContext();
  const runs = [];
  for (let y = 0; y < 200; y += 1) runs.push([y, 0, 50]); // one run per row = 200 runs
  renderPlayerFog(ctx, baseFog({ width: 200, height: 200, revealedRuns: runs }), { cellSize: 1 });
  // exactly: 1 fillStyle + 1 fillRect + 200 clearRect (one per run), never 40,000 calls
  assert.equal(ctx.calls.length, 2 + 200);
});

// --- renderManagementFog: DM-only, separate visual contract, not wired anywhere yet ---

test('renderManagementFog uses the translucent management fill and the gold frontier, never the player fill', () => {
  const ctx = createFakeContext();
  renderManagementFog(ctx, baseFog({ revealedRuns: [[1, 1, 3]] }), { cellSize: 10 });
  const styleValues = ctx.calls.filter(c => c[0] === 'fillStyle' || c[0] === 'strokeStyle').map(c => c[1]);
  assert.ok(styleValues.includes(DM_MANAGEMENT_FILL));
  assert.ok(styleValues.includes(DM_FRONTIER_COLOR));
  assert.ok(!styleValues.includes(PLAYER_FOG_FILL));
});

test('renderManagementFog draws nothing for unusable fog identity/dimensions', () => {
  const ctx = createFakeContext();
  renderManagementFog(ctx, { enabled: true });
  assert.deepEqual(ctx.calls, []);
});

// --- buildPlayerFogStage: the shared DOM entry point boardViewRenderer.js calls ---

function makeDoc() {
  return new JSDOM('<!doctype html><div id="root"></div>').window.document;
}

test('buildPlayerFogStage builds a sized stage with a base substrate and one canvas, never one node per cell', () => {
  const doc = makeDoc();
  const stage = buildPlayerFogStage(doc, baseFog({ width: 10, height: 8 }));
  assert.ok(stage);
  assert.equal(stage.className, 'fog-player-stage');
  assert.equal(stage.children.length, 2, 'exactly base substrate + canvas, not one node per cell');
  const base = stage.querySelector('.fog-player-stage-base');
  const canvas = stage.querySelector('canvas.fog-player-canvas');
  assert.ok(base);
  assert.ok(canvas);
  assert.equal(canvas.width, 10 * DEFAULT_CELL_SIZE);
  assert.equal(canvas.height, 8 * DEFAULT_CELL_SIZE);
});

test('buildPlayerFogStage returns null when fog identity/dimensions cannot be trusted at all', () => {
  const doc = makeDoc();
  assert.equal(buildPlayerFogStage(doc, { enabled: true, revealedRuns: [] }), null);
  assert.equal(buildPlayerFogStage(doc, null), null);
});

test('buildPlayerFogStage never throws when getContext("2d") is unavailable (e.g. jsdom without a native canvas backend)', () => {
  const doc = makeDoc();
  assert.doesNotThrow(() => buildPlayerFogStage(doc, baseFog()));
});
