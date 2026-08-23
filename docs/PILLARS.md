# TIME SHATTER — core pillars

**This file is the fence.** The onboarding, the level tool, and any future
mode are free to do what they like *inside* it. Anything that would change a
line here is a design decision, not an implementation detail, and belongs in a
conversation before it belongs in a commit.

Written down because the tutorial has now been rebuilt four times, and each
rebuild reached into shared systems — leg generation, spawn pacing, the time
bank, the fire gate. Those reaches are what this document exists to make
visible.

---

## 1. Time moves when you do

The whole game. Stand still and the world nearly stops; move and it catches
up. Everything else is downstream of it: the freeze is not a pause button, it
is a resource you spend to buy a decision.

Owned by `TIME` in `src/balance.js` (`slowScale`, `moveScale`) and by
`timeScale` in the frame loop.

**Do not** add a mechanic that stops time for free, or one that runs on the
world clock while frozen — with one deliberate exception, the GRINDER, whose
entire point is that the building does not care that you froze.

**The simplified modes lean on this line, on purpose.** CORRIDOR DUEL and
STAND STILL have no time bank, because they have no time button and no second
thumb to press one with, so neither can price the freeze in seconds. Each
pays for time in a different currency instead — the duel never gives it to
the player at all, and stand still charges a slice of full-speed world time
for every shot fired — and which is the better game is what the two
prototypes exist to answer. See `docs/MODES.md`. Nothing here is relaxed for
the tunnel, the arena or rush hour.

## 2. Scarcity is the difficulty curve

Not enemy health, not enemy accuracy. The game gets hard because the ammo
stops arriving and the bank stops refilling, which turns a shooter into
resource management. Playtest, verbatim: *"that's where the fun in this game
lies — finding ways to increase the stakes so that you have to conserve your
resources and be strategic."*

Owned by `SCARCITY` and `CONDITION_TAX` in `src/balance.js`.

**Do not** balance a new element by making enemies tougher. Balance it by
changing what the player can afford.

## 3. Four beats, and they are learnable

See him → watch the round leave → step out of it → shatter him. That is the
game in four beats, and a player who has not internalised them cannot enjoy
anything built on top. Hence `EARLY`: doors 1–4 hold exactly one body, only
gunners appear before door 6, and through door 5 nobody fires while a round is
still on its way to you.

**Do not** raise the opening difficulty to make the game "respect the player".
The opening is a metronome on purpose.

## 4. Fluidity of look and movement outranks everything

Stated by the playtester as the number one priority and it has stayed there.
Five separate causes of look jitter have been found and fixed; every one was
something well-intentioned moving the camera when the thumb was not.

**The rule: the camera never moves unless the player moved it.** Aim assist is
magnetism — proportional to how much you are already turning, capped at half
of it, one-directional, and exactly zero when your thumb is still.

**Do not** add anything that eases, snaps, or settles the view on its own.

## 5. Portrait phone first

The camera is 80° **vertical**, which at 402×874 is only ~42° horizontal.
Width is the axis the screen does not have. Rooms are built deep and tall
rather than wide; the vault is four cells across for exactly this reason.

**Do not** design an encounter that depends on peripheral vision.

## 6. Legibility in the dark is a hard requirement

Anything lethal must be readable at any brightness the corridor happens to be
at. The grinder's blades and hazard bars are unlit for this reason, and a
blackout's enemies keep a fog-exempt contact mote.

**Do not** ship a hazard that a blackout can hide.

## 7. One implementation of anything shared

`src/balance.js` is the only source of tunable numbers, `docs/BALANCE.md` is
generated from it, `src/protocols.js` is the only content registry,
`src/genleg.js` is the only corridor generator, and `src/tutorial.js` is the
only description of the onboarding — the game and the tool both import every
one of them. A second copy of any of these is a bug waiting to be found by a
playtester rather than by a test.

This is also what makes the tool's preview worth looking at. It runs the real
game against the real spec in an iframe, so it cannot show you something the
game would not do. A preview that reimplements what it is previewing is a
second implementation wearing a disguise.

## 8. No stall the player can feel

A shader that first compiles on the frame a thing appears is a stall, and this
project has paid for that three times (the ripple pass, the reveal grades, the
muzzle lights). Everything compiles in `warmUp()`. Light counts never change
at runtime. Materials are pooled.

**Do not** add a light, a material or a pass at runtime.
