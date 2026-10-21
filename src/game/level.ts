// Level definitions and a small builder DSL for chalk structures.
import type { ChargeKind, MaterialId } from './constants.ts';

export interface PieceDef {
  x: number; y: number;          // centre
  w: number; h: number;          // size along local x / y
  angle?: number;
  mat: MaterialId;
  poly?: number[][];             // optional convex polygon (local) instead of a box
  static?: boolean;
  tag?: string;
}

export interface ProtectedDef {
  kind: 'house' | 'shop' | 'tree' | 'car' | 'statue' | 'kiosk';
  x: number; w: number; h: number; // standing on the ground at x (centre)
  y?: number;
}

export type BonusGoal =
  | { type: 'gold' }                              // rubble below the gold line
  | { type: 'lot'; x0: number; x1: number }       // nothing ends up outside the lot
  | { type: 'noFuse' }                            // no delayed charges
  | { type: 'single'; kind: ChargeKind };         // only this charge type

export interface LevelDef {
  id: string;
  world: number;
  index: number;
  name: string;
  pieces: PieceDef[];
  welds?: [number, number, number, number][];     // pieceA, pieceB, anchor x, y
  weldStrength?: number;                          // break force for welds
  groundY?: number;
  ground?: [number, number];                      // ground extent x0..x1
  passLine: number;
  goldLine: number;
  par: number;                                    // charges for the par star
  bonus: BonusGoal;
  charges: Partial<Record<ChargeKind, number>>;
  protected?: ProtectedDef[];
  // x: centre; w: width that must be visible; top: highest point that must be visible (above ground);
  // y/h: a fallback view for callers that don't fit to the screen
  camera?: { x: number; y: number; h: number; w?: number; top?: number };
  hint?: string;
  // hand-made layouts ([kind, x, y, fuse?, dir?] per charge) the solver tries alongside its own search
  designs?: [ChargeKind, number, number, number?, number?][][];
  doodles?: { kind: string; x: number; y: number; s?: number; text?: string }[];
}

// ---------------------------------------------------------------------------- builder

export class Build {
  pieces: PieceDef[] = [];
  welds: [number, number, number, number][] = [];

  add(p: PieceDef): number { this.pieces.push(p); return this.pieces.length - 1; }

  // vertical column standing on y0
  col(x: number, y0: number, h: number, mat: MaterialId = 'wood', t = 1): number {
    return this.add({ x, y: y0 + h / 2, w: t, h, mat });
  }

  // horizontal beam whose bottom is at y
  beam(x0: number, x1: number, y: number, mat: MaterialId = 'wood', t = 1): number {
    return this.add({ x: (x0 + x1) / 2, y: y + t / 2, w: x1 - x0, h: t, mat });
  }

  block(x: number, y0: number, w: number, h: number, mat: MaterialId = 'concrete'): number {
    return this.add({ x, y: y0 + h / 2, w, h, mat });
  }

  // diagonal brace from (x0, y0) to (x1, y1)
  brace(x0: number, y0: number, x1: number, y1: number, mat: MaterialId = 'wood', t = 0.6): number {
    const dx = x1 - x0, dy = y1 - y0;
    return this.add({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: Math.hypot(dx, dy), h: t, angle: Math.atan2(dy, dx), mat });
  }

  // triangular gable roof over x0..x1 at height y
  roof(x0: number, x1: number, y: number, rise: number, mat: MaterialId = 'wood'): number {
    const cx = (x0 + x1) / 2, hw = (x1 - x0) / 2;
    return this.add({ x: cx, y: y + rise / 3, w: x1 - x0, h: rise, mat, poly: [[-hw, -rise / 3], [hw, -rise / 3], [0, rise * 2 / 3]] });
  }

  weld(a: number, b: number, x: number, y: number): void { this.welds.push([a, b, x, y]); }

  // A framed building: columns at every bay line, a beam per floor (beams rest on the columns;
  // with weld: true every joint is bolted and can snap under load).
  frame(o: { x: number; y0?: number; bays: number; bayW: number; floors: number; floorH: number | number[]; mat?: MaterialId; beamMat?: MaterialId; t?: number; weld?: boolean; overhang?: number; skip?: (floor: number, col: number) => boolean }) {
    const y0 = o.y0 ?? 0, t = o.t ?? 1, mat = o.mat ?? 'wood', bmat = o.beamMat ?? mat;
    const width = o.bays * o.bayW;
    const left = o.x - width / 2;
    const cols: number[][] = [], beams: number[] = [];
    let y = y0;
    for (let f = 0; f < o.floors; f++) {
      const fh = Array.isArray(o.floorH) ? o.floorH[f] : o.floorH;
      const row: number[] = [];
      const yBase = y;
      for (let b = 0; b <= o.bays; b++) {
        if (o.skip?.(f, b)) { row.push(-1); continue; }
        row.push(this.col(left + b * o.bayW, yBase, fh, mat, t));
      }
      cols.push(row);
      y += fh;
      const ov = o.overhang ?? t / 2;
      const bi = this.beam(left - ov, left + width + ov, y, bmat, t);
      beams.push(bi);
      if (o.weld) {
        for (let b = 0; b <= o.bays; b++) {
          if (row[b] < 0) continue;
          const cx = left + b * o.bayW;
          this.weld(row[b], bi, cx, y);
          if (f > 0) this.weld(row[b], beams[f - 1], cx, yBase);
        }
      }
      y += t;
    }
    return { cols, beams, top: y, left, right: left + width };
  }

  // Stacked blocks, optionally offset every other row like brickwork.
  blocks(x: number, y0: number, cols: number, rows: number, bw: number, bh: number, mat: MaterialId = 'concrete', brick = false): number[] {
    const out: number[] = [];
    for (let r = 0; r < rows; r++) {
      const off = brick && r % 2 ? bw / 2 : 0;
      const n = brick && r % 2 ? cols - 1 : cols;
      const left = x - cols * bw / 2 + off;
      for (let c = 0; c < n; c++) out.push(this.block(left + c * bw + bw / 2, y0 + r * bh, bw - 0.02, bh - 0.02, mat));
    }
    return out;
  }
}
