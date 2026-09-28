import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSyncEngine } from '../src/realtime/engine.js';
import { createFakeAdapter } from '../src/realtime/fakeAdapter.js';
import { createFogController } from '../src/fog/fogController.js';

const SOURCE_PATH = 'src/fog/fogController.js';
const session = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const levelId = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';
const otherLevelId = 'cccccccc-3333-4ccc-8ccc-cccccccccccc';
const locationId = 'dddddddd-4444-4ddd-8ddd-dddddddddddd';
const flush = () => new Promise(resolve => setImmediate(resolve));

// --- fixtures ------------------------------------------------------------------------------

function fogProjection(overrides = {}) {
  return { levelId, width: 20, height: 20, enabled: true, revealedRuns: [], ...overrides };
}

function fogManagerState(overrides = {}) {
  return {
    campaignEnabled: true,
    locationId,
    locationOverride: null,
    levelOverride: null,
    effectiveEnabled: true,
    initialized: true,
    areas: [],
    levelRevisions: [{ levelId, revision: '1' }],
    ...overrides,
  };
}

function managerView(overrides = {}) {
  return {
    sessionId: session,
    revision: '1',
    session: { id: session, name: 'Session', status: 'active', activeLevelId: levelId },
    roundNumber: 1,
    authority: { canManage: true, ownCharacterId: null },
    tokens: [],
    characters: [],
    initiative: [],
    dm: { fog: fogManagerState(), tokenDetails: [], notes: [], activity: [] },
    fog: fogProjection(),
    ...overrides,
  };
}

function playerView(overrides = {}) {
  return {
    sessionId: session,
    revision: '1',
    session: { id: session, name: 'Session', status: 'active', activeLevelId: levelId },
    roundNumber: 1,
    authority: { canManage: false, ownCharacterId: null },
    tokens: [],
    characters: [],
    initiative: [],
    dm: null,
    fog: fogProjection(),
    ...overrides,
  };
}

async function buildReadyEngine(appliedRevision = '1') {
  const adapter = createFakeAdapter();
  adapter.setHydrateResult(async () => ({ sessionId: session, revision: appliedRevision }));
  const engine = createSyncEngine(adapter);
  engine.subscribe(session, {});
  await flush();
  return { engine, adapter };
}

function buildBoard({ width = 20, height = 20, cellSize = 20 } = {}) {
  const dom = new JSDOM('<!doctype html><div class="grid-frame"><div id="grid"></div></div><div id="sidebar"></div>');
  const { window } = dom;
  const frame = window.document.querySelector('.grid-frame');
  const grid = window.document.getElementById('grid');
  const host = window.document.getElementById('sidebar');

  frame.getBoundingClientRect = () => ({ left: 0, top: 0, right: width * cellSize, bottom: height * cellSize, width: width * cellSize, height: height * cellSize });
  grid.getBoundingClientRect = () => ({ left: 0, top: 0, right: width * cellSize, bottom: height * cellSize, width: width * cellSize, height: height * cellSize });

  return { dom, window, frame, grid, host, cellSize };
}

function pointerEvent(win, type, { clientX = 0, clientY = 0, button = 0, pointerId = 1 } = {}) {
  const event = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

function clientPointFor(cellSize, x, y) {
  return { clientX: x * cellSize + cellSize / 2, clientY: y * cellSize + cellSize / 2 };
}

function drag(window, canvas, cellSize, cells) {
  const [first, ...rest] = cells;
  canvas.dispatchEvent(pointerEvent(window, 'pointerdown', clientPointFor(cellSize, ...first)));
  for (const cell of rest) canvas.dispatchEvent(pointerEvent(window, 'pointermove', clientPointFor(cellSize, ...cell)));
}

function release(window, canvas, cellSize, cell) {
  canvas.dispatchEvent(pointerEvent(window, 'pointerup', clientPointFor(cellSize, ...cell)));
}

function confirmSpy(result = true) {
  const calls = [];
  const fn = request => { calls.push(request); return result; };
  fn.calls = calls;
  return fn;
}

function deferred() {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
}

/** A confirmAction double that never resolves on its own: each call gets its own deferred promise,
 * collected in `deferreds` in call order, so a test can resolve exactly the confirmation it means
 * to (10F-FIX1 defect 3 duplicate-action-guard tests). */
function deferredConfirmSpy() {
  const calls = [];
  const deferreds = [];
  const fn = request => {
    calls.push(request);
    const d = deferred();
    deferreds.push(d);
    return d.promise;
  };
  fn.calls = calls;
  fn.deferreds = deferreds;
  return fn;
}

function resultSpy() {
  const calls = [];
  const fn = result => calls.push(result);
  fn.calls = calls;
  return fn;
}

/** Standard harness: real engine + fake adapter, a JSDOM board/host pair, and a view holder that
 * mirrors how app.js keeps `realtimeBoardView` and its `getView` closure in sync — every
 * `setView(view)` call updates both what `getView()` returns and what `controller.render()` sees,
 * exactly as `renderCurrent()` in app.js does for `realtimeBoardView`. */
function buildHarness({ appliedRevision = '1', confirmResult = true, confirmAction: confirmActionOverride } = {}) {
  return (async () => {
    const { engine, adapter } = await buildReadyEngine(appliedRevision);
    const { window, frame, grid, host, cellSize } = buildBoard();
    let currentView = null;
    const getSessionId = () => session;
    const getView = () => currentView;
    const confirmAction = confirmActionOverride ?? confirmSpy(confirmResult);
    const onResult = resultSpy();
    const controller = createFogController({ engine, getSessionId, getView, frame, grid, host, confirmAction, onResult });
    function setView(view) {
      currentView = view;
      controller.render(view);
    }
    return { engine, adapter, window, frame, grid, host, cellSize, controller, setView, confirmAction, onResult, getView };
  })();
}

function paintCommands(adapter) {
  return adapter.calls.mutate.filter(c => c.command.type === 'fog.paint');
}

function commandsOfType(adapter, type) {
  return adapter.calls.mutate.filter(c => c.command.type === type);
}

// --- structural guarantees -------------------------------------------------------------------

test('structural guarantee: fogController.js never creates a second realtime engine, adapter, subscription, or Supabase client', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  // A JSDoc type reference to createSyncEngine's return type (documenting the injected `engine`
  // param, exactly like fogMutations.js already does) is fine; actually importing or calling it
  // to build a second engine is not.
  assert.doesNotMatch(source, /import \{[^}]*createSyncEngine[^}]*\}/);
  assert.doesNotMatch(source, /\bcreateSyncEngine\(/);
  const forbidden = ['createSupabaseSyncAdapter', 'createSessionLifecycle', 'getSupabaseClient', 'createClient', 'supabase-js', '.subscribe(', 'new WebSocket', 'channel('];
  for (const token of forbidden) {
    assert.ok(!source.includes(token), `${SOURCE_PATH} must not reference "${token}"`);
  }
});

