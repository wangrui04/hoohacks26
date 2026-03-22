"""
eval_gui.py — Evaluate trained DQN agent with a live browser GUI

Runs a local web server + WebSocket. The browser shows the 20x20 grid,
player money, turn info, and the agent's action each step.

Usage:
    python eval_gui.py                          # both players = AI
    python eval_gui.py --human 0                # you play as P1, AI is P2
    python eval_gui.py --human 1                # AI is P1, you play as P2
    python eval_gui.py --checkpoint dqn_goldrush_25000.pt

Requirements:
    pip install websockets
"""

import argparse
import asyncio
import json
import os
import random
import threading
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

import numpy as np
import torch

from gold_rush_env import GoldRushEnv, MAX_ASSETS, GRID_SIZE, WIN_GOLD

try:
    import websockets
except ImportError:
    print("Install websockets: pip install websockets")
    exit(1)

# ============================================================
# Load model (same architecture as train_dqn.py)
# ============================================================
N_ACTIONS = 1 + 2 * MAX_ASSETS
GRID_CHANNELS = 6
SCALAR_DIM = 8

class DQN(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = torch.nn.Sequential(
            torch.nn.Conv2d(GRID_CHANNELS, 32, kernel_size=3, padding=1),
            torch.nn.ReLU(),
            torch.nn.Conv2d(32, 64, kernel_size=3, padding=1),
            torch.nn.ReLU(),
            torch.nn.AdaptiveAvgPool2d(4),
        )
        self.fc = torch.nn.Sequential(
            torch.nn.Linear(64 * 4 * 4 + SCALAR_DIM, 256),
            torch.nn.ReLU(),
            torch.nn.Linear(256, N_ACTIONS),
        )

    def forward(self, grid, scalars):
        x = self.conv(grid)
        x = x.flatten(1)
        x = torch.cat([x, scalars], dim=1)
        return self.fc(x)


def load_model(checkpoint_path):
    model = DQN()
    model.load_state_dict(torch.load(checkpoint_path, map_location="cpu", weights_only=True))
    model.eval()
    return model


def ai_select_action(model, obs):
    mask = obs["action_mask"]
    with torch.no_grad():
        g = torch.tensor(obs["grid"], dtype=torch.float32).unsqueeze(0)
        s = torch.tensor(obs["scalars"], dtype=torch.float32).unsqueeze(0)
        q = model(g, s).squeeze(0).numpy()
        q[mask == 0] = -np.inf
        return int(np.argmax(q))


# ============================================================
# Build game state JSON for the GUI
# ============================================================
def build_state_msg(env, action_info=None, game_over_info=None):
    assets = []
    for i, a in enumerate(env.all_assets):
        assets.append({
            "index": i,
            "x": a.x,
            "y": a.y,
            "type": a.asset_type,
            "level": a.level,
            "reward": a.reward,
            "risk": getattr(a, "risk", 0),
            "owner": a.owner,
            "collapsed": getattr(a, "collapsed", False),
            "upgrades": a.upgrades,
        })

    state = {
        "type": "state",
        "grid_size": GRID_SIZE,
        "players": [
            {"x": p.x, "y": p.y, "money": p.money}
            for p in env.players
        ],
        "assets": assets,
        "current_player": env.current_player,
        "turn_number": env.turn_number,
        "done": env.done,
    }
    if action_info:
        state["last_action"] = action_info
    if game_over_info:
        state["game_over"] = game_over_info
    return json.dumps(state)


def action_to_label(action, env):
    if action == 0:
        return "Skip"
    elif 1 <= action <= MAX_ASSETS:
        idx = action - 1
        if idx < len(env.all_assets):
            a = env.all_assets[idx]
            return f"Buy {a.asset_type} #{idx} (Lv{a.level}) at ({a.x},{a.y})"
        return f"Buy asset #{idx} (invalid)"
    else:
        idx = action - MAX_ASSETS - 1
        if idx < len(env.all_assets):
            a = env.all_assets[idx]
            return f"Upgrade {a.asset_type} #{idx} (Lv{a.level})"
        return f"Upgrade asset #{idx} (invalid)"


# ============================================================
# WebSocket game server
# ============================================================
async def game_session(websocket, model, human_player, speed):
    env = GoldRushEnv()
    obs, info = env.reset()

    # Send initial state
    await websocket.send(build_state_msg(env))

    while not env.done:
        current = env.current_player
        is_human = (human_player is not None and current == human_player)

        if is_human:
            # Tell GUI it's human's turn, send valid actions
            mask = obs["action_mask"]
            valid = []
            for a_idx in range(N_ACTIONS):
                if mask[a_idx] == 1:
                    valid.append({
                        "action": a_idx,
                        "label": action_to_label(a_idx, env),
                    })
            await websocket.send(json.dumps({
                "type": "your_turn",
                "valid_actions": valid,
                "current_player": current,
            }))

            # Wait for human action
            msg = await websocket.recv()
            data = json.loads(msg)
            action = data.get("action", 0)
        else:
            # AI picks
            await asyncio.sleep(speed)
            action = ai_select_action(model, obs)

        label = action_to_label(action, env)
        obs, reward, term, trunc, info = env.step(action)

        action_info = {
            "player": current,
            "action": action,
            "label": label,
            "action_type": info.get("action_type", "skip"),
            "is_ai": not is_human,
        }

        game_over_info = None
        if term or trunc:
            game_over_info = {
                "winner": info.get("winner", -1),
                "money": [p.money for p in env.players],
            }

        await websocket.send(build_state_msg(env, action_info, game_over_info))

    # Wait for restart or close
    try:
        msg = await websocket.recv()
        data = json.loads(msg)
        if data.get("restart"):
            await game_session(websocket, model, human_player, speed)
    except websockets.ConnectionClosed:
        pass


# ============================================================
# HTML GUI (served inline)
# ============================================================
GUI_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gold Rush — DQN Eval</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Bitter:wght@400;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #0a0a0a;
    color: #e0e0e0;
    font-family: 'JetBrains Mono', monospace;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px;
  }

  h1 {
    font-family: 'Bitter', serif;
    font-size: 2rem;
    color: #ffdd00;
    margin-bottom: 6px;
    letter-spacing: 2px;
    text-shadow: 0 0 20px rgba(255,221,0,0.3);
  }

  #hud {
    display: flex;
    gap: 30px;
    margin-bottom: 12px;
    font-size: 0.85rem;
  }

  .hud-item {
    padding: 6px 14px;
    border: 1px solid #333;
    border-radius: 4px;
    background: #111;
  }

  .hud-item.p1 { border-color: #ff4444; color: #ff6666; }
  .hud-item.p2 { border-color: #ef44ff; color: #ef66ff; }
  .hud-item .money { font-weight: 700; font-size: 1.1rem; }

  #canvas-wrap {
    position: relative;
    border: 2px solid #333;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 0 40px rgba(0,0,0,0.5);
  }

  canvas {
    display: block;
    cursor: crosshair;
  }

  #log {
    width: 602px;
    max-height: 200px;
    overflow-y: auto;
    margin-top: 12px;
    padding: 10px;
    background: #111;
    border: 1px solid #222;
    border-radius: 4px;
    font-size: 0.75rem;
    line-height: 1.6;
  }

  #log .entry { padding: 2px 0; border-bottom: 1px solid #1a1a1a; }
  #log .entry.ai { color: #888; }
  #log .entry.human { color: #8f8; }
  #log .entry.win { color: #ffdd00; font-weight: 700; font-size: 0.9rem; }
  #log .entry .p1 { color: #ff6666; }
  #log .entry .p2 { color: #ef66ff; }
  #log .entry .buy { color: #4a9; }
  #log .entry .upgrade { color: #49f; }
  #log .entry .skip { color: #666; }

  #actions {
    width: 602px;
    margin-top: 8px;
    display: none;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
    padding: 8px;
    background: #0f1a0f;
    border: 1px solid #2a4a2a;
    border-radius: 4px;
  }

  #actions button {
    background: #1a2a1a;
    color: #8f8;
    border: 1px solid #2a4a2a;
    padding: 6px 10px;
    border-radius: 3px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }

  #actions button:hover {
    background: #2a4a2a;
    border-color: #4a8a4a;
  }

  #turn-indicator {
    margin-top: 8px;
    font-size: 0.8rem;
    height: 24px;
    color: #666;
  }

  #restart-btn {
    margin-top: 12px;
    display: none;
    background: #ffdd00;
    color: #000;
    border: none;
    padding: 10px 30px;
    font-family: 'Bitter', serif;
    font-size: 1rem;
    font-weight: 700;
    border-radius: 4px;
    cursor: pointer;
    letter-spacing: 1px;
  }

  #restart-btn:hover { background: #ffe844; }
