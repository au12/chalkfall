// Try hand-written strategies on one level: npx tsx tools/probe.ts <id>
import { initNodePhysics } from './node-init.ts';
import { Sim } from '../src/game/sim.ts';
import { LEVELS } from '../src/levels/worlds.ts';
await initNodePhysics();
const id = process.argv[2];
const L = LEVELS.find((l) => l.id === id)!;
const s0 = new Sim(L);
const targets = s0.pieces.filter((p) => s0.targetable(p)).map((p) => ({ i: p.levelIndex, x: +p.x.toFixed(1), y: +p.y.toFixed(1), w: p.w, h: p.h, mat: p.mat }));
console.log(L.id, L.name, 'charges', JSON.stringify(L.charges), 'start', s0.rubbleHeight().toFixed(1), 'pass', L.passLine);
console.log('targets', targets.map((t) => `${t.i}:${t.mat[0]}(${t.x},${t.y} ${t.w}x${t.h})`).join(' '));
s0.destroy();
type Pl = [string, number, number, number?, number?];   // kind, x, y, fuse, dir
const strategies: Record<string, Pl[]> = JSON.parse(process.argv[3] ?? '{}');
for (const [name, list] of Object.entries(strategies)) {
  const s = new Sim(L);
  const placed = list.map(([k, x, y, f, d]) => s.placeCharge(k as any, x, y, { fuse: f ?? 0, dir: d ?? 0 })).filter(Boolean).length;
  const r = s.runToEnd();
  const hit = s.protectedObjs.filter((o) => o.hit).map((o) => o.def.kind).join(',');
  console.log(`${name.padEnd(20)} placed ${placed}/${list.length} h=${r.height.toFixed(1)} damaged=${r.damaged}${hit ? '(' + hit + ')' : ''} cleared=${r.cleared} bonus=${r.bonusMet} t=${s.time.toFixed(1)}`);
  s.destroy();
}
