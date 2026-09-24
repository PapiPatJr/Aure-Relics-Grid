import { SyncStatus } from './types.js';

/**
 * Parse a revision. Must be a non-negative decimal string (no sign, no leading zeros except
 * "0" itself, digits only) — this is also what rejects a JS Number silently handed in by mistake.
 * Revisions are compared exclusively with BigInt: two revisions past Number.MAX_SAFE_INTEGER can
 * differ by 1 while rounding to the same double, and revision text can sort backward lexically
 * ("10" < "9"), so neither Number nor string comparison is safe here.
 * @param {string} revision
 * @returns {bigint}
 */
function toBigInt(revision) {
  if (typeof revision !== 'string' || !/^(0|[1-9]\d*)$/.test(revision)) {
    throw new Error('Revision must be a non-negative decimal string.');
  }
  return BigInt(revision);
}

/** True when `error` is the backend's optimistic-concurrency rejection (SQLSTATE 40001). Narrowly scoped: it only classifies the error, it never decides whether to retry. */
export function isRevisionConflict(error) {
  return Boolean(error) && error.code === '40001';
}

function createSessionContext(id) {
  return {
    id,
    appliedRevision: null, // bigint|null — last snapshot actually installed; the sole authoritative watermark
    observedRevision: null, // bigint|null — latest invalidation/snapshot revision seen; may run ahead of applied
    inFlightHydrate: null, // Promise<SessionSnapshot>|null
    rehydratePending: false, // an invalidation arrived while a hydrate for this session was already in flight
  };
}

/**
 * Transport-neutral client synchronization engine, aligned to the Issue #8A backend contract.
 * Wraps a SyncAdapter (see types.js) with revision-ordered snapshot installation, invalidation
 * -> coalesced re-hydration, and reconnect handling. Holds only in-memory state — nothing here
 * touches localStorage/sessionStorage.
 *
 * Invalidations never carry state and are never exposed to consumers as data: they only ever
 * trigger a secure re-hydration, whose resulting snapshot is the one authoritative delivery.
 * The engine never infers permission from UI state; every SyncStatus it reports comes from the
 * adapter (ultimately the backend). It does not gate mutate() on its own cached status — the
 * backend is the only authority. mutate() automatically attaches the current *applied* snapshot
 * revision as `expectedRevision`; an observed-but-not-yet-hydrated invalidation is never used
 * for that, and a rejected (e.g. stale, SQLSTATE 40001) mutation is never auto-replayed.
 *
 * @param {import('./types.js').SyncAdapter} adapter
 */
