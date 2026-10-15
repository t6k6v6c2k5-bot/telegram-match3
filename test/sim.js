/* Симулятор: прогоняет уровни ботом и проверяет проходимость/баланс.
   Запуск: node test/sim.js [от] [до] [прогонов]   (по умолчанию 1 120 5) */
const E = require('../public/engine.js');

const from = +process.argv[2] || 1;
const to = +process.argv[3] || 120;
const runs = +process.argv[4] || 5;
const MAX_MOVES = 400;

function play(n, seed) {
  const cfg = E.levelConfig(n);
  const st = E.createBoard(cfg, { seed });
  let stuck = false;
  while (!E.isComplete(st) && st.moves < MAX_MOVES) {
    if (!E.hasValidMove(st)) { E.shuffleBoard(st); if (!E.hasValidMove(st)) { stuck = true; break; } }
    const h = E.findHint(st, false);
    if (!h) { stuck = true; break; }
    const res = h.tap ? E.activateSpecial(st, h.tap.r, h.tap.c) : E.trySwap(st, h.a, h.b);
    if (!res.valid) { stuck = true; break; }
    E.detonateAll && E.isComplete(st);
  }
  return { done: E.isComplete(st), moves: st.moves, par: st.par, stuck };
}

let bad = 0;
const rows = [];
for (let n = from; n <= to; n++) {
  let wins = 0, moves = 0, stuck = 0, par = 0;
  for (let i = 0; i < runs; i++) {
    const r = play(n, n * 1000 + i);
    if (r.done) { wins++; moves += r.moves; }
    if (r.stuck) stuck++;
    par = r.par;
  }
  const avg = wins ? moves / wins : 0;
  rows.push({ n, wins, avg, par, stuck });
  if (wins < runs || stuck) bad++;
}

console.log('lvl  win   avgMoves  par  ratio  stuck');
rows.forEach((r) => {
  const ratio = r.par ? (r.avg / r.par).toFixed(2) : '-';
  const flag = (r.wins < runs || r.stuck) ? '  <-- ПРОБЛЕМА' : (r.avg > r.par * 1.6 ? '  <-- тяжело' : '');
  console.log(String(r.n).padStart(3), `${r.wins}/${runs}`.padStart(5), r.avg.toFixed(1).padStart(9), String(r.par).padStart(5), String(ratio).padStart(6), String(r.stuck).padStart(5) + flag);
});
console.log(bad ? `\nПроблемных уровней: ${bad}` : '\nВсе уровни проходимы');
process.exit(bad ? 1 : 0);
