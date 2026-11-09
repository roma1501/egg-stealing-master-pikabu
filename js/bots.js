/* Local NPC players. Their eggs, pets and economy never touch the player's save. */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var T = global.THREE, M = SE.Models;
  var STEP = 2.2, RADIUS = 1.5, MIN_X = -110, MIN_Z = -282;
  var COLS = 101, ROWS = 175;
  var APPEARANCES = [
    { nameKey: 'bot.name.0', shirt: '#ee733d', pants: '#243d60', hair: '#563422', inner: '#fff0b7', hairStyle: 'spiky' },
    { nameKey: 'bot.name.1', shirt: '#ac57db', pants: '#28314f', hair: '#37272e', inner: '#ffdcec', hairStyle: 'long' },
    { nameKey: 'bot.name.2', shirt: '#32a79b', pants: '#263345', hair: '#d8ad50', inner: '#d2f5ef', hairStyle: 'swept' },
    { nameKey: 'bot.name.3', shirt: '#4272df', pants: '#333345', hair: '#d87832', inner: '#e7eaff', hairStyle: 'bob' }
  ];
  /* Visible bot text comes from i18n: bot.name.N and bot.status.<stage>. */

  function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function point(x, z) { return { x: x, z: z }; }
  function face(model, dx, dz, dt) {
    if (Math.abs(dx) + Math.abs(dz) < 0.0001) return;
    var yaw = model.group.rotation.y, target = Math.atan2(dx, dz);
    model.group.rotation.y = yaw + Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw)) * Math.min(1, dt * 12);
  }

  /* A shared, bounded navigation grid. Diagonal moves never cut fence corners. */
  function Navigator(world) {
    this.world = world;
    this.blocked = new Uint8Array(COLS * ROWS);
    this.cost = new Float32Array(COLS * ROWS);
    this.parent = new Int32Array(COLS * ROWS);
    this.visit = new Uint32Array(COLS * ROWS);
    this.closed = new Uint32Array(COLS * ROWS);
    this.stamp = 0;
    this.searches = 0;
    this.failures = 0;
    for (var z = 0; z < ROWS; z++) {
      for (var x = 0; x < COLS; x++) {
        this.blocked[z * COLS + x] = this.free(MIN_X + x * STEP, MIN_Z + z * STEP) ? 0 : 1;
      }
    }
  }
  Navigator.prototype.onGround = function (x, z) {
    if (Math.abs(x) < 105 && z >= -105 && z < 101) return true;
    if (Math.abs(x) < 12.5 && z >= -163 && z < -96) return true;
    return x * x + (z + 214) * (z + 214) < 58 * 58;
  };
  Navigator.prototype.free = function (x, z) {
    if (!this.onGround(x, z)) return false;
    var colliders = this.world.nearColliders ? this.world.nearColliders(x, z) : this.world.colliders;
    for (var i = 0; i < colliders.length; i++) {
      var c = colliders[i];
      if (!c.solid || c.topY < 0.25) continue;
      if (x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS) return false;
    }
    return true;
  };
  Navigator.prototype.clear = function (a, b) {
    var steps = Math.max(1, Math.ceil(distance(a, b) / 0.7));
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      if (!this.free(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  };
  Navigator.prototype.point = function (id) {
    return point(MIN_X + (id % COLS) * STEP, MIN_Z + Math.floor(id / COLS) * STEP);
  };
  Navigator.prototype.nearest = function (p, connect) {
    var cx = Math.round((p.x - MIN_X) / STEP), cz = Math.round((p.z - MIN_Z) / STEP);
    var best = -1, bestDistance = Infinity;
    for (var ring = 0; ring <= 7; ring++) {
      for (var z = cz - ring; z <= cz + ring; z++) {
        for (var x = cx - ring; x <= cx + ring; x++) {
          if (x < 0 || x >= COLS || z < 0 || z >= ROWS) continue;
          if (ring && x !== cx - ring && x !== cx + ring && z !== cz - ring && z !== cz + ring) continue;
          var id = z * COLS + x;
          if (this.blocked[id]) continue;
          var q = this.point(id), d = distance(p, q);
          if (d < bestDistance && (!connect || this.clear(p, q))) { best = id; bestDistance = d; }
        }
      }
      if (best !== -1) return best;
    }
    return -1;
  };
  Navigator.prototype.path = function (from, to) {
    this.searches++;
    if (this.free(to.x, to.z) && this.clear(from, to)) return [point(to.x, to.z)];
    var start = this.nearest(from, true), goal = this.nearest(to, false);
    if (start < 0 || goal < 0) { this.failures++; return null; }
    var stamp = ++this.stamp, heap = [], self = this;
    function heuristic(id) {
      var dx = Math.abs(id % COLS - goal % COLS), dz = Math.abs(Math.floor(id / COLS) - Math.floor(goal / COLS));
      return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz);
    }
    function push(id, score) {
      var entry = { id: id, score: score }, i = heap.length;
      heap.push(entry);
      while (i > 0) {
        var p = (i - 1) >> 1;
        if (heap[p].score <= score) break;
        heap[i] = heap[p]; i = p;
      }
      heap[i] = entry;
    }
    function pop() {
      var root = heap[0], last = heap.pop();
      if (heap.length) {
        var i = 0;
        while (true) {
          var left = i * 2 + 1, right = left + 1;
          if (left >= heap.length) break;
          var child = right < heap.length && heap[right].score < heap[left].score ? right : left;
          if (heap[child].score >= last.score) break;
          heap[i] = heap[child]; i = child;
        }
        heap[i] = last;
      }
      return root.id;
    }
    this.visit[start] = stamp; this.cost[start] = 0; this.parent[start] = -1;
    push(start, heuristic(start));
    var reached = false;
    while (heap.length) {
      var id = pop();
      if (this.closed[id] === stamp) continue;
      if (id === goal) { reached = true; break; }
      this.closed[id] = stamp;
      var gx = id % COLS, gz = Math.floor(id / COLS);
      for (var dz = -1; dz <= 1; dz++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          var nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nx >= COLS || nz < 0 || nz >= ROWS) continue;
          var next = nz * COLS + nx;
          if (this.blocked[next] || this.closed[next] === stamp) continue;
          if (dx && dz && (this.blocked[id + dx] || this.blocked[id + dz * COLS])) continue;
          var cost = this.cost[id] + (dx && dz ? Math.SQRT2 : 1);
          if (this.visit[next] === stamp && this.cost[next] <= cost) continue;
          this.visit[next] = stamp; this.cost[next] = cost; this.parent[next] = id;
          push(next, cost + heuristic(next));
        }
      }
    }
    if (!reached) { this.failures++; return null; }
    var raw = [], current = goal;
    while (current !== -1) { raw.push(this.point(current)); current = this.parent[current]; }
    raw.reverse();
    if (this.free(to.x, to.z) && this.clear(raw[raw.length - 1], to)) raw.push(point(to.x, to.z));
    /* Shortcuts are checked against the actual expanded colliders, not just cells. */
    var smooth = [], anchor = from, index = 0;
    while (index < raw.length) {
      var end = index;
      for (var j = index + 1; j < Math.min(raw.length, index + 28); j++) {
        if (!self.clear(anchor, raw[j])) break;
        end = j;
      }
      smooth.push(raw[end]); anchor = raw[end]; index = end + 1;
    }
    return smooth;
  };

  function setStage(bot, stage, timer) {
    bot.stage = stage; bot.timer = timer || 0; bot.labelText = '';
  }
  function detach(object) { if (object && object.parent) object.parent.remove(object); }
  function removePet(bot) {
    if (!bot.pet) return;
    var geometries = new Set();
    bot.pet.model.group.traverse(function (object) {
      if (object.geometry) geometries.add(object.geometry);
    });
    detach(bot.pet.model.group);
    /* Models share cached materials. Only the removed model's geometry is owned here. */
    geometries.forEach(function (geometry) { geometry.dispose(); });
    bot.pet = null;
    bot.pets = [];
  }

  var Bots = {
    list: [], scene: null, world: null, nav: null, elapsed: 0,

    init: function (scene, world) {
      if (this.list.length) return;
      this.scene = scene; this.world = world; this.nav = new Navigator(world);
      var forest = world.zones.filter(function (z) { return z.id === 'forest'; })[0];
      if (!forest || !world.botPlots || world.botPlots.length < 4) return;
      this.forest = forest;
      this.sell = world.interactables.filter(function (it) { return it.type === 'sell'; })[0];
      this.treadmill = world.interactables.filter(function (it) { return it.type === 'treadmill'; })[0];
      for (var i = 0; i < 4; i++) {
        var appearance = APPEARANCES[i], plot = world.botPlots[i];
        var model = M.makeCharacter(Object.assign({}, appearance, { undershirt: appearance.inner })), eggVisual = M.makeEgg(forest.biome.eggColor, forest.biome.eggStripe, 1.7);
        var label = M.makeLabel('', { w: 8.2, tw: 512, th: 160, fontSize: 54, outlineWidth: 8, outlineColor: '#152130' });
        label.position.y = 9.1; model.group.add(label);
        var anchor = new T.Group(); anchor.position.set(0, 7.3, 0.15); model.group.add(anchor);
        eggVisual.visible = false; anchor.add(eggVisual);
        var bot = {
          id: 'bot-' + (i + 1), index: i, nameKey: appearance.nameKey, isBot: true,
          model: model, group: model.group, pos: new T.Vector3(plot.x, 0, plot.z - 2),
          plot: plot, label: label, labelText: '', carryAnchor: anchor, eggVisual: eggVisual,
          carrying: null, zone: null, planted: null, pet: null, pets: [], money: 400,
          speed: 20 + i * 0.8, stage: 'rest', timer: i * 3 + 1, route: [], routeIndex: 0,
          goals: [], goalIndex: 0, targetNest: null, blockedTime: 0, retryTime: 0,
          trail: [], bob: i, trips: 0, labelTick: 0,
          stats: { seededEggs: 0, steals: 0, planted: 0, hatched: 0, sold: 0, caught: 0, trains: 0, distance: 0, earned: 0 }
        };
        model.group.position.copy(bot.pos); scene.add(model.group); this.list.push(bot);
      }
      /* Stagger real activities so the first view already has an inhabited base. */
      var grower = this.list[0];
      grower.carrying = SE.Pets.makeEgg('forest', 1);
      grower.stats.seededEggs = 1;
      this.plant(grower); grower.timer = 12;
      var scout = this.list[1], nest = forest.nests[1] || forest.nests[0];
      var start = point(nest.x, nest.z + 11), startId = this.nav.nearest(start, false);
      if (startId >= 0) {
        start = this.nav.point(startId); scout.pos.set(start.x, 0, start.z);
        scout.group.position.copy(scout.pos);
        scout.targetNest = nest; scout.zone = forest;
        this.travel(scout, 'toNest', [this.nestApproach(nest)]);
      }
      if (this.treadmill) this.travel(this.list[3], 'toTrain', [this.list[3].plot.entry, this.trainingSpot(this.list[3])]);
      for (var b = 0; b < this.list.length; b++) this.updateLabel(this.list[b], true);
    },

    nestApproach: function (nest) { return point(nest.x, nest.z + 4.5); },
    trainingSpot: function (bot) {
      var tm = SE.World.treadmill;
      /* на самой ленте: двое ботов бегут друг за другом вдоль дорожки */
      if (tm && tm.yaw !== undefined && tm.x !== undefined) {
        var oz = bot.index % 2 ? 1.9 : -1.9;
        return point(tm.x + Math.sin(tm.yaw) * oz, tm.z + Math.cos(tm.yaw) * oz);
      }
      return point(this.treadmill.x + (bot.index % 2 ? 2.2 : -2.2), this.treadmill.z + 2);
    },
    safe: function (bot) { return this.world.inSafeZone(bot.pos.x, bot.pos.z); },
    thiefCount: function (except) {
      var self = this;
      return this.list.filter(function (bot) {
        return bot !== except && (bot.stage === 'toNest' || bot.stage === 'taking' || (bot.carrying && !self.safe(bot)));
      }).length;
    },

    chooseNest: function (bot) {
      if (this.thiefCount(bot) >= 2) return null;
      var self = this, player = SE.Player && SE.Player.pos, nests = this.forest.nests;
      for (var i = 0; i < nests.length; i++) {
        var n = nests[(bot.index + bot.trips + i) % nests.length];
        if (n.taken || (player && distance(player, n) < 11)) continue;
        if (self.list.some(function (other) { return other !== bot && other.targetNest === n; })) continue;
        return n;
      }
      return null;
    },

    travel: function (bot, stage, goals) {
      var nav = this.nav;
      setStage(bot, stage); bot.goals = goals.map(function (p) {
        if (nav.free(p.x, p.z)) return point(p.x, p.z);
        var nearest = nav.nearest(p, false);
        return nearest >= 0 ? nav.point(nearest) : point(p.x, p.z);
      });
      bot.goalIndex = 0; bot.route = []; bot.routeIndex = 0;
      bot.blockedTime = 0; bot.retryTime = 0;
    },
    goHome: function (bot, stage) {
      var goals = [];
      if (bot.pos.z < -158) goals.push(point(0, -158));
      if (bot.pos.z < -96) goals.push(point(0, -94));
      goals.push(bot.plot.entry, point(bot.plot.x, bot.plot.z - 2));
      this.travel(bot, stage || 'returning', goals);
    },
    startTrip: function (bot) {
      var nest = this.chooseNest(bot);
      if (!nest) { setStage(bot, 'rest', 3 + bot.index); return; }
      bot.targetNest = nest; bot.zone = nest.zone; bot.trips++;
      var goals = [];
      if (bot.pos.z > bot.plot.entry.z) goals.push(bot.plot.entry);
      if (bot.pos.z > -96) goals.push(point(0, -96));
      if (bot.pos.z > -158) goals.push(point(0, -158));
      goals.push(this.nestApproach(nest));
      this.travel(bot, 'toNest', goals);
    },

    take: function (bot) {
      var nest = bot.targetNest;
      if (!nest || nest.taken || distance(bot.pos, nest) > 6.5) {
        bot.targetNest = null; this.startTrip(bot); return;
      }
      nest.taken = true; nest.respawn = 14; nest.egg.visible = false;
      bot.carrying = SE.Pets.makeEgg(nest.zone.id, 1); bot.zone = nest.zone;
      bot.stats.steals++;
      bot.carryAnchor.add(bot.eggVisual); bot.eggVisual.position.set(0, 0, 0); bot.eggVisual.scale.setScalar(1.7);
      bot.eggVisual.visible = true; bot.model.carry = bot.carrying;
      bot.targetNest = null;
      this.goHome(bot, 'home');
      if (SE.Guards && SE.Guards.alarmForBot) SE.Guards.alarmForBot(bot.zone, bot);
    },

    plant: function (bot) {
      if (!bot.carrying) { setStage(bot, 'rest', 2); return; }
      bot.planted = bot.carrying; bot.carrying = null; bot.model.carry = null; bot.zone = null;
      bot.plot.content.add(bot.eggVisual); bot.eggVisual.position.set(0, 2.2, 1.5); bot.eggVisual.scale.setScalar(2.3); bot.eggVisual.visible = true;
      bot.stats.planted++;
      setStage(bot, 'growing', 16 + bot.index * 2.5);
      face(bot.model, 0, 1, 1);
    },
    hatch: function (bot) {
      if (!bot.planted) { setStage(bot, 'rest', 1); return; }
      removePet(bot);
      var def = SE.Pets.rollPet(bot.planted.biome, bot.planted.rarity), model = M.makePet(def, 1.8);
      bot.eggVisual.visible = false; bot.planted = null;
      bot.plot.content.add(model.group); model.group.position.set(0, 0.2, 1.5);
      bot.pet = { def: def, model: model, following: false, pos: new T.Vector3(bot.plot.x, 0, bot.plot.z + 1.5) };
      bot.pets = [def.id]; bot.stats.hatched++;
      setStage(bot, 'hatched', 4.5);
    },
    leadPet: function (bot) {
      if (!bot.pet || !this.sell) { setStage(bot, 'rest', 4); return; }
      bot.pet.following = true; this.scene.add(bot.pet.model.group); bot.pet.model.group.position.copy(bot.pet.pos);
      /* Following recent collision-safe footsteps makes the pet use the gate, too. */
      bot.trail = [point(bot.pet.pos.x, bot.pet.pos.z), point(bot.pos.x, bot.pos.z)];
      this.travel(bot, 'toSell', [bot.plot.entry, point(this.sell.x + (bot.index % 2 ? 2 : -2), this.sell.z + 3.5)]);
    },
    sellPet: function (bot) {
      if (bot.pet) {
        var value = bot.pet.def.value;
        bot.money += value; bot.stats.earned += value; bot.stats.sold++;
        removePet(bot); bot.trail = [];
      }
      if (this.treadmill && (bot.stats.sold + bot.index) % 2 === 0) {
        this.travel(bot, 'toTrain', [this.trainingSpot(bot)]);
      } else this.goHome(bot);
    },

    move: function (bot, dt) {
      if (bot.goalIndex >= bot.goals.length) return true;
      var goal = bot.goals[bot.goalIndex];
      if (!bot.route.length || bot.routeIndex >= bot.route.length) {
        if (distance(bot.pos, goal) < 1.3) { bot.goalIndex++; return bot.goalIndex >= bot.goals.length; }
        bot.retryTime -= dt;
        if (bot.retryTime > 0) return false;
        var path = this.nav.path(bot.pos, goal);
        bot.retryTime = 1.6;
        if (!path) {
          bot.blockedTime += dt + 1.6;
          if (bot.blockedTime > 8) {
            bot.targetNest = null;
            if (bot.stage === 'toNest') this.startTrip(bot);
            else this.goHome(bot, bot.carrying ? 'home' : 'returning');
          }
          return false;
        }
        bot.route = path; bot.routeIndex = 0;
      }
      var remaining = bot.speed * (bot.carrying ? 0.94 : 1) * dt, moved = 0;
      while (remaining > 0.0001 && bot.routeIndex < bot.route.length) {
        var target = bot.route[bot.routeIndex], dx = target.x - bot.pos.x, dz = target.z - bot.pos.z;
        var d = Math.hypot(dx, dz);
        if (d < 0.06) { bot.routeIndex++; continue; }
        var stride = Math.min(d, remaining, 0.42);
        var nx = bot.pos.x + dx / d * stride, nz = bot.pos.z + dz / d * stride;
        if (!this.nav.free(nx, nz)) {
          bot.route = []; bot.retryTime = 0.4; bot.blockedTime += dt;
          break;
        }
        bot.pos.set(nx, 0, nz); remaining -= stride; moved += stride;
        face(bot.model, dx, dz, dt);
        if (stride >= d - 0.001) bot.routeIndex++;
      }
      bot.moving = moved > 0.005;
      bot.stats.distance += moved;
      if (moved) bot.blockedTime = 0;
      if (bot.routeIndex >= bot.route.length && distance(bot.pos, goal) < 1.3) bot.goalIndex++;
      if (bot.blockedTime > 8) {
        /* Retry through a different nest; never teleport through a wall to succeed. */
        bot.targetNest = null; bot.route = []; bot.blockedTime = 0;
        if (bot.stage === 'toNest') this.startTrip(bot);
        else this.goHome(bot, bot.carrying ? 'home' : 'returning');
      }
      return bot.goalIndex >= bot.goals.length;
    },

    arrive: function (bot) {
      switch (bot.stage) {
        case 'toNest': setStage(bot, 'taking', 0.9 + bot.index * 0.12); break;
        case 'home': this.plant(bot); break;
        case 'toSell': setStage(bot, 'selling', 2.5); break;
        case 'toTrain': setStage(bot, 'training', 6 + bot.index); break;
        case 'returning': setStage(bot, 'rest', 2 + bot.index * 1.5); break;
      }
    },
    updatePet: function (bot, dt) {
      if (!bot.pet) return;
      var pet = bot.pet, moving = false;
      if (pet.following) {
        var last = bot.trail[bot.trail.length - 1];
        if (!last || distance(last, bot.pos) > 0.85) bot.trail.push(point(bot.pos.x, bot.pos.z));
        if (bot.trail.length > 160) bot.trail.shift();
        var target = bot.trail[0];
        if (target && (bot.trail.length > 5 || distance(pet.pos, bot.pos) > 7)) {
          var dx = target.x - pet.pos.x, dz = target.z - pet.pos.z, d = Math.hypot(dx, dz);
          var travel = Math.min(d, (bot.speed + 4) * dt);
          if (d > 0.02) {
            var next = point(pet.pos.x + dx / d * travel, pet.pos.z + dz / d * travel);
            if (this.nav.clear(pet.pos, next)) { pet.pos.x = next.x; pet.pos.z = next.z; moving = true; }
          }
          if (d < travel + 0.2) bot.trail.shift();
          face(pet.model, dx, dz, dt);
        }
        pet.model.group.position.set(pet.pos.x, 0.2, pet.pos.z);
      }
      pet.model.update(dt, moving);
      var income = pet.def.income * dt;
      bot.money += income; bot.stats.earned += income;
    },
    relabel: function () { for (var i = 0; i < this.list.length; i++) this.updateLabel(this.list[i], true); },
    updateLabel: function (bot, force) {
      var text = SE.t(bot.nameKey) + '\n' + SE.t('bot.status.' + bot.stage);
      if (bot.stage === 'growing') text += ' ' + Math.max(1, Math.ceil(bot.timer)) + SE.t('bot.sec');
      if (force || text !== bot.labelText) {
        bot.label.userData.setText(text); bot.labelText = text;
      }
    },

    update: function (dt, game) {
      if (!this.nav || !this.list.length || !dt || dt < 0 || (game && game.paused)) return;
      dt = Math.min(dt, 0.25); this.elapsed += dt;
      for (var i = 0; i < this.list.length; i++) {
        var bot = this.list[i];
        bot.moving = false; bot.timer -= dt; bot.bob += dt;
        if (bot.stage === 'toNest' && bot.targetNest && bot.targetNest.taken) {
          bot.targetNest = null; this.startTrip(bot);
        }
        if (bot.stage === 'toNest' || bot.stage === 'home' || bot.stage === 'toSell' || bot.stage === 'toTrain' || bot.stage === 'returning') {
          if (this.move(bot, dt)) this.arrive(bot);
        } else if (bot.timer <= 0) {
          switch (bot.stage) {
            case 'rest': this.startTrip(bot); break;
            case 'taking': this.take(bot); break;
            case 'growing': this.hatch(bot); break;
            case 'hatched': this.leadPet(bot); break;
            case 'selling': this.sellPet(bot); break;
            case 'training': bot.speed = Math.min(27, bot.speed + 0.4); bot.stats.trains++; this.goHome(bot); break;
            case 'caught': this.goHome(bot); break;
          }
        }
        bot.group.position.copy(bot.pos);
        var tmw = SE.World.treadmill;
        if (bot.stage === 'training' && tmw && tmw.topY !== undefined) bot.group.position.y = tmw.topY;
        bot.model.update(dt, bot.moving || bot.stage === 'training', bot.stage === 'training' ? 1.6 : bot.speed / 20, true);
        if (bot.stage === 'training') {
          if (tmw && tmw.yaw !== undefined) {
            var fy = SE.Player.treadmillFaceYaw(tmw);
            face(bot.model, Math.sin(fy), Math.cos(fy), dt);
          }
          else face(bot.model, -1, -1, dt);
        }
        if (bot.stage === 'growing') {
          bot.eggVisual.position.y = 2.2 + Math.sin(bot.bob * 2) * 0.12;
          bot.eggVisual.rotation.z = Math.sin(bot.bob * 2.6) * 0.055;
        } else bot.eggVisual.rotation.z = 0;
        this.updatePet(bot, dt);
        bot.labelTick -= dt;
        if (bot.labelTick <= 0) { this.updateLabel(bot); bot.labelTick = 0.3; }
      }
    },

    getStealTargets: function () {
      var self = this;
      return this.list.filter(function (bot) { return !!bot.carrying && !self.safe(bot) && bot.stage !== 'caught'; });
    },
    onCaught: function (bot, guard) {
      if (!bot || !bot.carrying || this.safe(bot)) return;
      bot.carrying = null; bot.model.carry = null; bot.eggVisual.visible = false;
      bot.zone = null; bot.targetNest = null; bot.stats.caught++;
      bot.route = []; bot.goals = []; bot.trail = [];
      /* The same short defeat/respawn used by the human player, then resume work. */
      bot.pos.set(bot.plot.x, 0, bot.plot.z - 2); bot.group.position.copy(bot.pos);
      setStage(bot, 'caught', 3.5);
      this.updateLabel(bot, true);
    },

    summary: function () {
      return {
        simulatedSeconds: Math.round(this.elapsed), count: this.list.length,
        activeThieves: this.thiefCount(null), navSearches: this.nav ? this.nav.searches : 0,
        navFailures: this.nav ? this.nav.failures : 0,
        bots: this.list.map(function (bot) {
          return {
            id: bot.id, name: SE.t(bot.nameKey), stage: bot.stage, x: Math.round(bot.pos.x * 10) / 10, z: Math.round(bot.pos.z * 10) / 10,
            carrying: !!bot.carrying, growing: !!bot.planted, pets: bot.pets.length,
            money: Math.floor(bot.money), timer: Math.max(0, Math.round(bot.timer)),
            remainingWaypoints: Math.max(0, bot.goals.length - bot.goalIndex),
            stats: Object.assign({}, bot.stats)
          };
        })
      };
    }
  };

  SE.Bots = Bots;
})(window);
