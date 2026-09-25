# Issue #8A realtime architecture and client contract

Status: implemented and locally verified, including the locked 8A/8B alignment.
Worktree: `aure-relics-codex-08a`. Branch: `v09-08a-realtime-security`.
Base: `af54f0c46028078576f9b8cf730c268dd52e0a81`.

## Scope and intent

Provide the secure backend for the transport-neutral `hydrate`, `subscribe`,
`mutate`, and `disconnect` adapter owned by Claude. Preserve owner-centric
management and the existing Issue #5/#6/#7 authorization guarantees. Account
identity, campaign membership, campaign authority, session authority, character
assignment, and presentation mode remain independent concepts. An anonymous Auth
identity may participate but cannot acquire owner/DM authority.

## Architecture and alternatives

Use Supabase Postgres Changes for INSERT events on a dedicated, sanitized
`public.session_events` table. Its SELECT policy checks current campaign/session
authorization for each recipient. Grant authenticated clients SELECT only;
only internal triggers create events. Do not publish canonical game tables,
private tables, activity details, or code tables.

Use a separate audience and counter for each `(session_id, user_id)`. A single
shared player counter would leak changes to another player's pending character.
`private.session_sync` stores the last recipient projection and bigint revision;
`private.session_event_access` binds each notification UUID to its recipient and
the management permission at emission. Neither private table is API-readable.
The event RLS policy rechecks recipient identity, current session membership and
current management permission. Owners receive only their own DM-projected stream.
Events invalidate a snapshot; they do not contain row images or state patches.
`get_session_snapshot(p_session uuid)` returns a consistent, explicitly projected
snapshot and checks current authorization on every call. SQL builds projections
from explicit field lists, never `to_jsonb(row)` on source records.

Alternatives considered:

1. Private Broadcast is Supabase's general recommendation for scale. However,
   channel permissions are cached until reconnect/token refresh. It would need
   additional revocation handling, such as audience epoch rotation, before
   carrying useful state safely. This is more machinery than 8A needs.
2. Publishing existing tables is simple but makes row visibility transitions,
   delete events, and accidental private-field additions difficult to secure.
3. Sanitized Postgres Changes plus snapshots gives per-event authorization and
   simple recovery. The cost is a snapshot fetch per coalesced burst and lower
   throughput. This is the implemented v0.9 choice, tested with real sockets.

Current tokens belong to campaign levels, not sessions. A token change invalidates
every session currently using that level; snapshots still require access to the
specific requested session. Character changes invalidate sessions with assignments
to that character. The trigger implementation recomputes eligible recipients in
the affected campaign in a stable lock order, comparing explicit JSON projections.
Only changed projections advance counters. This handles visibility removal by
comparing the previous stored projection with the newly authorized projection.
This bounded tabletop design trades database work and private projection storage
for correctness; it is not intended for thousands of participants per campaign.

## Client adapter mapping

| Adapter operation | Backend mapping |
| --- | --- |
| `hydrate(sessionId)` | RPC `get_session_snapshot({p_session: sessionId})` |
| `subscribe(sessionId, handlers)` | Postgres Changes INSERT, schema `public`, table `session_events`, filter `session_id=eq.<uuid>` |
| `mutate(sessionId, command)` | RPC `mutate_session({p_session: sessionId, p_command: command})` |
| `disconnect()` | Remove adapter-owned channel and cancel pending hydration/retry work |

The filter saves work; RLS is the authorization boundary. A successful socket
subscription alone does not prove session access. The adapter performs hydration
to determine whether it may expose session state. No client-authored broadcasts
or Presence messages carry authoritative game state.

The backend package documents the Supabase calls and tests them directly. It does
not edit `src/realtime/**`, `tests/realtime.test.js`, `tests/e2e/**`, or legacy `script.js`.

```js
// Use the authenticated user's ordinary Supabase client; no service-role key.
const channel = client.channel(`session:${sessionId}`, {
  config: { postgres_changes_options: { wait: true, timeout: 15000 } }
})
  .on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'session_events',
    filter: `session_id=eq.${sessionId}`
  }, ({ new: row }) => handlers.onEvent({
    schemaVersion: row.schema_version, id: row.id, sessionId: row.session_id,
    revision: row.revision, type: row.type
  }))
  .subscribe(handlers.onTransportStatus);
const { data: snapshot, error } = await client.rpc('get_session_snapshot', {
  p_session: sessionId
}); // Call only after SUBSCRIBED; buffer events before this call.
```

This snippet defines the backend calls, not a complete client engine. The adapter
must implement the ordering, coalescing, error handling and cancellation below.

## Snapshot shape

