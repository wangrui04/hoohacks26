// ========================
// turnSystem.js — Buy logic, income, turn progression
// ========================

function buyItem(p, playerIdx, item, type) {
  const d = dist(p.x, p.y, item.x, item.y);
  const price = type === "mine" ? minePriceFn(d, item.level) : riverPriceFn(d, item.level);

  if (type === "river" && p.mustBuyMineBeforeRiver) {
    updateStatus(`Player ${playerIdx + 1} must buy a mine before buying another river.`);
    return false;
  }

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
    p.mustBuyMineBeforeRiver = false;
    p.recordAction("buy mine");
    updateStatus(
      `Player ${playerIdx + 1} bought ${item.label} for $${price} — risk: ${(item.risk * 100).toFixed(0)}%`
    );
  } else {
    p.owned_rivers.push(item);
    p.mustBuyMineBeforeRiver = true;
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
      const income = Math.round(mine.reward * (1 + Math.exp(mine.risk)));
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
  let html = `<div class="round-header">═══ Turn ${turnNumber} Summary ═══</div>`;

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

  // Check if someone hit the win target for this round
  for (let i = 0; i < players.length; i++) {
    if (players[i].hasWon()) {
      gameOver = true;
      roundWins[i]++;
      appendRoundLog(`<div class="round-header">★ Player ${i + 1} wins Match ${currentRound} with $${players[i].curr_money}! ★</div>`);
      updateRoundScore();

      // Check if match is decided
      const winsNeeded = Math.ceil(TOTAL_ROUNDS / 2); // 3 out of 5
      if (roundWins[i] >= winsNeeded) {
        matchOver = true;
        updateStatus(`Player ${i + 1} wins the game ${roundWins[i]}–${roundWins[1 - i]}!`);
        appendRoundLog(`<div class="round-header">══ Player ${i + 1} wins the game ${roundWins[i]}–${roundWins[1 - i]}! ══</div>`);
        hideBuyDialog();
        hideUpgradeDialog();
        return;
      }

      // Check if all rounds played
      if (currentRound >= TOTAL_ROUNDS) {
        matchOver = true;
        const winner = roundWins[0] > roundWins[1] ? 1 : roundWins[1] > roundWins[0] ? 2 : 0;
        if (winner === 0) {
          updateStatus(`Match tied ${roundWins[0]}–${roundWins[1]}!`);
          appendRoundLog(`<div class="round-header">══ Match tied ${roundWins[0]}–${roundWins[1]}! ══</div>`);
        } else {
          updateStatus(`Player ${winner} wins the match ${roundWins[winner - 1]}–${roundWins[2 - winner]}!`);
          appendRoundLog(`<div class="round-header">══ Player ${winner} wins the match ${roundWins[winner - 1]}–${roundWins[2 - winner]}! ══</div>`);
        }
        hideBuyDialog();
        hideUpgradeDialog();
        return;
      }

      // Start next round after a delay
      updateStatus(`Player ${i + 1} wins Match ${currentRound}! Next match starting...`);
      currentRound++;
      setTimeout(() => {
        resetForNewRound();
        appendRoundLog(`<div class="round-header">══ Match ${currentRound} Begin ══</div>`);
        updateStatus("Click a mine or river to buy it.");
        if (isAITurn()) {
          setTimeout(aiTakeTurn, 600);
        }
      }, 2000);
      return;
    }
  }

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
  if (currentPlayerIndex === 0) turnNumber++;

  updateTurnLabel();
  updateStatus("Click a mine or river to buy it.");

  if (isAITurn()) {
    setTimeout(aiTakeTurn, 600);
  }
}

function performUpgrade(playerIdx, item, type) {
  if (item.upgrades >= 1) {
    updateStatus(`Can't upgrade ${item.label} — already at max level!`);
    return;
  }

  const oldReward = item.reward;
  item.reward = Math.round(item.reward * 1.25);
  item.upgrades++;

  const typeLabel = type === "mine" ? item.label : item.label;
  roundSelections[playerIdx] = {
    label: `Upgrade ${typeLabel}`,
    type: "upgrade",
    price: 0,
  };

  players[playerIdx].recordAction("upgrade " + type);
  updateStatus(
    `Player ${playerIdx + 1} upgraded ${typeLabel} — reward: $${oldReward} → $${item.reward}`
  );
  updateMoneyDisplay();
  hideUpgradeDialog();

  setTimeout(nextTurn, 800);
}