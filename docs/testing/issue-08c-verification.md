# Issue #8C verification — production realtime adapter + board integration

Branch: `v09-08c-board-integration`; base: `ad73746` (merge of Issue 8A `9ac8387` + Issue 8B.1
`576b9a1` onto `main` `af54f0c`). Plan: `docs/superpowers/plans/2026-09-24-issue-08c-realtime-integration.md`.

## Scope

Integrates the already-implemented, already-merged Issue 8A backend and Issue 8B client engine:
a production Supabase adapter, a session lifecycle controller, a pure board-state bridge plus one
minimal read-only legacy rendering hook, and a mutation bridge for the four currently-supported
commands. Does not implement fog, movement, terrain, locations/levels, or Authorized-DM/session-seat
transfer. Does not claim multiplayer E2E complete — that stays Issue 8D's (Copilot's) acceptance
gate, and `tests/e2e/**` is untouched by this branch.

## Production adapter (Task 1)

`src/realtime/supabaseAdapter.js` — `createSupabaseSyncAdapter(client)`, implementing `SyncAdapter`
exactly per `docs/issue-08a-realtime-contract.md`'s client adapter mapping: `hydrate` →
`get_session_snapshot` RPC (pass-through, errors thrown as-is); `subscribe` → a `session_events`
Postgres Changes INSERT subscription with `postgres_changes_options.wait: true` (`SUBSCRIBED` only
maps to `synced` once that database-subscription barrier clears, never on the earlier
channel-join signal); `mutate` → `mutate_session` RPC, command forwarded unchanged; `disconnect` →
removes every channel this adapter created. Uses only the ordinary authenticated client — no
service-role key, no secret, no client-side role/view-mode flag anywhere in this file (confirmed
by the diff scan below).

**Status mapping:** `SUBSCRIBED` → `synced`; `TIMED_OUT`/`CHANNEL_ERROR` → `reconnecting` by
default, or `denied` only when the error payload is recognizably an authorization failure
(`isAuthorizationErrorPayload` — checks a `42501`/`401`/`403` code or an
"not authorized"/"permission denied"/"access denied" message); `CLOSED` → `closed`, suppressed
when it's this adapter's own teardown. **This heuristic is adapter-observed, not contract-pinned**
— the 8A contract states "authorization failure → denied" as part of the status vocabulary but
does not specify the exact client-visible shape of a channel-level authorization failure (Postgres
Changes RLS typically filters rows silently rather than rejecting the subscription itself; a
genuine access-loss case is expected to surface primarily through a subsequent `hydrate()`
rejection, which `engine.js` — not modified by this pass — already classifies as `error`, not
`denied`; see "Known limitations/integration notes" below for why this is a real, deliberately
unresolved interaction between the two already-merged packages, not something silently glossed
over). Task 1's own tests exercise this mapping against a local Supabase-client-shape test double,
not a real socket; 8A's own test suite (already run below) is what exercised real WebSocket
revocation behavior.

An internal generation counter plus a defensive idempotent `removeChannel` guard against stale
callbacks after unsubscribe/disconnect/session-switch, and against leaking an abandoned channel if
`subscribe()` is called again without a prior unsubscribe (the engine always unsubscribes first;
this is defense in depth for direct adapter misuse).

15 tests, `tests/realtime-supabase-adapter.test.js`.

## Lifecycle controller (Task 2)

`src/realtime/sessionLifecycle.js` — `createSessionLifecycle(engine, options)`: `start`/`switchTo`
(subscribe + arm focus and periodic re-hydration, default 30s per the 8A contract's guidance, both
generation-guarded), `stop` (idempotent full teardown, safe before any `start`), `getStatus`,
`getSessionId`, `getLastDenialDetail`.

**Locked denied behavior**, split by ownership: `engine.js` (8B.1, unmodified) already clears both
revision watermarks and structurally blocks `mutate()` on `denied`. This controller's own added
behavior is narrower — cancel the periodic timer and remove the focus listener so nothing keeps
auto-retrying, and retain only the last status detail via `getLastDenialDetail()`. Recovery is
always an explicit `start()`/`switchTo()`/direct `engine.hydrate()` call from the caller; nothing
here re-arms automatic recovery on `denied`.

