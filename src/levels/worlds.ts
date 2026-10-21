// Chalkfall levels: four worlds of eight. Structures are built with the Build DSL; the pass and
// gold lines and the par are provisional here and calibrated by the solver (tools/solve.ts),
// which writes calibration.json.
import { Build, type BonusGoal, type LevelDef, type ProtectedDef } from '../game/level.ts';
import type { ChargeKind } from '../game/constants.ts';

export interface WorldInfo { id: number; name: string; blurb: string; unlock: number; theme: string }

export const WORLDS: WorldInfo[] = [
  { id: 1, name: 'First Day', blurb: 'Timber and concrete. Learn where buildings want to fall.', unlock: 0, theme: 'day' },
  { id: 2, name: 'Downtown', blurb: 'Neighbours everywhere. Kickers push the mess where you want it.', unlock: 12, theme: 'city' },
  { id: 3, name: 'Steelworks', blurb: 'Bolted steel only gives way to cutters. Timing is everything.', unlock: 28, theme: 'steel' },
  { id: 4, name: 'Skyline', blurb: 'Glass towers and the imploder. Bring it all down neatly.', unlock: 46, theme: 'night' },
];

interface Spec {
  name: string;
  charges: Partial<Record<ChargeKind, number>>;
  build: (b: Build) => void;
  pass: number;
  gold?: number;
  par?: number;
  bonus?: BonusGoal;
  protect?: ProtectedDef[];
  hint?: string;
  designs?: LevelDef['designs'];
  weldStrength?: number;
}

function level(world: number, index: number, s: Spec): LevelDef {
  const b = new Build();
  s.build(b);
  const total = Object.values(s.charges).reduce((a, n) => a + (n ?? 0), 0);
  const L: LevelDef = {
    id: `${world}-${index}`, world, index, name: s.name,
    pieces: b.pieces, welds: b.welds, weldStrength: s.weldStrength,
    passLine: s.pass, goldLine: s.gold ?? Math.max(1, Math.round(s.pass * 0.5)),
    par: s.par ?? Math.max(1, total - 1),
    bonus: s.bonus ?? { type: 'gold' },
    charges: s.charges, protected: s.protect, hint: s.hint, designs: s.designs,
  };
  L.camera = autoCamera(L);
  L.doodles = autoDoodles(L, WORLDS[world - 1].theme);
  return L;
}

export function bounds(L: LevelDef): [number, number, number, number] {
  let x0 = Infinity, x1 = -Infinity, y1 = 0;
  for (const p of L.pieces) {
    const r = Math.hypot(p.w, p.h) / 2;
    const ex = p.angle ? r : p.w / 2, ey = p.angle ? r : p.h / 2;
    x0 = Math.min(x0, p.x - ex); x1 = Math.max(x1, p.x + ex); y1 = Math.max(y1, p.y + ey);
  }
  for (const p of L.protected ?? []) { x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2); y1 = Math.max(y1, p.h); }
  if (L.bonus.type === 'lot') { x0 = Math.min(x0, L.bonus.x0); x1 = Math.max(x1, L.bonus.x1); }
  return [x0, 0, x1, y1];
}

function autoCamera(L: LevelDef) {
  const [x0, , x1, y1] = bounds(L);
  const w = x1 - x0 + 12, top = y1 + 3;
  const h = Math.max(top / 0.62, w / 1.78, 22);
  return { x: (x0 + x1) / 2, y: h * 0.3, h, w, top };
}

