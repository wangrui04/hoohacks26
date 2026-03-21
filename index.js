// ========================
// index.js — Entry point: instances, scene gen, events, game loop
// ========================

// --- Instances ---
const player = new Player(0, 0);
const player2 = new Player(31, 31);
const players = [player, player2];
const mines = [];
const riverMines = [];

// --- Turn State ---
let currentPlayerIndex = 0;
let turnNumber = 1;
let gameOver = false;
let selectedItem = null;
let selectedType = null;

// --- Round (best-of-5) State ---
let currentRound = 1;
const roundWins = [0, 0]; // wins per player
let matchOver = false;

// --- Label Counters ---
let mineCounter = 0;
let riverCounter = 0;

function resetForNewRound() {
  // Reset players
  for (const p of players) {
    p.curr_money = STARTING_MONEY;
    p.owned_mines = [];
    p.owned_rivers = [];
  }

  // Reset turn state
  currentPlayerIndex = 0;
  turnNumber = 1;
  gameOver = false;
  selectedItem = null;
  selectedType = null;
  roundSelections[0] = null;
  roundSelections[1] = null;

  // Regenerate map
  generateScene();

  // Update all displays
  updateHUD();
  hideBuyDialog();
  hideUpgradeDialog();
}

// ========================
// Scene helpers
// ========================

function isInPlayerZone(x, y) {
  for (const p of players) {
    if (
      Math.abs(x - p.x) < PLAYER_ZONE_RADIUS &&
      Math.abs(y - p.y) < PLAYER_ZONE_RADIUS
    ) {
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

function plotMine(x, y, options = {}) {
  mineCounter++;
  const mine = new Mine(x, y, options);
  mine.owner = null;
  mine.label = `Mine ${mineCounter}`;
  mines.push(mine);
  setCell(x, y, MINE_COLOR);
  return mine;
}

function plotRiver(x, y, options = {}) {
  riverCounter++;
  const rm = new RiverMine(x, y, options);
  rm.owner = null;
  rm.label = `River ${riverCounter}`;
  riverMines.push(rm);
  rm.place(setCell);
  return rm;
}

function generateScene() {
  clearGrid();
  mines.length = 0;
  riverMines.length = 0;
  mineCounter = 0;
  riverCounter = 0;

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

// ========================
// Item lookup
// ========================

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

// ========================
// Event wiring
// ========================

canvas.addEventListener("click", (e) => {
  if (gameOver || matchOver) return;

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
  const price =
    result.type === "mine" ? minePriceFn(d, result.item.level) : riverPriceFn(d, result.item.level);

  selectedItem = result.item;
  selectedType = result.type;
  hideUpgradeDialog();
  showBuyDialog(result.item, result.type, price);
});

btnBuy.addEventListener("click", () => {
  if (!selectedItem || gameOver || matchOver) return;

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

btnUpgrade.addEventListener("click", () => {
  if (gameOver || matchOver) return;
  showUpgradeDialog(currentPlayerIndex);
});

btnUpgradeCancel.addEventListener("click", () => {
  hideUpgradeDialog();
  updateStatus("Click a mine or river to buy it.");
});

btnSkip.addEventListener("click", () => {
  if (gameOver || matchOver) return;
  hideBuyDialog();
  hideUpgradeDialog();

  roundSelections[currentPlayerIndex] = {
    label: "Skipped",
    type: "skip",
    price: 0,
  };
  players[currentPlayerIndex].recordAction("skip");
  updateStatus(`Player ${currentPlayerIndex + 1} skipped their turn.`);

  setTimeout(nextTurn, 800);
});

// ========================
// Game loop
// ========================

let lastTime = 0;

function gameLoop(timestamp) {
  const dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  draw();
  requestAnimationFrame(gameLoop);
}

// ========================
// Init
// ========================

generateScene();
updateHUD();
requestAnimationFrame(gameLoop);