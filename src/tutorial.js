// ---------------------------------------------------------------------------
// THE ONBOARDING, AS DATA
//
// The specification this implements is docs/TUTORIAL-GOALS.md. Its four rules,
// because every line below is downstream of them:
//
//   1. one lesson at a time
//   2. the message stays until the lesson is COMPLETE
//   3. nothing on screen that does not serve the lesson
//   4. the next area opens on success, never on a clock
//
// The SHAPE of the lesson lives here; the MACHINERY lives in main.js. This
// module says which legs get built and what shape they are, what the player is
// allowed to do on each step, and what words appear where and on which beat.
// main.js says what "reached the corner" means and how a barrier sinks.
//
// tool/ imports this file directly, which is the point: what the level tool
// edits is what the game runs, so a preview cannot lie. Same property
// src/genleg.js has for corridors.
// ---------------------------------------------------------------------------

// --- the numbers -----------------------------------------------------------
import { planToCells } from './genleg.js';

export const TUTOR = {
  hallCells: 7,         // default straight cells, when a leg does not say
  // CLOSE ENOUGH TO SEE FROM THE CORNER. At six cells past the rejoin the
  // barrier stood 56 m from the last turn, which on a phone is a corridor
  // fading to white — so it and its sign appeared out of nothing half way
  // down the straight instead of being the thing you turn the corner and see.
  barrierCells: 3,      // cells from the fork's rejoin to the barrier
  barrierH: 1.05,       // low enough to see and shoot over
  standWithin: 2.6,     // metres from the barrier that counts as standing at it
  // FOUR, NOT FIVE. At five the gunner stood twenty metres past the barrier,
  // which on a portrait phone is a figure a centimetre tall firing a round the
  // player has to be told is there. Close enough to read the arm going up.
  enemyCells: 4,        // cells beyond the barrier the first gunner stands
  enemyX: 1.15,         // ...and how far to either side the other two stand.
                        // A one-cell leg is 4 m of cell less 0.3 m of wall each
                        // side: 3.4 m of floor, so ±1.7 IS the wall and a body
                        // placed there is inside it.
  // ROUNDS HERE ARE ORDINARY ROUNDS — same speed in both clocks as every other
  // round in the game, because a tutorial that teaches a slower bullet than the
  // game fires has taught the wrong timing. What makes the first one fair is
  // not a handicap, it is that the world STOPS on the telegraph until the
  // player has read the prompt and pressed the button.
  aimBeat: 1.2,         // seconds from the enemy appearing to his arm rising
  // THE FREEZE LANDS ON THE ROUND, NOT ON THE ARM. It used to stop the world
  // part-way through the telegraph, so the words said DODGE THE BULLET with no
  // bullet anywhere on the screen: the player was asked to dodge a thing they
  // had never seen. He fires first, the round clears the muzzle, and THEN the
  // world stops — with the thing they have to get out of the way of hanging in
  // the air in front of them.
  // Not a third — nearly half. At a third the round is still inside the
  // gunner's silhouette, so the ring that names it reads as "this man" rather
  // than "this bullet". Clear of him, it is unmistakably a separate thing
  // hanging in the air, with eight metres still to come.
  freezeAfter: 0.45,    // of the way from the muzzle to the player
  // ...and once they let it go, it travels at a pace a person can read. The
  // ordinary rule is that time moves when YOU move (0.05 standing still), and
  // at that rate a round twelve metres out takes half a minute to arrive: on
  // the beat that teaches dodging, the bullet did not appear to move at all.
  // The floor lifts for the dodging lessons and the ordinary rule comes back
  // with the meter, which is the lesson that is about the cost of slow time.
  // HOW FAR SIDEWAYS COUNTS AS OUT OF THE WAY. The freeze in the dodge lesson
  // is released by MOVING, not by a button — the slow-time control does not
  // exist yet — so this is the whole answer to "have they done it".
  dodgeStepM: 0.85,

  // --- THE DEFERRED SLOW-TIME LESSONS --------------------------------------
  // Nothing in the shipped sequence reads anything below this line. It is the
  // machinery for teaching the time button and the meter, kept whole and kept
  // WIRED because that lesson is coming back — it is deferred past the
  // onboarding for now (docs/TUTORIAL-GOALS.md §5) and unlocks at a door
  // instead. When it returns it should be a data change, not an excavation.
  //
  // `DEFERRED` below holds the steps themselves, off the running order but in
  // the spec, so the tool lists them and `slowlesson.js` exercises them. That
  // is the difference between machinery that is kept and machinery that rots.
  dodgeScale: 0.18,     // floor on world speed while a taught round is in flight
  meterSecs: 7,         // meter: full to the knee, in seconds
  meterCrawlSecs: 70,   // ...and the rate below the knee
  meterKnee: 0.5,       // where the drain slows
  meterFloor: 0.25,     // how low the demo is ever allowed to take it
  resumeDelay: 1.6,     // beat between the meter appearing and the way out
  warnAt: 0.5,          // fraction of the TANK left that trips the reminder
  rampDrain: 0.5,       // multiplier on the bank's drain while a lesson runs
  volleyGap: 2.6,       // seconds between rounds in the three-round lesson
  reshoot: 3.2,         // ...and the gap before a missed shot is retried
  // THE METER LESSON HAS A FLOOR. It empties at a readable rate to half, then
  // slows to a crawl, and never goes below a quarter: the player is being
  // taught that time is finite, not put in a hole they cannot climb out of
  // before anyone has told them how.
                        // this as full-to-EMPTY, so the half the player is
                        // being introduced to went in 3.5 s.

  gunRise: 0.6,         // seconds for the weapon to swing up into frame
  rampFireDelay: 0.9,   // beat after entering a ramp room before anyone fires
  // HALF PRICE WHILE THEY ARE STILL LEARNING. The ordinary drain empties a
  // full bank in ten seconds of frozen world, which in a training room is
  // about one fight — so a player using the button the way they have just been
  // taught to ran dry in the first room and spent the other five without it.
  // ...and where "it is running out" is worth saying out loud. HALF OF WHAT
  // THEY HAD WHEN THEY SLOWED TIME, not half of the bar: a wave starts with
  // `base` seconds against a bar drawn to `cap`, so the meter is ALREADY at
  // 50% on the frame it appears and a warning at half the bar would fire the
  // instant the button was pressed. Half the tank is what a player means by
  // half gone. The game's own `low` mark is the floor under it, so a tap on a
  // nearly-empty tank still gets warned.
  // NOTHING DEAD IN HERE. `dodgeRounds`, `faceRate` and `finalEnemies` used to
  // sit in this list, complete with sliders and help text in the tool, and not
  // one line of main.js read any of them: dragging "how many rounds must be
  // dodged" changed nothing at all. The real controls are `advance.need` on
  // the dodging step and `bodies` on each step, both of which the step editor
  // already has. Every key below IS read — see the greps in docs/TESTING.md.
};

