import { test, expect } from './fixtures.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function approve(actors, dm, guest, invitation, name) {
  await actors.request(guest, invitation, name);
  const row = dm.page.locator('#roster .entry-row').filter({ has: dm.page.getByRole('heading', { name, exact: true }) });
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(guest.page.locator('#lobbyState')).toContainText('Welcome to the party');
  await expect(guest.page.getByRole('button', { name: 'Submit character', exact: true })).toBeVisible();
}
async function reclaim(guest, code) {
  await guest.page.getByText('Reclaim a saved character', { exact: true }).click();
  await guest.page.getByLabel('Character reclaim code', { exact: true }).fill(code);
  await guest.page.getByRole('button', { name: 'Reclaim character', exact: true }).click();
}
async function refreshCharacters(actor) { await actor.page.getByRole('button', { name: 'Refresh characters', exact: true }).click(); }
test('campaign character creation, portrait, reclaim, rotation, isolation and DM recovery', async ({ actors }) => {
  const dm = await actors.actor('character-dm');
  const guest = await actors.actor('character-guest');
  const returning = await actors.actor('character-returning');
  const probe = await actors.actor('character-probe');
  const other = await actors.actor('character-other-dm');
  const hosted = await actors.host(dm);
  await approve(actors, dm, guest, hosted, 'Amber');
  await guest.page.getByLabel('Character name', { exact: true }).fill('Aria Ember');
  await guest.page.locator('#characters').getByLabel('Current HP', { exact: true }).fill('17');
  await guest.page.getByLabel('Maximum HP', { exact: true }).fill('22');
  await guest.page.getByLabel('Statuses (comma-separated)').fill('Blessed, Inspired');
  await guest.page.getByLabel('Shared character notes').fill('A shared history');
  await guest.page.getByLabel('Character portrait', { exact: true }).setInputFiles({ name: 'aria.png', mimeType: 'image/png', buffer: png });
  await expect(guest.page.getByAltText('Selected portrait preview')).toBeVisible();
  await guest.page.getByRole('button', { name: 'Submit character', exact: true }).click();
  await expect(guest.page.locator('[data-character-notice]')).toContainText('Character submitted');
  await expect(guest.page.getByAltText('Portrait of Aria Ember')).toBeVisible();
  expect(await guest.page.getByAltText('Portrait of Aria Ember').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await guest.page.reload();
  await expect(guest.page.locator('.character-card')).toContainText('Aria Ember');
  await guest.page.getByText('Edit character', { exact: true }).click();
  await expect(guest.page.locator('#characters').getByLabel('Current HP', { exact: true })).toHaveValue('17');
  await expect(guest.page.getByLabel('Shared character notes')).toHaveValue('A shared history');
  await expect(guest.page.getByRole('button', { name: 'Generate / replace character code' })).toHaveCount(0);
  const card = dm.page.locator('.character-card').filter({ has: dm.page.getByRole('heading', { name: 'Aria Ember', exact: true }) });
  await card.getByRole('button', { name: 'Approve & issue code', exact: true }).click();
  const codeInput = dm.page.getByLabel('Issued character reclaim code', { exact: true });
  await expect(codeInput).toBeVisible();
  const firstCode = await codeInput.inputValue();
  const character = firstCode.split('.')[1];
  await dm.page.getByRole('button', { name: 'Copy character code', exact: true }).click();
  await expect(dm.page.locator('[data-character-notice]')).toContainText('copied');
  expect(await dm.page.evaluate(() => navigator.clipboard.readText())).toBe(firstCode);
  expect(await dm.page.evaluate(secret => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(secret)), firstCode.split('.')[2])).toBe(false);
  await approve(actors, dm, returning, hosted, 'Returning Amber');
  await reclaim(returning, firstCode);
  await expect(returning.page.locator('[data-character-notice]')).toContainText('Character reclaimed');
  await expect(returning.page.getByAltText('Portrait of Aria Ember')).toBeVisible();
  await refreshCharacters(guest);
  await expect(guest.page.locator('.character-card')).toHaveCount(0);
  await expect(guest.page.locator('#legacyBoard')).toBeHidden();
  await expect(returning.page.locator('#grid .cell')).toHaveCount(0);
  actors.expectHttp(guest, '/rest/v1/rpc/update_session_character', 403);
  const denied = await actors.rpc(guest, 'update_session_character', { p_session: hosted.session, p_character: character, p_name: 'Stolen', p_player_name: 'Amber', p_hp: 1, p_max_hp: 2, p_temp_hp: 0, p_ac: 10, p_speed: 30, p_statuses: [], p_notes: '' });
  expect(denied.error).not.toBeNull();
  await card.getByRole('button', { name: 'Generate / replace character code', exact: true }).click();
  await expect(codeInput).not.toHaveValue(firstCode);
  const secondCode = await codeInput.inputValue();
  await approve(actors, dm, probe, hosted, 'Code checker');
  actors.expectHttp(probe, '/rest/v1/rpc/reclaim_character', 403);
  await reclaim(probe, firstCode);
  await expect(probe.page.locator('[data-character-notice]')).toHaveClass(/entry-error/);
  await card.getByRole('button', { name: 'Revoke character code', exact: true }).click();
  await expect(dm.page.locator('[data-character-notice]')).toHaveText('Character code revoked.');
  await probe.page.getByLabel('Character reclaim code', { exact: true }).fill(secondCode);
  actors.expectHttp(probe, '/rest/v1/rpc/reclaim_character', 403);
  await probe.page.getByRole('button', { name: 'Reclaim character', exact: true }).click();
  await expect(probe.page.locator('[data-character-notice]')).toHaveClass(/entry-error/);
  const foreign = await actors.host(other);
  const portraitPath = `${hosted.campaign}/${character}/portrait.png`;
  actors.expectHttp(other, `/storage/v1/object/character-images/${portraitPath}`, 400);
  const foreignPortrait = await other.page.evaluate(async path => {
    const { getSupabaseClient } = await import('/src/supabase/client.js');
    const { data, error } = await getSupabaseClient().storage.from('character-images').download(path);
    return { readable: !!data, denied: !!error };
  }, portraitPath);
  expect(foreignPortrait).toEqual({ readable: false, denied: true });
  actors.expectHttp(other, '/rest/v1/rpc/get_character_panel', 403);
  expect((await actors.rpc(other, 'get_character_panel', { p_session: hosted.session })).error).not.toBeNull();
  actors.expectHttp(other, '/rest/v1/rpc/review_character', 403);
  expect((await actors.rpc(other, 'review_character', { p_character: character, p_approved: true })).error).not.toBeNull();
  // The displaced controller retains party-visible read access, but cannot overwrite.
  actors.expectHttp(guest, `/storage/v1/object/character-images/${portraitPath}`, 400);
  const overwrite = await guest.page.evaluate(async ({ path, bytes }) => {
    const { getSupabaseClient } = await import('/src/supabase/client.js');
    const { error } = await getSupabaseClient().storage.from('character-images').update(path, new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    return !!error;
  }, { path: portraitPath, bytes: [...png] });
  expect(overwrite).toBe(true);
  await probe.page.getByLabel('Character reclaim code', { exact: true }).fill(`${foreign.campaign}.${character}.${secondCode.split('.')[2]}`);
  await probe.page.getByRole('button', { name: 'Reclaim character', exact: true }).click();
  await expect(probe.page.locator('[data-character-notice]')).toContainText('for this campaign');
  await card.getByText('Recover / reassign character', { exact: true }).click();
  await card.getByLabel('Assign to player').selectOption({ label: 'Amber' });
  await card.getByRole('button', { name: 'Reassign character', exact: true }).click();
  await expect(dm.page.locator('[data-character-notice]')).toContainText('Character reassigned');
  await refreshCharacters(guest);
  await expect(guest.page.locator('.character-card')).toContainText('Aria Ember');
  await refreshCharacters(returning);
  await expect(returning.page.locator('.character-card')).toHaveCount(0);
  await card.locator('summary').filter({ hasText: /^Replace portrait$/ }).click();
  await card.getByLabel('Character portrait', { exact: true }).setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png });
  await card.getByRole('button', { name: 'Replace portrait', exact: true }).click();
  await expect(dm.page.locator('[data-character-notice]')).toHaveText('Portrait saved.');
  for (const actor of [dm, guest]) {
    expect(await actor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await actors.screenshot(actor, `${actor.label}-complete`);
  }
});
