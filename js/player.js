/* =========================================================
   Игрок: ввод, физика, камера, трейл, питомцы-спутники
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U, M = SE.Models, T = global.THREE;

  /* ---------------- Ввод ---------------- */
  var Input = {
    keys: {},
    move: { x: 0, y: 0 },
    jumpPressed: false,
    actionPressed: false,
    action2Pressed: false,
    camDelta: { x: 0, y: 0 },
    dragging: false,
    joyActive: false,
    joyId: null,
    camId: null,
    enabled: true,

    canUse: function () {
      return this.enabled && !(SE.Game && SE.Game.paused);
    },

    reset: function () {
      this.keys = {};
      this.jumpPressed = this.actionPressed = this.action2Pressed = false;
      this.camDelta.x = this.camDelta.y = 0;
      this.zoomDelta = 0;
      this.dragging = this.joyActive = false;
      this.joyId = this.camId = null;
      this.move.x = this.move.y = 0;
      var knob = document.getElementById('joyKnob');
      if (knob) knob.style.transform = 'translate(0,0)';
    },

    init: function (canvas, ui) {
      var self = this;

      global.addEventListener('keydown', function (e) {
        if (!self.canUse()) return;
        if (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
        self.keys[e.code] = true;
        if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
        if (e.repeat) return;
        if (e.code === 'Space') self.jumpPressed = true;
        if (e.code === 'KeyE') self.actionPressed = true;
        if (e.code === 'KeyF') self.action2Pressed = true;
      });
      global.addEventListener('keyup', function (e) { self.keys[e.code] = false; });

      /* Мышь: правая кнопка — поворот камеры */
      canvas.addEventListener('mousedown', function (e) {
        if (self.canUse() && e.button === 2) {
          self.dragging = true;
          self.lastX = e.clientX; self.lastY = e.clientY;
          e.preventDefault();
        }
      });
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      global.addEventListener('mousemove', function (e) {
        if (!self.canUse() || !self.dragging) return;
        self.camDelta.x += (e.clientX - self.lastX) * 0.005;
        self.camDelta.y += (e.clientY - self.lastY) * 0.004;
        self.lastX = e.clientX; self.lastY = e.clientY;
      });
      global.addEventListener('mouseup', function () { self.dragging = false; });

      /* Колесо — зум */
      canvas.addEventListener('wheel', function (e) {
        if (!self.canUse()) return;
        self.zoomDelta = (self.zoomDelta || 0) + Math.sign(e.deltaY) * 2;
        e.preventDefault();
      }, { passive: false });

      /* Тач: камера свободным пальцем */
      canvas.addEventListener('touchstart', function (e) {
        if (!self.canUse()) return;
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          if (self.camId === null) {
            self.camId = t.identifier;
            self.lastX = t.clientX; self.lastY = t.clientY;
          }
        }
      }, { passive: true });
      canvas.addEventListener('touchmove', function (e) {
        if (!self.canUse()) return;
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          if (t.identifier === self.camId) {
            self.camDelta.x += (t.clientX - self.lastX) * 0.006;
            self.camDelta.y += (t.clientY - self.lastY) * 0.005;
            self.lastX = t.clientX; self.lastY = t.clientY;
          }
        }
      }, { passive: true });
      var endTouch = function (e) {
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === self.camId) self.camId = null;
        }
      };
      canvas.addEventListener('touchend', endTouch, { passive: true });
      canvas.addEventListener('touchcancel', endTouch, { passive: true });

      this.initJoystick(ui);
    },

    initJoystick: function (ui) {
      var self = this;
      var joy = document.getElementById('joystick');
      var knob = document.getElementById('joyKnob');
      if (!joy || !knob) return;
      var radius = 58;
      var cx = 0, cy = 0;

      function start(id, x, y) {
        if (!self.canUse() || self.joyActive) return;
        self.joyId = id;
        self.joyActive = true;
        var r = joy.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        radius = r.width * 0.38;
        move(x, y);
      }
      function move(x, y) {
        var dx = x - cx, dy = y - cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        var k = d > radius ? radius / d : 1;
        knob.style.transform = 'translate(' + (dx * k) + 'px,' + (dy * k) + 'px)';
        self.move.x = (dx * k) / radius;
        self.move.y = (dy * k) / radius;
      }
      function end() {
        self.joyActive = false;
        self.joyId = null;
        self.move.x = 0; self.move.y = 0;
        knob.style.transform = 'translate(0,0)';
      }

      joy.addEventListener('touchstart', function (e) {
        var t = e.changedTouches[0];
        start(t.identifier, t.clientX, t.clientY);
        e.preventDefault();
      }, { passive: false });
      joy.addEventListener('touchmove', function (e) {
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i];
          if (t.identifier === self.joyId) move(t.clientX, t.clientY);
        }
        e.preventDefault();
      }, { passive: false });
      joy.addEventListener('touchend', function (e) {
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === self.joyId) end();
        }
      });
      joy.addEventListener('touchcancel', end);

      /* мышью тоже (для теста на ПК) */
      joy.addEventListener('mousedown', function (e) { if (e.button === 0) start('m', e.clientX, e.clientY); });
      global.addEventListener('mousemove', function (e) { if (self.joyId === 'm') move(e.clientX, e.clientY); });
      global.addEventListener('mouseup', function () { if (self.joyId === 'm') end(); });
    },

    axis: function () {
      if (!this.canUse()) return { x: 0, z: 0, len: 0 };
      var x = 0, z = 0;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) z -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) z += 1;
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1;
      if (this.joyActive) { x += this.move.x; z += this.move.y; }
      var len = Math.sqrt(x * x + z * z);
      if (len > 1) { x /= len; z /= len; }
      return { x: x, z: z, len: Math.min(1, len) };
    },

    consumeJump: function () {
      var j = this.jumpPressed;
      this.jumpPressed = false;
      return j;
    },
    consumeAction: function () {
      var a = this.actionPressed; this.actionPressed = false; return a;
    },
    consumeAction2: function () {
      var a = this.action2Pressed; this.action2Pressed = false; return a;
    }
  };

  /* ---------------- Игрок ---------------- */
  var Player = {
    pos: new T.Vector3(0, 0, 18),
    vel: new T.Vector3(0, 0, 0),
    yaw: 0,
    grounded: true,
    camYaw: 0,
    camPitch: 0.25,
    camDist: 24,
    camTargetDist: 24,
    model: null,
    group: null,
    trailPool: [],
    trailIndex: 0,
    carryMesh: null,
    followers: [],
    speedStat: 20,
    moving: false,

    init: function (scene) {
      this.model = M.makeCharacter();
      this.group = this.model.group;
      scene.add(this.group);
      this.scene = scene;
      this.pos.copy(SE.World.spawn || new T.Vector3(0, 0, 24));
      this.camYaw = Math.PI;
      this.yaw = this.camYaw;
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.yaw;
      this.cameraReady = false;

      /* пул для трейла */
      var geo = new T.PlaneGeometry(1.6, 2.6);
      for (var i = 0; i < 46; i++) {
        var m = new T.Mesh(geo, new T.MeshBasicMaterial({
          color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide
        }));
        m.visible = false;
        scene.add(m);
        this.trailPool.push({ mesh: m, life: 0 });
      }

      /* точка «несомого» яйца */
      this.carryAnchor = new T.Group();
      this.carryAnchor.position.set(0, 7.3, 0.15);
      this.group.add(this.carryAnchor);
    },

    setSpeedStat: function (v) { this.speedStat = v; },

    /* Косметика игрока (см. docs/AGENTS-CONTRACT.md). */
    setLook: function (look) {
      var self = this;
      if (!this.model || !this.model.setLook) return;
      /* Полноразмерный скин задаёт свою высоту для несомого яйца (узел Carry). */
      this.model.onSkin = function (m) {
        self.carryAnchor.position.set(0, m.carryY || 7.3, m.carryZ === null || m.carryZ === undefined ? 0.15 : m.carryZ);
      };
      this.model.setLook(look);
    },
    celebrate: function (sec) { if (this.model && this.model.celebrate) this.model.celebrate(sec); },

    moveSpeed: function (game) {
      var s = 12 + this.speedStat * 0.28;
      if (game && game.boosts.isActive('speedBoost')) s *= 2;
      if (game && game.slowMode) s *= 0.55;
      return s;
    },

    update: function (dt, game, camera) {
      var ax = Input.axis();
      var speed = this.moveSpeed(game);

      /* камера: поворот */
      this.camYaw -= Input.camDelta.x;
      this.camPitch = U.clamp(this.camPitch + Input.camDelta.y, 0.08, 1.15);
      Input.camDelta.x = 0; Input.camDelta.y = 0;
      if (Input.zoomDelta) {
        this.camTargetDist = U.clamp(this.camTargetDist + Input.zoomDelta, 16, 62);
        Input.zoomDelta = 0;
      }

      /* направление движения относительно камеры */
      var moveX = 0, moveZ = 0;
      if (ax.len > 0.02 && !game.paused) {
        var sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
        moveX = -ax.x * cos - ax.z * sin;
        moveZ = ax.x * sin - ax.z * cos;
        var l = Math.sqrt(moveX * moveX + moveZ * moveZ) || 1;
        moveX /= l; moveZ /= l;
        this.yaw = Math.atan2(moveX, moveZ);
      }
      this.moving = ax.len > 0.05 && !game.paused;

      var vx = moveX * speed * ax.len;
      var vz = moveZ * speed * ax.len;

      /* прыжок и гравитация */
      if (Input.consumeJump() && this.grounded && !game.paused) {
        this.vel.y = 26;
        this.grounded = false;
        SE.Audio.play('jump', { volume: 0.4 });
        SE.FX.burst('jump', this.pos);
      }
      this.vel.y -= 78 * dt;

      var nx = this.pos.x;
      var nz = this.pos.z;
      var ny = this.pos.y + this.vel.y * dt;

      /* Короткие шаги не дают ускоренному игроку проскочить сквозь забор. */
      var steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vz)) * dt / 0.75));
      for (var step = 0; step < steps; step++) {
        var res = this.resolve(nx + vx * dt / steps, nz + vz * dt / steps, this.pos.y);
        nx = res.x; nz = res.z;
      }

      /* опора (пол / платформы) */
      var groundY = 0, standOn = null;
      var cols = SE.World.nearColliders(nx, nz);
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        if (!c.solid && !c.platform && c.id !== 'treadmill') continue;
        /* на низкие платформы (лента дорожки) можно просто зайти — авто-шаг */
        var stepUp = c.step || c.id === 'treadmill' ? 1.45 : 0.6;
        var pad = c.step || c.id === 'treadmill' ? 0.2 : 0.9;
        if (nx > c.minX - pad && nx < c.maxX + pad && nz > c.minZ - pad && nz < c.maxZ + pad) {
          if (this.pos.y + stepUp >= c.topY && c.topY > groundY) { groundY = c.topY; standOn = c; }
        }
      }

      /* шаг вверх на ленту — без прыжка */
      if (standOn && this.grounded && this.pos.y < groundY && groundY - this.pos.y <= 1.45) ny = groundY;
      if (ny <= groundY) {
        ny = groundY;
        if (!this.grounded && this.vel.y < -12) {
          SE.Audio.play('step1', { volume: 0.2 });
          SE.FX.burst('land', { x: nx, y: ny, z: nz }, { power: Math.min(1, -this.vel.y / 40) });
        }
        this.vel.y = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }

      /* границы мира */
      var r = Math.sqrt(nx * nx + nz * nz);
      var maxR = SE.World.outerRadius || 292;
      if (r > maxR) {
        nx = nx / r * maxR;
        nz = nz / r * maxR;
      }

      this.pos.set(nx, ny, nz);
      this.group.position.copy(this.pos);
      /* стоит на ленте без ввода — бежит на месте лицом к пульту */
      var tm = SE.World.treadmill;
      this.training = !!(standOn && standOn.id === 'treadmill' && this.grounded && !this.moving);
      if (this.training && tm) this.yaw = this.treadmillFaceYaw(tm);
      this.group.rotation.y = this.turnTowards(this.group.rotation.y, this.yaw, 12, dt);
      this.model.update(dt, (this.moving || this.training) && this.grounded, this.training ? 1.6 : speed / 17, this.grounded);

      /* шаги: звук и лёгкая пыль */
      if (this.moving && this.grounded) {
        SE.Audio.step(speed / 16);
        this.stepDist = (this.stepDist || 0) + speed * dt;
        if (this.stepDist > 5.5) { this.stepDist = 0; SE.FX.burst('step', this.pos); }
      }

      /* трейл: новый из SE.FX, старые полоски — только если эффекты не загружены */
      var fxReady = SE.FX && SE.FX.AURAS && SE.FX.AURAS.length > 0;
      if (fxReady) SE.FX.trail(game.trail || 'none', game.trailColor(), this.pos, this.moving, dt);
      else if (game.trail && game.trail !== 'none' && this.moving) this.emitTrail(game.trailColor(), dt);
      this.updateTrail(dt);

      /* камера */
      this.camDist = U.damp(this.camDist, this.camTargetDist, 6, dt);
      var cy = Math.cos(this.camPitch) * this.camDist;
      var ch = Math.sin(this.camPitch) * this.camDist;
      var camX = this.pos.x - Math.sin(this.camYaw) * cy;
      var camZ = this.pos.z - Math.cos(this.camYaw) * cy;
      var camY = this.pos.y + 6 + ch;
      if (!this.cameraReady) {
        camera.position.set(camX, camY, camZ);
        this.cameraReady = true;
      } else {
        camera.position.set(
          U.damp(camera.position.x, camX, 14, dt),
          U.damp(camera.position.y, camY, 14, dt),
          U.damp(camera.position.z, camZ, 14, dt)
        );
      }
      this.resolveCamera(camera);
      camera.lookAt(this.pos.x, this.pos.y + 5, this.pos.z);

      this.updateFollowers(dt);
      /* несомое яйцо покачивается в поднятых руках */
      if (this.carryMesh) {
        this.carryT = (this.carryT || 0) + dt * (this.moving ? 9 : 2.5);
        this.carryMesh.rotation.z = Math.sin(this.carryT) * (this.moving ? 0.1 : 0.04);
        this.carryMesh.position.y = Math.abs(Math.sin(this.carryT)) * (this.moving ? 0.18 : 0.05);
      }
    },

    /* Направление «лицом к пульту»: по широкому поручню у пульта (надёжнее, чем угол модели). */
    treadmillFaceYaw: function (tm) {
      if (tm.faceYaw !== undefined) return tm.faceYaw;
      var best = null, w = 0;
      (SE.World.colliders || []).forEach(function (c) {
        if (c.id === 'treadmill-rail' && c.maxX - c.minX + c.maxZ - c.minZ > w) { w = c.maxX - c.minX + c.maxZ - c.minZ; best = c; }
      });
      tm.faceYaw = best ? Math.atan2((best.minX + best.maxX) / 2 - tm.x, (best.minZ + best.maxZ) / 2 - tm.z) : (tm.yaw || 0);
      return tm.faceYaw;
    },

    turnTowards: function (from, to, lambda, dt) {
      var delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
      return from + delta * (1 - Math.exp(-lambda * dt));
    },

    /* Не позволяем камере оказаться за стеной при приближении или повороте. */
    resolveCamera: function (camera) {
      var origin = [this.pos.x, this.pos.y + 5, this.pos.z];
      var delta = [camera.position.x - origin[0], camera.position.y - origin[1], camera.position.z - origin[2]];
      var length = Math.sqrt(delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]);
      var limit = 1;
      var cols = SE.World.colliders || [];
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        if (!c.solid || c.noCam) continue;
        var min = [c.minX - 0.35, -0.35, c.minZ - 0.35];
        var max = [c.maxX + 0.35, c.topY + 0.35, c.maxZ + 0.35];
        var enter = 0, leave = 1;
        for (var axis = 0; axis < 3; axis++) {
          if (Math.abs(delta[axis]) < 0.00001) {
            if (origin[axis] < min[axis] || origin[axis] > max[axis]) { leave = -1; break; }
          } else {
            var a = (min[axis] - origin[axis]) / delta[axis];
            var b = (max[axis] - origin[axis]) / delta[axis];
            enter = Math.max(enter, Math.min(a, b));
            leave = Math.min(leave, Math.max(a, b));
          }
        }
        if (enter <= leave && leave >= 0 && enter > 0) {
          limit = Math.min(limit, Math.max(0.03, enter - 0.4 / (length || 1)));
        }
      }
      if (limit < 1) camera.position.set(origin[0] + delta[0] * limit, origin[1] + delta[1] * limit, origin[2] + delta[2] * limit);
    },

    resolve: function (nx, nz, py) {
      var cols = SE.World.nearColliders(nx, nz);
      var radius = 1.5;
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        if (!c.solid) continue;
        if (py >= c.topY - 0.4) continue; /* стоим сверху — не толкаем */
        var minX = c.minX - radius, maxX = c.maxX + radius;
        var minZ = c.minZ - radius, maxZ = c.maxZ + radius;
        if (nx > minX && nx < maxX && nz > minZ && nz < maxZ) {
          var dxL = nx - minX, dxR = maxX - nx;
          var dzT = nz - minZ, dzB = maxZ - nz;
          var m = Math.min(dxL, dxR, dzT, dzB);
          if (m === dxL) nx = minX;
          else if (m === dxR) nx = maxX;
          else if (m === dzT) nz = minZ;
          else nz = maxZ;
        }
      }
      return { x: nx, z: nz };
    },

    /* ---------------- Трейл ---------------- */
    emitTrail: function (color, dt) {
      this.trailTimer = (this.trailTimer || 0) - dt;
      if (this.trailTimer > 0) return;
      this.trailTimer = 0.035;
      var p = this.trailPool[this.trailIndex];
      this.trailIndex = (this.trailIndex + 1) % this.trailPool.length;
      p.mesh.visible = true;
      p.mesh.position.set(this.pos.x, this.pos.y + 2.4 + Math.random() * 1.6, this.pos.z);
      p.mesh.rotation.set(0, this.group.rotation.y, Math.random() * 0.6 - 0.3);
      p.mesh.material.color.set(color);
      p.mesh.material.opacity = 0.9;
      p.mesh.scale.setScalar(1);
      p.life = 0.55;
    },

    updateTrail: function (dt) {
      for (var i = 0; i < this.trailPool.length; i++) {
        var p = this.trailPool[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        var k = Math.max(0, p.life / 0.55);
        p.mesh.material.opacity = k * 0.85;
        p.mesh.scale.setScalar(0.4 + k * 0.9);
        p.mesh.position.y += dt * 1.2;
        if (p.life <= 0) p.mesh.visible = false;
      }
    },

    /* ---------------- Несомое яйцо ---------------- */
    setCarry: function (egg) {
      if (this.carryMesh) {
        this.carryAnchor.remove(this.carryMesh);
        this.carryMesh = null;
      }
      this.model.carry = null;
      if (egg) {
        var b = SE.Pets.biome(egg.biome);
        var mesh = M.makeEgg(b.eggColor, b.eggStripe, 1.5, true, { rarity: egg.rarity });
        this.carryAnchor.add(mesh);
        this.carryMesh = mesh;
        this.model.carry = egg;
      }
    },

    /* ---------------- Питомцы-спутники ---------------- */
    setFollowers: function (petIds) {
      var self = this;
      for (var i = 0; i < this.followers.length; i++) {
        this.scene.remove(this.followers[i].model.group);
      }
      this.followers = [];
      for (var j = 0; j < petIds.length; j++) {
        var def = SE.Pets.get(petIds[j]);
        if (!def) continue;
        var model = M.makePet(def, 1.15);
        this.scene.add(model.group);
        this.followers.push({
          model: model, def: def, index: j,
          x: this.pos.x, z: this.pos.z, bob: Math.random() * 6
        });
      }
    },

    updateFollowers: function (dt) {
      var n = this.followers.length;
      for (var i = 0; i < n; i++) {
        var f = this.followers[i];
        var cols = Math.min(4, n);
        var row = Math.floor(i / cols);
        var col = i % cols;
        var offX = (col - (cols - 1) / 2) * 3.0;
        var offZ = -5.5 - row * 3.4;
        var sin = Math.sin(this.group.rotation.y), cos = Math.cos(this.group.rotation.y);
        var tx = this.pos.x + offX * cos + offZ * sin;
        var tz = this.pos.z - offX * sin + offZ * cos;

        var dx = tx - f.x, dz = tz - f.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        var moving = d > 0.6;
        if (moving) {
          var sp = Math.min(30, 4 + d * 5);
          var travel = Math.min(d, sp * dt);
          f.x += (dx / d) * travel;
          f.z += (dz / d) * travel;
          f.model.group.rotation.y = this.turnTowards(f.model.group.rotation.y, Math.atan2(dx, dz), 10, dt);
        }
        f.bob += dt * 3;
        f.model.group.position.set(f.x, 0.4 + Math.sin(f.bob) * 0.18, f.z);
        f.model.update(dt, moving);
      }
    },

    teleportHome: function () {
      this.pos.copy(SE.World.spawn || new T.Vector3(0, 0, 26));
      this.vel.set(0, 0, 0);
      this.grounded = true;
      this.moving = false;
      this.camYaw = this.yaw = Math.PI;
      this.group.rotation.y = this.yaw;
      this.cameraReady = false;
      Input.reset();
      this.group.position.copy(this.pos);
      for (var i = 0; i < this.followers.length; i++) {
        this.followers[i].x = this.pos.x;
        this.followers[i].z = this.pos.z;
      }
    }
  };

  SE.Input = Input;
  SE.Player = Player;
})(window);
