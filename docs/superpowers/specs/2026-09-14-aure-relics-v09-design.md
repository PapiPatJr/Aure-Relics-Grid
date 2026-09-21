# Aure Relics v0.9 Design Spec

**Target:** v0.9 final-testing candidate  
**Stack:** Vite + plain JavaScript, Supabase Auth/Postgres/Realtime/Storage, Netlify hosting  
**Source baseline:** existing Aure Relics v0.5.2 grid prototype

## 1. Product Goal

Aure Relics v0.9 turns the local battle grid prototype into an online playable tabletop battle board. A DM can log in, create a campaign/session, share a join link or code, and run a live encounter while players connect from their own browsers over Discord, Teams, or another voice tool.

v0.9 is not full v1.0 polish. It is the feature-complete candidate for final testing. All major systems should exist, be testable, and be stable enough for live family/friend playtesting.

## 2. Product Philosophy

- Free board first, rules support second.
- The app informs; the DM decides.
- Setup must be fast: DM logs in, creates a board, loads players, and starts.
- Do not build hard rules enforcement into v0.9.
- Avoid legal/illegal movement blocking in v0.9.
- DM controls map, fog, hidden information, enemies, hazards, traps, terrain, and session authority.
- Players control their own battle card details and their assigned token when allowed.

## 3. User Roles

**Locked update, 2026-09-20:** There is one Aure Relics account identity. A registered user may be a DM in one campaign, a player in another, or both. Account identity, campaign ownership, campaign role, current session authority, character assignment and view mode are separate concepts. References below to a DM account mean an authenticated account acting with the required campaign permissions, not a permanent account type.

Campaign Owner retains ultimate authority. Campaigns may have Authorized DMs; each session has a Current Session DM. Future handoff is between Authorized DMs, and the owner can always reclaim the DM seat. Anonymous guests may play but never receive DM privileges. DM View / Player View is presentation only and cannot grant backend permissions. Issue #7 preserves the existing owner-only management implementation; Authorized DM and session-seat transfer implementation remains deferred.

### DM

The DM has an account and owns campaigns, sessions, maps, hidden data, fog, terrain, hazards, traps, enemies, initiative, and player approvals.

### Guest Player

Players do not need accounts in v0.9. They join by campaign/session code or link, create/reclaim a campaign-saved character, and use their own screen during play.

### Registered Player

An authenticated account may participate as a player where approved. Registration remains optional for v0.9 guest play. Character portability and account-wide reuse limits are future product work, not restrictions on campaign roles or requirements for guest characters.

## 4. Authentication and Access

- DM login: email/password through Supabase Auth.
- Player join: guest flow through session/campaign link or code.
- Campaign code gets a player into the campaign lobby.
- Character-specific code reclaims a saved campaign character.
- DM can view, copy, regenerate, revoke, and recover character codes.
- If a player loses a character code, DM can manually approve and reassign that player to the saved character.

## 5. Campaign, Session, Location, and Level Structure

Campaigns contain saved characters, sessions, locations, levels, notes, and activity history.

Locations represent actual play spaces such as a forest road, town, dungeon room, castle keep, cave entrance, or ship deck. Locations can eventually link to other locations for split-party play and travel.

Levels/floors exist inside locations. Each level can have its own grid size, map theme, fog, terrain, hazards, traps, difficult terrain, tokens, and notes.

Future direction includes Zelda-style room/floor/location shifts tied to turn order while preserving initiative.

## 6. DM God Screen

The DM screen must show everything:

- full map and unrevealed fog
- hidden and visible tokens
- hidden enemies, traps, hazards, and notes
- terrain and map effect tools
- fog brush and fog area tools
- player management
- initiative and turn controls
- battle cards for players, enemies, NPCs, and bosses
- activity feed
- session/code controls

## 7. Player Screen

Players see only public information:

