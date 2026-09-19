# Issue #5 verification handoff — 2026-09-19

Supersedes the incomplete 2026-09-17 checkpoint. Resumed from `f9d47d7` on
`v0.9-issue-05-supabase-foundation`, with merged main `11069ef` as the base.
The checkpoint was pushed before continuing. Issue #5 is ready for PR review;
no issue #6 UI or gameplay feature work was started.

## Completed

- Preserved the checkpoint's lazy client and environment validation.
- Added two reproducible migrations with 26 application tables, composite campaign
  foreign keys, default-hidden map records, private exact HP/notes/code hashes,
  RLS on every table, typed HP RPCs and approved-session character reclaim.
- Added three private storage buckets with campaign/session/character-scoped policies.
- Added 81 pgTAP security assertions and 22 real Auth/REST/RPC/Storage API checks.
- Documented policies, schema, code lifecycle, future Realtime constraints and hosted
  setup in [supabase/README.md](../../supabase/README.md).
- Current board HTML/JS/CSS/assets and client implementation remain unchanged;
  production bundle/asset hashes match the checkpoint build.

## Verification performed

- Local Supabase start succeeded on the Aure Relics 5632x port range.
- `npm.cmd run db:reset` recreated the database and applied both migrations;
  final tests ran after that clean reset.
- `npm.cmd run test:db`: **81 passed**, including denial cases and no private
  data/hidden objects in guest results. Fixtures roll back.
- `npm.cmd run test:api`: **22 passed**, using independent real DM/anonymous guest
  JWT sessions and Storage uploads/downloads. Temporary fixtures were cleaned up.
- `supabase db lint --local --schema public,private --fail-on warning`: no errors.
- `supabase db advisors --local --type security --level warn --fail-on error`: no issues.
- `npm.cmd install`, `npm.cmd run check` (four JS tests + scaffold), and
  `npm.cmd run build`: passed. `npm.cmd audit`: zero vulnerabilities.
- Independent static security review found no remaining blockers.

## Resolved failures

- Port 54322 belonged to `supabase_db_foundation-household-access`. Left untouched.
- Windows reserves 55295–55394; configured free 56320–56329 instead.
- Fixed SQL reserved parameter naming and test CTE syntax.
- A denial test caught fog coordinate parameter shadowing; explicit `p_*` names
  fixed it and REST tests independently verify fogged NPCs are absent.
- Adjusted storage SQL tests to the Storage API's delete context; API tests verify
  actual policy behavior independently.
- Review aligned code reuse with the spec; codes remain reusable until expiry,
  rotation or revocation.

## Remaining boundaries / manual setup

- Existing esbuild install-script approval warning remains; install/build succeed.
- No hosted project was changed. Patrick must configure hosted Auth/API settings,
  apply migrations and set public client environment values as documented.
- UI/browser flows are untested because login/join UI is deliberately deferred;
  actual API sessions cover backend authorization now.
- Private map/terrain assets and rotated terrain remain withheld from guests until
  later tested publication/geometry services. Realtime tables remain unpublished.
- Revocation cannot erase already downloaded data or immediately invalidate an
  existing signed URL; future UI must refresh/invalidate cached visibility state.
- Hash-only code storage permits regeneration, not retrieval of old plaintext.

## Next action

Review this issue #5 branch as a PR. Do not start issue #6 without a separate request.
