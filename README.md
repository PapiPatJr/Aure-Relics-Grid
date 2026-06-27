# Aure Relics Digital Tabletop Grid

A lightweight browser-based tabletop grid for Dungeons & Dragons and other grid-based RPGs.

Aure Relics Digital Tabletop Grid is built for DMs who want a clean visual battle map on a TV, monitor, tablet, or shared screen while keeping the feel of in-person tabletop play.

> **Current status:** v0.5.2-alpha / Release Candidate  
> This build focuses on terrain, scene themes, offline readiness, and updated documentation.

---

## What It Does

Aure Relics Digital Tabletop Grid helps DMs:

- build simple encounter maps
- track player, enemy, NPC, and boss tokens
- save and load scenes
- manage compact combat HUD cards
- track initiative and active turns
- hide or show enemy information at the DM's discretion
- place grid terrain and freeform terrain objects
- choose battlefield background themes
- keep session notes and recent history
- export and import local backup files

The app runs directly in the browser with plain HTML, CSS, and JavaScript.

No account, backend, cloud service, or build process is currently required.

---

## Offline Play

The app is designed to work offline after the project folder is downloaded.

The release folder should include:

```text
index.html
style.css
script.js
README.md
Aure-Relics-Tutorial.md
images/
  Logo-symbol.png
  Logo-banner.png
fonts/
  Cinzel-VariableFont_wght.ttf
  Spectral-Regular.ttf
  Spectral-SemiBold.ttf
  Spectral-Bold.ttf
  LICENSE-Cinzel-OFL.txt
  LICENSE-Spectral-OFL.txt
  README-FONTS.md
```

The app should not require online fonts, CDN scripts, hosted images, or external assets.

### Local Fonts

The CSS is wired for these exact local `.ttf` font files in the `/fonts/` folder. This keeps the same Aure Relics look offline instead of falling back to generic fonts.

If any listed font file is missing, the browser will use fallback serif fonts for that weight. The app still works, but the visual style will not fully match the intended offline release.

---

## Core Features

### Battle Grid

- Responsive grid layout for desktop, tablet, mobile, and large displays
- Custom grid dimensions
- Click-and-drag painting
- Brush sizes: `1x1`, `2x2`, and `3x3`
- Grid scaling designed for small screens and large monitor/TV display
- Grid frame hugs the active grid instead of wasting dead space

### Tools

- **Void Fill** for blocked-off, hidden, or inaccessible map space
- **Erase** for clearing void fill, terrain, freeform objects, and tokens
- Clear Grid confirmation to prevent accidental wipes

### Tokens

Supported token types:

- Players: `P1`, `P2`, etc.
- Enemies: `E1`, `E2`, etc.
- NPCs: `N1`, `N2`, etc.
- Bosses: `B1`, `B2`, etc.

Tokens can be placed on the grid, moved by drag-and-drop, and linked to HUD cards.

### Compact HUD Cards

Player HUD cards can show:

- token ID
- character name
- class / role
- current HP
- max HP
- temporary HP
- health bar
- active status or buff references
- active-turn glow

Enemy, NPC, and boss cards can show:

- token ID
- name
- default type label
- optional class / role label
- optional HP
- optional status/debuff
- optional buff
- active-turn glow

Bosses use a stronger red visual style and are prioritized in the opponent rail.

### DM Visibility Controls

Enemy, NPC, and boss details can be entered privately.

The DM can choose whether table view shows:

- class / role
- HP
- status/debuff
- buff

If class / role is filled in but **Show class/role** is unchecked, the card continues to show the default type such as `ENEMY`, `NPC`, or `BOSS`.

### Initiative Tracker

The Combat Tracker supports:

- manual initiative entry
- sorted turn order
- compact turn list
- Next Turn control
- active turn highlighting
- grouped initiative setup
- initiative tie breaker
- removable initiative entries
- death/skull removal from initiative
- collapsible Turn Order and Initiative Setup sections

When a turn is active, the app highlights:

- the token on the grid
- the matching HUD card
- the matching initiative row

### Terrain

Terrain now includes two layers:

1. **Grid terrain markers** for simple square-based icons.
2. **Freeform terrain objects** for larger draggable/resizable battlefield pieces.

Grid terrain tools include:

- Tree
- Rock
- Fire
- Door
- Water
- House
- Stairs
- Chest

Freeform terrain objects include:

- Tree Canopy
- Boulder
- Stone Formation
- Brush Thicket
- Ruined Wall
- Stone Pillar
- Crate Stack
- Pond / Pool

Freeform objects can be dragged, resized, erased, saved, loaded, exported, and imported.

### Scene Themes

The battlefield can use different background themes:

- Relic Default
- Stone Dungeon
- Forest Floor
- Sand / Desert
- Ice Field
- Hell / Ember
- City / Cobblestone

Scene themes affect the battlefield/grid presentation while keeping the Aure Relics header and brand identity consistent.

### Scene Saving and Loading

Scenes save locally in the browser.

A saved scene can include:

- grid size
- battlefield theme
- void fill
- grid terrain
- freeform terrain objects
- token placement
- character names
- class / role
- HP and temp HP
- status and buff data
- enemy visibility settings
- initiative groups
- initiative data
- current turn position

### Backup Export / Import

The app can export saved scenes, DM notes, and history into a local JSON backup file.

Use this before clearing browser data, moving to another device, or testing a new release.

---

## How to Use

1. Open `index.html` in a modern web browser.
2. Set the grid size if needed.
3. Choose a battlefield theme if desired.
4. Use **Void Fill** and terrain tools to shape the map.
5. Place player, enemy, NPC, and boss tokens.
6. Use the cog buttons on HUD cards to enter details.
7. Save the scene.
8. Enter initiative values or prepare groups.
9. Click **Sort Initiative**.
10. Use **Next Turn** during combat.

For a more detailed walkthrough, see:

```text
Aure-Relics-Tutorial.md
```

---

## Local Storage

Saved scenes are stored in the browser using `localStorage`.

This means:

- each browser/device has its own saved scenes
- clearing browser storage may delete saved scenes
- private/incognito windows may not keep scenes
- saved scenes do not sync between devices yet
- offline save/load still works in the same browser profile

Use **Export Backup** to protect your work.

---

## Current Limitations

The current version does not yet include:

- grid-line wall and door construction
- AoE templates
- line of sight tools
- cone/radius/line attack overlays
- multiplayer hosting
- cloud scene storage
- full campaign folder system
- player-facing host/join mode

---

## Roadmap

### Near-Term

- Continue terrain visual improvement
- Improve scene theme polish
- Add campaign folders
- Improve backup and restore messaging
- Continue responsive testing across phones, tablets, desktops, and TV displays

### Advanced Map Tools

- Walls and doors on grid lines
- Dungeon and building construction helpers
- Image-based terrain
- Image-based tokens
- Hidden/revealed objects and traps

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
- Multiplayer host/player sessions
- Player join system
- Campaign import/export

---

## Testing Checklist

Useful testing areas:

- offline loading with internet disabled
- local fonts present in `/fonts/`
- save/load reliability
- export/import backup reliability
- multiple grid sizes
- large-grid scaling
- mobile layout
- iPad/tablet layout
- TV/monitor display
- initiative grouping
- active-turn highlighting
- death/skull initiative removal
- enemy visibility controls
- scene overwrite prevention
- token movement
- freeform terrain movement/resizing
- theme save/load behavior
- HUD readability

---

## License

MIT License
