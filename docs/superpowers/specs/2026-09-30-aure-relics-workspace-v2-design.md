# Aure Relics Workspace V2 Design

Date: 2026-09-30
Branch: `v2-workspace`
Baseline: `832877d6d881cc0db536a931efba0e98d8486217`
Status: Design specification for review before implementation planning

## 1. Objective

Build Aure Relics Workspace V2 as a clean, board-first virtual tabletop workspace while leaving the currently playable table untouched.

V2 should preserve the working Supabase/auth/realtime/security foundation from the baseline, but replace the current board presentation and workspace shell with a responsive graphics-style environment inspired by professional art and design applications.

The intended experience is:

- Players see a simple, focused board and only the controls they need.
- Dungeon Masters can reveal deeper tools on demand.
- The board is always the primary surface.
- Tools can open temporarily, dock to either side, float, minimize, or close.
- Mouse, trackpad, touch, tablet portrait, tablet landscape, phone portrait, phone landscape, and desktop are treated as first-class interaction modes.
- The current playable version remains isolated and unaffected until V2 is deliberately promoted later.

## 2. Isolation and Release Safety

V2 development occurs on `v2-workspace`, created directly from commit `832877d6d881cc0db536a931efba0e98d8486217`.

Recommended local workspace:

`C:\Users\patlo\Desktop\Aure Relics\aure-relics-v2`

This should be a fresh clone of the existing repository with `v2-workspace` checked out.

Hard rules during V2 development:

- Do not modify the existing live checkout.
- Do not merge V2 into `main` or the current release branch without explicit approval.
- Do not deploy V2 over the current production Netlify site.
- Do not alter the currently playable GitHub-hosted table as part of V2 work.
- Do not apply hosted production Supabase schema changes during early V2 work.
- Use local development first, then a separate V2 preview deployment later.

## 3. Architectural Principle

The current networking and authorization architecture is retained where possible.

Preserve and reuse:

- Supabase authentication
- anonymous player identities
- session/campaign authorization
- realtime engine
- session lifecycle
- mutation bridge
- BoardView projection
- fog authorization boundaries
- character records
- session snapshots
- storage
- stale-revision conflict recovery

Replace or substantially redesign:

- fixed DOM-grid presentation
- permanent left/right rails
- rigid desktop-centric workspace layout
- generic player-token authoring flow
- disconnected lobby-to-live-session transition

The new rendering layer must consume existing normalized realtime state rather than reimplement backend authority in the client.

## 4. Canvas V2

### 4.1 Rendering technology

Use Konva with plain JavaScript and Vite.

Konva is used as the graphics scene layer. Supabase and Aure Relics realtime modules remain responsible for authoritative state and synchronization.

### 4.2 Layer model

The initial canvas should support an explicit scene stack:

1. Background layer
2. Grid layer
3. Terrain layer
4. Structure layer
5. Difficult terrain layer
6. Hazard layer
7. Trap layer
8. Token layer
9. Fog layer
10. Measurement layer
11. Interaction/selection layer

Not every layer needs full authoring features in the first milestone. The first milestone must establish the layer architecture so later systems do not become entangled.

### 4.3 World coordinate system

All board content uses one shared world-coordinate system.

The camera owns viewport state:

- `x`
- `y`
- `zoom`

Grid, fog, terrain, tokens, overlays, measurements, and selections must transform together from that one camera.

No layer may independently invent viewport transforms.

### 4.4 Required camera interactions

Desktop/mouse:

- mouse wheel zoom centered on cursor
- middle-mouse drag pan
- Space + left-drag pan
- explicit Hand/Pan tool
- `-`, `100%`, `+`, and `Fit` controls

Trackpad:

- two-finger pan
- pinch zoom where browser/device events permit

Touch:

- pinch zoom
- two-finger pan
- one-finger interaction reserved for the currently active tool

Camera state is local presentation state. It is not persisted as shared multiplayer state unless a future explicit DM sync-view command is used.

## 5. Workspace Shell

### 5.1 Board-first layout