// --- the legs --------------------------------------------------------------
// AUTHORED, not generated. "A straight run, then a right turn, then a fork
// that rejoins" is a sequence of specific corners; a generator that produces
// something like it four times out of five is no use for a lesson whose whole
// point is that the player knows what is coming.
//
// `moves` reads as instructions — ['f', 7] is seven cells forward, ['r', 3]
// three to the right — because that is how the lesson is described. `extra`
// hangs cells off the spine: a fork's second lane, or the width of a room.
// Both are relative to the leg's own start.
//
// Anything past the end of this list is an ordinary generated leg, which is
// what the end of the tutorial looks like.

// The teaching leg's moves, named, so the steps can say "ends at the corner"
// instead of "ends at spine index 7" — and stay right when somebody makes the
// first hallway one cell longer in the tool.
const TEACH_MOVES = [
  ['f', 7],    // 1. MOVE — dead straight, nothing else on screen
  ['r', 3],    // 2. LOOK — the corner they have to turn their head round
  ['f', 4],
  ['l', 3],    // 3. another corner...
  ['f', 4],
  ['r', 3],    // ...and another
  // THE FORK IS SHORTER, AND SO IS THE RUN AFTER IT. What matters at the last
  // corner is that the player can SEE the barrier they are being sent to: at
  // eight cells of fork plus six of approach it stood 56 m away, which on a
  // phone is a corridor fading to white. Five and three puts it 32 m off —
  // near enough to read as a thing in the world, far enough to walk to.
  ['f', 2],    // the fork opens
  ['f', 3],    // ...and rejoins
  ['f', 11],   // 4-9. the barrier, the dodging, the shooting, the door
];
// --- marks: named cells on the walked path ---------------------------------
// DERIVED, NEVER TYPED. A mark is a place in the lesson — "the first corner",
// "where the fork rejoins" — and the level tool lets the path be redrawn. Held
// as literals they went stale the instant it was: redrawing the teaching leg
// in the tool left the barrier standing 24 m inside solid rock, with lesson 4
// waiting for the player to reach a cell the corridor no longer had and the
// STAND HERE sign gated off a spine index the leg no longer reached. Nothing
// on screen, no way forward, no error.
//
// So they are computed from the plan, every load, for every leg — which means
// a path edit cannot strand them and the tool needs no control for them.
export function marksFromPlan(plan) {
  const moves = (plan && plan.moves) || [];
  let n = 0;
  const runs = [];
  for (const m of moves) {
    const dir = String((m && m[0]) || 'f');
    n += Math.max(0, (m && m[1]) | 0);
    runs.push({ dir, at: n });
  }
  const fwd = runs.filter((r) => r.dir === 'f');
  const turns = runs.filter((r) => r.dir !== 'f');
  const marks = {
    firstCorner: fwd.length ? fwd[0].at : n,          // end of the opening straight
    secondRun: fwd.length > 1 ? fwd[1].at : n,        // ...and of the next one
    // THE LAST CORNER. Everything past it is one straight run to the door, so
    // it is where the barrier first comes into view — and therefore where the
    // STAND HERE sign is allowed to appear, small, in the distance.
    finalRun: turns.length ? turns[turns.length - 1].at : 0,
    forkEnd: n,   // ...the end of the walk, unless a side lane rejoins sooner
    // WHERE THE BARRIER STANDS. The onboarding's leg ends in a fork, and the
    // barrier belongs just past where it rejoins — so `forkEnd` was the
    // anchor and, for that leg, still is. A leg with NO fork has forkEnd at
    // the very end of the walk, which put the slab three cells past the last
    // cell of the corridor: inside the door, with nowhere for the man who is
    // supposed to shoot at you over it to stand. Without a fork the anchor is
    // the last corner instead, so the barrier is the first thing you see when
    // you round it and the rest of the run is the lesson's stage.
    barrierAt: 0,
  };
  marks.barrierAt = marks.finalRun;
  // The rejoin is the one mark the moves alone cannot state, because the fork's
  // second lane is `extra` cells hanging off the spine. It is the furthest cell
  // of the walked path that any of them touches.
  const extra = (plan && plan.extra) || [];
  if (extra.length) {
    const { spine } = planToCells(0, 0, moves);
    let best = -1;
    for (const [ex, ez] of extra) {
      for (let i = 0; i < spine.length; i++) {
        if (Math.abs(spine[i][0] - ex) + Math.abs(spine[i][1] - ez) <= 1) {
          best = Math.max(best, i);
        }
      }
    }
    if (best > 0) { marks.forkEnd = best; marks.barrierAt = best; }
  }
  return marks;
}

