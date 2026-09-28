import { execFileSync } from 'node:child_process';
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

export async function openPlayerScreen(actor, sessionId) {
  await actor.page.goto(`/#play/${sessionId}`);
  await expect(actor.page.locator('#playerBoardPanel')).toBeVisible();
}

export async function expectNoDmProjection(actor, panelSelector = '#playerBoardPanel') {
  await expect(actor.page.locator(`${panelSelector} .realtime-dm-section`)).toHaveCount(0);
  await expect(actor.page.locator(
    `${panelSelector} [data-realtime-action="advance-round"], ` +
    `${panelSelector} [data-realtime-action="toggle-token-visible"], ` +
    `${panelSelector} [data-realtime-action="clear-initiative"]`
  )).toHaveCount(0);
}

export async function togglePresentationMode(actor) {
  const wasVisible = await actor.page.locator('#dmPreviewPanel').isVisible().catch(() => false);
  await actor.page.locator('.dm-presentation-toggle').click();
  if (wasVisible) await expect(actor.page.locator('#dmPreviewPanel')).toBeHidden();
  else await expect(actor.page.locator('#dmPreviewPanel')).toBeVisible();
}

export async function channelCount(actor) {
  return actor.page.evaluate(async () => {
    const { getSupabaseClient } = await import('/src/supabase/client.js');
    return getSupabaseClient().getChannels().length;
  });
}

