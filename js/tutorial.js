/* =========================================================
   Tutorial for new players (owned by the SYSTEMS agent)
   Five steps, each completed by the player's action (never by a timer):
     1 move -> 2 follow the arrows to the forest island -> 3 steal an egg from a nest
     -> 4 run back past the white line -> 5 the egg grows in a pen: collect the pet.
   A short bold instruction + a pointer (world beacon and an on-screen marker or a
   highlighted button). Hints follow the input that was really used last (keys or touch).
   "Skip" is on every step: mouse, touch, or the Enter key. The tutorial is not a round:
   no Ads.roundEnded, no ads, no Daily Gift / Wheel / Shop popups while it runs.
   tutorialDone lives in the main save (SE.State.data.tutorialDone).
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U, T = global.THREE;

  var STEPS = 5;
  var MOVE_DISTANCE = 7;          /* world units the player must run in step 1 */
  var NEAR_NEST = 32;             /* "arrived at the forest island" */
  var TUTORIAL_HATCH = 7;         /* seconds: the first egg hatches quickly */

  var Tutorial = {
    active: false, replay: false, step: 0, moved: 0, lastPos: null, penIndex: -1,
    gaveInvisible: false, wasInvisible: false, finishTimer: null,
    el: null, marker: null, beacon: null, hideTimer: null, lastText: '', lastMode: '',

    /* ---------- DOM ---------- */
    build: function () {
      if (this.el) return;
      var self = this;
      var ui = document.getElementById('ui');
      var el = U.el('div', 'tut');
      el.id = 'tutorial';
      el.innerHTML =
        '<div class="tut-card">' +
          '<div class="tut-top"><span class="tut-step stroke"></span><span class="tut-dots"></span></div>' +
          '<div class="tut-body"><span class="tut-ic"></span><span class="tut-text stroke"></span></div>' +
        '</div>' +
        '<button class="btn tut-skip" type="button"></button>';
      ui.appendChild(el);
      var marker = U.el('div', 'tut-marker');
      marker.id = 'tutMarker';
      marker.innerHTML = '<span class="tut-arrow"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 L36 35 L20 27 L4 35 Z" fill="#ffd23a" stroke="#1a0f06" stroke-width="3.6" stroke-linejoin="round"/></svg></span><span class="tut-label stroke"></span>';
      ui.appendChild(marker);
      this.el = el; this.marker = marker;
      var skip = el.querySelector('.tut-skip');
      skip.addEventListener('click', function (e) { e.preventDefault(); self.skip(); });
      skip.addEventListener('touchstart', function (e) { e.preventDefault(); self.skip(); }, { passive: false });
      global.addEventListener('keydown', function (e) {
        if (!self.active || e.code !== 'Enter' || e.repeat) return;
        if (SE.UI.isOpen() || SE.Platform.paused) return;
        e.preventDefault();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        self.skip();
      });
      SE.I18N.onChange(function () { if (self.active) self.render(true); });
    },

    /* ---------- lifecycle ---------- */
    start: function (replay) {
      this.build();
      if (SE.UI.isOpen()) SE.UI.close();
      this.active = true;
      this.replay = !!replay;
      this.step = 0;
      this.moved = 0;
      this.lastPos = null;
      this.penIndex = -1;
      this.gaveInvisible = false;
      this.wasInvisible = SE.Boosts.isActive('invisible');
      if (this.finishTimer) { SE.Tasks.clear(this.finishTimer); this.finishTimer = null; }
      document.getElementById('ui').classList.add('tutorial-on');
      this.el.classList.add('show');
      this.makeBeacon();
      /* fast-forward when the player is already further along (replay) */
      if (SE.Game.carrying) this.step = 3;
      this.render(true);
    },

    /* One press: everything the tutorial changed is cleaned up and the game is in its normal state. */
    skip: function () {
      if (!this.active) return;
      SE.Audio.play('click', { volume: 0.5 });
      this.end(false);
    },

    end: function (completed) {
      var wasReplay = this.replay;
      this.active = false;
      if (this.finishTimer) { SE.Tasks.clear(this.finishTimer); this.finishTimer = null; }
      if (this.gaveInvisible && !this.wasInvisible) SE.Boosts.clear('invisible');
      this.gaveInvisible = false;
      this.removeBeacon();
      if (this.el) this.el.classList.remove('show');
      if (this.marker) this.marker.classList.remove('show');
      var ui = document.getElementById('ui');
      ui.classList.remove('tutorial-on');
      ['joystick', 'btnAction', 'btnJump'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) b.classList.remove('tut-pulse');
      });
      SE.UI.setHint('');
      SE.State.data.tutorialDone = true;
      SE.State.save();
      SE.UI.updateHUD();
      if (SE.Input.reset) SE.Input.reset();
      if (!wasReplay && completed) SE.Daily.maybeOffer(true);
    },

    finish: function () {
      var self = this;
      if (!this.active || this.step >= STEPS) return;
      this.step = STEPS;
      this.render(true);
      SE.Audio.play('reward', { volume: 0.7 });
      if (SE.FX && SE.Player) SE.FX.burst('confetti', SE.Player.pos);
      this.finishTimer = SE.Tasks.timeout(function () { self.end(true); }, 3600);
    },

    go: function (n) {
      if (!this.active || n <= this.step) return;
      this.step = n;
      SE.Audio.play('powerup', { volume: 0.45 });
      this.render(true);
    },

    /* ---------- events from the game ---------- */
    onStolen: function () { if (this.active && this.step < 3) this.go(3); },
    onDelivered: function (penIndex) {
      if (!this.active) return;
      if (this.step < 3) this.step = 3;
      if (penIndex >= 0 && SE.State.data.pens[penIndex] && SE.State.data.pens[penIndex].egg) {
        var pen = SE.State.data.pens[penIndex];
        this.penIndex = penIndex;
        pen.hatchAt = Date.now() + TUTORIAL_HATCH * 1000;   /* the first egg hatches fast */
        pen.duration = TUTORIAL_HATCH;
        this.go(4);
      } else this.finish();
    },
    onCollected: function () { if (this.active && this.step === 4) this.finish(); },
    /* Being caught during the tutorial costs nothing: back to stealing another egg. */
    onCaught: function () {
      if (!this.active) return;
      this.step = 2;
      SE.UI.toast(SE.t('msg.tutorialCaught'), 'error');
      this.render(true);
    },

    /* ---------- targets ---------- */
    nestTarget: function () {
      var best = null, bd = 1e9, p = SE.Player.pos, nests = SE.World.nests || [];
      for (var i = 0; i < nests.length; i++) {
        var n = nests[i];
        if (!n.zone || n.zone.index !== 0 || n.taken) continue;
        var d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    },

    target: function () {
      switch (this.step) {
        case 1: case 2:
          var n = this.nestTarget();
          return n ? { x: n.x, z: n.z, key: 'tut.target.nest' } : null;
        case 3: return { x: 0, z: -(SE.World.HUB_R + 10), key: 'tut.target.base' };
        case 4:
          var pen = SE.World.pens[this.penIndex];
          return pen ? { x: pen.x, z: pen.z, key: 'tut.target.pen' } : null;
      }
      return null;
    },

    /* ---------- world beacon ---------- */
    makeBeacon: function () {
      if (this.beacon || !SE.Game.scene) return;
      var g = new T.Group();
      var beamMat = new T.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.26, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, fog: false });
      var beam = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 70, 18, 1, true), beamMat);
      beam.position.y = 35;
      var ringMat = new T.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85, depthWrite: false, side: T.DoubleSide, fog: false });
      var ring = new T.Mesh(new T.RingGeometry(3.4, 4.3, 40), ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25;
      var arrowMat = new T.MeshBasicMaterial({ color: 0xffd23a, fog: false });
      var arrow = new T.Mesh(new T.ConeGeometry(2.4, 4.6, 4), arrowMat);
      arrow.rotation.x = Math.PI; arrow.position.y = 13;
      [beam, ring, arrow].forEach(function (m) { m.renderOrder = 20; m.frustumCulled = false; });
      g.add(beam); g.add(ring); g.add(arrow);
      g.visible = false;
      SE.Game.scene.add(g);
      this.beacon = { group: g, beam: beam, ring: ring, arrow: arrow, mats: [beamMat, ringMat, arrowMat] };
    },

    removeBeacon: function () {
      var b = this.beacon;
      if (!b) return;
      if (b.group.parent) b.group.parent.remove(b.group);
      b.group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      b.mats.forEach(function (m) { m.dispose(); });
      this.beacon = null;
    },

    /* ---------- card ---------- */
    textFor: function () {
      var kb = !SE.Platform.isMobile;
      switch (this.step) {
        case 0: return SE.t(kb ? 'tut.move.kb' : 'tut.move.touch');
        case 1: return SE.t('tut.go');
        case 2: return SE.t(kb ? 'tut.steal.kb' : 'tut.steal.touch');
        case 3: return SE.t('tut.run');
        case 4:
          var st = SE.State.data.pens[this.penIndex];
          return st && st.pet ? SE.t(kb ? 'tut.collect.kb' : 'tut.collect.touch') : SE.t('tut.wait');
      }
      return SE.t('tut.done');
    },

    /* Rebuilds the card (text, key caps / button icon, dots, skip label, highlighted controls). */
    render: function (force) {
      if (!this.el) return;
      var kb = !SE.Platform.isMobile;
      var done = this.step >= STEPS;
      var text = this.textFor();
      var sig = this.step + '|' + text + '|' + kb;
      if (!force && sig === this.lastText) return;
      this.lastText = sig;
      var el = this.el;
      el.classList.toggle('done', done);
      el.querySelector('.tut-step').textContent = done ? SE.t('tut.finish') : SE.t('tut.step', this.step + 1, STEPS);
      var dots = '';
      for (var i = 0; i < STEPS; i++) dots += '<i class="' + (i < this.step ? 'on' : (i === this.step ? 'cur' : '')) + '"></i>';
      el.querySelector('.tut-dots').innerHTML = dots;
      el.querySelector('.tut-text').textContent = text;
      el.querySelector('.tut-skip').textContent = SE.t('tut.skip');
      el.querySelector('.tut-skip').style.display = done ? 'none' : '';

      /* the controls this step needs, as the same icons / keys the player sees in the HUD */
      var keys = '', ic = '';
      var wantAction = this.step === 2 || (this.step === 4 && SE.State.data.pens[this.penIndex] && SE.State.data.pens[this.penIndex].pet);
      if (this.step === 0 && kb) keys = '<span class="key" data-k="KeyW,ArrowUp">W</span><span class="key" data-k="KeyA,ArrowLeft">A</span><span class="key" data-k="KeyS,ArrowDown">S</span><span class="key" data-k="KeyD,ArrowRight">D</span>';
      else if (wantAction && kb) keys = '<span class="key" data-k="KeyE">E</span>';
      if (this.step === 0 && !kb) ic = '<span class="tut-joy"><i></i></span>';
      else if (wantAction && !kb) ic = SE.Icons.html('interact-hand');
      else if (done) ic = SE.Icons.html('trophy');
      var icBox = el.querySelector('.tut-ic');
      icBox.innerHTML = keys || ic;
      icBox.classList.toggle('keys', !!keys);
      icBox.style.display = keys || ic ? '' : 'none';

      var joy = document.getElementById('joystick'), act = document.getElementById('btnAction');
      if (joy) joy.classList.toggle('tut-pulse', !kb && this.step === 0);
      if (act) act.classList.toggle('tut-pulse', !kb && !!wantAction);
    },

    /* ---------- per frame ---------- */
    update: function (dt) {
      if (!this.active) return;
      var G = SE.Game, p = SE.Player.pos;

      /* completion by action */
      if (this.step === 0) {
        if (this.lastPos) this.moved += Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
        if (!this.lastPos) this.lastPos = { x: 0, z: 0 };
        this.lastPos.x = p.x; this.lastPos.z = p.z;
        if (this.moved >= MOVE_DISTANCE) this.go(1);
      }
      if (G.carrying && this.step < 3) this.go(3);
      if (this.step === 1) {
        var n = this.nestTarget();
        if (n && Math.hypot(n.x - p.x, n.z - p.z) < NEAR_NEST) this.go(2);
      }
      if (this.step === 4) {
        var st = SE.State.data.pens[this.penIndex];
        if (!st || (!st.egg && !st.pet)) this.finish();     /* collected some other way */
        else if (st.pet) this.render(false);                 /* the text changes when the pet is ready */
      }

      /* the player is never lost to a guard while learning to run home */
      if (G.carrying && (this.step === 3 || this.step === 2) && !SE.Boosts.isActive('invisible')) {
        SE.Boosts.activate('invisible', 25);
        this.gaveInvisible = true;
      }

      /* input mode switched (keys <-> touch) */
      if (this.lastMode !== SE.Platform.inputMode) { this.lastMode = SE.Platform.inputMode; this.render(true); }

      /* pressed keys light up */
      var keys = this.el.querySelectorAll('.key');
      for (var k = 0; k < keys.length; k++) {
        var codes = keys[k].getAttribute('data-k').split(','), on = false;
        for (var c = 0; c < codes.length; c++) if (SE.Input.keys[codes[c]]) on = true;
        keys[k].classList.toggle('down', on);
      }

      this.updatePointer(dt);
    },

    /* beacon in the world + marker on the screen (clamped to the screen edge when off-screen) */
    updatePointer: function () {
      var t = this.step < STEPS ? this.target() : null;
      var b = this.beacon, m = this.marker, G = SE.Game;
      if (!t) {
        if (b) b.group.visible = false;
        m.classList.remove('show');
        return;
      }
      var time = G.time;
      if (b) {
        b.group.visible = true;
        b.group.position.set(t.x, 0, t.z);
        b.arrow.position.y = 13 + Math.sin(time * 4) * 1.1;
        b.arrow.rotation.y = time * 2;
        var k = 1 + Math.sin(time * 3) * 0.18;
        b.ring.scale.set(k, k, k);
        b.mats[0].opacity = 0.2 + Math.sin(time * 3) * 0.06;
      }
      var W = global.innerWidth, H = global.innerHeight;
      var v = new T.Vector3(t.x, 9, t.z).project(G.camera);
      var behind = v.z > 1;
      var sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
      if (behind) { sx = W - sx; sy = H - sy; }
      var card = this.el.getBoundingClientRect();
      var padX = 76, padTop = Math.max(70, card.bottom + 26), padBottom = 90;
      var off = behind || sx < padX || sx > W - padX || sy < padTop || sy > H - padBottom;
      var dist = Math.hypot(t.x - SE.Player.pos.x, t.z - SE.Player.pos.z);
      var label = SE.t(t.key) + ' · ' + SE.t('tut.dist', Math.max(1, Math.round(dist / 5) * 5));
      var angle = 180;
      if (off) {
        var cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
        if (behind) { dx = -dx; dy = -dy; if (Math.abs(dx) + Math.abs(dy) < 1) dy = 1; }
        angle = Math.atan2(dx, -dy) * 180 / Math.PI;
        var kx = dx !== 0 ? (W / 2 - padX) / Math.abs(dx) : 1e9, ky = dy !== 0 ? (dy > 0 ? (H / 2 - padBottom) : (cy - padTop)) / Math.abs(dy) : 1e9;
        var kk = Math.min(kx, ky);
        sx = cx + dx * kk; sy = cy + dy * kk;
      }
      m.classList.add('show');
      m.classList.toggle('edge', off);
      m.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px)';
      m.querySelector('.tut-arrow').style.transform = 'rotate(' + angle.toFixed(1) + 'deg)';
      var lab = m.querySelector('.tut-label');
      if (lab.textContent !== label) lab.textContent = label;
    }
  };

  SE.Tutorial = Tutorial;
})(window);