test('structural guarantee: fogController.js composes createFogMutationBridge and createFogEditor rather than reimplementing them', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  assert.match(source, /import \{ createFogMutationBridge \} from '\.\/fogMutations\.js';/);
  assert.match(source, /import \{ createFogEditor \} from '\.\/fogEditor\.js';/);
});

// --- Fog controls render only for manager views -------------------------------------------------

test('Fog controls render only for manager views: hidden/absent for a player-shaped view, visible for a manager view', async () => {
  const { host, controller, setView } = await buildHarness();
  controller.activate();

  setView(playerView());
  let root = host.querySelector('[data-fog-controller]');
  assert.ok(!root || root.hidden, 'no visible fog controller content for a non-manager view');

  setView(managerView());
  root = host.querySelector('[data-fog-controller]');
  assert.ok(root, 'fog controller root must exist for a manager view');
  assert.equal(root.hidden, false);
  assert.ok(root.querySelector('[data-fog-action="toggle-fog-mode"]'));
});

test('render(null) (denied) hides fog controls and never throws', async () => {
  const { host, controller, setView } = await buildHarness();
  controller.activate();
  setView(managerView());
  assert.doesNotThrow(() => setView(null));
  const root = host.querySelector('[data-fog-controller]');
  assert.ok(!root || root.hidden);
});

// --- toolbar exposes the required controls ------------------------------------------------------

test('toolbar exposes Reveal/Hide, brush sizes 1/2/3/5, overlay opacity, named areas, Reveal All, Hide All, Reset, and inheritance settings', async () => {
  const { host, controller, setView } = await buildHarness();
  controller.activate();
  setView(managerView());
  const root = host.querySelector('[data-fog-controller]');

  assert.ok(root.querySelector('[data-fog-action="tool-reveal"]'));
  assert.ok(root.querySelector('[data-fog-action="tool-hide"]'));
  for (const size of [1, 2, 3, 5]) assert.ok(root.querySelector(`[data-fog-action="brush-${size}"]`), `brush ${size} control`);
  assert.ok(root.querySelector('[data-fog-field="opacity"]'));
  assert.ok(root.querySelector('[data-fog-action="new-area"]'));
  assert.ok(root.querySelector('[data-fog-action="reveal-all"]'));
  assert.ok(root.querySelector('[data-fog-action="hide-all"]'));
  assert.ok(root.querySelector('[data-fog-action="reset"]'));
  assert.ok(root.querySelector('[data-fog-action="enable-campaign"]'));
  assert.ok(root.querySelector('[data-fog-action="disable-campaign"]'));
  assert.ok(root.querySelector('[data-fog-field="location-override"]'));
  assert.ok(root.querySelector('[data-fog-field="level-override"]'));
});

// --- Reveal tool / Hide tool / brush sizes --------------------------------------------------------

test('Reveal tool and Hide tool set the editor mode used by the next stroke', async () => {
  const { window, host, frame, grid, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  root.querySelector('[data-fog-action="tool-hide"]').click();
  drag(window, canvas, cellSize, [[2, 2]]);
  release(window, canvas, cellSize, [2, 2]);
  await flush();
  assert.equal(paintCommands(adapter).at(-1).command.payload.mode, 'hide');

  root.querySelector('[data-fog-action="tool-reveal"]').click();
  drag(window, canvas, cellSize, [[3, 3]]);
  release(window, canvas, cellSize, [3, 3]);
  await flush();
  assert.equal(paintCommands(adapter).at(-1).command.payload.mode, 'reveal');
});

test('brush sizes 1, 2, 3, and 5 are wired to the editor brush and affect the painted stroke footprint', async () => {
  const { window, host, frame, grid, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  root.querySelector('[data-fog-action="brush-3"]').click();
  drag(window, canvas, cellSize, [[10, 10]]);
  release(window, canvas, cellSize, [10, 10]);
  await flush();
  assert.equal(paintCommands(adapter).at(-1).command.payload.cells.length, 9); // 3x3
});

// --- overlay opacity -------------------------------------------------------------------------

test('overlay opacity control forwards to the editor without error and without mutating anything', async () => {
  const { window, host, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  const root = host.querySelector('[data-fog-controller]');
  const opacity = root.querySelector('[data-fog-field="opacity"]');
  opacity.value = '0.4';
  opacity.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(adapter.calls.mutate.length, 0);
});

// --- one completed live stroke calls fog.paint exactly once ---------------------------------------

test('one completed live stroke calls fog.paint exactly once, with the explicit stroke levelId', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
  release(window, canvas, cellSize, [1, 5]);
  await flush();

  const calls = paintCommands(adapter);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.payload.levelId, levelId);
  assert.deepEqual(calls[0].command.payload.cells, [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
});

test('no mutation during pointer movement: only pointerup triggers fog.paint, never pointermove', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  await flush();
  assert.equal(adapter.calls.mutate.length, 0, 'no mutation before release');

  release(window, canvas, cellSize, [3, 0]);
  await flush();
  assert.equal(paintCommands(adapter).length, 1, 'exactly one mutation after release');
});

test('a long multi-cell drag is still exactly one mutation opportunity, never one request per cell', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  const cells = Array.from({ length: 15 }, (_, i) => [i, 0]);
  drag(window, canvas, cellSize, cells);
  release(window, canvas, cellSize, [14, 0]);
  await flush();

  assert.equal(paintCommands(adapter).length, 1);
  assert.equal(paintCommands(adapter)[0].command.payload.cells.length, 15);
});

// --- conflicted/failed stroke discards local preview and returns to authoritative state --------------

test('a conflicted stroke rehydrates exactly once, is never retried, and reports conflict via onResult', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter, onResult } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  const conflict = Object.assign(new Error('stale revision'), { code: '40001' });
  adapter.setMutateResult(async () => { throw conflict; });
  const hydrateCallsBefore = adapter.calls.hydrate.length;

  drag(window, canvas, cellSize, [[5, 5]]);
  release(window, canvas, cellSize, [5, 5]);
  await flush();

  assert.equal(paintCommands(adapter).length, 1, 'never retried');
  assert.equal(adapter.calls.hydrate.length, hydrateCallsBefore + 1, 'exactly one recovery hydrate');
  const report = onResult.calls.find(r => r.type === 'fog.paint');
  assert.equal(report.ok, false);
  assert.equal(report.conflict, true);
});

