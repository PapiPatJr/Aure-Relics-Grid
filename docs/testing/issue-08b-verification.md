# Issue #8B verification — client synchronization engine

Branch: `v09-08b-client-sync`, based on `origin/main` at `af54f0c`.

**2026-09-24 update (Issue #8B.1):** aligned to the now-implemented Issue #8A backend contract
(`docs/issue-08a-realtime-contract.md` on branch `v09-08a-realtime-security`, commit `9ac8387`,
read for context only — not merged/cherry-picked into this branch). This replaces the placeholder
`SessionEvent`/category/kind/payload/`isLocalEcho` design from the first 8B pass with the real
minimal-invalidation model below. See "What changed in the alignment pass" at the end of this file.

## Implemented scope

A transport-neutral, in-memory client synchronization engine at `src/realtime/`. It does not
integrate the legacy board (Issue #8C) and does not implement a Supabase adapter (owned by
Issue #8A); it is built entirely against an injected `SyncAdapter` and tested with a fake one.

- `src/realtime/types.js` — JSDoc typedefs for `SessionSnapshot`, `InvalidationEnvelope`,
  `MutationCommand`, `SyncHandlers` and the `SyncAdapter` contract, plus the runtime `SyncStatus`
  enum. Plain JavaScript throughout, per project convention — no TypeScript.
- `src/realtime/engine.js` — `createSyncEngine(adapter)`, exposing `hydrate(sessionId)`,
  `subscribe(sessionId, handlers)`, `mutate(sessionId, command)`, `disconnect()`, plus
  `getStatus()`, `getSessionId()`, `getAppliedRevision()`, `getObservedRevision()`; and the
  standalone helper `isRevisionConflict(error)`.
- `src/realtime/fakeAdapter.js` — `createFakeAdapter()`, a deterministic `SyncAdapter` test double
  with a manual control surface (`emitEvent`, `emitInvalidation`, `emitStatus`, `setHydrateResult`,
  `setMutateResult`). Not for production use; intended for this package's tests and available to
  Issue 8A/8D for their own integration tests.

## Adapter contract

```js
/** @typedef {Object} SyncAdapter
 * @property {(sessionId) => Promise<SessionSnapshot>} hydrate
 * @property {(sessionId, { onEvent, onStatus }) => (() => void)} subscribe
 * @property {(sessionId, command & { schemaVersion, expectedRevision }) => Promise<unknown>} mutate
 * @property {() => (void|Promise<void>)} disconnect
 */
```

Matches the 8A mapping exactly: `hydrate` → `get_session_snapshot`, `subscribe` → sanitized
`session_events` Postgres Changes, `mutate` → `mutate_session`. The engine only ever calls these
four methods and never assumes Supabase, RLS or Realtime internals.

## Revision/invalidation design (the 8A/8B alignment)

The production sequence is **database mutation → sanitized invalidation → client observes revision
→ client re-hydrates a secure snapshot → UI consumes the authorized snapshot**. Invalidations never
carry state; only an installed snapshot is authoritative.

- **Decimal-string revisions, BigInt comparison only.** Every `SessionSnapshot.revision` and
  `InvalidationEnvelope.revision` is a non-negative decimal string. The engine parses and compares
  them exclusively with `BigInt` (`toBigInt()` in `engine.js`, strict `^(0|[1-9]\d*)$` format) —
  never lexical string comparison (`"10" < "9"`) and never `Number()` (which silently rounds two
  distinct revisions to the same double past `Number.MAX_SAFE_INTEGER`). A malformed revision
  string fails closed (reported via `onError`/`ERROR` status for a snapshot; silently ignored for
  an invalidation, since that channel is an unauthenticated-shape push stream where one bad
  envelope shouldn't take down the sync loop).
- **Two distinct revision concepts, tracked separately per session context:**
  - `appliedRevision` — the one authoritative watermark. It only ever advances when a fetched
    snapshot is actually installed via `onSnapshot`. `getAppliedRevision()` exposes it.
  - `observedRevision` — the latest revision seen from *either* a snapshot or an invalidation. It
    can run ahead of `appliedRevision` while a re-hydration is in flight. `getObservedRevision()`
    exposes it. Receiving an invalidation never by itself advances `appliedRevision`.
- **Invalidations only ever trigger a re-hydration.** `SyncHandlers` no longer has an `onEvent`
  callback at all — there is nothing state-shaped to deliver. An invalidation updates
  `observedRevision` (with duplicate/stale suppression using the same watermark rule as before)
  and, if newer than the current `appliedRevision`, schedules a hydration.
- **Hydration storm prevention.** At most one `adapter.hydrate()` call is in flight per session at
  a time (`scheduleHydrate` in `engine.js`). Every trigger that arrives while one is already in
  flight — the bootstrap hydrate racing a live invalidation, several invalidations back to back, a
  reconnect racing an invalidation — coalesces onto it. If anything newer was observed by the time
  it resolves, exactly one follow-up hydration runs afterward, never one per invalidation.
- **Subscribe/hydrate race.** `subscribe()` registers the adapter's `onEvent`/`onStatus` callbacks
  *before* kicking off the bootstrap hydration through the same coalescing scheduler, so an
  invalidation that races in before that first hydration resolves is never lost — it just
  schedules the (single) follow-up hydration needed to catch up.
- **Reconnect** still re-hydrates automatically on the `RECONNECTING` → `SYNCED` transition (routed
  through the same coalescing scheduler as everything else).
- **Access denial.** On `DENIED`, both `appliedRevision` and `observedRevision` are cleared. This
  stops the engine from exposing stale synchronized state and, because `mutate()` requires an
  applied revision to attach as `expectedRevision`, it also structurally stops mutation — without
  the engine manufacturing a client-side permission decision. No automatic re-hydration is
  attempted while denied. `DENIED` does not reset the `sessionId` itself; a later invalidation
  (e.g. if a real adapter still delivers one briefly) can still prompt a fresh authorization check
  via a normal hydration attempt, which will simply fail again if access remains denied — the
  backend stays the sole authority, never the cached status.
- **`mutate()` attaches `expectedRevision` automatically**, always from `appliedRevision`
  (`ctx.appliedRevision.toString()`), never from `observedRevision`. If no snapshot has ever been
  applied, `mutate()` rejects structurally before calling the adapter at all. The full wire command
  is `{ schemaVersion, type, expectedRevision, payload, commandId? }`, matching the 8A shape.
- **`commandId` is optional correlation metadata only**, exactly as 8A specifies — not a secret,
  not authorization, not an idempotency key, and never expected back through realtime (invalidation
  envelopes don't carry one). The engine passes it through unchanged if the caller supplies it and
  no longer generates one itself or tracks pending commands — the `mutate()` Promise is the only
  local request correlation the engine offers. (The first 8B pass had `isLocalEcho`/pending-command
  tracking built around the old event-echo design; that is fully removed.)
- **Revision conflicts (`SQLSTATE 40001`) are surfaced, not retried.** `mutate()` rejects with
  whatever the adapter throws; `isRevisionConflict(error)` (checks `error.code === '40001'`) is a
  narrowly-scoped classification helper for callers, kept deliberately minimal — the engine itself
  never automatically replays a failed mutation. A caller that wants to retry is expected to
  `hydrate()` again first (picking up a fresh `appliedRevision`) and then decide whether to resubmit.
- **No manufactured authority**, unchanged from the first pass: every `SyncStatus` value originates
  from the adapter, and no client-side gate (aside from the structural "no applied snapshot yet"
  check above) blocks `mutate()`.
- **No storage.** Still purely in-memory; never touches `localStorage`/`sessionStorage`, enforced
  by a source-scan test.

## Tests / results

`tests/realtime.test.js`, 22 deterministic `node --test` cases against the fake adapter (no sleeps
or real timers). Coverage added/changed for this alignment pass: decimal-string ordering against
lexical mis-ordering, revisions past `Number.MAX_SAFE_INTEGER` (two values that round to the same
IEEE-754 double are still told apart correctly), invalidation-triggers-hydration-not-state,
invalidation coalescing under an in-flight hydration, a snapshot resolving older than what's
already been observed followed by a catch-up hydration, the subscribe/hydrate race, duplicate/stale
invalidation suppression, `expectedRevision` sourced from the applied (never observed) revision,
denial clearing both watermarks and structurally blocking mutation, session switching resetting
both revision concepts, and a stale-mutation (40001) rejection that is classified via
`isRevisionConflict` but never auto-replayed. Existing reconnect/disconnect/hydration-failure
coverage from the first pass is retained, adapted to the string-revision snapshot shape.

| Command | Result |
| --- | --- |
| `node --test tests/realtime.test.js` | PASS; 22/22 |
| `npm.cmd run check` | PASS; scaffold checks + 51 JS/DOM tests (29 pre-existing + 22 realtime), all green |
| `npm.cmd run build` | PASS; Vite 6.4.3 (realtime module not yet imported by any entry point — Issue #8C wires it in) |
| `npm.cmd run audit` | PASS; zero vulnerabilities |

Existing `tests/*.test.js` suites are unmodified and remain green. `tests/e2e/**`,
`playwright.config.js`, `supabase/**`, `scripts/test-*-api.mjs`, `src/supabase/**`, `script.js`,
`package.json` and `package-lock.json` were not touched by either 8B pass.

## Files changed (this alignment pass)

- `src/realtime/types.js` (rewritten)
- `src/realtime/engine.js` (rewritten)
- `src/realtime/fakeAdapter.js` (extended: `emitInvalidation` convenience, string-revision defaults)
- `tests/realtime.test.js` (rewritten)
- `docs/testing/issue-08b-verification.md` (this file)

No file outside `src/realtime/**`, its tests, and this doc was modified.

## Integration requirements from Issue 8A (unchanged/confirmed)

The real Supabase adapter (not yet built — Issue 8C wires it in) needs to implement `SyncAdapter`
per `src/realtime/types.js`, mapped as: `hydrate` → `get_session_snapshot` RPC; `subscribe` → a
`postgres_changes` INSERT subscription on `public.session_events` filtered to the session, using
`postgres_changes_options.wait: true` so `SUBSCRIBED` means the database subscription is actually
ready (not just the channel join) before the adapter starts buffering/delivering invalidations;
`mutate` → `mutate_session` RPC, passing through the engine-built `{schemaVersion, type,
expectedRevision, payload, commandId?}` command unchanged. The two open questions from the first
8B pass are now answered by the 8A contract: revision is the recipient-scoped `session_events`
counter (not `session_state.revision` directly), and Realtime delivery ordering is not assumed —
the adapter is responsible for the "wait for SUBSCRIBED, buffer, hydrate, discard buffered
invalidations at-or-below the snapshot's revision, coalesce anything newer into another hydration"
sequence at the transport level; this engine's own coalescing scheduler handles the same class of
race generically above that, so the two layers compose rather than duplicate each other.

## Known limitations

- No production adapter yet — this package cannot be exercised end-to-end until Issue 8C wires the
  engine into the board using the real Supabase adapter.
- The engine assumes an adapter never calls `onEvent`/`onStatus` for a session it has already been
  asked to unsubscribe from; the `targetCtx !== ctx` guards make this safe even if a transport
  delivers a little late during teardown, but it is not exercised against a real socket here.
- `mutate()`'s structural precondition (must have an applied snapshot) is a usability/correctness
  guard, not a security boundary — the backend remains the sole authority on whether a mutation
  succeeds, and a stale-but-nonzero `expectedRevision` is still validated server-side.
- Snapshot shape beyond `revision` is intentionally opaque to the engine (see `types.js`); this
  keeps the engine forward-compatible with future fog/terrain/movement/location snapshot fields
  without any engine change, per Issue #8's extensibility requirement.

## What changed in the alignment pass (for reviewers of the first PR revision)

The first 8B pass invented a placeholder wire shape (`SessionEvent` with `category`/`kind`/
`payload`, numeric revisions, `isLocalEcho` via engine-generated `commandId`s) before Issue 8A's
contract existed. Every part of that placeholder shape was replaced to match the now-implemented
8A contract: revisions are decimal strings compared with BigInt; invalidations carry no state and
no longer reach consumers as "events" at all; `appliedRevision`/`observedRevision` are tracked as
two distinct concepts instead of one watermark; `mutate()` now attaches `expectedRevision` from
`appliedRevision` automatically instead of the engine generating its own `commandId` for echo
tracking; and `commandId`, where present, is caller-supplied pass-through metadata only. The public
shape of `hydrate`/`subscribe`/`mutate`/`disconnect` and the `SyncStatus` vocabulary are unchanged.
