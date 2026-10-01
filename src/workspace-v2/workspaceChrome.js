const TOP_BAR_LABELS = ['Party', 'Encounter', 'Tokens', 'Terrain', 'Map', 'Fog', 'Measure', 'Notes', 'Session', 'View'];

function slug(label) {
  return label.toLowerCase();
}

function panelElement(document, descriptor) {
  const panel = document.createElement('aside');
  panel.className = `workspace-panel workspace-panel--${descriptor.mode}`;
  panel.dataset.panelId = descriptor.id;
  panel.dataset.panelMode = descriptor.mode;
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', `${descriptor.label} panel`);
  if (descriptor.mode === 'floating') {
    panel.style.left = `${descriptor.position.x}px`;
    panel.style.top = `${descriptor.position.y}px`;
  }
  panel.innerHTML = `
    <header class="workspace-panel__header">
      <strong>${descriptor.label}</strong>
      <div class="workspace-panel__actions" aria-label="${descriptor.label} panel layout">
        <button type="button" data-panel-action="dock-left" aria-label="Dock left">◧</button>
        <button type="button" data-panel-action="dock-right" aria-label="Dock right">◨</button>
        <button type="button" data-panel-action="float" aria-label="Float panel">◇</button>
        <button type="button" data-panel-action="minimize" aria-label="Minimize panel">−</button>
        <button type="button" data-panel-action="close" aria-label="Close panel">×</button>
      </div>
    </header>
    <div class="workspace-panel__body">
      ${descriptor.id === 'fog'
        ? '<p>Fog tools are staged for Milestone 3. Workspace placement is live now.</p><label>Brush size <input type="range" min="1" max="8" value="3" /></label>'
        : `<p>${descriptor.label} tools will arrive in a later milestone.</p>`}
    </div>
  `;
  return panel;
}

export function mountWorkspaceChrome({ root, panelManager, onToolSelect = () => {} }) {
  if (!root || !panelManager) throw new Error('mountWorkspaceChrome requires root and panelManager.');
  const document = root.ownerDocument;
  root.replaceChildren();

  const shell = document.createElement('section');
  shell.className = 'workspace-v2-shell';
  shell.innerHTML = `
    <header class="workspace-v2-topbar">
      <strong class="workspace-v2-brand">Aure Relics<span class="workspace-v2-sr-only"> Workspace V2</span></strong>
      <nav class="workspace-v2-tools" aria-label="Workspace tools">
        ${TOP_BAR_LABELS.map(label => `<button type="button" data-open-panel="${slug(label)}">${label}</button>`).join('')}
      </nav>
    </header>
    <div class="workspace-v2-body">
      <div class="workspace-v2-dock workspace-v2-dock--left" data-dock="left"></div>
      <div class="workspace-v2-canvas" aria-label="Aure Relics board canvas"></div>
      <div class="workspace-v2-dock workspace-v2-dock--right" data-dock="right"></div>
      <div class="workspace-v2-panel-overlay"></div>
      <div class="workspace-v2-minimized" aria-label="Minimized panels"></div>
    </div>
  `;
  root.append(shell);

  const boardRoot = shell.querySelector('.workspace-v2-canvas');
  const leftDock = shell.querySelector('[data-dock="left"]');
  const rightDock = shell.querySelector('[data-dock="right"]');
  const overlay = shell.querySelector('.workspace-v2-panel-overlay');
  const minimized = shell.querySelector('.workspace-v2-minimized');
  const labels = new Map(TOP_BAR_LABELS.map(label => [slug(label), label]));

  function render(state = panelManager.getState()) {
    leftDock.replaceChildren();
    rightDock.replaceChildren();
    overlay.replaceChildren();
    minimized.replaceChildren();
    shell.classList.remove('has-left-dock', 'has-right-dock');

    for (const descriptor of state.panels) {
      const label = labels.get(descriptor.id) ?? descriptor.id;
      if (descriptor.mode === 'closed') continue;
      if (descriptor.mode === 'minimized') {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.dataset.restorePanel = descriptor.id;
        restore.setAttribute('aria-label', `Restore ${label} panel`);
        restore.textContent = label;
        minimized.append(restore);
        continue;
      }
      const panel = panelElement(document, { ...descriptor, label });
      if (descriptor.mode === 'dock-left') {
        shell.classList.add('has-left-dock');
        leftDock.append(panel);
      } else if (descriptor.mode === 'dock-right') {
        shell.classList.add('has-right-dock');
        rightDock.append(panel);
      } else {
        overlay.append(panel);
      }
    }

    for (const button of shell.querySelectorAll('[data-open-panel]')) {
      const descriptor = state.panels.find(panel => panel.id === button.dataset.openPanel);
      button.setAttribute('aria-expanded', String(Boolean(descriptor && descriptor.mode !== 'closed')));
    }
  }

  function handleClick(event) {
    const openButton = event.target.closest('[data-open-panel]');
    if (openButton) {
      const id = openButton.dataset.openPanel;
      const current = panelManager.getState().panels.find(panel => panel.id === id);
      if (current?.mode === 'dropdown') panelManager.close(id);
      else panelManager.open(id);
      onToolSelect(id);
      return;
    }

    const restoreButton = event.target.closest('[data-restore-panel]');
    if (restoreButton) {
      panelManager.open(restoreButton.dataset.restorePanel);
      return;
    }

    const actionButton = event.target.closest('[data-panel-action]');
    if (!actionButton) return;
    const id = actionButton.closest('[data-panel-id]')?.dataset.panelId;
    const action = actionButton.dataset.panelAction;
    if (action === 'dock-left') panelManager.dock(id, 'left');
    if (action === 'dock-right') panelManager.dock(id, 'right');
    if (action === 'float') panelManager.float(id);
    if (action === 'minimize') panelManager.minimize(id);
    if (action === 'close') panelManager.close(id);
  }

  shell.addEventListener('click', handleClick);
  const unsubscribe = panelManager.subscribe(render);
  render();

  return {
    shell,
    boardRoot,
    render,
    destroy() {
      unsubscribe();
      shell.removeEventListener('click', handleClick);
      shell.remove();
    },
  };
}

export { TOP_BAR_LABELS };
