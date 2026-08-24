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

// ---------------------------------------------------------------------------
// BULLET SPEED IS A STAIRCASE, NOT A SLOPE.
//
// It used to be a line: floor + range x diffT, a new speed every single wave.
// Nobody acclimatises to a number that never sits still — each door was a
// little faster than the one before it and no speed was ever the speed you
// had learned. So it steps instead, and each tread is wide enough to stand
// on: five doors at 5.4, five at 5.8, then a tread every couple of doors.
//
// The staircase also decides WHEN THE POWER ARRIVES. Slow time is not handed
// out on a door number picked by hand — it is unlocked by the speed reaching
// `unlockM`, the point at which walking out of a round stops being enough.
// Then the staircase STOPS for `schoolDoors` while that is taught (see
// SCHOOL below), and starts climbing again on the far side.
export const SPEED = {
  openM: 5.4,          // m/s for the opening doors. Crosses a 16 m room in
                       // three seconds: a round you watch coming and walk out
                       // of, before anybody has been given a way to slow it.
  openDoors: 5,
  holdM: 5.8,          // ...one tread up, held just as long
  holdDoors: 5,
  stepM: 0.2,          // ...then a tread this tall
  stepDoors: 1,        // ...every this many doors. ONE, not two: at two the
                       // staircase took 81 doors to reach `unlockM`, which is
                       // about an hour of play before slow time — the game's
                       // whole identity — appears at all. Halving the tread
                       // WIDTH rather than doubling its HEIGHT keeps every
                       // step the same size underfoot and just stops spending
                       // two doors on each.
  // WHERE THE POWER LANDS. Not a door number — a speed. `unlockDoor()` below
  // solves for the door the staircase reaches it on, and the STAND HERE
  // corridor, the time button and the meter all key off that one answer, so
  // dragging any tread above moves the whole lesson with it.
  // 13 m/s: the speed the OLD ramp topped out at (16 x 0.79 = 12.64), which is
  // the number the power was implicitly balanced against before any of this.
  // Lands on door 46 — see docs/BALANCE.md for the solve.
  unlockM: 13,
  schoolDoors: 10,     // ...and the staircase holds there for this many doors
                       // while slow time is taught. See SCHOOL.
  capM: 21.6,          // hard ceiling. Superhot runs 19-34 m/s while you move;
                       // we deliberately do NOT match that. The power fantasy
                       // depends on rounds you can still read.
};

// THE DIALS, MADE SAFE TO READ. The RAMP pane in /tool drives these from
// sliders and its export can be hand-edited and pasted back, so every value
// below arrives from outside. A tread of zero made `unlockDoor()` return
// Infinity and `speedAt()` return NaN past the gate; a negative tread made
// rounds travel backwards; an `unlockM` at or below `holdM` collapsed the
// solve to the first tread and made the staircase DROP at the unlock. None of
// those is a shape anyone wants — they are just what the arithmetic does with
// numbers nobody clamped.
function dials(S) {
  const stepM = Math.max(0.01, +S.stepM || 0.01);
  const holdM = Math.max(0.1, +S.holdM || 0.1);
  return {
    openM: Math.max(0.1, +S.openM || 0.1),
    openDoors: Math.max(0, S.openDoors | 0),
    holdM,
    holdDoors: Math.max(0, S.holdDoors | 0),
    stepM,
    stepDoors: Math.max(1, S.stepDoors | 0),
    // the unlock must be at least one tread ABOVE the tread it is measured from
    unlockM: Math.max(holdM + stepM, +S.unlockM || holdM + stepM),
    schoolDoors: Math.max(0, S.schoolDoors | 0),
    capM: Math.max(0.1, +S.capM || 0.1),
  };
}

// The door the staircase first reaches `unlockM` on — and so the door the
// slow-time lesson stands in. Derived, never typed.
export function unlockDoor(S = SPEED) {
  const v = dials(S);
  const first = v.openDoors + v.holdDoors + 1;
  // INTEGER ARITHMETIC, BECAUSE THE FLOAT KIND GETS THIS WRONG. `ceil((13 -
  // 5.8) / 0.2)` happens to be exactly 36, but `(8.4 - 3) / 0.15` is
  // 36.00000000000001, which ceils one tread too high and puts the unlock two
  // doors after the staircase actually reached the speed. Across the pane's
  // own slider grids that is thousands of reachable combinations answering
  // "the door it FIRST reaches unlockM on" with a door that is not it. Scale
  // to integers and the question has an exact answer.
  const num = Math.round((v.unlockM - v.holdM) * 1e6);
  const den = Math.round(v.stepM * 1e6);
  const treads = Math.max(1, Math.ceil(num / den));
  return first + (treads - 1) * v.stepDoors;
}

