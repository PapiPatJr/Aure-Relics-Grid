# Aure Relics V2 Milestone 2: Relic Workspace Design

Date: 2026-10-01
Branch: `v2-workspace`
Baseline implementation: `6e344ac135d0f40a1220e5b2862af15ef329715b`
Status: Design specification for user review before implementation planning

## 1. Objective

Transform the proven Workspace V2 shell from a functional developer prototype into a recognizable Aure Relics product without changing the interaction architecture that already tested well on desktop, Surface/tablet, and phone.

Milestone 2 is a visual-system and interaction-polish milestone. It does not add multiplayer lifecycle features, Supabase schema changes, campaign persistence, or new combat systems.

The intended result is a professional dark-fantasy tabletop workspace that feels like Aure Relics while preserving the board-first, art-application-style workflow established in Milestone 1.

## 2. Roadmap Position

The original Workspace V2 design placed the playable session bridge immediately after the Canvas V2 proof. The approved eight-milestone roadmap now inserts a visual identity milestone first:

1. Canvas V2 Foundation - complete
2. Relic Workspace - this specification
3. Party, Character & Session Bridge
4. Combat Workspace
5. Map & Encounter Design
6. Player Movement & Interaction
7. Campaigns, Persistence & Real Multiplayer
8. Closed Beta Hardening

This sequencing does not remove any multiplayer requirement. It gives later systems a stable visual language and reusable component states before more behavior is layered onto the workspace.

## 3. Proven Interaction Architecture Must Remain Stable

Milestone 1 manual staging tests established that zoom, drag/pan, general control placement, and responsive behavior feel good across desktop, Surface/tablet, and phone.

Milestone 2 must preserve:

- board-first layout
- one shared camera/world transform
- top command bar
- dropdown panel behavior
- dock-left and dock-right panel behavior
- floating panels
- minimized panels
- movable/collapsible radial quick-tool control
- wheel zoom
- middle-mouse pan
- Space + drag pan
- touch pinch/pan
- responsive desktop/tablet/phone behavior

Visual work must not quietly redesign these interactions.

## 4. Visual Direction

The visual language is `dark relic-workbench` rather than parchment fantasy, neon game UI, or generic gray dashboard.

Core character:

- blackened stone and charcoal workspace surfaces
- forged-metal depth
- aged bronze and restrained gold for Aure Relics identity
- warm ivory for primary readable text
- muted cool grays for secondary information
- subtle arcane violet for magical/selection emphasis where useful
- controlled crimson for hostile/danger states
- muted emerald or teal for allied/positive states

The product should feel atmospheric without becoming decorative at the expense of legibility.

Fantasy styling belongs mainly in branding, borders, key states, and headings. Functional controls remain compact and readable.

## 5. Design Tokens and CSS Architecture

Milestone 2 should introduce a small reusable visual token layer in `workspace.css` using CSS custom properties rather than repeating literal colors throughout the stylesheet.

At minimum define tokens for:

- workspace background
- raised surface
- inset surface
- border/subtle border
- bronze accent
- bright gold accent
- primary text
- secondary text
- muted text
- selection/arcane accent
- ally/success accent
- danger/enemy accent
- boss accent
- focus ring
- shadow strengths
- corner radii
- transition timing

No CSS framework is required. Do not add a dependency solely for theming.

## 6. Top Command Bar

Keep the existing information architecture:

`AURE RELICS | Party | Encounter | Tokens | Terrain | Map | Fog | Measure | Notes | Session | View`

Refine presentation with:

- stronger Aure Relics brand treatment
- subtle forged/stone depth
- bronze separators or restrained ornament
- distinct hover, focus, and open/active states
- readable compact labels on desktop
- preserved horizontal overflow behavior where necessary
- compact mobile behavior without sacrificing touch targets

Do not turn the top bar into a large banner. Board area remains the priority.

A future crest/logo may be added when approved artwork exists, but Milestone 2 must not depend on professional art.

## 7. Panel System

All current panel modes remain functional.

Panels should receive a unified Aure Relics surface treatment:

- forged/dark card surface
- subtle inner depth
- bronze or aged-metal trim
- visually separated header
- stronger heading hierarchy
- cleaner action buttons
- intentional body spacing
- styled form controls where present
- styled scrollbars where supported
- clear keyboard focus states

