import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeAdapter } from '../src/realtime/fakeAdapter.js';
import { createSceneModel } from '../src/workspace-v2/sceneModel.js';
import { mountRealtimeWorkspace } from '../src/workspace-v2/realtimeWorkspace.js';

const sessionId = '22222222-2222-4222-8222-222222222222';
const flush = () => new Promise(resolve => setImmediate(resolve));

function snapshot(revision, tokens, overrides = {}) {
  return {
    schemaVersion: 1,
    sessionId,
    campaignId: '11111111-1111-4111-8111-111111111111',
    revision,
    authority: { canManage: false, ownCharacterId: null },
    session: { id: sessionId, name: 'Workspace test', status: 'active', activeLevelId: 'level-1' },
    roundNumber: 1,
    tokens,
    characters: [],
    initiative: [],
    dm: null,
    fog: { levelId: 'level-1', width: 20, height: 20, enabled: true, revealedRuns: [] },
    ...overrides,
  };
}

function token(id, x) {
  return { id, label: id, kind: 'player', x, y: 2, width: 1, height: 1, isVisible: true };
}

test('snapshot flows through BoardView into a renderable scene with replacement semantics', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snapshot('1', [token('first', 1), token('removed', 3)]));
  const views = [];
  const workspace = mountRealtimeWorkspace({ adapter, sessionId, onView: view => views.push(view) });
  await flush();

  assert.deepEqual(views.at(-1).tokens.map(item => item.id), ['first', 'removed']);
  assert.deepEqual(createSceneModel(views.at(-1)).tokens.map(item => item.id), ['first', 'removed']);

  adapter.setHydrateResult(async () => snapshot('2', [token('first', 7)]));
  adapter.emitInvalidation(sessionId, '2');
  await flush();
  assert.deepEqual(views.at(-1).tokens.map(item => item.id), ['first']);
  assert.equal(createSceneModel(views.at(-1)).tokens[0].x, 7);
  workspace.stop();
});

test('stale revisions do not emit a regressed BoardView', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snapshot('5', [token('current', 5)]));
  const views = [];
  const workspace = mountRealtimeWorkspace({ adapter, sessionId, onView: view => views.push(view) });
  await flush();
  const count = views.length;
  adapter.setHydrateResult(async () => snapshot('2', [token('stale', 2)]));
  adapter.emitInvalidation(sessionId, '2');
  await flush();
  assert.equal(views.length, count);
  assert.equal(views.at(-1).tokens[0].id, 'current');
  workspace.stop();
});

test('stop releases the existing engine subscription and is idempotent', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snapshot('1', []));
  const workspace = mountRealtimeWorkspace({ adapter, sessionId });
  await flush();
  assert.equal(adapter.isSubscribed(sessionId), true);
  workspace.stop();
  assert.equal(adapter.isSubscribed(sessionId), false);
  workspace.stop();
  assert.equal(adapter.isSubscribed(sessionId), false);
});

test('denied access clears the rendered view and forwards status', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snapshot('1', [token('visible', 1)]));
  const views = [];
  const statuses = [];
  const workspace = mountRealtimeWorkspace({
    adapter,
    sessionId,
    onView: view => views.push(view),
    onStatus: status => statuses.push(status),
  });
  await flush();
  adapter.emitStatus(sessionId, 'denied', { reason: 'revoked' });
  assert.equal(views.at(-1), null);
  assert.equal(statuses.at(-1), 'denied');
  workspace.stop();
});

test('scene projection never reconstructs a secret token from dm data', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snapshot('1', [], {
    dm: { secretToken: token('secret-ambush', 11), notes: ['hidden encounter'] },
  }));
  let view;
  const workspace = mountRealtimeWorkspace({ adapter, sessionId, onView: next => { view = next; } });
  await flush();
  const scene = createSceneModel(view);
  assert.deepEqual(scene.tokens, []);
  assert.doesNotMatch(JSON.stringify(scene), /secret-ambush|hidden encounter/);
  workspace.stop();
});

