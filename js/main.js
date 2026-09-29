// =============================================
//  画面の切り替え・試合の進行・レイアウト
// =============================================
(function () {
  const C = SG.CONFIG;
  const $ = s => document.querySelector(s);
  const LEVEL_NAME = { easy: 'CPU よわい', normal: 'CPU ふつう', hard: 'CPU つよい' };

  const st = {
    level: 'normal', me: null, opp: null, ai: null, mode: 'cpu', room: null, watch: false,
    running: false, paused: false, over: false, countdown: 0, lastCount: 0,
    wins: [0, 0], flipsUsed: 0, screen: 'title'
  };

  SG.state = st; // デバッグ用
  const input = new SG.Input();
  input.bindButtons($('#controls'));
  input.bindSwipe($('#game .field'));

  // ---------- スマホの操作方法（ボタン／なぞる）----------
  const isTouch = () => matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && window.innerWidth < 900);
  document.body.classList.toggle('touch', isTouch());
  function setMode(m) {
    input.mode = m;
    document.body.classList.toggle('swipe', m === 'swipe');
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    try { localStorage.setItem('sakasama-mode', m); } catch (e) {}
    if (st.screen === 'game') layout();
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const views = {
    me: new SG.BoardView($('#me-board')),
    opp: new SG.BoardView($('#opp-board')),
    next: new SG.NextView($('#me-next'))
  };

  // ---------- 画面切り替え ----------
  function show(id) {
    st.screen = id;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    if (id === 'game') layout();
  }
  function overlay(id, on) { $(id).classList.toggle('show', on); }

  document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => {
    SG.Sound.init();
    st.level = b.dataset.level;
    st.wins = [0, 0];
    setMode2('cpu');
    setNames('あなた', LEVEL_NAME[st.level]);
    show('game');
    startMatch();
  }));
  $('#btn-howto').addEventListener('click', () => overlay('#ov-howto', true));
  $('#btn-howto-close').addEventListener('click', () => overlay('#ov-howto', false));
  $('#btn-pause').addEventListener('click', () => togglePause());
  $('#btn-resume').addEventListener('click', () => togglePause(false));
  $('#btn-quit').addEventListener('click', toTitle);
  $('#btn-back').addEventListener('click', toTitle);
  $('#btn-again').addEventListener('click', () => {
    SG.Sound.init();
    if (st.mode === 'online') {
      if (st.watch) return;
      st.room.rematch();
      $('#btn-again').disabled = true;
      $('#again-msg').textContent = 'あいての「もう一回」を待っています…';
    } else startMatch();
  });
  $('#btn-sound').addEventListener('click', () => {
    SG.Sound.on = !SG.Sound.on;
    $('#btn-sound').classList.toggle('off', !SG.Sound.on);
  });
  document.querySelectorAll('.skill-side').forEach(b => b.addEventListener('click', () => { if (st.running && !st.paused) st.me.useSkill(b.dataset.target); }));

  input.on('move', dx => { if (st.me && st.me.move(dx)) SG.Sound.move(); });
  input.on('rotate', dir => { if (st.me && st.me.rotate(dir)) SG.Sound.rotate(); });
  input.on('hard', () => { if (st.me) st.me.hardDrop(); });
  input.on('skill', target => { if (st.me) st.me.useSkill(target); });
  input.on('pause', () => { if (st.screen === 'game' && !st.over) togglePause(); });

  document.addEventListener('visibilitychange', () => { if (document.hidden && st.running && !st.paused && st.mode === 'cpu') togglePause(true); });

  function toTitle() {
    if (st.room) { st.room.leave(); st.room = null; }
    st.me = null; st.opp = null; st.running = false; st.paused = false; input.enabled = false;
    overlay('#ov-pause', false); overlay('#ov-result', false); overlay('#ov-count', false);
    setMode2('cpu');
    show('title');
  }

  function setMode2(m, watch) {
    st.mode = m; st.watch = !!watch;
    document.body.classList.toggle('online', m === 'online');
    document.body.classList.toggle('watching', !!watch);
    $('#watchers').textContent = '';
  }
  function setNames(left, right) {
    $('#me-name').textContent = left; $('#me-label').textContent = left;
    $('#cpu-name').textContent = right; $('#opp-label').textContent = right;
  }

  function togglePause(force) {
    if (st.mode === 'online') { overlay('#ov-pause', !$('#ov-pause').classList.contains('show')); return; }
    if (!st.me || st.over) return;
    st.paused = force === undefined ? !st.paused : force;
    input.enabled = st.running && !st.paused;
    input.releaseAll();
    overlay('#ov-pause', st.paused);
  }

  // ---------- 試合 ----------
  function startMatch() {
    const seed = (Math.random() * 2147483647) | 0;
    const pairs = new SG.PairSource(seed);
    const me = new SG.Player({ pairs, seed: seed ^ 0x2468 });
    const cpu = new SG.Player({ pairs, seed: seed ^ 0x1357 });
    st.opp = cpu;
    me.onAttack = n => cpu.receiveGarbage(n);
    cpu.onAttack = n => me.receiveGarbage(n);
    me.onSkill = () => cpu.receiveFlip();
    cpu.onSkill = () => me.receiveFlip();
    me.onDead = () => finish(false);
    cpu.onDead = () => finish(true);
    me.listener = (ev, d) => {
      if (ev === 'pop') SG.Sound.pop(d.chain);
      else if (ev === 'lock') SG.Sound.lock();
      else if (ev === 'harddrop') SG.Sound.hard();
      else if (ev === 'allclear') SG.Sound.win();
      else if (ev === 'garbage') { SG.Sound.garbage(); hit('#me-wrap'); }
      else if (ev === 'skill') { SG.Sound.skill(); st.flipsUsed++; }
      else if (ev === 'flip') { SG.Sound.flip(); hit('#me-wrap'); }
      else if (ev === 'margin') SG.Sound.ready();
      else if (ev === 'cancel') SG.Sound.win();
    };
    cpu.listener = ev => {
      if (ev === 'skill') SG.Sound.skill();
      else if (ev === 'flip') hit('#opp-wrap');
      else if (ev === 'garbage') hit('#opp-wrap');
    };
    Object.assign(st, { me, opp: cpu, ai: new SG.Cpu(cpu, me, st.level), running: false, paused: false, over: false, countdown: 2000, lastCount: 0, flipsUsed: 0 });
    st.lastGauge = 0; st.gMe = -1; st.gOpp = -1; st.seedN = -1; st.seedT = 0;
    input.enabled = false; input.releaseAll();
    overlay('#ov-result', false); overlay('#ov-pause', false); overlay('#ov-count', true);
    $('#wins').textContent = st.wins[0] + ' - ' + st.wins[1];
  }

  // result: true=かち false=まけ  または 観戦用の文字列
  function finish(win, text) {
    if (st.over) return;
    st.over = true; st.running = false; input.enabled = false; input.releaseAll();
    if (typeof win === 'boolean') st.wins[win ? 0 : 1]++;
    else if (typeof win === 'number') st.wins[win]++;
    $('#wins').textContent = st.wins[0] + ' - ' + st.wins[1];
    setTimeout(() => {
      if (!st.me) return;
      const good = win === true || typeof win === 'number';
      good ? SG.Sound.win() : SG.Sound.lose();
      const h = $('#result-title');
      h.textContent = text || (win ? 'かち！' : 'まけ…');
      h.className = good ? 'win' : 'lose';
      $('#btn-again').disabled = false;
      $('#btn-again').style.display = st.watch ? 'none' : '';
      $('#again-msg').textContent = st.watch ? '次の試合が始まるまで待っています…' : '';
      $('#res-score').textContent = st.me.score.toLocaleString();
      $('#res-chain').textContent = st.me.maxChain;
      $('#res-flip').textContent = st.flipsUsed;
      overlay('#ov-result', true);
    }, 600);
  }

  function hit(sel) {
    const el = $(sel); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  }

  // ---------- いし表示 ----------
  function garbageHTML(n) {
    let html = '', count = 0;
    const big = Math.floor(n / 30), mid = Math.floor((n % 30) / 6), sm = n % 6;
    for (let i = 0; i < big && count < 10; i++, count++) html += '<i class="l"></i>';
    for (let i = 0; i < mid && count < 10; i++, count++) html += '<i class="m"></i>';
    for (let i = 0; i < sm && count < 10; i++, count++) html += '<i class="s"></i>';
    return html;
  }

  // ---------- 毎フレーム ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last); last = now;
    if (st.screen === 'title') drawTitleBg(dt);
    if (st.me && st.screen === 'game') {
      if (st.mode === 'online' && st.over) { st.opp.update(dt); if (st.watch) st.me.update(dt); }
      if (!st.paused) {
        if (st.countdown > 0) {
          st.countdown -= dt;
          const n = Math.ceil(st.countdown / 1000);
          if (n !== st.lastCount) {
            st.lastCount = n;
            const el = $('#count-num');
            el.textContent = n > 0 ? n : 'スタート！';
            el.style.fontSize = n > 0 ? '' : '64px';
            el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
            n > 0 ? SG.Sound.count() : SG.Sound.go();
          }
          if (st.countdown <= 0) {
            st.running = true; input.enabled = true;
            setTimeout(() => overlay('#ov-count', false), 350);
          }
        } else if (st.running) {
          if (st.mode === 'cpu') {
            input.update(dt);
            st.me.softDrop = input.softDrop;
            st.me.update(dt);
            st.ai.update(dt);
            st.opp.update(dt);
          } else {
            if (!st.watch && !st.over) {
              input.update(dt);
              st.me.softDrop = input.softDrop;
              st.me.update(dt);
              // 自分の盤面の様子を0.1秒ごとに送る（変わったときだけ）
              if (now - (st.sentAt || 0) > 100) {
                st.sentAt = now;
                const pk = SG.packBoard(st.me, st.myName);
                const j = JSON.stringify(pk);
                if (j !== st.lastSent) { st.lastSent = j; st.room.sendBoard(pk); }
              }
            }
            if (st.watch) st.me.update(dt);
            st.opp.update(dt);
          }
        }
      }
      render(now);
    }
    requestAnimationFrame(frame);
  }

  function render(now) {
    const me = st.me, cpu = st.opp;
    views.me.draw(me, now, { ghost: true });
    views.opp.draw(cpu, now, { ghost: false });
    views.next.draw(me);
    $('#me-score').textContent = me.score.toLocaleString();
    $('#opp-score').textContent = cpu.score.toLocaleString();
    const ratio = me.gauge / C.SKILL_GAUGE_MAX;
    $('#me-gauge').style.width = (ratio * 100) + '%';
    $('#opp-gauge').style.width = (cpu.gauge / C.SKILL_GAUGE_MAX * 100) + '%';
    const ready = ratio >= 1;
    if (ready !== st.lastReady) {
      st.lastReady = ready;
      document.querySelector('.gauge-panel').classList.toggle('ready', ready);
      document.querySelectorAll('.acts .skill').forEach(b => b.classList.toggle('ready', ready));
      if (ready) SG.Sound.ready();
    }
    if (me.pendingGarbage !== st.gMe) { st.gMe = me.pendingGarbage; $('#me-garbage').innerHTML = garbageHTML(st.gMe); }
    if (cpu.pendingGarbage !== st.gOpp) { st.gOpp = cpu.pendingGarbage; $('#opp-garbage').innerHTML = garbageHTML(st.gOpp); }
  }

  // ---------- 合言葉オンライン対戦 ----------
  function loadScript(src) {
    return new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src; el.onload = res; el.onerror = () => rej(new Error('通信できませんでした。電波のよいところでもう一度ためしてください'));
      document.head.appendChild(el);
    });
  }
  async function getDb() {
    if (SG._db) return SG._db;
    if (!SG.FIREBASE_CONFIG || !SG.FIREBASE_CONFIG.apiKey) throw new Error('オンライン対戦はまだ準備中です');
    const v = '10.12.2';
    await loadScript('https://www.gstatic.com/firebasejs/' + v + '/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/' + v + '/firebase-database-compat.js');
    if (!firebase.apps.length) firebase.initializeApp(SG.FIREBASE_CONFIG);
    SG._db = firebase.database();
    return SG._db;
  }

  function lobby(showWait) {
    $('#online-form').hidden = showWait; $('#online-wait').hidden = !showWait;
  }
  $('#btn-online').addEventListener('click', () => {
    SG.Sound.init();
    lobby(false); $('#online-err').textContent = '';
    try { $('#in-name').value = localStorage.getItem('sakasama-name') || ''; } catch (e) {}
    overlay('#ov-online', true);
  });
  $('#btn-online-close').addEventListener('click', () => {
    if (st.room) { st.room.leave(); st.room = null; }
    setMode2('cpu');
    overlay('#ov-online', false);
  });
  $('#btn-copy').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?room=' + encodeURIComponent(st.room ? st.room.code : '');
    try { await navigator.clipboard.writeText(url); $('#btn-copy').textContent = 'コピーしました！'; }
    catch (e) { prompt('このリンクを送ってください', url); }
    setTimeout(() => { $('#btn-copy').textContent = 'さそうリンクをコピー'; }, 2000);
  });
  $('#btn-join').addEventListener('click', joinOnline);
  $('#in-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinOnline(); });

  async function joinOnline() {
    const code = SG.cleanCode($('#in-code').value);
    const name = $('#in-name').value.trim().slice(0, 8) || 'ななし';
    if (!code) { $('#online-err').textContent = 'あいことばを入れてください（. # $ / [ ] は使えません）'; return; }
    try { localStorage.setItem('sakasama-name', name); } catch (e) {}
    $('#online-err').textContent = ''; $('#btn-join').disabled = true; $('#btn-join').textContent = 'つないでいます…';
    try {
      const db = await getDb();
      st.myName = name;
      st.wins = [0, 0];
      const room = new SG.OnlineRoom(db, code, name, {
        onPeople: onPeople, onStart: onStart, onEvent: onEvent,
        onBoard: (s, b) => { const r = st.remotes && st.remotes[s]; if (r) r.apply(b); },
        onResult: onResult
      });
      st.room = room;
      await room.join();
      setMode2('online', room.slot < 0);
      $('#wait-code').textContent = room.code;
      $('#wait-msg').textContent = room.slot < 0 ? '観戦で入りました。試合が始まるのを待っています…' : 'あいてを待っています…';
      lobby(true);
    } catch (e) {
      $('#online-err').textContent = e.message || 'つながりませんでした';
      if (st.room) { st.room.leave(); st.room = null; }
    }
    $('#btn-join').disabled = false; $('#btn-join').textContent = 'はいる';
  }

  function onPeople(p) {
    st.people = p;
    const names = p.names;
    $('#watchers').textContent = p.watchers ? '👀' + p.watchers : '';
    if (st.room && st.room.slot >= 0 && !names[1 - st.room.slot] && $('#ov-online').classList.contains('show')) {
      $('#wait-msg').textContent = 'あいてを待っています…';
    }
  }

  function onStart(g) {
    const room = st.room; if (!room) return;
    const pairs = new SG.PairSource(g.seed);
    const names = g.names.map(n => n || '？');
    st.remotes = [new SG.RemotePlayer(pairs), new SG.RemotePlayer(pairs)];
    st.remotes.forEach(r => { r.onFlip = () => SG.Sound.flip(); });
    if (g.slot >= 0) {
      const me = new SG.Player({ pairs, seed: g.seed ^ (0x2468 + g.slot * 7919) });
      const o = 1 - g.slot;
      me.onAttack = n => room.sendAttack(n);
      me.onSkill = () => room.sendFlip();
      me.onDead = () => room.report(g.slot, 'dead');
      me.listener = (ev, d) => {
        if (ev === 'pop') SG.Sound.pop(d.chain);
        else if (ev === 'lock') SG.Sound.lock();
        else if (ev === 'harddrop') SG.Sound.hard();
        else if (ev === 'allclear') SG.Sound.win();
        else if (ev === 'garbage') { SG.Sound.garbage(); hit('#me-wrap'); }
        else if (ev === 'skill') { SG.Sound.skill(); st.flipsUsed++; }
        else if (ev === 'flip') { SG.Sound.flip(); hit('#me-wrap'); }
        else if (ev === 'margin') SG.Sound.ready();
        else if (ev === 'cancel') SG.Sound.win();
      };
      st.remotes[o].onFlip = () => hit('#opp-wrap');
      st.me = me; st.opp = st.remotes[o];
      setNames(names[g.slot], names[o]);
    } else {
      st.me = st.remotes[0]; st.opp = st.remotes[1];
      st.remotes[0].onFlip = () => hit('#me-wrap');
      st.remotes[1].onFlip = () => hit('#opp-wrap');
      setNames(names[0], names[1]);
      st.me.score = 0;
    }
    Object.assign(st, { running: false, paused: false, over: false, countdown: Math.max(300, g.wait), lastCount: 0, flipsUsed: 0, lastSent: '', sentAt: 0 });
    st.gMe = -1; st.gOpp = -1; st.lastReady = null;
    input.enabled = false; input.releaseAll();
    overlay('#ov-online', false); overlay('#ov-result', false); overlay('#ov-pause', false); overlay('#ov-count', true);
    $('#wins').textContent = st.wins[0] + ' - ' + st.wins[1];
    show('game');
  }

  function onEvent(s, e) {
    if (!st.me || st.watch || st.over || !e) return;
    if (e.t === 'a') st.me.receiveGarbage(e.n);
    else if (e.t === 'f') { st.me.receiveFlip(); SG.Sound.skill(); }
  }

  function onResult(r) {
    const room = st.room; if (!room || !st.me) return;
    if (!st.watch) {
      // 最後の盤面を送っておく（観戦者用）
      room.sendBoard(SG.packBoard(st.me, st.myName));
      const win = r.loser !== room.slot;
      finish(win, win ? (r.why === 'left' ? 'かち！（あいてが退室）' : 'かち！') : 'まけ…');
    } else {
      const names = [$('#me-name').textContent, $('#cpu-name').textContent];
      const w = 1 - r.loser;
      finish(w, names[w] + ' のかち！');
    }
  }

  // さそうリンク（?room=あいことば）から来たら、あいことばを入れた状態で開く
  (function () {
    const q = new URLSearchParams(location.search).get('room');
    if (q) { $('#in-code').value = q; setTimeout(() => $('#btn-online').click(), 50); }
  })();

  // ---------- レイアウト（画面サイズに合わせて盤面の大きさを決める） ----------
  function layout() {
    const W = window.innerWidth;
    const H = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const touch = isTouch();
    document.body.classList.toggle('touch', touch);
    // スマホ横持ち：本家と同じく自分と相手を同じ大きさで並べ、操作ボタンを左右に置く
    const land = touch && W > H && !st.watch;
    const wide = land || st.watch || (W >= 760 && W > H * 0.95);
    const game = $('#game');
    game.classList.toggle('land', land);
    game.classList.toggle('wide', wide);
    game.classList.toggle('narrow', !wide);
    const ctrlH = (!touch || land || st.watch) ? 0 : input.mode === 'swipe' ? 64 : Math.round(Math.min(160, Math.max(116, H * 0.2)));
    document.documentElement.style.setProperty('--ctrl-h', ctrlH + 'px');
    const rows = C.ROWS - C.HIDDEN + 0.5;
    let cell, oppCell, sideW;
    if (land) {
      const ctrlW = input.mode === 'swipe' ? Math.round(Math.min(150, W * 0.16)) : Math.round(Math.min(190, W * 0.2));
      document.documentElement.style.setProperty('--ctrl-w', ctrlW + 'px');
      sideW = Math.round(Math.min(130, Math.max(96, W * 0.13)));
      const availH = H - 34 - 16 - 16 - 30;
      cell = Math.floor(Math.min(availH / rows, (W - ctrlW * 2 - sideW - 60) / (C.COLS * 2), 46));
      oppCell = cell;
    } else if (wide) {
      const availH = H - 44 - ctrlH - 20 - 22 - 16;
      sideW = W < 700 ? Math.round(Math.max(76, W * 0.2)) : 170;
      cell = Math.floor(Math.min(availH / rows, (W - sideW - (W < 700 ? 48 : 90)) / (C.COLS * 2), 46));
      oppCell = cell;
    } else {
      const availH = H - 44 - ctrlH - 20 - 22;
      sideW = Math.round(Math.max(100, Math.min(150, W * 0.3)));
      cell = Math.floor(Math.min(availH / rows, (W - sideW - 30) / C.COLS, 44));
      oppCell = Math.floor(Math.min((sideW - 6) / C.COLS, (availH - 250) / rows));
    }
    cell = Math.max(12, cell); oppCell = Math.max(8, oppCell);
    document.documentElement.style.setProperty('--side-w', sideW + 'px');
    views.me.resize(cell);
    input.stepPx = Math.max(18, cell * 0.85);
    views.opp.resize(oppCell);
    views.next.resize(wide ? Math.round(Math.min(cell * 0.85, (sideW - 20) / 2.3)) : Math.round(Math.min(cell * 0.8, (sideW - 24) / 2.3)));
  }

  window.addEventListener('resize', () => { if (st.screen === 'game') layout(); resizeTitleBg(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (st.screen === 'game') layout(); });

  // ---------- タイトル背景（つぶがふわふわ落ちる） ----------
  const tbg = $('#title-bg'), tctx = tbg.getContext('2d');
  let drops = [];
  function resizeTitleBg() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    tbg.width = window.innerWidth * dpr; tbg.height = window.innerHeight * dpr;
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeTitleBg();
  for (let i = 0; i < 18; i++) drops.push(newDrop(true));
  function newDrop(any) {
    const s = 22 + Math.random() * 30;
    return { x: Math.random() * window.innerWidth, y: any ? Math.random() * window.innerHeight : -s * 2, s, c: 1 + Math.floor(Math.random() * 5), v: 0.02 + Math.random() * 0.04, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.002, up: Math.random() < 0.3 };
  }
  function drawTitleBg(dt) {
    const W = window.innerWidth, H = window.innerHeight;
    tctx.clearRect(0, 0, W, H);
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      d.y += (d.up ? -1 : 1) * d.v * dt; d.r += d.vr * dt;
      if (d.y > H + d.s * 2 || d.y < -d.s * 3) { drops[i] = newDrop(false); if (drops[i].up) drops[i].y = H + drops[i].s; continue; }
      tctx.save(); tctx.translate(d.x, d.y); tctx.rotate(d.r);
      SG.drawBlob(tctx, -d.s / 2, -d.s / 2, d.s, d.c, 0.9);
      tctx.restore();
    }
  }

  let savedMode = 'button';
  try { savedMode = localStorage.getItem('sakasama-mode') || 'button'; } catch (e) {}
  setMode(savedMode);
  requestAnimationFrame(frame);
})();
