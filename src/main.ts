// Chalkfall — app bootstrap, screens and the frame loop.
import './ui/styles.css';
import { Application } from 'pixi.js';
import wasmUrl from './physics/wasm/box2d.wasm?url';
import { initPhysics } from './physics/box2d.ts';
import { Scene } from './render/scene.ts';
import { Audio } from './audio/audio.ts';
import { Save } from './save.ts';
import { LEVELS, CALIBRATION, type Calibration } from './levels/index.ts';
import { el } from './ui/dom.ts';
import { PlayScreen } from './screens/play.ts';
import { TitleScreen } from './screens/title.ts';
import { LevelsScreen } from './screens/levels.ts';
import { showSettings } from './screens/settings.ts';
import type { Placement } from './game/sim.ts';

export interface Screen { enter(): void; exit(): void; frame(dt: number): void }

export class App {
  pixi!: Application;
  scene!: Scene;
  audio = new Audio();
  save = new Save();
  ui = document.getElementById('ui')!;
  canvas!: HTMLCanvasElement;
  calibration: Record<string, Calibration> = CALIBRATION;
  screen: Screen | null = null;

  async start(): Promise<void> {
    await Promise.all([
      initPhysics({ wasmUrl }),
      document.fonts.load("700 40px 'Cabin Sketch'"),
      document.fonts.load("40px 'Architects Daughter'"),
    ]);
    this.pixi = new Application();
    await this.pixi.init({
      resizeTo: window, background: '#14261c', antialias: true, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl', powerPreference: 'high-performance',
    });
    this.canvas = this.pixi.canvas;
    document.getElementById('app')!.prepend(this.canvas);
    this.scene = new Scene(this.pixi);
    this.scene.resize(innerWidth, innerHeight);
    addEventListener('resize', () => this.scene.resize(innerWidth, innerHeight));
    this.applySettings();
    this.pixi.ticker.add((t) => this.screen?.frame(Math.min(0.1, t.deltaMS / 1000)));
    document.querySelector('.loading')?.remove();
    this.goTitle();
    (window as any).__app = this;
    (window as any).__ready = true;
  }

  applySettings(): void {
    const s = this.save.settings;
    this.audio.setVolumes(s.sfx, s.music);
    this.audio.setMusic(s.music > 0 && !(this.screen instanceof TitleScreen && false));
  }

  go(s: Screen): void {
    this.screen?.exit();
    for (const m of this.ui.querySelectorAll('.modal')) m.remove();
    this.screen = s;
    s.enter();
  }

  goTitle(): void { this.go(new TitleScreen(this)); }
  goLevels(world?: number): void { this.go(new LevelsScreen(this, world)); }
  playLevel(id: string, opts: { replay?: Placement[] } = {}): void {
    const L = LEVELS.find((l) => l.id === id);
    if (L) this.go(new PlayScreen(this, L, opts));
  }
  nextLevel(id: string): string | null {
    const i = LEVELS.findIndex((l) => l.id === id);
    return i >= 0 && i + 1 < LEVELS.length ? LEVELS[i + 1].id : null;
  }
  showSettings(): void { showSettings(this); }

  modal(...kids: (Node | null)[]): HTMLElement {
    const card = el('div', { class: 'card chalk-box' }, ...kids);
    const m = el('div', { class: 'modal' }, card);
    this.ui.append(m);
    return m;
  }
}

const app = new App();
app.start().catch((e) => {
  console.error(e);
  const l = document.querySelector('.loading');
  if (l) l.textContent = 'Could not start: ' + (e?.message ?? e);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
