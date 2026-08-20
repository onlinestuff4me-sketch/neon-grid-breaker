# Levels — how a corridor leg is built

One generator, `src/genleg.js`, called by the game and by the level tool at
`/tool`. It is pure apart from `Math.random`: the occupancy grid is passed in
rather than reached for, so a caller can generate a whole run without a game
running underneath.

## Anatomy

A **leg** is one door to the next. It is a chain of **stretches** — a straight
run plus the turn that ends it — followed by the **approach**, the straight
stare down at the door.

```
start ──stretch──┐
                 └──stretch──┐
                             └── approach (4 cells) ── DOOR
```

Cells are `LEG.cellM` = 4 m. The corridor is one cell wide unless something
widens it.

## What can widen or bend it

| feature | when | what it does |
|---|---|---|
| **jog** | rolled between stretches | 3 cells lateral, 2 forward — the corner |
| **no-jog fallback** | if the rolls produced none | forces one right before the approach, so a door is always found around a corner |
| **chamber** | `corridor` and `atrium` forms, spine > 10 | widens a stretch to 5 cells with four pillars in two rows |
| **vault** | `vault` form, once per leg | a 4×4-cell pillared hall, one way in and one way out, exit offset so crossing it is the only route |
| **branch lanes** | 2 normally, 3 for a service run, 0 for gauntlet/vault | alternate routes that only ever move forward and rejoin the spine |
| **`straight`** | a leg that must be a straight shot | suppresses all of the above |
| **an authored plan** | the onboarding's seven legs | suppresses the generator entirely — see below |

Width is the axis a portrait phone does not have — see `docs/PILLARS.md` §5.
That is why the vault is four cells across and not eight.

## Authored legs

`genAuthoredLeg`, in the same file. A leg may carry a **plan** instead of being
rolled:

```js
plan: {
  moves: [['f', 7], ['r', 3], ['f', 4], ['l', 3], …],   // f b r l, in cells
  extra: [[4, 18], [5, 18], …],   // cells hung off the path: a room's width,
                                  // a fork's second lane. Leg-relative.
  approach: 4,
}
```

Moves read as instructions — "seven forward, then three right" — because that
is how a corridor is described. A list of absolute coordinates becomes
unreadable the moment somebody wants the first hallway one cell longer.

It returns exactly the shape `genHallLeg` returns, so `buildHallLeg` cannot
tell the difference and the tool draws and edits both with the same code. Each
change of direction becomes a stretch boundary, so spawn pacing treats an
authored corner exactly like a generated jog.

This is what the onboarding runs on, and it is the answer to a bug that came
back four times: a lesson that depends on a specific corner cannot be built by
something that produces that corner most of the time.

## Forms

From `src/protocols.js`. `corridor`, `serviceRun` (constant turns), `vault`,
`atrium` (mostly chamber), `gauntlet` (one long straight, no recesses).
`gallery`, `stairwell`, `spiral` are registered and not built.

## Who is in it

The leg's enemy budget comes from the leg, not from a number picked per door:
every stretch is worth a few bodies (`LEG.perCell`, growing per door), and the
approach is worth exactly one final group — the wave you clear with the door
in frame. A stretch's share is released when you **walk into it**, so the
fight travels with you and nothing piles up in front of the door.

**The opening doors override this.** `EARLY.oneBodyDoors` = 4: doors 1–4 hold
exactly one body in the whole leg, never more than one alive
(`EARLY.soloDoors`), only gunners until door 6 (`EARLY.gunnerOnlyDoors`), and
through door 5 nobody fires while a round is still on its way to you
(`EARLY.oneRoundDoors`). See `docs/PILLARS.md` §3.

## Conditions and measures

A **condition** changes how the leg looks and what it costs: `fog`,
`blackout`, `dimStrips`. A **measure** is something the building does to you:
`alcoves`, `oneWaySeal`, `grinder`.

