/* ==========================================================
   FRUIT BLITZ — Backend сервер + Telegram-бот + Админ-панель
   Express (статика + API) + node-telegram-bot-api (polling)
   ========================================================== */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

/* ============================================================
   0. КОНФИГ
   ============================================================ */
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://telegram-match3-production.up.railway.app';
const BOT_USERNAME = process.env.BOT_USERNAME || 'game_crashfr_bot';
const REF_BONUS_COINS = 100;

// Несколько ID через запятую: "123456789,987654321"
const ADMIN_IDS = String(process.env.ADMIN_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAdminId(id) {
  return ADMIN_IDS.includes(String(id));
}

/* ============================================================
   1. ХРАНИЛИЩЕ ИГРОКОВ + ГЛОБАЛЬНЫХ НАСТРОЕК (JSON-файлы)
   ============================================================ */
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'players.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, fallback) {
  ensureDataDir();
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error(`Ошибка чтения ${file}:`, e.message);
    return fallback;
  }
}

function writeJSONSync(file, data) {
  ensureDataDir();
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch (e) { console.error(`Ошибка записи ${file}:`, e.message); }
}

/** players[telegram_id] = {
 *   id, name, username,
 *   bestLevel, bestScore, coins, gems,
 *   refBy, refCount,
 *   banned, bannedAt,
 *   createdAt, updatedAt
 * }
 */
const players = loadJSON(DB_FILE, {});
const settings = Object.assign({ maintenanceMode: false, doubleRewards: false }, loadJSON(SETTINGS_FILE, {}));

let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJSONSync(DB_FILE, players), 150);
}
function saveSettings() { writeJSONSync(SETTINGS_FILE, settings); }

function getOrCreatePlayer(id, extra) {
  const key = String(id);
  if (!players[key]) {
    players[key] = {
      id: key,
      name: (extra && extra.name) || 'Игрок',
      username: (extra && extra.username) || null,
      bestLevel: 0,
      bestScore: 0,
      coins: 0,
      gems: 0,
      refBy: null,
      refCount: 0,
      banned: false,
      bannedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  } else if (extra) {
    if (extra.name) players[key].name = extra.name;
    if (extra.username) players[key].username = extra.username;
  }
  return players[key];
}

/* ============================================================
   2. РЕФЕРАЛЬНЫЙ БОНУС
   ============================================================ */
function creditReferral(newUserId, referrerId, extraNew) {
  const newKey = String(newUserId);
  const refKey = String(referrerId);
  if (!refKey || newKey === refKey) return { credited: false, reason: 'self-ref' };

  const newPlayer = getOrCreatePlayer(newKey, extraNew);
  if (newPlayer.refBy) return { credited: false, reason: 'already-credited' };

  const referrer = getOrCreatePlayer(refKey);
  newPlayer.refBy = refKey;
  referrer.refCount = (referrer.refCount || 0) + 1;
  referrer.coins = (referrer.coins || 0) + REF_BONUS_COINS;
  referrer.updatedAt = Date.now();
  newPlayer.updatedAt = Date.now();
  saveDB();

  return { credited: true, bonus: REF_BONUS_COINS, referrer };
}

function getTopPlayers(limit) {
  return Object.values(players)
    .filter((p) => (p.bestScore || 0) > 0)
    .sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0))
    .slice(0, limit || 10)
    .map((p) => ({ id: p.id, name: p.name, username: p.username, bestScore: p.bestScore, bestLevel: p.bestLevel }));
}

/* ============================================================
   3. ПРОВЕРКА TELEGRAM initData (HMAC, по официальному алгоритму)
   ============================================================ */
function verifyTelegramInitData(initData) {
  if (!initData || !BOT_TOKEN) return { valid: false };
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false };
    params.delete('hash');
    const pairs = [];
    params.forEach((value, key) => pairs.push(`${key}=${value}`));
    pairs.sort();
    const dataCheckString = pairs.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computedHash !== hash) return { valid: false };
    const userRaw = params.get('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    return { valid: true, user };
  } catch (e) {
    return { valid: false };
  }
}

/* ============================================================
   4. MIDDLEWARE: ДОСТУП ТОЛЬКО ДЛЯ АДМИНА
   ============================================================ */
