// Credentials remain in memory. Only two fixed local test stacks are accepted.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
export function localTestStack() {
  const selected = process.env.AURE_TEST_STACK ?? 'foundation';
  assert.ok(['foundation','08a'].includes(selected), 'Unknown local test stack');
  const isolated = selected === '08a';
  const root = isolated ? 'supabase/.temp/issue08a' : '.';
  const expectedProject = isolated ? 'aure-relics-08a-security' : 'aure-relics-v09-foundation';
  const project = readFileSync(`${root}/supabase/config.toml`,'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal(project, expectedProject, 'Refuse a different project');
  const status = JSON.parse(execFileSync(process.execPath,
    ['node_modules/supabase/dist/supabase.js','status','--workdir',root,'--output','json'],
    {encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));
  assert.equal(status.API_URL, isolated ? 'http://127.0.0.1:57321' : 'http://127.0.0.1:56321',
    'Refuse a different local stack or hosted project');
  return status;
}
