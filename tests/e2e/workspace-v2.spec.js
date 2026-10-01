import { test, expect } from './fixtures.js';
import { createMultiplayerSession } from './realtime-harness.js';

async function readCamera(page) {
  return page.locator('.workspace-v2-canvas').evaluate(element => ({
    x: Number(element.dataset.cameraX),
    y: Number(element.dataset.cameraY),
    zoom: Number(element.dataset.cameraZoom),
  }));
}

async function drag(page, start, end, button = 'left') {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up({ button });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/v2.html#demo');
  await expect(page.locator('.workspace-v2-canvas')).toBeVisible();
  await expect(page.locator('.workspace-v2-canvas canvas')).toHaveCount(11);
});

test('wheel zoom keeps the world coordinate beneath the cursor anchored', async ({ page }) => {
  const board = page.locator('.workspace-v2-canvas');
  const box = await board.boundingBox();
  const point = {
    x: Math.round(box.x + box.width * 0.67),
    y: Math.round(box.y + box.height * 0.42),
  };
  const local = { x: point.x - box.x, y: point.y - box.y };
  const before = await readCamera(page);
  const worldBefore = {
    x: (local.x - before.x) / before.zoom,
    y: (local.y - before.y) / before.zoom,
  };

  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -420);
  await expect.poll(async () => (await readCamera(page)).zoom).toBeGreaterThan(before.zoom);
  const after = await readCamera(page);
  const worldAfter = {
    x: (local.x - after.x) / after.zoom,
    y: (local.y - after.y) / after.zoom,
  };

  expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(0.01);
  expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(0.01);
});

test('middle drag and Space plus left drag pan while normal left click does not', async ({ page }) => {
  const box = await page.locator('.workspace-v2-canvas').boundingBox();
  const start = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.6 };
  const initial = await readCamera(page);

  await page.mouse.click(start.x, start.y);
  expect(await readCamera(page)).toEqual(initial);

  await drag(page, start, { x: start.x + 80, y: start.y + 45 }, 'middle');
  const middle = await readCamera(page);
  expect(middle.x - initial.x).toBeCloseTo(80, 0);
  expect(middle.y - initial.y).toBeCloseTo(45, 0);

  await page.keyboard.down('Space');
  await drag(page, start, { x: start.x - 55, y: start.y + 30 });
  await page.keyboard.up('Space');
  const spaced = await readCamera(page);
  expect(spaced.x - middle.x).toBeCloseTo(-55, 0);
  expect(spaced.y - middle.y).toBeCloseTo(30, 0);
});

