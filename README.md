# Go (the board game)

A local 2-player Go game that runs in your browser.

## Running the game

```bash
./start.sh
```

Then open the URL printed in the terminal. That's it.

The script will use Go if it's installed, or fall back to Python 3 (which ships with most systems).

## Installing Go (optional)

If you'd like to run via Go:

| System | Command |
|---|---|
| WSL / Ubuntu / Debian | `sudo apt install golang-go` |
| macOS | `brew install go` |
| Windows | Download installer from [golang.org](https://golang.org/dl/) |

## Changing the port

```bash
PORT=9000 ./start.sh
```

## How to play

1. Choose a board size: **9×9** (quick), **13×13** (medium), or **19×19** (full game)
2. Optionally enable **komi** — 6.5 bonus points for White to offset Black's first-move advantage
3. Players alternate placing stones, Black goes first
4. Click any empty intersection to place a stone
5. To end your turn without placing, click **Pass** — two consecutive passes end the game
6. Click **End Game** to go straight to scoring at any time

### Scoring

When the game ends, you enter scoring mode:

- Click any stone group to mark it as **dead** (stones your opponent would capture if play continued) — they dim on the board and are counted as prisoners
- The score updates live as you mark groups
- Click **Confirm Score** when both players agree — the winner is announced

Score = territory (empty intersections you surround) + captured stones + dead opponent stones + komi (White only)
