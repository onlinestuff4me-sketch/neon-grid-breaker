# TIME SHATTER — balance reference

## The opening ramp

Four dials decide how many men stand behind a door, a fifth — the **speed
staircase** — decides how fast their rounds travel, and the staircase in turn
decides the door slow time is unlocked on and the ten-door **school** that
teaches it. There is a published reference for the first four at the artifact
linked from the README; this file is the source of truth all of it is generated
from, and `/tool` → **RAMP** is where the numbers are actually moved.

### The shape every dial moves on

**Hold a value. Step up by one. Then hold the next one for LONGER.**

```js
ramp(d, first)   // value 1 covers doors 1..first,
                 // value 2 the next first+1,
                 // value 3 the next first+2, …
```

The bands *widen*, so every new number gets more room than the one before it.
That is the opposite of a curve that compounds, and it is the whole reason this
exists. Each dial takes one number — how many doors its first band lasts — and
the rest follows.

### Why there are four of them, on four schedules

Because **one change per step** is the idea, and the only way to enforce it is
to make the dials land on different doors:

* door 3 is the first with two bodies in it — but still one alive at a time.
  The same beat twice, not a new problem.
* door 4 is the first time two can meet you together.
* door 5 is the first door made of two legs — more corridor, not more men.

"More rooms", "more bodies", "more of them at once" and "they shoot sooner"
must never arrive on the same door.

### The dials, one at a time

**`legsEvery` — legs per door** (first band 4 doors, capped at 5)

How many corridors and rooms stand behind one door. **Only the last leg of a
door counts as the door**; the ones before it are more corridor behind the same
number, and `hall.legInDoor` is which of them you are standing in. This is what
lets "how far to the next door" grow independently of "how hard the door is" —
depth becomes a longer walk as well as a busier one.

**`bodiesEvery` — bodies per door** (first band 2 doors)

How many enemies the whole door holds, across all its legs. **This is the
primary dial**, and the only one that decides a count.

There is deliberately **no separate "bodies per leg" dial**. A door's budget is
split evenly across its legs, remainder to the last of them (`legShare`), so the
per-leg count is a *result*: 1 while a door holds one, 2 when a single-leg door
holds two, and back to 1 the moment the door grows a second leg. A dial on top
of that could only ever clip the budget — an early version capped door 3 at one
body per leg, which turned door 3 straight back into door 1.

**`aliveEvery` — alive at once** (first band 3 doors)

How many may be on you at the same time, never more than the door holds. This
is the dial that decides whether a door is a queue or a swarm, so it is the one
that moves least. A condition thins it further (`condTax`): two bodies met
separately are two searches, where a clump is one problem solved once.

**shot gap** (`gapFrom` 3s, held flat until door 10, reaching `gapTo` 0.28s at door 25)

World seconds between one enemy firing and the next — the room's shot floor.
Three seconds means every round is its own event rather than a room going off at
once, which is exactly what the opening doors are teaching. Measured in *world*
seconds, not real ones, so it stretches with everything else in bullet time.

### Bullet speed is a staircase, not a slope

It used to be a line — `floor + range x diffT`, a new speed on every single
door. Nobody acclimatises to a number that never sits still: each door was a
little faster than the one before it and no speed was ever *the* speed you had
learned. It steps now, and each tread is wide enough to stand on.

| doors | m/s | why |
|---|---|---|
| 1–5 | 5.4 | crosses a 16 m room in three seconds — a round you watch coming and walk out of |
| 6–10 | 5.8 | one tread up, held just as long: the smallest change worth noticing |
| 11 onward | +0.2 every 2 doors | a tread every couple of doors |
| the door it reaches 13.0 | 13.0 | **slow time unlocks**, and the staircase stops |
| ...and 10 doors after it | 13.0 | the school (below). One new thing at a time |
| then | +0.2 every 2 doors, to 21.6 | climbing again, with the power in hand |

`SPEED` in `src/balance.js`, read by `speedAt(door)`.

Every dial in it arrives from outside — the RAMP pane drives them from sliders
and its export can be hand-edited and pasted back — so `speedAt` and
`unlockDoor` clamp before they compute. A tread of zero used to make the unlock
door `Infinity` and the bullet speed `NaN`; a negative tread sent rounds
backwards; an `unlockM` at or below `holdM` made the staircase *drop* at the
unlock. And the solve is done in integers: `ceil((8.4 - 3) / 0.15)` is 37 in
floating point and 36 in arithmetic, which is the difference between "the door
it first reaches the speed on" and two doors later.

