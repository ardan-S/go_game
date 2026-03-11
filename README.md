# Go (the board game)

A 2-player Go game that runs in your browser — pass and play, no account needed.

## Play now

**[ardan-S.github.io/go_game](https://ardan-S.github.io/go_game)**

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

## Development

All game logic lives in the browser — the Go server is a thin static file server with no game-specific routes.

| File | Responsibility |
|---|---|
| `static/js/board.js` | All game state and rules |
| `static/js/render.js` | Canvas rendering |
| `static/js/ui.js` | DOM events and UI wiring |

The site is deployed automatically to GitHub Pages on every push to `main`.
