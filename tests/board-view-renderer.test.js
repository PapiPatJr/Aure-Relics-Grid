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

// --- Issue #10 Task 4: shared player fog stage, mounted only for presentationMode: 'player' ---

function fogFixture(overrides = {}) {
  return { levelId: 'level-1', width: 5, height: 4, enabled: true, revealedRuns: [[0, 0, 2]], ...overrides };
}

test('a player-shaped view carrying fog renders a sized .fog-player-stage', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView({ fog: fogFixture() }), { presentationMode: 'player' });
  const stage = container.querySelector('.fog-player-stage');
  assert.ok(stage, 'fog stage is rendered');
  const canvas = stage.querySelector('canvas.fog-player-canvas');
  assert.ok(canvas);
  // 10D-FIX: one native canvas pixel per board cell, scaled up to display size by CSS
  // (fog.css `image-rendering: pixelated`) rather than baked into the canvas's own resolution —
  // see src/fog/fogRenderer.js's module docstring for why.
  assert.equal(canvas.width, 5);
  assert.equal(canvas.height, 4);
});

test('a view with no fog (fog: null, existing Issue #9 sessions) renders no fog stage at all', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView({ fog: null }), { presentationMode: 'player' });
  assert.equal(container.querySelector('.fog-player-stage'), null);
});

test('presentationMode "dm" never renders the player fog stage, even when fog is present', () => {
  const { container } = makeContainer();
  renderBoardView(container, dmShapedView({ fog: fogFixture() }), { presentationMode: 'dm' });
  assert.equal(container.querySelector('.fog-player-stage'), null);
});

test('the DM read-only Player Preview (presentationMode: "player", interactionMode: "readOnly") renders the same fog stage shape as the real Player Screen for identical fog', () => {
  const fog = fogFixture();
  const { container: playerContainer } = makeContainer();
  renderBoardView(playerContainer, playerShapedView({ fog }), { presentationMode: 'player' });

  const { container: previewContainer } = makeContainer();
  renderBoardView(previewContainer, dmShapedView({ fog }), { presentationMode: 'player', interactionMode: 'readOnly' });

  const playerCanvas = playerContainer.querySelector('canvas.fog-player-canvas');
  const previewCanvas = previewContainer.querySelector('canvas.fog-player-canvas');
  assert.ok(playerCanvas);
  assert.ok(previewCanvas);
  assert.equal(playerCanvas.width, previewCanvas.width);
  assert.equal(playerCanvas.height, previewCanvas.height);
  // Both call sites reach the exact same renderBoardView -> buildPlayerFogStage code path with
  // presentationMode: 'player' — there is no second implementation to drift out of parity.
});

test('the fog stage renders no [data-realtime-action] controls of its own, in either interaction mode', () => {
  const fog = fogFixture();
  for (const interactionMode of ['interactive', 'readOnly']) {
    const { container } = makeContainer();
    renderBoardView(container, playerShapedView({ fog }), { presentationMode: 'player', interactionMode });
    const stage = container.querySelector('.fog-player-stage');
    assert.equal(stage.querySelectorAll('[data-realtime-action]').length, 0);
  }
});

test('a malformed fog payload (unusable identity/dimensions) never renders a fog stage, matching fogRenderer.buildPlayerFogStage', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView({ fog: { enabled: true, revealedRuns: [] } }), { presentationMode: 'player' });
  assert.equal(container.querySelector('.fog-player-stage'), null);
});

test('re-rendering with a new view fully replaces prior DOM, no stale nodes survive', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView({ tokens: [{ id: 'first-only', kind: 'player', label: 'First', isVisible: true }] }), { presentationMode: 'player' });
  assert.ok(container.querySelector('[data-token-id="first-only"]'));

  renderBoardView(container, playerShapedView({ tokens: [{ id: 'second-only', kind: 'player', label: 'Second', isVisible: true }] }), { presentationMode: 'player' });
  assert.equal(container.querySelector('[data-token-id="first-only"]'), null);
  assert.ok(container.querySelector('[data-token-id="second-only"]'));
});

// --- Final corrective pass: scroll position must survive an unrelated rerender of the same
// logical view. container.innerHTML = '' throws away the old <ul>/<ol> elements (and their
// scrollTop) on every render; this must be restored onto the new ones, not silently reset. ---

function crowdedTokens(count, kind = 'enemy') {
  return Array.from({ length: count }, (_, i) => ({ id: `t${i + 1}`, kind, label: `${kind}${i + 1}`, isVisible: true }));
}

