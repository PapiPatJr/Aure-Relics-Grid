# Aure Relics Digital Tabletop Grid Tutorial

This guide explains how to use the current Aure Relics Digital Tabletop Grid release.

The app is designed for DMs who want a simple visual battle map for in-person tabletop play, TV display, shared monitor use, or light digital encounter tracking.

---

## 1. Offline Setup

The app is built to run from local files.

Recommended release folder:

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

To play offline:

1. Download or copy the full project folder.
2. Keep `index.html`, `style.css`, `script.js`, `/images`, and `/fonts` together.
3. Open `index.html` in a modern browser.
4. Save/load scenes normally in that browser profile.

If any `/fonts` file listed above is missing, the app still works, but that font weight may fall back to system fonts. For release, keep all four `.ttf` files and both license files in `/fonts`.

---

## 2. Tools

The **Tools** section controls basic map editing.

### Void Fill

Use **Void Fill** to black out grid spaces.

Good uses:

- blocked-off rooms
- unexplored space
- map edges
- cliffs, pits, or unreachable terrain
- hidden areas the party should not use

How to use:

1. Click **Void Fill**.
2. Click a grid square to fill it black.
3. Click and drag to paint multiple squares.
4. Use **Brush Size** to fill larger areas faster.

### Erase

Use **Erase** to remove content.

Erase can remove:

- void fill
- grid terrain icons
- freeform terrain objects
- tokens

Be careful: erasing a token removes that combatant from the HUD and initiative tools.

---

## 3. Scene Theme

Use **Scene Theme** to change the battlefield background.

Available themes:

- Relic Default
- Stone Dungeon
- Forest Floor
- Sand / Desert
- Ice Field
- Hell / Ember
- City / Cobblestone

How to use:

1. Open **Scene Theme**.
2. Choose a battlefield background.
3. Build or load your scene.
4. Save the scene to preserve the selected theme.

Scene themes affect the battlefield and grid, not the Aure Relics header or core brand colors.

---

## 4. Tokens

Tokens represent players, enemies, NPCs, and bosses on the grid.

Token types:

- **Player**: `P1`, `P2`, `P3`, etc.
- **Enemy**: `E1`, `E2`, `E3`, etc.
- **NPC**: `N1`, `N2`, `N3`, etc.
- **Boss**: `B1`, `B2`, `B3`, etc.

### Placing Tokens

1. Click a token type in the left panel.
2. Click an empty grid square.
3. The app auto-labels the token.
4. The matching HUD card appears automatically.

### Moving Tokens

1. Click and drag a token.
2. Drop it onto another empty grid square. Dropping onto an occupied square leaves both tokens in their original positions.
3. The HUD and initiative tools stay connected to that token.

---

## 5. HUD Cards

Player cards appear on the left side of the battle area.

Enemy, NPC, and boss cards appear on the right side.

Use the cog button to edit:

- name
- class / role
- current HP
- max HP
- temporary HP
- status
- buff / debuff
- table visibility options

### Enemy Visibility

For enemies, NPCs, and bosses, the DM can choose what appears to players:

- Show class/role
- Show HP
- Show status/debuff
- Show buff

If **Show class/role** is checked and a class/role is entered, it replaces the default label on the card.

Example:

```text
E1 Goblin    ENEMY
```

With class/role `Archer` and Show class/role checked:

```text
E1 Goblin    ARCHER
```

### Death / Skull Button

Use the skull/death control on a HUD card to mark a combatant dead and remove it from initiative.

The combatant stays on the grid as a dead/greyed-out marker until restored or erased.

---

## 6. Terrain

The **Terrain** section has two types of terrain.

### Grid Terrain

Grid terrain is placed directly inside a square.

Grid terrain tools include:

- Tree
- Rock
- Fire
- Door
- Water
- House
- Stairs
- Chest

How to use:

1. Click a terrain tool.
2. Click a grid square.
3. The icon appears on that square.
4. Use Erase to remove it.

### Freeform Terrain

Freeform terrain creates larger objects that can be moved and resized.

Freeform terrain objects include:

- Tree Canopy
- Boulder
- Stone Formation
- Brush Thicket
- Ruined Wall
- Stone Pillar
- Crate Stack
- Pond / Pool

How to use:

1. Click a freeform terrain tool.
2. Click the grid to place it.
3. Drag the object to move it.
4. Drag the corner handle to resize it.
5. Use Erase and click the object to remove it.

Freeform terrain saves and loads with the scene.

---

## 7. Brush Size

