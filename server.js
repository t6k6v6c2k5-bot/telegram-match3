/* ==========================================================
   FRUIT BLITZ — сервер: статика + API + Telegram-бот + админка
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
const REF_BONUS_COINS = 300;
const ADMIN_IDS = String(process.env.ADMIN_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
// Без BOT_TOKEN проверить подпись initData невозможно — тогда (только для локальной
// разработки) доверяем telegram_id из запроса. На проде с BOT_TOKEN всё проверяется подписью.
const DEV_TRUST_IDS = !BOT_TOKEN || process.env.ALLOW_INSECURE_ADMIN === '1';
const isAdminId = (id) => ADMIN_IDS.includes(String(id));

/* ============================================================
   1. ХРАНИЛИЩЕ (data/players.json)
   ВАЖНО: на Railway подключите Volume и задайте DATA_DIR=/data —
   иначе файловая система контейнера сбрасывается при каждом деплое.
   ============================================================ */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'players.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 30;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
function loadJSON(file, fallback) {
  ensureDirs();
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Ошибка чтения', file, e.message);
    return fallback;
  }
}
let lastBackupAt = 0;
function backupFile(file) {
  // Не чаще раза в 10 минут — чтобы не плодить сотни копий при активной игре
  if (Date.now() - lastBackupAt < 10 * 60 * 1000 || !fs.existsSync(file)) return;
  lastBackupAt = Date.now();
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(BACKUP_DIR, `players_${stamp}.json`));
    const list = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('players_')).sort();
    while (list.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, list.shift()));
  } catch (e) { console.warn('Бэкап не создан:', e.message); }
}
function writeJSON(file, data) {
  ensureDirs();
  try {
    if (file === DB_FILE && Object.keys(data).length === 0) {
      const onDisk = loadJSON(DB_FILE, null);
      if (onDisk && Object.keys(onDisk).length > 0) {
        console.error('⛔ Защита: отменена перезапись непустой базы пустой.');
        return;
      }
    }
    if (file === DB_FILE) backupFile(file);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
    fs.renameSync(tmp, file); // атомарная замена — файл не повредится при сбое посреди записи
  } catch (e) { console.error('Ошибка записи', file, e.message); }
}

const BOOSTER_KEYS = ['hammer', 'shuffle', 'rocket', 'bomb', 'rainbow'];
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

/** Нормализация: чинит записи старых версий, ничего не удаляя */
function normalizePlayer(p) {
  p.id = String(p.id);
  p.name = p.name || 'Игрок';
  p.username = p.username || null;
  p.coins = Math.max(0, Math.floor(num(p.coins, 0)));
  p.gems = Math.max(0, Math.floor(num(p.gems, 0)));
  p.lives = Math.max(0, Math.floor(num(p.lives, 10)));
  p.bestLevel = Math.max(1, Math.floor(num(p.bestLevel, 1)));
  p.bestScore = Math.max(0, num(p.bestScore, 0));
  p.totalStars = Math.max(0, Math.floor(num(p.totalStars, 0)));
  p.starsBank = Math.max(0, Math.floor(num(p.starsBank, 0)));
  const b = (p.boosters && typeof p.boosters === 'object') ? p.boosters : {};
  p.boosters = {};
  BOOSTER_KEYS.forEach((k) => { p.boosters[k] = Math.max(0, Math.floor(num(b[k], 0))); });
  if (typeof b.rocketBoost === 'number') p.boosters.rocket += b.rocketBoost;
  p.isBanned = typeof p.isBanned === 'boolean' ? p.isBanned : !!p.banned;
  p.bannedAt = p.bannedAt || null;
  p.adminRev = Math.max(0, Math.floor(num(p.adminRev, 0)));
  p.resetToken = p.resetToken || null;
  p.refBy = p.refBy || null;
  p.refCount = Math.max(0, num(p.refCount, 0));
  p.createdAt = p.createdAt || Date.now();
  p.updatedAt = p.updatedAt || Date.now();
  p.lastSeen = p.lastSeen || p.updatedAt;
  delete p.banned; delete p.livesLockedByAdmin;
  return p;
}