export function createSyncEngine(adapter) {
  let ctx = createSessionContext(null);
  let status = SyncStatus.IDLE;
  let handlers = {};
  let unsubscribeAdapter = null;

  function setStatus(next, detail) {
    if (status === next) return;
    status = next;
    handlers.onStatus?.(next, detail);
  }

  /** Tears down any adapter subscription and starts a fresh, independent context for nextId. Any hydrate still in flight for the old context becomes a harmless no-op (it checks `targetCtx === ctx` before installing anything or scheduling a follow-up). */
  function resetSession(nextId) {
    unsubscribeAdapter?.();
    unsubscribeAdapter = null;
    ctx = createSessionContext(nextId);
  }

  function teardown() {
    resetSession(null);
    handlers = {};
    setStatus(SyncStatus.IDLE);
  }

  async function performHydrate(targetCtx) {
    setStatus(SyncStatus.HYDRATING);
    let snapshot, revision;
    try {
      snapshot = await adapter.hydrate(targetCtx.id);
      revision = toBigInt(snapshot.revision);
    } catch (error) {
      if (targetCtx === ctx) { setStatus(SyncStatus.ERROR, { error }); handlers.onError?.(error); }
      throw error;
    }
    if (targetCtx !== ctx) return snapshot; // superseded by a session switch/disconnect
    // The sole authoritative watermark: only an installed snapshot ever advances it.
    if (targetCtx.appliedRevision === null || revision > targetCtx.appliedRevision) {
      targetCtx.appliedRevision = revision;
      handlers.onSnapshot?.(snapshot);
    }
    if (targetCtx.observedRevision === null || revision > targetCtx.observedRevision) targetCtx.observedRevision = revision;
    setStatus(SyncStatus.SYNCED);
    return snapshot;
  }

  /**
   * Runs at most one hydrate for targetCtx at a time. Callers that arrive while one is already
   * in flight (bootstrap subscribe racing a live invalidation, several invalidations arriving
   * back to back, a reconnect racing an invalidation, …) coalesce onto it instead of starting a
   * second concurrent request; if any of them observed something newer than what that in-flight
   * call ends up installing, exactly one follow-up hydrate runs afterward — never a storm of one
   * hydrate per invalidation.
   */
  function scheduleHydrate(targetCtx) {
    if (targetCtx.inFlightHydrate) {
      targetCtx.rehydratePending = true;
      return targetCtx.inFlightHydrate;
    }
    const attempt = performHydrate(targetCtx).finally(() => {
      targetCtx.inFlightHydrate = null;
      if (targetCtx.rehydratePending && targetCtx === ctx) {
        targetCtx.rehydratePending = false;
        scheduleHydrate(targetCtx).catch(() => { /* already reported via onStatus/onError */ });
      } else {
        targetCtx.rehydratePending = false;
      }
    });
    targetCtx.inFlightHydrate = attempt;
    return attempt;
  }

  function onInvalidation(targetCtx, event) {
    if (targetCtx !== ctx || event?.sessionId !== targetCtx.id) return; // not for the currently active session
    let revision;
    try { revision = toBigInt(event.revision); }
    catch { return; } // malformed envelope from an adversarial/buggy transport: ignore, don't crash the stream
    if (targetCtx.observedRevision !== null && revision <= targetCtx.observedRevision) return; // duplicate or stale invalidation
    targetCtx.observedRevision = revision;
    if (targetCtx.appliedRevision !== null && revision <= targetCtx.appliedRevision) return; // already covered by an installed snapshot
    scheduleHydrate(targetCtx).catch(() => { /* already reported via onStatus/onError */ });
  }

  async function handleAdapterStatus(targetCtx, next, detail) {
    if (targetCtx !== ctx) return; // stale callback from a torn-down subscription
    if (next === SyncStatus.DENIED) {
      // Stop exposing synchronized state as current: an observed-but-unhydrated revision is
      // discarded, and mutate() naturally becomes a structural error with no snapshot to pin to.
      targetCtx.appliedRevision = null;
      targetCtx.observedRevision = null;
      setStatus(SyncStatus.DENIED, detail);
      return;
    }
    if (next === SyncStatus.SYNCED && status === SyncStatus.RECONNECTING) {
      // Re-hydrate after reconnect so nothing missed during the gap is silently dropped.
      try { await scheduleHydrate(targetCtx); } catch { /* already reported */ }
      return;
    }
    setStatus(next, detail);
  }

  return {
    /** Fetch and, if newer, install a snapshot for sessionId. Safe to call standalone or before subscribe(). Coalesces with any hydrate already in flight for this session (see scheduleHydrate). */
    hydrate(targetSession) {
      if (targetSession !== ctx.id) resetSession(targetSession);
      return scheduleHydrate(ctx);
    },

    /**
     * Start live sync for sessionId. Switching to a different session automatically cleans up the
     * previous one. Returns an idempotent unsubscribe function equivalent to disconnect().
     * @param {string} targetSession
     * @param {import('./types.js').SyncHandlers} [nextHandlers]
     */
    subscribe(targetSession, nextHandlers = {}) {
      if (targetSession !== ctx.id) resetSession(targetSession);
      else unsubscribeAdapter?.();
      handlers = nextHandlers;
      const targetCtx = ctx;
      unsubscribeAdapter = adapter.subscribe(targetSession, {
        onEvent: event => onInvalidation(targetCtx, event),
        onStatus: (next, detail) => { void handleAdapterStatus(targetCtx, next, detail); },
      });
      scheduleHydrate(targetCtx).catch(() => { /* already reported via onStatus/onError */ });
      return teardown;
    },

    /**
     * Submit a mutation for the currently active session. `expectedRevision` is attached
     * automatically from the current applied snapshot — never from an observed-but-unhydrated
     * invalidation. Rejects structurally if no session is active or no snapshot has been applied
     * yet; a rejected mutation (including a stale-revision 40001 conflict) is returned as-is and
     * is never automatically retried — the caller decides whether to rehydrate and retry.
     * @param {string} targetSession
     * @param {import('./types.js').MutationCommand} command
     */
    mutate(targetSession, command) {
      if (targetSession !== ctx.id) return Promise.reject(new Error('Hydrate or subscribe to this session before mutating it.'));
      if (ctx.appliedRevision === null) return Promise.reject(new Error('No authoritative snapshot for this session yet; hydrate before mutating.'));
      const wireCommand = {
        schemaVersion: command?.schemaVersion ?? 1,
        type: command?.type,
        expectedRevision: ctx.appliedRevision.toString(),
        payload: command?.payload,
      };
      if (command?.commandId !== undefined) wireCommand.commandId = command.commandId;
      return adapter.mutate(targetSession, wireCommand);
    },

    /** Unsubscribe, release adapter resources and return to idle. Idempotent. */
    disconnect() {
      teardown();
      adapter.disconnect();
    },

    getStatus: () => status,
    getSessionId: () => ctx.id,
    /** The authoritative applied-snapshot revision (decimal string), or null before any snapshot has installed. */
    getAppliedRevision: () => (ctx.appliedRevision === null ? null : ctx.appliedRevision.toString()),
    /** The latest revision observed from either a snapshot or an invalidation (decimal string), or null. May run ahead of getAppliedRevision() while a re-hydration is in flight. */
    getObservedRevision: () => (ctx.observedRevision === null ? null : ctx.observedRevision.toString()),
  };
}
