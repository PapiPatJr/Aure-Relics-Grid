import { deriveDisplayView } from '../board/displayView.js';
import { renderBoardView } from '../board/boardViewRenderer.js';

/**
 * @param {HTMLElement} root
 * @returns {{ render(view: object|null): void, dispose(): void }}
 */
export function mountPlayerScreen(root) {
  const doc = root.ownerDocument;
  let panel = doc.createElement('section');
  panel.id = 'playerBoardPanel';
  panel.className = 'realtime-session-panel player-board-panel';
  panel.setAttribute('aria-label', 'Your session board');
  panel.hidden = true;
  root.appendChild(panel);

  return {
    render(view) {
      if (!panel) return;
      // A genuine player-recipient view (authority.canManage: false) is already the backend's
      // authorized per-player projection and renders interactively (own-character HP controls
      // work). If this route is ever reached with a manager-shaped view (e.g. a DM navigating
      // directly to play/<sessionId>), deriveDisplayView already reduces it to the generic public
      // projection — render it read-only too, for the same reason the DM preview is read-only.
      const interactionMode = view?.authority?.canManage ? 'readOnly' : 'interactive';
      renderBoardView(panel, deriveDisplayView(view, 'player'), { presentationMode: 'player', interactionMode });
    },
    dispose() {
      panel?.remove();
      panel = null;
    },
  };
}