The V2 board should fill the usable viewport. Permanent left and right control rails are removed as a default requirement.

Primary DM top bar:

`AURE RELICS | Party | Encounter | Tokens | Terrain | Map | Fog | Measure | Notes | Session | View`

Exact names may be refined during implementation, but the information architecture should remain compact and task-oriented.

### 5.2 Unified panel behavior

Every major tool panel should use one panel-management system rather than bespoke layout logic.

Supported panel states:

- dropdown
- dock-left
- dock-right
- floating
- minimized
- closed

A panel opened from the top bar defaults to dropdown/popover behavior.

The DM may then pin it left or right, detach it into a movable floating window, minimize it, or close it.

Workspace layout is local user-interface state and must not be synchronized to players.

### 5.3 Floating circular quick-tool menu

Add a movable, collapsible radial quick-tool control.

Initial DM quick actions:

- Select
- Token
- Fog
- Measure
- Terrain or Pan, depending on final first-milestone ergonomics

Requirements:

- draggable position
- collapsible to a small circular button
- usable with mouse and touch
- never blocks permanent access to essential controls
- remains presentation-only and does not grant authority

## 6. Responsive Behavior

V2 is responsive from the start rather than retrofitted later.

Desktop wide:

- full top bar
- optional left/right docked panels
- floating panels allowed

Desktop narrow / tablet landscape:

- compact top bar
- docked panels collapse when space becomes constrained
- canvas remains primary

Tablet portrait:

- top bar condenses labels/icons as needed
- tool panels may become overlays or sheets instead of shrinking the board excessively

Phone landscape:

- canvas-first
- minimal top bar
- radial menu prominent

Phone portrait:

- canvas remains usable
- panels open as full-height or near-full-height sheets
- no fixed desktop rail layout

Orientation changes must not alter world coordinates or corrupt canvas state.

## 7. Player, Character, and Token Identity

The existing generic `Player` token concept is split into two user-facing concepts.

### 7.1 Character Token

A Character Token represents an approved player character.

Relationship:

`Session Player -> Approved Character -> Character Token`

A Character Token must retain the character association used by existing realtime/backend structures.

The DM should not create a human-player combatant as an unrelated generic marker.

### 7.2 Ally Token

Replace the generic ad-hoc `Player` token authoring option with `Ally` for non-player friendly combatants.

Examples:

- summons
- pets
- hired warriors
- allied NPCs
- escorts
- story companions
- friendly monsters

Target token taxonomy:

- Character
- Ally
- NPC
- Enemy
- Boss

Implementation may preserve the existing backend `player` kind temporarily for Character Tokens if required for compatibility, but the UI must distinguish Character from Ally explicitly.

A real backend `ally` kind is desirable if it can be introduced without weakening authorization or projection rules.

## 8. Session Launch Flow

Approval alone should not silently mean active play.

Target flow:

`Joined -> Approved -> Character Ready -> Player Ready -> DM Starts Session -> Live Board`

### 8.1 Player readiness

Approved players should be able to indicate Ready / Not Ready once their character state is acceptable.

### 8.2 DM party view

The Party panel should show at minimum:

- player display name
- approved character
- character approval state
- ready state
- token placement state

### 8.3 Start Session

The DM receives a clear `Start Session` control.

Starting a session transitions approved/eligible player clients into the live player board experience.

The exact backend state transition must be specified during implementation planning and should reuse existing session status fields where practical rather than creating duplicate truth.

## 9. Workspace Modes

V2 should support workspace presets without creating separate applications.

Initial presets:

### Design

Emphasize:

- Terrain
- Map
- Fog
- Measure

### Combat

Emphasize:

- Party
- Initiative
- Tokens
- Combat actions

### Presentation

Emphasize:

- maximum board area
- player-preview behavior
- minimal DM chrome

Panel positions and local camera state may be remembered per browser/device later, but persistence is not required for the first Canvas V2 proof.

## 10. Screen-Space UI Rules

Some interface elements should remain readable regardless of map zoom.

