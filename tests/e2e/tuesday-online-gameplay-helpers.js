import { expect } from './fixtures.js';

export const MANAGER_TEST_IDS = [
  'prepare-board', 'create-token', 'token-create-submit', 'token-inspector',
  'move-token', 'delete-token', 'initiative-editor', 'initiative-submit', 'next-turn',
];

export async function snapshotFor(actors, actor, sessionId) {
  const { data, error } = await actors.rpc(actor, 'get_session_snapshot', { p_session: sessionId });
  if (error) throw new Error(`get_session_snapshot failed: ${JSON.stringify(error)}`);
  return data;
}

export async function observeMutationCommands(actor, run) {
  const commands = [];
  const listener = request => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/rest/v1/rpc/mutate_session') return;
    const body = request.postDataJSON();
    if (body?.p_command) commands.push(body.p_command);
  };
  actor.page.on('request', listener);
  try {
    await run();
  } finally {
    actor.page.off('request', listener);
  }
  return commands;
}

export function expectOneCommand(commands, type) {
  expect(commands.map(command => command.type)).toEqual([type]);
  return commands[0];
}

export async function submitAndApproveCharacter(dm, player, { name, hp }) {
  await player.page.getByLabel('Character name', { exact: true }).fill(name);
  await player.page.getByLabel('Maximum HP', { exact: true }).fill(String(hp));
  await player.page.getByRole('button', { name: 'Submit character', exact: true }).click();
  await expect(player.page.locator('[data-character-notice]')).toContainText('Character submitted');

  const card = dm.page.locator('.character-card').filter({
    has: dm.page.getByRole('heading', { name, exact: true }),
  });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve & issue code', exact: true }).click();
  await expect(card).toContainText('Character approved');
  const code = await dm.page.getByLabel('Issued character reclaim code', { exact: true }).inputValue();
  return code.split('.')[1];
}

export async function createTokenThroughUi(dm, token) {
  const panel = dm.page.locator('#realtimeSessionPanel');
  const details = panel.locator('.realtime-token-form-details');
  if (!(await details.evaluate(element => element.open))) {
    await panel.locator('[data-testid="create-token-toggle"]').click();
  }
  const form = panel.locator('[data-testid="create-token"]');
  await form.locator('[name="kind"]').selectOption(token.kind);
  if (token.kind === 'player') {
    await expect(form.locator('[name="characterId"]')).toBeVisible();
    await form.locator('[name="characterId"]').selectOption(token.characterId);
  }
  await form.locator('[name="label"]').fill(token.label);
  await form.locator('[name="x"]').fill(String(token.x));
  await form.locator('[name="y"]').fill(String(token.y));
  await form.locator('[name="isVisible"]').setChecked(token.isVisible);

  const commands = await observeMutationCommands(dm, async () => {
    await form.locator('[data-testid="token-create-submit"]').click();
    await expect(panel.locator(`.spatial-token[aria-label^="${token.label},"]`)).toBeVisible({ timeout: 20_000 });
  });
  const command = expectOneCommand(commands, 'token.create');
  expect(command.payload).toMatchObject({
    kind: token.kind, label: token.label, x: token.x, y: token.y, isVisible: token.isVisible,
  });
  if (token.kind === 'player') expect(command.payload.characterId).toBe(token.characterId);
  const locator = panel.locator(`.spatial-token[aria-label^="${token.label},"]`);
  return { ...token, id: await locator.getAttribute('data-spatial-token-id') };
}

export async function moveTokenThroughUi(dm, token, x, y) {
  const panel = dm.page.locator('#realtimeSessionPanel');
  await panel.locator(`[data-spatial-token-id="${token.id}"]`).click();
  const inspector = panel.locator('[data-testid="token-inspector"]');
  await inspector.locator('[data-move-x]').fill(String(x));
  await inspector.locator('[data-move-y]').fill(String(y));
  const commands = await observeMutationCommands(dm, async () => {
    await inspector.locator('[data-testid="move-token"]').click();
    await expect(panel.locator(`[data-spatial-token-id="${token.id}"]`)).toHaveAttribute('data-token-x', String(x), { timeout: 20_000 });
  });
  expectOneCommand(commands, 'token.move');
  return { ...token, x, y };
}

export async function deleteTokenThroughUi(dm, tokenId) {
  const panel = dm.page.locator('#realtimeSessionPanel');
  const spatial = panel.locator(`[data-spatial-token-id="${tokenId}"]`);
  if ((await spatial.count()) === 0) return [];
  await spatial.click();
  const commands = await observeMutationCommands(dm, async () => {
    await panel.locator('[data-testid="token-inspector"] [data-testid="delete-token"]').click();
    await expect(spatial).toHaveCount(0, { timeout: 20_000 });
  });
  expectOneCommand(commands, 'token.delete');
  return commands;
}

