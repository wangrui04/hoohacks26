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
const WIN_GOLD = 500;
const STARTING_MONEY = 50;
const TOTAL_ROUNDS = 5;

// --- Grid ---
const GRID_SIZE = 20;
const CELL_PX = 30;

// --- Scene ---
const NUM_MINES = 7;
const NUM_RIVERS = 13;
const PLAYER_ZONE_RADIUS = 10;

function minePriceFn(distance, level) {
  return Math.max(1, Math.round((8 + level * 6) * Math.exp(0.03 * distance)));
}
function riverPriceFn(distance, level) {
  return Math.max(1, Math.round((4 + level * 4) * Math.exp(0.03 * distance)));
}