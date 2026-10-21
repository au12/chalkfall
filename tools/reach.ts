// Level design aid: how far do fast-moving frames travel left/right for some layouts, with the
// neighbours removed? Use it to place neighbours.  npx tsx tools/reach.ts <id> '{"name":[[kind,x,y,fuse?,dir?],...]}' ['{budget}']
import { initNodePhysics } from './node-init.ts';
import { Sim } from '../src/game/sim.ts';
import { LEVELS } from '../src/levels/worlds.ts';
import { DAMAGE_SPEED } from '../src/game/constants.ts';
await initNodePhysics();
const L0 = LEVELS.find((l) => l.id === process.argv[2])!;
const L = { ...L0, protected: [], charges: process.argv[4] ? JSON.parse(process.argv[4]) : L0.charges };
const strategies: Record<string, any[]> = JSON.parse(process.argv[3]);
for (const [name, list] of Object.entries(strategies)) {
  const s = new Sim(L);
  for (const [k, x, y, f, d] of list) s.placeCharge(k, x, y, { fuse: f ?? 0, dir: d ?? 0 });
  s.detonate();
  let lo = 0, hi = 0, loLow = 0, hiLow = 0;
  while (s.phase === 'live') {
    s.step();
    for (const p of s.pieces) {
      if (!p.alive || p.shard || p.isStatic || Math.max(p.w, p.h) < 1.5) continue;
      const sp = Math.hypot(p.vx, p.vy) + Math.abs(p.av) * Math.max(p.w, p.h) / 2;
      if (sp < DAMAGE_SPEED) continue;
      const half = Math.max(p.w, p.h) / 2;
      lo = Math.min(lo, p.x - half); hi = Math.max(hi, p.x + half);
      if (p.y < 8) { loLow = Math.min(loLow, p.x - half); hiLow = Math.max(hiLow, p.x + half); }
    }
  }
  const r = s.result!;
  console.log(`${name.padEnd(14)} h=${r.height.toFixed(1)} fast reach ${lo.toFixed(1)}..${hi.toFixed(1)} (below 8ft: ${loLow.toFixed(1)}..${hiLow.toFixed(1)})`);
  s.destroy();
}
