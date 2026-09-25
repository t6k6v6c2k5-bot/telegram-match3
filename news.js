/* ==========================================================
   FRUIT BLITZ — посты в канал с новостями
   • changelog.js — список обновлений (новые сверху). После деплоя бот
     присылает админам готовый пост на проверку с кнопками
     «✅ Опубликовать» / «🚫 Пропустить» (или публикует сам — режим auto).
   • Админка → вкладка 📢: публикация обновлений и своих постов с картинкой.
   ВАЖНО: бот должен быть администратором канала с правом «Публикация сообщений».
   ========================================================== */
const fs = require('fs');
const path = require('path');

module.exports = function attachNews(ctx) {
  const { app, requireAdmin, BOT_TOKEN, BOT_USERNAME, getBot, settings, saveSettings, ADMIN_IDS } = ctx;
  const CHANNEL = process.env.NEWS_CHANNEL || '@fruitblitz_news';
  const GAME_LINK = process.env.GAME_LINK || `https://t.me/${BOT_USERNAME}?start=news`;
  const TG_BASE = process.env.TG_API_BASE || 'https://api.telegram.org';
  const fail = (res, code, error) => res.status(code).json({ success: false, error });
  const now = () => Date.now();

  if (!settings.news || typeof settings.news !== 'object') settings.news = {};
  const N = settings.news;
  N.mode = ['preview', 'auto', 'off'].includes(N.mode) ? N.mode : 'preview';
  N.posted = N.posted || {};   // id → { at, msgId }
  N.offered = N.offered || {}; // id → at (превью отправлено админам)
  N.skipped = N.skipped || {};
  N.history = Array.isArray(N.history) ? N.history : [];

  function releases() {
    try { delete require.cache[require.resolve('./changelog.js')]; return require('./changelog.js'); } catch (e) { return []; }
  }
  const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Красивый текст поста. В changelog.js можно использовать <b>, <i> — остальное экранируется.
  const rich = (s) => escHtml(s).replace(/&lt;(\/?)(b|i|u)&gt;/g, '<$1$2>');
  function formatRelease(r) {
    let t = `${r.emoji || '🎉'} <b>${rich(r.title)}</b>\n`;
    if (r.version) t += `<i>Версия ${escHtml(r.version)}</i>\n`;
    if (r.intro) t += `\n${rich(r.intro)}\n`;
    (r.sections || []).forEach((sec) => {
      t += `\n<b>${escHtml(sec.icon || '✨')} ${rich(sec.title)}</b>\n`;
      (sec.items || []).forEach((it) => { t += `▫️ ${rich(it)}\n`; });
    });
    if (r.outro) t += `\n${rich(r.outro)}\n`;
    t += `\n#обновление`;
    return t;
  }
  const buttons = (extra) => ({ inline_keyboard: [[{ text: '🎮 Играть', url: GAME_LINK }]].concat(extra || []) });

  async function tgCall(method, params) {
    const r = await fetch(`${TG_BASE}/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'Telegram API error');
    return j.result;
  }
  async function sendPhotoBuf(chatId, buf, caption, markup) {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    fd.append('photo', new Blob([buf], { type: 'image/jpeg' }), 'news.jpg');
    if (caption) { fd.append('caption', caption); fd.append('parse_mode', 'HTML'); }
    if (markup) fd.append('reply_markup', JSON.stringify(markup));
    const r = await fetch(`${TG_BASE}/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'sendPhoto error');
    return j.result;
  }
  // Пост: картинка + текст. Подпись к фото ограничена 1024 символами —
  // если текст длиннее, картинка идёт отдельным сообщением перед текстом.
  async function sendPost(chatId, text, imgBuf, markup) {
    if (!BOT_TOKEN) return { message_id: 0, dev: true };
    if (imgBuf) {
      if (text.length <= 1000) return sendPhotoBuf(chatId, imgBuf, text, markup);
      await sendPhotoBuf(chatId, imgBuf, null, null);
    }
    return tgCall('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: markup });
  }
  function bannerOf(r) {
    if (!r.banner || !/^[\w./-]+\.jpg$/.test(r.banner) || r.banner.includes('..')) return null;
    try { return fs.readFileSync(path.join(__dirname, 'public', r.banner)); } catch (e) { return null; }
  }
  async function publishRelease(id) {
    const r = releases().find((x) => x.id === id);
    if (!r) throw new Error('Обновление не найдено в changelog.js');
    if (N.posted[id]) throw new Error('Уже опубликовано');
    const m = await sendPost(CHANNEL, formatRelease(r), bannerOf(r), buttons());
    N.posted[id] = { at: now(), msgId: m.message_id };
    N.history.unshift({ at: now(), kind: 'release', id, title: r.title, msgId: m.message_id });
    N.history = N.history.slice(0, 30);
    saveSettings();
    return m;
  }
  async function previewRelease(id, toIds) {
    const r = releases().find((x) => x.id === id);
    if (!r) throw new Error('Обновление не найдено');
    const text = '👀 <b>Предпросмотр поста для канала</b>\n\n' + formatRelease(r);
    const kb = buttons([[{ text: '✅ Опубликовать в канал', callback_data: 'news_pub:' + id }, { text: '🚫 Пропустить', callback_data: 'news_skip:' + id }]]);
    for (const uid of toIds) await sendPost(uid, text, bannerOf(r), kb).catch((e) => console.error('Превью новости:', e.message));
  }

  // После деплоя: самое новое обновление, о котором ещё не писали
  async function onDeploy() {
    const list = releases();
    const r = list[0];
    if (!r || N.posted[r.id] || N.skipped[r.id] || N.mode === 'off' || !BOT_TOKEN) return;
    try {
      if (N.mode === 'auto') { await publishRelease(r.id); console.log('   Новости: опубликовано обновление', r.id); }
      else if (!N.offered[r.id]) {
        await previewRelease(r.id, ADMIN_IDS);
        N.offered[r.id] = now(); saveSettings();
        console.log('   Новости: предпросмотр отправлен админам —', r.id);
      }
    } catch (e) { console.error('Новости:', e.message); }
  }
  setTimeout(onDeploy, 20000);

  const bot = getBot();
  if (bot) {
    bot.on('callback_query', async (q) => {
      const m = /^news_(pub|skip):(.+)$/.exec(q.data || '');
      if (!m) return;
      if (!ADMIN_IDS.includes(String(q.from.id))) return bot.answerCallbackQuery(q.id, { text: 'Доступ запрещён', show_alert: true }).catch(() => {});
      try {
        if (m[1] === 'pub') { await publishRelease(m[2]); await bot.answerCallbackQuery(q.id, { text: '✅ Опубликовано в канале!', show_alert: true }); }
        else { N.skipped[m[2]] = now(); saveSettings(); await bot.answerCallbackQuery(q.id, { text: 'Пропущено. Опубликовать можно из админки → 📢' }); }
        bot.editMessageReplyMarkup(buttons(), { chat_id: q.message.chat.id, message_id: q.message.message_id }).catch(() => {});
      } catch (e) { bot.answerCallbackQuery(q.id, { text: '⚠️ ' + e.message, show_alert: true }).catch(() => {}); }
    });
  }

  /* ---------------- Админка ---------------- */
  app.get('/api/admin/news', requireAdmin, (req, res) => {
    res.json({ success: true, channel: CHANNEL, mode: N.mode, gameLink: GAME_LINK,
      releases: releases().map((r) => ({ id: r.id, version: r.version, title: r.title, emoji: r.emoji, date: r.date, banner: !!bannerOf(r),
        posted: N.posted[r.id] || null, skipped: !!N.skipped[r.id], text: formatRelease(r) })),
      history: N.history });
  });
  app.post('/api/admin/news/mode', requireAdmin, (req, res) => {
    if (!['preview', 'auto', 'off'].includes(req.body.mode)) return fail(res, 400, 'Неверный режим');
    N.mode = req.body.mode; saveSettings();
    res.json({ success: true, mode: N.mode });
  });
  app.post('/api/admin/news/release', requireAdmin, async (req, res) => {
    const id = String(req.body.id || '');
    try {
      if (req.body.preview) { await previewRelease(id, [String(req.user.id)]); return res.json({ success: true, preview: true }); }
      const m = await publishRelease(id);
      res.json({ success: true, msgId: m.message_id });
    } catch (e) { fail(res, 400, e.message); }
  });
  function imgFromBody(b) {
    if (!b.image) return null;
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image));
    if (!m) throw new Error('Картинка должна быть JPEG');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 4000000) throw new Error('Картинка слишком большая');
    return buf;
  }
  app.post('/api/admin/news/post', requireAdmin, async (req, res) => {
    const text = String(req.body.text || '').trim();
    if (!text) return fail(res, 400, 'Пустой текст');
    if (text.length > 4000) return fail(res, 400, 'Слишком длинный текст (максимум 4000 символов)');
    try {
      const img = imgFromBody(req.body);
      const markup = req.body.withButton === false ? undefined : buttons();
      if (req.body.preview) { await sendPost(String(req.user.id), '👀 <b>Предпросмотр</b>\n\n' + text, img, markup); return res.json({ success: true, preview: true }); }
      const m = await sendPost(CHANNEL, text, img, markup);
      N.history.unshift({ at: now(), kind: 'post', title: text.replace(/<[^>]+>/g, '').slice(0, 60), msgId: m.message_id });
      N.history = N.history.slice(0, 30);
      saveSettings();
      res.json({ success: true, msgId: m.message_id });
    } catch (e) { fail(res, 400, 'Telegram: ' + e.message); }
  });
  app.post('/api/admin/news/check', requireAdmin, async (req, res) => {
    if (!BOT_TOKEN) return res.json({ success: true, ok: false, error: 'BOT_TOKEN не задан' });
    try {
      const me = await tgCall('getMe', {});
      const m = await tgCall('getChatMember', { chat_id: CHANNEL, user_id: me.id });
      const ok = m.status === 'creator' || (m.status === 'administrator' && m.can_post_messages !== false);
      res.json({ success: true, ok, status: m.status, error: ok ? null : 'Нет права «Публикация сообщений»' });
    } catch (e) { res.json({ success: true, ok: false, error: e.message }); }
  });

  const pending = releases().filter((r) => !N.posted[r.id]).length;
  console.log(`   Новости: канал ${CHANNEL}, режим ${N.mode}, неопубликованных обновлений: ${pending}`);
  return { formatRelease, publishRelease };
};
