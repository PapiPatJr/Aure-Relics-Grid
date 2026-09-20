# Issue #6 Playwright acceptance plan

User-approved scope: add a permanent Chromium E2E layer and complete PR #17 acceptance. Never merge; no issue #7. Product edits require a reproduced failing browser test.

1. Add pinned Playwright, own loopback Vite server, local-project guard, isolated actor fixtures, failure traces/screenshots, and unique fixture cleanup. Never reset shared data or touch another stack.
2. Exercise DM registration/login/logout, campaign/session/invitations, two anonymous guests, approval/rejection/removal, guest route guards, code rotation/revocation/cross-scope denial and DM isolation through real browser contexts. Test local board grid/terrain/combat/scene save-load and return navigation. Cover desktop/narrow layout, local assets, focus, loading and errors. Collect console/network evidence.
3. Keep failing browser tests for genuine product defects, diagnose/fix only those, rerun affected and full suites. Inspect screenshots. Independently review test safety/coverage. Run E2E/DB/API/JS/build/audit, inspect diff/secrets, commit/push existing branch and update PR #17.

Shared interface: fixture reads CLI status in Node only; Vite receives the local public key only; tests use UI-created independent identities. All browser traffic restricted to loopback app/API. Cleanup uses each owner identity for its own campaigns and local admin only to delete test Auth identities.

Expected: all browser assertions pass with no unexpected console errors, failed requests or remote assets; cleanup succeeds; security suites and build remain green. Failure artifacts may contain generated local test credentials and remain Git-ignored. Retain no browser storage state in source control.
