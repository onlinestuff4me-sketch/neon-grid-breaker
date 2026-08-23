# The onboarding — goals and lesson plan

**This is the specification.** `docs/TUTORIAL.md` describes how the current
build implements it; this file describes what it is supposed to be. When the
two disagree, this one is right and the build is wrong.

Written down because the onboarding has now been rebuilt five times, and every
rebuild drifted from what was asked for in the same four ways.

---

## The four goals

### 1. Teach one lesson at a time

One idea per area. Not "move and look and here is a barrier"; move, then look,
then the barrier. If a player can fail a beat for a reason that is not the
thing that beat is teaching, the beat is teaching two things.

### 2. Keep the message on screen until the lesson is complete

A prompt that fades on a timer is a prompt that vanishes while somebody is
still working out what it meant. Text and coach animation stay up for the
whole of their lesson and leave only when the lesson is *done* — not after
n seconds, not on the first successful input.

### 3. Only introduce what serves the lesson

Every object, obstacle, enemy and piece of HUD in an area exists because the
lesson in that area needs it. No door counter over `DRAG TO MOVE`. No ammo
readout before there is a gun. No second enemy while the first one is the
lesson. If it can be removed without weakening the lesson, remove it.

### 4. Only progress on success

The next area opens when the current lesson has been *completed*, not when a
clock ran out. Failing is allowed and is not punished with lost ground: a
death rewinds to the start of the current area and nothing further back.

---

## The fifth goal, added after the first real playtests

### 5. Let them play before you teach them a system

The onboarding used to introduce slow motion in its fifth lesson: the freeze,
the button, the meter, the bank, the cost. Five lessons in, before the player
had shot anything.

People love shooting these bodies and watching them shatter. That is the game,
and it is fun at full speed. A resource with a bar and a cost is not something
a first-time player wants in their first ninety seconds — it is something they
want once the rhythm is a habit and the rounds have started arriving faster
than a walk can answer.

So: **the onboarding never mentions slow motion.** Move, look, walk to the
mark, get out of the way of three rounds, take the gun, shatter three men, go
through the door. The button and the meter are not on the screen and the
control is inert. Slow motion arrives **at door 4** with a banner and its own
entrance animation — as a thing you unlock rather than a fifth thing to read.

The freeze in the dodge lesson is *not* that mechanic being introduced early.
It is the game buying the player a moment to read three words, and the thing
that releases it is the only control they have: their thumb.

---

## The lessons

Seven, then six training areas, then the game.

### 1. Move
`DRAG TO MOVE`, left half, thumb coach, dotted divider down the middle.
Nothing else on the screen. Ends at the first corner.

### 2. Look
`DRAG TO LOOK` joins it on the right with its own coach — **and `DRAG TO MOVE`
stays**, because the point is that looking is a separate action you do at the
same time. Ends at the end of the next straight.

### 3. Corners
Both prompts stay through two more turns and a fork that rejoins. Ends **at
the last corner** — which is where the barrier comes into view.

### 4. Stand here
The prompts go. The barrier has been standing there since the first frame of
the run; `STAND HERE` is painted on it, and from the last corner it is legible
at 32 m. Ends when they reach it.

### 5. Three rounds, dodged with a thumb

One gunner appears four cells past the barrier, raises his arm, and **fires**.
The round clears the muzzle, covers nearly half its flight, and **the world
stops** — with the round hanging in the air between them, a ring drawn on it.

> **DODGE THE BULLET**
> *(a thumb, directly under the words, swiping side to side)*

Nothing moves until they step aside. Not a timer, not a button — sideways
movement, at least 0.85 m of it, and more sideways than forward, because
walking *into* the round is not dodging it. Then time runs, the round goes
past at ordinary speed, the words fade, and the next one comes.

Three times. **A death here rewinds to this beat and keeps the dodges already
banked** — being made to dodge all three again is being punished for getting
two of them right.

### 6. The gun, and the other two

The squad arrives and the weapon comes up on the same beat as the words that
name it: `TAP ANYWHERE TO SHOOT`. Nothing else is on screen. This is the first
thing the player is asked to do *to* somebody rather than get away from.

The magazine is drawn — as cartridges, not bar-chart blocks — and it does not
run down. Running dry and reading `RELOADING` is a fourth thing to learn on the
beat that is teaching the trigger. Scarcity starts at the first real door.

Ends when all three are down. Then the barrier sinks and the door opens.

### 7. The door
`GO TO THE NEXT ROOM`. Ends when they cross.

### 8–13. The training areas
Room, hall, room, hall, room, hall with 1, 1, 2, 2, 3, 3 bodies. Real fights
and checkpoints; the teaching is over. The only words left are a single
reminder — `TAP ANYWHERE TO SHOOT`, on the first man to raise his arm in an
area, **once per area**, spent the moment they fire.

---

## What this forbids

Each of these has actually happened in a previous build, which is why it is
written down:

* a prompt that fades on a timer while the player is still reading it
* `DOOR 1 · OPEN — GO` printed over `DRAG TO MOVE`
* the ammo readout on screen before the gun exists
* the "straight hallway" arriving with a five-cell pillared room in it
* two enemies while the lesson is one enemy
* a death costing more ground than the current area — or costing dodges the
  player has already banked in the beat they died on
* invulnerability during the lesson, which teaches that a hit is survivable
* a resource, a bar and a cost before the player has shot anything
* a magazine that runs dry on the beat that teaches the trigger

One that used to be on this list has come off it, and the reason matters: *"a
bullet slower than the game's, which teaches the wrong timing."* The rounds in
the onboarding are still exactly the game's rounds — but the GAME's rounds are
slower now for the opening doors and speed up across the first eighteen, so
what the lesson teaches is the timing of the game the player is about to play.
The rule was right; it was the constant behind it that was wrong.
