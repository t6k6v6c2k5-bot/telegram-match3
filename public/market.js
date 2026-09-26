/* =====================================================================
   FRUIT BLITZ — коллекция, маркет, обмены, контракт, донат (Telegram Stars)
   Все ценности хранятся на сервере; здесь только интерфейс.
   ===================================================================== */
(function () {
  'use strict';
  const A = window.FBApp, I = window.FBItems;
  if (!A || !I) return;
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = A.esc, fmt = A.fmt;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const guest = A.playerId === 'guest';
  const CACHE_KEY = 'fb_eco_' + A.playerId;
  const SEEN_KEY = 'fb_eco_seen_' + A.playerId;

  let me = null;
  try { me = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { me = null; }
  let summary = null, summaryAt = 0;
  let tab = 'inv', invFilter = 'all', mkType = 'all', mkQuery = '', tuRarity = 0;
  const tuSel = new Set();

  /* ---------------- Сеть ---------------- */
  const get = (path) => A.api(path + (path.includes('?') ? '&' : '?') + 'telegram_id=' + encodeURIComponent(A.playerId));
  const post = (path, body) => A.api(path, { method: 'POST', body: Object.assign({ telegram_id: A.playerId }, body || {}) });
  const errText = (r) => (r && r.data && r.data.error) || (r && r.status === 0 ? 'Нет соединения' : 'Ошибка сервера');

  /* ---------------- Вспомогательное ---------------- */
  const def = (id) => I.BY_ID[id];
  const rar = (r) => I.rarityOf(r);
  const invItem = (uid) => (me && me.inventory ? me.inventory.find((x) => x.uid === uid) : null);
  const isLocked = (v) => (v.lockUntil || 0) > Date.now();
  const canTrade = () => me && me.verifiedWins >= me.cfg.minWins;
  const equippedUid = (slot) => (me && me.equip && me.equip[slot] ? me.equip[slot].uid : null);
  const isEquipped = (v) => Object.values((me && me.equip) || {}).some((e) => e.uid === v.uid);
  const leftText = (ms) => { const t = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(t / 60), m = t % 60; return h ? `${h} ч${m ? ' ' + m + ' мин' : ''}` : `${m} мин`; };

  function pv(d, size) {
    const s = size || 56;
    const st = `style="--pv:${s}px"`;
    if (d.type === 'skin') return `<div class="pv pv-skin" ${st}>${d.data.map((e) => `<span>${e}</span>`).join('')}</div>`;
    if (d.type === 'board') return `<div class="pv pv-board" ${st}><div style="background:linear-gradient(150deg, ${d.data[0]}, ${d.data[1]})">${'<i></i>'.repeat(9)}</div></div>`;
    if (d.type === 'fx') return `<div class="pv pv-fx" ${st}>${d.data.map((c, i) => `<i style="background:${c};box-shadow:0 0 10px ${c};animation-delay:${i * 0.2}s"></i>`).join('')}</div>`;
    if (d.type === 'frame') return `<div class="pv pv-frame" ${st}><span style="background:linear-gradient(#2c1660,#2c1660) padding-box, conic-gradient(${d.data.join(',')}) border-box">🙂</span></div>`;
    return `<div class="pv pv-badge" ${st}>${d.data}</div>`;
  }
  function card(v, opts) {
    opts = opts || {};
    const d = def(v.itemId);
    if (!d) return '';
    const r = rar(d.r), q = I.qualityOf(v.q);
    const tags = (v.shiny ? '<i title="Сияющий">✨</i>' : '') + (isLocked(v) ? '<i>🔒</i>' : '') + (v.listing ? '<i>🏷️</i>' : '') + (isEquipped(v) ? '<i>✅</i>' : '');
    return `<button class="it-card${opts.sel ? ' sel' : ''}${opts.dis ? ' dis' : ''}${v.shiny ? ' shiny' : ''}" data-uid="${esc(v.uid)}" style="--rc:${r.color}">
      <span class="it-tags">${tags}</span>${pv(d, opts.size || 52)}<b>${esc(d.name)}</b><small>${q.short} · #${v.serial}</small></button>`;
  }
  function qualityBar(qv) {
    const q = I.qualityOf(qv);
    return `<div class="qbar"><div class="qbar-track"><i style="left:${Math.min(99.5, qv * 100)}%"></i></div><div class="qbar-text"><b>${q.name}</b><span>${qv.toFixed(5)}</span></div></div>`;
  }
  function chart(history) {
    if (!history || history.length < 2) return '<p class="muted tiny" style="text-align:center">Пока мало продаж для графика</p>';
    const W = 300, H = 90, ps = history.map((h) => h.p);
    const mn = Math.min.apply(null, ps), mx = Math.max.apply(null, ps), span = Math.max(1, mx - mn);
    const pts = ps.map((p, i) => `${(i / (ps.length - 1) * W).toFixed(1)},${(H - 8 - (p - mn) / span * (H - 16)).toFixed(1)}`).join(' ');
    return `<svg class="mk-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="0,${H} ${pts} ${W},${H}" class="area"/><polyline points="${pts}" class="line"/></svg>
      <div class="mk-chart-legend"><span>мин ${fmt(mn)} 💠</span><span>${ps.length} продаж</span><span>макс ${fmt(mx)} 💠</span></div>`;
  }

  /* ---------------- Синхронизация ---------------- */
  let refreshing = null, equipSig = '';
  function refresh() {
    if (guest) return Promise.resolve(null);
    if (refreshing) return refreshing;
    refreshing = get('/api/eco/me').then((r) => {
      refreshing = null;
      if (!r.ok || !r.data || !r.data.success) return null;
      me = r.data;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(me)); } catch (e) { /* noop */ }
      updateDots();
      const sig = JSON.stringify(Object.values(me.equip || {}).map((x) => x.uid)) + (isVip() ? 'v' : '');
      if (sig !== equipSig) { equipSig = sig; if (['screenHome', 'screenLeaders'].includes(A.currentScreen)) A.refreshScreen(); }
      if (A.currentScreen === 'screenMarket') renderBody();
      processGrants();
      return me;
    }).catch(() => { refreshing = null; return null; });
    return refreshing;
  }
  let grantsBusy = false;
  async function processGrants() {
    if (grantsBusy || !me || !me.grants || !me.grants.length) return;
    grantsBusy = true;
    const st = A.state;
    st.appliedGrants = st.appliedGrants || [];
    try {
      for (const g of me.grants.slice()) {
        if (!st.appliedGrants.includes(g.id)) {
          await A.showReward(g.rw, { title: 'Покупка получена! 🎉', sub: g.title, icon: '🎁' });
          st.appliedGrants.push(g.id);
          if (st.appliedGrants.length > 300) st.appliedGrants = st.appliedGrants.slice(-300);
          A.saveNow();
        }
        await post('/api/eco/grants/ack', { ids: [g.id] });
      }
      me.grants = [];
    } finally { grantsBusy = false; }
  }
  function updateDots() {
    const incoming = me && me.trades ? me.trades.filter((t) => t.status === 'pending' && t.to === A.playerId).length : 0;
    const dm = $('dotMarket'); if (dm) dm.classList.toggle('hidden', !incoming);
    let seen = 0; try { seen = Number(localStorage.getItem(SEEN_KEY) || 0); } catch (e) { /* noop */ }
    const n = me && me.inventory ? me.inventory.length : 0;
    const dc = $('dotCollection'); if (dc) dc.classList.toggle('hidden', !(n > seen));
    const ch = $('collectionHint'); if (ch) ch.textContent = n ? n + ' шт.' : 'Предметы';
  }
  function markSeen() { try { localStorage.setItem(SEEN_KEY, String(me && me.inventory ? me.inventory.length : 0)); } catch (e) { /* noop */ } updateDots(); }

  /* ---------------- Внешний вид в игре ---------------- */
  const eqDef = (slot) => (me && me.equip && me.equip[slot] ? def(me.equip[slot].itemId) : null);
  function isVip() { return !!(me && me.vipUntil > Date.now()); }
  function skinEmojis() { const d = eqDef('skin'); return d ? d.data : null; }
  function boardBg() { const d = eqDef('board'); return d ? `linear-gradient(160deg, ${d.data[0]}, ${d.data[1]})` : null; }
  function fxColor() { const d = eqDef('fx'); return d ? d.data[Math.floor(Math.random() * d.data.length)] : null; }
  function myBadge() { const d = eqDef('badge'); return d ? d.data : (isVip() ? '👑' : null); }
  function decorateAvatar(el) {
    const d = eqDef('frame');
    if (!el) return;
    if (!d) { el.style.border = ''; el.style.background = ''; el.style.boxShadow = ''; return; }
    el.style.border = '3px solid transparent';
    el.style.boxShadow = '0 0 14px ' + d.data[0];
    el.style.background = `linear-gradient(#2c1660,#2c1660) padding-box, conic-gradient(${d.data.join(',')}) border-box`;
  }

  /* ---------------- Уровни: забег и дроп ---------------- */
  async function startRun(level, pre) {
    if (guest) return null;
    const r = await Promise.race([post('/api/level/start', { level, pre }), wait(2500).then(() => null)]);
    return r && r.ok && r.data && r.data.success ? { runId: r.data.runId, seed: r.data.seed } : null;
  }
  async function finishRun(run) {
    if (!run || guest) return;
    const r = await post('/api/level/finish', { runId: run.id, log: run.log });
    if (!r.ok || !r.data || !r.data.success || !r.data.verified) return;
    if (me) me.rollsLeft = r.data.rollsLeft;
    if (r.data.drop) {
      await refresh();
      await wait(2600); // даём доиграть анимации звёзд
      showDrop(r.data.drop, { title: '🎁 Выпал предмет!' });
    }
  }

  /* ---------------- Рулетка выпадения (как открытие кейса) ---------------- */
  function randomReelItem(pool) {
    if (pool) return pool[Math.floor(Math.random() * pool.length)];
    const w = [55, 24, 12, 6, 2.2, 0.8], tot = w.reduce((a, b) => a + b, 0);
    let x = Math.random() * tot, r = 0;
    for (; r < w.length - 1; r++) { x -= w[r]; if (x < 0) break; }
    const p = I.dropPool(r);
    return p[Math.floor(Math.random() * p.length)];
  }
  let dropResolve = null;
  function showDrop(v, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      dropResolve = resolve;
      const d = def(v.itemId), r = rar(d.r);
      const N = 42, WIN = 36;
      const reelItems = [];
      for (let i = 0; i < N; i++) reelItems.push(i === WIN ? d : randomReelItem(opts.pool));
      $('dropBody').innerHTML = `<h2>${esc(opts.title || 'Новый предмет!')}</h2>
        <div class="reel-wrap"><div class="reel-marker"></div><div class="reel" id="reel">${reelItems.map((x, i) => `<div class="reel-card${i === WIN ? ' win' : ''}" style="--rc:${rar(x.r).color}">${pv(x, 48)}<small>${esc(x.name)}</small></div>`).join('')}</div></div>
        <div id="dropInfo" class="drop-info hidden" style="--rc:${r.color}">
          <div class="drop-rarity">${esc(r.name)} · ${esc(I.TYPES[d.type].name)}</div>
          <div class="drop-name">${v.shiny ? '✨ Сияющий ' : ''}${esc(d.name)} <span>#${v.serial}</span></div>
          ${qualityBar(v.q)}
          <p class="muted tiny">${isLocked(v) ? '🔒 Продать или обменять можно через ' + leftText(v.lockUntil - Date.now()) : 'Можно продать на маркете или обменять'}</p>
        </div>
        <div class="btn-row"><button class="btn btn-ghost" id="dropEquip" disabled>Надеть</button><button class="btn btn-ghost" id="dropShare" disabled>📤</button><button class="btn btn-primary" id="dropOk" disabled>Отлично!</button></div>`;
      A.openModal('modalDrop');
      const reel = $('reel'), wrap = reel.parentElement;
      const cw = 96; // ширина карточки + отступ
      const target = -(WIN * cw) + wrap.clientWidth / 2 - (cw - 6) / 2 + (Math.random() * 50 - 25);
      reel.style.transform = 'translateX(0px)';
      let lastIdx = 0, running = true;
      const tick = () => {
        if (!running) return;
        const m = new DOMMatrixReadOnly(getComputedStyle(reel).transform);
        const idx = Math.floor((-m.m41 + wrap.clientWidth / 2) / cw);
        if (idx !== lastIdx) { lastIdx = idx; A.Sound.select(); A.haptic('select'); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(() => {
        reel.style.transition = 'transform 5.2s cubic-bezier(.08,.62,.1,1)';
        reel.style.transform = `translateX(${target}px)`;
        requestAnimationFrame(tick);
      });
      setTimeout(() => {
        running = false;
        $('dropInfo').classList.remove('hidden');
        reel.querySelector('.reel-card.win').classList.add('won');
        if (d.r >= 2) { A.Sound.win(); A.rainConfetti(40 + d.r * 30); } else A.Sound.goal();
        A.haptic('success');
        $('dropOk').disabled = false;
        const sh = $('dropShare');
        sh.disabled = false;
        sh.onclick = () => {
          const emo = d.type === 'skin' ? d.data.slice(0, 3).join('') : d.type === 'badge' ? d.data : I.TYPES[d.type].icon;
          A.shareCard('drop', { emoji: emo, title: (v.shiny ? '✨ ' : '') + d.name + ' #' + v.serial, color: r.color, accent: r.color,
            lines: [r.name + ' · ' + I.TYPES[d.type].name, 'Качество: ' + I.qualityOf(v.q).name], text: `Мне выпал «${d.name}» (${r.name}) в Fruit Blitz! 🍓 Попробуй и ты` });
        };
        const eq = $('dropEquip');
        eq.disabled = false;
        eq.onclick = async () => { await equip(v.uid, d.type); A.closeModal('modalDrop'); if (dropResolve) dropResolve(); };
      }, 5400);
      $('dropOk').onclick = () => { A.closeModal('modalDrop'); if (dropResolve) dropResolve(); if (A.currentScreen === 'screenMarket') renderBody(); };
    });
  }

  async function equip(uid, slot) {
    const r = await post('/api/eco/equip', { uid, slot });
    if (!r.ok) { A.showToast('⚠️ ' + errText(r)); return false; }
    me.equip = r.data.equip;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(me)); } catch (e) { /* noop */ }
    A.Sound.select(); A.haptic('success');
    A.showToast(uid ? '✅ Надето!' : 'Снято');
    equipSig = '';
    refresh();
    return true;
  }

  /* ============================================================
     ЭКРАН МАРКЕТА
     ============================================================ */
  const TABS = [['inv', '🎒 Инвентарь'], ['market', '💹 Маркет'], ['trades', '🔄 Обмены'], ['tradeup', '🧪 Контракт'], ['stars', '⭐ Донат']];
  function setTab(t) { tab = t; }
  function render() {
    if (!me && !guest) refresh();
    else if (!guest) refresh();
    const incoming = me && me.trades ? me.trades.filter((t) => t.status === 'pending' && t.to === A.playerId).length : 0;
    $('mkTabs').innerHTML = TABS.map(([k, n]) => `<button class="tab ${k === tab ? 'active' : ''}" data-mt="${k}">${n}${k === 'trades' && incoming ? ` (${incoming})` : ''}</button>`).join('');
    qsa('[data-mt]', $('mkTabs')).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.mt; A.Sound.select(); render(); }));
    renderBody();
  }
  function renderBody() {
    const body = $('mkBody');
    if (!body) return;
    $('mkShards').textContent = me ? fmt(me.shards) : '—';
    if (guest) { body.innerHTML = '<p class="empty">Маркет доступен только внутри Telegram 🙂</p>'; return; }
    if (!me) { body.innerHTML = '<p class="empty">Загрузка...</p>'; return; }
    ({ inv: renderInv, market: renderMarket, trades: renderTrades, tradeup: renderTradeup, stars: renderStarsShop })[tab](body);
  }
  $('mkShardsBtn').addEventListener('click', () => { tab = 'stars'; render(); });

  /* ---------------- Инвентарь ---------------- */
  function renderInv(body) {
    markSeen();
    const inv = me.inventory.slice().sort((a, b) => def(b.itemId).r - def(a.itemId).r || b.createdAt - a.createdAt);
    const list = invFilter === 'all' ? inv : inv.filter((v) => def(v.itemId).type === invFilter);
    const slots = Object.keys(I.TYPES).map((slot) => {
      const e = me.equip[slot];
      const d = e ? def(e.itemId) : null;
      return `<button class="eq-slot" data-slot="${slot}" style="--rc:${d ? rar(d.r).color : 'rgba(255,255,255,.2)'}">${d ? pv(d, 34) : `<span class="eq-empty">${I.TYPES[slot].icon}</span>`}<small>${esc(I.TYPES[slot].name.split(' ')[0])}</small></button>`;
    }).join('');
    body.innerHTML = `
      <div class="mk-status">
        <div><b>💠 ${fmt(me.shards)}</b><small>самоцветов</small></div>
        <div><b>🎲 ${me.rollsLeft}/${me.cfg.dailyRolls}</b><small>шансов на дроп сегодня</small></div>
        <div><b>${isVip() ? '👑 VIP' : canTrade() ? '✅' : '🔒 ' + me.verifiedWins + '/' + me.cfg.minWins}</b><small>${isVip() ? 'до ' + new Date(me.vipUntil).toLocaleDateString('ru-RU') : canTrade() ? 'торговля открыта' : 'побед до торговли'}</small></div>
      </div>
      <p class="section-label">Надето</p><div class="eq-row">${slots}</div>
      <div class="tabs mini-tabs">${[['all', 'Все']].concat(Object.keys(I.TYPES).map((k) => [k, I.TYPES[k].icon + ' ' + I.TYPES[k].name.split(' ')[0]])).map(([k, n]) => `<button class="tab ${invFilter === k ? 'active' : ''}" data-if="${k}">${n}</button>`).join('')}</div>
      ${list.length ? `<div class="it-grid">${list.map((v) => card(v)).join('')}</div>` : `<div class="empty">🎁 Пока пусто.<br>Проходите уровни — с шансом ~${(I.totalDropChance() * 100).toFixed(0)}% выпадает предмет!<br>Редкие стоят дорого на маркете 💹</div>`}`;
    qsa('[data-if]', body).forEach((b) => b.addEventListener('click', () => { invFilter = b.dataset.if; renderInv(body); }));
    qsa('.it-card', body).forEach((b) => b.addEventListener('click', () => openItem(b.dataset.uid)));
    qsa('.eq-slot', body).forEach((b) => b.addEventListener('click', () => { const u = equippedUid(b.dataset.slot); if (u) openItem(u); else { invFilter = b.dataset.slot; renderInv(body); } }));
  }

  async function openItem(uid) {
    const v = invItem(uid);
    if (!v) return;
    const d = def(v.itemId), r = rar(d.r);
    const eq = isEquipped(v);
    const locked = isLocked(v);
    const listing = v.listing ? me.myListings.find((l) => l.id === v.listing) : null;
    let sell = '';
    if (listing) sell = `<div class="mk-note">🏷️ Выставлен за <b>${fmt(listing.price)} 💠</b></div><button class="btn btn-danger" id="itCancel">Снять с продажи</button>`;
    else if (!canTrade()) sell = `<div class="mk-note">🔒 Продажа откроется после ${me.cfg.minWins} пройденных уровней (у вас ${me.verifiedWins})</div>`;
    else if (locked) sell = `<div class="mk-note">🔒 Защита от мошенников: продать можно через ${leftText(v.lockUntil - Date.now())}</div>`;
    else sell = `<p class="section-label">Продать на маркете</p><div class="a-row"><input class="a-input" id="itPrice" type="number" min="1" inputmode="numeric" placeholder="Цена в 💠" /><button class="btn btn-gold" id="itSell">Выставить</button></div><p class="muted tiny" id="itGet">Комиссия маркета ${Math.round(me.cfg.fee * 100)}%</p>`;
    $('itemBody').innerHTML = `
      <div class="item-hero" style="--rc:${r.color}">${pv(d, 120)}</div>
      <div class="drop-rarity" style="color:${r.color}">${esc(r.name)} · ${esc(I.TYPES[d.type].name)}</div>
      <h2>${v.shiny ? '✨ ' : ''}${esc(d.name)}</h2>
      <div class="muted tiny">Экземпляр #${v.serial}${me.minted && me.minted[v.itemId] ? ' из ' + me.minted[v.itemId] : ''}</div>
      ${qualityBar(v.q)}
      ${v.shiny ? `<div class="mk-note">✨ Сияющий: собрано фруктов с этим скином — <b>${fmt(v.counter)}</b></div>` : ''}
      <div class="mk-stats" id="itStats"><span>Цены загружаются...</span></div>
      ${!listing ? `<button class="btn ${eq ? 'btn-ghost' : 'btn-green'}" id="itEquip">${eq ? 'Снять' : 'Надеть'}</button>` : ''}
      ${sell}`;
    A.openModal('modalItem');
    const eqBtn = $('itEquip');
    if (eqBtn) eqBtn.onclick = async () => { if (await equip(eq ? null : v.uid, d.type)) A.closeModal('modalItem'); };
    if ($('itCancel')) $('itCancel').onclick = async () => {
      const res = await post('/api/market/cancel', { listingId: listing.id });
      if (!res.ok) return A.showToast('⚠️ ' + errText(res));
      A.showToast('Снято с продажи'); A.closeModal('modalItem'); await refresh();
    };
    if ($('itPrice')) {
      const inp = $('itPrice');
      inp.oninput = () => { const p = Math.floor(Number(inp.value) || 0); const fee = p >= 2 ? Math.max(1, Math.floor(p * me.cfg.fee)) : 0; $('itGet').textContent = p ? `Вы получите ${fmt(p - fee)} 💠 (комиссия ${fee})` : `Комиссия маркета ${Math.round(me.cfg.fee * 100)}%`; };
      $('itSell').onclick = async () => {
        const price = Math.floor(Number(inp.value) || 0);
        if (price < 1) return A.showToast('Введите цену');
        const res = await post('/api/market/list', { uid: v.uid, price });
        if (!res.ok) return A.showToast('⚠️ ' + errText(res));
        A.Sound.coin(); A.haptic('success'); A.showToast('🏷️ Выставлено на маркет!');
        A.closeModal('modalItem'); summaryAt = 0; await refresh();
      };
    }
    const st = await A.api('/api/market/item/' + encodeURIComponent(v.itemId));
    if (st.ok && $('itStats')) {
      const s = st.data.stats;
      $('itStats').innerHTML = `<span>Мин. цена<b>${s.min != null ? fmt(s.min) + ' 💠' : '—'}</b></span><span>Медиана<b>${s.median != null ? fmt(s.median) + ' 💠' : '—'}</b></span><span>Продано 24ч<b>${s.sold24h}</b></span>`;
      if ($('itPrice') && !$('itPrice').value) $('itPrice').placeholder = s.min ? `напр. ${Math.max(1, s.min - 1)}` : (s.median ? `напр. ${s.median}` : 'Цена в 💠');
    }
  }

  /* ---------------- Маркет ---------------- */
  async function loadSummary() {
    if (summary && Date.now() - summaryAt < 15000) return summary;
    const r = await A.api('/api/market/summary');
    if (r.ok) { summary = r.data; summaryAt = Date.now(); }
    return summary;
  }
  async function renderMarket(body) {
    body.innerHTML = `<div class="a-row"><input class="a-input" id="mkSearch" placeholder="🔍 Поиск предмета" value="${esc(mkQuery)}" /></div>
      <div class="tabs mini-tabs">${[['all', 'Все']].concat(Object.keys(I.TYPES).map((k) => [k, I.TYPES[k].icon])).map(([k, n]) => `<button class="tab ${mkType === k ? 'active' : ''}" data-mf="${k}">${n}</button>`).join('')}</div>
      <p class="muted tiny">Цены задают игроки. Комиссия ${me ? Math.round(me.cfg.fee * 100) : 10}% сгорает — это держит экономику стабильной.</p>
      <div id="mkList"><p class="empty">Загрузка...</p></div>`;
    $('mkSearch').oninput = (e) => { mkQuery = e.target.value; drawList(); };
    qsa('[data-mf]', body).forEach((b) => b.addEventListener('click', () => { mkType = b.dataset.mf; renderMarket(body); }));
    await loadSummary();
    drawList();
    function drawList() {
      const box = $('mkList');
      if (!box) return;
      const stats = (summary && summary.stats) || {};
      const q = mkQuery.trim().toLowerCase();
      const list = I.ITEMS.filter((d) => (mkType === 'all' || d.type === mkType) && (!q || d.name.toLowerCase().includes(q)))
        .sort((a, b) => ((stats[b.id] && stats[b.id].listings) ? 1 : 0) - ((stats[a.id] && stats[a.id].listings) ? 1 : 0) || b.r - a.r);
      box.innerHTML = list.map((d) => {
        const s = stats[d.id] || {}, r = rar(d.r);
        return `<button class="mk-row" data-item="${d.id}" style="--rc:${r.color}">${pv(d, 44)}<span class="mk-name"><b>${esc(d.name)}</b><small style="color:${r.color}">${esc(r.name)}</small></span>
          <span class="mk-price">${s.min != null ? `<b>${fmt(s.min)} 💠</b><small>${s.listings} лот.</small>` : `<b class="muted">—</b><small>${s.median != null ? 'медиана ' + fmt(s.median) : 'нет лотов'}</small>`}</span></button>`;
      }).join('') || '<p class="empty">Ничего не найдено</p>';
      qsa('.mk-row', box).forEach((b) => b.addEventListener('click', () => openMarketItem(b.dataset.item)));
    }
  }
  async function openMarketItem(itemId) {
    const d = def(itemId), r = rar(d.r);
    $('itemBody').innerHTML = `<div class="item-hero" style="--rc:${r.color}">${pv(d, 110)}</div>
      <div class="drop-rarity" style="color:${r.color}">${esc(r.name)} · ${esc(I.TYPES[d.type].name)}</div><h2>${esc(d.name)}</h2>
      <div id="miBody"><p class="empty">Загрузка...</p></div>`;
    A.openModal('modalItem');
    const res = await A.api('/api/market/item/' + encodeURIComponent(itemId));
    const box = $('miBody');
    if (!box) return;
    if (!res.ok) { box.innerHTML = `<p class="empty">${esc(errText(res))}</p>`; return; }
    const s = res.data.stats;
    box.innerHTML = `<div class="mk-stats"><span>Мин. цена<b>${s.min != null ? fmt(s.min) + ' 💠' : '—'}</b></span><span>Медиана<b>${s.median != null ? fmt(s.median) + ' 💠' : '—'}</b></span><span>Выпущено<b>${res.data.minted}${d.limit ? '/' + d.limit : ''}</b></span></div>
      ${chart(res.data.history)}
      <p class="section-label">Лоты (${res.data.listings.length})</p>
      ${res.data.listings.length ? res.data.listings.map((l) => {
        const q = I.qualityOf(l.item.q), mine = l.seller === A.playerId;
        return `<div class="lot-row"><span class="lot-info"><b>${l.item.shiny ? '✨ ' : ''}${q.name}</b><small>${l.item.q.toFixed(4)} · #${l.item.serial} · ${mine ? 'ваш лот' : esc(l.sellerName)}</small></span>
          ${mine ? `<button class="btn btn-ghost" data-cancel="${l.id}">Снять</button>` : `<button class="btn btn-gold" data-buy="${l.id}" data-price="${l.price}">${fmt(l.price)} 💠</button>`}</div>`;
      }).join('') : '<p class="empty">Сейчас никто не продаёт.<br>Выбейте его на уровнях и выставьте первым!</p>'}`;
    qsa('[data-buy]', box).forEach((b) => b.addEventListener('click', async () => {
      const price = Number(b.dataset.price);
      if (!me || me.shards < price) {
        const go = await A.confirmBox('Не хватает самоцветов', `Нужно ${fmt(price)} 💠, у вас ${me ? fmt(me.shards) : 0}.`, '⭐ Пополнить');
        if (go) { A.closeModal('modalItem'); tab = 'stars'; A.showScreen('screenMarket'); }
        return;
      }
      if (!(await A.confirmBox('Купить предмет?', `${d.name} за ${fmt(price)} 💠`, `Купить за ${fmt(price)} 💠`))) return;
      const rr = await post('/api/market/buy', { listingId: b.dataset.buy, expectPrice: price });
      if (!rr.ok) { A.showToast('⚠️ ' + errText(rr)); openMarketItem(itemId); return; }
      A.Sound.win(); A.haptic('success'); A.rainConfetti(50);
      A.showToast('🎉 Предмет в вашем инвентаре!');
      summaryAt = 0; await refresh(); openMarketItem(itemId);
    }));
    qsa('[data-cancel]', box).forEach((b) => b.addEventListener('click', async () => {
      const rr = await post('/api/market/cancel', { listingId: b.dataset.cancel });
      if (!rr.ok) return A.showToast('⚠️ ' + errText(rr));
      A.showToast('Снято с продажи'); summaryAt = 0; await refresh(); openMarketItem(itemId);
    }));
  }

  /* ---------------- Обмены ---------------- */
  function miniList(items, shards) {
    const parts = items.map((v) => { if (v.gone) return '<span class="mini gone">❔ недоступен</span>'; const d = def(v.itemId); return `<span class="mini" style="--rc:${rar(d.r).color}">${pv(d, 26)}${esc(d.name)}</span>`; });
    if (shards) parts.push(`<span class="mini">💠 ${fmt(shards)}</span>`);
    return parts.join('') || '<span class="muted tiny">ничего</span>';
  }
  function renderTrades(body) {
    const tr = me.trades || [];
    const mine = (t) => t.from === A.playerId;
    const tcard = (t) => {
      const incoming = !mine(t);
      const get_ = incoming ? miniList(t.give, t.giveShards) : miniList(t.want, t.wantShards);
      const give_ = incoming ? miniList(t.want, t.wantShards) : miniList(t.give, t.giveShards);
      const st = { pending: '⏳ ожидает', done: '✅ завершён', declined: '❌ отклонён', canceled: '🚫 отменён', failed: '⚠️ не состоялся' }[t.status] || t.status;
      return `<div class="trade-cardx"><div class="tr-head"><b>${incoming ? 'От ' + esc(t.fromName) : 'Для ' + esc(t.toName)}</b><small>${st}</small></div>
        ${t.msg ? `<p class="muted tiny">«${esc(t.msg)}»</p>` : ''}
        <div class="tr-side"><small>Вы получите</small><div>${get_}</div></div><div class="tr-side"><small>Вы отдадите</small><div>${give_}</div></div>
        ${t.status === 'pending' ? (incoming ? `<div class="btn-row"><button class="btn btn-danger" data-tr="${t.id}" data-act="decline">Отклонить</button><button class="btn btn-green" data-tr="${t.id}" data-act="accept">Принять</button></div>` : `<button class="btn btn-ghost" data-tr="${t.id}" data-act="cancel">Отменить</button>`) : ''}</div>`;
    };
    const inc = tr.filter((t) => t.status === 'pending' && !mine(t)), out = tr.filter((t) => t.status === 'pending' && mine(t)), hist = tr.filter((t) => t.status !== 'pending');
    body.innerHTML = `<button class="btn btn-primary" id="trNew">➕ Предложить обмен</button>
      ${!canTrade() ? `<p class="mk-note">🔒 Обмены откроются после ${me.cfg.minWins} пройденных уровней (у вас ${me.verifiedWins})</p>` : ''}
      <p class="section-label">Входящие (${inc.length})</p>${inc.map(tcard).join('') || '<p class="muted tiny">Нет входящих предложений</p>'}
      <p class="section-label">Исходящие (${out.length})</p>${out.map(tcard).join('') || '<p class="muted tiny">Нет исходящих предложений</p>'}
      ${hist.length ? `<p class="section-label">История</p>${hist.map(tcard).join('')}` : ''}`;
    $('trNew').onclick = () => openTradeComposer();
    qsa('[data-tr]', body).forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.act === 'accept' && !(await A.confirmBox('Принять обмен?', 'Предметы сразу перейдут к новым владельцам.', 'Принять'))) return;
      const r = await post('/api/trade/respond', { id: b.dataset.tr, action: b.dataset.act });
      if (!r.ok) A.showToast('⚠️ ' + errText(r));
      else { A.showToast(b.dataset.act === 'accept' ? '✅ Обмен совершён!' : 'Готово'); if (b.dataset.act === 'accept') { A.Sound.win(); A.rainConfetti(40); } }
      await refresh();
    }));
  }
  const tc = { partner: null, theirs: [], give: new Set(), want: new Set() };
  function openTradeComposer(preset) {
    tc.partner = null; tc.theirs = []; tc.give = new Set(preset ? [preset] : []); tc.want = new Set();
    drawComposer();
    A.openModal('modalTrade');
  }
  function drawComposer() {
    const box = $('tradeBody');
    const mineTradable = me.inventory.filter((v) => !v.listing);
    if (!tc.partner) {
      box.innerHTML = `<h2>🔄 Новый обмен</h2><p class="muted">Введите @username или ID игрока</p>
        <div class="a-row"><input class="a-input" id="tcWho" placeholder="@username или 123456789" /><button class="btn btn-primary" id="tcFind">Найти</button></div>
        <p class="muted tiny">Свой ID можно найти в ⚙️ Настройках. Новые предметы нельзя передать ${me.cfg.lockHours} ч — это защита от мошенников.</p>`;
      $('tcFind').onclick = async () => {
        const who = $('tcWho').value.trim();
        if (!who) return;
        const r = await get('/api/eco/inventory/' + encodeURIComponent(who));
        if (!r.ok) return A.showToast('⚠️ ' + errText(r));
        if (r.data.player.id === A.playerId) return A.showToast('Это вы 🙂');
        tc.partner = r.data.player; tc.theirs = r.data.inventory;
        drawComposer();
      };
      return;
    }
    const grid = (items, set, side) => items.length ? `<div class="it-grid small">${items.map((v) => card(v, { sel: set.has(v.uid), dis: isLocked(v), size: 38 })).join('')}</div>` : '<p class="muted tiny">Нет предметов</p>';
    box.innerHTML = `<h2>🔄 Обмен с ${esc(tc.partner.name)} ${tc.partner.badge || ''}</h2>
      <p class="section-label">Вы отдаёте (${tc.give.size})</p><div data-side="give">${grid(mineTradable, tc.give)}</div>
      <div class="a-row"><span class="muted">+ 💠</span><input class="a-input" id="tcGiveSh" type="number" min="0" placeholder="0" /></div>
      <p class="section-label">Вы просите (${tc.want.size})</p><div data-side="want">${grid(tc.theirs, tc.want)}</div>
      <div class="a-row"><span class="muted">+ 💠</span><input class="a-input" id="tcWantSh" type="number" min="0" placeholder="0" /></div>
      <input class="a-input" id="tcMsg" maxlength="120" placeholder="Сообщение (необязательно)" />
      <button class="btn btn-primary" id="tcSend">Отправить предложение</button>`;
    ['give', 'want'].forEach((side) => qsa(`[data-side="${side}"] .it-card`, box).forEach((b) => b.addEventListener('click', () => {
      if (b.classList.contains('dis')) return A.showToast('🔒 Этот предмет пока нельзя обменять');
      const set = tc[side];
      if (set.has(b.dataset.uid)) set.delete(b.dataset.uid); else set.add(b.dataset.uid);
      b.classList.toggle('sel');
      const lbl = b.closest('[data-side]').previousElementSibling;
      if (lbl) lbl.textContent = (side === 'give' ? 'Вы отдаёте' : 'Вы просите') + ` (${set.size})`;
    })));
    $('tcSend').onclick = async () => {
      const body = { to: tc.partner.id, give: Array.from(tc.give), want: Array.from(tc.want), giveShards: Number($('tcGiveSh').value) || 0, wantShards: Number($('tcWantSh').value) || 0, msg: $('tcMsg').value };
      const r = await post('/api/trade/offer', body);
      if (!r.ok) return A.showToast('⚠️ ' + errText(r));
      A.closeModal('modalTrade'); A.Sound.coin(); A.showToast('📨 Предложение отправлено! Игрок получит уведомление в боте');
      tab = 'trades'; await refresh(); render();
    };
  }

  /* ---------------- Контракт обмена ---------------- */
  function renderTradeup(body) {
    const eligible = (r) => me.inventory.filter((v) => !v.listing && def(v.itemId).r === r);
    Array.from(tuSel).forEach((u) => { const v = invItem(u); if (!v || v.listing || def(v.itemId).r !== tuRarity) tuSel.delete(u); });
    const list = eligible(tuRarity);
    const next = I.dropPool(tuRarity + 1);
    body.innerHTML = `<div class="mk-note">🧪 <b>Контракт обмена</b>: отдайте 10 предметов одной редкости — получите 1 случайный предмет <b>редкостью выше</b>. Качество нового предмета — среднее от вложенных.</div>
      <div class="tabs mini-tabs">${[0, 1, 2, 3, 4].map((r) => `<button class="tab ${tuRarity === r ? 'active' : ''}" data-tu="${r}" style="${tuRarity === r ? '' : 'color:' + rar(r).color}">${esc(rar(r).name)} (${eligible(r).length})</button>`).join('')}</div>
      <p class="section-label">Выбрано ${tuSel.size}/10</p>
      ${list.length ? `<div class="it-grid small">${list.map((v) => card(v, { sel: tuSel.has(v.uid), size: 38 })).join('')}</div>` : '<p class="muted tiny">Нет предметов этой редкости</p>'}
      <div class="btn-row"><button class="btn btn-ghost" id="tuAuto">Выбрать 10</button><button class="btn btn-primary" id="tuGo" ${tuSel.size === 10 ? '' : 'disabled'}>🧪 Подписать</button></div>
      <p class="section-label">Возможный результат: <span style="color:${rar(tuRarity + 1).color}">${esc(rar(tuRarity + 1).name)}</span></p>
      <div class="it-grid small">${next.map((d) => `<div class="it-card" style="--rc:${rar(d.r).color}">${pv(d, 38)}<b>${esc(d.name)}</b></div>`).join('')}</div>`;
    qsa('[data-tu]', body).forEach((b) => b.addEventListener('click', () => { tuRarity = Number(b.dataset.tu); tuSel.clear(); renderTradeup(body); }));
    qsa('.it-card[data-uid]', body).forEach((b) => b.addEventListener('click', () => {
      const u = b.dataset.uid;
      if (tuSel.has(u)) tuSel.delete(u); else if (tuSel.size < 10) tuSel.add(u); else return A.showToast('Уже выбрано 10');
      renderTradeup(body);
    }));
    $('tuAuto').onclick = () => { tuSel.clear(); list.slice().sort((a, b) => b.q - a.q).slice(0, 10).forEach((v) => tuSel.add(v.uid)); renderTradeup(body); };
    $('tuGo').onclick = async () => {
      if (!(await A.confirmBox('Подписать контракт?', '10 предметов будут обменяны на 1 предмет редкостью выше. Отменить нельзя.', 'Подписать'))) return;
      const r = await post('/api/eco/tradeup', { uids: Array.from(tuSel) });
      if (!r.ok) return A.showToast('⚠️ ' + errText(r));
      tuSel.clear();
      await refresh();
      await showDrop(r.data.item, { title: '🧪 Результат контракта', pool: next });
      renderBody();
    };
  }

  /* ---------------- Донат за Telegram Stars ---------------- */
  function renderStarsShop(body) {
    const P = I.STARS_PRODUCTS;
    const soldOut = new Set((me && me.soldOut) || []);
    const once = new Set((me && me.once) || []);
    const prodCard = (p) => {
      const d = p.itemId ? def(p.itemId) : null;
      const done = p.once && once.has(p.id);
      const out = d && soldOut.has(d.id);
      const left = d && d.limit ? Math.max(0, d.limit - ((me && me.minted && me.minted[d.id]) || 0)) : null;
      return `<div class="product${d ? ' excl' : ''}${p.legendary ? ' legendary-product' : ''}"${d ? ` style="--rc:${rar(d.r).color}"` : ''}>${p.tag ? `<span class="p-tag">${esc(p.tag)}</span>` : ''}
        <div class="p-ico">${d ? pv(d, 50) : p.icon}</div><div class="p-name">${esc(p.title)}</div>
        <div class="p-desc">${esc(p.desc)}${left != null ? `<br><b style="color:var(--gold)">Осталось ${left} шт.</b>` : ''}</div>
        <button class="btn btn-stars" data-buy="${p.id}" ${done || out ? 'disabled' : ''}>${done ? 'Куплено' : out ? 'Распродано' : '⭐ ' + p.stars}</button></div>`;
    };
    body.innerHTML = `<div class="hero-deal pink"><span class="h-ico">⭐</span><div class="h-text"><b>Поддержите игру через Telegram Stars</b><small>Оплата картой или Apple/Google Pay прямо в Telegram</small></div></div>
      <p class="section-label">☢️ Легендарные бустеры</p><p class="muted tiny" style="margin:-4px 0 8px">Мощные, эффектные, не тратят ходы. Очень редко выпадают и в игре!</p><div class="shop-grid">${P.filter((p) => p.legendary).map(prodCard).join('')}</div>
      <p class="section-label">★ Эксклюзивы (ограниченный тираж)</p><div class="shop-grid">${P.filter((p) => p.itemId).map(prodCard).join('')}</div>
      <p class="section-label">💠 Самоцветы — валюта маркета</p><div class="shop-grid">${P.filter((p) => p.grant.shards && !p.grant.soft && !p.itemId).map(prodCard).join('')}</div>
      <p class="section-label">Наборы и VIP</p><div class="shop-grid">${P.filter((p) => !p.itemId && !p.legendary && (p.grant.soft || p.grant.vipDays)).map(prodCard).join('')}</div>
      <p class="muted tiny" style="margin-top:14px">Самоцветы и предметы — игровые ценности, они не обмениваются на реальные деньги. Вопросы по оплате: команда /paysupport в боте.</p>`;
    qsa('[data-buy]', body).forEach((b) => b.addEventListener('click', () => buyStars(b.dataset.buy)));
  }
  async function buyStars(productId) {
    if (guest) return A.showToast('Покупки доступны внутри Telegram');
    const p = I.STARS_PRODUCTS.find((x) => x.id === productId);
    const r = await post('/api/stars/invoice', { productId });
    if (!r.ok) return A.showToast('⚠️ ' + errText(r));
    if (r.data.dev) {
      if (!(await A.confirmBox('Тестовая оплата', `BOT_TOKEN не задан — имитировать оплату «${p.title}» (⭐${p.stars})?`, 'Оплатить (тест)'))) return;
      const d = await post('/api/stars/dev-pay', { productId });
      if (!d.ok) return A.showToast('⚠️ ' + errText(d));
      return afterPaid();
    }
    const tg = A.tg;
    if (tg && tg.openInvoice) {
      tg.openInvoice(r.data.link, (status) => {
        if (status === 'paid') afterPaid();
        else if (status === 'failed') A.showToast('❌ Оплата не прошла');
      });
    } else window.open(r.data.link, '_blank');
  }
  async function afterPaid() {
    A.showToast('⭐ Оплата прошла! Зачисляем...');
    const before = JSON.stringify([me && me.shards, me && me.inventory && me.inventory.length, me && me.vipUntil, me && me.once, me && me.passSeason]);
    for (let i = 0; i < 8; i++) {
      await wait(i ? 1500 : 400);
      await refresh();
      if (JSON.stringify([me && me.shards, me && me.inventory && me.inventory.length, me && me.vipUntil, me && me.once, me && me.passSeason]) !== before || (me && me.grants && me.grants.length)) break;
    }
    A.Sound.win(); A.haptic('success'); A.rainConfetti(90);
    A.renderShop();
    if (A.onPaid) A.onPaid();
    if (A.currentScreen === 'screenMarket') render();
  }

  /* ---------------- Админка экономики ---------------- */
  async function renderAdminEco(body) {
    const r = await get('/api/admin/eco');
    if (!r.ok) { body.innerHTML = `<p class="empty">${esc(errText(r))}</p>`; return; }
    const s = r.data.stats, cfg = r.data.cfg;
    const stat = (l, v) => `<div class="a-stat"><small>${l}</small><b>${v}</b></div>`;
    body.innerHTML = `<div class="a-stats">${stat('⭐ Stars всего', fmt(s.starsTotal))}${stat('⭐ За 30 дней', fmt(s.stars30d))}${stat('🧾 Платежей', s.payments)}${stat('💠 В игре', fmt(s.shardsInGame))}
      ${stat('🎒 Предметов', s.items)}${stat('🏷️ Лотов', s.listings)}${stat('🔁 Сделок 24ч', s.sales24h)}${stat('💹 Оборот 24ч', fmt(s.volume24h) + ' 💠')}${stat('🔥 Сожжено', fmt(s.burned) + ' 💠')}${stat('🔄 Обменов ждут', s.tradesPending)}</div>
      <p class="muted tiny">По редкостям: ${s.byRarity.map((n, i) => `<span style="color:${rar(i).color}">${n}</span>`).join(' · ')}<br>Настройки: комиссия ${Math.round(cfg.fee * 100)}%, блок ${cfg.lockHours} ч, торговля с ${cfg.minWins} побед, ${cfg.dailyRolls} дроп-роллов в день</p>
      <p class="section-label">🎁 Выдать игроку</p>
      <input class="a-input" id="aeWho" placeholder="ID или @username" />
      <div class="a-row"><select class="a-select" id="aeItem"><option value="">— без предмета —</option>${I.RARITIES.map((R) => `<optgroup label="${esc(R.name)}">${I.ITEMS.filter((d) => d.r === R.id).map((d) => `<option value="${d.id}">${esc(d.name)} (${esc(I.TYPES[d.type].name)})</option>`).join('')}</optgroup>`).join('')}</select></div>
      <div class="a-row"><input class="a-input" id="aeShards" type="number" placeholder="💠 самоцветы (можно −)" /><label class="muted tiny"><input type="checkbox" id="aeShiny" /> ✨</label><button class="btn btn-green" id="aeGive">Выдать</button></div>
      <p class="section-label">🧾 Последние платежи</p>
      ${r.data.recent.length ? r.data.recent.map((x) => `<div class="a-player"><div class="ap-info"><b>${esc(x.name)} · ⭐${x.stars}</b><small>${esc(x.product)} · ${new Date(x.at).toLocaleString('ru-RU')}${x.refunded ? ' · ↩️ возвращён' : ''}</small></div>${x.refunded ? '' : `<button class="btn btn-danger btn-small" data-refund="${x.id}">↩️</button>`}</div>`).join('') : '<p class="muted tiny">Платежей пока нет</p>'}`;
    $('aeGive').onclick = async () => {
      const res = await post('/api/admin/eco/grant', { target_id: $('aeWho').value.trim(), itemId: $('aeItem').value || null, shards: Number($('aeShards').value) || 0, shiny: $('aeShiny').checked });
      if (!res.ok) return A.showToast('⚠️ ' + errText(res));
      A.showToast('✅ Выдано! Баланс игрока: ' + fmt(res.data.shards) + ' 💠');
      if ($('aeWho').value.trim() === A.playerId) refresh();
    };
    qsa('[data-refund]', body).forEach((b) => b.addEventListener('click', async () => {
      if (!(await A.confirmBox('Вернуть Stars?', 'Stars вернутся покупателю, выданные самоцветы и предмет будут списаны.', 'Вернуть'))) return;
      const res = await post('/api/admin/eco/refund', { id: b.dataset.refund });
      if (!res.ok) return A.showToast('⚠️ ' + errText(res));
      A.showToast('↩️ Возврат выполнен'); renderAdminEco(body);
    }));
  }

  window.FBMarket = { render, setTab, refresh, startRun, finishRun, skinEmojis, boardBg, fxColor, myBadge, decorateAvatar, isVip, renderStarsShop, renderAdminEco, showDrop, buyStars, pv, def, rar, get me() { return me; } };
  updateDots();
})();