// Enemy bullet speed in m/s on door `d`. The only reader of SPEED.
// `school` false skips the plateau — rush hour has no doors and no school.
export function speedAt(d, S = SPEED, school = true) {
  const v = dials(S);
  const n = isFinite(d) ? Math.max(1, d) : 1;
  const first = v.openDoors + v.holdDoors + 1;
  const gate = unlockDoor(S);
  const hold = school ? v.schoolDoors : 0;
  if (n <= v.openDoors) return v.openM;
  if (n < first) return v.holdM;
  if (n < gate) return v.holdM + v.stepM * (Math.floor((n - first) / v.stepDoors) + 1);
  // THE UNLOCK SPEED OCCUPIES A TREAD LIKE ANY OTHER, and the school extends
  // that tread rather than replacing it. Getting this wrong is an off-by-one
  // in either direction: count the plateau as `hold` exactly and the door
  // AFTER the school repeats the unlock speed (a twelve-door plateau where the
  // dial says ten); add one unconditionally and a school of zero doors makes
  // `speedAt(gate)` come out a tread ABOVE unlockM, so the door the unlock is
  // solved from is not the door that has the speed. One `max` answers both.
  const plateau = Math.max(hold, v.stepDoors);
  if (n < gate + plateau) return v.unlockM;
  const past = Math.floor((n - gate - plateau) / v.stepDoors) + 1;
  return Math.min(v.capM, v.unlockM + v.stepM * past);
}

// The difficulty ramp. diffT() runs 0 -> 1 across `rampWaves`, and telegraph
// length and slow-mo cost read from it. Bullet speed does NOT — see SPEED.
export const RAMP = {
  rampWaves: 18,       // waves until full heat. Was 11 — the opening now runs
                       // on far fewer bodies, so the rest has room to take
                       // longer over the same distance.
  aimBase: 1.15,       // telegraph/cooldown scale on wave 1
  aimRange: 0.63,      // subtracted across the ramp
  drainFloor: 0.55,    // slow-mo cost on wave 1
  drainRange: 0.45,    // added across the ramp
  rushDrain: 0.4,      // Rush Hour drains flat, all run
  sightGrace: 0.45,    // seconds seen before a telegraph may begin
};

