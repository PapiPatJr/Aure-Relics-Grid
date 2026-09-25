# Aure Relics v0.9 Fog of War Architecture Design

Date: 2026-09-25
Issue: #10 `[v0.9][07] Add fog of war, irregular fog areas, and fog defaults`
Status: Architecture approved, implementation not started

## Purpose

Implement DM-controlled Fog of War for Aure Relics v0.9 while preserving the product's core philosophy:

> Free board first. Rules support second. DM authority always.

Fog must be fast enough for live play, strict enough to prevent player-visible leaks, persistent across sessions, compatible with the existing realtime and role-aware projection architecture, and flexible enough to support later terrain, traps, hazards, multi-level maps, and future exploration-memory features.

This design extends the existing Supabase schema and Issue #8/#9 realtime/projection architecture. It does not create a parallel fog subsystem.

## Non-goals for Issue #10

Issue #10 does **not** implement:

- v1.x explored-memory / previously-seen fog.
- Issue #11 terrain, hazards, traps, or difficult-terrain authoring mechanics.
- Issue #13's full multi-level editor/workflow.
- Secure tiled/progressive map-asset delivery.
- Automatic perception/discovery/rules enforcement.
- Automatic player vision cones, line of sight, lighting, or dynamic visibility.

Fog is a DM-operated visibility tool, not an automated rules engine.

---

# 1. Core Fog Model

## 1.1 Two states only in v0.9

Every fog cell is one of:

- **Hidden**
- **Revealed**

There is no third state for "previously explored but currently obscured" in v0.9. Exploration memory is deferred to v1.x.

## 1.2 Persistent level state

Current fog reveal state belongs to the level and persists across sessions until the DM deliberately changes or resets it.

Example: if a party explores a dungeon on Tuesday, those cells remain revealed when the campaign returns to that same level on Saturday unless the DM hides or resets them.

## 1.3 Fog and disclosure are separate gates

Fog controls **where** players may see the map.

DM disclosure controls **whether** a hidden gameplay object has been revealed to players.

Revealing fog must never automatically reveal a DM-hidden creature, trap, hazard, secret door, secret object, or similar concealed element.

Likewise, disabling fog only removes the map-visibility restriction. DM-hidden objects remain hidden until the DM separately discloses them.

The app never decides that a player has noticed or discovered something. Perception checks, investigation, narrative reveals, and similar moments remain DM-controlled.

## 1.4 Discrete objects versus area effects

After the DM discloses an object:

- **Discrete creature/object tokens** render as whole tokens once spatially exposed by revealed fog. A creature is not visually sliced by the fog edge.
- **Area-shaped effects** such as fire, acid, difficult terrain, floor markings, hazards, and similar footprints remain clipped by the authoritative revealed-fog boundary.

Ordinary non-secret scenery may follow fog visibility directly.

---

# 2. Fog Defaults and Inheritance

Fog enablement resolves in this order:

1. **Level**
2. **Location**
3. **Campaign**

Campaign fog is always an explicit On/Off default.

Location and Level may be:

- On
- Off
- Inherit

Example:

- Campaign: On
- City location: Off
- Sewer level beneath the city: On

The sewer uses fog even though the city location disables it.

## 2.1 Initial state for a newly fog-enabled level

A newly initialized fog-enabled level starts **fully Hidden**.

The exception is any named fog area configured `revealed_by_default = true`.

## 2.2 Reset to Defaults

`Reset to Defaults` restores the baseline:

1. Start Hidden everywhere.
2. Reveal cells covered by named areas marked Revealed by Default.
3. Re-hide cells covered by named areas marked Hidden by Default.

Therefore **Hidden-by-default wins when opposing named-area defaults overlap**.

This lets a DM create, for example, a revealed starting chamber with a smaller secret alcove inside it that remains hidden after every reset.

---

# 3. Canonical Data Model

## 3.1 Current fog truth

`public.fog_cells` remains the canonical current Hidden/Revealed state.

Existing shape:

- `campaign_id`
- `level_id`
- `x`
- `y`
- `is_revealed`

The primary key remains level + cell coordinate.

## 3.2 Named areas

`private.fog_areas` remains the canonical saved-area definition.

Named fog areas are **saved cell selections**, not a second visibility system.

Each area stores:

- campaign/level ownership
- name
- selected cells
- `revealed_by_default`

A named area's live status is derived dynamically from canonical cell state:

- **Hidden**
- **Revealed**
- **Mixed**

