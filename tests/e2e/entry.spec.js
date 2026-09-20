import { test, expect } from './fixtures.js';
import { appOrigin } from './local-stack.mjs';

async function noGuestBoard(page) {
  await expect(page.locator('#legacyBoard')).toBeHidden();
  await expect(page.locator('#grid .cell')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.aureRelicsRuntime)).toBeUndefined();
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some(r => /\/script\.js(?:\?|$)/.test(r.name)))).toBe(false);
}
async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function deniedCode(actors, actor, code) {
  await actor.page.goto('/#join');
  await actor.page.getByLabel('Join code or link').fill(code);
  await actor.page.getByLabel('Your player name').fill('Code check');
  actors.expectHttp(actor, '/rest/v1/rpc/request_session_join', 403);
  await actor.page.getByRole('button', { name: 'Request a seat', exact: true }).click();
  await expect(actor.page.locator('#entryNotice')).toHaveText('Join unavailable');
  await expect(actor.page).toHaveURL(`${appOrigin}/#join`);
  await noGuestBoard(actor.page);
}

test('DM and isolated guests complete host/join, approval, denial, invitation security and local board flow', async ({ actors }) => {
  const dm = await actors.actor('dm-a');
  const guest = await actors.actor('guest-approved');
  const second = await actors.actor('guest-rejected');
  const probe = await actors.actor('guest-invalid-invitation');
  const other = await actors.actor('dm-b');
  let hosted, foreign;
  await test.step('Register DM, create campaign/session, render and copy invitation', async () => {
    hosted = await actors.host(dm);
    expect(hosted.code).toMatch(new RegExp(`^${hosted.campaign}\\.${hosted.session}\\.[0-9a-f]{64}$`));
    expect(hosted.link).toBe(`${appOrigin}/#join/${hosted.code}`);
    await dm.page.getByRole('button', { name: 'Copy code', exact: true }).click();
    await expect(dm.page.locator('#entryNotice')).toContainText('Copied.');
    expect(await dm.page.evaluate(() => navigator.clipboard.readText())).toBe(hosted.code);
    await dm.page.getByRole('button', { name: 'Copy link', exact: true }).click();
    expect(await dm.page.evaluate(() => navigator.clipboard.readText())).toBe(hosted.link);
    await fits(dm.page);
    await actors.screenshot(dm, 'host-panel');
  });
  await test.step('Guest invitation is scrubbed; pending request is approved via polling', async () => {
    await actors.request(guest, hosted, 'Amber');
    await expect(guest.page.locator('#roster')).toBeEmpty();
    await noGuestBoard(guest.page);
    const row = dm.page.locator('#roster .entry-row').filter({ has: dm.page.getByRole('heading', { name: 'Amber', exact: true }) });
    await expect(row).toContainText('pending');
    await row.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(guest.page.locator('#lobbyState')).toContainText('Welcome to the party');
    await noGuestBoard(guest.page);
    await expect(guest.page.locator('#roster .entry-row')).toHaveCount(1);
    await expect(guest.page.locator('#roster')).toContainText('Amber');
    await expect(row).toContainText('approved');
    await fits(guest.page);
    await actors.screenshot(guest, 'approved-lobby');
    await guest.page.reload();
    await expect(guest.page.locator('#lobbyState')).toContainText('Welcome to the party');
    await noGuestBoard(guest.page);
  });
  await test.step('Second anonymous context is rejected; first guest is removed', async () => {
    await actors.request(second, hosted, 'Briar');
    const rejected = dm.page.locator('#roster .entry-row').filter({ has: dm.page.getByRole('heading', { name: 'Briar', exact: true }) });
    await rejected.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(second.page.locator('#lobbyState')).toContainText('declined or access was removed');
    await expect(second.page.locator('#roster')).toBeEmpty();
    const approved = dm.page.locator('#roster .entry-row').filter({ has: dm.page.getByRole('heading', { name: 'Amber', exact: true }) });
    await approved.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(guest.page.locator('#lobbyState')).toContainText('declined or access was removed');
    await expect(guest.page.locator('#roster')).toBeEmpty();
    for (const actor of [guest, second]) {
      for (const route of ['dm', `campaign/${hosted.campaign}`, `session/${hosted.session}`, `board/${hosted.session}`]) {
        await actor.page.goto(`/#${route}`);
        await expect(actor.page).toHaveURL(`${appOrigin}/#join`);
        await expect(actor.page.getByRole('button', { name: 'Request a seat', exact: true })).toBeVisible();
        await noGuestBoard(actor.page);
      }
    }
  });
  await test.step('DM B cannot read DM A campaign, session or roster', async () => {
    foreign = await actors.host(other);
    await expect(other.page.locator('#onlineEntry')).not.toContainText(hosted.name);
    for (const [route, table] of [[`campaign/${hosted.campaign}`, 'campaigns'], [`session/${hosted.session}`, 'sessions']]) {
      actors.expectHttp(other, `/rest/v1/${table}`, 406);
      await other.page.goto(`/#${route}`);
      await expect(other.page.getByRole('heading', { name: 'Unable to open this page' })).toBeVisible();
      await expect(other.page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
      await expect(other.page.locator('#legacyBoard')).toBeHidden();
    }
    const roster = await actors.rpc(other, 'get_session_roster', { p_session: hosted.session });
    expect(roster.error).toBeNull(); expect(roster.data).toEqual([]);
    actors.expectHttp(other, '/rest/v1/rpc/review_session_guest', 403);
    const review = await actors.rpc(other, 'review_session_guest', { p_session: hosted.session, p_user: guest.userId, p_action: 'approve' });
    expect(review.error?.code).toBe('42501');
  });
  await test.step('Cross-scope, rotated and revoked invitations fail through the guest UI', async () => {
    const pieces = hosted.code.split('.');
    await deniedCode(actors, probe, [foreign.campaign, pieces[1], pieces[2]].join('.'));
    await deniedCode(actors, probe, [pieces[0], foreign.session, pieces[2]].join('.'));
    await deniedCode(actors, probe, [foreign.campaign, foreign.session, pieces[2]].join('.'));
    const rotated = await actors.invite(dm);
    expect(rotated.code).not.toBe(hosted.code);
    await deniedCode(actors, probe, hosted.code);
    await dm.page.getByRole('button', { name: 'Revoke join code', exact: true }).click();
    await expect(dm.page.locator('#entryNotice')).toContainText('Join code revoked');
    await deniedCode(actors, probe, rotated.code);
  });
  await test.step('DM logout/login preserves owned campaign selection', async () => {
    await dm.page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(dm.page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    await actors.login(dm);
    await dm.page.getByRole('button', { name: 'Open campaign', exact: true }).click();
    await dm.page.getByRole('button', { name: 'Open session', exact: true }).click();
    await expect(dm.page.getByRole('heading', { name: 'First gathering', exact: true })).toBeVisible();
  });
  await test.step('Existing board renders and terrain, combat, save/load and return navigation work', async () => {
    const page = dm.page;
    await page.getByRole('button', { name: 'Open local battle board', exact: true }).click();
    await expect(page.locator('#grid .cell')).toHaveCount(400);
    await expect(page.locator('#grid')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Combat Tracker', exact: true })).toBeVisible();
    await page.locator('summary').filter({ hasText: /^Terrain$/ }).click();
    await page.getByRole('button', { name: 'Tree', exact: true }).click();
    await page.locator('#grid .cell').nth(42).click();
    await expect(page.locator('#grid .terrain')).toHaveCount(1);
    await page.locator('summary').filter({ hasText: /^Tokens$/ }).click();
    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await page.locator('#grid .cell').nth(45).click();
    await expect(page.locator('#grid .token')).toHaveCount(1);
    await page.locator('summary').filter({ hasText: /^Initiative Setup$/ }).click();
    await expect(page.locator('#initiativeSetup')).toContainText('P1');
    await page.locator('#initiativeSetup .initiative-input').fill('15');
    await page.getByRole('button', { name: 'Sort Initiative', exact: true }).click();
    await page.getByRole('button', { name: 'Next Turn', exact: true }).click();
    await expect(page.locator('#initiativeList')).toContainText('P1');
    await page.locator('summary').filter({ hasText: /^Scenes$/ }).click();
    await page.getByLabel('Scene name', { exact: true }).fill('E2E local scene');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Save Scene', exact: true }).click();
    await expect(page.locator('#currentScene')).toHaveText('E2E local scene');
    if (!await page.getByRole('button', { name: 'Rock', exact: true }).isVisible()) {
      await page.locator('summary').filter({ hasText: /^Terrain$/ }).click();
    }
    await page.getByRole('button', { name: 'Rock', exact: true }).click();
    await page.locator('#grid .cell').nth(47).click();
    await expect(page.locator('#grid .terrain')).toHaveCount(2);
    await page.getByRole('button', { name: 'Load Scene', exact: true }).click();
    await expect(page.locator('#grid .terrain')).toHaveCount(1);
    await expect(page.locator('#grid .token')).toHaveCount(1);
    await actors.screenshot(dm, 'legacy-board');
    await page.getByRole('button', { name: 'Return to session', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'First gathering', exact: true })).toBeVisible();
    for (const actor of [guest, second, probe]) await noGuestBoard(actor.page);
  });
});

test('branded local assets, responsive layout, keyboard focus and auth loading/error states', async ({ actors }) => {
  const actor = await actors.actor('entry-visual');
  const { page } = actor;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The next chapter awaits.' })).toBeVisible();
  const banner = page.getByRole('img', { name: 'Aure Relics', exact: true });
  await expect(banner).toBeVisible();
  expect(await banner.evaluate(img => img.complete && img.naturalWidth > 0 && new URL(img.currentSrc).origin === location.origin)).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('600 24px Cinzel') && document.fonts.check('400 16px Spectral'))).toBe(true);
  await fits(page);
  await page.getByLabel('Email address').focus();
  await expect(page.getByLabel('Email address')).toBeFocused();
  expect(await page.getByLabel('Email address').evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await actors.screenshot(actor, 'entry-branded');

  // Hold the real login request long enough to assert a usable loading state.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/auth/v1/token?*', async route => { await gate; await route.continue(); });
  await page.getByLabel('Email address').fill(`missing-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(crypto.randomUUID());
  actors.expectHttp(actor, '/auth/v1/token', 400);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  try {
    await expect(page.locator('#entryNotice')).toHaveText('Working…');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.locator('#entryNotice')).toContainText('Invalid login credentials');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await fits(page);
  await actors.screenshot(actor, 'auth-error');
});

test('board return navigation preserves header branding and dock leaves tracker controls reachable', async ({ actors }) => {
  const dm = await actors.actor('board-layout');
  await actors.host(dm);
  await dm.page.getByRole('button', { name: 'Open local battle board', exact: true }).click();
  await expect(dm.page.locator('#grid .cell')).toHaveCount(400);
  const overlaps = await dm.page.evaluate(() => {
    const button = document.querySelector('.entry-board-back').getBoundingClientRect();
    return [...document.querySelectorAll('.app-header img')].some(img => {
      const image = img.getBoundingClientRect();
      return button.left < image.right && button.right > image.left && button.top < image.bottom && button.bottom > image.top;
    });
  });
  expect(overlaps, 'Return to session must not cover the banner or symbols').toBe(false);
  await dm.page.locator('summary').filter({ hasText: /^Initiative Setup$/ }).click();
  await expect(dm.page.locator('.initiative-setup-panel')).toHaveAttribute('open', '');
  await actors.screenshot(dm, 'board-navigation');
});
