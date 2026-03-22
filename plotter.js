// ========================
// plotter.js — Takes care of drawings on the canvas based on game state
// ========================


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