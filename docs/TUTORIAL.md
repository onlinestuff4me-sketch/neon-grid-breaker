# The onboarding

A scripted first level. Not captions over a procedural corridor — a hallway
built for it, with furniture placed by the script and every round in it fired
by the script.

Everything here lives behind `tutorStep !== null`. When it is null the game
does not know the onboarding exists, which is the property `docs/PILLARS.md`
§7 is protecting: nothing in this file may leak into a normal run.

## The sequence

`move → look → aim → incoming → gunup → shoot → advance → done`

| step | what the player sees | what ends it |
|---|---|---|
| `move` | `DRAG TO MOVE`, left half, dotted divider, animated thumb. A barrier already stands 8 m ahead so there is something to walk to. | 2.2 m walked |
| `look` | `DRAG TO LOOK`, right half, divider stays | 0.9 rad swept |
| `aim` | nothing; the view eases back down the hallway | facing within 0.05 rad |
| `incoming` | one enemy 13 m out, one round **crawling** at 0.085× speed, `TAP TO SLOW TIME` with a line-and-arrow down to the button. On the freeze the round speeds up to 0.42× so it arrives and can be stepped out of. On the first dodge the meter appears full and the twin prompt follows a beat later. | resumed time, after the meter lesson |
| `gunup` | the weapon swings up on the **reload rig** (`fold`), not a bespoke tween | the rise finishes |
| `shoot` | two more bodies join the first; `TAP ANYWHERE TO SHOOT`; magazine topped up | all three shattered |
| `advance` | barrier sinks, door opens, `ENTER THE NEXT ROOM` | crossing the door |

## The rules it holds while it runs

| rule | why |
|---|---|
| `tutorHoldsSpawns()` — the spawn queue is emptied every frame | a body arriving mid-lesson is the loudest thing on screen |
| `tutorHoldsFire()` — no enemy fires on its own initiative | every round is a decision, not emergent AI |
| `tutorHoldsPlayerFire()` — the player cannot fire before `shoot` | tapping fired a round with no weapon on screen |
| `tutorFreeIsFree()` — the ordinary bank drain is off, entirely | before the meter lesson the freeze is free; during it the script owns the bank. Leaving the ordinary drain running took the bank to zero and auto-resumed time in the middle of the sentence explaining that the bank runs out |
| `showBanner` returns early | `THE DOOR IS OPEN` was landing on `DRAG TO MOVE` |
| `tutorBefore(step)` gates the gun, meter and button | derived from `TUTOR_ORDER`, never from a hand-written list — the first version listed step names in three places, the sequence was rewritten, and two of those lists went stale |

## The numbers

`TUTOR` in `src/main.js`. The ones with a reason:

* **`crawlMul: 0.085`** — before you have been told what the button does, a
  round you cannot answer is a death, not a lesson. It picks up to `bulletMul`
  the moment you freeze.
* **`meterSecs: 7` / `meterCrawlSecs: 70` / `meterKnee: 0.5` / `meterFloor:
  0.25`** — the bank empties at a readable rate to half, crawls to a quarter,
  and stops. The player is being taught that time is finite, not put in a hole
  before anyone has told them how to climb out.
* **`enemyAt: 13`** — at 0.42× a round covers about 4 m/s, so thirteen metres
  is ~2.2 s of flight. Placed relative to the door on a long leg it was twenty
  metres and nearly six seconds, which reads as nothing happening.
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
