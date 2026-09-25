import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDisplayView } from '../src/board/displayView.js';

function baseView(overrides = {}) {
  return {
    sessionId: 'session-1',
    revision: '1',
    session: { id: 'session-1', name: 'Session', status: 'active', activeLevelId: null },
    roundNumber: 1,
    authority: { canManage: true, ownCharacterId: null },
    tokens: [],
    characters: [],
    initiative: [],
    dm: { tokenDetails: [], notes: [], activity: [] },
    ...overrides,
  };
}

test('deriveDisplayView(view, "dm") returns the exact same reference as view', () => {
  const view = baseView();
  assert.equal(deriveDisplayView(view, 'dm'), view);
});

test('deriveDisplayView(view, "player") returns dm: null for a view where dm was populated', () => {
  const view = baseView();
  const result = deriveDisplayView(view, 'player');
  assert.equal(result.dm, null);
});

test('deriveDisplayView(view, "player").authority === view.authority (reference equality)', () => {
  const view = baseView();
  const result = deriveDisplayView(view, 'player');
  assert.equal(result.authority, view.authority);
});

test('deriveDisplayView(view, "player") on an already-player-shaped view is a safe no-op producing an equivalent object', () => {
  const view = baseView({ dm: null });
  const result = deriveDisplayView(view, 'player');
  assert.deepEqual(result, view);
  assert.notEqual(result, view);
});

test('deriveDisplayView(null, "player") returns null', () => {
  assert.equal(deriveDisplayView(null, 'player'), null);
});

test('deriveDisplayView(view, "nonsense") throws', () => {
  const view = baseView();
  assert.throws(() => deriveDisplayView(view, 'nonsense'), Error);
});

test('deriveDisplayView never mutates the input view, even when frozen', () => {
  const view = Object.freeze(baseView());
  assert.doesNotThrow(() => deriveDisplayView(view, 'player'));
  assert.notEqual(view.dm, null);
  assert.equal(view.authority.canManage, true);
});
