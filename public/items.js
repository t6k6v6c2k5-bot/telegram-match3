/* =====================================================================
   FRUIT BLITZ — каталог коллекционных предметов (общий для сервера и игры)
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FBItems = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Редкости в стиле CS. drop — шанс выпадения за один пройденный уровень.
  const RARITIES = [
    { id: 0, name: 'Ширпотреб', color: '#b0c3d9', drop: 0.08 },
    { id: 1, name: 'Промышленное', color: '#5e98d9', drop: 0.03 },
    { id: 2, name: 'Армейское', color: '#4b69ff', drop: 0.01 },
    { id: 3, name: 'Запрещённое', color: '#8847ff', drop: 0.003 },
    { id: 4, name: 'Засекреченное', color: '#d32ce6', drop: 0.0008 },
    { id: 5, name: 'Тайное', color: '#eb4b4b', drop: 0.0002 },
    { id: 6, name: '★ Эксклюзив', color: '#e4ae39', drop: 0 }
  ];

  const TYPES = {
    skin: { name: 'Скин фишек', icon: '🍎' },
    board: { name: 'Фон поля', icon: '🟪' },
    fx: { name: 'Эффект взрыва', icon: '💥' },
    frame: { name: 'Рамка аватара', icon: '🖼️' },
    badge: { name: 'Значок', icon: '🏅' }
  };

  // Состояние предмета (аналог float в CS): чем меньше число, тем «свежее» и ценнее
  const QUALITIES = [
    { max: 0.07, name: 'Прямо с грядки', short: 'ПГ' },
    { max: 0.15, name: 'Свежий', short: 'СВ' },
    { max: 0.38, name: 'Спелый', short: 'СП' },
    { max: 0.45, name: 'Подвявший', short: 'ПВ' },
    { max: 1.01, name: 'Сушёный', short: 'СШ' }
  ];
  const SHINY_CHANCE = 0.1; // «✨ Сияющий» — считает собранные фрукты, как StatTrak

  const I = (id, type, r, name, data, extra) => Object.assign({ id, type, r, name, data }, extra || {});
  const ITEMS = [
    // ---------- Скины фишек (6 эмодзи = 6 цветов) ----------
    I('sk_veggie', 'skin', 0, 'Огород', ['🥕', '🌽', '🍆', '🥦', '🥔', '🧅']),
    I('sk_sweets', 'skin', 0, 'Конфетки', ['🍬', '🍭', '🍫', '🍩', '🍪', '🧁']),
    I('sk_sport2', 'skin', 0, 'Дворовый спорт', ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐']),
    I('sk_sea', 'skin', 1, 'Морские жители', ['🐠', '🐙', '🦀', '🐬', '🐡', '🦑']),
    I('sk_weather', 'skin', 1, 'Погода', ['☀️', '⛈️', '❄️', '🌈', '🌪️', '🌙']),
    I('sk_gems', 'skin', 2, 'Сокровища', ['💎', '💍', '👑', '🔮', '🪙', '📿']),
    I('sk_food', 'skin', 2, 'Фастфуд', ['🍔', '🍕', '🌭', '🍟', '🌮', '🥪']),
    I('sk_space', 'skin', 3, 'Галактика', ['🪐', '🌟', '☄️', '🌍', '🌙', '👽']),
    I('sk_monsters', 'skin', 3, 'Монстры', ['👾', '👻', '🤖', '👹', '💀', '🎃']),
    I('sk_dragon', 'skin', 4, 'Драконье логово', ['🐉', '🔥', '🌋', '⚔️', '🛡️', '🏰']),
    I('sk_royal', 'skin', 5, 'Королевский двор', ['👑', '💎', '🏆', '🌟', '💰', '🦄']),
    I('sk_star', 'skin', 6, 'Звёздный принц', ['🌠', '⭐', '✨', '💫', '🌟', '☄️'], { stars: 400, limit: 500 }),

    // ---------- Фоны поля (два цвета градиента) ----------
    I('bd_mint', 'board', 0, 'Мята', ['#1f6f5c', '#0e3b33']),
    I('bd_night', 'board', 0, 'Тихая ночь', ['#1b2a4a', '#0b1020']),
    I('bd_cocoa', 'board', 0, 'Какао', ['#5a3a2a', '#2a1a12']),
    I('bd_ocean', 'board', 1, 'Океан', ['#0a6ea8', '#063456']),
    I('bd_sunset', 'board', 1, 'Закат', ['#c2410c', '#581c87']),
    I('bd_neon', 'board', 2, 'Неоновый город', ['#db2777', '#1e1b4b']),
    I('bd_candy', 'board', 2, 'Сладкая вата', ['#f472b6', '#7c3aed']),
    I('bd_lava', 'board', 3, 'Лава', ['#dc2626', '#431407']),
    I('bd_aurora', 'board', 3, 'Северное сияние', ['#10b981', '#312e81']),
    I('bd_galaxy', 'board', 4, 'Туманность', ['#7e22ce', '#020617']),
    I('bd_gold', 'board', 5, 'Золотой зал', ['#ca8a04', '#422006']),
    I('bd_diamond', 'board', 6, 'Бриллиантовый', ['#67e8f9', '#1e3a8a'], { stars: 250, limit: 1000 }),

    // ---------- Эффекты взрыва (цвета искр) ----------
    I('fx_mint', 'fx', 0, 'Мятная свежесть', ['#a7f3d0', '#34d399', '#ffffff']),
    I('fx_lemon', 'fx', 0, 'Лимонад', ['#fef08a', '#facc15', '#ffffff']),
    I('fx_ice', 'fx', 1, 'Ледяной', ['#e0f2fe', '#7dd3fc', '#38bdf8']),
    I('fx_fire', 'fx', 1, 'Пламя', ['#fde047', '#fb923c', '#ef4444']),
    I('fx_toxic', 'fx', 2, 'Токсичный', ['#bef264', '#84cc16', '#365314']),
    I('fx_royal', 'fx', 2, 'Королевский пурпур', ['#e9d5ff', '#a855f7', '#6b21a8']),
    I('fx_plasma', 'fx', 3, 'Плазма', ['#f0abfc', '#22d3ee', '#ffffff']),
    I('fx_rainbow', 'fx', 4, 'Радужный взрыв', ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7']),
    I('fx_golddust', 'fx', 5, 'Золотая пыль', ['#fde68a', '#f59e0b', '#fffbeb']),

    // ---------- Рамки аватара (цвета градиента) ----------
    I('fr_silver', 'frame', 0, 'Серебро', ['#e5e7eb', '#9ca3af']),
    I('fr_bronze', 'frame', 0, 'Бронза', ['#f59e0b', '#92400e']),
    I('fr_ocean', 'frame', 1, 'Волна', ['#22d3ee', '#1d4ed8']),
    I('fr_forest', 'frame', 1, 'Лесная', ['#86efac', '#15803d']),
    I('fr_ruby', 'frame', 2, 'Рубин', ['#fb7185', '#9f1239']),
    I('fr_amethyst', 'frame', 2, 'Аметист', ['#c4b5fd', '#6d28d9']),
    I('fr_plasma', 'frame', 3, 'Плазменная', ['#f0abfc', '#22d3ee', '#f0abfc']),
    I('fr_phoenix', 'frame', 4, 'Феникс', ['#fde047', '#f97316', '#dc2626', '#fde047']),
    I('fr_crown', 'frame', 5, 'Корона', ['#fef3c7', '#f59e0b', '#b45309', '#fef3c7']),
    I('fr_cosmic', 'frame', 6, 'Космос', ['#67e8f9', '#a855f7', '#ec4899', '#67e8f9'], { stars: 150 }),

    // ---------- Значки у имени ----------
    I('bg_seed', 'badge', 0, 'Росток', '🌱'),
    I('bg_apple', 'badge', 0, 'Яблочко', '🍎'),
    I('bg_clover', 'badge', 0, 'Клевер', '🍀'),
    I('bg_fox', 'badge', 1, 'Лис', '🦊'),
    I('bg_rocket', 'badge', 1, 'Ракета', '🚀'),
    I('bg_crystal', 'badge', 2, 'Хрустальный шар', '🔮'),
    I('bg_ninja', 'badge', 2, 'Ниндзя', '🥷'),
    I('bg_dragon', 'badge', 3, 'Дракончик', '🐲'),
    I('bg_unicorn', 'badge', 4, 'Единорог', '🦄'),
    I('bg_crown', 'badge', 5, 'Корона', '👑'),
    I('bg_founder', 'badge', 6, 'Основатель', '🌟', { stars: 75, limit: 300 })
  ];
  const BY_ID = {};
  ITEMS.forEach((it) => { BY_ID[it.id] = it; });
  const dropPool = (r) => ITEMS.filter((it) => it.r === r && it.r < 6);

  // Товары за Telegram Stars
  const STARS_PRODUCTS = [
    { id: 'sh100', title: '100 самоцветов', desc: 'Валюта маркета и обменов', stars: 50, grant: { shards: 100 }, icon: '💠' },
    { id: 'sh330', title: '330 самоцветов', desc: '+10% бонус', stars: 150, grant: { shards: 330 }, icon: '💠', tag: '+10%' },
    { id: 'sh1200', title: '1 200 самоцветов', desc: '+20% бонус', stars: 500, grant: { shards: 1200 }, icon: '💠', tag: '+20%' },
    { id: 'sh4000', title: '4 000 самоцветов', desc: '+33% бонус', stars: 1500, grant: { shards: 4000 }, icon: '💠', tag: 'ВЫГОДА' },
    { id: 'starter', title: 'Набор донатера', desc: '300💠 + 5000🪙 + по 5 бустеров + значок «Основатель»', stars: 99, grant: { shards: 300, item: 'bg_founder', soft: { coins: 5000, boosters: { hammer: 5, shuffle: 5, rocket: 5, bomb: 5, rainbow: 5 } } }, icon: '🎁', once: true, tag: 'ХИТ' },
    { id: 'vip30', title: 'VIP на 30 дней', desc: 'Бесконечные жизни, +50% монет за уровни, VIP-значок', stars: 250, grant: { vipDays: 30 }, icon: '👑' },
    { id: 'coins5k', title: 'Мешок монет', desc: '5 000 монет', stars: 25, grant: { soft: { coins: 5000 } }, icon: '🪙' },
    { id: 'boost', title: 'Сундук бустеров', desc: 'По 10 каждого бустера', stars: 60, grant: { soft: { boosters: { hammer: 10, shuffle: 10, rocket: 10, bomb: 10, rainbow: 10 } } }, icon: '🧰' }
  ];
  // Сезонный пропуск: сезоны по 30 дней, общие для клиента и сервера
  const SEASON_EPOCH = Date.UTC(2026, 8, 25);
  const SEASON_MS = 30 * 86400000;
  function seasonInfo(t) {
    const n = Math.max(0, Math.floor(((t || Date.now()) - SEASON_EPOCH) / SEASON_MS));
    const start = SEASON_EPOCH + n * SEASON_MS;
    return { id: n + 1, start, end: start + SEASON_MS };
  }
  STARS_PRODUCTS.push({ id: 'pass', title: 'Премиум-пропуск', desc: 'Вторая линия наград текущего сезона', stars: 150, grant: { pass: true }, icon: '🎟️', hidden: true });
  ITEMS.filter((it) => it.stars).forEach((it) => STARS_PRODUCTS.push({ id: 'item_' + it.id, title: it.name, desc: 'Эксклюзивный предмет ★' + (it.limit ? ` · всего ${it.limit} шт.` : ''), stars: it.stars, grant: { item: it.id }, icon: '★', itemId: it.id }));

  function qualityOf(q) { return QUALITIES.find((x) => q < x.max) || QUALITIES[QUALITIES.length - 1]; }
  function rarityOf(r) { return RARITIES[r] || RARITIES[0]; }
  function totalDropChance() { return RARITIES.reduce((a, r) => a + r.drop, 0); }
  // Разыграть выпадение: rnd — функция случайных чисел [0,1). Возвращает редкость или -1.
  function rollRarity(rnd, mult) {
    let x = rnd(), acc = 0;
    for (let r = RARITIES.length - 1; r >= 0; r--) {
      acc += RARITIES[r].drop * (mult || 1);
      if (x < acc) return r;
    }
    return -1;
  }

  return { RARITIES, TYPES, QUALITIES, ITEMS, BY_ID, SHINY_CHANCE, STARS_PRODUCTS, seasonInfo, dropPool, qualityOf, rarityOf, rollRarity, totalDropChance };
}));
