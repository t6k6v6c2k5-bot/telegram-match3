/* =====================================================================
   FRUIT BLITZ — клиент (интерфейс, анимации, мета-прогрессия, сервер)
   Логика поля живёт в engine.js (window.FBEngine).
   ===================================================================== */
(function () {
  'use strict';
  const E = window.FBEngine;
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = (n) => { n = Math.floor(n || 0); if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M'; if (n >= 1e4) return (n / 1e3).toFixed(1).replace('.0', '') + 'K'; return String(n); };
  const dayKey = (d) => { d = d || new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60; return h ? `${h}ч ${m}м` : `${m}:${String(ss).padStart(2, '0')}`; };

  /* ============================================================
     0. TELEGRAM
     ============================================================ */
  const tg = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined) ? window.Telegram.WebApp : null;
  const tgUser = (() => { try { return tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null; } catch (e) { return null; } })();
  const playerId = tgUser && tgUser.id ? String(tgUser.id) : 'guest';
  const initData = tg && tg.initData ? tg.initData : '';
  const displayName = tgUser ? ((tgUser.first_name || '') + (tgUser.last_name ? ' ' + tgUser.last_name : '')).trim() || ('@' + (tgUser.username || 'player')) : 'Гость';

  function applySafeArea() {
    let top = 0, bottom = 0;
    if (tg) {
      const sa = tg.safeAreaInset || {}, csa = tg.contentSafeAreaInset || {};
      top = (sa.top || 0) + (csa.top || 0);
      bottom = (sa.bottom || 0) + (csa.bottom || 0);
      // Старые клиенты в полноэкранном режиме не сообщают высоту плашки «Закрыть» — даём запас
      if (tg.isFullscreen && !(csa.top > 0)) top = Math.max(top, (sa.top || 0) + 50);
    }
    document.documentElement.style.setProperty('--tg-safe-area-inset-top', top + 'px');
    document.documentElement.style.setProperty('--tg-safe-area-inset-bottom', bottom + 'px');
    if (currentScreen === 'screenGame' && board.st) layoutBoard();
  }
  function initTelegram() {
    if (!tg) { applySafeArea(); return; }
    try { tg.ready(); tg.expand(); } catch (e) { /* noop */ }
    try { if (tg.isVersionAtLeast && tg.isVersionAtLeast('8.0') && tg.requestFullscreen && !/android/i.test(navigator.userAgent)) tg.requestFullscreen(); } catch (e) { /* noop */ }
    try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) { /* noop */ }
    try { if (tg.enableClosingConfirmation) tg.enableClosingConfirmation(); } catch (e) { /* noop */ }
    try { if (tg.setHeaderColor) tg.setHeaderColor('#1a102f'); if (tg.setBackgroundColor) tg.setBackgroundColor('#1a102f'); if (tg.setBottomBarColor) tg.setBottomBarColor('#1a102f'); } catch (e) { /* noop */ }
    applySafeArea();
    ['safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged', 'fullscreenChanged'].forEach((ev) => { try { tg.onEvent(ev, applySafeArea); } catch (e) { /* noop */ } });
  }
  function haptic(kind) {
    if (state && !state.vibration) return;
    try {
      const h = tg && tg.HapticFeedback;
      if (!h) return;
      if (kind === 'select') h.selectionChanged();
      else if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
      else h.impactOccurred(kind || 'light');
    } catch (e) { /* noop */ }
  }

  /* ============================================================
     1. ЗВУК (синтез Web Audio, без файлов)
     ============================================================ */
  let actx = null, master = null;
  function ensureAudio() {
    try {
      if (!actx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        actx = new C(); master = actx.createGain(); master.gain.value = 0.55; master.connect(actx.destination);
      }
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { return null; }
    return actx;
  }
  function tone(freq, dur, type, vol, delay, glide) {
    if (!state.sound) return;
    const ctx = ensureAudio(); if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function noise(dur, vol, cutoff, delay) {
    if (!state.sound) return;
    const ctx = ensureAudio(); if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 1200;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol || 0.3, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master); src.start(t0);
  }
  const Sound = {
    click() { tone(660, 0.07, 'sine', 0.15); },
    select() { tone(520, 0.05, 'triangle', 0.12); },
    swap() { tone(380, 0.09, 'sine', 0.12, 0, 560); },
    nope() { tone(200, 0.12, 'square', 0.08); tone(160, 0.12, 'square', 0.08, 0.08); },
    pop(combo) { const b = 520 * Math.pow(1.12, Math.min(combo - 1, 8)); tone(b, 0.12, 'triangle', 0.2, 0, b * 1.6); tone(b * 1.5, 0.1, 'sine', 0.08, 0.03); },
    special() { tone(700, 0.18, 'sawtooth', 0.1, 0, 1400); tone(1050, 0.2, 'triangle', 0.12, 0.05); },
    boom() { noise(0.35, 0.35, 900); tone(100, 0.3, 'sine', 0.4, 0, 40); },
    zap() { noise(0.2, 0.2, 3000); tone(1200, 0.18, 'sawtooth', 0.08, 0, 300); },
    booster() { tone(300, 0.2, 'square', 0.12, 0, 900); },
    coin() { tone(1300, 0.07, 'square', 0.07); tone(1750, 0.1, 'square', 0.07, 0.06); },
    star(i) { tone(660 * Math.pow(1.26, i), 0.25, 'triangle', 0.2); tone(990 * Math.pow(1.26, i), 0.25, 'sine', 0.1, 0.05); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.18, i * 0.11)); },
    build() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.2, 'triangle', 0.16, i * 0.07)); noise(0.2, 0.1, 2000, 0.25); },
    chest() { noise(0.3, 0.2, 1500); [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.25, 'triangle', 0.15, 0.25 + i * 0.08)); },
    goal() { tone(880, 0.12, 'sine', 0.12); tone(1320, 0.18, 'sine', 0.12, 0.08); }
  };

  /* ============================================================
     2. КОНТЕНТ: скины, рамки, звания, бустеры, сад, задания
     ============================================================ */
  const SKINS = {
    classic: { name: 'Фрукты', emojis: ['🍎', '🍋', '🍇', '🫐', '🍊', '🍏'], price: 0 },
    hearts: { name: 'Сердечки', emojis: ['❤️', '💛', '💜', '💙', '🧡', '💚'], price: 800 },
    neon: { name: 'Неон-кубы', emojis: ['🟥', '🟨', '🟪', '🟦', '🟧', '🟩'], price: 1500 },
    animals: { name: 'Зверята', emojis: ['🦊', '🐥', '🦄', '🐳', '🐯', '🐸'], price: 2500 },
    sports: { name: 'Спорт', emojis: ['🥊', '🎾', '🔮', '🏐', '🏀', '🥎'], gems: 40 },
    candy: { name: 'Сладости', emojis: ['🍓', '🍯', '🍇', '🧁', '🍩', '🍪'], unlock: 'Сад: Цитрусовая роща' },
    space: { name: 'Космос', emojis: ['🪐', '⭐', '🔮', '🌍', '☄️', '👽'], unlock: 'Сад: Тропический остров' }
  };
  const FRAMES = {
    none: { name: 'Без рамки', icon: '⚪', price: 0 },
    gold: { name: 'Золотая', icon: '✨', unlock: 'Сад: Фруктовая поляна', gems: 15 },
    neon: { name: 'Неоновая', icon: '⚡', gems: 30 },
    fire: { name: 'Огненная', icon: '🔥', gems: 50 },
    rainbow: { name: 'Радужная', icon: '🌈', unlock: 'Сад: Ягодный пляж' },
    season: { name: 'Сезонная', icon: '🎟️', unlock: 'Премиум-пропуск, уровень 20' }
  };
  const TITLES = {
    novice: { name: 'Новичок', icon: '🌱', price: 0 },
    baron: { name: 'Фруктовый Барон', icon: '👑', gems: 20 },
    master: { name: 'Мастер Блитца', icon: '⚡', gems: 40 },
    gardener: { name: 'Главный Садовник', icon: '🌳', unlock: 'Сад: Сладкий город' },
    legend: { name: 'Легенда', icon: '🏆', unlock: 'Пройди 50 уровней' },
    season: { name: 'Легенда сезона', icon: '🎟️', unlock: 'Премиум-пропуск, уровень 30' }
  };
  const BOOSTERS = {
    hammer: { icon: '🔨', name: 'Молот', desc: 'Разбивает одну фишку или ящик', price: 120 },
    shuffle: { icon: '🔀', name: 'Перемешка', desc: 'Перемешивает всё поле', price: 100 },
    rocket: { icon: '🚀', name: 'Ракета', desc: 'Взрывает ряд и колонку', price: 180 },
    bomb: { icon: '💣', name: 'Бомба', desc: 'Мощный взрыв 5×5', price: 220 },
    rainbow: { icon: '🌈', name: 'Радуга', desc: 'Убирает все фишки одного цвета', price: 300 }
  };
  const BOOSTER_KEYS = Object.keys(BOOSTERS);
  // Легендарные бустеры: очень редкий дроп (сервер, ~1 на 500 побед) или покупка за Stars.
  // Не входят в BOOSTERS/BOOSTER_KEYS — не должны попадать в обычные награды и в общий список бустеров.
  const LEGENDARY = {
    nuke: { icon: '☢️', name: 'Ядерный удар', desc: 'Полностью очищает всё поле одним взрывом', color: '#ff5a3c' },
    tornado: { icon: '🌪️', name: 'Торнадо', desc: 'Сметает 3 случайные линии поля', color: '#7fd6ff' },
    lightning: { icon: '⚡', name: 'Гнев Зевса', desc: '5 ударов молнии по случайным фруктам', color: '#ffe066' }
  };
  const LEGENDARY_KEYS = Object.keys(LEGENDARY);
  const PRE_BOOSTERS = ['rocket', 'bomb', 'rainbow'];

  const GARDEN_AREAS = [
    { name: 'Фруктовая поляна', bg: ['#6fd36b', '#2e8b57'], items: [['🌱', 'Росток', 2], ['🌳', 'Яблоня', 3], ['🌷', 'Клумба', 3], ['🪑', 'Скамейка', 3], ['⛲', 'Фонтан', 4]], reward: { coins: 500, gems: 10, frame: 'gold' } },
    { name: 'Цитрусовая роща', bg: ['#ffd36b', '#e67e22'], items: [['🍊', 'Апельсиновое дерево', 3], ['🏡', 'Домик', 4], ['🌻', 'Подсолнухи', 3], ['🛖', 'Беседка', 4], ['🎡', 'Колесо обозрения', 5]], reward: { coins: 800, gems: 15, skin: 'candy' } },
    { name: 'Ягодный пляж', bg: ['#8fe3ff', '#f5d78e'], items: [['⛱️', 'Зонтик', 3], ['🍓', 'Грядка клубники', 4], ['🐚', 'Ракушки', 4], ['⛵', 'Лодка', 5], ['🏰', 'Песочный замок', 5]], reward: { coins: 1000, gems: 20, frame: 'rainbow' } },
    { name: 'Тропический остров', bg: ['#58d68d', '#0e6655'], items: [['🌴', 'Пальма', 4], ['🦜', 'Попугай', 4], ['🍍', 'Ананасы', 5], ['🛶', 'Каноэ', 5], ['🌋', 'Вулкан', 6]], reward: { coins: 1200, gems: 25, skin: 'space' } },
    { name: 'Сладкий город', bg: ['#f8a5c2', '#b03a6f'], items: [['🍭', 'Леденцы', 4], ['🧁', 'Кондитерская', 5], ['🍩', 'Пончики', 5], ['🎠', 'Карусель', 6], ['🏯', 'Дворец', 6]], reward: { coins: 1500, gems: 30, title: 'gardener' } },
    { name: 'Звёздная обсерватория', bg: ['#6c3ce0', '#1c1044'], items: [['🔭', 'Телескоп', 5], ['🚀', 'Ракета', 5], ['🛸', 'НЛО', 6], ['🪐', 'Планета', 6], ['🌌', 'Галактика', 7]], reward: { coins: 2000, gems: 40, chest: 'legend' } }
  ];
  const SLOT_POS = [[20, 60], [50, 50], [80, 60], [33, 84], [67, 84]];
  // Оформление сцены сада для каждой области: небо (верх, низ), дальний холм, ближний холм, светило
  const GARDEN_THEMES = [
    { sky: ['#7fd0ff', '#d9f4ff'], far: '#8fdc7a', near: '#4fb85a', sun: '☀️', deco: ['🌼', '🌿', '🍄'] },
    { sky: ['#ff9f6b', '#ffe3a3'], far: '#b5d96a', near: '#78b84a', sun: '🌅', deco: ['🌾', '🍃', '🌼'] },
    { sky: ['#6fd0ff', '#caf1ff'], far: '#3fa9e0', near: '#f3d88f', sun: '☀️', deco: ['🦀', '🌊', '🐚'] },
    { sky: ['#4fd0e0', '#c2f5ff'], far: '#2fa56b', near: '#48c47e', sun: '☀️', deco: ['🌺', '🌿', '🦋'] },
    { sky: ['#ffb3d5', '#ffe8f3'], far: '#ff9cc8', near: '#e86aa5', sun: '🌈', deco: ['🍬', '🍒', '✨'] },
    { sky: ['#140a33', '#43248f'], far: '#3b2a80', near: '#261a5c', sun: '🌙', deco: ['✨', '⭐', '💫'], night: true }
  ];
  function gardenArea(i) {
    const base = GARDEN_AREAS[i % GARDEN_AREAS.length];
    const cycle = Math.floor(i / GARDEN_AREAS.length);
    if (!cycle) return base;
    return {
      name: base.name + ' ' + ['', 'II', 'III', 'IV', 'V', 'VI'][Math.min(cycle, 5)], bg: base.bg,
      items: base.items.map(([e, n, c]) => [e, n, c + cycle * 2]),
      reward: { coins: base.reward.coins + cycle * 500, gems: base.reward.gems + cycle * 10, chest: 'big' }
    };
  }

  const QUEST_POOL = [
    { id: 'win2', icon: '🚩', text: 'Пройди 2 уровня', stat: 'wins', target: 2, reward: { coins: 150 } },
    { id: 'win4', icon: '🏁', text: 'Пройди 4 уровня', stat: 'wins', target: 4, reward: { gems: 5 } },
    { id: 'fruit60', icon: '🍎', text: 'Собери 60 фруктов', stat: 'cleared', target: 60, reward: { coins: 120 } },
    { id: 'fruit200', icon: '🧺', text: 'Собери 200 фруктов', stat: 'cleared', target: 200, reward: { coins: 250 } },
    { id: 'special4', icon: '💥', text: 'Создай 4 супер-фишки', stat: 'specials', target: 4, reward: { boosters: { rocket: 1 } } },
    { id: 'combo3', icon: '🔥', text: 'Сделай каскад ×3', stat: 'combo3', target: 1, reward: { coins: 150 } },
    { id: 'stars5', icon: '⭐', text: 'Заработай 5 звёзд', stat: 'stars', target: 5, reward: { gems: 4 } },
    { id: 'booster2', icon: '🔨', text: 'Используй 2 бустера', stat: 'boosters', target: 2, reward: { coins: 100 } },
    { id: 'perfect', icon: '🌟', text: 'Пройди уровень на ⭐⭐⭐', stat: 'perfect', target: 1, reward: { boosters: { bomb: 1 } } },
    { id: 'build1', icon: '🏗️', text: 'Построй 1 объект в Саду', stat: 'build', target: 1, reward: { coins: 200 } }
  ];
  const ACHIEVEMENTS = [
    { id: 'levels', icon: '🚩', name: 'Путешественник', stat: () => state.unlockedLevel - 1, tiers: [5, 15, 30, 60, 100, 200] },
    { id: 'fruits', icon: '🍎', name: 'Сборщик урожая', stat: () => state.stats.totalCleared, tiers: [200, 1000, 5000, 15000, 50000, 150000] },
    { id: 'specials', icon: '💥', name: 'Подрывник', stat: () => state.stats.specialsMade, tiers: [10, 50, 200, 600, 1500, 4000] },
    { id: 'stars', icon: '⭐', name: 'Звездочёт', stat: () => totalStars(), tiers: [10, 40, 100, 200, 400, 700] },
    { id: 'garden', icon: '🌳', name: 'Садовник', stat: () => state.stats.gardenBuilt, tiers: [3, 10, 25, 50, 100, 200] },
    { id: 'combo', icon: '🔥', name: 'Мастер комбо', stat: () => state.stats.bestCombo, tiers: [3, 5, 7, 9, 12, 15] },
    { id: 'rich', icon: '🪙', name: 'Богач', stat: () => state.stats.coinsEarned, tiers: [1000, 5000, 20000, 60000, 150000, 400000] }
  ];
  const ACH_GEMS = [3, 5, 10, 15, 25, 40];
  const LOGIN_REWARDS = [{ coins: 100 }, { boosters: { hammer: 2 } }, { coins: 250 }, { gems: 5 }, { boosters: { rocket: 2 } }, { coins: 500 }, { gems: 15, boosters: { rainbow: 1 } }];
  const WHEEL = [
    { r: { coins: 100 }, w: 24, col: '#ff4fa3' }, { r: { gems: 3 }, w: 14, col: '#4fa8ff' },
    { r: { boosters: { hammer: 1 } }, w: 16, col: '#ffb13d' }, { r: { coins: 250 }, w: 16, col: '#38d97a' },
    { r: { boosters: { rocket: 1 } }, w: 12, col: '#b24dff' }, { r: { gems: 8 }, w: 6, col: '#4fe3ff' },
    { r: { coins: 600 }, w: 8, col: '#ff6b3d' }, { r: { boosters: { rainbow: 1 } }, w: 4, col: '#ffd23f' }
  ];
  const CHESTS = {
    small: { icon: '🎁', name: 'Малый сундук', rolls: 3 },
    big: { icon: '🧰', name: 'Большой сундук', rolls: 5 },
    legend: { icon: '👑', name: 'Легендарный сундук', rolls: 8 }
  };
  const MECHANIC_INFO = {
    swap: '<b>Как играть:</b> проведи пальцем по фрукту к соседнему — собери 3 одинаковых в ряд!',
    special: '<b>Супер-фишки!</b> 4 в ряд = 🚀 ракета, уголок = 💣 бомба, 5 в ряд = 🌈 радуга. Нажми на супер-фишку, чтобы взорвать.',
    ice: '<b>Лёд 🧊</b> — собирай совпадения на замёрзших клетках, чтобы разбить лёд.',
    ingredient: '<b>Кокосы 🥥</b> — опусти их на самое дно поля. Взрывы в их колонке толкают кокос вниз!',
    box: '<b>Ящики 📦</b> — делай совпадения рядом с ящиком, чтобы его сломать.',
    lock: '<b>Цепи ⛓️</b> — скованный фрукт нельзя двигать. Включи его в совпадение, чтобы освободить.'
  };

  /* ============================================================
     3. СОСТОЯНИЕ И СОХРАНЕНИЕ (localStorage + облако)
     ============================================================ */
  const SAVE_KEY = 'fruit_blitz_progress_' + playerId;
  const MAX_LIVES = 10;
  const LIFE_REGEN_MS = 3 * 60 * 1000;
  function defaultState() {
    return {
      v: 3, fresh: true,
      coins: 500, gems: 20, lives: MAX_LIVES, nextLifeAt: null, infiniteLives: false, infiniteUntil: 0,
      sound: true, vibration: true,
      unlockedLevel: 1, levelStars: {}, claimedChests: {}, starsBank: 0,
      boosters: { hammer: 3, shuffle: 2, rocket: 2, bomb: 1, rainbow: 1 },
      ownedSkins: { classic: true }, equippedSkin: 'classic',
      ownedFrames: { none: true }, equippedFrame: 'none',
      ownedTitles: { novice: true }, equippedTitle: 'novice', titleAuto: true,
      legendary: { nuke: 0, tornado: 0, lightning: 0 },
      garden: { area: 0, built: [], areasDone: 0 },
      daily: null, login: { last: null, streak: 0 },
      wheelLast: 0, freeGiftLast: 0, starterBought: false, dealDay: null,
      achClaimed: {}, claimedGifts: {}, pass: null,
      tutorialDone: false, tips: {},
      adminRev: 0, resetToken: null,
      stats: { totalCleared: 0, specialsMade: 0, bestCombo: 0, coinsEarned: 0, wins: 0, gardenBuilt: 0, boostersUsed: 0, bestScore: 0, perfects: 0 }
    };
  }
  function loadState() {
    const d = defaultState();
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return d;
    const s = Object.assign(d, raw);
    s.fresh = false;
    s.boosters = Object.assign({ hammer: 0, shuffle: 0, rocket: 0, bomb: 0, rainbow: 0 }, raw.boosters || {});
    if (typeof s.boosters.rocketBoost === 'number') s.boosters.rocket += s.boosters.rocketBoost;
    delete s.boosters.rocketBoost; delete s.boosters.moves;
    BOOSTER_KEYS.forEach((k) => { s.boosters[k] = Math.max(0, Math.floor(Number(s.boosters[k]) || 0)); });
    s.stats = Object.assign(defaultState().stats, raw.stats || {});
    s.legendary = Object.assign({ nuke: 0, tornado: 0, lightning: 0 }, raw.legendary || {});
    LEGENDARY_KEYS.forEach((k) => { s.legendary[k] = Math.max(0, Math.floor(Number(s.legendary[k]) || 0)); });
    s.levelStars = raw.levelStars && typeof raw.levelStars === 'object' ? raw.levelStars : {};
    s.claimedChests = raw.claimedChests || {};
    s.ownedSkins = Object.assign({ classic: true }, raw.ownedSkins || {});
    if (!SKINS[s.equippedSkin] || !s.ownedSkins[s.equippedSkin]) s.equippedSkin = 'classic';
    s.ownedFrames = Object.assign({ none: true }, raw.ownedFrames || {});
    if (!FRAMES[s.equippedFrame]) s.equippedFrame = 'none';
    s.ownedTitles = Object.assign({ novice: true }, raw.ownedTitles || {});
    if (!TITLES[s.equippedTitle]) s.equippedTitle = 'novice';
    // историческим сохранениям (до автонадевания) считаем звание ручным, только если оно уже не «Новичок»
    s.titleAuto = typeof raw.titleAuto === 'boolean' ? raw.titleAuto : s.equippedTitle === 'novice';
    s.garden = Object.assign({ area: 0, built: [], areasDone: 0 }, raw.garden || {});
    if (!Array.isArray(s.garden.built)) s.garden.built = [];
    s.tips = raw.tips || {}; s.achClaimed = raw.achClaimed || {}; s.claimedGifts = raw.claimedGifts || {};
    s.login = Object.assign({ last: null, streak: 0 }, raw.login || {});
    s.unlockedLevel = Math.max(1, Math.floor(Number(s.unlockedLevel) || 1));
    if ((raw.v || 1) < 3) {
      // Миграция с прошлых версий: прогресс сохраняется, вдобавок — подарок за обновление
      if (s.unlockedLevel > 1) { s.tutorialDone = true; s.tips.swap = s.tips.special = s.tips.garden = true; }
      // Старая версия не всегда сохраняла звёзды — пройденным уровням без оценки засчитываем ⭐
      for (let n = 1; n < s.unlockedLevel; n++) if (!(Number(s.levelStars[n]) > 0)) s.levelStars[n] = 1;
      s.starsBank = Object.values(s.levelStars).reduce((a, b) => a + (Number(b) || 0), 0);
      s.lives = MAX_LIVES; s.nextLifeAt = null;
      s.gems += 10; s.boosters.bomb += 1; s.boosters.rainbow += 1;
      s.migratedGift = true;
      delete s.lastServerUpdatedAt; delete s.dailyQuests; delete s.lastWheelSpin; delete s.wheelStreak; delete s.leaderboard;
      s.v = 3;
    }
    return s;
  }
  let state = loadState();
  let saveTimer = null;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* noop */ } }, 120);
  }
  function saveNow() { clearTimeout(saveTimer); try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* noop */ } }
  const totalStars = () => Object.values(state.levelStars).reduce((a, b) => a + (Number(b) || 0), 0);

  /* ---------------- Ресурсы ---------------- */
  function addCoins(n) { n = Math.floor(n); state.coins = Math.max(0, state.coins + n); if (n > 0) state.stats.coinsEarned += n; }
  function spend(currency, amount) {
    if (currency === 'gems') { if (state.gems < amount) return false; state.gems -= amount; }
    else { if (state.coins < amount) return false; state.coins -= amount; }
    saveState(); renderHud(); scheduleSync();
    return true;
  }
  function trySpend(currency, amount) {
    if (spend(currency, amount)) return true;
    Sound.nope(); haptic('error');
    showToast(currency === 'gems' ? 'Не хватает кристаллов 💎' : 'Не хватает монет 🪙');
    return false;
  }
  const hasInfiniteLives = () => state.infiniteLives || Date.now() < (state.infiniteUntil || 0) || !!(window.FBMarket && FBMarket.isVip());
  function tickLives() {
    const now = Date.now();
    if (state.lives >= MAX_LIVES) state.nextLifeAt = null;
    else {
      if (!state.nextLifeAt) state.nextLifeAt = now + LIFE_REGEN_MS;
      let changed = false;
      while (state.lives < MAX_LIVES && now >= state.nextLifeAt) { state.lives++; state.nextLifeAt += LIFE_REGEN_MS; changed = true; }
      if (state.lives >= MAX_LIVES) state.nextLifeAt = null;
      if (changed) saveState();
    }
  }
  function loseLife() {
    if (hasInfiniteLives()) return;
    if (state.lives >= MAX_LIVES) state.nextLifeAt = Date.now() + LIFE_REGEN_MS;
    state.lives = Math.max(0, state.lives - 1);
    saveState(); scheduleSync();
  }
  function refillLives() { state.lives = Math.max(state.lives, MAX_LIVES); state.nextLifeAt = null; }

  /* ---------------- Награды ---------------- */
  function rollChest(tier) {
    const rng = Math.random;
    const rolls = CHESTS[tier] ? CHESTS[tier].rolls : 3;
    const mult = tier === 'legend' ? 3 : tier === 'big' ? 2 : 1;
    const rw = { coins: 0, gems: 0, boosters: {} };
    for (let i = 0; i < rolls; i++) {
      const x = rng();
      if (x < 0.4) rw.coins += (50 + Math.floor(rng() * 150)) * mult;
      else if (x < 0.55) rw.gems += (1 + Math.floor(rng() * 3)) * mult;
      else { const b = BOOSTER_KEYS[Math.floor(rng() * BOOSTER_KEYS.length)]; rw.boosters[b] = (rw.boosters[b] || 0) + 1; }
    }
    if (tier === 'legend' && rng() < 0.5) rw.infiniteMin = 60;
    return rw;
  }
  function applyReward(rw) {
    if (!rw) return;
    if (rw.coins) addCoins(rw.coins);
    if (rw.gems) state.gems += rw.gems;
    if (rw.lives) refillLives();
    if (rw.stars) state.starsBank += rw.stars;
    if (rw.infiniteMin) state.infiniteUntil = Math.max(Date.now(), state.infiniteUntil || 0) + rw.infiniteMin * 60000;
    if (rw.boosters) Object.keys(rw.boosters).forEach((k) => { if (BOOSTERS[k]) state.boosters[k] = (state.boosters[k] || 0) + rw.boosters[k]; });
    if (rw.legendary) Object.keys(rw.legendary).forEach((k) => { if (LEGENDARY[k]) state.legendary[k] = (state.legendary[k] || 0) + rw.legendary[k]; });
    if (rw.skin) state.ownedSkins[rw.skin] = true;
    if (rw.frame) state.ownedFrames[rw.frame] = true;
    if (rw.title) { state.ownedTitles[rw.title] = true; if (state.titleAuto) state.equippedTitle = rw.title; }
    saveState(); renderHud(); scheduleSync();
  }
  function rewardItems(rw) {
    const out = [];
    if (!rw) return out;
    if (rw.coins) out.push(['🪙', '+' + fmt(rw.coins)]);
    if (rw.gems) out.push(['💎', '+' + rw.gems]);
    if (rw.stars) out.push(['⭐', '+' + rw.stars]);
    if (rw.lives) out.push(['❤️', 'Все жизни']);
    if (rw.infiniteMin) out.push(['♾️', rw.infiniteMin + ' мин ❤️']);
    if (rw.boosters) Object.keys(rw.boosters).forEach((k) => { if (rw.boosters[k]) out.push([BOOSTERS[k].icon, '×' + rw.boosters[k]]); });
    if (rw.legendary) Object.keys(rw.legendary).forEach((k) => { if (rw.legendary[k]) out.push([LEGENDARY[k].icon, esc(LEGENDARY[k].name) + ' ×' + rw.legendary[k]]); });
    if (rw.skin) out.push([SKINS[rw.skin].emojis[0], 'Скин «' + SKINS[rw.skin].name + '»']);
    if (rw.frame) out.push([FRAMES[rw.frame].icon, 'Рамка «' + FRAMES[rw.frame].name + '»']);
    if (rw.title) out.push([TITLES[rw.title].icon, 'Звание «' + TITLES[rw.title].name + '»']);
    if (rw.chest) out.push([CHESTS[rw.chest].icon, CHESTS[rw.chest].name]);
    return out;
  }
  const rewardText = (rw) => rewardItems(rw).map((x) => x[0] + ' ' + x[1]).join('  ');

  /* ============================================================
     4. ИНТЕРФЕЙС: экраны, модалки, тосты, эффекты
     ============================================================ */
  const SCREENS = ['screenHome', 'screenMap', 'screenGame', 'screenShop', 'screenGarden', 'screenQuests', 'screenLeaders', 'screenMarket', 'screenArena'];
  const MK = () => window.FBMarket || null;
  let currentScreen = 'screenHome';
  let isAdmin = false;
  function showScreen(id) {
    if (!SCREENS.includes(id)) id = 'screenHome';
    SCREENS.forEach((s) => $(s).classList.toggle('active', s === id));
    currentScreen = id;
    const inGame = id === 'screenGame';
    $('topHud').classList.toggle('hidden', inGame);
    $('bottomNav').classList.toggle('hidden', inGame || id === 'screenMap');
    $('adminFab').classList.toggle('hidden', !(isAdmin && id === 'screenHome'));
    qsa('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === id));
    hideCoach();
    if (id === 'screenHome') renderHome();
    else if (id === 'screenMap') renderMap();
    else if (id === 'screenShop') renderShop();
    else if (id === 'screenGarden') renderGarden();
    else if (id === 'screenQuests') renderQuests();
    else if (id === 'screenLeaders') renderLeaders();
    else if (id === 'screenMarket' && MK()) MK().render();
    renderHud();
    updateBadges();
    updateBackButton();
  }
  function openModal(id) { hideCoach(); $(id).classList.remove('hidden'); }
  function closeModal(id) { $(id).classList.add('hidden'); }
  const anyModalOpen = () => qsa('.overlay').some((o) => !o.classList.contains('hidden'));

  let toastTimer = null;
  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  }

  let confirmResolve = null;
  function confirmBox(title, text, yesLabel) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text || '';
    $('btnConfirmYes').textContent = yesLabel || 'Да';
    openModal('modalConfirm');
    return new Promise((res) => { confirmResolve = res; });
  }
  $('btnConfirmYes').addEventListener('click', () => { closeModal('modalConfirm'); if (confirmResolve) confirmResolve(true); confirmResolve = null; });
  $('btnConfirmNo').addEventListener('click', () => { closeModal('modalConfirm'); if (confirmResolve) confirmResolve(false); confirmResolve = null; });

  /* Окно награды (сундуки, колесо, сад, задания, подарки) */
  let rewardResolve = null, rewardPending = null;
  function showReward(rw, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      rewardResolve = resolve; rewardPending = rw;
      $('rewardTitle').textContent = opts.title || 'Награда!';
      $('rewardSub').textContent = opts.sub || '';
      const icon = $('rewardIcon');
      icon.textContent = opts.icon || '🎁';
      icon.className = 'reward-icon';
      const list = $('rewardList');
      list.innerHTML = '';
      const btn = $('btnRewardOk');
      openModal('modalReward');
      const reveal = () => {
        rewardItems(rw).forEach(([ic, tx], i) => {
          const el = document.createElement('div');
          el.className = 'reward-pill';
          el.style.animationDelay = (i * 0.12) + 's';
          el.innerHTML = `<span>${ic}</span><span>${esc(tx)}</span>`;
          list.appendChild(el);
        });
        btn.disabled = false;
      };
      if (opts.chest) {
        btn.disabled = true;
        icon.classList.add('shaking');
        haptic('medium');
        setTimeout(() => { icon.classList.remove('shaking'); icon.classList.add('burst'); icon.textContent = '✨'; Sound.chest(); haptic('success'); burstConfetti(window.innerWidth / 2, window.innerHeight * 0.35, 60); reveal(); }, 900);
      } else { Sound.goal(); reveal(); }
    });
  }
  $('btnRewardOk').addEventListener('click', () => {
    closeModal('modalReward');
    const rw = rewardPending;
    rewardPending = null;
    if (rw) { applyReward(rw); if (rw.coins) flyTo('🪙', 'hudCoins', 6); if (rw.gems) flyTo('💎', 'hudGems', 4); Sound.coin(); }
    const r = rewardResolve; rewardResolve = null;
    if (r) r(true);
    updateBadges();
    if (currentScreen === 'screenHome') renderHome();
  });

  /* ---------------- Эффекты на весь экран: конфетти, частицы ---------------- */
  const fx = $('fxCanvas'), fctx = fx.getContext('2d');
  let fxParts = [], fxRunning = false;
  function sizeFx() { const d = Math.min(2, window.devicePixelRatio || 1); fx.width = window.innerWidth * d; fx.height = window.innerHeight * d; fctx.setTransform(d, 0, 0, d, 0, 0); }
  window.addEventListener('resize', sizeFx); sizeFx();
  const CONF_COLORS = ['#ff4fa3', '#ffd23f', '#4fe3ff', '#b24dff', '#38d97a', '#ff8a3d'];
  function burstConfetti(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
      fxParts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, g: 0.22, s: 5 + Math.random() * 6, c: CONF_COLORS[i % CONF_COLORS.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, life: 1, decay: 0.008 + Math.random() * 0.008, rect: true });
    }
    runFx();
  }
  function rainConfetti(n) {
    for (let i = 0; i < n; i++) fxParts.push({ x: Math.random() * window.innerWidth, y: -20 - Math.random() * 300, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, g: 0.04, s: 6 + Math.random() * 6, c: CONF_COLORS[i % CONF_COLORS.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, life: 1, decay: 0.004, rect: true });
    runFx();
  }
  // Большой сочный всплеск капель во все стороны — на особо крупных комбо (3+)
  function juiceBurst(x, y, colors, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 10;
      fxParts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, g: 0.26, s: 4.5 + Math.random() * 5.5, c: colors[i % colors.length], life: 1, decay: 0.016 + Math.random() * 0.014, rect: false });
    }
    runFx();
  }
  function sparks(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 4;
      fxParts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, g: 0.15, s: 2.5 + Math.random() * 3, c: color, life: 1, decay: 0.035 + Math.random() * 0.02, rect: false });
    }
    runFx();
  }
  function runFx() {
    if (fxRunning) return;
    fxRunning = true;
    const tick = () => {
      fctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      fxParts = fxParts.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);
      for (const p of fxParts) {
        p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.99; p.life -= p.decay;
        fctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        fctx.fillStyle = p.c;
        if (p.rect) { p.rot += p.vr; fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6); fctx.restore(); }
        else {
          // Капля сока: вытянута по направлению движения — сочнее, чем просто кружок
          const ang = Math.atan2(p.vy, p.vx), speed = Math.hypot(p.vx, p.vy), stretch = 1 + Math.min(1.3, speed * 0.07);
          fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(ang);
          fctx.beginPath(); fctx.ellipse(0, 0, p.s * stretch, p.s * 0.7, 0, 0, Math.PI * 2); fctx.fill();
          fctx.restore();
        }
      }
      fctx.globalAlpha = 1;
      if (fxParts.length) requestAnimationFrame(tick); else { fxRunning = false; fctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
    };
    requestAnimationFrame(tick);
  }
  /* Летящие к панели ресурсов иконки */
  function flyTo(icon, targetId, count, from) {
    const target = $(targetId);
    if (!target || target.offsetParent === null) return;
    const tr = target.getBoundingClientRect();
    const sx = from ? from.x : window.innerWidth / 2, sy = from ? from.y : window.innerHeight / 2;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'fly-item'; el.textContent = icon;
      el.style.left = (sx - 13 + (Math.random() - 0.5) * 60) + 'px';
      el.style.top = (sy - 13 + (Math.random() - 0.5) * 60) + 'px';
      document.body.appendChild(el);
      const dx = tr.left + 14 - parseFloat(el.style.left), dy = tr.top + 6 - parseFloat(el.style.top);
      setTimeout(() => { el.style.transform = `translate(${dx}px, ${dy}px) scale(.6)`; el.style.opacity = '0.2'; }, 30 + i * 70);
      setTimeout(() => { el.remove(); target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump'); }, 800 + i * 70);
    }
  }

  function avatarHtml(size) {
    if (tgUser && tgUser.photo_url) return `<img src="${esc(tgUser.photo_url)}" alt="" onerror="this.remove()">`;
    return esc(displayName.charAt(0).toUpperCase() || '🙂');
  }
  function initialOf(name) { return esc(String(name || '?').trim().charAt(0).toUpperCase() || '?'); }

  /* ============================================================
     5. ПАНЕЛЬ РЕСУРСОВ И ЗНАЧКИ
     ============================================================ */
  function renderHud() {
    $('coinsValue').textContent = fmt(state.coins);
    $('gemsValue').textContent = fmt(state.gems);
    const inf = hasInfiniteLives();
    $('livesValue').textContent = inf ? '∞' : state.lives;
    let timer = '';
    if (inf && !state.infiniteLives) timer = mmss(state.infiniteUntil - Date.now());
    else if (!inf && state.lives >= MAX_LIVES) timer = 'Полные';
    else if (!inf && state.nextLifeAt) timer = '+1 через ' + mmss(state.nextLifeAt - Date.now());
    $('livesTimer').textContent = timer;
  }
  const wheelReady = () => Date.now() - (state.wheelLast || 0) >= 24 * 3600 * 1000;
  const giftReady = () => Date.now() - (state.freeGiftLast || 0) >= 4 * 3600 * 1000;
  const loginReady = () => state.login.last !== dayKey();
  function gardenCanBuild() {
    renderPassTeaser();
    refreshFeedStrip();
    refreshArena();
    $('channelTeaser').classList.toggle('hidden', channelDone());
    maybeChannelPromo();
    const area = gardenArea(state.garden.area);
    return area.items.some((it, i) => !state.garden.built.includes(i) && state.starsBank >= it[2]);
  }
  function questsClaimable() {
    ensureDaily();
    const q = state.daily.quests.some((id) => { const d = QUEST_POOL.find((x) => x.id === id); return d && !state.daily.claimed[id] && (state.daily.progress[d.stat] || 0) >= d.target; });
    return q || loginReady() || ACHIEVEMENTS.some((a) => achTierReady(a)) || (typeof state !== 'undefined' && !state.channelClaimed && state.unlockedLevel >= 2);
  }
  function updateBadges() {
    $('dotWheel').classList.toggle('hidden', !wheelReady());
    $('dotDaily').classList.toggle('hidden', !loginReady());
    $('dotGift').classList.toggle('hidden', !giftReady());
    $('dotShop').classList.toggle('hidden', !giftReady());
    $('dotGarden').classList.toggle('hidden', !gardenCanBuild());
    $('dotQuests').classList.toggle('hidden', !questsClaimable());
  }

  /* ============================================================
     6. ГЛАВНАЯ
     ============================================================ */
  function renderHome() {
    const av = $('homeAvatar');
    av.innerHTML = avatarHtml();
    av.className = 'avatar' + (state.equippedFrame !== 'none' ? ' frame-' + state.equippedFrame : '');
    if (MK()) MK().decorateAvatar(av);
    $('homeName').textContent = displayName + ((MK() && MK().myBadge()) ? ' ' + MK().myBadge() : '');
    const t = TITLES[state.equippedTitle] || TITLES.novice;
    $('homeTitle').textContent = t.icon + ' ' + t.name;
    $('homeLevel').textContent = state.unlockedLevel;
    $('homeStars').textContent = totalStars();
    const ch = E.chapterOf(state.unlockedLevel);
    $('chapterEmoji').textContent = ch.emoji;
    $('chapterLabel').textContent = 'Глава ' + ch.number;
    $('chapterName').textContent = ch.name;
    const done = Math.max(0, Math.min(10, state.unlockedLevel - ch.firstLevel));
    $('chapterFill').style.width = (done * 10) + '%';
    $('chapterCount').textContent = done + '/10';
    $('homePlayLevel').textContent = 'Уровень ' + state.unlockedLevel + (E.levelConfig(state.unlockedLevel).hard ? ' 🔥' : '');
    $('wheelHint').textContent = wheelReady() ? 'Бесплатно!' : mmss(24 * 3600 * 1000 - (Date.now() - state.wheelLast));
    $('dailyHint').textContent = loginReady() ? 'Забери!' : 'Завтра';
    $('giftHint').textContent = giftReady() ? 'Готов!' : mmss(4 * 3600 * 1000 - (Date.now() - state.freeGiftLast));
    const area = gardenArea(state.garden.area);
    const next = area.items.findIndex((_, i) => !state.garden.built.includes(i));
    $('gardenTeaserIco').textContent = next >= 0 ? area.items[next][0] : '🌳';
    $('gardenTeaserTitle').textContent = 'Сад: ' + area.name;
    $('gardenTeaserSub').textContent = next >= 0 ? `Далее: ${area.items[next][1]} — ⭐${area.items[next][2]} (у вас ⭐${state.starsBank})` : 'Область завершена!';
    $('gardenTeaserFill').style.width = (state.garden.built.length / area.items.length * 100) + '%';
    ensureDaily();
    const qDone = state.daily.quests.filter((id) => { const d = QUEST_POOL.find((x) => x.id === id); return d && (state.daily.progress[d.stat] || 0) >= d.target; }).length;
    $('questTeaserSub').textContent = `${qDone}/${state.daily.quests.length} выполнено · бонус-сундук за все`;
    updateBadges();
  }

  /* ============================================================
     7. КАРТА УРОВНЕЙ
     ============================================================ */
  const MAP_STEP = 112, MAP_TOP = 150, MAP_BOTTOM = 90;
  const MAP_X = [50, 74, 80, 62, 36, 22, 28, 50];
  function renderMap() {
    const track = $('mapTrack');
    const scroll = $('mapScroll');
    track.innerHTML = '';
    $('mapStars').textContent = totalStars();
    const cur = state.unlockedLevel;
    const firstCh = E.chapterOf(Math.max(1, cur - 20));
    const start = firstCh.firstLevel;
    const end = E.chapterOf(cur + 5).lastLevel;
    const W = scroll.clientWidth || window.innerWidth;
    // Узлы: уровни + сундуки (каждые 5 уровней) + баннеры глав
    const nodes = [];
    for (let n = start; n <= end; n++) {
      if ((n - 1) % 10 === 0) nodes.push({ type: 'banner', ch: E.chapterOf(n) });
      nodes.push({ type: 'level', n });
      if (n % 5 === 0) nodes.push({ type: 'chest', n });
    }
    let slot = 0;
    // Позиции считаем снизу вверх (первый уровень внизу), потом сдвигаем всё вниз под отступ сверху
    const H = 0;
    const pos = [];
    let cy = H - MAP_BOTTOM;
    nodes.forEach((nd) => {
      if (nd.type === 'level') { nd.x = MAP_X[slot % MAP_X.length]; slot++; nd.y = cy; cy -= MAP_STEP; }
      else if (nd.type === 'chest') { const prev = MAP_X[(slot - 1) % MAP_X.length]; nd.x = prev > 50 ? prev - 34 : prev + 34; nd.y = cy + MAP_STEP * 0.5; }
      else { nd.x = 50; nd.y = cy - 10; cy -= 80; }
      pos.push(nd);
    });
    const topY = cy + MAP_STEP - MAP_TOP + 40;
    const shift = -topY;
    pos.forEach((nd) => { nd.y += shift; });
    const totalH = H + shift;
    track.style.height = totalH + 'px';

    // Фон: плавный градиент по главам
    const bg = document.createElement('div');
    bg.className = 'map-bg';
    const stops = [];
    pos.filter((nd) => nd.type === 'banner').forEach((nd) => {
      const p = Math.max(0, Math.min(100, nd.y / totalH * 100));
      stops.push(`${nd.ch.bg[1]} ${Math.max(0, p - 18).toFixed(1)}%`, `${nd.ch.bg[0]} ${Math.min(100, p + 4).toFixed(1)}%`);
    });
    stops.sort((a, b) => parseFloat(a.split(' ')[1]) - parseFloat(b.split(' ')[1]));
    bg.style.background = `linear-gradient(180deg, #120a2a 0%, ${stops.join(', ')}, #0f0820 100%)`;
    track.appendChild(bg);

    // Декор: фрукты главы по краям
    pos.filter((nd) => nd.type === 'level' && nd.n % 2 === 0).forEach((nd, i) => {
      const d = document.createElement('div');
      d.className = 'map-deco';
      d.textContent = E.chapterOf(nd.n).emoji;
      d.style.left = (nd.x > 50 ? 4 + (i % 3) * 3 : 82 + (i % 3) * 3) + '%';
      d.style.top = (nd.y - 20) + 'px';
      d.style.animationDelay = (i * 0.4) + 's';
      track.appendChild(d);
    });

    // Дорожка
    const levels = pos.filter((nd) => nd.type === 'level');
    const pts = levels.map((nd) => [nd.x / 100 * W, nd.y]);
    const smooth = (arr) => {
      if (!arr.length) return '';
      let d = `M ${arr[0][0]} ${arr[0][1]}`;
      for (let i = 1; i < arr.length; i++) { const [x0, y0] = arr[i - 1], [x1, y1] = arr[i]; const my = (y0 + y1) / 2; d += ` C ${x0} ${my}, ${x1} ${my}, ${x1} ${y1}`; }
      return d;
    };
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'map-path'); svg.setAttribute('width', W); svg.setAttribute('height', totalH);
    const dAll = smooth(pts);
    const doneIdx = levels.findIndex((nd) => nd.n === cur);
    const dDone = smooth(pts.slice(0, Math.max(1, doneIdx + 1)));
    [['p-base', dAll], ['p-road', dAll], ['p-done', dDone]].forEach(([cls, d]) => { const p = document.createElementNS(svgNS, 'path'); p.setAttribute('class', cls); p.setAttribute('d', d); svg.appendChild(p); });
    track.appendChild(svg);

    // Узлы
    let curY = 0;
    pos.forEach((nd) => {
      const el = document.createElement('div');
      el.style.left = nd.x + '%'; el.style.top = nd.y + 'px';
      if (nd.type === 'banner') {
        el.className = 'map-banner';
        el.innerHTML = `<small>Глава ${nd.ch.number}</small>${nd.ch.emoji} ${esc(nd.ch.name)}`;
      } else if (nd.type === 'chest') {
        el.className = 'map-node chest-node';
        const opened = !!state.claimedChests[nd.n];
        const ready = !opened && cur > nd.n;
        el.innerHTML = `<button class="chest ${opened ? 'opened' : ready ? 'ready' : ''}">${opened ? '📭' : '🎁'}</button><small>${opened ? 'Открыт' : ready ? 'Открыть!' : 'После ' + nd.n}</small>`;
        el.querySelector('button').addEventListener('click', () => onMapChest(nd.n, ready, opened));
      } else {
        const n = nd.n, locked = n > cur, stars = state.levelStars[n] || 0, isCur = n === cur;
        const cfg = E.levelConfig(n);
        el.className = 'map-node';
        const cls = locked ? 'locked' : isCur ? 'current' : 'done';
        let inner = `<button class="orb ${cls}${cfg.hard ? ' hard' : ''}">${n}</button>`;
        if (!locked && !isCur) inner += `<div class="node-stars">${[1, 2, 3].map((i) => `<i class="${i <= stars ? 'on' : ''}">★</i>`).join('')}</div>`;
        if (isCur) { inner += `<div class="here-marker"><div class="avatar${state.equippedFrame !== 'none' ? ' frame-' + state.equippedFrame : ''}">${avatarHtml()}</div></div>`; curY = nd.y; }
        el.innerHTML = inner;
        el.querySelector('.orb').addEventListener('click', () => {
          if (locked) { Sound.nope(); showToast('🔒 Сначала пройди уровень ' + cur); return; }
          haptic('light'); Sound.click(); openIntro(n);
        });
      }
      track.appendChild(el);
    });
    requestAnimationFrame(() => { scroll.scrollTop = Math.max(0, curY - scroll.clientHeight * 0.55); });
  }
  async function onMapChest(n, ready, opened) {
    if (opened) { showToast('Этот сундук уже открыт'); return; }
    if (!ready) { Sound.nope(); showToast('Пройди уровень ' + n + ', чтобы открыть'); return; }
    state.claimedChests[n] = true;
    saveState();
    const rw = rollChest(n % 10 === 0 ? 'big' : 'small');
    await showReward(rw, { title: n % 10 === 0 ? 'Сундук главы!' : 'Сундук на карте', icon: '🎁', chest: true });
    renderMap();
  }

  /* ============================================================
     8. ИНТРО УРОВНЯ
     ============================================================ */
  const TILE_HEX = ['#ff4d6d', '#ffd23f', '#b24dff', '#3fa9ff', '#ff9f43', '#38d97a'];
  function skinEmojis() { return (MK() && MK().skinEmojis()) || (SKINS[state.equippedSkin] || SKINS.classic).emojis; }
  function goalIcon(g) {
    if (g.type === 'collect') return skinEmojis()[g.t];
    return { ice: '🧊', box: '📦', ingredient: '🥥', score: '⭐' }[g.type] || '🎯';
  }
  function goalLabel(g, st) {
    if (g.type === 'score') return fmt(st ? Math.min(st.score, g.target) : 0) + '/' + fmt(g.target);
    return String(Math.max(0, g.target - g.count));
  }
  let introLevel = 1;
  const introSel = new Set();
  function openIntro(n) {
    tickLives();
    if (!hasInfiniteLives() && state.lives <= 0) { openNoLives(); return; }
    introLevel = n; introSel.clear();
    const cfg = E.levelConfig(n), ch = E.chapterOf(n);
    const preview = E.createBoard(cfg, { seed: 7 });
    $('introBadge').textContent = n;
    $('introTitle').textContent = 'Уровень ' + n + (cfg.hard ? ' 🔥' : '');
    $('introSub').textContent = `${ch.emoji} Глава ${ch.number} · ${ch.name}${cfg.hard ? ' · сложный' : ''}`;
    $('introGoals').innerHTML = preview.goals.map((g) => `<div class="goal-chip"><span class="g-ico">${goalIcon(g)}</span>${g.type === 'score' ? fmt(g.target) : g.target}</div>`).join('');
    const nm = cfg.newMechanic && MECHANIC_INFO[cfg.newMechanic];
    $('introNew').classList.toggle('hidden', !nm);
    if (nm) $('introNew').innerHTML = '🆕 ' + nm;
    const th = E.starThresholds(preview.par);
    const best = state.levelStars[n] || 0;
    $('introStars').innerHTML = `Ходов без ограничений! ⭐⭐⭐ — до ${th.three} ходов · ⭐⭐ — до ${th.two}` + (best ? `<br>Ваш рекорд: ${'⭐'.repeat(best)}` : '');
    renderPreBoosters();
    openModal('modalIntro');
  }
  function renderPreBoosters() {
    const wrap = $('preBoosters');
    wrap.innerHTML = PRE_BOOSTERS.map((k) => {
      const cnt = state.boosters[k] || 0;
      return `<button class="booster ${introSel.has(k) ? 'sel' : ''}" data-k="${k}">${BOOSTERS[k].icon}<span class="b-count ${cnt ? '' : 'buy'}">${cnt || '+'}</span></button>`;
    }).join('');
    qsa('.booster', wrap).forEach((b) => b.addEventListener('click', async () => {
      const k = b.dataset.k;
      if (introSel.has(k)) introSel.delete(k);
      else if ((state.boosters[k] || 0) > 0) introSel.add(k);
      else {
        const ok = await confirmBox(`${BOOSTERS[k].icon} ${BOOSTERS[k].name}`, `${BOOSTERS[k].desc}. Появится на поле сразу при старте.`, `Купить за ${BOOSTERS[k].price} 🪙`);
        if (!ok || !trySpend('coins', BOOSTERS[k].price)) return;
        state.boosters[k] = (state.boosters[k] || 0) + 1; saveState(); introSel.add(k);
      }
      Sound.select(); haptic('select'); renderPreBoosters();
    }));
  }
  $('btnIntroPlay').addEventListener('click', () => { ensureAudio(); Sound.click(); startLevel(introLevel, Array.from(introSel)); });

  /* ============================================================
     9. ИГРОВОЕ ПОЛЕ
     ============================================================ */
  const board = { el: $('board'), st: null, cfg: null, level: 0, tiles: new Map(), cells: [], ice: new Map(), boxes: new Map(), locks: new Map(),
    cell: 40, gap: 3, pad: 6, side: 300, busy: false, done: false, selected: null, armed: null, goalPrev: [], snap: null, turnCombo: 1 };
  let paused = false;

  async function startLevel(n, pre) {
    if (board.starting) return;
    board.starting = true;
    try { await startLevelInner(n, pre); } finally { board.starting = false; }
  }
  async function startLevelInner(n, pre) {
    closeModal('modalIntro');
    tickLives();
    if (!hasInfiniteLives() && state.lives <= 0) { openNoLives(); return; }
    pre = (pre || []).filter((k) => (state.boosters[k] || 0) > 0);
    pre.forEach((k) => { state.boosters[k]--; state.stats.boostersUsed++; });
    if (pre.length) dailyStat('boosters', pre.length);
    board.level = n;
    board.cfg = E.levelConfig(n);
    // Сервер выдаёт seed — потом он сам переиграет уровень по журналу ходов и разыграет дроп
    const run = MK() ? await MK().startRun(n, pre) : null;
    board.run = run ? { id: run.runId, log: [] } : null;
    board.st = E.createBoard(board.cfg, { preBoosters: pre, seed: run ? run.seed : undefined });
    board.done = false; board.busy = false; board.armed = null; board.selected = null; paused = false;
    board.snap = { cleared: 0, specials: 0 };
    board.t0 = Date.now();
    track('lvl_start', { n });
    renderLegendaryBar();
    board.goalPrev = board.st.goals.map((g) => g.count);
    saveState();
    showScreen('screenGame');
    $('gameLevelNum').textContent = n;
    buildBoardDom();
    requestAnimationFrame(() => { layoutBoard(); renderGoals(true); });
    renderBoosterBar();
    updateGameHud();
    if (pre.length) showBanner('Бустеры на поле!');
    setTimeout(levelTutorials, 450);
    scheduleHint();
  }

  const cellPos = (r, c) => ({ x: board.pad + c * (board.cell + board.gap), y: board.pad + r * (board.cell + board.gap) });
  function setRect(el, r, c, grow) {
    const p = cellPos(r, c), g = grow || 0;
    el.style.left = (p.x - g) + 'px'; el.style.top = (p.y - g) + 'px';
    el.style.width = el.style.height = (board.cell + g * 2) + 'px';
  }
  // «Сочные» векторные фрукты для базового скина. Каждая фишка — самодостаточный SVG
  // со своими градиентами (важно: общий <defs> на весь документ ненадёжно рендерится
  // при использовании <use> из разных SVG-корней — проверено на практике).
  function fruitSvgMarkup(idx, uid) {
    const id = (n) => `${n}-${uid}`;
    const grads = {
      apple: ['#ff9aa8', '#ff4d5e', '#c4102a'], lemon: ['#fff6b0', '#ffd93f', '#e8a400'],
      grape: ['#d9a3ff', '#9a3fe0', '#6318a8'], berry: ['#9fd0ff', '#3f7fe0', '#1c4fb0'],
      orange: ['#ffcf82', '#ff9a1f', '#d96e00'], lime: ['#d4f7a0', '#7fd93f', '#3f9e18']
    };
    const lin = (name, cid) => `<linearGradient id="${id(cid)}" x1="15%" y1="0%" x2="90%" y2="100%"><stop offset="0%" stop-color="${grads[name][0]}"/><stop offset="50%" stop-color="${grads[name][1]}"/><stop offset="100%" stop-color="${grads[name][2]}"/></linearGradient>`;
    const leaf = `<linearGradient id="${id('g-leaf')}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#7fe085"/><stop offset="100%" stop-color="#2f9e3f"/></linearGradient>`;
    const shine = `<radialGradient id="${id('shine')}" cx="32%" cy="24%" r="70%"><stop offset="0%" stop-color="#fff" stop-opacity=".95"/><stop offset="40%" stop-color="#fff" stop-opacity=".55"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
    const B = { // тела фруктов (без <defs>, ссылаются на id(...) выше)
      0: `<path d="M50 30c-19 0-34 15-34 34s15 32 34 32 34-14 34-32-15-34-34-34z" fill="url(#${id('g-apple')})"/><path d="M50 30c-2-6-2-10 1-14" stroke="#7a3d1a" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M50 20c2-6 10-9 15-6 1 6-5 11-15 8z" fill="url(#${id('g-leaf')})"/><ellipse cx="38" cy="50" rx="15" ry="18" fill="url(#${id('shine')})"/>`,
      1: `<path d="M50 22c22 0 38 13 38 28s-16 28-38 28-38-13-38-28 16-28 38-28z" fill="url(#${id('g-lemon')})"/><path d="M14 50c-3-1-6-3-6-6s3-4 6-3" stroke="#e8a400" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M86 50c3-1 6-3 6-6s-3-4-6-3" stroke="#e8a400" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="40" cy="38" rx="13" ry="9" fill="url(#${id('shine')})"/>`,
      2: `<path d="M50 20c3-6 10-8 10-8" stroke="url(#${id('g-leaf')})" stroke-width="6" fill="none" stroke-linecap="round"/><g fill="url(#${id('g-grape')})"><circle cx="50" cy="30" r="13"/><circle cx="35" cy="45" r="14"/><circle cx="65" cy="45" r="14"/><circle cx="27" cy="63" r="13"/><circle cx="50" cy="65" r="14"/><circle cx="73" cy="63" r="13"/><circle cx="50" cy="83" r="12"/></g><ellipse cx="43" cy="40" rx="6" ry="5" fill="url(#${id('shine')})"/><ellipse cx="43" cy="58" rx="6" ry="5" fill="url(#${id('shine')})"/>`,
      3: `<g fill="url(#${id('g-berry')})"><circle cx="36" cy="42" r="22"/><circle cx="66" cy="46" r="19"/><circle cx="50" cy="70" r="20"/></g><g stroke="#1c4fb0" stroke-width="2.2" fill="none" opacity=".8"><path d="M31 27l5 5M41 27l-5 5"/><path d="M62 32l4 4M70 32l-4 4"/><path d="M45 55l5 5M55 55l-5 5"/></g><ellipse cx="29" cy="34" rx="8" ry="6" fill="url(#${id('shine')})"/><ellipse cx="43" cy="62" rx="7" ry="5" fill="url(#${id('shine')})"/>`,
      4: `<path d="M48 18c4-4 10-4 10 2-4 0-8 2-8 6" fill="url(#${id('g-leaf')})"/><circle cx="50" cy="52" r="34" fill="url(#${id('g-orange')})"/><g fill="#d96e00" opacity=".45"><circle cx="40" cy="35" r="1.6"/><circle cx="55" cy="30" r="1.6"/><circle cx="65" cy="42" r="1.6"/><circle cx="32" cy="50" r="1.6"/><circle cx="60" cy="60" r="1.6"/><circle cx="45" cy="65" r="1.6"/><circle cx="70" cy="58" r="1.6"/><circle cx="50" cy="45" r="1.6"/></g><ellipse cx="38" cy="40" rx="15" ry="12" fill="url(#${id('shine')})"/>`,
      5: `<path d="M50 33c-18 0-33 14-33 33s15 32 33 32 33-14 33-32-15-33-33-33z" fill="url(#${id('g-lime')})"/><path d="M50 33c-2-6-2-10 1-14" stroke="#5a7a1a" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M50 23c2-6 10-9 15-6 1 6-5 11-15 8z" fill="url(#${id('g-leaf')})"/><ellipse cx="38" cy="53" rx="14" ry="17" fill="url(#${id('shine')})"/>`
    };
    const names = ['apple', 'lemon', 'grape', 'berry', 'orange', 'lime'];
    const defs = `<defs>${lin(names[idx], 'g-' + names[idx])}${leaf}${shine}</defs>`;
    return defs + B[idx];
  }
  let fruitUidSeq = 0;

  function styleTile(el, t) {
    const emojis = skinEmojis();
    const svgFruits = state.equippedSkin === 'classic'; // собственные «сочные» иконки только для базового скина
    let cls = 'tile', emo = '', svgIdx = null;
    if (t.t === 'ING') { cls += ' c-ing'; emo = '🥥'; }
    else if (t.s === 'rainbow') { cls += ' c-rb'; emo = '🌈'; }
    else { cls += ' c' + t.t; if (svgFruits) svgIdx = t.t; else emo = emojis[t.t] || '❓'; if (t.s) cls += ' sp-' + t.s; }
    el.className = cls;
    const emoEl = el.querySelector('.emo');
    el.classList.toggle('svgfruit', svgIdx != null);
    if (svgIdx != null) emoEl.innerHTML = `<svg class="fruit-svg" viewBox="0 0 100 100">${fruitSvgMarkup(svgIdx, t.id != null ? t.id : (fruitUidSeq++))}</svg>`;
    else emoEl.textContent = emo;
    el.style.width = el.style.height = board.cell + 'px';
    el.style.setProperty('--emo', Math.round(board.cell * 0.56) + 'px');
  }
  function makeTile(t) {
    const el = document.createElement('div');
    el.innerHTML = '<div class="ti"><div class="gem"></div><span class="emo"></span></div>';
    styleTile(el, t);
    board.el.appendChild(el);
    board.tiles.set(t.id, el);
    return el;
  }
  function placeTile(el, r, c, instant) {
    const p = cellPos(r, c);
    if (instant) el.style.transition = 'none';
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    if (instant) { void el.offsetWidth; el.style.transition = ''; }
  }
  function buildBoardDom() {
    const st = board.st, S = st.size;
    board.el.innerHTML = '';
    board.el.style.background = (MK() && MK().boardBg()) || '';
    board.tiles.clear(); board.ice.clear(); board.boxes.clear(); board.locks.clear(); board.cells = [];
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + ((r + c) % 2 ? ' alt' : '');
      cell.dataset.r = r; cell.dataset.c = c;
      board.el.appendChild(cell); board.cells.push(cell);
      if (st.box[r][c]) { const b = document.createElement('div'); b.className = 'box' + (st.box[r][c] > 1 ? ' hp2' : ''); b.dataset.r = r; b.dataset.c = c; board.el.appendChild(b); board.boxes.set(E.K(r, c), b); }
    }
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (st.tiles[r][c]) makeTile(st.tiles[r][c]);
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
      if (st.ice[r][c]) { const i = document.createElement('div'); i.className = 'ice' + (st.ice[r][c] > 1 ? ' l2' : ''); i.dataset.r = r; i.dataset.c = c; board.el.appendChild(i); board.ice.set(E.K(r, c), i); }
      if (st.lock[r][c]) { const l = document.createElement('div'); l.className = 'lock-ov'; l.dataset.r = r; l.dataset.c = c; board.el.appendChild(l); board.locks.set(E.K(r, c), l); }
    }
  }
  function layoutBoard() {
    const st = board.st;
    if (!st) return;
    const area = $('boardArea');
    const w = area.clientWidth, h = area.clientHeight;
    if (!w || !h) return;
    const S = st.size;
    const side = Math.floor(Math.max(220, Math.min(w - 2, h - 2, 640)));
    board.pad = 6; board.gap = S >= 8 ? 3 : 4;
    board.cell = (side - board.pad * 2 - board.gap * (S - 1)) / S;
    board.side = side;
    board.el.style.width = board.el.style.height = side + 'px';
    board.cells.forEach((el) => setRect(el, +el.dataset.r, +el.dataset.c));
    board.boxes.forEach((el) => setRect(el, +el.dataset.r, +el.dataset.c));
    board.ice.forEach((el) => setRect(el, +el.dataset.r, +el.dataset.c, 1));
    board.locks.forEach((el) => setRect(el, +el.dataset.r, +el.dataset.c));
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
      const t = st.tiles[r][c];
      const el = t && board.tiles.get(t.id);
      if (el) { styleTile(el, t); placeTile(el, r, c, true); }
    }
  }
  window.addEventListener('resize', () => { if (currentScreen === 'screenGame' && !board.busy) layoutBoard(); });

  /* ---------------- HUD уровня ---------------- */
  function renderGoals(initial) {
    const st = board.st;
    const bar = $('goalsBar');
    if (initial || bar.children.length !== st.goals.length) {
      bar.innerHTML = st.goals.map((g, i) => `<div class="goal-chip" data-i="${i}"><span class="g-ico">${goalIcon(g)}</span><span class="g-val"></span></div>`).join('');
    }
    st.goals.forEach((g, i) => {
      const chip = bar.children[i];
      if (!chip) return;
      chip.querySelector('.g-val').textContent = goalLabel(g, st);
      const done = g.count >= g.target;
      chip.classList.toggle('done', done);
      if (!initial && g.count > (board.goalPrev[i] || 0)) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
      board.goalPrev[i] = g.count;
    });
  }
  function updateGameHud() {
    const st = board.st;
    if (!st) return;
    $('movesValue').textContent = st.moves;
    $('scoreValue').textContent = fmt(st.score);
    const th = E.starThresholds(st.par), stars = E.computeStars(st.moves, st.par);
    let fill;
    if (stars === 3) fill = 66 + 34 * (1 - st.moves / Math.max(1, th.three));
    else if (stars === 2) fill = 33 + 33 * (1 - (st.moves - th.three) / Math.max(1, th.two - th.three));
    else fill = 20;
    $('starMeterFill').style.width = Math.max(4, Math.min(100, fill)) + '%';
    $('smStar1').classList.add('on');
    $('smStar2').classList.toggle('on', stars >= 2);
    $('smStar3').classList.toggle('on', stars >= 3);
    $('starHint').textContent = stars === 3 ? `⭐⭐⭐ — ещё ${th.three - st.moves} ход.` : stars === 2 ? `⭐⭐ — ещё ${th.two - st.moves} ход.` : 'Ходы не ограничены — доведи до конца!';
    renderGoals(false);
  }
  function showBanner(text, gold) {
    const b = $('gameBanner');
    b.textContent = text;
    b.className = 'game-banner' + (gold ? ' gold' : '');
    void b.offsetWidth;
    b.classList.add('show');
  }

  /* ---------------- Анимация шагов движка ---------------- */
  function screenPt(r, c) {
    const rect = board.el.getBoundingClientRect(), p = cellPos(r, c);
    return { x: rect.left + p.x + board.cell / 2, y: rect.top + p.y + board.cell / 2 };
  }
  function fxAt(cls, r, c, w, h, cx, cy) {
    const el = document.createElement('div');
    el.className = cls;
    el.style.left = cx + 'px'; el.style.top = cy + 'px';
    el.style.width = w + 'px'; el.style.height = h + 'px';
    board.el.appendChild(el);
    setTimeout(() => el.remove(), 550);
  }
  function fxExplosion(e) {
    const p = cellPos(e.r, e.c), cs = board.cell;
    if (e.s === 'rh' || e.s === 'row') fxAt('fx-beam', e.r, e.c, board.side, cs * 0.5, 0, p.y + cs * 0.25);
    if (e.s === 'rv' || e.s === 'row') fxAt('fx-beam v', e.r, e.c, cs * 0.5, board.side, p.x + cs * 0.25, 0);
    if (e.s === 'bomb' || e.s === 'bomb2') { const sz = cs * (e.s === 'bomb' ? 3.6 : 5.8); fxAt('fx-ring', e.r, e.c, sz, sz, p.x + cs / 2 - sz / 2, p.y + cs / 2 - sz / 2); }
    if (e.s === 'rainbow') { const f = document.createElement('div'); f.className = 'fx-flash'; board.el.appendChild(f); setTimeout(() => f.remove(), 450); }
  }
  function floatScore(step) {
    if (!step.score || !step.cleared.length) return;
    let sx = 0, sy = 0;
    step.cleared.forEach((c) => { const p = cellPos(c.r, c.c); sx += p.x; sy += p.y; });
    const el = document.createElement('div');
    el.className = 'fx-score';
    el.textContent = '+' + step.score;
    el.style.left = (sx / step.cleared.length + board.cell / 2) + 'px';
    el.style.top = (sy / step.cleared.length + board.cell / 2) + 'px';
    board.el.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }
  const COMBO_WORDS = ['', '', 'Сладко!', 'Сочно!', 'Супер!', 'Невероятно!', 'Фруктовый шторм!', 'Божественно!'];

  async function animSwap(s, back) {
    const a = board.tiles.get(s.a.id), b = board.tiles.get(s.b.id);
    if (a) placeTile(a, s.b.r, s.b.c);
    if (b) placeTile(b, s.a.r, s.a.c);
    Sound.swap();
    await wait(185);
    if (back) {
      if (a) { placeTile(a, s.a.r, s.a.c); a.classList.add('nope'); }
      if (b) placeTile(b, s.b.r, s.b.c);
      Sound.nope(); haptic('error');
      await wait(200);
      if (a) a.classList.remove('nope');
    }
  }
  async function animClear(s) {
    board.turnCombo = Math.max(board.turnCombo, s.combo);
    s.explosions.forEach(fxExplosion);
    if (s.explosions.length) {
      if (s.explosions.some((e) => e.s === 'bomb' || e.s === 'rainbow')) Sound.boom(); else Sound.zap();
      haptic('heavy');
      board.el.classList.remove('shake'); void board.el.offsetWidth; board.el.classList.add('shake');
    } else { Sound.pop(s.combo); haptic(s.combo > 1 ? 'medium' : 'light'); }
    let bx = 0, by = 0, bn = 0; const burstColors = [];
    for (const c of s.cleared) {
      const el = board.tiles.get(c.id);
      board.tiles.delete(c.id);
      if (el) { el.classList.add('pop'); setTimeout(() => el.remove(), 290); }
      const sp = screenPt(c.r, c.c);
      const col = (MK() && MK().fxColor()) || (typeof c.t === 'number' && c.t >= 0 ? TILE_HEX[c.t] : '#fff');
      sparks(sp.x, sp.y, col, s.cleared.length > 20 ? 2 : 5);
      bx += sp.x; by += sp.y; bn++; burstColors.push(col);
    }
    // Особо крупное комбо — добавляем большой всплеск капель во все стороны из центра собранной группы
    if (s.combo >= 3 && bn) juiceBurst(bx / bn, by / bn, burstColors, Math.min(46, 14 + s.combo * 6));
    s.iceHits.forEach((h) => {
      const el = board.ice.get(E.K(h.r, h.c));
      if (!el) return;
      if (h.left <= 0) { el.classList.add('crack'); board.ice.delete(E.K(h.r, h.c)); setTimeout(() => el.remove(), 320); }
      else el.classList.remove('l2');
      const sp = screenPt(h.r, h.c); sparks(sp.x, sp.y, '#cdf3ff', 4);
    });
    s.boxHits.forEach((h) => {
      const el = board.boxes.get(E.K(h.r, h.c));
      if (!el) return;
      if (h.left <= 0) { el.classList.add('break'); board.boxes.delete(E.K(h.r, h.c)); setTimeout(() => el.remove(), 320); const sp = screenPt(h.r, h.c); sparks(sp.x, sp.y, '#c98a4b', 8); }
      else { el.classList.remove('hp2', 'hit'); void el.offsetWidth; el.classList.add('hit'); }
    });
    s.lockBreaks.forEach((h) => {
      const el = board.locks.get(E.K(h.r, h.c));
      if (el) { el.classList.add('break'); board.locks.delete(E.K(h.r, h.c)); setTimeout(() => el.remove(), 320); }
    });
    floatScore(s);
    if (s.created.length) {
      await wait(150);
      s.created.forEach((t) => { const el = makeTile(t); placeTile(el, t.r, t.c, true); el.classList.add('born'); setTimeout(() => el.classList.remove('born'), 400); });
      Sound.special(); haptic('medium');
      board.createdSpecial = true;
    }
    if (s.combo >= 3 && s.combo <= 7 && !board.done) showBanner(COMBO_WORDS[s.combo]);
    else if (s.combo > 7 && !board.done) showBanner(COMBO_WORDS[7]);
    updateGameHud();
    await wait(s.explosions.length ? 300 : 230);
  }
  async function animFall(s) {
    let maxDur = 0;
    const moved = [], landed = [];
    s.moves.forEach((m) => {
      const el = board.tiles.get(m.id);
      if (!el) return;
      const dur = 140 + Math.abs(m.toR - m.fromR) * 55;
      el.style.transition = `transform ${dur}ms cubic-bezier(.35,1.3,.55,1)`;
      placeTile(el, m.toR, m.c);
      moved.push(el); maxDur = Math.max(maxDur, dur);
      if (m.toR - m.fromR >= 2) landed.push(el);
    });
    s.spawns.forEach((sp) => {
      const el = makeTile({ id: sp.id, t: sp.t, s: sp.s });
      placeTile(el, sp.fromR, sp.c, true);
      const dur = 160 + (sp.toR - sp.fromR) * 55;
      el.style.transition = `transform ${dur}ms cubic-bezier(.35,1.3,.55,1)`;
      placeTile(el, sp.toR, sp.c);
      moved.push(el); maxDur = Math.max(maxDur, dur);
      if (sp.toR - sp.fromR >= 2) landed.push(el);
    });
    await wait(Math.min(maxDur, 620) + 20);
    moved.forEach((el) => { el.style.transition = ''; });
    // Сочный «шлёп» при приземлении после долгого падения — сжатие и пружинистое восстановление формы
    landed.forEach((el) => { const ti = el.querySelector('.ti'); if (!ti) return; ti.classList.remove('land'); void ti.offsetWidth; ti.classList.add('land'); setTimeout(() => ti.classList.remove('land'), 230); });
  }
  async function animCollect(s) {
    s.items.forEach((it) => {
      const el = board.tiles.get(it.id);
      board.tiles.delete(it.id);
      if (el) { el.classList.add('collect'); setTimeout(() => el.remove(), 460); }
      const sp = screenPt(it.r, it.c); sparks(sp.x, sp.y, '#ffd23f', 12);
    });
    Sound.goal(); haptic('success');
    updateGameHud();
    await wait(380);
  }
  async function animTransform(s) {
    s.tiles.forEach((t) => {
      const el = board.tiles.get(t.id);
      if (!el) return;
      styleTile(el, { t: t.t, s: t.s });
      el.classList.add('transform');
    });
    Sound.special(); haptic('heavy');
    await wait(420);
  }
  async function animShuffle(s) {
    showBanner('Перемешиваем!');
    s.tiles.forEach((t) => {
      const el = board.tiles.get(t.id);
      if (!el) return;
      styleTile(el, t);
      el.style.transition = 'transform .45s cubic-bezier(.4,1.3,.5,1)';
      placeTile(el, t.r, t.c);
    });
    Sound.booster();
    await wait(500);
    s.tiles.forEach((t) => { const el = board.tiles.get(t.id); if (el) el.style.transition = ''; });
  }
  async function playSteps(steps) {
    for (const s of steps) {
      if (!board.st) return;
      if (s.kind === 'swap') await animSwap(s, false);
      else if (s.kind === 'clear') await animClear(s);
      else if (s.kind === 'fall') await animFall(s);
      else if (s.kind === 'collect') await animCollect(s);
      else if (s.kind === 'transform') await animTransform(s);
      else if (s.kind === 'shuffle') await animShuffle(s);
    }
  }
  /* Сверка DOM с моделью после хода (страховка от любых рассинхронов) */
  function reconcileBoard() {
    const st = board.st;
    if (!st) return;
    const alive = new Set();
    for (let r = 0; r < st.size; r++) for (let c = 0; c < st.size; c++) {
      const t = st.tiles[r][c];
      if (!t) continue;
      alive.add(t.id);
      let el = board.tiles.get(t.id);
      if (!el) el = makeTile(t); else styleTile(el, t);
      placeTile(el, r, c, true);
    }
    board.tiles.forEach((el, id) => { if (!alive.has(id)) { el.remove(); board.tiles.delete(id); } });
  }

  /* ---------------- Ход игрока ---------------- */
  const canAct = () => board.st && !board.busy && !board.done && !paused && currentScreen === 'screenGame' && !anyModalOpen();
  async function runTurn(steps) {
    board.busy = true;
    board.turnCombo = 1;
    board.createdSpecial = false;
    try { await playSteps(steps); } catch (e) { console.error(e); }
    reconcileBoard();
    board.busy = false;
    afterTurn();
  }
  function collectTurnStats() {
    const st = board.st;
    if (!st) return;
    const dc = st.stats.cleared - board.snap.cleared, ds = st.stats.specials - board.snap.specials;
    board.snap.cleared = st.stats.cleared; board.snap.specials = st.stats.specials;
    if (dc > 0) { state.stats.totalCleared += dc; dailyStat('cleared', dc); }
    if (ds > 0) { state.stats.specialsMade += ds; dailyStat('specials', ds); }
    if (board.turnCombo >= 3) dailyStat('combo3', 1);
    state.stats.bestCombo = Math.max(state.stats.bestCombo, board.turnCombo);
    saveState();
  }
  function afterTurn() {
    collectTurnStats();
    updateGameHud();
    if (!board.done && E.isComplete(board.st)) { levelComplete(); return; }
    tutorialAfterTurn();
    scheduleHint();
  }
  async function doSwap(a, b) {
    if (!canAct()) return;
    clearSelection(); clearHint();
    const res = E.trySwap(board.st, a, b);
    if (!res.valid) {
      if (res.swapStep) { board.busy = true; await animSwap(res.swapStep, true); board.busy = false; }
      else if (res.reason === 'blocked') {
        Sound.nope(); haptic('error');
        const blockedLock = [a, b].some((p) => board.st.lock[p.r] && board.st.lock[p.r][p.c]);
        showToast(blockedLock ? '⛓️ Скованный фрукт нельзя двигать' : 'Так нельзя');
      }
      scheduleHint();
      return;
    }
    if (board.run) board.run.log.push({ k: 's', a: [a.r, a.c], b: [b.r, b.c] });
    await runTurn(res.steps);
  }
  async function doActivate(cell) {
    if (!canAct()) return;
    clearSelection(); clearHint();
    const res = E.activateSpecial(board.st, cell.r, cell.c);
    if (res.valid && board.run) board.run.log.push({ k: 't', r: cell.r, c: cell.c });
    if (res.valid) await runTurn(res.steps);
  }

  /* ---------------- Управление (свайп и тап) ---------------- */
  function cellFromEvent(ev) {
    const rect = board.el.getBoundingClientRect();
    const step = board.cell + board.gap;
    const c = Math.floor((ev.clientX - rect.left - board.pad) / step);
    const r = Math.floor((ev.clientY - rect.top - board.pad) / step);
    if (!board.st || r < 0 || c < 0 || r >= board.st.size || c >= board.st.size) return null;
    return { r, c };
  }
  let drag = null;
  board.el.addEventListener('pointerdown', (ev) => {
    ensureAudio();
    if (!canAct()) return;
    const cell = cellFromEvent(ev);
    if (!cell) return;
    drag = { cell, x: ev.clientX, y: ev.clientY, moved: false };
    try { board.el.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
  });
  board.el.addEventListener('pointermove', (ev) => {
    if (!drag || drag.moved) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    const th = Math.max(12, board.cell * 0.28);
    if (Math.abs(dx) < th && Math.abs(dy) < th) return;
    drag.moved = true;
    if (board.armed) return;
    const t = Math.abs(dx) > Math.abs(dy) ? { r: drag.cell.r, c: drag.cell.c + Math.sign(dx) } : { r: drag.cell.r + Math.sign(dy), c: drag.cell.c };
    doSwap(drag.cell, t);
  });
  const endDrag = (ev, cancel) => {
    if (drag && !drag.moved && !cancel) onTap(drag.cell);
    drag = null;
  };
  board.el.addEventListener('pointerup', (ev) => endDrag(ev, false));
  board.el.addEventListener('pointercancel', (ev) => endDrag(ev, true));

  function tileEl(cell) { const t = board.st.tiles[cell.r][cell.c]; return t ? board.tiles.get(t.id) : null; }
  function clearSelection() { if (board.selected) { const el = tileEl(board.selected); if (el) el.classList.remove('selected'); } board.selected = null; }
  function onTap(cell) {
    if (!canAct()) return;
    if (board.armed) { applyBoosterAt(cell); return; }
    const st = board.st, t = st.tiles[cell.r][cell.c];
    if (board.selected) {
      const s = board.selected;
      if (s.r === cell.r && s.c === cell.c) { clearSelection(); return; }
      if (Math.abs(s.r - cell.r) + Math.abs(s.c - cell.c) === 1) { doSwap(s, cell); return; }
      clearSelection();
    }
    if (t && t.s && !st.lock[cell.r][cell.c]) { doActivate(cell); return; }
    if (E.isMovable(st, cell.r, cell.c)) {
      board.selected = cell;
      const el = tileEl(cell); if (el) el.classList.add('selected');
      Sound.select(); haptic('select');
    } else if (st.lock[cell.r][cell.c]) { Sound.nope(); showToast('⛓️ Включи скованный фрукт в совпадение'); }
  }

  /* ---------------- Подсказка ---------------- */
  let hintTimer = null, hintEls = [];
  function clearHint() { clearTimeout(hintTimer); hintEls.forEach((el) => el.classList.remove('hint')); hintEls = []; }
  function scheduleHint() {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(showHint, board.level <= 3 ? 3500 : 6000);
  }
  function showHint() {
    if (!canAct()) { scheduleHint(); return; }
    const h = E.findHint(board.st, false);
    if (!h) return;
    const cells = h.tap ? [h.tap] : [h.a, h.b];
    hintEls = cells.map(tileEl).filter(Boolean);
    hintEls.forEach((el) => el.classList.add('hint'));
  }

  /* ---------------- Бустеры в игре ---------------- */
  function renderBoosterBar() {
    const bar = $('boosterBar');
    bar.innerHTML = BOOSTER_KEYS.map((k) => {
      const cnt = state.boosters[k] || 0;
      return `<button class="booster ${board.armed === k ? 'armed' : ''}" data-k="${k}" aria-label="${BOOSTERS[k].name}">${BOOSTERS[k].icon}<span class="b-count ${cnt ? '' : 'buy'}">${cnt || '+'}</span>${board.armed === k ? `<span class="booster-tip">Выбери клетку</span>` : ''}</button>`;
    }).join('');
    qsa('.booster', bar).forEach((b) => b.addEventListener('click', () => onBooster(b.dataset.k)));
  }
  async function onBooster(k) {
    if (!board.st || board.busy || board.done || paused || board.arena) return;
    ensureAudio();
    if (!(state.boosters[k] > 0)) {
      const ok = await confirmBox(`${BOOSTERS[k].icon} ${BOOSTERS[k].name}`, BOOSTERS[k].desc + '. Бустеры не тратят ходы!', `Купить за ${BOOSTERS[k].price} 🪙`);
      if (!ok || !trySpend('coins', BOOSTERS[k].price)) return;
      state.boosters[k] = (state.boosters[k] || 0) + 1; saveState(); Sound.coin(); renderBoosterBar();
      return;
    }
    clearSelection(); clearHint();
    if (k === 'shuffle') {
      consumeBooster(k);
      const res = E.useBooster(board.st, 'shuffle');
      if (board.run) board.run.log.push({ k: 'b', b: 'shuffle', r: 0, c: 0 });
      await runTurn(res.steps);
      return;
    }
    board.armed = board.armed === k ? null : k;
    Sound.select(); haptic('select');
    renderBoosterBar();
  }
  function consumeBooster(k) {
    state.boosters[k] = Math.max(0, (state.boosters[k] || 0) - 1);
    state.stats.boostersUsed++;
    dailyStat('boosters', 1);
    saveState(); scheduleSync();
    renderBoosterBar();
  }
  async function applyBoosterAt(cell) {
    const k = board.armed;
    const res = E.useBooster(board.st, k, cell.r, cell.c);
    if (!res.valid) { Sound.nope(); showToast('Сюда нельзя — выбери фрукт'); return; }
    board.armed = null;
    if (board.run) board.run.log.push({ k: 'b', b: k, r: cell.r, c: cell.c });
    consumeBooster(k);
    Sound.booster(); haptic('heavy');
    if (k === 'rocket') fxExplosion({ r: cell.r, c: cell.c, s: 'row' });
    else if (k === 'bomb') fxExplosion({ r: cell.r, c: cell.c, s: 'bomb2' });
    else if (k === 'rainbow') fxExplosion({ r: cell.r, c: cell.c, s: 'rainbow' });
    else { const sp = screenPt(cell.r, cell.c); sparks(sp.x, sp.y, '#fff', 14); }
    await runTurn(res.steps);
  }


  /* ---------------- Легендарные бустеры: ☢️ 🌪️ ⚡ ---------------- */
  function renderLegendaryBar() {
    const bar = $('legendaryBar');
    const owned = LEGENDARY_KEYS.filter((k) => state.legendary[k] > 0);
    bar.classList.toggle('hidden', !owned.length);
    if (!owned.length) return;
    bar.innerHTML = owned.map((k) => `<button class="legendary" data-k="${k}" style="--lc:${LEGENDARY[k].color}" aria-label="${esc(LEGENDARY[k].name)}">${LEGENDARY[k].icon}<span class="b-count">${state.legendary[k]}</span></button>`).join('');
    qsa('.legendary', bar).forEach((b) => b.addEventListener('click', () => onLegendary(b.dataset.k)));
  }
  async function onLegendary(k) {
    if (!board.st || board.busy || board.done || paused || board.arena || !(state.legendary[k] > 0)) return;
    const L = LEGENDARY[k];
    const ok = await confirmBox(`${L.icon} ${L.name}`, L.desc + `. Осталось: ${state.legendary[k]}. Бустеры не тратят ходы!`, 'Применить');
    if (!ok) return;
    ensureAudio(); clearSelection(); clearHint();
    board.busy = true;
    const res = E.useBooster(board.st, k);
    if (!res.valid) { board.busy = false; return; }
    if (board.run) board.run.log.push({ k: 'b', b: k, r: 0, c: 0 });
    state.legendary[k]--;
    state.stats.boostersUsed++;
    dailyStat('boosters', 1);
    saveState(); scheduleSync(); renderLegendaryBar();
    haptic('heavy');
    if (k === 'nuke') await fxNuke();
    else if (k === 'tornado') await fxTornado(res.lines);
    else if (k === 'lightning') await fxLightning(res.strikes);
    board.busy = false;
    await runTurn(res.steps);
  }
  async function fxNuke() {
    Sound.boom(); Sound.boom();
    board.el.classList.add('shake-big');
    const flash = document.createElement('div'); flash.className = 'fx-nuke-flash'; board.el.appendChild(flash);
    const cloud = document.createElement('div'); cloud.className = 'fx-nuke-cloud'; cloud.textContent = '☢️💥'; board.el.appendChild(cloud);
    const ring = document.createElement('div'); ring.className = 'fx-nuke-ring'; board.el.appendChild(ring);
    for (let i = 0; i < 22; i++) setTimeout(() => tone(70 + i * 4, 0.05, 'sawtooth', 0.06), i * 18);
    await wait(700);
    board.el.classList.remove('shake-big');
    [flash, cloud, ring].forEach((e) => e.remove());
  }
  async function fxTornado(lines) {
    const S = board.st.size, cs = board.cell;
    const el = document.createElement('div'); el.className = 'fx-tornado'; el.textContent = '🌪️';
    board.el.appendChild(el);
    board.el.classList.add('shake');
    Sound.zap();
    const horiz = lines[0].horiz;
    for (let step = 0; step <= 20; step++) {
      const t = step / 20;
      if (horiz) { el.style.left = (t * board.side - cs / 2) + 'px'; el.style.top = (cellPos(lines[Math.floor(t * lines.length) % lines.length].i, 0).y) + 'px'; }
      else { el.style.top = (t * board.side - cs / 2) + 'px'; el.style.left = (cellPos(0, lines[Math.floor(t * lines.length) % lines.length].i).x) + 'px'; }
      await wait(20);
    }
    el.remove();
  }
  async function fxLightning(strikes) {
    for (const s of strikes) {
      const p = screenPt(s.r, s.c);
      const bolt = document.createElement('div'); bolt.className = 'fx-bolt';
      bolt.style.left = (p.x - board.el.getBoundingClientRect().left) + 'px';
      bolt.style.height = (p.y - board.el.getBoundingClientRect().top) + 'px';
      board.el.appendChild(bolt);
      const ring = document.createElement('div'); const cs = board.cell * 2.2;
      ring.className = 'fx-ring'; ring.style.cssText += `left:${p.x - board.el.getBoundingClientRect().left - cs / 2}px;top:${p.y - board.el.getBoundingClientRect().top - cs / 2}px;width:${cs}px;height:${cs}px;border-color:#ffe066`;
      board.el.appendChild(ring);
      tone(1400, 0.05, 'square', 0.08);
      haptic('medium');
      board.el.classList.remove('shake'); void board.el.offsetWidth; board.el.classList.add('shake');
      await wait(120);
      bolt.remove();
      setTimeout(() => ring.remove(), 500);
    }
    await wait(150);
  }

  /* ---------------- Победа ---------------- */
  async function levelComplete() {
    board.done = true; board.busy = true;
    clearHint(); clearSelection(); hideCoach();
    Sound.goal(); haptic('success');
    showBanner('Цель выполнена!', true);
    await wait(1000);
    if (board.arena) { finishArena(); return; }
    const hasSpecial = () => board.st && board.st.tiles.some((row) => row.some((t) => t && t.s));
    if (hasSpecial()) {
      showBanner('ФРУКТОВЫЙ ВЗРЫВ!', true);
      await wait(600);
      for (let i = 0; i < 5 && board.st; i++) {
        const steps = E.detonateAll(board.st);
        if (!steps) break;
        await playSteps(steps);
      }
      collectTurnStats();
    }
    await wait(250);
    finishLevel();
  }
  let serverSettings = { maintenanceMode: false, doubleRewards: false, globalGift: null };
  let lastResult = null;
  function finishLevel() {
    const st = board.st, n = board.level;
    board.busy = false;
    if (!st) return;
    const stars = E.computeStars(st.moves, st.par);
    const prev = state.levelStars[n] || 0;
    const gained = Math.max(0, stars - prev);
    state.levelStars[n] = Math.max(prev, stars);
    state.starsBank += gained;
    const firstClear = n >= state.unlockedLevel;
    if (firstClear) state.unlockedLevel = n + 1;
    let coins = firstClear ? 20 + stars * 10 + Math.min(80, Math.floor(n * 1.2)) : 10 + stars * 5;
    if (serverSettings.doubleRewards) coins *= 2;
    if (MK() && MK().isVip()) coins = Math.round(coins * 1.5);
    addCoins(coins);
    state.stats.wins++;
    state.stats.bestScore = Math.max(state.stats.bestScore, st.score);
    if (stars === 3) state.stats.perfects++;
    dailyStat('wins', 1);
    if (gained) dailyStat('stars', gained);
    if (stars === 3) dailyStat('perfect', 1);
    if (state.unlockedLevel > 50 && !state.ownedTitles.legend) { state.ownedTitles.legend = true; if (state.titleAuto) state.equippedTitle = 'legend'; }
    saveNow();
    scheduleSync(400);
    const xp = addPassXp(firstClear ? 20 + stars * 5 : 10);
    track('lvl_win', { n, moves: st.moves, ms: Date.now() - (board.t0 || Date.now()), stars });
    lastResult = { n, stars, coins, gained, firstClear, moves: st.moves, par: st.par, score: st.score, xp };
    showResult(lastResult);
    if (MK() && board.run) MK().finishRun(board.run);
    board.run = null;
  }
  function showResult(r) {
    [1, 2, 3].forEach((i) => { $('rs' + i).className = 'rs' + (i === 2 ? ' rs-mid' : ''); });
    $('resultMoves').textContent = `Ходов: ${r.moves} · Очки: ${fmt(r.score)}`;
    const pills = [['🪙', '+' + r.coins + (serverSettings.doubleRewards ? ' (×2)' : '')]];
    if (r.gained) pills.push(['⭐', '+' + r.gained + ' в Сад']);
    if (r.xp) pills.push(['🎟️', '+' + r.xp + ' XP']);
    $('resultRewards').innerHTML = pills.map(([i, t], k) => `<div class="reward-pill" style="animation-delay:${0.9 + k * 0.15}s">${i} ${esc(t)}</div>`).join('');
    const note = $('resultNote');
    let noteText = '';
    const gBtn = $('btnResultGarden');
    gBtn.className = 'btn btn-ghost';
    if (!state.tips.garden) {
      noteText = '🌳 Открыт Волшебный Сад! Трать звёзды ⭐ на постройки и получай скины, рамки и сундуки.';
      state.tips.garden = true; state.tutorialDone = true; saveState();
      gBtn.className = 'btn btn-green';
    } else if (gardenCanBuild()) { noteText = '🏗️ Хватает звёзд на постройку в Саду!'; gBtn.className = 'btn btn-green'; }
    else if (r.firstClear && r.n % 5 === 0) noteText = '🎁 На карте открылся сундук!';
    note.classList.toggle('hidden', !noteText);
    note.textContent = noteText;
    openModal('modalResult');
    Sound.win();
    rainConfetti(60 + r.stars * 30);
    for (let i = 1; i <= r.stars; i++) {
      setTimeout(() => { $('rs' + i).classList.add('on'); Sound.star(i - 1); haptic('heavy'); const rc = $('rs' + i).getBoundingClientRect(); burstConfetti(rc.left + rc.width / 2, rc.top + rc.height / 2, 18); }, 300 + i * 320);
    }
  }
  $('btnNext').addEventListener('click', () => {
    closeModal('modalResult');
    const next = (lastResult ? lastResult.n : state.unlockedLevel - 1) + 1;
    board.st = null;
    showScreen('screenMap');
    openIntro(Math.min(next, state.unlockedLevel));
  });
  $('btnResultGarden').addEventListener('click', () => { closeModal('modalResult'); board.st = null; showScreen('screenGarden'); });
  $('btnResultRetry').addEventListener('click', () => { closeModal('modalResult'); const n = lastResult ? lastResult.n : board.level; board.st = null; showScreen('screenMap'); openIntro(n); });
  $('btnResultShare').addEventListener('click', () => shareLevel(lastResult));

  /* ---------------- Пауза / выход ---------------- */
  function openPause() {
    if (!board.st || board.done || board.busy) return;
    paused = true; clearHint();
    const costs = board.st.moves > 0 && !hasInfiniteLives();
    $('pauseInfo').textContent = board.arena ? 'Попытка будет засчитана как использованная' : costs ? 'Выход или перезапуск будет стоить 1 ❤️' : 'Жизнь не тратится, пока вы не сделали ход';
    $('btnRestart').classList.toggle('hidden', !!board.arena);
    $('btnPauseSound').textContent = state.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл';
    openModal('modalPause');
  }
  $('btnPause').addEventListener('click', openPause);
  $('btnResume').addEventListener('click', () => { closeModal('modalPause'); paused = false; scheduleHint(); });
  $('btnPauseSound').addEventListener('click', () => { state.sound = !state.sound; saveState(); $('btnPauseSound').textContent = state.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл'; });
  function leaveLevel() {
    if (board.arena) { board.st = null; board.run = null; $('screenGame').classList.remove('arena-mode'); board.arena = null; }
    else {
      if (board.st && !board.done) track('lvl_quit', { n: board.level, moves: board.st.moves });
      if (board.st && board.st.moves > 0 && !board.done) loseLife();
    }
    board.st = null; paused = false; clearHint();
    closeModal('modalPause');
  }
  $('btnRestart').addEventListener('click', () => { const n = board.level; leaveLevel(); showScreen('screenMap'); openIntro(n); });
  $('btnQuit').addEventListener('click', () => { const wasArena = !!board.arena; leaveLevel(); if (wasArena) openArena(); else showScreen('screenMap'); });

  /* ============================================================
     10. ВОЛШЕБНЫЙ САД (главная цель игры: звёзды → постройки → награды)
     ============================================================ */
  let freshSlot = -1;
  function renderGarden() {
    $('gardenStars').textContent = state.starsBank;
    const gi = state.garden.area, area = gardenArea(gi);
    const built = state.garden.built;
    const body = $('gardenBody');
    const th = GARDEN_THEMES[gi % GARDEN_THEMES.length];
    const slots = area.items.map((it, i) => {
      const [x, y] = SLOT_POS[i % SLOT_POS.length];
      const isBuilt = built.includes(i);
      const can = !isBuilt && state.starsBank >= it[2];
      const cls = isBuilt ? 'built' : 'todo' + (can ? ' can' : '');
      return `<button class="g-slot ${cls}${i === freshSlot ? ' fresh' : ''}" style="left:${x}%;top:${y}%;z-index:${Math.round(y)}" ${isBuilt ? 'disabled' : `data-build="${i}"`}>
        <span class="g-shadow"></span><span class="g-emo">${it[0]}</span>${isBuilt ? '' : `<span class="g-cost">${can ? '🔨' : '⭐'}${it[2]}</span>`}</button>`;
    }).join('');
    const deco = [[8, 90], [92, 88], [50, 95], [6, 70], [94, 72]].map(([x, y], k) => `<span class="g-deco" style="left:${x}%;top:${y}%">${th.deco[k % th.deco.length]}</span>`).join('');
    const stars = th.night ? Array.from({ length: 14 }, (_, k) => `<i class="g-star" style="left:${(k * 37) % 100}%;top:${(k * 23) % 45}%;animation-delay:${(k % 5) * .4}s"></i>`).join('') : '';
    const scene = `<div class="garden-scene${th.night ? ' night' : ''}" style="background:linear-gradient(180deg, ${th.sky[0]}, ${th.sky[1]})">
        ${stars}<span class="garden-sun">${th.sun}</span><span class="garden-cloud c1">☁️</span><span class="garden-cloud c2">☁️</span>
        <svg class="g-hills" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 52 Q18 36 36 48 T70 44 T100 46 V100 H0Z" fill="${th.far}"/>
          <path d="M0 52 Q18 36 36 48 T70 44 T100 46" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".8"/>
          <path d="M0 70 Q25 58 50 66 T100 64 V100 H0Z" fill="${th.near}"/>
          <path d="M0 70 Q25 58 50 66 T100 64" fill="none" stroke="rgba(255,255,255,.3)" stroke-width=".8"/>
        </svg>${deco}${slots}
      </div>`;
    const tasks = area.items.map((it, i) => {
      const isBuilt = built.includes(i);
      const can = state.starsBank >= it[2];
      return `<div class="task ${isBuilt ? 'done' : ''}"><span class="t-ico">${it[0]}</span><span class="t-name">${esc(it[1])}<small>${isBuilt ? 'Построено' : 'Стоимость: ⭐' + it[2]}</small></span>${isBuilt ? '<span class="t-done">✓</span>' : `<button class="btn ${can ? 'btn-green' : 'btn-ghost'}" data-build="${i}">${can ? 'Построить' : '⭐' + it[2]}</button>`}</div>`;
    }).join('');
    const doneAreas = [];
    for (let i = 0; i < gi; i++) doneAreas.push(`<span class="chip">✅ ${esc(gardenArea(i).name)}</span>`);
    body.innerHTML = `
      <div class="garden-head"><div style="flex:1"><span class="g-num">Область ${gi + 1}</span><b>${esc(area.name)}</b>
        <div class="progress"><div class="progress-fill" style="width:${built.length / area.items.length * 100}%"></div></div></div>
        <span class="chip">${built.length}/${area.items.length}</span></div>
      ${scene}
      <div class="garden-reward">🎁 <span>Награда за область: <b>${esc(rewardText(area.reward))}</b></span></div>
      <p class="section-label">Постройки</p>${tasks}
      <p class="muted tiny" style="margin-top:12px">⭐ Звёзды дают за уровни: чем меньше ходов, тем больше звёзд. Можно перепроходить уровни ради ⭐⭐⭐!</p>
      ${doneAreas.length ? `<p class="section-label">Завершённые области</p><div class="areas-done">${doneAreas.join('')}</div>` : ''}`;
    qsa('[data-build]', body).forEach((b) => b.addEventListener('click', () => buildGarden(+b.dataset.build)));
    freshSlot = -1;
  }
  async function buildGarden(i) {
    const area = gardenArea(state.garden.area), it = area.items[i];
    if (!it || state.garden.built.includes(i)) return;
    if (state.starsBank < it[2]) {
      Sound.nope(); haptic('warning');
      const ok = await confirmBox('Не хватает звёзд', `Нужно ещё ⭐${it[2] - state.starsBank}. Проходи уровни — за каждый дают до 3 звёзд!`, '▶ Играть');
      if (ok) { showScreen('screenMap'); openIntro(state.unlockedLevel); }
      return;
    }
    state.starsBank -= it[2];
    state.garden.built.push(i);
    state.stats.gardenBuilt++;
    dailyStat('build', 1);
    saveNow(); scheduleSync();
    freshSlot = i;
    Sound.build(); haptic('success');
    renderGarden();
    const slot = qsa('.g-slot')[i];
    if (slot) { const r = slot.getBoundingClientRect(); burstConfetti(r.left + r.width / 2, r.top + r.height / 2, 40); }
    updateBadges();
    if (state.garden.built.length >= area.items.length) {
      await wait(900);
      const rw = Object.assign({}, area.reward);
      const chest = rw.chest; delete rw.chest;
      state.garden.area++; state.garden.built = []; state.garden.areasDone = (state.garden.areasDone || 0) + 1;
      saveNow();
      rainConfetti(120);
      await showReward(rw, { title: 'Область завершена!', sub: area.name + ' полностью построена 🎉', icon: '🏆' });
      if (chest) await showReward(rollChest(chest), { title: CHESTS[chest].name, icon: CHESTS[chest].icon, chest: true });
      renderGarden();
    }
  }

  /* ============================================================
     11. МАГАЗИН
     ============================================================ */
  const SHOP_TABS = [['stars', '⭐ Донат'], ['hits', '🔥 Хиты'], ['boosters', '🚀 Бустеры'], ['lives', '❤️ Жизни'], ['chests', '🎁 Сундуки'], ['skins', '🎨 Скины'], ['profile', '👑 Профиль'], ['currency', '💱 Обмен']];
  let shopTab = 'hits';
  function renderShop() {
    $('shopTabs').innerHTML = SHOP_TABS.map(([k, n]) => `<button class="tab ${k === shopTab ? 'active' : ''}" data-st="${k}">${n}</button>`).join('');
    qsa('[data-st]', $('shopTabs')).forEach((b) => b.addEventListener('click', () => { shopTab = b.dataset.st; Sound.select(); renderShop(); }));
    const body = $('shopBody');
    body.innerHTML = '';
    body.scrollTop = 0;
    ({ stars: (b) => (MK() ? MK().renderStarsShop(b) : null), hits: shopHits, boosters: shopBoosters, lives: shopLives, chests: shopChests, skins: shopSkins, profile: shopProfile, currency: shopCurrency })[shopTab](body);
  }
  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function grid(body) { const g = document.createElement('div'); g.className = 'shop-grid'; body.appendChild(g); return g; }
  function label(body, text) { body.appendChild(el(`<p class="section-label">${text}</p>`)); }
  function product(parent, o) {
    const card = el(`<div class="product ${o.cls || ''}">${o.tag ? `<span class="p-tag">${o.tag}</span>` : ''}${o.own ? `<span class="p-own">${o.own}</span>` : ''}
      <div class="p-ico">${o.icon}</div><div class="p-name">${esc(o.name)}</div><div class="p-desc">${o.desc || ''}</div>
      <button class="btn ${o.btnCls || (o.currency === 'gems' ? 'btn-primary' : 'btn-gold')}" ${o.disabled ? 'disabled' : ''}>${o.btn || (o.price + (o.currency === 'gems' ? ' 💎' : ' 🪙'))}</button></div>`);
    card.querySelector('button').addEventListener('click', o.onClick);
    parent.appendChild(card);
    return card;
  }
  function buyAndGive(price, currency, rw, title) {
    if (!trySpend(currency, price)) return;
    applyReward(rw);
    Sound.coin(); haptic('success');
    showToast('✅ ' + (title || 'Покупка совершена') + ': ' + rewardText(rw));
    renderShop(); updateBadges();
  }
  function shopHits(body) {
    const ready = giftReady();
    const g = el(`<div class="hero-deal green"><span class="h-ico">🎁</span><div class="h-text"><b>Бесплатный подарок</b><small>${ready ? 'Каждые 4 часа — заходи почаще!' : 'Следующий через ' + mmss(4 * 3600000 - (Date.now() - state.freeGiftLast))}</small></div><button class="btn ${ready ? 'btn-gold' : 'btn-ghost'}" ${ready ? '' : 'disabled'}>${ready ? 'Забрать' : '⏳'}</button></div>`);
    g.querySelector('button').addEventListener('click', claimFreeGift);
    body.appendChild(g);
    if (!state.starterBought) {
      const s = el(`<div class="hero-deal pink"><span class="h-ico">🚀</span><div class="h-text"><b>Стартовый набор</b><small>2000🪙 + по 3 каждого бустера + неоновая рамка</small></div><button class="btn btn-gold">49 💎</button></div>`);
      s.querySelector('button').addEventListener('click', () => {
        if (!trySpend('gems', 49)) return;
        state.starterBought = true;
        const rw = { coins: 2000, boosters: {}, frame: 'neon' };
        BOOSTER_KEYS.forEach((k) => { rw.boosters[k] = 3; });
        showReward(rw, { title: 'Стартовый набор!', icon: '🚀' }).then(renderShop);
      });
      body.appendChild(s);
    }
    const today = dayKey();
    const rng = E.mulberry32(hashStr('deal' + today));
    const k1 = BOOSTER_KEYS[Math.floor(rng() * 5)], k2 = BOOSTER_KEYS[Math.floor(rng() * 5)];
    const deal = { coins: 300 + Math.floor(rng() * 4) * 100, boosters: {} };
    deal.boosters[k1] = (deal.boosters[k1] || 0) + 3; deal.boosters[k2] = (deal.boosters[k2] || 0) + 2;
    const bought = state.dealDay === today;
    const d = el(`<div class="hero-deal gold"><span class="h-ico">⚡</span><div class="h-text"><b>Предложение дня −50%</b><small>${esc(rewardText(deal))}</small></div><button class="btn ${bought ? 'btn-ghost' : 'btn-primary'}" ${bought ? 'disabled' : ''}>${bought ? 'Куплено' : '<span class="old-price">30</span>15 💎'}</button></div>`);
    d.querySelector('button').addEventListener('click', () => { if (!trySpend('gems', 15)) return; state.dealDay = today; showReward(deal, { title: 'Предложение дня', icon: '⚡' }).then(renderShop); });
    body.appendChild(d);
    label(body, 'Популярное');
    const gr = grid(body);
    product(gr, { icon: '❤️', name: 'Все жизни', desc: 'Восполнить до 10', price: 250, currency: 'coins', onClick: () => buyAndGive(250, 'coins', { lives: 1 }, 'Жизни') });
    product(gr, { icon: '🔨🚀', name: 'Набор героя', desc: '3 молота + 3 ракеты', price: 700, currency: 'coins', tag: 'ХИТ', onClick: () => buyAndGive(700, 'coins', { boosters: { hammer: 3, rocket: 3 } }) });
    product(gr, { icon: '🧰', name: CHESTS.big.name, desc: '5 случайных наград', price: 25, currency: 'gems', onClick: () => buyChest('big', 25, 'gems') });
    product(gr, { icon: '♾️', name: 'Бесконечные жизни', desc: '2 часа без ограничений', price: 35, currency: 'gems', onClick: () => buyAndGive(35, 'gems', { infiniteMin: 120 }, 'Жизни') });
  }
  function claimFreeGift() {
    if (!giftReady()) return;
    state.freeGiftLast = Date.now();
    const rw = { coins: 60 + Math.floor(Math.random() * 10) * 10 };
    if (Math.random() < 0.35) { const k = BOOSTER_KEYS[Math.floor(Math.random() * 5)]; rw.boosters = { [k]: 1 }; }
    saveState();
    showReward(rw, { title: 'Бесплатный подарок', icon: '🎁' }).then(() => { if (currentScreen === 'screenShop') renderShop(); });
  }
  function shopBoosters(body) {
    label(body, 'Бустеры не тратят ходы — используй смело!');
    const gr = grid(body);
    BOOSTER_KEYS.forEach((k) => {
      const b = BOOSTERS[k];
      product(gr, { icon: b.icon, name: b.name + ' ×1', desc: b.desc, own: 'есть: ' + (state.boosters[k] || 0), price: b.price, currency: 'coins', onClick: () => buyAndGive(b.price, 'coins', { boosters: { [k]: 1 } }) });
      product(gr, { icon: b.icon + '×5', name: b.name + ' ×5', desc: 'Выгода 20%', tag: '−20%', price: b.price * 4, currency: 'coins', onClick: () => buyAndGive(b.price * 4, 'coins', { boosters: { [k]: 5 } }) });
    });
    label(body, 'Наборы за кристаллы');
    const g2 = grid(body);
    const all2 = { boosters: {} }; BOOSTER_KEYS.forEach((k) => { all2.boosters[k] = 2; });
    const all5 = { boosters: {} }; BOOSTER_KEYS.forEach((k) => { all5.boosters[k] = 5; });
    product(g2, { icon: '🎒', name: 'Все по 2', desc: '10 бустеров', price: 20, currency: 'gems', onClick: () => buyAndGive(20, 'gems', all2) });
    product(g2, { icon: '💼', name: 'Все по 5', desc: '25 бустеров', price: 45, currency: 'gems', tag: 'ВЫГОДА', onClick: () => buyAndGive(45, 'gems', all5) });
  }
  function shopLives(body) {
    label(body, `Жизни: ${hasInfiniteLives() ? '∞' : state.lives + '/' + MAX_LIVES} · +1 каждые 3 минуты`);
    const gr = grid(body);
    product(gr, { icon: '❤️', name: 'Все жизни', desc: 'Восполнить до 10', price: 250, currency: 'coins', onClick: () => buyAndGive(250, 'coins', { lives: 1 }, 'Жизни') });
    product(gr, { icon: '❤️‍🔥', name: 'Все жизни', desc: 'Восполнить до 10', price: 6, currency: 'gems', onClick: () => buyAndGive(6, 'gems', { lives: 1 }, 'Жизни') });
    product(gr, { icon: '♾️', name: '30 минут', desc: 'Бесконечные жизни', price: 12, currency: 'gems', onClick: () => buyAndGive(12, 'gems', { infiniteMin: 30 }, 'Жизни') });
    product(gr, { icon: '♾️', name: '2 часа', desc: 'Бесконечные жизни', price: 35, currency: 'gems', onClick: () => buyAndGive(35, 'gems', { infiniteMin: 120 }, 'Жизни') });
    product(gr, { icon: '🌙', name: '24 часа', desc: 'Играй весь день', price: 99, currency: 'gems', tag: 'МАКС', onClick: () => buyAndGive(99, 'gems', { infiniteMin: 1440 }, 'Жизни') });
  }
  function buyChest(tier, price, currency) {
    if (!trySpend(currency, price)) return;
    showReward(rollChest(tier), { title: CHESTS[tier].name, icon: CHESTS[tier].icon, chest: true }).then(() => renderShop());
  }
  function shopChests(body) {
    label(body, 'Случайные монеты, кристаллы и бустеры');
    const gr = grid(body);
    product(gr, { icon: '🎁', name: CHESTS.small.name, desc: '3 награды', price: 600, currency: 'coins', onClick: () => buyChest('small', 600, 'coins') });
    product(gr, { icon: '🧰', name: CHESTS.big.name, desc: '5 наград ×2', price: 25, currency: 'gems', onClick: () => buyChest('big', 25, 'gems') });
    product(gr, { icon: '👑', name: CHESTS.legend.name, desc: '8 наград ×3 + шанс ♾️ жизней', price: 70, currency: 'gems', tag: 'ТОП', onClick: () => buyChest('legend', 70, 'gems') });
  }
  function ownedCard(parent, kind, key, def, owned, equipped, preview) {
    let btn, btnCls, onClick;
    if (equipped) { btn = '✓ Выбрано'; btnCls = 'btn-ghost'; onClick = () => {}; }
    else if (owned) { btn = 'Выбрать'; btnCls = 'btn-green'; onClick = () => equip(kind, key); }
    else if (def.unlock && !def.price && !def.gems) { btn = '🔒'; btnCls = 'btn-ghost'; onClick = () => showToast('Открывается: ' + def.unlock); }
    else {
      const cur = def.gems ? 'gems' : 'coins', price = def.gems || def.price;
      btn = price + (cur === 'gems' ? ' 💎' : ' 🪙'); btnCls = cur === 'gems' ? 'btn-primary' : 'btn-gold';
      onClick = () => { if (!trySpend(cur, price)) return; ({ skin: state.ownedSkins, frame: state.ownedFrames, title: state.ownedTitles })[kind][key] = true; equip(kind, key); Sound.win(); rainConfetti(40); };
    }
    product(parent, { icon: preview, name: def.name, desc: def.unlock && !owned ? '🔓 ' + def.unlock : '', btn, btnCls, onClick, cls: kind === 'skin' ? 'skin-preview' : '' });
  }
  function equip(kind, key) {
    if (kind === 'skin') state.equippedSkin = key;
    if (kind === 'frame') state.equippedFrame = key;
    if (kind === 'title') { state.equippedTitle = key; state.titleAuto = false; }
    saveState(); Sound.select(); haptic('select'); renderShop();
    showToast('Применено!');
  }
  function shopSkins(body) {
    label(body, 'Внешний вид фишек на поле');
    const gr = grid(body);
    Object.keys(SKINS).forEach((k) => ownedCard(gr, 'skin', k, SKINS[k], !!state.ownedSkins[k], state.equippedSkin === k, SKINS[k].emojis.map((e) => `<span>${e}</span>`).join('')));
  }
  function shopProfile(body) {
    label(body, 'Рамки аватара');
    const gr = grid(body);
    Object.keys(FRAMES).forEach((k) => ownedCard(gr, 'frame', k, FRAMES[k], !!state.ownedFrames[k], state.equippedFrame === k, `<span class="avatar frame-${k}" style="width:42px;height:42px;font-size:18px">${avatarHtml()}</span>`));
    label(body, 'Звания');
    const g2 = grid(body);
    Object.keys(TITLES).forEach((k) => ownedCard(g2, 'title', k, TITLES[k], !!state.ownedTitles[k], state.equippedTitle === k, TITLES[k].icon));
  }
  function shopCurrency(body) {
    label(body, 'Кристаллы → монеты');
    const gr = grid(body);
    [[10, 700], [30, 2400], [80, 7000]].forEach(([g, c], i) => product(gr, { icon: '🪙'.repeat(i + 1), name: fmt(c) + ' монет', desc: 'Обмен', price: g, currency: 'gems', tag: i === 2 ? '+25%' : '', onClick: () => buyAndGive(g, 'gems', { coins: c }, 'Обмен') }));
    label(body, 'Монеты → кристаллы');
    const g2 = grid(body);
    [[2000, 10], [9000, 50]].forEach(([c, g], i) => product(g2, { icon: '💎'.repeat(i + 1), name: g + ' кристаллов', desc: 'Обмен', price: c, currency: 'coins', onClick: () => buyAndGive(c, 'coins', { gems: g }, 'Обмен') }));
    body.appendChild(el(`<p class="muted tiny" style="margin-top:14px">💎 Кристаллы также дают Колесо Фортуны, задания, достижения, сундуки и Сад.</p>`));
  }

  /* ============================================================
     12. ЗАДАНИЯ, ВХОД, ДОСТИЖЕНИЯ
     ============================================================ */
  function ensureDaily() {
    const today = dayKey();
    if (state.daily && state.daily.date === today && Array.isArray(state.daily.quests)) return;
    const rng = E.mulberry32(hashStr(today + ':' + playerId));
    const pool = QUEST_POOL.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const picked = [];
    const stats = new Set();
    for (const q of pool) { if (picked.length >= 3) break; if (stats.has(q.stat)) continue; stats.add(q.stat); picked.push(q.id); }
    state.daily = { date: today, quests: picked, progress: {}, claimed: {}, bonus: false };
    saveState();
  }
  function dailyStat(stat, n) { ensureDaily(); state.daily.progress[stat] = (state.daily.progress[stat] || 0) + n; }
  function achLevel(a) { const v = a.stat(); let t = 0; while (t < a.tiers.length && v >= a.tiers[t]) t++; return t; }
  const achTierReady = (a) => achLevel(a) > (state.achClaimed[a.id] || 0);
  let questTab = 'daily';
  qsa('[data-qtab]').forEach((b) => b.addEventListener('click', () => { questTab = b.dataset.qtab; qsa('[data-qtab]').forEach((x) => x.classList.toggle('active', x === b)); Sound.select(); renderQuests(); }));
  function renderQuests() {
    ensureDaily();
    const body = $('questBody');
    body.innerHTML = '';
    if (questTab === 'daily') {
      if (!channelDone()) {
        const ch = el(`<div class="hero-deal channel-deal"><span class="h-ico">📢</span><div class="h-text"><b>Разовое задание: подпишись на канал</b><small>Новости и промокоды · 💎20 + 🪙1000</small></div><button class="btn btn-gold">Выполнить</button></div>`);
        ch.querySelector('button').addEventListener('click', openChannel);
        body.appendChild(ch);
      }
      state.daily.quests.forEach((id) => {
        const q = QUEST_POOL.find((x) => x.id === id);
        if (!q) return;
        const v = Math.min(q.target, state.daily.progress[q.stat] || 0), done = v >= q.target, claimed = !!state.daily.claimed[id];
        const card = el(`<div class="quest ${claimed ? 'claimed' : ''}"><div class="quest-top"><span class="q-ico">${q.icon}</span><span class="q-text">${esc(q.text)}<small>${esc(rewardText(q.reward))}</small></span>
          ${claimed ? '<span class="t-done">✓</span>' : done ? '<button class="btn btn-gold">Забрать</button>' : `<span class="q-count">${v}/${q.target}</span>`}</div>
          <div class="progress"><div class="progress-fill" style="width:${v / q.target * 100}%"></div></div></div>`);
        const btn = card.querySelector('button');
        if (btn) btn.addEventListener('click', () => { state.daily.claimed[id] = true; addPassXp(30); saveState(); showReward(q.reward, { title: 'Задание выполнено!', icon: q.icon }).then(renderQuests); });
        body.appendChild(card);
      });
      const allClaimed = state.daily.quests.every((id) => state.daily.claimed[id]);
      const bonus = el(`<div class="hero-deal pink"><span class="h-ico">🧰</span><div class="h-text"><b>Бонус за все задания</b><small>Большой сундук · новые задания завтра</small></div><button class="btn ${allClaimed && !state.daily.bonus ? 'btn-gold' : 'btn-ghost'}" ${allClaimed && !state.daily.bonus ? '' : 'disabled'}>${state.daily.bonus ? '✓' : 'Открыть'}</button></div>`);
      bonus.querySelector('button').addEventListener('click', () => { state.daily.bonus = true; addPassXp(60); saveState(); showReward(rollChest('big'), { title: 'Бонус дня!', icon: '🧰', chest: true }).then(renderQuests); });
      body.appendChild(bonus);
    } else if (questTab === 'login') {
      const ready = loginReady();
      const yest = dayKey(new Date(Date.now() - 864e5));
      const nextDay = state.login.last === yest ? (state.login.streak % 7) + 1 : 1;
      const got = ready ? nextDay - 1 : state.login.streak;
      body.appendChild(el(`<p class="muted" style="text-align:center;margin:4px 0 12px">Заходи каждый день — награды растут! Пропуск дня сбрасывает серию.</p>`));
      const g = el('<div class="login-grid"></div>');
      LOGIN_REWARDS.forEach((rw, i) => {
        const day = i + 1, it = rewardItems(rw)[0];
        const cls = day <= got ? 'got' : (ready && day === nextDay ? 'today' : '');
        g.appendChild(el(`<div class="login-day ${cls} ${day === 7 ? 'big' : ''}"><span>День ${day}</span><span class="ld-ico">${day === 7 ? '👑' : it[0]}</span><span>${esc(day === 7 ? rewardText(rw) : it[1])}</span></div>`));
      });
      body.appendChild(g);
      const b = el(`<button class="btn ${ready ? 'btn-gold' : 'btn-ghost'} btn-big" ${ready ? '' : 'disabled'}>${ready ? 'Забрать награду дня' : 'Возвращайся завтра 👋'}</button>`);
      b.addEventListener('click', claimLogin);
      body.appendChild(b);
    } else {
      ACHIEVEMENTS.forEach((a) => {
        const lvl = achLevel(a), claimed = state.achClaimed[a.id] || 0, ready = lvl > claimed;
        const nextTier = a.tiers[Math.min(claimed, a.tiers.length - 1)];
        const v = a.stat(), maxed = claimed >= a.tiers.length;
        const card = el(`<div class="quest"><div class="quest-top"><span class="q-ico">${a.icon}</span><span class="q-text">${esc(a.name)}<small>${maxed ? 'Максимальный уровень!' : `Цель: ${fmt(nextTier)} · награда 💎${ACH_GEMS[claimed]}`}</small></span>
          ${ready ? '<button class="btn btn-gold">Забрать</button>' : `<span class="q-count">${fmt(v)}</span>`}</div>
          <div class="ach-tiers">${a.tiers.map((_, i) => `<i class="${i < claimed ? 'on' : ''}"></i>`).join('')}</div></div>`);
        const btn = card.querySelector('button');
        if (btn) btn.addEventListener('click', () => { const tier = state.achClaimed[a.id] || 0; state.achClaimed[a.id] = tier + 1; saveState(); showReward({ gems: ACH_GEMS[tier] }, { title: a.name, sub: 'Достижение уровня ' + (tier + 1), icon: a.icon }).then(renderQuests); });
        body.appendChild(card);
      });
    }
    updateBadges();
  }
  function claimLogin() {
    if (!loginReady()) return;
    const yest = dayKey(new Date(Date.now() - 864e5));
    state.login.streak = state.login.last === yest ? (state.login.streak % 7) + 1 : 1;
    state.login.last = dayKey();
    addPassXp(20);
    saveState();
    showReward(LOGIN_REWARDS[state.login.streak - 1], { title: 'Награда дня ' + state.login.streak, icon: state.login.streak === 7 ? '👑' : '📅' }).then(() => { if (currentScreen === 'screenQuests') renderQuests(); });
  }

  /* ============================================================
     13. КОЛЕСО ФОРТУНЫ
     ============================================================ */
  let wheelRot = 0, spinning = false;
  function renderWheel() {
    const w = $('wheel'), seg = 360 / WHEEL.length;
    w.style.background = `conic-gradient(${WHEEL.map((s, i) => `${s.col} ${i * seg}deg ${(i + 1) * seg}deg`).join(', ')})`;
    w.innerHTML = WHEEL.map((s, i) => { const it = rewardItems(s.r)[0]; return `<div class="wheel-label" style="transform:rotate(${i * seg + seg / 2}deg)"><span><em>${it[0]}</em>${esc(it[1])}</span></div>`; }).join('');
    const ready = wheelReady();
    $('wheelSub').textContent = ready ? 'Бесплатное вращение доступно!' : 'Бесплатно через ' + mmss(24 * 3600000 - (Date.now() - state.wheelLast));
    $('btnSpin').textContent = ready ? '🎡 Крутить бесплатно' : 'Крутить за 10 💎';
  }
  function openWheel() { renderWheel(); openModal('modalWheel'); }
  $('btnSpin').addEventListener('click', async () => {
    if (spinning) return;
    ensureAudio();
    const free = wheelReady();
    if (!free && !trySpend('gems', 10)) return;
    if (free) state.wheelLast = Date.now();
    saveState();
    spinning = true;
    $('btnSpin').disabled = true;
    const total = WHEEL.reduce((a, s) => a + s.w, 0);
    let x = Math.random() * total, idx = 0;
    for (; idx < WHEEL.length - 1; idx++) { x -= WHEEL[idx].w; if (x < 0) break; }
    const seg = 360 / WHEEL.length;
    wheelRot = wheelRot - (wheelRot % 360) + 360 * 6 + (360 - (idx * seg + seg / 2));
    $('wheel').style.transform = `rotate(${wheelRot}deg)`;
    haptic('medium');
    for (let i = 0; i < 18; i++) setTimeout(() => { tone(900 + i * 20, 0.03, 'square', 0.05); }, i * i * 12);
    await wait(4400);
    spinning = false;
    $('btnSpin').disabled = false;
    closeModal('modalWheel');
    await showReward(WHEEL[idx].r, { title: 'Колесо Фортуны', icon: '🎡' });
    updateBadges();
    if (currentScreen === 'screenHome') renderHome();
  });

  /* ============================================================
     14. РЕЙТИНГ
     ============================================================ */
  /* ============================================================
     14f. АРЕНА: 🔥 Испытание дня и ⚔️ Дуэли
     ============================================================ */
  let arenaTab = 'daily', arenaDaily = null, arenaDuels = null, arenaBusy = false;
  function leftShortArena(ms) { return ms <= 0 ? 'скоро обновится' : leftShort(ms); }
  async function openArena() {
    Sound.click();
    showScreen('screenArena');
    track('arena_open');
    renderArenaTabs();
    await refreshArena();
  }
  $('arenaTeaser').addEventListener('click', openArena);
  function renderArenaTabs() {
    $('arenaTabs').innerHTML = `<button class="tab ${arenaTab === 'daily' ? 'active' : ''}" data-atab2="daily">🔥 Испытание дня</button><button class="tab ${arenaTab === 'duels' ? 'active' : ''}" data-atab2="duels">⚔️ Дуэли</button>`;
    qsa('[data-atab2]', $('arenaTabs')).forEach((b) => b.addEventListener('click', () => { arenaTab = b.dataset.atab2; Sound.select(); renderArenaTabs(); renderArenaBody(); }));
  }
  async function refreshArena() {
    if (playerId === 'guest') { $('arenaBody').innerHTML = '<p class="empty">Арена доступна внутри Telegram 🙂</p>'; return; }
    const [d, u] = await Promise.all([api('/api/arena/daily?' + userQS()), api('/api/arena/duels?' + userQS())]);
    if (d.ok) arenaDaily = d.data;
    if (u.ok) arenaDuels = u.data.duels;
    updateArenaDot();
    renderArenaBody();
  }
  function updateArenaDot() {
    const incoming = (arenaDuels || []).filter((d) => d.status === 'pending' && d.mine === 'b').length;
    const toPlay = (arenaDuels || []).filter((d) => d.canPlay).length;
    const n = incoming + toPlay + ((arenaDaily && arenaDaily.attemptsLeft > 0 && !arenaDaily.best) ? 0 : 0);
    $('dotArena').classList.toggle('hidden', !(incoming + toPlay));
    $('arenaTeaserSub').textContent = incoming ? `⚔️ ${incoming} нов. вызов${incoming > 1 ? 'а' : ''}!` : arenaDaily && arenaDaily.best ? `🔥 Твой рекорд: ${arenaDaily.best.moves} ход.` : 'Испытание дня и дуэли с друзьями';
  }
  function renderArenaBody() {
    const body = $('arenaBody');
    if (arenaTab === 'daily') {
      if (!arenaDaily) { body.innerHTML = '<p class="empty">Загрузка...</p>'; return; }
      const D = arenaDaily, mine = D.top.find((x) => x.uid === playerId);
      const podium = D.top.slice(0, 3);
      body.innerHTML = `
        <div class="arena-hero"><span class="arena-hero-ico">🔥</span><div><b>Испытание дня</b><small>Один уровень для всех · обновится через ${leftShortArena(D.endsAt - Date.now())}</small></div></div>
        ${D.best ? `<div class="arena-best">Ваш лучший результат: <b>${D.best.moves} ход.</b> · ${fmt(D.best.score)} очк.${mine ? ` · место ${D.top.indexOf(mine) + 1}` : ''}</div>` : ''}
        <button class="btn ${D.attemptsLeft ? 'btn-gold' : 'btn-ghost'} btn-big" id="arenaPlayDaily" ${D.attemptsLeft ? '' : 'disabled'}>${D.attemptsLeft ? `🎮 Играть (осталось ${D.attemptsLeft})` : '😴 Попытки на сегодня закончились'}</button>
        <p class="section-label">🏆 Топ дня</p>
        ${D.top.length ? D.top.map((p, i) => `<div class="lb-row ${p.uid === playerId ? 'me' : ''}"><span class="lb-rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${avatarOf({ name: p.name, me: p.uid === playerId })}<span class="lb-name">${esc(p.name)}</span><span class="lb-val">${p.moves} ход.<br><small>${fmt(p.score)} очк.</small></span></div>`).join('') : '<p class="empty">Пока никто не играл — стань первым!</p>'}
        ${D.yesterday ? `<p class="section-label">📅 Вчера</p>${D.yesterday.winners.map((w) => `<div class="an-row"><b>${['🥇', '🥈', '🥉'][w.rank - 1]} ${esc(w.name)}</b><span></span><span>${w.moves} ход.</span></div>`).join('') || '<p class="muted tiny">Никто не прошёл</p>'}` : ''}
        <p class="muted tiny" style="margin-top:10px">Топ-3 получают призы автоматически на следующий день. Бустеры на арене недоступны — только мастерство!</p>`;
      if ($('arenaPlayDaily')) $('arenaPlayDaily').addEventListener('click', () => startArena('daily'));
    } else {
      const list = arenaDuels || [];
      const incoming = list.filter((d) => d.status === 'pending' && d.mine === 'b');
      const toPlay = list.filter((d) => d.canPlay);
      const waiting = list.filter((d) => d.status === 'active' && !d.canPlay);
      const done = list.filter((d) => d.status === 'done' || d.status === 'declined' || d.status === 'expired');
      const pendingMine = list.filter((d) => d.status === 'pending' && d.mine === 'a');
      const row = (d) => {
        const opp = d.mine === 'a' ? d.b : d.a;
        const oppName = opp ? esc(opp.name) : '<i>ждём соперника</i>';
        let right = '';
        if (d.status === 'pending' && d.mine === 'b') right = `<button class="btn btn-gold btn-small" data-dresp="${d.id}:1">Принять</button><button class="btn btn-ghost btn-small" data-dresp="${d.id}:0">✕</button>`;
        else if (d.status === 'pending' && d.mine === 'a') right = `<button class="btn btn-ghost btn-small" data-dcancel="${d.id}">Отменить</button>`;
        else if (d.canPlay) right = `<button class="btn btn-gold btn-small" data-dplay="${d.id}">Играть</button>`;
        else if (d.status === 'active') right = `<span class="muted tiny">ждём соперника</span>`;
        else if (d.status === 'done') right = d.winner === playerId ? `<span class="chip vip">🏆 Победа</span>` : d.winner ? `<span class="chip">Поражение</span>` : `<span class="chip">Ничья</span>`;
        else if (d.status === 'declined') right = `<span class="muted tiny">отклонена</span>`;
        else if (d.status === 'expired') right = `<span class="muted tiny">истекла</span>`;
        return `<div class="duel-row"><span class="duel-vs">⚔️ ${oppName}</span>${right}</div>`;
      };
      body.innerHTML = `
        <button class="btn btn-primary btn-big" id="arenaChallenge">⚔️ Вызвать друга</button>
        ${incoming.length ? `<p class="section-label">📨 Вам бросили вызов</p>${incoming.map(row).join('')}` : ''}
        ${toPlay.length ? `<p class="section-label">🎮 Ваш ход</p>${toPlay.map(row).join('')}` : ''}
        ${pendingMine.length ? `<p class="section-label">⏳ Ждём ответа</p>${pendingMine.map(row).join('')}` : ''}
        ${waiting.length ? `<p class="section-label">⌛ В процессе</p>${waiting.map(row).join('')}` : ''}
        ${done.length ? `<p class="section-label">📜 История</p>${done.map(row).join('')}` : ''}
        ${!list.length ? '<p class="empty">Пока нет дуэлей — вызовите друга! 👆</p>' : ''}`;
      $('arenaChallenge').addEventListener('click', () => openDuelPicker());
      qsa('[data-dresp]', body).forEach((b) => b.addEventListener('click', () => { const [id, acc] = b.dataset.dresp.split(':'); respondDuel(id, acc === '1'); }));
      qsa('[data-dcancel]', body).forEach((b) => b.addEventListener('click', () => cancelDuel(b.dataset.dcancel)));
      qsa('[data-dplay]', body).forEach((b) => b.addEventListener('click', () => startArena('duel', b.dataset.dplay)));
    }
  }
  async function openDuelPicker(prefillId) {
    const top = (arenaDuels ? [] : []).length; // no-op placeholder to keep lints calm
    const fr = await api('/api/social/top?' + new URLSearchParams({ telegram_id: playerId, by: 'friends' }));
    const friends = fr.ok ? fr.data.list.filter((p) => p.id !== playerId) : [];
    $('duelFriends').innerHTML = friends.length ? friends.map((p) => `<button class="duel-friend" data-fid="${p.id}">${avatarOf(p)}<small>${esc(p.name)}</small></button>`).join('')
      : '<p class="muted tiny">Пригласите друзей, чтобы вызывать их быстрее — а пока можно ввести @username или ID ниже</p>';
    qsa('[data-fid]', $('duelFriends')).forEach((b) => b.addEventListener('click', () => sendDuelChallenge(b.dataset.fid)));
    $('duelTarget').value = prefillId || '';
    openModal('modalDuelPick');
  }
  async function sendDuelChallenge(target) {
    target = target || $('duelTarget').value;
    if (!target) { showToast('Введите @username или ID'); return; }
    const r = await api('/api/arena/duel/create', { method: 'POST', body: { telegram_id: playerId, target } });
    if (!r.ok) { showToast('⚠️ ' + ((r.data && r.data.error) || 'Ошибка')); return; }
    closeModal('modalDuelPick');
    showToast('✅ Вызов отправлен!');
    track('duel_create');
    refreshArena();
  }
  $('duelSend').addEventListener('click', () => sendDuelChallenge());
  async function respondDuel(id, accept) {
    const r = await api('/api/arena/duel/respond', { method: 'POST', body: { telegram_id: playerId, id, accept } });
    if (!r.ok) { showToast('⚠️ ' + ((r.data && r.data.error) || 'Ошибка')); return; }
    showToast(accept ? '✅ Дуэль принята!' : 'Вызов отклонён');
    refreshArena();
  }
  async function cancelDuel(id) {
    const r = await api('/api/arena/duel/cancel', { method: 'POST', body: { telegram_id: playerId, id } });
    if (r.ok) refreshArena();
  }

  async function startArena(kind, duelId) {
    tickLives();
    const r = await api(`/api/arena/${kind}/start`, { method: 'POST', body: { telegram_id: playerId, id: duelId } });
    if (!r.ok) { showToast('⚠️ ' + ((r.data && r.data.error) || 'Ошибка')); return; }
    board.arena = { kind, duelId, opponent: duelId && (arenaDuels || []).find((d) => d.id === duelId) };
    board.level = 0;
    board.cfg = E.levelConfig(r.data.tpl);
    board.run = { id: r.data.runId, log: [] };
    board.st = E.createBoard(board.cfg, { seed: r.data.seed });
    board.done = false; board.busy = false; board.armed = null; board.selected = null; paused = false;
    board.snap = { cleared: 0, specials: 0 };
    board.t0 = Date.now();
    board.goalPrev = board.st.goals.map((g) => g.count);
    showScreen('screenGame');
    $('screenGame').classList.add('arena-mode');
    $('gameLevelNum').textContent = kind === 'daily' ? '🔥' : '⚔️';
    $('boosterBar').innerHTML = ''; $('legendaryBar').classList.add('hidden');
    buildBoardDom();
    requestAnimationFrame(() => { layoutBoard(); renderGoals(true); });
    updateGameHud();
    const opp = board.arena.opponent;
    showBanner(kind === 'daily' ? '🔥 Испытание дня — экономь ходы!' : `⚔️ Дуэль с ${esc((opp && opp.b && opp.b.name) || (opp && opp.a && opp.a.name) || 'соперником')}`);
    scheduleHint();
  }
  async function finishArena() {
    board.busy = false;
    const kind = board.arena.kind;
    const r = await api(`/api/arena/${kind}/finish`, { method: 'POST', body: { telegram_id: playerId, runId: board.run.id, id: board.arena.duelId, log: board.run.log } });
    board.run = null;
    if (!r.ok || !r.data || !r.data.verified) { showToast('⚠️ Результат не удалось подтвердить, попробуйте снова'); showScreen('screenArena'); return; }
    track('arena_finish', { k: kind });
    showArenaResult(kind, r.data);
  }
  function showArenaResult(kind, d) {
    const body = $('arenaResultBody');
    if (kind === 'daily') {
      const rank = d.myRank;
      body.innerHTML = `<div class="big-emoji">🔥</div><h2>Испытание дня</h2>
        <p class="arena-stat">Ходов: <b>${d.moves}</b> · Очков: <b>${fmt(d.score)}</b></p>
        ${rank ? `<p class="arena-stat">Место в топе: <b>${rank}</b></p>` : ''}
        ${d.isFirst ? '<div class="channel-reward"><span>🎁 Награда за участие:</span><b>🪙 200</b></div>' : ''}
        <button class="btn btn-primary btn-big" data-close="modalArenaResult">Продолжить</button>`;
    } else {
      const st = d.duel, mine = st.mine, opp = mine === 'a' ? st.b : st.a;
      let text;
      if (st.status !== 'done') text = `<p class="muted">Ждём, пока сыграет соперник — результат придёт уведомлением от бота.</p>`;
      else if (!st.winner) text = `<p class="arena-stat">🤝 Ничья! Одинаковое число ходов.</p>`;
      else if (st.winner === playerId) text = `<p class="arena-stat">🏆 Победа! +15💎 +500🪙</p>`;
      else text = `<p class="arena-stat">Соперник оказался быстрее. +100🪙 в утешение</p>`;
      body.innerHTML = `<div class="big-emoji">⚔️</div><h2>Дуэль ${opp ? 'с ' + esc(opp.name) : ''}</h2>
        <p class="arena-stat">Ваш результат: <b>${d.moves}</b> ход. · ${fmt(d.score)} очк.</p>${text}
        <button class="btn btn-primary btn-big" data-close="modalArenaResult">Продолжить</button>`;
    }
    openModal('modalArenaResult');
    qsa('[data-close]', body).forEach((b) => b.addEventListener('click', () => { closeModal('modalArenaResult'); $('screenGame').classList.remove('arena-mode'); board.arena = null; openArena(); }));
  }

  /* ============================================================
     14. РЕЙТИНГИ, ПРОФИЛИ-ВИТРИНЫ, ЛЕНТА СОБЫТИЙ
     ============================================================ */
  const LB_TABS = [['level', '🚩 Уровень'], ['stars', '⭐ Звёзды'], ['collection', '💎 Коллекция'], ['likes', '❤️ Лайки'], ['friends', '👥 Друзья']];
  let lbTab = 'level';
  const lbVal = (by, v) => (by === 'collection' ? '💠' + fmt(v) : by === 'likes' ? '❤️' + fmt(v) : by === 'stars' ? '⭐' + fmt(v) : '🚩' + fmt(v));
  // Аватар любого игрока: фото Telegram или буква + рамка (обычная или из коллекции)
  function avatarOf(p, cls) {
    const inner = p.me ? avatarHtml() : p.photo ? `<img src="${esc(p.photo)}" alt="" data-i="${initialOf(p.name)}" onerror="this.parentNode.textContent=this.dataset.i">` : initialOf(p.name);
    let style = '';
    const d = p.itemFrame && window.FBItems.BY_ID[p.itemFrame];
    if (d) style = `style="border:3px solid transparent;box-shadow:0 0 12px ${d.data[0]};background:linear-gradient(#2c1660,#2c1660) padding-box, conic-gradient(${d.data.join(',')}) border-box"`;
    const fr = !d && p.frame && p.frame !== 'none' && FRAMES[p.frame] ? ' frame-' + p.frame : '';
    return `<div class="avatar${fr} ${cls || ''}" ${style}>${inner}</div>`;
  }
  async function renderLeaders() {
    $('leadersTabs').innerHTML = LB_TABS.map(([k, n]) => `<button class="tab ${k === lbTab ? 'active' : ''}" data-lb="${k}">${n}</button>`).join('');
    qsa('[data-lb]', $('leadersTabs')).forEach((b) => b.addEventListener('click', () => { lbTab = b.dataset.lb; Sound.select(); renderLeaders(); }));
    const body = $('leadersBody');
    body.innerHTML = '<p class="empty">Загрузка...</p>';
    if (playerId === 'guest') { body.innerHTML = '<p class="empty">Рейтинги доступны внутри Telegram 🙂</p>'; return; }
    const by = lbTab;
    const res = await api('/api/social/top?' + new URLSearchParams({ telegram_id: playerId, by }));
    if (by !== lbTab) return;
    if (!res.ok || !res.data || !res.data.list) { body.innerHTML = '<p class="empty">Не удалось загрузить рейтинг 😔<br>Проверьте соединение.</p>'; return; }
    const list = res.data.list.map((p) => (p.id === playerId ? Object.assign(p, { me: true }) : p));
    const me = res.data.me;
    const hint = { level: 'Кто дальше всех прошёл', stars: 'Сумма звёзд за все уровни', collection: 'Оценка всех предметов по ценам маркета', likes: 'Кому игроки поставили больше ❤️', friends: 'Вы и друзья по приглашениям' }[by];
    let html = `<p class="muted tiny" style="text-align:center;margin:0 0 6px">${hint}</p>`;
    if (!list.length) {
      html += by === 'friends' ? `<p class="empty">Пока нет друзей в игре 👥<br>Пригласите друга — и соревнуйтесь!</p><button class="btn btn-primary" id="lbInvite">👥 Пригласить друга</button>` : '<p class="empty">Пока пусто — стань первым!</p>';
      body.innerHTML = html;
      if ($('lbInvite')) $('lbInvite').addEventListener('click', () => shareText('Давай соревноваться в Fruit Blitz — три в ряд прямо в Telegram 🍓'));
      return;
    }
    const top3 = list.slice(0, 3), podOrder = [top3[1], top3[0], top3[2]];
    html += '<div class="lb-podium">' + podOrder.map((p, i) => p ? `<button class="podium p${[2, 1, 3][i]}" data-prof="${p.id}">${avatarOf(p)}<b>${esc(p.name)}</b><small>${lbVal(by, p.value)}</small><div class="pd-bar">${[2, 1, 3][i]}</div></button>` : '<div class="podium"></div>').join('') + '</div>';
    html += `<p class="section-label">${me.rank ? `Вы на ${me.rank}-м месте из ${me.total}` : by === 'collection' ? 'Соберите предметы, чтобы попасть в рейтинг' : by === 'likes' ? 'Пока без лайков — прокачайте витрину!' : 'Пройдите уровень, чтобы попасть в рейтинг'}</p>`;
    html += list.map((p, i) => `<button class="lb-row ${p.me ? 'me' : ''}" data-prof="${p.id}"><span class="lb-rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${avatarOf(p)}<span class="lb-name">${esc(p.name)}${p.badge ? ' ' + esc(p.badge) : ''}<small>${p.titleIcon ? esc(p.titleIcon + ' ' + p.titleName) : p.username ? '@' + esc(p.username) : ''}</small></span><span class="lb-val">${lbVal(by, p.value)}<br><small>${esc(p.sub || '')}</small></span></button>`).join('');
    if (me.rank > 50) html += `<button class="lb-row me" data-prof="${playerId}"><span class="lb-rank">${me.rank}</span>${avatarOf({ me: true, frame: state.equippedFrame })}<span class="lb-name">${esc(displayName)}</span><span class="lb-val">${lbVal(by, me.value)}</span></button>`;
    body.innerHTML = html;
    qsa('[data-prof]', body).forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.prof)));
  }

  function agoText(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'только что';
    if (s < 3600) return Math.floor(s / 60) + ' мин назад';
    if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
    return Math.floor(s / 86400) + ' д назад';
  }
  // Текст события без привязки к роду: «Аня: выпал ✨ Галактика #17»
  function feedHtml(e, withName) {
    const I = window.FBItems, d = e.itemId && I.BY_ID[e.itemId];
    const item = d ? `<b style="color:${I.rarityOf(d.r).color}">${e.shiny ? '✨ ' : ''}${esc(d.name)} #${e.serial}</b>` : '';
    const who = withName === false ? '' : `<b>${esc(e.name)}</b>${e.badge ? ' ' + esc(e.badge) : ''}: `;
    const txt = {
      drop: `выпал ${item}`, tradeup: `контракт → ${item}`, excl: `эксклюзив ★ ${item}`,
      sale: `покупка ${item} за ${fmt(e.price || 0)} 💠`, level: `пройдено ${e.n} уровней 🎉`, likes: `профиль набрал ${e.n} ❤️`,
      arena_daily: `🥇 победил(а) в испытании дня за ${e.moves} ход.`, duel: `⚔️ выиграл(а) дуэль у ${esc(e.vs || '?')}`
    }[e.kind] || '';
    return who + txt;
  }
  const FEED_ICO = { drop: '🎁', tradeup: '🧪', excl: '★', sale: '💰', level: '🏆', likes: '❤️', arena_daily: '🔥', duel: '⚔️' };
  let feedCache = [], feedIdx = 0, feedLoadedAt = 0, feedRot = null;
  async function loadFeed(force) {
    if (!force && Date.now() - feedLoadedAt < 60000) return feedCache;
    const r = await api('/api/social/feed');
    if (r.ok && r.data && r.data.feed) { feedCache = r.data.feed; feedLoadedAt = Date.now(); }
    return feedCache;
  }
  function showFeedStrip() {
    const strip = $('feedStrip');
    if (!feedCache.length) { strip.classList.add('hidden'); return; }
    strip.classList.remove('hidden');
    const e = feedCache[feedIdx % Math.min(6, feedCache.length)];
    const t = $('feedText');
    t.classList.remove('feed-in'); void t.offsetWidth; t.classList.add('feed-in');
    t.innerHTML = `${FEED_ICO[e.kind] || '•'} ${feedHtml(e)} <small>· ${agoText(e.at)}</small>`;
  }
  async function refreshFeedStrip() {
    await loadFeed();
    showFeedStrip();
    clearInterval(feedRot);
    feedRot = setInterval(() => { if (currentScreen !== 'screenHome') return; feedIdx++; showFeedStrip(); if (Date.now() - feedLoadedAt > 60000) loadFeed(); }, 4500);
  }
  async function openFeed() {
    openModal('modalFeed');
    const list = $('feedList');
    list.innerHTML = '<p class="empty">Загрузка...</p>';
    const f = await loadFeed(true);
    list.innerHTML = f.length ? f.map((e) => `<button class="feed-row" data-prof="${e.uid}">${avatarOf({ name: e.name, photo: e.photo })}<span class="fr-text"><span>${feedHtml(e)}</span><small>${agoText(e.at)}</small></span><span class="fr-ico">${FEED_ICO[e.kind] || ''}</span></button>`).join('')
      : '<p class="empty">Пока тихо… Выбей что-нибудь редкое первым! 🍀</p>';
    qsa('[data-prof]', list).forEach((b) => b.addEventListener('click', () => { closeModal('modalFeed'); openProfile(b.dataset.prof); }));
    track('feed_open');
  }
  $('feedStrip').addEventListener('click', () => { Sound.click(); openFeed(); });

  // Публичные данные профиля — уходят на сервер при синхронизации
  function pubPayload() {
    const t = TITLES[state.equippedTitle] || TITLES.novice;
    return { frame: state.equippedFrame, title: state.equippedTitle, titleName: t.name, titleIcon: t.icon, garden: state.garden.areasDone || 0, pass: passLevel(),
      wins: state.stats.wins, perfects: Object.values(state.levelStars).filter((v) => v === 3).length, combo: state.stats.bestCombo, ach: Object.values(state.achClaimed).reduce((a, b) => a + (Number(b) || 0), 0),
      photo: tgUser && tgUser.photo_url ? tgUser.photo_url : null };
  }

  let profileData = null, profileSel = null;
  async function openProfile(id) {
    if (playerId === 'guest') { showToast('Профили доступны внутри Telegram'); return; }
    Sound.click();
    openModal('modalProfile');
    $('profileBody').innerHTML = '<p class="empty">Загрузка...</p>';
    if (id === playerId) { saveNow(); await syncWithServer(); }
    const r = await api('/api/social/profile/' + encodeURIComponent(id) + '?' + userQS());
    if (!r.ok || !r.data || !r.data.profile) { $('profileBody').innerHTML = `<p class="empty">${esc((r.data && r.data.error) || 'Не удалось загрузить профиль')}</p>`; return; }
    profileData = r.data.profile; profileSel = null;
    renderProfile();
    track('profile_open', { k: id === playerId ? 'own' : 'other' });
  }
  function renderProfile() {
    const p = profileData, mine = p.id === playerId, pub = p.pub || {};
    const MKx = MK(), I = window.FBItems;
    const stat = (ico, label, v) => `<div class="pf-stat"><span>${ico}</span><b>${v}</b><small>${label}</small></div>`;
    const slots = [];
    for (let i = 0; i < 5; i++) {
      const it = p.showcase[i];
      if (it && MKx) {
        const d = I.BY_ID[it.itemId], rr = I.rarityOf(d.r);
        slots.push(`<button class="sc-slot${profileSel === i ? ' sel' : ''}" data-sc="${i}" style="--rc:${rr.color}">${MKx.pv(d, 46)}${it.shiny ? '<i class="sc-shiny">✨</i>' : ''}<small>#${it.serial}</small></button>`);
      } else slots.push(`<button class="sc-slot empty" ${mine ? 'data-sc-edit' : 'disabled'}>${mine ? '+' : ''}</button>`);
    }
    let detail = '';
    if (profileSel != null && p.showcase[profileSel]) {
      const it = p.showcase[profileSel], d = I.BY_ID[it.itemId], rr = I.rarityOf(d.r);
      detail = `<div class="sc-detail" style="--rc:${rr.color}"><b>${it.shiny ? '✨ Сияющий ' : ''}${esc(d.name)} <span>#${it.serial}</span></b>
        <small>${esc(rr.name)} · ${esc(I.TYPES[d.type].name)} · ${esc(I.qualityOf(it.q).name)}${it.shiny && it.counter ? ' · 🍓' + fmt(it.counter) : ''}</small>
        <small>Оценка: <b>${fmt(it.value)} 💠</b></small></div>`;
    }
    const since = new Date(p.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const online = Date.now() - p.lastSeen < 10 * 60000;
    const ranks = [['🚩', p.ranks.level], ['💎', p.ranks.collection], ['❤️', p.ranks.likes]].filter((x) => x[1]).map(([i, r]) => `<span class="chip">${i} #${r}</span>`).join('');
    $('profileBody').innerHTML = `
      <div class="pf-head">${avatarOf(Object.assign({}, p, { me: mine, frame: mine ? state.equippedFrame : p.frame }), 'pf-avatar')}
        <div class="pf-name"><b>${esc(p.name)}${p.badge ? ' ' + esc(p.badge) : ''}</b>
          <span class="profile-title">${esc((pub.titleIcon || '🌱') + ' ' + (pub.titleName || 'Новичок'))}</span>
          <small>${online ? '<i class="on-dot"></i> в игре' : 'был(а) ' + agoText(p.lastSeen)}${p.username ? ' · @' + esc(p.username) : ''}</small>
          <div class="pf-chips">${p.vip ? '<span class="chip vip">👑 VIP</span>' : ''}${p.passPremium ? '<span class="chip">🎟️ Премиум</span>' : ''}${ranks}</div></div></div>
      <div class="pf-actions">${mine ? `<button class="btn btn-ghost" id="pfEdit">✏️ Витрина</button><button class="btn btn-primary" id="pfShare">📤 Поделиться</button>`
        : `<button class="btn ${p.liked ? 'btn-primary' : 'btn-ghost'} pf-like" id="pfLike">${p.liked ? '❤️' : '🤍'} ${fmt(p.likes)}</button><button class="btn btn-ghost" id="pfDuel">⚔️ Вызвать</button><button class="btn btn-ghost" id="pfTrade">🔁 Обмен</button>`}</div>
      ${mine ? `<p class="muted tiny" style="text-align:center">❤️ ${fmt(p.likes)} — столько игроков лайкнули ваш профиль</p>` : ''}
      <p class="section-label">🏆 Витрина${p.autoShowcase && p.showcase.length ? ' <small class="muted">(лучшие предметы)</small>' : ''}</p>
      <div class="sc-row">${slots.join('')}</div>${detail}
      ${!p.showcase.length ? `<p class="muted tiny" style="text-align:center">${mine ? 'Проходите уровни — за победы выпадают предметы!' : 'Коллекция пока пуста'}</p>` : ''}
      <div class="pf-col"><span>💎 Коллекция</span><b>${fmt(p.collection.count)} шт. · ${fmt(p.collection.value)} 💠</b></div>
      <div class="pf-stats">${stat('🚩', 'уровень', Math.max(0, p.bestLevel - 1))}${stat('⭐', 'звёзд', fmt(p.totalStars))}${stat('🏆', 'побед', fmt(pub.wins || 0))}
        ${stat('💯', 'на 3 ⭐', fmt(pub.perfects || 0))}${stat('🌳', 'областей сада', pub.garden || 0)}${stat('🎟️', 'пропуск', pub.pass || 0)}</div>
      ${p.recent && p.recent.length ? `<p class="section-label">✨ Последние успехи</p>${p.recent.map((e) => `<div class="pf-event">${FEED_ICO[e.kind] || '•'} ${feedHtml(e, false)} <small>· ${agoText(e.at)}</small></div>`).join('')}` : ''}
      <p class="muted tiny" style="text-align:center;margin-top:10px">В игре с ${since}</p>`;
    qsa('[data-sc]', $('profileBody')).forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.sc; profileSel = profileSel === i ? null : i; Sound.select(); renderProfile(); }));
    qsa('[data-sc-edit]', $('profileBody')).forEach((b) => b.addEventListener('click', openShowcaseEditor));
    if ($('pfEdit')) $('pfEdit').addEventListener('click', openShowcaseEditor);
    if ($('pfShare')) $('pfShare').addEventListener('click', () => { closeModal('modalProfile'); shareProfile(); });
    if ($('pfLike')) $('pfLike').addEventListener('click', async () => {
      const b = $('pfLike'); b.disabled = true;
      const r = await api('/api/social/like', { method: 'POST', body: { telegram_id: playerId, id: p.id } });
      b.disabled = false;
      if (!r.ok) { showToast('⚠️ ' + ((r.data && r.data.error) || 'Ошибка')); return; }
      p.liked = r.data.liked; p.likes = r.data.likes;
      if (p.liked) { Sound.coin(); haptic('success'); const rc = b.getBoundingClientRect(); burstConfetti(rc.left + rc.width / 2, rc.top, 16); }
      renderProfile();
    });
    if ($('pfDuel')) $('pfDuel').addEventListener('click', () => { closeModal('modalProfile'); openArena(); arenaTab = 'duels'; renderArenaTabs(); renderArenaBody(); openDuelPicker(p.id); });
    if ($('pfTrade')) $('pfTrade').addEventListener('click', () => {
      closeModal('modalProfile');
      if (MK() && MK().setTab) MK().setTab('trades');
      showScreen('screenMarket');
      showToast('Введите в поле обмена: ' + (p.username ? '@' + p.username : p.id));
    });
  }
  let scChosen = [];
  function openShowcaseEditor() {
    const MKx = MK(), I = window.FBItems;
    const inv = (MKx && MKx.me && MKx.me.inventory) || [];
    if (!inv.length) { showToast('Коллекция пока пуста — проходите уровни, за победы выпадают предметы!'); return; }
    scChosen = profileData && !profileData.autoShowcase ? profileData.showcase.map((x) => x.uid) : [];
    const sorted = inv.slice().sort((a, b) => (I.BY_ID[b.itemId].r - I.BY_ID[a.itemId].r) || ((b.shiny ? 1 : 0) - (a.shiny ? 1 : 0)));
    const draw = () => {
      $('scPick').innerHTML = sorted.map((it) => {
        const d = I.BY_ID[it.itemId], k = scChosen.indexOf(it.uid);
        return `<button class="sc-slot${k >= 0 ? ' sel' : ''}" data-pick="${it.uid}" style="--rc:${I.rarityOf(d.r).color}">${MKx.pv(d, 42)}${it.shiny ? '<i class="sc-shiny">✨</i>' : ''}${k >= 0 ? `<i class="sc-num">${k + 1}</i>` : ''}<small>${esc(d.name)}</small></button>`;
      }).join('');
      qsa('[data-pick]', $('scPick')).forEach((b) => b.addEventListener('click', () => {
        const u = b.dataset.pick, k = scChosen.indexOf(u);
        if (k >= 0) scChosen.splice(k, 1); else if (scChosen.length < 5) scChosen.push(u); else { showToast('Не больше 5 предметов'); return; }
        Sound.select(); draw();
      }));
    };
    draw();
    openModal('modalShowcase');
  }
  async function saveShowcase(uids) {
    const r = await api('/api/social/showcase', { method: 'POST', body: { telegram_id: playerId, uids } });
    if (!r.ok) { showToast('⚠️ ' + ((r.data && r.data.error) || 'Ошибка')); return; }
    closeModal('modalShowcase');
    showToast('✅ Витрина обновлена');
    openProfile(playerId);
  }
  $('scSave').addEventListener('click', () => saveShowcase(scChosen));
  $('scAuto').addEventListener('click', () => saveShowcase([]));
  $('profileCard').addEventListener('click', () => openProfile(playerId));

  /* ============================================================
     15. НАСТРОЙКИ, ЖИЗНИ, ПОДЕЛИТЬСЯ
     ============================================================ */
  function refLink() { return `https://t.me/game_crashfr_bot?start=ref_${playerId}`; }
  /* ============================================================
     14b. АНАЛИТИКА: события уровней (агрегаты для админки)
     ============================================================ */
  const trackQ = [];
  let trackTimer = null;
  function track(type, data) {
    if (playerId === 'guest') return;
    trackQ.push(Object.assign({ type }, data || {}));
    clearTimeout(trackTimer);
    if (trackQ.length >= 20) flushTrack(); else trackTimer = setTimeout(flushTrack, 15000);
  }
  function flushTrack() {
    clearTimeout(trackTimer);
    if (!trackQ.length || playerId === 'guest') return;
    api('/api/track', { method: 'POST', body: { telegram_id: playerId, events: trackQ.splice(0, 50) } });
  }

  /* ============================================================
     14c. СЕЗОННЫЙ ПРОПУСК
     ============================================================ */
  const PASS_TIERS = 30, PASS_XP = 200;
  const SEASON_NAMES = [['🍂', 'Осенний урожай'], ['❄️', 'Зимняя сказка'], ['🌸', 'Весенний сад'], ['🏖️', 'Летний бриз'], ['🍍', 'Тропическая лихорадка'], ['🌌', 'Звездопад']];
  const seasonNow = () => window.FBItems.seasonInfo();
  const seasonMeta = (id) => SEASON_NAMES[(id - 1) % SEASON_NAMES.length];
  const PB = ['hammer', 'shuffle', 'rocket', 'bomb', 'rainbow'];
  function passRewards(t) {
    let free, prem;
    if (t % 10 === 0) free = { chest: t === 30 ? 'legend' : 'big' };
    else if (t % 5 === 0) free = { chest: 'small' };
    else if (t % 4 === 0) free = { gems: 5 + Math.floor(t / 4) };
    else if (t % 2 === 0) free = { boosters: { [PB[(t / 2) % 3]]: 1 } };
    else free = { coins: 150 + t * 20 };
    if (t === 30) prem = { title: 'season', gems: 100 };
    else if (t === 20) prem = { frame: 'season' };
    else if (t % 10 === 0) prem = { chest: 'legend' };
    else if (t % 5 === 0) prem = { chest: 'big', gems: 15 };
    else if (t % 3 === 0) prem = { boosters: { [PB[3 + (t % 2)]]: 2 } };
    else if (t % 4 === 1) prem = { infiniteMin: 30 };
    else prem = { coins: 400 + t * 40, gems: 5 };
    return { free, prem };
  }
  function ensurePass() {
    const s = seasonNow();
    if (!state.pass || state.pass.season !== s.id) { state.pass = { season: s.id, xp: 0, free: {}, prem: {} }; saveState(); }
    return state.pass;
  }
  const passLevel = () => Math.min(PASS_TIERS, Math.floor(ensurePass().xp / PASS_XP));
  const isPremium = () => !!(MK() && MK().me && MK().me.passSeason === seasonNow().id);
  function passClaimable() {
    const P = ensurePass(), lvl = passLevel(), prem = isPremium();
    let n = 0;
    for (let t = 1; t <= lvl; t++) { if (!P.free[t]) n++; if (prem && !P.prem[t]) n++; }
    return n;
  }
  function addPassXp(n) {
    const P = ensurePass();
    const before = passLevel();
    P.xp += n;
    const after = passLevel();
    saveState();
    if (after > before) setTimeout(() => showToast(`🎟️ Пропуск: уровень ${after}! Забери награду`), 600);
    return n;
  }
  function leftShort(ms) {
    const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5);
    return d > 0 ? `${d} д ${h} ч` : `${h} ч ${Math.floor(ms % 36e5 / 6e4)} мин`;
  }
  function renderPassTeaser() {
    const s = seasonNow(), lvl = passLevel(), xp = ensurePass().xp, n = passClaimable();
    $('passTeaserTitle').textContent = `${seasonMeta(s.id)[0]} Пропуск: ${seasonMeta(s.id)[1]}`;
    $('passTeaserSub').textContent = `Уровень ${lvl}/${PASS_TIERS}${isPremium() ? ' 👑' : ''} · ⏳ ${leftShort(s.end - Date.now())}`;
    $('passTeaserFill').style.width = (lvl >= PASS_TIERS ? 100 : (xp % PASS_XP) / PASS_XP * 100) + '%';
    $('passTeaserCta').textContent = n ? `Забрать (${n})` : 'Открыть ›';
    $('dotPass').classList.toggle('hidden', !n);
  }
  function passCell(line, t, rw, reached, unlocked) {
    const got = !!ensurePass()[line][t];
    const items = rewardItems(rw);
    const label = items.map((x) => x[1]).join(' · ');
    const cls = got ? 'got' : !unlocked ? 'locked' : reached ? 'ready' : '';
    return `<button class="pass-cell ${line} ${cls}" data-pc="${line}:${t}" ${cls === 'ready' ? '' : 'disabled'}>
      <span class="pc-ico">${items.map((x) => x[0]).join('')}</span><small>${esc(label)}</small>
      ${got ? '<i class="pc-mark">✓</i>' : !unlocked ? '<i class="pc-mark">🔒</i>' : ''}</button>`;
  }
  function renderPass() {
    const P = ensurePass(), s = seasonNow(), [ico, name] = seasonMeta(s.id);
    const lvl = passLevel(), prem = isPremium(), n = passClaimable();
    const xpIn = lvl >= PASS_TIERS ? PASS_XP : P.xp - lvl * PASS_XP;
    let rows = '';
    for (let t = 1; t <= PASS_TIERS; t++) {
      const r = passRewards(t), reached = t <= lvl;
      rows += `<div class="pass-row${reached ? ' reached' : ''}${t === lvl + 1 ? ' next' : ''}" id="passRow${t}">
        ${passCell('free', t, r.free, reached, true)}<div class="pass-tier">${t}</div>${passCell('prem', t, r.prem, reached, prem)}</div>`;
    }
    $('passBody').innerHTML = `
      <div class="pass-head"><div class="pass-season">${ico}</div><div class="pass-htext"><small>Сезон ${s.id} · осталось ${leftShort(s.end - Date.now())}</small><b>${esc(name)}</b></div>
        <div class="pass-lvl"><small>ур.</small>${lvl}</div></div>
      <div class="progress"><div class="progress-fill" style="width:${xpIn / PASS_XP * 100}%"></div></div>
      <p class="muted tiny" style="margin:4px 0 8px">${lvl >= PASS_TIERS ? 'Пропуск пройден полностью! 🎉' : `${xpIn}/${PASS_XP} XP до уровня ${lvl + 1}`}</p>
      ${prem ? '<div class="pass-prem on">👑 Премиум-пропуск активен — забирай обе линии наград!</div>'
        : `<div class="pass-prem"><div><b>👑 Премиум-пропуск</b><small>Легендарные сундуки, бесконечные жизни, рамка и звание «Легенда сезона». Награды с уже открытых уровней — сразу!</small></div><button class="btn btn-stars" id="passBuy">⭐ 150</button></div>`}
      ${n ? `<button class="btn btn-gold" id="passClaimAll">🎁 Забрать всё (${n})</button>` : ''}
      <div class="pass-cols"><span>Бесплатно</span><span></span><span>Премиум 👑</span></div>
      <div class="pass-list" id="passList">${rows}</div>
      <p class="muted tiny" style="margin-top:10px">XP: новый уровень +20 и +5 за каждую ⭐ · повтор уровня +10 · задание дня +30 · все задания +60 · награда за вход +20. Незабранные награды сгорают в конце сезона.</p>`;
    qsa('[data-pc]', $('passBody')).forEach((b) => b.addEventListener('click', () => { const [line, t] = b.dataset.pc.split(':'); claimPass([[line, +t]]); }));
    if ($('passClaimAll')) $('passClaimAll').addEventListener('click', () => {
      const list = [];
      for (let t = 1; t <= lvl; t++) { if (!P.free[t]) list.push(['free', t]); if (prem && !P.prem[t]) list.push(['prem', t]); }
      claimPass(list);
    });
    if ($('passBuy')) $('passBuy').addEventListener('click', () => {
      if (playerId === 'guest') { showToast('Покупки доступны внутри Telegram'); return; }
      track('pass_buy_click');
      if (MK() && MK().buyStars) MK().buyStars('pass');
    });
  }
  async function claimPass(list) {
    const P = ensurePass(), total = { coins: 0, gems: 0, boosters: {} }, chests = [];
    let extra = {};
    list.forEach(([line, t]) => {
      if (P[line][t] || t > passLevel() || (line === 'prem' && !isPremium())) return;
      P[line][t] = true;
      const rw = passRewards(t)[line];
      if (rw.chest) chests.push(rw.chest);
      if (rw.coins) total.coins += rw.coins;
      if (rw.gems) total.gems += rw.gems;
      if (rw.boosters) Object.keys(rw.boosters).forEach((k) => { total.boosters[k] = (total.boosters[k] || 0) + rw.boosters[k]; });
      if (rw.infiniteMin) extra.infiniteMin = (extra.infiniteMin || 0) + rw.infiniteMin;
      ['frame', 'title'].forEach((k) => { if (rw[k]) extra[k] = rw[k]; });
    });
    saveNow();
    track('pass_claim', { k: String(list.length) });
    const rw = Object.assign(total, extra);
    if (!Object.keys(rw.boosters).length) delete rw.boosters;
    if (!rw.coins) delete rw.coins;
    if (!rw.gems) delete rw.gems;
    closeModal('modalPass');
    if (Object.keys(rw).length) await showReward(rw, { title: 'Награды пропуска', icon: '🎟️' });
    for (const c of chests) await showReward(rollChest(c), { title: CHESTS[c].name, icon: CHESTS[c].icon, chest: true });
    scheduleSync();
    openPass();
  }
  function openPass() { renderPass(); openModal('modalPass'); track('pass_open'); const row = $('passRow' + Math.min(PASS_TIERS, passLevel() + 1)), list = $('passList'); if (row && list) list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2); }
  $('passTeaser').addEventListener('click', () => { Sound.click(); openPass(); });

  /* ============================================================
     14d. ПОДЕЛИТЬСЯ: красивая карточка-картинка
     ============================================================ */
  const SHARE_FONT = '-apple-system, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawShareCard(o, W, H) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const bg = c.createLinearGradient(0, 0, W * 0.4, H);
    bg.addColorStop(0, '#7b3fe4'); bg.addColorStop(0.5, '#3a1580'); bg.addColorStop(1, '#16072f');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const glow = c.createRadialGradient(W / 2, H * 0.45, 20, W / 2, H * 0.45, W * 0.7);
    glow.addColorStop(0, (o.accent || '#ffd23f') + '66'); glow.addColorStop(1, 'transparent');
    c.fillStyle = glow; c.fillRect(0, 0, W, H);
    // фоновые фрукты
    const fr = ['🍓', '🍊', '🍋', '🍇', '🍏', '🫐', '🍉', '🍒'];
    c.fillStyle = '#fff'; c.globalAlpha = 0.16; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < 16; i++) { c.font = `${70 + (i * 37) % 60}px ${SHARE_FONT}`; c.fillText(fr[i % fr.length], ((i * 331) % 1000) / 1000 * W, ((i * 571) % 1000) / 1000 * H); }
    c.globalAlpha = 1;
    // логотип
    const top = H * 0.075;
    c.font = `900 ${W * 0.105}px ${SHARE_FONT}`;
    c.fillStyle = '#b02a6e'; c.fillText('FRUIT BLITZ', W / 2, top + 8);
    const lg = c.createLinearGradient(0, top - 60, 0, top + 60); lg.addColorStop(0, '#ffffff'); lg.addColorStop(1, '#ffd23f');
    c.fillStyle = lg; c.fillText('FRUIT BLITZ', W / 2, top);
    // панель
    const pw = W * 0.86, ph = H * 0.62, px = (W - pw) / 2, py = H * 0.15;
    roundRect(c, px, py, pw, ph, 60); c.fillStyle = 'rgba(255,255,255,0.11)'; c.fill();
    c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,0.28)'; c.stroke();
    // Цвет заливки влияет на прозрачность эмодзи — рисуем их непрозрачным белым
    c.fillStyle = '#fff';
    c.font = `${Math.min(W * 0.22, ph * 0.26)}px ${SHARE_FONT}`; c.fillText(o.emoji || '🏆', W / 2, py + ph * 0.2);
    c.font = `900 ${W * (o.title.length > 18 ? 0.058 : 0.074)}px ${SHARE_FONT}`;
    c.fillText(o.title, W / 2, py + ph * 0.44, pw - 60);
    let y = py + ph * 0.44;
    if (o.stars != null) {
      y += ph * 0.15;
      c.font = `${W * 0.085}px ${SHARE_FONT}`;
      [0, 1, 2].forEach((i) => { c.globalAlpha = i < o.stars ? 1 : 0.25; c.fillText('⭐', W / 2 + (i - 1) * W * 0.12, y); });
      c.globalAlpha = 1;
      y += ph * 0.04;
    } else y += ph * 0.03;
    c.font = `700 ${W * 0.04}px ${SHARE_FONT}`; c.fillStyle = 'rgba(255,255,255,0.88)';
    (o.lines || []).forEach((ln) => { y += ph * 0.1; c.fillText(ln, W / 2, y, pw - 60); });
    if (o.color) { c.fillStyle = o.color; c.fillRect(px + 60, py + ph - 26, pw - 120, 10); }
    // игрок
    const fy = py + ph + H * 0.07;
    c.font = `800 ${W * 0.045}px ${SHARE_FONT}`; c.fillStyle = '#fff';
    const t = TITLES[state.equippedTitle] || TITLES.novice;
    c.fillText(`${displayName} · ${t.icon} ${t.name}`, W / 2, fy);
    // призыв
    const cy = H - H * 0.075, cw = W * 0.8, ch = H * 0.07;
    roundRect(c, (W - cw) / 2, cy - ch / 2, cw, ch, ch / 2);
    const cg = c.createLinearGradient(0, cy - ch / 2, 0, cy + ch / 2); cg.addColorStop(0, '#7cf5b6'); cg.addColorStop(1, '#16994f');
    c.fillStyle = cg; c.fill();
    c.fillStyle = '#fff'; c.font = `900 ${W * 0.036}px ${SHARE_FONT}`;
    c.fillText(`▶ Играй в Telegram: @${BOT_NAME}`, W / 2, cy + 2);
    return cv;
  }
  const BOT_NAME = 'game_crashfr_bot';
  let shareCtx = null;
  function canShareMsg() { try { return !!(tg && tg.shareMessage && tg.isVersionAtLeast && tg.isVersionAtLeast('8.0')); } catch (e) { return false; } }
  function canShareStory() { try { return !!(tg && tg.shareToStory && tg.isVersionAtLeast && tg.isVersionAtLeast('7.8')); } catch (e) { return false; } }
  function shareCard(kind, o) {
    const img = drawShareCard(o, 1080, 1350).toDataURL('image/jpeg', 0.86);
    shareCtx = { kind, o, img, prepared: null, story: null };
    $('shareImg').src = img;
    $('shareStory').classList.toggle('hidden', !canShareStory());
    openModal('modalShare');
    track('share_open', { k: kind });
  }
  function uploadShare(image, caption, forStory) {
    return api('/api/share/prepare', { method: 'POST', body: { telegram_id: playerId, image, caption, forStory: !!forStory } }).then((r) => (r.ok && r.data ? r.data : null));
  }
  $('shareChat').addEventListener('click', async () => {
    const s = shareCtx; if (!s) return;
    if (playerId === 'guest' || !canShareMsg()) { shareText(s.o.text); track('share', { k: s.kind + '_link' }); return; }
    const b = $('shareChat'); b.disabled = true; b.textContent = '⏳ Готовим...';
    if (!s.prepared) s.prepared = await uploadShare(s.img, s.o.text);
    b.disabled = false; b.textContent = '💬 Отправить в чат';
    if (s.prepared && s.prepared.preparedId) {
      try { tg.shareMessage(s.prepared.preparedId, (sent) => { if (sent) { track('share', { k: s.kind + '_chat' }); showToast('✅ Отправлено!'); closeModal('modalShare'); } }); return; } catch (e) { /* ниже — запасной вариант */ }
    }
    shareText(s.o.text); track('share', { k: s.kind + '_link' });
  });
  $('shareStory').addEventListener('click', async () => {
    const s = shareCtx; if (!s) return;
    const b = $('shareStory'); b.disabled = true; b.textContent = '⏳';
    if (!s.story) s.story = await uploadShare(drawShareCard(s.o, 1080, 1920).toDataURL('image/jpeg', 0.86), '', true);
    b.disabled = false; b.textContent = '📸 В историю';
    if (!s.story) { showToast('⚠️ Не удалось подготовить картинку'); return; }
    try { tg.shareToStory(s.story.url, { text: (s.o.text + ' ' + (s.story.refLink || '')).slice(0, 200) }); track('share', { k: s.kind + '_story' }); } catch (e) { showToast('⚠️ Истории недоступны в этой версии Telegram'); }
  });
  $('shareLink').addEventListener('click', () => { if (shareCtx) { shareText(shareCtx.o.text); track('share', { k: shareCtx.kind + '_link' }); } });
  function shareLevel(r) {
    if (!r) return;
    const ch = E.chapterOf(r.n);
    shareCard('level', { emoji: r.stars === 3 ? '🏆' : ch.emoji, title: `Уровень ${r.n} пройден!`, stars: r.stars,
      lines: [`${r.moves} ходов · ${fmt(r.score)} очков`, `Глава ${ch.number}: ${ch.name}`],
      text: `Я прошёл уровень ${r.n} в Fruit Blitz на ${'⭐'.repeat(r.stars)}! Сможешь лучше? 🍓` });
  }
  function shareProfile() {
    const done = Math.max(0, state.unlockedLevel - 1);
    shareCard('profile', { emoji: (TITLES[state.equippedTitle] || TITLES.novice).icon, title: displayName,
      lines: [`🚩 Пройдено уровней: ${done}`, `⭐ Звёзд: ${totalStars()} · 🌳 Областей сада: ${state.garden.areasDone || 0}`, `🎟️ Пропуск: уровень ${passLevel()}`],
      text: `Мой прогресс в Fruit Blitz: ${done} уровней и ⭐${totalStars()}! Догонишь? 🍓` });
  }

  /* ============================================================
     14e. КАНАЛ С НОВОСТЯМИ: задание «Подпишись»
     ============================================================ */
  const CHANNEL_URL = 'https://t.me/fruitblitz_news';
  let channelOpened = false;
  const channelDone = () => !!state.channelClaimed;
  function openChannelLink() {
    channelOpened = true;
    track('channel_open');
    try { if (tg && tg.openTelegramLink) { tg.openTelegramLink(CHANNEL_URL); return; } } catch (e) { /* ниже */ }
    window.open(CHANNEL_URL, '_blank');
  }
  function openChannel() {
    const done = channelDone();
    $('channelReward').classList.toggle('hidden', done);
    $('channelCheck').classList.toggle('hidden', done);
    $('channelNote').textContent = done ? '✅ Вы уже подписаны — спасибо! Новости ждут в канале.' : 'Сначала подпишитесь, потом вернитесь в игру и нажмите «забрать»';
    $('channelOpen').textContent = done ? '📢 Открыть канал' : '📢 1. Открыть канал';
    $('channelCheck').textContent = '✅ 2. Я подписался — забрать';
    openModal('modalChannel');
  }
  $('channelOpen').addEventListener('click', () => { Sound.click(); openChannelLink(); });
  $('channelCheck').addEventListener('click', async () => {
    if (playerId === 'guest') { showToast('Доступно внутри Telegram'); return; }
    const b = $('channelCheck'); b.disabled = true; b.textContent = '⏳ Проверяем...';
    const r = await api('/api/channel/check', { method: 'POST', body: { telegram_id: playerId, opened: channelOpened } });
    b.disabled = false; b.textContent = '✅ 2. Я подписался — забрать';
    if (!r.ok || !r.data) { showToast('⚠️ Нет связи с сервером, попробуйте ещё раз'); return; }
    if (!r.data.member) { Sound.nope(); haptic('warning'); showToast('Подписка не найдена 🤔 Нажмите «Открыть канал» и подпишитесь'); return; }
    state.channelClaimed = true; state.tips.channel = true; saveNow();
    closeModal('modalChannel');
    if (r.data.reward) await showReward(r.data.reward, { title: 'Спасибо за подписку!', sub: 'Новости, ивенты и промокоды — в канале 📢', icon: '📢' });
    else showToast('✅ Награда за подписку уже получена');
    if (currentScreen === 'screenHome') renderHome(); else if (currentScreen === 'screenQuests') renderQuests();
  });
  $('channelTeaser').addEventListener('click', () => { Sound.click(); openChannel(); });
  $('setChannel').addEventListener('click', () => { closeModal('modalSettings'); openChannel(); });
  // Одно приглашение после 3-го пройденного уровня (если не подписан)
  function maybeChannelPromo() {
    if (channelDone() || state.tips.channel || state.unlockedLevel < 4 || playerId === 'guest') return;
    setTimeout(() => {
      if (currentScreen !== 'screenHome' || anyModalOpen() || state.tips.channel || channelDone()) return;
      state.tips.channel = true; saveState();
      openChannel();
    }, 1200);
  }

  function shareText(text) {
    const url = `https://t.me/share/url?url=${encodeURIComponent(refLink())}&text=${encodeURIComponent(text)}`;
    try { if (tg && tg.openTelegramLink) { tg.openTelegramLink(url); return; } } catch (e) { /* noop */ }
    if (navigator.share) { navigator.share({ title: 'Fruit Blitz', text, url: refLink() }).catch(() => {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + refLink()).then(() => showToast('Ссылка скопирована!'));
  }
  function renderSettings() {
    $('setSoundVal').className = 'toggle' + (state.sound ? ' on' : '');
    $('setVibroVal').className = 'toggle' + (state.vibration ? ' on' : '');
    $('setNotifyVal').className = 'toggle' + (notifyOn ? ' on' : '');
    $('settingsInfo').textContent = `ID: ${playerId} · Fruit Blitz v3`;
  }
  $('btnSettings').addEventListener('click', () => { renderSettings(); openModal('modalSettings'); });
  $('setSound').addEventListener('click', () => { state.sound = !state.sound; saveState(); renderSettings(); if (state.sound) Sound.click(); });
  $('setVibro').addEventListener('click', () => { state.vibration = !state.vibration; saveState(); renderSettings(); haptic('medium'); });
  $('setNotify').addEventListener('click', async () => {
    if (playerId === 'guest') { showToast('Доступно внутри Telegram'); return; }
    notifyOn = !notifyOn; renderSettings();
    const r = await api('/api/notify', { method: 'POST', body: { telegram_id: playerId, on: notifyOn } });
    if (!r.ok) { notifyOn = !notifyOn; renderSettings(); showToast('⚠️ Нет связи с сервером'); return; }
    showToast(notifyOn ? '🔔 Бот напомнит о жизнях и подарках' : '🔕 Напоминания выключены');
  });
  $('setShareProfile').addEventListener('click', () => { closeModal('modalSettings'); shareProfile(); });
  $('setTutorial').addEventListener('click', () => { state.tips = {}; state.tutorialDone = false; saveState(); closeModal('modalSettings'); showScreen('screenHome'); setTimeout(homeTutorial, 300); });
  $('setInvite').addEventListener('click', () => shareText('Играю в Fruit Blitz — залипательные три в ряд прямо в Telegram 🍓 Заходи!'));

  let noLivesTimer = null;
  function openNoLives() {
    openModal('modalNoLives');
    const upd = () => {
      tickLives();
      if (state.lives > 0 || hasInfiniteLives()) { $('noLivesTimer').textContent = '❤️ Жизнь восстановилась!'; return; }
      $('noLivesTimer').textContent = 'Следующая жизнь через ' + mmss((state.nextLifeAt || Date.now()) - Date.now());
    };
    upd(); clearInterval(noLivesTimer); noLivesTimer = setInterval(() => { if ($('modalNoLives').classList.contains('hidden')) clearInterval(noLivesTimer); else upd(); }, 1000);
  }
  $('btnRefillGems').addEventListener('click', () => { if (!trySpend('gems', 6)) return; refillLives(); saveState(); renderHud(); closeModal('modalNoLives'); Sound.win(); showToast('❤️ Жизни восполнены!'); });
  $('btnRefillCoins').addEventListener('click', () => { if (!trySpend('coins', 250)) return; refillLives(); saveState(); renderHud(); closeModal('modalNoLives'); Sound.win(); showToast('❤️ Жизни восполнены!'); });

  /* ============================================================
     16. ОБУЧЕНИЕ (подсказки-«коучи» с рукой)
     ============================================================ */
  let coachFocusEl = null, coachTimer = null, coachOnBtn = null;
  function showCoach(o) {
    hideCoach();
    $('coachText').innerHTML = o.text;
    const bubble = $('coachBubble'), hand = $('coachHand');
    bubble.style.top = ''; bubble.style.bottom = '';
    if (o.target) {
      coachFocusEl = o.target; o.target.classList.add('coach-focus');
      const r = o.target.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.5) bubble.style.bottom = (window.innerHeight - r.top + 30) + 'px';
      else bubble.style.top = (r.bottom + 34) + 'px';
    } else if (o.pos === 'bottom' && !((o.hand && Math.max(o.hand.from.y, o.hand.to.y) > window.innerHeight * 0.55) || (o.tap && o.tap.y > window.innerHeight * 0.55))) bubble.style.bottom = 'calc(var(--safe-bottom) + 120px)';
    else bubble.style.top = 'calc(var(--safe-top) + 64px)';
    const btn = $('coachBtn');
    btn.classList.toggle('hidden', !o.btn);
    btn.textContent = o.btn || 'Понятно';
    coachOnBtn = o.onBtn || null;
    hand.classList.add('hidden'); hand.classList.remove('tap');
    if (o.hand) {
      hand.style.left = o.hand.from.x + 'px'; hand.style.top = o.hand.from.y + 'px';
      hand.style.setProperty('--dx', (o.hand.to.x - o.hand.from.x) + 'px');
      hand.style.setProperty('--dy', (o.hand.to.y - o.hand.from.y) + 'px');
      hand.classList.remove('hidden');
    } else if (o.tap) {
      hand.style.left = o.tap.x + 'px'; hand.style.top = o.tap.y + 'px';
      hand.classList.add('tap'); hand.classList.remove('hidden');
    }
    $('coach').classList.remove('hidden');
    if (o.autoHide) coachTimer = setTimeout(hideCoach, o.autoHide);
  }
  function hideCoach() {
    clearTimeout(coachTimer);
    $('coach').classList.add('hidden');
    if (coachFocusEl) coachFocusEl.classList.remove('coach-focus');
    coachFocusEl = null;
  }
  $('coachBtn').addEventListener('click', () => { const f = coachOnBtn; coachOnBtn = null; hideCoach(); if (f) f(); });

  function homeTutorial() {
    if (state.tutorialDone || currentScreen !== 'screenHome') return;
    if (anyModalOpen()) { setTimeout(homeTutorial, 800); return; } // сначала игрок закроет окно (подарок и т.п.)
    showCoach({ text: 'Привет! Я Клубничка 🍓<br>Нажми <b>ИГРАТЬ</b> — пройдём первый уровень вместе!', target: $('btnHomePlay') });
  }
  function levelTutorials() {
    if (!board.st || currentScreen !== 'screenGame') return;
    const n = board.level, cfg = board.cfg;
    if (n === 1 && !state.tips.swap) {
      const h = E.findHint(board.st, false);
      if (h && h.a) showCoach({ pos: 'bottom', text: 'Проведи пальцем по фрукту к соседнему, чтобы собрать <b>3 одинаковых в ряд</b>!', hand: { from: screenPt(h.a.r, h.a.c), to: screenPt(h.b.r, h.b.c) } });
      return;
    }
    const mech = cfg.newMechanic;
    if (mech && mech !== 'swap' && MECHANIC_INFO[mech] && !state.tips['m_' + mech]) {
      showCoach({ pos: 'bottom', text: MECHANIC_INFO[mech], btn: 'Понятно!', onBtn: () => { state.tips['m_' + mech] = true; saveState(); } });
      return;
    }
    if (n >= 4 && !state.tips.boosters) {
      showCoach({ text: 'Внизу — <b>бустеры</b> 🔨🚀💣🌈. Они <b>не тратят ходы</b>! Нажми бустер, потом клетку.', target: $('boosterBar'), btn: 'Понятно!', onBtn: () => { state.tips.boosters = true; saveState(); } });
    }
  }
  function tutorialAfterTurn() {
    if (!board.st) return;
    if (board.level === 1 && !state.tips.swap) {
      state.tips.swap = true; saveState();
      showCoach({ pos: 'bottom', text: 'Отлично! 🎉 Цель уровня — вверху. <b>Ходы не ограничены</b>, но чем меньше ходов, тем больше ⭐!', btn: 'Понятно', autoHide: 7000 });
      return;
    }
    if (board.createdSpecial && !state.tips.special) {
      state.tips.special = true; saveState();
      let spot = null;
      for (let r = 0; r < board.st.size && !spot; r++) for (let c = 0; c < board.st.size; c++) { const t = board.st.tiles[r][c]; if (t && t.s && !board.st.lock[r][c]) { spot = { r, c }; break; } }
      showCoach({ pos: 'bottom', text: '<b>Супер-фишка!</b> 💥 Нажми на неё, чтобы взорвать, или поменяй местами с соседней. Две супер-фишки вместе — мега-взрыв!', tap: spot ? screenPt(spot.r, spot.c) : null, btn: 'Круто!' });
    }
  }

  /* ============================================================
     17. СЕРВЕР: облачное сохранение, начисления админа, подарки
     ============================================================ */
  async function api(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (initData) headers['X-Telegram-Init-Data'] = initData;
    try {
      const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
      let data = null;
      try { data = await res.json(); } catch (e) { /* noop */ }
      return { ok: res.ok, status: res.status, data };
    } catch (e) { return { ok: false, status: 0, data: null }; }
  }
  let syncing = false, syncTimer = null;
  function scheduleSync(delay) { if (playerId === 'guest') return; clearTimeout(syncTimer); syncTimer = setTimeout(syncWithServer, delay == null ? 2500 : delay); }
  function userQS() { return new URLSearchParams({ telegram_id: playerId, name: tgUser ? tgUser.first_name || '' : '', username: tgUser ? tgUser.username || '' : '' }).toString(); }
  function progressPayload() {
    return { telegram_id: playerId, name: tgUser ? tgUser.first_name : '', username: tgUser ? tgUser.username : '',
      level: state.unlockedLevel, totalStars: totalStars(), starsBank: state.starsBank, coins: state.coins, gems: state.gems,
      lives: state.lives, boosters: state.boosters, legendary: state.legendary, score: state.stats.bestScore, adminRev: state.adminRev,
      tz: -new Date().getTimezoneOffset(), timers: reminderTimers(), passUnclaimed: passClaimable(), pub: pubPayload() };
  }
  // Когда что-то снова станет доступно — сервер напомнит через бота, если игрок не зашёл сам
  function reminderTimers() {
    const t = Date.now();
    let livesAt = 0;
    if (!hasInfiniteLives() && state.lives < MAX_LIVES && state.nextLifeAt) livesAt = state.nextLifeAt + (MAX_LIVES - state.lives - 1) * LIFE_REGEN_MS;
    const giftAt = (state.freeGiftLast || 0) + 4 * 3600000, wheelAt = (state.wheelLast || 0) + 24 * 3600000;
    return { livesAt, giftAt: giftAt > t ? giftAt : 0, wheelAt: wheelAt > t ? wheelAt : 0 };
  }
  let notifyOn = true;
  function showBlocked(id) { $(id).classList.remove('hidden'); }
  async function syncWithServer() {
    if (playerId === 'guest' || syncing) return;
    if (board.st && board.busy && !board.done && currentScreen === 'screenGame') { scheduleSync(1500); return; }
    syncing = true;
    try {
      const pull = await api('/api/player-sync?' + userQS());
      if (pull.status === 403 || (pull.data && pull.data.player && pull.data.player.isBanned)) { showBlocked('bannedScreen'); return; }
      if (!pull.ok || !pull.data || !pull.data.success) return;
      $('bannedScreen').classList.add('hidden');
      applyServerSettings(pull.data.settings);
      mergeServerPlayer(pull.data.player);
      if (pull.data.player.notify) notifyOn = pull.data.player.notify.on !== false;
      if (pull.data.player.channelRewarded && !state.channelClaimed) { state.channelClaimed = true; saveState(); }
      if (MK()) MK().refresh();
      let push = await api('/api/save-progress', { method: 'POST', body: progressPayload() });
      if (push.status === 409 && push.data && push.data.player) {
        mergeServerPlayer(push.data.player);
        push = await api('/api/save-progress', { method: 'POST', body: progressPayload() });
      }
      if (push.status === 403) showBlocked('bannedScreen');
    } catch (e) { /* офлайн — попробуем позже */ } finally { syncing = false; }
  }
  function mergeServerPlayer(sp) {
    if (!sp) return;
    let changed = false;
    if (sp.resetToken && sp.resetToken !== state.resetToken) {
      const fresh = defaultState();
      fresh.sound = state.sound; fresh.vibration = state.vibration; fresh.fresh = false;
      fresh.tutorialDone = true; fresh.tips = { swap: true, special: true, garden: true, boosters: true };
      fresh.resetToken = sp.resetToken; fresh.adminRev = sp.adminRev || 0;
      state = fresh;
      showToast('🔄 Прогресс сброшен администратором');
      changed = true;
    }
    if (state.fresh && sp.bestLevel > 1) {
      state.unlockedLevel = sp.bestLevel; state.coins = sp.coins; state.gems = sp.gems; state.starsBank = sp.starsBank;
      BOOSTER_KEYS.forEach((k) => { state.boosters[k] = sp.boosters[k] || 0; });
      LEGENDARY_KEYS.forEach((k) => { state.legendary[k] = (sp.legendary && sp.legendary[k]) || 0; });
      state.tutorialDone = true; state.tips = { swap: true, special: true, garden: true, boosters: true };
      state.adminRev = sp.adminRev || 0;
      showToast('☁️ Прогресс восстановлен из облака');
      changed = true;
    }
    state.fresh = false;
    if ((sp.adminRev || 0) > (state.adminRev || 0)) {
      state.coins = sp.coins; state.gems = sp.gems; state.lives = sp.lives;
      state.nextLifeAt = state.lives < MAX_LIVES ? Date.now() + LIFE_REGEN_MS : null;
      state.unlockedLevel = Math.max(1, sp.bestLevel); state.starsBank = sp.starsBank;
      BOOSTER_KEYS.forEach((k) => { state.boosters[k] = sp.boosters[k] || 0; });
      LEGENDARY_KEYS.forEach((k) => { state.legendary[k] = (sp.legendary && sp.legendary[k]) || 0; });
      state.adminRev = sp.adminRev;
      showToast('🎁 Ваш аккаунт обновлён');
      changed = true;
    }
    if (changed) {
      saveNow(); renderHud();
      if (currentScreen === 'screenGame') renderBoosterBar();
      else showScreen(currentScreen);
    }
  }
  function applyServerSettings(s) {
    if (!s) return;
    serverSettings = Object.assign({ maintenanceMode: false, doubleRewards: false, globalGift: null }, s);
    $('maintenanceScreen').classList.toggle('hidden', !(serverSettings.maintenanceMode && !isAdmin));
    const g = serverSettings.globalGift;
    if (g && g.id && !state.claimedGifts[g.id] && currentScreen !== 'screenGame' && !anyModalOpen()) {
      state.claimedGifts[g.id] = true;
      saveNow();
      const rw = { coins: g.coins || 0, gems: g.gems || 0 };
      if (g.booster && g.boosterAmount) rw.boosters = { [g.booster]: g.boosterAmount };
      showReward(rw, { title: 'Подарок для всех!', sub: g.message || '', icon: '💝' });
    }
  }
  async function checkAdmin() {
    if (playerId === 'guest') return false;
    const r = await api('/api/am-i-admin?telegram_id=' + encodeURIComponent(playerId));
    isAdmin = !!(r.ok && r.data && r.data.admin);
    $('adminFab').classList.toggle('hidden', !(isAdmin && currentScreen === 'screenHome'));
    return isAdmin;
  }

  /* ============================================================
     18. АДМИН-ПАНЕЛЬ
     ============================================================ */
  let adminTab = 'stats', adminSel = null, adminPoll = null;
  const aqs = (extra) => new URLSearchParams(Object.assign({ telegram_id: playerId }, extra || {})).toString();
  const abody = (extra) => Object.assign({ telegram_id: playerId }, extra || {});
  qsa('[data-atab]').forEach((b) => b.addEventListener('click', () => { adminTab = b.dataset.atab; qsa('[data-atab]').forEach((x) => x.classList.toggle('active', x === b)); renderAdmin(); }));
  $('adminFab').addEventListener('click', () => { openModal('modalAdmin'); renderAdmin(); });
  function aErr(res) { showToast('⚠️ ' + ((res.data && res.data.error) || 'Ошибка сервера')); }
  async function renderAdmin() {
    const body = $('adminBody');
    clearInterval(adminPoll);
    body.innerHTML = '<p class="empty">Загрузка...</p>';
    if (adminTab === 'stats') {
      const r = await api('/api/admin/stats?' + aqs());
      if (!r.ok) { aErr(r); body.innerHTML = '<p class="empty">Нет доступа</p>'; return; }
      const s = r.data.stats;
      const stat = (l, v) => `<div class="a-stat"><small>${l}</small><b>${v}</b></div>`;
      body.innerHTML = `<div class="a-stats">${stat('👥 Игроков', s.totalUsers)}${stat('🆕 Новых сегодня', s.newToday)}${stat('🟢 DAU', s.dau)}${stat('📅 WAU', s.wau)}
        ${stat('🚩 Ср. уровень', s.avgLevel)}${stat('🏔 Макс. уровень', s.maxLevel)}${stat('🪙 Монет', fmt(s.totalCoins))}${stat('💎 Кристаллов', fmt(s.totalGems))}
        ${stat('⭐ Звёзд', fmt(s.totalStars))}${stat('🚫 Банов', s.banned)}</div>
        <p class="section-label">🏆 Топ по уровню</p>${s.topLevel.map((p, i) => `<div class="a-player"><b>${i + 1}.</b><div class="ap-info"><b>${esc(p.name)}</b><small>ур. ${p.bestLevel} · ⭐${p.totalStars}</small></div></div>`).join('')}
        <p class="section-label">💰 Топ богатых</p>${s.topRich.map((p, i) => `<div class="a-player"><b>${i + 1}.</b><div class="ap-info"><b>${esc(p.name)}</b><small>🪙${fmt(p.coins)} · 💎${p.gems}</small></div></div>`).join('')}
        <p class="section-label">📢 Рассылка всем</p>
        <textarea class="a-textarea" id="aMsg" placeholder="Текст (поддерживается HTML: <b>, <i>)"></textarea>
        <input class="a-input" id="aBtnText" value="🎮 Играть" placeholder="Текст кнопки" />
        <button class="btn btn-primary" id="aSend">Отправить рассылку</button>
        <div id="aProg" class="hidden"><div class="progress"><div class="progress-fill" id="aProgFill"></div></div><p class="muted tiny" id="aProgText"></p></div>`;
      $('aSend').addEventListener('click', async () => {
        const message = $('aMsg').value.trim();
        if (!message) { showToast('Введите текст'); return; }
        if (!(await confirmBox('Отправить рассылку?', 'Сообщение получат все игроки.', 'Отправить'))) return;
        const res = await api('/api/admin/broadcast', { method: 'POST', body: abody({ message, buttonText: $('aBtnText').value.trim(), withButton: true }) });
        if (!res.ok) { aErr(res); return; }
        $('aProg').classList.remove('hidden');
        adminPoll = setInterval(async () => {
          const st = await api('/api/admin/broadcast/status?' + aqs());
          if (!st.ok || !$('aProgFill')) { clearInterval(adminPoll); return; }
          const d = st.data, done = d.sent + d.failed;
          $('aProgFill').style.width = (d.total ? done / d.total * 100 : 100) + '%';
          $('aProgText').textContent = `${done}/${d.total} · ✅ ${d.sent} · ❌ ${d.failed}`;
          if (!d.running) { clearInterval(adminPoll); showToast('Рассылка завершена ✅'); }
        }, 800);
      });
    } else if (adminTab === 'players') {
      body.innerHTML = `<div class="a-row"><input class="a-input" id="aSearch" placeholder="ID, @username или имя" /><button class="btn btn-primary" id="aSearchBtn">🔍</button></div>
        <p class="muted tiny" id="aCount"></p><div class="a-list" id="aList"></div><div id="aCard"></div>`;
      $('aSearchBtn').addEventListener('click', () => adminLoadList($('aSearch').value.trim()));
      $('aSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') adminLoadList($('aSearch').value.trim()); });
      await adminLoadList('');
      if (adminSel) adminSelect(adminSel);
    } else if (adminTab === 'gift') {
      const r = await api('/api/admin/settings?' + aqs());
      const g = r.ok ? r.data.settings.globalGift : null;
      body.innerHTML = `<p class="muted">Подарок получат <b>все игроки</b> при следующем входе (один раз каждый).</p>
        ${g ? `<div class="a-card">Активный подарок: 🪙${g.coins} 💎${g.gems}${g.booster ? ' ' + BOOSTERS[g.booster].icon + '×' + g.boosterAmount : ''}<br><small class="muted">${esc(g.message)}</small><button class="btn btn-danger" id="aGiftClear">Отменить подарок</button></div>` : ''}
        <div class="a-field"><label>Монеты</label><input class="a-input" id="gCoins" type="number" value="500" /></div>
        <div class="a-field"><label>Кристаллы</label><input class="a-input" id="gGems" type="number" value="10" /></div>
        <div class="a-field"><label>Бустер</label><div class="a-row"><select class="a-select" id="gBooster"><option value="">— нет —</option>${BOOSTER_KEYS.map((k) => `<option value="${k}">${BOOSTERS[k].icon} ${BOOSTERS[k].name}</option>`).join('')}</select><input class="a-input" id="gBAmt" type="number" value="1" style="max-width:80px" /></div></div>
        <div class="a-field"><label>Сообщение</label><input class="a-input" id="gMsg" value="Спасибо, что играете в Fruit Blitz! 💝" /></div>
        <button class="btn btn-gold" id="aGiftSend">🎁 Отправить подарок всем</button>`;
      if ($('aGiftClear')) $('aGiftClear').addEventListener('click', async () => { const res = await api('/api/admin/settings', { method: 'POST', body: abody({ globalGift: null }) }); if (res.ok) { showToast('Подарок отменён'); renderAdmin(); } else aErr(res); });
      $('aGiftSend').addEventListener('click', async () => {
        const gift = { coins: +$('gCoins').value || 0, gems: +$('gGems').value || 0, booster: $('gBooster').value || null, boosterAmount: +$('gBAmt').value || 0, message: $('gMsg').value };
        const res = await api('/api/admin/settings', { method: 'POST', body: abody({ globalGift: gift }) });
        if (res.ok) { showToast('🎁 Подарок отправлен всем!'); renderAdmin(); } else aErr(res);
      });
    } else if (adminTab === 'analytics') {
      const r = await api('/api/admin/analytics?' + aqs());
      if (!r.ok) { aErr(r); body.innerHTML = '<p class="empty">Нет доступа</p>'; return; }
      const a = r.data.a;
      const stat = (l, v, sub) => `<div class="a-stat"><small>${l}</small><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
      const ret = (x) => (x.rate == null ? '—' : x.rate + '%');
      const retSub = (x) => (x.cohort ? `${x.kept} из ${x.cohort}` : 'мало данных');
      const bars = (vals, fmtv, color) => {
        const max = Math.max(1, ...vals.map((v) => v.v));
        return `<div class="an-bars">${vals.map((v) => `<div class="an-bar"><i style="height:${Math.max(2, v.v / max * 100)}%;background:${color}"></i><b>${fmtv(v.v)}</b><small>${v.l}</small></div>`).join('')}</div>`;
      };
      const dl = (d) => d.slice(8, 10) + '.' + d.slice(5, 7);
      const stuck = a.levels.filter((l) => l.stuck).sort((x, y) => y.stuck - x.stuck).slice(0, 6);
      const hard = a.levels.filter((l) => l.s >= 5 && l.winRate != null).sort((x, y) => x.winRate - y.winRate).slice(0, 6);
      const maxStuck = Math.max(1, ...stuck.map((l) => l.stuck));
      const e7 = a.events7, n7 = a.notif7;
      const sumK = (o, pre) => Object.keys(o).filter((k) => k.startsWith(pre)).reduce((s2, k) => s2 + o[k], 0);
      const NT = { lives: '❤️ Жизни', gift: '🎁 Подарок', wheel: '🎡 Колесо', away2: '🍓 2 дня', away7: '🌳 7 дней', season: '⏳ Сезон', test: '🧪 Тест' };
      body.innerHTML = `<p class="muted tiny">Данные собираются с ${new Date(a.since).toLocaleDateString('ru-RU')}. Удержание считается только по игрокам, пришедшим после этой даты.</p>
        <div class="a-stats">${stat('🟢 Сегодня', a.dau)}${stat('📅 За 7 дней', a.wau)}${stat('🗓 За 30 дней', a.mau)}${stat('👥 Всего', a.total)}</div>
        <p class="section-label">🔁 Удержание (вернулись через N дней)</p>
        <div class="a-stats">${stat('День 1', ret(a.ret.d1), retSub(a.ret.d1))}${stat('День 7', ret(a.ret.d7), retSub(a.ret.d7))}${stat('День 30', ret(a.ret.d30), retSub(a.ret.d30))}</div>
        <p class="muted tiny">Ориентир для казуальных игр: день 1 — 30–40%, день 7 — 10–15%.</p>
        <p class="section-label">👥 Игроков в день (14 дней)</p>${bars(a.days.map((d) => ({ v: d.dau, l: dl(d.d) })), (v) => v, 'linear-gradient(180deg,#5ef0a0,#20b464)')}
        <p class="section-label">🆕 Новые игроки</p>${bars(a.days.map((d) => ({ v: d.newU, l: dl(d.d) })), (v) => v, 'linear-gradient(180deg,#8fd3ff,#3b82f6)')}
        <p class="section-label">⭐ Выручка в Stars</p>${bars(a.days.map((d) => ({ v: d.stars, l: dl(d.d) })), (v) => v, 'linear-gradient(180deg,#ffe066,#f5a623)')}
        <p class="section-label">🚪 Где бросают игру</p>
        <p class="muted tiny">Уровень, на котором остановились игроки, не заходившие 3+ дня</p>
        ${stuck.length ? stuck.map((l) => `<div class="an-row"><b>Ур. ${l.n}</b><span class="an-line"><i style="width:${l.stuck / maxStuck * 100}%"></i></span><span>${l.stuck} игр.</span></div>`).join('') : '<p class="muted tiny">Пока никто не ушёл 👍</p>'}
        <p class="section-label">🔥 Самые сложные уровни</p>
        ${hard.length ? hard.map((l) => `<div class="an-row"><b>Ур. ${l.n}</b><span class="an-line hard"><i style="width:${l.winRate}%"></i></span><span>${l.winRate}% побед</span></div>`).join('') : '<p class="muted tiny">Нужно минимум 5 попыток на уровень</p>'}
        <p class="section-label">📋 Все уровни</p>
        <div class="an-table-wrap"><table class="an-table"><thead><tr><th>Ур.</th><th>Попыток</th><th>Побед</th><th>Выходов</th><th>Ходы</th><th>Время</th><th>⭐</th><th>Застряли</th></tr></thead><tbody>
        ${a.levels.map((l) => `<tr class="${l.winRate != null && l.winRate < 50 && l.s >= 5 ? 'warn' : ''}"><td>${l.n}</td><td>${l.s}</td><td>${l.winRate == null ? '—' : l.winRate + '%'}</td><td>${l.q}</td><td>${l.avgMoves == null ? '—' : l.avgMoves}</td><td>${l.avgSec == null ? '—' : l.avgSec + 'с'}</td><td>${l.avgStars == null ? '—' : l.avgStars}</td><td>${l.stuck || ''}</td></tr>`).join('') || '<tr><td colspan="8">Нет данных</td></tr>'}
        </tbody></table></div>
        <p class="section-label">🔔 Напоминания от бота</p>
        <button class="setting-row" id="anRem"><span>Автоматические напоминания</span><b class="toggle ${a.remindersEnabled ? 'on' : ''}"></b></button>
        <div class="a-stats">${Object.keys(NT).filter((k) => k !== 'test').map((k) => stat(NT[k], n7[k] || 0)).join('')}${stat('🔕 Отключили', a.notifyOff)}${stat('🚫 Бот заблокирован', a.notifyBlocked)}</div>
        <p class="muted tiny">Отправлено за 7 дней. Правила: не больше 2 сообщений в день, между ними от 4 ч, только с 9:00 до 22:00 по времени игрока.</p>
        <button class="btn btn-ghost" id="anTest">🧪 Прислать тестовое напоминание себе</button>
        <p class="section-label">📢 Канал ${esc(a.channel.name)}</p>
        <div class="a-stats">${stat('Подписались за награду', a.channel.joined)}${stat('За 7 дней', e7.channel_join || 0)}${stat('Открыли канал (7 дн.)', e7.channel_open || 0)}${stat('Проверка', a.channel.verify.ok === false ? '⚠️ нет' : a.channel.verify.ok ? '✅ работает' : '—')}</div>
        ${a.channel.verify.ok === false ? `<p class="muted tiny" style="color:#ff9aac">Бот не может проверить подписку (${esc(a.channel.verify.error || '')}). Добавьте бота администратором канала — пока награда выдаётся без проверки.</p>` : ''}
        <button class="btn btn-ghost" id="anChan">🔍 Проверить бота в канале</button>
        <p class="section-label">📤 Поделиться и 🎟️ пропуск (7 дней)</p>
        <div class="a-stats">${stat('Открыли окно', sumK(e7, 'share_open'))}${stat('Отправили', sumK(e7, 'share:'))}${stat('Открыли пропуск', e7.pass_open || 0)}${stat('👑 Премиум в сезоне', a.passBuyers)}</div>`;
      $('anRem').addEventListener('click', async () => {
        const res = await api('/api/admin/reminders', { method: 'POST', body: abody({ enabled: !a.remindersEnabled }) });
        if (!res.ok) { aErr(res); return; }
        showToast(res.data.enabled ? '🔔 Напоминания включены' : '🔕 Напоминания выключены'); renderAdmin();
      });
      $('anChan').addEventListener('click', async () => {
        const res = await api('/api/admin/channel-test', { method: 'POST', body: abody() });
        if (!res.ok) { aErr(res); return; }
        const d = res.data;
        showToast(d.verifyOk ? `✅ Бот видит канал ${d.channel}. Вы ${d.member ? 'подписаны' : 'не подписаны'}` : '⚠️ Бот не админ канала: ' + (d.error || ''));
      });
      $('anTest').addEventListener('click', async () => {
        const res = await api('/api/admin/reminders/test', { method: 'POST', body: abody() });
        showToast(res.ok && res.data.success ? '✅ Отправлено — проверьте чат с ботом' : '⚠️ ' + ((res.data && res.data.error) || 'Ошибка'));
      });
    } else if (adminTab === 'news') {
      const r = await api('/api/admin/news?' + aqs());
      if (!r.ok) { aErr(r); body.innerHTML = '<p class="empty">Нет доступа</p>'; return; }
      const d = r.data;
      const MODES = [['preview', '👀 Сначала мне'], ['auto', '⚡ Сразу в канал'], ['off', '⏸ Выкл']];
      const dt = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      body.innerHTML = `<p class="muted tiny">Канал: <b>${esc(d.channel)}</b>. Бот должен быть его администратором с правом «Публикация сообщений».</p>
        <button class="btn btn-ghost" id="nwCheck">🔍 Проверить права бота</button>
        <p class="section-label">🚀 После каждого обновления</p>
        <div class="nw-modes">${MODES.map(([k, n]) => `<button class="tab ${d.mode === k ? 'active' : ''}" data-nwmode="${k}">${n}</button>`).join('')}</div>
        <p class="muted tiny">${d.mode === 'preview' ? 'После деплоя бот пришлёт вам готовый пост с кнопками «Опубликовать» / «Пропустить».' : d.mode === 'auto' ? 'После деплоя пост о новом обновлении сразу уйдёт в канал.' : 'Автоматические посты выключены — публикуйте вручную ниже.'}</p>
        <p class="section-label">📋 Обновления (changelog.js)</p>
        ${d.releases.map((x) => `<div class="nw-rel"><div class="nw-rel-top"><span class="nw-emo">${esc(x.emoji || '🎉')}</span><div class="ap-info"><b>${esc(x.version ? x.version + ' · ' : '')}${esc(x.title)}</b>
          <small>${x.posted ? '✅ опубликовано ' + dt(x.posted.at) : x.skipped ? '🚫 пропущено' : '⏳ не опубликовано'}${x.banner ? ' · 🖼 баннер' : ''}</small></div></div>
          <div class="btn-row"><button class="btn btn-ghost btn-small" data-nwprev="${esc(x.id)}">👀 Мне</button>${x.posted ? '' : `<button class="btn btn-primary btn-small" data-nwpub="${esc(x.id)}">📢 В канал</button>`}</div></div>`).join('') || '<p class="muted tiny">changelog.js пуст</p>'}
        <p class="section-label">✏️ Свой пост</p>
        <textarea class="a-textarea nw-text" id="nwText" placeholder="Текст поста. Можно <b>жирный</b> и <i>курсив</i>.&#10;&#10;Например: 🎉 Выходные x2 монет!"></textarea>
        <div class="nw-img"><label class="btn btn-ghost btn-small" for="nwFile">🖼 Картинка</label><input type="file" id="nwFile" accept="image/*" hidden><span class="muted tiny" id="nwImgInfo">без картинки</span><img id="nwImgPrev" class="hidden" alt=""></div>
        <label class="muted tiny nw-chk"><input type="checkbox" id="nwBtn" checked> Кнопка «🎮 Играть» под постом</label>
        <div class="btn-row"><button class="btn btn-ghost" id="nwPrev">👀 Себе</button><button class="btn btn-primary" id="nwPub">📢 В канал</button></div>
        ${d.history.length ? `<p class="section-label">🕘 Последние посты</p>${d.history.slice(0, 8).map((h) => `<div class="a-player"><div class="ap-info"><b>${h.kind === 'release' ? '🚀 ' : '✏️ '}${esc(h.title)}</b><small>${dt(h.at)}</small></div></div>`).join('')}` : ''}`;
      let nwImg = null;
      $('nwCheck').addEventListener('click', async () => {
        const res = await api('/api/admin/news/check', { method: 'POST', body: abody() });
        if (!res.ok) { aErr(res); return; }
        showToast(res.data.ok ? '✅ Бот может публиковать в канал' : '⚠️ ' + (res.data.error || 'Нет доступа к каналу'));
      });
      qsa('[data-nwmode]', body).forEach((b) => b.addEventListener('click', async () => {
        const res = await api('/api/admin/news/mode', { method: 'POST', body: abody({ mode: b.dataset.nwmode }) });
        if (!res.ok) { aErr(res); return; }
        renderAdmin();
      }));
      const relAction = async (id, preview) => {
        if (!preview && !(await confirmBox('Опубликовать в канал?', 'Пост увидят все подписчики.', 'Опубликовать'))) return;
        const res = await api('/api/admin/news/release', { method: 'POST', body: abody({ id, preview }) });
        if (!res.ok) { aErr(res); return; }
        showToast(preview ? '👀 Предпросмотр отправлен вам в бота' : '✅ Опубликовано!');
        if (!preview) renderAdmin();
      };
      qsa('[data-nwprev]', body).forEach((b) => b.addEventListener('click', () => relAction(b.dataset.nwprev, true)));
      qsa('[data-nwpub]', body).forEach((b) => b.addEventListener('click', () => relAction(b.dataset.nwpub, false)));
      $('nwFile').addEventListener('change', (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 1600 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          nwImg = cv.toDataURL('image/jpeg', 0.88);
          $('nwImgPrev').src = nwImg; $('nwImgPrev').classList.remove('hidden');
          $('nwImgInfo').textContent = `${cv.width}×${cv.height} · нажмите на превью, чтобы убрать`;
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(f);
      });
      $('nwImgPrev').addEventListener('click', () => { nwImg = null; $('nwImgPrev').classList.add('hidden'); $('nwImgInfo').textContent = 'без картинки'; $('nwFile').value = ''; });
      const sendPost = async (preview) => {
        const text = $('nwText').value.trim();
        if (!text) { showToast('Введите текст поста'); return; }
        if (!preview && !(await confirmBox('Опубликовать в канал?', 'Пост увидят все подписчики.', 'Опубликовать'))) return;
        const res = await api('/api/admin/news/post', { method: 'POST', body: abody({ text, image: nwImg, withButton: $('nwBtn').checked, preview }) });
        if (!res.ok) { aErr(res); return; }
        showToast(preview ? '👀 Предпросмотр отправлен вам в бота' : '✅ Пост опубликован!');
        if (!preview) { $('nwText').value = ''; renderAdmin(); }
      };
      $('nwPrev').addEventListener('click', () => sendPost(true));
      $('nwPub').addEventListener('click', () => sendPost(false));
    } else if (adminTab === 'eco') {
      if (MK()) MK().renderAdminEco(body);
    } else if (adminTab === 'global') {
      const r = await api('/api/admin/settings?' + aqs());
      if (!r.ok) { aErr(r); return; }
      const s = r.data.settings;
      body.innerHTML = `<button class="setting-row" id="aMaint"><span>🛠 Техработы<br><small class="muted">Вход только для админов</small></span><b class="toggle ${s.maintenanceMode ? 'on' : ''}"></b></button>
        <button class="setting-row" id="aDouble"><span>🎉 Ивент ×2 монеты<br><small class="muted">За прохождение уровней</small></span><b class="toggle ${s.doubleRewards ? 'on' : ''}"></b></button>`;
      $('aMaint').addEventListener('click', async () => { const res = await api('/api/admin/settings', { method: 'POST', body: abody({ maintenanceMode: !s.maintenanceMode }) }); if (res.ok) { applyServerSettings(res.data.settings); renderAdmin(); } else aErr(res); });
      $('aDouble').addEventListener('click', async () => { const res = await api('/api/admin/settings', { method: 'POST', body: abody({ doubleRewards: !s.doubleRewards }) }); if (res.ok) { serverSettings.doubleRewards = res.data.settings.doubleRewards; renderAdmin(); } else aErr(res); });
    } else {
      const cheats = [
        ['+10 000 🪙', () => addCoins(10000)], ['+500 💎', () => { state.gems += 500; }],
        ['+10 уровней 🔓', () => { state.unlockedLevel += 10; }], ['+30 ⭐ в Сад', () => { state.starsBank += 30; }],
        ['Бустеры +10 🚀', () => BOOSTER_KEYS.forEach((k) => { state.boosters[k] += 10; })],
        [state.infiniteLives ? '♾️ Жизни: ВКЛ' : '♾️ Жизни: выкл', () => { state.infiniteLives = !state.infiniteLives; }],
        ['Сбросить таймеры ⏱', () => { state.wheelLast = 0; state.freeGiftLast = 0; state.login.last = null; state.daily = null; }],
        ['Обучение заново 🎓', () => { state.tips = {}; state.tutorialDone = false; }]
      ];
      body.innerHTML = `<p class="muted">Применяются к вашему аккаунту.</p><div class="a-grid">${cheats.map((c, i) => `<button class="btn btn-ghost" data-ch="${i}">${c[0]}</button>`).join('')}</div>`;
      qsa('[data-ch]', body).forEach((b) => b.addEventListener('click', () => { cheats[+b.dataset.ch][1](); saveNow(); renderHud(); scheduleSync(300); Sound.coin(); showToast('Готово!'); renderAdmin(); updateBadges(); }));
    }
  }
  async function adminLoadList(q) {
    const r = await api('/api/admin/players?' + aqs(q ? { q } : {}));
    const list = $('aList');
    if (!list) return;
    if (!r.ok) { aErr(r); return; }
    $('aCount').textContent = `Найдено: ${r.data.total}`;
    list.innerHTML = r.data.players.length ? r.data.players.map((p) => `<div class="a-player ${p.id === adminSel ? 'sel' : ''}" data-id="${esc(p.id)}"><div class="avatar">${initialOf(p.name)}</div><div class="ap-info"><b>${esc(p.name)}${p.username ? ' · @' + esc(p.username) : ''}</b><small>ур. ${p.bestLevel} · 🪙${fmt(p.coins)} · 💎${p.gems}</small></div><span class="a-badge ${p.isBanned ? 'ban' : ''}">${p.isBanned ? '🚫 Бан' : 'Активен'}</span></div>`).join('') : '<p class="empty">Никого не найдено</p>';
    qsa('.a-player', list).forEach((row) => row.addEventListener('click', () => { $('aSearch').value = row.dataset.id; adminSelect(row.dataset.id); }));
  }
  async function adminSelect(id) {
    const r = await api('/api/admin/player/' + encodeURIComponent(id) + '?' + aqs());
    if (!r.ok) { aErr(r); return; }
    adminSel = id;
    qsa('.a-player', $('aList')).forEach((row) => row.classList.toggle('sel', row.dataset.id === id));
    renderAdminCard(r.data.player);
  }
  function renderAdminCard(p) {
    const card = $('aCard');
    if (!card) return;
    const numField = (lbl, id, val, actions) => `<div class="a-field"><label>${lbl}</label><div class="a-row"><input class="a-input" id="${id}" type="number" value="${val}" />${actions}</div></div>`;
    card.innerHTML = `<div class="a-card">
      <b style="font-size:16px">${esc(p.name)}</b> ${p.username ? '<span class="muted">@' + esc(p.username) + '</span>' : ''}<br>
      <small class="muted">ID ${esc(p.id)} · с ${new Date(p.createdAt).toLocaleDateString('ru-RU')} · был ${new Date(p.lastSeen).toLocaleString('ru-RU')}</small><br>
      <small>⭐ всего ${p.totalStars} · рефералов ${p.refCount} · ${p.isBanned ? '🚫 ЗАБАНЕН' : '✅ активен'}</small>
      ${numField('🪙 Монеты (сейчас ' + p.coins + ')', 'fCoins', p.coins, '<button class="btn btn-green" data-a="coins-add">+ Добавить</button><button class="btn btn-gold" data-a="coins-set">=</button>')}
      ${numField('💎 Кристаллы (сейчас ' + p.gems + ')', 'fGems', p.gems, '<button class="btn btn-green" data-a="gems-add">+ Добавить</button><button class="btn btn-gold" data-a="gems-set">=</button>')}
      ${numField('❤️ Жизни', 'fLives', p.lives, '<button class="btn btn-gold" data-a="lives">Установить</button>')}
      ${numField('🚩 Открытый уровень', 'fLevel', p.bestLevel, '<button class="btn btn-gold" data-a="level">Установить</button>')}
      ${numField('⭐ Звёзды для Сада', 'fStars', p.starsBank, '<button class="btn btn-gold" data-a="stars">Установить</button>')}
      <div class="a-field"><label>Выдать бустер (есть: ${BOOSTER_KEYS.map((k) => BOOSTERS[k].icon + p.boosters[k]).join(' ')})</label><div class="a-row"><select class="a-select" id="fBooster">${BOOSTER_KEYS.map((k) => `<option value="${k}">${BOOSTERS[k].icon} ${BOOSTERS[k].name}</option>`).join('')}</select><input class="a-input" id="fBAmt" type="number" value="3" style="max-width:70px" /><button class="btn btn-green" data-a="booster">Выдать</button></div></div>
      <div class="a-field"><label>☢️ Легендарный бустер (есть: ${LEGENDARY_KEYS.map((k) => LEGENDARY[k].icon + (p.legendary ? p.legendary[k] : 0)).join(' ')})</label><div class="a-row"><select class="a-select" id="fLegend">${LEGENDARY_KEYS.map((k) => `<option value="${k}">${LEGENDARY[k].icon} ${LEGENDARY[k].name}</option>`).join('')}</select><input class="a-input" id="fLAmt" type="number" value="1" style="max-width:70px" /><button class="btn btn-green" data-a="legend">Выдать</button></div></div>
      <div class="a-grid"><button class="btn ${p.isBanned ? 'btn-green' : 'btn-danger'}" data-a="ban">${p.isBanned ? '✅ Разбанить' : '🚫 Забанить'}</button><button class="btn btn-danger" data-a="reset">🔄 Сбросить прогресс</button></div>
      <p class="muted tiny">Изменения применятся у игрока при следующей синхронизации (до 45 сек или при входе).</p></div>`;
    const v = (id) => Math.floor(Number($(id).value) || 0);
    const acts = {
      'coins-add': () => ({ action: 'update_coins', mode: 'add', value: v('fCoins') }),
      'coins-set': () => ({ action: 'update_coins', mode: 'set', value: v('fCoins') }),
      'gems-add': () => ({ action: 'update_gems', mode: 'add', value: v('fGems') }),
      'gems-set': () => ({ action: 'update_gems', mode: 'set', value: v('fGems') }),
      lives: () => ({ action: 'set_lives', value: v('fLives') }),
      level: () => ({ action: 'set_level', value: v('fLevel') }),
      stars: () => ({ action: 'set_stars', value: v('fStars') }),
      booster: () => ({ action: 'give_booster', booster: $('fBooster').value, value: v('fBAmt') }),
      legend: () => ({ action: 'give_legendary', booster: $('fLegend').value, value: v('fLAmt') }),
      ban: () => ({ action: 'toggle_ban', isBanned: !p.isBanned }),
      reset: () => ({ action: 'reset_progress' })
    };
    qsa('[data-a]', card).forEach((b) => b.addEventListener('click', async () => {
      const key = b.dataset.a;
      if (key === 'reset' && !(await confirmBox('Сбросить прогресс?', 'Игрок потеряет уровни, монеты и бустеры.', 'Сбросить'))) return;
      if ((key === 'coins-add' || key === 'gems-add') && !v(key === 'coins-add' ? 'fCoins' : 'fGems')) { showToast('Введите количество (можно отрицательное)'); return; }
      const res = await api('/api/admin/action', { method: 'POST', body: abody(Object.assign({ target_id: p.id }, acts[key]())) });
      if (!res.ok) { aErr(res); return; }
      renderAdminCard(res.data.player);
      adminLoadList($('aSearch') ? $('aSearch').value.trim() : '');
      Sound.coin(); haptic('success');
      showToast('✅ Данные игрока обновлены!');
      if (p.id === playerId) syncWithServer();
    }));
  }

  /* ============================================================
     19. СОБЫТИЯ, ТАЙМЕРЫ, ЗАПУСК
     ============================================================ */
  qsa('.nav-btn').forEach((b) => b.addEventListener('click', () => { ensureAudio(); if (currentScreen !== b.dataset.nav) { Sound.click(); haptic('select'); showScreen(b.dataset.nav); } }));
  qsa('[data-go]').forEach((b) => b.addEventListener('click', () => { Sound.click(); showScreen(b.dataset.go); }));
  qsa('[data-close]').forEach((b) => b.addEventListener('click', () => { closeModal(b.dataset.close); Sound.click(); }));
  $('hudCoins').addEventListener('click', () => { shopTab = 'currency'; showScreen('screenShop'); });
  $('hudGems').addEventListener('click', () => { shopTab = 'chests'; showScreen('screenShop'); });
  $('hudLives').addEventListener('click', () => { if (!hasInfiniteLives() && state.lives <= 0) openNoLives(); else { shopTab = 'lives'; showScreen('screenShop'); } });
  $('btnHomePlay').addEventListener('click', () => { ensureAudio(); Sound.click(); haptic('medium'); hideCoach(); openIntro(state.unlockedLevel); });
  $('tileMap').addEventListener('click', () => { Sound.click(); showScreen('screenMap'); });
  $('tileLeaders').addEventListener('click', () => { Sound.click(); showScreen('screenLeaders'); });
  $('tileCollection').addEventListener('click', () => { Sound.click(); if (MK()) MK().setTab('inv'); showScreen('screenMarket'); });
  $('chapterCard').addEventListener('click', () => { Sound.click(); showScreen('screenMap'); });
  $('tileWheel').addEventListener('click', () => { Sound.click(); openWheel(); });
  $('tileDaily').addEventListener('click', () => { Sound.click(); if (loginReady()) claimLogin(); else { questTab = 'login'; qsa('[data-qtab]').forEach((x) => x.classList.toggle('active', x.dataset.qtab === 'login')); showScreen('screenQuests'); } });
  $('tileGift').addEventListener('click', () => { Sound.click(); if (giftReady()) claimFreeGift(); else showToast('🎁 Следующий подарок через ' + mmss(4 * 3600000 - (Date.now() - state.freeGiftLast))); });
  $('gardenTeaser').addEventListener('click', () => { Sound.click(); showScreen('screenGarden'); });
  $('questTeaser').addEventListener('click', () => { Sound.click(); questTab = 'daily'; qsa('[data-qtab]').forEach((x) => x.classList.toggle('active', x.dataset.qtab === 'daily')); showScreen('screenQuests'); });
  document.addEventListener('pointerdown', () => ensureAudio(), { once: true });

  // Системная кнопка «Назад» Telegram
  function updateBackButton() {
    if (!tg || !tg.BackButton) return;
    try { if (currentScreen === 'screenHome') tg.BackButton.hide(); else tg.BackButton.show(); } catch (e) { /* noop */ }
  }
  if (tg && tg.BackButton) {
    try {
      tg.BackButton.onClick(() => {
        const open = qsa('.overlay').filter((o) => !o.classList.contains('hidden'));
        if (open.length) { const top = open[open.length - 1]; if (top.id !== 'modalResult' && top.id !== 'modalReward') closeModal(top.id); if (top.id === 'modalPause') { paused = false; scheduleHint(); } return; }
        if (currentScreen === 'screenGame') openPause();
        else showScreen('screenHome');
      });
    } catch (e) { /* noop */ }
  }

  function buildBackground() {
    const bg = $('appBg');
    const fruits = ['🍎', '🍋', '🍇', '🫐', '🍊', '🍓', '🍍', '🍒'];
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('span');
      s.className = 'bg-fruit';
      s.textContent = fruits[i % fruits.length];
      s.style.left = (Math.random() * 92) + '%';
      s.style.fontSize = (18 + Math.random() * 22) + 'px';
      s.style.animationDuration = (16 + Math.random() * 14) + 's';
      s.style.animationDelay = (-Math.random() * 20) + 's';
      bg.appendChild(s);
    }
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('i');
      s.className = 'bg-spark';
      s.style.left = (Math.random() * 100) + '%'; s.style.top = (Math.random() * 100) + '%';
      s.style.animationDelay = (Math.random() * 3) + 's';
      bg.appendChild(s);
    }
  }
  function updateHomeTimers() {
    if (currentScreen !== 'screenHome') return;
    $('wheelHint').textContent = wheelReady() ? 'Бесплатно!' : mmss(24 * 3600000 - (Date.now() - state.wheelLast));
    $('giftHint').textContent = giftReady() ? 'Готов!' : mmss(4 * 3600000 - (Date.now() - state.freeGiftLast));
  }
  setInterval(() => { tickLives(); renderHud(); updateHomeTimers(); }, 1000);
  setInterval(() => { updateBadges(); if (!document.hidden) syncWithServer(); }, 45000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { saveNow(); flushTrack(); syncWithServer(); } else { tickLives(); renderHud(); } });
  window.addEventListener('pagehide', saveNow);

  function checkTitleUnlocks() {
    let changed = false;
    if (state.unlockedLevel > 50 && !state.ownedTitles.legend) { state.ownedTitles.legend = true; if (state.titleAuto) state.equippedTitle = 'legend'; changed = true; }
    if ((state.garden.areasDone || 0) >= 5 && !state.ownedTitles.gardener) { state.ownedTitles.gardener = true; if (state.titleAuto) state.equippedTitle = 'gardener'; changed = true; }
    if (changed) saveState();
  }
  async function boot() {
    const setP = (p, t) => { $('splashFill').style.width = p + '%'; $('splashStatus').textContent = t; };
    initTelegram();
    buildBackground();
    tickLives(); ensureDaily(); checkTitleUnlocks();
    setP(35, 'Собираем фрукты...');
    showScreen('screenHome');
    setP(60, 'Синхронизация...');
    if (playerId !== 'guest') {
      await Promise.race([checkAdmin(), wait(3000)]);
      await Promise.race([syncWithServer(), wait(4000)]);
    } else {
      const s = await Promise.race([api('/api/game-settings'), wait(3000).then(() => null)]);
      if (s && s.ok) applyServerSettings(s.data);
    }
    setP(100, 'Готово!');
    await wait(300);
    $('splash').classList.add('hide');
    showScreen('screenHome');
    if (state.migratedGift) {
      delete state.migratedGift; saveNow();
      showReward(null, { title: 'Большое обновление! 🎉', sub: 'Новая карта, Волшебный Сад, огромный магазин и уровни без лимита ходов. Ваш прогресс сохранён, а ещё мы начислили: 💎10, 💣1, 🌈1 и полные ❤️!', icon: '🎉' });
    } else if (!state.tutorialDone) {
      setTimeout(homeTutorial, 400);
    } else if (loginReady()) {
      setTimeout(claimLogin, 500);
    }
    if (serverSettings.doubleRewards) setTimeout(() => showToast('🎉 Ивент: ×2 монеты за уровни!'), 1500);
  }
  // Мост для модуля маркета (market.js)
  window.FBApp = {
    api, esc, fmt, mmss, showToast, showScreen, openModal, closeModal, confirmBox, showReward, applyReward, rewardItems,
    Sound, haptic, burstConfetti, rainConfetti, flyTo, avatarHtml, initialOf, saveNow, renderHud, tg, playerId, displayName,
    get state() { return state; }, get isAdmin() { return isAdmin; }, get currentScreen() { return currentScreen; },
    refreshScreen() { if (currentScreen !== 'screenGame') showScreen(currentScreen); },
    renderShop() { if (currentScreen === 'screenShop') renderShop(); },
    applyReward, equip,
    shareCard, track,
    onPaid() { if (!$('modalPass').classList.contains('hidden')) renderPass(); if (currentScreen === 'screenHome') renderHome(); }
  };
  // Отладочный доступ для автотестов (только с ?debug в адресе)
  if (/[?&]debug\b/.test(location.search)) window.__FB = { board, E, get state() { return state; }, showScreen };
  boot();
})();
