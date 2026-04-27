'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const EMPTY = 0, BLACK = 1, WHITE = 2;

// ── Board helpers ────────────────────────────────────────────────────────────

function opponent(c) { return c === BLACK ? WHITE : BLACK; }

function neighbors(idx, size) {
  const x = idx % size, y = (idx / size) | 0;
  const r = [];
  if (y > 0)        r.push(idx - size);
  if (y < size - 1) r.push(idx + size);
  if (x > 0)        r.push(idx - 1);
  if (x < size - 1) r.push(idx + 1);
  return r;
}

function getGroup(idx, grid, size) {
  const color = grid[idx];
  const group = new Set();
  if (color === EMPTY) return group;
  const stack = [idx];
  group.add(idx);
  while (stack.length) {
    const cur = stack.pop();
    for (const n of neighbors(cur, size)) {
      if (!group.has(n) && grid[n] === color) {
        group.add(n);
        stack.push(n);
      }
    }
  }
  return group;
}

function liberties(group, grid, size) {
  const libs = new Set();
  for (const idx of group) {
    for (const n of neighbors(idx, size)) {
      if (grid[n] === EMPTY) libs.add(n);
    }
  }
  return libs;
}

// ── Immutable place (used in tree search and legal-move enumeration) ─────────

function placeOnGrid(grid, idx, color, koIdx, size) {
  if (grid[idx] !== EMPTY || idx === koIdx) return { ok: false };

  const newGrid = grid.slice();
  newGrid[idx] = color;

  const opp = opponent(color);
  const captured = [];
  const processed = new Set();

  for (const n of neighbors(idx, size)) {
    if (newGrid[n] === opp && !processed.has(n)) {
      const grp = getGroup(n, newGrid, size);
      grp.forEach(gi => processed.add(gi));
      if (liberties(grp, newGrid, size).size === 0) {
        for (const gi of grp) { newGrid[gi] = EMPTY; captured.push(gi); }
      }
    }
  }

  const ownGrp  = getGroup(idx, newGrid, size);
  const ownLibs = liberties(ownGrp, newGrid, size);
  if (ownLibs.size === 0) return { ok: false };

  let newKoIdx = -1;
  if (captured.length === 1 && ownGrp.size === 1 && ownLibs.size === 1) {
    if ([...ownLibs][0] === captured[0]) newKoIdx = captured[0];
  }

  return { ok: true, newGrid, captured, newKoIdx };
}

// ── Mutable place (used in rollouts — one copy per rollout, then in-place) ───

function applyMutable(grid, idx, color, koIdx, size) {
  if (grid[idx] !== EMPTY || idx === koIdx) return { ok: false };

  grid[idx] = color;
  const opp = opponent(color);
  const capturedGroups = [];
  let capturedCount = 0;
  const processed = new Set();

  for (const n of neighbors(idx, size)) {
    if (grid[n] === opp && !processed.has(n)) {
      const grp = getGroup(n, grid, size);
      grp.forEach(gi => processed.add(gi));
      if (liberties(grp, grid, size).size === 0) {
        capturedGroups.push(grp);
        capturedCount += grp.size;
      }
    }
  }

  for (const grp of capturedGroups) {
    for (const gi of grp) grid[gi] = EMPTY;
  }

  const ownGrp  = getGroup(idx, grid, size);
  const ownLibs = liberties(ownGrp, grid, size);

  if (ownLibs.size === 0) {
    // Undo — suicide
    grid[idx] = EMPTY;
    for (const grp of capturedGroups) for (const gi of grp) grid[gi] = opp;
    return { ok: false };
  }

  let newKoIdx = -1;
  if (capturedCount === 1 && ownGrp.size === 1 && ownLibs.size === 1) {
    let capIdx = -1;
    for (const grp of capturedGroups) for (const gi of grp) capIdx = gi;
    if ([...ownLibs][0] === capIdx) newKoIdx = capIdx;
  }

  return { ok: true, newKoIdx };
}

// ── Legal move enumeration ────────────────────────────────────────────────────

function getLegalMoves(grid, color, koIdx, size) {
  const moves = [];
  const total = size * size;
  for (let i = 0; i < total; i++) {
    if (grid[i] === EMPTY && placeOnGrid(grid, i, color, koIdx, size).ok) {
      moves.push(i);
    }
  }
  moves.push(-1); // pass is always legal
  return moves;
}

// ── Eye detection (fast heuristic — good enough for rollout pruning) ──────────

