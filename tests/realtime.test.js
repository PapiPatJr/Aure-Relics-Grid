import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSyncEngine } from '../src/realtime/engine.js';
import { createFakeAdapter } from '../src/realtime/fakeAdapter.js';
import { SyncStatus } from '../src/realtime/types.js';

const session = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function tracker() {
  const statuses = [], events = [], snapshots = [], errors = [];
  return {
    statuses, events, snapshots, errors,
    handlers: {
      onStatus: (s, detail) => statuses.push(detail ? [s, detail] : s),
      onEvent: e => events.push(e),
      onSnapshot: s => snapshots.push(s),
      onError: e => errors.push(e),
    },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('hydration success applies the snapshot and reports synced', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 5, state: { session: { round: 1 } } }));
  const engine = createSyncEngine(adapter);
  const snapshot = await engine.hydrate(session);
  assert.equal(snapshot.revision, 5);
  assert.equal(snapshot.sessionId, session);
  assert.equal(engine.getStatus(), SyncStatus.SYNCED);
  assert.equal(engine.getSessionId(), session);
});

test('hydration failure reports error status and propagates the rejection', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => { throw new Error('access denied'); });
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers); // registers handlers so onError/onStatus are observable
  await assert.rejects(() => engine.hydrate(session), /access denied/);
  assert.equal(engine.getStatus(), SyncStatus.ERROR);
  assert.equal(t.errors.length >= 1, true);
});

test('subscription success hydrates and reaches synced with hydrating observed first', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 1, state: {} }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  assert.deepEqual(adapter.calls.subscribe, [session]);
  await flush();
  assert.equal(engine.getStatus(), SyncStatus.SYNCED);
  assert.ok(t.statuses.includes(SyncStatus.HYDRATING));
  assert.ok(t.statuses.includes(SyncStatus.SYNCED));
});

test('events apply in order and advance the revision watermark', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 0, state: {} }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  adapter.emitEvent(session, { sessionId: session, revision: 1, category: 'tokens', kind: 'token.moved', payload: { a: 1 } });
  adapter.emitEvent(session, { sessionId: session, revision: 2, category: 'tokens', kind: 'token.moved', payload: { a: 2 } });
  assert.deepEqual(t.events.map(e => e.revision), [1, 2]);
});

test('duplicate events are suppressed', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 0, state: {} }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  const event = { sessionId: session, revision: 1, category: 'tokens', kind: 'token.moved', payload: {} };
  adapter.emitEvent(session, event);
  adapter.emitEvent(session, event);
  assert.equal(t.events.length, 1);
});

test('stale (out-of-order/older) events are rejected without rewinding state', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 0, state: {} }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  adapter.emitEvent(session, { sessionId: session, revision: 1, category: 'tokens', kind: 'a', payload: {} });
  adapter.emitEvent(session, { sessionId: session, revision: 3, category: 'tokens', kind: 'b', payload: {} });
  adapter.emitEvent(session, { sessionId: session, revision: 2, category: 'tokens', kind: 'stale', payload: {} }); // arrives late, already superseded
  assert.deepEqual(t.events.map(e => e.revision), [1, 3]);
});

test('a race between an in-flight hydrate and a newer live event never rewinds the watermark', async () => {
  const adapter = createFakeAdapter();
  const gate = deferred();
  adapter.setHydrateResult(() => gate.promise);
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers); // kicks off hydrate(session), which awaits `gate`
  await flush();
  adapter.emitEvent(session, { sessionId: session, revision: 5, category: 'session', kind: 'advance', payload: {} });
  gate.resolve({ sessionId: session, revision: 2, state: {} }); // stale relative to the event that already landed
  await flush();
  assert.equal(t.events.length, 1);
  assert.equal(t.snapshots.length, 0); // stale snapshot is dropped, never handed to the consumer
  // A subsequent event right after the stale snapshot must still apply, proving the watermark held at 5.
  adapter.emitEvent(session, { sessionId: session, revision: 6, category: 'session', kind: 'advance', payload: {} });
  assert.deepEqual(t.events.map(e => e.revision), [5, 6]);
});

test('reconnect triggers re-hydration before returning to synced', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 1, state: {} }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  assert.equal(adapter.calls.hydrate.length, 1);
  adapter.emitStatus(session, SyncStatus.RECONNECTING);
  assert.equal(engine.getStatus(), SyncStatus.RECONNECTING);
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 4, state: { session: { resynced: true } } }));
  adapter.emitStatus(session, SyncStatus.SYNCED);
  await flush();
  assert.equal(adapter.calls.hydrate.length, 2); // re-hydrated after reconnect
  assert.equal(engine.getStatus(), SyncStatus.SYNCED);
  assert.equal(t.snapshots.at(-1).revision, 4);
});