test('same session/level, same active combatant: an unrelated rerender preserves manual scroll offset on all three lists', () => {
  const { container } = makeContainer();
  const view = playerShapedView({ tokens: crowdedTokens(30), initiative: [{ id: 'i1', tokenId: 't1', initiative: 15, position: 0, isActive: true }] });
  renderBoardView(container, view, { presentationMode: 'player' });

  container.querySelector('.realtime-token-list').scrollTop = 500;
  container.querySelector('.realtime-character-list').scrollTop = 40;
  container.querySelector('.realtime-initiative-list').scrollTop = 20;

  // An unrelated mutation: same session, same level, same active token, just a changed HP value.
  renderBoardView(container, { ...view, characters: [{ ...view.characters[0], hp: 8 }] }, { presentationMode: 'player' });

  assert.equal(container.querySelector('.realtime-token-list').scrollTop, 500);
  assert.equal(container.querySelector('.realtime-character-list').scrollTop, 40);
  assert.equal(container.querySelector('.realtime-initiative-list').scrollTop, 20);
});

test('a different active level (same session) does not restore the old scroll offset', () => {
  const { container } = makeContainer();
  const view = playerShapedView({ session: { id: 'session-1', name: 'Session', status: 'active', activeLevelId: 'level-1' }, tokens: crowdedTokens(30) });
  renderBoardView(container, view, { presentationMode: 'player' });
  container.querySelector('.realtime-token-list').scrollTop = 500;

  renderBoardView(container, { ...view, session: { ...view.session, activeLevelId: 'level-2' } }, { presentationMode: 'player' });

  assert.equal(container.querySelector('.realtime-token-list').scrollTop, 0);
});

test('a different session does not restore the old scroll offset', () => {
  const { container } = makeContainer();
  const view = playerShapedView({ tokens: crowdedTokens(30) });
  renderBoardView(container, view, { presentationMode: 'player' });
  container.querySelector('.realtime-token-list').scrollTop = 500;

  renderBoardView(container, { ...view, sessionId: 'session-2', session: { ...view.session, id: 'session-2' } }, { presentationMode: 'player' });

  assert.equal(container.querySelector('.realtime-token-list').scrollTop, 0);
});

test('teardown (null view) then a fresh render of the same session/level never resurrects the old scroll offset', () => {
  const { container } = makeContainer();
  const view = playerShapedView({ tokens: crowdedTokens(30) });
  renderBoardView(container, view, { presentationMode: 'player' });
  container.querySelector('.realtime-token-list').scrollTop = 500;

  renderBoardView(container, null, { presentationMode: 'player' });
  renderBoardView(container, view, { presentationMode: 'player' });

  assert.equal(container.querySelector('.realtime-token-list').scrollTop, 0);
});

test('two independent containers (Player Screen vs DM Preview) never share scroll or active state', () => {
  const { container: playerContainer } = makeContainer();
  const { container: previewContainer } = makeContainer();
  const view = playerShapedView({ tokens: crowdedTokens(30) });

  renderBoardView(playerContainer, view, { presentationMode: 'player' });
  renderBoardView(previewContainer, view, { presentationMode: 'player', interactionMode: 'readOnly' });
  playerContainer.querySelector('.realtime-token-list').scrollTop = 500;

  renderBoardView(playerContainer, { ...view, characters: [{ ...view.characters[0], hp: 8 }] }, { presentationMode: 'player' });
  renderBoardView(previewContainer, { ...view, characters: [{ ...view.characters[0], hp: 8 }] }, { presentationMode: 'player', interactionMode: 'readOnly' });

  assert.equal(playerContainer.querySelector('.realtime-token-list').scrollTop, 500);
  assert.equal(previewContainer.querySelector('.realtime-token-list').scrollTop, 0);
});

test('active combatant change: the old offset is restored first, then the new active row is marked (nearest-scroll, not re-centered)', () => {
  const { container } = makeContainer();
  const tokens = crowdedTokens(30);
  const view = playerShapedView({ tokens, initiative: [{ id: 'i1', tokenId: 't1', initiative: 15, position: 0, isActive: true }] });
  renderBoardView(container, view, { presentationMode: 'player' });
  container.querySelector('.realtime-token-list').scrollTop = 500;

  const movedTurn = { ...view, initiative: [{ id: 'i1', tokenId: 't30', initiative: 15, position: 0, isActive: true }] };
  renderBoardView(container, movedTurn, { presentationMode: 'player' });

  // Priority 1 (restore) still applied even though the active combatant also changed.
  assert.equal(container.querySelector('.realtime-token-list').scrollTop, 500);
  assert.equal(container.querySelector('[data-token-id="t30"]').classList.contains('active-combatant'), true);
  assert.equal(container.querySelector('[data-token-id="t1"]').classList.contains('active-combatant'), false);
});

