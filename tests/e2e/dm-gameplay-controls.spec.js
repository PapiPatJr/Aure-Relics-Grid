import { test, expect } from './fixtures.js';
import {
  createMultiplayerSession,
  createApprovedCharacters,
  disableCampaignFog,
  openPlayerScreen,
  togglePresentationMode,
  expectNoDmProjection,
  readPlayerFogPixel,
} from './realtime-harness.js';

// Tuesday Online Package 2C. Unlike every earlier realtime fixture, this spec seeds nothing
// through raw SQL for the gameplay flow itself — Prepare Board, token creation/movement/deletion
// and initiative authoring all go through the real production UI now that 2C exists. The one
// exception (createApprovedCharacters) predates a production character-creation UI and is
// unrelated to this package's own scope.

test('DM gameplay controls: prepare board, create/move/delete tokens, author initiative, advance the turn — all through production UI', async ({ actors }) => {
  const room = await createMultiplayerSession(actors);
  await disableCampaignFog(room); // tokens become publicVisible without seeding per-cell fog reveals — same convention as crowded-realtime.spec.js/fog.spec.js.
  const hero = await createApprovedCharacters(actors, room, 1, 'Hero');
  try {
    await room.dm.page.goto(`/#board/${room.hosted.session}`);
    const panel = room.dm.page.locator('#realtimeSessionPanel');
    await expect(panel).toBeVisible();

    let enemyId, hiddenId, playerTokenId;

    await test.step('Board: DM prepares the board through the UI', async () => {
      await expect(panel.locator('[data-testid="prepare-board"]')).toBeVisible();
      await expect(panel.locator('.spatial-board-stage')).toHaveCount(0);
      await panel.locator('[data-testid="prepare-board"]').click();
      await expect(panel.locator('.spatial-board-stage')).toBeVisible({ timeout: 20_000 });
      // Idempotent: the control simply stops being offered once a board exists.
      await expect(panel.locator('[data-testid="prepare-board"]')).toHaveCount(0);
    });

    await test.step('Token creation: an Enemy token', async () => {
      // Collapsed by default (see script.js's renderRealtimeCreateTokenForm) — opened once here,
      // stays open for the rest of this test's token-creation steps.
      await panel.locator('[data-testid="create-token-toggle"]').click();
      const form = panel.locator('[data-testid="create-token"]');
      await form.locator('[name="kind"]').selectOption('enemy');
      await form.locator('[name="label"]').fill('Goblin');
      await form.locator('[name="x"]').fill('5');
      await form.locator('[name="y"]').fill('6');
      await form.locator('[name="isVisible"]').check();
      await form.locator('[data-testid="token-create-submit"]').click();
      const token = panel.locator('.spatial-token[data-token-x="5"][data-token-y="6"]');
      await expect(token).toBeVisible({ timeout: 20_000 });
      enemyId = await token.getAttribute('data-spatial-token-id');
      await expect(token).toHaveClass(/spatial-token--enemy/);
      await expect(token).not.toHaveClass(/spatial-token--hidden/);
    });

    await test.step('Token creation: a hidden Enemy token, hidden atomically from the first snapshot', async () => {
      const form = panel.locator('[data-testid="create-token"]');
      await form.locator('[name="kind"]').selectOption('enemy');
      await form.locator('[name="label"]').fill('Lurker');
      await form.locator('[name="x"]').fill('1');
      await form.locator('[name="y"]').fill('1');
      // isVisible left unchecked.
      await form.locator('[data-testid="token-create-submit"]').click();
      const token = panel.locator('.spatial-token[data-token-x="1"][data-token-y="1"]');
      await expect(token).toBeVisible({ timeout: 20_000 });
      hiddenId = await token.getAttribute('data-spatial-token-id');
      await expect(token).toHaveClass(/spatial-token--hidden/);
    });

    await test.step('Token creation: a Player token via character selection', async () => {
      const form = panel.locator('[data-testid="create-token"]');
      await form.locator('[name="kind"]').selectOption('player');
      await expect(form.locator('[name="characterId"]')).toBeVisible();
      await form.locator('[name="characterId"]').selectOption(hero.characterIds[0]);
      await form.locator('[name="label"]').fill('Hero 1');
      await form.locator('[name="x"]').fill('10');
      await form.locator('[name="y"]').fill('10');
      await form.locator('[name="isVisible"]').check();
      await form.locator('[data-testid="token-create-submit"]').click();
      const token = panel.locator('.spatial-token[data-token-x="10"][data-token-y="10"]');
      await expect(token).toBeVisible({ timeout: 20_000 });
      playerTokenId = await token.getAttribute('data-spatial-token-id');
      await expect(token).toHaveClass(/spatial-token--player/);
      // The character that already has a token must no longer be offered.
      await expect(form.locator(`[name="characterId"] option[value="${hero.characterIds[0]}"]`)).toHaveCount(0);
    });

    await test.step('Authoritative board receives them: Player Screen shows the visible tokens, never the hidden one', async () => {
      await openPlayerScreen(room.playerA, room.hosted.session);
      const playerLayer = room.playerA.page.locator('#playerBoardPanel .fog-player-stage .spatial-token-layer');
      await expect(playerLayer.locator(`[data-spatial-token-id="${enemyId}"]`)).toBeVisible({ timeout: 20_000 });
      await expect(playerLayer.locator(`[data-spatial-token-id="${playerTokenId}"]`)).toBeVisible();
      await expect(playerLayer.locator(`[data-spatial-token-id="${hiddenId}"]`)).toHaveCount(0);
    });

    await test.step('Move: DM repositions the visible Enemy through the UI; Player receives it; Fog is unaffected', async () => {
      const beforePixel = await readPlayerFogPixel(room.playerA, 5, 6);

      await panel.locator(`.spatial-token[data-spatial-token-id="${enemyId}"]`).click();
      const inspector = panel.locator('[data-testid="token-inspector"]');
      await expect(inspector).toBeVisible();
      await inspector.locator('[data-move-x]').fill('15');
      await inspector.locator('[data-move-y]').fill('12');
      await inspector.locator('[data-testid="move-token"]').click();

      const dmToken = panel.locator(`[data-spatial-token-id="${enemyId}"]`);
      await expect(dmToken).toHaveAttribute('data-token-x', '15', { timeout: 20_000 });
      await expect(dmToken).toHaveAttribute('data-token-y', '12');

      const playerToken = room.playerA.page.locator(`#playerBoardPanel [data-spatial-token-id="${enemyId}"]`);
      await expect(playerToken).toHaveAttribute('data-token-x', '15', { timeout: 20_000 });
      await expect(playerToken).toHaveAttribute('data-token-y', '12');

      const afterPixel = await readPlayerFogPixel(room.playerA, 5, 6);
      expect(afterPixel).toEqual(beforePixel);
    });

    await test.step('Delete: DM deletes the hidden Enemy through the UI; it disappears authoritatively', async () => {
      await panel.locator(`.spatial-token[data-spatial-token-id="${hiddenId}"]`).click();
      await expect(panel.locator('[data-testid="token-inspector"]')).toBeVisible();
      await panel.locator('[data-testid="token-inspector"] [data-testid="delete-token"]').click();
      await expect(panel.locator(`[data-spatial-token-id="${hiddenId}"]`)).toHaveCount(0, { timeout: 20_000 });
      await expect(panel.locator('[data-testid="token-inspector"]')).toHaveCount(0);
    });

    await test.step('Initiative: DM authors a short order through the UI; the authoritative order matches', async () => {
      await panel.locator('[data-testid="initiative-editor-toggle"]').click();
      const editor = panel.locator('[data-testid="initiative-editor"]');
      const enemyRow = editor.locator(`[data-initiative-row][data-token-id="${enemyId}"]`);
      const playerRow = editor.locator(`[data-initiative-row][data-token-id="${playerTokenId}"]`);
      await enemyRow.locator('[data-initiative-include]').check();
      await enemyRow.locator('[data-initiative-value]').fill('18');
      await playerRow.locator('[data-initiative-include]').check();
      await playerRow.locator('[data-initiative-value]').fill('12');
      await editor.locator('[data-testid="initiative-submit"]').click();
      await expect(panel.locator('.realtime-initiative-list .realtime-initiative-row')).toHaveCount(2, { timeout: 20_000 });
    });

    await test.step('Next Turn: one click advances the active combatant live', async () => {
      await expect(panel.locator('[data-testid="next-turn"]')).toBeVisible();
      await panel.locator('[data-testid="next-turn"]').click();
      // Higher initiative (18, the enemy) goes first per this UI's own ordering.
      await expect(panel.locator(`[data-spatial-token-id="${enemyId}"]`)).toHaveClass(/spatial-token--active/, { timeout: 20_000 });
    });

    await test.step('Cleanup: delete the Player token through the UI (also exercises Delete on a player-kind token)', async () => {
      // Discovered defect (not 2C-owned, not fixed here per this package's "no SQL/no backend
      // changes" scope): public.tokens.character_id -> public.characters has no ON DELETE CASCADE
      // (unlike its level_id FK), so a campaign-cascade delete can fail with a dangling-reference
      // error if a player-kind token still exists when the owning character cascades away first.
      // This is the first test to ever create a real player-kind token through production token.create
      // and then delete its campaign, so it's the first to hit this. Deleting the token explicitly
      // here keeps this test's own local Supabase state clean regardless; flagged in the build report
      // for the backend owner.
      await panel.locator(`.spatial-token[data-spatial-token-id="${playerTokenId}"]`).click();
      await expect(panel.locator('[data-testid="token-inspector"]')).toBeVisible();
      await panel.locator('[data-testid="token-inspector"] [data-testid="delete-token"]').click();
      await expect(panel.locator(`[data-spatial-token-id="${playerTokenId}"]`)).toHaveCount(0, { timeout: 20_000 });
    });

    await test.step('Security: Player Screen and DM Preview expose none of the 2C authoring controls', async () => {
      for (const testid of ['prepare-board', 'create-token', 'token-inspector', 'initiative-editor', 'next-turn']) {
        await expect(room.playerA.page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
      }
      await expectNoDmProjection(room.playerA, '#playerBoardPanel');

      await togglePresentationMode(room.dm);
      for (const testid of ['prepare-board', 'create-token', 'token-inspector', 'initiative-editor', 'next-turn']) {
        await expect(room.dm.page.locator(`#dmPreviewPanel [data-testid="${testid}"]`)).toHaveCount(0);
      }
    });
  } finally {
    await hero.cleanup();
  }
});
