import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { mountRadialMenu } from '../src/workspace-v2/radialMenu.js';

const tools = [
  { id: 'select', label: 'Select' },
  { id: 'token', label: 'Token' },
  { id: 'fog', label: 'Fog' },
  { id: 'measure', label: 'Measure' },
  { id: 'pan', label: 'Pan' },
];

function setup(onSelect = () => {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  const root = dom.window.document.querySelector('#root');
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  const menu = mountRadialMenu({ root, tools, activeTool: 'select', onSelect });
  return { dom, root, menu };
}

function pointer(window, type, values) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  return event;
}

test('collapse and expand preserve the menu position', () => {
  const { dom, root, menu } = setup();
  menu.setPosition({ x: 260, y: 190 });
  menu.collapse();
  assert.equal(root.querySelector('[role="toolbar"]').dataset.collapsed, 'true');
  assert.equal(root.querySelectorAll('[data-radial-tool]:not([hidden])').length, 0);
  menu.expand();
  const element = root.querySelector('[role="toolbar"]');
  assert.equal(element.dataset.collapsed, 'false');
  assert.deepEqual({ x: Number(element.dataset.x), y: Number(element.dataset.y) }, { x: 260, y: 190 });
  dom.window.close();
});

test('tool buttons select locally and call onSelect with the selected id', () => {
  const selected = [];
  const { dom, root, menu } = setup(id => selected.push(id));
  root.querySelector('[data-radial-tool="fog"]').click();
  assert.deepEqual(selected, ['fog']);
  assert.equal(root.querySelector('[data-radial-tool="fog"]').getAttribute('aria-pressed'), 'true');
  assert.equal(root.querySelector('[data-radial-tool="select"]').getAttribute('aria-pressed'), 'false');
  menu.destroy();
  assert.equal(root.children.length, 0);
  dom.window.close();
});

test('setPosition clamps the menu center inside the viewport', () => {
  const { dom, root, menu } = setup();
  menu.setPosition({ x: -500, y: 900 });
  const element = root.querySelector('[role="toolbar"]');
  assert.deepEqual({ x: Number(element.dataset.x), y: Number(element.dataset.y) }, { x: 48, y: 552 });
  dom.window.close();
});

test('pointer drag moves the center without toggling collapse', () => {
  const { dom, root } = setup();
  const center = root.querySelector('[data-radial-center]');
  const element = root.querySelector('[role="toolbar"]');
  center.dispatchEvent(pointer(dom.window, 'pointerdown', { pointerId: 7, clientX: 120, clientY: 120 }));
  center.dispatchEvent(pointer(dom.window, 'pointermove', { pointerId: 7, clientX: 210, clientY: 165 }));
  center.dispatchEvent(pointer(dom.window, 'pointerup', { pointerId: 7, clientX: 210, clientY: 165 }));
  assert.deepEqual({ x: Number(element.dataset.x), y: Number(element.dataset.y) }, { x: 210, y: 165 });
  assert.equal(element.dataset.collapsed, 'false');
  dom.window.close();
});

