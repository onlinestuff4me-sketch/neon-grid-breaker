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
export const TUTOR = {
  hallCells: 7,         // default straight cells, when a leg does not say
  barrierCells: 6,      // cells from the fork's rejoin to the barrier
  barrierH: 1.05,       // low enough to see and shoot over
  standWithin: 2.6,     // metres from the barrier that counts as standing at it
  enemyCells: 5,        // cells beyond the barrier the first gunner stands
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
  freezeAt: 0.55,       // fraction of the telegraph at which the world stops
  volleyGap: 2.6,       // seconds between rounds in the three-round lesson
  reshoot: 3.2,         // ...and the gap before a missed shot is retried
  dodgeRounds: 3,       // how many have to be dodged before the meter appears
  // THE METER LESSON HAS A FLOOR. It empties at a readable rate to half, then
  // slows to a crawl, and never goes below a quarter: the player is being
  // taught that time is finite, not put in a hole they cannot climb out of
  // before anyone has told them how.
  meterSecs: 7,         // full to half, in seconds
  meterCrawlSecs: 70,   // ...and the rate below that
  meterKnee: 0.5,
  meterFloor: 0.25,
  resumeDelay: 1.6,     // beat between the warning and what to do about it
  faceRate: 5.5,        // how fast the view is eased back down the hallway
  gunRise: 0.6,         // seconds for the weapon to swing up into frame
  finalEnemies: 3,      // how many stand there for the shooting lesson
  rampFireDelay: 0.9,   // beat after entering a ramp room before anyone fires
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
  ['f', 3],    // the fork opens
  ['f', 5],    // ...and rejoins
  ['f', 14],   // 4-9. the barrier, the dodging, the shooting, the door
];
// Cumulative spine index at the end of each move, so a mark is a count of
// moves rather than a magic number.
const AFTER = TEACH_MOVES.reduce((a, [, n]) => (a.push(a[a.length - 1] + n), a), [0]);
export const TEACH_MARKS = {
  firstCorner: AFTER[1],   // end of the opening straight
  secondRun: AFTER[3],     // ...and of the straight after the first turn
  forkEnd: AFTER[8],       // where both routes rejoin: the barrier is measured here
};

// The fork's second lane: out to the right at the split, forward alongside,
// and back in at the rejoin. Both routes reach the same place, which is the
// only thing this leg is trying to say.
const FORK_LANE = [
  [4, 18], [5, 18],
  [5, 19], [5, 20], [5, 21], [5, 22], [5, 23],
  [4, 23],
];

// A room is the spine plus width. Three cells across and four deep reads as a
// room on a portrait phone without becoming a space you can get lost in.
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
    marks: TEACH_MARKS,
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
  { id: 'hall2', form: 'corridor', kind: 'hall', note: '13. Two in a hallway.',
    plan: { moves: [['f', 10]], approach: 3 },
    // x is in CELLS, so a quarter is a metre — enough to break the silhouette
    // in a corridor that only has 3.4 m of floor to play with.
    enemies: [{ x: -0.22, z: 5, type: 'gunner' }, { x: 0.22, z: 8, type: 'gunner' }],
    fireOrder: 'free' },
  { id: 'room3', form: 'vault', kind: 'room', note: '14. Three in a room.',
    plan: { moves: [['f', 10]], extra: room(1, 1, 8), approach: 3 },
    enemies: [{ x: -1, z: 5, type: 'gunner' }, { x: 1, z: 5, type: 'gunner' },
      { x: 0, z: 8, type: 'gunner' }], fireOrder: 'free' },
  { id: 'hall3', form: 'corridor', kind: 'hall', note: '15. Three: one, then two close behind.',
    plan: { moves: [['f', 11]], approach: 3 },
    enemies: [{ x: 0, z: 4, type: 'gunner' }, { x: -0.24, z: 8, type: 'gunner' },
      { x: 0.24, z: 9, type: 'gunner' }], fireOrder: 'turns' },
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
const PLAYING = { gun: true, fire: true, timebtn: true, meter: true,
  bank: true, ammo: true, aiFire: true, spawns: false, score: true };

