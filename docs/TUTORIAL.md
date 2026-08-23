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

Fourteen steps. The spec is `docs/TUTORIAL-GOALS.md`; this table is what the
build does.

| step | what the player sees | ends when |
|---|---|---|
| `move` | `DRAG TO MOVE`, left half, thumb coach, dotted divider. Nothing else on screen at all. | they reach the corner (spine index, not a distance) |
| `look` | `DRAG TO LOOK` joins it on the right with its own coach — **and `DRAG TO MOVE` stays** | they reach the end of the next straight |
| `corners` | both prompts stay through two more turns and a fork that rejoins | **they turn the last corner** |
| `stand` | prompts go; the barrier is already standing 32 m down the straight and `STAND HERE` is on it from this frame | they reach the barrier |
| `dodge` | a gunner appears, raises his arm and **fires** — the world stops with the round ringed in mid-air, `DODGE THE BULLET`, and a thumb swiping side to side directly under the words. Stepping aside releases it; the round goes past at ordinary speed. Three times. | three rounds dodged |
| `shoot` | the other two arrive and the weapon comes up with `TAP ANYWHERE TO SHOOT`. Magazine drawn as cartridges, and it does not run down | all three down |
| `exit` | barrier sinks, door opens, `GO TO THE NEXT ROOM` | they cross |
| `ramp1`–`ramp6` | room/hall/room/hall/room/hall with 1,1,2,2,3,3 enemies. One reminder only: `TAP ANYWHERE TO SHOOT`, once per area, spent when they fire | they cross each door |

**There is no time button anywhere in it, and no meter.** The slow-motion
control is deferred past the whole onboarding and unlocks at door 4 — see
`docs/TUTORIAL-GOALS.md` §5, and `docs/BALANCE.md` for the unlock itself.

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

## The second adversarial round

Three more critics played the build after the first set of fixes. What they
found was a different shape: not clamps that never bit, but **beats that could
be entered and never left**, and controls whose ordinary behaviour was wrong
for one specific beat.

**The meter lesson instructed the player into a dead end.** The prompt said
`TAP TO LET TIME RUN` 1.6 s in. The step ends when the bar has fallen to the
knee AND time is running. The bar only falls while time is slow. So doing
exactly what the screen said stopped the drain, and the knee could never be
reached: measured at 58 s stuck, bar at 97.5%, player alive, nothing on screen
changing. The words wait for the bar now, and until the bar has fallen the
button holds — `tutorRefusesResume()`.
*A prompt that instructs an action the step cannot survive is worse than no
prompt: the player who fails is the one who obeyed.*

**And the sentence under it was false.** `IT REFILLS WHEN TIME RUNS` — the bank
refills on **kills** (`killEnemy`), and at lesson 7 there is nothing to kill.
Lesson 7 says what is true there (`SLOW TIME IS LIMITED`); the refill is named
in the shooting lesson, on the `kill` cue event, at the moment the player can
watch it happen.

**A long press on the freeze beat handed the round back at full speed.** The
time button is a toggle on a quick tap and hold-to-slow on a long press — and
a first-time player who has just read `TAP HERE TO SLOW TIME` presses it like
a button, which is to say slowly. Time snapped back the instant the thumb
lifted, on the one beat in the game with a round already in the air and the
words on screen saying `DRAG TO MOVE`. The freeze and dodge beats latch.
*A control's default behaviour is not neutral during a scripted beat.*

**A retry gave back the beat but not its clock.** `tutorRetry` always called
`setTimeLocked(false)`, so every death on a dodge made the next attempt
strictly harder than the first, with nothing on screen to say time was no
longer slow. The anchor records the clock, and dying on the beat that teaches
the freeze re-arms the freeze (`tutorEverHeld`).

**The barrier outlived the lesson.** `tutorDropBarrier` starts a sink driven by
`tutorUpdateBarrier`, which is called from `updateTutorial`, which returns on
its first line once `tutorStep` is null. END RUN half way through left a slab
standing in the corridor of whatever run came next, frozen at whatever height
it had reached.

**The last step re-entered itself every frame.** `tutorAfter` clamps at the
last id, so a final step whose condition is satisfiable called `tutorNext` on
its own id forever: furniture rebuilt, cue sets re-fired, and the death anchor
dragged along behind the player for the length of the run.

**Two steps with the same id made the sequence a loop.** `tutorAfter` and
`tutorSpecOf` both take the first match, so renaming one step in the tool
produced `move → look → corners → stand → dodge1 → dodgeMove → stand → …` for
as long as anybody cared to watch. Ids are made unique on the way in, and the
tool warns.

