/* ==========================================================
   FRUIT BLAST — Match-3 Telegram Mini App
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
      if (typeof tg.enableClosingConfirmation === 'function') tg.enableClosingConfirmation();
      if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
      applyTelegramTheme();
      tg.onEvent('themeChanged', applyTelegramTheme);
    } catch (e) { console.warn('tg init error', e); }
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
    try {
      if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) return tg.initDataUnsafe.user;
    } catch (e) { /* noop */ }
    return null;
  }
  const telegramUser = getTelegramUser();
  const playerId = (telegramUser && telegramUser.id) ? telegramUser.id : 'guest';

  function renderPlayerBadge() {
    const nameEl = document.getElementById('playerName');
    const avatarEl = document.getElementById('playerAvatar');
    if (!nameEl || !avatarEl) return;
    if (telegramUser) {
      const full = (telegramUser.first_name || '') + (telegramUser.last_name ? ' ' + telegramUser.last_name : '');
      const displayName = full.trim() || ('@' + (telegramUser.username || 'player'));
      nameEl.textContent = displayName;
      if (telegramUser.photo_url) {
        avatarEl.innerHTML = '';
        const img = document.createElement('img');
        img.src = telegramUser.photo_url;
        img.alt = 'avatar';
        avatarEl.appendChild(img);
      } else {
        avatarEl.textContent = displayName.charAt(0).toUpperCase();
      }
    } else {
      nameEl.textContent = 'Гость';
      avatarEl.textContent = '🙂';
    }
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
      for (let i = 0; i < Math.min(n, 6); i++) {
        tone(base * Math.pow(1.12, i), 0.14, 'triangle', 0.18, i * 0.03, base * Math.pow(1.12, i) * 1.5);
      }
    },
    combo(level) {
      const base = 420 * Math.pow(1.18, Math.min(level, 8));
      tone(base, 0.16, 'sawtooth', 0.16, 0, base * 1.8);
      tone(base * 1.5, 0.16, 'sawtooth', 0.1, 0.05, base * 2.2);
    },
    explosion() {
      noiseBurst(0.35, 0.35, 0, 900);
      tone(90, 0.32, 'sine', 0.4, 0, 40);
    },
    booster() { tone(300, 0.22, 'square', 0.18, 0, 900); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.22, i * 0.12)); },
    lose() { [400, 340, 260].forEach((f, i) => tone(f, 0.32, 'sawtooth', 0.18, i * 0.14)); },
    error() { tone(180, 0.18, 'square', 0.15); }
  };

  /* ============================================================
     2. СОСТОЯНИЕ / СОХРАНЕНИЕ (привязано к ID игрока)
     ============================================================ */
  const SAVE_KEY = `match3_player_${playerId}`;
  const MAX_LIVES = 5;
  const LIFE_REGEN_MS = 15 * 60 * 1000;

  function defaultState() {
    return {
      coins: 300,
      gems: 25,
      lives: MAX_LIVES,
      nextLifeAt: null,
      sound: true,
      unlockedLevel: 1,
      levelStars: {},
      boosters: { hammer: 3, shuffle: 2, rocketBoost: 2 },
      lastWheelSpin: null,
      wheelStreak: 0,
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
        levelStars: parsed.levelStars || {}
      });
    } catch (e) { return defaultState(); }
  }

  function saveState() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* noop */ }
  }

  /* ============================================================
     3. НАВИГАЦИЯ: ЭКРАНЫ + МОДАЛКИ + TOAST
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
    renderResources();
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.back));
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
     4. РЕСУРСЫ: РЕНДЕР, ЖИЗНИ, ЗВУК-ТОГГЛ
     ============================================================ */
  function renderResources() {
    document.getElementById('coinsValue').textContent = state.coins;
    document.getElementById('gemsValue').textContent = state.gems;
    document.getElementById('livesValue').textContent = state.lives;
    const timerEl = document.getElementById('livesTimer');
    if (state.lives < MAX_LIVES && state.nextLifeAt) {
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
     5. УРОВНИ: ДИНАМИЧЕСКИЙ РАЗМЕР ПОЛЯ И СЛОЖНОСТЬ
     ============================================================ */
  const FRUIT_EMOJI = ['🍎', '🍌', '🍓', '🍇', '🍊', '🫐'];
  const LEVEL_COUNT = 24;

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

    const moves = 14 + Math.floor(n / 2) * 2;
    const cellsTotal = size * size;
    const goalsCount = n < 3 ? 1 : (n < 8 ? 2 : 3);
    const goals = [];
    const used = [];
    for (let i = 0; i < goalsCount; i++) {
      let f;
      do { f = Math.floor(Math.random() * fruitCount); } while (used.includes(f));
      used.push(f);
      const target = Math.max(6, Math.round(cellsTotal * 0.35) + n * 2 + i * 3);
      goals.push({ fruit: f, target, current: 0 });
    }
    const iceCount = n >= 3 ? Math.min(Math.floor(cellsTotal * 0.12), 2 + n) : 0;
    const chocoCount = n >= 4 ? Math.min(Math.floor(cellsTotal * 0.1), 1 + Math.floor(n / 2)) : 0;
    const par = moves * 45;
    return { level: n, size, fruitCount, moves, goals, iceCount, chocoCount, par };
  }

  function renderLevelsGrid() {
    const grid = document.getElementById('levelsGrid');
    grid.innerHTML = '';
    for (let n = 1; n <= LEVEL_COUNT; n++) {
      const locked = n > state.unlockedLevel;
      const cfg = levelConfig(n);
      const btn = document.createElement('button');
      btn.className = 'level-node' + (locked ? ' locked' : '') + (n === state.unlockedLevel ? ' current' : '');
      const stars = state.levelStars[n] || 0;
      btn.innerHTML = `<div>${locked ? '🔒' : n}</div><div class="stars">${locked ? '' : '⭐'.repeat(stars) + '☆'.repeat(3 - stars)}</div><div class="size-tag">${cfg.size}×${cfg.size}</div>`;
      if (!locked) {
        btn.addEventListener('click', () => { haptic('light'); startLevel(n); });
      }
      grid.appendChild(btn);
    }
  }

  /* ============================================================
     6. ДОСТИЖЕНИЯ
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
    { id: 'stars3x5', icon: '🌟', title: 'Перфекционист', desc: 'Получите 3 звезды на 5 уровнях', check: (s) => Object.values(s.levelStars).filter((v) => v >= 3).length >= 5 }
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
     7. ТАБЛИЦА ЛИДЕРОВ (локальная)
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
     8. МАГАЗИН
     ============================================================ */
  document.querySelectorAll('[data-shop-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.dataset.shopBuy;
      const cost = parseInt(btn.dataset.cost, 10);
      const currency = btn.dataset.currency;
      const balance = currency === 'gems' ? state.gems : state.coins;
      if (balance < cost) { showToast('Недостаточно ' + (currency === 'gems' ? 'кристаллов 💎' : 'монет 🪙')); Sound.error(); haptic('error'); return; }
      if (currency === 'gems') state.gems -= cost; else state.coins -= cost;

      if (item === 'hammer') state.boosters.hammer += 1;
      else if (item === 'shuffle') state.boosters.shuffle += 1;
      else if (item === 'moves') state.boosters.moves = (state.boosters.moves || 0) + 1;
      else if (item === 'lives') state.lives = MAX_LIVES;
      else if (item === 'gems50') state.gems += 50;

      saveState();
      renderResources();
      Sound.click();
      haptic('light');
      showToast('Покупка совершена!');
    });
  });

  /* ============================================================
     9. КОЛЕСО ФОРТУНЫ
     ============================================================ */
  const WHEEL_REWARDS = [
    { label: '+50🪙', apply: () => addCoins(50) },
    { label: '+5💎', apply: () => addGems(5) },
    { label: '+100🪙', apply: () => addCoins(100) },
    { label: '🔨x1', apply: () => { state.boosters.hammer += 1; saveState(); } },
    { label: '+10💎', apply: () => addGems(10) },
    { label: '+200🪙', apply: () => addCoins(200) },
    { label: '🔀x1', apply: () => { state.boosters.shuffle += 1; saveState(); } },
    { label: '❤️Полные', apply: () => { state.lives = MAX_LIVES; saveState(); } }
  ];

  function todayStr() { return new Date().toISOString().slice(0, 10); }

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
    Sound.booster();
    haptic('medium');
    setTimeout(() => {
      WHEEL_REWARDS[idx].apply();
      state.lastWheelSpin = todayStr();
      state.wheelStreak = (state.wheelStreak || 0) + 1;
      saveState();
      renderResources();
      Sound.win();
      haptic('success');
      showToast('Награда: ' + WHEEL_REWARDS[idx].label);
      refreshWheelState();
    }, 3300);
  });

  /* ============================================================
     10. ПРИВЯЗКА КНОПОК ГЛАВНОГО МЕНЮ
     ============================================================ */
  document.getElementById('btnPlay').addEventListener('click', () => { haptic('light'); showScreen('screenLevels'); });
  document.getElementById('btnShop').addEventListener('click', () => { haptic('light'); openModal('modalShop'); });
  document.getElementById('btnWheel').addEventListener('click', () => { haptic('light'); openModal('modalWheel'); });
  document.getElementById('btnLeaderboard').addEventListener('click', () => { haptic('light'); openModal('modalLeaderboard'); });
  document.getElementById('btnAchievements').addEventListener('click', () => { haptic('light'); openModal('modalAchievements'); });

  /* ============================================================
     11. ИГРОВОЙ ДВИЖОК MATCH-3 (динамический размер поля)
     ============================================================ */
  let SIZE = 8;
  const SWAP_ANIM_MS = 220;
  const MATCH_ANIM_MS = 260;
  const FALL_ANIM_MS = 280;
  const DRAG_THRESHOLD = 18;

  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('scoreValue');
  const movesEl = document.getElementById('movesValue');

  let board = [];
  let tileEls = [];
  let cellBgEls = [];
  let icedSet = new Set();
  let currentLevel = null;
  let busy = false;
  let selected = null;
  let armedBooster = null;
  let cellSize = 0;

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
    if (v === 'S_CHOCO') return false;
    if (icedSet.has(key(pos.row, pos.col))) return false;
    return true;
  }
  function swapCellsInPlace(b, r1, c1, r2, c2) { const t = b[r1][c1]; b[r1][c1] = b[r2][c2]; b[r2][c2] = t; }

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
    renderAll();
    if (!hasAnyValidMoveBoard()) { reshuffleBoard(); }
  }

  /* ---------- Рендер ---------- */
  function renderAll() {
    boardEl.innerHTML = '';
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
  }

  function positionTile(el, r, c) {
    const gapPx = 4;
    const step = cellSize + gapPx;
    el.style.width = cellSize + 'px'; el.style.height = cellSize + 'px';
    el.style.left = (c * step) + 'px'; el.style.top = (r * step) + 'px';
    el.dataset.row = r; el.dataset.col = c;
  }

  window.addEventListener('resize', () => { if (currentLevel) layoutBoard(false); });

  /* ---------- Ввод ---------- */
  function attachTileEvents(el) {
    let startX = 0, startY = 0, dragging = false, moved = false;

    el.addEventListener('pointerdown', (e) => {
      if (busy) return;
      const r = parseInt(el.dataset.row, 10), c = parseInt(el.dataset.col, 10);
      if (armedBooster) { triggerArmedBoosterOnTile(r, c); return; }
      if (board[r][c] === 'S_CHOCO') return;
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
    if (board[r][c] === 'S_CHOCO') return;
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
    if (busy || !currentLevel) return;
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

  /* ---------- Очистка / очки / цели ---------- */
  function addScoreAndGoals(cellKeys, cascadeLevel) {
    let scoreGain = 0;
    cellKeys.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      const val = board[r][c];
      if (typeof val === 'number') {
        scoreGain += 10;
        state.stats.totalCleared++;
        currentLevel.goals.forEach((g) => { if (g.fruit === val && g.current < g.target) g.current++; });
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
        if (icedSet.has(kk)) { icedSet.delete(kk); const el = tileEls[rr][cc]; if (el) el.classList.remove('iced'); }
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
    addScoreAndGoals(toClear, cascadeLevel);
    showCombo(cascadeLevel, totalCount);
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
        const extra = computeExplosionCells(r, c, val, null);
        extra.forEach((ek) => { if (!set.has(ek)) { set.add(ek); queue.push(ek); } });
      }
    }
    const cells = Array.from(set).filter((k) => {
      const [r, c] = k.split(',').map(Number);
      return board[r][c] !== null && board[r][c] !== undefined;
    });
    if (cells.length === 0) return;

    cells.forEach((k) => { const [r, c] = k.split(',').map(Number); const el = tileEls[r][c]; if (el) el.classList.add('exploding'); });
    addScoreAndGoals(cells, cascadeLevel);
    Sound.explosion();
    haptic('heavy');
    state.stats.bestCombo = Math.max(state.stats.bestCombo, cascadeLevel);

    await wait(300);
    damageObstaclesNear(new Set(cells));
    cells.forEach((k) => { const [r, c] = k.split(',').map(Number); removeTileAt(r, c); });

    await collapseAndRefill();
    await wait(FALL_ANIM_MS);
    await continueCascade(cascadeLevel + 1);
  }

  async function continueCascade(cascadeLevel) {
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
    if (busy || !currentLevel) return;
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
    if (board[r][c] === null || board[r][c] === undefined) return;
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

  /* ---------- HUD / цели ---------- */
  function renderGoalPanel() {
    const panel = document.getElementById('goalPanel');
    panel.innerHTML = '';
    currentLevel.goals.forEach((g) => {
      const chip = document.createElement('div');
      chip.className = 'goal-chip' + (g.current >= g.target ? ' complete' : '');
      chip.textContent = `${FRUIT_EMOJI[g.fruit]} ${Math.min(g.current, g.target)}/${g.target}`;
      panel.appendChild(chip);
    });
  }
  function updateGameHUD() {
    scoreEl.textContent = currentLevel.score;
    movesEl.textContent = currentLevel.movesLeft;
  }

  /* ---------- Победа / поражение ---------- */
  function afterMoveChecks() {
    if (!currentLevel) return;
    const allDone = currentLevel.goals.every((g) => g.current >= g.target);
    if (allDone) { winLevel(); return; }
    if (currentLevel.movesLeft <= 0) { loseLevel(); return; }
    if (!hasAnyValidMoveBoard()) { reshuffleBoard(); }
  }

  function winLevel() {
    const par = currentLevel.par;
    let stars = 1;
    if (currentLevel.score >= par * 1.6) stars = 3; else if (currentLevel.score >= par * 1.15) stars = 2;
    const prevStars = state.levelStars[currentLevel.level] || 0;
    state.levelStars[currentLevel.level] = Math.max(prevStars, stars);
    state.unlockedLevel = Math.max(state.unlockedLevel, Math.min(LEVEL_COUNT, currentLevel.level + 1));
    state.stats.wins += 1;
    const coinsAward = stars * 40 + Math.floor(currentLevel.score / 50);
    addCoins(coinsAward);
    submitScoreToLeaderboard(currentLevel.score);
    saveState();
    Sound.win(); haptic('success');
    showResultModal(true, stars, coinsAward);
  }

  function loseLevel() {
    submitScoreToLeaderboard(currentLevel.score);
    saveState();
    Sound.lose(); haptic('error');
    showResultModal(false, 0, 0);
  }

  function showResultModal(win, stars, coins) {
    document.getElementById('resultTitle').textContent = win ? 'Уровень пройден!' : 'Не хватило ходов';
    document.getElementById('resultStars').textContent = win ? '⭐'.repeat(stars) + '☆'.repeat(3 - stars) : '💔';
    document.getElementById('resultScore').textContent = currentLevel.score;
    document.getElementById('resultCoins').textContent = win ? ('+' + coins + ' 🪙') : '+0 🪙';
    document.getElementById('btnNextLevel').style.display = win ? 'block' : 'none';
    document.getElementById('modalResult').classList.remove('hidden');
  }

  /* ---------- Запуск уровня ---------- */
  function startLevel(n) {
    if (state.lives <= 0) { showToast('Нет жизней ❤️ Ждите восстановления или купите в магазине'); openModal('modalShop'); return; }
    if (!spendLife()) return;
    currentLevel = levelConfig(n);
    currentLevel.score = 0;
    currentLevel.movesLeft = currentLevel.moves;
    if (state.boosters.moves) {
      currentLevel.movesLeft += state.boosters.moves * 5;
      showToast('+' + (state.boosters.moves * 5) + ' бонусных ходов');
      state.boosters.moves = 0;
      saveState();
    }
    armedBooster = null;
    selected = null;
    busy = false;
    showScreen('screenGame');
    buildBoardForLevel(currentLevel);
    renderGoalPanel();
    updateGameHUD();
    renderBoosterCounts();
  }

  /* ---------- Пауза / результат / шэринг ---------- */
  document.getElementById('btnPause').addEventListener('click', () => {
    if (!currentLevel) return;
    document.getElementById('modalPause').classList.remove('hidden');
  });
  document.getElementById('btnResume').addEventListener('click', () => document.getElementById('modalPause').classList.add('hidden'));
  document.getElementById('btnPauseRestart').addEventListener('click', () => {
    document.getElementById('modalPause').classList.add('hidden');
    if (currentLevel) startLevel(currentLevel.level);
  });
  document.getElementById('btnPauseExit').addEventListener('click', () => {
    document.getElementById('modalPause').classList.add('hidden');
    currentLevel = null;
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
    const text = `Я набрал ${currentLevel.score} очков в Fruit Blast на уровне ${currentLevel.level}! 🍎🍇🍓`;
    if (tg && tg.openTelegramLink) {
      try {
        tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent('https://t.me/') + '&text=' + encodeURIComponent(text));
        return;
      } catch (e) { /* fallthrough */ }
    }
    if (navigator.share) { navigator.share({ title: 'Fruit Blast', text }).catch(() => {}); return; }
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(() => showToast('Результат скопирован!')); return; }
    showToast(text);
  }

  /* ============================================================
     12. СТАРТ ПРИЛОЖЕНИЯ
     ============================================================ */
  initTelegram();
  renderPlayerBadge();
  showScreen('screenMenu');
  renderResources();
  renderBoosterCounts();

})();