const players = loadJSON(DB_FILE, {});
Object.keys(players).forEach((id) => normalizePlayer(players[id]));
const settings = Object.assign({ maintenanceMode: false, doubleRewards: false, globalGift: null }, loadJSON(SETTINGS_FILE, {}));

let saveTimer = null;
function saveDB() { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeJSON(DB_FILE, players), 300); }
function saveSettings() { writeJSON(SETTINGS_FILE, settings); }
process.on('SIGTERM', () => { writeJSON(DB_FILE, players); process.exit(0); });

function getOrCreatePlayer(id, extra) {
  const key = String(id);
  if (!players[key]) players[key] = normalizePlayer({ id: key, lives: 10, coins: 500, gems: 20 });
  const p = players[key];
  if (extra && extra.name) p.name = String(extra.name).slice(0, 64);
  if (extra && extra.username) p.username = String(extra.username).slice(0, 64);
  return normalizePlayer(p);
}
function publicSettings() {
  return { maintenanceMode: settings.maintenanceMode, doubleRewards: settings.doubleRewards, globalGift: settings.globalGift };
}

/* ============================================================
   2. ПРОВЕРКА ПОДПИСИ TELEGRAM initData
   ============================================================ */
function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const pairs = [];
    params.forEach((v, k) => pairs.push(`${k}=${v}`));
    pairs.sort();
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
    if (calc !== hash) return null;
    const user = params.get('user') ? JSON.parse(params.get('user')) : null;
    return user && user.id ? user : null;
  } catch (e) { return null; }
}
/** Определяет, КТО делает запрос: по подписи Telegram (прод) или по telegram_id (локально) */
function resolveUser(req) {
  const initData = req.get('X-Telegram-Init-Data') || (req.body && req.body.init_data) || req.query.init_data;
  const verified = verifyInitData(initData);
  if (verified) return { id: String(verified.id), name: verified.first_name, username: verified.username };
  if (DEV_TRUST_IDS) {
    const id = (req.body && req.body.telegram_id) || req.query.telegram_id;
    if (id && id !== 'guest') return { id: String(id), name: (req.body && req.body.name) || req.query.name, username: (req.body && req.body.username) || req.query.username };
  }
  return null;
}
function requireUser(req, res, next) {
  const u = resolveUser(req);
  if (!u) return res.status(401).json({ success: false, error: 'Не удалось подтвердить пользователя Telegram' });
  req.user = u; next();
}
function requireAdmin(req, res, next) {
  const u = resolveUser(req);
  if (!u || !isAdminId(u.id)) return res.status(403).json({ success: false, error: 'Доступ запрещён' });
  req.user = u; next();
}

/* ============================================================
   3. ЛОГИКА: рефералы, рейтинг, статистика
   ============================================================ */