// --- when a cue comes and goes ---------------------------------------------
export const CUE_EVENTS = [
  ['enter',   'the step begins'],
  ['freeze',  'the player stops time'],
  ['dodge',   'a round goes past them'],
  ['meter',   'the meter warning lands'],
  ['resume',  'the player lets time run again'],
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
export const CUE_HANDS = [['none', 'None'], ['up', 'Swipe up'], ['side', 'Swipe across'], ['tap', 'Tap']];

// --- the sequence ----------------------------------------------------------
// `advance` names the built-in condition in main.js that ends the step. These
// are code, not data — "reached the corner" is not something a text box can
// express — so the tool offers the list rather than a free field.
export const ADVANCE_KINDS = [
  ['reached',  'walked to a point on the leg (spine cell)'],
  ['atBarrier','reached the barrier'],
  ['froze',    'stopped time (the world is held until they do)'],
  ['dodged',   'dodged N rounds'],
  ['resumed',  'let time run again'],
  ['gunUp',    'the weapon has finished rising'],
  ['cleared',  'every enemy is down'],
  ['crossed',  'walked through the door'],
  ['none',     'never (the last step)'],
];

export const STEPS = [
  // --- 1. MOVE -------------------------------------------------------------
  // Ends at the corner, not after n metres. Goal 2: the words stay the whole
  // way down the hallway, because a prompt that leaves halfway is a prompt
  // that leaves while somebody is still working out what it meant.
  {
    id: 'move', label: '1 · Move',
    advance: { kind: 'reached', need: TEACH_MARKS.firstCorner },
    grants: {}, divider: true,
    cues: [{ text: 'DRAG TO MOVE', slot: 'left', arrow: 'none', hand: 'up',
      pulse: false, on: 'enter', off: 'advance' }],
  },
  // --- 2. LOOK -------------------------------------------------------------
  // DRAG TO MOVE stays. The point being made is that looking is a SEPARATE
  // action that happens at the same time as moving, not a mode you enter.
  {
    id: 'look', label: '2 · Look',
    advance: { kind: 'reached', need: TEACH_MARKS.secondRun },
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
    advance: { kind: 'reached', need: TEACH_MARKS.forkEnd },
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
    advance: { kind: 'atBarrier' },
    grants: {}, buildBarrier: true,
    cues: [{ text: 'STAND HERE', slot: 'world', arrow: 'none', hand: 'none',
      pulse: true, on: 'enter', off: 'advance' }],
  },
  // --- 5. THE FIRST ROUND --------------------------------------------------
  // He appears, raises his arm, and THE WORLD STOPS mid-telegraph. Nothing
  // moves until the button is pressed — which is the only way to be certain a
  // first-time player has read the prompt before the round is in the air.
  {
    id: 'dodge1', label: '5 · Slow time',
    advance: { kind: 'froze' },
    grants: { timebtn: true }, placeEnemy: true, hardFreeze: true,
    cues: [{ text: 'DODGE THE BULLET<span>TAP HERE TO SLOW TIME</span>',
      slot: 'atbtn', arrow: 'down', hand: 'none', pulse: true,
      on: 'enter', off: 'advance' }],
  },
  // --- 5b. ...NOW MOVE OUT OF THE WAY --------------------------------------
  // Time is slow and the round is coming. The prompt is the one they already
  // know, because the answer to "what do I do now" is the thing lesson 1
  // taught them.
  {
    id: 'dodgeMove', label: '5b · Move out of the way',
    advance: { kind: 'dodged', need: 1 },
    grants: { timebtn: true },
    cues: [{ text: 'DRAG TO MOVE', slot: 'left', arrow: 'none', hand: 'up',
      pulse: false, on: 'enter', off: 'advance' }],
  },
  // --- 6. THREE ROUNDS -----------------------------------------------------
  // Two more appear and fire one at a time. Repetition, not escalation: there
  // is still no meter, so slow motion costs nothing and they can stay in it.
  {
    id: 'dodge3', label: '6 · Dodge three',
    advance: { kind: 'dodged', need: 3 },
    grants: { timebtn: true }, placeSquad: true,
    // off:'advance', not off:'dodge'. It used to leave on the first of the
    // three, so rounds two and three arrived with a blank screen — the exact
    // failure goal 2 exists to prevent, in the lesson whose name is "three".
    cues: [{ text: 'DODGE THE BULLETS', slot: 'mid', arrow: 'none', hand: 'none',
      pulse: false, on: 'enter', off: 'advance' }],
  },
  // --- 7. THE METER --------------------------------------------------------
  // Only now. A resource you watch drain while you are learning to dodge is
  // two lessons at once.
  {
    id: 'meter', label: '7 · The meter',
    advance: { kind: 'resumed' },
    grants: { timebtn: true, meter: true }, startMeter: true,
    cues: [
      { text: 'SLOW TIME METER<span>IT EMPTIES WHILE TIME IS SLOW</span>',
        slot: 'top', arrow: 'up', hand: 'none',
        pulse: false, on: 'enter', off: 'advance' },
      // ...and what refills it, which is the fact that makes the meter make
      // sense and was never stated anywhere.
      { text: 'TAP TO LET TIME RUN<span>IT REFILLS WHEN TIME RUNS</span>',
        slot: 'atbtn', arrow: 'down', hand: 'none',
        pulse: true, on: 'meter', off: 'advance' },
    ],
  },
  // --- 8. SHOOT ------------------------------------------------------------
  {
    id: 'gunup', label: '8a · Weapon up',
    advance: { kind: 'gunUp' },
    // gun: true so the rise is SEEN. Without it this step was 0.6 s of an
    // empty corridor and the weapon then popped into frame on the next one.
    grants: { gun: true, timebtn: true, meter: true, bank: true }, raiseGun: true,
    cues: [],
  },
  {
    id: 'shoot', label: '8b · Shoot',
    advance: { kind: 'cleared' },
    grants: { gun: true, fire: true, timebtn: true, meter: true, bank: true, ammo: true },
    cues: [{ text: 'TAP ANYWHERE TO SHOOT', slot: 'mid', arrow: 'none',
      hand: 'none', pulse: true, on: 'enter', off: 'advance' }],
  },
  // --- 9. THE DOOR ---------------------------------------------------------
  {
    id: 'exit', label: '9 · The door',
    advance: { kind: 'crossed' },
    grants: { gun: true, fire: true, timebtn: true, meter: true, bank: true, ammo: true },
    dropBarrier: true, openDoor: true,
    cues: [{ text: 'GO TO THE NEXT ROOM', slot: 'mid', arrow: 'none',
      hand: 'none', pulse: false, on: 'enter', off: 'advance' }],
  },
  // --- 10-15. THE RAMP -----------------------------------------------------
  // The teaching is over. Each of these is a real fight and a checkpoint: the
  // enemies come from the LEG rather than the step, and dying puts the player
  // back at the start of this area and nowhere further.
  { id: 'ramp1', label: '10 · Room · 1', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, cues: [] },
  { id: 'ramp2', label: '11 · Hall · 1', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, cues: [] },
  { id: 'ramp3', label: '12 · Room · 2', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, cues: [] },
  { id: 'ramp4', label: '13 · Hall · 2', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, cues: [] },
  { id: 'ramp5', label: '14 · Room · 3', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, cues: [] },
  { id: 'ramp6', label: '15 · Hall · 3', advance: { kind: 'crossed' },
    grants: { ...PLAYING }, checkpoint: true, cues: [] },
  { id: 'done', label: 'Done', advance: { kind: 'none' },
    grants: { ...PLAYING }, cues: [] },
];

export const DEFAULT_SPEC = { TUTOR, LEGS, STEPS };

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
  const spec = { TUTOR: { ...TUTOR }, LEGS: clone(LEGS), STEPS: clone(STEPS) };
  if (!previewing(search)) return spec;
  let raw = null;
  try { raw = localStorage.getItem(OVERRIDE_KEY); } catch { /* private */ }
  if (!raw) return spec;
  try {
    const o = JSON.parse(raw);
    if (o && o.TUTOR) Object.assign(spec.TUTOR, o.TUTOR);
    if (o && Array.isArray(o.LEGS) && o.LEGS.length) spec.LEGS = clone(o.LEGS);
    if (o && Array.isArray(o.STEPS) && o.STEPS.length) spec.STEPS = normalise(o.STEPS);
  } catch (err) {
    console.warn('[tutorial] override ignored:', err && err.message);
  }
  return spec;
}

