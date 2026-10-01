/* ==========================================================================
 * 星空战机 —— 音频模块（WebAudio 程序化合成，无需外部音频文件）
 * --------------------------------------------------------------------------
 * · 4 种短促触发音效：子弹发射 shoot / 敌机爆炸 explode / 玩家受伤 hurt / 拾取道具 pickup
 * · 背景循环播放轻快电子风音乐（程序化 16 步循环）
 * · 默认音量中等，数值统一在 config.js 的 AUDIO 中配置
 * · 浏览器要求先有用户手势，因此第一次点击/按键时才启动音频上下文
 * ========================================================================== */
(function (global) {
  'use strict';

  var CFG = global.CONFIG;
  var ACFG = CFG.AUDIO;
  var SFX_NAMES = ['shoot', 'explode', 'hurt', 'pickup'];

  var AudioManager = {

    ctx: null,
    master: null,
    musicBus: null,
    sfxBus: null,
    noiseBuffer: null,
    musicRunning: false,
    _timer: null,
    _nextNoteTime: 0,
    _step: 0,
    _booted: false,

    /* 懒启动：在第一次用户手势中调用 */
    boot: function () {
      if (this._booted) { this.resume(); return; }
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { this._booted = true; return; }
      try {
        this.ctx = new AC();
      } catch (e) {
        this._booted = true;
        return;
      }
      this._booted = true;

      this.master = this.ctx.createGain();
      this.master.gain.value = ACFG.MASTER_VOLUME;
      this.master.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0;
      this.musicBus.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = ACFG.SFX_VOLUME;
      this.sfxBus.connect(this.master);

      this.noiseBuffer = this._makeNoise();
      this.startMusic();
    },

    resume: function () {
      if (this.ctx && this.ctx.state === 'suspended') {
        var p = this.ctx.resume();
        if (p && p.catch) { p.catch(function () {}); }
      }
    },

    _makeNoise: function () {
      var len = Math.floor(this.ctx.sampleRate * 1.0);
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) { data[i] = Math.random() * 2 - 1; }
      return buf;
    },

    /* ------------------------------ 音效 ------------------------------ */

    play: function (name) {
      if (!this.ctx || !ACFG.SFX[name]) return;
      var s = ACFG.SFX[name];
      var t = this.ctx.currentTime + 0.001;
      try {
        if (s.type === 'noise') { this._noiseHit(s, t); }
        else { this._toneHit(s, t); }
      } catch (e) { /* 忽略偶发的音频调度异常 */ }
    },

    /* 振荡器类：射击 / 受伤 / 拾取 */
    _toneHit: function (s, t) {
      var ctx = this.ctx;
      var g = ctx.createGain();
      var o = ctx.createOscillator();
      o.type = s.type;
      o.frequency.setValueAtTime(s.freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, s.freqEnd), t + s.duration);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(s.gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + s.duration);
      o.connect(g);
      g.connect(this.sfxBus);
      o.start(t);
      o.stop(t + s.duration + 0.03);
    },

    /* 噪声类：爆炸 */
    _noiseHit: function (s, t) {
      var ctx = this.ctx;
      var src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 1.1;
      lp.frequency.setValueAtTime(s.freq, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(60, s.freqEnd), t + s.duration);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(s.gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + s.duration);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.sfxBus);
      src.start(t);
      src.stop(t + s.duration + 0.03);
    },

    /* --------------------------- 背景音乐 --------------------------- */
    /* 轻快电子风：贝斯 + 分解和弦 + 底鼓 + 踩镲，16 步循环 */

    startMusic: function () {
      if (!this.ctx || this.musicRunning) return;
      this.musicRunning = true;
      this._step = 0;
      this._nextNoteTime = this.ctx.currentTime + 0.08;
      this._schedule();
      var self = this;
      this._timer = global.setInterval(function () { self._schedule(); }, 40);
    },

    stopMusic: function () {
      if (this._timer) { global.clearInterval(this._timer); this._timer = null; }
      this.musicRunning = false;
    },

    setMusicPaused: function (paused) {
      if (!this.ctx || !this.musicBus) return;
      var t = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(t);
      var target = paused ? 0.0001 : ACFG.MUSIC_VOLUME;
      this.musicBus.gain.setValueAtTime(Math.max(this.musicBus.gain.value, 0.0001), t);
      this.musicBus.gain.linearRampToValueAtTime(target, t + 0.18);
    },

    _schedule: function () {
      if (!this.ctx || !this.musicRunning) return;
      var stepDur = 60 / ACFG.MUSIC_TEMPO / 4;   // 十六分音符
      while (this._nextNoteTime < this.ctx.currentTime + 0.24) {
        this._playStep(this._step, this._nextNoteTime);
        this._nextNoteTime += stepDur;
        this._step = (this._step + 1) % 16;
      }
    },

    _playStep: function (s, t) {
      /* 和弦进行 Am - F - C - G，每个和弦占 4 步 */
      var CHORDS = [[220.00, 261.63, 329.63], [174.61, 220.00, 261.63],
                    [261.63, 329.63, 392.00], [196.00, 246.94, 293.66]];
      var BASS = [110.00, 87.31, 130.81, 98.00];
      var chord = CHORDS[Math.floor(s / 4)];
      var bass = BASS[Math.floor(s / 4)];

      /* 底鼓 */
      if (s % 4 === 0) { this._kick(t); }
      /* 踩镲（反拍更轻） */
      this._hat(t, s % 2 === 1 ? 0.10 : 0.05);
      /* 贝斯 */
      if (s % 2 === 0) { this._bass(bass, t, 0.20); }
      /* 分解和弦琶音 */
      this._arp(chord[s % 3] * 2, t, chord[(s + 1) % 3] * 2);
      /* 每两小节一次的亮色高音 */
      if (s === 6 || s === 14) { this._arp(chord[2] * 4, t, chord[2] * 4); }
    },

    _kick: function (t) {
      var ctx = this.ctx;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.14);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.34, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
      o.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + 0.24);
    },

    _hat: function (t, gain) {
      var ctx = this.ctx;
      var src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6800;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      src.connect(hp); hp.connect(g); g.connect(this.musicBus);
      src.start(t); src.stop(t + 0.09);
    },

    _bass: function (freq, t, gain) {
      var ctx = this.ctx;
      var o = ctx.createOscillator();
      var lp = ctx.createBiquadFilter();
      var g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      lp.type = 'lowpass';
      lp.frequency.value = 620;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      o.connect(lp); lp.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + 0.2);
    },

    _arp: function (freq, t, freq2) {
      var ctx = this.ctx;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(freq, t);
      if (freq2 && freq2 !== freq) { o.frequency.linearRampToValueAtTime(freq2, t + 0.06); }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.058, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + 0.14);
    }
  };

  global.SFX = {
    play: function (name) { AudioManager.play(name); },

    /* 映射语义化名称，便于游戏逻辑调用 */
    shoot:   function () { AudioManager.play('shoot'); },
    explode: function () { AudioManager.play('explode'); },
    hurt:    function () { AudioManager.play('hurt'); },
    pickup:  function () { AudioManager.play('pickup'); },

    boot: function () { AudioManager.boot(); },
    isReady: function () { return !!AudioManager.ctx; },
    duckMusic: function (on) { AudioManager.setMusicPaused(on); },
    stopMusic: function () { AudioManager.stopMusic(); },
    startMusic: function () { AudioManager.startMusic(); },
    /** 列出已配置的音效名，便于自检 */
    names: function () { return SFX_NAMES.slice(); }
  };
})(window);
