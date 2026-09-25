import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSyncEngine } from '../src/realtime/engine.js';
import { createFakeAdapter } from '../src/realtime/fakeAdapter.js';
import { createMutationBridge, mutateWithConflictRecovery } from '../src/realtime/mutationBridge.js';

const session = '22222222-2222-4222-8222-222222222222';
const snap = revision => ({ sessionId: session, revision });
const flush = () => new Promise(resolve => setImmediate(resolve));

async function buildReadyEngine(appliedRevision = '1') {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap(appliedRevision));
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  return { engine, adapter };
}

test('each bridge function sends the exact type/payload; the engine attaches schemaVersion/expectedRevision', async () => {
  const { engine, adapter } = await buildReadyEngine('9');
  adapter.setMutateResult(async (id, command) => ({ command }));
  const bridge = createMutationBridge(engine);

  await bridge.setRound(session, 3);
  await bridge.setTokenPublicState(session, { tokenId: 't1', label: 'Enemy', conditionLabel: 'Hurt', isVisible: true });
  await bridge.setInitiative(session, [{ tokenId: 't1', initiative: 15, position: 0, isActive: true }]);
  await bridge.updateCharacter(session, { characterId: 'c1', name: 'Hero', playerName: 'Player', hp: 12, maxHp: 20, tempHp: 0, ac: 15, speed: 30, statuses: ['Inspired'], publicNotes: 'Shared' });

  const sent = adapter.calls.mutate.map(c => c.command);
  assert.deepEqual(sent, [
    { schemaVersion: 1, type: 'session.setRound', expectedRevision: '9', payload: { roundNumber: 3 } },
    { schemaVersion: 1, type: 'token.setPublicState', expectedRevision: '9', payload: { tokenId: 't1', label: 'Enemy', conditionLabel: 'Hurt', isVisible: true } },
    { schemaVersion: 1, type: 'initiative.set', expectedRevision: '9', payload: { entries: [{ tokenId: 't1', initiative: 15, position: 0, isActive: true }] } },
    { schemaVersion: 1, type: 'character.update', expectedRevision: '9', payload: { characterId: 'c1', name: 'Hero', playerName: 'Player', hp: 12, maxHp: 20, tempHp: 0, ac: 15, speed: 30, statuses: ['Inspired'], publicNotes: 'Shared' } },
  ]);
});

test('a player-shaped backend rejection (42501) is propagated unchanged — the bridge cannot and does not suppress it', async () => {
  const { engine, adapter } = await buildReadyEngine('1');
  const denied = Object.assign(new Error('not authorized'), { code: '42501' });
  adapter.setMutateResult(async () => { throw denied; });
  const bridge = createMutationBridge(engine);
  await assert.rejects(() => bridge.setRound(session, 2), err => err === denied);
});

test('a 40001 conflict re-hydrates exactly once and never replays the mutation', async () => {
  const { engine, adapter } = await buildReadyEngine('1');
  const conflict = Object.assign(new Error('stale revision'), { code: '40001' });
  adapter.setMutateResult(async () => { throw conflict; });
  const bridge = createMutationBridge(engine);
  const hydrateCallsBefore = adapter.calls.hydrate.length;

  const outcome = await mutateWithConflictRecovery(engine, session, () => bridge.setRound(session, 2));

  assert.deepEqual(outcome, { ok: false, conflict: true, error: conflict });
  assert.equal(adapter.calls.mutate.length, 1); // never retried
  assert.equal(adapter.calls.hydrate.length, hydrateCallsBefore + 1); // exactly one recovery hydrate
});

test('a 40P01 aborted-transaction conflict re-hydrates and is never reported as success', async () => {
  const { engine, adapter } = await buildReadyEngine('1');
  const aborted = Object.assign(new Error('deadlock detected'), { code: '40P01' });
  adapter.setMutateResult(async () => { throw aborted; });
  const bridge = createMutationBridge(engine);
  const hydrateCallsBefore = adapter.calls.hydrate.length;

  const outcome = await mutateWithConflictRecovery(engine, session, () => bridge.setRound(session, 2));

  assert.equal(outcome.ok, false);
  assert.equal(outcome.conflict, true);
  assert.equal(adapter.calls.mutate.length, 1);
  assert.equal(adapter.calls.hydrate.length, hydrateCallsBefore + 1);
});

test('a failed mutation never optimistically becomes authoritative state', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => ({ sessionId: session, revision: '1', roundNumber: 1 }));
  const engine = createSyncEngine(adapter);
  const snapshots = [];
  engine.subscribe(session, { onSnapshot: s => snapshots.push(s) });
  await flush();
  assert.deepEqual(snapshots.map(s => s.roundNumber), [1]);

  const conflict = Object.assign(new Error('stale revision'), { code: '40001' });
  adapter.setMutateResult(async () => { throw conflict; });
  const bridge = createMutationBridge(engine);

  const outcome = await mutateWithConflictRecovery(engine, session, () => bridge.setRound(session, 2));
  await flush();

  assert.equal(outcome.conflict, true);
  // Still exactly the one real snapshot ever delivered — the recovery hydrate didn't invent a
  // second one reflecting the failed mutation's intended roundNumber: 2, because the (mocked)
  // backend's authoritative state genuinely never changed.
  assert.equal(snapshots.length, 1);
  assert.equal(engine.getAppliedRevision(), '1');
  assert.notEqual(snapshots[0].roundNumber, 2);
});

test('a successful mutation resolves with exactly the backend result, never something synthesized locally', async () => {
  const { engine, adapter } = await buildReadyEngine('1');
  const backendResult = { schemaVersion: 1, sessionId: session, revision: '2', roundNumber: 2 };
  adapter.setMutateResult(async () => backendResult);
  const bridge = createMutationBridge(engine);
  const outcome = await mutateWithConflictRecovery(engine, session, () => bridge.setRound(session, 2));
  assert.deepEqual(outcome, { ok: true, result: backendResult });
});

test('offline/local mode is structurally unaffected: nothing in the local entry point imports the mutation bridge', () => {
  for (const file of ['src/main.js', 'src/app/legacyBootstrap.js']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /mutationBridge/, `${file} must not import the realtime mutation bridge`);
  }
});
