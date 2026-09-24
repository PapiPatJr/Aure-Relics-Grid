import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSyncEngine, isRevisionConflict, isAccessDeniedError } from '../src/realtime/engine.js';
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
  const statuses = [], snapshots = [], errors = [];
  return {
    statuses, snapshots, errors,
    handlers: {
      onStatus: (s, detail) => statuses.push(detail ? [s, detail] : s),
      onSnapshot: s => snapshots.push(s),
      onError: e => errors.push(e),
    },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const snap = revision => ({ sessionId: session, revision });

test('hydration success installs the snapshot and reports synced', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: '5' }));
  const engine = createSyncEngine(adapter);
  const snapshot = await engine.hydrate(session);
  assert.equal(snapshot.revision, '5');
  assert.equal(engine.getStatus(), SyncStatus.SYNCED);
  assert.equal(engine.getAppliedRevision(), '5');
  assert.equal(engine.getObservedRevision(), '5');
});

test('hydration failure reports error status and propagates the rejection', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => { throw new Error('access denied'); });
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await assert.rejects(() => engine.hydrate(session), /access denied/);
  assert.equal(engine.getStatus(), SyncStatus.ERROR);
  assert.equal(t.errors.length >= 1, true);
});

test('malformed (non-decimal-string) snapshot revision is rejected, not silently coerced', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: 5 })); // number, not a string: must fail closed
  const engine = createSyncEngine(adapter);
  await assert.rejects(() => engine.hydrate(session), /decimal string/);
  assert.equal(engine.getAppliedRevision(), null);
});

test('subscription success hydrates and reaches synced with hydrating observed first', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: '1' }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  assert.deepEqual(adapter.calls.subscribe, [session]);
  await flush();
  assert.equal(engine.getStatus(), SyncStatus.SYNCED);
  assert.ok(t.statuses.includes(SyncStatus.HYDRATING));
  assert.ok(t.statuses.includes(SyncStatus.SYNCED));
  assert.equal(t.snapshots.length, 1);
});

test('decimal-string revisions order correctly even where lexical comparison would get it backward', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('9'));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  assert.equal(engine.getAppliedRevision(), '9');
  // "10" < "9" lexically, but 10n > 9n — a correct engine must still treat this as newer and re-hydrate.
  adapter.setHydrateResult(async () => snap('10'));
  adapter.emitInvalidation(session, '10');
  await flush();
  assert.equal(adapter.calls.hydrate.length, 2);
  assert.equal(engine.getAppliedRevision(), '10');
});

test('revisions beyond Number.MAX_SAFE_INTEGER are compared exactly with BigInt, never rounded through Number', async () => {
  const a = '9007199254740992'; // Number.MAX_SAFE_INTEGER + 1
  const b = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2 — as a JS double, this rounds to the SAME value as `a`
  assert.equal(Number(a), Number(b)); // sanity check: naive Number comparison genuinely cannot tell these apart
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap(a));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  assert.equal(engine.getAppliedRevision(), a);
  adapter.setHydrateResult(async () => snap(b));
  adapter.emitInvalidation(session, b);
  await flush();
  assert.equal(engine.getAppliedRevision(), b);
  assert.equal(t.snapshots.at(-1).revision, b);
});

test('an invalidation only triggers re-hydration; it is never itself delivered as state, and onEvent is not a supported handler', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('1'));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  let onEventCalls = 0;
  engine.subscribe(session, { ...t.handlers, onEvent: () => { onEventCalls += 1; } });
  await flush();
  adapter.setHydrateResult(async () => snap('2'));
  adapter.emitInvalidation(session, '2');
  await flush();
  assert.equal(onEventCalls, 0); // the engine never calls a consumer-supplied onEvent
  assert.deepEqual(t.snapshots.map(s => s.revision), ['1', '2']); // only ever full snapshots reach the consumer
});

