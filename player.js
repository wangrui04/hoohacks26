class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.curr_money = 0;
    this.owned_mines = [];
    this.owned_rivers = [];
    this.previous_actions = []; // each entry: { action, timestamp }
  }

  /** Log an action to history. */
  recordAction(action) {
    this.previous_actions.push({ action, timestamp: Date.now() });
  }

  /** Check if the player has reached the win condition. */
  hasWon() {
    return this.curr_money >= WIN_GOLD;
  }
}