// THE FIRST FEW DOORS ARE A METRONOME, NOT A FIGHT.
//
// Playtest: "only have 1 enemy appear per room and per hallway leg; only use
// gunners for the first 5 doors; and each enemy must wait to shoot until
// after the previous bullet has passed the player before another is fired. We
// need the player to get a feel for the game rhythm before we add more
// enemies or more enemy types."
//
// That rhythm -- see him, watch the round leave, step out of it, shatter him
// -- is the whole game in four beats, and it cannot be learned while three
// people are shooting at you. So the opening doors deal it out one beat at a
// time and then get out of the way.
// ---------------------------------------------------------------------------
// THE OPENING RAMP
//
// Every dial below moves on the same shape, and it is the shape a person
// actually learns on: hold a value for a while, step up by one, then hold the
// NEXT value for LONGER. The bands widen, so each new number gets more room
// than the one before it — which is the opposite of a curve that compounds,
// and the reason the old one had a cliff at door 5 (one body at door 4, a
// leg wanting twenty-four at door 5).
//
//   ramp(d, first) — value 1 covers doors 1..first, value 2 the next first+1,
//   value 3 the next first+2, and so on.
//
// Four dials, moved on four different schedules on purpose. "More rooms",
// "more bodies", "more of them at once" and "they shoot sooner" must never
// arrive on the same door: one change per step is the whole idea.
export function ramp(d, first) {
  let v = 1, from = 1, width = first;
  while (d >= from + width) { from += width; width++; v++; }
  return v;
}
export const OPENING = {
  legsEvery: 4,        // rooms/corridors behind one door: 1 for doors 1-4,
                       // 2 for 5-9, 3 for 10-15, 4 for 16-22, 5 for 23-30...
  bodiesEvery: 2,      // bodies in the WHOLE door: 1 for 1-2, 2 for 3-5,
                       // 3 for 6-9, 4 for 10-14, 5 for 15-20, 6 for 21-27...
  // (There is no separate "bodies per leg" dial. A door's budget is split
  //  evenly across its legs, remainder to the last of them, so the per-leg
  //  count is a RESULT — 1 while a door holds one, 2 when a single-leg door
  //  holds two, and back to 1 the moment the door grows a second leg. A dial
  //  on top of that could only ever clip the budget: an early version capped
  //  door 3 at one body per leg, which turned it back into door 1.)
  aliveEvery: 3,       // how many may be up at once: 1 for 1-3, 2 for 4-8,
                       // 3 for 9-15, 4 for 16-24...
  corridorDoors: 3,    // no rooms at all before this: one shape to learn first
  legsCap: 5,
  // THE ROOM'S SHOT FLOOR, in world seconds. Three seconds between one enemy
  // firing and the next for the first ten doors — long enough to deal with
  // each round as its own event — then closing to the reflex gap the deep
  // game runs on.
  gapDoors: 10,        // ...held flat until here
  gapFrom: 3.0,
  gapTo: 0.28,
  gapBy: 25,           // ...and all the way down by this door
  // HOW LONG A MAN WILL ACTUALLY WAIT HIS TURN, past the gap, before firing
  // anyway. There has to be a ceiling — without one a crowd can hold each
  // other into never firing at all — but it used to be a flat 0.6 s, which is
  // SHORTER THAN THE GAP for every door up to about 20. Measured at door 8,
  // where the gap says three seconds: real intervals of 1.95, 0.4, 0.05, 0.05,
  // 0.2, 0.3. Two rounds five hundredths apart is the "one loud event you
  // cannot parse" this floor exists to prevent, on the doors written to
  // prevent it. The ceiling is the gap plus this, so the gap is what decides
  // and this is only the deadlock guard it was always meant to be.
  holdSlack: 0.6,
};

export const EARLY = {
  gunnerOnlyDoors: 5,  // no other type may debut before this door
  oneRoundDoors: 5,    // and only one enemy round may be in the air at once
};

// ---------------------------------------------------------------------------
// THE SLOW-TIME SCHOOL — the doors that follow the unlock.
//
// A power you are never made to want is a button you never press. For the
// first seventy doors the answer to a round is to walk out of it, and that
// answer keeps working; handing over the time button changes nothing on its
// own. So the doors right after it are built to ASK the question:
//
//   * they fire in VOLLEYS — several men at once, which is the one shape a
//     sidestep cannot solve, because there is no side that is out of all of
//     them;
//   * the men in a volley stand CLOSE TOGETHER, so the answer to it — slow
//     time, swing across the group, shatter them — refills the meter it cost;
//   * and the meter is CHEAP here, because the lesson is "this is what it is
//     for", not "this is what it costs".
//
// And it has a mercy rule. Running the bank dry in a room that only volleys
// is a hole you cannot climb out of: no meter, no answer, and the next volley
// arrives anyway. So an empty bank CALMS THE ROOM — back to one round in the
// air at a time, the rhythm from the opening doors, which is survivable by
// walking and gives the kills back. When the bank is worth spending again the
// volleys return, and the reminder comes with them.
// HOW MANY FIRE TOGETHER on school door `d` (0-based into the school), or 0
// if that door is not one. Exported so main.js and the RAMP pane read the same
// function rather than each keeping a copy of the ramp.
export function volleyAt(d, S = SPEED, SC = null) {
  const C = SC || SCHOOL;
  if (d < 0 || d >= Math.max(0, S.schoolDoors | 0)) return 0;
  const t = Math.min(1, d / Math.max(1, C.volleyBuild));
  return Math.max(2, Math.min(C.volley, 2 + Math.floor((C.volley - 2) * t)));
}

