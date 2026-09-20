import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
import { readSupabaseConfig } from '../../src/supabase/config.js';

export const appOrigin = 'http://127.0.0.1:5179';
export const apiOrigin = 'http://127.0.0.1:56321';

/** Server-side only. Never serialize status or administrative credentials. */
export function localStack() {
  assert.match(readFileSync('supabase/config.toml', 'utf8'), /^project_id = "aure-relics-v09-foundation"$/m);
  let status;
  try {
    status = JSON.parse(execFileSync(process.execPath,
      ['node_modules/supabase/dist/supabase.js', 'status', '--output', 'json'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    throw new Error('Start the Aure local Supabase stack before running E2E tests.');
  }
  assert.equal(status.API_URL, apiOrigin, 'E2E refuses any other Supabase URL');
  assert.equal(new URL(status.DB_URL).port, '56322', 'E2E refuses another database');
  assert.equal(JSON.parse(Buffer.from(status.ANON_KEY.split('.')[1], 'base64url')).role, 'anon');
  // Refuse a hosted or privileged app configuration, including process overrides.
  const env = loadEnv('e2e', process.cwd(), 'VITE_');
  const config = readSupabaseConfig(env);
  if (config) {
    assert.equal(config.url, apiOrigin, 'E2E refuses hosted frontend configuration');
    assert.ok([status.ANON_KEY, status.PUBLISHABLE_KEY].filter(Boolean).includes(config.key), 'Frontend key must belong to the Aure local stack');
  }
  return status;
}
