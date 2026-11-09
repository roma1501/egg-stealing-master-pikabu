/* =========================================================
   Экономика: состояние, сохранения, бусты, апгрейды
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U;

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function nonNegative(value, fallback) {
    return typeof value === 'number' && isFinite(value) && value >= 0 ? value : fallback;
  }

  function validPet(id) {
    var pet = typeof id === 'string' && SE.Pets.get(id);
    return !!pet && pet.id === id;
  }

  function validEgg(egg) {
    if (!record(egg) || typeof egg.rarity !== 'number' || egg.rarity % 1 !== 0 || !SE.Pets.RARITIES[egg.rarity]) return false;
    return SE.Pets.BIOMES.some(function (b) { return b.id === egg.biome; });
  }

  var TRAILS = [
    { id: 'none',    key: 'trail.none',    price: 0,          mult: 1,   color: '#ffffff' },
    { id: 'green',   key: 'trail.green',   price: 5000,       mult: 2,   color: '#4ade4a' },
    { id: 'blue',    key: 'trail.blue',    price: 75000,      mult: 2.5, color: '#3a8ef6' },
    { id: 'purple',  key: 'trail.purple',  price: 1500000,    mult: 3.5, color: '#c04fff' },
    { id: 'gold',    key: 'trail.gold',    price: 40000000,   mult: 5,   color: '#ffd24a' },
    { id: 'rainbow', key: 'trail.rainbow', price: 900000000,  mult: 8,   color: '#ff6ad5' }
  ];

  var DEFAULT_STATE = {
    version: 1,
    money: 400,
    speed: 20,
    totalEarned: 400,
    score: 0,
    gems: 0,
    adBreak: { rounds: 0 },
    pens: [],
    inventory: [],
    equipped: [],
    zones: [true, false, false, false, false, false],
    trail: 'none',
    trailsOwned: ['none'],
    index: {},
    stats: { steals: 0, catches: 0, wins: 0, losses: 0, hatched: 0, sold: 0 },
    daily: { lastClaim: 0, streak: 0, lastClaimDay: '' },
    wheel: { freeDay: '', adDay: '', adSpins: 0, spins: 0 },
    cosmetics: { owned: {}, equipped: {}, views: {} },
    superRewards: { egg: 0, gems: 0, rush: 0, done: { egg: 0, gems: 0, rush: 0 } },
    flags: { shopSeen: false },
    settings: { sfx: true, music: true, quality: 'high', shadows: true },
    tutorialDone: false,
    savedAt: 0,
    lastSeen: 0
  };

  var State = {
    data: null,
    MAX_EQUIP: 8,
    TRAILS: TRAILS,
    SLOTS: ['outfit', 'hat', 'face', 'back', 'aura', 'victory'],

    /* Device calendar day, e.g. 2026-10-09. Daily Gift and the free wheel spin use it. */
    dayKey: function (date) {
      var d = date || new Date();
      function two(n) { return (n < 10 ? '0' : '') + n; }
      return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
    },
    today: function () { return this.dayKey(new Date()); },
    /* Accepts a YYYY-MM-DD key or an old Date#toDateString() value; anything else becomes ''. */
    normalizeDay: function (value) {
      if (typeof value !== 'string' || !value) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      var t = Date.parse(value);
      return isFinite(t) ? this.dayKey(new Date(t)) : '';
    },

    create: function () {
      var d = JSON.parse(JSON.stringify(DEFAULT_STATE));
      d.pens = [];
      for (var i = 0; i < 8; i++) {
        d.pens.push({ unlocked: i === 0, egg: null, pet: null, hatchAt: 0, duration: 0 });
      }
      d.lastSeen = Date.now();
      return d;
    },

    load: function () {
      var self = this;
      return SE.Platform.load().then(function (saved) {
        return SE.Tasks.active().then(function () { return saved; });
      }).then(function (saved) {
        if (record(saved)) {
          self.data = self.migrate(saved);
        } else {
          self.data = self.migrate(self.create());
        }
        return self.data;
      });
    },

    migrate: function (s) {
      var base = this.create();
      if (!record(s)) return base;
      var oldTutorial = nonNegative(s.tutorial, 0);
      for (var k in base) {
        if (s[k] === undefined) s[k] = base[k];
      }
      ['money', 'speed', 'totalEarned', 'score', 'savedAt', 'lastSeen', 'gems'].forEach(function (key) {
        s[key] = nonNegative(s[key], base[key]);
      });
      s.gems = Math.floor(s.gems);
      s.speed = Math.max(20, s.speed);
      s.totalEarned = Math.max(s.totalEarned, s.money);
      if (!record(s.settings)) s.settings = base.settings;
      for (var k2 in base.settings) {
        if (s.settings[k2] === undefined) s.settings[k2] = base.settings[k2];
      }
      ['sfx', 'music', 'shadows'].forEach(function (key) {
        if (typeof s.settings[key] !== 'boolean') s.settings[key] = base.settings[key];
      });
      if (['low', 'medium', 'high'].indexOf(s.settings.quality) < 0) s.settings.quality = 'high';
      delete s.settings.lang;
      if (!record(s.stats)) s.stats = base.stats;
      for (var k3 in base.stats) {
        s.stats[k3] = Math.floor(nonNegative(s.stats[k3], base.stats[k3]));
      }
      /* Interstitial cadence: completed rounds since the last ad (old saves counted wins only). */
      var oldBreak = record(s.adBreak) ? s.adBreak : {};
      s.adBreak = { rounds: Math.min(2, Math.floor(nonNegative(oldBreak.rounds, nonNegative(oldBreak.successes, 0)))) };
      /* Tutorial: the old numeric step is replaced by tutorialDone inside the main save. */
      s.tutorialDone = s.tutorialDone === true || oldTutorial >= 4 || s.stats.wins > 0 || s.stats.steals > 0;
      delete s.tutorial;
      /* Daily Gift: lastClaimDay is a device-calendar key YYYY-MM-DD. */
      if (!record(s.daily)) s.daily = base.daily;
      s.daily.lastClaim = nonNegative(s.daily.lastClaim, 0);
      s.daily.streak = Math.floor(nonNegative(s.daily.streak, 0));
      s.daily.lastClaimDay = this.normalizeDay(s.daily.lastClaimDay);
      /* Wheel of Fortune. */
      if (!record(s.wheel)) s.wheel = base.wheel;
      s.wheel.freeDay = this.normalizeDay(s.wheel.freeDay);
      s.wheel.adDay = this.normalizeDay(s.wheel.adDay);
      s.wheel.adSpins = Math.min(9, Math.floor(nonNegative(s.wheel.adSpins, 0)));
      s.wheel.spins = Math.floor(nonNegative(s.wheel.spins, 0));
      /* Cosmetics: owned lists, equipped ids, rewarded-ad view progress. */
      var cos = record(s.cosmetics) ? s.cosmetics : {};
      var owned = record(cos.owned) ? cos.owned : {}, equipped = record(cos.equipped) ? cos.equipped : {};
      var views = record(cos.views) ? cos.views : {};
      s.cosmetics = { owned: {}, equipped: {}, views: {} };
      this.SLOTS.forEach(function (slot) {
        var list = Array.isArray(owned[slot]) ? owned[slot] : [];
        s.cosmetics.owned[slot] = list.filter(function (id, i) {
          return typeof id === 'string' && id && list.indexOf(id) === i;
        });
        if (slot === 'outfit' && s.cosmetics.owned.outfit.indexOf('starter') < 0) s.cosmetics.owned.outfit.unshift('starter');
        var eq = equipped[slot];
        s.cosmetics.equipped[slot] = typeof eq === 'string' && s.cosmetics.owned[slot].indexOf(eq) >= 0
          ? eq : (slot === 'outfit' ? 'starter' : null);
      });
      Object.keys(views).forEach(function (key) {
        var n = Math.floor(nonNegative(views[key], 0));
        if (n > 0 && n < 99 && /^[a-z]+:[\w.-]+$/.test(key)) s.cosmetics.views[key] = n;
      });
      /* Super Rewards: confirmed rewarded views per track (0..4) and how many prizes were claimed. */
      var sr = record(s.superRewards) ? s.superRewards : {};
      var srDone = record(sr.done) ? sr.done : {};
      s.superRewards = { done: {} };
      ['egg', 'gems', 'rush'].forEach(function (t) {
        s.superRewards[t] = Math.min(4, Math.floor(nonNegative(sr[t], 0)));
        s.superRewards.done[t] = Math.min(9999, Math.floor(nonNegative(srDone[t], 0)));
      });
      if (!record(s.flags)) s.flags = base.flags;
      s.flags.shopSeen = s.flags.shopSeen === true;

      var seen = Object.create(null);
      s.inventory = (Array.isArray(s.inventory) ? s.inventory : []).filter(function (item) {
        if (!record(item) || !validPet(item.petId)) return false;
        if (typeof item.uid !== 'string' || !item.uid || seen[item.uid]) {
          item.uid = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2);
        }
        seen[item.uid] = true;
        return true;
      });
      var equipped = [];
      (Array.isArray(s.equipped) ? s.equipped : []).forEach(function (uid) {
        if (seen[uid] && equipped.indexOf(uid) < 0 && equipped.length < 8) equipped.push(uid);
      });
      s.equipped = equipped;
      var oldIndex = record(s.index) ? s.index : {};
      s.index = {};
      Object.keys(oldIndex).forEach(function (id) {
        if (validPet(id) && nonNegative(oldIndex[id], 0) > 0) s.index[id] = Math.floor(oldIndex[id]);
      });
      s.inventory.forEach(function (item) { s.index[item.petId] = Math.max(1, s.index[item.petId] || 0); });

      var pens = Array.isArray(s.pens) ? s.pens : [];
      s.pens = base.pens.map(function (fallback, i) {
        var p = record(pens[i]) ? pens[i] : fallback;
        p.unlocked = i === 0 || p.unlocked === true;
        p.pet = validPet(p.pet) ? p.pet : null;
        p.egg = !p.pet && validEgg(p.egg) ? p.egg : null;
        if (p.pet || p.egg) p.unlocked = true;
        p.duration = p.egg ? SE.Pets.hatchTime(p.egg) : 0;
        p.hatchAt = p.egg ? nonNegative(p.hatchAt, Date.now() + p.duration * 1000) : 0;
        if (p.egg && !p.egg.uid) p.egg.uid = 'e' + Date.now().toString(36) + i;
        return p;
      });
      var zones = Array.isArray(s.zones) ? s.zones : [];
      s.zones = base.zones.map(function (unlocked, i) { return i === 0 || zones[i] === true; });
      var owned = Array.isArray(s.trailsOwned) ? s.trailsOwned : [];
      s.trailsOwned = TRAILS.filter(function (trail) { return trail.id === 'none' || owned.indexOf(trail.id) >= 0; }).map(function (trail) { return trail.id; });
      if (s.trailsOwned.indexOf(s.trail) < 0) s.trail = 'none';
      return s;
    },

    save: function () {
      if (!this.data) return;
      this.data.savedAt = Date.now();
      this.data.lastSeen = Date.now();
      return SE.Platform.save(this.data);
    },

    /* ---------- деньги ---------- */
    addMoney: function (n) {
      if (typeof n !== 'number' || !isFinite(n)) return false;
      this.data.money += n;
      if (n > 0) this.data.totalEarned += n;
      if (this.data.money < 0) this.data.money = 0;
      return true;
    },

    canAfford: function (n) { return typeof n === 'number' && isFinite(n) && n >= 0 && this.data.money >= n; },

    spend: function (n) {
      if (!this.canAfford(n)) return false;
      this.data.money -= n;
      return true;
    },

    /* ---------- gems (cosmetic currency) ---------- */
    addGems: function (n) {
      n = Math.floor(n);
      if (!isFinite(n) || n <= 0) return false;
      this.data.gems += n;
      return true;
    },
    canAffordGems: function (n) { return typeof n === 'number' && isFinite(n) && n >= 0 && this.data.gems >= n; },
    spendGems: function (n) {
      if (!this.canAffordGems(n)) return false;
      this.data.gems -= n;
      return true;
    },

    /* ---------- cosmetics ---------- */
    ownsCosmetic: function (slot, id) {
      var list = this.data.cosmetics.owned[slot];
      return !!list && list.indexOf(id) >= 0;
    },
    grantCosmetic: function (slot, id) {
      var list = this.data.cosmetics.owned[slot];
      if (!list || typeof id !== 'string' || !id) return false;
      if (list.indexOf(id) < 0) list.push(id);
      delete this.data.cosmetics.views[slot + ':' + id];
      return true;
    },
    equippedCosmetic: function (slot) {
      var id = this.data.cosmetics.equipped[slot];
      return id === undefined ? null : id;
    },
    setEquippedCosmetic: function (slot, id) {
      if (id !== null && !this.ownsCosmetic(slot, id)) return false;
      this.data.cosmetics.equipped[slot] = id;
      return true;
    },
    cosmeticViews: function (slot, id) { return this.data.cosmetics.views[slot + ':' + id] || 0; },

    /* ---------- доход ---------- */
    incomePerSec: function (boosts) {
      var sum = 0;
      var eq = this.data.equipped;
      for (var i = 0; i < this.data.inventory.length; i++) {
        var item = this.data.inventory[i];
        var def = SE.Pets.get(item.petId);
        if (!def) continue;
        var isEq = eq.indexOf(item.uid) >= 0;
        sum += def.income * (isEq ? 1 : 0.1);
      }
      if (boosts && boosts.isActive('goldenRush')) sum *= 3;
      else if (boosts && boosts.isActive('x2income')) sum *= 2;
      return sum;
    },

    /* ---------- питомцы ---------- */
    addPet: function (petId) {
      if (!validPet(petId)) return null;
      var uid = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      this.data.inventory.push({ petId: petId, uid: uid });
      var isNew = !this.data.index[petId];
      this.data.index[petId] = (this.data.index[petId] || 0) + 1;
      if (this.data.equipped.length < this.MAX_EQUIP) this.data.equipped.push(uid);
      return { uid: uid, isNew: isNew };
    },

    removePet: function (uid) {
      for (var i = 0; i < this.data.inventory.length; i++) {
        if (this.data.inventory[i].uid === uid) {
          var it = this.data.inventory.splice(i, 1)[0];
          var e = this.data.equipped.indexOf(uid);
          if (e >= 0) this.data.equipped.splice(e, 1);
          return it;
        }
      }
      return null;
    },

    getPetItem: function (uid) {
      for (var i = 0; i < this.data.inventory.length; i++) {
        if (this.data.inventory[i].uid === uid) return this.data.inventory[i];
      }
      return null;
    },

    isEquipped: function (uid) { return this.data.equipped.indexOf(uid) >= 0; },

    equip: function (uid) {
      if (!this.getPetItem(uid)) return false;
      if (this.isEquipped(uid)) return true;
      if (this.data.equipped.length >= this.MAX_EQUIP) return false;
      this.data.equipped.push(uid);
      return true;
    },

    unequip: function (uid) {
      var i = this.data.equipped.indexOf(uid);
      if (i >= 0) this.data.equipped.splice(i, 1);
    },

    equipBest: function () {
      var self = this;
      var sorted = this.data.inventory.slice().sort(function (a, b) {
        var pa = SE.Pets.get(a.petId), pb = SE.Pets.get(b.petId);
        return (pb ? pb.income : 0) - (pa ? pa.income : 0);
      });
      this.data.equipped = [];
      for (var i = 0; i < Math.min(this.MAX_EQUIP, sorted.length); i++) {
        this.data.equipped.push(sorted[i].uid);
      }
    },

    petValue: function (item) {
      var def = SE.Pets.get(item.petId);
      return def ? def.value : 0;
    },

    /* ---------- загоны ---------- */
    freePen: function () {
      for (var i = 0; i < this.data.pens.length; i++) {
        var p = this.data.pens[i];
        if (p.unlocked && !p.egg && !p.pet) return i;
      }
      return -1;
    },

    nextLockedPen: function () {
      for (var i = 0; i < this.data.pens.length; i++) {
        if (!this.data.pens[i].unlocked) return i;
      }
      return -1;
    },

    unlockPen: function (index) {
      var p = this.data.pens[index];
      if (!p || p.unlocked) return false;
      p.unlocked = true;
      return true;
    },

    placeEgg: function (penIndex, egg, boosts) {
      var p = this.data.pens[penIndex];
      if (!p || !p.unlocked || p.egg || p.pet || !validEgg(egg)) return false;
      var dur = SE.Pets.hatchTime(egg);
      p.egg = egg;
      p.duration = dur;
      p.hatchAt = Date.now() + dur * 1000;
      return true;
    },

    /* ---------- локации ---------- */
    zoneUnlocked: function (i) { return !!this.data.zones[i]; },

    unlockZone: function (i) {
      this.data.zones[i] = true;
    },

    highestZone: function () {
      var h = 0;
      for (var i = 0; i < this.data.zones.length; i++) if (this.data.zones[i]) h = i;
      return h;
    },

    /* ---------- трейлы ---------- */
    trailDef: function (id) {
      for (var i = 0; i < TRAILS.length; i++) if (TRAILS[i].id === id) return TRAILS[i];
      return TRAILS[0];
    },

    ownsTrail: function (id) { return this.data.trailsOwned.indexOf(id) >= 0; },

    /* ---------- очки ---------- */
    computeScore: function () {
      var unique = Object.keys(this.data.index).length;
      var s = Math.floor(this.data.totalEarned / 10) + unique * 500 + this.data.speed * 25
        + this.data.stats.wins * 50;
      this.data.score = Math.max(this.data.score, s);
      return this.data.score;
    }
  };

  /* ---------------- Бусты ---------------- */
  var Boosts = {
    active: {},

    activate: function (id, seconds) {
      var now = Date.now();
      var cur = this.active[id] || 0;
      this.active[id] = Math.max(cur, now) + seconds * 1000;
    },

    isActive: function (id) {
      return (this.active[id] || 0) > Date.now();
    },

    remaining: function (id) {
      return Math.max(0, ((this.active[id] || 0) - Date.now()) / 1000);
    },

    clear: function (id) { delete this.active[id]; },

    list: function () {
      var out = [];
      for (var k in this.active) {
        if (this.isActive(k)) out.push({ id: k, left: this.remaining(k) });
      }
      return out;
    }
  };

  SE.State = State;
  SE.Boosts = Boosts;
})(window);
