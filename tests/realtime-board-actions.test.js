import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { wireRealtimeBoardActions } from '../src/realtime/boardActions.js';

const session = '22222222-2222-4222-8222-222222222222';

function createFakeEngine() {
  const mutateCalls = [], hydrateCalls = [];
  let mutateImpl = async (id, command) => ({ ok: true, command });
  return {
    mutateCalls, hydrateCalls,
    setMutateResult(fn) { mutateImpl = fn; },
    mutate: async (id, command) => { mutateCalls.push({ id, command }); return mutateImpl(id, command); },
    hydrate: async id => { hydrateCalls.push(id); },
  };
}

function buildDom() {
  const dom = new JSDOM('<!DOCTYPE html><div id="panel"></div>');
  return { dom, panel: dom.window.document.getElementById('panel') };
}

function click(dom, element) {
  element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

const baseView = () => ({
  roundNumber: 3,
  authority: { canManage: true, ownCharacterId: 'c1' },
  tokens: [{ id: 't1', label: 'E1', conditionLabel: 'Hurt', isVisible: true }],
  characters: [{ id: 'c1', name: 'Aria', playerName: 'Pat', hp: 9, maxHp: 12, tempHp: 0, ac: 15, speed: 30, statuses: ['Blessed'], publicNotes: 'note' }],
  initiative: [],
});

test('advance-round sends roundNumber + 1', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  const view = baseView();
  wireRealtimeBoardActions(engine, () => session, () => view, panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'advance-round';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 1);
  assert.equal(engine.mutateCalls[0].command.type, 'session.setRound');
  assert.deepEqual(engine.mutateCalls[0].command.payload, { roundNumber: 4 });
});

test('toggle-token-visible flips isVisible and preserves label/conditionLabel', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  const view = baseView();
  wireRealtimeBoardActions(engine, () => session, () => view, panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'toggle-token-visible';
  button.dataset.tokenId = 't1';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls[0].command.type, 'token.setPublicState');
  assert.deepEqual(engine.mutateCalls[0].command.payload, { tokenId: 't1', label: 'E1', conditionLabel: 'Hurt', isVisible: false });
});

test('clear-initiative sends an empty entries array', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  const view = baseView();
  wireRealtimeBoardActions(engine, () => session, () => view, panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'clear-initiative';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls[0].command.type, 'initiative.set');
  assert.deepEqual(engine.mutateCalls[0].command.payload, { entries: [] });
});

test('adjust-own-hp sends the full character field set with only hp changed', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  const view = baseView();
  wireRealtimeBoardActions(engine, () => session, () => view, panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'adjust-own-hp';
  button.dataset.characterId = 'c1';
  button.dataset.delta = '-1';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls[0].command.type, 'character.update');
  assert.deepEqual(engine.mutateCalls[0].command.payload, {
    characterId: 'c1', name: 'Aria', playerName: 'Pat', hp: 8, maxHp: 12, tempHp: 0, ac: 15, speed: 30, statuses: ['Blessed'], publicNotes: 'note',
  });
});

test('a click on an unrelated element is a no-op', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => baseView(), panel);
  const span = dom.window.document.createElement('span');
  panel.appendChild(span);
  click(dom, span);
  await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 0);
});

test('a click with no active session/view is a safe no-op', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => null, () => null, panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'advance-round';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 0);
});

test('a button referencing a token/character id no longer in the view is safely ignored', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => baseView(), panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'toggle-token-visible';
  button.dataset.tokenId = 'does-not-exist';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 0);
});

test('the returned cleanup function removes the listener and is idempotent', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  const cleanup = wireRealtimeBoardActions(engine, () => session, () => baseView(), panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'advance-round';
  panel.appendChild(button);
  cleanup();
  cleanup(); // idempotent
  click(dom, button);
  await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 0);
});

test('a stale expectedRevision conflict re-hydrates via the engine, exactly as mutateWithConflictRecovery already guarantees', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  engine.setMutateResult(async () => { throw Object.assign(new Error('stale'), { code: '40001' }); });
  wireRealtimeBoardActions(engine, () => session, () => baseView(), panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'advance-round';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 1);
  assert.equal(engine.hydrateCalls.length, 1);
});

test('board action surfaces a conflict without replaying the command', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  engine.setMutateResult(async () => { throw { code: '40001' }; });
  const results = [];
  wireRealtimeBoardActions(engine, () => session, () => baseView(), panel, result => results.push(result));
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'advance-round';
  panel.appendChild(button);
  click(dom, button);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(results.length, 1);
  assert.equal(results[0].conflict, true);
  assert.equal(engine.mutateCalls.length, 1);
});

// --- Tuesday Online Package 2C: DM gameplay authoring controls ---

