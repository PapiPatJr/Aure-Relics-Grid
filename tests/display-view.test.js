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

// --- Post-review architecture amendment: manager-shaped views must be reduced to the generic
// public/player-facing projection using the backend's authoritative `publicVisible` metadata,
// never a client-side guess. A real player's own recipient view (authority.canManage: false) is
// already the backend-authorized projection and must never be re-filtered. ---

function managerViewWithMixedVisibility() {
  return baseView({
    authority: { canManage: true, ownCharacterId: null },
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
}

test('deriveDisplayView(managerView, "player") removes hidden/non-public entities and their initiative', () => {
  const view = Object.freeze(managerViewWithMixedVisibility());
  const result = deriveDisplayView(view, 'player');

  assert.deepEqual(result.tokens.map(t => t.id), ['public-token']);
  assert.deepEqual(result.characters.map(c => c.id), ['public-character']);
  assert.deepEqual(result.initiative.map(i => i.id), ['i-public']);
  assert.equal(result.dm, null);
  assert.equal(result.authority, view.authority);

  // input untouched
  assert.equal(view.tokens.length, 2);
  assert.equal(view.characters.length, 2);
  assert.equal(view.initiative.length, 2);
});

test('deriveDisplayView(managerView, "player") drops an entity lacking publicVisible: true entirely (fail closed, no guessing)', () => {
  const view = baseView({
    authority: { canManage: true, ownCharacterId: null },
    tokens: [{ id: 't1', kind: 'enemy', label: 'Unknown', isVisible: true }], // no publicVisible field at all
    characters: [{ id: 'c1', name: 'Unknown', approved: true }],
    initiative: [{ id: 'i1', tokenId: 't1', initiative: 10, position: 0, isActive: false }],
  });
  const result = deriveDisplayView(view, 'player');
  assert.deepEqual(result.tokens, []);
  assert.deepEqual(result.characters, []);
  assert.deepEqual(result.initiative, []);
});

test('deriveDisplayView on an ACTUAL PLAYER-SHAPED view (authority.canManage: false) is never filtered by publicVisible, preserving own-character data even when publicVisible is false', () => {
  // A real player's own recipient snapshot: the backend already includes the player's own
  // character via the own-character rule even if that character isn't yet publicly approved.
  const view = baseView({
    authority: { canManage: false, ownCharacterId: 'own-character' },
    tokens: [{ id: 'public-token', kind: 'enemy', label: 'Goblin', isVisible: true, publicVisible: true }],
    characters: [{ id: 'own-character', name: 'Aria', approved: false, publicVisible: false }],
    initiative: [],
    dm: null,
  });
  const result = deriveDisplayView(view, 'player');
  assert.deepEqual(result.characters, view.characters);
  assert.deepEqual(result.tokens, view.tokens);
  assert.equal(result.authority, view.authority);
});
