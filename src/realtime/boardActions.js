import { createMutationBridge, mutateWithConflictRecovery } from './mutationBridge.js';

/**
 * Wires the minimal interactive controls already rendered inside the read-only realtime panel
 * (script.js's applyRealtimeSnapshot / window.aureRelicsApplyRealtimeSnapshot, driven by
 * boardBridge.js's BoardView) to mutationBridge, for exactly the four Issue #8A-supported
 * commands (session.setRound, token.setPublicState, initiative.set, character.update). No new UI
 * surface — this only makes the existing panel's own `[data-realtime-action]` buttons functional;
 * it never introduces movement/fog/terrain commands or a generic mutation path.
 *
 * Every control here is gated client-side by the same authority fields the snapshot already
 * carries (`view.authority.canManage`, `view.authority.ownCharacterId`) purely for UX — hiding an
 * obviously-unauthorized control avoids a doomed round trip. It grants nothing: the backend
 * re-validates every mutation regardless, exactly as it always has.
 *
 * @param {ReturnType<import('./engine.js').createSyncEngine>} engine
 * @param {() => string|null} getSessionId Returns the currently active session id, or null.
 * @param {() => import('./boardBridge.js').BoardView|null} getView Returns the currently rendered view, or null.
 * @param {{ addEventListener: Function, removeEventListener: Function }|null} [root] Injectable for tests; defaults to `document`.
 * @param {(result: object) => void} [onResult] Reports success/failure for the still-active session, including conflicts.
 * @returns {() => void} Idempotent cleanup function that removes the listener.
 */
export function wireRealtimeBoardActions(engine, getSessionId, getView, root = typeof document !== 'undefined' ? document : null, onResult = () => {}) {
  if (!root) return () => {};
  const bridge = createMutationBridge(engine);
  let attached = true;

  async function handleClick(event) {
    const button = event.target?.closest?.('[data-realtime-action]');
    if (!button) return;
    const sessionId = getSessionId();
    const view = getView();
    if (!sessionId || !view) return;
    const context = engine.getContext?.();
    const submit = async mutate => {
      const result = await mutateWithConflictRecovery(engine, sessionId, mutate);
      if (attached && context === engine.getContext?.() && sessionId === getSessionId()) onResult(result);
    };

    if (button.dataset.realtimeAction === 'advance-round') {
      await submit(() => bridge.setRound(sessionId, (Number(view.roundNumber) || 0) + 1));
      return;
    }

    if (button.dataset.realtimeAction === 'toggle-token-visible') {
      const token = view.tokens.find(t => t.id === button.dataset.tokenId);
      if (!token) return;
      await submit(() => bridge.setTokenPublicState(sessionId, {
        tokenId: token.id, label: token.label, conditionLabel: token.conditionLabel, isVisible: !token.isVisible,
      }));
      return;
    }

    if (button.dataset.realtimeAction === 'clear-initiative') {
      await submit(() => bridge.setInitiative(sessionId, []));
      return;
    }

    if (button.dataset.realtimeAction === 'adjust-own-hp') {
      const character = view.characters.find(c => c.id === button.dataset.characterId);
      if (!character) return;
      const delta = Number(button.dataset.delta) || 0;
      await submit(() => bridge.updateCharacter(sessionId, {
        characterId: character.id, name: character.name, playerName: character.playerName,
        hp: (Number(character.hp) || 0) + delta, maxHp: character.maxHp, tempHp: character.tempHp,
        ac: character.ac, speed: character.speed, statuses: character.statuses, publicNotes: character.publicNotes,
      }));
    }
  }

  root.addEventListener('click', handleClick);
  return () => {
    if (!attached) return;
    attached = false;
    root.removeEventListener('click', handleClick);
  };
}
