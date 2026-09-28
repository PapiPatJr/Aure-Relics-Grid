import { test, expect } from './fixtures.js';

const PLAYER_LABELS = Array.from({ length: 8 }, (_, i) => `P${i + 1}`);
const BOSS_LABELS = ['B1', 'B2', 'B3'];
const ENEMY_LABELS = Array.from({ length: 20 }, (_, i) => `E${i + 1}`);
const NPC_LABELS = Array.from({ length: 7 }, (_, i) => `N${i + 1}`);
const OPPONENT_LABELS = [...BOSS_LABELS, ...ENEMY_LABELS, ...NPC_LABELS];
const ALL_LABELS = [...PLAYER_LABELS, ...OPPONENT_LABELS];

async function placeTokens(page, toolId, count, cellOffset) {
  await page.locator(toolId).click();
  for (let i = 0; i < count; i += 1) {
    await page.locator('#grid .cell').nth(cellOffset + i).click();
  }
}

// A card's vertical center lying inside the rail's clipped box is what "reachable by
// scrolling" actually means here (unlike toBeInViewport, this ignores the page viewport
// and only cares about the rail's own scroll clipping).
async function isCardVisibleWithinRail(rail, card) {
  const [railBox, cardBox] = await Promise.all([rail.boundingBox(), card.boundingBox()]);
  if (!railBox || !cardBox) return false;
  const cardCenterY = cardBox.y + cardBox.height / 2;
  return cardCenterY >= railBox.y && cardCenterY <= railBox.y + railBox.height;
}

// A single huge wheel delta gets dropped by Chromium; real trackpad/wheel input arrives
// as a series of smaller ticks, so mirror that here to reach the bottom of the rail.
async function wheelRailToBottom(page, rail) {
  await rail.hover();
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.wheel(0, 2000);
  }
}

