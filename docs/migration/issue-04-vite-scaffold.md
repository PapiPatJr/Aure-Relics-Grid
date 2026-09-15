# Issue #4 Migration Notes: Vite Scaffold

## Purpose

This branch starts the Aure Relics v0.9 re-platform from the static v0.5.2 prototype into a Vite + plain JavaScript application.

The goal of this issue is a safe runway, not a feature rewrite. The current playable prototype remains intact while Vite becomes the development/build shell.

## What changed

- Added `package.json` with Vite scripts.
- Added `vite.config.js`.
- Added `src/main.js` as the Vite entry point.
- Added `src/app/legacyBootstrap.js` as a temporary bridge to the existing root-level `script.js`.
- Added a Vite `transformIndexHtml` bridge that replaces the legacy script tag with `/src/main.js` during Vite dev/build. The root `index.html` remains otherwise unchanged for safe migration.
- Added `.env.example` with reserved Supabase variables for issue #5.
- Added `scripts/verify-vite-scaffold.mjs` for a fast local sanity check.

## What did not change

- The app remains plain JavaScript.
- The current grid UI, CSS, local save behavior, terrain, scene themes, HUDs, and combat tracker are not intentionally redesigned here.
- Supabase is not connected in this issue.
- DM/player auth, realtime sync, fog of war, character codes, hazards, traps, and difficult terrain remain later issues.
- Local fonts and images remain in their current root folders for now.

## Local verification commands

Run these from the repository root:

```bash
npm install
npm run check
npm run dev
npm run build
```

Manual smoke test after `npm run dev`:

1. Open the dev server URL.
2. Confirm the Aure Relics logo/banner loads.
3. Confirm the grid renders.
4. Place at least one player token and one enemy token.
5. Place at least one terrain object.
6. Save a scene, reload, and load it again.
7. Open browser dev tools and confirm there are no Google Fonts, CDN font calls, or console-breaking errors.

## Codex handoff

Start from this branch when Codex resumes. Ask Codex to finish issue #4 only before moving into issue #5.

Codex should verify:

- `npm install` succeeds.
- `npm run check` succeeds.
- `npm run build` succeeds.
- The Vite dev app preserves the current v0.5.2 user experience.

If the imported legacy script fails under module loading, the fallback path is to load the current `script.js` as a classic script during the bridge phase and keep the module entry focused on future v0.9 code. Do not begin a major refactor inside issue #4 unless the build fails and this fallback is insufficient.
