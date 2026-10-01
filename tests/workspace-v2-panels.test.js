import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPanelManager } from '../src/workspace-v2/panelManager.js';

function panel(manager, id) {
  return manager.getState().panels.find(item => item.id === id);
}

test('only one panel can occupy dropdown mode at a time', () => {
  const manager = createPanelManager(['fog', 'tokens']);
  assert.equal(manager.open('fog'), true);
  assert.equal(panel(manager, 'fog').mode, 'dropdown');
  manager.open('tokens');
  assert.equal(panel(manager, 'tokens').mode, 'dropdown');
  assert.equal(panel(manager, 'fog').mode, 'closed');
});

test('dock transitions are exclusive per panel and preserve other panel modes', () => {
  const manager = createPanelManager(['fog', 'tokens']);
  manager.dock('fog', 'left');
  assert.equal(panel(manager, 'fog').mode, 'dock-left');
  manager.dock('fog', 'right');
  assert.equal(panel(manager, 'fog').mode, 'dock-right');
  manager.open('tokens');
  assert.equal(panel(manager, 'fog').mode, 'dock-right');
  assert.equal(panel(manager, 'tokens').mode, 'dropdown');
});

test('floating panels retain their last safe position', () => {
  const manager = createPanelManager(['fog']);
  manager.float('fog', { x: 240, y: 135 });
  assert.deepEqual(panel(manager, 'fog').position, { x: 240, y: 135 });
  manager.dock('fog', 'left');
  manager.float('fog');
  assert.equal(panel(manager, 'fog').mode, 'floating');
  assert.deepEqual(panel(manager, 'fog').position, { x: 240, y: 135 });
});

test('minimize and open restore the preceding presentation mode', () => {
  const manager = createPanelManager(['fog']);
  manager.float('fog', { x: 90, y: 70 });
  manager.minimize('fog');
  assert.equal(panel(manager, 'fog').mode, 'minimized');
  manager.open('fog');
  assert.equal(panel(manager, 'fog').mode, 'floating');
  assert.deepEqual(panel(manager, 'fog').position, { x: 90, y: 70 });
});

test('close resets visibility and unknown ids are safe no-ops', () => {
  const manager = createPanelManager(['fog']);
  const before = manager.getState();
  assert.equal(manager.open('unknown'), false);
  assert.deepEqual(manager.getState(), before);
  manager.open('fog');
  assert.equal(manager.close('fog'), true);
  assert.equal(panel(manager, 'fog').mode, 'closed');
  assert.equal(manager.dock('fog', 'middle'), false);
});

test('getState returns snapshots that cannot mutate manager state', () => {
  const manager = createPanelManager([{ id: 'fog', mode: 'dock-left' }]);
  const snapshot = manager.getState();
  snapshot.panels[0].mode = 'closed';
  assert.equal(panel(manager, 'fog').mode, 'dock-left');
});

