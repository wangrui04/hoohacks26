// ========================
// consts.js — All configuration & magic numbers
// ========================

// --- Rendering ---
const BG_COLOR = "#1a1a1a";
const LINE_COLOR = "#2a2a2a";
const PLAYER_COLORS = ["#ff4444", "#ef44ff"];

// --- Mine ---
const MINE_COLOR = "#ffdd00";

// --- Game Objective ---
const WIN_GOLD = 1000;
const STARTING_MONEY = 50;

// --- Grid ---
const GRID_SIZE = 64;
const CELL_PX = 10;

// --- Scene ---
const NUM_MINES = 20;
const NUM_RIVERS = 15;
const PLAYER_ZONE_RADIUS = 10;

// --- Pricing ---
function minePriceFn(distance) {
  return Math.max(1, Math.round(10 * Math.exp(0.03 * distance)));
}

function riverPriceFn(distance) {
  return Math.max(1, Math.round(5 * Math.exp(0.03 * distance)));
}