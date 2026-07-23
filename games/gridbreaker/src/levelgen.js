// Procedural weekly track generator.
// The track is a sequence of ZONES — open grid plains, walled corridors,
// enclosed tunnels — each carrying enemy spawn events (which door they come
// out of, when they fire) and the occasional free-floating soul. Zones are
// generated deterministically from (weeklySeed, zoneIndex): every player
// worldwide races the same track all week — a fair leaderboard contest.
//
// A zone spec is pure data; main.js turns it into meshes + spawn triggers.
//   zone:  { index, type, length, halfWidth, events, souls, obstacles, modifier }
//   event: { z, entrance, kind, fan, fireEvery, engageTime, boltSpeed, hoverX, hoverY }
//     entrance: 'floor' | 'wallL' | 'wallR' | 'above' | 'ceiling'
//     kind: 'drone' | 'warden' (shelled, two hits) | 'turret' (wall-rider)
//   soul:      { z, x, y }
//   obstacle:  { type: 'panewall', z, gapX, gapW }   glass wall, weave the gap
//              { type: 'pylons', items: [{x, z}] }   crystal slalom columns
//   modifier:  null | { kind: 'wind', dir, strength } | { kind: 'fog' }
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
      obstacleChance: ramp(TUNING.difficulty.obstacleChance, index),
      paneGap: ramp(TUNING.difficulty.paneGap, index),
      wardenChance: ramp(TUNING.difficulty.wardenChance, index),
      turretChance: ramp(TUNING.difficulty.turretChance, index),
      fanChance: ramp(TUNING.difficulty.fanChance, index),
      modifierChance: ramp(TUNING.difficulty.modifierChance, index),
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
      let entrance = pool[Math.floor(rng() * pool.length)];
      // pick the breed: turrets ride walls (enclosed zones only), wardens
      // bring a shell; plain drones may fire fan volleys late in the run
      let kind = 'drone';
      if (type !== 'open' && rng() < d.turretChance) {
        kind = 'turret';
        entrance = rng() < 0.5 ? 'wallL' : 'wallR';
      } else if (rng() < d.wardenChance) {
        kind = 'warden';
      }
      events.push({
        z: length * (0.2 + 0.7 * (i + rng() * 0.5) / Math.max(1, n)),
        entrance,
        kind,
        fan: kind === 'drone' && rng() < d.fanChance,
        fireEvery: d.fireInterval * (0.85 + rng() * 0.3) * (kind === 'turret' ? 0.8 : 1),
        engageTime: d.engageTime * (0.8 + rng() * 0.4),
        boltSpeed: d.boltSpeed * (kind === 'turret' ? 0.9 : 1),
        hoverX: (rng() * 2 - 1) * (geo.halfWidth - 1.0),
        hoverY: TUNING.enemies.hoverMinY +
          rng() * (TUNING.enemies.hoverMaxY - TUNING.enemies.hoverMinY),
      });
    }

    // Terrain: glass pane walls with a weave gap (corridor + open zones) and
    // crystal pylon slaloms (open plains). Gate-carrying zones keep their
    // first stretch clear so the acceleration moment stays clean.
    const obstacles = [];
    const hasGate = index > 0 && index % TUNING.gates.everyZones === 0;
    const obMinZ = hasGate ? 14 : 8;
    if (index >= 2 && rng() < d.obstacleChance) {
      if (type === 'open' && rng() < 0.5) {
        const count = 2 + Math.floor(rng() * 3);
        const items = [];
        for (let i = 0; i < count; i++) {
          items.push({
            x: (rng() * 2 - 1) * (geo.halfWidth - 0.9),
            z: obMinZ + (length - obMinZ - 6) * ((i + rng() * 0.6) / count),
          });
        }
        obstacles.push({ type: 'pylons', items });
      } else if (type !== 'tunnel') {
        const gapW = d.paneGap * (0.9 + rng() * 0.3);
        obstacles.push({
          type: 'panewall',
          z: obMinZ + rng() * (length - obMinZ - 8),
          gapX: (rng() * 2 - 1) * (geo.halfWidth - gapW / 2 - 0.4),
          gapW,
        });
      }
    }

    // Zone modifier: a seeded environmental twist, announced at the seam.
    let modifier = null;
    if (index >= 5 && rng() < d.modifierChance) {
      modifier = rng() < 0.55
        ? { kind: 'wind', dir: rng() < 0.5 ? -1 : 1,
            strength: TUNING.modifiers.windStrength * (0.7 + rng() * 0.6) }
        : { kind: 'fog' };
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

    return { index, type, length, halfWidth: geo.halfWidth, events, souls, obstacles, modifier };
  }
}
