// ========================
// renderer.js — Canvas drawing (read-only against game state)
// ========================

// Border extends beyond the grid on all sides
const BORDER_PAD = 40;

// Sprites are drawn slightly larger than the cell for overlap effect
const SPRITE_SCALE = 1.7;
const RIVER_SCALE = 1.0;
const MINE_SCALE = 2.5;
const SPRITE_PX = Math.round(CELL_PX * SPRITE_SCALE);
const RIVER_PX = Math.round(CELL_PX * RIVER_SCALE);
const MINE_PX = Math.round(CELL_PX * MINE_SCALE);

const SPRITE_OFFSET = Math.round((SPRITE_PX - CELL_PX) / 2); 
const RIVER_OFFSET = Math.round((RIVER_PX - CELL_PX) / 2);    
const MINE_OFFSET = Math.round((MINE_PX - CELL_PX) / 2);     

const canvas = document.getElementById("grid");
canvas.width = GRID_SIZE * CELL_PX + BORDER_PAD * 2;
canvas.height = GRID_SIZE * CELL_PX + BORDER_PAD * 2;
const ctx = canvas.getContext("2d");

// ========================
// Sprite loading
// ========================

function loadImg(src) {
  const img = new Image();
  img.src = src;
  return img;
}

const sprites = {
  map:            loadImg("Images/Map.png"),
  mapBorder:      loadImg("Images/MapBorder.png"),
  mine:           loadImg("Images/Mine.png"),
  mineClaimed:    loadImg("Images/MineClaimed.png"),
  mineUpgraded:   loadImg("Images/MineUpgraded.png"),
  mineCollapsed:  loadImg("Images/MineCollapsed.png"),
  river:          loadImg("Images/River2.png"),
  riverClaimed:   loadImg("Images/RiverClaimed.png"),
  riverUpgraded:  loadImg("Images/RiverUpgraded.png"),
  redSettlement:  loadImg("Images/RedSettlement.png"),
  purpleSettlement: loadImg("Images/PurpleSettlement.png"),
};

// Helper: pixel position of a grid cell (accounting for border offset)
function cellPx(gx) {
  return BORDER_PAD + gx * CELL_PX;
}

// Helper: draw a normal sprite centered on a cell
function drawSprite(img, gx, gy) {
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(
      img,
      cellPx(gx) - SPRITE_OFFSET,
      cellPx(gy) - SPRITE_OFFSET,
      SPRITE_PX,
      SPRITE_PX
    );
  }
}

// Helper: draw a mine sprite centered on a cell with its own size
function drawMineSprite(img, gx, gy) {
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(
      img,
      cellPx(gx) - MINE_OFFSET,
      cellPx(gy) - MINE_OFFSET,
      MINE_PX,
      MINE_PX
    );
  }
}

// Helper: draw a river sprite centered on a cell with its own size
function drawRiverSprite(img, gx, gy) {
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(
      img,
      cellPx(gx) - RIVER_OFFSET,
      cellPx(gy) - RIVER_OFFSET,
      RIVER_PX,
      RIVER_PX
    );
  }
}


// ========================
// Sprite selection helpers
// ========================

function getMineSprite(mine) {
  if (mine.collapsed) return sprites.mineCollapsed;
  if (mine.owner && mine.upgrades >= 1) return sprites.mineUpgraded;
  if (mine.owner) return sprites.mineClaimed;
  return sprites.mine;
}

function getRiverSprite(river) {
  if (river.owner && river.upgrades >= 1) return sprites.riverUpgraded;
  if (river.owner) return sprites.riverClaimed;
  return sprites.river;
}

// ========================
// Main draw
// ========================

function draw() {
  // Clear entire canvas (including border area)
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 1) Map background (drawn inside the grid area)
  const gridW = GRID_SIZE * CELL_PX;
  const gridH = GRID_SIZE * CELL_PX;
  if (sprites.map.complete && sprites.map.naturalWidth > 0) {
    ctx.drawImage(sprites.map, BORDER_PAD, BORDER_PAD, gridW, gridH);
  }

  // 2) Colored grid cells
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = grid[y][x];
      if (cell.color) {
        ctx.fillStyle = cell.color;
        ctx.fillRect(cellPx(x), cellPx(y), CELL_PX, CELL_PX);
      }
    }
  }

  // 3) Mine sprites
  for (const mine of mines) {
    drawMineSprite(getMineSprite(mine), mine.x, mine.y);
  }

  // 4) River sprites
  for (const rm of riverMines) {
    drawRiverSprite(getRiverSprite(rm), rm.x, rm.y);
  }

  // 5) Player settlements
  ctx.fillStyle = PLAYER_COLORS[0];
  ctx.fillRect(cellPx(player.x), cellPx(player.y), CELL_PX, CELL_PX);
  drawSprite(sprites.redSettlement, player.x, player.y);

  ctx.fillStyle = PLAYER_COLORS[1];
  ctx.fillRect(cellPx(player2.x), cellPx(player2.y), CELL_PX, CELL_PX);
  drawSprite(sprites.purpleSettlement, player2.x, player2.y);

  // 6) Highlight selected item
  if (selectedItem) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      cellPx(selectedItem.x),
      cellPx(selectedItem.y),
      CELL_PX,
      CELL_PX
    );
  }

  // 7) Grid lines
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID_SIZE; i++) {
    const pos = BORDER_PAD + i * CELL_PX;
    ctx.beginPath();
    ctx.moveTo(pos, BORDER_PAD);
    ctx.lineTo(pos, BORDER_PAD + gridH);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(BORDER_PAD, pos);
    ctx.lineTo(BORDER_PAD + gridW, pos);
    ctx.stroke();
  }

  // 8) Map border (covers full canvas, sits on top of everything)
  if (sprites.mapBorder.complete && sprites.mapBorder.naturalWidth > 0) {
    ctx.drawImage(sprites.mapBorder, 0, 0, canvas.width, canvas.height);
  }
}