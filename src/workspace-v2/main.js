const SESSION_ROUTE = /^#session\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

import { createCamera, fitBounds } from './camera.js';
import { createSceneModel } from './sceneModel.js';

export function parseWorkspaceRoute(hash = '') {
  if (hash === '#demo') return { mode: 'demo' };
  const match = SESSION_ROUTE.exec(hash);
  if (match) return { mode: 'session', sessionId: match[1] };
  return { mode: 'invalid' };
}

function renderStatus(root, title, message) {
  root.replaceChildren();
  const section = root.ownerDocument.createElement('section');
  section.className = 'workspace-v2-status';
  const heading = root.ownerDocument.createElement('h1');
  heading.textContent = title;
  const copy = root.ownerDocument.createElement('p');
  copy.textContent = message;
  section.append(heading, copy);
  root.append(section);
}

async function mountDemoWorkspace(root) {
  root.replaceChildren();
  const shell = root.ownerDocument.createElement('section');
  shell.className = 'workspace-v2-shell';
  shell.innerHTML = `
    <header class="workspace-v2-placeholder-bar">
      <strong>Aure Relics</strong><span>Workspace V2</span>
    </header>
    <div class="workspace-v2-canvas" aria-label="Aure Relics board canvas"></div>
  `;
  root.append(shell);
  const container = shell.querySelector('.workspace-v2-canvas');

  if (typeof ResizeObserver === 'undefined') return { shell, stageController: null };

  const [{ createWorkspaceStage }] = await Promise.all([
    import('./stage.js'),
  ]);
  const width = Math.max(1, container.clientWidth || globalThis.innerWidth || 1);
  const height = Math.max(1, container.clientHeight || globalThis.innerHeight || 1);
  let camera = fitBounds(
    createCamera(),
    { x: 0, y: 0, width: 40 * 64, height: 40 * 64 },
    { width, height },
  );
  const stageController = createWorkspaceStage({ container, width, height, camera });
  stageController.render(createSceneModel({
    revision: 'demo',
    fog: { width: 40, height: 40 },
    tokens: [
      { id: 'demo-hero', label: 'Aria', kind: 'player', x: 8, y: 7, width: 1, height: 1, isVisible: true },
      { id: 'demo-enemy', label: 'Goblin', kind: 'enemy', x: 13, y: 10, width: 1, height: 1, isVisible: true },
    ],
  }));
  stageController.setCamera(camera);

  const observer = new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect;
    if (rect?.width && rect?.height) stageController.resize(rect.width, rect.height);
  });
  observer.observe(container);

  return {
    shell,
    stageController,
    destroy() {
      observer.disconnect();
      stageController.destroy();
    },
  };
}

export async function startWorkspaceV2({
  root = globalThis.document?.getElementById('workspaceV2'),
  hash = globalThis.location?.hash ?? '#demo',
  client,
} = {}) {
  if (!root) throw new Error('Workspace V2 requires a #workspaceV2 mount point.');

  const route = parseWorkspaceRoute(hash);
  root.dataset.workspaceMode = route.mode;

  if (route.mode === 'demo') {
    const workspace = await mountDemoWorkspace(root);
    return { route, root, workspace };
  }

  if (route.mode === 'session') {
    let sessionClient = client;
    if (!sessionClient) {
      const { getSupabaseClient } = await import('../supabase/client.js');
      sessionClient = getSupabaseClient();
    }
    if (!sessionClient) {
      renderStatus(root, 'Workspace unavailable', 'Session access requires Supabase configuration.');
      return { route, root, client: null };
    }
    renderStatus(root, 'Aure Relics Workspace V2', `Session ${route.sessionId}`);
    return { route, root, client: sessionClient };
  }

  renderStatus(root, 'Workspace route not found', 'Use #demo or #session/<session-id>.');
  return { route, root };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('workspaceV2');
  if (root) void startWorkspaceV2({ root });
}
