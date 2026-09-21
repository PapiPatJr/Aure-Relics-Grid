# Issue #7 verification — campaign characters

Branch: `v0.9-issue-07-campaign-characters`, based on `main` at `2bd9332`.

## Implemented scope

- Approved participants create a campaign-saved character and edit bounded shared fields.
  The owner separately approves the character. Reload preserves fields and portrait.
- Owner character panel displays assignments, approves/withdraws approval, intentionally
  issues/copies/rotates/revokes reclaim codes, and recovers a character by reassignment.
- Returning approved anonymous identities reclaim through `campaign.character.secret`.
  Codes contain 256 random bits, expire after 30 days and are stored only as hashes.
- Private canonical portraits, optional creation upload, preview, owner replacement and
  upload/link retry. No external assets or service credentials in browser code.
- Registered participants use the same scoped character APIs. Owning campaign B does
  not grant management authority over campaign A. The player lobby accepts either Auth
  identity. Existing enrollment remains guest-oriented; full registered join/navigation
  and Authorized-DM/current-session authority work are outside this issue.

## Security contracts exercised

New SQL and real API tests cover pending/revoked/closed access, campaign/character scope,
own pending visibility, public/private projection, guest table-write denial, field bounds,
self-approval and assignment denial, owner isolation, private code enumeration denial,
hash-only storage, invalid/expired/rotated/revoked codes, conflicting assignments, recovery,
portrait read/upload/replacement/deletion boundaries and membership loss. Registered
account ownership and participation are tested using separate real Auth clients.

Concurrency checks exercise duplicate creation, code issue versus approval withdrawal,
reclaim versus code revocation and reclaim versus owner reassignment. Campaign advisory
locks serialize these RPCs; session/member/character locks preserve permission checks.
Existing Issue #5/#6 assertions are retained without weakening them.

Independent UI review found slow downloads invalidated by unchanged polling and editable
fields losing new input during saves. Both received failing regression tests and fixes.
Independent security review found guest portrait reinsertion after owner deletion; a
regression now requires denial once the saved image pointer exists.

## Browser gate

The four real Playwright scenarios run at 1440×1000 and 390×844 in 24 isolated contexts.
Character coverage includes submission, owner approval, image preview/upload/render,
reload persistence, intentional code copy without browser-storage persistence, new-identity
reclaim, old/revoked/wrong-campaign codes, displaced-controller edit and storage denials,
foreign-owner denial, manual recovery and owner portrait replacement. Existing enrollment,
rejection/removal, direct-route isolation and legacy board regressions remain included.

Browser HTTP traffic is restricted to the local app/API. Expected denials have explicit
one-use path/status expectations; unexpected HTTP, console and network failures fail the
suite. Success screenshots mask issued credentials; screenshots/traces are ignored local
artifacts. Desktop/narrow screenshots were inspected for branding and overflow. Narrow
Chromium coverage does not claim native mobile-browser verification.

## Verification results

Final local verification on 2026-09-20:

| Command | Result |
| --- | --- |
| `npm.cmd exec -- supabase db reset --local --yes` | PASS; all four migrations applied from scratch |
| `npm.cmd run test:db` | PASS; 159 assertions (131 existing + 28 character) |
| `npm.cmd run test:api` | PASS; 156 checks (22 foundation + 42 enrollment + 92 character) |
| `npm.cmd run test:characters-api` | PASS; 92 checks during focused storage-fix verification |
| `npm.cmd run test:e2e` | PASS; 8 tests / 24 isolated contexts, 1.9 minutes, after final reset/fix |
| `npm.cmd run check` | PASS; scaffold checks + 29 JS/DOM tests |
| `npm.cmd run build` | PASS; Vite 6.4.3, bundled assets and local fonts/images |
| `npm.cmd audit` | PASS; zero vulnerabilities |
| `npm.cmd exec -- supabase db lint --local --schema public,private --fail-on warning` | PASS; no schema errors |
| `npm.cmd exec -- supabase db advisors --local --type security --level warn --fail-on error` | PASS; no findings |

Before reset, the dedicated Aure database had zero campaigns and zero Auth users.
No other local Supabase project was reset. Ports remain 56320–56329. Browser runs
reported no unexpected console/network/HTTP failures, no remote assets and no cleanup
errors. The only runner warning was Node's harmless NO_COLOR/FORCE_COLOR conflict.
Early browser runs exposed ambiguous test selectors against legacy/hidden controls;
selectors were scoped, with no legacy functionality changed. All final tests pass.

Final diff and credential-pattern review found no committed secrets or generated build,
browser report or environment files. Legacy `script.js`, `style.css`, `index.html`, pinned
dependencies and Supabase port configuration are unchanged. Independent reviewers
rechecked the lifecycle and storage fixes with no outstanding findings.

## Final PR review

The final review found a cross-session recovery defect: assigning a replacement
character in a later session left the target player's earlier character assignment
in a closed session. A fresh reclaim code then failed the campaign-wide conflict
check. Recovery now clears both the selected character's previous controllers and
the target player's earlier campaign assignments atomically, preserving all character
records. The new regression first failed with two assignments and SQLSTATE 42501,
then passed after the fix. Database coverage is now 162 assertions (131 existing,
31 character). All 156 real API/Auth/Storage checks passed again after a clean reset.

The original browser rerun passed 7/8 tests; the narrow enrollment scenario hit
Chromium ERR_NO_BUFFER_SPACE while loading the local logo. No assertion or browser
error allowance was relaxed. The final full browser rerun passed all 8 tests / 24 isolated contexts in 2.0 minutes.
SQL lint and security advisors found no issues, and dependency audit reported zero
vulnerabilities. Full-diff review found no Issue #8 implementation or changes to the
legacy board. Registered participation remains independent of campaign management.

## Deployment and limitations

- No hosted project changed. Apply the migration and existing Auth/API/environment setup
  described in `supabase/README.md`. No manual SQL or bucket creation is required.
- Anonymous play still requires session approval. Character approval is a separate action.
  One campaign assignment blocks another creation; use reclaim or owner recovery in a later
  session. A valid bearer code can transfer an in-use character after session approval.
- Owners manage characters using the existing campaign-owner helper. Full Authorized-DM
  handoff, current-session DM seats and view-mode changes were not implemented.
- Character management polls approximately every five seconds. No realtime publications,
  board sync, player board, fog, movement, terrain or Issue #8 work was added.
- Legacy board and its local scene storage are unchanged; no online character/board binding
  is introduced here. Hosted email, abuse controls and native-device smoke tests remain
  deployment work, as documented for Issue #6.
- Portrait MIME/size restrictions do not constitute malware scanning or image re-encoding.
  Guests upload once; owner replacement is intentional. Downloaded data cannot be recalled
  from a client that previously had access.
