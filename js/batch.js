/* =========================================================
   Static batching for the world (owned by the MAP agent).
   - world materials: vertex colours + "slot" attribute
     (slot 1..5 = tint, slot 6 = glow), one program for all props;
   - Kit: a tiny procedural modeller used for fallback props;
   - prop(name): GLB model from SE.Assets flattened into one
     geometry (animated children kept apart), or a fallback;
   - Merge: many props -> one mesh per region;
   - Inst: InstancedMesh per prop type with quality thinning.
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var T = global.THREE;

  var TIME = { value: 0 };
  var WHITE = new T.Color(1, 1, 1);
  var COLORS = {};
  function col(c) {
    if (c && c.isColor) return c;
    return COLORS[c] || (COLORS[c] = new T.Color(c));
  }

  /* ---------------- materials ---------------- */
  var MATS = {};
  /* kind: 'static' (merged meshes), 'inst' (instanced), 'sway' (instanced foliage) */
  function material(kind) {
    kind = kind || 'static';
    return MATS[kind] || (MATS[kind] = makeMaterial(kind));
  }
  /* A new material instance with the same shader (for per-object fading). */
  function makeMaterial(kind) {
    var inst = kind !== 'static', sway = kind === 'sway';
    var m = new T.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = TIME;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float slot;\nvarying float vGlow;\nuniform float uTime;\n' +
          (inst ? 'attribute vec3 iTint;\n' : ''))
        .replace('#include <color_vertex>', '#include <color_vertex>\nfloat sl = floor(slot + 0.5);\nvGlow = sl > 5.5 ? 1.0 : 0.0;\n' +
          (inst ? 'if (sl > 0.5 && sl < 5.5) vColor.rgb *= iTint;\n' : ''));
      if (sway) {
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\n' +
          '{ float swH = max(0.0, position.y - 1.0);\n' +
          '  float swP = instanceMatrix[3][0] * 0.11 + instanceMatrix[3][2] * 0.07;\n' +
          '  transformed.x += sin(uTime * 1.5 + swP) * swH * swH * 0.0032;\n' +
          '  transformed.z += cos(uTime * 1.2 + swP * 1.3) * swH * swH * 0.0024; }');
      }
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 0.95;');
    };
    m.customProgramCacheKey = function () { return 'se-world-' + kind; };
    return m;
  }

  /* ---------------- unit primitives (non-indexed) ---------------- */
  var PRIM = {};
  function prim(key, make) {
    var g = PRIM[key];
    if (!g) {
      g = make();
      if (g.index) g = g.toNonIndexed();
      g.deleteAttribute('uv');
      if (!g.attributes.normal) g.computeVertexNormals();
      PRIM[key] = g;
    }
    return g;
  }
  function prismGeo() {
    var a = [-0.5, 0, -0.5], b = [-0.5, 0, 0.5], c = [0, 1, 0.5], d = [0, 1, -0.5];
    var e = [0.5, 0, 0.5], f = [0.5, 0, -0.5];
    var tris = [
      [b, e, c], [f, a, d],            /* gable triangles (front +Z, back -Z) */
      [a, b, c], [a, c, d],            /* left slope */
      [e, f, d], [e, d, c],            /* right slope */
      [a, f, e], [a, e, b]             /* bottom */
    ];
    var p = [];
    tris.forEach(function (t) { t.forEach(function (v) { p.push(v[0], v[1], v[2]); }); });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    return g;
  }
  function rockGeo(seed) {
    var g = new T.IcosahedronGeometry(1, 1);
    if (g.index) g = g.toNonIndexed();
    var pos = g.attributes.position, rnd = SE.U.seeded(9001 + seed * 131), cache = {};
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var key = Math.round(x * 100) + ',' + Math.round(y * 100) + ',' + Math.round(z * 100);
      var k = cache[key] || (cache[key] = 0.78 + rnd() * 0.42);
      pos.setXYZ(i, x * k, Math.max(-0.35, y * k), z * k);
    }
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    return g;
  }
  function eggGeo() {
    var g = new T.SphereGeometry(0.62, 14, 12);
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var y = p.getY(i), taper = 1 - y * 0.26;
      p.setXYZ(i, p.getX(i) * taper, y * 1.43, p.getZ(i) * taper);
    }
    g.computeVertexNormals();
    return g;
  }
  var P = {
    box: function () { return prim('box', function () { return new T.BoxGeometry(1, 1, 1); }); },
    cyl: function (seg, ratio) {
      return prim('cyl' + seg + '_' + ratio, function () { return new T.CylinderGeometry(ratio, 1, 1, seg, 1); });
    },
    sph: function (seg) {
      return prim('sph' + seg, function () { return new T.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.7))); });
    },
    tor: function (ratio, seg, arc) {
      return prim('tor' + ratio + '_' + seg + '_' + arc, function () { return new T.TorusGeometry(1, ratio, 6, seg, arc); });
    },
    prism: function () { return prim('prism', prismGeo); },
    rock: function (seed) { return prim('rock' + (seed % 6), function () { return rockGeo(seed % 6); }); },
    egg: function () { return prim('egg', eggGeo); }
  };

  /* ---------------- Kit: procedural modeller ---------------- */
  var _mA = new T.Matrix4(), _mB = new T.Matrix4(), _nm = new T.Matrix3();
  var _v = new T.Vector3(), _p = new T.Vector3(), _sc = new T.Vector3(), _q = new T.Quaternion(), _e = new T.Euler();

  function Kit() { this.P = []; this.N = []; this.C = []; this.S = []; this.M = new T.Matrix4(); this.stack = []; }

  Kit.prototype.push = function (x, y, z, ry, s, rx, rz) {
    this.stack.push(this.M.clone());
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    var k = s === undefined ? 1 : s;
    _mA.compose(_p.set(x || 0, y || 0, z || 0), _q, _sc.set(k, k, k));
    this.M.multiply(_mA);
    return this;
  };
  Kit.prototype.pop = function () { this.M = this.stack.pop() || new T.Matrix4(); return this; };

  Kit.prototype.put = function (geo, color, x, y, z, sx, sy, sz, o) {
    o = o || {};
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ');
    _q.setFromEuler(_e);
    _mA.compose(_p.set(x, y, z), _q, _sc.set(sx, sy, sz));
    _mB.multiplyMatrices(this.M, _mA);
    this.addGeo(geo, _mB, col(color), o.glow ? 6 : (o.tint || 0), o.stripe ? col(o.stripe) : null);
    return this;
  };

  Kit.prototype.addGeo = function (geo, m, c, slot, stripe) {
    var pos = geo.attributes.position, nor = geo.attributes.normal;
    _nm.getNormalMatrix(m);
    for (var i = 0; i < pos.count; i++) {
      var ly = pos.getY(i);
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.P.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      this.N.push(_v.x, _v.y, _v.z);
      var cc = c;
      if (stripe) { var band = Math.floor((ly + 0.9) * 4.4); cc = band % 2 ? stripe : c; }
      this.C.push(cc.r, cc.g, cc.b);
      this.S.push(slot);
    }
  };

  /* Geometry with its own colour/slot attributes (flattened GLB parts). */
  Kit.prototype.addAttr = function (geo, m) {
    var pos = geo.attributes.position, nor = geo.attributes.normal;
    var ca = geo.attributes.color, sa = geo.attributes.slot;
    _mB.multiplyMatrices(this.M, m);
    _nm.getNormalMatrix(_mB);
    for (var i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_mB);
      this.P.push(_v.x, _v.y, _v.z);
      if (nor) { _v.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize(); this.N.push(_v.x, _v.y, _v.z); }
      else this.N.push(0, 1, 0);
      if (ca) this.C.push(ca.getX(i), ca.getY(i), ca.getZ(i)); else this.C.push(1, 1, 1);
      this.S.push(sa ? sa.getX(i) : 0);
    }
  };

  /* Shapes. (x, y, z) is the centre, except prism (base centre). */
  Kit.prototype.box = function (w, h, d, c, x, y, z, o) { return this.put(P.box(), c, x, y, z, w, h, d, o); };
  Kit.prototype.cyl = function (r, h, c, x, y, z, o) {
    o = o || {};
    var rt = o.rt === undefined ? r : o.rt;
    var ratio = Math.round((r > 0 ? rt / r : 1) * 100) / 100;
    return this.put(P.cyl(o.seg || 10, ratio), c, x, y, z, r * (o.sx || 1), h, r * (o.sz || 1), o);
  };
  Kit.prototype.cone = function (r, h, c, x, y, z, o) {
    o = o || {};
    return this.put(P.cyl(o.seg || 8, 0), c, x, y, z, r * (o.sx || 1), h, r * (o.sz || 1), o);
  };
  Kit.prototype.sph = function (r, c, x, y, z, o) {
    o = o || {};
    return this.put(P.sph(o.seg || 10), c, x, y, z, r * (o.sx || 1), r * (o.sy || 1), r * (o.sz || 1), o);
  };
  Kit.prototype.tor = function (R, r, c, x, y, z, o) {
    o = o || {};
    var ratio = Math.round(r / R * 100) / 100;
    return this.put(P.tor(ratio, o.seg || 14, o.arc || Math.PI * 2), c, x, y, z, R, R, R, o);
  };
  Kit.prototype.prism = function (w, h, d, c, x, y, z, o) { return this.put(P.prism(), c, x, y, z, w, h, d, o); };
  Kit.prototype.rock = function (r, c, x, y, z, o) {
    o = o || {};
    o.seed = o.seed || 0;
    return this.put(P.rock(o.seed), c, x, y, z, r * (o.sx || 1), r * (o.sy || 0.75), r * (o.sz || 1), o);
  };
  Kit.prototype.egg = function (s, ca, cb, x, y, z, o) {
    o = o || {};
    o.stripe = cb;
    return this.put(P.egg(), ca, x, y, z, s, s, s, o);
  };

  /* ao: height under which vertices get darker (fake contact shadow). */
  Kit.prototype.build = function (ao) {
    var n = this.S.length;
    if (!n) return null;
    var C = this.C;
    if (ao) {
      for (var i = 0; i < n; i++) {
        var y = this.P[i * 3 + 1];
        if (y < ao && this.S[i] !== 6) {
          var f = 0.66 + 0.34 * Math.max(0, y) / ao;
          C[i * 3] *= f; C[i * 3 + 1] *= f; C[i * 3 + 2] *= f;
        }
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
    g.setAttribute('slot', new T.Float32BufferAttribute(this.S, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };

  /* ---------------- GLB flattening ---------------- */
  var PARTS = {
    P_windmill: ['Blades'],
    P_fountain: ['Water'],
    P_treadmill: ['Belt'],
    P_stall_trail: ['Ribbon0', 'Ribbon1', 'Ribbon2', 'Ribbon3', 'Ribbon4']
  };

  function flattenAsset(name) {
    var obj = SE.Assets.clone(name);
    obj.updateMatrixWorld(true);
    var inv = new T.Matrix4().copy(obj.matrixWorld).invert();
    var main = new Kit(), parts = {}, owners = [];
    if (PARTS[name]) {
      var map = SE.Assets.parts(obj);
      PARTS[name].forEach(function (pn) { if (map[pn] && map[pn] !== obj) owners.push({ name: pn, obj: map[pn] }); });
    }
    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var owner = null;
      for (var p = o; p && !owner; p = p.parent) {
        for (var k = 0; k < owners.length; k++) if (owners[k].obj === p) { owner = owners[k]; break; }
        if (p === obj) break;
      }
      if (owner) {
        var part = parts[owner.name];
        if (!part) {
          part = parts[owner.name] = {
            kit: new Kit(),
            matrix: new T.Matrix4().multiplyMatrices(inv, owner.obj.matrixWorld),
            inv: new T.Matrix4().copy(owner.obj.matrixWorld).invert()
          };
        }
        part.kit.addAttr(o.geometry, new T.Matrix4().multiplyMatrices(part.inv, o.matrixWorld));
      } else {
        main.addAttr(o.geometry, new T.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      }
    });
    var out = { geo: main.build(0), parts: {}, asset: true };
    Object.keys(parts).forEach(function (k) {
      var g = parts[k].kit.build(0);
      if (g) out.parts[k] = { geo: g, matrix: parts[k].matrix };
    });
    return out;
  }

  var LIB = {};
  var FALLBACK = {};

  function prop(name) {
    if (LIB[name]) return LIB[name];
    var res = null;
    if (SE.Assets && SE.Assets.has && SE.Assets.has(name)) {
      try { res = flattenAsset(name); } catch (err) { console.warn('Prop flatten failed: ' + name, err); res = null; }
      if (res && !res.geo && !Object.keys(res.parts).length) res = null;
    }
    if (!res) {
      var K = new Kit(), partKits = {};
      var part = function (pn, x, y, z, o) {
        o = o || {};
        var pk = new Kit();
        _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
        _q.setFromEuler(_e);
        partKits[pn] = { kit: pk, matrix: new T.Matrix4().compose(new T.Vector3(x, y, z), _q.clone(), new T.Vector3(1, 1, 1)) };
        return pk;
      };
      var fb = FALLBACK[name];
      if (fb) fb(K, part);
      else K.box(2, 2, 2, '#ff00ff', 0, 1, 0);
      res = { geo: K.build(1.4), parts: {}, asset: false };
      Object.keys(partKits).forEach(function (k) {
        res.parts[k] = { geo: partKits[k].kit.build(0), matrix: partKits[k].matrix };
      });
    }
    if (!res.geo) res.geo = new Kit().box(0.01, 0.01, 0.01, '#000000', 0, -5, 0).build(0);
    res.box = res.geo.boundingBox.clone();
    Object.keys(res.parts).forEach(function (k) {
      var pb = res.parts[k].geo.boundingBox.clone().applyMatrix4(res.parts[k].matrix);
      res.box.union(pb);
    });
    LIB[name] = res;
    return res;
  }

  /* A mesh for one animated part, already positioned at its pivot. */
  function partObject(name, partName, mat) {
    var p = prop(name).parts[partName];
    if (!p) return null;
    var pivot = new T.Object3D();
    p.matrix.decompose(pivot.position, pivot.quaternion, pivot.scale);
    var mesh = new T.Mesh(p.geo, mat || material('static'));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    return pivot;
  }

  /* ---------------- Merge: many props into one mesh ---------------- */
  function Merge() { this.items = []; this.n = 0; }
  Merge.prototype.add = function (geo, m, tints) {
    if (!geo) return;
    this.items.push({ g: geo, m: m.clone(), t: tints || null });
    this.n += geo.attributes.position.count;
  };
  Merge.prototype.build = function (kind, opts) {
    opts = opts || {};
    if (!this.n) return null;
    var n = this.n;
    var PA = new Float32Array(n * 3), NA = new Float32Array(n * 3), CA = new Float32Array(n * 3), SA = new Float32Array(n);
    var o = 0, nm = new T.Matrix3();
    for (var it = 0; it < this.items.length; it++) {
      var item = this.items[it], g = item.g, e = item.m.elements;
      nm.getNormalMatrix(item.m);
      var ne = nm.elements;
      var pa = g.attributes.position.array, na = g.attributes.normal.array;
      var ca = g.attributes.color ? g.attributes.color.array : null, sa = g.attributes.slot ? g.attributes.slot.array : null;
      var cnt = g.attributes.position.count;
      var tints = item.t;
      for (var i = 0; i < cnt; i++) {
        var x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
        PA[o * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        PA[o * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        PA[o * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        var nx = na[i * 3], ny = na[i * 3 + 1], nz = na[i * 3 + 2];
        var tx = ne[0] * nx + ne[3] * ny + ne[6] * nz;
        var ty = ne[1] * nx + ne[4] * ny + ne[7] * nz;
        var tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
        var l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        NA[o * 3] = tx / l; NA[o * 3 + 1] = ty / l; NA[o * 3 + 2] = tz / l;
        var r = ca ? ca[i * 3] : 1, gg = ca ? ca[i * 3 + 1] : 1, b = ca ? ca[i * 3 + 2] : 1;
        var s = sa ? Math.floor(sa[i] + 0.5) : 0;
        if (s >= 1 && s <= 5) {
          var tc = tints && tints[s - 1] ? col(tints[s - 1]) : WHITE;
          r *= tc.r; gg *= tc.g; b *= tc.b; s = 0;
        }
        CA[o * 3] = r; CA[o * 3 + 1] = gg; CA[o * 3 + 2] = b;
        SA[o] = s;
        o++;
      }
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(PA, 3));
    geo.setAttribute('normal', new T.BufferAttribute(NA, 3));
    geo.setAttribute('color', new T.BufferAttribute(CA, 3));
    geo.setAttribute('slot', new T.BufferAttribute(SA, 1));
    geo.computeBoundingSphere();
    var mesh = new T.Mesh(geo, material(kind || 'static'));
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.items = [];
    return mesh;
  };

  /* ---------------- LOD: vertex clustering ---------------- */
  /* Vertices that fall into the same cell collapse into one; triangles that
     degenerate disappear. Colours and glow slots are kept per corner. */
  function simplify(geo, cell) {
    var pa = geo.attributes.position.array, ca = geo.attributes.color.array, sa = geo.attributes.slot.array;
    var n = pa.length / 3, inv = 1 / cell, map = new Map(), cid = new Int32Array(n), sx = [], sy = [], sz = [], sc = [];
    for (var i = 0; i < n; i++) {
      var k = Math.floor(pa[i * 3] * inv) + ',' + Math.floor(pa[i * 3 + 1] * inv) + ',' + Math.floor(pa[i * 3 + 2] * inv);
      var id = map.get(k);
      if (id === undefined) { id = sx.length; map.set(k, id); sx.push(0); sy.push(0); sz.push(0); sc.push(0); }
      sx[id] += pa[i * 3]; sy[id] += pa[i * 3 + 1]; sz[id] += pa[i * 3 + 2]; sc[id]++;
      cid[i] = id;
    }
    for (var c = 0; c < sx.length; c++) { sx[c] /= sc[c]; sy[c] /= sc[c]; sz[c] /= sc[c]; }
    var P = [], N = [], C = [], S = [], seen = new Set();
    for (var t = 0; t < n; t += 3) {
      var a = cid[t], b = cid[t + 1], d = cid[t + 2];
      if (a === b || b === d || a === d) continue;
      var key = a < b && a < d ? a + ',' + b + ',' + d : (b < d ? b + ',' + d + ',' + a : d + ',' + a + ',' + b);
      if (seen.has(key)) continue;
      seen.add(key);
      var ux = sx[b] - sx[a], uy = sy[b] - sy[a], uz = sz[b] - sz[a];
      var vx = sx[d] - sx[a], vy = sy[d] - sy[a], vz = sz[d] - sz[a];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-6) continue;
      nx /= l; ny /= l; nz /= l;
      [a, b, d].forEach(function (cc, j) {
        var src = t + j;
        P.push(sx[cc], sy[cc], sz[cc]); N.push(nx, ny, nz);
        C.push(ca[src * 3], ca[src * 3 + 1], ca[src * 3 + 2]); S.push(sa[src]);
      });
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
    g.setAttribute('slot', new T.Float32BufferAttribute(S, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  /* Simplified prop geometry; ratio = cell size relative to the prop's largest side. */
  var LODGEO = {};
  function lodGeometry(name, ratio) {
    var key = name + '|' + ratio;
    if (LODGEO[key]) return LODGEO[key];
    var p = prop(name), b = p.geo.boundingBox;
    var size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    var g = simplify(p.geo, Math.max(0.05, size * ratio));
    if (g.attributes.position.count < 3) g = p.geo;
    LODGEO[key] = g;
    return g;
  }

  /* ---------------- Inst: instanced prop type ---------------- */
  var ZERO = new T.Matrix4().makeScale(0, 0, 0);

  /* Bake tints 2..5 (keep slot 1 for the per-instance iTint). */
  var INSTGEO = {};
  function instGeometry(name, tints, lod) {
    var key = name + '|' + (tints ? tints.join(',') : '') + '|' + (lod || 0);
    if (INSTGEO[key]) return INSTGEO[key];
    var src = lod ? lodGeometry(name, lod) : prop(name).geo;
    var g = new T.BufferGeometry();
    g.setAttribute('position', src.attributes.position);
    g.setAttribute('normal', src.attributes.normal);
    var ca = src.attributes.color.array, sa = src.attributes.slot.array;
    var C = new Float32Array(ca.length), S = new Float32Array(sa.length);
    for (var i = 0; i < sa.length; i++) {
      var s = Math.floor(sa[i] + 0.5), r = ca[i * 3], gg = ca[i * 3 + 1], b = ca[i * 3 + 2];
      if (s >= 2 && s <= 5) {
        var tc = tints && tints[s - 1] ? col(tints[s - 1]) : WHITE;
        r *= tc.r; gg *= tc.g; b *= tc.b; s = 0;
      }
      C[i * 3] = r; C[i * 3 + 1] = gg; C[i * 3 + 2] = b; S[i] = s;
    }
    g.setAttribute('color', new T.BufferAttribute(C, 3));
    g.setAttribute('slot', new T.BufferAttribute(S, 1));
    g.boundingBox = src.boundingBox.clone();
    g.boundingSphere = src.boundingSphere.clone();
    INSTGEO[key] = g;
    return g;
  }

  function Inst(name, kind, opts) {
    this.name = name;
    this.kind = kind || 'inst';
    this.opts = opts || {};
    this.items = [];
    this.mesh = null;
    this.core = 0;
  }
  /* o: { tint, thin (0..1, -1 = always), cam (collider toggled with visibility) } */
  Inst.prototype.add = function (m, o) {
    o = o || {};
    var it = { m: m.clone(), tint: o.tint ? col(o.tint) : null, thin: o.thin === undefined ? -1 : o.thin, cam: o.cam || null, hidden: false, index: -1 };
    this.items.push(it);
    return it;
  };
  Inst.prototype.build = function () {
    if (!this.items.length) return null;
    var core = this.items.filter(function (i) { return i.thin < 0; });
    var thin = this.items.filter(function (i) { return i.thin >= 0; }).sort(function (a, b) { return a.thin - b.thin; });
    var all = core.concat(thin), n = all.length;
    var base = instGeometry(this.name, this.opts.tints, this.opts.lod);
    var g = new T.BufferGeometry();
    ['position', 'normal', 'color', 'slot'].forEach(function (k) { g.setAttribute(k, base.attributes[k]); });
    var tintArr = new Float32Array(n * 3);
    var bs = base.boundingSphere, sphere = new T.Sphere(), box = new T.Box3(), tmp = new T.Sphere();
    var mesh = new T.InstancedMesh(g, material(this.kind), n);
    for (var i = 0; i < n; i++) {
      var it = all[i];
      it.index = i;
      mesh.setMatrixAt(i, it.m);
      var tc = it.tint || WHITE;
      tintArr[i * 3] = tc.r; tintArr[i * 3 + 1] = tc.g; tintArr[i * 3 + 2] = tc.b;
      tmp.copy(bs).applyMatrix4(it.m);
      box.expandByPoint(_p.copy(tmp.center).addScalar(tmp.radius));
      box.expandByPoint(_p.copy(tmp.center).addScalar(-tmp.radius));
    }
    g.setAttribute('iTint', new T.InstancedBufferAttribute(tintArr, 3));
    box.getBoundingSphere(sphere);
    g.boundingSphere = sphere;
    g.boundingBox = box;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = this.opts.cast !== false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'inst:' + this.name;
    /* optional cheaper twin for the 'low' quality (same instances) */
    if (this.opts.lowLod) {
      var lb = instGeometry(this.name, this.opts.tints, this.opts.lowLod), g2 = new T.BufferGeometry();
      ['position', 'normal', 'color', 'slot'].forEach(function (k) { g2.setAttribute(k, lb.attributes[k]); });
      g2.setAttribute('iTint', g.attributes.iTint);
      g2.boundingSphere = sphere; g2.boundingBox = box;
      var low = new T.InstancedMesh(g2, material(this.kind), n);
      low.instanceMatrix = mesh.instanceMatrix;
      low.castShadow = mesh.castShadow; low.receiveShadow = true; low.matrixAutoUpdate = false;
      low.visible = false; low.name = mesh.name + ':low';
      this.lowMesh = low;
    }
    this.mesh = mesh;
    this.list = all;
    this.core = core.length;
    return mesh;
  };
  /* Show core + thinnable items with thin < keep. */
  Inst.prototype.setKeep = function (keep) {
    if (!this.mesh) return;
    var c = this.core;
    for (var i = this.core; i < this.list.length; i++) {
      var it = this.list[i], on = it.thin < keep;
      if (on) c = i + 1;
      if (it.cam) it.cam.solid = on;
    }
    this.mesh.count = c;
    if (this.lowMesh) this.lowMesh.count = c;
  };
  Inst.prototype.setLow = function (on) {
    if (!this.lowMesh) return;
    this.lowMesh.visible = on;
    this.mesh.visible = !on;
  };
  /* Add the instances visible at `keep` (simplified geometry) to a Merge. */
  Inst.prototype.addFar = function (merge, keep, ratio) {
    var g = lodGeometry(this.name, ratio || 0.11), tints = this.opts.tints;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.hidden || (it.thin >= 0 && it.thin >= keep)) continue;
      var t = tints ? tints.slice() : [];
      t[0] = it.tint || (tints && tints[0]) || null;
      merge.add(g, it.m, t);
    }
  };
  Inst.prototype.setHidden = function (it, hidden) {
    if (!this.mesh || !it || it.hidden === hidden) return;
    it.hidden = hidden;
    this.mesh.setMatrixAt(it.index, hidden ? ZERO : it.m);
    this.mesh.instanceMatrix.needsUpdate = true;
  };
  Inst.prototype.setMatrix = function (it, m) {
    if (!this.mesh || !it) return;
    it.m.copy(m);
    if (!it.hidden) { this.mesh.setMatrixAt(it.index, m); this.mesh.instanceMatrix.needsUpdate = true; }
  };

  /* Matrix helper: position, yaw, uniform or per-axis scale. */
  function mat(x, y, z, ry, s, rx, rz) {
    _e.set(rx || 0, ry || 0, rz || 0, 'YXZ');
    _q.setFromEuler(_e);
    if (typeof s === 'number' || s === undefined) { var k = s === undefined ? 1 : s; _sc.set(k, k, k); }
    else _sc.set(s.x, s.y, s.z);
    return new T.Matrix4().compose(_p.set(x, y, z), _q, _sc);
  }

  /* =========================================================
     Fallback props (used while the GLB from the PROPS agent is
     missing). Front = +Z, origin on the ground, sizes from the
     catalogue in docs/AGENTS-CONTRACT.md.
     ========================================================= */
  var PI = Math.PI;
  var WOOD = '#9a6235', WOOD_L = '#c58a4e', WOOD_D = '#6b4426', STONE = '#bdb6a8', STONE_D = '#8f887c';
  var CREAM = '#f4efe2', ROOF = '#8a3b2c', GOLD = '#ffc83a', LEAF = '#4cb84a', LEAF_D = '#2f8f3b', LEAF_L = '#7fd35a';

  function roundTree(K, x, z, s, c1, c2, c3) {
    K.cyl(0.5 * s, 4.2 * s, '#8a5a32', x, 2.1 * s, z, { rt: 0.34 * s, seg: 7 });
    K.sph(2.7 * s, c1, x, 5.9 * s, z, { sy: 0.86, seg: 9 });
    K.sph(1.9 * s, c2, x + 1.4 * s, 6.9 * s, z + 0.6 * s, { seg: 8 });
    K.sph(1.8 * s, c3 || c1, x - 1.4 * s, 6.5 * s, z - 0.7 * s, { seg: 8 });
    K.sph(1.5 * s, c2, x - 0.2 * s, 7.9 * s, z + 0.1 * s, { seg: 8 });
  }
  function pineTree(K, x, z, s, c1, c2, snow) {
    K.cyl(0.4 * s, 2.2 * s, '#7a4a28', x, 1.1 * s, z, { seg: 6 });
    for (var i = 0; i < 3; i++) {
      var r = (2.7 - i * 0.72) * s, h = 3.1 * s, y = (2.0 + i * 1.75) * s;
      K.cone(r, h, i % 2 ? c2 : c1, x, y + h / 2, z, { seg: 8 });
      if (snow) K.cone(r * 0.62, h * 0.42, '#f6fbff', x, y + h * 0.79, z, { seg: 8 });
    }
  }
  function bush(K, x, z, s, c1, c2) {
    K.sph(1.5 * s, c1, x, 1.1 * s, z, { sy: 0.8, seg: 8 });
    K.sph(1.1 * s, c2, x + 1.0 * s, 1.0 * s, z + 0.4 * s, { sy: 0.85, seg: 8 });
    K.sph(1.0 * s, c1, x - 0.9 * s, 0.9 * s, z - 0.3 * s, { sy: 0.85, seg: 8 });
  }
  function rockPile(K, n, spread, size, cols, seed) {
    var rnd = SE.U.seeded(seed || 7);
    for (var i = 0; i < n; i++) {
      var a = rnd() * PI * 2, d = rnd() * spread, r = size * (0.6 + rnd() * 0.6);
      K.rock(r, cols[i % cols.length], Math.cos(a) * d, r * 0.45, Math.sin(a) * d, { seed: i + (seed || 0), ry: rnd() * 6, sy: 0.7 + rnd() * 0.4 });
    }
  }
  function flowers(K, x, z, s, colors, n, seed) {
    var rnd = SE.U.seeded(seed || 3);
    for (var i = 0; i < n; i++) {
      var a = rnd() * PI * 2, d = rnd() * 1.4 * s;
      var fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d, h = (0.5 + rnd() * 0.5) * s;
      K.box(0.08 * s, h, 0.08 * s, LEAF_D, fx, h / 2, fz);
      K.sph(0.26 * s, colors[i % colors.length], fx, h + 0.1 * s, fz, { seg: 6, sy: 0.7 });
    }
  }
  function column(K, x, z, h, r, c, cap) {
    K.box(r * 2.6, 0.5, r * 2.6, cap || c, x, 0.25, z);
    K.cyl(r, h - 1.0, c, x, 0.5 + (h - 1.0) / 2, z, { seg: 10 });
    K.box(r * 2.6, 0.5, r * 2.6, cap || c, x, h - 0.25, z);
  }
  function cloudPuff(K, x, y, z, s, seed) {
    var rnd = SE.U.seeded(seed || 11);
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * PI * 2 + rnd(), d = (i ? 1.6 : 0) * s;
      K.sph((1.5 + rnd() * 0.8) * s, i % 2 ? '#ffffff' : '#f3efff', x + Math.cos(a) * d, y + rnd() * 0.6 * s, z + Math.sin(a) * d * 0.7, { seg: 9, sy: 0.72 });
    }
  }
  function stall(K, part, c1, c2, ribbons) {
    K.box(8, 2.9, 3.2, '#8a5a2e', 0, 1.45, 0);
    K.box(7.4, 0.35, 0.15, '#b07840', 0, 2.2, 1.66);
    K.box(7.4, 0.35, 0.15, '#b07840', 0, 1.1, 1.66);
    K.box(8.6, 0.35, 3.8, '#b07840', 0, 3.07, 0);
    [-3.9, 3.9].forEach(function (x) { [-1.55, 1.55].forEach(function (z) { K.box(0.45, 6.6, 0.45, WOOD_D, x, 3.3, z); }); });
    for (var i = 0; i < 8; i++) K.box(1.075, 0.3, 4.6, i % 2 ? c1 : c2, -3.7625 + i * 1.075, 6.75, 0.1, { rx: 0.14 });
    for (var j = 0; j < 8; j++) K.box(1.0, 0.7, 0.16, j % 2 ? c1 : c2, -3.7625 + j * 1.075, 6.1, 2.42);
    K.box(0.6, 0.8, 0.6, '#ffe08a', -3.2, 5.1, 1.55, { glow: true });
    K.box(1.4, 0.9, 1.0, '#c9a06a', 2.6, 3.7, -0.6);
    K.box(1.0, 0.6, 0.8, '#e2c18a', 1.2, 3.55, -0.5);
    if (ribbons) {
      var rc = ['#4ade4a', '#3a8ef6', '#c04fff', '#ffd24a', '#ff6ad5'];
      for (var r = 0; r < 5; r++) {
        var p = part('Ribbon' + r, -2.4 + r * 1.2, 3.72, 0.4);
        p.box(0.6, 0.16, 1.8, rc[r], 0, 0, 0, { rx: -0.3, glow: true });
      }
    }
  }
  function archPosts(K, w, h, postW, c1, c2) {
    [-1, 1].forEach(function (s) {
      K.box(postW, h, postW, c1, s * (w / 2 - postW / 2), h / 2, 0);
      K.box(postW + 0.8, 1.0, postW + 0.8, c2, s * (w / 2 - postW / 2), 0.5, 0);
    });
  }

  var F = FALLBACK;

  /* ---------- farm base ---------- */
  F.P_barn = function (K) {
    var W = 20, D = 16, H = 10.5, R = 7.5;
    K.box(W + 0.6, 0.8, D + 0.6, STONE_D, 0, 0.4, 0);
    K.box(W, H, D, '#c9372c', 0, H / 2, 0);
    K.prism(W, R, D - 0.02, '#c9372c', 0, H, 0);
    var len = Math.hypot(W / 2, R) + 1.4, ang = Math.atan2(R, W / 2);
    K.box(len, 0.6, D + 1.8, '#5a3328', -W / 4 - 0.15, H + R / 2 + 0.3, 0, { rz: ang });
    K.box(len, 0.6, D + 1.8, '#5a3328', W / 4 + 0.15, H + R / 2 + 0.3, 0, { rz: -ang });
    [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { K.box(0.7, H, 0.7, CREAM, sx * W / 2, H / 2, sz * D / 2); }); });
    K.box(W + 0.2, 0.5, 0.5, CREAM, 0, H, D / 2);
    K.box(8, 8, 0.4, '#a52a22', 0, 4, D / 2 + 0.15);
    K.box(8.8, 0.6, 0.5, CREAM, 0, 8.2, D / 2 + 0.25);
    K.box(0.6, 8.2, 0.5, CREAM, -4.2, 4.1, D / 2 + 0.25);
    K.box(0.6, 8.2, 0.5, CREAM, 4.2, 4.1, D / 2 + 0.25);
    K.box(0.4, 8, 0.5, CREAM, 0, 4, D / 2 + 0.25);
    var dg = Math.hypot(4, 8), da = Math.atan2(8, 4);
    [-2, 2].forEach(function (x) {
      K.box(dg, 0.42, 0.42, CREAM, x, 4, D / 2 + 0.32, { rz: da });
      K.box(dg, 0.42, 0.42, CREAM, x, 4, D / 2 + 0.32, { rz: -da });
    });
    K.box(3.6, 3.6, 0.4, CREAM, 0, H + 2.6, D / 2 + 0.05);
    K.box(2.7, 2.7, 0.45, '#3b2a22', 0, H + 2.6, D / 2 + 0.12);
    [-1, 1].forEach(function (s) {
      K.box(0.4, 2.6, 3.2, CREAM, s * (W / 2 + 0.12), 6.2, -2);
      K.box(0.45, 2.0, 2.5, '#3b2a22', s * (W / 2 + 0.16), 6.2, -2);
      K.box(0.4, 2.6, 3.2, CREAM, s * (W / 2 + 0.12), 6.2, 4);
      K.box(0.45, 2.0, 2.5, '#3b2a22', s * (W / 2 + 0.16), 6.2, 4);
    });
    K.cone(0.5, 1.2, '#ffd24a', 0, H + R + 1.4, D / 2 - 1, { seg: 4 });
    K.box(0.12, 1.4, 0.12, '#3a3a3a', 0, H + R + 0.6, D / 2 - 1);
  };
  F.P_windmill = function (K, part) {
    K.cyl(4.1, 1.2, STONE_D, 0, 0.6, 0, { seg: 8 });
    K.cyl(3.6, 12, '#f2e8d2', 0, 7.2, 0, { rt: 2.5, seg: 8 });
    K.cyl(2.75, 0.6, '#7a3b2c', 0, 13.3, 0, { seg: 8 });
    K.cone(3.25, 4.4, '#a5442f', 0, 15.8, 0, { seg: 8 });
    K.sph(0.45, GOLD, 0, 18.1, 0, { seg: 6 });
    K.box(1.8, 3.0, 0.4, WOOD_D, 0, 2.7, 3.45, { rx: -0.09 });
    K.box(1.2, 1.2, 0.35, '#3b2a22', 0, 8.6, 2.95, { rx: -0.09 });
    K.box(1.0, 1.0, 0.35, '#3b2a22', 2.7, 6.0, 0.6, { ry: PI / 2 + 0.2 });
    var bl = part('Blades', 0, 12.6, 3.25);
    bl.cyl(0.7, 1.3, WOOD_D, 0, 0, 0, { rx: PI / 2, seg: 8 });
    for (var i = 0; i < 4; i++) {
      bl.push(0, 0, 0.45, 0, 1, 0, i * PI / 2);
      bl.box(0.35, 7.4, 0.25, '#8a5a32', 0, 3.9, 0);
      bl.box(1.9, 5.8, 0.1, '#f6efe0', 1.05, 4.6, 0.05);
      bl.box(0.12, 5.8, 0.18, '#8a5a32', 2.0, 4.6, 0.05);
      bl.box(1.9, 0.12, 0.18, '#8a5a32', 1.05, 2.4, 0.05);
      bl.box(1.9, 0.12, 0.18, '#8a5a32', 1.05, 4.6, 0.05);
      bl.box(1.9, 0.12, 0.18, '#8a5a32', 1.05, 6.8, 0.05);
      bl.pop();
    }
  };
  F.P_silo = function (K) {
    K.cyl(3.4, 0.6, STONE_D, 0, 0.3, 0, { seg: 14 });
    K.cyl(3, 11, '#cfd4db', 0, 6, 0, { seg: 14 });
    [2.5, 5.5, 8.5, 11.2].forEach(function (y) { K.cyl(3.08, 0.3, '#9aa3ae', 0, y, 0, { seg: 14 }); });
    K.sph(3.05, '#d64a3a', 0, 11.4, 0, { sy: 0.7, seg: 14 });
    K.box(0.15, 11, 0.15, '#7d858f', -0.5, 6, 3.08);
    K.box(0.15, 11, 0.15, '#7d858f', 0.5, 6, 3.08);
    for (var y = 1.5; y < 11; y += 1.2) K.box(1.0, 0.12, 0.12, '#7d858f', 0, y, 3.1);
  };
  F.P_water_tower = function (K) {
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        K.box(0.55, 10, 0.55, '#7a4a28', sx * 2.3, 5, sz * 2.3, { rz: -sx * 0.06, rx: sz * 0.06 });
      });
      K.box(5.2, 0.3, 0.3, '#8a5a32', 0, 3.2, sx * 2.45);
      K.box(0.3, 0.3, 5.2, '#8a5a32', sx * 2.45, 3.2, 0);
      K.box(5.0, 0.3, 0.3, '#8a5a32', 0, 6.8, sx * 2.25);
      K.box(0.3, 0.3, 5.0, '#8a5a32', sx * 2.25, 6.8, 0);
    });
    K.cyl(3.5, 0.5, WOOD_D, 0, 10.1, 0, { seg: 12 });
    K.cyl(3.0, 4.6, '#b9773f', 0, 12.6, 0, { seg: 12 });
    [11.0, 14.2].forEach(function (y) { K.cyl(3.07, 0.3, '#4a4a4a', 0, y, 0, { seg: 12 }); });
    K.cone(3.6, 2.2, '#7a3b2c', 0, 16.0, 0, { seg: 12 });
  };
  F.P_fountain = function (K, part) {
    K.cyl(6, 1.3, '#d9d2c3', 0, 0.65, 0, { seg: 22 });
    K.tor(5.7, 0.42, '#efe9dc', 0, 1.3, 0, { rx: PI / 2, seg: 22 });
    K.cyl(1.7, 2.3, '#d9d2c3', 0, 2.1, 0, { rt: 1.2, seg: 12 });
    K.cyl(3.0, 0.7, '#e6dfd0', 0, 3.4, 0, { rt: 3.2, seg: 16 });
    K.tor(3.05, 0.25, '#efe9dc', 0, 3.75, 0, { rx: PI / 2, seg: 16 });
    K.cyl(0.55, 2.0, '#d9d2c3', 0, 4.7, 0, { seg: 10 });
    K.cyl(1.0, 0.5, '#e6dfd0', 0, 5.9, 0, { seg: 10 });
    K.egg(2.2, '#ffcf3d', '#f2a91a', 0, 8.1, 0);
    var w = part('Water', 0, 0, 0);
    w.cyl(5.4, 0.2, '#5ec8f0', 0, 1.06, 0, { seg: 22 });
    w.cyl(2.85, 0.16, '#5ec8f0', 0, 3.72, 0, { seg: 16 });
  };
  F.P_fence = function (K) {
    K.box(0.75, 3.4, 0.75, '#8a5530', -2, 1.7, 0);
    K.box(1.0, 0.25, 1.0, '#a86a3c', -2, 3.5, 0);
    K.box(4, 0.42, 0.3, WOOD_L, 0, 2.6, 0);
    K.box(4, 0.42, 0.3, WOOD_L, 0, 1.35, 0);
  };
  F.P_fence_post = function (K) {
    K.box(0.75, 3.6, 0.75, '#8a5530', 0, 1.8, 0);
    K.box(1.0, 0.25, 1.0, '#a86a3c', 0, 3.7, 0);
  };
  F.P_incubator = function (K) {
    K.cyl(2.1, 0.45, '#d8c49a', 0, 0.225, 0, { seg: 18 });
    K.cyl(1.6, 0.3, '#ffd98a', 0, 0.55, 0, { seg: 18 });
    K.tor(1.8, 0.42, '#e8605a', 0, 0.68, 0, { rx: PI / 2, seg: 18 });
  };
  F.P_pen_sign = function (K) {
    K.box(0.45, 6.2, 0.45, WOOD_D, -3.4, 3.1, -0.25);
    K.box(0.45, 6.2, 0.45, WOOD_D, 3.4, 3.1, -0.25);
    K.box(8.5, 4.1, 0.25, '#3c2a1c', 0, 4, -0.1);
    K.box(8, 3.6, 0.3, '#1f4f8f', 0, 4, 0.05);
    K.prism(9, 0.9, 0.8, '#8a3b2c', 0, 6.05, -0.1);
  };
  F.P_stall_sell = function (K, part) { stall(K, part, '#ff3a1d', '#f8f7ec', false); };
  F.P_stall_trail = function (K, part) { stall(K, part, '#ffd400', '#fffef2', true); };
  F.P_treadmill = function (K, part) {
    K.box(5, 0.8, 9, '#2f3640', 0, 0.4, 0);
    K.box(0.4, 0.45, 9, '#5b6573', -2.3, 0.95, 0);
    K.box(0.4, 0.45, 9, '#5b6573', 2.3, 0.95, 0);
    var b = part('Belt', 0, 0.98, 0);
    b.box(4.2, 0.24, 8.4, '#262b33', 0, 0, 0);
    [-2.2, 2.2].forEach(function (x) { K.box(0.35, 3.4, 0.35, '#c0c8d0', x, 2.4, -3.6); });
    K.box(5, 0.35, 0.35, '#c0c8d0', 0, 3.95, -3.6);
    K.box(4.2, 1.6, 0.4, '#12161c', 0, 4.8, -3.7);
    K.box(3.4, 1.0, 0.1, '#3ad07a', 0, 4.8, -3.45, { glow: true });
  };
  F.P_kiosk = function (K) {
    K.box(6.4, 0.5, 4.4, STONE_D, 0, 0.25, 0);
    K.box(6, 4.2, 4, '#f3dfb6', 0, 2.6, 0);
    K.box(4.4, 1.7, 0.3, '#3b2a22', 0, 3.0, 2.02);
    K.box(5.2, 0.3, 1.2, '#c9a06a', 0, 2.1, 2.5);
    for (var i = 0; i < 6; i++) K.box(0.9, 0.22, 1.9, i % 2 ? '#ffffff' : '#2ecc71', -2.25 + i * 0.9, 4.55, 2.7, { rx: 0.38 });
    K.prism(6.9, 2.3, 4.8, '#2e9e5b', 0, 4.7, 0);
    K.box(0.25, 2.0, 0.25, WOOD_D, -2.1, 5.9, 2.35);
    K.box(0.25, 2.0, 0.25, WOOD_D, 2.1, 5.9, 2.35);
    K.box(5.0, 1.6, 0.3, '#fff7e0', 0, 7.0, 2.4);
    K.box(5.4, 2.0, 0.2, '#2e9e5b', 0, 7.0, 2.25);
  };
  F.P_lamp = function (K) {
    K.cyl(0.45, 0.4, '#3a4046', 0, 0.2, 0, { seg: 8 });
    K.cyl(0.14, 4.9, '#3a4046', 0, 2.7, 0, { seg: 6 });
    K.box(0.75, 0.95, 0.75, '#fff1b8', 0, 5.4, 0, { glow: true });
    K.cone(0.62, 0.55, '#3a4046', 0, 6.15, 0, { seg: 4, ry: PI / 4 });
    K.box(0.9, 0.12, 0.9, '#3a4046', 0, 4.9, 0);
  };
  F.P_bench = function (K) {
    K.box(3.2, 0.25, 1.0, WOOD_L, 0, 1.0, 0);
    K.box(3.2, 0.9, 0.2, WOOD_L, 0, 1.7, -0.45, { rx: -0.15 });
    [-1.3, 1.3].forEach(function (x) { K.box(0.25, 1.0, 0.9, '#3a4046', x, 0.5, 0); });
  };
  F.P_haybale = function (K) {
    K.cyl(1.25, 2.4, '#e8c35a', 0, 1.25, 0, { rz: PI / 2, seg: 12 });
    K.cyl(1.27, 0.15, '#b8913a', -0.6, 1.25, 0, { rz: PI / 2, seg: 12 });
    K.cyl(1.27, 0.15, '#b8913a', 0.6, 1.25, 0, { rz: PI / 2, seg: 12 });
  };
  F.P_crate = function (K) {
    K.box(1.7, 1.7, 1.7, '#b07a42', 0, 0.85, 0);
    K.box(1.76, 0.2, 1.76, '#7a4f28', 0, 0.2, 0);
    K.box(1.76, 0.2, 1.76, '#7a4f28', 0, 1.5, 0);
    K.box(0.2, 1.76, 1.76, '#7a4f28', 0, 0.85, 0, { ry: PI / 4 });
  };
  F.P_barrel = function (K) {
    K.cyl(0.78, 1.8, '#8a5a2e', 0, 0.9, 0, { seg: 10 });
    K.cyl(0.84, 0.9, '#9a6a3e', 0, 0.9, 0, { seg: 10 });
    [0.3, 1.5].forEach(function (y) { K.cyl(0.82, 0.12, '#4a4a4a', 0, y, 0, { seg: 10 }); });
  };
  F.P_pumpkin = function (K) {
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * PI * 2;
      K.sph(0.62, i % 2 ? '#f28a24' : '#e87a1c', Math.cos(a) * 0.38, 0.6, Math.sin(a) * 0.38, { sy: 0.85, seg: 8 });
    }
    K.cyl(0.12, 0.5, '#4f7a2a', 0, 1.25, 0, { seg: 5, rz: 0.2 });
  };
  F.P_flowerbed = function (K) {
    K.box(3.2, 0.5, 1.8, '#8a5a32', 0, 0.25, 0);
    K.box(2.9, 0.12, 1.5, '#5a3a22', 0, 0.52, 0);
    var rnd = SE.U.seeded(42), cs = ['#ff5a8a', '#ffd23a', '#ffffff', '#b76bff', '#ff8a3a'];
    for (var i = 0; i < 14; i++) {
      var x = -1.2 + (i % 7) * 0.4, z = i < 7 ? -0.35 : 0.35;
      K.box(0.07, 0.5, 0.07, LEAF_D, x, 0.8, z);
      K.sph(0.2, cs[Math.floor(rnd() * cs.length)], x, 1.1, z, { seg: 6, sy: 0.7 });
    }
  };
  F.P_well = function (K) {
    K.cyl(1.7, 1.3, STONE, 0, 0.65, 0, { seg: 12 });
    K.cyl(1.35, 0.2, '#2a6a8a', 0, 1.2, 0, { seg: 12 });
    [-1.5, 1.5].forEach(function (x) { K.box(0.3, 3.4, 0.3, WOOD_D, x, 2.4, 0); });
    K.cyl(0.2, 3.2, WOOD, 0, 3.2, 0, { rz: PI / 2, seg: 6 });
    K.prism(3.8, 1.3, 2.4, ROOF, 0, 4.0, 0, { ry: PI / 2 });
    K.box(0.6, 0.6, 0.6, WOOD_L, 0, 2.6, 0);
  };
  F.P_scarecrow = function (K) {
    K.box(0.3, 5, 0.3, WOOD_D, 0, 2.5, 0);
    K.box(3.4, 0.25, 0.25, WOOD_D, 0, 3.6, 0);
    K.box(1.4, 1.8, 0.8, '#5a7ad8', 0, 3.3, 0);
    K.sph(0.6, '#e8c890', 0, 4.7, 0, { seg: 8 });
    K.cyl(0.95, 0.12, '#c8a050', 0, 5.15, 0, { seg: 10 });
    K.cone(0.55, 0.8, '#c8a050', 0, 5.6, 0, { seg: 8 });
    K.box(0.5, 0.25, 0.3, '#e8c35a', -1.75, 3.6, 0);
    K.box(0.5, 0.25, 0.3, '#e8c35a', 1.75, 3.6, 0);
  };
  F.P_cart = function (K) {
    K.box(3.0, 0.8, 2.0, WOOD, 0, 1.4, 0);
    K.box(2.8, 0.4, 1.8, '#e8c35a', 0, 1.9, 0);
    [-1, 1].forEach(function (s) { K.cyl(0.9, 0.25, WOOD_D, 0.2, 0.9, s * 1.1, { rx: PI / 2, seg: 10 }); });
    K.box(2.6, 0.15, 0.15, WOOD_D, 2.6, 1.2, 0.5);
    K.box(2.6, 0.15, 0.15, WOOD_D, 2.6, 1.2, -0.5);
  };
  F.P_mailbox = function (K) {
    K.box(0.25, 2.4, 0.25, WOOD_D, 0, 1.2, 0);
    K.box(0.8, 0.7, 1.3, '#d64a3a', 0, 2.6, 0);
    K.cyl(0.4, 1.3, '#d64a3a', 0, 2.95, 0, { rx: PI / 2, seg: 10 });
    K.box(0.08, 0.6, 0.25, '#ffd24a', 0.44, 2.95, 0.4);
  };
  F.P_shed = function (K) {
    K.box(6, 0.4, 5, STONE_D, 0, 0.2, 0);
    K.box(5.4, 3.8, 4.4, '#d8a35a', 0, 2.3, 0);
    K.prism(6.2, 1.9, 5.2, '#7a3b2c', 0, 4.2, 0, { ry: PI / 2 });
    K.box(1.6, 2.6, 0.2, WOOD_D, 0, 1.7, 2.25);
    K.box(1.0, 1.0, 0.2, '#3b2a22', 1.8, 2.6, 2.25);
  };
  F.P_nest = function (K) {
    K.cyl(3.4, 0.55, '#5a3a22', 0, 0.28, 0, { rt: 3.1, seg: 16 });
    K.tor(3.0, 0.62, '#7b5230', 0, 0.85, 0, { rx: PI / 2, seg: 16 });
    var rnd = SE.U.seeded(77);
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * PI * 2;
      K.box(2.4, 0.22, 0.32, i % 3 ? '#9a7038' : '#c2a060', Math.cos(a) * 3.0, 1.0 + (i % 3) * 0.12, Math.sin(a) * 3.0, { ry: -a + PI / 2 + (rnd() - 0.5) * 0.5, rz: (rnd() - 0.5) * 0.3 });
    }
    K.cyl(2.6, 0.3, '#e8d9a8', 0, 0.75, 0, { seg: 14 });
  };
  F.P_gate_lock = function (K) {
    [-5.4, 5.4].forEach(function (x) {
      K.box(1.3, 7, 1.3, '#6b4a2e', x, 3.5, 0);
      K.box(1.7, 0.5, 1.7, '#8a6a4a', x, 7.1, 0);
      K.box(1.7, 0.6, 1.7, '#5a5048', x, 0.3, 0);
    });
    K.box(10.2, 1.3, 0.7, '#ffffff', 0, 5.2, 0, { tint: 1 });
    K.box(10.2, 1.0, 0.6, '#ffffff', 0, 2.4, 0, { tint: 1 });
    for (var i = 0; i < 5; i++) {
      K.box(0.9, 1.34, 0.74, CREAM, -4 + i * 2, 5.2, 0);
      K.box(0.9, 1.04, 0.64, CREAM, -3 + i * 2 - 0.0, 2.4, 0);
    }
    K.box(2.0, 1.7, 0.7, GOLD, 0, 3.8, 0.62);
    K.tor(0.62, 0.17, '#c9ccd2', 0, 4.75, 0.62, { arc: PI, seg: 8 });
    K.box(0.3, 0.5, 0.1, '#3a2a12', 0, 3.7, 1.0);
  };
  F.P_coin = function (K) { K.cyl(0.55, 0.16, GOLD, 0, 0.55, 0, { rx: PI / 2, seg: 12 }); };
  F.P_bridge_rail = function (K) {
    [-2.75, 2.75].forEach(function (x) {
      K.box(0.5, 2.3, 0.5, '#7a4a28', x, 1.15, 0);
      K.box(0.7, 0.2, 0.7, '#9a6a3e', x, 2.35, 0);
    });
    K.box(6.0, 0.32, 0.36, WOOD_L, 0, 2.0, 0);
    K.box(6.0, 0.22, 0.26, WOOD, 0, 1.1, 0);
  };
  F.P_lantern = function (K) {
    K.box(0.6, 0.4, 0.6, '#5a5048', 0, 0.2, 0);
    K.box(0.25, 3.4, 0.25, '#3a3530', 0, 1.9, 0);
    K.box(0.9, 0.12, 0.25, '#3a3530', 0.35, 3.55, 0);
    K.box(0.55, 0.75, 0.55, '#ffd27a', 0.75, 3.05, 0, { glow: true });
    K.cone(0.5, 0.4, '#3a3530', 0.75, 3.62, 0, { seg: 4, ry: PI / 4 });
  };
  F.P_boat = function (K) {
    K.box(4.4, 1.1, 2.2, '#b5562d', -0.3, 0.55, 0);
    K.prism(2.2, 1.6, 1.1, '#b5562d', 2.45, 1.1, 0, { rz: -PI / 2 });
    K.box(4.0, 0.2, 1.8, '#7a4a2a', -0.3, 0.95, 0);
    K.box(0.5, 0.15, 2.0, WOOD_L, -1.0, 1.15, 0);
    K.box(0.5, 0.15, 2.0, WOOD_L, 0.8, 1.15, 0);
    K.box(3.4, 0.12, 0.2, WOOD_D, 0.2, 1.3, 0.9, { ry: 0.25 });
  };
  F.P_dock = function (K) {
    [-3.5, -0.5, 2.5].forEach(function (x) { [-2.1, 2.1].forEach(function (z) { K.cyl(0.32, 4.0, WOOD_D, x, -0.8, z, { seg: 6 }); }); });
    for (var i = 0; i < 9; i++) K.box(0.82, 0.3, 5.0, i % 2 ? WOOD_L : '#b37a44', -3.6 + i * 0.9, 1.0, 0);
    K.box(8.2, 0.25, 0.3, WOOD_D, 0, 0.8, 2.4);
    K.box(8.2, 0.25, 0.3, WOOD_D, 0, 0.8, -2.4);
  };

  /* ---------- shared shore pieces ---------- */
  F.B_shore_rock = function (K) {
    K.rock(1.9, '#8f8a80', 0, 0.5, 0, { seed: 1, sy: 0.6 });
    K.rock(1.1, '#a39d92', 1.5, 0.4, 0.6, { seed: 2, sy: 0.7 });
    K.rock(0.8, '#7f7a72', -1.3, 0.3, -0.5, { seed: 3 });
  };
  F.B_shore_reeds = function (K) {
    var rnd = SE.U.seeded(5);
    for (var i = 0; i < 9; i++) {
      var a = rnd() * PI * 2, d = rnd() * 1.2, h = 1.6 + rnd() * 1.4;
      var x = Math.cos(a) * d, z = Math.sin(a) * d;
      K.cone(0.12, h, i % 2 ? '#5f9a3a' : '#79b24a', x, h / 2, z, { seg: 4, rz: (rnd() - 0.5) * 0.3 });
      if (i % 3 === 0) K.cyl(0.13, 0.5, '#7a4a28', x, h * 0.85, z, { seg: 5 });
    }
  };

  /* ---------- forest ---------- */
  F.B_forest_rim_a = function (K) {
    roundTree(K, -1.8, 0, 1.25, '#3fa34d', LEAF_L, '#358f40');
    bush(K, 2.8, 0.8, 1.2, '#45b24a', LEAF_L);
    K.rock(1.0, '#8f8a80', 3.6, 0.4, -1.0, { seed: 2 });
  };
  F.B_forest_rim_b = function (K) {
    pineTree(K, -2.2, -0.4, 1.35, '#2f8f4a', '#3aa457');
    pineTree(K, 1.6, 0.6, 1.05, '#2f8f4a', '#3aa457');
    pineTree(K, 3.6, -0.8, 0.8, '#2f8f4a', '#3aa457');
    K.rock(1.3, '#8f8a80', 0.2, 0.5, 1.6, { seed: 4 });
    K.rock(0.9, '#a39d92', -4.0, 0.4, 1.0, { seed: 5 });
  };
  F.B_forest_tree = function (K) { roundTree(K, 0, 0, 0.95, '#43ad4c', LEAF_L, '#379a42'); };
  F.B_forest_pine = function (K) { pineTree(K, 0, 0, 1.0, '#2f8f4a', '#3aa457'); };
  F.B_forest_bush = function (K) { bush(K, 0, 0, 1.0, '#45b24a', LEAF_L); };
  F.B_forest_log = function (K) {
    K.cyl(0.7, 4.2, '#8a5a32', 0, 0.7, 0, { rz: PI / 2, seg: 9 });
    K.cyl(0.6, 0.05, '#d9b07a', 2.12, 0.7, 0, { rz: PI / 2, seg: 9 });
    K.cyl(0.6, 0.05, '#d9b07a', -2.12, 0.7, 0, { rz: PI / 2, seg: 9 });
    K.sph(0.4, '#5fb04a', 0.6, 1.35, 0.1, { seg: 6, sy: 0.6 });
  };
  F.B_forest_mushroom = function (K) {
    K.cyl(0.35, 1.3, '#f4ecd8', 0, 0.65, 0, { rt: 0.28, seg: 8 });
    K.sph(1.0, '#e2382c', 0, 1.35, 0, { sy: 0.6, seg: 10 });
    [[0.4, 0.3], [-0.5, 0.1], [0.05, -0.55], [-0.1, 0.55]].forEach(function (d) { K.sph(0.16, '#ffffff', d[0], 1.85, d[1], { seg: 5, sy: 0.5 }); });
    K.cyl(0.22, 0.7, '#f4ecd8', 0.9, 0.35, 0.5, { seg: 6 });
    K.sph(0.5, '#e2382c', 0.9, 0.75, 0.5, { sy: 0.6, seg: 8 });
  };
  F.B_forest_flowers = function (K) { flowers(K, 0, 0, 1.0, ['#ff5a8a', '#ffd23a', '#ffffff', '#9a6bff'], 12, 9); };
  F.B_forest_landmark = function (K) {
    K.cyl(8.0, 9, '#8b5a2b', 0, 4.5, 0, { rt: 6.6, seg: 16 });
    K.cyl(6.65, 0.3, '#e0bb85', 0, 9.0, 0, { seg: 16 });
    [5.2, 3.6, 2.0].forEach(function (r) { K.tor(r, 0.12, '#b07a45', 0, 9.16, 0, { rx: PI / 2, seg: 16 }); });
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * PI * 2 + 0.3;
      K.box(5.5, 1.6, 1.7, '#7a4e26', Math.cos(a) * 8.6, 0.6, Math.sin(a) * 8.6, { ry: -a, rz: -0.25 });
    }
    K.box(3.2, 4.0, 1.2, '#3a2414', 0, 2.6, 7.35, { rx: -0.08 });
    K.sph(2.2, '#5fb04a', -5.8, 6.4, 3.0, { seg: 8, sy: 0.5 });
    K.sph(1.6, '#4ca83f', 6.0, 3.5, -2.8, { seg: 8, sy: 0.5 });
    K.sph(0.8, '#e2382c', 7.3, 1.0, 3.5, { seg: 8, sy: 0.6 });
    K.cyl(0.25, 0.9, '#f4ecd8', 7.3, 0.45, 3.5, { seg: 6 });
  };
  F.B_forest_arch = function (K) {
    [-1, 1].forEach(function (s) {
      K.cyl(1.7, 15.5, '#8b5a2b', s * 15.5, 7.75, 0, { rt: 1.4, seg: 9 });
      K.sph(2.6, '#3fa34d', s * 15.5, 16.4, 0, { seg: 9, sy: 0.8 });
      K.sph(1.6, LEAF_L, s * 14.6, 17.4, 1.0, { seg: 8 });
    });
    K.cyl(1.25, 33, '#7a4e26', 0, 15.2, 0, { rz: PI / 2, seg: 9 });
    for (var i = -3; i <= 3; i++) K.sph(1.5 + (i % 2 ? 0.3 : 0), i % 2 ? '#3fa34d' : LEAF_L, i * 4.2, 16.6, 0.2, { seg: 8, sy: 0.7 });
    K.box(9, 2.8, 0.5, '#c58a4e', 0, 12.6, 0.4);
    K.box(0.25, 1.6, 0.25, '#5a3a22', -3.5, 14.3, 0.4);
    K.box(0.25, 1.6, 0.25, '#5a3a22', 3.5, 14.3, 0.4);
    for (var v = 0; v < 6; v++) K.box(0.18, 2.5 + (v % 3), 0.18, '#3f9a3a', -12 + v * 4.8, 13.4 - (v % 3) * 0.5, 0.6);
  };

  /* ---------- desert ---------- */
  F.B_desert_rim_a = function (K) {
    var cs = ['#d9965a', '#e8b07a', '#c47a45', '#efc48a'];
    var y = 0;
    for (var i = 0; i < 4; i++) {
      var h = 2.4 + (i === 0 ? 0.8 : 0), w = 10 - i * 1.6, d = 6 - i * 0.9;
      K.box(w, h, d, cs[i], (i % 2 ? 0.4 : -0.3), y + h / 2, (i % 2 ? -0.2 : 0.2), { ry: (i % 2 ? 0.06 : -0.05) });
      y += h;
    }
    K.rock(1.4, '#d9965a', 4.6, 0.5, 2.0, { seed: 3 });
  };
  F.B_desert_rim_b = function (K) {
    K.rock(3.0, '#d68f55', -2.2, 1.6, 0, { seed: 1, sy: 0.9 });
    K.rock(2.4, '#e8b07a', 2.0, 1.2, 0.6, { seed: 2, sy: 1.0 });
    K.rock(1.8, '#c47a45', 0.2, 3.6, -0.2, { seed: 3, sy: 1.0 });
    K.rock(1.2, '#efc48a', 4.0, 0.5, -1.0, { seed: 4 });
  };
  F.B_desert_cactus = function (K) {
    var g = '#3f9f4f', g2 = '#56b862';
    K.cyl(0.75, 6.2, g, 0, 3.1, 0, { seg: 8 });
    K.sph(0.75, g, 0, 6.2, 0, { seg: 8 });
    K.cyl(0.45, 1.6, g2, -1.2, 3.2, 0, { rz: PI / 2, seg: 7 });
    K.cyl(0.45, 2.4, g2, -1.9, 4.3, 0, { seg: 7 });
    K.sph(0.45, g2, -1.9, 5.5, 0, { seg: 7 });
    K.cyl(0.42, 1.4, g2, 1.1, 2.4, 0, { rz: PI / 2, seg: 7 });
    K.cyl(0.42, 1.8, g2, 1.7, 3.2, 0, { seg: 7 });
    K.sph(0.42, g2, 1.7, 4.1, 0, { seg: 7 });
    K.sph(0.3, '#ff5fa2', 0, 7.0, 0, { seg: 6 });
  };
  F.B_desert_cactus2 = function (K) {
    K.sph(1.3, '#4aa85a', 0, 1.15, 0, { sy: 0.95, seg: 10 });
    K.sph(0.9, '#56b862', 1.4, 0.8, 0.5, { seg: 9 });
    K.sph(0.35, '#ffd23a', 0, 2.4, 0, { seg: 6 });
    K.sph(0.25, '#ff7aa8', 1.4, 1.65, 0.5, { seg: 6 });
  };
  F.B_desert_palm = function (K) {
    for (var i = 0; i < 6; i++) K.cyl(0.42 - i * 0.03, 1.5, i % 2 ? '#9a6a3e' : '#b07a48', i * 0.22, 0.75 + i * 1.45, 0, { rz: -0.12, seg: 7 });
    var tx = 1.4, ty = 9.2;
    for (var f = 0; f < 7; f++) {
      var a = f / 7 * PI * 2;
      K.push(tx, ty, 0, -a, 1, 0, 0);
      K.box(4.2, 0.12, 1.1, f % 2 ? '#3f9f4f' : '#56b862', 2.0, -0.6, 0, { rz: -0.35 });
      K.pop();
    }
    K.sph(0.35, '#6b4426', tx + 0.4, ty - 0.5, 0.3, { seg: 6 });
    K.sph(0.35, '#6b4426', tx - 0.3, ty - 0.55, -0.3, { seg: 6 });
  };
  F.B_desert_rock = function (K) {
    K.rock(1.8, '#d9965a', 0, 0.8, 0, { seed: 2, sy: 0.8 });
    K.rock(1.0, '#e8b07a', 1.5, 0.5, 0.6, { seed: 5 });
  };
  F.B_desert_bones = function (K) {
    for (var i = 0; i < 4; i++) K.tor(1.1, 0.12, '#f2ead6', -1.2 + i * 0.8, 0.5, 0, { arc: PI, ry: PI / 2, seg: 8 });
    K.cyl(0.13, 3.2, '#f2ead6', 0, 0.3, 0, { rz: PI / 2, seg: 5 });
    K.sph(0.6, '#f2ead6', 2.2, 0.5, 0.2, { seg: 8, sz: 1.3 });
    K.box(0.18, 0.2, 0.1, '#3a2a12', 2.4, 0.6, 0.85);
  };
  F.B_desert_landmark = function (K) {
    var cs = ['#e3b16e', '#d9a060', '#e8bb7a', '#d29858'];
    var sizes = [18, 14, 10, 6.4], hs = [3, 3, 2.8, 2.2], y = 0;
    for (var i = 0; i < 4; i++) {
      K.box(sizes[i], hs[i], sizes[i], cs[i], 0, y + hs[i] / 2, 0);
      K.box(sizes[i] + 0.2, 0.3, sizes[i] + 0.2, '#c08848', 0, y + hs[i] - 0.15, 0);
      y += hs[i];
    }
    K.box(3.2, 3.6, 1.0, '#7a5030', 0, 1.8, 9.05);
    K.box(4.0, 0.6, 1.2, '#2f6fb0', 0, 3.9, 9.05);
    for (var s = 0; s < 4; s++) K.box(2.4, 0.5, 0.6, GOLD, 0, y + 0.25, 0, { ry: s * PI / 4 });
  };
  F.B_desert_arch = function (K) {
    archPosts(K, 36, 15, 4, '#e3b16e', '#c08848');
    K.box(37, 2.6, 4.6, '#d9a060', 0, 16.3, 0);
    K.box(37.6, 0.6, 5.0, '#c08848', 0, 17.9, 0);
    for (var i = -4; i <= 4; i++) K.box(1.6, 1.0, 0.3, i % 2 ? '#2f6fb0' : GOLD, i * 3.6, 16.3, 2.35);
    [-1, 1].forEach(function (s) { K.box(1.4, 9, 0.3, '#2f6fb0', s * 16, 7, 2.1); K.sph(0.8, GOLD, s * 16, 19.0, 0, { seg: 8 }); });
  };

  /* ---------- candy ---------- */
  function cane(K, x, z, h, ry) {
    K.push(x, 0, z, ry || 0);
    var seg = 6;
    for (var i = 0; i < seg; i++) K.cyl(0.45, h / seg, i % 2 ? '#ffffff' : '#e8283c', 0, (i + 0.5) * h / seg, 0, { seg: 9 });
    K.tor(1.0, 0.45, '#e8283c', 1.0, h, 0, { arc: PI, seg: 9 });
    K.pop();
  }
  F.B_candy_rim_a = function (K) {
    cane(K, -3.5, 0, 8.5, 0); cane(K, 0.2, -0.3, 10, 0.4); cane(K, 3.8, 0.2, 7.5, -0.3);
    K.sph(1.5, '#3ad07a', -1.6, 1.1, 1.4, { sy: 0.8, seg: 10 });
    K.sph(1.3, '#ffd23a', 2.0, 1.0, 1.6, { sy: 0.8, seg: 10 });
    K.sph(1.2, '#a05aff', -4.6, 0.9, 1.4, { sy: 0.8, seg: 10 });
  };
  F.B_candy_rim_b = function (K) {
    [[-2.6, 4.2, 0.1], [2.4, 3.6, -0.15], [0, 4.8, 0]].forEach(function (c, i) {
      K.cyl(c[1], 1.2, '#d9a066', c[0], c[1], -i * 0.9 + 0.6, { rx: PI / 2, rz: c[2], seg: 16 });
      for (var k = 0; k < 6; k++) {
        var a = k / 6 * PI * 2 + i;
        K.sph(0.38, '#5a3420', c[0] + Math.cos(a) * c[1] * 0.55, c[1] + Math.sin(a) * c[1] * 0.55, -i * 0.9 + 1.25, { seg: 6, sz: 0.5 });
      }
    });
  };
  F.B_candy_lollipop = function (K) {
    K.cyl(0.2, 6.2, '#ffffff', 0, 3.1, 0, { seg: 6 });
    K.cyl(2.3, 0.6, '#ff5fa2', 0, 6.9, 0, { rx: PI / 2, seg: 18 });
    K.tor(1.5, 0.3, '#fff0f6', 0, 6.9, 0.32, { seg: 16 });
    K.tor(0.75, 0.25, '#fff0f6', 0, 6.9, 0.32, { seg: 12 });
  };
  F.B_candy_cupcake = function (K) {
    K.cyl(1.6, 1.8, '#5ac8f0', 0, 0.9, 0, { rt: 2.0, seg: 12 });
    K.sph(2.0, '#ffd6ea', 0, 2.1, 0, { sy: 0.55, seg: 12 });
    K.sph(1.4, '#ffc2dd', 0, 2.8, 0, { sy: 0.6, seg: 10 });
    K.sph(0.75, '#ffe6f2', 0, 3.4, 0, { sy: 0.7, seg: 8 });
    K.sph(0.4, '#e8283c', 0, 3.95, 0, { seg: 8 });
  };
  F.B_candy_donut = function (K) {
    K.tor(1.5, 0.75, '#e0a060', 0, 1.0, 0, { rx: PI / 2 - 0.25, seg: 16 });
    K.tor(1.5, 0.62, '#ff7fc0', 0, 1.18, 0.05, { rx: PI / 2 - 0.25, seg: 16 });
    var rnd = SE.U.seeded(12), cs = ['#ffffff', '#ffd23a', '#3ad07a', '#5ac8f0'];
    for (var i = 0; i < 10; i++) { var a = rnd() * PI * 2; K.box(0.35, 0.1, 0.1, cs[i % 4], Math.cos(a) * 1.5, 1.85 + Math.sin(a) * 0.35, Math.sin(a) * 1.5 * 0.97, { ry: rnd() * 3 }); }
  };
  F.B_candy_gumdrop = function (K) {
    K.cyl(1.4, 1.2, '#3ad07a', 0, 0.6, 0, { rt: 1.0, seg: 12 });
    K.sph(1.0, '#3ad07a', 0, 1.2, 0, { sy: 0.8, seg: 12 });
    K.sph(0.9, '#ffd23a', 2.0, 0.8, 0.6, { sy: 0.9, seg: 10 });
  };
  F.B_candy_wrapped = function (K) {
    K.sph(1.2, '#a05aff', 0, 1.1, 0, { sx: 1.3, seg: 12 });
    K.cone(0.9, 1.2, '#d6b0ff', -2.0, 1.1, 0, { rz: -PI / 2, seg: 8 });
    K.cone(0.9, 1.2, '#d6b0ff', 2.0, 1.1, 0, { rz: PI / 2, seg: 8 });
    K.tor(1.21, 0.12, '#ffffff', 0, 1.1, 0, { ry: PI / 2, seg: 14 });
  };
  F.B_candy_landmark = function (K) {
    var tiers = [[8.5, 4, '#ffd6ea'], [6.4, 3, '#fff0f6'], [4.4, 3, '#ffc2dd']], y = 0;
    tiers.forEach(function (t, i) {
      K.cyl(t[0], t[1], t[2], 0, y + t[1] / 2, 0, { seg: 22 });
      K.tor(t[0], 0.45, i % 2 ? '#ff7fc0' : '#ffffff', 0, y + t[1], 0, { rx: PI / 2, seg: 22 });
      for (var k = 0; k < 10; k++) { var a = k / 10 * PI * 2; K.sph(0.55, '#e8283c', Math.cos(a) * t[0], y + t[1] * 0.55, Math.sin(a) * t[0], { seg: 6, sy: 1.3 }); }
      y += t[1];
    });
    for (var c = 0; c < 6; c++) { var a2 = c / 6 * PI * 2; K.cyl(0.18, 1.2, '#5ac8f0', Math.cos(a2) * 3.4, y + 0.6, Math.sin(a2) * 3.4, { seg: 5 }); K.sph(0.22, '#ffd27a', Math.cos(a2) * 3.4, y + 1.35, Math.sin(a2) * 3.4, { seg: 5, glow: true }); }
  };
  F.B_candy_arch = function (K) {
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 8; i++) K.cyl(1.5, 2, i % 2 ? '#ffffff' : '#e8283c', s * 15.5, 1 + i * 2, 0, { seg: 12 });
      K.sph(2.0, s < 0 ? '#3ad07a' : '#ffd23a', s * 15.5, 17.0, 0, { sy: 0.8, seg: 10 });
    });
    K.box(33, 2.4, 2.6, '#7a4a2a', 0, 16.6, 0);
    for (var j = -7; j <= 7; j++) K.box(1.8, 0.4, 2.7, '#5a3420', j * 2.1, 17.9, 0);
    K.cyl(2.6, 0.6, '#ff5fa2', 0, 12.8, 0.6, { rx: PI / 2, seg: 16 });
    K.tor(1.6, 0.3, '#fff0f6', 0, 12.8, 0.95, { seg: 14 });
    K.cyl(0.2, 3, '#ffffff', 0, 14.8, 0.6, { seg: 6 });
  };

  /* ---------- ice ---------- */
  F.B_ice_rim_a = function (K) {
    var cs = ['#bfe9ff', '#9fdcff', '#d9f3ff'];
    [[-3, 5, 4.8, 0.1], [0.5, 7.5, 4.4, -0.1], [3.8, 4.2, 4.0, 0.2]].forEach(function (b, i) {
      K.box(b[2], b[1], 3.6, cs[i], b[0], b[1] / 2, 0, { ry: b[3] });
      K.box(b[2] + 0.4, 0.7, 4.0, '#ffffff', b[0], b[1] + 0.2, 0, { ry: b[3] });
    });
    K.cone(0.5, 2, '#d9f3ff', -1.0, 6.3, 1.6, { rx: PI, seg: 5 });
  };
  F.B_ice_rim_b = function (K) {
    pineTree(K, -2.2, -0.3, 1.3, '#2f7a5a', '#3a8f6a', true);
    pineTree(K, 1.8, 0.5, 1.0, '#2f7a5a', '#3a8f6a', true);
    K.rock(1.2, '#e6f4ff', 3.8, 0.5, -0.6, { seed: 2 });
    K.rock(1.0, '#ffffff', -4.2, 0.4, 0.8, { seed: 3 });
  };
  F.B_ice_crystal = function (K) {
    K.cone(1.0, 5.2, '#8fe0ff', 0, 2.6, 0, { seg: 6, glow: true });
    K.cone(0.7, 3.4, '#bff0ff', 1.0, 1.6, 0.4, { seg: 6, rz: -0.3, glow: true });
    K.cone(0.6, 2.8, '#6fd0ff', -0.9, 1.3, -0.3, { seg: 6, rz: 0.35, glow: true });
    K.rock(0.9, '#e6f4ff', 0, 0.2, 0, { seed: 1, sy: 0.4 });
  };
  F.B_ice_pine = function (K) { pineTree(K, 0, 0, 1.0, '#2f7a5a', '#3a8f6a', true); };
  F.B_ice_snowman = function (K) {
    K.sph(1.4, '#ffffff', 0, 1.3, 0, { seg: 12 });
    K.sph(1.0, '#ffffff', 0, 3.2, 0, { seg: 12 });
    K.sph(0.72, '#ffffff', 0, 4.65, 0, { seg: 10 });
    K.cone(0.16, 0.9, '#ff8a2a', 0, 4.65, 1.05, { rx: PI / 2, seg: 6 });
    K.cyl(0.6, 0.15, '#2a2a3a', 0, 5.3, 0, { seg: 10 });
    K.cyl(0.42, 0.75, '#2a2a3a', 0, 5.7, 0, { seg: 10 });
    K.tor(0.8, 0.18, '#e8283c', 0, 3.9, 0, { rx: PI / 2, seg: 12 });
    [-0.22, 0.22].forEach(function (x) { K.sph(0.08, '#1a1a1a', x, 4.85, 0.66, { seg: 5 }); });
  };
  F.B_ice_chunk = function (K) {
    K.rock(1.6, '#bfe9ff', 0, 0.7, 0, { seed: 4, sy: 0.9 });
    K.rock(0.9, '#e6f4ff', 1.4, 0.4, 0.5, { seed: 5 });
  };
  F.B_ice_landmark = function (K) {
    K.cyl(7.0, 11, '#cfeeff', 0, 5.5, 0, { rt: 4.2, seg: 9 });
    K.cyl(5.2, 1.0, '#ffffff', 0, 11.5, 0, { seg: 14 });
    K.cyl(4.6, 0.3, '#9fdcff', 0, 12.0, 0, { seg: 14 });
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * PI * 2 + 0.2, h = 9 + (i % 3) * 3;
      K.cone(1.3, h, i % 2 ? '#8fe0ff' : '#bff0ff', Math.cos(a) * 6.8, h / 2, Math.sin(a) * 6.8, { seg: 6, rx: Math.sin(a) * 0.25, rz: -Math.cos(a) * 0.25, glow: i % 2 === 0 });
    }
    K.box(2.6, 3.4, 0.8, '#7ac8f0', 0, 1.7, 6.6);
  };
  F.B_ice_arch = function (K) {
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 4; i++) K.box(4.2 - i * 0.2, 3.8, 4.2 - i * 0.2, i % 2 ? '#bfe9ff' : '#d9f3ff', s * 15.5, 1.9 + i * 3.8, 0, { ry: (i % 2 ? 0.08 : -0.06) });
      K.box(4.6, 0.8, 4.6, '#ffffff', s * 15.5, 15.6, 0);
    });
    for (var j = 0; j < 9; j++) K.box(4.0, 2.6, 4.0, j % 2 ? '#bfe9ff' : '#9fdcff', -15.5 + j * 3.875, 16.6, 0, { ry: (j % 2 ? 0.05 : -0.05) });
    K.box(36, 0.8, 4.4, '#ffffff', 0, 18.1, 0);
    for (var k = 0; k < 10; k++) K.cone(0.35, 1.4 + (k % 3) * 0.6, '#d9f3ff', -12 + k * 2.7, 14.6 - (k % 3) * 0.3, 1.4, { rx: PI, seg: 5 });
  };

  /* ---------- volcano ---------- */
  F.B_volcano_rim_a = function (K) {
    K.rock(3.2, '#3b3333', -2.2, 1.8, 0, { seed: 1, sy: 0.95 });
    K.rock(2.6, '#2f2a2a', 2.2, 1.4, 0.4, { seed: 2, sy: 1.0 });
    K.rock(1.8, '#4a3f3c', 0.3, 3.9, -0.4, { seed: 3 });
    K.box(3.6, 0.22, 0.3, '#ff6a1a', -2.0, 2.0, 2.4, { rz: 0.4, glow: true });
    K.box(2.6, 0.2, 0.3, '#ffae2a', 2.0, 1.5, 2.3, { rz: -0.5, glow: true });
  };
  F.B_volcano_rim_b = function (K) {
    [[-3.2, 7], [-1.2, 9.5], [0.9, 6], [2.9, 8.2], [4.4, 4.5], [-4.6, 4.8]].forEach(function (c, i) {
      K.cyl(1.05, c[1], i % 2 ? '#2f2b2b' : '#3a3434', c[0], c[1] / 2, (i % 2 ? 0.6 : -0.4), { seg: 6 });
      K.cyl(1.05, 0.2, '#5a4f4c', c[0], c[1] + 0.1, (i % 2 ? 0.6 : -0.4), { seg: 6 });
    });
  };
  F.B_volcano_rock = function (K) {
    K.rock(1.7, '#3b3333', 0, 0.8, 0, { seed: 4, sy: 0.85 });
    K.box(1.8, 0.2, 0.25, '#ff6a1a', 0, 1.1, 1.2, { rz: 0.3, glow: true });
  };
  F.B_volcano_column = function (K) {
    K.cyl(1.0, 5.5, '#2f2b2b', 0, 2.75, 0, { seg: 6 });
    K.cyl(0.9, 3.8, '#3a3434', 1.6, 1.9, 0.4, { seg: 6 });
    K.cyl(0.8, 2.4, '#2f2b2b', -1.4, 1.2, 0.6, { seg: 6 });
  };
  F.B_volcano_deadtree = function (K) {
    K.cyl(0.45, 5.5, '#3a2a24', 0, 2.75, 0, { rt: 0.2, seg: 6 });
    K.cyl(0.18, 2.6, '#3a2a24', 0.8, 4.2, 0, { rz: -0.8, seg: 5 });
    K.cyl(0.15, 2.2, '#3a2a24', -0.7, 3.4, 0.2, { rz: 0.9, seg: 5 });
    K.cyl(0.12, 1.6, '#3a2a24', 0.2, 5.0, -0.5, { rx: 0.7, seg: 5 });
  };
  F.B_volcano_obsidian = function (K) {
    K.cone(0.9, 3.6, '#2a1f3a', 0, 1.8, 0, { seg: 5, rz: 0.1 });
    K.cone(0.6, 2.4, '#3a2a55', 0.9, 1.2, 0.3, { seg: 5, rz: -0.35 });
    K.cone(0.5, 1.8, '#1f1830', -0.8, 0.9, -0.2, { seg: 5, rz: 0.4 });
  };
  F.B_volcano_landmark = function (K) {
    K.cyl(9.5, 12.6, '#4a3a36', 0, 6.3, 0, { rt: 4.0, seg: 12 });
    K.cyl(4.05, 0.4, '#5a4642', 0, 12.8, 0, { seg: 12 });
    K.cyl(3.4, 0.3, '#ff7a1a', 0, 12.9, 0, { seg: 12, glow: true });
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * PI * 2 + 0.4;
      K.box(0.6, 7, 0.3, i % 2 ? '#ff6a1a' : '#ffae2a', Math.cos(a) * 6.4, 7.6, Math.sin(a) * 6.4, { ry: -a + PI / 2, rx: 0.45 * 0, rz: 0, glow: true });
    }
    K.rock(2.6, '#3b3333', 8.6, 1.0, 3.0, { seed: 5 });
    K.rock(2.0, '#2f2a2a', -8.4, 0.8, -3.6, { seed: 6 });
  };
  F.B_volcano_arch = function (K) {
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 3; i++) K.cyl(1.3, 15 - i * 2.5, i % 2 ? '#2f2b2b' : '#3a3434', s * (15.5 + (i - 1) * 1.4), (15 - i * 2.5) / 2, (i - 1) * 0.9, { seg: 6 });
    });
    K.box(35, 2.6, 3.6, '#2f2b2b', 0, 15.8, 0);
    K.box(30, 0.3, 0.3, '#ff6a1a', 0, 15.2, 1.85, { glow: true });
    K.box(8, 0.3, 0.3, '#ffae2a', -6, 16.4, 1.85, { rz: 0.1, glow: true });
    K.box(6, 0.3, 0.3, '#ffae2a', 7, 16.2, 1.85, { rz: -0.15, glow: true });
    K.rock(1.6, '#3b3333', -12, 17.6, 0, { seed: 2 });
    K.rock(1.3, '#3b3333', 11, 17.4, 0.3, { seed: 3 });
  };

  /* ---------- sky ---------- */
  F.B_sky_rim_a = function (K) {
    cloudPuff(K, -2.0, 2.8, 0, 1.4, 3);
    cloudPuff(K, 2.4, 4.0, 0.3, 1.2, 4);
    cloudPuff(K, 0.2, 6.2, -0.2, 1.0, 5);
  };
  F.B_sky_rim_b = function (K) {
    column(K, -3.4, 0, 9, 0.75, '#f4f0ff', '#e6dcff');
    column(K, 0, 0, 7, 0.75, '#f4f0ff', '#e6dcff');
    column(K, 3.4, 0, 4.2, 0.75, '#f4f0ff', '#e6dcff');
    K.box(5.6, 1.0, 2.0, '#efe8ff', -1.7, 9.4, 0, { rz: 0.06 });
    K.box(5.4, 0.25, 2.1, GOLD, -1.7, 9.95, 0, { rz: 0.06 });
    K.box(2.2, 0.8, 1.8, '#efe8ff', 4.4, 0.4, 1.2, { ry: 0.5 });
  };
  F.B_sky_cloud = function (K) { cloudPuff(K, 0, 1.6, 0, 0.9, 8); };
  F.B_sky_column = function (K) { column(K, 0, 0, 6.5, 0.8, '#f4f0ff', '#e6dcff'); K.box(2.2, 0.2, 2.2, GOLD, 0, 6.6, 0); };
  F.B_sky_floatrock = function (K) {
    K.rock(1.8, '#a89cc8', 0, 3.4, 0, { seed: 2, sy: 0.9, rx: PI });
    K.sph(1.8, '#8fd06a', 0, 3.9, 0, { sy: 0.35, seg: 9 });
    K.sph(0.6, '#ffffff', 1.0, 4.4, 0.4, { seg: 6 });
  };
  F.B_sky_harp = function (K) {
    K.box(1.6, 0.4, 1.2, GOLD, 0, 0.2, 0);
    K.tor(2.2, 0.18, GOLD, 0, 2.6, 0, { arc: PI * 1.2, rz: -0.3, seg: 12 });
    K.box(0.25, 4.4, 0.25, GOLD, -1.6, 2.4, 0);
    for (var i = 0; i < 6; i++) K.box(0.05, 2.6 - i * 0.2, 0.05, '#fff6d6', -1.2 + i * 0.5, 2.0, 0);
  };
  F.B_sky_landmark = function (K) {
    K.cyl(8.2, 1.4, '#f4f0ff', 0, 0.7, 0, { seg: 18 });
    K.cyl(7.6, 0.4, GOLD, 0, 1.45, 0, { seg: 18 });
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * PI * 2;
      column(K, Math.cos(a) * 6.2, Math.sin(a) * 6.2, 0, 0.6, '#f4f0ff', '#e6dcff');
      K.push(Math.cos(a) * 6.2, 1.6, Math.sin(a) * 6.2);
      K.cyl(0.6, 6.6, '#f4f0ff', 0, 3.3, 0, { seg: 10 });
      K.box(1.6, 0.5, 1.6, '#e6dcff', 0, 6.8, 0);
      K.pop();
    }
    K.cyl(7.6, 1.2, '#efe8ff', 0, 9.0, 0, { seg: 18 });
    K.cyl(7.8, 0.35, GOLD, 0, 9.75, 0, { seg: 18 });
    K.cyl(7.2, 0.3, '#f4f0ff', 0, 9.9, 0, { seg: 18 });
  };
  F.B_sky_arch = function (K) {
    [-1, 1].forEach(function (s) {
      K.box(4.2, 1.2, 4.2, '#e6dcff', s * 15.5, 0.6, 0);
      K.cyl(1.5, 13, '#f4f0ff', s * 15.5, 7.7, 0, { seg: 12 });
      K.box(3.8, 1.0, 3.8, GOLD, s * 15.5, 14.5, 0);
    });
    K.box(36, 2.4, 3.6, '#f4f0ff', 0, 16.2, 0);
    K.box(36.4, 0.5, 3.9, GOLD, 0, 17.6, 0);
    K.prism(14, 3.2, 3.4, '#efe8ff', 0, 17.8, 0);
    K.tor(10, 0.5, GOLD, 0, 5.0, 0, { arc: PI, seg: 20 });
    cloudPuff(K, -17, 1.0, 2.0, 1.0, 6);
    cloudPuff(K, 17, 1.0, 2.0, 1.0, 7);
  };

  SE.Batch = {
    TIME: TIME,
    color: col,
    material: material,
    freshMaterial: makeMaterial,
    Kit: Kit,
    Merge: Merge,
    Inst: Inst,
    prop: prop,
    partObject: partObject,
    simplify: simplify,
    lodGeometry: lodGeometry,
    mat: mat,
    FALLBACK: FALLBACK,
    PARTS: PARTS,
    /* forget cached props (e.g. after the GLB files changed) */
    reset: function () { LIB = {}; INSTGEO = {}; LODGEO = {}; }
  };
})(window);
