import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createBoardView, reconcileBoardView } from '../src/realtime/boardBridge.js';
import { computeTokenRectPercent, buildSpatialTokenLayer } from '../src/board/spatialTokenRenderer.js';

const session = '22222222-2222-4222-8222-222222222222';

function baseSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    sessionId: session,
    campaignId: '11111111-1111-4111-8111-111111111111',
    revision: '1',
    authority: { canManage: false, ownCharacterId: null },
    session: { id: session, name: 'Session', status: 'active', activeLevelId: null },
    roundNumber: 1,
    tokens: [],
    characters: [],
    initiative: [],
    dm: null,
    ...overrides,
  };
}

test('createBoardView populates tokens from the snapshot', () => {
  const view = createBoardView(baseSnapshot({ tokens: [{ id: 't1', kind: 'player', label: 'P1' }] }));
  assert.equal(view.tokens.length, 1);
  assert.equal(view.tokens[0].id, 't1');
});

test('a later snapshot omitting a previously-present token removes it from the view (replacement, not merge)', () => {
  const first = createBoardView(baseSnapshot({ revision: '1', tokens: [{ id: 't1', kind: 'player', label: 'P1' }, { id: 't2', kind: 'enemy', label: 'E1' }] }));
  const next = reconcileBoardView(first, baseSnapshot({ revision: '2', tokens: [{ id: 't1', kind: 'player', label: 'P1' }] }));
  assert.deepEqual(next.tokens.map(t => t.id), ['t1']);
});

test('roundNumber updates on a newer snapshot', () => {
  const first = createBoardView(baseSnapshot({ revision: '1', roundNumber: 1 }));
  const next = reconcileBoardView(first, baseSnapshot({ revision: '2', roundNumber: 2 }));
  assert.equal(next.roundNumber, 2);
});

test('initiative is replaced wholesale, not merged', () => {
  const first = createBoardView(baseSnapshot({ revision: '1', initiative: [{ id: 'i1', tokenId: 't1', initiative: 15, position: 0, isActive: true }] }));
  const next = reconcileBoardView(first, baseSnapshot({ revision: '2', initiative: [{ id: 'i2', tokenId: 't2', initiative: 12, position: 0, isActive: true }] }));
  assert.deepEqual(next.initiative.map(e => e.id), ['i2']);
});

test('a character public field update is reflected', () => {
  const first = createBoardView(baseSnapshot({ revision: '1', characters: [{ id: 'c1', name: 'Aria', hp: 10 }] }));
  const next = reconcileBoardView(first, baseSnapshot({ revision: '2', characters: [{ id: 'c1', name: 'Aria', hp: 7 }] }));
  assert.equal(next.characters[0].hp, 7);
});

test('a player-shaped snapshot (dm: null) can never produce a view with a truthy dm', () => {
  const view = createBoardView(baseSnapshot({ dm: null }));
  assert.equal(view.dm, null);
  const reconciled = reconcileBoardView(null, baseSnapshot({ dm: null }));
  assert.equal(reconciled.dm, null);
});

test('an owner-shaped snapshot\'s dm projection passes through unchanged', () => {
  const dm = { tokenDetails: [{ tokenId: 't1', actualHp: 4, maxHp: 10, dmNotes: 'secret' }], notes: [], activity: [] };
  const view = createBoardView(baseSnapshot({ dm }));
  assert.equal(view.dm, dm);
});

test('repeated identical snapshot is a safe no-op: the exact same previous view is returned by reference', () => {
  const snapshot = baseSnapshot({ revision: '3' });
  const first = createBoardView(snapshot);
  const again = reconcileBoardView(first, baseSnapshot({ revision: '3' }));
  assert.equal(again, first);
});

test('a stale/superseded snapshot does not regress the visible view', () => {
  const first = createBoardView(baseSnapshot({ revision: '5', roundNumber: 5 }));
  const stale = reconcileBoardView(first, baseSnapshot({ revision: '2', roundNumber: 999 }));
  assert.equal(stale, first);
  assert.equal(stale.roundNumber, 5);
});

