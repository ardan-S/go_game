'use strict';

class Bot {
  constructor() {
    this._worker   = null;
    this._callback = null;
  }

  // Lazy Worker creation — file is only fetched when bot mode is actually used.
  _ensureWorker() {
    if (this._worker) return;
    this._worker = new Worker('js/bot-worker.js');

    this._worker.onmessage = (e) => {
      const cb       = this._callback;
      this._callback = null;
      if (cb) cb(e.data);
    };

    this._worker.onerror = (err) => {
      console.error('Bot worker error:', err);
      const cb       = this._callback;
      this._callback = null;
      if (cb) cb({ pass: true }); // fail-safe: pass rather than hang
    };
  }

  // Send the current board state to the worker and call back with the chosen move.
  // Only one request may be in flight at a time.
  requestMove(boardState, difficulty, callback) {
    this._ensureWorker();
    this._callback = callback;
    this._worker.postMessage({
      grid:          boardState.grid,
      size:          boardState.size,
      currentPlayer: boardState.currentPlayer,
      koPoint:       boardState.koPoint,
      difficulty,
    });
  }

  terminate() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    this._callback = null;
  }
}
