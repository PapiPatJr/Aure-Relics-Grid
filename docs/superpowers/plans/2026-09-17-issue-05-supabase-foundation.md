# Issue #5 Supabase Foundation Implementation Plan

> Execute inline with the executing-plans skill. This implements only issue #5.

**Goal:** Reproducible Supabase schema, least-privilege RLS, private storage, and an opt-in client without changing the local board.

**Architecture:** Campaign ownership is the authority. Anonymous Auth users are guests, not DMs. Approved campaign membership and active session membership are both required for player access. All official state writes remain DM-only in this foundation; later issues add narrowly scoped player mutation services. Composite foreign keys prevent cross-campaign references. Enemy exact HP, notes, legacy snapshots, code hashes, and sensitive map details reside in an unexposed private schema with additional DM RLS.

**Tech stack:** Existing Vite/plain JS, pinned supabase-js and Supabase CLI, Node test runner, local Supabase/Postgres and pgTAP.

**Spec:** `docs/superpowers/specs/2026-09-14-aure-relics-v09-design.md`, issue #5, and `docs/testing/v09-test-strategy.md`. Issue #5's names `map_effects` and `activity_feed` take precedence over the earlier draft's separate effect tables and activity_events name.

## Scope and security decisions

- No UI, board integration, realtime subscription, movement logic, fog tools, or terrain redesign.
- Public tables use typed player-safe columns; no unfiltered legacy JSON snapshot reaches players.
- Hidden objects default to invisible. Visible objects also require a joined live session viewing their level and revealed fog covering their footprint.
- Campaign/session/character code records store SHA-256 hashes of high-entropy secrets, expiration, and revocation. Only DMs manage them. The resumed issue includes an approved-session character reclaim RPC with reusable 256-bit codes; guest self-enrollment and short-code rate limiting remain for the later join issue. No permissive placeholder policies.
- Private buckets: character-images, terrain-assets, map-assets. Character objects use campaign/session/character/filename paths. Players can upload only to their assigned approved character; map/terrain writes are DM-only. No public bucket URLs.
- Do not add tables to Realtime publication yet. Document SELECT/RLS, revocation, DELETE-event and already-downloaded-data limits for the later subscription issue.

## Tasks

- [x] Client/environment: test missing/invalid/privileged keys and lazy client creation; implement `src/supabase/config.js`, `client.js`, `.env.example`, `.gitignore`; pin dependencies. Keep src/main.js untouched.
- [x] Generate migration using CLI; add profiles, campaigns, campaign_members, sessions, session_players, characters, character_codes, campaign_codes, session_codes, locations, levels, tokens, terrain_objects, fog_cells, fog_areas, map_effects, initiative_entries, movement_paths, activity_feed, session_state and private detail tables.
- [x] RLS: authenticated-only grants, DM ownership helpers, membership/session/level/fog predicates, self-only profile reads; no guest control of memberships, ownership, official board state or codes. Explicit USING and WITH CHECK for writes.
- [x] Storage: scoped SELECT/INSERT/UPDATE/DELETE policies and MIME/size limits; prevent path moves across campaigns and unauthorized character replacement.
- [x] Database tests: fresh migration, DM A/B isolation, unaffiliated/pending/approved/revoked guests, character assignment, hidden enemy/trap/fog, private HP/notes/codes, cross-campaign foreign keys, storage policy allow/deny cases, and all tables RLS-enabled. Exercise actual Postgres roles, not mocked policy strings.
- [x] Recreate local database, run security tests and advisors/lint; run npm install/check/build/audit. Record exact results and any local platform limitations.
- [x] Document manual hosted-project Auth/API/storage setup and future join/realtime integration contracts; review diff to confirm prototype assets and behavior files unchanged.

## Representative acceptance assertions

```js
assert.equal(readSupabaseConfig({}), null);
assert.throws(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_bad' }));
```

```sql
-- Under authenticated with guest JWT: count = 0 for hidden token/private stats;
-- under DM A: count = 0 for campaign B; spoofed campaign_id writes fail RLS/FK.
-- Removing either membership or closing the session makes player SELECT empty.
-- No table in public/private may have relrowsecurity = false.
```