test('a snapshot for a different session is always a fresh install, never compared to the old revision', () => {
  const first = createBoardView(baseSnapshot({ sessionId: session, revision: '99' }));
  const other = '33333333-3333-4333-8333-333333333333';
  const next = reconcileBoardView(first, baseSnapshot({ sessionId: other, revision: '1' }));
  assert.equal(next.sessionId, other);
  assert.equal(next.revision, '1');
});

// --- Issue #10 Task 4: top-level fog carried through as view.fog, replacement semantics ---

test('createBoardView carries snapshot.fog through as top-level view.fog', () => {
  const fog = { levelId: 'level-1', width: 4, height: 4, enabled: true, revealedRuns: [] };
  const view = createBoardView(baseSnapshot({ fog }));
  assert.equal(view.fog, fog);
});

test('createBoardView defaults view.fog to null when the snapshot has no fog field', () => {
  const view = createBoardView(baseSnapshot());
  assert.equal(view.fog, null);
});

test('a newer snapshot replaces fog wholesale, including clearing it back to null', () => {
  const fog = { levelId: 'level-1', width: 4, height: 4, enabled: true, revealedRuns: [[0, 0, 2]] };
  const first = createBoardView(baseSnapshot({ revision: '1', fog }));
  assert.equal(first.fog, fog);
  const next = reconcileBoardView(first, baseSnapshot({ revision: '2', fog: null }));
  assert.equal(next.fog, null);
});

test('a stale snapshot never regresses fog either', () => {
  const fog = { levelId: 'level-1', width: 4, height: 4, enabled: true, revealedRuns: [] };
  const first = createBoardView(baseSnapshot({ revision: '5', fog }));
  const stale = reconcileBoardView(first, baseSnapshot({ revision: '2', fog: null }));
  assert.equal(stale.fog, fog);
});

test('tokens are sorted deterministically (kind, then label, then id)', () => {
  const view = createBoardView(baseSnapshot({ tokens: [
    { id: 'b', kind: 'enemy', label: 'E2' },
    { id: 'a', kind: 'enemy', label: 'E1' },
    { id: 'c', kind: 'player', label: 'P1' },
  ] }));
  assert.deepEqual(view.tokens.map(t => t.id), ['a', 'b', 'c']);
});

// --- Legacy hook: read-only, never touches tokenData/grid/initiativeEntries, offline path unaffected ---

function bootLegacyBoardDom() {
  const html = readFileSync('index.html', 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://aure.example/' });
  dom.window.eval(readFileSync('script.js', 'utf8'));
  return dom;
}

test('window.aureRelicsApplyRealtimeSnapshot renders a BoardView read-only, without touching legacy board state', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    assert.equal(typeof window.aureRelicsApplyRealtimeSnapshot, 'function');

    const view = createBoardView(baseSnapshot({
      roundNumber: 3,
      tokens: [{ id: 't1', kind: 'player', label: 'P1', conditionLabel: 'Healthy' }],
      characters: [{ id: 'c1', name: 'Aria', playerName: 'Pat', hp: 9, maxHp: 12, ac: 15, statuses: ['Blessed'] }],
      initiative: [{ id: 'i1', tokenId: 't1', initiative: 15, position: 0, isActive: true }],
    }));

    window.aureRelicsApplyRealtimeSnapshot(view);

    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.ok(panel, 'panel is created');
    assert.equal(panel.hidden, false);
    assert.match(panel.textContent, /Round 3/);
    assert.match(panel.textContent, /P1/);
    assert.match(panel.textContent, /Aria/);
    assert.equal(panel.querySelector('.realtime-dm-section'), null); // dm: null -> no DM section rendered

    // Never touches the legacy state this panel must stay independent of.
    assert.equal(window.document.querySelectorAll('#grid .token').length, 0);
    assert.equal(window.document.getElementById('playerStatusBoard').children.length, 0);

    window.aureRelicsApplyRealtimeSnapshot(null);
    assert.equal(panel.hidden, true);
    assert.equal(panel.innerHTML, '');
  } finally {
    dom.window.close();
  }
});

