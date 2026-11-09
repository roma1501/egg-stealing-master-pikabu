/* =========================================================
   Lucky Wheel (owned by the SYSTEMS agent)
   - One free spin per device calendar day + 3 extra spins per day for rewarded ads (wheel-spin).
   - Every sector and prize is visible before spinning; prizes are gems, cash and, more rarely,
     a shop cosmetic (an owned one converts to gems; the Daily Gift exclusive never appears).
   - The result is chosen and granted (once) before the animation starts; the wheel then
     turns to stop exactly on that sector, so a hidden tab or a closed panel cannot lose or
     duplicate the prize.
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U;

  var AD_SPINS_PER_DAY = 3;
  var N = 8, SECTOR = 360 / N;
  var SPIN_TIME = 4.8;
  var COLORS = ['#ff8a3d', '#3fc760', '#3aa0ff', '#c75bff', '#ffcf2b', '#2fcfa8', '#ff5b7a', '#7a63ff'];

  function ease(t) { return 1 - Math.pow(1 - t, 4); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hms(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
  }
  function pt(angleDeg, r) {
    var a = angleDeg * Math.PI / 180;
    return (r * Math.sin(a)).toFixed(2) + ' ' + (-r * Math.cos(a)).toFixed(2);
  }

  var Wheel = {
    AD_SPINS_PER_DAY: AD_SPINS_PER_DAY,
    spinning: false, rotation: 0, current: null, p: null, raf: 0, timer: null, result: null,

    /* ---------- availability ---------- */
    state: function () { return SE.State.data.wheel; },
    freeAvailable: function () {
      var d = this.state().freeDay;
      return !d || d < SE.State.today();
    },
    adSpinsLeft: function () {
      var w = this.state();
      return w.adDay === SE.State.today() ? Math.max(0, AD_SPINS_PER_DAY - w.adSpins) : AD_SPINS_PER_DAY;
    },
    msToFree: function () {
      var n = new Date();
      var next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0);
      return next.getTime() - n.getTime();
    },

    /* ---------- sectors (same for everybody on a given day) ---------- */
    sectors: function () {
      var day = SE.State.today();
      var a = SE.Shop.pickItem('wheel:' + day + ':a', 0, 2);
      var b = SE.Shop.pickItem('wheel:' + day + ':b', 3, 4);
      var list = [
        { kind: 'gems', gems: 25, w: 22 },
        { kind: 'money', k: 1, w: 18 },
        { kind: 'gems', gems: 45, w: 16 },
        a ? { kind: 'item', item: a, w: 8 } : { kind: 'gems', gems: 60, w: 8 },
        { kind: 'gems', gems: 70, w: 12 },
        { kind: 'money', k: 3, w: 10 },
        { kind: 'gems', gems: 150, w: 5 },
        b ? { kind: 'item', item: b, w: 3 } : { kind: 'gems', gems: 200, w: 3 }
      ];
      list.forEach(function (s, i) {
        s.index = i; s.color = COLORS[i];
        if (s.kind === 'money') s.money = SE.Daily.cash(s.k);
        if (s.kind === 'item' && SE.Shop.owned(s.item)) { s.convert = SE.Shop.dupeGems(s.item); }
      });
      return list;
    },

    label: function (s) {
      if (s.kind === 'gems') return SE.t('wheel.gems', s.gems);
      if (s.kind === 'money') return SE.t('wheel.cash', U.money(s.money));
      return s.convert ? SE.t('wheel.converted', s.convert) : SE.Shop.itemName(s.item);
    },

    /* Pays the prize of a sector once, converting a duplicate cosmetic to gems. */
    grantPrize: function (s) {
      var text;
      if (s.kind === 'gems') { SE.State.addGems(s.gems); text = SE.t('wheel.gems', s.gems); }
      else if (s.kind === 'money') { SE.State.addMoney(s.money); text = SE.t('wheel.cash', U.money(s.money)); }
      else if (SE.Shop.owned(s.item)) {
        var g = SE.Shop.dupeGems(s.item);
        SE.State.addGems(g);
        text = SE.t('wheel.gems', g);
      } else {
        SE.Shop.grant(s.item, true);
        text = SE.Shop.itemName(s.item);
      }
      return text;
    },

    pick: function (sectors) {
      var total = 0, i;
      for (i = 0; i < sectors.length; i++) total += sectors[i].w;
      var r = Math.random() * total;
      for (i = 0; i < sectors.length; i++) { r -= sectors[i].w; if (r <= 0) return i; }
      return sectors.length - 1;
    },

    /* ---------- spinning ---------- */
    /* kind: 'free' | 'ad'. The caller has already verified availability; this verifies again. */
    spin: function (kind) {
      var self = this, w = this.state();
      if (this.spinning) return false;
      var today = SE.State.today();
      if (kind === 'free') {
        if (!this.freeAvailable()) return false;
        w.freeDay = today;
      } else {
        if (this.adSpinsLeft() <= 0) return false;
        if (w.adDay !== today) { w.adDay = today; w.adSpins = 0; }
        w.adSpins++;
      }
      w.spins++;
      this.lastKind = kind;
      var sectors = this.current || this.sectors();
      var idx = this.pick(sectors);
      var prize = sectors[idx];
      var text = this.grantPrize(prize);         /* granted exactly once, before any animation */
      SE.State.save();
      this.result = { index: idx, text: text, shown: false };
      this.spinning = true;
      SE.Audio.play('powerup', { volume: 0.5 });

      /* stop exactly on the chosen sector: its centre ends under the pointer (±10° jitter) */
      var jitter = (Math.random() - 0.5) * 20;
      var from = this.rotation % 360;
      var target = 360 * 6 + (360 - idx * SECTOR) + jitter;
      this.anim = { from: from, to: target, t: 0, lastTick: Math.floor((from + SECTOR / 2) / SECTOR) };
      this.refreshButtons();
      this.stepFrame(performance.now());
      return true;
    },

    stepFrame: function (now) {
      var self = this;
      this.raf = 0;
      var a = this.anim;
      if (!a) return;
      this.raf = requestAnimationFrame(function (t) { self.stepFrame(t); });
      var dt = a.last === undefined ? 0 : Math.min(0.1, (now - a.last) / 1000);
      a.last = now;
      if (SE.Platform.paused) return;
      a.t += dt;
      var k = Math.min(1, a.t / SPIN_TIME);
      var angle = a.from + (a.to - a.from) * ease(k);
      this.setRotation(angle);
      var tick = Math.floor((angle + SECTOR / 2) / SECTOR);
      if (tick !== a.lastTick) { a.lastTick = tick; SE.Audio.play('blip', { volume: 0.18, rate: 1 + k * 0.3 }); }
      if (k >= 1) this.finish();
    },

    setRotation: function (angle) {
      this.rotation = angle;
      var g = this.p && this.p.body.querySelector('.wh-rotor');
      if (g) g.setAttribute('transform', 'rotate(' + angle.toFixed(2) + ')');
    },

    finish: function () {
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      this.anim = null;
      this.spinning = false;
      var r = this.result;
      if (r && !r.shown) {
        r.shown = true;
        SE.Audio.play('reward', { volume: 0.8 });
        if (SE.FX && SE.Player) SE.FX.burst('sparkle', SE.Player.pos);
        SE.UI.updateHUD();
        if (this.p && SE.UI.current === 'wheel') this.showResult(r);
        else SE.UI.toast(SE.t('wheel.result', r.text), 'good');
        /* after a free spin (not the rewarded one) — an interstitial point (Playables) */
        if (this.lastKind === 'free') SE.Tasks.timeout(function () { SE.Ads.breakPoint('wheel'); }, 1500);
      }
      if (SE.UI.current === 'wheel') {
        (this.current || []).forEach(function (sec) {
          if (sec.kind === 'item' && SE.Shop.owned(sec.item)) sec.convert = SE.Shop.dupeGems(sec.item);
        });
        this.refreshLegend();
        this.refreshButtons();
        this.updateGems();
      }
    },

    showResult: function (r) {
      var box = this.p && this.p.body.querySelector('.wh-result');
      if (box && r) { box.innerHTML = '<span>' + SE.t('wheel.result', r.text) + '</span>'; box.classList.add('show'); }
    },

    /* The panel was closed mid-spin: finish the bookkeeping, the prize is already paid. */
    onClose: function () {
      if (this.timer) { SE.Tasks.clear(this.timer); this.timer = null; }
      this.current = null;
      if (this.spinning) {
        if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
        var r = this.result;
        this.anim = null; this.spinning = false;
        if (r && !r.shown) { r.shown = true; SE.Audio.play('reward', { volume: 0.7 }); SE.UI.toast(SE.t('wheel.result', r.text), 'good'); }
        SE.UI.updateHUD();
      }
    },

    watchSpin: function () {
      var self = this;
      if (this.spinning || this.adSpinsLeft() <= 0) return;
      SE.Ads.watch(SE.Ads.IDS.wheelSpin, function () { self.spin('ad'); }, function () { self.refreshButtons(); });
    },

    /* ---------- panel ---------- */
    wheelSvg: function (sectors) {
      var R = 140, svg = '<svg class="wh-svg" viewBox="-160 -160 320 320" focusable="false" aria-hidden="true">';
      svg += '<circle r="156" fill="#7a3f12" stroke="#1a0f06" stroke-width="4"/>';
      svg += '<g class="wh-rotor" transform="rotate(' + this.rotation.toFixed(2) + ')">';
      for (var i = 0; i < sectors.length; i++) {
        var s = sectors[i], a0 = i * SECTOR - SECTOR / 2, a1 = i * SECTOR + SECTOR / 2;
        svg += '<path d="M0 0 L' + pt(a0, R) + ' A' + R + ' ' + R + ' 0 0 1 ' + pt(a1, R) + ' Z" fill="' + s.color + '" stroke="#1a0f06" stroke-width="3" stroke-linejoin="round"/>';
        svg += '<path d="M0 0 L' + pt(a0, R) + ' A' + R + ' ' + R + ' 0 0 1 ' + pt(a1, R) + ' Z" fill="#fff" opacity=".12"/>';
        var inner = null, png = null;
        if (s.kind === 'gems') inner = SE.Icons.inner('gem');
        else if (s.kind === 'money') png = 'banknotes';
        else {
          var tabIcon = SE.Shop.TAB_ICON[s.item.slot];
          inner = SE.Icons.inner(tabIcon);
          if (!inner) png = tabIcon;
        }
        var txt = s.kind === 'gems' ? String(s.gems) : (s.kind === 'money' ? U.shortNum(s.money) : '');
        svg += '<g transform="rotate(' + (i * SECTOR) + ') translate(0 -88)">';
        if (png) svg += '<image href="' + SE.Icons.url(png) + '" x="-21" y="-28" width="42" height="42"/>';
        else if (inner) svg += '<svg x="-20" y="-28" width="40" height="40" viewBox="0 0 64 64">' + inner + '</svg>';
        if (txt) svg += '<text y="30" text-anchor="middle" font-size="21" font-weight="900" font-family="Nunito, Arial, sans-serif" fill="#fff" stroke="#1a0f06" stroke-width="5" paint-order="stroke" stroke-linejoin="round">' + txt + '</text>';
        else svg += '<text y="30" text-anchor="middle" font-size="15" font-weight="900" font-family="Nunito, Arial, sans-serif" fill="#fff" stroke="#1a0f06" stroke-width="4" paint-order="stroke" stroke-linejoin="round">' + SE.t('tab.' + s.item.slot) + '</text>';
        svg += '</g>';
      }
      /* bulbs on the rim */
      for (var b = 0; b < 16; b++) {
        svg += '<circle cx="' + (150 * Math.sin(b * Math.PI / 8)).toFixed(1) + '" cy="' + (-150 * Math.cos(b * Math.PI / 8)).toFixed(1) + '" r="3.4" fill="' + (b % 2 ? '#fff4b0' : '#ffd24a') + '" stroke="#1a0f06" stroke-width="1.4"/>';
      }
      svg += '</g>';
      /* golden egg hub and the pointer (they do not rotate) */
      svg += '<ellipse cx="0" cy="0" rx="22" ry="27" fill="#ffd24a" stroke="#1a0f06" stroke-width="4"/>' +
        '<path d="M-17 -4 Q0 6 17 -4" fill="none" stroke="#e08a1a" stroke-width="4"/>' +
        '<ellipse cx="-7" cy="-12" rx="5" ry="8" fill="#fff" opacity=".7"/>';
      svg += '<path d="M0 -122 L-15 -156 L15 -156 Z" transform="translate(0 6)" fill="#e83a2a" stroke="#1a0f06" stroke-width="4" stroke-linejoin="round"/>';
      return svg + '</svg>';
    },

    legendHtml: function (sectors) {
      var out = '';
      for (var i = 0; i < sectors.length; i++) {
        var s = sectors[i], ic;
        if (s.kind === 'gems') ic = SE.Icons.html('gem');
        else if (s.kind === 'money') ic = SE.Icons.html('banknotes');
        else ic = '<i class="wh-thumb" data-key="' + s.item.key + '"></i>';
        out += '<div class="wh-prize" style="--pc:' + s.color + '"><span class="wh-pc"></span><span class="wh-pic">' + ic + '</span>' +
          '<span class="wh-ptxt">' + this.label(s) + '</span></div>';
      }
      return out;
    },

    render: function (p) {
      var self = this;
      this.p = p;
      p.body.innerHTML = '';
      p.foot.style.display = 'none';
      if (!p.head.querySelector('.wd-gems')) {
        p.head.insertBefore(U.el('div', 'wd-gems stroke'), p.head.querySelector('.close-btn'));
      }
      this.updateGems();
      var sectors = this.current = this.current || this.sectors();
      var root = U.el('div', 'wh');
      root.innerHTML =
        '<div class="wh-stage"><div class="wh-wheel">' + this.wheelSvg(sectors) + '</div></div>' +
        '<div class="wh-side">' +
          '<div class="wh-result" aria-live="polite"></div>' +
          '<div class="wh-prizes-title stroke">' + SE.t('wheel.prizes') + '</div>' +
          '<div class="wh-prizes">' + this.legendHtml(sectors) + '</div>' +
          '<div class="wh-buttons"></div>' +
        '</div>';
      p.body.appendChild(root);
      this.fillThumbs(root);
      this.refreshButtons();
      if (this.timer) SE.Tasks.clear(this.timer);
      this.timer = SE.Tasks.timeout(function () { self.tick(); }, 500);
    },

    fillThumbs: function (root) {
      U.$$('.wh-thumb', root).forEach(function (el) {
        var sl = el.dataset.key.split(':')[0], id = el.dataset.key.split(':').slice(1).join(':');
        var item = SE.Shop.find(sl, id);
        if (!item) return;
        el.innerHTML = SE.Icons.html(SE.Shop.TAB_ICON[sl]);
        SE.Thumbs.request(item, function (url) {
          if (url && el.isConnected) { el.innerHTML = ''; el.style.backgroundImage = 'url(' + url + ')'; }
        });
      });
    },

    refreshLegend: function () {
      var box = this.p && this.p.body.querySelector('.wh-prizes');
      if (!box || !this.current) return;
      box.innerHTML = this.legendHtml(this.current);
      this.fillThumbs(box);
    },

    updateGems: function () {
      if (!this.p) return;
      var pill = this.p.head.querySelector('.wd-gems');
      if (pill) pill.innerHTML = SE.Icons.html('gem') + '<span>' + U.shortNum(SE.State.data.gems) + '</span>';
    },

    refreshButtons: function () {
      var self = this, p = this.p;
      if (!p) return;
      var box = p.body.querySelector('.wh-buttons');
      if (!box) return;
      box.innerHTML = '';
      var busy = this.spinning;
      var free = this.freeAvailable();
      this.lastFree = free; this.lastAds = SE.Ads.available();
      var spin = U.el('button', 'btn big wh-spin' + (free ? '' : ' grey'));
      if (busy) spin.textContent = SE.t('wheel.spinning');
      else if (free) spin.innerHTML = SE.Icons.html('prize-wheel') + '<span>' + SE.t('wheel.free') + '</span>';
      else spin.innerHTML = '<span class="wh-timer">' + SE.t('wheel.freeIn', hms(this.msToFree())) + '</span>';
      spin.disabled = busy || !free;
      spin.addEventListener('click', function () { if (!spin.disabled) { spin.disabled = true; self.spin('free'); } });
      box.appendChild(spin);

      var left = this.adSpinsLeft();
      var ad = SE.Ads.button(SE.Ads.IDS.wheelSpin, {
        cls: 'btn ad wh-ad',
        html: SE.Icons.html('watch-video') + '<span>' + SE.t('wheel.adSpin') + '</span>',
        disabled: busy || left <= 0,
        onClick: function (b) { SE.Ads.setButtonDisabled(b, true); self.watchSpin(); }
      });
      box.appendChild(ad);
      var note = '';
      if (left <= 0) note = SE.t('wheel.noSpins');
      else {
        note = SE.t('wheel.adLeft', left, AD_SPINS_PER_DAY);
        if (!SE.Ads.available() && !busy) note += ' · ' + SE.Ads.explain();
      }
      box.appendChild(U.el('div', 'wh-note', note));
    },

    tick: function () {
      var self = this;
      this.timer = null;
      if (SE.UI.current !== 'wheel') return;
      if (!this.spinning) {
        if (this.freeAvailable() !== this.lastFree || SE.Ads.available() !== this.lastAds) this.refreshButtons();
        else {
          var t = this.p.body.querySelector('.wh-timer');
          if (t) t.textContent = SE.t('wheel.freeIn', hms(this.msToFree()));
        }
      }
      this.timer = SE.Tasks.timeout(function () { self.tick(); }, 1000);
    },

    /* HUD badge: the free spin is ready. */
    updateBadge: function () {
      var btn = document.getElementById('btnWheel');
      if (btn) btn.classList.toggle('has-badge', this.freeAvailable() && !!SE.State.data.tutorialDone);
    }
  };

  SE.Wheel = Wheel;
})(window);
