"use strict";

const DEFAULT_GRID_WIDTH = 20;
const DEFAULT_GRID_HEIGHT = 20;
const MIN_GRID_SIZE = 5;
const MAX_GRID_SIZE = 80;
const MAX_PLAYERS = 8;
const SAVED_MAPS_KEY = "aureRelicsSavedMaps";
const DM_NOTES_KEY = "aureRelicsDmNotes";
const DM_HISTORY_KEY = "aureRelicsDmHistory";
const MAX_HISTORY_ENTRIES = 80;

const TOKEN_TYPES = {
  player: { prefix: "P", color: "blue", label: "Player", priority: 1 },
  boss: { prefix: "B", color: "purple", label: "Boss", priority: 2 },
  enemy: { prefix: "E", color: "crimson", label: "Enemy", priority: 3 },
  npc: { prefix: "N", color: "green", label: "NPC", priority: 4 }
};

const TERRAIN_ICONS = {
  tree: "🌲",
  rock: "🪨",
  fire: "🔥",
  door: "🚪",
  water: "💧",
  house: "🏠",
  stairs: "⬇️",
  chest: "🧰"
};

const TERRAIN_OBJECTS = {
  treeCanopy: { icon: "🌳", label: "Tree Canopy" },
  boulder: { icon: "⬒", label: "Boulder" },
  stoneFormation: { icon: "⛰", label: "Stone Formation" },
  brushThicket: { icon: "✦", label: "Brush Thicket" },
  ruinedWall: { icon: "▥", label: "Ruined Wall" },
  stonePillar: { icon: "●", label: "Stone Pillar" },
  crateStack: { icon: "▣", label: "Crate Stack" },
  pond: { icon: "◌", label: "Pond / Pool" }
};

const SCENE_THEMES = {
  relic: { label: "Relic Default" },
  stoneDungeon: { label: "Stone Dungeon" },
  forestFloor: { label: "Forest Floor" },
  sandDesert: { label: "Sand / Desert" },
  iceField: { label: "Ice Field" },
  hellEmber: { label: "Hell / Ember" },
  cityCobblestone: { label: "City / Cobblestone" }
};

const DND_STATUSES = [
  "Normal",
  "Blinded",
  "Charmed",
  "Deafened",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
  "Exhausted",
  "Custom..."
];

const BUFF_OPTIONS = [
  "None",
  "Blessed",
  "Bane",
  "Hasted",
  "Slowed",
  "Inspired",
  "Raging",
  "Concentrating",
  "Shielded",
  "Hexed",
  "Cursed",
  "Custom..."
];

const elements = {
  appLayout: requireElement("appLayout"),
  sidebarPanel: requireElement("sidebarPanel"),
  rightPanel: requireElement("rightPanel"),
  toggleSidebar: requireElement("toggleSidebar"),
  toggleTracker: requireElement("toggleTracker"),
  currentScene: requireElement("currentScene"),
  gridInfo: requireElement("gridInfo"),
  grid: requireElement("grid"),
  battleStage: document.querySelector(".battle-stage"),
  battlefieldLayout: requireElement("battlefieldLayout"),
  mapRegion: document.querySelector(".map-region"),
  gridFrame: document.querySelector(".grid-frame"),
  gridWidthInput: requireElement("gridWidthInput"),
  gridHeightInput: requireElement("gridHeightInput"),
  applyGridSize: requireElement("applyGridSize"),
  brushSize: requireElement("brushSize"),
  sceneTheme: requireElement("sceneTheme"),
  resetSceneTheme: requireElement("resetSceneTheme"),

  wallTool: requireElement("wallTool"),
  eraseTool: requireElement("eraseTool"),
  clearGrid: requireElement("clearGrid"),

  playerToken: requireElement("playerToken"),
  enemyToken: requireElement("enemyToken"),
  npcToken: requireElement("npcToken"),
  bossToken: requireElement("bossToken"),

  treeTool: requireElement("treeTool"),
  rockTool: requireElement("rockTool"),
  fireTool: requireElement("fireTool"),
  doorTool: requireElement("doorTool"),
  waterTool: requireElement("waterTool"),
  houseTool: requireElement("houseTool"),
  stairsTool: requireElement("stairsTool"),
  chestTool: requireElement("chestTool"),
  treeCanopyTool: requireElement("treeCanopyTool"),
  boulderTool: requireElement("boulderTool"),
  stoneFormationTool: requireElement("stoneFormationTool"),
  brushThicketTool: requireElement("brushThicketTool"),
  ruinedWallTool: requireElement("ruinedWallTool"),
  stonePillarTool: requireElement("stonePillarTool"),
  crateStackTool: requireElement("crateStackTool"),
  pondTool: requireElement("pondTool"),

  mapName: requireElement("mapName"),
  mapList: requireElement("mapList"),
  saveMap: requireElement("saveMap"),
  loadMap: requireElement("loadMap"),
  deleteMap: requireElement("deleteMap"),
  exportData: requireElement("exportData"),
  importData: requireElement("importData"),
  importDataFile: requireElement("importDataFile"),

  playerStatusBoard: requireElement("playerStatusBoard"),
  enemyStatusStrip: requireElement("enemyStatusStrip"),

  turnOrderPanel: requireElement("turnOrderPanel"),
  initiativeSetup: requireElement("initiativeSetup"),
  initiativeList: requireElement("initiativeList"),
  groupSelected: requireElement("groupSelected"),
  sortInitiative: requireElement("sortInitiative"),
  clearInitiative: requireElement("clearInitiative"),
  nextTurn: requireElement("nextTurn"),

  tieResolver: requireElement("tieResolver"),
  tieOrderList: requireElement("tieOrderList"),
  confirmTieOrder: requireElement("confirmTieOrder"),

  combatantModal: requireElement("combatantModal"),
  modalTitle: requireElement("modalTitle"),
  modalClose: requireElement("modalClose"),
  modalTokenLabel: requireElement("modalTokenLabel"),
  modalName: requireElement("modalName"),
  modalClass: requireElement("modalClass"),
  modalHp: requireElement("modalHp"),
  modalMaxHp: requireElement("modalMaxHp"),
  modalTempHp: requireElement("modalTempHp"),
  modalStatus: requireElement("modalStatus"),
  modalBuff: requireElement("modalBuff"),
  modalShowRole: requireElement("modalShowRole"),
  modalShowHp: requireElement("modalShowHp"),
  modalShowStatus: requireElement("modalShowStatus"),
  modalShowBuff: requireElement("modalShowBuff"),
  modalSave: requireElement("modalSave"),
  modalCancel: requireElement("modalCancel"),

  dmWorkspace: requireElement("dmWorkspace"),
  dmNotesTab: requireElement("dmNotesTab"),
  dmHistoryTab: requireElement("dmHistoryTab"),
  dmNotesPanel: requireElement("dmNotesPanel"),
  dmHistoryPanel: requireElement("dmHistoryPanel"),
  dmNotesText: requireElement("dmNotesText"),
  dmHistoryLog: requireElement("dmHistoryLog"),
  toggleDmWorkspace: requireElement("toggleDmWorkspace")
};

if (!elements.battleStage || !elements.mapRegion || !elements.gridFrame) {
  throw new Error("The battle stage, map region, or grid frame is missing from index.html.");
}

let gridWidth = DEFAULT_GRID_WIDTH;
let gridHeight = DEFAULT_GRID_HEIGHT;
let currentTool = "wall";
let currentSceneTheme = "relic";
let isPainting = false;
let lastPaintedCell = null;
let draggedToken = null;
let draggedTerrainObject = null;
let terrainObjectCounter = 1;
let fitAnimationFrame = null;

let tokenCounters = createDefaultTokenCounters();
let tokenData = {};

let initiativeEntries = [];
let initiativeValues = {};
let initiativeGroups = [];
let currentTurnIndex = 0;
let pendingTieGroups = [];
let pendingSortedEntries = [];
let pendingActiveEntryKey = "";
let historyEntries = [];

function requireElement(id) {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }

  return element;
}

function createDefaultTokenCounters() {
  return {
    player: 1,
    enemy: 1,
    npc: 1,
    boss: 1
  };
}

function resetCombatState() {
  tokenCounters = createDefaultTokenCounters();
  tokenData = {};
  initiativeEntries = [];
  initiativeValues = {};
  initiativeGroups = [];
  currentTurnIndex = 0;
  pendingTieGroups = [];
  pendingSortedEntries = [];
  pendingActiveEntryKey = "";
  hideTieResolver();
}

function isTokenTool(toolName) {
  return Object.hasOwn(TOKEN_TYPES, toolName);
}

function isTerrainTool(toolName) {
  return Object.hasOwn(TERRAIN_ICONS, toolName) || Object.hasOwn(TERRAIN_OBJECTS, toolName);
}

function hasInitiativeScore(value) {
  return value !== null &&
    value !== undefined &&
    String(value).trim() !== "" &&
    Number.isFinite(Number(value));
}

function setActiveTool(toolName, buttonElement) {
  currentTool = toolName;

  document.querySelectorAll(".tool-button").forEach(button => {
    button.classList.remove("active-tool");
  });

  buttonElement.classList.add("active-tool");
}

function getTokenLabel(tokenElement) {
  return tokenElement.dataset.tokenId || tokenElement.textContent.trim();
}

function getTokenType(label) {
  const typeEntry = Object.entries(TOKEN_TYPES).find(([, config]) =>
    label.startsWith(config.prefix)
  );

  return typeEntry ? typeEntry[0] : "unknown";
}

