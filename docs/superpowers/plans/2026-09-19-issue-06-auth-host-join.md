# Issue #6: DM authentication and hosted session entry

Scope is issue #6 and the user's approved detailed requirements. Preserve the local board, private/public boundary, unpublished Realtime, and all issue #5 tests. No character UI or board synchronization.

## Design

An online entry shell uses the existing local branding and fonts. A configured deployment starts at DM sign-in or guest join. An unconfigured deployment keeps the local board usable. Only a signed-in permanent DM who owns the selected campaign may open the local board from the online shell. Guests stay in a lobby; they never initialize the legacy board. The board is explicitly local, not the selected campaign's synchronized state.

Join credentials consist of campaign UUID, session UUID, and a server-generated 256-bit secret. Share links carry this credential in the fragment; it is removed after capture and never persisted by the UI. Only its SHA-256 hash is stored server-side. Rotation/revocation prevents new redemption; removing an existing player separately revokes their session access. Session requests and approval use narrow identity-bound RPCs, with safe status/roster projections and no direct guest writes. Polling refreshes approval without publishing Realtime tables.

## Task 1: Secure enrollment database and integration contract

Add a generated migration and security tests before implementing the migration. Own only new migration, new database tests, and a new `scripts/test-entry-api.mjs` integration runner. Do not modify UI or existing migration files. Read `supabase/README.md`, existing migrations and existing tests.

Public invoker RPC wrappers over private identity-bound SECURITY DEFINER helpers, empty search_path, explicit authenticated-only execution:

- `issue_session_code(p_session uuid) returns text`: owning permanent DM; secure 64 hex chars; store hash in existing private.session_codes; 24-hour expiry; rotates existing code. Session must be open.
- `revoke_session_code(p_session uuid) returns void`: owner only; revoke future redemption.
- `request_session_join(p_campaign uuid,p_session uuid,p_code text,p_display_name text) returns void`: anonymous Auth identity required, valid code scoped to exact campaign/session, open session, nonempty trimmed display name <=80 chars. Create pending membership/session row atomically. Never self-approve, preserve existing approved status, refuse previously revoked membership/session. Serialize code/member access to avoid concurrent approval/revocation bypass. Add display_name to session_players if needed; default supports old fixtures.
- `review_session_guest(p_session uuid,p_user uuid,p_action text) returns void`: owner only; actions approve/reject/revoke. Approve pending request, approving membership and session atomically; rejection/revocation sets session revoked, without removing unrelated approved session access. Revoked membership cannot be silently reapproved. Record private activity events without secrets.
- `get_guest_lobby(p_session uuid) returns jsonb`: caller's own request only. Safe fields `status` (pending/approved/revoked/closed), `campaign_name`, `session_name`, `display_name`; no row => null. Effective campaign revocation/closed session overrides approved.
- `get_session_roster(p_session uuid) returns table(user_id uuid,display_name text,status text)`: DM sees requests/all statuses; approved in-session guest sees approved players only. Pending/rejected/foreign users get no rows.

Existing DM RLS supports campaign/session insert; do not grant guest writes or loosen private boundaries. Test invalid, expired, revoked, rotated and cross-campaign/session codes; anon identity vs bare anon; self approval/campaign ownership denial; DM isolation; pending/rejected/revoked access; safe roster; approved membership in other session unaffected; no secret plaintext storage; denial tests prove unchanged state. Add real Auth signup/login/logout plus independent DM A/B and anonymous guest API tests. Test runner only local project/port 56321 and clean its own fixtures. Run clean local reset, DB tests and new runner (coordinate reset with parent). Do not commit parent's work; report exact test evidence.

## Task 2: Entry services and branded screens

Implement small testable auth/campaign/session services using normal user client only. Cover credentials, code parsing, hash route capture, permanent/anonymous role guards, owner filtering and RPC argument mapping with unit tests. Build login/register, dashboard/campaign selection, hosted session share panel, pending approvals, roster, guest join/waiting/lobby screens. Keep error/loading/focus states accessible, escape user content, clean up polling, reject stale asynchronous responses after auth changes. No guest board entry. No changes to legacy gameplay implementation.

## Task 3: Verify and deliver

Review backend and full diff independently; run clean migration reset, all DB/API/JS checks, npm check/build/audit, SQL lint/security advisors and production asset inspection. Check browser availability; if unavailable provide exact two-context manual smoke. Document hosted Auth/email/anonymous setup and remaining risks. Scan tracked files for secrets. Commit/push issue branch and open PR closing #6; do not merge.
