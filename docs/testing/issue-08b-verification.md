# Issue #8B verification — client synchronization engine

Branch: `v09-08b-client-sync`, based on `origin/main` at `af54f0c`.

## Implemented scope

A transport-neutral, in-memory client synchronization engine at `src/realtime/`. It does not
integrate the legacy board (Issue #8C) and does not implement a Supabase adapter (owned by
Issue #8A); it is built entirely against an injected `SyncAdapter` and tested with a fake one.

- `src/realtime/types.js` — JSDoc typedefs for `SessionSnapshot`, `SessionEvent`, `MutationCommand`,
  `SyncHandlers` and the `SyncAdapter` contract, plus the runtime `SyncStatus` enum and the current
  `EVENT_CATEGORIES` list (`session`, `tokens`, `characters`, `initiative`, `activity`). Plain
  JavaScript throughout, per project convention — no TypeScript.
- `src/realtime/engine.js` — `createSyncEngine(adapter)`, exposing `hydrate(sessionId)`,
  `subscribe(sessionId, handlers)`, `mutate(sessionId, command)` and `disconnect()`, plus two small
  read accessors (`getStatus()`, `getSessionId()`) used by consumers and tests.
- `src/realtime/fakeAdapter.js` — `createFakeAdapter()`, a deterministic `SyncAdapter` test double
  with a manual control surface (`emitEvent`, `emitStatus`, `setHydrateResult`, `setMutateResult`).
  Not for production use; intended for this package's tests and available to Issue 8A/8D for their
  own integration tests.

## Adapter contract

```js
/** @typedef {Object} SyncAdapter
 * @property {(sessionId) => Promise<SessionSnapshot>} hydrate
 * @property {(sessionId, { onEvent, onStatus }) => (() => void)} subscribe
 * @property {(sessionId, command & { commandId }) => Promise<unknown>} mutate
 * @property {() => (void|Promise<void>)} disconnect
 */
```

The engine only ever calls these four methods. It never assumes Supabase, RLS or Realtime
internals — the eventual Supabase adapter (from Issue 8A's contract) and the fake adapter used
here are interchangeable from the engine's point of view.

## State / event / version design

- **Revision-ordered application.** Every `SessionSnapshot` and `SessionEvent` carries a
  monotonically increasing `revision` (this mirrors `session_state.revision` already in the
  Issue #5 schema, but the engine treats it as an opaque comparable number supplied by the
  adapter — it does not read the database itself). The engine tracks a single per-session
  watermark; an event is applied only if `event.revision > watermark`, which gives duplicate
  suppression and stale-event rejection for free from one rule.
- **No reorder buffer.** The engine trusts adapters to deliver events in non-decreasing revision
  order per session (a reasonable assumption for a single Realtime channel/publication) and does
  not attempt to buffer and resequence out-of-order deliveries — an event that arrives after a
  newer one has already applied is treated as stale and dropped. See Known limitations.
- **Hydrate/live-event race.** A snapshot returned by `hydrate()` never moves the watermark
  backward: if a live event with a higher revision lands before an in-flight `hydrate()` resolves,
  the (now-stale) snapshot is applied only if its own revision is still newer than what's already
  been applied. Covered by a dedicated deterministic test using a manually-gated fake hydrate.
- **Reconnect.** The adapter alone decides connection state and reports it through `onStatus`.
  When the adapter reports `SyncStatus.SYNCED` right after `SyncStatus.RECONNECTING`, the engine
  automatically re-hydrates before resuming, so any events missed during the gap are recovered
  from a fresh snapshot rather than silently dropped.
- **Local echo tagging, not suppression.** `mutate()` tags its outgoing command with a
  locally-generated `commandId`. If a later event carries a matching `commandId`, the engine marks
  it `isLocalEcho: true` when handing it to `onEvent` — but still delivers it through the normal
  revision-ordered path, and the engine itself never calls `mutate()` in response to an event. This
  gives consumers the information to avoid re-deriving already-applied local state without the
  engine silently dropping data.
- **Session switching / cleanup.** `subscribe()` to a different session automatically unsubscribes
  and resets the previous session's watermark and pending-command tracking. `disconnect()` (and the
  idempotent function `subscribe()` returns) does the same and returns the engine to `idle`.
- **No manufactured authority.** The engine never infers permission from UI state (route, view
  mode, a frontend "DM" flag) and never gates `mutate()` on its own cached `SyncStatus` — the only
  precondition it enforces is structural (a session must be hydrated/subscribed before mutating
  it). Every `SyncStatus` value the engine reports originated from the adapter.
- **No storage.** The engine is purely in-memory; it never reads or writes `localStorage` or
  `sessionStorage`. Enforced by a source-scan test, not just by convention.

## Tests / results

`tests/realtime.test.js`, 18 deterministic `node --test` cases against the fake adapter (no sleeps
or real timers — control flow is driven by resolving/rejecting deferred promises and calling the
fake adapter's `emitEvent`/`emitStatus` directly):

| Command | Result |
| --- | --- |
| `node --test tests/realtime.test.js` | PASS; 18/18 |
| `npm.cmd run check` | PASS; scaffold checks + 47 JS/DOM tests (29 pre-existing + 18 new), all green |
| `npm.cmd run build` | PASS; Vite 6.4.3 (realtime module not yet imported by any entry point — Issue #8C wires it in) |
| `npm.cmd audit` | PASS; zero vulnerabilities |

Existing `tests/*.test.js` suites are unmodified and remain green. `tests/e2e/**` and
`playwright.config.js` were not touched.

## Files changed

- `src/realtime/types.js` (new)
- `src/realtime/engine.js` (new)
- `src/realtime/fakeAdapter.js` (new)
- `tests/realtime.test.js` (new)
- `docs/testing/issue-08b-verification.md` (new, this file)

No file outside `src/realtime/**`, its tests, and this doc was modified. `supabase/**`,
`scripts/test-*-api.mjs`, `tests/e2e/**`, `playwright.config.js`, `src/supabase/**`, `script.js`,
`package.json` and `package-lock.json` are all unchanged.

## Integration requirements from Issue 8A

To wire the real Supabase adapter during integration, Issue 8A needs to produce something that
implements the `SyncAdapter` shape in `src/realtime/types.js`:

- `hydrate(sessionId)` — resolve a `SessionSnapshot` (`{ sessionId, revision, state }`) from
  whatever read path 8A settles on (RPC, view, or direct table reads under RLS); reject on denied
  access rather than resolving an empty/partial snapshot.
- `subscribe(sessionId, { onEvent, onStatus })` — start the real Realtime subscription, translate
  Postgres changes into `SessionEvent` (`{ sessionId, revision, category, kind, payload, commandId? }`)
  with a revision that increases monotonically per session, and report connection lifecycle through
  `onStatus` using the `SyncStatus` values (`reconnecting`, `synced`, `denied`, `error`, `closed`).
  Return an idempotent unsubscribe function.
- `mutate(sessionId, command)` — submit the command to the appropriate RPC and resolve/reject with
  the backend's real result; do not pre-authorize client-side.
- `disconnect()` — tear down the underlying Realtime channel/socket.

Two open questions for 8A to confirm during integration:

1. Whether `revision` will be the existing `session_state.revision` column directly, or a
   per-category counter — the engine works with either as long as it's monotonic and comparable
   with `>`/`<=` per session.
2. Whether Realtime delivery is guaranteed non-decreasing in revision per session/channel. The
   engine assumes so (see Known limitations); if 8A's transport can reorder, a small reorder buffer
   would need to be added to the adapter (not the engine) before handing events to `onEvent`.

## Known limitations

- No reorder buffer: events delivered out of revision order are treated as stale and dropped, not
  queued and reapplied later. This keeps the engine small, per the work package's guidance against
  a general-purpose event framework, but depends on the adapter delivering in order.
- No production adapter yet — this package cannot be exercised end-to-end until Issue 8A's contract
  lands and Issue 8C wires the engine into the board.
- Only the five current `EVENT_CATEGORIES` are named; fog/terrain/movement/locations are
  intentionally not modeled yet (future adapters can introduce new category/kind strings without
  engine changes).
- `mutate()`'s structural precondition (must be hydrated/subscribed first) is a usability guard,
  not a security boundary — the backend remains the sole authority on whether a mutation succeeds.
