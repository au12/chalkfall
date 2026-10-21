// Chalkfall artwork, drawn procedurally: frames, charges, protected buildings, doodles, the
// foreman mascot ("Dusty"), the plunger and the logo. Every drawing takes a seed and a
// variant so it can be redrawn with a slightly different hand ("boiling" lines).
import { applyGrain, circle, hatch, line, makeCanvas, PALETTE, polyline, text, type Ctx, type Rand } from './chalk.ts';
import { rng } from '../game/sim.ts';
import type { MaterialId, ChargeKind } from '../game/constants.ts';

export const MAT_COLOR: Record<MaterialId, string> = {
  wood: PALETTE.wood, concrete: PALETTE.concrete, steel: PALETTE.steel, glass: PALETTE.glass, stone: PALETTE.stone,
};

export const CHARGE_COLOR: Record<ChargeKind, string> = {
  charge: PALETTE.red, blaster: PALETTE.orange, cutter: PALETTE.blue, kicker: PALETTE.green, imploder: PALETTE.purple,
};

export interface Drawing { canvas: HTMLCanvasElement; ax: number; ay: number }   // anchor (0..1)

// ---------------------------------------------------------------------------- frames

const MARGIN = 0.35;

// Points of one side, with a broken (jagged) edge when requested.
function side(r: Rand, a: number[], b: number[], jag: boolean, amp: number): number[][] {
  if (!jag) return [a, b];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const teeth = Math.max(2, Math.round(len / (amp * 1.6)));
  const pts: number[][] = [a];
  for (let i = 1; i < teeth; i++) {
    const t = i / teeth, k = (i % 2 ? 1 : -0.6) * amp * (0.5 + r() * 0.8);
    pts.push([a[0] + dx * t + nx * k, a[1] + dy * t + ny * k]);
  }
  pts.push(b);
  return pts;
}