function autoDoodles(L: LevelDef, theme: string) {
  const [x0, , x1, y1] = bounds(L);
  const cam = L.camera!;
  const top = cam.y + cam.h * 0.26, halfW = cam.h * 0.85;   // just under the title bar
  const d: LevelDef['doodles'] = [];
  const left = cam.x - halfW, right = cam.x + halfW;
  const fx = Math.max(left + 3, x0 - 5);
  d.push({ kind: 'foreman', x: fx, y: 0 });
  // boxes the sky doodles must stay clear of
  const busy: [number, number, number, number][] = [[x0 - 1.5, -1, x1 + 1.5, y1 + 1.5], [fx - 2, 0, fx + 2, 7]];
  for (const p of L.protected ?? []) busy.push([p.x - p.w / 2 - 1, 0, p.x + p.w / 2 + 1, (p.y ?? 0) + p.h + 1]);
  const free = (bx0: number, by0: number, bx1: number, by1: number) => busy.every(([a, b, c, e]) => bx1 < a || bx0 > c || by1 < b || by0 > e);
  const put = (kind: string, x: number, y: number, w: number, h: number, extra: object = {}) => {
    if (!free(x - w / 2, y - h / 2, x + w / 2, y + h / 2)) return false;
    busy.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
    d.push({ kind, x, y, ...extra } as any);
    return true;
  };
  const cloud = (w: number, sc: number) => {
    for (const [x, y] of [[left + 10, top - 2], [right - 12, top - 4], [left + 6, top - 5], [cam.x - 12, top - 1.5], [cam.x + 12, top - 1.5]]) if (put('cloud', x, y, w, w * 0.4, { s: sc })) return;
  };
  const eqs = ['F = m a', 'v² = 2 g h', 'Δh < 0', 'E = ½ m v²', 'τ = r × F', 'p = m v'];
  const eq = eqs[(L.world * 3 + L.index) % eqs.length];
  if (theme === 'night') {
    put('moon', right - 8, top - 3, 5, 5, { s: 1.2 });
    d.push({ kind: 'skyline', x: cam.x, y: 0, s: 2.2 });
  } else if (theme === 'city') {
    d.push({ kind: 'skyline', x: cam.x - 4, y: 0, s: 1.8 });
    cloud(9, 1);
  } else if (theme === 'steel') {
    // a tower crane on the skyline (not on the level that is itself a crane)
    if (!/crane/i.test(L.name)) d.push({ kind: 'crane', x: x1 + 12, y: 0, s: Math.max(1, y1 / 22) });
    cloud(9, 0.9);
  } else {
    cloud(9, 1);
    cloud(6.5, 0.7);
    if (put('bird', cam.x + 6, top - 2.5, 2, 1.2, { s: 1 })) put('bird', cam.x + 9, top - 4, 1.6, 1, { s: 0.8 });
  }
  // the equation goes in the first clear patch of sky
  for (const [x, y] of [[left + 11, top - 7], [right - 12, top - 8], [left + 11, top - 11]]) if (put('equation', x, y, 9, 2, { text: eq, s: 1 })) break;
  // a couple of onlookers at a safe distance, clear of the neighbours
  for (const x of [x1 + 6, x1 + 10, right - 6, x0 - 10]) {
    if (!free(x - 1.2, 0, x + 2.8, 6)) continue;
    d.push({ kind: 'spectator', x, y: 0, s: 1 }, { kind: 'spectator', x: x + 1.6, y: 0, s: 0.9 });
    break;
  }
  return d;
}

const house = (x: number, w = 7, h = 7): ProtectedDef => ({ kind: 'house', x, w, h });

// ---------------------------------------------------------------------------- World 1: First Day

