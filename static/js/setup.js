'use strict';

let selectedSize       = null;
let selectedMode       = 'local';
let selectedDifficulty = 5;
let selectedColor      = 'random';

function selectSize(size) {
  selectedSize = size;
  document.querySelectorAll('[data-size]').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.size) === size);
  });
  updateHandicapOptions(size);
  updateStartButton();
}

function updateHandicapOptions(size) {
  const max    = size === 19 ? 9 : 5;
  const select = document.getElementById('handicap-count');
  select.innerHTML = '';
  for (let i = 2; i <= max; i++) {
    const opt       = document.createElement('option');
    opt.value       = i;
    opt.textContent = i + ' stones';
    select.appendChild(opt);
  }
}

function toggleKomi(checked) {
  document.getElementById('komi-detail').style.display = checked ? 'flex' : 'none';
}

function toggleHandicap(checked) {
  document.getElementById('handicap-detail').style.display = checked ? 'flex' : 'none';
}

function selectColor(color) {
  selectedColor = color;
  document.querySelectorAll('[data-color]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}

function onDifficultySlider(val) {
  selectedDifficulty = parseInt(val, 10);
  updateStartButton();
}

function selectMode(mode) {
  selectedMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  updateModeView();
}

function updateModeView() {
  const setupConfig        = document.getElementById('setup-config');
  const modeMessage        = document.getElementById('mode-message');
  const descText           = document.getElementById('mode-description-text');
  const msgText            = document.getElementById('mode-message-text');
  const colorOptionRow     = document.getElementById('color-option-row');
  const colorOptionDivider = document.getElementById('color-option-divider');
  const diffRow            = document.getElementById('difficulty-row');
  const handicapDetail     = document.getElementById('handicap-detail');
  const handicapToggle     = document.getElementById('handicap-toggle');
  const handicapRow        = handicapToggle.closest('.option-row');

  // Reset mode-specific elements
  colorOptionRow.style.display     = 'none';
  colorOptionDivider.style.display = 'none';
  diffRow.style.display            = 'none';
  handicapRow.style.display        = '';
  document.getElementById('start-btn').style.display         = '';
  document.getElementById('friend-lobby').style.display      = 'none';

  if (selectedMode === 'local') {
    setupConfig.style.display = 'block';
    modeMessage.style.display = 'none';
    descText.textContent = 'Two players use the same machine and alternate turns on a shared board.';
  } else if (selectedMode === 'bot') {
    setupConfig.style.display        = 'block';
    modeMessage.style.display        = 'none';
    colorOptionRow.style.display     = '';
    colorOptionDivider.style.display = '';
    diffRow.style.display            = 'block';
    // Hide handicap — bot always plays standard game
    handicapRow.style.display    = 'none';
    handicapDetail.style.display = 'none';
    handicapToggle.checked       = false;
    descText.textContent = 'Play against the computer — choose your colour and difficulty.';
  } else if (selectedMode === 'friend') {
    setupConfig.style.display        = 'block';
    modeMessage.style.display        = 'none';
    // Hide handicap — not supported in multiplayer
    handicapRow.style.display    = 'none';
    handicapDetail.style.display = 'none';
    handicapToggle.checked       = false;
    descText.textContent = 'Create a link to send to someone so you can play across two devices.';
  } else if (selectedMode === 'online') {
    setupConfig.style.display = 'none';
    modeMessage.style.display = 'block';
    descText.textContent = 'Play against a stranger online.';
    msgText.textContent  = 'Sorry, not implemented yet.';
  } else {
    setupConfig.style.display = 'none';
    modeMessage.style.display = 'block';
    descText.textContent = 'Play against an engine.';
    msgText.textContent  = 'Sorry, not implemented yet.';
  }

  updateStartButton();
}

function updateStartButton() {
  const startBtn = document.getElementById('start-btn');

  if (selectedMode === 'local') {
    startBtn.disabled    = !selectedSize;
    startBtn.textContent = selectedSize ? 'Start Game' : 'Select a board size';
  } else if (selectedMode === 'bot') {
    startBtn.disabled    = !selectedSize;
    startBtn.textContent = selectedSize ? 'Start Game' : 'Select a board size';
  } else if (selectedMode === 'friend') {
    startBtn.style.display = 'none';
    document.getElementById('friend-lobby').style.display = 'block';
    document.getElementById('friend-create-state').style.display = 'block';
    document.getElementById('friend-wait-state').style.display   = 'none';
    const createBtn = document.getElementById('create-room-btn');
    createBtn.disabled    = !selectedSize;
    createBtn.textContent = selectedSize ? 'Create Room' : 'Select a board size';
  } else {
    startBtn.disabled    = true;
    startBtn.textContent = 'Start Game';
  }
}

function startGame() {
  const komiEnabled = document.getElementById('komi-toggle').checked;
  const rawKomi     = parseFloat(document.getElementById('komi-value').value);
  const komi        = (komiEnabled && !isNaN(rawKomi) && rawKomi >= 0 && rawKomi <= 99) ? rawKomi : 0;
  const superko     = document.getElementById('superko-toggle').checked ? 1 : 0;

  if (selectedMode === 'local') {
    if (!selectedSize) return;
    const hEnabled = document.getElementById('handicap-toggle').checked;
    const handicap = hEnabled ? parseInt(document.getElementById('handicap-count').value, 10) : 0;
    window.location.href = `game.html?size=${selectedSize}&komi=${komi}&superko=${superko}&handicap=${handicap}`;
  } else if (selectedMode === 'bot') {
    if (!selectedSize) return;
    window.location.href = `game.html?size=${selectedSize}&komi=${komi}&superko=${superko}&handicap=0&bot=1&difficulty=${selectedDifficulty}&color=${selectedColor}`;
  }
}

// ─── Friend / multiplayer lobby ───────────────────────────────────────────────

let friendWs          = null;
let friendRoomId      = null;
let selectedFriendColor = 'random';

function selectFriendColor(color) {
  selectedFriendColor = color;
  document.querySelectorAll('.friend-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.friendColor === color);
  });
}

function getFriendParams() {
  const komiEnabled = document.getElementById('komi-toggle').checked;
  const rawKomi     = parseFloat(document.getElementById('komi-value').value);
  const komi        = (komiEnabled && !isNaN(rawKomi) && rawKomi >= 0 && rawKomi <= 99) ? rawKomi : 0;
  const superko     = document.getElementById('superko-toggle').checked ? 1 : 0;
  return { size: selectedSize, komi, superko };
}

function createRoom() {
  if (!selectedSize) return;
  const { size, komi, superko } = getFriendParams();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url   = `${proto}//${location.host}/ws?room=new&size=${size}&komi=${komi}&superko=${superko}&creatorColor=${selectedFriendColor}`;

  friendWs = new WebSocket(url);

  friendWs.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'waiting_for_opponent') {
      friendRoomId = msg.roomId;
      showFriendWaitState(friendRoomId, size, komi, superko);
    } else if (msg.type === 'game_start') {
      friendWs = null;
      window.location.href =
        `game.html?size=${msg.size}&komi=${msg.komi}&superko=${msg.superko}&mp=1&color=${msg.yourColor}&room=${friendRoomId}`;
    }
  };

  friendWs.onerror = () => showFriendError('Connection failed. Please try again.');
  friendWs.onclose = () => { if (!friendRoomId) showFriendError('Connection lost.'); };
}

