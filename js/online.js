// =============================================
//  合言葉オンライン対戦（Firebase Realtime Database）
//  部屋の出入り・試合開始・いし/さかさまの送受信・観戦・もう一回
//
//  データの形： rooms/{合言葉}/
//    players/{0|1}  : { id, name }           対戦者（最初に来た2人）
//    watchers/{id}  : { name }               観戦者（3人目以降）
//    ready/{0|1}    : 何回戦をやりたいか      （両方そろうと開始）
//    game           : { round, seed, startAt }（0番の人が書く）
//    boards/{0|1}   : 盤面の様子（観戦・相手表示用）
//    ev/r{回戦}/{0|1}/{自動ID} : { t:'a', n } いし / { t:'f' } さかさま
//    result/r{回戦} : { loser, why }          最初に書いた人の結果で確定
// =============================================
(function () {
  const clean = s => String(s || '').replace(/[.#$\[\]\/\s]/g, '').slice(0, 20);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  class OnlineRoom {
    constructor(db, code, name, cb) {
      this.db = db;
      this.code = clean(code);
      this.name = (String(name || '').trim().slice(0, 8)) || 'ななし';
      this.cb = cb || {};
      this.id = uid();
      this.slot = -1;             // 0/1=対戦者  -1=観戦
      this.players = {};
      this.watchers = {};
      this.game = null;
      this.round = 0;
      this.results = {};
      this.subs = [];
      this.evSubs = [];
      this.offset = 0;
      this.root = db.ref('rooms/' + this.code);
      this.left = false;
    }
    call(name, ...a) { if (this.cb[name]) this.cb[name](...a); }
    now() { return Date.now() + this.offset; }
    on(ref, ev, fn) { ref.on(ev, fn); this.subs.push([ref, ev, fn]); }

    async join() {
      if (!this.code) throw new Error('合言葉を入れてください');
      const off = this.db.ref('.info/serverTimeOffset');
      this.on(off, 'value', s => { this.offset = s.val() || 0; });

      // 空いている席（0→1）を取る。埋まっていれば観戦
      for (const s of [0, 1]) {
        const ref = this.root.child('players/' + s);
        const res = await ref.transaction(cur => (cur ? undefined : { id: this.id, name: this.name }));
        if (res.committed && res.snapshot.val() && res.snapshot.val().id === this.id) { this.slot = s; break; }
      }
      if (this.slot >= 0) {
        const s = this.slot;
        this.root.child('players/' + s).onDisconnect().remove();
        this.root.child('ready/' + s).onDisconnect().remove();
        this.root.child('boards/' + s).onDisconnect().remove();
      } else {
        const w = this.root.child('watchers/' + this.id);
        await w.set({ name: this.name });
        w.onDisconnect().remove();
      }

      // 前の試合が残っている部屋でも、次の回戦から参加する
      if (this.slot >= 0) {
        const g0 = (await this.root.child('game').once('value')).val();
        this.joinRound = ((g0 && g0.round) || 0) + 1;
      }

      this.on(this.root.child('players'), 'value', snap => {
        const prev = this.players;
        this.players = snap.val() || {};
        this.call('onPeople', this.people());
        // 試合中に相手がいなくなった → 相手の負け
        if (this.slot >= 0 && this.game && !this.results['r' + this.round]) {
          const o = 1 - this.slot;
          if (prev[o] && !this.players[o]) this.report(o, 'left');
        }
        this.tryStart();
      });
      this.on(this.root.child('watchers'), 'value', snap => { this.watchers = snap.val() || {}; this.call('onPeople', this.people()); });
      this.on(this.root.child('ready'), 'value', snap => { this.ready = snap.val() || {}; this.tryStart(); });
      this.on(this.root.child('game'), 'value', snap => this.onGame(snap.val()));
      for (const s of [0, 1]) this.on(this.root.child('boards/' + s), 'value', snap => this.call('onBoard', s, snap.val()));

      if (this.slot >= 0) await this.root.child('ready/' + this.slot).set(this.joinRound);
      return { slot: this.slot, code: this.code };
    }

    people() {
      const names = [0, 1].map(s => (this.players[s] ? this.players[s].name : null));
      return { names, watchers: Object.keys(this.watchers).length, slot: this.slot };
    }

    // 0番の人：両方が「次の回戦をやりたい」になったら開始を書き込む
    tryStart() {
      if (this.slot !== 0 || this.left || !this.joinRound) return;
      const r = this.ready || {};
      const next = (this.game ? this.game.round : 0) + 1;
      if (!this.players[0] || !this.players[1]) return;
      if (!(r[0] >= next && r[1] >= next)) return;
      if (this.starting === next) return;
      this.starting = next;
      const seed = (Math.random() * 2147483647) | 0;
      this.root.child('game').set({ round: next, seed, startAt: this.now() + 2500 });
      if (next > 2) this.root.child('ev/r' + (next - 2)).remove();
    }

    onGame(g) {
      if (!g || this.left) { this.game = g; return; }
      if (this.game && this.game.round === g.round) return;
      this.game = g;
      // 対戦者が入る前の古い試合は見送る
      if (this.slot >= 0 && this.joinRound && g.round < this.joinRound) return;
      this.round = g.round;
      // イベント（いし・さかさま）の受信を切り替える
      for (const [ref, ev, fn] of this.evSubs) ref.off(ev, fn);
      this.evSubs = [];
      const R = 'r' + g.round;
      for (const s of [0, 1]) {
        if (s === this.slot) continue;
        const ref = this.root.child('ev/' + R + '/' + s);
        const fn = snap => this.call('onEvent', s, snap.val());
        ref.on('child_added', fn); this.evSubs.push([ref, 'child_added', fn]);
      }
      const rref = this.root.child('result/' + R);
      const rfn = snap => {
        const v = snap.val();
        if (!v || this.results[R]) return;
        this.results[R] = v;
        this.call('onResult', v);
      };
      rref.on('value', rfn); this.evSubs.push([rref, 'value', rfn]);
      this.call('onStart', {
        round: g.round, seed: g.seed, slot: this.slot,
        wait: Math.max(0, g.startAt - this.now()),
        names: this.people().names
      });
    }

    // ---- 送信 ----
    sendAttack(n) { if (this.slot >= 0) this.root.child('ev/r' + this.round + '/' + this.slot).push({ t: 'a', n }); }
    sendFlip() { if (this.slot >= 0) this.root.child('ev/r' + this.round + '/' + this.slot).push({ t: 'f' }); }
    sendBoard(snap) { if (this.slot >= 0) this.root.child('boards/' + this.slot).set(snap); }
    report(loser, why) {
      const R = 'r' + this.round;
      this.root.child('result/' + R).transaction(cur => (cur ? undefined : { loser, why: why || 'dead' }));
    }
    rematch() { if (this.slot >= 0) this.root.child('ready/' + this.slot).set(this.round + 1); }

    leave() {
      if (this.left) return;
      this.left = true;
      for (const [ref, ev, fn] of this.subs.concat(this.evSubs)) ref.off(ev, fn);
      this.subs = []; this.evSubs = [];
      if (this.slot >= 0) {
        this.root.child('players/' + this.slot).remove();
        this.root.child('ready/' + this.slot).remove();
        this.root.child('boards/' + this.slot).remove();
      } else this.root.child('watchers/' + this.id).remove();
    }
  }

  // ---- 盤面の様子を送る形にする（小さく） ----
  const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  SG.packBoard = function (p, name) {
    const a = p.anim;
    return {
      c: p.board.cells.map(v => B36[v]).join(''),
      p: p.piece ? [p.piece.x, p.piece.y, p.piece.rot, p.piece.colors[0], p.piece.colors[1]] : 0,
      pi: p.pairIndex, s: p.score, g: p.gauge, pg: p.pendingGarbage,
      ch: p.chainLabel ? p.chainLabel.n : 0, fc: p.flipCount, mc: p.maxChain,
      fr: p.flipReserved ? 1 : 0, d: p.dead ? 1 : 0,
      pop: a && a.type === 'pop' ? Array.from(a.cells) : 0,
      n: name || ''
    };
  };

  // ---- 受け取った様子から、描画用の「相手」を作る ----
  class RemotePlayer {
    constructor(pairs) {
      this.pairs = pairs;
      this.board = new SG.Board();
      this.piece = null; this.phase = 'control'; this.anim = null;
      this.score = 0; this.gauge = 0; this.pendingGarbage = 0; this.pairIndex = 0;
      this.chainLabel = null; this.flipLabel = 0; this.cancelLabel = 0; this.allClearLabel = 0; this.marginLabel = 0;
      this.flipCount = 0; this.maxChain = 0; this.dead = false; this.flipReserved = false; this.squash = null;
      this.lastCh = 0; this.popKey = '';
      this.onFlip = null; this.onChain = null;
    }
    fallProgress() { return 0; }
    childAngle() { return this.piece ? [-90, 0, 90, 180][this.piece.rot] : 0; }
    nextPairs() { return [this.pairs.get(this.pairIndex), this.pairs.get(this.pairIndex + 1)]; }
    apply(s) {
      if (!s) return;
      const cells = new Array(s.c.length);
      for (let i = 0; i < s.c.length; i++) cells[i] = B36.indexOf(s.c[i]);
      if (cells.length === this.board.cells.length) this.board.cells = cells;
      this.piece = s.p ? { x: s.p[0], y: s.p[1], rot: s.p[2], colors: [s.p[3], s.p[4]] } : null;
      this.pairIndex = s.pi || 0; this.score = s.s || 0; this.gauge = s.g || 0; this.pendingGarbage = s.pg || 0;
      this.maxChain = s.mc || 0; this.flipReserved = !!s.fr; this.dead = !!s.d;
      if ((s.fc || 0) > this.flipCount) { this.flipLabel = 1400; if (this.onFlip) this.onFlip(); }
      this.flipCount = s.fc || 0;
      if (s.ch && s.ch !== this.lastCh) { this.chainLabel = { n: s.ch, t: 1100 }; if (this.onChain) this.onChain(s.ch); }
      this.lastCh = s.ch || 0;
      const key = s.pop ? s.pop.join(',') : '';
      if (key && key !== this.popKey) this.anim = { type: 'pop', cells: new Set(s.pop), t: 0, dur: SG.CONFIG.POP_TIME };
      if (!key && this.anim) this.anim = null;
      this.popKey = key;
    }
    update(dt) {
      if (this.chainLabel) { this.chainLabel.t -= dt; if (this.chainLabel.t <= 0) this.chainLabel = null; }
      if (this.flipLabel > 0) this.flipLabel -= dt;
      if (this.anim) { this.anim.t = Math.min(1, this.anim.t + dt / this.anim.dur); }
    }
  }

  SG.OnlineRoom = OnlineRoom;
  SG.RemotePlayer = RemotePlayer;
  SG.cleanCode = clean;
})();
