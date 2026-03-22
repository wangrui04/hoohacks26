"""
train_dqn.py — Double DQN with action masking for Gold Rush self-play

Network consumes three observation components:
  1. grid    (6, 20, 20)  — spatial layout via CNN
  2. scalars (8,)         — global game state
  3. asset_table (30, 14) — per-asset features (level, reward, risk, distance, price, etc.)

Usage:
    python train_dqn.py
    python train_dqn.py --episodes 50000
"""

import argparse
import random
from collections import deque

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

from gold_rush_env import GoldRushEnv, MAX_ASSETS, GRID_SIZE, WIN_GOLD

# ============================================================
# Config
# ============================================================
BATCH_SIZE = 128
GAMMA = 0.99
LR = 1e-4
REPLAY_SIZE = 100_000
MIN_REPLAY = 5_000
TARGET_UPDATE_FREQ = 1000
EPS_START = 1.0
EPS_END = 0.05
EPS_DECAY_STEPS = 400_000
SAVE_FREQ = 5000

N_ACTIONS = 1 + 2 * MAX_ASSETS   # 61
GRID_CHANNELS = 6
SCALAR_DIM = 8
ASSET_FEATURES = 14

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ============================================================
# Reward shaping
# ============================================================
def shape_reward(env_reward, info, money_before, money_after, opp_money_after):
    r = env_reward

    delta = (money_after - money_before) / WIN_GOLD
    r += 0.1 * delta

    lead = (money_after - opp_money_after) / WIN_GOLD
    r += 0.05 * lead

    action_type = info.get("action_type", "skip")
    if action_type == "buy":
        r += 0.02
    elif action_type == "upgrade":
        r += 0.01
    elif action_type == "skip":
        r -= 0.01

    return r


