# Issue #8C — production realtime adapter + board integration

**Base:** `ad73746` (merge of Issue 8A `9ac8387` + Issue 8B.1 `576b9a1` onto `main` `af54f0c`).
**Reads for context, does not modify:** `docs/issue-08a-realtime-contract.md`,
`docs/testing/issue-08a-verification.md`, `docs/testing/issue-08b-verification.md`,
`src/realtime/engine.js`, `src/realtime/types.js`, `src/realtime/fakeAdapter.js`,
`supabase/**`, `tests/e2e/**`.

This plan divides 8C into the five tasks the work order specifies, names exact files and
interfaces before any code changes, and commits per task.

## Architecture decision: how far this pass integrates the legacy board

Before Task 3/4 can be written precisely, one scoping call has to be made explicit, because the
legacy board's data model and the 8A snapshot's data model are genuinely different shapes, and the
work order forbids "broadly refactor the legacy board":

- Legacy `script.js` keys everything by a **label string** (`"P1"`, `"E2"`, …) assigned from a
  per-kind counter, stores a *single* `status` enum and a *single* `buff` enum per token (not an
  array), stores initiative as **grouped** entries (`{name, members: [labels], initiative}`, ties
  share one entry), and has **no explicit token position** — a token's location is simply which
  grid `.cell` DOM element currently contains it. HP fields are edited by mutating `tokenData`
  directly from `input` event listeners (`data.hp = cleanNumberInput(hpInput.value)`).
- The 8A snapshot keys everything by **UUID**, has a `statuses[]` array, a **flat** per-token
  `initiative[]` (`{id, tokenId, initiative, position, isActive}`), and explicit `x, y, width,
  height`. It has no grid/theme/terrain concept at all (out of scope for Issue #8).
- Feeding synced snapshot data through the *same* `tokenData`/grid/HUD pipeline that local scene
  editing uses would (a) require inventing a merge/placement policy nowhere specified by 8A, (b)
  risk corrupting locally-saved scenes (the save/load code serializes whatever is currently on the
  grid), and (c) let a player bypass "backend remains authoritative" by typing into an HP `<input>`
  that mutates local state directly instead of calling `mutate()`.

**Decision:** Task 3's `src/realtime/boardBridge.js` is the complete, fully-tested integration
surface — a pure module that turns a raw `SessionSnapshot` into a stable, normalized **view
model**, with replacement semantics, with no DOM/script.js coupling at all. This is where
essentially all of Task 3's required tests live, and they're all pure data-transformation tests.

The `script.js` hook is then deliberately thin: one new, additive, **read-only** panel
(`applyRealtimeSnapshot`, exposed as `window.aureRelicsApplyRealtimeSnapshot`) that renders the
bridge's view model — round number, token list, character cards, initiative order, DM-only
projection when present — without touching `tokenData`, the grid, or any existing render function.
It never enables editing (no drag, no cog-button modal) for synced entries, so there is no path for
a client to mutate official state without going through `mutate()`. Wiring specific *buttons* that
call Task 4's mutation functions from this panel is explicitly **out of scope for this pass** (see
Known limitations) — Task 4 only requires the callable, tested mutation functions to exist and
behave correctly, not a finished interactive UI; that follow-up is listed as remaining work.

This keeps every literal 8C requirement satisfiable without the two forbidden things: a broad
legacy refactor, or inventing hidden/private semantics the contract doesn't specify.

## Task 1 — Production Supabase sync adapter

**New file:** `src/realtime/supabaseAdapter.js` — `createSupabaseSyncAdapter(client)`.
**New tests:** `tests/realtime-supabase-adapter.test.js`.

Implements `SyncAdapter` from `src/realtime/types.js` exactly:

```js
export function createSupabaseSyncAdapter(client) {
  return {
    async hydrate(sessionId) { /* client.rpc('get_session_snapshot', { p_session: sessionId }) */ },
    subscribe(sessionId, { onEvent, onStatus }) { /* postgres_changes channel */ },
    async mutate(sessionId, command) { /* client.rpc('mutate_session', { p_session, p_command: command }) */ },
    disconnect() { /* remove all adapter-owned channels */ },
  };
}
```

