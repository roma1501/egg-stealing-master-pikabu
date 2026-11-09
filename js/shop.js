/* =========================================================
   Cosmetic shop (owned by the SYSTEMS agent)
   - SE.Shop: catalogue, prices, unlock by gems or by rewarded ads, equip, look
   - SE.Preview: rotating 3D character in a small separate renderer
   - SE.Thumbs: 3D item thumbnails (character wearing the item), cached
   Everything here is cosmetic: no gameplay advantage.
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U, T = global.THREE;

  var TABS = ['outfit', 'hat', 'face', 'back', 'aura', 'victory'];
  var TAB_ICON = { outfit: 'outfit', hat: 'hat', face: 'face', back: 'back', aura: 'aura', victory: 'trophy' };
  var GEM_PRICE = [30, 75, 150, 300, 600];      /* by rarity 0..4 */
  var CASH_PRICE = [1000, 8000, 60000, 500000, 5000000];  /* the same ladder in cash (platforms without gems) */
  var AD_VIEWS = [1, 2, 3, 4, 5];               /* rewarded views by rarity 0..4 */
  var GEM_SHARE = 0.35;                         /* about 35% of every tab costs gems, the rest unlocks by ads */
  var DEFAULT_TINTS = ['#c8323c', '#3b4252', '#e08a2c', '#ffe2c6', '#f4efe2'];

  /* Platforms that want a single currency (Poki: rule gems === false) sell cosmetics for cash. */
  function cashMode() { return !!SE.rule && SE.rule('gems', true) === false; }
  /* Price by rarity, or a fixed gem price converted along the same ladder. */
  function priceOf(rarity, gems) {
    if (!cashMode()) return gems != null ? gems : GEM_PRICE[Math.min(4, rarity)];
    if (gems == null) return CASH_PRICE[Math.min(4, rarity)];
    var raw = CASH_PRICE[4] * gems / GEM_PRICE[4], mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
    return Math.round(raw / mag) * mag;
  }
  function canPay(n) { return cashMode() ? SE.State.canAfford(n) : SE.State.canAffordGems(n); }
  function pay(n) { return cashMode() ? SE.State.spend(n) : SE.State.spendGems(n); }
  function priceHtml(n) {
    return cashMode() ? SE.Icons.html('banknotes') + '<span>' + U.money(n) + '</span>' : SE.Icons.html('gem') + '<span>' + U.shortNum(n) + '</span>';
  }
  function priceText(n) { return cashMode() ? U.money(n) : n + ' ' + SE.t('ui.gems').toLowerCase(); }

  function rarityOf(r) { r = Math.floor(Number(r)); return isFinite(r) ? Math.max(0, Math.min(5, r)) : 0; }
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h >>> 0;
  }

  /* ---------------- catalogue ---------------- */
  var cache = {};

  function sourceList(slot) {
    var CM = SE.CosmeticModels || {};
    switch (slot) {
      case 'outfit': return SE.Outfits || [];
      case 'hat': return CM.hats || [];
      case 'face': return CM.faces || [];
      case 'back': return CM.backs || [];
      case 'aura': return (SE.FX && SE.FX.AURAS) || [];
      case 'victory': return (SE.FX && SE.FX.VICTORIES) || [];
    }
    return [];
  }

  function build(slot) {
    var src = sourceList(slot), all = [];
    /* Platforms that do not want meme characters (Poki) get no brainrot skins at all. */
    var noSkins = SE.rule && SE.rule('brainrot', true) === false;
    for (var i = 0; i < src.length; i++) {
      var s = src[i];
      if (!s || !s.id || (s.skin && noSkins)) continue;
      all.push({
        slot: slot, id: s.id, key: slot + ':' + s.id, name: s.name || s.id, rarity: rarityOf(s.rarity),
        node: s.node || null, src: s, order: i, exclusive: !!s.exclusive, starter: !!s.starter,
        colors: s.colors || null, mode: 'free', price: 0, views: 0, skinItem: !!s.skin
      });
    }
    /* Platform ad rules: no chain of ads for one reward (CrazyGames) + a gem price as an alternative. */
    var noChain = SE.rule && SE.rule('adChain', true) === false;
    var gemAlt = SE.rule && SE.rule('gemAlternative', false) === true;
    var skins = all.filter(function (it) { return it.skinItem; });
    skins.forEach(function (it) {
      var u = it.src.unlock || {};
      if (u.gems) { it.mode = 'gems'; it.price = priceOf(it.rarity, u.gems); }
      else {
        it.mode = 'ads'; it.views = u.ads || 1;
        if (gemAlt) it.altPrice = priceOf(it.rarity, 200 * it.views);
        if (noChain) it.views = 1;
      }
    });
    var shop = all.filter(function (it) { return !it.exclusive && !it.starter && !it.skinItem; });
    shop.sort(function (a, b) { return a.rarity - b.rarity || a.order - b.order; });
    shop.forEach(function (it, idx) {
      /* Deterministic split: every third item costs gems (about 35%), spread evenly over all rarities. */
      var gem = Math.floor((idx + 1) * GEM_SHARE) > Math.floor(idx * GEM_SHARE);
      it.mode = gem ? 'gems' : 'ads';
      it.price = gem ? priceOf(it.rarity) : 0;
      it.views = gem ? 0 : AD_VIEWS[it.rarity];
      if (!gem && gemAlt) it.altPrice = priceOf(it.rarity);
      if (!gem && noChain) it.views = 1;
    });
    all.forEach(function (it) { if (it.exclusive) it.mode = 'exclusive'; });
    return { all: all, shop: shop, skins: skins };
  }

  function catalog(slot) {
    var src = sourceList(slot);
    var sig = src.length + ':' + (src[0] && src[0].id) + ':' + (src[src.length - 1] && src[src.length - 1].id);
    var c = cache[slot];
    if (!c || c.sig !== sig) { c = cache[slot] = build(slot); c.sig = sig; }
    return c;
  }

  /* ---------------- look ---------------- */
  function findItem(slot, id) {
    if (!id) return null;
    var all = catalog(slot).all;
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function resolveFace(hint) {
    if (!hint) return null;
    var faces = catalog('face').all, i;
    for (i = 0; i < faces.length; i++) if (faces[i].id === hint) return faces[i].node;
    var h = String(hint).toLowerCase();
    for (i = 0; i < faces.length; i++) if (faces[i].id.toLowerCase().indexOf(h) >= 0) return faces[i].node;
    return null;
  }

  /* The look object of SE.Models.makeCharacter().setLook for an equipped map. */
  function lookFor(eq) {
    eq = eq || {};
    var outfit = findItem('outfit', eq.outfit) || findItem('outfit', 'starter');
    var o = outfit ? outfit.src : { tints: DEFAULT_TINTS, hairStyle: 'spiky', glow: 0 };
    var hat = findItem('hat', eq.hat), back = findItem('back', eq.back), face = findItem('face', eq.face);
    return {
      skin: outfit && outfit.skinItem ? outfit.id : null,
      tints: o.tints || DEFAULT_TINTS,
      hairStyle: o.hairStyle || 'swept',
      glow: o.glow || 0,
      hat: hat ? hat.node : null,
      face: face ? face.node : resolveFace(o.face),
      back: back ? back.node : null
    };
  }

  /* Bounding box of the visible part of an object tree (hidden sub-trees do not count). */
  function visibleBox(root) {
    var box = new T.Box3(), any = false, tmp = new T.Box3();
    root.updateMatrixWorld(true);
    (function walk(o) {
      if (o.visible === false) return;
      if (o.isMesh && o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        box.union(tmp); any = true;
      }
      for (var i = 0; i < o.children.length; i++) walk(o.children[i]);
    })(root);
    return any ? box : null;
  }

  /* ---------------- 3D preview (rotating character) ---------------- */
  var Preview = {
    renderer: null, scene: null, camera: null, api: null, pivot: null, host: null,
    failed: false, raf: 0, last: 0, yaw: 0.45, dragging: false, look: null, ro: null,

    init: function () {
      if (this.renderer || this.failed) return !this.failed;
      try {
        this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        this.renderer.setClearColor(0x000000, 0);
        if (T.sRGBEncoding !== undefined) this.renderer.outputEncoding = T.sRGBEncoding;
        this.scene = new T.Scene();
        this.camera = new T.PerspectiveCamera(26, 1, 1, 120);
        this.scene.add(new T.HemisphereLight(0xffffff, 0x8f8a7a, 1.15));
        var sun = new T.DirectionalLight(0xfff4e0, 0.95);
        sun.position.set(-6, 10, 9);
        this.scene.add(sun);
        var rim = new T.DirectionalLight(0x9fd8ff, 0.35);
        rim.position.set(7, 4, -8);
        this.scene.add(rim);
        /* wooden podium */
        var podium = new T.Group();
        var top = new T.Mesh(new T.CylinderGeometry(4.3, 4.6, 0.55, 28), new T.MeshLambertMaterial({ color: '#d9a15a' }));
        top.position.y = -0.28;
        var ring = new T.Mesh(new T.TorusGeometry(4.35, 0.12, 8, 36), new T.MeshLambertMaterial({ color: '#8f5a26' }));
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.0;
        podium.add(top); podium.add(ring);
        this.scene.add(podium);
        this.pivot = new T.Group();
        this.scene.add(this.pivot);
        this.api = SE.Models.makeCharacter();
        this.pivot.add(this.api.group);
        if (this.api.update) this.api.update(0.016, false, 1, true);
        var self = this;
        this.api.onSkin = function () { self.fitSkin(); };
        this.renderer.domElement.className = 'wd-canvas';
        this.renderer.domElement.addEventListener('pointerdown', function (e) {
          self.dragging = true; self.lastX = e.clientX;
          try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        });
        this.renderer.domElement.addEventListener('pointermove', function (e) {
          if (!self.dragging) return;
          self.yaw += (e.clientX - self.lastX) * 0.012;
          self.lastX = e.clientX;
        });
        var stop = function () { self.dragging = false; };
        this.renderer.domElement.addEventListener('pointerup', stop);
        this.renderer.domElement.addEventListener('pointercancel', stop);
        if (this.look) this.api.setLook(this.look);
      } catch (err) {
        console.warn('3D preview unavailable', err);
        this.failed = true; this.renderer = null;
        return false;
      }
      return true;
    },

    attach: function (host) {
      if (!this.init()) return false;
      this.host = host;
      host.appendChild(this.renderer.domElement);
      this.resize();
      var self = this;
      if (global.ResizeObserver) {
        if (this.ro) this.ro.disconnect();
        this.ro = new global.ResizeObserver(function () { self.resize(); });
        this.ro.observe(host);
      }
      if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(function (t) { self.loop(t); }); }
      return true;
    },

    detach: function () {
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      if (this.ro) { this.ro.disconnect(); this.ro = null; }
      if (this.renderer && this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      this.host = null;
    },

    setLook: function (look) {
      this.look = look;
      if (this.api && look) this.api.setLook(look);
    },

    /* A full-body skin can be taller or shorter than the default avatar: measure it. */
    fitSkin: function () {
      this.fit = null;
      if (this.api && this.api.skinId && this.api.skinId()) {
        var box = visibleBox(this.api.group);
        if (box) this.fit = { h: Math.max(10.2, (box.max.y - Math.min(0, box.min.y)) * 1.32), y: Math.max(3.4, (box.max.y + Math.min(0, box.min.y)) / 2) };
      }
      this.resize();
    },

    resize: function () {
      if (!this.renderer || !this.host) return;
      var w = Math.max(40, this.host.clientWidth), h = Math.max(40, this.host.clientHeight);
      var q = SE.State && SE.State.data ? SE.State.data.settings.quality : 'high';
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, q === 'low' ? 1 : 1.75));
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      /* Fit the whole character (and tall hats) for both tall and wide stages. */
      var vfov = this.camera.fov * Math.PI / 180, need = this.fit ? this.fit.h : 10.2, width = 8.2;
      var dv = (need / 2) / Math.tan(vfov / 2);
      var dh = (width / 2) / (Math.tan(vfov / 2) * this.camera.aspect);
      var d = Math.max(dv, dh);
      var ly = this.fit ? this.fit.y : 3.9;
      this.camera.position.set(0, ly + 0.3 + d * 0.06, d);
      this.camera.lookAt(0, ly, 0);
      this.camera.updateProjectionMatrix();
    },

    loop: function (t) {
      var self = this;
      this.raf = 0;
      if (!this.renderer || !this.host) return;
      this.raf = requestAnimationFrame(function (n) { self.loop(n); });
      if (SE.Platform && SE.Platform.paused) { this.last = t; return; }
      var dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      if (!this.dragging) this.yaw += dt * 0.55;
      this.pivot.rotation.y = this.yaw;
      if (this.api.update) this.api.update(dt, false, 1, true);
      this.renderer.render(this.scene, this.camera);
    }
  };

  /* ---------------- 3D thumbnails ---------------- */
  var Thumbs = {
    cache: {}, queue: [], scheduled: false, renderer: null, scene: null, camera: null, api: null, failed: false,
    SIZE: 168,

    init: function () {
      if (this.renderer || this.failed) return !this.failed;
      try {
        this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(this.SIZE, this.SIZE);
        this.renderer.setClearColor(0x000000, 0);
        if (T.sRGBEncoding !== undefined) this.renderer.outputEncoding = T.sRGBEncoding;
        this.scene = new T.Scene();
        this.scene.add(new T.HemisphereLight(0xffffff, 0x8f8a7a, 1.2));
        var sun = new T.DirectionalLight(0xffffff, 0.9);
        sun.position.set(-4, 7, 9);
        this.scene.add(sun);
        this.camera = new T.PerspectiveCamera(26, 1, 1, 120);
        this.api = SE.Models.makeCharacter();
        this.scene.add(this.api.group);
        if (this.api.update) this.api.update(0.016, false, 1, true);
      } catch (err) {
        console.warn('3D thumbnails unavailable', err);
        this.failed = true; this.renderer = null;
        return false;
      }
      return true;
    },

    /* Camera presets: [target y, distance, camera yaw] */
    FRAME: {
      outfit: [3.55, 17.5, 0.5],
      hat: [5.9, 10.5, 0.45],
      face: [4.95, 8.2, 0.3],
      back: [3.4, 13, Math.PI + 0.55]
    },

    render: function (item) {
      if (!this.init() || !this.api.setLook) return null;
      var eq = { outfit: 'starter' };
      if (item.slot === 'outfit') eq.outfit = item.id;
      else eq[item.slot] = item.id;
      var look = lookFor(eq);
      look.hat = item.slot === 'hat' ? item.node : null;
      look.face = item.slot === 'face' ? item.node : (item.slot === 'outfit' ? look.face : null);
      look.back = item.slot === 'back' ? item.node : null;
      this.api.setLook(look);
      var f = this.FRAME[item.slot];
      this.api.group.rotation.y = 0;
      this.camera.position.set(Math.sin(f[2]) * f[1], f[0] + f[1] * 0.1, Math.cos(f[2]) * f[1]);
      this.camera.lookAt(0, f[0], 0);
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL('image/png');
    },

    /* cb(dataUrl|null). Missing models and a missing GPU give null (the card keeps its icon). */
    request: function (item, cb) {
      if (this.cache[item.key] !== undefined) { cb(this.cache[item.key]); return; }
      if (!(item.slot === 'outfit' || (item.node && SE.Assets && SE.Assets.has(item.node)))) { cb(null); return; }
      this.queue.push({ item: item, cb: cb });
      this.schedule();
    },

    /* A full-body skin: load its GLB on demand, render the model alone, then cache the picture.
       Until it resolves (or when the file does not exist yet) the card keeps its placeholder. */
    renderSkin: function (item, cb) {
      var self = this, node = 'Skin_' + item.id.replace(/^skin_/, '');
      SE.Assets.ensure('skins/' + item.id).then(function (ok) {
        var url = null;
        if (ok && SE.Assets.has(node)) { try { url = self.drawNode(node); } catch (err) { url = null; } }
        if (url) self.cache[item.key] = url;
        cb(url);
      });
    },

    drawNode: function (node) {
      if (!this.init()) return null;
      if (!this.skinMat) this.skinMat = SE.Assets.material({ rim: 0.18 });
      var obj = SE.Assets.clone(node, this.skinMat);
      this.api.group.visible = false;
      this.scene.add(obj);
      var box = visibleBox(obj);
      var url = null;
      if (box) {
        var h = Math.max(0.5, box.max.y - box.min.y), cy = (box.max.y + box.min.y) / 2;
        var d = (Math.max(h, (box.max.x - box.min.x) * 1.1) * 0.62) / Math.tan(13 * Math.PI / 180);
        this.camera.position.set(Math.sin(0.5) * d, cy + d * 0.1, Math.cos(0.5) * d);
        this.camera.lookAt(0, cy, 0);
        this.renderer.render(this.scene, this.camera);
        url = this.renderer.domElement.toDataURL('image/png');
      }
      this.scene.remove(obj);
      this.api.group.visible = true;
      return url;
    },

    schedule: function () {
      var self = this;
      if (this.scheduled) return;
      this.scheduled = true;
      requestAnimationFrame(function () { self.scheduled = false; self.step(); });
    },

    step: function () {
      var n = 0;
      while (this.queue.length && n < 3) {
        var job = this.queue.shift();
        if (job.item.skinItem) { this.renderSkin(job.item, job.cb); n++; continue; }
        var url = this.cache[job.item.key];
        if (url === undefined) {
          try { url = this.render(job.item); } catch (err) { url = null; }
          this.cache[job.item.key] = url;
        }
        job.cb(url);
        n++;
      }
      if (this.queue.length) this.schedule();
    }
  };

  /* 2D icon of an aura / victory effect (FX agent draws it; a coloured fallback keeps cards readable). */
  function drawEffectIcon(kind, item, canvas) {
    var ok = false;
    try { ok = !!(SE.FX && SE.FX.drawIcon && SE.FX.drawIcon(kind, item.id, canvas)); } catch (err) { ok = false; }
    if (ok) return;
    var g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    var cols = item.colors && item.colors.length ? item.colors : ['#ffe27a', '#ff7bd8', '#7fd6ff'];
    g.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2;
    var glow = g.createRadialGradient(cx, cy, w * 0.05, cx, cy, w * 0.46);
    glow.addColorStop(0, cols[0]); glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, w * 0.46, 0, Math.PI * 2); g.fill();
    for (var i = 0; i < 9; i++) {
      var a = i / 9 * Math.PI * 2 + (kind === 'victory' ? 0.3 : 0);
      var r = w * (kind === 'victory' ? 0.22 + (i % 3) * 0.09 : 0.3);
      g.fillStyle = cols[i % cols.length];
      g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, w * 0.045, 0, Math.PI * 2); g.fill();
    }
  }

  /* ---------------- helpers for the UI ---------------- */
  function itemName(item) {
    if (!item) return '';
    var n = item.name;
    if (n && typeof n === 'object') return n[SE.I18N.lang] || n.en || n.ru || item.id;
    return n || item.id;
  }

  function stars(rarity) {
    var out = '<span class="wd-stars" aria-hidden="true">';
    for (var i = 0; i <= Math.min(rarity, 4); i++) out += '<i></i>';
    return out + '</span>';
  }

  /* ---------------- shop ---------------- */
  var Shop = {
    TABS: TABS, TAB_ICON: TAB_ICON, GEM_PRICE: GEM_PRICE, CASH_PRICE: CASH_PRICE, AD_VIEWS: AD_VIEWS, cashMode: cashMode,
    tab: 'outfit', sel: {}, p: null, tickTimer: null, lastAdState: null,
    Preview: Preview, Thumbs: Thumbs, itemName: itemName, stars: stars, rarityOf: rarityOf, hash: hash,

    /* ---------- catalogue ---------- */
    all: function (slot) { return catalog(slot).all; },
    items: function (slot) { return catalog(slot).shop; },
    skins: function () { return catalog('outfit').skins; },
    find: findItem,
    exclusives: function () { return catalog('outfit').all.filter(function (it) { return it.exclusive; }); },
    lookFor: lookFor,
    owned: function (item) { return item.starter || SE.State.ownsCosmetic(item.slot, item.id); },
    equippedId: function (slot) { return SE.State.equippedCosmetic(slot); },
    status: function (item) {
      if (SE.State.equippedCosmetic(item.slot) === item.id) return 'equipped';
      if (this.owned(item)) return 'owned';
      return 'locked';
    },
    /* What an owned or unowned item is worth in gems (conversion of duplicates, prize balance). */
    gemValue: function (item) { return GEM_PRICE[item.rarity]; },
    dupeGems: function (item) { return Math.round(GEM_PRICE[item.rarity] * 0.5); },

    /* Deterministic pick of an unowned shop item (daily gift and wheel prizes). */
    pickItem: function (seed, minRarity, maxRarity, slots) {
      var pool = [];
      (slots || TABS).forEach(function (slot) {
        catalog(slot).shop.forEach(function (it) {
          if (it.rarity >= minRarity && it.rarity <= maxRarity && !Shop.owned(it)) pool.push(it);
        });
      });
      if (!pool.length) return null;
      return pool[hash(String(seed)) % pool.length];
    },

    /* ---------- applying the look to the player ---------- */
    currentLook: function () { return lookFor(SE.State.data.cosmetics.equipped); },
    applyEquipped: function () {
      var eq = SE.State.data.cosmetics.equipped;
      if (SE.Player && SE.Player.group) SE.Player.setLook(lookFor(eq));
      var aura = findItem('aura', eq.aura);
      if (SE.FX && SE.Player && SE.Player.group) SE.FX.setAura(aura ? aura.id : null, SE.Player.group);
    },
    equippedVictory: function () {
      var v = findItem('victory', SE.State.equippedCosmetic('victory'));
      return v ? v.id : null;
    },

    /* ---------- actions ---------- */
    grant: function (item, silent) {
      if (!item || item.starter) return false;
      SE.State.grantCosmetic(item.slot, item.id);
      if (!silent) {
        SE.Audio.play('buy', { volume: 0.7 });
        if (SE.FX && SE.Player) SE.FX.burst('buy', SE.Player.pos);
        SE.UI.toast(SE.t('shop.unlocked', itemName(item)), 'good');
      }
      return true;
    },

    equip: function (item) {
      if (!item || !this.owned(item)) return false;
      SE.State.setEquippedCosmetic(item.slot, item.id);
      this.applyEquipped();
      SE.Audio.play('equip', { volume: 0.6 });
      if (SE.FX && SE.Player) SE.FX.burst('equip', SE.Player.pos);
      SE.State.save();
      return true;
    },

    unequip: function (slot) {
      if (slot === 'outfit') return false;
      SE.State.setEquippedCosmetic(slot, null);
      this.applyEquipped();
      SE.Audio.play('equip', { volume: 0.4 });
      SE.State.save();
      return true;
    },

    buy: function (item) {
      if (!item || this.owned(item)) return false;
      var price = item.mode === 'gems' ? item.price : (item.mode === 'ads' && item.altPrice) || 0;
      if (!price) return false;
      if (!canPay(price)) {
        SE.Audio.play('error', { volume: 0.5 });
        SE.UI.toast(SE.t(cashMode() ? 'shop.notEnoughCash' : 'shop.notEnoughGems'), 'error');
        return false;
      }
      pay(price);
      this.grant(item);
      this.equip(item);
      SE.UI.updateHUD();
      SE.State.save();
      /* a purchase for currency is an interstitial point (Playables); the effect plays first */
      SE.Tasks.timeout(function () { SE.Ads.breakPoint('buy:' + item.slot); }, 900);
      return true;
    },

    /* One confirmed rewarded view towards an item; the last view unlocks it. */
    watch: function (item, done) {
      var self = this;
      if (!item || item.mode !== 'ads' || this.owned(item)) { if (done) done(false); return; }
      SE.Ads.watch(SE.Ads.IDS.shopUnlock, function () {
        var key = item.slot + ':' + item.id, v = SE.State.data.cosmetics.views;
        v[key] = (v[key] || 0) + 1;
        if (v[key] >= item.views) { self.grant(item); self.equip(item); }
        else { SE.Audio.play('reward', { volume: 0.6 }); SE.UI.toast(SE.t('shop.progress', v[key], item.views), 'good'); }
        SE.State.save();
      }, function (ok) { if (done) done(ok); });
    },

    /* ---------- panel ---------- */
    onClose: function () {
      Preview.detach();
      if (this.tickTimer) { SE.Tasks.clear(this.tickTimer); this.tickTimer = null; }
      this.sel = {};
    },

    previewEquipped: function () {
      var eq = Object.assign({}, SE.State.data.cosmetics.equipped);
      Object.keys(this.sel).forEach(function (slot) { eq[slot] = Shop.sel[slot]; });
      return eq;
    },

    updatePreview: function () {
      Preview.setLook(lookFor(this.previewEquipped()));
      this.updateCaption();
    },

    render: function (p) {
      var self = this;
      this.p = p;
      if (!p.head.querySelector('.wd-gems')) {
        var pill = U.el('div', 'wd-gems stroke');
        p.head.insertBefore(pill, p.head.querySelector('.close-btn'));
      }
      p.body.innerHTML = '';
      var layout = U.el('div', 'wd-layout');
      layout.innerHTML =
        '<section class="wd-stage">' +
          '<div class="wd-stage-view"><div class="wd-glow"></div><div class="wd-host"></div><div class="wd-effect"></div></div>' +
          '<div class="wd-caption"></div>' +
          '<button class="btn gold wd-super" type="button"></button>' +
        '</section>' +
        '<section class="wd-shelf">' +
          '<div class="wd-tabs" role="tablist"></div>' +
          '<div class="wd-notice"></div>' +
          '<div class="wd-grid"></div>' +
        '</section>';
      p.body.appendChild(layout);
      var superBtn = layout.querySelector('.wd-super');
      superBtn.innerHTML = SE.Icons.html('chest') + '<span>' + SE.t('ui.super') + '</span>';
      superBtn.addEventListener('click', function () { SE.Audio.play('click', { volume: 0.4 }); SE.UI.open('super'); });
      var tabs = layout.querySelector('.wd-tabs');
      TABS.forEach(function (slot) {
        var b = U.el('button', 'wd-tab' + (slot === self.tab ? ' on' : ''));
        b.setAttribute('role', 'tab');
        b.dataset.slot = slot;
        b.innerHTML = '<span class="wd-tab-ic">' + SE.Icons.html(TAB_ICON[slot]) + '</span><span class="wd-tab-name">' + SE.t('tab.' + slot) + '</span>';
        b.addEventListener('click', function () {
          if (self.tab === slot) return;
          SE.Audio.play('click', { volume: 0.4 });
          self.tab = slot; self.sel = {};
          U.$$('.wd-tab', tabs).forEach(function (t) { t.classList.toggle('on', t.dataset.slot === slot); });
          self.renderGrid(true);
          self.updatePreview();
        });
        tabs.appendChild(b);
      });
      this.sel = {};
      this.renderGrid(true);
      this.updateGems();
      SE.State.data.flags.shopSeen = true;
      var host = layout.querySelector('.wd-host');
      Preview.look = lookFor(SE.State.data.cosmetics.equipped);
      requestAnimationFrame(function () {
        if (SE.UI.current !== 'wardrobe') return;
        if (!Preview.attach(host)) host.classList.add('no-3d');
        Preview.setLook(lookFor(self.previewEquipped()));
        Preview.resize();
      });
      this.updateCaption();
      this.lastAdState = SE.Ads.available();
      if (this.tickTimer) SE.Tasks.clear(this.tickTimer);
      this.tickTimer = SE.Tasks.timeout(function () { self.tick(); }, 800);
    },

    tick: function () {
      var self = this;
      this.tickTimer = null;
      if (SE.UI.current !== 'wardrobe') return;
      var av = SE.Ads.available();
      /* with cash prices the income keeps changing what the player can afford */
      var aff = cashMode() ? this.affordable() : 0;
      if (av !== this.lastAdState || aff !== this.lastAfford) { this.lastAdState = av; this.lastAfford = aff; this.renderGrid(false); }
      if (cashMode()) this.updateGems();
      this.tickTimer = SE.Tasks.timeout(function () { self.tick(); }, 800);
    },

    updateGems: function () {
      if (!this.p) return;
      var pill = this.p.head.querySelector('.wd-gems');
      if (!pill) return;
      pill.classList.toggle('cash', cashMode());
      pill.innerHTML = cashMode() ? SE.Icons.html('banknotes') + '<span>' + U.money(SE.State.data.money) + '</span>' :
        SE.Icons.html('gem') + '<span>' + U.shortNum(SE.State.data.gems) + '</span>';
    },

    /* How many locked items of the open tab the player can pay for right now. */
    affordable: function () {
      var n = 0, self = this;
      this.all(this.tab).forEach(function (it) {
        if (self.owned(it)) return;
        var price = it.mode === 'gems' ? it.price : (it.mode === 'ads' && it.altPrice) || 0;
        if (price && canPay(price)) n++;
      });
      return n;
    },

    updateCaption: function () {
      if (!this.p) return;
      var cap = this.p.body.querySelector('.wd-caption');
      var fx = this.p.body.querySelector('.wd-effect');
      var glow = this.p.body.querySelector('.wd-glow');
      if (!cap) return;
      var slot = this.tab;
      var id = this.sel[slot] !== undefined ? this.sel[slot] : SE.State.equippedCosmetic(slot);
      var item = findItem(slot, id);
      var rarity = item ? item.rarity : 0;
      var rc = SE.Pets.RARITIES[rarity];
      if (!item) {
        cap.innerHTML = '<div class="wd-cap-name stroke">' + SE.t('tab.' + slot) + '</div><div class="wd-cap-sub">' + SE.t('shop.cosmeticOnly') + '</div>';
      } else {
        var st = this.status(item), note;
        if (st === 'equipped') note = SE.t('btn.equipped');
        else if (st === 'owned') note = SE.t('shop.owned');
        else if (item.mode === 'gems') note = SE.t('shop.buyFor', priceText(item.price));
        else note = SE.t('shop.progress', SE.State.cosmeticViews(slot, item.id), item.views);
        cap.innerHTML = '<div class="wd-cap-name stroke">' + itemName(item) + '</div>' +
          '<div class="wd-cap-row">' + stars(rarity) + '<span class="wd-cap-rar" style="color:' + rc.color + '">' + SE.t(rc.key) + '</span></div>' +
          '<div class="wd-cap-sub">' + note + '</div>';
      }
      glow.style.background = '';
      glow.style.setProperty('--glow', item && item.colors ? item.colors[0] : rc.color);
      fx.innerHTML = '';
      if ((slot === 'aura' || slot === 'victory') && item) {
        var c = U.canvas(128, 128);
        drawEffectIcon(slot, item, c);
        c.className = 'wd-effect-icon';
        fx.appendChild(c);
      }
      this.updateGems();
    },

    noteFor: function (slot) {
      var any = this.items(slot).some(function (it) { return it.mode === 'ads'; });
      if (!any || SE.Ads.available()) return '';
      if (SE.rule('adFailToast', true) === false) return '';   /* Poki: no custom ad / ad-blocker notices */
      return SE.Ads.explain() || SE.t('ad.unavailableNow');
    },

    renderGrid: function (resetScroll) {
      var self = this, p = this.p;
      if (!p) return;
      var grid = p.body.querySelector('.wd-grid');
      var notice = p.body.querySelector('.wd-notice');
      var scroll = resetScroll ? 0 : grid.scrollTop;
      grid.innerHTML = '';
      var slot = this.tab;
      var note = this.noteFor(slot);
      notice.textContent = note;
      notice.classList.toggle('show', !!note);
      var optional = slot !== 'outfit';
      var list = [];
      if (slot === 'outfit') list.push.apply(list, this.all('outfit').filter(function (it) { return it.starter; }));
      list.push.apply(list, this.items(slot));
      if (!list.length) {
        grid.appendChild(U.el('div', 'wd-empty stroke', SE.t('shop.empty')));
        return;
      }
      if (optional) grid.appendChild(this.noneCard(slot));
      if (slot === 'outfit' && this.skins().length) {
        grid.appendChild(U.el('div', 'wd-section brainrot',
          '<span class="wd-section-t stroke">' + SE.t('shop.brainrot') + '</span><span class="wd-section-s">' + SE.t('shop.brainrotSub') + '</span>'));
        this.skins().forEach(function (item) { grid.appendChild(self.card(item)); });
        grid.appendChild(U.el('div', 'wd-section plain', '<span class="wd-section-t stroke">' + SE.t('tab.outfit') + '</span>'));
      }
      list.forEach(function (item) { grid.appendChild(self.card(item)); });
      grid.scrollTop = scroll;
    },

    selected: function (item) {
      var s = this.sel[item.slot];
      return s !== undefined && s === item.id;
    },

    noneCard: function (slot) {
      var self = this;
      var equipped = SE.State.equippedCosmetic(slot) === null;
      var el = U.el('div', 'wd-card wd-none is-' + (equipped ? 'equipped' : 'owned') + (this.sel[slot] === null ? ' sel' : ''));
      el.innerHTML = '<div class="wd-thumb"><span class="wd-none-ic">' + SE.Icons.html('close') + '</span></div>' +
        '<div class="wd-name">' + SE.t('shop.none.' + slot) + '</div>';
      var b = U.el('button', 'btn wd-act ' + (equipped ? 'grey' : ''), equipped ? SE.t('btn.equipped') : SE.t('btn.equip'));
      b.disabled = equipped;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        self.unequip(slot);
        delete self.sel[slot];
        self.renderGrid(false); self.updatePreview();
      });
      el.addEventListener('click', function () { self.sel[slot] = null; self.renderGrid(false); self.updatePreview(); });
      el.appendChild(b);
      return el;
    },

    card: function (item) {
      var self = this;
      var st = this.status(item);
      var rc = SE.Pets.RARITIES[item.rarity];
      var el = U.el('div', 'wd-card r' + item.rarity + ' is-' + st + (item.skinItem ? ' skin mythic' : '') + (this.selected(item) ? ' sel' : ''));
      el.style.setProperty('--rc', rc.color);
      el.style.setProperty('--rc2', rc.color2);
      var thumb = U.el('div', 'wd-thumb');
      var effect = item.slot === 'aura' || item.slot === 'victory';
      if (!effect) thumb.innerHTML = '<span class="wd-thumb-fallback">' + SE.Icons.html(TAB_ICON[item.slot]) + '</span>';
      el.appendChild(thumb);
      var badge = U.el('span', 'wd-badge');
      if (st === 'equipped') badge.innerHTML = SE.Icons.html('check');
      else if (st === 'locked') badge.innerHTML = SE.Icons.html('lock');
      el.appendChild(U.el('div', 'wd-name', '<span>' + itemName(item) + '</span>'));

      /* thumbnail: 3D render for outfits / hats / faces / backs, 2D icon for auras and victories */
      if (effect) {
        var c = U.canvas(112, 112);
        c.className = 'wd-icon';
        drawEffectIcon(item.slot, item, c);
        thumb.appendChild(c);
      }
      if (st !== 'owned') thumb.appendChild(badge);
      thumb.insertAdjacentHTML('beforeend', stars(item.rarity));
      if (!effect) {
        Thumbs.request(item, function (url) {
          if (!url) return;
          var img = new Image();
          img.alt = ''; img.draggable = false; img.className = 'wd-img';
          img.src = url;
          var fb = thumb.querySelector('.wd-thumb-fallback');
          if (fb) fb.remove();
          thumb.insertBefore(img, thumb.firstChild);
        });
      }

      var btn;
      if (st === 'equipped') {
        btn = U.el('button', 'btn wd-act grey', SE.t('btn.equipped'));
        btn.disabled = true;
      } else if (st === 'owned') {
        btn = U.el('button', 'btn wd-act', SE.t('btn.equip'));
      } else if (item.mode === 'gems') {
        var can = canPay(item.price);
        btn = U.el('button', 'btn wd-act gold' + (can ? '' : ' short'), priceHtml(item.price));
      } else {
        var done = SE.State.cosmeticViews(item.slot, item.id);
        var pips = '<span class="wd-pips">';
        for (var i = 0; i < item.views; i++) pips += '<i class="' + (i < done ? 'on' : '') + '"></i>';
        pips += '</span>';
        el.insertBefore(U.el('div', 'wd-progress', pips), el.querySelector('.wd-name').nextSibling);
        btn = SE.Ads.button(SE.Ads.IDS.shopUnlock, {
          cls: 'btn wd-act ad',
          html: SE.Icons.html('watch-video') + '<span>' + (item.views === 1 ? SE.t('btn.watch') : SE.t('shop.watch', done, item.views)) + '</span>',
          onClick: function () {
            self.sel[item.slot] = item.id;
            self.watch(item, function () { delete self.sel[item.slot]; self.renderGrid(false); self.updatePreview(); });
          }
        });
        /* alternative to watching: the same item for gems (CrazyGames) or cash (Poki) */
        if (item.altPrice) {
          var row = U.el('div', 'wd-act-row');
          var canAlt = canPay(item.altPrice);
          var alt = U.el('button', 'btn wd-act gold' + (canAlt ? '' : ' short'), priceHtml(item.altPrice));
          alt.addEventListener('click', function (e) {
            e.stopPropagation();
            self.sel[item.slot] = item.id;
            self.buy(item); delete self.sel[item.slot]; self.renderGrid(false); self.updatePreview();
          });
          if (SE.rule('standardFirst', false)) { row.appendChild(alt); row.appendChild(btn); }
          else { row.appendChild(btn); row.appendChild(alt); }
          btn = row;
        }
      }
      if (item.mode !== 'ads' || st !== 'locked') btn.addEventListener('click', function (e) {
        e.stopPropagation();
        self.sel[item.slot] = item.id;
        if (st === 'owned') { self.equip(item); delete self.sel[item.slot]; self.renderGrid(false); self.updatePreview(); }
        else if (item.mode === 'gems') { self.buy(item); delete self.sel[item.slot]; self.renderGrid(false); self.updatePreview(); }
      });
      el.appendChild(btn);
      el.addEventListener('click', function () {
        SE.Audio.play('click', { volume: 0.3 });
        self.sel[item.slot] = item.id;
        self.renderGrid(false);
        self.updatePreview();
      });
      return el;
    }
  };

  SE.Preview = Preview;
  SE.Thumbs = Thumbs;
  SE.Shop = Shop;
})(window);