export async function setInitiativeThroughUi(dm, entries) {
  const panel = dm.page.locator('#realtimeSessionPanel');
  const details = panel.locator('.realtime-initiative-editor-details');
  if (!(await details.evaluate(element => element.open))) {
    await panel.locator('[data-testid="initiative-editor-toggle"]').click();
  }
  const editor = panel.locator('[data-testid="initiative-editor"]');
  for (const checkbox of await editor.locator('[data-initiative-include]').all()) await checkbox.uncheck();
  for (const entry of entries) {
    const row = editor.locator(`[data-initiative-row][data-token-id="${entry.tokenId}"]`);
    await row.locator('[data-initiative-include]').check();
    await row.locator('[data-initiative-value]').fill(String(entry.initiative));
  }
  const commands = await observeMutationCommands(dm, async () => {
    await editor.locator('[data-testid="initiative-submit"]').click();
    await expect(panel.locator('.realtime-initiative-list .realtime-initiative-row')).toHaveCount(entries.length, { timeout: 20_000 });
  });
  expectOneCommand(commands, 'initiative.set');
}

export async function advanceThroughUi(dm, waitFor) {
  const commands = await observeMutationCommands(dm, async () => {
    await dm.page.locator('#realtimeSessionPanel [data-testid="next-turn"]').click();
    await waitFor();
  });
  expectOneCommand(commands, 'initiative.advance');
  return commands;
}

export async function expectSpatialToken(actor, token, root = 'body') {
  const locator = actor.page.locator(`${root} [data-spatial-token-id="${token.id}"]`);
  await expect(locator).toHaveCount(1);
  await expect(locator).toHaveAttribute('data-token-x', String(token.x));
  await expect(locator).toHaveAttribute('data-token-y', String(token.y));
  await expect(locator).toHaveAttribute('data-token-kind', token.kind);
  return locator;
}

export async function expectHiddenSecretAbsent(actors, actor, sessionId, token, root = 'body', snapshotActor = actor) {
  const snapshot = await snapshotFor(actors, snapshotActor, sessionId);
  const serialized = JSON.stringify(snapshot);
  expect(snapshot.dm).toBeNull();
  expect(serialized).not.toContain(token.id);
  expect(serialized).not.toContain(token.label);
  const containsCoordinateTuple = value => {
    if (!value || typeof value !== 'object') return false;
    if (value.x === token.x && value.y === token.y) return true;
    return Object.values(value).some(containsCoordinateTuple);
  };
  expect(containsCoordinateTuple(snapshot)).toBe(false);
  const html = await actor.page.locator(root).evaluate(element => element.outerHTML);
  expect(html).not.toContain(token.id);
  expect(html).not.toContain(token.label);
  await expect(actor.page.locator(`${root} [data-token-x="${token.x}"][data-token-y="${token.y}"]`)).toHaveCount(0);
  await expect(actor.page.locator(`${root} [data-spatial-token-id="${token.id}"]`)).toHaveCount(0);
  await expect(actor.page.locator(`${root} [data-token-id="${token.id}"]`)).toHaveCount(0);
  await expect(actor.page.locator(`${root} .realtime-dm-section`)).toHaveCount(0);
}

export async function expectManagerControlsAbsent(actor, root) {
  for (const testid of MANAGER_TEST_IDS) {
    await expect(actor.page.locator(`${root} [data-testid="${testid}"]`)).toHaveCount(0);
  }
}

export async function expectNoServiceRoleCredential(actor) {
  const evidence = await actor.page.evaluate(() => {
    const serialized = JSON.stringify({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    });
    const roles = [];
    for (const candidate of serialized.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
      try {
        const payload = candidate.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
        if (typeof decoded.role === 'string') roles.push(decoded.role);
      } catch { /* Non-JWT dotted storage values are irrelevant. */ }
    }
    return { serialized, roles };
  });
  expect(evidence.serialized.toLowerCase()).not.toContain('service_role');
  expect(evidence.roles).not.toContain('service_role');
}

export async function denyManagerCommand(actors, actor, sessionId, command) {
  actors.expectHttp(actor, '/rest/v1/rpc/mutate_session', 403);
  const { data, error } = await actors.rpc(actor, 'mutate_session', {
    p_session: sessionId,
    p_command: command,
  });
  expect(data).toBeNull();
  expect(error?.code).toBe('42501');
}

export function normalizedRecipientState(snapshot) {
  return {
    session: snapshot.session,
    roundNumber: snapshot.roundNumber,
    tokens: snapshot.tokens,
    initiative: snapshot.initiative,
    fog: snapshot.fog,
    authority: snapshot.authority,
  };
}