### The unlock is the tunnel's, and only the tunnel's

Everything below is about `game.mode === 'hall'`. The other four modes do not
have a staircase, a school or an unlock:

* **Corridor duel** and **Stand still** have no time button at all, so there is
  nothing to unlock. They share the opening ramp — they are corridor games with
  the same four beats — but not the school, which is a lesson about a control
  they do not have. (It used to run in both of them: volleys they cannot answer,
  and a coach line naming a meter that is not on screen.)
* **Classic** time mode — hold to slow, no button, no bank — is not a separate
  mode but it is a separate rule. Slow motion is gated by the same unlock door,
  but there is no meter and no coach; the school's volleys are simply a fight.
* **Rush hour** has no doors, so `1 + rushT / 25` stands in for one. It is
  explicitly told to skip the school plateau: a flat stretch of speed from
  2000 to 2250 seconds of run clock, for a lesson that mode never runs, is a
  bug and not a curve.

### The door the power lands on is solved, not typed

Slow time is not unlocked on a door number somebody picked. It is unlocked by
the **speed reaching `SPEED.unlockM`** — the point at which walking out of a
round stops being enough — and `unlockDoor()` solves the staircase for the door
that happens on. On the shipped numbers that is **door 46**. Everything keys off
that one answer: the button, the meter, the STAND HERE corridor that teaches it,
and the school that follows. Move any tread and the whole lesson moves with it,
because none of them carries a number of its own.

There used to be a hand-typed `TIME.unlockDoor` here, and it could — and did —
drift out of step with the speed it was supposed to be answering.

**It is simply what the treads add up to**: 36 steps of 0.2 from 5.8, one door
each. `unlockM` is 13 because that is what the old ramp topped out at
(16 × 0.79 = 12.64), so it is the speed the power was implicitly balanced
against before any of this existed.

<!--door-ok-->`stepDoors` was **2**, which put the unlock on door 81 — at roughly a minute a
door, about an hour of play before the core mechanic of the game appears at
all. Halving the tread WIDTH rather than doubling its HEIGHT was the fix worth
making: every step is the same size underfoot as it was, the staircase just
stops spending two doors on each.

At roughly a minute a door that is about an hour of play before the core
mechanic appears, and most players will never see it. Nothing about the speed
curve has to change to fix that — the treads are twice as wide as they need to
be. <!--door-ok-->`stepDoors` 2 → 1 puts the unlock on **door 46**; `stepM`
0.2 → 0.4 does the same while keeping two-door treads. `/tool` → **RAMP** prints the solved door
above the table and moves it as you drag.

### The slow-time school — the ten doors after the unlock

A power you are never made to want is a button you never press. For seventy
doors the answer to a round is to walk out of it, and that answer keeps
working — handing over the time button changes nothing on its own. So the doors
right after it are built to ask the question:

* **they fire in volleys.** Several men at once is the one shape a sidestep
  cannot solve, because there is no side that is out of all of them. Two on the
  unlock door, three by four doors in (`SCHOOL.volley`, `volleyBuild`).
  A volley's telegraphs are *started* together — removing the gap between shots
  was not enough, and measuring said so: the rounds still arrived 0.9–1.8 s
  apart, evenly, because the gap only governs when a telegraph *ends*. The
  rounds then leave `volleySpread` (0.18 s) apart rather than on one frame, so
  it reads as three men and not as one noise. Measured rhythm: **0.2, 0.2,
  2.45**, repeating.
* **the men in a volley stand together** (`clusterM`, 4.5 m). The answer to a
  volley — slow time, sweep across the group — has to pay for itself. A volley
  spread down forty metres of corridor costs a full tank and returns one kill.
* **the meter is cheap here.** Drain at 0.45x, kills paying 2x
  (`drainMul`, `bonusMul`). The lesson is what the power is *for*, not what it
  costs.
* **the speed holds flat** at 13.0 for all ten doors. One new thing at a time.

And it has a **mercy rule**. Running the bank dry in a room that only volleys is
a hole you cannot climb out of: no meter, no answer, and the next volley arrives
anyway. So an empty bank calms the room — back to one round in the air at a
time, the metronome from the opening doors, which is survivable by walking and
gives the kills back. It is hysteretic on purpose: dry at 0.35 s left
(`dryAt`), and not volleying again until the bank is back to 2.5 s (`wetAt`).
A single threshold flapped on the frame a kill paid out, which reads as a room
that cannot make up its mind.

