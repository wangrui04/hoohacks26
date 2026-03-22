// ========================
// utils.js — Pure helpers (no game-state dependencies)
// ========================

// --- Grid State ---
const grid = Array.from({ length: GRID_SIZE }, () =>
  Array.from({ length: GRID_SIZE }, () => ({ color: null }))
);

function getCell(x, y) {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return null;
  return grid[y][x];
}

function setCell(x, y, color) {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
  grid[y][x].color = color;
}

function clearGrid() {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      grid[y][x].color = null;
    }
  }
}

function pxToGrid(px, py) {
  return {
    x: Math.floor((px - BORDER_PAD) / CELL_PX),
    y: Math.floor((py - BORDER_PAD) / CELL_PX),
  };
}

function randInt(max) {
  return Math.floor(Math.random() * max);
}

function isCellFree(x, y) {
  const cell = getCell(x, y);
  return cell && cell.color === null;
}

function dist(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}