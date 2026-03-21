"""
train_dqn.py — Double DQN with action masking for Gold Rush self-play

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

from gold_rush_env import GoldRushEnv, MAX_ASSETS, GRID_SIZE

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
EPS_DECAY_STEPS = 80_000
SAVE_FREQ = 5000

N_ACTIONS = 1 + 2 * MAX_ASSETS   # 61
GRID_CHANNELS = 6
SCALAR_DIM = 8

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ============================================================
# Network — basic CNN + scalar concat → Q-values
# ============================================================
class DQN(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(GRID_CHANNELS, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d(4),  # (64, 4, 4) = 1024
        )
        self.fc = nn.Sequential(
            nn.Linear(64 * 4 * 4 + SCALAR_DIM, 256),
            nn.ReLU(),
            nn.Linear(256, N_ACTIONS),
        )

    def forward(self, grid, scalars):
        x = self.conv(grid)
        x = x.flatten(1)
        x = torch.cat([x, scalars], dim=1)
        return self.fc(x)


# ============================================================
# Replay buffer
# ============================================================
class ReplayBuffer:
    def __init__(self, capacity):
        self.buf = deque(maxlen=capacity)

    def push(self, grid, scalars, action, reward, next_grid, next_scalars, next_mask, done):
        self.buf.append((grid, scalars, action, reward, next_grid, next_scalars, next_mask, done))

    def sample(self, batch_size):
        batch = random.sample(self.buf, batch_size)
        g, s, a, r, ng, ns, nm, d = zip(*batch)
        return (
            torch.tensor(np.array(g), dtype=torch.float32, device=device),
            torch.tensor(np.array(s), dtype=torch.float32, device=device),
            torch.tensor(a, dtype=torch.long, device=device),
            torch.tensor(r, dtype=torch.float32, device=device),
            torch.tensor(np.array(ng), dtype=torch.float32, device=device),
            torch.tensor(np.array(ns), dtype=torch.float32, device=device),
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
        q = model(g, s).squeeze(0).cpu().numpy()
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
        obs, _ = env.reset()
        ep_reward = 0.0
        ep_len = 0

        while True:
            eps = epsilon(global_step)
            action = select_action(online, obs, eps)
            next_obs, reward, term, trunc, info = env.step(action)
            done = term or trunc

            replay.push(
                obs["grid"], obs["scalars"], action, reward,
                next_obs["grid"], next_obs["scalars"], next_obs["action_mask"], done,
            )

            ep_reward += reward
            ep_len += 1
            global_step += 1
            obs = next_obs

            # Learn
            if len(replay) >= MIN_REPLAY:
                g, s, a, r, ng, ns, nm, d = replay.sample(BATCH_SIZE)

                q = online(g, s).gather(1, a.unsqueeze(1)).squeeze(1)

                with torch.no_grad():
                    # Double DQN
                    next_q_online = online(ng, ns)
                    next_q_online[~nm] = -1e9
                    best_a = next_q_online.argmax(dim=1)
                    next_q = target(ng, ns).gather(1, best_a.unsqueeze(1)).squeeze(1)
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