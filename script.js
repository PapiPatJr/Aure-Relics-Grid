const currentScene = document.getElementById("currentScene");
const grid = document.getElementById("grid");
const gridWidthInput = document.getElementById("gridWidthInput");
const gridHeightInput = document.getElementById("gridHeightInput");
const applyGridSize = document.getElementById("applyGridSize");
const brushSize = document.getElementById("brushSize");
const wallTool = document.getElementById("wallTool");
const eraseTool = document.getElementById("eraseTool");
const clearGrid = document.getElementById("clearGrid");
const treeTool = document.getElementById("treeTool");
const rockTool = document.getElementById("rockTool");
const fireTool = document.getElementById("fireTool");
const doorTool = document.getElementById("doorTool");
const waterTool = document.getElementById("waterTool");
const houseTool = document.getElementById("houseTool");
const stairsTool = document.getElementById("stairsTool");
const chestTool = document.getElementById("chestTool");

const initiativeSetup = document.getElementById("initiativeSetup");
const initiativeList = document.getElementById("initiativeList");
const groupSelected = document.getElementById("groupSelected");
const sortInitiative = document.getElementById("sortInitiative");
const nextTurn = document.getElementById("nextTurn");

let initiativeEntries = [];
let currentTurnIndex = 0;
let initiativeValues = {};

const playerToken = document.getElementById("playerToken");
const enemyToken = document.getElementById("enemyToken");
const npcToken = document.getElementById("npcToken");
const bossToken = document.getElementById("bossToken");

let tokenCounters = {
  player: 1,
  enemy: 1,
  npc: 1,
  boss: 1
};

const saveMap = document.getElementById("saveMap");
const loadMap = document.getElementById("loadMap");
const mapName = document.getElementById("mapName");
const mapList = document.getElementById("mapList");
const deleteMap = document.getElementById("deleteMap");
const savedMapsKey = "aureRelicsSavedMaps";

let gridWidth = 20;
let gridHeight = 20;

let currentTool = "wall";
let isMouseDown = false;
let draggedToken = null;

const tieResolver = document.getElementById("tieResolver");
const tieOrderList = document.getElementById("tieOrderList");
const confirmTieOrder = document.getElementById("confirmTieOrder");

let pendingTieGroups = [];
let pendingSortedEntries = [];

const playerStatusBoard = document.getElementById("playerStatusBoard");
const enemyStatusStrip = document.getElementById("enemyStatusStrip");

let tokenData = {};

wallTool.onclick = () => setActiveTool("wall", wallTool);
eraseTool.onclick = () => setActiveTool("erase", eraseTool);

playerToken.onclick = () => setActiveTool("player", playerToken);
enemyToken.onclick = () => setActiveTool("enemy", enemyToken);
npcToken.onclick = () => setActiveTool("npc", npcToken);
bossToken.onclick = () => setActiveTool("boss", bossToken);

treeTool.onclick = () => setActiveTool("tree", treeTool);
rockTool.onclick = () => setActiveTool("rock", rockTool);
fireTool.onclick = () => setActiveTool("fire", fireTool);
doorTool.onclick = () => setActiveTool("door", doorTool);
waterTool.onclick = () => setActiveTool("water", waterTool);
houseTool.onclick = () => setActiveTool("house", houseTool);
stairsTool.onclick = () => setActiveTool("stairs", stairsTool);
chestTool.onclick = () => setActiveTool("chest", chestTool);

clearGrid.onclick = () => {
  const confirmClear = confirm(
    "Are you sure you want to clear the grid? This will remove all walls, terrain, tokens, initiative, and status data. Save your scene first if you want to keep it."
  );

  if (!confirmClear) return;

  document.querySelectorAll(".cell").forEach(cell => {
    cell.classList.remove("wall");
    cell.innerHTML = "";
  });

  tokenCounters = {
    player: 1,
    enemy: 1,
    npc: 1,
    boss: 1
  };

  initiativeEntries = [];
  initiativeValues = {};
  tokenData = {};

  updateRightPanel();
  renderInitiativeList();

  currentScene.textContent = "No Scene Loaded";
};

document.body.addEventListener("mousedown", () => isMouseDown = true);
document.body.addEventListener("mouseup", () => isMouseDown = false);

