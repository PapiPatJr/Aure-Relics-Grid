import { test, expect } from './fixtures.js';
import {
  activateFogMode, channelCount, clickPaintCell, createMultiplayerSession,
  forceHydrateViaFocus, freezeSnapshot, openPlayerScreen, readPlayerFogPixel,
  togglePresentationMode,
} from './realtime-harness.js';
import {
  advanceThroughUi, createTokenThroughUi, deleteTokenThroughUi, denyManagerCommand,
  expectHiddenSecretAbsent, expectManagerControlsAbsent, expectNoServiceRoleCredential,
  expectOneCommand, expectSpatialToken, moveTokenThroughUi, normalizedRecipientState,
  observeMutationCommands, setInitiativeThroughUi, snapshotFor, submitAndApproveCharacter,
} from './tuesday-online-gameplay-helpers.js';

const hiddenPixel = [16, 13, 10, 255];
const isRevealed = pixel => pixel?.[3] === 0;
const isHidden = pixel => JSON.stringify(pixel) === JSON.stringify(hiddenPixel);

async function openDmBoard(room) {
  await room.dm.page.goto(`/#board/${room.hosted.session}`);
  await expect(room.dm.page.locator('#realtimeSessionPanel')).toBeVisible();
}

async function expectActive(actor, tokenId, root) {
  await expect(actor.page.locator(`${root} [data-spatial-token-id="${tokenId}"]`)).toHaveClass(/spatial-token--active/);
}

