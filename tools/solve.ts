// Level solver: searches charge placements for every level to make sure each one can be cleared,
// and calibrates the pass line, the par and the gold line from what it finds (with a margin, and
// only counting solutions that still work when nudged slightly).
//   npx tsx tools/solve.ts [levelId ...] [--evals N] [--write]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { initNodePhysics } from './node-init.ts';
import { Sim, rng, type Placement, type SimResult } from '../src/game/sim.ts';
import { LEVELS } from '../src/levels/worlds.ts';
import type { LevelDef } from '../src/game/level.ts';
import { CHARGE_GRID, type ChargeKind } from '../src/game/constants.ts';

await initNodePhysics();

const args = process.argv.slice(2);
const evalsArg = args.indexOf('--evals');
const BASE_EVALS = evalsArg >= 0 ? +args[evalsArg + 1] : 260;
const WRITE = args.includes('--write');
const ids = args.filter((a, i) => !a.startsWith('--') && (evalsArg < 0 || i !== evalsArg + 1));
const CAL_PATH = new URL('../src/levels/calibration.json', import.meta.url);

interface Eval { pl: Placement[]; r: SimResult }

function run(L: LevelDef, pl: Placement[]): SimResult {
  const s = new Sim(L);
  for (const p of pl) s.placeAt(p);
  const r = s.runToEnd(60 * 20);
  s.destroy();
  return r;
}

// candidate sites: positions along every targetable frame
function sites(L: LevelDef): { piece: number; local: number; vertical: boolean; y: number }[] {
  const s = new Sim(L);
  const out: { piece: number; local: number; vertical: boolean; y: number }[] = [];
  for (const p of s.pieces) {
    if (!s.targetable(p) || p.levelIndex < 0) continue;
    const len = Math.max(p.w, p.h), lim = Math.max(0, len / 2 - 0.45);
    const vertical = p.h > p.w;
    const locs = len >= 5 ? [-lim, -lim * 0.35, lim * 0.35, lim] : len >= 2.5 ? [-lim, lim] : [0];
    for (const local of locs) out.push({ piece: p.levelIndex, local, vertical, y: p.y });
  }
  s.destroy();
  return out;
}

// kicker aims the UI can set (45° steps)
const DIRS = [0, Math.PI, Math.PI / 4, Math.PI * 3 / 4];
const FUSES = [0, 0, 0, 0.5, 1];

function score(L: LevelDef, r: SimResult): number {
  // lower is better: height, with big penalties for damage
  return r.height + (r.damaged ? 1000 : 0);
}

