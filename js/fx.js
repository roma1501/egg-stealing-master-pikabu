/* =========================================================================
   Effects (SE.FX) — owned by the FX agent.

   One pooled GPU particle system, two draw calls (normal + additive blending),
   instanced camera-facing quads with a runtime sprite atlas, plus one ribbon mesh
   for the speed trails.  Everything is driven from SE.FX.update(), which the game
   only calls on unpaused frames, so pausing the game freezes the effects too.

   Public API (see docs/AGENTS-CONTRACT.md section 5):
     init(scene, camera)  update(dt, time, playerPos)  burst(name, pos, opts)
     trail(trailId, color, pos, moving, dt)  setAura(auraId|null, target)
     victory(victoryId, pos)  ambient(biomeId, center, radius)  setQuality(q)
     clear()  drawIcon(kind, id, canvas)  AURAS  VICTORIES
   Extras: text(str, pos, opts), clearAmbient(), stats(), BURSTS (list of names).

   Conventions
     - pos is a THREE.Vector3 or {x,y,z}.  For 'steal'/'hatch'/'coin'/'pop'/... it is
       the point of the event; for 'caught'/'land'/'jump'/'step'/'deliver'/'equip' it
       is the actor's feet (ground point); recipes add their own heights.
     - Colours are numbers (0xRRGGBB), '#rrggbb' strings or THREE.Color.
     - No per-frame allocation in update(): typed-array pools and scratch variables.
   ========================================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var T = global.THREE;
  if (!T) return;                       /* THREE missing: keep the no-op stub */
  var stub = SE.FX;                     /* stub from the placeholder file, if any */

  var TAU = Math.PI * 2, PI = Math.PI;

  /* ------------------------------------------------------------------ math */
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ss(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function sgn() { return Math.random() < 0.5 ? -1 : 1; }
  function seeded(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ---------------------------------------------------------------- colour */
  function toInt(c) {
    if (typeof c === 'number') return c;
    if (typeof c === 'string') {
      var s = c.charAt(0) === '#' ? c.slice(1) : c;
      if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
      var n = parseInt(s, 16);
      return isNaN(n) ? 0xffffff : n;
    }
    if (c && c.isColor) return c.getHex();
    return 0xffffff;
  }
  function hsv(h, s, v) {
    h = h - Math.floor(h);
    var i = (h * 6) | 0, f = h * 6 - i;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s), r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }
    return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
  }
  function mixc(a, b, t) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  function lite(c, k) { return mixc(c, 0xffffff, k); }
  function dark(c, k) { return mixc(c, 0x000000, k); }
  function css(c) { c = toInt(c); return '#' + ('000000' + c.toString(16)).slice(-6); }

  /* ---------------------------------------------------------- sprite atlas */
  var COLS = 8, ROWS = 8;
  var SPRITE_NAMES = ['dot', 'glow', 'disc', 'star', 'sparkle', 'smoke', 'ring', 'ringThick', 'confetti', 'heart',
    'leaf', 'flake', 'ember', 'coin', 'feather', 'note', 'note2', 'drop', 'cloud', 'bubble', 'streak', 'beam',
    'petal', 'rune', 'balloon', 'egg', 'candy', 'sprinkle', 'shard', 'chip', 'bang', 'burst', 'wisp', 'flame',
    'bolt', 'seg', 'puff', 'rays', 'ghost'];
  var F = {};
  (function () { for (var i = 0; i < SPRITE_NAMES.length; i++) F[SPRITE_NAMES[i]] = i; })();

  var PXG = 1;                           /* grey level written by pixel painters */

  /* pixel painters: fn(x, y) with x,y in [-1,1] (y up) -> alpha; may set PXG */
  var PIXEL = {
    dot: function (x, y) { var r = Math.sqrt(x * x + y * y); return 1 - ss(0.28, 1.0, r); },
    glow: function (x, y) { var r2 = x * x + y * y; return Math.exp(-r2 * 5.2) * (1 - ss(0.78, 1.0, Math.sqrt(r2))); },
    disc: function (x, y) {
      var r = Math.sqrt(x * x + y * y);
      PXG = 1 - 0.16 * r * r - 0.1 * (y < 0 ? -y : 0);
      return 1 - ss(0.9, 0.985, r);
    },
    ember: function (x, y) {
      var r2 = x * x + y * y;
      return Math.max(Math.exp(-r2 * 46), Math.exp(-r2 * 7) * 0.5) * (1 - ss(0.8, 1.0, Math.sqrt(r2)));
    },
    ring: function (x, y) {
      var r = Math.sqrt(x * x + y * y), d = Math.abs(r - 0.84);
      var a = 1 - ss(0.0, 0.085, d);
      a += 0.28 * Math.exp(-(d * d) / 0.02);
      return a * (1 - ss(0.95, 1.0, r));
    },
    ringThick: function (x, y) {
      var r = Math.sqrt(x * x + y * y);
      var a = Math.pow(ss(0.3, 0.88, r), 1.6) * (1 - ss(0.9, 0.985, r));
      return a;
    },
    /* streak: head at the top (+y), tail fades toward the bottom. In stretched mode the
       sprite's +y axis follows the velocity. */
    streak: function (x, y) {
      var t = (y + 1) * 0.5;
      var hw = 0.05 + 0.3 * Math.pow(t, 0.7);
      if (t > 0.86) hw *= Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.86) / 0.14, 2)));
      var ax = Math.abs(x);
      var a = (1 - ss(hw * 0.2, hw, ax)) * (0.12 + 0.88 * Math.pow(t, 1.3));
      a += 0.6 * Math.exp(-(x * x) / 0.012) * Math.pow(t, 2);
      return a;
    },
    /* beam: light pillar; bright at the bottom, thinning to the top. */
    beam: function (x, y) {
      var h = Math.exp(-x * x * 7.5) + 0.55 * Math.exp(-x * x * 55);
      var v = ss(-1, -0.9, y) * Math.pow(1 - ss(-0.55, 1, y), 0.85);
      return h * v;
    },
    /* seg: soft line segment (axis = y). Used for lightning / rays. */
    seg: function (x, y) {
      var ay = Math.abs(y);
      var h = Math.exp(-x * x * 9) + 0.9 * Math.exp(-x * x * 90);
      return Math.min(1, h) * (1 - ss(0.78, 1.0, ay));
    },
    /* puff: soft round blob, brighter core, no hard edge (for dust and clouds of light) */
    puff: function (x, y) {
      var r = Math.sqrt(x * x + y * y);
      return Math.pow(1 - ss(0.0, 1.0, r), 1.5);
    },
    bubble: function (x, y) {
      var r = Math.sqrt(x * x + y * y);
      var a = 0.1 + 0.85 * ss(0.62, 0.9, r) * (1 - ss(0.93, 0.99, r));
      var hx = (x + 0.4) / 0.17, hy = (y - 0.42) / 0.09;
      a += 0.95 * Math.exp(-(hx * hx + hy * hy));
      var sx = (x - 0.34) / 0.12, sy = (y + 0.42) / 0.06;
      a += 0.45 * Math.exp(-(sx * sx + sy * sy));
      return a * (1 - ss(0.96, 1.0, r));
    },
    /* burst: eight-ray star with a soft core */
    burst: function (x, y) {
      var r = Math.sqrt(x * x + y * y);
      var an = Math.atan2(y, x);
      var rays = Math.pow(Math.abs(Math.cos(2 * an)), 70) * 1.0 + Math.pow(Math.abs(Math.cos(4 * an + 0.0)), 90) * 0.55;
      var fall = Math.pow(1 - ss(0.0, 1.0, r), 1.5);
      var core = Math.exp(-r * r * 22);
      return Math.min(1, core + rays * fall * 1.1);
    },
    /* rays: a ring-less sunburst of 12 thin rays */
    rays: function (x, y) {
      var r = Math.sqrt(x * x + y * y);
      var an = Math.atan2(y, x);
      var k = Math.pow(Math.abs(Math.cos(6 * an)), 26);
      return Math.min(1, k * Math.pow(1 - ss(0.1, 1, r), 1.2) * ss(0.02, 0.2, r) + Math.exp(-r * r * 18) * 0.8);
    },
    /* flame: teardrop with a lick, soft edges; tip points up */
    flame: function (x, y) {
      var t = (y + 1) * 0.5;
      var hw = 0.62 * Math.pow(1 - t, 0.9) * ss(0.0, 0.2, t) + 0.0;
      var xo = 0.2 * Math.sin(t * 5.2) * t;
      var d = Math.abs(x - xo);
      var a = 1 - ss(hw * 0.25, Math.max(0.001, hw), d);
      a *= 0.55 + 0.45 * (1 - t);
      PXG = 0.66 + 0.34 * (1 - t);
      return a;
    },
    /* wisp: soft comma with a curved tail (tail to the lower right) */
    wisp: function (x, y) {
      var best = 9;
      var tp = 0;
      for (var k = 0; k <= 16; k++) {
        var s = k / 16;
        var cx = -0.28 + s * 0.9 + 0.35 * Math.sin(s * 3.1) * s;
        var cy = 0.42 - s * 1.05 - 0.2 * s * s;
        var dx = x - cx, dy = y - cy;
        var rad = lerp(0.34, 0.02, Math.pow(s, 0.8));
        var d = (Math.sqrt(dx * dx + dy * dy) - rad);
        if (d < best) { best = d; tp = s; }
      }
      return (1 - ss(-0.08, 0.1, best)) * (1 - 0.35 * tp);
    },
    /* ghost: pale blob with a wavy skirt and two soft eye holes */
    ghost: function (x, y) {
      var d;
      if (y > 0.05) d = Math.sqrt(x * x + (y - 0.05) * (y - 0.05)) - 0.6;
      else d = Math.abs(x) - 0.6;
      var skirt = -0.62 + 0.07 * Math.sin(x * 13);
      d = Math.max(d, skirt - y);
      var a = 1 - ss(-0.04, 0.05, d);
      var ex = (Math.abs(x) - 0.22) / 0.1, ey = (y - 0.12) / 0.15;
      PXG = 1 - 0.65 * Math.exp(-(ex * ex + ey * ey) * 1.4);
      return a;
    }
  };

  /* path painters: fn(g) in a 128x128 space, white on transparent */
  function polygon(g, pts) {
    g.beginPath();
    for (var i = 0; i < pts.length; i += 2) { if (i) g.lineTo(pts[i], pts[i + 1]); else g.moveTo(pts[i], pts[i + 1]); }
    g.closePath();
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
  }
  function vgrad(g, y0, y1, c0, c1) {
    var gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    return gr;
  }
  function grey(v) { var n = Math.round(clamp(v, 0, 1) * 255); return 'rgb(' + n + ',' + n + ',' + n + ')'; }

  var PATHS = {
    star: function (g) {
      function path() {
        g.beginPath();
        for (var k = 0; k < 10; k++) {
          var rr = (k % 2) ? 25 : 55, an = -PI / 2 + k * PI / 5;
          var px = 64 + Math.cos(an) * rr, py = 68 + Math.sin(an) * rr;
          if (k) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.closePath();
      }
      g.lineJoin = 'round';
      path(); g.lineWidth = 10; g.strokeStyle = '#b4b4b4'; g.stroke(); g.fillStyle = '#b4b4b4'; g.fill();
      path();
      var gr = g.createRadialGradient(54, 56, 3, 64, 68, 56);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#f2f2f2'); gr.addColorStop(1, '#d6d6d6');
      g.lineWidth = 2; g.strokeStyle = '#d6d6d6';
      g.save(); g.translate(64, 68); g.scale(0.88, 0.88); g.translate(-64, -68); path(); g.fillStyle = gr; g.fill(); g.restore();
    },
    sparkle: function (g) {
      var halo = g.createRadialGradient(64, 64, 0, 64, 64, 30);
      halo.addColorStop(0, 'rgba(255,255,255,0.55)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(64, 64, 30, 0, TAU); g.fill();
      function spike(len, w, fill) {
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(64, 64 - len);
        g.quadraticCurveTo(64 + w, 64 - w, 64 + len, 64);
        g.quadraticCurveTo(64 + w, 64 + w, 64, 64 + len);
        g.quadraticCurveTo(64 - w, 64 + w, 64 - len, 64);
        g.quadraticCurveTo(64 - w, 64 - w, 64, 64 - len);
        g.closePath(); g.fill();
      }
      spike(61, 9, '#b0b0b0');
      g.save(); g.translate(64, 64); g.rotate(PI / 4); g.translate(-64, -64); spike(31, 5.5, '#b0b0b0'); g.restore();
      spike(55, 6.2, '#e6e6e6');
      g.save(); g.translate(64, 64); g.rotate(PI / 4); g.translate(-64, -64); spike(26, 3.4, '#e6e6e6'); g.restore();
      var core = g.createRadialGradient(64, 64, 0, 64, 64, 19);
      core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.6, 'rgba(255,255,255,0.95)'); core.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = core; g.beginPath(); g.arc(64, 64, 19, 0, TAU); g.fill();
    },
    smoke: function (g) {
      var rng = seeded(1234);
      for (var k = 0; k < 22; k++) {
        var an = rng() * TAU, d = Math.pow(rng(), 0.7) * 34;
        var cx = 64 + Math.cos(an) * d, cy = 64 + Math.sin(an) * d * 0.9;
        var r = 17 + rng() * 17;
        var sh = clamp(238 - (cy - 64) * 1.7 - (cx - 64) * 0.5, 140, 255) | 0;
        var gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, 'rgba(' + sh + ',' + sh + ',' + sh + ',0.62)');
        gr.addColorStop(0.55, 'rgba(' + sh + ',' + sh + ',' + sh + ',0.34)');
        gr.addColorStop(1, 'rgba(' + sh + ',' + sh + ',' + sh + ',0)');
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      }
      g.globalCompositeOperation = 'destination-in';
      var m = g.createRadialGradient(64, 64, 0, 64, 64, 62);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.5, 'rgba(0,0,0,0.95)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = m; g.fillRect(0, 0, 128, 128);
      g.globalCompositeOperation = 'source-over';
    },
    confetti: function (g) {
      roundRect(g, 46, 14, 36, 100, 6);
      g.fillStyle = vgrad(g, 14, 114, '#ffffff', '#d4d4d4'); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(52, 20, 6, 88);
    },
    heart: function (g) {
      g.beginPath();
      g.moveTo(64, 114);
      g.bezierCurveTo(14, 78, 8, 32, 40, 22);
      g.bezierCurveTo(54, 18, 62, 26, 64, 38);
      g.bezierCurveTo(66, 26, 74, 18, 88, 22);
      g.bezierCurveTo(120, 32, 114, 78, 64, 114);
      g.closePath();
      g.fillStyle = vgrad(g, 20, 114, '#ffffff', '#d0d0d0'); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.save(); g.translate(40, 44); g.rotate(-0.65); g.beginPath(); g.ellipse(0, 0, 13, 6.5, 0, 0, TAU); g.fill(); g.restore();
    },
    leaf: function (g) {
      g.beginPath();
      g.moveTo(64, 4);
      g.bezierCurveTo(118, 34, 112, 92, 66, 118);
      g.bezierCurveTo(18, 92, 12, 34, 64, 4);
      g.closePath();
      g.fillStyle = vgrad(g, 4, 118, '#ffffff', '#c4c4c4'); g.fill();
      g.strokeStyle = 'rgba(130,130,130,1)'; g.lineCap = 'round'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(66, 124); g.lineTo(64, 22); g.stroke();
      g.lineWidth = 3; g.strokeStyle = 'rgba(160,160,160,1)';
      for (var k = 0; k < 3; k++) {
        var yy = 48 + k * 22;
        g.beginPath(); g.moveTo(64, yy + 8); g.lineTo(64 - 22 + k * 4, yy - 10); g.moveTo(64, yy + 8); g.lineTo(64 + 22 - k * 4, yy - 10); g.stroke();
      }
    },
    flake: function (g) {
      g.translate(64, 64); g.strokeStyle = '#fff'; g.lineCap = 'round';
      for (var i = 0; i < 6; i++) {
        g.save(); g.rotate(i * PI / 3);
        g.lineWidth = 7; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -56); g.stroke();
        g.lineWidth = 5;
        g.beginPath(); g.moveTo(0, -24); g.lineTo(-14, -38); g.moveTo(0, -24); g.lineTo(14, -38);
        g.moveTo(0, -40); g.lineTo(-10, -50); g.moveTo(0, -40); g.lineTo(10, -50); g.stroke();
        g.restore();
      }
      g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill();
    },
    coin: function (g) {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 58, 0, TAU); g.fill();
      var gr = g.createRadialGradient(46, 44, 4, 64, 64, 56);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#c8c8c8');
      g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 46, 0, TAU); g.fill();
      g.strokeStyle = '#8a8a8a'; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 46, 0, TAU); g.stroke();
      g.strokeStyle = '#d6d6d6'; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 53, 0, TAU); g.stroke();
      g.fillStyle = '#9d9d9d'; g.beginPath();
      for (var k = 0; k < 10; k++) {
        var rr = (k % 2) ? 10 : 24, an = -PI / 2 + k * PI / 5;
        var px = 64 + Math.cos(an) * rr, py = 66 + Math.sin(an) * rr;
        if (k) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.arc(64, 64, 38, PI * 1.05, PI * 1.45); g.stroke();
    },
    feather: function (g) {
      g.beginPath();
      g.moveTo(64, 4);
      g.bezierCurveTo(26, 26, 14, 70, 56, 120);
      g.lineTo(62, 118);
      g.bezierCurveTo(70, 100, 72, 80, 70, 60);
      g.bezierCurveTo(88, 78, 102, 56, 80, 24);
      g.bezierCurveTo(74, 14, 68, 8, 64, 4);
      g.closePath();
      g.fillStyle = vgrad(g, 4, 120, '#ffffff', '#dedede'); g.fill();
      g.strokeStyle = 'rgba(176,176,176,1)'; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(60, 126); g.bezierCurveTo(66, 90, 66, 40, 64, 8); g.stroke();
      g.strokeStyle = 'rgba(200,200,200,0.9)'; g.lineWidth = 2.5;
      for (var k = 0; k < 6; k++) {
        var yy = 30 + k * 14;
        g.beginPath(); g.moveTo(65, yy); g.lineTo(36 + k * 2, yy - 14); g.moveTo(65, yy + 2); g.lineTo(88 - k * 1.5, yy - 12); g.stroke();
      }
    },
    note: function (g) {
      g.fillStyle = '#fff';
      g.save(); g.translate(44, 98); g.rotate(-0.42); g.beginPath(); g.ellipse(0, 0, 21, 15, 0, 0, TAU); g.fill(); g.restore();
      roundRect(g, 58, 18, 9, 80, 3); g.fill();
      g.beginPath(); g.moveTo(66, 18); g.bezierCurveTo(70, 50, 108, 52, 100, 96); g.bezierCurveTo(98, 70, 78, 64, 66, 52); g.closePath(); g.fill();
    },
    note2: function (g) {
      g.fillStyle = '#fff';
      g.save(); g.translate(34, 100); g.rotate(-0.42); g.beginPath(); g.ellipse(0, 0, 19, 14, 0, 0, TAU); g.fill(); g.restore();
      g.save(); g.translate(88, 90); g.rotate(-0.42); g.beginPath(); g.ellipse(0, 0, 19, 14, 0, 0, TAU); g.fill(); g.restore();
      roundRect(g, 46, 28, 8, 72, 3); g.fill();
      roundRect(g, 100, 18, 8, 72, 3); g.fill();
      polygon(g, [46, 24, 108, 10, 108, 32, 46, 46]); g.fill();
    },
    drop: function (g) {
      g.beginPath();
      g.moveTo(64, 4);
      g.bezierCurveTo(76, 34, 108, 62, 108, 86);
      g.bezierCurveTo(108, 110, 88, 124, 64, 124);
      g.bezierCurveTo(40, 124, 20, 110, 20, 86);
      g.bezierCurveTo(20, 62, 52, 34, 64, 4);
      g.closePath();
      g.fillStyle = vgrad(g, 4, 124, '#ffffff', '#cfcfcf'); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.save(); g.translate(44, 88); g.rotate(-0.5); g.beginPath(); g.ellipse(0, 0, 7, 14, 0, 0, TAU); g.fill(); g.restore();
    },
    cloud: function (g) {
      var blobs = [[38, 82, 26], [66, 62, 33], [94, 80, 27], [64, 92, 30], [28, 98, 17], [102, 98, 17]];
      for (var k = 0; k < blobs.length; k++) {
        var b = blobs[k];
        var gr = g.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.8, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(b[0], b[1], b[2], 0, TAU); g.fill();
      }
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = vgrad(g, 30, 122, 'rgba(255,255,255,1)', 'rgba(196,204,222,1)'); g.fillRect(0, 0, 128, 128);
      g.globalCompositeOperation = 'source-over';
    },
    petal: function (g) {
      g.beginPath();
      g.moveTo(64, 120);
      g.bezierCurveTo(28, 102, 8, 52, 32, 22);
      g.bezierCurveTo(44, 8, 56, 12, 64, 30);
      g.bezierCurveTo(72, 12, 84, 8, 96, 22);
      g.bezierCurveTo(120, 52, 100, 102, 64, 120);
      g.closePath();
      g.fillStyle = vgrad(g, 8, 120, '#ffffff', '#dcdcdc'); g.fill();
      g.strokeStyle = 'rgba(205,205,205,0.9)'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(64, 112); g.lineTo(64, 46); g.stroke();
    },
    rune: function (g) {
      g.translate(64, 64); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
      g.lineWidth = 3.2; g.beginPath(); g.arc(0, 0, 60, 0, TAU); g.stroke();
      g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 54, 0, TAU); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 24, 0, TAU); g.stroke();
      for (var t = 0; t < 2; t++) {
        g.beginPath();
        for (var k = 0; k < 3; k++) {
          var an = -PI / 2 + k * TAU / 3 + t * PI;
          var px = Math.cos(an) * 50, py = Math.sin(an) * 50;
          if (k) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.closePath(); g.stroke();
      }
      for (var k2 = 0; k2 < 12; k2++) {
        var a2 = k2 * TAU / 12;
        g.lineWidth = k2 % 3 === 0 ? 4 : 2.2;
        g.beginPath(); g.moveTo(Math.cos(a2) * 54, Math.sin(a2) * 54); g.lineTo(Math.cos(a2) * 60, Math.sin(a2) * 60); g.stroke();
      }
      for (var k3 = 0; k3 < 6; k3++) {
        var a3 = -PI / 2 + k3 * TAU / 6;
        g.beginPath(); g.arc(Math.cos(a3) * 50, Math.sin(a3) * 50, 4.2, 0, TAU); g.fill();
      }
      g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
    },
    balloon: function (g) {
      g.strokeStyle = 'rgba(190,190,190,1)'; g.lineWidth = 2.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(64, 100); g.bezierCurveTo(52, 108, 74, 116, 62, 126); g.stroke();
      g.fillStyle = '#c4c4c4'; polygon(g, [64, 92, 56, 102, 72, 102]); g.fill();
      g.beginPath();
      g.moveTo(64, 94);
      g.bezierCurveTo(28, 78, 22, 40, 34, 22);
      g.bezierCurveTo(46, 4, 82, 4, 94, 22);
      g.bezierCurveTo(106, 40, 100, 78, 64, 94);
      g.closePath();
      var gr = g.createRadialGradient(50, 36, 4, 64, 54, 56);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#bcbcbc');
      g.fillStyle = gr; g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.save(); g.translate(46, 34); g.rotate(-0.6); g.beginPath(); g.ellipse(0, 0, 10, 5, 0, 0, TAU); g.fill(); g.restore();
    },
    egg: function (g) {
      g.beginPath();
      g.moveTo(64, 6);
      g.bezierCurveTo(98, 6, 114, 62, 108, 88);
      g.bezierCurveTo(102, 116, 84, 126, 64, 126);
      g.bezierCurveTo(44, 126, 26, 116, 20, 88);
      g.bezierCurveTo(14, 62, 30, 6, 64, 6);
      g.closePath();
      g.save(); g.clip();
      g.fillStyle = vgrad(g, 6, 126, '#ffffff', '#cdcdcd'); g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(140,140,140,0.9)';
      g.beginPath(); g.moveTo(0, 64);
      for (var x = 0; x <= 128; x += 8) g.lineTo(x, 64 + (x % 16 === 0 ? -9 : 9));
      g.lineTo(128, 84); for (var x2 = 128; x2 >= 0; x2 -= 8) g.lineTo(x2, 84 + (x2 % 16 === 0 ? -9 : 9));
      g.closePath(); g.fill();
      g.beginPath(); g.arc(40, 34, 7, 0, TAU); g.arc(82, 38, 6, 0, TAU); g.arc(64, 110, 7, 0, TAU); g.fill();
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.save(); g.translate(44, 40); g.rotate(-0.6); g.beginPath(); g.ellipse(0, 0, 9, 17, 0, 0, TAU); g.fill(); g.restore();
    },
    candy: function (g) {
      g.translate(64, 64); g.rotate(-0.55);
      g.fillStyle = '#d2d2d2';
      polygon(g, [-24, 0, -60, -26, -56, 0, -60, 26]); g.fill();
      polygon(g, [24, 0, 60, -26, 56, 0, 60, 26]); g.fill();
      g.strokeStyle = 'rgba(150,150,150,1)'; g.lineWidth = 2.5; g.lineCap = 'round';
      for (var k = -1; k <= 1; k++) {
        g.beginPath(); g.moveTo(-26, k * 4); g.lineTo(-56, k * 17); g.moveTo(26, k * 4); g.lineTo(56, k * 17); g.stroke();
      }
      g.beginPath(); g.ellipse(0, 0, 30, 24, 0, 0, TAU);
      var gr = g.createRadialGradient(-8, -8, 3, 0, 0, 34);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#cfcfcf');
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      g.strokeStyle = 'rgba(150,150,150,1)'; g.lineWidth = 6;
      for (var s = -2; s <= 2; s++) { g.beginPath(); g.moveTo(s * 15 - 12, -30); g.lineTo(s * 15 + 12, 30); g.stroke(); }
      g.restore();
    },
    sprinkle: function (g) {
      roundRect(g, 50, 12, 28, 104, 14);
      g.fillStyle = vgrad(g, 12, 116, '#ffffff', '#cfcfcf'); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)'; roundRect(g, 56, 20, 7, 88, 3); g.fill();
    },
    shard: function (g) {
      g.fillStyle = '#e8e8e8'; polygon(g, [64, 4, 94, 40, 86, 102, 64, 124, 42, 102, 34, 40]); g.fill();
      g.fillStyle = '#ffffff'; polygon(g, [64, 4, 94, 40, 64, 66]); g.fill();
      g.fillStyle = '#f4f4f4'; polygon(g, [64, 4, 34, 40, 64, 66]); g.fill();
      g.fillStyle = '#cdcdcd'; polygon(g, [94, 40, 86, 102, 64, 66]); g.fill();
      g.fillStyle = '#dedede'; polygon(g, [34, 40, 42, 102, 64, 66]); g.fill();
      g.fillStyle = '#bdbdbd'; polygon(g, [86, 102, 64, 124, 64, 66]); g.fill();
      g.fillStyle = '#d0d0d0'; polygon(g, [42, 102, 64, 124, 64, 66]); g.fill();
    },
    chip: function (g) {
      g.lineJoin = 'round';
      polygon(g, [12, 62, 38, 16, 98, 22, 118, 70, 86, 114, 28, 102]);
      g.fillStyle = vgrad(g, 16, 114, '#ffffff', '#c8c8c8'); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(176,176,176,1)'; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      polygon(g, [34, 56, 50, 32, 82, 36, 70, 54]); g.fill();
    },
    bang: function (g) {
      g.fillStyle = '#fff'; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(46, 30); g.arcTo(46, 12, 64, 12, 18); g.arcTo(82, 12, 82, 30, 18);
      g.lineTo(74, 78); g.arcTo(72, 90, 64, 90, 8); g.arcTo(56, 90, 54, 78, 8);
      g.closePath(); g.fill();
      g.beginPath(); g.arc(64, 108, 12, 0, TAU); g.fill();
    },
    bolt: function (g) {
      g.lineJoin = 'miter'; g.lineCap = 'round';
      var pts = [88, 6, 50, 60, 72, 62, 36, 122];
      function line(w, a) {
        g.strokeStyle = 'rgba(255,255,255,' + a + ')'; g.lineWidth = w;
        g.beginPath(); g.moveTo(pts[0], pts[1]);
        for (var i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.stroke();
      }
      line(22, 0.18); line(13, 0.35); line(6, 1);
    }
  };

  function pixelPaint(g, ox, oy, cs, fn) {
    var img = g.createImageData(cs, cs), d = img.data;
    for (var j = 0; j < cs; j++) {
      for (var i = 0; i < cs; i++) {
        var x = ((i + 0.5) / cs) * 2 - 1, y = 1 - ((j + 0.5) / cs) * 2;
        PXG = 1;
        var a = fn(x, y);
        if (a < 0) a = 0; else if (a > 1) a = 1;
        var o = (j * cs + i) * 4, gv = (clamp(PXG, 0, 1) * 255 + 0.5) | 0;
        d[o] = gv; d[o + 1] = gv; d[o + 2] = gv; d[o + 3] = (a * 255 + 0.5) | 0;
      }
    }
    g.putImageData(img, ox, oy);
  }

  var atlases = {};                     /* cell size -> { canvas, cs }: GPU atlas follows the quality, icons always use 128 */
  function buildAtlas(cs) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = cs * COLS;
    var g = cv.getContext('2d');
    for (var i = 0; i < SPRITE_NAMES.length; i++) {
      var name = SPRITE_NAMES[i], ox = (i % COLS) * cs, oy = ((i / COLS) | 0) * cs;
      if (PIXEL[name]) {
        pixelPaint(g, ox, oy, cs, PIXEL[name]);
      } else if (PATHS[name]) {
        g.save();
        g.beginPath(); g.rect(ox, oy, cs, cs); g.clip();
        g.translate(ox, oy); g.scale(cs / 128, cs / 128);
        PATHS[name](g);
        g.restore();
      }
    }
    return { canvas: cv, cs: cs };
  }
  var cellPx = 128;
  function ensureAtlas(cs) {
    cs = cs || cellPx;
    return atlases[cs] || (atlases[cs] = buildAtlas(cs));
  }

  /* --------------------------------------------------------------- quality */
  var QUALITY = null;                   /* 'low' | 'medium' | 'high' (null until chosen) */
  var BUDGETS = { high: 2000, medium: 1100, low: 500 };
  var QSCALES = { high: 1, medium: 0.6, low: 0.32 };
  var CAP = 2048;                       /* hard capacity of the pool (>= biggest budget) */
  var budget = 2000, QS = 1, cap0 = 440, cap1 = 900;

  /* ------------------------------------------------------------ module state */
  var scene = null, camera = null, inited = false, group = null;
  var texture = null, sysN = null, sysA = null;
  var now = 0;                          /* internal clock (advances only in update) */
  var ppx = 0, ppy = 0, ppz = 0;        /* player position */
  var camRX = 1, camRZ = 0, camFX = 0, camFZ = -1, camX = 0, camY = 0, camZ = 0;  /* camera basis (horizontal) */

  /* ------------------------------------------------------------- shaders */
  var VERT = [
    'attribute vec4 iA;',                 /* x y z size */
    'attribute vec4 iB;',                 /* vx vy vz rot */
    'attribute vec4 iC;',                 /* r g b a */
    'attribute vec4 iD;',                 /* frame mode stretch|aspect xscale */
    'uniform float uCols;',
    'uniform float uCell;',
    'uniform float uWhite[64];',
    'varying vec2 vUv;',
    'varying vec4 vCol;',
    'varying float vWhite;',
    'void main() {',
    '  vec2 c = position.xy;',
    '  float size = iA.w;',
    '  float mode = iD.y;',
    '  vec4 mv;',
    '  if (mode < 0.5) {',                /* 0: camera-facing billboard */
    '    float cs = cos(iB.w), sn = sin(iB.w);',
    '    vec2 q = vec2(c.x * iD.w, c.y);',
    '    q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) * size;',
    '    mv = viewMatrix * vec4(iA.xyz, 1.0);',
    '    mv.xy += q;',
    '    mv.z += min(size * 0.3, 1.2);',
    '  } else if (mode < 1.5) {',         /* 1: stretched along the velocity */
    '    vec3 vv = (viewMatrix * vec4(iB.xyz, 0.0)).xyz;',
    '    vec2 d = vv.xy;',
    '    float l = length(d);',
    '    d = l > 1e-4 ? d / l : vec2(0.0, 1.0);',
    '    vec2 n = vec2(d.y, -d.x);',
    '    float len = size * (1.0 + iD.z * length(iB.xyz));',
    '    mv = viewMatrix * vec4(iA.xyz, 1.0);',
    '    mv.xy += n * (c.x * iD.w * size) + d * (c.y * len);',
    '    mv.z += min(size * 0.3, 1.2);',
    '  } else if (mode < 2.5) {',         /* 2: flat on the ground (rings, runes) */
    '    float cs = cos(iB.w), sn = sin(iB.w);',
    '    vec2 q = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;',
    '    mv = viewMatrix * vec4(iA.x + q.x, iA.y, iA.z + q.y, 1.0);',
    '    mv.z += 0.1;',
    '  } else if (mode < 3.5) {',         /* 3: upright, turns around Y to face the camera (pillars) */
    '    vec3 rt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);',
    '    rt.y = 0.0;',
    '    float rl = length(rt);',
    '    rt = rl > 1e-4 ? rt / rl : vec3(1.0, 0.0, 0.0);',
    '    vec3 wp = iA.xyz + rt * (c.x * size) + vec3(0.0, c.y * size * iD.z, 0.0);',
    '    mv = viewMatrix * vec4(wp, 1.0);',
    '  } else {',                         /* 4: segment: centre +- axis/2, width = size (lightning, rays) */
    '    mv = viewMatrix * vec4(iA.xyz, 1.0);',
    '    vec3 va = (viewMatrix * vec4(iB.xyz, 0.0)).xyz;',
    '    vec2 d = va.xy;',
    '    float l = length(d);',
    '    d = l > 1e-4 ? d / l : vec2(0.0, 1.0);',
    '    vec2 n = vec2(d.y, -d.x);',
    '    mv.xyz += va * c.y;',
    '    mv.xy += n * (c.x * size);',
    '  }',
    '  gl_Position = projectionMatrix * mv;',
    '  float fr = iD.x;',
    '  float row = floor(fr / uCols);',
    '  float col = fr - row * uCols;',
    '  vUv = vec2((col + c.x + 0.5) * uCell, 1.0 - (row + 0.5 - c.y) * uCell);',
    '  vCol = iC;',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D uMap;',
    'varying vec2 vUv;',
    'varying vec4 vCol;',
    'void main() {',
    '  vec4 t = texture2D(uMap, vUv);',        /* premultiplied atlas */
    '  vec4 o = vec4(t.rgb * vCol.rgb, t.a) * vCol.a;',
    '  if (o.a < 0.004 && max(o.r, max(o.g, o.b)) < 0.004) discard;',
    '  gl_FragColor = o;',
    '}'
  ].join('\n');

  var RVERT = [
    'attribute vec4 aCol;',
    'varying vec4 vC;',
    'void main() {',
    '  vC = aCol;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');
  var RFRAG = [
    'varying vec4 vC;',
    'void main() { gl_FragColor = vC; }'
  ].join('\n');

  /* --------------------------------------------------------- particle pool */
  function f32() { return new Float32Array(CAP); }
  var pAlive = new Uint8Array(CAP), pBlend = new Uint8Array(CAP), pPrio = new Uint8Array(CAP);
  var pMode = new Uint8Array(CAP), pMove = new Uint8Array(CAP);
  var pAnchor = new Int8Array(CAP);
  var pX = f32(), pY = f32(), pZ = f32(), pVX = f32(), pVY = f32(), pVZ = f32();
  var pAge = f32(), pLife = f32(), pS0 = f32(), pS1 = f32(), pSzp = f32();
  var pRot = f32(), pSpin = f32(), pDrag = f32(), pGrav = f32();
  var pR0 = f32(), pG0 = f32(), pB0 = f32(), pR1 = f32(), pG1 = f32(), pB1 = f32(), pA0 = f32();
  var pFin = f32(), pFout = f32(), pFrame = f32(), pStretch = f32();
  var pFlip = f32(), pFlipPh = f32(), pWob = f32(), pWobF = f32(), pWobPh = f32();
  var pTw = f32(), pTwF = f32();
  var pCX = f32(), pCY = f32(), pCZ = f32(), pRad0 = f32(), pRad1 = f32(), pTilt = f32();
  var pFy = f32(), pBounce = f32();
  var freeStack = new Int16Array(CAP), freeTop = 0;
  var live = 0, hi = 0, cnt0 = 0, cnt1 = 0, evictCur = 0;
  var ancX = new Float32Array(8), ancY = new Float32Array(8), ancZ = new Float32Array(8);
  var PRIO = 2;                         /* priority of what recipes emit now: 0 ambient .. 3 important */
  var SIZE_K = 1, RAD_K = 1;            /* global size / orbit-radius multipliers (auras use > 1) */
  var VS = 1, VSK = 1, OX = 0, OY = 0, OZ = 0;  /* spatial scale about an origin (victories): positions, speeds, gravity x VS, sizes x VSK */

  (function () { for (var i = CAP - 1; i >= 0; i--) freeStack[freeTop++] = i; })();

  /* Per-emit options: set the fields you need, then call emit(); emit() resets them. */
  var X = {
    drag: 0, grav: 0, spin: 0, rot: 0, rr: 1, a0: 1, fin: 0.06, fout: 0.55, szp: 1,
    stretch: 0, mode: 0, move: 0, flip: 0, wob: 0, wobF: 3, tw: 0, twF: 9, anchor: -1,
    cx: 0, cy: 0, cz: 0, rad0: 0, rad1: 0, tilt: 0, fy: -1e9, bounce: 0, delay: 0
  };
  function xr() {
    X.drag = 0; X.grav = 0; X.spin = 0; X.rot = 0; X.rr = 1; X.a0 = 1; X.fin = 0.06; X.fout = 0.55; X.szp = 1;
    X.stretch = 0; X.mode = 0; X.move = 0; X.flip = 0; X.wob = 0; X.wobF = 3; X.tw = 0; X.twF = 9; X.anchor = -1;
    X.cx = 0; X.cy = 0; X.cz = 0; X.rad0 = 0; X.rad1 = 0; X.tilt = 0; X.fy = -1e9; X.bounce = 0; X.delay = 0;
  }

  function incPrio(p) { if (p === 0) cnt0++; else if (p === 1) cnt1++; }
  function decPrio(p) { if (p === 0) cnt0--; else if (p === 1) cnt1--; }

  function evict(prio) {
    if (hi === 0) return -1;
    var best = -1, bestScore = 1e9;
    for (var k = 0; k < 48; k++) {
      if (++evictCur >= hi) evictCur = 0;
      var i = evictCur;
      if (pAlive[i] === 0 || pPrio[i] > prio) continue;
      var score = pPrio[i] * 10 - pAge[i] / pLife[i];
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
  function alloc(prio) {
    if (prio === 0 && cnt0 >= cap0) return -1;
    if (prio === 1 && cnt1 >= cap1) return -1;
    var i;
    if (live >= budget || freeTop === 0) {
      i = evict(prio);
      if (i < 0) return -1;
      decPrio(pPrio[i]);
    } else {
      i = freeStack[--freeTop];
      live++;
      if (i >= hi) hi = i + 1;
    }
    incPrio(prio);
    return i;
  }
  function killSlot(i) {
    pAlive[i] = 0;
    freeStack[freeTop++] = i;
    live--;
    decPrio(pPrio[i]);
  }

  /* Only light-like sprites blend additively; shapes (gems, rings, sparks, flames) use normal blending
     so they stay readable on the light grounds of the islands (additive on cream/snow/sand vanishes). */
  var ADD_FRAMES = {};
  (function () { var a = ['glow', 'burst', 'beam', 'rays', 'puff']; for (var i = 0; i < a.length; i++) ADD_FRAMES[F[a[i]]] = 1; })();

  /* gems (sparkle, star) need a saturated tint: the sprite has a darker rim, the shader adds the white-hot core */
  function gemTint(c) {
    var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var sat = mx > 0 ? (mx - mn) / mx : 0;
    if (sat >= 0.45) return c;
    if (sat < 0.06) return 0xffc23a;
    var k = 0.45 / sat;
    r = Math.max(0, Math.round(mx - (mx - r) * k)); g = Math.max(0, Math.round(mx - (mx - g) * k)); b = Math.max(0, Math.round(mx - (mx - b) * k));
    return (r << 16) | (g << 8) | b;
  }
  function isNeutral(c) { var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, mx = Math.max(r, g, b); return mx === 0 || (mx - Math.min(r, g, b)) / mx < 0.06; }
  var GEM_SPARKLE = F.sparkle, GEM_STAR = F.star;

  /* emit one particle; returns its slot or -1 (budget).  vx,vy,vz also serve as the axis for mode 4. */
  function emit(fr, add, x, y, z, vx, vy, vz, life, s0, s1, c0, c1) {
    if (add && ADD_FRAMES[fr] !== 1) add = 0;
    if (fr === GEM_SPARKLE || fr === GEM_STAR) {
      var n0 = isNeutral(c0), n1 = isNeutral(c1);
      if (n0 && !n1) c0 = lite(c1, 0.1); else if (n1 && !n0) c1 = lite(c0, 0.1);
      c0 = gemTint(c0); c1 = gemTint(c1);
    }
    var i = alloc(PRIO);
    if (i < 0) { xr(); return -1; }
    if (VS !== 1) {
      var sk = (X.mode === 2 || X.mode === 3) ? VS : VSK;
      x = OX + (x - OX) * VS; y = OY + (y - OY) * VS; z = OZ + (z - OZ) * VS;
      vx *= VS; vy *= VS; vz *= VS;
      if (X.move === 1) { X.cx = OX + (X.cx - OX) * VS; X.cy = OY + (X.cy - OY) * VS; X.cz = OZ + (X.cz - OZ) * VS; X.rad0 *= VS; X.rad1 *= VS; vx /= VS; vz /= VS; }
      X.grav *= VS; X.wob *= VS;
      if (X.fy > -1e8) X.fy = OY + (X.fy - OY) * VS;
      s0 *= sk; s1 *= sk;
    }
    pAlive[i] = 1; pBlend[i] = add ? 1 : 0; pPrio[i] = PRIO; pMode[i] = X.mode; pMove[i] = X.move;
    pAnchor[i] = X.anchor;
    pX[i] = x; pY[i] = y; pZ[i] = z; pVX[i] = vx; pVY[i] = vy; pVZ[i] = vz;
    pAge[i] = -X.delay; pLife[i] = life > 0.02 ? life : 0.02;
    pS0[i] = s0 * SIZE_K; pS1[i] = s1 * SIZE_K; pSzp[i] = X.szp;
    pRot[i] = X.rr ? Math.random() * TAU : X.rot; pSpin[i] = X.spin;
    pDrag[i] = X.drag; pGrav[i] = X.grav;
    pR0[i] = ((c0 >> 16) & 255) / 255; pG0[i] = ((c0 >> 8) & 255) / 255; pB0[i] = (c0 & 255) / 255;
    pR1[i] = ((c1 >> 16) & 255) / 255; pG1[i] = ((c1 >> 8) & 255) / 255; pB1[i] = (c1 & 255) / 255;
    pA0[i] = X.a0; pFin[i] = X.fin; pFout[i] = X.fout;
    pFrame[i] = fr; pStretch[i] = X.stretch;
    pFlip[i] = X.flip; pFlipPh[i] = Math.random() * TAU;
    pWob[i] = X.wob; pWobF[i] = X.wobF; pWobPh[i] = Math.random() * TAU;
    pTw[i] = X.tw; pTwF[i] = X.twF;
    pCX[i] = X.cx; pCY[i] = X.cy; pCZ[i] = X.cz; pRad0[i] = X.rad0 * RAD_K; pRad1[i] = X.rad1 * RAD_K; pTilt[i] = X.tilt;
    pFy[i] = X.fy; pBounce[i] = X.bounce;
    xr();
    return i;
  }
  /* shorthand: emit with the same colour over the whole life */
  function emit1(fr, add, x, y, z, vx, vy, vz, life, s0, s1, c) {
    return emit(fr, add, x, y, z, vx, vy, vz, life, s0, s1, c, c);
  }
  function clearPool() {
    for (var i = 0; i < CAP; i++) pAlive[i] = 0;
    freeTop = 0;
    for (var j = CAP - 1; j >= 0; j--) freeStack[freeTop++] = j;
    live = 0; hi = 0; cnt0 = 0; cnt1 = 0; evictCur = 0;
  }
  function trimToBudget() {
    for (var p = 0; p <= 3 && live > budget; p++) {
      for (var i = 0; i < hi && live > budget; i++) {
        if (pAlive[i] && pPrio[i] === p) killSlot(i);
      }
    }
  }

  /* ----------------------------------------------------------- simulation */
  function simulate(dt) {
    var N0 = sysN.buf[0], N1 = sysN.buf[1], N2 = sysN.buf[2], N3 = sysN.buf[3];
    var A0 = sysA.buf[0], A1 = sysA.buf[1], A2 = sysA.buf[2], A3 = sysA.buf[3];
    var nN = 0, nA = 0, last = -1;
    for (var i = 0; i < hi; i++) {
      if (pAlive[i] === 0) continue;
      var age = pAge[i] + dt;
      pAge[i] = age;
      if (age < 0) { last = i; continue; }
      var life = pLife[i];
      if (age >= life) { killSlot(i); continue; }
      last = i;
      var t = age / life;
      var x, y, z, vx = 0, vy = 0, vz = 0;
      var mv = pMove[i];
      if (mv === 0) {
        vx = pVX[i]; vy = pVY[i]; vz = pVZ[i];
        var dk = pDrag[i];
        if (dk > 0) { var f = 1 / (1 + dk * dt); vx *= f; vy *= f; vz *= f; }
        vy += pGrav[i] * dt;
        x = pX[i] + vx * dt; y = pY[i] + vy * dt; z = pZ[i] + vz * dt;
        var wb = pWob[i];
        if (wb > 0) {
          var ph = age * pWobF[i] + pWobPh[i];
          x += Math.cos(ph) * wb * dt;
          z += Math.sin(ph * 0.83 + 1.7) * wb * dt;
          y += Math.cos(ph * 1.31 + 0.6) * wb * 0.35 * dt;
        }
        var fy = pFy[i];
        if (y < fy) {
          y = fy;
          if (pBounce[i] > 0 && vy < -2.5) { vy = -vy * pBounce[i]; vx *= 0.72; vz *= 0.72; }
          else { vy = 0; var fr = 1 - 7 * dt; if (fr < 0) fr = 0; vx *= fr; vz *= fr; }
        }
        pX[i] = x; pY[i] = y; pZ[i] = z; pVX[i] = vx; pVY[i] = vy; pVZ[i] = vz;
      } else if (mv === 1) {
        /* orbit: vx = angular speed, vy = rise speed, vz = start phase, tilt = height/radius ratio */
        var ang = pVZ[i] + pVX[i] * age;
        var rad = pRad0[i] + (pRad1[i] - pRad0[i]) * t;
        var an = pAnchor[i];
        var ox = pCX[i], oy = pCY[i], oz = pCZ[i];
        if (an >= 0) { ox += ancX[an]; oy += ancY[an]; oz += ancZ[an]; }
        x = ox + Math.cos(ang) * rad;
        z = oz + Math.sin(ang) * rad;
        y = oy + pVY[i] * age + Math.sin(ang) * rad * pTilt[i];
      } else {
        x = pX[i]; y = pY[i]; z = pZ[i]; vx = pVX[i]; vy = pVY[i]; vz = pVZ[i];
      }

      var a = pA0[i];
      var fin = pFin[i], fout = pFout[i];
      if (t < fin) { var q = t / fin; a *= q * q * (3 - 2 * q); }
      if (t > fout) { var q2 = (t - fout) / (1 - fout); a *= 1 - q2 * q2 * (3 - 2 * q2); }
      var tw = pTw[i];
      if (tw > 0) a *= 1 - tw * (0.5 + 0.5 * Math.sin(age * pTwF[i] + pWobPh[i]));
      if (a <= 0.003) continue;
      var szp = pSzp[i];
      var size = pS0[i] + (pS1[i] - pS0[i]) * (szp === 1 ? t : Math.pow(t, szp));
      if (size <= 0.002) continue;
      var xs = 1, fl = pFlip[i];
      if (fl !== 0) { xs = Math.abs(Math.cos(pFlipPh[i] + age * fl)); if (xs < 0.12) xs = 0.12; }

      var o, b0, b1, b2, b3;
      if (pBlend[i] === 1) { o = nA++ * 4; b0 = A0; b1 = A1; b2 = A2; b3 = A3; }
      else { o = nN++ * 4; b0 = N0; b1 = N1; b2 = N2; b3 = N3; }
      b0[o] = x; b0[o + 1] = y; b0[o + 2] = z; b0[o + 3] = size;
      b1[o] = vx; b1[o + 1] = vy; b1[o + 2] = vz; b1[o + 3] = pRot[i] + pSpin[i] * age;
      b2[o] = pR0[i] + (pR1[i] - pR0[i]) * t;
      b2[o + 1] = pG0[i] + (pG1[i] - pG0[i]) * t;
      b2[o + 2] = pB0[i] + (pB1[i] - pB0[i]) * t;
      b2[o + 3] = a;
      b3[o] = pFrame[i]; b3[o + 1] = pMode[i]; b3[o + 2] = pStretch[i]; b3[o + 3] = xs;
    }
    hi = last + 1;
    flushSystem(sysN, nN);
    flushSystem(sysA, nA);
  }
  function setRange(at, count) {
    if (at.addUpdateRange) { at.clearUpdateRanges(); at.addUpdateRange(0, count); }
    else if (at.updateRange) { at.updateRange.offset = 0; at.updateRange.count = count; }
  }
  function flushSystem(s, n) {
    s.n = n;
    s.geo.instanceCount = n;
    s.mesh.visible = n > 0;
    if (n > 0) {
      for (var k = 0; k < 4; k++) { setRange(s.attrs[k], n * 4); s.attrs[k].needsUpdate = true; }
    }
  }

  /* ------------------------------------------------------ GPU objects */
  /* how much of a sprite's bright core turns white regardless of the tint (additive system only) */
  var WHITE = new Float32Array(64);
  (function () {
    var w = { dot: 0.75, sparkle: 0.95, star: 0.6, ember: 0.9, burst: 0.8, streak: 0.8, bolt: 0.9, seg: 0.9, flame: 0, rays: 0.5, puff: 0.3 };
    for (var k in w) if (F[k] !== undefined) WHITE[F[k]] = w[k];
  })();
  var ATTR_NAMES = ['iA', 'iB', 'iC', 'iD'];
  function makeTexture() {
    var a = ensureAtlas();
    var tex = new T.CanvasTexture(a.canvas);
    tex.premultiplyAlpha = true;
    tex.generateMipmaps = true;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.magFilter = T.LinearFilter;
    tex.anisotropy = 1;
    tex.needsUpdate = true;
    return tex;
  }
  function makeSystem(additive, order) {
    var geo = new T.InstancedBufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex(new T.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    var buf = [], attrs = [];
    for (var k = 0; k < 4; k++) {
      var arr = new Float32Array(CAP * 4);
      var at = new T.InstancedBufferAttribute(arr, 4);
      at.setUsage(T.DynamicDrawUsage);
      geo.setAttribute(ATTR_NAMES[k], at);
      buf.push(arr); attrs.push(at);
    }
    geo.instanceCount = 0;
    var mat = new T.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uCols: { value: COLS }, uCell: { value: 1 / COLS }, uWhite: { value: WHITE }, uCoreOn: { value: 1 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: T.DoubleSide, fog: false,
      blending: T.CustomBlending, blendEquation: T.AddEquation,
      blendSrc: T.OneFactor, blendDst: additive ? T.OneFactor : T.OneMinusSrcAlphaFactor,
      blendSrcAlpha: T.OneFactor, blendDstAlpha: additive ? T.OneFactor : T.OneMinusSrcAlphaFactor
    });
    var mesh = new T.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = order;
    mesh.visible = false;
    mesh.name = additive ? 'fx-add' : 'fx-normal';
    return { geo: geo, mat: mat, mesh: mesh, buf: buf, attrs: attrs, n: 0 };
  }

  /* ============================================================ helpers */
  var PX = 0, PY = 0, PZ = 0;           /* position of the current call */
  function at(pos) {
    if (pos) { PX = +pos.x || 0; PY = +pos.y || 0; PZ = +pos.z || 0; }
    else { PX = ppx; PY = ppy; PZ = ppz; }
  }
  function N(k) { var n = Math.round(k * QS); return n < 1 ? 1 : n; }
  function colOf(o, def) { return o && o.color != null ? toInt(o.color) : def; }
  function groundOf(y, o) { return (o && o.groundY !== undefined) ? o.groundY : (y < 0.6 ? y : (y < 4 ? Math.max(0, y - 2.2) : y - 2.2)); }

  var DX = 0, DY = 0, DZ = 0;
  function dirSphere() {
    var u = Math.random() * 2 - 1, a = Math.random() * TAU, s = Math.sqrt(1 - u * u);
    DX = s * Math.cos(a); DY = u; DZ = s * Math.sin(a);
  }
  /* direction inside a cone around +Y (spread in radians) */
  function dirCone(spread) {
    var th = spread * Math.sqrt(Math.random()), a = Math.random() * TAU, s = Math.sin(th);
    DX = s * Math.cos(a); DY = Math.cos(th); DZ = s * Math.sin(a);
  }
  function dirDisc() { var a = Math.random() * TAU; DX = Math.cos(a); DY = 0; DZ = Math.sin(a); }

  /* soft light flash */
  function flash(x, y, z, s0, s1, life, color, a0, delay) {
    X.fin = 0.12; X.fout = 0.25; X.a0 = a0 === undefined ? 1 : a0; X.delay = delay || 0; X.szp = 0.6;
    return emit1(F.glow, 1, x, y, z, 0, 0, 0, life, s0, s1, color);
  }
  /* ring lying on the ground */
  function ringFlat(x, y, z, r0, r1, life, color, a0, thick, delay) {
    X.mode = 2; X.fin = 0.04; X.fout = 0.35; X.a0 = a0 === undefined ? 1 : a0; X.szp = 0.55; X.delay = delay || 0;
    return emit1(thick ? F.ringThick : F.ring, 1, x, y + 0.14, z, 0, 0, 0, life, r0 * 2, r1 * 2, color);
  }
  /* ring facing the camera */
  function ringFace(x, y, z, r0, r1, life, color, a0, thick, delay) {
    X.fin = 0.04; X.fout = 0.4; X.a0 = a0 === undefined ? 1 : a0; X.szp = 0.55; X.delay = delay || 0;
    return emit1(thick ? F.ringThick : F.ring, 1, x, y, z, 0, 0, 0, life, r0 * 2, r1 * 2, color);
  }
  /* light pillar standing on y (bottom), width w, height h */
  function pillar(x, y, z, w, h, life, c0, c1, a0, delay) {
    X.mode = 3; X.stretch = h / w; X.fin = 0.12; X.fout = 0.45; X.a0 = a0 === undefined ? 1 : a0; X.delay = delay || 0;
    return emit(F.beam, 1, x, y + h * 0.5, z, 0, 0, 0, life, w, w * 0.7, c0, c1);
  }
  /* soft dust puff (normal blending) */
  function dust(x, y, z, vx, vy, vz, life, s0, s1, color, a0) {
    X.drag = 3; X.a0 = a0 === undefined ? 0.5 : a0; X.fin = 0.12; X.fout = 0.3; X.szp = 0.6;
    return emit1(F.smoke, 0, x, y, z, vx, vy, vz, life, s0, s1, color);
  }

  /* cartoon dust puff (cloud sprite, normal blending) */
  function puffy(x, y, z, vx, vy, vz, life, s0, s1, color, a0) {
    X.drag = 3; X.a0 = a0 === undefined ? 0.8 : a0; X.fin = 0.1; X.fout = 0.45; X.szp = 0.55;
    return emit1(F.cloud, 0, x, y, z, vx, vy, vz, life, s0, s1, color);
  }

  /* flame = coloured teardrop (normal blending) + hot additive core; X.delay is respected */
  function flameP(x, y, z, vx, vy, vz, life, size) {
    var dl = X.delay, rot = rnd(-0.14, 0.14);
    X.drag = 0.4; X.rr = 0; X.rot = rot; X.fin = 0.08; X.fout = 0.45; X.delay = dl;
    emit(F.flame, 0, x, y, z, vx, vy, vz, life, size, size * 0.4, 0xff7a1c, 0xb82400);
    X.drag = 0.4; X.rr = 0; X.rot = rot; X.fin = 0.08; X.fout = 0.4; X.delay = dl; X.a0 = 0.75;
    emit(F.glow, 1, x, y - size * 0.1, z, vx, vy, vz, life * 0.85, size * 0.85, size * 0.25, 0xffd24a, 0xff6a10);
  }

  var PAL_CONF = [0xff4d6d, 0xffd23f, 0x3bd16f, 0x35b6ff, 0xb46bff, 0xff8a3d, 0xffffff, 0xff6ad5];
  var PAL_GOLD = [0xffe27a, 0xffc83d, 0xfff3b0, 0xffffff, 0xffb02e];
  var PAL_RAINBOW = [0xff4040, 0xff9a2e, 0xffe14a, 0x4ddf62, 0x3fb6ff, 0x6a5cff, 0xc45bff];
  var PAL_PASTEL = [0xffb3d9, 0xb5f0c8, 0xfff0a8, 0xb3d9ff, 0xe3c2ff, 0xffd2a8];

  /* camera basis (horizontal right/forward), refreshed every update and before a victory */
  function camBasis() {
    if (!camera) return;
    var e = camera.matrixWorld.elements;
    camX = e[12]; camY = e[13]; camZ = e[14];
    var fx = -e[8], fz = -e[10];
    var l = Math.sqrt(fx * fx + fz * fz);
    if (l < 1e-4) { fx = camFX; fz = camFZ; l = 1; }
    camFX = fx / l; camFZ = fz / l;
    camRX = -camFZ; camRZ = camFX;      /* right = forward x up */
  }

  /* ========================================================== burst recipes */
  /* Speeds: with drag k a particle travels about v0/k, so v0 = distance * k. */
  var RECIPES = {};
  var BURST_PRIO = { step: 0, jump: 1, land: 1, splash: 1, coin: 2, sparkle: 2, pop: 2 };

  RECIPES.steal = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xffd24a), gy = groundOf(y, o), i, n;
    flash(x, y, z, 3 * sc, 10 * sc, 0.26, lite(col, 0.75), 1);
    X.spin = 2.2; X.fin = 0.05; X.fout = 0.4; X.szp = 0.5;
    emit(F.burst, 1, x, y, z, 0, 0, 0, 0.34, 2 * sc, 9.5 * sc, 0xffffff, col);
    ringFace(x, y, z, 0.5 * sc, 6.2 * sc, 0.42, col, 1, false);
    ringFlat(x, gy, z, 0.6 * sc, 8.5 * sc, 0.55, col, 0.85, true);
    /* speed lines: flash -> sparks -> hanging dust */
    n = N(9 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirSphere();
      var sl = rnd(18, 32) * sc;
      X.mode = 1; X.stretch = 0.09; X.drag = 4.5; X.fin = 0; X.fout = 0.4;
      emit(F.streak, 1, x, y, z, DX * sl, DY * sl, DZ * sl, rnd(0.25, 0.4), 0.55 * sc, 0.15 * sc, 0xffffff, col);
    }
    n = N(20 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirSphere();
      var sp = rnd(4.5, 9.5) * 3 * sc;
      X.drag = 3; X.spin = rnd(-3, 3); X.tw = 0.5; X.twF = rnd(14, 22); X.fout = 0.45;
      emit(F.sparkle, 1, x, y, z, DX * sp, DY * sp, DZ * sp, rnd(0.55, 1.0), rnd(1.5, 2.6) * sc, 0.2 * sc,
        pick([0xffffff, lite(col, 0.6), col]), dark(col, 0.25));
    }
    n = N(7 * (o.count || 1));
    for (i = 0; i < n; i++) {
      X.drag = 0.8; X.grav = -12; X.wob = 3; X.spin = rnd(-2, 2); X.fout = 0.5;
      emit(F.star, 1, x + rnd(-0.6, 0.6), y, z + rnd(-0.6, 0.6), rnd(-3, 3), rnd(10, 16) * sc, rnd(-3, 3), rnd(0.8, 1.15),
        rnd(1.4, 2.0) * sc, 0.4 * sc, lite(col, 0.35), col);
    }
    n = N(10 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirSphere();
      var sm = rnd(2, 5) * 1.5 * sc;
      X.drag = 1.5; X.grav = 2; X.fout = 0.4;
      emit1(F.dot, 1, x, y, z, DX * sm, Math.abs(DY) * sm + 1, DZ * sm, rnd(0.6, 1.1), 0.9 * sc, 0.1 * sc, lite(col, 0.4));
    }
  };

  RECIPES.deliver = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xffd24a), i, n;
    flash(x, y + 3, z, 7 * sc, 24 * sc, 0.5, 0xfff0c0, 0.85);
    ringFlat(x, y, z, 1 * sc, 19 * sc, 0.85, col, 1, true);
    ringFlat(x, y, z, 0.5 * sc, 12 * sc, 0.65, 0xffffff, 0.8, false, 0.08);
    ringFlat(x, y, z, 0.5 * sc, 7 * sc, 0.5, lite(col, 0.4), 0.8, true, 0.2);
    ringFace(x, y + 3, z, 1 * sc, 11 * sc, 0.5, 0xfff0c0, 0.8, false, 0.05);
    /* confetti fountain in four pulses */
    n = N(72 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirCone(0.55);
      var sp = rnd(20, 34) * sc, wave = (i % 4) * 0.15;
      X.grav = -17; X.drag = 2.6; X.flip = rnd(7, 14); X.spin = rnd(-5, 5); X.fout = 0.72; X.fin = 0.02; X.delay = wave + rnd(0, 0.07);
      emit1(F.confetti, 0, x + rnd(-0.5, 0.5), y + 1.6, z + rnd(-0.5, 0.5), DX * sp, DY * sp, DZ * sp, rnd(2.0, 3.1),
        rnd(1.0, 1.7) * sc, rnd(1.0, 1.7) * sc, pick(PAL_CONF));
    }
    /* coin shower */
    n = N(18 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirDisc();
      var h = rnd(2, 7) * sc;
      X.grav = -52; X.flip = rnd(8, 13); X.spin = rnd(-2, 2); X.fy = y + 0.45; X.bounce = 0.42; X.fout = 0.75; X.delay = rnd(0, 0.7);
      emit1(F.coin, 0, x, y + 1.6, z, DX * h, rnd(18, 30) * sc, DZ * h, 2.5, 1.8 * sc, 1.8 * sc, pick([0xffc83d, 0xffd860, 0xffb02e]));
    }
    n = N(26 * (o.count || 1));
    for (i = 0; i < n; i++) {
      var an = Math.random() * TAU, rr = rnd(2, 10) * sc;
      X.tw = 0.5; X.twF = rnd(10, 16); X.spin = rnd(-2, 2); X.delay = rnd(0, 0.9); X.drag = 0.5; X.fout = 0.5;
      emit(F.sparkle, 1, x + Math.cos(an) * rr, y + rnd(1, 10) * sc, z + Math.sin(an) * rr, 0, rnd(0.5, 2.5), 0, rnd(0.7, 1.2),
        rnd(1.8, 3.2) * sc, 0.5 * sc, pick(PAL_GOLD), 0xffb02e);
    }
  };

  RECIPES.caught = function (x, y, z, o) {
    var sc = o.scale || 1, i, n, hh = (o.height || 5.8) * sc;
    flash(x, y + 2, z, 5 * sc, 16 * sc, 0.2, 0xffffff, 0.8);
    n = N(10 * (o.count || 1));
    for (i = 0; i < n; i++) {
      var an = (i / n) * TAU + rnd(-0.3, 0.3), sp = rnd(4, 7.5) * 2.6 * sc;
      var px = x + Math.cos(an) * 0.8, pz = z + Math.sin(an) * 0.8;
      if (i & 1) puffy(px, y + 1.4 * sc, pz, Math.cos(an) * sp, rnd(0.5, 3), Math.sin(an) * sp, rnd(0.6, 0.9), rnd(2.4, 3.4) * sc, rnd(5.2, 7.2) * sc, pick([0xffffff, 0xf0eef8, 0xe2dfea]), 0.92);
      else dust(px, y + 1.4 * sc, pz, Math.cos(an) * sp, rnd(0.5, 3), Math.sin(an) * sp, rnd(0.55, 0.9), rnd(2.4, 3.4) * sc, rnd(5.5, 7.8) * sc, pick([0xf2f0f6, 0xe2dfea, 0xd4d0e0]), 0.85);
    }
    n = N(5);
    if (n < 3) n = 3;
    for (i = 0; i < n; i++) {
      X.move = 1; X.cx = x; X.cy = y + hh + 0.6 * sc; X.cz = z; X.rad0 = 2.0 * sc; X.rad1 = 2.2 * sc; X.tilt = 0.45 * sc;
      X.spin = 3; X.fin = 0.12; X.fout = 0.7;
      emit(F.star, 1, 0, 0, 0, 5.6, 0.4, (i / n) * TAU, 1.8, 1.4 * sc, 1.2 * sc, 0xfff07a, 0xffc83d);
    }
    n = N(9 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirDisc();
      var s2 = rnd(3.5, 7) * sc;
      X.grav = -5; X.drag = 1.8; X.wob = 3.5; X.spin = rnd(-3, 3); X.flip = 3; X.fout = 0.6;
      emit1(F.feather, 0, x + DX, y + 3.2 * sc, z + DZ, DX * s2, rnd(5, 9) * sc, DZ * s2, rnd(1.5, 2.2), rnd(1.5, 2.1) * sc, rnd(1.5, 2.1) * sc,
        pick([0xffffff, 0xf4f1e8, 0xe8e4f2]));
    }
  };

  RECIPES.hatch = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xffd24a), gy = groundOf(y, o), i, n;
    pillar(x, gy, z, 3.6 * sc, 28 * sc, 1.0, 0xffffff, lite(col, 0.4), 0.9);
    pillar(x, gy, z, 1.4 * sc, 26 * sc, 0.65, 0xffffff, 0xffffff, 1);
    flash(x, y, z, 5 * sc, 20 * sc, 0.4, 0xffffff, 0.95);
    X.spin = 1.5; X.szp = 0.5; X.fout = 0.4;
    emit(F.burst, 1, x, y, z, 0, 0, 0, 0.45, 3 * sc, 13 * sc, 0xffffff, lite(col, 0.4));
    ringFlat(x, gy, z, 0.6 * sc, 14 * sc, 0.8, lite(col, 0.45), 1, true);
    ringFlat(x, gy, z, 0.4 * sc, 9 * sc, 0.55, 0xffffff, 0.8, false, 0.1);
    n = N(11 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirDisc();
      var h = rnd(4, 9) * sc;
      X.grav = -42; X.drag = 0.2; X.flip = rnd(3, 8); X.spin = rnd(-9, 9); X.fy = gy + 0.5; X.bounce = 0.35; X.fout = 0.5;
      var c = pick([col, lite(col, 0.35), 0xfff4e0, col]);
      emit1(F.chip, 0, x, y, z, DX * h, rnd(13, 22) * sc, DZ * h, 1.15, rnd(1.1, 1.8) * sc, rnd(1.1, 1.8) * sc, c);
    }
    n = N(30 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirSphere();
      var sp = rnd(5, 11) * 2.2 * sc;
      X.drag = 2.2; X.tw = 0.6; X.twF = rnd(10, 18); X.spin = rnd(-2, 2); X.fout = 0.5;
      emit(F.sparkle, 1, x, y, z, DX * sp, DY * sp + 2, DZ * sp, rnd(0.7, 1.3), rnd(1.4, 2.6) * sc, 0.3 * sc,
        pick([0xffffff, lite(col, 0.5), 0xfff2a8]), col);
    }
    n = N(6);
    for (i = 0; i < n; i++) {
      dirDisc();
      puffy(x + DX, gy + 0.8, z + DZ, DX * rnd(5, 9), rnd(0.5, 1.5), DZ * rnd(5, 9), 0.7, 1.8 * sc, 4.6 * sc, lite(col, 0.75), 0.7);
    }
  };

  RECIPES.coin = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xffd860), i, n;
    X.spin = 1.5; X.tw = 0.3; X.twF = 24; X.fin = 0.1; X.fout = 0.35; X.szp = 0.55;
    emit(F.sparkle, 1, x, y, z, 0, 1.2, 0, 0.5, 1.0 * sc, 4.2 * sc, 0xffffff, col);
    flash(x, y, z, 2 * sc, 5.5 * sc, 0.22, col, 0.85);
    ringFace(x, y, z, 0.3 * sc, 2.4 * sc, 0.3, lite(col, 0.4), 0.8, false);
    n = N(6 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirSphere();
      var sp = rnd(8, 13) * sc;
      X.drag = 2.6; X.fout = 0.4;
      emit(F.sparkle, 1, x, y, z, DX * sp, 3 + Math.abs(DY) * sp, DZ * sp, rnd(0.35, 0.6), rnd(0.8, 1.3) * sc, 0.1 * sc, 0xffffff, col);
    }
  };

  /* firework shell: sparks flying out of (x,y,z).  shape: 0 sphere, 1 ring, 2 willow (slow golden) */
  function fireworkShell(x, y, z, n, shape, c0, speed, delay) {
    var i;
    var tiltA = rnd(0, TAU), tx = Math.cos(tiltA), tz = Math.sin(tiltA), tilt = rnd(0.35, 1.0);
    for (i = 0; i < n; i++) {
      var sp = speed;
      if (shape === 1) {
        var an = (i / n) * TAU;
        var ux = Math.cos(an), uy = Math.sin(an);
        DX = ux; DY = uy * Math.cos(tilt); DZ = uy * Math.sin(tilt);
        /* rotate the ring plane around Y so rings do not all face the same way */
        var rx = DX * tx - DZ * tz, rz = DX * tz + DZ * tx;
        DX = rx; DZ = rz;
      } else { dirSphere(); sp *= rnd(0.55, 1); }
      var c = shape === 2 ? pick(PAL_GOLD) : (Math.random() < 0.28 ? lite(c0, 0.6) : c0);
      X.mode = 1; X.stretch = shape === 2 ? 0.06 : 0.09; X.drag = shape === 2 ? 1.7 : 1.9; X.grav = shape === 2 ? -9 : -11;
      X.delay = delay; X.fout = 0.35; X.fin = 0.01; X.tw = shape === 2 ? 0.3 : 0.15; X.twF = 20;
      emit(F.streak, 1, x, y, z, DX * sp, DY * sp, DZ * sp, shape === 2 ? rnd(1.9, 2.6) : rnd(1.2, 1.8), 1.7, 0.5, c, dark(c, 0.55));
    }
    /* glitter that hangs in the air */
    var m = Math.max(2, (n * 0.35) | 0);
    for (i = 0; i < m; i++) {
      dirSphere();
      var s2 = speed * rnd(0.3, 0.7);
      X.drag = 2.2; X.grav = -4; X.delay = delay + rnd(0.15, 0.5); X.tw = 0.8; X.twF = rnd(12, 20); X.spin = rnd(-3, 3); X.fout = 0.4;
      emit(F.sparkle, 1, x + DX * s2 * 0.5, y + DY * s2 * 0.5, z + DZ * s2 * 0.5, DX * 2, DY * 2, DZ * 2, rnd(0.6, 1.1), rnd(1.1, 1.9), 0.3, 0xffffff, c0);
    }
    flash(x, y, z, 5, 20, 0.34, lite(c0, 0.6), 0.8, delay);
    X.spin = 0.8; X.szp = 0.5; X.delay = delay; X.fout = 0.4;
    emit(F.burst, 1, x, y, z, 0, 0, 0, 0.35, 3, 12, 0xffffff, lite(c0, 0.5));
  }

  RECIPES.unlock = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xffd24a), i, n;
    var h0 = rnd(0, 1), fy = y + 8.5 * sc;
    var c0 = o.color != null ? col : hsv(h0, 0.7, 1);
    fireworkShell(x, fy, z, N(48), 0, c0, 19 * sc, 0.0);
    fireworkShell(x + rnd(-5, 5), fy - 2, z + rnd(-5, 5), N(30), 1, hsv(h0 + 0.5, 0.65, 1), 15 * sc, 0.28);
    ringFlat(x, y, z, 1, 24 * sc, 1.0, col, 1, true);
    ringFlat(x, y, z, 1, 15 * sc, 0.8, 0xffffff, 0.8, false, 0.1);
    pillar(x, y, z, 5 * sc, 30 * sc, 1.1, lite(col, 0.5), col, 0.7);
    n = N(28);
    for (i = 0; i < n; i++) {
      dirCone(0.9);
      var sp = rnd(10, 22);
      X.grav = -16; X.drag = 2.3; X.flip = rnd(7, 13); X.spin = rnd(-5, 5); X.fout = 0.7; X.delay = rnd(0.1, 0.5);
      emit1(F.confetti, 0, x, y + 2, z, DX * sp, DY * sp, DZ * sp, rnd(2, 3), 1.2, 1.2, pick(PAL_CONF));
    }
  };

  RECIPES.buy = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xffd24a), i, n;
    ringFlat(x, groundOf(y, o), z, 0.8 * sc, 9.5 * sc, 0.55, col, 0.95, true);
    ringFace(x, y + 1.5, z, 0.5 * sc, 5.2 * sc, 0.4, 0xffffff, 0.9, false);
    flash(x, y + 1.5, z, 3 * sc, 12 * sc, 0.3, lite(col, 0.6), 0.85);
    n = N(18 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirSphere();
      var sp = rnd(3.5, 7) * 3.2 * sc;
      X.drag = 3.2; X.tw = 0.5; X.twF = rnd(14, 22); X.spin = rnd(-3, 3); X.fout = 0.45;
      emit(F.sparkle, 1, x, y + 1.5, z, DX * sp, DY * sp + 2, DZ * sp, rnd(0.55, 0.9), rnd(1.4, 2.4) * sc, 0.2 * sc, pick([0xffffff, lite(col, 0.5), col]), col);
    }
    n = N(6 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirDisc();
      var h = rnd(1.5, 4) * sc;
      X.grav = -46; X.flip = rnd(8, 13); X.fout = 0.6; X.fy = y; X.bounce = 0.3;
      emit1(F.coin, 0, x, y + 1.5, z, DX * h, rnd(14, 21) * sc, DZ * h, 1.1, 1.5 * sc, 1.5 * sc, pick([0xffc83d, 0xffd860]));
    }
  };

  RECIPES.equip = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xffe9a0), hc = (o.height !== undefined ? o.height : 3.2) * sc, i, n;
    n = N(24 * (o.count || 1));
    for (i = 0; i < n; i++) {
      X.move = 1; X.cx = x; X.cy = y + 0.2 * sc; X.cz = z; X.rad0 = rnd(2.3, 3.4) * sc; X.rad1 = X.rad0 * 0.3;
      X.tw = 0.4; X.twF = rnd(14, 20); X.spin = rnd(-2, 2); X.fin = 0.1; X.fout = 0.5; X.delay = rnd(0, 0.18);
      emit(F.sparkle, 1, 0, 0, 0, rnd(7, 10), rnd(4, 7.5) * sc, rnd(0, TAU), rnd(0.85, 1.25), rnd(1.4, 2.3) * sc, 0.3 * sc,
        pick([0xffffff, lite(col, 0.5), col]), col);
    }
    n = N(4);
    for (i = 0; i < n; i++) {
      X.move = 1; X.cx = x; X.cy = y + 0.4 * sc; X.cz = z; X.rad0 = 3 * sc; X.rad1 = 0.9 * sc; X.fout = 0.5; X.spin = 2;
      emit(F.star, 1, 0, 0, 0, -8, 5 * sc, (i / n) * TAU, 1.0, 1.6 * sc, 0.5 * sc, 0xffffff, col);
    }
    ringFlat(x, groundOf(y, o), z, 0.5 * sc, 6 * sc, 0.5, col, 0.9, false);
    flash(x, y + hc, z, 3.5 * sc, 11 * sc, 0.34, lite(col, 0.5), 0.8);
  };

  RECIPES.sell = function (x, y, z, o) {
    var sc = o.scale || 1, i, n;
    n = N(11 * (o.count || 1));
    for (i = 0; i < n; i++) {
      var vx = rnd(-3.5, 3.5), vz = rnd(-3.5, 3.5), vy = rnd(14, 24) * sc;
      X.grav = -40; X.flip = rnd(8, 14); X.spin = rnd(-2, 2); X.fout = 0.6; X.delay = rnd(0, 0.14);
      emit1(F.coin, 0, x, y + 1.5, z, vx, vy, vz, 1.0, 1.7 * sc, 1.7 * sc, pick([0xffc83d, 0xffd860, 0xffb02e]));
      X.drag = 2; X.grav = -30; X.tw = 0.4; X.twF = 18; X.delay = rnd(0, 0.14);
      emit(F.sparkle, 1, x, y + 1.5, z, vx * 0.8, vy * 0.9, vz * 0.8, rnd(0.45, 0.7), 1.3 * sc, 0.15, 0xffffff, 0xffc83d);
    }
    flash(x, y + 1.5, z, 3 * sc, 10 * sc, 0.28, 0xffe27a, 0.8);
    ringFace(x, y + 1.5, z, 0.4 * sc, 3.8 * sc, 0.3, 0xffe27a, 0.8, false);
  };

  RECIPES.land = function (x, y, z, o) {
    var p = clamp(o.power !== undefined ? o.power : 0.6, 0.15, 1.6), col = colOf(o, 0xf0e6cc), i, n, sc = o.scale || 1;
    n = N(5 + 6 * p);
    for (i = 0; i < n; i++) {
      var an = (i / n) * TAU + rnd(-0.25, 0.25), sp = (4 + 7 * p) * rnd(0.8, 1.2) * sc;
      puffy(x + Math.cos(an) * 0.9, y + 0.5, z + Math.sin(an) * 0.9, Math.cos(an) * sp, rnd(0.5, 1.8), Math.sin(an) * sp,
        rnd(0.5, 0.75), (1.3 + 0.8 * p) * sc, (3.0 + 2.6 * p) * sc, rnd(0, 1) < 0.5 ? col : lite(col, 0.4), 0.88);
    }
    ringFlat(x, y, z, 0.6, (3.2 + 5 * p) * sc, 0.4, 0xffffff, 0.4 + 0.2 * p, true);
    n = N(6 * p);
    for (i = 0; i < n; i++) {
      dirDisc();
      X.grav = -44; X.drag = 0.4; X.fout = 0.5;
      emit1(F.dot, 0, x + DX * 0.8, y + 0.3, z + DZ * 0.8, DX * rnd(2, 6), rnd(6, 11) * p, DZ * rnd(2, 6), rnd(0.35, 0.55), 0.6, 0.4, dark(col, 0.45));
    }
  };

  RECIPES.jump = function (x, y, z, o) {
    var col = colOf(o, 0xf0e6cc), i, n = N(4), sc = o.scale || 1;
    for (i = 0; i < n; i++) {
      var an = (i / n) * TAU + rnd(-0.4, 0.4), sp = rnd(3.5, 6) * sc;
      puffy(x + Math.cos(an) * 0.6, y + 0.4, z + Math.sin(an) * 0.6, Math.cos(an) * sp, rnd(0.3, 1), Math.sin(an) * sp,
        rnd(0.38, 0.55), 1.0 * sc, 2.6 * sc, col, 0.78);
    }
  };

  RECIPES.step = function (x, y, z, o) {
    var col = colOf(o, 0xf0e6cc), n = QS < 0.5 ? 1 : 2, sc = o.scale || 1;
    for (var i = 0; i < n; i++) {
      puffy(x + rnd(-0.5, 0.5), y + 0.3, z + rnd(-0.5, 0.5), rnd(-1.6, 1.6), rnd(0.5, 1.2), rnd(-1.6, 1.6), rnd(0.32, 0.5), 0.95 * sc, 2.5 * sc, col, 0.78);
    }
  };

  RECIPES.splash = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0x8ad6ff), i, n;
    n = N(16 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirDisc();
      var h = rnd(2, 7) * sc;
      X.mode = 1; X.stretch = 0.1; X.grav = -42; X.fout = 0.6; X.fin = 0.02;
      emit1(F.drop, 0, x + DX * 0.4, y + 0.3, z + DZ * 0.4, DX * h, rnd(11, 19) * sc, DZ * h, rnd(0.7, 1.0), 0.85 * sc, 0.6 * sc, lite(col, rnd(0, 0.4)));
    }
    ringFlat(x, y, z, 0.4 * sc, 6 * sc, 0.7, lite(col, 0.6), 0.8, false);
    ringFlat(x, y, z, 0.3 * sc, 4 * sc, 0.55, 0xffffff, 0.75, false, 0.12);
    n = N(4);
    for (i = 0; i < n; i++) {
      dirDisc();
      puffy(x + DX * 0.5, y + 0.6, z + DZ * 0.5, DX * rnd(1.5, 4), rnd(1.5, 3), DZ * rnd(1.5, 4), 0.6, 1.0 * sc, 2.8 * sc, lite(col, 0.85), 0.55);
    }
    n = N(6);
    for (i = 0; i < n; i++) {
      X.drag = 1.5; X.wob = 1.5; X.fout = 0.5;
      emit1(F.bubble, 1, x + rnd(-0.8, 0.8), y + 0.3, z + rnd(-0.8, 0.8), rnd(-1, 1), rnd(3, 6), rnd(-1, 1), rnd(0.6, 0.9), rnd(0.7, 1.4) * sc, rnd(0.8, 1.6) * sc, lite(col, 0.5));
    }
  };

  RECIPES.alarm = function (x, y, z, o) {
    var sc = o.scale || 1, red = colOf(o, 0xff3b30), i, n, hh = (o.height || 7.5) * sc;
    ringFlat(x, y, z, 1 * sc, 17 * sc, 0.75, red, 0.95, true);
    ringFlat(x, y, z, 1 * sc, 10 * sc, 0.5, 0xffb0a0, 0.7, false, 0.1);
    flash(x, y + 3, z, 4 * sc, 15 * sc, 0.28, red, 0.85);
    /* "!" badge pops up above the head: red disc (normal) + white glyph (additive on top) */
    X.szp = 0.3; X.fin = 0.05; X.fout = 0.72; X.drag = 3; X.rr = 0;
    emit1(F.disc, 0, x, y + hh, z, 0, 5, 0, 1.15, 0.5 * sc, 3.8 * sc, red);
    X.szp = 0.3; X.fin = 0.05; X.fout = 0.72; X.drag = 3; X.rr = 0; X.a0 = 1.2;
    emit1(F.bang, 1, x, y + hh, z, 0, 5, 0, 1.15, 0.4 * sc, 3.0 * sc, 0xffffff);
    n = N(12 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirSphere();
      var sp = rnd(10, 20) * sc;
      X.mode = 1; X.stretch = 0.07; X.drag = 3.2; X.fout = 0.4;
      emit(F.streak, 1, x, y + 3.2, z, DX * sp, DY * sp, DZ * sp, rnd(0.3, 0.5), 0.55, 0.15, 0xff9a80, red);
    }
  };

  RECIPES.pop = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xffffff), i, n;
    ringFace(x, y, z, 0.4 * sc, 3.6 * sc, 0.32, col, 0.9, false);
    flash(x, y, z, 1.8 * sc, 5.5 * sc, 0.22, lite(col, 0.5), 0.8);
    n = N(9 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirSphere();
      var sp = rnd(2.5, 5) * 3.5 * sc;
      X.drag = 3.5; X.tw = 0.4; X.twF = 20; X.fout = 0.4;
      emit(F.sparkle, 1, x, y, z, DX * sp, DY * sp, DZ * sp, rnd(0.35, 0.55), rnd(1.0, 1.7) * sc, 0.1 * sc, 0xffffff, col);
    }
  };

  RECIPES.sparkle = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xfff2b0), n = N(10 * (o.count || 1));
    if (y < 1) y += 3 * sc;                       /* called with a feet position: sparkle around the body */
    for (var i = 0; i < n; i++) {
      dirSphere();
      var r = rnd(0.3, 2.4) * sc;
      X.tw = 0.9; X.twF = rnd(8, 14); X.spin = rnd(-2, 2); X.drag = 0.5; X.delay = rnd(0, 0.5); X.fin = 0.2; X.fout = 0.5;
      emit(F.sparkle, 1, x + DX * r, y + DY * r, z + DZ * r, 0, rnd(0.5, 2.5), 0, rnd(0.6, 1.0), rnd(1.6, 2.8) * sc, rnd(0.8, 1.6) * sc, 0xffffff, col);
    }
  };

  RECIPES.confetti = function (x, y, z, o) {
    var sc = o.scale || 1, n = N(44 * (o.count || 1)), pal = o.color != null ? [toInt(o.color), lite(toInt(o.color), 0.5), 0xffffff] : PAL_CONF;
    for (var i = 0; i < n; i++) {
      dirCone(1.0);
      var sp = rnd(12, 30) * sc;
      X.grav = -16; X.drag = 2.6; X.flip = rnd(7, 14); X.spin = rnd(-5, 5); X.fout = 0.72; X.fin = 0.02; X.delay = rnd(0, 0.1);
      emit1(F.confetti, 0, x, y + 1, z, DX * sp, DY * sp, DZ * sp, rnd(1.8, 2.8), rnd(0.9, 1.5) * sc, rnd(0.9, 1.5) * sc, pick(pal));
    }
  };

  RECIPES.spawn = function (x, y, z, o) {
    var sc = o.scale || 1, col = colOf(o, 0xbfe8ff), hc = (o.height !== undefined ? o.height : 1.5) * sc, i, n;
    var tA = 0.38;
    n = N(18 * (o.count || 1));
    for (i = 0; i < n; i++) {
      dirSphere();
      var r = rnd(4, 7) * sc, ta = tA * rnd(0.8, 1.0);
      X.fin = 0.1; X.fout = 0.7; X.tw = 0.3; X.twF = 18; X.spin = rnd(-3, 3);
      emit(F.sparkle, 1, x + DX * r, y + hc + DY * r, z + DZ * r, -DX * r / ta, -DY * r / ta, -DZ * r / ta, ta, rnd(1.5, 2.4) * sc, 0.3 * sc, 0xffffff, col);
    }
    flash(x, y + hc, z, 2 * sc, 13 * sc, 0.42, lite(col, 0.5), 0.95, tA);
    ringFace(x, y + hc, z, 0.4 * sc, 5.2 * sc, 0.42, col, 0.9, false, tA);
    ringFlat(x, groundOf(y, o), z, 0.4 * sc, 6 * sc, 0.5, col, 0.75, false, tA);
    n = N(10);
    for (i = 0; i < n; i++) {
      dirSphere();
      var sp = rnd(3, 6) * 3 * sc;
      X.drag = 3; X.delay = tA; X.fout = 0.4;
      emit(F.sparkle, 1, x, y + hc, z, DX * sp, DY * sp, DZ * sp, rnd(0.45, 0.8), rnd(1.1, 1.9) * sc, 0.1 * sc, 0xffffff, col);
    }
  };

  /* ====================================================== floating text */
  var textPool = [], textCache = {}, textKeys = [];
  function textTexture(str, color) {
    var key = str + '|' + color;
    var c = textCache[key];
    if (c) return c;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 96;
    var g = cv.getContext('2d');
    g.font = '900 64px Nunito, "Arial Black", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var w = g.measureText(str).width;
    if (w > 236) { g.font = '900 ' + Math.floor(64 * 236 / w) + 'px Nunito, "Arial Black", Arial, sans-serif'; }
    g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = 'rgba(40,24,0,0.92)';
    g.strokeText(str, 128, 50);
    g.fillStyle = css(color);
    g.fillText(str, 128, 50);
    var tex = new T.CanvasTexture(cv);
    tex.minFilter = T.LinearFilter; tex.generateMipmaps = false;
    textCache[key] = tex; textKeys.push(key);
    if (textKeys.length > 28) { var old = textKeys.shift(); if (textCache[old]) { textCache[old].dispose(); delete textCache[old]; } }
    return tex;
  }
  function makeTextPool() {
    for (var i = 0; i < 8; i++) {
      var mat = new T.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: true, fog: false });
      var sp = new T.Sprite(mat);
      sp.visible = false; sp.renderOrder = 1001;
      group.add(sp);
      textPool.push({ sprite: sp, life: 0, age: 0, vy: 0, scale: 1 });
    }
  }
  /* floating label ("+$120") rising from pos.  opts: color, scale, life, rise */
  function text(str, pos, opts) {
    if (!inited || !textPool.length) return;
    opts = opts || {};
    var slot = null, i;
    for (i = 0; i < textPool.length; i++) if (textPool[i].life <= 0) { slot = textPool[i]; break; }
    if (!slot) { slot = textPool[0]; for (i = 1; i < textPool.length; i++) if (textPool[i].age > slot.age) slot = textPool[i]; }
    at(pos);
    var sp = slot.sprite;
    sp.material.map = textTexture(String(str), opts.color != null ? toInt(opts.color) : 0xffe27a);
    sp.material.needsUpdate = true;
    sp.material.opacity = 0;
    sp.position.set(PX, PY, PZ);
    slot.scale = (opts.scale || 1) * 3.2;
    slot.life = opts.life || 1.3; slot.age = 0; slot.vy = (opts.rise || 3.4) / slot.life;
    sp.scale.set(slot.scale * 2.667 * 0.2, slot.scale * 0.2, 1);
    sp.visible = true;
  }
  function updateTexts(dt) {
    for (var i = 0; i < textPool.length; i++) {
      var s = textPool[i];
      if (s.life <= 0) continue;
      s.age += dt;
      var t = s.age / s.life;
      if (t >= 1) { s.life = 0; s.sprite.visible = false; continue; }
      var pop = t < 0.14 ? (0.6 + 0.55 * Math.sin((t / 0.14) * PI * 0.5)) : (1.15 - 0.15 * Math.min(1, (t - 0.14) / 0.1));
      s.sprite.position.y += s.vy * dt * (1 - t * 0.6);
      s.sprite.scale.set(s.scale * 0.5333 * pop, s.scale * 0.2 * pop, 1);
      s.sprite.material.opacity = t < 0.08 ? t / 0.08 : (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
    }
  }
  function clearTexts() {
    for (var i = 0; i < textPool.length; i++) { textPool[i].life = 0; textPool[i].sprite.visible = false; }
  }

  /* ================================================================ ribbon */
  var RIB_MAX = 40, RIB_L = 6;
  var rib = null;
  var RC_R = 1, RC_G = 1, RC_B = 1, RC_A = 1;
  function setRC(c, a) { RC_R = ((c >> 16) & 255) / 255; RC_G = ((c >> 8) & 255) / 255; RC_B = (c & 255) / 255; RC_A = a; }
  function edgeOf(u) { return 1 - Math.abs(u * 2 - 1); }

  /* style.col(u across 0..1, l along 0 head..1 tail, time) -> setRC(); width in world units */
  /* Ribbon styles.  col(u across 0..1, l along 0 head..1 tail, time) -> setRC(); width in world units.
     Every style: saturated edge, lighter core, soft transparent rim, fades toward the tail, hip height 1.6. */
  function coreMix(u) { var e = edgeOf(u); return e * e * (3 - 2 * e); }
  function rimA(u) { var e = edgeOf(u); var t = Math.min(1, e / 0.45); return t * t * (3 - 2 * t); }
  var RSTYLES = {
    green: {
      width: 3.1, life: 0.72, h: 1.6, add: 0.12, twist: 0, wave: 0.12,
      col: function (u, l, tt) {
        var c = mixc(mixc(0x17a03c, 0x7be84a, coreMix(u)), 0xe6ffb0, coreMix(u) * coreMix(u) * 0.6);
        setRC(mixc(c, 0x0f7a30, l * 0.5), rimA(u) * Math.pow(1 - l, 0.9) * 0.92);
      }
    },
    blue: {
      width: 3.3, life: 0.7, h: 1.6, add: 0.1, twist: 0, wave: 0.34,
      col: function (u, l, tt) {
        var c = mixc(mixc(0x1858ff, 0x3fb4ff, coreMix(u)), 0xeafcff, coreMix(u) * coreMix(u) * 0.85);
        c = mixc(c, 0xffffff, Math.max(0, Math.sin(l * 26 - tt * 14)) * 0.22 * (1 - l));
        setRC(c, rimA(u) * Math.pow(1 - l, 0.85) * 0.92);
      }
    },
    purple: {
      width: 3.3, life: 0.76, h: 1.6, add: 0.2, twist: 1, wave: 0,
      col: function (u, l, tt) {
        var c = mixc(mixc(0x7a2cff, 0xd05bff, coreMix(u)), 0xffd2ff, coreMix(u) * coreMix(u) * 0.8);
        setRC(c, rimA(u) * Math.pow(1 - l, 0.85) * (0.82 + 0.18 * Math.sin(l * 22 - tt * 12)));
      }
    },
    gold: {
      width: 3.1, life: 0.64, h: 1.6, add: 0.25, twist: 0, wave: 0,
      col: function (u, l, tt) {
        var c = mixc(mixc(0xff8a00, 0xffcf2a, coreMix(u)), 0xfffbd0, coreMix(u) * coreMix(u) * 0.9);
        c = mixc(c, 0xffffff, Math.max(0, Math.sin(l * 30 - tt * 16)) * 0.25 * (1 - l));
        setRC(c, rimA(u) * Math.pow(1 - l, 0.9) * 0.95);
      }
    },
    rainbow: {
      width: 3.8, life: 0.85, h: 1.6, add: 0.12, twist: 0, wave: 0,
      col: function (u, l, tt) {
        var e = edgeOf(u), c = hsv(u * 0.82 + l * 0.35 - tt * 0.7, 0.85, 1);
        c = mixc(c, 0xffffff, coreMix(u) * 0.3);
        var edge = Math.min(1, e / 0.12);
        setRC(c, edge * Math.pow(1 - l, 1.1) * 0.95);
      }
    }
  };

  /* One mesh, one draw call, two triangle strips sharing the path: strip 0 = ribbon at hip height (camera-leaning),
     strip 1 = wider soft glow lying on the ground (reads from behind, where the hip ribbon is seen edge-on). */
  var RIB_VPS = RIB_MAX * (RIB_L + 1);
  function makeRibbon() {
    var nv = RIB_VPS * 2;
    var pos = new Float32Array(nv * 3), col = new Float32Array(nv * 4);
    var idx = new Uint16Array((RIB_MAX - 1) * RIB_L * 12), p = 0;
    for (var j = 0; j < RIB_MAX - 1; j++) {
      for (var sidx = 0; sidx < 2; sidx++) {
        for (var k = 0; k < RIB_L; k++) {
          var a = sidx * RIB_VPS + j * (RIB_L + 1) + k, b = a + 1, c = a + RIB_L + 1, d = c + 1;
          idx[p++] = a; idx[p++] = b; idx[p++] = c; idx[p++] = b; idx[p++] = d; idx[p++] = c;
        }
      }
    }
    var geo = new T.BufferGeometry();
    var pa = new T.BufferAttribute(pos, 3), ca = new T.BufferAttribute(col, 4);
    pa.setUsage(T.DynamicDrawUsage); ca.setUsage(T.DynamicDrawUsage);
    geo.setAttribute('position', pa); geo.setAttribute('aCol', ca);
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    var mat = new T.ShaderMaterial({
      vertexShader: RVERT, fragmentShader: RFRAG, transparent: true, depthWrite: false, depthTest: true, side: T.DoubleSide, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor,
      blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor
    });
    var mesh = new T.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = 996; mesh.visible = false; mesh.name = 'fx-ribbon';
    return {
      mesh: mesh, geo: geo, pos: pa, col: ca, count: 0, style: null,
      x: new Float32Array(RIB_MAX), y: new Float32Array(RIB_MAX), z: new Float32Array(RIB_MAX), gy: new Float32Array(RIB_MAX), age: new Float32Array(RIB_MAX)
    };
  }
  function ribReset() {
    if (!rib) return;
    rib.count = 0;
    rib.mesh.visible = false;
    rib.geo.setDrawRange(0, 0);
  }
  /* live head of the ribbon: follows the player, frozen copies are left every ~0.34 units */
  /* live head follows the player; a frozen copy is left every `spacing` units (grows with speed so the
     40 points always cover the whole life of the ribbon and the tail never gets cut off early) */
  function ribHead(x, y, z, spacing) {
    var r = rib;
    if (r.count === 0) {
      r.x[0] = x; r.y[0] = y; r.z[0] = z; r.gy[0] = Math.min(y, gRef); r.age[0] = 0; r.count = 1;
      return;
    }
    var push = r.count === 1;
    if (!push) {
      var dx = x - r.x[1], dy = y - r.y[1], dz = z - r.z[1];
      push = dx * dx + dy * dy + dz * dz > spacing * spacing;
    }
    if (push) {
      var n = r.count < RIB_MAX ? r.count : RIB_MAX - 1;
      r.x.copyWithin(1, 0, n); r.y.copyWithin(1, 0, n); r.z.copyWithin(1, 0, n); r.gy.copyWithin(1, 0, n); r.age.copyWithin(1, 0, n);
      r.count = n + 1;
    }
    r.x[0] = x; r.y[0] = y; r.z[0] = z; r.gy[0] = Math.min(y, gRef); r.age[0] = 0;
  }
  function updateRibbon(dt) {
    var r = rib;
    if (!r || !r.style || r.count === 0) { if (r) r.mesh.visible = false; return; }
    var st = r.style, i, k;
    for (i = 0; i < r.count; i++) r.age[i] += dt;
    while (r.count > 0 && r.age[r.count - 1] > st.life) r.count--;
    if (r.count < 2) { r.mesh.visible = false; r.geo.setDrawRange(0, 0); return; }
    var pos = r.pos.array, col = r.col.array, cnt = r.count, L = st.life;
    for (k = 0; k < cnt; k++) {
      var px = r.x[k], py = r.y[k] + st.h, pz = r.z[k];
      var k0 = k > 0 ? k - 1 : 0, k1 = k < cnt - 1 ? k + 1 : cnt - 1;
      var tx = r.x[k0] - r.x[k1], ty = r.y[k0] - r.y[k1], tz = r.z[k0] - r.z[k1];
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      /* strip 0 leans toward the camera, so it reads from the side; strip 1 is flat on the ground */
      var cx = camX - px, cy = camY - py, cz = camZ - pz, cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
      var nx = cx / cl * 0.75, ny = 0.25 + cy / cl * 0.75, nz = cz / cl * 0.75, nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      var wx = ty * nz - tz * ny, wy = tz * nx - tx * nz, wz = tx * ny - ty * nx;
      var wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (wl < 0.15) { wx = -tz; wy = 0; wz = tx; wl = Math.sqrt(wx * wx + wz * wz) || 1; }
      wx /= wl; wy /= wl; wz /= wl;
      var hzl = Math.sqrt(tx * tx + tz * tz) || 1, gx = -tz / hzl, gz = tx / hzl;      /* horizontal perpendicular */
      var l01 = clamp(r.age[k] / L, 0, 1);
      var taper = Math.pow(1 - l01, 0.45);
      var hw = st.width * 0.5 * taper;
      if (st.twist) hw *= 0.3 + 0.7 * Math.abs(Math.cos(l01 * 9 - now * 8));
      var shift = st.wave ? st.wave * Math.sin(l01 * 14 - now * 10) : 0;
      var ghw = st.width * 0.5 * 1.5 * taper, gyp = r.gy[k] + 0.12;
      for (var m = 0; m <= RIB_L; m++) {
        var u = m / RIB_L, vi = k * (RIB_L + 1) + m, off = (u * 2 - 1) * hw + shift;
        st.col(u, l01, now);
        var a = RC_A;
        pos[vi * 3] = px + wx * off; pos[vi * 3 + 1] = py + wy * off; pos[vi * 3 + 2] = pz + wz * off;
        col[vi * 4] = RC_R * a; col[vi * 4 + 1] = RC_G * a; col[vi * 4 + 2] = RC_B * a; col[vi * 4 + 3] = a * (1 - st.add);
        var vg = (RIB_VPS + vi), go = (u * 2 - 1) * ghw, ga = a * 0.62;
        pos[vg * 3] = px + gx * go; pos[vg * 3 + 1] = gyp; pos[vg * 3 + 2] = pz + gz * go;
        col[vg * 4] = RC_R * ga; col[vg * 4 + 1] = RC_G * ga; col[vg * 4 + 2] = RC_B * ga; col[vg * 4 + 3] = ga * (1 - st.add * 0.5);
      }
    }
    r.pos.needsUpdate = true; r.col.needsUpdate = true;
    r.geo.setDrawRange(0, (cnt - 1) * RIB_L * 12);
    r.mesh.visible = true;
  }

  /* ================================================================ trails */
  var TS = { id: 'none', has: false, lx: 0, ly: 0, lz: 0, dx: 0, dz: 1, acc: 0, n: 0, speed: 0 };
  var TRAIL_STEP = { green: 0.8, blue: 0.7, purple: 0.65, gold: 0.6, rainbow: 0.42 };
  var GREENS = [0x3ecb4a, 0x7be04f, 0xb6e84a, 0x2f9e44, 0xd4e04a];
  var HIP = 1.6;
  var TRAIL_GLOW = { green: 0x7be84a, blue: 0x3fa0ff, purple: 0xc04bff, gold: 0xffc83d, rainbow: 0xff9ad0 };

  /* every emitter gets the point on the ribbon centre line (x, y = feet), the heading (dx, dz) and the tint */
  var TRAIL_EMIT = {
    green: function (x, y, z, dx, dz, c) {
      var sx = -dz, sz = dx, side = rnd(-1, 1), hy = y + HIP + rnd(-0.5, 0.5);
      X.grav = -3; X.drag = 1.4; X.wob = 3; X.spin = rnd(-6, 6); X.flip = rnd(3, 6); X.fout = 0.55; X.fin = 0.08;
      var g = pick(GREENS);
      emit(F.leaf, 0, x + sx * side * 1.0, hy, z + sz * side * 1.0, -dx * rnd(0.5, 2) + sx * side * 2.2, rnd(0.5, 2.8), -dz * rnd(0.5, 2) + sz * side * 2.2,
        rnd(0.9, 1.3), rnd(1.3, 1.9), 0.7, g, dark(g, 0.2));
      X.tw = 0.5; X.twF = 16; X.fout = 0.5; X.spin = rnd(-2, 2);
      emit(F.sparkle, 1, x + sx * side * 0.8, hy, z + sz * side * 0.8, 0, rnd(0.6, 2), 0, rnd(0.45, 0.7), rnd(1.2, 1.9), 0.2, 0xd8ff6a, 0x39c84a);
      X.drag = 1; X.fout = 0.5;
      emit1(F.dot, 0, x + sx * side * 0.6, hy, z + sz * side * 0.6, -dx, rnd(0.5, 1.5), -dz, rnd(0.5, 0.8), 0.6, 0.15, 0x6be84a);
    },
    blue: function (x, y, z, dx, dz, c) {
      var sx = -dz, sz = dx, side = rnd(-1, 1), hy = y + HIP + rnd(-0.6, 0.6);
      X.drag = 0.8; X.wob = 1.8; X.fout = 0.6; X.a0 = 0.95;
      var s0 = rnd(0.55, 1.1);
      emit(F.bubble, 0, x + sx * side * 1.1, hy, z + sz * side * 1.1, -dx * 1.2, rnd(1.5, 3.5), -dz * 1.2, rnd(0.9, 1.4), s0, s0 + 0.3, 0x6ec8ff, 0xcfeeff);
      X.mode = 1; X.stretch = 0.1; X.grav = -30; X.fout = 0.6; X.fin = 0.02;
      emit1(F.drop, 0, x + sx * side * 0.6, hy, z + sz * side * 0.6, sx * rnd(-3, 3) - dx, rnd(4, 8), sz * rnd(-3, 3) - dz, 0.55, 0.65, 0.5, 0x3fa0ff);
      X.drag = 1.2; X.fout = 0.5;
      emit1(F.dot, 0, x + sx * side * 0.5, hy, z + sz * side * 0.5, -dx * 0.8, rnd(0.2, 1), -dz * 0.8, rnd(0.4, 0.7), 0.7, 0.2, 0xffffff);
      TS.n++;
      if ((TS.n & 1) === 0) ringFlat(x, y, z, 0.3, 2.6, 0.55, 0x4aa8ff, 0.7, false);
    },
    purple: function (x, y, z, dx, dz, c) {
      var hy = y + HIP, i;
      for (i = 0; i < 2; i++) {
        X.move = 1; X.cx = x; X.cy = hy + rnd(-0.6, 0.6); X.cz = z; X.rad0 = rnd(0.8, 1.3); X.rad1 = 0.15; X.tw = 0.4; X.twF = 14; X.fin = 0.1; X.fout = 0.5;
        emit(F.sparkle, 1, 0, 0, 0, sgn() * rnd(8, 12), rnd(0.6, 1.8), rnd(0, TAU), 0.65, rnd(1.2, 1.9), 0.2, pick([0xff8bff, 0xd070ff, 0xffb0ff]), 0x6a2cff);
      }
      TS.n++;
      if ((TS.n & 1) === 0) {
        X.grav = -2; X.drag = 1; X.spin = rnd(-4, 4); X.tw = 0.6; X.twF = 14; X.fout = 0.5;
        emit(F.star, 1, x + rnd(-0.8, 0.8), hy + rnd(-0.6, 0.6), z + rnd(-0.8, 0.8), rnd(-1, 1) - dx, rnd(0.3, 1.8), rnd(-1, 1) - dz, rnd(0.65, 0.95), 1.3, 0.3, 0xd070ff, 0x8a3cff);
      }
    },
    gold: function (x, y, z, dx, dz, c) {
      var sx = -dz, sz = dx, i, hy = y + HIP;
      for (i = 0; i < 2; i++) {
        X.tw = 0.7; X.twF = rnd(12, 20); X.fout = 0.5; X.spin = rnd(-3, 3);
        emit(F.sparkle, 1, x + sx * rnd(-1, 1), hy + rnd(-0.6, 0.6), z + sz * rnd(-1, 1), rnd(-1, 1) - dx, rnd(0.2, 1.5), rnd(-1, 1) - dz, rnd(0.5, 0.8), rnd(1.3, 2.0), 0.2,
          pick([0xffe27a, 0xffc83d, 0xfff0a0]), 0xff9a10);
      }
      TS.n++;
      if (TS.n % 3 === 0) {
        var side = rnd(-1, 1);
        X.flip = rnd(9, 14); X.grav = -34; X.fy = y + 0.4; X.bounce = 0.38; X.fout = 0.65; X.spin = rnd(-2, 2);
        emit1(F.coin, 0, x + sx * side * 0.8, hy + rnd(-0.3, 0.5), z + sz * side * 0.8, -dx * rnd(1, 3) + sx * side * 2, rnd(5, 9), -dz * rnd(1, 3) + sz * side * 2,
          1.1, 1.3, 1.3, pick([0xffc83d, 0xffd860]));
      }
    },
    rainbow: function (x, y, z, dx, dz, c) {
      var h = now * 0.6 + TS.n * 0.07, hy = y + HIP;
      TS.n++;
      X.tw = 0.5; X.twF = 16; X.fout = 0.5; X.spin = rnd(-3, 3);
      emit(F.sparkle, 1, x + rnd(-0.8, 0.8), hy + rnd(-0.7, 0.7), z + rnd(-0.8, 0.8), rnd(-1, 1) - dx, rnd(0, 1.5), rnd(-1, 1) - dz, rnd(0.5, 0.8), rnd(1.3, 2.0), 0.2, hsv(h, 0.8, 1), hsv(h + 0.25, 0.9, 1));
      if ((TS.n & 1) === 0) {
        X.drag = 1.2; X.fout = 0.5;
        emit(F.dot, 1, x + rnd(-0.5, 0.5), hy + rnd(-0.5, 0.5), z + rnd(-0.5, 0.5), rnd(-1, 1) - dx, rnd(0, 1.5), rnd(-1, 1) - dz, 0.55, 1.1, 0.2, hsv(h + 0.5, 0.75, 1), hsv(h + 0.7, 0.9, 1));
      }
      if ((TS.n & 3) === 0) {
        X.drag = 1; X.spin = rnd(-4, 4); X.tw = 0.5; X.twF = 16; X.fout = 0.5;
        emit(F.star, 1, x + rnd(-0.7, 0.7), hy + rnd(-0.6, 0.6), z + rnd(-0.7, 0.7), rnd(-1.5, 1.5) - dx, rnd(0.5, 2), rnd(-1.5, 1.5) - dz, 0.75, 1.2, 0.3, hsv(h + 0.4, 0.85, 1), hsv(h + 0.6, 0.9, 1));
      }
    }
  };

  /* Call every unpaused frame with the player's feet position.  moving=false lets the ribbon fade out. */
  function trail(id, color, pos, moving, dt) {
    if (!inited || !pos) return;
    id = id || 'none';
    var x = +pos.x || 0, y = +pos.y || 0, z = +pos.z || 0;
    if (id !== TS.id) {
      TS.id = id; TS.has = false; TS.acc = 0; TS.n = 0; TS.speed = 0;
      ribReset();
      rib.style = RSTYLES[id] || null;
    }
    if (!TS.has) { TS.lx = x; TS.ly = y; TS.lz = z; TS.has = true; }
    var dx = x - TS.lx, dz = z - TS.lz, dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 15 || Math.abs(y - TS.ly) > 30) { ribReset(); dist = 0; dx = 0; dz = 0; TS.acc = 0; TS.speed = 0; }   /* teleport */
    var px = TS.lx, pz = TS.lz, py = TS.ly;
    TS.lx = x; TS.ly = y; TS.lz = z;
    if (id === 'none' || !moving || !(dt > 0) || !TRAIL_EMIT[id]) { TS.speed *= 0.9; return; }
    TS.speed += (dist / dt - TS.speed) * 0.2;
    if (dist > 0.01) {
      TS.dx += (dx / dist - TS.dx) * 0.4; TS.dz += (dz / dist - TS.dz) * 0.4;
      var hl = Math.sqrt(TS.dx * TS.dx + TS.dz * TS.dz) || 1; TS.dx /= hl; TS.dz /= hl;
    }
    var st = rib.style, spacing = st ? clamp(TS.speed * st.life / (RIB_MAX - 4), 0.26, 1.3) : 0.34;
    /* ribbon head sits slightly behind the player, at hip height */
    ribHead(x - TS.dx * 0.7, y, z - TS.dz * 0.7, spacing);
    var D = TRAIL_STEP[id], c = toInt(color), guard = 0;
    TS.acc += dist;
    PRIO = 1; SIZE_K = 1.35;
    while (TS.acc >= D && guard++ < 5) {
      TS.acc -= D;
      var f = dist > 0 ? 1 - TS.acc / dist : 1;
      var ex = px + (x - px) * f - TS.dx * 0.8, ey = py + (y - py) * f, ez = pz + (z - pz) * f - TS.dz * 0.8;
      TRAIL_EMIT[id](ex, ey, ez, TS.dx, TS.dz, c);
      /* soft bloom on the ribbon: hot spot that makes the whole streak glow */
      X.fin = 0.2; X.fout = 0.4; X.a0 = 0.2; X.szp = 0.6;
      emit1(F.glow, 1, ex, ey + HIP, ez, -TS.dx * 0.8, 0, -TS.dz * 0.8, 0.3, 1.6, 2.6, id === 'rainbow' ? hsv(now * 0.6 + TS.n * 0.07, 0.6, 1) : TRAIL_GLOW[id]);
    }
    PRIO = 2; SIZE_K = 1;
  }

  /* ================================================================ auras */
  var auras = [], nextSlot = 0, pendingAura = null;
  var AURA_IMPL = {}, AURA_GLOW = {};
  var AURA_RATE = 1.6, AURA_SIZE = 1.4, AURA_RAD = 1.15;

  /* Turkish display names of auras and victory effects, by id (shop name objects carry en / ru / tr). */
  var TR_NAMES = {
    sparkles: 'Dönen Kıvılcımlar', fireflies: 'Ateş Böcekleri', bubbles: 'Sabun Balonları', leaves: 'Yaprak Girdabı',
    hearts: 'Süzülen Kalpler', snowcloud: 'Kar Bulutu', notes: 'Müzik Notaları', candy: 'Şeker Girdabı',
    petals: 'Sakura Yaprakları', flames: 'Ateş Aurası', stars: 'Kayan Yıldızlar', glitter: 'Altın Simler',
    ghost: 'Hayalet Işıklar', frost: 'Buz Kristalleri', lightning: 'Şimşek Kıvılcımları', rainbow: 'Gökkuşağı Halkası',
    coins: 'Para Yörüngesi', shadow: 'Gölge Dumanı', galaxy: 'Galaksi', sun: 'Güneş Işınları',
    confetti_cannon: 'Konfeti Topu', balloons: 'Balon Uçurma', bubble_burst: 'Kabarcık Patlaması', snow_burst: 'Kar Patlaması',
    heart_explosion: 'Kalp Patlaması', coin_rain: 'Para Yağmuru', petal_storm: 'Taç Yaprağı Fırtınası',
    candy_rain: 'Şeker Yağmuru', feather_burst: 'Melek Tüyleri', fireworks: 'Havai Fişek', star_nova: 'Yıldız Novası',
    egg_fountain: 'Yumurta Çeşmesi', music_party: 'Müzik Partisi', rainbow_arc: 'Gökkuşağı Yayı',
    golden_pillar: 'Altın Sütun', lightning_strike: 'Yıldırım Düşmesi', magic_circle: 'Sihirli Çember',
    fire_ring: 'Ateş Halkası', meteor_shower: 'Meteor Yağmuru', galaxy_swirl: 'Galaksi Girdabı'
  };

  function aura(id, name_ru, name_en, rarity, colors, channels) {
    AURA_IMPL[id] = channels;
    AURA_GLOW[id] = toInt(colors[0]);
    return { id: id, name: { en: name_en, ru: name_ru, tr: TR_NAMES[id] || name_en }, rarity: rarity, colors: colors };
  }
  /* anchored orbit helper: X.move=1 centred on the aura target */
  function orbitX(a, cy, r0, r1, tilt) {
    X.move = 1; X.anchor = a.slot; X.cx = 0; X.cz = 0; X.cy = cy; X.rad0 = r0; X.rad1 = r1; X.tilt = tilt || 0;
  }

  var AURA_LIST = [
    aura('sparkles', 'Кружащие искры', 'Orbiting Sparkles', 0, ['#ffe27a', '#ffffff', '#ffb02e'], [
      { rate: 9, fn: function (a, x, y, z) {
        var r = rnd(2.1, 2.9);
        orbitX(a, rnd(0.6, 5.2), r, r, rnd(-0.4, 0.4)); X.tw = 0.5; X.twF = rnd(10, 16); X.spin = rnd(-2, 2); X.fin = 0.2; X.fout = 0.55;
        emit(F.sparkle, 1, 0, 0, 0, a.dir * rnd(2.2, 3.4), rnd(0.2, 0.9), rnd(0, TAU), rnd(1.5, 2.1), rnd(1.1, 1.7), rnd(0.8, 1.2), pick([0xffffff, 0xfff2a8, 0xffd45a]), 0xffb02e);
      } },
      { rate: 3, fn: function (a, x, y, z) {
        X.tw = 0.8; X.twF = rnd(10, 16); X.fout = 0.5;
        emit(F.dot, 1, x + rnd(-1.4, 1.4), y + rnd(0.5, 5), z + rnd(-1.4, 1.4), 0, rnd(0.3, 1), 0, rnd(0.6, 1.0), 0.6, 0.15, 0xffffff, 0xffd45a);
      } }
    ]),
    aura('fireflies', 'Светлячки', 'Fireflies', 0, ['#d9ff5a', '#9be84a', '#fff6a0'], [
      { rate: 5, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(1.4, 3.6);
        X.wob = rnd(1.6, 2.6); X.wobF = rnd(1.5, 2.5); X.drag = 0.3; X.tw = 1; X.twF = rnd(2.4, 4.6); X.fin = 0.2; X.fout = 0.6;
        emit(F.dot, 0, x + Math.cos(an) * r, y + rnd(0.5, 5.5), z + Math.sin(an) * r, rnd(-0.8, 0.8), rnd(-0.4, 0.6), rnd(-0.8, 0.8), 3.2, 1.5, 1.3, 0xf6ff2a, 0xa8e020);
        X.wob = 0; X.tw = 0; X.fin = 0.2; X.fout = 0.6; X.a0 = 0.3;
        emit(F.glow, 1, x + Math.cos(an) * r, y + rnd(0.5, 5.5), z + Math.sin(an) * r, 0, 0, 0, 1.0, 1.2, 1.2, 0xe9ff6a, 0xe9ff6a);
      } }
    ]),
    aura('bubbles', 'Мыльные пузыри', 'Soap Bubbles', 0, ['#bfe8ff', '#d8ffee', '#ffd8f4'], [
      { rate: 4, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.6, 2.0), s = rnd(0.6, 1.5);
        X.wob = 1.3; X.wobF = rnd(1.5, 3); X.fin = 0.1; X.fout = 0.82; X.a0 = 0.9;
        emit1(F.bubble, 1, x + Math.cos(an) * r, y + rnd(0.3, 3.5), z + Math.sin(an) * r, rnd(-0.4, 0.4), rnd(2.4, 4), rnd(-0.4, 0.4), rnd(1.7, 2.4), s, s * 1.25, pick([0xbfe8ff, 0xd8ffee, 0xffd8f4, 0xffffff]));
      } }
    ]),
    aura('leaves', 'Вихрь листьев', 'Leaf Swirl', 0, ['#4ade4a', '#b6e84a', '#ff9a3a'], [
      { rate: 6, fn: function (a, x, y, z) {
        orbitX(a, rnd(0.2, 1.2), rnd(1.8, 2.4), rnd(2.6, 3.4), 0);
        X.spin = rnd(-5, 5); X.flip = rnd(3, 6); X.fin = 0.15; X.fout = 0.6;
        var g = pick([0x3ecb4a, 0x7be04f, 0xb6e84a, 0x2f9e44, 0xe8a23a, 0xd4e04a]);
        emit1(F.leaf, 0, 0, 0, 0, a.dir * rnd(2.4, 3.6), rnd(1.6, 2.8), rnd(0, TAU), rnd(2.0, 2.6), rnd(0.9, 1.4), rnd(0.9, 1.4), g);
      } }
    ]),
    aura('hearts', 'Парящие сердца', 'Floating Hearts', 1, ['#ff6fa8', '#ff4d6d', '#ffa3c4'], [
      { rate: 3.5, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(1.2, 2.2), s = rnd(1.1, 1.9);
        X.wob = 2.6; X.wobF = rnd(2, 3.4); X.rr = 0; X.rot = rnd(-0.3, 0.3); X.spin = rnd(-0.4, 0.4); X.fin = 0.15; X.fout = 0.6;
        emit1(F.heart, 0, x + Math.cos(an) * r, y + rnd(0.8, 3.5), z + Math.sin(an) * r, 0, rnd(2.6, 4), 0, rnd(1.6, 2.1), s, s * 1.15, pick([0xff6fa8, 0xff4d6d, 0xffa3c4, 0xff8fb8]));
      } }
    ]),
    aura('snowcloud', 'Снежная тучка', 'Snow Cloud', 1, ['#ffffff', '#cfe8ff', '#8fd8ff'], [
      { rate: 1.4, fn: function (a, x, y, z) {
        orbitX(a, 8.2 + rnd(-0.2, 0.4), rnd(0.2, 1.1), rnd(0.2, 1.1), 0);
        X.fin = 0.35; X.fout = 0.6; X.a0 = 0.95; X.spin = rnd(-0.2, 0.2);
        emit1(F.cloud, 0, 0, 0, 0, a.dir * rnd(0.5, 1.0), 0, rnd(0, TAU), 2.8, rnd(3.4, 4.6), rnd(3.4, 4.6), 0xf4f8ff);
      } },
      { rate: 14, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0, 1.7);
        X.wob = 1.6; X.spin = rnd(-3, 3); X.fout = 0.5; X.a0 = 0.9;
        emit1(Math.random() < 0.5 ? F.flake : F.disc, 1, x + Math.cos(an) * r, y + 7.4, z + Math.sin(an) * r, rnd(-0.5, 0.5), -rnd(3.5, 5.5), rnd(-0.5, 0.5), 1.8, rnd(0.45, 0.8), rnd(0.4, 0.7), 0xffffff);
      } }
    ]),
    aura('notes', 'Музыкальные ноты', 'Music Notes', 1, ['#ff6ad5', '#35b6ff', '#ffd23f'], [
      { rate: 3.2, fn: function (a, x, y, z) {
        var r = rnd(1.6, 2.2);
        orbitX(a, rnd(0.5, 2), r, r + 1, 0);
        X.rr = 0; X.rot = rnd(-0.35, 0.35); X.fin = 0.15; X.fout = 0.6;
        emit1(Math.random() < 0.5 ? F.note : F.note2, 0, 0, 0, 0, a.dir * rnd(1.6, 2.4), rnd(1.4, 2.4), rnd(0, TAU), 2.3, rnd(1.4, 2.0), rnd(1.4, 2.0), hsv(Math.random(), 0.65, 1));
      } }
    ]),
    aura('candy', 'Конфетный вихрь', 'Candy Swirl', 1, ['#ff9ad0', '#9ae8ff', '#ffe27a'], [
      { rate: 6, fn: function (a, x, y, z) {
        orbitX(a, rnd(0.3, 1.6), rnd(1.7, 2.3), rnd(2.4, 3.2), 0);
        X.spin = rnd(-6, 6); X.fin = 0.15; X.fout = 0.6;
        emit1(F.sprinkle, 0, 0, 0, 0, a.dir * rnd(2.2, 3.2), rnd(1.4, 2.4), rnd(0, TAU), rnd(1.8, 2.3), 1.0, 1.0, pick([0xff6ab4, 0x5ad8ff, 0xffe14a, 0x8aff7a, 0xffffff, 0xc58bff]));
      } },
      { rate: 1.3, fn: function (a, x, y, z) {
        orbitX(a, rnd(0.6, 2.2), 2.4, 3, 0);
        X.spin = rnd(-3, 3); X.fin = 0.15; X.fout = 0.6;
        emit1(F.candy, 0, 0, 0, 0, a.dir * rnd(1.8, 2.6), rnd(1.0, 1.8), rnd(0, TAU), 2.2, 1.7, 1.7, pick([0xff7ac0, 0x6ad8ff, 0xffd24a, 0xa88aff]));
      } },
      { rate: 3, fn: function (a, x, y, z) {
        X.tw = 0.7; X.twF = 14; X.fout = 0.5;
        emit1(F.sparkle, 1, x + rnd(-2, 2), y + rnd(0.5, 4.5), z + rnd(-2, 2), 0, rnd(0.5, 1.5), 0, rnd(0.6, 0.9), 1.1, 0.2, pick(PAL_PASTEL));
      } }
    ]),
    aura('petals', 'Лепестки сакуры', 'Cherry Petals', 1, ['#ffb7d5', '#ff8fb8', '#ffe0ee'], [
      { rate: 7, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.5, 3);
        X.wob = 3; X.wobF = rnd(2, 3.5); X.flip = rnd(2, 5); X.spin = rnd(-3, 3); X.fin = 0.15; X.fout = 0.6; X.drag = 0.4;
        emit1(F.petal, 0, x + Math.cos(an) * r, y + rnd(3, 7), z + Math.sin(an) * r, rnd(-0.6, 0.6), -rnd(1.6, 2.6), rnd(-0.6, 0.6), rnd(2.0, 2.6), rnd(0.9, 1.4), rnd(0.9, 1.4),
          pick([0xffb7d5, 0xff8fb8, 0xffe0ee, 0xffffff]));
      } }
    ]),
    aura('flames', 'Огненная аура', 'Fire Aura', 2, ['#ffb02e', '#ff5a1f', '#ffee80'], [
      { rate: 22, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.4, 1.6), s = rnd(2.0, 3.2);
        flameP(x + Math.cos(an) * r, y + rnd(0.2, 2.8), z + Math.sin(an) * r, rnd(-0.8, 0.8), rnd(3.5, 7), rnd(-0.8, 0.8), rnd(0.55, 0.85), s);
      } },
      { rate: 5, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.4, 1.6);
        X.wob = 3; X.drag = 0.5; X.fout = 0.5; X.tw = 0.4; X.twF = 12;
        emit(F.ember, 0, x + Math.cos(an) * r, y + rnd(0.5, 3), z + Math.sin(an) * r, rnd(-1, 1), rnd(6, 10), rnd(-1, 1), rnd(0.9, 1.3), 0.8, 0.3, 0xffb030, 0xff4010);
      } },
      { rate: 2, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.2, 1.0);
        X.drag = 0.6; X.wob = 1.2; X.a0 = 0.26; X.fin = 0.2; X.fout = 0.4;
        emit(F.smoke, 0, x + Math.cos(an) * r, y + rnd(3, 5), z + Math.sin(an) * r, rnd(-0.5, 0.5), rnd(2, 3), rnd(-0.5, 0.5), 1.4, 1.8, 3.8, 0x5a5050, 0x302a2a);
      } }
    ]),
    aura('stars', 'Падающие звёзды', 'Falling Stars', 2, ['#ffe27a', '#fff6c0', '#ffb02e'], [
      { rate: 7, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(1.5, 3.8), sx = x + Math.cos(an) * r, sy = y + rnd(6.5, 9), sz = z + Math.sin(an) * r;
        var vx = rnd(-1.5, 1.5), vy = -rnd(7, 11), vz = rnd(-1.5, 1.5);
        X.spin = rnd(-3, 3); X.fin = 0.1; X.fout = 0.65;
        emit(F.star, 1, sx, sy, sz, vx, vy, vz, 1.0, 1.15, 0.7, 0xfff6c0, 0xffb02e);
        X.mode = 1; X.stretch = 0.25; X.fin = 0.1; X.fout = 0.6; X.a0 = 0.8;
        emit(F.streak, 1, sx - vx * 0.13, sy - vy * 0.13, sz - vz * 0.13, vx, vy, vz, 1.0, 0.6, 0.3, 0xfff0a0, 0xff9a20);
      } },
      { rate: 3, fn: function (a, x, y, z) {
        X.tw = 0.8; X.twF = 14; X.fout = 0.5;
        emit(F.sparkle, 1, x + rnd(-2.5, 2.5), y + rnd(0.5, 6), z + rnd(-2.5, 2.5), 0, 0.5, 0, rnd(0.6, 1.0), 1.2, 0.2, 0xffffff, 0xffd45a);
      } }
    ]),
    aura('glitter', 'Золотые блёстки', 'Golden Glitter', 2, ['#ffd24a', '#fff3b0', '#ffb02e'], [
      { rate: 22, fn: function (a, x, y, z) {
        dirSphere();
        var r = rnd(0.5, 1.8);
        X.tw = 0.9; X.twF = rnd(10, 20); X.spin = rnd(-3, 3); X.fout = 0.5; X.fin = 0.15;
        emit(F.sparkle, 1, x + DX * r, y + 2.6 + DY * r * 2.2, z + DZ * r, DX * 0.5, rnd(0.5, 1.6), DZ * 0.5, rnd(0.55, 0.95), rnd(0.5, 1.2), 0.2, pick([0xffffff, 0xfff3b0, 0xffd24a, 0xffc83d]), 0xffb02e);
      } },
      { rate: 2, fn: function (a, x, y, z) {
        dirSphere();
        X.tw = 0.6; X.twF = 9; X.spin = rnd(-1, 1); X.fout = 0.5;
        emit(F.sparkle, 1, x + DX * 1.8, y + 2.6 + DY * 2.6, z + DZ * 1.8, 0, rnd(0.4, 1), 0, rnd(0.9, 1.3), 1.9, 0.5, 0xffffff, 0xffd24a);
      } }
    ]),
    aura('ghost', 'Призрачные огоньки', 'Ghost Wisps', 2, ['#bff6ff', '#7ad0ff', '#e6f4ff'], [
      { rate: 2.2, fn: function (a, x, y, z) {
        orbitX(a, rnd(1, 4.5), rnd(2.3, 3.1), rnd(2.3, 3.1), 0);
        X.fin = 0.25; X.fout = 0.6; X.a0 = 0.8;
        emit(F.wisp, 1, 0, 0, 0, a.dir * rnd(1.1, 1.7), rnd(-0.3, 0.5), rnd(0, TAU), 3.0, rnd(2.4, 3.2), rnd(2.0, 2.8), 0xbff6ff, 0x7ad0ff);
      } },
      { rate: 0.8, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(1.4, 2.6);
        X.wob = 1.4; X.wobF = 1.6; X.rr = 0; X.rot = rnd(-0.2, 0.2); X.fin = 0.3; X.fout = 0.6; X.a0 = 0.55;
        emit(F.ghost, 1, x + Math.cos(an) * r, y + rnd(0.6, 2.4), z + Math.sin(an) * r, 0, rnd(0.6, 1.2), 0, 2.4, 2.2, 2.6, 0xd8f4ff, 0x9ad8ff);
      } },
      { rate: 6, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.6, 2.8);
        X.wob = 0.8; X.tw = 0.6; X.twF = 5; X.fout = 0.5;
        emit(F.dot, 1, x + Math.cos(an) * r, y + rnd(0.5, 4), z + Math.sin(an) * r, 0, rnd(-0.6, 0.6), 0, rnd(1, 1.6), 0.5, 0.15, 0xcfeeff, 0x7ad0ff);
      } }
    ]),
    aura('frost', 'Ледяные кристаллы', 'Frost Crystals', 2, ['#bfeaff', '#ffffff', '#6ec8ff'], [
      { rate: 3.5, fn: function (a, x, y, z) {
        orbitX(a, rnd(0.6, 4), rnd(2.0, 2.6), rnd(3.0, 3.8), 0);
        X.spin = rnd(-2, 2); X.fin = 0.2; X.fout = 0.6;
        emit(F.flake, 1, 0, 0, 0, a.dir * rnd(0.8, 1.2), rnd(-0.4, 0.4), rnd(0, TAU), 2.5, rnd(0.9, 1.5), rnd(0.8, 1.3), 0xe6f6ff, 0x9ad8ff);
      } },
      { rate: 2, fn: function (a, x, y, z) {
        orbitX(a, rnd(1, 4), 2.4, 2.8, 0);
        X.spin = rnd(-2, 2); X.fin = 0.2; X.fout = 0.6; X.a0 = 0.92;
        emit1(F.shard, 0, 0, 0, 0, a.dir * rnd(1, 1.5), rnd(-0.2, 0.3), rnd(0, TAU), 2.4, 1.0, 0.9, 0xcdf1ff);
      } },
      { rate: 5, fn: function (a, x, y, z) {
        X.tw = 0.9; X.twF = rnd(10, 18); X.fout = 0.5;
        emit(F.sparkle, 1, x + rnd(-2.4, 2.4), y + rnd(0.4, 5), z + rnd(-2.4, 2.4), 0, rnd(-0.4, 0.5), 0, rnd(0.5, 0.9), rnd(0.9, 1.5), 0.2, 0xffffff, 0x8fd8ff);
      } },
      { rate: 3, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, sp = rnd(1.2, 2.2);
        X.drag = 0.6; X.a0 = 0.24; X.fin = 0.2; X.fout = 0.45;
        emit(F.smoke, 0, x + Math.cos(an) * 0.8, y + 0.4, z + Math.sin(an) * 0.8, Math.cos(an) * sp, 0.1, Math.sin(an) * sp, 1.6, 2.0, 4.5, 0xd8f0ff, 0xbfe3ff);
      } }
    ]),
    aura('lightning', 'Искры молний', 'Lightning Sparks', 3, ['#9fd8ff', '#ffffff', '#fff06a'], [
      { rate: 9, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.8, 2.6);
        X.fin = 0; X.fout = 0.5; X.tw = 0.5; X.twF = 40;
        emit(F.bolt, 1, x + Math.cos(an) * r, y + rnd(0.5, 5), z + Math.sin(an) * r, 0, 0, 0, rnd(0.16, 0.3), rnd(1.8, 3.4), rnd(1.6, 2.8), 0x3aa0ff, 0x2a6aff);
      } },
      { rate: 14, fn: function (a, x, y, z) {
        dirSphere();
        var sp = rnd(6, 14);
        X.mode = 1; X.stretch = 0.1; X.drag = 3.5; X.fin = 0; X.fout = 0.4;
        emit(F.streak, 1, x + DX * 1.2, y + 2.6 + DY * 2, z + DZ * 1.2, DX * sp, DY * sp, DZ * sp, 0.3, 0.4, 0.14, 0xffc820, 0x3a8aff);
      } },
      { rate: 2.5, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.8, 1.8);
        var p0x = x + Math.cos(an) * r, p0y = y + rnd(1, 4), p0z = z + Math.sin(an) * r;
        var d1x = rnd(-1.4, 1.4), d1y = rnd(-1.2, 1.2), d1z = rnd(-1.4, 1.4), d2x = rnd(-1.4, 1.4), d2y = rnd(-1.2, 1.2), d2z = rnd(-1.4, 1.4);
        X.mode = 4; X.move = 2; X.fin = 0; X.fout = 0.5;
        emit(F.seg, 1, p0x + d1x * 0.5, p0y + d1y * 0.5, p0z + d1z * 0.5, d1x, d1y, d1z, 0.2, 0.5, 0.5, 0x4aa8ff, 0x2a6aff);
        X.mode = 4; X.move = 2; X.fin = 0; X.fout = 0.5;
        emit(F.seg, 1, p0x + d1x + d2x * 0.5, p0y + d1y + d2y * 0.5, p0z + d1z + d2z * 0.5, d2x, d2y, d2z, 0.2, 0.5, 0.5, 0x4aa8ff, 0x2a6aff);
      } }
    ]),
    aura('rainbow', 'Радужное кольцо', 'Rainbow Ring', 3, ['#ff4040', '#ffe14a', '#3fb6ff'], [
      { rate: 22, fn: function (a, x, y, z) {
        var ph = Math.random() * TAU, r = 2.5 + rnd(-0.12, 0.12);
        orbitX(a, 2.4 + rnd(-0.25, 0.25), r, r, 0);
        X.fin = 0.25; X.fout = 0.5;
        var c = hsv(ph / TAU + now * 0.15, 0.85, 1);
        emit1(F.dot, 1, 0, 0, 0, a.dir * 2.8, 0.25, ph, 1.4, 0.8, 0.8, c);
      } },
      { rate: 1.6, fn: function (a, x, y, z) {
        orbitX(a, 0.2, 0, 0, 0);
        X.mode = 2; X.fin = 0.25; X.fout = 0.6; X.a0 = 0.6; X.spin = 1.2;
        emit1(F.ring, 1, 0, 0, 0, 0, 0, 0, 0.9, 6.0, 7.2, hsv(now * 0.3, 0.7, 1));
      } }
    ]),
    aura('coins', 'Орбита монет', 'Coin Orbit', 3, ['#ffc83d', '#ffe27a', '#ffffff'], [
      { rate: 2.4, fn: function (a, x, y, z) {
        orbitX(a, rnd(1.5, 3.2), 2.6, 2.6, 0);
        X.flip = rnd(4, 6); X.spin = rnd(-1, 1); X.fin = 0.2; X.fout = 0.7;
        emit1(F.coin, 0, 0, 0, 0, a.dir * 2.0, 0, rnd(0, TAU), 2.8, 1.5, 1.5, pick([0xffc83d, 0xffd860]));
      } },
      { rate: 5, fn: function (a, x, y, z) {
        orbitX(a, rnd(1.2, 3.4), 2.6, 2.6, 0);
        X.tw = 0.8; X.twF = 14; X.spin = rnd(-2, 2); X.fin = 0.2; X.fout = 0.5;
        emit(F.sparkle, 1, 0, 0, 0, a.dir * 2.0, 0, rnd(0, TAU), 1.0, rnd(0.7, 1.2), 0.2, 0xffffff, 0xffc83d);
      } }
    ]),
    aura('shadow', 'Теневой дым', 'Shadow Smoke', 3, ['#6a2cff', '#2a1346', '#b04bff'], [
      { rate: 9, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.3, 1.4);
        X.drag = 0.4; X.wob = 1.6; X.a0 = 0.62; X.fin = 0.15; X.fout = 0.5;
        emit(F.smoke, 0, x + Math.cos(an) * r, y + rnd(0.1, 3), z + Math.sin(an) * r, Math.cos(an) * 0.7, rnd(1.6, 3.2), Math.sin(an) * 0.7, 1.5, 1.6, 3.6, 0x2a1346, 0x0d0618);
      } },
      { rate: 2.5, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(0.4, 1.6);
        X.wob = 2.2; X.tw = 0.6; X.twF = 7; X.fout = 0.5;
        emit(F.ember, 1, x + Math.cos(an) * r, y + rnd(0.5, 3.5), z + Math.sin(an) * r, 0, rnd(1.4, 3), 0, rnd(0.9, 1.4), 1.0, 0.4, 0xc060ff, 0x6a2cff);
      } },
      { rate: 0.9, fn: function (a, x, y, z) {
        var an = Math.random() * TAU, r = rnd(1.2, 2.2);
        X.wob = 1; X.tw = 0.5; X.twF = 5; X.fout = 0.5;
        emit(F.sparkle, 1, x + Math.cos(an) * r, y + rnd(1, 4), z + Math.sin(an) * r, 0, 0.4, 0, 1.0, 1.3, 0.3, 0xff6a9a, 0xb02060);
      } }
    ]),
    aura('galaxy', 'Галактика', 'Galaxy', 4, ['#b58cff', '#7aa8ff', '#ff9be8'], [
      { rate: 46, fn: function (a, x, y, z) {
        var arm = (Math.random() < 0.5 ? 0 : PI) + now * 0.5 + rnd(-0.4, 0.4);
        orbitX(a, 2.8, rnd(4.4, 5.0), rnd(0.6, 1.1), 0.75);
        X.fin = 0.15; X.fout = 0.55;
        emit(F.dot, 1, 0, 0, 0, a.dir * rnd(3.2, 3.6), 0, arm, 2.0, rnd(0.6, 1.1), 0.3, pick([0xb58cff, 0x7aa8ff, 0xff9be8, 0xffffff, 0xc7b0ff]), 0x6a3cff);
      } },
      { rate: 1.1, fn: function (a, x, y, z) {
        orbitX(a, 2.6, 0, 0, 0);
        X.fin = 0.4; X.fout = 0.5; X.a0 = 0.28;
        emit1(F.glow, 1, 0, 0, 0, 0, 0, 0, 2.0, 7.5, 8.5, 0x9a6cff);
      } },
      { rate: 3, fn: function (a, x, y, z) {
        orbitX(a, 2.8, rnd(3.8, 4.8), rnd(1.2, 2.2), 0.75);
        X.tw = 0.7; X.twF = 12; X.spin = rnd(-2, 2); X.fin = 0.15; X.fout = 0.5;
        emit(F.sparkle, 1, 0, 0, 0, a.dir * rnd(3.0, 3.6), 0, rnd(0, TAU), 1.8, rnd(1.0, 1.6), 0.3, 0xffffff, 0xb58cff);
      } }
    ]),
    aura('sun', 'Лучи солнца', 'Sun Rays', 4, ['#ffd24a', '#ff9a20', '#fff3b0'], [
      { rate: 1.2, fn: function (a, x, y, z) {
        orbitX(a, 3.2, 0, 0, 0);
        X.fin = 0.4; X.fout = 0.5; X.a0 = 0.34;
        emit(F.glow, 1, 0, 0, 0, 0, 0, 0, 1.6, 7, 9, 0xffd24a, 0xff9a20);
      } },
      { rate: 0.9, fn: function (a, x, y, z) {
        orbitX(a, 3.6, 0, 0, 0);
        X.fin = 0.4; X.fout = 0.5; X.a0 = 0.42; X.spin = 0.55;
        emit(F.rays, 1, 0, 0, 0, 0, 0, 0, 2.4, 9.5, 10.5, 0xffe27a, 0xffb02e);
      } },
      { rate: 12, fn: function (a, x, y, z) {
        dirDisc();
        var sp = rnd(7, 11);
        X.mode = 1; X.stretch = 0.12; X.drag = 0.6; X.fin = 0.05; X.fout = 0.5; X.a0 = 0.9;
        emit(F.streak, 1, x + DX * 1.3, y + rnd(1, 4.5), z + DZ * 1.3, DX * sp, rnd(-1, 2), DZ * sp, 0.55, 0.38, 0.12, 0xffe27a, 0xff9a20);
      } },
      { rate: 6, fn: function (a, x, y, z) {
        X.tw = 0.8; X.twF = 12; X.fout = 0.5; X.spin = rnd(-2, 2);
        emit(F.sparkle, 1, x + rnd(-1.8, 1.8), y + rnd(0.5, 4), z + rnd(-1.8, 1.8), 0, rnd(1, 2.4), 0, rnd(0.7, 1.1), rnd(1.0, 1.7), 0.2, 0xffffff, 0xffc83d);
      } }
    ])
  ];

  function updateAuras(dt) {
    for (var i = 0; i < auras.length; i++) {
      var a = auras[i], t = a.target;
      if (!t) continue;
      var px, py, pz;
      if (t.parent === scene || !t.parent) { px = t.position.x; py = t.position.y; pz = t.position.z; }
      else { var e = t.matrixWorld.elements; px = e[12]; py = e[13]; pz = e[14]; }
      ancX[a.slot] = px; ancY[a.slot] = py; ancZ[a.slot] = pz;
      var chs = AURA_IMPL[a.id];
      PRIO = 1; SIZE_K = AURA_SIZE; RAD_K = AURA_RAD;
      for (var c = 0; c < chs.length; c++) {
        a.acc[c] += chs[c].rate * AURA_RATE * QS * dt;
        var guard = 0;
        while (a.acc[c] >= 1 && guard++ < 8) { a.acc[c] -= 1; chs[c].fn(a, px, py, pz); }
        if (a.acc[c] > 2) a.acc[c] = 0;
      }
      /* soft coloured disc on the ground under the feet: gives every aura a readable colour identity */
      SIZE_K = 1; RAD_K = 1;
      a.acc[5] += 1.3 * QS * dt;
      if (a.acc[5] >= 1) {
        a.acc[5] -= 1;
        orbitX(a, 0.14, 0, 0, 0);
        X.mode = 2; X.fin = 0.4; X.fout = 0.5; X.a0 = 0.34;
        emit1(F.glow, 1, 0, 0, 0, 0, 0, 0, 1.7, 8, 9, AURA_GLOW[a.id]);
      }
      PRIO = 2;
    }
  }
  function setAura(id, target) {
    if (!inited) { pendingAura = { id: id, target: target }; return; }
    var i;
    for (i = auras.length - 1; i >= 0; i--) {
      if (!target || auras[i].target === target) auras.splice(i, 1);
    }
    if (!id || !target || !AURA_IMPL[id]) return;
    if (auras.length >= 4) auras.shift();
    nextSlot = (nextSlot + 1) & 7;
    var a = { id: id, target: target, slot: nextSlot, acc: new Float32Array(6), dir: 1 };
    auras.push(a);
    /* start with the anchor already on the target so the first particles are in place */
    var tt = target;
    if (tt.parent === scene || !tt.parent) { ancX[a.slot] = tt.position.x; ancY[a.slot] = tt.position.y; ancZ[a.slot] = tt.position.z; }
    else { var e = tt.matrixWorld.elements; ancX[a.slot] = e[12]; ancY[a.slot] = e[13]; ancZ[a.slot] = e[14]; }
    for (i = 0; i < 6; i++) a.acc[i] = Math.random();
  }

  /* ============================================================== victories */
  var VICT_IMPL = {};
  var PAL_BALLOON = [0xff4d6d, 0xffd23f, 0x3bd16f, 0x35b6ff, 0xb46bff, 0xff8a3d, 0xff6ad5];
  var PAL_PINK = [0xff6fa8, 0xff4d6d, 0xffa3c4, 0xff8fb8, 0xffffff];

  function vict(id, ru, en, rarity, colors, fn) {
    VICT_IMPL[id] = fn;
    return { id: id, name: { en: en, ru: ru, tr: TR_NAMES[id] || en }, rarity: rarity, colors: colors };
  }
  /* time until something thrown with (vy0, gravity g<0) from height h above the floor lands */
  function fallTime(vy0, g, h) { return (Math.sqrt(vy0 * vy0 - 2 * g * h) + vy0) / (-g); }

  /* lightning bolt polyline stored here so re-strikes reuse the same path */
  var BOLT = new Float32Array(3 * 16);
  function boltPath(x0, y0, z0, x1, y1, z1, segs, jit) {
    for (var s = 0; s <= segs; s++) {
      var f = s / segs, edge = (s === 0 || s === segs) ? 0 : 1;
      BOLT[s * 3] = lerp(x0, x1, f) + edge * rnd(-jit, jit);
      BOLT[s * 3 + 1] = lerp(y0, y1, f);
      BOLT[s * 3 + 2] = lerp(z0, z1, f) + edge * rnd(-jit, jit);
    }
  }
  function boltDraw(segs, delay, life, width, a0) {
    for (var s = 1; s <= segs; s++) {
      var ax = BOLT[s * 3] - BOLT[(s - 1) * 3], ay = BOLT[s * 3 + 1] - BOLT[(s - 1) * 3 + 1], az = BOLT[s * 3 + 2] - BOLT[(s - 1) * 3 + 2];
      var cx = (BOLT[s * 3] + BOLT[(s - 1) * 3]) * 0.5, cy = (BOLT[s * 3 + 1] + BOLT[(s - 1) * 3 + 1]) * 0.5, cz = (BOLT[s * 3 + 2] + BOLT[(s - 1) * 3 + 2]) * 0.5;
      ax *= 1.2; ay *= 1.2; az *= 1.2;
      X.mode = 4; X.move = 2; X.delay = delay; X.fin = 0; X.fout = 0.3; X.a0 = 0.4 * a0;
      emit(F.seg, 1, cx, cy, cz, ax, ay, az, life, width * 4.5, width * 4.5, 0x4a9aff, 0x2a60ff);
      X.mode = 4; X.move = 2; X.delay = delay; X.fin = 0; X.fout = 0.3; X.a0 = a0;
      emit(F.seg, 1, cx, cy, cz, ax, ay, az, life, width, width * 0.8, 0xffffff, 0xcfe6ff);
    }
  }

  var VICTORY_LIST = [
    vict('confetti_cannon', 'Хлопушка', 'Confetti Cannon', 0, ['#ff4d6d', '#ffd23f', '#35b6ff'], function (x, y, z) {
      for (var side = -1; side <= 1; side += 2) {
        var mx = x + camRX * side * 4.4 + camFX * 1.0, mz = z + camRZ * side * 4.4 + camFZ * 1.0, my = y + 1.0;
        var d0 = side > 0 ? 0 : 0.12, v, i, n;
        flash(mx, my + 0.6, mz, 2, 8, 0.22, 0xfff2c0, 0.9, d0);
        ringFace(mx, my + 0.6, mz, 0.3, 2.6, 0.26, 0xffffff, 0.8, false, d0);
        for (v = 0; v < 2; v++) {
          n = N(44);
          for (i = 0; i < n; i++) {
            var ix = -side * camRX * 0.55 + rnd(-0.22, 0.22), iz = -side * camRZ * 0.55 + rnd(-0.22, 0.22), iy = 1 + rnd(-0.2, 0.25);
            var il = Math.sqrt(ix * ix + iy * iy + iz * iz), sp = rnd(24, 40) / il;
            X.grav = -17; X.drag = 2.8; X.flip = rnd(7, 14); X.spin = rnd(-5, 5); X.fout = 0.72; X.fin = 0.01; X.delay = d0 + v * 0.34 + rnd(0, 0.05);
            emit1(F.confetti, 0, mx, my, mz, ix * sp, iy * sp, iz * sp, rnd(2.0, 3.0), rnd(0.9, 1.5), rnd(0.9, 1.5), pick(PAL_CONF));
          }
          n = N(8);
          for (i = 0; i < n; i++) {
            var jx = -side * camRX * 0.5 + rnd(-0.3, 0.3), jz = -side * camRZ * 0.5 + rnd(-0.3, 0.3), jy = 1 + rnd(-0.3, 0.3), jl = Math.sqrt(jx * jx + jy * jy + jz * jz), sp2 = rnd(26, 36) / jl;
            X.mode = 1; X.stretch = 0.05; X.grav = -17; X.drag = 2.6; X.fout = 0.7; X.delay = d0 + v * 0.34 + rnd(0, 0.05);
            emit1(F.confetti, 0, mx, my, mz, jx * sp2, jy * sp2, jz * sp2, rnd(1.8, 2.6), 0.55, 0.5, pick(PAL_CONF));
          }
        }
        n = N(8);
        for (i = 0; i < n; i++) {
          dirSphere();
          X.drag = 3; X.delay = d0; X.fout = 0.4;
          emit(F.sparkle, 1, mx, my + 0.6, mz, DX * 6, Math.abs(DY) * 6 + 2, DZ * 6, rnd(0.4, 0.7), rnd(0.9, 1.5), 0.1, 0xffffff, 0xffd23f);
        }
      }
    }),

    vict('balloons', 'Полёт шаров', 'Balloon Release', 0, ['#ff4d6d', '#35b6ff', '#ffd23f'], function (x, y, z) {
      var n = N(14), i;
      for (i = 0; i < n; i++) {
        var an = (i / n) * TAU + rnd(-0.3, 0.3), r = rnd(1.5, 5.5), s = rnd(3.0, 3.8), d = rnd(0, 1.1);
        X.wob = 1.3; X.wobF = rnd(1.2, 2.2); X.rr = 0; X.rot = rnd(-0.15, 0.15); X.fout = 0.75; X.fin = 0.05; X.delay = d;
        emit1(F.balloon, 0, x + Math.cos(an) * r, y + 2.4, z + Math.sin(an) * r, rnd(-0.3, 0.3), rnd(5, 7.5), rnd(-0.3, 0.3), 4.4, s, s * 1.05, pick(PAL_BALLOON));
        X.drag = 3; X.delay = d; X.fout = 0.4;
        emit(F.sparkle, 1, x + Math.cos(an) * r, y + 2.0, z + Math.sin(an) * r, 0, 2, 0, 0.5, 1.4, 0.2, 0xffffff, 0xffe27a);
      }
      ringFlat(x, y, z, 1, 10, 0.7, 0xffe27a, 0.7, false);
    }),

    vict('bubble_burst', 'Взрыв пузырей', 'Bubble Burst', 0, ['#bfe8ff', '#d8ffee', '#ffd8f4'], function (x, y, z) {
      var n = N(42), i;
      flash(x, y + 3, z, 3, 14, 0.3, 0xcfeaff, 0.7);
      ringFace(x, y + 3, z, 0.5, 6, 0.4, 0xffffff, 0.8, false);
      for (i = 0; i < n; i++) {
        dirSphere();
        var sp = rnd(6, 16), s = rnd(0.8, 2.6);
        X.drag = 2.4; X.grav = 2.5; X.wob = 1.2; X.wobF = rnd(1.5, 3); X.fin = 0.05; X.fout = 0.86; X.a0 = 0.9;
        emit1(F.bubble, 1, x, y + 3, z, DX * sp, DY * sp + 2, DZ * sp, rnd(1.8, 2.8), s, s * 1.2, pick([0xbfe8ff, 0xd8ffee, 0xffd8f4, 0xffffff, 0xfff3c0]));
      }
      n = N(16);
      for (i = 0; i < n; i++) {
        dirSphere();
        X.drag = 3; X.tw = 0.6; X.twF = 16; X.fout = 0.5;
        emit(F.sparkle, 1, x, y + 3, z, DX * 8, DY * 8, DZ * 8, rnd(0.5, 0.9), rnd(0.9, 1.5), 0.1, 0xffffff, 0xbfe8ff);
      }
    }),

    vict('snow_burst', 'Снежный взрыв', 'Snow Burst', 0, ['#ffffff', '#cfe8ff', '#8fd8ff'], function (x, y, z) {
      var n, i;
      flash(x, y + 3, z, 4, 16, 0.35, 0xcfeaff, 0.8);
      ringFlat(x, y, z, 1, 17, 0.8, 0xcfeaff, 0.9, true);
      ringFlat(x, y, z, 1, 10, 0.55, 0xffffff, 0.8, false, 0.08);
      n = N(7);
      for (i = 0; i < n; i++) {
        var an = (i / n) * TAU + rnd(-0.3, 0.3), sp = rnd(6, 12);
        dust(x + Math.cos(an), y + 1, z + Math.sin(an), Math.cos(an) * sp, rnd(1, 3), Math.sin(an) * sp, rnd(0.8, 1.2), 2.2, 6.5, 0xf4faff, 0.6);
      }
      n = N(70);
      for (i = 0; i < n; i++) {
        dirSphere();
        var s2 = rnd(8, 22);
        X.drag = 2.1; X.grav = -3.2; X.wob = 2.5; X.spin = rnd(-4, 4); X.fout = 0.65; X.fin = 0.03;
        emit1(Math.random() < 0.6 ? F.flake : F.disc, 0, x, y + 3, z, DX * s2, DY * s2 * 0.6 + 6, DZ * s2, rnd(2.2, 3.4), rnd(0.6, 1.3), rnd(0.5, 1.1), 0xf2faff);
      }
      n = N(26);
      for (i = 0; i < n; i++) {
        dirSphere();
        var s3 = rnd(6, 16);
        X.drag = 2.4; X.tw = 0.8; X.twF = rnd(10, 18); X.fout = 0.55; X.spin = rnd(-2, 2);
        emit(F.sparkle, 1, x, y + 3, z, DX * s3, DY * s3 * 0.6 + 4, DZ * s3, rnd(1.2, 2.2), rnd(1.0, 1.8), 0.3, 0xffffff, 0x8fd8ff);
      }
      n = N(9);
      for (i = 0; i < n; i++) {
        dirDisc();
        var s4 = rnd(4, 11);
        X.grav = -36; X.flip = rnd(3, 7); X.spin = rnd(-6, 6); X.fy = y + 0.5; X.bounce = 0.3; X.fout = 0.6;
        emit1(F.shard, 0, x, y + 2, z, DX * s4, rnd(10, 17), DZ * s4, 1.5, rnd(1.1, 1.7), rnd(1.1, 1.7), 0xcdf1ff);
      }
    }),

    vict('heart_explosion', 'Взрыв сердец', 'Heart Explosion', 1, ['#ff6fa8', '#ff4d6d', '#ffa3c4'], function (x, y, z) {
      var n, i;
      flash(x, y + 4.5, z, 4, 20, 0.4, 0xff8fb8, 0.85);
      ringFlat(x, y, z, 1, 14, 0.8, 0xff6fa8, 0.9, true);
      n = N(34);
      for (i = 0; i < n; i++) {
        dirSphere();
        var sp = rnd(8, 17), s = rnd(1.3, 2.6);
        X.drag = 2.3; X.grav = 1.5; X.wob = 1.4; X.rr = 0; X.rot = rnd(-0.4, 0.4); X.spin = rnd(-0.6, 0.6); X.fout = 0.6;
        emit1(F.heart, 0, x, y + 4.5, z, DX * sp, DY * sp, DZ * sp, rnd(1.7, 2.4), s, s * 1.2, pick(PAL_PINK));
      }
      n = N(30);
      for (i = 0; i < n; i++) {
        var t = (i / n) * TAU, hx = 16 * Math.pow(Math.sin(t), 3), hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        X.tw = 0.4; X.twF = 12; X.delay = 0.12 + i * 0.012; X.fin = 0.15; X.fout = 0.55;
        emit(F.sparkle, 1, x + camRX * hx * 0.42, y + 9.5 + hy * 0.42, z + camRZ * hx * 0.42, camRX * hx * 0.06, hy * 0.06, camRZ * hx * 0.06, 1.5, 2.0, 1.6, 0xffffff, 0xff6fa8);
      }
    }),

    vict('coin_rain', 'Денежный дождь', 'Coin Rain', 1, ['#ffc83d', '#ffe27a', '#ffffff'], function (x, y, z) {
      var n = N(80), i, g = -9, fy = y + 0.6;
      for (i = 0; i < n; i++) {
        var an = Math.random() * TAU, r = Math.sqrt(Math.random()) * 11, sx = x + Math.cos(an) * r, sz = z + Math.sin(an) * r;
        var y0 = y + rnd(12, 19), vy0 = -rnd(3, 7), d = rnd(0, 2.2), tf = fallTime(vy0, g, y0 - fy);
        X.flip = rnd(7, 12); X.spin = rnd(-2, 2); X.grav = g; X.fy = fy; X.bounce = 0.45; X.fout = 0.75; X.delay = d; X.fin = 0.01;
        emit1(F.coin, 0, sx, y0, sz, rnd(-0.4, 0.4), vy0, rnd(-0.4, 0.4), tf + 1.5, 2.1, 2.1, pick([0xffc83d, 0xffd860, 0xffb02e]));
        if (i % 2 === 0) {
          X.delay = d + tf; X.tw = 0.4; X.twF = 20; X.fout = 0.45;
          emit(F.sparkle, 1, sx, fy + 0.4, sz, 0, 2, 0, 0.5, 1.2, 2.8, 0xffffff, 0xffc83d);
        }
      }
      ringFlat(x, y, z, 1, 14, 0.8, 0xffd24a, 0.8, true, 0.1);
      flash(x, y + 8, z, 6, 18, 0.5, 0xffe27a, 0.5);
    }),
    vict('petal_storm', 'Буря лепестков', 'Petal Storm', 1, ['#ffb7d5', '#ff8fb8', '#ffe0ee'], function (x, y, z) {
      var n = N(70), i;
      ringFlat(x, y, z, 1, 12, 0.8, 0xffb7d5, 0.8, true);
      flash(x, y + 2, z, 3, 12, 0.35, 0xffd0e4, 0.7);
      for (i = 0; i < n; i++) {
        X.move = 1; X.cx = x; X.cy = y + 0.4; X.cz = z; X.rad0 = rnd(1.5, 3.5); X.rad1 = rnd(7, 11);
        X.flip = rnd(3, 6); X.spin = rnd(-4, 4); X.fin = 0.1; X.fout = 0.65; X.delay = rnd(0, 1.0);
        emit1(F.petal, 0, 0, 0, 0, rnd(2.8, 4.4), rnd(2.2, 4.4), rnd(0, TAU), rnd(1.8, 2.6), rnd(1.0, 1.7), rnd(1.0, 1.7), pick([0xffb7d5, 0xff8fb8, 0xffe0ee, 0xffffff]));
      }
      n = N(24);
      for (i = 0; i < n; i++) {
        X.move = 1; X.cx = x; X.cy = y + 0.6; X.cz = z; X.rad0 = rnd(1.5, 3); X.rad1 = rnd(5, 9); X.tw = 0.7; X.twF = 12; X.fout = 0.5; X.delay = rnd(0, 1.2);
        emit(F.sparkle, 1, 0, 0, 0, rnd(3.2, 5), rnd(4, 8), rnd(0, TAU), rnd(1.2, 1.8), rnd(0.9, 1.5), 0.2, 0xffffff, 0xff8fb8);
      }
    }),

    vict('candy_rain', 'Конфетный дождь', 'Candy Rain', 1, ['#ff7ac0', '#6ad8ff', '#ffd24a'], function (x, y, z) {
      var n = N(70), i, g = -9, fy = y + 0.6;
      for (i = 0; i < n; i++) {
        var an = Math.random() * TAU, r = Math.sqrt(Math.random()) * 11, sx = x + Math.cos(an) * r, sz = z + Math.sin(an) * r;
        var y0 = y + rnd(12, 19), vy0 = -rnd(2, 6), d = rnd(0, 2.2), tf = fallTime(vy0, g, y0 - fy), isCandy = Math.random() < 0.4;
        X.spin = rnd(-6, 6); X.grav = g; X.fy = fy; X.bounce = 0.4; X.fout = 0.75; X.delay = d; X.fin = 0.01; X.flip = isCandy ? 0 : rnd(3, 6);
        var c = pick([0xff6ab4, 0x5ad8ff, 0xffe14a, 0x8aff7a, 0xc58bff, 0xff9a5a]);
        emit1(isCandy ? F.candy : F.sprinkle, 0, sx, y0, sz, rnd(-0.4, 0.4), vy0, rnd(-0.4, 0.4), tf + 1.5, isCandy ? 2.6 : 1.8, isCandy ? 2.6 : 1.8, c);
        if (i % 3 === 0) {
          X.delay = d + tf; X.fout = 0.45; X.tw = 0.4; X.twF = 18;
          emit(F.sparkle, 1, sx, fy + 0.4, sz, 0, 2, 0, 0.45, 1.0, 2.2, 0xffffff, c);
        }
      }
      ringFlat(x, y, z, 1, 14, 0.8, 0xff9ad0, 0.8, true, 0.1);
      flash(x, y + 8, z, 6, 18, 0.5, 0xffc0e0, 0.4);
    }),
    vict('feather_burst', 'Ангельские перья', 'Angel Feathers', 1, ['#ffffff', '#fff3c0', '#d8ecff'], function (x, y, z) {
      var n, i;
      flash(x, y + 4, z, 5, 24, 0.6, 0xfff3c0, 0.8);
      pillar(x, y, z, 5, 30, 1.2, 0xfff6d0, 0xffffff, 0.45);
      ringFlat(x, y, z, 1, 14, 0.9, 0xfff3c0, 0.8, true);
      n = N(30);
      for (i = 0; i < n; i++) {
        dirSphere();
        var sp = rnd(7, 16);
        X.drag = 2.0; X.grav = -2.5; X.wob = 3.2; X.wobF = rnd(1.8, 3); X.spin = rnd(-2.5, 2.5); X.flip = rnd(2, 4); X.fout = 0.65;
        emit1(F.feather, 0, x, y + 4, z, DX * sp, DY * sp * 0.8 + 3, DZ * sp, rnd(2.6, 3.6), rnd(1.6, 2.4), rnd(1.6, 2.4), pick([0xffffff, 0xfffbea, 0xeaf3ff]));
      }
      n = N(30);
      for (i = 0; i < n; i++) {
        var an = Math.random() * TAU, r = rnd(0.5, 6);
        X.tw = 0.8; X.twF = rnd(8, 14); X.spin = rnd(-1, 1); X.delay = rnd(0.1, 1.2); X.fout = 0.5;
        emit(F.sparkle, 1, x + Math.cos(an) * r, y + rnd(1, 9), z + Math.sin(an) * r, 0, rnd(0.5, 2), 0, rnd(0.9, 1.5), rnd(1.1, 2.0), 0.3, 0xffffff, 0xffe9a0);
      }
    }),

    vict('fireworks', 'Фейерверк', 'Fireworks', 2, ['#ff4d6d', '#ffd23f', '#35b6ff'], function (x, y, z) {
      var offs = [-9, 9, 0], fwd = [6, 4, 12], t0 = [0, 0.5, 1.0], hs = [9, 11, 13], shapes = [0, 1, 2];
      var h0 = rnd(0, 1);
      for (var k = 0; k < 3; k++) {
        var px = x + camRX * offs[k] + camFX * fwd[k], pz = z + camRZ * offs[k] + camFZ * fwd[k];
        var tf = 0.55, H = hs[k], c = k === 2 ? 0xffc83d : hsv(h0 + k * 0.33, 0.8, 1), i;
        X.mode = 1; X.stretch = 0.05; X.delay = t0[k]; X.fin = 0; X.fout = 0.8;
        emit(F.streak, 1, px, y + 1, pz, 0, H / tf, 0, tf, 1.1, 0.8, 0xffffff, 0xffc060);
        var nt = N(12);
        for (i = 0; i < nt; i++) {
          var s = rnd(0.05, 1) * tf;
          X.drag = 1.5; X.delay = t0[k] + s; X.fout = 0.4; X.tw = 0.5; X.twF = 16;
          emit(F.sparkle, 1, px + rnd(-0.2, 0.2), y + 1 + H * s / tf, pz + rnd(-0.2, 0.2), rnd(-1, 1), -rnd(1, 3), rnd(-1, 1), rnd(0.4, 0.7), rnd(1.1, 1.8), 0.2, 0xfff0c0, 0xff9a30);
        }
        fireworkShell(px, y + 1 + H, pz, shapes[k] === 1 ? N(36) : N(54), shapes[k], c, shapes[k] === 2 ? 20 : 27, t0[k] + tf);
        if (shapes[k] === 1) fireworkShell(px, y + 1 + H, pz, N(26), 0, hsv(h0 + k * 0.33 + 0.5, 0.7, 1), 13, t0[k] + tf);
        flash(px, y + 0.8, pz, 2, 7, 0.25, 0xffe27a, 0.7, t0[k]);
      }
    }),
    vict('star_nova', 'Звёздная сверхновая', 'Star Nova', 2, ['#ffe27a', '#ffffff', '#ffb02e'], function (x, y, z) {
      var cy = y + 5, n, i;
      flash(x, cy, z, 6, 28, 0.55, 0xfff0c0, 1);
      X.spin = 1.2; X.szp = 0.5; X.fout = 0.4;
      emit(F.burst, 1, x, cy, z, 0, 0, 0, 0.6, 4, 22, 0xffffff, 0xffd24a);
      ringFlat(x, y, z, 1, 22, 0.9, 0xffd24a, 0.9, true);
      ringFlat(x, y, z, 1, 14, 0.7, 0xffffff, 0.8, false, 0.1);
      n = N(26);
      for (i = 0; i < n; i++) {
        var an = (i / n) * TAU;
        X.drag = 2.6; X.spin = (i & 1) ? 3 : -3; X.fout = 0.6;
        emit(F.star, 1, x, cy, z, Math.cos(an) * 13, 0.5, Math.sin(an) * 13, 2.0, 1.6, 0.8, (i & 1) ? 0xffffff : 0xffd24a, 0xffb02e);
      }
      n = N(20);
      for (i = 0; i < n; i++) {
        var a2 = (i / n) * TAU, c2 = Math.cos(a2) * 15, s2 = Math.sin(a2) * 15;
        X.drag = 2.0; X.spin = 2.5; X.fout = 0.6;
        emit(F.star, 1, x, cy, z, camRX * c2, s2, camRZ * c2, 2.0, 1.4, 0.7, 0xfff0a0, 0xffb02e);
      }
      n = N(16);
      for (i = 0; i < n; i++) {
        var a3 = (i / n) * TAU, c3 = Math.cos(a3) * 13, s3 = Math.sin(a3) * 13;
        X.drag = 2.0; X.spin = -2; X.fout = 0.6; X.delay = 0.06;
        emit(F.sparkle, 1, x, cy, z, camRX * c3 * 0.7 + camFX * s3 * 0.7, s3 * 0.7, camRZ * c3 * 0.7 + camFZ * s3 * 0.7, 1.3, 1.6, 0.4, 0xffffff, 0xffd24a);
      }
      n = N(30);
      for (i = 0; i < n; i++) {
        dirSphere();
        var sp = rnd(5, 14);
        X.drag = 3; X.tw = 0.7; X.twF = 14; X.fout = 0.5;
        emit(F.sparkle, 1, x, cy, z, DX * sp, DY * sp, DZ * sp, rnd(0.8, 1.4), rnd(0.9, 1.6), 0.2, 0xffffff, 0xffc83d);
      }
    }),

    vict('egg_fountain', 'Фонтан яиц', 'Egg Fountain', 2, ['#ffd24a', '#ff9ad0', '#6ad8ff'], function (x, y, z) {
      var n = N(16), i;
      var cols = [0xffd24a, 0xff9ad0, 0x6ad8ff, 0x9af07a, 0xc58bff, 0xff9a5a];
      for (i = 0; i < n; i++) {
        dirCone(0.4);
        var sp = rnd(24, 34), gold = i === 3;
        X.grav = -56; X.spin = rnd(-6, 6); X.fy = y + 0.9; X.bounce = 0.45; X.fout = 0.75; X.delay = i * 0.055 + rnd(0, 0.02);
        emit1(F.egg, 0, x, y + 1, z, DX * sp, DY * sp, DZ * sp, 3.0, gold ? 3.0 : rnd(1.6, 2.2), gold ? 3.0 : rnd(1.6, 2.2), gold ? 0xffd24a : pick(cols));
      }
      n = N(40);
      for (i = 0; i < n; i++) {
        dirCone(0.35);
        var s2 = rnd(14, 28);
        X.grav = -40; X.drag = 0.3; X.fout = 0.5; X.delay = rnd(0, 0.9);
        emit(F.dot, 1, x, y + 1, z, DX * s2, DY * s2, DZ * s2, rnd(0.7, 1.2), 0.9, 0.3, 0xffffff, 0x9ad8ff);
      }
      ringFlat(x, y, z, 1, 9, 0.6, 0xffe27a, 0.8, true);
      ringFlat(x, y, z, 1, 12, 0.7, 0xffffff, 0.6, false, 0.35);
      flash(x, y + 1, z, 2, 8, 0.3, 0xfff0c0, 0.8);
    }),

    vict('music_party', 'Музыкальная вечеринка', 'Music Party', 2, ['#ff6ad5', '#35b6ff', '#ffd23f'], function (x, y, z) {
      var n = N(26), i;
      for (i = 0; i < n; i++) {
        var an = Math.random() * TAU, r = rnd(1, 4);
        X.wob = 3.5; X.wobF = rnd(2, 3.5); X.rr = 0; X.rot = rnd(-0.3, 0.3); X.fin = 0.12; X.fout = 0.6; X.delay = (i % 3) * 0.18 + rnd(0, 0.15);
        emit1(i & 1 ? F.note : F.note2, 0, x + Math.cos(an) * r, y + 1.5, z + Math.sin(an) * r, 0, rnd(3, 5.5), 0, 2.3, rnd(2.0, 2.8), rnd(2.0, 2.8), hsv(i / n + 0.05, 0.7, 1));
      }
      for (i = 0; i < 4; i++) {
        ringFlat(x, y, z, 1, 9 + i, 0.6, PAL_RAINBOW[(i * 2) % 7], 0.8, true, i * 0.38);
        flash(x, y + 1.5, z, 2, 7, 0.2, 0xffffff, 0.5, i * 0.38);
      }
      n = N(24);
      for (i = 0; i < n; i++) {
        var a2 = Math.random() * TAU, r2 = rnd(1, 7);
        X.tw = 0.7; X.twF = 12; X.delay = rnd(0, 1.4); X.fout = 0.5;
        emit(F.sparkle, 1, x + Math.cos(a2) * r2, y + rnd(0.5, 3), z + Math.sin(a2) * r2, 0, rnd(3, 7), 0, rnd(0.8, 1.3), rnd(1.0, 1.7), 0.2, 0xffffff, hsv(Math.random(), 0.7, 1));
      }
    }),

    vict('rainbow_arc', 'Радужная дуга', 'Rainbow Arc', 2, ['#ff4040', '#ffe14a', '#3fb6ff'], function (x, y, z) {
      var cx = x + camFX * 10, cz = z + camFZ * 10, b, j, M = N(36);
      for (b = 0; b < 7; b++) {
        var R = 15 - b * 1.15, size = Math.max(1.9, (PI * R / M) * 1.2);
        for (j = 0; j < M; j++) {
          var s = (j + 0.5) / M * PI, cs = Math.cos(s) * R, sn = Math.sin(s) * R * 0.88;
          X.delay = (j / M) * 0.38 + b * 0.02; X.fin = 0.12; X.fout = 0.62;
          emit1(F.dot, 1, cx + camRX * cs, y + 1 + sn, cz + camRZ * cs, 0, 0, 0, 2.3, size, size, PAL_RAINBOW[b]);
        }
      }
      for (j = 0; j < 2; j++) {
        var side = j ? 1 : -1;
        for (b = 0; b < 3; b++) {
          X.fin = 0.3; X.fout = 0.6; X.a0 = 0.95; X.delay = 0.1 + b * 0.05; X.rr = 1;
          emit1(F.cloud, 0, cx + camRX * side * (13.2 + b * 1.6), y + 1.5 + b * 0.5, cz + camRZ * side * (13.2 + b * 1.6), 0, 0.3, 0, 2.2, 5.5 - b, 5.8 - b, 0xffffff);
        }
      }
      var n = N(26), i;
      for (i = 0; i < n; i++) {
        var s2 = rnd(0.05, 0.95) * PI, R2 = rnd(8.5, 15);
        X.tw = 0.8; X.twF = rnd(8, 14); X.delay = rnd(0.4, 1.3); X.fout = 0.5; X.spin = rnd(-1, 1);
        emit(F.sparkle, 1, cx + camRX * Math.cos(s2) * R2, y + 1 + Math.sin(s2) * R2 * 0.88, cz + camRZ * Math.cos(s2) * R2, 0, rnd(-0.3, 0.6), 0, rnd(0.8, 1.3), rnd(1.2, 2.0), 0.3, 0xffffff, 0xffe27a);
      }
    }),

    vict('golden_pillar', 'Золотой столб', 'Golden Pillar', 3, ['#ffd24a', '#fff3b0', '#ffb02e'], function (x, y, z) {
      var n = N(44), i;
      pillar(x, y, z, 6.4, 46, 1.9, 0xfff0b0, 0xffc83d, 0.85);
      pillar(x, y, z, 2.6, 44, 1.5, 0xffffff, 0xffffff, 1);
      flash(x, y + 1.5, z, 6, 22, 0.6, 0xfff0c0, 0.95);
      ringFlat(x, y, z, 1, 20, 1.0, 0xffd24a, 0.95, true);
      ringFlat(x, y, z, 1, 12, 0.8, 0xffffff, 0.8, false, 0.15);
      for (i = 0; i < n; i++) {
        X.move = 1; X.cx = x; X.cy = y + 0.3; X.cz = z; X.rad0 = 3.4; X.rad1 = 2.4; X.tw = 0.5; X.twF = 12; X.spin = rnd(-2, 2); X.fin = 0.1; X.fout = 0.6; X.delay = rnd(0, 1.0);
        emit(F.sparkle, 1, 0, 0, 0, rnd(2.5, 4) * sgn(), rnd(10, 18), rnd(0, TAU), rnd(1.4, 1.9), rnd(1.1, 1.8), 0.3, pick(PAL_GOLD), 0xffb02e);
      }
      n = N(26);
      for (i = 0; i < n; i++) {
        var an = Math.random() * TAU, r = rnd(0, 2);
        X.drag = 0.4; X.fout = 0.5; X.delay = rnd(0, 0.9);
        emit(F.dot, 1, x + Math.cos(an) * r, y + 0.5, z + Math.sin(an) * r, rnd(-0.6, 0.6), rnd(12, 22), rnd(-0.6, 0.6), rnd(1.0, 1.6), 0.8, 0.2, 0xfff3b0, 0xffb02e);
      }
    }),

    vict('lightning_strike', 'Удар молнии', 'Lightning Strike', 3, ['#9fd8ff', '#ffffff', '#fff06a'], function (x, y, z) {
      var d = 0.2, segs = 9, i, n;
      flash(x, y + 18, z, 20, 40, 0.5, 0x9fc0ff, 0.45, d - 0.05);
      boltPath(x + rnd(-3, 3), y + 36, z + rnd(-3, 3), x, y, z, segs, 2.6);
      boltDraw(segs, d, 0.38, 1.1, 1);
      boltDraw(segs, d + 0.15, 0.14, 0.9, 0.85);
      boltDraw(segs, d + 0.27, 0.1, 0.7, 0.7);
      var fx = BOLT[3 * 3], fy = BOLT[3 * 3 + 1], fz = BOLT[3 * 3 + 2], dx = rnd(-10, 10), dz = rnd(-10, 10);
      boltPath(fx, fy, fz, fx + dx, y + 6, fz + dz, 5, 2.0);
      boltDraw(5, d, 0.3, 0.7, 0.9);
      flash(x, y + 1, z, 6, 30, 0.55, 0xcfe6ff, 1, d);
      X.spin = 0.8; X.szp = 0.5; X.delay = d; X.fout = 0.4;
      emit(F.burst, 1, x, y + 1.5, z, 0, 0, 0, 0.5, 4, 18, 0xffffff, 0x9fd8ff);
      ringFlat(x, y, z, 1, 19, 0.7, 0x6ab0ff, 1, true, d);
      ringFlat(x, y, z, 1, 11, 0.5, 0xffffff, 0.9, false, d + 0.04);
      n = N(30);
      for (i = 0; i < n; i++) {
        dirSphere();
        var sp = rnd(16, 32);
        X.mode = 1; X.stretch = 0.08; X.drag = 2.8; X.delay = d; X.fout = 0.4; X.fin = 0;
        emit(F.streak, 1, x, y + 0.8, z, DX * sp, Math.abs(DY) * sp * 0.8 + 2, DZ * sp, rnd(0.4, 0.7), 0.7, 0.2, 0xffffff, 0x6fb8ff);
      }
      n = N(8);
      for (i = 0; i < n; i++) {
        dirDisc();
        X.delay = d;
        dust(x + DX, y + 0.6, z + DZ, DX * rnd(6, 11), rnd(0.5, 2), DZ * rnd(6, 11), 0.9, 2.4, 6.5, 0xdfe6f0, 0.6);
      }
      n = N(14);
      for (i = 0; i < n; i++) {
        dirSphere();
        X.tw = 0.7; X.twF = 16; X.drag = 2.5; X.delay = d + 0.05; X.fout = 0.5;
        emit(F.sparkle, 1, x, y + 1, z, DX * 9, Math.abs(DY) * 10 + 2, DZ * 9, rnd(0.6, 1.1), 1.8, 0.3, 0xffffff, 0x6fb8ff);
      }
    }),
    vict('magic_circle', 'Магический круг', 'Magic Circle', 3, ['#b06bff', '#6ac8ff', '#ffffff'], function (x, y, z) {
      var n = N(44), i;
      X.mode = 2; X.fin = 0.12; X.fout = 0.72; X.spin = 0.9; X.a0 = 0.95;
      emit(F.rune, 1, x, y + 0.12, z, 0, 0, 0, 3.2, 17, 18, 0xb06bff, 0x6ac8ff);
      X.mode = 2; X.fin = 0.16; X.fout = 0.72; X.spin = -1.5; X.a0 = 0.85; X.delay = 0.1;
      emit(F.rune, 1, x, y + 0.14, z, 0, 0, 0, 3.0, 10, 10.5, 0xffffff, 0xbfa0ff);
      ringFlat(x, y, z, 1, 21, 0.8, 0xd0a0ff, 0.9, true);
      ringFlat(x, y, z, 14, 14, 3.0, 0x9a6cff, 0.6, false, 0.2);
      pillar(x, y, z, 11, 14, 2.6, 0xb06bff, 0x6ac8ff, 0.26, 0.15);
      flash(x, y + 1, z, 4, 16, 0.5, 0xc8a0ff, 0.8);
      for (i = 0; i < n; i++) {
        var an = Math.random() * TAU, r = rnd(2, 7.8);
        X.tw = 0.6; X.twF = rnd(10, 16); X.spin = rnd(-2, 2); X.delay = rnd(0.15, 2.0); X.fin = 0.15; X.fout = 0.55; X.drag = 0.2;
        emit(F.sparkle, 1, x + Math.cos(an) * r, y + 0.4, z + Math.sin(an) * r, 0, rnd(4, 9), 0, rnd(0.9, 1.5), rnd(1.0, 1.9), 0.3, pick([0xffffff, 0xd0a0ff, 0x8ad8ff]), 0x8a4cff);
      }
      n = N(6);
      for (i = 0; i < n; i++) {
        X.move = 1; X.cx = x; X.cy = y + 0.8; X.cz = z; X.rad0 = 8; X.rad1 = 8; X.fin = 0.2; X.fout = 0.5; X.delay = 0.2;
        emit(F.glow, 1, 0, 0, 0, 1.8, 0.4, (i / n) * TAU, 2.6, 2.4, 2.4, 0xb06bff, 0x6ac8ff);
      }
    }),

    vict('fire_ring', 'Огненное кольцо', 'Ring of Fire', 3, ['#ffb02e', '#ff5a1f', '#ffee80'], function (x, y, z) {
      var w, n, i;
      flash(x, y + 1.5, z, 5, 20, 0.45, 0xffc060, 0.8);
      ringFlat(x, y, z, 1, 17, 0.9, 0xff7a20, 0.55, true);
      ringFlat(x, y, z, 1, 11, 0.7, 0xffd060, 0.7, false, 0.1);
      for (w = 0; w < 2; w++) {
        n = N(34);
        for (i = 0; i < n; i++) {
          var an = (i / n) * TAU + rnd(-0.08, 0.08) + w * 0.09, sp = rnd(13, 16);
          X.delay = w * 0.22;
          flameP(x + Math.cos(an) * 1.5, y + 1.4, z + Math.sin(an) * 1.5, Math.cos(an) * sp, rnd(1, 3), Math.sin(an) * sp, rnd(0.75, 1.1), rnd(3.2, 4.6));
        }
      }
      n = N(8);
      for (i = 0; i < n; i++) {
        var a2 = Math.random() * TAU, s2 = rnd(5, 10);
        X.drag = 1.0; X.a0 = 0.24; X.fin = 0.2; X.fout = 0.4; X.delay = 0.2;
        emit(F.smoke, 0, x + Math.cos(a2), y + 1.2, z + Math.sin(a2), Math.cos(a2) * s2, rnd(2, 4), Math.sin(a2) * s2, rnd(1.1, 1.6), 2.4, 5.5, 0x5a5050, 0x302a2a);
      }
      n = N(30);
      for (i = 0; i < n; i++) {
        var a3 = Math.random() * TAU, s3 = rnd(2, 10);
        X.drag = 0.5; X.wob = 3; X.tw = 0.4; X.twF = 12; X.fout = 0.5; X.delay = rnd(0.05, 0.5);
        emit(F.ember, 0, x + Math.cos(a3) * s3 * 0.6, y + 1, z + Math.sin(a3) * s3 * 0.6, Math.cos(a3) * 2, rnd(7, 14), Math.sin(a3) * 2, rnd(1.0, 1.8), rnd(0.8, 1.3), 0.3, 0xffb030, 0xff3a10);
      }
    }),
    vict('meteor_shower', 'Метеоритный дождь', 'Meteor Shower', 4, ['#ffc060', '#9fd8ff', '#ffffff'], function (x, y, z) {
      var n = N(14), i, T_ = 0.9, k;
      var cols = [0xffc060, 0xffe9a0, 0xff7a3a, 0x9fd8ff];
      for (i = 0; i < n; i++) {
        var side = (i & 1) ? 1 : -1;
        var tx = x + rnd(-14, 14) + camFX * rnd(-3, 9), tz = z + rnd(-14, 14) + camFZ * rnd(-3, 9);
        var sx = tx + camRX * side * 20 + camFX * 6, sy = y + 42, sz = tz + camRZ * side * 20 + camFZ * 6;
        var vx = (tx - sx) / T_, vy = (y - sy) / T_, vz = (tz - sz) / T_, vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
        var d = i * 0.2 + rnd(0, 0.1), c = pick(cols), ux = vx / vl, uy = vy / vl, uz = vz / vl;
        X.spin = 3; X.delay = d; X.fin = 0.01; X.fout = 0.92;
        emit(F.star, 1, sx, sy, sz, vx, vy, vz, T_, 4.4, 3.6, 0xffffff, c);
        X.delay = d; X.fin = 0.01; X.fout = 0.92; X.a0 = 0.8;
        emit1(F.glow, 1, sx, sy, sz, vx, vy, vz, T_, 9, 8, c);
        X.mode = 1; X.stretch = 0.12; X.delay = d; X.fin = 0.01; X.fout = 0.92; X.a0 = 0.95;
        emit(F.streak, 1, sx - ux * 7, sy - uy * 7, sz - uz * 7, vx, vy, vz, T_, 2.8, 2.0, 0xffffff, c);
        for (k = 0; k < N(7); k++) {
          var f = rnd(0.05, 0.9);
          X.delay = d + f * T_ + 0.04; X.drag = 1.5; X.grav = -4; X.tw = 0.6; X.twF = 16; X.fout = 0.5;
          emit(F.sparkle, 1, sx + vx * f * T_, sy + vy * f * T_, sz + vz * f * T_, rnd(-1.5, 1.5), rnd(-1.5, 1.5), rnd(-1.5, 1.5), rnd(0.5, 0.9), rnd(1.8, 2.8), 0.3, 0xffffff, c);
        }
        flash(tx, y + 0.8, tz, 4, 15, 0.4, lite(c, 0.5), 0.95, d + T_);
        ringFlat(tx, y, tz, 0.6, 9, 0.6, c, 1, true, d + T_);
        for (k = 0; k < N(8); k++) {
          dirSphere();
          var sp = rnd(10, 20);
          X.mode = 1; X.stretch = 0.08; X.drag = 3; X.delay = d + T_; X.fout = 0.4; X.fin = 0;
          emit(F.streak, 1, tx, y + 0.6, tz, DX * sp, Math.abs(DY) * sp + 2, DZ * sp, rnd(0.35, 0.6), 0.7, 0.2, 0xffffff, c);
        }
        X.delay = d + T_;
        dust(tx, y + 0.7, tz, rnd(-2, 2), 1.5, rnd(-2, 2), 0.9, 2.4, 6, 0xe8dcc4, 0.55);
      }
    }),
    vict('galaxy_swirl', 'Галактический вихрь', 'Galaxy Swirl', 4, ['#b58cff', '#7aa8ff', '#ff9be8'], function (x, y, z) {
      var cy = y + 7.5, n = N(150), i, tB = 1.8;
      X.fin = 0.3; X.fout = 0.5; X.a0 = 0.5;
      emit1(F.glow, 1, x, cy, z, 0, 0, 0, tB, 3, 14, 0x9a6cff);
      flash(x, y + 0.5, z, 3, 12, 0.5, 0x9a6cff, 0.7);
      ringFlat(x, y, z, 1, 14, 0.8, 0xb58cff, 0.6, true);
      for (i = 0; i < n; i++) {
        var arm = (i % 3) * (TAU / 3);
        X.move = 1; X.cx = x; X.cy = cy; X.cz = z; X.rad0 = 7 + rnd(-0.5, 0.5); X.rad1 = 0.8 + rnd(-0.3, 0.3); X.tilt = 0.4;
        X.fin = 0.12; X.fout = 0.72; X.delay = rnd(0, 0.45);
        emit(F.dot, 1, 0, 0, 0, 6.4 + rnd(-0.2, 0.2), 0, arm + rnd(-0.12, 0.12), 1.35, rnd(0.9, 1.5), 0.35, pick([0xb58cff, 0x7aa8ff, 0xff9be8, 0xffffff, 0xc7b0ff]), 0x6a3cff);
      }
      flash(x, cy, z, 6, 34, 0.7, 0xd8c0ff, 1, tB);
      X.spin = 1; X.szp = 0.5; X.delay = tB; X.fout = 0.4;
      emit(F.burst, 1, x, cy, z, 0, 0, 0, 0.6, 4, 24, 0xffffff, 0xb58cff);
      ringFlat(x, y, z, 1, 24, 0.9, 0xb58cff, 0.9, true, tB);
      ringFace(x, cy, z, 1, 16, 0.7, 0xffffff, 0.9, false, tB);
      n = N(56);
      for (i = 0; i < n; i++) {
        dirSphere();
        var sp = rnd(10, 26);
        X.drag = 2.2; X.delay = tB; X.tw = 0.6; X.twF = 14; X.spin = rnd(-3, 3); X.fout = 0.5;
        emit(Math.random() < 0.4 ? F.star : F.sparkle, 1, x, cy, z, DX * sp, DY * sp, DZ * sp, rnd(1.0, 1.8), rnd(1.0, 1.8), 0.3, pick([0xffffff, 0xd8c0ff, 0xff9be8, 0x9ac0ff]), 0x7a4cff);
      }
    })
  ];

  /* default spatial scale of each victory (positions, speeds and gravity scale together, timing is unchanged) */
  var VICT_SCALE = {
    confetti_cannon: 1.5, balloons: 1.5, bubble_burst: 1.8, snow_burst: 1.6, heart_explosion: 1.6, petal_storm: 1.6,
    feather_burst: 1.6, star_nova: 1.5, egg_fountain: 1.5, music_party: 1.0, golden_pillar: 1.3, fire_ring: 1.5, galaxy_swirl: 1.3
  };

  function victory(id, pos, opts) {
    if (!inited) return;
    var fn = VICT_IMPL[id];
    if (!fn) return;
    at(pos); camBasis();
    PRIO = 3;
    VS = (opts && opts.scale) || VICT_SCALE[id] || 1;
    VSK = 1 + (VS - 1) * 0.8;
    OX = PX; OY = PY; OZ = PZ;
    fn(PX, PY, PZ);
    VS = 1; VSK = 1;
    PRIO = 2;
    xr();
  }

  /* =============================================================== ambient */
  var ambReg = [], ambAcc = new Float32Array(4), gRef = 0;
  var AX = 0, AY = 0, AZ = 0;
  var AMB = {};
  function ambient(biomeId, center, radius) {
    var cx = center ? (+center.x || 0) : 0, cz = center ? (+center.z || 0) : 0, r = radius || 62;
    for (var i = 0; i < ambReg.length; i++) {
      if (ambReg[i].biome === biomeId && Math.abs(ambReg[i].x - cx) < 2 && Math.abs(ambReg[i].z - cz) < 2) { ambReg[i].r = r; return; }
    }
    ambReg.push({ biome: biomeId, x: cx, z: cz, r: r });
  }
  /* random point in front of the camera, within ~55 units of the player; false when it falls outside the biome */
  function ambPos(reg, yMin, yMax) {
    var d = rnd(4, 55), lat = rnd(-0.85, 0.85) * d * 0.9;
    AX = camX + camFX * d + camRX * lat; AZ = camZ + camFZ * d + camRZ * lat;
    var dx = AX - ppx, dz = AZ - ppz;
    if (dx * dx + dz * dz > 3600) { AX = ppx + rnd(-30, 30); AZ = ppz + rnd(-30, 30); }
    dx = AX - reg.x; dz = AZ - reg.z;
    if (dx * dx + dz * dz > (reg.r + 6) * (reg.r + 6)) return false;
    AY = gRef + rnd(yMin, yMax);
    return true;
  }
  AMB.forest = [
    { rate: 3.2, fn: function (r) {
      if (!ambPos(r, 0.8, 4.5)) return;
      X.wob = rnd(1.4, 2.4); X.wobF = rnd(1.5, 2.5); X.drag = 0.3; X.tw = 1; X.twF = rnd(2.4, 4.6); X.fin = 0.2; X.fout = 0.6;
      emit(F.ember, 1, AX, AY, AZ, rnd(-0.6, 0.6), rnd(-0.3, 0.5), rnd(-0.6, 0.6), 6, 1.4, 1.2, 0xe9ff6a, 0x9be84a);
    } },
    { rate: 3.4, fn: function (r) {
      if (!ambPos(r, 9, 17)) return;
      X.wob = 3; X.wobF = rnd(1.8, 3); X.flip = rnd(2, 5); X.spin = rnd(-4, 4); X.fin = 0.08; X.fout = 0.7;
      emit1(F.leaf, 0, AX, AY, AZ, rnd(-0.5, 0.5), -rnd(1.5, 2.5), rnd(-0.5, 0.5), 6.5, rnd(0.9, 1.4), rnd(0.9, 1.4), pick([0x3ecb4a, 0x7be04f, 0xb6e84a, 0xe8a23a, 0xd4e04a]));
    } }
  ];
  AMB.desert = [
    { rate: 3.5, fn: function (r) {
      if (!ambPos(r, 0.3, 2.5)) return;
      var sp = rnd(7, 12);
      X.mode = 1; X.stretch = 0.3; X.a0 = 0.3; X.fin = 0.25; X.fout = 0.5;
      emit(F.streak, 0, AX, AY, AZ, sp * 0.9, rnd(-0.2, 0.3), sp * 0.44, 3.0, rnd(0.9, 1.5), rnd(0.8, 1.2), 0xd0a85c, 0xb88a40);
    } },
    { rate: 6, fn: function (r) {
      if (!ambPos(r, 0.3, 4)) return;
      var sp = rnd(5, 9);
      X.wob = 1.6; X.a0 = 0.85; X.fin = 0.1; X.fout = 0.6;
      emit1(F.dot, 0, AX, AY, AZ, sp * 0.9, rnd(-0.4, 0.6), sp * 0.44, 2.2, rnd(0.25, 0.4), rnd(0.2, 0.34), 0xb88a40);
    } }
  ];
  AMB.candy = [
    { rate: 7, fn: function (r) {
      if (!ambPos(r, 10, 20)) return;
      X.wob = 1.4; X.spin = rnd(-5, 5); X.flip = rnd(2, 5); X.fin = 0.08; X.fout = 0.7;
      emit1(F.sprinkle, 0, AX, AY, AZ, rnd(-0.4, 0.4), -rnd(2, 3.2), rnd(-0.4, 0.4), 5.5, rnd(0.7, 1.1), rnd(0.7, 1.1), pick([0xff6ab4, 0x5ad8ff, 0xffe14a, 0x8aff7a, 0xffffff, 0xc58bff]));
    } },
    { rate: 2, fn: function (r) {
      if (!ambPos(r, 1, 8)) return;
      X.tw = 0.8; X.twF = rnd(8, 14); X.spin = rnd(-1, 1); X.fout = 0.5;
      emit(F.sparkle, 1, AX, AY, AZ, 0, rnd(0.2, 1), 0, 1.4, rnd(1.0, 1.6), 0.3, 0xffffff, pick(PAL_PASTEL));
    } }
  ];
  AMB.ice = [
    { rate: 16, fn: function (r) {
      if (!ambPos(r, 14, 22)) return;
      X.wob = 1.3; X.spin = rnd(-2, 2); X.fin = 0.06; X.fout = 0.75; X.a0 = 0.92;
      emit1(Math.random() < 0.45 ? F.flake : F.dot, 0, AX, AY, AZ, 0.8, -rnd(2.2, 3.4), 0.3, 7, rnd(0.4, 0.8), rnd(0.35, 0.7), 0xf4faff);
    } },
    { rate: 2.4, fn: function (r) {
      if (!ambPos(r, 0.5, 6)) return;
      X.tw = 1; X.twF = rnd(8, 14); X.spin = rnd(-1, 1); X.fout = 0.5;
      emit(F.sparkle, 1, AX, AY, AZ, 0, rnd(-0.2, 0.4), 0, 1.2, rnd(1.0, 1.6), 0.3, 0xffffff, 0x8fd8ff);
    } }
  ];
  AMB.volcano = [
    { rate: 11, fn: function (r) {
      if (!ambPos(r, 0.3, 3)) return;
      X.wob = 2.5; X.drag = 0.15; X.tw = 0.4; X.twF = 11; X.fin = 0.1; X.fout = 0.55;
      emit(F.ember, 0, AX, AY, AZ, rnd(0.5, 2), rnd(3, 7), rnd(-1, 1), 4, rnd(0.8, 1.4), 0.4, 0xffa030, 0xff3a10);
    } },
    { rate: 4, fn: function (r) {
      if (!ambPos(r, 9, 16)) return;
      X.wob = 1.6; X.a0 = 0.55; X.fin = 0.1; X.fout = 0.7;
      emit1(F.dot, 0, AX, AY, AZ, 0.6, -rnd(0.8, 1.6), 0.2, 7, rnd(0.35, 0.6), rnd(0.3, 0.5), 0x57504c);
    } }
  ];
  AMB.sky = [
    { rate: 5, fn: function (r) {
      if (!ambPos(r, 1, 12)) return;
      X.tw = 0.9; X.twF = rnd(8, 14); X.spin = rnd(-1, 1); X.fout = 0.5;
      emit(F.sparkle, 1, AX, AY, AZ, 0, rnd(0, 0.8), 0, 1.6, rnd(1.0, 1.8), 0.3, 0xffffff, pick([0xffe9a0, 0xbfe3ff, 0xffd0f0]));
    } },
    { rate: 1.2, fn: function (r) {
      if (!ambPos(r, 8, 14)) return;
      X.wob = 2.6; X.wobF = rnd(1.5, 2.5); X.flip = rnd(2, 4); X.spin = rnd(-3, 3); X.fin = 0.1; X.fout = 0.7;
      emit1(F.feather, 0, AX, AY, AZ, rnd(-0.4, 0.4), -rnd(0.9, 1.5), rnd(-0.4, 0.4), 6.5, rnd(1.2, 1.8), rnd(1.2, 1.8), 0xffffff);
    } },
    { rate: 0.8, fn: function (r) {
      if (!ambPos(r, 3, 10)) return;
      X.a0 = 0.5; X.fin = 0.4; X.fout = 0.5; X.rr = 0; X.rot = 0;
      emit1(F.cloud, 0, AX, AY, AZ, rnd(1, 2), 0, rnd(-0.5, 0.5), 5, rnd(5, 9), rnd(5, 9), 0xffffff);
    } }
  ];

  function updateAmbient(dt) {
    /* ground reference: follows the player down instantly and up slowly (jumps do not lift it) */
    if (ppy < gRef) gRef = ppy; else gRef += (ppy - gRef) * (1 - Math.exp(-0.7 * dt));
    if (!ambReg.length) return;
    var best = null, bd = 1e9, i;
    for (i = 0; i < ambReg.length; i++) {
      var r = ambReg[i], dx = ppx - r.x, dz = ppz - r.z, d2 = dx * dx + dz * dz, lim = (r.r + 40) * (r.r + 40);
      if (d2 < lim && d2 < bd) { bd = d2; best = r; }
    }
    if (!best) return;
    var impl = AMB[best.biome];
    if (!impl) return;
    var d = Math.sqrt(bd), k = d <= best.r ? 1 : clamp(1 - (d - best.r) / 40, 0, 1);
    PRIO = 0; SIZE_K = 1.35;
    for (i = 0; i < impl.length; i++) {
      ambAcc[i] += impl[i].rate * QS * k * dt;
      var guard = 0;
      while (ambAcc[i] >= 1 && guard++ < 6) { ambAcc[i] -= 1; impl[i].fn(best); }
      if (ambAcc[i] > 2) ambAcc[i] = 0;
    }
    PRIO = 2; SIZE_K = 1;
  }

  /* ==================================================================== icons */
  /* 2D previews for shop cards: sprites from the atlas are tinted on offscreen canvases and composed. */
  var tintCache = {}, tintKeys = [];
  function tintedSprite(name, color) {
    var a = ensureAtlas(128), cs = a.cs, fr = F[name], key = fr + '|' + color;
    var c = tintCache[key];
    if (c) return c;
    var cv = document.createElement('canvas');
    cv.width = cv.height = cs;
    var g = cv.getContext('2d');
    var sx = (fr % COLS) * cs, sy = ((fr / COLS) | 0) * cs;
    g.drawImage(a.canvas, sx, sy, cs, cs, 0, 0, cs, cs);
    if (color !== 0xffffff) {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = css(color); g.fillRect(0, 0, cs, cs);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(a.canvas, sx, sy, cs, cs, 0, 0, cs, cs);
    }
    tintCache[key] = cv; tintKeys.push(key);
    if (tintKeys.length > 160) delete tintCache[tintKeys.shift()];
    return cv;
  }

  var IG = null, IW = 0, IH = 0, IR = null;
  function ir(a, b) { return a + IR() * (b - a); }
  function ipick(arr) { return arr[(IR() * arr.length) | 0]; }
  function rgba(c, a) { c = toInt(c); return 'rgba(' + ((c >> 16) & 255) + ',' + ((c >> 8) & 255) + ',' + (c & 255) + ',' + a + ')'; }
  /* sprite: centre (fx,fy) as fractions of the canvas, size fs as fraction of the width, sy = vertical squash */
  function ispr(name, fx, fy, fs, color, rot, alpha, add, sy) {
    var cv = tintedSprite(name, color === undefined ? 0xffffff : toInt(color));
    var s = fs * IW;
    IG.save();
    IG.globalAlpha = alpha === undefined ? 1 : alpha;
    IG.globalCompositeOperation = add ? 'lighter' : 'source-over';
    IG.translate(fx * IW, fy * IH);
    if (rot) IG.rotate(rot);
    if (sy && sy !== 1) IG.scale(1, sy);
    IG.drawImage(cv, -s / 2, -s / 2, s, s);
    IG.restore();
  }
  /* sprite whose +y axis (head) points along (dx,dy) in screen space; used for streaks */
  function istreak(fx, fy, len, w, dx, dy, color, alpha) {
    var cv = tintedSprite('streak', toInt(color));
    IG.save();
    IG.globalAlpha = alpha === undefined ? 1 : alpha;
    IG.globalCompositeOperation = 'lighter';
    IG.translate(fx * IW, fy * IH);
    IG.rotate(Math.atan2(dx, -dy));
    IG.drawImage(cv, -w * IW / 2, -len * IW / 2, w * IW, len * IW);
    IG.restore();
  }
  function ibg(c0, c1, glow) {
    var g = IG, gr = g.createLinearGradient(0, 0, 0, IH);
    gr.addColorStop(0, css(c0)); gr.addColorStop(1, css(c1));
    g.fillStyle = gr; g.fillRect(0, 0, IW, IH);
    if (glow !== undefined) {
      var rg = g.createRadialGradient(IW * 0.5, IH * 0.56, 0, IW * 0.5, IH * 0.56, IW * 0.62);
      rg.addColorStop(0, rgba(glow, 0.38)); rg.addColorStop(1, rgba(glow, 0));
      g.fillStyle = rg; g.fillRect(0, 0, IW, IH);
    }
  }
  function iground(color, a) {
    var g = IG;
    g.save();
    var rg = g.createRadialGradient(IW * 0.5, IH * 0.9, 0, IW * 0.5, IH * 0.9, IW * 0.46);
    rg.addColorStop(0, rgba(color === undefined ? 0xffffff : color, a === undefined ? 0.28 : a)); rg.addColorStop(1, rgba(color === undefined ? 0xffffff : color, 0));
    g.translate(0, IH * 0.9); g.scale(1, 0.34); g.translate(0, -IH * 0.9);
    g.fillStyle = rg; g.beginPath(); g.arc(IW * 0.5, IH * 0.9, IW * 0.46, 0, TAU); g.fill();
    g.restore();
  }
  /* small egg-thief silhouette standing at (cx, feet) with height h (fractions) */
  function ichar(cx, feet, h) {
    var g = IG, x = cx * IW, y = feet * IH, H = h * IH, u = H / 10;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.32)'; g.beginPath(); g.ellipse(x, y, u * 2.9, u * 0.8, 0, 0, TAU); g.fill();
    g.fillStyle = '#1f3b2c'; roundRect(g, x - u * 1.55, y - u * 3.3, u * 1.35, u * 3.3, u * 0.35); g.fill(); roundRect(g, x + u * 0.2, y - u * 3.3, u * 1.35, u * 3.3, u * 0.35); g.fill();
    g.fillStyle = '#ffd5b0'; roundRect(g, x - u * 3.0, y - u * 6.6, u * 1.2, u * 3.2, u * 0.4); g.fill(); roundRect(g, x + u * 1.8, y - u * 6.6, u * 1.2, u * 3.2, u * 0.4); g.fill();
    g.fillStyle = '#2a2d36'; roundRect(g, x - u * 3.0, y - u * 6.7, u * 1.2, u * 2.0, u * 0.4); g.fill(); roundRect(g, x + u * 1.8, y - u * 6.7, u * 1.2, u * 2.0, u * 0.4); g.fill();
    g.fillStyle = '#2a2d36'; roundRect(g, x - u * 1.9, y - u * 6.9, u * 3.8, u * 3.8, u * 0.5); g.fill();
    g.fillStyle = '#ffd5b0'; roundRect(g, x - u * 1.7, y - u * 9.9, u * 3.4, u * 3.2, u * 0.7); g.fill();
    g.fillStyle = '#c8692b'; roundRect(g, x - u * 1.85, y - u * 10.3, u * 3.7, u * 1.5, u * 0.7); g.fill();
    g.fillStyle = '#2b2018'; g.beginPath(); g.arc(x - u * 0.7, y - u * 8.3, u * 0.22, 0, TAU); g.arc(x + u * 0.7, y - u * 8.3, u * 0.22, 0, TAU); g.fill();
    g.restore();
  }
  /* points on an ellipse: fn(i, x, y, front) where front = lower half (nearer the viewer) */
  function iring(n, cx, cy, rx, ry, phase, fn) {
    for (var i = 0; i < n; i++) {
      var a = phase + i / n * TAU;
      fn(i, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, Math.sin(a) > 0);
    }
  }

  /* ---- aura icons: fn(front) is called twice, before and after the character is drawn */
  var ICON_AURA = {
    sparkles: { bg: [0x2a1f55, 0x0e0a22, 0xffd45a], fn: function (f) {
      iring(11, 0.5, 0.6, 0.32, 0.11, 0.3, function (i, x, y, fr) { if (fr === f) ispr('sparkle', x, y, i % 3 === 0 ? 0.22 : 0.14, ipick([0xffffff, 0xfff2a8, 0xffd45a]), i, 1, true); });
      if (f) ispr('sparkle', 0.5, 0.2, 0.26, 0xffffff, 0, 1, true);
    } },
    fireflies: { bg: [0x14301f, 0x07140c, 0xd9ff5a], fn: function (f) {
      if (!f) return;
      for (var i = 0; i < 9; i++) { var x = ir(0.12, 0.88), y = ir(0.18, 0.8); ispr('glow', x, y, 0.22, 0xc8ff4a, 0, 0.55, true); ispr('ember', x, y, 0.15, 0xe9ff6a, 0, 1, true); }
    } },
    bubbles: { bg: [0x1d4a78, 0x0b2038, 0xbfe8ff], fn: function (f) {
      if (!f) return;
      var p = [[0.22, 0.66, 0.2], [0.78, 0.5, 0.26], [0.3, 0.3, 0.16], [0.72, 0.22, 0.14], [0.14, 0.42, 0.1], [0.86, 0.76, 0.12], [0.5, 0.14, 0.12]];
      for (var i = 0; i < p.length; i++) ispr('bubble', p[i][0], p[i][1], p[i][2], ipick([0xbfe8ff, 0xd8ffee, 0xffd8f4, 0xffffff]), 0, 0.95, true);
    } },
    leaves: { bg: [0x1f4a2a, 0x0b1c10, 0x7be04f], fn: function (f) {
      for (var i = 0; i < 10; i++) {
        var t = i / 10, an = t * TAU * 1.5 + 0.4, x = 0.5 + Math.cos(an) * 0.3, y = 0.82 - t * 0.5 + Math.sin(an) * 0.05, fr = Math.sin(an) > 0;
        if (fr === f) ispr('leaf', x, y, 0.2, ipick([0x3ecb4a, 0x7be04f, 0xb6e84a, 0xe8a23a, 0x2f9e44]), an + 1.2, 1, false);
      }
    } },
    hearts: { bg: [0x4a1f3a, 0x1c0a16, 0xff6fa8], fn: function (f) {
      if (!f) return;
      var p = [[0.3, 0.3, 0.22, -0.3], [0.7, 0.24, 0.26, 0.25], [0.2, 0.58, 0.16, 0.2], [0.8, 0.56, 0.18, -0.2], [0.5, 0.12, 0.14, 0.1], [0.36, 0.78, 0.12, -0.1]];
      for (var i = 0; i < p.length; i++) ispr('heart', p[i][0], p[i][1], p[i][2], ipick([0xff6fa8, 0xff4d6d, 0xffa3c4, 0xff8fb8]), p[i][3], 1, false);
    } },
    snowcloud: { bg: [0x2a4a78, 0x0e1c38, 0xcfe8ff], fn: function (f) {
      if (!f) return;
      ispr('cloud', 0.5, 0.2, 0.62, 0xf4f8ff, 0, 1, false);
      for (var i = 0; i < 14; i++) ispr(i % 2 ? 'flake' : 'disc', ir(0.2, 0.8), ir(0.34, 0.88), ir(0.05, 0.1), 0xffffff, ir(0, 3), 0.95, true);
    } },
    notes: { bg: [0x2a1f55, 0x0e0a22, 0xff6ad5], fn: function (f) {
      if (!f) return;
      var p = [[0.26, 0.32, 0.22], [0.74, 0.24, 0.2], [0.2, 0.62, 0.18], [0.8, 0.58, 0.22], [0.5, 0.12, 0.17]];
      for (var i = 0; i < p.length; i++) ispr(i % 2 ? 'note' : 'note2', p[i][0], p[i][1], p[i][2], hsv(i / 5 + 0.05, 0.65, 1), ir(-0.3, 0.3), 1, false);
    } },
    candy: { bg: [0x4a2a5a, 0x1c0f24, 0xff9ad0], fn: function (f) {
      if (!f) return;
      for (var i = 0; i < 9; i++) ispr('sprinkle', ir(0.12, 0.88), ir(0.14, 0.84), 0.11, ipick([0xff6ab4, 0x5ad8ff, 0xffe14a, 0x8aff7a, 0xffffff, 0xc58bff]), ir(0, 3.1), 1, false);
      ispr('candy', 0.24, 0.3, 0.26, 0xff7ac0, 0.3, 1, false); ispr('candy', 0.78, 0.6, 0.22, 0x6ad8ff, -0.4, 1, false);
      ispr('sparkle', 0.7, 0.18, 0.14, 0xffffff, 0, 1, true);
    } },
    petals: { bg: [0x4a2a3f, 0x1c0f18, 0xffb7d5], fn: function (f) {
      if (!f) return;
      for (var i = 0; i < 11; i++) ispr('petal', ir(0.12, 0.88), ir(0.1, 0.88), ir(0.13, 0.2), ipick([0xffb7d5, 0xff8fb8, 0xffe0ee, 0xffffff]), ir(0, 6.2), 1, false);
    } },
    flames: { bg: [0x3a1408, 0x120502, 0xff7a20], fn: function (f) {
      if (!f) { iground(0xff7a20, 0.5); return; }
      var p = [[0.3, 0.84, 0.3], [0.7, 0.84, 0.3], [0.2, 0.7, 0.24], [0.8, 0.7, 0.24], [0.4, 0.78, 0.34], [0.62, 0.78, 0.34], [0.5, 0.5, 0.28], [0.34, 0.46, 0.2], [0.66, 0.46, 0.2]];
      for (var i = 0; i < p.length; i++) ispr('flame', p[i][0], p[i][1] - p[i][2] * 0.2, p[i][2], i % 2 ? 0xffc040 : 0xff6a20, ir(-0.15, 0.15), 1, true);
      for (var j = 0; j < 8; j++) ispr('ember', ir(0.2, 0.8), ir(0.12, 0.6), 0.07, 0xffb040, 0, 1, true);
    } },
    stars: { bg: [0x1a2255, 0x080b22, 0xffe27a], fn: function (f) {
      if (!f) return;
      var p = [[0.24, 0.36], [0.62, 0.24], [0.8, 0.52], [0.42, 0.62], [0.14, 0.7]];
      for (var i = 0; i < p.length; i++) { istreak(p[i][0] - 0.07, p[i][1] - 0.12, 0.34, 0.07, 0.5, 0.86, 0xffd45a, 0.85); ispr('star', p[i][0], p[i][1], 0.16, 0xfff6c0, ir(-0.5, 0.5), 1, true); }
    } },
    glitter: { bg: [0x3a2a0a, 0x140e02, 0xffd24a], fn: function (f) {
      if (!f) return;
      for (var i = 0; i < 26; i++) ispr('sparkle', 0.5 + ir(-0.36, 0.36), 0.52 + ir(-0.36, 0.34), ir(0.06, 0.15), ipick([0xffffff, 0xfff3b0, 0xffd24a, 0xffc83d]), ir(0, 1), 1, true);
    } },
    ghost: { bg: [0x18304a, 0x070f1c, 0xbff6ff], fn: function (f) {
      if (!f) return;
      ispr('wisp', 0.24, 0.5, 0.34, 0xbff6ff, 0.4, 0.9, true); ispr('wisp', 0.78, 0.4, 0.3, 0x9adcff, 3.4, 0.9, true); ispr('wisp', 0.66, 0.78, 0.24, 0xd8f4ff, 1.8, 0.8, true);
      ispr('ghost', 0.8, 0.16, 0.26, 0xd8f4ff, 0.1, 0.85, true);
      for (var i = 0; i < 6; i++) ispr('dot', ir(0.1, 0.9), ir(0.2, 0.9), 0.06, 0xcfeeff, 0, 0.8, true);
    } },
    frost: { bg: [0x1d4a78, 0x0a1f38, 0xbfeaff], fn: function (f) {
      if (!f) { iground(0xbfeaff, 0.5); return; }
      for (var i = 0; i < 5; i++) ispr('flake', ir(0.14, 0.86), ir(0.14, 0.7), ir(0.12, 0.2), 0xe6f6ff, ir(0, 1), 1, true);
      ispr('shard', 0.22, 0.62, 0.16, 0xcdf1ff, 0.3, 1, false); ispr('shard', 0.8, 0.44, 0.14, 0xcdf1ff, -0.4, 1, false); ispr('shard', 0.7, 0.8, 0.12, 0xbfe3ff, 0.9, 1, false);
      for (var j = 0; j < 8; j++) ispr('sparkle', ir(0.1, 0.9), ir(0.12, 0.8), 0.1, 0xffffff, 0, 1, true);
    } },
    lightning: { bg: [0x1a1f50, 0x070a24, 0x9fd8ff], fn: function (f) {
      if (!f) return;
      ispr('bolt', 0.24, 0.42, 0.34, 0xffffff, 0.15, 1, true); ispr('bolt', 0.78, 0.34, 0.3, 0xcfe6ff, -0.2, 1, true); ispr('bolt', 0.7, 0.72, 0.22, 0xffffff, 0.3, 1, true);
      for (var i = 0; i < 9; i++) { var a = ir(0, TAU); istreak(0.5 + Math.cos(a) * 0.3, 0.55 + Math.sin(a) * 0.3, 0.18, 0.03, Math.cos(a), Math.sin(a), ipick([0xfff6a0, 0x9fd8ff]), 1); }
    } },
    rainbow: { bg: [0x24204a, 0x0c0a1e, 0xff9ad0], fn: function (f) {
      if (!f) { iground(0xffffff, 0.3); }
      iring(28, 0.5, 0.58, 0.33, 0.12, 0.2, function (i, x, y, fr) { if (fr === f) ispr('dot', x, y, 0.1, hsv(i / 28, 0.85, 1), 0, 1, true); });
      if (f) ispr('ring', 0.5, 0.9, 0.7, 0xffd0f0, 0, 0.6, true, 0.3);
    } },
    coins: { bg: [0x3a2a0a, 0x140e02, 0xffc83d], fn: function (f) {
      iring(6, 0.5, 0.56, 0.34, 0.11, 0.5, function (i, x, y, fr) { if (fr === f) ispr('coin', x, y, 0.2, ipick([0xffc83d, 0xffd860]), 0, 1, false); });
      if (f) { ispr('sparkle', 0.2, 0.4, 0.14, 0xffffff, 0, 1, true); ispr('sparkle', 0.82, 0.3, 0.12, 0xffffff, 0, 1, true); }
    } },
    shadow: { bg: [0x7a5ab8, 0x2b1d4a, 0xb04bff], fn: function (f) {
      if (!f) { ispr('smoke', 0.3, 0.62, 0.42, 0x2a1346, 0, 0.9, false); ispr('smoke', 0.72, 0.58, 0.42, 0x2a1346, 2, 0.9, false); return; }
      ispr('smoke', 0.4, 0.84, 0.36, 0x1a0d30, 0, 0.9, false); ispr('smoke', 0.62, 0.8, 0.36, 0x1a0d30, 3, 0.9, false); ispr('smoke', 0.5, 0.2, 0.4, 0x2a1346, 1, 0.85, false);
      ispr('smoke', 0.24, 0.36, 0.3, 0x3a1a60, 1, 0.8, false); ispr('smoke', 0.78, 0.34, 0.3, 0x3a1a60, 4, 0.8, false);
      for (var i = 0; i < 6; i++) ispr('ember', ir(0.2, 0.8), ir(0.2, 0.8), 0.08, 0xc060ff, 0, 1, true);
    } },
    galaxy: { bg: [0x181040, 0x05031a, 0x9a6cff], fn: function (f) {
      if (!f) { ispr('glow', 0.5, 0.55, 0.9, 0x7a4cff, 0, 0.7, true); }
      for (var arm = 0; arm < 2; arm++) for (var j = 0; j < 16; j++) {
        var r = 0.38 * (1 - j / 16), an = arm * PI + j * 0.5 + 0.4, x = 0.5 + Math.cos(an) * r, y = 0.58 + Math.sin(an) * r * 0.42, fr = Math.sin(an) > 0;
        if (fr === f) ispr('dot', x, y, 0.05 + (1 - j / 16) * 0.05, ipick([0xb58cff, 0x7aa8ff, 0xff9be8, 0xffffff]), 0, 1, true);
      }
      if (f) { ispr('sparkle', 0.5, 0.18, 0.18, 0xffffff, 0, 1, true); ispr('sparkle', 0.2, 0.3, 0.12, 0xc7b0ff, 0, 1, true); }
    } },
    sun: { bg: [0x5a2a0a, 0x1c0c02, 0xffb02e], fn: function (f) {
      if (!f) { ispr('glow', 0.5, 0.5, 1.0, 0xffb02e, 0, 0.8, true); ispr('rays', 0.5, 0.5, 1.0, 0xffe27a, 0.2, 0.9, true); return; }
      for (var i = 0; i < 10; i++) { var a = i / 10 * TAU + 0.2; istreak(0.5 + Math.cos(a) * 0.3, 0.52 + Math.sin(a) * 0.3, 0.2, 0.035, Math.cos(a), Math.sin(a), 0xffd24a, 1); }
      ispr('sparkle', 0.2, 0.28, 0.14, 0xffffff, 0, 1, true); ispr('sparkle', 0.8, 0.7, 0.12, 0xffffff, 0, 1, true);
    } }
  };

  /* ---- victory icons: fn() draws the whole scene */
  function iarc(cx, cy, r, a0, a1, color, w, alpha) {
    IG.save(); IG.strokeStyle = css(color); IG.lineWidth = w * IW; IG.globalAlpha = alpha === undefined ? 1 : alpha; IG.lineCap = 'round';
    IG.beginPath(); IG.arc(cx * IW, cy * IH, r * IW, a0, a1); IG.stroke(); IG.restore();
  }
  function iline(x0, y0, x1, y1, color, w, alpha, add) {
    IG.save(); IG.strokeStyle = css(color); IG.lineWidth = w * IW; IG.globalAlpha = alpha === undefined ? 1 : alpha; IG.lineCap = 'round';
    if (add) IG.globalCompositeOperation = 'lighter';
    IG.beginPath(); IG.moveTo(x0 * IW, y0 * IH); IG.lineTo(x1 * IW, y1 * IH); IG.stroke(); IG.restore();
  }
  var ICON_VICT = {
    confetti_cannon: { bg: [0x2a2a5a, 0x0e0e24, 0xffd23f], fn: function () {
      for (var s = -1; s <= 1; s += 2) {
        var bx = 0.5 + s * 0.4, by = 0.92;
        IG.save(); IG.translate(bx * IW, by * IH); IG.rotate(-s * 0.55); IG.fillStyle = '#c0c4d4'; roundRect(IG, -0.06 * IW, -0.22 * IH, 0.12 * IW, 0.24 * IH, 5); IG.fill();
        IG.fillStyle = '#ff4d6d'; IG.fillRect(-0.06 * IW, -0.1 * IH, 0.12 * IW, 0.04 * IH); IG.restore();
        ispr('glow', bx - s * 0.1, by - 0.2, 0.2, 0xffe27a, 0, 0.9, true);
        for (var i = 0; i < 16; i++) { var t = i / 16, x = bx - s * (0.08 + t * 0.34) + ir(-0.04, 0.04), y = by - 0.2 - Math.sin(t * PI * 0.9) * 0.5 + t * 0.2 + ir(-0.04, 0.04); ispr('confetti', x, y, ir(0.07, 0.1), ipick(PAL_CONF), ir(0, 6), 1, false); }
      }
    } },
    balloons: { bg: [0x3a78c0, 0x14304e, 0xffffff], fn: function () {
      var p = [[0.24, 0.4, 0.42, 0xff4d6d, -0.15], [0.5, 0.3, 0.46, 0xffd23f, 0.05], [0.77, 0.42, 0.4, 0x3bd16f, 0.15], [0.36, 0.7, 0.3, 0x35b6ff, 0.1], [0.66, 0.72, 0.32, 0xb46bff, -0.1]];
      for (var i = 0; i < p.length; i++) ispr('balloon', p[i][0], p[i][1], p[i][2], p[i][3], p[i][4], 1, false);
      for (var j = 0; j < 5; j++) ispr('sparkle', ir(0.1, 0.9), ir(0.1, 0.9), 0.1, 0xffffff, 0, 0.9, true);
    } },
    bubble_burst: { bg: [0x1d4a78, 0x0b2038, 0xbfe8ff], fn: function () {
      ispr('glow', 0.5, 0.55, 0.5, 0xcfeaff, 0, 0.8, true);
      for (var i = 0; i < 12; i++) { var a = i / 12 * TAU + 0.3, r = ir(0.16, 0.38); ispr('bubble', 0.5 + Math.cos(a) * r, 0.52 + Math.sin(a) * r, ir(0.09, 0.26), ipick([0xbfe8ff, 0xd8ffee, 0xffd8f4, 0xffffff]), 0, 0.95, true); }
    } },
    snow_burst: { bg: [0x2a4a78, 0x0e1c38, 0xcfe8ff], fn: function () {
      iground(0xcfeaff, 0.5);
      ispr('ring', 0.5, 0.86, 0.82, 0xcfeaff, 0, 0.8, true, 0.3);
      ispr('glow', 0.5, 0.52, 0.5, 0xcfeaff, 0, 0.8, true);
      for (var i = 0; i < 16; i++) { var a = i / 16 * TAU + 0.2, r = ir(0.14, 0.4); ispr(i % 3 ? 'flake' : 'disc', 0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r * 0.9, ir(0.08, 0.16), 0xf2faff, ir(0, 3), 1, true); }
    } },
    heart_explosion: { bg: [0x4a1f3a, 0x1c0a16, 0xff6fa8], fn: function () {
      for (var i = 0; i < 26; i++) { var t = i / 26 * TAU, hx = 16 * Math.pow(Math.sin(t), 3), hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); ispr('sparkle', 0.5 + hx * 0.021, 0.46 - hy * 0.021, 0.1, i % 2 ? 0xffffff : 0xff9fc4, 0, 1, true); }
      ispr('heart', 0.5, 0.48, 0.3, 0xff4d6d, 0, 1, false); ispr('heart', 0.2, 0.2, 0.14, 0xffa3c4, -0.3, 1, false); ispr('heart', 0.82, 0.78, 0.16, 0xff6fa8, 0.3, 1, false); ispr('heart', 0.8, 0.18, 0.1, 0xffffff, 0.2, 1, false);
    } },
    coin_rain: { bg: [0x3a2a0a, 0x140e02, 0xffc83d], fn: function () {
      for (var i = 0; i < 10; i++) { var x = ir(0.1, 0.9), y = ir(0.2, 0.82); iline(x + 0.03, y - 0.22, x + 0.01, y - 0.1, 0xffe27a, 0.012, 0.5, true); ispr('coin', x, y, ir(0.16, 0.22), ipick([0xffc83d, 0xffd860]), ir(-0.3, 0.3), 1, false, ir(0.7, 1)); }
      ispr('sparkle', 0.3, 0.9, 0.14, 0xffffff, 0, 1, true); ispr('sparkle', 0.7, 0.92, 0.12, 0xffffff, 0, 1, true);
    } },
    petal_storm: { bg: [0x4a2a3f, 0x1c0f18, 0xffb7d5], fn: function () {
      for (var i = 0; i < 18; i++) { var t = i / 18, an = t * TAU * 1.7, r = 0.08 + t * 0.34, x = 0.5 + Math.cos(an) * r, y = 0.88 - t * 0.7 + Math.sin(an) * r * 0.25; ispr('petal', x, y, 0.1 + t * 0.1, ipick([0xffb7d5, 0xff8fb8, 0xffe0ee, 0xffffff]), an + 1.6, 1, false); }
    } },
    candy_rain: { bg: [0x4a2a5a, 0x1c0f24, 0xff9ad0], fn: function () {
      for (var i = 0; i < 12; i++) ispr('sprinkle', ir(0.08, 0.92), ir(0.1, 0.9), 0.1, ipick([0xff6ab4, 0x5ad8ff, 0xffe14a, 0x8aff7a, 0xc58bff]), ir(-0.6, 0.6), 1, false);
      var c = [[0.22, 0.3, 0xff7ac0], [0.6, 0.2, 0x6ad8ff], [0.8, 0.52, 0xffd24a], [0.4, 0.62, 0xa88aff], [0.2, 0.78, 0x8aff7a]];
      for (var j = 0; j < c.length; j++) ispr('candy', c[j][0], c[j][1], 0.22, c[j][2], ir(-0.6, 0.6), 1, false);
    } },
    feather_burst: { bg: [0x2a3a68, 0x0c1228, 0xfff3c0], fn: function () {
      ispr('glow', 0.5, 0.52, 0.9, 0xfff3c0, 0, 0.7, true);
      for (var i = 0; i < 9; i++) { var a = i / 9 * TAU + 0.3, r = ir(0.22, 0.36); ispr('feather', 0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 0.24, 0xffffff, a + 1.57, 1, false); }
      for (var j = 0; j < 8; j++) ispr('sparkle', ir(0.1, 0.9), ir(0.1, 0.9), 0.1, 0xfff3c0, 0, 1, true);
    } },
    fireworks: { bg: [0x0f1030, 0x04040f, 0x3a4a9a], fn: function () {
      var B = [[0.3, 0.34, 0.2, 0xff4d6d], [0.72, 0.28, 0.22, 0xffd23f], [0.55, 0.62, 0.18, 0x35b6ff]];
      for (var b = 0; b < 3; b++) {
        var cx = B[b][0], cy = B[b][1], R = B[b][2];
        ispr('glow', cx, cy, R * 1.6, B[b][3], 0, 0.8, true);
        for (var i = 0; i < 16; i++) { var a = i / 16 * TAU + b; iline(cx + Math.cos(a) * R * 0.35, cy + Math.sin(a) * R * 0.35, cx + Math.cos(a) * R, cy + Math.sin(a) * R, B[b][3], 0.014, 1, true); ispr('dot', cx + Math.cos(a) * R * 1.06, cy + Math.sin(a) * R * 1.06, 0.045, 0xffffff, 0, 1, true); }
        ispr('burst', cx, cy, R * 1.2, 0xffffff, 0, 0.9, true);
      }
      iline(0.55, 0.98, 0.55, 0.78, 0xffe27a, 0.012, 0.9, true);
    } },
    star_nova: { bg: [0x2a2056, 0x0c0a22, 0xffe27a], fn: function () {
      ispr('burst', 0.5, 0.52, 0.9, 0xffe27a, 0, 1, true); ispr('glow', 0.5, 0.52, 0.5, 0xffffff, 0, 0.9, true);
      iring(12, 0.5, 0.52, 0.42, 0.14, 0.2, function (i, x, y) { ispr('star', x, y, 0.12, i % 2 ? 0xffffff : 0xffd24a, i, 1, true); });
      iring(10, 0.5, 0.52, 0.16, 0.4, 0.5, function (i, x, y) { ispr('star', x, y, 0.1, 0xfff0a0, i, 1, true); });
    } },
    egg_fountain: { bg: [0x2a4a78, 0x0e1c38, 0xffe27a], fn: function () {
      iground(0xffe27a, 0.4);
      var cols = [0xffd24a, 0xff9ad0, 0x6ad8ff, 0x9af07a, 0xc58bff];
      for (var i = 0; i < 5; i++) { var t = (i - 2) / 2.2; ispr('egg', 0.5 + t * 0.3, 0.3 + Math.abs(t) * 0.22 + (i === 2 ? -0.08 : 0), i === 2 ? 0.28 : 0.2, cols[i], t * 0.6, 1, false); }
      for (var j = 0; j < 14; j++) { var u = ir(-1, 1); ispr('dot', 0.5 + u * ir(0.05, 0.3), 0.85 - Math.abs(ir(0, 1)) * 0.5, 0.05, 0xcfeaff, 0, 0.9, true); }
      ispr('ring', 0.5, 0.88, 0.5, 0xffe27a, 0, 0.9, true, 0.3);
    } },
    music_party: { bg: [0x2a1f55, 0x0e0a22, 0xff6ad5], fn: function () {
      for (var r = 0; r < 3; r++) ispr('ring', 0.5, 0.86, 0.5 + r * 0.22, PAL_RAINBOW[r * 2], 0, 0.85 - r * 0.2, true, 0.3);
      var p = [[0.22, 0.34], [0.5, 0.2], [0.78, 0.36], [0.34, 0.58], [0.66, 0.6]];
      for (var i = 0; i < p.length; i++) ispr(i % 2 ? 'note' : 'note2', p[i][0], p[i][1], 0.22, hsv(i / 5 + 0.05, 0.65, 1), ir(-0.3, 0.3), 1, false);
      for (var j = 0; j < 6; j++) ispr('sparkle', ir(0.1, 0.9), ir(0.1, 0.9), 0.09, 0xffffff, 0, 1, true);
    } },
    rainbow_arc: { bg: [0x4a90d8, 0x1c3a62, 0xffffff], fn: function () {
      for (var b = 0; b < 7; b++) iarc(0.5, 0.82, 0.42 - b * 0.04, PI, TAU, PAL_RAINBOW[b], 0.045, 0.95);
      ispr('cloud', 0.1, 0.84, 0.34, 0xffffff, 0, 1, false); ispr('cloud', 0.9, 0.84, 0.34, 0xffffff, 0, 1, false); ispr('cloud', 0.2, 0.9, 0.26, 0xf4f8ff, 0, 1, false); ispr('cloud', 0.8, 0.9, 0.26, 0xf4f8ff, 0, 1, false);
      for (var j = 0; j < 6; j++) ispr('sparkle', ir(0.15, 0.85), ir(0.1, 0.6), 0.09, 0xffffff, 0, 1, true);
    } },
    golden_pillar: { bg: [0x2a2008, 0x0c0902, 0xffd24a], fn: function () {
      var cv = tintedSprite('beam', 0xffd24a);
      IG.save(); IG.globalCompositeOperation = 'lighter'; IG.drawImage(cv, IW * 0.18, -IH * 0.05, IW * 0.64, IH * 1.0); IG.drawImage(tintedSprite('beam', 0xffffff), IW * 0.36, IH * 0.05, IW * 0.28, IH * 0.9); IG.restore();
      ispr('ring', 0.5, 0.88, 0.8, 0xffd24a, 0, 1, true, 0.3); ispr('ring', 0.5, 0.88, 0.5, 0xffffff, 0, 0.9, true, 0.3); ispr('glow', 0.5, 0.88, 0.6, 0xffe27a, 0, 0.8, true, 0.5);
      for (var i = 0; i < 12; i++) ispr('sparkle', 0.5 + ir(-0.25, 0.25), ir(0.1, 0.8), ir(0.06, 0.12), ipick(PAL_GOLD), 0, 1, true);
    } },
    lightning_strike: { bg: [0x2a3050, 0x0a0c1c, 0x9fd8ff], fn: function () {
      ispr('smoke', 0.3, 0.1, 0.6, 0x3a4058, 0, 1, false); ispr('smoke', 0.72, 0.08, 0.6, 0x2c3248, 1, 1, false);
      var pts = [[0.55, 0.12], [0.46, 0.3], [0.58, 0.42], [0.44, 0.6], [0.52, 0.74], [0.5, 0.88]];
      for (var pass = 0; pass < 3; pass++) {
        IG.save(); IG.globalCompositeOperation = 'lighter'; IG.lineJoin = 'round'; IG.lineCap = 'round';
        IG.strokeStyle = pass === 0 ? 'rgba(90,150,255,0.35)' : (pass === 1 ? 'rgba(180,220,255,0.7)' : '#ffffff'); IG.lineWidth = IW * (pass === 0 ? 0.09 : (pass === 1 ? 0.04 : 0.018));
        IG.beginPath(); IG.moveTo(pts[0][0] * IW, pts[0][1] * IH); for (var k = 1; k < pts.length; k++) IG.lineTo(pts[k][0] * IW, pts[k][1] * IH); IG.stroke(); IG.restore();
      }
      ispr('glow', 0.5, 0.88, 0.7, 0xcfe6ff, 0, 1, true, 0.55); ispr('ring', 0.5, 0.9, 0.8, 0xbfe3ff, 0, 0.9, true, 0.3);
      for (var i = 0; i < 8; i++) { var a = ir(PI, TAU); istreak(0.5 + Math.cos(a) * 0.1, 0.86 + Math.sin(a) * 0.05, 0.18, 0.03, Math.cos(a), Math.sin(a), 0xffffff, 1); }
    } },
    magic_circle: { bg: [0x20184a, 0x0a0820, 0xb06bff], fn: function () {
      var cv = tintedSprite('beam', 0xb06bff);
      IG.save(); IG.globalCompositeOperation = 'lighter'; IG.globalAlpha = 0.6; IG.drawImage(cv, IW * 0.2, IH * 0.02, IW * 0.6, IH * 0.78); IG.restore();
      ispr('rune', 0.5, 0.78, 0.96, 0xb06bff, 0, 1, true, 0.4); ispr('rune', 0.5, 0.78, 0.55, 0xffffff, 0.6, 0.9, true, 0.4);
      for (var i = 0; i < 16; i++) ispr('sparkle', 0.5 + ir(-0.3, 0.3), ir(0.12, 0.76), ir(0.06, 0.13), ipick([0xffffff, 0xd0a0ff, 0x8ad8ff]), 0, 1, true);
    } },
    fire_ring: { bg: [0x3a1408, 0x120502, 0xff7a20], fn: function () {
      iground(0xff7a20, 0.5);
      ispr('ring', 0.5, 0.74, 0.9, 0xff7a20, 0, 0.9, true, 0.34);
      iring(14, 0.5, 0.7, 0.4, 0.14, 0.1, function (i, x, y) { ispr('flame', x, y - 0.1, ir(0.22, 0.3), i % 2 ? 0xffc040 : 0xff6a20, ir(-0.15, 0.15), 1, true); });
      for (var j = 0; j < 8; j++) ispr('ember', ir(0.15, 0.85), ir(0.1, 0.55), 0.06, 0xffb040, 0, 1, true);
    } },
    meteor_shower: { bg: [0x0f1030, 0x04040f, 0x3a4a9a], fn: function () {
      var M = [[0.26, 0.3, 0xffc060], [0.5, 0.5, 0xffe9a0], [0.74, 0.38, 0xff7a3a], [0.38, 0.8, 0x9fd8ff]];
      for (var i = 0; i < M.length; i++) {
        istreak(M[i][0] + 0.12, M[i][1] - 0.2, 0.5, 0.07, -0.5, 0.86, M[i][2], 1);
        ispr('glow', M[i][0], M[i][1], 0.2, M[i][2], 0, 0.9, true); ispr('star', M[i][0], M[i][1], 0.1, 0xffffff, 0.3, 1, true);
      }
      for (var j = 0; j < 8; j++) ispr('sparkle', ir(0.08, 0.92), ir(0.08, 0.92), 0.07, 0xffffff, 0, 0.9, true);
      ispr('glow', 0.5, 0.96, 0.7, 0xffc060, 0, 0.5, true, 0.4);
    } },
    galaxy_swirl: { bg: [0x181040, 0x05031a, 0x9a6cff], fn: function () {
      ispr('glow', 0.5, 0.5, 0.9, 0x7a4cff, 0, 0.8, true);
      for (var arm = 0; arm < 2; arm++) for (var j = 0; j < 20; j++) {
        var r = 0.44 * (1 - j / 20), an = arm * PI + j * 0.46, x = 0.5 + Math.cos(an) * r, y = 0.5 + Math.sin(an) * r * 0.62;
        ispr('dot', x, y, 0.05 + (1 - j / 20) * 0.06, ipick([0xb58cff, 0x7aa8ff, 0xff9be8, 0xffffff]), 0, 1, true);
      }
      ispr('burst', 0.5, 0.5, 0.4, 0xffffff, 0.2, 1, true);
    } }
  };

  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* Draws a preview of an aura / victory into a 2D canvas (fills it). Returns true when drawn. */
  function drawIcon(kind, id, canvas) {
    var spec = kind === 'aura' ? ICON_AURA : (kind === 'victory' ? ICON_VICT : null);
    if (!spec || !spec[id] || !canvas || !canvas.getContext) return false;
    var g = canvas.getContext('2d');
    if (!g || !document) return false;
    ensureAtlas(128);
    var e = spec[id];
    IG = g; IW = canvas.width; IH = canvas.height; IR = seeded(hashStr(kind + id));
    g.save();
    g.clearRect(0, 0, IW, IH);
    var rad = Math.min(IW, IH) * 0.1;
    roundRect(g, 0, 0, IW, IH, rad); g.clip();
    ibg(e.bg[0], e.bg[1], e.bg[2]);
    if (kind === 'aura') { e.fn(false); ichar(0.5, 0.9, 0.62); IR = seeded(hashStr(kind + id)); e.fn(true); }
    else e.fn();
    g.restore();
    IG = null;
    return true;
  }

  /* ================================================================== API */
  function defaultQuality() {
    try {
      var s = SE.State && SE.State.data && SE.State.data.settings && SE.State.data.settings.quality;
      if (BUDGETS[s]) return s;
    } catch (e) { /* ignore */ }
    return (SE.Platform && SE.Platform.isMobile) ? 'medium' : 'high';
  }

  function rebuildTexture() {
    var old = texture;
    texture = makeTexture();
    sysN.mat.uniforms.uMap.value = texture;
    sysA.mat.uniforms.uMap.value = texture;
    if (old) old.dispose();
  }

  function setQuality(q) {
    if (!BUDGETS[q]) q = 'high';
    QUALITY = q;
    budget = BUDGETS[q]; QS = QSCALES[q];
    cap0 = Math.floor(budget * 0.22); cap1 = Math.floor(budget * 0.45);
    var cs = q === 'low' ? 64 : 128;
    if (cs !== cellPx) {
      var oldCs = cellPx;
      cellPx = cs;
      if (inited) rebuildTexture();
      if (oldCs !== 128) delete atlases[oldCs];
    }
    if (live > budget) trimToBudget();
  }

  function init(sc, cam) {
    if (!sc) return;
    if (inited) {
      if (cam) camera = cam;
      if (sc !== scene) {
        if (group.parent) group.parent.remove(group);
        scene = sc; scene.add(group);
      }
      return;
    }
    scene = sc; camera = cam || null;
    if (!QUALITY) setQuality(defaultQuality());
    texture = makeTexture();
    sysN = makeSystem(false, 998);
    sysA = makeSystem(true, 999);
    rib = makeRibbon();
    group = new T.Group();
    group.name = 'fx';
    group.add(rib.mesh); group.add(sysN.mesh); group.add(sysA.mesh);
    scene.add(group);
    inited = true;
    makeTextPool();
    if (pendingAura) { var p = pendingAura; pendingAura = null; setAura(p.id, p.target); }
  }

  function update(dt, time, playerPos) {
    if (!inited || !(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;
    now += dt;
    if (playerPos) { ppx = +playerPos.x || 0; ppy = +playerPos.y || 0; ppz = +playerPos.z || 0; }
    camBasis();
    updateAuras(dt);
    updateAmbient(dt);
    simulate(dt);
    updateRibbon(dt);
    updateTexts(dt);
  }

  function burst(name, pos, opts) {
    if (!inited) return;
    var fn = RECIPES[name];
    if (!fn) return;
    at(pos);
    PRIO = BURST_PRIO[name] !== undefined ? BURST_PRIO[name] : 3;
    fn(PX, PY, PZ, opts || NO_OPTS);
    PRIO = 2;
    xr();
  }
  var NO_OPTS = {};

  function clear() {
    if (!inited) return;
    clearPool();
    auras.length = 0;
    ribReset();
    TS.has = false; TS.acc = 0;
    clearTexts();
    for (var i = 0; i < ambAcc.length; i++) ambAcc[i] = 0;
    sysN.geo.instanceCount = 0; sysN.mesh.visible = false; sysN.n = 0;
    sysA.geo.instanceCount = 0; sysA.mesh.visible = false; sysA.n = 0;
  }

  function stats() {
    return { quality: QUALITY, budget: budget, live: live, normal: sysN ? sysN.n : 0, additive: sysA ? sysA.n : 0,
      auras: auras.length, ambient: ambReg.length, ribbon: rib ? rib.count : 0, inited: inited };
  }

  var AURAS = AURA_LIST, VICTORIES = VICTORY_LIST;
  var BURSTS = [];
  for (var bn in RECIPES) if (Object.prototype.hasOwnProperty.call(RECIPES, bn)) BURSTS.push(bn);

  SE.FX = {
    init: init, update: update, burst: burst, trail: trail, setAura: setAura, victory: victory,
    ambient: ambient, setQuality: setQuality, clear: clear, drawIcon: drawIcon,
    AURAS: AURAS, VICTORIES: VICTORIES,
    /* extras */
    text: text, clearAmbient: function () { ambReg.length = 0; }, stats: stats, BURSTS: BURSTS,
    getQuality: function () { return QUALITY; }
  };
})(window);
