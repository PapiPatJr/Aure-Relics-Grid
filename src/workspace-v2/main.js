const SESSION_ROUTE = /^#session\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

import { createCamera, fitBounds, screenToWorld, zoomAt } from './camera.js';
import { attachCameraControls } from './cameraControls.js';
import { createSceneModel } from './sceneModel.js';
import { createPanelManager } from './panelManager.js';
import { mountWorkspaceChrome, TOP_BAR_LABELS } from './workspaceChrome.js';
import { mountRadialMenu } from './radialMenu.js';
import { mountRealtimeWorkspace } from './realtimeWorkspace.js';

const DEMO_VIEW = {
  revision: 'demo',
  fog: { width: 40, height: 40 },
  tokens: [
    { id: 'demo-hero', label: 'Aria', kind: 'player', x: 8, y: 7, width: 1, height: 1, isVisible: true },
    { id: 'demo-enemy', label: 'Goblin', kind: 'enemy', x: 13, y: 10, width: 1, height: 1, isVisible: true },
  ],
};

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

async function mountCanvasWorkspace(root, { initialView = DEMO_VIEW } = {}) {
  const panelManager = createPanelManager(TOP_BAR_LABELS.map(label => label.toLowerCase()));
  const chrome = mountWorkspaceChrome({ root, panelManager });
  const { shell, boardRoot: container } = chrome;
  container.innerHTML = `
    <div class="workspace-v2-stage"></div>
    <div class="workspace-v2-camera-controls" role="toolbar" aria-label="Board camera">
      <button type="button" data-camera-action="out" aria-label="Zoom out">−</button>
      <button type="button" data-camera-action="reset" aria-label="Reset zoom to 100%">100%</button>
      <button type="button" data-camera-action="in" aria-label="Zoom in">+</button>
      <button type="button" data-camera-action="fit" aria-label="Fit board">Fit</button>
      <button type="button" data-camera-action="hand" aria-label="Hand tool" aria-pressed="false">Hand</button>
    </div>
    <div class="workspace-v2-sync-status" role="status" hidden></div>
  `;
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
  const renderView = view => {
    const scene = createSceneModel(view);
    stageController.render(scene);
    container.dataset.sceneRevision = scene.revision ?? '';
    container.dataset.sceneTokenIds = scene.tokens.map(token => token.id).join(',');
    container.dataset.sceneTokens = JSON.stringify(scene.tokens.map(({ id, x, y }) => ({ id, x, y })));
  };
  renderView(initialView);
  let handMode = false;
  const zoomLabel = container.querySelector('[data-camera-action="reset"]');
  const handButton = container.querySelector('[data-camera-action="hand"]');
  const setHandMode = active => {
    handMode = active;
    handButton.setAttribute('aria-pressed', String(handMode));
    container.dataset.handMode = String(handMode);
    container.classList.toggle('is-hand-mode', handMode);
  };
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
    if (action === 'hand') setHandMode(!handMode);
  };
  container.addEventListener('click', onToolbarClick);
  setHandMode(false);

  const radialMenu = mountRadialMenu({
    root: container,
    tools: [
      { id: 'select', label: 'Select' },
      { id: 'token', label: 'Token' },
      { id: 'fog', label: 'Fog' },
      { id: 'measure', label: 'Measure' },
      { id: 'pan', label: 'Pan' },
    ],
    activeTool: 'select',
    onSelect(tool) {
      setHandMode(tool === 'pan');
    },
  });

  const observer = new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect;
    if (rect?.width && rect?.height) stageController.resize(rect.width, rect.height);
  });
  observer.observe(container);

  const syncStatus = container.querySelector('.workspace-v2-sync-status');
  const setSyncStatus = (message, tone = 'neutral') => {
    syncStatus.textContent = message ?? '';
    syncStatus.dataset.tone = tone;
    syncStatus.hidden = !message;
  };

  return {
    shell,
    stageController,
    renderView,
    setSyncStatus,
    destroy() {
      observer.disconnect();
      removeCameraControls();
      container.removeEventListener('click', onToolbarClick);
      radialMenu.destroy();
      stageController.destroy();
      chrome.destroy();
    },
  };
}

export async function startWorkspaceV2({
  root = globalThis.document?.getElementById('workspaceV2'),
  hash = globalThis.location?.hash ?? '#demo',
  client,
  mountWorkspace = mountCanvasWorkspace,
  mountRealtime = mountRealtimeWorkspace,
} = {}) {
  if (!root) throw new Error('Workspace V2 requires a #workspaceV2 mount point.');

  const route = parseWorkspaceRoute(hash);
  root.dataset.workspaceMode = route.mode;

  if (route.mode === 'demo') {
    const workspace = await mountWorkspace(root, { initialView: DEMO_VIEW });
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
    const workspace = await mountWorkspace(root, { initialView: null });
    workspace.setSyncStatus?.('Connecting…');
    const realtime = mountRealtime({
      client: sessionClient,
      sessionId: route.sessionId,
      onView(view) {
        workspace.renderView?.(view);
      },
      onStatus(status) {
        root.dataset.syncStatus = status;
        if (status === 'denied') {
          workspace.renderView?.(null);
          workspace.setSyncStatus?.('Access denied', 'error');
        } else if (status === 'synced') {
          workspace.setSyncStatus?.(null);
        } else if (status === 'error') {
          workspace.setSyncStatus?.('Unable to synchronize', 'error');
        } else {
          workspace.setSyncStatus?.('Synchronizing…');
        }
      },
      onError() {
        workspace.setSyncStatus?.('Unable to synchronize', 'error');
      },
    });
    return { route, root, client: sessionClient, workspace, realtime };
  }

  renderStatus(root, 'Workspace route not found', 'Use #demo or #session/<session-id>.');
  return { route, root };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('workspaceV2');
  if (root) void startWorkspaceV2({ root });
}
