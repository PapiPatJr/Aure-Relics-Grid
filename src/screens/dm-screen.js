/**
 * DM God Screen presentation toggle. Structural guarantee (Locked Rule C): this module receives
 * only already-hydrated BoardView objects handed to it by whoever calls render(view), plus an
 * apply() callback — it never imports anything that could hydrate, subscribe, or mutate a
 * session, so "DM View <-> Player View is presentation-only" is provable from this file's import
 * list alone, not just from a runtime check.
 */
import { deriveDisplayView } from '../board/displayView.js';
import { renderBoardView } from '../board/boardViewRenderer.js';

/**
 * @param {{ apply: (view: object|null) => void, container: HTMLElement }} options
 * @returns {{
 *   activate(): void,
 *   deactivate(): void,
 *   render(view: object|null): void,
 *   getPresentationMode(): 'dm'|'player',
 *   setPresentationMode(mode: 'dm'|'player'): void,
 * }}
 */
export function createDmScreen({ apply, container }) {
  let presentationMode = 'dm';
  let toggleButton = null;
  let previewPanel = null;

  function labelForMode(mode) {
    return mode === 'dm' ? 'Preview as player' : 'Return to DM view';
  }

  function updateButtonLabel() {
    if (toggleButton) toggleButton.textContent = labelForMode(presentationMode);
  }

  function hideAndClearPreviewPanel() {
    if (!previewPanel) return;
    previewPanel.hidden = true;
    previewPanel.innerHTML = '';
  }

  function setPresentationMode(mode) {
    if (mode !== 'dm' && mode !== 'player') {
      throw new Error(`Unknown presentationMode: ${mode}`);
    }
    if (mode === presentationMode) return;
    presentationMode = mode;
    updateButtonLabel();
    if (mode === 'dm') hideAndClearPreviewPanel();
  }

  return {
    activate() {
      if (!toggleButton) {
        toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'dm-presentation-toggle';
        toggleButton.addEventListener('click', () => {
          setPresentationMode(presentationMode === 'dm' ? 'player' : 'dm');
        });
        updateButtonLabel();
        container.appendChild(toggleButton);
      }
      toggleButton.hidden = false;
    },

    deactivate() {
      if (toggleButton) toggleButton.hidden = true;
      hideAndClearPreviewPanel();
      presentationMode = 'dm';
      updateButtonLabel();
    },

    render(view) {
      if (presentationMode === 'dm') {
        apply(view);
        return;
      }

      apply(null);
      if (!previewPanel) {
        previewPanel = document.createElement('section');
        previewPanel.id = 'dmPreviewPanel';
        previewPanel.className = 'realtime-session-panel dm-preview-panel';
        previewPanel.hidden = true;
        document.body.appendChild(previewPanel);
      }
      renderBoardView(previewPanel, deriveDisplayView(view, 'player'), { presentationMode: 'player' });
    },

    getPresentationMode() {
      return presentationMode;
    },

    setPresentationMode,
  };
}
