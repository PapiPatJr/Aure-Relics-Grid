import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderBoardView } from '../src/board/boardViewRenderer.js';

function makeContainer() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const container = dom.window.document.getElementById('root');
  return { dom, container };
}

function playerShapedView(overrides = {}) {
  return {
    sessionId: 'session-1',
    revision: '1',
    session: { id: 'session-1', name: 'Session', status: 'active', activeLevelId: null },
    roundNumber: 2,
    authority: { canManage: false, ownCharacterId: null },
    tokens: [{ id: 't1', kind: 'player', label: 'P1', isVisible: true }],
    characters: [{ id: 'c1', name: 'Aria', playerName: 'Pat', hp: 9, maxHp: 12, ac: 15, statuses: [] }],
    initiative: [{ id: 'i1', tokenId: 't1', initiative: 15, position: 0, isActive: true }],
    dm: null,
    ...overrides,
  };
}

function dmShapedView(overrides = {}) {
  return playerShapedView({
    authority: { canManage: true, ownCharacterId: null },
    dm: { tokenDetails: [], notes: [], activity: [] },
    ...overrides,
  });
}

test('renderBoardView(container, null, ...) hides container and clears children', () => {
  const { container } = makeContainer();
  container.hidden = false;
  container.innerHTML = '<p>stale</p>';
  renderBoardView(container, null, { presentationMode: 'player' });
  assert.equal(container.hidden, true);
  assert.equal(container.children.length, 0);
});

test('a player-shaped displayView renders visible rows with zero manage buttons and no DM section', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView(), { presentationMode: 'player' });
  assert.equal(container.hidden, false);
  assert.ok(container.querySelector('[data-token-id="t1"]'));
  assert.ok(container.querySelector('[data-character-id="c1"]'));
  assert.ok(container.querySelector('.realtime-initiative-row'));
  assert.equal(container.querySelector('[data-realtime-action="advance-round"]'), null);
  assert.equal(container.querySelector('[data-realtime-action="toggle-token-visible"]'), null);
  assert.equal(container.querySelector('[data-realtime-action="clear-initiative"]'), null);
  assert.equal(container.querySelector('.realtime-dm-section'), null);
});

test('defense-in-depth: a DM-shaped displayView rendered with presentationMode "player" produces zero manage buttons and zero DM section', () => {
  const { container } = makeContainer();
  renderBoardView(container, dmShapedView(), { presentationMode: 'player' });
  assert.equal(container.querySelector('[data-realtime-action="advance-round"]'), null);
  assert.equal(container.querySelector('[data-realtime-action="toggle-token-visible"]'), null);
  assert.equal(container.querySelector('[data-realtime-action="clear-initiative"]'), null);
  assert.equal(container.querySelector('.realtime-dm-section'), null);
});

test('the same DM-shaped displayView rendered with presentationMode "dm" produces manage buttons and the DM section', () => {
  const { container } = makeContainer();
  renderBoardView(container, dmShapedView(), { presentationMode: 'dm' });
  assert.ok(container.querySelector('[data-realtime-action="advance-round"]'));
  assert.ok(container.querySelector('[data-realtime-action="toggle-token-visible"][data-token-id="t1"]'));
  assert.ok(container.querySelector('[data-realtime-action="clear-initiative"]'));
  assert.ok(container.querySelector('.realtime-dm-section'));
});

test('own-character HP controls render only for the character matching authority.ownCharacterId, in both modes', () => {
  const view = dmShapedView({
    authority: { canManage: true, ownCharacterId: 'c1' },
    characters: [
      { id: 'c1', name: 'Aria', playerName: 'Pat', hp: 9, maxHp: 12, ac: 15, statuses: [] },
      { id: 'c2', name: 'Beorn', playerName: 'Sam', hp: 5, maxHp: 10, ac: 14, statuses: [] },
    ],
  });

  for (const presentationMode of ['dm', 'player']) {
    const { container } = makeContainer();
    renderBoardView(container, view, { presentationMode });
    const ownCard = container.querySelector('[data-character-id="c1"]');
    const otherCard = container.querySelector('[data-character-id="c2"]');
    assert.ok(ownCard.querySelector('[data-realtime-action="adjust-own-hp"]'));
    assert.equal(otherCard.querySelector('[data-realtime-action="adjust-own-hp"]'), null);
  }
});

// --- Post-review corrective pass: interactionMode: 'readOnly' must produce zero
// [data-realtime-action] elements of any kind, even given an adversarial view where
// authority.canManage is true and authority.ownCharacterId matches a rendered character. ---

test('interactionMode: "readOnly" renders zero [data-realtime-action] elements of any kind, given an adversarial canManage:true + matching ownCharacterId view', () => {
  const { container } = makeContainer();
  const view = dmShapedView({
    authority: { canManage: true, ownCharacterId: 'c1' },
  });

  renderBoardView(container, view, { presentationMode: 'player', interactionMode: 'readOnly' });

  assert.equal(container.querySelectorAll('[data-realtime-action]').length, 0);
  assert.equal(container.querySelectorAll('[data-realtime-action="adjust-own-hp"]').length, 0);
  assert.equal(container.querySelector('.realtime-dm-section'), null);
});

test('interactionMode: "readOnly" still renders tokens/characters/initiative content (read-only, not empty)', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView(), { presentationMode: 'player', interactionMode: 'readOnly' });
  assert.ok(container.querySelector('[data-token-id="t1"]'));
  assert.ok(container.querySelector('[data-character-id="c1"]'));
  assert.ok(container.querySelector('.realtime-initiative-row'));
});

test('interactionMode defaults to "interactive" when omitted (own-character HP controls still render for a real player view)', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView({ authority: { canManage: false, ownCharacterId: 'c1' } }), { presentationMode: 'player' });
  assert.ok(container.querySelector('[data-character-id="c1"] [data-realtime-action="adjust-own-hp"]'));
});

test('re-rendering with a new view fully replaces prior DOM, no stale nodes survive', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView({ tokens: [{ id: 'first-only', kind: 'player', label: 'First', isVisible: true }] }), { presentationMode: 'player' });
  assert.ok(container.querySelector('[data-token-id="first-only"]'));

  renderBoardView(container, playerShapedView({ tokens: [{ id: 'second-only', kind: 'player', label: 'Second', isVisible: true }] }), { presentationMode: 'player' });
  assert.equal(container.querySelector('[data-token-id="first-only"]'), null);
  assert.ok(container.querySelector('[data-token-id="second-only"]'));
});
