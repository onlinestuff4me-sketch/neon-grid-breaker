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
  // Superhot runs these at 19-34 m/s while you move; we deliberately do NOT
  // match that. This is a nudge (+27%), not a conversion — the power
  // fantasy depends on rounds you can still read and walk out of.
  bulletBase: 16,      // reference enemy bullet speed, m/s
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
  // THE VAULT ROOM (form: vault). The corridor opens through ONE doorway
  // into a pillared hall and leaves through ONE more on the far side, offset
  // so you have to cross it. It is its own stretch, so it gets its own share
  // of the wave, and the pillars are the only real cover in the leg.
  // Width is the axis a portrait phone cannot show. Our camera is 80 deg
  // VERTICAL, which at 390x844 is only 42.4 deg horizontal — a third of the
  // reference's 90. Visible width is 0.776*distance, so from the entry of a
  // 16 m-deep room you frame 12.4 m of the far wall: a 20 m room hides 8 m of
  // itself permanently. So the room is 4 cells, and the budget that would
  // have gone into floor area goes into HEIGHT and COVER instead, which are
  // the two axes portrait actually shows.
  vaultWide: 4,                    // cells across (16 m), offset toward the exit
  vaultDeep: 4,                    // cells deep (16 m)
  vaultDoorW: 2.6,                 // doorway opening (m) — wider than a checkpoint
  vaultExitOffset: 2,              // cells the exit sits off the entry line
  vaultSpawnMin: 6,                // spawnMin would push refills out of the room
  // Columns are RECTANGULAR, wide face across the crossing axis. A 0.9 m
  // square at 3 m gives +/-0.29 m of lateral slack — you are not actually
  // hidden. 1.3 m wide gives +/-0.56 m, which is cover you can use.
  pillarW: 1.3, pillarD: 0.7,      // column footprint (m), x by z
  pillarsChamber: 4,               // two rows, not one: each row is a spawn shadow
  // GRADED COVER. Everything in the tunnel was floor-to-ceiling, so every
  // occluder was binary. These are not. The height is exact, not a taste
  // call: the enemy's sight ray and his muzzle both sit at 1.35 m and the
  // player's eye at 1.6 m, so 1.45 m blocks him completely while you see
  // over it and shoot down. segAABB is 3D so this needs no engine change,
  // and pointInObstacle is 2D so you still cannot walk over it.
  coverLowH: 1.45, coverLowW: 3.2, coverLowD: 1.6,
  // Half the portrait frame is ceiling and it was one flat slab. Drop beams
  // between the light strips: the soffit lands at 2.80 m, which is exactly
  // the clear height measured off the reference.
  beamDrop: 0.3, beamW: 0.45,
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