function isLikelyEye(grid, idx, color, size) {
  // All orthogonal neighbours must be own color (or board edge counts as safe)
  for (const n of neighbors(idx, size)) {
    if (grid[n] !== color) return false;
  }
  // At least 3 of up to 4 diagonal neighbours must be own color
  const x = idx % size, y = (idx / size) | 0;
  const diags = [];
  if (x > 0      && y > 0)      diags.push(grid[(y - 1) * size + (x - 1)]);
  if (x < size-1 && y > 0)      diags.push(grid[(y - 1) * size + (x + 1)]);
  if (x > 0      && y < size-1) diags.push(grid[(y + 1) * size + (x - 1)]);
  if (x < size-1 && y < size-1) diags.push(grid[(y + 1) * size + (x + 1)]);
  const own = diags.filter(v => v === color).length;
  return own >= Math.min(3, diags.length);
}

// ── Winner estimation (area scoring — correct for MCTS evaluation) ────────────

function estimateWinner(grid, size) {
  const total = size * size;
  let black = 0, white = 0;
  const visited = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    if (grid[i] === BLACK) { black++; continue; }
    if (grid[i] === WHITE) { white++; continue; }
    if (visited[i]) continue;

    // BFS empty region
    const stack  = [i];
    const region = [i];
    visited[i] = 1;
    let touchesB = false, touchesW = false;

    while (stack.length) {
      const cur = stack.pop();
      for (const nb of neighbors(cur, size)) {
        if (grid[nb] === BLACK) { touchesB = true; }
        else if (grid[nb] === WHITE) { touchesW = true; }
        else if (!visited[nb]) { visited[nb] = 1; stack.push(nb); region.push(nb); }
      }
    }

    if      (touchesB && !touchesW) black += region.length;
    else if (touchesW && !touchesB) white += region.length;
  }

  return black > white ? BLACK : WHITE;
}

// ── Rollout move selection ────────────────────────────────────────────────────

function pickRolloutMove(grid, color, koIdx, size, useHeuristic, lastMove) {
  const opp   = opponent(color);
  const total = size * size;

  if (useHeuristic && lastMove >= 0) {
    // Priority 1 — capture opponent group in atari adjacent to last move
    const seen1 = new Set();
    for (const n of neighbors(lastMove, size)) {
      if (grid[n] === opp && !seen1.has(n)) {
        const grp  = getGroup(n, grid, size);
        grp.forEach(gi => seen1.add(gi));
        const libs = liberties(grp, grid, size);
        if (libs.size === 1) {
          const capAt = [...libs][0];
          if (capAt !== koIdx && placeOnGrid(grid, capAt, color, koIdx, size).ok) {
            return capAt;
          }
        }
      }
    }

    // Priority 2 — save own group in atari adjacent to last move
    const seen2 = new Set();
    for (const n of neighbors(lastMove, size)) {
      if (grid[n] === color && !seen2.has(n)) {
        const grp  = getGroup(n, grid, size);
        grp.forEach(gi => seen2.add(gi));
        const libs = liberties(grp, grid, size);
        if (libs.size === 1) {
          const saveAt = [...libs][0];
          if (saveAt !== koIdx && grid[saveAt] === EMPTY &&
              placeOnGrid(grid, saveAt, color, koIdx, size).ok) {
            return saveAt;
          }
        }
      }
    }
  }

  // Fallback — random, skipping likely eyes on heuristic levels
  for (let attempts = 0; attempts < total + 8; attempts++) {
    const idx = (Math.random() * total) | 0;
    if (grid[idx] !== EMPTY || idx === koIdx) continue;
    if (useHeuristic && isLikelyEye(grid, idx, color, size)) continue;
    if (placeOnGrid(grid, idx, color, koIdx, size).ok) return idx;
  }

  return -1; // pass
}

// ── Full game rollout ─────────────────────────────────────────────────────────

function rollout(startGrid, startColor, startKo, size, useHeuristic) {
  const grid     = startGrid.slice(); // single copy for the whole rollout
  const moveLimit = 4 * size * size;
  let color    = startColor;
  let ko       = startKo;
  let passes   = 0;
  let lastMove = -1;

  for (let m = 0; m < moveLimit; m++) {
    const move = pickRolloutMove(grid, color, ko, size, useHeuristic, lastMove);

    if (move === -1) {
      passes++;
      if (passes >= 2) break;
      color    = opponent(color);
      ko       = -1;
      lastMove = -1;
      continue;
    }

    const placed = applyMutable(grid, move, color, ko, size);
    if (!placed.ok) {
      // Shouldn't happen; fall back to pass
      passes++;
      if (passes >= 2) break;
      color    = opponent(color);
      ko       = -1;
      lastMove = -1;
      continue;
    }

    passes   = 0;
    ko       = placed.newKoIdx;
    lastMove = move;
    color    = opponent(color);
  }

  return estimateWinner(grid, size);
}

