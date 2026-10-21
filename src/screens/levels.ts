// World and level select.
import { LEVELS, WORLDS } from '../levels/index.ts';
import { el } from '../ui/dom.ts';
import type { App, Screen } from '../main.ts';

export class LevelsScreen implements Screen {
  private app: App;
  private world: number | null;
  private root!: HTMLElement;
  private keys = (e: KeyboardEvent) => { if (e.key === 'Escape') { this.world ? this.show(null) : this.app.goTitle(); } };

  constructor(app: App, world?: number) { this.app = app; this.world = world ?? null; }

  enter(): void {
    this.root = el('div', { class: 'screen' });
    this.app.ui.append(this.root);
    addEventListener('keydown', this.keys);
    this.app.scene.clear();
    this.show(this.world);
  }

  exit(): void { removeEventListener('keydown', this.keys); this.root.remove(); }

  private show(world: number | null): void {
    this.world = world;
    const app = this.app, save = app.save;
    this.root.replaceChildren();
    if (world == null) {
      const total = save.total();
      this.root.append(el('div', { class: 'screen-head' },
        el('button', { class: 'btn icon chalk-box', 'aria-label': 'Back', onclick: () => { app.audio.tap(); app.goTitle(); } }, '←'),
        el('h1', {}, 'Choose a site'),
        el('div', { class: 'tag' }, `★ ${total} / ${LEVELS.length * 3}`)));
      const list = el('div', { class: 'worlds' });
      for (const w of WORLDS) {
        const open = save.worldUnlocked(w.id);
        const n = LEVELS.filter((l) => l.world === w.id).length;
        const card = el('button', { class: 'world chalk-box' + (open ? '' : ' locked') },
          el('div', { class: 'num' }, `Site ${w.id}`),
          el('h2', {}, w.name),
          el('p', {}, open ? w.blurb : `Earn ${w.unlock} ★ to open this site.`),
          el('div', { class: 'stars' }, `★ ${save.worldStars(w.id)} / ${n * 3}`));
        card.onclick = () => { if (!open) { app.audio.deny(); return; } app.audio.tap(); this.show(w.id); };
        list.append(card);
      }
      this.root.append(list);
      return;
    }
    const W = WORLDS[world - 1];
    this.root.append(el('div', { class: 'screen-head' },
      el('button', { class: 'btn icon chalk-box', 'aria-label': 'Back', onclick: () => { app.audio.tap(); this.show(null); } }, '←'),
      el('h1', {}, W.name),
      el('div', { class: 'tag' }, `★ ${save.worldStars(world)}`)));
    const grid = el('div', { class: 'levels' });
    let marked = false;
    for (const L of LEVELS.filter((l) => l.world === world)) {
      const open = save.levelUnlocked(L.id);
      const st = save.stars(L.id);
      const isNext = open && !st[0] && !marked;
      if (isNext) marked = true;
      const stars = el('div', { class: 'st' }, ...st.map((s) => el('span', { class: s ? '' : 'off' }, '★')));
      const t = el('button', { class: 'level-tile chalk-box' + (open ? '' : ' locked') + (isNext ? ' next' : '') },
        el('div', { class: 'n' }, L.id), el('div', { class: 'name' }, L.name), stars);
      t.onclick = () => { app.audio.tap(); app.playLevel(L.id); };
      grid.append(t);
    }
    this.root.append(grid);
  }

  frame(_dt: number): void { this.app.scene.update(_dt, 1); }
}
