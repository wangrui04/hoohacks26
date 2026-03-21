// ========================
// ui.js — DOM references & display helpers
// ========================

const statusEl = document.getElementById("status");
//const promptLabel = document.getElementById("prompt-label");
//const moneyEl = document.getElementById("money");
//const roundScoreEl = document.getElementById("round-score");
const buyDialog = document.getElementById("buy-dialog");
const buyInfo = document.getElementById("buy-info");
const btnBuy = document.getElementById("btn-buy");
const btnCancel = document.getElementById("btn-cancel");
const roundLogEl = document.getElementById("round-log");

// --- Per-round selection tracking ---
// roundSelections[playerIndex] = { label, type, price } set when they buy
const roundSelections = [null, null];

function appendRoundLog(html) {
  roundLogEl.innerHTML += html;
  roundLogEl.scrollTop = roundLogEl.scrollHeight;
}

function updateStatus(msg) {
  statusEl.textContent = msg;
}

function updateMoneyDisplay() {
  updateHUD();
}

function updateTurnLabel() {
  updateHUD();
}

function updateRoundScore() {
  updateHUD();
}

function updateHUD() {
  const text = `Turn ${turnNumber} — Player ${currentPlayerIndex + 1} | Match ${currentRound}/${TOTAL_ROUNDS} | Wins — P1: ${roundWins[0]} P2: ${roundWins[1]} | P1: $${player.curr_money} P2: $${player2.curr_money}`;
  
  document.getElementById("hud-text").textContent = text;
}

function showBuyDialog(item, type, price) {
  const label =
    type === "mine"
      ? `${item.label} — Cost: $${price}, Risk: ${(item.risk * 100).toFixed(0)}%`
      : `${item.label} — Cost: $${price}, Risk: None`;
  buyInfo.textContent = label;
  buyDialog.style.display = "flex";
}

const btnUpgrade = document.getElementById("btn-upgrade");
const btnSkip = document.getElementById("btn-skip");
const upgradeDialog = document.getElementById("upgrade-dialog");
const upgradeList = document.getElementById("upgrade-list");
const btnUpgradeCancel = document.getElementById("btn-upgrade-cancel");

function showUpgradeDialog(playerIdx) {
  const p = players[playerIdx];
  upgradeList.innerHTML = "";

  const allAssets = [];

  for (const mine of p.owned_mines) {
    const maxed = mine.upgrades >= 1;
    const disabled = mine.collapsed || maxed;
    let label;
    if (mine.collapsed) {
      label = `${mine.label} (Lv${mine.level}) — COLLAPSED`;
    } else if (maxed) {
      label = `${mine.label} (Lv${mine.level}) — MAX LEVEL`;
    } else {
      const newReward = Math.round(mine.reward * 1.25);
      label = `${mine.label} (Lv${mine.level}) — Reward: $${mine.reward} → $${newReward}`;
    }
    allAssets.push({ item: mine, type: "mine", label, disabled });
  }

  for (const river of p.owned_rivers) {
    const maxed = river.upgrades >= 1;
    const disabled = maxed;
    let label;
    if (maxed) {
      label = `${river.label} (Lv${river.level}) — MAX LEVEL`;
    } else {
      const newReward = Math.round(river.reward * 1.25);
      label = `${river.label} (Lv${river.level}) — Reward: $${river.reward} → $${newReward}`;
    }
    allAssets.push({ item: river, type: "river", label, disabled });
  }

  if (allAssets.length === 0) {
    updateStatus("You don't own any assets to upgrade!");
    return;
  }

  for (const asset of allAssets) {
    const btn = document.createElement("button");
    btn.className = "upgrade-option" + (asset.disabled ? " collapsed" : "");
    btn.textContent = asset.label;
    if (!asset.disabled) {
      btn.addEventListener("click", () => {
        performUpgrade(playerIdx, asset.item, asset.type);
      });
    }
    upgradeList.appendChild(btn);
  }

  hideBuyDialog();
  upgradeDialog.style.display = "block";
}

function hideUpgradeDialog() {
  upgradeDialog.style.display = "none";
}

function hideBuyDialog() {
  buyDialog.style.display = "none";
  selectedItem = null;
  selectedType = null;
}