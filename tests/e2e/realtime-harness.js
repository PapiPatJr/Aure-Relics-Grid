import { expect } from './fixtures.js';

function rosterRow(dm, name) {
  return dm.page.locator('#roster .entry-row').filter({
    has: dm.page.getByRole('heading', { name, exact: true }),
  });
}

async function approve(actors, dm, player, invitation, name) {
  await actors.request(player, invitation, name);
  const row = rosterRow(dm, name);
  await expect(row).toContainText('pending');
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(player.page.locator('#lobbyState')).toContainText('Welcome to the party');
}

export async function createMultiplayerSession(actors, names = {}) {
  const dm = await actors.actor('realtime-dm');
  const playerA = await actors.actor('realtime-player-a');
  const playerB = await actors.actor('realtime-player-b');
  const hosted = await actors.host(dm);

  await approve(actors, dm, playerA, hosted, names.playerA ?? 'Player A');
  await approve(actors, dm, playerB, hosted, names.playerB ?? 'Player B');

  return { dm, playerA, playerB, hosted };
}

export async function currentIdentity(actor) {
  return actor.page.evaluate(async () => {
    const { getSupabaseClient } = await import('/src/supabase/client.js');
    const { data, error } = await getSupabaseClient().auth.getUser();
    if (error) throw error;
    return { id: data.user?.id ?? null, anonymous: data.user?.is_anonymous ?? null };
  });
}

export async function expectIsolatedIdentities(...actors) {
  const identities = await Promise.all(actors.map(currentIdentity));
  expect(identities.every(identity => identity.id)).toBe(true);
  expect(new Set(identities.map(identity => identity.id)).size).toBe(identities.length);
  return identities;
}

export async function expectGuestBoardIsolated(actor) {
  await expect(actor.page.locator('#legacyBoard')).toBeHidden();
  await expect(actor.page.locator('#grid .cell')).toHaveCount(0);
}

export async function subscribeToChanges(actor, filter) {
  return actor.page.evaluate(async subscriptionFilter => {
    const { getSupabaseClient } = await import('/src/supabase/client.js');
    const key = crypto.randomUUID();
    const subscriptions = window.__aureRelicsQaSubscriptions ??= new Map();
    const state = { events: [], statuses: [] };
    const channel = getSupabaseClient()
      .channel(`aure-relics-qa-${key}`)
      .on('postgres_changes', subscriptionFilter, payload => state.events.push(payload));

    subscriptions.set(key, { channel, state });
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Realtime subscription did not become ready.')), 15_000);
      channel.subscribe(status => {
        state.statuses.push(status);
        if (status === 'SUBSCRIBED') {
          window.clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          window.clearTimeout(timeout);
          reject(new Error(`Realtime subscription ended with ${status}.`));
        }
      });
    });
    return key;
  }, filter);
}

export async function waitForChange(actor, subscription, predicate, timeout = 15_000) {
  const handle = await actor.page.waitForFunction(({ subscriptionKey, expected }) => {
    const state = window.__aureRelicsQaSubscriptions?.get(subscriptionKey)?.state;
    return state?.events.find(event => Object.entries(expected).every(([key, value]) => event.new?.[key] === value));
  }, { subscriptionKey: subscription, expected: predicate }, { timeout });
  return handle.jsonValue();
}

export async function closeSubscription(actor, subscription) {
  await actor.page.evaluate(async subscriptionKey => {
    const subscriptions = window.__aureRelicsQaSubscriptions;
    const active = subscriptions?.get(subscriptionKey);
    if (!active) return;
    await active.channel.unsubscribe();
    subscriptions.delete(subscriptionKey);
  }, subscription);
}