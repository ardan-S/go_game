'use strict';

class Renderer {
  constructor(canvas, board) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.board   = board;
    this.padding = 44;

    // Animation state
    this._placing   = null; // { x, y, color, startTime, duration }
    this._capturing = null; // { stones: [{x,y,color}], startTime, duration }
    this._rafId     = null;
  }

  // ─── Coordinate Helpers ──────────────────────────────────────────────────────

  get cellSize() {
    const usable = Math.min(this.canvas.width, this.canvas.height) - 2 * this.padding;
    return usable / (this.board.size - 1);
  }

  toPixel(x, y) {
    const cs = this.cellSize;
    return { px: this.padding + x * cs, py: this.padding + y * cs };
  }

  toGrid(px, py) {
    const cs = this.cellSize;
    return {
      x: Math.round((px - this.padding) / cs),
      y: Math.round((py - this.padding) / cs),
    };
  }

  stoneRadius() {
    return this.cellSize * 0.46;
  }

  // ─── Animation API ───────────────────────────────────────────────────────────

  startPlaceAnimation(x, y, color) {
    this._placing = { x, y, color, startTime: performance.now(), duration: 130 };
    this._startRaf();
  }

  startCaptureAnimation(stones) {
    if (!stones.length) return;
    this._capturing = { stones, startTime: performance.now(), duration: 160 };
    this._startRaf();
  }

  _startRaf() {
    if (this._rafId) return;
    const tick = (now) => {
      if (this._placing  && now - this._placing.startTime  >= this._placing.duration)  this._placing  = null;
      if (this._capturing && now - this._capturing.startTime >= this._capturing.duration) this._capturing = null;

      this.draw();

      if (this._placing || this._capturing) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._rafId = null;
        this.draw(); // clean final frame
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  // ─── Star Points ─────────────────────────────────────────────────────────────

  _starPoints() {
    switch (this.board.size) {
      case 9:  return [[2,2],[6,2],[4,4],[2,6],[6,6]];
      case 13: return [[3,3],[9,3],[6,6],[3,9],[9,9]];
      case 19: return [
        [3,3],[9,3],[15,3], [3,9],[9,9],[15,9], [3,15],[9,15],[15,15],
      ];
      default: return [];
    }
  }

  // ─── Main Draw ───────────────────────────────────────────────────────────────

  drawEmpty() {
    const { ctx, canvas } = this;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this._drawBoard();
    this._drawGrid();
    this._drawCoordinateLabels();
    this._drawStarPoints();
  }

  draw() {
    const { ctx, canvas } = this;
    const now = performance.now();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this._drawBoard();
    this._drawGrid();
    this._drawCoordinateLabels();
    this._drawStarPoints();

    // Territory shading during scoring/finished phases.
    if (this.board.phase === 'scoring' || this.board.phase === 'finished') {
      this._drawTerritoryShading();
    }

    this._drawStones(now);

    // Placement animation — stone scales in from 60% to 100%.
    if (this._placing) {
      const t     = Math.min(1, (now - this._placing.startTime) / this._placing.duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this._drawStoneSized(this._placing.x, this._placing.y, this._placing.color, 0.6 + 0.4 * eased);
    }

    // Capture animation — stones fade out.
    if (this._capturing) {
      const t     = Math.min(1, (now - this._capturing.startTime) / this._capturing.duration);
      const alpha = 1 - t;
      for (const { x, y, color } of this._capturing.stones) {
        this._drawStoneCore(x, y, color, alpha);
      }
    }

    this._drawLastMoveMarker();
    this._drawKoMarker();
  }

  // ─── Board & Grid ─────────────────────────────────────────────────────────────

  _drawBoard() {
    const { ctx, canvas } = this;
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#d9b06e');
    grad.addColorStop(1, '#c49456');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  _drawGrid() {
    const { ctx, board } = this;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth   = 0.8;

    for (let i = 0; i < board.size; i++) {
      const { px: vx, py: vy0 } = this.toPixel(i, 0);
      const { py: vy1 }         = this.toPixel(i, board.size - 1);
      const { py: hy }          = this.toPixel(0, i);
      const { px: hx1 }         = this.toPixel(board.size - 1, i);

      ctx.beginPath(); ctx.moveTo(vx, vy0);  ctx.lineTo(vx, vy1);  ctx.stroke();
      ctx.beginPath(); ctx.moveTo(this.padding, hy); ctx.lineTo(hx1, hy); ctx.stroke();
    }
  }

  _drawCoordinateLabels() {
    const { ctx, board } = this;
    const cols     = 'ABCDEFGHJKLMNOPQRST'; // I is intentionally skipped
    const fontSize = Math.max(9, Math.min(13, this.cellSize * 0.38));

    ctx.font         = `500 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.fillStyle    = 'rgba(0, 0, 0, 0.42)';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < board.size; i++) {
      const { px } = this.toPixel(i, 0);
      const { py } = this.toPixel(0, i);

      // Column letter — above the top grid line.
      ctx.textAlign = 'center';
      ctx.fillText(cols[i], px, this.padding * 0.46);

      // Row number — Go numbers from bottom upward, so row 0 = size, row size-1 = 1.
      ctx.textAlign = 'right';
      ctx.fillText(board.size - i, this.padding - 7, py);
    }
  }

  _drawStarPoints() {
    const { ctx } = this;
    const dotR = Math.max(2.5, this.cellSize * 0.09);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    for (const [sx, sy] of this._starPoints()) {
      const { px, py } = this.toPixel(sx, sy);
      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ─── Territory Shading ───────────────────────────────────────────────────────

  _drawTerritoryShading() {
    const { ctx }    = this;
    const positions  = this.board.getTerritoryPositions();
    const s          = this.cellSize * 0.2; // half-side of territory square

    ctx.globalAlpha = 0.7;

    for (const k of positions.black) {
      const [x, y] = k.split(',').map(Number);
      const { px, py } = this.toPixel(x, y);
      ctx.fillStyle = '#111';
      ctx.fillRect(px - s, py - s, s * 2, s * 2);
    }

    for (const k of positions.white) {
      const [x, y] = k.split(',').map(Number);
      const { px, py } = this.toPixel(x, y);
      ctx.fillStyle   = '#f0f0f0';
      ctx.fillRect(px - s, py - s, s * 2, s * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(px - s, py - s, s * 2, s * 2);
    }

    ctx.globalAlpha = 1.0;
  }

  // ─── Stones ──────────────────────────────────────────────────────────────────

  /**
   * Draw all stones, skipping the one currently being place-animated.
   */
  _drawStones(now) {
    const skipKey = this._placing ? this._placing.x + ',' + this._placing.y : null;
    const { board } = this;

    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const color = board.grid[y][x];
        if (!color) continue;
        if (skipKey === `${x},${y}`) continue;
        const isDead = board.deadStones.has(`${x},${y}`);
        this._drawStoneCore(x, y, color, isDead ? 0.22 : 1.0);
      }
    }
  }

  /** Draw a stone at its natural size with a given global alpha. */
  _drawStoneCore(x, y, color, alpha) {
    const { ctx }    = this;
    const { px, py } = this.toPixel(x, y);
    const r          = this.stoneRadius();

    ctx.globalAlpha = alpha;

    if (alpha > 0.5) {
      ctx.shadowColor   = 'rgba(0,0,0,0.38)';
      ctx.shadowBlur    = 7;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 2.5;
    }

    const grad = ctx.createRadialGradient(px - r * 0.32, py - r * 0.36, r * 0.04, px, py, r);
    if (color === 'black') {
      grad.addColorStop(0, '#606060');
      grad.addColorStop(1, '#090909');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#c6c6c6');
    }

    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

    if (color === 'white') {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth   = 0.6;
      ctx.stroke();
    }

    ctx.globalAlpha = 1.0;
  }

  /** Draw a stone scaled relative to its natural radius (used for placement animation). */
  _drawStoneSized(x, y, color, scale) {
    const { ctx }    = this;
    const { px, py } = this.toPixel(x, y);
    const r          = this.stoneRadius() * scale;

    ctx.shadowColor   = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur    = 6 * scale;
    ctx.shadowOffsetX = scale;
    ctx.shadowOffsetY = 2 * scale;

    const grad = ctx.createRadialGradient(px - r * 0.32, py - r * 0.36, r * 0.04, px, py, r);
    if (color === 'black') {
      grad.addColorStop(0, '#606060');
      grad.addColorStop(1, '#090909');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#c6c6c6');
    }

    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

    if (color === 'white') {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth   = 0.6;
      ctx.stroke();
    }
  }

  // ─── Markers ─────────────────────────────────────────────────────────────────

  _drawLastMoveMarker() {
    const { ctx, board } = this;
    if (!board.lastMove) return;
    const { x, y } = board.lastMove;
    const color = board.grid[y][x];
    if (!color) return;
    const { px, py } = this.toPixel(x, y);
    ctx.fillStyle = color === 'black' ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.arc(px, py, this.stoneRadius() * 0.27, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawKoMarker() {
    const { ctx, board } = this;
    if (!board.koPoint) return;
    const { px, py } = this.toPixel(board.koPoint.x, board.koPoint.y);
    const half = this.cellSize * 0.28;
    ctx.strokeStyle = 'rgba(192,57,43,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(px - half, py - half, half * 2, half * 2);
  }

  // ─── Hover Ghost ─────────────────────────────────────────────────────────────

  drawHoverStone(x, y, color) {
    if (!this.board.inBounds(x, y) || this.board.grid[y][x]) return;
    const { px, py } = this.toPixel(x, y);
    const r = this.stoneRadius();
    this.ctx.globalAlpha = 0.3;
    this.ctx.beginPath();
    this.ctx.arc(px, py, r, 0, Math.PI * 2);
    this.ctx.fillStyle   = color === 'black' ? '#090909' : '#f0f0f0';
    this.ctx.strokeStyle = color === 'black' ? 'transparent' : 'rgba(0,0,0,0.2)';
    this.ctx.lineWidth   = 0.6;
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.globalAlpha = 1.0;
  }
}
