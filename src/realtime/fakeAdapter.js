/**
 * Deterministic test double implementing the SyncAdapter contract (see types.js). Not for
 * production use. Tests drive it directly — emitEvent/emitStatus/setHydrateResult — instead of
 * real timers or network I/O, so engine behavior stays fully deterministic under `node --test`.
 */
export function createFakeAdapter() {
  let hydrateImpl = async sessionId => ({ sessionId, revision: '0' });
  let mutateImpl = async (sessionId, command) => ({ ...command });
  const subscribers = new Map(); // sessionId -> { onEvent, onStatus }
  const calls = { hydrate: [], subscribe: [], mutate: [], disconnect: 0 };
  let invalidationCounter = 0;

  return {
    calls,

    /** @param {(sessionId: string) => Promise<import('./types.js').SessionSnapshot>} fn */
    setHydrateResult(fn) { hydrateImpl = fn; },
    /** @param {(sessionId: string, command: import('./types.js').MutationCommand) => Promise<unknown>} fn */
    setMutateResult(fn) { mutateImpl = fn; },

    async hydrate(sessionId) {
      calls.hydrate.push(sessionId);
      return hydrateImpl(sessionId);
    },
    subscribe(sessionId, callbacks) {
      calls.subscribe.push(sessionId);
      subscribers.set(sessionId, callbacks);
      callbacks.onStatus('synced'); // deterministic transport readiness, not authorization
      return () => { if (subscribers.get(sessionId) === callbacks) subscribers.delete(sessionId); };
    },
    async mutate(sessionId, command) {
      calls.mutate.push({ sessionId, command });
      return mutateImpl(sessionId, command);
    },
    disconnect() { calls.disconnect += 1; },

    // Test control surface — simulates server-pushed activity a real adapter would deliver.
    /** Deliver a raw invalidation envelope (or any object) to the onEvent callback as-is. */
    emitEvent(sessionId, event) { subscribers.get(sessionId)?.onEvent(event); },
    /**
     * Convenience for the common case: deliver a minimal invalidation envelope matching the 8A
     * contract. `revision` must be passed as the exact decimal string for values beyond
     * Number.MAX_SAFE_INTEGER — round-tripping through a JS number loses precision before this
     * function ever sees it.
     */
    emitInvalidation(sessionId, revision, overrides = {}) {
      invalidationCounter += 1;
      subscribers.get(sessionId)?.onEvent({
        schemaVersion: 1,
        id: overrides.id ?? `evt-${invalidationCounter}`,
        sessionId,
        revision: typeof revision === 'string' ? revision : String(revision),
        type: overrides.type ?? 'session.invalidated',
      });
    },
    emitStatus(sessionId, status, detail) { subscribers.get(sessionId)?.onStatus(status, detail); },
    isSubscribed(sessionId) { return subscribers.has(sessionId); },
  };
}
