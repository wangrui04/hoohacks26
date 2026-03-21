// ========================
// ui.js — DOM references & display helpers
// ========================

const statusEl = document.getElementById("status");
const promptLabel = document.getElementById("prompt-label");
const moneyEl = document.getElementById("money");
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
  moneyEl.textContent = `P1: $${player.curr_money}  |  P2: $${player2.curr_money}`;
}

function updateTurnLabel() {
  promptLabel.textContent = `Turn ${turnNumber} — Player ${currentPlayerIndex + 1}`;
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
const upgradeDialog = document.getElementById("upgrade-dialog");
const upgradeList = document.getElementById("upgrade-list");
const btnUpgradeCancel = document.getElementById("btn-upgrade-cancel");

function showUpgradeDialog(playerIdx) {
  const p = players[playerIdx];
  upgradeList.innerHTML = "";

  const allAssets = [];

  for (const mine of p.owned_mines) {
    const newReward = Math.round(mine.reward * 1.25);
    const disabled = mine.collapsed;
    const label = disabled
      ? `${mine.label} (Lv${mine.level}) — COLLAPSED`
      : `${mine.label} (Lv${mine.level}, +${mine.upgrades} upgrades) — Reward: $${mine.reward} → $${newReward}`;
    allAssets.push({ item: mine, type: "mine", label, disabled });
  }

  for (const river of p.owned_rivers) {
    const newReward = Math.round(river.reward * 1.25);
    const label = `${river.label} (Lv${river.level}, +${river.upgrades} upgrades) — Reward: $${river.reward} → $${newReward}`;
    allAssets.push({ item: river, type: "river", label, disabled: false });
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