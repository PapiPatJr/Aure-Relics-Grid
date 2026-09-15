# Aure Relics v0.9 Testing Strategy

**Purpose:** Make v0.9 testing serious enough for a multiplayer final-testing candidate. This should be comparable in rigor to the finance app plan, but focused on the risks that matter for an online tabletop: permissions, hidden information, realtime sync, fog, guest access, and multi-client play.

## 1. Testing Standard

v0.9 is not ready merely because it builds. It is ready only when it survives:

- automated unit tests
- integration tests
- Supabase migration and RLS checks
- realtime multi-client checks
- DM/player visibility checks
- browser/device smoke tests
- Codex bug-bash passes
- live-table simulation with one DM and at least two player clients

## 2. Highest-Risk Areas

### Security and Visibility

- Player must never receive enemy actual HP.
- Player must never receive DM-only notes.
- Player must never receive hidden enemy/trap data.
- Player must see only revealed fog/map state.
- Guest player must not be able to claim another character without character code or DM approval.
- Revoked character/session codes must stop working.

### Realtime Sync

- DM changes sync to all players.
- Player changes sync to DM and allowed players.
- Two clients moving/editing should not corrupt state.
- Reconnect should reload latest session state.
- Out-of-turn movement request should not become official movement until DM approval.

### Gameplay Flow

- DM can log in and create campaign/session.
- Players can join by code/link without accounts.
- Players can create characters and upload image.
- Returning players can reclaim campaign-saved character with character code.
- Active player can draw glowing path and finalize movement.
- Next-turn and active-turn notifications work.
- DM feed gives enough oversight to run the table.

## 3. Automated Test Categories

### Unit Tests

Use Vitest for pure logic.

Required unit coverage:

- state initialization
- state migration/versioning
- campaign creation helpers
- session code generation
- character code generation/regeneration/revocation
- player battle card serialization
- enemy card player-projection removes actual HP
- fog cell reveal/hide helpers
- irregular fog area creation from cell list
- clear-all-fog behavior
- diagonal movement distance calculation
- movement path waypoint calculation
- terrain object placement/resize data model
- hazard/trap/difficult terrain model validation
- activity feed event creation

### Integration Tests

Use Vitest with mocked Supabase client or local Supabase where practical.

Required integration coverage:

- DM creates campaign and session.
- Guest player joins pending approval.
- DM approves player and character.
- Character persists and can be reclaimed.
- Player edits HP/AC/status and DM feed receives event.
- DM reveals fog area and player projection updates.
- DM hides trap and player projection excludes it.
- DM reveals hazard and player projection includes public fields only.
- Movement finalized by active player updates token and feed.
- Out-of-turn movement creates request instead of moving token.

### Supabase Migration/RLS Tests

Use Supabase CLI or a test Supabase project.

Required checks:

- migrations apply from clean database.
- RLS is enabled on sensitive tables.
- DM can read/write own campaign data.
- DM cannot read/write another DM campaign.
- guest can read only permitted session/player projection data.
- guest cannot query enemy actual HP.
- guest cannot query DM notes.
- revoked session/character code stops access.
- storage policy allows valid character image upload and blocks unauthorized reads/writes.

### Playwright/E2E Tests

Use Playwright once app structure supports it.

Required flows:

1. DM signup/login.
2. DM creates campaign.
3. DM creates session and copies code.
4. Player A joins as guest and creates character.
5. DM approves Player A.
6. Player A receives/reuses character code.
7. Player B joins in second browser context.
8. DM starts initiative.
9. Player A receives active-turn notification.
10. Player B receives next-turn notification when appropriate.
11. Player A draws glowing path and finalizes move.
12. DM feed logs movement.
13. DM creates fog area and reveals it.
14. Player view updates revealed fog.
15. DM creates hidden enemy with actual HP.
16. Player payload/view never exposes enemy actual HP.
17. DM reveals enemy condition only.
18. Player sees enemy condition but not actual HP.

## 4. Manual Multiplayer Test Matrix

Run at least these client combinations before declaring v0.9 final-testing ready:

- DM Chrome desktop + Player Chrome desktop + Player Edge desktop
- DM Chrome desktop + Player mobile browser + Player desktop browser
- DM browser tab + Player incognito tab + second player browser profile
- refresh/reconnect during session
- player joins late after fog and initiative already started
- player loses character code and DM manually recovers access

## 5. Fog Test Checklist

- New map with fog off by default loads fully visible.
- New map with fog on by default hides all intended areas.
- Area can start revealed by default.
- Area can start hidden by default.
- DM can paint irregular fog area cell-by-cell.
- DM can rename fog area.
- DM can reveal one fog area.
- DM can hide one fog area.
- DM can clear all fog.
- Fog state persists after reload.
- Player only sees revealed cells.
- Hidden enemies/traps inside fog remain invisible.

## 6. Battle Card Test Checklist

### Player Cards

- compact card shows character name, player name, image/token, HP, AC, statuses, and turn indicator.
- expanded card opens/closes.
- player can edit HP.
- player can edit AC.
- player can add/remove buff/debuff/status.
- DM can edit same fields.
- DM feed logs player changes.

### Enemy/NPC/Boss Cards

- DM sees exact HP.
- player never sees exact HP.
- player sees only public condition label when revealed.
- unrevealed enemy is absent from player view.
- private DM notes are not present in player payloads.

## 7. Movement Test Checklist

- active player can start path from assigned token.
- path displays glowing trail.
- path displays waypoint dots.
- diagonal movement contributes to distance.
- Finalize Move commits token position.
- Cancel Move restores original position.
- movement logs to DM feed.
- inactive player cannot directly move official token.
- inactive player can request control/movement.
- DM can approve/reject request.

## 8. Terrain and Map Effects Test Checklist

### Terrain

- DM places terrain centered on click.
- DM can resize terrain.
- DM can move terrain.
- DM can lock/unlock terrain.
- DM can layer terrain forward/back.
- terrain saves/reloads exact position/size.

### Hazards

- hazard is grid-cell based.
- hazard can have damage, save DC, duration, effect, DM notes, player-facing notes.
- hazard can be hidden/revealed.
- visual style matches substance category.

### Traps

- trap is separate from hazard.
- trap has trigger, detection note, save DC, damage/effect, state, notes.
- trap can be hidden/revealed.

### Difficult Terrain

- difficult terrain is separate from hazard/trap.
- difficult terrain has movement note and visibility.
- difficult terrain does not hard-block movement in v0.9.

## 9. Release Gate

Do not mark v0.9 ready for final testing until:

- `npm run build` passes.
- automated tests pass.
- Supabase migrations apply cleanly.
- RLS/visibility tests pass.
- Netlify deploy works.
- at least one DM + two-player live simulation passes.
- Codex has completed a bug-bash pass and all critical bugs are fixed or explicitly deferred.

## 10. Finance App Comparison

This is intended to be as serious as the finance app testing plan, but different in emphasis.

Finance app testing should focus heavily on calculations, budgeting correctness, data integrity, forms, privacy, and export/report behavior.

Aure Relics testing must focus heavily on realtime sessions, hidden information, permissions, guest access, fog, campaign persistence, and multi-client play. The risk is less about math and more about keeping the DM's hidden board from leaking through the walls like cursed smoke.
