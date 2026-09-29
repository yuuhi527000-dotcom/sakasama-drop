// =============================================
//  操作（PCキー・スマホボタン）と効果音
// =============================================
(function () {
  const C = SG.CONFIG;

  class Input {
    constructor() {
      this.held = { left: false, right: false, down: false };
      this.dir = 0; this.das = 0; this.enabled = false; this.handlers = {};
      this.bindKeys();
    }
    on(ev, fn) { this.handlers[ev] = fn; }
    fire(ev, a) { if (this.handlers[ev]) this.handlers[ev](a); }
    act(ev, a) { if (this.enabled) this.fire(ev, a); }

    press(k) {
      if (k === 'left' || k === 'right') {
        if (this.held[k]) return;
        this.held[k] = true;
        this.dir = k === 'left' ? -1 : 1;
        this.das = -C.DAS;
        this.act('move', this.dir);
      } else if (k === 'down') this.held.down = true;
      else if (k === 'rotateR') this.act('rotate', 1);
      else if (k === 'rotateL') this.act('rotate', -1);
      else if (k === 'hard') this.act('hard');
      else if (k === 'skill') this.act('skill', 'opp');
      else if (k === 'skillSelf') this.act('skill', 'self');
    }
    release(k) {
      if (!(k in this.held)) return;
      this.held[k] = false;
      if (k === 'left' || k === 'right') {
        const other = k === 'left' ? 'right' : 'left';
        this.dir = this.held[other] ? (other === 'left' ? -1 : 1) : 0;
        this.das = -C.DAS;
      }
    }
    releaseAll() { for (const k in this.held) this.held[k] = false; this.dir = 0; }
    update(dt) {
      if (this.dir === 0) return;
      this.das += dt;
      while (this.das >= 0) { this.act('move', this.dir); this.das -= C.ARR; }
    }
    get softDrop() { return this.enabled && this.held.down; }

    bindKeys() {
      const map = {
        ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'hard',
        ' ': 'rotateR', Spacebar: 'rotateR', x: 'rotateR', X: 'rotateR',
        z: 'rotateL', Z: 'rotateL', Shift: 'skill', c: 'skillSelf', C: 'skillSelf'
      };
      window.addEventListener('keydown', e => {
        if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { this.fire('pause'); return; }
        const k = map[e.key];
        if (!k) return;
        e.preventDefault();
        if (e.repeat) return;
        this.press(k);
      });
      window.addEventListener('keyup', e => { const k = map[e.key]; if (k) { e.preventDefault(); this.release(k); } });
      window.addEventListener('blur', () => this.releaseAll());
    }
    bindButtons(root) {
      root.querySelectorAll('[data-key]').forEach(btn => {
        const k = btn.dataset.key;
        const down = e => { e.preventDefault(); btn.classList.add('on'); try { btn.setPointerCapture(e.pointerId); } catch (_) {} this.press(k); };
        const up = e => { e.preventDefault(); btn.classList.remove('on'); this.release(k); };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
        btn.addEventListener('contextmenu', e => e.preventDefault());
      });
    }
  }

  // ---- スワイプ操作（なぞって移動・タップで回転） ----
  Input.prototype.bindSwipe = function (el) {
    this.mode = 'button';
    this.stepPx = 36;
    let id = null, sx = 0, sy = 0, ax = 0, t0 = 0, moved = false;
    el.addEventListener('pointerdown', e => {
      // ボタン表示でも、盤面をなぞる・タップする操作はいつでも使える
      if (id !== null) return;
      if (e.target.closest('button')) return;
      e.preventDefault();
      id = e.pointerId; sx = ax = e.clientX; sy = e.clientY; t0 = performance.now(); moved = false;
      try { el.setPointerCapture(id); } catch (_) {}
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const step = this.stepPx;
      let dx = e.clientX - ax;
      while (dx >= step) { this.act('move', 1); ax += step; dx -= step; moved = true; }
      while (dx <= -step) { this.act('move', -1); ax -= step; dx += step; moved = true; }
      const dy = e.clientY - sy;
      const down = dy > step * 0.8 && dy > Math.abs(e.clientX - sx);
      if (down) moved = true;
      this.held.down = down;
    });
    const end = e => {
      if (e.pointerId !== id) return;
      id = null; this.held.down = false;
      const dist = Math.hypot(e.clientX - sx, e.clientY - sy);
      // 下にさっとはじく → 一気に落とす
      const fdy = e.clientY - sy, dur = performance.now() - t0;
      if (fdy > this.stepPx * 1.2 && dur < 260 && fdy > Math.abs(e.clientX - sx) * 1.5) { this.act('hard'); return; }
      if (!moved && dist < 14 && performance.now() - t0 < 350) {
        this.act('rotate', e.clientX < window.innerWidth / 2 ? -1 : 1);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  // ---- スマホで連打したときの拡大（ダブルタップ・ピンチ）を止める ----
  (function preventZoom() {
    let lastTouch = 0;
    const inPlay = t => t && t.closest && t.closest('#game') && !t.closest('.dialog');
    document.addEventListener('touchend', e => {
      const now = Date.now();
      // ゲーム画面で0.35秒以内の2回目のタップは、ブラウザの拡大に使わせない
      if (inPlay(e.target) && now - lastTouch < 350) {
        e.preventDefault();
        // 拡大は止めつつ、一時停止などの普通のボタンはちゃんと押せるようにする
        const btn = e.target.closest('button:not([data-key])');
        if (btn) btn.click();
      }
      lastTouch = now;
    }, { passive: false });
    document.addEventListener('touchmove', e => {
      if (inPlay(e.target) || e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    document.addEventListener('dblclick', e => { if (inPlay(e.target)) e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  })();

  // 効果音（ファイル不要。ブラウザで音を合成）
  const Sound = {
    ctx: null, on: true,
    init() {
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
      // iPhoneのマナーモード中は鳴らさない
      try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) {}
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, dur, type = 'sine', vol = 0.15, slide = 0, delay = 0) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    move() { this.tone(520, 0.03, 'sine', 0.04); },
    rotate() { this.tone(760, 0.05, 'triangle', 0.06); },
    lock() { this.tone(170, 0.07, 'square', 0.04); },
    pop(chain) {
      const f = 392 * Math.pow(1.122, Math.min(chain, 12) - 1);
      this.tone(f, 0.22, 'triangle', 0.16); this.tone(f * 1.5, 0.16, 'sine', 0.07, 0, 0.04);
    },
    hard() { this.tone(240, 0.09, 'square', 0.06, -120); },
    garbage() { this.tone(110, 0.25, 'square', 0.07, -40); },
    skill() { this.tone(300, 0.35, 'sawtooth', 0.07, 900); this.tone(600, 0.3, 'triangle', 0.06, 900, 0.08); },
    flip() { this.tone(1200, 0.55, 'sawtooth', 0.06, -1000); },
    ready() { this.tone(880, 0.12, 'sine', 0.08); this.tone(1320, 0.18, 'sine', 0.08, 0, 0.1); },
    count() { this.tone(660, 0.1, 'sine', 0.08); },
    go() { this.tone(990, 0.25, 'triangle', 0.1); },
    win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.1, 0, i * 0.11)); },
    lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.1, 0, i * 0.16)); }
  };

  SG.Input = Input;
  SG.Sound = Sound;
})();
