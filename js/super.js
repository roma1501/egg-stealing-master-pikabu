/* =========================================================
   Super Rewards (owned by the SYSTEMS agent)
   Three tracks. Watch 5 rewarded ads, each one confirmed by the SDK, and the 5th
   confirmed view pays one big prize exactly once; the track then resets to 0/5.
     Mythic Egg   (placement super-egg)   a legendary-or-mythic egg of the best unlocked island
     Gem Vault    (placement super-gems)  ~300 gems + a rare/epic cosmetic the player does not own
     Golden Rush  (placement super-rush)  x3 income + x2 speed for 10 minutes + a big cash pile
   Progress lives in SE.State.data.superRewards and survives a reload. A closed, failed or
   unavailable ad never advances a track. Every step has its own cooldown (see Ads).
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U;

  var STEPS = 5;
  var GEMS = 300, GEMS_FALLBACK = 150, RUSH_SECONDS = 600, CASH_MULT = 5;

  var TRACKS = [
    { id: 'egg', placement: 'super-egg', art: 'egg-sky', cls: 'sr-egg' },
    { id: 'gems', placement: 'super-gems', art: 'gem', cls: 'sr-gems' },
    { id: 'rush', placement: 'super-rush', art: 'cash-bonus', cls: 'sr-rush' }
  ];

  var Super = {
    STEPS: STEPS, TRACKS: TRACKS, p: null, claim: null,

    state: function () { return SE.State.data.superRewards; },
    progress: function (id) { return this.state()[id] || 0; },
    track: function (id) { for (var i = 0; i < TRACKS.length; i++) if (TRACKS[i].id === id) return TRACKS[i]; return null; },

    /* ---------- prizes (shown up front) ---------- */
    bestBiome: function () { return SE.Pets.BIOMES[SE.State.highestZone()]; },
    cashPrize: function () { return SE.Game.cashBonusAmount() * CASH_MULT; },
    /* The cosmetic of the vault is picked deterministically so what is shown is what is paid. */
    vaultItem: function () {
      return SE.Shop.pickItem('super:gems:' + this.state().done.gems, 2, 3);
    },
    eggSpace: function () { return SE.State.freePen() >= 0 || !SE.Game.carrying; },

    /* ---------- watching ---------- */
    /* Whether the next view may start. The last step of the egg needs room for the egg. */
    blocked: function (id) {
      if (id === 'egg' && this.progress('egg') >= STEPS - 1 && !this.eggSpace()) return SE.t('super.needSpace');
      return '';
    },

    watch: function (id) {
      var self = this, t = this.track(id);
      if (!t || SE.Tutorial.active || this.blocked(id)) return;
      SE.Ads.watch(t.placement, function () {
        var s = self.state();
        s[id] = (s[id] || 0) + 1;                      /* only a confirmed view gets here */
        if (s[id] >= STEPS) {
          s[id] = 0;                                   /* reset and pay in the same step: exactly once */
          s.done[id]++;
          self.claim = { id: id, text: self.grant(id) };
        } else {
          SE.Audio.play('reward', { volume: 0.6 });
          SE.UI.toast(SE.t('shop.progress', s[id], STEPS), 'good');
        }
        SE.State.save();
        SE.UI.updateHUD();
      }, function () {
        if (SE.UI.current === 'super') SE.UI.refresh();
      });
    },

    grant: function (id) {
      var text = '', pos = SE.Player.pos;
      if (id === 'egg') {
        var biome = this.bestBiome();
        var egg = { biome: biome.id, rarity: Math.random() < 0.7 ? 4 : 5, uid: 'e' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36) };
        var free = SE.State.freePen();
        if (free >= 0) {
          SE.State.placeEgg(free, egg, SE.Boosts);
          SE.Game.refreshPens();
        } else {
          SE.Game.carrying = egg;
          SE.Game.deliveredUid = egg.uid;              /* carried to a free pen, not counted as a delivery round */
          SE.Player.setCarry(egg);
        }
        text = SE.t('super.got.egg', SE.t(SE.Pets.RARITIES[egg.rarity].key), SE.t(biome.key));
      } else if (id === 'gems') {
        var item = this.vaultItem();
        var gems = GEMS + (item ? 0 : GEMS_FALLBACK);
        SE.State.addGems(gems);
        text = SE.t('wheel.gems', gems);
        if (item) { SE.Shop.grant(item, true); text += ' + ' + SE.Shop.itemName(item); }
      } else {
        SE.Boosts.activate('goldenRush', RUSH_SECONDS);
        SE.Boosts.activate('speedBoost', RUSH_SECONDS);
        var cash = this.cashPrize();
        SE.State.addMoney(cash);
        text = SE.t('super.got.rush', U.money(cash));
      }
      SE.Audio.play('reward', { volume: 0.9 });
      SE.Audio.play('unlock', { volume: 0.6 });
      SE.FX.burst('unlock', pos);
      SE.FX.burst('confetti', pos);
      SE.UI.toast(text, 'good');
      return text;
    },

    /* ---------- panel ---------- */
    onClose: function () { this.claim = null; },

    prizeHtml: function (id) {
      if (id === 'egg') {
        return '<b>' + SE.t('super.egg.t') + '</b><span>' + SE.t('super.egg.d', SE.t(this.bestBiome().key)) + '</span>';
      }
      if (id === 'gems') {
        var item = this.vaultItem();
        var extra = item ? SE.t('super.gems.item', SE.Shop.itemName(item)) : SE.t('super.gems.more', GEMS_FALLBACK);
        return '<b>' + SE.t('super.gems.t') + '</b><span>' + SE.t('super.gems.d', GEMS) + ' ' + extra + '</span>';
      }
      return '<b>' + SE.t('super.rush.t') + '</b><span>' + SE.t('super.rush.d', RUSH_SECONDS / 60, U.money(this.cashPrize())) + '</span>';
    },

    render: function (p) {
      var self = this;
      this.p = p;
      var root = U.el('div', 'sr');
      root.innerHTML = '<div class="sr-sub stroke">' + SE.t('super.sub', STEPS) + '</div><div class="sr-cards"></div>';
      var cards = root.querySelector('.sr-cards');
      TRACKS.forEach(function (t) {
        var done = self.progress(t.id), blocked = self.blocked(t.id);
        var art = t.id === 'egg' ? '<span class="sr-egg-ic">' + SE.Icons.html('egg-sky') + '</span>' :
          (t.id === 'gems' ? '<span class="sr-main-ic">' + SE.Icons.html('gem') + '</span>' : '<span class="sr-main-ic">' + SE.Icons.html('cash-bonus') + '</span>');
        var pips = '';
        for (var i = 0; i < STEPS; i++) pips += '<i class="' + (i < done ? 'on' : (i === done ? 'next' : '')) + '"></i>';
        var card = U.el('div', 'sr-card ' + t.cls + (done >= STEPS - 1 ? ' last' : ''));
        card.innerHTML =
          '<div class="sr-art"><span class="sr-rays"></span><span class="sr-glow"></span>' + art +
          '<span class="sr-spark s1"></span><span class="sr-spark s2"></span><span class="sr-spark s3"></span></div>' +
          '<div class="sr-prize">' + self.prizeHtml(t.id) + '</div>' +
          '<div class="sr-pips" aria-hidden="true">' + pips + '</div>';
        var btn = SE.Ads.button(t.placement, {
          cls: 'btn big ad sr-btn',
          html: SE.Icons.html('watch-video') + '<span>' + SE.t('shop.watch', done, STEPS) + '</span>',
          disabled: !!blocked,
          onClick: function (b) { SE.Ads.setButtonDisabled(b, true); self.watch(t.id); }
        });
        card.appendChild(btn);
        var note = blocked || (!SE.Ads.available() ? SE.Ads.explain() : '');
        if (note) card.appendChild(U.el('div', 'sr-note', note));
        cards.appendChild(card);
      });
      p.body.appendChild(root);

      /* the claim celebration */
      if (this.claim) {
        var c = this.claim, t = this.track(c.id);
        var ov = U.el('div', 'sr-claim ' + t.cls);
        ov.innerHTML = '<div class="sr-claim-art"><span class="sr-rays"></span><span class="sr-glow"></span>' +
          (c.id === 'egg' ? '<span class="sr-egg-ic">' + SE.Icons.html('egg-sky') + '</span>' : '<span class="sr-main-ic">' + SE.Icons.html(t.art) + '</span>') +
          '</div><div class="sr-claim-title stroke">' + SE.t('super.claimed') + '</div><div class="sr-claim-text stroke">' + c.text + '</div>';
        var ok = U.el('button', 'btn big', SE.t('btn.ok'));
        ok.addEventListener('click', function () { self.claim = null; SE.UI.refresh(); });
        ov.appendChild(ok);
        p.body.appendChild(ov);
      }
    }
  };

  SE.Super = Super;
})(window);