Both are gated by `impl` in `src/protocols.js`. `impl: false` covers two
cases — not built, and *built but not yet approved for the main flow*. Fog,
blackout and the grinder are all in the second category: reachable only
through **Settings → TEST**, and the composer cannot pick them at any door or
lifetime (re-verified over 400 runs × 30 doors on every change).

Conditions also carry a **tax** (`CONDITION_TAX`) that multiplies the scarcity
curves a second time — fewer clips, fewer floor guns, less time per kill, and
fewer bodies at once. A condition that only changes what you can see is a
lighting effect; changing what you can afford is what makes it a condition.

## The tool

`/tool` — desktop web, two modes: **LEVELS** and **TUTORIAL**.

### LEVELS

It imports `genleg.js`, `protocols.js` and
`balance.js`, so what it draws is what the game builds.

* every door as an overhead map, with the protocol that composed it
* paint corridor / room / pillar / cover, place entry and exit doors, erase
* **rotate leg** — pick a spine cell and everything past it swings 90° about
  it, carrying its pillars, covers, spawns and exit
* enemy spawns with type: drag, add, delete
* ~200 balance sliders bound to the live values, applied immediately so
  *Reroll layout* shows what a new number actually builds
* **Export JSON** emits layouts and balance overrides together

### TUTORIAL

The onboarding, editable, with the real game running it in the pane on the
right. It imports `src/tutorial.js` — the same module `main.js` consumes — so
the preview is not a mock-up of the lesson, it *is* the lesson.

* **the map** — the same overhead editor a generated door gets, applied to
  whichever tutorial leg is selected, drawn by calling the game's own
  `genAuthoredLeg`. Paint **floor** (a room's width, a fork's lane), drag the
  **path** — the leg's `moves` are re-derived from where you drop it, so a
  corner stays a corner rather than becoming coordinates nobody can read —
  place **enemies** and **pillars**, alt-drag to erase. The barrier, the start
  and the door are drawn but not painted: all three are derived, so they move
  when the geometry does instead of being separately maintained.
* **legs** — add, remove, rename; form, `straight`, and whether the leg starts
  with a barrier standing in it
* **numbers** — every value in `TUTOR` on a slider, each with the reason it
  has the value it has in its tooltip
* **steps** — reorder, add, delete. Each carries:
  * the **advance condition**, chosen from a list rather than typed, because
    "moved 2.2 m" is not something a text box can express — plus its threshold
  * **what the player may do**: nine capabilities, each a checkbox. Weapon in
    hand, can fire, time button, time meter, whether freezing costs, ammo
    readout, whether enemies may fire at all, whether the spawn queue runs,
    and the door/enemy HUD line
  * **what the step brings with it**: place one gunner, place the squad, drop
    the barrier, open the door, show the dotted divider
  * **the text**: any number of cues, each with its words, which of the five
    slots it sits in, whether a pointer runs to the button or up to the meter,
    which hand animation plays, whether it pulses, and — this is the part that
    matters — the beat it **appears on** and the beat it **leaves on**
* **preview** — the real game in an iframe at `?tutorpreview=1`. *Restart*
  reloads it with the current edit; *jump to step* drops the running game
  straight onto a beat with that beat's furniture built; the strip underneath
  reports the live step, the beats that have fired, and what the player may
  currently do

The **beats** a cue can key off are `enter`, `freeze` (the player stopped
time), `meter` (the meter warning landed), `resume`, and `advance`. That pair
— appears-on and leaves-on — is the whole of a cue's life, which is why
`TAP TO SLOW TIME` can be made to vanish the instant the button is used
without anyone touching `main.js`.

Nothing is written back to the repo from the browser. The export is a patch to
hand back, and now carries the tutorial spec alongside the layouts and balance
overrides.

### The preview cannot leak

The tool writes its edited spec to `localStorage['ts_tutor_override']`, and
`loadTutorial()` reads that key **only** when the URL carries
`?tutorpreview=1`. Without the flag it does not look. So an afternoon of
editing cannot reach a real run on the same browser — verified by a test that
plants a deliberately absurd override and confirms an ordinary boot ignores
it.
