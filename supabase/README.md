# Aure Relics v0.9 Supabase foundation (issue #5)

This package defines the database and authorization contract. It does not connect
the legacy board to Supabase or add login/join/campaign/fog/movement UI.

## Local setup and verification

Use Node.js 22+ (tested on 24.19.0), Docker, and the pinned CLI from `npm install`.

```powershell
npm.cmd install
npm.cmd exec -- supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime
npm.cmd run db:reset
npm.cmd run test:db
npm.cmd run test:api
npm.cmd exec -- supabase db lint --local --schema public,private --fail-on warning
npm.cmd exec -- supabase db advisors --local --type security --level warn --fail-on error
npm.cmd run check
npm.cmd run build
npm.cmd audit
```

`db:reset` erases only this local test project's database. Verify project ID
`aure-relics-v09-foundation` before running it. Neither test command targets a
hosted project. SQL fixtures roll back; API tests create and delete their own users,
campaigns, and image. The API runner reads local CLI credentials in memory and
refuses any API URL other than `http://127.0.0.1:56321`. Administrative credentials
are used only by that local test runner to create/delete users and clean up files.

### Local ports

| Service | Port |
| --- | --- |
| Shadow database | 56320 |
| API/Auth/Storage | 56321 |
| Database | 56322 |
| Studio (optional) | 56323 |
| Test mail | 56324 |
| Analytics (optional) | 56327 |
| Pooler (disabled) | 56329 |

`54322` is occupied by `supabase_db_foundation-household-access`; that project was
left untouched. Windows reserves `55295–55394`, so the first proposed 5532x range
was rejected. The configured 5632x ports were checked and the stack started there.

## Frontend environment

Copy `.env.example` to ignored `.env.local`. Supply `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`; `VITE_SUPABASE_ANON_KEY` is a compatibility fallback.
Leave them blank for offline mode. `getSupabaseClient()` returns null without
configuration, throws for partial/invalid configuration, and creates one lazy
client when requested. The legacy entrypoint does not import it.

Every `VITE_*` value can be compiled into the browser. Never put a service-role
JWT, `sb_secret_` key, database password or CLI access token there. Key validation
is an early configuration check, not authentication or a replacement for RLS.
Supabase validates actual JWT signatures; database policies authorize each request.

## Schema and relationships

`campaigns.owner_id` references a permanent Auth identity. Anonymous Auth users
cannot create/own campaigns. Ownership is checked against `auth.users`, not
user-editable metadata. DMs do not automatically see campaigns owned by another DM.

| Schema | Tables | Purpose |
| --- | --- | --- |
| public | profiles | Self-only display names |
| public | campaigns, campaign_members | Ownership and pending/approved/revoked membership |
| public | sessions, session_players, session_state | Session approval, assigned characters, active level, round/revision |
| public | characters | Player-character shared HP/AC/speed/status fields; never enemy/NPC/boss HP |
| public | locations, levels | Campaign map hierarchy, grid/theme and inherited fog defaults |
| public | tokens | Position/type/visibility and public condition label, no exact HP |
| public | terrain_objects, fog_cells, map_effects | Typed public fields, default-hidden content and per-cell revelation |
| public | initiative_entries | Session/token-linked public order, filtered by token visibility |
| private | token_details, character_details, terrain_details, map_effect_details | Exact HP, private sheets/notes/metadata and effect mechanics |
| private | fog_areas, dm_notes, session_snapshots | Named fog geometry, DM notes and versioned full snapshots |
| private | movement_paths, activity_feed | Future path records and DM-only events (no movement feature) |
| private | campaign_codes, session_codes, character_codes | Expiring/revocable SHA-256 code hashes |

There are **26 application tables**. Hazards, traps and difficult terrain are
distinct `map_effects.kind` values, matching issue #5's table name, with sensitive
trigger/detection/damage/state details in `private.map_effect_details`. Likewise,
`activity_feed` is issue #5's name for the spec's activity/event log.

Foreign keys include `campaign_id` alongside child IDs so a DM cannot attach a
level, token, character, session player or effect to another campaign's parent.
Session player membership also references `(campaign_id,user_id)`. Character
assignment is unique per session. Membership status changes immediately affect
subsequent reads without waiting for JWT refresh.

## RLS and visibility contract

- All 26 tables enable RLS. Only authenticated has explicit CRUD grants, subject
  to policies; bare `anon` has no application table or RPC access.