const W1: Spec[] = [
  {
    name: 'The Shed', charges: { charge: 2 }, pass: 6, par: 2,
    hint: 'Drag a charge from the tray onto a post, then hit BOOM.',
    build: (b) => { const f = b.frame({ x: 0, bays: 1, bayW: 8, floors: 1, floorH: 6 }); b.roof(f.left - 0.6, f.right + 0.6, f.top, 4); },
  },
  {
    name: 'Bunkhouse', charges: { charge: 3 }, pass: 7,
    hint: 'Everything has to end up below the red line. Fewer charges earns the par star.',
    build: (b) => { const f = b.frame({ x: 0, bays: 2, bayW: 7, floors: 2, floorH: 5 }); b.roof(f.left - 0.6, f.right + 0.6, f.top, 3.5); },
  },
  {
    name: 'Block Party', charges: { charge: 1, blaster: 1 }, pass: 5,
    hint: 'Blasters don’t cut, they shove. Great for knocking stacks over.',
    build: (b) => { b.blocks(0, 0, 3, 6, 3, 2, 'concrete', true); },
  },
  {
    name: 'Farmhouse', charges: { charge: 4 }, pass: 7,
    build: (b) => { const f = b.frame({ x: 0, bays: 3, bayW: 6, floors: 2, floorH: 5 }); b.roof(f.left - 0.6, f.right + 0.6, f.top, 4.5); },
  },
  {
    name: 'Water Tower', charges: { charge: 2, blaster: 1 }, pass: 6,
    hint: 'Heavy on top? Take out one side and let gravity do the rest.',
    build: (b) => {
      const l = b.col(-3, 0, 12, 'wood', 1), r = b.col(3, 0, 12, 'wood', 1);
      for (const [y0, y1] of [[1.2, 5.8], [6.6, 11.2]]) {
        const br = b.brace(-2.25, y0, 2.25, y1, 'wood', 0.45);
        b.weld(br, l, -2.5, y0); b.weld(br, r, 2.5, y1);
      }
      b.beam(-4.6, 4.6, 12, 'wood', 1);
      b.block(0, 13, 6.5, 5, 'concrete');
    },
  },
  {
    name: 'Garage Row', charges: { charge: 4, blaster: 1 }, pass: 5,
    build: (b) => {
      const f = b.frame({ x: 0, bays: 4, bayW: 6, floors: 1, floorH: 5, beamMat: 'concrete' });
      b.frame({ x: -6, y0: f.top, bays: 2, bayW: 6, floors: 1, floorH: 4.5 });
    },
  },
  {
    name: 'Bell Tower', charges: { charge: 3 }, pass: 7, bonus: { type: 'lot', x0: -16, x1: 16 },
    hint: 'Bonus: keep every piece between the yellow posts.',
    build: (b) => { const f = b.frame({ x: 0, bays: 1, bayW: 6, floors: 4, floorH: 5 }); b.roof(f.left - 0.6, f.right + 0.6, f.top, 5); },
  },
  {
    name: 'Old Mill', charges: { charge: 3, blaster: 2 }, pass: 7, bonus: { type: 'lot', x0: -18, x1: 18 },
    hint: 'White double-lined frames are reinforced: nothing cuts them.',
    build: (b) => {
      b.frame({ x: 0, bays: 2, bayW: 7, floors: 3, floorH: 5, skip: (_f, c) => c === 0 || c === 2 });
      // reinforced outer posts
      for (const x of [-7, 7]) for (let f = 0; f < 3; f++) b.col(x, f * 6, 5, 'stone');
    },
  },
];

// ---------------------------------------------------------------------------- World 2: Downtown