Three lines of coach text ride on those states, in the onboarding's own slots:
*TAP TO SLOW TIME* when a volley telegraphs and the button has gone untouched,
*TAP AGAIN TO RESUME* when time is slow and the tank is nearly out, and
*SHATTER THEM TO REFILL YOUR METER* while the room is calm.

The lesson that introduces all of this is a second tutorial course — see
docs/TUTORIAL.md.

### A gap only works if a man will actually wait that long

`shotGap()` says three seconds for the opening doors. He would wait `0.6`.

The turn-taking rule holds a man at the end of his telegraph while somebody
else's round is still the room's most recent event, with a ceiling so a crowd
cannot deadlock each other into never firing. That ceiling was a flat 0.6 s —
**shorter than the gap for every door up to about 20**. Measured at door 8,
where the gap says three seconds: real intervals of 1.95, 0.4, 0.05, 0.05, 0.2,
0.3. Two rounds five hundredths of a second apart is precisely the "one loud
event you cannot parse" the floor exists to prevent, happening on the doors
written to prevent it.

The ceiling is now `gap + OPENING.holdSlack`, so the gap decides and the slack
is only the deadlock guard it was always meant to be. Same door, after:
3.03, 2.0, 0.1, 2.95, 2.2, 0.45, 2.65. **This makes the middle doors
meaningfully slower than they have been playtested at** — it is the behaviour
the numbers always claimed, but it is a change, and `holdSlack` is the dial to
revert it with.

### Corridors only, until door 4

A vault, an atrium or a gallery is a second thing to read on a door whose whole
job is the four beats — see him, watch the round leave, step out of it, shatter
him. `forced()` pins the form.

### The whole curve