function creditReferral(newId, refId, extra) {
  const nk = String(newId), rk = String(refId);
  if (!rk || nk === rk || !/^\d+$/.test(rk)) return { credited: false };
  const np = getOrCreatePlayer(nk, extra);
  if (np.refBy) return { credited: false };
  const rp = getOrCreatePlayer(rk);
  np.refBy = rk;
  rp.refCount += 1;
  rp.coins += REF_BONUS_COINS;
  rp.adminRev += 1; // клиент реферера подтянет бонус при следующей синхронизации
  rp.updatedAt = np.updatedAt = Date.now();
  saveDB();
  return { credited: true, bonus: REF_BONUS_COINS };
}
function leaderboard(limit) {
  return Object.values(players)
    .filter((p) => !p.isBanned && p.bestLevel > 1)
    .sort((a, b) => (b.bestLevel - a.bestLevel) || (b.totalStars - a.totalStars))
    .slice(0, limit)
    .map((p) => ({ id: p.id, name: p.name, username: p.username, bestLevel: p.bestLevel, totalStars: p.totalStars }));
}
function computeStats() {
  const all = Object.values(players);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 864e5;
  const sum = (f) => all.reduce((s, p) => s + (f(p) || 0), 0);
  const top = (f) => all.slice().sort((a, b) => f(b) - f(a)).slice(0, 5).map((p) => ({ id: p.id, name: p.name, username: p.username, coins: p.coins, gems: p.gems, bestLevel: p.bestLevel, totalStars: p.totalStars }));
  return {
    totalUsers: all.length,
    dau: all.filter((p) => p.lastSeen >= dayStart.getTime()).length,
    wau: all.filter((p) => p.lastSeen >= weekAgo).length,
    newToday: all.filter((p) => p.createdAt >= dayStart.getTime()).length,
    banned: all.filter((p) => p.isBanned).length,
    totalCoins: sum((p) => p.coins), totalGems: sum((p) => p.gems), totalStars: sum((p) => p.totalStars),
    avgLevel: all.length ? Math.round((sum((p) => p.bestLevel) / all.length) * 10) / 10 : 0,
    maxLevel: all.reduce((m, p) => Math.max(m, p.bestLevel), 1),
    topRich: top((p) => p.coins), topLevel: top((p) => p.bestLevel * 1000 + p.totalStars)
  };
}

/* ============================================================
   4. РАССЫЛКА
   ============================================================ */
const broadcast = { running: false, total: 0, sent: 0, failed: 0 };
async function runBroadcast(text, opts) {
  const ids = Object.keys(players).filter((id) => !players[id].isBanned);
  Object.assign(broadcast, { running: true, total: ids.length, sent: 0, failed: 0 });
  const markup = opts && opts.withButton ? { inline_keyboard: [[{ text: opts.buttonText || '🎮 Играть', web_app: { url: WEBAPP_URL } }]] } : undefined;
  for (const id of ids) {
    try { await bot.sendMessage(id, text, { parse_mode: 'HTML', reply_markup: markup }); broadcast.sent++; }
    catch (e) { broadcast.failed++; }
    await new Promise((r) => setTimeout(r, 45));
  }
  broadcast.running = false;
}

/* ============================================================
   5. TELEGRAM-БОТ
   ============================================================ */
