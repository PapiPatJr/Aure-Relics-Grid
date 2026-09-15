# Aure Relics v0.9 Work Packages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build Aure Relics Battle Grid v0.9 as an online-play final-testing candidate with DM account login, guest player join, persistent campaign characters, realtime battle map, fog of war, freeform terrain, grid-cell map effects, and DM/player screen separation.

**Architecture:** Migrate the existing local prototype into a Vite + plain JavaScript frontend backed by Supabase Auth, Postgres, Realtime, and Storage. Keep systems modular so board rendering, movement, fog, terrain, map effects, characters, sessions, and realtime sync can be tested independently.

**Tech Stack:** Vite, plain JavaScript, CSS, Supabase Auth, Supabase Postgres, Supabase Realtime, Supabase Storage, Netlify, Vitest, Playwright where useful.

**Spec:** `docs/superpowers/specs/2026-09-14-aure-relics-v09-design.md`

## Global Constraints

- v0.9 is a final-testing candidate, not final v1.0 polish.
- Do not build strict D&D rules enforcement into v0.9.
- DM controls map, fog, hidden information, enemies, hazards, traps, terrain, and session authority.
- Players do not need accounts in v0.9.
- Characters save to campaign and are reclaimed with character-specific codes.
- Enemy actual HP must never be exposed to players.
- Player HP and AC are visible to party.
- Fog is DM-owned and syncs only revealed state to players.
- Movement is free-board with glowing path/finalize, not hard legality blocking.

---

## Work Package 1: Vite Migration and App Shell

**Outcome:** Existing prototype runs inside a Vite app without losing Aure Relics branding or core local behavior.

**Primary files:**

- Create `package.json`
- Create `index.html`
- Create `src/main.js`
- Create `src/styles/main.css`
- Move static assets to `public/images`, `public/fonts`, and `public/assets`

**Acceptance tests:**

- `npm install` succeeds.
- `npm run dev` starts the app.
- `npm run build` succeeds.
- Existing board renders.
- Existing images/fonts load locally.
- No external font/CDN calls.

**Commit target:** `chore: migrate aure relics to vite`

---

## Work Package 2: State Model Foundation

**Outcome:** App state is centralized and versioned before Supabase sync is added.

**Primary files:**

- Create `src/state/schema.js`
- Create `src/state/store.js`
- Create `src/state/migrations.js`
- Create `src/state/store.test.js`

**State must include:**

- campaigns
- sessions
- locations
- levels
- tokens
- characters
- battle cards
- fog cells
- fog areas
- terrain objects
- hazards
- traps
- difficult terrain
- initiative
- activity events

**Acceptance tests:**

- empty state initializes.
- campaign can be created.
- location and level can be created.
- legacy local scene data can be migrated into a default campaign/location/level.
- state version is stored.

**Commit target:** `feat: add versioned state model`

---

## Work Package 3: Supabase Foundation

**Outcome:** Supabase client, environment config, database migrations, and storage buckets are defined.

**Primary files:**

- Create `src/supabase/client.js`
- Create `supabase/migrations/0001_v09_core_schema.sql`
- Create `supabase/README.md`
- Create `.env.example`

**Tables:**

- profiles
- campaigns
- campaign_members
- sessions
- session_players
- characters
- character_codes
- locations
- levels
- tokens
- terrain_objects
- fog_cells
- fog_areas
- hazards
- traps
- difficult_terrain
- initiative_entries
- movement_paths
- activity_events

**Acceptance tests:**

- migration applies cleanly in a fresh Supabase project.
- `.env.example` documents required variables.
- client fails safely when env vars are missing.
- RLS is enabled on user/session data tables.

**Commit target:** `feat: add supabase foundation`

---

## Work Package 4: DM Auth and Campaign Dashboard

**Outcome:** DM can create account, log in, create campaigns, and open a campaign dashboard.

**Primary files:**

- Create `src/auth/auth-service.js`
- Create `src/auth/auth-ui.js`
- Create `src/campaigns/campaign-service.js`
- Create `src/campaigns/campaign-dashboard.js`

**Acceptance tests:**

- DM can sign up with email/password.
- DM can log in/out.
- DM can create campaign.
- DM can load owned campaigns.
- Unauthorized users cannot read another DM campaign through RLS.

**Commit target:** `feat: add dm auth and campaign dashboard`

