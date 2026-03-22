// ========================
// riverMine.js — RiverMine data class
// ========================

class RiverMine {
  constructor(x, y, { reward = 10, level = 1 } = {}) {
    this.x = x;
    this.y = y;
    this.type = "riverMine";
    this.color = "#72d0f2";
    this.reward = reward;
    this.level = level;
    this.upgrades = 0;
  }

  place(setCell) {
    setCell(this.x, this.y, this.color);
  }

  mine() {
    const goldValue = Math.floor(Math.random() * 10) + 1;
    return goldValue;
  }
}