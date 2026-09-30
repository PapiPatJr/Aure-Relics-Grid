import { test, expect } from './fixtures.js';
import {
  createMultiplayerSession, createFogLevel, createExtraLevel, insertHiddenToken,
  openPlayerScreen, togglePresentationMode,
  activateFogMode, dragPaintCells, clickPaintCell,
  readPlayerFogPixel, playerFogStageInfo, countMutateSessionCalls,
  freezeSnapshot, forceHydrateViaFocus, countSessionEvents,
} from './realtime-harness.js';

// Issue #10 Task 7 — three-client fog QA, maximum-board checks, visual-leak checks and
// verification (docs/superpowers/plans/2026-09-25-issue-10-fog-of-war.md Task 7,
// docs/superpowers/specs/2026-09-25-fog-of-war-design.md). Tasks 1-6 already implemented and
// unit-tested the fog feature itself; this file's job is full-stack proof across three real
// browser/Auth contexts (DM, Player A, Player B) against the real local Supabase stack — no
// mocked adapter, no fake snapshot.
//
// v0.9 has no production UI/RPC path to create a `public.levels` row, move a session off
// 'lobby'/set its active level, or place a `public.tokens` row (Issue #13 owns level
// authoring; the token gap is the same one `visibility.spec.js` already documents). Every such
// gap is bridged with a direct service-role fixture insert in `realtime-harness.js` — never a
// production code change — so every mutation and every projection assertion below still goes
// through the real authenticated app/RPC surface. See that file's "Issue #10 Task 7" section for
// exactly what is and is not short-circuited.

const FOG_HIDDEN_PIXEL = [16, 13, 10, 255]; // src/fog/fogRenderer.js PLAYER_FOG_FILL '#100d0a'
const GOLD_FRONTIER_RGB = [201, 169, 92]; // DM_FRONTIER_COLOR '#c9a95c', DM-only

function isRevealed(pixel) {
  return pixel !== null && pixel[3] === 0;
}
function isHiddenFog(pixel) {
  return pixel !== null && pixel[0] === FOG_HIDDEN_PIXEL[0] && pixel[1] === FOG_HIDDEN_PIXEL[1]
    && pixel[2] === FOG_HIDDEN_PIXEL[2] && pixel[3] === FOG_HIDDEN_PIXEL[3];
}

async function openDmBoard(room) {
  await room.dm.page.goto(`/#board/${room.hosted.session}`);
  await expect(room.dm.page.locator('#realtimeSessionPanel')).toBeVisible();
}

async function openApprovedPlayers(room) {
  await openPlayerScreen(room.playerA, room.hosted.session);
  await openPlayerScreen(room.playerB, room.hosted.session);
}

function fogRoot(dm) {
  return dm.page.locator('[data-fog-controller]');
}

async function snapshotFor(actors, actor, sessionId) {
  const { data, error } = await actors.rpc(actor, 'get_session_snapshot', { p_session: sessionId });
  if (error) throw new Error(`get_session_snapshot failed: ${JSON.stringify(error)}`);
  return data;
}

async function rawMutate(actors, actor, sessionId, command) {
  return actors.rpc(actor, 'mutate_session', { p_session: sessionId, p_command: command });
}

/** Accept every `window.confirm` on `actor`'s page from here on, recording each message so a
 * test can assert exactly how many (and which) confirmations a sequence of actions produced. */
function recordDialogs(actor) {
  const messages = [];
  actor.page.on('dialog', dialog => { messages.push(dialog.message()); void dialog.accept(); });
  return messages;
}

function areaRow(dm, name) {
  return dm.page.locator('[data-fog-area-list] li').filter({ hasText: name });
}

/** Drive the real New Area -> paint/select -> name -> default -> Save workflow (design §5.2/plan
 * step 6.4) through the DM's actual Fog Mode UI, and return the saved area's id. */
async function createNamedArea(dm, fog, { name, cells, revealedByDefault }) {
  const root = await activateFogMode(dm);
  await root.locator('[data-fog-action="new-area"]').click();
  await dragPaintCells(dm, fog, cells);
  await root.locator('[data-fog-field="area-name"]').fill(name);
  await root.locator(`[data-fog-field="area-default"][value="${revealedByDefault ? 'revealed' : 'hidden'}"]`).check();
  await root.locator('[data-fog-action="area-save"]').click();
  const row = areaRow(dm, name);
  await expect(row).toBeVisible();
  return { areaId: await row.getAttribute('data-area-id'), root, row };
}

