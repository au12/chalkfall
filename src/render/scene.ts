// The Pixi scene for one level: board, doodles, protected buildings, ground, frames, charges,
// goal lines and effects, with a camera. Pieces are interpolated between physics ticks.
import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { frameArt, polyArt, chargeArt, protectedArt, doodleArt, foremanArt, groundTile, CHARGE_COLOR } from './art.ts';
import { applyGrain, line, makeCanvas, smudge, PALETTE, type Ctx } from './chalk.ts';
import { Fx } from './fx.ts';
import { rng, Sim, type Charge, type Piece } from '../game/sim.ts';
import { CHARGES, type ChargeKind } from '../game/constants.ts';
import type { LevelDef } from '../game/level.ts';

export const BOIL_MS = 140;          // hand-drawn "boil" frame time
const VARIANTS = 3;

interface PieceView { sprite: Sprite; tex: Texture[]; piece: Piece }
interface ChargeView { sprite: Sprite; tex: Texture[]; fuse: Text; charge: Charge; sel?: boolean }

function T(c: HTMLCanvasElement): Texture { return Texture.from(c); }
const hex = (s: string) => parseInt(s.slice(1), 16);
const CHARGE_MIN_PX = 30;   // smallest on-screen size of a charge icon

export class Scene {
  readonly app: Application;
  readonly root = new Container();
  readonly board = new Container();
  readonly world = new Container();
  private back = new Container();
  private protLayer = new Container();
  private groundLayer = new Container();
  private pieceLayer = new Container();
  private overlay = new Container();
  private chargeLayer = new Container();
  private uiLayer = new Container();
  private hintLayer = new Container();
  private hintPool: { sprite: Sprite; fuse: Text }[] = [];
  readonly fx = new Fx();
  private pieces = new Map<number, PieceView>();
  private charges = new Map<number, ChargeView>();
  private chargeTex = new Map<ChargeKind, Texture[]>();
  private chargeTexPpu = 0;
  private boilFrame = 0;
  private boilClock = 0;
  private boiling: { sprite: Sprite; tex: Texture[] }[] = [];
  private foreman: { sprite: Sprite; tex: Record<string, Texture[]>; pose: string } | null = null;
  private previewG = new Graphics();
  private boardTex: Texture | null = null;
  ppu = 32;                          // texture pixels per world unit
  sim: Sim | null = null;
  level: LevelDef | null = null;
  // camera (world units)
  cam = { x: 0, y: 12, h: 40 };
  private shakeT = 0;
  W = 1; H = 1;

  constructor(app: Application) {
    this.app = app;
    this.root.addChild(this.board, this.world);
    this.world.addChild(this.back, this.protLayer, this.groundLayer, this.pieceLayer, this.overlay, this.chargeLayer, this.fx.layer, this.uiLayer);
    this.uiLayer.addChild(this.previewG, this.hintLayer);
    app.stage.addChild(this.root);
  }

  // ------------------------------------------------------------------ board

  resize(W: number, H: number): void {
    const changed = W !== this.W || H !== this.H;
    this.W = W; this.H = H;
    this.drawBoard();
    if (changed && this.level) this.cam = { ...this.fitCamera(this.level) };
  }