</style>
</head>
<body>

<h1>GOLD RUSH</h1>

<div id="hud">
  <div class="hud-item">Turn <span id="turn-num">1</span></div>
  <div class="hud-item p1">P1 $<span id="p1-money" class="money">50</span></div>
  <div class="hud-item p2">P2 $<span id="p2-money" class="money">50</span></div>
</div>

<div id="canvas-wrap">
  <canvas id="grid" width="600" height="600"></canvas>
</div>

<div id="turn-indicator">Connecting...</div>
<div id="actions"></div>
<div id="log"></div>
<button id="restart-btn">NEW GAME</button>

<script>
const CELL = 30;
const SIZE = 20;
const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');
const log = document.getElementById('log');
const actionsDiv = document.getElementById('actions');
const turnInd = document.getElementById('turn-indicator');
const restartBtn = document.getElementById('restart-btn');

const COLORS = {
  bg: '#1a1a1a',
  grid: '#222',
  mine: '#ffdd00',
  river: '#4488ff',
  p1: '#ff4444',
  p2: '#ef44ff',
  collapsed: '#333',
  owned1: 'rgba(255,68,68,0.6)',
  owned2: 'rgba(239,68,255,0.6)',
};

let state = null;
let ws = null;

function connect() {
  ws = new WebSocket('ws://localhost:8766');
  ws.onopen = () => { turnInd.textContent = 'Connected — waiting for game...'; };
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose = () => { turnInd.textContent = 'Disconnected'; };
}