| door | legs | bodies | split | alive | m/s | gap | volley |
|---|---|---|---|---|---|---|---|
| **1** | 1 | 1 | `1` | 1 | 5.4 | 3.00 |  |
| 2 | 1 | 1 | `1` | 1 | 5.4 | 3.00 |  |
| **3** | 1 | 2 | `2` | 1 | 5.4 | 3.00 |  |
| **4** | 1 | 2 | `2` | 2 | 5.4 | 3.00 |  |
| **5** | 2 | 2 | `1+1` | 2 | 5.4 | 3.00 |  |
| **6** | 2 | 3 | `1+2` | 2 | 5.8 | 3.00 |  |
| 7 | 2 | 3 | `1+2` | 2 | 5.8 | 3.00 |  |
| **8** | 2 | 3 | `1+2` | 3 | 5.8 | 3.00 |  |
| 9 | 2 | 3 | `1+2` | 3 | 5.8 | 3.00 |  |
| **10** | 3 | 4 | `1+1+2` | 3 | 5.8 | 3.00 |  |
| 11 | 3 | 4 | `1+1+2` | 3 | 6.0 | 2.82 |  |
| 12 | 3 | 4 | `1+1+2` | 3 | 6.0 | 2.64 |  |
| **13** | 3 | 4 | `1+1+2` | 4 | 6.2 | 2.46 |  |
| 14 | 3 | 4 | `1+1+2` | 4 | 6.2 | 2.27 |  |
| **15** | 3 | 5 | `1+2+2` | 4 | 6.4 | 2.09 |  |
| **16** | 4 | 5 | `1+1+1+2` | 4 | 6.4 | 1.91 |  |
| 17 | 4 | 5 | `1+1+1+2` | 4 | 6.6 | 1.73 |  |
| 18 | 4 | 5 | `1+1+1+2` | 4 | 6.6 | 1.55 |  |
| **19** | 4 | 5 | `1+1+1+2` | 5 | 6.8 | 1.37 |  |
| 20 | 4 | 5 | `1+1+1+2` | 5 | 6.8 | 1.19 |  |
| **21** | 4 | 6 | `1+1+2+2` | 5 | 7.0 | 1.01 |  |
| 22 | 4 | 6 | `1+1+2+2` | 5 | 7.0 | 0.82 |  |
| **23** | 5 | 6 | `1+1+1+1+2` | 5 | 7.2 | 0.64 |  |
| 24 | 5 | 6 | `1+1+1+1+2` | 5 | 7.2 | 0.46 |  |
| 25 | 5 | 6 | `1+1+1+1+2` | 5 | 7.4 | 0.28 |  |
| **26** | 5 | 6 | `1+1+1+1+2` | 6 | 7.4 | 0.28 |  |
| 27 | 5 | 6 | `1+1+1+1+2` | 6 | 7.6 | 0.28 |  |
| **28** | 5 | 7 | `1+1+1+2+2` | 6 | 7.6 | 0.28 |  |
| 29 | 5 | 7 | `1+1+1+2+2` | 6 | 7.8 | 0.28 |  |
| 30 | 5 | 7 | `1+1+1+2+2` | 6 | 7.8 | 0.28 |  |
| **35** | 5 | 7 | `1+1+1+2+2` | 7 | 8.4 | 0.28 |  |
| **40** | 5 | 8 | `1+1+2+2+2` | 7 | 8.8 | 0.28 |  |
| **50** | 5 | 9 | `1+2+2+2+2` | 8 | 9.8 | 0.28 |  |
| **60** | 5 | 10 | `2+2+2+2+2` | 9 | 10.8 | 0.28 |  |
| **70** | 5 | 11 | `2+2+2+2+3` | 10 | 11.8 | 0.28 |  |
| **80** | 5 | 12 | `2+2+2+3+3` | 11 | 12.8 | 0.28 |  |
| **81** | 5 | 15 | `3+3+3+3+3` | 11 | 13.0 | 2.40 | 2 |
| 82 | 5 | 15 | `3+3+3+3+3` | 11 | 13.0 | 2.40 | 2 |
| **83** | 5 | 20 | `4+4+4+4+4` | 11 | 13.0 | 2.40 | 3 |
| 84 | 5 | 20 | `4+4+4+4+4` | 11 | 13.0 | 2.40 | 3 |
| 85 | 5 | 20 | `4+4+4+4+4` | 11 | 13.0 | 2.40 | 3 |
| 86 | 5 | 20 | `4+4+4+4+4` | 11 | 13.0 | 2.40 | 3 |
| 87 | 5 | 20 | `4+4+4+4+4` | 11 | 13.0 | 2.40 | 3 |
| 88 | 5 | 20 | `4+4+4+4+4` | 11 | 13.0 | 2.40 | 3 |
| **89** | 5 | 20 | `4+4+4+4+4` | 12 | 13.0 | 2.40 | 3 |
| 90 | 5 | 20 | `4+4+4+4+4` | 12 | 13.0 | 2.40 | 3 |
| **91** | 5 | 13 | `2+2+3+3+3` | 12 | 13.2 | 0.28 |  |
| 100 | 5 | 13 | `2+2+3+3+3` | 12 | 14.0 | 0.28 |  |

<!--door-ok-->Bold doors are the ones where something moved. (Every door 1–30,
then samples, then every door of the school.) **Doors 46–55 are the school**: the body counts
there are the school's floor — a volley plus a spare, per leg — not the ramp's
own answer, which is why the door after it drops back.

### What it replaced, and what it costs

The old rule sized a leg from its own geometry — every stretch worth a few
bodies, the approach worth one last group — with a hard-coded table for doors
1–4 bolted on top. The table ran out at door 4, so **door 4 held one body and
door 5's leg wanted twenty-four**, with charging rushers. That cliff is the one
thing this ramp exists to remove.

What it costs, and it is worth saying plainly:

* <!--door-ok-->**The deep game is much less dense than it was.** Door 40 is eight bodies
  across five legs where the old curve capped at thirty in one. Depth is now
  long before it is crowded.
* **The door after the school is a drop.** The school holds twenty bodies a
  door; the ramp resumes at thirteen. That is deliberate — it reads as relief on the far side of the
  hardest stretch in the game, with a new power in hand — but it is a step
  down, not up.
* **The telegraph ramp and the speed staircase no longer finish together, and
  by a long way.** `RAMP.rampWaves` is 18, so an enemy raises his arm as fast
  as he ever will by door 19 — where the round he then fires is still doing
  6.8 m/s. Before the staircase this was one curve and the two moved as one.
  It is not obviously wrong: "he shoots sooner, but the round is still
  walkable" is a coherent way to spend the middle game. But it is now a
  separate decision that nobody has made on purpose, and the dial is
  **Telegraph · full heat by** in the RAMP pane.

