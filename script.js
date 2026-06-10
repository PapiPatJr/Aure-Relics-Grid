"use strict";

const DEFAULT_GRID_WIDTH = 20;
const DEFAULT_GRID_HEIGHT = 20;
const MIN_GRID_SIZE = 5;
const MAX_GRID_SIZE = 80;
const MAX_PLAYERS = 8;
const SAVED_MAPS_KEY = "aureRelicsSavedMaps";

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

  mapName: requireElement("mapName"),
  mapList: requireElement("mapList"),
  saveMap: requireElement("saveMap"),
  loadMap: requireElement("loadMap"),
  deleteMap: requireElement("deleteMap"),

  playerStatusBoard: requireElement("playerStatusBoard"),
  enemyStatusStrip: requireElement("enemyStatusStrip"),

  initiativeSetup: requireElement("initiativeSetup"),
  initiativeList: requireElement("initiativeList"),
  groupSelected: requireElement("groupSelected"),
  sortInitiative: requireElement("sortInitiative"),
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
  modalShowHp: requireElement("modalShowHp"),
  modalShowStatus: requireElement("modalShowStatus"),
  modalShowBuff: requireElement("modalShowBuff"),
  modalSave: requireElement("modalSave"),
  modalCancel: requireElement("modalCancel")
};

if (!elements.battleStage || !elements.mapRegion || !elements.gridFrame) {
  throw new Error("The battle stage, map region, or grid frame is missing from index.html.");
}

let gridWidth = DEFAULT_GRID_WIDTH;
let gridHeight = DEFAULT_GRID_HEIGHT;
let currentTool = "wall";
let isPainting = false;
let lastPaintedCell = null;
let draggedToken = null;
let fitAnimationFrame = null;

let tokenCounters = createDefaultTokenCounters();
let tokenData = {};

let initiativeEntries = [];
let initiativeValues = {};
let currentTurnIndex = 0;
let pendingTieGroups = [];
let pendingSortedEntries = [];

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
  currentTurnIndex = 0;
  pendingTieGroups = [];
  pendingSortedEntries = [];
  hideTieResolver();
}

function isTokenTool(toolName) {
  return Object.hasOwn(TOKEN_TYPES, toolName);
}

function isTerrainTool(toolName) {
  return Object.hasOwn(TERRAIN_ICONS, toolName);
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

function createTerrainElement(icon) {
  const terrain = document.createElement("div");
  terrain.className = "terrain";
  terrain.textContent = icon;
  return terrain;
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
    cell.appendChild(createTerrainElement(TERRAIN_ICONS[currentTool]));
  }
}

function placeToken(cell, tokenType) {
  if (cell.querySelector(".token")) {
    return;
  }

  if (tokenType === "player" && tokenCounters.player > MAX_PLAYERS) {
    alert(`The player HUD supports up to ${MAX_PLAYERS} players.`);
    return;
  }

  const config = TOKEN_TYPES[tokenType];
  const label = `${config.prefix}${tokenCounters[tokenType]}`;
  tokenCounters[tokenType] += 1;

  ensureTokenData(label);
  cell.appendChild(createTokenElement(label, config.color));
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

      if (!isTokenTool(currentTool)) {
        isPainting = true;
        lastPaintedCell = cell;
      }
    });

    elements.grid.appendChild(cell);
  }

  scheduleGridFit();
}

function handlePointerMove(event) {
  if (!isPainting || draggedToken) {
    return;
  }

  const target = document.elementFromPoint(event.clientX, event.clientY);
  const cell = target?.closest(".cell");

  if (!cell || cell === lastPaintedCell || !elements.grid.contains(cell)) {
    return;
  }

  event.preventDefault();
  applyTool(cell);
  lastPaintedCell = cell;
}

function handlePointerEnd(event) {
  if (draggedToken) {
    const hasCoordinates =
      Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
    const target = hasCoordinates
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null;
    const destinationCell = target?.closest(".cell");

    if (destinationCell && elements.grid.contains(destinationCell)) {
      destinationCell.appendChild(draggedToken);
      refreshCombatUI();
    }

    draggedToken.style.cursor = "grab";
    draggedToken = null;
  }

  isPainting = false;
  lastPaintedCell = null;
}

