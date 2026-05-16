'use strict';

class Bot {
  constructor() {
    this._controller = null;
  }

  // Send the current board state to the server and call back with the chosen move.
  // Only one request may be in flight at a time.
  requestMove(boardState, difficulty, callback) {
    this._controller = new AbortController();

    fetch('/bot-move', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        size:           boardState.size,
        handicapStones: boardState.handicapStones || [],
        moves:          boardState.moves           || [],
        color:          boardState.currentPlayer,
        difficulty:     difficulty,
        engine:         'gnugo',
        komi:           boardState.komi || 0,
      }),
      signal: this._controller.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error('Bot server error: ' + r.status);
        return r.json();
      })
      .then(data => {
        this._controller = null;
        callback(data);
      })
      .catch(err => {
        this._controller = null;
        if (err.name !== 'AbortError') {
          console.error('Bot request failed:', err);
          callback({ pass: true });
        }
      });
  }

  terminate() {
    if (this._controller) {
      this._controller.abort();
      this._controller = null;
    }
  }
}
