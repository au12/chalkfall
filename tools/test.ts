// Level regression test: every level must stand still at rest, start above its pass line,
// and the stored solution must clear it within par, the same way twice (determinism), and still
// clear when every charge sits one grid step off.
//   npm test            all levels
//   npm test -- 2-5 4-8 just these
import { initNodePhysics } from './node-init.ts';
import { Sim } from '../src/game/sim.ts';
import { LEVELS, CALIBRATION } from '../src/levels/index.ts';
import { CHARGE_GRID } from '../src/game/constants.ts';

await initNodePhysics();
const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let failed = 0;
for (const L of LEVELS) {
  if (ids.length && !ids.includes(L.id)) continue;
  const problems: string[] = [];
  const s = new Sim(L);
  let drift = 0;
  for (const p of s.pieces) {
    if (p.levelIndex < 0) continue;
    const d = L.pieces[p.levelIndex];
    drift = Math.max(drift, Math.hypot(p.x - d.x, p.y - d.y));
  }
  const start = s.rubbleHeight();
  s.destroy();
  if (drift > 0.5) problems.push(`settles ${drift.toFixed(2)} ft at rest`);
  if (start < L.passLine + 1) problems.push(`starts at ${start.toFixed(1)}, pass line ${L.passLine}`);

  const c = CALIBRATION[L.id];
  let line = 'no solution';
  if (!c?.solution) problems.push('no calibrated solution');
  else {
    const play = () => { const t = new Sim(L); for (const p of c.solution!) t.placeAt(p); const r = t.runToEnd(); t.destroy(); return r; };
    const a = play(), b = play();
    line = `solution ${a.used}/${L.par} → ${a.height.toFixed(2)} ft (pass ${L.passLine}, gold ${L.goldLine})`;
    if (!a.cleared) problems.push(a.damaged ? 'solution hits a neighbour' : `solution leaves ${a.height.toFixed(2)} ft`);
    if (a.used > L.par) problems.push(`solution uses ${a.used} > par ${L.par}`);
    if (a.height !== b.height || a.score !== b.score) problems.push('not deterministic');
    // one grid step either way along the frames must still clear (that's what a player's near miss looks like)
    for (const d of [-CHARGE_GRID, CHARGE_GRID]) {
      const t = new Sim(L); for (const p of c.solution) t.placeAt({ ...p, local: p.local + d }); const r = t.runToEnd(); t.destroy();
      if (!r.cleared) problems.push(`nudged ${d > 0 ? '+' : ''}${d}: ${r.damaged ? 'hits a neighbour' : r.height.toFixed(2) + ' ft'}`);
    }
    if (L.goldLine >= L.passLine) problems.push('gold line not below pass line');
  }
  if (c && c.bonusFeasible === false) problems.push(`bonus (${L.bonus.type}) not shown feasible`);
  const ok = problems.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${L.id.padEnd(4)} ${L.name.padEnd(15)} start ${start.toFixed(1).padStart(5)} | ${line}${ok ? '' : ' | ' + problems.join('; ')}`);
}
console.log(failed ? `\n${failed} level(s) failed` : '\nall levels ok');
process.exit(failed ? 1 : 0);
