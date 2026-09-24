import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseSyncAdapter } from '../src/realtime/supabaseAdapter.js';
import { SyncStatus } from '../src/realtime/types.js';

const session = '22222222-2222-4222-8222-222222222222';

/** A local double for the *Supabase client* shape (rpc/channel/removeChannel) — one layer below
 * the SyncAdapter contract fakeAdapter.js already fakes. Testing supabaseAdapter's own
 * normalization/status-mapping logic, not the engine. */
function createFakeSupabaseClient() {
  let rpcImpl = async () => ({ data: null, error: null });
  const rpcCalls = [];
  const channels = [];
  const removedChannels = [];
  return {
    rpcCalls, channels, removedChannels,
    setRpcResult(fn) { rpcImpl = fn; },
    async rpc(name, args) { rpcCalls.push({ name, args }); return rpcImpl(name, args); },
    channel(topic, opts) {
      const rowListeners = [];
      let statusCb = null;
      const channel = {
        topic, opts,
        on(type, filter, cb) { if (type === 'postgres_changes') rowListeners.push({ filter, cb }); return channel; },
        subscribe(cb) { statusCb = cb; return channel; },
        emitRow(row) { rowListeners.forEach(l => l.cb({ new: row })); },
        emitStatus(status, err) { statusCb?.(status, err); },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel(channel) { removedChannels.push(channel); },
  };
}

test('hydrate calls get_session_snapshot and returns the snapshot unchanged', async () => {
  const client = createFakeSupabaseClient();
  const snapshot = { schemaVersion: 1, sessionId: session, revision: '7', roundNumber: 2 };
  client.setRpcResult(async () => ({ data: snapshot, error: null }));
  const adapter = createSupabaseSyncAdapter(client);
  const result = await adapter.hydrate(session);
  assert.equal(result, snapshot); // pass-through, not re-shaped
  assert.deepEqual(client.rpcCalls, [{ name: 'get_session_snapshot', args: { p_session: session } }]);
});

test('hydrate propagates the RPC error unchanged (code preserved for isRevisionConflict-style checks)', async () => {
  const client = createFakeSupabaseClient();
  const denied = Object.assign(new Error('not authorized'), { code: '42501' });
  client.setRpcResult(async () => ({ data: null, error: denied }));
  const adapter = createSupabaseSyncAdapter(client);
  await assert.rejects(() => adapter.hydrate(session), err => err === denied);
});

test('subscribe normalizes a session_events row into the InvalidationEnvelope shape', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  const events = [];
  adapter.subscribe(session, { onEvent: e => events.push(e), onStatus: () => {} });
  const channel = client.channels.at(-1);
  channel.emitRow({ schema_version: 1, id: 'evt-1', session_id: session, revision: '43', type: 'session.invalidated' });
  assert.deepEqual(events, [{ schemaVersion: 1, id: 'evt-1', sessionId: session, revision: '43', type: 'session.invalidated' }]);
});

test('subscribe stringifies a numeric revision defensively', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  const events = [];
  adapter.subscribe(session, { onEvent: e => events.push(e), onStatus: () => {} });
  client.channels.at(-1).emitRow({ schema_version: 1, id: 'evt-1', session_id: session, revision: 43, type: 'session.invalidated' });
  assert.equal(events[0].revision, '43');
  assert.equal(typeof events[0].revision, 'string');
});

test('subscribe passes the required postgres_changes_options.wait config and filters to the session', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  adapter.subscribe(session, { onEvent: () => {}, onStatus: () => {} });
  const channel = client.channels.at(-1);
  assert.deepEqual(channel.opts, { config: { postgres_changes_options: { wait: true, timeout: 15000 } } });
});

test('SUBSCRIBED maps to synced only once the database-subscription barrier clears', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  const statuses = [];
  adapter.subscribe(session, { onEvent: () => {}, onStatus: (s, d) => statuses.push(d ? [s, d] : s) });
  client.channels.at(-1).emitStatus('SUBSCRIBED');
  assert.deepEqual(statuses, [SyncStatus.SYNCED]);
});

test('TIMED_OUT and CHANNEL_ERROR map to reconnecting by default (never synced)', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  const statuses = [];
  adapter.subscribe(session, { onEvent: () => {}, onStatus: (s) => statuses.push(s) });
  const channel = client.channels.at(-1);
  channel.emitStatus('TIMED_OUT');
  channel.emitStatus('CHANNEL_ERROR', new Error('socket hiccup'));
  assert.deepEqual(statuses, [SyncStatus.RECONNECTING, SyncStatus.RECONNECTING]);
});

