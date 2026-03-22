"""
gold_rush_env.py — Gymnasium environment for Gold Rush
Faithful 1:1 port of the JS game (consts.js, turnSystem.js, index.js, etc.)

Key design decisions for ONNX deployment compatibility:
  - Action space is Discrete with fixed size (1 + 2*MAX_ASSETS)
  - Assets stored in a canonical flat list (mines first, then rivers)
  - Observation uses the same indexing the JS inference wrapper will use
  - All math matches JS exactly: Math.round → Python round(), etc.
"""

import math
import random
from dataclasses import dataclass, field
from typing import Optional, List, Tuple

import gymnasium as gym
import numpy as np
from gymnasium import spaces


# ============================================================
# Constants — exact mirrors of consts.js
# ============================================================
GRID_SIZE = 20
WIN_GOLD = 500
STARTING_MONEY = 50
PLAYER_ZONE_RADIUS = 5
FAIRNESS_RATIO = 1.4
MAX_GENERATION_ATTEMPTS = 50

# Fixed upper bound on total assets so action space is constant across episodes.
# JS uses getRandomInt(5,12) mines + getRandomInt(7,17) rivers → max 29.
MAX_ASSETS = 30

# Safety cap — if nobody wins after this many full turns, truncate.
MAX_TURNS = 200


def mine_price_fn(distance: int, level: int) -> int:
    """Mirrors JS: Math.max(1, Math.round((8 + level * 6) * Math.exp(0.03 * distance)))"""
    return max(1, round((8 + level * 6) * math.exp(0.03 * distance)))


def river_price_fn(distance: int, level: int) -> int:
    """Mirrors JS: Math.max(1, Math.round((4 + level * 4) * Math.exp(0.03 * distance)))"""
    return max(1, round((4 + level * 4) * math.exp(0.03 * distance)))


def manhattan(ax: int, ay: int, bx: int, by: int) -> int:
    """Mirrors JS dist()"""
    return abs(ax - bx) + abs(ay - by)


# ============================================================
# Data classes — mirrors mine.js, riverMine.js, player.js
# ============================================================
@dataclass
class MineAsset:
    x: int
    y: int
    reward: int = 10
    level: int = 1
    risk: float = 0.5
    collapsed: bool = False
    upgrades: int = 0
    owner: Optional[int] = None   # player index (0 or 1) or None
    asset_type: str = "mine"


@dataclass
class RiverAsset:
    x: int
    y: int
    reward: int = 10
    level: int = 1
    upgrades: int = 0
    owner: Optional[int] = None
    asset_type: str = "river"


@dataclass
class PlayerState:
    x: int
    y: int
    money: int = STARTING_MONEY
    owned_mine_indices: List[int] = field(default_factory=list)   # indices into all_assets
    owned_river_indices: List[int] = field(default_factory=list)


