import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCENE_LAYER_ORDER,
  createSceneModel,
} from '../src/workspace-v2/sceneModel.js';

test('locks the complete scene layer order', () => {
  assert.deepEqual(SCENE_LAYER_ORDER, [
    'background',
    'grid',
    'terrain',
    'structure',
    'difficultTerrain',
    'hazard',
    'trap',
    'token',
    'fog',
    'measurement',
    'interaction',
  ]);
});

test('normalizes BoardView tokens against stable board dimensions', () => {
  const scene = createSceneModel({
    revision: '7',
    fog: { width: 24, height: 18, enabled: true, revealedRuns: [] },
    tokens: [
      { id: 'hero', label: 'Aria', kind: 'player', x: 4, y: 5, width: 1, height: 2, isVisible: true },
      { id: 'bad', label: 'Offboard', kind: 'enemy', x: 24, y: 0, width: 1, height: 1, isVisible: true },
      { id: null, label: 'Missing id', x: 0, y: 0, width: 1, height: 1 },
    ],
  });

  assert.deepEqual(scene.grid, { width: 24, height: 18 });
  assert.deepEqual(scene.tokens, [{
    id: 'hero',
    label: 'Aria',
    kind: 'player',
    x: 4,
    y: 5,
    width: 1,
    height: 2,
    isVisible: true,
  }]);
  assert.equal(scene.revision, '7');
});

test('uses a stable 40x40 board when BoardView has no valid extent', () => {
  assert.deepEqual(createSceneModel(null).grid, { width: 40, height: 40 });
  assert.deepEqual(createSceneModel({ fog: { width: Infinity, height: -1 } }).grid, { width: 40, height: 40 });
});

test('projects only authorized BoardView tokens and never reads dm secrets', () => {
  const scene = createSceneModel({
    revision: '4',
    fog: { width: 10, height: 10 },
    tokens: [{ id: 'public', label: 'Visible', kind: 'player', x: 1, y: 2, width: 1, height: 1, isVisible: true }],
    dm: {
      secretToken: { id: 'secret', label: 'Ambush', kind: 'enemy', x: 8, y: 8, width: 1, height: 1 },
      notes: ['do not leak'],
    },
  });

  assert.equal(scene.tokens.length, 1);
  assert.equal(scene.tokens[0].id, 'public');
  assert.doesNotMatch(JSON.stringify(scene), /secret|Ambush|do not leak/);
  assert.equal('dm' in scene, false);
});

