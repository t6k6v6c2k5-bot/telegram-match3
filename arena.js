/* ==========================================================
   FRUIT BLITZ — АРЕНА: 🔥 Испытание дня и ⚔️ Дуэли
   Оба режима используют один и тот же уровень (шаблон + seed) для всех
   участников — сравнение честное. Бустеры полностью запрещены (в
   отличие от обычных уровней): лог проверки принимает только 's' (своп)
   и 't' (активация спецфишки). Жизни и обычные награды не расходуются —
   это отдельный, параллельный игре режим.
   ========================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./public/engine.js');

module.exports = function attachArena(ctx) {
  const { app, requireUser, requireAdmin, players, saveDB, writeJSON, loadJSON, DATA_DIR, getBot, WEBAPP_URL, BOT_USERNAME, pushFeed, shortNameH } = ctx;
  const DAY = 86400000;
  const now = () => Date.now();
  const fail = (res, code, error) => res.status(code).json({ success: false, error });
  const dayKey = (t) => new Date(t == null ? now() : t).toISOString().slice(0, 10);
  const newId = () => crypto.randomBytes(8).toString('hex');
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  const FILE = path.join(DATA_DIR, 'arena.json');
  const st = Object.assign({ daily: { day: '', tpl: 0, seed: 0, entries: {}, attempts: {} }, history: [], duels: {} }, loadJSON(FILE, {}));
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeJSON(FILE, st), 1500); };

  function ensureGrants(p) { if (!Array.isArray(p.grants)) p.grants = []; }
  function grant(uid, rw, title) {
    const p = players[uid]; if (!p) return;
    ensureGrants(p);
    p.grants.push({ id: newId(), rw, title, at: now() });
  }
  function notify(uid, text, kb) {
    const bot = getBot(); const p = players[uid];
    if (!bot || !p) return;
    bot.sendMessage(uid, text, Object.assign({ parse_mode: 'HTML' }, kb ? { reply_markup: kb } : {})).catch(() => {});
  }
  const arenaKb = { inline_keyboard: [[{ text: '🏟 Открыть Арену', web_app: { url: WEBAPP_URL } }]] };

  /* ============================================================
     Общий шаблон уровня и честная проверка (реплей без бустеров)
     ============================================================ */
  const DAY_EPOCH = Date.UTC(2026, 0, 1);
  const dayIndex = (t) => Math.floor(((t || now()) - DAY_EPOCH) / DAY);
  const templateFor = (idx) => 20 + (((idx % 15) + 15) % 15); // уровни 20..34 — везде поле 8×8, разные механики
  function seedFor(salt) { return crypto.createHash('sha256').update('arena:' + salt).digest().readUInt32LE(0); }

  function replayArena(tpl, seed, log) {
    const cfg = E.levelConfig(tpl);
    const bst = E.createBoard(cfg, { seed });
    const P = (a) => ({ r: a[0] | 0, c: a[1] | 0 });
    const list = Array.isArray(log) ? log.slice(0, 2000) : [];
    for (const a of list) {
      let r = null;
      if (a && a.k === 's') r = E.trySwap(bst, P(a.a), P(a.b));
      else if (a && a.k === 't') r = E.activateSpecial(bst, a.r | 0, a.c | 0);
      else return { ok: false, reason: 'boosters_forbidden' };
      if (!r || !r.valid) return { ok: false, reason: 'invalid_move' };
    }
    if (!E.isComplete(bst)) return { ok: false, reason: 'not_complete' };
    return { ok: true, moves: bst.moves, score: bst.score };
  }
  const runs = new Map(); // runId -> { uid, kind, tpl, seed, duelId?, at }
  function startRun(uid, kind, tpl, seed, duelId) {
    const runId = newId();
    runs.set(runId, { uid, kind, tpl, seed, duelId, at: now() });
    setTimeout(() => runs.delete(runId), 30 * 60000);
    return runId;
  }
  const better = (a, b) => !b || a.moves < b.moves || (a.moves === b.moves && a.score > b.score); // a лучше b?

  /* ============================================================
     🔥 ИСПЫТАНИЕ ДНЯ
     ============================================================ */
  const DAILY_ATTEMPTS = 3;
  const DAILY_REWARDS = [{ gems: 50, coins: 2000 }, { gems: 30, coins: 1000 }, { gems: 20, coins: 500 }];
  const DAILY_PARTICIPATION = { coins: 200 };

  function closeDailyIfDue() {
    const d = st.daily.day;
    if (!d || d === dayKey()) return;
    const ranked = Object.entries(st.daily.entries).map(([uid, e]) => ({ uid, ...e })).sort((a, b) => (a.moves - b.moves) || (b.score - a.score));
    const winners = ranked.slice(0, 3).map((e, i) => ({ uid: e.uid, name: players[e.uid] ? players[e.uid].name : '?', rank: i + 1, moves: e.moves, score: e.score, reward: DAILY_REWARDS[i] }));
    winners.forEach((w) => { grant(w.uid, DAILY_REWARDS[w.rank - 1], `🏆 ${w.rank}-е место в испытании дня (${d})`); });
    if (winners[0]) pushFeed && pushFeed(winners[0].uid, 'arena_daily', { rank: 1, moves: winners[0].moves, day: d });
    st.history.unshift({ day: d, tpl: st.daily.tpl, winners, players: ranked.length });
    st.history = st.history.slice(0, 30);
  }
  function ensureDaily() {
    closeDailyIfDue();
    const d = dayKey();
    if (st.daily.day !== d) {
      const idx = dayIndex();
      st.daily = { day: d, tpl: templateFor(idx), seed: seedFor('daily:' + d), entries: {}, attempts: {} };
      save();
    }
    return st.daily;
  }
  function dailyTop(n) {
    return Object.entries(ensureDaily().entries).map(([uid, e]) => ({ uid, name: players[uid] ? players[uid].name : '?', moves: e.moves, score: e.score }))
      .sort((a, b) => (a.moves - b.moves) || (b.score - a.score)).slice(0, n || 10);
  }
  app.get('/api/arena/daily', requireUser, (req, res) => {
    const D = ensureDaily(); const uid = String(req.user.id);
    const top = dailyTop(10);
    const rank = top.findIndex((x) => x.uid === uid) + 1;
    res.json({ success: true, day: D.day, tpl: D.tpl, seed: D.seed, endsAt: Date.UTC(...D.day.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v))) + DAY,
      attemptsLeft: Math.max(0, DAILY_ATTEMPTS - (D.attempts[uid] || 0)), best: D.entries[uid] || null,
      top, myRank: rank || null, yesterday: st.history[0] || null });
  });
  app.post('/api/arena/daily/start', requireUser, (req, res) => {
    const D = ensureDaily(); const uid = String(req.user.id);
    if ((D.attempts[uid] || 0) >= DAILY_ATTEMPTS) return fail(res, 403, 'Попытки на сегодня закончились — приходите завтра!');
    D.attempts[uid] = (D.attempts[uid] || 0) + 1; save();
    const runId = startRun(uid, 'daily', D.tpl, D.seed);
    res.json({ success: true, runId, tpl: D.tpl, seed: D.seed, attemptsLeft: DAILY_ATTEMPTS - D.attempts[uid] });
  });
  app.post('/api/arena/daily/finish', requireUser, (req, res) => {
    const uid = String(req.user.id);
    const run = runs.get(String(req.body.runId || ''));
    if (!run || run.uid !== uid || run.kind !== 'daily') return fail(res, 404, 'Забег не найден или устарел');
    runs.delete(String(req.body.runId));
    const D = ensureDaily();
    if (run.seed !== D.seed) return fail(res, 400, 'Испытание дня уже сменилось, результат не засчитан');
    const r = replayArena(run.tpl, run.seed, req.body.log);
    if (!r.ok) return res.json({ success: true, verified: false, reason: r.reason });
    const first = !D.entries[uid];
    if (better({ moves: r.moves, score: r.score }, D.entries[uid])) D.entries[uid] = { moves: r.moves, score: r.score, at: now() };
    if (first) grant(uid, DAILY_PARTICIPATION, '🔥 Участие в испытании дня');
    save();
    const top = dailyTop(10), rank = top.findIndex((x) => x.uid === uid) + 1;
    res.json({ success: true, verified: true, moves: r.moves, score: r.score, best: D.entries[uid], top, myRank: rank || null, isFirst: first });
  });

  /* ============================================================
     ⚔️ ДУЭЛИ
     ============================================================ */
  const DUEL_TTL = 3 * DAY;
  const DUEL_WIN = { gems: 15, coins: 500 };
  const DUEL_LOSE = { coins: 100 };
  function findPlayerByRef(ref) {
    ref = String(ref || '').trim().replace(/^@/, '');
    if (!ref) return null;
    if (players[ref]) return players[ref];
    const low = ref.toLowerCase();
    return Object.values(players).find((p) => p.username && p.username.toLowerCase() === low) || null;
  }
  function duelView(d, forUid) {
    const a = players[d.a], b = d.b && players[d.b];
    return { id: d.id, status: d.status, tpl: d.tpl, createdAt: d.createdAt, expiresAt: d.expiresAt,
      a: { id: d.a, name: a ? a.name : '?', badge: a && a.pub, done: !!d.resA, result: d.resA || null },
      b: b ? { id: d.b, name: b.name, done: !!d.resB, result: d.resB || null } : null,
      mine: d.a === forUid ? 'a' : 'b', winner: d.winner || null,
      canPlay: d.status === 'active' && ((d.a === forUid && !d.resA) || (d.b === forUid && !d.resB)) };
  }
  function checkExpiry(d) {
    if ((d.status === 'pending' || d.status === 'active') && now() > d.expiresAt) { d.status = 'expired'; save(); }
    return d;
  }
  app.get('/api/arena/duels', requireUser, (req, res) => {
    const uid = String(req.user.id);
    const mine = Object.values(st.duels).map(checkExpiry).filter((d) => d.a === uid || d.b === uid).sort((x, y) => y.createdAt - x.createdAt);
    res.json({ success: true, duels: mine.map((d) => duelView(d, uid)) });
  });
  app.post('/api/arena/duel/create', requireUser, (req, res) => {
    const uid = String(req.user.id);
    const target = findPlayerByRef(req.body.target);
    if (!target) return fail(res, 404, 'Игрок не найден — проверьте @username или ID');
    if (target.id === uid) return fail(res, 400, 'Нельзя вызвать самого себя');
    if (target.isBanned) return fail(res, 400, 'Этот игрок недоступен');
    const active = Object.values(st.duels).some((d) => checkExpiry(d).status !== 'done' && d.status !== 'declined' && d.status !== 'expired' && ((d.a === uid && d.b === target.id) || (d.a === target.id && d.b === uid)));
    if (active) return fail(res, 400, 'С этим игроком уже есть незавершённая дуэль');
    const idx = dayIndex(), tpl = templateFor(idx + Math.floor(Math.random() * 1000));
    const id = newId();
    const d = { id, a: uid, b: target.id, tpl, seed: seedFor('duel:' + id), status: 'pending', resA: null, resB: null, winner: null, createdAt: now(), expiresAt: now() + DUEL_TTL };
    st.duels[id] = d; save();
    const meP = players[uid];
    notify(target.id, `⚔️ <b>${shortNameH ? shortNameH(meP) : (meP && meP.name) || 'Игрок'}</b> вызывает вас на дуэль в Fruit Blitz!\n\nОдин уровень, у кого меньше ходов — тот победил. Загляните на Арену 🏟`, arenaKb);
    res.json({ success: true, duel: duelView(d, uid) });
  });
  app.post('/api/arena/duel/respond', requireUser, (req, res) => {
    const uid = String(req.user.id);
    const d = checkExpiry(st.duels[String(req.body.id || '')]);
    if (!d || d.b !== uid) return fail(res, 404, 'Вызов не найден');
    if (d.status !== 'pending') return fail(res, 400, 'Этот вызов уже неактуален');
    if (req.body.accept) { d.status = 'active'; notify(d.a, `✅ <b>${shortNameH ? shortNameH(players[uid]) : players[uid].name}</b> принял(а) вашу дуэль! Сыграйте на Арене 🏟`, arenaKb); }
    else { d.status = 'declined'; notify(d.a, `❌ <b>${shortNameH ? shortNameH(players[uid]) : players[uid].name}</b> отклонил(а) вашу дуэль.`); }
    save();
    res.json({ success: true, duel: duelView(d, uid) });
  });
  app.post('/api/arena/duel/cancel', requireUser, (req, res) => {
    const uid = String(req.user.id);
    const d = st.duels[String(req.body.id || '')];
    if (!d || d.a !== uid) return fail(res, 404, 'Дуэль не найдена');
    if (d.status !== 'pending') return fail(res, 400, 'Можно отменить только неотвеченный вызов');
    d.status = 'declined'; save();
    res.json({ success: true });
  });
  app.post('/api/arena/duel/start', requireUser, (req, res) => {
    const uid = String(req.user.id);
    const d = checkExpiry(st.duels[String(req.body.id || '')]);
    if (!d || (d.a !== uid && d.b !== uid)) return fail(res, 404, 'Дуэль не найдена');
    if (d.status !== 'active') return fail(res, 400, 'Дуэль ещё не началась или уже завершена');
    const mine = d.a === uid ? 'resA' : 'resB';
    if (d[mine]) return fail(res, 400, 'Вы уже сыграли свою попытку в этой дуэли');
    const runId = startRun(uid, 'duel', d.tpl, d.seed, d.id);
    res.json({ success: true, runId, tpl: d.tpl, seed: d.seed });
  });
  function resolveDuel(d) {
    if (!d.resA || !d.resB) return;
    d.status = 'done';
    d.winner = better(d.resA, d.resB) ? d.a : (better(d.resB, d.resA) ? d.b : null);
    if (d.winner) {
      const loser = d.winner === d.a ? d.b : d.a;
      grant(d.winner, DUEL_WIN, '⚔️ Победа в дуэли!');
      grant(loser, DUEL_LOSE, '⚔️ Дуэль сыграна');
      const wp = players[d.winner], lp = players[loser];
      notify(d.winner, `🏆 Вы победили в дуэли с <b>${lp ? (shortNameH ? shortNameH(lp) : lp.name) : '?'}</b>! +${DUEL_WIN.gems}💎 +${DUEL_WIN.coins}🪙`, arenaKb);
      notify(loser, `⚔️ Дуэль с <b>${wp ? (shortNameH ? shortNameH(wp) : wp.name) : '?'}</b> завершена — победа за соперником. +${DUEL_LOSE.coins}🪙 в утешение`, arenaKb);
      pushFeed && pushFeed(d.winner, 'duel', { vs: lp ? lp.name : '?' });
    } else {
      [d.a, d.b].forEach((u) => notify(u, '🤝 Дуэль завершена вничью — одинаковое число ходов!', arenaKb));
    }
    save();
  }
  app.post('/api/arena/duel/finish', requireUser, (req, res) => {
    const uid = String(req.user.id);
    const run = runs.get(String(req.body.runId || ''));
    if (!run || run.uid !== uid || run.kind !== 'duel') return fail(res, 404, 'Забег не найден или устарел');
    runs.delete(String(req.body.runId));
    const d = st.duels[run.duelId];
    if (!d || d.status !== 'active') return fail(res, 400, 'Дуэль уже недоступна');
    const r = replayArena(run.tpl, run.seed, req.body.log);
    if (!r.ok) return res.json({ success: true, verified: false, reason: r.reason });
    const mine = d.a === uid ? 'resA' : 'resB';
    if (d[mine]) return fail(res, 400, 'Вы уже сыграли свою попытку');
    d[mine] = { moves: r.moves, score: r.score, at: now() };
    resolveDuel(d);
    save();
    res.json({ success: true, verified: true, moves: r.moves, score: r.score, duel: duelView(d, uid) });
  });

  setInterval(ensureDaily, 5 * 60000);
  ensureDaily();
  console.log(`   Арена: испытание дня — шаблон уровня ${st.daily.tpl}, дуэлей в базе: ${Object.keys(st.duels).length}`);
  return { flush: () => writeJSON(FILE, st) };
};
