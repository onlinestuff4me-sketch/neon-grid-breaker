// ---------------------------------------------------------------------------
// THE MODE REGISTRY — every mode the game can start.
//
// One list, two readers: the menu's CHOOSE A GAME picker and the MODES
// section in Settings both render from this, so a mode cannot exist in one
// and not the other, and its one-line description cannot say two different
// things in two places (docs/PILLARS.md §7).
//
// ORDER: the main game first, then the rest in the order they were built.
//
// Those are two different jobs and neither one alone does both. The top of a
// list is where a reader looks first, and what they should find there is the
// game — not the oldest thing we happen to still ship. Everything under it is
// in build order because that is the only ordering of the alternates that
// stays true on its own: alphabetical says nothing, "best first" is an
// opinion that goes stale, and newest-first would reshuffle the list every
// time we prototype. So the list reads as "here is the game, and here is
// everything else we have tried, oldest first", which is what it is.
//
// `main: true` is what puts a mode at the top of both lists, and it is also
// the game a first launch opens on (`DEFAULT_MODE` in main.js reads it). One
// flag, so those two cannot disagree.
//
// `line` is one line. It is the whole description a player gets, so it says
// what you DO, not what the mode is about.
//
// `unit` is what one step of progress is CALLED in that mode, because the
// leaderboard is per mode and "WAVE 12" is a lie in a game made of doors.
// `null` means the count does not move there and the board leaves it out
// rather than ranking everybody equal-first.
// ---------------------------------------------------------------------------

export const MODES = [
  {
    id: 'hall',
    unit: 'DOOR',
    name: 'THE TUNNEL',
    line: 'Door to door, deeper each time. The main game.',
    main: true,
  },
  {
    id: 'wave',
    unit: 'WAVE',
    name: 'CITY STREETS',
    line: 'Endless waves in the white city — the original arena.',
  },
  {
    id: 'rush',
    unit: null,
    name: 'RUSH HOUR',
    line: 'Freeze the crowd, find the one face that matters, walk out.',
  },
  {
    id: 'duel',
    unit: 'ROUND',
    name: 'CORRIDOR DUEL',
    line: 'They come to you. Drag to sidestep, tap them to shatter.',
    simple: true,
    // Time is not yours here: it drops on its own while a round is in the air.
    time: 'incoming',
  },
  {
    id: 'stop',
    unit: 'ROUND',
    name: 'STAND STILL',
    line: 'Time only moves while you do. Stand still and the world waits.',
    simple: true,
    time: 'motion',
  },
];

export const modeById = (id) => MODES.find((m) => m.id === id) || null;

// The simplified modes: one movement mechanic, no look, no time button. Kept
// as a predicate rather than a list of ids in main.js so adding a third one
// is a line in this file and nothing else.
export const isSimple = (id) => !!(modeById(id) || {}).simple;
