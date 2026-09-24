/* ==========================================================
   FRUIT BLITZ — Backend сервер + Telegram-бот
   Express (статика + API) + node-telegram-bot-api (polling)
   ========================================================== */

const path = require('path');
const fs = require('fs');
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

/* ============================================================
   1. ПРОСТОЕ ХРАНИЛИЩЕ ИГРОКОВ (JSON-файл на диске)
   ============================================================ */
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'players.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  ensureDataDir();
  try {
    if (!fs.existsSync(DB_FILE)) return {};
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Ошибка чтения players.json, стартуем с пустой базой:', e.message);
    return {};
  }
}

let saveTimer = null;
function saveDB() {
  // лёгкий дебаунс, чтобы не писать на диск при каждом вызове подряд
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ensureDataDir();
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(players, null, 2), 'utf8');
    } catch (e) {
      console.error('Ошибка записи players.json:', e.message);
    }
  }, 150);
}

/** players[telegram_id] = {
 *   id, name, username,
 *   bestLevel, bestScore, coins,
 *   refBy, refCount,
 *   createdAt, updatedAt
 * }
 */
const players = loadDB();

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
      refBy: null,
      refCount: 0,
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
   2. НАЧИСЛЕНИЕ РЕФЕРАЛЬНОГО БОНУСА (общая функция)
   ============================================================ */
function creditReferral(newUserId, referrerId, extraNew) {
  const newKey = String(newUserId);
  const refKey = String(referrerId);
  if (!refKey || newKey === refKey) return { credited: false, reason: 'self-ref' };

  const newPlayer = getOrCreatePlayer(newKey, extraNew);

  if (newPlayer.refBy) {
    return { credited: false, reason: 'already-credited' };
  }

  const referrer = getOrCreatePlayer(refKey);
  newPlayer.refBy = refKey;
  referrer.refCount = (referrer.refCount || 0) + 1;
  referrer.coins = (referrer.coins || 0) + REF_BONUS_COINS;
  referrer.updatedAt = Date.now();
  newPlayer.updatedAt = Date.now();
  saveDB();

  return { credited: true, bonus: REF_BONUS_COINS, referrer };
}

/* ============================================================
   3. TELEGRAM-БОТ
   ============================================================ */
let bot = null;

if (!BOT_TOKEN) {
  console.warn('⚠️  BOT_TOKEN не задан в переменных окружения — бот не запущен. Веб-сервер продолжит работу.');
} else {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Telegram-бот запущен (polling)');

  bot.on('polling_error', (err) => {
    console.error('Polling error:', err.message);
  });

  /* ---------- /start (в т.ч. /start ref_12345) ---------- */
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const fromId = msg.from.id;
    const firstName = msg.from.first_name || 'друг';
    const username = msg.from.username || null;
    const payload = match && match[1] ? match[1].trim() : null;

    getOrCreatePlayer(fromId, { name: firstName, username });

    // Реферальный переход: /start ref_12345
    if (payload && payload.startsWith('ref_')) {
      const referrerId = payload.slice(4);
      const result = creditReferral(fromId, referrerId, { name: firstName, username });
      if (result.credited) {
        console.log(`Реферальный бонус: ${referrerId} получил +${result.bonus} монет за ${fromId}`);
        try {
          await bot.sendMessage(
            referrerId,
            `🎉 Ваш друг ${firstName} присоединился к Fruit Blitz по вашей ссылке!\nВам начислено +${result.bonus} 🪙`
          );
        } catch (e) {
          console.warn('Не удалось уведомить реферера:', e.message);
        }
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

    try {
      await bot.sendMessage(chatId, welcomeText, { reply_markup: keyboard });
    } catch (e) {
      console.error('Ошибка отправки приветствия:', e.message);
    }
  });

  /* ---------- Нажатие на инлайн-кнопки ---------- */
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;

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
      try {
        await bot.sendMessage(chatId, text);
      } catch (e) {
        console.error('Ошибка отправки лидерборда:', e.message);
      }
    }

    try {
      await bot.answerCallbackQuery(query.id);
    } catch (e) { /* noop */ }
  });
}

function getTopPlayers(limit) {
  return Object.values(players)
    .filter((p) => (p.bestScore || 0) > 0)
    .sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0))
    .slice(0, limit || 10)
    .map((p) => ({
      id: p.id,
      name: p.name,
      username: p.username,
      bestScore: p.bestScore,
      bestLevel: p.bestLevel
    }));
}

/* ============================================================
   4. EXPRESS: СТАТИКА + API
   ============================================================ */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- POST /api/save-progress ---------- */
app.post('/api/save-progress', (req, res) => {
  const { telegram_id, level, score, coins, name, username } = req.body || {};

  if (!telegram_id) {
    return res.status(400).json({ success: false, error: 'telegram_id обязателен' });
  }

  const player = getOrCreatePlayer(telegram_id, { name, username });

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
  const top = getTopPlayers(limit);
  return res.json({ success: true, leaderboard: top });
});

/* ---------- POST /api/ref-bonus ---------- */
app.post('/api/ref-bonus', (req, res) => {
  const { telegram_id, ref_id, name, username } = req.body || {};

  if (!telegram_id || !ref_id) {
    return res.status(400).json({ success: false, error: 'telegram_id и ref_id обязательны' });
  }

  const result = creditReferral(telegram_id, ref_id, { name, username });

  if (!result.credited) {
    return res.json({ success: false, reason: result.reason });
  }

  return res.json({ success: true, bonus: result.bonus });
});

/* ---------- Fallback: отдаём index.html для прочих маршрутов ---------- */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ============================================================
   5. ЗАПУСК
   ============================================================ */
app.listen(PORT, () => {
  console.log(`🚀 Fruit Blitz сервер запущен на порту ${PORT}`);
  console.log(`   WebApp URL: ${WEBAPP_URL}`);
});