const W2: Spec[] = [
  {
    name: 'Corner Store', charges: { charge: 2, kicker: 1 }, pass: 6, protect: [house(14)],
    hint: 'Don’t hit the neighbours! (Rubble gently sliding up to them is fine.) Kickers shove things the way the arrow points: tap one to aim.',
    build: (b) => { b.frame({ x: 0, bays: 2, bayW: 6, floors: 2, floorH: 5 }); },
  },
  {
    name: 'Tight Squeeze', charges: { charge: 3, kicker: 1 }, pass: 7, protect: [house(-15), house(15)],
    bonus: { type: 'lot', x0: -10.5, x1: 10.5 },
    build: (b) => { b.frame({ x: 0, bays: 1, bayW: 6, floors: 3, floorH: 5 }); },
  },
  {
    name: 'Billboard', charges: { charge: 2, kicker: 1 }, pass: 5, protect: [{ kind: 'car', x: 13, w: 7, h: 3.2 }],
    build: (b) => {
      const l = b.col(-4, 0, 13, 'wood', 1), r = b.col(4, 0, 13, 'wood', 1);
      const br = b.brace(-3.25, 2.2, 3.25, 6.8, 'wood', 0.45);
      b.weld(br, l, -3.5, 2.2); b.weld(br, r, 3.5, 6.8);
      b.block(0, 13, 13, 4, 'wood');
    },
  },
  {
    name: 'Walk-up', charges: { charge: 4, kicker: 2 }, pass: 8, protect: [{ kind: 'shop', x: -19, w: 8, h: 7 }],
    build: (b) => { b.frame({ x: 0, bays: 3, bayW: 6, floors: 3, floorH: 5, beamMat: 'concrete' }); },
  },
  {
    name: 'Parking Deck', charges: { charge: 4, blaster: 1, kicker: 2 }, pass: 8,
    protect: [{ kind: 'car', x: 22, w: 7, h: 3.2 }, { kind: 'tree', x: -22, w: 6, h: 9 }],
    build: (b) => { b.frame({ x: 0, bays: 3, bayW: 7, floors: 3, floorH: 4, mat: 'concrete', t: 1.2 }); },
  },
  {
    name: 'Clock Tower', charges: { charge: 3, kicker: 2 }, pass: 9, protect: [{ kind: 'statue', x: 12, w: 4, h: 8 }],
    build: (b) => {
      for (const x of [-2.5, 2.5]) b.col(x, 0, 5, 'stone');
      b.beam(-3.5, 3.5, 5, 'wood');
      const f = b.frame({ x: 0, y0: 6, bays: 1, bayW: 5, floors: 4, floorH: 5 });
      b.roof(f.left - 0.6, f.right + 0.6, f.top, 4);
    },
  },
  {
    name: 'Twins', charges: { charge: 4, kicker: 2 }, pass: 7,
    designs: [[['charge', -14.5, 2.5], ['charge', 14.5, 2.5]], [['charge', -14.5, 2.5], ['charge', 14.5, 2.5], ['kicker', -9.5, 14.5, 0.5, Math.PI], ['kicker', 9.5, 14.5, 0.5, 0]]], protect: [{ kind: 'kiosk', x: 0, w: 3, h: 4.5 }],
    hint: 'Two towers, one kiosk in the middle. Send them outward.',
    build: (b) => {
      for (const x of [-12, 12]) { const f = b.frame({ x, bays: 1, bayW: 5, floors: 3, floorH: 5 }); b.roof(f.left - 0.5, f.right + 0.5, f.top, 3); }
    },
  },
  {
    name: 'Main Street', charges: { charge: 5, blaster: 1, kicker: 2 }, pass: 7,
    protect: [house(-25, 7, 7), { kind: 'shop', x: 25, w: 8, h: 7 }], bonus: { type: 'lot', x0: -19, x1: 19 },
    build: (b) => { b.frame({ x: 0, bays: 4, bayW: 6, floors: 3, floorH: 5, beamMat: 'concrete' }); },
  },
];

// ---------------------------------------------------------------------------- World 3: Steelworks

