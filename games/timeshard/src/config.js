// ============================================================================
// TIMESHARD — central tuning file.
// Every gameplay-feel and difficulty knob lives here so the game can be
// balanced without touching engine code. Units are meters / seconds unless
// noted. The player stands at the origin looking down -Z into the diorama.
// "Game time" = real time × the global time scale (the core mechanic).
// ============================================================================

export const TUNING = {
  // --- The arena --------------------------------------------------------------
  arena: {
    eyeHeight: 1.6,     // camera height (the player is a fixed observer)
    fogNear: 10,
    fogFar: 52,
    droneMinZ: 5,       // nearest a drone may spawn (meters ahead of you)
    droneMaxZ: 15,      // deepest a drone may spawn
    halfWidth: 3.0,     // lateral spawn spread (portrait screen keeps this narrow)
    minY: 1.0,          // drone altitude band
    maxY: 3.4,
    minSpacing: 1.9,    // minimum distance between spawned drones
  },

  // --- Time control (THE mechanic) --------------------------------------------
  time: {
    idleScale: 0.02,    // world speed while you do nothing — the frozen crawl
    rampUp: 9,          // how fast time accelerates when you act (lerp/s)
    rampDown: 14,       // how fast the world re-freezes (snappier = punchier)
    shotPulse: 0.55,    // seconds of full flow granted after firing, so your
                        // shard actually flies — every action pushes time
  },

  // --- The player ---------------------------------------------------------------
  player: {
    shields: 3,         // hits you can take before the run ends
    hitRadius: 0.55,    // how close a bolt must get to hurt you
    mercyRadius: 5,     // on a hit, incoming bolts inside this radius vaporize
    shotSpeed: 24,      // muzzle speed of your shard
    shotRadius: 0.14,
    aimDistance: 11,    // tap ray is projected onto a plane this far ahead
    maxLiveShots: 10,   // active shards before oldest is recycled
    shotTtl: 3.5,       // game-seconds before a stray shard is recycled
    gravity: -9.81,     // world gravity (shots are ballistic-compensated at aim)
  },

  // --- Crystal drones -------------------------------------------------------------
  drones: {
    size: 0.5,          // octahedron radius (hitbox derives from this)
    hitboxPad: 0.12,    // extra hitbox slack — generous aim feels fair on touch
    bobAmp: 0.22,       // idle hover amplitude
    bobSpeed: 1.3,
    telegraph: 0.8,     // game-seconds of core-glow warning before firing
    scoreEach: 30,      // points per drone shattered
  },

  // --- Enemy bolts -----------------------------------------------------------------
  bolts: {
    radius: 0.16,       // visual radius
    hitboxPad: 0.16,    // deflection hitbox slack (they're small + satisfying)
    maxLive: 14,        // hard cap on live bolts (perf + fairness)
    aimJitter: 0.22,    // spread on drone aim so volleys aren't a single line
    deflectScore: 40,   // points for shooting a bolt out of the air
  },

  // --- Scoring: clear each moment in the least flowed time ---------------------------
  score: {
    momentBase: 100,    // flat points for clearing a moment
    timeBonusMax: 150,  // bonus at a perfect (instant) clear
    parFreeSeconds: 3.0,// flowed time that costs no bonus
    timeBonusDrain: 20, // bonus lost per flowed second beyond par
  },

  // --- Shatter / debris ---------------------------------------------------------------
  shatter: {
    shardsPerDrone: 12, // rigid ice shards a drone bursts into
    impulse: 4.6,       // radial burst strength
    inheritShot: 0.4,   // fraction of shard-shot velocity passed into debris
    ttl: 2.4,           // seconds before a shard fades away
    maxShardBodies: 70, // live physical shards cap (mobile perf guard)
  },

  // --- Difficulty curve (moment index → parameters) -----------------------------------
  difficulty: {
    droneCount:   { from: 2,   to: 6,   at: 14 },
    boltSpeed:    { from: 4.0, to: 8.5, at: 16 },
    fireInterval: { from: 3.4, to: 1.8, at: 18 },
    initialBolts: { from: 0,   to: 3,   at: 10 }, // bolts already frozen mid-air
    strafeAmp:    { from: 0.2, to: 1.1, at: 15 }, // lateral drone drift
    strafeSpeed:  { from: 0.5, to: 1.2, at: 15 },
  },

  // --- Weekly level ------------------------------------------------------------------
  weekly: {
    // Bump to invalidate old generated moments when the generator changes.
    generatorVersion: 1,
  },
};

// Linear ramp helper for the difficulty table above.
export function ramp(cfg, momentIndex) {
  const t = Math.min(1, momentIndex / cfg.at);
  return cfg.from + (cfg.to - cfg.from) * t;
}

// --- Palette (frozen ice world; magenta = danger, chrome = you) ----------------------
export const PALETTE = {
  bg: 0x04101c,
  fogFrozen: 0x1d3d4d,  // pale ice haze while time crawls
  fogFlow: 0x220a38,    // deep violet once time runs
  ice: 0xdff6ff,
  iceEdge: 0x7fdcff,
  gridLine: 0x66e6ff,
  gridMajor: 0xeaffff,
  bolt: 0xff2fd6,
  core: 0xff2fd6,
  shard: 0xbfeeff,
  chrome: 0xffffff,
};