function applyBrush(startCell) {
  const size = Number(brushSize.value);
  const cells = Array.from(document.querySelectorAll(".cell"));
  const startIndex = cells.indexOf(startCell);

  const startRow = Math.floor(startIndex / gridWidth);
  const startCol = startIndex % gridWidth;

  for (let rowOffset = 0; rowOffset < size; rowOffset++) {
    for (let colOffset = 0; colOffset < size; colOffset++) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;

      if (row >= gridHeight || col >= gridWidth) continue;

      const index = row * gridWidth + col;
      const cell = cells[index];

      applyTool(cell, true);
    }
  }
}

function setActiveTool(toolName, buttonElement) {
  currentTool = toolName;

  const allButtons = document.querySelectorAll(".sidebar button");

  allButtons.forEach(btn => {
    btn.classList.remove("active-tool");
  });

  buttonElement.classList.add("active-tool");
}

function applyTool(cell, fromBrush = false) {
    if (!fromBrush && !["player", "enemy", "npc", "boss"].includes(currentTool)) {
    applyBrush(cell);
    return;
  }
  if (currentTool === "wall") {
    cell.classList.add("wall");
  }

if (currentTool === "erase") {
  cell.classList.remove("wall");

  const terrain = cell.querySelector(".terrain");
  if (terrain) terrain.remove();

  const token = cell.querySelector(".token");
  if (token) token.remove();

  updateRightPanel();
}

if (
  currentTool === "player" ||
  currentTool === "enemy" ||
  currentTool === "npc" ||
  currentTool === "boss"
) {
  if (!cell.querySelector(".token")) {

    const token = document.createElement("div");
    token.classList.add("token");

    let label = "";
    let color = "";

    if (currentTool === "player") {
      label = "P" + tokenCounters.player;
      color = "blue";
      tokenCounters.player++;
    }

    if (currentTool === "enemy") {
      label = "E" + tokenCounters.enemy;
      color = "crimson";
      tokenCounters.enemy++;
    }

    if (currentTool === "npc") {
      label = "N" + tokenCounters.npc;
      color = "green";
      tokenCounters.npc++;
    }

    if (currentTool === "boss") {
      label = "B" + tokenCounters.boss;
      color = "purple";
      tokenCounters.boss++;
    }

    token.textContent = label;
    token.style.background = color;

    token.draggable = true;

    token.addEventListener("dragstart", (e) => {
      draggedToken = token;
      e.stopPropagation();
    });

    cell.appendChild(token);
    updateRightPanel();
  }
}

if (
  currentTool === "tree" ||
  currentTool === "rock" ||
  currentTool === "fire" ||
  currentTool === "door" ||
  currentTool === "water" ||
  currentTool === "house" ||
  currentTool === "stairs" ||
  currentTool === "chest"
) {
  cell.classList.remove("wall");

  const existingTerrain = cell.querySelector(".terrain");
  if (existingTerrain) {
    existingTerrain.remove();
  }

  const terrain = document.createElement("div");
  terrain.classList.add("terrain");

  if (currentTool === "tree") terrain.textContent = "🌲";
  if (currentTool === "rock") terrain.textContent = "🪨";
  if (currentTool === "fire") terrain.textContent = "🔥";
  if (currentTool === "door") terrain.textContent = "🚪";
  if (currentTool === "water") terrain.textContent = "💧";
  if (currentTool === "house") terrain.textContent = "🏠";
  if (currentTool === "stairs") terrain.textContent = "⬇️";
  if (currentTool === "chest") terrain.textContent = "🧰";

  cell.appendChild(terrain);
}
}

function getCurrentMapData() {
  const mapData = [];

  document.querySelectorAll(".cell").forEach(cell => {
    const terrain = cell.querySelector(".terrain");
    const token = cell.querySelector(".token");

    mapData.push({
      wall: cell.classList.contains("wall"),
      terrain: terrain ? terrain.textContent : null,
      token: token
        ? {
            label: token.textContent,
            color: token.style.background
          }
        : null
    });
  });

  return {
  width: gridWidth,
  height: gridHeight,
  cells: mapData,
  tokenData: tokenData
  };
}