function solveLevel(L: LevelDef) {
  const R = rng(1234 + L.world * 100 + L.index);
  const budget = L.charges;
  const kinds = (Object.keys(budget) as ChargeKind[]).filter((k) => (budget[k] ?? 0) > 0);
  const S = sites(L);
  const total = kinds.reduce((a, k) => a + (budget[k] ?? 0), 0);
  // bigger budgets get a bigger search
  const EVALS = Math.round(BASE_EVALS * Math.max(1, total / 5));
  const evals: Eval[] = [];
  const t0 = performance.now();
  const evaluate = (pl: Placement[]) => {
    const r = run(L, pl);
    const e = { pl, r };
    evals.push(e);
    return e;
  };
  const randomPlacement = (kind: ChargeKind): Placement => {
    const s = S[(R() * S.length) | 0];
    return { kind, piece: s.piece, local: s.local, fuse: FUSES[(R() * FUSES.length) | 0], dir: DIRS[(R() * DIRS.length) | 0] };
  };
  const fits = (pl: Placement[]) => kinds.every((k) => pl.filter((p) => p.kind === k).length <= (budget[k] ?? 0))
    && pl.every((p, i) => pl.every((q, j) => j <= i || q.piece !== p.piece || Math.abs(q.local - p.local) >= 1.4));

  // 1. singles: every site with each kind (bounded)
  const singles: Eval[] = [];
  for (const s of S) for (const kind of kinds) {
    if (evals.length > EVALS * 0.35) break;
    const dirs = kind === 'kicker' ? [0, Math.PI] : [0];
    for (const dir of dirs) singles.push(evaluate([{ kind, piece: s.piece, local: s.local, fuse: 0, dir }]));
  }
  singles.sort((a, b) => score(L, a.r) - score(L, b.r));
  // structured seeds: whole floors of columns, one side, plus an imploder above
  const cols = S.filter((s) => s.vertical && s.local < 0 && Math.abs(s.local) > 0.6);
  const floorsY = [...new Set(cols.map((c) => Math.round(c.y)))].sort((a, b) => a - b);
  const pieceX = (i: number) => { const d = L.pieces[i]; return d.x; };
  const seeds: Placement[][] = [];
  const floorCols = (y: number) => cols.filter((c) => Math.round(c.y) === y);
  const asCharge = (c: { piece: number; local: number }, fuse = 0): Placement => ({ kind: kinds.includes('charge') ? 'charge' : kinds.includes('cutter') ? 'cutter' : kinds[0], piece: c.piece, local: c.local, fuse, dir: 0 });
  for (let f = 0; f < Math.min(3, floorsY.length); f++) {
    const base = floorCols(floorsY[f]).map((c) => asCharge(c));
    seeds.push(base);
    for (let g = f + 1; g < Math.min(f + 3, floorsY.length); g++) seeds.push([...base, ...floorCols(floorsY[g]).map((c) => asCharge(c, 0.5))]);
    const xs = base.map((b) => pieceX(b.piece));
    if (xs.length > 1) {
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      seeds.push(base.filter((b) => pieceX(b.piece) < (minX + maxX) / 2 + 0.1));
      seeds.push(base.filter((b) => pieceX(b.piece) > (minX + maxX) / 2 - 0.1));
    }
  }
  // imploders on the middle of a beam at several heights, a beat after the columns go
  const beamSites = S.filter((s) => !s.vertical).sort((a, b) => a.y - b.y || Math.abs(a.local) - Math.abs(b.local));
  const beamYs = [...new Set(beamSites.map((s) => Math.round(s.y)))];
  const centreBeam = (y: number) => beamSites.filter((s) => Math.round(s.y) === y).sort((a, b) => Math.abs(pieceX(a.piece) + a.local) - Math.abs(pieceX(b.piece) + b.local))[0];
  const base0 = seeds.slice();
  if (kinds.includes('imploder')) {
    for (const yi of [0.25, 0.5, 0.75]) {
      const site = centreBeam(beamYs[Math.min(beamYs.length - 1, Math.floor(beamYs.length * yi))]);
      if (!site) continue;
      for (const fuse of [0.2, 0.5]) for (const sd of base0) seeds.push([...sd, { kind: 'imploder', piece: site.piece, local: site.local, fuse, dir: 0 }]);
    }
  }
  // kickers on the outer columns of an upper floor, pointing inward, so the top folds into the middle
  if (kinds.includes('kicker') && floorsY.length > 1) {
    const upper = floorCols(floorsY[Math.min(floorsY.length - 1, Math.max(1, Math.floor(floorsY.length / 2)))]);
    if (upper.length > 1) {
      const l = upper.reduce((a, b) => (pieceX(a.piece) < pieceX(b.piece) ? a : b)), r = upper.reduce((a, b) => (pieceX(a.piece) > pieceX(b.piece) ? a : b));
      const kick = (c: typeof l, dir: number): Placement => ({ kind: 'kicker', piece: c.piece, local: c.local, fuse: 0.3, dir });
      for (const sd of seeds.slice()) seeds.push([...sd, kick(l, 0), ...((budget.kicker ?? 0) > 1 ? [kick(r, Math.PI)] : [])]);
    }
  }
  for (const sd of seeds) if (sd.length && fits(sd) && evals.length < EVALS * 0.6) singles.push(evaluate(sd));
  // the level's hand-made layouts
  for (const d of L.designs ?? []) {
    const s = new Sim(L);
    for (const [kind, x, y, fuse, dir] of d) if (!s.placeCharge(kind, x, y, { fuse: fuse ?? 0, dir: dir ?? 0 })) console.warn(`${L.id}: design charge ${kind} at ${x},${y} did not place`);
    const pl = s.placements();
    s.destroy();
    singles.push(evaluate(pl));
  }
  singles.sort((a, b) => score(L, a.r) - score(L, b.r));
  // 2. beam search: extend good partial solutions
  let beam = singles.slice(0, 6);
  for (let depth = 2; depth <= total && evals.length < EVALS * 0.8; depth++) {
    const next: Eval[] = [];
    for (const b of beam) {
      for (let k = 0; k < 6 && evals.length < EVALS * 0.8; k++) {
        const kind = kinds[(R() * kinds.length) | 0];
        // prefer adding sites from good singles
        const pick = singles[(R() * Math.min(singles.length, 12)) | 0].pl;
        const src = R() < 0.6 ? pick[(R() * pick.length) | 0] : randomPlacement(kind);
        const add: Placement = { ...src, kind, fuse: depth > 1 ? FUSES[(R() * FUSES.length) | 0] : 0, dir: DIRS[(R() * DIRS.length) | 0] };
        const pl = [...b.pl, add];
        if (!fits(pl)) continue;
        next.push(evaluate(pl));
      }
    }
    next.sort((a, b) => score(L, a.r) - score(L, b.r));
    beam = [...beam, ...next].sort((a, b) => score(L, a.r) - score(L, b.r)).slice(0, 6);
  }
  // 3. random combos
  while (evals.length < EVALS) {
    const n = 1 + ((R() * total) | 0);
    const pl: Placement[] = [];
    for (let i = 0; i < n * 2 && pl.length < n; i++) {
      const cand = [...pl, randomPlacement(kinds[(R() * kinds.length) | 0])];
      if (fits(cand)) pl.push(cand[cand.length - 1]);
    }
    if (pl.length) evaluate(pl);
  }
  // robustness: re-run the best solutions with nudged positions; keep the worst outcome
  const nudge = (pl: Placement[], d: number) => pl.map((p) => ({ ...p, local: p.local + d }));
  const robust = (e: Eval): number => {
    let worst = score(L, e.r);
    for (const d of [-CHARGE_GRID, CHARGE_GRID]) worst = Math.max(worst, score(L, run(L, nudge(e.pl, d))));
    return worst;
  };
  const clean = evals.filter((e) => !e.r.damaged).sort((a, b) => a.r.height - b.r.height);
  // best robust height for each number of charges
  const bestByN = new Map<number, { h: number; e: Eval }>();
  const checked = new Map<Eval, number>();
  for (let n = 1; n <= total; n++) {
    const cands = clean.filter((e) => e.pl.length <= n).slice(0, 8);
    // more charges never needs to do worse than fewer
    let best: { h: number; e: Eval } | null = bestByN.get(n - 1) ?? null;
    for (const e of cands) {
      const h = checked.get(e) ?? robust(e);
      checked.set(e, h);
      if (!best || h < best.h) best = { h, e };
    }
    if (best) bestByN.set(n, best);
  }
  // lot / noFuse / single bonuses: any clean clearing solution that meets them?
  return { evals: evals.length, bestByN, clean, ms: performance.now() - t0, total };
}

