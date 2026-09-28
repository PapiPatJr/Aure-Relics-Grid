/**
 * Shared shapes for the client synchronization engine. This module is JSDoc-only where
 * possible; the engine stays plain JavaScript per project convention (no TypeScript).
 *
 * Aligned to the Issue #8A backend contract (docs/issue-08a-realtime-contract.md, on branch
 * v09-08a-realtime-security): the production sequence is
 *   database mutation -> sanitized invalidation -> revision notification -> secure hydration -> UI snapshot.
 * Invalidations never carry state. Only a hydrated snapshot is authoritative state.
 */

/** @typedef {'idle'|'hydrating'|'synced'|'reconnecting'|'denied'|'error'|'closed'} SyncStatusValue */

/** Lifecycle states the engine reports through `onStatus`. Consumers render from these, never from a locally-inferred permission — the backend remains the sole authority. */
export const SyncStatus = Object.freeze({
  IDLE: 'idle',
  HYDRATING: 'hydrating',
  SYNCED: 'synced',
  RECONNECTING: 'reconnecting',
  DENIED: 'denied',
  ERROR: 'error',
  CLOSED: 'closed',
});

/**
 * @typedef {Object} SessionSnapshot
 * Authoritative state for a session. The engine only requires a top-level `revision` (a
 * non-negative decimal string, compared with BigInt semantics — never lexically, never coerced
 * to a JS Number). Everything else is adapter/backend-defined and opaque to the engine, which
 * passes the whole object through to `onSnapshot` unchanged. See the 8A contract for the
 * production shape (`schemaVersion, sessionId, campaignId, revision, authority, session,
 * roundNumber, tokens, characters, initiative, dm`).
 *
 * Issue #10 adds a top-level `fog` field and, for managers only, `dm.fog` (see
 * `docs/superpowers/plans/2026-09-25-issue-10-fog-of-war.md` and
 * `supabase/migrations/20260925223000_fog_projection.sql`'s `private.session_projection`).
 * Both are opaque to the engine exactly like the rest of the snapshot; only `src/fog/fogMask.js`
 * interprets them, and only through its fail-closed `decodeRevealedRuns`/`isCellRevealed`.
 * @property {string} sessionId
 * @property {string} revision Non-negative decimal string.
 * @property {FogProjection|null} [fog] The active presented level's fog only — never every
 *   level in the campaign. `null` when the session has no active level.
 * @property {{ fog?: FogManagerState|null }} [dm] Manager-only; `dm` itself is `null`/absent
 *   for a real player. Player snapshots never contain `dm.fog` or any named-area data.
 */

/**
 * @typedef {Object} FogProjection
 * Compact active-level fog presentation delivered to every authorized recipient (player and
 * manager alike). `enabled` is reported independently of `revealedRuns`: stored revealed cells
 * persist under `fog_cells` even while fog is disabled (design §4.2/§13.5), so a client must
 * never infer "nothing revealed" from `enabled: false` or vice versa.
 * @property {string} levelId
 * @property {number} width
 * @property {number} height
 * @property {boolean} enabled
 * @property {Array<[number, number, number]>} revealedRuns Deterministic
 *   `[y, xStartInclusive, xEndExclusive]` runs; decode with `fogMask.decodeRevealedRuns`.
 */

/**
 * @typedef {Object} FogManagerState
 * DM-only fog-management metadata nested under `dm.fog`. Never sent to a real player
 * projection (design §8.2). `areas`/`levelRevisions` intentionally expose only compact
 * `cellRuns`/decimal revision strings, never raw per-cell objects.
 * @property {boolean} campaignEnabled
 * @property {string} locationId
 * @property {boolean|null} locationOverride
 * @property {boolean|null} levelOverride
 * @property {boolean} effectiveEnabled Resolved Level -> Location -> Campaign inheritance.
 * @property {boolean} initialized Whether this level's fog has an established current state.
 * @property {Array<{ id: string, levelId: string, name: string, cellRuns: Array<[number, number, number]>, revealedByDefault: boolean, status: 'Hidden'|'Revealed'|'Mixed' }>} areas
 * @property {Array<{ levelId: string, revision: string }>} levelRevisions Per-level fog
 *   revision watermarks (exact decimal strings) so a manager editing a non-presented level
 *   still advances that level's own watermark without affecting a real player's projection.
 */