// A frame piece (box w x h in units) at ppu pixels per unit. jagged: 1 -x, 2 +x, 4 -y, 8 +y.
export function frameArt(w: number, h: number, mat: MaterialId, jagged: number, seed: number, ppu: number): Drawing {
  const W = (w + MARGIN * 2) * ppu, H = (h + MARGIN * 2) * ppu;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d') as Ctx;
  const r = rng(seed);
  const u = ppu;
  const x0 = MARGIN * u, y0 = MARGIN * u, x1 = x0 + w * u, y1 = y0 + h * u;
  const col = MAT_COLOR[mat];
  const lw = Math.max(1.2, 0.1 * u) * (mat === 'glass' ? 0.8 : 1);
  const amp = Math.min(w, h) * 0.18 * u;
  // canvas y grows downwards; local +y is "up" -> top edge is y0
  const TL = [x0, y0], TR = [x1, y0], BR = [x1, y1], BL = [x0, y1];
  const outline = [
    ...side(r, BL, TL, !!(jagged & 1), amp),           // -x end
    ...side(r, TL, TR, !!(jagged & 8), amp).slice(1),  // top (+y)
    ...side(r, TR, BR, !!(jagged & 2), amp).slice(1),  // +x end
    ...side(r, BR, BL, !!(jagged & 4), amp).slice(1),  // bottom (-y)
  ];
  const clip = (g: Ctx) => { g.moveTo(outline[0][0], outline[0][1]); for (const p of outline.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); };
  const long = w >= h;
  // body tint
  ctx.save();
  ctx.beginPath(); clip(ctx);
  ctx.globalAlpha = mat === 'glass' ? 0.12 : mat === 'stone' ? 0.16 : 0.1;
  ctx.fillStyle = col;
  ctx.fill();
  ctx.restore();
  const bounds: [number, number, number, number] = [x0, y0, x1, y1];
  switch (mat) {
    case 'wood': {
      // grain lines along the frame and a knot or two
      const n = Math.max(1, Math.round(Math.min(w, h) * 2));
      for (let i = 1; i <= n; i++) {
        const t = i / (n + 1);
        if (long) line(ctx, r, x0 + u * 0.3, y0 + (y1 - y0) * t, x1 - u * 0.3, y0 + (y1 - y0) * t + (r() - 0.5) * u * 0.15, { width: lw * 0.5, color: col, alpha: 0.45, passes: 1, dust: 0, jitter: u * 0.12 });
        else line(ctx, r, x0 + (x1 - x0) * t, y0 + u * 0.3, x0 + (x1 - x0) * t + (r() - 0.5) * u * 0.15, y1 - u * 0.3, { width: lw * 0.5, color: col, alpha: 0.45, passes: 1, dust: 0, jitter: u * 0.12 });
      }
      const knots = Math.floor(Math.max(w, h) / 4);
      for (let k = 0; k < knots; k++) {
        const kx = long ? x0 + (0.2 + r() * 0.6) * (x1 - x0) : (x0 + x1) / 2;
        const ky = long ? (y0 + y1) / 2 : y0 + (0.2 + r() * 0.6) * (y1 - y0);
        circle(ctx, r, kx, ky, u * (long ? 0.35 : 0.18), u * (long ? 0.18 : 0.35), { width: lw * 0.5, color: col, alpha: 0.5, passes: 1 });
      }
      break;
    }
    case 'concrete': {
      ctx.save(); ctx.beginPath(); clip(ctx); ctx.clip();
      ctx.fillStyle = col;
      const dots = Math.floor(w * h * 7);
      for (let i = 0; i < dots; i++) {
        ctx.globalAlpha = 0.25 + r() * 0.35;
        const s = u * (0.04 + r() * 0.07);
        ctx.fillRect(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), s, s);
      }
      ctx.restore();
      hatch(ctx, r, clip, bounds, { spacing: u * 0.9, angle: Math.PI / 4, width: lw * 0.45, color: col, alpha: 0.18 });
      break;
    }
    case 'steel': {
      // I-beam flanges and rivets
      const inset = Math.min(w, h) * u * 0.22;
      if (long) {
        line(ctx, r, x0 + u * 0.15, y0 + inset, x1 - u * 0.15, y0 + inset, { width: lw * 0.6, color: col, alpha: 0.7, passes: 2, dust: 0 });
        line(ctx, r, x0 + u * 0.15, y1 - inset, x1 - u * 0.15, y1 - inset, { width: lw * 0.6, color: col, alpha: 0.7, passes: 2, dust: 0 });
      } else {
        line(ctx, r, x0 + inset, y0 + u * 0.15, x0 + inset, y1 - u * 0.15, { width: lw * 0.6, color: col, alpha: 0.7, passes: 2, dust: 0 });
        line(ctx, r, x1 - inset, y0 + u * 0.15, x1 - inset, y1 - u * 0.15, { width: lw * 0.6, color: col, alpha: 0.7, passes: 2, dust: 0 });
      }
      ctx.fillStyle = col;
      const L = Math.max(w, h), rivets = Math.max(2, Math.floor(L / 1.6));
      for (let i = 0; i < rivets; i++) {
        const t = (i + 0.5) / rivets;
        const rx = long ? x0 + (x1 - x0) * t : (x0 + x1) / 2, ry = long ? (y0 + y1) / 2 : y0 + (y1 - y0) * t;
        ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.arc(rx, ry, u * 0.08, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'glass': {
      ctx.save(); ctx.beginPath(); clip(ctx); ctx.clip();
      for (let i = 0; i < Math.max(1, Math.floor(Math.max(w, h) / 2.5)); i++) {
        const sx = x0 + (0.15 + r() * 0.6) * (x1 - x0), sy = y0 + (0.2 + r() * 0.4) * (y1 - y0);
        line(ctx, r, sx, sy + u * 0.5, sx + u * 0.5, sy, { width: lw * 0.7, color: '#ffffff', alpha: 0.6, passes: 1, dust: 0 });
        line(ctx, r, sx + u * 0.25, sy + u * 0.75, sx + u * 0.75, sy + u * 0.25, { width: lw * 0.5, color: '#ffffff', alpha: 0.4, passes: 1, dust: 0 });
      }
      ctx.restore();
      break;
    }
    case 'stone': {
      hatch(ctx, r, clip, bounds, { spacing: u * 0.45, angle: -Math.PI / 4, width: lw * 0.55, color: col, alpha: 0.35, cross: true });
      break;
    }
  }
  // outline last (double for reinforced)
  polyline(ctx, r, outline, { width: lw, color: col, alpha: 0.95, passes: 3 }, true);
  if (mat === 'stone') {
    const g = u * 0.16;
    polyline(ctx, r, [[x0 + g, y0 + g], [x1 - g, y0 + g], [x1 - g, y1 - g], [x0 + g, y1 - g]], { width: lw * 0.7, color: col, alpha: 0.8, passes: 2 }, true);
  }
  applyGrain(ctx, W, H, 0.5);
  return { canvas: c, ax: 0.5, ay: 0.5 };
}

// A convex polygon piece (roof, glass shard). Points in units, local, y up.
export function polyArt(pts: number[][], mat: MaterialId, seed: number, ppu: number, shard = false): Drawing {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const m = shard ? 0.15 : MARGIN;
  const W = (maxX - minX + m * 2) * ppu, H = (maxY - minY + m * 2) * ppu;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d') as Ctx;
  const r = rng(seed);
  const P = pts.map(([x, y]) => [(x - minX + m) * ppu, (maxY - y + m) * ppu]);
  const col = MAT_COLOR[mat];
  const lw = Math.max(1, (shard ? 0.06 : 0.1) * ppu);
  const clip = (g: Ctx) => { g.moveTo(P[0][0], P[0][1]); for (const p of P.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); };
  ctx.save(); ctx.beginPath(); clip(ctx); ctx.globalAlpha = shard ? 0.2 : 0.1; ctx.fillStyle = col; ctx.fill(); ctx.restore();
  if (!shard) hatch(ctx, r, clip, [0, 0, W, H], { spacing: ppu * 0.7, angle: Math.PI / 5, width: lw * 0.5, color: col, alpha: 0.3 });
  polyline(ctx, r, P, { width: lw, color: col, alpha: 0.95, passes: shard ? 2 : 3 }, true);
  if (!shard) applyGrain(ctx, W, H, 0.5);
  // anchor = where local (0, 0) lands
  return { canvas: c, ax: (-minX + m) * ppu / W, ay: (maxY + m) * ppu / H };
}

// Long ground strip tile: a chalk line on top, earthy hatching below. size in units.
export function groundTile(wUnits: number, ppu: number, seed: number): Drawing {
  const W = wUnits * ppu, H = 4 * ppu;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d') as Ctx;
  const r = rng(seed);
  const top = ppu * 0.5;
  line(ctx, r, -ppu, top, W + ppu, top + (r() - 0.5) * ppu * 0.05, { width: ppu * 0.16, alpha: 0.95, passes: 3 });
  line(ctx, r, -ppu, top + ppu * 0.22, W + ppu, top + ppu * 0.22, { width: ppu * 0.06, alpha: 0.4, passes: 1 });
  hatch(ctx, r, (g) => g.rect(0, top + ppu * 0.35, W, H), [0, top, W, H], { spacing: ppu * 0.55, angle: -Math.PI / 3, width: ppu * 0.05, alpha: 0.16 });
  // pebbles
  for (let i = 0; i < wUnits * 0.6; i++) circle(ctx, r, r() * W, top + ppu * (0.7 + r() * 2.5), ppu * 0.12, ppu * 0.08, { width: ppu * 0.04, alpha: 0.35, passes: 1 });
  applyGrain(ctx, W, H, 0.45);
  return { canvas: c, ax: 0, ay: top / H };
}

// ---------------------------------------------------------------------------- charges

// Charge icon, about 1.6 x 1.6 units; dir only matters for kickers.
export function chargeArt(kind: ChargeKind, seed: number, ppu: number): Drawing {
  const S = 1.8 * ppu;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d') as Ctx;
  const r = rng(seed);
  const u = ppu, m = S / 2;
  const col = CHARGE_COLOR[kind];
  const lw = Math.max(1.2, u * 0.09);
  const o = { width: lw, color: col, passes: 2 };
  switch (kind) {
    case 'charge': {
      // three sticks of dynamite, a band and a fuse
      for (let i = -1; i <= 1; i++) {
        const x = m + i * u * 0.32;
        polyline(ctx, r, [[x - u * 0.14, m - u * 0.45], [x + u * 0.14, m - u * 0.45], [x + u * 0.14, m + u * 0.5], [x - u * 0.14, m + u * 0.5]], o, true);
        hatch(ctx, r, (g) => g.rect(x - u * 0.14, m - u * 0.45, u * 0.28, u * 0.95), [x - u * 0.2, m - u * 0.5, x + u * 0.2, m + u * 0.55], { spacing: u * 0.12, angle: 1.2, width: lw * 0.5, color: col, alpha: 0.5 });
      }
      line(ctx, r, m - u * 0.5, m + u * 0.05, m + u * 0.5, m + u * 0.05, { width: lw * 1.2, color: PALETTE.white, passes: 2 });
      polyline(ctx, r, [[m, m - u * 0.45], [m + u * 0.1, m - u * 0.65], [m + u * 0.3, m - u * 0.72]], { width: lw * 0.7, color: PALETTE.white, passes: 1 });
      circle(ctx, r, m + u * 0.36, m - u * 0.75, u * 0.07, u * 0.07, { width: lw, color: PALETTE.yellow, passes: 2 });
      break;
    }
    case 'blaster': {
      circle(ctx, r, m, m + u * 0.08, u * 0.52, u * 0.52, o);
      hatch(ctx, r, (g) => g.arc(m, m + u * 0.08, u * 0.5, 0, Math.PI * 2), [m - u * 0.6, m - u * 0.5, m + u * 0.6, m + u * 0.7], { spacing: u * 0.11, angle: -0.8, width: lw * 0.5, color: col, alpha: 0.45 });
      polyline(ctx, r, [[m - u * 0.14, m - u * 0.42], [m + u * 0.14, m - u * 0.42], [m + u * 0.12, m - u * 0.55], [m - u * 0.12, m - u * 0.55]], o, true);
      polyline(ctx, r, [[m, m - u * 0.55], [m + u * 0.18, m - u * 0.72], [m + u * 0.4, m - u * 0.7]], { width: lw * 0.7, color: PALETTE.white, passes: 1 });
      circle(ctx, r, m + u * 0.45, m - u * 0.72, u * 0.07, u * 0.07, { width: lw, color: PALETTE.yellow, passes: 2 });
      circle(ctx, r, m - u * 0.2, m - u * 0.1, u * 0.1, u * 0.06, { width: lw * 0.6, color: PALETTE.white, passes: 1 });
      break;
    }
    case 'cutter': {
      // a clamp-shaped charge with a cutting line
      polyline(ctx, r, [[m - u * 0.5, m - u * 0.45], [m + u * 0.5, m - u * 0.45], [m + u * 0.5, m + u * 0.45], [m - u * 0.5, m + u * 0.45]], o, true);
      line(ctx, r, m, m - u * 0.75, m, m + u * 0.75, { width: lw * 0.9, color: PALETTE.white, passes: 2 });
      for (const s of [-1, 1]) polyline(ctx, r, [[m + s * u * 0.18, m - u * 0.25], [m + s * u * 0.05, m], [m + s * u * 0.18, m + u * 0.25]], { width: lw * 0.7, color: col, passes: 1 });
      break;
    }
    case 'kicker': {
      // box with an arrow pointing +x (rotated to aim)
      polyline(ctx, r, [[m - u * 0.45, m - u * 0.4], [m + u * 0.1, m - u * 0.4], [m + u * 0.1, m + u * 0.4], [m - u * 0.45, m + u * 0.4]], o, true);
      line(ctx, r, m - u * 0.3, m, m + u * 0.75, m, { width: lw * 1.1, color: PALETTE.white, passes: 2 });
      polyline(ctx, r, [[m + u * 0.48, m - u * 0.26], [m + u * 0.78, m], [m + u * 0.48, m + u * 0.26]], { width: lw * 1.1, color: PALETTE.white, passes: 2 });
      break;
    }
    case 'imploder': {
      circle(ctx, r, m, m, u * 0.55, u * 0.55, o);
      // inward spiral
      const pts: number[][] = [];
      for (let i = 0; i <= 30; i++) { const t = i / 30, a = t * Math.PI * 3.2, rr = u * 0.42 * (1 - t); pts.push([m + Math.cos(a) * rr, m + Math.sin(a) * rr]); }
      polyline(ctx, r, pts, { width: lw * 0.7, color: PALETTE.white, passes: 1 });
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4, x = m + Math.cos(a) * u * 0.78, y = m + Math.sin(a) * u * 0.78;
        line(ctx, r, x, y, m + Math.cos(a) * u * 0.62, m + Math.sin(a) * u * 0.62, { width: lw * 0.6, color: col, passes: 1 });
      }
      break;
    }
  }
  applyGrain(ctx, S, S, 0.35);
  return { canvas: c, ax: 0.5, ay: 0.5 };
}

// ---------------------------------------------------------------------------- protected buildings

export function protectedArt(kind: string, w: number, h: number, seed: number, ppu: number): Drawing {
  const m = 0.4;
  const W = (w + m * 2) * ppu, H = (h + m * 2 + 2) * ppu;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d') as Ctx;
  const r = rng(seed);
  const u = ppu, x0 = m * u, x1 = x0 + w * u, yb = H - m * u, yt = yb - h * u;
  const col = PALETTE.pink, o = { width: Math.max(1.2, u * 0.1), color: col, passes: 3 };
  const thin = { ...o, width: o.width * 0.6, passes: 2 };
  switch (kind) {
    case 'house': {
      const wallTop = yt + h * u * 0.38;
      polyline(ctx, r, [[x0, yb], [x0, wallTop], [x1, wallTop], [x1, yb]], o);
      polyline(ctx, r, [[x0 - u * 0.4, wallTop], [(x0 + x1) / 2, yt], [x1 + u * 0.4, wallTop]], o);
      polyline(ctx, r, [[x1 - w * u * 0.25, yt + h * u * 0.2], [x1 - w * u * 0.25, yt + h * u * 0.08], [x1 - w * u * 0.13, yt + h * u * 0.08], [x1 - w * u * 0.13, yt + h * u * 0.3]], thin);
      const dw = w * u * 0.18;
      polyline(ctx, r, [[x0 + w * u * 0.2, yb], [x0 + w * u * 0.2, yb - h * u * 0.32], [x0 + w * u * 0.2 + dw, yb - h * u * 0.32], [x0 + w * u * 0.2 + dw, yb]], thin);
      const wx = x0 + w * u * 0.58, wy = wallTop + h * u * 0.14, ws = w * u * 0.22;
      polyline(ctx, r, [[wx, wy], [wx + ws, wy], [wx + ws, wy + ws], [wx, wy + ws]], thin, true);
      line(ctx, r, wx + ws / 2, wy, wx + ws / 2, wy + ws, { ...thin, passes: 1 });
      line(ctx, r, wx, wy + ws / 2, wx + ws, wy + ws / 2, { ...thin, passes: 1 });
      break;
    }
    case 'shop': {
      polyline(ctx, r, [[x0, yb], [x0, yt + h * u * 0.2], [x1, yt + h * u * 0.2], [x1, yb]], o);
      // striped awning
      const ay = yt + h * u * 0.32;
      polyline(ctx, r, [[x0 - u * 0.3, ay + u * 0.6], [x0, yt + h * u * 0.2], [x1, yt + h * u * 0.2], [x1 + u * 0.3, ay + u * 0.6]], o);
      for (let i = 1; i < 6; i++) { const x = x0 + (x1 - x0) * i / 6; line(ctx, r, x, yt + h * u * 0.2, x + (i - 3) * u * 0.08, ay + u * 0.6, thin); }
      polyline(ctx, r, [[x0 + w * u * 0.12, yb - h * u * 0.1], [x0 + w * u * 0.12, ay + u * 1.2], [x0 + w * u * 0.55, ay + u * 1.2], [x0 + w * u * 0.55, yb - h * u * 0.1]], thin, true);
      text(ctx, r, 'OPEN', x0 + w * u * 0.78, ay + u * 1.6, u * 0.55, { color: col, align: 'center' });
      break;
    }
    case 'tree': {
      line(ctx, r, (x0 + x1) / 2, yb, (x0 + x1) / 2, yt + h * u * 0.45, { ...o, width: o.width * 1.3 });
      for (let i = 0; i < 5; i++) {
        const cx = x0 + (x1 - x0) * (0.25 + r() * 0.5), cy = yt + h * u * (0.18 + r() * 0.25);
        circle(ctx, r, cx, cy, w * u * (0.22 + r() * 0.12), h * u * (0.13 + r() * 0.08), thin);
      }
      break;
    }
    case 'car': {
      const by = yb - h * u * 0.25;
      polyline(ctx, r, [[x0, by], [x0, yt + h * u * 0.45], [x0 + w * u * 0.25, yt + h * u * 0.42], [x0 + w * u * 0.35, yt], [x0 + w * u * 0.72, yt], [x0 + w * u * 0.85, yt + h * u * 0.42], [x1, yt + h * u * 0.5], [x1, by]], o, true);
      for (const t of [0.22, 0.78]) circle(ctx, r, x0 + w * u * t, by + h * u * 0.05, h * u * 0.2, h * u * 0.2, o);
      line(ctx, r, x0 + w * u * 0.52, yt + u * 0.1, x0 + w * u * 0.52, yt + h * u * 0.42, thin);
      break;
    }
    case 'statue': {
      polyline(ctx, r, [[x0, yb], [x0 + w * u * 0.1, yb - h * u * 0.25], [x1 - w * u * 0.1, yb - h * u * 0.25], [x1, yb]], o, true);
      const cx = (x0 + x1) / 2;
      circle(ctx, r, cx, yt + h * u * 0.12, w * u * 0.12, w * u * 0.12, thin);
      line(ctx, r, cx, yt + h * u * 0.22, cx, yb - h * u * 0.45, thin);
      line(ctx, r, cx, yt + h * u * 0.3, cx + w * u * 0.3, yt, thin);   // raised arm holding a torch
      circle(ctx, r, cx + w * u * 0.3, yt - u * 0.15, u * 0.15, u * 0.2, { ...thin, color: PALETTE.yellow });
      line(ctx, r, cx, yt + h * u * 0.32, cx - w * u * 0.22, yt + h * u * 0.48, thin);
      line(ctx, r, cx, yb - h * u * 0.45, cx - w * u * 0.15, yb - h * u * 0.25, thin);
      line(ctx, r, cx, yb - h * u * 0.45, cx + w * u * 0.15, yb - h * u * 0.25, thin);
      break;
    }
    default: { // kiosk
      polyline(ctx, r, [[x0, yb], [x0, yt + h * u * 0.25], [x1, yt + h * u * 0.25], [x1, yb]], o);
      polyline(ctx, r, [[x0 - u * 0.3, yt + h * u * 0.25], [(x0 + x1) / 2, yt], [x1 + u * 0.3, yt + h * u * 0.25]], o);
      text(ctx, r, 'NEWS', (x0 + x1) / 2, yt + h * u * 0.5, u * 0.5, { color: col, align: 'center' });
    }
  }
  applyGrain(ctx, W, H, 0.4);
  return { canvas: c, ax: (m * u + w * u / 2) / W, ay: yb / H };
}

// ---------------------------------------------------------------------------- doodles

export function doodleArt(kind: string, seed: number, ppu: number, label = ''): Drawing {
  const r = rng(seed);
  const u = ppu;
  const o = { width: Math.max(1, u * 0.09), passes: 2, alpha: 0.75 };
  let c: HTMLCanvasElement, ctx: Ctx;
  const mk = (w: number, h: number) => { c = makeCanvas(w * u, h * u); ctx = c.getContext('2d') as Ctx; };
  switch (kind) {
    case 'cloud': {
      mk(9, 4);
      const pts: number[][] = [];
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI + i / 40 * Math.PI;
        const bump = 0.25 * Math.abs(Math.sin(i / 40 * Math.PI * 4));
        pts.push([4.5 * u + Math.cos(a) * (3.9 + bump) * u, 3 * u + Math.sin(a) * (2.2 + bump * 2) * u]);
      }
      polyline(ctx!, r, pts, o);
      line(ctx!, r, 0.7 * u, 3 * u, 8.3 * u, 3 * u, o);
      break;
    }
    case 'bird': {
      mk(2, 1.2);
      polyline(ctx!, r, [[0.1 * u, 0.3 * u], [0.6 * u, 0.7 * u], [1 * u, 0.5 * u], [1.4 * u, 0.7 * u], [1.9 * u, 0.25 * u]], { ...o, width: o.width * 0.8 });
      break;
    }
    case 'moon': {
      mk(5, 5);
      circle(ctx!, r, 2.5 * u, 2.5 * u, 1.8 * u, 1.8 * u, o, -1.2, 1.9);
      circle(ctx!, r, 3.1 * u, 2.3 * u, 1.4 * u, 1.5 * u, o, -1.4, 2.2);
      for (let i = 0; i < 3; i++) { const sx = (0.6 + r() * 1) * u, sy = (0.5 + r() * 1.2) * u; line(ctx!, r, sx - 0.2 * u, sy, sx + 0.2 * u, sy, o); line(ctx!, r, sx, sy - 0.2 * u, sx, sy + 0.2 * u, o); }
      break;
    }
    case 'crane': {
      mk(16, 22);
      const mx = 4 * u;
      polyline(ctx!, r, [[mx - 0.8 * u, 22 * u], [mx - 0.8 * u, 3 * u], [mx + 0.8 * u, 3 * u], [mx + 0.8 * u, 22 * u]], o);
      for (let y = 4; y < 22; y += 2) { line(ctx!, r, mx - 0.8 * u, y * u, mx + 0.8 * u, (y + 2) * u, { ...o, width: o.width * 0.5 }); }
      polyline(ctx!, r, [[0.5 * u, 3 * u], [15.5 * u, 3 * u], [15.5 * u, 2.2 * u], [mx, 1 * u], [0.5 * u, 2.2 * u]], o, true);
      line(ctx!, r, 13 * u, 3 * u, 13 * u, 10 * u, { ...o, width: o.width * 0.6 });
      polyline(ctx!, r, [[12.4 * u, 10 * u], [13 * u, 10.8 * u], [13.6 * u, 10 * u]], o);
      break;
    }
    case 'skyline': {
      mk(30, 10);
      let x = 0;
      const pts: number[][] = [[0, 10 * u]];
      while (x < 30) { const bw = 2 + r() * 3, bh = 3 + r() * 6.5; pts.push([x * u, (10 - bh) * u], [(x + bw) * u, (10 - bh) * u]); x += bw; }
      pts.push([30 * u, 10 * u]);
      polyline(ctx!, r, pts.map(([a, b], i) => i && i < pts.length - 1 && i % 2 === 1 ? [a, b] : [a, b]), { ...o, alpha: 0.35 });
      break;
    }
    case 'equation': {
      const size = 1.1;
      const w = Math.max(4, label.length * 0.62 * size + 1);
      mk(w, 2);
      text(ctx!, r, label, 0.3 * u, 1 * u, size * u, { alpha: 0.6 });
      break;
    }
    case 'fence': {
      mk(10, 2.5);
      for (let i = 0; i <= 5; i++) line(ctx!, r, (0.5 + i * 1.8) * u, 2.4 * u, (0.5 + i * 1.8) * u, 0.4 * u, o);
      line(ctx!, r, 0.2 * u, 1 * u, 9.8 * u, 1 * u, o);
      line(ctx!, r, 0.2 * u, 1.8 * u, 9.8 * u, 1.8 * u, o);
      break;
    }
    case 'arrow': {
      mk(4, 4);
      polyline(ctx!, r, [[0.4 * u, 0.6 * u], [1.6 * u, 2.2 * u], [3.2 * u, 3.4 * u]], { ...o, color: PALETTE.yellow });
      polyline(ctx!, r, [[2.2 * u, 3.5 * u], [3.3 * u, 3.4 * u], [3.1 * u, 2.4 * u]], { ...o, color: PALETTE.yellow });
      break;
    }
    default: { // spectator
      mk(1.6, 3.4);
      circle(ctx!, r, 0.8 * u, 0.6 * u, 0.4 * u, 0.42 * u, o);
      line(ctx!, r, 0.8 * u, 1 * u, 0.8 * u, 2.3 * u, o);
      line(ctx!, r, 0.8 * u, 2.3 * u, 0.4 * u, 3.3 * u, o);
      line(ctx!, r, 0.8 * u, 2.3 * u, 1.2 * u, 3.3 * u, o);
      line(ctx!, r, 0.8 * u, 1.4 * u, 0.25 * u, (1.2 + r() * 0.8) * u, o);
      line(ctx!, r, 0.8 * u, 1.4 * u, 1.35 * u, (1.2 + r() * 0.8) * u, o);
    }
  }
  applyGrain(ctx!, c!.width, c!.height, 0.35);
  return { canvas: c!, ax: 0.5, ay: 1 };
}

