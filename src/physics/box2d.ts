// Thin TypeScript layer over the Box2D v3 WebAssembly bridge (physics/api.c).
// Everything is addressed by small integer handles; bulk data moves through one scratch buffer.
import createBox2D from './wasm/box2d.mjs';

type Mod = any;
let M: Mod | null = null;

export interface InitOptions { wasmBinary?: ArrayBuffer | Uint8Array; wasmUrl?: string }

export async function initPhysics(opts: InitOptions = {}): Promise<void> {
  if (M) return;
  const o: Record<string, unknown> = {};
  if (opts.wasmBinary) o.wasmBinary = opts.wasmBinary;
  if (opts.wasmUrl) o.locateFile = () => opts.wasmUrl;
  M = await createBox2D(o);
}

export const BodyType = { Static: 0, Kinematic: 1, Dynamic: 2 } as const;

export const ShapeFlags = { Sensor: 1, SensorEvents: 2, ContactEvents: 4, HitEvents: 8, NoMassUpdate: 16 } as const;

export interface WorldOptions {
  gravity: [number, number];
  contactHertz?: number; dampingRatio?: number; pushSpeed?: number; hitThreshold?: number; maxSpeed?: number;
}

export interface BodyOptions {
  type?: number; x: number; y: number; angle?: number;
  linearDamping?: number; angularDamping?: number; gravityScale?: number;
  bullet?: boolean; fixedRotation?: boolean; awake?: boolean;
}

export interface ShapeOptions {
  density?: number; friction?: number; restitution?: number;
  category?: number; mask?: number; group?: number; flags?: number; radius?: number;
}

export interface BodyState { x: number; y: number; angle: number; vx: number; vy: number; w: number; cx: number; cy: number; mass: number; inertia: number; awake: boolean }
export interface HitEvent { a: number; b: number; x: number; y: number; speed: number }

export class World {
  private f: Float32Array;
  private i: Int32Array;
  private base: number;

  constructor(o: WorldOptions) {
    if (!M) throw new Error('initPhysics() first');
    M._world_create(o.gravity[0], o.gravity[1], o.contactHertz ?? 0, o.dampingRatio ?? 0, o.pushSpeed ?? 0, o.hitThreshold ?? 0, o.maxSpeed ?? 0);
    this.base = M._scratch() >> 2;
    this.f = M.HEAPF32; this.i = M.HEAP32;
  }

  // the heap can grow; refresh views when it does
  private views(): void {
    if (this.f.buffer !== M.HEAPF32.buffer) { this.f = M.HEAPF32; this.i = M.HEAP32; }
  }

  destroy(): void { M._world_destroy(); }
  step(dt: number, subSteps: number): void { M._world_step(dt, subSteps); }
  setGravity(x: number, y: number): void { M._world_set_gravity(x, y); }
  explode(x: number, y: number, radius: number, falloff: number, impulsePerLength: number): void {
    M._world_explode(x, y, radius, falloff, impulsePerLength);
  }

  queryAABB(x0: number, y0: number, x1: number, y1: number, max = 512): number[] {
    const n = M._world_query_aabb(x0, y0, x1, y1, max);
    this.views();
    const out: number[] = new Array(n);
    for (let k = 0; k < n; k++) out[k] = this.i[this.base + k];
    return out;
  }

  raycast(x: number, y: number, dx: number, dy: number): { shape: number; x: number; y: number; nx: number; ny: number; fraction: number } | null {
    const s = M._world_raycast(x, y, dx, dy);
    if (!s) return null;
    this.views();
    const f = this.f, b = this.base;
    return { shape: s, x: f[b], y: f[b + 1], nx: f[b + 2], ny: f[b + 3], fraction: f[b + 4] };
  }

  beginEvents(): [number, number][] {
    const n = M._world_begin_events();
    this.views();
    const out: [number, number][] = [];
    for (let k = 0; k < n; k++) out.push([this.i[this.base + k * 2], this.i[this.base + k * 2 + 1]]);
    return out;
  }

  sensorEvents(): [number, number][] {
    const n = M._world_sensor_events();
    this.views();
    const out: [number, number][] = [];
    for (let k = 0; k < n; k++) out.push([this.i[this.base + k * 2], this.i[this.base + k * 2 + 1]]);
    return out;
  }

  hitEvents(): HitEvent[] {
    const n = M._world_hit_events();
    this.views();
    const out: HitEvent[] = [];
    const f = this.f, i = this.i, b = this.base;
    for (let k = 0; k < n; k++) {
      const o = b + k * 5;
      out.push({ a: i[o], b: i[o + 1], x: f[o + 2], y: f[o + 3], speed: f[o + 4] });
    }
    return out;
  }

  jointEvents(): number[] {
    const n = M._world_joint_events();
    this.views();
    const out: number[] = [];
    for (let k = 0; k < n; k++) out.push(this.i[this.base + k]);
    return out;
  }

  // Calls fn(handle, x, y, angle, vx, vy, w, awake, dynamic) for every live body.
  readBodies(fn: (h: number, x: number, y: number, a: number, vx: number, vy: number, w: number, awake: boolean, dynamic: boolean) => void): void {
    const n = M._world_read_bodies();
    this.views();
    const f = this.f, i = this.i, b = this.base;
    for (let k = 0; k < n; k++) {
      const o = b + k * 8;
      const fl = i[o + 7];
      fn(i[o], f[o + 1], f[o + 2], f[o + 3], f[o + 4], f[o + 5], f[o + 6], (fl & 1) !== 0, (fl & 2) !== 0);
    }
  }

