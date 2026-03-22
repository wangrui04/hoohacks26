# HOOHACKS 2026 - Gold Rush

## Overview
* This game was inspired by the theme, Wild West, and the game Catan.
* AI was used in the game to predict the next move of the player and act accordingly. 

## Actions in the Game:
1. Select Mine - Purchase the mine
2. Select River - Purchase the river mine
3. Upgrade an asset - Upgrade assets bought
4. Skip Turn - Skip your turn if you don't have money 

## Rules of the Game:
* Each player has to take turns making a move
* Each player can only make one move during each turn
* Each mine has a risk of collapsing representaged as a percentage, but with higher risk, you get a higher reward
* Each mine could collapse anytime in the game, resulting in a percentage loss of money
* Rivers yield lower rewards than mines but they do not collapse
* Players are not allowed to buy rivers consecutively and they must buy a mine before they buy the next river
* A match ends when a player earns at least $500
* There are no limits to the number of turns per match
* A game consists of 5 matches
* A player needs to win 3/5 matches to win the game

## Run Game
```txt
python3 -m http.server 8000
```
[Play the game](http://localhost:8000/index.html) after running the command in terminal.

## NPC Model

We chose a DQN since it is both (1) a discrete action/observation space and (2) the easiest deep learning model for Reinforcement Learning.

### Network Architecture

The DQN has three *parallel* input branches that are concatenated and fed into a shared decision head:

We figured to spatiality the model needs to observe these features:

### Observation Space

**Grid — `(1, 6, 20, 20)` float32** --> 1 is the batch size, 6 is the number of channels (features that the relation depends on), 20 number of squares in the x direction, 20 is the number of squres in the y direction.

| Channel | Description |
|---------|-------------|
| 0 | Unclaimed mines (value = level/3) |
| 1 | Unclaimed rivers (value = level/3) |
| 2 | My owned assets (level/3) |
| 3 | Opponent's owned assets (level/3) |
| 4 | My position (one-hot) |
| 5 | Opponent position (one-hot) |

#### Architecture of the spatiality branch

This CNN should understand where things are in the grid --> think of it like an encoder for information per cell. CNNs have been proven to be very good for complex relationships!

**Branch 1 - Spatial CNN** (grid input `6×20×20`):
Two `3×3` conv layers (6→32→64 channels, ReLU) followed by adaptive average pooling down to `4×4`, producing a 1024-dim vector. This should capture more complex relationships (i.e the spatiality of the game). Since the price depends on the distance from the player it is important to have some sort of a non-linear function. 

#### Architecture of the ASSET MLP

This NN should theoretically handle the asset decision-making. I.e whether they should or should not buy river or a mine.



**Asset Table — `(1, 30, 14)` float32** (zero-padded if fewer than 30 assets)

| Index | Feature | Notes |
|-------|---------|-------|
| 0 | is_mine | 1/0 |
| 1 | is_river | 1/0 |
| 2 | level | / 3.0 |
| 3 | reward | / 30.0 |
| 4 | risk | raw (0 for rivers) |
| 5 | collapsed | 1/0 |
| 6 | owner_is_me | 1/0 |
| 7 | owner_is_opp | 1/0 |
| 8 | owner_is_none | 1/0 |
| 9 | upgrades | 0 or 1 |
| 10 | dist_to_me | / 38 |
| 11 | dist_to_opp | / 38 |
| 12 | price_for_me | / 200 (clamped) |
| 13 | affordable | 1 if buyable |

**Branch 2 - Asset MLP** (asset table input `30×14`):
A shared two-layer MLP (14→32→32, ReLU) processes each asset's 14 features independently. 
The 30 resulting 32-dim vectors are then aggregated two ways: **max-pool** and **mean-pool**. 
These are concatenated into a 64-dim vector. This lets the network reason about individual asset properties.


#### Architecture of Scalars

This should give more context to the model. Think of it like ChatGPT. In ChatGPT you need to give it some context in your prompt to do your task usually youre prompt looks like: [context, task]. The context might be somehting like " I am trying lose 20 LBs, but I eat McDonalds everyday" and the task would be "How should I change my diet"


**Scalars — `(1, 8)` float32**

| Index | Feature | Normalization |
|-------|---------|---------------|
| 0 | My money | / 500 |
| 1 | Opponent money | / 500 |
| 2 | Turn number | / 200 |
| 3 | My mine count | / 30 |
| 4 | My river count | / 30 |
| 5 | Opp mine count | / 30 |
| 6 | Opp river count | / 30 |
| 7 | Current player ID | 0.0 or 1.0 |

**Branch 3 - Scalars** (8-dim): passed through directly.

#### Arch of Decision making

This takes the output of the other two NN and the scalars to make an informed decision. 

### Action Space

**Discrete(61)** = `1 + 2 × 30`

| Range | Action |
|-------|--------|
| 0 | Skip turn |
| 1–30 | Buy asset `[i-1]` |
| 31–60 | Upgrade asset `[i-31]` |

An action mask (`int8[61]`) gates legal moves; during inference, masked Q-values are set to `−∞` before argmax.

**Decision Head**: All three branches are concatenated (1024 + 64 + 8 = 1096) and fed through a two-layer MLP (1096→256→61) that outputs one Q-value per action.


### Output

`q_values` — `(1, 61)` float32, one Q-value per action.

### Training

For training we initialized the rewards as follows:

Base reward is ±1 on win/loss. Shaped bonuses: `+0.1 × Δmoney/500`, `+0.05 × money_lead/500`, `+0.02` buy, `+0.01` upgrade, `−0.01` skip.

To actually train the model, we ported the JS game to Python and utilized OpenAI's Gym to train the model. The training was just two RL agents playing against eachother.  

### Inference

We made a small eval script to validate the model -- i.e to ensure it is actually playing the game and not just skipping -- then we utilized ONNX to transfer the model from being only runable on Python to being runable on Javascript. 



## Authors:
* Zach Risheq
* Rui Wang
* Darius Khani
