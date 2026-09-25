import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SOURCE_PATH = 'src/screens/dm-screen.js';
const FORBIDDEN = ['realtime/engine', 'supabaseAdapter', 'sessionLifecycle', 'getSupabaseClient'];

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

// A detached container, plus a real (swapped-in) global document so that dm-screen.js's own
// `document.body` preview-panel append target is the same document the test inspects.
function withDom(t) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://aure.example/' });
  const originals = new Map();
  for (const key of ['window', 'document']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  t.after(() => {
    for (const [key, desc] of originals) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  });
  const container = dom.window.document.createElement('div');
  return { dom, container };
}

function spy() {
  const calls = [];
  const fn = value => { calls.push(value); };
  fn.calls = calls;
  fn.lastCall = () => calls[calls.length - 1];
  return fn;
}

test('structural guarantee: dm-screen.js source contains none of the forbidden realtime-hydration identifiers', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  for (const forbidden of FORBIDDEN) {
    assert.ok(!source.includes(forbidden), `${SOURCE_PATH} must not reference "${forbidden}"`);
  }
});

test('activate() appends exactly one toggle button into container, idempotently', async t => {
  const { container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const screen = createDmScreen({ apply: spy(), container });

  screen.activate();
  assert.equal(container.querySelectorAll('button').length, 1);

  screen.activate();
  assert.equal(container.querySelectorAll('button').length, 1);
});

test('default mode is "dm"; render(view) calls apply once with the unchanged view; no preview panel exists yet', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  const view = dmShapedView();
  assert.equal(screen.getPresentationMode(), 'dm');
  screen.render(view);

  assert.equal(apply.calls.length, 1);
  assert.equal(apply.lastCall(), view);
  assert.equal(dom.window.document.getElementById('dmPreviewPanel'), null);
});

test('setPresentationMode("player") then render(view): apply receives null and the preview panel shows the player projection with zero DM-only DOM', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  const view = dmShapedView();
  screen.setPresentationMode('player');
  screen.render(view);

  assert.equal(apply.lastCall(), null);

  const panel = dom.window.document.getElementById('dmPreviewPanel');
  assert.ok(panel, '#dmPreviewPanel must exist');
  assert.equal(panel.hidden, false);
  assert.ok(panel.querySelector('[data-token-id="t1"]'));
  assert.ok(panel.querySelector('[data-character-id="c1"]'));
  assert.ok(panel.querySelector('.realtime-initiative-row'));
  assert.equal(panel.querySelectorAll('.realtime-dm-section').length, 0);
  assert.equal(panel.querySelectorAll('[data-realtime-action="advance-round"]').length, 0);
  assert.equal(panel.querySelectorAll('[data-realtime-action="toggle-token-visible"]').length, 0);
  assert.equal(panel.querySelectorAll('[data-realtime-action="clear-initiative"]').length, 0);
});

test('toggling back to "dm" and rendering again: apply receives the real view, and the preview panel is hidden and emptied', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  const view = dmShapedView();
  screen.setPresentationMode('player');
  screen.render(view);

  screen.setPresentationMode('dm');
  screen.render(view);

  assert.equal(apply.lastCall(), view);

  const panel = dom.window.document.getElementById('dmPreviewPanel');
  assert.ok(panel, '#dmPreviewPanel must still exist (reused, not removed)');
  assert.equal(panel.hidden, true);
  assert.equal(panel.children.length, 0);
});

test('deactivate() hides the toggle and preview panel and resets mode; a later activate() re-shows the same button', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();
  const originalButton = container.querySelector('button');

  const view = dmShapedView();
  screen.setPresentationMode('player');
  screen.render(view);

  screen.deactivate();

  assert.equal(originalButton.hidden, true);
  assert.equal(screen.getPresentationMode(), 'dm');
  const panel = dom.window.document.getElementById('dmPreviewPanel');
  assert.equal(panel.hidden, true);
  assert.equal(panel.children.length, 0);

  screen.activate();
  assert.equal(container.children.length, 1);
  assert.equal(container.querySelector('button'), originalButton);
  assert.equal(originalButton.hidden, false);
});

test('clicking the toggle button has the same observable effect as calling setPresentationMode directly', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  const view = dmShapedView();
  const button = container.querySelector('button');

  button.click();
  screen.render(view);
  assert.equal(apply.lastCall(), null, 'click should have flipped to player mode');
  assert.equal(dom.window.document.getElementById('dmPreviewPanel').hidden, false);

  button.click();
  screen.render(view);
  assert.equal(apply.lastCall(), view, 'second click should have flipped back to dm mode');
  assert.equal(dom.window.document.getElementById('dmPreviewPanel').hidden, true);
});
