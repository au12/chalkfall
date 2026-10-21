// All sound in Chalkfall is synthesized with WebAudio: explosions, impacts by material, chalk
// taps, jingles and a small generative music loop. No sample files.
import type { ChargeKind, MaterialId } from '../game/constants.ts';

type AC = AudioContext;

export class Audio {
  ctx: AC | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private verb!: ConvolverNode;
  private noise!: AudioBuffer;
  sfxVol = 0.9;
  musicVol = 0.45;
  private musicOn = false;
  private nextBeat = 0;
  private beat = 0;
  private timer: number | null = null;
  private lastImpact = 0;
  private impactsThisWindow = 0;

  constructor() {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }

  private unlock(): void {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const C = window.AudioContext || (window as any).webkitAudioContext;
    if (!C) return;
    const ctx = new C() as AC;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(comp);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVol * 0.5; this.musicBus.connect(comp);
    // a short room reverb from decaying noise
    this.verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.verb.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.22;
    this.verb.connect(vg).connect(comp);
    // white noise source buffer
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    if (this.musicOn) this.startMusic();
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVol = sfx; this.musicVol = music;
    if (!this.ctx) return;
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------------ building blocks

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, verb = 0.3, rate = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, peak, dur);
    src.connect(f).connect(g).connect(this.sfx);
    if (verb > 0) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s).connect(this.verb); }
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, verb = 0.2, attack = 0.003): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(this.sfx);
    if (verb > 0) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s).connect(this.verb); }
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  private get now(): number { return this.ctx ? this.ctx.currentTime : 0; }
  private ok(): boolean { return !!this.ctx && this.ctx.state === 'running' && this.sfxVol > 0; }

  // ------------------------------------------------------------------ game sounds

  charge(kind: ChargeKind, power = 1): void {
    if (!this.ok()) return;
    const t = this.now + 0.005;
    switch (kind) {
      case 'charge':
        this.noiseBurst(t, 0.9, 'lowpass', 2600, 90, 0.8, 0.9 * power, 0.5);
        this.tone(t, 'sine', 120, 38, 0.55, 0.9 * power, 0.2);
        for (let i = 0; i < 5; i++) this.noiseBurst(t + 0.05 + Math.random() * 0.4, 0.06, 'bandpass', 1800, 900, 2, 0.15, 0.2);
        break;
      case 'blaster':
        this.noiseBurst(t, 1.6, 'lowpass', 1800, 50, 0.7, 1.2 * power, 0.7, 0.8);
        this.tone(t, 'sine', 90, 28, 1.1, 1.1 * power, 0.3);
        this.tone(t, 'triangle', 60, 30, 0.8, 0.5 * power, 0.3);
        break;
      case 'cutter':
        this.noiseBurst(t, 0.25, 'highpass', 5000, 2000, 1, 0.5, 0.2);
        for (const f of [1320, 1985, 2870]) this.tone(t, 'sine', f, f * 0.98, 0.5, 0.08, 0.4);
        this.tone(t, 'sine', 200, 80, 0.15, 0.3, 0.1);
        break;
      case 'kicker':
        this.noiseBurst(t, 0.45, 'lowpass', 900, 120, 1, 0.8, 0.3);
        this.tone(t, 'sine', 150, 55, 0.35, 0.8, 0.2);
        break;
      case 'imploder': {
        // a reversed whoosh, then a soft thump
        const ctx = this.ctx!;
        const src = ctx.createBufferSource(); src.buffer = this.noise;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.45);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.42); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        src.connect(f).connect(g).connect(this.sfx); g.connect(this.verb);
        src.start(t); src.stop(t + 0.55);
        this.tone(t + 0.45, 'sine', 110, 40, 0.5, 0.9, 0.3);
        break;
      }
    }
  }

  impact(mat: MaterialId, speed: number): void {
    if (!this.ok()) return;
    const t = this.now;
    if (t - this.lastImpact > 0.06) { this.lastImpact = t; this.impactsThisWindow = 0; }
    if (++this.impactsThisWindow > 3) return;
    const v = Math.min(1, speed / 18);
    if (v < 0.12) return;
    const tt = t + Math.random() * 0.01;
    switch (mat) {
      case 'wood':
        this.noiseBurst(tt, 0.12, 'bandpass', 700, 300, 2.5, 0.35 * v, 0.15);
        this.tone(tt, 'triangle', 220 + Math.random() * 60, 140, 0.12, 0.25 * v, 0.1);
        break;
      case 'concrete': case 'stone':
        this.noiseBurst(tt, 0.2, 'lowpass', 1400, 200, 0.7, 0.45 * v, 0.2);
        this.tone(tt, 'sine', 90, 50, 0.18, 0.35 * v, 0.1);
        break;
      case 'steel':
        for (const f of [430, 1080, 1730, 2640]) this.tone(tt, 'sine', f * (0.95 + Math.random() * 0.1), f, 0.5 + Math.random() * 0.3, 0.06 * v, 0.4);
        this.noiseBurst(tt, 0.06, 'highpass', 3000, 2000, 1, 0.15 * v, 0.1);
        break;
      case 'glass':
        for (let i = 0; i < 3; i++) this.tone(tt + i * 0.03, 'sine', 2500 + Math.random() * 3000, 2400, 0.12, 0.05 * v, 0.5);
        break;
    }
  }

  shatter(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.noiseBurst(t, 0.35, 'highpass', 6000, 2500, 0.8, 0.4, 0.5);
    for (let i = 0; i < 9; i++) this.tone(t + Math.random() * 0.25, 'sine', 2200 + Math.random() * 4000, 2000, 0.15, 0.06, 0.6);
  }

  weld(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.tone(t, 'square', 1800, 600, 0.08, 0.06, 0.2);
    this.noiseBurst(t, 0.1, 'bandpass', 4000, 2000, 4, 0.15, 0.2);
  }

  tap(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.noiseBurst(t, 0.035, 'bandpass', 2400, 1800, 3, 0.25, 0.05);
  }

  scribble(): void {
    if (!this.ok()) return;
    const t = this.now;
    for (let i = 0; i < 3; i++) this.noiseBurst(t + i * 0.045, 0.04, 'bandpass', 3000 + Math.random() * 1500, 2200, 4, 0.18, 0.05);
  }

  deny(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.tone(t, 'triangle', 220, 180, 0.12, 0.2, 0.05);
    this.tone(t + 0.1, 'triangle', 180, 150, 0.15, 0.2, 0.05);
  }

  plunger(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.noiseBurst(t, 0.08, 'bandpass', 900, 600, 2, 0.4, 0.1);
    this.tone(t, 'sine', 300, 120, 0.1, 0.3, 0.05);
  }

  win(stars: number): void {
    if (!this.ok()) return;
    const t = this.now + 0.05;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    const n = 3 + Math.min(2, stars - 1);
    for (let i = 0; i < n; i++) {
      this.tone(t + i * 0.11, 'triangle', notes[i], notes[i], 0.35, 0.25, 0.4);
      this.tone(t + i * 0.11, 'sine', notes[i] * 2, notes[i] * 2, 0.25, 0.06, 0.4);
    }
  }

  star(i: number): void {
    if (!this.ok()) return;
    const f = [880, 1108.7, 1318.5][i] ?? 1318.5;
    const t = this.now;
    this.tone(t, 'triangle', f, f, 0.3, 0.22, 0.5);
    this.tone(t, 'sine', f * 1.5, f * 1.5, 0.2, 0.06, 0.5);
  }

  lose(): void {
    if (!this.ok()) return;
    const t = this.now + 0.05;
    [392, 349.2, 311.1, 233.1].forEach((f, i) => this.tone(t + i * 0.22, 'triangle', f, f * (i === 3 ? 0.94 : 1), i === 3 ? 0.6 : 0.24, 0.22, 0.3));
  }

  // ------------------------------------------------------------------ music (a lazy chalk-room groove)

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (on) this.startMusic(); else this.stopMusic();
  }

  private startMusic(): void {
    if (!this.ctx || this.timer != null) return;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.beat = 0;
    this.timer = window.setInterval(() => this.schedule(), 100);
  }

  private stopMusic(): void {
    if (this.timer != null) { clearInterval(this.timer); this.timer = null; }
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicVol <= 0) return;
    const bpm = 86, spb = 60 / bpm / 2;              // eighth notes
    // ii-V-I-vi in F, two bars each chord
    const chords = [[55, 58, 62, 65], [48, 52, 55, 58], [53, 57, 60, 64], [50, 53, 57, 60]];
    const bass = [43, 36, 41, 38];
    while (this.nextBeat < ctx.currentTime + 0.3) {
      const t = this.nextBeat, b = this.beat;
      const bar = Math.floor(b / 8) % 8, chord = chords[Math.floor(bar / 2) % 4];
      const swing = b % 2 ? spb * 0.18 : 0;
      const tt = t + swing;
      const m = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
      // brushes
      if (b % 2 === 1) this.musicNoise(tt, 0.05, 7000, 0.025);
      if (b % 8 === 2 || b % 8 === 6) this.musicNoise(tt, 0.16, 1800, 0.05);
      // bass on beats 1 and 3, walk on 4
      if (b % 4 === 0) this.musicTone(tt, m(bass[Math.floor(bar / 2) % 4] + (b % 8 === 4 ? 7 : 0)), 0.4, 0.16, 'triangle');
      if (b % 8 === 7) this.musicTone(tt, m(bass[(Math.floor(bar / 2) + 1) % 4] - 1), 0.2, 0.12, 'triangle');
      // comping chords (on the "and" of 2 and on 4)
      if (b % 8 === 3 || b % 8 === 6) for (const n of chord) this.musicTone(tt, m(n + 12), 0.5, 0.03, 'sine', true);
      // a sparse melody
      if (b % 8 === 0 && bar % 2 === 0) { const n = chord[(bar / 2 + b) % 4] + 24; this.musicTone(tt, m(n), 0.6, 0.03, 'triangle', true); }
      this.nextBeat += spb;
      this.beat++;
    }
  }

  private musicTone(t: number, f: number, dur: number, peak: number, type: OscillatorType, verb = false): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.musicBus);
    if (verb) g.connect(this.verb);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private musicNoise(t: number, dur: number, f: number, peak: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const fl = ctx.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl).connect(g).connect(this.musicBus);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }
}