function applyMapData(mapData) {
  // New save format:
  // { width, height, cells, tokenData }
  if (mapData.width && mapData.height && mapData.cells) {
    gridWidth = mapData.width;
    gridHeight = mapData.height;

    gridWidthInput.value = gridWidth;
    gridHeightInput.value = gridHeight;

    tokenData = mapData.tokenData || {};

    createGrid();

    mapData = mapData.cells;
  }

    else if (Array.isArray(mapData)) {
    gridWidth = 20;
    gridHeight = 20;

    gridWidthInput.value = gridWidth;
    gridHeightInput.value = gridHeight;

    createGrid();
  }

  // Old save format:
  // [cell, cell, cell]
  const cells = document.querySelectorAll(".cell");

  cells.forEach((cell, index) => {
    cell.classList.remove("wall");
    cell.innerHTML = "";

    const data = mapData[index];
    if (!data) return;

    if (data.wall) {
      cell.classList.add("wall");
    }

    if (data.terrain) {
      const terrain = document.createElement("div");
      terrain.classList.add("terrain");
      terrain.textContent = data.terrain;
      cell.appendChild(terrain);
    }

    if (data.token) {
      const token = document.createElement("div");
      token.classList.add("token");
      token.textContent = data.token.label;
      token.style.background = data.token.color;
      token.draggable = true;

      token.addEventListener("dragstart", (e) => {
        draggedToken = token;
        e.stopPropagation();
      });

      cell.appendChild(token);
    }
  });
}

function getSavedMaps() {
  return JSON.parse(localStorage.getItem(savedMapsKey)) || {};
}

function saveSavedMaps(maps) {
  localStorage.setItem(savedMapsKey, JSON.stringify(maps));
}

function refreshMapList() {
  const maps = getSavedMaps();

  mapList.innerHTML = `<option value="">Select Scene</option>`;

  Object.keys(maps).forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    mapList.appendChild(option);
  });
}

saveMap.onclick = () => {
  const name = mapName.value.trim();

  if (!name) {
    alert("Enter a scene name first.");
    return;
  }

  const maps = getSavedMaps();
  maps[name] = getCurrentMapData();

  saveSavedMaps(maps);
  refreshMapList();

  mapList.value = name;
  currentScene.textContent = name;

  alert(`Scene saved: ${name}`);
};

loadMap.onclick = () => {
  const name = mapList.value;

  if (!name) {
    alert("Select a scene first.");
    return;
  }

  const maps = getSavedMaps();
  applyMapData(maps[name]);

  currentScene.textContent = name;

  alert(`Scene loaded: ${name}`);
updateRightPanel();
};

deleteMap.onclick = () => {
  const name = mapList.value;

  if (!name) {
    alert("Select a scene first.");
    return;
  }

  const maps = getSavedMaps();
  delete maps[name];

  saveSavedMaps(maps);
  refreshMapList();

  currentScene.textContent = "No Scene Loaded";

  alert(`Scene deleted: ${name}`);
};