// --- Issue #10 Task 7: additive fog QA helpers ------------------------------------------------
//
// v0.9 has no production UI or RPC path to create a `public.levels` row, set a session's
// `active_level_id`, or place a `public.tokens` row (the same precondition
// `visibility.spec.js` already documents for tokens; Issue #13 owns the future level-authoring
// workflow). `public.locations`/`public.levels` also carry no INSERT policy for any client role,
// and `service_role` itself is never granted direct table access in this project's migrations
// (confirmed empirically: a service-role REST insert is rejected with Postgres `42501`) — the app
// deliberately funnels every real write through `mutate_session`. These fixture helpers instead
// shell out to the local Postgres superuser via the already-installed `supabase` CLI's own
// `db query --local` (no new dependency, and the same binary `local-stack.mjs` already spawns for
// `status`), solely to seed rows no in-app flow/grant can create yet. This runs only from Node,
// never from a page/browser context. Every fog *mutation* and every projection assertion below
// still goes through the real authenticated app/RPC surface; only fixture setup is short-circuited.

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSql(sql) {
  const stdout = execFileSync(process.execPath,
    ['node_modules/supabase/dist/supabase.js', 'db', 'query', '--local', sql, '--output', 'json'],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(stdout).rows;
}

/** Create a location + level for `room.hosted.campaign` and make it the session's active level,
 * so the session snapshot's top-level `fog` and manager `dm.fog` populate exactly as
 * `private.session_projection` defines (both require `sessions.active_level_id` to be non-null).
 * Also sets `sessions.status = 'active'` by default (`activateSession`): v0.9 has no production
 * flow that transitions a session out of 'lobby' either, and without it `publicVisible`/token rows
 * can never reach a player regardless of fog, which would make the Task 7 object-disclosure
 * scenario vacuously true rather than a real check of the fog/disclosure boundary. Returns the
 * created ids; the campaign-cascade delete in `fixtures.js` teardown removes the location/level/
 * fog rows automatically, so this helper needs no separate cleanup. */
export async function createFogLevel(room, { width = 20, height = 20, name = 'Fog QA Level', activateSession = true } = {}) {
  const [location] = runSql(`insert into public.locations(campaign_id,name) values(${sqlLiteral(room.hosted.campaign)},${sqlLiteral(`${name} Location`)}) returning id;`);
  const [level] = runSql(`insert into public.levels(campaign_id,location_id,name,grid_width,grid_height) values(${sqlLiteral(room.hosted.campaign)},${sqlLiteral(location.id)},${sqlLiteral(name)},${width},${height}) returning id;`);
  runSql(`update public.sessions set active_level_id=${sqlLiteral(level.id)}${activateSession ? ",status='active'" : ''} where id=${sqlLiteral(room.hosted.session)} returning id;`);
  return { locationId: location.id, levelId: level.id, width, height };
}

/** Create a second level in the same location, deliberately left off the session's active-level
 * pointer (v0.9 has no level-switcher UI at all — design §11's "backend supports authorized
 * mutations against any valid campaign level" is a backend-only contract in this release). Used
 * only for the non-presented-level isolation scenario. */
export async function createExtraLevel(room, level, { width = 20, height = 20, name = 'Unpresented QA Level' } = {}) {
  const [extra] = runSql(`insert into public.levels(campaign_id,location_id,name,grid_width,grid_height) values(${sqlLiteral(room.hosted.campaign)},${sqlLiteral(level.locationId)},${sqlLiteral(name)},${width},${height}) returning id;`);
  return { locationId: level.locationId, levelId: extra.id, width, height };
}

/** Count `public.session_events` rows for `sessionId` — the direct, authoritative way to prove a
 * broad fog action fans out to a handful of recipient invalidations, never one row per cell. */
export async function countSessionEvents(sessionId) {
  const [row] = runSql(`select count(*)::int as count from public.session_events where session_id=${sqlLiteral(sessionId)};`);
  return row.count;
}

/** Insert a DM-hidden (`is_visible:false`) enemy token directly (see module note above: no
 * production path creates `public.tokens` rows yet). Used only to prove Disable Fog never
 * discloses a hidden object, through the real player-authorized snapshot/DOM. */
export async function insertHiddenToken(room, level, { x = 0, y = 0, label = 'Hidden Lurker' } = {}) {
  const [token] = runSql(`insert into public.tokens(campaign_id,level_id,kind,label,x,y,width,height,is_visible) values(${sqlLiteral(room.hosted.campaign)},${sqlLiteral(level.levelId)},'enemy',${sqlLiteral(label)},${x},${y},1,1,false) returning id;`);
  return token;
}

/** Read `#grid`'s live layout box and translate an authoritative fog cell into a client-space
 * pixel point, mirroring `fogEditor.js`'s own `pointToCell` inverse (`rect / fog.width|height`,
 * never the legacy board's own `--cell-size`/local cell count). Centers on the cell so brush
 * clipping/rounding at the cell's own edges never lands the pointer in a neighbor. */
export async function gridCellPoint(actor, fog, x, y) {
  const grid = actor.page.locator('#grid');
  await grid.scrollIntoViewIfNeeded(); // narrow viewport: keep the target inside real viewport pixels
  const rect = await grid.boundingBox();
  if (!rect) throw new Error('#grid has no live layout box');
  const cellWidth = rect.width / fog.width;
  const cellHeight = rect.height / fog.height;
  return { clientX: rect.x + (x + 0.5) * cellWidth, clientY: rect.y + (y + 0.5) * cellHeight };
}

/** Drive a real pointer drag stroke over the fog editor overlay: move to the first cell, press,
 * move through every subsequent cell (each as a real mouse move so the app's own genuine
 * `pointermove` handling runs, not a synthetic batch), then release. Callers observe DM-only
 * local preview and post-release commit around this call; this helper itself asserts nothing. */
export async function dragPaintCells(actor, fog, cells) {
  if (cells.length === 0) throw new Error('dragPaintCells requires at least one cell');
  const first = await gridCellPoint(actor, fog, cells[0][0], cells[0][1]);
  await actor.page.mouse.move(first.clientX, first.clientY);
  await actor.page.mouse.down();
  for (const [x, y] of cells.slice(1)) {
    const point = await gridCellPoint(actor, fog, x, y);
    await actor.page.mouse.move(point.clientX, point.clientY, { steps: 3 });
  }
  await actor.page.mouse.up();
}

/** One-cell convenience over `dragPaintCells`, for scenarios that only need a single committed
 * brush application (brush size 1). */
export async function clickPaintCell(actor, fog, x, y) {
  await dragPaintCells(actor, fog, [[x, y]]);
}

/** Read one pixel straight from the shared player fog canvas's own backing store
 * (`fogRenderer.js`'s `buildPlayerFogStage`: `canvas.width/height` are exactly the board's
 * `fog.width`/`fog.height`, one native pixel per cell) — never a page screenshot, so CSS
 * upscaling/antialiasing never enters this read. Returns `null` if the stage/canvas is absent. */
export async function readPlayerFogPixel(actor, x, y) {
  return actor.page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('.fog-player-canvas');
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    return Array.from(context.getImageData(x, y, 1, 1).data);
  }, { x, y });
}