test('camera controls reset, fit, and activate Hand mode without resetting on resize', async ({ page }) => {
  const board = page.locator('.workspace-v2-canvas');
  const box = await board.boundingBox();
  const start = { x: box.x + 150, y: box.y + 150 };

  const beforeZoom = await readCamera(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect((await readCamera(page)).zoom).toBeGreaterThan(beforeZoom.zoom);
  await page.getByRole('button', { name: 'Reset zoom to 100%' }).click();
  expect((await readCamera(page)).zoom).toBe(1);

  await page.getByRole('button', { name: 'Hand tool' }).click();
  await drag(page, start, { x: start.x + 60, y: start.y - 25 });
  const panned = await readCamera(page);
  await page.setViewportSize({ width: 900, height: 620 });
  const resized = await readCamera(page);
  expect(resized).toEqual(panned);

  await page.getByRole('button', { name: 'Fit board' }).click();
  const fitted = await readCamera(page);
  expect(fitted.zoom).toBeGreaterThanOrEqual(0.25);
  expect(fitted.zoom).toBeLessThanOrEqual(3);
});

test('two-touch pinch zooms while a released one-finger gesture stays reserved for tools', async ({ page }) => {
  const board = page.locator('.workspace-v2-canvas');
  const box = await board.boundingBox();
  const dispatch = (type, pointerId, x, y) => board.dispatchEvent(type, {
    pointerId,
    pointerType: 'touch',
    isPrimary: pointerId === 1,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
    bubbles: true,
  });
  const y = box.y + 220;
  const left = box.x + 240;
  const right = box.x + 360;
  const before = await readCamera(page);

  await dispatch('pointerdown', 1, left, y);
  await dispatch('pointermove', 1, left + 70, y + 15);
  expect(await readCamera(page)).toEqual(before);
  await dispatch('pointerdown', 2, right, y);
  await dispatch('pointermove', 2, right + 80, y);
  const pinched = await readCamera(page);
  expect(pinched.zoom).toBeGreaterThan(before.zoom);
  await dispatch('pointerup', 2, right + 80, y);
  await dispatch('pointerup', 1, left + 70, y + 15);

  await dispatch('pointerdown', 3, left, y);
  await dispatch('pointermove', 3, left + 90, y + 40);
  expect(await readCamera(page)).toEqual(pinched);
  await dispatch('pointerup', 3, left + 90, y + 40);
});

test('Fog panel can dropdown, dock, float, minimize, restore, and close without losing the board', async ({ page }) => {
  const board = page.locator('.workspace-v2-canvas');
  const initialWidth = (await board.boundingBox()).width;
  await page.getByRole('navigation', { name: 'Workspace tools' }).getByRole('button', { name: 'Fog', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Fog panel' });
  await expect(panel).toHaveAttribute('data-panel-mode', 'dropdown');

  await panel.getByRole('button', { name: 'Dock left' }).click();
  await expect(panel).toHaveAttribute('data-panel-mode', 'dock-left');
  await expect(board).toBeVisible();
  await expect.poll(async () => (await board.boundingBox()).width).toBeLessThan(initialWidth);

  await panel.getByRole('button', { name: 'Float panel' }).click();
  await expect(panel).toHaveAttribute('data-panel-mode', 'floating');
  await panel.getByRole('button', { name: 'Minimize panel' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore Fog panel' }).click();
  await expect(panel).toHaveAttribute('data-panel-mode', 'floating');
  await panel.getByRole('button', { name: 'Close panel' }).click();
  await expect(panel).toHaveCount(0);
  await expect(board).toBeVisible();
  await expect.poll(async () => (await board.boundingBox()).width).toBeGreaterThanOrEqual(initialWidth - 1);
});

test('quick-tool menu drags, collapses, expands, and activates Pan', async ({ page }) => {
  const menu = page.getByRole('toolbar', { name: 'Quick tools' });
  await expect(menu).toBeVisible();
  const center = page.getByRole('button', { name: 'Toggle quick tools' });
  const box = await center.boundingBox();
  const before = await menu.evaluate(element => ({ x: Number(element.dataset.x), y: Number(element.dataset.y) }));
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + 90, y: box.y + 55 });
  await expect.poll(() => menu.evaluate(element => Number(element.dataset.x))).toBeGreaterThan(before.x);

  await center.click();
  await expect(menu).toHaveAttribute('data-collapsed', 'true');
  await center.click();
  await expect(menu).toHaveAttribute('data-collapsed', 'false');
  const pan = page.getByRole('button', { name: 'Pan', exact: true });
  await pan.click();
  await expect(pan).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.workspace-v2-canvas')).toHaveAttribute('data-hand-mode', 'true');
});

test.describe('local-stack V2 realtime', () => {
  test.skip(process.env.AURE_V2_E2E === '1', 'requires the isolated local Supabase stack');
  test.skip(({ viewport }) => viewport.width < 800, 'local-stack realtime coverage runs once on desktop');

  test('authorized session renders and moves a realtime token without reloading V2', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await room.dm.page.goto(`/#board/${room.hosted.session}`);
  const panel = room.dm.page.locator('#realtimeSessionPanel');
  await expect(panel).toBeVisible();
  const prepare = panel.locator('[data-testid="prepare-board"]');
  if (await prepare.isVisible()) await prepare.click();
  await expect(panel.locator('.spatial-board-stage')).toBeVisible({ timeout: 20_000 });

  await panel.locator('[data-testid="create-token-toggle"]').click();
  const form = panel.locator('[data-testid="create-token"]');
  await form.locator('[name="kind"]').selectOption('enemy');
  await form.locator('[name="label"]').fill('V2 Goblin');
  await form.locator('[name="x"]').fill('5');
  await form.locator('[name="y"]').fill('6');
  await form.locator('[name="isVisible"]').check();
  await form.locator('[data-testid="token-create-submit"]').click();
  const legacyToken = panel.locator('.spatial-token[data-token-x="5"][data-token-y="6"]');
  await expect(legacyToken).toBeVisible({ timeout: 20_000 });
  const tokenId = await legacyToken.getAttribute('data-spatial-token-id');

  await room.dm.page.goto(`/v2.html#session/${room.hosted.session}`);
  const canvas = room.dm.page.locator('.workspace-v2-canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((element, id) => {
    const tokens = JSON.parse(element.dataset.sceneTokens || '[]');
    return tokens.some(token => token.id === id && token.x === 5 && token.y === 6);
  }, tokenId), { timeout: 20_000 }).toBe(true);

  const hydrated = await actors.rpc(room.dm, 'get_session_snapshot', { p_session: room.hosted.session });
  expect(hydrated.error).toBeNull();
  const moved = await actors.rpc(room.dm, 'mutate_session', {
    p_session: room.hosted.session,
    p_command: {
      schemaVersion: 1,
      type: 'token.move',
      expectedRevision: hydrated.data.revision,
      payload: { tokenId, x: 9, y: 10 },
    },
  });
  expect(moved.error).toBeNull();
    await expect.poll(() => canvas.evaluate((element, id) => {
      const tokens = JSON.parse(element.dataset.sceneTokens || '[]');
      return tokens.some(token => token.id === id && token.x === 9 && token.y === 10);
    }, tokenId), { timeout: 20_000 }).toBe(true);
  });
});