- revealed map areas
- visible terrain
- visible hazards/traps/difficult terrain only after DM reveal
- visible tokens
- public initiative/turn information
- party battle cards
- their own card and assigned token

Players must never see DM-only notes, hidden enemies, hidden traps, unrevealed fog, or exact enemy HP.

## 8. Character Persistence

Characters save to the DM-owned campaign so players do not recreate characters every session.

v0.9 character flow:

1. Player joins by campaign/session code.
2. Player creates character with name, player name, HP, AC, movement speed, statuses, buffs/debuffs, and one-time image upload.
3. DM approves the character.
4. App generates a character-specific rejoin code.
5. Returning player uses campaign code + character code to reclaim the saved character.

## 9. Battle Cards

### Player Battle Cards

Player cards support compact and expanded views. Players can minimize to a compact battle card or open the full card anytime.

Visible to party:

- character name
- player name
- character image/token
- HP
- AC
- buffs/debuffs/statuses
- turn indicator

Not on the main shared battle card:

- passive perception
- full stats
- full skills
- spell list
- inventory
- initiative bonus

HP and AC are visible to the party. HP and AC can be edited by the player or DM. Changes are logged in the DM feed.

### Enemy, NPC, and Boss Cards

Enemy/NPC/boss cards also have compact and full views. DM sees full cards at all times. Players only see revealed enemies/NPCs/bosses and only public-facing information.

Enemy actual HP is DM-only. Players never see enemy HP numbers. Players may see a DM-selected public condition label such as Healthy, Hurt, Wounded, Bloodied, Near Death, Defeated, or Unknown.

## 10. Movement System

v0.9 movement is free-board and low-friction.

On a player’s turn:

- player can move their assigned token
- no DM approval required
- player draws/click-drags a glowing movement path with waypoint dots
- diagonal movement is counted in distance display
- player clicks Finalize Move to commit
- movement syncs to all connected screens
- movement is logged in the activity feed

Out of turn:

- player can request movement/control
- DM can approve or reject

Movement speed is a character field and should be displayed for awareness, not hard enforcement. The app can show distance and movement speed, but should not block movement in v0.9.

## 11. Turn Notifications

- Active player gets an in-app notification that it is their turn.
- Next player gets a one-turn-ahead notification that their turn is coming up.
- DM can always override initiative and movement.

## 12. Battle Map Layer

Battle map layout is the ground/theme layer. It provides visual atmosphere and grid surface, such as forest/grass, sand/desert, ice, stone dungeon, city/cobblestone, hell/ember, cave, ship/wood deck.

This layer is not terrain. It is the base map environment beneath terrain and tokens.

## 13. Freeform Terrain

Custom terrain art should be scalable and freeform. Terrain is not locked to one grid square. The DM places terrain by feel, resizes it, and positions it within chosen bounds.

Requirements:

- center-based placement
- scalable assets, preferably SVG/PNG with transparent backgrounds
- optional snap-to-grid rather than forced grid lock
- resize handles
- selection outline/glow
- bring forward/send backward controls
- lock/unlock controls
- save/load exact position and size

## 14. Fog of War

Fog is DM-owned. Players never control fog.

v0.9 fog requirements:

- grid-cell fog brush
- reveal brush
- hide brush
- clear all fog
- irregular fog areas built cell-by-cell
- named fog areas such as Boss Chamber or Storage Room
- one-click reveal/hide for a named fog area
- fog saves per location/level
- fog syncs live to players
- DM controls whether fog is on/off by default at campaign/location/level/map scope
- DM controls which fog areas start hidden or revealed by default

## 15. Hazards, Traps, and Difficult Terrain

Hazards, traps, and difficult terrain are separate object/area types.

Shared behavior:

- DM-controlled
- grid-cell based
- hide/reveal toggle
- saved per location/level
- logged in activity feed
- no hard movement blocking in v0.9

Hazards are ongoing danger areas with visual markers and tactical notes: damage, save DC, duration, effect, DM notes, and player-facing notes.