# ============================================================
# Network
# ============================================================
class DQN(nn.Module):
    """
    Three-branch architecture:

    Branch 1 — CNN on grid (6, 20, 20):
        2x Conv2d -> AdaptiveAvgPool -> flatten -> 1024

    Branch 2 — MLP on asset table (30, 14):
        Per-asset MLP (shared weights) -> pool across assets -> 64
        This lets the network reason about each asset's properties
        (reward, risk, distance, price, affordability) directly.

    Branch 3 — Scalars (8):
        Passed through directly.

    All three concatenated -> FC -> Q-values (61)
    """
    def __init__(self):
        super().__init__()

        # Branch 1: spatial grid
        self.conv = nn.Sequential(
            nn.Conv2d(GRID_CHANNELS, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d(4),  # (64, 4, 4) = 1024
        )

        # Branch 2: per-asset features
        # Process each asset's 14 features independently (shared MLP)
        # then aggregate across all assets
        self.asset_mlp = nn.Sequential(
            nn.Linear(ASSET_FEATURES, 32),
            nn.ReLU(),
            nn.Linear(32, 32),
            nn.ReLU(),
        )
        # After max-pool + mean-pool concat: 32 + 32 = 64
        asset_pool_dim = 64

        # Combined head
        combined_dim = 64 * 4 * 4 + asset_pool_dim + SCALAR_DIM  # 1024 + 64 + 8 = 1096
        self.fc = nn.Sequential(
            nn.Linear(combined_dim, 256),
            nn.ReLU(),
            nn.Linear(256, N_ACTIONS),
        )

    def forward(self, grid, scalars, asset_table):
        # grid: (B, 6, 20, 20)
        # scalars: (B, 8)
        # asset_table: (B, 30, 14)

        # Branch 1: CNN
        g = self.conv(grid).flatten(1)  # (B, 1024)

        # Branch 2: per-asset MLP + pool
        B, N, F = asset_table.shape
        a = self.asset_mlp(asset_table)  # (B, 30, 32)
        a_max = a.max(dim=1).values      # (B, 32)
        a_mean = a.mean(dim=1)           # (B, 32)
        a_pool = torch.cat([a_max, a_mean], dim=1)  # (B, 64)

        # Combine all branches
        x = torch.cat([g, a_pool, scalars], dim=1)  # (B, 1096)
        return self.fc(x)


# ============================================================
# Replay buffer
# ============================================================
class ReplayBuffer:
    def __init__(self, capacity):
        self.buf = deque(maxlen=capacity)

    def push(self, grid, scalars, asset_table, action, reward,
             next_grid, next_scalars, next_asset_table, next_mask, done):
        self.buf.append((grid, scalars, asset_table, action, reward,
                         next_grid, next_scalars, next_asset_table, next_mask, done))

    def sample(self, batch_size):
        batch = random.sample(self.buf, batch_size)
        g, s, at, a, r, ng, ns, nat, nm, d = zip(*batch)
        return (
            torch.tensor(np.array(g), dtype=torch.float32, device=device),
            torch.tensor(np.array(s), dtype=torch.float32, device=device),
            torch.tensor(np.array(at), dtype=torch.float32, device=device),
            torch.tensor(a, dtype=torch.long, device=device),
            torch.tensor(r, dtype=torch.float32, device=device),
            torch.tensor(np.array(ng), dtype=torch.float32, device=device),
            torch.tensor(np.array(ns), dtype=torch.float32, device=device),
            torch.tensor(np.array(nat), dtype=torch.float32, device=device),
            torch.tensor(np.array(nm), dtype=torch.bool, device=device),
            torch.tensor(d, dtype=torch.float32, device=device),
        )

    def __len__(self):
        return len(self.buf)


# ============================================================
# Helpers
# ============================================================
def epsilon(step):
    return max(EPS_END, EPS_START - (EPS_START - EPS_END) * step / EPS_DECAY_STEPS)


def select_action(model, obs, eps):
    mask = obs["action_mask"]
    valid = np.where(mask == 1)[0]

    if random.random() < eps:
        return int(np.random.choice(valid))

    with torch.no_grad():
        g = torch.tensor(obs["grid"], dtype=torch.float32, device=device).unsqueeze(0)
        s = torch.tensor(obs["scalars"], dtype=torch.float32, device=device).unsqueeze(0)
        at = torch.tensor(obs["asset_table"], dtype=torch.float32, device=device).unsqueeze(0)
        q = model(g, s, at).squeeze(0).cpu().numpy()
        q[mask == 0] = -np.inf
        return int(np.argmax(q))


# ============================================================
# Training
# ============================================================
def train(num_episodes=30_000):
    env = GoldRushEnv()
    online = DQN().to(device)
    target = DQN().to(device)
    target.load_state_dict(online.state_dict())
    target.eval()

    optimizer = optim.Adam(online.parameters(), lr=LR)
    replay = ReplayBuffer(REPLAY_SIZE)

    global_step = 0
    recent_rewards = deque(maxlen=100)
    recent_lengths = deque(maxlen=100)
    recent_wins = deque(maxlen=100)

    for ep in range(1, num_episodes + 1):
        obs, info = env.reset()
        ep_reward = 0.0
        ep_len = 0

        while True:
            eps = epsilon(global_step)

            acting = env.current_player
            money_before = env.players[acting].money

            action = select_action(online, obs, eps)
            next_obs, env_reward, term, trunc, info = env.step(action)
            done = term or trunc

            money_after = env.players[acting].money
            opp_money = env.players[1 - acting].money
            reward = shape_reward(env_reward, info, money_before, money_after, opp_money)

            replay.push(
                obs["grid"], obs["scalars"], obs["asset_table"],
                action, reward,
                next_obs["grid"], next_obs["scalars"], next_obs["asset_table"],
                next_obs["action_mask"], done,
            )

            ep_reward += reward
            ep_len += 1
            global_step += 1
            obs = next_obs

            # Learn
            if len(replay) >= MIN_REPLAY:
                g, s, at, a, r, ng, ns, nat, nm, d = replay.sample(BATCH_SIZE)

                q = online(g, s, at).gather(1, a.unsqueeze(1)).squeeze(1)

                with torch.no_grad():
                    next_q_online = online(ng, ns, nat)
                    next_q_online[~nm] = -1e9
                    best_a = next_q_online.argmax(dim=1)
                    next_q = target(ng, ns, nat).gather(1, best_a.unsqueeze(1)).squeeze(1)
                    td_target = r + GAMMA * next_q * (1 - d)

                loss = nn.functional.smooth_l1_loss(q, td_target)
                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(online.parameters(), 10.0)
                optimizer.step()

                if global_step % TARGET_UPDATE_FREQ == 0:
                    target.load_state_dict(online.state_dict())

            if done:
                break

        recent_rewards.append(ep_reward)
        recent_lengths.append(ep_len)
        recent_wins.append(1 if info.get("winner") == 0 else 0)

        if ep % 200 == 0:
            print(
                f"Ep {ep:>6} | Steps {global_step:>8} | "
                f"eps={eps:.3f} | Avg R: {np.mean(recent_rewards):+.3f} | "
                f"Avg len: {np.mean(recent_lengths):.0f} | "
                f"P1 win%: {np.mean(recent_wins):.1%}"
            )

        if ep % SAVE_FREQ == 0:
            torch.save(online.state_dict(), f"dqn_goldrush_{ep}.pt")
            print(f"  -> Saved dqn_goldrush_{ep}.pt")

    torch.save(online.state_dict(), "dqn_goldrush_final.pt")
    print("Training complete. Saved dqn_goldrush_final.pt")
    return online


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--episodes", type=int, default=30_000)
    args = parser.parse_args()
    train(args.episodes)