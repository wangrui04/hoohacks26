// ========================
// player.js — Player data class
// ========================

class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.curr_money = STARTING_MONEY;
    this.owned_mines = [];
    this.owned_rivers = [];
    this.previous_actions = [];
    this.mustBuyMineBeforeRiver = false;
  }

  recordAction(action) {
    this.previous_actions.push({ action, timestamp: Date.now() });
  }

  hasWon() {
    return this.curr_money >= WIN_GOLD;
  }
}