export const SCHOOL = {
  volley: 3,           // men who fire together once the school is in session
  // ...REACHED OVER THIS MANY DOORS, FROM 2 — and it now takes that long.
  // The ramp was `round(2 + (volley-2) * d/volleyBuild)`, which with volley 3
  // and volleyBuild 4 rounds up at d = 2, so a dial reading "four doors"
  // delivered the full volley on the second one.
  volleyBuild: 4,
  volleyGap: 2.4,      // world seconds between one volley and the next
  // ...AND THE SPACING INSIDE ONE. Not zero. The school starts the telegraphs
  // of a volley on the same frame, so with no floor at all they finished on
  // the same frame too and three rounds left three muzzles simultaneously —
  // one loud event you cannot parse, which is the exact thing the room's shot
  // floor exists to prevent. A fifth of a second apart still reads as one
  // volley and reads as three men.
  volleySpread: 0.18,
  clusterM: 4.5,       // how close a volley stands: a group you can sweep
  spare: 1,            // ...plus this many, so a leg always holds a volley AND
                       // somebody left to shoot once it has been answered
  drainMul: 0.45,      // slow time costs this fraction of normal here
  bonusMul: 2,         // ...and a kill pays back this much more
  // THE MERCY RULE, in seconds left on the bank.
  dryAt: 0.35,         // at or below this, the room calms to single rounds
  wetAt: 2.5,          // ...and does not volley again until it is back to this
  calmGap: 3.0,        // the calm room's gap: the opening doors' metronome
  // VOLLEYS SURVIVED WITHOUT TOUCHING THE BUTTON before the reminder comes
  // back. The counter starts PRIMED at this value, so the first volley of the
  // school — and the first one after a dry spell — is spoken to; using the
  // button zeroes it, which buys this many quiet volleys before the game says
  // anything again.
  remindAfter: 1,
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
  // A LEG THAT NAMES A ROOM HAS TO AFFORD ONE. The opening ramp gives a leg
  // one or two bodies, and a leg whose headline says PILLARS ARE YOUR ONLY
  // COVER needs one of them standing in the pillars AND one waiting at the
  // door — otherwise reserving the room just empties the approach and moves
  // the anticlimax. This is a floor, not a bonus: a leg already dealt two or
  // more is untouched, and a leg that promises nothing never sees it. It is
  // the only addition to OPENING's budget anywhere in the game.
  featureFloor: 2,
  // ...and how long the man in that room waits. He is placed while the player
  // is a stretch short of the room so they SEE him assemble, then holds his
  // fire and his ground until they actually cross in. Without the hold he
  // walks out to meet them in the corridor and the room is empty again by the
  // time anybody reaches it.
  featureArmGrace: 0.35,           // world seconds after entry before he fires
  // ---------------------------------------------------------------------
  // THE STALL WATCHDOG — nothing is happening, and that is never all right.
  //
  // A player standing in a corridor with a live enemy who will not engage,
  // or with a queue that will not release, has no way to tell a lull from a
  // broken game. They have no reason to walk INTO a room that has just
  // killed them, and both onboarding prompts are gated on somebody aiming —
  // so in exactly the state where a player is lost, the game has nothing to
  // say. This is the floor under all of that: if a measured number of world
  // seconds pass with no enemy aiming, no round in the air, nobody closing
  // and nobody arriving, the game makes something happen.
  //
  // In WORLD seconds, so a player holding the world still is not nagged.
  // ---------------------------------------------------------------------
  stallAfter: 4.5,                 // ...of nothing at all before it steps in
  stallCloseM: 0.35,               // less movement than this is "not closing"
  stallReachM: 2.0,                // added to the distance when it opens a
                                   // reluctant enemy's engage radius
  spawnMin: 9,                     // nearest a corridor spawn may appear (m)
  spawnMax: 40,                    // and the furthest
};

