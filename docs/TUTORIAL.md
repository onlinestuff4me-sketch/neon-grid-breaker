# The onboarding

A scripted first level. Not captions over a procedural corridor — a hallway
built for it, with furniture placed by the script and every round in it fired
by the script.

Everything here lives behind `tutorStep !== null`. When it is null the game
does not know the onboarding exists, which is the property `docs/PILLARS.md`
§7 is protecting: nothing in this file may leak into a normal run.

## Where it lives

Split in two, deliberately.

| file | holds |
|---|---|
| **`src/tutorial.js`** | the SHAPE: the numbers, the legs, the steps, what each step grants, and every word it puts on screen |
| **`src/main.js`** | the MACHINERY: what "moved far enough" means, how a barrier sinks, how a body is held on its mark |

`tool/` imports `src/tutorial.js` directly, which is the point — the level
tool's TUTORIAL mode edits the object the game consumes, so its preview is the
real game running the real spec rather than a drawing of one. Same property
`src/genleg.js` has for corridors.

Two rules keep the split honest:

* **the switch in `updateTutorial` is keyed on the step's advance condition,
  not on its name.** The condition is the one part of a step that genuinely
  has to be code, so it is what selects the machinery — and a step is free to
  be renamed to anything without breaking.
* **capabilities are grants, not step comparisons.** "Can they shoot yet" used
  to be `tutorBefore('shoot')`, which meant the answer moved whenever the
  sequence was rewritten; twice it moved somewhere nobody intended. Each step
  now states what it allows, and `tutorMay(cap)` is the only question asked.

## The sequence

`move → look → aim → incoming → gunup → shoot → advance → done`

| step | what the player sees | what ends it |
|---|---|---|
| `move` | `DRAG TO MOVE`, left half, dotted divider, animated thumb. A barrier already stands 8 m ahead so there is something to walk to. | 2.2 m walked |
| `look` | `DRAG TO LOOK`, right half, divider stays | 0.9 rad swept |
| `aim` | nothing; the view eases back down the hallway | facing within 0.05 rad |
| `incoming` | one enemy 13 m out. `DODGE THE BULLET` with `TAP TO SLOW TIME` under it and a line-and-arrow down to the button. After `aimBeat` he goes into the AI's own `aim` state — gun arm up, muzzle white — and fires an **ordinary round at ordinary speed**. On the tap, the sub-line and the arrow go; the headline stays. A beat later `YOUR TIME METER IS RUNNING OUT` lands in the top slot under the meter with a ▲ at it, and the sub-line comes back as `TAP TO RESUME TIME` with the arrow back on the button. | resumed time, after the meter sentence has shown |
| `gunup` | the weapon swings up on the **reload rig** (`fold`), not a bespoke tween | the rise finishes |
| `shoot` | two more bodies join the first, abreast at ±`enemyX` and clamped to the leg's own floor; `TAP ANYWHERE TO SHOOT`; magazine topped up | all three shattered |
| `advance` | barrier sinks, door opens, `ENTER THE NEXT ROOM` | crossing the door |

## What each step grants

Nine capabilities, all off unless a step says otherwise — a tutorial that has
to remember to *take things away* has already given something to somebody by
mistake.

| grant | off means |
|---|---|
| `gun` | no viewmodel on screen |
| `fire` | a tap does nothing |
| `timebtn` | the slow-motion control does not exist yet |
| `meter` | the bank bar is not on screen |
| `bank` | freezing is free — the script owns the bank entirely |
| `ammo` | no magazine line |
| `aiFire` | no enemy STARTS a telegraph of its own; the script decides when an arm goes up, and the ordinary `aim` → `enemyFire` path runs from there |
| `spawns` | the queue is held: nobody arrives unless the script places them |
| `score` | the `DOOR 1 · OPEN — GO` line is hidden |

As shipped, only `gun`, `fire`, `timebtn`, `meter` and `ammo` are ever granted,
and `bank` never is — the bank is scripted for the whole lesson.

## Cues

Each step carries a list. A cue is its words, one of five slots (`mid`,
`left`, `right`, `atbtn`, `top`), an optional pointer (down to the button, up
to the meter), a hand animation, whether it pulses, and the two beats that
bound its life: the one it **appears on** and the one it **leaves on**.

The beats a step can emit are `enter`, `freeze`, `meter`, `resume` and
`advance`. `tutorRenderCues()` is a pure function of the set of beats fired so
far, which is what lets the retry re-enter a step and land on exactly the
right frame.

One centre cue and one top cue can be up at once; a later live cue wins its
slot, which is how `TAP TO SLOW TIME` is swapped for nothing on the tap and
then for `TAP TO RESUME TIME` a beat later.

## The rules it holds while it runs

| rule | why |
|---|---|
| `tutorHoldsSpawns()` — the spawn queue is emptied every frame | a body arriving mid-lesson is the loudest thing on screen |
| `tutorHoldsFire()` — off the `aiFire` grant | the script decides when he raises the arm; once he has, the ordinary `aim` → `enemyFire` path runs untouched, so the tell and the round are the game's, not the tutorial's |
| `el.score` is hidden for the whole onboarding | `DOOR 1 · OPEN — GO` over `DRAG TO MOVE` is two systems talking at once, one of them contradicting the other |
| `tutorHoldsPlayerFire()` — off the `fire` grant | tapping fired a round with no weapon on screen |
| `tutorFreeIsFree()` — the ordinary bank drain is off, entirely | before the meter lesson the freeze is free; during it the script owns the bank. Leaving the ordinary drain running took the bank to zero and auto-resumed time in the middle of the sentence explaining that the bank runs out |
| `showBanner` returns early | `THE DOOR IS OPEN` was landing on `DRAG TO MOVE` |
| the gun, meter and button come off their own grants | they used to be derived from position in `TUTOR_ORDER`, which was already better than the hand-written lists before it — but it still meant reordering the lesson silently moved who could shoot |
| the level tool's override is read only under `?tutorpreview=1` | an afternoon of editing in `/tool` must not be able to reach a real save on the same browser |

