// ========================
// ai.js — DQN agent for Player 2 via ONNX Runtime Web
//
// Add to index.html BEFORE index.js:
//   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
//   <script src="ai.js"></script>
//
// Place gold_rush_dqn.onnx in the same directory as index.html.
// ========================

const AI_PLAYER = 1;           // Player 2 (index 1)
const MAX_ASSETS_AI = 30;
const N_ACTIONS_AI = 1 + 2 * MAX_ASSETS_AI;  // 61
const ASSET_FEATURES_AI = 14;
const MAX_MANHATTAN = 38;

let aiSession = null;
let aiReady = false;

// ========================
// Load ONNX model
// ========================
async function loadAIModel(modelPath) {
  try {
    const response = await fetch(modelPath + '.data');
    const dataBuffer = await response.arrayBuffer();
    
    aiSession = await ort.InferenceSession.create(modelPath, {
      externalData: [{ path: 'gold_rush_dqn.onnx.data', data: new Uint8Array(dataBuffer) }]
    });
    aiReady = true;
    console.log("AI model loaded successfully");
  } catch (e) {
    console.error("Failed to load AI model:", e);
    aiReady = false;
  }
}

// Call this on page load
loadAIModel("gold_rush_dqn.onnx");

// ========================
// Build observation from live JS game state
// (must match gold_rush_env.py _obs() exactly)
// ========================
function buildObservation() {
  const me = AI_PLAYER;
  const opp = 1 - me;
  const pMe = players[me];
  const pOpp = players[opp];

  // --- Grid (6, 20, 20) stored flat in row-major ---
  const grid_obs = new Float32Array(6 * GRID_SIZE * GRID_SIZE);

  // All assets in canonical order: mines array then riverMines array
  const allAssets = [...mines, ...riverMines];

  for (const asset of allAssets) {
    const x = asset.x;
    const y = asset.y;
    const isMine = mines.includes(asset);
    const level = asset.level;

    if (asset.owner === null) {
      if (isMine && !asset.collapsed) {
        // ch0: unclaimed mines
        grid_obs[0 * GRID_SIZE * GRID_SIZE + y * GRID_SIZE + x] = level / 3.0;
      } else if (!isMine) {
        // ch1: unclaimed rivers
        grid_obs[1 * GRID_SIZE * GRID_SIZE + y * GRID_SIZE + x] = level / 3.0;
      }
    } else if (asset.owner === pMe) {
      // ch2: my assets
      grid_obs[2 * GRID_SIZE * GRID_SIZE + y * GRID_SIZE + x] = level / 3.0;
    } else {
      // ch3: opponent assets
      grid_obs[3 * GRID_SIZE * GRID_SIZE + y * GRID_SIZE + x] = level / 3.0;
    }
  }

  // ch4: my position
  grid_obs[4 * GRID_SIZE * GRID_SIZE + pMe.y * GRID_SIZE + pMe.x] = 1.0;
  // ch5: opponent position
  grid_obs[5 * GRID_SIZE * GRID_SIZE + pOpp.y * GRID_SIZE + pOpp.x] = 1.0;

  // --- Scalars (8) ---
  const myMines = pMe.owned_mines.length;
  const myRivers = pMe.owned_rivers.length;
  const oppMines = pOpp.owned_mines.length;
  const oppRivers = pOpp.owned_rivers.length;

  const scalars = new Float32Array([
    pMe.curr_money / WIN_GOLD,
    pOpp.curr_money / WIN_GOLD,
    turnNumber / 200.0,
    myMines / MAX_ASSETS_AI,
    myRivers / MAX_ASSETS_AI,
    oppMines / MAX_ASSETS_AI,
    oppRivers / MAX_ASSETS_AI,
    me,
  ]);

  // --- Asset table (30, 14) ---
  const assetTable = new Float32Array(MAX_ASSETS_AI * ASSET_FEATURES_AI);

  for (let i = 0; i < allAssets.length && i < MAX_ASSETS_AI; i++) {
    const asset = allAssets[i];
    const isMine = mines.includes(asset);
    const offset = i * ASSET_FEATURES_AI;

    const dMe = dist(pMe.x, pMe.y, asset.x, asset.y);
    const dOpp = dist(pOpp.x, pOpp.y, asset.x, asset.y);
    const price = isMine
      ? minePriceFn(dMe, asset.level)
      : riverPriceFn(dMe, asset.level);

    const risk = isMine ? asset.risk : 0.0;
    const collapsed = (isMine && asset.collapsed) ? 1.0 : 0.0;
    const ownerMe = (asset.owner === pMe) ? 1.0 : 0.0;
    const ownerOpp = (asset.owner === pOpp) ? 1.0 : 0.0;
    const ownerNone = (asset.owner === null) ? 1.0 : 0.0;
    const affordable = (ownerNone > 0.5 && collapsed < 0.5 && pMe.curr_money >= price) ? 1.0 : 0.0;

    assetTable[offset + 0] = isMine ? 1.0 : 0.0;      // is_mine
    assetTable[offset + 1] = isMine ? 0.0 : 1.0;      // is_river
    assetTable[offset + 2] = asset.level / 3.0;         // level
    assetTable[offset + 3] = asset.reward / 30.0;       // reward
    assetTable[offset + 4] = risk;                       // risk
    assetTable[offset + 5] = collapsed;                  // collapsed
    assetTable[offset + 6] = ownerMe;                    // owner_me
    assetTable[offset + 7] = ownerOpp;                   // owner_opp
    assetTable[offset + 8] = ownerNone;                  // owner_none
    assetTable[offset + 9] = asset.upgrades;             // upgrades
    assetTable[offset + 10] = dMe / MAX_MANHATTAN;       // dist_to_me
    assetTable[offset + 11] = dOpp / MAX_MANHATTAN;      // dist_to_opp
    assetTable[offset + 12] = Math.min(price / 200.0, 1.0); // price_for_me
    assetTable[offset + 13] = affordable;                // affordable
  }

  return { grid_obs, scalars, assetTable };
}

