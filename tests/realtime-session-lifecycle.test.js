import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSyncEngine } from '../src/realtime/engine.js';
import { createFakeAdapter } from '../src/realtime/fakeAdapter.js';
import { createSessionLifecycle } from '../src/realtime/sessionLifecycle.js';
import { SyncStatus } from '../src/realtime/types.js';

const session = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const snap = (id, revision) => ({ sessionId: id, revision });
const flush = () => new Promise(resolve => setImmediate(resolve));

function createFakeScheduler() {
  let idCounter = 0;
  const active = new Map();
  return {
    setIntervalFn: (fn) => { const id = ++idCounter; active.set(id, fn); return id; },
    clearIntervalFn: (id) => { active.delete(id); },
    fire(id) { active.get(id)?.(); },
    isActive(id) { return active.has(id); },
    activeCount() { return active.size; },
  };
}

function tracker() {
  const snapshots = [], statuses = [], errors = [];
  return {
    snapshots, statuses, errors,
    onSnapshot: s => snapshots.push(s),
    onStatus: (s, d) => statuses.push(d ? [s, d] : s),
    onError: e => errors.push(e),
  };
}

function build(adapter, extra = {}) {
  const engine = createSyncEngine(adapter);
  const scheduler = createFakeScheduler();
  const focusTarget = new EventTarget();
  const t = tracker();
  const lifecycle = createSessionLifecycle(engine, {
    onSnapshot: t.onSnapshot, onStatus: t.onStatus, onError: t.onError,
    focusTarget, setIntervalFn: scheduler.setIntervalFn, clearIntervalFn: scheduler.clearIntervalFn,
    periodicHydrateMs: 30000,
    ...extra,
  });
  return { engine, adapter, scheduler, focusTarget, t, lifecycle };
}

test('start subscribes and hydrates; snapshots/status flow through to the caller', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => snap(id, '1'));
  const { lifecycle, t } = build(adapter);
  lifecycle.start(session);
  await flush();
  assert.equal(lifecycle.getStatus(), SyncStatus.SYNCED);
  assert.equal(lifecycle.getSessionId(), session);
  assert.deepEqual(t.snapshots.map(s => s.revision), ['1']);
});

test('stop() before any start() is a safe no-op', () => {
  const { lifecycle, scheduler } = build(createFakeAdapter());
  lifecycle.stop();
  assert.equal(scheduler.activeCount(), 0);
  assert.equal(lifecycle.getSessionId(), null);
});

test('stop() releases the engine subscription and timers, and is idempotent', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => snap(id, '1'));
  const { lifecycle, adapter: a, scheduler } = build(adapter);
  lifecycle.start(session);
  await flush();
  assert.equal(a.isSubscribed(session), true);
  assert.equal(scheduler.activeCount(), 1);
  lifecycle.stop();
  assert.equal(a.isSubscribed(session), false);
  assert.equal(scheduler.activeCount(), 0);
  assert.equal(lifecycle.getStatus(), SyncStatus.IDLE);
  lifecycle.stop(); // idempotent
  assert.equal(scheduler.activeCount(), 0);
});

test('switchTo tears down the previous session and a stale callback from it never reaches the new handlers', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => snap(id, '1'));
  const { lifecycle, adapter: a, t } = build(adapter);
  lifecycle.start(session);
  await flush();
  lifecycle.switchTo(other);
  await flush();
  assert.equal(lifecycle.getSessionId(), other);
  assert.equal(a.isSubscribed(session), false);
  assert.equal(a.isSubscribed(other), true);
  const before = t.snapshots.length;
  // A late invalidation for the abandoned session must not resurrect it through this lifecycle.
  adapter.emitInvalidation(session, '2');
  await flush();
  assert.equal(t.snapshots.length, before);
});

test('denied cancels both the periodic timer and the focus listener, and records the detail', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => snap(id, '1'));
  const { lifecycle, adapter: a, scheduler, focusTarget, t } = build(adapter);
  lifecycle.start(session);
  await flush();
  assert.equal(scheduler.activeCount(), 1);
  adapter.emitStatus(session, SyncStatus.DENIED, { reason: 'session closed' });
  assert.equal(lifecycle.getStatus(), SyncStatus.DENIED);
  assert.deepEqual(lifecycle.getLastDenialDetail(), { reason: 'session closed' });
  assert.equal(scheduler.activeCount(), 0);
  // Confirm the focus listener is truly gone, not just coincidentally quiet.
  const before = a.calls.hydrate.length;
  focusTarget.dispatchEvent(new Event('focus'));
  await flush();
  assert.equal(a.calls.hydrate.length, before);
  assert.deepEqual(t.statuses.at(-1), [SyncStatus.DENIED, { reason: 'session closed' }]);
});

test('a focus event triggers engine.hydrate for the active session', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => snap(id, '1'));
  const { lifecycle, adapter: a, focusTarget } = build(adapter);
  lifecycle.start(session);
  await flush();
  const before = a.calls.hydrate.length;
  adapter.setHydrateResult(async id => snap(id, '2'));
  focusTarget.dispatchEvent(new Event('visibilitychange'));
  await flush();
  assert.equal(a.calls.hydrate.length, before + 1);
  assert.equal(lifecycle.getStatus(), SyncStatus.SYNCED);
});

test('a periodic tick triggers engine.hydrate for the active session', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => snap(id, '1'));
  const { lifecycle, adapter: a, scheduler } = build(adapter);
  lifecycle.start(session);
  await flush();
  const before = a.calls.hydrate.length;
  adapter.setHydrateResult(async id => snap(id, '2'));
  scheduler.fire(1); // the one interval armed by start()
  await flush();
  assert.equal(a.calls.hydrate.length, before + 1);
});

test('a stale timer from a session that was already stopped never fires a hydrate', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => snap(id, '1'));
  const { lifecycle, adapter: a, scheduler } = build(adapter);
  lifecycle.start(session);
  await flush();
  const handle = 1;
  lifecycle.stop();
  const before = a.calls.hydrate.length;
  scheduler.fire(handle); // simulates a real timer that already fired before clearInterval landed
  await flush();
  assert.equal(a.calls.hydrate.length, before);
});

test('reconnect is forwarded without any lifecycle intervention — the engine already re-hydrates', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => snap(id, '1'));
  const { lifecycle, t } = build(adapter);
  lifecycle.start(session);
  await flush();
  adapter.emitStatus(session, SyncStatus.RECONNECTING);
  adapter.setHydrateResult(async id => snap(id, '4'));
  adapter.emitStatus(session, SyncStatus.SYNCED);
  await flush();
  assert.equal(lifecycle.getStatus(), SyncStatus.SYNCED);
  assert.equal(t.snapshots.at(-1).revision, '4');
});

test('nothing in this module touches localStorage/sessionStorage', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/realtime/sessionLifecycle.js'), 'utf8');
  assert.doesNotMatch(source, /(localStorage|sessionStorage)(\.\w|\[)/);
});
