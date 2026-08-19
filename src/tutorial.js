// ---------------------------------------------------------------------------
// THE ONBOARDING, AS DATA
//
// The teaching level used to be a state machine with its text, its numbers and
// its rules all written into the switch that runs it. That is fine right up to
// the moment somebody wants to change the wording, or hand the player the gun
// one step earlier, or add a leg — at which point every one of those lives in
// a different part of an eight-thousand-line file.
//
// So the SHAPE of the lesson lives here and the MACHINERY stays in main.js.
// This module says which legs are built, what the player is allowed to do on
// each step, and what words appear where and on which beat. main.js says what
// "moved far enough" means and how a barrier sinks into the floor.
//
// tool/ imports this file directly, which is the whole point: what the level
// tool edits is what the game runs, so a preview cannot lie about the game.
// The same property src/genleg.js has for corridors.
// ---------------------------------------------------------------------------

// --- the numbers -----------------------------------------------------------
export const TUTOR = {
  hallCells: 7,         // the straight teaching hallway, in 4 m cells
  moveNeeded: 2.2,      // metres walked before the move lesson is satisfied
  lookNeeded: 0.9,      // radians of yaw swept before the look lesson is
  barrierAt: 8,         // metres ahead the barrier already stands at the start
  barrierH: 1.05,       // low enough to see and shoot over
  enemyAt: 13,          // metres ahead of the player the first one stands
  enemyX: 1.15,         // ...and how far to either side the other two stand.
                        // The teaching leg is one cell wide: 4 m of cell less
                        // 0.3 m of wall each side is 3.4 m of floor, so ±1.7
                        // is the wall itself and a body placed there is IN it.
  // ROUNDS HERE ARE ORDINARY ROUNDS. Same speed in both clocks as every other
  // round in the game, because a tutorial that teaches a slower bullet than
  // the game fires has taught the wrong timing. What makes it fair is not a
  // handicap on the round, it is the beat before it: the prompt is on screen
  // and the arm is visibly rising for well over a second before he pulls.
  aimBeat: 2.6,         // seconds the prompt is up before his arm starts to rise.
                        // Two lines to read, a control they have never seen to
                        // find, and a thumb to move: 1.5 s was a death every
                        // time, which the retry makes survivable but not fair.
  reshoot: 2.6,         // ...and the gap before he tries again after a miss
  shots: 5,
  afterBarrier: 2.0,
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
  finalEnemies: 3,      // ...then two more join him and you shoot all three
};

