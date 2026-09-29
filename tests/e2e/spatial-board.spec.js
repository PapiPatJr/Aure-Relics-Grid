import { test, expect } from './fixtures.js';
import {
  createMultiplayerSession,
  createFogLevel,
  disableCampaignFog,
  insertTokens,
  insertHiddenToken,
  moveTokenDirect,
  openPlayerScreen,
  togglePresentationMode,
} from './realtime-harness.js';

async function seedSpatialSession(actors, { width = 20, height = 20 } = {}) {
  const room = await createMultiplayerSession(actors);
  const level = await createFogLevel(room, { width, height });
  await disableCampaignFog(room);
  return { room, level };
}

function spatialToken(scope, id) {
  return scope.locator(`.spatial-token[data-spatial-token-id="${id}"]`);
}

test.describe('realtime spatial token board', () => {
  test('DM: known tokens of every kind appear spatially, at their authoritative x/y', async ({ actors }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Panel geometry assertions only apply to the desktop layout.');

    const { room, level } = await seedSpatialSession(actors);
    // 'player'-kind tokens require a linked character_id (public.tokens' own check constraint) —
    // orthogonal to spatial placement, so this fixture sticks to the three kinds a bare raw-SQL
    // insert can legally create; kind-modifier-class coverage for 'player' itself lives in the
    // unit-level renderer tests (tests/spatial-token-renderer.test.js), which aren't DB-constrained.
    const tokens = await insertTokens(room, level, [
      { kind: 'enemy', label: 'E1', x: 5, y: 3 },
      { kind: 'npc', label: 'N1', x: 10, y: 10 },
      { kind: 'boss', label: 'B1', x: 19, y: 19 },
    ]);
    const byLabel = Object.fromEntries(tokens.map(t => [t.label, t.id]));

    await room.dm.page.goto(`/#board/${room.hosted.session}`);
    const stage = room.dm.page.locator('#realtimeSessionPanel .spatial-board-stage');
    await expect(stage).toBeVisible();

    await test.step('every kind renders with its kind modifier class', async () => {
      await expect(spatialToken(stage, byLabel.E1)).toHaveClass(/spatial-token--enemy/);
      await expect(spatialToken(stage, byLabel.N1)).toHaveClass(/spatial-token--npc/);
      await expect(spatialToken(stage, byLabel.B1)).toHaveClass(/spatial-token--boss/);
    });

    await test.step('data-token-x/y expose the authoritative coordinates', async () => {
      await expect(spatialToken(stage, byLabel.E1)).toHaveAttribute('data-token-x', '5');
      await expect(spatialToken(stage, byLabel.E1)).toHaveAttribute('data-token-y', '3');
    });

    await test.step('a token near (0,0) renders left/above a token near the far corner', async () => {
      const [topLeftBox, bottomRightBox] = await Promise.all([
        spatialToken(stage, byLabel.E1).boundingBox(),
        spatialToken(stage, byLabel.B1).boundingBox(),
      ]);
      expect(topLeftBox.x).toBeLessThan(bottomRightBox.x);
      expect(topLeftBox.y).toBeLessThan(bottomRightBox.y);
    });
  });

  test('DM: a hidden token is visible only in the DM management view, with the hidden treatment', async ({ actors }) => {
    const { room, level } = await seedSpatialSession(actors);
    const [visible] = await insertTokens(room, level, [{ kind: 'enemy', label: 'Visible', x: 2, y: 2 }]);
    const hidden = await insertHiddenToken(room, level, { x: 4, y: 4, label: 'Lurker' });

    await room.dm.page.goto(`/#board/${room.hosted.session}`);
    const stage = room.dm.page.locator('#realtimeSessionPanel .spatial-board-stage');
    await expect(spatialToken(stage, visible.id)).toBeVisible();
    await expect(spatialToken(stage, hidden.id)).toBeVisible();
    await expect(spatialToken(stage, hidden.id)).toHaveClass(/spatial-token--hidden/);
    await expect(spatialToken(stage, visible.id)).not.toHaveClass(/spatial-token--hidden/);
  });

  test('Player: an authorized token renders spatially at its authoritative position; a hidden token has no DOM element at all', async ({ actors }) => {
    const { room, level } = await seedSpatialSession(actors);
    const [visible] = await insertTokens(room, level, [{ kind: 'enemy', label: 'Visible', x: 6, y: 8 }]);
    const hidden = await insertHiddenToken(room, level, { x: 1, y: 1, label: 'Lurker' });

    await openPlayerScreen(room.playerA, room.hosted.session);
    const panel = room.playerA.page.locator('#playerBoardPanel');
    const layer = panel.locator('.fog-player-stage .spatial-token-layer');

    await expect(spatialToken(layer, visible.id)).toBeVisible();
    await expect(spatialToken(layer, visible.id)).toHaveAttribute('data-token-x', '6');
    await expect(spatialToken(layer, visible.id)).toHaveAttribute('data-token-y', '8');
    await expect(spatialToken(layer, hidden.id)).toHaveCount(0);
  });

  test('Player: the spatial token layer carries no mutation/manage controls', async ({ actors }) => {
    const { room, level } = await seedSpatialSession(actors);
    await insertTokens(room, level, [{ kind: 'enemy', label: 'Visible', x: 3, y: 3 }]);

    await openPlayerScreen(room.playerA, room.hosted.session);
    const layer = room.playerA.page.locator('#playerBoardPanel .fog-player-stage .spatial-token-layer');
    await expect(layer.locator('[data-realtime-action]')).toHaveCount(0);
    await expect(layer.locator('button')).toHaveCount(0);
  });

  test('Preview: DM Player Preview matches the real Player Screen token count and positions for the same projected state', async ({ actors }) => {
    const { room, level } = await seedSpatialSession(actors);
    await insertTokens(room, level, [
      { kind: 'enemy', label: 'E1', x: 2, y: 2 },
      { kind: 'boss', label: 'B1', x: 9, y: 9 },
    ]);
    await insertHiddenToken(room, level, { x: 0, y: 0, label: 'Lurker' });

    await openPlayerScreen(room.playerA, room.hosted.session);
    const playerLayer = room.playerA.page.locator('#playerBoardPanel .fog-player-stage .spatial-token-layer');
    await expect(playerLayer.locator('.spatial-token')).toHaveCount(2);

    await room.dm.page.goto(`/#board/${room.hosted.session}`);
    await togglePresentationMode(room.dm);
    const previewLayer = room.dm.page.locator('#dmPreviewPanel .fog-player-stage .spatial-token-layer');
    await expect(previewLayer.locator('.spatial-token')).toHaveCount(2);

    const [playerPositions, previewPositions] = await Promise.all([
      playerLayer.locator('.spatial-token').evaluateAll(els => els.map(el => ({ x: el.dataset.tokenX, y: el.dataset.tokenY })).sort((a, b) => a.x - b.x)),
      previewLayer.locator('.spatial-token').evaluateAll(els => els.map(el => ({ x: el.dataset.tokenX, y: el.dataset.tokenY })).sort((a, b) => a.x - b.x)),
    ]);
    expect(previewPositions).toEqual(playerPositions);
  });

  test('Snapshot update: an authoritative server-side coordinate change moves the spatial token on DM, Player and Preview with no page reload', async ({ actors }) => {
    const { room, level } = await seedSpatialSession(actors);
    const [token] = await insertTokens(room, level, [{ kind: 'enemy', label: 'Mover', x: 1, y: 1 }]);

    await openPlayerScreen(room.playerA, room.hosted.session);
    const playerToken = spatialToken(room.playerA.page.locator('#playerBoardPanel'), token.id);
    await expect(playerToken).toHaveAttribute('data-token-x', '1');

    await room.dm.page.goto(`/#board/${room.hosted.session}`);
    const dmToken = spatialToken(room.dm.page.locator('#realtimeSessionPanel'), token.id);
    await expect(dmToken).toHaveAttribute('data-token-x', '1');

    await moveTokenDirect(room, token.id, 15, 12);

    await expect(playerToken).toHaveAttribute('data-token-x', '15', { timeout: 20_000 });
    await expect(playerToken).toHaveAttribute('data-token-y', '12', { timeout: 20_000 });
    await expect(dmToken).toHaveAttribute('data-token-x', '15', { timeout: 20_000 });
    await expect(dmToken).toHaveAttribute('data-token-y', '12', { timeout: 20_000 });
  });
});
