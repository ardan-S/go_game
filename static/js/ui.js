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

// Multiplayer state
let isMpMode            = false;
let myColor             = null;
let mp                  = null;
let mpMyConfirmed       = false;
let mpOpponentConfirmed = false;
let mpTakebackPending   = false; // true while waiting for opponent's response

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
    mp:         p.get('mp') === '1',
    room:       p.get('room') || null,
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

  isMpMode = params.mp && !!params.room && ['black', 'white'].includes(params.color);
  if (isMpMode) {
    myColor = params.color;
    mp = new Multiplayer(params.room, myColor, onMpMessage, onMpDisconnect);
    document.getElementById('undo-btn').textContent = 'Takeback';
  }

  const canvas     = document.getElementById('board-canvas');
  const canvasSize = calcCanvasSize(params.size);
  canvas.width  = canvasSize;
  canvas.height = canvasSize;

  renderer = new Renderer(canvas, board);
  renderer.draw();

  updateInfoBar();
  bindEvents(canvas);

  const mode = isMpMode ? 'friend' : isBotMode ? 'bot' : 'local';
  gtag('event', 'game_start', { board_size: params.size, mode, komi });

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
  document.getElementById('takeback-accept-btn').addEventListener('click',  onTakebackAccept);
  document.getElementById('takeback-reject-btn').addEventListener('click',  onTakebackReject);

  // Modal buttons
  document.getElementById('modal-confirm').addEventListener('click', onModalConfirm);
  document.getElementById('modal-cancel').addEventListener('click',  closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function isMyTurn() {
  return !isMpMode || board.currentPlayer === myColor;
}

function onCanvasClick(e) {
  const { x, y } = pixelToGrid(e);

  if (board.phase === 'playing') {
    // Ignore clicks while the bot is computing or when it's the bot's/opponent's turn
    if (isBotThinking) return;
    if (isBotMode && board.currentPlayer === botColor) return;
    if (isMpMode && !isMyTurn()) return;

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

    if (isMpMode) {
      mp.send({ type: 'move', x, y });
    } else if (isBotMode && board.currentPlayer === botColor && board.phase === 'playing') {
      // Hand off to bot if it's now the bot's turn
      triggerBotMove();
    }

  } else if (board.phase === 'scoring') {
    if (board.inBounds(x, y) && board.grid[y][x]) {
      board.toggleDeadGroup(x, y);
      renderer.draw();
      updateScorePreview();
      if (isMpMode) mp.send({ type: 'dead_toggle', x, y });
    }
  }
}

function onCanvasHover(e) {
  if (board.phase !== 'playing') return;
  if (isBotThinking || (isBotMode && board.currentPlayer === botColor)) return;
  if (isMpMode && !isMyTurn()) return;
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
  if (isMpMode && !isMyTurn()) return;

  const playerLabel = capitalise(board.currentPlayer);
  const result      = board.pass();
  if (!result.ok) { showStatus(result.reason); return; }
  showToast(`${playerLabel} passed`);
  if (isMpMode) mp.send({ type: 'pass' });
  if (result.gameOver) {
    enterScoringPhase();
  } else {
    renderer.draw();
    updateInfoBar();
    if (!isMpMode && isBotMode && board.currentPlayer === botColor && board.phase === 'playing') {
      triggerBotMove();
    }
  }
}

function onEndGame() {
  if (isBotThinking) return;
  if (isMpMode && !isMyTurn()) return;
  showConfirm('End the game now and proceed to scoring?', () => {
    board.endGame();
    if (isMpMode) mp.send({ type: 'end_game' });
    enterScoringPhase();
  });
}

function onUndo() {
  if (isBotThinking) return;
  if (isMpMode) {
    onRequestTakeback();
    return;
  }
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
  if (isMpMode && !isMyTurn()) return;
  const opponent = board.currentPlayer === 'black' ? 'White' : 'Black';
  showConfirm(`Resign? ${opponent} wins the game.`, () => {
    const loser = board.currentPlayer;
    board.resign(loser);
    renderer.draw();
    if (isMpMode) mp.send({ type: 'resign' });
    showResignResult(loser);
  });
}

function goHome() {
  if (mp) mp.close();
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
  gtag('event', 'game_end', { method: 'resign', winner: winner.toLowerCase(), move_count: board.moveNumber });
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
  if (isMpMode) {
    mpMyConfirmed = true;
    mp.send({ type: 'confirm_score' });
    document.getElementById('confirm-score-btn').disabled = true;
    document.getElementById('scoring-mp-status').textContent = 'Waiting for opponent to confirm…';
    document.getElementById('scoring-mp-status').style.display = 'block';
    if (mpOpponentConfirmed) finalizeMpScore();
    return;
  }
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

function finalizeMpScore() {
  board.finalizeScoring();
  const s = board.calculateScore(komi);
  const result = s.winner === 'draw'
    ? 'Draw!'
    : `${capitalise(s.winner)} wins by ${s.margin} point${s.margin !== 1 ? 's' : ''}!`;
  enterScoringEndState(result);
}

function enterScoringEndState(message) {
  const s = board.calculateScore(komi);
  gtag('event', 'game_end', { method: 'score', winner: s.winner, move_count: board.moveNumber });
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

// ─── Takeback ─────────────────────────────────────────────────────────────────

function updateTakebackButton() {
  if (!isMpMode) return;
  const btn = document.getElementById('undo-btn');
  const canRequest = board.phase === 'playing'
    && board.moveNumber > 0
    && board.currentPlayer !== myColor  // it's opponent's turn = I just moved
    && !mpTakebackPending;
  btn.disabled = !canRequest;
}

function onRequestTakeback() {
  if (!isMpMode || board.phase !== 'playing') return;
  if (board.moveNumber === 0 || board.currentPlayer === myColor) return;
  if (mpTakebackPending) return;
  mpTakebackPending = true;
  updateTakebackButton();
  mp.send({ type: 'takeback_request' });
  showStatus('Takeback request sent…');
}

function onTakebackAccept() {
  document.getElementById('takeback-banner').style.display = 'none';
  board.undo();
  renderer.draw();
  updateInfoBar();
  mp.send({ type: 'takeback_accept' });
}

function onTakebackReject() {
  document.getElementById('takeback-banner').style.display = 'none';
  mp.send({ type: 'takeback_reject' });
}

// ─── Multiplayer message handling ────────────────────────────────────────────

function onMpMessage(msg) {
  switch (msg.type) {

    case 'move': {
      // A new move cancels any pending takeback request shown to us
      document.getElementById('takeback-banner').style.display = 'none';
      const color  = board.currentPlayer;
      const result = board.placeStone(msg.x, msg.y);
      if (!result.ok) { console.error('Opponent move rejected:', result.reason); return; }
      if (result.captured.length > 0) renderer.startCaptureAnimation(result.captured);
      renderer.startPlaceAnimation(msg.x, msg.y, color);
      updateInfoBar();
      break;
    }

    case 'pass': {
      document.getElementById('takeback-banner').style.display = 'none';
      const playerLabel = capitalise(board.currentPlayer);
      const result = board.pass();
      showToast(`${playerLabel} passed`);
      if (result.gameOver) {
        enterScoringPhase();
      } else {
        renderer.draw();
        updateInfoBar();
      }
      break;
    }

    case 'resign': {
      const winner = myColor === 'black' ? 'White' : 'Black';
      board.resign(myColor === 'black' ? 'white' : 'black');
      renderer.draw();
      enterEndState(`${winner} wins by resignation.`);
      break;
    }

    case 'end_game': {
      board.endGame();
      enterScoringPhase();
      break;
    }

    case 'dead_toggle': {
      board.toggleDeadGroup(msg.x, msg.y);
      renderer.draw();
      updateScorePreview();
      break;
    }

    case 'confirm_score': {
      mpOpponentConfirmed = true;
      if (mpMyConfirmed) {
        finalizeMpScore();
      } else {
        document.getElementById('scoring-mp-status').textContent =
          'Opponent has confirmed — waiting for you.';
        document.getElementById('scoring-mp-status').style.display = 'block';
      }
      break;
    }

    case 'takeback_request': {
      document.getElementById('takeback-banner').style.display = 'flex';
      break;
    }

    case 'takeback_accept': {
      mpTakebackPending = false;
      board.undo();
      renderer.draw();
      updateInfoBar();
      showToast('Takeback accepted');
      break;
    }

    case 'takeback_reject': {
      mpTakebackPending = false;
      updateTakebackButton();
      showToast('Takeback rejected');
      break;
    }
  }
}

function onMpDisconnect() {
  document.getElementById('mp-disconnect-banner').style.display = 'flex';
  document.getElementById('controls').style.display             = 'none';
  document.getElementById('scoring-panel').style.display        = 'none';
  document.getElementById('mp-home-btn').addEventListener('click', goHome);
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
  updateTakebackButton();
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