test('the offline/local board still initializes and behaves normally with the realtime hook present', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    const doc = window.document;
    // initializeApp() already ran at script load; the grid is populated and a token can be placed
    // exactly as before, unaffected by the new realtime block appended after it.
    assert.equal(doc.querySelectorAll('#grid .cell').length, 20 * 20);
    doc.getElementById('playerToken').dispatchEvent(new window.Event('click', { bubbles: true }));
    // Placing directly via the exposed grid cell pointerdown handler (MouseEvent: jsdom's
    // PointerEvent support is inconsistent, and the handler only reads .button/.target).
    const cell = doc.querySelector('#grid .cell');
    cell.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    assert.equal(doc.querySelectorAll('#grid .token').length, 1);
    // Nothing in the offline path ever calls applyRealtimeSnapshot, so the panel isn't even created.
    assert.equal(doc.getElementById('realtimeSessionPanel'), null);
  } finally {
    dom.window.close();
  }
});

test('a manager (DM) view renders the round/token/initiative action buttons; a non-manager view renders none of them', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    const managerView = createBoardView(baseSnapshot({
      authority: { canManage: true, ownCharacterId: null },
      tokens: [{ id: 't1', kind: 'enemy', label: 'E1', isVisible: true }],
    }));
    window.aureRelicsApplyRealtimeSnapshot(managerView);
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.ok(panel.querySelector('[data-realtime-action="advance-round"]'));
    assert.ok(panel.querySelector('[data-realtime-action="toggle-token-visible"][data-token-id="t1"]'));
    assert.ok(panel.querySelector('[data-realtime-action="clear-initiative"]'));

    const playerView = createBoardView(baseSnapshot({
      authority: { canManage: false, ownCharacterId: null },
      tokens: [{ id: 't1', kind: 'enemy', label: 'E1', isVisible: true }],
    }));
    window.aureRelicsApplyRealtimeSnapshot(playerView);
    assert.equal(panel.querySelector('[data-realtime-action="advance-round"]'), null);
    assert.equal(panel.querySelector('[data-realtime-action="toggle-token-visible"]'), null);
    assert.equal(panel.querySelector('[data-realtime-action="clear-initiative"]'), null);
  } finally {
    dom.window.close();
  }
});

test('own-character HP controls render only for the character matching authority.ownCharacterId', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    const view = createBoardView(baseSnapshot({
      authority: { canManage: false, ownCharacterId: 'c1' },
      characters: [{ id: 'c1', name: 'Aria', hp: 5 }, { id: 'c2', name: 'Beorn', hp: 5 }],
    }));
    window.aureRelicsApplyRealtimeSnapshot(view);
    const panel = window.document.getElementById('realtimeSessionPanel');
    const ownCard = panel.querySelector('[data-character-id="c1"]');
    const otherCard = panel.querySelector('[data-character-id="c2"]');
    assert.ok(ownCard.querySelector('[data-realtime-action="adjust-own-hp"]'));
    assert.equal(otherCard.querySelector('[data-realtime-action="adjust-own-hp"]'), null);
  } finally {
    dom.window.close();
  }
});

// --- Tuesday Online Package 2B: DM management spatial board (#realtimeSessionPanel) ---

function spatialToken(overrides = {}) {
  return { id: 'st1', kind: 'enemy', label: 'Goblin', x: 0, y: 0, width: 1, height: 1, isVisible: true, ...overrides };
}