test('after a conflict, a fresh render(view) with new authoritative fog is accepted without error, and a new stroke still works normally', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  const conflict = Object.assign(new Error('stale revision'), { code: '40001' });
  adapter.setMutateResult(async () => { throw conflict; });
  drag(window, canvas, cellSize, [[5, 5]]);
  release(window, canvas, cellSize, [5, 5]);
  await flush();

  // Authoritative rehydration arrives (as app.js would deliver through the normal snapshot path).
  adapter.setMutateResult(async (id, command) => ({ command }));
  assert.doesNotThrow(() => setView(managerView({ fog: fogProjection({ revealedRuns: [[5, 5, 6]] }) })));

  drag(window, canvas, cellSize, [[9, 9]]);
  release(window, canvas, cellSize, [9, 9]);
  await flush();
  assert.equal(paintCommands(adapter).length, 2, 'new stroke after recovery still commits normally');
});

// --- New Area / Edit Area: local until Save --------------------------------------------------------

test('New Area paints/selects cells locally and only creates the area on Save (fog.area.create), never live-painting fog', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="new-area"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[2, 2], [2, 3], [2, 4]]);
  release(window, canvas, cellSize, [2, 4]);
  await flush();

  assert.equal(adapter.calls.mutate.length, 0, 'painting/selecting an area never mutates live fog');

  root.querySelector('[data-fog-field="area-name"]').value = 'Starting Room';
  root.querySelector('[data-fog-field="area-name"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  root.querySelector('[data-fog-field="area-default"][value="revealed"]').checked = true;
  root.querySelector('[data-fog-field="area-default"][value="revealed"]').dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('[data-fog-action="area-save"]').click();
  await flush();

  const creates = commandsOfType(adapter, 'fog.area.create');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].command.payload.levelId, levelId);
  assert.equal(creates[0].command.payload.name, 'Starting Room');
  assert.equal(creates[0].command.payload.revealedByDefault, true);
  assert.deepEqual(creates[0].command.payload.cells.sort(), [[2, 2], [2, 3], [2, 4]]);
});

test('Edit Area loads the existing area selection and edits only local selection until Save (fog.area.update)', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  const area = { id: 'area-1', levelId, name: 'Old Name', cellRuns: [[0, 0, 2]], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ dm: { fog: fogManagerState({ areas: [area] }) } }));
  const root = host.querySelector('[data-fog-controller]');

  root.querySelector('[data-fog-action="area-edit"][data-area-id="area-1"]').click();
  assert.equal(root.querySelector('[data-fog-field="area-name"]').value, 'Old Name');

  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvas, cellSize, [[5, 5]]);
  release(window, canvas, cellSize, [5, 5]);
  await flush();
  assert.equal(adapter.calls.mutate.length, 0, 'editing selection never mutates until Save');

  root.querySelector('[data-fog-field="area-name"]').value = 'Renamed Room';
  root.querySelector('[data-fog-field="area-name"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  root.querySelector('[data-fog-action="area-save"]').click();
  await flush();

  const updates = commandsOfType(adapter, 'fog.area.update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].command.payload.areaId, 'area-1');
  assert.equal(updates[0].command.payload.name, 'Renamed Room');
  assert.ok(updates[0].command.payload.cells.some(([x, y]) => x === 5 && y === 5), 'newly painted cell included');
  assert.ok(updates[0].command.payload.cells.some(([x, y]) => x === 0 && y === 0), 'original loaded cell retained');
});

test('Cancel Area discards the draft and causes no mutation at all', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="new-area"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvas, cellSize, [[1, 1], [1, 2]]);
  release(window, canvas, cellSize, [1, 2]);
  await flush();

  root.querySelector('[data-fog-action="area-cancel"]').click();
  await flush();

  assert.equal(adapter.calls.mutate.length, 0);
});

// --- existing named-area actions ------------------------------------------------------------------

test('area status Hidden/Revealed/Mixed is displayed from server-derived status, not recomputed client-side', async () => {
  const { host, controller, setView } = await buildHarness();
  controller.activate();
  const areas = [
    { id: 'a-hidden', levelId, name: 'A', cellRuns: [], revealedByDefault: false, status: 'Hidden' },
    { id: 'a-revealed', levelId, name: 'B', cellRuns: [], revealedByDefault: true, status: 'Revealed' },
    { id: 'a-mixed', levelId, name: 'C', cellRuns: [], revealedByDefault: false, status: 'Mixed' },
  ];
  setView(managerView({ dm: { fog: fogManagerState({ areas }) } }));
  const root = host.querySelector('[data-fog-controller]');

  for (const area of areas) {
    const row = root.querySelector(`[data-area-id="${area.id}"]`);
    assert.ok(row, `row for ${area.id}`);
    assert.match(row.textContent, new RegExp(area.status));
  }
});

test('Reveal Area has no confirmation and calls fog.area.setVisibility with revealed:true', async () => {
  const { host, controller, setView, adapter, confirmAction } = await buildHarness();
  controller.activate();
  const area = { id: 'area-1', levelId, name: 'Room', cellRuns: [], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ dm: { fog: fogManagerState({ areas: [area] }) } }));
  const root = host.querySelector('[data-fog-controller]');

  root.querySelector('[data-fog-action="area-reveal"][data-area-id="area-1"]').click();
  await flush();

  assert.equal(confirmAction.calls.length, 0, 'Reveal Area must never confirm');
  const calls = commandsOfType(adapter, 'fog.area.setVisibility');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.payload.areaId, 'area-1');
  assert.equal(calls[0].command.payload.revealed, true);
});

test('Hide Area has no confirmation and calls fog.area.setVisibility with revealed:false', async () => {
  const { host, controller, setView, adapter, confirmAction } = await buildHarness();
  controller.activate();
  const area = { id: 'area-1', levelId, name: 'Room', cellRuns: [], revealedByDefault: true, status: 'Revealed' };
  setView(managerView({ dm: { fog: fogManagerState({ areas: [area] }) } }));
  const root = host.querySelector('[data-fog-controller]');

  root.querySelector('[data-fog-action="area-hide"][data-area-id="area-1"]').click();
  await flush();

  assert.equal(confirmAction.calls.length, 0, 'Hide Area must never confirm');
  const calls = commandsOfType(adapter, 'fog.area.setVisibility');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.payload.revealed, false);
});

test('Delete Area confirms before calling fog.area.delete, and a declined confirmation sends nothing', async () => {
  const { host, controller, setView, adapter } = await buildHarness({ confirmResult: false });
  controller.activate();
  const area = { id: 'area-1', levelId, name: 'Room', cellRuns: [], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ dm: { fog: fogManagerState({ areas: [area] }) } }));
  const root = host.querySelector('[data-fog-controller]');

  root.querySelector('[data-fog-action="area-delete"][data-area-id="area-1"]').click();
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.area.delete').length, 0, 'declined confirmation sends no mutation');
});