Panel layout actions must remain obvious enough to use without memorization:

- dock left
- dock right
- float
- minimize
- close

Existing symbols may be improved if the implementation can do so without adding a new icon dependency.

## 8. Canvas and Empty-Board Presentation

The empty board should feel intentional rather than like a black rectangle.

Use low-cost rendering techniques:

- dark board base
- subtle board vignette
- restrained surface texture using CSS gradients and/or Konva primitives
- clearer world boundary
- minor grid lines quieter than major grid lines
- major grid interval emphasis retained
- enough contrast for token readability

The canvas background must remain visually subordinate to maps, terrain, fog, tokens, and measurements.

Do not use large decorative background images in this milestone.

## 9. Token Placeholder Visual Language

Professional token art is not required in Milestone 2. Placeholder rendering should nevertheless communicate role clearly.

Target user-facing taxonomy and visual language:

- Character: warm gold with a restrained cool/hero accent
- Ally: emerald/bronze
- NPC: neutral silver/green
- Enemy: dark crimson
- Boss: heavier crimson/black treatment with stronger presence

Current backend `player` tokens may continue rendering as Character placeholders for compatibility until Milestone 3 introduces the explicit Character/Ally identity flow.

Milestone 2 must not introduce backend taxonomy migrations.

Token rendering should improve:

- border/ring hierarchy
- initials/label readability
- contrast
- selection-ready styling hooks
- visibility-state treatment

Do not implement combat logic or ownership behavior in this milestone.

## 10. Radial Quick-Tool Menu

Preserve the movable/collapsible radial interaction that already works.

Visual treatment:

- center control resembles a compact Aure Relics seal/medallion
- surrounding tool buttons feel related to the same control family
- selected state is clear
- touch targets remain generous
- labels may be represented with simple inline symbols or lightweight local icon treatment, but no external icon framework is required

Functional refinement required in Milestone 2:

- fix the known edge-clipping problem when expanded near viewport edges
- clamp the expanded footprint, not only the center button
- maintain usability after resize/orientation changes

If persistence of radial position can be added as local browser-only presentation state without broadening scope or changing shared multiplayer state, it may be included. It is not required for milestone completion.

## 11. Camera Controls

Keep the existing location and behavior:

- zoom out
- zoom percentage/reset
- zoom in
- Fit
- Hand/Pan

Restyle them as one coherent compact instrument rather than isolated buttons.

Requirements:

- strong pressed state for Hand/Pan
- readable zoom percentage
- touch-friendly hit targets
- compact mobile footprint
- visible keyboard focus

The known `Fit` assumption of a 40x40 board is not a visual defect. Fixing dynamic Fit belongs in a separate bounded technical task unless implementation work in this milestone directly exposes the necessary scene bounds without architectural spillover.

## 12. Typography

Use locally available/bundled fonts where practical and avoid network font dependencies.

Typography should use two roles:

1. Display/brand face for Aure Relics branding and selected headings
2. Highly readable UI sans for controls, forms, measurements, and dense information

Fantasy styling must not reduce functional legibility.

If no suitable local display face is already bundled, use a safe serif/system fallback rather than adding a font dependency during this milestone.

## 13. Motion and Feedback

Motion should support orientation and state, not decorate constantly.

Allowed examples:

- panel open/close transition
- hover/focus transition
- active-tool illumination
- radial expand/collapse
- token selection-ready ring transition

Avoid:

- constant pulsing
- excessive glow
- animated backgrounds
- large ornamental transitions

Respect `prefers-reduced-motion` for nonessential motion.

## 14. Accessibility and Input Safety

Milestone 2 styling must preserve or improve:

- keyboard focus visibility
- semantic button behavior
- ARIA labels already present
- contrast for text and controls
- touch hit areas
- mobile readability
- reduced-motion preference

No visual treatment may hide a control's state solely in color where another visible state can reasonably be provided.

## 15. Responsive Rules

Manual testing already validated the basic responsive shell. Milestone 2 must refine appearance without regressing behavior.

Desktop:

- full command bar
- docked/floating panels retain visual hierarchy
- camera and radial controls remain unobtrusive

Surface/tablet landscape:

- top bar remains compact
- overlays do not consume unnecessary canvas area
- touch targets remain comfortable

Surface/tablet portrait:

- panel sheets/overlays remain readable
- no tiny typography
- radial and camera tools avoid edge collisions