function submitForm(dom, form) {
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}

const gameplayView = () => ({
  roundNumber: 1,
  authority: { canManage: true, ownCharacterId: null },
  fog: null,
  tokens: [
    { id: 't1', kind: 'enemy', label: 'Goblin', x: 2, y: 3, width: 1, height: 1, isVisible: true, characterId: null },
    { id: 't2', kind: 'player', label: 'Aria', x: 0, y: 0, width: 1, height: 1, isVisible: true, characterId: 'c1' },
  ],
  characters: [{ id: 'c1', name: 'Aria', approved: true }],
  initiative: [{ id: 'i1', tokenId: 't1', initiative: 10, position: 0, isActive: true }],
});

test('prepare-board sends session.prepareBoard with an empty payload', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'prepare-board';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 1);
  assert.equal(engine.mutateCalls[0].command.type, 'session.prepareBoard');
  assert.deepEqual(engine.mutateCalls[0].command.payload, {});
});

function buildCreateTokenForm(dom, panel, fields) {
  const form = dom.window.document.createElement('form');
  form.dataset.realtimeAction = 'create-token';
  for (const [name, value, type = 'text'] of fields) {
    const input = dom.window.document.createElement(type === 'select' ? 'select' : 'input');
    input.name = name;
    if (type === 'checkbox') { input.type = 'checkbox'; input.value = 'true'; input.checked = value; }
    else if (type === 'select') { const opt = dom.window.document.createElement('option'); opt.value = value; opt.selected = true; input.appendChild(opt); }
    else { input.type = type; input.value = value; }
    form.appendChild(input);
  }
  panel.appendChild(form);
  return form;
}

test('create-token (enemy) sends the exact payload with characterId: null', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const form = buildCreateTokenForm(dom, panel, [
    ['kind', 'enemy', 'select'], ['label', 'Orc'], ['x', '4'], ['y', '5'], ['isVisible', true, 'checkbox'],
  ]);
  submitForm(dom, form);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 1);
  assert.equal(engine.mutateCalls[0].command.type, 'token.create');
  assert.deepEqual(engine.mutateCalls[0].command.payload, { kind: 'enemy', characterId: null, label: 'Orc', x: 4, y: 5, isVisible: true });
});

test('create-token (player) sends the selected characterId', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const form = buildCreateTokenForm(dom, panel, [
    ['kind', 'player', 'select'], ['characterId', 'c1', 'select'], ['label', 'Aria'], ['x', '1'], ['y', '1'], ['isVisible', true, 'checkbox'],
  ]);
  submitForm(dom, form);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(engine.mutateCalls[0].command.payload, { kind: 'player', characterId: 'c1', label: 'Aria', x: 1, y: 1, isVisible: true });
});

test('create-token with the visibility checkbox unchecked sends isVisible:false atomically (one call, never a create-then-hide pair)', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const form = buildCreateTokenForm(dom, panel, [
    ['kind', 'enemy', 'select'], ['label', 'Lurker'], ['x', '0'], ['y', '0'], ['isVisible', false, 'checkbox'],
  ]);
  submitForm(dom, form);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 1);
  assert.equal(engine.mutateCalls[0].command.payload.isVisible, false);
});

test('create-token with a blank/non-integer/negative x or y is rejected client-side and never sent', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  for (const [x, y] of [['', '0'], ['1.5', '0'], ['-1', '0'], ['0', '']]) {
    const form = buildCreateTokenForm(dom, panel, [
      ['kind', 'enemy', 'select'], ['label', 'Bad'], ['x', x], ['y', y], ['isVisible', true, 'checkbox'],
    ]);
    submitForm(dom, form);
    await Promise.resolve(); await Promise.resolve();
    form.remove();
  }
  assert.equal(engine.mutateCalls.length, 0);
});

test('move-token reads the destination inputs and sends exactly one token.move', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const wrapper = dom.window.document.createElement('div');
  wrapper.dataset.tokenMoveForm = '';
  wrapper.dataset.tokenId = 't1';
  const xInput = dom.window.document.createElement('input'); xInput.dataset.moveX = ''; xInput.value = '9';
  const yInput = dom.window.document.createElement('input'); yInput.dataset.moveY = ''; yInput.value = '11';
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'move-token'; button.dataset.tokenId = 't1';
  wrapper.append(xInput, yInput, button);
  panel.appendChild(wrapper);
  click(dom, button);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 1);
  assert.equal(engine.mutateCalls[0].command.type, 'token.move');
  assert.deepEqual(engine.mutateCalls[0].command.payload, { tokenId: 't1', x: 9, y: 11 });
});

