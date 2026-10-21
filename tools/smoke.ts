import { initNodePhysics } from './node-init.ts';
import { World, BodyType } from '../src/physics/box2d.ts';
await initNodePhysics();
const w = new World({ gravity: [0, -25] });
const g = w.createBody({ type: BodyType.Static, x: 0, y: -0.5 });
w.box(g, 50, 0.5);
// a stack of 6 boxes
const hs: number[] = [];
for (let k = 0; k < 6; k++) { const b = w.createBody({ x: 0, y: 0.5 + k * 1.0 }); w.box(b, 2, 0.5, 0, 0, 0, { density: 1, friction: 0.6 }); hs.push(b); }
const t0 = performance.now();
let steps = 0, asleep = 0;
for (; steps < 600; steps++) {
  w.step(0.9 / 60, 4);
  asleep = 0;
  w.readBodies((h, x, y, a, vx, vy, wv, awake, dyn) => { if (dyn && !awake) asleep++; });
  if (asleep === 6) break;
}
const top = w.getBody(hs[5]);
console.log('steps', steps, 'asleep', asleep, 'top y', top.y.toFixed(3), 'ms', (performance.now() - t0).toFixed(1));
w.explode(0.5, 0.5, 6, 2, 8);
for (let k = 0; k < 120; k++) w.step(0.9 / 60, 4);
console.log('after explode top', w.getBody(hs[5]).x.toFixed(2), w.getBody(hs[5]).y.toFixed(2), 'hits', w.hitEvents().length);
