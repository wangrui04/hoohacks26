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

function hideBuyDialog() {
  buyDialog.style.display = "none";
  selectedItem = null;
  selectedType = null;
}