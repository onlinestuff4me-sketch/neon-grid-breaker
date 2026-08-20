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

## The lessons

Fifteen beats. The first nine teach; the last six are the ramp into the
ordinary game, and are where the difficulty curve actually starts.

| # | area | lesson | ends when |
|---|---|---|---|
| 1 | straight hallway | **Move** | they reach the turn at the end |
| 2 | the turn | **Look** | they have swept the view round the corner |
| 3 | two more turning legs, then a forking one | **Move + look together** | they reach the end of the fork's rejoin |
| 4 | single hallway, barrier 6 cells ahead | **Stand here** | they reach the barrier |
| 5 | same | **Slow time to dodge** | they dodge the round |
| 6 | same | **Dodge three rounds** | the third is dodged |
| 7 | same | **The meter is finite** | they let time run again |
| 8 | same | **Shoot** | all three are down |
| 9 | same | **Go through the door** | they cross it |
| 10 | room | one enemy, fires on entry | it is down |
| 11 | straight hallway | one enemy blocking the door | it is down |
| 12 | room | two enemies, taking turns | both down |
| 13 | hallway | two enemies | both down |
| 14 | room | three enemies | all down |
| 15 | hallway | three enemies, one then two | all down |

### 1. Move

A straight hallway. `DRAG TO MOVE` on the left with the thumb-stick coach
animation, **and it stays there the whole way down**. Nothing else on screen —
no gun, no time button, no meter, no door counter. At the end of the hallway,
the corridor turns right.

### 2. Look

Reaching the turn, `DRAG TO LOOK` appears on the right with the side-to-side
coach animation. **`DRAG TO MOVE` and its thumb-stick stay on screen**, because
the point being made is that looking is a *separate* action that happens at the
same time as moving — not a mode you switch into.

### 3. More corners, and a fork

Two more legs that turn, then a third that forks and rejoins into one hallway.
Both prompts and both coach animations stay up throughout. The fork exists to
show that a branch is not a wrong turn.

### 4. Stand here

The prompts finally go. In the single hallway a black barrier stands 6 cells
ahead with `STAND HERE` hovering above it. This is the first thing they are
asked to *aim* at rather than just do.

### 5. Slow time to dodge

At the barrier, one enemy appears 4 cells beyond it, raises his arm and fires.

**The game freezes on the ROUND, not on the telegraph.** He shoots first; the
round clears the muzzle and covers nearly half the distance; and *then*
everything stops — bullet, enemy, corridor — with the thing they have to get
out of the way of hanging in the air in front of them, a ring drawn on it. Only
then does the prompt come up:

> **DODGE THE BULLET**
> *TAP HERE TO SLOW TIME* → *(pointer to the button)*

Freezing before the trigger meant those words arrived with no bullet anywhere
on the screen: the player was being asked to dodge a thing they had never seen.

Nothing moves until they tap. On the tap the round travels again — at a pace a
person can read, not the standing-still crawl the ordinary rule gives — the
prompt and pointer go, and `DRAG TO MOVE` comes back with its coach swiping
**sideways**, because the second half of the lesson is *what to do now that
time is slow* and an upward swipe over the move stick reads as "forward", which
is straight into the round.

Then the world runs again and **the whole beat repeats** for the second man and
the third: appear, arm, shot, freeze, tap, move. Repetition, not escalation.

Dying here rewinds to exactly this beat: enemy raising his arm, freeze, prompt.

### 6. Three rounds

Two more enemies appear and fire one at a time, 2–3 seconds apart, so three
rounds have to be dodged in sequence. There is no meter yet, so they can stay
in slow motion for the whole thing. This is repetition, not escalation.

### 7. The meter

Only after the third round is dodged does the bar appear, labelled
**SLOW TIME METER**, and only then does it start draining — 100% to 50% at a
readable rate, then to a crawl. The message and pointer explain it. It ends
when they let time run again.

The meter is introduced *after* the dodging, not during it, because a resource
you are watching drain while you are learning to dodge is two lessons at once.

### 8. Shoot

The gun rises into frame and the prompt says to fire. Three enemies to clear.

### 9. The door

The barrier sinks into the floor and `GO TO THE NEXT ROOM` appears.

### 10–15. The ramp

The teaching is over; these are the first real fights, and each one is a
checkpoint. Dying in any of them puts the player back at the start of *that*
area, not further.

| # | shape | who is in it |
|---|---|---|
| 10 | room | 1 enemy in front of the exit door, fires as they enter |
| 11 | straight hallway | 1 enemy blocking the door at the end |
| 12 | room | 2 side by side; the second fires only after the first's round is dodged or the first is down |
| 13 | hallway | 2 |
| 14 | room | 3 |
| 15 | hallway | 3 — one, then two close behind |

Area 15 hands over to the ordinary generated tunnel with no seam: the same
corridor generator, the same protocol composer, the same difficulty curve
picking up where the ramp left it.

---

## What this forbids

Each of these has actually happened in a previous build, which is why it is
written down:

* a prompt that fades on a timer while the player is still reading it
* `DOOR 1 · OPEN — GO` printed over `DRAG TO MOVE`
* the ammo readout on screen before the gun exists
* the "straight hallway" arriving with a five-cell pillared room in it
* a round arriving while the meter is being explained
* two enemies while the lesson is one enemy
* a death costing more ground than the current area
* invulnerability during the lesson, which teaches that a hit is survivable
* a bullet slower than the game's, which teaches the wrong timing
