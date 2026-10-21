// Effects: explosion flashes, shock rings, chalk dust, debris chips, sparks, camera shake.
import { Container, Particle, ParticleContainer, Sprite, Texture } from 'pixi.js';
import { applyGrain, circle, line, makeCanvas, PALETTE, type Ctx } from './chalk.ts';
import { rng } from '../game/sim.ts';

interface P { p: Particle; vx: number; vy: number; vr: number; life: number; age: number; grow: number; g: number; a0: number; drag: number }
interface Big { s: Sprite; life: number; age: number; s0: number; s1: number; a0: number }

function tex(c: HTMLCanvasElement): Texture { return Texture.from(c); }

export class Fx {
  readonly layer = new Container();
  private dustLayer: ParticleContainer;
  private chipLayer: ParticleContainer;
  private bigLayer = new Container();
  private parts: P[] = [];
  private chipParts: P[] = [];
  private bigs: Big[] = [];
  private t: Record<string, Texture[]> = {};
  private r = rng(99);
  trauma = 0;

  constructor() {
    this.dustLayer = new ParticleContainer({ dynamicProperties: { position: true, rotation: true, vertex: true, color: true, uvs: false } });
    this.chipLayer = new ParticleContainer({ dynamicProperties: { position: true, rotation: true, vertex: true, color: true, uvs: false } });
    this.layer.addChild(this.dustLayer, this.chipLayer, this.bigLayer);
    this.makeTextures();
  }

