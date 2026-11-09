/* =========================================================
   Terrain and environment for the "Egg Islands" map
   (owned by the MAP agent):
   - land shape (signed distance) and ground height;
   - procedural canvas ground textures and splat masks;
   - ground shader (texture splatting in world space);
   - animated sea, sky dome, distant islands, clouds, pools.
   Everything is generated at load time, no image files.
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var T = global.THREE;

  var WATER_Y = -1.25;          /* sea level (ground is y = 0) */
  var MAP_MIN = -300, MAP_SIZE = 600;   /* global mask / SDF area */
  var HUB_MIN = -112, HUB_SIZE = 224;   /* detailed hub mask */
  var GRID = 4;                 /* ground mesh grid step */
  var BEACH = 9;                /* width of the sloped beach above water */

  /* ---------------- noise (JS) ---------------- */
  function hash2(ix, iz, seed) {
    var h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, z, seed) {
    var ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    var a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
    var ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }
  function fbm(x, z, seed, oct) {
    var s = 0, amp = 0.5, f = 1, tot = 0;
    for (var i = 0; i < (oct || 3); i++) { s += vnoise(x * f, z * f, seed + i * 17) * amp; tot += amp; amp *= 0.5; f *= 2.03; }
    return s / tot;
  }

  /* ---------------- land shape ---------------- */
  var LAND = { hub: { x: 0, z: 0, r: 106 }, islands: [], causeways: [] };

  function segDist(px, pz, c) {
    var t = ((px - c.ax) * c.dx + (pz - c.az) * c.dz) / c.len2;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var qx = c.ax + c.dx * t - px, qz = c.az + c.dz * t - pz;
    return Math.sqrt(qx * qx + qz * qz);
  }
  function smin(a, b, k) {
    var h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }
  /* Signed distance to the coast: negative on land. */
  function rawSdf(x, z) {
    var d = Math.sqrt(x * x + z * z) - LAND.hub.r;
    for (var i = 0; i < LAND.islands.length; i++) {
      var s = LAND.islands[i], dx = x - s.x, dz = z - s.z;
      d = smin(d, Math.sqrt(dx * dx + dz * dz) - s.r, 16);
    }
    for (var j = 0; j < LAND.causeways.length; j++) {
      var c = LAND.causeways[j];
      d = smin(d, segDist(x, z, c) - c.w, 12);
    }
    return d;
  }
  function sdf(x, z) {
    var d = rawSdf(x, z);
    if (d > 40 || d < -40) return d;
    return d + (fbm(x * 0.028, z * 0.028, 7, 3) - 0.5) * 7.5 + (vnoise(x * 0.13, z * 0.13, 3) - 0.5) * 1.6;
  }
  function heightFromD(d) {
    if (d <= -BEACH) return 0;
    if (d <= 0) { var t = (d + BEACH) / BEACH; return -Math.pow(t, 1.7) * (-WATER_Y + 0.2); }
    return Math.max(-10, WATER_Y - 0.2 - d * 0.85);
  }
  function height(x, z) { return heightFromD(sdf(x, z)); }

  /* ---------------- canvas helpers ---------------- */
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  function hexRGB(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  /* periodic value noise (tileable) */
  function pnoise(size, cells, seed) {
    var out = new Float32Array(size * size), lat = new Float32Array(cells * cells), rnd = SE.U.seeded(seed);
    for (var i = 0; i < lat.length; i++) lat[i] = rnd();
    for (var y = 0; y < size; y++) {
      var fy = y / size * cells, iy = Math.floor(fy), ty = fy - iy, iy1 = (iy + 1) % cells;
      ty = ty * ty * (3 - 2 * ty);
      for (var x = 0; x < size; x++) {
        var fx = x / size * cells, ix = Math.floor(fx), tx = fx - ix, ix1 = (ix + 1) % cells;
        tx = tx * tx * (3 - 2 * tx);
        var a = lat[iy * cells + ix], b = lat[iy * cells + ix1], c = lat[iy1 * cells + ix], d = lat[iy1 * cells + ix1];
        out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
      }
    }
    return out;
  }
  function pfbm(size, base, oct, seed) {
    var out = new Float32Array(size * size), amp = 1, tot = 0;
    for (var o = 0; o < oct; o++) {
      var n = pnoise(size, base << o, seed + o * 31);
      for (var i = 0; i < out.length; i++) out[i] += n[i] * amp;
      tot += amp; amp *= 0.5;
    }
    for (var k = 0; k < out.length; k++) out[k] /= tot;
    return out;
  }
  /* Fill a canvas from a per-pixel colour function, then let `draw` add strokes. */
  function makeTex(size, pixel, draw, opts) {
    var c = canvas(size), ctx = c.getContext('2d');
    var img = ctx.createImageData(size, size), d = img.data, out = [0, 0, 0];
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        pixel(x, y, y * size + x, out);
        var i = (y * size + x) * 4;
        d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (draw) draw(ctx, size, SE.U.seeded((opts && opts.seed) || 5));
    var t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  function mixc(a, b, t, out) {
    out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }
  function grain(i, k) { return (hash2(i, i * 7 + 3, 99) - 0.5) * k; }
  /* draw a shape wrapped around the tile edges */
  function wrapDraw(ctx, size, x, y, r, fn) {
    for (var ox = -1; ox <= 1; ox++) {
      for (var oy = -1; oy <= 1; oy++) {
        var px = x + ox * size, py = y + oy * size;
        if (px < -r || px > size + r || py < -r || py > size + r) continue;
        fn(px, py);
      }
    }
  }
  function strokes(ctx, size, rnd, n, cols, len, width, alpha, angle) {
    ctx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x = rnd() * size, y = rnd() * size, a = angle === undefined ? rnd() * Math.PI * 2 : angle + (rnd() - 0.5) * 1.2;
      var l = len * (0.5 + rnd());
      ctx.strokeStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.globalAlpha = alpha * (0.6 + rnd() * 0.4);
      ctx.lineWidth = width * (0.7 + rnd() * 0.6);
      wrapDraw(ctx, size, x, y, l, function (px, py) {
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
  }
  function dots(ctx, size, rnd, n, cols, r0, r1, alpha, squash) {
    for (var i = 0; i < n; i++) {
      var x = rnd() * size, y = rnd() * size, r = r0 + rnd() * (r1 - r0), a = rnd() * Math.PI;
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.globalAlpha = alpha * (0.7 + rnd() * 0.3);
      wrapDraw(ctx, size, x, y, r, function (px, py) {
        ctx.beginPath(); ctx.ellipse(px, py, r, r * (squash || 1), a, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
  }
  /* Voronoi tiles (cobbles, hex basalt, marble slabs) */
  function cells(size, count, seed) {
    var rnd = SE.U.seeded(seed), pts = [];
    for (var i = 0; i < count; i++) pts.push([rnd() * size, rnd() * size, rnd()]);
    return function (x, y) {
      var d1 = 1e9, d2 = 1e9, id = 0;
      for (var k = 0; k < pts.length; k++) {
        var dx = Math.abs(x - pts[k][0]), dy = Math.abs(y - pts[k][1]);
        if (dx > size / 2) dx = size - dx;
        if (dy > size / 2) dy = size - dy;
        var dd = dx * dx + dy * dy;
        if (dd < d1) { d2 = d1; d1 = dd; id = k; } else if (dd < d2) d2 = dd;
      }
      return { edge: Math.sqrt(d2) - Math.sqrt(d1), center: Math.sqrt(d1), v: pts[id][2] };
    };
  }

  /* ---------------- ground textures ---------------- */
  var TEX = {};
  var S = 256;
  var GEN = {
    grass: function () {
      var n = pfbm(S, 4, 4, 11), a = hexRGB('#62cf3f'), b = hexRGB('#3fa52f'), c = hexRGB('#7bd84a');
      return makeTex(S, function (x, y, i, o) {
        mixc(a, b, n[i], o); if (n[i] < 0.35) mixc(o, c, (0.35 - n[i]) * 1.6, o);
        var g = grain(i, 14); o[0] += g; o[1] += g; o[2] += g * 0.5;
      }, function (ctx, s, rnd) {
        strokes(ctx, s, rnd, 1100, ['#8be35c', '#9bea6a', '#2f8f25', '#36952a'], 4, 1.4, 0.55, -Math.PI / 2);
        dots(ctx, s, rnd, 14, ['#ffffff', '#ffe14a'], 1.0, 1.6, 0.8);
      });
    },
    dirt: function () {
      var n = pfbm(S, 4, 4, 21), a = hexRGB('#c9a06c'), b = hexRGB('#a57a4c');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 18); o[0] += g; o[1] += g; o[2] += g; },
        function (ctx, s, rnd) {
          dots(ctx, s, rnd, 140, ['#dcbf92', '#8a6440', '#b58a5a', '#e6d0a8'], 1.2, 3.4, 0.85, 0.75);
          dots(ctx, s, rnd, 60, ['#7a5634'], 0.6, 1.2, 0.6);
        });
    },
    sand: function () {
      var n = pfbm(S, 4, 3, 31), a = hexRGB('#f4dfa6'), b = hexRGB('#e2c27e');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 16); o[0] += g; o[1] += g; o[2] += g; },
        function (ctx, s, rnd) { dots(ctx, s, rnd, 90, ['#c9a464', '#fff3cf', '#b8935a'], 0.6, 1.4, 0.7); });
    },
    stone: function () {
      var v = cells(S, 30, 41), n = pfbm(S, 8, 2, 43), cols = [hexRGB('#d8d0c0'), hexRGB('#c7bfae'), hexRGB('#e2dbcc'), hexRGB('#bdb3a0')], m = hexRGB('#8c8172');
      return makeTex(S, function (x, y, i, o) {
        var c = v(x, y), base = cols[Math.floor(c.v * 4)];
        var shade = 1.06 - Math.min(1, c.center / 26) * 0.14;
        o[0] = base[0] * shade; o[1] = base[1] * shade; o[2] = base[2] * shade;
        mixc(o, m, 1 - Math.min(1, Math.max(0, (c.edge - 1.2) / 2.2)), o);
        var g = grain(i, 10) + (n[i] - 0.5) * 18; o[0] += g; o[1] += g; o[2] += g;
      });
    },
    straw: function () {
      var n = pfbm(S, 4, 3, 51), a = hexRGB('#e9c96e'), b = hexRGB('#d2ab4e');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); },
        function (ctx, s, rnd) { strokes(ctx, s, rnd, 900, ['#f8e092', '#c79a3c', '#fff0b0', '#b88a30'], 7, 1.3, 0.75); });
    },
    /* forest */
    forestTop: function () {
      var n = pfbm(S, 4, 4, 61), a = hexRGB('#4fb43e'), b = hexRGB('#2f8a2c');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 12); o[0] += g; o[1] += g; },
        function (ctx, s, rnd) {
          strokes(ctx, s, rnd, 800, ['#6fcf4a', '#2a7a26', '#3f9a32'], 4, 1.3, 0.55, -Math.PI / 2);
          dots(ctx, s, rnd, 70, ['#c98a3a', '#e0b04a', '#a0602a', '#7fbf3a'], 1.4, 2.8, 0.85, 0.55);
        });
    },
    forestPath: function () {
      var n = pfbm(S, 4, 4, 71), a = hexRGB('#a57a4a'), b = hexRGB('#7e5a36');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 16); o[0] += g; o[1] += g; o[2] += g; },
        function (ctx, s, rnd) { dots(ctx, s, rnd, 90, ['#c49a6a', '#6a4a2a', '#d8b88a'], 1.2, 3.0, 0.8, 0.7); });
    },
    /* desert */
    desertTop: function () {
      var n = pfbm(S, 4, 3, 81), a = hexRGB('#f2d08c'), b = hexRGB('#dcae68');
      return makeTex(S, function (x, y, i, o) {
        var r = Math.sin((x * 0.82 + y * 0.35) / S * Math.PI * 2 * 7 + n[i] * 7) * 0.5 + 0.5;
        mixc(a, b, n[i] * 0.6 + r * 0.35, o); var g = grain(i, 12); o[0] += g; o[1] += g; o[2] += g;
      });
    },
    desertPath: function () {
      var n = pfbm(S, 4, 4, 91), a = hexRGB('#d9a866'), b = hexRGB('#bf8a4c');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 16); o[0] += g; o[1] += g; o[2] += g; },
        function (ctx, s, rnd) { dots(ctx, s, rnd, 80, ['#a0703a', '#e8c48a', '#8a5a2a'], 1.2, 3.0, 0.85, 0.7); });
    },
    desertShore: function () {
      var n = pfbm(S, 4, 3, 101), a = hexRGB('#fbe8bb'), b = hexRGB('#ecd29a');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 14); o[0] += g; o[1] += g; o[2] += g; });
    },
    /* candy */
    candyTop: function () {
      var n = pfbm(S, 4, 3, 111), a = hexRGB('#ffbfe2'), b = hexRGB('#ff9fd0');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); },
        function (ctx, s, rnd) {
          var cols = ['#ffffff', '#ffe14a', '#4ad6ff', '#7aff8a', '#ff5a7a', '#b07aff'];
          for (var k = 0; k < 230; k++) {
            var x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI, c = cols[Math.floor(rnd() * cols.length)];
            wrapDraw(ctx, s, x, y, 6, function (px, py) {
              ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.fillStyle = c;
              ctx.beginPath(); ctx.ellipse(0, 0, 3.6, 1.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            });
          }
        });
    },
    candyPath: function () {
      var n = pfbm(S, 4, 4, 121), a = hexRGB('#86502e'), b = hexRGB('#5e3420');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); },
        function (ctx, s, rnd) { strokes(ctx, s, rnd, 60, ['#b07a50', '#9a6440'], 18, 3, 0.35); });
    },
    candyShore: function () {
      var n = pfbm(S, 4, 3, 131), a = hexRGB('#fff4fa'), b = hexRGB('#ffd8ec');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 20); o[0] += g; o[1] += g; o[2] += g; });
    },
    /* ice */
    snowTop: function () {
      var n = pfbm(S, 4, 4, 141), a = hexRGB('#f6fcff'), b = hexRGB('#d3e9f8');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); },
        function (ctx, s, rnd) { dots(ctx, s, rnd, 60, ['#ffffff', '#bfe2f8'], 0.6, 1.4, 0.8); });
    },
    snowPath: function () {
      var n = pfbm(S, 4, 3, 151), a = hexRGB('#b5e2f7'), b = hexRGB('#8cc8ea');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); },
        function (ctx, s, rnd) { strokes(ctx, s, rnd, 40, ['#ffffff', '#e6f6ff'], 22, 1.0, 0.6); });
    },
    iceShore: function () {
      var n = pfbm(S, 4, 4, 161), a = hexRGB('#a9c2d2'), b = hexRGB('#7f9aae');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 12); o[0] += g; o[1] += g; o[2] += g; });
    },
    /* volcano */
    ashTop: function () {
      var n = pfbm(S, 4, 4, 171), a = hexRGB('#4c4241'), b = hexRGB('#332c2c');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 10); o[0] += g; o[1] += g; o[2] += g; },
        function (ctx, s, rnd) {
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          for (var v = 0; v < 6; v++) {
            var x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI * 2, pts = [[x, y]];
            for (var k = 0; k < 9; k++) { a += (rnd() - 0.5) * 1.3; x += Math.cos(a) * 8; y += Math.sin(a) * 8; pts.push([x, y]); }
            [[3.6, '#ff5a10'], [1.5, '#ffb02a']].forEach(function (st) {
              ctx.strokeStyle = st[1]; ctx.lineWidth = st[0]; ctx.globalAlpha = 1;
              for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
                ctx.beginPath();
                pts.forEach(function (p, j) { if (j) ctx.lineTo(p[0] + ox * s, p[1] + oy * s); else ctx.moveTo(p[0] + ox * s, p[1] + oy * s); });
                ctx.stroke();
              }
            });
          }
          dots(ctx, s, rnd, 50, ['#5e5250', '#262020'], 1, 2.4, 0.8);
        });
    },
    ashPath: function () {
      var v = cells(S, 26, 181), a = hexRGB('#3a3434'), e = hexRGB('#62564f');
      return makeTex(S, function (x, y, i, o) {
        var c = v(x, y); mixc(a, e, 1 - Math.min(1, Math.max(0, (c.edge - 1) / 2.5)), o);
        var g = grain(i, 10) + (c.v - 0.5) * 16; o[0] += g; o[1] += g; o[2] += g;
      });
    },
    volcanoShore: function () {
      var n = pfbm(S, 4, 3, 191), a = hexRGB('#3a3434'), b = hexRGB('#262222');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, n[i], o); var g = grain(i, 22); o[0] += g; o[1] += g; o[2] += g; });
    },
    /* sky */
    marbleTop: function () {
      var n = pfbm(S, 4, 4, 201), a = hexRGB('#f1ebff'), v = hexRGB('#b39cff'), b = hexRGB('#ddd3ff');
      return makeTex(S, function (x, y, i, o) {
        mixc(a, b, n[i] * 0.6, o);
        var vein = Math.abs(Math.sin((x + y * 0.6) / S * Math.PI * 2 * 3 + n[i] * 9));
        mixc(o, v, Math.pow(1 - vein, 10) * 0.75, o);
      });
    },
    skyPath: function () {
      var n = pfbm(S, 4, 3, 211), a = hexRGB('#fbf9ff'), b = hexRGB('#e6deff'), g = hexRGB('#e8c050');
      return makeTex(S, function (x, y, i, o) {
        mixc(a, b, n[i] * 0.7, o);
        var tx = x % 64, ty = y % 64;
        if (tx < 2 || ty < 2) mixc(o, g, 0.9, o);
      });
    },
    skyShore: function () {
      var n = pfbm(S, 4, 4, 221), a = hexRGB('#ffffff'), b = hexRGB('#e2dcff');
      return makeTex(S, function (x, y, i, o) { mixc(a, b, Math.pow(n[i], 1.5), o); });
    },
    cloud: function () {
      var n = pfbm(S, 4, 5, 231);
      var t = makeTex(S, function (x, y, i, o) { var v = n[i] * 255; o[0] = v; o[1] = v; o[2] = v; });
      return t;
    }
  };
  function tex(name) {
    if (!TEX[name]) TEX[name] = GEN[name]();
    return TEX[name];
  }

  /* ---------------- splat masks ---------------- */
  /* R = path, G = paved plaza, B = pen floor / special patch */
  var MASK = { hub: null, global: null };
  function newMask(res, min, size) {
    var c = canvas(res), ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, res, res);
    ctx.globalCompositeOperation = 'lighter';
    return { c: c, ctx: ctx, res: res, min: min, size: size, k: res / size };
  }
  var CH = { r: '#ff0000', g: '#00ff00', b: '#0000ff' };
  function maskPaint(fn) {
    [MASK.hub, MASK.global].forEach(function (m) { if (m) fn(m); });
  }
  var Paint = {
    path: function (pts, width, ch) {
      maskPaint(function (m) {
        var ctx = m.ctx;
        ctx.strokeStyle = CH[ch || 'r']; ctx.lineWidth = width * m.k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(function (p, i) {
          var x = (p[0] - m.min) * m.k, y = (p[1] - m.min) * m.k;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.stroke();
      });
    },
    disc: function (x, z, r, ch) {
      maskPaint(function (m) {
        m.ctx.fillStyle = CH[ch || 'r'];
        m.ctx.beginPath(); m.ctx.arc((x - m.min) * m.k, (z - m.min) * m.k, r * m.k, 0, Math.PI * 2); m.ctx.fill();
      });
    },
    ellipse: function (x, z, rx, rz, ch) {
      maskPaint(function (m) {
        m.ctx.fillStyle = CH[ch || 'r'];
        m.ctx.beginPath(); m.ctx.ellipse((x - m.min) * m.k, (z - m.min) * m.k, rx * m.k, rz * m.k, 0, 0, Math.PI * 2); m.ctx.fill();
      });
    },
    rect: function (x, z, w, d, ch, ry) {
      maskPaint(function (m) {
        var ctx = m.ctx;
        ctx.save();
        ctx.translate((x - m.min) * m.k, (z - m.min) * m.k);
        if (ry) ctx.rotate(-ry);
        ctx.fillStyle = CH[ch || 'r'];
        ctx.fillRect(-w / 2 * m.k, -d / 2 * m.k, w * m.k, d * m.k);
        ctx.restore();
      });
    }
  };
  function blurMask(m, radius) {
    var ctx = m.ctx, n = m.res;
    ctx.globalCompositeOperation = 'source-over';
    var img = ctx.getImageData(0, 0, n, n), d = img.data, tmp = new Float32Array(n * n * 3);
    var pass = function (src, dst, dx, dy) {
      for (var y = 0; y < n; y++) {
        for (var x = 0; x < n; x++) {
          var r = 0, g = 0, b = 0, c = 0;
          for (var k = -radius; k <= radius; k++) {
            var xx = x + k * dx, yy = y + k * dy;
            if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
            var i = (yy * n + xx);
            r += src(i, 0); g += src(i, 1); b += src(i, 2); c++;
          }
          dst(y * n + x, r / c, g / c, b / c);
        }
      }
    };
    pass(function (i, ch) { return d[i * 4 + ch]; }, function (i, r, g, b) { tmp[i * 3] = r; tmp[i * 3 + 1] = g; tmp[i * 3 + 2] = b; }, 1, 0);
    pass(function (i, ch) { return tmp[i * 3 + ch]; }, function (i, r, g, b) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }, 0, 1);
    ctx.putImageData(img, 0, 0);
  }
  function maskTexture(m) {
    blurMask(m, 1);
    var t = new T.CanvasTexture(m.c);
    t.flipY = false;
    t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    t.minFilter = T.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }

  /* ---------------- GLSL helpers ---------------- */
  var GLSL_NOISE =
    'float seHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n' +
    'float seNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);\n' +
    '  return mix(mix(seHash(i), seHash(i + vec2(1.0, 0.0)), f.x), mix(seHash(i + vec2(0.0, 1.0)), seHash(i + vec2(1.0, 1.0)), f.x), f.y); }\n';

  /* ---------------- ground material ---------------- */
  /* cfg: { hub: true } or { top, path, shore, scales: [top, path, shore], center: [x, z], lava } */
  function groundMaterial(cfg) {
    var m = new T.MeshLambertMaterial({ color: 0xffffff });
    var u = {
      uTime: SE.Batch.TIME,
      tGrass: { value: tex('grass') }, tDirt: { value: tex('dirt') }, tSand: { value: tex('sand') },
      tMask: { value: MASK.globalTex },
      uMaskMin: { value: new T.Vector2(MAP_MIN, MAP_MIN) }, uMaskSize: { value: MAP_SIZE }
    };
    var decl = 'varying vec3 vWPos;\nuniform float uTime;\nuniform sampler2D tGrass, tDirt, tSand, tMask;\nuniform vec2 uMaskMin;\nuniform float uMaskSize;\n';
    var body =
      'vec3 seGlow = vec3(0.0);\n' +
      'vec2 wp = vWPos.xz;\n' +
      'float n1 = seNoise(wp * 0.035);\n' +
      'float n2 = seNoise(wp * 0.23 + 7.1);\n' +
      'vec3 grass = mix(texture2D(tGrass, wp * 0.075).rgb, texture2D(tGrass, wp * 0.027 + 0.31).rgb, 0.35);\n' +
      'grass *= mix(vec3(0.9, 0.95, 0.84), vec3(1.07, 1.05, 0.96), n1);\n';
    if (cfg.hub) {
      u.tStone = { value: tex('stone') };
      u.tStraw = { value: tex('straw') };
      u.tMaskHub = { value: MASK.hubTex };
      u.uHubMin = { value: new T.Vector2(HUB_MIN, HUB_MIN) };
      u.uHubSize = { value: HUB_SIZE };
      decl += 'uniform sampler2D tStone, tStraw, tMaskHub;\nuniform vec2 uHubMin;\nuniform float uHubSize;\n';
      body +=
        'vec3 mh = texture2D(tMaskHub, (wp - uHubMin) / uHubSize).rgb;\n' +
        'vec3 mg = texture2D(tMask, (wp - uMaskMin) / uMaskSize).rgb;\n' +
        'vec3 mk = mix(mh, mg, smoothstep(96.0, 106.0, length(wp)));\n' +
        'vec3 col = grass;\n' +
        'float pk = smoothstep(0.36, 0.64, mk.r + (n2 - 0.5) * 0.36);\n' +
        'col = mix(col, texture2D(tDirt, wp * 0.11).rgb, pk);\n' +
        'float bk = smoothstep(0.4, 0.6, mk.b + (n2 - 0.5) * 0.2);\n' +
        'col = mix(col, texture2D(tStraw, wp * 0.12).rgb, bk);\n' +
        'float sk = smoothstep(0.45, 0.55, mk.g);\n' +
        'col = mix(col, texture2D(tStone, wp * 0.13).rgb, sk);\n' +
        'col *= 1.0 - (1.0 - smoothstep(0.0, 0.18, abs(mk.g - 0.5))) * 0.0;\n' +
        'vec3 shore = texture2D(tSand, wp * 0.09).rgb;\n';
    } else {
      u.tTop = { value: tex(cfg.top) }; u.tPath = { value: tex(cfg.path) }; u.tShore = { value: tex(cfg.shore) };
      u.uScales = { value: new T.Vector3(cfg.scales[0], cfg.scales[1], cfg.scales[2]) };
      u.uCenter = { value: new T.Vector2(cfg.center[0], cfg.center[1]) };
      u.uR = { value: new T.Vector2(cfg.r1 || 62, cfg.r2 || 112) };
      decl += 'uniform sampler2D tTop, tPath, tShore;\nuniform vec3 uScales;\nuniform vec2 uCenter, uR;\n';
      body +=
        'float w = 1.0 - smoothstep(uR.x, uR.y, distance(wp, uCenter));\n' +
        'vec3 topRaw = texture2D(tTop, wp * uScales.x).rgb;\n' +
        'vec3 top = mix(topRaw, texture2D(tTop, wp * uScales.x * 0.37 + 0.53).rgb, 0.3) * (0.92 + 0.14 * n1);\n' +
        'vec3 col = mix(grass, top, w);\n' +
        'vec3 mk = texture2D(tMask, (wp - uMaskMin) / uMaskSize).rgb;\n' +
        'float pk = smoothstep(0.36, 0.64, mk.r + (n2 - 0.5) * 0.36);\n' +
        'col = mix(col, mix(texture2D(tDirt, wp * 0.11).rgb, texture2D(tPath, wp * uScales.y).rgb, w), pk);\n' +
        'vec3 shore = mix(texture2D(tSand, wp * 0.09).rgb, texture2D(tShore, wp * uScales.z).rgb, w);\n';
      if (cfg.lava) {
        body +=
          'float lava = clamp((topRaw.r - topRaw.g * 0.85 - 0.28) * 3.5, 0.0, 1.0) * w * (1.0 - pk);\n' +
          'float lavaM = smoothstep(0.32, 0.72, seNoise(wp * 0.03 + 3.7));\n' +
          'col = mix(col, mix(grass, vec3(0.26, 0.23, 0.23) * (0.92 + 0.16 * n1), w), lava * (1.0 - lavaM) * 0.85);\n' +
          'seGlow = vec3(1.0, 0.3, 0.04) * lava * lavaM * (0.8 + 0.35 * sin(uTime * 2.1 + n2 * 9.0));\n';
      }
    }
    body +=
      'float beach = 1.0 - smoothstep(-0.7, -0.08, vWPos.y + (n2 - 0.5) * 0.14);\n' +
      'col = mix(col, shore, beach);\n' +
      'seGlow *= 1.0 - beach;\n' +
      'col *= 1.0 - (1.0 - smoothstep(-1.45, -1.0, vWPos.y)) * 0.3;\n' +
      'col = pow(max(col, vec3(0.0)), vec3(2.2));\n' +
      'diffuseColor.rgb *= col;\n';
    m.onBeforeCompile = function (sh) {
      for (var k in u) sh.uniforms[k] = u[k];
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + decl + GLSL_NOISE)
        .replace('#include <map_fragment>', body)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += seGlow;');
    };
    var key = 'se-ground-' + (cfg.hub ? 'hub' : 'biome') + (cfg.lava ? '-lava' : '');
    m.customProgramCacheKey = function () { return key; };
    m.userData.u = u;
    return m;
  }

  /* ---------------- ground mesh ---------------- */
  /* owner(x, z) -> region key; mats[key] -> material. One mesh per region. */
  function buildGround(owner, mats) {
    var N = Math.round(MAP_SIZE / GRID) + 3, min = MAP_MIN - GRID;
    var H = new Float32Array(N * N);
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) H[j * N + i] = height(min + i * GRID, min + j * GRID);
    }
    var regions = {};
    function reg(key) {
      if (!regions[key]) regions[key] = { map: new Int32Array(N * N).fill(-1), pos: [], nor: [], idx: [] };
      return regions[key];
    }
    function vert(r, i, j) {
      var id = j * N + i;
      if (r.map[id] >= 0) return r.map[id];
      var v = r.pos.length / 3;
      r.map[id] = v;
      r.pos.push(min + i * GRID, H[id], min + j * GRID);
      var hl = H[j * N + Math.max(0, i - 1)], hr = H[j * N + Math.min(N - 1, i + 1)];
      var hu = H[Math.max(0, j - 1) * N + i], hd = H[Math.min(N - 1, j + 1) * N + i];
      var nx = -(hr - hl) / (2 * GRID), nz = -(hd - hu) / (2 * GRID), l = Math.sqrt(nx * nx + 1 + nz * nz);
      r.nor.push(nx / l, 1 / l, nz / l);
      return v;
    }
    function tri(a, b, c) {
      var ha = H[a[1] * N + a[0]], hb = H[b[1] * N + b[0]], hc = H[c[1] * N + c[0]];
      if (Math.max(ha, hb, hc) < WATER_Y - 1.0) return;
      var cx = min + (a[0] + b[0] + c[0]) / 3 * GRID, cz = min + (a[1] + b[1] + c[1]) / 3 * GRID;
      var r = reg(owner(cx, cz));
      r.idx.push(vert(r, a[0], a[1]), vert(r, b[0], b[1]), vert(r, c[0], c[1]));
    }
    for (var jj = 0; jj < N - 1; jj++) {
      for (var ii = 0; ii < N - 1; ii++) {
        var p00 = [ii, jj], p10 = [ii + 1, jj], p01 = [ii, jj + 1], p11 = [ii + 1, jj + 1];
        if ((ii + jj) % 2) { tri(p00, p01, p10); tri(p10, p01, p11); }
        else { tri(p00, p01, p11); tri(p00, p11, p10); }
      }
    }
    var meshes = [];
    Object.keys(regions).forEach(function (k) {
      var r = regions[k];
      if (!r.idx.length || !mats[k]) return;
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(r.pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(r.nor, 3));
      g.setIndex(r.idx);
      g.computeBoundingSphere();
      var mesh = new T.Mesh(g, mats[k]);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'ground:' + k;
      meshes.push(mesh);
    });
    return meshes;
  }

  /* ---------------- sea ---------------- */
  var SDF_RES = 512, SDF_LO = -16, SDF_RANGE = 72;
  function sdfTexture() {
    var n = SDF_RES, data = new Uint8Array(n * n * 4);
    for (var j = 0; j < n; j++) {
      var z = MAP_MIN + (j + 0.5) / n * MAP_SIZE;
      for (var i = 0; i < n; i++) {
        var x = MAP_MIN + (i + 0.5) / n * MAP_SIZE;
        var d = rawSdf(x, z);
        if (d < 46) d = sdf(x, z);
        var v = Math.max(0, Math.min(255, Math.round((d - SDF_LO) / SDF_RANGE * 255)));
        var k = (j * n + i) * 4;
        data[k] = v; data[k + 1] = v; data[k + 2] = v; data[k + 3] = 255;
      }
    }
    var t = new T.DataTexture(data, n, n, T.RGBAFormat);
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearFilter;
    t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }
  function seaMaterial(sdfTex, sunDir) {
    var uniforms = T.UniformsUtils.merge([T.UniformsLib.fog, {
      tSdf: { value: null }, uTime: { value: 0 },
      uSdfMin: { value: new T.Vector2(MAP_MIN, MAP_MIN) }, uSdfSize: { value: MAP_SIZE },
      uDeep: { value: new T.Color('#1d7fc4') }, uShallow: { value: new T.Color('#2fb6d8') },
      uLagoon: { value: new T.Color('#6ee6df') }, uFoam: { value: new T.Color('#ffffff') },
      uSky: { value: new T.Color('#bfe9f6') }, uSunDir: { value: sunDir.clone() }
    }]);
    uniforms.tSdf.value = sdfTex;
    uniforms.uTime = SE.Batch.TIME;
    return new T.ShaderMaterial({
      uniforms: uniforms,
      fog: true,
      vertexShader: [
        'varying vec3 vWPos;',
        '#include <fog_pars_vertex>',
        'void main() {',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWPos = wp.xyz;',
        '  vec4 mvPosition = viewMatrix * wp;',
        '  gl_Position = projectionMatrix * mvPosition;',
        '  #include <fog_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tSdf; uniform vec2 uSdfMin; uniform float uSdfSize; uniform float uTime;',
        'uniform vec3 uDeep, uShallow, uLagoon, uFoam, uSky, uSunDir;',
        'varying vec3 vWPos;',
        '#include <common>',
        '#include <fog_pars_fragment>',
        GLSL_NOISE,
        'void main() {',
        '  vec2 p = vWPos.xz;',
        '  vec2 uv = (p - uSdfMin) / uSdfSize;',
        '  float d = 56.0;',
        '  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) d = texture2D(tSdf, uv).r * ' + SDF_RANGE.toFixed(1) + ' + (' + SDF_LO.toFixed(1) + ');',
        '  float t = uTime;',
        '  vec2 q1 = p * 0.045 + vec2(t * 0.06, t * 0.035);',
        '  float h = seNoise(q1) + seNoise(p * 0.12 + vec2(-t * 0.05, t * 0.08)) * 0.5;',
        '  vec2 k1 = vec2(0.11, 0.07), k2 = vec2(-0.08, 0.12), k3 = vec2(0.19, -0.15), k4 = vec2(-0.23, -0.09);',
        '  vec2 g = k1 * cos(dot(p, k1) + t * 0.9) * 0.9 + k2 * cos(dot(p, k2) + t * 1.1) * 0.8',
        '         + k3 * cos(dot(p, k3) + t * 1.6) * 0.45 + k4 * cos(dot(p, k4) + t * 1.35) * 0.35;',
        '  vec3 N = normalize(vec3(-g.x * 0.9, 1.0, -g.y * 0.9));',
        '  vec3 col = mix(uLagoon, uShallow, smoothstep(0.0, 10.0, d));',
        '  col = mix(col, uDeep, smoothstep(6.0, 42.0, d));',
        '  col *= 0.93 + h * 0.1;',
        '  float edge = 1.0 - smoothstep(0.0, 2.2, d + (h - 0.75) * 1.6);',
        '  float rings = smoothstep(0.86, 1.0, sin(d * 1.1 - t * 1.6 + h * 2.4)) * (1.0 - smoothstep(1.5, 8.0, d));',
        '  float foam = clamp(edge + rings * 0.7, 0.0, 1.0);',
        '  vec3 V = normalize(cameraPosition - vWPos);',
        '  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);',
        '  col = mix(col, uSky, fres * 0.5);',
        '  vec3 H = normalize(V + uSunDir);',
        '  col += vec3(1.0, 0.95, 0.82) * pow(max(dot(N, H), 0.0), 220.0) * 0.55;',
        '  col = mix(col, uFoam, foam * 0.9);',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <encodings_fragment>',
        '  #include <fog_fragment>',
        '}'
      ].join('\n')
    });
  }

  /* ---------------- sky ---------------- */
  function rgb01(hex) { var c = hexRGB(hex); return new T.Vector3(c[0] / 255, c[1] / 255, c[2] / 255); }
  function skyMaterial(fogHex, sunDir) {
    var cloud = tex('cloud');
    return new T.ShaderMaterial({
      uniforms: {
        uTop: { value: rgb01('#3f9cf0') }, uMid: { value: rgb01('#7cc4f6') }, uHorizon: { value: rgb01(fogHex) },
        uSun: { value: rgb01('#fff3d6') }, uSunDir: { value: sunDir.clone() }, uTime: SE.Batch.TIME, tCloud: { value: cloud }
      },
      depthWrite: false,
      side: T.BackSide,
      fog: false,
      vertexShader: [
        'varying vec3 vDir;',
        'void main() {',
        '  vDir = position;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position.z = gl_Position.w * 0.99999;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uTop, uMid, uHorizon, uSun, uSunDir; uniform float uTime; uniform sampler2D tCloud;',
        'varying vec3 vDir;',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  float h = d.y;',
        '  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));',
        '  col = mix(col, uTop, smoothstep(0.18, 0.8, h));',
        '  float s = max(dot(d, uSunDir), 0.0);',
        '  col += uSun * (pow(s, 700.0) * 1.4 + pow(s, 28.0) * 0.16 + pow(s, 5.0) * 0.06);',
        '  if (h > 0.0) {',
        '    vec2 cp = d.xz / (h + 0.09) * 0.11 + vec2(uTime * 0.0032, uTime * 0.0011);',
        '    float c = texture2D(tCloud, cp).r * 0.62 + texture2D(tCloud, cp * 2.3 + 0.37).r * 0.38;',
        '    c = smoothstep(0.5, 0.74, c) * smoothstep(0.015, 0.22, h);',
        '    vec3 cc = mix(vec3(1.0), uHorizon, 0.12 + 0.2 * (1.0 - smoothstep(0.55, 0.85, c)));',
        '    col = mix(col, cc, c * 0.88);',
        '  }',
        '  col = mix(col, uHorizon, 1.0 - smoothstep(-0.015, 0.05, h));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
  }

  /* ---------------- liquid pools ---------------- */
  /* kind: 0 water, 1 lava, 2 ice, 3 syrup. Colours are display-space hex. */
  function liquidMaterial(kind, a, b, c) {
    var uniforms = T.UniformsUtils.merge([T.UniformsLib.fog, {
      uKind: { value: kind }, uA: { value: rgb01(a) }, uB: { value: rgb01(b) }, uC: { value: rgb01(c || '#ffffff') }, uTime: { value: 0 }
    }]);
    uniforms.uTime = SE.Batch.TIME;
    return new T.ShaderMaterial({
      uniforms: uniforms,
      fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      vertexShader: [
        'attribute float edge; varying float vEdge; varying vec3 vWPos;',
        '#include <fog_pars_vertex>',
        'void main() {',
        '  vEdge = edge;',
        '  vec4 wp = modelMatrix * vec4(position, 1.0); vWPos = wp.xyz;',
        '  vec4 mvPosition = viewMatrix * wp;',
        '  gl_Position = projectionMatrix * mvPosition;',
        '  #include <fog_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uKind, uTime; uniform vec3 uA, uB, uC;',
        'varying float vEdge; varying vec3 vWPos;',
        '#include <common>',
        '#include <fog_pars_fragment>',
        GLSL_NOISE,
        'void main() {',
        '  vec2 p = vWPos.xz; float t = uTime; vec3 col;',
        '  if (uKind < 0.5) {',
        '    float n = seNoise(p * 0.35 + vec2(t * 0.25, t * 0.18)) + seNoise(p * 0.8 - vec2(t * 0.2, -t * 0.3)) * 0.5;',
        '    col = mix(uA, uB, smoothstep(0.15, 0.95, vEdge));',
        '    col += vec3(0.85) * smoothstep(1.05, 1.32, n) * 0.35;',
        '    col = mix(col, uC, smoothstep(0.84, 0.97, vEdge + (n - 0.75) * 0.08));',
        '  } else if (uKind < 1.5) {',
        '    float n = seNoise(p * 0.22 + vec2(t * 0.05, -t * 0.04)) * 0.65 + seNoise(p * 0.6 - vec2(t * 0.08, t * 0.05)) * 0.35;',
        '    col = mix(uA, uB, smoothstep(0.25, 0.55, n));',
        '    col = mix(col, uC, smoothstep(0.52, 0.68, n) * 0.9);',
        '    col *= 0.92 + 0.16 * sin(t * 2.0 + n * 8.0);',
        '    col = mix(col, uC, smoothstep(0.82, 0.98, vEdge));',
        '  } else if (uKind < 2.5) {',
        '    float n = seNoise(p * 0.18);',
        '    float cr = seNoise(p * 0.7 + 3.0);',
        '    col = mix(uA, uB, n);',
        '    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.04, abs(cr - 0.5))) * 0.6);',
        '    col = mix(col, uC, smoothstep(0.8, 0.96, vEdge));',
        '  } else {',
        '    vec2 q = p * 0.22;',
        '    float n = seNoise(q + vec2(seNoise(q * 1.7 + t * 0.08) * 2.2, t * 0.05));',
        '    col = mix(uA, uB, smoothstep(0.35, 0.68, n));',
        '    col += vec3(1.0) * smoothstep(0.82, 0.96, seNoise(p * 0.6 + t * 0.15)) * 0.22;',
        '    col = mix(col, uC, smoothstep(0.84, 0.97, vEdge));',
        '  }',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <fog_fragment>',
        '}'
      ].join('\n')
    });
  }
  /* Organic outline radius for a pool. */
  function poolRadius(R, seed, a) {
    return R * (1 + 0.13 * Math.sin(3 * a + seed) + 0.07 * Math.sin(5 * a + seed * 2.3));
  }
  /* pools: [{x, z, r, seed}] -> one mesh */
  function poolGeometry(pools, y) {
    var pos = [], edge = [], idx = [], SEG = 28, RINGS = 4;
    pools.forEach(function (pl) {
      var base = pos.length / 3;
      pos.push(pl.x, y, pl.z); edge.push(0);
      for (var r = 1; r <= RINGS; r++) {
        for (var s = 0; s < SEG; s++) {
          var a = s / SEG * Math.PI * 2, k = r / RINGS, R = poolRadius(pl.r, pl.seed, a) * k;
          pos.push(pl.x + Math.cos(a) * R, y, pl.z + Math.sin(a) * R); edge.push(k);
        }
      }
      for (var s2 = 0; s2 < SEG; s2++) {
        var n2 = (s2 + 1) % SEG;
        idx.push(base, base + 1 + n2, base + 1 + s2);
        for (var r2 = 1; r2 < RINGS; r2++) {
          var i0 = base + 1 + (r2 - 1) * SEG, i1 = base + 1 + r2 * SEG;
          idx.push(i0 + s2, i0 + n2, i1 + s2);
          idx.push(i0 + n2, i1 + n2, i1 + s2);
        }
      }
    });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('edge', new T.Float32BufferAttribute(edge, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  /* ---------------- distant scenery and clouds ---------------- */
  function buildFar() {
    var K = new SE.Batch.Kit(), rnd = SE.U.seeded(4242);
    var spots = [
      [0.15, 470, 60, 'm'], [0.62, 440, 38, 'i'], [1.05, 520, 75, 'v'], [1.55, 455, 34, 'i'], [2.05, 500, 64, 'm'],
      [2.6, 445, 40, 'r'], [3.05, 530, 80, 'm'], [3.6, 460, 36, 'i'], [4.05, 505, 70, 'm'], [4.55, 450, 42, 'r'],
      [5.05, 520, 66, 'v'], [5.6, 470, 40, 'i'], [5.95, 540, 58, 'm']
    ];
    spots.forEach(function (s, idx) {
      var a = s[0], r = s[1], R = s[2], x = Math.cos(a) * r, z = Math.sin(a) * r;
      K.push(x, 0, z, rnd() * 6);
      K.cyl(R * 1.08, 3, '#e8d49a', 0, -1.2, 0, { rt: R * 0.98, seg: 18 });
      K.cyl(R * 0.95, 4, '#5fb24a', 0, 1.2, 0, { rt: R * 0.8, seg: 18 });
      if (s[3] === 'm') {
        K.cone(R * 0.75, R * 1.5, '#4f8f5a', R * 0.1, R * 0.75 + 2, 0, { seg: 9 });
        K.cone(R * 0.5, R * 1.05, '#5f9a68', -R * 0.38, R * 0.52 + 2, R * 0.2, { seg: 8 });
        K.cone(R * 0.28, R * 0.42, '#f4f8ff', R * 0.1, R * 1.29 + 2, 0, { seg: 9 });
      } else if (s[3] === 'v') {
        K.cone(R * 0.8, R * 1.1, '#6a5a52', 0, R * 0.55 + 2, 0, { rt: R * 0.18, seg: 10 });
        K.cyl(R * 0.17, 0.6, '#ff8a3a', 0, R * 1.1 + 2.1, 0, { seg: 10, glow: true });
      } else if (s[3] === 'r') {
        for (var k = 0; k < 4; k++) K.cone(R * (0.25 + rnd() * 0.15), R * (0.8 + rnd() * 0.8), '#8a8f86', (rnd() - 0.5) * R, R * 0.6, (rnd() - 0.5) * R, { seg: 6 });
      } else {
        for (var t = 0; t < 7; t++) {
          var ta = rnd() * 6.28, td = rnd() * R * 0.6;
          K.sph(R * 0.16, t % 2 ? '#3f9a40' : '#57b84a', Math.cos(ta) * td, 3 + R * 0.12, Math.sin(ta) * td, { seg: 7 });
        }
      }
      K.pop();
    });
    var g = K.build(0);
    var mesh = new T.Mesh(g, SE.Batch.material('static'));
    mesh.matrixAutoUpdate = false;
    mesh.name = 'far-scenery';
    return mesh;
  }
  function buildClouds(count) {
    var K = new SE.Batch.Kit(), rnd = SE.U.seeded(777);
    for (var i = 0; i < count; i++) {
      var a = rnd() * Math.PI * 2, r = 140 + rnd() * 380, y = 62 + rnd() * 60, s = 2.5 + rnd() * 3.5;
      K.push(Math.cos(a) * r, y, Math.sin(a) * r, rnd() * 6);
      var n = 4 + Math.floor(rnd() * 4);
      for (var k = 0; k < n; k++) {
        var px = (k - n / 2) * s * 1.5 + (rnd() - 0.5) * s, pz = (rnd() - 0.5) * s * 2;
        var rr = s * (1.4 + rnd() * 1.0);
        K.sph(rr, '#ffffff', px, rnd() * s * 0.6, pz, { sy: 0.62, seg: 9 });
        K.sph(rr * 0.92, '#dfe7f5', px, -rr * 0.18, pz, { sy: 0.4, seg: 8 });
      }
      K.pop();
    }
    var g = K.build(0);
    var m = new T.MeshLambertMaterial({ vertexColors: true, emissive: new T.Color('#9aa8bc') });
    var mesh = new T.Mesh(g, m);
    mesh.name = 'clouds';
    return mesh;
  }

  /* ---------------- public API ---------------- */
  var Terrain = {
    WATER_Y: WATER_Y,
    LAND: LAND,
    sdf: sdf,
    rawSdf: rawSdf,
    height: height,
    noise: vnoise,
    fbm: fbm,
    tex: tex,
    Paint: Paint,
    poolRadius: poolRadius,
    sea: null, sky: null, clouds: null, far: null,

    /* islands: [{x, z, r}], causeways: [{ax, az, bx, bz, w}] */
    setLand: function (hubR, islands, causeways) {
      LAND.hub.r = hubR;
      LAND.islands = islands.slice();
      LAND.causeways = causeways.map(function (c) {
        var dx = c.bx - c.ax, dz = c.bz - c.az;
        return { ax: c.ax, az: c.az, dx: dx, dz: dz, len2: dx * dx + dz * dz, w: c.w };
      });
      MASK.hub = newMask(512, HUB_MIN, HUB_SIZE);
      MASK.global = newMask(512, MAP_MIN, MAP_SIZE);
    },
    finishMasks: function () {
      MASK.hubTex = maskTexture(MASK.hub);
      MASK.globalTex = maskTexture(MASK.global);
    },
    groundMaterial: groundMaterial,
    buildGround: buildGround,

    buildEnvironment: function (scene, fogHex, sunDir) {
      var seaTex = sdfTexture();
      var sea = new T.Mesh(new T.CircleGeometry(880, 48), seaMaterial(seaTex, sunDir));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = WATER_Y;
      sea.frustumCulled = false;
      sea.name = 'sea';
      scene.add(sea);
      this.sea = sea;

      var sky = new T.Mesh(new T.SphereGeometry(840, 32, 16), skyMaterial(fogHex, sunDir));
      sky.renderOrder = -10;
      sky.frustumCulled = false;
      sky.name = 'sky';
      scene.add(sky);
      this.sky = sky;

      this.far = buildFar();
      scene.add(this.far);
      this.clouds = buildClouds(18);
      scene.add(this.clouds);
    },

    liquidMaterial: liquidMaterial,
    poolGeometry: poolGeometry,

    setQuality: function (q) {
      if (this.far) this.far.visible = q !== 'low';
      var a = q === 'low' ? 2 : 4;
      Object.keys(TEX).forEach(function (k) { TEX[k].anisotropy = a; TEX[k].needsUpdate = true; });
    },

    update: function (dt, time, camera) {
      if (camera) {
        if (this.sea) { this.sea.position.x = camera.position.x; this.sea.position.z = camera.position.z; }
        if (this.sky) this.sky.position.copy(camera.position);
      }
      if (this.clouds) this.clouds.rotation.y += dt * 0.0035;
    }
  };

  SE.Terrain = Terrain;
})(window);
