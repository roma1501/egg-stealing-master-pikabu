/* =========================================================
   Питомцы, редкости, биомы и яйца
   ========================================================= */
(function (global) {
  'use strict';

  var SE = global.SE = global.SE || {};

  /* ---------- Редкости ---------- */
  var RARITIES = [
    { id: 'common',    key: 'rar.common',    color: '#a8b0b8', color2: '#7e878f', mult: 1,    hatch: 25,  chance: 46 },
    { id: 'uncommon',  key: 'rar.uncommon',  color: '#54e06a', color2: '#26a03c', mult: 2.6,  hatch: 55,  chance: 27 },
    { id: 'rare',      key: 'rar.rare',      color: '#3a8ef6', color2: '#1c58b8', mult: 7,    hatch: 110, chance: 15 },
    { id: 'epic',      key: 'rar.epic',      color: '#d94ff0', color2: '#8b1fb0', mult: 20,   hatch: 220, chance: 8 },
    { id: 'legendary', key: 'rar.legendary', color: '#ffc224', color2: '#c07a00', mult: 60,   hatch: 420, chance: 3.4 },
    { id: 'mythic',    key: 'rar.mythic',    color: '#ff5bb0', color2: '#c0157a', mult: 200,  hatch: 780, chance: 0.6 }
  ];

  /* ---------- Биомы (локации) ---------- */
  var BIOMES = [
    { id: 'forest',  key: 'biome.forest',  price: 0,         base: 1,      color: '#3fb63f', ground: '#4cd137', accent: '#2f7d32',
      eggColor: '#f5efdc', eggStripe: '#c9b98f', guard: 'chicken', guardSpeed: 15,  guardCount: 3 },
    { id: 'desert',  key: 'biome.desert',  price: 2500,      base: 7,      color: '#e0bb6a', ground: '#e8cd83', accent: '#c49a45',
      eggColor: '#f0d9a8', eggStripe: '#b98b3f', guard: 'ostrich', guardSpeed: 18.5, guardCount: 4 },
    { id: 'candy',   key: 'biome.candy',   price: 40000,     base: 55,     color: '#ff7fd0', ground: '#ffa8dd', accent: '#d43fa0',
      eggColor: '#ffd6f0', eggStripe: '#ff4fb0', guard: 'gummy',   guardSpeed: 22,   guardCount: 4 },
    { id: 'ice',     key: 'biome.ice',     price: 600000,    base: 420,    color: '#8fd8ff', ground: '#bfeaff', accent: '#3fa8e0',
      eggColor: '#dff4ff', eggStripe: '#5cc0f0', guard: 'yetiguard', guardSpeed: 26, guardCount: 5 },
    { id: 'volcano', key: 'biome.volcano', price: 9000000,   base: 3600,   color: '#ff6a34', ground: '#7a3427', accent: '#ff3b1f',
      eggColor: '#ffb98f', eggStripe: '#c2331a', guard: 'magma',   guardSpeed: 30.5,   guardCount: 5 },
    { id: 'sky',     key: 'biome.sky',     price: 150000000, base: 32000,  color: '#b28cff', ground: '#d9c8ff', accent: '#7a4fe0',
      eggColor: '#e8dcff', eggStripe: '#8f6bff', guard: 'griffin', guardSpeed: 35,   guardCount: 6 }
  ];

  /* ---------- Питомцы ----------
     [id, ru, en, rarityIdx, shape, body, accent, flags]
     shape: quad | bird | blob | dragon | bug
     flags: w=крылья h=рога c=корона s=шипы e=длинные уши g=свечение
  */
  var LIST = {
    forest: [
      ['f1',  'Курочка',            'Chicken',          0, 'bird', '#ffffff', '#ff8a3d', ''],
      ['f2',  'Кролик',             'Bunny',            0, 'quad', '#f0e6d2', '#ffb3c1', 'e'],
      ['f3',  'Ворона',             'Crow',             0, 'bird', '#3a3a44', '#6a6a78', ''],
      ['f4',  'Барсук',             'Badger',           1, 'quad', '#6b6b6b', '#ffffff', ''],
      ['f5',  'Лисёнок',            'Fox Cub',          1, 'quad', '#ff8127', '#ffffff', ''],
      ['f6',  'Ёжик',               'Hedgehog',         1, 'quad', '#8a6a4a', '#d8c39a', 's'],
      ['f7',  'Волк',               'Wolf',             2, 'quad', '#7f8c9b', '#3c4652', ''],
      ['f8',  'Енот',               'Raccoon',          2, 'quad', '#9aa4b0', '#2f3640', ''],
      ['f9',  'Бурый Медведь',      'Brown Bear',       3, 'quad', '#8b5a2b', '#c99a5b', ''],
      ['f10', 'Сова-Сплюшка',       'Sleepy Owl',       3, 'bird', '#c8a06a', '#f5e3c0', 'w'],
      ['f11', 'Олень-Вожак',        'Stag Leader',      4, 'quad', '#a9713f', '#f0d9a8', 'h'],
      ['f12', 'Лесной Дух',         'Forest Spirit',    4, 'blob', '#7ce87c', '#ffffff', 'g'],
      ['f13', 'Древний Единорог',   'Ancient Unicorn',  5, 'quad', '#ffffff', '#ffd24a', 'hcg']
    ],
    desert: [
      ['d1',  'Скорпиончик',        'Little Scorpion',  0, 'bug',  '#c98b3a', '#7a4a12', 's'],
      ['d2',  'Тушканчик',          'Jerboa',           0, 'quad', '#e8cd83', '#fff3d0', 'e'],
      ['d3',  'Ящерка',             'Lizard',           0, 'quad', '#9fbf5a', '#d8e89a', ''],
      ['d4',  'Верблюжонок',        'Camel Calf',       1, 'quad', '#deb887', '#a97c50', ''],
      ['d5',  'Фенек',              'Fennec',           1, 'quad', '#f2d6a2', '#ffffff', 'e'],
      ['d6',  'Гриф',               'Vulture',          1, 'bird', '#5a5148', '#c9a227', 'w'],
      ['d7',  'Кобра',              'Cobra',            2, 'blob', '#3f8f4f', '#f0e04a', ''],
      ['d8',  'Варан',              'Monitor Lizard',   2, 'quad', '#7a8b3a', '#cfd88a', 's'],
      ['d9',  'Скарабей',           'Scarab',           3, 'bug',  '#2fb0a0', '#ffd24a', 'wg'],
      ['d10', 'Мумия-Кот',          'Mummy Cat',        3, 'quad', '#efe6cf', '#c9b78a', ''],
      ['d11', 'Песчаный Голем',     'Sand Golem',       4, 'blob', '#e0b25a', '#8a5c1f', 's'],
      ['d12', 'Золотой Анубис',     'Golden Anubis',    4, 'quad', '#ffd24a', '#1a1a2e', 'ecg'],
      ['d13', 'Царь Пустыни',       'Desert King',      5, 'quad', '#ffe27a', '#b8860b', 'cg']
    ],
    candy: [
      ['c1',  'Мармеладка',         'Gummy',            0, 'blob', '#ff5fa2', '#ffd0e6', ''],
      ['c2',  'Леденец',            'Lollipop Pup',     0, 'quad', '#ff9ad5', '#ffffff', ''],
      ['c3',  'Зефирка',            'Marshmallow',      0, 'blob', '#fff0f6', '#ffc2dd', ''],
      ['c4',  'Карамелька',         'Caramel Cat',      1, 'quad', '#ffb347', '#ffe0a3', ''],
      ['c5',  'Пончик',             'Donut Dog',        1, 'quad', '#f7c5a0', '#ff5fa2', ''],
      ['c6',  'Кексик',             'Cupcake Bunny',    1, 'quad', '#ffd6e8', '#a0e8ff', 'e'],
      ['c7',  'Шоколадный Мишка',   'Choco Bear',       2, 'quad', '#7b4a2d', '#e8c9a0', ''],
      ['c8',  'Жвачный Дракончик',  'Bubblegum Dragon', 2, 'dragon', '#ff8fd0', '#ffe3f3', 'w'],
      ['c9',  'Сахарный Единорог',  'Sugar Unicorn',    3, 'quad', '#fff5fb', '#ff7fd0', 'hg'],
      ['c10', 'Тортик-Голем',       'Cake Golem',       3, 'blob', '#ffe0b3', '#ff5fa2', 's'],
      ['c11', 'Королева Карамели',  'Caramel Queen',    4, 'quad', '#ffb347', '#ff2f92', 'cg'],
      ['c12', 'Радужный Лизун',     'Rainbow Slime',    4, 'blob', '#7cf0ff', '#ff7fd0', 'g'],
      ['c13', 'Повелитель Сладостей','Candy Overlord',  5, 'dragon', '#ff2f92', '#ffe27a', 'wcg']
    ],
    ice: [
      ['i1',  'Пингвинёнок',        'Penguin Chick',    0, 'bird', '#2b3a4a', '#ffffff', ''],
      ['i2',  'Снежный Заяц',       'Snow Hare',        0, 'quad', '#ffffff', '#cfe8ff', 'e'],
      ['i3',  'Ледышка',            'Icicle',           0, 'blob', '#bfeaff', '#ffffff', 's'],
      ['i4',  'Морж',               'Walrus',           1, 'quad', '#9a7b6a', '#f0e6d2', ''],
      ['i5',  'Полярный Лис',       'Arctic Fox',       1, 'quad', '#eaf6ff', '#a8d8f0', ''],
      ['i6',  'Нерпа',              'Seal',             1, 'blob', '#c8d8e8', '#8fb0c8', ''],
      ['i7',  'Белый Медведь',      'Polar Bear',       2, 'quad', '#ffffff', '#d0e8ff', ''],
      ['i8',  'Снежный Волк',       'Snow Wolf',        2, 'quad', '#dff0ff', '#5c9fd0', ''],
      ['i9',  'Йети',               'Yeti',             3, 'blob', '#eaf8ff', '#7fc8f0', ''],
      ['i10', 'Ледяной Мамонт',     'Ice Mammoth',      3, 'quad', '#9fd8f5', '#ffffff', 'h'],
      ['i11', 'Морозный Дракон',    'Frost Dragon',     4, 'dragon', '#7fd8ff', '#ffffff', 'wsg'],
      ['i12', 'Снежная Королева',   'Snow Queen',       4, 'quad', '#ffffff', '#7fd8ff', 'cg'],
      ['i13', 'Абсолютный Ноль',    'Absolute Zero',    5, 'dragon', '#5fe0ff', '#e8faff', 'wcg']
    ],
    volcano: [
      ['v1',  'Уголёк',             'Ember',            0, 'blob', '#4a3a3a', '#ff6a34', 'g'],
      ['v2',  'Лавовый Краб',       'Lava Crab',        0, 'bug',  '#c2331a', '#ff9a5a', ''],
      ['v3',  'Огненный Жук',       'Fire Beetle',      0, 'bug',  '#8a2b1a', '#ffb03a', ''],
      ['v4',  'Магмовая Ящерица',   'Magma Lizard',     1, 'quad', '#e04a20', '#ffcf4a', 's'],
      ['v5',  'Пепельный Волк',     'Ash Wolf',         1, 'quad', '#5a5252', '#ff7a3a', ''],
      ['v6',  'Искра',              'Spark',            1, 'blob', '#ffcf4a', '#ff6a34', 'g'],
      ['v7',  'Огненный Голем',     'Fire Golem',       2, 'blob', '#7a3427', '#ff5a1f', 'sg'],
      ['v8',  'Саламандра',         'Salamander',       2, 'quad', '#ff5a1f', '#ffe27a', 's'],
      ['v9',  'Пламенный Феникс',   'Flame Phoenix',    3, 'bird', '#ff8a1f', '#ffe27a', 'wg'],
      ['v10', 'Демон Магмы',        'Magma Demon',      3, 'quad', '#c2181a', '#ffb03a', 'hs'],
      ['v11', 'Владыка Вулкана',    'Volcano Lord',     4, 'dragon', '#8a1a10', '#ff8a1f', 'whsg'],
      ['v12', 'Инфернальный Дракон','Infernal Dragon',  4, 'dragon', '#ff3b1f', '#2b0f0a', 'wsg'],
      ['v13', 'Сердце Вулкана',     'Heart of Volcano', 5, 'blob', '#ff2f1a', '#ffd24a', 'cg']
    ],
    sky: [
      ['s1',  'Облачко',            'Cloudy',           0, 'blob', '#ffffff', '#dfe9ff', ''],
      ['s2',  'Небесный Птенец',    'Sky Chick',        0, 'bird', '#cfe0ff', '#ffd24a', 'w'],
      ['s3',  'Воздушный Змей',     'Kite',             0, 'blob', '#7fc8ff', '#ff7f7f', ''],
      ['s4',  'Грифончик',          'Griffin Cub',      1, 'bird', '#e8d8a8', '#c9a227', 'w'],
      ['s5',  'Пегасик',            'Little Pegasus',   1, 'quad', '#ffffff', '#bfd8ff', 'w'],
      ['s6',  'Ветерок',            'Breeze',           1, 'blob', '#cff0ff', '#ffffff', 'g'],
      ['s7',  'Громовая Птица',     'Thunderbird',      2, 'bird', '#5a6ad0', '#ffe27a', 'wg'],
      ['s8',  'Звёздный Кот',       'Star Cat',         2, 'quad', '#3a2f6a', '#ffe27a', 'g'],
      ['s9',  'Небесный Дракон',    'Sky Dragon',       3, 'dragon', '#8fb8ff', '#ffffff', 'wg'],
      ['s10', 'Ангел-Хранитель',    'Guardian Angel',   3, 'quad', '#fff8e0', '#ffd24a', 'wcg'],
      ['s11', 'Повелитель Молний',  'Lightning Lord',   4, 'dragon', '#5f4fd0', '#ffe84a', 'wsg'],
      ['s12', 'Космический Кит',    'Cosmic Whale',     4, 'blob', '#2f2f6a', '#8fe0ff', 'wg'],
      ['s13', 'Хранитель Небес',    'Keeper of Skies',  5, 'dragon', '#e8e0ff', '#ffd24a', 'wcsg']
    ]
  };

  /* Turkish pet names, keyed by pet id (the rows above only carry ru / en). */
  var TR_NAMES = {
    f1: 'Tavuk', f2: 'Tavşan', f3: 'Karga', f4: 'Porsuk', f5: 'Tilki Yavrusu', f6: 'Kirpi',
    f7: 'Kurt', f8: 'Rakun', f9: 'Boz Ayı', f10: 'Uykucu Baykuş', f11: 'Geyik Lideri',
    f12: 'Orman Ruhu', f13: 'Kadim Unicorn',
    d1: 'Minik Akrep', d2: 'Çöl Faresi', d3: 'Kertenkele', d4: 'Deve Yavrusu', d5: 'Fenek',
    d6: 'Akbaba', d7: 'Kobra', d8: 'Varan', d9: 'Skarabe', d10: 'Mumya Kedi',
    d11: 'Kum Golemi', d12: 'Altın Anubis', d13: 'Çöl Kralı',
    c1: 'Jelibon', c2: 'Lolipop Köpeği', c3: 'Marshmallow', c4: 'Karamel Kedi', c5: 'Donut Köpek',
    c6: 'Kek Tavşanı', c7: 'Çikolatalı Ayı', c8: 'Sakız Ejderha', c9: 'Şeker Unicorn',
    c10: 'Pasta Golemi', c11: 'Karamel Kraliçesi', c12: 'Gökkuşağı Slime', c13: 'Şeker Hükümdarı',
    i1: 'Penguen Yavrusu', i2: 'Kar Tavşanı', i3: 'Buz Sarkıtı', i4: 'Mors', i5: 'Kutup Tilkisi',
    i6: 'Fok', i7: 'Kutup Ayısı', i8: 'Kar Kurdu', i9: 'Yeti', i10: 'Buz Mamutu',
    i11: 'Ayaz Ejderhası', i12: 'Kar Kraliçesi', i13: 'Mutlak Sıfır',
    v1: 'Köz', v2: 'Lav Yengeci', v3: 'Alev Böceği', v4: 'Magma Kertenkelesi', v5: 'Kül Kurdu',
    v6: 'Kıvılcım', v7: 'Ateş Golemi', v8: 'Semender', v9: 'Alev Anka Kuşu', v10: 'Magma İblisi',
    v11: 'Yanardağ Lordu', v12: 'Cehennem Ejderhası', v13: 'Yanardağın Kalbi',
    s1: 'Bulutçuk', s2: 'Gök Civcivi', s3: 'Uçurtma', s4: 'Grifon Yavrusu', s5: 'Minik Pegasus',
    s6: 'Meltem', s7: 'Şimşek Kuşu', s8: 'Yıldız Kedisi', s9: 'Gök Ejderhası', s10: 'Koruyucu Melek',
    s11: 'Yıldırım Lordu', s12: 'Kozmik Balina', s13: 'Göklerin Koruyucusu'
  };

  var ALL = [];
  var BY_ID = {};

  (function build() {
    for (var bi = 0; bi < BIOMES.length; bi++) {
      var b = BIOMES[bi];
      var arr = LIST[b.id];
      for (var i = 0; i < arr.length; i++) {
        var row = arr[i];
        var r = RARITIES[row[3]];
        var idxInRarity = i;
        var pet = {
          id: row[0],
          ru: row[1],
          en: row[2],
          tr: TR_NAMES[row[0]] || row[2],
          rarity: row[3],
          shape: row[4],
          body: row[5],
          accent: row[6],
          flags: row[7] || '',
          biome: b.id,
          biomeIdx: bi,
          /* доход в секунду */
          income: Math.max(1, Math.round(b.base * r.mult * (1 + idxInRarity * 0.06) * 10) / 10),
          order: ALL.length
        };
        pet.value = Math.round(pet.income * 75);
        ALL.push(pet);
        BY_ID[pet.id] = pet;
      }
    }
  })();

  var Pets = {
    RARITIES: RARITIES,
    BIOMES: BIOMES,
    ALL: ALL,

    get: function (id) { return BY_ID[id]; },

    name: function (pet) {
      if (!pet) return '';
      var lang = (SE.I18N && SE.I18N.lang) || 'ru';
      if (lang === 'ru') return pet.ru;
      if (lang === 'tr') return pet.tr || pet.en;
      return pet.en;
    },

    rarity: function (pet) { return RARITIES[pet.rarity]; },

    byBiome: function (biomeId) {
      return ALL.filter(function (p) { return p.biome === biomeId; });
    },

    biome: function (id) {
      for (var i = 0; i < BIOMES.length; i++) if (BIOMES[i].id === id) return BIOMES[i];
      return BIOMES[0];
    },

    biomeIndex: function (id) {
      for (var i = 0; i < BIOMES.length; i++) if (BIOMES[i].id === id) return i;
      return 0;
    },

    /* Розыгрыш редкости с учётом удачи */
    rollRarity: function (luck) {
      luck = luck || 1;
      var weights = [];
      var total = 0;
      for (var i = 0; i < RARITIES.length; i++) {
        var w = RARITIES[i].chance;
        if (i >= 2) w *= luck;               /* удача повышает шанс редких */
        weights.push(w);
        total += w;
      }
      var r = Math.random() * total;
      for (var j = 0; j < weights.length; j++) {
        r -= weights[j];
        if (r <= 0) return j;
      }
      return 0;
    },

    /* Случайный питомец нужного биома и редкости */
    rollPet: function (biomeId, rarityIdx) {
      var pool = this.byBiome(biomeId).filter(function (p) { return p.rarity === rarityIdx; });
      if (!pool.length) {
        pool = this.byBiome(biomeId).filter(function (p) { return p.rarity <= rarityIdx; });
      }
      if (!pool.length) pool = this.byBiome(biomeId);
      return pool[Math.floor(Math.random() * pool.length)];
    },

    /* Создание нового яйца */
    makeEgg: function (biomeId, luck) {
      var rarity = this.rollRarity(luck || 1);
      return {
        biome: biomeId,
        rarity: rarity,
        uid: 'e' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36)
      };
    },

    hatchTime: function (egg) {
      var b = this.biome(egg.biome);
      var r = RARITIES[egg.rarity];
      return Math.round(r.hatch * (1 + this.biomeIndex(egg.biome) * 0.35));
    },

    total: function () { return ALL.length; }
  };

  SE.Pets = Pets;
})(window);