- Anonymous Auth gives guests an authenticated JWT identity, not permissions.
  Campaign approval **and** session approval **and** a nonclosed session are needed.
  Direct self-enrollment, self-approval, owner changes and official-state writes fail.
- DMs can CRUD their own campaign records. Players currently have read-only official
  state access; card/movement write services belong to later issues.
- Players see only their approved joined sessions, active levels, shared approved
  assigned player characters and revealed objects. They cannot enumerate unrelated
  memberships or sessions, even within their campaign.
- Fog inherits level → location → campaign. Under fog, an object's entire bounding
  rectangle must be revealed. Hidden flags also apply when fog is disabled. Rotated
  terrain is conservatively withheld from players until later geometry work defines
  a tested rotated footprint. Named areas and private geometry are never shared.
- Private data remains protected by DM-only RLS even if queried through a SQL role.
  Only `public` is exposed to REST. `get_token_details` / `save_token_details` are
  typed invoker RPCs; private table RLS prevents a player or other DM using them.
- Definer helpers live in `private`, have an empty search path and identity checks,
  and avoid recursive membership policies. Public RPC wrappers are invoker functions.

## Character codes and approved reclaim

The future guest join service must first create/approve membership and session
access under DM authority. No permissive join endpoint is included here.
`campaign_codes` and `session_codes` are hash/expiry/revocation foundations for that
service, not an implemented self-join flow.

```js
// DM: approved player character; returned secret is displayed only to its recipient.
await client.rpc('issue_character_code', { p_character: characterId });
// Approved guest: cannot enroll or approve themselves by calling this.
await client.rpc('reclaim_character', {
  p_session: sessionId, p_character: characterId, p_code: savedCode
});
await client.rpc('revoke_character_code', { p_character: characterId }); // DM only effect
```

Codes contain 32 cryptographically random bytes, encoded as 64 hex characters.
Only SHA-256 hashes are stored, with a 30-day lifetime. The plaintext is returned
once and cannot be recovered from the database; DM recovery regenerates a code.
This intentionally avoids storing a recoverable credential for the future copy UI.
Saved codes are reusable until expiry, revocation or regeneration. Reclaim checks
the character's campaign and approval, locks the code, clears prior controller
assignments across sessions and assigns the caller in the requested approved session.
An event is recorded without the secret. Revoking a code prevents future reclaim;
revoke membership/session access separately to remove current data access.

Treat codes as bearer secrets: do not log them or shorten them. Future human-friendly
join codes need separate attempt limits and approval UX; this migration deliberately
does not expose a short-code guessing endpoint.

## Storage

All buckets are private and accept PNG/JPEG/WebP, excluding SVG/HTML.

| Bucket | Limit | Path and policies |
| --- | --- | --- |
| character-images | 5 MiB | `campaign/session/character/portrait.png`; approved assigned guest can insert once; approved party can read; DM can replace/delete |
| terrain-assets | 10 MiB | `campaign/filename.png` (also jpg/jpeg/webp); owner DM CRUD |
| map-assets | 20 MiB | Same campaign scope; owner DM CRUD |

Character portrait paths have a fixed name independent of MIME to enforce one slot.
Cross-campaign path moves are rejected by UPDATE's USING and WITH CHECK. Guests
cannot replace/delete portraits or upload map/terrain assets. Session closure or
membership revocation removes subsequent authenticated downloads. Reusing a portrait
from a closed session in a new session requires a future authorized copy/publish step.
Map/terrain player distribution is intentionally withheld until that step exists.

Do not use public URLs. Signed URLs and previously downloaded data can outlive a
permission change; prefer authenticated downloads and short-lived signed URLs only
when the later client handles their lifetime explicitly.

## Realtime boundary

No application table is added to `supabase_realtime`, and no app subscription is
created in issue #5. RLS protects REST and future authorized SELECT-based changes;
it is not a sanitizer for arbitrary Broadcast payloads. Keep private tables out of
player publications. Postgres DELETE events and client caches require special care:
future subscriptions must explicitly invalidate stale objects on hide/revoke/level
changes and never broadcast private rows, secrets, exact HP or unsanitized snapshots.

## Hosted setup Patrick must perform

1. Create/select a dedicated development project (Postgres 17, matching local config).
2. Authenticate/link the CLI to that project. Review `supabase db push --help` and
   inspect the migration diff before applying the committed migrations. No hosted
   database was modified by this work; all tables/buckets/policies come from migrations.
