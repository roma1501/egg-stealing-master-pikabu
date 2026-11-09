/* =====================================================================
   SE.Platform — PLAYGAMA Bridge v2 adapter (build: tools/build.ps1 -Platform playgama).
   Same public surface as playables/js/platform.js (YouTube Playables).

   - The build puts the Bridge script first in index.html and copies
     playgama-bridge-config.json next to it.
   - init(): bridge.initialize() (15 s timeout); a failure rejects and the game
     shows its retry screen. Language: platform.language if the game has it
     (en / ru / tr), otherwise English (checklist #2).
   - Progress: Bridge Storage only (one call, array of keys); a failed or
     corrupt load() blocks saving so a new game can never overwrite the cloud.
   - Pause and audio: PAUSE_STATE_CHANGED / AUDIO_STATE_CHANGED (+ hidden tab
     as a fallback) → "Paused" overlay, timers, sound; initial audio state applied.
   - Ads: single flight through Bridge; the reward only on the 'rewarded' state;
     closed / failed / timeout never reward.
   - Leaderboard 'Score': in-game table only when leaderboards.type === 'in_game'.
   ===================================================================== */
(function (global) {
  'use strict';
  var SE = global.SE = global.SE || {};
  var SAVE_KEY = 'egg_master_save_v2';
  var LB_ID = 'Score';
  var LANGS = ['en', 'ru'];          // Turkish is only partly translated: English instead
  var INIT_TIMEOUT = 15000, STORAGE_TIMEOUT = 15000, AD_TIMEOUT = 120000, LB_TIMEOUT = 10000;
  var REWARD_GRACE = 400, LB_CACHE_MS = 20000, STALL_WAIT = 30000;

  /* ---------------- task queue that freezes with the host pause ---------------- */
  var pending = [], timers = new Set();
  var Tasks = SE.Tasks = {
    paused: false,
    run: function (fn) { if (this.paused) pending.push(fn); else fn(); },
    active: function () { return new Promise(function (resolve) { Tasks.run(resolve); }); },
    timeout: function (fn, ms) {
      var t = { fn: fn, left: ms, timer: null, since: 0 };
      timers.add(t); if (!this.paused) this.arm(t); return t;
    },
    arm: function (t) {
      t.since = performance.now();
      t.timer = setTimeout(function () { timers.delete(t); Tasks.run(t.fn); }, t.left);
    },
    clear: function (t) { if (!t) return; clearTimeout(t.timer); timers.delete(t); },
    pause: function () {
      if (this.paused) return;
      this.paused = true;
      timers.forEach(function (t) { clearTimeout(t.timer); t.left = Math.max(0, t.left - (performance.now() - t.since)); });
    },
    resume: function () {
      if (!this.paused) return;
      this.paused = false;
      timers.forEach(function (t) { Tasks.arm(t); });
      var queue = pending.splice(0); queue.forEach(function (fn) { Tasks.run(fn); });
    }
  };

  /* ---------------- helpers ---------------- */
  function noop() {}
  function withTimeout(work, ms, label) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error(label + ' timed out after ' + ms + ' ms'));
      }, ms);
      Promise.resolve().then(work).then(function (value) {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(value);
      }, function (error) {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(error);
      });
    });
  }
  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function cleanScore(score) {
    var n = Math.floor(Number(score));
    if (!isFinite(n) || n < 0) return null;
    return Math.min(n, Number.MAX_SAFE_INTEGER);
  }
  function setInert(on) {
    ['ui', 'pause', 'adWait', 'mockAd', 'loading'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  }

  var Platform = SE.Platform = {
    id: 'playgama',
    api: null, bridge: null, authorized: false, authorizationSupported: false, leaderboardType: 'not_available',
    hasSDK: false, ready: false, firstFrameSent: false, lang: 'en', isMobile: true,
    inputMode: 'touch', onInputMode: null, adBlockedUntil: 0, adBusy: false,
    paused: false, loaded: false, audioEnabled: true,
    onPause: null, onResume: null,
    gameReadySent: false, gameplayRunning: false,

    _initPromise: null, _wantGameplay: false, _levelStarted: false, _hostReasons: {},
    _adOpen: { interstitial: false, rewarded: false }, _request: null,
    _pendingJson: null, _writing: null, _stalled: null, _lbCache: null,

    firstFrameReady: function () { this.firstFrameSent = true; },

    /* ---------- init ---------- */
    init: function () {
      if (this._initPromise) return this._initPromise;
      var self = this;
      document.addEventListener('visibilitychange', function () { self._hostSet('hidden', document.hidden); });
      this._initPromise = withTimeout(function () {
        var b = global.bridge;
        if (!b || typeof b.initialize !== 'function') throw new Error('Playgama Bridge did not load');
        return b.initialize();
      }, INIT_TIMEOUT, 'Playgama Bridge initialization').then(function () {
        self._attach(global.bridge);
        return true;
      }, function (error) {
        self._initPromise = null;            // a retry may initialise again
        throw error;
      });
      return this._initPromise;
    },

    _attach: function (b) {
      var self = this;
      this.bridge = this.api = b;
      this.hasSDK = true;
      var l = String((b.platform && b.platform.language) || '').toLowerCase().split(/[-_]/)[0];
      this.lang = LANGS.indexOf(l) >= 0 ? l : 'en';
      this.leaderboardType = (b.leaderboards && b.leaderboards.type) || 'not_available';
      this.authorized = !!(b.player && b.player.isAuthorized);
      this.authorizationSupported = !!(b.player && b.player.isAuthorizationSupported);
      var E = b.EVENT_NAME || {};
      try {
        b.platform.on(E.PAUSE_STATE_CHANGED || 'pause_state_changed', function (paused) { self._hostSet('host', paused === true); });
        b.platform.on(E.AUDIO_STATE_CHANGED || 'audio_state_changed', function (enabled) { self._setAudio(enabled === true); });
      } catch (e) { console.warn('Playgama platform events unavailable:', e); }
      try {
        b.advertisement.on(E.INTERSTITIAL_STATE_CHANGED || 'interstitial_state_changed', function (state) { self._onAdState('interstitial', state); });
        b.advertisement.on(E.REWARDED_STATE_CHANGED || 'rewarded_state_changed', function (state) { self._onAdState('rewarded', state); });
      } catch (e) { console.warn('Playgama advertisement events unavailable:', e); }
      /* the events only report changes: apply the initial states explicitly */
      this._setAudio(!(b.platform && b.platform.isAudioEnabled === false));
      if (b.platform && b.platform.isPaused) this._hostSet('host', true);
      this.ready = true;
    },
    _setAudio: function (enabled) {
      this.audioEnabled = enabled;
      if (SE.Audio && SE.Audio.setPlatformAudio) SE.Audio.setPlatformAudio(enabled);
    },

    /* ---------- pause ---------- */
    _hostSet: function (reason, on) {
      if (on) this._hostReasons[reason] = true; else delete this._hostReasons[reason];
      if (Object.keys(this._hostReasons).length) this.hostPause(); else this.hostResume();
    },
    hostPause: function () {
      if (this.paused) return;
      if (SE.State && SE.State.data) SE.State.save();
      this.paused = true;
      Tasks.pause();
      document.documentElement.classList.add('platform-paused');
      setInert(true);
      if (this.onPause) this.onPause('platform');
    },
    hostResume: function () {
      if (!this.paused) return;
      this.paused = false;
      document.documentElement.classList.remove('platform-paused');
      setInert(false);
      if (this.onResume) this.onResume('platform');
      Tasks.resume();
    },

    /* ---------- lifecycle ---------- */
    _message: function (name) {
      if (!this.hasSDK) return;
      var self = this;
      Promise.resolve().then(function () { return self.bridge.platform.sendMessage(name); })
        .catch(function (error) { console.warn('Playgama message failed:', name, error); });
    },
    /* game_ready only after the loading screen is gone and the player can act (checklist #9). */
    gameReady: function () {
      if (this.gameReadySent) return;
      this.gameReadySent = true;
      this._message('game_ready');
      this._syncGameplay();
    },
    gameplayStart: function () { this._wantGameplay = true; this._syncGameplay(); },
    gameplayStop: function () { this._wantGameplay = false; this._syncGameplay(); },
    _syncGameplay: function () {
      if (!this.gameReadySent || this._wantGameplay === this.gameplayRunning) return;
      this.gameplayRunning = this._wantGameplay;
      if (this.gameplayRunning) {
        this._message(this._levelStarted ? 'level_resumed' : 'level_started');
        this._levelStarted = true;
      } else this._message('level_paused');
    },

    /* ---------- saves: Bridge Storage only ---------- */
    load: function () {
      var self = this;
      this.loaded = false;
      return Tasks.active().then(function () {
        return withTimeout(function () {
          if (!self.hasSDK) throw new Error('Playgama storage is unavailable');
          return self.bridge.storage.get([SAVE_KEY]);
        }, STORAGE_TIMEOUT, 'Playgama storage.get');
      }).then(function (data) {
        var value = Array.isArray(data) ? data[0] : data;
        if (value === undefined || value === null || value === '') value = null;
        else if (typeof value === 'string') value = JSON.parse(value);   // corrupt data rejects
        if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid Playgama save data');
        self.loaded = true;
        return value;
      });
    },
    save: function (data) {
      if (!this.hasSDK || !this.loaded) return Promise.resolve(false);
      var json;
      try {
        var clean = JSON.parse(JSON.stringify(data));
        if (clean.settings) delete clean.settings.lang;
        json = JSON.stringify(clean);
      } catch (e) { return Promise.resolve(false); }
      this._pendingJson = json;
      return this._flush();
    },
    _flush: function () {
      if (this._writing) return this._writing;      // the running loop writes the newest snapshot
      var self = this;
      function step() {
        var json = self._pendingJson;
        if (json === null) return Promise.resolve(true);
        self._pendingJson = null;
        /* after a timed-out write, wait for it so an older snapshot cannot land last */
        var gate = self._stalled ? Promise.race([self._stalled, delay(STALL_WAIT)]) : Promise.resolve();
        return gate.then(function () {
          self._stalled = null;
          var request = null;
          return withTimeout(function () {
            request = Promise.resolve(self.bridge.storage.set([SAVE_KEY], [json]));
            return request;
          }, STORAGE_TIMEOUT, 'Playgama storage.set').then(function () {
            return self._pendingJson !== null ? step() : true;
          }, function (error) {
            if (request) self._stalled = request.then(noop, noop);
            if (self._pendingJson === null) self._pendingJson = json;   // retried by the next save()
            console.warn('Playgama save failed:', error);
            return false;
          });
        });
      }
      this._writing = step().then(function (ok) { self._writing = null; return ok; });
      return this._writing;
    },

    /* ---------- ads ---------- */
    mockAds: function () {
      if (this.hasSDK) return false;
      try { return /[?&]mockads(=|&|$)/.test(global.location.search); } catch (err) { return false; }
    },
    rewardedStatus: function () {
      if (this.adBusy) return { ok: false, reason: 'busy' };
      if (this.mockAds()) return { ok: true };
      if (!this.hasSDK) return { ok: false, reason: 'local' };
      var ads = this.bridge.advertisement;
      if (!ads || !ads.isRewardedSupported) return { ok: false, reason: 'unsupported' };
      if (Date.now() < this.adBlockedUntil) return { ok: false, reason: 'cooldown' };
      return { ok: true };
    },
    rewardedAvailable: function () { return this.rewardedStatus().ok; },
    mockOverlay: function (kind, cb) {
      var box = document.createElement('div');
      box.id = 'mockAd';
      var card = document.createElement('div');
      card.className = 'mock-card';
      var title = document.createElement('div');
      title.className = 'mock-title stroke';
      title.textContent = SE.t('mock.title');
      var text = document.createElement('div');
      text.className = 'mock-text';
      text.textContent = SE.t(kind === 'rewarded' ? 'mock.rewarded' : 'mock.interstitial');
      var row = document.createElement('div');
      row.className = 'mock-row';
      var done = false;
      function finish(earned) {
        if (done) return;
        done = true;
        if (box.parentNode) box.parentNode.removeChild(box);
        cb(earned);
      }
      function button(label, cls, earned) {
        var b = document.createElement('button');
        b.className = 'btn ' + cls;
        b.textContent = SE.t(label);
        b.addEventListener('click', function () { finish(earned); });
        row.appendChild(b);
      }
      if (kind === 'rewarded') { button('mock.reward', '', true); button('mock.noReward', 'grey', false); }
      else button('mock.close', '', true);
      card.appendChild(title); card.appendChild(text); card.appendChild(row);
      box.appendChild(card);
      document.body.appendChild(box);
      SE.adLog = SE.adLog || [];
      SE.adLog.push({ kind: kind, at: Date.now() });
    },
    showInterstitial: function (cb) {
      cb = cb || noop;
      if (this.adBusy) { cb(false); return; }
      if (this.mockAds()) { this._mockAd('interstitial', null, cb); return; }
      var ads = this.bridge && this.bridge.advertisement;
      if (!this.hasSDK || !ads || !ads.isInterstitialSupported) { cb(false); return; }
      this._requestAd('interstitial', 'round_end', null, cb);
    },
    /* onReward runs once, only when Bridge reports 'rewarded'; onClose(earned) always runs afterwards. */
    showRewarded: function (onReward, onClose, id) {
      onClose = onClose || noop;
      if (!id || !this.rewardedAvailable()) { onClose(false); return; }
      if (this.mockAds()) { this._mockAd('rewarded', onReward, onClose); return; }
      this._requestAd('rewarded', String(id), onReward, onClose);
    },
    _mockAd: function (kind, onReward, onClose) {
      var self = this;
      this.adBusy = true;
      SE.Game.setPaused(true, 'ad');
      this.mockOverlay(kind, function (earned) {
        Tasks.run(function () {
          self.adBusy = false;
          SE.Game.setPaused(false, 'ad');
          if (kind === 'rewarded' && earned && onReward) onReward();
          onClose(kind === 'rewarded' ? earned : true);
        });
      });
    },
    _requestAd: function (kind, placement, onReward, onClose) {
      var ads = this.bridge.advertisement;
      if (ads.interstitialState === 'opened' || ads.rewardedState === 'opened') { onClose(false); return; }
      var self = this;
      var request = { kind: kind, opened: false, rewarded: false, onReward: onReward, onClose: onClose, timer: null, grace: null };
      this._request = request;
      this.adBusy = true;
      SE.Game.setPaused(true, 'ad');
      request.timer = setTimeout(function () { self._finishAd(request, request.rewarded, !request.rewarded); }, AD_TIMEOUT);
      try {
        var result = kind === 'rewarded' ? ads.showRewarded(placement) : ads.showInterstitial(placement);
        if (result && typeof result.then === 'function') result.then(null, function () { self._finishAd(request, request.rewarded, !request.rewarded); });
      } catch (error) {
        console.warn('Playgama ' + kind + ' request failed:', error);
        this._finishAd(request, false, true);
      }
    },
    _onAdState: function (kind, state) {
      if (state === 'opened') this._adOpen[kind] = true;
      else if (state === 'closed' || state === 'failed') this._adOpen[kind] = false;
      var request = this._request;
      if (!request || request.kind !== kind) return;
      var self = this;
      if (state === 'opened') request.opened = true;
      else if (state === 'rewarded') {
        if (kind !== 'rewarded') return;
        request.rewarded = true;
        if (request.grace) this._finishAd(request, true, false);
      } else if (state === 'closed') {
        if (kind === 'rewarded' && !request.rewarded) {
          /* some hosts report 'rewarded' right after 'closed': short grace period */
          if (!request.grace) request.grace = setTimeout(function () { self._finishAd(request, request.rewarded, false); }, REWARD_GRACE);
        } else this._finishAd(request, kind === 'rewarded' ? true : request.opened, false);
      } else if (state === 'failed') {
        this._finishAd(request, kind === 'rewarded' ? request.rewarded : false, true);
      }
    },
    _finishAd: function (request, result, failed) {
      if (this._request !== request) return;
      this._request = null;
      clearTimeout(request.timer);
      clearTimeout(request.grace);
      var self = this, granted = result === true;
      Tasks.run(function () {
        self.adBusy = false;
        if (failed) self.adBlockedUntil = Date.now() + 20000;
        SE.Game.setPaused(false, 'ad');
        if (request.kind === 'rewarded' && granted && request.onReward) request.onReward();
        request.onClose(request.kind === 'rewarded' ? granted : granted);
      });
    },

    /* ---------- leaderboard 'Score' ---------- */
    hasLeaderboard: function () { return this.hasSDK && this.leaderboardType === 'in_game'; },
    submitScore: function (score) {
      var n = cleanScore(score);
      if (!this.hasSDK || n === null || !this.leaderboardType || this.leaderboardType === 'not_available') return Promise.resolve(false);
      var self = this;
      return withTimeout(function () { return self.bridge.leaderboards.setScore(LB_ID, n); }, LB_TIMEOUT, 'Playgama setScore')
        .then(function () { self._lbCache = null; return true; }, function (error) { console.warn('Playgama setScore failed:', error); return false; });
    },
    getLeaderboard: function (limit) {
      if (!this.hasLeaderboard()) return Promise.resolve(null);
      var self = this, now = Date.now(), max = Math.max(1, limit || 15);
      if (!this._lbCache || now - this._lbCache.at >= LB_CACHE_MS) {
        var playerId = this.bridge.player && this.bridge.player.id;
        var promise = withTimeout(function () { return self.bridge.leaderboards.getEntries(LB_ID); }, LB_TIMEOUT, 'Playgama getEntries')
          .then(function (entries) {
            var userRank = 0;
            var list = (entries || []).map(function (e, i) {
              var isUser = !!(playerId && e.id === playerId);
              var rank = Number(e.rank) || i + 1;
              if (isUser) userRank = rank;
              return { rank: rank, score: Number(e.score) || 0, player: { publicName: e.name || '', id: e.id, avatar: e.photo || '' }, isUser: isUser };
            });
            return { entries: list, userRank: userRank };
          }, function (error) {
            console.warn('Playgama getEntries failed:', error);
            self._lbCache = null;
            return null;
          });
        this._lbCache = { at: now, promise: promise };
      }
      return this._lbCache.promise.then(function (r) { return r ? { entries: r.entries.slice(0, max), userRank: r.userRank } : null; });
    },
    canAuth: function () { return this.hasSDK && this.authorizationSupported; },
    auth: function () {
      if (!this.canAuth()) return Promise.resolve(false);
      var self = this;
      return withTimeout(function () { return self.bridge.player.authorize(); }, 60000, 'Playgama authorize')
        .then(function () { self.authorized = !!self.bridge.player.isAuthorized; return self.authorized; }, function () { return false; });
    }
  };

  /* While the host pauses the game every input is swallowed. */
  ['click', 'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove',
    'touchstart', 'touchmove', 'touchend', 'keydown', 'keyup', 'wheel', 'contextmenu'].forEach(function (type) {
    global.addEventListener(type, function (event) {
      if (!Platform.paused) return;
      event.stopImmediatePropagation();
      if (event.cancelable && event.code !== 'Escape') event.preventDefault();
    }, { capture: true, passive: false });
  });

  /* Input hints follow the device used last; on-screen controls stay available. */
  function setMode(mode) {
    if (Platform.inputMode === mode) return;
    Platform.inputMode = mode;
    Platform.isMobile = mode === 'touch';
    if (Platform.onInputMode) Platform.onInputMode(mode);
  }
  (function detectInput() {
    var fine = false, coarse = false;
    try {
      fine = global.matchMedia('(any-pointer: fine)').matches;
      coarse = global.matchMedia('(any-pointer: coarse)').matches;
    } catch (err) { /* keep defaults */ }
    Platform.inputMode = fine ? 'keyboard' : (coarse ? 'touch' : 'touch');
    Platform.isMobile = Platform.inputMode === 'touch';
    global.addEventListener('touchstart', function () { setMode('touch'); }, { capture: true, passive: true });
    global.addEventListener('pointerdown', function (e) { setMode(e.pointerType === 'mouse' ? 'keyboard' : 'touch'); }, { capture: true, passive: true });
    global.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') setMode('keyboard'); }, { capture: true, passive: true });
    global.addEventListener('keydown', function (e) {
      var c = e.code || '';
      if (c.indexOf('Shift') !== 0 && c.indexOf('Control') !== 0 && c.indexOf('Alt') !== 0 && c.indexOf('Meta') !== 0) setMode('keyboard');
    }, { capture: true, passive: true });
  })();
})(window);