let bot = null;
const adminSessions = {};
function statsText() {
  const s = computeStats();
  let t = `📊 <b>Fruit Blitz — статистика</b>\n\n👥 Игроков: <b>${s.totalUsers}</b> (новых сегодня: ${s.newToday})\n🟢 DAU: <b>${s.dau}</b> · WAU: <b>${s.wau}</b>\n🚩 Средний уровень: <b>${s.avgLevel}</b> · макс: <b>${s.maxLevel}</b>\n🪙 Монет: <b>${s.totalCoins}</b> · 💎 Кристаллов: <b>${s.totalGems}</b>\n⭐ Звёзд: <b>${s.totalStars}</b> · 🚫 Банов: ${s.banned}\n\n🏆 <b>Топ по уровню:</b>\n`;
  s.topLevel.forEach((p, i) => { t += `${i + 1}. ${p.name} — ур. ${p.bestLevel}, ⭐${p.totalStars}\n`; });
  return t;
}
function adminKeyboard() {
  return { inline_keyboard: [
    [{ text: '🔄 Обновить', callback_data: 'admin_refresh' }, { text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
    [{ text: `🛠 Техработы: ${settings.maintenanceMode ? 'ВКЛ' : 'выкл'}`, callback_data: 'admin_maint' }],
    [{ text: `🎉 x2 награды: ${settings.doubleRewards ? 'ВКЛ' : 'выкл'}`, callback_data: 'admin_double' }],
    [{ text: '⚙️ Открыть админку', web_app: { url: WEBAPP_URL } }]
  ] };
}

if (!BOT_TOKEN) {
  console.warn('⚠️  BOT_TOKEN не задан — бот не запущен, работает только веб-сервер (режим разработки).');
} else {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  bot.on('polling_error', (e) => console.error('Polling error:', e.message));

  bot.onText(/^\/start(?:\s+(.+))?/, async (msg, match) => {
    const from = msg.from;
    const p = getOrCreatePlayer(from.id, { name: from.first_name, username: from.username });
    if (p.isBanned) return bot.sendMessage(msg.chat.id, '⛔ Доступ к игре заблокирован.').catch(() => {});
    const payload = match && match[1] ? match[1].trim() : '';
    if (payload.startsWith('ref_')) {
      const r = creditReferral(from.id, payload.slice(4), { name: from.first_name, username: from.username });
      if (r.credited) bot.sendMessage(payload.slice(4), `🎉 ${from.first_name || 'Друг'} присоединился по вашей ссылке! +${r.bonus} 🪙`).catch(() => {});
    }
    saveDB();
    const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${from.id}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Залипательная игра «три в ряд» прямо в Telegram 🍓 Заходи!')}`;
    const text = `Привет, ${from.first_name || 'друг'}! 🍓 Добро пожаловать в <b>Fruit Blitz</b>!\n\n` +
      `🎯 Проходи уровни и собирай звёзды\n🌳 Строй свой волшебный Сад\n🎁 Открывай скины, рамки и сундуки\n👥 Приглашай друзей — +${REF_BONUS_COINS} 🪙 за каждого!`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
      [{ text: '🎮 Играть', web_app: { url: WEBAPP_URL } }],
      [{ text: '👥 Пригласить друга', url: share }, { text: '🏆 Рейтинг', callback_data: 'leaderboard' }]
    ] } }).catch((e) => console.error(e.message));
  });

  bot.onText(/^\/admin/, (msg) => {
    if (!isAdminId(msg.from.id)) return bot.sendMessage(msg.chat.id, '⛔ Доступ запрещён.').catch(() => {});
    bot.sendMessage(msg.chat.id, statsText(), { parse_mode: 'HTML', reply_markup: adminKeyboard() }).catch(() => {});
  });

  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    if (adminSessions[msg.chat.id] === 'broadcast' && isAdminId(msg.from.id)) {
      delete adminSessions[msg.chat.id];
      if (broadcast.running) return bot.sendMessage(msg.chat.id, 'Рассылка уже идёт.').catch(() => {});
      bot.sendMessage(msg.chat.id, `📢 Отправка ${Object.keys(players).length} игрокам...`).catch(() => {});
      runBroadcast(msg.text, { withButton: true }).then(() =>
        bot.sendMessage(msg.chat.id, `✅ Готово. Доставлено: ${broadcast.sent}, ошибок: ${broadcast.failed}`).catch(() => {}));
    }
  });

  bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    if (q.data === 'leaderboard') {
      const top = leaderboard(10);
      const medals = ['🥇', '🥈', '🥉'];
      const text = '🏆 <b>Топ-10 Fruit Blitz</b>\n\n' + (top.length ? top.map((p, i) => `${medals[i] || (i + 1) + '.'} ${p.name} — ур. ${p.bestLevel}, ⭐${p.totalStars}`).join('\n') : 'Пока пусто — стань первым!');
      bot.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {});
    } else if (q.data.startsWith('admin_')) {
      if (!isAdminId(q.from.id)) return bot.answerCallbackQuery(q.id, { text: 'Доступ запрещён', show_alert: true }).catch(() => {});
      if (q.data === 'admin_broadcast') {
        adminSessions[chatId] = 'broadcast';
        bot.sendMessage(chatId, '✏️ Пришлите текст рассылки следующим сообщением (можно HTML).').catch(() => {});
      } else {
        if (q.data === 'admin_maint') { settings.maintenanceMode = !settings.maintenanceMode; saveSettings(); }
        if (q.data === 'admin_double') { settings.doubleRewards = !settings.doubleRewards; saveSettings(); }
        bot.editMessageText(statsText(), { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'HTML', reply_markup: adminKeyboard() }).catch(() => {});
      }
    }
    bot.answerCallbackQuery(q.id).catch(() => {});
  });
}

