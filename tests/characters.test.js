import test from 'node:test';
import assert from 'node:assert/strict';
import { characterFields, parseCharacterCode, validatePortrait, createCharacterService } from '../src/characters/service.js';

const campaign = '11111111-1111-4111-8111-111111111111';
const character = '22222222-2222-4222-8222-222222222222';
const secret = 'a'.repeat(64);
test('character codes require exact scope and high entropy format', () => {
  assert.deepEqual(parseCharacterCode(`${campaign}.${character}.${secret}`, campaign), { character, secret });
  for (const value of ['', `${campaign}.${character}.short`, `${character}.${character}.${secret}`]) {
    assert.throws(() => parseCharacterCode(value, campaign));
  }
});
test('shared character input is bounded and contains no approval or ownership fields', () => {
  const fields = { name: ' Aria ', player_name: ' Pat ', hp: '9', max_hp: '12', temp_hp: '0', ac: '15', speed: '30', statuses: 'Blessed, Haste', notes: 'Shared note', approved: true };
  const value = characterFields(fields);
  assert.equal(value.p_name, 'Aria');
  assert.deepEqual(value.p_statuses, ['Blessed', 'Haste']);
  assert.equal(value.p_approved, undefined);
  for (const bad of [{ hp: '1.5' }, { max_hp: '-1' }, { name: ' ' }, { notes: 'x'.repeat(2001) }, { statuses: ','.repeat(21) }]) {
    assert.throws(() => characterFields({ ...fields, ...bad }));
  }
});
test('portraits accept only bounded PNG JPEG WebP', () => {
  validatePortrait({ type: 'image/png', size: 42 });
  for (const file of [{ type: 'image/svg+xml', size: 42 }, { type: 'image/png', size: 5242881 }, { type: 'image/jpeg', size: 0 }]) assert.throws(() => validatePortrait(file));
});
test('reclaim and code issuance use narrow RPCs, never persist secrets', async () => {
  const calls = [];
  const api = createCharacterService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: secret, error: null }; } });
  assert.equal(await api.issue(campaign, character), `${campaign}.${character}.${secret}`);
  await api.reclaim('session', campaign, `${campaign}.${character}.${secret}`);
  assert.deepEqual(calls[1], { name: 'reclaim_character', args: { p_session: 'session', p_character: character, p_code: secret } });
  await assert.rejects(api.reclaim('session', character, `${campaign}.${character}.${secret}`));
  assert.equal(calls.length, 2);
});
