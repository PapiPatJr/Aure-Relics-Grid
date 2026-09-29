import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  isValidBoardExtent,
  computeTokenRectPercent,
  renderSpatialToken,
  buildSpatialTokenLayer,
  buildSpatialBoardStage,
} from '../src/board/spatialTokenRenderer.js';

function makeDoc() {
  return new JSDOM('<!doctype html><div id="root"></div>').window.document;
}

function token(overrides = {}) {
  return { id: 't1', kind: 'enemy', label: 'Goblin', x: 0, y: 0, width: 1, height: 1, isVisible: true, ...overrides };
}

// --- Geometry: computeTokenRectPercent ---

test('a 1x1 token at (0,0) occupies the top-left cell exactly', () => {
  const rect = computeTokenRectPercent(token({ x: 0, y: 0, width: 1, height: 1 }), 10, 10);
  assert.deepEqual(rect, { leftPct: 0, topPct: 0, widthPct: 10, heightPct: 10 });
});

test('a token at the bottom/right boundary is placed exactly, not clipped/guessed', () => {
  const rect = computeTokenRectPercent(token({ x: 9, y: 9, width: 1, height: 1 }), 10, 10);
  assert.deepEqual(rect, { leftPct: 90, topPct: 90, widthPct: 10, heightPct: 10 });
});

test('a larger width/height footprint spans the correct fraction of the board', () => {
  const rect = computeTokenRectPercent(token({ x: 2, y: 4, width: 3, height: 2 }), 20, 20);
  assert.deepEqual(rect, { leftPct: 10, topPct: 20, widthPct: 15, heightPct: 10 });
});

test('arbitrary non-square board dimensions compute independent x/y fractions', () => {
  const rect = computeTokenRectPercent(token({ x: 5, y: 1, width: 1, height: 1 }), 50, 4);
  assert.deepEqual(rect, { leftPct: 10, topPct: 25, widthPct: 2, heightPct: 25 });
});

test('a 200x200 board computes correctly at the far corner', () => {
  const rect = computeTokenRectPercent(token({ x: 199, y: 199, width: 1, height: 1 }), 200, 200);
  assert.deepEqual(rect, { leftPct: 99.5, topPct: 99.5, widthPct: 0.5, heightPct: 0.5 });
});

test('isValidBoardExtent rejects zero, negative, non-integer and non-numeric dimensions', () => {
  assert.equal(isValidBoardExtent(20, 20), true);
  assert.equal(isValidBoardExtent(0, 20), false);
  assert.equal(isValidBoardExtent(-1, 20), false);
  assert.equal(isValidBoardExtent(20.5, 20), false);
  assert.equal(isValidBoardExtent(null, 20), false);
  assert.equal(isValidBoardExtent(undefined, undefined), false);
});

// --- Invalid geometry fails safe (never guessed) ---

test('missing board dimensions: computeTokenRectPercent returns null, never a guessed rect', () => {
  assert.equal(computeTokenRectPercent(token(), null, null), null);
  assert.equal(computeTokenRectPercent(token(), 0, 0), null);
});

test('missing/invalid token coordinates return null', () => {
  assert.equal(computeTokenRectPercent(token({ x: null, y: 0 }), 10, 10), null);
  assert.equal(computeTokenRectPercent(token({ x: -1, y: 0 }), 10, 10), null);
  assert.equal(computeTokenRectPercent(token({ x: 1.5, y: 0 }), 10, 10), null);
  assert.equal(computeTokenRectPercent({ y: 0, width: 1, height: 1 }, 10, 10), null);
});

test('missing/invalid token size returns null — never defaulted to 1x1', () => {
  assert.equal(computeTokenRectPercent(token({ width: null }), 10, 10), null);
  assert.equal(computeTokenRectPercent(token({ width: 0 }), 10, 10), null);
  assert.equal(computeTokenRectPercent({ x: 0, y: 0, height: 1 }, 10, 10), null);
});

test('a token whose footprint would exceed the board extent returns null rather than clamping', () => {
  assert.equal(computeTokenRectPercent(token({ x: 9, y: 0, width: 2, height: 1 }), 10, 10), null);
  assert.equal(computeTokenRectPercent(token({ x: 0, y: 9, width: 1, height: 2 }), 10, 10), null);
});

// --- renderSpatialToken: DOM shape ---