  private drawBoard(): void {
    const res = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.ceil(this.W * res / 2), H = Math.ceil(this.H * res / 2);   // half-res is plenty for a blurry board
    const c = makeCanvas(W, H);
    const g = c.getContext('2d') as Ctx;
    const grad = g.createRadialGradient(W * 0.5, H * 0.42, Math.min(W, H) * 0.1, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    grad.addColorStop(0, '#2c4a39'); grad.addColorStop(0.6, '#203a2c'); grad.addColorStop(1, '#14261c');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const r = rng(42);
    // old erased writing: big faint smudges
    for (let i = 0; i < 9; i++) smudge(g, r, r() * W, r() * H, (0.15 + r() * 0.25) * Math.max(W, H), 'rgba(230,240,230,1)', 0.035);
    // eraser strokes
    for (let i = 0; i < 6; i++) {
      const y = r() * H, x = r() * W * 0.6;
      g.save(); g.globalAlpha = 0.03; g.fillStyle = '#e8efe6';
      g.translate(x, y); g.rotate((r() - 0.5) * 0.3);
      g.fillRect(0, 0, W * (0.2 + r() * 0.4), H * (0.03 + r() * 0.05));
      g.restore();
    }
    // fine speckle
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    this.boardTex?.destroy(true);
    this.boardTex = T(c);
    this.board.removeChildren();
    const s = new Sprite(this.boardTex);
    s.width = this.W; s.height = this.H;
    this.board.addChild(s);
  }

  // ------------------------------------------------------------------ level

  load(sim: Sim, level: LevelDef): void {
    this.clear();
    this.sim = sim; this.level = level;
    const cam = this.fitCamera(level);
    this.cam = { ...cam };
    const pxPerUnit = this.H / cam.h;
    this.ppu = Math.max(18, Math.min(64, Math.round(pxPerUnit * 1.6)));
    // charge icons are drawn at the level's resolution: redraw them when it changes
    if (this.chargeTexPpu !== this.ppu) {
      for (const t of this.chargeTex.values()) for (const x of t) x.destroy(true);
      this.chargeTex.clear();
      this.chargeTexPpu = this.ppu;
    }
    this.buildBack(level);
    this.buildGround(level);
    for (const o of sim.protectedObjs) {
      const d = o.def;
      const tex = Array.from({ length: VARIANTS }, (_, v) => T(protectedArt(d.kind, d.w, d.h, 500 + v * 17 + Math.round(d.x), this.ppu).canvas));
      const art = protectedArt(d.kind, d.w, d.h, 500, this.ppu);
      const s = new Sprite(tex[0]);
      s.anchor.set(art.ax, art.ay);
      s.scale.set(1 / this.ppu);
      s.position.set(d.x, -(d.y ?? sim.groundY));
      this.protLayer.addChild(s);
      this.boiling.push({ sprite: s, tex });
    }
    for (const p of sim.pieces) if (p.alive) this.addPiece(p);
    this.drawLines();
  }

  clear(): void {
    for (const v of this.pieces.values()) this.dropPiece(v);
    this.pieces.clear();
    for (const v of this.charges.values()) { v.sprite.destroy(); v.fuse.destroy(); }
    this.charges.clear();
    for (const c of [this.back, this.protLayer, this.groundLayer, this.overlay]) {
      for (const ch of c.removeChildren()) ch.destroy({ children: true, texture: true, textureSource: true });
    }
    this.boiling = [];
    this.foreman = null;
    this.passLabel = this.goldLabel = null;
    this.sim = null;
    for (const h of this.hintPool) { h.sprite.destroy(); h.fuse.destroy(); }
    this.hintPool = [];
    this.fx.clear();
    this.previewG.clear();
  }

  private buildBack(level: LevelDef): void {
    const ppu = Math.max(14, this.ppu * 0.6);
    for (const [i, d] of (level.doodles ?? []).entries()) {
      if (d.kind === 'foreman') continue;
      const tex = Array.from({ length: VARIANTS }, (_, v) => T(doodleArt(d.kind, 900 + i * 31 + v * 7, ppu, d.text).canvas));
      const s = new Sprite(tex[0]);
      s.anchor.set(0.5, 1);
      s.scale.set((d.s ?? 1) / ppu);
      s.position.set(d.x, -d.y);
      this.back.addChild(s);
      this.boiling.push({ sprite: s, tex });
    }
    // Dusty the foreman
    const fd = (level.doodles ?? []).find((d) => d.kind === 'foreman') ?? { kind: 'foreman', x: -24, y: 0 };
    const poses = ['idle', 'cheer', 'oops', 'point'];
    const tex: Record<string, Texture[]> = {};
    for (const p of poses) tex[p] = Array.from({ length: VARIANTS }, (_, v) => T(foremanArt(p, 77 + v * 13, this.ppu).canvas));
    const s = new Sprite(tex.idle[0]);
    s.anchor.set(0.5, 1);
    s.scale.set(1 / this.ppu);
    s.position.set(fd.x, -fd.y);
    this.back.addChild(s);
    this.foreman = { sprite: s, tex, pose: 'idle' };
  }

  setForeman(pose: 'idle' | 'cheer' | 'oops' | 'point'): void {
    if (this.foreman) this.foreman.pose = pose;
  }

  private buildGround(level: LevelDef): void {
    const tileW = 16;
    const art = groundTile(tileW, this.ppu, 11);
    const t = T(art.canvas);
    const [x0, x1] = level.ground ?? [-400, 400];
    const span = Math.min(x1 - x0, 600);
    const ts = new TilingSprite({ texture: t, width: span * this.ppu, height: art.canvas.height });
    ts.scale.set(1 / this.ppu);
    ts.anchor.set(0, art.ay);
    ts.position.set(Math.max(x0, -300), -(level.groundY ?? 0));
    this.groundLayer.addChild(ts);
  }

  private dashTexture(color: string, seed: number): Texture {
    const u = this.ppu, len = 4;
    const c = makeCanvas(len * u, 0.5 * u);
    const g = c.getContext('2d') as Ctx;
    line(g, rng(seed), 0.2 * u, 0.25 * u, 2.4 * u, 0.25 * u, { width: Math.max(1.5, 0.12 * u), color, passes: 2, dust: 0.2 });
    applyGrain(g, c.width, c.height, 0.35);
    return T(c);
  }

  private drawLines(): void {
    const L = this.level!;
    const gy = this.sim!.groundY;
    const mk = (y: number, color: string, label: string, seed: number) => {
      const t = this.dashTexture(color, seed);
      const ts = new TilingSprite({ texture: t, width: 300 * this.ppu, height: t.height });
      ts.scale.set(1 / this.ppu);
      ts.anchor.set(0, 0.5);
      ts.position.set(-150, -(gy + y));
      this.overlay.addChild(ts);
      const tx = new Text({ text: label, style: { fontFamily: 'Architects Daughter, cursive', fontSize: 44, fill: color } });
      tx.anchor.set(1, 1);
      tx.scale.set(0.022);
      tx.alpha = 0.9;
      (tx as any).__goal = y;
      this.overlay.addChild(tx);
      return tx;
    };
    this.passLabel = mk(L.passLine, PALETTE.red, `pass line  ${L.passLine} ft`, 3);
    if (L.bonus.type === 'gold') this.goldLabel = mk(L.goldLine, PALETTE.yellow, `gold  ${L.goldLine} ft`, 5);
    if (L.bonus.type === 'lot') {
      for (const x of [L.bonus.x0, L.bonus.x1]) {
        const t = this.dashTexture(PALETTE.yellow, 9);
        const ts = new TilingSprite({ texture: t, width: 30 * this.ppu, height: t.height });
        ts.scale.set(1 / this.ppu);
        ts.anchor.set(0, 0.5);
        ts.rotation = -Math.PI / 2;
        ts.position.set(x, -gy);
        this.overlay.addChild(ts);
      }
    }
  }
  private passLabel: Text | null = null;
  private goldLabel: Text | null = null;

  // ------------------------------------------------------------------ pieces

  addPiece(p: Piece): void {
    const tex: Texture[] = [];
    let ax = 0.5, ay = 0.5;
    for (let v = 0; v < VARIANTS; v++) {
      const art = p.poly ? polyArt(p.poly, p.mat, p.seed + v * 101, this.ppu, p.shard) : frameArt(p.w, p.h, p.mat, p.jagged, p.seed + v * 101, this.ppu);
      ax = art.ax; ay = art.ay;
      tex.push(T(art.canvas));
      if (p.shard) break;        // shards don't boil (there are many of them)
    }
    const s = new Sprite(tex[0]);
    s.anchor.set(ax, ay);
    s.scale.set(1 / this.ppu);
    s.position.set(p.x, -p.y);
    s.rotation = -p.a;
    this.pieceLayer.addChild(s);
    this.pieces.set(p.id, { sprite: s, tex, piece: p });
  }

  removePiece(p: Piece): void {
    const v = this.pieces.get(p.id);
    if (!v) return;
    this.dropPiece(v);
    this.pieces.delete(p.id);
  }

  private dropPiece(v: PieceView): void {
    v.sprite.destroy();
    for (const t of v.tex) t.destroy(true);
  }

  // ------------------------------------------------------------------ charges

  private chargeTextures(kind: ChargeKind): Texture[] {
    let t = this.chargeTex.get(kind);
    if (!t) {
      t = Array.from({ length: VARIANTS }, (_, v) => T(chargeArt(kind, 300 + v * 11, this.ppu).canvas));
      this.chargeTex.set(kind, t);
    }
    return t;
  }

  syncCharges(list: Charge[], selected: Charge | null, live: boolean): void {
    const keep = new Set(list.map((c) => c.id));
    for (const [id, v] of this.charges) if (!keep.has(id) || v.charge.fired) {
      if (!keep.has(id) || v.charge.fired) { v.sprite.destroy(); v.fuse.destroy(); this.charges.delete(id); }
    }
    for (const c of list) {
      if (c.fired) continue;
      let v = this.charges.get(c.id);
      if (!v) {
        const tex = this.chargeTextures(c.kind);
        const s = new Sprite(tex[0]);
        s.anchor.set(0.5);
        s.scale.set(1 / this.ppu);
        const fuse = new Text({ text: '', style: { fontFamily: 'Architects Daughter, cursive', fontSize: 40, fill: PALETTE.yellow, stroke: { color: '#10301b', width: 6 } } });
        fuse.anchor.set(0.5, 1);
        fuse.scale.set(0.027);
        this.chargeLayer.addChild(s, fuse);
        v = { sprite: s, tex, fuse, charge: c };
        this.charges.set(c.id, v);
      }
      v.charge = c;
      v.sprite.position.set(c.x, -c.y);
      v.sprite.rotation = c.kind === 'kicker' ? -c.dir : 0;
      v.sel = c === selected;
      v.fuse.text = c.fuse ? `${c.fuse}s` : '';
      v.fuse.position.set(c.x, -c.y - 0.9);
      v.sprite.alpha = live ? 1 : 1;
    }
  }

  // Placement preview: blast radius and the cut, for the selected or dragged charge.
  preview(kind: ChargeKind | null, x: number, y: number, ok: boolean, cutAt?: { x: number; y: number; angle: number; len: number; thick: number }, dir = 0): void {
    const g = this.previewG;
    g.clear();
    if (!kind) return;
    const spec = CHARGES[kind];
    const col = ok ? hex(CHARGE_COLOR[kind]) : 0xf0786a;
    const R = spec.radius;
    // dotted ring
    const n = Math.max(16, Math.round(R * 6));
    for (let i = 0; i < n; i += 2) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      g.moveTo(x + Math.cos(a0) * R, -(y + Math.sin(a0) * R)).lineTo(x + Math.cos(a1) * R, -(y + Math.sin(a1) * R));
    }
    g.stroke({ width: 0.12, color: col, alpha: ok ? 0.6 : 0.4 });
    if (cutAt && ok) {
      const c = Math.cos(cutAt.angle), s = Math.sin(cutAt.angle);
      for (const side of [-1, 1]) {
        const cx = cutAt.x + c * side * cutAt.len / 2, cy = cutAt.y + s * side * cutAt.len / 2;
        g.moveTo(cx - s * cutAt.thick * 0.9, -(cy + c * cutAt.thick * 0.9)).lineTo(cx + s * cutAt.thick * 0.9, -(cy - c * cutAt.thick * 0.9));
      }
      g.stroke({ width: 0.14, color: 0xf6e27a, alpha: 0.9 });
    }
    if (kind === 'kicker') {
      const dx = Math.cos(dir), dy = Math.sin(dir);
      g.moveTo(x, -y).lineTo(x + dx * R * 0.8, -(y + dy * R * 0.8));
      g.stroke({ width: 0.16, color: col, alpha: 0.8 });
    }
  }