test('Delete Area proceeds to fog.area.delete once confirmed', async () => {
  const { host, controller, setView, adapter } = await buildHarness({ confirmResult: true });
  controller.activate();
  const area = { id: 'area-1', levelId, name: 'Room', cellRuns: [], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ dm: { fog: fogManagerState({ areas: [area] }) } }));
  const root = host.querySelector('[data-fog-controller]');

  root.querySelector('[data-fog-action="area-delete"][data-area-id="area-1"]').click();
  await flush();

  const calls = commandsOfType(adapter, 'fog.area.delete');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.payload.areaId, 'area-1');
});

// --- broad actions: Reveal All / Hide All / Reset require confirmation ----------------------------

test('Reveal All requires confirmation before fog.revealAll, and a declined confirmation sends nothing', async () => {
  const { host, controller, setView, adapter, confirmAction } = await buildHarness({ confirmResult: false });
  controller.activate();
  setView(managerView());
  const root = host.querySelector('[data-fog-controller]');

  root.querySelector('[data-fog-action="reveal-all"]').click();
  await flush();

  assert.equal(confirmAction.calls.length, 1);
  assert.equal(commandsOfType(adapter, 'fog.revealAll').length, 0);
});

test('Reveal All proceeds once confirmed', async () => {
  const { host, controller, setView, adapter } = await buildHarness({ confirmResult: true });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="reveal-all"]').click();
  await flush();
  const calls = commandsOfType(adapter, 'fog.revealAll');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.payload.levelId, levelId);
});

test('Hide All requires confirmation before fog.hideAll', async () => {
  const { host, controller, setView, adapter, confirmAction } = await buildHarness({ confirmResult: false });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="hide-all"]').click();
  await flush();
  assert.equal(confirmAction.calls.length, 1);
  assert.equal(commandsOfType(adapter, 'fog.hideAll').length, 0);
});

test('Hide All proceeds once confirmed', async () => {
  const { host, controller, setView, adapter } = await buildHarness({ confirmResult: true });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="hide-all"]').click();
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.hideAll').length, 1);
});

test('Reset requires confirmation before fog.resetDefaults', async () => {
  const { host, controller, setView, adapter, confirmAction } = await buildHarness({ confirmResult: false });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="reset"]').click();
  await flush();
  assert.equal(confirmAction.calls.length, 1);
  assert.equal(commandsOfType(adapter, 'fog.resetDefaults').length, 0);
});

test('Reset proceeds once confirmed', async () => {
  const { host, controller, setView, adapter } = await buildHarness({ confirmResult: true });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="reset"]').click();
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.resetDefaults').length, 1);
});

test('broad-action confirmation copy is action-specific, never a generic "Clear Fog" wording', async () => {
  const { host, controller, setView, confirmAction } = await buildHarness({ confirmResult: false });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="reveal-all"]').click();
  host.querySelector('[data-fog-action="hide-all"]').click();
  host.querySelector('[data-fog-action="reset"]').click();
  await flush();

  const messages = confirmAction.calls.map(c => c.message);
  assert.equal(messages.length, 3);
  const unique = new Set(messages);
  assert.equal(unique.size, 3, 'each broad action must use distinct, action-specific wording');
  for (const message of messages) assert.doesNotMatch(message, /clear fog/i);
});

// --- Disable Fog / Enable Fog ------------------------------------------------------------------

test('Disable Fog always requires confirmation, and a declined confirmation sends nothing', async () => {
  const { host, controller, setView, adapter, confirmAction } = await buildHarness({ confirmResult: false });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="disable-campaign"]').click();
  await flush();

  assert.equal(confirmAction.calls.length, 1);
  assert.equal(commandsOfType(adapter, 'fog.setCampaignEnabled').length, 0);
});

test("Disable Fog confirmation copy communicates base-map exposure, that DM-hidden objects stay hidden, and that the stored mask is preserved — never implying hidden objects become revealed", async () => {
  const { host, controller, setView, confirmAction } = await buildHarness({ confirmResult: false });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="disable-campaign"]').click();
  await flush();

  const { message } = confirmAction.calls[0];
  assert.match(message, /base map/i);
  assert.match(message, /visible/i);
  assert.match(message, /hidden/i);
  assert.match(message, /preserved|restore/i);
  assert.doesNotMatch(message, /hidden (objects|creatures|tokens).{0,40}(become|are)?\s*(revealed|visible)/i);
});

test('Disable Fog proceeds to fog.setCampaignEnabled(false) once confirmed', async () => {
  const { host, controller, setView, adapter } = await buildHarness({ confirmResult: true });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="disable-campaign"]').click();
  await flush();
  const calls = commandsOfType(adapter, 'fog.setCampaignEnabled');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.payload.enabled, false);
});

test('Enable Fog may proceed without the exposure confirmation because it restores the stored mask', async () => {
  const { host, controller, setView, adapter, confirmAction } = await buildHarness();
  controller.activate();
  setView(managerView({ dm: { fog: fogManagerState({ campaignEnabled: false }) } }));
  host.querySelector('[data-fog-action="enable-campaign"]').click();
  await flush();

  assert.equal(confirmAction.calls.length, 0, 'Enable Fog must not confirm');
  const calls = commandsOfType(adapter, 'fog.setCampaignEnabled');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.payload.enabled, true);
});

test('toggling fog enable/disable never deletes or resets stored cells: only fog.setCampaignEnabled is sent, never resetDefaults/hideAll/revealAll', async () => {
  const { host, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView({ dm: { fog: fogManagerState({ campaignEnabled: false }) } }));
  host.querySelector('[data-fog-action="enable-campaign"]').click();
  await flush();
  setView(managerView({ dm: { fog: fogManagerState({ campaignEnabled: true }) } }));
  host.querySelector('[data-fog-action="disable-campaign"]').click();
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.resetDefaults').length, 0);
  assert.equal(commandsOfType(adapter, 'fog.hideAll').length, 0);
  assert.equal(commandsOfType(adapter, 'fog.revealAll').length, 0);
});

// --- inheritance settings --------------------------------------------------------------------

test('campaign setting is On/Off, reflected from dm.fog.campaignEnabled', async () => {
  const { host, controller, setView } = await buildHarness();
  controller.activate();
  setView(managerView({ dm: { fog: fogManagerState({ campaignEnabled: true }) } }));
  let root = host.querySelector('[data-fog-controller]');
  assert.match(root.querySelector('[data-fog-status="campaign"]').textContent, /on/i);

  setView(managerView({ dm: { fog: fogManagerState({ campaignEnabled: false }) } }));
  root = host.querySelector('[data-fog-controller]');
  assert.match(root.querySelector('[data-fog-status="campaign"]').textContent, /off/i);
});