const STEEL = 1400;
const W3: Spec[] = [
  {
    name: 'Gantry', charges: { cutter: 2, charge: 1 }, pass: 4, weldStrength: STEEL,
    hint: 'Blue frames are bolted steel. Only cutters slice them.',
    build: (b) => { b.frame({ x: 0, bays: 1, bayW: 12, floors: 1, floorH: 12, mat: 'steel', weld: true }); },
  },
  {
    name: 'Catwalk', charges: { cutter: 3, charge: 2 }, pass: 6, weldStrength: STEEL, bonus: { type: 'noFuse' },
    hint: 'Tap a placed charge to set its fuse. Delayed charges let you sequence the collapse.',
    build: (b) => {
      const f = b.frame({ x: 0, bays: 2, bayW: 7, floors: 2, floorH: 6, mat: 'steel', weld: true });
      b.beam(-7.5, 7.5, f.top, 'wood');
    },
  },
  {
    name: 'Silo', charges: { cutter: 2, charge: 2, blaster: 1 }, pass: 6, weldStrength: STEEL,
    build: (b) => {
      b.frame({ x: 0, bays: 1, bayW: 6, floors: 1, floorH: 8, mat: 'steel', weld: true });
      b.blocks(0, 9, 1, 3, 6, 4, 'concrete');
    },
  },
  {
    name: 'Crane', charges: { cutter: 3, kicker: 1 }, pass: 5, weldStrength: STEEL,
    protect: [{ kind: 'car', x: 18, w: 7, h: 3.2 }],
    build: (b) => {
      const f = b.frame({ x: 0, bays: 1, bayW: 3, floors: 5, floorH: 4, mat: 'steel', weld: true });
      const jib = b.beam(-7, 13, f.top, 'steel');
      b.weld(f.beams[f.beams.length - 1], jib, 0, f.top);
      b.block(-5.5, f.top + 1, 3, 3, 'concrete');
    },
  },
  {
    name: 'Warehouse', charges: { cutter: 3, charge: 3 }, pass: 5, weldStrength: STEEL,
    build: (b) => {
      const f = b.frame({ x: 0, bays: 3, bayW: 8, floors: 1, floorH: 7, mat: 'steel', weld: true });
      b.beam(-12.5, 12.5, f.top, 'concrete', 1.2);
      b.frame({ x: 0, bays: 2, bayW: 6, floors: 1, floorH: 3.5 });
    },
  },
  {
    name: 'Conveyor', charges: { cutter: 3, charge: 2, kicker: 1 }, pass: 6, weldStrength: STEEL,
    build: (b) => {
      const a = b.frame({ x: -10, bays: 1, bayW: 4, floors: 1, floorH: 6, mat: 'steel', weld: true });
      const c = b.frame({ x: 10, bays: 1, bayW: 4, floors: 3, floorH: 5, mat: 'steel', weld: true });
      const belt = b.brace(-8, a.top, 8, c.top - 0.2, 'steel', 1);
      b.weld(a.beams[0], belt, -9.5, a.top);
      b.weld(c.beams[2], belt, 9.5, c.top - 0.2);
    },
  },
  {
    name: 'Smokestack', charges: { charge: 3, cutter: 1, kicker: 1 }, pass: 7, protect: [{ kind: 'shop', x: -14, w: 8, h: 7 }],
    build: (b) => {
      b.frame({ x: 0, bays: 1, bayW: 5, floors: 1, floorH: 4, mat: 'steel', weld: true });
      b.blocks(0, 5, 1, 8, 4, 3, 'concrete');
    },
  },
  {
    name: 'Foundry', charges: { cutter: 4, charge: 4, kicker: 1, blaster: 1 }, pass: 8, weldStrength: STEEL,
    protect: [house(-25)], bonus: { type: 'lot', x0: -19, x1: 21 },
    build: (b) => {
      const f = b.frame({ x: 0, bays: 3, bayW: 7, floors: 2, floorH: 6, mat: 'steel', weld: true });
      b.frame({ x: 3.5, y0: f.top, bays: 2, bayW: 7, floors: 1, floorH: 5, mat: 'concrete' });
    },
  },
];

// ---------------------------------------------------------------------------- World 4: Skyline

// concrete frame with glass panels filling some bays
function glassTower(b: Build, x: number, bays: number, bayW: number, floors: number, floorH: number, glassEvery = 1, mat: 'concrete' | 'steel' = 'concrete', weld = false, base = 0) {
  const f = b.frame({ x, y0: base, bays, bayW, floors, floorH, mat, weld });
  for (let fl = 0; fl < floors; fl++) {
    const y0 = base + fl * (floorH + 1);
    for (let bay = 0; bay < bays; bay++) {
      if ((fl + bay) % glassEvery) continue;
      const cx = f.left + (bay + 0.5) * bayW;
      b.add({ x: cx, y: y0 + floorH / 2, w: bayW - 1.15, h: floorH - 0.1, mat: 'glass' });
    }
  }
  return f;
}

