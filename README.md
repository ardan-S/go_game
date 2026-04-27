# Go (the board game)

A browser-based Go game with multiple play modes - Repo still in development.

Code written with use of Claude Code and ChatGPT Codex.

All contributions welcome!

## Play now

**[www.imperial-go.org](https://www.imperial-go.org)**

## How to play

1. Choose a board size: **9×9** (quick), **13×13** (medium), or **19×19** (full game)
2. Optionally set **komi** — 6.5 bonus points for White to offset Black's first-move advantage (standard rules)
3. Players alternate placing stones, Black goes first
4. Click any empty intersection to place a stone
5. To end your turn without placing, click **Pass** — two consecutive passes end the game
6. Click **End Game** to go straight to scoring at any time

### Scoring

When the game ends, you enter scoring mode:

- Click any stone group to mark it as **dead** (stones your opponent would capture if play continued) — they dim on the board and are counted as prisoners
- The score updates live as you mark groups
- Click **Confirm Score** when both players agree — the winner is announced

Score = territory + captures + dead opponent stones + komi (White only)

## Running locally

```bash
./start.sh
```
Then open the URL printed in the terminal. The script will use Go if installed, or fall back to Python 3.