test('a manager view with fog+tokens spatially renders a .spatial-board-stage inside #realtimeSessionPanel', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    const view = createBoardView(baseSnapshot({
      authority: { canManage: true, ownCharacterId: null },
      dm: { tokenDetails: [], notes: [], activity: [] },
      fog: { levelId: 'level-1', width: 10, height: 10, enabled: true, revealedRuns: [] },
      tokens: [spatialToken({ x: 5, y: 5 })],
    }));
    window.aureRelicsApplyRealtimeSnapshot(view);
    const panel = window.document.getElementById('realtimeSessionPanel');
    const stage = panel.querySelector('.spatial-board-stage');
    assert.ok(stage, 'spatial board stage renders in the DM management panel');
    const el = stage.querySelector('[data-spatial-token-id="st1"]');
    assert.ok(el);
    assert.equal(el.style.left, '50%');
    assert.equal(el.style.top, '50%');
  } finally {
    dom.window.close();
  }
});

test('a DM-hidden token renders in the management stage with the hidden treatment', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    const view = createBoardView(baseSnapshot({
      authority: { canManage: true, ownCharacterId: null },
      dm: { tokenDetails: [], notes: [], activity: [] },
      fog: { levelId: 'level-1', width: 10, height: 10, enabled: true, revealedRuns: [] },
      tokens: [spatialToken({ id: 'visible' }), spatialToken({ id: 'hidden', x: 1, isVisible: false })],
    }));
    window.aureRelicsApplyRealtimeSnapshot(view);
    const panel = window.document.getElementById('realtimeSessionPanel');
    const hiddenEl = panel.querySelector('[data-spatial-token-id="hidden"]');
    assert.ok(hiddenEl.classList.contains('spatial-token--hidden'));
    assert.ok(!panel.querySelector('[data-spatial-token-id="visible"]').classList.contains('spatial-token--hidden'));
  } finally {
    dom.window.close();
  }
});

test('the active-initiative token gets spatial active styling in the DM management stage', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    const view = createBoardView(baseSnapshot({
      authority: { canManage: true, ownCharacterId: null },
      dm: { tokenDetails: [], notes: [], activity: [] },
      fog: { levelId: 'level-1', width: 10, height: 10, enabled: true, revealedRuns: [] },
      tokens: [spatialToken({ id: 'st1' }), spatialToken({ id: 'st2', x: 1 })],
      initiative: [{ id: 'i1', tokenId: 'st2', initiative: 15, position: 0, isActive: true }],
    }));
    window.aureRelicsApplyRealtimeSnapshot(view);
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.ok(panel.querySelector('[data-spatial-token-id="st2"]').classList.contains('spatial-token--active'));
    assert.ok(!panel.querySelector('[data-spatial-token-id="st1"]').classList.contains('spatial-token--active'));
  } finally {
    dom.window.close();
  }
});

test('no fog (no active level) means no spatial board stage in the DM management panel', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    const view = createBoardView(baseSnapshot({
      authority: { canManage: true, ownCharacterId: null },
      dm: { tokenDetails: [], notes: [], activity: [] },
      fog: null,
      tokens: [spatialToken()],
    }));
    window.aureRelicsApplyRealtimeSnapshot(view);
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.equal(panel.querySelector('.spatial-board-stage'), null);
  } finally {
    dom.window.close();
  }
});

test('a non-manager (player) view never renders the DM spatial board stage even if it somehow carried fog', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    const view = createBoardView(baseSnapshot({
      authority: { canManage: false, ownCharacterId: null },
      dm: null,
      fog: { levelId: 'level-1', width: 10, height: 10, enabled: true, revealedRuns: [] },
      tokens: [spatialToken()],
    }));
    window.aureRelicsApplyRealtimeSnapshot(view);
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.equal(panel.querySelector('.spatial-board-stage'), null);
  } finally {
    dom.window.close();
  }
});

