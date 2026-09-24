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