/**
 * @typedef {Object} InvalidationEnvelope
 * A minimal "something changed" signal delivered by `adapter.subscribe`'s `onEvent` callback.
 * It carries no entity IDs, labels, row images, private fields or command data — only enough to
 * decide whether a re-hydration is needed. The engine never applies this as state.
 * @property {number} schemaVersion
 * @property {string} id Random event id. Not meaningful for ordering.
 * @property {string} sessionId
 * @property {string} revision Non-negative decimal string; a monotonic per-session/recipient
 *   counter with possible gaps. Never a timestamp, never a state delta — compare with BigInt only.
 * @property {string} type e.g. 'session.invalidated'. The engine does not branch on this value.
 */

/**
 * @typedef {Object} MutationCommand
 * The caller supplies `type`, `payload` and an optional `commandId`. `expectedRevision` is
 * attached automatically by the engine from the current applied snapshot revision — callers
 * must not (and cannot) supply it themselves.
 * @property {number} [schemaVersion] Defaults to 1.
 * @property {string} type
 * @property {unknown} payload
 * @property {string} [commandId] Optional bounded correlation metadata (1-128 chars). Not a
 *   secret, not authorization, not an idempotency key, and never echoed back through realtime —
 *   the mutate() Promise itself is the only local request correlation the engine offers.
 */

/**
 * @typedef {Object} SyncHandlers
 * @property {(snapshot: SessionSnapshot) => void} [onSnapshot] The only channel that delivers
 *   authoritative state. Called once per installed snapshot (never for a stale/superseded one).
 * @property {(status: SyncStatusValue, detail?: { error?: Error }) => void} [onStatus]
 * @property {(error: Error) => void} [onError]
 */

/**
 * @typedef {Object} SyncAdapter
 * Backend-transport-neutral contract. Implemented by the eventual Supabase adapter (mapped in the
 * 8A contract: hydrate -> `get_session_snapshot`, subscribe -> sanitized `session_events`
 * Postgres Changes, mutate -> `mutate_session`) and by `createFakeAdapter` for tests. The engine
 * only ever calls these four methods and never assumes Supabase/RLS/Realtime internals.
 * @property {(sessionId: string) => Promise<SessionSnapshot>} hydrate
 *   Fetch current authoritative state. Must reject if the caller lacks access; must not fabricate
 *   a snapshot for a session the backend would deny.
 * @property {(sessionId: string, callbacks: { onEvent: (event: InvalidationEnvelope) => void, onStatus: (status: SyncStatusValue, detail?: { error?: Error }) => void }) => (() => void)} subscribe
 *   Start live delivery for sessionId. Returns an idempotent unsubscribe function. The adapter
 *   owns transport-level reconnect and subscription readiness (e.g. Supabase's `wait: true`
 *   option so `SUBSCRIBED` means the database subscription is actually ready, not just the
 *   channel join) and must report status transitions via `onStatus`. Adapter `synced` means
 *   transport readiness only; the engine waits for this signal, then hydrates before reporting
 *   `synced` to consumers. The same barrier applies after every reconnect. It must not deliver
 *   `onEvent` invalidations before its own transport is ready to do so correctly.
 * @property {(sessionId: string, command: MutationCommand & { schemaVersion: number, expectedRevision: string }) => Promise<unknown>} mutate
 *   Submit a mutation with the engine-attached `expectedRevision`. Backend authorization is
 *   authoritative — the adapter must not pre-authorize from client-side role, route or view-mode
 *   state. A stale `expectedRevision` is rejected by the backend (SQLSTATE 40001); the adapter
 *   surfaces that as a rejected promise rather than retrying.
 * @property {() => (void|Promise<void>)} disconnect
 *   Release any adapter-held transport resources. Safe to call when nothing is connected.
 */

export {};
