/* ==========================================================
   FRUIT BLITZ — Match-3 Telegram Mini App
   Чистый Vanilla JS. Один файл: состояние, звук, экраны, игра.
   ========================================================== */
(function () {
  'use strict';

  /* ============================================================
     0. TELEGRAM WEBAPP + ПРОФИЛЬ ИГРОКА
     ============================================================ */
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  function initTelegram() {
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      // Разворачиваем на весь экран (Bot API 8.0+, поддерживается не всеми клиентами)
      if (typeof tg.requestFullscreen === 'function') tg.requestFullscreen();
      if (typeof tg.enableClosingConfirmation === 'function') tg.enableClosingConfirmation();
      if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();

      // Красим системную шапку и фон Telegram в тон дизайна — без этого при разворачивании
      // сверху/снизу видны белые или чёрные полосы поверх нашего градиента.
      if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#1a102f');
      if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#1a102f');

      applyTelegramTheme();
      applySafeArea();
      tg.onEvent('themeChanged', applyTelegramTheme);
      // safeAreaChanged/contentSafeAreaChanged/viewportChanged — на случай, если панель Telegram
      // (кнопка "Закрыть", системная шторка) меняет высоту уже после первой отрисовки.
      tg.onEvent('safeAreaChanged', applySafeArea);
      tg.onEvent('contentSafeAreaChanged', applySafeArea);
      tg.onEvent('viewportChanged', applySafeArea);
    } catch (e) { console.warn('tg init error', e); }
  }

  /**
   * Синхронизирует реальные отступы safe area, которые сообщает Telegram (tg.safeAreaInset /
   * tg.contentSafeAreaInset, доступны с Bot API 8.0), с CSS-переменной --tg-safe-area-inset-top.
   * Именно это значение (а не только env(safe-area-inset-top) от самой ОС) отвечает за высоту
   * нативной плашки Telegram с кнопкой "Закрыть" поверх Mini App.
   */
  function applySafeArea() {
    if (!tg) return;
    const root = document.documentElement.style;
    const sa = tg.safeAreaInset || {};
    const csa = tg.contentSafeAreaInset || {};
    // Берём максимум из обоих источников, чтобы учесть и системную шапку ОС, и шапку самого Telegram
    const top = Math.max(sa.top || 0, csa.top || 0);
    const bottom = Math.max(sa.bottom || 0, csa.bottom || 0);
    root.setProperty('--tg-safe-area-inset-top', top + 'px');
    root.setProperty('--tg-safe-area-inset-bottom', bottom + 'px');
  }

  function applyTelegramTheme() {
    if (!tg || !tg.themeParams) return;
    const root = document.documentElement.style;
    const tp = tg.themeParams;
    if (tp.button_color) root.setProperty('--accent', tp.button_color);
    if (tp.button_text_color) root.setProperty('--tg-button-text', tp.button_text_color);
  }

  function haptic(kind) {
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (kind === 'select') tg.HapticFeedback.selectionChanged();
      else if (kind === 'success') tg.HapticFeedback.notificationOccurred('success');
      else if (kind === 'error') tg.HapticFeedback.notificationOccurred('error');
      else tg.HapticFeedback.impactOccurred(kind || 'light');
    } catch (e) { /* noop */ }
  }

  function getTelegramUser() {
    try { if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) return tg.initDataUnsafe.user; } catch (e) { /* noop */ }
    return null;
  }
  const telegramUser = getTelegramUser();
  const playerId = (telegramUser && telegramUser.id) ? telegramUser.id : 'guest';
  // Статус админа подтверждается СЕРВЕРОМ (по process.env.ADMIN_ID), а не в клиентском коде —
  // см. checkAdminAccess() и /api/admin/* ниже.
  let isAdminConfirmed = false;
  function adminAuthParams() {
    return { telegram_id: playerId, init_data: (tg && tg.initData) ? tg.initData : '' };
  }

  function renderPlayerBadge() {
    const nameEl = document.getElementById('playerName');
    const avatarEl = document.getElementById('playerAvatar');
    const titleEl = document.getElementById('playerTitle');
    if (!nameEl || !avatarEl) return;
    let displayName = 'Гость';
    if (telegramUser) {
      const full = (telegramUser.first_name || '') + (telegramUser.last_name ? ' ' + telegramUser.last_name : '');
      displayName = full.trim() || ('@' + (telegramUser.username || 'player'));
      if (telegramUser.photo_url) {
        avatarEl.innerHTML = '';
        const img = document.createElement('img');
        img.src = telegramUser.photo_url; img.alt = 'avatar';
        avatarEl.appendChild(img);
      } else {
        avatarEl.textContent = displayName.charAt(0).toUpperCase();
      }
    } else {
      avatarEl.textContent = '🙂';
    }
    nameEl.textContent = displayName;
    avatarEl.className = 'player-avatar' + (state.equippedFrame && state.equippedFrame !== 'none' ? ' frame-' + state.equippedFrame : '');
    const title = TITLES[state.equippedTitle];
    titleEl.textContent = (title && title.id !== 'none') ? (title.icon + ' ' + title.name) : '';
  }

  /* ============================================================
     1. АУДИО ДВИЖОК (Web Audio API, без файлов)
     ============================================================ */
  let actx = null;
  function ensureAudio() {
    if (!actx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) actx = new Ctx();
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }

  function tone(freq, dur, type, gainPeak, delay, glideTo) {
    if (!state.sound) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak || 0.2, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, gainPeak, delay, lowpass) {
    if (!state.sound) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass || 1200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak || 0.3, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  const Sound = {
    click() { tone(720, 0.08, 'sine', 0.18); },
    select() { tone(560, 0.06, 'triangle', 0.15); },
    pop() { tone(880, 0.12, 'triangle', 0.22, 0, 1400); },
    matchN(n) {
      const base = 520;
      for (let i = 0; i < Math.min(n, 6); i++) tone(base * Math.pow(1.12, i), 0.14, 'triangle', 0.18, i * 0.03, base * Math.pow(1.12, i) * 1.5);
    },
    combo(level) {
      const base = 420 * Math.pow(1.18, Math.min(level, 8));
      tone(base, 0.16, 'sawtooth', 0.16, 0, base * 1.8);
      tone(base * 1.5, 0.16, 'sawtooth', 0.1, 0.05, base * 2.2);
    },
    explosion() { noiseBurst(0.35, 0.35, 0, 900); tone(90, 0.32, 'sine', 0.4, 0, 40); },
    booster() { tone(300, 0.22, 'square', 0.18, 0, 900); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.22, i * 0.12)); },
    lose() { [400, 340, 260].forEach((f, i) => tone(f, 0.32, 'sawtooth', 0.18, i * 0.14)); },
    error() { tone(180, 0.18, 'square', 0.15); }
  };

  /* ============================================================
     2. КОСМЕТИКА: СКИНЫ, РАМКИ, ЗВАНИЯ
     ============================================================ */
  const SKINS = {
    classic: { id: 'classic', name: 'Классика', emojis: ['🍎', '🍌', '🍓', '🍇', '🍊', '🫐'], cost: 0, currency: null },
    neon: { id: 'neon', name: 'Неоновые кубы', emojis: ['🟦', '🟨', '🟥', '🟩', '🟪', '⬜'], cost: 500, currency: 'coins' },
    candy: { id: 'candy', name: 'Сладости', emojis: ['🍬', '🍭', '🍩', '🍪', '🧁', '🍫'], cost: 1000, currency: 'coins' },
    cosmic: { id: 'cosmic', name: 'Космос', emojis: ['💎', '🔮', '⭐', '🌟', '☄️', '🪐'], cost: 2000, currency: 'coins' }
  };

  const FRAMES = {
    none: { id: 'none', name: 'Без рамки', icon: '⬜', cost: 0, currency: null },
    gold: { id: 'gold', name: 'Золотая рамка', icon: '✨', cost: 15, currency: 'gems' },
    neon: { id: 'neon', name: 'Неоновая рамка', icon: '⚡', cost: 30, currency: 'gems' }
  };

  const TITLES = {
    none: { id: 'none', name: 'Без звания', icon: '', cost: 0, currency: null },
    baron: { id: 'baron', name: 'Фруктовый Барон', icon: '👑', cost: 20, currency: 'gems' },
    master: { id: 'master', name: 'Мастер Блитца', icon: '👑', cost: 25, currency: 'gems' }
  };

  /* ============================================================
     3. СОСТОЯНИЕ / СОХРАНЕНИЕ (привязано к ID игрока)
     ============================================================ */
  const SAVE_KEY = `fruit_blitz_progress_${playerId}`;
  const MAX_LIVES = 5;
  const LIFE_REGEN_MS = 15 * 60 * 1000;

  function defaultState() {
    return {
      coins: 300,
      gems: 25,
      lives: MAX_LIVES,
      nextLifeAt: null,
      infiniteLives: false,
      sound: true,
      unlockedLevel: 1,
      levelStars: {},
      claimedChests: {},
      boosters: { hammer: 3, shuffle: 2, rocketBoost: 2 },
      ownedSkins: { classic: true },
      equippedSkin: 'classic',
      ownedFrames: { none: true },
      equippedFrame: 'none',
      ownedTitles: { none: true },
      equippedTitle: 'none',
      lastWheelSpin: null,
      wheelStreak: 0,
      dailyQuests: null,
      // Метка времени последнего известного состояния на сервере (server player.updatedAt).
      // Используется для двустороннего merge в syncProgressWithServer(): если сервер "новее"
      // этого значения — значит его поменяли ИЗВНЕ (админ-панель), и клиент должен подтянуть
      // изменения, а не затирать их своим локальным прогрессом.
      lastServerUpdatedAt: 0,
      leaderboard: [
        { name: 'Алекс', score: 18400 },
        { name: 'Мария', score: 15200 },
        { name: 'Женя', score: 12750 },
        { name: 'Тимур', score: 9800 }
      ],
      stats: { totalCleared: 0, bestCombo: 0, boostersUsed: 0, totalCoinsEarned: 0, wins: 0, bestScore: 0 }
    };
  }

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed, {
        boosters: Object.assign({ hammer: 0, shuffle: 0, rocketBoost: 0 }, parsed.boosters),
        stats: Object.assign(defaultState().stats, parsed.stats),
        levelStars: parsed.levelStars || {},
        ownedSkins: Object.assign({ classic: true }, parsed.ownedSkins),
        ownedFrames: Object.assign({ none: true }, parsed.ownedFrames),
        ownedTitles: Object.assign({ none: true }, parsed.ownedTitles)
      });
    } catch (e) { return defaultState(); }
  }

  function saveState() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* noop */ }
  }

  /* ============================================================
     4. НАВИГАЦИЯ: ЭКРАНЫ + МОДАЛКИ + ВКЛАДКИ + TOAST
     ============================================================ */
  const screens = {};
  document.querySelectorAll('.screen').forEach((el) => { screens[el.id] = el; });

  function showScreen(id) {
    Object.values(screens).forEach((el) => el.classList.remove('active'));
    if (screens[id]) screens[id].classList.add('active');
    document.getElementById('resourceBar').style.display = (id === 'screenGame') ? 'none' : 'flex';
    if (id === 'screenLevels') renderLevelsGrid();
    renderResources();
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    if (id === 'modalAchievements') renderAchievements();
    if (id === 'modalLeaderboard') renderLeaderboard();
    if (id === 'modalWheel') refreshWheelState();
    if (id === 'modalShop') { renderSkinsTab(); renderFramesTab(); }
    if (id === 'modalQuests') { ensureDailyQuests(); renderQuests(); }
    if (id === 'modalAdminPro') {
      renderAdminStats(); renderAdminGlobalSettings(); loadAllPlayersList();
      document.getElementById('broadcastProgressWrap').classList.add('hidden');
    }
    renderResources();
  }
  function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }

  document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
  document.querySelectorAll('[data-back]').forEach((btn) => btn.addEventListener('click', () => showScreen(btn.dataset.back)));

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.overlay-card');
      parent.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      parent.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      Sound.select();
    });
  });

  let globalToastEl = null;
  function showToast(msg) {
    if (!globalToastEl) {
      globalToastEl = document.createElement('div');
      globalToastEl.className = 'combo-toast';
      globalToastEl.style.position = 'fixed';
      globalToastEl.style.top = 'calc(var(--safe-top) + 64px)';
      globalToastEl.style.zIndex = '300';
      document.body.appendChild(globalToastEl);
    }
    globalToastEl.textContent = msg;
    globalToastEl.classList.remove('hidden');
    requestAnimationFrame(() => globalToastEl.classList.add('show'));
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      globalToastEl.classList.remove('show');
      setTimeout(() => globalToastEl.classList.add('hidden'), 250);
    }, 1400);
  }

  /* ============================================================
     5. РЕСУРСЫ: РЕНДЕР, ЖИЗНИ, ЗВУК-ТОГГЛ
     ============================================================ */
  function renderResources() {
    document.getElementById('coinsValue').textContent = state.coins;
    document.getElementById('gemsValue').textContent = state.gems;
    document.getElementById('livesValue').textContent = state.infiniteLives ? '∞' : state.lives;
    const timerEl = document.getElementById('livesTimer');
    if (!state.infiniteLives && state.lives < MAX_LIVES && state.nextLifeAt) {
      const left = Math.max(0, state.nextLifeAt - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      timerEl.textContent = `+1 через ${m}:${String(s).padStart(2, '0')}`;
    } else {
      timerEl.textContent = '';
    }
    updateSoundIcons();
  }

  function updateSoundIcons() {
    document.querySelectorAll('#soundToggleBtn, #soundToggleBtnGame').forEach((b) => { b.textContent = state.sound ? '🔊' : '🔇'; });
  }
  function toggleSound() {
    state.sound = !state.sound;
    saveState();
    updateSoundIcons();
    if (state.sound) { ensureAudio(); Sound.click(); }
  }
  document.getElementById('soundToggleBtn').addEventListener('click', toggleSound);
  document.getElementById('soundToggleBtnGame').addEventListener('click', toggleSound);

  function tickLives() {
    if (state.infiniteLives) { renderResources(); return; }
    const now = Date.now();
    if (state.lives < MAX_LIVES) {
      if (!state.nextLifeAt) state.nextLifeAt = now + LIFE_REGEN_MS;
      if (now >= state.nextLifeAt) {
        state.lives = Math.min(MAX_LIVES, state.lives + 1);
        state.nextLifeAt = state.lives < MAX_LIVES ? now + LIFE_REGEN_MS : null;
        saveState();
      }
    } else {
      state.nextLifeAt = null;
    }
    renderResources();
  }
  setInterval(tickLives, 1000);

  function spendLife() {
    if (state.infiniteLives) return true;
    if (state.lives <= 0) return false;
    const wasFull = state.lives === MAX_LIVES;
    state.lives -= 1;
    if (wasFull) state.nextLifeAt = Date.now() + LIFE_REGEN_MS;
    saveState();
    renderResources();
    return true;
  }

  function addCoins(n) { state.coins += n; state.stats.totalCoinsEarned += Math.max(0, n); saveState(); renderResources(); }
  function addGems(n) { state.gems += n; saveState(); renderResources(); }

  /* ============================================================
     6. УРОВНИ: РАЗМЕР ПОЛЯ, СЛОЖНОСТЬ И РЕЖИМЫ ПОБЕДЫ
     ============================================================ */
  const LEVEL_COUNT = 24;
  const MODE_CYCLE = ['collect', 'score', 'ice', 'ingredient', 'timeattack'];
  const MODE_ICON = { collect: '🍇', score: '⭐', ice: '🧊', ingredient: '🥥', timeattack: '⏱' };
  const MODE_NAME = { collect: 'Сбор фруктов', score: 'Набор очков', ice: 'Зачистка льда', ingredient: 'Доставка ингредиента', timeattack: 'На время' };

  // Уровень 1: 4x4 (3 вида фишек) · Уровень 2: 5x5 (4 вида)
  // Уровень 3: 6x6 + лёд · Уровень 4: 7x7 + шоколад · Уровень 5+: 8x8 полная сложность
  function levelConfig(n) {
    let size = 8;
    if (n === 1) size = 4;
    else if (n === 2) size = 5;
    else if (n === 3) size = 6;
    else if (n === 4) size = 7;

    let fruitCount = 6;
    if (n === 1) fruitCount = 3;
    else if (n === 2) fruitCount = 4;
    else if (n === 3) fruitCount = 5;

    let mode;
    if (n === 1) mode = 'collect';
    else if (n === 2) mode = 'score';
    else if (n === 3) mode = 'ice';
    else if (n === 4) mode = 'collect';
    else mode = MODE_CYCLE[(n - 5) % MODE_CYCLE.length];

    const moves = 14 + Math.floor(n / 2) * 2;
    const cellsTotal = size * size;

    let iceCount = (n >= 3) ? Math.min(Math.floor(cellsTotal * 0.12), 2 + n) : 0;
    let chocoCount = (n >= 4) ? Math.min(Math.floor(cellsTotal * 0.1), 1 + Math.floor(n / 2)) : 0;
    if (mode === 'ice') iceCount = Math.max(iceCount, 6);
    if (mode === 'ingredient' || mode === 'timeattack') chocoCount = Math.min(chocoCount, 2); // не мешаем основному режиму

    const goals = [];
    if (mode === 'collect') {
      const goalsCount = n < 8 ? 2 : 3;
      const used = [];
      for (let i = 0; i < goalsCount; i++) {
        let f;
        do { f = Math.floor(Math.random() * fruitCount); } while (used.includes(f));
        used.push(f);
        const target = Math.max(6, Math.round(cellsTotal * 0.35) + n * 2 + i * 3);
        goals.push({ type: 'collect', fruit: f, target, current: 0 });
      }
    } else if (mode === 'score') {
      goals.push({ type: 'score', target: 600 + n * 120, current: 0 });
    } else if (mode === 'ice') {
      goals.push({ type: 'ice', target: iceCount, current: 0 });
    } else if (mode === 'ingredient') {
      goals.push({ type: 'ingredient', target: Math.min(6, 3 + Math.floor(n / 6)), current: 0 });
    } else if (mode === 'timeattack') {
      goals.push({ type: 'combo', target: 5 + Math.floor(n / 4), current: 0 });
    }

    const par = (mode === 'timeattack') ? (300 + n * 40) : moves * 45;
    return {
      level: n, size, fruitCount, mode, moves, goals,
      iceCount, chocoCount, par,
      ingredientEmoji: Math.random() < 0.5 ? '🥥' : '🍍'
    };
  }

  /* ============================================================
     КАРТА УРОВНЕЙ — S-образная тропинка, биомы, сундуки
     ============================================================ */
  const NODE_SPACING_Y = 128;   // px между центрами соседних узлов по вертикали
  const PATH_TOP_PAD = 70;      // отступ сверху трека (под последним/самым высоким уровнем)
  const PATH_BOTTOM_PAD = 50;   // отступ снизу трека (под уровнем 1)
  const XPOS_CYCLE = [18, 50, 82, 50]; // Лево → Центр → Право → Центр → (повтор) — % от ширины трека
  const CHEST_EVERY = 5;        // сундук после каждого 5-го уровня

  const BIOMES = [
    { key: 'strawberry', name: 'Клубничная Долина', emoji: '🍓', maxLevel: 10, cls: 'biome-strawberry' },
    { key: 'citrus', name: 'Цитрусовый Остров', emoji: '🍊', maxLevel: 20, cls: 'biome-citrus' },
    { key: 'space', name: 'Космический Блитц', emoji: '🌌', maxLevel: Infinity, cls: 'biome-space' }
  ];
  function biomeForLevel(n) { return BIOMES.find((b) => n <= b.maxLevel) || BIOMES[BIOMES.length - 1]; }

  /** Строит последовательность узлов тропинки: уровни + вкрапленные сундуки, с координатами. */
  function buildPathItems() {
    const items = [];
    for (let n = 1; n <= LEVEL_COUNT; n++) {
      items.push({ type: 'level', level: n });
      if (n % CHEST_EVERY === 0 && n !== LEVEL_COUNT) items.push({ type: 'chest', afterLevel: n });
    }
    const total = items.length;
    let levelSeq = 0;
    items.forEach((item, i) => {
      item.xPercent = (item.type === 'chest') ? 50 : XPOS_CYCLE[levelSeq++ % XPOS_CYCLE.length];
      // Уровень 1 внизу (большой y), последний узел — наверху (y ≈ PATH_TOP_PAD): тропинка идёт снизу вверх.
      item.y = PATH_BOTTOM_PAD + (total - 1 - i) * NODE_SPACING_Y;
    });
    return { items, totalHeight: PATH_BOTTOM_PAD + (total - 1) * NODE_SPACING_Y + PATH_TOP_PAD };
  }

  function renderLevelsGrid() {
    const track = document.getElementById('levelsGrid');
    track.innerHTML = '';
    const { items, totalHeight } = buildPathItems();
    const trackWidth = track.clientWidth || track.parentElement.clientWidth || 320;
    track.style.height = totalHeight + 'px';

    // ---------- 1) Биомы (фоновые зоны) ----------
    const yOfLevel = (n) => { const it = items.find((x) => x.type === 'level' && x.level === n); return it ? it.y : 0; };
    const boundaryCitrusSpace = (yOfLevel(20) + yOfLevel(21 <= LEVEL_COUNT ? 21 : 20)) / 2;
    const boundaryStrawberryCitrus = (yOfLevel(10) + yOfLevel(11 <= LEVEL_COUNT ? 11 : 10)) / 2;
    const biomeBands = [
      { biome: BIOMES[2], top: 0, height: LEVEL_COUNT > 20 ? boundaryCitrusSpace : 0 },
      { biome: BIOMES[1], top: LEVEL_COUNT > 20 ? boundaryCitrusSpace : 0, height: (LEVEL_COUNT > 10 ? boundaryStrawberryCitrus : totalHeight) - (LEVEL_COUNT > 20 ? boundaryCitrusSpace : 0) },
      { biome: BIOMES[0], top: LEVEL_COUNT > 10 ? boundaryStrawberryCitrus : 0, height: totalHeight - (LEVEL_COUNT > 10 ? boundaryStrawberryCitrus : 0) }
    ];
    biomeBands.forEach((band) => {
      if (band.height <= 0) return;
      const layer = document.createElement('div');
      layer.className = 'biome-layer ' + band.biome.cls;
      layer.style.top = band.top + 'px';
      layer.style.height = band.height + 'px';
      const label = document.createElement('div');
      label.className = 'biome-label';
      label.textContent = `${band.biome.emoji} ${band.biome.name}`;
      layer.appendChild(label);
      track.appendChild(layer);
    });

    // ---------- 2) Декоративные плавающие фрукты/искры ----------
    const decor = document.createElement('div');
    decor.className = 'map-bg-decor';
    decor.style.height = totalHeight + 'px';
    const decorEmojis = ['🍎', '🍇', '🍊', '🫐', '✨', '✨'];
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      const isSpark = decorEmojis[i % decorEmojis.length] === '✨';
      if (isSpark) s.classList.add('spark');
      s.textContent = decorEmojis[i % decorEmojis.length];
      s.style.setProperty('--mx', (Math.random() * 92 + 2) + '%');
      s.style.setProperty('--mb', (Math.random() * totalHeight) + 'px');
      s.style.setProperty('--ms', (isSpark ? 8 + Math.random() * 6 : 16 + Math.random() * 12) + 'px');
      s.style.setProperty('--md', (6 + Math.random() * 6) + 's');
      s.style.setProperty('--mdl', (Math.random() * 4) + 's');
      decor.appendChild(s);
    }
    track.appendChild(decor);

    // ---------- 3) SVG-тропинка (пунктирная линия со свечением) ----------
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'levels-path-svg');
    svg.setAttribute('width', trackWidth);
    svg.setAttribute('height', totalHeight);
    const points = items.map((it) => `${(it.xPercent / 100) * trackWidth},${it.y}`);
    const d = 'M ' + points.join(' L ');
    const glowPath = document.createElementNS(svgNS, 'path');
    glowPath.setAttribute('d', d); glowPath.setAttribute('class', 'path-glow');
    const dashPath = document.createElementNS(svgNS, 'path');
    dashPath.setAttribute('d', d); dashPath.setAttribute('class', 'path-dash');
    svg.appendChild(glowPath); svg.appendChild(dashPath);
    track.appendChild(svg);

    // ---------- 4) Узлы: уровни и сундуки ----------
    items.forEach((item) => {
      const node = document.createElement('div');
      node.className = 'map-node';
      node.style.left = item.xPercent + '%';
      node.style.top = item.y + 'px';

      if (item.type === 'chest') {
        renderChestNode(node, item.afterLevel);
      } else {
        renderLevelNode(node, item.level);
      }
      track.appendChild(node);
    });

    // ---------- 5) Автоскролл к текущему уровню ----------
    requestAnimationFrame(() => {
      const currentY = yOfLevel(Math.min(state.unlockedLevel, LEVEL_COUNT));
      const scrollHost = document.getElementById('screenLevels');
      const headerH = (scrollHost.querySelector('.screen-header') || {}).offsetHeight || 0;
      const target = Math.max(0, currentY - (scrollHost.clientHeight - headerH) / 2);
      scrollHost.scrollTo({ top: target, behavior: 'auto' });
    });
  }

  function renderLevelNode(node, n) {
    const locked = n > state.unlockedLevel;
    const isCurrent = n === state.unlockedLevel;
    const stars = state.levelStars[n] || 0;
    const completed = stars > 0 || n < state.unlockedLevel;
    const cfg = levelConfig(n);

    const orb = document.createElement('button');
    orb.className = 'level-orb' + (locked ? ' locked' : (isCurrent ? ' current' : (completed ? ' completed' : '')));
    if (locked) {
      orb.innerHTML = `<span class="lock-icon">🔒</span>`;
    } else {
      orb.innerHTML = `${n}<span class="mode-tag">${MODE_ICON[cfg.mode]}</span>`;
    }
    orb.disabled = locked;
    if (!locked) orb.addEventListener('click', () => { haptic('light'); startLevel(n); });
    node.appendChild(orb);

    if (!locked) {
      const sizeTag = document.createElement('div');
      sizeTag.className = 'size-tag';
      sizeTag.textContent = `${cfg.size}×${cfg.size}`;
      node.appendChild(sizeTag);
    }
    if (completed) {
      const starsRow = document.createElement('div');
      starsRow.className = 'stars-row';
      starsRow.textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
      node.appendChild(starsRow);
    }
    if (isCurrent) {
      const marker = document.createElement('div');
      marker.className = 'here-marker';
      const avatarHtml = (telegramUser && telegramUser.photo_url)
        ? `<img src="${telegramUser.photo_url}" alt="" />`
        : (telegramUser ? (telegramUser.first_name || '?').charAt(0).toUpperCase() : '🙂');
      marker.innerHTML = `<span class="here-label">Ты здесь!</span><span class="here-avatar">${avatarHtml}</span>`;
      node.appendChild(marker);
    }
  }

  function renderChestNode(node, afterLevel) {
    const available = state.unlockedLevel > afterLevel;
    const claimed = !!(state.claimedChests && state.claimedChests[afterLevel]);
    const orb = document.createElement('button');
    orb.className = 'chest-orb' + (!available ? ' locked' : (claimed ? ' claimed' : ' claimable'));
    orb.textContent = claimed ? '📭' : '🎁';
    orb.disabled = !available || claimed;
    if (available && !claimed) orb.addEventListener('click', () => claimChest(afterLevel));
    node.appendChild(orb);

    const label = document.createElement('div');
    label.className = 'chest-label';
    label.textContent = claimed ? 'Открыт' : (available ? 'Забрать!' : `Ур. ${afterLevel}`);
    node.appendChild(label);
  }

  function claimChest(afterLevel) {
    if (!state.claimedChests) state.claimedChests = {};
    if (state.claimedChests[afterLevel]) return;
    state.claimedChests[afterLevel] = true;
    const coinsReward = 100, gemsReward = 5;
    addCoins(coinsReward);
    addGems(gemsReward);
    saveState();
    Sound.win(); haptic('success');
    fireConfetti(1);
    showChestRewardPopup(coinsReward, gemsReward);
    renderLevelsGrid();
  }

  let chestRewardEl = null;
  function ensureChestRewardModal() {
    if (chestRewardEl) return chestRewardEl;
    const el = document.createElement('div');
    el.id = 'chestRewardPopup';
    el.className = 'overlay hidden';
    el.innerHTML = `
      <div class="overlay-card chest-reward-card">
        <div class="chest-reward-icon">🎁</div>
        <h2>Сундук открыт!</h2>
        <div class="chest-reward-amount" id="chestRewardAmount"></div>
        <button class="primary-btn" id="btnCloseChestReward">Забрать</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#btnCloseChestReward').addEventListener('click', () => el.classList.add('hidden'));
    chestRewardEl = el;
    return el;
  }
  function showChestRewardPopup(coins, gems) {
    const el = ensureChestRewardModal();
    el.querySelector('#chestRewardAmount').textContent = `+${coins} 🪙   +${gems} 💎`;
    el.classList.remove('hidden');
  }

  /* ============================================================
     7. ДОСТИЖЕНИЯ
     ============================================================ */
  const ACHIEVEMENTS = [
    { id: 'first_win', icon: '🥇', title: 'Первая победа', desc: 'Пройдите любой уровень', check: (s) => s.stats.wins >= 1 },
    { id: 'level5', icon: '🗺️', title: 'Исследователь', desc: 'Откройте 5-й уровень', check: (s) => s.unlockedLevel >= 5 },
    { id: 'level15', icon: '🚩', title: 'Ветеран', desc: 'Откройте 15-й уровень', check: (s) => s.unlockedLevel >= 15 },
    { id: 'combo5', icon: '💥', title: 'Комбо-мастер', desc: 'Соберите комбо x5 и выше', check: (s) => s.stats.bestCombo >= 5 },
    { id: 'cleared200', icon: '🍇', title: 'Фруктовый шторм', desc: 'Уничтожьте 200 фишек', check: (s) => s.stats.totalCleared >= 200 },
    { id: 'cleared1000', icon: '🌪️', title: 'Ураган', desc: 'Уничтожьте 1000 фишек', check: (s) => s.stats.totalCleared >= 1000 },
    { id: 'booster10', icon: '🔨', title: 'Мастер бустеров', desc: 'Используйте 10 бустеров', check: (s) => s.stats.boostersUsed >= 10 },
    { id: 'rich', icon: '🪙', title: 'Богач', desc: 'Заработайте 2000 монет суммарно', check: (s) => s.stats.totalCoinsEarned >= 2000 },
    { id: 'stars3x5', icon: '🌟', title: 'Перфекционист', desc: 'Получите 3 звезды на 5 уровнях', check: (s) => Object.values(s.levelStars).filter((v) => v >= 3).length >= 5 },
    { id: 'skin', icon: '🎨', title: 'Стилист', desc: 'Купите любой скин фишек', check: (s) => Object.keys(s.ownedSkins).length > 1 }
  ];

  function renderAchievements() {
    const list = document.getElementById('achievementsList');
    list.innerHTML = '';
    ACHIEVEMENTS.forEach((a) => {
      const done = a.check(state);
      const li = document.createElement('div');
      li.className = 'ach-item' + (done ? ' done' : '');
      li.innerHTML = `<div class="ach-icon">${a.icon}</div><div class="ach-text"><b>${a.title}</b><span>${a.desc}</span></div><div>${done ? '✅' : '🔒'}</div>`;
      list.appendChild(li);
    });
  }

  /* ============================================================
     8. ТАБЛИЦА ЛИДЕРОВ (локальная)
     ============================================================ */
  function renderLeaderboard() {
    const list = document.getElementById('leaderboardList');
    const entries = state.leaderboard.slice().concat([{ name: telegramUser ? (telegramUser.first_name || 'Вы') : 'Вы', score: state.stats.bestScore || 0, me: true }]);
    entries.sort((a, b) => b.score - a.score);
    list.innerHTML = '';
    entries.forEach((e, i) => {
      const li = document.createElement('li');
      li.className = 'lb-item' + (e.me ? ' me' : '');
      li.innerHTML = `<span class="lb-rank">#${i + 1}</span><span>${e.me ? '👤 ' : ''}${e.name}</span><span>${e.score}</span>`;
      list.appendChild(li);
    });
  }
  function submitScoreToLeaderboard(score) {
    if (!state.stats.bestScore || score > state.stats.bestScore) state.stats.bestScore = score;
    saveState();
  }

  /* ============================================================
     9. МАГАЗИН: БУСТЕРЫ
     ============================================================ */
  document.querySelectorAll('[data-shop-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.dataset.shopBuy;
      const cost = parseInt(btn.dataset.cost, 10);
      const currency = btn.dataset.currency;
      const balance = currency === 'gems' ? state.gems : state.coins;
      if (balance < cost) { showToast('Недостаточно ' + (currency === 'gems' ? 'кристаллов 💎' : 'монет 🪙')); Sound.error(); haptic('error'); return; }
      if (currency === 'gems') state.gems -= cost; else state.coins -= cost;

      if (item === 'hammer') state.boosters.hammer += 3;
      else if (item === 'shuffle') state.boosters.shuffle += 3;
      else if (item === 'rocketBoost') state.boosters.rocketBoost += 2;
      else if (item === 'moves') state.boosters.moves = (state.boosters.moves || 0) + 1;
      else if (item === 'lives') state.lives = MAX_LIVES;
      else if (item === 'gems50') state.gems += 50;

      saveState();
      renderResources();
      renderBoosterCounts();
      Sound.click(); haptic('light');
      showToast('Покупка совершена!');
    });
  });

  /* ---------- Скины фишек ---------- */
  function renderSkinsTab() {
    const grid = document.getElementById('skinsGrid');
    grid.innerHTML = '';
    Object.values(SKINS).forEach((skin) => {
      const owned = !!state.ownedSkins[skin.id];
      const equipped = state.equippedSkin === skin.id;
      const card = document.createElement('div');
      card.className = 'shop-card';
      const priceLabel = skin.cost === 0 ? 'Бесплатно' : `${skin.cost} 🪙`;
      let btnLabel = owned ? (equipped ? '✅ Выбрано' : 'Выбрать') : priceLabel;
      let btnClass = owned ? (equipped ? 'equipped' : 'owned') : '';
      card.innerHTML = `<div class="shop-icon">${skin.emojis.slice(0, 3).join('')}</div><div class="shop-name">${skin.name}</div><div class="shop-desc">${skin.emojis.join(' ')}</div><button class="shop-buy-btn ${btnClass}">${btnLabel}</button>`;
      card.querySelector('button').addEventListener('click', () => handleSkinClick(skin, owned, equipped));
      grid.appendChild(card);
    });
  }
  function handleSkinClick(skin, owned, equipped) {
    if (equipped) return;
    if (owned) {
      state.equippedSkin = skin.id;
      applyEquippedSkin();
      saveState();
      renderSkinsTab();
      Sound.click(); haptic('light');
      showToast('Скин применён: ' + skin.name);
      return;
    }
    if (state.coins < skin.cost) { showToast('Недостаточно монет 🪙'); Sound.error(); haptic('error'); return; }
    state.coins -= skin.cost;
    state.ownedSkins[skin.id] = true;
    state.equippedSkin = skin.id;
    applyEquippedSkin();
    saveState();
    renderResources();
    renderSkinsTab();
    Sound.win(); haptic('success');
    showToast('Скин куплен: ' + skin.name);
  }

  /* ---------- Рамки и звания ---------- */
  function renderFramesTab() {
    const grid = document.getElementById('framesGrid');
    grid.innerHTML = '';
    const items = [
      ...Object.values(FRAMES).filter((f) => f.id !== 'none').map((f) => ({ kind: 'frame', ...f })),
      ...Object.values(TITLES).filter((t) => t.id !== 'none').map((t) => ({ kind: 'title', ...t }))
    ];
    items.forEach((item) => {
      const ownedMap = item.kind === 'frame' ? state.ownedFrames : state.ownedTitles;
      const equippedVal = item.kind === 'frame' ? state.equippedFrame : state.equippedTitle;
      const owned = !!ownedMap[item.id];
      const equipped = equippedVal === item.id;
      const card = document.createElement('div');
      card.className = 'shop-card';
      const priceLabel = `${item.cost} 💎`;
      const btnLabel = owned ? (equipped ? '✅ Выбрано' : 'Выбрать') : priceLabel;
      const btnClass = owned ? (equipped ? 'equipped' : 'owned') : '';
      card.innerHTML = `<div class="shop-icon">${item.icon || '⬜'}</div><div class="shop-name">${item.name}</div><div class="shop-desc">${item.kind === 'frame' ? 'Рамка профиля' : 'Звание'}</div><button class="shop-buy-btn ${btnClass}">${btnLabel}</button>`;
      card.querySelector('button').addEventListener('click', () => handleCosmeticClick(item, owned, equipped));
      grid.appendChild(card);
    });
  }
  function handleCosmeticClick(item, owned, equipped) {
    if (equipped) return;
    const ownedMap = item.kind === 'frame' ? state.ownedFrames : state.ownedTitles;
    if (owned) {
      if (item.kind === 'frame') state.equippedFrame = item.id; else state.equippedTitle = item.id;
      saveState(); renderPlayerBadge(); renderFramesTab();
      Sound.click(); haptic('light');
      showToast('Применено: ' + item.name);
      return;
    }
    if (state.gems < item.cost) { showToast('Недостаточно кристаллов 💎'); Sound.error(); haptic('error'); return; }
    state.gems -= item.cost;
    ownedMap[item.id] = true;
    if (item.kind === 'frame') state.equippedFrame = item.id; else state.equippedTitle = item.id;
    saveState();
    renderResources(); renderPlayerBadge(); renderFramesTab();
    Sound.win(); haptic('success');
    showToast('Приобретено: ' + item.name);
  }

  /* ============================================================
     10. ЕЖЕДНЕВНЫЕ ЗАДАНИЯ
     ============================================================ */
  const QUEST_DEFS = [
    { id: 'apples', desc: 'Собери 50 фруктов первого вида 🍎', target: 50, reward: { coins: 80 }, icon: '🍎' },
    { id: 'bombs', desc: 'Используй 3 бомбы 💣', target: 3, reward: { coins: 60 }, icon: '💣' },
    { id: 'levels', desc: 'Пройди 2 уровня', target: 2, reward: { gems: 5 }, icon: '🚩' }
  ];

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function ensureDailyQuests() {
    const today = todayStr();
    if (!state.dailyQuests || state.dailyQuests.date !== today) {
      state.dailyQuests = { date: today, progress: { apples: 0, bombs: 0, levels: 0 }, claimed: { apples: false, bombs: false, levels: false } };
      saveState();
    }
  }

  function incrementQuest(id, amount) {
    ensureDailyQuests();
    const q = QUEST_DEFS.find((d) => d.id === id);
    if (!q) return;
    const cur = state.dailyQuests.progress[id] || 0;
    state.dailyQuests.progress[id] = Math.min(q.target, cur + amount);
    saveState();
  }

  function renderQuests() {
    const list = document.getElementById('questsList');
    list.innerHTML = '';
    QUEST_DEFS.forEach((q) => {
      const cur = state.dailyQuests.progress[q.id] || 0;
      const done = cur >= q.target;
      const claimed = !!state.dailyQuests.claimed[q.id];
      const card = document.createElement('div');
      card.className = 'quest-card';
      const rewardLabel = q.reward.coins ? `+${q.reward.coins} 🪙` : `+${q.reward.gems} 💎`;
      card.innerHTML = `
        <div class="quest-top"><span>${q.icon} ${q.desc}</span><span>${cur}/${q.target}</span></div>
        <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${Math.round((cur / q.target) * 100)}%"></div></div>
        <button class="quest-claim-btn ${claimed ? 'claimed' : (done ? 'ready' : '')}">${claimed ? '✅ Получено' : (done ? `Забрать ${rewardLabel}` : rewardLabel)}</button>
      `;
      const btn = card.querySelector('.quest-claim-btn');
      if (done && !claimed) {
        btn.addEventListener('click', () => {
          state.dailyQuests.claimed[q.id] = true;
          if (q.reward.coins) addCoins(q.reward.coins);
          if (q.reward.gems) addGems(q.reward.gems);
          saveState();
          Sound.win(); haptic('success');
          renderQuests();
        });
      }
      list.appendChild(card);
    });
  }

  document.getElementById('btnQuests').addEventListener('click', () => { haptic('light'); openModal('modalQuests'); });

  /* ============================================================
     11. КОЛЕСО ФОРТУНЫ
     ============================================================ */
  const WHEEL_REWARDS = [
    { label: '+50🪙', apply: () => addCoins(50) },
    { label: '+5💎', apply: () => addGems(5) },
    { label: '+100🪙', apply: () => addCoins(100) },
    { label: '🔨x1', apply: () => { state.boosters.hammer += 1; saveState(); renderBoosterCounts(); } },
    { label: '+10💎', apply: () => addGems(10) },
    { label: '+200🪙', apply: () => addCoins(200) },
    { label: '🔀x1', apply: () => { state.boosters.shuffle += 1; saveState(); renderBoosterCounts(); } },
    { label: '❤️Полные', apply: () => { state.lives = MAX_LIVES; saveState(); } }
  ];

  function refreshWheelState() {
    const canSpin = state.lastWheelSpin !== todayStr();
    document.getElementById('btnSpinWheel').disabled = !canSpin;
    document.getElementById('btnSpinWheel').textContent = canSpin ? 'Крутить' : 'Уже крутили сегодня ✔';
  }

  document.getElementById('btnSpinWheel').addEventListener('click', () => {
    if (state.lastWheelSpin === todayStr()) return;
    const dial = document.getElementById('wheelDial');
    const idx = Math.floor(Math.random() * WHEEL_REWARDS.length);
    const sliceDeg = 360 / WHEEL_REWARDS.length;
    const targetDeg = 360 * 4 + (360 - (idx * sliceDeg) - sliceDeg / 2);
    dial.style.transform = `rotate(${targetDeg}deg)`;
    Sound.booster(); haptic('medium');
    setTimeout(() => {
      WHEEL_REWARDS[idx].apply();
      state.lastWheelSpin = todayStr();
      state.wheelStreak = (state.wheelStreak || 0) + 1;
      saveState();
      renderResources();
      Sound.win(); haptic('success');
      showToast('Награда: ' + WHEEL_REWARDS[idx].label);
      refreshWheelState();
    }, 3300);
  });

  /* ============================================================
     12. ПРОДВИНУТАЯ АДМИН-ПАНЕЛЬ (сервер + клиентские читы)
     ============================================================ */

  // API_BASE пуст — фронтенд и бэкенд раздаются с одного origin (Express static)
  async function apiFetch(url, opts) {
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* noop */ }
    return { ok: res.ok, status: res.status, data };
  }

  /** Проверяем права администратора у СЕРВЕРА (источник истины — ADMIN_ID на бэкенде). */
  async function checkAdminAccess() {
    if (playerId === 'guest') return false;
    const params = new URLSearchParams(adminAuthParams());
    const { ok, data } = await apiFetch('/api/admin/stats?' + params.toString());
    isAdminConfirmed = !!(ok && data && data.success);
    document.getElementById('floatingAdminBtn').classList.toggle('hidden', !isAdminConfirmed);
    return isAdminConfirmed;
  }

  /** Экран техработ: блокирует всех, кроме подтверждённого админа. */
  let clientGameSettings = { maintenanceMode: false, doubleRewards: false };
  async function checkMaintenanceAndSettings() {
    const { ok, data } = await apiFetch('/api/game-settings');
    if (ok && data && data.success) {
      clientGameSettings.maintenanceMode = !!data.maintenanceMode;
      clientGameSettings.doubleRewards = !!data.doubleRewards;
    }
    if (clientGameSettings.maintenanceMode && !isAdminConfirmed) {
      document.getElementById('maintenanceScreen').classList.remove('hidden');
      return true;
    }
    document.getElementById('maintenanceScreen').classList.add('hidden');
    return false;
  }

  /**
   * Синхронизация со своим серверным профилем (data/players.json) — ДВУСТОРОННЯЯ.
   *
   * БАГ, который это чинит: раньше функция только ОТПРАВЛЯЛА (push) локальный прогресс на
   * сервер и никогда не читала его обратно. Из-за этого монеты/кристаллы, начисленные игроку
   * через админ-панель, сохранялись в players.json, но сам игрок их не видел — его следующий
   * же sync (при заходе в игру или после уровня) затирал серверное значение своим старым
   * локальным. Начисление админом "не прибавлялось" игроку.
   *
   * Исправление — merge по времени:
   *   1) PULL: спрашиваем сервер, какой там player.updatedAt.
   *   2) Если серверная запись новее, чем state.lastServerUpdatedAt (последнее известное ЭТОМУ
   *      устройству состояние) — значит изменения внесли ИЗВНЕ (админ или другое устройство).
   *      Подтягиваем coins/gems/lives/уровень с сервера в локальный state.
   *   3) PUSH: в любом случае отправляем актуальное (возможно только что подтянутое) состояние
   *      обратно и запоминаем новый updatedAt — чтобы следующий pull не спутал наш же push
   *      с "чужим" изменением.
   *
   * Заодно проверяет бан (403) — показывает блокирующий экран.
   */
  async function syncProgressWithServer() {
    if (playerId === 'guest') return;

    // 1) PULL — узнаём текущее серверное состояние игрока
    const pullParams = new URLSearchParams({
      telegram_id: playerId,
      name: telegramUser ? (telegramUser.first_name || '') : '',
      username: telegramUser ? (telegramUser.username || '') : ''
    });
    const pull = await apiFetch('/api/player-sync?' + pullParams.toString());

    if (pull.status === 403 || (pull.data && pull.data.player && pull.data.player.isBanned)) {
      document.getElementById('bannedScreen').classList.remove('hidden');
      return;
    }

    if (pull.ok && pull.data && pull.data.success) {
      const sp = pull.data.player;
      if (sp.isBanned) {
        document.getElementById('bannedScreen').classList.remove('hidden');
        return;
      }
      document.getElementById('bannedScreen').classList.add('hidden');

      if (state.lastServerUpdatedAt > 0 && (sp.updatedAt || 0) > state.lastServerUpdatedAt) {
        // Сервер новее — значит, кто-то (админ) поменял данные снаружи. Подтягиваем их.
        // Условие state.lastServerUpdatedAt > 0 защищает НОВОГО игрока: при самом первом
        // запуске сервер только что создал ему запись с нулями (getOrCreatePlayer), и без
        // этой проверки мы бы тут же затёрли стартовые 300🪙/25💎 нулями с сервера.
        state.coins = sp.coins;
        state.gems = sp.gems;
        if (!state.infiniteLives) state.lives = sp.lives;
        state.unlockedLevel = Math.max(1, sp.bestLevel || 1);
        state.lastServerUpdatedAt = sp.updatedAt;
        saveState();
        renderResources();
        if (document.getElementById('screenLevels').classList.contains('active')) renderLevelsGrid();
        showToast('Данные аккаунта обновлены администратором 🔄');
      }
    }

    // 2) PUSH — отправляем актуальное состояние обратно на сервер
    const { ok, status, data } = await apiFetch('/api/save-progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: playerId,
        name: telegramUser ? telegramUser.first_name : undefined,
        username: telegramUser ? telegramUser.username : undefined,
        level: state.unlockedLevel,
        score: state.stats.bestScore || 0,
        coins: state.coins,
        gems: state.gems,
        lives: state.infiniteLives ? 5 : state.lives
      })
    });
    if (!ok && status === 403) {
      document.getElementById('bannedScreen').classList.remove('hidden');
      return;
    }
    if (ok && data && data.success) {
      document.getElementById('bannedScreen').classList.add('hidden');
      // Запоминаем новую метку времени СВОЕГО же push, чтобы при следующем sync не принять
      // собственное обновление за "чужое" (иначе тост "обновлено администратором" вылезал бы
      // на каждом запуске игры без всякой причины).
      state.lastServerUpdatedAt = data.player.updatedAt;
      saveState();
    }
  }

  document.getElementById('floatingAdminBtn').addEventListener('click', () => { haptic('light'); openModal('modalAdminPro'); });


  /* ---------- Вкладка «Статистика» + рассылка ---------- */
  async function renderAdminStats() {
    const box = document.getElementById('adminStatsBox');
    box.textContent = 'Загрузка...';
    const params = new URLSearchParams(adminAuthParams());
    const { ok, data } = await apiFetch('/api/admin/stats?' + params.toString());
    if (!ok || !data || !data.success) { box.textContent = 'Ошибка доступа к статистике.'; return; }
    const s = data.stats;
    let text = `👥 Всего игроков: ${s.totalUsers}\n🟢 Активны сегодня (DAU): ${s.dau}\n🪙 Всего монет в игре: ${s.totalCoins}\n💎 Всего кристаллов: ${s.totalGems}\n📈 Средний уровень: ${s.avgLevel}\n\n🏆 Топ-5 богатейших:\n`;
    s.topRich.forEach((p, i) => { text += `${i + 1}. ${p.name} — ${p.coins}🪙 / ${p.gems}💎\n`; });
    text += `\n🚀 Топ-5 по уровню:\n`;
    s.topLevel.forEach((p, i) => { text += `${i + 1}. ${p.name} — ур. ${p.bestLevel}\n`; });
    box.textContent = text;
  }
  document.getElementById('btnAdminRefreshStats').addEventListener('click', renderAdminStats);

  let broadcastPollTimer = null;
  document.getElementById('btnSendBroadcast').addEventListener('click', async () => {
    const message = document.getElementById('broadcastText').value.trim();
    const buttonText = document.getElementById('broadcastBtnText').value.trim();
    if (!message) { showToast('Введите текст рассылки'); return; }
    const { ok, data } = await apiFetch('/api/admin/broadcast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign(adminAuthParams(), { message, buttonText, buttonUrl: `https://t.me/game_crashfr_bot/Play` }))
    });
    if (!ok || !data || !data.success) { showToast('Не удалось запустить рассылку'); return; }
    document.getElementById('broadcastProgressWrap').classList.remove('hidden');
    pollBroadcastStatus();
  });

  function pollBroadcastStatus() {
    clearInterval(broadcastPollTimer);
    broadcastPollTimer = setInterval(async () => {
      const params = new URLSearchParams(adminAuthParams());
      const { ok, data } = await apiFetch('/api/admin/broadcast/status?' + params.toString());
      if (!ok || !data) return;
      const done = (data.sent || 0) + (data.failed || 0);
      const total = data.total || 1;
      const pct = Math.round((done / total) * 100);
      document.getElementById('broadcastProgressFill').style.width = pct + '%';
      document.getElementById('broadcastProgressLabel').textContent = `${done} / ${total} (✅ ${data.sent} · ❌ ${data.failed})`;
      if (!data.running && done > 0) {
        clearInterval(broadcastPollTimer);
        showToast('Рассылка завершена ✅');
      }
    }, 700);
  }

  /* ---------- Вкладка «Поиск игрока» + список всех игроков ---------- */
  document.getElementById('btnAdminSearch').addEventListener('click', performAdminSearch);
  document.getElementById('adminSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') performAdminSearch(); });

  async function performAdminSearch() {
    const q = document.getElementById('adminSearchInput').value.trim();
    const list = document.getElementById('adminSearchResults');
    if (!q) { list.innerHTML = ''; return; }
    const params = new URLSearchParams(Object.assign(adminAuthParams(), { q }));
    const { ok, data } = await apiFetch('/api/admin/search?' + params.toString());
    list.innerHTML = '';
    if (!ok || !data || !data.success || !data.results.length) { list.innerHTML = '<div class="admin-small-label">Ничего не найдено</div>'; return; }
    data.results.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'admin-result-item';
      item.innerHTML = `<b>${p.name}${p.username ? ' (@' + p.username + ')' : ''}</b>ID: ${p.id} · ур. ${p.bestLevel} · ${p.coins}🪙${p.isBanned ? ' · 🚫 забанен' : ''}`;
      item.addEventListener('click', () => selectAdminPlayer(p.id));
      list.appendChild(item);
    });
  }

  /** «Все зарегистрированные игроки» — кликабельный скролл-список из data/players.json. */
  async function loadAllPlayersList() {
    const wrap = document.getElementById('adminAllPlayersList');
    wrap.innerHTML = '<div class="admin-small-label">Загрузка...</div>';
    const params = new URLSearchParams(adminAuthParams());
    const { ok, data } = await apiFetch('/api/admin/players?' + params.toString());
    if (!ok || !data || !data.success) { wrap.innerHTML = '<div class="admin-small-label">Не удалось загрузить список</div>'; return; }
    if (!data.players.length) { wrap.innerHTML = '<div class="admin-small-label">Пока нет ни одного игрока</div>'; return; }
    wrap.innerHTML = '';
    data.players.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'admin-player-row' + (String(p.id) === String(adminSelectedPlayerId) ? ' selected' : '');
      const initial = (p.name || '?').charAt(0).toUpperCase();
      row.innerHTML = `
        <div class="admin-player-avatar">${initial}</div>
        <div class="admin-player-row-info">
          <b>${p.name}${p.username ? ' <span class="admin-row-username">@' + p.username + '</span>' : ''}</b>
          <span class="admin-row-sub">🪙 ${p.coins} · ур. ${p.bestLevel}</span>
        </div>
        <div class="admin-row-status ${p.isBanned ? 'banned' : 'active'}">${p.isBanned ? '🚫 Забанен' : '✅ Активен'}</div>
      `;
      row.addEventListener('click', () => {
        document.getElementById('adminSearchInput').value = p.id;
        selectAdminPlayer(p.id);
        haptic('light'); Sound.select();
      });
      wrap.appendChild(row);
    });
  }

  let adminSelectedPlayerId = null;
  async function selectAdminPlayer(id) {
    const params = new URLSearchParams(adminAuthParams());
    const { ok, data } = await apiFetch(`/api/admin/player/${id}?` + params.toString());
    if (!ok || !data || !data.success) { showToast('Не удалось загрузить игрока'); return; }
    adminSelectedPlayerId = String(id);
    renderAdminPlayerDetail(data.player);
    loadAllPlayersList(); // подсветить выбранную строку
  }

  /**
   * Карточка игрока: текущие значения (coins||0, gems||0, lives||5, bestLevel||1 — сервер уже
   * гарантирует эти дефолты через normalizePlayer) ЗАШИТЫ в поля ввода как value=, поэтому
   * админ сразу видит актуальные цифры, а не 0/null/"-".
   */
  function renderAdminPlayerDetail(p) {
    const box = document.getElementById('adminPlayerDetail');
    box.classList.remove('hidden');
    const created = p.createdAt ? new Date(p.createdAt).toLocaleDateString('ru-RU') : '—';
    box.innerHTML = `
      <div class="admin-detail-row"><span>Имя</span><span>${p.name}${p.username ? ' (@' + p.username + ')' : ''}</span></div>
      <div class="admin-detail-row"><span>ID</span><span>${p.id}</span></div>
      <div class="admin-detail-row"><span>📅 Регистрация</span><span>${created}</span></div>
      <div class="admin-detail-row"><span>Статус</span><span>${p.isBanned ? '🚫 Забанен' : '✅ Активен'}</span></div>

      <div class="admin-field-row">
        <label>🪙 Монеты</label>
        <input id="fieldCoins" type="number" value="${p.coins}" />
        <button id="btnAddCoins" title="Прибавить введённое число (можно отрицательное)">➕ Добавить</button>
        <button id="btnSetCoins" title="Установить ровно это значение">= Установить</button>
      </div>
      <div class="admin-field-row">
        <label>💎 Кристаллы</label>
        <input id="fieldGems" type="number" value="${p.gems}" />
        <button id="btnAddGems">➕ Добавить</button>
        <button id="btnSetGems">= Установить</button>
      </div>
      <div class="admin-field-row">
        <label>🚩 Уровень</label>
        <input id="fieldLevel" type="number" min="1" max="99" value="${p.bestLevel}" />
        <button id="btnSetLevel" class="wide">Установить уровень</button>
      </div>

      <div class="admin-actions-grid">
        <button id="btnRestoreLives" class="positive">Восстановить жизни ❤️ (5)</button>
        <button id="btnBlockLives" class="danger">Заблокировать жизни (0)</button>
        <button id="btnToggleBan" class="${p.isBanned ? 'positive' : 'danger'}">${p.isBanned ? 'Разбанить ✅' : 'Забанить 🚫'}</button>
        <button id="btnResetPlayer" class="danger">Сбросить прогресс 🔄</button>
      </div>
    `;
    document.getElementById('btnAddCoins').addEventListener('click', () => adminAction('update_coins', { mode: 'add', value: numVal('fieldCoins') }));
    document.getElementById('btnSetCoins').addEventListener('click', () => adminAction('update_coins', { mode: 'set', value: numVal('fieldCoins') }));
    document.getElementById('btnAddGems').addEventListener('click', () => adminAction('update_gems', { mode: 'add', value: numVal('fieldGems') }));
    document.getElementById('btnSetGems').addEventListener('click', () => adminAction('update_gems', { mode: 'set', value: numVal('fieldGems') }));
    document.getElementById('btnSetLevel').addEventListener('click', () => adminAction('set_level', { level: numVal('fieldLevel') }));
    document.getElementById('btnRestoreLives').addEventListener('click', () => adminAction('set_lives', { mode: 'restore' }));
    document.getElementById('btnBlockLives').addEventListener('click', () => adminAction('set_lives', { mode: 'block' }));
    document.getElementById('btnToggleBan').addEventListener('click', () => adminAction('toggle_ban', { isBanned: !p.isBanned }));
    document.getElementById('btnResetPlayer').addEventListener('click', () => {
      if (!confirm('Точно сбросить прогресс этого игрока?')) return;
      adminAction('reset_progress', {});
    });
  }

  function numVal(id) { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? 0 : v; }

  /** Единый вызов POST /api/admin/action — обновляет карточку и общий список МГНОВЕННО. */
  async function adminAction(action, payload) {
    const { ok, data } = await apiFetch('/api/admin/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign(adminAuthParams(), { target_id: adminSelectedPlayerId, action }, payload))
    });
    if (ok && data && data.success) {
      renderAdminPlayerDetail(data.player);
      loadAllPlayersList();
      showToast('Данные игрока успешно обновлены!');
      Sound.win(); haptic('success');
    } else {
      showToast((data && data.error) || 'Ошибка применения действия');
      Sound.error(); haptic('error');
    }
  }

  /* ---------- Вкладка «Глобальные настройки» ---------- */
  async function renderAdminGlobalSettings() {
    const params = new URLSearchParams(adminAuthParams());
    const { ok, data } = await apiFetch('/api/admin/settings?' + params.toString());
    if (!ok || !data || !data.success) return;
    clientGameSettings.maintenanceMode = !!data.settings.maintenanceMode;
    clientGameSettings.doubleRewards = !!data.settings.doubleRewards;
    const mBtn = document.getElementById('btnToggleMaintenance');
    const dBtn = document.getElementById('btnToggleDouble');
    mBtn.textContent = clientGameSettings.maintenanceMode ? 'Вкл ✅' : 'Выкл';
    mBtn.classList.toggle('on', clientGameSettings.maintenanceMode);
    dBtn.textContent = clientGameSettings.doubleRewards ? 'Вкл ✅' : 'Выкл';
    dBtn.classList.toggle('on', clientGameSettings.doubleRewards);
  }
  document.getElementById('btnToggleMaintenance').addEventListener('click', async () => {
    const { ok, data } = await apiFetch('/api/admin/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign(adminAuthParams(), { maintenanceMode: !clientGameSettings.maintenanceMode }))
    });
    if (ok && data && data.success) { renderAdminGlobalSettings(); showToast('Настройка обновлена'); }
  });
  document.getElementById('btnToggleDouble').addEventListener('click', async () => {
    const { ok, data } = await apiFetch('/api/admin/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign(adminAuthParams(), { doubleRewards: !clientGameSettings.doubleRewards }))
    });
    if (ok && data && data.success) { renderAdminGlobalSettings(); showToast('Настройка обновлена'); }
  });

  /* ---------- Быстрые читы (применяются к своему локальному аккаунту) ---------- */
  document.getElementById('btnAdminCoins').addEventListener('click', () => { addCoins(10000); showToast('+10 000 монет'); Sound.win(); syncProgressWithServer(); });
  document.getElementById('btnAdminGems').addEventListener('click', () => { addGems(500); showToast('+500 кристаллов'); Sound.win(); syncProgressWithServer(); });
  document.getElementById('btnAdminUnlock').addEventListener('click', () => {
    state.unlockedLevel = LEVEL_COUNT; saveState(); showToast('Все уровни открыты 🔓'); Sound.win();
  });
  document.getElementById('btnAdminInfLives').addEventListener('click', () => {
    state.infiniteLives = !state.infiniteLives; saveState(); renderResources();
    showToast(state.infiniteLives ? 'Бесконечные жизни включены' : 'Бесконечные жизни выключены');
  });
  document.getElementById('btnAdminReset').addEventListener('click', () => {
    if (!confirm('Точно сбросить весь прогресс?')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
    state = defaultState();
    saveState();
    applyEquippedSkin();
    renderResources(); renderPlayerBadge();
    closeModal('modalAdminPro');
    showScreen('screenMenu');
    showToast('Прогресс сброшен');
  });

  /* ============================================================
     13. ПРИВЯЗКА КНОПОК ГЛАВНОГО МЕНЮ
     ============================================================ */
  document.getElementById('btnPlay').addEventListener('click', () => { haptic('light'); showScreen('screenLevels'); });
  document.getElementById('btnShop').addEventListener('click', () => { haptic('light'); openModal('modalShop'); });
  document.getElementById('btnWheel').addEventListener('click', () => { haptic('light'); openModal('modalWheel'); });
  document.getElementById('btnLeaderboard').addEventListener('click', () => { haptic('light'); openModal('modalLeaderboard'); });
  document.getElementById('btnAchievements').addEventListener('click', () => { haptic('light'); openModal('modalAchievements'); });

  /* ============================================================
     14. ИГРОВОЙ ДВИЖОК MATCH-3 (размер поля, режимы, скины, частицы)
     ============================================================ */
  let SIZE = 8;
  let FRUIT_EMOJI = SKINS.classic.emojis.slice();
  function applyEquippedSkin() {
    const skin = SKINS[state.equippedSkin] || SKINS.classic;
    FRUIT_EMOJI = skin.emojis.slice();
  }
  applyEquippedSkin();

  const SWAP_ANIM_MS = 220;
  const MATCH_ANIM_MS = 260;
  const FALL_ANIM_MS = 280;
  const DRAG_THRESHOLD = 18;

  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('scoreValue');
  const movesEl = document.getElementById('movesValue');
  const timeEl = document.getElementById('timeValue');
  const particleCanvas = document.getElementById('particleCanvas');
  const pctx = particleCanvas.getContext('2d');

  let board = [];
  let tileEls = [];
  let cellBgEls = [];
  let icedSet = new Set();
  let currentLevel = null;
  let busy = false;
  let selected = null;
  let armedBooster = null;
  let cellSize = 0;
  let paused = false;
  let timeAttackTimer = null;
  let lastActionAt = Date.now();

  function key(r, c) { return r + ',' + c; }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function randType() {
    const max = (currentLevel && currentLevel.fruitCount) ? currentLevel.fruitCount : FRUIT_EMOJI.length;
    return Math.floor(Math.random() * max);
  }
  function inBounds(pos) { return pos.row >= 0 && pos.row < SIZE && pos.col >= 0 && pos.col < SIZE; }
  function isAdjacent(a, b) { return (Math.abs(a.row - b.row) + Math.abs(a.col - b.col)) === 1; }
  function isSpecialType(v) { return typeof v === 'string' && v.indexOf('S_') === 0 && v !== 'S_CHOCO'; }
  function specialEmoji(t) { return { S_ROCKET_H: '🚀', S_ROCKET_V: '🚀', S_BOMB: '💣', S_RAINBOW: '🌈' }[t] || '❓'; }
  function specialClass(t) { return { S_ROCKET_H: 'special-rocket-h', S_ROCKET_V: 'special-rocket-v', S_BOMB: 'special-bomb', S_RAINBOW: 'special-rainbow' }[t] || ''; }
  function isMovable(pos) {
    const v = board[pos.row][pos.col];
    if (v === 'S_CHOCO' || v === 'ING') return false;
    if (icedSet.has(key(pos.row, pos.col))) return false;
    return true;
  }
  function swapCellsInPlace(b, r1, c1, r2, c2) { const t = b[r1][c1]; b[r1][c1] = b[r2][c2]; b[r2][c2] = t; }
  function resetIdleTimer() { lastActionAt = Date.now(); clearTileHints(); }

  function pickCommonFruitType() {
    const max = (currentLevel && currentLevel.fruitCount) ? currentLevel.fruitCount : FRUIT_EMOJI.length;
    const counts = new Array(max).fill(0);
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const v = board[r][c]; if (typeof v === 'number') counts[v]++; }
    let best = 0, bestCount = -1;
    counts.forEach((cnt, i) => { if (cnt > bestCount) { bestCount = cnt; best = i; } });
    return best;
  }

  function computeExplosionCells(r, c, type, targetType) {
    const cells = new Set();
    cells.add(key(r, c));
    if (type === 'S_ROCKET_H') { for (let cc = 0; cc < SIZE; cc++) cells.add(key(r, cc)); }
    else if (type === 'S_ROCKET_V') { for (let rr = 0; rr < SIZE; rr++) cells.add(key(rr, c)); }
    else if (type === 'S_BOMB') {
      for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) {
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) cells.add(key(rr, cc));
      }
    } else if (type === 'S_RAINBOW') {
      const tt = (targetType !== null && targetType !== undefined) ? targetType : pickCommonFruitType();
      for (let rr = 0; rr < SIZE; rr++) for (let cc = 0; cc < SIZE; cc++) { if (board[rr][cc] === tt) cells.add(key(rr, cc)); }
    }
    return Array.from(cells);
  }

  /* ---------- Частицы сока (Canvas) ---------- */
  const FRUIT_COLORS = ['#ff5d7a', '#ffd23f', '#ff8fd6', '#b24dff', '#ffb347', '#4fe3ff'];
  let particles = [];
  function resizeParticleCanvas() {
    const rect = boardEl.getBoundingClientRect();
    particleCanvas.width = rect.width;
    particleCanvas.height = rect.height;
    particleCanvas.style.width = rect.width + 'px';
    particleCanvas.style.height = rect.height + 'px';
  }
  function cellCenterPx(r, c) {
    const gapPx = 4;
    const step = cellSize + gapPx;
    const padding = 8;
    return { x: padding + c * step + cellSize / 2, y: padding + r * step + cellSize / 2 };
  }
  function spawnBurst(px, py, color, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 2.5;
      particles.push({ x: px, y: py, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 1, life: 1, color, size: 2 + Math.random() * 2 });
    }
  }
  function tickParticles() {
    pctx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    if (particles.length) {
      particles.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.035; });
      particles = particles.filter((p) => p.life > 0);
      particles.forEach((p) => {
        pctx.globalAlpha = Math.max(0, p.life);
        pctx.fillStyle = p.color;
        pctx.beginPath();
        pctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        pctx.fill();
      });
      pctx.globalAlpha = 1;
    }
    requestAnimationFrame(tickParticles);
  }
  requestAnimationFrame(tickParticles);

  /* ---------- Конфетти на весь экран при победе ---------- */
  const confettiCanvas = document.getElementById('confettiCanvas');
  const cctx = confettiCanvas.getContext('2d');
  let confettiParticles = [];
  let confettiRunning = false;
  function resizeConfettiCanvas() {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeConfettiCanvas);
  resizeConfettiCanvas();

  function fireConfetti(stars) {
    resizeConfettiCanvas();
    const colors = ['#ff4fa3', '#ffd23f', '#4fe3ff', '#b24dff', '#38d97a'];
    const count = 60 + (stars || 1) * 25;
    for (let i = 0; i < count; i++) {
      confettiParticles.push({
        x: Math.random() * confettiCanvas.width,
        y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 2.2,
        vy: 2 + Math.random() * 3,
        size: 4 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.3,
        life: 1
      });
    }
    if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(tickConfetti); }
  }

  function tickConfetti() {
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiParticles.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.rot += p.vrot; p.life -= 0.006; });
    confettiParticles = confettiParticles.filter((p) => p.life > 0 && p.y < confettiCanvas.height + 40);
    confettiParticles.forEach((p) => {
      cctx.save();
      cctx.translate(p.x, p.y);
      cctx.rotate(p.rot);
      cctx.globalAlpha = Math.max(0, p.life);
      cctx.fillStyle = p.color;
      cctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      cctx.restore();
    });
    if (confettiParticles.length > 0) requestAnimationFrame(tickConfetti);
    else { confettiRunning = false; cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height); }
  }

  function burstAtCells(cellKeys, colorOverride) {
    cellKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      const val = board[r] ? board[r][c] : undefined;
      const pos = cellCenterPx(r, c);
      let color = colorOverride;
      if (!color) {
        if (typeof val === 'number') color = FRUIT_COLORS[val % FRUIT_COLORS.length];
        else color = '#ffffff';
      }
      spawnBurst(pos.x, pos.y, color, 4);
    });
  }

  /* ---------- Всплывающие надписи ---------- */
  const SWEET_WORDS = ['SWEET!', 'JUICY!', 'TASTY!', 'YUMMY!'];
  const COMBO_WORDS = ['COMBO!', 'AWESOME!', 'UNSTOPPABLE!'];
  function showFloatingLabel(text) {
    const rect = boardEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'float-label';
    el.textContent = text;
    el.style.left = (rect.left + rect.width / 2 - 60 + (Math.random() * 40 - 20)) + 'px';
    el.style.top = (rect.top + rect.height / 2 - 20) + 'px';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.top = (rect.top + rect.height / 2 - 90) + 'px'; el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 800);
  }

  /* ---------- Построение поля ---------- */
  function buildFruitOnlyBoard() {
    const b = [];
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) {
        let t;
        do { t = randType(); } while (
          (c >= 2 && row[c - 1] === t && row[c - 2] === t) ||
          (r >= 2 && b[r - 1][c] === t && b[r - 2][c] === t)
        );
        row.push(t);
      }
      b.push(row);
    }
    return b;
  }

  function buildBoardForLevel(cfg) {
    SIZE = cfg.size;
    board = buildFruitOnlyBoard();
    icedSet = new Set();

    let placed = 0, guard = 0;
    while (placed < cfg.chocoCount && guard < 500) {
      guard++;
      const r = Math.floor(Math.random() * SIZE), c = Math.floor(Math.random() * SIZE);
      if (board[r][c] === 'S_CHOCO') continue;
      board[r][c] = 'S_CHOCO'; placed++;
    }
    placed = 0; guard = 0;
    while (placed < cfg.iceCount && guard < 500) {
      guard++;
      const r = Math.floor(Math.random() * SIZE), c = Math.floor(Math.random() * SIZE);
      const k = key(r, c);
      if (board[r][c] === 'S_CHOCO' || icedSet.has(k)) continue;
      icedSet.add(k); placed++;
    }

    if (cfg.mode === 'ingredient') {
      const target = cfg.goals[0].target;
      placed = 0; guard = 0;
      while (placed < target && guard < 500) {
        guard++;
        const r = Math.floor(Math.random() * Math.min(2, SIZE));
        const c = Math.floor(Math.random() * SIZE);
        if (board[r][c] === 'S_CHOCO' || board[r][c] === 'ING') continue;
        board[r][c] = 'ING';
        placed++;
      }
    }

    renderAll();
    if (!hasAnyValidMoveBoard()) { reshuffleBoard(); }
  }

  /* ---------- Рендер ---------- */
  function renderAll() {
    boardEl.innerHTML = '';
    boardEl.appendChild(particleCanvas);
    tileEls = [];
    cellBgEls = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      const cell = document.createElement('div');
      cell.className = 'cell' + (icedSet.has(key(r, c)) ? ' obstacle-ice' : '');
      boardEl.appendChild(cell);
      cellBgEls.push(cell);
    }
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) {
        const t = createTileEl(r, c, board[r][c]);
        boardEl.appendChild(t);
        row.push(t);
      }
      tileEls.push(row);
    }
    layoutBoard(false);
    resizeParticleCanvas();
  }

  function createTileEl(r, c, val) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.row = r; el.dataset.col = c;
    if (typeof val === 'number') {
      el.textContent = FRUIT_EMOJI[val];
    } else if (val === 'S_CHOCO') {
      el.textContent = '🍫';
      el.classList.add('obstacle-choco');
    } else if (val === 'ING') {
      el.textContent = (currentLevel && currentLevel.ingredientEmoji) || '🥥';
      el.classList.add('tile-ingredient');
    } else if (isSpecialType(val)) {
      el.textContent = specialEmoji(val);
      el.classList.add(specialClass(val));
    }
    if (icedSet.has(key(r, c))) el.classList.add('iced');
    attachTileEvents(el);
    return el;
  }

  function layoutBoard(animate) {
    const rect = boardEl.getBoundingClientRect();
    if (!rect.width) return;
    const styles = getComputedStyle(boardEl);
    const padding = parseFloat(styles.paddingLeft) || 8;
    const gapPx = 4;
    const inner = rect.width - padding * 2 - gapPx * (SIZE - 1);
    cellSize = inner / SIZE;
    const step = cellSize + gapPx;
    for (let i = 0; i < cellBgEls.length; i++) {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      const el = cellBgEls[i];
      el.style.width = cellSize + 'px'; el.style.height = cellSize + 'px';
      el.style.left = (c * step) + 'px'; el.style.top = (r * step) + 'px';
    }
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = tileEls[r] && tileEls[r][c];
        if (!el) continue;
        if (!animate) el.style.transition = 'none';
        positionTile(el, r, c);
        if (!animate) { void el.offsetWidth; el.style.transition = ''; }
      }
    }
    resizeParticleCanvas();
  }

  function positionTile(el, r, c) {
    const gapPx = 4;
    const step = cellSize + gapPx;
    el.style.width = cellSize + 'px'; el.style.height = cellSize + 'px';
    el.style.left = (c * step) + 'px'; el.style.top = (r * step) + 'px';
    el.dataset.row = r; el.dataset.col = c;
  }

  window.addEventListener('resize', () => { if (currentLevel) layoutBoard(false); });

  /* ---------- Подсказки (hint system) ---------- */
  function findHintMove() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!isMovable({ row: r, col: c })) continue;
        if (c < SIZE - 1 && isMovable({ row: r, col: c + 1 })) {
          swapCellsInPlace(board, r, c, r, c + 1);
          const ok = analyzeMatches(board).matchedCells.size > 0;
          swapCellsInPlace(board, r, c, r, c + 1);
          if (ok) return { a: { row: r, col: c }, b: { row: r, col: c + 1 } };
        }
        if (r < SIZE - 1 && isMovable({ row: r + 1, col: c })) {
          swapCellsInPlace(board, r, c, r + 1, c);
          const ok = analyzeMatches(board).matchedCells.size > 0;
          swapCellsInPlace(board, r, c, r + 1, c);
          if (ok) return { a: { row: r, col: c }, b: { row: r + 1, col: c } };
        }
      }
    }
    return null;
  }
  let hintEls = [];
  function clearTileHints() {
    hintEls.forEach((el) => el && el.classList.remove('hint'));
    hintEls = [];
  }
  function showHint() {
    if (!currentLevel || busy || paused) return;
    const move = findHintMove();
    if (!move) return;
    const elA = tileEls[move.a.row][move.a.col], elB = tileEls[move.b.row][move.b.col];
    clearTileHints();
    if (elA) { elA.classList.add('hint'); hintEls.push(elA); }
    if (elB) { elB.classList.add('hint'); hintEls.push(elB); }
  }
  setInterval(() => {
    const gameActive = document.getElementById('screenGame').classList.contains('active');
    if (gameActive && currentLevel && !busy && !paused && (Date.now() - lastActionAt >= 4000)) {
      showHint();
      lastActionAt = Date.now() - 3000; // повторять подсказку раз в секунду, пока бездействие продолжается
    }
  }, 1000);

  /* ---------- Ввод ---------- */
  function attachTileEvents(el) {
    let startX = 0, startY = 0, dragging = false, moved = false;

    el.addEventListener('pointerdown', (e) => {
      if (busy) return;
      resetIdleTimer();
      const r = parseInt(el.dataset.row, 10), c = parseInt(el.dataset.col, 10);
      if (armedBooster) { triggerArmedBoosterOnTile(r, c); return; }
      if (board[r][c] === 'S_CHOCO' || board[r][c] === 'ING') return;
      startX = e.clientX; startY = e.clientY; dragging = true; moved = false;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging || busy || moved) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      moved = true; dragging = false;
      const r = parseInt(el.dataset.row, 10), c = parseInt(el.dataset.col, 10);
      let tr = r, tc = c;
      if (Math.abs(dx) > Math.abs(dy)) tc += dx > 0 ? 1 : -1; else tr += dy > 0 ? 1 : -1;
      clearSelection(); selected = null;
      attemptSwap({ row: r, col: c }, { row: tr, col: tc });
    });

    el.addEventListener('pointerup', () => {
      if (!moved && dragging) {
        const r = parseInt(el.dataset.row, 10), c = parseInt(el.dataset.col, 10);
        handleTap(r, c);
      }
      dragging = false; moved = false;
    });

    el.addEventListener('pointercancel', () => { dragging = false; moved = false; });
  }

  function handleTap(r, c) {
    if (busy || !currentLevel) return;
    if (board[r][c] === 'S_CHOCO' || board[r][c] === 'ING') return;
    resetIdleTimer();
    Sound.select(); haptic('select');
    if (!selected) { selected = { row: r, col: c }; setSelectedVisual(r, c, true); return; }
    if (selected.row === r && selected.col === c) { setSelectedVisual(r, c, false); selected = null; return; }
    if (isAdjacent(selected, { row: r, col: c })) {
      const from = selected, to = { row: r, col: c };
      clearSelection(); selected = null;
      attemptSwap(from, to);
    } else {
      clearSelection();
      selected = { row: r, col: c };
      setSelectedVisual(r, c, true);
    }
  }

  function setSelectedVisual(r, c, on) { const el = tileEls[r][c]; if (el) el.classList.toggle('selected', on); }
  function clearSelection() { if (selected) setSelectedVisual(selected.row, selected.col, false); }

  /* ---------- Свап и разрешение совпадений ---------- */
  function swapModel(a, b) {
    const tmp = board[a.row][a.col]; board[a.row][a.col] = board[b.row][b.col]; board[b.row][b.col] = tmp;
    const tmpEl = tileEls[a.row][a.col]; tileEls[a.row][a.col] = tileEls[b.row][b.col]; tileEls[b.row][b.col] = tmpEl;
  }
  function animateSwap(a, b) {
    positionTile(tileEls[a.row][a.col], a.row, a.col);
    positionTile(tileEls[b.row][b.col], b.row, b.col);
  }
  function markInvalid(a, b) {
    [a, b].forEach((pos) => {
      const el = tileEls[pos.row][pos.col];
      if (!el) return;
      el.classList.add('swap-invalid');
      setTimeout(() => el.classList.remove('swap-invalid'), 320);
    });
  }

  async function attemptSwap(a, b) {
    if (busy || !currentLevel || paused) return;
    if (!inBounds(a) || !inBounds(b) || !isAdjacent(a, b)) return;
    if (currentLevel.movesLeft <= 0) return;
    if (!isMovable(a) || !isMovable(b)) { markInvalid(a, b); Sound.error(); haptic('error'); return; }

    busy = true;
    const valA = board[a.row][a.col];
    const valB = board[b.row][b.col];
    const aIsSpecial = isSpecialType(valA);
    const bIsSpecial = isSpecialType(valB);

    swapModel(a, b);
    animateSwap(a, b);
    await wait(SWAP_ANIM_MS);

    if (aIsSpecial || bIsSpecial) {
      currentLevel.movesLeft = Math.max(0, currentLevel.movesLeft - 1);
      updateGameHUD();
      Sound.click(); haptic('medium');
      const cellSet = new Set();
      if (aIsSpecial) {
        const targetType = (valA === 'S_RAINBOW') ? (typeof valB === 'number' ? valB : null) : null;
        computeExplosionCells(b.row, b.col, valA, targetType).forEach((k) => cellSet.add(k));
      }
      if (bIsSpecial) {
        const targetType = (valB === 'S_RAINBOW') ? (typeof valA === 'number' ? valA : null) : null;
        computeExplosionCells(a.row, a.col, valB, targetType).forEach((k) => cellSet.add(k));
      }
      await performExplosion(cellSet, 1);
      busy = false;
      afterMoveChecks();
      return;
    }

    const analysis = analyzeMatches(board);
    if (analysis.matchedCells.size === 0) {
      Sound.error(); haptic('error');
      markInvalid(a, b);
      await wait(180);
      swapModel(a, b);
      animateSwap(a, b);
      await wait(SWAP_ANIM_MS);
      busy = false;
      return;
    }

    currentLevel.movesLeft = Math.max(0, currentLevel.movesLeft - 1);
    updateGameHUD();
    Sound.click();

    await performMatchResolution(analysis.matchedCells, analysis.specials, 1);
    busy = false;
    afterMoveChecks();
  }

  /* ---------- Поиск совпадений + спец-фишки ---------- */
  function analyzeMatches(b) {
    const matched = new Set();
    const hRuns = [], vRuns = [];

    for (let r = 0; r < SIZE; r++) {
      let run = 1;
      for (let c = 1; c <= SIZE; c++) {
        const same = c < SIZE && typeof b[r][c] === 'number' && b[r][c] === b[r][c - 1];
        if (same) { run++; } else {
          if (run >= 3) {
            const cStart = c - run;
            hRuns.push({ row: r, cStart, cEnd: c - 1, len: run });
            for (let k = cStart; k < c; k++) matched.add(key(r, k));
          }
          run = 1;
        }
      }
    }
    for (let c = 0; c < SIZE; c++) {
      let run = 1;
      for (let r = 1; r <= SIZE; r++) {
        const same = r < SIZE && typeof b[r][c] === 'number' && b[r][c] === b[r - 1][c];
        if (same) { run++; } else {
          if (run >= 3) {
            const rStart = r - run;
            vRuns.push({ col: c, rStart, rEnd: r - 1, len: run });
            for (let k = rStart; k < r; k++) matched.add(key(k, c));
          }
          run = 1;
        }
      }
    }

    if (matched.size === 0) return { matchedCells: matched, specials: [] };

    const specials = [];
    const claimed = new Set();

    hRuns.forEach((hr) => {
      vRuns.forEach((vr) => {
        if (vr.col >= hr.cStart && vr.col <= hr.cEnd && hr.row >= vr.rStart && hr.row <= vr.rEnd) {
          const k = key(hr.row, vr.col);
          if (!claimed.has(k)) { claimed.add(k); specials.push({ row: hr.row, col: vr.col, type: 'S_BOMB' }); }
        }
      });
    });
    hRuns.forEach((hr) => {
      if (hr.len >= 5) {
        const mid = Math.floor((hr.cStart + hr.cEnd) / 2);
        const k = key(hr.row, mid);
        if (!claimed.has(k)) { claimed.add(k); specials.push({ row: hr.row, col: mid, type: 'S_RAINBOW' }); }
      }
    });
    vRuns.forEach((vr) => {
      if (vr.len >= 5) {
        const mid = Math.floor((vr.rStart + vr.rEnd) / 2);
        const k = key(mid, vr.col);
        if (!claimed.has(k)) { claimed.add(k); specials.push({ row: mid, col: vr.col, type: 'S_RAINBOW' }); }
      }
    });
    hRuns.forEach((hr) => {
      if (hr.len === 4) {
        const mid = hr.cStart + Math.floor((hr.cEnd - hr.cStart) / 2);
        const k = key(hr.row, mid);
        if (!claimed.has(k)) { claimed.add(k); specials.push({ row: hr.row, col: mid, type: 'S_ROCKET_H' }); }
      }
    });
    vRuns.forEach((vr) => {
      if (vr.len === 4) {
        const mid = vr.rStart + Math.floor((vr.rEnd - vr.rStart) / 2);
        const k = key(mid, vr.col);
        if (!claimed.has(k)) { claimed.add(k); specials.push({ row: mid, col: vr.col, type: 'S_ROCKET_V' }); }
      }
    });

    return { matchedCells: matched, specials };
  }

  /* ---------- Очки, цели, задания ---------- */
  function registerCombo(cascadeLevel) {
    if (cascadeLevel > 1 && currentLevel && currentLevel.mode === 'timeattack') {
      const g = currentLevel.goals.find((x) => x.type === 'combo');
      if (g && g.current < g.target) g.current++;
    }
  }

  function addScoreAndGoals(cellKeys, cascadeLevel) {
    let scoreGain = 0;
    cellKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      const val = board[r][c];
      if (typeof val === 'number') {
        scoreGain += 10;
        state.stats.totalCleared++;
        if (val === 0) incrementQuest('apples', 1);
        currentLevel.goals.forEach((g) => { if (g.type === 'collect' && g.fruit === val && g.current < g.target) g.current++; });
      } else if (val === 'S_CHOCO') {
        scoreGain += 15;
      } else if (isSpecialType(val)) {
        scoreGain += 40;
      }
    });
    const bonus = cellKeys.length > 8 ? (cellKeys.length - 8) * 5 : 0;
    const mult = 1 + (cascadeLevel - 1) * 0.5;
    const total = Math.max(0, Math.round((scoreGain + bonus) * mult));
    currentLevel.score += total;
    const scoreGoal = currentLevel.goals.find((g) => g.type === 'score');
    if (scoreGoal) scoreGoal.current = currentLevel.score;
    const coinsGain = Math.max(0, Math.round(total / 10));
    if (coinsGain > 0) { addCoins(coinsGain); flyCoins(coinsGain); }
    updateGameHUD();
    renderGoalPanel();
  }

  function damageObstaclesNear(cellSet) {
    const toDestroy = new Set();
    cellSet.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([rr, cc]) => {
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) return;
        const kk = key(rr, cc);
        if (board[rr][cc] === 'S_CHOCO') toDestroy.add(kk);
        if (icedSet.has(kk)) {
          icedSet.delete(kk);
          const el = tileEls[rr][cc]; if (el) el.classList.remove('iced');
          const iceGoal = currentLevel && currentLevel.goals.find((g) => g.type === 'ice');
          if (iceGoal && iceGoal.current < iceGoal.target) iceGoal.current++;
        }
      });
    });
    toDestroy.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      removeTileAt(r, c);
      if (currentLevel) currentLevel.score += 5;
    });
  }

  function removeTileAt(r, c) {
    const el = tileEls[r][c];
    if (el && el.parentNode) el.parentNode.removeChild(el);
    tileEls[r][c] = null;
    board[r][c] = null;
  }

  async function performMatchResolution(matchedCells, specials, cascadeLevel) {
    const specialMap = new Map();
    specials.forEach((s) => specialMap.set(key(s.row, s.col), s.type));
    const toConvert = [], toClear = [];
    matchedCells.forEach((k) => { if (specialMap.has(k)) toConvert.push(k); else toClear.push(k); });

    toClear.forEach((k) => { const [r, c] = k.split(',').map(Number); const el = tileEls[r][c]; if (el) el.classList.add('matched'); });

    const totalCount = matchedCells.size;
    burstAtCells(toClear);
    addScoreAndGoals(toClear, cascadeLevel);
    registerCombo(cascadeLevel);
    showCombo(cascadeLevel, totalCount);
    if (totalCount >= 4) showFloatingLabel(SWEET_WORDS[Math.floor(Math.random() * SWEET_WORDS.length)]);
    if (cascadeLevel >= 2) showFloatingLabel(COMBO_WORDS[Math.min(cascadeLevel - 2, COMBO_WORDS.length - 1)] + (cascadeLevel > 2 ? ` x${cascadeLevel}` : ''));
    Sound.matchN(totalCount);
    if (cascadeLevel > 1) Sound.combo(cascadeLevel);
    if (toConvert.length) Sound.booster();
    haptic(cascadeLevel > 1 ? 'heavy' : 'medium');
    state.stats.bestCombo = Math.max(state.stats.bestCombo, cascadeLevel);

    await wait(MATCH_ANIM_MS);

    damageObstaclesNear(matchedCells);
    toClear.forEach((k) => { const [r, c] = k.split(',').map(Number); removeTileAt(r, c); });
    toConvert.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      const type = specialMap.get(k);
      board[r][c] = type;
      const el = tileEls[r][c];
      if (el) {
        el.textContent = specialEmoji(type);
        el.className = 'tile ' + specialClass(type);
        positionTile(el, r, c);
        el.classList.add('spawning');
        setTimeout(() => el.classList.remove('spawning'), 420);
      }
    });

    await collapseAndRefill();
    await wait(FALL_ANIM_MS);
    await continueCascade(cascadeLevel + 1);
  }

  async function performExplosion(initialCellSet, cascadeLevel) {
    const set = new Set(initialCellSet);
    const queue = Array.from(set);
    const processed = new Set();
    while (queue.length) {
      const k = queue.pop();
      if (processed.has(k)) continue;
      const [r, c] = k.split(',').map(Number);
      const val = board[r] ? board[r][c] : undefined;
      if (isSpecialType(val)) {
        processed.add(k);
        if (val === 'S_BOMB') incrementQuest('bombs', 1);
        const extra = computeExplosionCells(r, c, val, null);
        extra.forEach((ek) => { if (!set.has(ek)) { set.add(ek); queue.push(ek); } });
      }
    }
    const cells = Array.from(set).filter((k) => {
      const [r, c] = k.split(',').map(Number);
      const v = board[r][c];
      return v !== null && v !== undefined && v !== 'ING';
    });
    if (cells.length === 0) return;

    cells.forEach((k) => { const [r, c] = k.split(',').map(Number); const el = tileEls[r][c]; if (el) el.classList.add('exploding'); });
    burstAtCells(cells, '#ffe86b');
    addScoreAndGoals(cells, cascadeLevel);
    registerCombo(cascadeLevel);
    Sound.explosion(); haptic('heavy');
    state.stats.bestCombo = Math.max(state.stats.bestCombo, cascadeLevel);

    await wait(300);
    damageObstaclesNear(new Set(cells));
    cells.forEach((k) => { const [r, c] = k.split(',').map(Number); removeTileAt(r, c); });

    await collapseAndRefill();
    await wait(FALL_ANIM_MS);
    await continueCascade(cascadeLevel + 1);
  }

  async function collectIngredients() {
    if (!currentLevel || currentLevel.mode !== 'ingredient') return;
    const goal = currentLevel.goals.find((g) => g.type === 'ingredient');
    if (!goal || goal.current >= goal.target) return;
    let found = false;
    for (let c = 0; c < SIZE; c++) {
      if (board[SIZE - 1][c] === 'ING') {
        const el = tileEls[SIZE - 1][c];
        if (el) el.classList.add('matched');
        found = true;
      }
    }
    if (!found) return;
    await wait(220);
    for (let c = 0; c < SIZE; c++) {
      if (board[SIZE - 1][c] === 'ING') {
        removeTileAt(SIZE - 1, c);
        goal.current++;
        Sound.pop(); haptic('success');
        showFloatingLabel('DELIVERED!');
      }
    }
    renderGoalPanel();
    await collapseAndRefill();
    await wait(FALL_ANIM_MS);
  }

  async function continueCascade(cascadeLevel) {
    await collectIngredients();
    const analysis = analyzeMatches(board);
    if (analysis.matchedCells.size === 0) return;
    await performMatchResolution(analysis.matchedCells, analysis.specials, cascadeLevel);
  }

  /* ---------- Гравитация с учётом препятствий ---------- */
  async function collapseAndRefill() {
    for (let c = 0; c < SIZE; c++) {
      let segStart = 0;
      for (let r = 0; r <= SIZE; r++) {
        const isChoco = r < SIZE && board[r][c] === 'S_CHOCO';
        if (isChoco || r === SIZE) {
          collapseSegment(c, segStart, r - 1);
          segStart = r + 1;
        }
      }
    }
  }

  function collapseSegment(c, top, bottom) {
    if (top > bottom) return;
    let writeRow = bottom;
    for (let r = bottom; r >= top; r--) {
      if (board[r][c] !== null && board[r][c] !== undefined) {
        if (writeRow !== r) {
          board[writeRow][c] = board[r][c];
          board[r][c] = null;
          const el = tileEls[r][c];
          tileEls[writeRow][c] = el;
          tileEls[r][c] = null;
          if (el) positionTile(el, writeRow, c);
          if (icedSet.has(key(r, c))) { icedSet.delete(key(r, c)); icedSet.add(key(writeRow, c)); if (el) el.classList.add('iced'); }
        }
        writeRow--;
      }
    }
    for (let r = writeRow; r >= top; r--) {
      const type = randType();
      board[r][c] = type;
      const el = createTileEl(r, c, type);
      positionTile(el, top - (writeRow - r) - 2, c);
      el.style.transition = 'none';
      boardEl.appendChild(el);
      tileEls[r][c] = el;
      void el.offsetWidth;
      el.style.transition = '';
      el.classList.add('spawning');
      positionTile(el, r, c);
      setTimeout(() => el.classList.remove('spawning'), FALL_ANIM_MS + 60);
    }
  }

  /* ---------- Проверка ходов / reshuffle ---------- */
  function hasAnyValidMoveBoard() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!isMovable({ row: r, col: c })) continue;
        if (c < SIZE - 1 && isMovable({ row: r, col: c + 1 })) {
          swapCellsInPlace(board, r, c, r, c + 1);
          const ok = analyzeMatches(board).matchedCells.size > 0;
          swapCellsInPlace(board, r, c, r, c + 1);
          if (ok) return true;
        }
        if (r < SIZE - 1 && isMovable({ row: r + 1, col: c })) {
          swapCellsInPlace(board, r, c, r + 1, c);
          const ok = analyzeMatches(board).matchedCells.size > 0;
          swapCellsInPlace(board, r, c, r + 1, c);
          if (ok) return true;
        }
      }
    }
    return false;
  }

  async function reshuffleBoard() {
    const positions = [], values = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (isMovable({ row: r, col: c })) { positions.push({ r, c }); values.push(board[r][c]); }
    }
    let attempts = 0;
    do {
      for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
      }
      positions.forEach((p, idx) => { board[p.r][p.c] = values[idx]; });
      attempts++;
    } while ((analyzeMatches(board).matchedCells.size > 0 || !hasAnyValidMoveBoard()) && attempts < 300);
    renderAll();
    await wait(60);
    showToast('Поле перемешано 🔀');
  }

  /* ---------- Бустеры ---------- */
  document.querySelectorAll('.booster-btn').forEach((btn) => btn.addEventListener('click', () => onBoosterBarClick(btn)));

  function renderBoosterCounts() {
    document.getElementById('countHammer').textContent = state.boosters.hammer || 0;
    document.getElementById('countShuffle').textContent = state.boosters.shuffle || 0;
    document.getElementById('countRocketBoost').textContent = state.boosters.rocketBoost || 0;
  }

  function onBoosterBarClick(btn) {
    if (busy || !currentLevel || paused) return;
    resetIdleTimer();
    const type = btn.dataset.booster;
    if ((state.boosters[type] || 0) <= 0) { showToast('Нет бустера в запасе'); Sound.error(); haptic('error'); return; }
    if (type === 'shuffle') { useShuffleBooster(); return; }
    if (armedBooster === type) { armedBooster = null; btn.classList.remove('active-select'); return; }
    document.querySelectorAll('.booster-btn').forEach((b) => b.classList.remove('active-select'));
    armedBooster = type;
    btn.classList.add('active-select');
    Sound.select(); haptic('light');
    showToast(type === 'hammer' ? 'Выберите фишку 🔨' : 'Выберите фишку для взрыва 🚀');
  }

  async function useShuffleBooster() {
    state.boosters.shuffle -= 1;
    state.stats.boostersUsed += 1;
    saveState();
    renderBoosterCounts();
    Sound.booster(); haptic('medium');
    busy = true;
    await reshuffleBoard();
    busy = false;
  }

  async function triggerArmedBoosterOnTile(r, c) {
    if (busy) return;
    const type = armedBooster;
    armedBooster = null;
    document.querySelectorAll('.booster-btn').forEach((b) => b.classList.remove('active-select'));
    if (board[r][c] === null || board[r][c] === undefined || board[r][c] === 'ING') return;
    state.boosters[type] -= 1;
    state.stats.boostersUsed += 1;
    saveState();
    renderBoosterCounts();
    busy = true;
    Sound.booster(); haptic('medium');
    const cellSet = new Set();
    if (type === 'hammer') {
      cellSet.add(key(r, c));
    } else if (type === 'rocketBoost') {
      for (let cc = 0; cc < SIZE; cc++) cellSet.add(key(r, cc));
      for (let rr = 0; rr < SIZE; rr++) cellSet.add(key(rr, c));
    }
    await performExplosion(cellSet, 1);
    busy = false;
    afterMoveChecks();
  }

  /* ---------- Летящие монеты ---------- */
  function flyCoins(amount) {
    if (amount <= 0) return;
    const layer = document.getElementById('flyCoinsLayer');
    const rect = boardEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'fly-coin';
    el.textContent = '+' + amount + ' 🪙';
    el.style.left = (rect.left + rect.width / 2 - 20) + 'px';
    el.style.top = (rect.top + rect.height / 2) + 'px';
    layer.appendChild(el);
    requestAnimationFrame(() => { el.style.top = (rect.top - 20) + 'px'; el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 700);
  }

  /* ---------- Комбо-тост ---------- */
  let comboTimer = null;
  function showCombo(level, count) {
    if (level < 2 && count < 4) return;
    let text = '';
    if (level >= 2) text += `Комбо x${level}! `;
    if (count >= 5) text += 'Awesome!'; else if (level >= 3) text += 'Unstoppable!';
    text = text.trim();
    if (!text) return;
    const toastEl = document.getElementById('comboToast');
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => toastEl.classList.add('hidden'), 250);
    }, 900);
  }

  /* ---------- HUD / цели (мультирежимные) ---------- */
  function renderGoalPanel() {
    const panel = document.getElementById('goalPanel');
    panel.innerHTML = '';
    currentLevel.goals.forEach((g) => {
      const chip = document.createElement('div');
      const done = g.type === 'score' ? currentLevel.score >= g.target : g.current >= g.target;
      chip.className = 'goal-chip' + (done ? ' complete' : '');
      let label = '';
      if (g.type === 'collect') label = `${FRUIT_EMOJI[g.fruit]} ${Math.min(g.current, g.target)}/${g.target}`;
      else if (g.type === 'score') label = `⭐ ${Math.min(currentLevel.score, g.target)}/${g.target}`;
      else if (g.type === 'ice') label = `🧊 ${Math.min(g.current, g.target)}/${g.target}`;
      else if (g.type === 'ingredient') label = `${currentLevel.ingredientEmoji} ${Math.min(g.current, g.target)}/${g.target}`;
      else if (g.type === 'combo') label = `🔥 ${Math.min(g.current, g.target)}/${g.target}`;
      chip.textContent = label;
      panel.appendChild(chip);
    });
  }

  function updateGameHUD() {
    scoreEl.textContent = currentLevel.score;
    const isTimeAttack = currentLevel.mode === 'timeattack';
    document.getElementById('movesPill').classList.toggle('hidden', isTimeAttack);
    document.getElementById('timePill').classList.toggle('hidden', !isTimeAttack);
    if (isTimeAttack) {
      timeEl.textContent = Math.max(0, currentLevel.timeLeft);
    } else {
      movesEl.textContent = currentLevel.movesLeft;
    }
  }

  function goalsComplete() {
    return currentLevel.goals.every((g) => g.type === 'score' ? currentLevel.score >= g.target : g.current >= g.target);
  }

  /* ---------- Таймер режима "На время" ---------- */
  function stopTimeAttackTimer() {
    if (timeAttackTimer) { clearInterval(timeAttackTimer); timeAttackTimer = null; }
  }
  function startTimeAttackTimer() {
    stopTimeAttackTimer();
    timeAttackTimer = setInterval(() => {
      if (!currentLevel || paused || busy) return;
      currentLevel.timeLeft--;
      updateGameHUD();
      if (currentLevel.timeLeft <= 0) {
        stopTimeAttackTimer();
        if (goalsComplete()) winLevel(); else loseLevel();
      }
    }, 1000);
  }

  /* ---------- Победа / поражение ---------- */
  function afterMoveChecks() {
    if (!currentLevel) return;
    if (goalsComplete()) { winLevel(); return; }
    if (currentLevel.mode !== 'timeattack' && currentLevel.movesLeft <= 0) { loseLevel(); return; }
    if (!hasAnyValidMoveBoard()) { reshuffleBoard(); }
  }

  function winLevel() {
    stopTimeAttackTimer();
    const par = currentLevel.par;
    let stars = 1;
    if (currentLevel.score >= par * 1.6) stars = 3; else if (currentLevel.score >= par * 1.15) stars = 2;
    const prevStars = state.levelStars[currentLevel.level] || 0;
    state.levelStars[currentLevel.level] = Math.max(prevStars, stars);
    state.unlockedLevel = Math.max(state.unlockedLevel, Math.min(LEVEL_COUNT, currentLevel.level + 1));
    state.stats.wins += 1;
    incrementQuest('levels', 1);
    let coinsAward = stars * 40 + Math.floor(currentLevel.score / 50);
    if (clientGameSettings.doubleRewards) coinsAward *= 2;
    addCoins(coinsAward);
    submitScoreToLeaderboard(currentLevel.score);
    saveState();
    Sound.win(); haptic('success');
    fireConfetti(stars); // праздничная анимация — больше конфетти за 3 звезды
    showResultModal(true, stars, coinsAward);
    syncProgressWithServer(); // подтягиваем свежие данные в админку сразу после победы
  }

  function loseLevel() {
    stopTimeAttackTimer();
    submitScoreToLeaderboard(currentLevel.score);
    saveState();
    Sound.lose(); haptic('error');
    showResultModal(false, 0, 0);
    syncProgressWithServer();
  }

  function showResultModal(win, stars, coins) {
    document.getElementById('resultTitle').textContent = win ? 'Уровень пройден!' : (currentLevel.mode === 'timeattack' ? 'Время вышло' : 'Не хватило ходов');
    document.getElementById('resultStars').textContent = win ? '⭐'.repeat(stars) + '☆'.repeat(3 - stars) : '💔';
    document.getElementById('resultScore').textContent = currentLevel.score;
    document.getElementById('resultCoins').textContent = win ? ('+' + coins + ' 🪙') : '+0 🪙';
    document.getElementById('btnNextLevel').style.display = win ? 'block' : 'none';
    document.getElementById('modalResult').classList.remove('hidden');
  }

  /* ---------- Запуск уровня ---------- */
  function startLevel(n) {
    stopTimeAttackTimer();
    if (state.lives <= 0 && !state.infiniteLives) { showToast('Нет жизней ❤️ Ждите восстановления или купите в магазине'); openModal('modalShop'); return; }
    if (!spendLife()) return;
    currentLevel = levelConfig(n);
    currentLevel.score = 0;
    currentLevel.movesLeft = (currentLevel.mode === 'timeattack') ? Infinity : currentLevel.moves;
    currentLevel.timeLeft = 60;
    if (state.boosters.moves && currentLevel.mode !== 'timeattack') {
      currentLevel.movesLeft += state.boosters.moves * 5;
      showToast('+' + (state.boosters.moves * 5) + ' бонусных ходов');
      state.boosters.moves = 0;
      saveState();
    }
    armedBooster = null;
    selected = null;
    busy = true; // блокируем ввод, пока показывается интро-карточка уровня
    paused = false;
    resetIdleTimer();
    showLevelIntro(currentLevel);
  }

  /**
   * Интро-карточка перед стартом уровня — как в больших match-3 играх: коротко показывает
   * номер уровня, режим и цели, прежде чем открыть поле. Тап по кнопке — сразу старт,
   * иначе автопродолжение через 2.6с, чтобы не задерживать опытных игроков.
   */
  let introAutoTimer = null;
  function showLevelIntro(cfg) {
    document.getElementById('introLevelBadge').textContent = cfg.level;
    document.getElementById('introLevelTitle').textContent = 'Уровень ' + cfg.level;
    document.getElementById('introModeLabel').textContent = `${MODE_NAME[cfg.mode]} · ${cfg.size}×${cfg.size}`;
    const row = document.getElementById('introGoalsRow');
    row.innerHTML = '';
    cfg.goals.forEach((g) => {
      let icon = '⭐';
      if (g.type === 'collect') icon = FRUIT_EMOJI[g.fruit];
      else if (g.type === 'ice') icon = '🧊';
      else if (g.type === 'ingredient') icon = cfg.ingredientEmoji;
      else if (g.type === 'combo') icon = '🔥';
      const chip = document.createElement('div');
      chip.className = 'intro-goal-chip';
      chip.textContent = `${icon} ${g.target}`;
      row.appendChild(chip);
    });
    document.getElementById('modalLevelIntro').classList.remove('hidden');
    Sound.select(); haptic('light');
    clearTimeout(introAutoTimer);
    introAutoTimer = setTimeout(proceedFromLevelIntro, 2600);
  }
  function proceedFromLevelIntro() {
    const modal = document.getElementById('modalLevelIntro');
    if (modal.classList.contains('hidden')) return; // уже обработано
    clearTimeout(introAutoTimer);
    modal.classList.add('hidden');
    beginLevelPlay();
  }
  document.getElementById('btnStartLevelIntro').addEventListener('click', proceedFromLevelIntro);

  function beginLevelPlay() {
    busy = false;
    showScreen('screenGame');
    buildBoardForLevel(currentLevel);
    renderGoalPanel();
    updateGameHUD();
    renderBoosterCounts();
    if (currentLevel.mode === 'timeattack') startTimeAttackTimer();
  }

  /* ---------- Пауза / результат / шэринг ---------- */
  document.getElementById('btnPause').addEventListener('click', () => {
    if (!currentLevel) return;
    paused = true;
    document.getElementById('modalPause').classList.remove('hidden');
  });
  document.getElementById('btnResume').addEventListener('click', () => {
    paused = false;
    resetIdleTimer();
    document.getElementById('modalPause').classList.add('hidden');
  });
  document.getElementById('btnPauseRestart').addEventListener('click', () => {
    document.getElementById('modalPause').classList.add('hidden');
    if (currentLevel) startLevel(currentLevel.level);
  });
  document.getElementById('btnPauseExit').addEventListener('click', () => {
    document.getElementById('modalPause').classList.add('hidden');
    stopTimeAttackTimer();
    currentLevel = null;
    paused = false;
    showScreen('screenMenu');
  });

  document.getElementById('btnNextLevel').addEventListener('click', () => {
    document.getElementById('modalResult').classList.add('hidden');
    const next = currentLevel.level + 1;
    if (next <= LEVEL_COUNT) startLevel(next); else showScreen('screenLevels');
  });
  document.getElementById('btnRetryLevel').addEventListener('click', () => {
    document.getElementById('modalResult').classList.add('hidden');
    startLevel(currentLevel.level);
  });
  document.getElementById('btnShareResult').addEventListener('click', shareResult);

  function shareResult() {
    const text = `Я набрал ${currentLevel.score} очков в Fruit Blitz на уровне ${currentLevel.level}! 🍎🍇🍓`;
    if (tg && tg.openTelegramLink) {
      try {
        tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent('https://t.me/') + '&text=' + encodeURIComponent(text));
        return;
      } catch (e) { /* fallthrough */ }
    }
    if (navigator.share) { navigator.share({ title: 'Fruit Blitz', text }).catch(() => {}); return; }
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(() => showToast('Результат скопирован!')); return; }
    showToast(text);
  }

  /* ============================================================
     15. СТАРТ ПРИЛОЖЕНИЯ
     ============================================================ */
  async function boot() {
    const statusEl = document.getElementById('splashStatus');
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

    initTelegram();
    applyEquippedSkin();
    renderPlayerBadge();
    renderResources();
    renderBoosterCounts();

    setStatus('Проверка доступа...');
    await checkAdminAccess();

    setStatus('Проверка режима игры...');
    const blocked = await checkMaintenanceAndSettings();

    setStatus('Синхронизация прогресса...');
    await syncProgressWithServer(); // пушим прогресс на сервер + проверяем бан

    setStatus('Готово!');
    const spinner = document.querySelector('.splash-spinner');
    if (spinner) spinner.classList.add('hidden');
    const contBtn = document.getElementById('btnSplashContinue');
    contBtn.classList.remove('hidden');
    contBtn.addEventListener('click', () => {
      ensureAudio(); Sound.click(); haptic('light');
      document.getElementById('splashScreen').classList.add('hidden');
      if (!blocked) showScreen('screenMenu');
    }, { once: true });
  }
  boot();

})();