Areas may overlap.

Creating or editing a named area changes only its saved selection/default metadata. It does **not** alter current live fog until the DM explicitly uses Reveal Area, Hide Area, Reset to Defaults, or ordinary painting.

## 3.3 Existing spatial visibility predicate

The existing backend spatial visibility logic remains the security gate for whether player-visible spatial content is allowed through fog.

Issue #10 may extend or refactor the predicate implementation as needed for the approved rendering rules, but it must preserve backend authority and fail-closed behavior.

---

# 4. Authoritative Mutation Architecture

Clients must not directly write `fog_cells`.

Fog changes are submitted through DM-only backend commands/RPCs that validate authorization and commit atomically.

## 4.1 Required mutation families

The backend must support focused commands for:

- Reveal/Hide brush stroke batch
- Reveal named area
- Hide named area
- Reveal All
- Hide All
- Reset to Defaults
- Enable/Disable or inherited fog setting changes
- Named-area create/edit/rename/delete

The exact RPC surface may be consolidated where that reduces duplication, but the command semantics above must remain explicit and testable.

## 4.2 Validation

Every fog mutation validates:

- caller DM authority
- campaign ownership/authorization
- target `level_id`
- level belongs to the campaign
- cell coordinates are within grid bounds
- expected authoritative revision
- requested operation shape

Duplicate cells in a submitted stroke are collapsed before writing.

Cells already in the requested state need not be rewritten.

## 4.3 Atomicity

A brush stroke is one logical mutation.

Reveal All, Hide All, Reveal/Hide Area, and Reset to Defaults are also each one logical mutation.

No broad action may degrade into one network/database mutation per cell.

If a batch fails, no partial authoritative fog state may remain committed.

## 4.4 Optimistic concurrency

Fog mutations carry the revision they were based on.

If another DM-authorized view has committed newer state first, the stale mutation is rejected instead of silently overwriting newer fog.

On stale revision:

1. reject the mutation
2. rehydrate authoritative state
3. discard the stale local preview
4. allow the DM to retry intentionally

An older DM window must never overwrite newer visibility state merely because it submitted later.

---

# 5. Brush and Named-Area Interaction

## 5.1 Brush modes

Primary modes:

- Reveal
- Hide

Brush sizes:

- 1x1
- 2x2
- 3x3
- 5x5

Holding **Shift** temporarily inverts Reveal ↔ Hide.

## 5.2 Shared paint engine

The same cell-paint/select engine is reused for:

- live Reveal/Hide painting
- named-area creation
- named-area editing

Named-area workflow:

`New Area → paint/select cells → name → choose default Hidden/Revealed → Save`

## 5.3 Local preview, commit on release

While dragging:

- the DM sees an immediate local preview
- the preview is DM-only
- players continue seeing the last authoritative committed state

On pointer/mouse release:

- the full stroke commits as one atomic batch
- one authoritative revision/update is produced
- player projections refresh from authoritative state

If the commit fails, the DM preview rolls back to the last authoritative state and an error is surfaced.

`Esc` cancels an in-progress local stroke.

Leaving Fog Mode discards any uncommitted preview.

---

# 6. DM Fog Mode

Fog editing is a dedicated **DM-only board mode**.

While Fog Mode is active:

- normal token dragging is suppressed
- terrain/object manipulation is suppressed
- pan/zoom remains available
- fog brush input owns board painting gestures

The compact Fog Mode toolbar groups:

- Reveal / Hide mode
- brush size
- named areas
- fog-management overlay opacity
- Reveal All
- Hide All
- Reset to Defaults
- Disable/Enable Fog

The DM always sees the complete map while editing.

Player-hidden cells are represented with a translucent dark management overlay rather than actually hiding content from the DM.

The hidden/revealed frontier uses a thin Aure Relics gold boundary on the DM screen only.

Selected named areas receive a subtle boundary highlight.

---

# 7. Safety Confirmations

Routine live-play operations remain fast.

No confirmation is required for:

- ordinary Reveal/Hide brush strokes
- Reveal Area
- Hide Area

Confirmation is required for:

- Reveal All
- Hide All
- Reset to Defaults
- Disable Fog when players are currently connected

Connected-player Disable Fog is treated specially because it can expose the entire base map immediately.

---

# 8. Player Projection and Security Boundary

## 8.1 Active-level projection only

Players receive fog presentation state only for the **currently presented level**.

They do not receive masks for every level in the campaign.

