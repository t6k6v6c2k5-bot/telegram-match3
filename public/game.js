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
    rainbow: { name: 'Радужная', icon: '🌈', unlock: 'Сад: Ягодный пляж' }
  };
  const TITLES = {
    novice: { name: 'Новичок', icon: '🌱', price: 0 },
    baron: { name: 'Фруктовый Барон', icon: '👑', gems: 20 },
    master: { name: 'Мастер Блитца', icon: '⚡', gems: 40 },
    gardener: { name: 'Главный Садовник', icon: '🌳', unlock: 'Сад: Сладкий город' },
    legend: { name: 'Легенда', icon: '🏆', unlock: 'Пройди 50 уровней' }
  };
  const BOOSTERS = {
    hammer: { icon: '🔨', name: 'Молот', desc: 'Разбивает одну фишку или ящик', price: 120 },
    shuffle: { icon: '🔀', name: 'Перемешка', desc: 'Перемешивает всё поле', price: 100 },
    rocket: { icon: '🚀', name: 'Ракета', desc: 'Взрывает ряд и колонку', price: 180 },
    bomb: { icon: '💣', name: 'Бомба', desc: 'Мощный взрыв 5×5', price: 220 },
    rainbow: { icon: '🌈', name: 'Радуга', desc: 'Убирает все фишки одного цвета', price: 300 }
  };
  const BOOSTER_KEYS = Object.keys(BOOSTERS);
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
      ownedTitles: { novice: true }, equippedTitle: 'novice',
      garden: { area: 0, built: [], areasDone: 0 },
      daily: null, login: { last: null, streak: 0 },
      wheelLast: 0, freeGiftLast: 0, starterBought: false, dealDay: null,
      achClaimed: {}, claimedGifts: {},
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
    s.levelStars = raw.levelStars && typeof raw.levelStars === 'object' ? raw.levelStars : {};
    s.claimedChests = raw.claimedChests || {};
    s.ownedSkins = Object.assign({ classic: true }, raw.ownedSkins || {});
    if (!SKINS[s.equippedSkin] || !s.ownedSkins[s.equippedSkin]) s.equippedSkin = 'classic';
    s.ownedFrames = Object.assign({ none: true }, raw.ownedFrames || {});
    if (!FRAMES[s.equippedFrame]) s.equippedFrame = 'none';
    s.ownedTitles = Object.assign({ novice: true }, raw.ownedTitles || {});
    if (!TITLES[s.equippedTitle]) s.equippedTitle = 'novice';
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
    if (rw.skin) state.ownedSkins[rw.skin] = true;
    if (rw.frame) state.ownedFrames[rw.frame] = true;
    if (rw.title) state.ownedTitles[rw.title] = true;
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
  const SCREENS = ['screenHome', 'screenMap', 'screenGame', 'screenShop', 'screenGarden', 'screenQuests', 'screenLeaders', 'screenMarket'];
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
        else { fctx.beginPath(); fctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); fctx.fill(); }
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
    const area = gardenArea(state.garden.area);
    return area.items.some((it, i) => !state.garden.built.includes(i) && state.starsBank >= it[2]);
  }
  function questsClaimable() {
    ensureDaily();
    const q = state.daily.quests.some((id) => { const d = QUEST_POOL.find((x) => x.id === id); return d && !state.daily.claimed[id] && (state.daily.progress[d.stat] || 0) >= d.target; });
    return q || loginReady() || ACHIEVEMENTS.some((a) => achTierReady(a));
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
  function styleTile(el, t) {
    const emojis = skinEmojis();
    let cls = 'tile', emo = '';
    if (t.t === 'ING') { cls += ' c-ing'; emo = '🥥'; }
    else if (t.s === 'rainbow') { cls += ' c-rb'; emo = '🌈'; }
    else { cls += ' c' + t.t; emo = emojis[t.t] || '❓'; if (t.s) cls += ' sp-' + t.s; }
    el.className = cls;
    el.querySelector('.emo').textContent = emo;
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
    for (const c of s.cleared) {
      const el = board.tiles.get(c.id);
      board.tiles.delete(c.id);
      if (el) { el.classList.add('pop'); setTimeout(() => el.remove(), 290); }
      const sp = screenPt(c.r, c.c);
      sparks(sp.x, sp.y, (MK() && MK().fxColor()) || (typeof c.t === 'number' && c.t >= 0 ? TILE_HEX[c.t] : '#fff'), s.cleared.length > 20 ? 2 : 5);
    }
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
    const moved = [];
    s.moves.forEach((m) => {
      const el = board.tiles.get(m.id);
      if (!el) return;
      const dur = 140 + Math.abs(m.toR - m.fromR) * 55;
      el.style.transition = `transform ${dur}ms cubic-bezier(.35,1.3,.55,1)`;
      placeTile(el, m.toR, m.c);
      moved.push(el); maxDur = Math.max(maxDur, dur);
    });
    s.spawns.forEach((sp) => {
      const el = makeTile({ id: sp.id, t: sp.t, s: sp.s });
      placeTile(el, sp.fromR, sp.c, true);
      const dur = 160 + (sp.toR - sp.fromR) * 55;
      el.style.transition = `transform ${dur}ms cubic-bezier(.35,1.3,.55,1)`;
      placeTile(el, sp.toR, sp.c);
      moved.push(el); maxDur = Math.max(maxDur, dur);
    });
    await wait(Math.min(maxDur, 620) + 20);
    moved.forEach((el) => { el.style.transition = ''; });
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
    if (!board.st || board.busy || board.done || paused) return;
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

  /* ---------------- Победа ---------------- */
  async function levelComplete() {
    board.done = true; board.busy = true;
    clearHint(); clearSelection(); hideCoach();
    Sound.goal(); haptic('success');
    showBanner('Цель выполнена!', true);
    await wait(1000);
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
    if (state.unlockedLevel > 50) state.ownedTitles.legend = true;
    saveNow();
    scheduleSync(400);
    lastResult = { n, stars, coins, gained, firstClear, moves: st.moves, par: st.par, score: st.score };
    showResult(lastResult);
    if (MK() && board.run) MK().finishRun(board.run);
    board.run = null;
  }
  function showResult(r) {
    [1, 2, 3].forEach((i) => { $('rs' + i).className = 'rs' + (i === 2 ? ' rs-mid' : ''); });
    $('resultMoves').textContent = `Ходов: ${r.moves} · Очки: ${fmt(r.score)}`;
    const pills = [['🪙', '+' + r.coins + (serverSettings.doubleRewards ? ' (×2)' : '')]];
    if (r.gained) pills.push(['⭐', '+' + r.gained + ' в Сад']);
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
  $('btnResultShare').addEventListener('click', () => shareText(`Я прошёл уровень ${lastResult ? lastResult.n : ''} в Fruit Blitz на ${'⭐'.repeat(lastResult ? lastResult.stars : 1)}! Сможешь лучше? 🍓`));

  /* ---------------- Пауза / выход ---------------- */
  function openPause() {
    if (!board.st || board.done || board.busy) return;
    paused = true; clearHint();
    const costs = board.st.moves > 0 && !hasInfiniteLives();
    $('pauseInfo').textContent = costs ? 'Выход или перезапуск будет стоить 1 ❤️' : 'Жизнь не тратится, пока вы не сделали ход';
    $('btnPauseSound').textContent = state.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл';
    openModal('modalPause');
  }
  $('btnPause').addEventListener('click', openPause);
  $('btnResume').addEventListener('click', () => { closeModal('modalPause'); paused = false; scheduleHint(); });
  $('btnPauseSound').addEventListener('click', () => { state.sound = !state.sound; saveState(); $('btnPauseSound').textContent = state.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл'; });
  function leaveLevel() {
    if (board.st && board.st.moves > 0 && !board.done) loseLife();
    board.st = null; paused = false; clearHint();
    closeModal('modalPause');
  }
  $('btnRestart').addEventListener('click', () => { const n = board.level; leaveLevel(); showScreen('screenMap'); openIntro(n); });
  $('btnQuit').addEventListener('click', () => { leaveLevel(); showScreen('screenMap'); });

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
    if (kind === 'title') state.equippedTitle = key;
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
      state.daily.quests.forEach((id) => {
        const q = QUEST_POOL.find((x) => x.id === id);
        if (!q) return;
        const v = Math.min(q.target, state.daily.progress[q.stat] || 0), done = v >= q.target, claimed = !!state.daily.claimed[id];
        const card = el(`<div class="quest ${claimed ? 'claimed' : ''}"><div class="quest-top"><span class="q-ico">${q.icon}</span><span class="q-text">${esc(q.text)}<small>${esc(rewardText(q.reward))}</small></span>
          ${claimed ? '<span class="t-done">✓</span>' : done ? '<button class="btn btn-gold">Забрать</button>' : `<span class="q-count">${v}/${q.target}</span>`}</div>
          <div class="progress"><div class="progress-fill" style="width:${v / q.target * 100}%"></div></div></div>`);
        const btn = card.querySelector('button');
        if (btn) btn.addEventListener('click', () => { state.daily.claimed[id] = true; saveState(); showReward(q.reward, { title: 'Задание выполнено!', icon: q.icon }).then(renderQuests); });
        body.appendChild(card);
      });
      const allClaimed = state.daily.quests.every((id) => state.daily.claimed[id]);
      const bonus = el(`<div class="hero-deal pink"><span class="h-ico">🧰</span><div class="h-text"><b>Бонус за все задания</b><small>Большой сундук · новые задания завтра</small></div><button class="btn ${allClaimed && !state.daily.bonus ? 'btn-gold' : 'btn-ghost'}" ${allClaimed && !state.daily.bonus ? '' : 'disabled'}>${state.daily.bonus ? '✓' : 'Открыть'}</button></div>`);
      bonus.querySelector('button').addEventListener('click', () => { state.daily.bonus = true; saveState(); showReward(rollChest('big'), { title: 'Бонус дня!', icon: '🧰', chest: true }).then(renderQuests); });
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
  async function renderLeaders() {
    const body = $('leadersBody');
    body.innerHTML = '<p class="empty">Загрузка...</p>';
    const res = await api('/api/leaderboard?limit=50');
    let list = res.ok && res.data && res.data.leaderboard ? res.data.leaderboard : null;
    if (!list) { body.innerHTML = '<p class="empty">Не удалось загрузить рейтинг 😔<br>Проверьте соединение.</p>'; return; }
    const me = { id: playerId, name: displayName, bestLevel: state.unlockedLevel, totalStars: totalStars(), me: true };
    list = list.filter((p) => p.id !== playerId);
    list.push(me);
    list.sort((a, b) => (b.bestLevel - a.bestLevel) || (b.totalStars - a.totalStars));
    const myRank = list.findIndex((p) => p.me) + 1;
    const top3 = list.slice(0, 3);
    const podOrder = [top3[1], top3[0], top3[2]];
    let html = '<div class="lb-podium">' + podOrder.map((p, i) => p ? `<div class="podium p${[2, 1, 3][i]}"><div class="avatar">${p.me ? avatarHtml() : initialOf(p.name)}</div><b>${esc(p.name)}</b><small>ур. ${p.bestLevel}</small><div class="pd-bar">${[2, 1, 3][i]}</div></div>` : '<div class="podium"></div>').join('') + '</div>';
    html += `<p class="section-label">Вы на ${myRank}-м месте</p>`;
    html += list.slice(0, 50).map((p, i) => `<div class="lb-row ${p.me ? 'me' : ''}"><span class="lb-rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span><div class="avatar">${p.me ? avatarHtml() : initialOf(p.name)}</div><span class="lb-name">${esc(p.name)}${p.badge ? ' ' + esc(p.badge) : (p.me && MK() && MK().myBadge() ? ' ' + MK().myBadge() : '')}${p.username ? `<small>@${esc(p.username)}</small>` : ''}</span><span class="lb-val">🚩${p.bestLevel}<br><small>⭐${p.totalStars}</small></span></div>`).join('');
    if (myRank > 50) html += `<div class="lb-row me"><span class="lb-rank">${myRank}</span><div class="avatar">${avatarHtml()}</div><span class="lb-name">${esc(displayName)}</span><span class="lb-val">🚩${state.unlockedLevel}</span></div>`;
    body.innerHTML = html;
  }

  /* ============================================================
     15. НАСТРОЙКИ, ЖИЗНИ, ПОДЕЛИТЬСЯ
     ============================================================ */
  function refLink() { return `https://t.me/game_crashfr_bot?start=ref_${playerId}`; }
  function shareText(text) {
    const url = `https://t.me/share/url?url=${encodeURIComponent(refLink())}&text=${encodeURIComponent(text)}`;
    try { if (tg && tg.openTelegramLink) { tg.openTelegramLink(url); return; } } catch (e) { /* noop */ }
    if (navigator.share) { navigator.share({ title: 'Fruit Blitz', text, url: refLink() }).catch(() => {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + refLink()).then(() => showToast('Ссылка скопирована!'));
  }
  function renderSettings() {
    $('setSoundVal').className = 'toggle' + (state.sound ? ' on' : '');
    $('setVibroVal').className = 'toggle' + (state.vibration ? ' on' : '');
    $('settingsInfo').textContent = `ID: ${playerId} · Fruit Blitz v3`;
  }
  $('btnSettings').addEventListener('click', () => { renderSettings(); openModal('modalSettings'); });
  $('setSound').addEventListener('click', () => { state.sound = !state.sound; saveState(); renderSettings(); if (state.sound) Sound.click(); });
  $('setVibro').addEventListener('click', () => { state.vibration = !state.vibration; saveState(); renderSettings(); haptic('medium'); });
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
      lives: state.lives, boosters: state.boosters, score: state.stats.bestScore, adminRev: state.adminRev };
  }
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
  document.addEventListener('visibilitychange', () => { if (document.hidden) { saveNow(); syncWithServer(); } else { tickLives(); renderHud(); } });
  window.addEventListener('pagehide', saveNow);

  async function boot() {
    const setP = (p, t) => { $('splashFill').style.width = p + '%'; $('splashStatus').textContent = t; };
    initTelegram();
    buildBackground();
    tickLives(); ensureDaily();
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
    renderShop() { if (currentScreen === 'screenShop') renderShop(); }
  };
  // Отладочный доступ для автотестов (только с ?debug в адресе)
  if (/[?&]debug\b/.test(location.search)) window.__FB = { board, E, get state() { return state; }, showScreen };
  boot();
})();
