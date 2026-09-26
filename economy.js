/* =====================================================================
   FRUIT BLITZ — экономика: предметы, маркет, обмены, Telegram Stars
   ---------------------------------------------------------------------
   Главные принципы:
   • Предметы и самоцветы 💠 живут ТОЛЬКО на сервере — клиент не может их «нарисовать».
   • Предмет выпадает только после того, как сервер сам переиграл уровень по журналу
     ходов (тот же движок engine.js, тот же seed) и убедился, что цель выполнена.
   • Цены на маркете назначают игроки. Сервер берёт комиссию (она сгорает — это
     защищает экономику от инфляции).
   • Самоцветы покупаются за Telegram Stars и НЕ выводятся обратно в деньги.
   ===================================================================== */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Items = require('./public/items.js');
const E = require('./public/engine.js');

const envNum = (k, d) => { const v = Number(process.env[k]); return isFinite(v) && process.env[k] !== undefined && process.env[k] !== '' ? v : d; };

module.exports = function attachEconomy(ctx) {
  const { app, requireUser, requireAdmin, getOrCreatePlayer, players, saveDB, writeJSON, loadJSON, DATA_DIR, BOT_TOKEN, WEBAPP_URL, getBot, DEV_TRUST_IDS } = ctx;

  const CFG = {
    lockHours: envNum('MARKET_LOCK_HOURS', 24),   // «трейд-бан» новых предметов, как 7 дней в Steam
    fee: envNum('MARKET_FEE', 0.10),               // комиссия маркета (сгорает)
    minWins: envNum('MARKET_MIN_WINS', 5),         // сколько проверенных побед нужно для торговли (анти-бот)
    dailyRolls: envNum('DAILY_DROP_ROLLS', 40),    // сколько уровней в сутки участвуют в розыгрыше дропа
    maxListings: 50,
    maxPrice: 10000000
  };
  const ECO_FILE = path.join(DATA_DIR, 'economy.json');
  const BACKUP_DIR = path.join(DATA_DIR, 'backups');
  const eco = Object.assign({ serials: {}, items: {}, listings: {}, sales: {}, trades: {}, payments: [], rolls: {}, once: {}, burned: 0, nextListing: 1, nextTrade: 1 }, loadJSON(ECO_FILE, {}));

  // Индекс «владелец → предметы»
  const byOwner = new Map();
  const ownerSet = (uid) => { if (!byOwner.has(uid)) byOwner.set(uid, new Set()); return byOwner.get(uid); };
  Object.values(eco.items).forEach((it) => ownerSet(it.owner).add(it.uid));

  let ecoTimer = null, lastEcoBackup = 0;
  function saveEco() {
    clearTimeout(ecoTimer);
    ecoTimer = setTimeout(flush, 300);
  }
  function flush() {
    clearTimeout(ecoTimer);
    if (Date.now() - lastEcoBackup > 10 * 60 * 1000 && fs.existsSync(ECO_FILE)) {
      lastEcoBackup = Date.now();
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(ECO_FILE, path.join(BACKUP_DIR, `economy_${stamp}.json`));
        const list = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('economy_')).sort();
        while (list.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, list.shift()));
      } catch (e) { console.warn('Бэкап экономики не создан:', e.message); }
    }
    writeJSON(ECO_FILE, eco);
  }

  /* ---------------- Игрок ---------------- */
  function ecoPlayer(id, extra) {
    const p = getOrCreatePlayer(id, extra);
    if (typeof p.shards !== 'number' || !isFinite(p.shards)) p.shards = 0;
    p.shards = Math.max(0, Math.floor(p.shards));
    p.vipUntil = p.vipUntil || 0;
    p.passSeason = p.passSeason || 0;
    if (!Array.isArray(p.grants)) p.grants = [];
    if (!p.equip || typeof p.equip !== 'object') p.equip = {};
    p.verifiedWins = p.verifiedWins || 0;
    return p;
  }
  const now = () => Date.now();
  const rnd = () => crypto.randomInt(0, 1000000000) / 1000000000;
  const newUid = () => crypto.randomBytes(6).toString('hex');
  const isLocked = (it) => (it.lockUntil || 0) > now();
  const shortName = (p) => (p ? String(p.name || 'Игрок').split(' ')[0].slice(0, 20) : 'Игрок');
  // для HTML-сообщений бота: «<» или «&» в имени иначе ломают всё сообщение
  const shortNameH = (p) => shortName(p).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function createItem(itemId, owner, o) {
    o = o || {};
    const def = Items.BY_ID[itemId];
    if (!def) throw new Error('unknown item ' + itemId);
    eco.serials[itemId] = (eco.serials[itemId] || 0) + 1;
    const it = {
      uid: newUid(), itemId, owner: String(owner), serial: eco.serials[itemId],
      q: Math.round((o.q != null ? o.q : rnd()) * 100000) / 100000,
      shiny: !!o.shiny, counter: 0, createdAt: now(), source: o.source || 'drop',
      lockUntil: now() + (o.lockHours != null ? o.lockHours : CFG.lockHours) * 3600000
    };
    eco.items[it.uid] = it;
    ownerSet(it.owner).add(it.uid);
    saveEco();
    return it;
  }
  function unequipEverywhere(it) {
    const p = players[it.owner];
    if (!p || !p.equip) return;
    Object.keys(p.equip).forEach((slot) => { if (p.equip[slot] === it.uid) delete p.equip[slot]; });
  }
  function transfer(it, to) {
    unequipEverywhere(it);
    ownerSet(it.owner).delete(it.uid);
    it.owner = String(to);
    it.lockUntil = now() + CFG.lockHours * 3600000;
    ownerSet(it.owner).add(it.uid);
  }
  function destroyItem(it) {
    unequipEverywhere(it);
    ownerSet(it.owner).delete(it.uid);
    delete eco.items[it.uid];
  }
  function view(it) {
    return { uid: it.uid, itemId: it.itemId, serial: it.serial, q: it.q, shiny: it.shiny, counter: it.counter, lockUntil: it.lockUntil, listing: it.listing || null, createdAt: it.createdAt };
  }
  const inventoryOf = (uid) => Array.from(byOwner.get(String(uid)) || []).map((k) => eco.items[k]).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  function equippedView(p) {
    const out = {};
    Object.keys(p.equip || {}).forEach((slot) => { const it = eco.items[p.equip[slot]]; if (it && it.owner === p.id) out[slot] = view(it); else delete p.equip[slot]; });
    return out;
  }
  function badgeOf(pid) {
    const p = players[pid];
    if (!p || !p.equip || !p.equip.badge) return (p && p.vipUntil > now()) ? '👑' : null;
    const it = eco.items[p.equip.badge];
    return it && it.owner === pid ? Items.BY_ID[it.itemId].data : null;
  }

  function median(arr) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }
  function priceStats(itemId) {
    const sales = eco.sales[itemId] || [];
    const recent = sales.slice(-20).map((s) => s.p);
    const day = sales.filter((s) => s.at > now() - 86400000);
    const lst = Object.values(eco.listings).filter((l) => l.itemId === itemId);
    return { itemId, listings: lst.length, min: lst.length ? Math.min.apply(null, lst.map((l) => l.price)) : null, median: median(recent), last: sales.length ? sales[sales.length - 1].p : null, sold24h: day.length, volume24h: day.reduce((a, s) => a + s.p, 0) };
  }
  const fail = (res, code, error) => res.status(code).json({ success: false, error });
  function canTrade(p) { return (p.verifiedWins || 0) >= CFG.minWins; }

  /* ---------------- Бот и Telegram API ---------------- */
  async function tgApi(method, params) {
    if (!BOT_TOKEN) throw new Error('BOT_TOKEN не задан');
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'Telegram API error');
    return j.result;
  }
  function notify(uid, text) {
    const bot = getBot();
    if (!bot) return;
    bot.sendMessage(uid, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть игру', web_app: { url: WEBAPP_URL } }]] } }).catch(() => {});
  }
  const itemTitle = (it) => { const d = Items.BY_ID[it.itemId]; return `${it.shiny ? '✨ ' : ''}${d.name} #${it.serial}`; };

  /* ============================================================
     1. ПРОВЕРЕННЫЕ УРОВНИ И ДРОП
     ============================================================ */
  const runs = new Map();
  setInterval(() => { const t = now() - 3 * 3600000; runs.forEach((r, k) => { if (r.at < t) runs.delete(k); }); }, 10 * 60000).unref();

  app.post('/api/level/start', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    if (p.isBanned) return fail(res, 403, 'Аккаунт заблокирован');
    const level = Math.floor(Number(req.body.level));
    if (!(level >= 1 && level <= 100000)) return fail(res, 400, 'Неверный уровень');
    const pre = Array.isArray(req.body.pre) ? req.body.pre.filter((k) => ['rocket', 'bomb', 'rainbow'].includes(k)).slice(0, 3) : [];
    // У игрока одновременно живёт не больше 3 забегов
    const mine = Array.from(runs.entries()).filter(([, r]) => r.uid === p.id).sort((a, b) => a[1].at - b[1].at);
    while (mine.length >= 3) runs.delete(mine.shift()[0]);
    const runId = newUid(), seed = crypto.randomInt(1, 2147483647);
    runs.set(runId, { uid: p.id, level, seed, pre, at: now() });
    res.json({ success: true, runId, seed });
  });

  function replay(run, log) {
    const cfg = E.levelConfig(run.level);
    const st = E.createBoard(cfg, { seed: run.seed, preBoosters: run.pre });
    const P = (a) => ({ r: a[0] | 0, c: a[1] | 0 });
    for (const a of log) {
      let r = null;
      if (a.k === 's') r = E.trySwap(st, P(a.a), P(a.b));
      else if (a.k === 't') r = E.activateSpecial(st, a.r | 0, a.c | 0);
      else if (a.k === 'b' && ['hammer', 'shuffle', 'rocket', 'bomb', 'rainbow'].includes(a.b)) r = E.useBooster(st, a.b, a.r | 0, a.c | 0);
      if (!r || !r.valid) return { ok: false, reason: 'invalid_move' };
    }
    if (!E.isComplete(st)) return { ok: false, reason: 'not_complete' };
    return { ok: true, st, cfg };
  }

  app.post('/api/level/finish', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    if (p.isBanned) return fail(res, 403, 'Аккаунт заблокирован');
    const run = runs.get(String(req.body.runId || ''));
    if (!run || run.uid !== p.id) return fail(res, 404, 'Забег не найден');
    runs.delete(String(req.body.runId));
    const log = Array.isArray(req.body.log) ? req.body.log.slice(0, 3000) : [];
    const minMs = 1500 + log.length * 350; // физически невозможно играть быстрее
    if (now() - run.at < minMs) return fail(res, 400, 'Слишком быстро');
    let r;
    try { r = replay(run, log); } catch (e) { r = { ok: false, reason: 'error' }; }
    if (!r.ok) return res.json({ success: true, verified: false, reason: r.reason });

    p.verifiedWins++;
    // Счётчик «Сияющего» скина: считаем собранные фрукты
    if (p.equip.skin && eco.items[p.equip.skin] && eco.items[p.equip.skin].shiny) eco.items[p.equip.skin].counter += r.st.stats.cleared || 0;
    // Розыгрыш дропа с дневным лимитом
    const day = new Date().toISOString().slice(0, 10);
    const rl = eco.rolls[p.id] && eco.rolls[p.id].day === day ? eco.rolls[p.id] : (eco.rolls[p.id] = { day, n: 0 });
    let drop = null;
    if (rl.n < CFG.dailyRolls) {
      rl.n++;
      const rarity = Items.rollRarity(rnd, r.cfg.hard ? 2 : 1);
      if (rarity >= 0) {
        const pool = Items.dropPool(rarity);
        const def = pool[crypto.randomInt(0, pool.length)];
        const it = createItem(def.id, p.id, { shiny: rnd() < Items.SHINY_CHANCE, source: 'drop' });
        drop = view(it);
        feedItem(it, 'drop', { level: run.level });
      }
    }
    saveEco(); saveDB();
    res.json({ success: true, verified: true, drop, rollsLeft: Math.max(0, CFG.dailyRolls - rl.n) });
  });

  /* ============================================================
     2. ИНВЕНТАРЬ, ЭКИПИРОВКА, ГРАНТЫ
     ============================================================ */
  function meView(p) {
    const inv = inventoryOf(p.id).map(view);
    const trades = Object.values(eco.trades).filter((t) => (t.from === p.id || t.to === p.id) && (t.status === 'pending' || t.at > now() - 7 * 86400000)).sort((a, b) => b.at - a.at).slice(0, 40).map(tradeView);
    const day = new Date().toISOString().slice(0, 10);
    const rl = eco.rolls[p.id] && eco.rolls[p.id].day === day ? eco.rolls[p.id].n : 0;
    return {
      shards: p.shards, vipUntil: p.vipUntil, passSeason: p.passSeason, equip: equippedView(p), inventory: inv, trades, grants: p.grants,
      myListings: Object.values(eco.listings).filter((l) => l.seller === p.id).map((l) => Object.assign({}, l, { item: view(eco.items[l.uid]) })),
      verifiedWins: p.verifiedWins, rollsLeft: Math.max(0, CFG.dailyRolls - rl),
      cfg: { lockHours: CFG.lockHours, fee: CFG.fee, minWins: CFG.minWins, dailyRolls: CFG.dailyRolls },
      once: Items.STARS_PRODUCTS.filter((x) => x.once && eco.once[p.id + ':' + x.id]).map((x) => x.id),
      soldOut: Items.ITEMS.filter((it) => it.limit && (eco.serials[it.id] || 0) >= it.limit).map((it) => it.id),
      minted: Object.assign({}, eco.serials)
    };
  }
  app.get('/api/eco/me', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    res.json(Object.assign({ success: true }, meView(p)));
  });
  app.post('/api/eco/grants/ack', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    const ids = new Set((req.body.ids || []).map(String));
    p.grants = p.grants.filter((g) => !ids.has(g.id));
    saveDB();
    res.json({ success: true });
  });
  app.post('/api/eco/equip', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    const slot = String(req.body.slot || '');
    if (!Items.TYPES[slot]) return fail(res, 400, 'Неверный слот');
    if (!req.body.uid) { delete p.equip[slot]; saveDB(); return res.json({ success: true, equip: equippedView(p) }); }
    const it = eco.items[String(req.body.uid)];
    if (!it || it.owner !== p.id) return fail(res, 404, 'Предмет не найден');
    if (Items.BY_ID[it.itemId].type !== slot) return fail(res, 400, 'Не подходит в этот слот');
    if (it.listing) return fail(res, 400, 'Предмет выставлен на маркет');
    p.equip[slot] = it.uid;
    saveDB();
    res.json({ success: true, equip: equippedView(p) });
  });
  // Чужой инвентарь (для предложения обмена) — как публичный инвентарь Steam
  function findPlayer(q) {
    q = String(q || '').trim().replace(/^@/, '');
    if (!q) return null;
    if (players[q]) return players[q];
    const lq = q.toLowerCase();
    return Object.values(players).find((p) => (p.username || '').toLowerCase() === lq) || null;
  }
  app.get('/api/eco/inventory/:who', requireUser, (req, res) => {
    const t = findPlayer(req.params.who);
    if (!t || t.isBanned) return fail(res, 404, 'Игрок не найден');
    res.json({ success: true, player: { id: t.id, name: t.name, username: t.username, badge: badgeOf(t.id) }, inventory: inventoryOf(t.id).filter((it) => !it.listing).map(view) });
  });

  /* ---------------- Контракт обмена: 10 одинаковой редкости → 1 выше ---------------- */
  app.post('/api/eco/tradeup', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    const uids = Array.from(new Set((req.body.uids || []).map(String)));
    if (uids.length !== 10) return fail(res, 400, 'Нужно ровно 10 предметов');
    const its = uids.map((u) => eco.items[u]);
    if (its.some((it) => !it || it.owner !== p.id)) return fail(res, 400, 'Не все предметы ваши');
    if (its.some((it) => it.listing)) return fail(res, 400, 'Снимите предметы с маркета');
    const r = Items.BY_ID[its[0].itemId].r;
    if (its.some((it) => Items.BY_ID[it.itemId].r !== r)) return fail(res, 400, 'Все предметы должны быть одной редкости');
    if (r >= 5) return fail(res, 400, 'Эту редкость нельзя улучшить');
    const pool = Items.dropPool(r + 1);
    const def = pool[crypto.randomInt(0, pool.length)];
    const q = its.reduce((a, it) => a + it.q, 0) / its.length;
    const shinyCount = its.filter((it) => it.shiny).length;
    its.forEach(destroyItem);
    const out = createItem(def.id, p.id, { q, shiny: shinyCount >= 5 || rnd() < shinyCount * 0.02, source: 'tradeup' });
    feedItem(out, 'tradeup');
    saveEco(); saveDB();
    res.json({ success: true, item: view(out) });
  });

  /* ============================================================
     3. МАРКЕТ (цены задают игроки)
     ============================================================ */
  app.get('/api/market/summary', (req, res) => {
    const ids = new Set(Object.values(eco.listings).map((l) => l.itemId));
    Object.keys(eco.sales).forEach((k) => ids.add(k));
    const stats = {};
    ids.forEach((id) => { stats[id] = priceStats(id); });
    res.json({ success: true, stats, minted: eco.serials, fee: CFG.fee });
  });
  app.get('/api/market/item/:itemId', (req, res) => {
    const id = String(req.params.itemId);
    if (!Items.BY_ID[id]) return fail(res, 404, 'Нет такого предмета');
    const listings = Object.values(eco.listings).filter((l) => l.itemId === id).sort((a, b) => a.price - b.price || a.createdAt - b.createdAt).slice(0, 60)
      .map((l) => ({ id: l.id, price: l.price, seller: l.seller, sellerName: shortName(players[l.seller]), item: view(eco.items[l.uid]) }));
    res.json({ success: true, stats: priceStats(id), listings, history: (eco.sales[id] || []).slice(-60), minted: eco.serials[id] || 0 });
  });
  app.post('/api/market/list', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    if (p.isBanned) return fail(res, 403, 'Аккаунт заблокирован');
    if (!canTrade(p)) return fail(res, 403, `Торговля откроется после ${CFG.minWins} пройденных уровней (сейчас ${p.verifiedWins})`);
    const it = eco.items[String(req.body.uid || '')];
    const price = Math.floor(Number(req.body.price));
    if (!it || it.owner !== p.id) return fail(res, 404, 'Предмет не найден');
    if (it.listing) return fail(res, 400, 'Уже на маркете');
    if (isLocked(it)) return fail(res, 400, 'Предмет пока нельзя продать (защита от мошенников)');
    if (!(price >= 1 && price <= CFG.maxPrice)) return fail(res, 400, 'Цена от 1 до 10 000 000 💠');
    if (Object.values(eco.listings).filter((l) => l.seller === p.id).length >= CFG.maxListings) return fail(res, 400, 'Не больше 50 лотов одновременно');
    unequipEverywhere(it);
    const l = { id: String(eco.nextListing++), uid: it.uid, itemId: it.itemId, seller: p.id, price, createdAt: now() };
    eco.listings[l.id] = l; it.listing = l.id;
    saveEco(); saveDB();
    res.json({ success: true, listing: l });
  });
  app.post('/api/market/cancel', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    const l = eco.listings[String(req.body.listingId || '')];
    if (!l || l.seller !== p.id) return fail(res, 404, 'Лот не найден');
    delete eco.listings[l.id];
    if (eco.items[l.uid]) delete eco.items[l.uid].listing;
    saveEco();
    res.json({ success: true });
  });
  app.post('/api/market/buy', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    if (p.isBanned) return fail(res, 403, 'Аккаунт заблокирован');
    const l = eco.listings[String(req.body.listingId || '')];
    if (!l) return fail(res, 404, 'Лот уже продан или снят');
    if (l.seller === p.id) return fail(res, 400, 'Это ваш лот');
    if (req.body.expectPrice != null && Number(req.body.expectPrice) !== l.price) return fail(res, 409, 'Цена изменилась');
    if (p.shards < l.price) return fail(res, 400, 'Не хватает самоцветов 💠');
    const it = eco.items[l.uid];
    const seller = ecoPlayer(l.seller);
    const fee = l.price >= 2 ? Math.max(1, Math.floor(l.price * CFG.fee)) : 0;
    p.shards -= l.price;
    seller.shards += l.price - fee;
    eco.burned += fee;
    delete eco.listings[l.id];
    delete it.listing;
    transfer(it, p.id);
    (eco.sales[l.itemId] = eco.sales[l.itemId] || []).push({ p: l.price, at: now() });
    if (eco.sales[l.itemId].length > 200) eco.sales[l.itemId] = eco.sales[l.itemId].slice(-200);
    if (l.price >= 1000) feedItem(it, 'sale', { price: l.price });
    saveEco(); saveDB();
    notify(seller.id, `💰 Продано на маркете: <b>${itemTitle(it)}</b> за ${l.price} 💠\nВам зачислено ${l.price - fee} 💠 (комиссия ${fee}).`);
    res.json({ success: true, item: view(it), shards: p.shards });
  });

  /* ============================================================
     4. ПРЯМЫЕ ОБМЕНЫ МЕЖДУ ИГРОКАМИ
     ============================================================ */
  function tradeView(t) {
    const iv = (u) => (eco.items[u] ? view(eco.items[u]) : { uid: u, gone: true });
    return { id: t.id, from: t.from, fromName: shortName(players[t.from]), to: t.to, toName: shortName(players[t.to]), give: t.give.map(iv), giveShards: t.giveShards, want: t.want.map(iv), wantShards: t.wantShards, status: t.status, at: t.at, msg: t.msg };
  }
  function checkSide(ownerId, uids) {
    for (const u of uids) {
      const it = eco.items[u];
      if (!it || it.owner !== ownerId) return 'Часть предметов больше не принадлежит владельцу';
      if (it.listing) return 'Один из предметов выставлен на маркет';
      if (isLocked(it)) return 'Один из предметов ещё под защитой от обмена';
    }
    return null;
  }
  app.post('/api/trade/offer', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    if (p.isBanned) return fail(res, 403, 'Аккаунт заблокирован');
    if (!canTrade(p)) return fail(res, 403, `Обмены откроются после ${CFG.minWins} пройденных уровней`);
    const t = findPlayer(req.body.to);
    if (!t || t.isBanned) return fail(res, 404, 'Игрок не найден');
    if (t.id === p.id) return fail(res, 400, 'Нельзя обмениваться с собой');
    const give = Array.from(new Set((req.body.give || []).map(String))).slice(0, 20);
    const want = Array.from(new Set((req.body.want || []).map(String))).slice(0, 20);
    const giveShards = Math.max(0, Math.floor(Number(req.body.giveShards) || 0));
    const wantShards = Math.max(0, Math.floor(Number(req.body.wantShards) || 0));
    if (!give.length && !want.length && !giveShards && !wantShards) return fail(res, 400, 'Пустое предложение');
    const e1 = checkSide(p.id, give) || checkSide(t.id, want);
    if (e1) return fail(res, 400, e1);
    if (p.shards < giveShards) return fail(res, 400, 'Не хватает самоцветов');
    if (Object.values(eco.trades).filter((x) => x.from === p.id && x.status === 'pending').length >= 20) return fail(res, 400, 'Слишком много активных предложений');
    const tr = { id: String(eco.nextTrade++), from: p.id, to: t.id, give, want, giveShards, wantShards, status: 'pending', at: now(), msg: String(req.body.msg || '').slice(0, 120) };
    eco.trades[tr.id] = tr;
    saveEco();
    notify(t.id, `🔄 <b>${shortNameH(p)}</b> предлагает вам обмен в Fruit Blitz!\nОтдаёт: ${give.length} предм.${giveShards ? ' + ' + giveShards + ' 💠' : ''}\nПросит: ${want.length} предм.${wantShards ? ' + ' + wantShards + ' 💠' : ''}`);
    res.json({ success: true, trade: tradeView(tr) });
  });
  app.post('/api/trade/respond', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    const tr = eco.trades[String(req.body.id || '')];
    if (!tr || tr.status !== 'pending') return fail(res, 404, 'Предложение не найдено');
    const action = String(req.body.action || '');
    if (action === 'cancel') { if (tr.from !== p.id) return fail(res, 403, 'Нет доступа'); tr.status = 'canceled'; saveEco(); return res.json({ success: true, trade: tradeView(tr) }); }
    if (tr.to !== p.id) return fail(res, 403, 'Нет доступа');
    if (action === 'decline') { tr.status = 'declined'; saveEco(); notify(tr.from, `❌ ${shortNameH(p)} отклонил(а) ваш обмен.`); return res.json({ success: true, trade: tradeView(tr) }); }
    if (action !== 'accept') return fail(res, 400, 'Неизвестное действие');
    const from = ecoPlayer(tr.from);
    const err = checkSide(from.id, tr.give) || checkSide(p.id, tr.want);
    if (err) { tr.status = 'failed'; saveEco(); return fail(res, 400, err); }
    if (from.shards < tr.giveShards) return fail(res, 400, 'У отправителя не хватает самоцветов');
    if (p.shards < tr.wantShards) return fail(res, 400, 'У вас не хватает самоцветов');
    tr.give.forEach((u) => transfer(eco.items[u], p.id));
    tr.want.forEach((u) => transfer(eco.items[u], from.id));
    from.shards += tr.wantShards - tr.giveShards;
    p.shards += tr.giveShards - tr.wantShards;
    tr.status = 'done'; tr.doneAt = now();
    saveEco(); saveDB();
    notify(from.id, `✅ ${shortNameH(p)} принял(а) ваш обмен!`);
    res.json({ success: true, trade: tradeView(tr) });
  });

  /* ============================================================
     5. TELEGRAM STARS
     ============================================================ */
  const productById = (id) => Items.STARS_PRODUCTS.find((x) => x.id === id);
  function productAvailable(p, prod) {
    if (!prod) return 'Товар не найден';
    if (prod.once && eco.once[p.id + ':' + prod.id]) return 'Этот набор можно купить только один раз';
    if (prod.grant && prod.grant.pass && p.passSeason === Items.seasonInfo().id) return 'Премиум-пропуск на этот сезон уже куплен';
    const itemId = prod.grant && prod.grant.item;
    const def = itemId && Items.BY_ID[itemId];
    if (def && def.limit && (eco.serials[itemId] || 0) >= def.limit && prod.itemId) return 'Все экземпляры распроданы — ищите на маркете';
    return null;
  }
  function fulfill(uid, prod, chargeId, stars) {
    if (chargeId && eco.payments.some((x) => x.chargeId === chargeId)) return false; // повтор — не начисляем дважды
    const p = ecoPlayer(uid);
    const g = prod.grant || {};
    const rec = { id: newUid(), uid: p.id, product: prod.id, stars, chargeId: chargeId || null, at: now(), refunded: false, gave: {} };
    if (g.shards) { p.shards += g.shards; rec.gave.shards = g.shards; }
    if (g.item) {
      const def = Items.BY_ID[g.item];
      if (def.limit && (eco.serials[g.item] || 0) >= def.limit) {
        const comp = stars * 2; p.shards += comp; rec.gave.shards = (rec.gave.shards || 0) + comp; // распродано в последний момент — компенсация
      } else { const it = createItem(g.item, p.id, { source: 'stars', lockHours: 0 }); rec.gave.item = it.uid; feedItem(it, 'excl'); }
    }
    if (g.pass) { p.passSeason = Items.seasonInfo().id; rec.gave.pass = p.passSeason; }
    if (g.vipDays) p.vipUntil = Math.max(now(), p.vipUntil || 0) + g.vipDays * 86400000;
    if (g.soft) p.grants.push({ id: newUid(), rw: g.soft, title: prod.title, at: now() });
    if (prod.once) eco.once[p.id + ':' + prod.id] = true;
    eco.payments.push(rec);
    if (eco.payments.length > 20000) eco.payments = eco.payments.slice(-20000);
    saveEco(); saveDB();
    return true;
  }

  app.post('/api/stars/invoice', requireUser, async (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    if (p.isBanned) return fail(res, 403, 'Аккаунт заблокирован');
    const prod = productById(String(req.body.productId || ''));
    const err = productAvailable(p, prod);
    if (err) return fail(res, 400, err);
    if (!BOT_TOKEN) return res.json({ success: true, dev: true });
    try {
      const payload = `${p.id}:${prod.id}:${crypto.randomBytes(4).toString('hex')}`;
      const link = await tgApi('createInvoiceLink', { title: prod.title.slice(0, 32), description: prod.desc.slice(0, 255), payload, provider_token: '', currency: 'XTR', prices: [{ label: prod.title.slice(0, 32), amount: prod.stars }] });
      res.json({ success: true, link });
    } catch (e) { console.error('createInvoiceLink:', e.message); fail(res, 500, 'Не удалось создать счёт'); }
  });
  // Только для локальной разработки без BOT_TOKEN — имитация успешной оплаты
  app.post('/api/stars/dev-pay', requireUser, (req, res) => {
    if (BOT_TOKEN || !DEV_TRUST_IDS) return fail(res, 403, 'Недоступно');
    const p = ecoPlayer(req.user.id, req.user);
    const prod = productById(String(req.body.productId || ''));
    const err = productAvailable(p, prod);
    if (err) return fail(res, 400, err);
    fulfill(p.id, prod, 'dev_' + newUid(), prod.stars);
    res.json({ success: true });
  });

  const bot = getBot();
  if (bot) {
    bot.on('pre_checkout_query', (q) => {
      const [uid, pid] = String(q.invoice_payload || '').split(':');
      const prod = productById(pid);
      let err = null;
      if (!prod || q.currency !== 'XTR' || q.total_amount !== prod.stars || String(q.from.id) !== uid) err = 'Товар недоступен';
      else err = productAvailable(ecoPlayer(uid), prod);
      if (!err && players[uid] && players[uid].isBanned) err = 'Аккаунт заблокирован';
      tgApi('answerPreCheckoutQuery', err ? { pre_checkout_query_id: q.id, ok: false, error_message: err } : { pre_checkout_query_id: q.id, ok: true }).catch((e) => console.error('preCheckout:', e.message));
    });
    bot.on('message', (msg) => {
      const sp = msg.successful_payment;
      if (!sp) return;
      const [uid, pid] = String(sp.invoice_payload || '').split(':');
      const prod = productById(pid);
      if (!prod) { console.error('Оплата неизвестного товара', sp.invoice_payload); return; }
      if (fulfill(uid, prod, sp.telegram_payment_charge_id, sp.total_amount)) {
        bot.sendMessage(msg.chat.id, `🎉 Спасибо за поддержку! «${prod.title}» зачислено. Откройте игру, чтобы увидеть покупку.`, { reply_markup: { inline_keyboard: [[{ text: '🎮 Открыть игру', web_app: { url: WEBAPP_URL } }]] } }).catch(() => {});
      }
    });
    bot.onText(/^\/paysupport/, (msg) => bot.sendMessage(msg.chat.id, '💬 Поддержка по платежам: опишите проблему ответным сообщением и укажите дату покупки — администратор свяжется с вами. Возврат Stars возможен, если покупка не была получена.').catch(() => {}));
    bot.onText(/^\/terms/, (msg) => bot.sendMessage(msg.chat.id, '📜 Условия: покупки за Telegram Stars — цифровые товары для игры Fruit Blitz. Самоцветы 💠 и предметы не являются деньгами и не подлежат обмену на реальные деньги. Администрация вправе блокировать аккаунты за мошенничество и использование ботов.').catch(() => {}));
  }

  /* ============================================================
     6. АДМИНКА ЭКОНОМИКИ
     ============================================================ */
  app.get('/api/admin/eco', requireAdmin, (req, res) => {
    const pays = eco.payments.filter((x) => !x.refunded);
    const byR = Items.RARITIES.map(() => 0);
    Object.values(eco.items).forEach((it) => { byR[Items.BY_ID[it.itemId] ? Items.BY_ID[it.itemId].r : 0]++; });
    const day = now() - 86400000, month = now() - 30 * 86400000;
    let vol24 = 0, n24 = 0;
    Object.values(eco.sales).forEach((arr) => arr.forEach((s) => { if (s.at > day) { vol24 += s.p; n24++; } }));
    res.json({ success: true, stats: {
      starsTotal: pays.reduce((a, x) => a + x.stars, 0), stars30d: pays.filter((x) => x.at > month).reduce((a, x) => a + x.stars, 0),
      payments: pays.length, items: Object.keys(eco.items).length, byRarity: byR, listings: Object.keys(eco.listings).length,
      sales24h: n24, volume24h: vol24, burned: eco.burned, shardsInGame: Object.values(players).reduce((a, p) => a + (p.shards || 0), 0),
      tradesPending: Object.values(eco.trades).filter((t) => t.status === 'pending').length
    }, recent: eco.payments.slice(-40).reverse().map((x) => Object.assign({}, x, { name: shortName(players[x.uid]) })), cfg: CFG });
  });
  app.post('/api/admin/eco/grant', requireAdmin, (req, res) => {
    const t = findPlayer(req.body.target_id);
    if (!t) return fail(res, 404, 'Игрок не найден');
    const p = ecoPlayer(t.id);
    const shards = Math.floor(Number(req.body.shards) || 0);
    if (shards) p.shards = Math.max(0, p.shards + shards);
    let item = null;
    if (req.body.itemId) {
      if (!Items.BY_ID[req.body.itemId]) return fail(res, 400, 'Нет такого предмета');
      item = view(createItem(String(req.body.itemId), p.id, { source: 'admin', shiny: !!req.body.shiny, lockHours: 0 }));
    }
    saveDB(); saveEco();
    res.json({ success: true, shards: p.shards, item });
  });
  app.post('/api/admin/eco/refund', requireAdmin, async (req, res) => {
    const rec = eco.payments.find((x) => x.id === String(req.body.id || ''));
    if (!rec || rec.refunded) return fail(res, 404, 'Платёж не найден');
    try {
      if (rec.chargeId && !rec.chargeId.startsWith('dev_')) await tgApi('refundStarPayment', { user_id: Number(rec.uid), telegram_payment_charge_id: rec.chargeId });
      const p = ecoPlayer(rec.uid);
      if (rec.gave.shards) p.shards = Math.max(0, p.shards - rec.gave.shards);
      if (rec.gave.item && eco.items[rec.gave.item]) { const it = eco.items[rec.gave.item]; if (it.listing) { delete eco.listings[it.listing]; } destroyItem(it); }
      if (rec.gave.pass && p.passSeason === rec.gave.pass) p.passSeason = 0;
      rec.refunded = true; rec.refundedAt = now();
      saveEco(); saveDB();
      res.json({ success: true });
    } catch (e) { fail(res, 500, 'Telegram: ' + e.message); }
  });
  app.post('/api/admin/eco/delist', requireAdmin, (req, res) => {
    const l = eco.listings[String(req.body.listingId || '')];
    if (!l) return fail(res, 404, 'Лот не найден');
    delete eco.listings[l.id];
    if (eco.items[l.uid]) delete eco.items[l.uid].listing;
    saveEco();
    res.json({ success: true });
  });

  /* ============================================================
     7. СОЦИАЛЬНОЕ: профиль-витрина, лайки, лента событий, рейтинги
     ============================================================ */
  if (!eco.likes || typeof eco.likes !== 'object') eco.likes = {};
  if (!Array.isArray(eco.feed)) eco.feed = [];
  // Оценка предмета: медиана последних продаж на маркете, иначе базовая цена редкости.
  // Свежесть, «Сияющий» и низкий серийный номер повышают ценность — как в CS.
  const RBASE = [10, 30, 100, 400, 1500, 6000, 20000];
  const QMULT = [1.5, 1.2, 1, 0.9, 0.8];
  function valueCtx() { return { med: {} }; }
  function itemValue(it, ctx) {
    const d = Items.BY_ID[it.itemId];
    if (!d) return 0;
    if (!(it.itemId in ctx.med)) ctx.med[it.itemId] = median((eco.sales[it.itemId] || []).slice(-20).map((s) => s.p));
    let v = ctx.med[it.itemId] || RBASE[d.r] || 10;
    const qi = Items.QUALITIES.indexOf(Items.qualityOf(it.q));
    v *= QMULT[qi] != null ? QMULT[qi] : 1;
    if (it.shiny) v *= 2;
    if (it.serial <= 10) v *= 1.5;
    return Math.round(v);
  }
  function collectionOf(uid, ctx) {
    const inv = inventoryOf(uid);
    let value = 0, best = null, bestV = -1;
    inv.forEach((it) => { const v = itemValue(it, ctx); value += v; if (v > bestV) { bestV = v; best = it; } });
    return { value, count: inv.length, best, bestValue: bestV };
  }
  const likesOf = (uid) => Object.keys(eco.likes[uid] || {}).length;

  // Лента событий: редкие дропы, контракты, эксклюзивы, крупные продажи, рубежи уровней
  function pushFeed(uid, kind, data) {
    const p = players[uid];
    if (!p || p.isBanned) return;
    eco.feed.push(Object.assign({ id: newUid(), at: now(), uid: p.id, name: p.name, kind }, data || {}));
    if (eco.feed.length > 150) eco.feed = eco.feed.slice(-150);
    saveEco();
  }
  function feedItem(it, kind, extra) {
    const d = Items.BY_ID[it.itemId];
    if (!d) return;
    if (kind === 'drop' || kind === 'tradeup') { if (!(d.r >= 3 || (it.shiny && d.r >= 2))) return; }
    pushFeed(it.owner, kind, Object.assign({ itemId: it.itemId, serial: it.serial, shiny: it.shiny, r: d.r }, extra || {}));
  }

  // Публичные данные профиля, которые знает только клиент (рамка, звание, сад...)
  const KEY = /^[a-z0-9_]{1,20}$/;
  function ingestPub(p, b) {
    if (!b || typeof b !== 'object') return;
    const n = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    p.pub = {
      frame: KEY.test(b.frame) ? b.frame : 'none', title: KEY.test(b.title) ? b.title : 'novice',
      titleName: String(b.titleName || '').slice(0, 30), titleIcon: String(b.titleIcon || '').slice(0, 8),
      garden: n(b.garden, 9999), pass: n(b.pass, 30), wins: n(b.wins, 1e7), perfects: n(b.perfects, 1e7), combo: n(b.combo, 999), ach: n(b.ach, 999),
      photo: /^https:\/\/t\.me\/i\/userpic\/[\w/.-]{1,200}$/.test(String(b.photo || '')) ? b.photo : null
    };
  }
  function cardOf(p, extra) {
    const pub = p.pub || {};
    const fr = p.equip && p.equip.frame && eco.items[p.equip.frame] && eco.items[p.equip.frame].owner === p.id ? eco.items[p.equip.frame].itemId : null;
    return Object.assign({ id: p.id, name: p.name, username: p.username, badge: badgeOf(p.id), photo: pub.photo || null, frame: pub.frame || 'none', itemFrame: fr,
      titleName: pub.titleName || '', titleIcon: pub.titleIcon || '' }, extra || {});
  }

  // Рейтинги. Ценность коллекций считаем раз в минуту — предметов может быть много.
  let colCache = { at: 0, map: {} };
  function collectionMap() {
    if (now() - colCache.at < 60000) return colCache.map;
    const ctx = valueCtx(), map = {};
    Object.values(eco.items).forEach((it) => { map[it.owner] = (map[it.owner] || 0) + itemValue(it, ctx); });
    colCache = { at: now(), map };
    return map;
  }
  const BOARDS = {
    level: { val: (p) => p.bestLevel, sub: (p) => '⭐' + p.totalStars, tie: (p) => p.totalStars },
    stars: { val: (p) => p.totalStars, sub: (p) => '🚩' + p.bestLevel, tie: (p) => p.bestLevel },
    collection: { val: (p, m) => m[p.id] || 0, sub: (p) => inventoryOf(p.id).length + ' шт.', tie: (p) => p.bestLevel },
    likes: { val: (p) => likesOf(p.id), sub: (p) => '🚩' + p.bestLevel, tie: (p) => p.bestLevel }
  };
  app.get('/api/social/top', requireUser, (req, res) => {
    const by = BOARDS[req.query.by] ? String(req.query.by) : (req.query.by === 'friends' ? 'friends' : 'level');
    const meP = players[String(req.user.id)];
    const m = collectionMap();
    let pool = Object.values(players).filter((p) => !p.isBanned);
    let B = BOARDS[by];
    if (by === 'friends') {
      B = BOARDS.level;
      const me = String(req.user.id);
      pool = pool.filter((p) => p.id === me || p.refBy === me || (meP && meP.refBy === p.id));
    } else pool = pool.filter((p) => B.val(p, m) > 0 && (by !== 'level' || p.bestLevel > 1));
    pool.sort((a, b) => (B.val(b, m) - B.val(a, m)) || (B.tie(b) - B.tie(a)));
    const rank = pool.findIndex((p) => p.id === String(req.user.id)) + 1;
    const list = pool.slice(0, 50).map((p) => cardOf(p, { value: B.val(p, m), sub: B.sub(p) }));
    res.json({ success: true, by, list, me: { rank, value: meP ? B.val(meP, m) : 0, total: pool.length } });
  });

  function rankIn(by, uid) {
    const m = collectionMap(), B = BOARDS[by];
    const mine = players[uid] ? B.val(players[uid], m) : 0;
    if (!mine) return null;
    let r = 1;
    Object.values(players).forEach((p) => { if (!p.isBanned && p.id !== uid && B.val(p, m) > mine) r++; });
    return r;
  }
  app.get('/api/social/profile/:id', requireUser, (req, res) => {
    const t = players[String(req.params.id)];
    if (!t || t.isBanned) return fail(res, 404, 'Игрок не найден');
    ecoPlayer(t.id);
    const ctx = valueCtx(), col = collectionOf(t.id, ctx);
    let show = (t.showcase || []).map((u) => eco.items[u]).filter((it) => it && it.owner === t.id);
    const auto = !show.length;
    if (auto) show = inventoryOf(t.id).map((it) => [it, itemValue(it, ctx)]).sort((a, b) => b[1] - a[1]).slice(0, 5).map((x) => x[0]);
    const me = String(req.user.id);
    const tp = ecoPlayer(t.id);
    const pub = Object.assign({}, t.pub || {}, { wins: tp.verifiedWins || 0 }); // побед — надёжный счётчик сервера, не то, что прислал клиент
    res.json({ success: true, profile: cardOf(t, {
      bestLevel: t.bestLevel, totalStars: t.totalStars, createdAt: t.createdAt, lastSeen: t.lastSeen, pub,
      vip: t.vipUntil > now(), passPremium: t.passSeason === Items.seasonInfo().id,
      collection: { value: col.value, count: col.count }, likes: likesOf(t.id), liked: !!(eco.likes[t.id] && eco.likes[t.id][me]),
      showcase: show.map((it) => Object.assign(view(it), { value: itemValue(it, ctx) })), autoShowcase: auto,
      ranks: { level: rankIn('level', t.id), collection: rankIn('collection', t.id), likes: rankIn('likes', t.id) },
      recent: eco.feed.filter((e) => e.uid === t.id).slice(-5).reverse()
    }) });
  });
  app.post('/api/social/like', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    const to = String(req.body.id || '');
    const t = players[to];
    if (!t || t.isBanned) return fail(res, 404, 'Игрок не найден');
    if (to === p.id) return fail(res, 400, 'Себе лайк поставить нельзя 🙂');
    if ((p.verifiedWins || 0) < 1) return fail(res, 403, 'Пройдите хотя бы один уровень, чтобы ставить лайки');
    const set = eco.likes[to] || (eco.likes[to] = {});
    if (set[p.id]) { delete set[p.id]; }
    else {
      const day = new Date().toISOString().slice(0, 10);
      if (!p.likeDay || p.likeDay.d !== day) p.likeDay = { d: day, n: 0 };
      if (++p.likeDay.n > 50) return fail(res, 429, 'Лимит лайков на сегодня');
      set[p.id] = now();
      const n = likesOf(to);
      if ([10, 50, 100, 500, 1000].includes(n)) pushFeed(to, 'likes', { n });
    }
    saveEco(); saveDB();
    res.json({ success: true, liked: !!set[p.id], likes: likesOf(to) });
  });
  app.post('/api/social/showcase', requireUser, (req, res) => {
    const p = ecoPlayer(req.user.id, req.user);
    const uids = Array.from(new Set((Array.isArray(req.body.uids) ? req.body.uids : []).map(String))).slice(0, 5);
    if (uids.some((u) => !eco.items[u] || eco.items[u].owner !== p.id)) return fail(res, 400, 'Можно выставить только свои предметы');
    p.showcase = uids;
    saveDB();
    res.json({ success: true, showcase: uids });
  });
  app.get('/api/social/feed', (req, res) => {
    const list = eco.feed.filter((e) => players[e.uid] && !players[e.uid].isBanned).slice(-40).reverse()
      .map((e) => Object.assign({}, e, { badge: badgeOf(e.uid), photo: players[e.uid].pub && players[e.uid].pub.photo || null }));
    res.json({ success: true, feed: list });
  });

  console.log(`   Экономика: предметов ${Object.keys(eco.items).length}, лотов ${Object.keys(eco.listings).length}, платежей ${eco.payments.length}`);
  // Для аналитики: выручка в Stars по дням (UTC) и число премиум-пропусков текущего сезона
  function revenueByDay(days) {
    const out = {};
    const from = now() - days * 86400000;
    eco.payments.forEach((x) => { if (!x.refunded && x.at >= from) { const d = new Date(x.at).toISOString().slice(0, 10); out[d] = (out[d] || 0) + x.stars; } });
    return out;
  }
  function passBuyers() { const sid = Items.seasonInfo().id; return Object.values(players).filter((p) => p.passSeason === sid).length; }
  return { flush, badgeOf, ecoPlayer, fulfill, productById, CFG, tgApi, revenueByDay, passBuyers, pushFeed, ingestPub };
};