// The fork's second lane: out to the right at the split, forward alongside,
// and back in at the rejoin. Both routes reach the same place, which is the
// only thing this leg is trying to say.
const FORK_LANE = [
  [4, 17], [5, 17],
  [5, 18], [5, 19], [5, 20],
  [4, 20],
];

// EVERY TRAINING AREA WITH MORE THAN ONE BODY IN IT TAKES TURNS. Two rounds
// resolving on the same frame is one loud event a first-time player cannot
// parse; the same two a beat apart is a room reacting to them. `fireOrder`
// says so per leg, and after the first hallway every leg that holds a pair or
// a trio says 'turns'.
//
// A room is the spine plus width. Three cells across and four deep reads as a
// room on a portrait phone without becoming a space you can get lost in.
export const TEACH_MARKS = marksFromPlan({ moves: TEACH_MOVES, extra: FORK_LANE });

const room = (halfW, z0, z1) => {
  const out = [];
  for (let x = -halfW; x <= halfW; x++) {
    if (x === 0) continue;
    for (let z = z0; z <= z1; z++) out.push([x, z]);
  }
  return out;
};

export const LEGS = [
  {
    id: 'teaching', form: 'corridor', barrier: true, countsAsDoor: false,
    note: 'Lessons 1-9. Straight run, right turn, two more turns, a fork that '
      + 'rejoins, then the hallway where the whole combat lesson happens.',
    plan: { moves: TEACH_MOVES, extra: FORK_LANE, approach: 4 },
  },
  // WITHIN ENGAGE RANGE OF THE DOOR YOU COME IN THROUGH. A gunner's
  // engageDist is 19-25 m; bodies parked at z 7-10 stood 28 m from the entry,
  // so nothing happened for the first four cells of every area and "fires as
  // they enter" never once happened. They stand at 4-6 cells now.
  //
  // ROOMS ARE WIDE AT THE MOUTH. A three-cell bay buried mid-leg is
  // indistinguishable from a corridor at the only moment the difference
  // matters, which is when you walk in.
  { id: 'room1', form: 'vault', kind: 'room', note: '10. One enemy, fires as you enter.',
    plan: { moves: [['f', 8]], extra: room(1, 1, 6), approach: 3 },
    enemies: [{ x: 0, z: 5, type: 'gunner' }], fireOrder: 'free' },
  { id: 'hall1', form: 'corridor', kind: 'hall', note: '11. One enemy blocking the door.',
    plan: { moves: [['f', 8]], approach: 3 },
    enemies: [{ x: 0, z: 5, type: 'gunner' }], fireOrder: 'free' },
  { id: 'room2', form: 'vault', kind: 'room', note: '12. Two side by side, taking turns.',
    plan: { moves: [['f', 9]], extra: room(1, 1, 7), approach: 3 },
    enemies: [{ x: -1, z: 5, type: 'gunner' }, { x: 1, z: 5, type: 'gunner' }],
    fireOrder: 'turns' },
  // OFF THE CENTRE LINE. Three bodies at x = 0 are one silhouette: the front
  // one occludes the others perfectly and the HUD count contradicts the screen.
  { id: 'hall2', form: 'corridor', kind: 'hall', note: '13. Two in a hallway, taking turns.',
    plan: { moves: [['f', 10]], approach: 3 },
    // x is in CELLS, so a quarter is a metre — enough to break the silhouette
    // in a corridor that only has 3.4 m of floor to play with.
    enemies: [{ x: -0.22, z: 5, type: 'gunner' }, { x: 0.22, z: 8, type: 'gunner' }],
    fireOrder: 'turns' },
  { id: 'room3', form: 'vault', kind: 'room', note: '14. Three in a room, taking turns.',
    plan: { moves: [['f', 10]], extra: room(1, 1, 8), approach: 3 },
    enemies: [{ x: -1, z: 5, type: 'gunner' }, { x: 1, z: 5, type: 'gunner' },
      { x: 0, z: 8, type: 'gunner' }], fireOrder: 'turns' },
  { id: 'hall3', form: 'corridor', kind: 'hall', note: '15. Three: one, then two close behind.',
    plan: { moves: [['f', 11]], approach: 3 },
    // NONE OF THEM ON THE CENTRE LINE. The leading man stood at x 0 and the
    // third at x 0.24 nine cells back — 1.5° apart from the door, so he was
    // hidden inside the silhouette of the man in front of him until the first
    // one dropped. Spread across the corridor they read as three.
    enemies: [{ x: -0.28, z: 4, type: 'gunner' }, { x: 0.28, z: 8, type: 'gunner' },
      { x: -0.12, z: 10, type: 'gunner' }], fireOrder: 'turns' },
];