When the shared table moves to another level, that level's current authoritative projection is delivered then.

## 8.2 Protected data omitted entirely

Player snapshots must not contain:

- named fog-area definitions
- area names
- area default metadata
- DM overlay/management state
- hidden entity records
- hidden trap/hazard/secret metadata
- DM private notes
- unrevealed secret-object metadata

These are omitted server-side, not merely hidden with CSS or renderer conditions.

## 8.3 Compact fog-mask transport

The database may continue using individual `fog_cells`, but the player projection should serialize the active-level mask compactly, such as row runs/ranges or an equivalent compact representation.

The player renderer may expand the compact mask locally.

The design must avoid transmitting one large `{x,y}` object per cell on maximum-size boards.

## 8.4 Base map asset boundary

In v0.9, base map/theme artwork is presentation content, not a cryptographically/transport-secure secret asset.

It may already exist on the player device and is visually concealed by the authoritative fog mask.

Therefore anything that must remain truly secret must be a separate DM-controlled object/layer rather than permanently baked into the base map image.

Examples:

- secret doors
- trap glyphs
- hidden passage markers
- treasure markers
- concealed entrances

A future v1.x secure-map mode may add tiled/progressive asset delivery when even underlying painted map art must remain unretrievable before exploration.

---

# 9. Player Fog Rendering

Hidden cells are fully content-opaque to players.

No protected content may bleed through via:

- color
- silhouette
- texture sampling
- shadow
- token edge
- effect edge
- scenery edge

The hidden layer uses a dark charcoal/black fantasy fog treatment with restrained texture/variation rather than a flat black slab.

Revealed boundaries may use soft feathering for polish, but feathering must never sample or reveal protected underlying content outside the authoritative mask.

The Aure Relics gold management frontier is **DM-only** and does not render on Player Screens.

Authoritative reveal/hide changes may use a short restrained fade transition. Animation is presentation-only and must not delay authorization or leave protected content visible during transitions.

DM Player Preview must use the exact same player mask/rendering path as the real Player Screen.

---

# 10. Object Disclosure Contract

Fog visibility and object disclosure are separate gates.

A player-visible DM-controlled object requires:

1. DM disclosure permits it, and
2. fog spatial visibility permits presentation at its location

Revealing fog alone never counts as discovery.

Disabling fog alone never counts as disclosure.

Before creating a concealable gameplay object, Issue #11's placement flow must choose **Hidden / Visible to Players before placement begins**, so a hidden object never flashes briefly onto the live Player Screen and then disappears after the DM clicks Hide.

Hidden placement previews remain DM-only.

This contract is intentionally shared with later Issue #11 systems.

---

# 11. DM Editing Context Versus Shared Presentation Context

Every fog mutation targets an explicit `level_id`.

Editing a level's fog must never implicitly switch the level currently presented to players.

Architectural rule:

> **DM editing context is distinct from shared table presentation context.**

For v0.9 the UI may focus Fog Mode on the currently loaded level, but the backend should support authorized mutations against any valid campaign level.

This prepares the architecture for Issue #13 and later prep workflows.

If the DM edits fog on a non-presented level:

- changes persist normally
- current player clients do not shift levels
- current player clients do not receive that unrelated level's mask
- when the shared table later moves to that level, clients receive its then-current authoritative fog state

Named fog areas remain level-specific.

---

# 12. Realtime Lifecycle

Fog uses the existing Issue #8/#9 realtime architecture.

Do **not** create:

- a second websocket/channel lifecycle
- a parallel authorization mechanism
- a standalone fog event bus

One successful authoritative fog mutation results in one logical board revision/update through the existing lifecycle.

Player clients rehydrate the authorized projection from authoritative state.

Fog events are not the source of truth. The current snapshot is the source of truth.

---

# 13. Recovery and Failure Behavior

## 13.1 Disconnect during local preview

An uncommitted local brush preview is disposable.

If connection is lost before commit, discard it.

## 13.2 Server succeeds, response is lost

If the server committed but the client loses the response, reconnect/rehydration returns the authoritative committed state.

The client must not automatically replay an uncertain fog mutation.

Automatic replay could apply an old visibility intention against newer board state and reveal unintended cells.

## 13.3 Stale revisions

Fail closed:

- reject
- rehydrate
- discard preview
- require intentional retry

## 13.4 Player reconnect

A reconnecting player receives the current authorized mask for the presented level.