10 tests, `tests/realtime-session-lifecycle.test.js`, using `createFakeAdapter()` plus an
injectable focus `EventTarget` and interval scheduler — no real timers.

## Board bridge (Task 3)

`src/realtime/boardBridge.js` — `createBoardView(snapshot)` / `reconcileBoardView(previousView,
snapshot)`, pure and DOM-free. Replacement (not merge) semantics: every array is rebuilt from the
incoming snapshot alone, so an object missing from a new snapshot is simply absent from the next
view — no special-cased delete handling needed. Revision-guarded staleness reuses the same BigInt
(never lexical, never `Number`) rule as `engine.js`; a stale/duplicate snapshot returns the
previous view unchanged, by reference. A snapshot for a different session is always a fresh
install, since revisions are never comparable across sessions. `dm` is never fabricated — `null`
stays `null` for a player projection, passed through unchanged for an owner projection.

**Legacy hook:** a minimal, additive block appended to the very end of `script.js` (after
`initializeApp()`'s definition, before its call — no existing function moved or modified) exposing
`window.aureRelicsApplyRealtimeSnapshot(view)`. It renders round/tokens/characters/initiative,
plus an owner-only section when `dm` is present, into a new panel created entirely in JS
(`index.html` was not modified). It never reads or writes `tokenData`, the grid, or
`initiativeEntries` — confirmed by a jsdom test that boots the real `script.js` against the raw
offline `index.html` and asserts the panel renders correctly while the grid/HUD state stays
completely empty, plus a second jsdom test confirming the ordinary offline click-to-place-token
flow still works identically with the hook present, and that the panel element doesn't even exist
until something calls the hook.

13 tests, `tests/realtime-board-bridge.test.js` (11 pure + 2 jsdom).

## Mutation bridge (Task 4)

`src/realtime/mutationBridge.js` — `createMutationBridge(engine)`: `setRound`,
`setTokenPublicState`, `setInitiative`, `updateCharacter`, one per 8A-supported command type, each
only assembling `{type, payload}` — `expectedRevision` is attached automatically by
`engine.mutate()` from its own applied-snapshot watermark, never supplied by (or forgeable through)
this bridge. No movement/fog/terrain command and no generic mutation function exists.
`mutateWithConflictRecovery(engine, sessionId, mutateFn)` is the shared `40001`/`40P01` recovery
flow: re-hydrate, surface the conflict, never auto-replay the mutation, never report an aborted
transaction as success.

7 tests, `tests/realtime-mutation-bridge.test.js`, using a real `createSyncEngine(createFakeAdapter())`
(exercising the real `expectedRevision` behavior end to end, not re-mocked), including a `42501`
player-shaped rejection propagating unsuppressed and a source-scan confirming
`src/main.js`/`legacyBootstrap.js` never import this bridge.

## Verification results

| Check | Result |
| --- | --- |
| `node --test tests/realtime.test.js` (8B regression) | PASS; 22/22 |
| `npm.cmd run check` (scaffold + all `tests/*.test.js`) | PASS; 96/96 (29 pre-existing entry/character/supabase-client + 22 realtime engine + 15 adapter + 10 lifecycle + 13 board bridge + 7 mutation bridge) |
| `npm.cmd run build` | PASS; Vite 6.4.3 |
| `npm.cmd run audit` | PASS; 0 vulnerabilities |
| `AURE_TEST_STACK=08a npm.cmd run test:realtime-api` (already-running isolated 8A stack, not reset) | PASS; 41/41 |
| `AURE_TEST_STACK=08a npm.cmd run test:realtime-concurrency` (same stack) | PASS; 1/1 |
| Diff scanned for `service_role`/`sb_secret_`/hardcoded non-local URLs | Only match: this file's/the adapter's own prose saying those must never be used |
| Diff touches `src/entry/**`, `src/supabase/**`, `supabase/**`, `scripts/test-*-api.mjs`, `tests/e2e/**`, `playwright.config.js`, `package.json`, `package-lock.json` | None — confirmed via `git diff --stat` against every one of those paths returning empty |

The isolated `aure-relics-08a-security` Docker stack (started by the 8A agent) was already running
and healthy; this session recreated only the local, gitignored `supabase/.temp/issue08a/supabase/config.toml`
pointer file in this worktree (no `supabase start`, no `db reset` — the stack's data/containers
were never touched) so the existing test runners could locate it, exactly as
`docs/testing/issue-08a-verification.md` describes for a fresh worktree.

## Files changed

- `docs/superpowers/plans/2026-09-24-issue-08c-realtime-integration.md` (new)
- `docs/testing/issue-08c-verification.md` (new, this file)
- `src/realtime/supabaseAdapter.js` (new)
- `src/realtime/sessionLifecycle.js` (new)
- `src/realtime/boardBridge.js` (new)
- `src/realtime/mutationBridge.js` (new)
- `script.js` (append-only: one new block at the end, no existing function moved/modified)
- `tests/realtime-supabase-adapter.test.js` (new)
- `tests/realtime-session-lifecycle.test.js` (new)
- `tests/realtime-board-bridge.test.js` (new)
- `tests/realtime-mutation-bridge.test.js` (new)

`src/entry/**`, `src/supabase/**`, `src/main.js`, `src/app/legacyBootstrap.js`, `index.html`,
`supabase/**`, `scripts/test-*-api.mjs`, `tests/e2e/**`, `playwright.config.js`, `package.json` and
`package-lock.json` are all unmodified.

## Known limitations / integration notes

- **This pass does not wire any UI trigger** to `mutationBridge.js`'s functions, and does not wire
  `sessionLifecycle.stop()` into `src/entry/app.js`'s logout/navigation handlers (doing so was a
  deliberate, declared-up-front scoping decision in the plan — see its Architecture decision
  section — not an oversight). It delivers four fully-tested, callable integration modules plus
  one minimal, safe, read-only legacy rendering hook. Turning this into a fully interactive,
  backend-authoritative editing UI (buttons that call `mutationBridge`, `sessionLifecycle` owning
  actual page-navigation/logout lifecycle, tokens placed on the interactive grid) is real remaining
  work for a follow-up pass.
