/**
 * Shared shapes for the client synchronization engine. This module is JSDoc-only where
 * possible; the engine stays plain JavaScript per project convention (no TypeScript).
 */

/** @typedef {'idle'|'hydrating'|'synced'|'reconnecting'|'denied'|'error'|'closed'} SyncStatusValue */

/** Lifecycle states the engine reports through `onStatus`. Consumers render from these, never from a locally-inferred permission. */
export const SyncStatus = Object.freeze({
  IDLE: 'idle',
  HYDRATING: 'hydrating',
  SYNCED: 'synced',
  RECONNECTING: 'reconnecting',
  DENIED: 'denied',
  ERROR: 'error',
  CLOSED: 'closed',
});

/** Current known event categories. Adapters and consumers may add more without engine changes. */
export const EVENT_CATEGORIES = Object.freeze(['session', 'tokens', 'characters', 'initiative', 'activity']);

/**
 * @typedef {Object} SessionSnapshot
 * @property {string} sessionId
 * @property {number} revision Monotonically increasing revision this snapshot reflects.
 * @property {Object<string, unknown>} state Category-keyed public state (session/tokens/characters/initiative/activity, …).
 */

/**
 * @typedef {Object} SessionEvent
 * @property {string} sessionId
 * @property {number} revision Monotonically increasing; compared against the last-applied revision to order/dedupe/reject.
 * @property {string} category One of EVENT_CATEGORIES (or a future addition).
 * @property {string} kind Event-specific discriminator, e.g. 'token.moved'.
 * @property {unknown} payload Category/kind-specific public payload. Only what a secure backend projection already allows.
 * @property {string} [commandId] Present when this event echoes a local mutate() call's command.
 */

/**
 * @typedef {Object} MutationCommand
 * @property {string} category
 * @property {string} kind
 * @property {unknown} payload
 */

/**
 * @typedef {Object} SyncHandlers
 * @property {(snapshot: SessionSnapshot) => void} [onSnapshot]
 * @property {(event: SessionEvent & { isLocalEcho: boolean }) => void} [onEvent]
 * @property {(status: SyncStatusValue, detail?: { error?: Error }) => void} [onStatus]
 * @property {(error: Error) => void} [onError]
 */

/**
 * @typedef {Object} SyncAdapter
 * Backend-transport-neutral contract. Implemented by the eventual Supabase adapter (wired once
 * Issue 8A's contract is final) and by `createFakeAdapter` for tests. The engine only ever calls
 * these four methods and never assumes Supabase/RLS/Realtime internals.
 * @property {(sessionId: string) => Promise<SessionSnapshot>} hydrate
 *   Fetch current authoritative state. Must reject if the caller lacks access; must not fabricate
 *   a snapshot for a session the backend would deny.
 * @property {(sessionId: string, callbacks: { onEvent: (event: SessionEvent) => void, onStatus: (status: SyncStatusValue, detail?: { error?: Error }) => void }) => (() => void)} subscribe
 *   Start live delivery for sessionId. Returns an idempotent unsubscribe function. The adapter owns
 *   transport-level reconnect and must report status transitions via `onStatus` ('reconnecting',
 *   'synced', 'denied', 'error', 'closed'); the engine reacts but never invents these transitions itself.
 * @property {(sessionId: string, command: MutationCommand & { commandId: string }) => Promise<unknown>} mutate
 *   Submit a mutation. Backend authorization is authoritative — the adapter must not pre-authorize
 *   from client-side role, route or view-mode state.
 * @property {() => (void|Promise<void>)} disconnect
 *   Release any adapter-held transport resources. Safe to call when nothing is connected.
 */

export {};
