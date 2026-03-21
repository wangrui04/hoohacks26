// ========================
// mine.js — Mine data class
// ========================

class Mine {
  constructor(x, y, { reward = 10, level = 1, risk = 0.5, reserve = 0 } = {}) {
    this.x = x;
    this.y = y;
    this.reward = reward;
    this.level = level;
    this.risk = risk;
    this.collapsed = false;
    this.depleted = false;
  }
}