Examples:

- selection outlines
- active-turn indicators
- measurement labels
- token interaction handles
- important token name labels where appropriate

These should use screen-space sizing or inverse scaling rather than becoming unusably tiny or huge as the camera zoom changes.

## 11. First Development Milestone: Canvas V2 Proof

The first implementation milestone is intentionally narrow.

It must prove:

1. New V2 workspace route/surface exists without replacing the live/current board.
2. Konva Stage renders a large Aure Relics grid.
3. Camera supports wheel zoom, pan, Fit, and reset/100%.
4. Touch/pinch behavior is represented and testable where the browser environment permits.
5. Top workspace bar renders with no permanent side rails.
6. At least one tool panel can open as dropdown, dock left, dock right, float, minimize, and close.
7. Floating circular quick-tool control can move and collapse.
8. Existing `BoardView` data can render at least one synchronized token on Canvas V2.
9. Player-visible projections still cannot expose DM-only data.
10. No production deployment occurs.

No terrain-editor rewrite, full fog authoring port, full initiative port, or mobile polish should be required before this proof passes.

## 12. Second Development Milestone: Playable Session Bridge

After Canvas V2 proof succeeds:

- implement explicit character-to-token placement
- introduce Ally token flow
- implement Ready / Not Ready
- implement DM Start Session
- route approved/ready players into the live player board
- expose token placement state in Party panel
- keep existing authority rules intact

## 13. Third Development Milestone: Tool Port

Move existing systems into the V2 workspace panel architecture:

- Initiative
- Fog
- Terrain
- Map/scene controls
- DM notes/history
- Token inspector
- Combat actions

Old fixed rails should not be reproduced inside V2.

## 14. Testing Strategy

V2 should use focused package gates during development.

Canvas/camera tests:

- world-to-screen transform
- screen-to-world transform
- zoom-at-cursor anchor preservation
- pan math
- Fit calculations
- resize/orientation stability
- layer ordering

Workspace tests:

- dropdown open/close
- dock left/right
- float
- minimize
- responsive collapse behavior

Identity/session tests:

- player -> character -> Character Token association
- Ally remains independent from player identity
- Ready state
- Start Session transition
- non-approved players cannot enter live play

Realtime/security tests:

- BoardView remains projection source
- hidden/DM-only state never leaks into player rendering
- token updates remain synchronized

Do not rerun the entire legacy E2E suite after every V2 UI edit. Use focused tests during development, then broader regression gates at milestone boundaries.

## 15. Technology Boundary

V2 remains:

- Vite
- plain JavaScript
- Supabase
- Konva for the new graphics workspace

Do not migrate the application to React merely to build Canvas V2.

New dependencies should be added only when they provide clear value to the workspace architecture.

## 16. Non-Goals for the Initial V2 Proof

Not required before Canvas V2 proof:

- full 3D terrain
- lighting engine
- rules automation engine
- compendium
- D&D Beyond integration
- advanced pathfinding
- voice/video
- complete undo/redo history
- multiplayer pointer sharing
- automated movement legality enforcement

These may be considered later once the workspace foundation proves stable.

## 17. Success Criteria

Workspace V2 is on the right path when all of the following are true:

- the current playable version remains untouched
- V2 runs from a clean isolated clone/branch
- the board feels like a canvas rather than a webpage
- zoom and pan are smooth and predictable
- all board layers remain aligned under one camera
- tools appear when needed and disappear when not needed
- panels are reusable, dockable, and responsive
- portrait and landscape layouts remain usable
- player identity flows cleanly into character and Character Token identity
- friendly non-player combatants use Ally rather than fake Player tokens
- the DM has an explicit session start workflow
- existing realtime and security boundaries remain intact

## 18. Promotion Rule

V2 does not replace the current playable table until it has:

- passed milestone-specific tests
- received explicit manual approval
- been tested through a separate preview deployment
- completed a focused multiplayer smoke test on desktop and at least one touch device

Promotion to the current production URL or merge into the live release path requires a separate explicit decision.