```js
{
  schemaVersion: 1,
  sessionId: "uuid",
  campaignId: "uuid",
  revision: "42", // decimal string; compare with BigInt, not lexically
  authority: { canManage: false, ownCharacterId: "uuid-or-null" },
  session: { id: "uuid", name: "Session", status: "active", activeLevelId: "uuid-or-null" },
  roundNumber: 1,
  tokens: [],
  characters: [],
  initiative: [],
  dm: null
}
```

Tokens include stable ID, level/character references, kind, public label,
condition label, position, and dimensions. Player tokens must be visible and
pass existing revealed-rectangle checks on the requested session's active level.
Players receive no hidden token identifiers, exact enemy HP, or DM notes.
Lobby sessions do not expose tokens/initiative to players; closed sessions deny
participant snapshots. Owners may inspect their active level in any session status.

Characters include explicitly allowed party-card fields from Issue #7: ID,
name/player name, HP/max/temp HP, AC, speed, statuses, public notes, portrait path,
approval and update timestamp. Players receive approved characters assigned to
approved participants of this session, plus their own pending submission.
Do not reuse the campaign-wide management panel as the party snapshot.

Initiative includes ID, visible token ID, initiative value, position, and active
flag. Omit entries for hidden tokens, including hidden active-turn identities.

For authorized owners, `dm` contains explicit token detail projections and a
bounded recent activity list. It is absent (`null`) for players. Code plaintext,
hashes, and credentials are excluded even from DM snapshots. Owner-only hidden
state is projected separately from player-facing fields. Exact nested keys:

| Array/object | Fields |
| --- | --- |
| `tokens[]` | `id, levelId, characterId, kind, label, conditionLabel, x, y, width, height, isVisible` |
| `characters[]` | `id, name, playerName, approved, hp, maxHp, tempHp, ac, speed, statuses, publicNotes, imagePath, updatedAt` |
| `initiative[]` | `id, tokenId, initiative, position, isActive` |
| `dm.tokenDetails[]` | `tokenId, actualHp, maxHp, dmNotes` |
| `dm.notes[]` | `id, subject, body` (campaign owner only) |
| `dm.activity[]` | `id, eventType, actorId, createdAt` (latest 50 for this session) |

Owner character snapshots include session-assigned cards, including pending ones;
campaign-wide management remains in `get_character_panel`. Activity details stay
in the existing private feed and are not copied into this snapshot. Empty arrays
are `[]`; missing character/level assignments are JSON `null`, not string values.

## Event envelope and versions

```js
{
  schemaVersion: 1,
  id: "random-uuid",
  sessionId: "uuid",
  revision: "43",
  type: "session.invalidated"
}
```

The database row has exactly `schema_version, id, session_id, revision, type`.
The adapter normalizes snake_case to this envelope. Recipient ACLs are private;
there is no public audience or recipient column. The row
contains no actor, entity IDs, labels, field values, row images, or freeform JSON.
An invalidation is not a player-readable activity record. A revision is a monotonic
session-and-recipient counter, allocated transactionally under a row lock; it is not a timestamp
or an independent sequence whose allocation order can differ from commit order.
Existing writes also advance it via triggers. Revisions can have gaps. Multiple
invalidations may commit in one transaction, so never infer a state delta from
the difference. Never compare revisions across sessions or identities. Clear the
watermark on account changes; the RPC binds identity using `auth.uid()`.

Keep a small bounded history (latest 256 invalidations per session and recipient); recovery never
depends on replay. Primary keys are random event UUIDs so housekeeping DELETE
events cannot disclose session/entity identifiers. Test adversarial wildcard and
DELETE subscriptions because DELETE does not receive the same RLS guarantees.
Do not enable full replica identity on this table.

Hidden-only mutations produce owner-only invalidations; they must not reveal even
hidden entity IDs or labels through activity. Player revisions describe only the
player-visible synchronization stream. An operation that changes a projection
from visible to hidden must invalidate that audience so its next snapshot removes
the object. Snapshot comparison handles both sides of that transition. Current
participants share one session level and existing fog rules, while own pending
character cards and management projections remain recipient-specific.

## Mutation model

`MutationCommand` has `schemaVersion`, `type`, `expectedRevision`, and `payload`,
plus optional `commandId`. `expectedRevision` is the client's current authoritative
snapshot watermark, encoded as a decimal string. Both adapters and engines must
compare revisions using BigInt semantics, never lexical comparison or JS Number.
`commandId` is bounded correlation metadata only: never authorization, never a
secret, and not a deduplication/idempotency guarantee. If present it must be a
string of 1-128 characters. It is accepted but not persisted, echoed, or published;
the adapter can correlate its local request promise using its original value.
Unknown command types, unknown keys, invalid UUIDs/types/ranges, mismatched
campaign/session/level references, and inappropriate entity kinds fail closed.

Initial commands:

| Command | Allowed actor | Payload |
| --- | --- | --- |
| `session.setRound` | Current owner authority | `roundNumber` |
| `token.setPublicState` | Current owner authority | Existing active-level `tokenId`, `label`, `conditionLabel`, `isVisible` |
| `initiative.set` | Current owner authority | Entries for tokens on this session's active level, with initiative/position/active flag |
| `character.update` | Owner or currently assigned participant | Character ID plus the explicit Issue #7 character field set |

Every payload is a complete replacement of the named command's field set; missing
or extra keys are rejected. Exact payloads and bounds:

```js
{ roundNumber: 2 } // integer 1..999999999
{ tokenId: 'uuid', label: 'Enemy', conditionLabel: 'Hurt', isVisible: true }
// label: 1..200 trimmed characters; conditionLabel: existing DB enum
{ entries: [{ tokenId: 'uuid', initiative: 15, position: 0, isActive: true }] }
// <=200 entries, unique token IDs, at most one active; initiative -9999..9999,
// position 0..9999. [] clears initiative. Existing entry IDs are preserved.
{ characterId: 'uuid', name: 'Hero', playerName: 'Player', hp: 12, maxHp: 20,
  tempHp: 0, ac: 15, speed: 30, statuses: ['Inspired'], publicNotes: 'Shared' }
// Issue #7 bounds: names 1..80 trimmed chars; hp -999..9999; maxHp/tempHp 0..9999;
// ac 0..99; speed 0..999; <=20 statuses, each 1..60 chars; publicNotes <=2000 chars.
```

Wire example:

```js
await client.rpc('mutate_session', { p_session: sessionId, p_command: {
  schemaVersion: 1, type: 'session.setRound', expectedRevision: snapshot.revision,
  payload: { roundNumber: 2 }, commandId: 'optional-client-correlation'
}});
```

No arbitrary table/column mutation or JSON merge endpoint. No movement command in
8A. Existing owner REST writes remain subject to RLS and generate invalidations.
Existing character RPCs remain compatible and generate invalidations and safe
activity for HP/AC/status changes without requiring client migration.

Use public SECURITY INVOKER wrappers and fixed-search-path private helpers where
privilege is needed, matching repository practice. Check identity and authority
inside every privileged entry point; grant no function execution to bare `anon`.
Preserve the existing campaign/session/membership locking discipline. Review
trigger lock order against both enrollment and character RPCs. New mutation RPCs
serialize by campaign and lock the session/membership before audience clocks.
All projection writers also acquire a campaign synchronization lock before
enumerating recipients. This ensures a concurrent approval/session creation is
included after a lock wait; enumerating recipients before the wait is unsafe.
Concurrent legacy direct writes can still produce PostgreSQL `40P01` deadlocks;
PostgreSQL rolls back the entire losing transaction. Treat that as a retriable
conflict after hydration, never as a successful write or permission to blind replay.

`expectedRevision` is required for new commands. Reject stale commands with
SQLSTATE `40001`; hydrate before retrying. A lost response is resolved by hydration,
not blind replay. Commands use absolute values rather than additive operations.
Return the resulting authorized snapshot after a successful mutation.

## Authorization matrix

| Caller | Hydration/events | Official mutations | Character changes | Private state |
| --- | --- | --- | --- | --- |
| Registered campaign owner | Own campaign session | Allowed in own session | Own campaign, scoped command | Own campaign only |
| Approved registered participant | Approved open session | Denied | Currently assigned own character | Denied |
| Approved anonymous Auth participant | Approved open session | Denied | Currently assigned own character | Denied |
| Pending/revoked/removed participant | Denied | Denied | Denied | Denied |
| Unrelated campaign owner | Denied | Denied | Denied | Denied |
| Bare anon key | Denied | Denied | Denied | Denied |

Closed sessions deny participant hydration, mutations, and useful events. Owners
retain management reads. Current membership/assignment is checked in the database;
route/view state and user-editable JWT metadata have no authorization role.

Errors: `42501` for unavailable/unauthorized scope without disclosing existence;
`22023` for malformed commands; `40001` for revision conflicts; `40P01` for an
aborted conflicting legacy transaction. Constraint errors
must not become an existence oracle across unauthorized scopes.

## Reconnect and access removal

REQUIRED adapter behavior: subscribe, wait for SUBSCRIBED, buffer invalidations,
then hydrate. Install the
snapshot and discard buffered events at or below its revision. Coalesce newer
events into another hydration. Apply the same sequence on reconnect/token refresh;
ignore responses from an obsolete connection or session generation.

Use `config.postgres_changes_options.wait: true` with the pinned Supabase JS
2.116.0 client. Without it, `SUBSCRIBED` can mean only that the channel joined,
before PostgreSQL replication is ready. A clean-stack socket test reproduced a
missed initial invalidation with the default. The wait option makes SUBSCRIBED
the required database-subscription barrier; treat timeout/CHANNEL_ERROR as
reconnecting or error, never synced. A deployment must support this server option;
do not silently downgrade to the early channel-join signal.

