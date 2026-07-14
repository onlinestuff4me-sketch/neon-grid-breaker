// Procedural weekly level generator.
// Rooms are generated deterministically from (weeklySeed, roomIndex), so the
// endless layout is identical for every player during a given ISO week —
// that's what makes the weekly leaderboard a fair skill contest.
//
// A room spec is pure data; main.js turns it into meshes + physics bodies.
//   pane:    { type:'pane', x, y, z, w, h, blocking, motion? }
//   crystal: { type:'crystal', x, y, z }
// z is relative to the room start (0 .. length, increasing = deeper).
// motion: { kind:'slide'|'spin', speed, range, phase }

import { TUNING, ramp } from './config.js';
import { mulberry32, hashString } from './rng.js';

const PANE_H = 3.4; // full wall height

export class LevelGen {
  constructor(seed) {
    this.seed = seed;
  }

  roomRng(index) {
    return mulberry32(hashString(`${this.seed}:${index}`));
  }

  nextRoom(index) {
    const rng = this.roomRng(index);
    const d = {
      blockage: ramp(TUNING.difficulty.blockage, index),
      movement: ramp(TUNING.difficulty.movement, index),
      hardChance: ramp(TUNING.difficulty.hardChance, index),
      length: ramp(TUNING.difficulty.roomLength, index),
    };
    const length = d.length + rng() * 4;
    const items = [];

    // First rooms are a gentle on-ramp: free glass, then one easy wall.
    let pattern;
    if (index === 0) pattern = 'floaters';
    else if (index === 1) pattern = 'wall_gap';
    else if (index === 2) pattern = 'floaters';
    else {
      const hard = rng() < d.hardChance;
      const pool = hard
        ? ['window_grid', 'slider', 'spinner', 'double_wall', 'wall_gap']
        : ['floaters', 'wall_gap', 'pillars', 'floaters'];
      pattern = pool[Math.floor(rng() * pool.length)];
    }

    PATTERNS[pattern](items, rng, d, length);

    // Ammo economy: drop a crystal near the entrance of every Nth room so it
    // is reachable before the room's obstacles.
    if (index > 0 && index % TUNING.crystal.roomInterval === 0) {
      items.push({
        type: 'crystal',
        x: (rng() * 2 - 1) * (TUNING.corridor.halfWidth - 1.2),
        y: 1.3 + rng() * 1.2,
        z: 2.5 + rng() * 2,
      });
    }

    return { index, length, pattern, items };
  }
}

// --- Pattern library ---------------------------------------------------------

function pane(items, x, y, z, w, h, blocking, motion = null) {
  items.push({ type: 'pane', x, y, z, w, h, blocking, motion });
}

const PATTERNS = {
  // Free-floating decorative panes — pure joy, no threat. Early-game filler.
  floaters(items, rng, d, length) {
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const w = 0.9 + rng() * 1.2;
      const h = 0.9 + rng() * 1.2;
      pane(
        items,
        (rng() * 2 - 1) * (TUNING.corridor.halfWidth - w / 2 - 0.3),
        0.8 + h / 2 + rng() * (2.6 - h),
        length * (0.25 + 0.65 * (i / n)),
        w, h, false
      );
    }
  },

  // A wall of vertical strips with a survivable gap. Gap shrinks with
  // difficulty (d.blockage → less open corridor).
  wall_gap(items, rng, d, length) {
    buildGapWall(items, rng, d, length * 0.62);
  },

  // Two staggered gap walls close together — forces a fast line change.
  double_wall(items, rng, d, length) {
    buildGapWall(items, rng, d, length * 0.45);
    buildGapWall(items, rng, d, length * 0.8);
  },

  // 3x3 grid of small panes covering the middle of the corridor.
  window_grid(items, rng, d, length) {
    const cols = 3, rows = 3;
    const w = 1.5, h = 1.05;
    const x0 = -w * (cols - 1) / 2;
    const y0 = 0.75;
    const z = length * 0.6;
    // one random cell left open at low difficulty
    const open = d.blockage < 0.7 ? Math.floor(rng() * cols * rows) : -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r * cols + c === open) continue;
        pane(items, x0 + c * w, y0 + h / 2 + r * h, z, w - 0.06, h - 0.06, true);
      }
    }
  },

  // Wide pane sliding across the corridor — timing challenge.
  slider(items, rng, d, length) {
    const w = 2.2 + rng() * 0.6;
    pane(items, 0, PANE_H / 2, length * 0.6, w, PANE_H - 0.2, true, {
      kind: 'slide',
      speed: (0.9 + rng() * 0.5) * d.movement,
      range: TUNING.corridor.halfWidth - w / 2 + 1.4,
      phase: rng() * Math.PI * 2,
    });
  },

  // Narrow blade swinging from a top pivot (screen-plane rotation) — smash it
  // or time your pass for when it's out of the lane.
  spinner(items, rng, d, length) {
    pane(items, 0, 1.65, length * 0.6, 1.0 + rng() * 0.3, 2.8, true, {
      kind: 'spin',
      speed: (0.8 + rng() * 0.6) * d.movement,
      range: 0,
      phase: rng() * Math.PI * 2,
    });
  },

  // Narrow full-height pillars to weave between (or smash through).
  pillars(items, rng, d, length) {
    const n = 2 + (rng() < d.blockage ? 1 : 0);
    const slots = shuffledSlots(rng, 5);
    for (let i = 0; i < n; i++) {
      const x = (slots[i] - 2) * (TUNING.corridor.halfWidth * 0.45);
      pane(items, x, PANE_H / 2, length * (0.4 + 0.35 * (i / n)), 0.95, PANE_H, true);
    }
  },
};

function buildGapWall(items, rng, d, z) {
  const W = TUNING.corridor.halfWidth;
  const strips = 4;
  const stripW = (W * 2) / strips;
  const gap = Math.floor(rng() * strips);
  for (let i = 0; i < strips; i++) {
    const x = -W + stripW * (i + 0.5);
    if (i === gap) {
      // At high blockage the "gap" strip is half-covered, leaving a window
      // you have to duck through — or just smash it.
      if (d.blockage > 0.65) {
        const topHalf = rng() < 0.5;
        const h = PANE_H * 0.5;
        pane(items, x, topHalf ? PANE_H - h / 2 : h / 2, z, stripW - 0.05, h, true);
      }
      continue;
    }
    pane(items, x, PANE_H / 2, z, stripW - 0.05, PANE_H, true);
  }
}

function shuffledSlots(rng, n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