// --- what the player is allowed to do --------------------------------------
// A grant is a capability, not a step name. Reading "can they shoot yet" off
// the sequence order meant the answer moved whenever the sequence did, and
// twice it moved somewhere nobody intended.
export const MECHANICS = [
  ['gun',    'Weapon in hand',   'The viewmodel is on screen.'],
  ['fire',   'Can fire',         'Tapping the screen shoots. Off, and a tap does nothing.'],
  ['timebtn','Time button',      'The slow-motion control exists on screen at all.'],
  ['meter',  'Time meter',       'The bank bar at the top of the screen.'],
  ['bank',   'Freezing costs',   'Off, stopping time is free — the script owns the bank.'],
  ['ammo',   'Ammo readout',     'The magazine line at the bottom.'],
  ['aiFire', 'Enemies may fire', 'Off, only the script pulls a trigger. Their walk and aim are untouched.'],
  ['spawns', 'Spawn queue runs', 'Off, the queue is held: nobody arrives unless the script places them.'],
  ['score',  'Door / enemy line','The HUD line at the top left.'],
];

// Everything is off unless a step says otherwise. A tutorial that has to
// remember to take things away has already given them to somebody by mistake.
export const NO_GRANTS = {
  gun: false, fire: false, timebtn: false, meter: false,
  bank: false, ammo: false, aiFire: false, spawns: false, score: false,
};
// ...and what the ramp areas grant, which is simply "the game".
// What a training area grants: the game, MINUS the slow-motion control. That
// is deferred past the whole onboarding on purpose (docs/TUTORIAL-GOALS.md) —
// it arrives later as something you unlock, not as a fifth thing to read on
// your first corridor.
const PLAYING = { gun: true, fire: true, timebtn: false, meter: false,
  bank: false, ammo: true, aiFire: true, spawns: false, score: true };

// --- when a cue comes and goes ---------------------------------------------
export const CUE_EVENTS = [
  ['enter',   'the step begins'],
  ['held',    'the world stops mid-telegraph'],
  ['freeze',  'the player stops time'],
  ['dodge',   'a round goes past them'],
  ['kill',    'they drop one'],
  ['threat',  'somebody starts to aim at them'],
  // deferred with the slow-time lessons — see DEFERRED at the end of this file
  ['meter',   'the meter warning lands'],
  ['low',     'the meter falls past the warning mark'],
  ['resume',  'the player lets time run again'],
  ['ready',   'they have slowed AND resumed time in this area'],
  ['shot',    'they pull the trigger'],
  ['advance', 'the step ends'],
];
// `advance` as a HIDE is the same as "stays until the step ends", because the
// next step clears the screen on the way in. Spelled out rather than left
// implicit so a cue always states both halves of its own life.
export const CUE_SHOW = CUE_EVENTS.filter(([id]) => id !== 'advance');

// WHERE WORDS GO. One element each, all able to be on screen together — which
// is goal 2's requirement: DRAG TO MOVE has to still be there when DRAG TO
// LOOK arrives, or the player reads the second as replacing the first.
export const CUE_SLOTS = [
  ['mid',   'Centre'],
  ['left',  'Left half'],
  ['right', 'Right half'],
  ['atbtn', 'Above the time button'],
  ['top',   'Under the meter'],
  ['world', 'Hovering over the barrier'],
];
export const CUE_ARROWS = [['none', 'None'], ['down', 'Down to the button'], ['up', 'Up to the meter']];
// `sway` is `side`'s twin on the LEFT half of the screen: the same
// side-to-side swipe, over the move stick rather than the look area, because
// "get out of the way" is a sideways instruction and a hand travelling upwards
// says "walk forward" — straight into the round.
export const CUE_HANDS = [['none', 'None'], ['up', 'Swipe up'],
  ['side', 'Swipe across (right)'], ['sway', 'Swipe across (left)'], ['tap', 'Tap']];

// --- the sequence ----------------------------------------------------------
// `advance` names the built-in condition in main.js that ends the step. These
// are code, not data — "reached the corner" is not something a text box can
// express — so the tool offers the list rather than a free field.
export const ADVANCE_KINDS = [
  ['reached',  'walked to a point on the leg (spine cell)'],
  ['atBarrier','reached the barrier'],
  ['froze',    'stopped time (the world is held until they do)'],
  ['dodged',   'dodged N rounds'],
  ['gunUp',    'the weapon has finished rising'],
  ['cleared',  'every enemy is down'],
  ['resumed',  'let time run again (the meter lesson)'],
  ['crossed',  'walked through the door'],
  ['none',     'never (the last step)'],
];

// --- the training rooms' one reminder --------------------------------------
//
// The six training areas used to carry a three-cue loop about the time button.
// The time button does not exist during the onboarding any more — the whole
// slow-motion control is deferred past it — so what is left is the one thing
// a player can forget under pressure on their first corridor: the trigger.
//
// It is `once` per area, which means SPENT BY THE ACTION IT ASKED FOR. Shoot
// in this room and the words are gone for this room; the next room starts
// fresh, because `tutorSpent` is cleared with the step and an area IS a step.
// It arrives on `threat` — somebody starting to aim — rather than on entry,
// so it is an answer to something rather than a caption on an empty corridor.
const REMIND_SHOOT = () => [{
  text: 'TAP ANYWHERE TO SHOOT', slot: 'mid', arrow: 'none', hand: 'none',
  pulse: true, on: 'threat', off: 'shot', once: true,
}];

