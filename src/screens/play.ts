// The game screen: plan charges, detonate, watch it fall, score it.
import { arcade } from '../arcade.ts';
import { Sim, type Charge, type Placement, type SimResult } from '../game/sim.ts';
import { CHARGES, CHARGE_ORDER, FUSES, MATERIALS, PHYS_HZ, type ChargeKind } from '../game/constants.ts';
import type { LevelDef } from '../game/level.ts';
import { chargeArt, plungerArt, CHARGE_COLOR } from '../render/art.ts';
import { el, canvasImg } from '../ui/dom.ts';
import type { App, Screen } from '../main.ts';

const TICK = 1 / PHYS_HZ;
const FAILS = new Map<string, number>();   // failed attempts per level this session
const hex = (s: string) => parseInt(s.slice(1), 16);

type Drag = { kind: ChargeKind; charge: Charge | null; id: number; sx: number; sy: number; x: number; y: number; touch: boolean; moved: boolean };

export class PlayScreen implements Screen {
  app: App;
  level: LevelDef;
  sim!: Sim;
  private replay: Placement[] | null;
  private acc = 0;
  private speed = 1;
  private slowT = 0;
  private hud!: HTMLElement;
  private trayEl!: HTMLElement;
  private boomEl!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private goalEls: HTMLElement[] = [];
  private popEl: HTMLElement | null = null;
  private toastEl: HTMLElement | null = null;
  private toastT = 0;
  private selKind: ChargeKind | null = null;
  private selected: Charge | null = null;
  private drag: Drag | null = null;
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private mode: 'none' | 'pan' | 'pinch' = 'none';
  private pinch: { d: number; h: number; mx: number; my: number } | null = null;
  private finishedAt = 0;
  private resultShown = false;
  private paused = false;
  private hintMarks: Placement[] | null = null;
  private dustBudget = 0;
  private replayAt = 0;
  private handlers: [EventTarget, string, EventListener, any?][] = [];

  constructor(app: App, level: LevelDef, opts: { replay?: Placement[] } = {}) {
    this.app = app; this.level = level; this.replay = opts.replay ?? null;
  }

  // ------------------------------------------------------------------ lifecycle

  enter(): void {
    arcade.status('playing');
    const app = this.app, scene = app.scene;
    this.sim = new Sim(this.level, {
      pieceAdded: (p) => scene.addPiece(p),
      pieceRemoved: (p, why) => {
        scene.removePiece(p);
        if (why === 'lost') return;
      },
      chargeFired: (c) => this.onFire(c),
      cut: (x, y, _a, mat) => { scene.fx.chips(x, y, 10, 9, hex(MATERIALS[mat] ? matColor(mat) : '#ffffff')); scene.fx.dust(x, y, 2.2, 5); },
      crumble: (x, y, mat, size) => { scene.fx.dust(x, y, size * 2, 6); scene.fx.chips(x, y, 8, 6, hex(matColor(mat))); },
      shatter: (p) => { scene.fx.chips(p.x, p.y, 18, 10, 0xbfeff2, 0.8); app.audio.shatter(); },
      hit: (x, y, speed, mat) => {
        app.audio.impact(mat, speed);
        if (speed > 9 && this.dustBudget > 0) { this.dustBudget--; scene.fx.dust(x, y, Math.min(2.5, speed * 0.14), 2, 0xf3f1e7, 0.8, 0.3); }
      },
      weldBroke: (x, y) => { scene.fx.sparks(x, y, 7); app.audio.weld(); },
      damaged: (o) => {
        scene.fx.explosion(o.def.x, (o.def.y ?? 0) + o.def.h / 2, 3, 0xf0786a, 0.4);
        app.audio.deny();
        scene.setForeman('oops');
        this.toast('Ouch! The neighbours got hit.');
      },
      settled: () => { this.finishedAt = performance.now() + 900; },
    });
    scene.load(this.sim, this.level);
    scene.setForeman('idle');
    this.buildHud();
    this.bindInput();
    app.audio.setMusic(app.save.settings.music > 0);
    if (this.replay) {
      for (const p of this.replay) this.sim.placeAt(p);
      this.replayAt = performance.now() + 900;
      this.status('Replay');
    } else if (this.level.hint && (this.app.save.settings.hints || !this.app.save.seen('hint-' + this.level.id))) {
      this.app.save.markSeen('hint-' + this.level.id);
      this.toast(this.level.hint, 6500);
    }
    this.refresh();
  }