If either is the wrong trade, `/tool` → **RAMP** shows what any change does to
every door before you play one.

### Where to change it

| what | where |
|---|---|
| the numbers, with sliders and a live table to door 96 <!--door-ok--> | `/tool` → **RAMP** |
| the numbers, in source | `OPENING`, `SPEED`, `SCHOOL`, `RAMP` in `src/balance.js` |
| the reading of them | `doorLegs` / `doorBodies` / `doorAlive` / `legShare` / `shotGap` / `enemyBulletSpeed` / `schoolVolley` / `schoolGap` in `src/main.js` — all thin reads, none of them decides anything |
| a published reference to send somebody | the artifact linked from `README.md` |

The tool's RAMP pane writes into the same override channel the balance sliders
use, so an export carries it as a `ramp` block shaped like the balance module's
own keys — a patch to paste, not a format to translate.

## Slow motion is unlocked, then taught

Before the unlock door the button and the meter are not drawn and
`setTimeLocked` refuses — there is nothing to discover early and nothing to
miss. On the door it unlocks, the run does not simply hand it over with a
banner: it drops the player into a **second tutorial course**, with the same
corner, barrier and STAND HERE the onboarding used, and teaches the button, the
drain and the resume before letting the school have them. See
docs/TUTORIAL.md and docs/TUTORIAL-GOALS.md §5.

<!-- GENERATED FILE — do not edit by hand.
     Source of truth: src/balance.js
     Regenerate:      node tools/gen-balance-doc.mjs -->

Every tunable number the game reads, straight out of `src/balance.js`. The
game imports that file, this document is generated from it, and the Balance
Tuner artifact mirrors the same shape — so none of the three can drift.

---

## Scarcity — the primary levers

The loop the game is about: **limited ammo** forces you to hide, pick your
shots and freeze time to line them up → **limited time** forces you to hoard
the freeze, so when you spend it you make it count → out of both, you close
with a knife and freezing is the only way to land the jab.

A beginner sprays and never notices. The moment ammo gets tight the whole
game becomes resource management, and that is the fun. So these four are the
top-level dials and everything below is detail. Doors 1–3 stay generous —
that is where you learn to spray. 4–6 tighten. By 8 you are counting rounds.

Each curve is keyframes of `[door, multiplier]`, linearly interpolated and
flat outside its ends.

| Door | Ammo drops | Weapon drops | Time per kill | Time drain | Leg size | Group size |
|---|---|---|---|---|---|---|
| 1 | 1.45× | 1.20× | 1.00× | 1.00× | 1.00× | 1.00× |
| 2 | 1.35× | 1.13× | 1.00× | 1.00× | 1.02× | 1.03× |
| 3 | 1.25× | 1.05× | 1.00× | 1.00× | 1.03× | 1.07× |
| 4 | 1.07× | 0.98× | 0.93× | 1.05× | 1.05× | 1.10× |
| 5 | 0.90× | 0.92× | 0.87× | 1.10× | 1.07× | 1.14× |
| 6 | 0.78× | 0.85× | 0.80× | 1.15× | 1.10× | 1.18× |
| 7 | 0.67× | 0.81× | 0.71× | 1.25× | 1.13× | 1.21× |
| 8 | 0.55× | 0.77× | 0.62× | 1.35× | 1.15× | 1.25× |
| 10 | 0.48× | 0.70× | 0.56× | 1.48× | 1.20× | 1.32× |
| 12 | 0.40× | 0.70× | 0.50× | 1.60× | 1.25× | 1.40× |

What each multiplies:

| Curve | Multiplies | Effect |
|---|---|---|
| `ammoDrop` | `DROPS.clipRate` (0.34) | how often a kill leaves a pistol clip |
| `weaponDrop` | the per-type weapon drop chance | falls slower than ammo — a floor gun matters more once clips dry up |
| `timeGain` | `TIME.bonus` (2 s) | seconds of bank refunded per kill |
| `timeDrain` | the drain rate while frozen | above 1× the bank empties faster |
| `legSize` | `LEG.perCell` | total enemies in the level |
| `groupSize` | `maxAlive` | how many can be on you at once |

Raw keyframes:

