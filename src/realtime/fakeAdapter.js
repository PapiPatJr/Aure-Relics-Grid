/**
 * Deterministic test double implementing the SyncAdapter contract (see types.js). Not for
 * production use. Tests drive it directly — emitEvent/emitStatus/setHydrateResult — instead of
 * real timers or network I/O, so engine behavior stays fully deterministic under `node --test`.
 */
export function createFakeAdapter() {
  let hydrateImpl = async sessionId => ({ sessionId, revision: 0, state: {} });
  let mutateImpl = async (sessionId, command) => ({ ...command });
  const subscribers = new Map(); // sessionId -> { onEvent, onStatus }
  const calls = { hydrate: [], subscribe: [], mutate: [], disconnect: 0 };

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
      return () => { if (subscribers.get(sessionId) === callbacks) subscribers.delete(sessionId); };
    },
    async mutate(sessionId, command) {
      calls.mutate.push({ sessionId, command });
      return mutateImpl(sessionId, command);
    },
    disconnect() { calls.disconnect += 1; },

    // Test control surface — simulates server-pushed activity a real adapter would deliver.
    emitEvent(sessionId, event) { subscribers.get(sessionId)?.onEvent(event); },
    emitStatus(sessionId, status, detail) { subscribers.get(sessionId)?.onStatus(status, detail); },
    isSubscribed(sessionId) { return subscribers.has(sessionId); },
  };
}