// VISIBILITY, and the condition that changes it.
//
// FOG was registered as shipped and was never implemented: `cond` was only
// ever compared against 'dimStrips', so a fog leg rendered as a plain
// corridor while the archive told the player "Visibility twelve metres". This
// is the mechanism it should always have had.
//
// The number that governs safety is LEG.spawnMin. A body is born 9-40 m away
// and the door opens only on an empty floor, so a far plane below the spawn
// floor means enemies are born invisible and a leg can become unfinishable.
// `farFloor` therefore derives the minimum from the spawn distance rather
// than trusting a hand-picked number to stay correct if spawnMin ever moves.
export const VIS = {
  hallNear: 14, hallFar: 55,     // the ordinary corridor
  fogNear: 3,                    // close enough to feel like it is on you
  fogFar: 12,                    // exactly what the archive line promises
  farMargin: 3,                  // ...and never nearer than spawnMin + this

  // BLACKOUT is about LIGHT, not distance. Pulling the far plane down to the
  // 8 m the design note first asked for would put the ENTIRE 9-40 m spawn
  // range outside sight, so every body would be born invisible; and edge
  // arrows cannot cover it, because their 19.5 deg bearing threshold sits
  // just inside the ~21 deg screen half-width, so an enemy dead ahead gets no
  // arrow and no pixels. Dead ahead is the common case in a corridor.
  //
  // So the corridor goes dark and stays legible, and the freeze is what buys
  // back the distance. That is the design intent — it changes what stopping
  // time is FOR — delivered without making the baseline a soft-lock.
  blackNear: 2,
  blackFar: 20,                  // dark, but every spawn is still findable
  blackFrozenFar: 40,            // stop time and the corridor opens up
  // Spacing has to be read against blackFar, not chosen for sparseness. At 8
  // cells (32 m) and then at 5 (20 m) the next surviving strip sat at or past
  // the fog plane, so it was fogged to nothing and the corridor read as
  // "unlit" rather than "emergency lighting" — no landmark, nothing to move
  // between. At 4 cells the next one is 16 m out, inside the 20 m range.
  // Sparseness is not what makes this a blackout: the darkened surfaces, the
  // near-black fog colour and the cut light intensity are.
  blackLitEvery: 4,              // cells between surviving strips (normal: 2)
  blackLight: 0xff8c3a,          // emergency amber, deliberately NOT signal red
  // The fog COLOUR matters as much as its distance. Left at the corridor's
  // pale daylight blue, a blacked-out corridor fades into a bright haze that
  // reads as light at the end of the tunnel — the opposite of the intent.
  blackFog: 0x0d1418,            // near-black, faintly cold
  hallFog: 0xa8cadb,             // the ordinary corridor's air
  blackSurface: 0.34,            // colour multiplier on the corridor surfaces
  blackFrozenSurface: 0.62,      // ...lifted by the freeze, with everything else
  blackAmbient: 0.30,            // light multiplier while blacked out
  blackFrozenAmbient: 0.52,      // ...lifted with the freeze, like the fog
  // A flat metres-per-second rate is wrong here: the same rate has to cover a
  // 3 m change and a 43 m one, and at any speed that suits the small change
  // the big one takes ~17 s to arrive. Eased on a time constant instead, so
  // every leg change lands in about the same 1.3 s however far it travels.
  tau: 0.45,                     // seconds; ~95% of the way in 3 tau
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

// ===========================================================================
// SCARCITY — the primary balance levers, and the reason the game gets good
// ===========================================================================
//
// The loop the game is actually about:
//
//   limited AMMO forces you to hide, pick your shots, and freeze time to
//   line them up  ->  limited TIME forces you to hoard the freeze, so when
//   you spend it you make it count  ->  out of both, you close with a knife
//   and freezing time is the only way to land the jab.
//
// A beginner sprays and never notices. The moment ammo gets tight the whole
// game turns into resource management, and that is the fun. So these four
// curves are the top-level dials, and everything else is detail:
//
//   1. how often ammo drops
//   2. how fast the time bank fills and empties
//   3. how many enemies a leg holds in total
//   4. how many come at you at once
//
// Doors 1-3 stay generous — that is where you learn to spray. 4-6 tighten.
// By 8 you are counting rounds and hoarding the freeze.
//
// Each curve is keyframes of [door, multiplier], linearly interpolated, and
// flat outside its ends. Read them as "at door N, multiply the base by M".
export const SCARCITY = {
  // x DROPS.clipRate. Generous while learning, then the tap closes.
  ammoDrop:   [[1, 1.45], [3, 1.25], [5, 0.9], [8, 0.55], [12, 0.4]],
  // x the per-type weapon drop chance — a floor gun matters more when the
  // clips stop coming, so this falls more slowly than ammo does.
  weaponDrop: [[1, 1.2], [3, 1.05], [6, 0.85], [10, 0.7]],
  // x TIME.bonus — seconds of bank refunded per kill.
  timeGain:   [[1, 1.0], [3, 1.0], [6, 0.8], [8, 0.62], [12, 0.5]],
  // x the drain rate while frozen. Above 1 the bank empties faster.
  timeDrain:  [[1, 1.0], [3, 1.0], [6, 1.15], [8, 1.35], [12, 1.6]],
  // x the leg's body budget (LEG.perCell) — total enemies in the level.
  legSize:    [[1, 1.0], [4, 1.05], [8, 1.15], [12, 1.25]],
  // x maxAlive — how many can be on you at once. This is the one that
  // decides whether a fight is a queue or a swarm, so it moves least.
  groupSize:  [[1, 1.0], [4, 1.1], [8, 1.25], [12, 1.4]],
};

// Linear interpolation across the keyframes, flat before the first and after
// the last. Door numbers are 1-based.
export function scarcity(curve, door) {
  const k = SCARCITY[curve];
  if (!k || !k.length) return 1;
  if (door <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (door <= k[i][0]) {
      const [d0, v0] = k[i - 1], [d1, v1] = k[i];
      return v0 + (v1 - v0) * ((door - d0) / (d1 - d0));
    }
  }
  return k[k.length - 1][1];
}

// SHATTER. Every value here used to be a literal buried in main.js, which
// meant the one thing the game is named after could not be tuned.
//
// Sizes are SCALE MULTIPLIERS on the shared tetrahedron (circumradius 0.12,
// so edge = 0.196 x scale). The reference breaks a body into 50-70 pieces of
// 3-10 cm, median 4 cm — a spray of shattered ceramic. Ours were 26 pieces of
// 10-27 cm, which read as chunks of meat.
export const SHATTER = {
  pool: 512,           // instanced slots; oldest is recycled on overflow
  assemblePool: 768,   // materialising enemies get their own, so a big fight
                       // cannot starve the effect the game opens with
  perKill: 52,
  sparkBody: 14, sparkWall: 6,
  // TWO SIZE CLASSES IN ONE BURST. The all-small version read as sand; the
  // all-big original read as chunks of meat. A body throws both: recognisable
  // pieces you can follow, inside a spray of grit.
  chunkFrac: 0.34,                                // share that are big pieces
  chunkMin: 0.5, chunkVar: 0.9,                   // the original 10-27 cm
  gritMin: 0.15, gritVar: 0.36, gritCurve: 2.2,   // 3-10 cm, weighted small
  speedBase: 2.2, speedVar: 3.2, speedCurve: 2,   // the original's looser spray
  impulse: 1.6, impulseVar: 2.0,                  // along the killing blow
  rise: 1.5,           // upward bias: the cloud sits above the wound
  drag: 0.6,           // enough to settle, not enough to stop it dead
  spin: 10,            // rad/s per axis
  life: 2.8, lifeVar: 1.0,
  breakWindow: 0.05,   // seconds of WORLD time the body crumbles over
  restitution: 0.32, friction: 0.6, angDamp: 0.5,
  // RED ONLY. The amber and near-white flecks were read off the reference,
  // but in the reference they are a FIRE TELEGRAPH burning on the body at the
  // moment it breaks — not a property of the debris. Ours have no such
  // telegraph, so hot pieces were just confetti.
  colBright: 0xff2d1a, colDark: 0xc61703, colDeep: 0x8f2018,
  ratioBright: 0.55, ratioDark: 0.32,   // remainder = deep
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
