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

export async function startProductionSession(actor, sessionId) {
  return actor.page.evaluate(async targetSession => {
    const [{ getSupabaseClient }, { createSyncEngine }, { createSupabaseSyncAdapter }, { createSessionLifecycle }] = await Promise.all([
      import('/src/supabase/client.js'),
      import('/src/realtime/engine.js'),
      import('/src/realtime/supabaseAdapter.js'),
      import('/src/realtime/sessionLifecycle.js'),
    ]);
    const key = crypto.randomUUID();
    const runtimes = window.__aureRelicsQaRuntimes ??= new Map();
    const state = { snapshots: [], statuses: [], errors: [], currentSnapshot: null };
    const client = getSupabaseClient();
    const engine = createSyncEngine(createSupabaseSyncAdapter(client));
    const lifecycle = createSessionLifecycle(engine, {
      onSnapshot(snapshot) {
        state.snapshots.push(snapshot);
        state.currentSnapshot = snapshot;
      },
      onStatus(status, detail) {
        state.statuses.push({ status, detail: detail?.error ? { code: detail.error.code, message: detail.error.message } : null });
        if (status === 'denied') state.currentSnapshot = null;
      },
      onError(error) { state.errors.push({ code: error.code, message: error.message }); },
      periodicHydrateMs: 60_000,
    });
    runtimes.set(key, { client, engine, lifecycle, state, sessionId: targetSession });
    lifecycle.start(targetSession);
    return key;
  }, sessionId);
}

export async function waitForLifecycleStatus(actor, runtime, status, timeout = 15_000) {
  try {
    await actor.page.waitForFunction(({ runtimeKey, expectedStatus }) => {
      const state = window.__aureRelicsQaRuntimes?.get(runtimeKey)?.state;
      return state?.statuses.some(entry => entry.status === expectedStatus);
    }, { runtimeKey: runtime, expectedStatus: status }, { timeout });
  } catch (error) {
    const observed = await actor.page.evaluate(runtimeKey => {
      const state = window.__aureRelicsQaRuntimes?.get(runtimeKey)?.state;
      return state ? { statuses: state.statuses, errors: state.errors } : null;
    }, runtime);
    throw new Error(`Realtime lifecycle did not reach ${status}: ${JSON.stringify(observed)}`, { cause: error });
  }
}

export async function waitForCharacterSnapshot(actor, runtime, characterId, hp, timeout = 15_000) {
  const handle = await actor.page.waitForFunction(({ runtimeKey, expectedCharacter, expectedHp }) => {
    const state = window.__aureRelicsQaRuntimes?.get(runtimeKey)?.state;
    return state?.snapshots.find(snapshot => snapshot.characters?.some(character => character.id === expectedCharacter && character.hp === expectedHp));
  }, { runtimeKey: runtime, expectedCharacter: characterId, expectedHp: hp }, { timeout });
  return handle.jsonValue();
}

export async function lifecycleState(actor, runtime) {
  return actor.page.evaluate(runtimeKey => {
    const active = window.__aureRelicsQaRuntimes?.get(runtimeKey);
    if (!active) return null;
    return {
      status: active.lifecycle.getStatus(),
      appliedRevision: active.engine.getAppliedRevision(),
      observedRevision: active.engine.getObservedRevision(),
      currentSnapshot: active.state.currentSnapshot,
      errors: active.state.errors,
      channelCount: active.engine.getStatus() === 'denied' ? active.client.getChannels().length : null,
    };
  }, runtime);
}

export async function forceLifecycleHydrate(actor, runtime) {
  await actor.page.evaluate(async runtimeKey => {
    const active = window.__aureRelicsQaRuntimes?.get(runtimeKey);
    await active?.engine.hydrate(active.sessionId).catch(() => {});
  }, runtime);
}

export async function stopProductionSession(actor, runtime) {
  await actor.page.evaluate(runtimeKey => {
    const runtimes = window.__aureRelicsQaRuntimes;
    const active = runtimes?.get(runtimeKey);
    if (!active) return;
    active.lifecycle.stop();
    runtimes.delete(runtimeKey);
  }, runtime);
}

export async function observeSessionInvalidations(actor, sessionId) {
  return actor.page.evaluate(async targetSession => {
    const { getSupabaseClient } = await import('/src/supabase/client.js');
    const key = crypto.randomUUID();
    const observers = window.__aureRelicsQaInvalidations ??= new Map();
    const state = { events: [], statuses: [] };
    const channel = getSupabaseClient()
      .channel(`aure-relics-qa-invalidation-${key}`, { config: { postgres_changes_options: { wait: true, timeout: 15_000 } } })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'session_events', filter: `session_id=eq.${targetSession}`,
      }, payload => state.events.push(payload.new));

    observers.set(key, { channel, state });
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
  }, sessionId);
}

export async function waitForInvalidation(actor, subscription, timeout = 15_000) {
  const handle = await actor.page.waitForFunction(subscriptionKey => {
    return window.__aureRelicsQaInvalidations?.get(subscriptionKey)?.state.events.at(-1);
  }, subscription, { timeout });
  return handle.jsonValue();
}

export async function closeInvalidationObserver(actor, subscription) {
  await actor.page.evaluate(async subscriptionKey => {
    const observers = window.__aureRelicsQaInvalidations;
    const active = observers?.get(subscriptionKey);
    if (!active) return;
    await active.channel.unsubscribe();
    observers.delete(subscriptionKey);
  }, subscription);
}