test('access revoked while reconnecting ends in denied without a spurious re-hydration', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 1, state: {} }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  const before = adapter.calls.hydrate.length;
  adapter.emitStatus(session, SyncStatus.RECONNECTING);
  adapter.emitStatus(session, SyncStatus.DENIED, { reason: 'membership revoked' });
  assert.equal(engine.getStatus(), SyncStatus.DENIED);
  assert.equal(adapter.calls.hydrate.length, before); // no attempt to re-hydrate a denied session
});

test('disconnect unsubscribes, releases the adapter and returns to idle', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 1, state: {} }));
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  assert.equal(adapter.isSubscribed(session), true);
  engine.disconnect();
  assert.equal(adapter.isSubscribed(session), false);
  assert.equal(adapter.calls.disconnect, 1);
  assert.equal(engine.getStatus(), SyncStatus.IDLE);
  assert.equal(engine.getSessionId(), null);
  engine.disconnect(); // idempotent
  assert.equal(adapter.calls.disconnect, 2);
});

test('switching sessions cleans up the previous subscription and ignores its late events', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 0, state: {} }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  engine.subscribe(other, t.handlers);
  await flush();
  assert.equal(adapter.isSubscribed(session), false);
  assert.equal(adapter.isSubscribed(other), true);
  assert.equal(engine.getSessionId(), other);
  adapter.emitEvent(session, { sessionId: session, revision: 99, category: 'tokens', kind: 'late', payload: {} });
  assert.equal(t.events.some(e => e.kind === 'late'), false);
  adapter.emitEvent(other, { sessionId: other, revision: 1, category: 'tokens', kind: 'fresh', payload: {} });
  assert.equal(t.events.some(e => e.kind === 'fresh'), true);
});

test('mutation success resolves with the adapter result and scopes to the active session', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 0, state: {} }));
  adapter.setMutateResult(async (id, command) => ({ ok: true, id, command }));
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  const result = await engine.mutate(session, { category: 'tokens', kind: 'move', payload: { x: 1 } });
  assert.equal(result.ok, true);
  assert.equal(adapter.calls.mutate.at(-1).command.category, 'tokens');
  assert.ok(adapter.calls.mutate.at(-1).command.commandId);
});

test('mutating an unhydrated session is a structural error, not a manufactured permission check', async () => {
  const adapter = createFakeAdapter();
  const engine = createSyncEngine(adapter);
  await assert.rejects(() => engine.mutate(session, { category: 'tokens', kind: 'move', payload: {} }), /hydrate or subscribe/i);
  assert.equal(adapter.calls.mutate.length, 0);
});

test('mutation errors propagate to the caller', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 0, state: {} }));
  adapter.setMutateResult(async () => { throw new Error('rejected by policy'); });
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  await assert.rejects(() => engine.mutate(session, { category: 'tokens', kind: 'move', payload: {} }), /rejected by policy/);
});

test('a remote echo of a local mutation is tagged, and the engine never re-issues a mutation on its own', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 0, state: {} }));
  adapter.setMutateResult(async (id, command) => ({ command }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  await engine.mutate(session, { category: 'tokens', kind: 'move', payload: {} });
  const commandId = adapter.calls.mutate.at(0).command.commandId;
  assert.equal(adapter.calls.mutate.length, 1);
  adapter.emitEvent(session, { sessionId: session, revision: 1, category: 'tokens', kind: 'move', payload: {}, commandId });
  assert.equal(t.events.at(-1).isLocalEcho, true);
  assert.equal(adapter.calls.mutate.length, 1); // receiving the echo never triggers another mutate()
  // A genuinely remote event (no matching pending command) is tagged as not a local echo.
  adapter.emitEvent(session, { sessionId: session, revision: 2, category: 'tokens', kind: 'move', payload: {}, commandId: 'someone-elses-command' });
  assert.equal(t.events.at(-1).isLocalEcho, false);
});

test('a failed mutation is cleaned up so a later, unrelated event reusing its id is never misread as an echo', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 0, state: {} }));
  let generatedId;
  adapter.setMutateResult(async (id, command) => { generatedId = command.commandId; throw new Error('denied'); });
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  await assert.rejects(() => engine.mutate(session, { category: 'tokens', kind: 'move', payload: {} }));
  adapter.emitEvent(session, { sessionId: session, revision: 1, category: 'tokens', kind: 'move', payload: {}, commandId: generatedId });
  assert.equal(t.events.at(-1).isLocalEcho, false); // pending id was evicted on failure
});

test('denied status can also be reported outside of a reconnect, and is not gated by client logic', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 0, state: {} }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  adapter.emitStatus(session, SyncStatus.DENIED, { reason: 'session closed' });
  assert.equal(engine.getStatus(), SyncStatus.DENIED);
  assert.ok(t.statuses.some(s => (Array.isArray(s) ? s[0] : s) === SyncStatus.DENIED));
});

test('the realtime module stores nothing in localStorage/sessionStorage', () => {
  for (const file of ['src/realtime/engine.js', 'src/realtime/fakeAdapter.js', 'src/realtime/types.js']) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(source, /(localStorage|sessionStorage)(\.\w|\[)/, `${file} must not touch browser storage`);
  }
});