  // ---- bodies
  createBody(o: BodyOptions): number {
    return M._body_create(o.type ?? BodyType.Dynamic, o.x, o.y, o.angle ?? 0, o.linearDamping ?? 0, o.angularDamping ?? 0,
      o.gravityScale ?? 1, o.bullet ? 1 : 0, o.fixedRotation ? 1 : 0, o.awake === false ? 0 : 1);
  }
  destroyBody(h: number): void { M._body_destroy(h); }
  bodyLive(h: number): boolean { return !!M._body_live(h); }
  setBodyType(h: number, t: number): void { M._body_set_type(h, t); }
  setTransform(h: number, x: number, y: number, a: number): void { M._body_set_transform(h, x, y, a); }
  getBody(h: number, out: Partial<BodyState> = {}): BodyState {
    M._body_get(h);
    this.views();
    const f = this.f, b = this.base;
    out.x = f[b]; out.y = f[b + 1]; out.angle = f[b + 2]; out.vx = f[b + 3]; out.vy = f[b + 4]; out.w = f[b + 5];
    out.cx = f[b + 6]; out.cy = f[b + 7]; out.mass = f[b + 8]; out.inertia = f[b + 9]; out.awake = f[b + 10] > 0;
    return out as BodyState;
  }
  setVelocity(h: number, vx: number, vy: number, w: number): void { M._body_set_velocity(h, vx, vy, w); }
  impulse(h: number, ix: number, iy: number, px: number, py: number): void { M._body_impulse(h, ix, iy, px, py); }
  impulseCenter(h: number, ix: number, iy: number): void { M._body_impulse_center(h, ix, iy); }
  angularImpulse(h: number, imp: number): void { M._body_angular_impulse(h, imp); }
  force(h: number, fx: number, fy: number): void { M._body_force(h, fx, fy); }
  setAwake(h: number, awake: boolean): void { M._body_set_awake(h, awake ? 1 : 0); }
  updateMass(h: number): void { M._body_update_mass(h); }
  setDamping(h: number, lin: number, ang: number): void { M._body_set_damping(h, lin, ang); }
  setGravityScale(h: number, s: number): void { M._body_set_gravity_scale(h, s); }

  // ---- shapes (polygon points are local to the body)
  polygon(body: number, pts: number[][], o: ShapeOptions = {}): number {
    this.views();
    const f = this.f, b = this.base;
    for (let k = 0; k < pts.length; k++) { f[b + k * 2] = pts[k][0]; f[b + k * 2 + 1] = pts[k][1]; }
    return M._shape_polygon(body, pts.length, o.radius ?? 0, o.density ?? 1, o.friction ?? 0.6, o.restitution ?? 0,
      o.category ?? 1, o.mask ?? 0xffffffff, o.group ?? 0, o.flags ?? 0);
  }
  box(body: number, hw: number, hh: number, cx = 0, cy = 0, angle = 0, o: ShapeOptions = {}): number {
    const c = Math.cos(angle), s = Math.sin(angle);
    const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [cx + c * x - s * y, cy + s * x + c * y]);
    return this.polygon(body, pts, o);
  }
  circle(body: number, x: number, y: number, r: number, o: ShapeOptions = {}): number {
    return M._shape_circle(body, x, y, r, o.density ?? 1, o.friction ?? 0.6, o.restitution ?? 0,
      o.category ?? 1, o.mask ?? 0xffffffff, o.group ?? 0, o.flags ?? 0);
  }
  destroyShape(h: number, updateMass = true): void { M._shape_destroy(h, updateMass ? 1 : 0); }
  shapeLive(h: number): boolean { return !!M._shape_live(h); }
  shapeBody(h: number): number { return M._shape_body(h); }
  shapeAABB(h: number): [number, number, number, number] {
    M._shape_aabb(h);
    this.views();
    const f = this.f, b = this.base;
    return [f[b], f[b + 1], f[b + 2], f[b + 3]];
  }
  testPoint(h: number, x: number, y: number): boolean { return !!M._shape_test_point(h, x, y); }
  setFilter(h: number, cat: number, mask: number, group = 0): void { M._shape_set_filter(h, cat, mask | 0, group); }

  // ---- joints
  weld(a: number, b: number, ax: number, ay: number, o: { linearHertz?: number; angularHertz?: number; damping?: number; forceThreshold?: number; torqueThreshold?: number } = {}): number {
    return M._joint_weld(a, b, ax, ay, o.linearHertz ?? 0, o.angularHertz ?? 0, o.damping ?? 0, o.forceThreshold ?? 0, o.torqueThreshold ?? 0);
  }
  destroyJoint(h: number): void { M._joint_destroy(h); }
  jointLive(h: number): boolean { return !!M._joint_live(h); }
  jointForce(h: number): [number, number, number] {
    M._joint_force(h);
    this.views();
    const f = this.f, b = this.base;
    return [f[b], f[b + 1], f[b + 2]];
  }
}
