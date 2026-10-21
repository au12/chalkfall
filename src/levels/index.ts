// The level list with the solver's calibration applied (pass line, gold line, par).
// tools/solve.ts writes calibration.json from headless runs of every level; the par it finds is the
// fewest charges that clear the level with a safety margin, and players get one spare on top.
import { LEVELS } from './worlds.ts';
import calibration from './calibration.json';
import type { Placement } from '../game/sim.ts';

export interface Calibration {
  passLine: number;
  goldLine: number;
  par: number;               // fewest charges the solver needed
  best: number;              // lowest rubble the solver reached
  solution?: Placement[];    // a clearing layout with `par` charges (used for hints)
  bonusFeasible?: boolean;
}

export const PAR_SLACK = 1;
export const CALIBRATION = calibration as Record<string, Calibration>;

for (const L of LEVELS) {
  const c = CALIBRATION[L.id];
  if (!c) continue;
  const total = Object.values(L.charges).reduce((s, n) => s + (n ?? 0), 0);
  L.passLine = c.passLine;
  L.goldLine = c.goldLine;
  L.par = Math.min(total, c.par + PAR_SLACK);
}

export { LEVELS };
export { WORLDS } from './worlds.ts';
