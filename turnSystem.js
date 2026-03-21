// ========================
// turnSystem.js — Buy logic, income, turn progression
// ========================

function buyItem(p, playerIdx, item, type) {
  const d = dist(p.x, p.y, item.x, item.y);
  const price = type === "mine" ? minePriceFn(d) : riverPriceFn(d);

  if (p.curr_money < price) {
    updateStatus(`Can't afford! Costs $${price}, you have $${p.curr_money}`);
    return false;
  }

  p.curr_money -= price;
  item.owner = p;

  if (type === "mine") {
    p.owned_mines.push(item);
    p.recordAction("buy mine");
    updateStatus(
      `Player ${playerIdx + 1} bought ${item.label} for $${price} — reward: ${item.reward}, risk: ${item.risk}`
    );
  } else {
    p.owned_rivers.push(item);
    p.recordAction("buy river");
    updateStatus(
      `Player ${playerIdx + 1} bought ${item.label} for $${price} — reward: ${item.reward}/turn`
    );
  }

  setCell(item.x, item.y, PLAYER_COLORS[playerIdx]);
  updateMoneyDisplay();
  return true;
}

function collectIncome() {
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    console.log(`--- Player ${i + 1} Income (Turn ${turnNumber}) ---`);

    for (const mine of p.owned_mines) {
      if (mine.collapsed) {
        console.log(`%c ${mine.label} -- DEAD (collapsed)`, "color: gray");
        continue;
      }

      if (Math.random() < mine.risk * 0.5) {
        mine.collapsed = true;
        console.log(
          `%c ${mine.label} -- COLLAPSED! (permanently destroyed)`,
          "color: red; font-weight: bold"
        );
        setCell(mine.x, mine.y, "#333");
        continue;
      }

      const income = Math.round(mine.reward * (1 + mine.risk));
      p.curr_money += income;
      console.log(`${mine.label} -- $${income}`);
    }

    for (const river of p.owned_rivers) {
      p.curr_money += river.reward;
      console.log(`${river.label} -- $${river.reward}`);
    }

    if (p.owned_mines.length === 0 && p.owned_rivers.length === 0) {
      console.log("(no properties owned)");
    }
  }
  updateMoneyDisplay();
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