  private makeTextures(): void {
    const r = rng(7);
    // dust puff (all particles of one container share a texture source -> one atlas strip)
    {
      const S = 64;
      const c = makeCanvas(S, S);
      const g = c.getContext('2d') as Ctx;
      for (let i = 0; i < 7; i++) {
        const x = S / 2 + (r() - 0.5) * S * 0.3, y = S / 2 + (r() - 0.5) * S * 0.3, rad = S * (0.2 + r() * 0.2);
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(243,241,231,0.45)'); gr.addColorStop(1, 'rgba(243,241,231,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      }
      applyGrain(g, S, S, 0.6);
      this.t.dust = [tex(c)];
    }
    // chips: a strip of small chalk fragments
    {
      const S = 16, n = 6;
      const c = makeCanvas(S * n, S);
      const g = c.getContext('2d') as Ctx;
      for (let i = 0; i < n; i++) {
        g.fillStyle = PALETTE.white;
        g.globalAlpha = 0.9;
        g.beginPath();
        const k = 3 + Math.floor(r() * 3);
        for (let j = 0; j < k; j++) {
          const a = j / k * Math.PI * 2 + r() * 0.5, rr = S * (0.2 + r() * 0.25);
          const x = i * S + S / 2 + Math.cos(a) * rr, y = S / 2 + Math.sin(a) * rr;
          if (j) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.closePath(); g.fill();
      }
      const base = tex(c);
      this.t.chip = Array.from({ length: n }, (_, i) => new Texture({ source: base.source, frame: { x: i * S, y: 0, width: S, height: S } as any }));
    }
    // flash star
    {
      const S = 128;
      const c = makeCanvas(S, S);
      const g = c.getContext('2d') as Ctx;
      const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(255,250,220,0.95)'); gr.addColorStop(0.35, 'rgba(255,230,150,0.5)'); gr.addColorStop(1, 'rgba(255,220,140,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      const rr = rng(3);
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2 + rr() * 0.2, l = S * (0.3 + rr() * 0.2);
        line(g, rr, S / 2 + Math.cos(a) * S * 0.1, S / 2 + Math.sin(a) * S * 0.1, S / 2 + Math.cos(a) * l, S / 2 + Math.sin(a) * l, { width: 3, color: PALETTE.yellow, passes: 1, dust: 0 });
      }
      this.t.flash = [tex(c)];
    }
    // shock ring
    {
      const S = 128;
      const c = makeCanvas(S, S);
      const g = c.getContext('2d') as Ctx;
      circle(g, rng(5), S / 2, S / 2, S * 0.44, S * 0.44, { width: 3, passes: 2, alpha: 0.8 });
      applyGrain(g, S, S, 0.4);
      this.t.ring = [tex(c)];
    }
    // spark streak
    {
      const c = makeCanvas(32, 6);
      const g = c.getContext('2d') as Ctx;
      const gr = g.createLinearGradient(0, 0, 32, 0);
      gr.addColorStop(0, 'rgba(255,240,170,0)'); gr.addColorStop(1, 'rgba(255,250,210,1)');
      g.fillStyle = gr; g.fillRect(0, 1, 32, 4);
      this.t.spark = [tex(c)];
    }
  }

  // world units -> container space is handled by the parent (y flipped by the caller)

  dust(x: number, y: number, size: number, n: number, color = 0xf3f1e7, spread = 1, up = 0.6): void {
    for (let i = 0; i < n; i++) {
      const r = this.r;
      const p = new Particle({ texture: this.t.dust[0], x: x + (r() - 0.5) * size * spread, y: -(y + (r() - 0.2) * size * 0.5), anchorX: 0.5, anchorY: 0.5, tint: color, alpha: 0.6 });
      const s = size * (0.035 + r() * 0.035);
      p.scaleX = p.scaleY = s;
      p.rotation = r() * 6.28;
      this.dustLayer.addParticle(p);
      const ang = r() * Math.PI * 2;
      const sp = size * (0.3 + r() * 1.1) * spread;
      this.parts.push({ p, vx: Math.cos(ang) * sp, vy: -(Math.abs(Math.sin(ang)) * sp * up + size * 0.2), vr: (r() - 0.5) * 1.2, life: 0.9 + r() * 1.1, age: 0, grow: s * (0.6 + r() * 0.8), g: -0.4, a0: 0.1 + r() * 0.1, drag: 2.2 });
    }
  }

  chips(x: number, y: number, n: number, speed: number, color = 0xf3f1e7, scale = 1): void {
    for (let i = 0; i < n; i++) {
      const r = this.r;
      const t = this.t.chip[(r() * this.t.chip.length) | 0];
      const p = new Particle({ texture: t, x, y: -y, anchorX: 0.5, anchorY: 0.5, tint: color, alpha: 1 });
      p.scaleX = p.scaleY = (0.012 + r() * 0.02) * scale;
      this.chipLayer.addParticle(p);
      const ang = -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.6;
      const sp = speed * (0.4 + r() * 0.8);
      this.chipParts.push({ p, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, vr: (r() - 0.5) * 20, life: 0.8 + r() * 1.2, age: 0, grow: 0, g: 25, a0: 1, drag: 0.3 });
    }
  }

  private big(texName: string, x: number, y: number, s0: number, s1: number, life: number, alpha = 1, tint = 0xffffff, rot = 0): Sprite {
    const s = new Sprite(this.t[texName][0]);
    s.anchor.set(0.5);
    s.position.set(x, -y);
    s.tint = tint;
    s.alpha = alpha;
    s.rotation = rot;
    s.scale.set(s0);
    s.blendMode = texName === 'flash' ? 'add' : 'normal';
    this.bigLayer.addChild(s);
    this.bigs.push({ s, life, age: 0, s0, s1, a0: alpha });
    return s;
  }

  explosion(x: number, y: number, radius: number, color: number, power = 1): void {
    const k = radius / 64;  // textures are 128 px; scale so the flash spans ~the radius
    this.big('flash', x, y, k * 0.4, k * 0.9 * Math.sqrt(power), 0.2, 0.7, 0xffffff, this.r() * 6);
    this.big('ring', x, y, k * 0.3, k * 2.1, 0.45, 0.9, color);
    this.dust(x, y, radius * 0.7, Math.round(7 * power), 0xf3f1e7, 1.1);
    this.chips(x, y, Math.round(14 * power), 10 + radius * 2, color);
    for (let i = 0; i < 8 * power; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = this.big('spark', x, y, 0.04, 0.09, 0.22, 1, 0xffffff, -a);
      sp.anchor.set(0, 0.5);
    }
    this.trauma = Math.min(1, this.trauma + 0.35 * power);
  }

  implosion(x: number, y: number, radius: number): void {
    this.big('ring', x, y, radius / 64 * 2.2, radius / 64 * 0.2, 0.55, 0.9, 0xc8a6f2);
    for (let i = 0; i < 20; i++) {
      const a = this.r() * Math.PI * 2, d = radius * (0.6 + this.r() * 0.5);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      const p = new Particle({ texture: this.t.dust[0], x: px, y: -py, anchorX: 0.5, anchorY: 0.5, tint: 0xc8a6f2, alpha: 0.5 });
      p.scaleX = p.scaleY = radius * 0.012;
      this.dustLayer.addParticle(p);
      this.parts.push({ p, vx: (x - px) * 1.8, vy: -(y - py) * 1.8, vr: 2, life: 0.55, age: 0, grow: -radius * 0.006, g: 0, a0: 0.5, drag: 0 });
    }
    this.trauma = Math.min(1, this.trauma + 0.25);
  }

  sparks(x: number, y: number, n = 6): void {
    for (let i = 0; i < n; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = this.big('spark', x, y, 0.03, 0.06, 0.18 + this.r() * 0.1, 1, 0xfff1b0, -a);
      sp.anchor.set(0, 0.5);
    }
  }

  update(dt: number): void {
    const step = (arr: P[], container: ParticleContainer) => {
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const q = arr[i];
        q.age += dt;
        if (q.age >= q.life) { container.removeParticle(q.p); continue; }
        const damp = Math.exp(-q.drag * dt);
        q.vx *= damp; q.vy *= damp;
        q.vy += q.g * dt;
        q.p.x += q.vx * dt; q.p.y += q.vy * dt;
        q.p.rotation += q.vr * dt;
        if (q.grow) { const s = Math.max(0.001, q.p.scaleX + q.grow * dt); q.p.scaleX = q.p.scaleY = s; }
        const t = q.age / q.life;
        q.p.alpha = q.a0 * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
        arr[w++] = q;
      }
      arr.length = w;
    };
    step(this.parts, this.dustLayer);
    step(this.chipParts, this.chipLayer);
    let w = 0;
    for (const b of this.bigs) {
      b.age += dt;
      if (b.age >= b.life) { b.s.destroy(); continue; }
      const t = b.age / b.life;
      const e = 1 - Math.pow(1 - t, 3);
      b.s.scale.set(b.s0 + (b.s1 - b.s0) * e);
      b.s.alpha = b.a0 * (1 - t);
      this.bigs[w++] = b;
    }
    this.bigs.length = w;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
  }

  clear(): void {
    this.dustLayer.removeParticles(); this.chipLayer.removeParticles();
    this.parts.length = 0; this.chipParts.length = 0;
    for (const b of this.bigs) b.s.destroy();
    this.bigs.length = 0;
    this.trauma = 0;
  }

  get busy(): boolean { return this.parts.length + this.chipParts.length + this.bigs.length > 0; }
}