test('several invalidations arriving while a hydration is already in flight coalesce into exactly one follow-up hydration', async () => {
  const adapter = createFakeAdapter();
  const gate = deferred();
  adapter.setHydrateResult(() => gate.promise);
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers); // kicks off hydrate #1, awaiting `gate`
  await flush();
  assert.equal(adapter.calls.hydrate.length, 1);
  adapter.emitInvalidation(session, '5');
  adapter.emitInvalidation(session, '6');
  adapter.emitInvalidation(session, '7'); // three invalidations land while hydrate #1 is still in flight
  await flush();
  assert.equal(adapter.calls.hydrate.length, 1); // no new hydration has started yet — still coalescing
  adapter.setHydrateResult(async () => snap('7'));
  gate.resolve(snap('3')); // hydrate #1 resolves, itself already stale relative to what was observed
  await flush();
  assert.equal(adapter.calls.hydrate.length, 2); // exactly one coalesced follow-up, not three
  assert.equal(engine.getAppliedRevision(), '7');
  assert.deepEqual(t.snapshots.map(s => s.revision), ['3', '7']);
});

test('a snapshot older than the already-observed invalidation revision still installs, then a follow-up hydration catches up', async () => {
  const adapter = createFakeAdapter();
  const gate = deferred();
  adapter.setHydrateResult(() => gate.promise);
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  adapter.emitInvalidation(session, '5'); // observed jumps ahead of the still-in-flight hydrate
  assert.equal(engine.getObservedRevision(), '5');
  assert.equal(engine.getAppliedRevision(), null);
  adapter.setHydrateResult(async () => snap('5'));
  gate.resolve(snap('3')); // resolves lower than what's already been observed
  await flush();
  assert.equal(engine.getAppliedRevision(), '5'); // the follow-up hydration catches it up, not stuck at 3
  assert.deepEqual(t.snapshots.map(s => s.revision), ['3', '5']);
});

test('subscribe/hydrate race: an invalidation arriving before the very first hydration resolves is not lost', async () => {
  const adapter = createFakeAdapter();
  const gate = deferred();
  adapter.setHydrateResult(() => gate.promise);
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers); // bootstrap hydrate begins immediately, before any snapshot exists
  await flush();
  adapter.emitInvalidation(session, '4'); // races in before the bootstrap hydrate has resolved
  adapter.setHydrateResult(async () => snap('4'));
  gate.resolve(snap('1'));
  await flush();
  assert.equal(engine.getAppliedRevision(), '4'); // would incorrectly stay at '1' without race-safe coalescing
});

test('duplicate and stale invalidations never regress the observed watermark or trigger a hydration', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('5'));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  const before = adapter.calls.hydrate.length;
  adapter.emitInvalidation(session, '3'); // stale: older than what's already applied
  adapter.emitInvalidation(session, '5'); // duplicate of what's already applied
  await flush();
  assert.equal(adapter.calls.hydrate.length, before);
  assert.equal(engine.getObservedRevision(), '5');
  adapter.setHydrateResult(async () => snap('9')); // set the result before the invalidation that triggers the hydrate it satisfies
  adapter.emitInvalidation(session, '9');
  await flush();
  assert.equal(adapter.calls.hydrate.length, before + 1);
  assert.equal(engine.getAppliedRevision(), '9');
  adapter.emitInvalidation(session, '9'); // duplicate of the just-observed/applied revision
  await flush();
  assert.equal(adapter.calls.hydrate.length, before + 1); // no extra hydration triggered
});

test('reconnect triggers re-hydration before returning to synced', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('1'));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  assert.equal(adapter.calls.hydrate.length, 1);
  adapter.emitStatus(session, SyncStatus.RECONNECTING);
  assert.equal(engine.getStatus(), SyncStatus.RECONNECTING);
  adapter.setHydrateResult(async () => snap('4'));
  adapter.emitStatus(session, SyncStatus.SYNCED);
  await flush();
  assert.equal(adapter.calls.hydrate.length, 2);
  assert.equal(engine.getStatus(), SyncStatus.SYNCED);
  assert.equal(engine.getAppliedRevision(), '4');
});

test('access revoked while reconnecting ends in denied without a spurious re-hydration', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('1'));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  const before = adapter.calls.hydrate.length;
  adapter.emitStatus(session, SyncStatus.RECONNECTING);
  adapter.emitStatus(session, SyncStatus.DENIED, { reason: 'membership revoked' });
  assert.equal(engine.getStatus(), SyncStatus.DENIED);
  assert.equal(adapter.calls.hydrate.length, before);
});