The client does not need a replay history of fog events.

## 13.5 Projection/authorization failure

Player visibility must fail closed.

If the authorized fog projection cannot be established, protected map/entity content remains concealed rather than falling back to an unmasked board.

---

# 14. v1.x Follow-ups

The following are deliberately deferred:

## 14.1 Exploration memory

Optional third visibility state such as "previously explored but currently obscured."

## 14.2 Discovery cue / mystery marker

DM-placeable narrative cue that encourages players to investigate without revealing the underlying secret.

Possible treatments:

- faint glowing orb
- lightly glowing outline
- restrained Aure Relics mystery cue

The cue is non-authoritative and reveals no hidden metadata by itself.

## 14.3 Secure map asset delivery

Optional tiled/progressive delivery for maps where even the painted background itself must remain unavailable before exploration.

---

# 15. Verification Gates

Issue #10 is not complete until the following categories pass.

## 15.1 Database and security

Verify:

- non-DM cannot mutate fog
- player cannot read private named areas
- cross-campaign mutation rejected
- invalid/cross-level mutation rejected
- out-of-bounds cells rejected
- stale revision rejected
- failed batch rolls back atomically
- anonymous/guest player cannot obtain DM mutation authority

## 15.2 Projection

Verify:

- player receives only the currently presented level's fog mask
- named-area metadata is absent
- hidden entity/secret metadata is absent
- DM private notes remain absent
- Disable Fog exposes base map visibility but not DM-hidden objects
- compact mask reconstructs exactly

## 15.3 Three-client realtime

Use:

- DM
- Player A
- Player B

Verify:

- brush preview stays DM-only
- committed stroke reaches both players only after commit
- Reveal/Hide Area syncs correctly
- Reveal All syncs correctly
- Hide All syncs correctly
- Reset to Defaults syncs correctly
- Disable/re-enable preserves stored state
- reconnect restores exact current state
- non-presented-level changes do not leak to current players

## 15.4 Maximum-board performance

Test a 200x200 level.

Verify:

- large brush strokes remain responsive
- Reveal All remains bounded and atomic
- Hide All remains bounded and atomic
- Reset remains bounded and atomic
- projection payload is compact
- no per-cell realtime storm occurs

## 15.5 Visual leak tests

Place deliberately obvious hidden content beneath fog and at fog edges.

Verify no leak through:

- color
- silhouette
- feathering
- effects
- tokens
- scenery

Verify:

- disclosed area effects clip at fog boundary
- disclosed discrete creature/object renders whole once spatially exposed
- gold management frontier appears only to DM
- Player Preview matches actual Player Screen mask behavior

## 15.6 Regression gates

Existing Issue #8 and Issue #9 guarantees remain intact.

At minimum:

- existing realtime tests remain green
- existing role/projection/security tests remain green
- DM/player visibility tests remain green
- build passes
- no new direct player access to protected fog/private tables exists

---

# 16. Acceptance Summary

The v0.9 Fog of War system is complete when:

- DM controls fog and players never do.
- Hidden/Revealed are the only v0.9 fog states.
- Level fog persists across sessions.
- Level → Location → Campaign inheritance works.
- New fog-enabled levels start Hidden except Revealed-by-Default named areas.
- Hidden-by-Default wins overlaps during Reset.
- DM can paint Reveal/Hide with 1x1, 2x2, 3x3, and 5x5 brushes.
- Shift temporarily inverts the active brush.
- Brush drag previews locally and commits atomically on release.
- Named areas are saved selections with Hidden/Revealed/Mixed derived status.
- Editing an area does not silently change live fog.
- Reveal All, Hide All, Reset, and connected-player Disable Fog use safety confirmation.
- Fog mutations are server-authorized and stale-revision protected.
- Players receive only compact active-level authorized fog presentation state.
- Protected hidden gameplay metadata is omitted from player projections entirely.
- Base map art is visually concealed but not treated as a secure secret asset in v0.9.
- Fog and DM object disclosure remain independent gates.
- Player-hidden cells are fully content-opaque.
- DM always sees the full board with management overlays.
- Player Preview uses the real player rendering path.
- Non-presented level editing never changes the shared presentation context.
- Fog uses the existing realtime lifecycle.
- Disconnect/reconnect and stale-state behavior fail closed.
- Maximum-size boards avoid per-cell network/update storms.
- Existing realtime/security/visibility guarantees remain green.

No implementation should begin until this written design is reviewed and explicitly approved.