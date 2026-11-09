/* =========================================================
   Процедурные модели в блочном мультяшном стиле
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U;
  var T = global.THREE;

  var matCache = {};
  var studCache = {};

  /* Square raised studs, with a small bevel on the upper/left edges. */
  function studTexture(base, dark, size, cells) {
    size = size || 256; cells = cells || 4;
    var canvas = U.canvas(size, size), ctx = canvas.getContext('2d');
    var step = size / cells;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (var y = 0; y < cells; y++) {
      for (var x = 0; x < cells; x++) {
        var sx = x * step + step * 0.28, sy = y * step + step * 0.27;
        var sw = step * 0.42, bevel = Math.max(1, step * 0.07);
        ctx.fillStyle = dark || '#000000'; ctx.globalAlpha = 0.32;
        ctx.fillRect(sx + bevel, sy + bevel, sw, sw);
        ctx.fillStyle = base; ctx.globalAlpha = 1;
        ctx.fillRect(sx, sy, sw, sw);
        ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.24;
        ctx.fillRect(sx, sy, sw, bevel);
        ctx.fillRect(sx, sy, bevel, sw);
        ctx.fillStyle = dark || '#000000'; ctx.globalAlpha = 0.25;
        ctx.fillRect(sx + sw - bevel, sy + bevel, bevel, sw - bevel);
        ctx.fillRect(sx + bevel, sy + sw - bevel, sw - bevel, bevel);
      }
    }
    ctx.globalAlpha = 0.13; ctx.strokeStyle = dark || '#000000'; ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size); ctx.globalAlpha = 1;
    return canvas;
  }

  function studMat(color, width, height, density) {
    density = density || 0.8;
    var key = color + ':' + width + ':' + height + ':' + density;
    if (studCache[key]) return studCache[key];
    var texture = new T.CanvasTexture(studTexture(color, '#182000', 128, 4));
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(width / (4 * density), height / (4 * density));
    texture.anisotropy = 4;
    if (T.sRGBEncoding !== undefined) texture.encoding = T.sRGBEncoding;
    return studCache[key] = new T.MeshLambertMaterial({ map: texture });
  }

  function mat(color, opts) {
    opts = opts || {};
    var key = color + '|' + (opts.emissive || '') + '|' + (opts.opacity === undefined ? 1 : opts.opacity) + '|' + (opts.flat ? 1 : 0);
    if (matCache[key]) return matCache[key];
    var m = new T.MeshLambertMaterial({
      color: new T.Color(color),
      emissive: new T.Color(opts.emissive || '#000000'),
      transparent: opts.opacity !== undefined && opts.opacity < 1,
      opacity: opts.opacity === undefined ? 1 : opts.opacity,
      flatShading: !!opts.flat
    });
    matCache[key] = m;
    return m;
  }

  function box(w, h, d, color, opts) {
    var geometry = new T.BoxGeometry(w, h, d);
    var material = mat(color, opts);
    if (opts && opts.studs) {
      /* Scale UVs per face, keeping one material and one draw call per block. */
      material = studMat(color, 3.2, 3.2);
      var faceSizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      var uv = geometry.attributes.uv;
      for (var face = 0; face < 6; face++) {
        for (var vertex = 0; vertex < 4; vertex++) {
          var index = face * 4 + vertex;
          uv.setXY(index, uv.getX(index) * faceSizes[face][0] / 3.2, uv.getY(index) * faceSizes[face][1] / 3.2);
        }
      }
    }
    var m = new T.Mesh(geometry, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function cyl(rt, rb, h, color, seg, opts) {
    var m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 10), mat(color, opts));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function sph(r, color, opts, seg) {
    var m = new T.Mesh(new T.SphereGeometry(r, seg || 12, seg || 10), mat(color, opts));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function cone(r, h, color, seg, opts) {
    var m = new T.Mesh(new T.ConeGeometry(r, h, seg || 8), mat(color, opts));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function at(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

  /* ---------------- Персонаж (модель из Blender) ----------------
     Части: Body (бёдра), Torso, Head, EyeL/EyeR, ArmL/ArmR, LegL/LegR,
     причёски Hair_swept | Hair_spiky | Hair_long | Hair_bob. */
  var HAIR_STYLES = ['swept', 'spiky', 'long', 'bob'];

  function makeCharacter(opts) {
    opts = opts || {};
    if (!SE.Assets || !SE.Assets.has('Character')) return makeCharacterLegacy(opts);
    var material = SE.Assets.material({
      tints: [opts.shirt || '#c8323c', opts.pants || '#3b4252', opts.hair || '#e08a2c',
        opts.skin || '#ffe2c6', opts.undershirt || '#f4efe2'],
      rim: 0.16
    });
    var g = new T.Group();
    var model = SE.Assets.clone('Character', material);
    g.add(model);
    var P = SE.Assets.parts(model);
    var style = opts.hairStyle || 'spiky';
    var worn = { hat: null, face: null, back: null };
    var wornObj = { hat: null, face: null, back: null };
    function showHair() {
      /* Под шляпой торчащие «шипы» прячем — их заменяет зачёс. */
      var s = worn.hat && style === 'spiky' ? 'swept' : style;
      HAIR_STYLES.forEach(function (h) { if (P['Hair_' + h]) P['Hair_' + h].visible = h === s; });
    }
    showHair();
    var body = P.Body, torso = P.Torso, head = P.Head;
    function wear(slot, node) {
      if (wornObj[slot]) { wornObj[slot].parent.remove(wornObj[slot]); wornObj[slot] = null; }
      worn[slot] = node || null;
      if (!node || !SE.Assets.has(node)) return;
      if (!SE.Assets.cosmeticMaterial) SE.Assets.cosmeticMaterial = SE.Assets.material({ rim: 0.16 });
      var obj = SE.Assets.clone(node, SE.Assets.cosmeticMaterial);
      obj.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });
      (slot === 'back' ? torso : head).add(obj);
      wornObj[slot] = obj;
    }
    var armL, armR, legL, legR, eyes, bodyY, extras;
    var rnd = Math.random;
    /* Привязка анимации к частям: обычный аватар или полноразмерный скин (Skin_*). */
    function bindRig(Q) {
      body = Q.Body; torso = Q.Torso || Q.Body; head = Q.Head || Q.Body;
      armL = Q.ArmL || null; armR = Q.ArmR || null; legL = Q.LegL || null; legR = Q.LegR || null;
      eyes = [Q.EyeL, Q.EyeR].filter(Boolean);
      if (body.userData.baseY === undefined) body.userData.baseY = body.position.y;
      bodyY = body.userData.baseY;
      extras = { spin: Q.Spin || null, tail: Q.Tail || null, pupils: [Q.PupilL, Q.PupilR].filter(Boolean) };
      extras.pupils.forEach(function (o) { if (o.userData.baseX === undefined) o.userData.baseX = o.position.x; });
      if (api) { api.head = head; api.torso = torso; api.armL = armL; api.armR = armR; api.legL = legL; api.legR = legR; }
    }
    var api = null;
    bindRig(P);
    var skinId = null, skinModel = null, skinMat = null;
    function setSkin(id) {
      skinId = id || null;
      if (!skinId) {
        if (skinModel) { g.remove(skinModel); skinModel = null; }
        model.visible = true;
        bindRig(P);
        api.carryY = null;
        api.carryZ = null;
        if (api.onSkin) api.onSkin(api);
        return;
      }
      SE.Assets.ensure('skins/' + skinId).then(function (ok) {
        var node = 'Skin_' + id.replace(/^skin_/, '');
        if (skinId !== id || !ok || !SE.Assets.has(node)) return;
        if (skinModel) g.remove(skinModel);
        if (!skinMat) skinMat = SE.Assets.material({ rim: 0.18 });
        skinModel = SE.Assets.clone(node, skinMat);
        g.add(skinModel);
        model.visible = false;
        var Q = SE.Assets.parts(skinModel);
        bindRig(Q);
        api.carryY = Q.Carry ? Q.Carry.position.y : null;
        api.carryZ = Q.Carry ? Q.Carry.position.z : null;
        if (api.onSkin) api.onSkin(api);
      });
    }
    function rx(o, v) { if (o) o.rotation.x = v; }
    function rz(o, v) { if (o) o.rotation.z = v; }

    function damp(a, b, k, dt) { return a + (b - a) * (1 - Math.exp(-k * dt)); }

    api = {
      group: g,
      model: model,
      material: material,
      head: head, torso: torso,
      armL: armL, armR: armR, legL: legL, legR: legR,
      t: rnd() * 10,
      carry: null,
      run: 0, air: 0, carryK: 0,
      squash: 0, squashV: 0,
      blink: 1 + rnd() * 3,
      cheer: 0,
      wasGrounded: true,
      look: 0,
      /* Короткий «подскок» при приземлении (вызывается автоматически). */
      /* Внешний вид: { tints: [куртка, брюки, волосы, кожа, футболка], hairStyle, hat, face, back, glow }.
         Отсутствующие поля не меняются; hat/face/back — имя узла из cosmetics.glb или null. */
      setLook: function (look) {
        look = look || {};
        if (look.tints) {
          for (var i = 0; i < 5; i++) if (look.tints[i]) material.userData.u.uTint.value[i].set(look.tints[i]);
        }
        if (look.hairStyle && HAIR_STYLES.indexOf(look.hairStyle) >= 0) style = look.hairStyle;
        if ('hat' in look) wear('hat', look.hat);
        if ('face' in look) wear('face', look.face);
        if ('back' in look) wear('back', look.back);
        if ('glow' in look) material.userData.u.uRim.value = 0.16 + (look.glow || 0) * 0.6;
        if ('skin' in look && (look.skin || null) !== skinId) setSkin(look.skin);
        showHair();
      },
      skinId: function () { return skinId; },
      carryY: null,
      worn: worn,
      wornObj: wornObj,
      land: function (power) { this.squashV -= Math.min(5, 2 + power * 0.08); },
      jump: function () { this.squashV += 3.2; },
      celebrate: function (sec) { this.cheer = sec || 1.6; },
      update: function (dt, moving, speedFactor, grounded) {
        grounded = grounded !== false;
        if (grounded && !this.wasGrounded) this.land(10);
        if (!grounded && this.wasGrounded) this.jump();
        this.wasGrounded = grounded;
        var sf = Math.min(2.4, Math.max(0.6, speedFactor || 1));
        this.run = damp(this.run, moving ? 1 : 0, 10, dt);
        this.air = damp(this.air, grounded ? 0 : 1, 14, dt);
        this.carryK = damp(this.carryK, this.carry ? 1 : 0, 10, dt);
        this.t += dt * (6 + 5.5 * sf * this.run);
        var s = Math.sin(this.t), c = Math.cos(this.t);
        var run = this.run * (1 - this.air);
        var idle = 1 - this.run;

        /* пружина приседания */
        this.squashV += (-this.squash * 90 - this.squashV * 11) * dt;
        this.squash += this.squashV * dt;
        var sq = Math.max(-0.22, Math.min(0.22, this.squash));
        body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);

        /* ноги */
        var legAmp = 0.95 * run;
        rx(legL, -s * legAmp + this.air * -0.75);
        rx(legR, s * legAmp + this.air * 0.35);
        /* руки: бег / прыжок / переноска / радость */
        var armAmp = 0.85 * run;
        var ax = s * armAmp - this.air * 2.3 + idle * Math.sin(this.t * 0.5) * 0.04;
        var bx = -s * armAmp - this.air * 2.0 - idle * Math.sin(this.t * 0.5) * 0.04;
        var az = 0.06 + this.air * 0.35;
        if (this.cheer > 0) {
          this.cheer -= dt;
          var w = Math.sin(this.t * 2.2) * 0.35;
          ax = -2.9 + w; bx = -2.9 - w; az = 0.35;
        }
        var ck = this.carryK;
        rx(armL, ax * (1 - ck) + (-2.75 + Math.sin(this.t * 0.6) * 0.05) * ck);
        rx(armR, bx * (1 - ck) + (-2.75 - Math.sin(this.t * 0.6) * 0.05) * ck);
        rz(armL, -az * (1 - ck) + 0.3 * ck);
        rz(armR, az * (1 - ck) - 0.3 * ck);
        /* корпус: покачивание, наклон, поворот плеч */
        body.position.y = bodyY + Math.abs(c) * 0.22 * run + idle * Math.sin(this.t * 0.5) * 0.02;
        torso.rotation.x = 0.13 * run + this.air * -0.1 - ck * 0.05;
        torso.rotation.y = s * 0.14 * run;
        torso.rotation.z = c * 0.03 * run;
        if (torso !== body) torso.scale.y = 1 + idle * Math.sin(this.t * 0.5) * 0.012;
        head.rotation.y = -s * 0.1 * run + idle * Math.sin(this.t * 0.17) * 0.25 * (1 - ck);
        head.rotation.x = -0.08 * run + ck * -0.12;
        /* моргание */
        this.blink -= dt;
        var e = 1;
        if (this.blink < 0.12) e = 0.12;
        if (this.blink < 0) this.blink = 1.8 + rnd() * 3.2;
        for (var ei = 0; ei < eyes.length; ei++) eyes[ei].scale.y = e;
        /* детали скинов: пропеллер, хвост, бегающие зрачки */
        if (extras.spin) extras.spin.rotation.z += dt * (8 + 22 * this.run);
        if (extras.tail) extras.tail.rotation.y = Math.sin(this.t * (moving ? 1 : 0.6)) * (0.25 + 0.2 * this.run);
        for (var pi = 0; pi < extras.pupils.length; pi++) {
          var pp = extras.pupils[pi];
          pp.position.x = pp.userData.baseX + Math.sin(this.t * 0.23) * 0.09;
        }
        /* крылья/плащ за спиной покачиваются */
        var back = wornObj.back;
        if (back) {
          if (!back.userData.flaps) {
            back.userData.flaps = [];
            back.traverse(function (o) { if (/^Flap/.test(o.name)) back.userData.flaps.push(o); });
          }
          var fl = back.userData.flaps;
          for (var k = 0; k < fl.length; k++) {
            var fname = fl[k].name.replace(/^(.+?)_?\d{3}$/, '$1');
            if (fname === 'Flap') {
              /* плащ: на бегу отлетает назад и полощется */
              fl[k].rotation.x = -(0.08 + run * 0.45 + this.air * 0.3) - Math.abs(Math.sin(this.t * 1.3)) * (0.04 + run * 0.12);
            } else {
              /* крылья: медленный взмах в покое, быстрее на бегу */
              var sideK = fname === 'FlapR' ? 1 : -1;
              fl[k].rotation.y = sideK * (0.15 + Math.sin(this.t * (0.5 + this.run * 0.6)) * (0.12 + this.run * 0.2));
            }
          }
          back.rotation.x = 0.06 * run + Math.sin(this.t) * 0.03 * run;
        }
      }
    };
    return api;
  }

  /* Резервная процедурная модель (если GLB не загрузился). */
  function makeCharacterLegacy(opts) {
    opts = opts || {};
    var g = new T.Group();
    var shirt = opts.shirt || '#c8323c';
    var pants = opts.pants || '#3b4252';
    var skin = opts.skin || '#fffef4';
    var hair = opts.hair || '#e08a2c';
    var hairHighlight = opts.hairHighlight || new T.Color(hair).lerp(new T.Color('#f6c678'), 0.22).getStyle();
    var undershirt = opts.undershirt || '#f4efe2';

    /* Торс */
    var torso = box(2, 2, 1, shirt);
    torso.position.y = 3.1;
    g.add(torso);

    /* Синяя футболка видна между открытыми полами чёрной куртки. */
    var tie = box(0.92, 1.8, 0.08, undershirt);
    tie.position.set(0, 3.12, 0.55);
    g.add(tie);
    [-1, 1].forEach(function (side) {
      var lapel = box(0.25, 1.15, 0.13, '#252b2e');
      lapel.position.set(side * 0.46, 3.52, 0.61);
      lapel.rotation.z = side * -0.17;
      g.add(lapel);
    });

    /* Голова + лицо */
    var headGroup = new T.Group();
    headGroup.position.y = 4.9;
    var faceCanvas = U.canvas(128, 128), faceCtx = faceCanvas.getContext('2d');
    faceCtx.fillStyle = skin; faceCtx.fillRect(0, 0, 128, 128);
    faceCtx.fillStyle = '#171c21';
    faceCtx.beginPath(); faceCtx.ellipse(42, 49, 5, 10, 0, 0, Math.PI * 2); faceCtx.fill();
    faceCtx.beginPath(); faceCtx.ellipse(87, 49, 5, 10, 0, 0, Math.PI * 2); faceCtx.fill();
    faceCtx.strokeStyle = '#171c21'; faceCtx.lineWidth = 5; faceCtx.lineCap = 'round';
    faceCtx.beginPath(); faceCtx.arc(64, 64, 25, 0.18, Math.PI - 0.18); faceCtx.stroke();
    var faceTex = new T.CanvasTexture(faceCanvas);
    if (T.sRGBEncoding !== undefined) faceTex.encoding = T.sRGBEncoding;
    faceTex.magFilter = T.NearestFilter;
    var headMats = [
      mat(skin), mat(skin), mat(skin), mat(skin),
      new T.MeshLambertMaterial({ map: faceTex }), mat(skin)
    ];
    var head = new T.Mesh(new T.BoxGeometry(1.4, 1.4, 1.4), headMats);
    head.castShadow = true;
    headGroup.add(head);

    /* Пряди каштановых волос с характерной зачёсанной чёлкой. */
    var hairTop = sph(0.82, hair, { flat: false }, 12);
    hairTop.scale.set(1, 0.67, 0.96);
    hairTop.position.y = 0.64;
    headGroup.add(hairTop);
    for (var i = 0; i < 9; i++) {
      var tuft = sph(0.3, i % 3 === 0 ? hairHighlight : hair, {}, 10);
      tuft.scale.set(0.73, 1.3, 1.7);
      tuft.position.set(-0.66 + (i % 5) * 0.32, 0.66 + (i < 5 ? 0.06 : 0.22), i < 5 ? 0.12 : -0.25);
      tuft.rotation.z = -0.3 + (i % 5) * 0.13;
      headGroup.add(tuft);
    }
    var fringe = sph(0.32, hairHighlight, {}, 10);
    fringe.scale.set(0.7, 1.65, 0.7);
    fringe.position.set(0.43, 0.32, 0.71); fringe.rotation.z = 0.65;
    headGroup.add(fringe);
    var hairBack = sph(0.72, hair, {}, 12);
    hairBack.scale.set(1, 0.65, 0.53);
    hairBack.position.set(0, 0.35, -0.47);
    headGroup.add(hairBack);
    for (var backStrand = 0; backStrand < 5; backStrand++) {
      var strand = sph(0.23, backStrand % 2 ? hairHighlight : hair, {}, 10);
      strand.scale.set(0.84, 1.8, 0.92);
      strand.position.set(-0.56 + backStrand * 0.28, 0.4, -0.65);
      strand.rotation.z = -0.22 + backStrand * 0.11;
      headGroup.add(strand);
    }
    g.add(headGroup);

    /* Руки */
    function arm(side) {
      var pivot = new T.Group();
      pivot.position.set(side * 1.5, 4.0, 0);
      /* Only the forearm is skin. A full arm underneath the sleeve had an
         exposed, coplanar shoulder cap that flickered white through the shirt. */
      var sleeve = box(0.95, 1.28, 0.95, shirt);
      sleeve.position.y = -0.64;
      pivot.add(sleeve);
      var forearm = box(0.9, 0.72, 0.9, skin);
      forearm.position.y = -1.64;
      pivot.add(forearm);
      g.add(pivot);
      return pivot;
    }
    var armL = arm(-1), armR = arm(1);

    /* Ноги */
    function leg(side) {
      var pivot = new T.Group();
      pivot.position.set(side * 0.5, 2.1, 0);
      /* Pants, shoe upper, and sole meet at separate heights, without a leg
         continuing through the shoe. The sole also ends exactly at ground y=0. */
      var l = box(0.95, 1.58, 0.95, pants);
      l.position.y = -0.79;
      pivot.add(l);
      var shoe = box(1.08, 0.24, 1.24, '#ffffff');
      shoe.position.set(0, -1.98, 0.1);
      pivot.add(shoe);
      var shoeTop = box(1.02, 0.28, 1.2, '#181c1d');
      shoeTop.position.set(0, -1.72, 0.1); pivot.add(shoeTop);
      g.add(pivot);
      return pivot;
    }
    var legL = leg(-1), legR = leg(1);

    var api = {
      group: g,
      head: headGroup,
      torso: torso,
      armL: armL, armR: armR, legL: legL, legR: legR,
      t: 0,
      carry: null,
      update: function (dt, moving, speedFactor, grounded) {
        grounded = grounded !== false;
        this.t += dt * (moving ? 9 * Math.min(2.2, speedFactor || 1) : 3);
        var s = Math.sin(this.t);
        var amp = moving ? 0.85 : 0.08;
        armL.rotation.x = s * amp;
        armR.rotation.x = -s * amp;
        legL.rotation.x = -s * amp;
        legR.rotation.x = s * amp;
        if (!grounded) {
          armL.rotation.x = -2.2; armR.rotation.x = -2.2;
          legL.rotation.x = 0.4; legR.rotation.x = -0.4;
        }
        if (this.carry) {
          armL.rotation.x = -1.5; armR.rotation.x = -1.5;
        }
        headGroup.rotation.y = Math.sin(this.t * 0.3) * 0.05;
        /* World position belongs to Player; changing it here erased jumps. */
        torso.rotation.z = moving && grounded ? s * 0.025 : 0;
      }
    };
    return api;
  }

  /* ---------------- Охранники ---------------- */
  function makeGuardLegacy(type, colorSet) {
    var g = new T.Group();
    var c = colorSet || {};
    var body = c.body || '#ffffff';
    var accent = c.accent || '#ff9f1a';
    var dark = c.dark || '#e05a1a';
    var scale = c.scale || 1;

    var root = new T.Group();
    g.add(root);

    /* тело */
    var b = box(2.6 * scale, 2.2 * scale, 3.6 * scale, body);
    b.position.y = 2.4 * scale;
    root.add(b);

    /* хвост */
    var tail = box(1.2 * scale, 1.4 * scale, 0.5 * scale, body);
    tail.position.set(0, 3.2 * scale, -1.9 * scale);
    tail.rotation.x = -0.4;
    root.add(tail);

    /* шея + голова */
    var neck = box(1.1 * scale, 1.4 * scale, 1.1 * scale, body);
    neck.position.set(0, 3.6 * scale, 1.2 * scale);
    root.add(neck);

    var headG = new T.Group();
    headG.position.set(0, 4.6 * scale, 1.4 * scale);
    var head = box(1.5 * scale, 1.4 * scale, 1.5 * scale, body);
    headG.add(head);

    /* глаза */
    var eyeL = box(0.28 * scale, 0.36 * scale, 0.1 * scale, '#1a1a1a');
    eyeL.position.set(-0.4 * scale, 0.15 * scale, 0.78 * scale);
    headG.add(eyeL);
    var eyeR = eyeL.clone();
    eyeR.position.x = 0.4 * scale;
    headG.add(eyeR);

    /* клюв / морда */
    if (type === 'chicken' || type === 'ostrich' || type === 'griffin') {
      var beak = box(0.6 * scale, 0.45 * scale, 0.7 * scale, accent);
      beak.position.set(0, -0.25 * scale, 1.0 * scale);
      headG.add(beak);
      var comb = box(0.25 * scale, 0.5 * scale, 0.9 * scale, dark);
      comb.position.set(0, 0.9 * scale, 0.1 * scale);
      headG.add(comb);
      var wattle = box(0.3 * scale, 0.45 * scale, 0.25 * scale, dark);
      wattle.position.set(0, -0.7 * scale, 0.72 * scale);
      headG.add(wattle);
    } else {
      var snout = box(0.9 * scale, 0.6 * scale, 0.8 * scale, accent);
      snout.position.set(0, -0.3 * scale, 0.95 * scale);
      headG.add(snout);
      var horn1 = cone(0.24 * scale, 0.8 * scale, dark, 6);
      horn1.position.set(-0.45 * scale, 0.95 * scale, 0);
      headG.add(horn1);
      var horn2 = horn1.clone();
      horn2.position.x = 0.45 * scale;
      headG.add(horn2);
    }
    root.add(headG);

    /* крылья */
    var wingL = box(0.35 * scale, 1.3 * scale, 2.4 * scale, body);
    wingL.position.set(-1.45 * scale, 2.5 * scale, 0);
    root.add(wingL);
    var wingR = wingL.clone();
    wingR.position.x = 1.45 * scale;
    root.add(wingR);

    if (type === 'griffin' || type === 'magma') {
      var bigWingL = box(0.2 * scale, 1.8 * scale, 3.4 * scale, accent);
      bigWingL.position.set(-2.1 * scale, 3.4 * scale, -0.4 * scale);
      bigWingL.rotation.z = 0.4;
      root.add(bigWingL);
      var bigWingR = bigWingL.clone();
      bigWingR.position.x = 2.1 * scale;
      bigWingR.rotation.z = -0.4;
      root.add(bigWingR);
    }

    /* лапы */
    function foot(side) {
      var p = new T.Group();
      p.position.set(side * 0.7 * scale, 1.4 * scale, 0);
      var l = box(0.35 * scale, 1.4 * scale, 0.35 * scale, accent);
      l.position.y = -0.7 * scale;
      p.add(l);
      var f = box(0.5 * scale, 0.2 * scale, 0.9 * scale, accent);
      f.position.set(0, -1.4 * scale, 0.25 * scale);
      p.add(f);
      root.add(p);
      return p;
    }
    var footL = foot(-1), footR = foot(1);

    /* «!» над головой (тревога) */
    var alertTex = new T.CanvasTexture(U.signTexture('!', {
      width: 128, height: 256, fontSize: 200, color: '#ff1010', outlineColor: '#080808', outlineWidth: 25
    }));
    var alert = new T.Sprite(new T.SpriteMaterial({ map: alertTex, transparent: true, depthTest: false }));
    alert.scale.set(2.1, 4.2, 1);
    alert.position.set(0, 8.2 * scale, 0);
    alert.visible = false;
    alert.renderOrder = 20;
    g.add(alert);

    return {
      group: g,
      root: root,
      head: headG,
      alert: alert,
      wings: [wingL, wingR],
      feet: [footL, footR],
      t: Math.random() * 10,
      update: function (dt, moving, speed) {
        this.t += dt * (moving ? 10 : 2.5);
        var s = Math.sin(this.t);
        footL.rotation.x = s * (moving ? 1.0 : 0.1);
        footR.rotation.x = -s * (moving ? 1.0 : 0.1);
        wingL.rotation.z = 0.25 + Math.abs(s) * (moving ? 0.5 : 0.08);
        wingR.rotation.z = -0.25 - Math.abs(s) * (moving ? 0.5 : 0.08);
        headG.position.y = 4.6 * scale + Math.sin(this.t * 0.7) * 0.12;
        root.rotation.z = moving ? s * 0.05 : 0;
      }
    };
  }

  var GUARD_STYLES = {
    chicken:   { body: '#ffffff', accent: '#ffb300', dark: '#e02f2f', scale: 1.05 },
    ostrich:   { body: '#f0dcb0', accent: '#ff8a3d', dark: '#b05a2a', scale: 1.15 },
    gummy:     { body: '#ff7fd0', accent: '#fff0f6', dark: '#c0247f', scale: 1.1 },
    yetiguard: { body: '#e8f6ff', accent: '#7fc8f0', dark: '#3a86b8', scale: 1.25 },
    magma:     { body: '#8a2b1a', accent: '#ff8a1f', dark: '#ffcf4a', scale: 1.2 },
    griffin:   { body: '#e8d8a8', accent: '#ffd24a', dark: '#a07a20', scale: 1.3 }
  };

  /* ---------------- Питомцы ---------------- */
  function makePetLegacy(def, scale) {
    scale = scale || 1;
    var g = new T.Group();
    var glow = def.flags.indexOf('g') >= 0;
    var opts = glow ? { emissive: def.accent } : {};
    var body = def.body, accent = def.accent;
    var legs = [];

    function addLegs(w, h, z1, z2, color) {
      [[-w, z1], [w, z1], [-w, z2], [w, z2]].forEach(function (p) {
        var l = box(0.24, h, 0.24, color);
        l.position.set(p[0], h / 2, p[1]);
        g.add(l);
        legs.push(l);
      });
    }

    if (def.shape === 'quad') {
      var b = box(0.9, 0.72, 1.4, body, opts);
      b.position.y = 0.85;
      g.add(b);
      var h = box(0.72, 0.66, 0.66, body, opts);
      h.position.set(0, 1.28, 0.85);
      g.add(h);
      var snout = box(0.34, 0.28, 0.3, accent);
      snout.position.set(0, 1.16, 1.24);
      g.add(snout);
      var e1 = box(0.16, 0.2, 0.1, '#141414');
      e1.position.set(-0.2, 1.38, 1.02); g.add(e1);
      var e2 = e1.clone(); e2.position.x = 0.2; g.add(e2);
      addLegs(0.32, 0.5, 0.45, -0.45, accent);
      /* уши */
      var earH = def.flags.indexOf('e') >= 0 ? 0.7 : 0.3;
      var earL = box(0.2, earH, 0.12, accent);
      earL.position.set(-0.24, 1.62 + earH / 2 - 0.15, 0.8);
      g.add(earL);
      var earR = earL.clone(); earR.position.x = 0.24; g.add(earR);
      /* хвост */
      var tail = box(0.2, 0.2, 0.5, accent);
      tail.position.set(0, 1.0, -0.85);
      g.add(tail);
    } else if (def.shape === 'bird') {
      var bb = sph(0.55, body, opts);
      bb.scale.set(1, 0.95, 1.15);
      bb.position.y = 0.85;
      g.add(bb);
      var bh = sph(0.34, body, opts);
      bh.position.set(0, 1.42, 0.28);
      g.add(bh);
      var beak = cone(0.14, 0.3, accent, 6);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 1.38, 0.62);
      g.add(beak);
      var eb1 = box(0.1, 0.12, 0.08, '#141414');
      eb1.position.set(-0.14, 1.5, 0.3); g.add(eb1);
      var eb2 = eb1.clone(); eb2.position.x = 0.14; g.add(eb2);
      var f1 = box(0.14, 0.32, 0.14, accent);
      f1.position.set(-0.2, 0.2, 0); g.add(f1); legs.push(f1);
      var f2 = f1.clone(); f2.position.x = 0.2; g.add(f2); legs.push(f2);
    } else if (def.shape === 'blob') {
      var s1 = sph(0.62, body, opts);
      s1.scale.set(1.1, 0.9, 1);
      s1.position.y = 0.62;
      g.add(s1);
      var s2 = sph(0.36, body, opts);
      s2.position.set(0, 1.16, 0.05);
      g.add(s2);
      var be1 = box(0.12, 0.14, 0.1, '#141414');
      be1.position.set(-0.18, 1.2, 0.32); g.add(be1);
      var be2 = be1.clone(); be2.position.x = 0.18; g.add(be2);
      var mouth = box(0.3, 0.06, 0.06, '#141414');
      mouth.position.set(0, 1.02, 0.34); g.add(mouth);
    } else if (def.shape === 'dragon') {
      var db = box(0.85, 0.72, 1.5, body, opts);
      db.position.y = 0.95; g.add(db);
      var dh = box(0.7, 0.6, 0.8, body, opts);
      dh.position.set(0, 1.5, 0.95); g.add(dh);
      var jaw = box(0.5, 0.24, 0.5, accent);
      jaw.position.set(0, 1.22, 1.2); g.add(jaw);
      var de1 = box(0.14, 0.16, 0.1, '#ffe27a');
      de1.position.set(-0.2, 1.62, 1.2); g.add(de1);
      var de2 = de1.clone(); de2.position.x = 0.2; g.add(de2);
      addLegs(0.35, 0.55, 0.5, -0.5, accent);
      var dtail = box(0.24, 0.24, 0.9, body, opts);
      dtail.position.set(0, 1.0, -1.1); g.add(dtail);
    } else { /* bug */
      var ub = sph(0.5, body, opts);
      ub.scale.set(1.2, 0.7, 1.4);
      ub.position.y = 0.55; g.add(ub);
      var uh = sph(0.3, accent, opts);
      uh.position.set(0, 0.6, 0.72); g.add(uh);
      for (var i = 0; i < 6; i++) {
        var l2 = box(0.1, 0.36, 0.1, accent);
        l2.position.set((i % 2 ? 1 : -1) * 0.5, 0.2, -0.4 + Math.floor(i / 2) * 0.4);
        g.add(l2); legs.push(l2);
      }
    }

    /* Дополнительные детали */
    if (def.flags.indexOf('w') >= 0) {
      var wl = box(0.08, 0.6, 1.0, accent, { emissive: glow ? accent : '#000' });
      wl.position.set(-0.55, 1.25, -0.1);
      wl.rotation.z = 0.5; g.add(wl);
      var wr = wl.clone(); wr.position.x = 0.55; wr.rotation.z = -0.5; g.add(wr);
    }
    if (def.flags.indexOf('h') >= 0) {
      var horn = cone(0.12, 0.55, '#ffe27a', 6, { emissive: glow ? '#ffb300' : '#000' });
      horn.position.set(0, 1.85, 0.75);
      horn.rotation.x = -0.35;
      g.add(horn);
    }
    if (def.flags.indexOf('c') >= 0) {
      var crown = cyl(0.26, 0.3, 0.22, '#ffd24a', 8, { emissive: '#8a5a00' });
      crown.position.set(0, 1.82, 0.5);
      g.add(crown);
      for (var k = 0; k < 5; k++) {
        var spike = cone(0.06, 0.18, '#ffd24a', 5);
        var a = (k / 5) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.24, 2.0, 0.5 + Math.sin(a) * 0.24);
        g.add(spike);
      }
    }
    if (def.flags.indexOf('s') >= 0) {
      for (var m = 0; m < 4; m++) {
        var sp = cone(0.1, 0.3, accent, 5);
        sp.position.set(0, 1.35, 0.4 - m * 0.35);
        g.add(sp);
      }
    }

    g.scale.setScalar(scale);
    return {
      group: g,
      legs: legs,
      t: Math.random() * 6,
      update: function (dt, moving) {
        this.t += dt * (moving ? 11 : 3);
        var s = Math.sin(this.t);
        for (var i = 0; i < legs.length; i++) {
          legs[i].rotation.x = s * (i % 2 ? 0.6 : -0.6) * (moving ? 1 : 0.15);
        }
        g.position.y = moving ? Math.abs(s) * 0.12 : Math.sin(this.t * 0.5) * 0.05;
        g.rotation.z = moving ? s * 0.05 : 0;
      }
    };
  }

  /* ---------------- Яйцо ---------------- */
  function makeEggLegacy(colorA, colorB, scale, striped) {
    scale = scale || 1;
    var g = new T.Group();
    var geometry = new T.SphereGeometry(0.62, 24, 24);
    var points = geometry.attributes.position;
    for (var p = 0; p < points.count; p++) {
      var py = points.getY(p), taper = 1 - py * 0.26;
      points.setXYZ(p, points.getX(p) * taper, py * 1.43, points.getZ(p) * taper);
    }
    geometry.computeVertexNormals();
    var eggMaterial = mat(colorA);
    if (striped !== false) {
      var stripeCanvas = U.canvas(32, 256), stripeCtx = stripeCanvas.getContext('2d');
      stripeCtx.fillStyle = colorA; stripeCtx.fillRect(0, 0, 32, 256);
      stripeCtx.fillStyle = colorB;
      for (var stripe = 0; stripe < 5; stripe++) stripeCtx.fillRect(0, 22 + stripe * 49, 32, 22);
      var stripeMap = new T.CanvasTexture(stripeCanvas);
      if (T.sRGBEncoding !== undefined) stripeMap.encoding = T.sRGBEncoding;
      eggMaterial = new T.MeshLambertMaterial({ map: stripeMap });
    }
    var shell = new T.Mesh(geometry, eggMaterial);
    shell.castShadow = true;
    g.add(shell);
    g.scale.setScalar(scale);
    return g;
  }

  /* ---------------- Гнездо ---------------- */
  function makeNest(eggColor, eggStripe, big) {
    if (SE.Assets && SE.Assets.has('P_nest')) {
      var nest = SE.Assets.clone('P_nest');
      var wrapN = new T.Group();
      wrapN.add(nest);
      if (big) nest.scale.setScalar(1.8);
      return wrapN;
    }
    var g = new T.Group();
    var s = big ? 1.8 : 1;
    var dirt = new T.Mesh(new T.CylinderGeometry(3.2 * s, 3.8 * s, 0.7, 14), mat('#5a3a22'));
    dirt.position.y = 0.35;
    dirt.receiveShadow = true;
    g.add(dirt);
    var rim = new T.Mesh(new T.TorusGeometry(2.9 * s, 0.42 * s, 6, 16), mat('#6b4526'));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.72;
    rim.castShadow = true;
    g.add(rim);
    /* веточки */
    for (var i = 0; i < 18; i++) {
      var a = (i / 18) * Math.PI * 2;
      var stick = box(2.6 * s, 0.28, 0.4 * s, i % 3 ? '#8c642f' : '#b29250');
      stick.position.set(Math.cos(a) * 2.8 * s, 0.78 + (i % 3) * 0.12, Math.sin(a) * 2.8 * s);
      stick.rotation.y = -a + Math.PI / 2 + (i % 2 ? 0.15 : -0.15);
      g.add(stick);
    }
    return g;
  }

  /* ---------------- Забор ---------------- */
  function fenceSegment(len, colorPost, colorRail) {
    var g = new T.Group();
    var post = box(1.0, 3.8, 1.0, colorPost || '#744323', { studs: true });
    post.position.set(-len / 2, 1.7, 0);
    g.add(post);
    var post2 = post.clone();
    post2.position.x = len / 2;
    g.add(post2);
    [-len / 2, len / 2].forEach(function (x) {
      var cap = box(1.4, 0.3, 1.4, colorPost || '#744323', { studs: true });
      cap.position.set(x, 3.7, 0); g.add(cap);
    });
    for (var i = 0; i < 3; i++) {
      var rail = box(len, 0.45, 0.42, colorRail || '#b97631', { studs: true });
      rail.position.set(0, 0.9 + i * 0.9, 0);
      g.add(rail);
    }
    return g;
  }

  /* Прямоугольная ограда с разрывом (вход) */
  function fenceRect(w, d, opts) {
    opts = opts || {};
    var g = new T.Group();
    var seg = opts.seg || 8;
    var gapSide = opts.gapSide; /* 'north'|'south'|'east'|'west' */
    var post = opts.post, rail = opts.rail;

    function line(x0, z0, x1, z1, skipMiddle) {
      var dx = x1 - x0, dz = z1 - z0;
      var len = Math.sqrt(dx * dx + dz * dz);
      if (skipMiddle) {
        var gap = Math.min(opts.gap || 8, len - 2);
        var edge = (len - gap) / (2 * len);
        line(x0, z0, x0 + dx * edge, z0 + dz * edge, false);
        line(x1 - dx * edge, z1 - dz * edge, x1, z1, false);
        return;
      }
      var count = Math.max(1, Math.round(len / seg));
      for (var i = 0; i < count; i++) {
        var t0 = i / count, t1 = (i + 1) / count;
        var cx = x0 + dx * (t0 + t1) / 2;
        var cz = z0 + dz * (t0 + t1) / 2;
        var s = fenceSegment(len / count, post, rail);
        s.position.set(cx, 0, cz);
        s.rotation.y = -Math.atan2(dz, dx);
        g.add(s);
      }
    }
    line(-w / 2, -d / 2, w / 2, -d / 2, gapSide === 'north');
    line(-w / 2, d / 2, w / 2, d / 2, gapSide === 'south');
    line(-w / 2, -d / 2, -w / 2, d / 2, gapSide === 'west');
    line(w / 2, -d / 2, w / 2, d / 2, gapSide === 'east');
    return g;
  }

  /* ---------------- Прилавок продажи ---------------- */
  function makeStall(labelText, npcOptions) {
    var g = new T.Group();
    /* стойка */
    var counter = box(8, 2.95, 3.4, '#74471f', { studs: true });
    counter.position.y = 1.475;
    g.add(counter);
    var top = box(8.6, 0.4, 3.8, '#825322', { studs: true });
    top.position.y = 3.15;
    g.add(top);
    /* столбы */
    [-3.7, 3.7].forEach(function (x) {
      [-1.4, 1.4].forEach(function (z) {
        var p = box(0.5, 6.5, 0.5, '#8a5a2e', { studs: true });
        p.position.set(x, 3.2, z);
        g.add(p);
      });
    });
    /* полосатая крыша */
    for (var i = 0; i < 8; i++) {
      var stripe = box(1.15, 0.65, 5.4, i % 2 ? '#ff3a0d' : '#f8f7ec', { studs: true });
      stripe.position.set(-4.6 + 0.575 + i * 1.15, 6.6, 0);
      stripe.rotation.x = 0.13;
      g.add(stripe);
    }
    /* фонарь */
    var lamp = box(0.7, 1.0, 0.7, '#ffd24a', { emissive: '#ff9a00' });
    lamp.position.set(-3.2, 4.9, 1.5);
    g.add(lamp);
    [4.28, 5.51].forEach(function (y) { g.add(at(cyl(0.46, 0.46, 0.22, '#454840', 10), -3.2, y, 1.5)); });
    /* A complete avatar stands on the ground behind the back edge of the
       counter. Its arms and legs never pass through the wooden front. */
    var npcModel = makeCharacter(npcOptions || {
      shirt: '#32653a', undershirt: '#f6d877', pants: '#2d3027',
      skin: '#ffe4c8', hair: '#75451e', hairStyle: 'spiky'
    });
    var npc = npcModel.group;
    npc.scale.setScalar(0.9);
    npc.position.set(0, 0, -2.55);
    g.add(npc);
    return { group: g, npc: npc, npcModel: npcModel };
  }

  /* ---------------- Беговая дорожка ---------------- */
  function makeTreadmill() {
    var g = new T.Group();
    var base = box(5, 0.8, 9, '#2f3640');
    base.position.y = 0.4;
    g.add(base);
    var belt = box(4.2, 0.35, 8.2, '#1b1f26');
    belt.position.y = 0.95;
    g.add(belt);
    /* полосы ленты */
    var stripes = [];
    for (var i = 0; i < 10; i++) {
      var s = box(4.0, 0.06, 0.35, '#4a5464');
      s.position.set(0, 1.16, -3.8 + i * 0.85);
      g.add(s);
      stripes.push(s);
    }
    /* поручни */
    [-2.2, 2.2].forEach(function (x) {
      var post = box(0.35, 3.4, 0.35, '#c0c8d0');
      post.position.set(x, 2.1, -3.6);
      g.add(post);
    });
    var bar = box(5, 0.35, 0.35, '#c0c8d0');
    bar.position.set(0, 3.7, -3.6);
    g.add(bar);
    var panel = box(4.2, 1.6, 0.4, '#12161c');
    panel.position.set(0, 4.6, -3.6);
    g.add(panel);
    var screen = box(3.4, 1.0, 0.1, '#3ad07a', { emissive: '#1d7a44' });
    screen.position.set(0, 4.6, -3.36);
    g.add(screen);
    return { group: g, stripes: stripes };
  }

  /* ---------------- Стенд магазина трейлов ---------------- */
  function makeTrailStand() {
    var stand = makeStall(null, {
      shirt: '#354c83', undershirt: '#ffdf58', pants: '#242f47',
      skin: '#f3c9a0', hair: '#4f3023', hairStyle: 'bob'
    }), g = stand.group;
    /* Same wooden booth, with the yellow/white awning from the reference. */
    g.children.forEach(function (child) {
      if (child.isMesh && child.position.y === 6.6 && child.position.x > -4.7) {
        var stripeIndex = Math.round((child.position.x + 4.025) / 1.15);
        /* The box UVs already carry the face dimensions. Reusing the same
           density as the original awning avoids scaling its studs twice. */
        child.material = studMat(stripeIndex % 2 ? '#ffda00' : '#fffef2', 3.2, 3.2);
      }
    });
    /* «ленты» трейлов на витрине */
    var colors = ['#4ade4a', '#3a8ef6', '#c04fff', '#ffd24a', '#ff6ad5'];
    var ribbons = [];
    for (var i = 0; i < colors.length; i++) {
      var r = box(0.6, 0.18, 1.8, colors[i], { emissive: colors[i] });
      r.position.set(-2.4 + i * 1.2, 3.72, 0.4);
      r.rotation.x = -0.3;
      g.add(r);
      ribbons.push(r);
    }
    return { group: g, ribbons: ribbons, npc: stand.npc, npcModel: stand.npcModel };
  }

  /* ---------------- Декор ---------------- */
  function makeTree(kind) {
    var g = new T.Group();
    var trunk = cyl(0.55, 0.75, 4.5, '#7a4a26', 7);
    trunk.position.y = 2.25;
    g.add(trunk);
    if (kind === 'pine') {
      for (var i = 0; i < 3; i++) {
        var c = cone(3.2 - i * 0.8, 3.0, i % 2 ? '#2e9e3f' : '#37b94c', 8);
        c.position.y = 4.6 + i * 1.9;
        g.add(c);
      }
    } else {
      var b1 = box(5, 3.4, 5, '#22c522', { studs: true });
      b1.position.y = 6.0; g.add(b1);
      var b2 = box(3.4, 2.4, 3.4, '#36db18', { studs: true });
      b2.position.y = 8.0; g.add(b2);
      var b3 = box(2.2, 1.6, 2.2, '#2e9e3f');
      b3.position.set(1.4, 6.6, 1.2); g.add(b3);
    }
    return g;
  }

  function makeBush() {
    var g = new T.Group();
    var b = box(3.4, 2.3, 3.4, '#2ccd0b', { studs: true });
    b.position.y = 0.9; g.add(b);
    var b2 = box(1.6, 1.2, 1.6, '#22c808', { studs: true });
    b2.position.set(0.7, 1.7, -0.4); g.add(b2);
    return g;
  }

  function makeRock(scale, color) {
    var g = new T.Group();
    var r = box(2.2 * (scale || 1), 1.6 * (scale || 1), 2.0 * (scale || 1), color || '#8a8f96', { flat: true });
    r.rotation.y = Math.random() * 3;
    r.position.y = 0.8 * (scale || 1);
    g.add(r);
    var r2 = box(1.2 * (scale || 1), 1.0 * (scale || 1), 1.2 * (scale || 1), color || '#9aa0a8', { flat: true });
    r2.position.set(0.8 * (scale || 1), 1.4 * (scale || 1), -0.5 * (scale || 1));
    r2.rotation.y = Math.random() * 3;
    g.add(r2);
    return g;
  }

  function makeCactus() {
    var g = new T.Group();
    var body = box(1.5, 6, 1.5, '#3f9f4f');
    body.position.y = 3; g.add(body);
    var armA = box(1.0, 2.6, 1.0, '#3f9f4f');
    armA.position.set(-1.2, 4.2, 0); g.add(armA);
    var armA2 = box(1.0, 1.0, 1.0, '#3f9f4f');
    armA2.position.set(-1.2, 5.6, 0); g.add(armA2);
    var armB = box(1.0, 2.0, 1.0, '#3f9f4f');
    armB.position.set(1.2, 3.4, 0); g.add(armB);
    return g;
  }

  function makeCandyProp(kind) {
    var g = new T.Group();
    if (kind === 'lollipop') {
      var stick = cyl(0.22, 0.22, 6, '#ffffff', 8);
      stick.position.y = 3; g.add(stick);
      var head = cyl(2.2, 2.2, 0.6, '#ff5fa2', 16);
      head.rotation.x = Math.PI / 2;
      head.position.y = 6.6; g.add(head);
      var swirl = cyl(1.4, 1.4, 0.7, '#fff0f6', 16);
      swirl.rotation.x = Math.PI / 2;
      swirl.position.set(0, 6.6, 0.05); g.add(swirl);
    } else {
      var body = box(5.5, 2.6, 2.6, '#c04fff');
      body.position.y = 1.6; g.add(body);
      [-3.4, 3.4].forEach(function (x) {
        var wrap = cone(1.4, 1.8, '#ff9ad5', 6);
        wrap.rotation.z = x > 0 ? -Math.PI / 2 : Math.PI / 2;
        wrap.position.set(x, 1.6, 0);
        g.add(wrap);
      });
      var stripe = box(1.0, 2.7, 2.7, '#ffffff');
      stripe.position.set(0, 1.6, 0); g.add(stripe);
    }
    return g;
  }

  function makeIceCrystal(scale) {
    var g = new T.Group();
    var s = scale || 1;
    var c = cone(1.2 * s, 5 * s, '#8fd8ff', 6, { opacity: 0.92 });
    c.position.y = 2.5 * s; g.add(c);
    var c2 = cone(0.7 * s, 3 * s, '#cfeeff', 6, { opacity: 0.92 });
    c2.position.set(1.2 * s, 1.5 * s, 0.5 * s);
    c2.rotation.z = 0.2; g.add(c2);
    return g;
  }

  function makeLavaRock() {
    var g = new T.Group();
    var r = box(3, 2, 2.6, '#3a221c', { flat: true });
    r.position.y = 1; g.add(r);
    var glow = box(2.4, 0.3, 2.0, '#ff5a1f', { emissive: '#ff3b00' });
    glow.position.y = 2.05; g.add(glow);
    return g;
  }

  function makeCloudProp(scale) {
    var g = new T.Group();
    var s = scale || 1;
    var m = mat('#ffffff', { opacity: 0.95 });
    for (var i = 0; i < 5; i++) {
      var p = new T.Mesh(new T.BoxGeometry((3 + Math.random() * 3) * s, (1.6 + Math.random()) * s, (2.6 + Math.random() * 2) * s), m);
      p.position.set((Math.random() - 0.5) * 6 * s, (Math.random() - 0.5) * 1.2 * s, (Math.random() - 0.5) * 4 * s);
      g.add(p);
    }
    return g;
  }

  /* ---------------- Указатели и таблички ---------------- */
  function fitLabelFont(text, opts) {
    var size = opts.fontSize || 84;
    var lines = String(text).split('\n');
    var ctx = U.canvas(1, 1).getContext('2d');
    ctx.font = '900 ' + size + 'px Nunito, Arial Black, sans-serif';
    var width = 0;
    for (var i = 0; i < lines.length; i++) width = Math.max(width, ctx.measureText(lines[i]).width);
    var available = (opts.tw || 640) - 2 * (opts.outlineWidth || 16) - 18;
    if (width > available) size *= available / width;
    return Math.min(size, ((opts.th || 160) - 20) / (lines.length * 1.05));
  }

  function makeLabel(text, opts) {
    opts = opts || {};
    var tex = new T.CanvasTexture(U.signTexture(text, {
      width: opts.tw || 640, height: opts.th || 160,
      fontSize: fitLabelFont(text, opts),
      color: opts.color || '#ffffff',
      outlineColor: opts.outlineColor || '#2a1a06',
      outlineWidth: opts.outlineWidth || 16,
      bg: opts.bg, border: opts.border, borderWidth: opts.borderWidth, radius: opts.radius
    }));
    tex.needsUpdate = true;
    var w = opts.w || 9;
    var labelHeight = w * ((opts.th || 160) / (opts.tw || 640));
    var spr = opts.fixed
      ? new T.Mesh(new T.PlaneGeometry(w, labelHeight), new T.MeshBasicMaterial({ map: tex, transparent: true, side: T.DoubleSide }))
      : new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: opts.depthTest !== false }));
    if (!opts.fixed) spr.scale.set(w, labelHeight, 1);
    spr.userData.setText = function (newText) {
      var c = U.signTexture(newText, {
        width: opts.tw || 640, height: opts.th || 160,
        fontSize: fitLabelFont(newText, opts),
        color: opts.color || '#ffffff',
        outlineColor: opts.outlineColor || '#2a1a06',
        outlineWidth: opts.outlineWidth || 16,
        bg: opts.bg, border: opts.border, borderWidth: opts.borderWidth, radius: opts.radius
      });
      spr.material.map.image = c;
      spr.material.map.needsUpdate = true;
    };
    return spr;
  }

  /* Табличка на стойке (как «Открыть: $500») */
  function makeSignPost(w, h) {
    var g = new T.Group();
    var post = box(0.5, 2.4, 0.5, '#4a5464');
    post.position.y = 1.2;
    g.add(post);
    var board = box(w || 7, h || 3.2, 0.4, '#183674', { studs: true });
    board.position.y = (h || 3.2) / 2 + 2.2;
    g.add(board);
    var frame = box((w || 7) + 0.4, (h || 3.2) + 0.4, 0.2, '#1b3768');
    frame.position.set(0, (h || 3.2) / 2 + 2.2, -0.12);
    g.add(frame);
    return { group: g, board: board, labelY: (h || 3.2) / 2 + 2.2 };
  }

  /* Жёлтая стрелка-указатель на земле */
  function makeArrow() {
    var g = new T.Group();
    var canvas = U.canvas(128, 128), ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#3c4218'; ctx.lineWidth = 30; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(27, 83); ctx.lineTo(64, 45); ctx.lineTo(101, 83); ctx.stroke();
    ctx.strokeStyle = '#ffff37'; ctx.lineWidth = 22; ctx.stroke();
    var map = new T.CanvasTexture(canvas);
    var arrow = new T.Mesh(new T.PlaneGeometry(4.9, 4.9), new T.MeshBasicMaterial({ map: map, transparent: true, depthWrite: false }));
    arrow.rotation.x = -Math.PI / 2; arrow.rotation.z = Math.PI;
    g.add(arrow);
    return g;
  }

  function makeCoin() {
    if (SE.Assets && SE.Assets.has('P_coin')) {
      var coinG = new T.Group();
      if (!SE.Assets.coinMaterial) SE.Assets.coinMaterial = SE.Assets.material({ rim: 0.35, glow: 0 });
      coinG.add(SE.Assets.clone('P_coin', SE.Assets.coinMaterial));
      return coinG;
    }
    var g = new T.Group();
    var c = cyl(0.55, 0.55, 0.16, '#ffd24a', 12, { emissive: '#8a5a00' });
    c.rotation.x = Math.PI / 2;
    g.add(c);
    var inner = cyl(0.36, 0.36, 0.2, '#ffe98a', 12, { emissive: '#a07a00' });
    inner.rotation.x = Math.PI / 2;
    g.add(inner);
    return g;
  }

  /* Ворота-барьер зоны */
  function makeGate(colorA, colorB) {
    if (SE.Assets && SE.Assets.has('P_gate_lock')) {
      var gateG = new T.Group();
      gateG.add(SE.Assets.clone('P_gate_lock', SE.Assets.material({ tints: [colorA || '#ff3b30'], rim: 0.1 })));
      return gateG;
    }
    var g = new T.Group();
    [-5, 5].forEach(function (x) {
      var p = box(1.4, 7, 1.4, '#5a3a22');
      p.position.set(x, 3.5, 0);
      g.add(p);
    });
    var bar = box(11, 1.6, 1.0, colorA || '#ff3b30');
    bar.position.y = 5.6;
    g.add(bar);
    for (var i = 0; i < 6; i++) {
      var s = box(1.5, 1.65, 1.05, i % 2 ? '#ffffff' : (colorB || '#ff3b30'));
      s.position.set(-4.5 + i * 1.8, 4.0, 0);
      g.add(s);
    }
    return g;
  }

  /* =====================================================================
     Общие помощники анимации
     ===================================================================== */
  function dampTo(a, b, k, dt) { return a + (b - a) * (1 - Math.exp(-k * dt)); }

  /* Мягкий ободок-подсветка для обычных Lambert-материалов (яйца). */
  function addRim(material, strength) {
    material.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <output_fragment>',
        'outgoingLight += diffuseColor.rgb * ' + strength.toFixed(3) +
        ' * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);\n#include <output_fragment>');
    };
    material.customProgramCacheKey = function () { return 'se-rim-' + strength.toFixed(3); };
    return material;
  }

  /* =====================================================================
     Яйца: форма вращения, нарисованный узор биома, ореол редкости
     ===================================================================== */
  var EGG_H = 1.78, EGG_R = 0.64;
  var eggGeo = null, eggMatCache = {}, haloTex = null;

  function eggGeometry() {
    if (eggGeo) return eggGeo;
    var pts = [];
    for (var i = 0; i <= 24; i++) {
      var t = i / 24 * Math.PI;
      var y = -Math.cos(t) * EGG_H / 2;
      var r = Math.sin(t) * EGG_R * (1 - 0.17 * (y / (EGG_H / 2)));
      pts.push(new T.Vector2(Math.max(0.0005, r), y));
    }
    eggGeo = new T.LatheGeometry(pts, 30);
    eggGeo.userData.shared = true;
    return eggGeo;
  }

  function biomeOfEgg(color) {
    var list = SE.Pets ? SE.Pets.BIOMES : [];
    for (var i = 0; i < list.length; i++) if (list[i].eggColor === color) return list[i].id;
    return null;
  }

  /* Рисуем узор по развёртке (u — вокруг яйца, v — снизу вверх); фигуры у шва дублируются. */
  function paintEgg(biome, A, B) {
    var W = 512, H = 256;
    var c = U.canvas(W, H), x = c.getContext('2d');
    var em = null, ex = null;
    var rnd = U.seeded(4242 + (biome || 'x').length * 17);
    function wrap(fn, px) { fn(px); if (px < 60) fn(px + W); if (px > W - 60) fn(px - W); }
    function dot(px, py, r, col, a) {
      wrap(function (qx) { x.globalAlpha = a; x.fillStyle = col; x.beginPath(); x.ellipse(qx, py, r, r * 0.9, 0, 0, Math.PI * 2); x.fill(); }, px);
      x.globalAlpha = 1;
    }
    x.fillStyle = A; x.fillRect(0, 0, W, H);
    /* мягкий перелив: светлее сверху */
    var gr = x.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.6, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.10)');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    var i, px, py;
    switch (biome) {
      case 'forest':
        for (i = 0; i < 70; i++) dot(rnd() * W, 20 + rnd() * (H - 40), 2 + rnd() * 7, rnd() > 0.4 ? B : '#8a6a3c', 0.85);
        for (i = 0; i < 9; i++) dot(rnd() * W, 40 + rnd() * (H - 80), 10 + rnd() * 9, '#b49a68', 0.45);
        break;
      case 'desert':
        x.lineJoin = 'round';
        [0.36, 0.64].forEach(function (v, k) {
          var y0 = H * (1 - v);
          x.strokeStyle = B; x.lineWidth = 16;
          x.beginPath();
          for (var s = 0; s <= 16; s++) x.lineTo(s * W / 16, y0 + (s % 2 ? -14 : 14));
          x.stroke();
          x.strokeStyle = '#7a542a'; x.lineWidth = 5; x.stroke();
          for (var d = 0; d < 16; d++) dot(d * W / 16 + W / 32, y0 + (k ? 34 : -34), 5, B, 0.9);
        });
        break;
      case 'candy':
        x.fillStyle = B;
        for (i = -2; i < 10; i++) {
          x.beginPath();
          x.moveTo(i * 64, H); x.lineTo(i * 64 + 26, H); x.lineTo(i * 64 + 26 + 120, 0); x.lineTo(i * 64 + 120, 0); x.fill();
        }
        var sp = ['#ffffff', '#ffe066', '#7fe0ff', '#9dff8a', '#c07cff'];
        for (i = 0; i < 70; i++) {
          px = rnd() * W; py = 12 + rnd() * (H - 24);
          x.save(); x.translate(px, py); x.rotate(rnd() * 3); x.fillStyle = sp[i % sp.length];
          U.roundRect(x, -6, -2.5, 12, 5, 2.5); x.fill(); x.restore();
        }
        break;
      case 'ice':
        for (i = 0; i < 26; i++) {
          px = rnd() * W; py = rnd() * H;
          var sz = 18 + rnd() * 30;
          wrap(function (qx) {
            x.globalAlpha = 0.35 + rnd() * 0.3; x.fillStyle = rnd() > 0.5 ? '#ffffff' : B;
            x.beginPath(); x.moveTo(qx, py - sz); x.lineTo(qx + sz * 0.6, py); x.lineTo(qx, py + sz * 0.7); x.lineTo(qx - sz * 0.55, py); x.fill();
          }, px);
        }
        x.globalAlpha = 1;
        x.strokeStyle = '#ffffff'; x.lineWidth = 3; x.lineCap = 'round';
        for (i = 0; i < 10; i++) {
          px = rnd() * W; py = 30 + rnd() * (H - 60);
          wrap(function (qx) {
            for (var a = 0; a < 6; a++) {
              var ang = a * Math.PI / 3;
              x.beginPath(); x.moveTo(qx, py); x.lineTo(qx + Math.cos(ang) * 11, py + Math.sin(ang) * 11); x.stroke();
            }
          }, px);
        }
        break;
      case 'volcano':
        x.fillStyle = '#3d211b'; x.fillRect(0, 0, W, H);
        for (i = 0; i < 40; i++) dot(rnd() * W, rnd() * H, 6 + rnd() * 16, '#572e24', 0.6);
        em = U.canvas(W, H); ex = em.getContext('2d');
        ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
        var drawCracks = function (g, width, col) {
          var r2 = U.seeded(77);
          g.strokeStyle = col; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
          for (var k = 0; k < 9; k++) {
            var cx = r2() * W, cy = H * (0.15 + r2() * 0.7);
            g.beginPath(); g.moveTo(cx, cy);
            for (var s2 = 0; s2 < 6; s2++) { cx += (r2() - 0.5) * 70; cy += (r2() - 0.5) * 60; g.lineTo(cx, cy); }
            g.stroke();
          }
        };
        x.shadowColor = '#ff7a1a'; x.shadowBlur = 12;
        drawCracks(x, 6, '#ff8a1f'); drawCracks(x, 2.5, '#ffe27a');
        x.shadowBlur = 0;
        ex.shadowColor = '#ff7a1a'; ex.shadowBlur = 10;
        drawCracks(ex, 7, '#ff6a12'); drawCracks(ex, 3, '#ffd23a');
        break;
      case 'sky':
        for (i = 0; i < 18; i++) {
          px = rnd() * W; py = H * (0.62 + rnd() * 0.3);
          for (var k2 = 0; k2 < 3; k2++) dot(px + k2 * 14, py - (k2 === 1 ? 8 : 0), 14 + rnd() * 6, '#ffffff', 0.85);
        }
        x.fillStyle = '#ffd24a';
        for (i = 0; i < 22; i++) {
          px = rnd() * W; py = 16 + rnd() * H * 0.55;
          var rr = 5 + rnd() * 6;
          wrap(function (qx) {
            x.beginPath();
            for (var p = 0; p < 10; p++) {
              var ang2 = -Math.PI / 2 + p * Math.PI / 5, rad = p % 2 ? rr * 0.45 : rr;
              x.lineTo(qx + Math.cos(ang2) * rad, py + Math.sin(ang2) * rad);
            }
            x.fill();
          }, px);
        }
        break;
      default:
        x.fillStyle = B;
        for (i = 0; i < 5; i++) x.fillRect(0, 22 + i * 49, W, 22);
    }
    var tex = new T.CanvasTexture(c);
    tex.wrapS = T.RepeatWrapping;
    tex.anisotropy = 4;
    if (T.sRGBEncoding !== undefined) tex.encoding = T.sRGBEncoding;
    var emTex = null;
    if (em) { emTex = new T.CanvasTexture(em); emTex.wrapS = T.RepeatWrapping; if (T.sRGBEncoding !== undefined) emTex.encoding = T.sRGBEncoding; }
    return { map: tex, emissiveMap: emTex };
  }

  function eggMaterial(A, B, striped) {
    var biome = striped === false ? 'plain' : biomeOfEgg(A);
    var key = biome + A + B;
    if (eggMatCache[key]) return eggMatCache[key];
    var m;
    if (striped === false) m = new T.MeshLambertMaterial({ color: A });
    else {
      var t = paintEgg(biome, A, B);
      m = new T.MeshLambertMaterial({ map: t.map });
      if (t.emissiveMap) { m.emissiveMap = t.emissiveMap; m.emissive = new T.Color('#ffffff'); }
    }
    addRim(m, 0.28);
    return (eggMatCache[key] = m);
  }

  function haloTexture() {
    if (haloTex) return haloTex;
    var c = U.canvas(128, 128), x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    haloTex = new T.CanvasTexture(c);
    return haloTex;
  }

  /* makeEgg(основной цвет, цвет узора, масштаб, striped, { rarity }) —
     узор выбирается по биому (цвет яйца из SE.Pets.BIOMES). Редкость >= 1 даёт ореол. */
  function makeEgg(colorA, colorB, scale, striped, opts) {
    scale = scale || 1;
    opts = opts || {};
    var g = new T.Group();
    var shell = new T.Mesh(eggGeometry(), eggMaterial(colorA, colorB, striped));
    shell.castShadow = true;
    shell.receiveShadow = true;
    g.add(shell);
    g.userData.shell = shell;
    var rar = opts.rarity !== undefined && SE.Pets ? SE.Pets.RARITIES[opts.rarity] : null;
    if (rar && opts.rarity >= 1) {
      var halo = new T.Sprite(new T.SpriteMaterial({
        map: haloTexture(), color: rar.color, transparent: true, depthWrite: false,
        blending: T.AdditiveBlending, opacity: 0.5 + opts.rarity * 0.06
      }));
      halo.scale.set(3.4, 3.8, 1);
      halo.renderOrder = 2;
      var base = halo.material.opacity;
      halo.onBeforeRender = function () { halo.material.opacity = base * (0.75 + Math.sin(performance.now() * 0.004) * 0.25); };
      g.add(halo);
      g.userData.halo = halo;
    }
    g.scale.setScalar(scale);
    return g;
  }

  /* Две половинки скорлупы с зубчатым краем (для вылупления). */
  function makeEggShells(colorA, colorB) {
    var mat2 = eggMaterial(colorA, colorB, true).clone();
    mat2.side = T.DoubleSide;
    function half(top) {
      var pts = [];
      var n = 12;
      for (var i = 0; i <= n; i++) {
        var t = top ? (0.47 + 0.53 * i / n) * Math.PI : (i / n) * 0.53 * Math.PI;
        var y = -Math.cos(t) * EGG_H / 2;
        var r = Math.sin(t) * EGG_R * (1 - 0.17 * (y / (EGG_H / 2)));
        pts.push(new T.Vector2(Math.max(0.0005, r), y));
      }
      var geo = new T.LatheGeometry(pts, 30);
      /* зубцы на линии разлома */
      var pos = geo.attributes.position, ring = top ? 0 : n;
      for (var s = 0; s <= 30; s++) {
        var idx = s * (n + 1) + ring;
        pos.setY(idx, pos.getY(idx) + (s % 2 ? 0.12 : -0.12));
      }
      geo.computeVertexNormals();
      var m = new T.Mesh(geo, mat2);
      m.castShadow = true;
      return m;
    }
    return { top: half(true), bottom: half(false) };
  }

  /* =====================================================================
     Охранники (Blender): курица, страус, мармеладный мишка, йети, голем, грифон
     ===================================================================== */
  var GUARD_INFO = {
    chicken: { scale: 1.0, alertY: 6.9, gait: 'bird' },
    ostrich: { scale: 0.95, alertY: 10.2, gait: 'stride' },
    gummy:   { scale: 1.05, alertY: 7.9, gait: 'hop' },
    yeti:    { scale: 1.0, alertY: 9.7, gait: 'heavy' },
    magma:   { scale: 1.0, alertY: 9.1, gait: 'heavy' },
    griffin: { scale: 1.2, alertY: 8.6, gait: 'quad' }
  };
  var alertTexture = null;

  function makeGuard(type, colorSet) {
    var kind = type === 'yetiguard' ? 'yeti' : type;
    if (!SE.Assets || !SE.Assets.has('Guard_' + kind)) return makeGuardLegacy(type, colorSet);
    var info = GUARD_INFO[kind] || GUARD_INFO.chicken;
    var g = new T.Group();
    var material = SE.Assets.material({ rim: 0.14 });
    var model = SE.Assets.clone('Guard_' + kind, material);
    model.scale.setScalar(info.scale);
    g.add(model);
    var P = SE.Assets.parts(model);
    var body = P.Body, head = P.Head, tail = P.Tail;
    var legs = [P.LegL, P.LegR], back = [P.LegBL, P.LegBR], arms = [P.ArmL, P.ArmR], wings = [P.WingL, P.WingR];
    var eyes = [P.EyeL, P.EyeR];
    var bodyY = body.position.y, headZ = head ? head.position.z : 0;

    if (!alertTexture) {
      alertTexture = new T.CanvasTexture(U.signTexture('!', {
        width: 128, height: 256, fontSize: 200, color: '#ff1010', outlineColor: '#080808', outlineWidth: 25
      }));
    }
    var alert = new T.Sprite(new T.SpriteMaterial({ map: alertTexture, transparent: true, depthTest: false }));
    alert.scale.set(2.1, 4.2, 1);
    alert.position.set(0, info.alertY * info.scale, 0);
    alert.visible = false;
    alert.renderOrder = 20;
    g.add(alert);

    return {
      group: g, root: model, head: head, alert: alert, material: material,
      wings: wings.filter(Boolean), feet: legs.filter(Boolean),
      t: Math.random() * 10, run: 0, chase: 0, pop: 0, wasAlert: false,
      blink: Math.random() * 3, peck: 2 + Math.random() * 4, pecking: 0,
      update: function (dt, moving, speed) {
        var alerted = alert.visible;
        if (alerted && !this.wasAlert) { this.pop = 0.5; if (SE.FX) SE.FX.burst('alarm', g.position); }
        this.wasAlert = alerted;
        this.run = dampTo(this.run, moving ? 1 : 0, 8, dt);
        this.chase = dampTo(this.chase, alerted ? 1 : 0, 6, dt);
        this.t += dt * (moving ? 6 + 5 * this.chase : 2.2);
        var s = Math.sin(this.t), c = Math.cos(this.t), run = this.run, ch = this.chase;
        var i;
        /* «!» — подпрыгивает при тревоге, корпус вздрагивает, вспышка */
        if (this.pop > 0) {
          this.pop = Math.max(0, this.pop - dt);
          var k = this.pop / 0.5;
          alert.scale.set(2.1 * (1 + k * 0.6), 4.2 * (1 + k * 0.6), 1);
          material.userData.u.uFlash.value.setRGB(0.55 * k, 0.08 * k, 0.05 * k);
        } else if (alerted) {
          alert.scale.set(2.1, 4.2 + Math.sin(this.t * 1.5) * 0.25, 1);
        }
        var popScale = 1 + Math.sin(Math.min(1, this.pop * 2) * Math.PI) * 0.12;
        switch (info.gait) {
          case 'bird':
            for (i = 0; i < 2; i++) if (legs[i]) legs[i].rotation.x = (i ? -s : s) * 0.8 * run;
            body.rotation.z = s * 0.12 * run;
            body.position.y = bodyY + Math.abs(s) * 0.25 * run;
            if (head) head.position.z = headZ + Math.cos(this.t * 2) * 0.12 * run;
            for (i = 0; i < 2; i++) if (wings[i]) {
              var flap = ch > 0.3 ? 0.25 + Math.abs(Math.sin(this.t * 2.6)) * 0.9 * ch : 0.05 + 0.1 * run;
              wings[i].rotation.z = (i ? 1 : -1) * flap;
            }
            break;
          case 'stride':
            for (i = 0; i < 2; i++) if (legs[i]) legs[i].rotation.x = (i ? -s : s) * 0.95 * run;
            body.position.y = bodyY + Math.abs(c) * 0.35 * run;
            body.rotation.x = 0.08 * run;
            if (head) head.rotation.x = Math.sin(this.t * 2) * 0.12 * run;
            for (i = 0; i < 2; i++) if (wings[i]) wings[i].rotation.z = (i ? 1 : -1) * (0.1 + ch * Math.abs(Math.sin(this.t * 2.4)) * 0.8);
            break;
          case 'hop':
            var hop = Math.abs(s);
            body.position.y = bodyY + hop * 0.7 * run;
            var sq = run > 0.2 ? (1 - hop) * 0.18 * run : Math.sin(this.t * 3) * 0.03;
            body.scale.set((1 + sq * 0.5) * popScale, (1 - sq) * popScale, (1 + sq * 0.5) * popScale);
            for (i = 0; i < 2; i++) {
              if (legs[i]) legs[i].rotation.x = (i ? -c : c) * 0.4 * run;
              if (arms[i]) arms[i].rotation.x = (i ? c : -c) * 0.6 * run - ch * 0.8;
            }
            break;
          case 'heavy':
            for (i = 0; i < 2; i++) {
              if (legs[i]) legs[i].rotation.x = (i ? -s : s) * 0.55 * run;
              if (arms[i]) {
                arms[i].rotation.x = (i ? s : -s) * 0.6 * run - ch * 1.0 + Math.sin(this.t * 0.7) * 0.05;
                arms[i].rotation.z = (i ? 1 : -1) * (0.08 + ch * 0.25);
              }
            }
            body.rotation.y = s * 0.12 * run;
            body.rotation.z = c * 0.05 * run;
            body.position.y = bodyY + Math.abs(c) * 0.28 * run + Math.sin(this.t * 0.8) * 0.04 * (1 - run);
            break;
          case 'quad':
            for (i = 0; i < 2; i++) {
              if (legs[i]) legs[i].rotation.x = (i ? -s : s) * 0.6 * run;
              if (back[i]) back[i].rotation.x = (i ? s : -s) * 0.6 * run;
              if (wings[i]) {
                var wf = ch > 0.3 ? 0.2 + Math.abs(Math.sin(this.t * 2.2)) * 0.9 : 0.05 + Math.sin(this.t * 0.8) * 0.08;
                wings[i].rotation.z = (i ? 1 : -1) * wf;
              }
            }
            body.position.y = bodyY + Math.abs(c) * 0.22 * run + ch * Math.abs(Math.sin(this.t * 2.2)) * 0.3;
            break;
        }
        /* масштаб задаём заново каждый кадр (не копим) */
        if (info.gait !== 'hop') body.scale.setScalar(popScale);
        if (tail) tail.rotation.y = Math.sin(this.t * 1.6) * 0.3;
        /* клюёт землю, пока стоит */
        if (head && !moving && info.gait === 'bird') {
          this.peck -= dt;
          if (this.peck < 0) { this.pecking = 0.45; this.peck = 2 + Math.random() * 4; }
          if (this.pecking > 0) { this.pecking -= dt; head.rotation.x = Math.sin((0.45 - this.pecking) / 0.45 * Math.PI) * 0.7; }
          else head.rotation.x = dampTo(head.rotation.x, 0, 8, dt);
        } else if (head && info.gait !== 'stride') {
          head.rotation.x = dampTo(head.rotation.x, ch * -0.12, 8, dt);
          head.rotation.y = Math.sin(this.t * 0.35) * 0.3 * (1 - run);
        }
        this.blink -= dt;
        var e = this.blink < 0.12 ? 0.15 : 1;
        if (this.blink < 0) this.blink = 1.5 + Math.random() * 3;
        for (i = 0; i < 2; i++) if (eyes[i]) eyes[i].scale.y = e;
      }
    };
  }

  /* =====================================================================
     Питомцы: 5 базовых форм + детали по виду (уши, хвосты, рога...)
     ===================================================================== */
  var PET_LOOK = {
    f1: 'beak crest tail_fan', f2: 'snout_short ears_long tail_stub small', f3: 'beak tail_fan',
    f4: 'snout_long ears_round mask tail_stub chunky', f5: 'snout_long ears_pointy tail_bushy slim',
    f6: 'snout_long ears_round spikes tail_stub small', f7: 'snout_long ears_pointy tail_bushy',
    f8: 'snout_short ears_pointy mask tail_bushy', f9: 'snout_short ears_round tail_stub chunky big',
    f10: 'beak_hook tufts tail_fan', f11: 'snout_long ears_pointy antlers tail_stub slim big',
    f12: 'sprout', f13: 'snout_long ears_pointy horn mane tail_bushy slim big',
    d1: 'pincers stinger', d2: 'snout_short ears_long tail_thin small', d3: 'snout_long tail_lizard slim',
    d4: 'snout_long ears_round hump tail_thin', d5: 'snout_short ears_pointy big_ears tail_bushy small',
    d6: 'beak_hook tail_fan', d7: 'hood', d8: 'snout_long tail_lizard spikes', d9: 'horn',
    d10: 'snout_short ears_pointy tail_thin slim', d11: 'arms spikes', d12: 'snout_long ears_pointy big_ears tail_thin slim',
    d13: 'snout_short ears_round mane tail_thin big',
    c1: 'arms', c2: 'snout_short ears_floppy tail_thin', c3: 'puffs', c4: 'snout_short ears_pointy tail_thin',
    c5: 'snout_long ears_floppy tail_stub', c6: 'snout_short ears_long tail_stub small', c7: 'snout_short ears_round tail_stub chunky',
    c8: '', c9: 'snout_long ears_pointy horn mane tail_bushy slim', c10: 'arms spikes', c11: 'snout_short ears_pointy tail_bushy',
    c12: '', c13: '',
    i1: 'beak', i2: 'snout_short ears_long tail_stub', i3: 'spikes', i4: 'snout_short tusks tail_stub chunky',
    i5: 'snout_long ears_pointy tail_bushy', i6: 'fins fluke', i7: 'snout_short ears_round tail_stub chunky big',
    i8: 'snout_long ears_pointy tail_bushy', i9: 'arms puffs', i10: 'trunk tusks ears_floppy tail_thin chunky big',
    i11: '', i12: 'snout_long ears_pointy tail_bushy', i13: '',
    v1: 'flame', v2: 'pincers', v3: 'horn', v4: 'snout_long tail_lizard', v5: 'snout_long ears_pointy tail_bushy',
    v6: 'flame', v7: 'arms flame', v8: 'snout_long tail_lizard slim', v9: 'beak crest tail_long',
    v10: 'snout_short ears_pointy horns tail_thin', v11: '', v12: '', v13: 'flame',
    s1: 'puffs', s2: 'beak crest', s3: 'fins ribbon', s4: 'beak_hook tufts', s5: 'snout_long ears_pointy mane tail_bushy slim',
    s6: 'puffs', s7: 'beak_hook crest tail_long', s8: 'snout_short ears_pointy tail_thin', s9: '',
    s10: 'snout_short ears_pointy tail_bushy', s11: '', s12: 'fins fluke', s13: ''
  };
  var PET_DEFAULT = {
    quad: 'snout_short ears_pointy tail_thin', bird: 'beak tail_fan', blob: '', drake: '', bug: ''
  };
  var petTemplates = {}, petMats = {};

  function petTokens(def, shape) {
    var list = ((PET_LOOK[def.id] !== undefined ? PET_LOOK[def.id] : PET_DEFAULT[shape]) || '').split(/\s+/).filter(Boolean);
    var f = def.flags || '';
    if (shape === 'bird' || shape === 'drake' || f.indexOf('w') >= 0) list.push('wings');
    if (f.indexOf('c') >= 0) list.push('crown');
    if (f.indexOf('s') >= 0 && list.indexOf('spikes') < 0) list.push('spikes');
    if (f.indexOf('h') >= 0 && (shape === 'quad' || shape === 'bug') &&
        !/horn|antlers|tusks/.test(list.join(' '))) list.push('horn');
    if (shape === 'drake') list.push('tail');
    return list;
  }

  function lighten(hex, k) {
    var c = new T.Color(hex);
    return c.lerp(new T.Color('#ffffff'), k).getStyle();
  }

  function petTemplate(def, shape) {
    if (petTemplates[def.id]) return petTemplates[def.id];
    var tpl = SE.Assets.clone('Pet_' + shape);
    var tokens = petTokens(def, shape);
    var keep = {};
    tokens.forEach(function (t) {
      if (t === 'wings') { keep.WingL = keep.WingR = true; }
      else if (t === 'tail') keep.Tail = true;
      else if (/^tail_/.test(t)) keep['Tail_' + t.slice(5)] = true;
      else keep['X_' + t] = true;
    });
    var remove = [], merge = [];
    tpl.traverse(function (o) {
      var n = o.name.replace(/^(.+?)_?\d{3}$/, '$1');
      if (/^X_/.test(n)) (keep[n] ? merge : remove).push(o);
      else if (/^(Tail_|Wing)/.test(n) && !keep[n]) remove.push(o);
      else if (n === 'Tail' && !keep.Tail) remove.push(o);
    });
    remove.forEach(function (o) { if (o.parent) o.parent.remove(o); });
    var bigEars = tokens.indexOf('big_ears') >= 0;
    /* неанимируемые детали вклеиваем в геометрию родителя — меньше draw calls */
    merge.forEach(function (o) {
      var par = o.parent;
      if (!par || !par.isMesh) return;
      if (bigEars && /ears/.test(o.name)) o.scale.set(1.25, 1.25, 1.55);
      o.updateMatrix();
      var g2 = o.geometry.clone().applyMatrix4(o.matrix);
      var merged = T.BufferGeometryUtils.mergeBufferGeometries([par.geometry, g2], false);
      g2.dispose();
      merged.computeBoundingSphere();
      merged.userData.shared = true;
      par.geometry = merged;
      par.remove(o);
    });
    var sc = 1;
    if (tokens.indexOf('small') >= 0) sc = 0.86;
    if (tokens.indexOf('big') >= 0) sc = 1.14;
    var P = SE.Assets.parts(tpl);
    if (P.Body && (tokens.indexOf('chunky') >= 0 || tokens.indexOf('slim') >= 0)) {
      var bs = tokens.indexOf('chunky') >= 0 ? [1.2, 1.1, 1.06] : [0.86, 0.95, 1.08];
      P.Body.scale.set(bs[0], bs[1], bs[2]);
      if (P.Head) P.Head.scale.set(1 / bs[0], 1 / bs[1], 1 / bs[2]);
    }
    tpl.scale.setScalar(sc);
    petTemplates[def.id] = tpl;
    return tpl;
  }

  function petMaterial(def) {
    var glow = (def.flags || '').indexOf('g') >= 0;
    var key = def.body + def.accent + (glow ? 'g' : '');
    if (petMats[key]) return petMats[key];
    return (petMats[key] = SE.Assets.material({
      tints: [def.body, def.accent, lighten(def.body, 0.45)], glow: glow ? 0.32 : 0, rim: 0.22
    }));
  }

  function makePet(def, scale) {
    var shape = def.shape === 'dragon' ? 'drake' : def.shape;
    if (!SE.Assets || !SE.Assets.has('Pet_' + shape)) return makePetLegacy(def, scale);
    scale = scale || 1;
    var g = new T.Group();
    var model = petTemplate(def, shape).clone(true);
    SE.Assets.paint(model, petMaterial(def));
    g.add(model);
    g.scale.setScalar(scale);
    var P = SE.Assets.parts(model);
    var legs = [];
    model.traverse(function (o) { if (/^Leg/.test(o.name)) legs.push(o); });
    var tail = null;
    model.traverse(function (o) { if (!tail && /^Tail/.test(o.name)) tail = o; });
    var body = P.Body, head = P.Head, wings = [P.WingL, P.WingR], eyes = [P.EyeL, P.EyeR];
    var bodyY = body ? body.position.y : 0;
    var bodyScale = body ? body.scale.clone() : new T.Vector3(1, 1, 1);
    var headZ = head ? head.position.z : 0;
    return {
      group: g, legs: legs, t: Math.random() * 6, run: 0, blink: Math.random() * 3, hopT: 0,
      update: function (dt, moving) {
        this.run = dampTo(this.run, moving ? 1 : 0, 9, dt);
        this.t += dt * (moving ? 12 : 3);
        var s = Math.sin(this.t), c = Math.cos(this.t), run = this.run, i;
        if (shape === 'quad' || shape === 'drake') {
          for (i = 0; i < legs.length; i++) {
            var diag = /FL|BR/.test(legs[i].name) ? 1 : -1;
            legs[i].rotation.x = s * diag * 0.7 * run;
          }
          if (body) { body.position.y = bodyY + Math.abs(c) * 0.08 * run; body.rotation.z = s * 0.04 * run; }
        } else if (shape === 'bird') {
          for (i = 0; i < legs.length; i++) legs[i].rotation.x = (i ? s : -s) * 0.6 * run;
          if (body) body.position.y = bodyY + Math.abs(s) * 0.15 * run;
          if (head) head.position.z = headZ + Math.cos(this.t * 2) * 0.06 * run;
        } else if (shape === 'bug') {
          for (i = 0; i < legs.length; i++) legs[i].rotation.x = Math.sin(this.t * 1.5 + i * 1.7) * 0.5 * run;
          if (body) body.position.y = bodyY + Math.abs(s) * 0.04 * run;
        } else if (shape === 'blob' && body) {
          var hop = Math.abs(s);
          var sq = run > 0.1 ? (0.5 - hop) * 0.24 * run : Math.sin(this.t * 1.3) * 0.04;
          body.scale.set(bodyScale.x * (1 + sq * 0.5), bodyScale.y * (1 - sq), bodyScale.z * (1 + sq * 0.5));
          body.position.y = bodyY + hop * 0.45 * run;
        }
        if (tail) tail.rotation.y = Math.sin(this.t * (moving ? 1.2 : 2.4)) * (moving ? 0.25 : 0.4);
        for (i = 0; i < 2; i++) if (wings[i]) {
          var f = moving ? 0.2 + Math.abs(Math.sin(this.t * 1.8)) * 0.8 : 0.08 + Math.sin(this.t * 0.9) * 0.1;
          wings[i].rotation.z = (i ? 1 : -1) * f;
        }
        if (head && !moving) head.rotation.y = Math.sin(this.t * 0.4) * 0.35;
        else if (head) head.rotation.y = dampTo(head.rotation.y, 0, 6, dt);
        this.blink -= dt;
        var e = this.blink < 0.12 ? 0.15 : 1;
        if (this.blink < 0) this.blink = 1.5 + Math.random() * 3.5;
        for (i = 0; i < 2; i++) if (eyes[i]) eyes[i].scale.y = e;
        g.rotation.z = 0;
      }
    };
  }

  SE.Models = {
    mat: mat, box: box, cyl: cyl, sph: sph, cone: cone, at: at,
    makeEggShells: makeEggShells,
    addRim: addRim,
    PET_LOOK: PET_LOOK,
    studTexture: studTexture, studMat: studMat,
    makeCharacter: makeCharacter,
    makeGuard: makeGuard,
    GUARD_STYLES: GUARD_STYLES,
    makePet: makePet,
    makeEgg: makeEgg,
    makeNest: makeNest,
    fenceSegment: fenceSegment,
    fenceRect: fenceRect,
    makeStall: makeStall,
    makeTreadmill: makeTreadmill,
    makeTrailStand: makeTrailStand,
    makeTree: makeTree,
    makeBush: makeBush,
    makeRock: makeRock,
    makeCactus: makeCactus,
    makeCandyProp: makeCandyProp,
    makeIceCrystal: makeIceCrystal,
    makeLavaRock: makeLavaRock,
    makeCloudProp: makeCloudProp,
    makeLabel: makeLabel,
    makeSignPost: makeSignPost,
    makeArrow: makeArrow,
    makeCoin: makeCoin,
    makeGate: makeGate
  };
})(window);