Traps are hidden/triggerable map elements with trigger, detection note, save DC, damage/effect, armed/disarmed/triggered state, DM notes, and player-facing reveal text.

Difficult terrain is an advisory movement complication with type, movement note, visibility, DM notes, and player-facing notes.

Hazard visuals should match the substance: oil/acid/slime/water/clouds have rounded irregular connected edges, fire glows and blends, spikes/caltrops/runes/traps are sharper or structured.

## 16. Realtime Sync

Use Supabase Realtime for online sessions.

DM writes official session/map state. Players can write only permitted data such as their own card updates, active-turn movement, and out-of-turn requests.

Realtime sync should cover:

- player joins/leaves
- battle card edits
- token movement
- initiative changes
- fog reveal/hide
- terrain changes
- hazards/traps/difficult terrain visibility
- DM feed events
- location/level view changes

## 17. Activity Feed

The DM feed is central to oversight without heavy permission friction.

Log events such as:

- player joined
- player character created/reclaimed
- player image uploaded
- HP/AC/status changed
- movement finalized
- out-of-turn movement requested
- DM revealed fog area
- DM cleared all fog
- DM created/edited/revealed hazard/trap/difficult terrain
- initiative advanced
- level/location switched

## 18. Database Model Draft

Initial Supabase tables:

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

Storage buckets:

- character-images
- terrain-assets
- map-assets

RLS policies must ensure DM owns campaign data, guest player access is limited by valid session/character code, and player queries cannot expose hidden state or enemy actual HP.

## 19. v0.9 Non-Goals

Not required for v0.9:

- full D&D rules enforcement
- automated legal/illegal movement blocking
- wall collision enforcement
- hazard/difficult terrain auto-cost enforcement
- complete class/spell/monster database
- direct D&D Beyond scraping or hidden APIs
- native mobile apps
- built-in voice/video chat
- full 3D engine
- payment/subscription system
- public marketplace

## 20. Success Criteria

v0.9 is ready for final testing when:

1. DM can create account and log in.
2. DM can create campaign.
3. DM can create session and share join code/link.
4. Player can join without account.
5. Player can create character and upload image.
6. Character saves to campaign.
7. Returning player can reclaim character with character code.
8. DM can recover/regenerate character code.
9. DM and player screens are separate.
10. Realtime sync works across at least two browsers/devices.
11. Player can move on their turn with glowing path and finalize move.
12. Out-of-turn movement requires request/approval.
13. Turn and next-turn notifications work.
14. Fog brush works.
15. Irregular fog areas work.
16. Clear all fog works.
17. Fog visibility syncs correctly to players.
18. Terrain can be placed freeform and saved.
19. Hazards/traps/difficult terrain can be created, hidden/revealed, and saved.
20. Enemy actual HP is never visible to players.
21. Player HP and AC are visible to party.
22. DM feed logs player and map actions.
23. Campaign/location/level foundation saves and reloads.
24. Netlify deployment works.
25. Expanded testing checklist passes.

## 21. Testing Standard

v0.9 testing must be comparable in seriousness to the finance app testing plan, but tuned for multiplayer tabletop behavior. Finance testing is heavier on calculations and data correctness. Aure Relics must be heavier on realtime sync, permissions, fog visibility, guest access, and multi-client gameplay.

Required testing categories:

- unit tests for pure state logic
- database migration tests
- Supabase RLS/security tests
- integration tests for campaigns/sessions/characters/fog/movement
- multi-client realtime tests
- DM/player visibility tests
- enemy HP exposure tests
- movement path and diagonal distance tests
- save/load/rejoin tests
- browser/device manual smoke tests
- Netlify deployment checks
- Codex bug-bash passes

The final v0.9 candidate should not be considered ready until it passes both automated checks and a live tabletop-style test with at least one DM browser and two player browsers.