function createGrid() {
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${gridWidth}, 32px)`;
  grid.style.gridTemplateRows = `repeat(${gridHeight}, 32px)`;

  for (let i = 0; i < gridWidth * gridHeight; i++) {
    const cell = document.createElement("div");
    cell.classList.add("cell");

     cell.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("token") && currentTool !== "erase") {
  return;
}

e.preventDefault();
applyTool(cell);
});

    cell.addEventListener("mouseenter", () => {
      if (draggedToken) {
        return;
  }

    if (isMouseDown && currentTool !== "token") {
      applyTool(cell);
  }
});

    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    cell.addEventListener("drop", () => {
  if (draggedToken) {
    cell.appendChild(draggedToken);
    draggedToken = null;
    isMouseDown = false;
    updateRightPanel();
  }
});

    grid.appendChild(cell);
  }
}

applyGridSize.onclick = () => {
  const newWidth = Number(gridWidthInput.value);
  const newHeight = Number(gridHeightInput.value);

  if (!newWidth || !newHeight || newWidth < 5 || newHeight < 5) {
    alert("Grid width and height must be at least 5.");
    return;
  }

  const confirmChange = confirm(
    "Changing grid size will clear the current grid. Save your scene first if you want to keep it. Continue?"
  );

  if (!confirmChange) return;

  gridWidth = newWidth;
  gridHeight = newHeight;

  tokenCounters = {
    player: 1,
    enemy: 1,
    npc: 1,
    boss: 1
  };

  initiativeEntries = [];
  initiativeValues = {};
  tokenData = {};

  currentScene.textContent = "No Scene Loaded";

  createGrid();
  updateRightPanel();
};

const dndStatuses = [
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

const buffOptions = [
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

function getTokenType(label) {
  if (label.startsWith("P")) return "player";
  if (label.startsWith("E")) return "enemy";
  if (label.startsWith("N")) return "npc";
  if (label.startsWith("B")) return "boss";
  return "unknown";
}

function ensureTokenData(label) {
  if (!tokenData[label]) {
    tokenData[label] = {
      name: "",
      hp: "",
      maxHp: "",
      status: "Normal",
      buff: "None",
      type: getTokenType(label)
    };
  }
}

function getDisplayName(label) {
  ensureTokenData(label);
  const name = tokenData[label].name.trim();

  return name ? `${name} (${label})` : label;
}

function updateRightPanel() {
  const tokens = document.querySelectorAll(".token");

  const players = [];
  const enemies = [];
  const npcs = [];
  const bosses = [];

  tokens.forEach(token => {
    const label = token.textContent;
    ensureTokenData(label);

    if (label.startsWith("P")) players.push(label);
    else if (label.startsWith("E")) enemies.push(label);
    else if (label.startsWith("N")) npcs.push(label);
    else if (label.startsWith("B")) bosses.push(label);
  });

  renderPlayerStatusBoard(players);
  renderEnemyStatusStrip([...enemies, ...npcs, ...bosses]);

  updateInitiativeSetup([...players, ...enemies, ...npcs, ...bosses]);
  cleanInitiativeEntries();
}

function renderPlayerStatusBoard(players) {
  playerStatusBoard.innerHTML = "";

  const totalSlots = players.length <= 4 ? 4 : players.length;

for (let i = 0; i < totalSlots; i++) {
    const label = players[i];

    const card = document.createElement("div");
    card.classList.add("player-card");

    if (!label) {
      card.classList.add("empty-player-card");
      playerStatusBoard.appendChild(card);
      continue;
    }

    ensureTokenData(label);
    const data = tokenData[label];

    const hp = Number(data.hp) || 0;
    const maxHp = Number(data.maxHp) || 1;
    const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));

    card.innerHTML = `
      <input class="token-name-input" data-token="${label}" placeholder="${label} name" value="${data.name}">
      
      <div class="hp-row">
        <input class="hp-input" data-token="${label}" data-field="hp" type="text" inputmode="numeric" placeholder="HP" value="${data.hp}">
        <span>/</span>
        <input class="hp-input" data-token="${label}" data-field="maxHp" type="text" inputmode="numeric" placeholder="Max" value="${data.maxHp}">
      </div>

      <div class="hp-bar">
        <div class="hp-fill" style="width: ${hpPercent}%"></div>
      </div>

      <select class="status-select" data-token="${label}" data-field="status">
        ${dndStatuses.map(status => `
          <option value="${status}" ${data.status === status ? "selected" : ""}>${status}</option>
        `).join("")}
      </select>

      <select class="status-select" data-token="${label}" data-field="buff">
        ${buffOptions.map(buff => `
          <option value="${buff}" ${data.buff === buff ? "selected" : ""}>${buff}</option>
        `).join("")}
      </select>
    `;

    playerStatusBoard.appendChild(card);
  }

  attachStatusBoardEvents();
}

function renderEnemyStatusStrip(tokens) {
  enemyStatusStrip.innerHTML = "";

  tokens.forEach(label => {
    ensureTokenData(label);

    const chip = document.createElement("div");
    chip.classList.add("enemy-chip");

    chip.innerHTML = `
      <div class="enemy-token-id">${label}</div>
      <input 
        class="token-name-input enemy-name-input" 
        data-token="${label}" 
        placeholder="Name" 
        value="${tokenData[label].name}"
      >
    `;

    enemyStatusStrip.appendChild(chip);
  });

  attachStatusBoardEvents();
}

function attachStatusBoardEvents() {
  document.querySelectorAll(".token-name-input").forEach(input => {
    input.oninput = () => {
      const label = input.dataset.token;
      ensureTokenData(label);

      tokenData[label].name = input.value;

      const chip = input.closest(".enemy-chip");
      if (chip) {
        const display = chip.querySelector(".enemy-display-name");
        if (display) {
          display.textContent = getDisplayName(label);
        }
      }

      renderInitiativeList();
    };
  });

  document.querySelectorAll(".hp-input").forEach(input => {
    input.oninput = () => {
      const label = input.dataset.token;
      const field = input.dataset.field;

      ensureTokenData(label);
      tokenData[label][field] = input.value;

      const card = input.closest(".player-card");

      const hp = Number(tokenData[label].hp) || 0;
      const maxHp = Number(tokenData[label].maxHp) || 1;

      const percent = Math.max(
        0,
        Math.min(100, (hp / maxHp) * 100)
      );

      const hpFill = card.querySelector(".hp-fill");

      if (hpFill) {
        hpFill.style.width = `${percent}%`;
      }
    };
  });

  document.querySelectorAll(".status-select").forEach(select => {
    select.onchange = () => {
      const label = select.dataset.token;
      const field = select.dataset.field;

      ensureTokenData(label);

      if (select.value === "Custom...") {
        const customValue = prompt(`Enter custom ${field}:`);

        if (customValue && customValue.trim() !== "") {
          tokenData[label][field] = customValue.trim();

          if (!Array.from(select.options).some(option => option.value === customValue.trim())) {
            const option = document.createElement("option");
            option.value = customValue.trim();
            option.textContent = customValue.trim();
            select.insertBefore(option, select.lastElementChild);
          }

          select.value = customValue.trim();
        } else {
          select.value = tokenData[label][field];
        }
      } else {
        tokenData[label][field] = select.value;
      }
    };
  });
}

function updateInitiativeSetup(tokenLabels) {
  const existingGroupedMembers = initiativeEntries.flatMap(entry => entry.members);

  initiativeSetup.innerHTML = "";

  tokenLabels.forEach(label => {
    const isGrouped = existingGroupedMembers.includes(label);

    const row = document.createElement("div");
    row.classList.add("initiative-row");

    row.innerHTML = `
      <input type="checkbox" class="initiative-check" value="${label}" ${isGrouped ? "disabled" : ""}>
      <span>${label}</span>
      <input 
        type="number" 
        class="initiative-input" 
        data-token="${label}" 
        placeholder="Init"
        value="${initiativeValues[label] ?? ""}"
        ${isGrouped ? "disabled" : ""}
      >
    `;

    initiativeSetup.appendChild(row);
  });

  document.querySelectorAll(".initiative-input").forEach(input => {
    input.addEventListener("input", () => {
      const token = input.dataset.token;

      if (input.value === "") {
        delete initiativeValues[token];
      } else {
        initiativeValues[token] = Number(input.value);
      }
    });
  });
}

function cleanInitiativeEntries() {
  const existingTokens = Array.from(document.querySelectorAll(".token"))
    .map(token => token.textContent);

  initiativeEntries = initiativeEntries
    .map(entry => {
      const remainingMembers = entry.members.filter(member =>
        existingTokens.includes(member)
      );

      return {
        ...entry,
        members: remainingMembers,
        name: remainingMembers.join(" / ")
      };
    })
    .filter(entry => entry.members.length > 0);

  Object.keys(initiativeValues).forEach(token => {
    if (!existingTokens.includes(token)) {
      delete initiativeValues[token];
    }
  });

  if (currentTurnIndex >= initiativeEntries.length) {
    currentTurnIndex = 0;
  }

  renderInitiativeList();
}

function renderInitiativeList() {
  initiativeList.innerHTML = "";

  initiativeEntries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.classList.add("turn-row");

    if (index === currentTurnIndex) {
      row.classList.add("active-turn");
    }

    const label = document.createElement("span");
    label.textContent = `${entry.members.map(member => getDisplayName(member)).join(" / ")} — ${entry.initiative}`;

    const removeButton = document.createElement("button");
    removeButton.textContent = "Remove";
    removeButton.classList.add("remove-entry");

    removeButton.onclick = () => {
      entry.members.forEach(member => {
        initiativeValues[member] = entry.initiative;
      });

      initiativeEntries.splice(index, 1);

      if (currentTurnIndex >= initiativeEntries.length) {
        currentTurnIndex = 0;
      }

      renderInitiativeList();
      updateRightPanel();
};

    row.appendChild(label);
    row.appendChild(removeButton);
    initiativeList.appendChild(row);
  });
}

function findInitiativeTies(entries) {
  const groups = {};

  entries.forEach(entry => {
    if (!groups[entry.initiative]) {
      groups[entry.initiative] = [];
    }

    groups[entry.initiative].push(entry);
  });

  return Object.values(groups).filter(group => group.length > 1);
}

function showTieResolver(tieGroup) {
  tieResolver.classList.remove("hidden");
  tieOrderList.innerHTML = "";

  tieGroup.forEach(entry => {
    const row = document.createElement("div");
    row.classList.add("tie-row");

    row.innerHTML = `
      <span>${entry.name}</span>
      <button class="move-up">↑</button>
      <button class="move-down">↓</button>
    `;

    row.dataset.name = entry.name;
    tieOrderList.appendChild(row);
  });

  tieOrderList.querySelectorAll(".move-up").forEach(button => {
    button.onclick = () => {
      const row = button.parentElement;
      const previous = row.previousElementSibling;

      if (previous) {
        tieOrderList.insertBefore(row, previous);
      }
    };
  });

  tieOrderList.querySelectorAll(".move-down").forEach(button => {
    button.onclick = () => {
      const row = button.parentElement;
      const next = row.nextElementSibling;

      if (next) {
        tieOrderList.insertBefore(next, row);
      }
    };
  });
}

confirmTieOrder.onclick = () => {
  if (pendingTieGroups.length === 0) return;

  const currentTieGroup = pendingTieGroups.shift();

  const orderedNames = Array.from(tieOrderList.querySelectorAll(".tie-row"))
    .map(row => row.dataset.name);

  const orderedTieEntries = orderedNames.map(name =>
    currentTieGroup.find(entry => entry.name === name)
  );

  const tieInitiative = currentTieGroup[0].initiative;

  pendingSortedEntries = pendingSortedEntries.filter(entry =>
    entry.initiative !== tieInitiative
  );

  const insertIndex = pendingSortedEntries.findIndex(entry =>
    entry.initiative < tieInitiative
  );

  if (insertIndex === -1) {
    pendingSortedEntries.push(...orderedTieEntries);
  } else {
    pendingSortedEntries.splice(insertIndex, 0, ...orderedTieEntries);
  }

  if (pendingTieGroups.length > 0) {
    showTieResolver(pendingTieGroups[0]);
    return;
  }

  initiativeEntries = pendingSortedEntries;
  pendingSortedEntries = [];

  tieResolver.classList.add("hidden");
  tieOrderList.innerHTML = "";

  currentTurnIndex = 0;
  renderInitiativeList();
  updateRightPanel();
};

sortInitiative.onclick = () => {
  const groupedMembers = initiativeEntries.flatMap(entry => entry.members);

  document.querySelectorAll(".initiative-input").forEach(input => {
    const token = input.dataset.token;

    if (groupedMembers.includes(token)) return;

    if (input.value !== "") {
      initiativeValues[token] = Number(input.value);
    }
  });

  const individualEntries = Object.keys(initiativeValues)
    .filter(token => !groupedMembers.includes(token))
    .map(token => ({
      name: token,
      members: [token],
      initiative: initiativeValues[token]
    }));

  initiativeEntries = [
    ...initiativeEntries.filter(entry => entry.members.length > 1),
    ...individualEntries
  ];

  initiativeEntries.sort((a, b) => b.initiative - a.initiative);

pendingTieGroups = findInitiativeTies(initiativeEntries);
pendingSortedEntries = [...initiativeEntries];

if (pendingTieGroups.length > 0) {
  showTieResolver(pendingTieGroups[0]);
  return;
}

currentTurnIndex = 0;
renderInitiativeList();
updateRightPanel();
};

groupSelected.onclick = () => {
  const selected = Array.from(document.querySelectorAll(".initiative-check:checked"))
    .map(check => check.value);

  if (selected.length < 2) {
    alert("Select at least two tokens to group.");
    return;
  }

  const initiativeValue = prompt(`Initiative for ${selected.join(" / ")}:`);

  if (initiativeValue === null || initiativeValue.trim() === "") {
    return;
  }

  initiativeEntries = initiativeEntries.filter(entry =>
    !entry.members.some(member => selected.includes(member))
  );

  selected.forEach(token => {
    delete initiativeValues[token];
  });

  initiativeEntries.push({
    name: selected.join(" / "),
    members: selected,
    initiative: Number(initiativeValue)
  });

  initiativeEntries.sort((a, b) => b.initiative - a.initiative);
  currentTurnIndex = 0;

  renderInitiativeList();
  updateRightPanel();
};

nextTurn.onclick = () => {
  if (initiativeEntries.length === 0) return;

  currentTurnIndex++;

  if (currentTurnIndex >= initiativeEntries.length) {
    currentTurnIndex = 0;
  }

  renderInitiativeList();
};

createGrid();
refreshMapList();
setActiveTool("wall", wallTool);