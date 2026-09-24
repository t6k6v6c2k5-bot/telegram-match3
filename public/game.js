/* ==========================================================
   МАТЧ-3 "ТРИ В РЯД" — Telegram Mini App
   Чистый Vanilla JS, без сторонних библиотек
   ========================================================== */

(function () {
  'use strict';

  // ---------------------------------------------------------
  // Настройки игры
  // ---------------------------------------------------------
  const SIZE = 8;                 // размер поля 8x8
  const TILE_TYPES = ['🍎', '🍇', '🍋', '🍉', '🍓', '🫐']; // 6 видов фишек
  const START_MOVES = 20;         // лимит ходов
  const SWAP_ANIM_MS = 220;
  const MATCH_ANIM_MS = 260;
  const FALL_ANIM_MS = 280;
  const DRAG_THRESHOLD = 18;      // px, порог для распознавания свайпа

  // ---------------------------------------------------------
  // Telegram WebApp интеграция
  // ---------------------------------------------------------
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  function initTelegram() {
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      applyTelegramTheme();
      tg.onEvent('themeChanged', applyTelegramTheme);
      tg.onEvent('viewportChanged', () => layoutBoard(true));
    } catch (e) {
      console.warn('Telegram WebApp init error:', e);
    }
  }

  function applyTelegramTheme() {
    if (!tg || !tg.themeParams) return;
    const root = document.documentElement.style;
    const tp = tg.themeParams;
    if (tp.bg_color) root.setProperty('--tg-bg', tp.bg_color);
    if (tp.text_color) root.setProperty('--tg-text', tp.text_color);
    if (tp.hint_color) root.setProperty('--tg-hint', tp.hint_color);
    if (tp.button_color) {
      root.setProperty('--tg-button', tp.button_color);
      root.setProperty('--accent', tp.button_color);
    }
    if (tp.button_text_color) root.setProperty('--tg-button-text', tp.button_text_color);
    if (tp.secondary_bg_color) root.setProperty('--tg-secondary-bg', tp.secondary_bg_color);
  }

  function haptic(kind) {
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (kind === 'select') tg.HapticFeedback.selectionChanged();
      else if (kind === 'success') tg.HapticFeedback.notificationOccurred('success');
      else if (kind === 'error') tg.HapticFeedback.notificationOccurred('error');
      else tg.HapticFeedback.impactOccurred(kind || 'light');
    } catch (e) { /* noop */ }
  }

  // ---------------------------------------------------------
  // DOM-элементы
  // ---------------------------------------------------------
  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('scoreValue');
  const movesEl = document.getElementById('movesValue');
  const comboToast = document.getElementById('comboToast');
  const gameOverScreen = document.getElementById('gameOverScreen');
  const finalScoreEl = document.getElementById('finalScoreValue');
  const startScreen = document.getElementById('startScreen');

  document.getElementById('restartTopBtn').addEventListener('click', () => resetGame());
  document.getElementById('playAgainBtn').addEventListener('click', () => resetGame());
  document.getElementById('startBtn').addEventListener('click', () => {
    startScreen.classList.add('hidden');
    resetGame();
  });

  // ---------------------------------------------------------
  // Состояние
  // ---------------------------------------------------------
  let board = [];          // board[row][col] = type index (0..N-1) или null
  let tileEls = [];        // tileEls[row][col] = DOM-элемент
  let score = 0;
  let moves = START_MOVES;
  let busy = false;        // блокировка ввода во время анимаций
  let selected = null;     // {row, col} выбранная фишка (для tap-режима)
  let cellSize = 0;

  // ---------------------------------------------------------
  // Инициализация / сброс игры
  // ---------------------------------------------------------
  function resetGame() {
    gameOverScreen.classList.add('hidden');
    score = 0;
    moves = START_MOVES;
    busy = false;
    selected = null;
    updateHUD();
    buildInitialBoard();
    renderAll();
  }

  function buildInitialBoard() {
    board = [];
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) {
        let t;
        do {
          t = randType();
        } while (
          (c >= 2 && row[c - 1] === t && row[c - 2] === t) ||
          (r >= 2 && board[r - 1][c] === t && board[r - 2][c] === t)
        );
        row.push(t);
      }
      board.push(row);
    }
    if (!hasAnyValidMove(board)) {
      buildInitialBoard(); // очень редкий случай — пересобрать
    }
  }

  function randType() {
    return Math.floor(Math.random() * TILE_TYPES.length);
  }

  // ---------------------------------------------------------
  // Рендер поля
  // ---------------------------------------------------------
  function renderAll() {
    boardEl.innerHTML = '';
    tileEls = [];
    // фоновые ячейки
    for (let i = 0; i < SIZE * SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      boardEl.appendChild(cell);
    }
    // фишки
    for (let r = 0; r < SIZE; r++) {
      const rowEls = [];
      for (let c = 0; c < SIZE; c++) {
        const tile = createTileEl(r, c, board[r][c]);
        boardEl.appendChild(tile);
        rowEls.push(tile);
      }
      tileEls.push(rowEls);
    }
    layoutBoard(false);
  }

  function createTileEl(r, c, type) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.textContent = TILE_TYPES[type];
    el.dataset.row = r;
    el.dataset.col = c;
    el.dataset.type = type;
    attachTileEvents(el);
    return el;
  }

  // Пересчитать пиксельные координаты всех фишек под текущий размер доски
  function layoutBoard(animate) {
    const rect = boardEl.getBoundingClientRect();
    const styles = getComputedStyle(boardEl);
    const padding = parseFloat(styles.paddingLeft) || 8;
    const gap = parseFloat(styles.gap) || 4;
    const inner = rect.width - padding * 2 - gap * (SIZE - 1);
    cellSize = inner / SIZE;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = tileEls[r] && tileEls[r][c];
        if (!el) continue;
        if (!animate) el.style.transition = 'none';
        positionTile(el, r, c);
        if (!animate) {
          // форсируем layout и возвращаем анимацию обратно
          void el.offsetWidth;
          el.style.transition = '';
        }
      }
    }
  }

  function positionTile(el, r, c) {
    const step = cellSize + parseFloat(getComputedStyle(boardEl).gap || 4);
    el.style.width = cellSize + 'px';
    el.style.height = cellSize + 'px';
    el.style.left = (c * step) + 'px';
    el.style.top = (r * step) + 'px';
    el.dataset.row = r;
    el.dataset.col = c;
  }

  window.addEventListener('resize', () => layoutBoard(false));

  // ---------------------------------------------------------
  // Ввод: tap-выбор и drag-свайп (Pointer Events)
  // ---------------------------------------------------------
  function attachTileEvents(el) {
    let startX = 0, startY = 0, dragging = false, moved = false;

    el.addEventListener('pointerdown', (e) => {
      if (busy) return;
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
      moved = false;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging || busy || moved) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

      moved = true;
      dragging = false;
      const r = parseInt(el.dataset.row, 10);
      const c = parseInt(el.dataset.col, 10);
      let targetR = r, targetC = c;
      if (Math.abs(dx) > Math.abs(dy)) {
        targetC += dx > 0 ? 1 : -1;
      } else {
        targetR += dy > 0 ? 1 : -1;
      }
      selected = null;
      clearSelection();
      attemptSwap({ row: r, col: c }, { row: targetR, col: targetC });
    });

    el.addEventListener('pointerup', () => {
      if (!moved && dragging) {
        // это был обычный тап — режим выбора
        const r = parseInt(el.dataset.row, 10);
        const c = parseInt(el.dataset.col, 10);
        handleTap(r, c);
      }
      dragging = false;
      moved = false;
    });

    el.addEventListener('pointercancel', () => {
      dragging = false;
      moved = false;
    });
  }

  function handleTap(r, c) {
    if (busy) return;
    haptic('select');
    if (!selected) {
      selected = { row: r, col: c };
      setSelectedVisual(r, c, true);
      return;
    }
    if (selected.row === r && selected.col === c) {
      setSelectedVisual(r, c, false);
      selected = null;
      return;
    }
    if (isAdjacent(selected, { row: r, col: c })) {
      const from = selected;
      const to = { row: r, col: c };
      clearSelection();
      selected = null;
      attemptSwap(from, to);
    } else {
      clearSelection();
      selected = { row: r, col: c };
      setSelectedVisual(r, c, true);
    }
  }

  function setSelectedVisual(r, c, on) {
    const el = tileEls[r][c];
    if (el) el.classList.toggle('selected', on);
  }

  function clearSelection() {
    if (selected) setSelectedVisual(selected.row, selected.col, false);
  }

  function isAdjacent(a, b) {
    const dr = Math.abs(a.row - b.row);
    const dc = Math.abs(a.col - b.col);
    return (dr + dc) === 1;
  }

  // ---------------------------------------------------------
  // Логика свапа и разрешения совпадений
  // ---------------------------------------------------------
  async function attemptSwap(a, b) {
    if (!inBounds(a) || !inBounds(b) || busy) return;
    if (!isAdjacent(a, b)) return;
    if (moves <= 0) return;

    busy = true;
    swapModel(a, b);
    animateSwap(a, b);
    await wait(SWAP_ANIM_MS);

    const matches = findMatches(board);
    if (matches.size === 0) {
      // недопустимый ход — вернуть назад
      haptic('error');
      markInvalid(a, b);
      await wait(180);
      swapModel(a, b); // откат модели
      animateSwap(a, b);
      await wait(SWAP_ANIM_MS);
      busy = false;
      return;
    }

    // допустимый ход — тратим попытку
    moves = Math.max(0, moves - 1);
    updateHUD();
    haptic('medium');

    await resolveCascades(1);

    busy = false;

    if (moves <= 0) {
      endGame();
    } else if (!hasAnyValidMove(board)) {
      await reshuffleBoard();
    }
  }

  function swapModel(a, b) {
    const tmp = board[a.row][a.col];
    board[a.row][a.col] = board[b.row][b.col];
    board[b.row][b.col] = tmp;

    const tmpEl = tileEls[a.row][a.col];
    tileEls[a.row][a.col] = tileEls[b.row][b.col];
    tileEls[b.row][b.col] = tmpEl;
  }

  function animateSwap(a, b) {
    const elA = tileEls[a.row][a.col];
    const elB = tileEls[b.row][b.col];
    positionTile(elA, a.row, a.col);
    positionTile(elB, b.row, b.col);
  }

  function markInvalid(a, b) {
    [a, b].forEach((pos) => {
      const el = tileEls[pos.row][pos.col];
      el.classList.add('swap-invalid');
      setTimeout(() => el.classList.remove('swap-invalid'), 320);
    });
  }

  function inBounds(pos) {
    return pos.row >= 0 && pos.row < SIZE && pos.col >= 0 && pos.col < SIZE;
  }

  // Поиск всех совпадений >=3 в ряд (гориз./вертик.)
  function findMatches(b) {
    const matched = new Set();

    for (let r = 0; r < SIZE; r++) {
      let run = 1;
      for (let c = 1; c <= SIZE; c++) {
        const same = c < SIZE && b[r][c] !== null && b[r][c] === b[r][c - 1];
        if (same) {
          run++;
        } else {
          if (run >= 3) {
            for (let k = c - run; k < c; k++) matched.add(r + ',' + k);
          }
          run = 1;
        }
      }
    }

    for (let c = 0; c < SIZE; c++) {
      let run = 1;
      for (let r = 1; r <= SIZE; r++) {
        const same = r < SIZE && b[r][c] !== null && b[r][c] === b[r - 1][c];
        if (same) {
          run++;
        } else {
          if (run >= 3) {
            for (let k = r - run; k < r; k++) matched.add(k + ',' + c);
          }
          run = 1;
        }
      }
    }

    return matched;
  }

  // Каскадное разрешение: удаление -> падение -> заполнение -> проверка новых совпадений
  async function resolveCascades(cascadeLevel) {
    const matches = findMatches(board);
    if (matches.size === 0) return;

    // визуально уничтожаем фишки
    const positions = Array.from(matches).map((k) => {
      const [r, c] = k.split(',').map(Number);
      return { row: r, col: c };
    });

    positions.forEach((p) => {
      const el = tileEls[p.row][p.col];
      if (el) el.classList.add('matched');
    });

    addScore(positions.length, cascadeLevel);
    showCombo(cascadeLevel, positions.length);
    haptic(cascadeLevel > 1 ? 'heavy' : 'medium');

    await wait(MATCH_ANIM_MS);

    // удаляем DOM-элементы и модельные значения
    positions.forEach((p) => {
      const el = tileEls[p.row][p.col];
      if (el && el.parentNode) el.parentNode.removeChild(el);
      tileEls[p.row][p.col] = null;
      board[p.row][p.col] = null;
    });

    await collapseAndRefill();
    await wait(FALL_ANIM_MS);

    await resolveCascades(cascadeLevel + 1);
  }

  // Сдвигаем фишки вниз по каждому столбцу и генерируем новые сверху
  async function collapseAndRefill() {
    for (let c = 0; c < SIZE; c++) {
      let writeRow = SIZE - 1;
      for (let r = SIZE - 1; r >= 0; r--) {
        if (board[r][c] !== null) {
          if (writeRow !== r) {
            board[writeRow][c] = board[r][c];
            board[r][c] = null;
            const el = tileEls[r][c];
            tileEls[writeRow][c] = el;
            tileEls[r][c] = null;
            if (el) positionTile(el, writeRow, c);
          }
          writeRow--;
        }
      }
      // заполняем пустоты сверху новыми фишками
      for (let r = writeRow; r >= 0; r--) {
        const type = randType();
        board[r][c] = type;
        const el = createTileEl(r, c, type);
        // стартовая позиция — выше поля, для анимации падения
        positionTile(el, r - (writeRow - r + 1) - 2, c);
        el.style.transition = 'none';
        boardEl.appendChild(el);
        tileEls[r][c] = el;
        void el.offsetWidth;
        el.style.transition = '';
        el.classList.add('spawning');
        positionTile(el, r, c);
        setTimeout(() => el.classList.remove('spawning'), FALL_ANIM_MS + 50);
      }
    }
  }

  // ---------------------------------------------------------
  // Проверка наличия хотя бы одного возможного хода
  // ---------------------------------------------------------
  function hasAnyValidMove(b) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (c < SIZE - 1) {
          swapCells(b, r, c, r, c + 1);
          const ok = findMatches(b).size > 0;
          swapCells(b, r, c, r, c + 1);
          if (ok) return true;
        }
        if (r < SIZE - 1) {
          swapCells(b, r, c, r + 1, c);
          const ok = findMatches(b).size > 0;
          swapCells(b, r, c, r + 1, c);
          if (ok) return true;
        }
      }
    }
    return false;
  }

  function swapCells(b, r1, c1, r2, c2) {
    const tmp = b[r1][c1];
    b[r1][c1] = b[r2][c2];
    b[r2][c2] = tmp;
  }

  async function reshuffleBoard() {
    busy = true;
    // простое перемешивание существующих фишек, пока не появится валидный ход и без начальных совпадений
    const flat = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) flat.push(board[r][c]);

    let attempts = 0;
    do {
      for (let i = flat.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [flat[i], flat[j]] = [flat[j], flat[i]];
      }
      let idx = 0;
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) board[r][c] = flat[idx++];
      attempts++;
    } while ((findMatches(board).size > 0 || !hasAnyValidMove(board)) && attempts < 200);

    renderAll();
    await wait(50);
    busy = false;
  }

  // ---------------------------------------------------------
  // Очки, HUD, комбо-тост
  // ---------------------------------------------------------
  function addScore(tileCount, cascadeLevel) {
    const base = tileCount * 10;
    const bonus = tileCount > 3 ? (tileCount - 3) * 15 : 0;
    const cascadeMult = 1 + (cascadeLevel - 1) * 0.5;
    score += Math.round((base + bonus) * cascadeMult);
    updateHUD();
  }

  function updateHUD() {
    scoreEl.textContent = score;
    movesEl.textContent = moves;
  }

  let comboTimer = null;
  function showCombo(level, count) {
    if (level < 2 && count < 4) return;
    let text = '';
    if (level >= 2) text = `Комбо x${level}!`;
    if (count >= 5) text = (text ? text + ' ' : '') + `Супер-ряд (${count})!`;
    if (!text) return;

    comboToast.textContent = text;
    comboToast.classList.remove('hidden');
    requestAnimationFrame(() => comboToast.classList.add('show'));
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => {
      comboToast.classList.remove('show');
      setTimeout(() => comboToast.classList.add('hidden'), 250);
    }, 900);
  }

  // ---------------------------------------------------------
  // Завершение игры
  // ---------------------------------------------------------
  function endGame() {
    finalScoreEl.textContent = score;
    gameOverScreen.classList.remove('hidden');
    haptic('success');
    if (tg && tg.MainButton) {
      try { tg.MainButton.hide(); } catch (e) { /* noop */ }
    }
  }

  // ---------------------------------------------------------
  // Утилиты
  // ---------------------------------------------------------
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------
  // Старт
  // ---------------------------------------------------------
  initTelegram();
})();