test('crowded encounter: independently scrollable rails reveal off-screen and active combatants', async ({ actors }, testInfo) => {
  // The mobile breakpoint intentionally replaces the rails with a flowed, page-scrolling
  // layout (a separate, pre-existing responsive design) instead of independently
  // scrollable rails, so the geometry assertions below only apply to the desktop layout.
  test.skip(testInfo.project.name !== 'desktop', 'Independent rail scrolling only applies to the desktop three-column layout.');

  const dm = await actors.actor('dm-crowded');
  await actors.host(dm);
  const page = dm.page;

  await test.step('Open the local battle board on a constrained viewport', async () => {
    await page.getByRole('button', { name: 'Open local battle board', exact: true }).click();
    await expect(page.locator('#grid .cell')).toHaveCount(400);
    // A short viewport stands in for a real DM's laptop screen and guarantees both rails
    // must overflow, regardless of exact card pixel heights.
    await page.setViewportSize({ width: 1440, height: 650 });
  });

  await test.step('Place 8 players and 30 bosses/enemies/NPCs', async () => {
    await page.locator('summary').filter({ hasText: /^Tokens$/ }).click();
    await placeTokens(page, '#playerToken', PLAYER_LABELS.length, 0);
    await placeTokens(page, '#bossToken', BOSS_LABELS.length, PLAYER_LABELS.length);
    await placeTokens(page, '#enemyToken', ENEMY_LABELS.length, PLAYER_LABELS.length + BOSS_LABELS.length);
    await placeTokens(page, '#npcToken', NPC_LABELS.length, PLAYER_LABELS.length + BOSS_LABELS.length + ENEMY_LABELS.length);
  });

  const playerRail = page.locator('#playerStatusBoard');
  const opponentRail = page.locator('#enemyStatusStrip');

  await test.step('All combatant cards render with no hard cap, tokens IDs preserved, bosses on top', async () => {
    await expect(playerRail.locator('.hud-card')).toHaveCount(PLAYER_LABELS.length);
    await expect(opponentRail.locator('.hud-card')).toHaveCount(OPPONENT_LABELS.length);

    for (const label of ALL_LABELS) {
      await expect(page.locator(`.hud-card[data-token-id="${label}"]`)).toHaveCount(1);
    }

    const opponentOrder = await opponentRail.locator('.hud-card').evaluateAll(
      cards => cards.map(card => card.dataset.tokenId)
    );
    expect(opponentOrder).toEqual(OPPONENT_LABELS);
    expect(opponentOrder.slice(0, BOSS_LABELS.length).every(id => id.startsWith('B'))).toBe(true);
  });

  await test.step('Rail counts are shown', async () => {
    await expect(playerRail.locator('.hud-rail-count')).toHaveText(`Players · ${PLAYER_LABELS.length}`);
    await expect(opponentRail.locator('.hud-rail-count')).toHaveText(`Opponents · ${OPPONENT_LABELS.length}`);
  });

  await test.step('Hidden opponent HP is not exposed by the rail fix', async () => {
    await page.locator('.hud-card[data-token-id="E1"] .hud-settings').click();
    await page.locator('#modalHp').fill('45');
    await page.locator('#modalMaxHp').fill('50');
    await expect(page.locator('#modalShowHp')).not.toBeChecked();
    await page.locator('#modalSave').click();
    const e1Card = page.locator('.hud-card[data-token-id="E1"]');
    await expect(e1Card).toContainText('Details hidden');
    await expect(e1Card).not.toContainText('45');
  });

  const grid = page.locator('#grid');

  await test.step('The opponent rail scrolls independently; the map and page stay put', async () => {
    const gridBoxBefore = await grid.boundingBox();
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    const playerScrollBefore = await playerRail.evaluate(el => el.scrollTop);

    await wheelRailToBottom(page, opponentRail);

    const lastOpponent = page.locator(`.hud-card[data-token-id="${OPPONENT_LABELS.at(-1)}"]`);
    expect(await isCardVisibleWithinRail(opponentRail, lastOpponent)).toBe(true);

    const gridBoxAfter = await grid.boundingBox();
    expect(gridBoxAfter).toEqual(gridBoxBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollYBefore);
    expect(await playerRail.evaluate(el => el.scrollTop)).toBe(playerScrollBefore);
  });

  await test.step('The player rail scrolls independently of the opponent rail', async () => {
    const opponentScrollBefore = await opponentRail.evaluate(el => el.scrollTop);

    await wheelRailToBottom(page, playerRail);

    const lastPlayer = page.locator(`.hud-card[data-token-id="${PLAYER_LABELS.at(-1)}"]`);
    expect(await isCardVisibleWithinRail(playerRail, lastPlayer)).toBe(true);
    expect(await opponentRail.evaluate(el => el.scrollTop)).toBe(opponentScrollBefore);
  });

  await test.step('Assign unique initiative to every combatant and sort', async () => {
    await page.locator('summary').filter({ hasText: /^Initiative Setup$/ }).click();
    await expect(page.locator('#initiativeSetup')).toContainText(ALL_LABELS.at(-1));

    await page.evaluate(labels => {
      labels.forEach((label, index) => {
        const input = document.querySelector(`.initiative-input[data-token="${label}"]`);
        input.value = String(labels.length - index);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }, ALL_LABELS);

    await page.locator('#sortInitiative').click();
    await expect(page.locator('#initiativeList')).toContainText('P1');
  });

  await test.step('Advancing to an off-screen player scrolls its card into view', async () => {
    // Reset both rails to the top first so the upcoming assertion proves the automatic
    // scroll-on-turn-advance behavior, rather than reusing the earlier manual scroll.
    await playerRail.evaluate(el => { el.scrollTop = 0; });
    await opponentRail.evaluate(el => { el.scrollTop = 0; });

    const lastPlayerCard = page.locator('.hud-card[data-token-id="P8"]');
    expect(await isCardVisibleWithinRail(playerRail, lastPlayerCard)).toBe(false);

    for (let i = 0; i < PLAYER_LABELS.length - 1; i += 1) {
      await page.locator('#nextTurn').click();
    }

    await expect(lastPlayerCard).toHaveClass(/active-combatant/);
    await expect.poll(() => isCardVisibleWithinRail(playerRail, lastPlayerCard)).toBe(true);
  });

  await test.step('Advancing to an off-screen opponent scrolls its card into view; active styling survives', async () => {
    await opponentRail.evaluate(el => { el.scrollTop = 0; });

    const lastOpponentCard = page.locator(`.hud-card[data-token-id="${OPPONENT_LABELS.at(-1)}"]`);
    expect(await isCardVisibleWithinRail(opponentRail, lastOpponentCard)).toBe(false);

    for (let i = 0; i < OPPONENT_LABELS.length; i += 1) {
      await page.locator('#nextTurn').click();
    }

    await expect(lastOpponentCard).toHaveClass(/active-combatant/);
    await expect.poll(() => isCardVisibleWithinRail(opponentRail, lastOpponentCard)).toBe(true);
    await expect(lastOpponentCard).toBeVisible();
  });
});