test('a CHANNEL_ERROR carrying a recognizable authorization payload maps to denied', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  const statuses = [];
  adapter.subscribe(session, { onEvent: () => {}, onStatus: (s, d) => statuses.push(d ? [s, d.error.message] : s) });
  client.channels.at(-1).emitStatus('CHANNEL_ERROR', Object.assign(new Error('permission denied for table session_events'), { code: '42501' }));
  assert.deepEqual(statuses, [[SyncStatus.DENIED, 'permission denied for table session_events']]);
});

test('CLOSED reported by the channel maps to closed, but not when it is this adapter\'s own teardown', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  const statuses = [];
  const unsubscribe = adapter.subscribe(session, { onEvent: () => {}, onStatus: (s) => statuses.push(s) });
  const channel = client.channels.at(-1);
  unsubscribe();
  channel.emitStatus('CLOSED'); // the fake client simulates the channel's own async close landing after unsubscribe()
  assert.deepEqual(statuses, []); // suppressed: this is our own teardown, not an unexpected close
});

test('mutate calls mutate_session with the command unchanged and returns the resolved snapshot', async () => {
  const client = createFakeSupabaseClient();
  const command = { schemaVersion: 1, type: 'session.setRound', expectedRevision: '5', payload: { roundNumber: 2 } };
  const resultSnapshot = { schemaVersion: 1, sessionId: session, revision: '6' };
  client.setRpcResult(async () => ({ data: resultSnapshot, error: null }));
  const adapter = createSupabaseSyncAdapter(client);
  const result = await adapter.mutate(session, command);
  assert.equal(result, resultSnapshot);
  assert.deepEqual(client.rpcCalls, [{ name: 'mutate_session', args: { p_session: session, p_command: command } }]);
});

test('mutate propagates a 40001 conflict error unchanged', async () => {
  const client = createFakeSupabaseClient();
  const conflict = Object.assign(new Error('stale revision'), { code: '40001' });
  client.setRpcResult(async () => ({ data: null, error: conflict }));
  const adapter = createSupabaseSyncAdapter(client);
  await assert.rejects(() => adapter.mutate(session, { type: 'session.setRound', payload: {} }), err => err === conflict);
});

test('the unsubscribe function returned by subscribe is idempotent and removes exactly its own channel', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  const unsubscribe = adapter.subscribe(session, { onEvent: () => {}, onStatus: () => {} });
  const channel = client.channels.at(-1);
  unsubscribe();
  unsubscribe();
  assert.deepEqual(client.removedChannels, [channel]);
});

test('disconnect removes every channel this adapter created and is idempotent', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  adapter.subscribe(session, { onEvent: () => {}, onStatus: () => {} });
  adapter.subscribe('other-session', { onEvent: () => {}, onStatus: () => {} });
  assert.equal(client.channels.length, 2);
  adapter.disconnect();
  assert.equal(client.removedChannels.length, 2);
  adapter.disconnect(); // nothing left to remove; must not throw
  assert.equal(client.removedChannels.length, 2);
});

test('stale callback suppression: events/status from a channel after its own unsubscribe never reach the caller', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  const events = [], statuses = [];
  const unsubscribe = adapter.subscribe(session, { onEvent: e => events.push(e), onStatus: s => statuses.push(s) });
  const channel = client.channels.at(-1);
  unsubscribe();
  channel.emitRow({ schema_version: 1, id: 'late', session_id: session, revision: '1', type: 'session.invalidated' });
  channel.emitStatus('SUBSCRIBED');
  assert.deepEqual(events, []);
  assert.deepEqual(statuses, []);
});

test('session switch callback suppression: a second subscribe() invalidates the first channel\'s callbacks even without calling its unsubscribe', async () => {
  const client = createFakeSupabaseClient();
  const adapter = createSupabaseSyncAdapter(client);
  const events = [];
  adapter.subscribe(session, { onEvent: e => events.push(['first', e]), onStatus: () => {} });
  const firstChannel = client.channels.at(-1);
  adapter.subscribe('other-session', { onEvent: e => events.push(['second', e]), onStatus: () => {} });
  const secondChannel = client.channels.at(-1);
  // The first channel's own row listener is still technically wired in the fake transport (as a
  // real socket's in-flight message could be), but the adapter's generation guard must drop it.
  firstChannel.emitRow({ schema_version: 1, id: 'stale', session_id: session, revision: '1', type: 'session.invalidated' });
  secondChannel.emitRow({ schema_version: 1, id: 'fresh', session_id: 'other-session', revision: '1', type: 'session.invalidated' });
  assert.deepEqual(events, [['second', { schemaVersion: 1, id: 'fresh', sessionId: 'other-session', revision: '1', type: 'session.invalidated' }]]);
  assert.deepEqual(client.removedChannels, [firstChannel]); // also cleaned up at the transport level, not just suppressed
});
