'use strict';

class Multiplayer {
  constructor(roomId, myColor, onMessage, onDisconnect) {
    this._onMessage    = onMessage;
    this._onDisconnect = onDisconnect;
    this._closed       = false;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this._ws = new WebSocket(`${proto}//${location.host}/ws?room=${roomId}&color=${myColor}`);

    this._ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this._onMessage(msg);
      } catch (err) {
        console.error('Multiplayer: failed to parse message', err);
      }
    };

    this._ws.onclose = () => {
      if (!this._closed) {
        this._closed = true;
        this._onDisconnect();
      }
    };

    this._ws.onerror = () => {
      if (!this._closed) {
        this._closed = true;
        this._onDisconnect();
      }
    };
  }

  send(msgObj) {
    if (this._ws.readyState !== WebSocket.OPEN) {
      console.warn('Multiplayer.send: connection not open');
      return;
    }
    this._ws.send(JSON.stringify(msgObj));
  }

  close() {
    this._closed = true;
    this._ws.close();
  }
}
