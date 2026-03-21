// --- Instances ---
const player = new Player(0, 0);
const mines = [];

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

/** Plot a mine at the given grid coordinates. */
function plotRiver(x, y, options = {}) {
  const mine = new Mine(x, y, options);
  mines.push(mine);
  setCell(x, y, MINE_COLOR);
  return mine;
}

// Place one mine at a random position
const mineX = Math.floor(Math.random() * GRID_SIZE);
const mineY = Math.floor(Math.random() * GRID_SIZE);
plotRiver(mineX, mineY, { reward: 10, level: 1, risk: 0.5 });

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

// River Mine
import { RiverMine } from "./RiverMine.js";

const riverMine = new RiverMine(10, 10);
riverMine.place(setCell);
requestAnimationFrame(gameLoop);
