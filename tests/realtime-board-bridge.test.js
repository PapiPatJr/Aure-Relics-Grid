import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createBoardView, reconcileBoardView } from '../src/realtime/boardBridge.js';

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
