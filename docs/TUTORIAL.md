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

Eighteen steps carrying fifteen lessons. The spec is
`docs/TUTORIAL-GOALS.md`; this table is what the build does.

| step | lesson | what the player sees | ends when |
|---|---|---|---|
| `move` | 1 | `DRAG TO MOVE`, left half, thumb coach, dotted divider. Nothing else on screen at all. | they reach the corner (spine index, not a distance) |
| `look` | 2 | `DRAG TO LOOK` joins it on the right with its own coach — **and `DRAG TO MOVE` stays**, because the point is that looking is a separate action you do at the same time | they reach the end of the next straight |
| `corners` | 3 | both prompts stay up through two more turns and a fork that rejoins | they reach the fork's rejoin |
| `stand` | 4 | prompts go; `STAND HERE` hangs over a barrier six cells on | they reach the barrier |
| `dodge1` | 5 | a gunner appears five cells beyond it, raises his arm, and **the world stops** mid-telegraph. `DODGE THE BULLET` over `TAP HERE TO SLOW TIME`, pointer on the button | they press the button |
| `dodgeMove` | 5b | everything resumes at ordinary slow motion; the prompt becomes `DRAG TO MOVE` again | the round goes past |
| `dodge3` | 6 | two more appear; rounds arrive one at a time, `volleyGap` apart. No meter yet, so slow motion is free | three rounds dodged |
| `meter` | 7 | the bar appears for the first time, drains, and explains itself | they let time run |
| `gunup` | 8a | the weapon rises on the reload rig | the rise finishes |
| `shoot` | 8b | `TAP ANYWHERE TO SHOOT`; magazine topped up | all three down |
| `exit` | 9 | barrier sinks, door opens, `GO TO THE NEXT ROOM` | they cross |
| `ramp1`–`ramp6` | 10–15 | room/hall/room/hall/room/hall with 1,1,2,2,3,3 enemies. No prompts: the teaching is over | they cross each door |

## The legs

Seven, all **authored** — `genAuthoredLeg` in `src/genleg.js`, driven by a plan
of moves (`['f', 7]`, `['r', 3]`) rather than rolled. "A straight run, then a
right turn, then a fork that rejoins" is a sequence of specific corners, and a
generator that produces something like it four times out of five is no use for
a lesson whose point is that the player knows what is coming.

The teaching leg is 148 m: seven cells straight, right, four, left, four,
right, three, the fork's five, then fourteen for the barrier, the dodging, the
shooting and the door. Its marks (`firstCorner`, `secondRun`, `forkEnd`) are
**derived from the move list**, so lengthening the first hallway in the tool
moves the lessons with it instead of silently breaking them.

The ramp legs carry their own `enemies` and a `fireOrder`, because it is the
*room* that is "the room with two in it" — a step cannot own them, or the
retry could not rebuild the area without replaying the step.

## The text slots

Six elements, one per slot, all able to be on screen together: `mid`, `left`,
`right`, `atbtn`, `top`, and `world`. They used to be a single element that
took its position from a class, which made `DRAG TO MOVE` and `DRAG TO LOOK`
mutually exclusive — and lesson 2 exists to say they are not.

`world` is anchored in 3D and projected every frame, so `STAND HERE` hangs
over the barrier and grows as you walk up to it. There are two coach hands for
the same reason there are six slots.

## The hard freeze

`dodge1` sets `hardFreeze`. When the gunner's telegraph passes `freezeAt` of
its length, `tutorWorldHeld` goes true and `timeScale` is **snapped to zero**
after the ease — arm stopped mid-raise, no round in the air, nothing moving.
It is released by the button and by nothing else: measured holding for 240
frames with the arm not moving by 0.01 rad.

That is the only way to be sure a first-time player has read the prompt before
a round is in flight. Everything after it runs at ordinary speed, because a
tutorial that teaches a slower bullet than the game fires has taught the wrong
timing.

## Four bugs the playtest found, and what they were really about

Three independent critics played the rebuild. The pattern in what they found is
worth more than the fixes:

**A clamp that never bit.** The squad was clamped to "the leg's cell extent" —
except the teaching leg zig-zags across six columns, so the permitted range was
23 m wide in a 3.4 m corridor. The check existed, read correctly, and did
nothing. Bodies landed inside walls, where they are invisible AND unkillable
(417 rounds through the chest of one against 11 for a body on the floor), and
`shoot` waits on `cleared` — so the lesson deadlocked for anyone who dodged.
*A bound derived from the wrong set is worse than no bound: it looks like the
problem is handled.*