function showFriendWaitState(roomId) {
  document.getElementById('friend-create-state').style.display = 'none';
  document.getElementById('friend-wait-state').style.display   = 'block';
  const link = `${location.origin}${location.pathname}?room=${roomId}`;
  document.getElementById('friend-link-input').value = link;
}

function showFriendError(msg) {
  document.getElementById('friend-create-state').style.display = 'block';
  document.getElementById('friend-wait-state').style.display   = 'none';
  document.getElementById('friend-wait-status').textContent    = msg;
  friendRoomId = null;
}

function cancelFriendRoom() {
  if (friendWs) { friendWs.onclose = null; friendWs.close(); friendWs = null; }
  friendRoomId = null;
  document.getElementById('friend-create-state').style.display = 'block';
  document.getElementById('friend-wait-state').style.display   = 'none';
}

function tryAutoJoin() {
  const p      = new URLSearchParams(location.search);
  const roomId = p.get('room');
  if (!roomId) return;

  // Auto-select friend mode so the UI looks right
  selectMode('friend');

  // Show a "joining…" state
  document.getElementById('friend-lobby').style.display      = 'block';
  document.getElementById('friend-create-state').style.display = 'none';
  document.getElementById('friend-wait-state').style.display   = 'block';
  document.getElementById('friend-link-input').value = location.href;
  document.getElementById('friend-wait-status').textContent   = 'Joining room…';

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws    = new WebSocket(`${proto}//${location.host}/ws?room=${roomId}`);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'game_start') {
      window.location.href =
        `game.html?size=${msg.size}&komi=${msg.komi}&superko=${msg.superko}&mp=1&color=${msg.yourColor}&room=${roomId}`;
    } else if (msg.type === 'room_full') {
      document.getElementById('friend-wait-status').textContent = 'This room is already full.';
      ws.close();
    } else if (msg.type === 'room_not_found') {
      document.getElementById('friend-wait-status').textContent = 'Room not found or has expired.';
      ws.close();
    }
  };
  ws.onerror = () => {
    document.getElementById('friend-wait-status').textContent = 'Connection failed.';
  };
}

function openGuide()  { document.getElementById('guide-overlay').style.display = 'flex'; }
function closeGuide() { document.getElementById('guide-overlay').style.display = 'none'; }
function openRules()  { document.getElementById('rules-overlay').style.display = 'flex'; }
function closeRules() { document.getElementById('rules-overlay').style.display = 'none'; }

// ─── Wire up all event listeners ──────────────────────────────────────────────

document.getElementById('guide-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeGuide();
});
document.getElementById('rules-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeRules();
});

document.getElementById('open-guide-btn').addEventListener('click', openGuide);
document.getElementById('open-rules-btn').addEventListener('click', openRules);
document.getElementById('close-guide-btn').addEventListener('click', closeGuide);
document.getElementById('close-rules-btn').addEventListener('click', closeRules);

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => selectMode(btn.dataset.mode));
});
document.querySelectorAll('[data-size]').forEach(btn => {
  btn.addEventListener('click', () => selectSize(parseInt(btn.dataset.size, 10)));
});
document.querySelectorAll('[data-color]').forEach(btn => {
  btn.addEventListener('click', () => selectColor(btn.dataset.color));
});

document.getElementById('komi-toggle').addEventListener('change', e => toggleKomi(e.target.checked));
document.getElementById('handicap-toggle').addEventListener('change', e => toggleHandicap(e.target.checked));
document.getElementById('difficulty-slider').addEventListener('input', e => onDifficultySlider(e.target.value));
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('create-room-btn').addEventListener('click', createRoom);
document.querySelectorAll('.friend-color-btn').forEach(btn => {
  btn.addEventListener('click', () => selectFriendColor(btn.dataset.friendColor));
});
document.getElementById('friend-copy-btn').addEventListener('click', () => {
  const input = document.getElementById('friend-link-input');
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById('friend-copy-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
});
document.getElementById('friend-cancel-btn').addEventListener('click', cancelFriendRoom);

// Initialise
updateHandicapOptions(19);
updateModeView();
tryAutoJoin();
