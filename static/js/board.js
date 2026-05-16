'use strict';

class Board {
  /**
   * @param {number} size     Board size (9, 13, or 19).
   * @param {object} options
   * @param {boolean} options.superko   AGA/BGA-style situational superko.
   * @param {number}  options.handicap  Number of pre-placed Black stones (0 = none).
   */
  constructor(size, options = {}) {
    this.size    = size;
    this.superko = !!options.superko;

    this.grid             = Array.from({ length: size }, () => Array(size).fill(null));
    this.currentPlayer    = 'black';
    this.captures         = { black: 0, white: 0 };
    this.koPoint          = null;
    this.consecutivePasses = 0;
    this.phase            = 'playing'; // 'playing' | 'scoring' | 'finished'
    this.deadStones       = new Set();
    this.lastMove         = null;
    this.moveNumber       = 0;
    this.resignedBy       = null;

    // Undo stack — each entry is a full snapshot of mutable state.
    this.history = [];
    // Superko — serialized situations seen so far (full board + player to move).
    this.boardStateHistory = [];

    // Move log for server-side engine replay. Each entry is either
    // { color, x, y, pass: false } or { color, pass: true }.
    this.moves = [];
    // Pre-placed stones for handicap games, sent to the engine separately.
    this.handicapStones = [];

    const handicap = Math.max(0, parseInt(options.handicap) || 0);
    if (handicap >= 2) {
      this._placeHandicapStones(handicap);
      this.currentPlayer = 'white'; // White moves first in handicap games.
    }

    this.boardStateHistory.push(this._serializeSituation(this.grid, this.currentPlayer));
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  opponent(color) {
    return color === 'black' ? 'white' : 'black';
  }

  key(x, y) {
    return `${x},${y}`;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  neighbors(x, y) {
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .filter(([nx, ny]) => this.inBounds(nx, ny));
  }

  _serializeGrid(grid) {
    return (grid || this.grid).map(row => row.map(c => c ? c[0] : '.').join('')).join('|');
  }

  _serializeSituation(grid, nextPlayer) {
    return `${nextPlayer}:${this._serializeGrid(grid)}`;
  }

  // ─── Group / Liberty Logic ───────────────────────────────────────────────────

  getGroup(x, y, grid) {
    grid = grid || this.grid;
    const color = grid[y][x];
    if (!color) return new Set();

    const group = new Set();
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const k = this.key(cx, cy);
      if (group.has(k)) continue;
      if (grid[cy][cx] !== color) continue;
      group.add(k);
      for (const [nx, ny] of this.neighbors(cx, cy)) {
        if (!group.has(this.key(nx, ny))) stack.push([nx, ny]);
      }
    }
    return group;
  }

  getLiberties(group, grid) {
    grid = grid || this.grid;
    const liberties = new Set();
    for (const k of group) {
      const [x, y] = k.split(',').map(Number);
      for (const [nx, ny] of this.neighbors(x, y)) {
        if (grid[ny][nx] === null) liberties.add(this.key(nx, ny));
      }
    }
    return liberties;
  }

  _detectKoPoint(previousGrid, newGrid, nextPlayer, capturedStones) {
    if (capturedStones.length !== 1) return null;

    const [{ x, y, color }] = capturedStones;
    const recaptureGrid = newGrid.map(row => [...row]);
    recaptureGrid[y][x] = nextPlayer;

    const opp = this.opponent(nextPlayer);
    let recaptured = 0;
    for (const [nx, ny] of this.neighbors(x, y)) {
      if (recaptureGrid[ny][nx] !== opp) continue;
      const group = this.getGroup(nx, ny, recaptureGrid);
      if (this.getLiberties(group, recaptureGrid).size === 0) {
        for (const k of group) {
          const [gx, gy] = k.split(',').map(Number);
          recaptureGrid[gy][gx] = null;
          recaptured++;
        }
      }
    }

    const ownGroup = this.getGroup(x, y, recaptureGrid);
    if (this.getLiberties(ownGroup, recaptureGrid).size === 0) return null;
    if (recaptured !== 1) return null;

    const previousState = this._serializeGrid(previousGrid);
    const recaptureState = this._serializeGrid(recaptureGrid);
    if (recaptureState !== previousState) return null;

    return { x, y, color };
  }

  // ─── History / Undo ─────────────────────────────────────────────────────────

  _saveHistory() {
    this.history.push({
      grid:                  this.grid.map(row => [...row]),
      currentPlayer:         this.currentPlayer,
      captures:              { ...this.captures },
      koPoint:               this.koPoint ? { ...this.koPoint } : null,
      consecutivePasses:     this.consecutivePasses,
      lastMove:              this.lastMove ? { ...this.lastMove } : null,
      moveNumber:            this.moveNumber,
      boardStateHistoryLen:  this.boardStateHistory.length,
    });
  }

  undo() {
    if (this.phase !== 'playing') return { ok: false, reason: 'Cannot undo after the game ends' };
    if (this.history.length === 0) return { ok: false, reason: 'Nothing to undo' };

    if (this.moves.length > 0) this.moves.pop();

    const prev = this.history.pop();
    this.grid                 = prev.grid;
    this.currentPlayer        = prev.currentPlayer;
    this.captures             = prev.captures;
    this.koPoint              = prev.koPoint;
    this.consecutivePasses    = prev.consecutivePasses;
    this.lastMove             = prev.lastMove;
    this.moveNumber           = prev.moveNumber;
    this.boardStateHistory.length = prev.boardStateHistoryLen;

    return { ok: true };
  }

  // ─── Move Actions ────────────────────────────────────────────────────────────

  placeStone(x, y) {
    if (this.phase !== 'playing') return { ok: false, reason: 'Game is not in playing phase' };
    if (!this.inBounds(x, y))    return { ok: false, reason: 'Out of bounds' };
    if (this.grid[y][x] !== null) return { ok: false, reason: 'Intersection is occupied' };
    if (this.koPoint && this.koPoint.x === x && this.koPoint.y === y) {
      return { ok: false, reason: 'Ko: cannot play here right now' };
    }

    const color = this.currentPlayer;
    const opp   = this.opponent(color);
    const newGrid = this.grid.map(row => [...row]);
    newGrid[y][x] = color;

    // Capture opponent groups with zero liberties.
    let captured = 0;
    const capturedStones = [];
    for (const [nx, ny] of this.neighbors(x, y)) {
      if (newGrid[ny][nx] === opp) {
        const group = this.getGroup(nx, ny, newGrid);
        if (this.getLiberties(group, newGrid).size === 0) {
          for (const k of group) {
            const [gx, gy] = k.split(',').map(Number);
            capturedStones.push({ x: gx, y: gy, color: opp });
            newGrid[gy][gx] = null;
            captured++;
          }
        }
      }
    }

    // Reject suicide.
    const ownGroup = this.getGroup(x, y, newGrid);
    if (this.getLiberties(ownGroup, newGrid).size === 0) {
      return { ok: false, reason: 'Suicide move is not allowed' };
    }

    // Superko check.
    if (this.superko) {
      const newSituation = this._serializeSituation(newGrid, opp);
      if (this.boardStateHistory.includes(newSituation)) {
        return { ok: false, reason: 'Superko: cannot recreate a previous full-board position with the same player to move' };
      }
    }

    // Ko point for next turn.
    const newKoPoint = this._detectKoPoint(this.grid, newGrid, opp, capturedStones);

    // Commit.
    this._saveHistory();
    this.grid             = newGrid;
    this.captures[color] += captured;
    this.koPoint          = newKoPoint;
    this.consecutivePasses = 0;
    this.lastMove         = { x, y };
    this.moveNumber++;
    this.currentPlayer    = opp;
    this.boardStateHistory.push(this._serializeSituation(this.grid, this.currentPlayer));
    this.moves.push({ color, x, y, pass: false });

    return { ok: true, captured: capturedStones };
  }

  pass() {
    if (this.phase !== 'playing') return { ok: false, reason: 'Not in playing phase' };

    const passingColor = this.currentPlayer;
    this._saveHistory();
    this.consecutivePasses++;
    this.koPoint  = null;
    this.lastMove = null;
    this.moveNumber++;

    this.moves.push({ color: passingColor, pass: true });

    if (this.consecutivePasses >= 2) {
      this.phase = 'scoring';
      return { ok: true, gameOver: true };
    }

    this.currentPlayer = this.opponent(this.currentPlayer);
    this.boardStateHistory.push(this._serializeSituation(this.grid, this.currentPlayer));
    return { ok: true, gameOver: false };
  }

  endGame() {
    if (this.phase !== 'playing') return;
    this.phase = 'scoring';
  }

  resign(player) {
    if (this.phase !== 'playing') return false;
    this.phase      = 'finished';
    this.resignedBy = player;
    return true;
  }

  // ─── Handicap ────────────────────────────────────────────────────────────────

  _placeHandicapStones(count) {
    const positions = this._handicapPositions();
    const n = Math.min(count, positions.length);
    for (let i = 0; i < n; i++) {
      const [x, y] = positions[i];
      this.grid[y][x] = 'black';
      this.handicapStones.push({ x, y });
    }
  }

  _handicapPositions() {
    // Ordered by standard convention: opposite corners first, then remaining corners,
    // then centre, then side hoshi.
    if (this.size === 19) {
      return [
        [15, 3], [3, 15], [15, 15], [3, 3], [9, 9],
        [9, 3],  [9, 15], [3, 9],   [15, 9],
      ];
    }
    if (this.size === 13) {
      return [[9, 3], [3, 9], [9, 9], [3, 3], [6, 6]];
    }
    // 9×9
    return [[6, 2], [2, 6], [6, 6], [2, 2], [4, 4]];
  }

  // ─── Scoring ─────────────────────────────────────────────────────────────────

  toggleDeadGroup(x, y) {
    if (!this.grid[y][x]) return;
    const group   = this.getGroup(x, y);
    const allDead = [...group].every(k => this.deadStones.has(k));
    for (const k of group) {
      if (allDead) this.deadStones.delete(k);
      else         this.deadStones.add(k);
    }
  }

  getEffectiveGrid() {
    return this.grid.map((row, y) =>
      row.map((cell, x) => (this.deadStones.has(this.key(x, y)) ? null : cell))
    );
  }

  /**
   * Returns { black: Set<"x,y">, white: Set<"x,y"> } of territory intersections.
   * Used by the renderer for shading.
   */
  getTerritoryPositions() {
    const effectiveGrid = this.getEffectiveGrid();
    const visited = new Set();
    const black   = new Set();
    const white   = new Set();

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const k = this.key(x, y);
        if (effectiveGrid[y][x] !== null || visited.has(k)) continue;

        const region = [];
        const stack  = [[x, y]];
        let touchesBlack = false;
        let touchesWhite = false;

        while (stack.length) {
          const [cx, cy] = stack.pop();
          const ck = this.key(cx, cy);
          if (visited.has(ck)) continue;
          visited.add(ck);
          region.push(ck);
          for (const [nx, ny] of this.neighbors(cx, cy)) {
            if      (effectiveGrid[ny][nx] === null)    stack.push([nx, ny]);
            else if (effectiveGrid[ny][nx] === 'black') touchesBlack = true;
            else if (effectiveGrid[ny][nx] === 'white') touchesWhite = true;
          }
        }

        if      (touchesBlack && !touchesWhite) region.forEach(k => black.add(k));
        else if (touchesWhite && !touchesBlack) region.forEach(k => white.add(k));
      }
    }

