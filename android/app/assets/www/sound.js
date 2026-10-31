/* 音效与触感
 *
 * 全部用 Web Audio 现场合成，不打包任何音频文件——APK 里 assets/www 本来就没有
 * 音频资源，加 wav/mp3 会让包体从 400KB 涨上去，而这里只需要五六个短音。
 *
 * 照社区通行做法（Bleeps、brain-battle、tiks 这几个都是同一路子）：
 *   1. AudioContext 不做一进页面就 new，那样拿到的是 suspended，一定要落在
 *      用户手势里创建/恢复；
 *   2. 每个音必须有包络：快攻 12ms + 指数衰减到 0.0001。直接 start/stop 会
 *      "啪"一声爆音，指数衰减也不能真的到 0（会抛 InvalidStateError）；
 *   3. 答对用上行（C5→G5，纯五度，明亮但不尖），答错用下行锯齿波并过 lowpass
 *      把刺耳的高频切掉，低频再加一个正弦垫底，听感是"钝"而不是"炸"；
 *   4. 必须有静音开关并持久化——晚上做题不能吵到家里人。
 *
 * 振动走 navigator.vibrate，需要 AndroidManifest 里的 VIBRATE 权限（普通权限，
 * 不弹窗）。电视/盒子没有马达，调用会静默失败，不需要特判。
 */
