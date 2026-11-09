/* =========================================================
   World: "Egg Islands" archipelago.
   A farm island (player base) in a turquoise sea, six land
   bridges to six biome islands. The logical layout (hub disc,
   causeways, gates, islands, pens, stalls, nests, colliders)
   is the same as before: bots navigate a fixed grid and guards
   patrol zone circles. Visuals are batched per region
   (SE.Batch) on a splatted terrain with sea and sky
   (SE.Terrain).

   Tuning: LOOK (sizes, fog, quality thinning), BIOME_LOOK
   (ground textures), BIOME_SET (props per island), HUB_PROPS.
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var U = SE.U, M = SE.Models, T = global.THREE;
  var B = SE.Batch, TR = SE.Terrain;

  /* ---------- logical layout: do not change (bots, guards, game use it) ---------- */
  var HUB_R = 86;          /* safe base radius */
  var GATE_DIST = 132;     /* distance of an island gate from the origin */
  var ZONE_DIST = 214;     /* distance of an island centre from the origin */
  var ZONE_HALF = 62;      /* island radius (ring of edge colliders) */
  var CORRIDOR_W = 30;
  var WALL_H = 28;         /* invisible edge colliders */

  var PEN_PRICES = [0, 500, 2500, 12000, 60000, 320000, 2500000, 25000000];
  var PEN_POS = [
    [-45, -58], [-15, -58], [15, -58], [45, -58],
    [-45, -26], [-15, -26], [15, -26], [45, -26]
  ];

  /* ---------- look: safe to tune ---------- */
  var LOOK = {
    hubLandR: 106,          /* coast of the farm island */
    islandLandR: 78,        /* coast of a biome island */
    causewayHalfW: 23,      /* half width of a land bridge (to the waterline) */
    fenceR: 87.6,           /* visual ring fence of the base */
    rimR: 58.5,             /* ring of themed rim pieces on an island */
    rimStep: 10.6,
    rimGap: 0.3,            /* radians kept open at an island entrance */
    fog: '#c4e7f3',
    fogNear: 0.42,          /* fog near = far * fogNear (far is set by game.js per quality) */
    sunDir: new T.Vector3(60, 120, 40).normalize(),
    keep: { low: 0.25, medium: 0.5, high: 0.7 },   /* share of trees/bushes/decor shown */
    thinMax: 0.7            /* thinnable candidates above this are never built */
  };

  var BIOME_LOOK = {
    forest: { top: 'forestTop', path: 'forestPath', shore: 'sand', scales: [0.075, 0.1, 0.09] },
    desert: { top: 'desertTop', path: 'desertPath', shore: 'desertShore', scales: [0.055, 0.1, 0.09] },
    candy: { top: 'candyTop', path: 'candyPath', shore: 'candyShore', scales: [0.08, 0.09, 0.1] },
    ice: { top: 'snowTop', path: 'snowPath', shore: 'iceShore', scales: [0.06, 0.08, 0.09] },
    volcano: { top: 'ashTop', path: 'ashPath', shore: 'volcanoShore', scales: [0.07, 0.1, 0.1], lava: true },
    sky: { top: 'marbleTop', path: 'skyPath', shore: 'skyShore', scales: [0.05, 0.08, 0.07] }
  };

  /* top: landmark height that carries the monument egg (contract);
     inner: big decor inside the island (always shown, with colliders);
     small: decor without colliders (thinned by quality);
     outer: trees/rocks outside the rim (thinned); shore: waterline pieces;
     pool: liquid pools { kind 0 water / 1 lava / 2 ice / 3 syrup, colours, sizes }. */
  var BIOME_SET = {
    forest: {
      top: 9, land: 15, egg: 8,
      inner: ['B_forest_tree', 'B_forest_pine', 'B_forest_tree'],
      small: ['B_forest_bush', 'B_forest_mushroom', 'B_forest_flowers', 'B_forest_log', 'B_forest_flowers'],
      outer: ['B_forest_tree', 'B_forest_pine', 'B_forest_bush', 'B_forest_pine'],
      shore: ['B_shore_rock', 'B_shore_reeds', 'B_shore_reeds'],
      pool: { kind: 0, a: '#2d86bd', b: '#5fcde6', c: '#eafcff', sizes: [6.5] }
    },
    desert: {
      top: 11, land: 18, egg: 7,
      inner: ['B_desert_cactus', 'B_desert_palm', 'B_desert_rock'],
      small: ['B_desert_cactus2', 'B_desert_bones', 'B_desert_rock', 'B_desert_cactus2'],
      outer: ['B_desert_palm', 'B_desert_cactus', 'B_desert_rock', 'B_desert_cactus2'],
      shore: ['B_shore_rock', 'B_desert_rock', 'B_shore_reeds'],
      pool: { kind: 0, a: '#1f9cbf', b: '#69e2dc', c: '#fff6d8', sizes: [7.5], palms: true }
    },
    candy: {
      top: 10, land: 17, egg: 7,
      inner: ['B_candy_lollipop', 'B_candy_cupcake', 'B_candy_lollipop'],
      small: ['B_candy_donut', 'B_candy_wrapped', 'B_candy_gumdrop', 'B_candy_donut'],
      outer: ['B_candy_lollipop', 'B_candy_gumdrop', 'B_candy_cupcake'],
      shore: ['B_candy_gumdrop', 'B_shore_rock', 'B_candy_wrapped'],
      pool: { kind: 3, a: '#6e3b22', b: '#ff86c4', c: '#fff0f6', sizes: [6.5, 4.5] }
    },
    ice: {
      top: 12, land: 15, egg: 7,
      inner: ['B_ice_crystal', 'B_ice_pine', 'B_ice_snowman'],
      small: ['B_ice_chunk', 'B_ice_crystal', 'B_ice_chunk'],
      outer: ['B_ice_pine', 'B_ice_crystal', 'B_ice_pine', 'B_ice_chunk'],
      shore: ['B_ice_chunk', 'B_shore_rock', 'B_ice_chunk'],
      pool: { kind: 2, a: '#a6e1fb', b: '#dff5ff', c: '#ffffff', sizes: [7, 5] }
    },
    volcano: {
      top: 13, land: 18, egg: 7,
      inner: ['B_volcano_column', 'B_volcano_deadtree', 'B_volcano_obsidian'],
      small: ['B_volcano_rock', 'B_volcano_obsidian', 'B_volcano_rock'],
      outer: ['B_volcano_column', 'B_volcano_rock', 'B_volcano_deadtree'],
      shore: ['B_volcano_rock', 'B_shore_rock', 'B_volcano_rock'],
      pool: { kind: 1, a: '#ffe14a', b: '#ff6a1a', c: '#3a2622', sizes: [6, 5, 4.5] }
    },
    sky: {
      top: 10, land: 17, egg: 7,
      inner: ['B_sky_column', 'B_sky_harp', 'B_sky_floatrock'],
      small: ['B_sky_cloud', 'B_sky_cloud', 'B_sky_harp'],
      outer: ['B_sky_cloud', 'B_sky_floatrock', 'B_sky_column', 'B_sky_cloud'],
      shore: ['B_sky_cloud', 'B_sky_cloud', 'B_shore_rock'],
      pool: { kind: 0, a: '#7d6cf0', b: '#c6b9ff', c: '#ffffff', sizes: [5.5] }
    }
  };

  /* Props that sway in the wind (instanced foliage). */
  var SWAY = { B_forest_tree: 1, B_forest_pine: 1, B_forest_bush: 1, B_desert_palm: 1, B_ice_pine: 1, B_shore_reeds: 1, B_forest_flowers: 1 };

  /* ---------- small helpers ---------- */
  function yawTo(dx, dz) { return Math.atan2(dx, dz); }            /* local +Z -> (dx, dz) */
  function yawAlongX(dx, dz) { return Math.atan2(-dz, dx); }       /* local +X -> (dx, dz) */
  function corr(i) {
    var a = (i / 6) * Math.PI * 2 - Math.PI / 2, dx = Math.cos(a), dz = Math.sin(a);
    return { a: a, dx: dx, dz: dz, px: -dz, pz: dx };
  }
  function cpt(c, u, v) { return [c.dx * u + c.px * v, c.dz * u + c.pz * v]; }
  function arrowTexture() {
    var canvas = U.canvas(128, 128), ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#3c4218'; ctx.lineWidth = 30; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(27, 83); ctx.lineTo(64, 45); ctx.lineTo(101, 83); ctx.stroke();
    ctx.strokeStyle = '#ffff37'; ctx.lineWidth = 22; ctx.stroke();
    var t = new T.CanvasTexture(canvas);
    if (T.sRGBEncoding !== undefined) t.encoding = T.sRGBEncoding;
    return t;
  }
  function beltTexture() {
    var canvas = U.canvas(64, 64), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#9aa4b2'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#5b6573';
    for (var i = 0; i < 4; i++) ctx.fillRect(0, i * 16, 64, 7);
    var t = new T.CanvasTexture(canvas);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    if (T.sRGBEncoding !== undefined) t.encoding = T.sRGBEncoding;
    return t;
  }
  /* Flags: one merged mesh, waving in the vertex shader. */
  function flagMaterial() {
    var m = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = B.TIME;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 flag;\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' +
          'transformed += objectNormal * sin(uTime * 4.2 + flag.y + flag.x * 5.0) * flag.x * 0.42;');
    };
    m.customProgramCacheKey = function () { return 'se-flag'; };
    return m;
  }

  var World = {
    scene: null,
    root: null,
    colliders: [],
    grid: {},
    cell: 40,
    zones: [],
    pens: [],
    botPlots: [],
    nests: [],
    interactables: [],
    labels: [],
    animated: [],
    treadmill: null,
    spawn: new T.Vector3(0, 0, 20),
    HUB_R: HUB_R,
    outerRadius: 294,
    quality: 'high',
    LOOK: LOOK,

    /* ---------- colliders ---------- */
    /* opts: solid (default true), id, noCam (camera ignores it: invisible edges, small props) */
    addBox: function (cx, cz, w, d, topY, opts) {
      var c = {
        minX: cx - w / 2, maxX: cx + w / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
        topY: topY === undefined ? 6 : topY,
        solid: !opts || opts.solid !== false,
        id: opts && opts.id,
        noCam: !!(opts && opts.noCam)
      };
      if (opts && opts.platform) c.platform = true;
      if (opts && opts.step) c.step = true;
      this.colliders.push(c);
      var x0 = Math.floor(c.minX / this.cell), x1 = Math.floor(c.maxX / this.cell);
      var z0 = Math.floor(c.minZ / this.cell), z1 = Math.floor(c.maxZ / this.cell);
      for (var x = x0; x <= x1; x++) {
        for (var z = z0; z <= z1; z++) {
          var k = x + ',' + z;
          (this.grid[k] = this.grid[k] || []).push(c);
        }
      }
      return c;
    },

    nearColliders: function (x, z) {
      var gx = Math.floor(x / this.cell), gz = Math.floor(z / this.cell);
      var out = [], seen = new Set();
      for (var i = -1; i <= 1; i++) {
        for (var j = -1; j <= 1; j++) {
          var arr = this.grid[(gx + i) + ',' + (gz + j)];
          if (arr) for (var k = 0; k < arr.length; k++) {
            if (!seen.has(arr[k])) { seen.add(arr[k]); out.push(arr[k]); }
          }
        }
      }
      return out;
    },

    /* Is a player-sized body at (x, z) blocked by a movement collider? */
    blockedAt: function (x, z, radius, ignoreGates) {
      var cols = this.nearColliders(x, z), r = radius === undefined ? 1.5 : radius;
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        if (!c.solid || c.topY < 1 || c.id === 'cam') continue;
        if (ignoreGates && c.id && String(c.id).indexOf('gate') === 0) continue;
        if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
      }
      return false;
    },

    /* ---------- placing props ---------- */
    /* Static prop merged into a region mesh. */
    put: function (region, name, x, z, ry, s, opts) {
      opts = opts || {};
      var p = B.prop(name);
      var m = B.mat(x, opts.y || 0, z, ry || 0, s === undefined ? 1 : s, opts.rx, opts.rz);
      this.merge(region).add(p.geo, m, opts.tints);
      return p;
    },
    merge: function (region) {
      return this.merges[region] || (this.merges[region] = new B.Merge());
    },
    /* Instanced prop. opts: thin (0..1, -1 core), tint, y, cam: [w, d, h] camera collider. */
    inst: function (name, x, z, ry, s, opts) {
      opts = opts || {};
      if (opts.thin !== undefined && opts.thin >= LOOK.thinMax) return null;
      var region = opts.global ? null : (opts.region || this.region || 'hub');
      var key = (region ? region + ':' : '') + (opts.group || name);
      var g = this.insts[key];
      if (!g) {
        var cast = opts.cast !== undefined ? opts.cast : B.prop(name).box.max.y > 2.6;
        g = this.insts[key] = new B.Inst(name, opts.kind || (SWAY[name] ? 'sway' : 'inst'), { tints: opts.tints, cast: cast, lod: opts.lod, lowLod: opts.lowLod });
        g.region = region;
        g.key = key;
        this.instList.push(g);
      }
      var cam = null;
      if (opts.cam) cam = this.addBox(x, z, opts.cam[0], opts.cam[1], opts.cam[2], { id: 'cam' });
      return g.add(B.mat(x, opts.y || 0, z, ry || 0, s === undefined ? 1 : s, opts.rx, opts.rz),
        { tint: opts.tint, thin: opts.thin === undefined ? -1 : opts.thin, cam: cam });
    },
    /* Fence along a polyline. P_fence is 4 long on X with its post at the -X end
       (post centre x = -2, rails -2..+2), so segments are chained end to end:
       every leg starts with a post, every corner gets exactly one post (from the
       next leg) and the last point gets a P_fence_post. Segments are scaled on X
       only within 0.85..1.15; a leg that cannot be split that way ends with one
       shorter segment. opts: group, global, list (instances for hiding), endPost. */
    fenceLine: function (pts, opts) {
      opts = opts || {};
      var group = opts.group || 'fence', io = { group: group, global: opts.global, lowLod: 0.08 };
      var self = this, last = null;
      function seg(cx, cz, ry, sx) {
        var it = self.inst('P_fence', cx, cz, ry, { x: sx, y: 1, z: 1 }, io);
        if (opts.list) opts.list.push({ g: group, it: it });
      }
      for (var k = 0; k + 1 < pts.length; k++) {
        var ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1];
        var dx = bx - ax, dz = bz - az, len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.3) continue;
        var ux = dx / len, uz = dz / len, ry = yawAlongX(ux, uz);
        var n = Math.max(1, Math.round(len / 4)), sc = len / (4 * n), lens = [];
        if (sc >= 0.85 && sc <= 1.15) { for (var i = 0; i < n; i++) lens.push(4 * sc); }
        else {
          var full = Math.floor(len / 4), rem = len - full * 4;
          for (var f = 0; f < full; f++) lens.push(4);
          if (rem > 0.25) lens.push(rem);
        }
        var t = 0;
        for (var j = 0; j < lens.length; j++) {
          var L = lens[j], mid = t + L / 2;
          seg(ax + ux * mid, az + uz * mid, ry, L / 4);
          t += L;
        }
        last = { x: bx, z: bz, ry: ry };
      }
      if (last && opts.endPost !== false) {
        var pit = this.inst('P_fence_post', last.x, last.z, last.ry, 1, { group: group + '_post', global: opts.global, lowLod: 0.1 });
        if (opts.list) opts.list.push({ g: group + '_post', it: pit });
      }
    },
    animatedPart: function (name, partName, x, z, ry, s, mat) {
      var obj = B.partObject(name, partName, mat);
      if (!obj) return null;
      var holder = new T.Group();
      holder.position.set(x, 0, z);
      holder.rotation.y = ry || 0;
      holder.scale.setScalar(s || 1);
      holder.add(obj);
      this.root.add(holder);
      return obj;
    },

    /* ---------- building ---------- */
    build: function (scene, state) {
      this.scene = scene;
      this.root = new T.Group();
      this.root.name = 'world';
      scene.add(this.root);
      this.insts = {};
      this.instList = [];
      this.merges = {};
      this.penProxies = [];
      this.flagKit = new B.Kit();
      this.flagAttr = [];
      this.region = 'hub';
      this.lods = [];
      this.arches = [];

      this.setupLights(scene);
      this.layoutLand();
      this.buildBoundaries();
      this.computeSideLines();
      this.buildHub(state);
      this.buildCorridors();
      this.buildRingFence();
      this.buildZones(state);
      this.buildGround();
      TR.buildEnvironment(scene, LOOK.fog, LOOK.sunDir);
      this.finishBatches();
      this.updateLods(this.spawn.x, this.spawn.z + 24);
      this.refreshLabels();
      this.setQuality((state && state.settings && state.settings.quality) || 'high');
      this.freezeStatic();
      return this;
    },

    setupLights: function (scene) {
      scene.background = new T.Color(LOOK.fog);
      scene.fog = new T.Fog(LOOK.fog, 260, 620);
      for (var i = 0; i < scene.children.length; i++) {
        var o = scene.children[i];
        if (o.isHemisphereLight) { o.color.set('#e4f4ff'); o.groundColor.set('#90a072'); o.intensity = 0.74; }
        else if (o.isAmbientLight) { o.intensity = 0.12; }
        else if (o.isDirectionalLight) { o.color.set('#fff1da'); o.intensity = 0.8; }
      }
    },

    /* Land shape for the terrain and splat-mask paths of causeways and islands. */
    layoutLand: function () {
      var islands = [], causeways = [];
      for (var i = 0; i < 6; i++) {
        var c = corr(i);
        islands.push({ x: c.dx * ZONE_DIST, z: c.dz * ZONE_DIST, r: LOOK.islandLandR });
        causeways.push({ ax: c.dx * 92, az: c.dz * 92, bx: c.dx * 160, bz: c.dz * 160, w: LOOK.causewayHalfW });
      }
      TR.setLand(LOOK.hubLandR, islands, causeways);
      var P = TR.Paint;
      for (var k = 0; k < 6; k++) {
        var cc = corr(k);
        P.path([cpt(cc, 66, 0), cpt(cc, 156, 0)], 15, 'r');
      }
    },

    /* Invisible movement limits: exactly the colliders of the original walls. */
    buildBoundaries: function () {
      /* base ring with six openings */
      var radius = HUB_R + 9, segments = 48, piece = 2 * Math.PI * radius / segments;
      for (var w = 0; w < segments; w++) {
        var wa = w * Math.PI * 2 / segments;
        var nearestPath = Math.atan2(Math.sin((wa + Math.PI / 2) * 6), Math.cos((wa + Math.PI / 2) * 6)) / 6;
        if (Math.abs(nearestPath) < 0.25) continue;
        this.addBox(Math.cos(wa) * radius, Math.sin(wa) * radius, piece + 2, piece + 2, WALL_H, { noCam: true, id: 'edge' });
      }
      /* causeway sides */
      var len = (ZONE_DIST - ZONE_HALF) - (HUB_R - 12);
      for (var i = 0; i < 6; i++) {
        var ang = (i / 6) * Math.PI * 2 - Math.PI / 2, dirX = Math.cos(ang), dirZ = Math.sin(ang);
        for (var s = -1; s <= 1; s += 2) {
          var ox = -dirZ * (CORRIDOR_W / 2 + 2) * s, oz = dirX * (CORRIDOR_W / 2 + 2) * s;
          var steps = Math.ceil(len / 9);
          for (var k = 0; k < steps; k++) {
            var t = (k + 0.5) / steps;
            this.addBox(dirX * (HUB_R - 12 + len * t) + ox, dirZ * (HUB_R - 12 + len * t) + oz, 13, 13, WALL_H, { noCam: true, id: 'edge' });
          }
        }
      }
      /* island rings with an opening towards the base */
      for (var z = 0; z < 6; z++) {
        var za = (z / 6) * Math.PI * 2 - Math.PI / 2, cx = Math.cos(za) * ZONE_DIST, cz = Math.sin(za) * ZONE_DIST;
        var entryAng = Math.atan2(-Math.sin(za), -Math.cos(za)), segs = 32, segLen = (2 * Math.PI * ZONE_HALF) / segs;
        for (var r = 0; r < segs; r++) {
          var ra = (r / segs) * Math.PI * 2, diff = Math.atan2(Math.sin(ra - entryAng), Math.cos(ra - entryAng));
          if (Math.abs(diff) < 0.26) continue;
          this.addBox(cx + Math.cos(ra) * ZONE_HALF, cz + Math.sin(ra) * ZONE_HALF, segLen + 4, segLen + 4, WALL_H, { noCam: true, id: 'edge' });
        }
      }
    },

    /* Lateral distance (from a causeway axis) where a walking player stops, at distance u. */
    corridorEdge: function (c, u, side) {
      for (var v = 0; v <= 22; v += 0.25) {
        var p = cpt(c, u, v * side);
        if (this.blockedAt(p[0], p[1], 1.5, true)) return Math.max(0, v - 0.25);
      }
      return 22;
    },
    /* One straight line per bridge side, just outside where a walking player stops:
       fences in the base, railings on the bridge and gate side fences follow it. */
    computeSideLines: function () {
      this.sideLines = [];
      for (var i = 0; i < 6; i++) {
        var c = corr(i), l = {};
        l[-1] = Math.round((this.corridorEdgeMax(c, 80, 150, -1) + 1.0) * 4) / 4;
        l[1] = Math.round((this.corridorEdgeMax(c, 80, 150, 1) + 1.0) * 4) / 4;
        this.sideLines.push(l);
      }
    },
    corridorEdgeMax: function (c, u0, u1, side) {
      var m = 0;
      for (var u = u0; u <= u1; u += 0.5) m = Math.max(m, this.corridorEdge(c, u, side));
      return m;
    },

    /* ---------- farm base ---------- */
    buildHub: function (state) {
      var g = this.root, P = TR.Paint, self = this;

      /* splat mask: paved square, paths, pen floors */
      P.ellipse(0, 9, 33, 14, 'g');
      P.disc(50, 0, 13.5, 'g');
      P.path([[30, 2.5], [40, 1]], 9, 'g');
      var paths = [
        [[0, 74], [0, -80]],
        [[-58, -42], [58, -42]], [[-58, -10.5], [58, -10.5]],
        [[-30, -10.5], [-30, -42]], [[30, -10.5], [30, -42]],
        [[36, -6], [58.5, -11], [64.1, -37]], [[-36, -6], [-58.5, -11], [-64.1, -37]],
        [[30, 14], [64.1, 37]], [[-30, 14], [-42, 33.5], [-64.1, 37]],
        [[-50, 44], [50, 44]], [[-33, 6], [-62, 8]], [[60, 0], [69, 0]], [[-62, 8], [-72, -8]],
        [[-58.5, -11], [-60, -6]]
      ];
      paths.forEach(function (p) { P.path(p, 6.5, 'r'); });
      PEN_POS.forEach(function (p) { P.rect(p[0], p[1], 20.6, 20.6, 'b'); });
      P.rect(-52, 26.6, 9, 13.5, 'r');
      [-50, -18, 18, 50].forEach(function (x) { P.rect(x, 60, 20.6, 16.6, 'b'); });

      /* Pens */
      for (var i = 0; i < PEN_POS.length; i++) this.buildPen(i, PEN_POS[i][0], PEN_POS[i][1], state);

      /* Sell booth with its vendor (same footprint and colliders as before) */
      this.put('hub', 'P_stall_sell', -23, 1, 0, 1.5);
      this.addVendor(-23, { shirt: '#32653a', undershirt: '#f6d877', pants: '#2d3027', skin: '#ffe4c8', hair: '#75451e', hairStyle: 'spiky' });
      this.addBox(-23, 1, 13.5, 6, 5.1);
      this.addBox(-23, -2.825, 5.4, 2.6, 8, { id: 'seller' });
      this.addBox(-23, 1, 12.6, 5.4, 10.4, { id: 'cam' });   /* camera only: inside the booth footprint */
      var sellLabel = M.makeLabel('', { w: 19, fontSize: 92, color: '#ff6660', outlineColor: '#080808', outlineWidth: 18 });
      sellLabel.position.set(-23, 12.2, 1);
      g.add(sellLabel);
      this.labels.push({ spr: sellLabel, key: 'world.sell' });
      this.interactables.push({ type: 'sell', x: -23, z: 7, r: 9, hint: 'hint.sell', hintMobile: 'hint.sellMobile' });
      var sellRing = new T.Mesh(new T.CircleGeometry(9, 32), new T.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.45, depthWrite: false }));
      sellRing.rotation.x = -Math.PI / 2;
      sellRing.position.set(-23, 0.08, 7);
      g.add(sellRing);
      this.animated.push({ obj: sellRing, kind: 'pulse' });

      /* Trail booth */
      this.put('hub', 'P_stall_trail', 23, 1, 0, 1.5);
      this.addVendor(23, { shirt: '#354c83', undershirt: '#ffdf58', pants: '#242f47', skin: '#f3c9a0', hair: '#4f3023', hairStyle: 'bob' });
      this.addBox(23, 1, 13.5, 6, 5.1);
      this.addBox(23, -2.825, 5.4, 2.6, 8, { id: 'trail-vendor' });
      this.addBox(23, 1, 12.6, 5.4, 10.4, { id: 'cam' });
      var trailLabel = M.makeLabel('', { w: 22, fontSize: 76, color: '#fff126', outlineColor: '#080808', outlineWidth: 16 });
      trailLabel.position.set(23, 12.3, 1);
      g.add(trailLabel);
      this.labels.push({ spr: trailLabel, key: 'world.trailShop' });
      this.interactables.push({ type: 'trail', x: 23, z: 7, r: 9, hint: 'hint.trails', hintMobile: 'hint.trailsMobile' });
      this.buildRibbons(23, 1, 1.5);
      var trailRing = new T.Mesh(sellRing.geometry, sellRing.material.clone());
      trailRing.rotation.x = -Math.PI / 2;
      trailRing.position.set(23, 0.08, 7);
      g.add(trailRing);
      this.animated.push({ obj: trailRing, kind: 'pulse' });

      /* Treadmill: axis-aligned, console/handrails at the north end (model -Z),
         people step on from the path at the open south end. */
      var tmX = -52, tmZ = 26, tmYaw = 0;
      this.put('hub', 'P_treadmill', tmX, tmZ, tmYaw, 1);
      var beltMat = new T.MeshLambertMaterial({ map: beltTexture(), vertexColors: true });
      var belt = this.animatedPart('P_treadmill', 'Belt', tmX, tmZ, tmYaw, 1, beltMat);
      if (belt) {
        var bg = belt.children[0].geometry;
        if (!bg.attributes.uv) {
          bg.computeBoundingBox();
          var bb = bg.boundingBox, pa = bg.attributes.position, uv = new Float32Array(pa.count * 2);
          for (var v = 0; v < pa.count; v++) {
            uv[v * 2] = (pa.getX(v) - bb.min.x) / Math.max(0.01, bb.max.x - bb.min.x);
            uv[v * 2 + 1] = (pa.getZ(v) - bb.min.z) / Math.max(0.01, bb.max.z - bb.min.z) * 3;
          }
          bg.setAttribute('uv', new T.BufferAttribute(uv, 2));
        }
        this.animated.push({ map: beltMat.map, kind: 'belt' });
      }
      var tmInfo = this.treadmillLayout(tmX, tmZ, tmYaw);
      /* belt: walkable platform with step-up; console end and handrails: solid */
      this.addBox(tmInfo.x, tmInfo.z, tmInfo.halfW * 2, tmInfo.halfL * 2, tmInfo.topY, { solid: false, platform: true, step: true, id: 'treadmill' });
      if (tmInfo.deck) this.addBox(tmInfo.deck.x, tmInfo.deck.z, tmInfo.deck.w, tmInfo.deck.d, tmInfo.deck.top, { solid: false, platform: true, step: true, id: 'treadmill-deck' });
      var self2 = this;
      tmInfo.solids.forEach(function (b) { self2.addBox(b.x, b.z, b.w, b.d, b.top, { noCam: true, id: 'treadmill-rail' }); });
      this.treadmill = { group: belt, material: beltMat, x: tmInfo.x, z: tmInfo.z, yaw: tmYaw, topY: tmInfo.topY, halfW: tmInfo.halfW, halfL: tmInfo.halfL };
      var tmLabel = M.makeLabel('', { w: 16, fontSize: 72, color: '#8ef0a0', outlineColor: '#123018', outlineWidth: 16 });
      tmLabel.position.set(tmInfo.x, 12, tmInfo.z);
      g.add(tmLabel);
      this.labels.push({ spr: tmLabel, key: 'world.treadmill' });
      this.interactables.push({ type: 'treadmill', x: tmInfo.x, z: tmInfo.z, r: 6, hint: 'hint.treadmill', hintMobile: 'hint.treadmill', passive: true });

      /* Shop kiosk */
      this.put('hub', 'P_kiosk', -66, 4, 0.5, 1);
      this.addBox(-66, 4, 7.5, 6.5, 8);
      var shopLabel = M.makeLabel('', { w: 11, fontSize: 80, color: '#123018', outlineColor: '#ffffff', outlineWidth: 14 });
      shopLabel.position.set(-66, 10.6, 4);
      g.add(shopLabel);
      this.labels.push({ spr: shopLabel, key: 'world.shopSign' });
      this.interactables.push({ type: 'shop', x: -66, z: 9, r: 7, hint: 'hint.unlock', hintMobile: 'hint.unlockMobile' });

      /* "Your base" sign */
      var baseLabel = M.makeLabel('', { w: 20, fontSize: 78, color: '#ffffff', outlineColor: '#1c5c1c', outlineWidth: 16 });
      baseLabel.position.set(0, 13, 60);
      g.add(baseLabel);
      this.labels.push({ spr: baseLabel, key: 'world.base' });

      this.buildBotPlots();
      this.buildFarm();

      /* route arrows from the pens to the forest */
      this.arrows = [];
      for (var routeZ = 10; routeZ > -95; routeZ -= 7) this.arrows.push({ x: 0, z: routeZ, yaw: Math.PI, phase: 0 });
    },

    /* Belt / deck / console footprints of P_treadmill placed at (x, z) with yaw 0 or PI. */
    treadmillLayout: function (x, z, yaw) {
      var p = B.prop('P_treadmill'), flip = Math.abs(Math.sin(yaw / 2)) > 0.7 ? -1 : 1;
      var belt = p.parts.Belt, bmin = new T.Vector3(-2.05, 0, -4.2), bmax = new T.Vector3(2.05, 1.06, 4.3);
      if (belt) {
        var bb = belt.geo.boundingBox.clone().applyMatrix4(belt.matrix);
        bmin.copy(bb.min); bmax.copy(bb.max);
      }
      function box(x0, x1, z0, z1, top) {
        var a = x0 * flip, b = x1 * flip, c = z0 * flip, d = z1 * flip;
        return { x: x + (a + b) / 2, z: z + (c + d) / 2, w: Math.abs(b - a), d: Math.abs(d - c), top: top };
      }
      /* parts above the belt: console (middle) and handrails (sides) */
      var pos = p.geo.attributes.position, hz0 = 1e9, hz1 = -1e9, cz0 = 1e9, cz1 = -1e9, hy = 0;
      var pb = p.geo.boundingBox;
      for (var i = 0; i < pos.count; i++) {
        var px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        if (py < bmax.y + 0.35) continue;
        hy = Math.max(hy, py);
        if (Math.abs(px) > bmax.x - 0.15) { hz0 = Math.min(hz0, pz); hz1 = Math.max(hz1, pz); }
        else { cz0 = Math.min(cz0, pz); cz1 = Math.max(cz1, pz); }
      }
      var solids = [], wx = Math.max(pb.max.x, bmax.x + 0.3);
      if (cz1 > cz0) solids.push(box(-wx, wx, Math.min(cz0, pb.min.z), cz1, hy));
      if (hz1 > hz0) {
        solids.push(box(-wx, -bmax.x, hz0, hz1, hy));
        solids.push(box(bmax.x, wx, hz0, hz1, hy));
      }
      var cx = (bmin.x + bmax.x) / 2, czc = (bmin.z + bmax.z) / 2;
      var out = {
        x: x + cx * flip, z: z + czc * flip, topY: bmax.y,
        halfW: (bmax.x - bmin.x) / 2, halfL: (bmax.z - bmin.z) / 2, solids: solids, deck: null
      };
      if (pb.max.z > bmax.z + 0.3) out.deck = box(-wx, wx, bmax.z, pb.max.z, bmax.y + 0.04);
      return out;
    },

    /* The trail booth's ribbons: one mesh, each ribbon sways about its own pivot in the shader. */
    buildRibbons: function (x, z, s) {
      var parts = B.prop('P_stall_trail').parts, K = new B.Kit(), piv = [];
      var S = B.mat(x, 0, z, 0, s), W = new T.Matrix4(), pv = new T.Vector3();
      for (var r = 0; r < 5; r++) {
        var pt = parts['Ribbon' + r];
        if (!pt) continue;
        W.multiplyMatrices(S, pt.matrix);
        pv.setFromMatrixPosition(W);
        var before = K.S.length;
        K.addAttr(pt.geo, W);
        for (var v = before; v < K.S.length; v++) piv.push(pv.x, pv.y, pv.z, r);
      }
      if (!piv.length) return;
      var g = K.build(0);
      g.setAttribute('pivot', new T.Float32BufferAttribute(piv, 4));
      var m = B.freshMaterial('static'), base = m.onBeforeCompile;
      m.onBeforeCompile = function (sh) {
        base(sh);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec4 pivot;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' +
            '{ float ra = sin(uTime + pivot.w) * 0.4; vec3 rd = transformed - pivot.xyz;\n' +
            '  transformed = pivot.xyz + vec3(rd.x * cos(ra) + rd.z * sin(ra), rd.y, -rd.x * sin(ra) + rd.z * cos(ra));\n' +
            '  transformed.y += sin(uTime * 2.0 + pivot.w) * 0.16; }');
      };
      m.customProgramCacheKey = function () { return 'se-ribbons'; };
      var mesh = new T.Mesh(g, m);
      mesh.castShadow = true;
      mesh.name = 'ribbons';
      this.root.add(mesh);
    },

    addVendor: function (x, look) {
      var npc = M.makeCharacter(look);
      npc.group.scale.setScalar(1.35);
      npc.group.position.set(x, 0, 1 - 2.55 * 1.5);
      this.root.add(npc.group);
      this.animated.push({ obj: npc.group, model: npc, kind: 'vendor' });
      return npc;
    },

    /* Farm village dressing; every solid prop keeps the bot lanes open. */
    buildFarm: function () {
      var self = this;
      /* buildings */
      this.put('hub', 'P_barn', 76, 0, -Math.PI / 2, 1);
      this.addBox(76, 0, 18, 22, 18);
      this.put('hub', 'P_silo', 79, -21, 0.4, 1);
      this.addBox(79, -21, 6.4, 6.4, 14);
      this.put('hub', 'P_water_tower', 79, 21, 0.3, 1);
      this.addBox(79, 21, 7, 7, 15);
      this.put('hub', 'P_windmill', -78, -16, yawTo(78, 16), 1);
      this.addBox(-78, -16, 8.4, 8.4, 19);
      var blades = this.animatedPart('P_windmill', 'Blades', -78, -16, yawTo(78, 16), 1);
      if (blades) this.animated.push({ obj: blades, kind: 'blades' });

      /* fountain plaza with the golden egg statue */
      this.put('hub', 'P_fountain', 50, 0, 0, 1);
      this.addBox(50, 0, 10.5, 10.5, 2.6);
      this.addBox(50, 0, 3.2, 3.2, 9.6, { id: 'cam' });
      var water = this.animatedPart('P_fountain', 'Water', 50, 0, 0, 1, TR.liquidMaterial(0, '#2a8fd0', '#7fe0f2', '#ffffff'));
      if (water) {
        var wg = water.children[0].geometry;
        if (!wg.attributes.edge) {
          var wp = wg.attributes.position, maxR = 0.01, ed = new Float32Array(wp.count);
          for (var wi = 0; wi < wp.count; wi++) maxR = Math.max(maxR, Math.hypot(wp.getX(wi), wp.getZ(wi)));
          for (var wj = 0; wj < wp.count; wj++) ed[wj] = Math.hypot(wp.getX(wj), wp.getZ(wj)) / maxR;
          wg.setAttribute('edge', new T.BufferAttribute(ed, 1));
        }
        this.animated.push({ obj: water, kind: 'water', y: water.position.y });
      }
      for (var b = 0; b < 4; b++) {
        var ba = Math.PI / 4 + b * Math.PI / 2, bx = 50 + Math.cos(ba) * 10.8, bz = Math.sin(ba) * 10.8;
        this.put('hub', 'P_bench', bx, bz, yawTo(50 - bx, -bz), 1);
        this.addBox(bx, bz, 2.6, 2.6, 1.6, { noCam: true });
      }
      [[50 - 12.5, -6], [50 - 12.5, 6], [50 + 12.5, 0]].forEach(function (p, i) {
        self.put('hub', 'P_flowerbed', p[0], p[1], i < 2 ? Math.PI / 2 : Math.PI / 2, 1);
        self.addBox(p[0], p[1], 2.2, 3.4, 0.8, { noCam: true });
      });

      /* lamps along the square and paths */
      [[-36, -5], [36, -5], [-36, 22], [36, 22], [-12, 25], [12, 25], [61, -11], [61, 11], [-58, 15], [-44, 41], [44, 41], [6, -76], [-6, -76]].forEach(function (p) {
        /* walk-through: no small colliders where the neighbours' bots walk */
        self.put('hub', 'P_lamp', p[0], p[1], 0, 1);
      });

      /* barn yard: hay, crates, cart, pumpkins */
      [[69.5, -15.5, 0.2], [72.5, -15, 0.1], [70.8, -15.3, 0, 2.5]].forEach(function (h) {
        self.put('hub', 'P_haybale', h[0], h[1], h[2], 1, { y: h[3] || 0 });
      });
      this.addBox(71, -15.3, 6.5, 3, 2.5, { noCam: true });
      [[70.5, 15.5, -0.2], [73.4, 15.2, 0.1]].forEach(function (h) { self.put('hub', 'P_haybale', h[0], h[1], h[2], 1); });
      this.addBox(72, 15.3, 6, 3, 2.5, { noCam: true });
      [[63.9, -7.5], [64.0, 7.5]].forEach(function (p, i) {
        self.put('hub', i ? 'P_barrel' : 'P_crate', p[0], p[1], 0.3, 1);
        self.addBox(p[0], p[1], 1.9, 1.9, 1.8, { noCam: true });
      });
      this.put('hub', 'P_crate', 64.0, -5.4, 0.7, 0.8);
      this.put('hub', 'P_cart', 64, 19, 0.5, 1);
      this.addBox(64, 19, 3.6, 3.6, 2.2, { noCam: true });
      var rnd = U.seeded(515);
      for (var pk = 0; pk < 6; pk++) {
        var pkx = 70 + (pk % 3) * 3.2 + rnd(), pkz = -27 - Math.floor(pk / 3) * 3 + rnd();
        if (this.nearSideLine(pkx, pkz, 2.4) || this.inFencedPlot(pkx, pkz)) continue;
        this.put('hub', 'P_pumpkin', pkx, pkz, rnd() * 6, 0.9 + rnd() * 0.4);
      }
      /* west: well, scarecrow and a small field */
      this.put('hub', 'P_well', -60, -5, 0.3, 1);
      this.addBox(-60, -5, 3.6, 3.6, 4, { noCam: true });
      this.put('hub', 'P_scarecrow', -77, 24, yawTo(77, -24), 1);
      for (var f = 0; f < 5; f++) this.put('hub', 'P_pumpkin', -82 + (f % 3) * 2.8, 19 + Math.floor(f / 3) * 9 + rnd(), rnd() * 6, 0.8);
      this.put('hub', 'P_crate', -61, -0.5, 0.2, 1);
      /* neighbours' mailboxes */
      [-50, -18, 18, 50].forEach(function (x) { self.put('hub', 'P_mailbox', x - 6.5, 47.2, 0, 1); });

      /* a few shade trees inside the base (solid), away from the bots' routes */
      [[-73, 9], [-72, -27], [66, -22], [67, 25]].forEach(function (p, i) {
        self.inst(i % 2 ? 'B_forest_tree' : 'B_forest_pine', p[0], p[1], i * 1.7, 1.0 + (i % 2) * 0.15);
        self.addBox(p[0], p[1], 2.2, 2.2, 8, { noCam: true });
      });

      /* outside the fence: bushes, trees, flowers, beach rocks and reeds (all thinned by quality) */
      var rr = U.seeded(901);
      for (var k = 0; k < 95; k++) {
        var a = rr() * Math.PI * 2, d = 89.5 + rr() * 11, x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (this.nearExit(x, z, 25)) continue;
        if (Math.abs(a + 0.21) < 0.13) continue; /* dock */
        var h = TR.height(x, z);
        if (h < -0.15) continue;
        var pick = rr(), name = pick < 0.34 ? 'B_forest_bush' : (pick < 0.62 ? 'B_forest_tree' : (pick < 0.8 ? 'B_forest_pine' : 'B_forest_flowers'));
        if (d < 93 && name !== 'B_forest_bush' && name !== 'B_forest_flowers') continue;
        this.inst(name, x, z, rr() * 6, 0.8 + rr() * 0.45, { thin: rr() });
      }
      for (var fl = 0; fl < 26; fl++) {
        var fa = rr() * Math.PI * 2, fd = 80 + rr() * 5, fx = Math.cos(fa) * fd, fz = Math.sin(fa) * fd;
        if (this.nearExit(fx, fz, 16) || this.blockedAt(fx, fz, 2, false)) continue;
        this.inst('B_forest_flowers', fx, fz, rr() * 6, 0.8 + rr() * 0.4, { thin: rr() });
      }
      this.shoreRing(0, 0, 0, 1, 46, 2);
      /* dock with a boat at the east beach */
      var da = -0.21, coast = this.coastAlong(0, 0, da, -2.0);
      if (coast) {
        var dxx = Math.cos(da), dzz = Math.sin(da);
        this.put('hub', 'P_dock', coast.x + dxx * 4.5, coast.z + dzz * 4.5, yawAlongX(dxx, dzz), 1, { y: 0.25 });
        var boatHolder = new T.Group();
        boatHolder.position.set(coast.x + dxx * 7 - dzz * 4.6, TR.WATER_Y + 0.25, coast.z + dzz * 7 + dxx * 4.6);
        boatHolder.rotation.y = yawAlongX(dxx, dzz) + 0.15;
        var bp = B.prop('P_boat');
        var boat = new T.Mesh(bp.geo, B.material('static'));
        boat.castShadow = true;
        boatHolder.add(boat);
        this.root.add(boatHolder);
        this.animated.push({ obj: boatHolder, kind: 'boat', y: boatHolder.position.y });
      }
    },

    /* Ring fence along the base edge (the real limit is an invisible collider ring).
       Each arc starts and ends on the straight side line of a bridge. */
    buildRingFence: function () {
      var R = LOOK.fenceR, lines = this.sideLines || [];
      for (var e = 0; e < 6; e++) {
        var nx = (e + 1) % 6;
        var La = (lines[e] && lines[e][1]) || 11, Lb = (lines[nx] && lines[nx][-1]) || 11;
        var a0 = corr(e).a + Math.atan2(La, Math.sqrt(R * R - La * La));
        var a1 = corr(nx).a + (nx === 0 ? Math.PI * 2 : 0) - Math.atan2(Lb, Math.sqrt(R * R - Lb * Lb));
        /* the arc stops at fenced pens / neighbour plots that reach the edge */
        var runs = [], N = Math.ceil((a1 - a0) * R / 0.5), start = null, prev = a0;
        for (var k = 0; k <= N; k++) {
          var t = a0 + (a1 - a0) * k / N, inside = this.inFencedPlot(Math.cos(t) * R, Math.sin(t) * R);
          if (!inside && start === null) start = k ? this.ringCross(prev, t, R) : t;
          if (inside && start !== null) { runs.push([start, this.ringCross(prev, t, R)]); start = null; }
          prev = t;
        }
        if (start !== null) runs.push([start, a1]);
        for (var r = 0; r < runs.length; r++) {
          var t0 = runs[r][0], t1 = runs[r][1];
          if ((t1 - t0) * R < 1.5) continue;
          var n = Math.max(1, Math.round((t1 - t0) * R / 4)), pts = [];
          for (var s = 0; s <= n; s++) {
            var ta = t0 + (t1 - t0) * s / n;
            pts.push([Math.cos(ta) * R, Math.sin(ta) * R]);
          }
          this.fenceLine(pts);
        }
      }
    },
    /* Fenced rectangles (pens, neighbour plots) the ring fence must not cross. */
    inFencedPlot: function (x, z) {
      var m = 0.25;
      for (var i = 0; i < PEN_POS.length; i++) {
        if (Math.abs(x - PEN_POS[i][0]) < 11 + m && Math.abs(z - PEN_POS[i][1]) < 11 + m) return true;
      }
      for (var j = 0; j < this.botPlots.length; j++) {
        var b = this.botPlots[j];
        if (Math.abs(x - b.x) < 11 + m && Math.abs(z - b.z) < 9 + m) return true;
      }
      return false;
    },
    /* Angle between ta and tb where the ring at radius R crosses a plot edge. */
    ringCross: function (ta, tb, R) {
      var inA = this.inFencedPlot(Math.cos(ta) * R, Math.sin(ta) * R);
      for (var i = 0; i < 14; i++) {
        var tm = (ta + tb) / 2;
        if (this.inFencedPlot(Math.cos(tm) * R, Math.sin(tm) * R) === inA) ta = tm; else tb = tm;
      }
      return inA ? tb : ta;
    },
    /* Within m of a bridge side line (fence / railing) near the base? */
    nearSideLine: function (x, z, m) {
      var lines = this.sideLines || [];
      for (var i = 0; i < lines.length; i++) {
        var c = corr(i), u = x * c.dx + z * c.dz, v = x * c.px + z * c.pz;
        if (u < 70 || u > 156) continue;
        if (Math.abs(v - lines[i][1]) < m || Math.abs(v + lines[i][-1]) < m) return true;
      }
      return false;
    },

    /* Is (x, z) close to a causeway axis (outside the base disc)? */
    nearExit: function (x, z, lat) {
      for (var i = 0; i < 6; i++) {
        var c = corr(i), u = x * c.dx + z * c.dz, v = x * c.px + z * c.pz;
        if (u > 60 && Math.abs(v) < lat) return true;
      }
      return false;
    },
    /* Walk out from (cx, cz) along angle a until the coast distance reaches targetD. */
    coastAlong: function (cx, cz, a, targetD) {
      var dx = Math.cos(a), dz = Math.sin(a);
      for (var r = 20; r < 160; r += 0.5) {
        var x = cx + dx * r, z = cz + dz * r;
        if (TR.sdf(x, z) >= targetD) return { x: x, z: z, r: r };
      }
      return null;
    },
    /* Rocks and reeds along a coast. names: [rock, reeds, extra]; skip causeway mouths. */
    shoreRing: function (cx, cz, zoneIndex, scale, count, seedK, names) {
      names = names || ['B_shore_rock', 'B_shore_reeds', 'B_shore_reeds'];
      var rnd = U.seeded(4000 + seedK * 97);
      for (var i = 0; i < count; i++) {
        var a = rnd() * Math.PI * 2, which = Math.floor(rnd() * names.length), name = names[which];
        var target = name === 'B_shore_reeds' ? -0.9 : (rnd() < 0.5 ? -2.2 : 0.4);
        var p = this.coastAlong(cx, cz, a, target);
        if (!p) continue;
        if (this.nearCauseway(p.x, p.z, 27)) continue;
        var y = Math.max(TR.WATER_Y - 0.4, TR.height(p.x, p.z));
        this.inst(name, p.x, p.z, rnd() * 6, (0.8 + rnd() * 0.6) * scale, { y: y, thin: rnd(), cast: false });
      }
    },
    nearCauseway: function (x, z, lat) {
      for (var i = 0; i < 6; i++) {
        var c = corr(i), u = x * c.dx + z * c.dz, v = x * c.px + z * c.pz;
        if (u > 88 && u < 166 && Math.abs(v) < lat) return true;
      }
      return false;
    },

    buildBotPlots: function () {
      var self = this;
      [-50, -18, 18, 50].forEach(function (x, index) {
        var z = 60;
        var group = new T.Group();
        group.position.set(x, 0, z);
        self.root.add(group);
        /* fence with an opening to the north */
        self.fenceLine([[x - 4, z - 9], [x - 11, z - 9], [x - 11, z + 9], [x + 11, z + 9], [x + 11, z - 9], [x + 4, z - 9]]);
        self.addBox(x, z + 9, 22, 1.2, 3.4);
        self.addBox(x - 11, z, 1.2, 18, 3.4);
        self.addBox(x + 11, z, 1.2, 18, 3.4);
        self.addBox(x - 7.5, z - 9, 7, 1.2, 3.4);
        self.addBox(x + 7.5, z - 9, 7, 1.2, 3.4);
        /* a small shed in the back corner */
        var sx = x + (index % 2 ? -6.4 : 6.4);
        self.put('hub', 'P_shed', sx, z + 5.2, Math.PI, 0.85);
        self.addBox(sx, z + 5.2, 5.4, 4.6, 5.6);
        var content = new T.Group();
        content.position.set(x, 0, z);
        content.userData.__dyn = true;
        self.root.add(content);
        var label = M.makeLabel('', { w: 13, tw: 640, th: 180, fontSize: 56, color: '#ffffff', outlineColor: '#173227', outlineWidth: 10 });
        label.position.set(x, 8.2, z + 7);
        self.root.add(label);
        self.botPlots.push({ index: index, x: x, z: z, entry: { x: x, z: z - 13 }, content: content, label: label, group: group });
      });
    },

    buildPen: function (index, x, z, state) {
      var g = this.root;
      var pen = { index: index, x: x, z: z, price: PEN_PRICES[index], group: new T.Group() };
      pen.group.position.set(x, 0, z);
      g.add(pen.group);

      /* fence with an opening towards the square */
      var half = 11;
      this.fenceLine([[x - 4, z + half], [x - half, z + half], [x - half, z - half], [x + half, z - half], [x + half, z + half], [x + 4, z + half]]);
      this.addBox(x, z - half, 22, 1.2, 3.4);
      this.addBox(x - half, z, 1.2, 22, 3.4);
      this.addBox(x + half, z, 1.2, 22, 3.4);
      this.addBox(x - 7.5, z + half, 7, 1.2, 3.4);
      this.addBox(x + 7.5, z + half, 7, 1.2, 3.4);

      /* incubator (hidden while a pet stands in the pen) */
      var incubator = this.inst('P_incubator', x, z, 0, 1.1, { group: 'incubator', global: true });

      /* lock sign: an instanced board; game toggles pen.sign.group.visible */
      var signItem = this.inst('P_pen_sign', x - 7.6, z + 12.2, 0, 1, { group: 'pensign', global: true });
      var signProxy = new T.Group();
      signProxy.position.set(x - 7.6, 0, z + 12.2);
      g.add(signProxy);
      pen.sign = { group: signProxy, board: null, labelY: 4.0 };
      var front = B.prop('P_pen_sign').box.max.z;
      var lockLabel = M.makeLabel('', { fixed: true, w: 7.5, th: 220, tw: 640, fontSize: 74, color: '#ffffff', outlineColor: '#0d2245', outlineWidth: 14 });
      lockLabel.position.set(x - 7.6, 4.0, z + 12.2 + front + 0.05);
      g.add(lockLabel);
      pen.lockLabel = lockLabel;

      var stateLabel = M.makeLabel('', { w: 11, th: 200, tw: 640, fontSize: 72, color: '#ffe27a', outlineColor: '#2a1a06', outlineWidth: 14 });
      stateLabel.position.set(x, 8.5, z);
      stateLabel.visible = false;
      g.add(stateLabel);
      pen.stateLabel = stateLabel;

      pen.content = new T.Group();
      pen.group.add(pen.content);

      this.pens.push(pen);
      this.penProxies.push({ pen: pen, sign: signItem, incubator: incubator, signShown: true, incShown: true });
      this.interactables.push({ type: 'pen', penIndex: index, x: x, z: z + 8, r: 8, hint: 'hint.placeEgg', hintMobile: 'hint.placeEggMobile' });
      return pen;
    },

    /* ---------- land bridges ---------- */
    buildCorridors: function () {
      for (var i = 0; i < 6; i++) {
        var c = corr(i), biome = SE.Pets.BIOMES[i], self = this;
        var flank = {};
        var mid = cpt(c, 122, 0);
        this.lods.push({ region: 'c' + i, cx: mid[0], cz: mid[1], dist: 96, near: [], groups: [], extra: [] });
        [-1, 1].forEach(function (side) {
          /* one straight line per side: just outside where a walking player stops */
          var e = self.sideLines[i][side];
          flank[side] = e;
          /* fence inside the base (ends at the gateway pillar), railing on the bridge */
          self.fenceLine([cpt(c, 76, e * side), cpt(c, 92, e * side)], { endPost: false });
          self.region = 'c' + i;
          for (var u2 = 92; u2 + 6 <= 152; u2 += 6) {
            var m = cpt(c, u2 + 3, e * side);
            self.inst('P_bridge_rail', m[0], m[1], yawAlongX(c.dx, c.dz), 1, { group: 'rail' });
            if (u2 === 104 || u2 === 122 || u2 === 140) {
              var l = cpt(c, u2 + 3, (e + 1.3) * side);
              self.inst('P_lantern', l[0], l[1], yawAlongX(c.dx, c.dz) + (side > 0 ? Math.PI : 0) + Math.PI / 2, 1, { group: 'lantern' });
            }
          }
          var ep = cpt(c, 152, e * side);
          self.inst('P_fence_post', ep[0], ep[1], yawAlongX(c.dx, c.dz), { x: 0.62, y: 0.64, z: 0.62 }, { group: 'railpost' });
          self.region = 'hub';
        });
        this.sideLines[i] = flank;

        /* gateway pillars with biome flags where the bridge leaves the base (on the side lines) */
        [-1, 1].forEach(function (side) {
          var p = cpt(c, 92, flank[side] * side);
          var K = new B.Kit();
          K.box(2.2, 0.8, 2.2, '#8f887c', 0, 0.4, 0);
          K.box(1.7, 5.2, 1.7, '#d9d2c3', 0, 3.4, 0);
          K.box(2.1, 0.6, 2.1, '#bdb6a8', 0, 6.2, 0);
          K.cyl(0.12, 5.5, '#5a4a3a', 0, 9.2, 0, { seg: 6 });
          K.sph(0.3, '#ffd24a', 0, 12.0, 0, { seg: 6 });
          self.merge('hub').add(K.build(1.2), B.mat(p[0], 0, p[1], 0, 1));
          self.addFlag(p[0], 11.4, p[1], c.dx, c.dz, biome.color);
        });

        /* white safe line at the base exit */
        var w = flank[-1] + flank[1];
        var lineK = new B.Kit();
        lineK.box(w, 0.14, 1.3, '#fffee8', 0, 0.07, 0);
        var lp = cpt(c, HUB_R + 10, (flank[1] - flank[-1]) / 2);
        this.merge('hub').add(lineK.build(0), B.mat(lp[0], 0, lp[1], yawTo(c.dx, c.dz), 1));

        /* route arrows along the bridge */
        var len = (ZONE_DIST - ZONE_HALF) - (HUB_R - 12);
        for (var a2 = 0; a2 < 7; a2++) {
          var t2 = (a2 + 0.5) / 7, ar = cpt(c, HUB_R - 12 + len * t2, 0);
          this.arrows.push({ x: ar[0], z: ar[1], yaw: -c.a + Math.PI / 2, phase: a2 * 0.35 });
        }

        /* shoulders: bushes and flowers beside the railings (thinned) */
        this.region = 'c' + i;
        var rnd = U.seeded(700 + i * 13), set = BIOME_SET[biome.id];
        for (var k = 0; k < 22; k++) {
          var u3 = 100 + rnd() * 46, side3 = rnd() < 0.5 ? -1 : 1, v3 = 13.5 + rnd() * 5;
          var q = cpt(c, u3, v3 * side3);
          if (TR.height(q[0], q[1]) < -0.2) continue;
          var nm = u3 > 128 ? set.small[Math.floor(rnd() * set.small.length)] : (rnd() < 0.6 ? 'B_forest_bush' : 'B_forest_flowers');
          this.inst(nm, q[0], q[1], rnd() * 6, 0.7 + rnd() * 0.35, { thin: rnd() });
        }
        for (var sr = 0; sr < 16; sr++) {
          var u4 = 100 + rnd() * 50, side4 = rnd() < 0.5 ? -1 : 1;
          var lat = this.coastLateral(c, u4, side4, rnd() < 0.5 ? -0.9 : -2.4);
          if (lat === null) continue;
          var sp = cpt(c, u4, lat * side4), nm2 = rnd() < 0.55 ? 'B_shore_rock' : 'B_shore_reeds';
          this.inst(nm2, sp[0], sp[1], rnd() * 6, 0.8 + rnd() * 0.5, { y: Math.max(TR.WATER_Y - 0.4, TR.height(sp[0], sp[1])), thin: rnd(), cast: false });
        }
        this.region = 'hub';
      }
    },
    coastLateral: function (c, u, side, targetD) {
      for (var v = 10; v < 40; v += 0.5) {
        var p = cpt(c, u, v * side);
        if (TR.sdf(p[0], p[1]) >= targetD) return v;
      }
      return null;
    },
    addFlag: function (x, y, z, dx, dz, color) {
      /* cloth 3.2 x 2 hanging from the pole, pointing along the bridge */
      var K = this.flagKit, segX = 6, segY = 3, w = 3.2, h = 2.0, colr = B.color(color);
      var ux = dx, uz = dz, phase = x * 0.3 + z * 0.2;
      for (var i = 0; i < segX; i++) {
        for (var j = 0; j < segY; j++) {
          var quad = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i, j + 1]];
          for (var q = 0; q < 6; q++) {
            var s = quad[q][0] / segX, t = quad[q][1] / segY;
            K.P.push(x + ux * s * w, y - t * h, z + uz * s * w);
            K.N.push(-uz, 0, ux);
            var shade = 0.9 + 0.1 * (1 - t);
            K.C.push(colr.r * shade, colr.g * shade, colr.b * shade);
            K.S.push(0);
            this.flagAttr.push(s, phase);
          }
        }
      }
    },

    /* ---------- biome islands ---------- */
    buildZones: function (state) {
      for (var i = 0; i < SE.Pets.BIOMES.length; i++) this.buildZone(i, SE.Pets.BIOMES[i], state);
    },

    buildZone: function (index, biome, state) {
      var g = this.root, self = this;
      var c = corr(index), ang = c.a;
      var cx = c.dx * ZONE_DIST, cz = c.dz * ZONE_DIST;
      var set = BIOME_SET[biome.id] || BIOME_SET.forest;
      var region = 'z' + index;
      var zone = {
        index: index, id: biome.id, biome: biome,
        x: cx, z: cz, angle: ang, half: ZONE_HALF,
        nests: [], guards: [], group: new T.Group(),
        gateX: c.dx * GATE_DIST, gateZ: c.dz * GATE_DIST
      };
      zone.group.position.set(cx, 0, cz);
      g.add(zone.group);
      zone.eggGroup = new T.Group();
      g.add(zone.eggGroup);
      this.region = region;
      this.lods.push({ region: region, cx: cx, cz: cz, dist: 150, near: [], groups: [], extra: [zone.eggGroup] });
      var ex = -c.dx, ez = -c.dz;   /* towards the base */

      /* paths: entrance -> landmark ring */
      TR.Paint.path([[cx + ex * 66, cz + ez * 66], [cx + ex * 15, cz + ez * 15]], 9, 'r');
      TR.Paint.path(this.ringPoints(cx, cz, 18.5, 28), 6, 'r');

      /* gate: lock bar (instanced, hidden when unlocked) + colliders */
      var gateYaw = yawTo(ex, ez);
      var gateEdge = Math.max(this.corridorEdge(c, GATE_DIST, -1), this.corridorEdge(c, GATE_DIST, 1));
      zone.gate = new T.Group();
      zone.gate.position.set(zone.gateX, 0, zone.gateZ);
      g.add(zone.gate);
      var gateParts = [];
      gateParts.push({ g: 'gate', it: this.inst('P_gate_lock', zone.gateX, zone.gateZ, gateYaw, 1.15, { group: 'gate', global: true, tint: biome.color }) });
      var gw = B.prop('P_gate_lock').box.max.x * 1.15 + 0.43;
      [-1, 1].forEach(function (side) {
        var line = (self.sideLines[index] && self.sideLines[index][side]) || (gateEdge + 1);
        if (line - gw < 1) return;
        self.fenceLine([cpt(c, GATE_DIST, gw * side), cpt(c, GATE_DIST, line * side)], { group: 'gatefence', global: true, list: gateParts });
      });
      zone.gateParts = gateParts;
      var gateLabel = M.makeLabel('', { w: 22, tw: 720, th: 200, fontSize: 66, color: '#ffffff', outlineColor: '#1a1a2e', outlineWidth: 14 });
      gateLabel.position.set(zone.gateX, 11, zone.gateZ);
      g.add(gateLabel);
      zone.gateLabel = gateLabel;
      zone.gateCollider = this.addBox(zone.gateX, zone.gateZ, 12, 4, 8, { id: 'gate' + index });
      /* close the slot between the gate and the bridge sides */
      zone.gateColliders = [zone.gateCollider];
      [-1, 1].forEach(function (side) {
        [5, 8.5, 12].forEach(function (v) {
          var p = cpt(c, GATE_DIST, v * side);
          zone.gateColliders.push(self.addBox(p[0], p[1], 4, 4, 8, { id: 'gate' + index }));
        });
      });

      /* entrance arch where the bridge meets the island */
      var archP = cpt(c, ZONE_DIST - ZONE_HALF, 0), archName = 'B_' + biome.id + '_arch';
      var arch = B.prop(archName), archH = arch.box.max.y;
      var am = new B.Merge();
      am.add(arch.geo, new T.Matrix4());
      var archMesh = am.build('static');
      archMesh.material = B.freshMaterial('static');
      archMesh.position.set(archP[0], 0, archP[1]);
      archMesh.rotation.y = gateYaw;
      archMesh.updateMatrix();
      archMesh.updateMatrixWorld(true);
      archMesh.name = 'arch:' + biome.id;
      g.add(archMesh);
      var lodRec = this.lods[this.lods.length - 1];
      lodRec.near.push(archMesh);
      lodRec.farExtra = [{ geo: B.lodGeometry(archName, 0.12), m: archMesh.matrix.clone() }];
      this.arches.push({ mesh: archMesh, inv: archMesh.matrixWorld.clone().invert(), box: arch.box.clone().expandByScalar(0.8), fade: 1, lod: lodRec });
      [-1, 1].forEach(function (side) {
        var p = cpt(c, ZONE_DIST - ZONE_HALF, 15.6 * side);
        self.addBox(p[0], p[1], 3.6, 3.6, archH, { id: 'cam' });
      });

      /* landmark with the floating monument egg */
      var lm = this.put(region, 'B_' + biome.id + '_landmark', cx, cz, gateYaw, 1);
      var lmTop = set.top;
      var lmW = Math.min(18, Math.max(8, Math.max(lm.box.max.x - lm.box.min.x, lm.box.max.z - lm.box.min.z) * 0.86));
      this.addBox(cx, cz, lmW, lmW, Math.max(3, lm.box.max.y));
      var monument = M.makeEgg(index === 0 ? '#211641' : biome.eggColor, index === 0 ? '#706a99' : biome.eggStripe, set.egg);
      var mb = new T.Box3().setFromObject(monument);
      var monumentY = lmTop - mb.min.y + 1.6;
      monument.position.set(cx, monumentY, cz);
      g.add(monument);
      this.animated.push({ obj: monument, kind: 'float', base: monumentY });

      var nameLabel = M.makeLabel('', { w: 24, tw: 720, th: 180, fontSize: 92, color: biome.color, outlineColor: '#1a1a2e', outlineWidth: 18 });
      nameLabel.position.set(cx, Math.max(24, monumentY + mb.max.y + 4.5), cz);
      g.add(nameLabel);
      zone.nameLabel = nameLabel;
      this.labels.push({ spr: nameLabel, key: biome.key });

      /* nests: same positions as before (same random sequence) */
      var rnd = U.seeded(1000 + index * 77);
      var nestCount = 4 + Math.min(2, index);
      for (var n = 0; n < nestCount; n++) {
        var na = (n / nestCount) * Math.PI * 2 + rnd();
        var nr = 22 + rnd() * 24;
        var nx = cx + Math.cos(na) * nr, nz = cz + Math.sin(na) * nr;
        if (index === 0) {
          var forestNests = [[-7, 34], [8, 30], [-20, 2], [19, -8]];
          nx = cx + forestNests[n][0]; nz = cz + forestNests[n][1];
        }
        this.buildNest(zone, nx, nz, biome, region);
      }
      if (index === 0) {
        for (var arrowZ = cz + ZONE_HALF - 4; arrowZ > cz + 12; arrowZ -= 7) this.arrows.push({ x: cx, z: arrowZ, yaw: Math.PI, phase: 0 });
      }

      this.decorateZone(zone, biome, set, region);
      this.region = 'hub';

      this.zones.push(zone);
      this.interactables.push({
        type: 'zoneGate', zoneIndex: index,
        x: zone.gateX - c.dx * 8, z: zone.gateZ - c.dz * 8, r: 10,
        hint: 'hint.unlock', hintMobile: 'hint.unlockMobile'
      });
      return zone;
    },

    ringPoints: function (cx, cz, r, n) {
      var pts = [];
      for (var i = 0; i <= n; i++) { var a = i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
      return pts;
    },

    buildNest: function (zone, x, z, biome, region) {
      var nest = { zone: zone, x: x, z: z, taken: false, respawn: 0 };
      this.put(region, 'P_nest', x, z, (x * 7 + z * 3) % 6, 1);
      /* two small eggs resting on the rim (static) */
      var K = new B.Kit();
      for (var i = 0; i < 2; i++) {
        var a = (i / 2) * Math.PI * 2 + 0.7;
        K.egg(0.75, biome.eggColor, biome.eggStripe, Math.cos(a) * 1.7, 1.15, Math.sin(a) * 1.7, { rz: 0.3 });
      }
      this.merge(region).add(K.build(0), B.mat(x, 0, z, 0, 1));
      nest.mesh = new T.Object3D();
      nest.mesh.position.set(x, 0, z);
      this.root.add(nest.mesh);

      var egg = M.makeEgg(biome.eggColor, biome.eggStripe, 1.9);
      egg.position.set(x, 2.1, z);
      (zone.eggGroup || this.root).add(egg);
      nest.egg = egg;
      this.animated.push({ obj: egg, kind: 'egg', base: 2.1, phase: Math.random() * 6 });

      this.nests.push(nest);
      this.interactables.push({ type: 'nest', nest: nest, x: x, z: z, r: 6.5, hint: 'hint.grabEgg', hintMobile: 'hint.grabEggMobile' });
      zone.nests.push(nest);
      return nest;
    },

    decorateZone: function (zone, biome, set, region) {
      var cx = zone.x, cz = zone.z, self = this, c = corr(zone.index);
      var ex = -c.dx, ez = -c.dz;
      var rnd = U.seeded(5000 + zone.index * 211);
      var pools = [];
      /* keep the ways clear: nests, entrance path, landmark, forest route of the bots */
      function clear(x, z, rad, opts) {
        opts = opts || {};
        var lx = x - cx, lz = z - cz, d = Math.sqrt(lx * lx + lz * lz);
        if (d < (opts.minR || 17)) return false;
        if (d > (opts.maxR || 50)) return false;
        var along = lx * ex + lz * ez, lat = Math.abs(lx * -ez + lz * ex);
        if (along > 0 && lat < 9 + rad) return false;
        if (Math.abs(d - 18.5) < 3 + rad) return false;
        if (zone.id === 'forest' && Math.abs(x - cx) < 17 && z > cz - 8) return false;
        for (var i = 0; i < zone.nests.length; i++) {
          var nn = zone.nests[i];
          if (Math.hypot(x - nn.x, z - nn.z) < (opts.nest || 10) + rad) return false;
        }
        for (var p = 0; p < pools.length; p++) {
          if (Math.hypot(x - pools[p].x, z - pools[p].z) < pools[p].r * 1.25 + rad + 1) return false;
        }
        return true;
      }

      /* liquid pools */
      var pdef = set.pool;
      if (pdef) {
        pdef.sizes.forEach(function (r, k) {
          for (var tries = 0; tries < 60; tries++) {
            var a = rnd() * Math.PI * 2, d = 24 + rnd() * 22, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
            if (!clear(x, z, r * 1.2, { nest: 9 })) continue;
            pools.push({ x: x, z: z, r: r, seed: rnd() * 10 });
            break;
          }
        });
        if (pools.length) {
          var pm = new T.Mesh(TR.poolGeometry(pools, 0.07), TR.liquidMaterial(pdef.kind, pdef.a, pdef.b, pdef.c));
          pm.renderOrder = 1;
          pm.name = 'pools:' + zone.id;
          this.root.add(pm);
          this.lods[this.lods.length - 1].extra.push(pm);
          /* stones / sugar / snow around the edge */
          var rimK = new B.Kit();
          var rimCol = { forest: '#9a958a', desert: '#d9a866', candy: '#ffffff', ice: '#f2fbff', volcano: '#2f2a2a', sky: '#f4f0ff' }[zone.id];
          pools.forEach(function (pl) {
            var steps = Math.round(pl.r * 2.2);
            for (var s = 0; s < steps; s++) {
              var a2 = s / steps * Math.PI * 2 + rnd() * 0.2, rr = TR.poolRadius(pl.r, pl.seed, a2) + 0.35;
              rimK.rock(0.55 + rnd() * 0.35, rimCol, pl.x + Math.cos(a2) * rr, 0.12, pl.z + Math.sin(a2) * rr, { seed: s, sy: 0.55, ry: rnd() * 6 });
            }
            if (zone.id === 'forest' || pdef.palms) {
              for (var rd = 0; rd < 3; rd++) {
                var ra = rnd() * Math.PI * 2, rr2 = pl.r + 1.2;
                self.inst(pdef.palms ? 'B_desert_palm' : 'B_shore_reeds', pl.x + Math.cos(ra) * rr2, pl.z + Math.sin(ra) * rr2, rnd() * 6, pdef.palms ? 0.9 : 0.8, pdef.palms ? {} : { thin: rnd() * 0.6 });
                if (pdef.palms) self.addBox(pl.x + Math.cos(ra) * rr2, pl.z + Math.sin(ra) * rr2, 1.6, 1.6, 8, { noCam: true });
              }
            }
          });
          this.merge(region).add(rimK.build(0), new T.Matrix4());
        }
      }

      /* rim of themed pieces instead of a wall */
      var entryAng = Math.atan2(ez, ex), R = LOOK.rimR;
      var count = Math.round(2 * Math.PI * R / LOOK.rimStep);
      for (var r = 0; r < count; r++) {
        var ra2 = (r / count) * Math.PI * 2 + 0.05, diff = Math.atan2(Math.sin(ra2 - entryAng), Math.cos(ra2 - entryAng));
        if (Math.abs(diff) < LOOK.rimGap) continue;
        var nm = rnd() < 0.5 ? 'B_' + biome.id + '_rim_a' : 'B_' + biome.id + '_rim_b';
        var rp = B.prop(nm), sc = 0.95 + rnd() * 0.22, rr3 = R + (rnd() - 0.5) * 1.5;
        var px = cx + Math.cos(ra2) * rr3, pz = cz + Math.sin(ra2) * rr3;
        this.inst(nm, px, pz, yawTo(-Math.cos(ra2), -Math.sin(ra2)) + (rnd() - 0.5) * 0.3, sc,
          { cam: [5, 5, Math.max(2, rp.box.max.y * sc * 0.9)] });
      }

      /* big decor inside (always shown, solid) */
      var placed = 0;
      for (var t = 0; t < 120 && placed < 9; t++) {
        var a3 = rnd() * Math.PI * 2, d3 = 20 + rnd() * 30, x3 = cx + Math.cos(a3) * d3, z3 = cz + Math.sin(a3) * d3;
        if (!clear(x3, z3, 2, { nest: 11 })) continue;
        var nm3 = set.inner[placed % set.inner.length];
        var s3 = 0.9 + rnd() * 0.35;
        this.inst(nm3, x3, z3, rnd() * 6, s3);
        this.addBox(x3, z3, 2.6, 2.6, Math.min(8, B.prop(nm3).box.max.y * s3), { noCam: true });
        placed++;
      }
      /* small decor inside (thinned, walk-through) */
      for (var s = 0; s < 26; s++) {
        var a4 = rnd() * Math.PI * 2, d4 = 18 + rnd() * 34, x4 = cx + Math.cos(a4) * d4, z4 = cz + Math.sin(a4) * d4;
        if (!clear(x4, z4, 0.5, { nest: 7, maxR: 53 })) continue;
        this.inst(set.small[s % set.small.length], x4, z4, rnd() * 6, 0.75 + rnd() * 0.35, { thin: rnd() });
      }
      /* outer belt beyond the rim (thinned) */
      for (var o = 0; o < 46; o++) {
        var a5 = rnd() * Math.PI * 2, d5 = 64 + rnd() * 12, x5 = cx + Math.cos(a5) * d5, z5 = cz + Math.sin(a5) * d5;
        var diff5 = Math.atan2(Math.sin(a5 - entryAng), Math.cos(a5 - entryAng));
        if (Math.abs(diff5) < 0.42) continue;
        if (TR.height(x5, z5) < -0.25) continue;
        this.inst(set.outer[o % set.outer.length], x5, z5, rnd() * 6, 0.85 + rnd() * 0.5, { thin: rnd() });
      }
      /* waterline pieces */
      this.shoreRing(cx, cz, zone.index, zone.id === 'sky' ? 1.6 : 1, 32, 10 + zone.index, set.shore);
      if (zone.id === 'sky') {
        for (var f = 0; f < 10; f++) {
          var a6 = rnd() * Math.PI * 2, p6 = this.coastAlong(cx, cz, a6, 4 + rnd() * 6);
          if (!p6 || this.nearCauseway(p6.x, p6.z, 28)) continue;
          this.inst('B_sky_floatrock', p6.x, p6.z, rnd() * 6, 1.2 + rnd() * 0.8, { y: TR.WATER_Y + 1 + rnd() * 3, thin: rnd() * 0.69 });
        }
      }
      if (zone.id === 'ice') {
        for (var fl = 0; fl < 14; fl++) {
          var a7 = rnd() * Math.PI * 2, p7 = this.coastAlong(cx, cz, a7, 3 + rnd() * 10);
          if (!p7 || this.nearCauseway(p7.x, p7.z, 28)) continue;
          this.inst('B_ice_chunk', p7.x, p7.z, rnd() * 6, { x: 2 + rnd(), y: 0.35, z: 2 + rnd() }, { y: TR.WATER_Y - 0.1, thin: rnd() * 0.69, cast: false });
        }
      }
    },

    /* ---------- ground ---------- */
    buildGround: function () {
      TR.finishMasks();
      var mats = { hub: TR.groundMaterial({ hub: true }) };
      var centers = [];
      for (var i = 0; i < 6; i++) {
        var c = corr(i), biome = SE.Pets.BIOMES[i], bl = BIOME_LOOK[biome.id] || BIOME_LOOK.forest;
        centers.push([c.dx * ZONE_DIST, c.dz * ZONE_DIST]);
        mats['z' + i] = TR.groundMaterial({
          top: bl.top, path: bl.path, shore: bl.shore, scales: bl.scales, lava: !!bl.lava,
          center: centers[i], r1: 64, r2: 112
        });
      }
      var meshes = TR.buildGround(function (x, z) {
        for (var k = 0; k < 6; k++) {
          var dx = x - centers[k][0], dz = z - centers[k][1];
          if (dx * dx + dz * dz < 113 * 113) return 'z' + k;
        }
        return 'hub';
      }, mats);
      var self = this;
      meshes.forEach(function (m) { self.root.add(m); });
      this.groundMeshes = meshes;
    },

    /* ---------- batching ---------- */
    finishBatches: function () {
      var self = this;
      var lodBy = {};
      this.lods.forEach(function (l) { lodBy[l.region] = l; });
      Object.keys(this.merges).forEach(function (k) {
        var mesh = self.merges[k].build('static');
        if (!mesh) return;
        mesh.name = 'static:' + k;
        self.root.add(mesh);
        if (lodBy[k]) { lodBy[k].near.push(mesh); lodBy[k].staticGeo = mesh.geometry; }
      });
      this.instList.forEach(function (g) {
        var mesh = g.build();
        if (!mesh) return;
        self.root.add(mesh);
        if (g.lowMesh) self.root.add(g.lowMesh);
        g.thinnable = g.list.some(function (it) { return it.thin >= 0; });
        var l = g.region && lodBy[g.region];
        if (l) { l.near.push(mesh); l.groups.push(g); }
      });
      /* far version of every island / bridge: one simplified merged mesh */
      this.lods.forEach(function (l) {
        var far = new B.Merge();
        if (l.staticGeo) far.add(B.simplify(l.staticGeo, 1.4), new T.Matrix4());
        (l.farExtra || []).forEach(function (e) { far.add(e.geo, e.m); });
        l.groups.forEach(function (g) { if (B.prop(g.name).box.max.y > 2.2) g.addFar(far, LOOK.keep.low, 0.2); });
        l.far = far.build('static', { cast: false });
        if (l.far) { l.far.name = 'far:' + l.region; self.root.add(l.far); }
        l.isNear = undefined;
      });
      /* flags */
      if (this.flagAttr.length) {
        var fg = this.flagKit.build(0);
        fg.setAttribute('flag', new T.Float32BufferAttribute(this.flagAttr, 2));
        var flags = new T.Mesh(fg, flagMaterial());
        flags.castShadow = true;
        flags.name = 'flags';
        this.root.add(flags);
      }
      /* route arrows: one instanced mesh */
      var ag = new T.PlaneGeometry(4.9, 4.9);
      ag.rotateZ(Math.PI);
      ag.rotateX(-Math.PI / 2);
      var am = new T.InstancedMesh(ag, new T.MeshBasicMaterial({ map: arrowTexture(), transparent: true, depthWrite: false }), this.arrows.length);
      am.frustumCulled = false;
      am.name = 'arrows';
      this.root.add(am);
      this.arrowMesh = am;
      this.updateArrows(0);
    },

    updateArrows: function (time) {
      var m = this.arrowMesh;
      if (!m) return;
      var mm = this._am || (this._am = new T.Matrix4());
      for (var i = 0; i < this.arrows.length; i++) {
        var a = this.arrows[i];
        var y = 0.12 + Math.abs(Math.sin(time * 2.4 + a.phase)) * 0.35;
        var cs = Math.cos(a.yaw), sn = Math.sin(a.yaw);
        mm.set(cs, 0, sn, a.x, 0, 1, 0, y, -sn, 0, cs, a.z, 0, 0, 0, 1);
        m.setMatrixAt(i, mm);
      }
      m.instanceMatrix.needsUpdate = true;
    },

    /* Static objects never recompute their matrices. */
    freezeStatic: function () {
      for (var i = 0; i < this.animated.length; i++) {
        var a = this.animated[i];
        if (a.obj) a.obj.userData.__dyn = true;
        if (a.list) a.list.forEach(function (r) { r.obj.userData.__dyn = true; });
      }
      for (var p = 0; p < this.pens.length; p++) this.pens[p].content.userData.__dyn = true;
      for (var b = 0; b < this.botPlots.length; b++) this.botPlots[b].content.userData.__dyn = true;
      function walk(obj, parentDyn) {
        var isDyn = parentDyn || !!obj.userData.__dyn;
        if (!isDyn) {
          obj.updateMatrix();
          obj.matrixAutoUpdate = false;
        }
        for (var c = 0; c < obj.children.length; c++) walk(obj.children[c], isDyn);
      }
      for (var k = 0; k < this.root.children.length; k++) {
        var ch = this.root.children[k];
        /* parents of animated parts must update when their children do */
        if (ch.children.some(function (o) { return o.userData.__dyn; })) { walk(ch, true); continue; }
        walk(ch, false);
      }
      this.root.updateMatrixWorld(true);
    },

    /* ---------- quality: thins trees, bushes and small decor ---------- */
    setQuality: function (q) {
      if (['low', 'medium', 'high'].indexOf(q) < 0) q = 'high';
      this.quality = q;
      var keep = LOOK.keep[q];
      (this.instList || []).forEach(function (g) { if (g.thinnable) g.setKeep(keep); g.setLow(q === 'low'); });
      TR.setQuality(q);
      if (TR.clouds) TR.clouds.visible = q !== 'low';
    },

    /* ---------- update ---------- */
    update: function (dt, time, playerPos) {
      B.TIME.value = time;
      var cam = SE.Game && SE.Game.camera;
      TR.update(dt, time, cam);
      var fog = this.scene && this.scene.fog;
      if (fog && fog.far !== this.fogFar) { this.fogFar = fog.far; fog.near = fog.far * LOOK.fogNear; }
      this.updateArrows(time);
      if (cam) { this.updateLods(cam.position.x, cam.position.z); this.updateArches(cam.position, playerPos, dt); }
      for (var i = 0; i < this.animated.length; i++) {
        var a = this.animated[i];
        switch (a.kind) {
          case 'vendor':
            a.model.update(dt, false, 1, true);
            break;
          case 'egg':
            a.obj.position.y = a.base + Math.sin(time * 2 + a.phase) * 0.28;
            a.obj.rotation.y += dt * 0.8;
            break;
          case 'float':
            a.obj.position.y = a.base + Math.sin(time * 0.9) * 0.7;
            a.obj.rotation.y += dt * 0.25;
            break;
          case 'pulse':
            a.obj.material.opacity = 0.28 + Math.abs(Math.sin(time * 2)) * 0.3;
            break;
          case 'blades':
            a.obj.rotation.z += dt * 1.1;
            break;
          case 'belt':
            a.map.offset.y -= dt * 1.4;
            break;
          case 'ribbons':
            for (var r = 0; r < a.list.length; r++) {
              var rb = a.list[r];
              rb.obj.position.y = rb.y + Math.sin(time * 2 + r) * 0.16;
              rb.obj.rotation.y = rb.ry + Math.sin(time + r) * 0.4;
            }
            break;
          case 'water':
            a.obj.position.y = a.y + Math.sin(time * 2.2) * 0.04;
            break;
          case 'boat':
            a.obj.position.y = a.y + Math.sin(time * 1.3) * 0.12;
            a.obj.rotation.z = Math.sin(time * 1.1) * 0.035;
            break;
        }
      }
      /* pen props follow the game state */
      var inc = this.insts.incubator, sign = this.insts.pensign;
      for (var p = 0; p < this.penProxies.length; p++) {
        var pp = this.penProxies[p];
        var showSign = pp.pen.sign.group.visible !== false;
        if (showSign !== pp.signShown) { pp.signShown = showSign; if (sign) sign.setHidden(pp.sign, !showSign); }
        var showInc = !pp.pen.petModel;
        if (showInc !== pp.incShown) { pp.incShown = showInc; if (inc) inc.setHidden(pp.incubator, !showInc); }
      }
    },

    /* An entrance arch fades out while it hides the player from the camera. */
    updateArches: function (cam, player, dt) {
      if (!player) return;
      var p0 = this._ap0 || (this._ap0 = new T.Vector3()), p1 = this._ap1 || (this._ap1 = new T.Vector3());
      for (var i = 0; i < this.arches.length; i++) {
        var a = this.arches[i];
        if (!a.lod.isNear && a.fade >= 1) continue;
        p0.copy(cam).applyMatrix4(a.inv);
        p1.set(player.x, player.y + 4.5, player.z).applyMatrix4(a.inv);
        var hit = a.lod.isNear && this.segmentHitsBox(p0, p1, a.box);
        var target = hit ? 0.16 : 1;
        a.fade += (target - a.fade) * Math.min(1, dt * 9);
        if (Math.abs(a.fade - target) < 0.01) a.fade = target;
        var m = a.mesh.material, see = a.fade < 0.995;
        m.opacity = a.fade;
        m.transparent = see;
        m.depthWrite = !see;
      }
    },
    segmentHitsBox: function (p0, p1, box) {
      var t0 = 0, t1 = 1, d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z], o = [p0.x, p0.y, p0.z];
      var mn = [box.min.x, box.min.y, box.min.z], mx = [box.max.x, box.max.y, box.max.z];
      for (var k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < 1e-6) { if (o[k] < mn[k] || o[k] > mx[k]) return false; continue; }
        var ta = (mn[k] - o[k]) / d[k], tb = (mx[k] - o[k]) / d[k];
        if (ta > tb) { var tt = ta; ta = tb; tb = tt; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) return false;
      }
      return true;
    },

    /* Near: detailed instanced props; far: one simplified mesh per island / bridge. */
    updateLods: function (x, z) {
      for (var i = 0; i < this.lods.length; i++) {
        var l = this.lods[i], dx = x - l.cx, dz = z - l.cz, d = Math.sqrt(dx * dx + dz * dz);
        var near = l.isNear ? d < l.dist + 10 : d < l.dist - 10;
        if (near === l.isNear) continue;
        l.isNear = near;
        for (var k = 0; k < l.near.length; k++) l.near[k].visible = near;
        for (var e = 0; e < l.extra.length; e++) l.extra[e].visible = near;
        if (l.far) l.far.visible = !near;
      }
      /* guards patrolling a far island are not drawn (chasing ones always are) */
      for (var zi = 0; zi < this.zones.length; zi++) {
        var zn = this.zones[zi], gx = x - zn.x, gz = z - zn.z;
        var gd = Math.sqrt(gx * gx + gz * gz), show = gd < 195;
        for (var g = 0; g < zn.guards.length; g++) {
          var gu = zn.guards[g];
          if (gu.model && gu.model.group) gu.model.group.visible = show || gu.state !== 'patrol';
        }
      }
    },

    refreshLabels: function () {
      for (var i = 0; i < this.labels.length; i++) {
        var l = this.labels[i];
        if (l.spr.userData.setText) l.spr.userData.setText(SE.t(l.key));
      }
    },

    setZoneUnlocked: function (index, unlocked) {
      var zone = this.zones[index];
      if (!zone) return;
      zone.unlocked = unlocked;
      zone.gate.visible = !unlocked;
      zone.gateCollider.solid = !unlocked;
      (zone.gateColliders || []).forEach(function (c) { c.solid = !unlocked; });
      var self = this;
      (zone.gateParts || []).forEach(function (p) { var g = self.insts[p.g]; if (g && p.it) g.setHidden(p.it, unlocked); });
      if (zone.gateLabel) {
        zone.gateLabel.visible = !unlocked;
        if (!unlocked && zone.gateLabel.userData.setText) {
          zone.gateLabel.userData.setText(SE.t(zone.biome.key) + '\n' + SE.t('world.unlockFor', U.money(zone.biome.price)));
        }
      }
    },

    inSafeZone: function (x, z) {
      return Math.sqrt(x * x + z * z) < HUB_R + 10;
    },

    zoneAt: function (x, z) {
      for (var i = 0; i < this.zones.length; i++) {
        var zn = this.zones[i];
        var dx = x - zn.x, dz = z - zn.z;
        if (dx * dx + dz * dz < (ZONE_HALF + 6) * (ZONE_HALF + 6)) return zn;
      }
      return null;
    },

    PEN_PRICES: PEN_PRICES
  };

  SE.World = World;
})(window);