    return { black, white };
  }

  calculateTerritory() {
    const pos = this.getTerritoryPositions();
    return {
      black:   pos.black.size,
      white:   pos.white.size,
      neutral: this.size * this.size
        - [...pos.black].length
        - [...pos.white].length
        - this._countLiveStones(),
    };
  }

  _countLiveStones() {
    const effectiveGrid = this.getEffectiveGrid();
    let n = 0;
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++)
        if (effectiveGrid[y][x]) n++;
    return n;
  }

  calculateScore(komi = 0) {
    const territory = this.calculateTerritory();

    let deadBlack = 0, deadWhite = 0;
    for (const k of this.deadStones) {
      const [x, y] = k.split(',').map(Number);
      if      (this.grid[y][x] === 'black') deadBlack++;
      else if (this.grid[y][x] === 'white') deadWhite++;
    }

    const blackTotal = territory.black + this.captures.black + deadWhite;
    const whiteTotal = territory.white + this.captures.white + deadBlack + komi;
    const winner     =
      blackTotal > whiteTotal ? 'black' :
      whiteTotal > blackTotal ? 'white' : 'draw';

    return {
      black:   { territory: territory.black, captures: this.captures.black, deadOpponent: deadWhite, total: blackTotal },
      white:   { territory: territory.white, captures: this.captures.white, deadOpponent: deadBlack, komi, total: whiteTotal },
      neutral: territory.neutral,
      winner,
      margin:  Math.abs(blackTotal - whiteTotal),
    };
  }

  finalizeScoring() {
    this.phase = 'finished';
  }
}