function requireAdmin(req, res, next) {
  const initData = req.body?.init_data || req.query?.init_data;
  const rawTelegramId = req.body?.telegram_id || req.query?.telegram_id;

  let verifiedId = null;
  if (initData) {
    const result = verifyTelegramInitData(initData);
    if (result.valid && result.user && result.user.id) verifiedId = result.user.id;
  }
  if (!verifiedId && rawTelegramId) verifiedId = rawTelegramId;

  if (!verifiedId || !isAdminId(verifiedId)) {
    return res.status(403).json({ success: false, error: 'Доступ запрещён: требуются права администратора' });
  }
  req.adminId = String(verifiedId);
  next();
}

/* ============================================================
   5. АНАЛИТИКА
   ============================================================ */
function computeStats() {
  const all = Object.values(players);
  const totalUsers = all.length;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const dau = all.filter((p) => (p.updatedAt || 0) >= todayStart.getTime()).length;
  const totalCoins = all.reduce((sum, p) => sum + (p.coins || 0), 0);
  const totalGems = all.reduce((sum, p) => sum + (p.gems || 0), 0);
  const avgLevel = totalUsers ? (all.reduce((sum, p) => sum + (p.bestLevel || 0), 0) / totalUsers) : 0;
  const topRich = all.slice().sort((a, b) => (b.coins || 0) - (a.coins || 0)).slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, username: p.username, coins: p.coins, gems: p.gems }));
  const topLevel = all.slice().sort((a, b) => (b.bestLevel || 0) - (a.bestLevel || 0)).slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, username: p.username, bestLevel: p.bestLevel, bestScore: p.bestScore }));
  return {
    totalUsers, dau, totalCoins, totalGems,
    avgLevel: Math.round(avgLevel * 10) / 10,
    topRich, topLevel
  };
}

/* ============================================================
   6. РАССЫЛКА (Broadcast) — состояние прогресса для polling
   ============================================================ */
const broadcastState = { running: false, total: 0, sent: 0, failed: 0, startedAt: null, finishedAt: null };

async function broadcastToAll(text, options) {
  const ids = Object.keys(players);
  broadcastState.running = true;
  broadcastState.total = ids.length;
  broadcastState.sent = 0;
  broadcastState.failed = 0;
  broadcastState.startedAt = Date.now();
  broadcastState.finishedAt = null;

  const replyMarkup = options && options.buttonUrl ? {
    inline_keyboard: [[{ text: options.buttonText || '🎮 Играть', url: options.buttonUrl }]]
  } : undefined;

  for (const id of ids) {
    try {
      await bot.sendMessage(id, text, {
        parse_mode: (options && options.parseMode) || 'HTML',
        reply_markup: replyMarkup
      });
      broadcastState.sent++;
    } catch (e) {
      broadcastState.failed++;
    }
    // небольшая задержка, чтобы не упереться в лимиты Telegram (~30 сообщ/сек)
    await new Promise((r) => setTimeout(r, 40));
  }

  broadcastState.running = false;
  broadcastState.finishedAt = Date.now();
}

/* ============================================================
   7. TELEGRAM-БОТ
   ============================================================ */
let bot = null;
const adminSessions = {}; // chatId -> 'awaiting_broadcast'

function adminStatsText() {
  const s = computeStats();
  let text = `📊 <b>Статистика Fruit Blitz</b>\n\n`;
  text += `👥 Всего игроков: <b>${s.totalUsers}</b>\n`;
  text += `🟢 Активны сегодня (DAU): <b>${s.dau}</b>\n`;
  text += `🪙 Всего монет в игре: <b>${s.totalCoins}</b>\n`;
  text += `💎 Всего кристаллов: <b>${s.totalGems}</b>\n`;
  text += `📈 Средний уровень: <b>${s.avgLevel}</b>\n\n`;
  text += `🏆 <b>Топ-5 богатейших:</b>\n`;
  s.topRich.forEach((p, i) => { text += `${i + 1}. ${p.name}${p.username ? ' (@' + p.username + ')' : ''} — ${p.coins}🪙 / ${p.gems}💎\n`; });
  text += `\n🚀 <b>Топ-5 по уровню:</b>\n`;
  s.topLevel.forEach((p, i) => { text += `${i + 1}. ${p.name}${p.username ? ' (@' + p.username + ')' : ''} — ур. ${p.bestLevel}\n`; });
  return text;
}

function adminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔄 Обновить статистику', callback_data: 'admin_refresh' }],
      [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
      [{ text: `🛠 Тех.работы: ${settings.maintenanceMode ? 'ВКЛ ✅' : 'выкл'}`, callback_data: 'admin_toggle_maintenance' }],
      [{ text: `🎉 x2 награды: ${settings.doubleRewards ? 'ВКЛ ✅' : 'выкл'}`, callback_data: 'admin_toggle_double' }]
    ]
  };
}

