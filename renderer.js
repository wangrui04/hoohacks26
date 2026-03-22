// ========================
// renderer.js — Canvas drawing 
// ========================

// Border extends beyond the grid on all sides
const BORDER_PAD = 40;

// Sprites are drawn slightly larger than the cell for overlap effect
const SPRITE_SCALE = 1.5;
const RIVER_SCALE = 1.5;
const MINE_SCALE = 1.0;
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
  mineCollapsed:  loadImg("Images/MineCollapsed.png"),
  // Player 1 (Red) claimed/upgraded
  rMineClaimed:   loadImg("Images/RMineClaimed.png"),
  rMineUpgraded:  loadImg("Images/RMineUpgraded.png"),
  rRiverClaimed:  loadImg("Images/RRiverClaimed.png"),
  rRiverUpgraded: loadImg("Images/RRiverUpgraded.png"),
  // Player 2 (Purple) claimed/upgraded
  pMineClaimed:   loadImg("Images/PMineClaimed.png"),
  pMineUpgraded:  loadImg("Images/PMineUpgraded.png"),
  pRiverClaimed:  loadImg("Images/PRiverClaimed.png"),
  pRiverUpgraded: loadImg("Images/PRiverUpgraded.png"),
  // Unclaimed river
  river:          loadImg("Images/River.png"),
  // Settlements
  redSettlement:  loadImg("Images/RSettlement.png"),
  purpleSettlement: loadImg("Images/PSettlement.png"),
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
  if (mine.owner) {
    // Determine which player owns it: player 1 (index 0) = R, player 2 (index 1) = P
    const isP1 = mine.owner === players[0];
    if (mine.upgrades >= 1) return isP1 ? sprites.rMineUpgraded : sprites.pMineUpgraded;
    return isP1 ? sprites.rMineClaimed : sprites.pMineClaimed;
  }
  return sprites.mine;
}

function getRiverSprite(river) {
  if (river.owner) {
    const isP1 = river.owner === players[0];
    if (river.upgrades >= 1) return isP1 ? sprites.rRiverUpgraded : sprites.pRiverUpgraded;
    return isP1 ? sprites.rRiverClaimed : sprites.pRiverClaimed;
  }
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

  // 8) Map border 
  if (sprites.mapBorder.complete && sprites.mapBorder.naturalWidth > 0) {
    ctx.drawImage(sprites.mapBorder, 0, 0, canvas.width, canvas.height);
  }
}