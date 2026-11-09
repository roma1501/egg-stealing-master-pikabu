/* =========================================================
   Охранники локаций: патруль, погоня, поимка
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U, M = SE.Models, T = global.THREE;

  var Guards = {
    list: [],
    scene: null,

    init: function (scene, world) {
      this.scene = scene;
      this.list = [];
      for (var i = 0; i < world.zones.length; i++) {
        world.zones[i].guards = [];
        this.spawnZone(world.zones[i]);
      }
    },

    spawnZone: function (zone) {
      var biome = zone.biome;
      var count = biome.guardCount;
      for (var i = 0; i < count; i++) {
        var style = M.GUARD_STYLES[biome.guard] || M.GUARD_STYLES.chicken;
        var model = M.makeGuard(biome.guard, style);
        var a = (i / count) * Math.PI * 2;
        var r = 24 + Math.random() * 20;
        var g = {
          model: model,
          zone: zone,
          speed: biome.guardSpeed,
          state: 'patrol',
          x: zone.x + Math.cos(a) * r,
          z: zone.z + Math.sin(a) * r,
          homeX: zone.x + Math.cos(a) * r,
          homeZ: zone.z + Math.sin(a) * r,
          targetX: 0, targetZ: 0,
          dir: Math.random() * Math.PI * 2,
          wait: Math.random() * 2,
          aggroTime: 0,
          stun: 0
        };
        model.group.position.set(g.x, 0, g.z);
        this.scene.add(model.group);
        zone.guards.push(g);
        this.list.push(g);
        this.pickPatrol(g);
      }
    },

    pickPatrol: function (g) {
      var zone = g.zone;
      var a = Math.random() * Math.PI * 2;
      var r = 10 + Math.random() * (zone.half - 20);
      g.targetX = zone.x + Math.cos(a) * r;
      g.targetZ = zone.z + Math.sin(a) * r;
    },

    /* Поднять тревогу во всей локации */
    alarm: function (zone, duration) {
      for (var i = 0; i < zone.guards.length; i++) {
        var g = zone.guards[i];
        g.state = 'chase';
        g.targetKind = 'player';
        g.targetBot = null;
        g.stun = 0;
        g.aggroTime = duration || 22;
        g.model.alert.visible = true;
      }
    },

    /* A neighbour's theft attracts one available guard, never steals the player's pursuer. */
    alarmForBot: function (zone, bot) {
      var available = null, distance = Infinity;
      for (var i = 0; i < zone.guards.length; i++) {
        var guard = zone.guards[i];
        if (guard.state === 'chase') continue;
        var dx = guard.x - bot.pos.x, dz = guard.z - bot.pos.z;
        if (dx * dx + dz * dz < distance) { distance = dx * dx + dz * dz; available = guard; }
      }
      if (!available) return;
      available.state = 'chase';
      available.targetKind = 'bot';
      available.targetBot = bot;
      available.aggroTime = 30;
      available.stun = 0;
      available.model.alert.visible = true;
    },

    calmPlayer: function () {
      for (var i = 0; i < this.list.length; i++) {
        var g = this.list[i];
        if (g.targetKind === 'bot') continue;
        g.state = 'return';
        g.aggroTime = 0;
        g.targetKind = null;
        g.targetBot = null;
        g.model.alert.visible = false;
      }
    },

    calmZone: function (zone) {
      for (var i = 0; i < zone.guards.length; i++) {
        var g = zone.guards[i];
        g.state = 'return';
        g.aggroTime = 0;
        g.targetKind = null;
        g.targetBot = null;
        g.model.alert.visible = false;
      }
    },

    calmAll: function () {
      for (var i = 0; i < this.list.length; i++) {
        this.list[i].state = 'return';
        this.list[i].aggroTime = 0;
        this.list[i].targetKind = null;
        this.list[i].targetBot = null;
        this.list[i].model.alert.visible = false;
      }
    },

    anyChasing: function (targetKind) {
      for (var i = 0; i < this.list.length; i++) {
        if (this.list[i].state === 'chase' && (!targetKind || this.list[i].targetKind === targetKind)) return true;
      }
      return false;
    },

    /* Общие препятствия действуют и на охранников. При упоре обходим угол. */
    moveTo: function (g, tx, tz, speed, dt) {
      var dx = tx - g.x, dz = tz - g.z;
      var distance = Math.sqrt(dx * dx + dz * dz);
      if (distance < 0.01) return false;
      var travel = Math.min(distance, speed * dt);
      var steps = Math.max(1, Math.ceil(travel / 0.75));
      var stride = travel / steps;
      var oldX = g.x, oldZ = g.z;
      var angle = Math.atan2(dx, dz);
      for (var step = 0; step < steps; step++) {
        var next = SE.Player.resolve(g.x + Math.sin(angle) * stride, g.z + Math.cos(angle) * stride, 0);
        var movedX = next.x - g.x, movedZ = next.z - g.z;
        if (movedX * movedX + movedZ * movedZ < stride * stride * 0.16) {
          var side = g.avoidSide || 1;
          for (var turn = 0; turn < 2; turn++) {
            var offset = angle + side * Math.PI / 2;
            var around = SE.Player.resolve(g.x + Math.sin(offset) * stride, g.z + Math.cos(offset) * stride, 0);
            var ax = around.x - g.x, az = around.z - g.z;
            if (ax * ax + az * az > stride * stride * 0.25) {
              next = around;
              g.avoidSide = side;
              break;
            }
            side *= -1;
          }
        }
        g.x = next.x; g.z = next.z;
      }
      dx = g.x - oldX; dz = g.z - oldZ;
      if (dx * dx + dz * dz < 0.0001) return false;
      g.dir = Math.atan2(dx, dz);
      return true;
    },

    update: function (dt, player, game) {
      var px = player.pos.x, pz = player.pos.z;
      var invisible = game.boosts.isActive('invisible');
      var inSafe = SE.World.inSafeZone(px, pz);
      var botTargets = SE.Bots ? SE.Bots.getStealTargets() : [];

      for (var i = 0; i < this.list.length; i++) {
        var g = this.list[i];
        var moving = false;

        if (g.stun > 0) {
          g.stun -= dt;
          g.model.update(dt, false, 0);
          continue;
        }

        if (g.state === 'chase') {
          g.aggroTime -= dt;
          var botTarget = g.targetKind === 'bot' ? g.targetBot : null;
          var targetX = botTarget ? botTarget.pos.x : px;
          var targetZ = botTarget ? botTarget.pos.z : pz;
          var targetY = botTarget ? botTarget.pos.y : player.pos.y;
          var targetSafe = botTarget ? SE.World.inSafeZone(targetX, targetZ) : inSafe;
          var targetCarrying = botTarget ? botTarget.carrying : game.carrying;
          var targetInvisible = !botTarget && invisible;
          var dx = targetX - g.x, dz = targetZ - g.z;
          var dist = Math.sqrt(dx * dx + dz * dz);

          if (targetInvisible || targetSafe || !targetCarrying || g.aggroTime <= 0 || dist > 190) {
            g.state = 'return';
            g.targetKind = null;
            g.targetBot = null;
            g.model.alert.visible = false;
          } else {
            var sp = g.speed * (!botTarget && game.slowMode ? 0.62 : 1);
            moving = this.moveTo(g, targetX, targetZ, sp, dt);
            var catchX = targetX - g.x, catchZ = targetZ - g.z;
            if (catchX * catchX + catchZ * catchZ < 3.4 * 3.4 && targetY < 6.5) {
              if (botTarget) SE.Bots.onCaught(botTarget, g);
              else game.onCaught(g);
              g.state = 'return';
              g.targetKind = null;
              g.targetBot = null;
              g.model.alert.visible = false;
              g.stun = 2.2;
            }
          }
        } else if (g.state === 'return') {
          var rx = g.homeX - g.x, rz = g.homeZ - g.z;
          var rd = Math.sqrt(rx * rx + rz * rz);
          if (rd < 3) { g.state = 'patrol'; this.pickPatrol(g); }
          else {
            moving = this.moveTo(g, g.homeX, g.homeZ, g.speed * 0.55, dt);
          }
        } else {
          /* патруль */
          g.wait -= dt;
          var tx = g.targetX - g.x, tz = g.targetZ - g.z;
          var td = Math.sqrt(tx * tx + tz * tz);
          if (td < 2.5) {
            if (g.wait <= 0) { this.pickPatrol(g); g.wait = 1 + Math.random() * 3; }
          } else if (g.wait <= 0.6) {
            var psp = g.speed * 0.33;
            moving = this.moveTo(g, g.targetX, g.targetZ, psp, dt);
            if (!moving) this.pickPatrol(g);
          }

          /* заметил вора с яйцом рядом */
          if (!invisible && !inSafe && game.carrying) {
            var ddx = px - g.x, ddz = pz - g.z;
            var dd = Math.sqrt(ddx * ddx + ddz * ddz);
            if (dd < 34) {
              g.state = 'chase';
              g.targetKind = 'player';
              g.targetBot = null;
              g.aggroTime = 18;
              g.model.alert.visible = true;
              SE.Audio.play('alarm', { volume: 0.25 });
            }
          }
          if (g.state !== 'chase') {
            for (var bt = 0; bt < botTargets.length; bt++) {
              var bot = botTargets[bt];
              var bx = bot.pos.x - g.x, bz = bot.pos.z - g.z;
              if (bx * bx + bz * bz < 26 * 26) {
                var alreadyPursued = this.list.some(function (other) { return other.state === 'chase' && other.targetBot === bot; });
                if (!alreadyPursued) {
                  g.state = 'chase';
                  g.targetKind = 'bot';
                  g.targetBot = bot;
                  g.aggroTime = 26;
                  g.model.alert.visible = true;
                }
                break;
              }
            }
          }
        }

        /* держим охранника внутри его локации при патруле */
        var zn = g.zone;
        if (g.state === 'patrol') {
          var ox = g.x - zn.x, oz = g.z - zn.z;
          var od = Math.sqrt(ox * ox + oz * oz);
          var limit = zn.half - 8;
          if (od > limit) {
            g.x = zn.x + (ox / od) * limit;
            g.z = zn.z + (oz / od) * limit;
          }
        }

        g.model.group.position.x = g.x;
        g.model.group.position.z = g.z;
        g.model.group.rotation.y = SE.Player.turnTowards(g.model.group.rotation.y, g.dir, 8, dt);
        g.model.group.position.y = moving && g.state === 'chase' ? Math.abs(Math.sin(g.model.t * 0.9)) * 0.35 : 0;
        g.model.update(dt, moving, g.speed);
      }
    }
  };

  SE.Guards = Guards;
})(window);
