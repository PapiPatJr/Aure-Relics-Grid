import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import config from '../vite.config.js';

test('raw offline board remains visible while Vite gates the board until initialization', () => {
  const source = readFileSync('index.html', 'utf8');
  const offline = new JSDOM(source);
  assert.equal(offline.window.document.querySelector('#legacyBoard').hidden, false);
  assert.ok(offline.window.document.querySelector('script[src="script.js"]'));
  const transformed = config.plugins[0].transformIndexHtml.handler(source);
  const online = new JSDOM(transformed);
  assert.equal(online.window.document.querySelector('#legacyBoard').hidden, true);
  assert.ok(online.window.document.querySelector('script[type="module"][src="/src/main.js"]'));
  for (const id of ['appLayout', 'sidebarPanel', 'grid', 'dmNotesText', 'combatantModal']) {
    assert.ok(online.window.document.querySelector(`#legacyBoard #${id}`), `${id} retained within board`);
  }
  offline.window.close(); online.window.close();
});
