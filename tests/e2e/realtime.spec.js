import { test, expect } from './fixtures.js';
import {
  closeInvalidationObserver,
  createMultiplayerSession,
  expectGuestBoardIsolated,
  expectIsolatedIdentities,
  forceLifecycleHydrate,
  lifecycleState,
  observeSessionInvalidations,
  startProductionSession,
  stopProductionSession,
  waitForCharacterSnapshot,
  waitForInvalidation,
  waitForLifecycleStatus,
} from './realtime-harness.js';

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

async function openDmRealtimeBoard(room) {
  await room.dm.page.goto(`/#board/${room.hosted.session}`);
  await expect(room.dm.page.locator('#realtimeSessionPanel')).toBeVisible();
  await expect(room.dm.page.locator('#realtimeSessionPanel')).toContainText('Realtime Aria');
}

function expectSanitizedInvalidation(event, session) {
  expect(Object.keys(event).sort()).toEqual(['id', 'revision', 'schema_version', 'session_id', 'type']);
  expect(event).toMatchObject({ schema_version: 1, session_id: session, type: 'session.invalidated' });
  expect(event.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(event.revision).toMatch(/^\d+$/);
  expect(JSON.stringify(event)).not.toMatch(/Realtime Aria|hp|character|token|note|secret/i);
}

function expectPlayerProjection(snapshot, character, hp) {
  expect(snapshot.dm).toBeNull();
  const card = snapshot.characters.find(item => item.id === character);
  expect(card).toMatchObject({ id: character, hp });
  expect(Object.keys(card).sort()).toEqual([
    'ac', 'approved', 'hp', 'id', 'imagePath', 'maxHp', 'name', 'playerName', 'publicNotes', 'speed', 'statuses', 'tempHp', 'updatedAt',
  ]);
  expect(JSON.stringify(snapshot)).not.toMatch(/code_hash|dm_notes|private_notes|actual_hp|secret/i);
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
  const room = await createMultiplayerSession(actors);
  const character = await submitAndApproveCharacter(room);
  await openDmRealtimeBoard(room);
  const playerARuntime = await startProductionSession(room.playerA, room.hosted.session);
  let playerBRuntime = await startProductionSession(room.playerB, room.hosted.session);
  await Promise.all([
    waitForLifecycleStatus(room.playerA, playerARuntime, 'synced'),
    waitForLifecycleStatus(room.playerB, playerBRuntime, 'synced'),
  ]);
  let dmObserver = await observeSessionInvalidations(room.dm, room.hosted.session);
  let peerObserver = await observeSessionInvalidations(room.playerB, room.hosted.session);

  try {
    await updateOwnCharacter(room.playerA, 18);
    const [dmEvent, peerEvent] = await Promise.all([
      waitForInvalidation(room.dm, dmObserver),
      waitForInvalidation(room.playerB, peerObserver),
    ]);
    for (const event of [dmEvent, peerEvent]) expectSanitizedInvalidation(event, room.hosted.session);

    const [playerASnapshot, playerBSnapshot] = await Promise.all([
      waitForCharacterSnapshot(room.playerA, playerARuntime, character, 18),
      waitForCharacterSnapshot(room.playerB, playerBRuntime, character, 18),
    ]);
    expectPlayerProjection(playerASnapshot, character, 18);
    expectPlayerProjection(playerBSnapshot, character, 18);
    await expect(room.dm.page.locator('#realtimeSessionPanel')).toContainText('HP 18/22');

    await Promise.all([
      closeInvalidationObserver(room.dm, dmObserver),
      closeInvalidationObserver(room.playerB, peerObserver),
    ]);
    await stopProductionSession(room.playerB, playerBRuntime);
    await room.playerB.page.reload();
    await expect(room.playerB.page.locator('#lobbyState')).toContainText('Welcome to the party');
    playerBRuntime = await startProductionSession(room.playerB, room.hosted.session);
    await waitForLifecycleStatus(room.playerB, playerBRuntime, 'synced');
    expectPlayerProjection(await waitForCharacterSnapshot(room.playerB, playerBRuntime, character, 18), character, 18);
    dmObserver = await observeSessionInvalidations(room.dm, room.hosted.session);
    peerObserver = await observeSessionInvalidations(room.playerB, room.hosted.session);
    try {
      await updateOwnCharacter(room.playerA, 19);
      const [dmEvent, peerEvent, playerASnapshot, playerBSnapshot] = await Promise.all([
        waitForInvalidation(room.dm, dmObserver),
        waitForInvalidation(room.playerB, peerObserver),
        waitForCharacterSnapshot(room.playerA, playerARuntime, character, 19),
        waitForCharacterSnapshot(room.playerB, playerBRuntime, character, 19),
      ]);
      expectSanitizedInvalidation(dmEvent, room.hosted.session);
      expectSanitizedInvalidation(peerEvent, room.hosted.session);
      expectPlayerProjection(playerASnapshot, character, 19);
      expectPlayerProjection(playerBSnapshot, character, 19);
      await expect(room.dm.page.locator('#realtimeSessionPanel')).toContainText('HP 19/22');
    } finally {
      await Promise.all([
        closeInvalidationObserver(room.dm, dmObserver),
        closeInvalidationObserver(room.playerB, peerObserver),
      ]);
    }
  } finally {
    await Promise.all([
      stopProductionSession(room.playerA, playerARuntime),
      stopProductionSession(room.playerB, playerBRuntime),
    ]);
  }
});

test('a revoked player loses hydrated state and cannot restore access without renewed approval', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  const runtime = await startProductionSession(room.playerB, room.hosted.session);
  await waitForLifecycleStatus(room.playerB, runtime, 'synced');
  const row = room.dm.page.locator('#roster .entry-row').filter({
    has: room.dm.page.getByRole('heading', { name: 'Player B', exact: true }),
  });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  // Revoked players move into the collapsed Removed requests section. Waiting there
  // proves the review RPC committed and the DM roster refreshed before hydration.
  await expect(room.dm.page.locator('#roster details')).toContainText('Player B');
  await expect(room.dm.page.locator('#roster details')).toContainText('revoked');
  actors.expectHttp(room.playerB, '/rest/v1/rpc/get_session_snapshot', 403);
  await forceLifecycleHydrate(room.playerB, runtime);
  await waitForLifecycleStatus(room.playerB, runtime, 'denied');
  const denied = await lifecycleState(room.playerB, runtime);
  expect(denied).toMatchObject({ status: 'denied', appliedRevision: null, observedRevision: null, currentSnapshot: null, channelCount: 0 });

  await room.playerB.page.reload();
  await expect(room.playerB.page.locator('#lobbyState')).toContainText('declined or access was removed');
  await expectGuestBoardIsolated(room.playerB);

  actors.expectHttp(room.playerB, '/rest/v1/rpc/get_session_snapshot', 403);
  const snapshot = await actors.rpc(room.playerB, 'get_session_snapshot', { p_session: room.hosted.session });
  expect(snapshot).toEqual({ data: null, error: expect.objectContaining({ code: '42501' }) });

  await room.playerB.page.goto('/#join');
  await room.playerB.page.getByLabel('Join code or link').fill(room.hosted.code);
  await room.playerB.page.getByLabel('Your player name').fill('Player B');
  actors.expectHttp(room.playerB, '/rest/v1/rpc/request_session_join', 403);
  await room.playerB.page.getByRole('button', { name: 'Request a seat', exact: true }).click();
  await expect(room.playerB.page.locator('#entryNotice')).toContainText('Join unavailable');
  await expectGuestBoardIsolated(room.playerB);
});