function clearGridContents() {
  elements.grid.querySelectorAll(".cell").forEach(cell => {
    cell.classList.remove("wall");
    cell.innerHTML = "";
  });
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
      terrain: terrain?.textContent || null,
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
    cells,
    tokenData,
    initiativeEntries,
    initiativeValues,
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
    currentTurnIndex = 0;
    cellData = savedData;
  } else if (
    savedData &&
    Number.isInteger(Number(savedData.width)) &&
    Number.isInteger(Number(savedData.height)) &&
    Array.isArray(savedData.cells)
  ) {
    gridWidth = Number(savedData.width);
    gridHeight = Number(savedData.height);
    tokenData = savedData.tokenData || {};
    Object.keys(tokenData).forEach(ensureTokenData);
    initiativeEntries = normalizeInitiativeEntries(savedData.initiativeEntries);
    initiativeValues = savedData.initiativeValues || {};
    currentTurnIndex = Number(savedData.currentTurnIndex) || 0;
    cellData = savedData.cells;
  } else {
    throw new Error("The selected scene contains invalid map data.");
  }

  elements.gridWidthInput.value = String(gridWidth);
  elements.gridHeightInput.value = String(gridHeight);

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
      cell.appendChild(createTerrainElement(data.terrain));
    }

    if (data.token?.label) {
      ensureTokenData(data.token.label);
      const type = getTokenType(data.token.label);
      const fallbackColor = TOKEN_TYPES[type]?.color || "crimson";
      cell.appendChild(createTokenElement(data.token.label, data.token.color || fallbackColor));
    }
  });

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

  return Boolean(
    savedData &&
    Number.isInteger(Number(savedData.width)) &&
    Number.isInteger(Number(savedData.height)) &&
    Array.isArray(savedData.cells)
  );
}