// Dusty the foreman: round head, hard hat, clipboard. pose: idle | cheer | oops | point
export function foremanArt(pose: string, seed: number, ppu: number): Drawing {
  const u = ppu, W = 3.2 * u, H = 5.2 * u;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d') as Ctx;
  const r = rng(seed);
  const o = { width: Math.max(1.2, u * 0.11), passes: 2, alpha: 0.95 };
  const cx = W / 2, head = 1.55 * u;
  circle(ctx, r, cx, head, 0.62 * u, 0.6 * u, o);
  // hard hat (yellow chalk)
  const hat = { ...o, color: PALETTE.yellow };
  circle(ctx, r, cx, head - 0.18 * u, 0.66 * u, 0.55 * u, hat, Math.PI, Math.PI * 2);
  line(ctx, r, cx - 0.95 * u, head - 0.16 * u, cx + 0.95 * u, head - 0.16 * u, hat);
  line(ctx, r, cx, head - 0.72 * u, cx, head - 0.45 * u, { ...hat, width: o.width * 0.7 });
  // face
  const eyeY = head + 0.08 * u;
  if (pose === 'oops') {
    for (const s of [-1, 1]) { line(ctx, r, cx + s * 0.25 * u - 0.08 * u, eyeY - 0.08 * u, cx + s * 0.25 * u + 0.08 * u, eyeY + 0.08 * u, o); line(ctx, r, cx + s * 0.25 * u + 0.08 * u, eyeY - 0.08 * u, cx + s * 0.25 * u - 0.08 * u, eyeY + 0.08 * u, o); }
    circle(ctx, r, cx, head + 0.38 * u, 0.12 * u, 0.1 * u, o);
  } else {
    for (const s of [-1, 1]) circle(ctx, r, cx + s * 0.24 * u, eyeY, 0.05 * u, 0.07 * u, { ...o, width: o.width * 1.3 });
    circle(ctx, r, cx, head + 0.28 * u, 0.26 * u, pose === 'cheer' ? 0.2 * u : 0.12 * u, o, 0.2, Math.PI - 0.2);
  }
  // body
  const neck = head + 0.6 * u, hip = 3.6 * u;
  line(ctx, r, cx, neck, cx, hip, o);
  line(ctx, r, cx, hip, cx - 0.45 * u, H - 0.1 * u, o);
  line(ctx, r, cx, hip, cx + 0.45 * u, H - 0.1 * u, o);
  // vest stripe
  line(ctx, r, cx - 0.2 * u, neck + 0.5 * u, cx + 0.2 * u, neck + 0.5 * u, { ...o, color: PALETTE.orange });
  const sh = neck + 0.35 * u;
  if (pose === 'cheer') {
    line(ctx, r, cx, sh, cx - 0.9 * u, sh - 1.1 * u, o);
    line(ctx, r, cx, sh, cx + 0.9 * u, sh - 1.1 * u, o);
  } else if (pose === 'oops') {
    line(ctx, r, cx, sh, cx - 0.55 * u, head + 0.3 * u, o);   // hand on head
    line(ctx, r, cx, sh, cx + 0.7 * u, sh + 0.9 * u, o);
  } else if (pose === 'point') {
    line(ctx, r, cx, sh, cx + 1.3 * u, sh - 0.3 * u, o);
    line(ctx, r, cx, sh, cx - 0.6 * u, sh + 0.9 * u, o);
  } else {
    // holding a clipboard
    line(ctx, r, cx, sh, cx - 0.65 * u, sh + 0.75 * u, o);
    line(ctx, r, cx, sh, cx + 0.55 * u, sh + 0.8 * u, o);
    polyline(ctx, r, [[cx + 0.35 * u, sh + 0.45 * u], [cx + 1.05 * u, sh + 0.45 * u], [cx + 1.05 * u, sh + 1.35 * u], [cx + 0.35 * u, sh + 1.35 * u]], { ...o, width: o.width * 0.8 }, true);
  }
  applyGrain(ctx, W, H, 0.3);
  return { canvas: c, ax: 0.5, ay: 1 };
}

