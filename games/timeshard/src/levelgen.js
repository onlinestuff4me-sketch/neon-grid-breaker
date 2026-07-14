// Procedural weekly track generator.
// The track is a sequence of ZONES — open grid plains, walled corridors,
// enclosed tunnels — each carrying enemy spawn events (which door they come
// out of, when they fire) and the occasional free-floating soul. Zones are
// generated deterministically from (weeklySeed, zoneIndex): every player
// worldwide races the same track all week — a fair leaderboard contest.
//
// A zone spec is pure data; main.js turns it into meshes + spawn triggers.
//   zone:  { index, type, length, halfWidth, events, souls }
//   event: { z, entrance, fireEvery, engageTime, boltSpeed, hoverX, hoverY }
//     entrance: 'floor' | 'wallL' | 'wallR' | 'above' | 'ceiling'
//   soul:  { z, x, y }
// z is local to the zone start (0..length, increasing = deeper).

import { TUNING, ZONES, ramp } from './config.js';
import { mulberry32, hashString } from '../../../shared/rng.js';

const ENTRANCES = {
  open: ['floor', 'above', 'floor', 'above'],
  corridor: ['floor', 'wallL', 'wallR'],
  tunnel: ['wallL', 'wallR', 'ceiling', 'floor'],
};

export class TrackGen {
  constructor(seed) {
    this.seed = seed;
  }

  zoneRng(index) {
    return mulberry32(hashString(`${this.seed}:${index}`));
  }

  nextZone(index) {
    const rng = this.zoneRng(index);
    const d = {
      enemies: ramp(TUNING.difficulty.enemiesPerZone, index),
      boltSpeed: ramp(TUNING.difficulty.boltSpeed, index),
      fireInterval: ramp(TUNING.difficulty.fireInterval, index),
      engageTime: ramp(TUNING.difficulty.engageTime, index),
      tunnelChance: ramp(TUNING.difficulty.tunnelChance, index),
    };

    // Zone type: always open the run on a calm plain; afterwards alternate so
    // two tunnels never chain (breathing room is part of the rhythm).
    let type;
    if (index === 0) type = 'open';
    else {
      const roll = rng();
      if (roll < d.tunnelChance) type = 'tunnel';
      else if (roll < d.tunnelChance + 0.35) type = 'corridor';
      else type = 'open';
    }
    const geo = ZONES[type];
    const length = 42 + rng() * 26;

    // Enemy events, spread through the zone with breathing room at the seam.
    const events = [];
    const n = index === 0 ? 1 : Math.round(d.enemies + (rng() - 0.5) * 0.6);
    const pool = ENTRANCES[type];
    for (let i = 0; i < n; i++) {
      const entrance = pool[Math.floor(rng() * pool.length)];
      events.push({
        z: length * (0.2 + 0.7 * (i + rng() * 0.5) / Math.max(1, n)),
        entrance,
        fireEvery: d.fireInterval * (0.85 + rng() * 0.3),
        engageTime: d.engageTime * (0.8 + rng() * 0.4),
        boltSpeed: d.boltSpeed,
        hoverX: (rng() * 2 - 1) * (geo.halfWidth - 1.0),
        hoverY: TUNING.enemies.hoverMinY +
          rng() * (TUNING.enemies.hoverMaxY - TUNING.enemies.hoverMinY),
      });
    }

    // Ambient soul: a free ammo wisp floating on the track (mercy economy —
    // you can never be truly ammo-dead for long).
    const souls = [];
    if (rng() < TUNING.souls.ambientChance) {
      souls.push({
        z: length * (0.25 + rng() * 0.5),
        x: (rng() * 2 - 1) * (geo.halfWidth - 1.2),
        y: 1.2 + rng() * 1.4,
      });
    }

    return { index, type, length, halfWidth: geo.halfWidth, events, souls };
  }
}