  // Faint suggested placements (hint).
  hintMarks(list: { x: number; y: number; kind: ChargeKind; dir: number; fuse: number }[]): void {
    while (this.hintPool.length < list.length) {
      const s = new Sprite();
      s.anchor.set(0.5);
      s.scale.set(1 / this.ppu);
      s.alpha = 0.4;
      const fuse = new Text({ text: '', style: { fontFamily: 'Architects Daughter, cursive', fontSize: 36, fill: PALETTE.yellow } });
      fuse.anchor.set(0.5, 1); fuse.scale.set(0.027); fuse.alpha = 0.6;
      this.hintLayer.addChild(s, fuse);
      this.hintPool.push({ sprite: s, fuse });
    }
    this.hintPool.forEach((h, i) => {
      const m = list[i];
      h.sprite.visible = h.fuse.visible = !!m;
      if (!m) return;
      const boost = this.chargeBoost();
      h.sprite.texture = this.chargeTextures(m.kind)[this.boilFrame];
      h.sprite.scale.set(boost / this.ppu);
      h.fuse.scale.set(0.027 * boost);
      h.sprite.position.set(m.x, -m.y);
      h.sprite.rotation = m.kind === 'kicker' ? -m.dir : 0;
      h.fuse.text = m.fuse ? `${m.fuse}s` : '';
      h.fuse.position.set(m.x, -m.y - 0.9 * boost);
    });
  }

