# Aure Relics Digital Tabletop Grid

A lightweight browser-based tabletop grid for Dungeons & Dragons and other grid-based RPGs.

Aure Relics Digital Tabletop Grid is built for DMs who want a clean visual battle map on a TV, monitor, tablet, or shared screen while keeping the feel of in-person tabletop play.

> **Current status:** Alpha / Release Candidate  
> The app is actively being tested and expanded.

---

## What It Does

Aure Relics Digital Tabletop Grid helps DMs:

- build simple encounter maps
- track player, enemy, NPC, and boss tokens
- save and load scenes
- manage compact combat HUD cards
- track initiative and active turns
- hide or show enemy information at the DM's discretion

The app runs directly in the browser with plain HTML, CSS, and JavaScript.

No install, account, backend, or build process is currently required.

---

## Core Features

### Battle Grid

- Responsive grid layout for desktop, tablet, mobile, and large displays
- Custom grid dimensions
- Click-and-drag painting
- Brush sizes: `1x1`, `2x2`, and `3x3`
- Grid scaling designed for small screens and large monitor/TV display

### Tools

- **Void Fill** for blocked-off, hidden, or inaccessible map space
- **Erase** for clearing void fill, terrain, and tokens
- Clear Grid confirmation to prevent accidental wipes

### Tokens

Supported token types:

- Players: `P1`, `P2`, etc.
- Enemies: `E1`, `E2`, etc.
- NPCs: `N1`, `N2`, etc.
- Bosses: `B1`, `B2`, etc.

Tokens can be placed on the grid, moved by drag-and-drop, and linked to HUD cards.

### Compact HUD Cards

The app uses compact side HUD cards instead of large form-style character panels.

Player HUD cards can show:

- token ID
- character name
- class / role
- current HP
- max HP
- temporary HP
- health bar
- active status or buff references
- active-turn glow and shimmer

Enemy, NPC, and boss cards can show:

- token ID
- name
- type
- optional HP
- optional status/debuff
- optional buff
- active-turn glow and shimmer

Bosses use a stronger red visual style and are prioritized in the opponent rail.

### DM Visibility Controls

Enemy, NPC, and boss details can be entered privately.

The DM can choose whether table view shows:

- HP
- status/debuff
- buff

This lets the DM track enemy details without revealing everything to players.

### Initiative Tracker

The Combat Tracker supports:

- manual initiative entry
- sorted turn order
- compact turn list
- Next Turn control
- active turn highlighting
- grouped initiative
- initiative tie breaker
- removable initiative entries
- collapsible initiative setup section

When a turn is active, the app highlights:

- the token on the grid
- the matching HUD card
- the matching initiative row

### Terrain

Current terrain tools include:

- Tree
- Rock
- Fire
- Door
- Water
- House
- Stairs
- Chest

Current terrain is grid-based. Freeform terrain objects are planned.

### Scene Saving and Loading

Scenes save locally in the browser.

A saved scene can include:

- grid size
- void fill
- terrain
- token placement
- character names
- class / role
- HP and temp HP
- status and buff data
- enemy visibility settings
- initiative data
- current turn position

---

## How to Use

1. Open the app in a modern web browser.
2. Set the grid size if needed.
3. Use **Void Fill** and terrain tools to shape the map.
4. Place player, enemy, NPC, and boss tokens.
5. Use the cog buttons on HUD cards to enter details.
6. Save the scene.
7. Enter initiative values.
8. Click **Sort Initiative**.
9. Collapse Initiative Setup to reduce clutter.
10. Use **Next Turn** during combat.

For a more detailed walkthrough, see:

```text
Aure-Relics-Tutorial.md
```

---

## Project Files

```text
index.html
style.css
script.js
README.md
Aure-Relics-Tutorial.md
images/
  Logo-symbol.png
  Logo-banner.png
```

---

## Local Storage

Saved scenes are stored in the browser using `localStorage`.

This means:

- each browser/device has its own saved scenes
- clearing browser storage may delete saved scenes
- private/incognito windows may not keep scenes
- saved scenes do not sync between devices yet

---

## Current Limitations

The current version does not yet include:

- freeform draggable terrain
- resizable tree canopies
- stone formations or large rock objects
- grid-line wall and door construction
- AoE templates
- line of sight tools
- cone/radius/line attack overlays
- multiplayer hosting
- cloud scene storage

---

## Roadmap

### Near-Term

- Add in-app tutorial panel
- Improve visual polish and theme cohesion
- Continue responsive testing across phones, tablets, desktops, and TV displays
- Improve terrain visuals
- Add more terrain options

### Advanced Map Tools

- Freeform draggable/resizable terrain objects
- Tree canopies
- Boulders and rock formations
- Structure tools for walls and doors on grid lines
- Dungeon and building construction helpers

### Tactical Overlay Tools

- AoE circles
- Cones
- Line attacks
- Square/cube templates
- Line of sight
- Range ruler
- Temporary markers
- Clear overlays button

### Future Systems

- Fog of war
- Fullscreen/player-facing mode
- Image-based tokens
- Image-based terrain
- Multiplayer host/player sessions
- Player join system
- Scene import/export

---

## Testing Feedback

Useful testing areas:

- save/load reliability
- multiple grid sizes
- large-grid scaling
- mobile layout
- iPad/tablet layout
- TV/monitor display
- initiative grouping
- active-turn highlighting
- enemy visibility controls
- scene overwrite prevention
- token movement
- HUD readability

---

## License

MIT License
