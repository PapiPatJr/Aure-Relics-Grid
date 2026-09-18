# Issue #5 handoff — 2026-09-17

## Status

Paused at the user's usage-limit checkpoint. Issue #5 is incomplete and not ready
for PR. No issue #6 work or gameplay feature work started.

Branch: `v0.9-issue-05-supabase-foundation`

Checkout: `C:\Users\patlo\Desktop\Aure Relics\aure-relics-issue-04`

Base: merged main at `11069ef` (includes PR #15). Do not resume in the older
`aure-relics-grid` prototype folder.

## Complete

- Read issue #5 completely, architecture/spec, work packages, and testing docs.
- Created issue #5 branch from latest main.
- Added a lazy opt-in Supabase client and safe environment validation with four tests.
- Pinned Supabase client/CLI dependencies; updated lockfile, env example and ignores.
- Generated local CLI configuration: public-only API, explicit grants required,
  anonymous guest identities enabled, localhost Vite redirect settings.
- Wrote an implementation plan; its database design remains a proposal, not tested SQL.
- Removed the generated empty migration to avoid implying a schema exists.

## Remaining

- All database migrations, composite campaign foreign keys, ownership and membership rules.
- Sessions, characters/rejoin code foundation, locations/levels, board/session state,
  fog/terrain/map effect records, private enemy HP and DM information separation.
- Private character/map/terrain storage buckets and scoped object policies.
- Real RLS/security tests, fresh-reset verification, advisors/lint and hosted setup notes.
- Review the code/rejoin scope decision in the plan against issue #5 before implementation.
  Later join UI/services must not rely on permissive placeholder grants.
- Manual browser Auth/Storage tests once backend foundations are available.

## Tests and known failures

- Final `npm.cmd run check` passed: scaffold checks and all four client/environment tests.
- Final `npm.cmd run build` passed; the legacy app bundle and asset hashes are unchanged.
- Final `npm.cmd audit --json` reported zero vulnerabilities. Dependency installation succeeded.
- Local Supabase startup failed: Docker port `54322` is already allocated.
  No migration or RLS test ran; no hosted project was touched.
- npm reports the existing esbuild install-script approval warning.
- Initial client test run failed because the new modules did not exist; it passed
  after implementation.

## Exact next step Friday

1. In the checkout above, run `git status` and confirm the issue #5 branch.
2. Read this note and `docs/superpowers/plans/2026-09-17-issue-05-supabase-foundation.md`.
3. Run `docker ps --format "table {{.Names}}\t{{.Ports}}"`; choose unused local
   API/database/shadow/Studio/mail ports in `supabase/config.toml` for this project.
   Do not stop or reset another project. Update the documented local URL if changed.
4. Run `npm.cmd exec -- supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime`.
5. Generate the first migration with `npm.cmd exec -- supabase migration new v09_foundation`.
   Add failing role-based database tests, implement the schema/RLS, then prove fresh
   rebuild and guest/DM isolation. Keep the legacy board entrypoint untouched.

Only after these remaining pieces are implemented and verified should issue #5
be considered ready for a PR.