// --- Tuesday Online Package 2B: spatial token layer integration ---

function spatialToken(overrides = {}) {
  return { id: 'st1', kind: 'enemy', label: 'Goblin', x: 0, y: 0, width: 1, height: 1, isVisible: true, ...overrides };
}

test('a player-shaped view with fog+tokens mounts the spatial token layer inside the same .fog-player-stage as the fog canvas', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView({ fog: fogFixture(), tokens: [spatialToken()] }), { presentationMode: 'player' });
  const stage = container.querySelector('.fog-player-stage');
  assert.ok(stage);
  const layer = stage.querySelector('.spatial-token-layer');
  assert.ok(layer, 'spatial token layer is mounted inside the fog stage, not a second box');
  assert.ok(layer.querySelector('[data-spatial-token-id="st1"]'));
});

test('spatial token position is derived from fog.width/height — the same authoritative dimensions Fog itself uses', () => {
  const { container } = makeContainer();
  const fog = fogFixture({ width: 10, height: 10 });
  renderBoardView(container, playerShapedView({ fog, tokens: [spatialToken({ x: 5, y: 5 })] }), { presentationMode: 'player' });
  const el = container.querySelector('[data-spatial-token-id="st1"]');
  assert.equal(el.style.left, '50%');
  assert.equal(el.style.top, '50%');
});

test('no fog means no spatial token layer either (no board dimensions to place a token in)', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView({ fog: null, tokens: [spatialToken()] }), { presentationMode: 'player' });
  assert.equal(container.querySelector('.spatial-token-layer'), null);
});

test('the DM management view (presentationMode "dm") renders a standalone .spatial-board-stage', () => {
  const { container } = makeContainer();
  renderBoardView(container, dmShapedView({ fog: fogFixture(), tokens: [spatialToken()] }), { presentationMode: 'dm' });
  const stage = container.querySelector('.spatial-board-stage');
  assert.ok(stage);
  assert.ok(stage.querySelector('[data-spatial-token-id="st1"]'));
});

test('presentationMode "player" never renders a .spatial-board-stage (tokens live inside .fog-player-stage instead)', () => {
  const { container } = makeContainer();
  renderBoardView(container, playerShapedView({ fog: fogFixture(), tokens: [spatialToken()] }), { presentationMode: 'player' });
  assert.equal(container.querySelector('.spatial-board-stage'), null);
});

test('a DM-only hidden token is spatially rendered with the hidden treatment in DM mode', () => {
  const { container } = makeContainer();
  const tokens = [spatialToken({ id: 'visible' }), spatialToken({ id: 'hidden', x: 1, isVisible: false })];
  renderBoardView(container, dmShapedView({ fog: fogFixture(), tokens }), { presentationMode: 'dm' });
  const hiddenEl = container.querySelector('[data-spatial-token-id="hidden"]');
  assert.ok(hiddenEl);
  assert.ok(hiddenEl.classList.contains('spatial-token--hidden'));
  const visibleEl = container.querySelector('[data-spatial-token-id="visible"]');
  assert.ok(!visibleEl.classList.contains('spatial-token--hidden'));
});

test('the DM Player Preview path (presentationMode "player", interactionMode "readOnly") renders the identical spatial layer as the real Player Screen for the same fog+tokens', () => {
  const fog = fogFixture();
  const tokens = [spatialToken({ x: 1, y: 2 }), spatialToken({ id: 'st2', x: 3, y: 4 })];

  const { container: playerContainer } = makeContainer();
  renderBoardView(playerContainer, playerShapedView({ fog, tokens }), { presentationMode: 'player' });

  const { container: previewContainer } = makeContainer();
  renderBoardView(previewContainer, dmShapedView({ fog, tokens }), { presentationMode: 'player', interactionMode: 'readOnly' });

  const playerTokens = playerContainer.querySelectorAll('.spatial-token');
  const previewTokens = previewContainer.querySelectorAll('.spatial-token');
  assert.equal(playerTokens.length, previewTokens.length);
  for (let i = 0; i < playerTokens.length; i += 1) {
    assert.equal(playerTokens[i].style.left, previewTokens[i].style.left);
    assert.equal(playerTokens[i].style.top, previewTokens[i].style.top);
  }
});