Brush Size controls how many grid squares are affected when painting void fill, erasing, or placing grid terrain.

Options:

- `1x1`
- `2x2`
- `3x3`

Use larger brush sizes for filling or clearing large areas quickly.

---

## 8. Scenes

Scenes let you save and reload maps.

A scene can include:

- grid size
- selected battlefield theme
- void fill
- grid terrain
- freeform terrain
- tokens
- names
- HP and temp HP
- class / role
- status and buff data
- enemy/boss visibility settings
- initiative groups
- initiative entries
- current turn position

### Saving a Scene

1. Open **Scenes**.
2. Type a scene name.
3. Click **Save Scene**.
4. The scene is stored in your browser.

If you save over an existing scene name, the app asks before overwriting.

### Loading a Scene

1. Open **Scenes**.
2. Choose a saved scene from the dropdown.
3. Click **Load Scene**.
4. The map, tokens, HUD, theme, grid size, terrain, and combat data load.

### Deleting a Scene

1. Choose a scene from the dropdown.
2. Click **Delete Scene**.
3. Confirm the deletion.

Deleted scenes cannot be restored unless you have a backup.

---

## 9. Export / Import Backup

Scenes are stored in browser local storage. Use backups to protect your work.

### Export Backup

1. Open **Scenes**.
2. Click **Export Backup**.
3. Save the `.json` file somewhere safe.

### Import Backup

1. Open **Scenes**.
2. Click **Import Backup**.
3. Choose an Aure Relics backup `.json` file.
4. Confirm the import.

Backups are useful for:

- moving scenes to another device
- protecting against browser data clearing
- testing new releases
- offline play prep

---

## 10. Grid Size

Use **Grid Size** to change map dimensions.

How to change size:

1. Open **Grid Size**.
2. Enter width and height.
3. Click **Apply Grid Size**.
4. Confirm the warning.

Changing grid size clears the current grid, so save your scene first.

Examples:

- `10 x 20` for narrow maps or hallways
- `20 x 20` for standard encounters
- `30 x 30` for larger battles
- `40 x 20` for wide battlefield layouts

---

## 11. Combat Tracker

The Combat Tracker manages turn order.

### Initiative Setup

Use Initiative Setup to:

- enter initiative values
- select tokens for grouping
- prepare enemy groups
- sort initiative

### Grouping Initiative

Use grouping when multiple combatants act on the same turn.

How to group:

1. Check the boxes next to the tokens.
2. Click **Group Selected**.
3. A group row appears in Initiative Setup.
4. Enter one initiative value for the group.
5. Click **Sort Initiative**.

### Sort Initiative

After initiative is sorted:

- Turn Order opens
- Initiative Setup closes
- active turn highlighting becomes available

### Tie Breaker

If multiple combatants have the same initiative, the tie breaker appears.

Use the arrows to set the correct order, then confirm.

### Next Turn

Click **Next Turn** to advance turn order.

When a combatant becomes active:

- the turn order row highlights
- the token on the grid glows
- the matching HUD card glows

---

## 12. DM Notes and History

The bottom DM panel includes:

- **DM Notes** for session notes, enemy plans, lore, loot, and reminders
- **History** for recent moves, saves, edits, and turn changes

The DM panel can be collapsed to keep the battlefield clear.

Notes and history are stored locally in the browser and included in backup exports.

---

## 13. Recommended DM Workflow

A simple encounter setup flow:

1. Set grid size.
2. Choose a scene theme.
3. Use Void Fill to block off unusable space.
4. Add grid terrain and freeform terrain.
5. Place player tokens.
6. Enter player names, classes, max HP, and starting HP.
7. Place enemies, NPCs, and bosses.
8. Enter private enemy/boss details.
9. Choose which enemy/boss details should be visible.
10. Save the scene.
11. Enter initiative or create groups.
12. Sort initiative.
13. Use Next Turn during combat.
14. Export a backup after major scene work.

---

## 14. Current Limitations

Current limitations:

- no grid-line wall/door builder yet
- no AoE, cone, radius, line-of-sight, or range tools yet
- saved scenes are local to the browser
- no multiplayer hosting yet
- no campaign folder system yet
- no fog of war yet

---

## 15. Planned Advanced Features

Future upgrades may include:

- campaign folders
- walls and doors on grid lines
- dungeon and building construction tools
- AoE templates
- cones and line attacks
- line of sight tools
- range rulers
- hidden/revealed object notes
- fog of war
- player-facing display modes
- multiplayer host/player sessions
