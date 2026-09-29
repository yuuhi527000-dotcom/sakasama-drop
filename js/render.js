// =============================================
//  描画（つぶの見た目・盤面・つぎ表示）
// =============================================
(function () {
  const C = SG.CONFIG;
  const G = () => SG.GARBAGE;

  // つぶの色と印（色が見分けにくい人でも印で分かる）
  const PALETTE = {
    1: { base: '#ff4f6d', light: '#ffb0bd', dark: '#b01839', sym: 'heart' },  // いちご
    2: { base: '#3d8dff', light: '#a9d0ff', dark: '#1a4cb5', sym: 'drop' },   // ソーダ
    3: { base: '#2fd07a', light: '#a6f5c8', dark: '#12844a', sym: 'leaf' },   // メロン
    4: { base: '#ffc531', light: '#fff0a8', dark: '#c7860a', sym: 'star' },   // レモン
    5: { base: '#b16cff', light: '#e0c4ff', dark: '#6b2fc0', sym: 'moon' }    // ぶどう
  };
  SG.PALETTE = PALETTE;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function symbol(ctx, sym, cx, cy, r) {
    ctx.beginPath();
    switch (sym) {
      case 'heart':
        ctx.moveTo(cx, cy + r * 0.9);
        ctx.bezierCurveTo(cx - r * 1.4, cy - r * 0.1, cx - r * 0.6, cy - r * 1.2, cx, cy - r * 0.4);
        ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.2, cx + r * 1.4, cy - r * 0.1, cx, cy + r * 0.9);
        break;
      case 'drop':
        ctx.moveTo(cx, cy - r * 1.1);
        ctx.bezierCurveTo(cx + r * 0.9, cy - r * 0.1, cx + r * 0.9, cy + r * 0.9, cx, cy + r * 0.9);
        ctx.bezierCurveTo(cx - r * 0.9, cy + r * 0.9, cx - r * 0.9, cy - r * 0.1, cx, cy - r * 1.1);
        break;
      case 'leaf':
        ctx.moveTo(cx - r, cy + r * 0.8);
        ctx.quadraticCurveTo(cx - r, cy - r, cx + r, cy - r * 0.9);
        ctx.quadraticCurveTo(cx + r * 0.9, cy + r * 0.9, cx - r, cy + r * 0.8);
        break;
      case 'star':
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.45 : r * 1.05;
          const px = cx + Math.cos(a) * rr2, py = cy + Math.sin(a) * rr2;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        break;
      case 'moon':
        ctx.arc(cx, cy, r, Math.PI * 0.25, Math.PI * 1.75, false);
        ctx.arc(cx + r * 0.45, cy, r * 0.72, Math.PI * 1.6, Math.PI * 0.4, true);
        ctx.closePath();
        break;
    }
    ctx.fill();
  }

  // つぶ1個を描く（x,y は左上のピクセル、s はマスの大きさ）
  SG.drawBlob = function (ctx, x, y, s, c, alpha = 1, scale = 1) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    const size = s * 0.9 * scale, cx = x + s / 2, cy = y + s / 2;
    const l = cx - size / 2, t = cy - size / 2, r = size * 0.36;
    if (c === G()) {
      const g = ctx.createLinearGradient(l, t, l, t + size);
      g.addColorStop(0, '#b9b4d6'); g.addColorStop(1, '#6b6690');
      rr(ctx, l, t, size, size, r * 0.8); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.05); ctx.strokeStyle = '#453f66'; ctx.stroke();
      ctx.fillStyle = 'rgba(40,34,70,0.55)';
      ctx.beginPath(); ctx.arc(cx - size * 0.16, cy + size * 0.1, size * 0.08, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + size * 0.18, cy - size * 0.05, size * 0.06, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + size * 0.05, cy + size * 0.22, size * 0.045, 0, 7); ctx.fill();
      ctx.restore();
      return;
    }
    const d = PALETTE[c];
    if (!d) { ctx.restore(); return; }
    const g = ctx.createLinearGradient(l, t, l + size * 0.6, t + size);
    g.addColorStop(0, d.light); g.addColorStop(0.45, d.base); g.addColorStop(1, d.dark);
    rr(ctx, l, t, size, size, r); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.045); ctx.strokeStyle = d.dark; ctx.stroke();
    // つやの光
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(l + size * 0.33, t + size * 0.24, size * 0.2, size * 0.09, -0.45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(l + size * 0.7, t + size * 0.2, size * 0.045, 0, 7); ctx.fill();
    // 印
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    symbol(ctx, d.sym, cx, cy + size * 0.07, size * 0.17);
    ctx.restore();
  };

  // 同じ色どうしをつなぐ「ブリッジ」
  function bridge(ctx, x1, y1, x2, y2, s, c) {
    const d = PALETTE[c]; if (!d) return;
    const w = s * 0.5;
    ctx.fillStyle = d.base;
    if (y1 === y2) ctx.fillRect(Math.min(x1, x2) + s / 2, y1 + s / 2 - w / 2, s, w);
    else ctx.fillRect(x1 + s / 2 - w / 2, Math.min(y1, y2) + s / 2, w, s);
  }

  class BoardView {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.cell = 20; }
    resize(cell) {
      this.cell = cell;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = C.COLS * cell, h = (C.ROWS - C.HIDDEN + 0.5) * cell;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = w; this.h = h;
    }
    yToPx(y) { return (y - C.HIDDEN + 0.5) * this.cell; }

    draw(pl, now, opt = {}) {
      const ctx = this.ctx, s = this.cell, W = this.w, H = this.h;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#2a2160'); bg.addColorStop(1, '#140f33');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // マス目
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      for (let y = C.HIDDEN; y < C.ROWS; y++) for (let x = 0; x < C.COLS; x++)
        if ((x + y) % 2 === 0) ctx.fillRect(x * s, this.yToPx(y), s, s);
      // 見えない段との境目
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, s * 0.5);
      // 負けライン（×）
      const dx = C.SPAWN_X * s, dy = this.yToPx(C.HIDDEN), m = s * 0.3;
      ctx.strokeStyle = 'rgba(255,95,130,0.45)'; ctx.lineWidth = Math.max(1.5, s * 0.08); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(dx + m, dy + m); ctx.lineTo(dx + s - m, dy + s - m);
      ctx.moveTo(dx + s - m, dy + m); ctx.lineTo(dx + m, dy + s - m); ctx.stroke();
      if (!pl) return;

      const a = pl.anim;
      ctx.save();
      if (a && a.type === 'flip') {
        const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2;
        let k = Math.cos(Math.PI * e); if (Math.abs(k) < 0.02) k = 0.02;
        ctx.translate(0, H / 2); ctx.scale(1, k); ctx.translate(0, -H / 2);
      }
      const off = new Map();
      let popSet = null, popT = 0;
      if (a && a.type === 'fall') {
        // 本家と同じ物理で落とす（1マス=16ドット）
        const frames = a.t * a.dur / C.FRAME;
        for (const mv of a.moves) {
          const px = (mv.to - mv.from) * 16;
          const fallen = a.garbage ? SG.fallPx(frames, 0, C.GARBAGE_ACC[mv.x]) : SG.fallPx(frames, C.FALL_V0, C.FALL_ACC);
          off.set(mv.to * C.COLS + mv.x, Math.max(0, px - fallen) / 16);
        }
      }
      if (a && a.type === 'pop') { popSet = a.cells; popT = a.t; }

      const b = pl.board, cells = b.cells;
      // ブリッジ
      for (let y = C.HIDDEN; y < C.ROWS; y++) for (let x = 0; x < C.COLS; x++) {
        const i = y * C.COLS + x, v = cells[i];
        if (v === 0 || v === G() || off.has(i)) continue;
        const alpha = popSet && popSet.has(i) && popT > 0.7 ? 0 : 1;
        if (!alpha) continue;
        if (x < C.COLS - 1 && cells[i + 1] === v && !off.has(i + 1)) bridge(ctx, x * s, this.yToPx(y), (x + 1) * s, this.yToPx(y), s, v);
        if (y < C.ROWS - 1 && cells[i + C.COLS] === v && !off.has(i + C.COLS)) bridge(ctx, x * s, this.yToPx(y), x * s, this.yToPx(y + 1), s, v);
      }
      // つぶ
      for (let y = 0; y < C.ROWS; y++) for (let x = 0; x < C.COLS; x++) {
        const i = y * C.COLS + x, v = cells[i];
        if (v === 0) continue;
        const py = this.yToPx(y) - (off.get(i) || 0) * s;
        let alpha = 1, sc = 1;
        if (popSet && popSet.has(i)) {
          alpha = 0.45 + 0.55 * Math.abs(Math.cos(popT * Math.PI * 3.5));
          if (popT > 0.7) { const q = (popT - 0.7) / 0.3; sc = 1 + q * 0.35; alpha = 1 - q; }
        }
        // ぷにっと弾む：つぶれて→少し伸びて→戻る
        let sq = 0;
        if (pl.squash && pl.squash.cells.has(i)) { const k = 1 - pl.squash.t / pl.squash.dur; sq = Math.sin(k * Math.PI * 2) * (1 - k); }
        if (sq !== 0) {
          // 着地でぷにっとつぶれる
          ctx.save(); ctx.translate(x * s + s / 2, py + s * 0.95); ctx.scale(1 + 0.14 * sq, 1 - 0.2 * sq);
          SG.drawBlob(ctx, -s / 2, -s * 0.95, s, v, alpha, sc); ctx.restore();
        } else SG.drawBlob(ctx, x * s, py, s, v, alpha, sc);
      }
      // 操作中のつぶ（子つぶは軸のまわりをくるっと回る）
      if (pl.piece) {
        const p = pl.piece, active = pl.phase === 'control';
        const fy = p.y + pl.fallProgress();
        const ang = pl.childAngle() * Math.PI / 180;
        const al = active ? 1 : 0.4;
        SG.drawBlob(ctx, p.x * s, this.yToPx(fy), s, p.colors[0], al);
        SG.drawBlob(ctx, (p.x + Math.cos(ang)) * s, this.yToPx(fy + Math.sin(ang)), s, p.colors[1], al);
      }
      ctx.restore();

      // 文字演出
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (pl.chainLabel) {
        const t = pl.chainLabel.t / 1100, pop = t > 0.85 ? 1 + (t - 0.85) * 3 : 1;
        ctx.save(); ctx.globalAlpha = Math.min(1, t * 3);
        ctx.font = `900 ${Math.round(s * 0.95 * pop)}px "M PLUS Rounded 1c", system-ui, sans-serif`;
        ctx.lineWidth = s * 0.18; ctx.strokeStyle = '#1b1240'; ctx.lineJoin = 'round';
        const txt = pl.chainLabel.n + 'れんさ！', ty = H * 0.42 - (1 - t) * s;
        ctx.strokeText(txt, W / 2, ty); ctx.fillStyle = '#fff36b'; ctx.fillText(txt, W / 2, ty);
        ctx.restore();
      }
      if (pl.flipLabel > 0) {
        const t = pl.flipLabel / 1400;
        ctx.save(); ctx.globalAlpha = Math.min(1, t * 2.5);
        ctx.font = `900 ${Math.round(s * 1.05)}px "M PLUS Rounded 1c", system-ui, sans-serif`;
        ctx.lineWidth = s * 0.2; ctx.strokeStyle = '#1b1240'; ctx.lineJoin = 'round';
        ctx.strokeText('さかさま！', W / 2, H * 0.24); ctx.fillStyle = '#6ef0ff'; ctx.fillText('さかさま！', W / 2, H * 0.24);
        ctx.restore();
      }
      if (pl.flipReserved && pl.phase !== 'anim' && !pl.dead) {
        const blink = 0.85 + 0.15 * Math.sin(now / 150);
        ctx.save(); ctx.globalAlpha = blink;
        ctx.font = `900 ${Math.round(Math.max(9, s * 0.42))}px "M PLUS Rounded 1c", system-ui, sans-serif`;
        const label = 'さかさま予約中', tw = ctx.measureText(label).width + s * 0.6, th = s * 0.62;
        ctx.fillStyle = 'rgba(88,230,255,0.9)';
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W / 2 - tw / 2, s * 0.62, tw, th, th / 2) : ctx.rect(W / 2 - tw / 2, s * 0.62, tw, th); ctx.fill();
        ctx.fillStyle = '#0c3c4d'; ctx.fillText(label, W / 2, s * 0.62 + th / 2 + 1);
        ctx.restore();
      }
      if (pl.allClearLabel > 0) {
        const t = pl.allClearLabel / 1600;
        ctx.save(); ctx.globalAlpha = Math.min(1, t * 2.5);
        ctx.font = `900 ${Math.round(s * 1.0)}px "M PLUS Rounded 1c", system-ui, sans-serif`;
        ctx.lineWidth = s * 0.2; ctx.strokeStyle = '#1b1240'; ctx.lineJoin = 'round';
        ctx.strokeText('ぜんけし！', W / 2, H * 0.55); ctx.fillStyle = '#9dffb8'; ctx.fillText('ぜんけし！', W / 2, H * 0.55);
        ctx.restore();
      }
      if (pl.cancelLabel > 0) {
        const t = pl.cancelLabel / 1600, sc = t > 0.85 ? 1 + (t - 0.85) * 4 : 1;
        ctx.save(); ctx.globalAlpha = Math.min(1, t * 2.5);
        ctx.font = `900 ${Math.round(s * 1.0 * sc)}px "M PLUS Rounded 1c", system-ui, sans-serif`;
        ctx.lineWidth = s * 0.2; ctx.strokeStyle = '#1b1240'; ctx.lineJoin = 'round';
        ctx.strokeText('うちけし！', W / 2, H * 0.24); ctx.fillStyle = '#ffe45e'; ctx.fillText('うちけし！', W / 2, H * 0.24);
        ctx.restore();
      }
      if (pl.marginLabel > 0 && pl.flipLabel <= 0) {
        const t = pl.marginLabel / 1400;
        ctx.save(); ctx.globalAlpha = Math.min(1, t * 2.5);
        ctx.font = `900 ${Math.round(s * 0.7)}px "M PLUS Rounded 1c", system-ui, sans-serif`;
        ctx.lineWidth = s * 0.16; ctx.strokeStyle = '#1b1240'; ctx.lineJoin = 'round';
        ctx.strokeText('こうげきアップ！', W / 2, H * 0.3); ctx.fillStyle = '#ff9cc7'; ctx.fillText('こうげきアップ！', W / 2, H * 0.3);
        ctx.restore();
      }
      if (pl.dead) {
        ctx.fillStyle = 'rgba(10,6,30,0.6)'; ctx.fillRect(0, 0, W, H);
      }
    }
  }

  class NextView {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); }
    resize(cell) {
      this.cell = cell;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = cell * 2.3, h = cell * 2.6;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = w; this.h = h;
    }
    draw(pl) {
      const ctx = this.ctx, s = this.cell;
      ctx.clearRect(0, 0, this.w, this.h);
      if (!pl) return;
      const [p1, p2] = pl.nextPairs();
      SG.drawBlob(ctx, s * 0.1, s * 0.3, s, p1[1]);
      SG.drawBlob(ctx, s * 0.1, s * 1.3, s, p1[0]);
      const s2 = s * 0.7;
      SG.drawBlob(ctx, s * 1.4, s * 0.9, s2, p2[1], 0.85);
      SG.drawBlob(ctx, s * 1.4, s * 0.9 + s2, s2, p2[0], 0.85);
    }
  }

  SG.BoardView = BoardView;
  SG.NextView = NextView;
})();
