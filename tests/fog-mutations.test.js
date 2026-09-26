import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSyncEngine } from '../src/realtime/engine.js';
import { createFakeAdapter } from '../src/realtime/fakeAdapter.js';
import { createFogMutationBridge } from '../src/fog/fogMutations.js';

const session = '33333333-3333-4333-8333-333333333333';
const levelId = '44444444-4444-4444-8444-444444444444';
const snap = revision => ({ sessionId: session, revision });
const flush = () => new Promise(resolve => setImmediate(resolve));

async function buildReadyEngine(appliedRevision = '1') {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => snap(appliedRevision));
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  return { engine, adapter };
}

// --- mutation payload construction: exact command/payload per docs/superpowers/plans/2026-09-25-issue-10-fog-of-war.md ---

test('every fog command sends exactly the documented type/payload; expectedRevision is attached by the engine, not the bridge', async () => {
  const { engine, adapter } = await buildReadyEngine('9');
  adapter.setMutateResult(async (id, command) => ({ command }));
  const bridge = createFogMutationBridge(engine);

  await bridge.paint(session, { levelId, mode: 'reveal', cells: [[1, 2], [3, 4]] });
  await bridge.createArea(session, { levelId, name: 'Starting Room', cells: [[0, 0]], revealedByDefault: true });
  await bridge.updateArea(session, { levelId, areaId: 'area-1', name: 'Renamed', cells: [[0, 0], [1, 0]], revealedByDefault: false });
  await bridge.deleteArea(session, { levelId, areaId: 'area-1' });
  await bridge.setAreaVisibility(session, { levelId, areaId: 'area-1', revealed: true });
  await bridge.revealAll(session, { levelId });
  await bridge.hideAll(session, { levelId });
  await bridge.resetDefaults(session, { levelId });
  await bridge.setCampaignEnabled(session, { enabled: false });
  await bridge.setLocationOverride(session, { locationId: 'loc-1', enabled: null });
  await bridge.setLevelOverride(session, { levelId, enabled: true });

  const sent = adapter.calls.mutate.map(c => c.command);
  assert.deepEqual(sent, [
    { schemaVersion: 1, type: 'fog.paint', expectedRevision: '9', payload: { levelId, mode: 'reveal', cells: [[1, 2], [3, 4]] } },
    { schemaVersion: 1, type: 'fog.area.create', expectedRevision: '9', payload: { levelId, name: 'Starting Room', cells: [[0, 0]], revealedByDefault: true } },
    { schemaVersion: 1, type: 'fog.area.update', expectedRevision: '9', payload: { levelId, areaId: 'area-1', name: 'Renamed', cells: [[0, 0], [1, 0]], revealedByDefault: false } },
    { schemaVersion: 1, type: 'fog.area.delete', expectedRevision: '9', payload: { levelId, areaId: 'area-1' } },
    { schemaVersion: 1, type: 'fog.area.setVisibility', expectedRevision: '9', payload: { levelId, areaId: 'area-1', revealed: true } },
    { schemaVersion: 1, type: 'fog.revealAll', expectedRevision: '9', payload: { levelId } },
    { schemaVersion: 1, type: 'fog.hideAll', expectedRevision: '9', payload: { levelId } },
    { schemaVersion: 1, type: 'fog.resetDefaults', expectedRevision: '9', payload: { levelId } },
    { schemaVersion: 1, type: 'fog.setCampaignEnabled', expectedRevision: '9', payload: { enabled: false } },
    { schemaVersion: 1, type: 'fog.setLocationOverride', expectedRevision: '9', payload: { locationId: 'loc-1', enabled: null } },
    { schemaVersion: 1, type: 'fog.setLevelOverride', expectedRevision: '9', payload: { levelId, enabled: true } },
  ]);
});

test('no fog command payload carries an extra key beyond what the backend command validator accepts', async () => {
  const { engine, adapter } = await buildReadyEngine('1');
  adapter.setMutateResult(async (id, command) => ({ command }));
  const bridge = createFogMutationBridge(engine);

  const expectedKeys = {
    paint: ['levelId', 'mode', 'cells'],
    createArea: ['levelId', 'name', 'cells', 'revealedByDefault'],
    updateArea: ['levelId', 'areaId', 'name', 'cells', 'revealedByDefault'],
    deleteArea: ['levelId', 'areaId'],
    setAreaVisibility: ['levelId', 'areaId', 'revealed'],
    revealAll: ['levelId'],
    hideAll: ['levelId'],
    resetDefaults: ['levelId'],
    setCampaignEnabled: ['enabled'],
    setLocationOverride: ['locationId', 'enabled'],
    setLevelOverride: ['levelId', 'enabled'],
  };
  const args = {
    levelId, mode: 'hide', cells: [[0, 0]], name: 'Area', revealedByDefault: true,
    areaId: 'area-1', revealed: false, enabled: true, locationId: 'loc-1',
  };

  for (const [method, keys] of Object.entries(expectedKeys)) {
    await bridge[method](session, args);
    const { payload } = adapter.calls.mutate.at(-1).command;
    assert.deepEqual(Object.keys(payload).sort(), [...keys].sort(), method);
  }
});

// --- expected revision propagation / exact decimal-string preservation ------------------------