const W4: Spec[] = [
  {
    name: 'Glass Box', charges: { charge: 3, imploder: 1 }, pass: 6,
    hint: 'Glass shatters near any blast. The imploder pulls everything toward it: try it high up, on a short fuse.',
    build: (b) => { glassTower(b, 0, 2, 6, 2, 5); },
  },
  {
    name: 'Office', charges: { charge: 5, imploder: 1, kicker: 1 }, pass: 9, protect: [house(-23)],
    build: (b) => { glassTower(b, 0, 3, 6, 4, 5, 2); },
  },
  {
    name: 'Atrium', charges: { charge: 4, imploder: 1, blaster: 1 }, pass: 8,
    build: (b) => {
      glassTower(b, -9, 1, 6, 4, 5);
      glassTower(b, 9, 1, 6, 4, 5);
      b.beam(-12.5, 12.5, 24, 'steel');
    },
  },
  {
    name: 'Spire', charges: { charge: 4, kicker: 1, cutter: 1 }, pass: 10, protect: [{ kind: 'statue', x: 13, w: 4, h: 8 }],
    weldStrength: STEEL,
    build: (b) => {
      const f = glassTower(b, 0, 1, 5, 6, 5, 2);
      b.col(0, f.top, 10, 'steel', 0.8);
    },
  },
  {
    name: 'Hotel', charges: { charge: 6, imploder: 1, kicker: 2 }, pass: 11,
    protect: [house(-34), { kind: 'shop', x: 34, w: 8, h: 7 }],
    designs: [[['charge', -6, 2.5], ['charge', 0, 2.5], ['charge', 6, 2.5], ['charge', -6, 8.5, 0.5], ['charge', 0, 8.5, 0.5], ['charge', 6, 8.5, 0.5], ['imploder', 0, 14.5, 1]]],
    build: (b) => { glassTower(b, 0, 4, 6, 4, 5, 2); },
  },
  {
    name: 'Stadium Lights', charges: { cutter: 2, charge: 2, kicker: 1 }, pass: 6, weldStrength: STEEL,
    protect: [{ kind: 'car', x: 13, w: 7, h: 3.2 }, { kind: 'statue', x: 22, w: 4, h: 8 }],
    hint: 'Steel this tall won’t pancake. Pick a side and make it fall that way.',
    build: (b) => {
      const f = b.frame({ x: 0, bays: 1, bayW: 4, floors: 6, floorH: 5, mat: 'steel', weld: true });
      b.block(0, f.top, 9, 3, 'concrete');
    },
  },
  {
    name: 'Tower Block', charges: { charge: 7, imploder: 2, kicker: 1 }, pass: 12, protect: [house(-40), house(40)],
    build: (b) => { glassTower(b, 0, 2, 6, 7, 5, 3); },
  },
  {
    name: 'The Big One', charges: { charge: 8, cutter: 4, imploder: 2, kicker: 2, blaster: 1 }, pass: 14, weldStrength: STEEL,
    protect: [house(-42), { kind: 'shop', x: 42, w: 8, h: 7 }],
    hint: 'Everything you’ve learned. Take your time.',
    build: (b) => {
      const f = glassTower(b, 0, 3, 6, 5, 5, 2, 'steel', true);
      glassTower(b, 0, 2, 6, 3, 5, 2, 'concrete', false, f.top);
    },
  },
];

function buildAll(): LevelDef[] {
  const all: LevelDef[] = [];
  [W1, W2, W3, W4].forEach((w, wi) => w.forEach((s, i) => all.push(level(wi + 1, i + 1, s))));
  return all;
}

export const LEVELS: LevelDef[] = buildAll();