function saveSavedMaps(maps) {
  localStorage.setItem(SAVED_MAPS_KEY, JSON.stringify(maps));
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
    token.classList.toggle(
      "active-combatant",
      activeMembers.has(getTokenLabel(token))
    );
  });

  document.querySelectorAll(".hud-card").forEach(card => {
    card.classList.toggle(
      "active-combatant",
      activeMembers.has(card.dataset.tokenId)
    );
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
  typeTag.textContent = type === "player" ? "" : TOKEN_TYPES[type]?.label || "";

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
  topLine.appendChild(settings);
  card.appendChild(topLine);

  return card;
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
  data.showHp = elements.modalShowHp.checked;
  data.showStatus = elements.modalShowStatus.checked;
  data.showBuff = elements.modalShowBuff.checked;

  closeCombatantModal();
  refreshCombatUI();
}

function renderInitiativeSetup(labels) {
  const groupedMembers = new Set(
    initiativeEntries.flatMap(entry => entry.members)
  );

  elements.initiativeSetup.innerHTML = "";

  labels.forEach(label => {
    const row = document.createElement("div");
    row.className = "initiative-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "initiative-check";
    checkbox.value = label;
    checkbox.disabled = groupedMembers.has(label);
    checkbox.setAttribute("aria-label", `Select ${getDisplayName(label)} for grouping`);

    const name = document.createElement("span");
    name.textContent = getCompactLabel(label);

    const input = document.createElement("input");
    input.type = "number";
    input.className = "initiative-input";
    input.dataset.token = label;
    input.placeholder = "Init";
    input.value = initiativeValues[label] ?? "";
    input.disabled = groupedMembers.has(label);
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
    label.textContent = `${index + 1}. ${entry.members
      .map(getCompactLabel)
      .join(" / ")}`;

    const initiativeScore = document.createElement("strong");
    initiativeScore.className = "turn-initiative";
    initiativeScore.textContent = String(entry.initiative);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-entry";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Remove ${label.textContent} from initiative`);

    removeButton.addEventListener("click", () => {
      entry.members.forEach(member => {
        initiativeValues[member] = entry.initiative;
      });

      initiativeEntries.splice(index, 1);

      if (currentTurnIndex >= initiativeEntries.length) {
        currentTurnIndex = 0;
      }

      refreshCombatUI();
    });

    row.append(label, initiativeScore, removeButton);
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

  const orderedEntries = Array.from(
    elements.tieOrderList.querySelectorAll(".tie-row")
  )
    .map(row => entryMap.get(row.dataset.entryKey))
    .filter(Boolean);

  const tieInitiative = currentTieGroup[0].initiative;
  const tiedIndices = pendingSortedEntries
    .map((entry, index) =>
      entry.initiative === tieInitiative ? index : -1
    )
    .filter(index => index >= 0);

  tiedIndices.forEach((index, orderIndex) => {
    pendingSortedEntries[index] = orderedEntries[orderIndex];
  });

  if (pendingTieGroups.length > 0) {
    showTieResolver(pendingTieGroups[0]);
    return;
  }

  initiativeEntries = pendingSortedEntries;
  pendingSortedEntries = [];
  currentTurnIndex = 0;
  hideTieResolver();
  refreshCombatUI();
}

function handleSortInitiative() {
  const existingLabels = new Set(getTokensOnGrid());
  const groupedMembers = new Set(
    initiativeEntries.flatMap(entry => entry.members)
  );

  elements.initiativeSetup
    .querySelectorAll(".initiative-input")
    .forEach(input => {
      const label = input.dataset.token;

      if (!label || groupedMembers.has(label)) {
        return;
      }

      if (input.value === "") {
        delete initiativeValues[label];
      } else {
        initiativeValues[label] = Number(input.value);
      }
    });

  const groups = initiativeEntries.filter(entry => entry.members.length > 1);
  const individuals = Object.entries(initiativeValues)
    .filter(([label]) => existingLabels.has(label) && !groupedMembers.has(label))
    .map(([label, initiative]) => ({
      name: label,
      members: [label],
      initiative: Number(initiative)
    }));

  initiativeEntries = [...groups, ...individuals].sort(
    (first, second) => second.initiative - first.initiative
  );

  pendingTieGroups = findInitiativeTies(initiativeEntries);
  pendingSortedEntries = [...initiativeEntries];

  if (pendingTieGroups.length > 0) {
    showTieResolver(pendingTieGroups[0]);
    return;
  }

  currentTurnIndex = 0;
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

  const input = prompt(`Initiative for ${selected.map(getCompactLabel).join(" / ")}:`);

  if (input === null || input.trim() === "") {
    return;
  }

  const initiative = Number(input);

  if (!Number.isFinite(initiative)) {
    alert("Enter a valid initiative number.");
    return;
  }

  initiativeEntries = initiativeEntries.filter(entry =>
    !entry.members.some(member => selected.includes(member))
  );

  selected.forEach(label => {
    delete initiativeValues[label];
  });

  initiativeEntries.push({
    name: selected.join(" / "),
    members: selected,
    initiative
  });

  initiativeEntries.sort(
    (first, second) => second.initiative - first.initiative
  );
  currentTurnIndex = 0;
  refreshCombatUI();
}

function handleNextTurn() {
  if (initiativeEntries.length === 0) {
    return;
  }

  currentTurnIndex = (currentTurnIndex + 1) % initiativeEntries.length;
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
    [elements.chestTool, "chest"]
  ];

  toolBindings.forEach(([button, toolName]) => {
    button.addEventListener("click", () => setActiveTool(toolName, button));
  });

  elements.clearGrid.addEventListener("click", handleClearGrid);
  elements.applyGridSize.addEventListener("click", handleApplyGridSize);
  elements.saveMap.addEventListener("click", handleSaveMap);
  elements.loadMap.addEventListener("click", handleLoadMap);
  elements.deleteMap.addEventListener("click", handleDeleteMap);

  elements.groupSelected.addEventListener("click", handleGroupSelected);
  elements.sortInitiative.addEventListener("click", handleSortInitiative);
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
  createGrid();
  refreshMapList();
  refreshCombatUI();
  setActiveTool("wall", elements.wallTool);
}

initializeApp();
