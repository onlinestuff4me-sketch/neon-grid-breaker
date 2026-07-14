// Procedural weekly "moment" generator.
// A moment is one frozen diorama: crystal drones hanging in the air plus a
// few bolts already mid-flight. Moments are generated deterministically from
// (weeklySeed, momentIndex) so every player worldwide unpicks the same
// sequence of moments all week — the weekly leaderboard is a fair contest.
//
// A moment spec is pure data; main.js turns it into meshes + physics bodies.
//   drone: { x, y, z, fireEvery, fireAt, strafe: { amp, speed, phase } }
//   bolt:  { x, y, z, speed }   (aimed at the player from spawn)
// z is positive "meters ahead of the player" (main.js negates for world -Z).

import { TUNING, ramp } from './config.js';
import { mulberry32, hashString } from '../../../shared/rng.js';

export class MomentGen {
  constructor(seed) {
    this.seed = seed;
  }

  momentRng(index) {
    return mulberry32(hashString(`${this.seed}:${index}`));
  }

  nextMoment(index) {
    const rng = this.momentRng(index);
    const A = TUNING.arena;
    const d = {
      droneCount: Math.round(ramp(TUNING.difficulty.droneCount, index)),
      boltSpeed: ramp(TUNING.difficulty.boltSpeed, index),
      fireInterval: ramp(TUNING.difficulty.fireInterval, index),
      initialBolts: Math.floor(ramp(TUNING.difficulty.initialBolts, index) + rng() * 0.8),
      strafeAmp: ramp(TUNING.difficulty.strafeAmp, index),
      strafeSpeed: ramp(TUNING.difficulty.strafeSpeed, index),
    };

    // Place drones with rejection sampling (deterministic: fixed attempt order).
    const drones = [];
    let attempts = 0;
    while (drones.length < d.droneCount && attempts < 80) {
      attempts++;
      const p = {
        x: (rng() * 2 - 1) * A.halfWidth,
        y: A.minY + rng() * (A.maxY - A.minY),
        z: A.droneMinZ + rng() * (A.droneMaxZ - A.droneMinZ),
      };
      const tooClose = drones.some((o) => {
        const dx = o.x - p.x, dy = o.y - p.y, dz = o.z - p.z;
        return dx * dx + dy * dy + dz * dz < A.minSpacing * A.minSpacing;
      });
      if (tooClose) continue;
      drones.push({
        ...p,
        fireEvery: d.fireInterval * (0.85 + rng() * 0.3),
        // Stagger first shots so volleys arrive as a readable sequence.
        fireAt: 0.7 + rng() * d.fireInterval,
        strafe: {
          amp: d.strafeAmp * (0.6 + rng() * 0.8),
          speed: d.strafeSpeed * (0.7 + rng() * 0.6),
          phase: rng() * Math.PI * 2,
        },
      });
    }

    // Bolts already frozen mid-air: each sits partway along the line from a
    // random drone to the player — the "walk into a bullet storm" tableau.
    const bolts = [];
    for (let i = 0; i < d.initialBolts && drones.length > 0; i++) {
      const from = drones[Math.floor(rng() * drones.length)];
      const f = 0.35 + rng() * 0.35; // fraction of the way toward the player
      bolts.push({
        x: from.x * (1 - f) + (rng() * 2 - 1) * 0.3,
        y: from.y * (1 - f) + TUNING.arena.eyeHeight * f,
        z: from.z * (1 - f),
        speed: d.boltSpeed,
      });
    }

    return { index, drones, bolts, boltSpeed: d.boltSpeed };
  }
}
