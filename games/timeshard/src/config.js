// ============================================================================
// TIMESHARD — central tuning file.
// Every gameplay-feel and difficulty knob lives here so the game can be
// balanced without touching engine code. Units are meters / seconds unless
// noted. You speed down -Z through generated zones (open grid / corridor /
// tunnel). "Game time" = real time × the global time scale: hold a finger
// to slow the world to a crawl.
// ============================================================================

export const TUNING = {
  // --- The track ---------------------------------------------------------------
  track: {
    eyeHeight: 1.7,     // camera height above the grid
    fogNear: 16,
    fogFar: 74,
    horizon: 130,       // how far ahead zones are generated
    cleanupBehind: 12,  // meters behind the camera before things are recycled
  },

  // --- Forward speed (the pace dial) --------------------------------------------
  speed: {
    base: 9.5,          // m/s at run start
    perZone: 0.45,      // added per zone crossed
    max: 24,
  },

  // --- Steering (drag the held finger to weave) ----------------------------------
  steer: {
    sense: 8.5,         // full screen-width drag ≈ this many meters of strafe
    clampPad: 0.6,      // keep this far off the zone walls
    lerp: 10,           // how fast the ship chases the steer target (per s)
    bank: 0.09,         // camera roll per m/s of strafe (the speed feel)
  },

  // --- Time control (THE mechanic) ------------------------------------------------
  time: {
    slowScale: 0.13,    // world speed while you hold — the crawl
    rampDown: 12,       // how fast time collapses into slow-mo (lerp/s)
    rampUp: 7,          // how fast it snaps back to full speed
    focusMax: 3.4,      // seconds of slow-mo in the tank
    focusDrain: 1.0,    // tank drained per real second while slowed
    focusRegen: 0.5,    // tank refilled per real second at full speed
    reengageAt: 0.8,    // empty tank must refill to here before slow-mo works again
  },

  // --- Tap vs hold discrimination (input feel) --------------------------------------
  tap: {
    maxMs: 220,         // a press shorter than this…
    maxMovePx: 16,      // …that moved less than this is a FIRE tap
  },

  // --- The player ----------------------------------------------------------------
  player: {
    shields: 3,         // hits you can take before the run ends
    hitRadius: 0.6,
    invuln: 1.2,        // real seconds of grace after taking a hit
    ammoStart: 14,
    ammoMax: 30,
    shotSpeed: 30,      // muzzle speed of your shard
    shotRadius: 0.14,
    aimDistance: 14,    // tap ray is projected onto a plane this far ahead
    aimAssist: 1.1,     // taps within this distance of a drone snap onto it
    aimAssistBolt: 0.8, // same for enemy bolts (deflection shots)
    maxLiveShots: 8,
    shotTtl: 3,         // game-seconds before a stray shard is recycled
    gravity: -9.81,     // world gravity (shots are ballistic-compensated at aim)
  },

  // --- Enemies (crystal drones out of doors) ----------------------------------------
  enemies: {
    size: 0.5,          // octahedron radius (hitbox derives from this)
    hitboxPad: 0.14,
    engageAhead: 13,    // hover distance ahead of the camera while attacking
    hoverMinY: 1.3,
    hoverMaxY: 3.3,
    doorTime: 0.5,      // game-seconds for a door to slide open
    emergeTime: 0.5,    // game-seconds for the drone to rise/pop out
    diveTime: 0.7,      // game-seconds for an "from above" dive-in
    telegraph: 0.7,     // core-glow warning before each bolt
    scoreKill: 50,
    triggerAhead: 26,   // door starts opening when you're this close
  },

  // --- Ethereal bolts ------------------------------------------------------------------
  bolts: {
    radius: 0.15,       // true (fair) hit path radius
    hitboxPad: 0.22,    // deflection hitbox slack
    maxLive: 12,
    aimLead: 0.85,      // 0..1 how well drones lead your forward motion
    aimJitter: 0.35,
    trailLen: 6,        // comet-trail sprites per bolt
    wobbleAmp: 0.16,    // visual spiral amplitude (path stays straight = fair)
    wobbleFreq: 6.5,
    deflectScore: 40,
  },

  // --- Souls (the ammo economy) ---------------------------------------------------------
  souls: {
    ammoBonus: 3,       // ammo per soul absorbed
    scoreBonus: 15,
    captureRadius: 1.3, // fly this close to absorb
    homingRadius: 4.5,  // souls drift toward you inside this radius…
    homingLerp: 3.0,    // …at this lerp rate (forgiving, not automatic)
    riseHeight: 1.6,    // souls float up to about eye height after a kill
    ambientChance: 0.55,// chance a zone carries a free-floating soul (seeded)
  },

  // --- Scoring ---------------------------------------------------------------------------
  score: {
    perMeter: 1,        // distance is the backbone (speed = survival = skill)
  },

  // --- Shatter / debris ---------------------------------------------------------------------
  shatter: {
    shardsPerDrone: 12,
    impulse: 4.6,
    inheritShot: 0.4,
    ttl: 2.2,
    maxShardBodies: 70, // live physical shards cap (mobile perf guard)
  },

  // --- Difficulty curve (zone index → parameters) ----------------------------------------------
  difficulty: {
    enemiesPerZone: { from: 1,   to: 3.4, at: 12 },
    concurrent:     { from: 1,   to: 3,   at: 14 }, // max drones attacking at once
    boltSpeed:      { from: 7,   to: 13,  at: 16 },
    fireInterval:   { from: 2.7, to: 1.4, at: 18 },
    engageTime:     { from: 5,   to: 8,   at: 15 }, // how long a drone harasses you
    tunnelChance:   { from: 0.15,to: 0.45,at: 10 }, // zones get more claustrophobic
  },

  // --- Weekly level ------------------------------------------------------------------------------
  weekly: {
    // Bump to invalidate old generated layouts when the generator changes.
    generatorVersion: 2,
  },
};

// Linear ramp helper for the difficulty table above.
export function ramp(cfg, zoneIndex) {
  const t = Math.min(1, zoneIndex / cfg.at);
  return cfg.from + (cfg.to - cfg.from) * t;
}

// --- Zone geometry (levelgen + main share these) -----------------------------------
export const ZONES = {
  open:     { halfWidth: 6.0, wallH: 0,   ceiling: 0 },
  corridor: { halfWidth: 3.2, wallH: 4.6, ceiling: 0 },
  tunnel:   { halfWidth: 2.7, wallH: 4.2, ceiling: 4.2 },
};

// --- Palette (frozen ice world at speed; violet-white wisps = danger) ----------------
export const PALETTE = {
  bg: 0x04101c,
  fogFast: 0x1d3d4d,    // pale ice haze at full speed
  fogSlow: 0x220a38,    // deep violet when time crawls
  ice: 0xdff6ff,
  iceEdge: 0x7fdcff,
  gridLine: 0x66e6ff,
  gridMajor: 0xeaffff,
  wisp: 0xc9a6ff,       // bolt trail
  wispCore: 0xffffff,
  wispHalo: 0xff2fd6,   // outer danger halo
  soul: 0xaef7e8,
  soulCore: 0xffffff,
  core: 0xff2fd6,       // drone telegraph
  shard: 0xbfeeff,
  chrome: 0xffffff,
  door: 0x7fdcff,
};
