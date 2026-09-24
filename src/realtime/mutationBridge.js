import { isRevisionConflict } from './engine.js';

/**
 * Thin, fully-typed wrappers over engine.mutate(sessionId, command) — one per currently
 * 8A-supported command. Only assembles the command shape; backend validation/bounds/authorization
 * stay exclusively server-side (see docs/issue-08a-realtime-contract.md's Mutation model). No
 * movement/fog/terrain command, and no generic/arbitrary mutation function, is introduced.
 *
 * `expectedRevision` is never a parameter here — engine.mutate() already attaches it from the
 * engine's own applied-snapshot watermark, so a caller of this bridge cannot supply a stale or
 * fabricated one even by accident.
 *
 * @param {ReturnType<import('./engine.js').createSyncEngine>} engine
 */
export function createMutationBridge(engine) {
  return {
    setRound: (sessionId, roundNumber) =>
      engine.mutate(sessionId, { type: 'session.setRound', payload: { roundNumber } }),

    setTokenPublicState: (sessionId, { tokenId, label, conditionLabel, isVisible }) =>
      engine.mutate(sessionId, { type: 'token.setPublicState', payload: { tokenId, label, conditionLabel, isVisible } }),

    setInitiative: (sessionId, entries) =>
      engine.mutate(sessionId, { type: 'initiative.set', payload: { entries } }),

    updateCharacter: (sessionId, character) =>
      engine.mutate(sessionId, { type: 'character.update', payload: character }),
  };
}

/**
 * Shared recovery flow for a single mutate() call:
 * - `40001` (stale expectedRevision) or `40P01` (aborted conflicting transaction, per the 8A
 *   contract) both re-hydrate so the caller's next attempt has a fresh applied revision, then
 *   return a conflict result. Neither ever re-attempts the mutation itself — no blind replay,
 *   and an aborted-transaction conflict is never reported as a success.
 * - Any other error is returned as a plain (non-conflict) failure, unmodified.
 * - A failed mutation never optimistically becomes state: the only way this function changes
 *   applied state is the explicit re-hydration on a conflict, never the failed mutate() call
 *   itself.
 *
 * @param {ReturnType<import('./engine.js').createSyncEngine>} engine
 * @param {string} sessionId
 * @param {() => Promise<unknown>} mutateFn Typically one of createMutationBridge(engine)'s functions, pre-bound to its arguments.
 * @returns {Promise<{ ok: true, result: unknown } | { ok: false, conflict: boolean, error: unknown }>}
 */
export async function mutateWithConflictRecovery(engine, sessionId, mutateFn) {
  const context = engine.getContext?.();
  try {
    const result = await mutateFn();
    return { ok: true, result };
  } catch (error) {
    if (isRevisionConflict(error) || error?.code === '40P01') {
      if (context === engine.getContext?.()) {
        await engine.hydrate(sessionId).catch(() => { /* already reported via the engine's own onStatus/onError */ });
      }
      return { ok: false, conflict: true, error };
    }
    return { ok: false, conflict: false, error };
  }
}