test('access denial clears both revision watermarks, stops exposing stale state and structurally blocks mutation without a manufactured permission check', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('8'));
  adapter.setMutateResult(async (id, command) => ({ command }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  assert.equal(engine.getAppliedRevision(), '8');
  adapter.emitStatus(session, SyncStatus.DENIED, { reason: 'session closed' });
  assert.equal(engine.getStatus(), SyncStatus.DENIED);
  assert.equal(engine.getAppliedRevision(), null);
  assert.equal(engine.getObservedRevision(), null);
  // Structural, not a manufactured authorization decision: there is no trusted revision to pin a
  // mutation to. The backend was never asked and never gets to say no here — there's nothing to send.
  await assert.rejects(() => engine.mutate(session, { type: 'session.setRound', payload: { roundNumber: 2 } }), /No authoritative snapshot/);
  assert.equal(adapter.calls.mutate.length, 0);
});

test('a hydrate() rejection carrying SQLSTATE 42501 maps to denied, not error', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => { throw Object.assign(new Error('not authorized'), { code: '42501' }); });
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await assert.rejects(() => engine.hydrate(session));
  assert.equal(engine.getStatus(), SyncStatus.DENIED);
  assert.ok(t.statuses.some(s => (Array.isArray(s) ? s[0] : s) === SyncStatus.DENIED));
  assert.equal(isAccessDeniedError({ code: '42501' }), true);
});

test('malformed, network and generic server hydrate failures still map to error, never denied', async () => {
  for (const error of [
    new Error('ECONNRESET'),
    Object.assign(new Error('malformed command'), { code: '22023' }),
    Object.assign(new Error('internal server error'), { code: '500' }),
    { message: 'no code at all' },
  ]) {
    const adapter = createFakeAdapter();
    adapter.setHydrateResult(async () => { throw error; });
    const engine = createSyncEngine(adapter);
    await assert.rejects(() => engine.hydrate(session));
    assert.equal(engine.getStatus(), SyncStatus.ERROR);
    assert.equal(isAccessDeniedError(error), false);
  }
});

test('denied (from either trigger) tears down the live subscription immediately — no denied socket waits for an invalidation', async () => {
  // Trigger 1: an adapter-pushed denied status.
  {
    const adapter = createFakeAdapter();
    adapter.setHydrateResult(async () => snap('1'));
    const engine = createSyncEngine(adapter);
    engine.subscribe(session, {});
    await flush();
    assert.equal(adapter.isSubscribed(session), true);
    adapter.emitStatus(session, SyncStatus.DENIED, { reason: 'revoked' });
    assert.equal(adapter.isSubscribed(session), false);
  }
  // Trigger 2: a hydrate() rejection carrying 42501 while a live subscription is active.
  {
    const adapter = createFakeAdapter();
    adapter.setHydrateResult(async () => snap('1'));
    const engine = createSyncEngine(adapter);
    engine.subscribe(session, {});
    await flush();
    assert.equal(adapter.isSubscribed(session), true);
    adapter.setHydrateResult(async () => { throw Object.assign(new Error('not authorized'), { code: '42501' }); });
    await assert.rejects(() => engine.hydrate(session));
    assert.equal(adapter.isSubscribed(session), false);
  }
});

test('denied never lets an already-scheduled follow-up hydrate slip through afterward', async () => {
  const adapter = createFakeAdapter();
  const gate = deferred();
  adapter.setHydrateResult(() => gate.promise);
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers); // bootstrap hydrate begins, awaiting `gate`
  await flush();
  adapter.emitInvalidation(session, '2'); // coalesces onto the in-flight hydrate; schedules a follow-up
  assert.equal(adapter.calls.hydrate.length, 1);
  gate.reject(Object.assign(new Error('not authorized'), { code: '42501' }));
  await flush();
  assert.equal(engine.getStatus(), SyncStatus.DENIED);
  // The coalesced follow-up that was pending must not have been allowed to fire after denial.
  assert.equal(adapter.calls.hydrate.length, 1);
});

test('disconnect unsubscribes, releases the adapter and returns to idle', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('1'));
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  assert.equal(adapter.isSubscribed(session), true);
  engine.disconnect();
  assert.equal(adapter.isSubscribed(session), false);
  assert.equal(adapter.calls.disconnect, 1);
  assert.equal(engine.getStatus(), SyncStatus.IDLE);
  assert.equal(engine.getSessionId(), null);
  assert.equal(engine.getAppliedRevision(), null);
  engine.disconnect(); // idempotent
  assert.equal(adapter.calls.disconnect, 2);
});

