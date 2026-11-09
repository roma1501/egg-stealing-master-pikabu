/* =========================================================
   Daily Gift (owned by the SYSTEMS agent)
   - 7-day cycle, one claim per device calendar day, missed days never reset the week.
   - Days 1-6: gems / cash / shop items, growing. "Watch ad: x2" (rewarded id daily-x2)
     doubles gems and cash only after the SDK confirms; the base gift is always claimable.
   - Day 7: an exclusive outfit that is not sold in the shop and not on the wheel, shown
     as the goal all week. The next weeks use the next exclusive; when they run out the
     day 7 reward becomes a large pile of gems.
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U;

  var BIG_GEMS = 750;
  var offeredThisSession = false;

  var Daily = {
    CYCLE: 7,
    claiming: false,
    p: null,

    /* ---------- state ---------- */
    state: function () { return SE.State.data.daily; },
    /* 0..6: the day that the next claim opens (the streak counts all claims ever made). */
    dayIndex: function () { return this.state().streak % this.CYCLE; },
    cycle: function () { return Math.floor(this.state().streak / this.CYCLE); },
    /* A device clock set back never opens a second gift for the same or an earlier day. */
    claimedToday: function () {
      var last = this.state().lastClaimDay;
      return !!last && last >= SE.State.today();
    },
    canClaim: function () { return !this.claimedToday(); },

    /* ---------- rewards ---------- */
    /* Cash scales with progress like the old daily reward did. */
    cash: function (k) {
      var inc = Math.max(200, SE.State.incomePerSec(null) * 120);
      var raw = (inc * 0.6 + 200) * k;
      var mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
      return Math.max(100, Math.round(raw / mag) * mag);
    },

    exclusive: function () {
      var list = SE.Shop.exclusives();
      for (var i = 0; i < list.length; i++) if (!SE.Shop.owned(list[i])) return list[i];
      return null;
    },

    /* The reward of one day of a week: { gems, money, item, exclusive, bigGems }. */
    rewardFor: function (day, cycle) {
      var scale = 1 + Math.min(cycle, 4) * 0.25;
      function g(n) { return Math.round(n * scale / 5) * 5; }
      var r = { gems: 0, money: 0, item: null, exclusive: null, bigGems: false };
      switch (day) {
        case 0: r.gems = g(40); break;
        case 1: r.money = this.cash(2); break;
        case 2: r.gems = g(80); break;
        case 3: r.gems = g(30); r.item = SE.Shop.pickItem('daily:' + cycle + ':3', 0, 1); break;
        case 4: r.gems = g(60); r.money = this.cash(4); break;
        case 5: r.gems = g(120); r.item = SE.Shop.pickItem('daily:' + cycle + ':5', 2, 3); break;
        default:
          r.exclusive = this.exclusive();
          if (!r.exclusive) { r.gems = BIG_GEMS; r.bigGems = true; }
      }
      /* an item that is already owned is replaced with its gem value */
      if (r.item && SE.Shop.owned(r.item)) { r.gems += SE.Shop.dupeGems(r.item); r.item = null; }
      if (day < 6 && !r.gems && !r.money && !r.item) r.gems = g(40);
      /* one currency (Poki): gems become cash that grows with the player's income */
      if (r.gems && SE.Shop.cashMode()) { r.money += this.cash(r.gems / 25); r.gems = 0; }
      return r;
    },

    /* ---------- claiming ---------- */
    claim: function (mult) {
      if (this.claiming || !this.canClaim()) {
        if (!this.canClaim()) SE.UI.toast(SE.t('daily.claimed'), 'error');
        return false;
      }
      this.claiming = true;
      var s = this.state();
      var day = this.dayIndex(), cycle = this.cycle();
      var r = this.rewardFor(day, cycle);
      var m = day === 6 ? 1 : (mult || 1);
      /* mark first: a second tap, a second ad callback or a reload can never pay twice */
      s.lastClaimDay = SE.State.today();
      s.lastClaim = Date.now();
      s.streak++;
      if (r.gems) SE.State.addGems(r.gems * m);
      if (r.money) SE.State.addMoney(r.money * m);
      var names = [];
      if (r.item) { SE.Shop.grant(r.item, true); names.push(SE.Shop.itemName(r.item)); }
      if (r.exclusive) { SE.Shop.grant(r.exclusive, true); names.push(SE.Shop.itemName(r.exclusive)); }
      SE.State.save();
      SE.Audio.play('reward', { volume: 0.8 });
      if (SE.FX && SE.Player) SE.FX.burst('confetti', SE.Player.pos);
      var msg = SE.t('daily.gotIt');
      if (r.gems) msg += ' ' + SE.t('msg.gemsGot', r.gems * m);
      if (names.length) msg += ' ' + names.join(', ');
      SE.UI.toast(msg, 'good');
      SE.UI.updateHUD();
      this.claiming = false;
      this.lastClaim = { day: day, mult: m, reward: r };
      if (SE.UI.current === 'daily') SE.UI.refresh();
      return true;
    },

    /* "Watch ad: x2": only a confirmed rewarded view doubles the gift. */
    claimDoubled: function (done) {
      var self = this;
      if (!this.canClaim() || this.dayIndex() === 6) { if (done) done(false); return; }
      SE.Ads.watch(SE.Ads.IDS.dailyX2, function () { self.claim(2); }, function (ok) { if (done) done(ok); });
    },

    /* ---------- offering ---------- */
    busyWorld: function () {
      var g = SE.Game;
      return !!(SE.Tutorial && SE.Tutorial.active) || SE.UI.isOpen() || !!g.carrying ||
        SE.Guards.anyChasing('player') || SE.Platform.paused;
    },
    /* Offer the gift from the "menu": at the start of a session or right after the tutorial. */
    maybeOffer: function (afterTutorial) {
      var self = this;
      if (!SE.State.data.tutorialDone || (SE.Tutorial && SE.Tutorial.active)) return;
      if (offeredThisSession && !afterTutorial) return;
      if (!this.canClaim()) return;
      offeredThisSession = true;
      SE.Tasks.timeout(function () {
        if (!self.canClaim() || self.busyWorld()) { SE.UI.updateHUD(); return; }
        SE.UI.open('daily');
      }, afterTutorial ? 1500 : 1200);
    },

    /* ---------- panel ---------- */
    onClose: function () { SE.Preview.detach(); },

    /* One reward as pieces of HTML: icon + text rows. */
    rowsHtml: function (r, mult) {
      var rows = '';
      mult = mult || 1;
      if (r.gems) rows += '<div class="dg-row">' + SE.Icons.html('gem') + '<b>' + U.shortNum(r.gems * mult) + '</b><span>' + SE.t('ui.gems') + '</span></div>';
      if (r.money) rows += '<div class="dg-row">' + SE.Icons.html('banknotes') + '<b>' + U.money(r.money * mult) + '</b></div>';
      if (r.item) rows += '<div class="dg-row dg-item" data-key="' + r.item.key + '"><i class="dg-thumb"></i><b>' + SE.Shop.itemName(r.item) + '</b></div>';
      if (r.exclusive) rows += '<div class="dg-row dg-item" data-key="' + r.exclusive.key + '"><i class="dg-thumb"></i><b>' + SE.Shop.itemName(r.exclusive) + '</b></div>';
      return rows;
    },

    fillThumbs: function (root) {
      U.$$('.dg-item', root).forEach(function (row) {
        var item = SE.Shop.find(row.dataset.key.split(':')[0], row.dataset.key.split(':').slice(1).join(':'));
        if (!item) return;
        SE.Thumbs.request(item, function (url) {
          var t = row.querySelector('.dg-thumb');
          if (url && t && row.isConnected) t.style.backgroundImage = 'url(' + url + ')';
        });
      });
    },

    render: function (p) {
      var self = this;
      this.p = p;
      var s = this.state();
      var claimed = this.claimedToday();
      var idx = this.dayIndex();
      /* after today's claim the highlighted day is the one just claimed (and its week) */
      var viewIdx = claimed ? (s.streak - 1) % this.CYCLE : idx;
      var viewCycle = claimed ? Math.floor((s.streak - 1) / this.CYCLE) : this.cycle();
      var goal = this.rewardFor(6, claimed ? this.cycle() : viewCycle);
      var todayReward = claimed ? (this.lastClaim ? this.lastClaim.reward : null) : this.rewardFor(idx, viewCycle);

      var body = U.el('div', 'dg');
      body.innerHTML =
        '<div class="dg-sub stroke">' + SE.t('daily.sub') + '</div>' +
        '<div class="dg-week"></div>' +
        '<div class="dg-main">' +
          '<div class="dg-goal"><div class="dg-goal-view"><div class="dg-host"></div></div><div class="dg-goal-cap"></div></div>' +
          '<div class="dg-today"></div>' +
        '</div>';
      p.body.appendChild(body);

      /* the week strip */
      var week = body.querySelector('.dg-week');
      for (var d = 0; d < this.CYCLE; d++) {
        var r = this.rewardFor(d, viewCycle);
        var done = claimed ? d <= viewIdx : d < idx;
        var isToday = !claimed && d === idx;
        var tile = U.el('div', 'dg-tile' + (done ? ' done' : '') + (isToday ? ' today' : '') + (d === 6 ? ' last' : ''));
        var icon = d === 6 ? SE.Icons.html(r.exclusive ? 'outfit' : (r.gems ? 'gem' : 'banknotes')) : (r.item ? SE.Icons.html(SE.Shop.TAB_ICON[r.item.slot]) :
          (r.gems && !r.money ? SE.Icons.html('gem') : SE.Icons.html('banknotes')));
        var label = d === 6 ? (r.exclusive ? SE.t('daily.exclusive') : (r.gems ? U.shortNum(r.gems) : U.money(r.money))) :
          ((r.gems ? U.shortNum(r.gems) : (r.money ? U.money(r.money) : '')) + (r.item ? '+' : ''));
        tile.innerHTML = '<div class="dg-day">' + SE.t('daily.day', d + 1) + '</div><div class="dg-ic">' + icon + '</div><div class="dg-amt">' + label + '</div>' +
          (done ? '<div class="dg-check">' + SE.Icons.html('check') + '</div>' : '');
        week.appendChild(tile);
      }

      /* the day 7 goal with a rotating preview of the exclusive outfit */
      var goalCap = body.querySelector('.dg-goal-cap');
      var host = body.querySelector('.dg-host');
      if (goal.exclusive) {
        var rc = SE.Pets.RARITIES[goal.exclusive.rarity];
        goalCap.innerHTML = '<div class="dg-goal-tag stroke">' + SE.t('daily.goal') + '</div>' +
          '<div class="dg-goal-name stroke">' + SE.Shop.itemName(goal.exclusive) + '</div>' +
          SE.Shop.stars(goal.exclusive.rarity) + '<div class="dg-goal-days">' + SE.t('daily.exclusive') + '</div>';
        SE.Preview.look = SE.Shop.lookFor({ outfit: goal.exclusive.id });
        requestAnimationFrame(function () {
          if (SE.UI.current !== 'daily') return;
          if (!SE.Preview.attach(host)) host.classList.add('no-3d');
          SE.Preview.setLook(SE.Shop.lookFor({ outfit: goal.exclusive.id }));
          SE.Preview.resize();
        });
      } else {
        var cashGoal = !goal.gems;
        host.innerHTML = '<div class="dg-pile">' + SE.Icons.html(cashGoal ? 'banknotes' : 'gem') + '</div>';
        goalCap.innerHTML = '<div class="dg-goal-tag stroke">' + SE.t('daily.goal') + '</div>' +
          '<div class="dg-goal-name stroke">' + (cashGoal ? U.money(goal.money) : U.shortNum(BIG_GEMS) + ' ' + SE.t('ui.gems')) + '</div>' +
          '<div class="dg-goal-days">' + SE.t(cashGoal ? 'daily.bigCash' : 'daily.bigGems') + '</div>';
      }

      /* today's reward block */
      var today = body.querySelector('.dg-today');
      var title = claimed ? SE.t('daily.claimed') : SE.t('daily.day', idx + 1) + ' · ' + SE.t('daily.today');
      var bigIcon = todayReward ? (todayReward.gems ? 'gem' : (todayReward.money ? 'banknotes' : 'gift')) : 'gift';
      today.innerHTML = '<div class="dg-today-title stroke">' + title + '</div>' +
        '<div class="dg-art"><span class="dg-art-glow"></span>' + SE.Icons.html(claimed ? 'check' : bigIcon) + '</div><div class="dg-rows">' +
        (todayReward ? this.rowsHtml(todayReward, claimed && this.lastClaim ? this.lastClaim.mult : 1) : '') + '</div>';
      if (claimed) {
        var nextDay = (s.streak % this.CYCLE) + 1;
        today.appendChild(U.el('div', 'dg-next stroke', SE.t('daily.comeBack', nextDay)));
      }
      this.fillThumbs(body);

      p.foot.style.display = 'flex';
      if (!claimed) {
        var claim = U.el('button', 'btn big dg-claim', SE.Icons.html('gift') + '<span>' + SE.t('daily.claim') + '</span>');
        claim.addEventListener('click', function () {
          if (claim.disabled) return;
          claim.disabled = true;
          if (self.claim(1)) SE.Tasks.timeout(function () { SE.Ads.breakPoint('daily'); }, 1200);   /* free claim only */
        });
        p.foot.appendChild(claim);
        if (idx !== 6) {
          var x2 = SE.Ads.button(SE.Ads.IDS.dailyX2, {
            cls: 'btn big ad dg-x2',
            html: SE.Icons.html('watch-video') + '<span>' + SE.t('daily.x2') + '</span>',
            onClick: function (b) {
              SE.Ads.setButtonDisabled(b, true); claim.disabled = true;
              self.claimDoubled(function (ok) { if (!ok && SE.UI.current === 'daily') SE.UI.refresh(); });
            }
          });
          p.foot.appendChild(x2);
          if (!SE.Ads.available()) p.foot.appendChild(U.el('div', 'dg-note', SE.Ads.explain()));
        } else {
          p.foot.appendChild(U.el('div', 'dg-note', SE.t('daily.noX2')));
        }
      } else {
        var ok = U.el('button', 'btn big', SE.t('btn.ok'));
        ok.addEventListener('click', function () { SE.UI.close(); });
        p.foot.appendChild(ok);
      }
    },

    /* HUD badge: a gift is waiting. */
    updateBadge: function () {
      var btn = document.getElementById('btnDaily');
      if (!btn) return;
      btn.classList.toggle('has-badge', this.canClaim() && !!SE.State.data.tutorialDone);
    }
  };

  SE.Daily = Daily;
})(window);
