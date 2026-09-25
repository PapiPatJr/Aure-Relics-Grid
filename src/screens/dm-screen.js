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
  // The most recently rendered, already-authorized BoardView. Presentation-only: switching modes
  // never hydrates/subscribes/mutates — it just rerenders this same stored view under the new
  // mode, which is why the toggle can take effect with zero network activity.
  let lastView = null;
  let hasRenderedView = false;

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

  function renderStoredView() {
    if (presentationMode === 'dm') {
      apply(lastView);
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
    // Structurally read-only (post-review corrective pass): the preview must never render an
    // actionable [data-realtime-action] control, even given an adversarial lastView where
    // authority.canManage is true and authority.ownCharacterId matches a character — authority
    // itself is never touched here, only the rendering-only interactionMode gate.
    renderBoardView(previewPanel, deriveDisplayView(lastView, 'player'), { presentationMode: 'player', interactionMode: 'readOnly' });
  }

  function setPresentationMode(mode) {
    if (mode !== 'dm' && mode !== 'player') {
      throw new Error(`Unknown presentationMode: ${mode}`);
    }
    if (mode === presentationMode) return;
    presentationMode = mode;
    updateButtonLabel();
    if (mode === 'dm') hideAndClearPreviewPanel();
    // Rerender the last-known view immediately under the new mode — a presentation toggle must
    // never wait for the next realtime snapshot, which may not arrive for a long time (or ever)
    // if nothing else about the session changes.
    if (hasRenderedView) renderStoredView();
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
      lastView = view;
      hasRenderedView = true;
      renderStoredView();
    },

    getPresentationMode() {
      return presentationMode;
    },

    setPresentationMode,
  };
}
