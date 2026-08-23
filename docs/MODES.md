# Modes

Five. The list lives in `src/modes.js` — the menu's `CHOOSE A GAME` picker
and the MODES section in Settings are both rendered from it, so a mode cannot
exist in one place and not the other, and its one-line description cannot say
two different things (`docs/PILLARS.md` §7).

The menu shows **one game at a time**, named on a single button; the picker
behind it is where the others live. See `docs/SAVES.md`.

**The main game first, then the rest in the order they were built.**

| Mode | Built | What you do |
|---|---|---|
| **THE TUNNEL** | 3rd | Door to door, deeper each time. The main game; a first launch opens on it. |
| **CITY STREETS** | 1st | Endless waves in the white city — the original arena. |
| **RUSH HOUR** | 2nd | Freeze the crowd, find the one face that matters, walk out. |
| **CORRIDOR DUEL** | 4th | They come to you. Drag to sidestep, tap them to shatter. |
| **STAND STILL** | 5th | Time only moves while you do. Stand still and the world waits. |

Two jobs, and neither ordering alone does both. The top of a list is where a
reader looks first, and what they should find there is the game — not the
oldest thing we happen to still ship. Everything under it is in build order
because that is the only ordering of the alternates that stays true on its
own: alphabetical says nothing, "best first" is an opinion that goes stale,
and newest-first would reshuffle the list every time we prototype. So it
reads as *here is the game, and here is everything else we have tried,
oldest first*, which is what it is.

`main: true` is what puts a mode at the top of both lists, and it is also the
game a first launch opens on — `DEFAULT_MODE` in `main.js` reads it rather
than naming a mode itself, so those two cannot disagree.

---

## The two simplified modes

4 and 5 are prototypes of the same question: **the game currently needs three
things from a player's hands** — a left thumb to move, a right thumb to look,
and a button to buy slow motion — and that is two more than a phone game
should need. So:

> One movement mechanic. Drag to move, tap to shoot. Nothing else.

There is no look axis in either mode, and no time button. What that costs, and
what each mode does about it, is below.

### What replaces looking

Cutting the look stick is easy; deciding where a shot goes is the whole
design. **The shot goes where the thumb went** — a tap fires at the point you
tapped, and a tap within `SIMPLE.tapMagnetPx` of a body takes the body rather
than the wall behind it (`tapAim` in `src/main.js`).

This is aim assist on the *shot*, not on the camera, so §4 is untouched: the
camera cannot move on its own in these modes because there is nothing left
that moves it. The crosshair is hidden for the same reason — with no look
axis it points down the corridor rather than at anything, and a sight that is
not where your shot lands is worse than no sight.

The corridor is therefore always a **straight strip, three cells wide**: the
camera never turns, so a corner would be a wall you cannot see round, and one
cell of corridor minus its walls is not a dodge, it is a flinch.

### What replaces the time bank

`docs/PILLARS.md` §1 forbids a mechanic that stops time for free, and a mode
with no bank cannot charge for it in seconds. **This is the fence these two
modes lean on, and it was a deliberate decision, not an oversight.** Each pays
for time in a different currency, and which currency is the better game is the
thing the prototypes exist to find out:

**CORRIDOR DUEL — time is not yours at all.**
The world drops to `SIMPLE.duel.slow` on its own whenever an enemy round is
in the air and on its way to you (closing, arriving inside `lead` seconds,
passing within `miss` metres — see `roundInbound`), and comes back the moment
the air is clear. Slow motion is a window the enemy opens, never a resource
you hold, so there is nothing to hoard and nothing to price. You never
advance: they come to you, you sidestep, and when the strip is clear the
corridor itself marches you to the open door.

**STAND STILL — time is yours, and it costs movement.**
The world runs at your thumb's speed: still is `SIMPLE.stop.still`, full drag
is full speed. Standing still stops the world, which is exactly the thing §1
warns about — so **every shot buys the world a slice of full-speed time**
(`SIMPLE.stop.shotTime`). Without it a player could stand in one spot and
empty a magazine into a frozen room at no cost, which is not a game. With it,
the bullets you did not dodge get closer while you take your shots, and the
price of a decision is paid in the only currency left.

### What they keep

Both are built **on** the tunnel — same corridor generator, same doors, same
checkpoints, same spawn pacing, same scarcity, same one-hit-kills. `inHall()`
is the test every one of those systems asks ("am I in a corridor?"), as
distinct from `game.mode`, which says *which* corridor game and therefore who
owns time and what a thumb on the glass means. A simplified mode is the
tunnel with rules **removed**, so it inherits by default and states its
differences, and a change to corridor behaviour cannot reach one and miss the
others.

The four beats (§3) are the thing being tested and are deliberately intact:
see him → watch the round leave → step out of it → shatter him. Every beat
survives; only the input for each one shrinks.

### What they deliberately drop

- **The onboarding.** It teaches a left thumb, a right thumb and a time
  button, and these modes have none of the three.
- **Conditions and measures.** Every one of them is a rule stated in a system
  these modes have taken away — a blackout you cannot look around in, a
  grinder you cannot outrun when the corridor decides your pace.
- **Leg headlines.** Every leg is the same shape here, so "TIGHT TURNS" and
  the rest are lies; the door number is the only true thing left to say.
- **Rushers, in the duel only.** You hold one end of a strip and cannot give
  ground, so an enemy whose answer is "retreat" is unanswerable — it would
  simply arrive. In the duel everything that closes becomes something that
  fires.

### Open questions for playtesting

1. **Is the duel's automatic slow legible?** It is meant to read as *the
   enemy firing slows the world*. If it reads as random, `lead`/`miss` are
   the dials — too generous and the mode is permanently in slow motion with
   nothing to contrast against.
2. **Is stand still's shot cost felt, or just endured?** `shotTime` is the only
   thing stopping the mode from being a shooting gallery.
3. **Does the duel's march to the door outstay its welcome?** It is ~3.5 s of
   corridor with nothing to do. Shorten `duel.legCells` before raising
   `walkSpeed` — the strip's length is also the range the fight opens at.
4. **Is tap-to-shoot precise enough on a real thumb?** `tapMagnetPx` is
   currently 64.