  // how much to enlarge charge icons so they stay readable when the camera is far out
  private chargeBoost(): number { return Math.max(1, CHARGE_MIN_PX / (1.8 * this.scale)); }

  // ------------------------------------------------------------------ frame

  // alpha: interpolation between the previous and current physics tick
  update(dtReal: number, alpha: number): void {
    this.boilClock += dtReal * 1000;
    let boilNow = false;
    if (this.boilClock >= BOIL_MS) { this.boilClock %= BOIL_MS; this.boilFrame = (this.boilFrame + 1) % VARIANTS; boilNow = true; }
    for (const v of this.pieces.values()) {
      const p = v.piece;
      if (!p.alive) continue;
      const da = angleDelta(p.pa, p.a);
      v.sprite.position.set(p.px + (p.x - p.px) * alpha, -(p.py + (p.y - p.py) * alpha));
      v.sprite.rotation = -(p.pa + da * alpha);
      if (boilNow && v.tex.length > 1) v.sprite.texture = v.tex[this.boilFrame];
    }
    // charges and their fuse labels never shrink below a readable size on screen, however far out
    // the camera is
    const boost = this.chargeBoost();
    for (const v of this.charges.values()) {
      v.sprite.scale.set((v.sel ? 1.18 : 1) * boost / this.ppu);
      v.fuse.scale.set(0.027 * boost);
      v.fuse.position.set(v.charge.x, -v.charge.y - 0.9 * boost);
    }
    if (boilNow) {
      for (const b of this.boiling) b.sprite.texture = b.tex[this.boilFrame];
      for (const v of this.charges.values()) v.sprite.texture = v.tex[this.boilFrame];
      if (this.foreman) this.foreman.sprite.texture = this.foreman.tex[this.foreman.pose][this.boilFrame];
    }
    this.fx.update(dtReal);
    this.applyCamera();
  }