  exit(): void {
    arcade.status('menu');
    for (const [t, ev, fn, o] of this.handlers) t.removeEventListener(ev, fn, o);
    this.handlers = [];
    this.hud.remove();
    this.app.scene.clear();
    this.sim.destroy();
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    const app = this.app, L = this.level;
    const hud = this.hud = el('div', { class: 'hud' });
    // top-left: pause, restart, undo
    hud.append(el('div', { class: 'tl' },
      el('button', { class: 'btn icon chalk-box', 'aria-label': 'Pause', onclick: () => this.pause() }, '‖'),
      el('button', { class: 'btn icon chalk-box', 'aria-label': 'Restart', onclick: () => { app.audio.tap(); app.playLevel(L.id); } }, '↻'),
      this.replay ? null : el('button', { class: 'btn icon chalk-box', 'aria-label': 'Undo', onclick: () => this.undo() }, '↶'),
    ));
    // top-right: hint
    const sol = app.calibration[L.id]?.solution as Placement[] | undefined;
    if (sol?.length && !this.replay) hud.append(el('div', { class: 'tr' }, el('button', { class: 'btn icon chalk-box', 'aria-label': 'Hint', onclick: () => this.hint(sol) }, '?')));
    // title and goals
    const goals = el('div', { class: 'goals' });
    const got = app.save.stars(L.id);
    this.goalEls = [this.goalText(0), this.goalText(1), this.goalText(2)].map((t, i) => {
      const g = el('div', { class: 'goal' + (got[i] ? ' got' : '') }, el('span', { class: 'star' }, '★'), el('span', { class: 'txt' }, t));
      goals.append(g);
      return g;
    });
    hud.append(el('div', { class: 'top' }, el('div', { class: 'lvl' }, `${L.id}  ${L.name}`), goals));
    // charge tray
    this.trayEl = el('div', { class: 'tray' });
    const k = Math.round(Math.min(innerWidth, innerHeight) * 0.15);
    for (const kind of CHARGE_ORDER) {
      if (!this.sim.budget(kind)) continue;
      const img = canvasImg(chargeArt(kind, 301, k).canvas);
      const item = el('button', { class: 'tray-item chalk-box', 'aria-label': CHARGES[kind].name, 'data-kind': kind }, img, el('span', { class: 'count' }, ''));
      item.style.setProperty('border-color', CHARGE_COLOR[kind]);
      item.addEventListener('pointerdown', (e) => this.trayDown(e as PointerEvent, kind));
      this.trayEl.append(item);
    }
    this.trayEl.append(el('div', { class: 'tray-label' }, ''));
    hud.append(this.trayEl);
    // plunger
    const pk = Math.round(Math.min(innerWidth, innerHeight) * 0.22);
    this.boomEl = el('button', { class: 'boom', 'aria-label': 'Detonate' }, canvasImg(plungerArt(false, 3, pk)));
    this.boomEl.addEventListener('click', () => this.detonate());
    hud.append(this.boomEl);
    this.statusEl = el('div', { class: 'status' });
    hud.append(this.statusEl);
    if (this.replay) { this.trayEl.hidden = true; this.boomEl.hidden = true; }
    app.ui.append(hud);
  }

  private goalText(i: number): string {
    const L = this.level;
    if (i === 0) return `below ${L.passLine} ft`;
    if (i === 1) return `${L.par} charge${L.par > 1 ? 's' : ''} or fewer`;
    const b = L.bonus;
    switch (b.type) {
      case 'gold': return `gold: below ${L.goldLine} ft`;
      case 'lot': return 'keep it in the lot';
      case 'noFuse': return 'no fuse delays';
      case 'single': return `only ${CHARGES[b.kind].name.toLowerCase()}s`;
    }
  }

  private refresh(): void {
    const s = this.sim;
    for (const item of this.trayEl.querySelectorAll<HTMLElement>('.tray-item')) {
      const kind = item.dataset.kind as ChargeKind;
      const left = s.remaining(kind);
      item.querySelector('.count')!.textContent = String(left);
      item.classList.toggle('empty', left <= 0);
      item.classList.toggle('sel', this.selKind === kind);
    }
    const label = this.trayEl.querySelector<HTMLElement>('.tray-label')!;
    label.textContent = this.selKind ? `${CHARGES[this.selKind].name}: ${CHARGES[this.selKind].blurb}` : '';
    this.boomEl.classList.toggle('ready', s.charges.length > 0 && s.phase === 'plan');
    const used = s.charges.length;
    const parTxt = this.goalEls[1].querySelector('.txt')!;
    if (s.phase === 'plan') parTxt.textContent = `${used}/${this.level.par} charge${this.level.par > 1 ? 's' : ''}`;
    this.goalEls[1].classList.toggle('fail', s.phase === 'plan' && used > this.level.par);
    this.app.scene.syncCharges(this.chargeList(), this.selected, s.phase !== 'plan');
  }

