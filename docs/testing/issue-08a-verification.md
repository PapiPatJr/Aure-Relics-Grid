# Issue #8A backend/realtime verification

Verified 2026-09-23 (Pacific date; migration timestamp is UTC).
Branch: `v09-08a-realtime-security`; base: `af54f0c46028078576f9b8cf730c268dd52e0a81`.

## Scope

Migration `20260924031958_realtime_security.sql` adds private recipient projection
clocks and event ACLs, sanitized public notifications, secure snapshot and mutation
RPCs, and triggers for current canonical writes. No frontend engine, board, E2E,
movement, terrain engine, or authorized-DM transfer changes.

The exact integration interface is in [the 8A contract](../issue-08a-realtime-contract.md).
Use `postgres_changes_options.wait: true`, decimal-string revisions with BigInt
comparisons, and subscription-before-hydration with buffered/coalesced invalidations.
`commandId` is optional correlation metadata, not an idempotency key.

## Reproduce on an isolated stack

From this worktree in PowerShell, with Docker running:

```powershell
npm.cmd ci
$testRoot = Join-Path (Get-Location) 'supabase/.temp/issue08a'
New-Item -ItemType Directory -Force -Path "$testRoot/supabase" | Out-Null
$config = Get-Content supabase/config.toml -Raw
$config = $config.Replace('aure-relics-v09-foundation','aure-relics-08a-security').Replace('5632','5732').Replace('8083','8183')
Set-Content -LiteralPath "$testRoot/supabase/config.toml" -Value $config
Copy-Item -LiteralPath supabase/migrations -Destination "$testRoot/supabase" -Recurse -Force
Copy-Item -LiteralPath supabase/tests -Destination "$testRoot/supabase" -Recurse -Force
npm.cmd exec -- supabase start --workdir supabase/.temp/issue08a -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
# Reset ONLY this disposable 8A stack when validating a clean replay:
npm.cmd exec -- supabase db reset --local --workdir supabase/.temp/issue08a --yes
$env:AURE_TEST_STACK='08a'
npm.cmd run test:db -- --workdir supabase/.temp/issue08a
npm.cmd run test:api
npm.cmd run test:realtime-concurrency
npm.cmd run test:realtime-api
npm.cmd exec -- supabase db lint --local --workdir supabase/.temp/issue08a --schema public,private --fail-on warning
npm.cmd exec -- supabase db advisors --local --workdir supabase/.temp/issue08a --type security --level warn --fail-on error
npm.cmd run check
npm.cmd run build
npm.cmd audit
```

Run SQL fixtures separately from API/concurrency fixtures: existing foundation SQL
tests select across all fixture rows and expect a clean database. API tests delete
only their created users/campaigns. The concurrency runner uses three local psql
connections through Docker and observes `pg_stat_activity` lock waits; it does not
use a sleep as evidence that the race occurred.

`local-test-stack.mjs` allows only the original foundation project/API pair or the
fixed 8A project/API pair. It rejects arbitrary URLs and other projects. CLI
administrative credentials stay in test-process memory, never in browser code,
logs, checked-in config, or the contract. The shared foundation stack and the
unrelated household stack were not reset or migrated.

## Results

| Verification | Result |
| --- | --- |
| Clean isolated migration replay | PASS, all five migrations |
| `test:db` with isolated workdir | PASS, 204 assertions: 162 existing + 42 new |
| `test:api`, `AURE_TEST_STACK=08a` | PASS, 156 checks: 22 foundation + 42 enrollment + 92 character |
| `test:realtime-api`, same stack | PASS, 41 checks with actual Auth/PostgREST/WebSockets |
| `test:realtime-concurrency`, same stack | PASS, deterministic overlapping enrollment/legacy write |
| `check` | PASS, scaffold plus 29 JavaScript tests |
| `build` | PASS, Vite production build |
| `audit` | PASS, zero vulnerabilities |
| SQL lint `public,private` | PASS, no schema errors |
| Local security advisors, warn/error threshold | PASS, no findings |

## Security evidence

- Owner official commands succeed; participant official commands fail.
- Own-character updates succeed; another character and another level fail.
- Campaign/session isolation includes an unjoined session within the same campaign.
- An owner of campaign B, approved as a player in A, receives no A DM state.
- Hidden/fogged tokens, hidden initiative/active identities, DM notes and exact
  enemy HP are absent from player snapshots. Only explicit fields are projected.
- Hidden edits and another recipient's pending-character edits do not advance a
  player's watermark. Event rows contain exactly five allowlisted columns.
- Current membership and management authority govern both historical event SELECT
  and live delivery. A connected revoked player stops receiving useful events;
  reconnect hydration, mutation, and removed-member reads fail closed.
- Bare anon cannot hydrate. Authenticated callers cannot invoke recipient-override
  projection helpers, mint events, or read private projection clocks.
- Revision above `Number.MAX_SAFE_INTEGER` remains exact decimal text.
- Same-watermark concurrent commands produce one success and one `40001`.
- Retention physically removes old events and retains 256 per recipient/session.
  The local server did not deliver pruning DELETE messages. Every DELETE observed
  by wildcard test listeners is checked for only a random UUID; SQL retains default
  replica identity and no private/source table is published.
- No production service-role credential was introduced. Test credentials are local;
  no secrets are copied to event payloads.

The original blanket publication assertion predates realtime. It now permits only
the sanitized table; every existing source table remains forbidden. New assertions
test the permitted table's exact projection, privileges and delivery. No existing
behavior/security assertion was removed.

## Failures found and fixed

1. Test-first baseline: new interfaces/table absent; original SQL assertions passed.
2. Fog predicate: SQL parameters collided with column names. A test showing a
   different revealed cell exposing a fogged token failed, then passed with positional
   parameters. Both reveal and hide are covered.
3. Independent review P1: recipient enumeration before a lock wait missed a newly
   approved recipient during a legacy write. A deterministic two-writer regression
   failed, then passed after serializing enumeration with a campaign sync lock.
4. Independent review P2: alternate UUID spelling bypassed initiative uniqueness and
   replaced stable IDs. Both regressions failed, then passed after UUID comparisons.
5. Cold-start readiness: default SUBSCRIBED preceded PostgreSQL readiness. The socket
   test timed out on the first event after clean startup. The pinned client's
   `wait: true` option fixed it; the full suite passed after restarting the isolated
   Realtime container.

The independent review was static; its sandbox could not access Docker. The
implementer ran all reproduction/verification tests. No findings remain deferred.

## Operational notes and limits

- Designed for small tabletop campaigns: per-recipient recomputation and event
  fanout are intentional; large-campaign throughput is not benchmarked.
- Legacy direct writes may encounter PostgreSQL `40P01` deadlocks when mixed with
  concurrent RPCs. Failed transactions roll back atomically; hydrate before an
  explicit retry. New stale commands return `40001`.
- No replay guarantee. Periodic/focus hydration catches quiet revocation or missed
  notifications; clear client caches on denial and identity changes.
- Hosted deployment/advisors and full DM-plus-two-browser UI integration were not
  performed. Database/Auth/WebSockets were tested locally; 8C/QA own UI integration.
  This work does not claim Issue #8 as a whole is complete.
- Initial sandbox build/audit attempts were blocked by filesystem/network access;
  normal-access reruns passed. `npm ci` reported the existing unapproved esbuild
  install-script notice. No dependency version changed.
- The pinned CLI's `db query --file` rejected multiple statements. Iteration used
  transactional psql in the isolated container, followed by clean migration replay.
