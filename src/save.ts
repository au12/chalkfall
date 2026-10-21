// Progress and settings in localStorage.
import { LEVELS, WORLDS } from './levels/index.ts';

const KEY = 'chalkfall.v1';

export interface Settings { sfx: number; music: number; shake: boolean; hints: boolean }

interface Data {
  v: 1;
  stars: Record<string, [boolean, boolean, boolean]>;
  best: Record<string, number>;
  settings: Settings;
  seen: Record<string, boolean>;
  last?: string;
}

const DEFAULTS: Settings = { sfx: 0.9, music: 0.5, shake: true, hints: true };

export class Save {
  d: Data;
  constructor() {
    this.d = { v: 1, stars: {}, best: {}, settings: { ...DEFAULTS }, seen: {} };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        this.d = { ...this.d, ...p, settings: { ...DEFAULTS, ...(p.settings || {}) } };
      }
    } catch { /* storage blocked: play without saving */ }
  }
  write(): void { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch { /* ignore */ } }

  get settings(): Settings { return this.d.settings; }
  set(k: keyof Settings, v: Settings[keyof Settings]): void { (this.d.settings as any)[k] = v; this.write(); }

  stars(id: string): [boolean, boolean, boolean] { return this.d.stars[id] ?? [false, false, false]; }
  starCount(id: string): number { return this.stars(id).filter(Boolean).length; }
  total(): number { return LEVELS.reduce((s, l) => s + this.starCount(l.id), 0); }
  worldStars(w: number): number { return LEVELS.filter((l) => l.world === w).reduce((s, l) => s + this.starCount(l.id), 0); }
  worldUnlocked(w: number): boolean { const info = WORLDS[w - 1]; return !!info && this.total() >= info.unlock; }
  levelUnlocked(id: string): boolean {
    const L = LEVELS.find((l) => l.id === id);
    if (!L || !this.worldUnlocked(L.world)) return false;
    if (L.index === 1) return true;
    const prev = LEVELS.find((l) => l.world === L.world && l.index === L.index - 1)!;
    return this.stars(prev.id)[0];
  }

  // merges a result; returns which stars are new
  record(id: string, stars: [boolean, boolean, boolean], score: number): { newStars: boolean[]; newBest: boolean } {
    const old = this.stars(id);
    const merged = old.map((s, i) => s || stars[i]) as [boolean, boolean, boolean];
    const newStars = merged.map((s, i) => s && !old[i]);
    const newBest = score > (this.d.best[id] ?? 0);
    this.d.stars[id] = merged;
    if (newBest) this.d.best[id] = score;
    this.d.last = id;
    this.write();
    return { newStars, newBest };
  }

  seen(k: string): boolean { return !!this.d.seen[k]; }
  markSeen(k: string): void { this.d.seen[k] = true; this.write(); }
  reset(): void { const s = this.d.settings; this.d = { v: 1, stars: {}, best: {}, settings: s, seen: {} }; this.write(); }
}