function ensureTokenData(label) {
  const existing = tokenData[label] || {};
  const type = existing.type ?? getTokenType(label);
  const isPlayer = type === "player";

  tokenData[label] = {
    name: existing.name ?? "",
    characterClass: existing.characterClass ?? existing.className ?? "",
    hp: existing.hp ?? "",
    maxHp: existing.maxHp ?? "",
    tempHp: existing.tempHp ?? "",
    status: existing.status ?? "Normal",
    buff: existing.buff ?? "None",
    showRole: existing.showRole ?? isPlayer,
    dead: Boolean(existing.dead),
    showHp: existing.showHp ?? isPlayer,
    showStatus: existing.showStatus ?? isPlayer,
    showBuff: existing.showBuff ?? isPlayer,
    type
  };

  return tokenData[label];
}

function getDisplayName(label) {
  const data = ensureTokenData(label);
  const name = String(data.name || "").trim();

  return name ? `${name} (${label})` : label;
}

function getCompactLabel(label) {
  const data = ensureTokenData(label);
  const name = String(data.name || "").trim();

  return name ? `${label} ${name}` : label;
}

function getClassLabel(label) {
  const data = ensureTokenData(label);
  return String(data.characterClass || "").trim();
}

function getEffectsSummary(data, { respectVisibility = false } = {}) {
  const parts = [];

  if (
    data.status &&
    data.status !== "Normal" &&
    !(respectVisibility && !data.showStatus)
  ) {
    parts.push(data.status);
  }

  if (
    data.buff &&
    data.buff !== "None" &&
    !(respectVisibility && !data.showBuff)
  ) {
    parts.push(data.buff);
  }

  return parts.join(" • ");
}

function cleanNumberInput(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function compareTokenLabels(first, second) {
  const firstType = getTokenType(first);
  const secondType = getTokenType(second);
  const firstPriority = TOKEN_TYPES[firstType]?.priority ?? 99;
  const secondPriority = TOKEN_TYPES[secondType]?.priority ?? 99;

  if (firstPriority !== secondPriority) {
    return firstPriority - secondPriority;
  }

  const firstNumber = Number(first.match(/\d+$/)?.[0] || 0);
  const secondNumber = Number(second.match(/\d+$/)?.[0] || 0);

  return firstNumber - secondNumber;
}

function getTokensOnGrid() {
  return Array.from(elements.grid.querySelectorAll(".token"))
    .map(getTokenLabel)
    .sort(compareTokenLabels);
}

function createTokenElement(label, color) {
  const type = getTokenType(label);
  const token = document.createElement("div");
  token.className = `token token-${type}`;
  if (tokenData[label]?.dead) {
    token.classList.add("dead-combatant");
  }
  token.dataset.tokenId = label;
  token.textContent = label;
  token.style.background = color;
  token.setAttribute("role", "button");
  token.setAttribute("aria-label", `${label} token`);

  token.addEventListener("pointerdown", event => {
    if (currentTool === "erase") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    draggedToken = token;
    token.style.cursor = "grabbing";
  });

  return token;
}

function createTerrainElement(icon, terrainType = "") {
  const terrain = document.createElement("div");
  terrain.className = terrainType ? `terrain terrain-${terrainType}` : "terrain";
  terrain.textContent = icon;

  if (terrainType) {
    terrain.dataset.terrainType = terrainType;
    terrain.title = TERRAIN_OBJECTS[terrainType]?.label || terrainType;
  }

  return terrain;
}

function createSavedTerrainElement(savedTerrain) {
  if (!savedTerrain) {
    return null;
  }

  if (Object.hasOwn(TERRAIN_OBJECTS, savedTerrain)) {
    return createTerrainElement(TERRAIN_OBJECTS[savedTerrain].icon, savedTerrain);
  }

  if (Object.hasOwn(TERRAIN_ICONS, savedTerrain)) {
    return createTerrainElement(TERRAIN_ICONS[savedTerrain], savedTerrain);
  }

  const iconEntry = Object.entries(TERRAIN_ICONS).find(([, icon]) => icon === savedTerrain);
  if (iconEntry) {
    return createTerrainElement(iconEntry[1], iconEntry[0]);
  }

  return createTerrainElement(savedTerrain);
}

function getCellRowColumn(cell) {
  const index = Number(cell.dataset.index);
  return {
    row: Math.floor(index / gridWidth),
    column: index % gridWidth
  };
}

function getFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getGridCellFromPoint(clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  const gridRect = elements.grid.getBoundingClientRect();
  const cellSize =
    parseFloat(elements.grid.style.getPropertyValue("--cell-size")) ||
    gridRect.width / gridWidth ||
    32;
  const x = clientX - gridRect.left;
  const y = clientY - gridRect.top;
  const gridPixelWidth = cellSize * gridWidth;
  const gridPixelHeight = cellSize * gridHeight;

  if (x < 0 || y < 0 || x >= gridPixelWidth || y >= gridPixelHeight) {
    return null;
  }

  const column = Math.floor(x / cellSize);
  const row = Math.floor(y / cellSize);
  const index = row * gridWidth + column;

  return elements.grid.querySelector(`[data-index="${index}"]`);
}

function getClampedFreeformTerrainBounds(row, column, width, height) {
  const safeWidth = Math.max(1, Math.min(gridWidth, getFiniteNumber(width, 3)));
  const safeHeight = Math.max(1, Math.min(gridHeight, getFiniteNumber(height, 3)));

  return {
    row: clampGridValue(getFiniteNumber(row, 0), Math.max(0, gridHeight - safeHeight)),
    column: clampGridValue(getFiniteNumber(column, 0), Math.max(0, gridWidth - safeWidth)),
    width: safeWidth,
    height: safeHeight
  };
}

function syncFreeformTerrainObjectPosition(object) {
  const row = Number(object.dataset.row) || 0;
  const column = Number(object.dataset.column) || 0;
  const width = Math.max(1, Number(object.dataset.width) || 3);
  const height = Math.max(1, Number(object.dataset.height) || 3);

  object.style.left = `calc(var(--cell-size) * ${column})`;
  object.style.top = `calc(var(--cell-size) * ${row})`;
  object.style.width = `calc(var(--cell-size) * ${width})`;
  object.style.height = `calc(var(--cell-size) * ${height})`;
}

function createFreeformTerrainObject(type, row, column, width = 3, height = 3) {
  const config = TERRAIN_OBJECTS[type];

  if (!config) {
    return null;
  }

  const bounds = getClampedFreeformTerrainBounds(row, column, width, height);
  const object = document.createElement("div");
  object.className = `freeform-terrain freeform-terrain-${type}`;
  object.dataset.terrainObjectId = `terrain-${terrainObjectCounter}`;
  terrainObjectCounter += 1;
  object.dataset.terrainObjectType = type;
  object.dataset.row = String(bounds.row);
  object.dataset.column = String(bounds.column);
  object.dataset.width = String(bounds.width);
  object.dataset.height = String(bounds.height);
  object.title = `${config.label} — drag to move, corner to resize`;

  const icon = document.createElement("span");
  icon.className = "freeform-terrain-icon";
  icon.textContent = config.icon;

  const label = document.createElement("span");
  label.className = "freeform-terrain-label";
  label.textContent = config.label;

  const resizeHandle = document.createElement("button");
  resizeHandle.type = "button";
  resizeHandle.className = "freeform-terrain-resize";
  resizeHandle.textContent = "↘";
  resizeHandle.setAttribute("aria-label", `Resize ${config.label}`);

  object.append(icon, label, resizeHandle);
  syncFreeformTerrainObjectPosition(object);

  object.addEventListener("pointerdown", event => {
    if (currentTool === "erase") {
      event.preventDefault();
      event.stopPropagation();
      object.remove();
      addHistoryLog(`Removed ${config.label}.`);
      return;
    }

    if (!Object.hasOwn(TERRAIN_OBJECTS, currentTool) && !event.target.closest(".freeform-terrain-resize")) {
      const cell = getGridCellFromPoint(event.clientX, event.clientY);

      if (!cell) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyTool(cell);

      if (!isTokenTool(currentTool)) {
        isPainting = true;
        lastPaintedCell = cell;
      }

      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const mode = event.target.closest(".freeform-terrain-resize") ? "resize" : "move";
    draggedTerrainObject = {
      element: object,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startRow: Number(object.dataset.row) || 0,
      startColumn: Number(object.dataset.column) || 0,
      startWidth: Number(object.dataset.width) || 3,
      startHeight: Number(object.dataset.height) || 3
    };

    object.classList.add("dragging-terrain");
  });

  return object;
}

function placeFreeformTerrainObject(cell, type) {
  const { row, column } = getCellRowColumn(cell);
  const defaultSizes = {
    treeCanopy: [4, 4],
    boulder: [2, 2],
    stoneFormation: [4, 3],
    brushThicket: [3, 2],
    ruinedWall: [4, 1],
    stonePillar: [1, 1],
    crateStack: [2, 2],
    pond: [3, 2]
  };
  const [width, height] = defaultSizes[type] || [3, 3];
  const object = createFreeformTerrainObject(type, row, column, width, height);

  if (!object) {
    return;
  }

  elements.grid.appendChild(object);
  addHistoryLog(`Placed ${TERRAIN_OBJECTS[type].label}.`);
}

function getFreeformTerrainObjectsData() {
  return Array.from(elements.grid.querySelectorAll(".freeform-terrain")).map(object => ({
    type: object.dataset.terrainObjectType,
    row: Number(object.dataset.row) || 0,
    column: Number(object.dataset.column) || 0,
    width: Number(object.dataset.width) || 1,
    height: Number(object.dataset.height) || 1
  }));
}

function restoreFreeformTerrainObjects(objects = []) {
  if (!Array.isArray(objects)) {
    return;
  }

  objects.forEach(savedObject => {
    if (!savedObject || !Object.hasOwn(TERRAIN_OBJECTS, savedObject.type)) {
      return;
    }

    const object = createFreeformTerrainObject(
      savedObject.type,
      Number(savedObject.row) || 0,
      Number(savedObject.column) || 0,
      Number(savedObject.width) || 3,
      Number(savedObject.height) || 3
    );

    if (object) {
      elements.grid.appendChild(object);
    }
  });
}

function clampGridValue(value, max) {
  return Math.max(0, Math.min(max, value));
}

function updateDraggedTerrainObject(event) {
  if (!draggedTerrainObject) {
    return false;
  }

  const cellSize = parseFloat(elements.grid.style.getPropertyValue("--cell-size")) || 32;
  const deltaColumns = Math.round((event.clientX - draggedTerrainObject.startX) / cellSize);
  const deltaRows = Math.round((event.clientY - draggedTerrainObject.startY) / cellSize);
  const object = draggedTerrainObject.element;

  if (draggedTerrainObject.mode === "move") {
    const bounds = getClampedFreeformTerrainBounds(
      draggedTerrainObject.startRow + deltaRows,
      draggedTerrainObject.startColumn + deltaColumns,
      object.dataset.width,
      object.dataset.height
    );
    object.dataset.column = String(bounds.column);
    object.dataset.row = String(bounds.row);
  } else {
    const bounds = getClampedFreeformTerrainBounds(
      draggedTerrainObject.startRow,
      draggedTerrainObject.startColumn,
      draggedTerrainObject.startWidth + deltaColumns,
      draggedTerrainObject.startHeight + deltaRows
    );
    object.dataset.row = String(bounds.row);
    object.dataset.column = String(bounds.column);
    object.dataset.width = String(bounds.width);
    object.dataset.height = String(bounds.height);
  }

  syncFreeformTerrainObjectPosition(object);
  return true;
}

function finishDraggedTerrainObject() {
  if (!draggedTerrainObject) {
    return;
  }

  draggedTerrainObject.element.classList.remove("dragging-terrain");
  addHistoryLog(`Adjusted ${TERRAIN_OBJECTS[draggedTerrainObject.element.dataset.terrainObjectType]?.label || "terrain object"}.`);
  draggedTerrainObject = null;
}

function normalizeInitiativeGroups(groups, entries = []) {
  const sourceGroups = Array.isArray(groups) && groups.length > 0
    ? groups
    : (Array.isArray(entries) ? entries.filter(entry => Array.isArray(entry.members) && entry.members.length > 1) : []);

  return sourceGroups
    .filter(group => Array.isArray(group.members) && group.members.length > 1)
    .map((group, index) => ({
      id: group.id || `group-${Date.now()}-${index}`,
      members: [...group.members],
      initiative: group.initiative ?? ""
    }));
}

function getInitiativeSetupPanel() {
  return document.querySelector(".initiative-setup-panel");
}

function openTurnOrderPanel() {
  const setupPanel = getInitiativeSetupPanel();
  elements.turnOrderPanel.open = true;
  setupPanel?.removeAttribute("open");
}

function openInitiativeSetupPanel() {
  const setupPanel = getInitiativeSetupPanel();
  if (setupPanel) {
    setupPanel.open = true;
  }
  elements.turnOrderPanel.removeAttribute("open");
}

function getSceneThemeLabel(themeName = currentSceneTheme) {
  return SCENE_THEMES[themeName]?.label || SCENE_THEMES.relic.label;
}

function applySceneTheme(themeName = "relic") {
  const safeTheme = Object.hasOwn(SCENE_THEMES, themeName) ? themeName : "relic";
  currentSceneTheme = safeTheme;
  document.body.dataset.sceneTheme = safeTheme;

  if (elements.sceneTheme.value !== safeTheme) {
    elements.sceneTheme.value = safeTheme;
  }
}

function handleSceneThemeChange() {
  applySceneTheme(elements.sceneTheme.value);
  addHistoryLog(`Changed scene theme to ${getSceneThemeLabel()}.`);
}

function handleResetSceneTheme() {
  applySceneTheme("relic");
  addHistoryLog("Reset scene theme to Relic Default.");
}

function applyBrush(startCell) {
  const size = Number(elements.brushSize.value);
  const cells = Array.from(elements.grid.querySelectorAll(".cell"));
  const startIndex = cells.indexOf(startCell);

  if (startIndex < 0) {
    return;
  }

  const startRow = Math.floor(startIndex / gridWidth);
  const startColumn = startIndex % gridWidth;

  for (let rowOffset = 0; rowOffset < size; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < size; columnOffset += 1) {
      const row = startRow + rowOffset;
      const column = startColumn + columnOffset;

      if (row >= gridHeight || column >= gridWidth) {
        continue;
      }

      const cell = cells[row * gridWidth + column];
      applyTool(cell, true);
    }
  }
}

function applyTool(cell, fromBrush = false) {
  if (!fromBrush && Object.hasOwn(TERRAIN_OBJECTS, currentTool)) {
    placeFreeformTerrainObject(cell, currentTool);
    return;
  }

  if (!fromBrush && !isTokenTool(currentTool)) {
    applyBrush(cell);
    return;
  }

  if (currentTool === "wall") {
    cell.classList.add("wall");
    return;
  }

  if (currentTool === "erase") {
    const removedToken = cell.querySelector(".token");

    cell.classList.remove("wall");
    cell.querySelector(".terrain")?.remove();
    removedToken?.remove();

    if (removedToken) {
      removeLabelFromInitiative(getTokenLabel(removedToken));
      refreshCombatUI();
    }

    return;
  }

  if (isTokenTool(currentTool)) {
    placeToken(cell, currentTool);
    return;
  }

  if (isTerrainTool(currentTool)) {
    cell.classList.remove("wall");
    cell.querySelector(".terrain")?.remove();

    if (Object.hasOwn(TERRAIN_OBJECTS, currentTool)) {
      cell.appendChild(createTerrainElement(TERRAIN_OBJECTS[currentTool].icon, currentTool));
    } else {
      cell.appendChild(createTerrainElement(TERRAIN_ICONS[currentTool], currentTool));
    }
  }
}

function placeToken(cell, tokenType) {
  if (cell.querySelector(".token")) {
    return;
  }

  const playerCount = getTokensOnGrid()
    .filter(label => getTokenType(label) === "player")
    .length;

  if (tokenType === "player" && playerCount >= MAX_PLAYERS) {
    alert(`The player HUD supports up to ${MAX_PLAYERS} players.`);
    return;
  }

  const config = TOKEN_TYPES[tokenType];
  const label = `${config.prefix}${tokenCounters[tokenType]}`;
  tokenCounters[tokenType] += 1;

  ensureTokenData(label);
  cell.appendChild(createTokenElement(label, config.color));
  addHistoryLog(`Placed ${label} ${config.label}.`);
  refreshCombatUI();
}

function createGrid() {
  elements.grid.innerHTML = "";
  elements.grid.style.setProperty("--grid-width", String(gridWidth));
  elements.grid.style.setProperty("--grid-height", String(gridHeight));
  updateGridInfo();

  for (let index = 0; index < gridWidth * gridHeight; index += 1) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.index = String(index);

    cell.addEventListener("pointerdown", event => {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      if (event.target.closest(".token") && currentTool !== "erase") {
        return;
      }

      event.preventDefault();
      applyTool(cell);

      if (!isTokenTool(currentTool) && !Object.hasOwn(TERRAIN_OBJECTS, currentTool)) {
        isPainting = true;
        lastPaintedCell = cell;
      }
    });

    elements.grid.appendChild(cell);
  }

  scheduleGridFit();
}

