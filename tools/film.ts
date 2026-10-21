// Dev tool: render a filmstrip SVG of a level being demolished, headless.
//   npx tsx tools/film.ts <id> [solution | '[[kind,x,y,fuse?,dir?],...]'] [out.svg] [times]
import { writeFileSync } from 'node:fs';
import { initNodePhysics } from './node-init.ts';
import { Sim } from '../src/game/sim.ts';
import { LEVELS, CALIBRATION } from '../src/levels/index.ts';

const MAT_COLOR: Record<string, string> = { wood: '#d9b77e', concrete: '#c9c9c0', steel: '#8fb4d8', glass: '#9fe0e8', stone: '#b59a86' };
await initNodePhysics();
const [id, plArg = 'solution', out = 'film.svg', timesArg = '0,0.4,0.8,1.5,2.5,4,end'] = process.argv.slice(2);
const L = LEVELS.find((l) => l.id === id)!;
const s = new Sim(L);
const pl = plArg === 'solution' ? 'solution' : JSON.parse(plArg);
if (pl === 'solution') for (const p of CALIBRATION[id].solution ?? []) s.placeAt(p);
else for (const [k, x, y, f, d] of pl) if (!s.placeCharge(k, x, y, { fuse: f ?? 0, dir: d ?? 0 })) console.log('could not place', k, x, y);
const charges = s.charges.map((c) => ({ x: c.x, y: c.y, kind: c.kind }));
const times = timesArg.split(',');
const cam0 = L.camera!, zoom = +(process.env.ZOOM ?? 1);
const cam = { x: cam0.x, y: cam0.y * zoom, h: cam0.h * zoom };
const W = 360, H = Math.round(W * cam.h / (cam.h * 16 / 9));
const sc = W / (cam.h * 16 / 9);
const frames: string[] = [];
const snap = (label: string) => {
  const g: string[] = [];
  const tx = (x: number) => (x - cam.x) * sc + W / 2, ty = (y: number) => H - (y - cam.y + cam.h / 2) * sc;
  g.push(`<rect width="${W}" height="${H}" fill="#1d3527"/>`);
  g.push(`<line x1="0" x2="${W}" y1="${ty(s.groundY)}" y2="${ty(s.groundY)}" stroke="#ddd" stroke-width="2"/>`);
  for (const [yv, col] of [[L.passLine, '#e66'], [L.goldLine, '#ec4']] as const) g.push(`<line x1="0" x2="${W}" y1="${ty(s.groundY + yv)}" y2="${ty(s.groundY + yv)}" stroke="${col}" stroke-dasharray="4 3"/>`);
  for (const o of s.protectedObjs) { const d = o.def; const y0 = d.y ?? s.groundY; g.push(`<rect x="${tx(d.x - d.w / 2)}" y="${ty(y0 + d.h)}" width="${d.w * sc}" height="${d.h * sc}" fill="none" stroke="${o.hit ? '#f44' : '#8cf'}" stroke-width="1.5"/>`); }
  for (const p of s.pieces) {
    if (!p.alive) continue;
    const pts = p.poly ?? [[-p.w / 2, -p.h / 2], [p.w / 2, -p.h / 2], [p.w / 2, p.h / 2], [-p.w / 2, p.h / 2]];
    const c = Math.cos(p.a), sn = Math.sin(p.a);
    const d = pts.map(([u, v]) => `${tx(p.x + u * c - v * sn).toFixed(1)},${ty(p.y + u * sn + v * c).toFixed(1)}`).join(' ');
    g.push(`<polygon points="${d}" fill="${MAT_COLOR[p.mat]}" fill-opacity="${p.shard ? 0.5 : 0.85}" stroke="#000" stroke-width="0.4"/>`);
  }
  if (label === '0') for (const c of charges) g.push(`<circle cx="${tx(c.x)}" cy="${ty(c.y)}" r="3.5" fill="#f33" stroke="#fff"/>`);
  g.push(`<text x="6" y="14" fill="#fff" font-size="12" font-family="sans-serif">t=${label} h=${s.rubbleHeight().toFixed(1)}</text>`);
  frames.push(`<g transform="translate(${(frames.length % 4) * (W + 6)},${Math.floor(frames.length / 4) * (H + 6)})">${g.join('')}</g>`);
};
s.detonate();
for (const t of times) {
  if (t === 'end') { const r = s.runToEnd(); snap(`end ${s.time.toFixed(1)}s`); console.log(JSON.stringify({ height: +r.height.toFixed(2), damaged: r.damaged, cleared: r.cleared, stars: r.stars, used: r.used })); break; }
  while (s.phase === 'live' && s.time < +t) s.step();
  snap(t);
}
const cols = Math.min(4, frames.length), rows = Math.ceil(frames.length / 4);
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * (W + 6)}" height="${rows * (H + 6)}" style="background:#000">${frames.join('')}</svg>`);