// ========================
// Build action mask from live game state
// (must match gold_rush_env.py _action_mask() exactly)
// ========================
function buildActionMask() {
  const mask = new Float32Array(N_ACTIONS_AI);
  mask[0] = 1; // skip always valid

  const p = players[AI_PLAYER];
  const allAssets = [...mines, ...riverMines];

  for (let i = 0; i < allAssets.length && i < MAX_ASSETS_AI; i++) {
    const asset = allAssets[i];
    const isMine = mines.includes(asset);

    // Buy slot
    if (asset.owner === null) {
      if (isMine && asset.collapsed) continue;
      // mustBuyMineBeforeRiver constraint
      if (!isMine && p.mustBuyMineBeforeRiver) continue;

      const d = dist(p.x, p.y, asset.x, asset.y);
      const price = isMine
        ? minePriceFn(d, asset.level)
        : riverPriceFn(d, asset.level);

      if (p.curr_money >= price) {
        mask[1 + i] = 1;
      }
    }

    // Upgrade slot
    if (asset.owner === p && asset.upgrades < 1) {
      if (!(isMine && asset.collapsed)) {
        mask[MAX_ASSETS_AI + 1 + i] = 1;
      }
    }
  }

  return mask;
}

// ========================
// Convert action index to game action
// ========================
function executeAIAction(actionIdx) {
  const allAssets = [...mines, ...riverMines];
  const p = players[AI_PLAYER];

  if (actionIdx === 0) {
    // Skip
    roundSelections[AI_PLAYER] = { label: "Skipped", type: "skip", price: 0 };
    p.recordAction("skip");
    updateStatus(`Player ${AI_PLAYER + 1} (AI) skipped their turn.`);
    return true;
  }

  if (actionIdx >= 1 && actionIdx <= MAX_ASSETS_AI) {
    // Buy
    const assetIdx = actionIdx - 1;
    if (assetIdx < allAssets.length) {
      const asset = allAssets[assetIdx];
      const isMine = mines.includes(asset);
      const type = isMine ? "mine" : "river";
      return buyItem(p, AI_PLAYER, asset, type);
    }
  }

  if (actionIdx >= MAX_ASSETS_AI + 1 && actionIdx < N_ACTIONS_AI) {
    // Upgrade
    const assetIdx = actionIdx - MAX_ASSETS_AI - 1;
    if (assetIdx < allAssets.length) {
      const asset = allAssets[assetIdx];
      const isMine = mines.includes(asset);
      const type = isMine ? "mine" : "river";
      performUpgrade(AI_PLAYER, asset, type);
      return true;
    }
  }

  // Fallback: skip
  roundSelections[AI_PLAYER] = { label: "Skipped", type: "skip", price: 0 };
  p.recordAction("skip");
  return true;
}

// ========================
// Run AI inference
// ========================
async function aiTakeTurn() {
  if (!aiReady || !aiSession) {
    console.warn("AI not ready, skipping turn");
    roundSelections[AI_PLAYER] = { label: "Skipped", type: "skip", price: 0 };
    players[AI_PLAYER].recordAction("skip");
    updateStatus(`Player ${AI_PLAYER + 1} (AI) skipped — model not loaded.`);
    setTimeout(nextTurn, 800);
    return;
  }

  const { grid_obs, scalars, assetTable } = buildObservation();
  const mask = buildActionMask();

  // Create ONNX tensors
  const gridTensor = new ort.Tensor("float32", grid_obs, [1, 6, GRID_SIZE, GRID_SIZE]);
  const scalarsTensor = new ort.Tensor("float32", scalars, [1, 8]);
  const assetTensor = new ort.Tensor("float32", assetTable, [1, MAX_ASSETS_AI, ASSET_FEATURES_AI]);

  // Run inference
  const results = await aiSession.run({
    grid: gridTensor,
    scalars: scalarsTensor,
    asset_table: assetTensor,
  });

  const qValues = results.q_values.data;

  // Apply action mask: set invalid actions to -Infinity
  let bestAction = 0;
  let bestQ = -Infinity;
  for (let i = 0; i < N_ACTIONS_AI; i++) {
    if (mask[i] > 0.5) {
      if (qValues[i] > bestQ) {
        bestQ = qValues[i];
        bestAction = i;
      }
    }
  }

  console.log(`AI chose action ${bestAction} (Q=${bestQ.toFixed(3)})`);

  const success = executeAIAction(bestAction);
  if (success) {
    setTimeout(nextTurn, 800);
  }
}

// ========================
// Hook: call this from your game loop when it's AI's turn
// ========================
function isAITurn() {
  return currentPlayerIndex === AI_PLAYER && !gameOver && !matchOver;
}