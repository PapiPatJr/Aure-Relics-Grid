import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { wireRealtimeBoardActions } from '../src/realtime/boardActions.js';

const SOURCE_PATH = 'src/screens/dm-screen.js';
const FORBIDDEN = ['realtime/engine', 'supabaseAdapter', 'sessionLifecycle', 'getSupabaseClient'];

function dmShapedView(overrides = {}) {
  return {
    sessionId: 'session-1',
    revision: '1',
    session: { id: 'session-1', name: 'Session', status: 'active', activeLevelId: null },
    roundNumber: 2,
    authority: { canManage: true, ownCharacterId: null },
    // publicVisible: true so this fixture's default entities survive deriveDisplayView's
    // manager-view filtering (post-review architecture amendment) and existing assertions below
    // that expect them present in the preview keep working unchanged.
    tokens: [{ id: 't1', kind: 'player', label: 'P1', isVisible: true, publicVisible: true }],
    characters: [{ id: 'c1', name: 'Aria', playerName: 'Pat', hp: 9, maxHp: 12, ac: 15, statuses: [], publicVisible: true }],
    initiative: [{ id: 'i1', tokenId: 't1', initiative: 15, position: 0, isActive: true, publicVisible: true }],
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

test('clicking the toggle button immediately rerenders the last-rendered view, with no further render() call from the caller', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  const view = dmShapedView();
  screen.render(view); // the only render() call in this test — establishes the stored view
  const button = container.querySelector('button');

  button.click(); // NOT followed by screen.render(view) — the toggle itself must rerender
  assert.equal(apply.lastCall(), null, 'click should have flipped to player mode and rerendered immediately');
  assert.equal(dom.window.document.getElementById('dmPreviewPanel').hidden, false);

  button.click(); // NOT followed by screen.render(view) — the toggle itself must rerender
  assert.equal(apply.lastCall(), view, 'second click should have flipped back to dm mode and rerendered immediately');
  assert.equal(dom.window.document.getElementById('dmPreviewPanel').hidden, true);
});

test('regression: setPresentationMode("player") immediately rerenders the stored view — no external render() call required', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  const view = dmShapedView();
  screen.render(view); // one render call in DM mode
  assert.equal(apply.calls.length, 1);
  assert.equal(apply.lastCall(), view);

  screen.setPresentationMode('player'); // deliberately no further screen.render(view) call

  assert.equal(apply.calls.length, 2, 'toggling to player must call apply(null) immediately, without an external render()');
  assert.equal(apply.lastCall(), null);

  const panel = dom.window.document.getElementById('dmPreviewPanel');
  assert.ok(panel, '#dmPreviewPanel must exist immediately after toggling, before any further render() call');
  assert.equal(panel.hidden, false);
  assert.ok(panel.querySelector('[data-token-id="t1"]'));
  assert.ok(panel.querySelector('[data-character-id="c1"]'));
  assert.ok(panel.querySelector('.realtime-initiative-row'));
  assert.equal(panel.querySelectorAll('.realtime-dm-section').length, 0);
  assert.equal(panel.querySelectorAll('[data-realtime-action="advance-round"]').length, 0);
  assert.equal(panel.querySelectorAll('[data-realtime-action="toggle-token-visible"]').length, 0);
  assert.equal(panel.querySelectorAll('[data-realtime-action="clear-initiative"]').length, 0);
});

test('regression: setPresentationMode("dm") immediately restores apply(view) with the exact stored view object and clears the preview — no external render() call required', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  const view = dmShapedView();
  screen.render(view);
  screen.setPresentationMode('player');
  assert.equal(dom.window.document.getElementById('dmPreviewPanel').hidden, false);

  screen.setPresentationMode('dm'); // deliberately no further screen.render(view) call

  assert.equal(apply.lastCall(), view, 'must be called with the exact same stored view object');
  assert.equal(Object.is(apply.lastCall(), view), true);

  const panel = dom.window.document.getElementById('dmPreviewPanel');
  assert.equal(panel.hidden, true, 'preview must be hidden immediately');
  assert.equal(panel.children.length, 0, 'preview must be emptied immediately');
});

test('regression: setPresentationMode to the current mode is a no-op — no extra apply() call and no DOM change', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  const view = dmShapedView();
  screen.render(view);
  assert.equal(apply.calls.length, 1);

  screen.setPresentationMode('dm'); // already in dm mode
  assert.equal(apply.calls.length, 1, 'redundant setPresentationMode("dm") must not call apply() again');
  assert.equal(dom.window.document.getElementById('dmPreviewPanel'), null);

  screen.setPresentationMode('player');
  const callsAfterFirstToggle = apply.calls.length;
  assert.equal(callsAfterFirstToggle, 2);

  screen.setPresentationMode('player'); // already in player mode
  assert.equal(apply.calls.length, callsAfterFirstToggle, 'redundant setPresentationMode("player") must not call apply() again');
});

