class Mine {
  constructor(x, y, { reward = 10, level = 1, risk = 0.5 } = {}) {
    this.x = x;
    this.y = y;
    this.reward = reward;
    this.level = level;
    this.risk = risk;
  }
}