test('location setting is On/Off/Inherit and mutates via fog.setLocationOverride with the explicit locationId', async () => {
  const { host, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView({ dm: { fog: fogManagerState({ locationOverride: null }) } }));
  const root = host.querySelector('[data-fog-controller]');
  const select = root.querySelector('[data-fog-field="location-override"]');
  assert.equal(select.value, 'inherit');

  select.value = 'on';
  select.dispatchEvent(new (host.ownerDocument.defaultView).Event('change', { bubbles: true }));
  await flush();
  let calls = commandsOfType(adapter, 'fog.setLocationOverride');
  assert.equal(calls.at(-1).command.payload.locationId, locationId);
  assert.equal(calls.at(-1).command.payload.enabled, true);

  select.value = 'off';
  select.dispatchEvent(new (host.ownerDocument.defaultView).Event('change', { bubbles: true }));
  await flush();
  calls = commandsOfType(adapter, 'fog.setLocationOverride');
  assert.equal(calls.at(-1).command.payload.enabled, false);

  select.value = 'inherit';
  select.dispatchEvent(new (host.ownerDocument.defaultView).Event('change', { bubbles: true }));
  await flush();
  calls = commandsOfType(adapter, 'fog.setLocationOverride');
  assert.equal(calls.at(-1).command.payload.enabled, null);
});

test('level setting is On/Off/Inherit and mutates via fog.setLevelOverride with the explicit levelId', async () => {
  const { host, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView({ dm: { fog: fogManagerState({ levelOverride: true }) } }));
  const root = host.querySelector('[data-fog-controller]');
  const select = root.querySelector('[data-fog-field="level-override"]');
  assert.equal(select.value, 'on');

  select.value = 'off';
  select.dispatchEvent(new (host.ownerDocument.defaultView).Event('change', { bubbles: true }));
  await flush();
  const calls = commandsOfType(adapter, 'fog.setLevelOverride');
  assert.equal(calls.at(-1).command.payload.levelId, levelId);
  assert.equal(calls.at(-1).command.payload.enabled, false);
});

// --- explicit levelId / no DOM inference for mutation target ---------------------------------

test('explicit manager levelId is used for broad actions, and it is read from the latest rendered view data, never inferred from DOM', async () => {
  const { host, controller, setView, adapter } = await buildHarness({ confirmResult: true });
  controller.activate();
  setView(managerView({ fog: fogProjection({ levelId }), session: { id: session, name: 'S', status: 'active', activeLevelId: levelId } }));
  host.querySelector('[data-fog-action="reveal-all"]').click();
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.revealAll').at(-1).command.payload.levelId, levelId);

  // Switch the active level without ever touching any DOM text/attribute by hand — only a fresh
  // render(view) changes what the next action targets.
  setView(managerView({ fog: fogProjection({ levelId: otherLevelId }), session: { id: session, name: 'S', status: 'active', activeLevelId: otherLevelId } }));
  host.querySelector('[data-fog-action="hide-all"]').click();
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.hideAll').at(-1).command.payload.levelId, otherLevelId);
});

test('no DOM inference: fogController.js source never reads a level/location id from element text/attributes for a mutation payload', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  assert.doesNotMatch(source, /dataset\.levelId/);
  assert.doesNotMatch(source, /dataset\.locationId/);
});

// --- navigation/denial deactivates editor and drops preview -----------------------------------

test('deactivate() hides controls, deactivates the editor overlay, and discards any uncommitted preview/draft', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  // An in-progress, uncommitted stroke (pointerdown only, no release).
  drag(window, canvas, cellSize, [[1, 1], [1, 2]]);

  controller.deactivate();
  await flush();

  assert.equal(adapter.calls.mutate.length, 0, 'nothing was committed from the discarded preview');
  assert.equal(canvas.style.pointerEvents, 'none', 'editor overlay is deactivated');
  const root = host.querySelector('[data-fog-controller]');
  assert.ok(!root || root.hidden);
});

test('a stray pointerup after deactivate() emits no mutation', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvas, cellSize, [[1, 1]]);
  controller.deactivate();

  release(window, canvas, cellSize, [1, 1]);
  await flush();
  assert.equal(adapter.calls.mutate.length, 0);
});

// --- presentation mode -------------------------------------------------------------------------

test("presentation mode 'player' suspends/hides the DM fog editor overlay and controls locally", async () => {
  const { host, frame, controller, setView } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  assert.equal(canvas.style.pointerEvents, 'auto', 'sanity: editor was active in dm mode');

  controller.setPresentationMode('player');

  assert.equal(canvas.style.pointerEvents, 'none', 'editor overlay must be suspended in player presentation mode');
  const root = host.querySelector('[data-fog-controller]');
  assert.ok(!root || root.hidden, 'fog controls must be hidden in player presentation mode');
});

test("presentation mode change causes no authority/network mutation", async () => {
  const { controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  const mutateCallsBefore = adapter.calls.mutate.length;
  const hydrateCallsBefore = adapter.calls.hydrate.length;

  controller.setPresentationMode('player');
  controller.setPresentationMode('dm');

  assert.equal(adapter.calls.mutate.length, mutateCallsBefore);
  assert.equal(adapter.calls.hydrate.length, hydrateCallsBefore);
});

test("returning to 'dm' presentation mode restores fog controls for a still-current manager view", async () => {
  const { host, controller, setView } = await buildHarness();
  controller.activate();
  setView(managerView());
  controller.setPresentationMode('player');
  controller.setPresentationMode('dm');

  const root = host.querySelector('[data-fog-controller]');
  assert.ok(root && root.hidden === false);
});

test("fog actions clicked while presentation mode is 'player' do nothing (structural safety, not just hidden)", async () => {
  const { host, controller, setView, adapter } = await buildHarness({ confirmResult: true });
  controller.activate();
  setView(managerView());
  controller.setPresentationMode('player');

  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="reveal-all"]')?.click();
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.revealAll').length, 0);
});

// --- 10F-FIX1 defect 1: manager authority loss deactivates the editor -------------------------