test('regression: toggling before any render(view) call is safe — no crash, no fabricated apply() call, no preview panel', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  assert.doesNotThrow(() => screen.setPresentationMode('player'));
  assert.equal(apply.calls.length, 0, 'no view has ever been rendered, so toggling must not fabricate an apply() call');
  assert.equal(dom.window.document.getElementById('dmPreviewPanel'), null);

  assert.doesNotThrow(() => screen.setPresentationMode('dm'));
  assert.equal(apply.calls.length, 0);
});

// --- Post-review corrective pass: the preview is a GENERIC PUBLIC projection, not an
// approximate/impersonated one, and must be structurally read-only regardless of what the
// (adversarial) input view's authority contains. ---

test('preview panel removes hidden/non-public entities using backend publicVisible metadata, keeping only the public ones', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const screen = createDmScreen({ apply: spy(), container });
  screen.activate();

  const view = dmShapedView({
    tokens: [
      { id: 'public-token', kind: 'enemy', label: 'Goblin', isVisible: true, publicVisible: true },
      { id: 'hidden-token', kind: 'boss', label: 'Secret Boss', isVisible: false, publicVisible: false },
    ],
    characters: [
      { id: 'public-character', name: 'Aria', approved: true, publicVisible: true },
      { id: 'non-public-character', name: 'Pending Hero', approved: false, publicVisible: false },
    ],
    initiative: [
      { id: 'i-public', tokenId: 'public-token', initiative: 15, position: 0, isActive: true, publicVisible: true },
      { id: 'i-hidden', tokenId: 'hidden-token', initiative: 20, position: 1, isActive: false, publicVisible: false },
    ],
  });
  screen.setPresentationMode('player');
  screen.render(view);

  const panel = dom.window.document.getElementById('dmPreviewPanel');
  assert.ok(panel.querySelector('[data-token-id="public-token"]'));
  assert.equal(panel.querySelector('[data-token-id="hidden-token"]'), null);
  assert.ok(panel.querySelector('[data-character-id="public-character"]'));
  assert.equal(panel.querySelector('[data-character-id="non-public-character"]'), null);
  assert.equal(panel.querySelectorAll('.realtime-initiative-row').length, 1);
});

test('adversarial: preview panel renders zero [data-realtime-action] elements of any kind even when the manager view has authority.canManage: true and ownCharacterId matching a public character', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const screen = createDmScreen({ apply: spy(), container });
  screen.activate();

  const view = dmShapedView({
    authority: { canManage: true, ownCharacterId: 'c1' },
  });
  screen.setPresentationMode('player');
  screen.render(view);

  const panel = dom.window.document.getElementById('dmPreviewPanel');
  assert.equal(panel.querySelectorAll('[data-realtime-action]').length, 0);
  assert.equal(panel.querySelectorAll('[data-realtime-action="adjust-own-hp"]').length, 0);
});

test('integrated mutation-boundary: clicking anywhere in the DM preview panel cannot reach engine.mutate, given an adversarial manager view', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const screen = createDmScreen({ apply: spy(), container });
  screen.activate();

  const view = dmShapedView({
    authority: { canManage: true, ownCharacterId: 'c1' },
  });
  screen.setPresentationMode('player');
  screen.render(view);

  const panel = dom.window.document.getElementById('dmPreviewPanel');
  assert.ok(panel.children.length > 0, 'sanity: the preview panel actually rendered content to click on');

  const mutateCalls = [];
  const fakeEngine = { mutate: (...args) => { mutateCalls.push(args); throw new Error('mutate must never be called from a read-only preview'); }, getContext: () => 1 };
  const unwire = wireRealtimeBoardActions(fakeEngine, () => view.sessionId, () => view, dom.window.document, () => {});
  t.after(unwire);

  const clickable = [panel, ...panel.querySelectorAll('*')];
  for (const el of clickable) {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  }

  assert.equal(mutateCalls.length, 0, 'no element in the DM preview panel is an actionable [data-realtime-action] control');
});

test('regression: toggling immediately after render(null) (denied state) is safe and never fabricates content', async t => {
  const { dom, container } = withDom(t);
  const { createDmScreen } = await import('../src/screens/dm-screen.js');
  const apply = spy();
  const screen = createDmScreen({ apply, container });
  screen.activate();

  screen.render(null);
  assert.equal(apply.lastCall(), null);

  screen.setPresentationMode('player'); // no external render() call
  assert.equal(apply.lastCall(), null);
  const panel = dom.window.document.getElementById('dmPreviewPanel');
  assert.ok(panel);
  assert.equal(panel.hidden, true);
  assert.equal(panel.children.length, 0);

  screen.setPresentationMode('dm'); // no external render() call
  assert.equal(apply.lastCall(), null);
});