const cal: Record<string, any> = existsSync(CAL_PATH) ? JSON.parse(readFileSync(CAL_PATH, 'utf8')) : {};
for (const L of LEVELS) {
  if (ids.length && !ids.includes(L.id)) continue;
  const res = solveLevel(L);
  const start = (() => { const s = new Sim(L); const h = s.rubbleHeight(); s.destroy(); return h; })();
  const line = [...res.bestByN].map(([n, b]) => `${n}:${b.h.toFixed(1)}`).join(' ');
  const bestAll = Math.min(...[...res.bestByN.values()].map((b) => b.h));
  // calibrate
  let pass = L.passLine;
  if (!(bestAll <= pass - 0.5)) pass = Math.ceil(bestAll + 1.5);
  let par = res.total;
  for (const [n, b] of res.bestByN) if (b.h <= pass - 0.5) { par = Math.min(par, n); }
  const gold = Math.max(1, Math.min(pass - 1, Math.round((bestAll + Math.max(1, pass * 0.12)) * 2) / 2));
  const parSol = [...res.bestByN].find(([n, b]) => n === par && b.h <= pass - 0.5)?.[1].e.pl ?? [...res.bestByN.values()][0]?.e.pl;
  // bonus feasibility
  let bonusOk: boolean | string = true;
  if (L.bonus.type === 'lot') {
    const b = L.bonus;
    bonusOk = res.clean.some((e) => e.r.height <= pass && insideLot(L, e.pl, b.x0, b.x1));
  } else if (L.bonus.type === 'noFuse') bonusOk = res.clean.some((e) => e.r.height <= pass && e.pl.every((p) => p.fuse === 0));
  console.log(`${L.id.padEnd(4)} ${L.name.padEnd(15)} start ${start.toFixed(1).padStart(5)} pass ${L.passLine}->${pass} par ${par}/${res.total} gold ${gold} bonus(${L.bonus.type}) ${bonusOk ? 'ok' : 'NO'} | ${line} | ${res.evals} sims ${(res.ms / 1000).toFixed(1)}s`);
  cal[L.id] = { passLine: pass, goldLine: gold, par, best: +bestAll.toFixed(2), solution: parSol, bonusFeasible: !!bonusOk };
}
if (WRITE) { writeFileSync(CAL_PATH, JSON.stringify(cal, null, 1)); console.log('wrote', CAL_PATH.pathname); }

function insideLot(L: LevelDef, pl: Placement[], x0: number, x1: number): boolean {
  const s = new Sim({ ...L, bonus: { type: 'lot', x0, x1 } });
  for (const p of pl) s.placeAt(p);
  const r = s.runToEnd(60 * 20);
  s.destroy();
  return r.bonusMet;
}