function handlePointerMove(event) {
  if (draggedTerrainObject) {
    event.preventDefault();
    updateDraggedTerrainObject(event);
    return;
  }

  if (!isPainting || draggedToken) {
    return;
  }

  const cell = getGridCellFromPoint(event.clientX, event.clientY);

  if (!cell || cell === lastPaintedCell || !elements.grid.contains(cell)) {
    return;
  }

  event.preventDefault();
  applyTool(cell);
  lastPaintedCell = cell;
}

function handlePointerEnd(event) {
  if (draggedTerrainObject) {
    finishDraggedTerrainObject();
  }

  if (draggedToken) {
    const destinationCell = getGridCellFromPoint(event.clientX, event.clientY);

    if (destinationCell && elements.grid.contains(destinationCell)) {
      const occupyingToken = destinationCell.querySelector(".token");

      if (!occupyingToken || occupyingToken === draggedToken) {
        const movedLabel = getTokenLabel(draggedToken);
        destinationCell.appendChild(draggedToken);
        addHistoryLog(`Moved ${movedLabel}.`);
        refreshCombatUI();
      }
    }

    draggedToken.style.cursor = "grab";
    draggedToken = null;
  }

  isPainting = false;
  lastPaintedCell = null;
}

function clearGridContents() {
  elements.grid.querySelectorAll(".freeform-terrain").forEach(object => {
    object.remove();
  });

  elements.grid.querySelectorAll(".cell").forEach(cell => {
    cell.classList.remove("wall");
    cell.innerHTML = "";
  });

  terrainObjectCounter = 1;
}

function handleClearGrid() {
  const confirmed = confirm(
    "Are you sure you want to clear the grid? This will remove all void fill, terrain, tokens, initiative, and status data. Save your scene first if you want to keep it."
  );

  if (!confirmed) {
    return;
  }

  clearGridContents();
  resetCombatState();
  elements.currentScene.textContent = "No Scene Loaded";
  refreshCombatUI();
}

function getCurrentMapData() {
  const cells = Array.from(elements.grid.querySelectorAll(".cell")).map(cell => {
    const terrain = cell.querySelector(".terrain");
    const token = cell.querySelector(".token");

    return {
      wall: cell.classList.contains("wall"),
      terrain: terrain?.dataset.terrainType || terrain?.textContent || null,
      token: token
        ? {
            label: getTokenLabel(token),
            color: token.style.background
          }
        : null
    };
  });

  return {
    width: gridWidth,
    height: gridHeight,
    sceneTheme: currentSceneTheme,
    cells,
    terrainObjects: getFreeformTerrainObjectsData(),
    tokenData,
    initiativeEntries,
    initiativeValues,
    initiativeGroups,
    currentTurnIndex
  };
}

