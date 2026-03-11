'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let board, renderer, komi;
let hoverPos    = null;
let statusTimer = null;
let toastTimer  = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    size:     parseInt(p.get('size'), 10) || 19,
    komi:     parseFloat(p.get('komi'))   || 0,
    superko:  p.get('superko') === '1',
    handicap: parseInt(p.get('handicap'), 10) || 0,
  };
}

function init() {
  const params = getParams();
  komi  = params.komi;
  board = new Board(params.size, { superko: params.superko, handicap: params.handicap });

  const canvas     = document.getElementById('board-canvas');
  const canvasSize = calcCanvasSize(params.size);
  canvas.width  = canvasSize;
  canvas.height = canvasSize;

  renderer = new Renderer(canvas, board);
  renderer.draw();

  updateInfoBar();
  bindEvents(canvas);
}

function calcCanvasSize(boardSize) {
  const vw  = window.innerWidth  - 40;
  const vh  = window.innerHeight - 180;
  const max = boardSize === 9 ? 480 : boardSize === 13 ? 560 : 660;
  return Math.max(320, Math.min(max, vw, vh));
}

// ─── Event Binding ────────────────────────────────────────────────────────────

function bindEvents(canvas) {
  canvas.addEventListener('click',      onCanvasClick);
  canvas.addEventListener('mousemove',  onCanvasHover);
  canvas.addEventListener('mouseleave', onCanvasLeave);

  document.getElementById('pass-btn').addEventListener('click',     onPass);
  document.getElementById('end-game-btn').addEventListener('click', onEndGame);
  document.getElementById('undo-btn').addEventListener('click',     onUndo);
  document.getElementById('resign-btn').addEventListener('click',   onResign);

  document.getElementById('confirm-score-btn').addEventListener('click',    onConfirmScore);
  document.getElementById('new-game-scoring-btn').addEventListener('click', goHome);
  document.getElementById('board-result-new-game-btn').addEventListener('click', goHome);

  // Modal buttons
  document.getElementById('modal-confirm').addEventListener('click', onModalConfirm);
  document.getElementById('modal-cancel').addEventListener('click',  closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function onCanvasClick(e) {
  const { x, y } = pixelToGrid(e);

  if (board.phase === 'playing') {
    const color  = board.currentPlayer;
    const result = board.placeStone(x, y);

    if (!result.ok) {
      showStatus(result.reason);
      return;
    }

    // Trigger animations — captures fade first, placed stone scales in on top.
    if (result.captured.length > 0) renderer.startCaptureAnimation(result.captured);
    renderer.startPlaceAnimation(x, y, color);

    updateInfoBar();

  } else if (board.phase === 'scoring') {
    if (board.inBounds(x, y) && board.grid[y][x]) {
      board.toggleDeadGroup(x, y);
      renderer.draw();
      updateScorePreview();
    }
  }
}

function onCanvasHover(e) {
  if (board.phase !== 'playing') return;
  const { x, y } = pixelToGrid(e);
  if (hoverPos && hoverPos.x === x && hoverPos.y === y) return;
  hoverPos = { x, y };
  renderer.draw();
  if (board.inBounds(x, y) && !board.grid[y][x]) {
    renderer.drawHoverStone(x, y, board.currentPlayer);
  }
}

function onCanvasLeave() {
  hoverPos = null;
  renderer.draw();
}

function pixelToGrid(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  return renderer.toGrid(e.clientX - rect.left, e.clientY - rect.top);
}

// ─── Controls ─────────────────────────────────────────────────────────────────

function onPass() {
  const playerLabel = capitalise(board.currentPlayer);
  const result      = board.pass();
  if (!result.ok) { showStatus(result.reason); return; }
  showToast(`${playerLabel} passed`);
  if (result.gameOver) {
    enterScoringPhase();
  } else {
    renderer.draw();
    updateInfoBar();
  }
}

function onEndGame() {
  showConfirm('End the game now and proceed to scoring?', () => {
    board.endGame();
    enterScoringPhase();
  });
}

function onUndo() {
  const result = board.undo();
  if (!result.ok) {
    showStatus(result.reason);
    return;
  }
  renderer.draw();
  updateInfoBar();
}

function onResign() {
  const opponent = board.currentPlayer === 'black' ? 'White' : 'Black';
  showConfirm(`Resign? ${opponent} wins the game.`, () => {
    const loser = board.currentPlayer;
    board.resign(loser);
    renderer.draw();
    showResignResult(loser);
  });
}

function goHome() {
  window.location.href = 'index.html';
}

// ─── Resign Result ────────────────────────────────────────────────────────────

function showResignResult(resignedPlayer) {
  const winner = resignedPlayer === 'black' ? 'White' : 'Black';
  enterEndState(`${winner} wins by resignation.`);
}

// ─── Scoring Phase ────────────────────────────────────────────────────────────

function enterScoringPhase() {
  renderer.draw();
  document.getElementById('controls').style.display          = 'none';
  document.getElementById('scoring-panel').style.display     = 'block';
  document.getElementById('score-panel-black').style.display = 'block';
  document.getElementById('score-panel-white').style.display = 'block';
  document.getElementById('turn-indicator').textContent      = 'Game Over — Scoring';
  document.getElementById('stone-dot').style.display         = 'none';
  document.getElementById('ko-indicator').classList.remove('visible');

  // Show komi row only if komi is active
  document.getElementById('sp-white-komi-row').style.display = komi ? 'flex' : 'none';

  updateScorePreview();
}

function updateScorePreview() {
  const s = board.calculateScore(komi);

  document.getElementById('sp-black-territory').textContent = s.black.territory;
  document.getElementById('sp-black-captures').textContent  = s.black.captures;
  document.getElementById('sp-black-dead').textContent      = s.black.deadOpponent;
  document.getElementById('sp-black-total').textContent     = s.black.total;

  document.getElementById('sp-white-territory').textContent = s.white.territory;
  document.getElementById('sp-white-captures').textContent  = s.white.captures;
  document.getElementById('sp-white-dead').textContent      = s.white.deadOpponent;
  document.getElementById('sp-white-total').textContent     = s.white.total;
  if (komi) document.getElementById('sp-white-komi').textContent = komi;
}

function onConfirmScore() {
  board.finalizeScoring();
  const s = board.calculateScore(komi);
  let result;
  if (s.winner === 'draw') {
    result = 'Draw!';
  } else {
    result = `${capitalise(s.winner)} wins by ${s.margin} point${s.margin !== 1 ? 's' : ''}!`;
  }
  enterScoringEndState(result);
}

function enterScoringEndState(message) {
  document.getElementById('scoring-panel').style.display = 'none';
  document.getElementById('stone-dot').style.display     = 'none';
  document.getElementById('ko-indicator').classList.remove('visible');
  document.getElementById('turn-indicator').textContent  = 'Game Over';

  renderer.drawEmpty();

  document.getElementById('board-result-message').textContent = message;
  document.getElementById('board-result').style.display = 'flex';
}

function enterEndState(message) {
  document.getElementById('controls').style.display          = 'none';
  document.getElementById('scoring-panel').style.display     = 'none';
  document.getElementById('score-panel-black').style.display = 'none';
  document.getElementById('score-panel-white').style.display = 'none';
  document.getElementById('stone-dot').style.display         = 'none';
  document.getElementById('ko-indicator').classList.remove('visible');
  document.getElementById('turn-indicator').textContent  = 'Game Over';

  // Show the result overlay.
  document.getElementById('result-message').textContent = message;
  document.getElementById('result-overlay').style.display = 'flex';
  document.getElementById('result-new-game-btn').onclick = goHome;
}

// ─── Info Bar ─────────────────────────────────────────────────────────────────

function updateInfoBar() {
  const player = board.currentPlayer;

  document.getElementById('turn-indicator').textContent =
    `${capitalise(player)}'s turn`;

  const dot = document.getElementById('stone-dot');
  dot.className    = `stone-dot ${player}`;
  dot.style.display = '';

  document.getElementById('captures-black').textContent = board.captures.black;
  document.getElementById('captures-white').textContent = board.captures.white;
  document.getElementById('move-counter').textContent   = board.moveNumber;

  document.getElementById('ko-indicator').classList.toggle('visible', !!board.koPoint);
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

let _modalCallback = null;

function showConfirm(message, onConfirm) {
  document.getElementById('modal-message').textContent = message;
  document.getElementById('modal-overlay').style.display = 'flex';
  _modalCallback = onConfirm;
}

function onModalConfirm() {
  const cb = _modalCallback;
  closeModal();
  if (cb) cb();
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  _modalCallback = null;
}

// ─── Toast Notification ───────────────────────────────────────────────────────

function showToast(text) {
  const el = document.getElementById('pass-toast');
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2000);
}

// ─── Status Flash ─────────────────────────────────────────────────────────────

function showStatus(msg, duration = 2200) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; }, duration);
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);
