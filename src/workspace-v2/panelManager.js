const MODES = new Set(['dropdown', 'dock-left', 'dock-right', 'floating', 'minimized', 'closed']);
const DEFAULT_POSITION = Object.freeze({ x: 96, y: 84 });

function normalizePanel(input) {
  const descriptor = typeof input === 'string' ? { id: input } : input;
  if (!descriptor || typeof descriptor.id !== 'string' || !descriptor.id.trim()) return null;
  const mode = MODES.has(descriptor.mode) ? descriptor.mode : 'closed';
  const position = descriptor.position && Number.isFinite(descriptor.position.x) && Number.isFinite(descriptor.position.y)
    ? { x: descriptor.position.x, y: descriptor.position.y }
    : { ...DEFAULT_POSITION };
  return {
    id: descriptor.id,
    mode,
    position,
    restoreMode: mode === 'minimized' ? 'dropdown' : mode,
  };
}

export function createPanelManager(initialPanels = []) {
  const panels = new Map();
  const listeners = new Set();
  for (const input of initialPanels) {
    const panel = normalizePanel(input);
    if (panel) panels.set(panel.id, panel);
  }

  function notify() {
    const snapshot = getState();
    for (const listener of listeners) listener(snapshot);
  }

  function update(id, change) {
    const current = panels.get(id);
    if (!current) return false;
    panels.set(id, { ...current, ...change });
    notify();
    return true;
  }

  function closeOtherDropdowns(id) {
    for (const [otherId, panel] of panels) {
      if (otherId !== id && panel.mode === 'dropdown') {
        panels.set(otherId, { ...panel, mode: 'closed', restoreMode: 'dropdown' });
      }
    }
  }

  function getState() {
    return {
      panels: [...panels.values()].map(panel => ({
        id: panel.id,
        mode: panel.mode,
        position: { ...panel.position },
      })),
    };
  }

  return {
    open(id) {
      const panel = panels.get(id);
      if (!panel) return false;
      const mode = panel.mode === 'minimized'
        ? (panel.restoreMode && !['closed', 'minimized'].includes(panel.restoreMode) ? panel.restoreMode : 'dropdown')
        : panel.mode === 'closed' ? 'dropdown' : panel.mode;
      if (mode === 'dropdown') closeOtherDropdowns(id);
      return update(id, { mode, restoreMode: mode });
    },
    dock(id, side) {
      if (!['left', 'right'].includes(side)) return false;
      return update(id, { mode: `dock-${side}`, restoreMode: `dock-${side}` });
    },
    float(id, position) {
      const panel = panels.get(id);
      if (!panel) return false;
      const nextPosition = position && Number.isFinite(position.x) && Number.isFinite(position.y)
        ? { x: Math.max(0, position.x), y: Math.max(0, position.y) }
        : panel.position;
      return update(id, { mode: 'floating', restoreMode: 'floating', position: nextPosition });
    },
    minimize(id) {
      const panel = panels.get(id);
      if (!panel) return false;
      const restoreMode = !['closed', 'minimized'].includes(panel.mode) ? panel.mode : panel.restoreMode;
      return update(id, { mode: 'minimized', restoreMode });
    },
    close(id) {
      return update(id, { mode: 'closed' });
    },
    getState,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

