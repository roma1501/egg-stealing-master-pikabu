/* =========================================================
   Ads: interstitial cadence + rewarded offers (YouTube Playables SDK only)
   - Interstitial: after every 2 completed rounds (a delivery or being caught),
     shown only when the player presses Next / Continue on the result panel.
     Playables (rule extraBreaks, YouTube decides the real frequency): after every egg and
     at extra break points (breakPoint) — menus, shop purchases, settings buttons, Daily Gift,
     free wheel spin — never during play, a carried egg or a chase, never right after a rewarded.
   - Rewarded: always through SE.Platform.showRewarded with a stable id; the
     reward is granted once and only after the SDK confirms the view.
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U;

  /* Catalogue of boost offers (the cosmetic placements shop-unlock, daily-x2 and
     wheel-spin are not boosts and use Ads.watch directly). */
  var OFFERS = [
    { id: 'x2income',     icon: 'money-bag', cat: 'boost', cd: 75, dur: 90 },
    { id: 'x2hatch',      icon: 'fast-hatch', cat: 'boost', cd: 90, dur: 300 },
    { id: 'instantHatch', icon: 'hatching-chick', cat: 'egg',   cd: 60 },
    { id: 'speedBoost',   icon: 'lightning', cat: 'boost', cd: 75,  dur: 60 },
    { id: 'freeEgg',      icon: 'egg', cat: 'egg',   cd: 90 },
    { id: 'escape',       icon: 'shield', cat: 'run',  cd: 60 },
    { id: 'upgradeEgg',   icon: 'sparkles', cat: 'run',   cd: 75 },
    { id: 'doubleSell',   icon: 'banknotes', cat: 'money', cd: 60 },
    { id: 'freePen',      icon: 'pen-house', cat: 'egg',   cd: 90 },
    { id: 'offline',      icon: 'moon', cat: 'money', cd: 60 },
    { id: 'freeTrail',    icon: 'rainbow', cat: 'speed', cd: 90, dur: 600 },
    { id: 'speedUp',      icon: 'shoe', cat: 'speed', cd: 75 },
    { id: 'zoneDiscount', icon: 'map', cat: 'money', cd: 90 },
    { id: 'magnet',       icon: 'magnet', cat: 'boost', cd: 75, dur: 60 },
    { id: 'invisible',    icon: 'ghost', cat: 'boost', cd: 75, dur: 45 },
    { id: 'luckyPet',     icon: 'clover', cat: 'boost', cd: 75, dur: 180 },
    { id: 'cashBonus',    icon: 'cash-bonus', cat: 'money', cd: 80 },
    { id: 'revive',       icon: 'heart', cat: 'run',   cd: 60 }
  ];

  var BY_ID = {};
  OFFERS.forEach(function (o) { BY_ID[o.id] = o; });

  /* Cooldown (seconds) after a confirmed view of the other placements. */
  var PLACEMENT_CD = {
    'shop-unlock': 60, 'daily-x2': 60, 'wheel-spin': 75,
    'super-egg': 90, 'super-gems': 90, 'super-rush': 90
  };

  var Ads = {
    OFFERS: OFFERS,
    cooldowns: {},
    busy: false,
    interstitials: 0,
    /* Stable ids of the cosmetic placements (the platform adds the game prefix). */
    IDS: { shopUnlock: 'shop-unlock', dailyX2: 'daily-x2', wheelSpin: 'wheel-spin' },

    get: function (id) { return BY_ID[id]; },

    title: function (id) { return SE.t('offer.' + id + '.t'); },
    desc: function (id, arg) { return SE.t('offer.' + id + '.d', arg); },

    cooldownLeft: function (id) {
      if (SE.rule && SE.rule('adCooldowns', true) === false) return 0;   /* Poki: no ad cooldowns */
      var o = BY_ID[id];
      var cd = o ? o.cd : (PLACEMENT_CD[id] || 0);
      if (!cd) return 0;
      var last = this.cooldowns[id] || 0;
      return Math.max(0, cd - (Date.now() - last) / 1000);
    },

    ready: function (id) { return this.cooldownLeft(id) <= 0; },

    /* ---------- rewarded availability ---------- */
    available: function () { return !this.busy && SE.Platform.rewardedAvailable(); },
    /* Short explanation shown next to a disabled "Watch ad" button. */
    explain: function () {
      var st = SE.Platform.rewardedStatus();
      if (st.ok && !this.busy) return '';
      if (st.reason === 'silent') return '';            /* Poki: no custom ad / ad-blocker messages */
      if (st.reason === 'adblock') return SE.t('ad.adblock');
      if (st.reason === 'local' || st.reason === 'unsupported') return SE.t('ad.unavailableHere');
      return SE.t('ad.unavailableNow');
    },

    /* ---------- interstitial cadence ---------- */
    /* One completed round: a delivery or being caught. The tutorial is not a round. */
    roundEnded: function () {
      if (SE.Tutorial && SE.Tutorial.active) return;
      this.roundAt = Date.now();
      var b = SE.State.data.adBreak;
      b.rounds = Math.min(9, (b.rounds || 0) + 1);
      SE.State.save();
    },

    /* Called when the player presses Next / Continue on the result panel. After two
       rounds an interstitial is requested first; any failure just continues. */
    next: function (go) {
      var self = this;
      var b = SE.State.data.adBreak;
      if (this.busy) return;
      /* Poki: no internal ad counter — a break at every return to play, the platform decides */
      var cadence = !(SE.rule && SE.rule('adCadence', true) === false);
      if ((SE.Tutorial && SE.Tutorial.active) || (cadence && (b.rounds || 0) < 2)) { go(); return; }
      /* a rewarded watched on this result screen: its "Next" is not an interstitial point */
      if (SE.rule('extraBreaks', false) && (this.rewardedAt || 0) > (this.roundAt || 0)) { go(); return; }
      b.rounds = 0;
      SE.State.save();
      this.busy = true;
      this.interstitials++;
      SE.UI.showAdWait(true);
      var finished = false;
      SE.Platform.showInterstitial(function (ok) {
        if (finished) return;
        finished = true;
        self.busy = false;
        SE.UI.showAdWait(false);
        go(ok);
      });
    },

    /* Extra interstitial request at a natural break (rule extraBreaks, Playables). go() always
       runs afterwards. Skipped in the tutorial, while an egg is carried or a guard chases the
       player, within 8 s after a rewarded view and within 3 s of the previous request. */
    breakPoint: function (reason, go) {
      var self = this;
      go = go || function () {};
      var now = Date.now(), g = SE.Game;
      if (!SE.rule('extraBreaks', false) || this.busy || SE.Platform.adBusy || !SE.State.data.tutorialDone ||
          (SE.Tutorial && SE.Tutorial.active) || (g && g.carrying) || (SE.Guards && SE.Guards.anyChasing('player')) ||
          now - (this.rewardedAt || 0) < 8000 || now - (this.breakAt || 0) < 3000) { go(); return; }
      this.breakAt = now;
      this.busy = true;
      this.interstitials++;
      this.breaks = this.breaks || {};
      this.breaks[reason] = (this.breaks[reason] || 0) + 1;
      var finished = false;
      /* the "ad loading" plate only when the request takes a moment (no flicker when YouTube skips it) */
      var wait = setTimeout(function () { if (!finished) SE.UI.showAdWait(true); }, 350);
      SE.Platform.showInterstitial(function (ok) {
        if (finished) return;
        finished = true;
        clearTimeout(wait);
        self.busy = false;
        SE.UI.showAdWait(false);
        go(ok);
      });
    },

    /* ---------- rewarded ---------- */
    /* Generic rewarded view with a stable id. onReward runs once, only on SDK confirmation. */
    watch: function (id, onReward, onClose) {
      var self = this;
      if (this.busy) { if (onClose) onClose(false); return; }
      var left = this.cooldownLeft(id);
      if (left > 0) {
        SE.UI.toast(SE.t('ad.ready', U.timeShort(left)), 'error');
        if (onClose) onClose(false);
        return;
      }
      if (!SE.Platform.rewardedAvailable()) {
        var why = this.explain();
        if (why || SE.rule('adFailToast', true)) SE.UI.toast(why || SE.t('msg.adFailed'), 'error');
        if (onClose) onClose(false);
        return;
      }
      this.busy = true;
      SE.UI.showAdWait(true);
      var granted = false;
      SE.Platform.showRewarded(function () {
        if (granted) return;
        granted = true;
        self.cooldowns[id] = Date.now();
        if (onReward) onReward();
      }, function (rewarded) {
        self.busy = false;
        self.rewardedAt = Date.now();
        SE.UI.showAdWait(false);
        if (!rewarded && SE.rule('adFailToast', true)) SE.UI.toast(SE.t('msg.adFailed'), 'error');
        if (onClose) onClose(rewarded);
      }, id);
    },

    /* Boost offer from the catalogue (its cooldown is handled by watch). */
    showRewarded: function (id, onReward, onClose) { this.watch(id, onReward, onClose); },

    /* ---------- live "Watch ad" buttons ----------
       Every rewarded button is created here: it stays visible, is disabled with a live
       "Ready in 0:42" countdown while its offer cools down, and is disabled when ads are
       not available (the panel shows the explanation). */
    live: [],
    ticking: false,

    button: function (id, opts) {
      var self = this;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = opts.cls || 'btn ad';
      b._ad = { id: id, html: opts.html, extra: !!opts.disabled, cooling: null };
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (b.disabled) return;
        if (opts.onClick) opts.onClick(b);
      });
      this.sync(b);
      this.live.push(b);
      this.startTicker();
      return b;
    },

    sync: function (b) {
      var a = b._ad, left = this.cooldownLeft(a.id);
      var cooling = left > 0;
      if (cooling) {
        var txt = SE.t('ad.ready', U.timeShort(left));
        if (a.cooling !== txt) { b.innerHTML = '<span>' + txt + '</span>'; a.cooling = txt; }
        b.classList.add('cooling');
        b.disabled = true;
        return;
      }
      if (a.cooling !== null || !b.innerHTML) { b.innerHTML = a.html; a.cooling = null; }
      b.classList.remove('cooling');
      b.disabled = a.extra || !this.available();
    },

    setButtonDisabled: function (b, on) { b._ad.extra = !!on; this.sync(b); },

    startTicker: function () {
      var self = this;
      if (this.ticking) return;
      this.ticking = true;
      SE.Tasks.timeout(function () {
        self.ticking = false;
        self.live = self.live.filter(function (b) { return b.isConnected; });
        self.live.forEach(function (b) { self.sync(b); });
        if (self.live.length) self.startTicker();
      }, 500);
    },

    /* Universal reward launcher by id (the logic lives in game.js) */
    claim: function (id, ctx, onDone) {
      if (id === 'offline' && SE.Game.offlineEarned <= 0) {
        if (onDone) onDone(false);
        return;
      }
      this.showRewarded(id, function () {
        SE.Game.applyReward(id, ctx);
      }, function (rewarded) {
        if (onDone) onDone(rewarded);
      });
    }
  };

  SE.Ads = Ads;
})(window);
