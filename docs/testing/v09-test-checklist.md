# Aure Relics v0.9 Test Checklist

Use this checklist before calling v0.9 ready for final testing.

## Build and Setup

- [ ] `npm install` succeeds.
- [ ] `npm run dev` succeeds.
- [ ] `npm run build` succeeds.
- [ ] Netlify deploy succeeds.
- [ ] Required Supabase environment variables are documented.
- [ ] App fails clearly when Supabase config is missing.

## DM Account and Campaigns

- [ ] DM can sign up with email/password.
- [ ] DM can log in.
- [ ] DM can log out.
- [ ] DM can create campaign.
- [ ] DM can load own campaign.
- [ ] DM cannot load another DM's campaign.

## Sessions and Guest Join

- [ ] DM can create hosted session.
- [ ] Session code/link is generated.
- [ ] Guest player can join with code/link.
- [ ] Guest player can submit player/character details.
- [ ] DM can approve guest player.
- [ ] DM can reject guest player.
- [ ] Rejected player cannot access board.

## Character Persistence

- [ ] Player can create character with image upload.
- [ ] Character saves to campaign.
- [ ] Character-specific code is generated.
- [ ] Returning player can reclaim character with character code.
- [ ] DM can view character code.
- [ ] DM can copy/share character code.
- [ ] DM can regenerate character code.
- [ ] DM can revoke character code.
- [ ] DM can recover lost-code access manually.

## Battle Cards

- [ ] Player compact battle card displays character name, player name, image/token, HP, AC, statuses, and turn indicator.
- [ ] Player full battle card opens/closes.
- [ ] Player can edit HP.
- [ ] Player can edit AC.
- [ ] Player can add/remove buffs, debuffs, statuses.
- [ ] DM can edit player HP/AC/statuses.
- [ ] DM feed logs HP/AC/status changes.
- [ ] DM sees exact enemy HP.
- [ ] Player never sees exact enemy HP.
- [ ] Revealed enemy shows public condition label only.
- [ ] Hidden enemy is absent from player view.

## Initiative and Turns

- [ ] DM can create initiative order.
- [ ] DM can advance turn.
- [ ] Active player receives turn notification.
- [ ] Next player receives next-turn notification.
- [ ] Initiative syncs to all screens.
- [ ] Initiative survives reload.

## Movement

- [ ] Active player can draw movement path from assigned token.
- [ ] Glowing trail renders.
- [ ] Waypoint dots render.
- [ ] Diagonal movement contributes to distance display.
- [ ] Finalize Move commits movement.
- [ ] Cancel Move restores original position.
- [ ] Movement logs to DM feed.
- [ ] Out-of-turn player cannot directly move official token.
- [ ] Out-of-turn player can request movement/control.
- [ ] DM can approve/reject request.

## Fog of War

- [ ] Fog can be enabled/disabled by DM.
- [ ] Fog default can be set at campaign/location/level scope.
- [ ] DM can reveal individual cells.
- [ ] DM can hide individual cells.
- [ ] DM can create irregular cell-by-cell fog area.
- [ ] DM can name fog area.
- [ ] DM can reveal fog area.
- [ ] DM can hide fog area.
- [ ] DM can clear all fog.
- [ ] Fog saves and reloads.
- [ ] Player only sees revealed areas.
- [ ] Hidden enemies/traps inside fog stay hidden.

## Terrain

- [ ] DM can place freeform terrain centered on click.
- [ ] DM can move terrain.
- [ ] DM can resize terrain.
- [ ] DM can lock/unlock terrain.
- [ ] DM can layer terrain forward/back.
- [ ] Terrain saves and reloads exact position and size.

## Hazards, Traps, Difficult Terrain

- [ ] Hazard can be created as grid-cell area.
- [ ] Hazard supports damage, save DC, duration, effect, DM notes, and player-facing notes.
- [ ] Trap can be created separately from hazard.
- [ ] Trap supports trigger, detection note, save DC, damage/effect, state, and notes.
- [ ] Difficult terrain can be created separately from hazards/traps.
- [ ] Difficult terrain supports movement note.
- [ ] All three can be hidden/revealed.
- [ ] All three save/reload.
- [ ] Player only sees revealed public fields.

## Locations and Levels

- [ ] DM can create location.
- [ ] DM can create level inside location.
- [ ] Each level has independent grid size.
- [ ] Each level has independent fog state.
- [ ] Each level has independent terrain/effects.
- [ ] Tokens belong to location/level.
- [ ] DM can switch level.
- [ ] Show above/show below/solo active level controls work.

## Realtime and Reconnect

- [ ] DM and two player browsers can connect to same session.
- [ ] Token movement syncs.
- [ ] HP/AC/status edits sync.
- [ ] Fog reveal syncs.
- [ ] Hazard/trap/difficult terrain reveal syncs.
- [ ] Refresh reloads latest state.
- [ ] Late-joining player gets current board state.

## Final Live Simulation

- [ ] One DM browser and two player browsers run a 20-minute mock encounter.
- [ ] Players join, reclaim characters, move, update cards, and see fog reveals.
- [ ] DM sees all hidden data and feed updates.
- [ ] No hidden enemy HP or DM notes appear in player view.
- [ ] No critical console errors occur.