test('renderSpatialToken places geometry as inline percentage styles and QA data attributes', () => {
  const doc = makeDoc();
  const el = renderSpatialToken(doc, token({ id: 'tok-1', kind: 'boss', x: 3, y: 4, width: 1, height: 1 }), { boardWidth: 10, boardHeight: 10 });
  assert.ok(el);
  assert.equal(el.style.left, '30%');
  assert.equal(el.style.top, '40%');
  assert.equal(el.style.width, '10%');
  assert.equal(el.style.height, '10%');
  assert.equal(el.dataset.spatialTokenId, 'tok-1');
  assert.equal(el.dataset.tokenKind, 'boss');
  assert.equal(el.dataset.tokenX, '3');
  assert.equal(el.dataset.tokenY, '4');
  assert.ok(el.classList.contains('spatial-token'));
  assert.ok(el.classList.contains('spatial-token--boss'));
});

test('renderSpatialToken returns null for a token with no id or unplaceable geometry — no guessed placement', () => {
  const doc = makeDoc();
  assert.equal(renderSpatialToken(doc, token({ id: null }), { boardWidth: 10, boardHeight: 10 }), null);
  assert.equal(renderSpatialToken(doc, token({ x: 50 }), { boardWidth: 10, boardHeight: 10 }), null);
});

test('renderSpatialToken never exposes secret information a QA attribute would leak: only fields already on the token', () => {
  const doc = makeDoc();
  const el = renderSpatialToken(doc, token({ label: 'Sneaky Goblin' }), { boardWidth: 10, boardHeight: 10 });
  assert.match(el.getAttribute('aria-label'), /Sneaky Goblin/);
  assert.match(el.title, /Sneaky Goblin/);
});

// --- Active-turn presentation ---

test('the active token receives the active styling class; others do not', () => {
  const doc = makeDoc();
  const active = renderSpatialToken(doc, token({ id: 't1' }), { boardWidth: 10, boardHeight: 10, isActive: true });
  const inactive = renderSpatialToken(doc, token({ id: 't2', x: 1 }), { boardWidth: 10, boardHeight: 10, isActive: false });
  assert.ok(active.classList.contains('spatial-token--active'));
  assert.ok(!inactive.classList.contains('spatial-token--active'));
  assert.match(active.getAttribute('aria-label'), /active turn/);
});

// --- Hidden (DM-only) treatment ---

test('showHiddenTreatment marks an isVisible:false token distinctly; a visible token is never marked', () => {
  const doc = makeDoc();
  const hidden = renderSpatialToken(doc, token({ id: 't1', isVisible: false }), { boardWidth: 10, boardHeight: 10, showHiddenTreatment: true });
  const visible = renderSpatialToken(doc, token({ id: 't2', x: 1, isVisible: true }), { boardWidth: 10, boardHeight: 10, showHiddenTreatment: true });
  assert.ok(hidden.classList.contains('spatial-token--hidden'));
  assert.match(hidden.getAttribute('aria-label'), /hidden from players/);
  assert.ok(!visible.classList.contains('spatial-token--hidden'));
});

test('without showHiddenTreatment (player/preview path), a hidden token is never marked — defense in depth even if one somehow appeared', () => {
  const doc = makeDoc();
  const el = renderSpatialToken(doc, token({ isVisible: false }), { boardWidth: 10, boardHeight: 10, showHiddenTreatment: false });
  assert.ok(!el.classList.contains('spatial-token--hidden'));
  assert.doesNotMatch(el.getAttribute('aria-label'), /hidden/);
});

// --- buildSpatialTokenLayer: projection + replacement + performance ---

test('buildSpatialTokenLayer renders exactly the tokens given, skipping unplaceable ones — no per-cell DOM explosion', () => {
  const doc = makeDoc();
  const tokens = [
    token({ id: 't1', x: 0, y: 0 }),
    token({ id: 't2', x: 199, y: 199 }),
    token({ id: 'bad', x: 500, y: 500 }), // out of bounds: skipped, not guessed
  ];
  const layer = buildSpatialTokenLayer(doc, { width: 200, height: 200, tokens });
  assert.ok(layer);
  assert.equal(layer.className, 'spatial-token-layer');
  assert.equal(layer.children.length, 2);
  assert.equal(layer.querySelectorAll('*').length, tokens.length * 0 + 2 + 2); // 2 tokens + 2 glyph spans, never 40,000
  assert.ok(layer.querySelector('[data-spatial-token-id="t1"]'));
  assert.ok(layer.querySelector('[data-spatial-token-id="t2"]'));
  assert.equal(layer.querySelector('[data-spatial-token-id="bad"]'), null);
});

test('buildSpatialTokenLayer returns null for an invalid board extent', () => {
  const doc = makeDoc();
  assert.equal(buildSpatialTokenLayer(doc, { width: 0, height: 0, tokens: [] }), null);
  assert.equal(buildSpatialTokenLayer(doc, { width: null, height: null, tokens: [] }), null);
});

