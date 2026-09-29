import { test, expect } from './fixtures.js';
import {
  createMultiplayerSession,
  createFogLevel,
  disableCampaignFog,
  insertTokens,
  insertHiddenToken,
  setActiveInitiative,
  bumpCharacterHp,
  createApprovedCharacters,
  openPlayerScreen,
  expectNoDmProjection,
} from './realtime-harness.js';

const BOSS_LABELS = ['B1', 'B2', 'B3'];
const ENEMY_LABELS = Array.from({ length: 20 }, (_, i) => `E${i + 1}`);
const NPC_LABELS = Array.from({ length: 7 }, (_, i) => `N${i + 1}`);
const OPPONENT_LABELS = [...BOSS_LABELS, ...ENEMY_LABELS, ...NPC_LABELS];
const CHARACTER_COUNT = 8;

function opponentFixture() {
  const opponents = [];
  BOSS_LABELS.forEach((label, i) => opponents.push({ kind: 'boss', label, x: i, y: 0 }));
  ENEMY_LABELS.forEach((label, i) => opponents.push({ kind: 'enemy', label, x: i % 20, y: 1 + Math.floor(i / 20) }));
  NPC_LABELS.forEach((label, i) => opponents.push({ kind: 'npc', label, x: i, y: 3 }));
  return opponents;
}

// A row's vertical center lying inside its scrollable list's own clipped box is what
// "reachable by scrolling" means here — unlike toBeVisible(), this actually accounts for
// ancestor overflow clipping rather than just CSS display/visibility.
async function isRowVisibleWithinList(list, row) {
  const [listBox, rowBox] = await Promise.all([list.boundingBox(), row.boundingBox()]);
  if (!listBox || !rowBox) return false;
  const rowCenterY = rowBox.y + rowBox.height / 2;
  return rowCenterY >= listBox.y && rowCenterY <= listBox.y + listBox.height;
}

async function scrollListToBottom(page, list) {
  await list.hover();
  for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, 2000);
}

async function seedCrowdedSession(actors) {
  const room = await createMultiplayerSession(actors);
  const level = await createFogLevel(room);
  await disableCampaignFog(room);
  const tokens = await insertTokens(room, level, opponentFixture());
  const characters = await createApprovedCharacters(actors, room, CHARACTER_COUNT, 'Realtime Hero');
  return { room, level, tokens, characters };
}

test('crowded realtime encounter: DM screen keeps every combatant reachable without body scroll', async ({ actors }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Panel geometry assertions only apply to the desktop layout.');

  const { room, tokens, characters } = await seedCrowdedSession(actors);
  try {
    await room.dm.page.goto(`/#board/${room.hosted.session}`);
    const panel = room.dm.page.locator('#realtimeSessionPanel');
    await expect(panel).toBeVisible();

    const tokenList = panel.locator('.realtime-token-list');
    const characterList = panel.locator('.realtime-character-list');

    await test.step('every authorized token and character renders, with no hard cap', async () => {
      await expect(tokenList.locator('.realtime-token-row')).toHaveCount(OPPONENT_LABELS.length);
      await expect(characterList.locator('.realtime-character-card')).toHaveCount(CHARACTER_COUNT);
      await expect(panel.locator('.realtime-rail-count').first()).toHaveText(`Opponents · ${OPPONENT_LABELS.length}`);
      await expect(panel.locator('.realtime-rail-count').nth(1)).toHaveText(`Players · ${CHARACTER_COUNT}`);
    });

    await test.step('bosses render first among opponents; token ids are intact', async () => {
      const kinds = await tokenList.locator('.realtime-token-kind').allTextContents();
      expect(kinds.slice(0, BOSS_LABELS.length)).toEqual(['boss', 'boss', 'boss']);
      const labels = await tokenList.locator('.realtime-token-label').allTextContents();
      expect(labels).toEqual(OPPONENT_LABELS);
    });

    await test.step('the token list scrolls internally; body and the map never move', async () => {
      const gridBoxBefore = await room.dm.page.locator('#grid').boundingBox();
      const scrollYBefore = await room.dm.page.evaluate(() => window.scrollY);
      const characterScrollBefore = await characterList.evaluate(el => el.scrollTop);

      await scrollListToBottom(room.dm.page, tokenList);

      const lastOpponent = tokenList.locator('.realtime-token-row').last();
      expect(await isRowVisibleWithinList(tokenList, lastOpponent)).toBe(true);
      await expect(lastOpponent.locator('.realtime-token-label')).toHaveText(OPPONENT_LABELS.at(-1));

      expect(await room.dm.page.locator('#grid').boundingBox()).toEqual(gridBoxBefore);
      expect(await room.dm.page.evaluate(() => window.scrollY)).toBe(scrollYBefore);
      expect(await characterList.evaluate(el => el.scrollTop)).toBe(characterScrollBefore);
    });

    await test.step('the character list scrolls independently of the token list', async () => {
      const tokenScrollBefore = await tokenList.evaluate(el => el.scrollTop);

      await scrollListToBottom(room.dm.page, characterList);

      const lastCharacter = characterList.locator('.realtime-character-card').last();
      expect(await isRowVisibleWithinList(characterList, lastCharacter)).toBe(true);
      expect(await tokenList.evaluate(el => el.scrollTop)).toBe(tokenScrollBefore);
    });

    await test.step('an unrelated snapshot update (same session, same active token) preserves both scroll offsets', async () => {
      const tokenScrollBefore = await tokenList.evaluate(el => el.scrollTop);
      const characterScrollBefore = await characterList.evaluate(el => el.scrollTop);
      expect(tokenScrollBefore).toBeGreaterThan(0);
      expect(characterScrollBefore).toBeGreaterThan(0);

      await bumpCharacterHp(room, characters.characterIds[0], 7);
      // Proves a real rerender actually happened (the whole point: an unrelated authoritative
      // update must still rebuild the DOM) — this is not a no-op update we're papering over.
      await expect(characterList).toContainText('HP 7/10', { timeout: 20_000 });

      expect(await tokenList.evaluate(el => el.scrollTop)).toBe(tokenScrollBefore);
      expect(await characterList.evaluate(el => el.scrollTop)).toBe(characterScrollBefore);
    });

    await test.step('advancing to an off-screen active opponent scrolls it into view', async () => {
      await tokenList.evaluate(el => { el.scrollTop = 0; });
      const lastOpponentId = tokens.find(t => t.label === OPPONENT_LABELS.at(-1)).id;
      const lastOpponentRow = tokenList.locator(`.realtime-token-row[data-token-id="${lastOpponentId}"]`);
      expect(await isRowVisibleWithinList(tokenList, lastOpponentRow)).toBe(false);

      await setActiveInitiative(room, lastOpponentId);

      await expect(lastOpponentRow).toHaveClass(/active-combatant/, { timeout: 20_000 });
      await expect.poll(() => isRowVisibleWithinList(tokenList, lastOpponentRow), { timeout: 20_000 }).toBe(true);
    });
  } finally {
    await characters.cleanup();
  }
});