- **The `denied`-status gap described above under "Production adapter" is a real, confirmed
  interaction** between the already-merged 8A contract text and the already-merged 8B engine
  (`engine.js`'s `performHydrate` always classifies a failed `hydrate()` as `error`, never `denied`
  — `denied` in the engine is only ever adapter-`onStatus`-driven). Per this task's own
  instructions, `engine.js`'s contract was not redesigned to fix this. The adapter's
  `isAuthorizationErrorPayload` heuristic on the subscribe-status path is the only place `denied`
  can currently originate from in this integration; a hydrate-time-only authorization denial (e.g.
  the most common real case — a revoked player whose next scheduled hydrate simply gets rejected)
  will currently surface as `error`, not `denied`, to a UI consumer. This does not weaken security
  (the backend still refuses the read/write either way, and `engine.js`'s `ERROR` handling does not
  expose stale state), but a UI built on top of this integration should treat both `error` and
  `denied` as "stop trusting current state" rather than assuming `denied` is the only such signal.
  Flagging this explicitly for whoever picks up interactive UI wiring next, rather than leaving it
  implicit.
- Task 1's status-mapping tests use a local Supabase-client-shape test double, not a real socket;
  real revoked-access-while-connected behavior against an actual socket is exercised by 8A's own
  `test:realtime-api`/`test:realtime-concurrency` suites (both re-run above, both passing), not
  duplicated here.
- The realtime-rendered panel does not place tokens on the interactive grid — round/token/
  character/initiative data is presented read-only, separate from the grid, since no coordinate
  space compatible with the legacy grid exists yet for realtime tokens (grid/fog/terrain/locations
  integration is explicitly out of scope for Issue #8).

## Remaining work before 8D / 8E

- Copilot's 8D multiplayer QA harness is the acceptance gate for actual live DM+player browser
  behavior; this pass only confirms the pieces it built are individually correct and don't regress
  anything already merged.
- A follow-up pass should decide and implement: where `sessionLifecycle` is owned/started from in
  `src/entry/app.js` (likely the `board` route, replacing or supplementing `bootBoard`), how/where
  `mutationBridge` calls are triggered from real UI, and — given the `denied`/`error` gap above —
  whether a small, carefully-scoped follow-up to the adapter (not to `engine.js`, which stays
  intentionally stable) can make periodic/focus-triggered hydration failures that carry an
  authorization-shaped error also report through `onStatus(denied)` via the same channel the
  subscribe callback already owns, rather than only relying on the channel-status heuristic.
