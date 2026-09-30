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
// Client-side sanity only (blank/non-integer/negative) — the backend remains the sole authority
// on range/bounds (grid extent, token footprint); see supabase/migrations/20260928233027_
// tuesday_online_gameplay_commands.sql's token.create/token.move validation, never duplicated here.
function parseGridCoordinate(raw) {
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

export function wireRealtimeBoardActions(engine, getSessionId, getView, root = typeof document !== 'undefined' ? document : null, onResult = () => {}) {
  if (!root) return () => {};
  const bridge = createMutationBridge(engine);
  let attached = true;

  function makeSubmit(sessionId, context) {
    return async (mutate, triggerButton = null) => {
      if (triggerButton) triggerButton.disabled = true;
      try {
        const result = await mutateWithConflictRecovery(engine, sessionId, mutate);
        if (attached && context === engine.getContext?.() && sessionId === getSessionId()) onResult(result);
      } finally {
        if (triggerButton) triggerButton.disabled = false;
      }
    };
  }

  async function handleClick(event) {
    const button = event.target?.closest?.('[data-realtime-action]');
    if (!button) return;
    const sessionId = getSessionId();
    const view = getView();
    if (!sessionId || !view) return;
    const submit = makeSubmit(sessionId, engine.getContext?.());

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
      return;
    }

    // --- Tuesday Online Package 2C: DM gameplay authoring controls ---

    if (button.dataset.realtimeAction === 'prepare-board') {
      await submit(() => bridge.prepareBoard(sessionId), button);
      return;
    }

    if (button.dataset.realtimeAction === 'next-turn') {
      await submit(() => bridge.advanceInitiative(sessionId), button);
      return;
    }

    if (button.dataset.realtimeAction === 'delete-token') {
      const token = view.tokens.find(t => t.id === button.dataset.tokenId);
      if (!token) return;
      await submit(() => bridge.deleteToken(sessionId, { tokenId: token.id }), button);
      return;
    }

    if (button.dataset.realtimeAction === 'move-token') {
      const token = view.tokens.find(t => t.id === button.dataset.tokenId);
      if (!token) return;
      const wrapper = button.closest('[data-token-move-form]');
      const x = parseGridCoordinate(wrapper?.querySelector('[data-move-x]')?.value);
      const y = parseGridCoordinate(wrapper?.querySelector('[data-move-y]')?.value);
      if (x === null || y === null) return;
      await submit(() => bridge.moveToken(sessionId, { tokenId: token.id, x, y }), button);
    }
  }

  async function handleSubmit(event) {
    const form = event.target?.closest?.('form[data-realtime-action]');
    if (!form) return;
    event.preventDefault();
    const sessionId = getSessionId();
    const view = getView();
    if (!sessionId || !view) return;
    const submitButton = form.querySelector('button[type="submit"], button:not([type])');
    const submit = makeSubmit(sessionId, engine.getContext?.());

    if (form.dataset.realtimeAction === 'create-token') {
      // Read fields directly (never `new FormData(form)`): FormData only works when the global
      // FormData constructor and the form element share a realm, which a caller-owned `root`
      // document (e.g. a test's own JSDOM window) cannot guarantee — this module has no reason
      // to require that.
      const kind = form.elements.namedItem('kind')?.value;
      const label = (form.elements.namedItem('label')?.value ?? '').trim();
      const x = parseGridCoordinate(form.elements.namedItem('x')?.value);
      const y = parseGridCoordinate(form.elements.namedItem('y')?.value);
      const isVisible = Boolean(form.elements.namedItem('isVisible')?.checked);
      const characterId = kind === 'player' ? (form.elements.namedItem('characterId')?.value || null) : null;
      if (!label || x === null || y === null) return;
      if (kind === 'player' && !characterId) return;
      await submit(() => bridge.createToken(sessionId, { kind, characterId, label, x, y, isVisible }), submitButton);
      return;
    }

    if (form.dataset.realtimeAction === 'submit-initiative') {
      // Preserve whichever entry is already the active turn (if still included) rather than
      // silently deactivating an in-progress encounter on every roster edit — Next Turn
      // (initiative.advance) is the only thing that ever picks a *new* active entry.
      const previouslyActive = new Set((view.initiative || []).filter(e => e.isActive).map(e => e.tokenId));
      const rows = Array.from(form.querySelectorAll('[data-initiative-row]'))
        .filter(row => row.querySelector('[data-initiative-include]')?.checked)
        .map(row => ({
          tokenId: row.dataset.tokenId,
          initiative: Number(row.querySelector('[data-initiative-value]')?.value) || 0,
        }));
      rows.sort((a, b) => b.initiative - a.initiative);
      const entries = rows.map((row, position) => ({
        tokenId: row.tokenId, initiative: row.initiative, position, isActive: previouslyActive.has(row.tokenId),
      }));
      await submit(() => bridge.setInitiative(sessionId, entries), submitButton);
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('submit', handleSubmit);
  return () => {
    if (!attached) return;
    attached = false;
    root.removeEventListener('click', handleClick);
    root.removeEventListener('submit', handleSubmit);
  };
}
