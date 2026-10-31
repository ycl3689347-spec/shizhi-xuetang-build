/* 拾知学堂 · 知识闯关（App 逻辑）
   单页、无依赖、离线：数据来自 data.js（构建时从知识图谱仓库抽出）。
   视觉层：漫画描边卡片 + 粒子爆裂 + 连击 + 角色表情，全部本地实现。 */
(function () {
  'use strict';

  var D = window.G4DATA;
  var LS_PROG = 'g4.progress.v1';
  var LS_SUBJ = 'g4.subject.v1';
  var LS_OPEN = 'g4.open.v1';
  var LS_GAME = 'g4.game.v1';

  var $ = function (s) { return document.querySelector(s); };
  var view = $('#view');
  var bar = $('#bar');
  var side = $('#side');
  var subjBar = $('#subjects');
  var unitNav = $('#unitnav');
  var actionbar = $('#actionbar');
  var btnBack = $('#btn-back');
  var btnPrimary = $('#btn-primary');
  var hud = $('#hud');
  var hudCombo = $('#hud-combo');
  var hudScore = $('#hud-score');
  var petEl = $('#pet');
  var petBubble = $('#pet-bubble');
  var comboEl = $('#combo');

  var subjByKey = {};
  D.subjects.forEach(function (s) { subjByKey[s.key] = s; });

  /* 每个学科的第二个颜色（渐变用），与 data.js 里的 brand 搭配 */
  var BRAND2 = { math: '#0a84ff', chinese: '#ff453a', english: '#5e5ce6', science: '#30d158' };

  var state = {
    subject: localStorage.getItem(LS_SUBJ) || D.subjects[0].key,
    filter: '',
    open: {},
    scroll: {},
    quiz: null,
    combo: 0,
    score: 0
  };
  if (!subjByKey[state.subject]) state.subject = D.subjects[0].key;
  try { state.open = JSON.parse(localStorage.getItem(LS_OPEN) || '{}') || {}; } catch (e) { state.open = {}; }
  try {
    var g = JSON.parse(localStorage.getItem(LS_GAME) || '{}');
    if (g && typeof g === 'object') { state.combo = g.combo | 0; state.score = g.score | 0; }
  } catch (e) { /* 忽略 */ }

  var prog = loadProgress();

  /* ------------------------------------------------------------ 存储 */
  function loadProgress() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_PROG) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (e) { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(LS_PROG, JSON.stringify(prog)); } catch (e) { /* 存储满 */ }
  }
  function saveGame() {
    try { localStorage.setItem(LS_GAME, JSON.stringify({ combo: state.combo, score: state.score })); } catch (e) {}
  }

  /* ------------------------------------------------------------ 小工具 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function subj() { return subjByKey[state.subject]; }
  function questionsOf(tid) { return D.questions[tid] || []; }
  /* 音效与震动都在 sound.js 里合成；那边没加载或浏览器不支持时静默降级 */
  function sfx(name) { if (window.SND) window.SND.play(name); }
  function vib(kind) { if (window.SND) window.SND.buzz(kind); }
  function normNum(s) {
    return String(s == null ? '' : s)
      .replace(/[\uFF10-\uFF19]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[\uFF0E]/g, '.').replace(/[\uFF0D\u2212]/g, '-')
      .replace(/\s+/g, '').replace(/[，、]/g, ',');
  }
  function checkNumeric(input, answer) {
    var a = normNum(input), b = normNum(answer);
    if (!a) return false;
    if (a === b) return true;
    var na = Number(a), nb = Number(b);
    if (isFinite(na) && isFinite(nb)) return Math.abs(na - nb) < 1e-9;
    return a.toLowerCase() === b.toLowerCase();
  }
  function topicStat(tid) {
    var qs = questionsOf(tid);
    var total = qs.length, done = 0, ok = 0;
    qs.forEach(function (q) {
      var r = prog[q.id];
      if (r) { done++; if (r === 'ok') ok++; }
    });
    /* 题库扩容后每关只抽 8 题，因此「已掌握」不再要求做完整套：
       做够六成（20 题 → 12 题）且正确率 ≥80% 即算掌握。 */
    var need = Math.max(1, Math.ceil(total * 0.6));
    var acc = done ? ok / done : 0;
    var status = 'none';
    if (done > 0) {
      if (done >= need && acc >= 0.8) status = 'ok';
      else if (acc < 0.6) status = 'bad';
      else status = 'warn';
    }
    return { total: total, done: done, ok: ok, need: need, acc: acc, status: status };
  }
  var STATUS_TEXT = { none: '未测', ok: '已掌握', bad: '待复习', warn: '练习中' };

  function advTotal(s) {
    var n = 0;
    Object.keys(s.topics).forEach(function (tid) {
      var t = s.topics[tid];
      if (t.adv) n += t.adv;
    });
    return n;
  }

  /* ------------------------------------------------------------ 粒子 */
  var FX = (function () {
    var cv = $('#fx');
    var ctx = cv && cv.getContext ? cv.getContext('2d') : null;
    var parts = [];
    var raf = 0;
    var W = 0, H = 0, dpr = 1;

    function resize() {
      if (!cv) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(x, y, n, colors) {
      for (var i = 0; i < n; i++) {
        var ang = Math.random() * Math.PI * 2;
        var spd = 2.4 + Math.random() * 7.4;
        parts.push({
          x: x, y: y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 2.2,
          g: 0.24 + Math.random() * 0.16,
          life: 1,
          decay: 0.012 + Math.random() * 0.015,
          size: 3 + Math.random() * 6,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: colors[(Math.random() * colors.length) | 0],
          star: Math.random() < 0.45
        });
      }
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function drawStar(cx, cy, r, rot) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.beginPath();
      for (var i = 0; i < 5; i++) {
        var a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
        var px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function tick() {
      raf = 0;
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.992;
        p.life -= p.decay;
        p.rot += p.vr;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        if (p.star) drawStar(p.x, p.y, p.size * 0.82, p.rot);
        else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.52, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (parts.length) raf = requestAnimationFrame(tick);
      else if (ctx) ctx.clearRect(0, 0, W, H);
    }

    resize();
    window.addEventListener('resize', resize);

    return {
      burst: function (x, y, opts) {
        opts = opts || {};
        var colors = opts.colors || ['#ffc107', '#14b8a6', '#ff6b6b', '#4dabf7', '#b197fc'];
        spawn(x, y, opts.n || 26, colors);
      },
      burstAt: function (el, opts) {
        var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (!r) { this.burst(window.innerWidth / 2, window.innerHeight / 2.4, opts); return; }
        this.burst(r.left + r.width / 2, r.top + r.height / 2, opts);
      }
    };
  })();

  /* ------------------------------------------------------------ 角色 */
  /* 三张图分别对应三种情绪；think（思考中）借用平时的表情，靠 bob 动画区分。
     三张图已经按「同一高度、脚底同基线、头部同中线」裁好，所以换图不会跳动。 */
  var PET_FACE = { idle: 'pet-face-idle', happy: 'pet-face-happy', sad: 'pet-face-sad', think: 'pet-face-idle' };
  var petFaces = [];
  var petFaceNow = '';
  function petEls() {
    if (petFaces.length) return petFaces;
    ['idle', 'happy', 'sad'].forEach(function (k) {
      var el = document.getElementById('pet-face-' + k);
      if (el) petFaces.push(el);
    });
    return petFaces;
  }
  var petTimer = 0;
  function setPet(mood, text) {
    var want = PET_FACE[mood] || PET_FACE.idle;
    if (want !== petFaceNow) {
      petFaceNow = want;
      petEls().forEach(function (el) {
        el.classList.toggle('on', el.id === want);
      });
    }
    petEl.classList.remove('happy', 'sad', 'think');
    if (mood === 'happy') petEl.classList.add('happy');
    else if (mood === 'sad') petEl.classList.add('sad');
    else if (mood === 'think') petEl.classList.add('think');

    if (text) {
      petBubble.textContent = text;
      petBubble.classList.add('on');
      clearTimeout(petTimer);
      petTimer = setTimeout(function () { petBubble.classList.remove('on'); }, 1700);
    }
  }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  var PRAISE = ['漂亮！', '就是这样！', '太稳了', '厉害呀', '答对啦', '这个会了'];
  var CONSOLE = ['再想想~', '差一点点', '看下解析', '别急，慢慢来'];
  var COMBO_WORD = ['', '', '二连击！', '三连击！', '四连！', '五连，好强', '六连！', '七连！', '八连！', '九连！', '十连！'];
  /* 连对播报：一题起报，每多连一题换一档，六连封顶。
     六连之后不再编号——名字再长也没人记得住，改成「好极了」换着夸。
     文案用英文（这几个词孩子打游戏早就熟了），配童声念出来才有那股劲。
     w 是屏幕上的大字，k 是 audio/ 下的文件名——童声 wav 随包发，不靠电视的 TTS。 */
  var KILL = [
    null,
    { w: 'First Blood', k: 'first_blood' },
    { w: 'Double Kill', k: 'double_kill' },
    { w: 'Triple Kill', k: 'triple_kill' },
    { w: 'Quadra Kill', k: 'quadra_kill' },
    { w: 'Penta Kill', k: 'penta_kill' },
    { w: 'Hexa Kill', k: 'hexa_kill' }
  ];
  var KILL_TOP = [{ w: 'Wonderful', k: 'wonderful' }, { w: 'Great', k: 'great' }];
  var killAlt = 1;                       /* 下一句先说 Wonderful（(1+1)%2） */

  function killWord(n) {
    if (n <= 0) return { w: '', k: '' };
    if (n < KILL.length) return KILL[n];
    killAlt = (killAlt + 1) % KILL_TOP.length;
    return KILL_TOP[killAlt];
  }

  /* 开一关就清零：连杀按「这一关连对了几题」算。
     跨关接着数的话，刚点开始答第一题就可能喊 Penta Kill，看着莫名其妙。 */
  function resetCombo() {
    state.combo = 0;
    killAlt = 1;
    saveGame();
    syncHud();
  }

  /* ------------------------------------------------------------ 连击与分数 */
  function bumpCombo(ok) {
    if (ok) {
      state.combo++;
      state.score += 10 + Math.min(state.combo, 6) * 2;
      /* 答题不放合成音——连杀播报本身就是声音，再叠一层「叮叮」就是两个声音抢耳朵 */
      var kw = killWord(state.combo);
      showCombo(kw.w, true);
      if (window.SND && window.SND.say) window.SND.say(kw.k);
      vib('ok');
      setPet('happy', state.combo >= 2
        ? (COMBO_WORD[Math.min(state.combo, COMBO_WORD.length - 1)] || (state.combo + ' 连击！'))
        : pick(PRAISE));
    } else {
      state.combo = 0;
      killAlt = 1;                       /* 断了重数，下一轮还从 Wonderful 开始换 */
      /* 答错念一声「Oh no!」（童声 wav）。真放不出来才退回那个往下沉的低音，
         别一点动静都没有。 */
      if (!(window.SND && window.SND.say && window.SND.say('oh_no'))) sfx('bad');
      vib('bad');
      setPet('sad', pick(CONSOLE));
    }
    saveGame();
    syncHud();
  }
  function syncHud() {
    if (!hud) return;
    hud.hidden = false;
    if (hudCombo) hudCombo.textContent = state.combo;
    if (hudScore) hudScore.textContent = state.score;
  }
  /* kill=true 表示这行是英文连杀播报，字比「x3」长得多，样式按 .kill 收小一号 */
  function showCombo(txt, kill) {
    if (!comboEl) return;
    var sp = comboEl.querySelector('span');
    if (!sp) return;
    sp.textContent = txt;
    sp.setAttribute('data-t', txt);   /* ::before 靠这个属性画描边层 */
    sp.classList.toggle('kill', !!kill);
    comboEl.classList.remove('play');
    void comboEl.offsetWidth;
    comboEl.classList.add('play');
  }

  /* ------------------------------------------------------------ 头部与动作条 */
  function setChrome(title, subtitle, opts) {
    opts = opts || {};
    $('#title').textContent = title;
    $('#subtitle').textContent = subtitle || '';
    btnBack.hidden = !opts.back;
    if (side) side.hidden = !!opts.hideSubjects;
    /* 侧栏收起来时把那一列也塌掉，否则宽屏下内容整体右偏、左边空一大块 */
    var app = $('#app');
    if (app) app.classList.toggle('no-side', !!opts.hideSubjects);
    actionbar.hidden = !opts.action;
    if (opts.action) btnPrimary.textContent = opts.action;
    var s = subj();
    var b = opts.brand || s.brand;
    var b2 = BRAND2[s.key] || b;
    document.documentElement.style.setProperty('--brand', b);
    document.documentElement.style.setProperty('--brand-2', opts.brand2 || b2);
    document.documentElement.style.setProperty('--brand-soft', opts.soft || s.soft);
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', b);
    if (hud) hud.hidden = !opts.hud;
    if (petEl) petEl.hidden = !opts.pet;   /* 只在闯关/结果页出场，免得遮列表 */
  }

  function renderSubjects() {
    subjBar.innerHTML = '';
    D.subjects.forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'chip' + (s.key === state.subject ? ' on' : '');
      b.type = 'button';
      b.textContent = s.name;
      b.addEventListener('click', function () {
        if (state.subject === s.key) return;
        state.subject = s.key;
        state.filter = '';
        localStorage.setItem(LS_SUBJ, s.key);
        go('#/');
      });
      subjBar.appendChild(b);
    });
  }

  /* ------------------------------------------------------------ 首页 */
  function renderHome() {
    var s = subj();
    var totals = subjectTotals(s);
    renderSubjects();
    setChrome('拾知学堂', '四年级上册 · 4 个学科 · ' + D.counts.topics + ' 个知识点 · ' + D.counts.questions +
      ' 道题 · 其中 ' + D.counts.advanced + ' 道拔高', { back: false });

    var html = '';
    html += '<div class="search-wrap">' +
      '<span class="search-icon"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<path d="M16 16l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></span>' +
      '<input id="q" class="search-input" type="search" enterkeyhint="search" autocomplete="off" ' +
      'placeholder="搜知识点，如：' + esc(sampleName(s)) + '" value="' + esc(state.filter) + '"></div>';

    html += '<div class="overview">' +
      ovItem(s.counts.topics, '知识点') +
      ovItem(s.counts.questions, '题目') +
      ovItem(advTotal(s), '拔高题') +
      ovItem(totals.ok, '已掌握') +
      '</div>';

    html += state.filter ? renderSearch(s) : renderUnits(s);
    view.innerHTML = '<div class="enter">' + html + '</div>';

    var input = $('#q');
    if (input) {
      input.addEventListener('input', function () {
        state.filter = input.value;
        var caret = input.selectionStart;
        var box = $('#results');
        if (box) box.outerHTML = state.filter ? renderSearch(s) : renderUnits(s);
        bindUnitToggles();
        var again = $('#q');
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) {} }
      });
    }
    bindUnitToggles();
    renderUnitNav(s);
    setPet('idle');
  }

  function ovItem(n, label) {
    return '<div class="ov-item"><div class="ov-num">' + n + '</div><div class="ov-lab">' + label + '</div></div>';
  }
  function sampleName(s) {
    var first = s.units[0] && s.units[0].ids[0];
    return first ? s.topics[first].n : '知识点';
  }
  function subjectTotals(s) {
    var ok = 0, bad = 0, none = 0;
    Object.keys(s.topics).forEach(function (tid) {
      var st = topicStat(tid);
      if (st.status === 'ok') ok++;
      else if (st.status === 'bad') bad++;
      else if (st.status === 'none') none++;
    });
    return { ok: ok, bad: bad, none: none };
  }

  function renderUnits(s) {
    var openMap = state.open[s.key] || (state.open[s.key] = {});
    var html = '';
    s.units.forEach(function (u, i) {
      var isOpen = openMap[u.name] === undefined ? i === 0 : !!openMap[u.name];
      /* 每个知识点都有 5 道拔高了，这里要数「题」而不是数「知识点」 */
      var advs = u.ids.reduce(function (n, tid) { return n + (s.topics[tid].adv || 0); }, 0);
      html += '<div class="unit' + (isOpen ? ' open' : '') + '" data-unit="' + esc(u.name) + '">' +
        '<button class="unit-head" type="button">' +
        '<span class="u-name">' + esc(u.name) + '</span>' +
        '<span class="u-meta">' + u.ids.length + ' 点 · 拔高 ' + advs + '</span>' +
        '<span class="arrow"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
        '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '</button><div class="unit-body"><div class="unit-inner">';
      u.ids.forEach(function (tid) { html += topicRow(s, tid); });
      html += '</div></div></div>';
    });
    return '<div id="results">' + html + '</div>';
  }

  function renderSearch(s) {
    var f = state.filter.trim().toLowerCase();
    var hits = [];
    Object.keys(s.topics).forEach(function (tid) {
      var t = s.topics[tid];
      var hay = (t.n + ' ' + t.d + ' ' + t.c).toLowerCase();
      if (hay.indexOf(f) >= 0) hits.push(tid);
    });
    var html = hits.length
      ? hits.map(function (tid) { return topicRow(s, tid); }).join('')
      : '<div class="empty">没找到匹配的知识点。</div>';
    return '<div id="results"><div class="section">' + html + '</div>' +
      '<p class="empty">找到 ' + hits.length + ' 个知识点</p></div>';
  }

  function topicRow(s, tid) {
    var t = s.topics[tid];
    var st = topicStat(tid);
    var meta = st.done ? (st.ok + '/' + st.total + ' 对') : (st.total + ' 题');
    return '<button class="topic-row" type="button" data-topic="' + esc(tid) + '">' +
      '<span class="dot ' + (st.status === 'none' ? '' : st.status) + '"></span>' +
      '<span class="t-name">' + esc(t.n) +
      (t.sec ? '<span class="t-sec">' + esc(t.sec) + '</span>' : '') + '</span>' +
      (t.adv ? '<span class="t-adv">拔高 ' + t.adv + '</span>' : '') +
      '<span class="t-stat">' + meta + '</span></button>';
  }

  function bindUnitToggles() {
    Array.prototype.forEach.call(view.querySelectorAll('.unit'), function (u) {
      var head = u.querySelector('.unit-head');
      head.addEventListener('click', function () {
        var name = u.getAttribute('data-unit');
        var openMap = state.open[state.subject] || (state.open[state.subject] = {});
        var next = !u.classList.contains('open');
        u.classList.toggle('open', next);
        openMap[name] = next;
        try { localStorage.setItem(LS_OPEN, JSON.stringify(state.open)); } catch (e) {}
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-topic]'), function (b) {
      b.addEventListener('click', function () { go('#/t/' + b.getAttribute('data-topic')); });
    });
  }

  /* 宽屏左栏的单元索引 */
  function renderUnitNav(s) {
    if (!unitNav) return;
    if (!s.units.length) { unitNav.innerHTML = ''; return; }
    var html = '<div class="unitnav-t">单元</div>';
    s.units.forEach(function (u, i) {
      html += '<a tabindex="0" data-jump="' + esc(u.name) + '">' + esc(u.name) + '</a>';
    });
    unitNav.innerHTML = html;
    Array.prototype.forEach.call(unitNav.querySelectorAll('[data-jump]'), function (a) {
      a.addEventListener('click', function () {
        var name = a.getAttribute('data-jump');
        var unitEl = null;
        Array.prototype.forEach.call(view.querySelectorAll('.unit'), function (u) {
          if (u.getAttribute('data-unit') === name) unitEl = u;
        });
        if (!unitEl) return;
        if (!unitEl.classList.contains('open')) unitEl.querySelector('.unit-head').click();
        unitEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        Array.prototype.forEach.call(unitNav.querySelectorAll('a'), function (x) { x.classList.remove('on'); });
        a.classList.add('on');
      });
    });
  }

  /* ------------------------------------------------------------ 详情 */
  function findTopic(tid) {
    for (var i = 0; i < D.subjects.length; i++) {
      var s = D.subjects[i];
      if (s.topics[tid]) return { s: s, t: s.topics[tid] };
    }
    return null;
  }

  function renderDetail(tid) {
    var hit = findTopic(tid);
    if (!hit) { go('#/'); return; }
    var s = hit.s, t = hit.t;
    var st = topicStat(tid);
    setChrome(s.name, t.sec || unitOf(s, tid), {
      back: true, action: st.total ? '开始闯关 · 抽 ' + Math.min(QUIZ_N, st.total) + ' 题' : '这个点还没有题目',
      brand: s.brand, soft: s.soft
    });
    btnPrimary.disabled = !st.total;
    btnPrimary.onclick = function () { if (st.total) go('#/q/' + tid); };

    var tags = '';
    tags += '<span class="tag brand">' + esc(s.name) + '</span>';
    tags += '<span class="tag">' + esc(t.sec || unitOf(s, tid)) + '</span>';
    if (t.dom) tags += '<span class="tag">' + esc(t.dom) + '</span>';
    /* 四档题量：让「难度梯度」在详情页就能看见 */
    if (t.lv) {
      var ladder = LV_ORDER.filter(function (k) { return t.lv[k]; }).map(function (k) {
        return LV_TEXT[k] + ' ' + t.lv[k];
      }).join(' · ');
      if (ladder) tags += '<span class="tag adv">' + ladder + '</span>';
    }
    tags += '<span class="tag">' + esc(st.total) + ' 题 · ' + STATUS_TEXT[st.status] + '</span>';

    var html = '<div class="enter"><div class="detail-hero"><h2>' + esc(t.n) + '</h2><div class="tagline">' + tags + '</div></div>';

    if (t.d) {
      html += '<div class="section"><h3>这是什么</h3><p>' + esc(t.d) + '</p></div>';
    }
    /* 本单元进度：让「一个单元」这个概念在详情页也看得见 */
    (function () {
      var ui = unitIndexOf(s, tid);
      if (ui < 0) return;
      var us = unitStats(s, ui);
      html += '<div class="section"><h3>本单元</h3><p>' + esc(s.units[ui].name) + ' 共 ' +
        us.rows.length + ' 个知识点、' + us.totQ + ' 道题，已答 ' + us.doneQ + ' 题' +
        (us.doneQ ? '，正确率 ' + Math.round(us.acc * 100) + '%' : '') + '。</p>' +
        '<div class="row" style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<button class="ghost" data-unit="' + ui + '" type="button">看本单元小结</button>' +
        (testSize(s, ui) ? '<button class="ghost" data-test="' + ui + '" type="button">单元测试 · ' +
          testSize(s, ui) + ' 题</button>' : '') +
        '</div></div>';
    })();

    if (t.m && t.m.length) {
      html += '<div class="section"><h3>掌握标准</h3><ul class="criteria">' +
        t.m.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }
    if (t.pre && t.pre.length) {
      html += '<div class="section"><h3>学它之前先掌握</h3><div class="prereq">' +
        t.pre.map(function (p) {
          var name = (s.topics[p.id] || {}).n || p.id;
          return '<button type="button" data-goto="' + esc(p.id) + '">' + esc(name) +
            '<span class="kind">' + (p.kind === 'hard' ? '必备' : '相关') + '</span></button>';
        }).join('') + '</div></div>';
    }
    if (t.st && t.st.length) {
      html += '<div class="section"><h3>对应课标</h3>' +
        t.st.map(function (x) {
          return '<div class="std"><code>' + esc(x.id) + '</code><div>' + esc(x.text) + '</div></div>';
        }).join('') + '</div>';
    }
    if (st.total) {
      var wrong = st.done - st.ok;
      html += '<div class="section"><h3>闯关记录</h3><p>' +
        (st.done ? '做过 ' + st.done + ' / ' + st.total + ' 题，答对 ' + st.ok + ' 题' +
          (wrong ? '，答错 ' + wrong + ' 题' : '') + '。' : '还没闯过这套题。') +
        '</p></div>';
    }
    html += '</div>';
    view.innerHTML = html;

    Array.prototype.forEach.call(view.querySelectorAll('[data-goto]'), function (b) {
      b.addEventListener('click', function () { go('#/t/' + b.getAttribute('data-goto')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-unit]'), function (b) {
      b.addEventListener('click', function () {
        go('#/u/' + s.key + '/' + b.getAttribute('data-unit'));
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-test]'), function (b) {
      b.addEventListener('click', function () {
        go('#/test/' + s.key + '/' + b.getAttribute('data-test'));
      });
    });
    setPet('idle');
  }

  function unitOf(s, tid) {
    for (var i = 0; i < s.units.length; i++) {
      if (s.units[i].ids.indexOf(tid) >= 0) return s.units[i].name;
    }
    return '';
  }

  /* ------------------------------------------------------------ 答题 */
  var LV_TEXT = { basic: '基础', standard: '提高', challenge: '拓展', advanced: '拔高' };
  var LV_ORDER = ['basic', 'standard', 'challenge', 'advanced'];
  var QUIZ_N = 8;                       /* 每关抽几题 */
  var QUIZ_PLAN = { basic: 2, standard: 2, challenge: 2, advanced: 2 };
  /* 单元测试卷：题量随单元规模走（每点 4 题，10~16 题），四档按占比配比 */
  var TEST_PER_TOPIC = 4;
  var TEST_MIN = 10, TEST_MAX = 16;
  var TEST_MIX = { basic: .3, standard: .3, challenge: .25, advanced: .15 };
  var TEST_PASS = 80;                   /* 卷面 ≥80% 算通过 */

  function shuffle(a) {
    var i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 选项位置打散。
     题库里正确答案严重偏 A：484 道选择题 A 229 / B 114 / C 73 / D 68，
     科学单元更是 66% 都是 A（129 题里 A 85、D 只有 3 题）。
     照原样摆出来，学生一路点 A 就能蒙对六成，正确率完全失真。
     每道选择题进卷时把选项重排一遍，标签按显示顺序重写成 A/B/C/D，
     答案跟着换成新标签 —— 显示层解决，不动机库，
     所以同一个知识点连考两次，选项顺序也不一样。 */
  var OPT_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
  function mixOpts(q) {
    if (!q || q.k !== 'choice' || !q.o || q.o.length < 3) return q;
    var src = q.o.slice();
    var order = shuffle(src);
    var c = {};
    for (var k in q) if (Object.prototype.hasOwnProperty.call(q, k)) c[k] = q[k];
    c.o = order.map(function (o, i) {
      return { k: OPT_KEYS[i] || String(i + 1), t: o.t };
    });
    /* 先把正确项找出来，再按它在新顺序里的位置取标签 */
    for (var i = 0; i < order.length; i++) {
      if (String(order[i].k) === String(q.a)) { c.a = c.o[i].k; break; }
    }
    return c;
  }
  function mixList(list) {
    return (list || []).map(mixOpts);
  }

  /* 从知识点的整套题里按「两基础 / 两提高 / 两拓展 / 两拔高」抽 8 道。
     某一档不够就从其余档随机补，保证每关都是 8 题。 */
  function pickQuiz(tid, n) {
    var all = questionsOf(tid);
    n = Math.min(n || QUIZ_N, all.length);
    if (all.length <= n) return all.slice();
    var by = { basic: [], standard: [], challenge: [], advanced: [] };
    all.forEach(function (q) { (by[q.lv] || by.basic).push(q); });
    var out = [];
    LV_ORDER.forEach(function (lv) {
      var want = Math.min(QUIZ_PLAN[lv] || 0, by[lv].length);
      out = out.concat(shuffle(by[lv]).slice(0, want));
    });
    if (out.length < n) {
      var rest = shuffle(all.filter(function (q) { return out.indexOf(q) < 0; }));
      out = out.concat(rest.slice(0, n - out.length));
    }
    /* 只按难度分层，档内保留刚才的随机顺序 */
    out.sort(function (x, y) { return LV_ORDER.indexOf(x.lv) - LV_ORDER.indexOf(y.lv); });
    return out;
  }

  function renderQuizStart(tid) {
    var hit = findTopic(tid);
    if (!hit) { go('#/'); return; }
    var qs = mixList(pickQuiz(tid, QUIZ_N));
    state.quiz = { tid: tid, list: qs, idx: 0, picked: null, judged: false, ok: 0, done: false, right: 0 };
    resetCombo();
    renderQuiz();
  }

  /* ------------------------------------------------------------ 单元测试卷
     单元小结是「看」，单元测试是「测」：把整个单元的知识点混在一起考，
     题量比单关多、覆盖面按知识点轮转，分数按知识点和难度两个维度归因。 */

  function cloneQ(q, tid) {
    var c = { tid: tid };
    for (var k in q) if (Object.prototype.hasOwnProperty.call(q, k)) c[k] = q[k];
    return c;
  }

  function orderByLv(list) {
    return list.map(function (q, i) { return { q: q, i: i }; })
      .sort(function (a, b) {
        return (LV_ORDER.indexOf(a.q.lv) - LV_ORDER.indexOf(b.q.lv)) || (a.i - b.i);
      })
      .map(function (x) { return x.q; });
  }

  /* 卷面题量：知识点少的单元凑 10 题，多的封顶 16 题，不超过池子 */
  function testSize(s, idx) {
    var u = s.units[idx];
    if (!u) return 0;
    var want = Math.max(TEST_MIN, Math.min(TEST_MAX, u.ids.length * TEST_PER_TOPIC));
    var pool = 0;
    u.ids.forEach(function (tid) { pool += questionsOf(tid).length; });
    return Math.min(want, pool);
  }

  function maxLv(quota) {
    var best = LV_ORDER[0];
    LV_ORDER.forEach(function (k) { if (quota[k] > quota[best]) best = k; });
    return best;
  }

  function pickTest(s, idx) {
    var ids = s.units[idx].ids;
    var n = testSize(s, idx);
    if (!n) return [];
    var pool = [];
    ids.forEach(function (tid) {
      questionsOf(tid).forEach(function (q) { pool.push(cloneQ(q, tid)); });
    });
    if (pool.length <= n) return orderByLv(pool);

    /* 每档下再按知识点分桶，取样时轮转知识点，避免同一知识点的题连着出 */
    var by = {};
    LV_ORDER.forEach(function (k) {
      by[k] = {};
      ids.forEach(function (tid) { by[k][tid] = []; });
    });
    pool.forEach(function (q) {
      var b = by[q.lv] || by.basic;
      (b[q.tid] || (b[q.tid] = [])).push(q);
    });
    LV_ORDER.forEach(function (k) {
      ids.forEach(function (tid) { shuffle(by[k][tid]); });
    });

    var quota = {}, sum = 0;
    LV_ORDER.forEach(function (k) {
      quota[k] = Math.round(n * (TEST_MIX[k] || 0));
      sum += quota[k];
    });
    /* 四舍五入会差一两题，从占比最大的那一档加减回来 */
    while (sum > n) { quota[maxLv(quota)]--; sum--; }
    while (sum < n) { quota[maxLv(quota)]++; sum++; }

    var out = [];

    /* 保底轮：每个知识点先占一个名额。
       只按四档配额轮转的话，每次都从 ids[0] 开始取，配额用完时后面的知识点
       一道题都轮不到 —— 科学单元 9 个点、卷面 16 题，实测有 4 个点整卷「未考」，
       而总评照样给 100% 优秀。先保覆盖，再谈四档配比。 */
    ids.forEach(function (tid) {
      if (out.length >= n) return;
      /* 挑「还剩最多名额」的那一档，让配比尽量别被保底轮带偏 */
      var pick = '', best = -1;
      LV_ORDER.forEach(function (k) {
        if (!by[k][tid] || !by[k][tid].length) return;
        var room = quota[k] || 0;
        if (room > best) { best = room; pick = k; }
      });
      if (!pick) return;
      out.push(by[pick][tid].shift());
      if (quota[pick] > 0) quota[pick]--;
    });

    LV_ORDER.forEach(function (k) {
      var want = quota[k], rounds = 0;
      while (want > 0 && rounds < 60) {
        var added = false;
        for (var i = 0; i < ids.length && want > 0; i++) {
          var arr = by[k][ids[i]];
          if (arr.length) { out.push(arr.shift()); want--; added = true; }
        }
        if (!added) break;
        rounds++;
      }
    });
    /* 某档题不够（老单元往往只有 1 道拔高），用剩下的题补齐 */
    if (out.length < n) {
      var used = {};
      out.forEach(function (q) { used[q.id] = 1; });
      out = out.concat(shuffle(pool.filter(function (q) { return !used[q.id]; }))
        .slice(0, n - out.length));
    }
    return orderByLv(out);
  }

  function startTest(key, idx) {
    var s = subjByKey[key];
    if (!s || !s.units[idx]) { go('#/'); return; }
    var list = mixList(pickTest(s, idx));
    if (!list.length) { go('#/u/' + key + '/' + idx); return; }
    state.quiz = {
      kind: 'test', key: key, uIdx: idx, uName: s.units[idx].name,
      list: list, idx: 0, picked: null, judged: false, ok: 0, done: false,
      right: 0, results: {}
    };
    resetCombo();
    renderQuiz();
  }

  function renderQuiz() {
    var q = state.quiz;
    var isTest = q.kind === 'test';
    /* 卷子做完要先判掉，此时 idx 已经越界，取不到当前题 */
    if (q.done) {
      if (isTest) { renderTestResult(); return; }
      var h0 = findTopic(q.tid);
      renderResult(h0.s, h0.t);
      return;
    }
    var hit = findTopic(isTest ? q.list[q.idx].tid : q.tid);
    var s = isTest ? subjByKey[q.key] : hit.s;
    var t = isTest ? { n: '单元测试' } : hit.t;
    var sub = isTest ? (s.name + ' · ' + q.uName) : (s.name + ' · 闯关');
    var last = q.idx + 1 >= q.list.length;
    setChrome(t.n, sub, {
      back: true, hideSubjects: true, action: q.judged ? (last ? '看结果' : '下一题') : '请选择一个答案',
      brand: s.brand, soft: s.soft, hud: true, pet: true
    });
    syncHud();
    btnPrimary.disabled = !q.judged;
    btnPrimary.onclick = nextQuestion;

    var item = q.list[q.idx];
    var pct = Math.round(((q.idx + (q.judged ? 1 : 0)) / q.list.length) * 100);
    var html = '<div class="enter quiz-page">';
    html += '<div class="quiz-top"><span class="quiz-count">' + (q.idx + 1) + ' / ' + q.list.length + '</span>' +
      '<div class="progress"><i style="width:' + pct + '%"></i></div></div>';
    html += '<div class="q-card">';
    html += '<span class="q-lv ' + esc(item.lv) + '">' + (LV_TEXT[item.lv] || '基础') + '</span>';
    html += '<p class="q-prompt">' + esc(item.q) + '</p>';

    if (item.k === 'choice' && item.o && item.o.length) {
      html += '<div class="options">' + item.o.map(function (o) {
        return '<button class="option" type="button" data-key="' + esc(o.k) + '">' +
          '<span class="k">' + esc(o.k) + '</span><span class="t">' + esc(o.t) + '</span></button>';
      }).join('') + '</div>';
    } else if (item.k === 'numeric') {
      html += '<input id="ans" class="answer-input" type="text" inputmode="decimal" autocomplete="off" ' +
        'placeholder="填写答案" enterkeyhint="done">';
    } else {
      html += '<p class="empty">这道题要自己写答案，写完对照参考答案自评。</p>' +
        '<button class="ghost" id="reveal" type="button" style="width:100%;margin-top:10px">看参考答案</button>';
    }
    html += '<div id="fb"></div></div></div>';
    view.innerHTML = html;

    if (item.k === 'choice' && item.o && item.o.length) {
      Array.prototype.forEach.call(view.querySelectorAll('.option'), function (b) {
        b.addEventListener('click', function () { answerChoice(b.getAttribute('data-key')); });
      });
    } else {
      var ans = $('#ans');
      if (ans) {
        ans.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitTyped(); });
        setTimeout(function () { ans.focus(); }, 60);
        setChrome(t.n, sub, {
          back: true, hideSubjects: true, action: '提交答案',
          brand: s.brand, soft: s.soft, hud: true, pet: true
        });
        btnPrimary.disabled = false;
        btnPrimary.onclick = submitTyped;
      } else {
        var reveal = $('#reveal');
        if (reveal) {
          reveal.addEventListener('click', function () {
            reveal.outerHTML = '<div class="feedback"><b>参考答案</b><div>' + esc(item.a) + '</div>' +
              (item.e ? '<div style="margin-top:6px">' + esc(item.e) + '</div>' : '') +
              '</div><div class="row" style="display:flex;gap:10px;margin-top:10px">' +
              '<button class="ghost" id="iok" type="button">我答对了</button>' +
              '<button class="ghost" id="ibad" type="button">我答错了</button></div>';
            $('#iok').addEventListener('click', function () { selfJudge(true); });
            $('#ibad').addEventListener('click', function () { selfJudge(false); });
          });
        }
        setChrome(t.n, sub, {
          back: true, hideSubjects: true, action: '　',
          brand: s.brand, soft: s.soft, hud: true, pet: true
        });
        btnPrimary.disabled = true;
      }
    }
    setPet('think');
    document.body.classList.add('quiz-mode');   // 矮视口下据此收起吉祥物（见 apple_overrides.css）
    fitQuizCard();
    document.body.classList.remove('quiz-judged');
  }

  /* 答题页「一屏装下」的最后一道保险。
     四个选项单列排下来，在矮视口里（手机横屏、折叠屏内屏经兼容容器缩放后 CSS 高度
     往往只有 300~330px）会被压成一条缝，或者干脆被底部按钮盖住。
     这里量一下实际高度，不够就切 2×2 排布；选项文字太长则维持单列，宁可滚动。 */
  function fitQuizCard() {
    var card = view.querySelector('.quiz-page .q-card');
    if (!card) return;
    var opts = card.querySelectorAll('.option');
    if (opts.length !== 4) return;
    var judged = card.classList.contains('judged');
    card.classList.remove('grid2');
    var i, t, min = 1e9, long = false;
    for (i = 0; i < opts.length; i++) {
      t = opts[i].querySelector('.t');
      if (t && t.textContent.replace(/\s/g, '').length > 12) long = true;
      min = Math.min(min, opts[i].offsetHeight);
    }
    /* 高度已经够就别动；被压扁了才切两列——哪怕文字偏长，压成一条缝也比换行更糟 */
    if (min < 36) { card.classList.add('grid2'); return; }
    if (long) return;
    /* 判定后解析铺开会把整页撑长，两列能少滚一半 */
    if (judged && view.scrollHeight > view.clientHeight + 1) card.classList.add('grid2');
  }
  /* 旋屏 / 分屏切换后重排一次 */
  window.addEventListener('resize', function () {
    if (view.querySelector('.quiz-page')) fitQuizCard();
  });

  function afterJudge(right, item, el) {
    var q = state.quiz;
    prog[item.id] = right ? 'ok' : 'bad';
    /* 测试卷的成绩单要按「这一卷」算，不能读 prog——那里只留最后一次判定 */
    if (q.results) q.results[item.id] = !!right;
    saveProgress();
    if (right) {
      q.ok++;
      FX.burstAt(el || $('#fb') || view, { n: item.lv === 'advanced' ? 44 : 28 });
    }
    bumpCombo(right);
    var last = q.idx + 1 >= q.list.length;
    setChrome($('#title').textContent, $('#subtitle').textContent, {
      back: true, hideSubjects: true, brand: subj().brand,
      action: last ? '看结果' : '下一题', hud: true, pet: true
    });
    btnPrimary.disabled = false;
    btnPrimary.onclick = nextQuestion;
  }

  function selfJudge(right) {
    var q = state.quiz;
    if (q.judged) return;
    var item = q.list[q.idx];
    q.judged = true;
    Array.prototype.forEach.call(view.querySelectorAll('#iok, #ibad'), function (b) { b.disabled = true; });
    showFeedback(right, item, true);
    afterJudge(right, item, null);
  }

  function answerChoice(key) {
    var q = state.quiz;
    if (q.judged) return;
    var item = q.list[q.idx];
    var right = String(item.a) === String(key);
    q.picked = key;
    q.judged = true;

    var hitEl = null;
    Array.prototype.forEach.call(view.querySelectorAll('.option'), function (b) {
      var k = b.getAttribute('data-key');
      b.classList.add('locked');
      if (k === String(item.a)) { b.classList.add('ok'); hitEl = b; }
      else if (k === String(key)) b.classList.add('bad');
    });
    showFeedback(right, item);
    afterJudge(right, item, right ? hitEl : null);
    if (!right) {
      var card = view.querySelector('.q-card');
      if (card) { card.style.animation = 'none'; void card.offsetWidth; card.style.animation = 'shake .42s'; }
    }
  }

  function submitTyped() {
    var q = state.quiz;
    if (q.judged) return;
    var item = q.list[q.idx];
    var input = $('#ans');
    var val = input ? input.value : '';
    if (!String(val).trim()) { if (input) input.focus(); return; }
    var right = checkNumeric(val, item.a);
    q.picked = val;
    q.judged = true;

    if (input) { input.disabled = true; input.style.borderColor = right ? 'var(--ok)' : 'var(--bad)'; }
    showFeedback(right, item);
    afterJudge(right, item, input);
  }

  function showFeedback(right, item, noRef) {
    var fb = $('#fb');
    if (!fb) return;
    /* 判定后卡片不再按可用高度撑满，让位给解析文字（样式见 .q-card.judged）；
       同时把吉祥物缩小一号，免得它盖住解析 */
    if (fb.parentNode) fb.parentNode.classList.add('judged');
    document.body.classList.add('quiz-judged');
    /* 矮视口里判定后卡片会长出可视区（解析比选项长），把答题页滚到底，
       让「看思路」和解析露出来，而不是被底部按钮条挡住 */
    var page = view.querySelector('.quiz-page');
    if (page) {
      setTimeout(function () {
        if (page.scrollHeight > page.clientHeight + 1) {
          page.scrollTop = page.scrollHeight;
        }
      }, 80);
    }
    var ref = item.k === 'choice'
      ? (item.o || []).filter(function (o) { return String(o.k) === String(item.a); })
          .map(function (o) { return o.k + '. ' + o.t; }).join('')
      : item.a;
    if (noRef) {
      fb.innerHTML = '<div class="feedback ' + (right ? 'ok' : 'bad') + '"><b>' +
        (right ? '记为答对' : '记为答错') + '</b>' + (item.e ? '<div class="why-body">' + esc(item.e) + '</div>' : '') + '</div>';
      return;
    }
    /* 答错：参考答案和思路都摊开，正是要看的时候
       答对：思路收进折叠，不打扰，想深究再点 */
    var whyOpen = item.e ? '<div class="why-body">' + esc(item.e) + '</div>' : '';
    var whyFold = item.e
      ? '<details class="why"><summary>看思路</summary>' + whyOpen + '</details>'
      : '';
    fb.innerHTML = '<div class="feedback ' + (right ? 'ok' : 'bad') + '">' +
      '<b>' + (right ? '答对了！' : '答错了') + '</b>' +
      (right ? '' : '<div class="ref">参考答案：' + esc(ref) + '</div>') +
      (right ? whyFold : whyOpen) +
      '</div>';
  }

  function nextQuestion() {
    var q = state.quiz;
    if (!q) { go('#/'); return; }
    q.idx++;
    q.judged = false;
    q.picked = null;
    if (q.idx >= q.list.length) { q.done = true; renderQuiz(); return; }
    renderQuiz();
    view.scrollTop = 0;
  }

  function answerText(item) {
    if (item.k === 'choice' && item.o) {
      var hit = item.o.filter(function (o) { return String(o.k) === String(item.a); })[0];
      if (hit) return hit.k + '. ' + hit.t;
    }
    return item.a;
  }

  function renderResult(s, t) {
    var q = state.quiz;
    var total = q.list.length, ok = q.ok;
    var pct = total ? Math.round((ok / total) * 100) : 0;
    setChrome(t.n, '闯关结果', { back: true, hideSubjects: true, brand: s.brand, soft: s.soft, pet: true });
    actionbar.hidden = true;
    if (hud) hud.hidden = true;
    /* 最后一题的连击大字会跟着动画残留在结果页，先掐掉 */
    if (comboEl) comboEl.classList.remove('play');

    var grade = pct >= 95 ? 'S' : pct >= 85 ? 'A' : pct >= 70 ? 'B' : pct >= 50 ? 'C' : 'D';
    var msg = pct >= 90 ? '掌握得不错，可以往后学了。'
      : pct >= 70 ? '基本会了，错的几题再看一遍。'
        : pct >= 40 ? '还有明显漏洞，建议回看知识点再闯一次。'
          : '建议先把知识点说明读一遍，再来一次。';

    var wrong = q.list.filter(function (it) { return prog[it.id] === 'bad'; });
    var html = '<div class="enter result-page"><div class="result">' +
      '<div class="big">' + pct + '<small>%</small></div>' +
      '<div class="msg">' + ok + ' / ' + total + ' 题答对 · 评级 ' + grade + ' · ' + esc(msg) + '</div>' +
      '<div class="row">' +
      '<button class="ghost" id="again" type="button">再闯一次</button>' +
      '<button class="ghost" id="back2" type="button">看知识点</button>' +
      (unitIndexOf(s, q.tid) >= 0
        ? '<button class="ghost" id="u-report" type="button">本单元小结</button>' : '') +
      '</div></div>';

    if (wrong.length) {
      html += wrongCardsHtml(wrong);
    } else if (total) {
      html += '<div class="section"><h3>全部答对</h3><p>这套题没有错题，可以看下一个知识点了。</p></div>';
    }
    html += '</div>';
    view.innerHTML = html;
    $('#again').addEventListener('click', function () { renderQuizStart(q.tid); });
    $('#back2').addEventListener('click', function () { go('#/t/' + q.tid); });
    if ($('#u-report')) {
      $('#u-report').addEventListener('click', function () {
        go('#/u/' + s.key + '/' + unitIndexOf(s, q.tid));
      });
    }

    if (pct >= 80) {
      sfx('pass');
      vib('win');
      setPet('happy', '评级 ' + grade + '！');
      FX.burst(window.innerWidth / 2, window.innerHeight * 0.32, { n: 60 });
    } else if (pct >= 50) {
      setPet('idle', '继续加油');
    } else {
      sfx('fail');
      setPet('sad', '再来一次吧');
    }
  }

  function wrongCardsHtml(list) {
    return '<div class="section"><h3>这几题还没过（' + list.length + '）</h3>' +
      list.map(function (it, i) {
        return '<div class="wrong-card">' +
          '<div class="wc-q"><span class="wc-no">' + (i + 1) + '</span>' + esc(it.q) + '</div>' +
          '<div class="wc-row"><span class="wc-tag ok">正确答案</span>' +
            '<span class="wc-v">' + esc(answerText(it)) + '</span></div>' +
          (it.e ? '<div class="wc-row"><span class="wc-tag why">解题思路</span>' +
            '<span class="wc-v">' + esc(it.e) + '</span></div>' : '') +
          '</div>';
      }).join('') + '</div>';
  }

  /* ------------------------------------------------------------ 单元测试成绩单 */
  function renderTestResult() {
    var q = state.quiz, s = subjByKey[q.key];
    var total = q.list.length, ok = q.ok;
    var pct = total ? Math.round((ok / total) * 100) : 0;
    var pass = pct >= TEST_PASS;
    setChrome('单元测试报告', s.name + ' · ' + q.uName, {
      back: true, hideSubjects: true, brand: s.brand, soft: s.soft, pet: true
    });
    actionbar.hidden = true;
    if (hud) hud.hidden = true;
    if (comboEl) comboEl.classList.remove('play');

    /* 按知识点和按难度各归一次因：错的是哪个点、哪一档 */
    var byT = {}, byL = {}, order = [];
    q.list.forEach(function (it) {
      var r = q.results[it.id] === true;
      if (!byT[it.tid]) { byT[it.tid] = { t: 0, ok: 0 }; order.push(it.tid); }
      byT[it.tid].t++; if (r) byT[it.tid].ok++;
      var b = byL[it.lv] || (byL[it.lv] = { t: 0, ok: 0 });
      b.t++; if (r) b.ok++;
    });
    /* 一个知识点都没抽到的（老单元某档题太少时可能发生）也要占一行 */
    s.units[q.uIdx].ids.forEach(function (tid) {
      if (!byT[tid]) byT[tid] = { t: 0, ok: 0 };
    });

    var grade = pct >= 90 ? '优秀' : pass ? '通过' : pct >= 60 ? '待巩固' : '要重学';
    var msg = pct >= 90 ? '这个单元学得挺牢，可以往后走了。'
      : pass ? '基本掌握，把错的几题看完思路就算过。'
        : pct >= 60 ? '还差一口气，回单元小结看看哪一档最弱。'
          : '基础还不稳，先回知识点把说明读一遍。';

    var html = '<div class="enter"><div class="result result-sm">' +
      '<div class="big">' + pct + '<small>%</small></div>' +
      '<div class="msg">' + ok + ' / ' + total + ' 题 · ' + grade + ' · ' + esc(msg) + '</div>' +
      '<div class="row">' +
      '<button class="ghost" id="t-again" type="button">再测一次</button>' +
      '<button class="ghost" id="t-report" type="button">回单元小结</button>' +
      '</div></div>';

    /* 知识点得分 */
    html += '<div class="section"><h3>知识点得分</h3><div class="score-list">';
    s.units[q.uIdx].ids.forEach(function (tid) {
      var a = byT[tid] || { t: 0, ok: 0 };
      var p = a.t ? a.ok / a.t : 0;
      var cls = !a.t ? 'bad' : p >= 0.8 ? 'ok' : p >= 0.5 ? 'mid' : 'bad';
      html += '<div class="score-row">' +
        '<span class="s-name">' + esc((s.topics[tid] || {}).n || tid) + '</span>' +
        '<span class="s-bar"><i class="' + cls + '" style="width:' +
          (a.t ? Math.round(p * 100) : 0) + '%"></i></span>' +
        '<span class="s-num">' + (a.t ? a.ok + '/' + a.t : '未考') + '</span></div>';
    });
    html += '</div></div>';

    /* 四档得分 */
    html += '<div class="section"><h3>四档得分</h3><div class="lv-grid">';
    LV_ORDER.forEach(function (k) {
      var b = byL[k];
      if (!b) return;
      html += '<div class="lv-cell' + (b.ok === b.t ? ' full' : '') + '">' +
        '<b>' + LV_TEXT[k] + '</b><span class="n">' + b.ok + ' / ' + b.t + '</span></div>';
    });
    html += '</div></div>';

    /* 真有知识点一道题都没抽到时，得说清楚：这卷 100% 不代表整个单元会了 */
    var missed = s.units[q.uIdx].ids.filter(function (tid) {
      return !byT[tid] || !byT[tid].t;
    });
    if (missed.length) {
      html += '<div class="section"><h3>有 ' + missed.length + ' 个知识点没考到</h3><p>' +
        '这一卷没能覆盖 ' + esc(missed.map(function (tid) {
          return '《' + ((s.topics[tid] || {}).n || tid) + '》';
        }).join('、')) + '，分数只代表抽到的那部分。' +
        '去单元小结单独练这几个点更准。</p></div>';
    }

    var wrong = q.list.filter(function (it) { return q.results[it.id] === false; });
    if (wrong.length) {
      html += wrongCardsHtml(wrong);
    } else {
      html += '<div class="section"><h3>全部答对</h3><p>整卷没有错题，这个单元可以过了。</p></div>';
    }
    html += '</div>';
    view.innerHTML = html;

    /* 直接重开一卷：走 hash 会被 render() 的滚动位置恢复拖回卷尾 */
    $('#t-again').addEventListener('click', function () {
      startTest(q.key, q.uIdx);
      view.scrollTop = 0;
    });
    $('#t-report').addEventListener('click', function () { go('#/u/' + q.key + '/' + q.uIdx); });

    if (pass) {
      sfx('pass');
      vib('win');
      setPet('happy', grade + '！');
      FX.burst(window.innerWidth / 2, window.innerHeight * 0.3, { n: 70 });
    } else {
      if (pct < 60) sfx('fail');
      setPet(pct >= 60 ? 'idle' : 'sad', pct >= 60 ? '再巩固一下' : '回知识点看看');
    }
  }

  /* ------------------------------------------------------------ 进度页 */
  /* ------------------------------------------------------------ 单元小结 */
  function unitIndexOf(s, tid) {
    for (var i = 0; i < s.units.length; i++) {
      if (s.units[i].ids.indexOf(tid) >= 0) return i;
    }
    return -1;
  }

  function unitStats(s, idx) {
    var u = s.units[idx];
    var lv = {};
    LV_ORDER.forEach(function (k) { lv[k] = { t: 0, d: 0, o: 0 }; });
    var rows = [], totQ = 0, doneQ = 0, okQ = 0;
    var cnt = { ok: 0, warn: 0, bad: 0, none: 0 };
    u.ids.forEach(function (tid) {
      var t = s.topics[tid];
      var st = topicStat(tid);
      questionsOf(tid).forEach(function (q) {
        var k = lv[q.lv] ? q.lv : 'basic';
        lv[k].t++;
        var r = prog[q.id];
        if (r) { lv[k].d++; if (r === 'ok') lv[k].o++; }
      });
      totQ += st.total; doneQ += st.done; okQ += st.ok;
      cnt[st.status]++;
      rows.push({
        tid: tid, name: t.n, status: st.status,
        total: st.total, done: st.done, ok: st.ok, acc: st.acc
      });
    });
    return { name: u.name, rows: rows, lv: lv, totQ: totQ, doneQ: doneQ, okQ: okQ,
      cnt: cnt, acc: doneQ ? okQ / doneQ : 0 };
  }

  /* 建议按「先补覆盖、再补短板、最后看难度梯度」的顺序给，最多三条 */
  function unitAdvice(r) {
    var out = [];
    /* 一道题没做时别硬套「还有 3 个知识点没测过」，直接给出第一步 */
    if (!r.doneQ) {
      /* 题数跟着题库走：每关最多 8 题，题少的知识点实际只会出 5 题，
         这里写死 8 会和学生进去看到的不一样 */
      var first = r.rows[0];
      var ask = Math.min(QUIZ_N, first.total);
      return ['这个单元还没开始练。先做《' + first.name + '》一轮（' + ask + ' 题），' +
        '做完回来就能看到自己卡在基础还是拔高。'];
    }
    var untouched = r.rows.filter(function (x) { return !x.done; });
    var weak = r.rows.filter(function (x) { return x.done && x.acc < 0.6; });
    var mid = r.rows.filter(function (x) { return x.done && x.acc >= 0.6 && x.acc < 0.8; });
    var names = function (arr, n) {
      return arr.slice(0, n).map(function (x) { return '《' + x.name + '》'; }).join('、') +
        (arr.length > n ? ' 等 ' + arr.length + ' 个' : '');
    };
    var pct = function (x) { return Math.round(x * 100) + '%'; };

    if (untouched.length) {
      out.push('还有 ' + untouched.length + ' 个知识点没测过：' + names(untouched, 2) +
        '，各闯一轮就知道哪里要补。');
    }
    if (weak.length) {
      out.push(names(weak, 2) + ' 正确率不到 60%，先回看知识点说明再闯，不要直接刷题。');
    } else if (mid.length) {
      out.push(names(mid, 2) + ' 已经到 60% 以上，再练一轮就能标成「已掌握」。');
    }

    /* 难度梯度：基础没问题但拔高垮，是最典型的「会做但不会想」 */
    var b = r.lv.basic, a = r.lv.advanced, c = r.lv.challenge;
    var bAcc = b.d ? b.o / b.d : 1;
    var aAcc = a.d ? a.o / a.d : 1;
    var cAcc = c.d ? c.o / c.d : 1;
    if (b.d >= 4 && bAcc < 0.7) {
      out.push('基础正确率只有 ' + pct(bAcc) + '，先把基础题做熟，拔高题暂时不用急着刷。');
    } else if (a.d >= 4 && aAcc < 0.5 && bAcc >= 0.8) {
      out.push('基础 ' + pct(bAcc) + '、拔高只有 ' + pct(aAcc) +
        '：不是不会算，是读题和推理要再慢一点，先把条件在草稿上写清楚。');
    } else if (c.t && c.d >= 4 && cAcc < 0.6) {
      out.push('拓展题正确率 ' + pct(cAcc) + '，这类题考的是「多绕一步」，做完回头检查一遍条件有没有漏用。');
    }

    if (!out.length && r.cnt.ok === r.rows.length) {
      out.push('本单元 ' + r.rows.length + ' 个知识点全部掌握，可以进入下一个单元了。');
    }
    if (!out.length) {
      out.push('整体正确率 ' + pct(r.acc) + '，节奏正常，按现在的速度把剩下的题练完就行。');
    }
    return out.slice(0, 3);
  }

  function renderUnitReport(key, idx) {
    var s = subjByKey[key];
    if (!s || !s.units[idx]) { go('#/'); return; }
    var r = unitStats(s, idx);
    var advice = unitAdvice(r);
    var next = r.rows.filter(function (x) { return x.status !== 'ok'; });

    setChrome('单元小结', r.name, { back: true, hideSubjects: true, brand: s.brand, soft: s.soft });
    if (hud) hud.hidden = true;
    /* 全掌握时按钮换成单元测试——这时候最该做的是检验，不是继续刷 */
    var tn = testSize(s, idx);
    actionbar.hidden = !(next.length || tn);
    if (next.length) {
      btnPrimary.textContent = '继续练《' + next[0].name + '》';
      btnPrimary.onclick = function () { go('#/q/' + next[0].tid); };
    } else if (tn) {
      btnPrimary.textContent = '单元测试 · ' + tn + ' 题';
      btnPrimary.onclick = function () { go('#/test/' + key + '/' + idx); };
    }

    var pct = function (x) { return Math.round(x * 100) + '%'; };
    /* 条形画的是「做过的题占本档题量的多少」，绿色对、红色错，
       所以做满 2/15 时条就该只有一小截；正确率另用色块标出来，
       否则一小截绿条配「正确率 100%」会被读成「才 13% 正确率」 */
    var bar = function (d, o, t) {
      var wOk = t ? Math.round(o / t * 100) : 0;
      var wBad = t ? Math.round((d - o) / t * 100) : 0;
      return '<div class="bar"><i class="b-ok" style="width:' + wOk + '%"></i>' +
        '<i class="b-bad" style="width:' + wBad + '%"></i></div>';
    };
    var pill = function (d, o) {
      if (!d) return '<i class="lv-pill none">未做</i>';
      var a = o / d;
      return '<i class="lv-pill ' + (a >= 0.8 ? 'ok' : a >= 0.6 ? 'mid' : 'bad') + '">' +
        pct(a) + '</i>';
    };

    var html = '<div class="enter">';
    html += '<div class="result">' + (r.doneQ
      ? '<div class="big">' + pct(r.acc) + '<small>正确率</small></div>'
      : '<div class="big none">还没开始</div>') +
      '<div class="msg">' + r.name + ' · ' + r.rows.length + ' 个知识点 · ' +
      r.totQ + ' 道题' + (r.doneQ ? ' · 已答 ' + r.doneQ + ' 题' : '') +
      '</div></div>';

    /* 四档表现：还没补齐四档的老单元可能只有两三档，标题跟着实际档数走 */
    var lvHave = LV_ORDER.filter(function (k) { return r.lv[k].t > 0; });
    html += '<div class="section"><h3>' + (lvHave.length === 4 ? '四档表现' : '各档表现') + '</h3>';
    LV_ORDER.forEach(function (k) {
      var x = r.lv[k];
      if (!x.t) return;
      html += '<div class="stat-card lv-card">' +
        '<div class="stat-head"><b>' + LV_TEXT[k] + '</b>' +
        '<span class="lv-num">' + pill(x.d, x.o) +
        (x.d ? '<em>答 ' + x.d + ' / ' + x.t + ' 题</em>' : '<em>共 ' + x.t + ' 题</em>') +
        '</span></div>' +
        bar(x.d, x.o, x.t) + '</div>';
    });
    html += '</div>';

    /* 建议 */
    html += '<div class="section"><h3>接下来怎么练</h3><ul class="criteria">' +
      advice.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';

    /* 知识点清单 */
    html += '<div class="section"><h3>知识点</h3>';
    r.rows.forEach(function (x) {
      html += '<button class="topic-row" type="button" data-topic="' + esc(x.tid) + '">' +
        '<span class="dot ' + (x.status === 'none' ? '' : x.status) + '"></span>' +
        '<span class="t-name">' + esc(x.name) + '</span>' +
        '<span class="t-stat">' + (x.done ? x.ok + '/' + x.total + ' 对' : x.total + ' 题') +
        ' · ' + STATUS_TEXT[x.status] + '</span></button>';
    });
    html += '</div>';

    /* 单元测试：小结是「看」，这里是「测」 */
    if (tn) {
      var lvNote = LV_ORDER.filter(function (k) { return r.lv[k].t; })
        .map(function (k) { return LV_TEXT[k]; }).join('/');
      /* 缺档的单元（英语大多没有拓展题）不能说「四档都覆盖」 */
      var lvWord = lvHave.length === 4 ? '四档' : '现有的 ' + lvHave.length + ' 档';
      html += '<div class="section"><h3>单元测试</h3><p>' +
        '把本单元 ' + r.rows.length + ' 个知识点混在一起考，' + lvWord + '（' + lvNote + '）都覆盖，' +
        '共 ' + tn + ' 题。做完出成绩单：按知识点和难度分开算分，看看是真会了，' +
        '还是只在某一个点上顺。</p>' +
        '<button class="ghost" id="u-test" type="button" style="width:100%;margin-top:10px">' +
        '开始单元测试 · ' + tn + ' 题</button></div>';
    }
    html += '</div>';
    view.innerHTML = html;

    Array.prototype.forEach.call(view.querySelectorAll('[data-topic]'), function (b) {
      b.addEventListener('click', function () { go('#/t/' + b.getAttribute('data-topic')); });
    });
    if ($('#u-test')) {
      $('#u-test').addEventListener('click', function () { go('#/test/' + key + '/' + idx); });
    }
    setPet('idle');
  }

  function renderStats() {
    setChrome('学习进度', '做完的题会记在这台设备上', { back: true, hideSubjects: true });
    if (hud) hud.hidden = true;
    var cards = '';
    var all = { topics: 0, ok: 0, bad: 0, none: 0, done: 0, total: 0 };
    D.subjects.forEach(function (s) {
      var t = { ok: 0, bad: 0, none: 0, part: 0 };
      Object.keys(s.topics).forEach(function (tid) {
        var st = topicStat(tid);
        if (st.status === 'ok') t.ok++;
        else if (st.status === 'bad') t.bad++;
        else if (st.status === 'none') t.none++;
        else t.part++;
        all.topics++;
      });
      var doneQ = 0, okQ = 0;
      Object.keys(s.topics).forEach(function (tid) {
        questionsOf(tid).forEach(function (q) {
          var r = prog[q.id];
          if (r) { doneQ++; if (r === 'ok') okQ++; }
        });
      });
      all.done += doneQ; all.total += s.counts.questions;

      var pctOk = s.counts.topics ? Math.round((t.ok / s.counts.topics) * 100) : 0;
      cards += '<div class="stat-card">' +
        '<div class="stat-head"><b>' + esc(s.name) + '</b><span>已答 ' + doneQ + ' / ' + s.counts.questions + ' 题</span></div>' +
        '<div class="bar">' +
        '<i class="b-ok" style="width:' + (t.ok / s.counts.topics * 100) + '%"></i>' +
        '<i class="b-bad" style="width:' + ((t.bad + t.part) / s.counts.topics * 100) + '%"></i>' +
        '</div>' +
        '<div class="legend"><span><i style="background:var(--ok)"></i>已掌握 ' + t.ok + '</span>' +
        '<span><i style="background:var(--bad)"></i>待复习 ' + (t.bad + t.part) + '</span>' +
        '<span><i style="background:var(--line)"></i>未测 ' + t.none + '</span></div>' +
        '<div class="legend" style="margin-top:6px"><span>掌握率 ' + pctOk + '% · 题目正确 ' + okQ + ' 题</span></div>' +
        '</div>';
    });

    var html = '<div class="enter">' +
      '<div class="section"><h3>总体</h3><p>' + D.counts.topics + ' 个知识点、' + D.counts.questions +
      ' 道题（含 ' + D.counts.advanced + ' 道拔高），已答 ' + all.done + ' 题（' +
      Math.round(all.done / all.total * 100) + '%）。累计得分 ' + state.score + '。</p></div>' +
      cards +
      '<p class="empty">题目与课标均为初稿，未经教师审核；拔高题为按教辅难度梯度自拟。</p></div>';
    view.innerHTML = html;

    btnPrimary.hidden = true;
    actionbar.hidden = true;
    setPet('idle');
  }

  /* ------------------------------------------------------------ 路由 */
  function go(hash) {
    if (location.hash === hash) { render(); return; }
    location.hash = hash;
  }

  function parse() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h || h === '/') return { name: 'home' };
    var m = /^\/test\/(\w+)\/(\d+)$/.exec(h);
    if (m) return { name: 'test', subj: m[1], idx: +m[2] };
    m = /^\/t\/(.+)$/.exec(h);
    if (m) return { name: 'detail', id: decodeURIComponent(m[1]) };
    m = /^\/q\/(.+)$/.exec(h);
    if (m) return { name: 'quiz', id: decodeURIComponent(m[1]) };
    m = /^\/u\/(\w+)\/(\d+)$/.exec(h);
    if (m) return { name: 'unit', subj: m[1], idx: +m[2] };
    if (h === '/stats') return { name: 'stats' };
    return { name: 'home' };
  }

  var lastHash = null;
  function render() {
    var r = parse();
    if (lastHash) state.scroll[lastHash] = view.scrollTop;
    document.body.classList.remove('quiz-mode');   // 离开答题页就还原吉祥物
    actionbar.hidden = true;
    btnPrimary.hidden = false;
    view.scrollTop = 0;

    if (r.name === 'detail') renderDetail(r.id);
    else if (r.name === 'quiz') renderQuizStart(r.id);
    else if (r.name === 'test') startTest(r.subj, r.idx);
    else if (r.name === 'unit') renderUnitReport(r.subj, r.idx);
    else if (r.name === 'stats') renderStats();
    else { state.quiz = null; renderHome(); }

    lastHash = location.hash || '#/';
    var keep = state.scroll[lastHash];
    if (keep) view.scrollTop = keep;
  }

  window.addEventListener('hashchange', render);

  if ($('#btn-stats')) $('#btn-stats').addEventListener('click', function () { go('#/stats'); });

  /* ------------------------------------------------------------ 方向键 / 遥控器
     WebView 默认只认 Tab，电视遥控的上下左右需要自己接管：按 DOM 顺序移动焦点，
     Enter/OK 交给浏览器的默认点击行为。 */
  (function () {
    var SEL = '.chip, .unit-head, .topic-row, .option, .prereq button, ' +
      '.ghost, .primary, .icon-btn, .unitnav a';
    function visibleNodes() {
      return Array.prototype.filter.call(document.querySelectorAll(SEL), function (el) {
        if (el.disabled || el.hidden) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    }
    document.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'ArrowLeft' && k !== 'ArrowRight') return;
      var list = visibleNodes();
      if (!list.length) return;
      var i = list.indexOf(document.activeElement);
      var next;
      if (i < 0) {
        next = 0;
      } else {
        var fwd = (k === 'ArrowDown' || k === 'ArrowRight');
        next = i + (fwd ? 1 : -1);
        if (next < 0) next = 0;
        if (next > list.length - 1) next = list.length - 1;
      }
      list[next].focus();
      e.preventDefault();
    }, true);

    document.addEventListener('focusin', function (e) {
      Array.prototype.forEach.call(document.querySelectorAll('.kbd-focus'), function (el) {
        el.classList.remove('kbd-focus');
      });
      if (e.target && e.target.classList) e.target.classList.add('kbd-focus');
    }, true);
  })();

  /* Android 返回键：先在页面内后退，退到底再交回系统 */
  /* 顶栏的 ‹ 之前没绑事件，点了没反应；和物理返回键走同一套后退逻辑 */
  if (btnBack) {
    btnBack.addEventListener('click', function () {
      if (!window.APP_BACK()) { /* 已在首页就不动 */ }
    });
  }

  window.APP_BACK = function () {
    var h = location.hash.replace(/^#/, '');
    if (h && h !== '/') { history.back(); return true; }
    return false;
  };

  if (!location.hash) history.replaceState(null, '', '#/');
  render();
})();
