// --- Instances ---
const player = new Player(0, 0);
const player2 = new Player(63, 63);
const players = [player, player2];

const mines = [];
const riverMines = [];

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

/** Get cell data at (x, y). Returns null if out of bounds. */
function getCell(x, y) {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return null;
  return grid[y][x];
}

/** Set a cell's color. Pass null to clear. */
function setCell(x, y, color) {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
  grid[y][x].color = color;
}

/** Convert pixel coords on the canvas to grid coords. */
function pxToGrid(px, py) {
  return {
    x: Math.floor(px / CELL_PX),
    y: Math.floor(py / CELL_PX),
  };
}

/** Clear every cell back to empty. */
function clearGrid() {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      grid[y][x].color = null;
    }
  }
}

/** Returns a random int in [0, max). */
function randInt(max) {
  return Math.floor(Math.random() * max);
}

/** Check if a cell is already occupied. */
function isCellFree(x, y) {
  const cell = getCell(x, y);
  return cell && cell.color === null;
}

/** Check if (x, y) is within a 10x10 box centered on any player. */
function isInPlayerZone(x, y) {
  const ZONE = 10; // half-width of the 10x10 box
  for (const p of players) {
    if (Math.abs(x - p.x) < ZONE && Math.abs(y - p.y) < ZONE) {
      return true;
    }
  }
  return false;
}

/** Get a random free cell that is outside all player exclusion zones. */
function randomFreeCell() {
  let x, y;
  do {
    x = randInt(GRID_SIZE);
    y = randInt(GRID_SIZE);
  } while (!isCellFree(x, y) || isInPlayerZone(x, y));
  return { x, y };
}

/** Plot a mine at the given grid coordinates. */
function plotMine(x, y, options = {}) {
  const mine = new Mine(x, y, options);
  mines.push(mine);
  setCell(x, y, MINE_COLOR);
  return mine;
}

/** Plot a river mine at the given grid coordinates. */
function plotRiver(x, y, options = {}) {
  const rm = new RiverMine(x, y, options);
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

  // Spawn mines
  for (let i = 0; i < NUM_MINES; i++) {
    const { x, y } = randomFreeCell();
    const level = randInt(3) + 1;
    plotMine(x, y, {
      reward: level * 10,
      level: level,
      risk: Math.round((level * 0.2 + 0.1) * 100) / 100,
    });
  }

  // Spawn river mines
  for (let i = 0; i < NUM_RIVERS; i++) {
    const { x, y } = randomFreeCell();
    const level = randInt(3) + 1;
    plotRiver(x, y, { reward: level * 8, level: level });
  }
}

// Build the scene
generateScene();

// --- Rendering ---

function draw() {
  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Filled cells
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (cell.color) {
        ctx.fillStyle = cell.color;
        ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
      }
    }
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

// Kick off
requestAnimationFrame(gameLoop);