test('crowded realtime encounter: Player Screen stays read-only, security-scoped, and fully reachable', async ({ actors }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Panel geometry assertions only apply to the desktop layout.');

  const { room, level, tokens, characters } = await seedCrowdedSession(actors);
  try {
    const hidden = await insertHiddenToken(room, level, { x: 19, y: 19, label: 'Hidden Behind Fog' });

    await openPlayerScreen(room.playerA, room.hosted.session);
    const panel = room.playerA.page.locator('#playerBoardPanel');
    const tokenList = panel.locator('.realtime-token-list');
    const characterList = panel.locator('.realtime-character-list');

    await test.step('every authorized opponent/character renders; the hidden token never does', async () => {
      await expect(tokenList.locator('.realtime-token-row')).toHaveCount(OPPONENT_LABELS.length);
      await expect(characterList.locator('.realtime-character-card')).toHaveCount(CHARACTER_COUNT);
      await expect(panel.locator(`[data-token-id="${hidden.id}"]`)).toHaveCount(0);
    });

    await test.step('bosses render first among opponents', async () => {
      const kinds = await tokenList.locator('.realtime-token-kind').allTextContents();
      expect(kinds.slice(0, BOSS_LABELS.length)).toEqual(['boss', 'boss', 'boss']);
    });

    await test.step('the Player Screen renders zero actionable controls of any kind', async () => {
      await expectNoDmProjection(room.playerA);
      await expect(panel.locator('[data-realtime-action]')).toHaveCount(0);
    });

    await test.step('no DM-only data (notes, activity, token HP) leaks into this panel', async () => {
      await expect(panel).not.toContainText('DM view');
      const panelText = await panel.innerText();
      expect(panelText).not.toMatch(/dm_notes|actualHp|private/i);
    });

    await test.step('the token list scrolls internally; body never becomes the navigation mechanism', async () => {
      const scrollYBefore = await room.playerA.page.evaluate(() => window.scrollY);

      await scrollListToBottom(room.playerA.page, tokenList);

      const lastOpponent = tokenList.locator('.realtime-token-row').last();
      expect(await isRowVisibleWithinList(tokenList, lastOpponent)).toBe(true);
      await expect(lastOpponent.locator('.realtime-token-label')).toHaveText(OPPONENT_LABELS.at(-1));
      expect(await room.playerA.page.evaluate(() => window.scrollY)).toBe(scrollYBefore);
    });

    await test.step('the character list scrolls independently and the final player is reachable', async () => {
      const tokenScrollBefore = await tokenList.evaluate(el => el.scrollTop);

      await scrollListToBottom(room.playerA.page, characterList);

      const lastCharacter = characterList.locator('.realtime-character-card').last();
      expect(await isRowVisibleWithinList(characterList, lastCharacter)).toBe(true);
      expect(await tokenList.evaluate(el => el.scrollTop)).toBe(tokenScrollBefore);
    });

    await test.step('an unrelated snapshot update (same session, same active token) preserves both scroll offsets', async () => {
      const tokenScrollBefore = await tokenList.evaluate(el => el.scrollTop);
      const characterScrollBefore = await characterList.evaluate(el => el.scrollTop);
      expect(tokenScrollBefore).toBeGreaterThan(0);
      expect(characterScrollBefore).toBeGreaterThan(0);

      await bumpCharacterHp(room, characters.characterIds[0], 7);
      await expect(characterList).toContainText('HP 7/10', { timeout: 20_000 });

      expect(await tokenList.evaluate(el => el.scrollTop)).toBe(tokenScrollBefore);
      expect(await characterList.evaluate(el => el.scrollTop)).toBe(characterScrollBefore);
    });

    await test.step('advancing to an off-screen active opponent scrolls it into view for the player too', async () => {
      await tokenList.evaluate(el => { el.scrollTop = 0; });
      const lastOpponentId = tokens.find(t => t.label === OPPONENT_LABELS.at(-1)).id;
      const lastOpponentRow = tokenList.locator(`.realtime-token-row[data-token-id="${lastOpponentId}"]`);
      expect(await isRowVisibleWithinList(tokenList, lastOpponentRow)).toBe(false);

      await setActiveInitiative(room, lastOpponentId);

      await expect(lastOpponentRow).toHaveClass(/active-combatant/, { timeout: 20_000 });
      await expect.poll(() => isRowVisibleWithinList(tokenList, lastOpponentRow), { timeout: 20_000 }).toBe(true);
    });
  } finally {
    await characters.cleanup();
  }
});
