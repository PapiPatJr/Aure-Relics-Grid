# Issue #8E final security and integration review

Review branch: `v09-08e-final-review` from integrated Issue #8D commit
`7dc84ccebac33d492bdcaee81df68f571a914e5a`. This review did not merge or
start Issue #9.

## Findings resolved in 8E

- Denial now invalidates an in-flight hydration, clears both watermarks and the
  rendered board view, removes the channel, and prevents queued timers or late
  mutation conflicts from restarting automatic recovery. Both transport denial
  and snapshot SQLSTATE `42501` are covered.
- The engine waits for the `SUBSCRIBED` database barrier before first hydration,
  buffers invalidations, and requires a new hydration after reconnect before
  reporting consumer `synced`. An outage-era read cannot report `synced` early.
- Conflict results reach the board controls without replaying commands. Session
  lifetime guards also prevent an obsolete unsubscribe or page exit from creating
  or closing the wrong subscription.
- The adapter rejects numeric revisions that may already be rounded and does not
  interpret free-text server errors as authorization denial.
- The 8D revocation test waits for the committed removal in the DM's collapsed
  “Removed requests” roster, then expects the player's denied snapshot request.

The fixes were covered by regression tests that failed before implementation.
The 8D test correction changed only the acceptance harness; its failed visible
row locator was unable to find a revoked user after the UI moved that row into
the collapsed section. The normal player lobby remains the expected Issue #9
product state.

## Fresh verification

All backend checks used the disposable local `aure-relics-08a-security` stack;
the shared foundation and unrelated local stacks were not reset.

| Check | Result |
| --- | --- |
| Clean migration replay | PASS |
| Database pgtap | PASS, 204 assertions |
| Foundation, enrollment, character APIs | PASS, 156 checks |
| Realtime Auth/API/WebSocket security | PASS, 41 checks |
| Deterministic concurrent enrollment/legacy write | PASS |
| SQL lint, public and private schemas | PASS, no errors |
| Security advisors | PASS, no findings |
| `npm.cmd run check` | PASS, 130 tests |
| `npm.cmd run build` | PASS |
| `npm.cmd audit` | PASS, zero vulnerabilities |
| Full Playwright desktop Chromium | PASS, 7/7 |
| Full Playwright narrow Chromium | PASS, 7/7 |
| Strict Issue #8D realtime cases | PASS, 3/3 in each viewport |

The review found no remaining Critical or Important Issue #8 defect and no
unresolved backend/client contract mismatch. A minor copy issue remains: some
legacy board text still describes that local board as unlinked/read-only while
the separate realtime panel is active. It does not affect authority or state.
