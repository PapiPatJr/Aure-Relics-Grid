const EDGE_MARGIN = 48;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function capturePointer(element, pointerId) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic events and older touch implementations may not support capture.
  }
}

export function mountRadialMenu({ root, tools, activeTool, onSelect = () => {} }) {
  if (!root || !Array.isArray(tools) || tools.length === 0) {
    throw new Error('mountRadialMenu requires a root and tools.');
  }
  const document = root.ownerDocument;
  const element = document.createElement('div');
  element.className = 'workspace-radial';
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', 'Quick tools');

  const center = document.createElement('button');
  center.type = 'button';
  center.className = 'workspace-radial__center';
  center.dataset.radialCenter = '';
  center.setAttribute('aria-label', 'Toggle quick tools');
  center.setAttribute('aria-expanded', 'true');
  center.textContent = '✦';
  element.append(center);

  const buttons = new Map();
  tools.forEach((tool, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-radial__tool';
    button.dataset.radialTool = tool.id;
    button.setAttribute('aria-label', tool.label);
    button.title = tool.label;
    button.textContent = tool.label.slice(0, 1).toUpperCase();
    const angle = -Math.PI / 2 + (index / tools.length) * Math.PI * 2;
    button.style.setProperty('--radial-x', `${Math.cos(angle) * 66}px`);
    button.style.setProperty('--radial-y', `${Math.sin(angle) * 66}px`);
    element.append(button);
    buttons.set(tool.id, button);
  });
  root.append(element);

  let selectedTool = buttons.has(activeTool) ? activeTool : tools[0].id;
  let collapsed = false;
  let position = { x: 120, y: 120 };
  let drag = null;
  let suppressClick = false;

  function renderSelection() {
    for (const [id, button] of buttons) {
      button.setAttribute('aria-pressed', String(id === selectedTool));
    }
  }

  function renderCollapsed() {
    element.dataset.collapsed = String(collapsed);
    center.setAttribute('aria-expanded', String(!collapsed));
    for (const button of buttons.values()) button.hidden = collapsed;
  }

  function setPosition(next) {
    const rect = root.getBoundingClientRect();
    const width = rect.width || root.ownerDocument.defaultView.innerWidth;
    const height = rect.height || root.ownerDocument.defaultView.innerHeight;
    position = {
      x: clamp(Number.isFinite(next?.x) ? next.x : position.x, EDGE_MARGIN, Math.max(EDGE_MARGIN, width - EDGE_MARGIN)),
      y: clamp(Number.isFinite(next?.y) ? next.y : position.y, EDGE_MARGIN, Math.max(EDGE_MARGIN, height - EDGE_MARGIN)),
    };
    element.dataset.x = String(position.x);
    element.dataset.y = String(position.y);
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
  }

  function collapse() {
    collapsed = true;
    renderCollapsed();
  }

  function expand() {
    collapsed = false;
    renderCollapsed();
  }

  function handleToolClick(event) {
    const button = event.target.closest('[data-radial-tool]');
    if (!button) return;
    selectedTool = button.dataset.radialTool;
    renderSelection();
    onSelect(selectedTool);
  }

  function handleCenterClick() {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (collapsed) expand();
    else collapse();
  }

  function handlePointerDown(event) {
    drag = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      position: { ...position },
      moved: false,
    };
    capturePointer(center, event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.origin.x;
    const dy = event.clientY - drag.origin.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    setPosition({ x: drag.position.x + dx, y: drag.position.y + dy });
    event.preventDefault();
  }

  function handlePointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClick = drag.moved;
    drag = null;
    if (suppressClick) {
      element.ownerDocument.defaultView.setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
  }

  element.addEventListener('click', handleToolClick);
  center.addEventListener('click', handleCenterClick);
  center.addEventListener('pointerdown', handlePointerDown);
  center.addEventListener('pointermove', handlePointerMove);
  center.addEventListener('pointerup', handlePointerUp);
  center.addEventListener('pointercancel', handlePointerUp);
  renderSelection();
  renderCollapsed();
  setPosition(position);

  return {
    collapse,
    expand,
    setPosition,
    destroy() {
      element.removeEventListener('click', handleToolClick);
      center.removeEventListener('click', handleCenterClick);
      center.removeEventListener('pointerdown', handlePointerDown);
      center.removeEventListener('pointermove', handlePointerMove);
      center.removeEventListener('pointerup', handlePointerUp);
      center.removeEventListener('pointercancel', handlePointerUp);
      element.remove();
    },
  };
}