function handleMessage(msg) {
  if (msg.type === 'state') {
    state = msg;
    render();
    updateHUD();

    if (msg.last_action) logAction(msg.last_action);
    if (msg.game_over) {
      const w = msg.game_over.winner;
      const label = w === -1 ? 'TIE!' : `Player ${w + 1} wins!`;
      logEntry(label + ` (P1: $${msg.game_over.money[0]}, P2: $${msg.game_over.money[1]})`, 'win');
      turnInd.textContent = label;
      restartBtn.style.display = 'block';
      actionsDiv.style.display = 'none';
    }
  } else if (msg.type === 'your_turn') {
    turnInd.textContent = `Your turn (Player ${msg.current_player + 1}) — pick an action:`;
    showActions(msg.valid_actions);
  }
}

function showActions(valid) {
  actionsDiv.innerHTML = '';
  actionsDiv.style.display = 'flex';
  for (const v of valid) {
    const btn = document.createElement('button');
    btn.textContent = v.label;
    btn.onclick = () => {
      ws.send(JSON.stringify({ action: v.action }));
      actionsDiv.style.display = 'none';
      turnInd.textContent = 'Waiting...';
    };
    actionsDiv.appendChild(btn);
  }
}

function logAction(a) {
  const pClass = a.player === 0 ? 'p1' : 'p2';
  const tClass = a.action_type || 'skip';
  const aiLabel = a.is_ai ? ' [AI]' : ' [YOU]';
  const cls = a.is_ai ? 'ai' : 'human';
  logEntry(`<span class="${pClass}">P${a.player + 1}</span>${aiLabel}: <span class="${tClass}">${a.label}</span>`, cls);
}