export const STEPS = [
  // --- 1. MOVE -------------------------------------------------------------
  // Ends at the corner, not after n metres. Goal 2: the words stay the whole
  // way down the hallway, because a prompt that leaves halfway is a prompt
  // that leaves while somebody is still working out what it meant.
  {
    id: 'move', label: '1 · Move',
    hud: 'PROCEED DOWN THE HALLWAY',
    advance: { kind: 'reached', need: 'firstCorner' },
    // THE BARRIER IS A FIXTURE, not something lesson 4 conjures. It stands
    // from the first frame of the run, so turning the last corner shows you a
    // corridor with a thing in it rather than a corridor that grows one.
    grants: {}, divider: true, buildBarrier: true,
    cues: [{ text: 'DRAG TO MOVE', slot: 'left', arrow: 'none', hand: 'up',
      pulse: false, on: 'enter', off: 'advance' }],
  },
  // --- 2. LOOK -------------------------------------------------------------
  // DRAG TO MOVE stays. The point being made is that looking is a SEPARATE
  // action that happens at the same time as moving, not a mode you enter.
  {
    id: 'look', label: '2 · Look',
    hud: 'PROCEED DOWN THE HALLWAY',
    advance: { kind: 'reached', need: 'secondRun' },
    grants: {}, divider: true,
    cues: [
      { text: 'DRAG TO MOVE', slot: 'left', arrow: 'none', hand: 'up',
        pulse: false, on: 'enter', off: 'advance' },
      { text: 'DRAG TO LOOK', slot: 'right', arrow: 'none', hand: 'side',
        pulse: false, on: 'enter', off: 'advance' },
    ],
  },
  // --- 3. CORNERS AND A FORK ----------------------------------------------
  {
    id: 'corners', label: '3 · Corners + fork',
    hud: 'PROCEED DOWN THE HALLWAY',
    // ...and ends AT THE LAST CORNER, not eight cells past it. The walking
    // lesson is over the moment there is something ahead to walk to, and that
    // moment is the turn: STAND HERE is on screen from the frame the barrier
    // comes into view, which is what makes it a place rather than an
    // announcement.
    advance: { kind: 'reached', need: 'finalRun' },
    grants: {}, divider: false,
    cues: [
      { text: 'DRAG TO MOVE', slot: 'left', arrow: 'none', hand: 'up',
        pulse: false, on: 'enter', off: 'advance' },
      { text: 'DRAG TO LOOK', slot: 'right', arrow: 'none', hand: 'side',
        pulse: false, on: 'enter', off: 'advance' },
    ],
  },
  // --- 4. STAND HERE -------------------------------------------------------
  // The prompts go. The first thing they are asked to AIM at rather than do.
  {
    id: 'stand', label: '4 · Stand here',
    hud: 'GO TO THE BARRIER',
    advance: { kind: 'atBarrier' },
    grants: {},
    cues: [{ text: 'STAND HERE', slot: 'world', arrow: 'none', hand: 'none',
      pulse: true, on: 'enter', off: 'advance' }],
  },
  // --- 5. THE ROUND, THREE TIMES ------------------------------------------
  // ONE BEAT, REPEATED, AND THE ANSWER IS YOUR THUMB. He appears, raises his
  // arm, FIRES, and the world stops with the round in the air. The words say
  // dodge it and a thumb swipes side to side under them. Step out of the lane
  // and time runs again on its own: the round goes past, the words fade, and
  // the next one comes.
  //
  // There is no time BUTTON here and no meter. The whole slow-motion control
  // is deferred — see docs/TUTORIAL-GOALS.md — because a player who has just
  // been handed a corridor and a gun wants to shoot something, not to learn a
  // resource. The freeze in this lesson is the game buying them a moment to
  // read three words, not a mechanic being introduced.
  {
    id: 'dodge', label: '5 · Dodge three rounds',
    advance: { kind: 'dodged', need: 3 },
    // `bodies` is how many should be STANDING THERE, not how many to add.
    // Declaring it per beat is what lets a retry rebuild the world.
    grants: {}, bodies: 1, hardFreeze: true,
    hud: 'DODGE THE ROUNDS',
    // ON `held` — the frame the world stops, which is the frame after the
    // shot. The hand is the instruction: a swipe across, under the words,
    // over the half of the screen the move stick lives on.
    cues: [{ text: 'DODGE THE BULLET', slot: 'mid', arrow: 'none', hand: 'sway',
      pulse: false, on: 'held', off: 'dodge' }],
  },
  // --- 6. THE GUN, AND THE OTHER TWO --------------------------------------
  // The squad arrives and the weapon comes up on the same beat as the words
  // that name it. Nothing else is on the screen: this is the first thing the
  // player has been asked to DO to somebody rather than get away from.
  {
    id: 'shoot', label: '6 · Shoot',
    advance: { kind: 'cleared' },
    grants: { gun: true, fire: true, ammo: true },
    bodies: 3, raiseGun: true,
    hud: 'CLEAR THE HALLWAY',
    cues: [
      { text: 'TAP ANYWHERE TO SHOOT', slot: 'mid', arrow: 'none',
        hand: 'none', pulse: true, on: 'enter', off: 'shot' },
    ],
  },
  // --- 9. THE DOOR ---------------------------------------------------------
  {
    id: 'exit', label: '7 · The door',
    advance: { kind: 'crossed' },
    // The score line comes on here — the first beat of the onboarding where
    // there is a door count worth having — and reads TRAINING · GO TO THE NEXT
    // DOOR rather than DOOR 1 · OPEN — GO.
    grants: { gun: true, fire: true, ammo: true, score: true },
    dropBarrier: true, openDoor: true, hud: 'GO TO THE NEXT DOOR',
    cues: [{ text: 'GO TO THE NEXT ROOM', slot: 'mid', arrow: 'none',
      hand: 'none', pulse: false, on: 'enter', off: 'advance' }],
  },
  // --- 10-15. THE RAMP -----------------------------------------------------
  // The teaching is over. Each of these is a real fight and a checkpoint: the
  // enemies come from the LEG rather than the step, and dying puts the player
  // back at the start of this area and nowhere further.
  { id: 'ramp1', label: '8 · Room · 1', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, hud: 'CLEAR THE ROOM',
    cues: [] },
  // ...and from here on the reminders are once each, per area. The trigger
  // prompt starts after the first hallway with anybody in it, which is where
  // a player who has been shooting without being told has proved they do not
  // need it and one who has not is overdue.
  { id: 'ramp2', label: '9 · Hall · 1', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, hud: 'CLEAR THE HALLWAY',
    cues: REMIND_SHOOT() },
  { id: 'ramp3', label: '10 · Room · 2', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, hud: 'CLEAR THE ROOM',
    cues: REMIND_SHOOT() },
  { id: 'ramp4', label: '11 · Hall · 2', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, hud: 'CLEAR THE HALLWAY',
    cues: REMIND_SHOOT() },
  { id: 'ramp5', label: '12 · Room · 3', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, hud: 'CLEAR THE ROOM',
    cues: REMIND_SHOOT() },
  { id: 'ramp6', label: '13 · Hall · 3', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, hud: 'CLEAR THE HALLWAY',
    cues: REMIND_SHOOT() },
  // ...AND IT LETS THE GAME SPAWN. `PLAYING` holds the spawn queue, because
  // a training area's bodies come from the LEG rather than the queue — but
  // `done` is entered on crossing into the FIRST REAL LEG, whose wave has
  // just been composed and queued. Holding it there emptied that queue every
  // frame until the onboarding finished ending, and door 1 had nobody in it.
  { id: 'done', label: 'Done', advance: { kind: 'none' },
    grants: { ...PLAYING, spawns: true }, cues: [] },
];

