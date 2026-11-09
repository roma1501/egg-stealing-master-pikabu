/* ImageGen UI assets, shared loading, accessible names and bounded fallbacks. */
(function (global) {
  'use strict';
  var SE = global.SE = global.SE || {};
  var fallback = {
    bag: 'INV', book: 'INDEX', gear: 'SET', egg: 'EGG', paw: 'PET', shoe: 'SPD',
    trophy: 'TOP', rainbow: 'TRAIL', banknotes: '$', 'money-bag': '$',
    'interact-hand': 'E', 'jump-arrow': 'UP', star: '*', shop: 'SHOP', close: 'X',
    'finish-flag': 'FIN', gift: 'GIFT', chest: 'CHEST', 'prize-wheel': 'SPIN', question: '?',
    'watch-video': '>', 'fast-hatch': '2X', 'hatching-chick': 'HATCH', lightning: 'SPD',
    shield: 'SAFE', sparkles: 'UP', 'pen-house': 'HOME', moon: 'OFF', map: 'MAP',
    magnet: '+', ghost: 'HIDE', clover: 'LUCK', 'cash-bonus': '$', heart: '+', 'smoke-puff': '...'
  };
  ['green', 'blue', 'purple', 'gold', 'rainbow'].forEach(function (id) { fallback['trail-' + id] = 'TRAIL'; });
  ['forest', 'desert', 'candy', 'ice', 'volcano', 'sky'].forEach(function (id) { fallback['egg-' + id] = 'EGG'; });

  /* Vector icons drawn for the cosmetic shop (no network request, crisp at any size). */
  var INK = '#1a0f06';
  function svg(inner) { return '<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">' + inner + '</svg>'; }
  function poly(points, fill) { return '<polygon points="' + points + '" fill="' + fill + '" stroke="#0b2a4a" stroke-width="1.6" stroke-linejoin="round"/>'; }
  var vectors = {
    gem: svg(
      poly('10,24 20,9 27,24', '#3db8ee') + poly('20,9 32,9 27,24', '#8fe6ff') + poly('32,9 44,9 37,24', '#5bd0fa') +
      poly('44,9 54,24 37,24', '#2aa6e6') + poly('32,9 37,24 27,24', '#d2f8ff') +
      poly('10,24 27,24 32,57', '#1d8fe0') + poly('27,24 37,24 32,57', '#45bcf6') + poly('37,24 54,24 32,57', '#1673c4') +
      '<path d="M10 24 L20 9 H44 L54 24 L32 57 Z" fill="none" stroke="#0b2a4a" stroke-width="3.6" stroke-linejoin="round"/>' +
      '<path d="M17 20 L22 13" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/>'),
    outfit: svg(
      '<path d="M21 9 L7 18 L12 29 L20 25 V55 H44 V25 L52 29 L57 18 L43 9 Q32 19 21 9 Z" fill="#4aa3ff" stroke="' + INK + '" stroke-width="3.6" stroke-linejoin="round"/>' +
      '<path d="M21 9 Q32 19 43 9 L40 8 Q32 14 24 8 Z" fill="#fff" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M20 25 V55 H32 V30 Z" fill="#2f86e8" opacity=".55"/>' +
      '<rect x="26" y="38" width="12" height="9" rx="2" fill="#ffd24a" stroke="' + INK + '" stroke-width="2.2"/>'),
    hat: svg(
      '<path d="M12 40 Q10 14 33 14 Q54 14 54 40 Z" fill="#e8463d" stroke="' + INK + '" stroke-width="3.6" stroke-linejoin="round"/>' +
      '<path d="M8 40 H60 Q62 52 50 52 H18 Q8 52 8 40 Z" fill="#c92d2d" stroke="' + INK + '" stroke-width="3.6" stroke-linejoin="round"/>' +
      '<circle cx="33" cy="12" r="4.2" fill="#ffd24a" stroke="' + INK + '" stroke-width="2.6"/>' +
      '<path d="M19 33 Q22 21 33 20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>'),
    face: svg(
      '<circle cx="32" cy="33" r="23" fill="#ffd69a" stroke="' + INK + '" stroke-width="3.6"/>' +
      '<rect x="10" y="26" width="19" height="13" rx="5" fill="#2b2f4a" stroke="' + INK + '" stroke-width="2.6"/>' +
      '<rect x="35" y="26" width="19" height="13" rx="5" fill="#2b2f4a" stroke="' + INK + '" stroke-width="2.6"/>' +
      '<path d="M29 31 H35" stroke="' + INK + '" stroke-width="3"/>' +
      '<path d="M14 29 L20 29" stroke="#7fd4ff" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M22 47 Q32 54 42 47" fill="none" stroke="' + INK + '" stroke-width="3.2" stroke-linecap="round"/>'),
    back: svg(
      '<path d="M24 12 Q24 5 32 5 Q40 5 40 12" fill="none" stroke="' + INK + '" stroke-width="3.6" stroke-linecap="round"/>' +
      '<rect x="13" y="11" width="38" height="45" rx="12" fill="#f08a3c" stroke="' + INK + '" stroke-width="3.6"/>' +
      '<rect x="19" y="33" width="26" height="18" rx="6" fill="#d96a1f" stroke="' + INK + '" stroke-width="2.8"/>' +
      '<path d="M19 40 H45" stroke="' + INK + '" stroke-width="2.4"/>' +
      '<rect x="28" y="38" width="8" height="5" rx="1.5" fill="#ffd24a" stroke="' + INK + '" stroke-width="2"/>' +
      '<path d="M19 21 Q22 16 28 16" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>'),
    aura: svg(
      '<ellipse cx="32" cy="34" rx="25" ry="23" fill="#ff7bd8" stroke="' + INK + '" stroke-width="3.2"/>' +
      '<ellipse cx="32" cy="34" rx="17" ry="15.5" fill="#9b6bff" stroke="' + INK + '" stroke-width="2.8"/>' +
      '<ellipse cx="32" cy="34" rx="8.5" ry="8" fill="#ffe27a" stroke="' + INK + '" stroke-width="2.6"/>' +
      '<path d="M50 6 L52.6 12.4 L59 15 L52.6 17.6 L50 24 L47.4 17.6 L41 15 L47.4 12.4 Z" fill="#fff" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M12 40 L13.6 44 L17.6 45.6 L13.6 47.2 L12 51.2 L10.4 47.2 L6.4 45.6 L10.4 44 Z" fill="#fff" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>'),
    check: svg('<circle cx="32" cy="32" r="27" fill="#2fcb4a" stroke="' + INK + '" stroke-width="4"/>' +
      '<path d="M18 33 L28 43 L47 22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'),
    lock: svg('<path d="M20 28 V21 Q20 9 32 9 Q44 9 44 21 V28" fill="none" stroke="' + INK + '" stroke-width="5" stroke-linecap="round"/>' +
      '<rect x="12" y="27" width="40" height="29" rx="7" fill="#ffc83a" stroke="' + INK + '" stroke-width="3.6"/>' +
      '<circle cx="32" cy="40" r="4.2" fill="' + INK + '"/><rect x="30" y="41" width="4" height="9" rx="1.6" fill="' + INK + '"/>'),
    play: svg('<circle cx="32" cy="32" r="27" fill="#ffb02e" stroke="' + INK + '" stroke-width="4"/>' +
      '<path d="M25 18 L47 32 L25 46 Z" fill="#fff" stroke="' + INK + '" stroke-width="3.4" stroke-linejoin="round"/>')
  };
  var state = {}, pending = {};
  var labels = {
    'interact-hand': { ru: 'Действие', en: 'Interact', tr: 'Eylem' },
    'jump-arrow': { ru: 'Прыжок', en: 'Jump', tr: 'Zıpla' },
    'money-bag': { ru: 'Продать всех', en: 'Sell all', tr: 'Hepsini sat' }
  };
  function keyOf(key) {
    return Object.prototype.hasOwnProperty.call(vectors, key) || Object.prototype.hasOwnProperty.call(fallback, key) ? key : 'egg';
  }
  function escape(text) { return String(text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function url(key) { return 'assets/ui/' + keyOf(key) + '.png'; }
  function html(key, opts) {
    key = keyOf(key); opts = opts || {};
    if (vectors[key]) {
      var named = opts.label ? ' role="img" aria-label="' + escape(opts.label) + '"' : ' aria-hidden="true"';
      return '<span class="game-icon is-ready is-vector" data-icon="' + key + '"' + named + '>' + vectors[key] + '</span>';
    }
    var status = state[key] === 'ready' ? ' is-ready' : (state[key] === 'missing' ? ' is-missing' : '');
    var accessible = opts.label ? ' role="img" aria-label="' + escape(opts.label) + '"' : ' aria-hidden="true"';
    return '<span class="game-icon' + status + '" data-icon="' + key + '"' + accessible + '>' +
      '<img src="' + url(key) + '" alt="" width="256" height="256" draggable="false" decoding="async">' +
      '<span class="icon-fallback" aria-hidden="true">' + fallback[key] + '</span></span>';
  }
  function imageEvent(event) {
    var image = event.target, wrapper = image && image.parentElement;
    if (!wrapper || !wrapper.classList.contains('game-icon')) return;
    var ready = event.type === 'load' && image.naturalWidth > 0;
    state[wrapper.getAttribute('data-icon')] = ready ? 'ready' : 'missing';
    wrapper.classList.toggle('is-ready', ready);
    wrapper.classList.toggle('is-missing', !ready);
  }
  document.addEventListener('load', function (event) { SE.Tasks.run(function () { imageEvent(event); }); }, true);
  document.addEventListener('error', function (event) { SE.Tasks.run(function () { imageEvent(event); }); }, true);
  function refreshLabels(root) {
    root = root || document;
    var buttons = root.querySelectorAll('[data-i18n-title], [data-icon-label]');
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i], titleKey = button.getAttribute('data-i18n-title');
      var local = labels[button.getAttribute('data-icon-label')];
      var label = titleKey && SE.t ? SE.t(titleKey) : local && (local[SE.I18N.lang] || local.en);
      if (label) { button.setAttribute('aria-label', label); button.setAttribute('title', label); }
    }
    var closeButtons = root.querySelectorAll('.close-btn');
    for (var c = 0; c < closeButtons.length; c++) closeButtons[c].setAttribute('aria-label', SE.t('btn.close'));
  }
  function mount(root) {
    root = root || document;
    var slots = root.querySelectorAll('[data-ui-icon]');
    for (var i = 0; i < slots.length; i++) {
      var key = slots[i].getAttribute('data-ui-icon');
      if (!slots[i].querySelector('.game-icon')) slots[i].innerHTML = html(key);
    }
    refreshLabels(root);
  }
  function load(key) {
    if (pending[key]) return pending[key];
    pending[key] = new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        SE.Tasks.run(function () {
          state[key] = 'ready';
          if (image.decode) image.decode().then(resolve, resolve); else resolve();
        });
      };
      image.onerror = function () { SE.Tasks.run(function () { state[key] = 'missing'; resolve(); }); };
      image.src = url(key);
    });
    return pending[key];
  }
  SE.Icons = {
    keys: function () { return Object.keys(fallback); },
    url: url, html: html, mount: mount, refreshLabels: refreshLabels,
    /* The drawing of a vector icon without its outer <svg> (for nesting in other SVG), or null. */
    inner: function (key) {
      var v = vectors[key];
      return v ? v.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') : null;
    },
    preload: function (timeout) {
      return new Promise(function (resolve) {
        var timer = SE.Tasks.timeout(resolve, timeout || 2500);
        Promise.all(Object.keys(fallback).map(load)).then(function () { SE.Tasks.clear(timer); resolve(); });
      });
    }
  };
  mount(document);
})(window);