**A constant whose comment and code disagreed.** `meterSecs: 7 // full to half`
was read as full-to-empty, so the half being introduced went in 3.5 s.

**A lesson that could be passed by not doing it.** The meter step ended on
`meterSaid && !timeLocked`. Arrive with time already running and both are true
at 1.6 s with the bar at 100%. Goal 4 says progress on success; nothing checked
that the success had happened.

**A mode switch one tap away.** The pause menu's BUTTON/CLASSIC link is
reachable throughout, and lesson 5 waits on the time *button*. Switching
mid-lesson removed the button, left `timeScale` at 0, and pointed an arrow at
nothing — unfinishable, with the only exit permanently ending the onboarding.
*Every control that is reachable during a scripted beat is part of that beat's
state machine whether it was designed to be or not.*

## Failing it

The onboarding used to hand out invulnerability: being hit flashed the screen
and the lesson carried on. That taught the one thing this game must never
teach — that a round which connects is survivable. It does not any more.

* a hit during the onboarding kills you with the **ordinary red screen**;
* `recordRun()` is skipped, so a lesson death files nothing and is not a run;
* the overlay drops the stats line and the mode rows, and the button reads
  **`TAP TO TRY AGAIN`**;
* `tutorRetry()` rewinds to the **start of the current area**, not the top of
  the onboarding: the corridor is swept, the player goes back to `tutorAnchor`
  (recorded when the area began), the bank refills, and the step is re-entered
  so its declared furniture is rebuilt. You already proved you can walk and
  look; being made to prove it again is how a tutorial turns into a chore.
  Goal 4 in the other direction: failing costs this area and nothing further.
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

`TUTOR` in `src/tutorial.js`, every one of them on a slider in the tool. The
ones with a reason:

* **there is no bullet multiplier** — the round the tutorial fires is the round
  the game fires: `enemyBulletSpeed() * spec.mul`, ~8.8 m/s at wave 1. A
  tutorial that teaches a slower bullet than the game shoots has taught the
  wrong timing. What makes the first one fair is not a handicap on the round,
  it is that the world stops until the button has been pressed.
* **`freezeAt: 0.55`** — how far into the telegraph the world stops. Late
  enough that the arm is visibly up and the intent is unmistakable, early
  enough that nothing has been fired.
* **`aimBeat: 1.2`** — seconds from the gunner appearing to his arm starting to
  rise. Much shorter than it needed to be before the freeze existed: the prompt
  no longer has to be read against a clock, so this only has to be long enough
  to see him arrive.
* **`enemyCells: 5` / `barrierCells: 6`** — measured from the fork's rejoin and
  from the barrier respectively, so the whole combat section moves with the
  geometry instead of with numbers somebody has to remember to change. Five
  cells is 20 m: about 2.3 s of flight, long enough to read as a thing coming
  towards you.
* **`enemyX: 1.15`** — a one-cell leg is 4 m of cell less 0.3 m of wall each
  side: 3.4 m of floor, so ±1.7 IS the wall. The flanking bodies stood at ±2.4
  and were inside the masonry. `tutorPlaceEnemy` clamps to the leg's cell
  extent as well, because a held body ignores collision entirely — the script
  is the only thing keeping it out.
* **`volleyGap: 2.6`** — between rounds in the three-round lesson. Long enough
  that each is its own event rather than a stream.
* **`meterSecs: 7` / `meterCrawlSecs: 70` / `meterKnee: 0.5` / `meterFloor:
  0.25`** — the bank empties at a readable rate to half, crawls to a quarter,
  and stops. The player is being taught that time is finite, not put in a hole
  before anyone has told them how to climb out. The crawl below the knee takes
  ~17 s on its own, which is why a test that watches for 28 s and calls the
  descent a failure is testing its own patience.
* **`standWithin: 2.6`** — metres from the barrier that count as standing at
  it. Wide enough that walking into the thing satisfies it.

## The hallway

The teaching leg is **authored**, not generated, so `proto.straight` no longer
has to hold the line for it. It is still there and still matters for any
generated leg that wants to be straight, and it still suppresses **four**
separate things in `genHallLeg`:

1. `fwd` — the leg's length
2. `run` — the cells between turns
3. the **no-jog fallback** ("a leg is never a straight shot: if the rolls gave
   us none, put a turn in right before the approach")
4. the **chamber**, which a `corridor` leg gets as readily as an atrium, and
   the two **branch lanes**

Miss any one and a "straight hallway" arrives with a five-cell pillared room
in it. This is the bug that authored geometry exists to make impossible.

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
