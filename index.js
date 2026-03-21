// --- Instances ---
const player = new Player(0, 0);
const player2 = new Player(63, 63);
const players = [player, player2];

const mines = [];
const riverMines = [];

// --- Turn State ---
let currentPlayerIndex = 0;
let turnNumber = 1;
let gameOver = false;
let selectedItem = null; // the mine/river the player clicked on
let selectedType = null; // "mine" or "river"

// --- Grid State ---
const grid = Array.from({ length: GRID_SIZE }, () =>
  Array.from({ length: GRID_SIZE }, () => ({ color: null }))
);

// --- Canvas Setup ---
const canvas = document.getElementById("grid");
canvas.width = GRID_SIZE * CELL_PX;
canvas.height = GRID_SIZE * CELL_PX;
const ctx = canvas.getContext("2d");

// --- Helpers ---

function getCell(x, y) {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return null;
  return grid[y][x];
}

function setCell(x, y, color) {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
  grid[y][x].color = color;
}

function pxToGrid(px, py) {
  return {
    x: Math.floor(px / CELL_PX),
    y: Math.floor(py / CELL_PX),
  };
}

function clearGrid() {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      grid[y][x].color = null;
    }
  }
}

function randInt(max) {
  return Math.floor(Math.random() * max);
}

function isCellFree(x, y) {
  const cell = getCell(x, y);
  return cell && cell.color === null;
}

function isInPlayerZone(x, y) {
  const ZONE = 10;
  for (const p of players) {
    if (Math.abs(x - p.x) < ZONE && Math.abs(y - p.y) < ZONE) {
      return true;
    }
  }
  return false;
}

function randomFreeCell() {
  let x, y;
  do {
    x = randInt(GRID_SIZE);
    y = randInt(GRID_SIZE);
  } while (!isCellFree(x, y) || isInPlayerZone(x, y));
  return { x, y };
}

function dist(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function plotMine(x, y, options = {}) {
  const mine = new Mine(x, y, options);
  mine.owner = null;
  mines.push(mine);
  setCell(x, y, MINE_COLOR);
  return mine;
}

function plotRiver(x, y, options = {}) {
  const rm = new RiverMine(x, y, options);
  rm.owner = null;
  riverMines.push(rm);
  rm.place(setCell);
  return rm;
}

// --- Scene Generation ---

const NUM_MINES = 10;
const NUM_RIVERS = 5;

function generateScene() {
  clearGrid();
  mines.length = 0;
  riverMines.length = 0;

  for (let i = 0; i < NUM_MINES; i++) {
    const { x, y } = randomFreeCell();
    const level = randInt(3) + 1;
    plotMine(x, y, {
      reward: level * 10,
      level: level,
      risk: Math.round((level * 0.2 + 0.1) * 100) / 100,
    });
  }

  for (let i = 0; i < NUM_RIVERS; i++) {
    const { x, y } = randomFreeCell();
    const level = randInt(3) + 1;
    plotRiver(x, y, { reward: level * 8, level: level });
  }
}

// --- Find item at grid coordinate ---

function findItemAt(gx, gy) {
  for (const mine of mines) {
    if (mine.x === gx && mine.y === gy && mine.owner === null) {
      return { item: mine, type: "mine" };
    }
  }
  for (const rm of riverMines) {
    if (rm.x === gx && rm.y === gy && rm.owner === null) {
      return { item: rm, type: "river" };
    }
  }
  return null;
}

// --- Turn System ---

const PLAYER_COLORS = ["#ff4444", "#4488ff"];

function buyItem(p, playerIdx, item, type) {
  const d = dist(p.x, p.y, item.x, item.y);
  const price = type === "mine" ? minePriceFn(d) : riverPriceFn(d);

  if (p.curr_money < price) {
    updateStatus(
      `Can't afford! Costs $${price}, you have $${p.curr_money}`
    );
    return false;
  }

  p.curr_money -= price;
  item.owner = p;

  if (type === "mine") {
    p.owned_mines.push(item);
    p.recordAction("buy mine");
    updateStatus(
      `Player ${playerIdx + 1} bought a mine at (${item.x}, ${item.y}) for $${price} — reward: ${item.reward}, risk: ${item.risk}`
    );
  } else {
    p.owned_rivers.push(item);
    p.recordAction("buy river");
    updateStatus(
      `Player ${playerIdx + 1} bought a river at (${item.x}, ${item.y}) for $${price} — reward: ${item.reward}/turn`
    );
  }

  setCell(item.x, item.y, PLAYER_COLORS[playerIdx]);
  updateMoneyDisplay();
  return true;
}

function collectIncome() {
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    console.log(`--- Player ${i + 1} Income (Turn ${turnNumber}) ---`);

    // Process mines — check for collapse, then income
    for (let m = 0; m < p.owned_mines.length; m++) {
      const mine = p.owned_mines[m];
      const label = `mine ${m + 1}`;

      if (mine.collapsed) {
        console.log(`%c ${label} -- DEAD (collapsed)`, "color: gray");
        continue;
      }

      // Collapse check: higher risk = higher chance of permanent collapse
      if (Math.random() < mine.risk * 0.15) {
        mine.collapsed = true;
        console.log(`%c ${label} -- COLLAPSED! (permanently destroyed)`, "color: red; font-weight: bold");
        setCell(mine.x, mine.y, "#333");
        continue;
      }

      // Income
      const income = Math.round(mine.reward * (1 + mine.risk));
      p.curr_money += income;
      console.log(`${label} -- $${income}`);
    }

    let riverIdx = 1;
    for (const river of p.owned_rivers) {
      p.curr_money += river.reward;
      console.log(`river ${riverIdx} -- $${river.reward}`);
      riverIdx++;
    }

    if (p.owned_mines.length === 0 && p.owned_rivers.length === 0) {
      console.log("(no properties owned)");
    }
  }
  updateMoneyDisplay();
}