/* ============================================================
   6. EXPRESS
   ============================================================ */
const app = express();
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

app.get('/api/game-settings', (req, res) => res.json({ success: true, ...publicSettings() }));
app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
  res.json({ success: true, leaderboard: leaderboard(limit) });
});

/* Игрок читает свою серверную запись (облачное сохранение + начисления админа) */
app.get('/api/player-sync', requireUser, (req, res) => {
  const p = getOrCreatePlayer(req.user.id, req.user);
  p.lastSeen = Date.now();
  saveDB();
  res.json({ success: true, player: p, settings: publicSettings() });
});

/* Игрок отправляет прогресс. Если админ успел изменить аккаунт после последней синхронизации
   клиента (adminRev клиента устарел) — прогресс НЕ перезаписывается, клиент сначала подтягивает изменения. */
app.post('/api/save-progress', requireUser, (req, res) => {
  const p = getOrCreatePlayer(req.user.id, req.user);
  if (p.isBanned) return res.status(403).json({ success: false, error: 'Аккаунт заблокирован' });
  const b = req.body || {};
  if (num(b.adminRev, 0) < p.adminRev) return res.status(409).json({ success: false, needsPull: true, player: p });
  const clampInt = (v, max) => Math.max(0, Math.min(max, Math.floor(num(v, 0))));
  if (typeof b.coins === 'number') p.coins = clampInt(b.coins, 1e9);
  if (typeof b.gems === 'number') p.gems = clampInt(b.gems, 1e7);
  if (typeof b.lives === 'number') p.lives = clampInt(b.lives, 99);
  if (typeof b.level === 'number') p.bestLevel = Math.max(1, clampInt(b.level, 100000));
  if (typeof b.totalStars === 'number') p.totalStars = clampInt(b.totalStars, 1e6);
  if (typeof b.starsBank === 'number') p.starsBank = clampInt(b.starsBank, 1e6);
  if (typeof b.score === 'number') p.bestScore = Math.max(p.bestScore, clampInt(b.score, 1e9));
  if (b.boosters && typeof b.boosters === 'object') BOOSTER_KEYS.forEach((k) => { if (typeof b.boosters[k] === 'number') p.boosters[k] = clampInt(b.boosters[k], 9999); });
  p.updatedAt = p.lastSeen = Date.now();
  saveDB();
  res.json({ success: true, player: p });
});

app.post('/api/ref-bonus', requireUser, (req, res) => {
  const r = creditReferral(req.user.id, (req.body || {}).ref_id, req.user);
  res.json({ success: r.credited, bonus: r.bonus || 0 });
});

