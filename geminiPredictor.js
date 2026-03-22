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
const GEMINI_MODEL = "gemini-2.5-flash";       // fast + free-tier friendly
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
  const scene = snapshotState();

  // ---- Game rules summary ----
  const rules = `
You are analyzing a 2-player strategy board game called "Gold Rush".

RULES:
- Two players start on opposite corners of a 20×20 grid with $${STARTING_MONEY} each.
- The goal is to reach $${WIN_GOLD} first. The match is best-of-${TOTAL_ROUNDS}.
- Each turn a player can: BUY an unclaimed mine or river, UPGRADE an owned asset, or SKIP.
- Mines: higher reward but have a collapse risk (cave-in destroys the mine and costs money).
  Price = (8 + level*6) * e^(0.03 * manhattan_distance). Income ≈ reward * (1 + e^risk).
- Rivers: lower reward, zero risk, but after buying a river the player MUST buy a mine next.
  Price = (4 + level*4) * e^(0.03 * manhattan_distance). Income = reward per turn.
- Each asset can be upgraded once (+25% reward, free action).
- After both players act, income is collected and mines may collapse.
- Player 1 (index 0) is the HUMAN. Player 2 (index 1) is the AI opponent.
`;

  // ---- Current scene ----
  const sceneJSON = JSON.stringify(scene, null, 2);

  // ---- Replay buffer (all past human decisions) ----
  const humanDecisions = replayBuffer.filter(e => e.action.playerIdx === 0);
  // Trim to last 30 decisions to stay within context limits
  const recentDecisions = humanDecisions.slice(-30);
  const bufferJSON = JSON.stringify(recentDecisions, null, 2);

  // ---- Available actions right now ----
  const p = players[0];
  const availableActions = [];
  availableActions.push("SKIP");

  const allAssets = [...mines, ...riverMines];
  for (const asset of allAssets) {
    const isMine = mines.includes(asset);
    if (asset.owner === null) {
      if (isMine && asset.collapsed) continue;
      if (!isMine && p.mustBuyMineBeforeRiver) continue;
      const d = dist(p.x, p.y, asset.x, asset.y);
      const price = isMine
        ? minePriceFn(d, asset.level)
        : riverPriceFn(d, asset.level);
      if (p.curr_money >= price) {
        availableActions.push(
          `BUY ${asset.label} (${isMine ? "mine" : "river"}, level ${asset.level}, ` +
          `reward $${asset.reward}, dist ${d}, price $${price}` +
          `${isMine ? `, risk ${(asset.risk * 100).toFixed(0)}%` : ", no risk"})`
        );
      }
    }
    if (asset.owner === p && asset.upgrades < 1 && !(isMine && asset.collapsed)) {
      availableActions.push(
        `UPGRADE ${asset.label} (${isMine ? "mine" : "river"}, reward $${asset.reward} → $${Math.round(asset.reward * 1.25)})`
      );
    }
  }

  const actionsText = availableActions.join("\n  ");

  // ---- Final prompt ----
  return `${rules}

CURRENT GAME STATE (Turn ${scene.turnNumber}, Round ${scene.currentRound}):
${sceneJSON}

AVAILABLE ACTIONS FOR PLAYER 1 (human) THIS TURN:
  ${actionsText}

PLAYER 1'S DECISION HISTORY (most recent ${recentDecisions.length} decisions):
${bufferJSON}

TASK:
Predict what Player 1 will do THIS turn based on their past behavior and the current state.

Respond with EXACTLY two lines and nothing else:
ACTION: (one of the available actions above, verbatim)
CONFIDENCE: (low / medium / high)`;
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
          maxOutputTokens: 256,
          thinkingConfig: { thinkingBudget: 0 },
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