// An edited step may be missing anything, including its cue list. Fill it in
// rather than letting a half-written step throw inside the frame loop.
function normalise(steps) {
  return steps.map((s) => ({
    id: String(s.id || 'step'),
    label: s.label || s.id || 'Step',
    advance: { kind: (s.advance && s.advance.kind) || 'none',
      need: s.advance && s.advance.need },
    grants: { ...NO_GRANTS, ...(s.grants || {}) },
    placeEnemy: !!s.placeEnemy,
    placeSquad: !!s.placeSquad,
    buildBarrier: !!s.buildBarrier,
    dropBarrier: !!s.dropBarrier,
    openDoor: !!s.openDoor,
    raiseGun: !!s.raiseGun,
    startMeter: !!s.startMeter,
    hardFreeze: !!s.hardFreeze,
    checkpoint: !!s.checkpoint,
    divider: !!s.divider,
    cues: (s.cues || []).map((c) => ({
      text: String(c.text == null ? '' : c.text),
      slot: c.slot || 'mid',
      arrow: c.arrow || 'none',
      hand: c.hand || 'none',
      pulse: !!c.pulse,
      on: c.on || 'enter',
      off: c.off || 'advance',
    })),
  }));
}
const clone = (v) => JSON.parse(JSON.stringify(v));