## STAND HERE is an object, not a caption

Three attempts at this were all curve-fitting: `620/dist`, capped at 46 px,
floored at 11. Every one of them was wrong somewhere — too small to read at the
far end of the straight, or hitting its ceiling half way down it and going back
to reading as a caption, or (uncapped) filling the frame and eclipsing the slab
it was naming.

A sign does not need a curve. It has a **width in metres**, painted across the
barrier, and the projection already knows what that is worth in pixels from
where the player is standing:

```js
const signM = clamp(tutorBarWidth() * 0.72, 2.4, 4.4);
_vSignA.set(ax - signM / 2, ay, az).project(camera);
_vSignB.set(ax + signM / 2, ay, az).project(camera);
const spanPx = Math.abs(_vSignB.x - _vSignA.x) * 0.5 * w;
```

The text is then scaled to fill that span, measured against its own width at a
known size so any words the tool authors scale by their own metrics rather than
by a constant tuned to "STAND HERE". Measured across the approach, **width ×
distance is constant to 0.4%** — the same arithmetic three.js does for the
barrier itself, so the words and the slab grow together exactly.

Two details that matter:

* the element's padding is in `em`. With `padding: 0 14px` a fixed 28 px sat on
  the end of a proportional measurement and the words drifted out of step with
  the slab. Anything scaled by font-size must be *entirely* scaled by it.
* there is a floor of 8 px and no distance cut-off. It used to vanish past
  46 m, which put its first appearance ten metres down a straight the player
  can see the whole of — a sign popping into existence out of clear air. From
  the last corner it is small and far away, which is what being far away looks
  like.

Visibility is gated on the `finalRun` mark and on actually being on the walked
path (the fork's second lane shares a z with the spine, so a spine *index*
cannot tell them apart — `tutorNearestSpineDist()` can).

## The beat, and why it is shaped like that

The dodge lesson is **one beat played three times**:

1. he appears
2. he raises his arm
3. **he fires**
4. the world stops, with the round in the air and a ring drawn on it
5. `DODGE THE BULLET`, and a thumb swiping side to side directly under it
6. **they step aside** — and that, not a button, is what releases the freeze
7. the round goes past at ordinary speed and the words fade
8. the next one comes

**The freeze lands on the round, not on the arm.** It used to stop the world
part-way up the telegraph, before the trigger — so `DODGE THE BULLET` arrived
with no bullet anywhere on the screen. `TUTOR.freezeAfter` is a *fraction of
the flight*, so it reads the same whoever fires it from wherever they stand.

**A ring is drawn on the frozen round.** A round is 8.5 cm across; nine metres
down a corridor on a phone that is a few pixels, and the beat that stops the
world to point at it was pointing at something the player could not find.

**The release is `TUTOR.dodgeStepM` of sideways movement**, and more sideways
than forward — walking *into* the round is not dodging it. This used to be the
time button. It is not any more, because there is no time button: the freeze
here is the game buying three words' worth of reading time, not a mechanic
being introduced.

**Standing still is not a way to die in this beat.** The round hangs there for
as long as the player leaves it. That is deliberate — goal 4, in its strongest
form — and it means a harness that wants a failed lesson has to ask for one.

**A death keeps the dodges already banked.** `tutorRetry` rewinds to this beat
and does *not* reset `tutorDodged`: dying on the third round and being made to
dodge all three again is being punished for getting two of them right.

## The barrier is a fixture

It stands from the first frame of the run, not from lesson 4 — you turn the
last corner and there is something in the corridor, rather than a corridor that
grows one. Which meant three other things had to move:

* the teaching leg's fork is five cells rather than eight and the run after it
  eleven rather than fourteen, so the barrier is **32 m from the last corner**
  instead of 56. Fifty-six metres of this corridor is a fade to white.
* `corners` ends at `finalRun` — the turn — not at the fork's rejoin, so the
  walking prompts leave and `STAND HERE` arrives on the same frame.
* `tutorJumpTo` had to stop standing every jump at the barrier. With a barrier
  present from step 1, "if there is a barrier, stand at it" teleported a jump
  to *lesson 1* to the end of the corridor, where `reached` fired on the
  arriving frame and cascaded — every jump in the tool landed on the same step.
  A `reached` step now lands at the start of its walk and an `atBarrier` step
  short of the barrier, and the beat counters reset with the jump.

## The training rooms

Six areas — room, hall, room, hall, room, hall — with 1, 1, 2, 2, 3, 3 bodies.
Real fights and checkpoints; the teaching is over.

