// ============================================================================
// GRIDBREAKER — central tuning file.
// Every gameplay-feel and difficulty knob lives here so the game can be
// balanced without touching engine code. Units are meters / seconds unless
// noted. The camera flies down -Z; the corridor is centered on X=0.
// ============================================================================

export const TUNING = {
  // --- The corridor ---------------------------------------------------------
  corridor: {
    halfWidth: 3.2,     // playable half-width (walls sit just outside)
    eyeHeight: 1.7,     // camera height above the floor
    fogNear: 26,
    fogFar: 95,
    horizon: 130,       // how far ahead rooms are generated
  },

  // --- Forward speed (the core difficulty ramp) -----------------------------
  speed: {
    base: 7.5,          // m/s at the start of a run
    perRoom: 0.16,      // added per room cleared
    max: 24,            // hard cap
  },

  // --- Balls (ammo) ----------------------------------------------------------
  balls: {
    start: 20,          // ammo at run start
    crashPenalty: 8,    // balls lost when you fly into unbroken glass
    radius: 0.17,
    throwSpeed: 36,     // muzzle speed of a throw
    aimDistance: 34,    // tap ray is projected onto a plane this far ahead
    maxLive: 14,        // active thrown balls before oldest is recycled
    gravity: -9.81,     // world gravity — real ballistics, learn the drop!
  },

  // --- Multiball streak (the mastery mechanic, à la Smash Hit) --------------
  multiball: {
    streakPerTier: 10,  // consecutive crystals to gain +1 ball per throw
    maxPerThrow: 5,
    spread: 0.24,       // lateral spacing between simultaneous balls
  },

  // --- Crystals (ammo pickups) -----------------------------------------------
  crystal: {
    ballBonus: 3,       // balls refunded per crystal smashed
    roomInterval: 2,    // a crystal appears roughly every N rooms
    scoreBonus: 25,
  },

  // --- Scoring ---------------------------------------------------------------
  score: {
    perMeter: 1,        // distance is the score backbone (skill = survival)
    glassPane: 12,      // per pane shattered
    comboWindow: 1.4,   // seconds between breaks that chain a combo
    comboMax: 8,        // combo multiplier cap on glass points
  },

  // --- Shatter / debris ------------------------------------------------------
  shatter: {
    cols: 4,            // fracture grid resolution across a pane
    rows: 5,
    jitter: 0.55,       // 0..1 irregularity of fracture cells
    impulse: 5.5,       // radial burst strength at the impact point
    impulseFalloff: 1.6,// how quickly burst fades away from impact
    inheritBall: 0.55,  // fraction of ball velocity passed into shards
    ttl: 2.6,           // seconds before a shard fades away
    maxShardBodies: 90, // active physical shards before oldest fade early
  },

  // --- Difficulty curve ------------------------------------------------------
  // Room index -> parameters. All ramps are linear with a cap; tweak the
  // `at` values to move where the game gets hard.
  difficulty: {
    // fraction of the corridor blocked by "wall" patterns
    blockage:   { from: 0.35, to: 0.9,  at: 40 },
    // moving-pane speed multiplier
    movement:   { from: 0.5,  to: 1.6,  at: 50 },
    // chance a room uses a hard pattern instead of an easy one
    hardChance: { from: 0.0,  to: 0.75, at: 45 },
    // rooms get slightly shorter (denser) over time
    roomLength: { from: 20,   to: 13,   at: 60 },
  },

  // --- Weekly level ----------------------------------------------------------
  weekly: {
    // Bump to invalidate old generated layouts when the generator changes.
    generatorVersion: 1,
  },
};

// Linear ramp helper for the difficulty table above.
export function ramp(cfg, roomIndex) {
  const t = Math.min(1, roomIndex / cfg.at);
  return cfg.from + (cfg.to - cfg.from) * t;
}

// --- Palette (TRON / synthwave) ---------------------------------------------
export const PALETTE = {
  bg: 0x05010f,
  fog: 0x0a0220,
  gridCyan: 0x00eaff,
  gridMagenta: 0xff2fd6,
  glass: 0x7fe9ff,
  glassEdge: 0x00eaff,
  crystal: 0x25ffc8,
  crystalEdge: 0x9dffe9,
  sun: 0xff9de0,
  chrome: 0xffffff,
};