---

## Work Package 5: Session Hosting and Guest Join Flow

**Outcome:** DM can create a session and players can join by link/code without accounts.

**Primary files:**

- Create `src/sessions/session-service.js`
- Create `src/sessions/session-host-ui.js`
- Create `src/sessions/join-ui.js`
- Create `src/sessions/session-codes.js`

**Acceptance tests:**

- DM creates session code.
- Player opens join route with code.
- Player can enter player name and character name.
- DM can approve/reject new guest player.
- rejected player cannot access board.

**Commit target:** `feat: add hosted sessions and guest join`

---

## Work Package 6: Campaign Characters and Character Codes

**Outcome:** Characters persist in campaigns and can be reclaimed by character-specific code.

**Primary files:**

- Create `src/characters/character-service.js`
- Create `src/characters/character-code-service.js`
- Create `src/characters/character-form.js`
- Create `src/characters/character-codes-panel.js`

**Acceptance tests:**

- player creates character with image, HP, AC, movement speed, statuses.
- character saves to campaign.
- character code is generated after DM approval.
- returning player reclaims character with campaign code + character code.
- DM can view/copy/regenerate/revoke/reassign character code.

**Commit target:** `feat: add persistent campaign characters`

---

## Work Package 7: DM and Player Screen Split

**Outcome:** DM and player views are separate and permission-aware.

**Primary files:**

- Create `src/screens/dm-screen.js`
- Create `src/screens/player-screen.js`
- Create `src/visibility/visibility-service.js`
- Create `src/visibility/player-projection.js`

**Acceptance tests:**

- DM sees hidden data.
- player sees only public projection.
- hidden enemy not rendered for player.
- unrevealed fog hides map contents for player.
- enemy actual HP is removed from player payloads and not merely hidden with CSS.

**Commit target:** `feat: split dm and player screens`

---

## Work Package 8: Realtime Sync and Activity Feed

**Outcome:** DM/player screens sync live and all important actions log to the DM feed.

**Primary files:**

- Create `src/realtime/realtime-service.js`
- Create `src/activity/activity-service.js`
- Create `src/activity/activity-feed.js`

**Acceptance tests:**

- player join appears on DM feed.
- player HP/AC/status edits sync and log.
- DM fog reveal syncs to player view.
- token movement syncs between two browsers.
- reconnect reloads latest state.

**Commit target:** `feat: add realtime sync and activity feed`

---

## Work Package 9: Battle Cards

**Outcome:** Player and enemy/NPC/boss battle cards support compact/full views and correct visibility.

**Primary files:**

- Create `src/cards/battle-card-model.js`
- Create `src/cards/player-card.js`
- Create `src/cards/enemy-card.js`
- Create `src/cards/card-controls.js`

**Acceptance tests:**

- player can toggle compact/full battle card.
- party sees player HP, AC, buffs/debuffs/statuses.
- initiative bonus and passive perception are not shown on core card.
- DM sees exact enemy HP.
- player sees enemy condition label only.
- enemy actual HP is not present in player data object.

**Commit target:** `feat: add battle cards`

---

## Work Package 10: Initiative and Turn Notifications

**Outcome:** Initiative works across online sessions with active/next player notifications.

**Primary files:**

- Create `src/initiative/initiative-service.js`
- Create `src/initiative/initiative-ui.js`
- Create `src/notifications/in-app-notifications.js`

**Acceptance tests:**

- DM creates initiative order.
- active player sees their-turn notification.
- next player sees next-turn warning.
- active turn syncs to all screens.
- initiative survives session reload.

**Commit target:** `feat: add initiative notifications`

---

## Work Package 11: Movement Path and Finalize Move

**Outcome:** Active player can draw glowing path with waypoints and finalize move.

**Primary files:**

- Create `src/movement/path-model.js`
- Create `src/movement/path-renderer.js`
- Create `src/movement/movement-service.js`
- Create `src/movement/movement-controls.js`

**Acceptance tests:**

- active player can drag/draw path.
- path renders glowing trail and waypoint dots.
- diagonal movement is included in distance display.
- Finalize Move commits token position.
- Cancel Move restores original position.
- out-of-turn movement creates request.
- DM can approve/reject out-of-turn movement request.

**Commit target:** `feat: add movement path finalization`

---

## Work Package 12: Fog of War and Fog Areas