// VISIBILITY, and the conditions that change it.
//
// FOG was registered as shipped and was never implemented: `cond` was only
// ever compared against 'dimStrips', so a fog leg rendered as a plain
// corridor while the archive told the player "Visibility twelve metres".
//
// The first working version was then too kind to be a condition at all. A
// body is born 9-40 m away (LEG.spawnMin/spawnMax) and the door opens only on
// an empty floor, so the far plane was floored at spawnMin + margin to keep
// every enemy visible from birth -- which pinned fog at 12 m, i.e. exactly
// the distance at which nothing about the fight changes. Playtest: "there's
// plenty of visibility, they don't feel different enough from normal."
//
// The floor is now only enforced on the REVEALED state. Unfrozen, you see
// almost nothing; frozen, you always see at least spawnMin + margin, so the
// freeze is what makes a leg finishable and stopping time stops being purely
// defensive. Enemies outside sight are not lost, they are reduced to a
// CONTACT -- one fog-exempt pinprick at head height that gives you a bearing
// and nothing else: not what they are, not how far, not where the head is.
export const VIS = {
  hallNear: 14, hallFar: 55,     // the ordinary corridor

  // FOG. Close enough to be on you. The freeze does not lift it -- it bores a
  // TUNNEL through it, clear down the middle of the screen and still soup at
  // the edges, so seeing means pointing.
  fogNear: 2,
  fogFar: 6,
  fogFrozenFar: 22,
  // Fog gets its own colour, darker and greyer than the corridor's own air.
  // At the corridor's pale daylight blue a fogged frame measured BRIGHTER
  // than a clear one (161.7 against 154.6 mean luminance) -- the screen lit
  // up when visibility fell, which is exactly backwards.
  fogCol: 0x93a3ab,
  fogAmbient: 0.82,

  farMargin: 3,                  // the revealed state never goes below spawnMin + this

  // BLACKOUT is about LIGHT, not distance -- the surfaces, the fog colour and
  // the light rig all come down together, and the freeze lifts all three at
  // once behind a night-vision grade. Distance comes down too, now that the
  // freeze is guaranteed to buy it back.
  blackNear: 0.8,
  blackFar: 7,
  blackFrozenFar: 30,
  // THERE IS NO EMERGENCY LIGHTING. Three passes tried to keep some -- the
  // full ceiling recess in amber, then a batten, then a smaller batten -- and
  // the playtest rejected every one by the same name: "the yellow overhead
  // lights are jarringly wrong here, either should be a dark gray or just
  // removed". Right, and for a reason worth writing down: a light that is ON
  // is a promise the room can be read, and a blackout's whole proposition is
  // that it cannot.
  //
  // So the fixtures stay, at the corridor's own rhythm and in its own shape,
  // in a dark unlit grey. They are ceiling detail you notice when the freeze
  // brings the lights up, and they read as exactly what they are: panels that
  // are switched off. What lights a blackout now is gunfire -- see MUZZLE.
  blackLitEvery: 2,              // the ordinary corridor's rhythm
  blackLight: 0x23272c,          // a panel that is off, not a panel that is amber
  // The fog COLOUR matters as much as its distance. Left at the corridor's
  // pale daylight blue, a blacked-out corridor fades into a bright haze that
  // reads as light at the end of the tunnel -- the opposite of the intent.
  blackFog: 0x060a0d,            // near-black, faintly cold
  hallFog: 0xa8cadb,             // the ordinary corridor's air
  blackSurface: 0.15,            // colour multiplier on the corridor surfaces
  blackFrozenSurface: 0.50,      // ...lifted by the freeze, with everything else
  blackAmbient: 0.14,            // light multiplier while blacked out
  blackFrozenAmbient: 0.50,      // ...lifted with the freeze, like the fog

  // MUZZLE FLASH. With no emergency lighting, gunfire is the only thing that
  // lights a dark corridor -- yours and theirs alike, which makes firing a
  // real decision: every shot you take shows you the room and shows them you.
  // Point lights are created ONCE at boot and never added or removed, because
  // changing a scene's light count recompiles every material in it, and doing
  // that on the frame someone pulls a trigger is the exact stall this project
  // keeps hunting. They idle at zero intensity instead.
  // THREE, not more. Every extra light is a per-fragment term in every lit
  // material for the whole run, not just while it is flashing -- three
  // compiles against the light COUNT. Three covers the realistic overlap (you
  // and one shooter, or a burst weapon's stutter) and stops there.
  muzzleLights: 3,               // how many can overlap
  muzzleRange: 26,               // metres
  muzzleColor: 0xffd9a0,
  muzzleLife: 0.085,             // seconds, real time
  muzzlePlain: 2.2,              // intensity in an ordinary corridor
  muzzleDark: 9.0,               // ...and in fog or a blackout, where it matters

  // CONTACTS: what is left of an enemy you cannot see. Fades in across the
  // far plane so it never competes with a body you can already read.
  // Where a contact starts to show, as a fraction of the far plane. FOG is
  // limited by DISTANCE, so it starts at the edge of sight. BLACKOUT is
  // limited by LIGHT: a body at 6 m is inside the 10 m plane and still
  // unreadable at 0.15 surface brightness, so waiting for the plane would
  // leave a band where he is neither visible nor marked. It starts close.
  contactInFog: 0.76,
  contactInBlack: 0.34,
  contactOut: 1.02,              // ...and where it is fully up
  contactSize: 0.30,             // metres; a pinprick at 30 m, still small at 8
  contactY: 1.55,                // head height, so it reads as a person
  contactFogCol: 0xe6f2f8, contactFogAmt: 0.7,
  contactBlackCol: 0xff6a24, contactBlackAmt: 0.95,

  // THE REVEAL. Both conditions get a screen-space grade while time is
  // stopped, so the freeze looks like equipment rather than a fog slider.
  // NIGHT VISION is a multiply (tint + vignette + scanlines) plus an additive
  // phosphor grain; the FOG TUNNEL is the fog colour alpha-blended back over
  // everything outside a soft central disc.
  nvTint: 0x2bff5e,              // multiply at the centre: kills red and blue
  nvEdge: 0x05200e,              // ...and at the rim, which is the vignette
  nvScan: 0.14,                  // scanline depth
  nvGlow: 0x2bff7a, nvGrain: 0.13,
  tunnelR0: 0.30, tunnelR1: 1.10, tunnelMax: 0.97,
  gradeTau: 0.20,                // seconds; the grade comes up faster than the air

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
// THE GRINDER — the first element that attacks the slow-mo mechanic itself.
//
// A sanitation unit spanning the whole width of the leg, walking toward the
// door behind you with two counter-rotating blade drums. Contact kills
// instantly. It runs on REAL time and therefore DOES NOT STOP WHILE TIME IS
// FROZEN, because it is the building, not a person -- which is the whole
// point of it. Every second you spend frozen lining up a shot is a second of
// ground given away, so the freeze stops being free and starts being a trade.
//
// It is not an obstacle, deliberately. A moving solid box would resolve the
// player out of itself and could eject them to the wrong side; a lethal plane
// cannot, and "you cannot go back" is expressed by the fact that going back
// kills you rather than by a collision the player can fight.
export const GRIND = {
  speed: 1.15,         // m/s, real time. Walk pace is 4.6, so it is outrunnable
  wake: 3.0,           // seconds after entering the leg before it starts
  startBehind: 11,     // metres behind you when it wakes
  killAhead: 1.0,      // the drum face plus its reach
  h: 2.9,              // housing height (corridor clear height is 2.80)
  // THE VISIBLE UNIT IS 9 m WIDE AND FOLLOWS YOUR X. The lethal part is a
  // plane across the whole leg -- it is a z test, not a box -- so the geometry
  // only has to cover the corridor you can actually see down. Modelling it at
  // the leg's true extent (up to five cells) meant every blade was a 20 m
  // plate, which at any sane radius merges into a solid band: it read as a
  // stack of bars, not as something that would take your arm off.
  w: 9,
  followRate: 3.2,     // how fast it slides to your x, per second
  drumY: [0.82, 2.02], // two drums, counter-rotating
  drumR: 0.62,
  blades: 8,           // teeth around each drum
  teeth: 7,            // ...and stacks of them ACROSS it, with gaps between
  bladeT: 0.085,       // tooth thickness along the axis of rotation (m)
  spin: 9.5,           // rad/s
  hazard: 0.16,        // height of the red hazard bars, top and bottom
};

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

// THE CONDITION TAX — a second multiplier on the same curves.
//
// A condition that only changes what you can SEE is a lighting effect. What
// makes it a condition is that it changes what you can AFFORD. Playtest, and
// the design direction it settled:
//
//   "Fog and Blackout could use higher stakes: lower visibility, far fewer
//    ammo drops. In general that's where the fun in this game lies -- finding
//    ways to increase the stakes so that you have to conserve your resources
//    and be strategic (hiding, choosing shots carefully, using slow-motion
//    strategically)."
//
// So these stack on top of SCARCITY: a fog leg at door 6 pays the door-6 rate
// AND the fog rate. Blackout is the harder of the two on every line, and it
// is the only one that taxes TIME -- in a blackout the freeze is how you SEE,
// so charging more for it means light itself costs you seconds. That is the
// whole condition in one number.
//
// `groupSize` is the one that goes DOWN. Playtest: "groups of enemies made it
// easier, because I could take out lots of them at once (especially with a
// knife) -- it's actually harder, and more fun, if you space them out so you
// only encounter 1-2 at a time." Exactly right, and it is specific to the
// dark: a clump is a single problem you solve once, whereas two bodies met
// separately are two searches, two decisions, and two chances to be flanked
// by the one you have not found yet.
export const CONDITION_TAX = {
  fog:      { ammoDrop: 0.42, weaponDrop: 0.62, timeGain: 0.90, groupSize: 0.45 },
  blackout: { ammoDrop: 0.32, weaponDrop: 0.52, timeGain: 0.82, groupSize: 0.38 },
};

export function condTax(cond, curve) {
  const t = cond && CONDITION_TAX[cond];
  return (t && t[curve] !== undefined) ? t[curve] : 1;
}

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
  // THE CONTROL IS UNLOCKED, NOT TAUGHT — and not on a door number either.
  // It arrives when the STAIRCASE says it should: the door bullet speed first
  // reaches SPEED.unlockM, the point at which walking out of a round stops
  // being enough. `unlockDoor()` in this file is the only answer to "which
  // door", and main.js asks it rather than carrying a number of its own.
  // (There used to be a hand-typed `unlockDoor: 4` here. It could — and did —
  // drift out of step with the speed it was supposed to be answering.)
  base: 5,             // seconds at wave start (and the floor each wave)
  bonus: 2,            // seconds refunded per kill
  cap: 10,             // bank ceiling
  drain: 1,            // seconds spent per second frozen, before scaling
  // The bank running out is what kills you in a blackout, and a bar quietly
  // shrinking at the top of the screen is not a warning when you are looking
  // down a corridor. These thresholds are in SECONDS LEFT, not in fraction of
  // the bar: the bar's full height is `cap`, which you rarely hold, so a
  // fraction of it would warn at wildly different real times.
  low: 2.5,            // meter pulses
  crit: 1.2,           // ...twice as fast, and the whole meter blinks
  slowScale: 0.05,     // world speed while standing still
  moveScale: 0.3,      // world speed at full stick
};

