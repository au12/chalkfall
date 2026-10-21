// Procedural chalk drawing on Canvas 2D: wobbly strokes, grain, hatching. All art in Chalkfall
// is generated here at runtime from seeds, so lines "boil" slightly between redraws like
// hand-drawn animation.
import { rng } from '../game/sim.ts';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Rand = () => number;

export const PALETTE = {
  white: '#f3f1e7',
  dim: 'rgba(243,241,231,0.55)',
  yellow: '#f6e27a',
  red: '#f0786a',
  blue: '#8fc9ef',
  green: '#9ee0a0',
  purple: '#c8a6f2',
  orange: '#f6b26b',
  pink: '#f4a7c3',
  wood: '#e8d2a6',
  concrete: '#d6d6cf',
  steel: '#a9c8e6',
  glass: '#bfeff2',
  stone: '#ffffff',
};

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---------------------------------------------------------------------------- grain

let grainCanvas: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d') as Ctx;
  const img = g.createImageData(S, S);
  const r = rng(1234567);
  for (let i = 0; i < S * S; i++) {
    // sparse speckles of transparency: the board shows through chalk
    const v = r();
    const a = v < 0.18 ? 255 : v < 0.3 ? 120 : 0;
    img.data[i * 4 + 3] = a;
  }
  g.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}

// Erase speckles from everything drawn so far (call once when a drawing is finished).
export function applyGrain(ctx: Ctx, w: number, h: number, strength = 0.55): void {
  const pat = ctx.createPattern(grain() as CanvasImageSource, 'repeat');
  if (!pat) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = strength;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------- strokes

export interface StrokeOpts { width: number; color?: string; alpha?: number; jitter?: number; passes?: number; dust?: number }

// A chalk line: a few slightly offset passes with varying pressure.
export function line(ctx: Ctx, r: Rand, x0: number, y0: number, x1: number, y1: number, o: StrokeOpts): void {
  const passes = o.passes ?? 3;
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const j = o.jitter ?? o.width * 0.35;
  ctx.save();
  ctx.strokeStyle = o.color ?? PALETTE.white;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let p = 0; p < passes; p++) {
    ctx.globalAlpha = (o.alpha ?? 0.9) * (0.45 + r() * 0.4);
    ctx.lineWidth = o.width * (0.55 + r() * 0.5);
    const segs = Math.max(2, Math.ceil(len / (o.width * 6)));
    ctx.beginPath();
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const wob = (r() - 0.5) * j;
      const x = x0 + dx * t + nx * wob, y = y0 + dy * t + ny * wob;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // dust specks along the line
  const dust = o.dust ?? 0.5;
  if (dust > 0) {
    ctx.fillStyle = o.color ?? PALETTE.white;
    const n = Math.floor(len / o.width * dust);
    for (let i = 0; i < n; i++) {
      const t = r(), off = (r() - 0.5) * o.width * 2.2;
      ctx.globalAlpha = 0.15 + r() * 0.25;
      const s = o.width * (0.12 + r() * 0.25);
      ctx.fillRect(x0 + dx * t + nx * off, y0 + dy * t + ny * off, s, s);
    }
  }
  ctx.restore();
}

export function polyline(ctx: Ctx, r: Rand, pts: number[][], o: StrokeOpts, closed = false): void {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    // corners overshoot a little, like a quick hand-drawn box
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const ov = Math.min(o.width * 0.8, l * 0.08) * (0.3 + r());
    line(ctx, r, a[0] - dx / l * ov * r(), a[1] - dy / l * ov * r(), b[0] + dx / l * ov * r(), b[1] + dy / l * ov * r(), o);
  }
}

// Wobbly circle / ellipse
export function circle(ctx: Ctx, r: Rand, cx: number, cy: number, rx: number, ry: number, o: StrokeOpts, from = 0, to = Math.PI * 2): void {
  const steps = Math.max(10, Math.ceil(Math.max(rx, ry) / o.width * 2.5));
  const pts: number[][] = [];
  const wob = (o.jitter ?? o.width * 0.4);
  const start = from + (to - from === Math.PI * 2 ? r() * 0.4 : 0);
  for (let i = 0; i <= steps; i++) {
    const a = start + (to - from) * (i / steps) * (to - from === Math.PI * 2 ? 1.04 : 1);
    pts.push([cx + Math.cos(a) * (rx + (r() - 0.5) * wob), cy + Math.sin(a) * (ry + (r() - 0.5) * wob)]);
  }
  ctx.save();
  ctx.strokeStyle = o.color ?? PALETTE.white;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let p = 0; p < (o.passes ?? 2); p++) {
    ctx.globalAlpha = (o.alpha ?? 0.9) * (0.5 + r() * 0.4);
    ctx.lineWidth = o.width * (0.6 + r() * 0.45);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + (r() - 0.5) * wob * 0.3, y + (r() - 0.5) * wob * 0.3) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  ctx.restore();
}

// Filled chalk area: scribbled hatching clipped to a path.
export function hatch(ctx: Ctx, r: Rand, clip: (c: Ctx) => void, bounds: [number, number, number, number], o: { spacing: number; angle: number; width: number; color?: string; alpha?: number; cross?: boolean }): void {
  ctx.save();
  ctx.beginPath();
  clip(ctx);
  ctx.clip();
  const [x0, y0, x1, y1] = bounds;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + o.spacing;
  const angles = o.cross ? [o.angle, o.angle + Math.PI / 2] : [o.angle];
  for (const ang of angles) {
    const c = Math.cos(ang), s = Math.sin(ang);
    for (let d = -R; d <= R; d += o.spacing * (0.8 + r() * 0.4)) {
      const px = cx - s * d, py = cy + c * d;
      line(ctx, r, px - c * R, py - s * R, px + c * R, py + s * R, { width: o.width, color: o.color, alpha: o.alpha ?? 0.35, passes: 1, dust: 0, jitter: o.width * 0.8 });
    }
  }
  ctx.restore();
}

// Soft smudge (erased chalk / dust cloud)
export function smudge(ctx: Ctx, r: Rand, cx: number, cy: number, rad: number, color = 'rgba(243,241,231,1)', alpha = 0.08): void {
  ctx.save();
  for (let i = 0; i < 6; i++) {
    const x = cx + (r() - 0.5) * rad * 0.6, y = cy + (r() - 0.5) * rad * 0.4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad * (0.4 + r() * 0.6));
    g.addColorStop(0, color.replace(/[\d.]+\)$/, `${alpha})`));
    g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rad, rad * (0.4 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Chalk text using a web font, then grained.
export function text(ctx: Ctx, r: Rand, str: string, x: number, y: number, size: number, o: { color?: string; font?: string; align?: CanvasTextAlign; alpha?: number } = {}): void {
  ctx.save();
  ctx.font = `${size}px ${o.font ?? "'Architects Daughter', cursive"}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = o.color ?? PALETTE.white;
  for (let p = 0; p < 2; p++) {
    ctx.globalAlpha = (o.alpha ?? 0.9) * (0.55 + r() * 0.35);
    ctx.fillText(str, x + (r() - 0.5) * size * 0.04, y + (r() - 0.5) * size * 0.04);
  }
  ctx.restore();
}
