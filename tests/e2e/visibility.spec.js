import { test, expect } from './fixtures.js';
import {
  channelCount,
  createMultiplayerSession,
  expectNoDmProjection,
  openPlayerScreen,
  togglePresentationMode,
} from './realtime-harness.js';

async function submitAndApproveCharacter(room, characterName = 'Visibility Aria') {
  const { dm, playerA } = room;
  await playerA.page.getByLabel('Character name', { exact: true }).fill(characterName);
  await playerA.page.getByLabel('Maximum HP', { exact: true }).fill('22');
  await playerA.page.getByRole('button', { name: 'Submit character', exact: true }).click();
  await expect(playerA.page.locator('[data-character-notice]')).toContainText('Character submitted');

  const card = dm.page.locator('.character-card').filter({
    has: dm.page.getByRole('heading', { name: characterName, exact: true }),
  });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve & issue code', exact: true }).click();
  await expect(card).toContainText('Character approved');
  return { characterName };
}

async function openDmBoard(room) {
  await room.dm.page.goto(`/#board/${room.hosted.session}`);
  await expect(room.dm.page.locator('#realtimeSessionPanel')).toBeVisible();
}

async function openApprovedPlayers(room) {
  await openPlayerScreen(room.playerA, room.hosted.session);
  await openPlayerScreen(room.playerB, room.hosted.session);
}

async function advanceRound(dm) {
  await dm.page.locator('#realtimeSessionPanel [data-realtime-action="advance-round"]').click();
}

async function updateOwnHp(player, delta = 1) {
  await player.page.locator(`#playerBoardPanel [data-realtime-action="adjust-own-hp"][data-delta="${delta}"]`).click();
}

function startMutationObservation(player, text) {
  return player.page.evaluate(characterName => {
    const panel = document.querySelector('#playerBoardPanel');
    window.__visibilityQaObservation = { violations: [], characterName };
    window.__visibilityQaObserver = new MutationObserver(() => {
      if (panel?.textContent.includes(characterName)) window.__visibilityQaObservation.violations.push(panel.textContent);
    });
    window.__visibilityQaObserver.observe(panel, { childList: true, subtree: true, characterData: true });
  }, text);
}

async function finishMutationObservation(player) {
  return player.page.evaluate(() => {
    window.__visibilityQaObserver?.disconnect();
    return window.__visibilityQaObservation;
  });
}

test('DM God Screen shows management state', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room);
  await openDmBoard(room);
  await expect(room.dm.page.locator('#realtimeSessionPanel [data-realtime-action]').first()).toBeVisible();
  await expect(room.dm.page.locator('#realtimeSessionPanel [data-realtime-action="advance-round"]')).toBeVisible();
  await expect(room.dm.page.locator('#realtimeSessionPanel [data-realtime-action="clear-initiative"]')).toBeVisible();
  await expect(room.dm.page.locator('#realtimeSessionPanel .realtime-dm-section')).toBeVisible();
});

test('DM Player View hides DM-only DOM', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room);
  await openDmBoard(room);
  await togglePresentationMode(room.dm);
  await expect(room.dm.page.locator('#realtimeSessionPanel')).toBeHidden();
  await expect(room.dm.page.locator('#dmPreviewPanel')).toBeVisible();
  await expectNoDmProjection(room.dm, '#dmPreviewPanel');
});

test('presentation toggle creates no snapshot, mutation, or channel activity', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room);
  await openDmBoard(room);
  const beforeChannels = await channelCount(room.dm);
  const requests = [];
  const listener = request => {
    const url = request.url();
    if (/\/rest\/v1\/rpc\/(get_session_snapshot|mutate_session)(?:\?|$)/.test(url) || url.startsWith('ws://') || url.startsWith('wss://')) requests.push(url);
  };
  room.dm.page.on('request', listener);
  await togglePresentationMode(room.dm);
  await room.dm.page.waitForTimeout(250);
  room.dm.page.off('request', listener);
  expect(requests).toEqual([]);
  expect(await channelCount(room.dm)).toBe(beforeChannels);
});

test('toggling back restores DM View and clears preview DOM', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room);
  await openDmBoard(room);
  await togglePresentationMode(room.dm);
  await togglePresentationMode(room.dm);
  await expect(room.dm.page.locator('#realtimeSessionPanel')).toBeVisible();
  await expect(room.dm.page.locator('#realtimeSessionPanel .realtime-dm-section')).toBeVisible();
  await expect(room.dm.page.locator('#dmPreviewPanel')).toBeHidden();
  await expect(room.dm.page.locator('#dmPreviewPanel')).toBeEmpty();
});