test.describe('Issue #10 fog of war', () => {
  test('1. a brand-new hidden mask appears on both player clients and players fail closed', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 12, height: 12 });
    await openDmBoard(room);
    await openApprovedPlayers(room);

    for (const player of [room.playerA, room.playerB]) {
      const info = await playerFogStageInfo(player);
      expect(info).not.toBeNull();
      expect([info.canvasWidth, info.canvasHeight]).toEqual([level.width, level.height]);
      expect(isHiddenFog(await readPlayerFogPixel(player, 0, 0))).toBe(true);
      expect(isHiddenFog(await readPlayerFogPixel(player, level.width - 1, level.height - 1))).toBe(true);
    }

    const playerSnapshot = await snapshotFor(actors, room.playerA, room.hosted.session);
    expect(playerSnapshot.fog).toMatchObject({ levelId: level.levelId, width: level.width, height: level.height, enabled: true, revealedRuns: [] });
  });

  test('2. a long DM fog drag stays DM-local during the drag and reaches players only after release, as one mutation', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 16, height: 16 });
    await openDmBoard(room);
    await openApprovedPlayers(room);
    const stroke = [[3, 3], [4, 3], [5, 3], [6, 3], [6, 4], [6, 5]];

    await activateFogMode(room.dm);
    let mutateCalls = 0;
    const listener = request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/rpc/mutate_session') mutateCalls += 1;
    };
    room.dm.page.on('request', listener);

    const first = stroke[0];
    const gridLocator = room.dm.page.locator('#grid');
    await gridLocator.scrollIntoViewIfNeeded(); // narrow viewport: keep the target inside real viewport pixels
    const point0 = await gridLocator.boundingBox();
    const cellW = point0.width / level.width, cellH = point0.height / level.height;
    await room.dm.page.mouse.move(point0.x + (first[0] + 0.5) * cellW, point0.y + (first[1] + 0.5) * cellH);
    await room.dm.page.mouse.down();
    for (const [x, y] of stroke.slice(1)) {
      await room.dm.page.mouse.move(point0.x + (x + 0.5) * cellW, point0.y + (y + 0.5) * cellH, { steps: 3 });
    }

    // Mid-drag: no mutation submitted yet, and both players still see the untouched hidden mask.
    expect(mutateCalls).toBe(0);
    for (const [x, y] of stroke) {
      expect(isHiddenFog(await readPlayerFogPixel(room.playerA, x, y))).toBe(true);
      expect(isHiddenFog(await readPlayerFogPixel(room.playerB, x, y))).toBe(true);
    }

    await room.dm.page.mouse.up();
    room.dm.page.off('request', listener);

    for (const [x, y] of stroke) {
      await expect.poll(() => readPlayerFogPixel(room.playerA, x, y).then(isRevealed)).toBe(true);
      await expect.poll(() => readPlayerFogPixel(room.playerB, x, y).then(isRevealed)).toBe(true);
    }
    expect(mutateCalls, 'one whole stroke is one logical mutation, not one per cell').toBe(1);
  });

  test('3. Reveal Area / Hide Area sync to both players without a confirmation', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 14, height: 14 });
    await openDmBoard(room);
    await openApprovedPlayers(room);
    const messages = recordDialogs(room.dm);

    const { row } = await createNamedArea(room.dm, level, { name: 'Vault', cells: [[2, 2], [3, 2]], revealedByDefault: false });
    expect(messages, 'creating an area needs no confirmation').toEqual([]);

    await row.locator('[data-fog-action="area-reveal"]').click();
    expect(messages, 'Reveal Area needs no confirmation').toEqual([]);
    for (const player of [room.playerA, room.playerB]) {
      await expect.poll(() => readPlayerFogPixel(player, 2, 2).then(isRevealed)).toBe(true);
      await expect.poll(() => readPlayerFogPixel(player, 3, 2).then(isRevealed)).toBe(true);
    }

    await row.locator('[data-fog-action="area-hide"]').click();
    expect(messages, 'Hide Area needs no confirmation').toEqual([]);
    for (const player of [room.playerA, room.playerB]) {
      await expect.poll(() => readPlayerFogPixel(player, 2, 2).then(isHiddenFog)).toBe(true);
      await expect.poll(() => readPlayerFogPixel(player, 3, 2).then(isHiddenFog)).toBe(true);
    }
  });

  test('4. manually changing some cells inside a named area yields a server-derived Mixed status', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 14, height: 14 });
    await openDmBoard(room);

    const { row } = await createNamedArea(room.dm, level, { name: 'Chamber', cells: [[10, 10], [11, 10]], revealedByDefault: false });
    await expect(row).toContainText('Hidden');

    await clickPaintCell(room.dm, level, 10, 10);
    await expect(row).toContainText('Mixed');

    await clickPaintCell(room.dm, level, 11, 10);
    await expect(row).toContainText('Revealed');
  });

  test('5. Reveal All / Hide All / Reset each require confirmation and produce exactly one sync', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 10, height: 10 });
    await openDmBoard(room);
    await openApprovedPlayers(room);
    const messages = recordDialogs(room.dm);
    const root = await activateFogMode(room.dm);

    const revealAllCalls = await countMutateSessionCalls(room.dm, async () => {
      await root.locator('[data-fog-action="reveal-all"]').click();
      await expect.poll(() => readPlayerFogPixel(room.playerA, 5, 5).then(isRevealed)).toBe(true);
    });
    expect(revealAllCalls).toBe(1);
    expect(messages.at(-1)).toMatch(/entire level to players/i);
    await expect.poll(() => readPlayerFogPixel(room.playerB, 9, 9).then(isRevealed)).toBe(true);

    const hideAllCalls = await countMutateSessionCalls(room.dm, async () => {
      await root.locator('[data-fog-action="hide-all"]').click();
      await expect.poll(() => readPlayerFogPixel(room.playerA, 5, 5).then(isHiddenFog)).toBe(true);
    });
    expect(hideAllCalls).toBe(1);
    expect(messages.at(-1)).toMatch(/hide the entire level/i);

    // Reveal something first so Reset has a real baseline change to make.
    await clickPaintCell(room.dm, level, 0, 0);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 0, 0).then(isRevealed)).toBe(true);

    const resetCalls = await countMutateSessionCalls(room.dm, async () => {
      await root.locator('[data-fog-action="reset"]').click();
      await expect.poll(() => readPlayerFogPixel(room.playerA, 0, 0).then(isHiddenFog)).toBe(true);
    });
    expect(resetCalls).toBe(1);
    expect(messages.at(-1)).toMatch(/reset fog to its configured defaults/i);
    expect(messages.length).toBe(3);
  });

  test('6. Disable Fog exposes the base map but never discloses a DM-hidden token, and never mutates disclosure state', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 10, height: 10 });
    await insertHiddenToken(room, level, { x: 0, y: 0 });
    await openDmBoard(room);
    await openApprovedPlayers(room);
    recordDialogs(room.dm);
    const root = fogRoot(room.dm);
    await expect(root).toBeVisible();

    // Fully reveal fog first, isolating disclosure from fog visibility (design §1.3): the token
    // must stay absent from the player projection even with nothing left for fog to conceal.
    await root.locator('[data-fog-action="reveal-all"]').click();
    await expect.poll(() => readPlayerFogPixel(room.playerA, 0, 0).then(isRevealed)).toBe(true);

    let playerSnapshot = await snapshotFor(actors, room.playerA, room.hosted.session);
    expect(playerSnapshot.tokens).toEqual([]);
    await expect(room.playerA.page.locator('#playerBoardPanel')).not.toContainText('Hidden Lurker');

    const dmSnapshotBefore = await snapshotFor(actors, room.dm, room.hosted.session);
    const tokenBefore = dmSnapshotBefore.tokens.find(t => t.label === 'Hidden Lurker');
    expect(tokenBefore).toMatchObject({ isVisible: false, publicVisible: false });

    await root.locator('[data-fog-action="disable-campaign"]').click();
    await expect.poll(async () => (await snapshotFor(actors, room.playerA, room.hosted.session)).fog.enabled).toBe(false);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 5, 5).then(isRevealed)).toBe(true);

    playerSnapshot = await snapshotFor(actors, room.playerA, room.hosted.session);
    expect(playerSnapshot.tokens, 'disabling fog never discloses a DM-hidden token').toEqual([]);
    await expect(room.playerA.page.locator('#playerBoardPanel')).not.toContainText('Hidden Lurker');

    const dmSnapshotAfter = await snapshotFor(actors, room.dm, room.hosted.session);
    const tokenAfter = dmSnapshotAfter.tokens.find(t => t.label === 'Hidden Lurker');
    expect(tokenAfter, 'fog disable never mutates token disclosure state').toMatchObject({ isVisible: false, publicVisible: false });
  });

  test('7. re-enabling fog restores the exact previously stored mask, never a reset mask', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 10, height: 10 });
    await openDmBoard(room);
    await openApprovedPlayers(room);
    recordDialogs(room.dm);
    const root = await activateFogMode(room.dm);

    // Each stroke waits for its own committed round trip before the next begins: back-to-back
    // strokes from the very same window race their own not-yet-advanced `expectedRevision`
    // otherwise, which is a self-inflicted PT409 conflict this test isn't about.
    await clickPaintCell(room.dm, level, 3, 3);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 3, 3).then(isRevealed)).toBe(true);
    await clickPaintCell(room.dm, level, 4, 4);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 4, 4).then(isRevealed)).toBe(true);

    await root.locator('[data-fog-action="disable-campaign"]').click();
    await expect.poll(() => readPlayerFogPixel(room.playerA, 0, 0).then(isRevealed)).toBe(true); // everything visible while disabled

    await root.locator('[data-fog-action="enable-campaign"]').click();
    // (3,3)/(4,4) are revealed in both the "disabled" and "correctly re-enabled" states, so they
    // cannot distinguish the two on their own; (0,0) — hidden only once re-enable has actually
    // rendered the restored mask — is what proves the canvas moved past the disabled frame, so it
    // must be polled too rather than read once immediately after the other two settle.
    await expect.poll(() => readPlayerFogPixel(room.playerA, 0, 0).then(isHiddenFog)).toBe(true);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 9, 9).then(isHiddenFog)).toBe(true);
    expect(isRevealed(await readPlayerFogPixel(room.playerA, 3, 3))).toBe(true);
    expect(isRevealed(await readPlayerFogPixel(room.playerA, 4, 4))).toBe(true);
  });

  test('8. refresh/reconnect reconstructs the exact current fog, never a default/guessed mask', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 10, height: 10 });
    await openDmBoard(room);
    await openApprovedPlayers(room);
    await activateFogMode(room.dm);

    await clickPaintCell(room.dm, level, 6, 6);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 6, 6).then(isRevealed)).toBe(true);
    await expect.poll(() => readPlayerFogPixel(room.playerB, 6, 6).then(isRevealed)).toBe(true);

    await room.playerA.page.reload();
    await expect(room.playerA.page.locator('#playerBoardPanel')).toBeVisible();
    await room.playerB.page.reload();
    await expect(room.playerB.page.locator('#playerBoardPanel')).toBeVisible();

    expect(isRevealed(await readPlayerFogPixel(room.playerA, 6, 6))).toBe(true);
    expect(isHiddenFog(await readPlayerFogPixel(room.playerA, 0, 0))).toBe(true);
    expect(isRevealed(await readPlayerFogPixel(room.playerB, 6, 6))).toBe(true);
    expect(isHiddenFog(await readPlayerFogPixel(room.playerB, 0, 0))).toBe(true);
  });

  test('9. a stale manager window is rejected, rehydrates, and never auto-replays its mutation', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 10, height: 10 });
    await openDmBoard(room);

    // A second manager-authorized window: the same DM account, a second real authenticated
    // browser context/session, exactly like a DM with two open tabs.
    const dmWindowB = await actors.actor('dm-window-b');
    dmWindowB.credentials = room.dm.credentials;
    await dmWindowB.page.goto('/#login');
    await actors.login(dmWindowB);
    await openDmBoard({ dm: dmWindowB, hosted: room.hosted });
    const rootB = fogRoot(dmWindowB);
    await expect(rootB).toBeVisible();
    recordDialogs(dmWindowB);

    // Freeze window B's own view of the world at its current (correct, just-hydrated) state.
    const unfreeze = await freezeSnapshot(dmWindowB, room.hosted.session);

    // Window A (live, unfrozen) commits a real mutation; window B's engine has no way to learn
    // about it while frozen, so its next mutation attempt will carry the now-stale revision it
    // captured before this point — a real optimistic-concurrency race, not a fabricated error.
    await activateFogMode(room.dm);
    await clickPaintCell(room.dm, level, 1, 1);
    await expect.poll(async () => (await snapshotFor(actors, room.dm, room.hosted.session)).fog.revealedRuns.length).toBeGreaterThan(0);

    // PT409 is PostgREST's typed custom-conflict SQLSTATE: it surfaces as HTTP 409 with a
    // `{"code":"PT409",...}` body. Conflict recovery branches on that structured code, never
    // on generic 409 status or message text.
    actors.expectHttp(dmWindowB, '/rest/v1/rpc/mutate_session', 409);
    let calls = await countMutateSessionCalls(dmWindowB, async () => {
      await rootB.locator('[data-fog-action="reveal-all"]').click();
      await expect(dmWindowB.page.locator('#realtimeMutationNotice')).toContainText('session changed');
    });
    expect(calls, 'the rejected attempt is exactly one request, never auto-retried').toBe(1);

    // Let window B rehydrate for real (mirrors the focus-triggered rehydrate `visibility.spec.js`
    // already exercises for the revocation case), then prove recovery actually happened: an
    // explicit retry with the now-current revision succeeds — the earlier stale intention was
    // never blindly replayed on B's behalf, and B's own state is not permanently stuck stale.
    await unfreeze();
    await forceHydrateViaFocus(dmWindowB);

    calls = await countMutateSessionCalls(dmWindowB, async () => {
      await rootB.locator('[data-fog-action="reveal-all"]').click();
      await expect.poll(() => snapshotFor(actors, room.dm, room.hosted.session).then(s => s.fog.revealedRuns.length)).toBe(10);
    });
    expect(calls).toBe(1);
  });

  test('10. editing fog on a non-presented level never shifts or leaks to current players', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 10, height: 10 });
    const extraLevel = await createExtraLevel(room, level, { width: 8, height: 8 });
    await openDmBoard(room);
    await openApprovedPlayers(room);

    const playerBefore = await snapshotFor(actors, room.playerA, room.hosted.session);
    const dmBefore = await snapshotFor(actors, room.dm, room.hosted.session);

    const { data, error } = await rawMutate(actors, room.dm, room.hosted.session, {
      schemaVersion: 1,
      type: 'fog.revealAll',
      expectedRevision: dmBefore.revision,
      payload: { levelId: extraLevel.levelId },
    });
    expect(error).toBeNull();
    const bumpedRevision = data.dm.fog.levelRevisions.find(entry => entry.levelId === extraLevel.levelId);
    expect(bumpedRevision).toBeTruthy();
    expect(Number(bumpedRevision.revision)).toBeGreaterThan(0);
    // The manager's own presented-level fog/board is untouched by the other level's edit.
    expect(data.fog).toEqual(dmBefore.fog);

    const playerAfter = await snapshotFor(actors, room.playerA, room.hosted.session);
    expect(playerAfter.fog).toEqual(playerBefore.fog);
    expect(playerAfter.revision, 'nothing player-visible changed, so the player is never re-invalidated').toBe(playerBefore.revision);
    expect(JSON.stringify(playerAfter)).not.toContain(extraLevel.levelId);

    for (const player of [room.playerA, room.playerB]) {
      const info = await playerFogStageInfo(player);
      expect([info.canvasWidth, info.canvasHeight]).toEqual([level.width, level.height]);
    }
  });

  test('11. DM Player Preview fog rendering matches the real Player Screen for the same snapshot', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 10, height: 10 });
    await openDmBoard(room);
    await openApprovedPlayers(room);
    await activateFogMode(room.dm);

    await clickPaintCell(room.dm, level, 2, 2);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 2, 2).then(isRevealed)).toBe(true);
    await clickPaintCell(room.dm, level, 7, 7);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 7, 7).then(isRevealed)).toBe(true);

    await togglePresentationMode(room.dm);
    await expect(room.dm.page.locator('#dmPreviewPanel')).toBeVisible();

    for (const [x, y] of [[2, 2], [7, 7], [0, 0], [9, 9], [3, 3]]) {
      const previewPixel = await readPlayerFogPixel(room.dm, x, y);
      const realPixel = await readPlayerFogPixel(room.playerA, x, y);
      expect(previewPixel).toEqual(realPixel);
    }

    // No DM-only frontier color anywhere on the shared player renderer's own canvas.
    const previewInfo = await playerFogStageInfo(room.dm);
    const allPixels = await room.dm.page.evaluate(({ w, h }) => {
      const canvas = document.querySelector('.fog-player-canvas');
      return Array.from(canvas.getContext('2d').getImageData(0, 0, w, h).data);
    }, { w: previewInfo.canvasWidth, h: previewInfo.canvasHeight });
    for (let i = 0; i < allPixels.length; i += 4) {
      const pixel = [allPixels[i], allPixels[i + 1], allPixels[i + 2]];
      expect(pixel).not.toEqual(GOLD_FRONTIER_RGB);
    }
  });

  test('12. the real player-authorized snapshot carries no DM fog metadata or secret data', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 10, height: 10 });
    await insertHiddenToken(room, level, { x: 1, y: 1, label: 'Secret Ambusher' });
    await openDmBoard(room);
    await createNamedArea(room.dm, level, { name: 'Whisper Crypt', cells: [[4, 4]], revealedByDefault: true });
    await openApprovedPlayers(room);

    const playerSnapshot = await snapshotFor(actors, room.playerA, room.hosted.session);
    expect(playerSnapshot.dm).toBeNull();
    expect(Object.keys(playerSnapshot.fog).sort()).toEqual(['enabled', 'height', 'levelId', 'revealedRuns', 'width'].sort());
    expect(playerSnapshot.tokens).toEqual([]);

    const serialized = JSON.stringify(playerSnapshot);
    for (const forbidden of ['Whisper Crypt', 'Secret Ambusher', 'cellRuns', 'revealedByDefault', 'levelRevisions', '"areas"', 'dmNotes', 'tokenDetails', 'locationOverride', 'levelOverride', 'campaignEnabled']) {
      expect(serialized, `player snapshot must never contain "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test('13. a 200x200 level completes Reveal All / Hide All / Reset without a per-cell storm and stays canvas-only', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 200, height: 200 });
    await openDmBoard(room);
    await openApprovedPlayers(room);
    const root = fogRoot(room.dm);
    await expect(root).toBeVisible();
    recordDialogs(room.dm);

    for (const player of [room.playerA, room.playerB]) {
      const info = await playerFogStageInfo(player);
      expect([info.canvasWidth, info.canvasHeight]).toEqual([200, 200]);
      expect(info.nodeCount, 'base + canvas only, never one node per cell').toBeLessThanOrEqual(3);
    }

    let before = await countSessionEvents(room.hosted.session);
    const revealCalls = await countMutateSessionCalls(room.dm, async () => {
      await root.locator('[data-fog-action="reveal-all"]').click();
      await expect.poll(() => readPlayerFogPixel(room.playerA, 199, 199).then(isRevealed)).toBe(true);
    });
    let after = await countSessionEvents(room.hosted.session);
    expect(revealCalls).toBe(1);
    expect(after - before, 'one broad action invalidates a handful of recipients, never one row per cell').toBeLessThanOrEqual(10);

    let playerSnapshot = await snapshotFor(actors, room.playerA, room.hosted.session);
    expect(playerSnapshot.fog.revealedRuns.length).toBe(200);
    for (const run of playerSnapshot.fog.revealedRuns) expect(run[2] - run[1]).toBe(200);
    expect(isRevealed(await readPlayerFogPixel(room.playerA, 0, 0))).toBe(true);
    expect(isRevealed(await readPlayerFogPixel(room.playerA, 100, 150))).toBe(true);

    before = await countSessionEvents(room.hosted.session);
    const hideCalls = await countMutateSessionCalls(room.dm, async () => {
      await root.locator('[data-fog-action="hide-all"]').click();
      await expect.poll(() => readPlayerFogPixel(room.playerA, 199, 199).then(isHiddenFog)).toBe(true);
    });
    after = await countSessionEvents(room.hosted.session);
    expect(hideCalls).toBe(1);
    expect(after - before).toBeLessThanOrEqual(10);
    playerSnapshot = await snapshotFor(actors, room.playerA, room.hosted.session);
    expect(playerSnapshot.fog.revealedRuns).toEqual([]);

    // A defaults-revealed named area (created via RPC: dragging 10,000 cells through synthetic
    // pointer events is not what this scenario is testing) so Reset has real work to do.
    const dmSnapshot = await snapshotFor(actors, room.dm, room.hosted.session);
    const areaCells = [];
    for (let x = 0; x < 50; x += 1) areaCells.push([x, 0]);
    const created = await rawMutate(actors, room.dm, room.hosted.session, {
      schemaVersion: 1, type: 'fog.area.create', expectedRevision: dmSnapshot.revision,
      payload: { levelId: level.levelId, name: 'Default Revealed Strip', cells: areaCells, revealedByDefault: true },
    });
    expect(created.error).toBeNull();

    before = await countSessionEvents(room.hosted.session);
    const resetCalls = await countMutateSessionCalls(room.dm, async () => {
      await root.locator('[data-fog-action="reset"]').click();
      await expect.poll(() => readPlayerFogPixel(room.playerA, 0, 0).then(isRevealed)).toBe(true);
    });
    after = await countSessionEvents(room.hosted.session);
    expect(resetCalls).toBe(1);
    expect(after - before).toBeLessThanOrEqual(10);
    playerSnapshot = await snapshotFor(actors, room.playerA, room.hosted.session);
    expect(playerSnapshot.fog.revealedRuns).toEqual([[0, 0, 50]]);
    expect(isHiddenFog(await readPlayerFogPixel(room.playerA, 50, 0))).toBe(true);
    expect(isHiddenFog(await readPlayerFogPixel(room.playerA, 0, 1))).toBe(true);
  });

  test('14. hidden cells stay fully opaque with no leak or DM frontier on the real Player Screen', async ({ actors }) => {
    const room = await createMultiplayerSession(actors);
    const level = await createFogLevel(room, { width: 20, height: 20 });
    await openDmBoard(room);
    await openApprovedPlayers(room);
    await activateFogMode(room.dm);

    await clickPaintCell(room.dm, level, 10, 10);
    await expect.poll(() => readPlayerFogPixel(room.playerA, 10, 10).then(isRevealed)).toBe(true);

    // Immediate neighbors of the single revealed cell must remain fully opaque fog: no bleed.
    for (const [x, y] of [[9, 10], [11, 10], [10, 9], [10, 11], [9, 9], [11, 11]]) {
      expect(isHiddenFog(await readPlayerFogPixel(room.playerA, x, y)), `(${x},${y}) must stay opaque fog`).toBe(true);
    }

    const allPixels = await room.playerA.page.evaluate(() => {
      const canvas = document.querySelector('.fog-player-canvas');
      return Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
    });
    let hiddenCount = 0, revealedCount = 0;
    for (let i = 0; i < allPixels.length; i += 4) {
      const pixel = [allPixels[i], allPixels[i + 1], allPixels[i + 2], allPixels[i + 3]];
      expect(isHiddenFog(pixel) || pixel[3] === 0, `pixel ${i / 4} must be exactly fully-opaque fog or fully-transparent, never a blend (got ${pixel})`).toBe(true);
      if (isHiddenFog(pixel)) hiddenCount += 1;
      if (pixel[3] === 0) revealedCount += 1;
      expect(pixel).not.toEqual([...GOLD_FRONTIER_RGB, 255]);
    }
    expect(revealedCount).toBe(1);
    expect(hiddenCount).toBe(20 * 20 - 1);
    // Per-CSS-scaling interpolation bleed at non-integer zoom is covered deterministically by a
    // dedicated real-screenshot regression: tests/e2e/fog-pixel.spec.js.
  });
});