// ---------------------------------------------------------------------------
// DEFERRED — THE SECOND COURSE, not an off switch
//
// `deferred: true` used to mean "kept in the spec, never walked into". It now
// means "belongs to the OTHER lesson". These steps teach the time button and
// the meter, and they run in the middle of a real run — on the door the speed
// staircase unlocks the power on (`unlockDoor()` in src/balance.js), which is
// the door bullet speed first reaches the point where walking out of a round
// stops being enough.
//
// Why not in the onboarding: a first-time player wants to shoot something, not
// to learn a resource. See docs/TUTORIAL-GOALS.md §5 and §6.
//
// main.js runs both courses on one machine — `tutorCourse` points
// `tutorOrder()` and `tutorLegsOf()` at this list and at SCHOOL_LEGS above,
// and nothing below that line knows which lesson it is running. So everything
// that was true of these steps while they were switched off is still true:
//
//   * the machinery that drives them (`hardFreeze` released by the button,
//     `startMeter`, the `resumed` advance, the `meter`/`low`/`resume`/`ready`
//     cue events, `tutorRefusesResume`) has a live consumer, so it cannot be
//     quietly broken by a change to something else;
//   * `slowlesson.js` plays them through, every run of the suite;
//   * the tool lists them, so they can be read and edited;
//   * and each is one `deferred` flag away from moving between the courses.
//
// `loadTutorial` normalises both lists; `tutorOrder()` in main.js is what
// splits them into the onboarding's running order and this one.
// --- THE SLOW-TIME LESSON'S OWN CORRIDOR ------------------------------------
// The onboarding's teaching leg is nine cells of walking before anything
// happens, because at that point the player is learning to walk. This one is
// not: it is played by somebody seventy doors in who has just been told a new
// power exists. One corner, so the barrier arrives as a thing you turn into
// rather than a thing you were already looking at, then the run it stands in.
const SLOW_MOVES = [
  ['f', 5],
  ['r', 3],    // the corner. The barrier is in frame the moment you round it.
  ['f', 12],   // the run the whole lesson happens in
];
export const SCHOOL_LEGS = [
  {
    id: 'slowteach', form: 'corridor', barrier: true, countsAsDoor: false,
    note: 'The slow-time lesson. One corner, the barrier, the button, the '
      + 'meter — then a room to use all three in.',
    plan: { moves: SLOW_MOVES, approach: 4 },
  },
  { id: 'slowroom', form: 'vault', kind: 'room',
    note: 'Practice. Three of them, taking turns, with the meter running.',
    plan: { moves: [['f', 10]], extra: room(1, 1, 8), approach: 3 },
    enemies: [{ x: -1, z: 5, type: 'gunner' }, { x: 1, z: 5, type: 'gunner' },
      { x: 0, z: 8, type: 'gunner' }], fireOrder: 'turns' },
];

