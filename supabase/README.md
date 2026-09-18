# Supabase foundation — issue #5 checkpoint

This is an incomplete foundation checkpoint. No application schema, RLS policies,
storage buckets, code redemption, or hosted project changes have been applied.
Issue #5 is **not ready for PR or closure**.

## Completed setup

- Pinned `@supabase/supabase-js` 2.116.0 and Supabase CLI 2.117.0 in the lockfile.
- Use Node.js 22 or newer (tested on 24.19.0; required by the pinned client).
- `src/supabase/client.js` exports lazy `getSupabaseClient()`. Missing configuration
  returns `null`; invalid/partial configuration throws without echoing the key.
- `src/supabase/config.js` accepts publishable keys and legacy anon-role JWTs,
  rejects privileged keys, and requires HTTPS except for loopback development.
  This is configuration validation, not JWT signature verification; Supabase
  performs actual authentication and RLS must authorize every request.
- The legacy board does not import the new client. No sign-in or network behavior
  has been added to the board. Branding, assets, placement and movement are intact.
- CLI configuration exposes only `public`, disables automatic table grants, and
  enables anonymous Auth identities for future guests. No guest enrollment exists.

## Environment

Copy `.env.example` to ignored `.env.local` when a project is ready. Supply
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; legacy
`VITE_SUPABASE_ANON_KEY` is a fallback. Leave all blank for local board mode.

Every `VITE_*` variable can be compiled into frontend code. Never put a service-role
key, secret key, database password, or CLI token in these variables. Runtime key
validation cannot undo a secret accidentally embedded in a bundle.

Hosted setup is not required at this checkpoint. Before future hosted testing,
Patrick must select/create a dedicated development project, configure Auth site
and redirect URLs, enable anonymous sign-ins with CAPTCHA/rate limiting, and keep
private schemas unexposed. Bucket and RLS setup must come from the completed,
tested migrations rather than manual permissive policies.

## Checks and local development

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run build
npm.cmd run db:start
```

Docker must be available to the CLI. Default ports 54320–54324 can conflict with
other projects. Startup currently fails because port 54322 is occupied. Choose
unused ports in `config.toml` before retrying; do not stop another project's stack.

`db:reset` and `test:db` are CLI conveniences for the remaining migration work.
There are no migrations or database tests yet, so neither currently proves RLS.
Only run a reset on this isolated local test project after confirming its identity.

See [the handoff](../docs/migration/issue-05-handoff.md) for exact resume steps.
