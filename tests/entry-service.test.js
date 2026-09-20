import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJoinCode, formatJoinCode, joinLink, isDm, createEntryService } from '../src/entry/service.js';

const campaign = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const secret = 'a'.repeat(64);
const code = `${campaign}.${session}.${secret}`;

test('join credential preserves exact campaign/session scope and accepts a share link', () => {
  assert.equal(formatJoinCode(campaign, session, secret), code);
  assert.deepEqual(parseJoinCode(code), { campaign, session, secret });
  const link = joinLink('https://aure.example/game/?unused=1#dm', code);
  assert.equal(link, `https://aure.example/game/#join/${code}`);
  assert.deepEqual(parseJoinCode(link), parseJoinCode(code));
});
test('malformed, shortened and foreign-scheme join credentials fail locally', () => {
  for (const value of ['', '123456', `${campaign}.${session}.abc`, `javascript:#join/${code}`, code + '.extra']) {
    assert.throws(() => parseJoinCode(value), /join code/i);
  }
});
test('only a permanent authenticated identity is a DM candidate', () => {
  assert.equal(isDm(null), false);
  assert.equal(isDm({ id: 'guest', is_anonymous: true }), false);
  assert.equal(isDm({ id: 'incomplete' }), false);
  assert.equal(isDm({ id: 'dm', is_anonymous: false }), true);
});
test('guest enrollment reuses anonymous identity and sends scoped RPC arguments', async () => {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: null } }), signInAnonymously: async () => {
      calls.push('anonymous'); return { data: { user: { id: 'guest', is_anonymous: true } } };
    } },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: null }; }
  };
  await createEntryService(client).join(code, '  Patrick  ');
  assert.deepEqual(calls, ['anonymous', { name: 'request_session_join', args: {
    p_campaign: campaign, p_session: session, p_code: secret, p_display_name: 'Patrick'
  } }]);
  calls.length = 0;
  client.auth.getUser = async () => ({ data: { user: { id: 'guest', is_anonymous: true } } });
  await createEntryService(client).join(code, 'Patrick');
  assert.equal(calls.length, 1);
});
test('a DM identity cannot be silently replaced by anonymous guest enrollment', async () => {
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'dm', is_anonymous: false } } }) } };
  await assert.rejects(createEntryService(client).join(code, 'Patrick'), /sign out/i);
});
test('auth errors propagate and logout uses the current browser scope', async () => {
  const calls = [];
  const client = { auth: {
    signUp: async (args) => { calls.push(args); return { data: { session: null } }; },
    signInWithPassword: async () => ({ error: { message: 'Invalid login credentials' } }),
    signOut: async (args) => { calls.push(args); return { error: null }; }
  } };
  const service = createEntryService(client);
  assert.equal((await service.register(' dm@example.com ', 'secret')).session, null);
  await assert.rejects(service.login('dm@example.com', 'wrong'), /Invalid login/);
  await service.logout();
  assert.deepEqual(calls, [{ email: 'dm@example.com', password: 'secret' }, { scope: 'local' }]);
});
test('guest cannot invoke campaign service and owner identity is never taken from form fields', async () => {
  let inserted;
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'owner', is_anonymous: false } } }) },
    from: () => ({ insert: row => { inserted = row; return { select: () => ({ single: async () => ({ data: row }) }) }; } }) };
  const service = createEntryService(client);
  await service.createCampaign('  A new tale  ');
  assert.deepEqual(inserted, { name: 'A new tale', owner_id: 'owner' });
  client.auth.getUser = async () => ({ data: { user: { id: 'guest', is_anonymous: true } } });
  await assert.rejects(service.createCampaign('Spoof'), /DM/);
});
test('join validation prevents unnecessary anonymous account creation', async () => {
  const service = createEntryService({});
  await assert.rejects(service.join(code, '   '), /name/i);
  await assert.rejects(service.join('invalid', 'Patrick'), /join code/i);
});