They used to carry a three-cue loop about the time button. There is no time
button during the onboarding any more, so what is left is the one thing a
player can forget under pressure on their first corridor: the trigger.

`TAP ANYWHERE TO SHOOT`, on `threat` — the first man in the area to start
aiming, so it answers something rather than captioning an empty corridor — and
**`once` per area**, which means *spent by the action it asked for*. Shoot in
this room and the words are gone for this room; the next room starts fresh,
because `tutorSpent` is cleared with the step and an area **is** a step.
`ramp1` carries no cue at all: the trigger was taught one screen ago.

Two other things the training areas do differently:

* **every body leaves a clip**, and **drops do not sink**. Scarcity is the
  lever the whole game hangs off, and it is not a lever anyone can feel before
  they know what it is costing them — so the lesson hands the ammo back every
  time and the curve starts at the first real door. A clip sinking into the
  floor while a first-time player works out that it *is* a clip teaches that
  loot is a reflex test.
* **every area with more than one body in it takes turns** (`fireOrder`). Two
  rounds resolving on the same frame is one loud event a first-time player
  cannot parse; the same two a beat apart is a room reacting to them.

## The line at the top of the screen

`DOOR 1 · 1 ENEMY LEFT` is two systems talking at once to somebody introduced
to neither: a door count from a progression they have not started, and a tally
that reads like a score in a place with no score. During the lesson it reads
**`TRAINING`** and then what to do — `PROCEED DOWN THE HALLWAY`,
`CLEAR THE ROOM`, `GO TO THE NEXT DOOR`.

The instruction is a field on the step (`hud`), so the tool edits it and the
words follow the lesson rather than the geometry. An open door overrides it
with `GO TO THE NEXT DOOR`, because that is a state rather than a step.

## The handover, and the opening ramp

**One banner:** `TRAINING COMPLETE · GO TO THE NEXT DOOR`. It used to be two,
followed by the new leg's own headline — three instructions in five seconds, on
the exact frame that everything the lesson had been withholding arrived at
once. (`IT OPENS UP`, the atrium form's headline, is gone too; it described
nothing a player could act on.)

**Door 1 was empty.** `PLAYING` grants `spawns: false`, because a training
area's bodies come from the LEG rather than the spawn queue. But `done` is
entered on crossing into the **first real leg**, whose wave has just been
composed and queued — so `tutorHoldsSpawns()` emptied that queue every frame
until the onboarding finished ending. `done` grants `spawns: true`.

**And the opening ramp is four dials on four schedules.** The whole table, the
shape it is built on and what it replaced are in `docs/BALANCE.md`; the short
version is that a door is made of legs now, a door has a budget its legs split,
and "more rooms" / "more bodies" / "more at once" / "they shoot sooner" never
arrive on the same door.

## The pause button was gone for eight lessons

`body.tutoring:not(.armed) #pausebtn { opacity: 0 }` — the onboarding owning
the screen. But the death screen of a *failed* lesson deliberately has no
`MAIN MENU` (writing `timeshard_taught` on the first frame means quitting there
would lose the onboarding for good), so the pause menu's END RUN is the only
way out of the tutorial at all. A player who wanted to stop was trapped in it.
Two characters in a corner are not an instruction competing with the lesson.

And `tutorRetry` handed the button back with `style.display = ''` — the base
rule is `display: none`, so the empty string handed it back to the stylesheet
and a single death removed it for the rest of the run.

## The shot that did nothing

Shooting at the three men in lesson 8b did nothing at all: no shatter, no
body removed, no barrier, no way forward. One line:

```js
// playerFire(), since the very first onboarding commit
tutorFired = true;
```

`tutorFired` had been a boolean — *the player has pulled the trigger during the
onboarding* — for a version of the shoot step that no longer exists. When the
cue system was built it took the same name for its `Set` of fired events, and
the declaration changed from `false` to `new Set()`. The assignment did not.

So the first shot of the onboarding replaced the cue Set with `true`. The very
next `tutorEmit` threw `tutorFired.add is not a function` — and the next one to
run was the `kill` emit, which sat **near the top of `killEnemy`**, before
`spawnShatter` and before the body was spliced out of `enemies`. The exception
took the kill with it. The round hit, the man stood there, and the lesson
waited for a floor that could never clear.

Two things came out of it, both worth keeping:

* **a cue is a caption on something that has happened, so it runs last.**
  `tutorEmit('kill')` is now the final line of `killEnemy`. Anything it throws
  can no longer abort the kill it is describing.
