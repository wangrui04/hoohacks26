// ========================
// geminiPredictor.js — Query Gemini before each human turn to predict
//                      what the user will do next.
//
// Add to index.html AFTER replayBuffer.js and BEFORE turnSystem.js:
//   <script src="geminiPredictor.js"></script>
//
// Set your API key below or via the browser console:
//   GEMINI_API_KEY = "your-key-here";
//
// The latest prediction is always available in the global:
//   geminiPrediction   (string — the model's raw text response)
//   geminiPredictions  (array  — full history of all predictions)
// ========================

// --- Config ---
let GEMINI_API_KEY = "";                       // SET THIS or paste in console
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";      // fast + free-tier friendly
// Other options: "gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-3-flash-preview"

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// --- Global prediction state ---
let geminiPrediction = null;       // latest prediction text
let geminiPredicting = false;      // true while a request is in-flight
const geminiPredictions = [];      // full history

// ========================
// UI helpers — update the prediction panel
// ========================

function updatePredictionPanel(text) {
  const el = document.getElementById("prediction-content");
  if (!el) return;
  el.innerHTML = text;
}

function showPredictionLoading() {
  updatePredictionPanel('<span class="pred-loading">Analyzing patterns...</span>');
}

function showPredictionResult(raw) {
  const actionMatch = raw.match(/ACTION:\s*(.+)/i);
  const confMatch = raw.match(/CONFIDENCE:\s*(.+)/i);

  if (actionMatch) {
    const action = actionMatch[1].trim();
    const conf = confMatch ? confMatch[1].trim() : "?";
    updatePredictionPanel(
      `<span class="pred-action">ACTION: ${action}</span> | <span class="pred-confidence">CONFIDENCE: ${conf}</span>`
    );
  } else {
    updatePredictionPanel(`<span class="pred-action">${raw.trim()}</span>`);
  }
}

// ========================
// Build the prompt
// ========================

function buildGeminiPrompt() {
  const p = players[0];
  const p2 = players[1];

  // Compact history
  const recent = replayBuffer.slice(-15);
  const history = recent.map(e =>
    `T${e.turn}:${e.action}${e.label ? " " + e.label : ""} $${e.price}`
  ).join(" | ");

  // Compact available actions with distances to both players
  const actions = ["SKIP"];
  const allAssets = [...mines, ...riverMines];
  for (const asset of allAssets) {
    const isMine = mines.includes(asset);
    if (asset.owner === null && !(isMine && asset.collapsed)) {
      if (!isMine && p.mustBuyMineBeforeRiver) continue;
      const d1 = dist(p.x, p.y, asset.x, asset.y);
      const d2 = dist(p2.x, p2.y, asset.x, asset.y);
      const price = isMine ? minePriceFn(d1, asset.level) : riverPriceFn(d1, asset.level);
      if (p.curr_money >= price) {
        actions.push(`BUY ${asset.label} lv${asset.level} $${price} distance from P1=${d1} distance from dP2=${d2}${isMine ? " r" + Math.round(asset.risk * 100) + "%" : ""}`);
      }
    }
    if (asset.owner === p && asset.upgrades < 1 && !(isMine && asset.collapsed)) {
      actions.push(`UPG ${asset.label} $${asset.reward}→$${Math.round(asset.reward * 1.25)}`);
    }
  }

  return `You are predicting Player 1's next move in Gold Rush, a 2P grid strategy game. Goal: reach $${WIN_GOLD} first. Mines=high reward+risk. Rivers=low reward+safe but must buy mine after. Upgrade=+25% reward, free action.
P1(you):$${p.curr_money} owns ${p.owned_mines.length}mines/${p.owned_rivers.length}rivers${p.mustBuyMineBeforeRiver ? " MUST-BUY-MINE-NEXT" : ""} | P2:$${p2.curr_money} owns ${p2.owned_mines.length}m/${p2.owned_rivers.length}r | Turn ${turnNumber} Round ${currentRound}
History: ${history}
Actions: ${actions.join(" | ")}
Predict P1's action. Closer assets (lower dP1) are cheaper. Consider what P2 might contest (low dP2).
Reply EXACTLY:
ACTION: (verbatim from above)
CONFIDENCE: low/medium/high`;
}

// ========================
// Query Gemini
// ========================

async function queryGemini() {
  if (!GEMINI_API_KEY) {
    console.warn("geminiPredictor: No API key set. Set GEMINI_API_KEY in console.");
    updatePredictionPanel('<span class="pred-loading">No API key set.\nRun in console:\nGEMINI_API_KEY = "your-key"</span>');
    return null;
  }
  if (geminiPredicting) {
    console.log("geminiPredictor: already in-flight, skipping.");
    return null;
  }

  geminiPredicting = true;
  showPredictionLoading();
  const prompt = buildGeminiPrompt();

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 80,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`geminiPredictor: API error ${response.status}`, errText);
      updatePredictionPanel(`<span class="pred-loading">API error ${response.status}</span>`);
      geminiPredicting = false;
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

    if (text) {
      geminiPrediction = text;
      geminiPredictions.push({
        id: geminiPredictions.length,
        timestamp: Date.now(),
        turnNumber: turnNumber,
        currentRound: currentRound,
        prediction: text,
      });
      console.log(`geminiPredictor [Turn ${turnNumber}]:`, text);
      showPredictionResult(text);
    } else {
      console.warn("geminiPredictor: empty response", data);
      updatePredictionPanel('<span class="pred-loading">No prediction returned</span>');
    }

    geminiPredicting = false;
    return text;
  } catch (err) {
    console.error("geminiPredictor: fetch failed", err);
    geminiPredicting = false;
    return null;
  }
}

// ========================
// Hook: call before each human turn
// ========================

/**
 * Call this at the start of the human player's turn.
 * It fires the Gemini query in the background (non-blocking).
 * The prediction lands in `geminiPrediction` when ready.
 */
function geminiPredictBeforeTurn() {
  // Only predict for human player (index 0) when game is active
  if (currentPlayerIndex !== 0 || gameOver || matchOver) return;
  // Need at least 1 past decision to have any pattern
  if (replayBuffer.length === 0) return;

  queryGemini(); // fire-and-forget (async)
}