// ── UCT selection ─────────────────────────────────────────────────────────────

function selectUCT(node) {
  let best = null, bestScore = -Infinity;
  const logP = Math.log(node.visits + 1);
  for (const child of node.children) {
    const score = child.visits === 0
      ? Infinity
      : (child.wins / child.visits) + 1.4 * Math.sqrt(logP / child.visits);
    if (score > bestScore) { bestScore = score; best = child; }
  }
  return best;
}

// ── MCTS main loop ────────────────────────────────────────────────────────────

function mcts(rootState, timeBudget, useHeuristic) {
  const { grid: rootGrid, size, currentColor, koIdx: rootKoIdx } = rootState;
  const deadline = Date.now() + timeBudget;

  // Root node — color:null means no move was made to reach it
  const root = {
    move: null, parent: null, children: [],
    wins: 0, visits: 1, color: null, untriedMoves: null,
  };

  while (Date.now() < deadline) {

    // ── SELECTION ────────────────────────────────────────────────
    let node  = root;
    let grid  = rootGrid.slice();
    let color = currentColor;
    let ko    = rootKoIdx;

    while (
      node.untriedMoves !== null &&
      node.untriedMoves.length === 0 &&
      node.children.length > 0
    ) {
      node = selectUCT(node);
      if (node.move !== -1) {
        const r = placeOnGrid(grid, node.move, node.color, ko, size);
        if (r.ok) { grid = r.newGrid; ko = r.newKoIdx; }
      } else {
        ko = -1;
      }
      color = opponent(node.color);
    }

    // ── EXPANSION ────────────────────────────────────────────────
    if (node.untriedMoves === null) {
      node.untriedMoves = getLegalMoves(grid, color, ko, size);
    }

    if (node.untriedMoves.length > 0) {
      const i    = (Math.random() * node.untriedMoves.length) | 0;
      const move = node.untriedMoves.splice(i, 1)[0];

      let childGrid = grid.slice();
      let childKo   = -1;

      if (move !== -1) {
        const r = placeOnGrid(grid, move, color, ko, size);
        if (!r.ok) continue; // getLegalMoves was wrong — skip
        childGrid = r.newGrid;
        childKo   = r.newKoIdx;
      }

      const child = {
        move, parent: node, children: [],
        wins: 0, visits: 0, color, untriedMoves: null,
      };
      node.children.push(child);
      node  = child;
      grid  = childGrid;
      ko    = childKo;
      color = opponent(color);
    }

    // ── ROLLOUT ──────────────────────────────────────────────────
    const winner = rollout(grid, color, ko, size, useHeuristic);

    // ── BACKPROPAGATION ──────────────────────────────────────────
    let n = node;
    while (n !== null) {
      n.visits++;
      if (n.color !== null && winner === n.color) n.wins++;
      n = n.parent;
    }
  }

  if (root.children.length === 0) return { pass: true };

  // Pick most-visited child
  let best = root.children[0];
  for (const c of root.children) {
    if (c.visits > best.visits) best = c;
  }

  if (best.move === -1 || best.move === null) return { pass: true };
  return { x: best.move % size, y: (best.move / size) | 0 };
}

// ── Worker message handler ────────────────────────────────────────────────────

self.onmessage = function (e) {
  const msg  = e.data;
  const size = msg.size;

  // Convert 2-D string grid → flat Int8Array
  const flat = new Int8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = msg.grid[y][x];
      flat[y * size + x] = v === 'black' ? BLACK : v === 'white' ? WHITE : EMPTY;
    }
  }

  const koIdx        = msg.koPoint ? msg.koPoint.y * size + msg.koPoint.x : -1;
  const currentColor = msg.currentPlayer === 'black' ? BLACK : WHITE;

  const level        = parseInt(msg.difficulty) || 3;
  const timeBudgets  = [0, 300, 600, 1500, 4000, 8000];
  const timeBudget   = timeBudgets[level] || 1500;
  const useHeuristic = level >= 2;

  const result = mcts(
    { grid: flat, size, currentColor, koIdx },
    timeBudget,
    useHeuristic,
  );

  self.postMessage(result);
};