test('manager authority loss during an in-progress stroke disables pointer interception immediately, and a later stray release emits no mutation', async () => {
  const { window, host, frame, cellSize, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');

  drag(window, canvas, cellSize, [[1, 1], [1, 2]]); // in-progress, uncommitted stroke

  setView(playerView()); // authority lost mid-stroke (same level/dimensions as the manager view)
  assert.equal(canvas.style.pointerEvents, 'none', 'pointer interception must be disabled the instant manager authority is lost');

  release(window, canvas, cellSize, [1, 2]);
  await flush();
  assert.equal(adapter.calls.mutate.length, 0, 'a stray release after authority loss must never mutate');
});

test('manager authority loss discards an in-progress named-area draft and hides the area editor', async () => {
  const { host, frame, cellSize, window, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="new-area"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvas, cellSize, [[2, 2]]);
  release(window, canvas, cellSize, [2, 2]);
  await flush();
  assert.equal(root.querySelector('[data-fog-area-editor]').hidden, false, 'sanity: area editor open before authority loss');

  setView(playerView());
  assert.equal(root.querySelector('[data-fog-area-editor]').hidden, true, 'area draft must be discarded on authority loss');

  root.querySelector('[data-fog-action="area-save"]').click();
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.area.create').length, 0, 'a stray Save after authority loss must produce zero mutation');
});

test('manager -> non-manager -> manager returns to a clean authoritative state with no stale stroke/draft resurrection', async () => {
  const { host, frame, cellSize, window, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="toggle-fog-mode"]').click();
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvas, cellSize, [[3, 3]]); // uncommitted

  setView(playerView());
  setView(managerView()); // manager authority regained

  release(window, canvas, cellSize, [3, 3]);
  await flush();
  assert.equal(adapter.calls.mutate.length, 0, 'no stale stroke must be resurrected on manager regain');

  const root = host.querySelector('[data-fog-controller]');
  assert.equal(root.hidden, false, 'manager view is visible again');
  assert.equal(root.querySelector('[data-fog-action="toggle-fog-mode"]').textContent, 'Enter Fog Mode', 'editor is not auto-reactivated with stale state');
  assert.equal(root.querySelector('[data-fog-area-editor]').hidden, true, 'no stale area draft must be resurrected');
});

// --- 10F-FIX1 defect 2: named-area draft is scoped to its authoritative levelId ----------------

test('a New Area draft is discarded when the authoritative manager view switches to a different levelId, and a stray Save after the switch produces zero mutation', async () => {
  const { host, frame, cellSize, window, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView({ fog: fogProjection({ levelId }) }));
  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="new-area"]').click();
  root.querySelector('[data-fog-field="area-name"]').value = 'Level A Room';
  root.querySelector('[data-fog-field="area-name"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvas, cellSize, [[2, 2]]);
  release(window, canvas, cellSize, [2, 2]);
  await flush();

  setView(managerView({ fog: fogProjection({ levelId: otherLevelId }) })); // authoritative context moves to Level B

  assert.equal(root.querySelector('[data-fog-area-editor]').hidden, true, 'the Level A draft must be discarded on the level switch');

  root.querySelector('[data-fog-action="area-save"]').click();
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.area.create').length, 0, 'a stray Save after the context switch must produce zero mutation');
});

test('an Edit Area draft is discarded when the authoritative manager view switches to a different levelId, and a stray Save after the switch produces zero mutation', async () => {
  const { host, frame, cellSize, window, controller, setView, adapter } = await buildHarness();
  controller.activate();
  const area = { id: 'area-1', levelId, name: 'Old Name', cellRuns: [[0, 0, 2]], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ fog: fogProjection({ levelId }), dm: { fog: fogManagerState({ areas: [area] }) } }));
  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="area-edit"][data-area-id="area-1"]').click();
  assert.equal(root.querySelector('[data-fog-field="area-name"]').value, 'Old Name');

  setView(managerView({ fog: fogProjection({ levelId: otherLevelId }), dm: { fog: fogManagerState({ areas: [area] }) } }));

  assert.equal(root.querySelector('[data-fog-area-editor]').hidden, true, 'the Level A edit draft must be discarded on the level switch');

  root.querySelector('[data-fog-action="area-save"]').click();
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.area.update').length, 0, 'a stray Save after the context switch must produce zero mutation');
});

test('after a level-switch discard, the new level starts a completely fresh draft: no leaked Level A name, default, or cells', async () => {
  const { host, frame, cellSize, window, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView({ fog: fogProjection({ levelId }) }));
  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="new-area"]').click();
  root.querySelector('[data-fog-field="area-name"]').value = 'Level A Room';
  root.querySelector('[data-fog-field="area-name"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  root.querySelector('[data-fog-field="area-default"][value="revealed"]').checked = true;
  root.querySelector('[data-fog-field="area-default"][value="revealed"]').dispatchEvent(new window.Event('change', { bubbles: true }));
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvas, cellSize, [[2, 2]]);
  release(window, canvas, cellSize, [2, 2]);
  await flush();

  setView(managerView({ fog: fogProjection({ levelId: otherLevelId }) }));

  root.querySelector('[data-fog-action="new-area"]').click();
  assert.equal(root.querySelector('[data-fog-field="area-name"]').value, '', 'fresh draft must not carry the Level A name');
  assert.equal(root.querySelector('[data-fog-field="area-default"][value="hidden"]').checked, true, 'fresh draft must default to Hidden, not the Level A leftover');

  drag(window, canvas, cellSize, [[9, 9]]);
  release(window, canvas, cellSize, [9, 9]);
  await flush();
  root.querySelector('[data-fog-action="area-save"]').click();
  await flush();

  const creates = commandsOfType(adapter, 'fog.area.create');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].command.payload.levelId, otherLevelId);
  assert.deepEqual(creates[0].command.payload.cells, [[9, 9]], 'no Level A cells must leak into the Level B draft');
});

test('a same-level authoritative refresh does not discard a valid, in-progress named-area draft', async () => {
  const { host, frame, cellSize, window, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView({ fog: fogProjection({ levelId }) }));
  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="new-area"]').click();
  root.querySelector('[data-fog-field="area-name"]').value = 'Still Editing';
  root.querySelector('[data-fog-field="area-name"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  const canvas = frame.querySelector('canvas.fog-editor-canvas');
  drag(window, canvas, cellSize, [[4, 4]]);
  release(window, canvas, cellSize, [4, 4]);
  await flush();

  // Same-level authoritative refresh (e.g. a revision bump from an unrelated change), not a level switch.
  setView(managerView({ fog: fogProjection({ levelId, revealedRuns: [[0, 0, 1]] }) }));

  assert.equal(root.querySelector('[data-fog-area-editor]').hidden, false, 'a valid draft must survive a same-level refresh');
  assert.equal(root.querySelector('[data-fog-field="area-name"]').value, 'Still Editing');

  root.querySelector('[data-fog-action="area-save"]').click();
  await flush();
  const creates = commandsOfType(adapter, 'fog.area.create');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].command.payload.levelId, levelId);
});

