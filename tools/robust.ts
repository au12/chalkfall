// Level design aid: does a layout keep working when every charge is nudged along its frame?
//   npx tsx tools/robust.ts <id> '{"name":[[kind,x,y,fuse?,dir?],...]}'   (X = a neighbour was hit)
import { initNodePhysics } from './node-init.ts';
import { Sim, type Placement } from '../src/game/sim.ts';
import { LEVELS } from '../src/levels/worlds.ts';
await initNodePhysics();
const L = LEVELS.find((l) => l.id === process.argv[2])!;
const strategies: Record<string, any[]> = JSON.parse(process.argv[3]);
const run = (pl: Placement[]) => { const s = new Sim(L); for (const p of pl) s.placeAt(p); const r = s.runToEnd(); s.destroy(); return r; };
for (const [name, list] of Object.entries(strategies)) {
  const s = new Sim(L);
  for (const [k, x, y, f, d] of list) s.placeCharge(k, x, y, { fuse: f ?? 0, dir: d ?? 0 });
  const pl = s.placements(); s.destroy();
  const out: string[] = [];
  let clean = 0;
  for (const d of [-1, -0.5, 0, 0.5, 1]) {
    const r = run(pl.map((p) => ({ ...p, local: p.local + d })));
    if (!r.damaged) clean++;
    out.push(`${r.height.toFixed(1)}${r.damaged ? 'X' : ''}`);
  }
  console.log(`${name.padEnd(12)} clean ${clean}/5  ${out.join(" ")}`);
}