## Failing it

The onboarding used to hand out invulnerability: being hit flashed the screen
and the lesson carried on. That taught the one thing this game must never
teach — that a round which connects is survivable. It does not any more.

* a hit during the onboarding kills you with the **ordinary red screen**;
* `recordRun()` is skipped, so a lesson death files nothing and is not a run;
* the overlay drops the stats line and the mode rows, and the button reads
  **`TAP TO TRY AGAIN`**;
* `tutorRetry()` rewinds to the **start of this beat**, not the top of the
  onboarding: the corridor is swept, the player goes back to `tutorAnchor`
  (recorded the instant `incoming` began), the bank refills, and the prompt
  comes back up exactly as it was. You already proved you can walk and look;
  being made to prove it again is how a tutorial turns into a chore.
* `MAIN MENU` on that screen calls `endTutorial(false)` — quitting the lesson
  quits the lesson.

While `tutorDeadPending` is set, `updateTutorial` returns early rather than
calling `endTutorial`, which is what keeps the step alive across the death.

## A trap worth naming

`#tutormsg` took its position from a class name, and one of those names was
`btn`. The app's own `.btn { display:inline-flex }` matched it, the prompt
silently became a flex **row**, and the two lines rendered side by side
running off both edges of the screen — while `getComputedStyle(span).display`
cheerfully reported `block`, because flex items are blockified. The position
class is now `atbtn` and `#tutormsg` states `display:block` outright. If a
tutorial element ever lays out wrongly for no visible reason, check whether
its state class collides with a utility class first.

## The numbers

`TUTOR` in `src/main.js`. The ones with a reason:

* **there is no bullet multiplier** — the round the tutorial fires is the round
  the game fires: `enemyBulletSpeed() * spec.mul`, ~8.8 m/s at wave 1. A
  tutorial that teaches a slower bullet than the game shoots has taught the
  wrong timing. What makes it fair is the beat in front of it, not a handicap
  on the round.
* **`aimBeat: 2.6`** — seconds the prompt is up before his arm starts to rise.
  Add the gunner's own 0.55 s telegraph and ~1.5 s of flight and there are
  over four seconds between the prompt appearing and the round landing. At
  1.5 s it was a death every time, which the retry makes survivable but not
  fair.
* **`enemyX: 1.15`** — the teaching leg is one cell wide: 4 m of cell less
  0.3 m of wall each side is 3.4 m of floor, so ±1.7 IS the wall. The two
  flanking bodies stood at ±2.4 and were inside the masonry.  `tutorPlaceEnemy`
  now clamps to the leg's cell extent as well, because a held body ignores
  collision entirely — the script is the only thing keeping it out.
* **`meterSecs: 7` / `meterCrawlSecs: 70` / `meterKnee: 0.5` / `meterFloor:
  0.25`** — the bank empties at a readable rate to half, crawls to a quarter,
  and stops. The player is being taught that time is finite, not put in a hole
  before anyone has told them how to climb out.
* **`enemyAt: 13`** — at ordinary speed a round covers ~8.8 m/s, so thirteen
  metres is ~1.5 s of flight: long enough to read as a thing travelling
  towards you, short enough that standing still is punished. Placed relative
  to the door on a long leg it was twenty metres, which reads as nothing
  happening.
* **`hallCells: 7`** — plus `LEG.approach`, so ~12 cells of dead straight
  corridor.

## The hallway

`proto.straight` on the first leg. It suppresses **four** things in
`genHallLeg`, and it took two attempts to find them all:

1. `fwd` — the leg's length
2. `run` — the cells between turns
3. the **no-jog fallback** ("a leg is never a straight shot: if the rolls gave
   us none, put a turn in right before the approach")
4. the **chamber**, which a `corridor` leg gets as readily as an atrium, and
   the two **branch lanes**

Miss any one and the "straight hallway" arrives with a five-cell pillared room
in it. Measured when correct: 12 cells, 12 rows, one cell wide, zero pillars.

## Isolation

`tutorResetWorld()` runs on **every** `initHall`, teaching or not. Two bugs
made it necessary:

* a barrier left in a previous run's leg still blocked the corridor in a
  normal game, and the player could not get past it;
* a body left holding station still drew an edge arrow at a wall, and the
  player searched for an enemy that was not findable.

`tutorSeen` is set the moment the tutorial **starts**, not when it finishes, so
quitting halfway cannot re-arm it.

## When it runs

Only when `(!tutorSeen || tutorArmed) && timeMode === 'toggle'`.

* **brand-new player** — `tutorSeen` false, so it teaches
* **everyone else** — off, always
* **Settings → TUTORIAL → NEXT RUN** — arms it for one run, then clears itself
* **New Game on a save slot** — asks once, with a *Don't ask me again* box
  that makes the answer permanent for all future slots

With it off, leg 1 is an ordinary generated leg and contains no tutorial
content of any kind.

## Save slots

Three, in `ts_s{0..2}_*`. The active slot is `ts_slot`, and every progress key
the game already had now reads and writes through it, so nothing else had to
learn about slots. A player with pre-slot progress is migrated into slot 1 on
first boot.

**Continue** drops you at the deepest door the slot has reached. That is the
honest version of "carry on where I was": a leg is procedurally generated and
a fight is live, so the door is the finest grain that can be restored
truthfully rather than approximately. The resume point only ever moves
forward — a run that ends early never costs you ground you had already taken.