  private chargeList(): Charge[] {
    const list = this.sim.charges.slice();
    const d = this.drag;
    if (d && !d.charge) {
      const [gx, gy] = this.dragPoint(d);
      list.push({ id: -1, kind: d.kind, piece: null as any, local: 0, fuse: 0, dir: this.defaultDir(gx), fired: false, x: gx, y: gy });
    }
    return list;
  }

  status(t: string): void { this.statusEl.textContent = t; }

  toast(t: string, ms = 2600): void {
    this.toastEl?.remove();
    this.toastEl = el('div', { class: 'toast' }, t);
    this.hud.append(this.toastEl);
    this.toastT = performance.now() + ms;
  }

  // ------------------------------------------------------------------ actions

  private defaultDir(x: number): number {
    // kickers default to pointing toward the middle of the structure
    const cx = this.level.camera?.x ?? 0;
    return x < cx ? 0 : Math.PI;
  }

  private place(kind: ChargeKind, x: number, y: number): Charge | null {
    const s = this.sim;
    if (s.remaining(kind) <= 0) { this.app.audio.deny(); this.toast(`No ${CHARGES[kind].name.toLowerCase()}s left.`); return null; }
    const p = s.pieceAt(x, y);
    if (!p) { this.app.audio.deny(); this.toast('Charges stick to frames.'); return null; }
    const sn = s.snap(p, x, y);
    if (!s.spacingOk(p, sn.local)) { this.app.audio.deny(); this.toast('Too close to another charge.'); return null; }
    const c = s.placeCharge(kind, x, y, { dir: this.defaultDir(x) });
    if (!c) return null;
    this.app.audio.scribble();
    if (CHARGES[kind].cutLength > 0 && !Sim.cuts(kind, p.mat)) {
      this.toast(p.mat === 'stone' ? 'Reinforced: nothing cuts it, but it still gets a push.' : `${CHARGES[kind].name}s don’t cut ${MATERIALS[p.mat].name.toLowerCase()}. Try a cutter.`);
    }
    if (kind === 'kicker') this.select(c);
    return c;
  }

  private undo(): void {
    if (this.sim.phase !== 'plan' || !this.sim.charges.length) return;
    this.app.audio.tap();
    const c = this.sim.charges[this.sim.charges.length - 1];
    this.sim.removeCharge(c);
    if (this.selected === c) this.select(null);
    this.refresh();
  }

  detonate(): void {
    const s = this.sim;
    if (s.phase !== 'plan' || this.paused) return;
    if (!s.charges.length) { this.app.audio.deny(); this.toast('Place some charges first.'); return; }
    this.select(null);
    this.selKind = null;
    this.hintMarks = null;
    this.boomEl.querySelector('img')!.replaceWith(canvasImg(plungerArt(true, 3, Math.round(Math.min(innerWidth, innerHeight) * 0.22))));
    this.app.audio.plunger();
    s.detonate();
    this.app.scene.setForeman('point');
    this.trayEl.hidden = true;
    this.toastEl?.remove();
    this.status('');
    this.refresh();
  }

  private onFire(c: Charge): void {
    const fx = this.app.scene.fx, spec = CHARGES[c.kind];
    const col = hex(CHARGE_COLOR[c.kind]);
    if (c.kind === 'imploder') fx.implosion(c.x, c.y, spec.radius);
    else fx.explosion(c.x, c.y, Math.max(2.5, spec.radius * 0.8), col, c.kind === 'blaster' ? 1.6 : c.kind === 'cutter' ? 0.5 : 1);
    if (!this.app.save.settings.shake) fx.trauma = 0;
    this.app.audio.charge(c.kind);
    this.dustBudget = 14;
    // a beat of slow motion on the first blast
    if (this.slowT <= 0 && !this.sim.charges.some((k) => k !== c && k.fired)) this.slowT = 0.55;
  }