3. In Data API settings expose `public` only, never `private`; prefer disabling
   automatic grants for new tables. The migrations explicitly grant their own access.
4. Configure Auth's production site/redirect URLs, email delivery/verification, and
   enable anonymous sign-ins for future guests with CAPTCHA and rate limits.
   Local `config.toml` does not automatically configure hosted Auth/API settings.
5. Put only the project URL and publishable key in deployment environment variables.
   Keep Realtime publication disabled until its assigned issue and security tests.
6. Repeat advisor checks and DM/guest API/Storage checks on the development project
   before production use. Do not point the local-only test runner at a hosted project.

No manual dashboard SQL or bucket creation is required.

## Issue #6 enrollment and entry UI

The enrollment migration adds session display names and six narrowly scoped RPCs:
`issue_session_code`, `revoke_session_code`, `request_session_join`,
`review_session_guest`, `get_guest_lobby`, and `get_session_roster`. Existing RLS,
private data separation, storage policies, and unpublished Realtime are unchanged.
Invitations expire in 24 hours; only hashes are stored. Rejected/revoked identities
cannot restore access by redeeming a code. Removing a player revokes that session,
not other approved sessions in the same campaign.

`npm.cmd run test:api` now runs both foundation and enrollment tests with independent
real Auth clients. See [issue #6 verification](../docs/testing/issue-06-verification.md)
for the full RPC contract, hosted setup limits, and test results. The local browser
gate now passes with Playwright's isolated DM/guest contexts; see `tests/e2e/README.md`.
The UI uses anonymous Auth but does not yet supply CAPTCHA tokens;
do not enable mandatory CAPTCHA before integrating its client flow. Configure abuse
controls before a public rollout. No hosted Auth settings were changed automatically.

## Issue #7 campaign characters and portraits

The character migration extends `public.characters` with `public_notes`, `image_path`,
`created_at` and `updated_at`. It adds six authenticated RPCs: `create_session_character`,
`update_session_character`, `review_character`, `assign_character`, `get_character_panel`
and `set_character_image`. Existing issue/revoke/reclaim code RPC signatures remain.
Only campaign owners manage approval, codes and recovery under the current permission
helper. New participant operations work for either anonymous or registered approved
session members; owning a different campaign grants no authority here. Account identity
is not a permanent DM/player role. Authorized-DM/session-seat handoff remains deferred.

Guest creation assigns a pending character; owner approval is separate from session
approval. Updates expose only bounded shared fields. The panel includes no private notes,
code hashes or plaintext secrets. Code issuance returns 32 random bytes as 64 hex digits;
the database stores SHA-256 only, with 30-day expiry. The UI wraps the secret as
`campaign.character.secret`, shows it intentionally in memory, and clears it on navigation.
Reclaim requires effective campaign/session approval and exact campaign/character scope.
A valid bearer code transfers control, so share it privately. Rotation invalidates earlier
codes; revocation, withdrawn character approval and owner recovery invalidate the code.
An existing different character assignment blocks reclaim; owner recovery is the override.

The existing private `character-images` bucket also accepts the stable canonical path
`campaignUUID/characterUUID/portrait.png`. PNG, JPEG or WebP, at most 5 MiB; the fixed
filename does not override the file's MIME type. Participants upload once for their own
assigned character, including pending submissions. Once linked, only the owner can replace
the image, even if its object has been deleted. Owner restoration uses upload; normal UI
replacement uses update. Legacy four-part paths retain their earlier policies.
Owners, current assigned participants and existing approved party projections may read;
revoked/closed access cannot. UI downloads are authenticated with caching disabled, use
revocable object URLs, and never publish signed/public URLs. Access polling clears the
panel on denial; previously downloaded data cannot be remotely erased from a recipient.

Upload and pointer linking are separate API calls. If upload succeeds but linking fails,
use **Retry linking uploaded portrait**. If creation succeeds but its optional upload
fails, the character remains saved and the portrait can be retried from its card.
No new hosted dashboard SQL, bucket creation or environment variables are required.
Apply committed migrations through the existing hosted setup process; public deployment
Auth/abuse controls and settings still need Patrick's setup. Realtime remains unpublished.

`npm.cmd run test:api` includes the character suite; `npm.cmd run test:characters-api`
runs it alone. See [Issue #7 verification](../docs/testing/issue-07-verification.md).