# ============================================================
# Environment
# ============================================================
class GoldRushEnv(gym.Env):
    """
    Two-player turn-based Gold Rush on a 20x20 grid.
    Single round (no best-of-5 — handle series in training loop).

    Action space  (Discrete, size = 1 + 2 * MAX_ASSETS):
        0                        -> skip turn
        1  ..  MAX_ASSETS        -> buy   all_assets[action - 1]
        MAX_ASSETS+1 .. 2*MAX    -> upgrade all_assets[action - MAX_ASSETS - 1]

    Observation space (Dict):
        "grid"        : float32 (6, 20, 20)
        "scalars"     : float32 (8,)
        "action_mask" : int8    (1 + 2*MAX_ASSETS,)
    """

    metadata = {"render_modes": ["ansi"]}

    def __init__(self, render_mode: Optional[str] = None,
                 num_mines: Optional[int] = None,
                 num_rivers: Optional[int] = None):
        super().__init__()
        self.render_mode = render_mode
        self._fixed_num_mines = num_mines
        self._fixed_num_rivers = num_rivers

        self.n_actions = 1 + 2 * MAX_ASSETS
        self.action_space = spaces.Discrete(self.n_actions)

        # Per-asset feature count:
        #   is_mine, is_river, level/3, reward/30, risk,
        #   collapsed, owner_me, owner_opp, owner_none,
        #   upgrades, dist_to_me/38, dist_to_opp/38,
        #   price_for_me/200, affordable
        ASSET_FEATURES = 14
        self.asset_features = ASSET_FEATURES

        self.observation_space = spaces.Dict({
            "grid": spaces.Box(0.0, 1.0, shape=(6, GRID_SIZE, GRID_SIZE), dtype=np.float32),
            "scalars": spaces.Box(-1.0, 10.0, shape=(8,), dtype=np.float32),
            "asset_table": spaces.Box(-1.0, 10.0, shape=(MAX_ASSETS, ASSET_FEATURES), dtype=np.float32),
            "action_mask": spaces.MultiBinary(self.n_actions),
        })

        # Will be set in reset()
        self.players: List[PlayerState] = []
        self.all_assets: list = []
        self.current_player: int = 0
        self.turn_number: int = 1    # mirrors JS turnNumber (starts at 1)
        self.done: bool = False

    # --------------------------------------------------------
    # Gym API
    # --------------------------------------------------------
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            random.seed(seed)
            np.random.seed(seed)

        self.players = [
            PlayerState(x=0, y=0),
            PlayerState(x=GRID_SIZE - 1, y=GRID_SIZE - 1),
        ]
        self.current_player = 0
        self.turn_number = 1
        self.done = False
        self._generate_scene()
        return self._obs(), self._info()

    def step(self, action: int):
        """
        Execute one player's action, then advance turn.

        Turn progression mirrors JS nextTurn():
          - Player 0 acts -> current_player becomes 1
          - Player 1 acts -> collectIncome() -> check wins -> turnNumber++
                            -> current_player becomes 0
        """
        assert not self.done, "Episode is done -- call reset()."
        assert 0 <= action < self.n_actions, f"Invalid action {action}"

        acting_player_idx = self.current_player
        p = self.players[acting_player_idx]
        info = {"action_type": "skip", "acting_player": acting_player_idx}

        # ---------- Execute action ----------
        if action == 0:
            info["action_type"] = "skip"

        elif 1 <= action <= MAX_ASSETS:
            idx = action - 1
            if idx < len(self.all_assets):
                asset = self.all_assets[idx]
                if asset.owner is None and not (asset.asset_type == "mine" and asset.collapsed):
                    price = self._price_for(p, asset)
                    if p.money >= price:
                        p.money -= price
                        asset.owner = acting_player_idx
                        if asset.asset_type == "mine":
                            p.owned_mine_indices.append(idx)
                        else:
                            p.owned_river_indices.append(idx)
                        info["action_type"] = "buy"
                        info["asset_index"] = idx
                        info["price"] = price
                    else:
                        info["action_type"] = "invalid_cant_afford"
                else:
                    info["action_type"] = "invalid_already_owned"
            else:
                info["action_type"] = "invalid_no_asset"

        elif MAX_ASSETS + 1 <= action <= 2 * MAX_ASSETS:
            idx = action - MAX_ASSETS - 1
            if idx < len(self.all_assets):
                asset = self.all_assets[idx]
                if (asset.owner == acting_player_idx
                        and asset.upgrades < 1
                        and not (asset.asset_type == "mine" and asset.collapsed)):
                    old_reward = asset.reward
                    asset.reward = round(asset.reward * 1.25)
                    asset.upgrades += 1
                    info["action_type"] = "upgrade"
                    info["asset_index"] = idx
                    info["old_reward"] = old_reward
                    info["new_reward"] = asset.reward
                else:
                    info["action_type"] = "invalid_not_upgradable"
            else:
                info["action_type"] = "invalid_no_asset"

        # ---------- Turn progression (mirrors nextTurn) ----------
        income_report = None
        if acting_player_idx == 1:
            # Both players have acted -> collect income
            income_report = self._collect_income()
            info["income"] = income_report

        # ---------- Check win (after income, mirrors JS) ----------
        terminated = False
        truncated = False
        reward = 0.0

        for i in range(2):
            if self.players[i].money >= WIN_GOLD:
                terminated = True
                self.done = True
                info["winner"] = i
                # +1 for the acting player if they won, -1 if opponent won
                reward = 1.0 if i == acting_player_idx else -1.0
                break

        # Advance turn counter (mirrors JS)
        if not terminated:
            self.current_player = 1 - acting_player_idx
            if acting_player_idx == 1:
                self.turn_number += 1

            # Truncation safety
            if self.turn_number > MAX_TURNS:
                truncated = True
                self.done = True
                m0, m1 = self.players[0].money, self.players[1].money
                if m0 > m1:
                    info["winner"] = 0
                elif m1 > m0:
                    info["winner"] = 1
                else:
                    info["winner"] = -1  # tie
                reward = 1.0 if info.get("winner") == acting_player_idx else (
                    -1.0 if info.get("winner") == 1 - acting_player_idx else 0.0)

        return self._obs(), reward, terminated, truncated, info

    # --------------------------------------------------------
    # Scene generation — mirrors generateScene / generateCandidateAssets
    # --------------------------------------------------------
    def _generate_scene(self):
        num_mines = self._fixed_num_mines or random.randint(5, 12)
        num_rivers = self._fixed_num_rivers or random.randint(7, 17)

        best_assets = None
        best_ratio = float("inf")

        for _ in range(MAX_GENERATION_ATTEMPTS):
            occupied = {(p.x, p.y) for p in self.players}
            candidates = []

            for _ in range(num_mines):
                x, y = self._random_free(occupied)
                level = random.randint(1, 3)
                # Mirrors JS: Math.round((level * 0.2 + 0.1) * 100) / 100
                risk = round((level * 0.2 + 0.1) * 100) / 100
                candidates.append({
                    "type": "mine", "x": x, "y": y,
                    "level": level, "reward": level * 10, "risk": risk,
                })

            for _ in range(num_rivers):
                x, y = self._random_free(occupied)
                level = random.randint(1, 3)
                candidates.append({
                    "type": "river", "x": x, "y": y,
                    "level": level, "reward": level * 8,
                })

            v1 = self._compute_value(self.players[0], candidates)
            v2 = self._compute_value(self.players[1], candidates)
            ratio = max(v1, v2) / max(min(v1, v2), 1e-12) if (v1 > 0 and v2 > 0) else float("inf")

            if ratio < best_ratio:
                best_ratio = ratio
                best_assets = [dict(a) for a in candidates]

            if ratio <= FAIRNESS_RATIO:
                break

        # Commit — build asset objects in the same order they were generated
        # (mines first within candidates, then rivers, matching JS push order)
        self.all_assets = []
        for a in best_assets:
            if a["type"] == "mine":
                self.all_assets.append(MineAsset(
                    x=a["x"], y=a["y"],
                    reward=a["reward"], level=a["level"], risk=a["risk"],
                ))
            else:
                self.all_assets.append(RiverAsset(
                    x=a["x"], y=a["y"],
                    reward=a["reward"], level=a["level"],
                ))

    def _random_free(self, occupied: set) -> Tuple[int, int]:
        """Mirrors randomFreeCell — avoids occupied cells and player zones."""
        while True:
            x = random.randint(0, GRID_SIZE - 1)
            y = random.randint(0, GRID_SIZE - 1)
            if (x, y) in occupied:
                continue
            if self._in_player_zone(x, y):
                continue
            occupied.add((x, y))
            return x, y

    def _in_player_zone(self, x: int, y: int) -> bool:
        """Mirrors isInPlayerZone — strict < (not <=)"""
        for p in self.players:
            if abs(x - p.x) < PLAYER_ZONE_RADIUS and abs(y - p.y) < PLAYER_ZONE_RADIUS:
                return True
        return False

    @staticmethod
    def _compute_value(player: PlayerState, assets: list) -> float:
        """Mirrors computePlayerValue"""
        total = 0.0
        for a in assets:
            d = manhattan(player.x, player.y, a["x"], a["y"])
            if a["type"] == "mine":
                price = mine_price_fn(d, a["level"])
            else:
                price = river_price_fn(d, a["level"])
            total += a["reward"] / price
        return total

    # --------------------------------------------------------
    # Income — mirrors collectIncome exactly
    # --------------------------------------------------------
    def _collect_income(self) -> list:
        """
        Process income for BOTH players. Mirrors JS collectIncome().

        Cave-in: if Math.random() < mine.risk * 0.3:
            mine.collapsed = true
            money = Math.round(money * (1 - mine.risk))

        Normal mine income: Math.round(mine.reward * (1 + mine.risk))
        River income: river.reward (no risk)

        Returns per-player income details for info dict.
        """
        reports = []
        for i, p in enumerate(self.players):
            balance_before = p.money
            details = []

            for mine_idx in p.owned_mine_indices:
                mine = self.all_assets[mine_idx]
                if mine.collapsed:
                    continue

                # Cave-in check
                if random.random() < mine.risk * 0.3:
                    mine.collapsed = True
                    p.money = round(p.money * (1 - mine.risk))
                    loss = balance_before - p.money  # not used in logic, just for report
                    details.append({"source_idx": mine_idx, "amount": -(balance_before - p.money), "cave_in": True})
                    balance_before = p.money  # update for next cave-in calc
                    continue

                # Normal income
                income = round(mine.reward * (1 + mine.risk))
                p.money += income
                details.append({"source_idx": mine_idx, "amount": income, "cave_in": False})

            for river_idx in p.owned_river_indices:
                river = self.all_assets[river_idx]
                p.money += river.reward
                details.append({"source_idx": river_idx, "amount": river.reward, "cave_in": False})

            net = p.money - balance_before
            reports.append({"player": i, "net_income": net, "details": details})

        return reports

    # --------------------------------------------------------
    # Observation
    # --------------------------------------------------------
    def _obs(self) -> dict:
        """
        Grid channels (6 x 20 x 20) — spatial layout:
            ch0: unclaimed mines      (value = level / 3.0)
            ch1: unclaimed rivers     (value = level / 3.0)
            ch2: current player's owned assets (level / 3.0)
            ch3: opponent's owned assets       (level / 3.0)
            ch4: current player position       (one-hot)
            ch5: opponent position             (one-hot)

        Scalars (8) — global game state:
            [my_money/WIN_GOLD, opp_money/WIN_GOLD, turn/MAX_TURNS,
             n_my_mines/MAX_ASSETS, n_my_rivers/MAX_ASSETS,
             n_opp_mines/MAX_ASSETS, n_opp_rivers/MAX_ASSETS,
             current_player_id]

        Asset table (MAX_ASSETS x 14) — per-asset properties:
            For each asset slot i (padded with zeros if < MAX_ASSETS):
            [0]  is_mine          (1.0 or 0.0)
            [1]  is_river         (1.0 or 0.0)
            [2]  level / 3.0
            [3]  reward / 30.0
            [4]  risk             (0.0 for rivers)
            [5]  collapsed        (1.0 or 0.0)
            [6]  owner_is_me      (1.0 or 0.0)
            [7]  owner_is_opp     (1.0 or 0.0)
            [8]  owner_is_none    (1.0 or 0.0)
            [9]  upgrades         (0.0 or 1.0)
            [10] dist_to_me / 38  (max manhattan on 20x20 = 38)
            [11] dist_to_opp / 38
            [12] price_for_me / 200  (capped normalization)
            [13] affordable       (1.0 if I can buy it and it's unclaimed)
        """
        me = self.current_player
        opp = 1 - me
        p_me = self.players[me]
        p_opp = self.players[opp]

        # --- Grid ---
        grid = np.zeros((6, GRID_SIZE, GRID_SIZE), dtype=np.float32)
        for asset in self.all_assets:
            x, y = asset.x, asset.y
            if asset.owner is None:
                if asset.asset_type == "mine" and not asset.collapsed:
                    grid[0, y, x] = asset.level / 3.0
                elif asset.asset_type == "river":
                    grid[1, y, x] = asset.level / 3.0
            elif asset.owner == me:
                grid[2, y, x] = asset.level / 3.0
            else:
                grid[3, y, x] = asset.level / 3.0
        grid[4, p_me.y, p_me.x] = 1.0
        grid[5, p_opp.y, p_opp.x] = 1.0

        # --- Scalars ---
        scalars = np.array([
            p_me.money / WIN_GOLD,
            p_opp.money / WIN_GOLD,
            self.turn_number / MAX_TURNS,
            len(p_me.owned_mine_indices) / MAX_ASSETS,
            len(p_me.owned_river_indices) / MAX_ASSETS,
            len(p_opp.owned_mine_indices) / MAX_ASSETS,
            len(p_opp.owned_river_indices) / MAX_ASSETS,
            float(me),
        ], dtype=np.float32)

        # --- Asset table ---
        asset_table = np.zeros((MAX_ASSETS, self.asset_features), dtype=np.float32)
        for i, asset in enumerate(self.all_assets):
            if i >= MAX_ASSETS:
                break

            is_mine = 1.0 if asset.asset_type == "mine" else 0.0
            is_river = 1.0 - is_mine
            risk = getattr(asset, "risk", 0.0)
            collapsed = 1.0 if getattr(asset, "collapsed", False) else 0.0

            owner_me = 1.0 if asset.owner == me else 0.0
            owner_opp = 1.0 if asset.owner == opp else 0.0
            owner_none = 1.0 if asset.owner is None else 0.0

            d_me = manhattan(p_me.x, p_me.y, asset.x, asset.y)
            d_opp = manhattan(p_opp.x, p_opp.y, asset.x, asset.y)
            price = self._price_for(p_me, asset)

            affordable = 1.0 if (owner_none > 0.5 and collapsed < 0.5
                                 and p_me.money >= price) else 0.0

            asset_table[i] = [
                is_mine,
                is_river,
                asset.level / 3.0,
                asset.reward / 30.0,
                risk,
                collapsed,
                owner_me,
                owner_opp,
                owner_none,
                float(asset.upgrades),
                d_me / 38.0,
                d_opp / 38.0,
                min(price / 200.0, 1.0),
                affordable,
            ]

        mask = self._action_mask()
        return {
            "grid": grid,
            "scalars": scalars,
            "asset_table": asset_table,
            "action_mask": mask,
        }

    def _action_mask(self) -> np.ndarray:
        mask = np.zeros(self.n_actions, dtype=np.int8)
        mask[0] = 1  # skip always valid

        p = self.players[self.current_player]

        for i, asset in enumerate(self.all_assets):
            if i >= MAX_ASSETS:
                break

            # Buy slot
            if asset.owner is None:
                if asset.asset_type == "mine" and asset.collapsed:
                    continue
                price = self._price_for(p, asset)
                if p.money >= price:
                    mask[1 + i] = 1

            # Upgrade slot
            if (asset.owner == self.current_player
                    and asset.upgrades < 1
                    and not (asset.asset_type == "mine" and asset.collapsed)):
                mask[MAX_ASSETS + 1 + i] = 1

        return mask

    def _price_for(self, player: PlayerState, asset) -> int:
        d = manhattan(player.x, player.y, asset.x, asset.y)
        if asset.asset_type == "mine":
            return mine_price_fn(d, asset.level)
        return river_price_fn(d, asset.level)

    def _info(self) -> dict:
        return {
            "current_player": self.current_player,
            "turn_number": self.turn_number,
            "money": [p.money for p in self.players],
            "n_assets": len(self.all_assets),
        }

    # --------------------------------------------------------
    # Rendering
    # --------------------------------------------------------
    def render(self):
        if self.render_mode == "ansi":
            return self._render_ansi()

    def _render_ansi(self) -> str:
        grid_chars = [["." for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)]
        for i, a in enumerate(self.all_assets):
            if a.asset_type == "mine":
                if a.collapsed:
                    grid_chars[a.y][a.x] = "X"
                elif a.owner is not None:
                    grid_chars[a.y][a.x] = f"{a.owner + 1}"
                else:
                    grid_chars[a.y][a.x] = "M"
            else:
                if a.owner is not None:
                    grid_chars[a.y][a.x] = f"{a.owner + 1}"
                else:
                    grid_chars[a.y][a.x] = "R"

        for i, p in enumerate(self.players):
            grid_chars[p.y][p.x] = f"P{i+1}"

        lines = [" ".join(f"{c:>2}" for c in row) for row in grid_chars]
        header = (f"Turn {self.turn_number} | P{self.current_player + 1}'s move | "
                  f"P1=${self.players[0].money}  P2=${self.players[1].money}")
        return header + "\n" + "\n".join(lines)