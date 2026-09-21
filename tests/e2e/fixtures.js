import { test as base, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localStack, appOrigin, apiOrigin } from './local-stack.mjs';

export { expect };
export const test = base.extend({
  actors: async ({ browser, viewport }, use, testInfo) => {
    const stack = localStack();
    const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const admin = createClient(apiOrigin, stack.SERVICE_ROLE_KEY, authOptions);
    const actors = [], users = new Set(), campaigns = new Map(), pending = [];
    const problems = [], expectedDenials = [], assets = new Set();
    const credentials = new Map();
    const uploadedPortraits = new Set();
    let closing = false;
    const harness = {
      async actor(label) {
        const context = await browser.newContext({ viewport, baseURL: appOrigin, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await context.newPage();
        const actor = { label, context, page, expected: [] };
        actors.push(actor);
        // Block accidental hosted/API/CDN traffic before it leaves the browser.
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (['data:', 'blob:', 'about:'].includes(url.protocol) || [appOrigin, apiOrigin].includes(url.origin)) return route.continue();
          problems.push(`${label}: blocked non-local request ${url.origin}${url.pathname}`);
          return route.abort();
        });
        page.on('pageerror', error => problems.push(`${label}: uncaught ${error.message}`));
        page.on('console', message => {
          // Chromium emits this for expected HTTP denials too; the response handler
          // below checks every such status against an explicit one-use allowance.
          if (message.type() === 'error' && !message.text().startsWith('Failed to load resource: the server responded with a status of')) {
            problems.push(`${label}: console ${message.text()}`);
          }
        });
        page.on('requestfailed', request => {
          if (!closing && request.failure()?.errorText !== 'net::ERR_ABORTED') {
            problems.push(`${label}: failed ${new URL(request.url()).pathname} ${request.failure()?.errorText}`);
          }
        });
        page.on('response', response => {
          const task = (async () => {
            const url = new URL(response.url());
            const path = url.pathname;
            if (response.status() >= 400) {
              const i = actor.expected.findIndex(item => item.path === path && item.status === response.status());
              if (i >= 0) {
                actor.expected.splice(i, 1);
                expectedDenials.push(`${label}: ${response.status()} ${path}`);
              } else problems.push(`${label}: unexpected HTTP ${response.status()} ${path}`);
            }
            if (/\.(png|ttf|webp)(\?|$)/.test(path) && response.ok()) assets.add(path);
            if (url.origin === apiOrigin && response.ok() && ['POST', 'PUT'].includes(response.request().method()) && path.startsWith('/storage/v1/object/character-images/')) {
              uploadedPortraits.add(decodeURIComponent(path.slice('/storage/v1/object/character-images/'.length)));
            }
            if (url.origin !== apiOrigin || !response.ok() || response.request().method() !== 'POST') return;
            if (path === '/auth/v1/signup') {
              const body = await response.json();
              if (body.user?.id) { users.add(body.user.id); actor.userId = body.user.id; }
            }
            if (path === '/rest/v1/campaigns') {
              const body = await response.json();
              for (const row of Array.isArray(body) ? body : [body]) campaigns.set(row.id, row.owner_id);
            }
          })().catch(error => { if (!closing) problems.push(`${label}: observation ${error.message}`); });
          pending.push(task);
        });
        return actor;
      },
      expectHttp(actor, path, status) { actor.expected.push({ path, status }); },
      async register(actor) {
        const email = `aure-e2e-${crypto.randomUUID()}@example.test`;
        const password = `${crypto.randomUUID()}Aa1!`;
        actor.credentials = { email, password };
        const { page } = actor;
        await page.goto('/#register');
        await page.getByLabel('Email address').fill(email);
        await page.getByLabel('Password', { exact: true }).fill(password);
        const signed = page.waitForResponse(r => new URL(r.url()).pathname === '/auth/v1/signup');
        await page.getByRole('button', { name: 'Create DM account', exact: true }).click();
        const response = await signed;
        expect(response.ok(), 'local signup succeeds').toBeTruthy();
        const body = await response.json();
        if (body.user?.id) { users.add(body.user.id); credentials.set(body.user.id, { email, password }); }
        await expect(page.getByRole('heading', { name: 'Your campaigns', exact: true })).toBeVisible();
      },
      async login(actor) {
        await actor.page.getByLabel('Email address').fill(actor.credentials.email);
        await actor.page.getByLabel('Password', { exact: true }).fill(actor.credentials.password);
        await actor.page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(actor.page.getByRole('heading', { name: 'Your campaigns', exact: true })).toBeVisible();
      },
      async host(actor) {
        await harness.register(actor);
        const name = `E2E ${crypto.randomUUID().slice(0, 8)}`;
        await actor.page.getByLabel('Campaign name', { exact: true }).fill(name);
        await actor.page.getByRole('button', { name: 'Create campaign', exact: true }).click();
        await expect(actor.page.getByLabel('Session name', { exact: true })).toBeVisible();
        const campaign = new URL(actor.page.url()).hash.split('/')[1];
        await actor.page.getByLabel('Session name', { exact: true }).fill('First gathering');
        await actor.page.getByRole('button', { name: 'Create session', exact: true }).click();
        await expect(actor.page.getByRole('heading', { name: 'First gathering', exact: true })).toBeVisible();
        const session = new URL(actor.page.url()).hash.split('/')[1];
        const invitation = await harness.invite(actor);
        return { campaign, session, name, ...invitation };
      },
      async invite(actor) {
        await actor.page.getByRole('button', { name: 'Generate / replace code', exact: true }).click();
        await expect(actor.page.getByLabel('Complete join code')).toBeVisible();
        await expect(actor.page.locator('#entryNotice')).toContainText('New invitation ready');
        return { code: await actor.page.getByLabel('Complete join code').inputValue(), link: await actor.page.getByLabel('Shareable join link').inputValue() };
      },
      async request(actor, invitation, name) {
        await actor.page.goto(invitation.link);
        await expect(actor.page).toHaveURL(`${appOrigin}/#join`);
        await expect(actor.page.getByLabel('Join code or link')).toHaveValue(invitation.code);
        await actor.page.getByLabel('Your player name').fill(name);
        await actor.page.getByRole('button', { name: 'Request a seat', exact: true }).click();
        await expect(actor.page.locator('#lobbyState')).toContainText('Your request is with the DM');
      },
      async screenshot(actor, name) {
        const path = testInfo.outputPath(`${name}.png`);
        await actor.page.screenshot({ path, fullPage: true, mask: [actor.page.locator('#shareCode'), actor.page.locator('#shareLink'), actor.page.locator('#password'), actor.page.locator('[data-character-secret]')] });
        await testInfo.attach(name, { path, contentType: 'image/png' });
      },
      async rpc(actor, method, args) {
        // Use only the actor's existing public client/session, never administrative keys.
        return actor.page.evaluate(async ({ method, args }) => {
          const { getSupabaseClient } = await import('/src/supabase/client.js');
          const { data, error } = await getSupabaseClient().rpc(method, args);
          return { data, error: error ? { code: error.code, message: error.message } : null };
        }, { method, args });
      },
    };
    try { await use(harness); }
    finally {
      await Promise.all(pending);
      // Dispose browsers before fixture cleanup to stop polling during deletion.
      closing = true;
      const cleanupErrors = [];
      for (const actor of actors) {
        const failed = testInfo.status !== testInfo.expectedStatus || problems.length > 0;
        if (failed) {
          await actor.page.screenshot({ path: testInfo.outputPath(`${actor.label}-failure.png`), fullPage: true }).catch(() => {});
        }
        try { await actor.context.close(); }
        catch { cleanupErrors.push(`Could not close test context ${actor.label}`); }
      }
      const ownerClients = new Map();
      try {
        if (uploadedPortraits.size) {
          const removed = await admin.storage.from('character-images').remove([...uploadedPortraits]);
          if (removed.error) cleanupErrors.push(removed.error.message);
        }
        for (const [campaign, owner] of campaigns) {
          try {
            if (!ownerClients.has(owner)) {
              const client = createClient(apiOrigin, stack.ANON_KEY, authOptions);
              const signed = await client.auth.signInWithPassword(credentials.get(owner));
              if (signed.error) throw signed.error;
              ownerClients.set(owner, client);
            }
            const result = await ownerClients.get(owner).from('campaigns').delete().eq('id', campaign).select('id');
            if (result.error || result.data.length !== 1) throw new Error('Test campaign cleanup failed');
          } catch (error) { cleanupErrors.push(error.message); }
        }
      } finally {
        for (const client of ownerClients.values()) await client.auth.signOut();
        for (const id of users) {
          const result = await admin.auth.admin.deleteUser(id);
          if (result.error) cleanupErrors.push(result.error.message);
        }
      }
      await testInfo.attach('browser-observations', {
        body: JSON.stringify({ chromium: browser.version(), contexts: actors.map(a => a.label), expectedDenials, localAssets: [...assets], problems, cleanupErrors }, null, 2), contentType: 'application/json',
      });
      expect(cleanupErrors, 'only this run\'s fixtures are removed').toEqual([]);
      expect(actors.flatMap(a => a.expected), 'all expected denial requests actually occurred').toEqual([]);
      expect(problems, 'no uncaught errors, unexpected HTTP/network failures or remote assets').toEqual([]);
    }
  },
});
