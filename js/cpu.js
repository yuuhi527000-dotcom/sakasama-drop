// =============================================
//  CPU（よわい／ふつう／つよい）
// =============================================
(function () {
  const C = SG.CONFIG;
  const DX = SG.Player.DX;

  const LEVELS = {
    easy:   { think: 520, step: 260, soft: false, fireAt: 1, noise: 14, random: 0.12, depth: 1, potential: false, skillWait: [1500, 5000] },
    normal: { think: 320, step: 150, soft: true,  fireAt: 3, noise: 10, random: 0,    depth: 1, potential: true,  skillWait: [600, 2500] },
    hard:   { think: 170, step: 90,  soft: true,  fireAt: 5, noise: 0,  random: 0,    depth: 2, potential: true,  skillWait: [0, 400] }
  };

  // 置ける場所の一覧（途中の列が高すぎて運べない場所は除く）
  function placements(b) {
    const res = [];
    for (let rot = 0; rot < 4; rot++) for (let x = 0; x < C.COLS; x++) {
      const cx = x + DX[rot];
      if (cx < 0 || cx >= C.COLS) continue;
      const lo = Math.min(C.SPAWN_X, x, cx), hi = Math.max(C.SPAWN_X, x, cx);
      let ok = true;
      for (let i = lo; i <= hi; i++) if (b.get(i, C.HIDDEN) !== 0) { ok = false; break; }
      if (ok) res.push({ x, rot });
    }
    return res;
  }

  function place(board, x, rot, colors) {
    const b = board.clone();
    const cx = x + DX[rot];
    const order = rot === 2 ? [[cx, colors[1]], [x, colors[0]]] : [[x, colors[0]], [cx, colors[1]]];
    for (const [px, c] of order) {
      const y = b.dropY(px);
      if (y < 0) return null;
      b.set(px, y, c);
    }
    return b;
  }

  function hasNeighbor(b, x, y, c) {
    return b.get(x - 1, y) === c || b.get(x + 1, y) === c || b.get(x, y + 1) === c ||
           b.get(x - 1, y - 1) === c || b.get(x + 1, y - 1) === c;
  }

  // 「あと1〜2個で何連鎖できるか」＝連鎖の仕込み具合
  function potential(board) {
    let best = 0;
    for (let x = 0; x < C.COLS; x++) {
      const y = board.dropY(x);
      if (y < C.HIDDEN) continue;
      for (let c = 1; c <= C.COLORS; c++) {
        if (!hasNeighbor(board, x, y, c)) continue;
        for (let k = 1; k <= 2; k++) {
          const b = board.clone();
          let ok = true;
          for (let i = 0; i < k; i++) { const yy = b.dropY(x); if (yy < 0) { ok = false; break; } b.set(x, yy, c); }
          if (!ok) break;
          const r = b.resolveAll();
          if (r.chains > best) best = r.chains;
          if (r.chains > 0) break;
        }
      }
    }
    return best;
  }

  function shape(b) {
    let s = 0;
    const hs = [];
    for (let x = 0; x < C.COLS; x++) hs.push(b.height(x));
    let bump = 0;
    for (let x = 0; x < C.COLS - 1; x++) bump += Math.abs(hs[x] - hs[x + 1]);
    s -= bump * 2;
    const mh = Math.max(...hs);
    if (mh >= 9) s -= (mh - 8) * 25;
    if (hs[C.SPAWN_X] >= 8) s -= (hs[C.SPAWN_X] - 7) * 60;
    for (const g of b.findGroups(2)) s += g.cells.length === 2 ? 4 : 10;
    return s;
  }

  function evalBoard(b, L) {
    let v = shape(b);
    if (L.potential) { const p = potential(b); v += p * p * 14; }
    return v;
  }

  class Cpu {
    constructor(player, opponent, level) {
      this.player = player; this.opp = opponent;
      this.level = level; this.L = LEVELS[level] || LEVELS.normal;
      this.plan = null;
      this.skillWait = null; this.skillHold = 0; this.oppCheck = 0; this.oppPot = 0; this.oppH = 0;
    }

    isDanger(b) {
      return b.maxHeight() >= 10 || b.height(C.SPAWN_X) >= 9 || this.player.pendingGarbage >= 18;
    }

    fireValue(r, danger, oppWeak) {
      if (r.chains === 0) return 0;
      const need = danger ? 1 : (oppWeak ? 2 : this.L.fireAt);
      if (r.chains >= need) return 400 + r.chains * 150 + r.score / 15;
      return -40 * r.chains;
    }

    think() {
      const p = this.player, L = this.L, b = p.board, pair = p.piece.colors;
      const pls = placements(b);
      if (!pls.length) return { x: p.piece.x, rot: p.piece.rot };
      if (L.random > 0 && Math.random() < L.random) return pls[Math.floor(Math.random() * pls.length)];
      const danger = this.isDanger(b);
      const oppWeak = this.opp.board.maxHeight() >= 9;
      const cands = [];
      for (const pl of pls) {
        const nb = place(b, pl.x, pl.rot, pair);
        if (!nb) continue;
        const r = nb.resolveAll();
        const fv = this.fireValue(r, danger, oppWeak);
        const ev = nb.isDead() ? -1e6 : evalBoard(nb, L);
        cands.push({ pl, nb, fv, v: fv + ev + (Math.random() - 0.5) * L.noise * 2 });
      }
      if (!cands.length) return pls[0];
      cands.sort((a, b2) => b2.v - a.v);
      if (L.depth < 2) return cands[0].pl;

      // つよい：次のつぶまで読む
      const nextPair = p.pairs.get(p.pairIndex);
      let best = cands[0], bestV = -Infinity;
      for (const c of cands.slice(0, 5)) {
        if (c.v < -1e5) continue;
        const d2 = this.isDanger(c.nb);
        let m = -Infinity;
        for (const pl2 of placements(c.nb)) {
          const nb2 = place(c.nb, pl2.x, pl2.rot, nextPair);
          if (!nb2) continue;
          const r2 = nb2.resolveAll();
          const v2 = (nb2.isDead() ? -1e6 : evalBoard(nb2, L)) + this.fireValue(r2, d2, oppWeak) * 0.9;
          if (v2 > m) m = v2;
        }
        const total = m === -Infinity ? c.v : c.fv + m;
        if (total > bestV) { bestV = total; best = c; }
      }
      return best.pl;
    }

    updateSkill(dt) {
      const p = this.player;
      if (p.gauge < C.SKILL_GAUGE_MAX) { this.skillWait = null; return; }
      if (this.skillWait === null) {
        const [a, b] = this.L.skillWait;
        this.skillWait = a + Math.random() * (b - a);
        this.skillHold = 0;
      }
      this.skillWait -= dt;
      if (this.skillWait > 0) return;
      // ピンチなら「自分に」使って守る（反転で連鎖が起きて、いしを消せる／低くできる場合）
      if (this.level !== 'easy') {
        const b = p.board.clone(); b.flipRaw(); const r = b.resolveAll();
        const pinch = this.isDanger(p.board) || p.pendingGarbage >= 6;
        if (pinch && r.chains >= 1) { p.useSkill('self'); this.skillWait = null; return; }
      }
      if (this.level === 'hard') {
        // 相手が連鎖を仕込んだ／積み上がったタイミングを狙う（最大15秒待つ）
        this.skillHold += dt; this.oppCheck -= dt;
        if (this.oppCheck <= 0) { this.oppCheck = 800; this.oppPot = potential(this.opp.board); this.oppH = this.opp.board.maxHeight(); }
        if (this.oppPot < 3 && this.oppH < 7 && this.skillHold < 15000) return;
      }
      p.useSkill();
      this.skillWait = null;
    }

    update(dt) {
      const p = this.player;
      if (p.dead) return;
      this.updateSkill(dt);
      if (p.phase !== 'control' || !p.piece) { p.softDrop = false; return; }
      const key = p.pieceId + ':' + p.flipCount;
      if (!this.plan || this.plan.key !== key) {
        this.plan = { key, target: null, delay: this.L.think * (0.7 + Math.random() * 0.6), stepT: 0 };
        p.softDrop = false;
      }
      const pl = this.plan;
      if (!pl.target) {
        pl.delay -= dt;
        if (pl.delay > 0) return;
        pl.target = this.think();
      }
      pl.stepT -= dt;
      if (pl.stepT > 0) return;
      pl.stepT = this.L.step;
      const pc = p.piece;
      if (pc.rot !== pl.target.rot) { if (!p.rotate()) pl.target = { x: pc.x, rot: pc.rot }; return; }
      if (pc.x !== pl.target.x) { if (!p.move(pl.target.x > pc.x ? 1 : -1)) pl.target = { x: pc.x, rot: pc.rot }; return; }
      p.softDrop = this.L.soft;
    }
  }

  SG.Cpu = Cpu;
  SG.CpuUtil = { potential, placements, place };
})();
