'use strict';

let selectedSize       = null;
let selectedMode       = 'local';
let selectedDifficulty = 3;
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
  document.getElementById('diff-think-note').style.display =
    selectedDifficulty >= 4 ? 'block' : 'none';
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

  // Reset bot-only elements
  colorOptionRow.style.display     = 'none';
  colorOptionDivider.style.display = 'none';
  diffRow.style.display            = 'none';
  handicapRow.style.display        = '';

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
    document.getElementById('diff-think-note').style.display =
      selectedDifficulty >= 4 ? 'block' : 'none';
    // Hide handicap — bot always plays standard game
    handicapRow.style.display    = 'none';
    handicapDetail.style.display = 'none';
    handicapToggle.checked       = false;
    descText.textContent = 'Play against the computer — choose your colour and difficulty.';
  } else if (selectedMode === 'friend') {
    setupConfig.style.display = 'block';
    modeMessage.style.display = 'none';
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
    startBtn.disabled    = true;
    startBtn.textContent = 'Not implemented yet';
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

// Initialise
updateHandicapOptions(19);
updateModeView();
