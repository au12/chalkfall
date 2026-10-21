// Chalkfall tuning. World units are "feet" on the board; frames are ~1 ft thick, 4-12 ft long.

export const PHYS_HZ = 60;                 // fixed simulation ticks per second
export const TIME_SCALE = 0.9;             // a touch of slow motion: collapses feel heavy
export const SUB_STEPS = 4;
export const GRAVITY = -25;
export const DT = TIME_SCALE / PHYS_HZ;    // simulated seconds per tick

export const SETTLE_MAX_S = 11;            // after the last charge: give up waiting after this
export const SETTLE_QUIET_S = 0.9;         // everything slow for this long = settled
export const SETTLE_SPEED = 0.25;          // "slow" (ft/s)

export const MIN_PIECE = 0.3;              // shorter remainders crumble into dust
export const STUB_LEN = 2.2;               // blasted remainders shorter than this lose their joints
export const DAMAGE_SPEED = 5.5;           // a frame touching a neighbour faster than this (ft/s) damages it
export const DAMAGE_LEN = 2;               // ...if it is at least this long (crumbs don't count)
export const BREAK_MIN_LEN = 3;            // pieces shorter than this never snap on impact
export const CHARGE_GRID = 0.5;           // charges snap to this spacing along a frame
export const CHARGE_SPACING = 1.4;         // min distance between charges on one frame

// collision categories
export const CAT = { GROUND: 1, FRAME: 2, SHARD: 4, PROTECTED: 8, SENSOR: 16 } as const;

export type MaterialId = 'wood' | 'concrete' | 'steel' | 'glass' | 'stone';

export interface Material {
  id: MaterialId;
  name: string;
  density: number;
  friction: number;
  restitution: number;
  shatters?: boolean;     // glass: breaks into shards near any blast
  breakSpeed: number;     // impacts faster than this snap long pieces (Infinity = never)
  cutBy: ChargeKind[];    // charge kinds that cut it
}

export const MATERIALS: Record<MaterialId, Material> = {
  wood:     { id: 'wood', name: 'Timber', density: 1.0, friction: 0.75, restitution: 0.06, breakSpeed: 15, cutBy: ['charge', 'cutter'] },
  concrete: { id: 'concrete', name: 'Concrete', density: 2.2, friction: 0.85, restitution: 0.02, breakSpeed: 15, cutBy: ['charge', 'cutter'] },
  steel:    { id: 'steel', name: 'Steel', density: 3.4, friction: 0.5, restitution: 0.08, breakSpeed: Infinity, cutBy: ['cutter'] },
  glass:    { id: 'glass', name: 'Glass', density: 1.4, friction: 0.35, restitution: 0.05, shatters: true, breakSpeed: 6, cutBy: ['charge', 'cutter'] },
  stone:    { id: 'stone', name: 'Reinforced', density: 2.6, friction: 0.9, restitution: 0.02, breakSpeed: Infinity, cutBy: [] },
};

export type ChargeKind = 'charge' | 'blaster' | 'cutter' | 'kicker' | 'imploder';

export interface ChargeSpec {
  kind: ChargeKind;
  name: string;
  blurb: string;
  cutLength: number;        // length of frame removed (0 = no cut)
  blowout: number;          // sideways kick (ft/s) given to the posts it severs
  radius: number;           // effect radius
  speed: number;            // velocity kick (ft/s) at the charge, fading to 0 at the radius
  shatterRadius: number;    // glass within this range shatters
}

export const CHARGES: Record<ChargeKind, ChargeSpec> = {
  charge:   { kind: 'charge', name: 'Charge', blurb: 'Cuts timber, concrete and glass, with a solid kick.', cutLength: 1.6, blowout: 7, radius: 5, speed: 14, shatterRadius: 4 },
  blaster:  { kind: 'blaster', name: 'Blaster', blurb: 'No cut, huge shove. Clears rubble and knocks things flying.', cutLength: 0, blowout: 0, radius: 9, speed: 24, shatterRadius: 7 },
  cutter:   { kind: 'cutter', name: 'Cutter', blurb: 'Slices even steel and pops the cut post out. Tiny blast.', cutLength: 0.7, blowout: 8, radius: 1.5, speed: 2.5, shatterRadius: 1.2 },
  kicker:   { kind: 'kicker', name: 'Kicker', blurb: 'Shoves everything nearby one way. Tap it to aim.', cutLength: 0, blowout: 0, radius: 5.5, speed: 0, shatterRadius: 2 },
  imploder: { kind: 'imploder', name: 'Imploder', blurb: 'Pulls everything around it inward for a tidy collapse.', cutLength: 0, blowout: 0, radius: 9, speed: 0, shatterRadius: 3 },
};

export const KICK_SPEED = 9;               // ft/s added at the kicker, fading with distance
export const IMPLODE_TICKS = 18;           // the pull lasts this many ticks
export const IMPLODE_DV = 12;              // total pull (ft/s) right at the imploder, fading to 0 at its radius
export const IMPLODE_VERT = 0.6;           // vertical share of the pull

export const FUSES = [0, 0.5, 1, 1.5, 2];  // selectable delays (seconds of game time)

export const CHARGE_ORDER: ChargeKind[] = ['charge', 'blaster', 'cutter', 'kicker', 'imploder'];
