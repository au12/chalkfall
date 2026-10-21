// Sanity check for every level: stability at rest, start height, piece counts, timing.
import { initNodePhysics } from './node-init.ts';
import { Sim } from '../src/game/sim.ts';
import { LEVELS } from '../src/levels/worlds.ts';
await initNodePhysics();
for (const L of LEVELS) {
  const t0 = performance.now();
  const s = new Sim(L);
  let drift = 0;
  for (const p of s.pieces) {
    if (p.levelIndex < 0) continue;
    const d = L.pieces[p.levelIndex];
    drift = Math.max(drift, Math.hypot(p.x - d.x, p.y - d.y));
  }
  const h = s.rubbleHeight();
  const awake = s.pieces.filter((p) => p.alive && !p.isStatic && p.awake).length;
  console.log(`${L.id.padEnd(4)} ${L.name.padEnd(16)} pieces ${String(L.pieces.length).padStart(3)} welds ${String(L.welds?.length ?? 0).padStart(3)} height ${h.toFixed(1).padStart(5)} pass ${L.passLine} drift ${drift.toFixed(3)} awake ${awake} cam h ${L.camera!.h.toFixed(0)} ${(performance.now() - t0).toFixed(0)}ms`);
  s.destroy();
}