test('Tuesday online: three clients complete the authoritative gameplay loop', async ({ actors }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The final integrated scenario is desktop-only.');
  test.setTimeout(300_000);

  const room = await createMultiplayerSession(actors, { playerA: 'Tuesday Player A', playerB: 'Tuesday Player B' });
  let playerAToken;
  let playerBToken;
  let previewOpen = false;

  try {
    const characterA = await submitAndApproveCharacter(room.dm, room.playerA, { name: 'Tuesday Aria', hp: 24 });
    const characterB = await submitAndApproveCharacter(room.dm, room.playerB, { name: 'Tuesday Bram', hp: 28 });
    const initial = await snapshotFor(actors, room.dm, room.hosted.session);
    expect(initial.fog).toBeNull();

    await openDmBoard(room);
    await openPlayerScreen(room.playerA, room.hosted.session);
    await openPlayerScreen(room.playerB, room.hosted.session);
    for (const actor of [room.dm, room.playerA, room.playerB]) expect(await channelCount(actor)).toBe(1);
    expect((await snapshotFor(actors, room.dm, room.hosted.session)).authority.canManage).toBe(true);
    for (const player of [room.playerA, room.playerB]) {
      expect((await snapshotFor(actors, player, room.hosted.session)).authority.canManage).toBe(false);
    }

    const prepareCommands = await observeMutationCommands(room.dm, async () => {
      await room.dm.page.locator('[data-testid="prepare-board"]').click();
      await expect(room.dm.page.locator('#realtimeSessionPanel .spatial-board-stage')).toBeVisible({ timeout: 20_000 });
      await expect(room.playerA.page.locator('#playerBoardPanel .fog-player-stage')).toBeVisible({ timeout: 20_000 });
      await expect(room.playerB.page.locator('#playerBoardPanel .fog-player-stage')).toBeVisible({ timeout: 20_000 });
    });
    expectOneCommand(prepareCommands, 'session.prepareBoard');
    const prepared = await snapshotFor(actors, room.dm, room.hosted.session);
    expect(prepared.fog?.levelId).toBeTruthy();
    expect(prepared.session.status).toBe('active');
    await expect(room.dm.page.locator('[data-testid="prepare-board"]')).toHaveCount(0);

    const dmChannels = await channelCount(room.dm);
    await togglePresentationMode(room.dm);
    previewOpen = true;
    await expect(room.dm.page.locator('#dmPreviewPanel .fog-player-stage')).toBeVisible();
    expect(await channelCount(room.dm)).toBe(dmChannels);
    const dimensions = await room.dm.page.locator('#dmPreviewPanel .fog-player-canvas').evaluate(canvas => [canvas.width, canvas.height]);
    expect(dimensions).toEqual([prepared.fog.width, prepared.fog.height]);
    await togglePresentationMode(room.dm);
    previewOpen = false;

    playerAToken = await createTokenThroughUi(room.dm, { kind: 'player', characterId: characterA, label: 'Tuesday Aria Token', x: 1, y: 1, isVisible: true });
    playerBToken = await createTokenThroughUi(room.dm, { kind: 'player', characterId: characterB, label: 'Tuesday Bram Token', x: 2, y: 1, isVisible: true });
    let enemy = await createTokenThroughUi(room.dm, { kind: 'enemy', label: 'Tuesday Raider', x: 4, y: 4, isVisible: true });
    let npc = await createTokenThroughUi(room.dm, { kind: 'npc', label: 'Tuesday Guide', x: 6, y: 3, isVisible: true });
    const boss = await createTokenThroughUi(room.dm, { kind: 'boss', label: 'Tuesday Wyrm', x: 8, y: 6, isVisible: true });
    let hidden = await createTokenThroughUi(room.dm, { kind: 'enemy', label: 'Tuesday Secret', x: 19, y: 17, isVisible: false });

    const dmSnapshot = await snapshotFor(actors, room.dm, room.hosted.session);
    expect(dmSnapshot.tokens.find(token => token.id === playerAToken.id)?.characterId).toBe(characterA);
    expect(dmSnapshot.tokens.find(token => token.id === playerBToken.id)?.characterId).toBe(characterB);
    expect(dmSnapshot.tokens.find(token => token.id === hidden.id)?.isVisible).toBe(false);
    for (const token of [playerAToken, enemy, boss, hidden]) await expectSpatialToken(room.dm, token, '#realtimeSessionPanel');
    for (const player of [room.playerA, room.playerB]) {
      await expectHiddenSecretAbsent(actors, player, room.hosted.session, hidden, '#playerBoardPanel');
    }

    await activateFogMode(room.dm);
    for (const token of [playerAToken, playerBToken, enemy, npc, boss]) {
      await clickPaintCell(room.dm, prepared.fog, token.x, token.y);
      await expect.poll(() => readPlayerFogPixel(room.playerA, token.x, token.y).then(isRevealed)).toBe(true);
    }
    for (const token of [playerAToken, playerBToken, enemy, boss]) {
      await expectSpatialToken(room.playerA, token, '#playerBoardPanel');
      await expectSpatialToken(room.playerB, token, '#playerBoardPanel');
    }
    const fogBeforeMove = (await snapshotFor(actors, room.playerA, room.hosted.session)).fog;
    await togglePresentationMode(room.dm);
    previewOpen = true;
    for (const token of [playerAToken, enemy, boss]) await expectSpatialToken(room.dm, token, '#dmPreviewPanel');
    await expectHiddenSecretAbsent(actors, room.dm, room.hosted.session, hidden, '#dmPreviewPanel', room.playerA);
    await togglePresentationMode(room.dm);
    previewOpen = false;

    enemy = await moveTokenThroughUi(room.dm, enemy, 12, 12);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 12, 12).then(isHidden)).toBe(true);
    for (const player of [room.playerA, room.playerB]) {
      await expect(player.page.locator(`#playerBoardPanel [data-spatial-token-id="${enemy.id}"]`)).toHaveCount(0);
      const serialized = JSON.stringify(await snapshotFor(actors, player, room.hosted.session));
      expect(serialized).not.toContain(enemy.id);
      expect(serialized).not.toContain(enemy.label);
    }
    expect((await snapshotFor(actors, room.playerA, room.hosted.session)).fog).toEqual(fogBeforeMove);

    await activateFogMode(room.dm);
    await clickPaintCell(room.dm, prepared.fog, enemy.x, enemy.y);
    await expect.poll(() => readPlayerFogPixel(room.playerB, enemy.x, enemy.y).then(isRevealed)).toBe(true);
    await expectSpatialToken(room.playerA, enemy, '#playerBoardPanel');
    await expectSpatialToken(room.playerB, enemy, '#playerBoardPanel');
    await togglePresentationMode(room.dm);
    previewOpen = true;
    await expectSpatialToken(room.dm, enemy, '#dmPreviewPanel');
    await togglePresentationMode(room.dm);
    previewOpen = false;

    const fogBeforeHiddenMove = (await snapshotFor(actors, room.playerA, room.hosted.session)).fog;
    hidden = await moveTokenThroughUi(room.dm, hidden, 18, 16);
    expect((await snapshotFor(actors, room.dm, room.hosted.session)).tokens.find(token => token.id === hidden.id)?.isVisible).toBe(false);
    for (const player of [room.playerA, room.playerB]) await expectHiddenSecretAbsent(actors, player, room.hosted.session, hidden, '#playerBoardPanel');
    expect((await snapshotFor(actors, room.playerA, room.hosted.session)).fog).toEqual(fogBeforeHiddenMove);

    const initiative = [
      { tokenId: boss.id, initiative: 30 },
      { tokenId: playerAToken.id, initiative: 20 },
      { tokenId: hidden.id, initiative: 15 },
      { tokenId: enemy.id, initiative: 10 },
    ];
    await setInitiativeThroughUi(room.dm, initiative);
    let managerState = await snapshotFor(actors, room.dm, room.hosted.session);
    expect(managerState.initiative.map(entry => entry.tokenId)).toEqual(initiative.map(entry => entry.tokenId));
    expect(managerState.initiative.filter(entry => entry.isActive)).toHaveLength(0);
    for (const player of [room.playerA, room.playerB]) {
      const playerState = await snapshotFor(actors, player, room.hosted.session);
      expect(JSON.stringify(playerState)).not.toContain(hidden.id);
      expect(JSON.stringify(playerState)).not.toContain(hidden.label);
      expect(playerState.initiative.map(entry => entry.tokenId)).toEqual([boss.id, playerAToken.id, enemy.id]);
      const rows = player.page.locator('#playerBoardPanel .realtime-initiative-list .realtime-initiative-row');
      await expect(rows).toHaveCount(3);
      await expect(player.page.locator('#playerBoardPanel .realtime-initiative-list')).not.toContainText(hidden.id);
      await expect(player.page.locator('#playerBoardPanel .realtime-initiative-list')).not.toContainText(hidden.label);
    }

    await advanceThroughUi(room.dm, async () => {
      await expectActive(room.dm, boss.id, '#realtimeSessionPanel');
      await expectActive(room.playerA, boss.id, '#playerBoardPanel');
      await expectActive(room.playerB, boss.id, '#playerBoardPanel');
    });
    managerState = await snapshotFor(actors, room.dm, room.hosted.session);
    expect(managerState.initiative.filter(entry => entry.isActive).map(entry => entry.tokenId)).toEqual([boss.id]);
    await togglePresentationMode(room.dm);
    previewOpen = true;
    await expectActive(room.dm, boss.id, '#dmPreviewPanel');
    await expect(room.dm.page.locator('#dmPreviewPanel .realtime-initiative-list .realtime-initiative-row')).toHaveCount(3);
    await expect(room.dm.page.locator('#dmPreviewPanel .realtime-initiative-list')).not.toContainText(hidden.id);
    await expect(room.dm.page.locator('#dmPreviewPanel .realtime-initiative-list')).not.toContainText(hidden.label);
    await togglePresentationMode(room.dm);
    previewOpen = false;

    const roundBeforeWrap = managerState.roundNumber;
    for (const expectedId of [playerAToken.id, hidden.id, enemy.id, boss.id]) {
      await advanceThroughUi(room.dm, async () => {
        await expectActive(room.dm, expectedId, '#realtimeSessionPanel');
      });
      if (expectedId === hidden.id) {
        for (const player of [room.playerA, room.playerB]) {
          await expect(player.page.locator('#playerBoardPanel .spatial-token--active')).toHaveCount(0);
          await expect(player.page.locator('#playerBoardPanel .realtime-initiative-row.active-combatant')).toHaveCount(0);
          await expect(player.page.locator('#playerBoardPanel .realtime-initiative-list .realtime-initiative-row')).toHaveCount(3);
        }
      }
    }
    managerState = await snapshotFor(actors, room.dm, room.hosted.session);
    expect(managerState.roundNumber).toBe(roundBeforeWrap + 1);
    expect(managerState.initiative.find(entry => entry.isActive)?.tokenId).toBe(boss.id);

    await deleteTokenThroughUi(room.dm, enemy.id);
    for (const actor of [room.playerA, room.playerB]) {
      await expect(actor.page.locator(`[data-spatial-token-id="${enemy.id}"]`)).toHaveCount(0);
      expect(JSON.stringify(await snapshotFor(actors, actor, room.hosted.session))).not.toContain(enemy.id);
    }
    expect((await snapshotFor(actors, room.dm, room.hosted.session)).initiative.some(entry => entry.tokenId === enemy.id)).toBe(false);
    await togglePresentationMode(room.dm);
    previewOpen = true;
    await expect(room.dm.page.locator(`#dmPreviewPanel [data-spatial-token-id="${enemy.id}"]`)).toHaveCount(0);
    await expect(room.dm.page.locator(`#dmPreviewPanel [data-token-id="${enemy.id}"]`)).toHaveCount(0);
    await togglePresentationMode(room.dm);
    previewOpen = false;

    const beforeReconnect = await snapshotFor(actors, room.playerB, room.hosted.session);
    await room.playerB.page.reload();
    await expect(room.playerB.page.locator('#playerBoardPanel')).toBeVisible();
    await expect.poll(async () => (await snapshotFor(actors, room.playerB, room.hosted.session)).revision).toBe(beforeReconnect.revision);
    const afterReconnect = await snapshotFor(actors, room.playerB, room.hosted.session);
    expect(normalizedRecipientState(afterReconnect)).toEqual(normalizedRecipientState(beforeReconnect));
    expect(JSON.stringify(afterReconnect)).not.toContain(hidden.id);
    expect(JSON.stringify(afterReconnect)).not.toContain(enemy.id);
    await expect(room.playerB.page.locator('#playerBoardPanel h3')).toContainText(`Round ${afterReconnect.roundNumber}`);
    await expect(room.playerB.page.locator('#playerBoardPanel .spatial-token')).toHaveCount(afterReconnect.tokens.length);
    for (const token of afterReconnect.tokens) await expectSpatialToken(room.playerB, token, '#playerBoardPanel');
    await expect(room.playerB.page.locator('#playerBoardPanel .realtime-initiative-list .realtime-initiative-row')).toHaveCount(afterReconnect.initiative.length);
    const reconnectedActive = afterReconnect.initiative.find(entry => entry.isActive)?.tokenId;
    if (reconnectedActive) await expectActive(room.playerB, reconnectedActive, '#playerBoardPanel');
    const reconnectedCanvas = await room.playerB.page.locator('#playerBoardPanel .fog-player-canvas').evaluate(canvas => [canvas.width, canvas.height]);
    expect(reconnectedCanvas).toEqual([afterReconnect.fog.width, afterReconnect.fog.height]);
    expect(isRevealed(await readPlayerFogPixel(room.playerB, boss.x, boss.y))).toBe(true);
    expect(isHidden(await readPlayerFogPixel(room.playerB, 0, 0))).toBe(true);

    await room.dm.page.setViewportSize({ width: 1440, height: 650 });
    const crowded = [];
    for (let index = 0; index < 7; index += 1) {
      crowded.push(await createTokenThroughUi(room.dm, {
        kind: 'enemy', label: `Tuesday Crowd ${String(index + 1).padStart(2, '0')}`,
        x: 3 + index, y: 14, isVisible: true,
      }));
    }
    const rail = room.dm.page.locator('#realtimeSessionPanel .realtime-token-list');
    await expect.poll(() => rail.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const last = crowded.at(-1);
    await rail.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(rail.locator(`.realtime-token-row[data-token-id="${last.id}"]`)).toBeVisible();
    const scrollBefore = await rail.evaluate(element => element.scrollTop);
    npc = await moveTokenThroughUi(room.dm, npc, 7, 3);
    await expectSpatialToken(room.dm, npc, '#realtimeSessionPanel');
    expect(await rail.evaluate(element => element.scrollTop)).toBe(scrollBefore);

    const currentTokens = (await snapshotFor(actors, room.dm, room.hosted.session)).tokens;
    const crowdedInitiative = currentTokens.map((token, index) => ({
      tokenId: token.id,
      initiative: token.id === boss.id ? 100 : token.id === last.id ? 90 : 50 - index,
    }));
    await setInitiativeThroughUi(room.dm, crowdedInitiative);
    await rail.evaluate(element => { element.scrollTop = 0; });
    await advanceThroughUi(room.dm, async () => {
      await expect.poll(async () => (await snapshotFor(actors, room.dm, room.hosted.session)).initiative.find(entry => entry.isActive)?.tokenId).toBe(last.id);
    });
    await expect(rail.locator(`.realtime-token-row[data-token-id="${last.id}"]`)).toBeInViewport();

    for (const player of [room.playerA, room.playerB]) {
      await expectManagerControlsAbsent(player, '#playerBoardPanel');
      await expectNoServiceRoleCredential(player);
    }
    await togglePresentationMode(room.dm);
    previewOpen = true;
    await expectManagerControlsAbsent(room.dm, '#dmPreviewPanel');
    await expect(room.dm.page.locator('#dmPreviewPanel [data-realtime-action]')).toHaveCount(0);
    expect(await channelCount(room.dm)).toBe(1);
    await togglePresentationMode(room.dm);
    previewOpen = false;

    for (const player of [room.playerA, room.playerB]) {
      const playerState = await snapshotFor(actors, player, room.hosted.session);
      const revision = playerState.revision;
      const denied = [
        { type: 'session.prepareBoard', payload: {} },
        { type: 'token.create', payload: { kind: 'enemy', characterId: null, label: 'Denied', x: 0, y: 0, isVisible: true } },
        { type: 'token.move', payload: { tokenId: boss.id, x: 0, y: 0 } },
        { type: 'token.delete', payload: { tokenId: boss.id } },
        { type: 'initiative.advance', payload: {} },
      ];
      for (const command of denied) {
        await denyManagerCommand(actors, player, room.hosted.session, { schemaVersion: 1, expectedRevision: revision, ...command });
      }
      expect((await snapshotFor(actors, player, room.hosted.session)).revision).toBe(revision);
    }

    for (const actor of [room.dm, room.playerA, room.playerB]) expect(await channelCount(actor)).toBe(1);
    await deleteTokenThroughUi(room.dm, playerAToken.id);
    await deleteTokenThroughUi(room.dm, playerBToken.id);
    playerAToken = null;
    playerBToken = null;
  } finally {
    if (previewOpen) await togglePresentationMode(room.dm).catch(() => {});
    if (playerAToken?.id) await deleteTokenThroughUi(room.dm, playerAToken.id).catch(() => {});
    if (playerBToken?.id) await deleteTokenThroughUi(room.dm, playerBToken.id).catch(() => {});
  }
});