(function () {
  'use strict';

  var LS_SOUND = 'g4.sound.v1';
  var LS_HAPTIC = 'g4.haptic.v1';

  var VOL = 0.8;                          /* 总音量：峰值约 0.28，电视外放够听又不炸 */
  var AC = null, bus = null, broken = false, played = 0, voiced = 0;
  var soundOn = read(LS_SOUND) !== '0';
  var hapticOn = read(LS_HAPTIC) !== '0';

  function read(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式 */ }
  }

  /* 懒创建。suspended 时顺手 resume——Android WebView 首次要手势才放行。 */
  function ctx() {
    if (broken) return null;
    if (AC) {
      if (AC.state === 'suspended') { try { AC.resume(); } catch (e) {} }
      return AC;
    }
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) { broken = true; return null; }
    try {
      AC = new C();
      bus = AC.createGain();
      bus.gain.value = VOL;
      bus.connect(AC.destination);
      if (AC.state === 'suspended') AC.resume();
    } catch (e) {
      broken = true;
      AC = null;
      return null;
    }
    return AC;
  }

  /* 一个音：at 是相对现在的延迟，to 是滑到的目标频率，lp 是低通截止。
     C / dest 只在离屏渲染时传进来，平时走全局上下文。 */
  function tone(o, C, dest) {
    var c = C || ctx();
    if (!c) return;
    var out = dest || bus;
    if (!out) return;
    var t0 = c.currentTime + (o.at || 0);
    var dur = o.dur || 0.15;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.v || 0.3, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var tail = osc;
    if (o.lp) {
      var f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t0);
      f.Q.value = 0.9;
      osc.connect(f);
      tail = f;
    }
    tail.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /* C5 = 523.25, E5 = 659.25, G5 = 783.99
   *
   * 答题时**不再放合成的提示音**：答对、连对已经由童声播报 First Blood／Double Kill
   * 这类词，再叠一层「叮叮叮」就成了两个声音抢耳朵。原来的 ok / streak 两个音色
   * 整个删掉了，只剩交卷的 pass / fail 和一个兜底用的 bad。
   * bad 留着是因为：电视上没装 TTS 引擎时念不出「Oh no!」，
   * 这时候总得有点动静，才退回来放这个低音（不是「叮」，往下沉的一小声）。 */
  var PATCH = {
    /* 答错兜底：锯齿波从 G3 滑到 D3，低通 820Hz 削掉毛刺，下面垫一个 131Hz 的正弦 */
    bad: function (C, dest) {
      tone({ f: 196.00, to: 146.83, dur: 0.26, type: 'sawtooth', v: 0.14, lp: 820 }, C, dest);
      tone({ f: 130.81, dur: 0.24, type: 'sine', v: 0.17 }, C, dest);
    },
    /* 通过：C-E-G 上行，最后一个音拉长收住 */
    pass: function (C, dest) {
      tone({ f: 523.25, dur: 0.12, type: 'triangle', v: 0.3 }, C, dest);
      tone({ f: 659.25, at: 0.1, dur: 0.12, type: 'triangle', v: 0.3 }, C, dest);
      tone({ f: 783.99, at: 0.2, dur: 0.32, type: 'triangle', v: 0.32 }, C, dest);
    },
    /* 没过：G4 掉到 D4，两个音，不刺耳也不敷衍 */
    fail: function (C, dest) {
      tone({ f: 392.00, dur: 0.2, type: 'triangle', v: 0.26 }, C, dest);
      tone({ f: 293.66, at: 0.16, dur: 0.32, type: 'triangle', v: 0.26 }, C, dest);
    }
  };

  var VIB = {
    ok: 10,                        /* 轻点一下，确认用的，别太明显 */
    bad: [0, 40, 50, 40],          /* 两下，和"答错"的音一样是两段 */
    win: [0, 30, 55, 30, 55, 80]   /* 三下，收个尾 */
  };

  function play(name) {
    if (!soundOn || !PATCH[name]) return false;
    if (!ctx()) return false;
    try { PATCH[name](); } catch (e) { return false; }
    played++;                 /* 计数比 hook 可靠：内部调用不走 window.SND */
    return true;
  }

  function buzz(kind) {
    if (!hapticOn) return false;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    try { return navigator.vibrate(VIB[kind] || 12); } catch (e) { return false; }
  }

  /* 播报（连杀用的 "First Blood" 这类）走随包发的童声 wav。
   *
   * 为什么不再用安卓 TextToSpeech：电视上普遍没装 TTS 引擎，小米电视实测
   * TextToSpeech 初始化直接返回 ERROR，一个字都念不出来——用户听到的就是
   * 「没声音」。音频文件躺在 assets 里，没有引擎也照样能放。
   * 文件由 tools/make_voices.py 生成：SAPI 合成本地女声，再整体升调 1.3 倍，
   * 基频落在 220~320Hz，就是十岁上下的音区。
   *
   * 兜底链：wav 放不了 → 系统 TTS 念英文 → 都没有就安静（大字仍然看得见）。
   */
  var VOICE = {
    hi:          'audio/hi.wav',
    first_blood: 'audio/first_blood.wav',
    double_kill: 'audio/double_kill.wav',
    triple_kill: 'audio/triple_kill.wav',
    quadra_kill: 'audio/quadra_kill.wav',
    penta_kill:  'audio/penta_kill.wav',
    hexa_kill:   'audio/hexa_kill.wav',
    wonderful:   'audio/wonderful.wav',
    great:       'audio/great.wav',
    oh_no:       'audio/oh_no.wav'
  };
  /* TTS 兜底时要念的原文 */
  var VOICE_TEXT = {
    hi: 'Hi', first_blood: 'First Blood', double_kill: 'Double Kill',
    triple_kill: 'Triple Kill', quadra_kill: 'Quadra Kill',
    penta_kill: 'Penta Kill', hexa_kill: 'Hexa Kill',
    wonderful: 'Wonderful', great: 'Great', oh_no: 'Oh no!'
  };

  var clips = {};                 /* key → <audio>，只建一次 */
  var live = null;                /* 正在响的那个；新的一句先把旧的按停 */

  function clip(key) {
    if (clips[key]) return clips[key];
    var A = window.Audio;
    if (!A || !VOICE[key]) return null;
    try {
      var el = new A(VOICE[key]);
      el.preload = 'auto';
      el.volume = 1;
      /* 加载失败记在元素上：不记的话每次答题都白试一遍，还不出声 */
      el.addEventListener('error', function () { el.dead = true; });
      clips[key] = el;
      return el;
    } catch (e) {
      return null;
    }
  }

  /* 进页面就把十个短句都建好。都是本地文件，一秒内读完，答题时零等待 */
  function warm() {
    for (var k in VOICE) {
      if (Object.prototype.hasOwnProperty.call(VOICE, k)) clip(k);
    }
  }

  function ttsSay(key) {
    var b = window.AndroidTTS;
    if (!b || typeof b.speak !== 'function') return false;
    try { b.speak(VOICE_TEXT[key] || String(key)); return true; } catch (e) { return false; }
  }

  function say(key) {
    if (!soundOn) return false;
    var el = clip(key);
    if (el && !el.dead) {
      try {
        if (live && live !== el) {
          try { live.pause(); live.currentTime = 0; } catch (e) { /* 还没加载完 */ }
        }
        live = el;
        if (el.readyState > 0) el.currentTime = 0;
        var p = el.play();
        /* 自动播放被拦（没有用户手势）时退到系统 TTS，别一声不响 */
        if (p && typeof p.catch === 'function') p.catch(function () { ttsSay(key); });
        voiced++;
        return true;
      } catch (e) { /* 落到 TTS */ }
    }
    if (ttsSay(key)) { voiced++; return true; }
    return false;
  }

  /* 离屏渲染一个音，返回 AudioBuffer。验收和导出预览都用它。
     参数是 (声道数, 帧数, 采样率)，不是时长——帧数 = 采样率 × 秒数 */
  function render(name) {
    var O = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!O || !PATCH[name]) return Promise.resolve(null);
    var off;
    try { off = new O(1, 44100, 44100); } catch (e) { return Promise.resolve(null); }
    var g = off.createGain();
    g.gain.value = VOL;             /* 和实际输出的总音量保持一致 */
    g.connect(off.destination);
    try { PATCH[name](off, g); } catch (e) { return Promise.resolve(null); }
    return off.startRendering();
  }

  /* 量峰值：证明这个音真的出声、且没有削波（1.0 才是满刻度） */
  function peak(name) {
    return render(name).then(function (buf) {
      if (!buf) return null;
      var d = buf.getChannelData(0), max = 0;
      for (var i = 0; i < d.length; i++) {
        var v = d[i] < 0 ? -d[i] : d[i];
        if (v > max) max = v;
      }
      return Math.round(max * 1000) / 1000;
    });
  }

  /* ------------------------------------------------------------ 开关 */
  var btn = null;

  function syncBtn() {
    if (!btn) return;
    btn.classList.toggle('off', !soundOn);
    btn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    btn.setAttribute('aria-label', soundOn ? '音效开，点一下静音' : '已静音，点一下开启音效');
  }

  function setSound(v) {
    soundOn = !!v;
    write(LS_SOUND, soundOn ? '1' : '0');
    syncBtn();
    /* 关静音时把正在念的那句掐掉，否则按了静音它还在说 */
    if (!soundOn && live) {
      try { live.pause(); live.currentTime = 0; } catch (e) { /* 忽略 */ }
    }
    return soundOn;
  }

  function setHaptic(v) {
    hapticOn = !!v;
    write(LS_HAPTIC, hapticOn ? '1' : '0');
    return hapticOn;
  }

  function toggleSound() {
    var on = setSound(!soundOn);
    /* 震动跟着一起开关：按钮的语义是"静默"，不是"只是没声音还在兜里震" */
    setHaptic(on);
    /* 重新打开时给一声确认，否则按下去没反应会以为没生效。
       这里也走童声 wav（念一声 Hi），wav 放不出来才退回合成音。 */
    if (on && !say('hi')) play('pass');
    return on;
  }

  function bind() {
    btn = document.getElementById('btn-sound');
    if (btn) {
      /* 不 blur：电视遥控点完还要接着用方向键，焦点丢了得从头找 */
      btn.addEventListener('click', function () { toggleSound(); });
    }
    syncBtn();
    /* 首次手势解锁 AudioContext；每次点一下都兜底 resume 一次，代价是一次属性读取 */
    var unlock = function () { ctx(); };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('mousedown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    /* 播报音频提前建好元素（只挂 src，不改网络行为），答题时才不卡第一声 */
    warm();
  }

  window.SND = {
    play: play,
    buzz: buzz,
    say: say,
    render: render,
    peak: peak,
    setSound: setSound,
    setHaptic: setHaptic,
    toggleSound: toggleSound,
    soundOn: function () { return soundOn; },
    hapticOn: function () { return hapticOn; },
    /* 验收用：看得到 AudioContext 是否真的起来了 */
    state: function () {
      var n = 0, ready = 0;
      for (var k in clips) {
        if (Object.prototype.hasOwnProperty.call(clips, k)) {
          n++;
          if (clips[k].readyState > 0 && !clips[k].dead) ready++;
        }
      }
      return {
        sound: soundOn,
        haptic: hapticOn,
        ctx: AC ? AC.state : (broken ? 'none' : 'idle'),
        played: played,
        voiced: voiced,           /* 成功播报过几次（童声 wav 或 TTS 兜底） */
        voice: n,                 /* 建了几个播报元素（应为 10） */
        voiceReady: ready,        /* 已经读进内存、能立刻出声的 */
        tts: !!(window.AndroidTTS && typeof window.AndroidTTS.speak === 'function'),
        vibrateApi: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
      };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