// --- the legs --------------------------------------------------------------
// One entry per leg the onboarding builds, in order. Everything past the end
// of this list is an ordinary generated leg, which is what ends the lesson.
//
// `straight` is the flag genHallLeg honours: it suppresses the leg's length
// roll, its turns, the no-jog fallback AND the chamber, which is four separate
// places a "straight hallway" can grow a room if you only remember three.
export const LEGS = [
  { id: 'hallway', form: 'corridor', straight: true, cells: 7, barrier: true,
    note: 'The teaching hallway. Dead straight, one cell wide, barrier already standing.' },
  { id: 'room', form: 'vault', straight: false, cells: 7, barrier: false,
    note: 'The first ordinary space, entered once the lesson is over.' },
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

// --- when a cue comes and goes ---------------------------------------------
// The beats a step can emit. A cue names one to appear on and one to leave on,
// which is the whole of "logic for it appearing and disappearing".
export const CUE_EVENTS = [
  ['enter',   'the step begins'],
  ['freeze',  'the player stops time'],
  ['meter',   'the meter warning lands'],
  ['resume',  'the player lets time run again'],
  ['advance', 'the step ends'],
];
// `advance` as a HIDE is the same as "stays until the step ends", because the
// next step clears the screen on the way in. It is spelled out rather than
// left implicit so a cue always states both halves of its own life.
export const CUE_SHOW = CUE_EVENTS.filter(([id]) => id !== 'advance');

// Where words can go. These are the class names #tutormsg takes, plus the top
// slot which is its own element so two cues can share the screen.
export const CUE_SLOTS = [
  ['mid',   'Centre'],
  ['left',  'Left half'],
  ['right', 'Right half'],
  ['atbtn', 'Above the time button'],
  ['top',   'Under the meter'],
];
export const CUE_ARROWS = [['none', 'None'], ['down', 'Down to the button'], ['up', 'Up to the meter']];
export const CUE_HANDS = [['none', 'None'], ['up', 'Swipe up'], ['side', 'Swipe across'], ['tap', 'Tap']];

// --- the sequence ----------------------------------------------------------
// `advance` names the built-in condition in main.js that ends the step. These
// are code, not data — "moved 2.2 m" and "faced within 0.05 rad" cannot be
// expressed as a number — so the tool offers the list rather than a free field.
export const ADVANCE_KINDS = [
  ['moved',    'metres walked'],
  ['looked',   'radians swept'],
  ['faced',    'view eased back down the hallway'],
  ['dodgeDone','the meter lesson is over and time is running'],
  ['gunUp',    'the weapon has finished rising'],
  ['cleared',  'every enemy is down'],
  ['crossed',  'the player walked through the door'],
  ['none',     'never (the last step)'],
];

export const STEPS = [
  {
    id: 'move', label: 'Move',
    advance: { kind: 'moved', need: 2.2 },
    grants: {},
    divider: true,
    cues: [{ text: 'DRAG TO MOVE', slot: 'left', arrow: 'none', hand: 'up',
      pulse: false, on: 'enter', off: 'advance' }],
  },
  {
    id: 'look', label: 'Look',
    advance: { kind: 'looked', need: 0.9 },
    grants: {},
    divider: true,
    cues: [{ text: 'DRAG TO LOOK', slot: 'right', arrow: 'none', hand: 'side',
      pulse: false, on: 'enter', off: 'advance' }],
  },
  {
    id: 'aim', label: 'Face the hallway',
    // The look lesson ends wherever the thumb left them, which can be a blank
    // wall, and the next beat is "a man is standing down there".
    advance: { kind: 'faced', need: 0.05 },
    grants: {},
    cues: [],
  },
  {
    id: 'incoming', label: 'Dodge',
    advance: { kind: 'dodgeDone' },
    grants: { timebtn: true, meter: true },
    placeEnemy: true,          // one gunner at TUTOR.enemyAt, straight ahead
    cues: [
      { text: 'DODGE THE BULLET<span>TAP TO SLOW TIME</span>', slot: 'atbtn',
        arrow: 'down', hand: 'none', pulse: true, on: 'enter', off: 'freeze' },
      { text: 'DODGE THE BULLET', slot: 'atbtn',
        arrow: 'none', hand: 'none', pulse: true, on: 'freeze', off: 'meter' },
      { text: 'YOUR TIME METER IS RUNNING OUT', slot: 'top',
        arrow: 'up', hand: 'none', pulse: true, on: 'meter', off: 'advance' },
      { text: 'DODGE THE BULLET<span>TAP TO RESUME TIME</span>', slot: 'atbtn',
        arrow: 'down', hand: 'none', pulse: true, on: 'meter', off: 'advance' },
    ],
  },
  {
    id: 'gunup', label: 'Weapon up',
    advance: { kind: 'gunUp' },
    grants: { timebtn: true, meter: true },
    cues: [],
  },
  {
    id: 'shoot', label: 'Shoot',
    advance: { kind: 'cleared' },
    grants: { gun: true, fire: true, timebtn: true, meter: true, ammo: true },
    placeSquad: true,          // two more join him, abreast, inside the walls
    cues: [{ text: 'TAP ANYWHERE TO SHOOT', slot: 'mid', arrow: 'none',
      hand: 'none', pulse: true, on: 'enter', off: 'advance' }],
  },
  {
    id: 'advance', label: 'Walk out',
    advance: { kind: 'crossed' },
    grants: { gun: true, fire: true, timebtn: true, meter: true, ammo: true },
    dropBarrier: true,
    openDoor: true,
    cues: [{ text: 'ENTER THE NEXT ROOM', slot: 'mid', arrow: 'none',
      hand: 'none', pulse: false, on: 'enter', off: 'advance' }],
  },
  {
    id: 'done', label: 'Done',
    advance: { kind: 'none' },
    grants: { gun: true, fire: true, timebtn: true, meter: true, ammo: true },
    cues: [],
  },
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
    dropBarrier: !!s.dropBarrier,
    openDoor: !!s.openDoor,
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
