import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  parseWorkspaceRoute,
  startWorkspaceV2,
} from '../src/workspace-v2/main.js';

test('parses the isolated demo and session routes', () => {
  assert.deepEqual(parseWorkspaceRoute('#demo'), { mode: 'demo' });
  assert.deepEqual(
    parseWorkspaceRoute('#session/11111111-2222-4333-8444-555555555555'),
    {
      mode: 'session',
      sessionId: '11111111-2222-4333-8444-555555555555',
    },
  );
});

test('starts the V2 demo without importing or mounting the legacy board', async () => {
  const source = readFileSync('src/workspace-v2/main.js', 'utf8');
  assert.doesNotMatch(source, /bootLegacyPrototype|script\.js|legacyBoard/);

  const dom = new JSDOM('<main id="workspaceV2"></main>', {
    url: 'https://example.test/v2.html#demo',
  });
  const root = dom.window.document.querySelector('#workspaceV2');

  await startWorkspaceV2({ root, hash: '#demo' });

  assert.equal(root.dataset.workspaceMode, 'demo');
  assert.match(root.textContent, /Workspace V2/i);
  assert.equal(dom.window.document.querySelector('#legacyBoard'), null);
  dom.window.close();
});