Phone portrait/landscape:

- board remains primary
- command bar remains usable by horizontal overflow or compact treatment
- panels remain sheet-like rather than recreating fixed rails
- controls must not stack into unusable clusters

## 16. File Boundaries

Expected primary files:

- `src/workspace-v2/workspace.css`
- `src/workspace-v2/workspaceChrome.js`
- `src/workspace-v2/radialMenu.js`
- `src/workspace-v2/stage.js`

Possible narrow change:

- `src/workspace-v2/main.js` only if camera-control markup/classes need a styling hook that cannot be added safely elsewhere

Focused tests may be added or updated under existing Workspace V2 unit/E2E test files.

Milestone 2 must not modify:

- production Netlify configuration
- hosted production Supabase state
- migrations
- legacy/live board entry points
- authentication policy
- realtime authority rules
- session lifecycle behavior

## 17. Worker Model

Milestone 2 should deliberately use lower-cost specialist workers instead of defaulting to Work/Codex.

Recommended lanes after implementation planning:

### Builder lane

Claude or Copilot performs the primary visual implementation from a tightly bounded prompt and declared file ownership.

### Interaction-fix lane

A separate worker may handle the radial edge-clamping defect if its files are isolated from the primary builder. If file ownership overlaps, sequence this work rather than parallelize it.

### Automated verifier lane

Use deterministic tests, project checks, build, and protected-file audit before spending another AI pass on routine verification.

### Independent review lane

Use CodeRabbit and/or a fresh-context reviewer after the implementation package is complete.

### Escalation lane

Use Codex only for difficult technical findings, non-obvious regressions, or test failures the primary builder cannot resolve efficiently.

No two workers should concurrently edit the same files.

## 18. Testing Strategy

Focused automated verification should cover at minimum:

- top-bar controls remain available
- panels still open/close
- dock-left/dock-right/float/minimize behavior survives styling
- radial menu expand/collapse survives styling
- radial expanded footprint remains on-screen near all edges
- camera controls retain behavior
- responsive shell still mounts at representative viewport widths
- no unintended change to route behavior

Milestone gate:

- V2 focused unit tests pass
- V2 E2E tests pass, except explicitly documented intentional skips
- project check passes
- production build passes
- protected-file/isolation audit passes
- working tree clean
- independent review findings resolved or explicitly accepted

Do not require full legacy E2E after every visual iteration. Run broader regression at the milestone gate.

## 19. Staging and Manual Acceptance

After the automated milestone gate, deploy only to the separate V2 staging site.

Manual device acceptance:

- desktop mouse/keyboard
- Surface/tablet touch in landscape
- Surface/tablet touch in portrait
- phone portrait
- phone landscape where practical

Manual checks:

- zoom still feels correct
- drag/pan still feels correct
- top bar placement still feels correct
- panels remain readable and controllable
- radial menu is attractive and cannot clip off-screen
- camera controls are compact and readable
- visual identity clearly reads as Aure Relics rather than generic developer tooling
- board remains the dominant surface

Staging feedback may drive small visual adjustments before Milestone 2 is closed.

## 20. Non-Goals

Milestone 2 does not implement:

- Ready / Not Ready
- DM Start Session
- Character Token ownership
- Ally backend kind
- initiative system changes
- combat HUD logic
- terrain authoring
- map scene themes beyond the base visual workspace treatment
- fog authoring behavior
- player movement rules
- campaign persistence
- new Supabase schemas
- production deployment
- professional commissioned art

These remain later milestones.

## 21. Success Criteria

Milestone 2 is complete when:

- Workspace V2 still behaves like the proven Milestone 1 interaction model
- desktop, Surface/tablet, and phone remain usable
- the interface has a coherent Aure Relics visual identity
- generic gray developer-tool presentation is gone
- panels, command bar, camera controls, canvas, and radial menu share one design language
- placeholder token roles are visually distinguishable
- the radial edge-clipping defect is fixed
- accessibility/focus/touch behavior is not regressed
- no multiplayer/backend/production behavior is altered
- milestone verification passes
- staging manual acceptance is completed

## 22. Promotion Rule

Milestone 2 changes remain on `v2-workspace` and the separate V2 staging site.

They do not replace the current playable table and do not merge to the production path without a later explicit promotion decision.