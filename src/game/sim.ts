// Chalkfall simulation: builds a level in Box2D, places charges, runs the demolition and scores it.
// Runs headless (tools, solver) and in the browser; all randomness is seeded, steps are fixed.
import { World, BodyType, ShapeFlags } from '../physics/box2d.ts';
import {
  CAT, CHARGES, DT, GRAVITY, IMPLODE_TICKS, IMPLODE_DV, IMPLODE_VERT, KICK_SPEED, MATERIALS, MIN_PIECE, CHARGE_SPACING, CHARGE_GRID, BREAK_MIN_LEN,
  SETTLE_MAX_S, SETTLE_QUIET_S, SETTLE_SPEED, SUB_STEPS, STUB_LEN, DAMAGE_SPEED, DAMAGE_LEN,
  type ChargeKind, type MaterialId,
} from './constants.ts';
import type { LevelDef, PieceDef, ProtectedDef } from './level.ts';

export interface Piece {
  id: number;
  body: number;
  shape: number;
  w: number; h: number;          // box size (local); for polygons the bounding size
  poly?: number[][];
  mat: MaterialId;
  shard: boolean;
  isStatic: boolean;
  jagged: number;                // bits: 1 -x end, 2 +x end, 4 -y end, 8 +y end
  seed: number;
  levelIndex: number;            // index in the level's pieces (-1 for pieces made during play)
  alive: boolean;
  // pose: current and previous tick (for render interpolation)
  x: number; y: number; a: number;
  px: number; py: number; pa: number;
  vx: number; vy: number; av: number; awake: boolean;
}

export interface Charge {
  id: number;
  kind: ChargeKind;
  piece: Piece;
  local: number;                 // offset along the frame's long axis from its centre
  fuse: number;                  // seconds after the plunger
  dir: number;                   // kicker direction (radians)
  fired: boolean;
  x: number; y: number;          // world position (updated while attached)
}

export interface Placement { kind: ChargeKind; piece: number; local: number; fuse: number; dir: number }

export interface ProtectedObj { def: ProtectedDef; body: number; sensor: number; hit: boolean; touching: Set<Piece> }

export interface SimResult {
  cleared: boolean;
  damaged: boolean;
  height: number;
  passLine: number;
  goldLine: number;
  used: number;
  par: number;
  stars: [boolean, boolean, boolean];   // cleared, par, bonus
  bonusMet: boolean;
  score: number;
  breakdown: { label: string; value: number }[];
}

export interface SimHooks {
  pieceAdded?(p: Piece): void;
  pieceRemoved?(p: Piece, why: 'cut' | 'shatter' | 'crumble' | 'lost'): void;
  chargeFired?(c: Charge): void;
  cut?(x: number, y: number, angle: number, mat: MaterialId, len: number): void;
  snapped?(x: number, y: number, mat: MaterialId): void;
  crumble?(x: number, y: number, mat: MaterialId, size: number): void;
  shatter?(p: Piece): void;
  hit?(x: number, y: number, speed: number, mat: MaterialId): void;
  weldBroke?(x: number, y: number): void;
  damaged?(p: ProtectedObj, x: number, y: number): void;
  settled?(r: SimResult): void;
}

interface WeldInfo { a: Piece; b: Piece; x: number; y: number }