```js
ammoDrop   : [[1,1.45],[3,1.25],[5,0.9],[8,0.55],[12,0.4]]
weaponDrop : [[1,1.2],[3,1.05],[6,0.85],[10,0.7]]
timeGain   : [[1,1],[3,1],[6,0.8],[8,0.62],[12,0.5]]
timeDrain  : [[1,1],[3,1],[6,1.15],[8,1.35],[12,1.6]]
legSize    : [[1,1],[4,1.05],[8,1.15],[12,1.25]]
groupSize  : [[1,1],[4,1.1],[8,1.25],[12,1.4]]
```

### The opening doors

The first few doors are a metronome, not a fight: the four-beat rhythm — see
him, watch the round leave, step out of it, shatter him — has to be learnable
once before it is asked for twice. See docs/PILLARS.md section 3.

```js
gunnerOnlyDoors  : 5
oneRoundDoors    : 5
```

### The condition tax

A condition multiplies the same curves a **second** time, so a fog leg at
door 6 pays the door-6 rate *and* the fog rate. A condition that only changes
what you can see is a lighting effect; changing what you can **afford** is
what makes it a condition. Blackout is the only one that taxes time, because
in a blackout the freeze is how you see — light itself costs you seconds.

```js
fog      : {"ammoDrop":0.42,"weaponDrop":0.62,"timeGain":0.9,"groupSize":0.45}
blackout : {"ammoDrop":0.32,"weaponDrop":0.52,"timeGain":0.82,"groupSize":0.38}
```

## Weapons

A weapon holds **`mag` bullets per clip** and up to **`maxClips` spares**.
Reload burns one spare and runs on **real time**, so freezing the world never
refills a gun. Picking up a weapon you already carry adds a clip. Empty every
clip and you drop to the knife.

| Weapon | Rounds / clip | Max clips | Reload (s) | Fire cd (s) | Muzzle speed | Notes |
|---|---|---|---|---|---|---|
| knife | ∞ | 0 | — | 0.42 | — | melee only, front arc |
| pistol | 5 | 3 | 1 | 0.22 | 46 | the only deep clip |
| shotgun | 2 | 3 | 1.5 | 0.55 | 46 | 6 pellets, spread 0.055 |
| burst | 2 | 3 | 1.4 | 0.5 | 52 | 3-round burst, 0.09 s apart |
| sniper | 2 | 3 | 1.75 | 0.9 | 95 | pierces 3 |
| launcher | 2 | 3 | 2 | 0.9 | 26 | 5.5 m blast |
| rocket | 2 | 3 | 2.35 | 1.2 | 34 | 8.0 m blast |

## Enemies

The debut wave headlines its type: it spawns first and gets a warning card.
After that the type fills in at `min(cap, floor(total / share))` per wave.

| Enemy | Debut | Fill share | Fill cap | Drops | Role |
|---|---|---|---|---|---|
| gunner | 1 | — | — | — | the backbone |
| rusher | 2 | — | — | — | telegraphed lunge, packs of 3–4 |
| shotgunner | 3 | 4 | 4 | shotgun | close-range cloud |
| shieldbearer | 4 | 8 | 2 | — | attrition: flank the plate |
| heavy | 5 | 5 | 3 | burst | 3-round burst |
| sniper | 6 | 7 | 2 | sniper | long telegraph, heavy round |
| bomber | 7 | 6 | 2 | launcher | area denial |
| armored | 9 | 9 | 2 | burst | attrition: headshots only |
| rocketeer | 11 | 8 | 2 | rocket | homing missile |
| laser | 12 | — | — | — | unavoidable sweep |

Drop chances live per-type in `ENEMY_TYPES` in `src/main.js`; the table above
is what each one leaves behind when it rolls.

## Drops and collection

| Knob | Value | Meaning |
|---|---|---|
| `clipRate` | 0.34 | chance a non-weapon kill leaves a pistol clip |
| `life` | 12 s | time on the floor before it sinks |
| `pickupR` | 2 m | walk this close and it is yours |

There is **no magnet**. A drop stays where it fell, so crossing the room for
it is a real decision — which is the whole point of collecting on foot.

## Difficulty ramp

`diffT` runs 0 → 1 across **18 waves** (full heat at wave
19) and drives the telegraph and the slow-mo cost. **Bullet
speed is not on it** — it is the staircase in `SPEED`, stepped by door, and
the column below is `speedAt(door)`. In Rush Hour the wave number is replaced
by `1 + rushT / 25`, so everything ramps on the run clock instead.