function logEntry(html, cls = '') {
  const div = document.createElement('div');
  div.className = 'entry ' + cls;
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function updateHUD() {
  if (!state) return;
  document.getElementById('turn-num').textContent = state.turn_number;
  document.getElementById('p1-money').textContent = state.players[0].money;
  document.getElementById('p2-money').textContent = state.players[1].money;
  if (!state.done) {
    const cp = state.current_player;
    turnInd.textContent = `Player ${cp + 1}'s turn...`;
  }
}

function render() {
  if (!state) return;
  const s = state;

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, 600, 600);

  // Grid lines
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= SIZE; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, 600); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(600, i * CELL); ctx.stroke();
  }

  // Assets
  for (const a of s.assets) {
    const x = a.x * CELL, y = a.y * CELL;

    if (a.collapsed) {
      ctx.fillStyle = COLORS.collapsed;
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      // X mark
      ctx.beginPath(); ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + CELL - 6, y + CELL - 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + CELL - 6, y + 6); ctx.lineTo(x + 6, y + CELL - 6); ctx.stroke();
      continue;
    }

    if (a.owner !== null) {
      ctx.fillStyle = a.owner === 0 ? COLORS.owned1 : COLORS.owned2;
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      // Border
      ctx.strokeStyle = a.owner === 0 ? COLORS.p1 : COLORS.p2;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
    } else {
      ctx.fillStyle = a.type === 'mine' ? COLORS.mine : COLORS.river;
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    }

    // Level indicator
    ctx.fillStyle = '#fff';
    ctx.font = '10px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText(a.level, x + CELL / 2, y + CELL / 2 + 3);
  }

  // Players
  for (let i = 0; i < 2; i++) {
    const p = s.players[i];
    const x = p.x * CELL, y = p.y * CELL;
    ctx.fillStyle = i === 0 ? COLORS.p1 : COLORS.p2;
    ctx.beginPath();
    ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText(`P${i + 1}`, x + CELL / 2, y + CELL / 2 + 4);
  }

  // Current player highlight
  if (!s.done) {
    const cp = s.players[s.current_player];
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(cp.x * CELL - 2, cp.y * CELL - 2, CELL + 4, CELL + 4);
    ctx.setLineDash([]);
  }
}

restartBtn.onclick = () => {
  ws.send(JSON.stringify({ restart: true }));
  restartBtn.style.display = 'none';
  log.innerHTML = '';
  turnInd.textContent = 'Starting new game...';
};

connect();
</script>
</body>
</html>"""


# ============================================================
# Main
# ============================================================
def main():
    parser = argparse.ArgumentParser(description="Gold Rush DQN Eval GUI")
    parser.add_argument("--checkpoint", type=str, default="dqn_goldrush_final.pt",
                        help="Path to model checkpoint")
    parser.add_argument("--human", type=int, default=None, choices=[0, 1],
                        help="Which player is human (0 or 1). Omit for AI vs AI.")
    parser.add_argument("--speed", type=float, default=0.6,
                        help="Delay between AI moves in seconds (default 0.6)")
    parser.add_argument("--port", type=int, default=8765,
                        help="HTTP server port (default 8765)")
    parser.add_argument("--ws-port", type=int, default=8766,
                        help="WebSocket port (default 8766)")
    args = parser.parse_args()

    # Load model
    if not os.path.exists(args.checkpoint):
        print(f"Checkpoint not found: {args.checkpoint}")
        print("Train first with: python train_dqn.py")
        return

    print(f"Loading model from {args.checkpoint}...")
    model = load_model(args.checkpoint)
    print("Model loaded.")

    # Write GUI HTML to a temp file
    gui_dir = Path("eval_gui_static")
    gui_dir.mkdir(exist_ok=True)
    gui_path = gui_dir / "index.html"

    # Inject the correct WS port
    html = GUI_HTML.replace("ws://localhost:8766", f"ws://localhost:{args.ws_port}")
    gui_path.write_text(html)

    # Start HTTP server in background
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(gui_dir), **kw)
        def log_message(self, *a):
            pass  # suppress logs

    http = HTTPServer(("localhost", args.port), Handler)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    print(f"GUI: http://localhost:{args.port}")

    # Start WebSocket server
    async def handler(websocket):
        await game_session(websocket, model, args.human, args.speed)

    async def run_ws():
        async with websockets.serve(handler, "localhost", args.ws_port):
            print(f"WebSocket: ws://localhost:{args.ws_port}")
            mode = f"Human=P{args.human + 1}" if args.human is not None else "AI vs AI"
            print(f"Mode: {mode} | Speed: {args.speed}s")
            print()
            webbrowser.open(f"http://localhost:{args.port}")
            await asyncio.Future()  # run forever

    asyncio.run(run_ws())


if __name__ == "__main__":
    main()