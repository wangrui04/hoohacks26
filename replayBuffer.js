// ========================
// replayBuffer.js — Global replay buffer for human player decisions
//
// Add to index.html BEFORE turnSystem.js:
//   <script src="replayBuffer.js"></script>
//
// Access anywhere via the global `replayBuffer` array.
// Each entry is a { state, action, meta } object.
// ========================

const replayBuffer = [];

// ========================
// Snapshot helpers — deep-copy all relevant game state
// ========================

function _snapshotMine(mine) {
  return {
    x: mine.x,
    y: mine.y,
    label: mine.label,
    reward: mine.reward,
    level: mine.level,
    risk: mine.risk,
    collapsed: mine.collapsed,
    depleted: mine.depleted,
    upgrades: mine.upgrades,
    ownerIdx: mine.owner === null ? null
      : mine.owner === players[0] ? 0 : 1,
  };
}

function _snapshotRiver(river) {
  return {
    x: river.x,
    y: river.y,
    label: river.label,
    reward: river.reward,
    level: river.level,
    upgrades: river.upgrades,
    ownerIdx: river.owner === null ? null
      : river.owner === players[0] ? 0 : 1,
  };
}

function _snapshotPlayer(p, idx) {
  return {
    idx: idx,
    x: p.x,
    y: p.y,
    curr_money: p.curr_money,
    owned_mine_labels: p.owned_mines.map(m => m.label),
    owned_river_labels: p.owned_rivers.map(r => r.label),
    mustBuyMineBeforeRiver: p.mustBuyMineBeforeRiver,
  };
}

/**
 * Capture a full deep-copy snapshot of the current game scene.
 */
function snapshotState() {
  return {
    turnNumber: turnNumber,
    currentPlayerIndex: currentPlayerIndex,
    currentRound: currentRound,
    roundWins: [...roundWins],
    players: players.map((p, i) => _snapshotPlayer(p, i)),
    mines: mines.map(m => _snapshotMine(m)),
    riverMines: riverMines.map(r => _snapshotRiver(r)),
  };
}

// ========================
// Record a decision into the replay buffer
// ========================

/**
 * Call this right BEFORE the action mutates game state so the snapshot
 * represents the state the player observed when making the decision.
 *
 * @param {number} playerIdx  — 0 or 1
 * @param {string} actionType — "buy_mine" | "buy_river" | "upgrade_mine" | "upgrade_river" | "skip"
 * @param {object} [details]  — extra info about the action (item label, price, etc.)
 */
function recordDecision(playerIdx, actionType, details = {}) {
  const p = players[playerIdx];
  replayBuffer.push({
    turn: turnNumber,
    round: currentRound,
    money: p.curr_money,
    action: actionType,
    label: details.itemLabel || null,
    price: details.price || 0,
    dist: details.distance || 0,
  });
}