- `hydrate`: calls `client.rpc('get_session_snapshot', { p_session: sessionId })`; throws the
  Supabase error as-is on `{ error }` (the engine's `onError`/`ERROR` path already handles it); on
  success returns `data` unchanged (the RPC's JSON already matches `SessionSnapshot`).
- `subscribe`: creates `client.channel('session:' + sessionId, { config: { postgres_changes_options: { wait: true, timeout: 15000 } } })`,
  attaches one `postgres_changes` INSERT listener (`schema: 'public', table: 'session_events',
  filter: 'session_id=eq.' + sessionId`) that normalizes `row` (`schema_version, id, session_id,
  revision, type` → `schemaVersion, id, sessionId, revision, type`, revision coerced to `String(...)`
  if the driver ever hands back a number) and calls `onEvent`. `.subscribe((status, err) => ...)`
  maps the Supabase channel status to the engine's `SyncStatus` vocabulary:
  - `SUBSCRIBED` → `SyncStatus.SYNCED` (only fires once `wait: true` has cleared the DB-subscription
    barrier — this is the "hydrating → synced" signal the contract requires; the engine itself
    still performs the actual `hydrate()` on this transition, the adapter's job is only to report
    the transport is ready).
  - `TIMED_OUT`, `CHANNEL_ERROR` → `SyncStatus.RECONNECTING` (per contract: "treat timeout/CHANNEL_ERROR
    as reconnecting or error, never synced"; the adapter's own reconnect loop below decides which).
  - `CLOSED` → `SyncStatus.CLOSED` (only after an explicit `disconnect()`; the adapter guards against
    reporting `CLOSED` for a channel it is itself in the middle of tearing down as part of a
    reconnect, so a transient re-subscribe never gets misreported as a terminal close).
  - An RLS/authorization failure surfaced through the channel (e.g. `error` present on subscribe
    callback, or an immediate `CHANNEL_ERROR` that repeated reconnect attempts also fail with an
    authorization-shaped error) maps to `SyncStatus.DENIED` — determined empirically against the
    error shape Supabase actually returns; documented exactly in
    `docs/testing/issue-08c-verification.md` once observed, since the 8A contract does not pin the
    exact client-visible error shape for this case.
  - Returns an idempotent unsubscribe function that removes the channel via `client.removeChannel`.
- **Adapter generation/epoch guard**: each `subscribe()` call increments an internal counter and
  captures it; every `onEvent`/status callback closes over that captured generation and is a no-op
  if the adapter has moved on to a newer generation (a new `subscribe()` call for the same or a
  different session, or `disconnect()`). This is what "stale callback suppression after unsubscribe"
  and "session switch callback suppression" test — it is the adapter's own defense-in-depth layer,
  independent of (and in addition to) the engine's own `targetCtx !== ctx` guard one layer up.
- `mutate`: calls `client.rpc('mutate_session', { p_session: sessionId, p_command: command })` with
  the command exactly as the engine built it (`{schemaVersion, type, expectedRevision, payload,
  commandId?}`); throws the Supabase error object as-is (so `error.code` stays available for
  `isRevisionConflict`).
- `disconnect`: removes every channel this adapter instance created (tracked internally), safe to
  call when nothing is connected.
- Uses only the ordinary authenticated `client` passed in (the same one `getSupabaseClient()`
  returns) — no service-role key, no secret, never reads a "DM flag" from anywhere client-side.

### Task 1 tests (fake Supabase client double, not a real socket)

A small local test double for the *Supabase client shape* (`client.rpc`, `client.channel`,
`client.removeChannel`) lives in the test file itself (not shipped — this is testing the adapter's
own normalization/mapping logic, not the engine, so it does not reuse `fakeAdapter.js`, which fakes
the *engine's* adapter contract, one layer up). Covers: snapshot pass-through, event row
normalization (snake_case → camelCase, revision stringified), `SUBSCRIBED`→`SYNCED`,
`CHANNEL_ERROR`/`TIMED_OUT`→`RECONNECTING`, RPC mutation forwarding with the exact command shape,
RPC error propagation (including a `40001`-coded error surviving unchanged for
`isRevisionConflict`), idempotent `disconnect()`, and the generation guard: a callback fired
through an old channel handle after `subscribe()` was called again (session switch) or after
`disconnect()` never reaches the engine-facing `onEvent`/`onStatus`.

## Task 2 — Access loss + lifecycle controller

**New file:** `src/realtime/sessionLifecycle.js` — `createSessionLifecycle(engine, options)`.
**New tests:** `tests/realtime-session-lifecycle.test.js`.

A small controller wrapping a `createSyncEngine(...)` instance (Task 1's adapter is one valid
choice of adapter to hand it; tests use `createFakeAdapter()` from `src/realtime/fakeAdapter.js`
directly). Responsibilities, matching the work order's list exactly:

```js
export function createSessionLifecycle(engine, {
  onSnapshot, onStatus, onError,      // forwarded from engine.subscribe's handlers
  focusTarget = typeof window !== 'undefined' ? window : null, // injectable for tests
  periodicHydrateMs = 30000,           // per 8A contract's "suggested 30 seconds while connected"
} = {}) {
  return {
    start(sessionId) { /* engine.subscribe(sessionId, {...}) + focus/periodic wiring */ },
    stop() { /* engine.disconnect() + remove focus/interval listeners; idempotent */ },
    switchTo(sessionId) { /* same as calling start() again with a new id */ },
    getStatus() { /* engine.getStatus() */ },
  };
}
```

- **Session generation tracking**: an internal counter bumped on every `start`/`switchTo`/`stop`;
  the periodic-hydrate `setInterval` and the focus listener both capture their generation at
  creation and no-op if it's stale, so a `stop()` or session switch can never let a leftover timer
  fire a hydrate for the wrong (or no-longer-active) session — mirrors the same pattern already
  used inside `engine.js`.
- **Focus-triggered hydration**: listens for the `visibilitychange`/`focus` event on `focusTarget`
  (injectable so tests use a plain `EventTarget`, not a real `window`/`document`) and calls
  `engine.hydrate(sessionId)` — cheap because the engine's own coalescing means an already-fresh
  session just resolves the existing/next hydrate rather than double-fetching.
- **Periodic authorized hydration**: an interval (default 30s, overridable) doing the same, started
  only while `subscribe()`'s status is at/after `synced` and stopped on `stop()`/denial — this is
  the "quiet-session revocation" safety net the 8A contract calls for.
- **Locked denied behavior**, implemented as a thin wrapper around what `engine.js` already does on
  `DENIED` (clearing both watermarks, structurally blocking `mutate()`), plus what only the
  *lifecycle* layer can add:
  1. stop exposing stale data → forwards `onSnapshot`/`onStatus` exactly as the engine reports them
     (never synthesizes a fake "still connected" snapshot);
  2. tear down the active realtime channel → the periodic-hydrate interval and focus listener are
     both cancelled on `DENIED` (no further automatic hydration attempts), though the underlying
     engine subscription is deliberately *not* fully `disconnect()`-ed by the lifecycle itself (that
     stays an explicit `stop()`/navigation action — see point 6);
  3. clear watermarks → delegated entirely to `engine.js` (already implemented in 8B.1);
  4. block useful mutation structurally → delegated to `engine.js` (`mutate()` already rejects with
     no applied revision);
  5. retain only enough context to explain the denial → the controller keeps the last `onStatus`
     detail (e.g. `{ reason }`) available via a small `getLastDenialDetail()` accessor, and nothing
     else;
  6. do NOT wait for future socket invalidations to restore access → confirmed by construction:
     nothing in the lifecycle or engine re-arms automatic recovery on `DENIED`; recovery is always
     an explicit `start()`/`switchTo()`/`engine.hydrate()` call from the caller (navigation, an
     explicit "try again" action, or the periodic/focus timers *if* the caller chooses to leave
     `stop()` uncalled and only relies on point 2's cancellation... to avoid ambiguity, point 2
     above wins: both timers are cancelled on `DENIED`, so recovery is always an explicit caller
     action, never automatic).
- **Cleanup on logout/navigation**: `stop()` is the single idempotent teardown entry point 8C's
  `src/entry/app.js` integration calls; it is safe to call multiple times and safe to call before
  any `start()`.

### Task 2 tests

Using `createFakeAdapter()` + a plain injected `focusTarget` (an `EventTarget`) + fake timers via
explicit interval-callback capture (no `setTimeout`/real clocks in the test — the controller takes
an injectable `now`/interval implementation so tests fire it deterministically). Covers: `stop()`
after `start()` releases everything and is idempotent under repeated calls; calling `stop()` before
any `start()` is a no-op; `switchTo()` mid-session tears down the old one and a stale callback from
the old identity/session never reaches the new session's handlers; `DENIED` cancels both timers and
`getLastDenialDetail()` reflects it; a focus event triggers `engine.hydrate()`; a periodic tick
triggers `engine.hydrate()`; reconnect (`RECONNECTING`→`SYNCED`) is forwarded and doesn't itself
require lifecycle intervention (the engine already re-hydrates); nothing here ever touches
`localStorage`/`sessionStorage` (same source-scan style test as `tests/realtime.test.js`).

## Task 3 — Board state bridge

**New file:** `src/realtime/boardBridge.js` — pure functions, no DOM/script.js import.
**New tests:** `tests/realtime-board-bridge.test.js`.
**Legacy hook:** a small, additive, read-only block appended near the end of `script.js` (after
`initializeApp()`'s definition, before the trailing `initializeApp();` call) — see the architecture
decision above. No existing function in `script.js` is modified or moved.

```js
// src/realtime/boardBridge.js
export function createBoardView(snapshot) { /* pure: SessionSnapshot -> BoardView */ }
export function reconcileBoardView(previousView, snapshot) { /* replacement semantics; see below */ }
```

`createBoardView(snapshot)` returns a normalized, plain-object `BoardView`:

```js
{
  sessionId, revision,                       // pass-through, for staleness checks by the caller
  session: snapshot.session,                 // { id, name, status, activeLevelId } as-is
  roundNumber: snapshot.roundNumber,
  authority: snapshot.authority,             // { canManage, ownCharacterId } as-is — never re-derived
  tokens: [...snapshot.tokens],              // sorted by a stable key (kind, then label, then id) for deterministic rendering
  characters: [...snapshot.characters],
  initiative: [...snapshot.initiative],      // already flat/per-token; left as-is, not regrouped
  dm: snapshot.dm ?? null,                   // never fabricated when absent; passed through unchanged when present
}
```

It does **not** invent anything absent from the snapshot: no HP is derived from a condition label,
no hidden token is reconstructed, `dm` is `null` whenever the snapshot's `dm` is `null` (a player
projection) and is the exact passed-through object when present (an owner projection) — there is no
code path that could promote a player-shaped input into a DM-shaped view.

`reconcileBoardView(previousView, snapshot)` is the actual "apply an authoritative update" entry
point real callers use:

- If `snapshot.revision` (BigInt-compared, reusing the same non-lexical rule as `engine.js`) is not
  strictly newer than `previousView?.revision`, returns `previousView` unchanged (a stale/superseded
  snapshot — including an exact repeat — never regresses or even re-renders visible state).
- Otherwise returns `createBoardView(snapshot)`. Because `createBoardView` always rebuilds the full
  `tokens`/`characters`/`initiative` arrays *from the new snapshot alone*, this is replacement, not
  merge: a token/character/initiative entry missing from the new snapshot is simply absent from the
  new view's arrays — "removed" without any special-cased delete handling, satisfying "a missing
  object in a new authoritative snapshot must be removable from client-visible synchronized state."

The `script.js` hook (`applyRealtimeSnapshot(view)` / `window.aureRelicsApplyRealtimeSnapshot`)
takes a `BoardView` (already reconciled by the caller — the hook itself does no reconciliation,
staleness logic lives entirely in the tested `boardBridge.js`) and renders it into one small,
additive, hidden-by-default panel: round number, a read-only token list (label/kind/condition, no
coordinates rendered since the legacy grid has no compatible coordinate space yet), read-only
character cards (name, player name, HP/AC/statuses, public notes), a read-only initiative list, and
— only when `view.dm` is present — a small owner-only sub-section. All text is inserted via
`textContent`/escaped, matching the existing `escapeHtml`-equivalent discipline already used in
`src/entry/app.js`/`src/characters/panel.js`. Calling it with `null`/`undefined` hides and clears
the panel (used on `stop()`/`DENIED`).

### Task 3 tests

All against `boardBridge.js` directly (no DOM needed for these — `createBoardView`/
`reconcileBoardView` are pure): applying a snapshot populates `tokens`; a later snapshot omitting a
previously-present token removes it from the view; `roundNumber` updates; `initiative` is replaced
wholesale (an entry present before and absent after is gone, not merged); a `character.update`-shaped
field change is reflected; a player-shaped snapshot (`dm: null`) can never produce a view with a
truthy `dm` (asserted directly — there is no transformation step that could add one); an
owner-shaped snapshot's `dm` projection passes through unchanged; feeding the exact same snapshot
object twice returns the identical (by reference) previous view the second time (repeated identical
snapshot is a safe no-op); a snapshot with a lower/equal revision than the current view does not
regress (`reconcileBoardView` returns the unchanged previous view). One additional DOM-level test
(jsdom, matching the existing `tests/*.test.js` convention) drives `script.js`'s
`window.aureRelicsApplyRealtimeSnapshot` directly and asserts (a) it renders the given view into the
new panel, (b) it never touches `tokenData`/the grid/`initiativeEntries`, and (c) loading `script.js`
and exercising the existing offline path (`createGrid`/`placeToken`/`refreshCombatUI`) is completely
unaffected by the hook's presence — this is the "offline board remains unaffected" test.

## Task 4 — Existing feature mutation bridge

**New file:** `src/realtime/mutationBridge.js`.
**New tests:** `tests/realtime-mutation-bridge.test.js`.

Thin, fully-typed wrapper functions over `engine.mutate(sessionId, command)` — one per currently
supported command, doing only shape assembly (never re-implementing backend validation/bounds,
which stays exclusively server-side per the 8A contract):

```js
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
```

- No `movement.*`, `fog.*`, `terrain.*`, or any other command type is introduced — matching the 8A
  contract's explicit "Reserved concepts... Do not accept these command types" and this work
  order's own exclusions.
- No generic/arbitrary mutation function — only these four, each with a fixed, named payload shape.
- `expectedRevision` is never a parameter here — `engine.mutate()` already attaches it from the
  engine's applied-snapshot watermark (8B.1), so a caller of this bridge cannot supply a stale or
  fabricated one even by accident.
- **Conflict handling** is intentionally *not* baked into these four functions as auto-retry logic
  (the work order explicitly forbids blind replay). Instead, `mutationBridge.js` exports one more
  small helper used by callers that want the documented recovery flow:

```js
export async function mutateWithConflictRecovery(engine, sessionId, mutateFn) {
  try { return { ok: true, result: await mutateFn() }; }
  catch (error) {
    if (isRevisionConflict(error) || error?.code === '40P01') {
      await engine.hydrate(sessionId).catch(() => {}); // refresh; never re-attempts the mutation itself
      return { ok: false, conflict: true, error };
    }
    return { ok: false, conflict: false, error };
  }
}
```

  This satisfies "on 40001: surface conflict, hydrate, allow caller to decide whether to retry,
  NEVER auto-replay" and "on 40P01: treat as aborted conflict, hydrate before any explicit retry,
  never report success" with one shared, minimal implementation rather than duplicating the
  hydrate-then-surface pattern per command. It never calls `mutateFn` a second time itself.
- Legacy/local (non-realtime-session) behavior is untouched by construction: nothing in this file is
  imported by `script.js`, `legacyBootstrap.js`, or the offline path; it is only ever imported by
  whatever future UI wiring calls it (explicitly out of scope for this pass — see Known limitations).

### Task 4 tests

Using `createSyncEngine(createFakeAdapter())` directly (real engine, fake adapter — exercising the
actual `expectedRevision`-from-applied-snapshot behavior end-to-end, not re-mocking it): each of the
four functions sends the exact expected `type`/`payload` and lets the engine attach
`expectedRevision`/`schemaVersion`; a player-shaped fake adapter that rejects official mutations
with a `42501`-coded error demonstrates the bridge does not and cannot locally suppress or
special-case that (it just propagates it — "player cannot gain official-board mutation power
client-side" is a backend property this bridge deliberately does nothing to weaken); a `40001` fake
rejection drives `mutateWithConflictRecovery` and asserts `engine.hydrate` was called exactly once
and the original mutate was never retried; same for a `40P01`-coded rejection; a failed mutation's
promise rejection means no `onSnapshot`/view update ever happens as a side effect of the failed call
itself (failed mutation never optimistically becomes state — verified by asserting the fake
adapter's `mutate` call count and that no extra `hydrate` beyond the one conflict-recovery hydrate
occurred); a successful mutation's resolved value is exactly the fake adapter's resolved value,
never something synthesized locally ("successful mutation waits for backend/snapshot authority");
and — since nothing here touches the legacy path — a plain `node --test tests/*.test.js` run
confirms every pre-existing offline/local-mode test is still green with zero modification.

## Task 5 — Integration verification

No new source files. Runs, in order:

1. `node --test tests/realtime.test.js` (8B engine suite, unaffected by 8C — regression check).
2. `npm.cmd run check` (scaffold + every `tests/*.test.js`, including all new 8C suites).
3. `npm.cmd run build`.
4. `npm.cmd audit`.
5. Supabase 8A verification **against the already-running isolated `aure-relics-08a-security` stack**
   (confirmed present via `docker ps` before touching anything) — `AURE_TEST_STACK=08a npm.cmd run
   test:realtime-api` and `test:realtime-concurrency` (these create/delete only their own users; no
   `supabase db reset` is run against any stack, per the explicit instruction not to reset another
   agent's stack). If that stack is not reachable when this step actually runs, this is reported as
   a skipped/limited step rather than silently claimed.
6. Manual/scripted checks: grep the diff for any `service_role`/`sb_secret_`/hardcoded-URL pattern
   (reusing the same discipline `readSupabaseConfig` already enforces at runtime); confirm
   `index.html`'s raw offline path (`<script src="script.js"></script>`, no Vite) still parses/runs
   by re-running the existing scaffold check plus the new DOM test that exercises the offline path
   with the hook present; confirm the online entry flow (`src/entry/app.js`) is untouched, so guest
   join still never initializes `bootBoard`/DM dashboard access — verified by the existing, unmodified
   `tests/entry-*.test.js` suite passing unchanged; confirm `sessionLifecycle.stop()` is reachable
   from logout — verified in Task 2's own tests (this pass does not yet wire `stop()` into
   `src/entry/app.js`'s logout button, since doing so would require importing `src/realtime/**` into
   the entry flow and picking a concrete session-lifecycle ownership point in the UI, which the work
   order does not ask this pass to build the UI for — see Known limitations); confirm denial tears
   down realtime — verified in Task 2's own tests against the fake adapter.

This task does **not** claim multiplayer E2E is complete — that stays Copilot's (8D's) acceptance
gate, and `tests/e2e/**` is not touched by this branch at all.

## Documentation

- This file.
- `docs/testing/issue-08c-verification.md` — written after implementation, with exact results.

## Commit plan

1. `feat: add production realtime Supabase adapter`
2. `feat: add realtime session lifecycle controller`
3. `feat: bridge authorized snapshots into board state`
4. `feat: wire realtime session mutations`
5. `test/docs: verify Issue 8C integration`

## Known limitations (declared up front, not discovered after the fact)

- This pass does not wire any button/UI trigger to `mutationBridge.js`'s functions, and does not
  wire `sessionLifecycle.stop()` into `src/entry/app.js`'s logout/navigation handlers. It delivers
  four fully-tested, callable integration modules (`supabaseAdapter.js`, `sessionLifecycle.js`,
  `boardBridge.js`, `mutationBridge.js`) plus one minimal, safe, read-only legacy rendering hook.
  Turning that into a fully interactive, backend-authoritative editing UI is real remaining work,
  named explicitly in `docs/testing/issue-08c-verification.md` rather than left implicit.
- The realtime-rendered panel does not place tokens on the interactive grid (no coordinate space
  exists yet to do so meaningfully without inventing one) — round/token/character/initiative data
  is presented read-only, separate from the grid.
- The adapter's exact DENIED-detection error shape is determined empirically in Task 1 against
  Supabase's actual client behavior and documented once observed, since the 8A contract does not
  pin a single client-visible error code for a realtime-channel-level authorization failure (RLS
  denies at the row/RPC level; the channel-level behavior for a fully unauthorized subscribe is
  adapter-observed, not contract-specified).
