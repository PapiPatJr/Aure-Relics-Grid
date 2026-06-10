# Aure Relics Digital Tabletop Grid Tutorial

This guide explains how to use the current Aure Relics Digital Tabletop Grid release.

The app is designed for DMs who want a simple visual battle map for in-person tabletop play, TV display, shared monitor use, or light digital encounter tracking.

---

## Section 1 — Tools

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

Use **Erase** to remove content from grid squares.

Erase removes:

- void fill
- terrain icons
- tokens

How to use:

1. Click **Erase**.
2. Click a square to clear it.
3. Click and drag to erase multiple squares.

Be careful: erasing a token removes that combatant from the HUD and initiative tools.

---

## Section 2 — Tokens

Tokens represent players, enemies, NPCs, and bosses on the grid.

### Token Types

The app currently supports four token types:

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
2. Drop it onto another grid square.
3. The HUD and initiative tools stay connected to that token.

### Player HUD Cards

Player cards appear on the left side of the battle area.

Each player card can show:

- token ID
- character name
- class or role
- current HP
- max HP
- temporary HP
- health bar
- status, buff, or debuff references
- active-turn glow when it is that player's turn

### Editing Player Details

Use the small cog button on the player card.

The detail window allows editing:

- name
- class / role
- current HP
- max HP
- temporary HP
- status
- buff / debuff

Recommended setup:

1. Place the player token.
2. Click the cog.
3. Enter the character name.
4. Enter class or role.
5. Enter max HP.
6. Save details.

After setup, most combat updates can be done directly from the compact player card by adjusting current HP or temp HP.

### Enemy, NPC, and Boss HUD Cards

Enemies, NPCs, and bosses appear on the right side.

Visual styles:

- enemies use a rustic orange style
- NPCs use a forest green style
- bosses use a stronger evil red boss style

Bosses are prioritized near the top of the opponent rail so they stand out.

### Enemy and Boss Visibility

The DM can enter enemy/boss information without revealing all of it on the table view.

Open the cog on an enemy, NPC, or boss card to choose whether to show:

- HP
- status / debuff
- buff

This lets the DM track details privately while only showing the table what makes sense.

---

## Section 3 — Terrain

The **Terrain** section places simple visual markers on grid squares.

Current terrain tools include:

- Tree
- Rock
- Fire
- Door
- Water
- House
- Stairs
- Chest

How to use terrain:

1. Click a terrain tool.
2. Click a grid square.
3. The terrain icon appears on that square.
4. Use Erase to remove it.

Current terrain is grid-based. Freeform draggable and resizable terrain objects are planned for a future update.

---

## Section 4 — Brush Size

Brush Size controls how many grid squares are affected when painting void fill, erasing, or placing terrain.

Options:

- `1x1`
- `2x2`
- `3x3`

Use larger brush sizes for:

- filling big blocked areas
- clearing larger sections
- quickly roughing out a map

---

## Section 5 — Scenes

Scenes let you save and reload maps.

A scene can include:

- grid size
- void fill
- terrain
- tokens
- names
- HP and temp HP
- class / role
- status and buff data
- enemy/boss visibility settings
- initiative entries
- current turn position

### Saving a Scene

1. Open **Scenes**.
2. Type a scene name.
3. Click **Save Scene**.
4. The scene is stored in your browser.
5. The manual scene-name box clears after saving.

If you save over an existing scene name, the app asks before overwriting.

### Loading a Scene

1. Open **Scenes**.
2. Choose a saved scene from the dropdown.
3. Click **Load Scene**.
4. The map, tokens, HUD, grid size, and combat data load.

The selected scene stays visible in the dropdown after loading.

### Deleting a Scene

1. Choose a scene from the dropdown.
2. Click **Delete Scene**.
3. Confirm the deletion.

Deleted scenes cannot be restored unless you have a backup.

### Important Note About Scene Storage

Scenes are saved using browser local storage.

That means:

- saved scenes stay on that browser/device
- clearing browser storage may delete saved scenes
- scenes do not sync across devices yet
- private/incognito windows may not preserve saved scenes

---

## Section 6 — Grid Size

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

## Section 7 — Combat Tracker

The Combat Tracker manages turn order.

### Initiative Setup

The **Initiative Setup** section can be opened or collapsed.

Use it to:

- enter initiative values
- select tokens for grouping
- group enemies together
- sort initiative

### Entering Initiative

1. Place tokens on the grid.
2. Enter initiative values next to the tokens.
3. Click **Sort Initiative**.
4. The turn order list appears above the setup section.

### Turn Order

The compact turn order list shows the sorted order after initiative is sorted.

The active turn is highlighted.

### Next Turn

Click **Next Turn** to advance turn order.

When a combatant becomes active:

- the turn order row highlights
- the token on the grid glows
- the matching player/enemy/NPC/boss card glows and shimmers

### Grouping Initiative

Use grouping when multiple combatants act on the same turn.

Example:

- E1 Goblin
- E2 Goblin
- E3 Goblin

How to group:

1. Check the boxes next to the tokens.
2. Click **Group Selected**.
3. Enter one initiative value.
4. The group acts together in turn order.

### Tie Breaker

If multiple combatants have the same initiative, the tie breaker appears.

Use the arrows to set the correct order, then confirm.

---

## Section 8 — Active Turn Indicators

The app uses multiple visual cues for the active turn.

When a combatant is active:

- the token glows on the grid
- the HUD card glows and shimmers
- the initiative row highlights

The separate turn banner was removed to keep the grid larger and reduce clutter.

---

## Section 9 — Recommended DM Workflow

A simple encounter setup flow:

1. Set grid size.
2. Use Void Fill to block off unusable space.
3. Add terrain markers.
4. Place player tokens.
5. Open player cogs and enter names, classes, max HP, and starting HP.
6. Place enemies, NPCs, and bosses.
7. Open enemy/boss cogs and enter any private details.
8. Choose which enemy/boss details should be visible.
9. Save the scene.
10. Enter initiative.
11. Sort initiative.
12. Collapse Initiative Setup.
13. Use Next Turn during combat.

---

## Section 10 — Current Limitations

Current limitations:

- terrain is still grid-locked
- terrain cannot yet be freely dragged or resized
- no grid-line wall/door builder yet
- no AoE, cone, radius, line-of-sight, or range tools yet
- saved scenes are local to the browser
- no multiplayer hosting yet

These are planned for future versions.

---

## Planned Advanced Features

Future upgrades may include:

- freeform tree canopies
- resizable rocks and terrain props
- stone formations and boulders
- walls and doors on grid lines
- dungeon and building construction tools
- AoE templates
- cones and line attacks
- line of sight tools
- range rulers
- temporary markers
- clear overlay tools
- fog of war
- player-facing display modes
- multiplayer host/player sessions
