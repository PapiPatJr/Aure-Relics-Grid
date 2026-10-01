import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampCamera,
  createCamera,
  fitBounds,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../src/workspace-v2/camera.js';

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
}

test('world and screen transforms are exact inverses', () => {
  const camera = createCamera({ x: 120, y: -35, zoom: 1.75 });
  const world = { x: 314.25, y: -96.5 };
  const screen = worldToScreen(world, camera);
  const restored = screenToWorld(screen, camera);

  closeTo(restored.x, world.x, 'x coordinate');
  closeTo(restored.y, world.y, 'y coordinate');
});

test('zoomAt preserves the world point beneath the cursor and clamps zoom', () => {
  const camera = createCamera({ x: 40, y: 80, zoom: 1 });
  const cursor = { x: 520, y: 260 };
  const before = screenToWorld(cursor, camera);
  const zoomed = zoomAt(camera, cursor, 2.25);
  const after = screenToWorld(cursor, zoomed);

  closeTo(after.x, before.x, 'anchored world x');
  closeTo(after.y, before.y, 'anchored world y');
  assert.equal(zoomAt(camera, cursor, 99).zoom, 3);
  assert.equal(zoomAt(camera, cursor, 0.01).zoom, 0.25);
});

test('panBy applies screen-space deltas without mutating the camera', () => {
  const camera = createCamera({ x: 10, y: 20, zoom: 2 });
  assert.deepEqual(panBy(camera, { x: -15, y: 8 }), {
    x: -5,
    y: 28,
    zoom: 2,
    minZoom: 0.25,
    maxZoom: 3,
  });
  assert.equal(camera.x, 10);
});

test('fitBounds centers the world bounds inside the padded viewport', () => {
  const camera = createCamera({});
  const fitted = fitBounds(
    camera,
    { x: 100, y: 50, width: 800, height: 400 },
    { width: 1000, height: 700 },
    50,
  );

  assert.equal(fitted.zoom, 1.125);
  assert.deepEqual(worldToScreen({ x: 500, y: 250 }, fitted), { x: 500, y: 350 });
});

test('createCamera and clampCamera sanitize non-finite and inverted ranges', () => {
  assert.deepEqual(createCamera({ x: Number.NaN, y: Infinity, zoom: -Infinity }), {
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.25,
    maxZoom: 3,
  });

  const sanitized = clampCamera({
    x: -Infinity,
    y: Number.NaN,
    zoom: Infinity,
    minZoom: 5,
    maxZoom: 1,
  });
  assert.ok(Object.values(sanitized).every(Number.isFinite));
  assert.equal(sanitized.minZoom, 0.25);
  assert.equal(sanitized.maxZoom, 3);
  assert.equal(sanitized.zoom, 1);
});

test('degenerate fit inputs remain finite and safe', () => {
  const fitted = fitBounds(
    createCamera({ x: 7, y: 9, zoom: 1.5 }),
    { x: 0, y: 0, width: 0, height: Number.NaN },
    { width: Infinity, height: 0 },
  );
  assert.ok(Object.values(fitted).every(Number.isFinite));
  assert.equal(fitted.zoom, 1.5);
});

