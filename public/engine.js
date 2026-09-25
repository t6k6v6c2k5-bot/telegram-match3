/* =====================================================================
   FRUIT BLITZ — ИГРОВОЙ ДВИЖОК (чистая логика, без DOM)
   ---------------------------------------------------------------------
   Движок ничего не рисует: каждое действие игрока возвращает список
   "шагов" (swap / clear / fall / collect / transform / shuffle), которые
   game.js последовательно анимирует. Благодаря этому логику можно
   автоматически тестировать (см. test/sim.js) — проходимость уровней,
   отсутствие зависаний, корректность каскадов.
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FBEngine = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- Утилиты ---------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rInt(rng, n) { return Math.floor(rng() * n); }
  function shuffleArr(rng, arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = rInt(rng, i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  const K = (r, c) => r * 32 + c;
  const KR = (k) => (k / 32) | 0;
  const KC = (k) => k % 32;
  function grid(S, v) { return Array.from({ length: S }, () => Array(S).fill(v)); }

  let nextId = 1;
  function newTile(t, s) { return { id: nextId++, t: t, s: s || null }; }

  /* ---------------- Главы (по 10 уровней, бесконечно) ---------------- */
  const CHAPTERS = [
    { name: 'Клубничная Долина', emoji: '🍓', bg: ['#1e824c', '#35b36e'] },
    { name: 'Цитрусовый Остров', emoji: '🍊', bg: ['#d35400', '#f4b942'] },
    { name: 'Виноградные Холмы', emoji: '🍇', bg: ['#5b2c83', '#a569bd'] },
    { name: 'Тропический Рай', emoji: '🍍', bg: ['#0e6655', '#45c9a8'] },
    { name: 'Ягодный Лес', emoji: '🫐', bg: ['#1a4f7a', '#5dade2'] },
    { name: 'Сладкое Королевство', emoji: '🍭', bg: ['#a83268', '#f08fb5'] },
    { name: 'Космический Блитц', emoji: '🌌', bg: ['#1c1044', '#6c3ce0'] }
  ];
  const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  function chapterOf(level) {
    const idx = Math.floor((Math.max(1, level) - 1) / 10);
    const base = CHAPTERS[idx % CHAPTERS.length];
    const cycle = Math.floor(idx / CHAPTERS.length) + 1;
    return {
      index: idx, number: idx + 1,
      name: base.name + (cycle > 1 ? ' ' + (ROMAN[cycle] || cycle) : ''),
      emoji: base.emoji, bg: base.bg,
      firstLevel: idx * 10 + 1, lastLevel: idx * 10 + 10
    };
  }

  /* ---------------- Генерация уровня (детерминированная по номеру) ----------------
     Кривая сложности намеренно очень плавная:
       1–4   — только сбор фруктов, 4 цвета, поле 6×6 (обучение)
       5     — знакомство со льдом, 7 — с ингредиентами, 8 — с ящиками, 15 — с цепями
       дальше — случайный режим, объём целей растёт на ~0.4 фрукта за уровень
     Ограничения по ходам НЕТ — любой уровень проходим, от числа ходов зависят звёзды. */
  function levelConfig(n) {
    n = Math.max(1, Math.floor(n) || 1);
    const rng = mulberry32(n * 7919 + 1013);
    const size = n <= 3 ? 6 : (n <= 9 ? 7 : 8);
    const colors = n <= 6 ? 4 : (n <= 24 ? 5 : (n % 3 === 0 ? 6 : 5));
    const cfg = {
      level: n, size, colors, goals: [],
      ice: 0, iceDouble: 0, boxes: 0, boxDouble: 0, locks: 0, ingredients: 0,
      newMechanic: null, hard: n > 10 && n % 10 === 0
    };
    const order = shuffleArr(rng, Array.from({ length: colors }, (_, i) => i));
    const collect = (i, target) => cfg.goals.push({ type: 'collect', t: order[i % colors], target: Math.round(target) });
    const goal = (type) => cfg.goals.push({ type, target: 0 });

    switch (n) {
      case 1: collect(0, 8); cfg.newMechanic = 'swap'; break;
      case 2: collect(0, 10); collect(1, 10); break;
      case 3: cfg.goals.push({ type: 'score', target: 900 }); cfg.newMechanic = 'special'; break;
      case 4: collect(0, 13); collect(1, 13); break;
      case 5: cfg.ice = 6; goal('ice'); cfg.newMechanic = 'ice'; break;
      case 6: collect(0, 12); collect(1, 12); collect(2, 12); break;
      case 7: cfg.ingredients = 2; goal('ingredient'); cfg.newMechanic = 'ingredient'; break;
      case 8: cfg.boxes = 4; goal('box'); collect(0, 12); cfg.newMechanic = 'box'; break;
      case 9: cfg.ice = 10; goal('ice'); collect(1, 14); break;
      case 10: cfg.ingredients = 2; goal('ingredient'); collect(0, 15); break;
      default: {
        const t = n - 10;
        const fruit = Math.min(38, 13 + Math.floor(t * 0.4));
        const pool = ['collect', 'collect', 'ice', 'box', 'ingredient', 'score'];
        let mode = pool[rInt(rng, pool.length)];
        if (n === 15) mode = 'collect';
        if (mode === 'collect') {
          const k = n < 20 ? 2 : (rng() < 0.5 ? 2 : 3);
          for (let i = 0; i < k; i++) collect(i, fruit - (k === 3 ? 4 : 0));
        } else if (mode === 'ice') {
          cfg.ice = Math.min(36, 8 + Math.floor(t * 0.5));
          cfg.iceDouble = n >= 20 ? Math.min(0.5, (n - 20) * 0.015) : 0;
          goal('ice');
        } else if (mode === 'box') {
          cfg.boxes = Math.min(14, 4 + Math.floor(t / 4));
          cfg.boxDouble = n >= 25 ? Math.min(0.6, (n - 25) * 0.02) : 0;
          goal('box');
        } else if (mode === 'ingredient') {
          cfg.ingredients = Math.min(5, 2 + Math.floor(t / 15));
          goal('ingredient');
        } else {
          cfg.goals.push({ type: 'score', target: 1000 + t * 40 });
        }
        if (n >= 13 && mode !== 'collect' && rng() < 0.55) collect(3, fruit * 0.7);
        if (n >= 15 && mode !== 'ingredient' && (n === 15 || rng() < 0.45)) {
          cfg.locks = Math.min(12, 3 + Math.floor((n - 15) / 5));
          if (n === 15) cfg.newMechanic = 'lock';
        }
        if (cfg.hard) cfg.goals.forEach((g) => { if (g.target) g.target = Math.round(g.target * 1.2); });
      }
    }
    return cfg;
  }

  /* ---------------- Поле ---------------- */
  function inB(st, r, c) { return r >= 0 && c >= 0 && r < st.size && c < st.size; }
  function colorAt(st, r, c) {
    if (!inB(st, r, c)) return -99;
    const t = st.tiles[r][c];
    return (t && typeof t.t === 'number' && t.t >= 0) ? t.t : -99;
  }
  function isStatic(st, r, c) { return st.box[r][c] > 0 || st.lock[r][c]; }
  function isMovable(st, r, c) {
    return inB(st, r, c) && !!st.tiles[r][c] && st.box[r][c] === 0 && !st.lock[r][c];
  }
  function makesMatchAt(st, r, c, t) {
    return (colorAt(st, r, c - 1) === t && colorAt(st, r, c - 2) === t) ||
           (colorAt(st, r - 1, c) === t && colorAt(st, r - 2, c) === t);
  }

  function createBoard(cfg, opts) {
    opts = opts || {};
    const S = cfg.size;
    const seed = opts.seed != null ? opts.seed : ((Math.random() * 4294967296) >>> 0);
    const rng = mulberry32(seed);
    const st = {
      size: S, colors: cfg.colors, level: cfg.level, rng,
      tiles: grid(S, null), ice: grid(S, 0), box: grid(S, 0), lock: grid(S, false),
      moves: 0, score: 0, goals: [], par: 0,
      ingTarget: cfg.ingredients || 0, ingSpawned: 0, ingCollected: 0,
      stats: { cleared: 0, specials: 0, maxCombo: 1, boxes: 0, ice: 0 }
    };

    // Ящики — симметрично по горизонтали (выглядит как задуманный дизайн уровня)
    const cells = [];
    for (let r = 1; r < S - 1; r++) for (let c = 0; c < Math.ceil(S / 2); c++) cells.push([r, c]);
    shuffleArr(rng, cells);
    let placed = 0;
    for (const [r, c] of cells) {
      if (placed >= cfg.boxes) break;
      const hp = rng() < cfg.boxDouble ? 2 : 1;
      st.box[r][c] = hp; placed++;
      const m = S - 1 - c;
      if (m !== c && placed < cfg.boxes) { st.box[r][m] = hp; placed++; }
    }
    // Фрукты без стартовых совпадений
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        if (st.box[r][c]) continue;
        let t, tries = 0;
        do { t = rInt(rng, st.colors); tries++; } while (tries < 30 && makesMatchAt(st, r, c, t));
        st.tiles[r][c] = newTile(t);
      }
    }
    // Лёд под фруктами (тоже симметрично)
    const iceCells = [];
    for (let r = 0; r < S; r++) for (let c = 0; c < Math.ceil(S / 2); c++) if (!st.box[r][c]) iceCells.push([r, c]);
    shuffleArr(rng, iceCells);
    placed = 0;
    for (const [r, c] of iceCells) {
      if (placed >= cfg.ice) break;
      const layers = rng() < cfg.iceDouble ? 2 : 1;
      st.ice[r][c] = layers; placed++;
      const m = S - 1 - c;
      if (m !== c && placed < cfg.ice && !st.box[r][m]) { st.ice[r][m] = layers; placed++; }
    }
    // Цепи на фруктах (не в первом/последнем ряду)
    const lockCells = [];
    for (let r = 1; r < S - 1; r++) for (let c = 0; c < S; c++) if (st.tiles[r][c]) lockCells.push([r, c]);
    shuffleArr(rng, lockCells);
    for (let i = 0; i < Math.min(cfg.locks, lockCells.length); i++) st.lock[lockCells[i][0]][lockCells[i][1]] = true;
    // Ингредиенты в верхнем ряду
    if (st.ingTarget) {
      const cols = shuffleArr(rng, Array.from({ length: S }, (_, i) => i));
      const count = Math.min(2, st.ingTarget);
      for (let i = 0; i < count; i++) { st.tiles[0][cols[i]] = newTile('ING'); st.ingSpawned++; }
    }
    // Цели с фактическими значениями
    let iceCount = 0, boxCount = 0;
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) { if (st.ice[r][c]) iceCount++; if (st.box[r][c]) boxCount++; }
    for (const g of cfg.goals) {
      const G = { type: g.type, t: g.t, target: g.target, count: 0 };
      if (g.type === 'ice') G.target = iceCount;
      if (g.type === 'box') G.target = boxCount;
      if (g.type === 'ingredient') G.target = st.ingTarget;
      if (G.target > 0) st.goals.push(G);
    }
    if (!st.goals.length) st.goals.push({ type: 'collect', t: 0, target: 10, count: 0 });

    if (!hasValidMove(st)) shuffleBoard(st);

    // Стартовые бустеры (выбираются игроком перед уровнем)
    (opts.preBoosters || []).forEach((kind) => {
      const cand = [];
      for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
        const t = st.tiles[r][c];
        if (t && typeof t.t === 'number' && t.t >= 0 && !t.s && !st.lock[r][c]) cand.push(t);
      }
      if (!cand.length) return;
      const tile = cand[rInt(rng, cand.length)];
      if (kind === 'rocket') tile.s = rng() < 0.5 ? 'rh' : 'rv';
      else if (kind === 'bomb') tile.s = 'bomb';
      else if (kind === 'rainbow') { tile.s = 'rainbow'; tile.t = -1; }
    });

    st.par = computePar(st, cfg);
    return st;
  }

  /* Эталон ходов для 3 звёзд (откалиброван симуляцией в test/sim.js) */
  function computePar(st, cfg) {
    const S = st.size;
    const perMove = S >= 8 ? 6.2 : (S === 7 ? 5.6 : 5.0);
    let est = 0;
    for (const g of st.goals) {
      if (g.type === 'collect') est = Math.max(est, g.target * st.colors / perMove);
      else if (g.type === 'ice') est = Math.max(est, g.target * 0.95 + 4);
      else if (g.type === 'box') {
        let hp = 0;
        for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) hp += st.box[r][c];
        est = Math.max(est, hp * 0.9 + 3);
      } else if (g.type === 'ingredient') est = Math.max(est, g.target * S * 0.5 + 3);
      else if (g.type === 'score') est = Math.max(est, g.target / 150);
    }
    let par = Math.max(6, Math.round(est * 1.15));
    if (cfg && cfg.hard) par = Math.round(par * 1.1);
    return par;
  }

  /* ---------------- Поиск совпадений и спец-фишек ---------------- */
  function findMatches(st, prefer) {
    const S = st.size;
    const runs = [];
    for (let r = 0; r < S; r++) {
      let c = 0;
      while (c < S) {
        const col = colorAt(st, r, c);
        if (col < 0) { c++; continue; }
        let e = c + 1;
        while (e < S && colorAt(st, r, e) === col) e++;
        if (e - c >= 3) { const cells = []; for (let x = c; x < e; x++) cells.push(K(r, x)); runs.push({ dir: 'h', cells }); }
        c = e;
      }
    }
    for (let c = 0; c < S; c++) {
      let r = 0;
      while (r < S) {
        const col = colorAt(st, r, c);
        if (col < 0) { r++; continue; }
        let e = r + 1;
        while (e < S && colorAt(st, e, c) === col) e++;
        if (e - r >= 3) { const cells = []; for (let y = r; y < e; y++) cells.push(K(y, c)); runs.push({ dir: 'v', cells }); }
        r = e;
      }
    }
    const all = new Set();
    if (!runs.length) return { cells: all, specials: [] };

    const parent = runs.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const owner = new Map();
    runs.forEach((run, i) => run.cells.forEach((k) => {
      if (owner.has(k)) { const a = find(owner.get(k)), b = find(i); if (a !== b) parent[a] = b; }
      else owner.set(k, i);
    }));
    const groups = new Map();
    runs.forEach((run, i) => {
      const g = find(i);
      if (!groups.has(g)) groups.set(g, { runs: [], cells: new Set() });
      const G = groups.get(g);
      G.runs.push(run);
      run.cells.forEach((k) => { G.cells.add(k); all.add(k); });
    });

    const specials = [];
    for (const G of groups.values()) {
      const hRuns = G.runs.filter((x) => x.dir === 'h');
      const vRuns = G.runs.filter((x) => x.dir === 'v');
      const longest = G.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
      let kind = null;
      let inter = null;
      if (hRuns.length && vRuns.length) {
        const hSet = new Set(); hRuns.forEach((x) => x.cells.forEach((k) => hSet.add(k)));
        for (const v of vRuns) { for (const k of v.cells) if (hSet.has(k)) { inter = k; break; } if (inter !== null) break; }
      }
      if (longest.cells.length >= 5) kind = 'rainbow';
      else if (inter !== null) kind = 'bomb';
      else if (longest.cells.length === 4) kind = longest.dir === 'h' ? 'rh' : 'rv';
      if (!kind) continue;
      let pos;
      if (prefer) for (const p of prefer) if (G.cells.has(p)) { pos = p; break; }
      if (pos === undefined) pos = (kind === 'bomb' && inter !== null) ? inter : longest.cells[(longest.cells.length / 2) | 0];
      const color = colorAt(st, KR(pos), KC(pos));
      specials.push({ k: pos, s: kind, t: kind === 'rainbow' ? -1 : color });
    }
    return { cells: all, specials };
  }

  function mostCommonColor(st) {
    const cnt = new Array(st.colors).fill(0);
    for (let r = 0; r < st.size; r++) for (let c = 0; c < st.size; c++) {
      const t = st.tiles[r][c];
      if (t && typeof t.t === 'number' && t.t >= 0 && t.t < st.colors) cnt[t.t]++;
    }
    let best = -1, bc = 0;
    cnt.forEach((v, i) => { if (v > bc) { bc = v; best = i; } });
    return best;
  }

  function areaFor(st, r, c, s, color) {
    const S = st.size, out = [K(r, c)];
    if (s === 'rh') { for (let x = 0; x < S; x++) out.push(K(r, x)); }
    else if (s === 'rv') { for (let y = 0; y < S; y++) out.push(K(y, c)); }
    else if (s === 'bomb' || s === 'bomb2') {
      const R = s === 'bomb' ? 1 : 2;
      for (let y = r - R; y <= r + R; y++) for (let x = c - R; x <= c + R; x++) if (inB(st, y, x)) out.push(K(y, x));
    } else if (s === 'rainbow') {
      const col = (color != null && color >= 0) ? color : mostCommonColor(st);
      if (col >= 0) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const t = st.tiles[y][x]; if (t && t.t === col) out.push(K(y, x)); }
    }
    return out;
  }

  function goalAdd(st, type, amount, t) {
    for (const g of st.goals) {
      if (g.type !== type) continue;
      if (type === 'collect' && g.t !== t) continue;
      g.count = Math.min(g.target, g.count + amount);
    }
  }

  /* ---------------- Очистка клеток (+ цепная реакция спец-фишек) ---------------- */
  function resolveClear(st, spec) {
    const cells = new Set(spec.cells);
    const fired = new Set(spec.preFired || []);
    const explosions = [];
    const queue = Array.from(cells);
    while (queue.length) {
      const k = queue.shift();
      const r = KR(k), c = KC(k);
      const tile = st.tiles[r][c];
      if (!tile || !tile.s || fired.has(k)) continue;
      fired.add(k);
      explosions.push({ r, c, s: tile.s });
      for (const a of areaFor(st, r, c, tile.s, null)) if (!cells.has(a)) { cells.add(a); queue.push(a); }
    }

    const cleared = [], iceHits = [], boxHits = [], lockBreaks = [];
    let score = 0;
    const boxDone = new Set();
    const hitBox = (r, c) => {
      const k = K(r, c);
      if (boxDone.has(k) || st.box[r][c] <= 0) return;
      boxDone.add(k);
      st.box[r][c]--;
      boxHits.push({ r, c, left: st.box[r][c] });
      score += 20;
      if (st.box[r][c] === 0) { goalAdd(st, 'box', 1); st.stats.boxes++; }
    };
    for (const k of cells) {
      const r = KR(k), c = KC(k);
      if (st.box[r][c] > 0) { hitBox(r, c); continue; }
      const tile = st.tiles[r][c];
      if (tile && tile.t === 'ING') continue;
      if (tile) {
        cleared.push({ id: tile.id, r, c, t: tile.t, s: tile.s });
        score += tile.s ? 30 : 10;
        if (typeof tile.t === 'number' && tile.t >= 0) { goalAdd(st, 'collect', 1, tile.t); st.stats.cleared++; }
        st.tiles[r][c] = null;
      }
      if (st.lock[r][c]) { st.lock[r][c] = false; lockBreaks.push({ r, c }); score += 15; }
      if (st.ice[r][c] > 0) {
        st.ice[r][c]--;
        iceHits.push({ r, c, left: st.ice[r][c] });
        score += 15;
        if (st.ice[r][c] === 0) { goalAdd(st, 'ice', 1); st.stats.ice++; }
      }
    }
    if (spec.matchCells) {
      for (const k of spec.matchCells) {
        const r = KR(k), c = KC(k);
        [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([y, x]) => { if (inB(st, y, x)) hitBox(y, x); });
      }
    }
    const created = [];
    for (const cs of (spec.created || [])) {
      const r = KR(cs.k), c = KC(cs.k);
      if (st.box[r][c] > 0 || st.tiles[r][c]) continue;
      const tile = newTile(cs.t, cs.s);
      st.tiles[r][c] = tile;
      created.push({ id: tile.id, r, c, t: tile.t, s: tile.s });
      st.stats.specials++;
    }
    const combo = spec.combo || 1;
    st.stats.maxCombo = Math.max(st.stats.maxCombo, combo);
    score = Math.round(score * (1 + (combo - 1) * 0.5));
    st.score += score;
    for (const g of st.goals) if (g.type === 'score') g.count = Math.min(g.target, st.score);
    return { kind: 'clear', cleared, created, explosions, iceHits, boxHits, lockBreaks, score, combo };
  }

  /* ---------------- Гравитация и досыпка ---------------- */
  function canSpawnIng(st) {
    if (!st.ingTarget) return false;
    const onBoard = st.ingSpawned - st.ingCollected;
    return st.ingSpawned < st.ingTarget && onBoard < 2 && st.rng() < 0.35;
  }
  function applyGravity(st) {
    const S = st.size, moves = [], spawns = [];
    for (let c = 0; c < S; c++) {
      let r = S - 1;
      while (r >= 0) {
        if (isStatic(st, r, c)) { r--; continue; }
        let top = r;
        while (top - 1 >= 0 && !isStatic(st, top - 1, c)) top--;
        let write = r;
        for (let y = r; y >= top; y--) {
          const t = st.tiles[y][c];
          if (!t) continue;
          if (y !== write) { st.tiles[write][c] = t; st.tiles[y][c] = null; moves.push({ id: t.id, c, fromR: y, toR: write }); }
          write--;
        }
        const m = write - top + 1;
        for (let y = write; y >= top; y--) {
          let tile;
          if (top === 0 && canSpawnIng(st)) { tile = newTile('ING'); st.ingSpawned++; }
          else tile = newTile(rInt(st.rng, st.colors));
          st.tiles[y][c] = tile;
          spawns.push({ id: tile.id, c, toR: y, fromR: y - m, t: tile.t, s: null });
        }
        r = top - 1;
      }
    }
    return { kind: 'fall', moves, spawns };
  }
  function collectIngredients(st) {
    const items = [];
    const r = st.size - 1;
    for (let c = 0; c < st.size; c++) {
      const t = st.tiles[r][c];
      if (t && t.t === 'ING') {
        items.push({ id: t.id, r, c });
        st.tiles[r][c] = null;
        st.ingCollected++;
        goalAdd(st, 'ingredient', 1);
      }
    }
    return items.length ? { kind: 'collect', items } : null;
  }

  /* «Тяжёлый» ингредиент: сгорание в его колонке проталкивает его на 1 клетку вниз */
  function sinkIngredients(st, clearStep) {
    if (!st.ingTarget) return null;
    const cols = new Set();
    clearStep.cleared.forEach((x) => cols.add(x.c));
    clearStep.boxHits.forEach((x) => cols.add(x.c));
    const moves = [];
    for (const c of cols) {
      for (let r = st.size - 2; r >= 0; r--) {
        const t = st.tiles[r][c];
        if (!t || t.t !== 'ING') continue;
        const below = st.tiles[r + 1][c];
        if (!below || isStatic(st, r + 1, c) || below.t === 'ING') continue;
        st.tiles[r + 1][c] = t; st.tiles[r][c] = below;
        moves.push({ id: t.id, c, fromR: r, toR: r + 1 }, { id: below.id, c, fromR: r + 1, toR: r });
        break;
      }
    }
    return moves.length ? { kind: 'fall', moves, spawns: [] } : null;
  }

  /* ---------------- Полное разрешение хода (каскады) ---------------- */
  function runCascade(st, first) {
    const steps = [];
    let spec = first, combo = 1, guard = 0;
    while (spec && guard++ < 80) {
      spec.combo = combo;
      const clearStep = resolveClear(st, spec);
      steps.push(clearStep);
      let sunk = false;
      for (let g = 0; g < 30; g++) {
        const f = applyGravity(st);
        if (f.moves.length || f.spawns.length) steps.push(f);
        if (!sunk) {
          sunk = true;
          const sink = sinkIngredients(st, clearStep);
          if (sink) steps.push(sink);
        }
        const col = collectIngredients(st);
        if (col) steps.push(col); else break;
      }
      const m = findMatches(st, null);
      if (m.cells.size) { spec = { cells: m.cells, created: m.specials, matchCells: m.cells }; combo++; }
      else spec = null;
    }
    if (!isComplete(st) && !hasValidMove(st)) steps.push(shuffleBoard(st));
    return steps;
  }

  /* ---------------- Действия игрока ---------------- */
  function comboSpec(st, ta, tb, a, b) {
    // ta теперь стоит в b, tb — в a
    const kA = K(b.r, b.c), kB = K(a.r, a.c);
    const cells = new Set([kA, kB]);
    const preFired = new Set();
    const add = (arr) => arr.forEach((k) => cells.add(k));
    const rb = (t) => t.s === 'rainbow';
    const S = st.size;
    if (rb(ta) && rb(tb)) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) cells.add(K(y, x));
      preFired.add(kA); preFired.add(kB);
      return { cells, preFired, created: [], matchCells: null };
    }
    if (rb(ta) || rb(tb)) {
      const other = rb(ta) ? tb : ta;
      const rainK = rb(ta) ? kA : kB;
      preFired.add(rainK);
      const col = (typeof other.t === 'number' && other.t >= 0) ? other.t : mostCommonColor(st);
      if (other.s && other.s !== 'rainbow' && col >= 0) {
        const trans = [];
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const t = st.tiles[y][x];
          if (t && t.t === col && !t.s) {
            t.s = other.s === 'bomb' ? 'bomb' : (st.rng() < 0.5 ? 'rh' : 'rv');
            trans.push({ id: t.id, s: t.s, t: t.t, r: y, c: x });
            cells.add(K(y, x));
          }
        }
        return { cells, preFired, created: [], matchCells: null, transform: trans.length ? { kind: 'transform', tiles: trans } : null };
      }
      add(areaFor(st, KR(rainK), KC(rainK), 'rainbow', col));
      return { cells, preFired, created: [], matchCells: null };
    }
    preFired.add(kA); preFired.add(kB);
    const isR = (s) => s === 'rh' || s === 'rv';
    if (isR(ta.s) && isR(tb.s)) { add(areaFor(st, b.r, b.c, 'rh')); add(areaFor(st, b.r, b.c, 'rv')); }
    else if (ta.s === 'bomb' && tb.s === 'bomb') add(areaFor(st, b.r, b.c, 'bomb2'));
    else {
      for (let d = -1; d <= 1; d++) {
        if (b.r + d >= 0 && b.r + d < S) add(areaFor(st, b.r + d, b.c, 'rh'));
        if (b.c + d >= 0 && b.c + d < S) add(areaFor(st, b.r, b.c + d, 'rv'));
      }
    }
    return { cells, preFired, created: [], matchCells: null };
  }

  function trySwap(st, a, b) {
    if (!inB(st, a.r, a.c) || !inB(st, b.r, b.c)) return { valid: false };
    if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return { valid: false };
    if (!isMovable(st, a.r, a.c) || !isMovable(st, b.r, b.c)) return { valid: false, reason: 'blocked' };
    const ta = st.tiles[a.r][a.c], tb = st.tiles[b.r][b.c];
    const swapStep = { kind: 'swap', a: { r: a.r, c: a.c, id: ta.id }, b: { r: b.r, c: b.c, id: tb.id } };
    st.tiles[a.r][a.c] = tb; st.tiles[b.r][b.c] = ta;
    const special = (ta.s === 'rainbow' || tb.s === 'rainbow' || (ta.s && tb.s));
    if (special) {
      st.moves++;
      const spec = comboSpec(st, ta, tb, a, b);
      const steps = [swapStep];
      if (spec.transform) steps.push(spec.transform);
      return { valid: true, steps: steps.concat(runCascade(st, spec)) };
    }
    const m = findMatches(st, [K(b.r, b.c), K(a.r, a.c)]);
    if (!m.cells.size) {
      st.tiles[a.r][a.c] = ta; st.tiles[b.r][b.c] = tb;
      return { valid: false, reason: 'nomatch', swapStep };
    }
    st.moves++;
    return { valid: true, steps: [swapStep].concat(runCascade(st, { cells: m.cells, created: m.specials, matchCells: m.cells })) };
  }

  /* Нажатие на спец-фишку — активирует её (как в Royal Match) */
  function activateSpecial(st, r, c) {
    const t = inB(st, r, c) ? st.tiles[r][c] : null;
    if (!t || !t.s || st.lock[r][c]) return { valid: false };
    st.moves++;
    return { valid: true, steps: runCascade(st, { cells: new Set([K(r, c)]), created: [], matchCells: null }) };
  }

  /* Бустеры не тратят ходы */
  function useBooster(st, kind, r, c) {
    if (kind === 'shuffle') return { valid: true, steps: [shuffleBoard(st)] };
    if (!inB(st, r, c)) return { valid: false };
    const tile = st.tiles[r][c];
    const isBox = st.box[r][c] > 0;
    if (!isBox && (!tile || tile.t === 'ING')) return { valid: false };
    const cells = new Set([K(r, c)]);
    if (kind === 'rocket') { areaFor(st, r, c, 'rh').forEach((k) => cells.add(k)); areaFor(st, r, c, 'rv').forEach((k) => cells.add(k)); }
    else if (kind === 'bomb') areaFor(st, r, c, 'bomb2').forEach((k) => cells.add(k));
    else if (kind === 'rainbow') {
      if (!tile || typeof tile.t !== 'number' || tile.t < 0) return { valid: false };
      areaFor(st, r, c, 'rainbow', tile.t).forEach((k) => cells.add(k));
    } else if (kind !== 'hammer') return { valid: false };
    return { valid: true, steps: runCascade(st, { cells, created: [], matchCells: null }) };
  }

  function shuffleBoard(st) {
    const S = st.size, pos = [];
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
      const t = st.tiles[r][c];
      if (t && !st.lock[r][c] && st.box[r][c] === 0 && typeof t.t === 'number' && t.t >= 0 && !t.s) pos.push([r, c]);
    }
    const pool = pos.map(([r, c]) => st.tiles[r][c]);
    let ok = false;
    for (let i = 0; i < 150 && !ok && pool.length; i++) {
      shuffleArr(st.rng, pool);
      pos.forEach(([r, c], j) => { st.tiles[r][c] = pool[j]; });
      ok = findMatches(st, null).cells.size === 0 && hasValidMove(st);
    }
    for (let i = 0; i < 400 && !ok && pool.length; i++) {
      pos.forEach(([r, c]) => { st.tiles[r][c].t = rInt(st.rng, st.colors); });
      ok = findMatches(st, null).cells.size === 0 && hasValidMove(st);
    }
    if (!ok && pool.length) {
      // Крайний случай (поле забито ящиками/цепями): гарантируем ход — даём радугу
      pos.forEach(([r, c]) => {
        let t, tries = 0;
        do { t = rInt(st.rng, st.colors); tries++; } while (tries < 30 && makesMatchAt(st, r, c, t));
        st.tiles[r][c].t = t;
      });
      const [r0, c0] = pos[0];
      st.tiles[r0][c0].s = 'rainbow'; st.tiles[r0][c0].t = -1;
    }
    return { kind: 'shuffle', tiles: pos.map(([r, c]) => ({ id: st.tiles[r][c].id, r, c, t: st.tiles[r][c].t, s: st.tiles[r][c].s })) };
  }

  /* ---------------- Подсказки / проверка ходов ----------------
     Подсказка «умная»: оценивает ход не только по размеру совпадения, но и по
     пользе для целей уровня (нужный цвет, лёд, ящики рядом, клетки под ингредиентом). */
  function goalContext(st) {
    const S = st.size;
    const want = new Set();
    let needIce = false, needBox = false, needIng = false;
    for (const g of st.goals) {
      if (g.count >= g.target) continue;
      if (g.type === 'collect') want.add(g.t);
      if (g.type === 'ice') needIce = true;
      if (g.type === 'box') needBox = true;
      if (g.type === 'ingredient') needIng = true;
    }
    const ingRow = new Array(S).fill(-1);
    if (needIng) for (let c = 0; c < S; c++) for (let r = S - 1; r >= 0; r--) { const t = st.tiles[r][c]; if (t && t.t === 'ING') { ingRow[c] = r; break; } }
    return { want, needIce, needBox, needIng, ingRow };
  }
  function evalCells(st, cells, ctx) {
    let v = 0;
    const boxSeen = new Set();
    for (const k of cells) {
      const r = KR(k), c = KC(k);
      v += 1;
      const t = st.tiles[r][c];
      if (t && ctx.want.has(t.t)) v += 2;
      if (ctx.needIce && st.ice[r][c] > 0) v += 3;
      if (ctx.needIng && ctx.ingRow[c] >= 0 && r > ctx.ingRow[c]) v += 4;
      if (ctx.needBox) {
        if (st.box[r][c] > 0 && !boxSeen.has(k)) { boxSeen.add(k); v += 4; }
        [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([y, x]) => {
          if (inB(st, y, x) && st.box[y][x] > 0 && !boxSeen.has(K(y, x))) { boxSeen.add(K(y, x)); v += 4; }
        });
      }
    }
    return v;
  }
  function findHint(st, anyOnly) {
    const S = st.size;
    const ctx = anyOnly ? null : goalContext(st);
    let best = null, bestVal = 0;
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        const t = st.tiles[r][c];
        if (t && t.s && !st.lock[r][c]) {
          if (anyOnly) return { tap: { r, c } };
          const val = evalCells(st, areaFor(st, r, c, t.s, null), ctx) + 2;
          if (val > bestVal) { bestVal = val; best = { tap: { r, c } }; }
        }
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const r2 = r + dr, c2 = c + dc;
          if (!isMovable(st, r, c) || !isMovable(st, r2, c2)) continue;
          const ta = st.tiles[r][c], tb = st.tiles[r2][c2];
          let val = 0;
          if (ta.s === 'rainbow' || tb.s === 'rainbow' || (ta.s && tb.s)) val = anyOnly ? 1 : 40;
          else {
            st.tiles[r][c] = tb; st.tiles[r2][c2] = ta;
            const m = findMatches(st, null);
            if (m.cells.size && !anyOnly) val = evalCells(st, m.cells, ctx) + m.specials.length * 8;
            else if (m.cells.size) val = 1;
            st.tiles[r][c] = ta; st.tiles[r2][c2] = tb;
          }
          if (val > 0 && anyOnly) return { a: { r, c }, b: { r: r2, c: c2 } };
          if (val > bestVal) { bestVal = val; best = { a: { r, c }, b: { r: r2, c: c2 } }; }
        }
      }
    }
    return best;
  }
  function hasValidMove(st) { return !!findHint(st, true); }
  function isComplete(st) { return st.goals.every((g) => g.count >= g.target); }

  /* Финальный «Фруктовый взрыв»: подрываем все оставшиеся спец-фишки */
  function detonateAll(st) {
    const cells = new Set();
    for (let r = 0; r < st.size; r++) for (let c = 0; c < st.size; c++) {
      const t = st.tiles[r][c];
      if (t && t.s && !st.lock[r][c]) cells.add(K(r, c));
    }
    if (!cells.size) return null;
    return runCascade(st, { cells, created: [], matchCells: null });
  }

  function computeStars(moves, par) {
    if (moves <= par) return 3;
    if (moves <= Math.ceil(par * 1.5)) return 2;
    return 1;
  }
  function starThresholds(par) { return { three: par, two: Math.ceil(par * 1.5) }; }

  return {
    mulberry32, K, KR, KC, CHAPTERS, chapterOf, levelConfig, createBoard,
    findMatches, trySwap, activateSpecial, useBooster, shuffleBoard,
    findHint, hasValidMove, isComplete, isMovable, detonateAll,
    computeStars, starThresholds
  };
}));
