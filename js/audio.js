/* =========================================================
   Звуковой движок: SFX (WebAudio) + музыка (HTMLAudio),
   пауза/возобновление, громкости, разблокировка по жесту.
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};

  var SFX_FILES = {
    click: 'click.wav',
    pop: 'pop.wav',
    close: 'close.wav',
    error: 'error.wav',
    toggle: 'toggle.wav',
    coin: 'coin.wav',
    sell: 'sell.wav',
    egg_pickup: 'egg_pickup.wav',
    equip: 'equip.wav',
    book_open: 'book_open.wav',
    book_close: 'book_close.wav',
    jump: 'jump.wav',
    hurt: 'hurt.wav',
    lose: 'lose.wav',
    powerup: 'powerup.wav',
    win: 'win.wav',
    hatch: 'hatch.wav',
    blip: 'blip.wav',
    unlock: 'unlock.wav',
    crack: 'crack.wav',
    whoosh: 'whoosh.wav',
    alarm: 'alarm.wav',
    reward: 'reward.wav',
    buy: 'buy.wav',
    step1: 'step1.wav',
    step2: 'step2.wav',
    step3: 'step3.wav',
    step4: 'step4.wav'
  };

  var Audio_ = {
    ctx: null,
    buffers: {},
    masterGain: null,
    sfxGain: null,
    musicEl: null,
    musicName: null,
    musicTracks: {},
    sfxVolume: 0.8,
    musicVolume: 0.35,
    sfxOn: true,
    musicOn: true,
    paused: false,
    unlocked: false,
    platformAudio: false,
    fallbackVoices: [],

    playFallback: function (name, opts) {
      if (!SFX_FILES[name]) return;
      var voice = this.fallbackVoices.find(function (item) { return item.paused || item.ended; });
      if (!voice && this.fallbackVoices.length < 4) {
        voice = new global.Audio(); this.fallbackVoices.push(voice);
      }
      if (!voice) { voice = this.fallbackVoices.shift(); this.fallbackVoices.push(voice); }
      voice.pause();
      voice.src = 'assets/sfx/' + SFX_FILES[name];
      voice.muted = !this.platformAudio || this.paused || !this.sfxOn;
      voice.volume = Math.max(0, Math.min(1, this.sfxVolume * (opts.volume === undefined ? 1 : opts.volume)));
      voice.playbackRate = opts.rate || 1;
      var playing = voice.play();
      if (playing && playing.catch) playing.catch(function () {});
    },

    setPlatformAudio: function (enabled) {
      this.platformAudio = !!enabled;
      if (this.masterGain) this.masterGain.gain.value = enabled && !this.paused ? 1 : 0;
      if (this.musicEl) this.musicEl.muted = !enabled || this.paused;
      var muted = !enabled || this.paused;
      this.fallbackVoices.forEach(function (voice) { voice.muted = muted; if (muted) voice.pause(); });
      if (enabled && !this.paused) this.unlock();
    },
    lastStep: 0,

    init: function () {
      try {
        var AC = global.AudioContext || global.webkitAudioContext;
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.platformAudio ? 1 : 0;
        this.masterGain.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxVolume;
        this.sfxGain.connect(this.masterGain);
      } catch (e) { this.ctx = null; }

      var self = this;
      var unlock = function () {
        self.unlock();
      };
      /* iOS resumes an interrupted AudioContext only inside a user gesture such as touchend / click */
      ['pointerdown', 'touchstart', 'touchend', 'keydown', 'click'].forEach(function (ev) {
        global.addEventListener(ev, unlock, { passive: true, capture: true });
      });
    },

    unlock: function () {
      this.unlocked = true;
      if (this.paused || !this.platformAudio) return;
      if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
        this.ctx.resume().catch(function () {});   /* 'suspended' and iOS 'interrupted' */
      }
      if (this.musicOn && this.musicName && this.musicEl && this.musicEl.paused) {
        var p = this.musicEl.play();
        if (p && p.catch) p.catch(function () {});
      }
    },

    /* Загрузка всех SFX; onProgress(loaded, total) */
    loadAll: function (onProgress) {
      var self = this;
      var names = Object.keys(SFX_FILES);
      var total = names.length;
      var loaded = 0;

      var loadOne = function (name) {
        return fetch('assets/sfx/' + SFX_FILES[name])
          .then(function (r) { return r.arrayBuffer(); })
          .then(function (buf) {
            return SE.Tasks.active().then(function () { return buf; });
          }).then(function (buf) {
            return new Promise(function (resolve) {
              if (!self.ctx) { resolve(null); return; }
              self.ctx.decodeAudioData(buf, function (decoded) {
                SE.Tasks.run(function () { self.buffers[name] = decoded; resolve(decoded); });
              }, function () { resolve(null); });
            });
          })
          .catch(function () { return null; })
          .then(function (r) {
            loaded++;
            if (onProgress) onProgress(loaded, total);
            return r;
          });
      };

      return Promise.all(names.map(loadOne));
    },

    prepareMusic: function () {
      this.musicTracks = {
        theme: 'assets/music/theme.mp3',
        chase: 'assets/music/chase.mp3'
      };
    },

    play: function (name, opts) {
      if (!this.platformAudio || !this.unlocked || !this.sfxOn || this.paused) return;
      if (!this.ctx) { this.playFallback(name, opts || {}); return; }
      var buf = this.buffers[name];
      if (!buf) return;
      opts = opts || {};
      try {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
        var src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = opts.rate || 1;
        var g = this.ctx.createGain();
        g.gain.value = (opts.volume === undefined ? 1 : opts.volume);
        src.connect(g);
        g.connect(this.sfxGain);
        src.start(0);
      } catch (e) {}
    },

    /* Шаги с ограничением частоты */
    step: function (speedFactor) {
      var now = performance.now();
      var interval = 340 / Math.max(0.55, speedFactor || 1);
      if (now - this.lastStep < interval) return;
      this.lastStep = now;
      var n = 'step' + (1 + Math.floor(Math.random() * 4));
      this.play(n, { volume: 0.28, rate: 0.92 + Math.random() * 0.2 });
    },

    playMusic: function (name) {
      if (this.musicName === name && this.musicEl && !this.musicEl.paused) return;
      var url = this.musicTracks[name];
      if (!url) return;
      this.musicName = name;

      if (!this.musicEl) {
        this.musicEl = new global.Audio();
        this.musicEl.loop = true;
        this.musicEl.muted = !this.platformAudio;
        this.musicEl.preload = 'auto';
      }
      if (this.musicEl.src.indexOf(url) === -1) {
        this.musicEl.src = url;
      }
      this.musicEl.volume = this.musicOn ? this.musicVolume : 0;
      if (this.platformAudio && this.unlocked && this.musicOn && !this.paused) {
        var p = this.musicEl.play();
        if (p && p.catch) p.catch(function () {});
      }
    },

    fadeMusicTo: function (vol, ms) {
      var self = this;
      if (!this.musicEl) return;
      var start = this.musicEl.volume;
      var t0 = performance.now();
      var step = function () {
        var k = Math.min(1, (performance.now() - t0) / ms);
        try { self.musicEl.volume = start + (vol - start) * k; } catch (e) {}
        if (k < 1) SE.Tasks.timeout(step, 16);
      };
      step();
    },

    setSfx: function (on) {
      this.sfxOn = !!on;
      if (!on) this.fallbackVoices.forEach(function (voice) { voice.pause(); });
      if (this.sfxGain) this.sfxGain.gain.value = this.sfxOn ? this.sfxVolume : 0;
    },

    setMusic: function (on) {
      this.musicOn = !!on;
      if (!this.musicEl) return;
      if (on) {
        this.musicEl.volume = this.musicVolume;
        if (this.platformAudio && this.unlocked && !this.paused) { var p = this.musicEl.play(); if (p && p.catch) p.catch(function () {}); }
      } else {
        this.musicEl.pause();
      }
    },

    pause: function () {
      if (this.paused) return;
      this.paused = true;
      if (this.masterGain) this.masterGain.gain.value = 0;
      if (this.musicEl) this.musicEl.muted = true;
      this.fallbackVoices.forEach(function (voice) { voice.muted = true; voice.pause(); });
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(function () {});
      if (this.musicEl && !this.musicEl.paused) this.musicEl.pause();
    },

    resume: function () {
      if (!this.paused) return;
      this.paused = false;
      if (this.masterGain) this.masterGain.gain.value = this.platformAudio ? 1 : 0;
      if (this.musicEl) this.musicEl.muted = !this.platformAudio;
      if (this.platformAudio && this.unlocked && this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
      if (this.platformAudio && this.unlocked && this.musicOn && this.musicEl) {
        var p = this.musicEl.play();
        if (p && p.catch) p.catch(function () {});
      }
    }
  };

  SE.Audio = Audio_;
})(window);
