# Issue #6: online entry verification and handoff

## Scope delivered

- DM email/password registration, confirmation notice, login and local-browser logout.
- Owner-filtered campaign dashboard, campaign creation/selection, session creation/selection.
- Session invitations, rotation/revocation, copyable code/link, pending requests, approve/reject/remove and roster.
- Anonymous Auth guest enrollment, pending status, approved lobby, closed/rejected/revoked status.
- Five-second polling; no Realtime publication or board synchronization.
- Branded entry screens use the existing banner, black/gold palette and local Cinzel/Spectral fonts. No Google Fonts/CDN dependencies.
- Authenticated campaign owners may open the existing **device-local** v0.5.2 board. Guests remain in the lobby. Scenes are not uploaded to the hosted session.

The source `index.html` still supports the original direct/offline launch. Vite's pre-transform initially hides the board; configured deployments require an authenticated owner before importing the board module. A Vite deployment without Supabase configuration still opens the local board at its root URL. Online deep links fail closed when configuration is absent.

## Security contract

Migration `20260919223340_session_enrollment.sql` adds `session_players.display_name` and six public invoker RPCs backed by private helpers:

| RPC | Authority and effect |
| --- | --- |
| `issue_session_code` | Owning permanent DM, open session; returns a 256-bit random secret once, stores SHA-256 only; expires in 24 hours; replaces old code |
| `revoke_session_code` | Owning DM; prevents further code redemption |
| `request_session_join` | Real anonymous Auth identity; exact campaign/session/code match; creates pending membership/request; never approves or restores revoked access |
| `review_session_guest` | Owning DM only; approves pending requests or rejects/revokes one session; other approved sessions remain intact |
| `get_guest_lobby` | Caller's own request only; safe display names and effective pending/approved/revoked/closed state |
| `get_session_roster` | DM sees requests; approved guests see only approved player IDs/names/status; others see no roster |

Private helpers have empty `search_path`, explicit identity checks and authenticated-only execution. Existing table RLS and storage policies are unchanged. Row locks serialize enrollment with approval, closure, code rotation and revocation. Activity events omit invitation secrets. An anonymous Auth user uses PostgreSQL's `authenticated` role; the bare public API key has no enrollment authority by itself ([Supabase anonymous Auth](https://supabase.com/docs/guides/auth/auth-anonymous)).

The copyable credential contains campaign UUID, session UUID and the full secret. Links use `#join/<credential>`; the shell captures and removes the fragment, never saving the credential to browser storage. Only the DM's current share panel retains a newly issued secret in memory. Reloading the host panel requires issuing a replacement invitation. Do not shorten codes or send them publicly. Code revocation affects future enrollment; use **Remove** to revoke an already approved player.

## Automated verification

- Fresh local reset applied all three migrations from scratch.
- **131 database assertions**: 81 foundation + 50 enrollment assertions, including expired/revoked/rotated/invalid/cross-campaign/cross-session codes, anonymous identity verification, unchanged state after denial, self-approval denial, private data denial, roster visibility, closure and membership revocation.
- **64 real API checks**: 22 foundation Auth/RPC/Storage + 42 enrollment Auth/API. Separate real DM A, DM B and guest clients; real signup/password login/logout; concurrent approve/revoke/redemption; fixtures cleaned after each run.
- **19 JavaScript/DOM tests**: four existing configuration/client tests, eight service tests, six entry-screen tests, one static/Vite bootstrap regression test. DOM tests use jsdom, not a browser.
- **6 real Chromium E2E tests**: three scenarios at 1440×1000 and 390×844. Playwright 1.63.0 / Chromium 153.0.8010.12. Fourteen isolated contexts per full run. All passed; fixtures cleaned successfully.
- SQL lint for `public,private`: no errors. Local security advisors: no issues.
- `npm.cmd run check`, production build and npm audit: pass; audit zero vulnerabilities.
- Production preview HTTP smoke: bundled entry and legacy script chunk serve successfully; all eight referenced CSS/logo/font assets returned HTTP 200. `dist/index.html` references bundled assets, not `/src/main.js`.
- Independent review completed; the raw/offline launch regression found during review was fixed and covered by the bootstrap test. Source secret scan found no actual service-role/secret credentials.
- No new publication, bucket, service-role browser dependency or changes to legacy `script.js` / `style.css`.

Commands (from repository root, current supported Node 22.22.2+, 24.15+ or 26+):

```powershell
npm.cmd install
npm.cmd exec -- supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime
npm.cmd run db:reset
npm.cmd run test:db
npm.cmd run test:api
npm.cmd run check
npm.cmd run build
npm.cmd audit
```

The API runners refuse any project/URL other than `aure-relics-v09-foundation` at `http://127.0.0.1:56321`. Local admin credentials are read in memory only for creating/cleaning test identities, never embedded in browser code. Aure ports remain 56320–56329; no other project's stack is touched.

## Browser acceptance — passed with Playwright

The desktop built-in browser integration remained unavailable. At Patrick's request,
standalone Playwright Chromium completed the acceptance gate instead. The following
items passed in both desktop and narrow viewports:

