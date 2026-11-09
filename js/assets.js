/* =========================================================
   3D-ассеты: загрузка GLB из Blender и «слотовый» материал.
   Каждая часть модели — один draw call: цвета материалов
   сворачиваются в вершинный цвет (умноженный на запечённый AO),
   а атрибут slot говорит, какой цвет перекрашивается
   (1..5 — tint1..tint5, 6 — свечение).
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};
  var T = global.THREE;

  var FILES = ['character', 'guards_a', 'guards_b', 'pets_a', 'pets_b', 'props_base', 'props_biomes_a', 'props_biomes_b', 'cosmetics_a', 'cosmetics_b'];

  /* ---------------- материал со слотами ---------------- */
  var VERT_HEAD = [
    'attribute float slot;',
    'uniform vec3 uTint[5];',
    'uniform float uGlow;',
    'varying float vGlow;'
  ].join('\n');
  var VERT_COLOR = [
    'float sl = floor(slot + 0.5);',
    'vGlow = 0.0;',
    'if (sl > 0.5 && sl < 5.5) {',
    '  vColor.rgb *= sl < 1.5 ? uTint[0] : (sl < 2.5 ? uTint[1] : (sl < 3.5 ? uTint[2] : (sl < 4.5 ? uTint[3] : uTint[4])));',
    '  vGlow = uGlow;',
    '}',
    'if (sl > 5.5) vGlow = 1.0;'
  ].join('\n');
  var FRAG_HEAD = [
    'uniform float uRim;',
    'uniform vec3 uFlash;',
    'uniform float uFade;',
    'varying float vGlow;'
  ].join('\n');

  function slotMaterial(opts) {
    opts = opts || {};
    var m = new T.MeshLambertMaterial({ vertexColors: true });
    var tints = [];
    for (var i = 0; i < 5; i++) tints.push(new T.Color(opts.tints && opts.tints[i] ? opts.tints[i] : '#ffffff'));
    var u = {
      uTint: { value: tints },
      uGlow: { value: opts.glow || 0 },
      uRim: { value: opts.rim === undefined ? 0 : opts.rim },
      uFlash: { value: new T.Color(0, 0, 0) },
      uFade: { value: 1 }
    };
    m.userData.u = u;
    m.userData.slotMat = true;
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTint = u.uTint;
      sh.uniforms.uGlow = u.uGlow;
      sh.uniforms.uRim = u.uRim;
      sh.uniforms.uFlash = u.uFlash;
      sh.uniforms.uFade = u.uFade;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
        .replace('#include <color_vertex>', '#include <color_vertex>\n' + VERT_COLOR);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vGlow * 0.9 + uFlash;')
        .replace('#include <output_fragment>',
          'outgoingLight += diffuseColor.rgb * uRim * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);\n' +
          '#include <output_fragment>');
    };
    m.customProgramCacheKey = function () { return 'se-slot-1'; };
    return m;
  }

  /* ---------------- подготовка геометрии ---------------- */
  var TINT_RE = /^tint([1-5])/;
  var tmpC = new T.Color();

  function primitiveInfo(material) {
    var match = TINT_RE.exec(material.name || '');
    if (match) return { slot: +match[1], color: new T.Color(1, 1, 1) };
    var e = material.emissive;
    if (e && e.r + e.g + e.b > 0.02) return { slot: 6, color: e.clone() };
    return { slot: 0, color: material.color ? material.color.clone() : new T.Color(1, 1, 1) };
  }

  /* Геометрия примитива -> position, normal, color(vec3, AO * цвет), slot. */
  function slotGeometry(mesh) {
    var src = mesh.geometry;
    var info = primitiveInfo(mesh.material);
    var g = src.index ? src.toNonIndexed() : src.clone();
    var n = g.attributes.position.count;
    var col = new Float32Array(n * 3);
    var slot = new Float32Array(n);
    var aoAttr = g.attributes.color;
    for (var i = 0; i < n; i++) {
      var a = 1;
      if (aoAttr) a = aoAttr.getX(i);
      col[i * 3] = info.color.r * (info.slot === 6 ? 1 : a);
      col[i * 3 + 1] = info.color.g * (info.slot === 6 ? 1 : a);
      col[i * 3 + 2] = info.color.b * (info.slot === 6 ? 1 : a);
      slot[i] = info.slot;
    }
    var out = new T.BufferGeometry();
    out.setAttribute('position', g.attributes.position);
    if (g.attributes.normal) out.setAttribute('normal', g.attributes.normal);
    else { out.setAttribute('normal', g.attributes.position.clone()); out.computeVertexNormals(); }
    out.setAttribute('color', new T.BufferAttribute(col, 3));
    out.setAttribute('slot', new T.BufferAttribute(slot, 1));
    g.dispose();
    return out;
  }

  /* Склеиваем примитивы каждого узла в один Mesh со слотовыми атрибутами. */
  function collapse(root, parser) {
    var jobs = [];
    var A = parser.associations;
    /* примитив меша группы: тот же индекс меша, что у родительской группы */
    function isPrimOf(c, group) {
      var a = A.get(c), g = A.get(group);
      return c.isMesh && a && g && a.primitives !== undefined && !group.isMesh && a.meshes === g.meshes;
    }
    root.traverse(function (o) {
      var a = A.get(o);
      if (!a) return;
      if (o.isMesh && a.primitives !== undefined) {
        if (!(o.parent && isPrimOf(o, o.parent))) jobs.push({ node: o, prims: [o] });
      } else if (!o.isMesh && a.meshes !== undefined) {
        var prims = o.children.filter(function (c) { return isPrimOf(c, o); });
        if (prims.length) jobs.push({ node: o, prims: prims });
      }
    });
    jobs.forEach(function (job) {
      var geos = job.prims.map(slotGeometry);
      var merged = geos.length === 1 ? geos[0] : T.BufferGeometryUtils.mergeBufferGeometries(geos, false);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      merged.userData.shared = true;
      var mesh = new T.Mesh(merged, SE.Assets.staticMaterial);
      var node = job.node;
      mesh.name = node.name;
      mesh.position.copy(node.position);
      mesh.quaternion.copy(node.quaternion);
      mesh.scale.copy(node.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      var kids = node.children.filter(function (c) { return job.prims.indexOf(c) < 0; });
      kids.forEach(function (c) { mesh.add(c); });
      var parent = node.parent;
      if (parent) {
        var idx = parent.children.indexOf(node);
        parent.children[idx] = mesh;
        mesh.parent = parent;
        node.parent = null;
      }
      job.prims.forEach(function (p) { if (p.geometry) p.geometry.dispose(); });
    });
  }

  var Assets = {
    nodes: {},
    loaded: false,
    staticMaterial: null,

    material: slotMaterial,

    load: function (onProgress) {
      var self = this;
      this.staticMaterial = slotMaterial({ rim: 0 });
      this.fadeMaterial = slotMaterial({ rim: 0 });
      var loader = new T.GLTFLoader();
      var done = 0;
      var jobs = FILES.map(function (file) {
        return new Promise(function (resolve, reject) {
          loader.load('assets/models/' + file + '.glb', function (gltf) {
            try {
              var scene = gltf.scene;
              collapse(scene, gltf.parser);
              scene.updateMatrixWorld(true);
              for (var i = 0; i < scene.children.length; i++) {
                var top = scene.children[i];
                self.nodes[top.name] = top;
              }
              done++;
              if (onProgress) onProgress(done / FILES.length);
              resolve();
            } catch (err) { reject(err); }
          }, undefined, function (err) {
            /* Модель ещё не собрана — игра использует запасные формы. */
            console.warn('Model file missing: ' + file, err && err.message);
            done++;
            if (onProgress) onProgress(done / FILES.length);
            resolve();
          });
        });
      });
      return Promise.all(jobs).then(function () { self.loaded = true; });
    },

    has: function (name) { return !!this.nodes[name]; },

    /* Догрузка файла по требованию (полноразмерные скины): Promise -> true/false. */
    pending: {},
    ensure: function (file) {
      var self = this;
      if (this.pending[file]) return this.pending[file];
      var loader = new T.GLTFLoader();
      this.pending[file] = new Promise(function (resolve) {
        loader.load('assets/models/' + file + '.glb', function (gltf) {
          try {
            collapse(gltf.scene, gltf.parser);
            gltf.scene.updateMatrixWorld(true);
            gltf.scene.children.slice().forEach(function (top) { self.nodes[top.name] = top; });
            resolve(true);
          } catch (err) { console.warn('Model prepare failed: ' + file, err); resolve(false); }
        }, undefined, function () { console.warn('Model file missing: ' + file); resolve(false); });
      });
      return this.pending[file];
    },

    /* Копия шаблона: геометрия общая, материал общий статичный, если не задан другой. */
    clone: function (name, material) {
      var src = this.nodes[name];
      if (!src) throw new Error('Missing model: ' + name);
      var c = src.clone(true);
      c.position.set(0, 0, 0);
      c.rotation.set(0, 0, 0);
      c.scale.set(1, 1, 1);
      if (material) this.paint(c, material);
      return c;
    },

    paint: function (obj, material) {
      obj.traverse(function (o) { if (o.isMesh && o.geometry.attributes.slot) o.material = material; });
      return obj;
    },

    /* Карта «имя -> объект» внутри модели (части для анимации). */
    parts: function (obj) {
      var map = {};
      obj.traverse(function (o) {
        if (!o.name) return;
        /* Blender переименовывает повторы в «Head.001» -> в glTF «Head001»: отрезаем суффикс. */
        var key = o.name.replace(/^(.+?)_?\d{3}$/, '$1');
        if (!map[key]) map[key] = o;
        if (!map[o.name]) map[o.name] = o;
      });
      return map;
    },

    setTint: function (material, index, color) {
      material.userData.u.uTint.value[index].set(color);
    }
  };

  Assets.FILES = FILES;
  SE.Assets = Assets;
})(window);