function applyMapData(savedData) {
  let cellData;

  if (Array.isArray(savedData)) {
    gridWidth = DEFAULT_GRID_WIDTH;
    gridHeight = DEFAULT_GRID_HEIGHT;
    tokenData = {};
    initiativeEntries = [];
    initiativeValues = {};
    initiativeGroups = [];
    currentTurnIndex = 0;
    cellData = savedData;
  } else if (isValidSceneData(savedData)) {
    gridWidth = Number(savedData.width);
    gridHeight = Number(savedData.height);
    currentSceneTheme = Object.hasOwn(SCENE_THEMES, savedData.sceneTheme) ? savedData.sceneTheme : "relic";
    applySceneTheme(currentSceneTheme);
    tokenData = savedData.tokenData || {};
    Object.keys(tokenData).forEach(ensureTokenData);
    initiativeEntries = normalizeInitiativeEntries(savedData.initiativeEntries);
    initiativeValues = savedData.initiativeValues || {};
    initiativeGroups = normalizeInitiativeGroups(savedData.initiativeGroups, savedData.initiativeEntries);
    currentTurnIndex = Number(savedData.currentTurnIndex) || 0;
    cellData = savedData.cells;
  } else {
    throw new Error("The selected scene contains invalid map data.");
  }

  elements.gridWidthInput.value = String(gridWidth);
  elements.gridHeightInput.value = String(gridHeight);
  applySceneTheme(currentSceneTheme);

  createGrid();

  const cells = elements.grid.querySelectorAll(".cell");

  cells.forEach((cell, index) => {
    const data = cellData[index];

    if (!data) {
      return;
    }

    if (data.wall) {
      cell.classList.add("wall");
    }

    if (data.terrain) {
      const terrainElement = createSavedTerrainElement(data.terrain);
      if (terrainElement) {
        cell.appendChild(terrainElement);
      }
    }

    if (data.token?.label) {
      ensureTokenData(data.token.label);
      const type = getTokenType(data.token.label);
      const fallbackColor = TOKEN_TYPES[type]?.color || "crimson";
      cell.appendChild(createTokenElement(data.token.label, data.token.color || fallbackColor));
    }
  });

  restoreFreeformTerrainObjects(savedData.terrainObjects);

  recalculateTokenCounters();
  refreshCombatUI();
}

function normalizeInitiativeEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter(entry => Array.isArray(entry.members) && entry.members.length > 0)
    .map(entry => ({
      name: entry.members.join(" / "),
      members: [...entry.members],
      initiative: Number(entry.initiative) || 0
    }));
}

function recalculateTokenCounters() {
  const labels = getTokensOnGrid();

  tokenCounters = createDefaultTokenCounters();

  Object.entries(TOKEN_TYPES).forEach(([type, config]) => {
    const highestNumber = labels
      .filter(label => label.startsWith(config.prefix))
      .reduce((highest, label) => {
        const value = Number(label.slice(config.prefix.length));
        return Number.isFinite(value) ? Math.max(highest, value) : highest;
      }, 0);

    tokenCounters[type] = highestNumber + 1;
  });
}

function getSavedMaps() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_MAPS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Could not read saved scenes:", error);
    return {};
  }
}

function isValidSceneData(savedData) {
  if (Array.isArray(savedData)) {
    return true;
  }

  const width = Number(savedData?.width);
  const height = Number(savedData?.height);

  return Boolean(
    savedData &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= MIN_GRID_SIZE &&
    width <= MAX_GRID_SIZE &&
    height >= MIN_GRID_SIZE &&
    height <= MAX_GRID_SIZE &&
    Array.isArray(savedData.cells)
  );
}

function saveSavedMaps(maps) {
  localStorage.setItem(SAVED_MAPS_KEY, JSON.stringify(maps));
}

function createBackupFileName() {
  const date = new Date();
  const stamp = date.toISOString().slice(0, 10);
  return `aure-relics-backup-${stamp}.json`;
}

function createBackupPayload() {
  return {
    app: "Aure Relics Digital Tabletop Grid",
    backupVersion: 2,
    exportedAt: new Date().toISOString(),
    savedMaps: getSavedMaps(),
    dmNotes: elements.dmNotesText?.value || "",
    dmHistory: historyEntries
  };
}

function getMapsFromBackupPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.savedMaps && typeof payload.savedMaps === "object") {
    return payload.savedMaps;
  }

  const looksLikeRawMapCollection = Object.values(payload).every(isValidSceneData);
  return looksLikeRawMapCollection ? payload : null;
}

function validateImportedMaps(maps) {
  const validMaps = {};
  const skippedNames = [];

  Object.entries(maps || {}).forEach(([name, sceneData]) => {
    if (typeof name === "string" && name.trim() && isValidSceneData(sceneData)) {
      validMaps[name] = sceneData;
    } else {
      skippedNames.push(name || "Unnamed scene");
    }
  });

  return { validMaps, skippedNames };
}

function handleExportData() {
  const payload = createBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = createBackupFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function handleImportData() {
  elements.importDataFile.click();
}

function handleImportDataFile(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(String(reader.result || "{}"));
      const importedMaps = getMapsFromBackupPayload(payload);

      if (!importedMaps) {
        alert("That backup file is not a valid Aure Relics scene backup.");
        return;
      }

      const { validMaps, skippedNames } = validateImportedMaps(importedMaps);
      const importedNames = Object.keys(validMaps);
      const hasDmNotes = typeof payload.dmNotes === "string";
      const hasDmHistory = Array.isArray(payload.dmHistory);

      if (importedNames.length === 0 && !hasDmNotes && !hasDmHistory) {
        alert("No valid scenes, DM notes, or DM history were found in that backup file.");
        return;
      }

      const currentMaps = getSavedMaps();
      const duplicateNames = importedNames.filter(name => Object.hasOwn(currentMaps, name));
      const warning = duplicateNames.length > 0
        ? `\n\nExisting scenes with the same name will be overwritten:\n${duplicateNames.join(", ")}`
        : "";
      const skippedNotice = skippedNames.length > 0
        ? `\n\nSkipped invalid scenes: ${skippedNames.join(", ")}`
        : "";
      const supplementalData = [
        hasDmNotes ? "DM notes" : "",
        hasDmHistory ? "DM history" : ""
      ].filter(Boolean);
      const supplementalNotice = supplementalData.length > 0
        ? `\n\nThis will replace the current ${supplementalData.join(" and ")}.`
        : "";
      const confirmed = confirm(
        `Import ${importedNames.length} scene(s)${supplementalData.length > 0 ? ` plus ${supplementalData.join(" and ")}` : ""} from this backup?${warning}${skippedNotice}${supplementalNotice}`
      );

      if (!confirmed) {
        return;
      }

      saveSavedMaps({ ...currentMaps, ...validMaps });

      if (hasDmNotes) {
        elements.dmNotesText.value = payload.dmNotes;
        localStorage.setItem(DM_NOTES_KEY, payload.dmNotes);
      }

      if (hasDmHistory) {
        historyEntries = payload.dmHistory.slice(0, MAX_HISTORY_ENTRIES);
        saveHistoryLog();
        renderHistoryLog();
      }

      refreshMapList();
      elements.mapName.value = "";
      alert(`Imported ${importedNames.length} scene(s).`);
    } catch (error) {
      console.error("Could not import Aure Relics backup:", error);
      alert("That backup file could not be read. Make sure it is a valid JSON backup.");
    } finally {
      elements.importDataFile.value = "";
    }
  });

  reader.addEventListener("error", () => {
    alert("That backup file could not be read.");
    elements.importDataFile.value = "";
  });

  reader.readAsText(file);
}


function getActiveEntryKey() {
  return initiativeEntries[currentTurnIndex] ? getEntryKey(initiativeEntries[currentTurnIndex]) : "";
}

function getActivePrimaryMember() {
  return initiativeEntries[currentTurnIndex]?.members?.[0] || "";
}

function restoreTurnIndex(preferredKey = "", preferredMember = "") {
  if (initiativeEntries.length === 0) {
    currentTurnIndex = 0;
    return;
  }

  if (preferredKey) {
    const keyIndex = initiativeEntries.findIndex(entry => getEntryKey(entry) === preferredKey);
    if (keyIndex >= 0) {
      currentTurnIndex = keyIndex;
      return;
    }
  }

  if (preferredMember) {
    const memberIndex = initiativeEntries.findIndex(entry => entry.members.includes(preferredMember));
    if (memberIndex >= 0) {
      currentTurnIndex = memberIndex;
      return;
    }
  }

  currentTurnIndex = Math.min(currentTurnIndex, initiativeEntries.length - 1);
}

function getStoredHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DM_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_ENTRIES) : [];
  } catch (error) {
    console.error("Could not read DM history:", error);
    return [];
  }
}

function saveHistoryLog() {
  localStorage.setItem(DM_HISTORY_KEY, JSON.stringify(historyEntries.slice(0, MAX_HISTORY_ENTRIES)));
}

function addHistoryLog(message) {
  if (!message || !elements.dmHistoryLog) {
    return;
  }

  historyEntries.unshift({
    time: new Date().toISOString(),
    message
  });

  historyEntries = historyEntries.slice(0, MAX_HISTORY_ENTRIES);
  saveHistoryLog();
  renderHistoryLog();
}