| Acceptance area | Result |
| --- | --- |
| DM register/login/logout, campaign creation/selection, session hosting | PASS |
| Code/link rendering and real clipboard copying | PASS |
| Anonymous identity, fragment removal, pending request, DM approval, lobby/roster | PASS |
| Second guest rejection; approved guest removal; roster access withdrawn | PASS |
| Guest direct `#dm`, `#campaign`, `#session`, `#board` route denial | PASS |
| DM B denied DM A campaign/session/roster and review RPC | PASS |
| Old rotated code, revoked code, valid alternate campaign/session scope denied | PASS |
| Guest never initializes legacy board, including after approval/reload | PASS |
| Board grid, terrain placement, combat initiative/turn, scene save/load, return | PASS |
| Local branding/images/fonts, keyboard focus, loading/error states, entry width | PASS |
| Unexpected browser console errors, uncaught errors, failed/network requests | None |

Screenshots were inspected for desktop and narrow layouts. Two reproduced layout
defects were fixed in `src/entry/entry.css`: the return button overlapped header
branding, and the fixed notes dock covered the final narrow-layout tracker controls.
The latter was also reproduced against merged main's offline board. The fix reserves
space in the Vite board wrapper only; legacy gameplay and `style.css` are unchanged.
Regression tests failed before the fixes and passed afterward. Full E2E, DB/API/JS,
build and audit verification then passed. No schema/auth/RLS change was needed.

Expected HTTP failures were explicitly asserted: invalid login 400, unauthorized
DM record lookup 406, and invalid/revoked/cross-scope invitation or review 403.
No remote font/CDN request occurred. Fixture cleanup reported no errors.

See [Playwright setup and hygiene](../../tests/e2e/README.md) for commands, test
isolation, local-only guards and failure artifacts. Run `npm.cmd run test:e2e` to
repeat the acceptance gate. Native mobile browsers, hosted email confirmation and
production deployment settings are not covered by the local Chromium run.

### Optional manual deployment smoke

1. Set ignored `.env.local` using `.env.example`, with local API URL and only the local publishable/anon key. Run `npm.cmd run dev` (or build and preview). Use a normal browser profile for DM A and an incognito/separate profile for a guest.
2. Register a DM. With email confirmation enabled, confirm the email and return to sign in. Log out and back in. Verify branded layout, keyboard focus, mobile width, error states and no remote font/CDN calls.
3. Create/select a campaign; create/open a session. Generate and copy both invitation code and link. Verify both can be pasted in the guest join screen. Opening the link should remove its secret fragment from the address bar.
4. Enter a guest display name and submit. Confirm waiting state; DM sees pending request within five seconds. Approve; guest reaches lobby and appears in approved roster.
5. Use a second anonymous profile to test rejection. Use **Remove** on the first guest. Neither should see roster or a board link after the next refresh. Direct `#dm` / `#board/<session>` routes must return guests to join.
6. Rotate an invitation and try the old code; revoke and try the new code. Both should fail. Use DM B in another profile to verify campaign/session deep links cannot manage DM A's data.
7. As owner DM, open the local battle board. Verify grid, terrain placement, combat tracker, scene save/load, local images/fonts and branding. Return to the session panel. Opening raw `index.html` should also still load the original offline board.
8. Refresh the approved/pending guest page to confirm anonymous identity survives. Disconnect/reconnect: failed access checks should clear the approved lobby display until access can be verified. Try simultaneous DM/guest browser sessions.

## Hosted setup and limitations

- Patrick must apply the committed migrations to the intended hosted development project and configure its Auth/API settings as described in `supabase/README.md`; no hosted project was modified here.
- Enable email/password signup and anonymous sign-ins. Configure Site URL/redirect allowlist and email delivery/confirmation. Confirmation emails validate the address; this UI then asks users to sign in manually. It does not consume URL access tokens.
- Deployment env needs only `VITE_SUPABASE_URL` and publishable/anon key. Rebuild after setting them. Never deploy service-role/secret keys.
- This flow supports a controlled development deployment. Public signup abuse protection still needs deployment work: Auth rate limits, anonymous-user retention/cleanup and a compatible CAPTCHA/other abuse-control integration. This UI does **not** submit CAPTCHA tokens; turning on mandatory CAPTCHA before implementing that integration will block signups. No third-party CAPTCHA/CDN script was added.
- Guest identity persists in that browser's Supabase Auth storage. Signing out or clearing browser data loses it; character reclaim/recovery remains issue #7. A rejected identity cannot resubmit, but a newly created anonymous identity may request approval again; the DM must review it.
- Legacy scenes and notes remain device-local, origin-wide data, not account-isolated campaign storage. Use separate browser profiles on shared devices; this issue intentionally does not migrate local saves or alter board behavior.
- Approval polling is approximately five seconds, not realtime. Guests never enter the legacy board. Full player battle UI, character creation/reclaim and synchronized play remain later issues.
- npm emits the existing unapproved `esbuild@0.25.12` install-script warning; it is non-blocking and production builds pass. Windows sandbox initially blocked esbuild filesystem access; the build succeeds with normal filesystem access. An initial top-level-await build error was fixed without raising Vite's browser target.

Issue #6's local browser acceptance gate is complete. PR #17 is ready for merge
review, with hosted deployment setup still required. Do not merge automatically.