export const DEFERRED = [
  // --- A. THE MARK --------------------------------------------------------
  // Same furniture as the onboarding's lesson 4, and deliberately so: a player
  // who is seeing a barrier and the words STAND HERE for the second time in a
  // run already knows what they mean, and that recognition is the cheapest
  // possible way to say "this is a lesson, stop and read it".
  {
    id: 'slowStand', label: '@ · Stand here (again)', deferred: true,
    hud: 'GO TO THE BARRIER',
    advance: { kind: 'atBarrier' },
    grants: { ...PLAYING, timebtn: false, meter: false, spawns: false },
    buildBarrier: true,
    cues: [{ text: 'STAND HERE', slot: 'world', arrow: 'none', hand: 'none',
      pulse: true, on: 'enter', off: 'advance' }],
  },
  {
    id: 'slowIntro', label: 'A · Slow time', deferred: true,
    advance: { kind: 'froze' },
    grants: { timebtn: true }, bodies: 1, hardFreeze: true,
    hud: 'SLOW TIME',
    // Released by the BUTTON, not by stepping aside: that is the whole point
    // of this lesson and the reason `tutorRefusesResume` exists.
    cues: [{ text: 'DODGE THE BULLET<span>TAP HERE TO SLOW TIME</span>',
      slot: 'atbtn', arrow: 'down', hand: 'none', pulse: true,
      on: 'held', off: 'freeze' }],
  },
  {
    id: 'slowMove', label: 'B · Move out of the way', deferred: true,
    advance: { kind: 'dodged', need: 1 },
    grants: { timebtn: true }, bodies: 1,
    hud: 'DODGE THE ROUND',
    cues: [{ text: 'DRAG TO MOVE', slot: 'left', arrow: 'none', hand: 'sway',
      pulse: false, on: 'enter', off: 'advance' }],
  },
  {
    id: 'meter', label: 'C · The meter', deferred: true,
    advance: { kind: 'resumed' },
    grants: { timebtn: true, meter: true }, bodies: 3, startMeter: true,
    hud: 'WATCH THE METER',
    cues: [
      { text: 'YOUR METER DRAINS<br>WHILE TIME IS SLOW',
        slot: 'top', arrow: 'up', hand: 'none',
        pulse: false, on: 'enter', off: 'advance' },
      { text: 'TAP AGAIN TO RESUME',
        slot: 'atbtn', arrow: 'down', hand: 'none',
        pulse: true, on: 'meter', off: 'advance' },
    ],
  },
  // ...and the per-area reminder loop the training rooms used to carry. A cue
  // with `once` is SPENT by the action it asked for, for the rest of that area.
  {
    id: 'slowPractice', label: 'D · Practice · reminders', deferred: true,
    advance: { kind: 'crossed' },
    grants: { ...PLAYING, timebtn: true, meter: true, bank: true },
    checkpoint: true, hud: 'CLEAR THE ROOM',
    cues: [
      { text: 'TAP TO SLOW TIME', slot: 'atbtn', arrow: 'down', hand: 'none',
        pulse: true, on: 'threat', off: 'freeze', once: true },
      { text: 'YOUR METER IS RUNNING OUT', slot: 'top', arrow: 'up', hand: 'none',
        pulse: false, on: 'low', off: 'resume', once: true },
      { text: 'TAP AGAIN TO RESUME', slot: 'atbtn', arrow: 'down', hand: 'none',
        pulse: true, on: 'low', off: 'resume', once: true },
      { text: 'TAP ANYWHERE TO SHOOT', slot: 'mid', arrow: 'none', hand: 'none',
        pulse: true, on: 'ready', off: 'shot', once: true },
    ],
  },
  // --- E. HANDOVER --------------------------------------------------------
  // The onboarding's `done` in miniature, and it exists for the same reason:
  // something has to be the last step, or `tutorAfter` walks off the end of
  // the list and hands the player back a step it has already played.
  {
    id: 'slowDone', label: 'E · Back to the run', deferred: true,
    advance: { kind: 'none' },
    grants: { ...PLAYING, timebtn: true, meter: true, bank: true, spawns: true },
    hud: '',
    cues: [],
  },
];

export const DEFAULT_SPEC = { TUTOR, LEGS, SCHOOL_LEGS, STEPS: [...STEPS, ...DEFERRED] };

// --- the tool's channel ----------------------------------------------------
// The level tool writes an edited spec here and opens the game in an iframe.
// It is honoured ONLY under ?tutorpreview=1, so an override left in a browser
// by an afternoon of editing can never reach an ordinary run — the one thing
// this hatch must not be able to do.
export const OVERRIDE_KEY = 'ts_tutor_override';
export const PREVIEW_PARAM = 'tutorpreview';

export function previewing(search) {
  const q = search === undefined
    ? (typeof location !== 'undefined' ? location.search : '') : search;
  return new URLSearchParams(q || '').get(PREVIEW_PARAM) === '1';
}

