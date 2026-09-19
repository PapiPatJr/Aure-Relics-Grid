import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSupabaseConfig } from '../src/supabase/config.js';
import { getSupabaseClient } from '../src/supabase/client.js';

const url = 'https://example.supabase.co';
const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

test('missing configuration leaves the offline board available', () => {
  assert.equal(readSupabaseConfig({}), null);
  assert.equal(getSupabaseClient({}), null);
});
test('accepts publishable keys and legacy anon keys', () => {
  assert.deepEqual(readSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }), { url, key: 'sb_publishable_test' });
  assert.equal(readSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: jwt('anon') }).key, jwt('anon'));
});
test('rejects partial config, non-HTTPS remote URLs and privileged or malformed keys', () => {
  assert.throws(() => readSupabaseConfig({ VITE_SUPABASE_URL: url }), /both/);
  for (const key of ['sb_secret_test', jwt('service_role'), jwt('authenticated'), 'not-a-key']) {
    assert.throws(() => readSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key }), /publishable|anon/);
  }
  for (const badUrl of ['http://remote.example', 'https://user:password@example.com', 'bad-url']) {
    assert.throws(() => readSupabaseConfig({ VITE_SUPABASE_URL: badUrl, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }), /URL/);
  }
});
test('permits HTTP for local Supabase and returns a reusable lazy client', () => {
  const env = { VITE_SUPABASE_URL: 'http://127.0.0.1:56321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
  const client = getSupabaseClient(env);
  assert.equal(client, getSupabaseClient(env));
  assert.equal(typeof client.from, 'function');
});