test('Tuesday online: stale manager conflicts, rehydrates, and never replays Next Turn', async ({ actors }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The final integrated scenario is desktop-only.');
  test.setTimeout(180_000);

  const room = await createMultiplayerSession(actors);
  await openDmBoard(room);
  await room.dm.page.locator('[data-testid="prepare-board"]').click();
  await expect(room.dm.page.locator('.spatial-board-stage')).toBeVisible({ timeout: 20_000 });
  const first = await createTokenThroughUi(room.dm, { kind: 'boss', label: 'Stale First', x: 2, y: 2, isVisible: true });
  const second = await createTokenThroughUi(room.dm, { kind: 'enemy', label: 'Stale Second', x: 4, y: 4, isVisible: true });
  await setInitiativeThroughUi(room.dm, [
    { tokenId: first.id, initiative: 20 },
    { tokenId: second.id, initiative: 10 },
  ]);

  const dmB = await actors.actor('tuesday-stale-dm');
  dmB.credentials = room.dm.credentials;
  await dmB.page.goto('/#login');
  await actors.login(dmB);
  await openDmBoard({ dm: dmB, hosted: room.hosted });
  await expect(dmB.page.locator('[data-testid="next-turn"]')).toBeVisible();
  await expect.poll(async () => (await snapshotFor(actors, dmB, room.hosted.session)).revision)
    .toBe((await snapshotFor(actors, room.dm, room.hosted.session)).revision);

  const unfreeze = await freezeSnapshot(dmB, room.hosted.session);
  await advanceThroughUi(room.dm, async () => {
    await expectActive(room.dm, first.id, '#realtimeSessionPanel');
  });
  const advancedOnce = await snapshotFor(actors, room.dm, room.hosted.session);

  actors.expectHttp(dmB, '/rest/v1/rpc/mutate_session', 409);
  let afterConflict;
  const rejected = await observeMutationCommands(dmB, async () => {
    await dmB.page.locator('[data-testid="next-turn"]').click();
    await expect(dmB.page.locator('#realtimeMutationNotice')).toContainText('session changed');
    await dmB.page.waitForTimeout(750);
    afterConflict = await snapshotFor(actors, room.dm, room.hosted.session);
  });
  expectOneCommand(rejected, 'initiative.advance');
  expect(afterConflict.revision).toBe(advancedOnce.revision);
  expect(afterConflict.initiative.find(entry => entry.isActive)?.tokenId).toBe(first.id);

  await unfreeze();
  await forceHydrateViaFocus(dmB);
  await expectActive(dmB, first.id, '#realtimeSessionPanel');
  expect((await snapshotFor(actors, room.dm, room.hosted.session)).revision).toBe(afterConflict.revision);
  const retry = await advanceThroughUi(dmB, async () => {
    await expectActive(dmB, second.id, '#realtimeSessionPanel');
  });
  expect(retry[0].expectedRevision).toBe(afterConflict.revision);
  await expect.poll(async () => (await snapshotFor(actors, room.dm, room.hosted.session)).initiative.find(entry => entry.isActive)?.tokenId).toBe(second.id);
});