if (!BOT_TOKEN) {
  console.warn('⚠️  BOT_TOKEN не задан в переменных окружения — бот не запущен. Веб-сервер продолжит работу.');
} else {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Telegram-бот запущен (polling)');
  if (!ADMIN_IDS.length) console.warn('⚠️  ADMIN_ID не задан — админ-функции недоступны никому.');

  bot.on('polling_error', (err) => console.error('Polling error:', err.message));

  /* ---------- /start (в т.ч. /start ref_12345) ---------- */
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const fromId = msg.from.id;
    const firstName = msg.from.first_name || 'друг';
    const username = msg.from.username || null;
    const payload = match && match[1] ? match[1].trim() : null;

    const player = getOrCreatePlayer(fromId, { name: firstName, username });
    if (player.banned) {
      await bot.sendMessage(chatId, '⛔ Ваш доступ к игре заблокирован администратором.');
      return;
    }

    if (payload && payload.startsWith('ref_')) {
      const referrerId = payload.slice(4);
      const result = creditReferral(fromId, referrerId, { name: firstName, username });
      if (result.credited) {
        try {
          await bot.sendMessage(referrerId, `🎉 Ваш друг ${firstName} присоединился к Fruit Blitz по вашей ссылке!\nВам начислено +${result.bonus} 🪙`);
        } catch (e) { /* noop */ }
      }
    }

    const welcomeText =
      `Привет, ${firstName}! 🍓 Добро пожаловать в Fruit Blitz!\n\n` +
      `Собирай сочные фрукты в ряд, проходи уровни, соревнуйся с друзьями и зарабатывай монеты! 🔥`;

    const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${fromId}`;
    const shareText = `Играю в Fruit Blitz — залипательные три-в-ряд! Присоединяйся 🍇🍎🍓`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(shareText)}`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🎮 Играть в Fruit Blitz', web_app: { url: WEBAPP_URL } }],
        [{ text: '👥 Пригласить друга', url: shareUrl }],
        [{ text: '🏆 Таблица лидеров', callback_data: 'leaderboard' }]
      ]
    };

    try { await bot.sendMessage(chatId, welcomeText, { reply_markup: keyboard }); }
    catch (e) { console.error('Ошибка отправки приветствия:', e.message); }
  });

  /* ---------- /admin ---------- */
  bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdminId(msg.from.id)) {
      await bot.sendMessage(chatId, '⛔ Доступ запрещён.');
      return;
    }
    try { await bot.sendMessage(chatId, adminStatsText(), { parse_mode: 'HTML', reply_markup: adminKeyboard() }); }
    catch (e) { console.error('Admin panel error:', e.message); }
  });

  /* ---------- Текстовые сообщения (для сценария рассылки) ---------- */
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.text || msg.text.startsWith('/')) return;
    if (adminSessions[chatId] === 'awaiting_broadcast' && isAdminId(msg.from.id)) {
      delete adminSessions[chatId];
      const text = msg.text;
      await bot.sendMessage(chatId, `📢 Рассылка запущена на ${Object.keys(players).length} игроков...`);
      broadcastToAll(text, { buttonUrl: `https://t.me/${BOT_USERNAME}/Play`, buttonText: '🎮 Играть' })
        .then(() => bot.sendMessage(chatId, `✅ Рассылка завершена.\nУспешно: ${broadcastState.sent}\nОшибок: ${broadcastState.failed}`))
        .catch(() => {});
    }
  });

  /* ---------- Инлайн-кнопки ---------- */
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const isAdmin = isAdminId(query.from.id);

    if (query.data === 'leaderboard') {
      const top = getTopPlayers(10);
      let text = '🏆 Топ-10 игроков Fruit Blitz\n\n';
      if (top.length === 0) {
        text += 'Пока никто не набрал очков. Будь первым!';
      } else {
        const medals = ['🥇', '🥈', '🥉'];
        top.forEach((p, i) => {
          const medal = medals[i] || `${i + 1}.`;
          const name = p.username ? `${p.name} (@${p.username})` : p.name;
          text += `${medal} ${name} — ${p.bestScore} очков (ур. ${p.bestLevel})\n`;
        });
      }
      try { await bot.sendMessage(chatId, text); } catch (e) { /* noop */ }
    }

    if (query.data.startsWith('admin_')) {
      if (!isAdmin) { await bot.answerCallbackQuery(query.id, { text: 'Доступ запрещён', show_alert: true }); return; }

      if (query.data === 'admin_refresh') {
        try { await bot.editMessageText(adminStatsText(), { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: adminKeyboard() }); } catch (e) { /* noop */ }
      } else if (query.data === 'admin_broadcast') {
        adminSessions[chatId] = 'awaiting_broadcast';
        try { await bot.sendMessage(chatId, '✏️ Отправьте текст рассылки следующим сообщением (поддерживается HTML-разметка).'); } catch (e) { /* noop */ }
      } else if (query.data === 'admin_toggle_maintenance') {
        settings.maintenanceMode = !settings.maintenanceMode;
        saveSettings();
        try { await bot.editMessageReplyMarkup(adminKeyboard(), { chat_id: chatId, message_id: query.message.message_id }); } catch (e) { /* noop */ }
      } else if (query.data === 'admin_toggle_double') {
        settings.doubleRewards = !settings.doubleRewards;
        saveSettings();
        try { await bot.editMessageReplyMarkup(adminKeyboard(), { chat_id: chatId, message_id: query.message.message_id }); } catch (e) { /* noop */ }
      }
    }

    try { await bot.answerCallbackQuery(query.id); } catch (e) { /* noop */ }
  });
}

