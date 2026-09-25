# Issue #8A Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Secure realtime invalidations, authorized snapshots and optimistic mutations for Issue #8A.
**Architecture:** Publish only sanitized invalidations. Compute explicit per-authorized-recipient snapshots and transactionally advance audience watermarks when those projections change. Existing writes and RPCs participate through database triggers.
**Tech Stack:** PostgreSQL 17, pinned Supabase CLI/JS, pgTAP, Node integration runner.
**Spec:** `docs/issue-08a-realtime-contract.md`, including the user's approved 8A/8B alignment.

## Global constraints

- Work only in `aure-relics-codex-08a`, branch `v09-08a-realtime-security`.
- No edits to `src/realtime/**`, `tests/realtime.test.js`, `tests/e2e/**`, or legacy board.
- Revisions are decimal strings; optimistic conflicts return `40001`.
- Events carry no payload, entity identifiers, labels, private state or command IDs.
- Keep all Issue #5/#6/#7 assertions; commit/push/PR, never merge.

## Review focus

1. Hidden-only changes must not advance a player's watermark.
2. Same-campaign foreign-session and revoked socket access must fail closed.
3. Concurrent commands and legacy direct writes must not lose invalidations.
4. Values above JS safe integer range must remain exact strings end to end.
5. Deleted/hidden entities and audience changes must remove obsolete client state on hydration.

## Task 1: authorized snapshots and notification foundation

Files: new CLI-created `supabase/migrations/*_realtime_security.sql`,
`supabase/tests/database/04_realtime.test.sql`.
Consumes existing canonical tables and authorization. Produces
`get_session_snapshot(p_session uuid) -> jsonb` and minimal `session_events` rows.

- [ ] Write pgTAP fixtures with owner A/B, two approved players, hidden enemy sentinel,
  same-campaign foreign session, and public character cards.
- [ ] Run `npm.cmd run test:db`; expect missing snapshot RPC assertions to fail.
- [ ] Implement explicit projections, private audience clocks and event ACLs, grants/RLS,
  and change triggers. Use internal per-recipient projections so own pending characters
  and hidden changes cannot leak through shared player counters.
- [ ] Assert `snapshot->>'revision'` is exact decimal text, player `dm` is null,
  hidden sentinels are absent, owner sees exact HP, and denied scopes raise `42501`.
- [ ] Assert trigger-driven hide/delete/legacy updates advance only affected projections.

## Task 2: scoped optimistic mutations and activity

Files: same migration and database test; `scripts/test-realtime-api.mjs`.
Produces `mutate_session(p_session uuid,p_command jsonb) -> jsonb`.

- [ ] Add failing tests: participant round change -> `42501`; stale revision -> `40001`;
  unknown keys/types -> `22023`; own-character updates succeed, another character fails.
- [ ] Implement allowlisted absolute-value commands for round, token public state,
  initiative, and Issue #7 own-character field updates. Preserve existing RPC behavior.
- [ ] Validate optional correlation-only `commandId`; omit it from realtime.
- [ ] Verify concurrent same-watermark mutations yield one winner and one conflict.
- [ ] Record explicit safe meaningful activity and expose it only to authorized owners.

## Task 3: real transport verification and handoff

Files: `scripts/test-realtime-api.mjs`, `docs/issue-08a-realtime-contract.md`,
`docs/testing/issue-08a-verification.md`, narrowly necessary package test script.

- [ ] Start an isolated local stack including Realtime; never reset another agent's stack.
- [ ] Subscribe actual owner, two players and unrelated identity. Assert sanitized events,
  per-recipient authorization, live revocation, reconnect hydration, hidden state removal,
  and hostile wildcard/delete subscription payloads. Use an allowed receiver as a
  delivery barrier before testing forbidden delivery; do not rely only on a short sleep.
- [ ] Run existing DB/API checks, new real socket tests, check/build/audit, SQL lint and
  security advisors. Record exact output and limitations.
- [ ] Review full diff and secrets; conduct independent whole-branch security review.
- [ ] Finalize exact adapter contract, commit, push branch, open 8A PR referencing #8.

## Execution ledger

- Initial checks: correct branch/base; only draft contract untracked; dependencies installed.
- Design detail: audience clocks are per recipient, not a single shared player clock.
  This preserves own pending-character snapshots without leaking their changes to peers.
  Private event ACLs keep recipient IDs out of the public event envelope.
- Ruling: use native inline implementation following the user's explicit instruction
  to continue; one independent whole-branch security reviewer at the end.
- Ruling: reuse existing API assertions on the separate 8A local stack through a
  two-value test-stack selector; do not migrate/reset the shared foundation stack.
- Ruling: the pre-realtime publication assertion now permits only `session_events`;
  new tests assert its exact safe columns, read-only grants and scoped delivery.
- Baseline RED: three missing backend interfaces; existing 162 SQL assertions green.
- Fog regression RED: a different revealed cell exposed a fogged token because SQL
  parameter names shadowed columns. Positional parameters fixed it; 194 SQL tests green.
- Review P1 RED: deterministic concurrent approval and legacy write returned changed
  state with unchanged new-recipient revision. Add campaign sync lock before audience
  enumeration; clean-stack deterministic regression now passes.
- Review P2 RED: alternate UUID spelling bypassed duplicate initiative validation and
  replaced stable IDs. Normalize comparisons to UUID; both clean-stack regressions now pass.
- Tool ruling: pinned CLI `db query` rejects multi-command files. Used transactional
  local-container psql to iterate, then isolated `db reset` to verify migration replay.
- Transport-test ruling: DELETE delivery is not guaranteed for this RLS publication.
  Assert retention physically removes old events; inspect every DELETE payload if
  delivered. Do not require an undocumented event that the local server suppresses.
- Cold-start RED: default SUBSCRIBED missed the first invalidation after stack restart.
  Verified pinned client source and added required `postgres_changes_options.wait=true`;
  full real socket suite passed after restarting the isolated Realtime service.
- Final verification: 204 SQL assertions; 156 existing API checks; 41 real socket/API
  checks; deterministic concurrency regression; 29 JS tests; build; audit (0
  vulnerabilities); local SQL lint and security advisors (no findings).
- Final independent review: two substantive findings, both reproduced RED and fixed
  GREEN; no deferred findings. Review was static; local runtime verification was
  performed by the implementer. Claude-owned files and the legacy board untouched.
