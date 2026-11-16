// The au12 Arcade (github.com/au12/arcade). Inside the arcade, Chalkfall plays
// as the arcade's player (each family member keeps their own stars) and its
// results go on the arcade's leaderboards; played on its own with ARCADE_URL
// set on the container, results still count for whoever this browser plays as
// in the arcade. With no arcade, every call does nothing.
//
// vendor/arcade.js is the arcade's SDK, copied unchanged (MIT).
import './vendor/arcade.js';
import type { ArcadeApi, ArcadePlayer } from './vendor/arcade';

export const arcade = (window as unknown as { Arcade: ArcadeApi }).Arcade;
arcade.init({ game: 'chalkfall' });

/** The arcade's player, if one turns up within `ms` (null otherwise). */
export function arcadePlayer(ms = 1500): Promise<ArcadePlayer | null> {
  return Promise.race([arcade.ready, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}