// ---------------------------------------------------------------------------
// THE SIMPLIFIED MODES — one movement mechanic, no look, no time button.
//
// Two prototypes that ask the same question in two different ways: if the
// player only ever drags to dodge and taps to shoot, is the four-beat rhythm
// (see him, watch the round leave, step out of it, shatter him) still there?
// They differ in exactly one rule — WHO OWNS TIME — so playing one after the
// other is a controlled comparison and not two unrelated games:
//
//   CORRIDOR DUEL  the world slows itself, whenever a round is in the air
//   STAND STILL    the world moves at your thumb's speed, and nothing else's
//
// Neither has a time bank, so neither can price the freeze the way the tunnel
// does (docs/PILLARS.md §1, §2). What replaces the price is different in each
// and is the thing being tested — see docs/MODES.md.
// ---------------------------------------------------------------------------
export const SIMPLE = {
  legWide: 1,           // cells either side of the spine: 1 = a 12 m strip
  strafeEase: 11,       // how sharply the body answers the thumb (vs MOVE_EASE)
  tapMagnetPx: 64,      // a tap this close to a body on screen takes the body
  duel: {
    // Time is not the player's here. It drops on its own the moment a round
    // is on its way and comes back when the air is clear, so the rhythm of
    // the fight is set by the enemy firing rather than by a button.
    slow: 0.13,         // world speed while a round is inbound
    ease: 9,            // crossing between slow and full (per second)
    lead: 1.1,          // a round counts as inbound this many seconds out
    miss: 2.6,          // ...and only if it passes within this many metres
    // SHORTER THAN THE TUNNEL'S, because you never walk it while it matters.
    // The strip is the arena, not a journey: its length is the range the
    // fight opens at, and everything past the last body is a corridor you
    // are marched down with nothing to do. Six cells is 24 m, which is just
    // inside the 26 m an enemy opens fire at — so they arrive already
    // shooting — and about three seconds of march at the far end.
    legCells: 6,
    walkSpeed: 6.5,     // the corridor walks you to the open door, m/s
  },
  stop: {
    still: 0.02,        // world speed with the thumb still
    full: 1,            // ...and at full drag
    curve: 0.85,        // <1 opens the low end up: a nudge is a real nudge
    // SHOOTING IS NOT FREE. Standing still stops the world, so without this
    // a player could stand in one spot and empty a magazine into a frozen
    // room at no cost, which is not a game. Every shot buys the world a
    // slice of full-speed time — the bullets you did not dodge get closer.
    shotTime: 0.17,     // seconds of world time a shot costs
    shotRate: 1,        // ...spent at this world speed
    // Longer than the duel's: here you walk the leg yourself, at whatever
    // speed you are willing to let the world run at, and that walk IS the
    // mode. Nine cells is 36 m of deciding when to move.
    legCells: 9
  },
};