On denial, clear the adapter's session cache and stop mutations. A periodic
authorized hydration (suggested 30 seconds while connected), plus hydration on
focus, handles quiet-session revocation and missed events. Server access denial
does not wait for this timer: subsequent data reads/events already enforce current
authorization. Data lawfully received before revocation cannot be recalled.

Use the existing client `SyncStatus` vocabulary: `idle`, `hydrating`, `synced`,
`reconnecting`, `denied`, `error`, `closed`. Initial subscription/hydration maps to
`hydrating`; successful snapshot installation to `synced`; transport interruption
to `reconnecting`; authorization failure to `denied`; unrecoverable validation or
transport failure to `error`; unexpected transport closure to `closed`. Explicit
engine disconnect/lifecycle stop returns to `idle`, also the pre-connect state.
These are lifecycle states, never backend roles.

Transport readiness alone never establishes authorization or consumer `synced`.
Both transport denial and snapshot SQLSTATE `42501` clear synchronized views and
watermarks, invalidate pending reads/recovery callbacks, remove the subscription,
and stop automatic recovery. Re-entry requires an explicit start/subscribe (or an
explicit standalone hydrate); abandoned mutation conflicts cannot restart it.

The production sequence is database mutation -> sanitized invalidation -> revision
notification -> secure hydration -> UI snapshot. No event patches authoritative
state. The adapter may wrap the flat snapshot in the client engine's state wrapper;
this does not change backend projections or their authorization. The required
subscribe-before-hydrate sequence also applies after every reconnect.

## Activity and extension points

Keep detailed meaningful activity in `private.activity_feed`, owner-readable only.
Log allowlisted before/after fields for character HP/AC/status changes from both
old and new APIs. New official commands log their command type, actor and session;
raw legacy official writes generate invalidations but no extra activity entry.
Never copy arbitrary commands,
private notes, code values, or hashes into shared events.

Future features add versioned command handlers, explicit snapshot projections,
visibility tests, and invalidation triggers. Reserved concepts include fog,
terrain/effects, locations/levels, and movement. Do not accept these command types
until their authorization and projection implementations exist.

## Non-goals

No DM God Screen, fog UI, movement, terrain engine, location/level UI, frontend
refactor, authorized-DM transfer, event-sourcing platform, or work on Issue #9+.
No merge. No edits to other agents' worktrees.

## Implementation and verification sequence

1. Install missing dependencies with `npm.cmd ci`; inspect pinned CLI help.
2. Write failing SQL/API/socket security tests for the contract and role matrix.
3. Add migration using the Supabase CLI: audience revisions/events, projection and
   mutation RPCs, scoped triggers, explicit grants and RLS.
4. Exercise legacy writes and new RPCs with real owner, two participant, outsider,
   and revoked identities. Include hidden/private sentinels, same-campaign foreign
   sessions, malformed commands, duplicate/stale events, and reconnect hydration.
5. Test live WebSockets, including revocation while connected, hide/delete
   transitions, and unauthorized wildcard subscriptions. HTTP/SQL checks alone
   cannot establish realtime security.
6. Run `npm.cmd run test:db`, `npm.cmd run test:api`, the new 8A socket runner,
   `npm.cmd run check`, `npm.cmd run build`, and `npm.cmd audit`.
7. Run repository-standard local SQL lint and security advisors. Review complete
   diff, document exact implemented shapes/results, commit, push, open 8A PR
   referencing #8; do not merge.

The existing config shares a local project ID and ports with other worktrees.
8A tests use an ignored isolated copy at `supabase/.temp/issue08a`, project
`aure-relics-08a-security`, API `http://127.0.0.1:57321`. `AURE_TEST_STACK=08a`
selects it in API runners; the default remains the original local foundation.
Only these two fixed project/URL pairs are allowed; arbitrary URLs are rejected.
See `docs/testing/issue-08a-verification.md` for reproducible setup and results.

## Sources checked 2026-09-23

- [Issue #8](https://github.com/PapiPatJr/Aure-Relics-Grid/issues/8)
- Repository v0.9 design, all four current migrations, enrollment/character APIs,
  existing database/API tests, and Issue #6/#7 verification records.
- [Database change options](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Broadcast authorization and caching](https://supabase.com/docs/guides/realtime/authorization)
- [Postgres Changes, per-event checks and DELETE limitations](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Subscription readiness option, upstream client source](https://github.com/supabase/supabase-js/blob/master/packages/core/realtime-js/src/RealtimeChannel.ts)
- [Realtime schema lockdown](https://supabase.com/changelog/realtime-schema-locked-down-against-modification)
- [Explicit API exposure grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

The markdown changelog endpoint could not be fetched in this environment; the
HTML changelog and relevant linked changes were reviewed instead. Custom objects
belong in public/private schemas, not the managed realtime schema.
