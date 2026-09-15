# Aure Relics v0.9 Codex Kickoff Prompt

You are working in the `PapiPatJr/Aure-Relics-Grid` repository.

Use the Superpowers workflow. Before implementation, read:

- `docs/superpowers/specs/2026-09-14-aure-relics-v09-design.md`
- `docs/superpowers/plans/2026-09-14-aure-relics-v09-work-packages.md`
- `docs/testing/v09-test-strategy.md`

Goal: migrate the current Aure Relics v0.5.2 local battle grid prototype into the v0.9 online-play final-testing candidate.

Target stack:

- Vite
- plain JavaScript
- CSS
- Supabase Auth
- Supabase Postgres
- Supabase Realtime
- Supabase Storage
- Netlify
- Vitest
- Playwright where useful

Critical product rules:

- DM accounts are required.
- Players join as guests by session/campaign link or code.
- Characters persist in the campaign.
- Returning players reclaim characters with character-specific codes.
- Enemy actual HP must never be exposed to player views or player payloads.
- Player HP and AC are visible to the party.
- Fog is DM-owned.
- Hazards, traps, and difficult terrain are separate map effect types.
- Movement is free-board with glowing path and Finalize Move, not hard legality blocking.
- The app helps the table play; the DM decides.

Implementation rule:

Do not attempt all of v0.9 in one pass. Start with Work Package 1 from the work-packages document. Complete one package at a time with tests before moving on. After each package, report:

1. Files changed
2. Tests added
3. Tests run and results
4. Manual checks completed
5. Risks or follow-up work

First task: create the Vite app structure while preserving current Aure Relics branding/assets and getting the existing board rendering under Vite without adding Supabase yet.