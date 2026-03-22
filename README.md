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

## Run Command
```txt
python3 -m http.server 8000
```
[Play the game](http://localhost:8000/index.html) after running the command in terminal.

## Authors:
* Zach Risheq
* Rui Wang
* Darius Khani
