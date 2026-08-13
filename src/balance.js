// ---------------------------------------------------------------------------
// BALANCE — the single source of truth for every tunable number.
//
// The game imports these; docs/BALANCE.md is GENERATED from this file by
// `node tools/gen-balance-doc.mjs`, and the Balance Tuner artifact mirrors
// the same shape. Change a value here and nothing can drift out of step.
// ---------------------------------------------------------------------------

// A weapon holds `mag` bullets per clip and up to `maxClips` spares. Reload
// burns one spare and runs on REAL time, so freezing the world never refills
// a gun. Picking up a weapon you already carry adds a clip. Empty everything
// and you drop to the knife.
export const WEAPONS = {
  knife: { cd: 0.42, melee: 2.0, mag: Infinity, maxClips: 0, reload: 0, kick: 0.6 },
  pistol: { cd: 0.22, pellets: 1, spread: 0, kick: 1, speed: 46, mag: 5, maxClips: 3, reload: 1.0 },
  shotgun: { cd: 0.55, pellets: 6, spread: 0.055, kick: 1.8, speed: 46, mag: 2, maxClips: 3, reload: 1.5 },
  burst: { cd: 0.5, pellets: 1, spread: 0.012, kick: 1.6, speed: 52, mag: 2, maxClips: 3, reload: 1.4, burst: 3, burstGap: 0.09 },
  sniper: { cd: 0.9, pellets: 1, spread: 0, kick: 2.4, speed: 95, pierce: 3, mag: 2, maxClips: 3, reload: 1.75 },
  launcher: { cd: 0.9, pellets: 1, spread: 0, kick: 2.6, speed: 26, mag: 2, maxClips: 3, reload: 2.0, blast: 5.5 },
  rocket: { cd: 1.2, pellets: 1, spread: 0, kick: 3, speed: 34, mag: 2, maxClips: 3, reload: 2.35, blast: 8 },
};

// One debut per wave: the wave (or tunnel door) each type first appears on.
export const TYPE_INTRO = {
  gunner: 1, rusher: 2, shotgunner: 3, shieldbearer: 4, heavy: 5,
  sniper: 6, bomber: 7, armored: 9, rocketeer: 11, laser: 12,
};

// Veteran fill after the debut: [share, cap] -> min(cap, floor(total/share)).
export const TYPE_SHARE = {   // veteran shooter fill: floor(total/share), capped
  shotgunner: [4, 4], heavy: [5, 3], shieldbearer: [8, 2],
  sniper: [7, 2], bomber: [6, 2], armored: [9, 2], rocketeer: [8, 2],
};

// The weapon each enemy was carrying — what they leave on the floor.
export const TYPE_DROP = {
  shotgunner: 'shotgun', sniper: 'sniper', heavy: 'burst',
  bomber: 'launcher', rocketeer: 'rocket', armored: 'burst',
};

// Drops and collection. There is no magnet: a drop stays where it fell, so
// crossing the room for it is a real decision. PICKUP_R is generous enough
// that walking over it always works.
export const DROPS = {
  clipRate: 0.34,      // chance a non-weapon kill leaves a pistol clip
  life: 12,            // seconds on the floor (last 1.2 s it sinks)
  pickupR: 2.0,        // walk this close and it is yours
};

// The difficulty ramp. diffT() runs 0 -> 1 across `rampWaves`, and bullet
// speed, telegraph length and slow-mo cost all read from it.
export const RAMP = {
  rampWaves: 11,       // waves until full heat (wave 12)
  bulletBase: 11,      // reference enemy bullet speed, m/s
  bulletFloor: 0.55,   // fraction of reference on wave 1
  bulletRange: 0.45,   // added across the ramp
  bulletCap: 1.35,     // hard ceiling including the late-game creep
  lateCreep: 0.02,     // per wave past the ramp
  aimBase: 1.15,       // telegraph/cooldown scale on wave 1
  aimRange: 0.63,      // subtracted across the ramp
  drainFloor: 0.55,    // slow-mo cost on wave 1
  drainRange: 0.45,    // added across the ramp
  rushDrain: 0.4,      // Rush Hour drains flat, all run
  sightGrace: 0.45,    // seconds seen before a telegraph may begin
};

// Wave size and mix.
export const COMP = {
  baseTotal: 6, perWave: 2, totalCap: 30,
  rusherFrac: 0.4,     // share of the wave once rushers debut
  debutFrac: 0.2,      // share for the type debuting this wave
  gunnerFloor: 0.25,   // minimum share reserved for plain gunners
};

// THE TUNNEL LEG, stretch by stretch.
//
// A leg is a chain of STRETCHES — one straight run plus the turn that ends
// it — followed by the APPROACH, the straight stare down at the door. The
// leg's enemy count is not a number picked per door and then dribbled out on
// a clock: it is the sum of what each stretch is worth. A stretch's share is
// released when you WALK INTO it, so the fight travels with you and nothing
// can pile up in front of the door. The approach is worth exactly one group:
// the final wave you clear with the door in frame.
export const LEG = {
  cellM: 4,            // metres per corridor cell — stretch lengths are in these
  fwdBase: 16, fwdVar: 6,          // forward cells in a normal leg
  fwdGauntlet: 22, fwdGauntletVar: 5,
  runBase: 3, runVar: 3,           // cells between turns: one stretch's straight
  runServiceRun: 2, runServiceVar: 2,
  runGauntlet: 6, runGauntletVar: 4,
  approach: 4,                     // straight cells in front of the door
  // The leg's size comes from how much corridor there is to fight in, not
  // from how many turns it happens to have — otherwise a zig-zagging service
  // run, which is SHORTER to walk, would be the bigger fight. Budget by cell,
  // then split it between the stretches in proportion to their length.
  perCell: 0.5,                    // bodies per corridor cell at door 1
  perCellPerDoor: 0.05,            // ...growing this much per door
  perCellCap: 0.9,                 // ...to this ceiling
  stretchMin: 2, stretchCap: 4,    // no stretch is ever emptier or fuller
  finaleWave: 3,                   // the one final group waiting at the door
  lookahead: 1,                    // stretches past yours that may also spawn
  spawnMin: 9,                     // nearest a corridor spawn may appear (m)
  spawnMax: 40,                    // and the furthest
};

// How fast the room refills. `fill` is live enemies / alive cap.
export const PACING = {
  hallAliveBase: 3, hallAliveCap: 6,
  cityAliveBase: 6, cityAliveCap: 10,
  hallEmptyGap: 0.9,   // gap after clearing the corridor
  hallFullGap: 1.4, hallFillGap: 2.2,
  cityBaseGap: 0.7, cityFillGap: 2.6,
  killPullMin: 0.5, killPullRange: 0.9,   // a kill pulls the next spawn in
  aheadMin: 4,         // never spawn closer than this in front (m)
};

// The slow-mo bank.
export const TIME = {
  base: 5,             // seconds at wave start (and the floor each wave)
  bonus: 2,            // seconds refunded per kill
  cap: 10,             // bank ceiling
  drain: 1,            // seconds spent per second frozen, before scaling
  slowScale: 0.05,     // world speed while standing still
  moveScale: 0.3,      // world speed at full stick
};