/** Structural facts about the real player fog stage: whether it exists, its canvas's own native
 * backing resolution (must equal `fog.width`x`fog.height`, never one element per cell), and the
 * total DOM node count inside the stage (must stay tiny/fixed regardless of board size). */
export async function playerFogStageInfo(actor) {
  return actor.page.evaluate(() => {
    const stage = document.querySelector('.fog-player-stage');
    if (!stage) return null;
    const canvas = stage.querySelector('.fog-player-canvas');
    return {
      nodeCount: stage.querySelectorAll('*').length,
      canvasWidth: canvas?.width ?? null,
      canvasHeight: canvas?.height ?? null,
    };
  });
}

/** Enter DM Fog Mode (idempotent) and return the fog controller root locator, so scenario code
 * can act on toolbar controls scoped under `[data-fog-controller]`. */
export async function activateFogMode(dm) {
  const root = dm.page.locator('[data-fog-controller]');
  await expect(root).toBeVisible();
  const toggle = root.locator('[data-fog-action="toggle-fog-mode"]');
  if ((await toggle.textContent())?.trim() === 'Enter Fog Mode') await toggle.click();
  await expect(toggle).toHaveText('Exit Fog Mode');
  return root;
}

/** Count real `mutate_session` RPC POSTs observed on `actor`'s page during `run()`, so a
 * scenario can assert "one logical mutation" for a whole stroke/broad action rather than
 * inferring it indirectly. */
export async function countMutateSessionCalls(actor, run) {
  let count = 0;
  const listener = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/rpc/mutate_session') count += 1;
  };
  actor.page.on('request', listener);
  try {
    await run();
  } finally {
    actor.page.off('request', listener);
  }
  return count;
}

/** Freeze `actor`'s applied snapshot at its current content: every future
 * `get_session_snapshot` RPC call from this page (however triggered — the periodic timer, a
 * focus event, or `mutateWithConflictRecovery`'s own post-conflict rehydrate) receives this same
 * frozen response instead of the server's true current state, so `engine`'s
 * `ctx.appliedRevision` can never advance while frozen. Never touches the realtime websocket
 * itself (it keeps delivering real invalidation events undisturbed — this only intercepts what
 * the client learns from *acting* on one) and never aborts/errors a request (always a normal `200`
 * fulfil), so it produces none of the console/network noise a real transport failure would and
 * cannot trip `fixtures.js`'s strict unexpected-failure monitoring. This deterministically
 * reproduces "a DM window that fell behind" without weakening the real authorization/conflict
 * code path on either side of it.
 *
 * Must be called only after `actor` has already hydrated at least once for `sessionId` (its
 * current state becomes the frozen content). Returns `unfreeze()`, which removes the route so the
 * next hydrate this page performs (e.g. after a `focus` event, mirroring the existing revocation
 * test's pattern in `visibility.spec.js`) fetches the true current server state again. */
export async function freezeSnapshot(actor, sessionId) {
  const { data, error } = await actor.page.evaluate(async targetSession => {
    const { getSupabaseClient } = await import('/src/supabase/client.js');
    return getSupabaseClient().rpc('get_session_snapshot', { p_session: targetSession });
  }, sessionId);
  if (error) throw error;
  const pattern = '**/rest/v1/rpc/get_session_snapshot';
  const handler = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  await actor.page.route(pattern, handler);
  return async () => actor.page.unroute(pattern, handler);
}

/** Force `actor`'s realtime lifecycle to hydrate right now, the same way returning focus to a
 * real tab does (`sessionLifecycle.js`'s own focus listener calls `engine.hydrate()`), and wait
 * for that specific network round trip to finish before returning. */
export async function forceHydrateViaFocus(actor) {
  const hydrated = actor.page.waitForResponse(response =>
    response.url().includes('/rest/v1/rpc/get_session_snapshot') && response.ok());
  await actor.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await hydrated;
}