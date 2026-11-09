/* =========================================================
   Игровой цикл, логика и связка всех модулей
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U, T = global.THREE, M = SE.Models;

  /* Platform ad rules (SE.Platform.rules); missing values keep the default behaviour. */
  function rule(name, def) {
    var r = SE.Platform && SE.Platform.rules;
    return r && r[name] !== undefined ? r[name] : def;
  }
  SE.rule = rule;

  var Game = {
    renderer: null,
    scene: null,
    camera: null,
    clock: null,
    time: 0,
    paused: false,
    pauseReasons: {},
    started: false,
    carrying: null,
    carryZone: null,
    slowMode: false,
    boosts: SE.Boosts,
    coins: [],
    coinTimer: 0,
    saveTimer: 0,
    scoreTimer: 0,
    lastIncomeTick: 0,
    badgeTimer: 0,
    nearest: null,
    offlineEarned: 0,

    /* ================= Загрузка ================= */
    boot: async function () {
      var self = this;
      var bar = document.querySelector('#loadBar > i');
      var tip = document.getElementById('loadTip');
      tip.textContent = SE.t('loading.title');
      SE.Audio.init();
      SE.Audio.prepareMusic();
      SE.Platform.onPause = function () { self.setPaused(true, 'platform'); };
      SE.Platform.onResume = function () { self.setPaused(false, 'platform'); };
      try {
        bar.style.width = '5%';
        await SE.Platform.init();
        /* platform-specific styling hooks (e.g. html.platform-poki) */
        if (SE.Platform.id) document.documentElement.classList.add('platform-' + SE.Platform.id);
        await SE.Tasks.active();
        SE.I18N.setLang(SE.Platform.lang);
        document.getElementById('loadTitle').textContent = SE.t('game.title');
        bar.style.width = '20%';
        await SE.State.load();
        await SE.Tasks.active();
        bar.style.width = '35%';
        await Promise.all([
          SE.Audio.loadAll(), SE.Icons.preload(6000), document.fonts ? document.fonts.ready : Promise.resolve(),
          SE.Assets.load(function (k) { bar.style.width = Math.round(35 + k * 45) + '%'; })
        ]);
        await SE.Tasks.active();
        bar.style.width = '85%';
        self.setup();
        bar.style.width = '100%';
        self.start();
        document.getElementById('loading').style.display = 'none';
        self.renderer.render(self.scene, self.camera);
        SE.Platform.gameReady();
        SE.Audio.unlock();
      } catch (err) {
        await SE.Tasks.active();
        console.error('Game initialization failed:', err);
        tip.textContent = SE.t('loading.error');
        var retry = document.getElementById('btnRetry');
        retry.textContent = SE.t('btn.retry');
        retry.style.display = '';
        retry.onclick = function () { global.location.reload(); };
      }
    },

    /* ================= Инициализация сцены ================= */
    setup: function () {
      var self = this;
      var canvas = document.getElementById('scene');
      if (T.ColorManagement) T.ColorManagement.enabled = true;

      this.renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
      this.renderer.setSize(Math.max(1, global.innerWidth), Math.max(1, global.innerHeight));
      if (T.sRGBEncoding !== undefined) this.renderer.outputEncoding = T.sRGBEncoding;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;

      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(58, Math.max(1, global.innerWidth) / Math.max(1, global.innerHeight), 0.5, 900);
      this.clock = new T.Clock();

      /* Свет */
      var hemi = new T.HemisphereLight('#ffffff', '#819370', 0.72);
      this.scene.add(hemi);
      var amb = new T.AmbientLight('#ffffff', 0.14);
      this.scene.add(amb);
      var sun = new T.DirectionalLight('#fff9ed', 0.7);
      sun.position.set(60, 120, 40);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 10;
      sun.shadow.camera.far = 420;
      sun.shadow.camera.left = -110;
      sun.shadow.camera.right = 110;
      sun.shadow.camera.top = 110;
      sun.shadow.camera.bottom = -110;
      sun.shadow.bias = -0.0012;
      this.scene.add(sun);
      this.scene.add(sun.target);
      this.sun = sun;

      /* Мир */
      SE.World.build(this.scene, SE.State.data);
      SE.FX.init(this.scene, this.camera);
      SE.Player.init(this.scene);
      SE.Guards.init(this.scene, SE.World);
      /* equipped outfit, hat, face, back and aura */
      SE.Shop.applyEquipped();
      /* biome ambience: one register per island */
      for (var zi = 0; zi < (SE.World.zones || []).length; zi++) {
        var zn = SE.World.zones[zi];
        SE.FX.ambient(zn.id, { x: zn.x, y: 0, z: zn.z }, zn.half);
      }

      /* Монеты */
      this.initCoins();

      /* Интерфейс */
      SE.UI.init(this);
      SE.I18N.apply();
      /* Playables keeps the on-screen controls available on every device. */
      SE.UI.setMobile(true);
      SE.Input.init(canvas, SE.UI);
      /* Key hints still follow the input that was used last. */
      SE.Platform.onInputMode = function () {
        SE.Tutorial.render(true);
      };

      /* Состояние мира по сохранению */
      for (var i = 0; i < SE.Pets.BIOMES.length; i++) {
        SE.World.setZoneUnlocked(i, SE.State.zoneUnlocked(i));
      }
      SE.Bots.init(this.scene, SE.World);
      this.refreshPens();
      this.refreshFollowers();
      SE.Player.setSpeedStat(SE.State.data.speed);
      this.applyQuality();

      /* События окна */
      global.addEventListener('resize', function () { self.onResize(); });

      /* Ручная пауза / закрытие панелей по Esc */
      global.addEventListener('keydown', function (e) {
        if (e.code !== 'Escape') return;
        if (SE.UI.isOpen()) { SE.UI.close(); return; }
        if (self.pauseReasons.manual) self.resumeManual(); else self.setPaused(true, 'manual');
      });

      /* Правая кнопка мыши — без системного меню */
      global.addEventListener('contextmenu', function (e) { e.preventDefault(); return false; });
      document.addEventListener('gesturestart', function (e) { e.preventDefault(); });


      this.onResize();
      SE.Player.update(0, this, this.camera);
      this.animate();
    },

    start: function () {
      if (this.started) return;
      this.started = true;
      this.reportProgress();
      if (!this.paused) SE.Platform.gameplayStart();
      SE.Audio.setSfx(SE.State.data.settings.sfx);
      SE.Audio.setMusic(SE.State.data.settings.music);
      SE.Audio.playMusic('theme');
      SE.UI.updateHUD();
      this.checkOffline();
      if (!SE.State.data.tutorialDone) SE.Tutorial.start(false);
      else SE.Daily.maybeOffer(false);
    },

    onResize: function () {
      var W = Math.max(1, global.innerWidth), h = Math.max(1, global.innerHeight);
      if (SE.Platform.paused) { this.needsResize = true; return; }
      /* поле не шире 2:1 — на сверхшироком окне по бокам поля, а не полоса */
      var w = Math.min(W, Math.round(h * 2)), off = Math.round((W - w) / 2);
      this.renderer.setSize(w, h);
      var cv = this.renderer.domElement;
      cv.style.left = off + 'px'; cv.style.right = 'auto';
      var ui = document.getElementById('ui');
      if (ui) {
        var sa = this.safeInsets();
        ui.style.left = (off + sa.l) + 'px'; ui.style.right = 'auto'; ui.style.width = Math.max(1, w - sa.l - sa.r) + 'px';
        ui.style.top = sa.t + 'px'; ui.style.bottom = sa.b + 'px';
      }
      var q = SE.State.data.settings.quality;
      var maxRatio = q === 'low' ? 1 : (q === 'medium' ? 1.4 : 2);
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, maxRatio));
      this.camera.aspect = w / h;
      /* на узких экранах отодвигаем камеру, чтобы видеть больше */
      this.camera.fov = w / h < 0.85 ? 68 : 58;
      this.camera.updateProjectionMatrix();
      SE.UI.setMobile(true);
    },

    /* Leaving the pause menu. Poki: stop → commercialBreak → start (the platform decides if an ad plays). */
    resumeManual: function () {
      var self = this;
      if (!this.pauseReasons.manual || this.resuming) return;
      if (!rule('breakOnResume', false) || (SE.Tutorial && SE.Tutorial.active)) { this.setPaused(false, 'manual'); return; }
      this.resuming = true;
      SE.Platform.showInterstitial(function () { self.resuming = false; self.setPaused(false, 'manual'); });
    },

    /* Collection share for the platform (CrazyGames reportGameCompletedPercentage). */
    reportProgress: function () {
      if (!SE.Platform.reportProgress || !SE.State.data) return;
      SE.Platform.reportProgress(Object.keys(SE.State.data.index || {}).length / SE.Pets.total() * 100);
    },

    /* Safe areas (notches, CrazyGames app, iOS home bar) in px — the HUD stays inside them. */
    safeInsets: function () {
      if (!this.safeProbe) {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
          'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
        document.body.appendChild(d);
        this.safeProbe = d;
      }
      var cs = getComputedStyle(this.safeProbe);
      return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    },

    applyQuality: function () {
      var s = SE.State.data.settings;
      this.renderer.shadowMap.enabled = !!s.shadows && s.quality !== 'low';
      this.sun.castShadow = this.renderer.shadowMap.enabled;
      this.sun.shadow.mapSize.set(s.quality === 'high' ? 2048 : 1024, s.quality === 'high' ? 2048 : 1024);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      var maxRatio = s.quality === 'low' ? 1 : (s.quality === 'medium' ? 1.4 : 2);
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, maxRatio));
      if (this.scene.fog) this.scene.fog.far = s.quality === 'low' ? 420 : 620;
      SE.FX.setQuality(s.quality);
      if (SE.World.setQuality) SE.World.setQuality(s.quality);
    },

    /* ================= Пауза ================= */
    setPaused: function (on, reason) {
      reason = reason || 'manual';
      if (reason === 'platform') {
        if (on && this.frameId) { cancelAnimationFrame(this.frameId); this.frameId = null; }
        if (!on && this.renderer) {
          if (this.needsResize) { this.needsResize = false; this.onResize(); }
          this.clock.getDelta();
          if (!this.frameId) this.frameId = requestAnimationFrame(this.animate.bind(this));
        }
      }
      if (on) this.pauseReasons[reason] = true;
      else delete this.pauseReasons[reason];

      var r = this.pauseReasons;
      this.paused = Object.keys(r).length > 0;
      if (this.paused && SE.Input.reset) SE.Input.reset();

      /* Звук глушим, когда игрок вне вкладки/окна, во время рекламы и на ручной паузе.
         Открытая панель интерфейса звук не выключает. */
      var mute = !!(r.platform || r.ad || r.manual);
      if (mute) SE.Audio.pause(); else SE.Audio.resume();

      /* Оверлей паузы — только для ручной паузы (Esc) */
      document.getElementById('pause').classList.toggle('show', !!r.manual);

      if (this.paused) SE.Platform.gameplayStop();
      else if (this.started) SE.Platform.gameplayStart();
    },

    /* ================= Основной цикл ================= */
    animate: function () {
      var self = this;
      this.frameId = null;
      if (SE.Platform.paused) return;
      this.frameId = requestAnimationFrame(function () { self.animate(); });

      var dt = Math.min(0.05, this.clock.getDelta());
      if (!this.paused && this.started) {
        this.time += dt;
        this.update(dt);
      }
      this.renderer.render(this.scene, this.camera);
    },

    update: function (dt) {
      SE.World.update(dt, this.time, SE.Player.pos);
      SE.Player.update(dt, this, this.camera);
      SE.Bots.update(dt, this);
      SE.Guards.update(dt, SE.Player, this);
      this.updateCoins(dt);
      this.updateIncome(dt);
      this.updatePens(dt);
      this.updateInteractions(dt);
      this.updateTreadmill(dt);
      this.updateNests(dt);
      this.updateAlarmState();
      SE.FX.update(dt, this.time, SE.Player.pos);
      SE.Tutorial.update(dt);
      this.badgeTimer += dt;
      if (this.badgeTimer > 5) { this.badgeTimer = 0; SE.Daily.updateBadge(); SE.Wheel.updateBadge(); }

      /* тень следует за игроком */
      this.sun.position.set(SE.Player.pos.x + 60, 120, SE.Player.pos.z + 40);
      this.sun.target.position.copy(SE.Player.pos);
      this.sun.target.updateMatrixWorld();

      /* автосохранение */
      this.saveTimer += dt;
      if (this.saveTimer > 20) { this.saveTimer = 0; SE.State.save(); }

      SE.UI.updateBoosts();
    },

    /* ================= Доход ================= */
    updateIncome: function (dt) {
      var inc = SE.State.incomePerSec(SE.Boosts);
      if (inc > 0) {
        SE.State.addMoney(inc * dt);
        this.hudTimer = (this.hudTimer || 0) + dt;
        if (this.hudTimer > 0.25) { this.hudTimer = 0; SE.UI.updateHUD(); }
      }
    },

    /* ================= Монетки ================= */
    initCoins: function () {
      for (var i = 0; i < 26; i++) {
        var mesh = M.makeCoin();
        mesh.visible = false;
        this.scene.add(mesh);
        this.coins.push({ mesh: mesh, active: false, value: 0, life: 0 });
      }
    },

    spawnCoin: function () {
      var inc = SE.State.incomePerSec(SE.Boosts);
      if (inc <= 0) return;
      var free = null;
      for (var i = 0; i < this.coins.length; i++) if (!this.coins[i].active) { free = this.coins[i]; break; }
      if (!free) return;
      var pens = SE.World.pens;
      var pen = pens[Math.floor(Math.random() * pens.length)];
      var st = SE.State.data.pens[pen.index];
      if (!st.unlocked) return;
      free.active = true;
      free.value = Math.max(1, inc * (8 + Math.random() * 8));
      free.life = 30;
      free.mesh.visible = true;
      free.mesh.position.set(pen.x + (Math.random() - 0.5) * 12, 1.4, pen.z + (Math.random() - 0.5) * 12);
    },

    updateCoins: function (dt) {
      this.coinTimer -= dt;
      if (this.coinTimer <= 0) {
        this.coinTimer = 2.6;
        this.spawnCoin();
      }
      var magnet = SE.Boosts.isActive('magnet');
      var p = SE.Player.pos;
      for (var i = 0; i < this.coins.length; i++) {
        var c = this.coins[i];
        if (!c.active) continue;
        c.life -= dt;
        c.mesh.rotation.y += dt * 3;
        c.mesh.position.y = 1.4 + Math.sin(this.time * 3 + i) * 0.25;
        var dx = p.x - c.mesh.position.x, dz = p.z - c.mesh.position.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (magnet && d > 0.001 && d < 55) {
          var sp = Math.min(46, 12 + (55 - d) * 1.2);
          c.mesh.position.x += (dx / d) * sp * dt;
          c.mesh.position.z += (dz / d) * sp * dt;
        }
        if (d < 3.2) {
          SE.State.addMoney(c.value);
          SE.Audio.play('coin', { volume: 0.4, rate: 0.95 + Math.random() * 0.2 });
          SE.FX.burst('coin', c.mesh.position);
          c.active = false; c.mesh.visible = false;
          SE.UI.updateHUD();
        } else if (c.life <= 0) {
          c.active = false; c.mesh.visible = false;
        }
      }
    },

    /* ================= Загоны ================= */
    refreshPens: function () {
      var s = SE.State.data;
      for (var i = 0; i < SE.World.pens.length; i++) {
        var pen = SE.World.pens[i];
        var st = s.pens[i];
        /* очищаем содержимое */
        while (pen.content.children.length) pen.content.remove(pen.content.children[0]);
        pen.petModel = null;
        pen.eggMesh = null;

        pen.sign.group.visible = !st.unlocked;
        pen.lockLabel.visible = !st.unlocked;
        if (!st.unlocked) {
          pen.lockLabel.userData.setText(SE.t('world.penOpen') + '\n' + U.money(SE.World.PEN_PRICES[i]));
        }

        if (st.pet) {
          var def = SE.Pets.get(st.pet);
          if (def) {
            var model = M.makePet(def, 2.2);
            model.group.position.set(0, 0, 0);
            pen.content.add(model.group);
            pen.petModel = model;
          }
          pen.stateLabel.visible = true;
          pen.stateLabel.userData.setText(SE.t('world.ready'));
        } else if (st.egg) {
          var b = SE.Pets.biome(st.egg.biome);
          var egg = M.makeEgg(b.eggColor, b.eggStripe, 2.6, undefined, { rarity: st.egg.rarity });
          egg.position.set(0, 2.2, 0);
          pen.content.add(egg);
          pen.eggMesh = egg;
          /* новое яйцо падает в инкубатор с отскоком */
          if (pen.eggUid !== st.egg.uid) {
            if (pen.eggUid !== undefined || this.started) pen.dropT = 0;
            pen.eggUid = st.egg.uid;
          }
          pen.petModel = null;
          pen.stateLabel.visible = true;
        } else {
          pen.stateLabel.visible = false;
          pen.petModel = null;
          pen.eggMesh = null;
        }
      }
    },

    updatePens: function (dt) {
      var s = SE.State.data;
      var fast = SE.Boosts.isActive('x2hatch');
      var now = Date.now();
      for (var i = 0; i < s.pens.length; i++) {
        var st = s.pens[i];
        var pen = SE.World.pens[i];
        if (st.egg) {
          if (fast) st.hatchAt -= dt * 1000;
          var left = (st.hatchAt - now) / 1000;
          if (pen.eggMesh) {
            /* чем ближе вылупление, тем сильнее яйцо качается и подпрыгивает */
            var urg = left < 12 ? 1 - Math.max(0, left) / 12 : 0;
            var em = pen.eggMesh, ty = this.time;
            em.rotation.y += dt * 0.6;
            em.position.y = 2.2 + Math.sin(ty * 2 + i) * 0.12 + (left < 3 ? Math.abs(Math.sin(ty * 9)) * 0.4 : 0);
            em.rotation.z = Math.sin(ty * (6 + urg * 24)) * (0.03 + urg * 0.17);
            em.rotation.x = Math.cos(ty * (5 + urg * 19)) * urg * 0.09;
            if (pen.dropT !== undefined && pen.dropT < 1) {
              pen.dropT = Math.min(1, pen.dropT + dt * 1.6);
              var k = pen.dropT;
              /* падение сверху + два затухающих отскока */
              var h = k < 0.45 ? (1 - k / 0.45) * 9 : Math.abs(Math.sin((k - 0.45) / 0.55 * Math.PI * 2)) * (1 - k) * 2.2;
              em.position.y += h;
              var sq = k > 0.45 && k < 0.55 ? 0.18 : 0;
              em.scale.set(2.6 * (1 + sq * 0.5), 2.6 * (1 - sq), 2.6 * (1 + sq * 0.5));
              if (k >= 1) em.scale.setScalar(2.6);
            }
          }
          if (pen.stateLabel.visible && pen.stateLabel.userData.setText) {
            if (!pen.lastLabel || now - pen.lastLabel > 500) {
              pen.lastLabel = now;
              pen.stateLabel.userData.setText(U.time(Math.max(0, left)));
            }
          }
          if (left <= 0) this.hatch(i);
        } else if (st.pet && pen.petModel) {
          pen.petModel.update(dt, false);
        }
        if (pen.hatchAnim) this.updateHatchAnim(pen, dt);
      }
    },

    /* Вылупление: верх скорлупы улетает, низ проваливается, питомец выпрыгивает с «пружинкой». */
    startHatchAnim: function (index, biome) {
      var pen = SE.World.pens[index];
      if (!pen) return;
      var a = { t: 0, top: null, bottom: null, vx: (Math.random() - 0.5) * 7, vy: 11, vz: 2 + Math.random() * 3, spin: (Math.random() - 0.5) * 12 };
      if (M.makeEggShells) {
        var sh = M.makeEggShells(biome.eggColor, biome.eggStripe);
        [sh.top, sh.bottom].forEach(function (m) { m.scale.setScalar(2.6); m.position.set(0, 2.2, 0); pen.content.add(m); });
        a.top = sh.top; a.bottom = sh.bottom;
      }
      pen.hatchAnim = a;
      if (pen.petModel) pen.petModel.group.scale.setScalar(0.01);
    },

    updateHatchAnim: function (pen, dt) {
      var a = pen.hatchAnim;
      a.t += dt;
      if (a.top) {
        var p = a.top.position;
        a.vy -= 30 * dt;
        p.x += a.vx * dt; p.y += a.vy * dt; p.z += a.vz * dt;
        a.top.rotation.x += a.spin * dt; a.top.rotation.z += a.spin * 0.6 * dt;
        if (p.y < 0.6) { p.y = 0.6; a.vy = Math.abs(a.vy) * 0.35; a.vx *= 0.6; a.vz *= 0.6; a.spin *= 0.5; }
        if (a.t > 1.4) a.top.scale.setScalar(2.6 * Math.max(0, 1 - (a.t - 1.4) / 0.4));
      }
      if (a.bottom) {
        a.bottom.position.y = 2.2 - Math.min(1, a.t / 0.5) * 1.3;
        if (a.t > 0.9) a.bottom.scale.setScalar(2.6 * Math.max(0, 1 - (a.t - 0.9) / 0.4));
      }
      if (pen.petModel) {
        var k = Math.min(1, a.t / 0.7);
        /* упругое появление: перелёт 1.18, затем 1 */
        var sc = k < 0.6 ? k / 0.6 * 1.18 : 1.18 - (k - 0.6) / 0.4 * 0.18;
        pen.petModel.group.scale.setScalar(2.2 * Math.max(0.01, sc));
        pen.petModel.group.position.y = Math.sin(Math.min(1, a.t / 0.7) * Math.PI) * 3.2;
        pen.petModel.group.rotation.y = (1 - k) * Math.PI * 2;
      }
      if (a.t > 1.9) {
        [a.top, a.bottom].forEach(function (m) { if (m && m.parent) m.parent.remove(m); });
        if (pen.petModel) { pen.petModel.group.scale.setScalar(2.2); pen.petModel.group.position.y = 0; pen.petModel.group.rotation.y = 0; }
        pen.hatchAnim = null;
      }
    },

    hatch: function (index) {
      var st = SE.State.data.pens[index];
      if (!st.egg) return;
      var hatchBiome = SE.Pets.biome(st.egg.biome);
      var pet = SE.Pets.rollPet(st.egg.biome, st.egg.rarity);
      if (st.egg.rarity >= 4 && SE.Platform.happytime) SE.Platform.happytime();   /* legendary / mythic hatch */
      st.egg = null;
      st.pet = pet.id;
      SE.State.data.stats.hatched++;
      SE.Audio.play('crack', { volume: 0.7 });
      SE.Audio.play('hatch', { volume: 0.6 });
      var hp = SE.World.pens[index];
      if (hp) SE.FX.burst('hatch', { x: hp.x, y: 2.4, z: hp.z }, { color: hatchBiome.eggColor });
      this.refreshPens();
      this.startHatchAnim(index, hatchBiome);
      SE.UI.toast(SE.t('msg.hatched', SE.Pets.name(pet)), 'good');
      SE.UI.updateHUD();
      SE.State.save();
    },

    collectPen: function (index) {
      var st = SE.State.data.pens[index];
      if (!st.pet) return false;
      var petId = st.pet;
      st.pet = null;
      var res = SE.State.addPet(petId);
      if (res.isNew) this.reportProgress();
      var def = SE.Pets.get(petId);
      SE.Audio.play('reward', { volume: 0.7 });
      SE.FX.burst('sparkle', SE.Player.pos);
      if (res.isNew) SE.UI.toast(SE.t('msg.newPet') + ' ' + SE.Pets.name(def), 'good');
      else SE.UI.toast(SE.Pets.name(def), 'good');
      if (res.isNew && Object.keys(SE.State.data.index).length === SE.Pets.total()) {
        SE.UI.open('index');
      }
      this.refreshPens();
      this.refreshFollowers();
      SE.UI.updateHUD();
      SE.State.save();
      SE.Tutorial.onCollected();
      return true;
    },

    buyPen: function (index) {
      var st = SE.State.data.pens[index];
      if (!st || st.unlocked) return false;
      var price = SE.World.PEN_PRICES[index];
      if (!SE.State.canAfford(price)) {
        SE.Audio.play('error', { volume: 0.5 });
        SE.UI.toast(SE.t('msg.notEnough'), 'error');
        /* предлагаем открыть загон за рекламу */
        if (rule('autoOffers', true)) SE.UI.open('confirm', {
          title: SE.t('offer.freePen.t'),
          text: SE.t('msg.notEnough'),
          offerId: 'freePen',
          yesText: SE.t('btn.ok'),
          onYes: function () {}
        });
        return false;
      }
      SE.State.spend(price);
      SE.State.unlockPen(index);
      SE.Audio.play('unlock', { volume: 0.7 });
      var up = SE.World.pens[index];
      if (up) SE.FX.burst('unlock', { x: up.x, y: 1, z: up.z });
      SE.UI.toast(SE.t('msg.penBought'), 'good');
      this.refreshPens();
      SE.UI.updateHUD();
      SE.State.save();
      return true;
    },

    /* ================= Гнёзда и кража ================= */
    updateNests: function (dt) {
      for (var i = 0; i < SE.World.nests.length; i++) {
        var n = SE.World.nests[i];
        if (n.taken) {
          n.respawn -= dt;
          if (n.respawn <= 0) {
            n.taken = false;
            n.egg.visible = true;
          }
        }
      }
    },

    stealEgg: function (nest) {
      if (!nest || nest.taken) return;
      if (this.carrying) { SE.UI.toast(SE.t('msg.eggFull'), 'error'); return; }
      var zone = nest.zone;
      if (!SE.State.zoneUnlocked(zone.index)) {
        SE.UI.toast(SE.t('msg.zoneLocked'), 'error');
        return;
      }
      nest.taken = true;
      nest.respawn = 14;
      nest.egg.visible = false;

      var luck = SE.Boosts.isActive('luckyPet') ? 2 : 1;
      var egg = SE.Pets.makeEgg(zone.id, luck);
      this.carrying = egg;
      this.carryZone = zone;
      SE.Player.setCarry(egg);
      SE.State.data.stats.steals++;

      SE.Audio.play('egg_pickup', { volume: 0.8 });
      SE.Audio.play('alarm', { volume: 0.5 });
      SE.Guards.alarm(zone, 26);
      SE.UI.showAlarm(true);
      SE.UI.toast(SE.t('msg.eggStolen'), 'good');
      SE.Audio.playMusic('chase');
      SE.FX.burst('steal', { x: nest.x, y: 2.2, z: nest.z });
      SE.UI.setHint(SE.t('hint.runHome'));
      SE.Tutorial.onStolen();
    },

    /* Игрок пойман охранником */
    /* Результат раунда уходит в рекорды платформы после каждой доставки и поимки. */
    submitRoundScore: function () {
      if (SE.Tutorial && SE.Tutorial.active) return;   /* обучение — не раунд */
      if (SE.Platform.submitScore) SE.Platform.submitScore(SE.State.computeScore());
    },

    onCaught: function (guard) {
      if (!this.carrying) {
        /* без яйца просто отталкиваем */
        SE.Audio.play('hurt', { volume: 0.5 });
        SE.Player.pos.x += (SE.Player.pos.x - guard.x) * 0.5;
        SE.Player.pos.z += (SE.Player.pos.z - guard.z) * 0.5;
        return;
      }
      var egg = this.carrying;
      this.carrying = null;
      SE.Player.setCarry(null);
      SE.Audio.play('lose', { volume: 0.7 });
      SE.Audio.playMusic('theme');
      SE.UI.showAlarm(false);
      SE.Guards.calmPlayer();
      SE.FX.burst('caught', SE.Player.pos);
      SE.Player.teleportHome();
      if (SE.Tutorial.active) {
        /* the tutorial is not a round: no result panel, no ads, nothing counted */
        SE.Tutorial.onCaught();
        return;
      }
      SE.State.data.stats.losses++;
      SE.State.data.stats.catches++;
      SE.Ads.roundEnded();
      SE.UI.open('result', { win: false, egg: egg, lostEgg: egg });
      SE.State.save();
      this.submitRoundScore();
    },

    /* Игрок донёс яйцо до базы */
    onDelivered: function () {
      var egg = this.carrying;
      if (!egg || this.deliveredUid === egg.uid) return;
      this.deliveredUid = egg.uid;
      var reward = this.eggReward(egg);
      var gems = SE.Shop.cashMode() ? 0 : this.gemReward(egg);
      SE.State.addMoney(reward);
      if (gems) SE.State.addGems(gems);
      SE.State.data.stats.wins++;
      SE.Audio.play('win', { volume: 0.6 });
      SE.Audio.playMusic('theme');
      SE.UI.showAlarm(false);
      SE.Guards.calmPlayer();
      /* celebration: burst, cheer and the equipped victory effect */
      SE.FX.burst('deliver', SE.Player.pos);
      SE.Player.celebrate(1.6);
      var victory = SE.Shop.equippedVictory();
      if (victory) SE.FX.victory(victory, SE.Player.pos);

      var penIndex = SE.State.freePen();
      if (penIndex >= 0) {
        SE.State.placeEgg(penIndex, egg, SE.Boosts);
        this.carrying = null;
        SE.Player.setCarry(null);
        this.refreshPens();
        SE.UI.toast(SE.t('msg.eggPlaced'), 'good');
      } else {
        SE.UI.toast(SE.t('msg.noPens'), 'error');
      }
      if (gems) SE.UI.toast(SE.t('msg.gemsGot', gems), 'good');

      if (SE.Tutorial.active) {
        /* the tutorial is not a round: no result panel and no ad counter */
        SE.Tutorial.onDelivered(penIndex);
      } else {
        SE.Ads.roundEnded();
        SE.UI.open('result', { win: true, egg: egg, reward: reward, gems: gems });
      }
      SE.UI.updateHUD();
      SE.State.save();
      this.submitRoundScore();
    },

    /* Gems for a delivery by egg rarity (5..25). */
    GEM_REWARD: [5, 8, 12, 17, 21, 25],
    gemReward: function (egg) {
      return this.GEM_REWARD[Math.max(0, Math.min(this.GEM_REWARD.length - 1, egg.rarity | 0))];
    },

    eggReward: function (egg) {
      var b = SE.Pets.biome(egg.biome);
      var r = SE.Pets.RARITIES[egg.rarity];
      return Math.round(25 * b.base * r.mult * 0.5 + 50);
    },

    /* ================= Взаимодействия ================= */
    updateInteractions: function (dt) {
      var p = SE.Player.pos;
      var best = null, bestD = 1e9;
      var list = SE.World.interactables;
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (it.type === 'nest' && it.nest.taken) continue;
        var dx = p.x - it.x, dz = p.z - it.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < it.r && d < bestD) { best = it; bestD = d; }
      }
      this.nearest = best;

      /* подсказка */
      if (!SE.UI.isOpen()) {
        if (best) {
          var key = SE.Platform.isMobile ? (best.hintMobile || best.hint) : best.hint;
          var text = SE.t(key);
          if (best.type === 'pen') {
            var st = SE.State.data.pens[best.penIndex];
            if (!st.unlocked) {
              text = SE.t(SE.Platform.isMobile ? 'hint.unlockMobile' : 'hint.unlock') +
                ' · ' + U.money(SE.World.PEN_PRICES[best.penIndex]);
            } else if (st.pet) {
              text = SE.t(SE.Platform.isMobile ? 'hint.collectMobile' : 'hint.collect');
            } else if (!this.carrying) {
              text = SE.t('world.penEmpty');
            }
          } else if (best.type === 'shop') {
            text = SE.t(SE.Platform.isMobile ? 'hint.shopMobile' : 'hint.shop');
          } else if (best.type === 'zoneGate') {
            var zi = best.zoneIndex;
            if (SE.State.zoneUnlocked(zi)) text = SE.t(SE.Pets.BIOMES[zi].key);
            else text = SE.t('world.unlockFor', U.money(this.zonePrice(zi)));
          }
          SE.UI.setHint(text);
        } else if (this.carrying) {
          SE.UI.setHint(SE.t('hint.runHome'));
        } else {
          SE.UI.setHint('');
        }
      }

      /* доставка яйца на базу (один раз на каждое яйцо) */
      if (this.carrying && this.deliveredUid !== this.carrying.uid && SE.World.inSafeZone(p.x, p.z)) {
        this.onDelivered();
        return;
      }

      var act = SE.Input.consumeAction();
      var act2 = SE.Input.consumeAction2();
      if (SE.UI.isOpen()) return;

      if (act2 && best && best.type === 'sell') {
        this.sellAll();
        return;
      }
      if (!act) return;

      if (!best) return;
      switch (best.type) {
        case 'nest':
          this.stealEgg(best.nest);
          break;
        case 'pen':
          this.penAction(best.penIndex);
          break;
        case 'sell':
          this.sellSelectedOrAll();
          break;
        case 'trail':
          SE.UI.openWithAd('trails');
          break;
        case 'shop':
          SE.UI.openWithAd('wardrobe');
          break;
        case 'zoneGate':
          this.unlockZone(best.zoneIndex);
          break;
      }
    },

    penAction: function (index) {
      var st = SE.State.data.pens[index];
      if (!st.unlocked) { this.buyPen(index); return; }
      if (st.pet) { this.collectPen(index); return; }
      if (this.carrying && !st.egg) {
        SE.State.placeEgg(index, this.carrying, SE.Boosts);
        this.carrying = null;
        SE.Player.setCarry(null);
        this.refreshPens();
        SE.Audio.play('powerup', { volume: 0.5 });
        SE.UI.toast(SE.t('msg.eggPlaced'), 'good');
        SE.State.save();
        return;
      }
      SE.UI.open('eggs');
    },

    /* ================= Беговая дорожка ================= */
    updateTreadmill: function (dt) {
      var p = SE.Player.pos;
      if (this.tmSpot === undefined) {
        this.tmSpot = null;
        for (var i = 0; i < SE.World.interactables.length; i++) {
          if (SE.World.interactables[i].type === 'treadmill') { this.tmSpot = SE.World.interactables[i]; break; }
        }
      }
      var tm = this.tmSpot;
      if (!tm) return;
      var dx = p.x - tm.x, dz = p.z - tm.z;
      if (dx * dx + dz * dz > tm.r * tm.r) return;

      var trail = this.activeTrail();
      var mult = trail.mult;
      var gain = 0.22 * mult * (SE.Player.moving || SE.Player.training ? 1.6 : 1) * dt;
      SE.State.data.speed += gain;
      SE.Player.setSpeedStat(SE.State.data.speed);

      this.trainAcc = (this.trainAcc || 0) + gain;
      if (this.trainAcc > 1) {
        this.trainAcc = 0;
        SE.Audio.play('blip', { volume: 0.2 });
        SE.UI.updateHUD();
      }
    },

    activeTrail: function () {
      if (SE.Boosts.isActive('freeTrail')) return SE.State.trailDef('rainbow');
      return SE.State.trailDef(SE.State.data.trail);
    },

    get trail() { return this.activeTrail().id; },

    trailColor: function () { return this.activeTrail().color; },

    buyTrail: function (id) {
      var tr = SE.State.trailDef(id);
      var s = SE.State.data;
      if (SE.State.ownsTrail(id)) {
        s.trail = id;
        SE.Audio.play('equip', { volume: 0.6 });
        SE.UI.toast(SE.t(tr.key), 'good');
        SE.State.save();
        return true;
      }
      if (!SE.State.canAfford(tr.price)) {
        SE.Audio.play('error', { volume: 0.5 });
        SE.UI.toast(SE.t('msg.notEnough'), 'error');
        return false;
      }
      SE.State.spend(tr.price);
      s.trailsOwned.push(id);
      s.trail = id;
      SE.Audio.play('buy', { volume: 0.7 });
      SE.UI.toast(SE.t('msg.trailBought'), 'good');
      SE.UI.updateHUD();
      SE.State.save();
      SE.Tasks.timeout(function () { SE.Ads.breakPoint('buy:trail'); }, 900);   /* after the purchase (Playables) */
      return true;
    },

    /* ================= Продажа ================= */
    sellSelectedOrAll: function () {
      var uid = SE.UI.selectedPet;
      if (uid && SE.State.getPetItem(uid)) this.sellPets([uid]);
      else this.sellAll();
    },

    sellAll: function () {
      var ids = SE.State.data.inventory
        .filter(function (i) { return !SE.State.isEquipped(i.uid); })
        .map(function (i) { return i.uid; });
      if (!ids.length) {
        SE.UI.toast(SE.t('ui.emptyPets'), 'error');
        SE.Audio.play('error', { volume: 0.4 });
        return;
      }
      this.sellPets(ids);
    },

    sellPets: function (uids) {
      var total = 0;
      for (var i = 0; i < uids.length; i++) {
        var item = SE.State.getPetItem(uids[i]);
        if (!item) continue;
        total += SE.State.petValue(item);
        SE.State.removePet(uids[i]);
      }
      if (!total) return;
      if (SE.Boosts.isActive('doubleSell')) total *= 2;
      SE.State.addMoney(total);
      SE.State.data.stats.sold += uids.length;
      SE.UI.selectedPet = null;
      SE.Audio.play('sell', { volume: 0.7 });
      SE.FX.burst('sell', SE.Player.pos);
      SE.UI.toast(SE.t('msg.sold', U.money(total)), 'good');
      this.refreshFollowers();
      SE.UI.updateHUD();
      SE.State.save();

      /* Предложение удвоить продажу за рекламу */
      if (rule('autoOffers', true) && !SE.Boosts.isActive('doubleSell') && total > 100 && SE.Ads.ready('doubleSell')) {
        SE.UI.open('confirm', {
          title: SE.Ads.title('doubleSell'),
          text: SE.Ads.desc('doubleSell'),
          offerId: 'doubleSell',
          yesText: SE.t('btn.ok')
        });
      }
    },

    /* ================= Локации ================= */
    zonePrice: function (index) {
      var base = SE.Pets.BIOMES[index].price;
      if (SE.Boosts.isActive('zoneDiscount')) base = Math.round(base * 0.7);
      return base;
    },

    unlockZone: function (index) {
      if (SE.State.zoneUnlocked(index)) return;
      var price = this.zonePrice(index);
      if (!SE.State.canAfford(price)) {
        SE.Audio.play('error', { volume: 0.5 });
        SE.UI.toast(SE.t('msg.notEnough'), 'error');
        if (rule('autoOffers', true) && SE.Ads.ready('zoneDiscount') && !SE.Boosts.isActive('zoneDiscount')) {
          SE.UI.open('confirm', {
            title: SE.Ads.title('zoneDiscount'),
            text: SE.Ads.desc('zoneDiscount'),
            offerId: 'zoneDiscount',
            yesText: SE.t('btn.ok')
          });
        }
        return;
      }
      SE.State.spend(price);
      SE.State.unlockZone(index);
      if (SE.Platform.happytime) SE.Platform.happytime();
      SE.World.setZoneUnlocked(index, true);
      SE.Audio.play('unlock', { volume: 0.8 });
      var uz = SE.World.zones[index];
      SE.FX.burst('unlock', uz && uz.gateX !== undefined ? { x: uz.gateX, y: 2, z: uz.gateZ } : SE.Player.pos);
      SE.UI.toast(SE.t('msg.zoneUnlocked', SE.t(SE.Pets.BIOMES[index].key)), 'good');
      SE.UI.updateHUD();
      SE.State.save();
    },

    /* ================= Питомцы-спутники ================= */
    refreshFollowers: function () {
      var ids = [];
      var eq = SE.State.data.equipped;
      for (var i = 0; i < eq.length; i++) {
        var item = SE.State.getPetItem(eq[i]);
        if (item) ids.push(item.petId);
      }
      SE.Player.setFollowers(ids);
    },

    /* ================= Тревога ================= */
    updateAlarmState: function () {
      var chasing = SE.Guards.anyChasing('player');
      SE.UI.showAlarm(chasing && !!this.carrying);
      if (!chasing && SE.Audio.musicName === 'chase' && !this.carrying) {
        SE.Audio.playMusic('theme');
      }
    },

    /* ================= Offline income ================= */
    checkOffline: function () {
      var s = SE.State.data;
      var last = s.lastSeen || Date.now();
      var away = Math.min(8 * 3600, (Date.now() - last) / 1000);
      if (away < 60) return;
      var inc = SE.State.incomePerSec(null);
      var earned = Math.floor(inc * away * 0.5);
      if (earned <= 0) return;
      this.offlineEarned = earned;
      SE.State.addMoney(earned);
      SE.State.save();
      SE.UI.updateHUD();
      SE.UI.toast(SE.t('msg.offline', U.money(earned)), 'good');
      var self = this;
      SE.Tasks.timeout(function () {
        if (rule('autoOffers', true) && SE.Ads.ready('offline')) {
          SE.UI.open('confirm', {
            title: SE.Ads.title('offline'),
            text: SE.Ads.desc('offline'),
            offerId: 'offline',
            ctx: { amount: earned },
            yesText: SE.t('btn.ok')
          });
        }
      }, 1500);
    },

    cashBonusAmount: function () {
      var inc = SE.State.incomePerSec(null);
      var zoneBase = SE.Pets.BIOMES[SE.State.highestZone()].base;
      return Math.floor(Math.max(500, inc * 240 + zoneBase * 800));
    },

    /* ================= Награды за рекламу ================= */
    applyReward: function (id, ctx) {
      ctx = ctx || {};
      var s = SE.State.data;
      var o = SE.Ads.get(id);
      var self = this;

      switch (id) {
        case 'x2income':
        case 'speedBoost':
        case 'x2hatch':
        case 'magnet':
        case 'invisible':
        case 'luckyPet':
        case 'zoneDiscount':
        case 'doubleSell':
          SE.Boosts.activate(id, o.dur || 60);
          break;

        case 'freeTrail':
          SE.Boosts.activate('freeTrail', o.dur || 600);
          break;

        case 'instantHatch':
          var idx = ctx.pen;
          if (idx === undefined || !s.pens[idx] || !s.pens[idx].egg) {
            idx = -1;
            for (var i = 0; i < s.pens.length; i++) if (s.pens[i].egg) { idx = i; break; }
          }
          if (idx >= 0) { s.pens[idx].hatchAt = Date.now(); this.hatch(idx); }
          else SE.UI.toast(SE.t('ui.emptyEggs'), 'error');
          break;

        case 'freeEgg':
          var zones = [];
          for (var z = 0; z < s.zones.length; z++) if (s.zones[z]) zones.push(SE.Pets.BIOMES[z].id);
          var egg = SE.Pets.makeEgg(U.choice(zones), 1.5);
          var free = SE.State.freePen();
          if (free >= 0) {
            SE.State.placeEgg(free, egg, SE.Boosts);
            this.refreshPens();
            SE.UI.toast(SE.t('msg.eggPlaced'), 'good');
          } else if (!this.carrying) {
            this.carrying = egg;
            SE.Player.setCarry(egg);
            SE.UI.toast(SE.t('msg.eggStolen'), 'good');
          } else {
            SE.UI.toast(SE.t('msg.noPens'), 'error');
          }
          break;

        case 'escape':
          /* Возвращаем украденное яйцо и даём короткую фору */
          if (ctx.egg && !this.carrying) {
            this.carrying = ctx.egg;
            SE.Player.setCarry(ctx.egg);
          }
          SE.Guards.calmPlayer();
          SE.Boosts.activate('invisible', 10);
          SE.UI.showAlarm(false);
          SE.UI.toast(SE.t('msg.rewardGot'), 'good');
          break;

        case 'revive':
          /* Продолжаем забег: яйцо возвращается, охранники не видят, скорость выше */
          if (ctx.egg && !this.carrying) {
            this.carrying = ctx.egg;
            SE.Player.setCarry(ctx.egg);
          }
          SE.Guards.calmPlayer();
          SE.Boosts.activate('invisible', 25);
          SE.Boosts.activate('speedBoost', 25);
          SE.UI.showAlarm(false);
          SE.UI.toast(SE.t('msg.rewardGot'), 'good');
          break;

        case 'upgradeEgg':
          var target = ctx.egg;
          var found = null;
          for (var p = 0; p < s.pens.length; p++) {
            if (s.pens[p].egg && target && s.pens[p].egg.uid === target.uid) { found = p; break; }
          }
          if (found !== null) {
            var pe = s.pens[found].egg;
            pe.rarity = Math.min(SE.Pets.RARITIES.length - 1, pe.rarity + 1);
            var dur = SE.Pets.hatchTime(pe);
            s.pens[found].duration = dur;
            s.pens[found].hatchAt = Date.now() + dur * 1000;
            this.refreshPens();
          } else if (this.carrying) {
            this.carrying.rarity = Math.min(SE.Pets.RARITIES.length - 1, this.carrying.rarity + 1);
            SE.Player.setCarry(this.carrying);
          }
          SE.UI.toast(SE.t('msg.rewardGot'), 'good');
          break;

        case 'freePen':
          var next = SE.State.nextLockedPen();
          if (next >= 0) {
            SE.State.unlockPen(next);
            this.refreshPens();
            SE.UI.toast(SE.t('msg.penBought'), 'good');
          } else SE.UI.toast(SE.t('msg.maxLevel'), 'error');
          break;

        case 'offline':
          var amount = this.offlineEarned || 0;
          this.offlineEarned = 0;
          if (amount > 0) {
            SE.State.addMoney(amount);
            SE.UI.toast(SE.t('msg.rewardGot') + ' ' + U.money(amount), 'good');
          }
          break;

        case 'speedUp':
          s.speed += 15;
          SE.Player.setSpeedStat(s.speed);
          SE.UI.toast(SE.t('msg.speedUp', 15), 'good');
          break;

        case 'cashBonus':
          var cash = this.cashBonusAmount();
          SE.State.addMoney(cash);
          SE.UI.toast(SE.t('msg.rewardGot') + ' ' + U.money(cash), 'good');
          break;

      }

      SE.Audio.play('reward', { volume: 0.6 });
      SE.UI.updateHUD();
      SE.State.save();
    },

    /* ================= Панели ================= */
    onPanelOpen: function (id) {
      this.setPaused(true, 'ui');
    },

    onPanelClose: function (id) {
      this.setPaused(false, 'ui');
      SE.UI.updateHUD();
    },

    resetProgress: function () {
      SE.State.data = SE.State.create();
      SE.State.save().then(function (ok) { if (ok) global.location.reload(); });
    }
  };

  SE.Game = Game;

  /* Запрет перетаскивания картинок и выделения текста во всей игре (кроме полей ввода). */
  function editable(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }
  document.addEventListener('dragstart', function (e) { if (!editable(e.target)) e.preventDefault(); }, true);
  document.addEventListener('selectstart', function (e) { if (!editable(e.target)) e.preventDefault(); }, true);
  /* Новые <img> (миниатюры питомцев, карточки) сразу помечаются как неперетаскиваемые. */
  if (global.MutationObserver) {
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var added = list[i].addedNodes;
        for (var k = 0; k < added.length; k++) {
          var n = added[k];
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IMG') n.draggable = false;
          else if (n.querySelectorAll) {
            var imgs = n.querySelectorAll('img');
            for (var m = 0; m < imgs.length; m++) imgs[m].draggable = false;
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* Старт */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { Game.boot(); });
  } else {
    Game.boot();
  }
})(window);