test('move-token with a blank/non-integer/negative destination is rejected client-side and never sent', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const wrapper = dom.window.document.createElement('div');
  wrapper.dataset.tokenMoveForm = ''; wrapper.dataset.tokenId = 't1';
  const xInput = dom.window.document.createElement('input'); xInput.dataset.moveX = ''; xInput.value = '-1';
  const yInput = dom.window.document.createElement('input'); yInput.dataset.moveY = ''; yInput.value = '3';
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'move-token'; button.dataset.tokenId = 't1';
  wrapper.append(xInput, yInput, button);
  panel.appendChild(wrapper);
  click(dom, button);
  await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 0);
});

test('a move-token referencing a token id no longer in the view is safely ignored', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const wrapper = dom.window.document.createElement('div');
  wrapper.dataset.tokenMoveForm = ''; wrapper.dataset.tokenId = 'ghost';
  const xInput = dom.window.document.createElement('input'); xInput.dataset.moveX = ''; xInput.value = '1';
  const yInput = dom.window.document.createElement('input'); yInput.dataset.moveY = ''; yInput.value = '1';
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'move-token'; button.dataset.tokenId = 'ghost';
  wrapper.append(xInput, yInput, button);
  panel.appendChild(wrapper);
  click(dom, button);
  await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 0);
});

test('delete-token sends the exact token id, exactly once', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'delete-token';
  button.dataset.tokenId = 't1';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 1);
  assert.equal(engine.mutateCalls[0].command.type, 'token.delete');
  assert.deepEqual(engine.mutateCalls[0].command.payload, { tokenId: 't1' });
});

function buildInitiativeForm(dom, panel, rows) {
  const form = dom.window.document.createElement('form');
  form.dataset.realtimeAction = 'submit-initiative';
  for (const { tokenId, include, value } of rows) {
    const row = dom.window.document.createElement('label');
    row.dataset.initiativeRow = ''; row.dataset.tokenId = tokenId;
    const includeInput = dom.window.document.createElement('input');
    includeInput.type = 'checkbox'; includeInput.dataset.initiativeInclude = ''; includeInput.checked = include;
    const valueInput = dom.window.document.createElement('input');
    valueInput.type = 'number'; valueInput.dataset.initiativeValue = ''; valueInput.value = value;
    row.append(includeInput, valueInput);
    form.appendChild(row);
  }
  panel.appendChild(form);
  return form;
}

test('submit-initiative builds entries from checked rows, ordered by initiative descending, through the existing initiative.set bridge', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const form = buildInitiativeForm(dom, panel, [
    { tokenId: 't1', include: true, value: '10' },
    { tokenId: 't2', include: true, value: '18' },
  ]);
  submitForm(dom, form);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 1);
  assert.equal(engine.mutateCalls[0].command.type, 'initiative.set');
  assert.deepEqual(engine.mutateCalls[0].command.payload.entries, [
    { tokenId: 't2', initiative: 18, position: 0, isActive: false },
    { tokenId: 't1', initiative: 10, position: 1, isActive: true },
  ]);
});

test('submit-initiative excludes unchecked rows entirely', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const form = buildInitiativeForm(dom, panel, [
    { tokenId: 't1', include: true, value: '10' },
    { tokenId: 't2', include: false, value: '18' },
  ]);
  submitForm(dom, form);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(engine.mutateCalls[0].command.payload.entries.map(e => e.tokenId), ['t1']);
});

test('submit-initiative never invents a hidden-actor placeholder: it only ever sends tokenIds actually present as checked rows', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const form = buildInitiativeForm(dom, panel, [{ tokenId: 't1', include: true, value: '5' }]);
  submitForm(dom, form);
  await Promise.resolve(); await Promise.resolve();
  const entries = engine.mutateCalls[0].command.payload.entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tokenId, 't1');
});

test('next-turn sends initiative.advance with an empty payload', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'next-turn';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(engine.mutateCalls.length, 1);
  assert.equal(engine.mutateCalls[0].command.type, 'initiative.advance');
  assert.deepEqual(engine.mutateCalls[0].command.payload, {});
});

test('next-turn disables its button synchronously on click, before the mutation resolves, to prevent a rapid double-fire from one click', async () => {
  const { dom, panel } = buildDom();
  const engine = createFakeEngine();
  let resolveMutate;
  engine.setMutateResult(() => new Promise(resolve => { resolveMutate = resolve; }));
  wireRealtimeBoardActions(engine, () => session, () => gameplayView(), panel);
  const button = dom.window.document.createElement('button');
  button.dataset.realtimeAction = 'next-turn';
  panel.appendChild(button);
  click(dom, button);
  await Promise.resolve();
  assert.equal(button.disabled, true);
  resolveMutate({ ok: true });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(button.disabled, false);
  assert.equal(engine.mutateCalls.length, 1);
});
