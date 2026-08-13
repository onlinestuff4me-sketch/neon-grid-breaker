# TIME SHATTER — balance reference

<!-- GENERATED FILE — do not edit by hand.
     Source of truth: src/balance.js
     Regenerate:      node tools/gen-balance-doc.mjs -->

Every tunable number the game reads, straight out of `src/balance.js`. The
game imports that file, this document is generated from it, and the Balance
Tuner artifact mirrors the same shape — so none of the three can drift.

---

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

`diffT` runs 0 → 1 across **11 waves** (full heat at wave
12). In Rush Hour the wave number is replaced by
`1 + rushT / 25`, so it ramps on the run clock instead.

| | Bullet speed (m/s) | Telegraph scale | Slow-mo cost |
|---|---|---|---|
| wave 1 | 6.05 | 1.15× | 0.55× |
| wave 6 | 8.3 | 0.864× | 0.755× |
| wave 12 | 11 | 0.52× | 1× |

Past wave 12, speed creeps 2 % per
wave to a hard cap of 1.35× base. Rush Hour drains the bank at
a flat 0.4×. An enemy must be in view for
**0.45 s** before its telegraph may begin.

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