test('switching sessions resets both revision concepts and ignores the previous session late invalidations', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async id => ({ sessionId: id, revision: '7' }));
  const engine = createSyncEngine(adapter);
  const t = tracker();
  engine.subscribe(session, t.handlers);
  await flush();
  assert.equal(engine.getAppliedRevision(), '7');
  engine.subscribe(other, t.handlers);
  assert.equal(engine.getAppliedRevision(), null); // reset synchronously, before the new session's own hydrate resolves
  assert.equal(engine.getObservedRevision(), null);
  await flush();
  assert.equal(adapter.isSubscribed(session), false);
  assert.equal(adapter.isSubscribed(other), true);
  const before = adapter.calls.hydrate.length;
  // The fake adapter already dropped session's subscriber entry on unsubscribe, so this is a
  // no-op at the transport layer too — proving the switch's cleanup actually ran. The engine's
  // own onInvalidation also guards on `targetCtx !== ctx`, for transports that deliver a little
  // late during teardown instead of dropping the listener instantly.
  adapter.emitInvalidation(session, '99');
  await flush();
  assert.equal(adapter.calls.hydrate.length, before);
});

test('mutation success resolves with the adapter result and attaches expectedRevision/schemaVersion/commandId', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('12'));
  adapter.setMutateResult(async (id, command) => ({ ok: true, command }));
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  const result = await engine.mutate(session, { type: 'session.setRound', payload: { roundNumber: 2 }, commandId: 'abc' });
  assert.equal(result.ok, true);
  const sent = adapter.calls.mutate.at(-1).command;
  assert.deepEqual(sent, { schemaVersion: 1, type: 'session.setRound', expectedRevision: '12', payload: { roundNumber: 2 }, commandId: 'abc' });
});

test('expectedRevision always comes from the applied snapshot, never from an observed-but-unhydrated invalidation', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('10'));
  adapter.setMutateResult(async (id, command) => ({ command }));
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  assert.equal(engine.getAppliedRevision(), '10');
  const gate = deferred();
  adapter.setHydrateResult(() => gate.promise); // the follow-up hydration below will hang, applied stays '10'
  adapter.emitInvalidation(session, '20');
  await flush();
  assert.equal(engine.getObservedRevision(), '20');
  assert.equal(engine.getAppliedRevision(), '10'); // still 10 — the follow-up hasn't resolved
  await engine.mutate(session, { type: 'session.setRound', payload: { roundNumber: 3 } });
  assert.equal(adapter.calls.mutate.at(-1).command.expectedRevision, '10');
  gate.resolve(snap('20')); // let the pending hydration settle so nothing leaks into the next test
  await flush();
});

test('mutating an unhydrated session is a structural error, not a manufactured permission check', async () => {
  const adapter = createFakeAdapter();
  const engine = createSyncEngine(adapter);
  await assert.rejects(() => engine.mutate(session, { type: 'session.setRound', payload: {} }), /hydrate/i);
  assert.equal(adapter.calls.mutate.length, 0);
});

test('a stale-revision (40001) mutation rejection is classified but never auto-replayed', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('1'));
  const conflict = Object.assign(new Error('stale revision'), { code: '40001' });
  adapter.setMutateResult(async () => { throw conflict; });
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  await assert.rejects(() => engine.mutate(session, { type: 'session.setRound', payload: { roundNumber: 2 } }), err => {
    assert.equal(isRevisionConflict(err), true);
    return true;
  });
  assert.equal(adapter.calls.mutate.length, 1); // the engine itself never retries
  assert.equal(isRevisionConflict(new Error('unrelated')), false);
  assert.equal(isRevisionConflict(null), false);
});

test('mutation errors unrelated to revision conflicts propagate and are not classified as one', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap('1'));
  adapter.setMutateResult(async () => { throw new Error('rejected by policy'); });
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  await assert.rejects(() => engine.mutate(session, { type: 'session.setRound', payload: {} }), err => {
    assert.equal(isRevisionConflict(err), false);
    return /rejected by policy/.test(err.message);
  });
});

test('the realtime module stores nothing in localStorage/sessionStorage', () => {
  for (const file of ['src/realtime/engine.js', 'src/realtime/fakeAdapter.js', 'src/realtime/types.js']) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(source, /(localStorage|sessionStorage)(\.\w|\[)/, `${file} must not touch browser storage`);
  }
});