test('replacement semantics: a rerender omitting a previously-rendered token removes its spatial element from the management stage', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    const fog = { levelId: 'level-1', width: 10, height: 10, enabled: true, revealedRuns: [] };
    const authority = { canManage: true, ownCharacterId: null };
    const dmField = { tokenDetails: [], notes: [], activity: [] };

    window.aureRelicsApplyRealtimeSnapshot(createBoardView(baseSnapshot({
      authority, dm: dmField, fog, tokens: [spatialToken({ id: 'gone' }), spatialToken({ id: 'stays', x: 1 })],
    })));
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.ok(panel.querySelector('[data-spatial-token-id="gone"]'));

    window.aureRelicsApplyRealtimeSnapshot(createBoardView(baseSnapshot({
      authority, dm: dmField, fog, tokens: [spatialToken({ id: 'stays', x: 1 })],
    })));
    assert.equal(panel.querySelector('[data-spatial-token-id="gone"]'), null);
    assert.ok(panel.querySelector('[data-spatial-token-id="stays"]'));
  } finally {
    dom.window.close();
  }
});

// --- Geometry parity: src/board/spatialTokenRenderer.js vs script.js's classic-script twin ---
//
// Package 2B necessarily duplicates the coordinate math once (script.js is a plain classic
// script and cannot import the shared ES module — see script.js's own "DM management spatial
// token board" comment block). This section proves the two production implementations actually
// agree, not just that each one matches a copy of the same formula pasted into this file: for
// each case it computes the shared module's answer directly, then renders a real snapshot
// through the genuine classic-script path (window.aureRelicsApplyRealtimeSnapshot, via the same
// dom.window.eval()-booted script.js every other test in this file already exercises) and reads
// back the actual inline geometry script.js produced. A future change to either formula alone,
// without the other, fails this test.

const PARITY_CASES = [
  { name: '1x1 at (0,0) on a 20x20 board', board: { width: 20, height: 20 }, token: { x: 0, y: 0, width: 1, height: 1 }, expected: { left: 0, top: 0, width: 5, height: 5 } },
  { name: '1x1 at the bottom-right corner of a 20x20 board', board: { width: 20, height: 20 }, token: { x: 19, y: 19, width: 1, height: 1 }, expected: { left: 95, top: 95, width: 5, height: 5 } },
  { name: 'a 2x3 footprint at (4,7) on a 20x20 board', board: { width: 20, height: 20 }, token: { x: 4, y: 7, width: 2, height: 3 }, expected: { left: 20, top: 35, width: 10, height: 15 } },
  { name: 'a 4x2 footprint at (11,5) on a non-square 30x12 board', board: { width: 30, height: 12 }, token: { x: 11, y: 5, width: 4, height: 2 }, expected: { left: 36.6667, top: 41.6667, width: 13.3333, height: 16.6667 } },
  { name: '1x1 at the far corner of a 200x200 board', board: { width: 200, height: 200 }, token: { x: 199, y: 199, width: 1, height: 1 }, expected: { left: 99.5, top: 99.5, width: 0.5, height: 0.5 } },
];