// --- 10F-FIX1 defect 3: duplicate broad-action requests while confirmation is pending ----------

for (const { action, type } of [
  { action: 'reveal-all', type: 'fog.revealAll' },
  { action: 'hide-all', type: 'fog.hideAll' },
  { action: 'reset', type: 'fog.resetDefaults' },
]) {
  test(`${action}: a second click while its confirmation is pending is ignored; after that attempt settles, a new click proceeds normally`, async () => {
    const confirmAction = deferredConfirmSpy();
    const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
    controller.activate();
    setView(managerView());
    const button = host.querySelector(`[data-fog-action="${action}"]`);

    button.click();
    assert.equal(confirmAction.calls.length, 1, 'first click enters the pending state');

    button.click();
    await flush();
    assert.equal(confirmAction.calls.length, 1, 'a rapid second click must not open a second confirmation while the first is pending');
    assert.equal(commandsOfType(adapter, type).length, 0, 'no mutation yet: the first confirmation has not resolved');

    confirmAction.deferreds[0].resolve(true);
    await flush();
    assert.equal(commandsOfType(adapter, type).length, 1, 'the first confirmed attempt proceeds to exactly one mutation');

    button.click();
    await flush();
    assert.equal(confirmAction.calls.length, 2, 'once the pending attempt has settled, a new click opens a new confirmation');
    confirmAction.deferreds[1].resolve(true);
    await flush();
    assert.equal(commandsOfType(adapter, type).length, 2, 'the second attempt after settling produces its own mutation');
  });
}

test('Disable Fog: a second click while its confirmation is pending is ignored; after that attempt settles, a new click proceeds normally', async () => {
  const confirmAction = deferredConfirmSpy();
  const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
  controller.activate();
  setView(managerView());
  const button = host.querySelector('[data-fog-action="disable-campaign"]');

  button.click();
  assert.equal(confirmAction.calls.length, 1);

  button.click();
  await flush();
  assert.equal(confirmAction.calls.length, 1, 'a rapid second click must not open a second confirmation while the first is pending');
  assert.equal(commandsOfType(adapter, 'fog.setCampaignEnabled').length, 0);

  confirmAction.deferreds[0].resolve(true);
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.setCampaignEnabled').length, 1);

  button.click();
  await flush();
  assert.equal(confirmAction.calls.length, 2, 'once the pending attempt has settled, a new click opens a new confirmation');
  confirmAction.deferreds[1].resolve(true);
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.setCampaignEnabled').length, 2);
});

// --- 10F-FIX2: mutation handlers must revalidate manager authority at submit time --------------

// Path A: a retained handler fired after demotion (toolbar hidden, but the handler still exists).

test('a retained Reveal All handler invoked after manager authority is lost cannot reach the mutation bridge', async () => {
  const { host, controller, setView, adapter, confirmAction } = await buildHarness({ confirmResult: true });
  controller.activate();
  setView(managerView());
  const button = host.querySelector('[data-fog-action="reveal-all"]');

  setView(playerView()); // authority lost; toolbar is now hidden but the handler reference is unchanged

  button.click(); // simulates a retained handler firing after the toolbar was hidden
  await flush();

  assert.equal(confirmAction.calls.length, 0, 'authority is checked before even opening a confirmation');
  assert.equal(commandsOfType(adapter, 'fog.revealAll').length, 0, 'no mutation once manager authority is gone, even via a retained handler');
});

test('a retained Disable Fog handler invoked after manager authority is lost cannot reach the mutation bridge', async () => {
  const { host, controller, setView, adapter, confirmAction } = await buildHarness({ confirmResult: true });
  controller.activate();
  setView(managerView());
  const button = host.querySelector('[data-fog-action="disable-campaign"]');

  setView(playerView());

  button.click();
  await flush();

  assert.equal(confirmAction.calls.length, 0);
  assert.equal(commandsOfType(adapter, 'fog.setCampaignEnabled').length, 0);
});

test('a retained Reveal Area handler (a non-broad, non-confirming mutation path) invoked after manager authority is lost cannot reach the mutation bridge, proving the gate is systemic', async () => {
  const { host, controller, setView, adapter } = await buildHarness();
  controller.activate();
  const area = { id: 'area-1', levelId, name: 'Room', cellRuns: [], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ dm: { fog: fogManagerState({ areas: [area] }) } }));
  const root = host.querySelector('[data-fog-controller]');
  const button = root.querySelector('[data-fog-action="area-reveal"][data-area-id="area-1"]');

  setView(playerView());

  button.click(); // the DOM row still exists (only root.hidden changed); a retained reference could fire it too
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.area.setVisibility').length, 0, 'no mutation once manager authority is gone, even for a no-confirmation control');
});

test('a retained level-override select change invoked after manager authority is lost cannot reach the mutation bridge', async () => {
  const { host, controller, setView, adapter } = await buildHarness();
  controller.activate();
  setView(managerView());
  const root = host.querySelector('[data-fog-controller]');
  const select = root.querySelector('[data-fog-field="level-override"]');

  setView(playerView());

  select.value = 'off';
  select.dispatchEvent(new (host.ownerDocument.defaultView).Event('change', { bubbles: true }));
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.setLevelOverride').length, 0, 'a settings control must not mutate once manager authority is gone');
});

// Path B: a pending confirmation that survives a demotion delivered while it was open.

test('Reveal All: a pending confirmation that resolves true after manager authority is lost produces zero mutation', async () => {
  const confirmAction = deferredConfirmSpy();
  const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="reveal-all"]').click();
  assert.equal(confirmAction.calls.length, 1);

  setView(playerView()); // authority lost while the confirmation is still pending

  confirmAction.deferreds[0].resolve(true);
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.revealAll').length, 0, 'authority lost mid-confirmation must abort with zero mutation');
});

test('Disable Fog: a pending confirmation that resolves true after manager authority is lost produces zero mutation', async () => {
  const confirmAction = deferredConfirmSpy();
  const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
  controller.activate();
  setView(managerView());
  host.querySelector('[data-fog-action="disable-campaign"]').click();
  assert.equal(confirmAction.calls.length, 1);

  setView(playerView());

  confirmAction.deferreds[0].resolve(true);
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.setCampaignEnabled').length, 0, 'authority lost mid-confirmation must abort with zero mutation');
});

