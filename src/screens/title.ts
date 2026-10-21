// Title: the logo over a little building that keeps falling down.
import { Sim, type Placement } from '../game/sim.ts';
import { Build, type LevelDef } from '../game/level.ts';
import { PHYS_HZ } from '../game/constants.ts';
import { logoArt } from '../render/art.ts';
import { el, canvasImg } from '../ui/dom.ts';
import type { App, Screen } from '../main.ts';

function demoLevel(seed: number): { level: LevelDef; plan: Placement[] } {
  const b = new Build();
  const variant = seed % 3;
  if (variant === 0) { const f = b.frame({ x: 0, bays: 2, bayW: 7, floors: 3, floorH: 5 }); b.roof(f.left - 0.6, f.right + 0.6, f.top, 4); }
  else if (variant === 1) { b.frame({ x: 0, bays: 3, bayW: 6, floors: 2, floorH: 5, beamMat: 'concrete' }); b.blocks(0, 12, 3, 2, 4, 2, 'concrete'); }
  else { const f = b.frame({ x: 0, bays: 1, bayW: 6, floors: 4, floorH: 5 }); b.roof(f.left - 0.6, f.right + 0.6, f.top, 4); }
  const level: LevelDef = {
    id: 'title', world: 1, index: 0, name: '', pieces: b.pieces, passLine: 99, goldLine: 99, par: 9, bonus: { type: 'gold' },
    charges: { charge: 6, kicker: 2 }, camera: { x: -15, y: 17, h: 46 },
    doodles: [{ kind: 'foreman', x: -9.5, y: 0 }, { kind: 'cloud', x: 18, y: 31, s: 0.9 }, { kind: 'bird', x: 9, y: 28, s: 1 }, { kind: 'spectator', x: 14, y: 0 }, { kind: 'spectator', x: 15.6, y: 0, s: 0.9 }],
  };
  const plan: Placement[] = [];
  b.pieces.forEach((p, i) => { if (p.h > p.w && p.y < 5 && (i + seed) % 2 === 0) plan.push({ kind: 'charge', piece: i, local: -1.5, fuse: (plan.length % 2) * 0.5, dir: 0 }); });
  if (variant !== 1) plan.push({ kind: 'kicker', piece: b.pieces.findIndex((p) => p.h > p.w && p.y > 6), local: 0, fuse: 0.5, dir: Math.PI });
  return { level, plan };
}

export class TitleScreen implements Screen {
  private app: App;
  private sim: Sim | null = null;
  private root!: HTMLElement;
  private acc = 0;
  private wait = 0;
  private round = 0;

  constructor(app: App) { this.app = app; }

  enter(): void {
    const app = this.app;
    const logo = canvasImg(logoArt(Math.min(1400, innerWidth * 1.4), 8), 'logo');
    const play = el('button', { class: 'btn primary chalk-box', onclick: () => { app.audio.tap(); app.goLevels(); } }, 'Play');
    const set = el('button', { class: 'btn chalk-box', onclick: () => { app.audio.tap(); app.showSettings(); } }, 'Settings');
    const stars = app.save.total();
    this.root = el('div', { class: 'screen title pass' },
      logo,
      el('div', { class: 'tag' }, 'a demolition puzzle on the chalkboard'),
      el('div', { class: 'menu' }, play, set),
      stars ? el('div', { class: 'tag' }, `★ ${stars}`) : null,
    );
    app.ui.append(this.root);
    this.load();
  }

  private load(): void {
    const { level, plan } = demoLevel(this.round++);
    const scene = this.app.scene;
    this.sim?.destroy();
    scene.clear();
    this.sim = new Sim(level, {
      pieceAdded: (p) => scene.addPiece(p),
      pieceRemoved: (p) => scene.removePiece(p),
      chargeFired: (c) => { if (c.kind === 'kicker') scene.fx.implosion(c.x, c.y, 2); else scene.fx.explosion(c.x, c.y, 3.6, 0xf0786a, 0.8); this.app.audio.charge(c.kind, 0.5); },
      cut: (x, y) => scene.fx.chips(x, y, 6, 8),
      hit: (x, y, sp, mat) => { this.app.audio.impact(mat, sp * 0.6); if (sp > 9) scene.fx.dust(x, y, 2, 2, 0xf3f1e7, 0.7, 0.3); },
    });
    scene.load(this.sim, level);
    // the demo building sits off to the right of the menu, whatever the screen shape
    scene.cam.x = -0.27 * scene.cam.h * (scene.W / Math.max(1, scene.H));
    scene.fx.trauma = 0;
    for (const p of plan) this.sim.placeAt(p);
    scene.syncCharges(this.sim.charges, null, false);
    this.wait = 2.2;
  }

  exit(): void {
    this.root.remove();
    this.app.scene.clear();
    this.sim?.destroy();
    this.sim = null;
  }

  frame(dt: number): void {
    const s = this.sim!, scene = this.app.scene;
    if (s.phase === 'plan') {
      this.wait -= dt;
      if (this.wait <= 0) { s.detonate(); scene.setForeman('point'); }
    } else if (s.phase === 'live') {
      this.acc += dt;
      while (this.acc >= 1 / PHYS_HZ) { s.step(); this.acc -= 1 / PHYS_HZ; }
    } else {
      if (this.wait <= 0) { this.wait = 2.5; scene.setForeman('cheer'); }
      this.wait -= dt;
      if (this.wait <= 0) this.load();
    }
    scene.syncCharges(s.charges, null, s.phase !== 'plan');
    scene.update(dt, s.phase === 'live' ? Math.min(1, this.acc * PHYS_HZ) : 1);
  }
}