/* ============================================================
   8. EXPRESS: СТАТИКА + ПУБЛИЧНЫЙ API
   ============================================================ */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- GET /api/game-settings (публичный, для экрана техработ) ---------- */
app.get('/api/game-settings', (req, res) => {
  res.json({ success: true, maintenanceMode: settings.maintenanceMode, doubleRewards: settings.doubleRewards });
});

/* ---------- POST /api/save-progress ---------- */
app.post('/api/save-progress', (req, res) => {
  const { telegram_id, level, score, coins, name, username } = req.body || {};
  if (!telegram_id) return res.status(400).json({ success: false, error: 'telegram_id обязателен' });

  const player = getOrCreatePlayer(telegram_id, { name, username });
  if (player.banned) return res.status(403).json({ success: false, error: 'Аккаунт заблокирован' });

  if (typeof level === 'number') player.bestLevel = Math.max(player.bestLevel || 0, level);
  if (typeof score === 'number') player.bestScore = Math.max(player.bestScore || 0, score);
  if (typeof coins === 'number') player.coins = coins;
  player.updatedAt = Date.now();
  saveDB();

  return res.json({ success: true, player });
});

/* ---------- GET /api/leaderboard ---------- */
app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 10);
  res.json({ success: true, leaderboard: getTopPlayers(limit) });
});

/* ---------- POST /api/ref-bonus ---------- */
app.post('/api/ref-bonus', (req, res) => {
  const { telegram_id, ref_id, name, username } = req.body || {};
  if (!telegram_id || !ref_id) return res.status(400).json({ success: false, error: 'telegram_id и ref_id обязательны' });
  const result = creditReferral(telegram_id, ref_id, { name, username });
  if (!result.credited) return res.json({ success: false, reason: result.reason });
  return res.json({ success: true, bonus: result.bonus });
});

/* ============================================================
   9. АДМИН API (требует requireAdmin на каждом эндпоинте)
   ============================================================ */

/* ---------- GET /api/admin/stats ---------- */
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json({ success: true, stats: computeStats() });
});

/* ---------- GET /api/admin/search?query=... ---------- */
app.get('/api/admin/search', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
  if (!q) return res.json({ success: true, results: [] });
  const results = Object.values(players).filter((p) =>
    String(p.id) === q || (p.username && p.username.toLowerCase().includes(q)) || (p.name && p.name.toLowerCase().includes(q))
  ).slice(0, 25);
  res.json({ success: true, results });
});

/* ---------- GET /api/admin/player/:id ---------- */
app.get('/api/admin/player/:id', requireAdmin, (req, res) => {
  const player = players[String(req.params.id)];
  if (!player) return res.status(404).json({ success: false, error: 'Игрок не найден' });
  res.json({ success: true, player });
});

/* ---------- POST /api/admin/player/adjust ---------- */
app.post('/api/admin/player/adjust', requireAdmin, (req, res) => {
  const { target_id, coinsDelta, gemsDelta } = req.body || {};
  const player = players[String(target_id)];
  if (!player) return res.status(404).json({ success: false, error: 'Игрок не найден' });
  if (typeof coinsDelta === 'number') player.coins = Math.max(0, (player.coins || 0) + coinsDelta);
  if (typeof gemsDelta === 'number') player.gems = Math.max(0, (player.gems || 0) + gemsDelta);
  player.updatedAt = Date.now();
  saveDB();
  res.json({ success: true, player });
});