  private select(c: Charge | null): void {
    this.selected = c;
    this.popEl?.remove();
    this.popEl = null;
    if (c) { this.openPopover(c); this.toastEl?.remove(); this.toastEl = null; }
    this.refresh();
  }

  private openPopover(c: Charge): void {
    const fuses = el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'fuse'));
    for (const f of FUSES) {
      const b = el('button', { class: 'chip' + (c.fuse === f ? ' on' : '') }, f ? `${f}s` : 'now');
      b.onclick = () => { this.app.audio.tap(); c.fuse = f; this.select(c); };
      fuses.append(b);
    }
    const rows: HTMLElement[] = [fuses];
    if (c.kind === 'kicker') {
      const turn = (d: number) => () => { this.app.audio.tap(); c.dir = Math.round((c.dir + d) / (Math.PI / 4)) * (Math.PI / 4); this.refresh(); };
      rows.push(el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'aim'),
        el('button', { class: 'chip', onclick: turn(Math.PI / 4), 'aria-label': 'Aim counter-clockwise' }, '↺'),
        el('button', { class: 'chip', onclick: turn(-Math.PI / 4), 'aria-label': 'Aim clockwise' }, '↻')));
    }
    rows.push(el('div', { class: 'row' },
      el('button', { class: 'chip', onclick: () => { this.app.audio.tap(); this.sim.removeCharge(c); this.select(null); } }, 'remove'),
      el('button', { class: 'chip', onclick: () => this.select(null) }, 'done')));
    this.popEl = el('div', { class: 'pop chalk-box' }, el('div', { class: 'lbl' }, CHARGES[c.kind].name), ...rows);
    this.hud.append(this.popEl);
    this.positionPopover();
  }

  private positionPopover(): void {
    if (!this.popEl || !this.selected) return;
    const [sx, sy] = this.app.scene.toScreen(this.selected.x, this.selected.y);
    const r = this.popEl.getBoundingClientRect();
    const x = Math.max(r.width / 2 + 8, Math.min(innerWidth - r.width / 2 - 8, sx));
    const below = sy - r.height - 40 < 0;
    this.popEl.style.left = x + 'px';
    this.popEl.style.top = (below ? sy + r.height + 40 : sy) + 'px';
  }

  private hint(sol: Placement[]): void {
    this.app.audio.tap();
    this.hintMarks = this.hintMarks ? null : sol;
    if (this.hintMarks) this.toast(`One way to do it with ${sol.length} charge${sol.length > 1 ? 's' : ''} (shown faintly). Tap ? again to hide.`, 4000);
  }

  pause(): void {
    if (this.paused || this.resultShown) return;
    this.paused = true;
    const app = this.app;
    const close = () => { m.remove(); this.paused = false; };
    const m = app.modal(el('h2', {}, 'Paused'), el('div', { class: 'btns' },
      el('button', { class: 'btn primary chalk-box', onclick: () => { app.audio.tap(); close(); } }, 'Resume'),
      el('button', { class: 'btn chalk-box', onclick: () => { app.audio.tap(); app.playLevel(this.level.id); } }, 'Restart'),
      el('button', { class: 'btn chalk-box', onclick: () => { app.audio.tap(); app.showSettings(); } }, 'Settings'),
      el('button', { class: 'btn chalk-box', onclick: () => { app.audio.tap(); app.goLevels(this.level.world); } }, 'Levels'),
    ));
  }

  // ------------------------------------------------------------------ results

  private showResults(r: SimResult): void {
    this.resultShown = true;
    const app = this.app, L = this.level;
    const rec = this.replay ? null : app.save.record(L.id, r.stars, r.score);
    const nStars = r.stars.filter(Boolean).length;
    // A cleared site earns arcade tickets; the stars and the best scores go on its leaderboards.
    arcade.status('over');
    if (!this.replay && r.cleared) {
      void arcade.score(r.score, { board: 'level', meta: { level: L.id, stars: nStars } });
      void arcade.score(app.save.total(), { board: 'stars' });
      void arcade.score(app.save.bestTotal(), { board: 'total' });
    }
    if (r.cleared) { app.audio.win(nStars); this.app.scene.setForeman('cheer'); this.app.scene.fx.dust(this.app.scene.cam.x, L.passLine + 4, 3, 0); }
    else { app.audio.lose(); this.app.scene.setForeman('oops'); }
    r.stars.forEach((s, i) => this.goalEls[i].classList.toggle('ok', s));
    const starsEl = el('div', { class: 'stars-big' });
    r.stars.forEach((on, i) => {
      const sp = el('span', { class: on ? 'on' : '' }, '★');
      if (on) { sp.style.animationDelay = `${0.25 + i * 0.28}s`; setTimeout(() => app.audio.star(i), 250 + i * 280); }
      starsEl.append(sp);
    });
    let why = r.damaged ? 'A neighbour got hit.' : !r.cleared ? `The rubble stopped at ${r.height.toFixed(1)} ft, above the ${L.passLine} ft line.` : '';
    if (!r.cleared && !this.replay) {
      const n = (FAILS.get(L.id) ?? 0) + 1;
      FAILS.set(L.id, n);
      if (n >= 2 && app.calibration[L.id]?.solution?.length) why += ' Stuck? The ? button shows one way to do it.';
    }
    const goals = el('div', { class: 'goal-list' });
    [0, 1, 2].forEach((i) => { goals.append(el('span', { class: r.stars[i] ? 'y' : 'n' }, r.stars[i] ? '★' : '☆'), el('span', {}, this.goalText(i).replace(/^\d+\/\d+ charges?/, `${L.par} charge${L.par > 1 ? 's' : ''} or fewer`))); });
    const bd = el('div', { class: 'breakdown' });
    for (const b of r.breakdown) bd.append(el('span', {}, b.label), el('b', {}, b.value.toLocaleString()));
    const next = app.nextLevel(L.id);
    const btns = el('div', { class: 'btns' },
      el('button', { class: 'btn chalk-box', onclick: () => { app.audio.tap(); app.playLevel(L.id); } }, r.cleared ? 'Again' : 'Try again'),
      el('button', { class: 'btn chalk-box', onclick: () => { app.audio.tap(); app.playLevel(L.id, { replay: this.sim.placements() }); } }, 'Replay'),
      el('button', { class: 'btn chalk-box', onclick: () => { app.audio.tap(); app.goLevels(L.world); } }, 'Levels'),
      next && app.save.levelUnlocked(next) ? el('button', { class: 'btn primary chalk-box', onclick: () => { app.audio.tap(); app.playLevel(next); } }, 'Next →') : null,
    );
    const title = this.replay ? 'Replay' : r.cleared ? (nStars === 3 ? 'Perfect!' : 'Cleared!') : 'Not quite…';
    app.modal(el('h2', {}, title), starsEl, why ? el('p', {}, why) : null, goals,
      r.cleared ? el('div', { class: 'score-line' }, `${r.score.toLocaleString()} pts${rec?.newBest ? '  • best!' : ''}`) : null,
      r.cleared ? bd : null, btns);
  }

  // ------------------------------------------------------------------ input

  private on(t: EventTarget, ev: string, fn: (e: any) => void, o?: any): void {
    t.addEventListener(ev, fn as EventListener, o);
    this.handlers.push([t, ev, fn as EventListener, o]);
  }

  private bindInput(): void {
    const cv = this.app.canvas;
    this.on(cv, 'pointerdown', (e: PointerEvent) => this.down(e));
    this.on(window, 'pointermove', (e: PointerEvent) => this.move(e));
    this.on(window, 'pointerup', (e: PointerEvent) => this.up(e));
    this.on(window, 'pointercancel', (e: PointerEvent) => this.up(e, true));
    this.on(cv, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    this.on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.pause();
      else if (e.key === 'Enter' || e.key === ' ') this.detonate();
      else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') this.undo();
      else if (e.key === 'r') this.app.playLevel(this.level.id);
    });
    this.on(document, 'visibilitychange', () => { if (document.hidden && this.sim.phase === 'plan') this.pause(); });
  }

  private trayDown(e: PointerEvent, kind: ChargeKind): void {
    e.preventDefault(); e.stopPropagation();
    if (this.sim.phase !== 'plan' || this.paused) return;
    if (this.sim.remaining(kind) <= 0) { this.app.audio.deny(); return; }
    this.app.audio.tap();
    this.select(null);
    this.selKind = this.selKind === kind ? null : kind;
    this.drag = { kind, charge: null, id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', moved: false };
    this.refresh();
  }

  private chargeNear(x: number, y: number): Charge | null {
    const r = Math.max(1.1, 26 / this.app.scene.scale);
    let best: Charge | null = null, bd = r;
    for (const c of this.sim.charges) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  private down(e: PointerEvent): void {
    if (this.paused || this.resultShown) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (this.pointers.size === 1) {
      const [wx, wy] = this.app.scene.toWorld(e.clientX, e.clientY);
      const c = this.sim.phase === 'plan' ? this.chargeNear(wx, wy) : null;
      if (c) {
        this.drag = { kind: c.kind, charge: c, id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', moved: false };
        return;
      }
      this.mode = 'pan';
    } else if (this.pointers.size === 2 && !this.drag) {
      const [a, b] = [...this.pointers.values()];
      this.mode = 'pinch';
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, h: this.app.scene.cam.h, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }

  // where a dragged charge would go (lifted above a finger so it stays visible)
  private dragPoint(d: Drag): [number, number] {
    const lift = d.touch ? Math.min(innerHeight * 0.11, 70) : 0;
    let [x, y] = this.app.scene.toWorld(d.x, d.y - lift);
    const p = this.sim.pieceAt(x, y);
    if (p) { const s = this.sim.snap(p, x, y); x = s.x; y = s.y; }
    return [x, y];
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (d && d.id === e.pointerId) {
      d.x = e.clientX; d.y = e.clientY;
      if (Math.hypot(d.x - d.sx, d.y - d.sy) > 8) d.moved = true;
      if (d.moved && d.charge) {
        const [x, y] = this.dragPoint(d);
        this.sim.moveCharge(d.charge, x, y);
        if (this.selected) this.select(null);
      }
      this.refresh();
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const cam = this.app.scene.cam, k = this.app.scene.scale;
    if (this.mode === 'pan' && Math.hypot(p.x - p.sx, p.y - p.sy) > 6) {
      cam.x -= dx / k; cam.y += dy / k;
      this.clampCam();
    } else if (this.mode === 'pinch' && this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const [wx, wy] = this.app.scene.toWorld(this.pinch.mx, this.pinch.my);
      cam.h = this.pinch.h * this.pinch.d / dist;
      this.clampCam();
      const [nx, ny] = this.app.scene.toWorld(mx, my);
      cam.x += wx - nx; cam.y += wy - ny;
      this.pinch = { d: dist, h: cam.h, mx, my };
      this.clampCam();
    }
  }

  private up(e: PointerEvent, cancel = false): void {
    const d = this.drag;
    if (d && d.id === e.pointerId) {
      this.drag = null;
      this.pointers.delete(e.pointerId);
      if (cancel) { this.refresh(); return; }
      const overTray = this.overTray(e.clientX, e.clientY);
      if (d.charge) {
        if (!d.moved) { this.app.audio.tap(); this.select(this.selected === d.charge ? null : d.charge); }
        else if (overTray) { this.sim.removeCharge(d.charge); this.app.audio.tap(); }
        else this.app.audio.scribble();
      } else if (d.moved && !overTray) {
        const [x, y] = this.dragPoint(d);
        const c = this.place(d.kind, x, y);
        if (c && this.sim.remaining(d.kind) <= 0) this.selKind = null;
      }
      this.refresh();
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const tap = !cancel && Math.hypot(p.x - p.sx, p.y - p.sy) < 8 && performance.now() - p.t < 450;
    if (tap && this.mode === 'pan' && this.sim.phase === 'plan') {
      if (this.selected) this.select(null);
      else if (this.selKind) {
        const [x, y] = this.app.scene.toWorld(e.clientX, e.clientY);
        const c = this.place(this.selKind, x, y);
        if (c && this.sim.remaining(this.selKind) <= 0) this.selKind = null;
        this.refresh();
      }
    }
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.mode === 'pinch') this.mode = 'pan';
  }

  private overTray(x: number, y: number): boolean {
    const r = this.trayEl.getBoundingClientRect();
    return !this.trayEl.hidden && x >= r.left - 10 && x <= r.right + 10 && y >= r.top - 10 && y <= r.bottom + 10;
  }

  private zoomAt(sx: number, sy: number, f: number): void {
    const scene = this.app.scene;
    const [wx, wy] = scene.toWorld(sx, sy);
    scene.cam.h *= f;
    this.clampCam();
    const [nx, ny] = scene.toWorld(sx, sy);
    scene.cam.x += wx - nx; scene.cam.y += wy - ny;
    this.clampCam();
  }

  private clampCam(): void {
    const cam = this.app.scene.cam, base = this.app.scene.fitCamera(this.level);
    cam.h = Math.min(base.h * 1.15, Math.max(base.h * 0.4, cam.h));
    const aspect = innerWidth / innerHeight;
    const bw = base.h * 1.15 * Math.max(aspect, 1.6) / 2, bh = base.h * 1.15 / 2;
    const w = cam.h * aspect / 2, h = cam.h / 2;
    cam.x = Math.min(base.x + Math.max(0, bw - w), Math.max(base.x - Math.max(0, bw - w), cam.x));
    cam.y = Math.min(base.y + Math.max(0, bh - h), Math.max(base.y - Math.max(0, bh - h), cam.y));
  }

  // ------------------------------------------------------------------ frame

  frame(dt: number): void {
    const s = this.sim, scene = this.app.scene;
    if (this.replayAt && performance.now() >= this.replayAt) { this.replayAt = 0; s.detonate(); scene.setForeman('point'); }
    if (!this.paused) {
      // slow motion right after the first blast, easing back to normal
      if (this.slowT > 0) { this.slowT -= dt; this.speed = this.slowT > 0.25 ? 0.3 : 0.3 + (0.25 - Math.max(0, this.slowT)) / 0.25 * 0.7; }
      else this.speed = 1;
      this.acc += Math.min(dt, 0.1) * this.speed;
      let n = 0;
      while (this.acc >= TICK && n < 4) { s.step(); this.acc -= TICK; n++; }
      if (n === 4) this.acc = 0;
      if (s.phase === 'live') {
        this.refreshLive();
        scene.syncCharges(s.charges, null, true);
      }
    }
    const alpha = s.phase === 'live' ? Math.min(1, this.acc / TICK) : 1;
    scene.update(dt, alpha);
    // drag preview
    const d = this.drag;
    if (d && (d.moved || !d.charge) && s.phase === 'plan') {
      const [x, y] = this.dragPoint(d);
      const p = s.pieceAt(x, y);
      const ok = !!p && s.remaining(d.kind) + (d.charge ? 1 : 0) > 0;
      let cut;
      if (p && Sim.cuts(d.kind, p.mat)) {
        const along = p.w >= p.h;
        cut = { x, y, angle: p.a + (along ? 0 : Math.PI / 2), len: CHARGES[d.kind].cutLength, thick: Math.min(p.w, p.h) };
      }
      scene.preview(d.kind, x, y, ok, cut, d.charge ? d.charge.dir : this.defaultDir(x));
      if (!d.charge) this.app.scene.syncCharges(this.chargeList(), this.selected, false);
    } else if (this.selected && s.phase === 'plan') {
      const c = this.selected;
      scene.preview(c.kind, c.x, c.y, true, undefined, c.dir);
    } else if (this.hintMarks && s.phase === 'plan') {
      scene.hintMarks(this.hintMarks.map((p) => this.hintPos(p)).filter(Boolean) as any);
    } else scene.preview(null, 0, 0, false);
    if (!this.hintMarks && s.phase === 'plan') scene.hintMarks([]);
    this.positionPopover();
    if (this.toastEl && performance.now() > this.toastT) { this.toastEl.remove(); this.toastEl = null; }
    if (s.phase === 'settled' && !this.resultShown && performance.now() >= this.finishedAt && s.result) this.showResults(s.result);
  }

  private hintPos(p: Placement): { x: number; y: number; kind: ChargeKind; dir: number; fuse: number } | null {
    const piece = this.sim.pieces.find((q) => q.levelIndex === p.piece && q.alive);
    if (!piece) return null;
    const along = piece.w >= piece.h;
    const [x, y] = along ? this.sim.toWorld(piece, p.local, 0) : this.sim.toWorld(piece, 0, p.local);
    return { x, y, kind: p.kind, dir: p.dir, fuse: p.fuse };
  }

  private liveTick = 0;
  private refreshLive(): void {
    if (++this.liveTick % 6) return;
    const h = this.sim.rubbleHeight();
    const above = h > this.level.passLine;
    this.statusEl.replaceChildren(el('span', { class: above ? 'warn' : '' }, `rubble ${h.toFixed(1)} ft`));
  }
}

function matColor(m: string): string {
  return ({ wood: '#e8d2a6', concrete: '#d6d6cf', steel: '#a9c8e6', glass: '#bfeff2', stone: '#ffffff' } as Record<string, string>)[m] ?? '#ffffff';
}