  // ------------------------------------------------------------------ camera

  // The view for a level on this screen: everything that matters (structure, neighbours, lot posts)
  // fits between the title bar at the top and the tray and plunger at the bottom, which sit over
  // the dirt below the ground line.
  fitCamera(level: LevelDef): { x: number; y: number; h: number } {
    const c = level.camera ?? { x: 0, y: 14, h: 40 };
    if (c.w === undefined || c.top === undefined) return { x: c.x, y: c.y, h: c.h };
    const aspect = this.W / Math.max(1, this.H);
    const gy = level.groundY ?? 0;
    const below = 0.23, above = 0.17;
    const h = Math.max(c.top / (1 - below - above), c.w / aspect, 22);
    return { x: c.x, y: gy - below * h + h / 2, h };
  }

  get scale(): number { return this.H / this.cam.h; }

  private applyCamera(): void {
    const k = this.scale;
    this.shakeT += 1 / 60;
    const tr = this.fx.trauma * this.fx.trauma;
    const sx = tr * 0.6 * Math.sin(this.shakeT * 47.3) * this.cam.h * 0.02;
    const sy = tr * 0.6 * Math.cos(this.shakeT * 39.1) * this.cam.h * 0.02;
    this.world.scale.set(k);
    this.world.position.set(this.W / 2 - (this.cam.x + sx) * k, this.H / 2 + (this.cam.y + sy) * k);
    this.world.rotation = tr * 0.012 * Math.sin(this.shakeT * 23.7);
    // keep goal labels at the right edge of the view, at a steady size on screen: the pass label
    // sits above its line and the gold label below its own, so they never overlap
    const right = this.cam.x + (this.W / 2 - 14) / k;
    const gy = this.sim?.groundY ?? 0;
    const ts = Math.max(13, Math.min(18, this.H * 0.035)) / (44 * k);
    if (this.passLabel) { this.passLabel.scale.set(ts); this.passLabel.position.set(right, -(gy + (this.passLabel as any).__goal) - 3 / k); }
    if (this.goldLabel) { this.goldLabel.scale.set(ts); this.goldLabel.anchor.set(1, 0); this.goldLabel.position.set(right, -(gy + (this.goldLabel as any).__goal) + 3 / k); }
  }

  toWorld(sx: number, sy: number): [number, number] {
    const k = this.scale;
    return [this.cam.x + (sx - this.W / 2) / k, this.cam.y - (sy - this.H / 2) / k];
  }

  toScreen(x: number, y: number): [number, number] {
    const k = this.scale;
    return [this.W / 2 + (x - this.cam.x) * k, this.H / 2 - (y - this.cam.y) * k];
  }
}

export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
