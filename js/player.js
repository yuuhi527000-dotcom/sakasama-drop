// =============================================
//  プレイヤー1人分の進行（操作・固定・連鎖・いし・反転）
//  動きは本家「ぷよぷよ通」と同じ手触りになるようにしています
// =============================================
(function () {
  const C = SG.CONFIG;
  // 回転の向き：0=上 1=右 2=下 3=左（軸つぶから見た子つぶの位置）
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const ANGLE = [-90, 0, 90, 180];

  // 本家と同じ落下の物理（ドット単位。1マス=16ドット）
  function fallPx(frames, v0, acc) {
    let pos = 0, v = v0;
    const whole = Math.floor(frames);
    for (let i = 0; i < whole; i++) { pos += v; v = Math.min(C.FALL_VMAX, v + acc); }
    return pos + v * (frames - whole);
  }
  function fallFrames(px, v0, acc) {
    let pos = 0, v = v0, f = 0;
    while (pos < px && f < 600) { pos += v; v = Math.min(C.FALL_VMAX, v + acc); f++; }
    return f;
  }
  SG.fallPx = fallPx;

  class Player {
    constructor(opts) {
      this.pairs = opts.pairs;
      this.rng = SG.makeRng(opts.seed);
      this.onAttack = null; this.onSkill = null; this.onDead = null; this.listener = null;
      this.reset();
    }
    reset() {
      this.board = new SG.Board();
      this.pairIndex = 0; this.piece = null; this.pieceId = 0;
      this.phase = 'spawn'; this.timer = 0; this.anim = null; this.next = null;
      this.fallTimer = 0; this.groundTime = 0; this.pushbacks = 0; this.quickTurn = 0;
      this.score = 0; this.gauge = 0; this.carry = 0;
      this.pendingGarbage = 0; this.pendingFlip = 0; this.pendingSelfFlip = 0; this.flipCount = 0; this.flipChain = false; this.selfChain = false;
      this.chain = 0; this.maxChain = 0; this.chainLabel = null; this.flipLabel = 0; this.cancelLabel = 0;
      this.squash = null; this.allClearBonus = false; this.allClearLabel = 0;
      this.softDrop = false; this.dead = false;
      this.elapsed = 0; this.marginStep = 0; this.marginLabel = 0;
    }
    emit(ev, data) { if (this.listener) this.listener(ev, data); }

    // マージンタイム：96秒後に×0.75、その後16秒ごとに半分（最低1、最大14回）
    targetPoint() {
      let tp = C.TARGET_POINT;
      for (let i = 0; i < this.marginStep; i++) tp = Math.max(1, Math.floor(i === 0 ? tp * 0.75 : tp / 2));
      return tp;
    }

    // ---- つぶの位置 ----
    pieceCells(p = this.piece) {
      return [
        { x: p.x, y: p.y, c: p.colors[0] },
        { x: p.x + DX[p.rot], y: p.y + DY[p.rot], c: p.colors[1] }
      ];
    }
    fits(x, y, rot) {
      return this.board.isFree(x, y) && this.board.isFree(x + DX[rot], y + DY[rot]);
    }
    nextPairs() { return [this.pairs.get(this.pairIndex), this.pairs.get(this.pairIndex + 1)]; }

    // 回転の見た目（子つぶの角度。7コマかけて回る）
    childAngle() {
      const p = this.piece; if (!p) return 0;
      if (p.rotT > 0) return p.angTo - (p.angTo - p.angFrom) * (p.rotT / C.ROTATE_ANIM);
      return ANGLE[p.rot];
    }

    // ---- 外からの操作 ----
    move(dx) {
      if (this.phase !== 'control' || !this.piece) return false;
      const p = this.piece;
      if (this.fits(p.x + dx, p.y, p.rot)) { p.x += dx; return true; }
      return false;
    }
    setRot(nr, turn) {
      const p = this.piece;
      p.angFrom = this.childAngle();
      p.angTo = p.angFrom + turn;
      p.rotT = C.ROTATE_ANIM;
      p.rot = nr;
    }
    pushBack() {
      // 回転で床から押し上げられた回数。8回をこえると固定（本家と同じ）
      this.pushbacks++;
      if (this.pushbacks > C.MAX_PUSHBACK) { this.lock(); return false; }
      return true;
    }
    // dir: 1=右回り  -1=左回り
    rotate(dir = 1) {
      if (this.phase !== 'control' || !this.piece) return false;
      const p = this.piece;
      const nr = (p.rot + (dir < 0 ? 3 : 1)) % 4;
      const tries = [[0, 0]];
      if (nr === 1) tries.push([-1, 0]);      // 右が壁なら左へずらす
      else if (nr === 3) tries.push([1, 0]);  // 左が壁なら右へずらす
      else if (nr === 2) tries.push([0, -1]); // 下がつかえていたら持ち上げる
      for (const [ox, oy] of tries) {
        if (this.fits(p.x + ox, p.y + oy, nr)) {
          p.x += ox; p.y += oy; this.setRot(nr, dir < 0 ? -90 : 90);
          if (oy < 0 && !this.pushBack()) return true;
          return true;
        }
      }
      // 両側がふさがった縦穴：すばやく2回押すと上下が入れ替わる（クイックターン）
      if (p.rot === 0 || p.rot === 2) {
        if (this.quickTurn > 0) {
          this.quickTurn = 0;
          const qr = (p.rot + 2) % 4;
          for (const [ox, oy] of [[0, 0], [0, -1]]) {
            if (this.fits(p.x + ox, p.y + oy, qr)) {
              p.x += ox; p.y += oy; this.setRot(qr, dir < 0 ? -180 : 180);
              if (oy < 0) this.pushBack();
              return true;
            }
          }
        } else this.quickTurn = C.QUICKTURN_WINDOW;
      }
      return false;
    }
    // 一気に落とす（本家にはない追加操作）
    hardDrop() {
      if (this.phase !== 'control' || !this.piece) return false;
      const p = this.piece;
      let n = 0;
      while (this.fits(p.x, p.y + 1, p.rot)) { p.y++; n++; }
      this.score += n;
      this.emit('harddrop');
      this.lock();
      return true;
    }
    // なめらかに落ちて見えるように、次のマスまでの進み具合（0〜1）
    fallProgress() {
      const p = this.piece;
      if (this.phase !== 'control' || !p || !this.fits(p.x, p.y + 1, p.rot)) return 0;
      const interval = this.softDrop ? C.SOFT_DROP_INTERVAL : C.FALL_INTERVAL;
      return Math.min(0.999, this.fallTimer / interval);
    }
    setSquash(indices, dur) { if (indices.length) this.squash = { cells: new Set(indices), t: dur, dur }; }

    // target: 'opp'=相手に（邪魔）  'self'=自分に（守り：攻撃なし、降る予定のいしは消せる）
    useSkill(target = 'opp') {
      if (this.dead || this.gauge < C.SKILL_GAUGE_MAX) return false;
      this.gauge = 0;
      this.emit('skill', { target });
      if (target === 'self') this.pendingSelfFlip++;
      else if (this.onSkill) this.onSkill();
      return true;
    }
    get flipReserved() { return this.pendingFlip + this.pendingSelfFlip > 0; }
    receiveGarbage(n) { this.pendingGarbage += n; }
    receiveFlip() { this.pendingFlip++; }

    // ---- 毎フレームの更新 ----
    update(dt) {
      if (this.dead) return;
      if (this.chainLabel) { this.chainLabel.t -= dt; if (this.chainLabel.t <= 0) this.chainLabel = null; }
      if (this.flipLabel > 0) this.flipLabel -= dt;
      if (this.cancelLabel > 0) this.cancelLabel -= dt;
      if (this.allClearLabel > 0) this.allClearLabel -= dt;
      if (this.marginLabel > 0) this.marginLabel -= dt;
      if (this.quickTurn > 0) this.quickTurn -= dt;
      if (this.squash) { this.squash.t -= dt; if (this.squash.t <= 0) this.squash = null; }
      if (this.piece && this.piece.rotT > 0) this.piece.rotT = Math.max(0, this.piece.rotT - dt);
      this.elapsed += dt;
      if (this.elapsed >= C.MARGIN_TIME) {
        const step = Math.min(14, 1 + Math.floor((this.elapsed - C.MARGIN_TIME) / C.MARGIN_STEP));
        if (step > this.marginStep && this.targetPoint() > 1) { this.marginStep = step; this.marginLabel = 1400; this.emit('margin'); }
      }
      switch (this.phase) {
        case 'spawn':
          this.timer -= dt;
          if (this.timer <= 0) this.spawn();
          break;
        case 'control':
          this.updateControl(dt);
          break;
        case 'anim':
          this.timer -= dt;
          if (this.anim) this.anim.t = Math.min(1, 1 - Math.max(0, this.timer) / this.anim.dur);
          if (this.timer <= 0) { const n = this.next; this.next = null; this.anim = null; n(); }
          break;
      }
    }

    wait(dur, anim, next) {
      if (dur <= 0) { next(); return; }
      this.phase = 'anim'; this.timer = dur; this.next = next;
      this.anim = anim ? Object.assign({ t: 0, dur }, anim) : null;
    }

    spawn() {
      if (this.board.isDead()) { this.die(); return; }
      const pr = this.pairs.get(this.pairIndex++);
      this.piece = { x: C.SPAWN_X, y: C.HIDDEN, rot: 0, colors: [pr[0], pr[1]], rotT: 0, angFrom: -90, angTo: -90 };
      this.pieceId++;
      this.fallTimer = 0; this.groundTime = 0; this.pushbacks = 0; this.quickTurn = 0;
      this.phase = 'control';
    }

    updateControl(dt) {
      const p = this.piece;
      const interval = this.softDrop ? C.SOFT_DROP_INTERVAL : C.FALL_INTERVAL;
      if (this.fits(p.x, p.y + 1, p.rot)) {
        this.fallTimer += dt;
        while (this.fallTimer >= interval) {
          this.fallTimer -= interval;
          if (this.fits(p.x, p.y + 1, p.rot)) { p.y++; if (this.softDrop) this.score += 1; }
          else { this.fallTimer = 0; break; }
        }
      } else {
        // 着地中：下を押していれば即固定。押していなければ合計32コマまで動かせる
        this.fallTimer = 0;
        if (this.softDrop) { this.lock(); return; }
        this.groundTime += dt;
        if (this.groundTime >= C.GRACE) this.lock();
      }
    }

    lock() {
      if (!this.piece) return;
      const landed = [];
      for (const c of this.pieceCells()) if (c.y >= 0) { this.board.set(c.x, c.y, c.c); landed.push({ i: c.y * C.COLS + c.x, x: c.x, y: c.y }); }
      this.piece = null;
      this.chain = 0;
      this.emit('lock');
      // ちぎれて落ちる → ぷにっと弾む（16コマ）→ 消えるか判定
      const moves = this.board.applyGravity();
      const finalIdx = landed.map(l => { const m = moves.find(mv => mv.x === l.x && mv.from === l.y); return m ? m.to * C.COLS + m.x : l.i; });
      this.fallAnim(moves, () => {
        this.setSquash(finalIdx, C.BOUNCE);
        this.wait(C.BOUNCE, null, () => this.checkPop());
      });
    }

    // 落下の演出（本家の物理で、落ちる距離に応じた時間）
    fallAnim(moves, after, garbage = false) {
      if (!moves.length) { after(); return; }
      let frames = 0;
      for (const m of moves) {
        const px = (m.to - m.from) * 16;
        const f = garbage ? fallFrames(px, 0, C.GARBAGE_ACC[m.x]) : fallFrames(px, C.FALL_V0, C.FALL_ACC);
        frames = Math.max(frames, f);
      }
      this.wait(frames * C.FRAME, { type: 'fall', moves, garbage }, after);
    }

    settle(after) {
      const moves = this.board.applyGravity();
      this.fallAnim(moves, () => {
        this.setSquash(moves.filter(m => m.to >= 0).map(m => m.to * C.COLS + m.x), C.BOUNCE * 0.6);
        after();
      });
    }

    checkPop() {
      const groups = this.board.findGroups(4);
      if (!groups.length) {
        // 全消し：盤面が空になったら、次の連鎖にボーナス（本家と同じくいし30個分）
        if (this.chain > 0 && this.board.cells.every(v => v === 0)) {
          this.allClearBonus = true; this.allClearLabel = 1600; this.emit('allclear');
        }
        this.endResolve(); return;
      }
      this.chain++;
      const set = new Set();
      for (const g of groups) for (const i of g.cells) set.add(i);
      this.emit('popstart', { chain: this.chain });
      this.wait(C.POP_TIME, { type: 'pop', cells: set }, () => {
        const info = this.board.popGroups(groups);
        let pts = SG.Board.stepScore(this.chain, info);
        if (this.allClearBonus && !this.selfChain) { pts += this.targetPoint() * C.ALL_CLEAR_BONUS; this.allClearBonus = false; }
        this.score += pts;
        this.gauge = Math.min(C.SKILL_GAUGE_MAX, this.gauge + info.count);
        this.maxChain = Math.max(this.maxChain, this.chain);
        this.chainLabel = { n: this.chain, t: 1100 };
        if (this.selfChain) this.makeAttack(pts, true);
        else if (!this.flipChain || C.FLIP_CHAIN_ATTACKS) this.makeAttack(pts);
        this.emit('pop', { chain: this.chain });
        this.settle(() => this.checkPop());
      });
    }

    makeAttack(pts, defenseOnly = false) {
      const tp = this.targetPoint();
      const total = pts + this.carry;
      let g = Math.floor(total / tp);
      this.carry = total % tp;
      if (g <= 0) return;
      // 自分に届く予定のいしを先に相殺（本家と同じ）
      if (this.pendingGarbage > 0) {
        const cancel = Math.min(g, this.pendingGarbage);
        this.pendingGarbage -= cancel; g -= cancel;
      }
      if (g > 0 && this.onAttack && !defenseOnly) this.onAttack(g);
    }

    endResolve() {
      this.flipChain = false; this.selfChain = false;
      // さかさまは「つぶを置いて連鎖が終わり、次のつぶが出る前」に発動する
      // 隠し技：相手からの反転と自分への反転が重なると「うちけし」（2回反転＝元通り）
      if (this.pendingSelfFlip > 0 && this.pendingFlip > 0) {
        this.pendingSelfFlip--; this.pendingFlip--;
        this.cancelLabel = 1600; this.emit('cancel');
        this.wait(350, null, () => this.endResolve());
        return;
      }
      if (this.pendingSelfFlip > 0) { this.startFlip(true); return; }
      if (this.pendingFlip > 0) { this.startFlip(false); return; }
      if (this.pendingGarbage > 0) {
        const n = Math.min(C.GARBAGE_MAX_DROP, this.pendingGarbage);
        this.pendingGarbage -= n;
        const moves = this.board.addGarbage(n, this.rng);
        this.emit('garbage', { n });
        this.fallAnim(moves, () => this.toSpawn(), true);
        return;
      }
      this.toSpawn();
    }
    toSpawn() { this.phase = 'spawn'; this.timer = C.SPAWN_DELAY; }

    startFlip(self) {
      if (self) this.pendingSelfFlip--; else this.pendingFlip--;
      this.selfChain = !!self;
      this.flipCount++;
      this.flipLabel = 1400;
      this.chain = 0;
      this.flipChain = true;
      this.emit('flip', { self: !!self });
      this.wait(C.FLIP_ANIM, { type: 'flip' }, () => {
        this.board.flipRaw();
        this.settle(() => this.checkPop());
      });
    }

    die() {
      this.dead = true; this.phase = 'dead'; this.piece = null;
      this.emit('dead');
      if (this.onDead) this.onDead(this);
    }
  }

  Player.DX = DX; Player.DY = DY;
  SG.Player = Player;
})();
