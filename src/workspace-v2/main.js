const SESSION_ROUTE = /^#session\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

import { createCamera, fitBounds, screenToWorld, zoomAt } from './camera.js';
import { attachCameraControls } from './cameraControls.js';
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
    <div class="workspace-v2-canvas" aria-label="Aure Relics board canvas">
      <div class="workspace-v2-stage"></div>
      <div class="workspace-v2-camera-controls" role="toolbar" aria-label="Board camera">
        <button type="button" data-camera-action="out" aria-label="Zoom out">−</button>
        <button type="button" data-camera-action="reset" aria-label="Reset zoom to 100%">100%</button>
        <button type="button" data-camera-action="in" aria-label="Zoom in">+</button>
        <button type="button" data-camera-action="fit" aria-label="Fit board">Fit</button>
        <button type="button" data-camera-action="hand" aria-label="Hand tool" aria-pressed="false">Hand</button>
      </div>
    </div>
  `;
  root.append(shell);
  const container = shell.querySelector('.workspace-v2-canvas');
  const stageContainer = shell.querySelector('.workspace-v2-stage');

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
  const stageController = createWorkspaceStage({ container: stageContainer, width, height, camera });
  stageController.render(createSceneModel({
    revision: 'demo',
    fog: { width: 40, height: 40 },
    tokens: [
      { id: 'demo-hero', label: 'Aria', kind: 'player', x: 8, y: 7, width: 1, height: 1, isVisible: true },
      { id: 'demo-enemy', label: 'Goblin', kind: 'enemy', x: 13, y: 10, width: 1, height: 1, isVisible: true },
    ],
  }));
  let handMode = false;
  const zoomLabel = container.querySelector('[data-camera-action="reset"]');
  const handButton = container.querySelector('[data-camera-action="hand"]');
  const setCamera = nextCamera => {
    camera = createCamera(nextCamera);
    stageController.setCamera(camera);
    container.dataset.cameraX = String(camera.x);
    container.dataset.cameraY = String(camera.y);
    container.dataset.cameraZoom = String(camera.zoom);
    zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
  };
  const viewportCenter = () => ({ x: container.clientWidth / 2, y: container.clientHeight / 2 });
  const fitCamera = () => fitBounds(
    camera,
    { x: 0, y: 0, width: 40 * 64, height: 40 * 64 },
    { width: container.clientWidth, height: container.clientHeight },
  );
  setCamera(camera);

  const removeCameraControls = attachCameraControls({
    element: container,
    getCamera: () => camera,
    setCamera,
    screenToWorld,
    options: { isHandMode: () => handMode },
  });

  const onToolbarClick = event => {
    const action = event.target.closest('[data-camera-action]')?.dataset.cameraAction;
    if (!action) return;
    if (action === 'in') setCamera(zoomAt(camera, viewportCenter(), camera.zoom * 1.25));
    if (action === 'out') setCamera(zoomAt(camera, viewportCenter(), camera.zoom / 1.25));
    if (action === 'reset') setCamera(zoomAt(camera, viewportCenter(), 1));
    if (action === 'fit') setCamera(fitCamera());
    if (action === 'hand') {
      handMode = !handMode;
      handButton.setAttribute('aria-pressed', String(handMode));
      container.dataset.handMode = String(handMode);
      container.classList.toggle('is-hand-mode', handMode);
    }
  };
  container.addEventListener('click', onToolbarClick);

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
      removeCameraControls();
      container.removeEventListener('click', onToolbarClick);
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