test('expectedRevision propagates as the exact decimal string, never coerced through Number', async () => {
  const beyondSafeInteger = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2; rounds if coerced
  const { engine, adapter } = await buildReadyEngine(beyondSafeInteger);
  adapter.setMutateResult(async (id, command) => ({ command }));
  const bridge = createFogMutationBridge(engine);

  await bridge.revealAll(session, { levelId });

  const { expectedRevision } = adapter.calls.mutate.at(-1).command;
  assert.equal(typeof expectedRevision, 'string');
  assert.equal(expectedRevision, beyondSafeInteger);
});

// --- stale/conflict result handling + no automatic replay --------------------------------------

test('a 40001 stale-revision conflict rehydrates exactly once, surfaces as ok:false, and never replays the mutation', async () => {
  const { engine, adapter } = await buildReadyEngine('1');
  const conflict = Object.assign(new Error('stale revision'), { code: '40001' });
  adapter.setMutateResult(async () => { throw conflict; });
  const bridge = createFogMutationBridge(engine);
  const hydrateCallsBefore = adapter.calls.hydrate.length;

  const outcome = await bridge.paint(session, { levelId, mode: 'reveal', cells: [[0, 0]] });

  assert.deepEqual(outcome, { ok: false, conflict: true, error: conflict });
  assert.equal(adapter.calls.mutate.length, 1); // never retried
  assert.equal(adapter.calls.hydrate.length, hydrateCallsBefore + 1); // exactly one recovery hydrate
});

test('a 40P01 aborted-transaction conflict rehydrates and is never reported as success', async () => {
  const { engine, adapter } = await buildReadyEngine('1');
  const aborted = Object.assign(new Error('deadlock detected'), { code: '40P01' });
  adapter.setMutateResult(async () => { throw aborted; });
  const bridge = createFogMutationBridge(engine);
  const hydrateCallsBefore = adapter.calls.hydrate.length;

  const outcome = await bridge.hideAll(session, { levelId });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.conflict, true);
  assert.equal(adapter.calls.mutate.length, 1);
  assert.equal(adapter.calls.hydrate.length, hydrateCallsBefore + 1);
});

test('a non-manager (42501) rejection is propagated unchanged, never suppressed or retried', async () => {
  const { engine, adapter } = await buildReadyEngine('1');
  const denied = Object.assign(new Error('not authorized'), { code: '42501' });
  adapter.setMutateResult(async () => { throw denied; });
  const bridge = createFogMutationBridge(engine);

  const outcome = await bridge.setCampaignEnabled(session, { enabled: true });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.conflict, false);
  assert.equal(outcome.error, denied);
  assert.equal(adapter.calls.mutate.length, 1);
});

test('a failed/conflicted fog mutation never fabricates authoritative fog state locally', async () => {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => ({ sessionId: session, revision: '1', fog: { levelId, width: 4, height: 4, enabled: true, revealedRuns: [] } }));
  const engine = createSyncEngine(adapter);
  const snapshots = [];
  engine.subscribe(session, { onSnapshot: s => snapshots.push(s) });
  await flush();
  assert.equal(snapshots.length, 1);

  const conflict = Object.assign(new Error('stale revision'), { code: '40001' });
  adapter.setMutateResult(async () => { throw conflict; });
  const bridge = createFogMutationBridge(engine);

  const outcome = await bridge.paint(session, { levelId, mode: 'reveal', cells: [[0, 0]] });
  await flush();

  assert.equal(outcome.conflict, true);
  // Still exactly the one real snapshot ever delivered: the intended reveal was never invented locally.
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].fog.revealedRuns, []);
  assert.equal(engine.getAppliedRevision(), '1');
});

test('a successful fog mutation resolves with exactly the backend result, never something synthesized locally', async () => {
  const { engine, adapter } = await buildReadyEngine('1');
  const backendResult = { schemaVersion: 1, sessionId: session, revision: '2', fog: { levelId, width: 4, height: 4, enabled: true, revealedRuns: [[0, 0, 1]] } };
  adapter.setMutateResult(async () => backendResult);
  const bridge = createFogMutationBridge(engine);

  const outcome = await bridge.paint(session, { levelId, mode: 'reveal', cells: [[0, 0]] });

  assert.deepEqual(outcome, { ok: true, result: backendResult });
});

// --- no direct Supabase/table-write path inside the fog bridge ---------------------------------

test('the fog mutation bridge has no direct Supabase client, second realtime lifecycle, or canonical fog-table write path', () => {
  const source = readFileSync('src/fog/fogMutations.js', 'utf8');
  assert.doesNotMatch(source, /supabase-js/i);
  assert.doesNotMatch(source, /createClient/);
  assert.doesNotMatch(source, /\bfrom\(['"`]fog_cells['"`]\)/);
  assert.doesNotMatch(source, /\bfrom\(['"`]fog_areas['"`]\)/);
  assert.doesNotMatch(source, /channel\(/);
  assert.doesNotMatch(source, /new WebSocket/);
  assert.match(source, /import \{ mutateWithConflictRecovery \} from '\.\.\/realtime\/mutationBridge\.js';/);
});

test('offline/local mode is structurally unaffected: nothing in the local entry point imports the fog mutation bridge', () => {
  for (const file of ['src/main.js', 'src/app/legacyBootstrap.js']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /fogMutations/, `${file} must not import the fog mutation bridge`);
  }
});