// small deterministic RNG
export function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export class Sim {
  readonly level: LevelDef;
  readonly world: World;
  hooks: SimHooks;
  pieces: Piece[] = [];
  private byBody: (Piece | undefined)[] = [];
  private byShape: (Piece | undefined)[] = [];
  protectedObjs: ProtectedObj[] = [];
  private protBySensor = new Map<number, ProtectedObj>();
  charges: Charge[] = [];
  private welds = new Map<number, WeldInfo>();
  phase: 'plan' | 'live' | 'settled' = 'plan';
  tick = 0;                      // ticks since detonation
  time = 0;                      // seconds since detonation
  private nextId = 1;
  private quiet = 0;
  private lastFire = 0;
  private centerX = 0;
  private chargeY = 0;
  private imploders: { c: Charge; left: number }[] = [];
  damaged = false;
  result: SimResult | null = null;
  private rand: () => number;
  groundBody = 0;
  readonly groundY: number;

  constructor(level: LevelDef, hooks: SimHooks = {}) {
    this.level = level;
    this.hooks = hooks;
    this.rand = rng(hashStr(level.id));
    this.world = new World({ gravity: [0, GRAVITY], hitThreshold: 4, contactHertz: 30, dampingRatio: 10, pushSpeed: 3, maxSpeed: 400 });
    this.groundY = level.groundY ?? 0;
    this.buildGround();
    level.pieces.forEach((d, i) => this.addPiece(d, i));
    for (const p of level.protected ?? []) this.addProtected(p);
    for (const [a, b, x, y] of level.welds ?? []) this.addWeld(this.pieces[a], this.pieces[b], x, y);
    this.preSettle();
  }

  destroy(): void { this.world.destroy(); }

  // ------------------------------------------------------------------ building

  private buildGround(): void {
    const [x0, x1] = this.level.ground ?? [-400, 400];
    const g = this.world.createBody({ type: BodyType.Static, x: (x0 + x1) / 2, y: this.groundY - 5 });
    this.world.box(g, (x1 - x0) / 2, 5, 0, 0, 0, { friction: 0.9, category: CAT.GROUND, mask: 0xffff });
    this.groundBody = g;
  }

  private shapeOpts(mat: MaterialId, shard: boolean) {
    const m = MATERIALS[mat];
    return {
      density: m.density, friction: m.friction, restitution: m.restitution,
      category: shard ? CAT.SHARD : CAT.FRAME,
      mask: shard ? (CAT.GROUND | CAT.FRAME | CAT.PROTECTED) : 0xffff,
      flags: ShapeFlags.SensorEvents | (shard ? 0 : ShapeFlags.HitEvents),
      radius: shard ? 0 : 0.04,
    };
  }

  addPiece(d: PieceDef, levelIndex = -1, extra: Partial<Piece> = {}, vel?: { vx: number; vy: number; w: number }): Piece {
    const isStatic = !!d.static;
    const body = this.world.createBody({ type: isStatic ? BodyType.Static : BodyType.Dynamic, x: d.x, y: d.y, angle: d.angle ?? 0 });
    const shard = !!extra.shard;
    const r = shard ? 0 : 0.04;
    let shape: number;
    if (d.poly) shape = this.world.polygon(body, d.poly, this.shapeOpts(d.mat, shard));
    else shape = this.world.box(body, Math.max(0.05, d.w / 2 - r), Math.max(0.05, d.h / 2 - r), 0, 0, 0, this.shapeOpts(d.mat, shard));
    if (vel) this.world.setVelocity(body, vel.vx, vel.vy, vel.w);
    const p: Piece = {
      id: this.nextId++, body, shape, w: d.w, h: d.h, poly: d.poly, mat: d.mat, shard, isStatic,
      jagged: 0, seed: (this.rand() * 1e9) | 0, levelIndex, alive: true,
      x: d.x, y: d.y, a: d.angle ?? 0, px: d.x, py: d.y, pa: d.angle ?? 0, vx: 0, vy: 0, av: 0, awake: true,
      ...extra,
    };
    this.pieces.push(p);
    this.byBody[body] = p;
    this.byShape[shape] = p;
    this.hooks.pieceAdded?.(p);
    return p;
  }

  private removePiece(p: Piece, why: 'cut' | 'shatter' | 'crumble' | 'lost'): void {
    if (!p.alive) return;
    p.alive = false;
    for (const [h, w] of this.welds) if (w.a === p || w.b === p) this.welds.delete(h);
    this.world.destroyBody(p.body);
    this.byBody[p.body] = undefined;
    this.byShape[p.shape] = undefined;
    this.hooks.pieceRemoved?.(p, why);
  }

  private addProtected(d: ProtectedDef): void {
    const y = (d.y ?? this.groundY) + d.h / 2;
    const body = this.world.createBody({ type: BodyType.Static, x: d.x, y });
    this.world.box(body, d.w / 2, d.h / 2, 0, 0, 0, { friction: 0.8, category: CAT.PROTECTED, mask: 0xffff });
    const sensor = this.world.box(body, d.w / 2 + 0.15, d.h / 2 + 0.15, 0, 0, 0, { category: CAT.SENSOR, mask: CAT.FRAME, flags: ShapeFlags.Sensor | ShapeFlags.SensorEvents });
    const o: ProtectedObj = { def: d, body, sensor, hit: false, touching: new Set() };
    this.protectedObjs.push(o);
    this.protBySensor.set(sensor, o);
  }

  private addWeld(a: Piece, b: Piece, x: number, y: number): void {
    if (!a?.alive || !b?.alive) return;
    const strength = this.level.weldStrength ?? 900;
    const h = this.world.weld(a.body, b.body, x, y, { linearHertz: 0, angularHertz: 0, forceThreshold: strength, torqueThreshold: strength * 1.2 });
    if (h) this.welds.set(h, { a, b, x, y });
  }

  get weldList(): WeldInfo[] { return [...this.welds.values()]; }

  // let the structure come to rest before the player sees it
  private preSettle(): void {
    for (let i = 0; i < 720; i++) {
      this.world.step(DT, SUB_STEPS);
      let awake = 0;
      this.world.readBodies((_h, _x, _y, _a, _vx, _vy, _w, aw, dyn) => { if (dyn && aw) awake++; });
      if (!awake) break;
    }
    this.world.hitEvents(); this.world.sensorEvents(); this.world.jointEvents();
    this.syncPoses(true);
  }

  private syncPoses(snap = false): void {
    this.world.readBodies((h, x, y, a, vx, vy, w, awake) => {
      const p = this.byBody[h];
      if (!p) return;
      if (snap) { p.px = x; p.py = y; p.pa = a; } else { p.px = p.x; p.py = p.y; p.pa = p.a; }
      p.x = x; p.y = y; p.a = a; p.vx = vx; p.vy = vy; p.av = w; p.awake = awake;
    });
  }

  // ------------------------------------------------------------------ geometry helpers

  // world point -> piece local
  toLocal(p: Piece, x: number, y: number): [number, number] {
    const c = Math.cos(p.a), s = Math.sin(p.a), dx = x - p.x, dy = y - p.y;
    return [c * dx + s * dy, -s * dx + c * dy];
  }
  toWorld(p: Piece, lx: number, ly: number): [number, number] {
    const c = Math.cos(p.a), s = Math.sin(p.a);
    return [p.x + c * lx - s * ly, p.y + s * lx + c * ly];
  }
  static longAxisX(p: Piece): boolean { return p.w >= p.h; }
  static length(p: Piece): number { return Math.max(p.w, p.h); }

  // distance from a world point to a piece's box (0 inside)
  distToPiece(p: Piece, x: number, y: number): number {
    const [lx, ly] = this.toLocal(p, x, y);
    const dx = Math.max(0, Math.abs(lx) - p.w / 2), dy = Math.max(0, Math.abs(ly) - p.h / 2);
    return Math.hypot(dx, dy);
  }

  pieceTop(p: Piece): number {
    if (!p.alive) return -Infinity;
    return this.world.shapeAABB(p.shape)[3];
  }

  // ------------------------------------------------------------------ planning

  targetable(p: Piece | null | undefined): p is Piece {
    return !!p && p.alive && !p.isStatic && !p.shard && !p.poly;
  }

  // The frame a charge dropped at (x, y) attaches to (with a little tolerance for fingers).
  pieceAt(x: number, y: number, tol = 0.9): Piece | null {
    let best: Piece | null = null, bd = tol;
    for (const p of this.pieces) {
      if (!this.targetable(p)) continue;
      const d = this.distToPiece(p, x, y);
      if (d < bd || (d === 0 && bd === 0 && best && p.levelIndex > best.levelIndex)) { bd = d; best = p; }
    }
    return best;
  }

  // Snap a world point onto a frame's centre line.
  snap(p: Piece, x: number, y: number): { local: number; x: number; y: number } {
    const [lx, ly] = this.toLocal(p, x, y);
    const along = Sim.longAxisX(p) ? lx : ly;
    const local = Sim.gridLocal(p, along);
    const [wx, wy] = Sim.longAxisX(p) ? this.toWorld(p, local, 0) : this.toWorld(p, 0, local);
    return { local, x: wx, y: wy };
  }

  // Charges sit on a grid along each frame, measured from its middle, and keep clear of the ends.
  // The grid makes layouts repeatable: dropping a charge near a spot always lands on that spot.
  static gridLocal(p: Piece, along: number): number {
    const lim = Math.max(0, Sim.length(p) / 2 - 0.45);
    const maxStep = Math.floor(lim / CHARGE_GRID + 1e-9);
    const step = Math.max(-maxStep, Math.min(maxStep, Math.round(along / CHARGE_GRID)));
    return step * CHARGE_GRID;
  }

  chargePos(c: Charge): [number, number] {
    const p = c.piece;
    return Sim.longAxisX(p) ? this.toWorld(p, c.local, 0) : this.toWorld(p, 0, c.local);
  }

  budget(kind: ChargeKind): number { return this.level.charges[kind] ?? 0; }
  used(kind?: ChargeKind): number { return this.charges.filter((c) => !kind || c.kind === kind).length; }
  remaining(kind: ChargeKind): number { return this.budget(kind) - this.used(kind); }

  spacingOk(p: Piece, local: number, ignore?: Charge): boolean {
    return !this.charges.some((c) => c !== ignore && c.piece === p && Math.abs(c.local - local) < CHARGE_SPACING);
  }

  // Would this charge cut the frame?
  static cuts(kind: ChargeKind, mat: MaterialId): boolean {
    return CHARGES[kind].cutLength > 0 && MATERIALS[mat].cutBy.includes(kind);
  }

  placeCharge(kind: ChargeKind, x: number, y: number, opts: { fuse?: number; dir?: number } = {}): Charge | null {
    if (this.phase !== 'plan' || this.remaining(kind) <= 0) return null;
    const p = this.pieceAt(x, y);
    if (!p) return null;
    const s = this.snap(p, x, y);
    if (!this.spacingOk(p, s.local)) return null;
    const c: Charge = { id: this.nextId++, kind, piece: p, local: s.local, fuse: opts.fuse ?? 0, dir: opts.dir ?? 0, fired: false, x: s.x, y: s.y };
    this.charges.push(c);
    return c;
  }

  // place by level piece index (replays, solver)
  placeAt(pl: Placement): Charge | null {
    const p = this.pieces.find((q) => q.levelIndex === pl.piece && q.alive);
    if (!this.targetable(p) || this.remaining(pl.kind) <= 0) return null;
    const local = Sim.gridLocal(p, pl.local);
    if (!this.spacingOk(p, local)) return null;
    const c: Charge = { id: this.nextId++, kind: pl.kind, piece: p, local, fuse: pl.fuse, dir: pl.dir, fired: false, x: 0, y: 0 };
    [c.x, c.y] = this.chargePos(c);
    this.charges.push(c);
    return c;
  }

  moveCharge(c: Charge, x: number, y: number): boolean {
    const p = this.pieceAt(x, y);
    if (!p) return false;
    const s = this.snap(p, x, y);
    if (!this.spacingOk(p, s.local, c)) return false;
    c.piece = p; c.local = s.local; c.x = s.x; c.y = s.y;
    return true;
  }

  removeCharge(c: Charge): void { this.charges = this.charges.filter((k) => k !== c); }

  placements(): Placement[] {
    return this.charges.map((c) => ({ kind: c.kind, piece: c.piece.levelIndex, local: c.local, fuse: c.fuse, dir: c.dir }));
  }

  // ------------------------------------------------------------------ run

  detonate(): boolean {
    if (this.phase !== 'plan' || !this.charges.length) return false;
    this.phase = 'live';
    this.tick = 0; this.time = 0; this.quiet = 0;
    this.lastFire = Math.max(...this.charges.map((c) => c.fuse));
    let m = 0, mx = 0;
    for (const p of this.pieces) {
      if (!p.alive || p.isStatic || p.shard) continue;
      const a = p.w * p.h * MATERIALS[p.mat].density;
      m += a; mx += a * p.x;
    }
    this.centerX = m > 0 ? mx / m : 0;
    return true;
  }

  step(): void {
    if (this.phase !== 'live') return;
    // charges due this tick (fuse measured in simulated seconds)
    for (const c of this.charges) {
      if (c.fired || c.fuse > this.time + 1e-6) continue;
      this.fire(c);
    }
    for (const im of this.imploders) {
      if (im.left <= 0) continue;
      this.pull(im.c, im.left);
      im.left--;
    }
    this.world.step(DT, SUB_STEPS);
    this.tick++;
    this.time = this.tick * DT;
    this.syncPoses();
    // keep unfired charges on their frames
    for (const c of this.charges) if (!c.fired && c.piece.alive) [c.x, c.y] = this.chargePos(c);
    this.handleEvents();
    this.cleanupLost();
    this.checkSettled();
  }

  private handleEvents(): void {
    let breaks = 0;
    for (const e of this.world.hitEvents()) {
      const pa = this.byShape[e.a], pb = this.byShape[e.b];
      const p = pa ?? pb;
      if (p) this.hooks.hit?.(e.x, e.y, e.speed, p.mat);
      // hard impacts snap long frames and shatter glass
      for (const q of [pa, pb]) {
        if (!q || !q.alive || q.isStatic || q.shard || q.poly || breaks >= 3) continue;
        const m = MATERIALS[q.mat];
        if (e.speed < m.breakSpeed) continue;
        if (m.shatters) { this.shatter(q, e.x, e.y); breaks++; continue; }
        const len = Sim.length(q);
        if (len < BREAK_MIN_LEN) continue;
        const [lx, ly] = this.toLocal(q, e.x, e.y);
        const along = Sim.longAxisX(q) ? lx : ly;
        if (Math.abs(along) > len / 2 - 1) continue;
        this.hooks.snapped?.(e.x, e.y, q.mat);
        this.cutPiece(q, along, 0.12, true);
        breaks++;
      }
    }
    // Neighbours: only real frames count (crumbs and shards bouncing off don't), and only when they
    // arrive with some speed. Rubble that slides gently up against a wall is fine.
    for (const [sensor, visitor] of this.world.sensorEvents()) {
      const o = this.protBySensor.get(sensor);
      const p = this.byShape[visitor];
      if (!o || !p || o.hit || p.shard || this.phase !== 'live' || Sim.length(p) < DAMAGE_LEN) continue;
      o.touching.add(p);
    }
    for (const o of this.protectedObjs) {
      if (o.hit || !o.touching.size) continue;
      const d = o.def, y0 = d.y ?? this.groundY, m = 0.2;
      for (const p of o.touching) {
        if (!p.alive) { o.touching.delete(p); continue; }
        const [x0, py0, x1, py1] = this.world.shapeAABB(p.shape);
        if (x1 < d.x - d.w / 2 - m || x0 > d.x + d.w / 2 + m || py1 < y0 - m || py0 > y0 + d.h + m) { o.touching.delete(p); continue; }
        const speed = Math.hypot(p.vx, p.vy) + Math.abs(p.av) * Sim.length(p) / 2;
        if (speed < DAMAGE_SPEED) continue;
        o.hit = true;
        this.damaged = true;
        this.hooks.damaged?.(o, p.x, p.y);
        break;
      }
    }
    for (const h of this.world.jointEvents()) {
      const w = this.welds.get(h);
      if (!w) continue;
      this.welds.delete(h);
      this.world.destroyJoint(h);
      this.hooks.weldBroke?.(w.x, w.y);
    }
  }

  private cleanupLost(): void {
    for (const p of this.pieces) if (p.alive && !p.isStatic && p.y < this.groundY - 60) this.removePiece(p, 'lost');
    if (this.pieces.length > 600 && this.tick % 60 === 0) this.pieces = this.pieces.filter((p) => p.alive);
  }

  private checkSettled(): void {
    const pending = this.charges.some((c) => !c.fired) || this.imploders.some((i) => i.left > 0);
    if (pending) { this.quiet = 0; return; }
    let maxV = 0, awake = 0;
    for (const p of this.pieces) {
      if (!p.alive || p.isStatic) continue;
      if (p.awake) awake++;
      if (p.shard) continue;
      const v = Math.hypot(p.vx, p.vy);
      if (v > maxV) maxV = v;
    }
    this.quiet = maxV < SETTLE_SPEED ? this.quiet + DT : 0;
    const since = this.time - this.lastFire;
    if (awake === 0 || this.quiet >= SETTLE_QUIET_S || since >= SETTLE_MAX_S) this.finish();
  }

  // ------------------------------------------------------------------ charges

  private fire(c: Charge): void {
    c.fired = true;
    const spec = CHARGES[c.kind];
    if (c.piece.alive) [c.x, c.y] = this.chargePos(c);
    const x = c.x, y = c.y;
    this.hooks.chargeFired?.(c);
    // glass nearby shatters
    if (spec.shatterRadius > 0) {
      for (const p of this.pieces.slice()) {
        if (p.alive && !p.shard && !p.isStatic && MATERIALS[p.mat].shatters && this.distToPiece(p, x, y) <= spec.shatterRadius) this.shatter(p, x, y);
      }
    }
    // cut the frame it sits on
    let parts: Piece[] = [];
    if (c.piece.alive && Sim.cuts(c.kind, c.piece.mat)) parts = this.cutPiece(c.piece, c.local, spec.cutLength);
    this.chargeY = y;
    // then the push
    switch (c.kind) {
      case 'charge': case 'blaster': case 'cutter':
        this.blast(x, y, spec.radius, spec.speed);
        this.blowOut(parts, x, spec.blowout);
        break;
      case 'kicker': this.kick(c); break;
      case 'imploder': this.imploders.push({ c, left: IMPLODE_TICKS }); this.blast(x, y, 2, 2); break;
    }
  }

  private nearby(x: number, y: number, r: number): Piece[] {
    const out: Piece[] = [];
    for (const p of this.pieces) {
      if (!p.alive || p.isStatic) continue;
      if (Math.hypot(p.x - x, p.y - y) - Sim.length(p) / 2 <= r) out.push(p);
    }
    return out;
  }

  // Radial push: every frame in range gets a velocity kick away from the charge, strongest at the
  // charge and fading to nothing at the radius; heavier materials move a little less. The push
  // lands between the centre and the nearest point, so pieces also spin.
  private blast(x: number, y: number, radius: number, speed: number): void {
    for (const p of this.nearby(x, y, radius)) {
      const d = this.distToPiece(p, x, y);
      if (d > radius) continue;
      const b = this.world.getBody(p.body);
      let dx = b.cx - x, dy = b.cy - y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const k = 1 - d / radius;
      const dv = speed * k * (p.shard ? 0.6 : 1) / Math.sqrt(MATERIALS[p.mat].density);
      // nearest point on the piece to the charge
      const [lx, ly] = this.toLocal(p, x, y);
      const nx = Math.max(-p.w / 2, Math.min(p.w / 2, lx)), ny = Math.max(-p.h / 2, Math.min(p.h / 2, ly));
      const [px, py] = this.toWorld(p, nx * 0.5, ny * 0.5);
      this.world.impulse(p.body, dx * dv * b.mass, (dy + 0.15) * dv * b.mass, px, py);
    }
  }

  private kick(c: Charge): void {
    const spec = CHARGES.kicker, dx = Math.cos(c.dir), dy = Math.sin(c.dir);
    for (const p of this.nearby(c.x, c.y, spec.radius)) {
      const b = this.world.getBody(p.body);
      const d = Math.max(0, this.distToPiece(p, c.x, c.y));
      const k = Math.max(0, 1 - d / spec.radius);
      const dv = KICK_SPEED * Math.sqrt(k);
      // push slightly above the centre of mass so tall frames tip over
      const lift = 0.2;
      this.world.impulse(p.body, dx * dv * b.mass, (dy + lift) * dv * b.mass, b.cx, b.cy + Math.min(1.2, p.h / 3));
    }
    this.blast(c.x, c.y, 1.5, 2);
  }

  private pull(c: Charge, left: number): void {
    const spec = CHARGES.imploder;
    // eases off over the pull; the shares sum to IMPLODE_DV over the whole pull
    const t = left / IMPLODE_TICKS;
    const strength = IMPLODE_DV * (t + 0.3) / (IMPLODE_TICKS * 0.8 + 0.3);
    for (const p of this.nearby(c.x, c.y, spec.radius)) {
      const b = this.world.getBody(p.body);
      const dx = c.x - b.cx, dy = c.y - b.cy, d = Math.hypot(dx, dy) || 1;
      const k = Math.max(0, 1 - d / spec.radius);
      const dv = strength * k;
      this.world.impulseCenter(p.body, dx / d * dv * b.mass, dy / d * dv * b.mass * IMPLODE_VERT);
    }
  }

  // Remove [local - len/2, local + len/2] from a frame; the rest becomes new pieces.
  private cutPiece(p: Piece, local: number, len: number, snap = false): Piece[] {
    const alongX = Sim.longAxisX(p);
    const L = Sim.length(p), T = alongX ? p.h : p.w;
    const lo = Math.max(-L / 2, local - len / 2), hi = Math.min(L / 2, local + len / 2);
    const b = this.world.getBody(p.body);
    // welds to carry over to whichever piece keeps the anchor
    const welds = [...this.welds.values()].filter((w) => w.a === p || w.b === p);
    const parts: { c: number; len: number; end: number }[] = [];
    if (lo - -L / 2 > MIN_PIECE) parts.push({ c: (-L / 2 + lo) / 2, len: lo + L / 2, end: alongX ? 2 : 8 });
    else if (lo > -L / 2 + 0.02) this.crumbleAt(p, (-L / 2 + lo) / 2, alongX);
    if (L / 2 - hi > MIN_PIECE) parts.push({ c: (hi + L / 2) / 2, len: L / 2 - hi, end: alongX ? 1 : 4 });
    else if (hi < L / 2 - 0.02) this.crumbleAt(p, (hi + L / 2) / 2, alongX);
    const [cx, cy] = alongX ? this.toWorld(p, local, 0) : this.toWorld(p, 0, local);
    if (!snap) this.hooks.cut?.(cx, cy, p.a + (alongX ? 0 : Math.PI / 2), p.mat, len);
    this.removePiece(p, 'cut');
    const out: Piece[] = [];
    for (const part of parts) {
      const [wx, wy] = alongX ? this.toWorld(p, part.c, 0) : this.toWorld(p, 0, part.c);
      // velocity of the parent at the new centre
      const rx = wx - b.cx, ry = wy - b.cy;
      const vel = { vx: b.vx - b.w * ry, vy: b.vy + b.w * rx, w: b.w };
      const keep = p.jagged & (alongX ? (part.end === 2 ? 1 : 2) : (part.end === 8 ? 4 : 8));
      const np = this.addPiece({ x: wx, y: wy, angle: p.a, w: alongX ? part.len : T, h: alongX ? T : part.len, mat: p.mat }, -1,
        { jagged: keep | part.end | (p.jagged & (alongX ? 12 : 3)) }, vel);
      out.push(np);
      // a blast shears the joints of short stubs; longer remainders keep theirs
      if (!snap && part.len < STUB_LEN) continue;
      for (const w of welds) {
        const other = w.a === p ? w.b : w.a;
        if (!other.alive) continue;
        if (this.distToPiece(np, w.x, w.y) < 0.6) this.addWeld(np, other, w.x, w.y);
      }
    }
    return out;
  }

  // Severed posts get kicked sideways in toward the middle of the structure, the way real
  // demolition knocks columns out so the load above drops into its own footprint.
  private blowOut(parts: Piece[], x: number, speed: number): void {
    for (const q of parts) {
      if (!q.alive) continue;
      const upright = Math.abs(Math.cos(q.a)) > 0.7 ? q.h > q.w : q.w > q.h;
      if (!upright) continue;
      const b = this.world.getBody(q.body);
      let dir = Math.sign(this.centerX - q.x);
      if (Math.abs(q.x - this.centerX) < 0.4) dir = Math.sign(this.centerX - x) || (this.rand() < 0.5 ? -1 : 1);
      const short = Sim.length(q) < STUB_LEN;
      const dv = speed * (short ? 1 : 0.35) / Math.sqrt(MATERIALS[q.mat].density);
      const below = b.cy < this.chargeY ? 1 : 0;
      this.world.impulse(q.body, dir * dv * b.mass, 0, b.cx, b.cy + (below ? 0.2 : -0.2) * Sim.length(q));
    }
  }

  private crumbleAt(p: Piece, at: number, alongX: boolean): void {
    const [x, y] = alongX ? this.toWorld(p, at, 0) : this.toWorld(p, 0, at);
    this.hooks.crumble?.(x, y, p.mat, Math.min(p.w, p.h));
  }

  private shatter(p: Piece, x: number, y: number): void {
    const b = this.world.getBody(p.body);
    const cols = Math.max(2, Math.min(6, Math.round(p.w / 1.2))), rows = Math.max(1, Math.min(4, Math.round(p.h / 1.2)));
    const cw = p.w / cols, rh = p.h / rows;
    this.hooks.shatter?.(p);
    this.removePiece(p, 'shatter');
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const lx = -p.w / 2 + (i + 0.5) * cw, ly = -p.h / 2 + (j + 0.5) * rh;
      // each cell splits into two triangles along a random diagonal
      const flip = this.rand() < 0.5;
      const tris = flip
        ? [[[-cw / 2, -rh / 2], [cw / 2, -rh / 2], [-cw / 2, rh / 2]], [[cw / 2, -rh / 2], [cw / 2, rh / 2], [-cw / 2, rh / 2]]]
        : [[[-cw / 2, -rh / 2], [cw / 2, -rh / 2], [cw / 2, rh / 2]], [[-cw / 2, -rh / 2], [cw / 2, rh / 2], [-cw / 2, rh / 2]]];
      for (const tri of tris) {
        const cxl = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cyl = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        const [wx, wy] = this.toWorld(p, lx + cxl, ly + cyl);
        const poly = tri.map(([u, v]) => [u - cxl, v - cyl]);
        const dx = wx - x, dy = wy - y, d = Math.hypot(dx, dy) || 1;
        const kick = 6 / (1 + d * 0.5);
        const vel = { vx: b.vx + dx / d * kick + (this.rand() - 0.5) * 2, vy: b.vy + dy / d * kick + this.rand() * 2, w: (this.rand() - 0.5) * 8 };
        this.addPiece({ x: wx, y: wy, angle: p.a, w: cw, h: rh, mat: 'glass', poly }, -1, { shard: true }, vel);
      }
    }
  }

  // ------------------------------------------------------------------ results

  rubbleHeight(): number {
    let top = this.groundY;
    for (const p of this.pieces) {
      if (!p.alive || p.shard || p.isStatic) continue;
      top = Math.max(top, this.pieceTop(p));
    }
    return top - this.groundY;
  }

  private bonusMet(height: number): boolean {
    const g = this.level.bonus;
    switch (g.type) {
      case 'gold': return height <= this.level.goldLine;
      case 'noFuse': return this.charges.every((c) => c.fuse === 0);
      case 'single': return this.charges.every((c) => c.kind === g.kind);
      case 'lot':
        return this.pieces.every((p) => {
          if (!p.alive || p.shard || p.isStatic) return true;
          const [x0, , x1] = this.world.shapeAABB(p.shape);
          return x0 >= g.x0 && x1 <= g.x1;
        });
    }
  }

  private finish(): void {
    this.phase = 'settled';
    const height = this.rubbleHeight();
    const L = this.level;
    const used = this.charges.length;
    const cleared = !this.damaged && height <= L.passLine;
    const parOk = cleared && used <= L.par;
    const bonus = cleared && this.bonusMet(height);
    const breakdown: { label: string; value: number }[] = [];
    let score = 0;
    if (cleared) {
      const total = Object.values(L.charges).reduce((s, n) => s + (n ?? 0), 0);
      breakdown.push({ label: 'Demolition', value: 1000 });
      breakdown.push({ label: 'Below the line', value: Math.round(Math.max(0, L.passLine - height) * 60) });
      breakdown.push({ label: 'Charges saved', value: Math.max(0, total - used) * 250 });
      if (bonus) breakdown.push({ label: 'Bonus goal', value: 750 });
      score = breakdown.reduce((s, b) => s + b.value, 0);
    }
    this.result = {
      cleared, damaged: this.damaged, height, passLine: L.passLine, goldLine: L.goldLine, used, par: L.par,
      stars: [cleared, parOk, bonus], bonusMet: bonus, score, breakdown,
    };
    this.hooks.settled?.(this.result);
  }

  // Run to the end (headless). Returns the result.
  runToEnd(maxTicks = 60 * 30): SimResult {
    if (this.phase === 'plan') this.detonate();
    while (this.phase === 'live' && this.tick < maxTicks) this.step();
    if (this.phase === 'live') this.finish();
    return this.result!;
  }
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
