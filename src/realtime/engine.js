import { SyncStatus } from './types.js';

let commandCounter = 0;
/** Locally-unique enough to correlate a mutate() call with its eventual echoed event. Never sent as a secret. */
function createCommandId() {
  commandCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `cmd-${Date.now()}-${commandCounter}`;
}

/**
 * Transport-neutral client synchronization engine. Wraps a SyncAdapter (see types.js) with
 * revision-ordered event application, reconnect/re-hydrate handling and local-echo tagging.
 * Holds only in-memory state — nothing here touches localStorage/sessionStorage.
 *
 * The engine never infers permission from UI state; every SyncStatus it reports comes from the
 * adapter (ultimately the backend). It does not gate mutate() on its own cached status — the
 * backend is the only authority, and a rejected mutation simply rejects the returned promise.
 *
 * @param {import('./types.js').SyncAdapter} adapter
 */
export function createSyncEngine(adapter) {
  let sessionId = null;
  let epoch = 0;
  let status = SyncStatus.IDLE;
  let lastRevision = -Infinity;
  let handlers = {};
  let unsubscribeAdapter = null;
  const pendingCommands = new Set();

  function setStatus(next, detail) {
    if (status === next) return;
    status = next;
    handlers.onStatus?.(next, detail);
  }

  /** Tears down any adapter subscription and revision/echo tracking for the current session. */
  function reset(nextSessionId) {
    unsubscribeAdapter?.();
    unsubscribeAdapter = null;
    sessionId = nextSessionId;
    lastRevision = -Infinity;
    pendingCommands.clear();
  }

  function teardown() {
    reset(null);
    handlers = {};
    setStatus(SyncStatus.IDLE);
  }

  function applyEvent(event) {
    if (event.sessionId !== sessionId) return; // not for the currently active session
    if (event.revision <= lastRevision) return; // duplicate or stale: suppressed, never forwarded
    lastRevision = event.revision;
    const isLocalEcho = Boolean(event.commandId && pendingCommands.has(event.commandId));
    if (isLocalEcho) pendingCommands.delete(event.commandId);
    handlers.onEvent?.({ ...event, isLocalEcho });
  }

  async function hydrate(targetSession) {
    const stamp = ++epoch;
    if (targetSession !== sessionId) reset(targetSession);
    setStatus(SyncStatus.HYDRATING);
    let snapshot;
    try {
      snapshot = await adapter.hydrate(targetSession);
    } catch (error) {
      if (stamp === epoch) { setStatus(SyncStatus.ERROR, { error }); handlers.onError?.(error); }
      throw error;
    }
    if (stamp !== epoch) return snapshot; // superseded by a later hydrate/subscribe/disconnect
    // Never move the watermark backward: a live event may have already landed ahead of this snapshot.
    if (snapshot.revision > lastRevision) {
      lastRevision = snapshot.revision;
      handlers.onSnapshot?.(snapshot);
    }
    setStatus(SyncStatus.SYNCED);
    return snapshot;
  }

  async function handleAdapterStatus(forSession, next, detail) {
    if (forSession !== sessionId) return; // stale callback from a torn-down subscription
    if (next === SyncStatus.SYNCED && status === SyncStatus.RECONNECTING) {
      // Re-hydrate after reconnect so nothing missed during the gap is silently dropped.
      try { await hydrate(forSession); } catch { /* hydrate() already reported ERROR */ }
      return;
    }
    setStatus(next, detail);
  }

  return {
    /** Fetch and apply current state for sessionId. Safe to call standalone or before subscribe(). */
    hydrate,

    /**
     * Start live sync for sessionId. Switching to a different session automatically cleans up the
     * previous one. Returns an idempotent unsubscribe function equivalent to disconnect().
     * @param {string} targetSession
     * @param {import('./types.js').SyncHandlers} [nextHandlers]
     */
    subscribe(targetSession, nextHandlers = {}) {
      if (targetSession !== sessionId) reset(targetSession);
      else unsubscribeAdapter?.();
      handlers = nextHandlers;
      unsubscribeAdapter = adapter.subscribe(targetSession, {
        onEvent: applyEvent,
        onStatus: (next, detail) => { void handleAdapterStatus(targetSession, next, detail); },
      });
      void hydrate(targetSession).catch(() => { /* reported via onStatus/onError above */ });
      return teardown;
    },

    /**
     * Submit a mutation for the currently active session. Rejects if no session is hydrated/subscribed
     * yet — a structural precondition, not a permission check. The backend remains the sole authority.
     * @param {string} targetSession
     * @param {import('./types.js').MutationCommand} command
     */
    async mutate(targetSession, command) {
      if (targetSession !== sessionId) throw new Error('Hydrate or subscribe to this session before mutating it.');
      const commandId = createCommandId();
      pendingCommands.add(commandId);
      try {
        return await adapter.mutate(targetSession, { ...command, commandId });
      } catch (error) {
        pendingCommands.delete(commandId);
        throw error;
      }
    },

    /** Unsubscribe, release adapter resources and return to idle. Idempotent. */
    disconnect() {
      teardown();
      adapter.disconnect();
    },

    getStatus: () => status,
    getSessionId: () => sessionId,
  };
}
