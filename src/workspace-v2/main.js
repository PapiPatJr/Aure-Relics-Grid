const SESSION_ROUTE = /^#session\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

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

export async function startWorkspaceV2({
  root = globalThis.document?.getElementById('workspaceV2'),
  hash = globalThis.location?.hash ?? '#demo',
  client,
} = {}) {
  if (!root) throw new Error('Workspace V2 requires a #workspaceV2 mount point.');

  const route = parseWorkspaceRoute(hash);
  root.dataset.workspaceMode = route.mode;

  if (route.mode === 'demo') {
    renderStatus(root, 'Aure Relics Workspace V2', 'Isolated canvas workspace demo');
    return { route, root };
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
