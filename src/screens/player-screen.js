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
      renderBoardView(panel, deriveDisplayView(view, 'player'), { presentationMode: 'player' });
    },
    dispose() {
      panel?.remove();
      panel = null;
    },
  };
}
