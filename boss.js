/* ==========================================================
   FRUIT BLITZ — МИРОВОЙ БОСС
   Один общий монстр на всех игроков сразу. Каждый пройденный и проверенный
   сервером уровень наносит боссу урон (по очкам), полоска HP — одна на всю
   игру, видна на главном экране всем одновременно. Когда HP доходит до нуля —
   награды по вкладу, пост в канал новостей, следующий (более сильный) босс.
   Урон начисляется из economy.js через dealDamage() — сама пробивка честности
   урона уже сделана там (verified reply), здесь только копится общий HP.
   ========================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function attachBoss(ctx) {
  const { app, requireUser, requireAdmin, players, DATA_DIR, pushFeed } = ctx;
  const DAY = 86400000;
  const now = () => Date.now();
  const fail = (res, code, error) => res.status(code).json({ success: false, error });
  const newId = () => crypto.randomBytes(6).toString('hex');

  const FILE = path.join(DATA_DIR, 'boss.json');
  const loadJSON = ctx.loadJSON, writeJSON = ctx.writeJSON;
  const st = Object.assign({ boss: null, history: [], round: 0 }, loadJSON(FILE, {}));
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeJSON(FILE, st), 1200); };

  // Ростер боссов — по кругу, с каждым кругом крепче (см. scaleFor)
  const BOSSES = [
    { name: 'Король Гнили', emoji: '🍉', hp: 400000 },
    { name: 'Ледяная Королева', emoji: '🍧', hp: 650000 },
    { name: 'Плесневый Тиран', emoji: '🍄', hp: 950000 },
    { name: 'Кислотный Лимон', emoji: '🍋', hp: 1300000 },
    { name: 'Чёрный Виноград Бездны', emoji: '🍇', hp: 1800000 }
  ];
  const EVENT_LEN = 3 * DAY;
  const scaleFor = (round) => 1 + Math.floor(round / BOSSES.length) * 0.35;

  function ensureGrants(p) { if (!Array.isArray(p.grants)) p.grants = []; }
  function grant(uid, rw, title) {
    const p = players[uid]; if (!p) return;
    ensureGrants(p);
    p.grants.push({ id: newId(), rw, title, at: now() });
  }
  function rewardTier(rank, total) {
    if (rank === 1) return { gems: 150, coins: 8000 };
    if (rank <= 3) return { gems: 80, coins: 4000 };
    if (rank <= 10) return { gems: 40, coins: 2000 };
    if (rank <= 50) return { gems: 15, coins: 800 };
    return { coins: 300 };
  }

  function closeBoss(defeated) {
    const b = st.boss;
    if (!b) return;
    const ranked = Object.entries(b.contributions).sort((a, z) => z[1] - a[1]);
    if (defeated) {
      ranked.forEach(([uid, dmg], i) => grant(uid, rewardTier(i + 1, ranked.length), `🏆 ${b.name} повержен! Ваш урон: ${Math.round(dmg)} (место ${i + 1})`));
      if (ranked[0] && pushFeed) pushFeed(ranked[0][0], 'boss', { name: b.name });
    }
    st.history.unshift({ id: b.id, name: b.name, emoji: b.emoji, endedAt: now(), defeated, participants: ranked.length, top: ranked.slice(0, 3).map(([uid, dmg]) => ({ uid, name: players[uid] ? players[uid].name : '?', dmg: Math.round(dmg) })) });
    st.history = st.history.slice(0, 20);
    st.boss = null;
    save();
  }
  function ensureBoss() {
    if (st.boss && st.boss.hp > 0 && now() < st.boss.endsAt) return st.boss;
    if (st.boss) closeBoss(false); // время истекло, не добили — закрываем без наград, начинаем нового
    const def = BOSSES[st.round % BOSSES.length];
    const scale = scaleFor(st.round);
    st.round++;
    const hp = Math.round(def.hp * scale);
    st.boss = { id: newId(), name: def.name, emoji: def.emoji, maxHp: hp, hp, startedAt: now(), endsAt: now() + EVENT_LEN, contributions: {}, round: st.round };
    save();
    return st.boss;
  }
  // Вызывается из economy.js сразу после честной (реплей-подтверждённой) победы на уровне.
  function dealDamage(uid, score, level) {
    try {
      const boss = ensureBoss();
      const dmg = Math.max(1, Math.round((score || 0) / 18) + (level >= 10 ? 20 : 0));
      boss.hp = Math.max(0, boss.hp - dmg);
      boss.contributions[uid] = (boss.contributions[uid] || 0) + dmg;
      if (boss.hp <= 0) closeBoss(true);
      else save();
    } catch (e) { console.error('Мировой Босс, урон:', e.message); }
  }

  function bossView(b, uid) {
    const ranked = Object.entries(b.contributions).sort((a, z) => z[1] - a[1]);
    const myIdx = ranked.findIndex(([id]) => id === uid);
    return {
      id: b.id, name: b.name, emoji: b.emoji, hp: Math.round(b.hp), maxHp: b.maxHp, endsAt: b.endsAt, round: b.round,
      participants: ranked.length,
      top: ranked.slice(0, 5).map(([id, dmg]) => ({ id, name: players[id] ? players[id].name : '?', dmg: Math.round(dmg) })),
      myDamage: myIdx >= 0 ? Math.round(ranked[myIdx][1]) : 0, myRank: myIdx >= 0 ? myIdx + 1 : null
    };
  }
  app.get('/api/boss/status', requireUser, (req, res) => {
    const b = ensureBoss();
    res.json({ success: true, boss: bossView(b, String(req.user.id)), lastDefeated: st.history.find((h) => h.defeated) || null });
  });

  /* ---------------- Админка: посмотреть/подкрутить событие ---------------- */
  app.get('/api/admin/boss', requireAdmin, (req, res) => {
    const b = ensureBoss();
    res.json({ success: true, boss: bossView(b, ''), history: st.history.slice(0, 10) });
  });
  app.post('/api/admin/boss/setHp', requireAdmin, (req, res) => {
    const b = ensureBoss();
    const hp = Math.max(1, Math.floor(Number(req.body.hp) || 0));
    b.hp = Math.min(b.maxHp, hp);
    save();
    res.json({ success: true, boss: bossView(b, '') });
  });
  app.post('/api/admin/boss/kill', requireAdmin, (req, res) => {
    const b = ensureBoss();
    b.hp = 0; closeBoss(true);
    res.json({ success: true });
  });
  app.post('/api/admin/boss/skip', requireAdmin, (req, res) => {
    closeBoss(false);
    res.json({ success: true, boss: bossView(ensureBoss(), '') });
  });

  console.log(`   Мировой Босс: ${ensureBoss().name} ${ensureBoss().emoji} — HP ${ensureBoss().hp}/${ensureBoss().maxHp}`);
  return { dealDamage, flush: () => writeJSON(FILE, st) };
};
