const currentScene = document.getElementById("currentScene");
const grid = document.getElementById("grid");
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

const playerList = document.getElementById("playerList");
const enemyList = document.getElementById("enemyList");
const npcList = document.getElementById("npcList");
const bossList = document.getElementById("bossList");

const saveMap = document.getElementById("saveMap");
const loadMap = document.getElementById("loadMap");
const mapName = document.getElementById("mapName");
const mapList = document.getElementById("mapList");
const deleteMap = document.getElementById("deleteMap");
const savedMapsKey = "aureRelicsSavedMaps";

const gridSize = 20;

let currentTool = "wall";
let isMouseDown = false;
let draggedToken = null;

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
  document.querySelectorAll(".cell").forEach(cell => {
    cell.classList.remove("wall");
    cell.innerHTML = "";
    tokenCounters = {
      player: 1,
      enemy: 1,
      npc: 1,
      boss: 1      
    };
    updateRightPanel();
  });
};

document.body.addEventListener("mousedown", () => isMouseDown = true);
document.body.addEventListener("mouseup", () => isMouseDown = false);

function applyBrush(startCell) {
  const size = Number(brushSize.value);
  const cells = Array.from(document.querySelectorAll(".cell"));
  const startIndex = cells.indexOf(startCell);

  const startRow = Math.floor(startIndex / gridSize);
  const startCol = startIndex % gridSize;

  for (let rowOffset = 0; rowOffset < size; rowOffset++) {
    for (let colOffset = 0; colOffset < size; colOffset++) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;

      if (row >= gridSize || col >= gridSize) continue;

      const index = row * gridSize + col;
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

  return mapData;
}

function applyMapData(mapData) {
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
  for (let i = 0; i < gridSize * gridSize; i++) {
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

function updateRightPanel() {
  const tokens = document.querySelectorAll(".token");

  const players = [];
  const enemies = [];
  const npcs = [];
  const bosses = [];

  tokens.forEach(token => {
    const label = token.textContent;

    if (label.startsWith("P")) players.push(label);
    else if (label.startsWith("E")) enemies.push(label);
    else if (label.startsWith("N")) npcs.push(label);
    else if (label.startsWith("B")) bosses.push(label);
  });

  playerList.textContent = players.join(", ") || "None";
  enemyList.textContent = enemies.join(", ") || "None";
  npcList.textContent = npcs.join(", ") || "None";
  bossList.textContent = bosses.join(", ") || "None";

  updateInitiativeSetup([...players, ...enemies, ...npcs, ...bosses]);
  cleanInitiativeEntries();
}

function updateInitiativeSetup(tokenLabels) {
  initiativeSetup.innerHTML = "";

  tokenLabels.forEach(label => {
    const row = document.createElement("div");
    row.classList.add("initiative-row");

    row.innerHTML = `
      <input type="checkbox" class="initiative-check" value="${label}">
      <span>${label}</span>
      <input type="number" class="initiative-input" data-token="${label}" placeholder="Init">
    `;

    initiativeSetup.appendChild(row);
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

    row.textContent = `${entry.name} — ${entry.initiative}`;

    initiativeList.appendChild(row);
  });
}

sortInitiative.onclick = () => {
  initiativeEntries = [];

  document.querySelectorAll(".initiative-input").forEach(input => {
    const value = Number(input.value);
    const token = input.dataset.token;

    if (!input.disabled && input.value !== "") {
      initiativeEntries.push({
        name: token,
        members: [token],
        initiative: value
      });
    }
  });

  initiativeEntries.sort((a, b) => b.initiative - a.initiative);
  currentTurnIndex = 0;

  renderInitiativeList();
};

groupSelected.onclick = () => {
  const selected = Array.from(document.querySelectorAll(".initiative-check:checked"))
    .map(check => check.value);

  if (selected.length < 2) {
    alert("Select at least two tokens to group.");
    return;
  }

  const initiativeValue = prompt(`Initiative for ${selected.join(" / ")}:`);

  if (initiativeValue === null || initiativeValue.trim() === "") return;

  initiativeEntries = initiativeEntries.filter(entry =>
  !entry.members.some(member => selected.includes(member))
);

  initiativeEntries.push({
    name: selected.join(" / "),
    members: selected,
    initiative: Number(initiativeValue)
  });

  selected.forEach(label => {
    const input = document.querySelector(`.initiative-input[data-token="${label}"]`);
    if (input) input.disabled = true;
  });

  initiativeEntries.sort((a, b) => b.initiative - a.initiative);
  currentTurnIndex = 0;

  renderInitiativeList();
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