* **no test had ever pulled the trigger.** `walk.js` clears the floor with
  `__ts.killAt(0)`, which calls `killEnemy` directly and never touches
  `playerFire` — so the whole suite could be green with the game's own weapon
  broken inside the lesson that teaches it. `shatter.js` fires the actual
  weapon at the actual bodies and follows it through: three shatters, the
  barrier down, the door open, `GO TO THE NEXT ROOM`.

A harness note that cost an hour on the way: `playerFire` aims with
`camera.getWorldDirection`, and the camera takes its yaw from the player in the
frame loop — so setting `player.yaw` and firing on the same tick sends the
round wherever you were looking *before* the turn. The third man looked
unkillable. Let a frame pass after any scripted turn.

## Five things you could not see

The critics' visual pass found five, and four of them were the same mistake:
something drawn in the game's red on a screen that bullet time washes pink.

* **the round itself.** `body.slowmo` runs the canvas through
  `saturate(.5) contrast(1.12) sepia(.35) hue-rotate(-28deg)`: the corridor
  goes pale pink and a red round with a red halo goes with it. Measured at
  14 m during the dodge lesson it was a smudge the colour of the wall behind
  it — on the one beat whose instruction is *dodge the bullet*. Enemy rounds
  now carry an inverted-hull rim in near-black, which reads against a pale wash
  and a dark corridor equally, in both clocks, for one draw call each.
* **the ammo readout.** Near-black ink at `bottom: 11vh`, which is inside the
  bottom vignette bar — dark on dark, so the round count arrived on the
  shooting lesson as three invisible characters. It gets the light halo every
  other instruction on this screen already had.
* **the arrow up at the meter.** A bare 24 px `▲` glyph — about eight pixels
  of ink — sitting opposite a 42 px-wide drawn line with a travelling head.
  The two halves of one idea did not read as one idea, and the arrow pointing
  at the thing the whole lesson is about was the fainter of the two. It is
  built the same way as its opposite now.
* **the two hand coaches.** The move coach travelled up and vanished; the look
  coach slid back and forth and never faded, on a different clock. In lesson 2
  they are on screen together, level with each other, demonstrating two halves
  of one idea. Both now fade in, travel once and fade out, together.
* **orphan wraps.** `text-wrap: balance` on every cue slot: a half-width slot
  breaking `DODGE THE BULLETS` wherever it happened to fit is a prompt that
  looks like a mistake.

## Marks are derived, never typed

A mark is a named cell on the walked path: `firstCorner`, `secondRun`,
`finalRun`, `forkEnd`. They are read in three places — the STAND HERE gate, the
barrier's anchor, and `tutorBarrierZ` — and they used to be authored as
literals next to the leg.

The level tool can redraw that path. Redrawing it left the marks behind: the
barrier stood 24 m inside solid rock, lesson 4 waited for the player to reach a
cell the corridor no longer had, and the sign was gated off a spine index the
leg never reached. An empty corridor, no words, no way forward, no error.

`marksFromPlan(plan)` computes all four from the moves, plus the fork's rejoin
from the `extra` cells (the one mark the moves alone cannot state — it is the
furthest cell of the walked path that any side-lane cell touches). It runs on
every load for every leg, so a path edit cannot strand them. On the shipped leg
it reproduces the hand-written numbers exactly: 7, 14, 24, 32.

A step's `advance.need` may then **name** a mark rather than quote a number,
which is how a lesson says "ends at the corner" and stays right when the corner
moves. `reached` also clamps to the spine that exists, so a stale mark can no
longer make a lesson unfinishable.

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
* there is **no** `MAIN MENU` on that screen. `timeshard_taught` is written on
  the lesson's first frame, so quitting from here would lose the onboarding for
  good and the only route back is a Settings row signposted nowhere. One
  button. (The pause menu's END RUN still works, and that is an ordinary death
  with an ordinary menu.)
* the retry restores the beat's **clock** as well as its furniture, clears the
  frozen world, re-arms the freeze if this is the beat that teaches it, and
  refills the bank only where the onboarding says the bank is free.

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
* **`enemyCells: 4` / `barrierCells: 3`** — measured from the fork's rejoin and
  from the barrier respectively, so the whole combat section moves with the
  geometry instead of with numbers somebody has to remember to change. Both
  came down: at six cells the barrier stood 56 m from the last corner, which on
  a phone is a corridor fading to white rather than a thing you can see; at
  five the gunner was a figure a centimetre tall firing a round the player had
  to be *told* was there.
* **`freezeAfter: 0.45` / `dodgeScale: 0.18`** — where the world stops (as a
  fraction of the round's flight, so it reads the same whoever fired it) and
  the floor under world speed while a taught round is in the air. See "the
  beat" above for why both exist.
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