function approxEqual(actual, expected, tolerance = 0.001) {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ~${expected}, got ${actual}`);
}

/** Render one token through the real classic script.js path and read back its actual inline
 * percentage geometry, exactly as a browser would apply it — never a re-derivation of the
 * formula, so this exercises script.js's own genuine production code, not a stand-in for it. */
function renderViaClassicScript(window, board, token) {
  const view = createBoardView(baseSnapshot({
    authority: { canManage: true, ownCharacterId: null },
    dm: { tokenDetails: [], notes: [], activity: [] },
    fog: { levelId: 'parity-level', width: board.width, height: board.height, enabled: true, revealedRuns: [] },
    tokens: [{ id: 'parity-token', kind: 'enemy', label: 'Parity', isVisible: true, ...token }],
  }));
  window.aureRelicsApplyRealtimeSnapshot(view);
  const el = window.document.querySelector('#realtimeSessionPanel [data-spatial-token-id="parity-token"]');
  if (!el) return null;
  return {
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
  };
}

for (const { name, board, token, expected } of PARITY_CASES) {
  test(`geometry parity — ${name}: shared renderer and classic script.js agree, and both match the documented percentages`, () => {
    const shared = computeTokenRectPercent(token, board.width, board.height);
    assert.ok(shared, 'shared renderer placed the token');
    approxEqual(shared.leftPct, expected.left);
    approxEqual(shared.topPct, expected.top);
    approxEqual(shared.widthPct, expected.width);
    approxEqual(shared.heightPct, expected.height);

    const dom = bootLegacyBoardDom();
    try {
      const classic = renderViaClassicScript(dom.window, board, token);
      assert.ok(classic, 'classic script.js placed the token');
      approxEqual(classic.left, expected.left);
      approxEqual(classic.top, expected.top);
      approxEqual(classic.width, expected.width);
      approxEqual(classic.height, expected.height);

      // The actual parity assertion: both real implementations must agree with each other, not
      // merely with the documented constants above.
      approxEqual(classic.left, shared.leftPct);
      approxEqual(classic.top, shared.topPct);
      approxEqual(classic.width, shared.widthPct);
      approxEqual(classic.height, shared.heightPct);
    } finally {
      dom.window.close();
    }
  });
}

// --- Invalid geometry parity: both implementations must fail closed, never render a guess ---

const INVALID_GEOMETRY_CASES = [
  { name: 'missing board dimensions', board: { width: undefined, height: undefined }, token: { x: 0, y: 0, width: 1, height: 1 }, wholeBoardInvalid: true },
  { name: 'zero board width', board: { width: 0, height: 20 }, token: { x: 0, y: 0, width: 1, height: 1 }, wholeBoardInvalid: true },
  { name: 'non-integer coordinates', board: { width: 20, height: 20 }, token: { x: 1.5, y: 0, width: 1, height: 1 }, wholeBoardInvalid: false },
  { name: 'zero token width', board: { width: 20, height: 20 }, token: { x: 0, y: 0, width: 0, height: 1 }, wholeBoardInvalid: false },
  { name: 'an out-of-bounds footprint', board: { width: 20, height: 20 }, token: { x: 19, y: 0, width: 2, height: 1 }, wholeBoardInvalid: false },
];

for (const { name, board, token, wholeBoardInvalid } of INVALID_GEOMETRY_CASES) {
  test(`invalid geometry parity — ${name}: both implementations fail closed`, () => {
    const sharedRect = computeTokenRectPercent(token, board.width, board.height);
    assert.equal(sharedRect, null, 'shared renderer never guesses a placement');

    const doc = new JSDOM('<!doctype html><div id="root"></div>').window.document;
    const sharedLayer = buildSpatialTokenLayer(doc, { width: board.width, height: board.height, tokens: [{ id: 'invalid-token', kind: 'enemy', label: 'Bad', isVisible: true, ...token }] });
    if (wholeBoardInvalid) {
      assert.equal(sharedLayer, null, 'shared renderer refuses to build a layer for an invalid board extent');
    } else {
      assert.ok(sharedLayer, 'shared renderer still builds a layer for a valid board');
      assert.equal(sharedLayer.children.length, 0, 'the unplaceable token is skipped, not guessed');
    }

    const dom = bootLegacyBoardDom();
    try {
      renderViaClassicScript(dom.window, board, token);
      const panel = dom.window.document.getElementById('realtimeSessionPanel');
      if (wholeBoardInvalid) {
        assert.equal(panel.querySelector('.spatial-board-stage'), null, 'classic script.js renders no stage for an invalid board extent');
      } else {
        assert.ok(panel.querySelector('.spatial-board-stage'), 'classic script.js still renders a stage for a valid board');
        assert.equal(panel.querySelector('[data-spatial-token-id="parity-token"]'), null, 'the unplaceable token is skipped, not guessed');
      }
    } finally {
      dom.window.close();
    }
  });
}

// --- Tuesday Online Package 2C: DM gameplay controls rendered on #realtimeSessionPanel ---

function gameplayFog(overrides = {}) {
  return { levelId: 'level-1', width: 20, height: 20, enabled: true, revealedRuns: [], ...overrides };
}

function gameplayManagerView(overrides = {}) {
  return createBoardView(baseSnapshot({
    authority: { canManage: true, ownCharacterId: null },
    dm: { tokenDetails: [], notes: [], activity: [] },
    fog: gameplayFog(),
    tokens: [
      { id: 't1', kind: 'enemy', label: 'Goblin', x: 2, y: 3, width: 1, height: 1, isVisible: true, characterId: null },
      { id: 't2', kind: 'player', label: 'Aria', x: 0, y: 0, width: 1, height: 1, isVisible: true, characterId: 'c1' },
    ],
    characters: [{ id: 'c1', name: 'Aria', approved: true }, { id: 'c2', name: 'Beorn', approved: true }],
    initiative: [{ id: 'i1', tokenId: 't1', initiative: 10, position: 0, isActive: true }],
    ...overrides,
  }));
}

test('Prepare Board: shown for a manager with no active level, hidden once the board is prepared', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView({ fog: null, tokens: [] }));
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.ok(panel.querySelector('[data-testid="prepare-board"]'));

    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView());
    assert.equal(panel.querySelector('[data-testid="prepare-board"]'), null);
  } finally {
    dom.window.close();
  }
});

test('Prepare Board: never shown for a non-manager view', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(createBoardView(baseSnapshot({ authority: { canManage: false, ownCharacterId: null }, dm: null, fog: null })));
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.equal(panel.querySelector('[data-testid="prepare-board"]'), null);
  } finally {
    dom.window.close();
  }
});

test('Create Token: the form is rendered once a board exists, with kind/label/x/y/visibility fields', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView());
    const panel = window.document.getElementById('realtimeSessionPanel');
    const form = panel.querySelector('[data-testid="create-token"]');
    assert.ok(form);
    assert.equal(form.tagName, 'FORM');
    assert.ok(form.elements.namedItem('kind'));
    assert.ok(form.elements.namedItem('label'));
    assert.ok(form.elements.namedItem('x'));
    assert.ok(form.elements.namedItem('y'));
    assert.ok(form.elements.namedItem('isVisible'));
    assert.ok(form.querySelector('[data-testid="token-create-submit"]'));
  } finally {
    dom.window.close();
  }
});

test('Create Token: no form is rendered before the board is prepared (no active level to create onto)', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView({ fog: null, tokens: [] }));
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.equal(panel.querySelector('[data-testid="create-token"]'), null);
  } finally {
    dom.window.close();
  }
});

test('Create Token: the player-character select excludes a character that already has a token on the active level', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    // c1 already owns t2; c2 has no token yet.
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView());
    const panel = window.document.getElementById('realtimeSessionPanel');
    const characterSelect = panel.querySelector('[data-testid="create-token"] [name="characterId"]');
    assert.ok(characterSelect);
    const optionValues = Array.from(characterSelect.options).map(o => o.value);
    assert.ok(!optionValues.includes('c1'), 'c1 already has a token and must not be offered again');
    assert.ok(optionValues.includes('c2'));
  } finally {
    dom.window.close();
  }
});

test('Token selection: clicking a spatial token in the DM board selects it and shows the inspector prefilled with its position; clicking again deselects it', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView());
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.equal(panel.querySelector('[data-testid="token-inspector"]'), null);

    const tokenEl = panel.querySelector('[data-spatial-token-id="t1"]');
    tokenEl.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const inspector = panel.querySelector('[data-testid="token-inspector"]');
    assert.ok(inspector);
    assert.equal(inspector.querySelector('[data-move-x]').value, '2');
    assert.equal(inspector.querySelector('[data-move-y]').value, '3');
    assert.ok(inspector.querySelector('[data-realtime-action="move-token"][data-token-id="t1"]'));
    assert.ok(inspector.querySelector('[data-realtime-action="delete-token"][data-token-id="t1"]'));

    // Clicking the same token again toggles selection off.
    panel.querySelector('[data-spatial-token-id="t1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(panel.querySelector('[data-testid="token-inspector"]'), null);
  } finally {
    dom.window.close();
  }
});

test('Token selection: selecting a different token switches the inspector to it', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView());
    const panel = window.document.getElementById('realtimeSessionPanel');
    panel.querySelector('[data-spatial-token-id="t1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    panel.querySelector('[data-spatial-token-id="t2"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const inspector = panel.querySelector('[data-testid="token-inspector"]');
    assert.ok(inspector.querySelector('[data-realtime-action="move-token"][data-token-id="t2"]'));
    assert.equal(inspector.querySelectorAll('[data-realtime-action="move-token"]').length, 1);
  } finally {
    dom.window.close();
  }
});

test('Token selection is local UI state only: it never appears in the rendered view data and clears itself once the selected token is no longer in the snapshot', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView());
    const panel = window.document.getElementById('realtimeSessionPanel');
    panel.querySelector('[data-spatial-token-id="t1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(panel.querySelector('[data-testid="token-inspector"]'));

    // A newer snapshot in which t1 was deleted — the stale selection must not resurrect a
    // deleted token's inspector.
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView({ tokens: [{ id: 't2', kind: 'player', label: 'Aria', x: 0, y: 0, width: 1, height: 1, isVisible: true, characterId: 'c1' }] }));
    assert.equal(panel.querySelector('[data-testid="token-inspector"]'), null);
  } finally {
    dom.window.close();
  }
});

test('Initiative editor: lists every manager-visible token, pre-checked and pre-filled for tokens already in the initiative order', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView());
    const panel = window.document.getElementById('realtimeSessionPanel');
    const editor = panel.querySelector('[data-testid="initiative-editor"]');
    assert.ok(editor);
    const rows = editor.querySelectorAll('[data-initiative-row]');
    assert.equal(rows.length, 2);

    const t1Row = editor.querySelector('[data-initiative-row][data-token-id="t1"]');
    assert.equal(t1Row.querySelector('[data-initiative-include]').checked, true);
    assert.equal(t1Row.querySelector('[data-initiative-value]').value, '10');

    const t2Row = editor.querySelector('[data-initiative-row][data-token-id="t2"]');
    assert.equal(t2Row.querySelector('[data-initiative-include]').checked, false);

    assert.ok(editor.querySelector('[data-testid="initiative-submit"]'));
  } finally {
    dom.window.close();
  }
});

test('Next Turn: shown once an initiative order exists, absent when it is empty', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView({ initiative: [] }));
    const panel = window.document.getElementById('realtimeSessionPanel');
    assert.equal(panel.querySelector('[data-testid="next-turn"]'), null);

    window.aureRelicsApplyRealtimeSnapshot(gameplayManagerView());
    assert.ok(panel.querySelector('[data-testid="next-turn"]'));
  } finally {
    dom.window.close();
  }
});

test('Authority: none of the new 2C DM controls render for a non-manager view', () => {
  const dom = bootLegacyBoardDom();
  try {
    const { window } = dom;
    window.aureRelicsApplyRealtimeSnapshot(createBoardView(baseSnapshot({
      authority: { canManage: false, ownCharacterId: null },
      dm: null,
      fog: gameplayFog(),
      tokens: [{ id: 't1', kind: 'enemy', label: 'Goblin', x: 2, y: 3, width: 1, height: 1, isVisible: true, characterId: null }],
      initiative: [{ id: 'i1', tokenId: 't1', initiative: 10, position: 0, isActive: true }],
    })));
    const panel = window.document.getElementById('realtimeSessionPanel');
    for (const testid of ['prepare-board', 'create-token', 'initiative-editor', 'next-turn', 'token-inspector']) {
      assert.equal(panel.querySelector(`[data-testid="${testid}"]`), null, testid);
    }
    // Even a click on a rendered (player-facing) spatial token must never select/expose DM controls.
    const tokenEl = panel.querySelector('[data-spatial-token-id="t1"]');
    tokenEl?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(panel.querySelector('[data-testid="token-inspector"]'), null);
  } finally {
    dom.window.close();
  }
});