test('a DM-shaped view rendered as presentationMode "player" never shows the hidden-token treatment, even for a defensively-adversarial hidden token in the array', () => {
  const { container } = makeContainer();
  const tokens = [spatialToken({ isVisible: false })];
  renderBoardView(container, dmShapedView({ fog: fogFixture(), tokens }), { presentationMode: 'player', interactionMode: 'readOnly' });
  const el = container.querySelector('[data-spatial-token-id="st1"]');
  assert.ok(el);
  assert.ok(!el.classList.contains('spatial-token--hidden'));
});

test('replacement semantics: a rerender whose tokens omit a previously-rendered token removes its spatial element (no stale ghost)', () => {
  const { container } = makeContainer();
  const fog = fogFixture();
  renderBoardView(container, playerShapedView({ fog, tokens: [spatialToken({ id: 'gone' }), spatialToken({ id: 'stays', x: 1 })] }), { presentationMode: 'player' });
  assert.ok(container.querySelector('[data-spatial-token-id="gone"]'));

  renderBoardView(container, playerShapedView({ fog, tokens: [spatialToken({ id: 'stays', x: 1 })] }), { presentationMode: 'player' });
  assert.equal(container.querySelector('[data-spatial-token-id="gone"]'), null);
  assert.ok(container.querySelector('[data-spatial-token-id="stays"]'));
});

test('movement by snapshot: a newer view with a changed token x/y rerenders the token at its new position, without calling any mutation', () => {
  const { container } = makeContainer();
  const fog = fogFixture({ width: 10, height: 10 });
  renderBoardView(container, playerShapedView({ fog, tokens: [spatialToken({ x: 2, y: 2 })] }), { presentationMode: 'player' });
  assert.equal(container.querySelector('[data-spatial-token-id="st1"]').style.left, '20%');

  renderBoardView(container, playerShapedView({ fog, tokens: [spatialToken({ x: 8, y: 2 })] }), { presentationMode: 'player' });
  assert.equal(container.querySelector('[data-spatial-token-id="st1"]').style.left, '80%');
});

test('the active-initiative token receives spatial active styling in both player and DM presentation', () => {
  for (const presentationMode of ['player', 'dm']) {
    const { container } = makeContainer();
    const view = presentationMode === 'dm' ? dmShapedView : playerShapedView;
    renderBoardView(container, view({
      fog: fogFixture(),
      tokens: [spatialToken({ id: 'st1' }), spatialToken({ id: 'st2', x: 1 })],
      initiative: [{ id: 'i1', tokenId: 'st2', initiative: 15, position: 0, isActive: true }],
    }), { presentationMode });
    assert.ok(container.querySelector('[data-spatial-token-id="st2"]').classList.contains('spatial-token--active'));
    assert.ok(!container.querySelector('[data-spatial-token-id="st1"]').classList.contains('spatial-token--active'));
  }
});

test('a 200x200 board with a handful of tokens never explodes into a per-cell DOM tree, in either presentation mode', () => {
  const tokens = Array.from({ length: 5 }, (_, i) => spatialToken({ id: `st${i}`, x: i, y: i }));
  const fog = fogFixture({ width: 200, height: 200, revealedRuns: [] });

  const { container: playerContainer } = makeContainer();
  renderBoardView(playerContainer, playerShapedView({ fog, tokens }), { presentationMode: 'player' });
  assert.ok(playerContainer.querySelector('.fog-player-stage').querySelectorAll('*').length < 30);

  const { container: dmContainer } = makeContainer();
  renderBoardView(dmContainer, dmShapedView({ fog, tokens }), { presentationMode: 'dm' });
  assert.ok(dmContainer.querySelector('.spatial-board-stage').querySelectorAll('*').length < 30);
});

test('malformed token geometry is skipped rather than placed at a guessed position', () => {
  const { container } = makeContainer();
  const fog = fogFixture();
  renderBoardView(container, playerShapedView({ fog, tokens: [{ id: 'malformed', kind: 'enemy', label: 'Bad', isVisible: true }] }), { presentationMode: 'player' });
  assert.equal(container.querySelector('[data-spatial-token-id="malformed"]'), null);
});