// Merged rather than replaced, so a spec written by an older build of the tool
// still boots: anything it does not mention keeps the shipped value.
export function loadTutorial(search) {
  const spec = { TUTOR: { ...TUTOR }, LEGS: normaliseLegs(LEGS),
    SCHOOL_LEGS: normaliseLegs(SCHOOL_LEGS),
    STEPS: normalise([...STEPS, ...DEFERRED]) };
  if (!previewing(search)) return spec;
  let raw = null;
  try { raw = localStorage.getItem(OVERRIDE_KEY); } catch { /* private */ }
  if (!raw) return spec;
  try {
    const o = JSON.parse(raw);
    if (o && o.TUTOR) Object.assign(spec.TUTOR, o.TUTOR);
    if (o && Array.isArray(o.LEGS) && o.LEGS.length) spec.LEGS = normaliseLegs(o.LEGS);
    if (o && Array.isArray(o.SCHOOL_LEGS) && o.SCHOOL_LEGS.length) {
      spec.SCHOOL_LEGS = normaliseLegs(o.SCHOOL_LEGS);
    }
    if (o && Array.isArray(o.STEPS) && o.STEPS.length) spec.STEPS = normalise(o.STEPS);
  } catch (err) {
    console.warn('[tutorial] override ignored:', err && err.message);
  }
  return spec;
}

// A LEG OFF THE TOOL IS AS UNTRUSTED AS A STEP. It used to be cloned raw, so
// `moves: 'forward'` — a string where a list of moves belongs — built a
// one-cell corridor rather than being refused, and any hand-edited leg could
// put a NaN into the geometry. Everything is coerced to the shape genleg reads
// and the marks are recomputed from whatever path survives that.
export function normaliseLegs(legs) {
  return (legs || []).map((l) => {
    const src = l && l.plan ? l.plan : null;
    const moves = (Array.isArray(src && src.moves) ? src.moves : [])
      .map((m) => [String((m && m[0]) || 'f'), Math.max(0, (m && m[1]) | 0)])
      .filter(([dir, n]) => n > 0 && 'flrb'.includes(dir));
    const cellList = (v) => (Array.isArray(v) ? v : [])
      .filter((c) => Array.isArray(c) && isFinite(c[0]) && isFinite(c[1]))
      .map((c) => [+c[0], +c[1]]);
    const plan = src ? {
      ...src,
      moves: moves.length ? moves : [['f', Math.max(1, TUTOR.hallCells)]],
      extra: cellList(src.extra),
      pillars: cellList(src.pillars),
      approach: Math.max(1, (src.approach | 0) || 4),
    } : null;
    const out = {
      ...l,
      id: String((l && l.id) || 'leg'),
      form: (l && l.form) || 'corridor',
      barrier: !!(l && l.barrier),
      enemies: ((l && l.enemies) || [])
        .filter((e) => e && isFinite(e.x) && isFinite(e.z))
        .map((e) => ({ x: +e.x, z: +e.z, type: String(e.type || 'gunner') })),
      fireOrder: (l && l.fireOrder) === 'turns' ? 'turns' : 'free',
    };
    if (plan) { out.plan = plan; out.marks = marksFromPlan(plan); }
    else delete out.marks;   // no path, no marks: main.js falls back on distance
    return out;
  });
}

// An edited step may be missing anything, including its cue list. Fill it in
// rather than letting a half-written step throw inside the frame loop.
function normalise(steps) {
  // TWO STEPS WITH THE SAME ID MAKE THE SEQUENCE A LOOP. `tutorAfter` and
  // `tutorSpecOf` both take the FIRST match, so renaming step 7 to `stand` in
  // the tool produced move → look → corners → stand → dodge1 → dodgeMove →
  // stand → … for as long as anybody cared to watch: an onboarding that can
  // never be finished, with nothing on screen to say why. Ids are made unique
  // on the way in, and the tool warns about the collision separately.
  const seen = new Set();
  const uniq = (id) => {
    let out = id, n = 2;
    while (seen.has(out)) out = `${id}-${n++}`;
    seen.add(out);
    return out;
  };
  return steps.map((s) => ({
    id: uniq(String(s.id || 'step')),
    label: s.label || s.id || 'Step',
    advance: { kind: (s.advance && s.advance.kind) || 'none',
      need: s.advance && s.advance.need },
    grants: { ...NO_GRANTS, ...(s.grants || {}) },
    bodies: s.bodies | 0,
    startMeter: !!s.startMeter,
    // OFF THE RUNNING ORDER, still in the spec. See DEFERRED above.
    deferred: !!s.deferred,
    // What the line at the top of the screen says after "TRAINING". Optional:
    // a step without one falls back to the ordinary door-and-enemies readout.
    hud: s.hud == null ? '' : String(s.hud),
    buildBarrier: !!s.buildBarrier,
    dropBarrier: !!s.dropBarrier,
    openDoor: !!s.openDoor,
    raiseGun: !!s.raiseGun,
    hardFreeze: !!s.hardFreeze,
    checkpoint: !!s.checkpoint,
    divider: !!s.divider,
    cues: (s.cues || []).map((c) => ({
      text: String(c.text == null ? '' : c.text),
      slot: c.slot || 'mid',
      arrow: c.arrow || 'none',
      hand: c.hand || 'none',
      pulse: !!c.pulse,
      // ...shown at most once per area, spent by the action it asked for
      once: !!c.once,
      on: c.on || 'enter',
      off: c.off || 'advance',
    })),
  }));
}
const clone = (v) => JSON.parse(JSON.stringify(v));
