/* ==========================================================
   FRUIT BLITZ — рост и удержание:
   1) аналитика (удержание, воронка уровней, активность по дням)
   2) напоминания от бота (жизни, подарок, колесо, «скучаем», конец сезона)
   3) карточки «Поделиться» (картинка → сообщение/история в Telegram)
   ========================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Items = require('./public/items.js');

module.exports = function attachGrowth(ctx) {
  const { app, requireUser, requireAdmin, players, saveDB, writeJSON, loadJSON, DATA_DIR, BOT_TOKEN, WEBAPP_URL, BOT_USERNAME, getBot, getEconomy, settings, saveSettings } = ctx;
  const DAY = 86400000, HOUR = 3600000;
  const now = () => Date.now();
  const dayKey = (t) => new Date(t == null ? now() : t).toISOString().slice(0, 10);
  const fail = (res, code, error) => res.status(code).json({ success: false, error });
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  /* ============================================================
     1. АНАЛИТИКА
     ============================================================ */
  const AN_FILE = path.join(DATA_DIR, 'analytics.json');
  const an = Object.assign({ since: now(), levels: {}, events: {}, notif: {}, evCount: {} }, loadJSON(AN_FILE, {}));
  let anTimer = null;
  const saveAn = () => { clearTimeout(anTimer); anTimer = setTimeout(() => writeJSON(AN_FILE, an), 2000); };
  if (settings.remindersEnabled === undefined) { settings.remindersEnabled = true; saveSettings(); }

  function touch(p) {
    const d = dayKey();
    if (!Array.isArray(p.days)) p.days = [];
    if (p.days[p.days.length - 1] !== d) { p.days.push(d); if (p.days.length > 120) p.days = p.days.slice(-120); }
  }
  function bump(dayObj, key, n) { dayObj[key] = (dayObj[key] || 0) + (n || 1); }

  // Клиент присылает события пачкой. Считаем только агрегаты — личные данные не храним.
  app.post('/api/track', requireUser, (req, res) => {
    const p = players[String(req.user.id)];
    if (!p || p.isBanned) return res.json({ success: true });
    const d = dayKey();
    an.evCount[p.id] = an.evCount[p.id] && an.evCount[p.id].d === d ? an.evCount[p.id] : { d, n: 0 };
    const list = Array.isArray(req.body.events) ? req.body.events.slice(0, 50) : [];
    for (const e of list) {
      if (!e || typeof e.type !== 'string') continue;
      if (++an.evCount[p.id].n > 600) break; // защита от накрутки
      const n = Math.floor(num(e.n, 0));
      if (e.type.startsWith('lvl_')) {
        if (n < 1 || n > 100000) continue;
        const L = an.levels[n] || (an.levels[n] = { s: 0, w: 0, q: 0, mv: 0, ms: 0, st: 0 });
        if (e.type === 'lvl_start') L.s++;
        else if (e.type === 'lvl_win') { L.w++; L.mv += Math.min(999, Math.max(0, Math.floor(num(e.moves, 0)))); L.ms += Math.min(3600000, Math.max(0, num(e.ms, 0))); L.st += Math.min(3, Math.max(0, Math.floor(num(e.stars, 0)))); }
        else if (e.type === 'lvl_quit') L.q++;
      } else if (/^[a-z_]{2,24}$/.test(e.type)) {
        const day = an.events[d] || (an.events[d] = {});
        bump(day, e.type + (typeof e.k === 'string' && /^[a-z0-9_]{1,16}$/.test(e.k) ? ':' + e.k : ''));
      }
    }
    // храним события за 90 дней
    const cut = dayKey(now() - 90 * DAY);
    Object.keys(an.events).forEach((k) => { if (k < cut) delete an.events[k]; });
    Object.keys(an.notif).forEach((k) => { if (k < cut) delete an.notif[k]; });
    saveAn();
    res.json({ success: true });
  });

  function retention(all, N) {
    const today = dayKey();
    let cohort = 0, kept = 0;
    all.forEach((p) => {
      if (!p.days || !p.days.length || p.createdAt < an.since - DAY) return; // до включения аналитики истории нет
      const target = dayKey(p.createdAt + N * DAY);
      if (target >= today) return; // этот день для игрока ещё не наступил полностью
      cohort++;
      if (p.days.includes(target)) kept++;
    });
    return { cohort, kept, rate: cohort ? Math.round(kept / cohort * 1000) / 10 : null };
  }
  app.get('/api/admin/analytics', requireAdmin, (req, res) => {
    const all = Object.values(players).filter((p) => !p.isBanned);
    const eco = getEconomy();
    const days = [];
    const rev = eco ? eco.revenueByDay(15) : {};
    for (let i = 13; i >= 0; i--) {
      const d = dayKey(now() - i * DAY);
      const ev = an.events[d] || {};
      days.push({
        d, dau: all.filter((p) => p.days && p.days.includes(d)).length,
        newU: all.filter((p) => dayKey(p.createdAt) === d).length,
        wins: 0, stars: rev[d] || 0,
        shares: Object.keys(ev).filter((k) => k.startsWith('share')).reduce((a, k) => a + ev[k], 0),
        notif: Object.values(an.notif[d] || {}).reduce((a, b) => a + b, 0)
      });
    }
    const mau = all.filter((p) => p.lastSeen >= now() - 30 * DAY).length;
    // Где «застревают»: игроки, которые не заходили 3+ дня, по последнему уровню
    const stuck = {};
    all.forEach((p) => { if (p.lastSeen < now() - 3 * DAY) stuck[p.bestLevel] = (stuck[p.bestLevel] || 0) + 1; });
    const maxLvl = Math.min(200, all.reduce((m, p) => Math.max(m, p.bestLevel), 1));
    const levels = [];
    for (let n = 1; n <= maxLvl; n++) {
      const L = an.levels[n] || { s: 0, w: 0, q: 0, mv: 0, ms: 0, st: 0 };
      if (!L.s && !stuck[n]) continue;
      levels.push({ n, s: L.s, w: L.w, q: L.q, winRate: L.s ? Math.round(L.w / L.s * 100) : null,
        avgMoves: L.w ? Math.round(L.mv / L.w) : null, avgSec: L.w ? Math.round(L.ms / L.w / 1000) : null,
        avgStars: L.w ? Math.round(L.st / L.w * 10) / 10 : null, stuck: stuck[n] || 0 });
    }
    // Итоги за 7 дней по событиям и напоминаниям
    const sum7 = (src) => { const out = {}; for (let i = 0; i < 7; i++) { const o = src[dayKey(now() - i * DAY)] || {}; Object.keys(o).forEach((k) => { out[k] = (out[k] || 0) + o[k]; }); } return out; };
    res.json({ success: true, a: {
      since: an.since, total: all.length, mau, dau: days[days.length - 1].dau, wau: all.filter((p) => p.lastSeen >= now() - 7 * DAY).length,
      ret: { d1: retention(all, 1), d7: retention(all, 7), d30: retention(all, 30) },
      days, levels, events7: sum7(an.events), notif7: sum7(an.notif),
      notifyOff: all.filter((p) => p.notify && p.notify.on === false).length,
      notifyBlocked: all.filter((p) => p.notify && p.notify.blocked).length,
      passBuyers: eco ? eco.passBuyers() : 0, season: Items.seasonInfo(),
      remindersEnabled: settings.remindersEnabled !== false
    } });
  });
  app.post('/api/admin/reminders', requireAdmin, (req, res) => {
    settings.remindersEnabled = !!req.body.enabled; saveSettings();
    res.json({ success: true, enabled: settings.remindersEnabled });
  });
  app.post('/api/admin/reminders/test', requireAdmin, async (req, res) => {
    const p = players[String(req.user.id)];
    if (!p) return fail(res, 404, 'Игрок не найден');
    const ok = await sendReminder(p, 'test', `🔔 <b>Тест напоминания</b>\n\nТак игроки увидят сообщение от бота. Вот пример:\n\n${TEXTS.lives(p)}`, true);
    res.json({ success: ok, error: ok ? undefined : 'Не удалось отправить — откройте бота и нажмите /start' });
  });

  /* ============================================================
     2. НАПОМИНАНИЯ ОТ БОТА
     Правила: не больше 2 в день, между ними ≥ 4 ч, только с 9:00 до 21:59 по времени игрока,
     и только если игрок не заходил после того, как событие наступило.
     ============================================================ */
  const MAX_PER_DAY = 2, MIN_GAP = 4 * HOUR;
  function normNotify(p) {
    if (!p.notify || typeof p.notify !== 'object') p.notify = {};
    const n = p.notify;
    if (typeof n.on !== 'boolean') n.on = true;
    n.blocked = !!n.blocked; n.lastAt = n.lastAt || 0; n.day = n.day || ''; n.count = n.count || 0;
    if (!n.sent || typeof n.sent !== 'object') n.sent = {};
    return n;
  }
  // Данные, которые клиент присылает при синхронизации (таймеры для напоминаний)
  function ingest(p, b) {
    touch(p);
    normNotify(p);
    const t = now();
    const ts = (v) => { v = num(v, 0); return v > t - DAY && v < t + 8 * DAY ? v : 0; };
    if (typeof b.tz === 'number' && Math.abs(b.tz) <= 840) p.tz = Math.round(b.tz);
    if (b.timers && typeof b.timers === 'object') {
      p.timers = { livesAt: ts(b.timers.livesAt), giftAt: ts(b.timers.giftAt), wheelAt: ts(b.timers.wheelAt) };
    }
    if (typeof b.passUnclaimed === 'number') p.passUnclaimed = Math.max(0, Math.min(99, Math.floor(b.passUnclaimed)));
  }
  app.post('/api/notify', requireUser, (req, res) => {
    const p = players[String(req.user.id)];
    if (!p) return fail(res, 404, 'Игрок не найден');
    normNotify(p).on = !!req.body.on;
    saveDB();
    res.json({ success: true, on: p.notify.on });
  });

  const TEXTS = {
    lives: (p) => `❤️ <b>Жизни восстановлены!</b>\n\nВсе 10 сердечек снова с тобой — уровень ${p.bestLevel} ждёт 🍓`,
    gift: () => `🎁 <b>Бесплатный подарок готов!</b>\n\nЗагляни в игру и забери монеты и бустеры.`,
    wheel: () => `🎡 <b>Колесо фортуны снова бесплатно!</b>\n\nКрути — вдруг выпадет джекпот 💎`,
    away2: (p) => `🍓 <b>Фрукты скучают!</b>\n\nТвой сад ждёт новых построек, а уровень ${p.bestLevel} — героя. Загляни хотя бы на минутку!`,
    away7: () => `🌳 <b>Давно не виделись!</b>\n\nЗа это время накопились подарки и задания. Возвращайся — мы сохранили весь твой прогресс.`,
    season: (p) => `⏳ <b>Сезон заканчивается через 2 дня!</b>\n\nВ пропуске ждут незабранные награды: ${p.passUnclaimed} шт. Забери, пока не сгорели!`
  };
  function pickReminder(p) {
    const n = p.notify, t = now(), ls = p.lastSeen || 0, tm = p.timers || {};
    const fresh = (at, key) => at && t >= at && t - at < 12 * HOUR && ls < at && n.sent[key] !== at;
    if (fresh(tm.livesAt, 'lives') && p.lives <= 5 && t - ls > HOUR) return { key: 'lives', mark: tm.livesAt };
    if (fresh(tm.giftAt, 'gift') && t - ls > 3 * HOUR) return { key: 'gift', mark: tm.giftAt };
    if (fresh(tm.wheelAt, 'wheel')) return { key: 'wheel', mark: tm.wheelAt };
    const season = Items.seasonInfo(t);
    if (season.end - t < 2 * DAY && p.passUnclaimed > 0 && t - ls < 14 * DAY && n.sent.season !== season.id && t - ls > 6 * HOUR) return { key: 'season', mark: season.id };
    if (t - ls > 7 * DAY && t - ls < 30 * DAY && n.sent.away7 !== ls) return { key: 'away7', mark: ls };
    if (t - ls > 2 * DAY && t - ls < 7 * DAY && n.sent.away2 !== ls) return { key: 'away2', mark: ls };
    return null;
  }
  async function sendReminder(p, key, text, force) {
    const bot = getBot();
    if (!bot) return false;
    const n = normNotify(p);
    try {
      await bot.sendMessage(p.id, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
        [{ text: '🎮 Играть', web_app: { url: WEBAPP_URL } }],
        [{ text: '🔕 Не напоминать', callback_data: 'notif_off' }]
      ] } });
      const d = dayKey();
      const nd = an.notif[d] || (an.notif[d] = {});
      bump(nd, key);
      if (!force) { if (n.day !== d) { n.day = d; n.count = 0; } n.count++; n.lastAt = now(); }
      saveAn();
      return true;
    } catch (e) {
      const code = e.response && e.response.statusCode;
      if (code === 403 || /blocked|chat not found|deactivated/i.test(e.message || '')) n.blocked = true;
      return false;
    }
  }
  let reminderRunning = false;
  async function reminderTick() {
    if (reminderRunning || settings.remindersEnabled === false || !getBot()) return;
    reminderRunning = true;
    try {
      const t = now(), d = dayKey();
      for (const p of Object.values(players)) {
        if (p.isBanned) continue;
        const n = normNotify(p);
        if (!n.on || n.blocked) continue;
        if (n.day === d && n.count >= MAX_PER_DAY) continue;
        if (t - n.lastAt < MIN_GAP) continue;
        const localHour = new Date(t + (p.tz != null ? p.tz : 120) * 60000).getUTCHours(); // по умолчанию — Киев
        if (localHour < 9 || localHour >= 22) continue;
        const r = pickReminder(p);
        if (!r) continue;
        n.sent[r.key] = r.mark; // отмечаем даже при ошибке, чтобы не повторять
        await sendReminder(p, r.key, TEXTS[r.key](p));
        await new Promise((ok) => setTimeout(ok, 60));
      }
      saveDB();
    } catch (e) { console.error('Напоминания:', e.message); } finally { reminderRunning = false; }
  }
  setInterval(reminderTick, 5 * 60000);
  setTimeout(reminderTick, 60000);
  const bot = getBot();
  if (bot) {
    bot.on('callback_query', (q) => {
      if (q.data !== 'notif_off') return;
      const p = players[String(q.from.id)];
      if (p) { normNotify(p).on = false; saveDB(); }
      bot.answerCallbackQuery(q.id, { text: '🔕 Напоминания выключены. Включить снова можно в настройках игры.', show_alert: true }).catch(() => {});
    });
  }

  /* ============================================================
     3. ПОДЕЛИТЬСЯ: картинка-карточка → подготовленное сообщение Telegram
     ============================================================ */
  const SHARE_DIR = path.join(DATA_DIR, 'share');
  try { fs.mkdirSync(SHARE_DIR, { recursive: true }); } catch (e) { /* noop */ }
  const shareRate = {};
  app.get('/share/:file', (req, res) => {
    const f = String(req.params.file);
    if (!/^[a-f0-9]{20}\.jpg$/.test(f)) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(SHARE_DIR, f), (err) => { if (err) res.status(404).end(); });
  });
  async function tgCall(method, params) {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'Telegram API error');
    return j.result;
  }
  app.post('/api/share/prepare', requireUser, async (req, res) => {
    const p = players[String(req.user.id)];
    if (!p || p.isBanned) return fail(res, 403, 'Недоступно');
    const h = Math.floor(now() / HOUR);
    const rl = shareRate[p.id] && shareRate[p.id].h === h ? shareRate[p.id] : (shareRate[p.id] = { h, n: 0 });
    if (++rl.n > 20) return fail(res, 429, 'Слишком часто, попробуйте позже');
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ''));
    if (!m) return fail(res, 400, 'Нет картинки');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 1500000 || buf[0] !== 0xff || buf[1] !== 0xd8) return fail(res, 400, 'Неверная картинка');
    const id = crypto.randomBytes(10).toString('hex');
    fs.writeFileSync(path.join(SHARE_DIR, id + '.jpg'), buf);
    const url = `${WEBAPP_URL}/share/${id}.jpg`;
    const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${p.id}`;
    const caption = String(req.body.caption || '').slice(0, 900);
    const d = dayKey(); bump(an.events[d] || (an.events[d] = {}), 'share_prepared'); saveAn();
    if (!BOT_TOKEN) return res.json({ success: true, url, refLink, dev: true });
    try {
      const pm = await tgCall('savePreparedInlineMessage', {
        user_id: Number(p.id),
        result: { type: 'photo', id, photo_url: url, thumbnail_url: url, caption, reply_markup: { inline_keyboard: [[{ text: '🎮 Играть в Fruit Blitz', url: refLink }]] } },
        allow_user_chats: true, allow_bot_chats: true, allow_group_chats: true, allow_channel_chats: true
      });
      res.json({ success: true, url, refLink, preparedId: pm.id });
    } catch (e) {
      console.error('savePreparedInlineMessage:', e.message);
      res.json({ success: true, url, refLink }); // клиент поделится ссылкой или историей
    }
  });
  // Удаляем карточки старше 3 дней
  function cleanShare() {
    try {
      const cut = now() - 3 * DAY;
      fs.readdirSync(SHARE_DIR).forEach((f) => { const fp = path.join(SHARE_DIR, f); if (fs.statSync(fp).mtimeMs < cut) fs.unlinkSync(fp); });
    } catch (e) { /* noop */ }
  }
  setInterval(cleanShare, 6 * HOUR);
  cleanShare();

  console.log(`   Рост: аналитика с ${dayKey(an.since)}, напоминания ${settings.remindersEnabled !== false ? 'вкл' : 'выкл'}`);
  return { touch, ingest, normNotify, flush: () => writeJSON(AN_FILE, an), _tick: reminderTick };
};