function renderHistoryLog() {
  elements.dmHistoryLog.innerHTML = "";

  if (historyEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dm-history-empty";
    empty.textContent = "Recent moves, edits, saves, and turn changes will appear here.";
    elements.dmHistoryLog.appendChild(empty);
    return;
  }

  historyEntries.forEach(entry => {
    const row = document.createElement("div");
    row.className = "dm-history-row";

    const time = document.createElement("span");
    time.className = "dm-history-time";
    time.textContent = new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const message = document.createElement("span");
    message.className = "dm-history-message";
    message.textContent = entry.message;

    row.append(time, message);
    elements.dmHistoryLog.appendChild(row);
  });
}

function setDmWorkspaceTab(tabName) {
  const showingNotes = tabName === "notes";
  elements.dmNotesTab.classList.toggle("active", showingNotes);
  elements.dmHistoryTab.classList.toggle("active", !showingNotes);
  elements.dmNotesPanel.classList.toggle("active", showingNotes);
  elements.dmHistoryPanel.classList.toggle("active", !showingNotes);
}

function toggleDmWorkspace() {
  const collapsed = elements.dmWorkspace.classList.toggle("collapsed");
  document.body.classList.toggle("dm-workspace-open", !collapsed);
  elements.toggleDmWorkspace.textContent = collapsed ? "DM Panel ▲" : "DM Panel ▼";
  elements.toggleDmWorkspace.setAttribute("aria-label", collapsed ? "Expand DM workspace" : "Collapse DM workspace");
  scheduleGridFit();
}

function initializeDmWorkspace() {
  elements.dmNotesText.value = localStorage.getItem(DM_NOTES_KEY) || "";
  historyEntries = getStoredHistory();
  document.body.classList.toggle("dm-workspace-open", !elements.dmWorkspace.classList.contains("collapsed"));
  renderHistoryLog();
}

function refreshMapList(selectedName = "") {
  const maps = getSavedMaps();
  elements.mapList.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select Scene";
  elements.mapList.appendChild(placeholder);

  Object.keys(maps)
    .sort((first, second) => first.localeCompare(second))
    .forEach(name => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      elements.mapList.appendChild(option);
    });

  if (selectedName && Object.hasOwn(maps, selectedName)) {
    elements.mapList.value = selectedName;
  }
}

function handleSaveMap() {
  const name = elements.mapName.value.trim();

  if (!name) {
    alert("Enter a scene name first.");
    elements.mapName.focus();
    return;
  }

  const maps = getSavedMaps();

  if (Object.hasOwn(maps, name)) {
    const overwrite = confirm(`A scene named "${name}" already exists. Overwrite it?`);
    if (!overwrite) {
      return;
    }
  }

  maps[name] = getCurrentMapData();
  saveSavedMaps(maps);
  refreshMapList(name);
  elements.currentScene.textContent = name;
  elements.mapName.value = "";
  addHistoryLog(`Saved scene: ${name}.`);
  alert(`Scene saved: ${name}`);
}

function handleLoadMap() {
  const name = elements.mapList.value;

  if (!name) {
    alert("Select a scene first.");
    return;
  }

  const maps = getSavedMaps();

  if (!Object.hasOwn(maps, name)) {
    alert("That scene could not be found.");
    refreshMapList();
    return;
  }

  const sceneData = maps[name];

  if (!isValidSceneData(sceneData)) {
    alert("That scene could not be loaded because its saved data is invalid.");
    return;
  }

  try {
    applyMapData(sceneData);
  } catch (error) {
    console.error("Scene loaded with a non-fatal render issue:", error);
  }

  elements.currentScene.textContent = name;
  elements.mapName.value = "";
  refreshMapList(name);
  addHistoryLog(`Loaded scene: ${name}.`);
}

function handleDeleteMap() {
  const name = elements.mapList.value;

  if (!name) {
    alert("Select a scene first.");
    return;
  }

  if (!confirm(`Delete the scene "${name}"? This cannot be undone.`)) {
    return;
  }

  const maps = getSavedMaps();
  delete maps[name];
  saveSavedMaps(maps);
  refreshMapList();

  if (elements.currentScene.textContent === name) {
    elements.currentScene.textContent = "No Scene Loaded";
  }

  addHistoryLog(`Deleted scene: ${name}.`);
}

function handleApplyGridSize() {
  const newWidth = Number(elements.gridWidthInput.value);
  const newHeight = Number(elements.gridHeightInput.value);

  if (
    !Number.isInteger(newWidth) ||
    !Number.isInteger(newHeight) ||
    newWidth < MIN_GRID_SIZE ||
    newHeight < MIN_GRID_SIZE ||
    newWidth > MAX_GRID_SIZE ||
    newHeight > MAX_GRID_SIZE
  ) {
    alert(`Grid width and height must be whole numbers between ${MIN_GRID_SIZE} and ${MAX_GRID_SIZE}.`);
    return;
  }

  const confirmed = confirm(
    "Changing grid size will clear the current grid. Save your scene first if you want to keep it. Continue?"
  );

  if (!confirmed) {
    return;
  }

  gridWidth = newWidth;
  gridHeight = newHeight;
  resetCombatState();
  elements.currentScene.textContent = "No Scene Loaded";
  createGrid();
  addHistoryLog(`Changed grid size to ${gridWidth} × ${gridHeight}.`);
  refreshCombatUI();
}

function updateGridInfo() {
  elements.gridInfo.textContent = `${gridWidth} × ${gridHeight}`;
}

function refreshCombatUI() {
  const labels = getTokensOnGrid();
  const players = labels.filter(label => getTokenType(label) === "player");
  const opponents = labels
    .filter(label => getTokenType(label) !== "player")
    .sort(compareTokenLabels);

  labels.forEach(ensureTokenData);
  renderPlayerHud(players);
  renderOpponentHud(opponents);
  updateBattlefieldClasses(players, opponents);
  cleanInitiativeEntries(labels);
  renderInitiativeSetup(labels);
  renderInitiativeList();
  applyActiveHighlights();
  scheduleGridFit();
}

function updateBattlefieldClasses(players, opponents) {
  elements.battlefieldLayout.classList.toggle("no-players", players.length === 0);
  elements.battlefieldLayout.classList.toggle("no-opponents", opponents.length === 0);
}

function getActiveMembers() {
  return initiativeEntries[currentTurnIndex]?.members || [];
}

function isActiveLabel(label) {
  return getActiveMembers().includes(label);
}

function applyActiveHighlights() {
  const activeMembers = new Set(getActiveMembers());

  elements.grid.querySelectorAll(".token").forEach(token => {
    const label = getTokenLabel(token);
    token.classList.toggle(
      "active-combatant",
      activeMembers.has(label)
    );
    token.classList.toggle("dead-combatant", Boolean(tokenData[label]?.dead));
  });

  document.querySelectorAll(".hud-card").forEach(card => {
    const label = card.dataset.tokenId;
    card.classList.toggle(
      "active-combatant",
      activeMembers.has(label)
    );
    card.classList.toggle("dead-combatant", Boolean(tokenData[label]?.dead));
  });
}

function renderPlayerHud(players) {
  elements.playerStatusBoard.innerHTML = "";

  players.slice(0, MAX_PLAYERS).forEach(label => {
    const data = ensureTokenData(label);
    const card = createHudCard(label, "player");

    const hpRow = document.createElement("div");
    hpRow.className = "hud-hp-row";

    const hpLabel = document.createElement("span");
    hpLabel.textContent = "HP";

    const hpInput = createNumberTextInput(data.hp, `${label} current HP`);
    hpInput.addEventListener("input", () => {
      data.hp = cleanNumberInput(hpInput.value);
      hpInput.value = data.hp;
      updateCardHealth(card, data);
        });

    const maxHp = document.createElement("span");
    maxHp.className = "hud-hp-static";
    maxHp.textContent = `/ ${data.maxHp || "—"}`;

    const tempLabel = document.createElement("span");
    tempLabel.textContent = "THP";

    const tempInput = createNumberTextInput(data.tempHp, `${label} temporary HP`);
    tempInput.addEventListener("input", () => {
      data.tempHp = cleanNumberInput(tempInput.value);
      tempInput.value = data.tempHp;
        });

    hpRow.append(hpLabel, hpInput, maxHp, tempLabel, tempInput);

    const hpBar = createHpBar(data);
    const effectLine = createEffectLine(data);

    card.append(hpRow, hpBar, effectLine);
    elements.playerStatusBoard.appendChild(card);
  });
}

function renderOpponentHud(opponents) {
  elements.enemyStatusStrip.innerHTML = "";

  opponents.forEach(label => {
    const type = getTokenType(label);
    const data = ensureTokenData(label);
    const card = createHudCard(label, type);

    const hpSummary = getHpSummary(data, {
      respectVisibility: type !== "player"
    });
    const effects = getEffectsSummary(data, {
      respectVisibility: type !== "player"
    });

    if (hpSummary) {
      card.append(createHpBar(data));
    }

    if (effects) {
      card.append(createEffectLine(data, { respectVisibility: true }));
    }

    if (!hpSummary && !effects) {
      const summary = document.createElement("div");
      summary.className = "opponent-summary";
      summary.textContent = "Details hidden";
      card.append(summary);
    }

    elements.enemyStatusStrip.appendChild(card);
  });
}