/* ---------- POST /api/admin/player/set-level ---------- */
app.post('/api/admin/player/set-level', requireAdmin, (req, res) => {
  const { target_id, level } = req.body || {};
  const player = players[String(target_id)];
  if (!player) return res.status(404).json({ success: false, error: 'Игрок не найден' });
  player.bestLevel = Math.max(0, parseInt(level, 10) || 0);
  player.updatedAt = Date.now();
  saveDB();
  res.json({ success: true, player });
});

/* ---------- POST /api/admin/player/lives ---------- */
app.post('/api/admin/player/lives', requireAdmin, (req, res) => {
  const { target_id, action } = req.body || {}; // 'restore' | 'block'
  const player = players[String(target_id)];
  if (!player) return res.status(404).json({ success: false, error: 'Игрок не найден' });
  player.lives = action === 'block' ? 0 : 5;
  player.livesLockedByAdmin = action === 'block';
  player.updatedAt = Date.now();
  saveDB();
  res.json({ success: true, player });
});

/* ---------- POST /api/admin/player/ban ---------- */
app.post('/api/admin/player/ban', requireAdmin, (req, res) => {
  const { target_id, banned } = req.body || {};
  const player = players[String(target_id)];
  if (!player) return res.status(404).json({ success: false, error: 'Игрок не найден' });
  player.banned = !!banned;
  player.bannedAt = player.banned ? Date.now() : null;
  player.updatedAt = Date.now();
  saveDB();
  res.json({ success: true, player });
});

/* ---------- POST /api/admin/player/reset ---------- */
app.post('/api/admin/player/reset', requireAdmin, (req, res) => {
  const { target_id } = req.body || {};
  const key = String(target_id);
  if (!players[key]) return res.status(404).json({ success: false, error: 'Игрок не найден' });
  const keepName = players[key].name, keepUsername = players[key].username;
  players[key] = {
    id: key, name: keepName, username: keepUsername,
    bestLevel: 0, bestScore: 0, coins: 0, gems: 0,
    refBy: null, refCount: 0, banned: false, bannedAt: null,
    createdAt: players[key].createdAt, updatedAt: Date.now()
  };
  saveDB();
  res.json({ success: true, player: players[key] });
});

/* ---------- GET/POST /api/admin/settings ---------- */
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({ success: true, settings });
});
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const { maintenanceMode, doubleRewards } = req.body || {};
  if (typeof maintenanceMode === 'boolean') settings.maintenanceMode = maintenanceMode;
  if (typeof doubleRewards === 'boolean') settings.doubleRewards = doubleRewards;
  saveSettings();
  res.json({ success: true, settings });
});

/* ---------- POST /api/admin/broadcast (запуск) ---------- */
app.post('/api/admin/broadcast', requireAdmin, (req, res) => {
  if (!bot) return res.status(400).json({ success: false, error: 'Бот не запущен (нет BOT_TOKEN)' });
  if (broadcastState.running) return res.status(409).json({ success: false, error: 'Рассылка уже выполняется' });
  const { message, parseMode, buttonUrl, buttonText } = req.body || {};
  if (!message) return res.status(400).json({ success: false, error: 'Текст сообщения обязателен' });

  broadcastToAll(message, { parseMode: parseMode || 'HTML', buttonUrl, buttonText }).catch((e) => console.error('Broadcast error:', e.message));
  res.json({ success: true, started: true, total: Object.keys(players).length });
});

/* ---------- GET /api/admin/broadcast/status (для прогресс-бара) ---------- */
app.get('/api/admin/broadcast/status', requireAdmin, (req, res) => {
  res.json({ success: true, ...broadcastState });
});

/* ---------- Fallback: отдаём index.html для прочих маршрутов ---------- */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ============================================================
   10. ЗАПУСК
   ============================================================ */
app.listen(PORT, () => {
  console.log(`🚀 Fruit Blitz сервер запущен на порту ${PORT}`);
  console.log(`   WebApp URL: ${WEBAPP_URL}`);
  console.log(`   Админы: ${ADMIN_IDS.length ? ADMIN_IDS.join(', ') : '(не заданы)'}`);
});
