import { test, expect } from './fixtures.js';
import {
  closeSubscription,
  createMultiplayerSession,
  currentIdentity,
  expectGuestBoardIsolated,
  expectIsolatedIdentities,
  subscribeToChanges,
  waitForChange,
} from './realtime-harness.js';

const pendingRealtime = 'Issue #8 Realtime publication and client sync are not integrated on this branch.';

async function submitAndApproveCharacter(room) {
  const { dm, playerA } = room;
  await playerA.page.getByLabel('Character name', { exact: true }).fill('Realtime Aria');
  await playerA.page.getByLabel('Maximum HP', { exact: true }).fill('22');
  await playerA.page.getByRole('button', { name: 'Submit character', exact: true }).click();
  await expect(playerA.page.locator('[data-character-notice]')).toContainText('Character submitted');

  const card = dm.page.locator('.character-card').filter({
    has: dm.page.getByRole('heading', { name: 'Realtime Aria', exact: true }),
  });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve & issue code', exact: true }).click();
  await expect(card).toContainText('Character approved');

  const code = await dm.page.getByLabel('Issued character reclaim code', { exact: true }).inputValue();
  return code.split('.')[1];
}

async function updateOwnCharacter(player, hp) {
  const card = player.page.locator('.character-card').filter({
    has: player.page.getByRole('heading', { name: 'Realtime Aria', exact: true }),
  });
  await card.getByText('Edit character', { exact: true }).click();
  await card.getByLabel('Current HP', { exact: true }).fill(String(hp));
  await card.getByRole('button', { name: 'Save character', exact: true }).click();
  await expect(player.page.locator('[data-character-notice]')).toContainText('Character saved');
}

function characterUpdateFilter(campaign) {
  return {
    event: 'UPDATE',
    schema: 'public',
    table: 'characters',
    filter: `campaign_id=eq.${campaign}`,
  };
}

test('realtime harness creates three isolated approved identities in one session', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  const [dm, playerA, playerB] = await expectIsolatedIdentities(room.dm, room.playerA, room.playerB);

  expect(dm.anonymous).toBe(false);
  expect(playerA.anonymous).toBe(true);
  expect(playerB.anonymous).toBe(true);
  await expect(room.playerA.page.locator('#roster')).toContainText('Player B');
  await expect(room.playerB.page.locator('#roster')).toContainText('Player A');
  await expectGuestBoardIsolated(room.playerA);
  await expectGuestBoardIsolated(room.playerB);
});

test('public character updates propagate to the DM and peer after player reload', async ({ actors }) => {
  test.fail(process.env.AURE_REALTIME_READY !== '1', pendingRealtime);
  const room = await createMultiplayerSession(actors);
  const character = await submitAndApproveCharacter(room);
  const filter = characterUpdateFilter(room.hosted.campaign);
  const dmSubscription = await subscribeToChanges(room.dm, filter);
  const firstPeerSubscription = await subscribeToChanges(room.playerB, filter);

  try {
    await updateOwnCharacter(room.playerA, 18);
    const [dmEvent, peerEvent] = await Promise.all([
      waitForChange(room.dm, dmSubscription, { id: character, hp: 18 }),
      waitForChange(room.playerB, firstPeerSubscription, { id: character, hp: 18 }),
    ]);
    for (const event of [dmEvent, peerEvent]) {
      expect(event.new).toMatchObject({ id: character, campaign_id: room.hosted.campaign, hp: 18 });
      expect(Object.keys(event.new)).not.toEqual(expect.arrayContaining([
        'code_hash', 'dm_notes', 'private_notes', 'secret',
      ]));
    }

    await closeSubscription(room.playerB, firstPeerSubscription);
    await room.playerB.page.reload();
    await expect(room.playerB.page.locator('#lobbyState')).toContainText('Welcome to the party');
    const reloadedPeerSubscription = await subscribeToChanges(room.playerB, filter);
    try {
      await updateOwnCharacter(room.playerA, 19);
      await Promise.all([
        waitForChange(room.dm, dmSubscription, { id: character, hp: 19 }),
        waitForChange(room.playerB, reloadedPeerSubscription, { id: character, hp: 19 }),
      ]);
    } finally {
      await closeSubscription(room.playerB, reloadedPeerSubscription);
    }
  } finally {
    await closeSubscription(room.dm, dmSubscription);
  }
});

test('a revoked player cannot establish a new realtime subscription or retain session access', async ({ actors }) => {
  test.fail(process.env.AURE_REALTIME_READY !== '1', pendingRealtime);
  const room = await createMultiplayerSession(actors);
  const playerBIdentity = await currentIdentity(room.playerB);
  const row = room.dm.page.locator('#roster .entry-row').filter({
    has: room.dm.page.getByRole('heading', { name: 'Player B', exact: true }),
  });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await room.playerB.page.reload();
  await expect(room.playerB.page.locator('#lobbyState')).toContainText('declined or access was removed');
  await expectGuestBoardIsolated(room.playerB);

  actors.expectHttp(room.playerB, '/rest/v1/rpc/get_character_panel', 403);
  const panel = await room.playerB.page.evaluate(async session => {
    const { getSupabaseClient } = await import('/src/supabase/client.js');
    const { data, error } = await getSupabaseClient().rpc('get_character_panel', { p_session: session });
    return { data, error: error ? { code: error.code, message: error.message } : null };
  }, room.hosted.session);
  expect(panel.error).not.toBeNull();
  expect(playerBIdentity.id).toBeTruthy();

  await expect(subscribeToChanges(room.playerB, characterUpdateFilter(room.hosted.campaign))).rejects.toThrow(/Realtime subscription/);
});