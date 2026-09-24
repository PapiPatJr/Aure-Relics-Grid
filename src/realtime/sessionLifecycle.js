import { SyncStatus } from './types.js';

/**
 * Small controller wrapping a createSyncEngine(...) instance with the access-loss and
 * lifecycle behavior Issue #8C requires: focus-triggered hydration, periodic authorized
 * hydration (per the 8A contract's "suggested 30 seconds while connected"), session
 * switching, and a locked denied-access response. It does not talk to any specific adapter —
 * `engine` is whatever createSyncEngine(adapter) instance the caller already built.
 *
 * On denied: both revision watermarks are already cleared by engine.js itself, and mutate()
 * is already structurally blocked there too. This controller's own job is narrower — cancel
 * the periodic/focus timers so nothing keeps trying to auto-recover, and remember just enough
 * (`getLastDenialDetail()`) to explain why. It never waits for a future invalidation to restore
 * access; recovery is always an explicit start()/switchTo() (or a direct engine.hydrate()) call
 * from the caller — navigation, an explicit retry action, or focus/periodic hydration *before*
 * denial, never after.
 *
 * @param {ReturnType<import('./engine.js').createSyncEngine>} engine
 * @param {Object} [options]
 * @param {(snapshot: import('./types.js').SessionSnapshot) => void} [options.onSnapshot]
 * @param {(status: import('./types.js').SyncStatusValue, detail?: object) => void} [options.onStatus]
 * @param {(error: Error) => void} [options.onError]
 * @param {{ addEventListener: Function, removeEventListener: Function }|null} [options.focusTarget]
 *   Injectable for tests; defaults to `window` when available, otherwise disabled.
 * @param {number} [options.periodicHydrateMs] Defaults to 30000, per the 8A contract's guidance.
 * @param {Function|null} [options.setIntervalFn] Injectable for deterministic tests.
 * @param {Function|null} [options.clearIntervalFn] Injectable for deterministic tests.
 */
export function createSessionLifecycle(engine, options = {}) {
  const {
    onSnapshot, onStatus, onError,
    focusTarget = typeof window !== 'undefined' ? window : null,
    periodicHydrateMs = 30000,
    setIntervalFn = typeof setInterval === 'function' ? setInterval : null,
    clearIntervalFn = typeof clearInterval === 'function' ? clearInterval : null,
  } = options;

  let generation = 0;
  let sessionId = null;
  let unsubscribeEngine = null;
  let intervalHandle = null;
  let focusListener = null;
  let lastDenialDetail = null;

  function teardownTimers() {
    if (intervalHandle !== null) { clearIntervalFn?.(intervalHandle); intervalHandle = null; }
    if (focusListener && focusTarget) {
      focusTarget.removeEventListener('visibilitychange', focusListener);
      focusTarget.removeEventListener('focus', focusListener);
    }
    focusListener = null;
  }

  function armTimers(myGeneration, targetSession) {
    if (setIntervalFn) {
      intervalHandle = setIntervalFn(() => {
        if (myGeneration !== generation) return; // stopped/switched since this timer was armed
        engine.hydrate(targetSession).catch(() => { /* reported via onStatus/onError already */ });
      }, periodicHydrateMs);
    }
    if (focusTarget) {
      focusListener = () => {
        if (myGeneration !== generation) return;
        engine.hydrate(targetSession).catch(() => { /* reported via onStatus/onError already */ });
      };
      focusTarget.addEventListener('visibilitychange', focusListener);
      focusTarget.addEventListener('focus', focusListener);
    }
  }

  function begin(targetSession) {
    teardownTimers();
    generation += 1;
    const myGeneration = generation;
    sessionId = targetSession;
    lastDenialDetail = null;
    unsubscribeEngine = engine.subscribe(targetSession, {
      onSnapshot: snapshot => { if (myGeneration === generation) onSnapshot?.(snapshot); },
      onStatus: (status, detail) => {
        if (myGeneration !== generation) return;
        if (status === SyncStatus.DENIED) {
          lastDenialDetail = detail ?? null;
          generation += 1; // invalidate already-queued timer/focus callbacks as well
          teardownTimers(); // stop auto-recovery attempts; engine.js already cleared its own watermarks
        }
        onStatus?.(status, detail);
      },
      onError: error => { if (myGeneration === generation) onError?.(error); },
    });
    if (myGeneration === generation) armTimers(myGeneration, targetSession);
  }

  return {
    /** Begin syncing a session. Safe to call as the very first action. */
    start(targetSession) { begin(targetSession); },
    /** Switch to a different session, cleanly tearing down the previous one first. */
    switchTo(targetSession) { begin(targetSession); },
    /** Stop syncing, release the engine subscription and timers, and return to a clean slate. Idempotent — safe to call repeatedly or before any start(). */
    stop() {
      generation += 1; // invalidate any timer callback still in flight
      teardownTimers();
      unsubscribeEngine?.();
      unsubscribeEngine = null;
      sessionId = null;
      lastDenialDetail = null;
    },
    getStatus: () => engine.getStatus(),
    getSessionId: () => sessionId,
    /** Detail from the most recent `denied` status, or null. Enough to explain the denial — nothing more is retained. */
    getLastDenialDetail: () => lastDenialDetail,
  };
}
