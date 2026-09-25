import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountPlayerScreen } from '../src/screens/player-screen.js';

function makeRoot() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const root = dom.window.document.getElementById('root');
  return { dom, root };
}

function dmShapedView(overrides = {}) {
  return {
    sessionId: 'session-1',
    revision: '1',
    session: { id: 'session-1', name: 'Session', status: 'active', activeLevelId: null },
    roundNumber: 2,
    authority: { canManage: true, ownCharacterId: null },
    tokens: [{ id: 't1', kind: 'player', label: 'P1', isVisible: true }],
    characters: [{ id: 'c1', name: 'Aria', playerName: 'Pat', hp: 9, maxHp: 12, ac: 15, statuses: [] }],
    initiative: [{ id: 'i1', tokenId: 't1', initiative: 15, position: 0, isActive: true }],
    dm: { tokenDetails: [], notes: [], activity: [] },
    ...overrides,
  };
}

test('mountPlayerScreen(root) appends exactly one panel to root, hidden by default', () => {
  const { root } = makeRoot();
  mountPlayerScreen(root);
  const panels = root.querySelectorAll('#playerBoardPanel');
  assert.equal(panels.length, 1);
  const panel = panels[0];
  assert.equal(panel.hidden, true);
  assert.ok(panel.classList.contains('realtime-session-panel'));
  assert.ok(panel.classList.contains('player-board-panel'));
  assert.equal(panel.getAttribute('aria-label'), 'Your session board');
});

test('render(view) with a DM-shaped view produces zero DM-only DOM (defense-in-depth)', () => {
  const { root } = makeRoot();
  const screen = mountPlayerScreen(root);
  screen.render(dmShapedView());
  const panel = root.querySelector('#playerBoardPanel');
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector('.realtime-dm-section'), null);
  assert.equal(panel.querySelector('[data-realtime-action="advance-round"]'), null);
  assert.equal(panel.querySelector('[data-realtime-action="toggle-token-visible"]'), null);
  assert.equal(panel.querySelector('[data-realtime-action="clear-initiative"]'), null);
});

test('render(null) hides and clears the panel', () => {
  const { root } = makeRoot();
  const screen = mountPlayerScreen(root);
  screen.render(dmShapedView());
  const panel = root.querySelector('#playerBoardPanel');
  assert.equal(panel.hidden, false);
  assert.ok(panel.children.length > 0);
  screen.render(null);
  assert.equal(panel.hidden, true);
  assert.equal(panel.children.length, 0);
});

test('dispose() removes the panel, is idempotent, and render() after dispose() is a no-op', () => {
  const { root } = makeRoot();
  const screen = mountPlayerScreen(root);
  screen.dispose();
  assert.equal(root.querySelector('#playerBoardPanel'), null);
  assert.doesNotThrow(() => screen.dispose());
  assert.doesNotThrow(() => screen.render(dmShapedView()));
  assert.equal(root.querySelector('#playerBoardPanel'), null);
});
