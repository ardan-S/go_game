'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let board, renderer, komi;
let hoverPos    = null;
let statusTimer = null;
let toastTimer  = null;

// Bot state
let isBotMode     = false;
let botColor      = 'white';
let botDifficulty = 'medium';
let isBotThinking = false;
let bot           = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────

function getParams() {
  const p = new URLSearchParams(window.location.search);
  const rawSize = parseInt(p.get('size'), 10);
  const rawKomi = parseFloat(p.get('komi'));
  const rawHandicap = parseInt(p.get('handicap'), 10);
  const rawDifficulty = parseInt(p.get('difficulty'), 10);
  const rawColor = p.get('color');
  return {
    size:       [9, 13, 19].includes(rawSize) ? rawSize : 19,
    komi:       (!isNaN(rawKomi) && rawKomi >= 0 && rawKomi <= 99) ? rawKomi : 0,
    superko:    p.get('superko') === '1',
    handicap:   (!isNaN(rawHandicap) && rawHandicap >= 0) ? rawHandicap : 0,
    bot:        p.get('bot') === '1',
    difficulty: Math.min(5, Math.max(1, !isNaN(rawDifficulty) ? rawDifficulty : 3)),
    color:      ['black', 'white', 'random'].includes(rawColor) ? rawColor : 'random',
  };
}

function init() {
  const params = getParams();
  komi  = params.komi;
  board = new Board(params.size, { superko: params.superko, handicap: params.handicap });

  isBotMode     = params.bot;
  botDifficulty = params.difficulty;
  if (isBotMode) {
    const colorParam = params.color;
    botColor = colorParam === 'random'
      ? (Math.random() < 0.5 ? 'white' : 'black')
      : (colorParam === 'black' ? 'white' : 'black');
    bot = new Bot();
  }

  const canvas     = document.getElementById('board-canvas');
  const canvasSize = calcCanvasSize(params.size);
  canvas.width  = canvasSize;
  canvas.height = canvasSize;

  renderer = new Renderer(canvas, board);
  renderer.draw();

  updateInfoBar();
  bindEvents(canvas);

  // If bot plays first (e.g. player chose White, bot is Black), trigger immediately
  if (isBotMode && board.currentPlayer === botColor && board.phase === 'playing') {
    setTimeout(triggerBotMove, 80);
  }
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
    // Ignore clicks while the bot is computing or when it's the bot's turn
    if (isBotThinking) return;
    if (isBotMode && board.currentPlayer === botColor) return;

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

    // Hand off to bot if it's now the bot's turn
    if (isBotMode && board.currentPlayer === botColor && board.phase === 'playing') {
      triggerBotMove();
    }

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
  if (isBotThinking || (isBotMode && board.currentPlayer === botColor)) return;
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
  if (isBotThinking) return;
  if (isBotMode && board.currentPlayer === botColor) return;

  const playerLabel = capitalise(board.currentPlayer);
  const result      = board.pass();
  if (!result.ok) { showStatus(result.reason); return; }
  showToast(`${playerLabel} passed`);
  if (result.gameOver) {
    enterScoringPhase();
  } else {
    renderer.draw();
    updateInfoBar();
    // Trigger bot after human pass
    if (isBotMode && board.currentPlayer === botColor && board.phase === 'playing') {
      triggerBotMove();
    }
  }
}

function onEndGame() {
  if (isBotThinking) return;
  showConfirm('End the game now and proceed to scoring?', () => {
    board.endGame();
    enterScoringPhase();
  });
}

function onUndo() {
  if (isBotThinking) return;
  if (isBotMode) {
    // Undo both the bot's last move and the human's last move together
    const first = board.undo();
    if (!first.ok) { showStatus(first.reason); return; }
    // Try second undo; if only one move existed that's fine
    board.undo();
    renderer.draw();
    updateInfoBar();
    // If it's now the bot's turn (e.g. bot plays Black), trigger it again
    if (board.phase === 'playing' && board.currentPlayer === botColor) {
      triggerBotMove();
    }
    return;
  } else {
    const result = board.undo();
    if (!result.ok) { showStatus(result.reason); return; }
  }
  renderer.draw();
  updateInfoBar();
}

function onResign() {
  if (isBotThinking) return;
  const opponent = board.currentPlayer === 'black' ? 'White' : 'Black';
  showConfirm(`Resign? ${opponent} wins the game.`, () => {
    const loser = board.currentPlayer;
    board.resign(loser);
    renderer.draw();
    showResignResult(loser);
  });
}

function goHome() {
  if (bot) bot.terminate();
  window.location.href = 'index.html';
}

// ─── Bot ──────────────────────────────────────────────────────────────────────

function startBotTimer(durationMs) {
  const arc = document.getElementById('bot-timer-arc');
  arc.classList.remove('running');
  window.getComputedStyle(arc).animationName; // force reflow to restart animation
  arc.style.animationDuration = durationMs + 'ms';
  arc.classList.add('running');
  document.getElementById('bot-timer').style.display = 'flex';
}

function stopBotTimer() {
  const arc = document.getElementById('bot-timer-arc');
  arc.classList.remove('running');
  document.getElementById('bot-timer').style.display = 'none';
}

function triggerBotMove() {
  isBotThinking = true;
  const canvas  = document.getElementById('board-canvas');

  canvas.style.pointerEvents = 'none';
  document.getElementById('controls').style.display      = 'none';
  document.getElementById('bot-thinking').style.display  = 'flex';
  document.getElementById('bot-thinking-text').textContent =
    `${capitalise(botColor)} is thinking\u2026`;

  const level    = Math.min(5, Math.max(1, parseInt(botDifficulty) || 3));
  const budgetMs = [0, 300, 600, 1500, 4000, 8000][level] || 1500;
  startBotTimer(budgetMs);

  const boardState = {
    grid:          board.grid,
    size:          board.size,
    currentPlayer: board.currentPlayer,
    koPoint:       board.koPoint,
  };

  bot.requestMove(boardState, botDifficulty, (result) => {
    isBotThinking = false;
    stopBotTimer();
    canvas.style.pointerEvents = '';
    document.getElementById('bot-thinking').style.display = 'none';
    document.getElementById('controls').style.display     = 'flex';

    // Game may have ended while the worker was computing (e.g. user resigned)
    if (board.phase !== 'playing') return;

    if (result.pass) {
      applyBotPass();
      return;
    }

    const color     = board.currentPlayer;
    const moveResult = board.placeStone(result.x, result.y);

    if (!moveResult.ok) {
      // Bot returned an illegal move — fall back to pass
      console.warn('Bot returned illegal move, falling back to pass:', result, moveResult.reason);
      applyBotPass();
      return;
    }

    if (moveResult.captured.length > 0) renderer.startCaptureAnimation(moveResult.captured);
    renderer.startPlaceAnimation(result.x, result.y, color);
    updateInfoBar();
  });
}

function applyBotPass() {
  const result = board.pass();
  showToast(`${capitalise(botColor)} passed`);
  if (result.gameOver) {
    enterScoringPhase();
  } else {
    renderer.draw();
    updateInfoBar();
  }
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
