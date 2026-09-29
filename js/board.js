// =============================================
//  盤面のルール（落下・連鎖・反転・いし）
// =============================================
(function () {
  const C = SG.CONFIG;
  const GARBAGE = 9;
  // 連鎖ボーナス（1連鎖目=0）
  const CHAIN_POWER = [0, 0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672];
  const COLOR_BONUS = [0, 0, 3, 6, 12, 24];
  function groupBonus(n) { if (n <= 4) return 0; if (n >= 11) return 10; return n - 3; }

  class Board {
    constructor() {
      this.w = C.COLS; this.h = C.ROWS;
      this.cells = new Array(this.w * this.h).fill(0);
    }
    clone() { const b = new Board(); b.cells = this.cells.slice(); return b; }
    // 範囲外(左右・下)は -1、上の画面外は空(0)扱い
    get(x, y) {
      if (x < 0 || x >= this.w || y >= this.h) return -1;
      if (y < 0) return 0;
      return this.cells[y * this.w + x];
    }
    set(x, y, v) { this.cells[y * this.w + x] = v; }
    isFree(x, y) { return this.get(x, y) === 0; }
    // その列に落としたときに止まる段
    dropY(x) {
      for (let y = this.h - 1; y >= 0; y--) if (this.cells[y * this.w + x] === 0) return y;
      return -1;
    }
    height(x) {
      let n = 0;
      for (let y = this.h - 1; y >= 0; y--) { if (this.cells[y * this.w + x] !== 0) n++; else break; }
      return n;
    }
    maxHeight() { let m = 0; for (let x = 0; x < this.w; x++) m = Math.max(m, this.height(x)); return m; }

    // 重力：浮いているものを下へ詰める。動いたものを返す（演出用）
    applyGravity() {
      const moves = [];
      for (let x = 0; x < this.w; x++) {
        let wy = this.h - 1;
        for (let y = this.h - 1; y >= 0; y--) {
          const v = this.cells[y * this.w + x];
          if (v !== 0) {
            if (y !== wy) {
              this.cells[wy * this.w + x] = v;
              this.cells[y * this.w + x] = 0;
              moves.push({ x, from: y, to: wy });
            }
            wy--;
          }
        }
      }
      return moves;
    }

    // 同じ色のかたまりを探す（見えない段は数えない）
    findGroups(min = 4) {
      const w = this.w, h = this.h, cells = this.cells;
      const seen = new Uint8Array(w * h);
      const groups = [];
      for (let y = C.HIDDEN; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, v = cells[i];
        if (v === 0 || v === GARBAGE || seen[i]) continue;
        const stack = [i], g = []; seen[i] = 1;
        while (stack.length) {
          const j = stack.pop(); g.push(j);
          const jx = j % w, jy = (j / w) | 0;
          let k;
          if (jx > 0) { k = j - 1; if (!seen[k] && cells[k] === v) { seen[k] = 1; stack.push(k); } }
          if (jx < w - 1) { k = j + 1; if (!seen[k] && cells[k] === v) { seen[k] = 1; stack.push(k); } }
          if (jy > C.HIDDEN) { k = j - w; if (!seen[k] && cells[k] === v) { seen[k] = 1; stack.push(k); } }
          if (jy < h - 1) { k = j + w; if (!seen[k] && cells[k] === v) { seen[k] = 1; stack.push(k); } }
        }
        if (g.length >= min) groups.push({ color: v, cells: g });
      }
      return groups;
    }

    popGroups(groups) {
      const w = this.w;
      let count = 0, gb = 0;
      const colors = new Set();
      const toClear = new Set();
      for (const g of groups) {
        count += g.cells.length; colors.add(g.color); gb += groupBonus(g.cells.length);
        for (const i of g.cells) toClear.add(i);
      }
      // 隣の「いし」も消える
      for (const g of groups) for (const i of g.cells) {
        const x = i % w, y = (i / w) | 0;
        const nb = [];
        if (x > 0) nb.push(i - 1);
        if (x < w - 1) nb.push(i + 1);
        if (y > C.HIDDEN) nb.push(i - w);
        if (y < this.h - 1) nb.push(i + w);
        for (const k of nb) if (this.cells[k] === GARBAGE) toClear.add(k);
      }
      for (const i of toClear) this.cells[i] = 0;
      return { count, colorCount: colors.size, groupBonus: gb };
    }

    static stepScore(chain, info) {
      const cp = CHAIN_POWER[Math.min(chain, CHAIN_POWER.length - 1)];
      const cb = COLOR_BONUS[Math.min(info.colorCount, 5)];
      let m = cp + cb + info.groupBonus;
      if (m < 1) m = 1; if (m > 999) m = 999;
      return 10 * info.count * m;
    }

    // 演出なしで連鎖を最後まで進める（CPUの読み用）
    resolveAll() {
      let chains = 0, score = 0, popped = 0;
      this.applyGravity();
      for (;;) {
        const g = this.findGroups(4);
        if (!g.length) break;
        chains++;
        const info = this.popGroups(g);
        popped += info.count;
        score += Board.stepScore(chains, info);
        this.applyGravity();
      }
      return { chains, score, popped };
    }

    // 上下を反転するだけ（このあと重力で落ちる）
    flipRaw() {
      const n = new Array(this.cells.length);
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++)
        n[(this.h - 1 - y) * this.w + x] = this.cells[y * this.w + x];
      this.cells = n;
    }

    // 「いし」を降らせる
    addGarbage(n, rng) {
      const per = new Array(this.w).fill(Math.floor(n / this.w));
      const rem = n % this.w;
      const cols = [0, 1, 2, 3, 4, 5].slice(0, this.w);
      for (let i = cols.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cols[i], cols[j]] = [cols[j], cols[i]]; }
      for (let i = 0; i < rem; i++) per[cols[i]]++;
      const moves = [];
      for (let x = 0; x < this.w; x++) {
        for (let k = 0; k < per[x]; k++) {
          const y = this.dropY(x);
          if (y < 0) break;
          this.set(x, y, GARBAGE);
          moves.push({ x, from: y - this.h, to: y });
        }
      }
      return moves;
    }

    isDead() { return this.get(C.SPAWN_X, C.HIDDEN) !== 0; }
  }

  // 乱数（同じ種なら同じ並び → 対戦相手と同じ順番でつぶが出る）
  SG.makeRng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  SG.PairSource = class {
    constructor(seed) { this.rng = SG.makeRng(seed); this.list = []; }
    get(i) {
      while (this.list.length <= i) {
        // 最初の2組は3色までにして序盤を組みやすく
        const n = this.list.length < 2 ? Math.min(3, C.COLORS) : C.COLORS;
        this.list.push([1 + Math.floor(this.rng() * n), 1 + Math.floor(this.rng() * n)]);
      }
      return this.list[i];
    }
  };

  SG.Board = Board;
  SG.GARBAGE = GARBAGE;
})();