function createHudCard(label, type) {
  const data = ensureTokenData(label);
  const card = document.createElement("article");
  card.className = `hud-card type-${type}`;
  card.dataset.tokenId = label;

  if (isActiveLabel(label)) {
    card.classList.add("active-combatant");
  }

  const topLine = document.createElement("div");
  topLine.className = "hud-topline";

  const id = document.createElement("span");
  id.className = "hud-id";
  id.textContent = label;

  const nameWrap = document.createElement("span");
  nameWrap.className = "hud-name-wrap";

  const name = document.createElement("span");
  name.className = "hud-name";
  name.textContent = data.name ? data.name : TOKEN_TYPES[type]?.label || "Combatant";
  nameWrap.appendChild(name);

  if (type === "player" && data.characterClass) {
    const classLabel = document.createElement("span");
    classLabel.className = "hud-class";
    classLabel.textContent = data.characterClass;
    nameWrap.appendChild(classLabel);
  }

  const typeTag = document.createElement("span");
  typeTag.className = "hud-type-tag";
  const visibleRole = String(data.characterClass || "").trim();
  typeTag.textContent = type === "player"
    ? ""
    : (data.showRole && visibleRole ? visibleRole.toUpperCase() : TOKEN_TYPES[type]?.label || "");

  const deathButton = document.createElement("button");
  deathButton.type = "button";
  deathButton.className = "hud-death";
  deathButton.textContent = data.dead ? "☠" : "✕";
  deathButton.setAttribute("aria-label", data.dead ? `Restore ${getDisplayName(label)}` : `Mark ${getDisplayName(label)} dead and remove from initiative`);
  deathButton.title = data.dead ? "Restore combatant" : "Mark dead / remove from initiative";
  deathButton.addEventListener("click", () => toggleCombatantDead(label));

  const settings = document.createElement("button");
  settings.type = "button";
  settings.className = "hud-settings";
  settings.textContent = "⚙";
  settings.setAttribute("aria-label", `Edit ${getDisplayName(label)}`);
  settings.addEventListener("click", () => openCombatantModal(label));

  topLine.append(id, nameWrap);
  if (typeTag.textContent) {
    topLine.appendChild(typeTag);
  }
  topLine.append(deathButton, settings);
  card.appendChild(topLine);

  return card;
}


function removeLabelFromInitiative(label) {
  const activeKey = getActiveEntryKey();
  const activeMember = getActivePrimaryMember();

  initiativeGroups = initiativeGroups
    .map(group => {
      if (!group.members.includes(label)) {
        return group;
      }

      const remainingMembers = group.members.filter(member => member !== label);

      if (remainingMembers.length === 1 && hasInitiativeScore(group.initiative)) {
        initiativeValues[remainingMembers[0]] = Number(group.initiative);
      }

      return {
        ...group,
        members: remainingMembers
      };
    })
    .filter(group => group.members.length > 1);

  initiativeEntries = initiativeEntries
    .map(entry => ({
      ...entry,
      members: entry.members.filter(member => member !== label),
      name: entry.members.filter(member => member !== label).join(" / ")
    }))
    .filter(entry => entry.members.length > 0);

  delete initiativeValues[label];

  restoreTurnIndex(activeKey, activeMember === label ? "" : activeMember);
}

function toggleCombatantDead(label) {
  const data = ensureTokenData(label);
  data.dead = !data.dead;

  if (data.dead) {
    removeLabelFromInitiative(label);
    addHistoryLog(`Marked ${getCompactLabel(label)} dead and removed from initiative.`);
  } else {
    addHistoryLog(`Restored ${getCompactLabel(label)}.`);
  }

  refreshCombatUI();
}

function createNumberTextInput(value, ariaLabel) {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.value = value || "";
  input.autocomplete = "off";
  input.setAttribute("aria-label", ariaLabel);
  return input;
}

function createHpBar(data) {
  const hpBar = document.createElement("div");
  hpBar.className = "hp-bar";
  const hpFill = document.createElement("div");
  hpFill.className = "hp-fill";
  hpBar.appendChild(hpFill);
  updateHealthBar(hpFill, data.hp, data.maxHp);
  return hpBar;
}

function createEffectLine(data, { respectVisibility = false } = {}) {
  const effectLine = document.createElement("div");
  effectLine.className = "effect-line";
  effectLine.textContent = getEffectsSummary(data, { respectVisibility });
  return effectLine;
}

function updateCardHealth(card, data) {
  const hpFill = card.querySelector(".hp-fill");
  if (hpFill) {
    updateHealthBar(hpFill, data.hp, data.maxHp);
  }
}

function updateHealthBar(hpFill, hpValue, maxHpValue) {
  const hp = Math.max(0, Number(hpValue) || 0);
  const maxHp = Math.max(1, Number(maxHpValue) || 1);
  const percentage = Math.min(100, (hp / maxHp) * 100);
  hpFill.style.width = `${percentage}%`;
}

function getHpSummary(data, { respectVisibility = false } = {}) {
  if (respectVisibility && !data.showHp) {
    return "";
  }

  if (!data.hp && !data.maxHp && !data.tempHp) {
    return "";
  }

  const hp = data.hp || "—";
  const maxHp = data.maxHp || "—";
  const temp = data.tempHp ? ` +${data.tempHp} THP` : "";
  return `HP ${hp}/${maxHp}${temp}`;
}

function populateSelect(select, options, currentValue) {
  select.innerHTML = "";

  const values = options.includes(currentValue)
    ? options
    : [...options.slice(0, -1), currentValue, options.at(-1)];

  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === currentValue;
    select.appendChild(option);
  });
}

function openCombatantModal(label) {
  const data = ensureTokenData(label);
  const type = getTokenType(label);

  elements.modalTokenLabel.value = label;
  elements.modalTitle.textContent = `Edit ${label} ${TOKEN_TYPES[type]?.label || "Combatant"}`;
  elements.modalName.value = data.name || "";
  elements.modalClass.value = data.characterClass || "";
  elements.modalHp.value = data.hp || "";
  elements.modalMaxHp.value = data.maxHp || "";
  elements.modalTempHp.value = data.tempHp || "";
  populateSelect(elements.modalStatus, DND_STATUSES, data.status || "Normal");
  populateSelect(elements.modalBuff, BUFF_OPTIONS, data.buff || "None");
  elements.modalShowRole.checked = Boolean(data.showRole);
  elements.modalShowHp.checked = Boolean(data.showHp);
  elements.modalShowStatus.checked = Boolean(data.showStatus);
  elements.modalShowBuff.checked = Boolean(data.showBuff);

  elements.combatantModal.classList.toggle("editing-player", type === "player");
  elements.combatantModal.classList.remove("hidden");
  elements.modalName.focus();
}

function closeCombatantModal() {
  elements.combatantModal.classList.add("hidden");
}

function resolveSelectValue(select, previousValue, label) {
  if (select.value !== "Custom...") {
    return select.value;
  }

  const customValue = prompt(`Enter custom ${label}:`)?.trim();

  if (!customValue) {
    select.value = previousValue;
    return previousValue;
  }

  return customValue;
}

function saveCombatantModal() {
  const label = elements.modalTokenLabel.value;

  if (!label) {
    return;
  }

  const data = ensureTokenData(label);
  data.name = elements.modalName.value.trim();
  data.characterClass = elements.modalClass.value.trim();
  data.hp = cleanNumberInput(elements.modalHp.value);
  data.maxHp = cleanNumberInput(elements.modalMaxHp.value);
  data.tempHp = cleanNumberInput(elements.modalTempHp.value);
  data.status = resolveSelectValue(elements.modalStatus, data.status, "status");
  data.buff = resolveSelectValue(elements.modalBuff, data.buff, "buff or debuff");
  data.showRole = elements.modalShowRole.checked;
  data.showHp = elements.modalShowHp.checked;
  data.showStatus = elements.modalShowStatus.checked;
  data.showBuff = elements.modalShowBuff.checked;

  closeCombatantModal();
  addHistoryLog(`Updated ${label} details.`);
  refreshCombatUI();
}

function renderInitiativeSetup(labels) {
  const groupedMembers = new Set(
    initiativeGroups.flatMap(group => group.members)
  );

  elements.initiativeSetup.innerHTML = "";

  if (initiativeGroups.length > 0) {
    const groupList = document.createElement("div");
    groupList.className = "initiative-group-list";

    initiativeGroups.forEach(group => {
      const groupRow = document.createElement("div");
      groupRow.className = "initiative-group-summary";
      groupRow.title = group.members.map(getCompactLabel).join(" / ");

      const groupLabel = document.createElement("span");
      groupLabel.textContent = `Group Selected: ${group.members.map(getCompactLabel).join(" / ")}`;

      const groupInput = document.createElement("input");
      groupInput.type = "number";
      groupInput.className = "initiative-input initiative-group-input";
      groupInput.dataset.groupId = group.id;
      groupInput.placeholder = "Init";
      groupInput.value = group.initiative ?? "";
      groupInput.setAttribute("aria-label", `${groupLabel.textContent} initiative`);

      groupInput.addEventListener("input", () => {
        group.initiative = groupInput.value === "" ? "" : Number(groupInput.value);
      });

      const disbandButton = document.createElement("button");
      disbandButton.type = "button";
      disbandButton.className = "group-disband";
      disbandButton.textContent = "Ungroup";
      disbandButton.setAttribute("aria-label", `Ungroup ${groupLabel.textContent}`);
      disbandButton.addEventListener("click", () => {
        if (hasInitiativeScore(group.initiative)) {
          const initiative = Number(group.initiative);
          group.members.forEach(member => {
            initiativeValues[member] = initiative;
          });
        }

        initiativeGroups = initiativeGroups.filter(existing => existing.id !== group.id);
        initiativeEntries = initiativeEntries.filter(entry => getEntryKey(entry) !== group.members.join("|"));
        addHistoryLog(`Ungrouped ${group.members.map(getCompactLabel).join(" / ")}.`);
        refreshCombatUI();
      });

      groupRow.append(groupLabel, groupInput, disbandButton);
      groupList.appendChild(groupRow);
    });

    elements.initiativeSetup.appendChild(groupList);
  }

  labels.forEach(label => {
    const data = ensureTokenData(label);
    const row = document.createElement("div");
    row.className = "initiative-row";
    row.classList.toggle("dead-row", Boolean(data.dead));

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "initiative-check";
    checkbox.value = label;
    checkbox.disabled = groupedMembers.has(label) || data.dead;
    checkbox.setAttribute("aria-label", `Select ${getDisplayName(label)} for grouping`);

    const name = document.createElement("span");
    name.textContent = groupedMembers.has(label)
      ? `${getCompactLabel(label)} (in group)`
      : data.dead
        ? `${getCompactLabel(label)} (dead)`
        : getCompactLabel(label);

    const input = document.createElement("input");
    input.type = "number";
    input.className = "initiative-input";
    input.dataset.token = label;
    input.placeholder = "Init";
    input.value = initiativeValues[label] ?? "";
    input.disabled = groupedMembers.has(label) || data.dead;
    input.setAttribute("aria-label", `${getDisplayName(label)} initiative`);

    input.addEventListener("input", () => {
      if (input.value === "") {
        delete initiativeValues[label];
      } else {
        initiativeValues[label] = Number(input.value);
      }
    });

    row.append(checkbox, name, input);
    elements.initiativeSetup.appendChild(row);
  });
}

