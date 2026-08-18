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
| **`straight`** | the onboarding hallway only | suppresses all of the above |

Width is the axis a portrait phone does not have — see `docs/PILLARS.md` §5.
That is why the vault is four cells across and not eight.

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

## The level tool

`/tool` — desktop web. It imports `genleg.js`, `protocols.js` and
`balance.js`, so what it draws is what the game builds.

* every door as an overhead map, with the protocol that composed it
* paint corridor / room / pillar / cover, place entry and exit doors, erase
* **rotate leg** — pick a spine cell and everything past it swings 90° about
  it, carrying its pillars, covers, spawns and exit
* enemy spawns with type: drag, add, delete
* ~200 balance sliders bound to the live values, applied immediately so
  *Reroll layout* shows what a new number actually builds
* **Export JSON** emits layouts and balance overrides together

Nothing is written back to the repo from the browser. The export is a patch to
hand back.