test('Player A reaches the real Player Screen with authorized content', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room, 'Player A Hero');
  await openPlayerScreen(room.playerA, room.hosted.session);
  await expect(room.playerA.page.locator('#playerBoardPanel')).toContainText('Round');
  await expect(room.playerA.page.locator('#playerBoardPanel')).toContainText('Player A Hero');
});

test('Player A DOM contains no DM projection or management controls', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room);
  await openPlayerScreen(room.playerA, room.hosted.session);
  await expectNoDmProjection(room.playerA);
});

test('DM public round changes propagate live to Player A', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room);
  await openDmBoard(room);
  await openPlayerScreen(room.playerA, room.hosted.session);
  await expect(room.playerA.page.locator('#playerBoardPanel')).toContainText('Round 1');
  await advanceRound(room.dm);
  await expect(room.playerA.page.locator('#playerBoardPanel')).toContainText('Round 2');
});

test('Player A own-character HP mutation propagates to DM and Player B', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room);
  await openDmBoard(room);
  await openApprovedPlayers(room);
  await expect(room.playerA.page.locator('#playerBoardPanel')).toContainText('HP 0/22');
  await updateOwnHp(room.playerA, 1);
  await expect(room.dm.page.locator('#realtimeSessionPanel')).toContainText('HP 1/22');
  await expect(room.playerB.page.locator('#playerBoardPanel')).toContainText('HP 1/22');
});

test('Player B reload restores current synchronized state', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room);
  await openDmBoard(room);
  await openApprovedPlayers(room);
  await updateOwnHp(room.playerA, 1);
  await expect(room.playerB.page.locator('#playerBoardPanel')).toContainText('HP 1/22');
  await room.playerB.page.reload();
  await expect(room.playerB.page.locator('#playerBoardPanel')).toBeVisible();
  await expect(room.playerB.page.locator('#playerBoardPanel')).toContainText('HP 1/22');
  await expectNoDmProjection(room.playerB);
});

test('revocation clears Player B without stale-data flash', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  const { characterName } = await submitAndApproveCharacter(room, 'Revoked Hero');
  // The DM stays on the /#session/<id> page (where #roster lives) for the revoke action —
  // /#board/<id> replaces the entry shell with the legacy local board and has no #roster.
  await openPlayerScreen(room.playerB, room.hosted.session);
  await expect(room.playerB.page.locator('#playerBoardPanel')).toContainText('Round');
  await startMutationObservation(room.playerB, characterName);

  const row = room.dm.page.locator('#roster .entry-row').filter({
    has: room.dm.page.getByRole('heading', { name: 'Player B', exact: true }),
  });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(room.dm.page.locator('#roster details')).toContainText('Player B');
  await expect(room.dm.page.locator('#roster details')).toContainText('revoked');
  // Revoking a lobby guest does not itself emit a session_events invalidation (it is not a
  // board mutation) — mirrors realtime.spec.js's own revoked-player test, which likewise needs
  // an explicit next hydrate attempt before the 42501 denial path can run. A focus event is the
  // same trigger sessionLifecycle.js already wires for a real returning player, so this
  // dispatches the production denial path rather than working around it.
  actors.expectHttp(room.playerB, '/rest/v1/rpc/get_session_snapshot', 403);
  await room.playerB.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(room.playerB.page.locator('#playerBoardPanel')).toBeHidden();
  const observation = await finishMutationObservation(room.playerB);
  expect(observation.violations).toEqual([]);
  await room.playerB.page.reload();
  await expect(room.playerB.page).toHaveURL(new RegExp(`#lobby/${room.hosted.session}$`));
  await expect(room.playerB.page.locator('#playerBoardPanel')).toHaveCount(0);
});

test('revoked Player B cannot restore Player Screen through direct navigation', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await submitAndApproveCharacter(room);
  // The DM stays on the /#session/<id> page (where #roster lives) for the revoke action —
  // /#board/<id> replaces the entry shell with the legacy local board and has no #roster.
  const row = room.dm.page.locator('#roster .entry-row').filter({
    has: room.dm.page.getByRole('heading', { name: 'Player B', exact: true }),
  });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(room.dm.page.locator('#roster details')).toContainText('revoked');
  await room.playerB.page.goto(`/#play/${room.hosted.session}`);
  await expect(room.playerB.page).toHaveURL(new RegExp(`#lobby/${room.hosted.session}$`));
  await expect(room.playerB.page.locator('#playerBoardPanel')).toHaveCount(0);
  await expectGuestBoardAbsent(room.playerB);
});

async function expectGuestBoardAbsent(actor) {
  await expect(actor.page.locator('#legacyBoard')).toBeHidden();
  await expect(actor.page.locator('#grid .cell')).toHaveCount(0);
}