function cleanInitiativeEntries(existingLabels = getTokensOnGrid()) {
  const existingTokens = new Set(existingLabels);

  initiativeGroups = initiativeGroups
    .map(group => {
      const remainingMembers = group.members.filter(member =>
        existingTokens.has(member) && !tokenData[member]?.dead
      );

      if (remainingMembers.length === 1 && hasInitiativeScore(group.initiative)) {
        initiativeValues[remainingMembers[0]] = Number(group.initiative);
      }

      return {
        ...group,
        members: remainingMembers
      };
    })
    .filter(group => group.members.length > 1);

  initiativeEntries = initiativeEntries
    .map(entry => {
      const remainingMembers = entry.members.filter(member =>
        existingTokens.has(member)
      );

      return {
        ...entry,
        members: remainingMembers,
        name: remainingMembers.join(" / ")
      };
    })
    .filter(entry => entry.members.length > 0);

  Object.keys(initiativeValues).forEach(label => {
    if (!existingTokens.has(label)) {
      delete initiativeValues[label];
    }
  });

  if (currentTurnIndex >= initiativeEntries.length) {
    currentTurnIndex = 0;
  }
}

function removeMemberFromInitiativeEntry(entryIndex, memberLabel) {
  const entry = initiativeEntries[entryIndex];

  if (!entry) {
    return;
  }

  initiativeValues[memberLabel] = entry.initiative;
  removeLabelFromInitiative(memberLabel);
  addHistoryLog(`Removed ${memberLabel} from initiative group.`);
  refreshCombatUI();
}

function removeInitiativeEntry(index) {
  const activeKey = getActiveEntryKey();
  const activeMember = getActivePrimaryMember();
  const entry = initiativeEntries[index];

  if (!entry) {
    return;
  }

  entry.members.forEach(member => {
    initiativeValues[member] = entry.initiative;
  });

  const removedName = entry.members.map(getCompactLabel).join(" / ");
  initiativeGroups = initiativeGroups.filter(group => getEntryKey(group) !== getEntryKey(entry));
  initiativeEntries.splice(index, 1);
  addHistoryLog(`Removed ${removedName} from initiative.`);

  restoreTurnIndex(activeKey, activeMember);
  refreshCombatUI();
}

function renderInitiativeList() {
  elements.initiativeList.innerHTML = "";

  if (initiativeEntries.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "turn-order-empty";
    emptyState.textContent = "Sort initiative to populate turn order.";
    elements.initiativeList.appendChild(emptyState);
    return;
  }

  initiativeEntries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "turn-row";

    if (index === currentTurnIndex) {
      row.classList.add("active-turn");
    }

    const label = document.createElement("span");
    label.className = "turn-label";
    const labelText = `${index + 1}. ${entry.members.map(getCompactLabel).join(" / ")}`;
    label.textContent = labelText;
    label.title = labelText;

    row.appendChild(label);

    if (entry.members.length > 1) {
      const memberTools = document.createElement("div");
      memberTools.className = "turn-member-tools";

      entry.members.forEach(member => {
        const memberButton = document.createElement("button");
        memberButton.type = "button";
        memberButton.className = "member-remove";
        memberButton.textContent = `− ${member}`;
        memberButton.title = `Remove ${getCompactLabel(member)} from this group`;
        memberButton.setAttribute("aria-label", `Remove ${getDisplayName(member)} from this group`);
        memberButton.addEventListener("click", () => removeMemberFromInitiativeEntry(index, member));
        memberTools.appendChild(memberButton);
      });

      row.appendChild(memberTools);
    }

    const initiativeScore = document.createElement("strong");
    initiativeScore.className = "turn-initiative";
    initiativeScore.textContent = String(entry.initiative);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-entry";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Remove ${labelText} from initiative`);
    removeButton.addEventListener("click", () => removeInitiativeEntry(index));

    row.append(initiativeScore, removeButton);
    elements.initiativeList.appendChild(row);
  });
}

function getEntryKey(entry) {
  return entry.members.join("|");
}

function findInitiativeTies(entries) {
  const groups = new Map();

  entries.forEach(entry => {
    const initiative = Number(entry.initiative);
    const group = groups.get(initiative) || [];
    group.push(entry);
    groups.set(initiative, group);
  });

  return Array.from(groups.values()).filter(group => group.length > 1);
}

function showTieResolver(tieGroup) {
  elements.tieResolver.classList.remove("hidden");
  elements.tieOrderList.innerHTML = "";

  tieGroup.forEach(entry => {
    const row = document.createElement("div");
    row.className = "tie-row";
    row.dataset.entryKey = getEntryKey(entry);

    const label = document.createElement("span");
    label.textContent = entry.members.map(getCompactLabel).join(" / ");

    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "move-up";
    moveUp.textContent = "↑";
    moveUp.setAttribute("aria-label", `Move ${label.textContent} up`);

    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "move-down";
    moveDown.textContent = "↓";
    moveDown.setAttribute("aria-label", `Move ${label.textContent} down`);

    moveUp.addEventListener("click", () => {
      const previous = row.previousElementSibling;
      if (previous) {
        elements.tieOrderList.insertBefore(row, previous);
      }
    });

    moveDown.addEventListener("click", () => {
      const next = row.nextElementSibling;
      if (next) {
        elements.tieOrderList.insertBefore(next, row);
      }
    });

    row.append(label, moveUp, moveDown);
    elements.tieOrderList.appendChild(row);
  });
}

function hideTieResolver() {
  elements.tieResolver.classList.add("hidden");
  elements.tieOrderList.innerHTML = "";
}

function handleConfirmTieOrder() {
  if (pendingTieGroups.length === 0) {
    return;
  }

  const currentTieGroup = pendingTieGroups.shift();
  const entryMap = new Map(
    currentTieGroup.map(entry => [getEntryKey(entry), entry])
  );
  const tieKeys = new Set(entryMap.keys());

  const orderedEntries = Array.from(
    elements.tieOrderList.querySelectorAll(".tie-row")
  )
    .map(row => entryMap.get(row.dataset.entryKey))
    .filter(Boolean);

  const tiedIndices = pendingSortedEntries
    .map((entry, index) =>
      tieKeys.has(getEntryKey(entry)) ? index : -1
    )
    .filter(index => index >= 0);

  if (orderedEntries.length !== tiedIndices.length) {
    alert("The tie order could not be confirmed. Please try sorting initiative again.");
    pendingTieGroups = [];
    pendingSortedEntries = [];
    hideTieResolver();
    refreshCombatUI();
    return;
  }

  tiedIndices.forEach((index, orderIndex) => {
    pendingSortedEntries[index] = orderedEntries[orderIndex];
  });

  if (pendingTieGroups.length > 0) {
    showTieResolver(pendingTieGroups[0]);
    return;
  }

  initiativeEntries = pendingSortedEntries;
  pendingSortedEntries = [];
  restoreTurnIndex(pendingActiveEntryKey);
  pendingActiveEntryKey = "";
  hideTieResolver();
  openTurnOrderPanel();
  addHistoryLog("Resolved initiative tie breaker.");
  refreshCombatUI();
}

function handleSortInitiative() {
  const activeKeyBeforeSort = getActiveEntryKey();
  const activeMemberBeforeSort = getActivePrimaryMember();
  const existingLabels = new Set(getTokensOnGrid());

  elements.initiativeSetup
    .querySelectorAll(".initiative-input")
    .forEach(input => {
      const label = input.dataset.token;
      const groupId = input.dataset.groupId;

      if (groupId) {
        const group = initiativeGroups.find(existing => existing.id === groupId);
        if (group) {
          group.initiative = input.value === "" ? "" : Number(input.value);
        }
        return;
      }

      if (!label || !existingLabels.has(label) || tokenData[label]?.dead) {
        return;
      }

      if (input.value === "") {
        delete initiativeValues[label];
      } else {
        initiativeValues[label] = Number(input.value);
      }
    });

  initiativeGroups = initiativeGroups
    .map(group => ({
      ...group,
      members: group.members.filter(member => existingLabels.has(member) && !tokenData[member]?.dead)
    }))
    .filter(group => group.members.length > 1);

  const groupedMembers = new Set(initiativeGroups.flatMap(group => group.members));
  const groupEntries = initiativeGroups
    .filter(group => hasInitiativeScore(group.initiative))
    .map(group => ({
      name: group.members.join(" / "),
      members: [...group.members],
      initiative: Number(group.initiative)
    }));

  const individualEntries = Object.entries(initiativeValues)
    .filter(([label, initiative]) =>
      existingLabels.has(label) &&
      !groupedMembers.has(label) &&
      !tokenData[label]?.dead &&
      Number.isFinite(Number(initiative))
    )
    .map(([label, initiative]) => ({
      name: label,
      members: [label],
      initiative: Number(initiative)
    }));

  initiativeEntries = [...groupEntries, ...individualEntries].sort(
    (first, second) => second.initiative - first.initiative
  );

  pendingTieGroups = findInitiativeTies(initiativeEntries);
  pendingSortedEntries = [...initiativeEntries];
  pendingActiveEntryKey = activeKeyBeforeSort;

  if (pendingTieGroups.length > 0) {
    showTieResolver(pendingTieGroups[0]);
    return;
  }

  restoreTurnIndex(activeKeyBeforeSort, activeMemberBeforeSort);
  openTurnOrderPanel();
  addHistoryLog("Sorted initiative.");
  refreshCombatUI();
}