| | Bullet speed (m/s) | Telegraph scale | Slow-mo cost |
|---|---|---|---|
| door 1 | 5.4 | 1.15× | 0.55× |
| door 6 | 5.8 | 0.975× | 0.675× |
| door 10 | 5.8 | 0.835× | 0.775× |
| door 19 | 7.6 | 0.52× | 1× |
| door 46 | 13 | 0.52× | 1× |

Slow time unlocks on **door 46**, where the staircase reaches
13 m/s; it holds there for the 10-door
school and then climbs again to a ceiling of 21.6 m/s. Rush Hour
drains the bank at a flat 0.4×. An enemy must be in view for
**0.45 s** before its telegraph may begin.

## Visibility, and the FOG condition

| Knob | Value | Meaning |
|---|---|---|
| `hallNear` / `hallFar` | 14 / 55 m | the ordinary corridor |
| `fogNear` / `fogFar` | 2 / 6 m | a **fog** leg — what its archive line promises |
| `farMargin` | 3 m | the far plane is never nearer than `spawnMin + this` |
| `tau` | 0.45 s | eased on a time constant, so every leg change lands in ~1.3 s |

**BLACKOUT** is about light, not distance. Pulling the far plane to the 8 m the
design note first asked for would put the whole 9–40 m spawn range
outside sight; edge arrows cannot cover it either, because their 19.5° bearing
threshold sits just inside the ~21° screen half-width, so an enemy dead ahead
gets no arrow and no pixels.

| Knob | Dark | Frozen | Meaning |
|---|---|---|---|
| far plane | 7 m | 30 m | **stopping time is the torch** |
| light intensity | 0.14× | 0.5× | hemisphere, sun and fill together |
| surface colour | 0.15× | 0.5× | ceiling and beams are unlit materials, so only colour reaches them |
| fog colour | `#060a0d` | — | left pale, the corridor faded into a bright haze that read as light at the end of the tunnel |
| lit strips | every 2 cells | — | 8 m apart, inside the 7 m range — at 8 and at 5 the next strip was fogged to nothing |
| strip colour | `#23272c` | — | emergency amber, deliberately not the signal red |

Measured on a real frame: a blackout corridor is **40% of a lit one's mean
luminance**, with the emergency strips the only warm pixels in view.

The safety constraint is `LEG.spawnMin` (9 m). Bodies are born
9–40 m out and the door opens only on an empty floor, so a far
plane below the spawn floor would hide every arrival. The effective floor is
therefore **12 m**, derived rather than hand-picked.

It cannot soft-lock structurally, not just empirically: the tunnel substitutes
away every long-range type (sniper, laser, rocketeer, bomber) and no remaining
type holds position at range, so every enemy that can appear in a fog leg
closes distance and enters visibility.

## Wave composition

- **Total** = `min(6 + 2n, 30)`
- **Rushers** (once debuted) = `min(round(total × 0.4), 2 + n)`
- **Debut type** gets `max(2, round(total × 0.2))`
- **Gunners** keep at least 25 % of the wave

Tunnel legs do not use a wave total at all — see below.

## The tunnel leg, stretch by stretch

A leg is a chain of **stretches** — one straight run plus the turn that ends
it — followed by the **approach**, the straight stare down at the door. A
**vault** leg replaces one of its turns with a pillared room: one framed
doorway in, one out on the far side offset laterally so you must cross it,
four columns down the middle, and no branch lane may reach it. The room is
its own stretch, so it gets its own share of the wave.

**Cover comes in grades.** Everything in the tunnel used to be
floor-to-ceiling, so every occluder was binary. `coverLowH` is not a taste
value: the enemy's sight ray and his muzzle both sit at **1.35 m** and the
player's eye at **1.6 m**, so a **1.45 m** block hides him from you
completely while you see over it and shoot down. `segAABB` is 3D so bullets
and line of sight respect the height with no engine change, and
`pointInObstacle` is 2D so you still cannot walk over it.

**Width is the axis a portrait phone cannot show.** The camera is 80° in
three.js, which is *vertical* — at 390×844 that is only **42.4° horizontal**,
under half the reference's 90°. Visible width is `0.776 × distance`, so from
the entry of a 16 m-deep room you frame 12.4 m of the far wall. A 20 m room
would hide 8 m of itself permanently. Budget that would have gone into floor
area goes into height (`beamDrop`) and cover grading instead. A
stretch's share of the wave is released when you **walk into it**, so the
fight travels with you and nothing can accumulate in front of the door. The
approach is worth exactly one group: the final wave you clear with the door
in frame.