test('an empty but valid board still returns an (empty) layer, not null', () => {
  const doc = makeDoc();
  const layer = buildSpatialTokenLayer(doc, { width: 20, height: 20, tokens: [] });
  assert.ok(layer);
  assert.equal(layer.children.length, 0);
});

test('a player-shaped tokens array (already recipient-filtered upstream) renders exactly what it is given, with no extra filtering here', () => {
  const doc = makeDoc();
  const layer = buildSpatialTokenLayer(doc, { width: 10, height: 10, tokens: [token({ id: 'visible-only' })] });
  assert.equal(layer.children.length, 1);
});

test('a DM management array containing a hidden token renders it (with showHiddenTreatment) — the layer does not perform authorization', () => {
  const doc = makeDoc();
  const layer = buildSpatialTokenLayer(doc, {
    width: 10, height: 10,
    tokens: [token({ id: 'visible' }), token({ id: 'hidden', x: 1, isVisible: false })],
    showHiddenTreatment: true,
  });
  assert.equal(layer.children.length, 2);
  assert.ok(layer.querySelector('[data-spatial-token-id="hidden"]').classList.contains('spatial-token--hidden'));
});

test('two independently-derived views for the same underlying state produce the same token count/positions (Player Screen vs DM Preview parity)', () => {
  const doc = makeDoc();
  const tokens = [token({ id: 't1', x: 1, y: 2 }), token({ id: 't2', x: 3, y: 4 })];
  const a = buildSpatialTokenLayer(doc, { width: 20, height: 20, tokens });
  const b = buildSpatialTokenLayer(doc, { width: 20, height: 20, tokens });
  assert.equal(a.children.length, b.children.length);
  for (let i = 0; i < a.children.length; i += 1) {
    assert.equal(a.children[i].style.left, b.children[i].style.left);
    assert.equal(a.children[i].style.top, b.children[i].style.top);
  }
});

test('replacement semantics: rebuilding the layer from a newer token list drops a token absent from it — no merge, no stale ghost', () => {
  const doc = makeDoc();
  const first = buildSpatialTokenLayer(doc, { width: 10, height: 10, tokens: [token({ id: 't1' }), token({ id: 't2', x: 1 })] });
  assert.equal(first.children.length, 2);
  const next = buildSpatialTokenLayer(doc, { width: 10, height: 10, tokens: [token({ id: 't1' })] });
  assert.equal(next.children.length, 1);
  assert.equal(next.querySelector('[data-spatial-token-id="t2"]'), null);
});

test('movement by snapshot: a newer token list with a changed x/y produces a token rendered at the new position — this never calls a mutation function', () => {
  const doc = makeDoc();
  const before = buildSpatialTokenLayer(doc, { width: 10, height: 10, tokens: [token({ id: 't1', x: 2, y: 2 })] });
  assert.equal(before.querySelector('[data-spatial-token-id="t1"]').style.left, '20%');

  const after = buildSpatialTokenLayer(doc, { width: 10, height: 10, tokens: [token({ id: 't1', x: 8, y: 2 })] });
  assert.equal(after.querySelector('[data-spatial-token-id="t1"]').style.left, '80%');
});

// --- buildSpatialBoardStage: DM management standalone stage ---

test('buildSpatialBoardStage sizes the stage from width/height and mounts a token layer inside it', () => {
  const doc = makeDoc();
  const stage = buildSpatialBoardStage(doc, { width: 15, height: 12, tokens: [token()] });
  assert.ok(stage);
  assert.equal(stage.className, 'spatial-board-stage');
  assert.equal(stage.style.getPropertyValue('--board-cols'), '15');
  assert.equal(stage.style.getPropertyValue('--board-rows'), '12');
  assert.ok(stage.querySelector('.spatial-board-stage-base'));
  assert.ok(stage.querySelector('.spatial-token-layer'));
  assert.equal(stage.querySelectorAll('.spatial-token').length, 1);
});

test('buildSpatialBoardStage returns null for an invalid board extent, mirroring buildPlayerFogStage', () => {
  const doc = makeDoc();
  assert.equal(buildSpatialBoardStage(doc, { width: 0, height: 0, tokens: [] }), null);
});

// --- Performance guardrail: 200x200 board, DOM scales with tokens, not cells ---

test('a 200x200 board with five tokens creates a small fixed number of DOM nodes, never 40,000', () => {
  const doc = makeDoc();
  const tokens = Array.from({ length: 5 }, (_, i) => token({ id: `t${i}`, x: i, y: i }));
  const stage = buildSpatialBoardStage(doc, { width: 200, height: 200, tokens });
  const nodeCount = stage.querySelectorAll('*').length;
  assert.ok(nodeCount < 20, `expected a small fixed node count, got ${nodeCount}`);
});