function handleGroupSelected() {
  const selected = Array.from(
    elements.initiativeSetup.querySelectorAll(".initiative-check:checked")
  ).map(checkbox => checkbox.value);

  if (selected.length < 2) {
    alert("Select at least two tokens to group.");
    return;
  }

  initiativeGroups = initiativeGroups
    .map(group => ({
      ...group,
      members: group.members.filter(member => !selected.includes(member))
    }))
    .filter(group => group.members.length > 1);

  initiativeEntries = initiativeEntries.filter(entry =>
    !entry.members.some(member => selected.includes(member))
  );

  selected.forEach(label => {
    delete initiativeValues[label];
  });

  initiativeGroups.push({
    id: `group-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    members: selected,
    initiative: ""
  });

  addHistoryLog(`Prepared initiative group: ${selected.map(getCompactLabel).join(" / ")}.`);
  openInitiativeSetupPanel();
  refreshCombatUI();
}

function handleClearInitiative() {
  const confirmed = confirm("Clear initiative order and entered initiative values? Tokens and map content will stay on the grid.");

  if (!confirmed) {
    return;
  }

  initiativeEntries = [];
  initiativeValues = {};
  initiativeGroups = [];
  currentTurnIndex = 0;
  pendingTieGroups = [];
  pendingSortedEntries = [];
  pendingActiveEntryKey = "";
  hideTieResolver();
  addHistoryLog("Cleared initiative.");
  refreshCombatUI();
}

function handleNextTurn() {
  if (initiativeEntries.length === 0) {
    return;
  }

  currentTurnIndex = (currentTurnIndex + 1) % initiativeEntries.length;
  const activeName = getActiveMembers().map(getCompactLabel).join(" / ");
  addHistoryLog(`Next turn: ${activeName}.`);
  refreshCombatUI();
}

function scheduleGridFit() {
  if (fitAnimationFrame !== null) {
    cancelAnimationFrame(fitAnimationFrame);
  }

  fitAnimationFrame = requestAnimationFrame(() => {
    fitAnimationFrame = null;
    fitGridToStage();
  });
}

function fitGridToStage() {
  const regionStyles = getComputedStyle(elements.mapRegion);
  const frameStyles = getComputedStyle(elements.gridFrame);

  const regionPaddingX =
    (parseFloat(regionStyles.paddingLeft) || 0) +
    (parseFloat(regionStyles.paddingRight) || 0);
  const regionPaddingY =
    (parseFloat(regionStyles.paddingTop) || 0) +
    (parseFloat(regionStyles.paddingBottom) || 0);

  const frameExtraX =
    (parseFloat(frameStyles.paddingLeft) || 0) +
    (parseFloat(frameStyles.paddingRight) || 0) +
    (parseFloat(frameStyles.borderLeftWidth) || 0) +
    (parseFloat(frameStyles.borderRightWidth) || 0) +
    4;
  const frameExtraY =
    (parseFloat(frameStyles.paddingTop) || 0) +
    (parseFloat(frameStyles.paddingBottom) || 0) +
    (parseFloat(frameStyles.borderTopWidth) || 0) +
    (parseFloat(frameStyles.borderBottomWidth) || 0) +
    4;

  const availableWidth = Math.max(
    0,
    elements.mapRegion.clientWidth - regionPaddingX - frameExtraX
  );

  const availableHeight = Math.max(
    0,
    elements.mapRegion.clientHeight - regionPaddingY - frameExtraY
  );

  const fittedSize = Math.floor(
    Math.min(
      availableWidth / gridWidth,
      availableHeight / gridHeight
    )
  );

  const isHugeDisplay = window.matchMedia("(min-width: 1800px)").matches;
  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  const minCell = isMobile ? 14 : 18;
  const maxCell = isHugeDisplay ? 44 : 36;
  const cellSize = Math.max(minCell, Math.min(maxCell, fittedSize || minCell));
  const currentSize = parseFloat(
    elements.grid.style.getPropertyValue("--cell-size")
  );

  if (currentSize !== cellSize) {
    elements.grid.style.setProperty("--cell-size", `${cellSize}px`);
  }
}

function bindEvents() {
  const toolBindings = [
    [elements.wallTool, "wall"],
    [elements.eraseTool, "erase"],
    [elements.playerToken, "player"],
    [elements.enemyToken, "enemy"],
    [elements.npcToken, "npc"],
    [elements.bossToken, "boss"],
    [elements.treeTool, "tree"],
    [elements.rockTool, "rock"],
    [elements.fireTool, "fire"],
    [elements.doorTool, "door"],
    [elements.waterTool, "water"],
    [elements.houseTool, "house"],
    [elements.stairsTool, "stairs"],
    [elements.chestTool, "chest"],
    [elements.treeCanopyTool, "treeCanopy"],
    [elements.boulderTool, "boulder"],
    [elements.stoneFormationTool, "stoneFormation"],
    [elements.brushThicketTool, "brushThicket"],
    [elements.ruinedWallTool, "ruinedWall"],
    [elements.stonePillarTool, "stonePillar"],
    [elements.crateStackTool, "crateStack"],
    [elements.pondTool, "pond"]
  ];

  toolBindings.forEach(([button, toolName]) => {
    button.addEventListener("click", () => setActiveTool(toolName, button));
  });

  elements.clearGrid.addEventListener("click", handleClearGrid);
  elements.applyGridSize.addEventListener("click", handleApplyGridSize);
  elements.saveMap.addEventListener("click", handleSaveMap);
  elements.loadMap.addEventListener("click", handleLoadMap);
  elements.deleteMap.addEventListener("click", handleDeleteMap);
  elements.exportData.addEventListener("click", handleExportData);
  elements.importData.addEventListener("click", handleImportData);
  elements.importDataFile.addEventListener("change", handleImportDataFile);
  elements.sceneTheme.addEventListener("change", handleSceneThemeChange);
  elements.resetSceneTheme.addEventListener("click", handleResetSceneTheme);

  elements.toggleSidebar.addEventListener("click", () => {
    const collapsed = elements.appLayout.classList.toggle("left-collapsed");
    elements.sidebarPanel.classList.toggle("collapsed", collapsed);
    elements.toggleSidebar.textContent = collapsed ? "›" : "‹";
    elements.toggleSidebar.setAttribute("aria-label", collapsed ? "Expand map controls" : "Collapse map controls");
    scheduleGridFit();
  });

  elements.toggleTracker.addEventListener("click", () => {
    const collapsed = elements.appLayout.classList.toggle("right-collapsed");
    elements.rightPanel.classList.toggle("collapsed", collapsed);
    elements.toggleTracker.textContent = collapsed ? "‹" : "›";
    elements.toggleTracker.setAttribute("aria-label", collapsed ? "Expand combat tracker" : "Collapse combat tracker");
    scheduleGridFit();
  });

  elements.turnOrderPanel.addEventListener("toggle", () => {
    if (elements.turnOrderPanel.open) {
      document.querySelector(".initiative-setup-panel")?.removeAttribute("open");
    }
  });

  document.querySelector(".initiative-setup-panel")?.addEventListener("toggle", event => {
    if (event.currentTarget.open) {
      elements.turnOrderPanel.removeAttribute("open");
    }
  });

  elements.dmNotesText.addEventListener("input", () => {
    localStorage.setItem(DM_NOTES_KEY, elements.dmNotesText.value);
  });

  elements.dmNotesTab.addEventListener("click", () => setDmWorkspaceTab("notes"));
  elements.dmHistoryTab.addEventListener("click", () => setDmWorkspaceTab("history"));
  elements.toggleDmWorkspace.addEventListener("click", toggleDmWorkspace);

  elements.groupSelected.addEventListener("click", handleGroupSelected);
  elements.sortInitiative.addEventListener("click", handleSortInitiative);
  elements.clearInitiative.addEventListener("click", handleClearInitiative);
  elements.nextTurn.addEventListener("click", handleNextTurn);
  elements.confirmTieOrder.addEventListener("click", handleConfirmTieOrder);

  elements.modalSave.addEventListener("click", saveCombatantModal);
  elements.modalCancel.addEventListener("click", closeCombatantModal);
  elements.modalClose.addEventListener("click", closeCombatantModal);
  elements.combatantModal.addEventListener("click", event => {
    if (event.target === elements.combatantModal) {
      closeCombatantModal();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !elements.combatantModal.classList.contains("hidden")) {
      closeCombatantModal();
    }
  });

  document.addEventListener("pointermove", handlePointerMove, { passive: false });
  document.addEventListener("pointerup", handlePointerEnd);
  document.addEventListener("pointercancel", handlePointerEnd);

  window.addEventListener("orientationchange", () => {
    window.setTimeout(scheduleGridFit, 100);
  });

  if ("ResizeObserver" in window) {
    const layoutObserver = new ResizeObserver(scheduleGridFit);
    layoutObserver.observe(elements.battleStage);
    layoutObserver.observe(elements.battlefieldLayout);
    layoutObserver.observe(elements.mapRegion);
    layoutObserver.observe(elements.playerStatusBoard);
    layoutObserver.observe(elements.enemyStatusStrip);
  } else {
    window.addEventListener("resize", scheduleGridFit);
  }
}

function initializeApp() {
  bindEvents();
  applySceneTheme(currentSceneTheme);
  initializeDmWorkspace();
  createGrid();
  refreshMapList();
  refreshCombatUI();
  setActiveTool("wall", elements.wallTool);
}

initializeApp();
