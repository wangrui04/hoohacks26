// ========================
// turnSystem.js — Buy logic, income, turn progression
// ========================

function buyItem(p, playerIdx, item, type) {
  const d = dist(p.x, p.y, item.x, item.y);
  const price = type === "mine" ? minePriceFn(d, item.level) : riverPriceFn(d, item.level);

  if (p.curr_money < price) {
    updateStatus(`Can't afford! Costs $${price}, you have $${p.curr_money}`);
    return false;
  }

  p.curr_money -= price;
  item.owner = p;

  // Track what this player selected this round
  roundSelections[playerIdx] = {
    label: item.label,
    type: type,
    price: price,
  };

  if (type === "mine") {
    p.owned_mines.push(item);
    p.recordAction("buy mine");
    updateStatus(
      `Player ${playerIdx + 1} bought ${item.label} for $${price} — risk: ${(item.risk * 100).toFixed(0)}%`
    );
  } else {
    p.owned_rivers.push(item);
    p.recordAction("buy river");
    updateStatus(
      `Player ${playerIdx + 1} bought ${item.label} for $${price} — no risk`
    );
  }

  setCell(item.x, item.y, PLAYER_COLORS[playerIdx]);
  updateMoneyDisplay();
  return true;
}

function collectIncome() {
  // Track income per player for the round summary
  const playerIncomes = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const balanceBefore = p.curr_money;
    const incomeDetails = [];

    for (const mine of p.owned_mines) {
      if (mine.collapsed) continue;

      if (Math.random() < mine.risk * 0.3) {
        mine.collapsed = true;
        const loss = Math.round(p.curr_money * mine.risk);
        p.curr_money = Math.round(p.curr_money * (1 - mine.risk));
        incomeDetails.push({ source: mine.label, amount: -loss, caveIn: true });
        setCell(mine.x, mine.y, "#333");
        continue;
      }
        const income = Math.round(river.reward * (1 + 0.1 * river.turnsOwned));
        river.turnsOwned++;
      p.curr_money += income;
      incomeDetails.push({ source: mine.label, amount: income, caveIn: false });
    }

    for (const river of p.owned_rivers) {
      p.curr_money += river.reward;
      incomeDetails.push({ source: river.label, amount: river.reward, caveIn: false });
    }

    const netIncome = p.curr_money - balanceBefore;
    playerIncomes.push({ netIncome, details: incomeDetails });
  }

  updateMoneyDisplay();
  printRoundSummary(playerIncomes);
}

function printRoundSummary(playerIncomes) {
  let html = `<div class="round-header">═══ Round ${turnNumber} Summary ═══</div>`;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const sel = roundSelections[i];
    const inc = playerIncomes[i];

    // Selection
    const selStr = sel
      ? `${sel.label} (${sel.type}) for $${sel.price}`
      : "No purchase";

    // Net income with color
    const sign = inc.netIncome >= 0 ? "+" : "";
    const cls = inc.netIncome > 0 ? "pos" : inc.netIncome < 0 ? "neg" : "neutral";

    // Detail breakdown
    let detailStr = "";
    if (inc.details.length > 0) {
      const parts = inc.details.map((d) => {
        if (d.caveIn) return `${d.source} CAVE-IN -$${Math.abs(d.amount)}`;
        return `${d.source} +$${d.amount}`;
      });
      detailStr = ` [${parts.join(", ")}]`;
    }

    html += `<div>P${i + 1}: Selected: ${selStr} | Income: <span class="${cls}">${sign}$${inc.netIncome}</span>${detailStr} | Balance: $${p.curr_money}</div>`;
  }

  appendRoundLog(html);

  // Reset selections for next round
  roundSelections[0] = null;
  roundSelections[1] = null;
}

function nextTurn() {
  if (currentPlayerIndex === players.length - 1) {
    collectIncome();
  }

  for (let i = 0; i < players.length; i++) {
    if (players[i].hasWon()) {
      gameOver = true;
      updateStatus(`Player ${i + 1} wins with $${players[i].curr_money}!`);
      hideBuyDialog();
      return;
    }
  }

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
  if (currentPlayerIndex === 0) turnNumber++;

  updateTurnLabel();
  updateStatus("Click a mine or river to buy it.");
}