// ---------------------------------------------------------------------------- UI art

// The detonator: a crate with a T-handle plunger. pressed = handle down.
export function plungerArt(pressed: boolean, seed: number, px: number): HTMLCanvasElement {
  const c = makeCanvas(px, px);
  const ctx = c.getContext('2d') as Ctx;
  const r = rng(seed);
  const u = px / 10;
  const o = { width: Math.max(1.5, u * 0.35), passes: 3, color: PALETTE.white };
  const red = { ...o, color: PALETTE.red };
  // crate
  const bx0 = 1.6 * u, bx1 = 8.4 * u, by0 = 5.2 * u, by1 = 9.2 * u;
  polyline(ctx, r, [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]], red, true);
  hatch(ctx, r, (g) => g.rect(bx0, by0, bx1 - bx0, by1 - by0), [bx0, by0, bx1, by1], { spacing: u * 0.55, angle: 0.9, width: o.width * 0.45, color: PALETTE.red, alpha: 0.4 });
  text(ctx, r, 'BOOM', (bx0 + bx1) / 2, (by0 + by1) / 2 + u * 0.1, u * 1.35, { color: PALETTE.white, align: 'center', font: "'Cabin Sketch', cursive" });
  // rod and handle
  const top = pressed ? 3.9 * u : 1.6 * u;
  line(ctx, r, 5 * u, by0, 5 * u, top + 0.35 * u, o);
  line(ctx, r, 2.6 * u, top, 7.4 * u, top, { ...o, width: o.width * 1.5 });
  // wires
  polyline(ctx, r, [[bx1, 8.4 * u], [9.3 * u, 8.6 * u], [9.6 * u, 9.6 * u]], { ...o, width: o.width * 0.5, color: PALETTE.yellow });
  applyGrain(ctx, px, px, 0.3);
  return c;
}

export function logoArt(px: number, seed: number): HTMLCanvasElement {
  const W = px, H = px * 0.32;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d') as Ctx;
  const r = rng(seed);
  const size = H * 0.72;
  ctx.font = `700 ${size}px 'Cabin Sketch', cursive`;
  const word = 'Chalkfall';
  const total = ctx.measureText(word).width;
  let x = (W - total) / 2;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const cw = ctx.measureText(ch).width;
    // the last letters tumble a little
    const fall = Math.max(0, i - 5);
    ctx.save();
    ctx.translate(x + cw / 2, H * 0.55 + fall * fall * size * 0.03);
    ctx.rotate((fall ? 0.12 * fall : 0) + (r() - 0.5) * 0.06);
    text(ctx, r, ch, 0, 0, size, { font: "700 'Cabin Sketch', cursive".replace('700 ', ''), align: 'center', color: i < 5 ? PALETTE.white : PALETTE.yellow, alpha: 1 });
    ctx.restore();
    x += cw;
  }
  line(ctx, r, W * 0.12, H * 0.93, W * 0.62, H * 0.9, { width: H * 0.03, color: PALETTE.red, passes: 2 });
  applyGrain(ctx, W, H, 0.35);
  return c;
}