**Outcome:** DM can paint fog, define irregular fog areas, reveal/hide areas, and clear all fog.

**Primary files:**

- Create `src/fog/fog-model.js`
- Create `src/fog/fog-service.js`
- Create `src/fog/fog-tools.js`
- Create `src/fog/fog-renderer.js`

**Acceptance tests:**

- DM can reveal/hide individual cells.
- DM can create irregular cell-by-cell fog area.
- DM can name fog area.
- DM can reveal/hide one fog area.
- DM can clear all fog.
- fog default can be set at campaign/location/level scope.
- player sees only revealed cells.

**Commit target:** `feat: add fog of war and fog areas`

---

## Work Package 13: Freeform Terrain System

**Outcome:** DM can place, select, resize, layer, lock, and save freeform terrain.

**Primary files:**

- Create `src/terrain/terrain-model.js`
- Create `src/terrain/terrain-tools.js`
- Create `src/terrain/terrain-renderer.js`
- Create `src/terrain/terrain-assets.js`

**Acceptance tests:**

- placement is center-based.
- terrain can be resized.
- terrain can be moved.
- terrain can be locked/unlocked.
- terrain supports layering controls.
- terrain saves and reloads exact position/size.
- terrain does not require grid-square locking.

**Commit target:** `feat: add freeform terrain system`

---

## Work Package 14: Hazards, Traps, and Difficult Terrain

**Outcome:** DM can create separate grid-cell map effect types with hide/reveal and notes.

**Primary files:**

- Create `src/map-effects/hazards.js`
- Create `src/map-effects/traps.js`
- Create `src/map-effects/difficult-terrain.js`
- Create `src/map-effects/map-effect-renderer.js`

**Acceptance tests:**

- hazard can be created with damage, save DC, duration, effect, notes.
- trap can be created with trigger, detection note, armed/disarmed/triggered state.
- difficult terrain can be created with movement note.
- all three can hide/reveal.
- player sees only revealed public details.
- feed logs create/edit/reveal/remove actions.

**Commit target:** `feat: add map effects`

---

## Work Package 15: Locations, Levels, Fade, and Battle Map Themes

**Outcome:** Campaigns support locations and levels with independent map/fog/effect state.

**Primary files:**

- Create `src/locations/location-service.js`
- Create `src/levels/level-service.js`
- Create `src/levels/level-controls.js`
- Create `src/map-themes/map-themes.js`
- Create `src/levels/level-fade-renderer.js`

**Acceptance tests:**

- DM can create location.
- DM can create level inside location.
- each level has independent grid size.
- tokens belong to a location/level.
- terrain/fog/effects belong to a location/level.
- active level is full visibility to DM.
- show above/show below/solo active controls work.

**Commit target:** `feat: add locations levels and map themes`

---

## Work Package 16: Final Testing, Docs, and Release Candidate Package

**Outcome:** v0.9 is deployable to Netlify and ready for final testing.

**Primary files:**

- Modify `README.md`
- Modify `Aure-Relics-Tutorial.md`
- Create `docs/testing/v09-test-checklist.md`
- Create `docs/testing/v09-test-strategy.md`
- Create `docs/release-notes/v0.9-alpha.md`
- Create `netlify.toml`

**Required checks:**

- App builds successfully.
- Netlify deploy works.
- Supabase env variables documented.
- DM can host session.
- Player can join from separate browser/device.
- Realtime sync works.
- Fog visibility works.
- Player cannot see hidden state.
- Enemy HP never exposed to player view.
- Character rejoin code works.
- Movement path/finalize works.
- Activity feed logs expected events.
- Expanded v0.9 testing strategy has been executed.

**Commit target:** `docs: prepare v0.9 testing candidate`

---

## Recommended Codex Execution Order

Run these in order. Do not ask Codex to build all of v0.9 in one prompt.

1. Vite migration and app shell
2. State model foundation
3. Supabase foundation
4. DM auth and campaign dashboard
5. Session hosting and guest join flow
6. Campaign characters and character codes
7. DM/player screen split
8. Realtime sync and feed
9. Battle cards
10. Initiative and turn notifications
11. Movement path/finalize
12. Fog of war/fog areas
13. Freeform terrain
14. Hazards/traps/difficult terrain
15. Locations/levels/fade/themes
16. Final docs/testing/release