test('Delete Area: a pending confirmation that resolves true after manager authority is lost produces zero mutation', async () => {
  const confirmAction = deferredConfirmSpy();
  const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
  controller.activate();
  const area = { id: 'area-1', levelId, name: 'Room', cellRuns: [], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ dm: { fog: fogManagerState({ areas: [area] }) } }));
  host.querySelector('[data-fog-action="area-delete"][data-area-id="area-1"]').click();
  assert.equal(confirmAction.calls.length, 1);

  setView(playerView());

  confirmAction.deferreds[0].resolve(true);
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.area.delete').length, 0, 'authority lost mid-confirmation must abort with zero mutation');
});

// Level-context preservation across the confirmation gap.

test('Reveal All: switching the authoritative level to Level B while a Level A confirmation is pending aborts with zero mutation against either level, and a fresh action under the current level then works normally', async () => {
  const confirmAction = deferredConfirmSpy();
  const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
  controller.activate();
  setView(managerView({ fog: fogProjection({ levelId }) }));
  host.querySelector('[data-fog-action="reveal-all"]').click();
  assert.equal(confirmAction.calls.length, 1);

  setView(managerView({ fog: fogProjection({ levelId: otherLevelId }) })); // still manager, but a different authoritative level

  confirmAction.deferreds[0].resolve(true);
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.revealAll').length, 0, 'a Level A confirmation must never silently retarget Level B');

  // A fresh action under the now-current level must work normally after the abort.
  host.querySelector('[data-fog-action="reveal-all"]').click();
  await flush();
  assert.equal(confirmAction.calls.length, 2, 'the pending guard must have cleared after the aborted attempt settled');
  confirmAction.deferreds[1].resolve(true);
  await flush();

  const calls = commandsOfType(adapter, 'fog.revealAll');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.payload.levelId, otherLevelId);
});

test('Hide All: a same-level authoritative refresh while confirmation is pending does not abort a still-valid action', async () => {
  const confirmAction = deferredConfirmSpy();
  const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
  controller.activate();
  setView(managerView({ fog: fogProjection({ levelId }) }));
  host.querySelector('[data-fog-action="hide-all"]').click();

  // An unrelated same-level refresh (new object identity, same levelId) must not be mistaken for a context change.
  setView(managerView({ fog: fogProjection({ levelId, revealedRuns: [[0, 0, 1]] }) }));

  confirmAction.deferreds[0].resolve(true);
  await flush();

  const calls = commandsOfType(adapter, 'fog.hideAll');
  assert.equal(calls.length, 1, 'a same-level refresh during confirmation must not block a still-valid action');
  assert.equal(calls[0].command.payload.levelId, levelId);
});

// --- 10F-FIX3: Delete Area must revalidate authoritative level context after confirmation ------

test('Delete Area: switching the authoritative level to Level B while a Level A delete confirmation is pending aborts with zero mutation against either level', async () => {
  const confirmAction = deferredConfirmSpy();
  const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
  controller.activate();
  const areaA = { id: 'area-a', levelId, name: 'Room A', cellRuns: [], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ fog: fogProjection({ levelId }), dm: { fog: fogManagerState({ areas: [areaA] }) } }));
  host.querySelector('[data-fog-action="area-delete"][data-area-id="area-a"]').click();
  assert.equal(confirmAction.calls.length, 1);

  setView(managerView({ fog: fogProjection({ levelId: otherLevelId }), dm: { fog: fogManagerState({ areas: [] }) } })); // authoritative context moves to Level B

  confirmAction.deferreds[0].resolve(true);
  await flush();

  assert.equal(commandsOfType(adapter, 'fog.area.delete').length, 0, 'a Level A delete confirmation must never silently retarget Level B, and must not delete Area A once the level has moved on');
});

test('Delete Area: after a stale Level A delete aborts, a fresh delete for a valid Level B area works normally and targets the correct area/level', async () => {
  const confirmAction = deferredConfirmSpy();
  const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
  controller.activate();
  const areaA = { id: 'area-a', levelId, name: 'Room A', cellRuns: [], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ fog: fogProjection({ levelId }), dm: { fog: fogManagerState({ areas: [areaA] }) } }));
  host.querySelector('[data-fog-action="area-delete"][data-area-id="area-a"]').click();

  const areaB = { id: 'area-b', levelId: otherLevelId, name: 'Room B', cellRuns: [], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ fog: fogProjection({ levelId: otherLevelId }), dm: { fog: fogManagerState({ areas: [areaB] }) } }));

  confirmAction.deferreds[0].resolve(true);
  await flush();
  assert.equal(commandsOfType(adapter, 'fog.area.delete').length, 0, 'sanity: the stale Level A delete must have aborted');

  const root = host.querySelector('[data-fog-controller]');
  root.querySelector('[data-fog-action="area-delete"][data-area-id="area-b"]').click();
  await flush();
  assert.equal(confirmAction.calls.length, 2, 'a fresh delete opens its own confirmation after the stale one settled');
  confirmAction.deferreds[1].resolve(true);
  await flush();

  const calls = commandsOfType(adapter, 'fog.area.delete');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.payload.areaId, 'area-b');
  assert.equal(calls[0].command.payload.levelId, otherLevelId);
});

test('Delete Area: a same-level authoritative refresh while confirmation is pending does not abort a still-valid delete', async () => {
  const confirmAction = deferredConfirmSpy();
  const { host, setView, controller, adapter } = await buildHarness({ confirmAction });
  controller.activate();
  const areaA = { id: 'area-a', levelId, name: 'Room A', cellRuns: [], revealedByDefault: false, status: 'Hidden' };
  setView(managerView({ fog: fogProjection({ levelId }), dm: { fog: fogManagerState({ areas: [areaA] }) } }));
  host.querySelector('[data-fog-action="area-delete"][data-area-id="area-a"]').click();

  // Fresh authoritative snapshot, still Level A (e.g. an unrelated revision bump), not a level switch.
  setView(managerView({ fog: fogProjection({ levelId, revealedRuns: [[0, 0, 1]] }), dm: { fog: fogManagerState({ areas: [areaA] }) } }));

  confirmAction.deferreds[0].resolve(true);
  await flush();

  const calls = commandsOfType(adapter, 'fog.area.delete');
  assert.equal(calls.length, 1, 'a same-level refresh during confirmation must not block a still-valid delete');
  assert.equal(calls[0].command.payload.areaId, 'area-a');
  assert.equal(calls[0].command.payload.levelId, levelId);
});

// --- dispose -------------------------------------------------------------------------------

test('dispose() removes the toolbar DOM and the editor overlay canvas, and is idempotent', async () => {
  const { host, frame, controller, setView } = await buildHarness();
  controller.activate();
  setView(managerView());

  controller.dispose();
  assert.equal(host.querySelector('[data-fog-controller]'), null);
  assert.equal(frame.querySelector('canvas.fog-editor-canvas'), null);
  assert.doesNotThrow(() => controller.dispose());
});
