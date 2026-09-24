import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine } from '../src/realtime/engine.js';
import { createFakeAdapter } from '../src/realtime/fakeAdapter.js';
import { mutateWithConflictRecovery } from '../src/realtime/mutationBridge.js';
import { createSessionLifecycle } from '../src/realtime/sessionLifecycle.js';

const session = 'session-a';
const flush = () => new Promise(resolve => setImmediate(resolve));
const snap = revision => ({ sessionId: session, revision });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('initial subscription waits for readiness, buffers invalidations, and never calls transport ready authoritative', async () => {
  const gate = deferred();
  let callbacks, reads = 0;
  const engine = createSyncEngine({
    subscribe(id, handlers) { callbacks = handlers; return () => {}; },
    hydrate() { reads++; return gate.promise; },
  });
  const states = [], statuses = [];
  engine.subscribe(session, { onSnapshot: s => states.push(s), onStatus: s => statuses.push(s) });
  await flush();
  assert.equal(reads, 0);
  callbacks.onEvent({ sessionId: session, revision: '4' });
  assert.equal(reads, 0);
  callbacks.onStatus('synced');
  assert.equal(reads, 1);
  assert.ok(!statuses.includes('synced'));
  gate.resolve(snap('4'));
  await flush();
  assert.equal(reads, 1, 'buffer covered by snapshot is discarded');
  assert.deepEqual(states, [snap('4')]);
  assert.equal(engine.getStatus(), 'synced');
});

for (const lateFailure of [false, true]) test(`transport denial invalidates an in-flight hydrate (${lateFailure ? 'failure' : 'success'})`, async () => {
  const adapter = createFakeAdapter();
  const engine = createSyncEngine(adapter);
  const snapshots = [];
  engine.subscribe(session, { onSnapshot: s => snapshots.push(s) });
  await flush();
  const gate = deferred();
  adapter.setHydrateResult(() => gate.promise);
  adapter.emitInvalidation(session, '2');
  adapter.emitInvalidation(session, '3');
  adapter.emitStatus(session, 'denied');
  const before = snapshots.length;
  if (lateFailure) gate.reject(new Error('late network failure'));
  else gate.resolve(snap('3'));
  await flush();
  assert.equal(engine.getStatus(), 'denied');
  assert.equal(engine.getAppliedRevision(), null);
  assert.equal(engine.getObservedRevision(), null);
  assert.equal(snapshots.length, before);
  assert.equal(adapter.calls.hydrate.length, 2);
  assert.equal(adapter.isSubscribed(session), false);
});

test('reconnect after a hydration in the outage still requires a post-readiness snapshot', async () => {
  const adapter = createFakeAdapter();
  const engine = createSyncEngine(adapter);
  engine.subscribe(session);
  await flush();
  adapter.emitStatus(session, 'reconnecting');
  await engine.hydrate(session);
  const before = adapter.calls.hydrate.length;
  adapter.emitStatus(session, 'synced');
  await flush();
  assert.equal(adapter.calls.hydrate.length, before + 1);
});

test('late mutation conflict cannot restart a session after disconnect or denial', async () => {
  for (const end of ['disconnect', 'denied']) {
    const adapter = createFakeAdapter();
    const engine = createSyncEngine(adapter);
    engine.subscribe(session);
    await flush();
    const gate = deferred();
    adapter.setMutateResult(() => gate.promise);
    const result = mutateWithConflictRecovery(engine, session, () => engine.mutate(session, { type: 'session.setRound', payload: { roundNumber: 2 } }));
    if (end === 'disconnect') engine.disconnect();
    else adapter.emitStatus(session, 'denied');
    const before = adapter.calls.hydrate.length;
    gate.reject({ code: '40001' });
    assert.equal((await result).conflict, true);
    assert.equal(adapter.calls.hydrate.length, before);
    assert.equal(engine.getStatus(), end === 'disconnect' ? 'idle' : 'denied');
  }
});

test('focus hydration before first SUBSCRIBED also waits for the initial barrier', async () => {
  let callbacks, reads = 0;
  const engine = createSyncEngine({
    subscribe(id, handlers) { callbacks = handlers; return () => {}; },
    async hydrate() { reads++; return snap('1'); },
  });
  engine.subscribe(session);
  const waiting = engine.hydrate(session);
  await flush();
  assert.equal(reads, 0);
  callbacks.onStatus('synced');
  await waiting;
  assert.equal(engine.getAppliedRevision(), '1');
});

test('synchronous subscription denial never arms lifecycle recovery timers', () => {
  let timers = 0;
  const engine = createSyncEngine({ subscribe(id, handlers) { handlers.onStatus('denied'); return () => {}; } });
  const lifecycle = createSessionLifecycle(engine, { focusTarget: null, setIntervalFn: () => ++timers });
  lifecycle.start(session);
  assert.equal(engine.getStatus(), 'denied');
  assert.equal(timers, 0);
});

test('a recovery timer already queued before denial cannot restart hydration', async () => {
  let tick;
  const adapter = createFakeAdapter();
  const engine = createSyncEngine(adapter);
  const lifecycle = createSessionLifecycle(engine, {
    focusTarget: null, setIntervalFn: fn => { tick = fn; return 1; }, clearIntervalFn: () => {},
  });
  lifecycle.start(session);
  await flush();
  adapter.emitStatus(session, 'denied');
  const before = adapter.calls.hydrate.length;
  tick();
  await flush();
  assert.equal(adapter.calls.hydrate.length, before);
  assert.equal(engine.getStatus(), 'denied');
});

test('a read begun during an outage cannot report synced before the post-SUBSCRIBED read', async () => {
  const adapter = createFakeAdapter();
  const engine = createSyncEngine(adapter);
  const statuses = [];
  engine.subscribe(session, { onStatus: s => statuses.push(s) });
  await flush();
  adapter.emitStatus(session, 'reconnecting');
  statuses.length = 0;
  const outage = deferred(), fresh = deferred();
  adapter.setHydrateResult(() => outage.promise);
  const pending = engine.hydrate(session);
  adapter.emitStatus(session, 'synced');
  adapter.setHydrateResult(() => fresh.promise);
  outage.resolve(snap('1'));
  await pending;
  await flush();
  assert.ok(!statuses.includes('synced'));
  fresh.resolve(snap('2'));
  await flush();
  assert.equal(engine.getStatus(), 'synced');
  assert.equal(engine.getAppliedRevision(), '2');
});

test('obsolete unsubscribe cannot close same-session re-entry with reused handlers', async () => {
  const adapter = createFakeAdapter();
  const engine = createSyncEngine(adapter);
  const handlers = {};
  const oldStop = engine.subscribe(session, handlers);
  await flush();
  engine.subscribe(session, handlers);
  oldStop();
  await flush();
  assert.equal(adapter.isSubscribed(session), true);
  assert.equal(engine.getStatus(), 'synced');
});
