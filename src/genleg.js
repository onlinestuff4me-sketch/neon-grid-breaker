// ---------------------------------------------------------------------------
// LEG GEOMETRY — the corridor generator, on its own.
//
// Lifted out of main.js unchanged so there is exactly ONE of it. The level
// tool at /tool draws the real layouts by calling this, which means what you
// see in the tool is what the game builds, and a change here cannot show up
// in one and not the other.
//
// It is pure apart from Math.random: the occupancy grid is passed IN rather
// than reached for, so a caller can generate a whole run's worth of legs
// without a game running underneath it.
// ---------------------------------------------------------------------------

import { LEG } from './balance.js';

export const HALL = { cell: LEG.cellM, h: 3.1, wall: 0.3 };

export function genHallLeg(sgx, sgz, proto, grid, straightCells = 7) {
  const cells = [];
  const pillars = [];
  const covers = [];   // low blocks: see over, cannot shoot through
  const add = (gx, gz) => {
    const k = gx + ',' + gz;
    if (!grid.has(k)) { grid.add(k); cells.push([gx, gz]); }
  };
  let gx = sgx, gz = sgz;
  add(gx, gz);
  const spine = [[gx, gz]];
  // Momentum is one-way: every jog is short and always followed by more
  // forward, so no route ever asks you to walk back the way you came.
  const form = (proto && proto.form && proto.form.id) || 'corridor';
  // FORM decides the skeleton: a service run turns constantly, a gauntlet is
  // one long straight with nowhere to hide, an atrium is mostly chamber.
  // The onboarding hallway is dead straight, because every beat of it depends
  // on the player seeing one enemy at the far end from the moment they turn
  // to look. A procedurally jogged corridor cannot promise that.
  const straight = !!(proto && proto.straight);
  const fwd = straight ? straightCells
    : form === 'gauntlet'
      ? LEG.fwdGauntlet + Math.floor(Math.random() * LEG.fwdGauntletVar)
      : LEG.fwdBase + Math.floor(Math.random() * LEG.fwdVar);
  let f = 0, jogs = 0;
  const doorways = [];         // interior openings that get a framed jamb
  const breaks = new Set();    // spine indices that must start a new stretch
  let vaultDone = false;
  while (f < fwd) {
    const run = straight ? 9999
      : form === 'serviceRun'
        ? LEG.runServiceRun + Math.floor(Math.random() * LEG.runServiceVar)
        : form === 'gauntlet'
          ? LEG.runGauntlet + Math.floor(Math.random() * LEG.runGauntletVar)
          : LEG.runBase + Math.floor(Math.random() * LEG.runVar);
    for (let i = 0; i < run && f < fwd; i++) { gz++; f++; add(gx, gz); spine.push([gx, gz]); }
    if (f >= fwd - 4) break;   // leave the tail straight for the door sightline
    // THE VAULT: once per leg, the corridor stops being a corridor. It opens
    // through one framed doorway into a pillared hall and leaves through one
    // more on the far side, offset so crossing the room is the only way on.
    // No branch ever enters it, so there is exactly one way in and one out.
    if (form === 'vault' && !vaultDone && f >= 5) {
      const C = HALL.cell, dp = LEG.vaultDeep;
      // The room does not straddle the entry: it reaches one cell back and
      // the rest toward the exit, so it is an even 4 cells wide with the
      // entry and exit at opposite ends of it.
      const side = Math.random() < 0.5 ? -1 : 1;
      const near = -1, far = LEG.vaultWide - 2;          // -1 .. +2 in exit units
      for (let i = near; i <= far; i++) {
        for (let dz = 1; dz <= dp; dz++) add(gx + side * i, gz + dz);
      }
      doorways.push([gx, gz, 1]);          // in: the face you walk through
      breaks.add(spine.length);            // the room is a stretch of its own
      spine.push([gx, gz + 1]);
      const ex = gx + side * LEG.vaultExitOffset;
      for (let x = gx + side; side > 0 ? x <= ex : x >= ex; x += side) spine.push([x, gz + 1]);
      for (let dz = 2; dz <= dp; dz++) spine.push([ex, gz + dz]);
      // Room centre in metres — 2 m toward the exit side of the entry cell.
      const rcx = gx * C + side * (C / 2), rcz = (gz + (dp + 1) / 2) * C;
      // Four columns 6 m apart, well clear of both doorways and of the lane
      // you cross on: cover you commit to, not cover you walk past.
      for (const ox of [-3, 3]) for (const oz of [-3, 3]) pillars.push([rcx + ox, rcz + oz]);
      // and two LOW blocks in the quadrants the crossing diagonal misses —
      // the first cover in the game you can see over but cannot be shot
      // through, which is a different decision from a column
      covers.push([rcx - 5.5, rcz + 5, LEG.coverLowW, LEG.coverLowD, LEG.coverLowH]);
      covers.push([rcx + 5.5, rcz - 5, LEG.coverLowW, LEG.coverLowD, LEG.coverLowH]);
      gx = ex; gz += dp; f += dp;
      doorways.push([gx, gz, 1]);          // out: the far side of the room
      breaks.add(spine.length);            // and the corridor beyond is another
      vaultDone = true;
      continue;                            // the room replaces this jog
    }
    const jog = 2 + Math.floor(Math.random() * 2);
    const jd = Math.random() < 0.5 ? 1 : -1;
    for (let i = 0; i < jog; i++) { gx += jd; add(gx, gz); spine.push([gx, gz]); }
    jogs++;
  }
  // a leg is never a straight shot: if the rolls gave us none, put a turn
  // in right before the approach so the door is always found around a corner
  // — EXCEPT the onboarding hallway, which is the one leg in the game that is
  // supposed to be a straight shot. This fallback is why "straight" still
  // arrived with a corner in it: `fwd` and `run` were both honoured, the
  // spine came out straight, and then this put three cells of lateral and two
  // more of forward on the end of it because the rolls had produced no jog.
  if (jogs === 0 && !straight) {
    const jd = Math.random() < 0.5 ? 1 : -1;
    for (let i = 0; i < 3; i++) { gx += jd; add(gx, gz); spine.push([gx, gz]); }
    for (let i = 0; i < 2; i++) { gz++; add(gx, gz); spine.push([gx, gz]); }
  }
  // A CHAMBER mid-leg: widen a stretch of spine into a room. Walls are
  // derived from missing neighbours, so simply owning more cells opens the
  // space up — and the corridor gets a rhythm of tight / open / tight.
  const roomCells = [];
  // ...but NOT on the onboarding's hallway. `straight` only controlled the
  // spine, and a corridor leg then had a five-cell chamber with four pillars
  // widened into it and two branch lanes hung off it — which is why the
  // "straight hallway" playtested as a room. One stretch means one stretch.
  const wantsRoom = !straight && (form === 'atrium' || form === 'corridor');
  const roomWide = form === 'atrium' ? 3 : 2;
  if (wantsRoom && spine.length > 10) {
    const i = 3 + Math.floor(Math.random() * Math.max(1, spine.length - 9));
    const [rx, rz] = spine[i];
    for (let dx = -roomWide; dx <= roomWide; dx++) {
      for (let dz = 0; dz <= (form === 'atrium' ? 4 : 3); dz++) {
        const k = (rx + dx) + ',' + (rz + dz);
        if (!grid.has(k)) { grid.add(k); cells.push([rx + dx, rz + dz]); }
        roomCells.push([rx + dx, rz + dz]);
      }
    }
    // Four columns in TWO rows, not two in one. A single row of two on a
    // 320 m2 floor was 0.5% cover — decoration. Two rows also give the
    // spawner two separate shadows to bring enemies out of, since placement
    // prefers a spot with no line of sight to you.
    for (const px of [-1.5, 1.5]) {
      for (const pz of [0.75, 2.25]) {
        pillars.push([(rx + px) * HALL.cell, (rz + pz) * HALL.cell]);
      }
    }
  }

  // the approach: a clean straight run so the door is visible from it
  const APPROACH = LEG.approach;
  for (let i = 0; i < APPROACH; i++) { gz++; add(gx, gz); spine.push([gx, gz]); }
  // Branches: alternate routes that only ever move FORWARD and rejoin the
  // spine further along — a choice of lane, never a detour backwards.
  // A vault gets none: a branch lane cutting into the room would give it a
  // second way in, and the whole point is one door in and one door out.
  const branches = straight || form === 'gauntlet' || form === 'vault' ? 0
    : form === 'serviceRun' ? 3 : 2;
  for (let b = 0; b < branches; b++) {
    const i = 1 + Math.floor(Math.random() * Math.max(1, spine.length - 9));
    const j = Math.min(spine.length - 1 - APPROACH, i + 4 + Math.floor(Math.random() * 4));
    const [ax, az] = spine[i], [bx, bz] = spine[j];
    if (bz <= az + 1) continue;
    const side = Math.random() < 0.5 ? 2 : -2;
    const ss = Math.sign(side), ox = ax + side;
    for (let x = ax + ss; x !== ox + ss; x += ss) add(x, az);
    for (let z = az; z <= bz; z++) add(ox, z);
    if (bx !== ox) for (let x = ox; x !== bx; x += Math.sign(bx - ox)) add(x, bz);
  }
  // the last APPROACH cells in walking order — a straight run with the door
  // at its end, where the final enemies stage so you watch it open as they
  // shatter. approach[0] is where the run begins; the last is at the slab.
  const approach = spine.slice(spine.length - APPROACH);
  return { cells, spine, approach, stretches: splitStretches(spine, APPROACH, breaks),
    doorways, pillars, covers, endGx: gx, endGz: gz };
}

export function splitStretches(spine, approachLen, breaks) {
  const body = spine.slice(0, Math.max(1, spine.length - approachLen));
  const out = [];
  let cur = [], wasLateral = false;
  for (let i = 0; i < body.length; i++) {
    const lateral = i > 0 && body[i][1] === body[i - 1][1];
    const forced = breaks && breaks.has(i);
    if ((forced || (!lateral && wasLateral)) && cur.length) { out.push(cur); cur = []; }
    cur.push(body[i]);
    wasLateral = lateral;
  }
  if (cur.length) out.push(cur);
  out.push(spine.slice(spine.length - approachLen));
  // z span per stretch: what counts as "you are in it", and which cells of
  // the leg (branch lanes and chambers included) may spawn for it
  return out.map((c) => ({
    cells: c,
    z0: Math.min(...c.map((p) => p[1])) * HALL.cell,
    z1: Math.max(...c.map((p) => p[1])) * HALL.cell,
  }));
}