/* ---------------- Админ API ---------------- */
app.get('/api/am-i-admin', (req, res) => { const u = resolveUser(req); res.json({ success: true, admin: !!(u && isAdminId(u.id)) }); });
app.get('/api/admin/stats', requireAdmin, (req, res) => res.json({ success: true, stats: computeStats() }));
app.get('/api/admin/players', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
  let list = Object.values(players);
  if (q) list = list.filter((p) => p.id === q || (p.username || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q));
  list.sort((a, b) => b.lastSeen - a.lastSeen);
  res.json({ success: true, total: list.length, players: list.slice(0, 200) });
});
app.get('/api/admin/player/:id', requireAdmin, (req, res) => {
  const p = players[String(req.params.id)];
  if (!p) return res.status(404).json({ success: false, error: 'Игрок не найден' });
  res.json({ success: true, player: normalizePlayer(p) });
});
app.post('/api/admin/action', requireAdmin, (req, res) => {
  const b = req.body || {};
  const p = players[String(b.target_id)];
  if (!p) return res.status(404).json({ success: false, error: 'Игрок не найден' });
  const v = Math.floor(num(Number(b.value), 0));
  switch (b.action) {
    case 'update_coins': p.coins = Math.max(0, b.mode === 'set' ? v : p.coins + v); break;
    case 'update_gems': p.gems = Math.max(0, b.mode === 'set' ? v : p.gems + v); break;
    case 'set_lives': p.lives = Math.max(0, Math.min(99, v)); break;
    case 'set_level': p.bestLevel = Math.max(1, v); break;
    case 'set_stars': p.starsBank = Math.max(0, v); break;
    case 'give_booster': {
      if (!BOOSTER_KEYS.includes(b.booster)) return res.status(400).json({ success: false, error: 'Неизвестный бустер' });
      p.boosters[b.booster] = Math.max(0, p.boosters[b.booster] + v); break;
    }
    case 'toggle_ban': p.isBanned = !!b.isBanned; p.bannedAt = p.isBanned ? Date.now() : null; break;
    case 'reset_progress':
      Object.assign(p, { coins: 500, gems: 20, lives: 10, bestLevel: 1, bestScore: 0, totalStars: 0, starsBank: 0, resetToken: String(Date.now()) });
      BOOSTER_KEYS.forEach((k) => { p.boosters[k] = 0; });
      break;
    default: return res.status(400).json({ success: false, error: 'Неизвестное действие' });
  }
  p.adminRev += 1;
  p.updatedAt = Date.now();
  normalizePlayer(p);
  saveDB();
  res.json({ success: true, player: p });
});
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json({ success: true, settings }));
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (typeof b.maintenanceMode === 'boolean') settings.maintenanceMode = b.maintenanceMode;
  if (typeof b.doubleRewards === 'boolean') settings.doubleRewards = b.doubleRewards;
  if (b.globalGift === null) settings.globalGift = null;
  else if (b.globalGift && typeof b.globalGift === 'object') {
    const g = b.globalGift;
    settings.globalGift = {
      id: 'g' + Date.now(),
      coins: Math.max(0, Math.floor(num(Number(g.coins), 0))),
      gems: Math.max(0, Math.floor(num(Number(g.gems), 0))),
      booster: BOOSTER_KEYS.includes(g.booster) ? g.booster : null,
      boosterAmount: Math.max(0, Math.floor(num(Number(g.boosterAmount), 0))),
      message: String(g.message || 'Подарок от команды Fruit Blitz!').slice(0, 200),
      createdAt: Date.now()
    };
  }
  saveSettings();
  res.json({ success: true, settings });
});
app.post('/api/admin/broadcast', requireAdmin, (req, res) => {
  if (!bot) return res.status(400).json({ success: false, error: 'Бот не запущен (нет BOT_TOKEN)' });
  if (broadcast.running) return res.status(409).json({ success: false, error: 'Рассылка уже идёт' });
  const b = req.body || {};
  if (!b.message) return res.status(400).json({ success: false, error: 'Пустой текст' });
  runBroadcast(String(b.message), { withButton: b.withButton !== false, buttonText: b.buttonText });
  res.json({ success: true, total: Object.keys(players).length });
});
app.get('/api/admin/broadcast/status', requireAdmin, (req, res) => res.json({ success: true, ...broadcast }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀 Fruit Blitz: порт ${PORT}`);
  console.log(`   Данные: ${DATA_DIR} — игроков загружено: ${Object.keys(players).length}`);
  console.log(`   Админы: ${ADMIN_IDS.join(', ') || '(не заданы — задайте ADMIN_ID)'}`);
  if (DEV_TRUST_IDS) console.warn('   ⚠️  Режим разработки: telegram_id принимается без подписи (нет BOT_TOKEN).');
  if (!process.env.DATA_DIR) console.warn('   ⚠️  DATA_DIR не задан — данные пропадут при редеплое без Volume!');
});
