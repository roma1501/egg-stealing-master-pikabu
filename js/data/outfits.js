/* Outfit catalogue (owned by the SYSTEMS agent).
   Each outfit is a recolour of the player character plus a hair style, an optional face accessory
   hint and an optional glow. tints = [jacket, trousers, hair, skin, t-shirt]
   (the character slots of SE.Models.makeCharacter().setLook).
   rarity 0 common .. 4 legendary. `face` is a hint: an exact id from SE.CosmeticModels.faces or a
   word that appears in a face id ("sunglasses"); it is ignored when no such face exists yet.
   30 shop outfits, 3 Daily Gift exclusives (never sold, never on the wheel) and the free starter. */
(function (global) {
  'use strict';
  var SE = global.SE = global.SE || {};

  /* Turkish outfit names by id (the o() rows below only carry en / ru). */
  var TR_NAMES = {
    starter: 'Klasik Hırsız',
    farmer: 'Çiftçi', chef: 'Aşçı', skater: 'Kaykaycı', mechanic: 'Tamirci', lumberjack: 'Oduncu',
    zookeeper: 'Hayvan Bakıcısı', cowboy: 'Kovboy',
    ninja: 'Ninja', pirate: 'Korsan', detective: 'Dedektif', firefighter: 'İtfaiyeci', viking: 'Viking',
    scientist: 'Bilim İnsanı', candycane: 'Baston Şeker',
    knight: 'Şövalye', punk: 'Punk', astronaut: 'Astronot', wizard: 'Büyücü', samurai: 'Samuray',
    explorer: 'Buz Kaşifi', pharaoh: 'Firavun',
    robot: 'Robot', alien: 'Uzaylı', disco: 'Disko Yıldızı', lava: 'Lav Savaşçısı', angel: 'Bulut Meleği',
    goldmaster: 'Altın Yumurta Ustası', cosmic: 'Kozmik Korucu', frostking: 'Ayaz Kralı', sunlord: 'Güneş Lordu',
    x_emperor: 'Yumurta İmparatoru', x_midnight: 'Gece Yarısı Hırsızı', x_rainbow: 'Gökkuşağı Kuluçkacı'
  };

  function o(id, en, ru, rarity, tints, hairStyle, face, glow, extra) {
    var item = {
      id: id, name: { en: en, ru: ru, tr: TR_NAMES[id] || en }, rarity: rarity, tints: tints, hairStyle: hairStyle,
      face: face || null, glow: glow || 0
    };
    if (extra) for (var k in extra) item[k] = extra[k];
    return item;
  }

  SE.Outfits = [
    /* The look every player starts with. Not part of the shop grid prices. Crimson jacket, white
       T-shirt, slate trousers and ginger spiky hair: an own look, unlike any well-known game avatar
       (the bots wear orange, purple, teal and blue, the shopkeepers green and navy). */
    o('starter', 'Classic Thief', 'Классический вор', 0,
      ['#c8323c', '#3b4252', '#e08a2c', '#ffe2c6', '#f4efe2'], 'spiky', null, 0, { starter: true }),

    /* ---- common ---- */
    o('farmer', 'Farmer', 'Фермер', 0, ['#3f7bd9', '#2f5fb8', '#e8c04a', '#ffdcb8', '#d9382c'], 'swept'),
    o('chef', 'Chef', 'Шеф-повар', 0, ['#f5f5f2', '#8d939c', '#5a3b24', '#ffdcb8', '#ffffff'], 'swept', 'moustache'),
    o('skater', 'Skater', 'Скейтер', 0, ['#2fb85a', '#2b3342', '#ff7ab8', '#f4c9a3', '#ffffff'], 'spiky'),
    o('mechanic', 'Mechanic', 'Механик', 0, ['#2a60b8', '#244f96', '#2b2118', '#e8b88f', '#ffb020'], 'swept', 'goggles'),
    o('lumberjack', 'Lumberjack', 'Лесоруб', 0, ['#c1392b', '#4a3a2a', '#6b3b1e', '#f1c7a0', '#e8dcc0'], 'swept', 'beard'),
    o('zookeeper', 'Zookeeper', 'Смотритель зоопарка', 0, ['#8a9a3a', '#6b5a3a', '#4a3020', '#e0a878', '#f5f0d0'], 'bob'),
    o('cowboy', 'Cowboy', 'Ковбой', 0, ['#8b5a2b', '#3e6aa8', '#2a1a10', '#e8b890', '#e8e0cf'], 'swept', 'bandana'),

    /* ---- uncommon ---- */
    o('ninja', 'Ninja', 'Ниндзя', 1, ['#1b1b24', '#15151c', '#0f0f14', '#f2c6a0', '#c0182d'], 'spiky', 'ninja'),
    o('pirate', 'Pirate', 'Пират', 1, ['#b3261e', '#1c1c24', '#201510', '#e8b890', '#f3ead2'], 'long', 'eyepatch'),
    o('detective', 'Detective', 'Сыщик', 1, ['#b39a74', '#4a3f33', '#2d2218', '#f0c8a2', '#f5f5f0'], 'swept', 'glasses'),
    o('firefighter', 'Firefighter', 'Пожарный', 1, ['#e0361c', '#26272e', '#2a1b12', '#eec3a0', '#ffd400'], 'swept'),
    o('viking', 'Viking', 'Викинг', 1, ['#7a5230', '#463829', '#d46a2a', '#f2c8a4', '#c9c3b8'], 'long', 'beard'),
    o('scientist', 'Scientist', 'Учёный', 1, ['#f4f7fa', '#2f4a60', '#c9d0d8', '#f0cfae', '#37b8c4'], 'spiky', 'goggles'),
    o('candycane', 'Candy Cane', 'Карамельная трость', 1, ['#ffffff', '#ee3a52', '#ff9ec7', '#ffe0cc', '#ee3a52'], 'bob'),

    /* ---- rare ---- */
    o('knight', 'Knight', 'Рыцарь', 2, ['#a9b4c0', '#6d7885', '#3b2a20', '#f0cfae', '#d9b43a'], 'swept', 'visor'),
    o('punk', 'Punk', 'Панк', 2, ['#161619', '#3a3a45', '#ff3fa4', '#f0c9a8', '#8b2fd0'], 'spiky', 'sunglasses'),
    o('astronaut', 'Astronaut', 'Астронавт', 2, ['#e8ecf0', '#d0d6dd', '#3a2a20', '#f1d0b0', '#ff7a1a'], 'swept', 'visor'),
    o('wizard', 'Wizard', 'Волшебник', 2, ['#5b2fb0', '#3a1c78', '#d9d9e8', '#f2d4b6', '#ffd24a'], 'long', 'beard'),
    o('samurai', 'Samurai', 'Самурай', 2, ['#c5301f', '#232832', '#0d0d12', '#f0cdaa', '#ece6d6'], 'long'),
    o('explorer', 'Ice Explorer', 'Полярник', 2, ['#38b9c9', '#2a4f7a', '#e8f2f8', '#f6d9c4', '#ffffff'], 'bob', 'goggles'),
    o('pharaoh', 'Pharaoh', 'Фараон', 2, ['#e6bf3f', '#2b66b5', '#101018', '#d9a070', '#f5f0dc'], 'bob', 'mask'),

    /* ---- epic ---- */
    o('robot', 'Robot', 'Робот', 3, ['#aab6c4', '#7c8a9a', '#5ad7f2', '#b8c4d0', '#2e6fd8'], 'spiky', 'visor', 0.35),
    o('alien', 'Alien', 'Инопланетянин', 3, ['#c0c8d8', '#4d5878', '#2a1850', '#7bd96b', '#ff4fb0'], 'swept', null, 0.2),
    o('disco', 'Disco Star', 'Звезда диско', 3, ['#e931c4', '#f5d142', '#2a1830', '#f0c8a0', '#31e0e8'], 'spiky', 'sunglasses', 0.5),
    o('lava', 'Lava Warrior', 'Лавовый воин', 3, ['#1f1a1a', '#34211c', '#ff5a1a', '#e0a070', '#ff8f1f'], 'spiky', null, 0.55),
    o('angel', 'Cloud Angel', 'Облачный ангел', 3, ['#ffffff', '#f4efe2', '#ffe27a', '#ffe2cc', '#bfe8ff'], 'long', null, 0.45),

    /* ---- legendary ---- */
    o('goldmaster', 'Golden Egg Master', 'Мастер золотого яйца', 4, ['#ffcf2b', '#e0a21a', '#fff1a8', '#ffe0b0', '#fff6d8'], 'swept', null, 0.8),
    o('cosmic', 'Cosmic Ranger', 'Космический рейнджер', 4, ['#2b2f8f', '#1a1c5e', '#7af0ff', '#e8d0f0', '#c64bff'], 'spiky', 'visor', 0.6),
    o('frostking', 'Frost King', 'Ледяной король', 4, ['#bfe8ff', '#6aa6e0', '#ffffff', '#f4e6e0', '#3a78d0'], 'long', null, 0.5),
    o('sunlord', 'Sun Lord', 'Повелитель солнца', 4, ['#ff9a1f', '#c4400f', '#ffdf5a', '#f0b890', '#fff0b0'], 'swept', null, 0.7),

    /* ---- Daily Gift exclusives: day 7 of each week, in this order ---- */
    o('x_emperor', 'Egg Emperor', 'Император яиц', 4, ['#fff8e0', '#ffc82a', '#ffe9a0', '#ffe0c0', '#d83a2a'], 'swept', null, 0.9, { exclusive: true }),
    o('x_midnight', 'Midnight Thief', 'Полночный вор', 4, ['#1a1840', '#100e28', '#7a5cff', '#d8c8f0', '#33e0ff'], 'long', null, 0.75, { exclusive: true }),
    o('x_rainbow', 'Rainbow Hatcher', 'Радужный птицевод', 4, ['#ff4f8f', '#3fd0ff', '#ffe03a', '#ffd9b8', '#7bff5a'], 'spiky', null, 0.85, { exclusive: true })
  ];

  /* ---- "Brainrot skins": full-body mythic characters that replace the whole avatar (same slot
     as outfits, so equipping one unequips the other). They sit in their own section at the top of the
     Outfits tab with fixed unlock rules: n rewarded views (placement shop-unlock) or gems.
     The GLB is lazy-loaded from assets/models/skins/<id>.glb by SE.Models (look.skin). ---- */
  function skin(id, en, ru, unlock) {
    return {
      id: id, name: { en: en, ru: ru, tr: en }, rarity: 5, skin: true, unlock: unlock,
      tints: ['#c8323c', '#3b4252', '#e08a2c', '#ffe2c6', '#f4efe2'], hairStyle: 'spiky', face: null, glow: 0
    };
  }
  SE.Outfits.push(
    skin('skin_tungtung', 'Tung Tung Sahur', 'Тунг Тунг Сахур', { ads: 2 }),
    skin('skin_cappuccina', 'Ballerina Cappuccina', 'Балерина Капучина', { ads: 3 }),
    skin('skin_lirili', 'Lirili Larila', 'Лирили Ларила', { ads: 4 }),
    skin('skin_tralalero', 'Tralalero Tralala', 'Тралалеро Тралала', { ads: 6 }),
    skin('skin_67', '67', '67', { ads: 8 }),
    skin('skin_bombardiro', 'Bombardiro Crocodilo', 'Бомбардиро Крокодило', { gems: 600 })
  );
})(window);
