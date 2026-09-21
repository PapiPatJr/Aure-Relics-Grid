import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountCharacters } from '../src/characters/panel.js';
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
test('guest character panel preserves drafts on refresh and clears them on loss of access', async t => {
  const dom = new JSDOM('<div id="panel"></div>');
  const root = dom.window.document.getElementById('panel');
  let denied = false;
  const client = { rpc: async () => denied ? { error: { message: 'Access denied' } } : { data: { campaign_id: 'campaign', characters: [], players: [], own_character_id: null } } };
  const panel = mountCharacters(root, client, { session: 'session', host: false, displayName: 'Amber' });
  t.after(() => { panel.dispose(); dom.window.close(); });
  await settle();
  assert.match(root.textContent, /Create your character/);
  const input = root.querySelector('[name="name"]');
  input.value = 'A draft';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await panel.refresh();
  assert.equal(root.querySelector('[name="name"]').value, 'A draft');
  assert.equal(root.querySelector('[data-character-action="issue"]'), null);
  denied = true;
  await panel.refresh();
  assert.equal(root.querySelector('form'), null);
  assert.match(root.textContent, /Access denied/);
});
test('DM sees escaped character names and intentional code controls', async t => {
  const dom = new JSDOM('<div id="panel"></div>');
  const root = dom.window.document.getElementById('panel');
  const client = { rpc: async () => ({ data: { campaign_id: 'campaign', characters: [{ id: 'char', name: '<script>bad</script>', player_name: 'Pat', approved: true, statuses: [], assignments: [] }], players: [] } }) };
  const panel = mountCharacters(root, client, { session: 'session', host: true });
  t.after(() => { panel.dispose(); dom.window.close(); });
  await settle();
  assert.equal(root.querySelector('script'), null);
  assert.ok(root.querySelector('[data-character-action="issue"]'));
  assert.equal(root.querySelector('[data-character-secret]'), null);
});
test('slow portrait download survives an unchanged access refresh', async t => {
  const dom = new JSDOM('<div id="panel"></div>');
  const root = dom.window.document.getElementById('panel');
  let finishDownload;
  const download = new Promise(resolve => { finishDownload = resolve; });
  const client = {
    rpc: async () => ({ data: { campaign_id: 'campaign', characters: [{ id: 'char', name: 'Aria', approved: true, statuses: [], assignments: [], image_path: 'campaign/char/portrait.png' }], players: [], own_character_id: 'char' } }),
    storage: { from: () => ({ download: () => download }) },
  };
  const panel = mountCharacters(root, client, { session: 'session', host: false });
  t.after(() => { panel.dispose(); dom.window.close(); });
  await settle();
  await panel.refresh();
  finishDownload({ data: new Blob(['portrait']), error: null });
  await settle();
  assert.match(root.querySelector('[data-portrait]').src, /^blob:/);
});
test('character mutation locks editable fields until the saved state is loaded', async t => {
  const dom = new JSDOM('<div id="panel"></div>');
  const root = dom.window.document.getElementById('panel');
  let finishSave;
  const client = { rpc: async name => name === 'create_session_character' ? new Promise(resolve => { finishSave = resolve; }) : { data: { campaign_id: 'campaign', characters: [], players: [], own_character_id: null } } };
  const panel = mountCharacters(root, client, { session: 'session', host: false, displayName: 'Amber' });
  t.after(() => { panel.dispose(); dom.window.close(); });
  await settle();
  root.querySelector('[name="name"]').value = 'Aria';
  root.querySelector('[data-character-form="create"]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(root.querySelector('[name="name"]').disabled, true);
  assert.equal(root.querySelector('textarea').disabled, true);
  finishSave({ data: 'character' }); await settle();
  assert.equal(root.querySelector('[name="name"]').disabled, false);
});
test('clipboard-unavailable fallback focuses and selects the intentionally issued code', async t => {
  const dom = new JSDOM('<div id="panel"></div>');
  const root = dom.window.document.getElementById('panel');
  const client = { rpc: async name => ({ data: name === 'issue_character_code' ? 'a'.repeat(64) : { campaign_id: 'campaign', characters: [{ id: 'char', name: 'Aria', approved: true, statuses: [], assignments: [] }], players: [] } }) };
  const panel = mountCharacters(root, client, { session: 'session', host: true });
  t.after(() => { panel.dispose(); dom.window.close(); });
  await settle();
  root.querySelector('[data-character-action="issue"]').click(); await settle();
  root.querySelector('[data-character-action="copy"]').click(); await settle();
  const code = root.querySelector('[data-character-secret]');
  assert.equal(dom.window.document.activeElement, code);
  assert.equal(code.selectionEnd, code.value.length);
});