| Knob | Value | Meaning |
|---|---|---|
| `fwdBase` / `fwdVar` | 16 + 0–5 cells | forward length of a normal leg (64–84 m before jogs) |
| `fwdGauntlet` | 22 + 0–4 cells | ...and of a gauntlet |
| `runBase` / `runVar` | 3 + 0–2 cells | one stretch's straight, 12–20 m |
| `runServiceRun` | 2 + 0–1 | a service run turns constantly |
| `runGauntlet` | 6 + 0–3 | a gauntlet barely turns at all |
| `approach` | 4 cells (16 m) | straight run in front of the door |
| `vaultWide` / `vaultDeep` | 4 × 4 cells (16 × 16 m) | the vault room |
| `vaultDoorW` | 2.6 m | its two framed doorways |
| `vaultExitOffset` | 2 cells (8 m) | how far the exit sits off the entry line |
| `vaultSpawnMin` | 6 m | `spawnMin` would push refills out of a 16 m room |
| `pillarW` × `pillarD` | 1.3 × 0.7 m | columns are rectangular, wide face across the crossing |
| `pillarsChamber` | 4 | two rows, not one — each row is a spawn shadow |
| `coverLowH` | 1.45 m | LOW cover: see over, cannot shoot through |
| `coverLowW` × `coverLowD` | 3.2 × 1.6 m | its footprint |
| `beamDrop` / `beamW` | 0.3 / 0.45 m | ceiling beams — soffit lands at 2.8 m |
| `perCell` | 0.5 + 0.05·door | bodies per corridor cell, capped at 0.9 |
| `stretchMin` / `stretchCap` | 2 / 4 | no stretch is ever emptier or fuller |
| `finaleWave` | 3 | the one final group waiting at the door |
| `lookahead` | 1 | stretches past yours that may also spawn |
| `spawnMin` / `spawnMax` | 9–40 m | how far ahead a corridor spawn may appear |

**Leg total** = `round(bodyCells × perCell(door)) + 3`, split
between the stretches in proportion to their length. A longer corridor is a
bigger fight because there is more of it — not because a number went up, and
not because it happens to turn more often. Budgeting by stretch *count* would
make a zig-zagging service run, which is shorter to walk, the bigger fight.

## Spawn pacing

| Knob | Tunnel | City / Rush |
|---|---|---|
| Alive at once | `min(3 + ⌊wave/2⌋, 6)` | `min(6 + ⌊wave/2⌋, 10)` |
| Gap when empty | 0.9 s | — |
| Gap when busy | `1.4 + 2.2·fill` | `0.7 + 2.6·fill` |
| Gap after a kill | pulled to 0.5–1.4 s | same |

All gaps are multiplied by a 0.85–1.15 jitter. Spawns are suppressed while a
message card is on screen, and in the tunnel they are hard-gated to at least
**4 m ahead** of the player, and to the stretch the player
is in (plus 1). The last **3** of a leg stage on
the door approach, in line of sight of the slab, so the door opens in view.

## Time control

| Knob | Value | Meaning |
|---|---|---|
| `base` | 5 s | bank at wave start, and the floor each wave |
| `bonus` | 2 s | refunded per kill |
| `cap` | 10 s | bank ceiling |
| `drain` | 1 | seconds spent per second frozen, before ramp scaling |
| `slowScale` | 0.05 | world speed while standing still |
| `moveScale` | 0.3 | world speed at full stick |

## The simplified modes

One movement mechanic, no look axis, no time button — and therefore no bank,
which is why each of the two owns time by a different rule. See
`docs/MODES.md` for what each rule is for.

Shared: a straight strip **3 cells wide**, a tap
within **64 px** of a body takes the body.

| Knob | Corridor duel | Stand still |
|---|---|---|
| Leg length | 6 cells (24 m) | 9 cells (36 m) |
| World speed, idle | 1 | 0.02 (thumb still) |
| World speed, engaged | 0.13 (round inbound) | 1 (full drag) |
| What moves time | an enemy round in the air | your thumb, and your trigger |
| Inbound window | 1.1 s out, within 2.6 m | — |
| Cost of a shot | — | 0.17 s of world time at 1× |
| Ease onto target | 9 /s | 14 /s (TIME_EASE) |
| March to the open door | 6.5 m/s | you walk it yourself |

