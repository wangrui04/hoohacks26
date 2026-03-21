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
      ? `${item.label} — Price: $${price}, Reward: ${item.reward}, Risk: ${item.risk}`
      : `${item.label} — Price: $${price}, Reward: ${item.reward}/turn`;
  buyInfo.textContent = label;
  buyDialog.style.display = "flex";
}

function hideBuyDialog() {
  buyDialog.style.display = "none";
  selectedItem = null;
  selectedType = null;
}