function nextTurn() {
  // Collect income at the end of a full round
  if (currentPlayerIndex === players.length - 1) {
    collectIncome();
  }

  for (let i = 0; i < players.length; i++) {
    if (players[i].hasWon()) {
      gameOver = true;
      updateStatus(`Player ${i + 1} wins with $${players[i].curr_money}!`);
      hideBuyDialog();
      return;
    }
  }

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
  if (currentPlayerIndex === 0) turnNumber++;

  updateTurnLabel();
  updateStatus("Click a mine or river to buy it.");
}

// --- UI ---

const statusEl = document.getElementById("status");
const promptLabel = document.getElementById("prompt-label");
const moneyEl = document.getElementById("money");
const buyDialog = document.getElementById("buy-dialog");
const buyInfo = document.getElementById("buy-info");
const btnBuy = document.getElementById("btn-buy");
const btnCancel = document.getElementById("btn-cancel");

function updateStatus(msg) {
  statusEl.textContent = msg;
}

function updateMoneyDisplay() {
  moneyEl.textContent = `P1: $${player.curr_money}  |  P2: $${player2.curr_money}`;
}

function updateTurnLabel() {
  promptLabel.textContent = `Turn ${turnNumber} — Player ${currentPlayerIndex + 1}`;
}

function showBuyDialog(item, type, price) {
  const label = type === "mine"
    ? `Mine at (${item.x}, ${item.y}) — Price: $${price}, Reward: ${item.reward}, Risk: ${item.risk}`
    : `River at (${item.x}, ${item.y}) — Price: $${price}, Reward: ${item.reward}/turn`;
  buyInfo.textContent = label;
  buyDialog.style.display = "flex";
}

function hideBuyDialog() {
  buyDialog.style.display = "none";
  selectedItem = null;
  selectedType = null;
}

// --- Canvas Click ---

canvas.addEventListener("click", (e) => {
  if (gameOver) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const { x: gx, y: gy } = pxToGrid(px, py);

  const result = findItemAt(gx, gy);
  if (!result) {
    hideBuyDialog();
    updateStatus("Nothing there. Click on a yellow mine or blue river.");
    return;
  }

  const p = players[currentPlayerIndex];
  const d = dist(p.x, p.y, result.item.x, result.item.y);
  const price = result.type === "mine" ? minePriceFn(d) : riverPriceFn(d);

  selectedItem = result.item;
  selectedType = result.type;
  showBuyDialog(result.item, result.type, price);
});

// --- Buy / Cancel ---

btnBuy.addEventListener("click", () => {
  if (!selectedItem || gameOver) return;

  const p = players[currentPlayerIndex];
  const idx = currentPlayerIndex;

  const success = buyItem(p, idx, selectedItem, selectedType);
  hideBuyDialog();

  if (success) {
    setTimeout(nextTurn, 800);
  }
});

btnCancel.addEventListener("click", () => {
  hideBuyDialog();
  updateStatus("Click a mine or river to buy it.");
});

// --- Rendering ---

function draw() {
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (cell.color) {
        ctx.fillStyle = cell.color;
        ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }

  // Draw player positions
  ctx.fillStyle = PLAYER_COLORS[0];
  ctx.fillRect(player.x * CELL_PX, player.y * CELL_PX, CELL_PX, CELL_PX);
  ctx.fillStyle = PLAYER_COLORS[1];
  ctx.fillRect(player2.x * CELL_PX, player2.y * CELL_PX, CELL_PX, CELL_PX);

  // Highlight selected item
  if (selectedItem) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      selectedItem.x * CELL_PX,
      selectedItem.y * CELL_PX,
      CELL_PX,
      CELL_PX
    );
  }

  // Grid lines
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID_SIZE; i++) {
    const pos = i * CELL_PX;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(canvas.width, pos);
    ctx.stroke();
  }
}

// --- Game Loop ---
let lastTime = 0;

function gameLoop(timestamp) {
  const dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  draw();
  requestAnimationFrame(gameLoop);
}

// --- Init ---
generateScene();
updateMoneyDisplay();
updateTurnLabel();
requestAnimationFrame(gameLoop);