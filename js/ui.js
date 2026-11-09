/* =========================================================
   Интерфейс: HUD, панели, магазины, лидеры, награды за рекламу
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U;

  var Icons = SE.Icons;

  var UI = {
    game: null,
    panels: {},
    current: null,
    selectedPet: null,
    thumbCache: {},

    init: function (game) {
      this.game = game;
      this.modals = document.getElementById('modals');
      this.hintEl = document.getElementById('hint');
      this.toastEl = document.getElementById('toasts');
      this.alarmEl = document.getElementById('alarm');
      Icons.mount(document);
      this.buildPanels();
      this.bindHud();

      /* клик по затемнению закрывает окно */
      var self = this;
      this.modals.addEventListener('pointerdown', function (e) {
        if (e.target === self.modals) {
          SE.Audio.play('close', { volume: 0.4 });
          self.close();
        }
      });

      SE.I18N.onChange(this.onLangChange.bind(this));
    },

    /* ---------------- HUD ---------------- */
    bindHud: function () {
      var self = this;
      var g = this.game;

      function bind(id, fn) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', function (e) {
          e.preventDefault();
          SE.Audio.play('click', { volume: 0.5 });
          fn();
        });
      }

      bind('btnShop', function () { self.openWithAd('wardrobe'); });
      bind('btnBoosts', function () { self.open('boosts'); });
      bind('btnSuper', function () { self.open('super'); });
      /* Super Rewards (5 ads for one prize) are an ad chain: hidden where the platform forbids it */
      if (SE.rule('superRewards', true) === false) document.documentElement.classList.add('no-super');
      /* one currency (no gems) and no Lucky Wheel where the platform asks for that (Poki) */
      if (SE.rule('gems', true) === false) document.documentElement.classList.add('no-gems');
      if (SE.rule('wheel', true) === false) document.documentElement.classList.add('no-wheel');
      bind('btnDaily', function () { self.openWithAd('daily'); });
      bind('btnWheel', function () { self.openWithAd('wheel'); });
      bind('btnHelpPause', function () { g.setPaused(false, 'manual'); SE.Tutorial.start(true); });
      bind('btnInventory', function () { self.openWithAd('inventory'); });
      bind('btnIndex', function () { SE.Audio.play('book_open'); self.openWithAd('index'); });
      bind('btnPets', function () { self.openWithAd('pets'); });
      bind('btnEggs', function () { self.open('eggs'); });
      bind('btnTrails', function () { self.openWithAd('trails'); });
      bind('btnSettings', function () { self.openWithAd('settings'); });
      bind('btnLeaders', function () { self.openWithAd('leaders'); });
      /* «Рекорды» — только там, где платформа даёт таблицу (Яндекс: лидерборд Score) */
      var lb = document.getElementById('btnLeaders');
      if (lb) lb.classList.toggle('lb-on', !!(SE.Platform.hasLeaderboard && SE.Platform.hasLeaderboard()));
      if (lb) lb.style.display = '';
      bind('btnResume', function () { g.resumeManual(); });

      var slow = document.getElementById('slowSwitch');
      slow.addEventListener('click', function () {
        g.slowMode = !g.slowMode;
        slow.classList.toggle('on', g.slowMode);
        slow.setAttribute('aria-checked', String(g.slowMode));
        SE.Audio.play('toggle', { volume: 0.6 });
      });

      /* мобильные кнопки */
      var jump = document.getElementById('btnJump');
      var act = document.getElementById('btnAction');
      var act2 = document.getElementById('btnAction2');
      function press(el, fn) {
        if (!el) return;
        el.addEventListener('touchstart', function (e) { e.preventDefault(); fn(); }, { passive: false });
        el.addEventListener('mousedown', function (e) { e.preventDefault(); fn(); });
      }
      press(jump, function () { SE.Input.jumpPressed = true; });
      press(act, function () { SE.Input.actionPressed = true; });
      press(act2, function () { SE.Input.action2Pressed = true; });
    },

    setMobile: function (on) {
      document.getElementById('mobile').classList.toggle('on', !!on);
      document.body.classList.toggle('touch-controls', !!on);
    },

    updateHUD: function () {
      var s = SE.State.data;
      var g = this.game;
      document.getElementById('statMoney').textContent = U.money(s.money);
      document.getElementById('statSpeed').textContent = Math.floor(s.speed);
      document.getElementById('statGems').textContent = U.shortNum(s.gems);
      var newBadge = document.querySelector('#btnShop .badge-new');
      if (newBadge) newBadge.style.display = s.flags.shopSeen ? 'none' : '';
      SE.Daily.updateBadge();
      SE.Wheel.updateBadge();
      var inc = SE.State.incomePerSec(SE.Boosts);
      document.getElementById('statIncome').textContent = U.money(inc) + SE.t('ui.perSec');
      document.getElementById('incomeChip').style.display = inc > 0 ? 'flex' : 'none';

      /* счётчики на кнопках */
      var eggs = 0, ready = 0;
      for (var i = 0; i < s.pens.length; i++) {
        if (s.pens[i].egg) eggs++;
        if (s.pens[i].pet) ready++;
      }
      var ec = document.getElementById('eggCount');
      ec.style.display = (eggs + ready) > 0 ? 'block' : 'none';
      ec.textContent = (eggs + ready);
      ec.style.background = ready > 0 ? '#2eb82e' : '#e02a1a';

      var pc = document.getElementById('petCount');
      pc.style.display = s.inventory.length > 0 ? 'block' : 'none';
      pc.textContent = s.equipped.length + '/' + SE.State.MAX_EQUIP;

      this.updateBoosts();
    },

    updateBoosts: function () {
      var list = SE.Boosts.list();
      var wrap = document.getElementById('boostList');
      var html = '';
      for (var i = 0; i < list.length; i++) {
        var o = SE.Ads.get(list[i].id);
        html += '<div class="chip boost stroke"><span>' + Icons.html(o ? o.icon : (list[i].id === 'goldenRush' ? 'cash-bonus' : 'star')) + '</span><span>' +
          U.timeShort(list[i].left) + '</span></div>';
      }
      wrap.innerHTML = html;
    },

    setHint: function (text) {
      if (!text) { this.hintEl.classList.remove('show'); return; }
      this.hintEl.textContent = text;
      this.hintEl.classList.add('show');
    },

    showAlarm: function (on) {
      this.alarmEl.classList.toggle('show', !!on);
    },

    toast: function (text, type) {
      var t = U.el('div', 'toast' + (type ? ' ' + type : ''), '');
      t.textContent = text;
      this.toastEl.appendChild(t);
      SE.Tasks.timeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
    },

    showAdWait: function (on) {
      document.getElementById('adWait').classList.toggle('show', !!on);
    },

    /* ---------------- Панели ---------------- */
    makePanel: function (id, opts) {
      var p = U.el('div', 'panel' + (opts.narrow ? ' narrow' : ''));
      p.id = 'panel-' + id;

      var head = U.el('div', 'panel-head' + (opts.headClass ? ' ' + opts.headClass : ''));
      head.innerHTML = '<span class="ic">' + Icons.html(opts.icon || 'bag') + '</span>' +
        '<span class="panel-title stroke" data-title="' + (opts.titleKey || '') + '"></span>';
      var close = U.el('button', 'close-btn', Icons.html('close'));
      close.setAttribute('aria-label', SE.t('btn.close'));
      var self = this;
      close.addEventListener('click', function () {
        SE.Audio.play('close', { volume: 0.5 });
        self.close();
      });
      head.appendChild(close);

      var body = U.el('div', 'panel-body');
      var foot = U.el('div', 'panel-foot');
      foot.style.display = 'none';

      p.appendChild(head);
      p.appendChild(body);
      p.appendChild(foot);
      this.modals.appendChild(p);

      this.panels[id] = { el: p, body: body, foot: foot, head: head, opts: opts };
      return this.panels[id];
    },

    buildPanels: function () {
      this.makePanel('wardrobe', { icon: 'shop', titleKey: 'ui.shop', headClass: 'barn' });
      this.makePanel('boosts', { icon: 'lightning', titleKey: 'ui.boosts' });
      this.makePanel('super', { icon: 'chest', titleKey: 'ui.super', headClass: 'gold' });
      this.makePanel('inventory', { icon: 'bag', titleKey: 'ui.inventory' });
      this.makePanel('index', { icon: 'book', titleKey: 'ui.index' });
      this.makePanel('pets', { icon: 'paw', titleKey: 'ui.pets' });
      this.makePanel('eggs', { icon: 'egg', titleKey: 'ui.eggs' });
      this.makePanel('trails', { icon: 'rainbow', titleKey: 'ui.trails', headClass: 'purple' });
      this.makePanel('settings', { icon: 'gear', titleKey: 'ui.settings' });
      this.makePanel('leaders', { icon: 'trophy', titleKey: 'ui.leaders', headClass: 'gold' });
      this.makePanel('result', { icon: 'finish-flag', titleKey: 'res.winTitle', narrow: true, headClass: 'green' });
      this.makePanel('daily', { icon: 'gift', titleKey: 'daily.title', headClass: 'gold' });
      this.makePanel('wheel', { icon: 'prize-wheel', titleKey: 'wheel.title', headClass: 'purple' });
      this.makePanel('confirm', { icon: 'question', titleKey: 'ui.shop', narrow: true });
    },

    /* Открытие меню: каждое 3-е открытие показывает межстраничную рекламу,
       панель открывается сразу после её закрытия. */
    /* HUD menu buttons: an interstitial point first (Playables), then the panel. */
    openWithAd: function (id) {
      var self = this;
      if (SE.Tutorial && SE.Tutorial.active && this.TUTORIAL_BLOCKED.indexOf(id) >= 0) return;
      SE.Ads.breakPoint('open:' + id, function () { self.open(id); });
    },

    /* Closing these menus returns to play: an interstitial point (Playables). Result, confirm
       (rewarded offers), boosts and Super Rewards are rewarded-related and stay out. */
    BREAK_ON_CLOSE: ['wardrobe', 'trails', 'inventory', 'index', 'pets', 'eggs', 'daily', 'wheel', 'settings', 'leaders'],

    /* Panels that must never pop up (or be opened) while the tutorial runs. */
    TUTORIAL_BLOCKED: ['wardrobe', 'daily', 'wheel', 'boosts', 'trails', 'super'],

    open: function (id, data) {
      if (this.current === id && this.modals.classList.contains('show')) return;
      if (SE.Tutorial && SE.Tutorial.active && (this.TUTORIAL_BLOCKED.indexOf(id) >= 0 || (id === 'confirm' && data && data.offerId))) return;
      if (id === 'super' && SE.rule('superRewards', true) === false) return;
      if (id === 'wheel' && SE.rule('wheel', true) === false) return;
      this.close(true);
      var p = this.panels[id];
      if (!p) return;
      this.current = id;
      var floating = id === 'eggs' || id === 'pets' || id === 'inventory';
      this.modals.classList.toggle('side-mode', id === 'eggs' || id === 'pets');
      this.modals.classList.toggle('inventory-mode', id === 'inventory');
      /* a full panel hides the HUD behind it instead of stacking on top of it */
      document.getElementById('ui').classList.toggle('modal-open', !floating);
      this.modals.classList.add('show');
      p.el.classList.add('show');
      this.render(id, data);
      this.game.onPanelOpen(id);
      SE.Audio.play('pop', { volume: 0.5 });
    },

    close: function (silent) {
      for (var k in this.panels) this.panels[k].el.classList.remove('show');
      this.modals.classList.remove('show');
      this.modals.classList.remove('side-mode', 'inventory-mode');
      var was = this.current;
      this.current = null;
      document.getElementById('ui').classList.remove('modal-open');
      if (was === 'wardrobe') SE.Shop.onClose();
      else if (was === 'daily') SE.Daily.onClose();
      else if (was === 'wheel') SE.Wheel.onClose();
      else if (was === 'super') SE.Super.onClose();
      if (!silent && was) this.game.onPanelClose(was);
      if (!silent && was && this.BREAK_ON_CLOSE.indexOf(was) >= 0) SE.Ads.breakPoint('close:' + was);
    },

    isOpen: function () { return !!this.current; },

    refresh: function () {
      if (this.current) this.render(this.current, this.lastData);
    },

    render: function (id, data) {
      this.lastData = data;
      var p = this.panels[id];
      if (!p) return;
      var title = p.head.querySelector('.panel-title');
      title.textContent = SE.t(p.opts.titleKey);
      p.foot.style.display = 'none';
      p.foot.innerHTML = '';
      p.body.innerHTML = '';
      switch (id) {
        case 'wardrobe': SE.Shop.render(p); break;
        case 'boosts': this.renderBoosts(p); break;
        case 'super': SE.Super.render(p); break;
        case 'inventory': this.renderInventory(p); break;
        case 'index': this.renderIndex(p); break;
        case 'pets': this.renderPets(p); break;
        case 'eggs': this.renderEggs(p); break;
        case 'trails': this.renderTrails(p); break;
        case 'settings': this.renderSettings(p); break;
        case 'leaders': this.renderLeaders(p); break;
        case 'result': this.renderResult(p, data); break;
        case 'daily': SE.Daily.render(p); break;
        case 'wheel': SE.Wheel.render(p); break;
        case 'confirm': this.renderConfirm(p, data); break;
      }
    },

    /* ---------------- Миниатюры ---------------- */
    petThumb: function (def, locked) {
      var key = 'model-' + def.id + (locked ? '-locked' : '');
      if (this.thumbCache[key]) return this.thumbCache[key];
      if (this.thumbUnavailable) return this.petThumbFallback(def, locked);
      var T = global.THREE;
      var group;
      try {
        if (!this.thumbRenderer) {
          this.thumbRenderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
          this.thumbRenderer.setSize(220, 180);
          this.thumbRenderer.setClearColor(0x000000, 0);
          this.thumbRenderer.outputEncoding = T.sRGBEncoding;
          this.thumbScene = new T.Scene();
          this.thumbSilhouetteMaterial = new T.MeshLambertMaterial({ color: '#181922' });
          this.thumbScene.add(new T.HemisphereLight(0xffffff, 0x7b87a0, 1.3));
          var sun = new T.DirectionalLight(0xffffff, .9);
          sun.position.set(-3, 5, 7);
          this.thumbScene.add(sun);
          this.thumbCamera = new T.PerspectiveCamera(32, 220 / 180, .1, 30);
          this.thumbCamera.position.set(3.3, 2.7, 4.2);
        }
        var renderDef = def;
        if (locked) {
          renderDef = Object.assign({}, def, { body: '#181922', accent: '#22232c', flags: def.flags.replace(/g/g, '') });
        }
        group = SE.Models.makePet(renderDef, 1).group;
        var bounds = new T.Box3().setFromObject(group);
        var center = bounds.getCenter(new T.Vector3());
        var size = bounds.getSize(new T.Vector3());
        var fit = 2.0 / Math.max(size.x, size.y, size.z);
        group.scale.multiplyScalar(fit);
        group.position.set(-center.x * fit, .8 - center.y * fit, -center.z * fit);
        this.thumbCamera.lookAt(0, .8, 0);
        this.thumbScene.add(group);
        this.thumbScene.overrideMaterial = locked ? this.thumbSilhouetteMaterial : null;
        this.thumbRenderer.render(this.thumbScene, this.thumbCamera);
        this.thumbCache[key] = this.thumbRenderer.domElement.toDataURL('image/png');
        return this.thumbCache[key];
      } catch (err) {
        this.thumbUnavailable = true;
        return this.petThumbFallback(def, locked);
      } finally {
        if (group) {
          this.thumbScene.overrideMaterial = null;
          this.thumbScene.remove(group);
          var seen = [];
          group.traverse(function (obj) {
            if (obj.geometry && seen.indexOf(obj.geometry) < 0) {
              seen.push(obj.geometry);
              /* GLB geometry is shared with the game scene: never dispose it. */
              if (!obj.geometry.userData || !obj.geometry.userData.shared) obj.geometry.dispose();
            }
          });
          this.thumbRenderer.renderLists.dispose();
        }
      }
    },

    petThumbFallback: function (def, locked) {
      var key = def.id + (locked ? 'L' : '');
      if (this.thumbCache[key]) return this.thumbCache[key];
      var c = U.canvas(120, 120);
      var g = c.getContext('2d');
      var body = locked ? '#2b2b33' : def.body;
      var accent = locked ? '#1a1a20' : def.accent;

      /* тень */
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.beginPath(); g.ellipse(60, 104, 34, 8, 0, 0, Math.PI * 2); g.fill();

      /* крылья */
      if (def.flags.indexOf('w') >= 0) {
        g.fillStyle = accent;
        g.beginPath(); g.ellipse(28, 58, 20, 12, -0.5, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(92, 58, 20, 12, 0.5, 0, Math.PI * 2); g.fill();
      }

      /* тело */
      g.fillStyle = body;
      if (def.shape === 'blob') {
        g.beginPath(); g.ellipse(60, 72, 34, 28, 0, 0, Math.PI * 2); g.fill();
      } else if (def.shape === 'bird') {
        g.beginPath(); g.ellipse(60, 74, 26, 24, 0, 0, Math.PI * 2); g.fill();
      } else if (def.shape === 'bug') {
        g.beginPath(); g.ellipse(60, 76, 32, 20, 0, 0, Math.PI * 2); g.fill();
      } else {
        U.roundRect(g, 30, 56, 60, 34, 14); g.fill();
        /* лапы */
        g.fillStyle = accent;
        [38, 54, 68, 84].forEach(function (x) { U.roundRect(g, x - 5, 84, 10, 16, 4); g.fill(); });
        g.fillStyle = body;
      }

      /* голова */
      var hx = def.shape === 'quad' || def.shape === 'dragon' ? 84 : 60;
      var hy = def.shape === 'quad' || def.shape === 'dragon' ? 46 : 42;
      g.fillStyle = body;
      g.beginPath(); g.arc(hx, hy, 22, 0, Math.PI * 2); g.fill();

      /* уши/рога */
      if (def.flags.indexOf('e') >= 0) {
        g.fillStyle = accent;
        U.roundRect(g, hx - 16, hy - 40, 10, 26, 5); g.fill();
        U.roundRect(g, hx + 6, hy - 40, 10, 26, 5); g.fill();
      }
      if (def.flags.indexOf('h') >= 0) {
        g.fillStyle = '#ffe27a';
        g.beginPath(); g.moveTo(hx, hy - 34); g.lineTo(hx - 7, hy - 14); g.lineTo(hx + 7, hy - 14); g.closePath(); g.fill();
      }
      if (def.flags.indexOf('c') >= 0) {
        g.fillStyle = '#ffd24a';
        g.beginPath();
        g.moveTo(hx - 16, hy - 22); g.lineTo(hx - 10, hy - 34); g.lineTo(hx - 3, hy - 24);
        g.lineTo(hx + 4, hy - 36); g.lineTo(hx + 10, hy - 24); g.lineTo(hx + 16, hy - 32);
        g.lineTo(hx + 16, hy - 18); g.lineTo(hx - 16, hy - 18);
        g.closePath(); g.fill();
      }

      /* морда */
      g.fillStyle = accent;
      g.beginPath(); g.ellipse(hx + 10, hy + 8, 10, 8, 0, 0, Math.PI * 2); g.fill();

      /* глаза */
      if (!locked) {
        g.fillStyle = '#14141a';
        g.beginPath(); g.arc(hx - 6, hy - 2, 4, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(hx + 8, hy - 3, 4, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(hx - 7, hy - 4, 1.6, 0, Math.PI * 2); g.fill();
      }

      var url = c.toDataURL();
      this.thumbCache[key] = url;
      return url;
    },

    eggThumb: function (biomeId) {
      return Icons.url('egg-' + SE.Pets.biome(biomeId).id);
    },

    eggPortrait: function (biomeId, rarity) {
      var b = SE.Pets.biome(biomeId);
      var r = SE.Pets.RARITIES[rarity] || SE.Pets.RARITIES[0];
      return '<span class="egg-portrait" style="--egg-rarity:' + r.color + '">' +
        Icons.html('egg-' + b.id, { label: SE.t(b.key) + ': ' + SE.t(r.key) }) + '</span>';
    },

    /* ---------------- Boosts (rewarded-ad offers) ---------------- */
    renderBoosts: function (p) {
      var self = this;
      var cats = [
        { key: 'shop.boosts', ids: ['x2income', 'speedBoost', 'x2hatch', 'magnet', 'invisible', 'luckyPet'] },
        { key: 'shop.eggs', ids: ['freeEgg', 'instantHatch', 'freePen'] },
        { key: 'shop.speed', ids: ['speedUp', 'freeTrail'] },
        { key: 'shop.money', ids: ['cashBonus', 'doubleSell', 'zoneDiscount'] }
      ];
      var sup = U.el('button', 'btn gold wide sr-entry', Icons.html('chest') + '<span>' + SE.t('ui.super') + '</span>');
      sup.addEventListener('click', function () { SE.Audio.play('click'); self.open('super'); });
      p.body.appendChild(sup);
      if (!SE.Ads.available()) {
        var off = U.el('div', 'ad-notice stroke');
        off.textContent = SE.Ads.explain();
        p.body.appendChild(off);
      }

      var featured = U.el('div', 'shop-feature');
      featured.innerHTML = '<div class="feature-egg">' + Icons.html('egg') + '<span class="badge-new">' + SE.t('ui.new') + '</span></div>' +
        '<div class="feature-content"><div class="feature-title stroke">' + SE.Ads.title('freeEgg') + '</div>' +
        '<div class="feature-description">' + SE.Ads.desc('freeEgg') + '</div></div>';
      var preview = U.el('div', 'feature-pets');
      [0, 3, 6, 8, 10, 12].forEach(function (n) {
        var def = SE.Pets.byBiome('forest')[n];
        var rarity = SE.Pets.RARITIES[def.rarity];
        var sample = U.el('div', 'feature-pet r-' + rarity.id);
        sample.innerHTML = '<img alt="' + SE.Pets.name(def) + '" src="' + self.petThumb(def) + '"><span>' + SE.t(rarity.key) + '</span>';
        preview.appendChild(sample);
      });
      featured.querySelector('.feature-content').appendChild(preview);
      var freeEgg = this.offerCard('freeEgg');
      freeEgg.classList.add('feature-action');
      featured.querySelector('.feature-content').appendChild(freeEgg);
      p.body.appendChild(featured);

      cats.forEach(function (cat) {
        var title = U.el('div', 'section-title stroke');
        title.textContent = SE.t(cat.key);
        p.body.appendChild(title);
        var grid = U.el('div', 'grid wide shop-grid');
        cat.ids.forEach(function (id) {
          if (id !== 'freeEgg') grid.appendChild(self.offerCard(id));
        });
        p.body.appendChild(grid);
      });
    },

    offerCard: function (id, ctx) {
      var self = this;
      var o = SE.Ads.get(id);
      var card = U.el('div', 'offer offer-' + id);
      if (id === 'offline' && this.game.offlineEarned <= 0) {
        card.style.display = 'none';
        return card;
      }
      var arg = '';
      if (id === 'cashBonus') arg = U.money(this.game.cashBonusAmount());
      card.innerHTML =
        '<div class="oic">' + Icons.html(o.icon) + '</div>' +
        '<div class="otext">' +
        '<div class="otitle">' + SE.Ads.title(id) + '<span class="ad-badge">' + SE.t('ad.badge') + '</span></div>' +
        '<div class="odesc">' + SE.Ads.desc(id, arg) + '</div>' +
        '</div>';
      if (!SE.Ads.available()) {
        card.querySelector('.odesc').insertAdjacentHTML('afterend', '<div class="ad-note">' + SE.Ads.explain() + '</div>');
      }
      var btn = SE.Ads.button(id, {
        cls: 'btn ad',
        html: Icons.html('watch-video') + '<span>' + SE.t('btn.watch') + '</span>',
        onClick: function () {
          if (id === 'offline' && self.game.offlineEarned <= 0) { self.refresh(); return; }
          SE.Audio.play('click');
          SE.Ads.claim(id, ctx || {}, function () {
            self.refresh();
            self.updateHUD();
          });
        }
      });
      card.appendChild(btn);
      return card;
    },

    /* ---------------- Инвентарь ---------------- */
    renderInventory: function (p) {
      var self = this;
      var s = SE.State.data;
      var title = p.head.querySelector('.panel-title');
      title.textContent = SE.t('ui.inventory') + ' (' + s.inventory.length + ')';

      if (!s.inventory.length) {
        var empty = U.el('div', 'empty-state stroke');
        empty.textContent = SE.t('ui.emptyInv');
        p.body.appendChild(empty);
        return;
      }

      var grid = U.el('div', 'grid');
      var sorted = s.inventory.slice().sort(function (a, b) {
        var pa = SE.Pets.get(a.petId), pb = SE.Pets.get(b.petId);
        return (pb ? pb.income : 0) - (pa ? pa.income : 0);
      });

      sorted.forEach(function (item) {
        var def = SE.Pets.get(item.petId);
        if (!def) return;
        var r = SE.Pets.RARITIES[def.rarity];
        var card = U.el('div', 'card' + (self.selectedPet === item.uid ? ' selected' : ''));
        var eq = SE.State.isEquipped(item.uid);
        card.innerHTML =
          '<div class="tag" style="background:' + r.color + '">' + SE.t(r.key) + '</div>' +
          '<div class="thumb r-' + r.id + '"><img src="' + self.petThumb(def) + '" style="width:100%;height:100%;object-fit:contain"></div>' +
          '<div class="name">' + SE.Pets.name(def) + '</div>' +
          '<div class="sub">' + U.money(def.income) + SE.t('ui.perSec') + '</div>' +
          '<div class="sub">' + SE.t('ui.value') + ': ' + U.money(def.value) + '</div>';

        var row = U.el('div', 'row');
        var eqBtn = U.el('button', 'btn ' + (eq ? 'grey' : 'blue'));
        eqBtn.style.fontSize = '.82em';
        eqBtn.textContent = eq ? SE.t('btn.unequip') : SE.t('btn.equip');
        eqBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          SE.Audio.play('equip', { volume: 0.5 });
          if (eq) SE.State.unequip(item.uid);
          else if (!SE.State.equip(item.uid)) self.toast(SE.t('msg.slotsFull'), 'error');
          self.game.refreshFollowers();
          self.refresh();
          self.updateHUD();
        });
        var sellBtn = U.el('button', 'btn red');
        sellBtn.style.fontSize = '.82em';
        sellBtn.textContent = SE.t('btn.sell');
        sellBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          self.game.sellPets([item.uid]);
          self.refresh();
        });
        row.appendChild(eqBtn);
        row.appendChild(sellBtn);
        card.appendChild(row);

        card.addEventListener('click', function () {
          self.selectedPet = item.uid;
          self.refresh();
        });
        grid.appendChild(card);
      });
      p.body.appendChild(grid);

      p.foot.style.display = 'flex';
      var best = U.el('button', 'btn');
      best.textContent = SE.t('btn.equipBest');
      best.addEventListener('click', function () {
        SE.State.equipBest();
        self.game.refreshFollowers();
        SE.Audio.play('equip');
        self.refresh(); self.updateHUD();
      });
      var sellAll = U.el('button', 'btn red');
      sellAll.textContent = SE.t('btn.sellAll');
      sellAll.addEventListener('click', function () {
        var ids = SE.State.data.inventory
          .filter(function (i) { return !SE.State.isEquipped(i.uid); })
          .map(function (i) { return i.uid; });
        if (!ids.length) { self.toast(SE.t('ui.empty'), 'error'); return; }
        self.game.sellPets(ids);
        self.refresh();
      });
      p.foot.appendChild(best);
      p.foot.appendChild(sellAll);
    },

    /* ---------------- Индекс ---------------- */
    renderIndex: function (p) {
      var self = this;
      var s = SE.State.data;
      var unlocked = Object.keys(s.index).length;
      if (unlocked === SE.Pets.total()) {
        var completion = U.el('div', 'section-title stroke');
        completion.textContent = SE.t('game.complete', SE.Pets.total());
        p.body.appendChild(completion);
      }

      var bar = U.el('div', 'index-total stroke');
      bar.textContent = SE.t('ui.opened', unlocked, SE.Pets.total());
      p.foot.style.display = 'flex';
      p.foot.appendChild(bar);

      SE.Pets.BIOMES.forEach(function (b) {
        var section = U.el('section', 'index-section');
        var t = U.el('div', 'biome-banner biome-' + b.id);
        t.innerHTML = '<div class="biome-landscape"><i></i><i></i><i></i></div><span class="stroke">' + SE.t(b.key) + '</span>';
        t.style.setProperty('--biome-color', b.color);
        section.appendChild(t);
        var grid = U.el('div', 'index-grid');
        SE.Pets.byBiome(b.id).forEach(function (def) {
          var owned = !!s.index[def.id];
          var r = SE.Pets.RARITIES[def.rarity];
          var card = U.el('div', 'card index-card r-' + r.id + (owned ? ' discovered' : ' undiscovered'));
          card.innerHTML =
            '<div class="name stroke">' + (owned ? SE.Pets.name(def) : SE.t('ui.unknown')) + '</div>' +
            '<div class="thumb"><img alt="' + (owned ? SE.Pets.name(def) : SE.t('ui.unknown')) + '" src="' + self.petThumb(def, !owned) + '"></div>' +
            (owned ? '<div class="sub stroke">' + U.money(def.income) + SE.t('ui.perSec') + ' · x' + s.index[def.id] + '</div>' : '');
          grid.appendChild(card);
        });
        section.appendChild(grid);
        p.body.appendChild(section);
      });
    },

    /* ---------------- Питомцы (экипировка) ---------------- */
    renderPets: function (p) {
      var self = this;
      var s = SE.State.data;
      p.head.querySelector('.panel-title').textContent =
        SE.t('ui.petsSlots', s.equipped.length, SE.State.MAX_EQUIP);

      var grid = U.el('div', 'grid');
      for (var i = 0; i < SE.State.MAX_EQUIP; i++) {
        var uid = s.equipped[i];
        if (!uid) continue;
        var card = U.el('div', 'card');
        if (uid) {
          var item = SE.State.getPetItem(uid);
          var def = item && SE.Pets.get(item.petId);
          if (def) {
            var r = SE.Pets.RARITIES[def.rarity];
            card.innerHTML =
              '<div class="tag" style="background:' + r.color + '">' + SE.t(r.key) + '</div>' +
              '<div class="thumb r-' + r.id + '"><img src="' + this.petThumb(def) +
              '" style="width:100%;height:100%;object-fit:contain"></div>' +
              '<div class="name">' + SE.Pets.name(def) + '</div>' +
              '<div class="sub">' + U.money(def.income) + SE.t('ui.perSec') + '</div>';
            var btn = U.el('button', 'btn grey');
            btn.style.fontSize = '.82em';
            btn.textContent = SE.t('btn.unequip');
            (function (id) {
              btn.addEventListener('click', function () {
                SE.State.unequip(id);
                self.game.refreshFollowers();
                SE.Audio.play('equip', { volume: .5 });
                self.refresh(); self.updateHUD();
              });
            })(uid);
            card.appendChild(btn);
          }
        }
        grid.appendChild(card);
      }
      p.body.appendChild(grid);
      if (!s.equipped.length) {
        var empty = U.el('div', 'empty-state stroke');
        empty.textContent = SE.t('ui.emptyPets');
        p.body.appendChild(empty);
      }

      p.foot.style.display = 'flex';
      var best = U.el('button', 'btn');
      best.textContent = SE.t('btn.equipBest');
      best.addEventListener('click', function () {
        SE.State.equipBest();
        self.game.refreshFollowers();
        SE.Audio.play('equip');
        self.refresh(); self.updateHUD();
      });
      p.foot.appendChild(best);
      var inv = U.el('button', 'btn blue');
      inv.textContent = SE.t('ui.inventory');
      inv.addEventListener('click', function () { self.open('inventory'); });
      p.foot.appendChild(inv);
    },

    /* ---------------- Яйца в загонах ---------------- */
    renderEggs: function (p) {
      var self = this;
      var s = SE.State.data;
      var any = false;

      var grid = U.el('div', 'grid');
      s.pens.forEach(function (pen, idx) {
        if (!pen.egg && !pen.pet) return;
        var card = U.el('div', 'card');
        if (pen.pet) {
          any = true;
          var def = SE.Pets.get(pen.pet);
          var r = SE.Pets.RARITIES[def.rarity];
          card.innerHTML =
            '<div class="tag" style="background:' + r.color + '">' + SE.t('world.ready') + '</div>' +
            '<div class="thumb r-' + r.id + '"><img src="' + self.petThumb(def) +
            '" style="width:100%;height:100%;object-fit:contain"></div>' +
            '<div class="name">' + SE.Pets.name(def) + '</div>';
          var c = U.el('button', 'btn');
          c.style.fontSize = '.85em';
          c.textContent = SE.t('btn.claim');
          c.addEventListener('click', function () { self.game.collectPen(idx); self.refresh(); });
          card.appendChild(c);
        } else if (pen.egg) {
          any = true;
          var left = Math.max(0, (pen.hatchAt - Date.now()) / 1000);
          var prog = 1 - left / pen.duration;
          var rr = SE.Pets.RARITIES[pen.egg.rarity];
          card.innerHTML =
            '<div class="tag" style="background:' + rr.color + '">' + SE.t(rr.key) + '</div>' +
            '<div class="thumb" style="background:#e8d9bd">' + self.eggPortrait(pen.egg.biome, pen.egg.rarity) + '</div>' +
            '<div class="name">' + SE.t('world.growing') + '</div>' +
            '<div class="sub">' + U.time(left) + '</div>' +
            '<div class="bar"><i style="width:' + Math.round(prog * 100) + '%"></i></div>';
          var ad = U.el('button', 'btn ad');
          ad.style.fontSize = '.78em';
          ad.innerHTML = Icons.html('watch-video') + '<span>' + SE.t('btn.hatch') + '</span>';
          ad.addEventListener('click', function () {
            SE.Ads.claim('instantHatch', { pen: idx }, function () { self.refresh(); self.updateHUD(); });
          });
          card.appendChild(ad);
        }
        grid.appendChild(card);
      });
      p.body.appendChild(grid);

      if (!any) {
        var e = U.el('div', 'empty-state stroke');
        e.textContent = SE.t('ui.emptyEggs');
        p.body.insertBefore(e, p.body.firstChild);
      }

      p.foot.style.display = 'none';
    },

    /* ---------------- Трейлы ---------------- */
    renderTrails: function (p) {
      var self = this;
      var s = SE.State.data;
      var grid = U.el('div', 'trail-grid');

      SE.State.TRAILS.forEach(function (tr) {
        if (tr.id === 'none') return;
        var owned = SE.State.ownsTrail(tr.id);
        var active = s.trail === tr.id;
        var card = U.el('div', 'card trail-card');
        card.style.setProperty('--trail-color', tr.color);
        card.innerHTML =
          '<div class="name stroke">' + SE.t(tr.key) + '</div>' +
          '<div class="trail-preview">' + Icons.html('trail-' + tr.id, { label: SE.t(tr.key) }) + '</div>' +
          '<div class="sub trail-mult stroke">' + SE.t('trail.speedX', tr.mult) + '</div>';
        var btn = U.el('button', 'btn ' + (active ? 'grey' : (owned ? 'blue' : 'gold')));
        btn.style.fontSize = '.85em';
        btn.textContent = active ? SE.t('btn.equipped') : (owned ? SE.t('btn.equip') : U.money(tr.price));
        btn.addEventListener('click', function () {
          self.game.buyTrail(tr.id);
          self.refresh(); self.updateHUD();
        });
        card.appendChild(btn);
        grid.appendChild(card);
      });
      p.body.appendChild(grid);

      p.foot.style.display = 'flex';
      p.foot.appendChild(this.offerCard('freeTrail'));
    },

    /* ---------------- Настройки ---------------- */
    /* ---------------- Рекорды (лидерборд платформы, техническое имя Score) ---------------- */
    renderLeaders: function (p) {
      var self = this;
      var loading = U.el('div', 'section-title stroke');
      loading.textContent = SE.t('loading.title');
      p.body.appendChild(loading);
      if (SE.Platform.submitScore) SE.Platform.submitScore(SE.State.computeScore());
      function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
      function row(e) {
        var r = U.el('div', 'lb-row' + (e.isUser ? ' me' : ''));
        var name = e.player && e.player.publicName ? e.player.publicName : SE.t('lead.anon');
        var ava = e.player && e.player.avatar
          ? '<img class="lb-ava" src="' + esc(e.player.avatar) + '" alt="" draggable="false">'
          : '<span class="lb-ava"></span>';
        r.innerHTML = '<div class="lb-rank stroke">' + (e.rank || '–') + '</div>' + ava +
          '<div class="lb-name stroke">' + esc(name) + '</div><div class="lb-score">' + U.shortNum(e.score) + '</div>';
        return r;
      }
      (SE.Platform.getLeaderboard ? SE.Platform.getLeaderboard(10) : Promise.resolve(null)).then(function (res) {
        if (!p.body.isConnected) return;
        loading.style.display = 'none';
        var list = res && res.entries ? res.entries : [];
        if (!list.length) {
          var empty = U.el('div', 'section-title stroke');
          empty.textContent = SE.t('lead.empty');
          p.body.appendChild(empty);
        }
        list.forEach(function (e) { p.body.appendChild(row(e)); });
        if (!SE.Platform.authorized && SE.Platform.canAuth && SE.Platform.canAuth()) self.addLoginRow(p);
      }, function () {
        loading.style.display = 'none';
        var err = U.el('div', 'section-title stroke');
        err.textContent = SE.t('lead.empty');
        p.body.appendChild(err);
      });
    },

    addLoginRow: function (p) {
      var self = this;
      var note = U.el('div', 'section-title stroke lb-note');
      note.textContent = SE.t('lead.needLogin');
      p.body.appendChild(note);
      var b = U.el('button', 'btn blue wide');
      b.textContent = SE.t('lead.login');
      b.addEventListener('click', function () {
        SE.Audio.play('click', { volume: 0.5 });
        SE.Platform.auth().then(function (ok) { if (ok && self.current === 'leaders') self.refresh(); });
      });
      p.body.appendChild(b);
    },

    renderSettings: function (p) {
      var self = this;
      var s = SE.State.data.settings;

      var shortcuts = U.el('div', 'settings-shortcuts');
      [['trails', 'ui.trails', 'rainbow']].forEach(function (entry) {
        var button = U.el('button', 'btn blue');
        button.innerHTML = Icons.html(entry[2]) + '<span>' + SE.t(entry[1]) + '</span>';
        button.addEventListener('click', function () { self.open(entry[0]); });
        shortcuts.appendChild(button);
      });
      var help = U.el('button', 'btn gold');
      help.innerHTML = Icons.html('question') + '<span>' + SE.t('ui.howToPlay') + '</span>';
      help.addEventListener('click', function () {
        SE.Ads.breakPoint('settings', function () { self.close(true); self.game.onPanelClose('settings'); SE.Tutorial.start(true); });
      });
      shortcuts.insertBefore(help, shortcuts.firstChild);
      p.body.appendChild(shortcuts);
      /* every button and switch in the settings is an interstitial point (Playables) */
      if (!p.body.breakHook) {
        p.body.breakHook = true;
        p.body.addEventListener('click', function (e) {
          if (e.target.closest && e.target.closest('button, .switch')) SE.Ads.breakPoint('settings');
        });
      }

      function row(labelKey, control) {
        var r = U.el('div', 'setting-row');
        var l = U.el('div', 'stroke');
        l.textContent = SE.t(labelKey);
        r.appendChild(l);
        r.appendChild(control);
        p.body.appendChild(r);
        return r;
      }

      function toggle(value, onChange) {
        var sw = U.el('div', 'switch' + (value ? ' on' : ''), '<div class="dot"></div>');
        sw.addEventListener('click', function () {
          value = !value;
          sw.classList.toggle('on', value);
          SE.Audio.play('toggle', { volume: 0.6 });
          onChange(value);
        });
        return sw;
      }

      row('ui.sound', toggle(s.sfx, function (v) { s.sfx = v; SE.Audio.setSfx(v); SE.State.save(); }));
      row('ui.music', toggle(s.music, function (v) { s.music = v; SE.Audio.setMusic(v); SE.State.save(); }));
      row('ui.shadows', toggle(s.shadows, function (v) { s.shadows = v; self.game.applyQuality(); SE.State.save(); }));

      var seg = U.el('div', 'seg');
      [['low', 'ui.qualityLow'], ['medium', 'ui.qualityMed'], ['high', 'ui.qualityHigh']].forEach(function (q) {
        var b = U.el('button', 'btn blue' + (s.quality === q[0] ? ' active' : ''));
        b.textContent = SE.t(q[1]);
        b.addEventListener('click', function () {
          s.quality = q[0];
          self.game.applyQuality();
          SE.State.save();
          self.refresh();
        });
        seg.appendChild(b);
      });
      row('ui.quality', seg);


      var info = U.el('div', 'section-title stroke');
      info.style.fontSize = '.95em';
      info.textContent = SE.Platform.isMobile ? SE.t('ui.creditsMobile') : SE.t('ui.credits');
      p.body.appendChild(info);

      var reset = U.el('button', 'btn red wide');
      reset.textContent = SE.t('ui.reset');
      reset.addEventListener('click', function () {
        self.open('confirm', {
          text: SE.t('ui.resetConfirm'),
          onYes: function () { self.game.resetProgress(); }
        });
      });
      p.body.appendChild(reset);
    },

    /* ---------------- Результат забега ---------------- */
    renderResult: function (p, data) {
      var self = this;
      data = data || {};
      var win = !!data.win;
      p.head.classList.toggle('green', win);
      p.head.classList.toggle('gold', !win);
      p.head.querySelector('.panel-title').textContent = SE.t(win ? 'res.winTitle' : 'res.loseTitle');

      var big = U.el('div', 'result-big stroke');
      big.textContent = win ? SE.t('msg.escaped') : SE.t('msg.caught');
      p.body.appendChild(big);

      var eggRow = U.el('div', 'result-egg');
      if (data.egg) {
        eggRow.innerHTML = this.eggPortrait(data.egg.biome, data.egg.rarity);
      } else {
        eggRow.innerHTML = Icons.html(win ? 'egg' : 'smoke-puff');
      }
      p.body.appendChild(eggRow);

      var sub = U.el('div', 'result-sub stroke');
      if (win) {
        sub.textContent = SE.t('res.reward') + ': ' + U.money(data.reward || 0) + ' · ' +
          SE.t('res.streak', SE.State.data.stats.wins);
        if (data.gems) {
          var gemRow = U.el('div', 'result-gems stroke', Icons.html('gem') + '<span>+' + data.gems + '</span>');
          gemRow.setAttribute('aria-label', SE.t('res.gems') + ' +' + data.gems);
          p.body.appendChild(gemRow);
        }
      } else {
        sub.textContent = SE.t('res.eggLost');
      }
      p.body.appendChild(sub);

      /* Награды за рекламу по ситуации. Правила платформы: «продолжить за рекламу» не на каждом
         проигрыше (reviveMinRarity), число предложений на экране (resultOffers). */
      var offers = [];
      var keepPlaying = !win && (!data.lostEgg || data.lostEgg.rarity >= SE.rule('reviveMinRarity', 0));
      if (win && data.egg) {
        offers.push(['upgradeEgg', { egg: data.egg }]);
        offers.push(['x2income']);
      }
      if (keepPlaying) {
        offers.push(['escape', { egg: data.lostEgg }]);
        offers.push(['revive', { egg: data.lostEgg }]);
      }
      offers.push(['cashBonus']);
      var self2 = this;
      var btn = U.el('button', 'btn big ' + (win ? '' : 'blue'));
      var continueFirst = SE.rule('continueFirst', false);
      if (continueFirst) {
        /* Poki: the standard option is above the rewarded ones and at least as large */
        var holder = U.el('div', 'result-continue');
        holder.appendChild(btn);
        p.body.appendChild(holder);
      }
      offers.slice(0, SE.rule('resultOffers', 99)).forEach(function (o) { p.body.appendChild(self2.offerCard(o[0], o[1])); });

      p.foot.style.display = continueFirst ? 'none' : 'flex';
      btn.textContent = SE.t(win ? 'btn.next' : 'btn.retry');
      btn.addEventListener('click', function () {
        SE.Audio.play('click');
        if (data.continued) return;
        data.continued = true;
        btn.disabled = true;
        /* After every second round (a delivery or being caught) the interstitial is requested here.
           A "keep playing" offer and a midgame ad never share one transition (CrazyGames rule). */
        if (keepPlaying && SE.rule('midgameAfterRevive', true) === false) { self.close(); return; }
        SE.Ads.next(function () { self.close(); });
      });
      if (!continueFirst) p.foot.appendChild(btn);
    },

    /* ---------------- Подтверждение ---------------- */
    renderConfirm: function (p, data) {
      var self = this;
      data = data || {};
      p.head.querySelector('.panel-title').textContent = data.title || SE.t('btn.yes');
      var t = U.el('div', 'result-sub stroke');
      t.textContent = data.text || '';
      p.body.appendChild(t);

      if (data.offerId) p.body.appendChild(this.offerCard(data.offerId, data.ctx));

      p.foot.style.display = 'flex';
      var yes = U.el('button', 'btn');
      yes.textContent = data.yesText || SE.t('btn.yes');
      yes.addEventListener('click', function () {
        self.close();
        if (data.onYes) data.onYes();
      });
      var no = U.el('button', 'btn grey');
      no.textContent = SE.t('btn.no');
      no.addEventListener('click', function () { self.close(); });
      p.foot.appendChild(yes);
      p.foot.appendChild(no);
    },

    onLangChange: function () {
      SE.I18N.apply();
      Icons.refreshLabels();
      SE.World.refreshLabels();
      if (SE.Bots && SE.Bots.relabel) SE.Bots.relabel();
      if (SE.World.zones) {
        for (var i = 0; i < SE.World.zones.length; i++) {
          SE.World.setZoneUnlocked(i, SE.State.zoneUnlocked(i));
        }
      }
      this.updateHUD();
      if (this.current) this.render(this.current, this.lastData);
    }
  };

  SE.UI = UI;
})(window);
