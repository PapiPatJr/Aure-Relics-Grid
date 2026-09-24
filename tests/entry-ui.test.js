import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { startEntry } from '../src/entry/app.js';

const campaign = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const dm = { id: 'dm', is_anonymous: false };
const guest = { id: 'guest', is_anonymous: true };
const code = `${campaign}.${session}.${'a'.repeat(64)}`;
const delay = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle() { for (let i = 0; i < 8; i++) await delay(); }

function fixture(t, hash = '#login', initialUser = null, boot = async () => {}) {
  const dom = new JSDOM('<header class="app-header"></header><main id="onlineEntry" hidden></main><div id="legacyBoard" hidden>Local board</div>', { url: `https://aure.example/${hash}` });
  const originals = new Map();
  for (const key of ['window', 'document', 'location', 'history', 'FormData', 'Event']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  let current = initialUser, authCallback, boots = 0, lobbyStatus = 'pending';
  let roster = [{ user_id: 'guest', display_name: '<img src=x onerror=alert(1)>', status: 'pending' }];
  const calls = [], channelCalls = [], removedChannels = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: current } }),
      onAuthStateChange: cb => { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signUp: async () => ({ data: { user: dm, session: null } }),
      signInWithPassword: async () => { current = dm; authCallback('SIGNED_IN', { user: dm }); return { data: { session: { user: dm } } }; },
      signOut: async () => { current = null; authCallback('SIGNED_OUT', null); return { error: null }; },
      signInAnonymously: async () => { current = guest; authCallback('SIGNED_IN', { user: guest }); return { data: { user: guest } }; }
    },
    from(table) {
      let inserted, single = false;
      const query = {
        select: () => query, eq: () => query, order: () => query,
        insert: row => { inserted = row; calls.push({ table, row }); return query; },
        single: () => { single = true; return query; },
        then(resolve) {
          const row = table === 'campaigns' ? { id: campaign, owner_id: 'dm', name: 'Ember Court', ...inserted } : { id: session, campaign_id: campaign, name: 'First gathering', status: 'lobby', ...inserted };
          return Promise.resolve({ data: single ? row : [row] }).then(resolve);
        }
      }; return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'issue_session_code') return { data: 'a'.repeat(64) };
      if (name === 'get_guest_lobby') return { data: { status: lobbyStatus, campaign_name: 'Ember Court', session_name: 'First gathering' } };
      if (name === 'get_session_roster') return { data: roster };
      if (name === 'review_session_guest') roster = roster.map(row => ({ ...row, status: args.p_action === 'approve' ? 'approved' : 'revoked' }));
      if (name === 'get_session_snapshot') {
        return { data: { schemaVersion: 1, sessionId: args.p_session, campaignId: campaign, revision: '0', authority: { canManage: true, ownCharacterId: null }, session: { id: args.p_session, name: 'First gathering', status: 'active', activeLevelId: null }, roundNumber: 1, tokens: [], characters: [], initiative: [], dm: null } };
      }
      return { data: null };
    },
    // Issue #8C: startEntry's board route additively starts a realtime session sync alongside
    // the local board. A minimal fake channel keeps this fixture's synchronous subscribe() call
    // from throwing; it never actually delivers an invalidation in these tests.
    channel(topic) {
      let statusCallback;
      const fakeChannel = { topic, on: () => fakeChannel, subscribe: cb => { statusCallback = cb; cb?.('SUBSCRIBED'); return fakeChannel; }, emitStatus: (...args) => statusCallback?.(...args) };
      channelCalls.push(fakeChannel);
      return fakeChannel;
    },
    removeChannel(channel) { removedChannels.push(channel); },
  };
  const stop = startEntry(client, async () => { boots++; await boot(); });
  t.after(() => {
    stop(); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return {
    client, calls, channelCalls, removedChannels, document: dom.window.document, boots: () => boots,
    click(action) { const el = document.querySelector(`[data-action="${action}"]`); assert.ok(el, `button ${action}`); el.click(); },
    submit(kind, values) {
      const form = document.querySelector(`[data-form="${kind}"]`); assert.ok(form);
      for (const [key, value] of Object.entries(values)) form.elements.namedItem(key).value = value;
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    },
    status(value) { lobbyStatus = value; roster = roster.map(row => ({ ...row, status: value })); },
    externalLogout() { current = null; authCallback('SIGNED_OUT', null); }
  };
}

test('board clears its synchronized projection on transport or snapshot denial', async t => {
  const app = fixture(t, `#board/${session}`, dm);
  const rendered = [];
  window.aureRelicsApplyRealtimeSnapshot = view => rendered.push(view);
  await settle();
  assert.ok(rendered.at(-1));
  app.channelCalls.at(-1).emitStatus('CHANNEL_ERROR', { code: '42501' });
  await settle();
  assert.equal(rendered.at(-1), null);
  assert.equal(app.removedChannels.length, 1);
});

test('board clears its synchronized projection on snapshot RPC 42501', async t => {
  const app = fixture(t, `#board/${session}`, dm);
  const rendered = [];
  window.aureRelicsApplyRealtimeSnapshot = view => rendered.push(view);
  await settle();
  assert.ok(rendered.at(-1));
  const originalRpc = app.client.rpc;
  app.client.rpc = (name, args) => name === 'get_session_snapshot'
    ? Promise.resolve({ data: null, error: { code: '42501' } }) : originalRpc(name, args);
  window.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(rendered.at(-1), null);
  assert.equal(app.removedChannels.length, 1);
});

test('pagehide invalidates board startup already awaiting its import', async t => {
  let finishBoot;
  const pending = new Promise(resolve => { finishBoot = resolve; });
  const app = fixture(t, `#board/${session}`, dm, () => pending);
  await settle();
  assert.equal(app.boots(), 1);
  window.dispatchEvent(new Event('pagehide'));
  finishBoot();
  await settle();
  assert.equal(app.channelCalls.length, 0);
});

test('DM login, campaign creation, session hosting and approval render through the entry flow', async t => {
  const app = fixture(t); await settle();
  app.submit('login', { email: 'dm@example.test', password: 'password123' }); await settle();
  assert.match(document.querySelector('h1').textContent, /Your campaigns/);
  app.submit('campaign', { name: 'Ember Court' }); await settle();
  assert.equal(app.calls.find(c => c.table === 'campaigns').row.owner_id, 'dm');
  app.submit('session', { name: 'First gathering' }); await settle();
  assert.equal(app.calls.find(c => c.table === 'sessions').row.campaign_id, campaign);
  assert.equal(document.querySelector('#roster img'), null, 'player names are escaped');
  app.click('issue'); await settle();
  assert.equal(document.querySelector('#shareCode').value, code);
  assert.equal(document.querySelector('#shareLink').value, `https://aure.example/#join/${code}`);
  app.click('approve'); await settle();
  assert.ok(app.calls.some(c => c.name === 'review_session_guest' && c.args.p_action === 'approve'));
  assert.match(document.querySelector('#roster').textContent, /approved/);
  app.click('board'); await settle();
  assert.equal(app.boots(), 1); assert.equal(document.querySelector('#legacyBoard').hidden, false);
  app.externalLogout(); await settle();
  assert.equal(document.querySelector('#legacyBoard').hidden, true, 'cross-tab logout hides board immediately');
});
async function reachSessionBoard(t) {
  const app = fixture(t); await settle();
  app.submit('login', { email: 'dm@example.test', password: 'password123' }); await settle();
  app.submit('campaign', { name: 'Ember Court' }); await settle();
  app.submit('session', { name: 'First gathering' }); await settle();
  app.click('board'); await settle();
  return app;
}

test('leaving the board route tears down the realtime subscription (Issue #8C.1)', async t => {
  const app = await reachSessionBoard(t);
  assert.equal(app.channelCalls.length, 1);
  assert.equal(app.removedChannels.length, 0);
  document.querySelector('.entry-board-back').click(); await settle();
  assert.equal(app.removedChannels.length, 1);
  assert.equal(app.removedChannels[0], app.channelCalls[0]);
});

test('re-entering the board route starts a fresh realtime subscription (Issue #8C.1)', async t => {
  const app = await reachSessionBoard(t);
  document.querySelector('.entry-board-back').click(); await settle();
  app.click('board'); await settle();
  assert.equal(app.channelCalls.length, 2);
  assert.equal(app.removedChannels.length, 1);
});

test('logout tears down the realtime subscription immediately (Issue #8C.1)', async t => {
  const app = await reachSessionBoard(t);
  assert.equal(app.channelCalls.length, 1);
  app.click('logout'); await settle();
  assert.ok(app.removedChannels.includes(app.channelCalls[0]));
});

test('registration without a session asks for email confirmation and does not enter dashboard', async t => {
  const app = fixture(t, '#register'); await settle();
  app.submit('register', { email: 'dm@example.test', password: 'password123' }); await settle();
  assert.match(document.querySelector('#entryNotice').textContent, /Check your email/);
  assert.ok(document.querySelector('[data-form="register"]'));
  assert.equal(app.boots(), 0);
});
test('join link is scrubbed, creates anonymous request, waits, enters lobby and loses access on revoke', async t => {
  const app = fixture(t, `#join/${code}`); await settle();
  assert.equal(location.hash, '#join'); assert.equal(document.querySelector('#code').value, code);
  app.submit('join', { code, displayName: 'Player' }); await settle();
  assert.match(document.querySelector('#lobbyState').textContent, /request is with the DM/);
  assert.equal(document.querySelector('#roster').textContent, '');
  app.status('approved'); app.click('refresh'); await settle();
  assert.match(document.querySelector('#lobbyState').textContent, /Welcome to the party/);
  app.status('revoked'); app.click('refresh'); await settle();
  assert.match(document.querySelector('#lobbyState').textContent, /declined or access was removed/);
  assert.equal(document.querySelector('#roster').textContent, '');
  assert.equal(document.querySelector('#legacyBoard').hidden, true); assert.equal(app.boots(), 0);
});
test('anonymous guest deep links cannot initialize DM board or dashboard', async t => {
  const app = fixture(t, `#board/${session}`, guest); await settle();
  assert.ok(document.querySelector('[data-form="join"]')); assert.equal(app.boots(), 0);
  assert.equal(app.calls.filter(c => c.table).length, 0);
});
test('late private page response after external logout cannot show private content', async t => {
  const app = fixture(t, '#dm', dm);
  let release;
  app.client.from = () => { const query = { select: () => query, eq: () => query, order: () => new Promise(resolve => { release = resolve; }) }; return query; };
  await settle(); app.externalLogout(); await settle();
  release({ data: [{ id: campaign, name: 'PRIVATE SENTINEL' }] }); await settle();
  assert.doesNotMatch(document.body.textContent, /PRIVATE SENTINEL/);
  assert.equal(app.boots(), 0);
});
test('guest refresh failure clears previously approved lobby and roster', async t => {
  const app = fixture(t, `#lobby/${session}`, guest); app.status('approved'); await settle();
  app.client.rpc = async () => ({ error: { message: 'Connection lost' } });
  app.click('refresh'); await settle();
  assert.match(document.querySelector('#lobbyState').textContent, /Unable to verify/);
  assert.equal(document.querySelector('#roster').textContent, '');
});
test('registered participant may use an approved player lobby without initializing a board', async t => {
  const app = fixture(t, `#lobby/${session}`, dm); app.status('approved'); await settle();
  assert.match(document.querySelector('#lobbyState')?.textContent || '', /Welcome to the party/);
  assert.equal(app.boots(), 0);
  assert.ok(app.calls.some(c => c.name === 'get_character_panel'));
});
