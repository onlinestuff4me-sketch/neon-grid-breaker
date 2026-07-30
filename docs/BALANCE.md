# TIME SHATTER — balance reference

Every tunable number in the game, where it lives in `src/main.js`, and what
it does. **This file is documentation, not configuration** — the game reads
the constants in `src/main.js`. When you change a value there, change it
here too.

To experiment before committing, use the **Balance Tuner** artifact: it
holds the same values, lets you drag them, and emits a values block that
maps 1:1 onto the tables below.

---

## 1. Weapons

`const WEAPONS` — near the top of `src/main.js`.

Ammo model: a weapon holds **`mag` bullets per clip** and up to **`maxClips`
spare clips**. Firing empties the clip; a reload burns one spare. Picking up
a weapon you already carry adds a clip (capped at `maxClips`). Run every
clip dry and you drop to the knife.

| Weapon | Rounds / clip (`mag`) | Max clips | Reload (s) | Fire cd (s) | Muzzle speed | Notes |
|---|---|---|---|---|---|---|
| knife | ∞ | 0 | — | 0.42 | — | 2.0 m reach, front arc only |
| pistol | 5 | 3 | 1.00 | 0.22 | 46 | the only deep clip |
| shotgun | 2 | 3 | 1.50 | 0.55 | 46 | 6 pellets, spread 0.055 |
| burst (heavy) | 2 | 3 | 1.40 | 0.50 | 52 | 3-round burst, 0.09 s apart |
| sniper | 2 | 3 | 1.75 | 0.90 | 95 | pierces 3 |
| launcher | 2 | 3 | 2.00 | 0.90 | 26 | 5.5 m blast |
| rocket | 2 | 3 | 2.35 | 1.20 | 34 | 8.0 m blast |

Reload time rises with weapon weight — pistol is the fastest rack, rocket
the slowest. Reloads run on **real time**, so freezing the world does not
refill a gun.

Player bullets fall under `BULLET_GRAVITY = 4`; enemy bullets fly straight.

---

## 2. Drops

Two constants: `ENEMY_TYPES[type].drop` (the probability) and `TYPE_DROP`
(which weapon that enemy was carrying).

| Enemy | Drop chance | Drops |
|---|---|---|
| shotgunner | 0.55 | shotgun |
| heavy | 0.35 | burst |
| armored | 0.30 | burst |
| sniper | always | sniper |
| bomber | 0 | — (launcher is wired in `TYPE_DROP`, chance is 0) |
| rocketeer | 0 | — (rocket is wired in `TYPE_DROP`, chance is 0) |
| gunner, rusher, shieldbearer, laser | 0 | — |

**Pistol clips:** any kill that does not roll a weapon drops a clip if
`Math.random() < 0.34`. This is the ammo lifeline — raise it if players hit
the knife too often, lower it to squeeze them forward harder.

Drops live for `PICKUP_LIFE = 12` s (last 1.2 s they sink into the floor)
and are collected by **walking over them** (1.8 m), with a 3.2 m magnet
pull. There is no tap-to-collect.

---

## 3. Difficulty curve

One dial drives everything: `diffT()` = `min((wave − 1) / 11, 1)` — 0 on
wave 1, full heat at **wave 12**. In Rush Hour the wave number is replaced
by `1 + rushT / 25`, so it ramps on the run clock (~3 min to full).

| Metric | Formula | Wave 1 | Wave 6 | Wave 12 |
|---|---|---|---|---|
| Enemy bullet speed | `11 × min(0.55 + 0.45·diffT + late, 1.35)` | 6.1 | 8.3 | 11.0 |
| Telegraph + cooldown scale | `1.15 − 0.63·diffT` | 1.15× | 0.86× | 0.52× |
| Slow-mo drain rate | `0.55 + 0.45·diffT` (rush: flat 0.4) | 0.55× | 0.75× | 1.0× |

`late` adds 2 % per wave past 12, capped at 1.35× base speed.

**Why wave 8 used to spike:** `armored` debuted there *and* the old ramp
(`/7`) maxed out there, so full bullet speed, shortest telegraphs and
full-price slow-mo all landed on the same wave as the headshot-only enemy.
The ramp now runs to 12 and the attrition types are spread out.

---

## 4. Enemy introductions

`const TYPE_INTRO` — the wave (or door, in the tunnel) each type debuts.
The debut headlines its wave: it spawns first and gets a warning card.

| Wave | Debut |
|---|---|
| 1 | gunner |
| 2 | rusher |
| 3 | shotgunner |
| 4 | shieldbearer |
| 5 | heavy |
| 6 | sniper |
| 7 | bomber |
| 9 | armored |
| 11 | rocketeer |
| 12 | laser |

---

## 5. Wave composition

`composeWave(n)`:

- **Total** = `min(6 + 2n, 30)`.
- **Rushers** (from wave 2) = `min(round(total × 0.4), 2 + n)` — the horde core.
- **Debut type** gets `max(2, round(total / 5))` bodies on its wave.
- **Veteran shooters** fill from `TYPE_SHARE`: `[share, cap]` means
  `min(cap, floor(total / share))` of that type.
- **Gunners** backfill, keeping at least ~25 % of the wave.
- One **laser** leads every even wave from 12 on.

| Type | share | cap |
|---|---|---|
| shotgunner | 4 | 4 |
| heavy | 5 | 3 |
| shieldbearer | 8 | 2 |
| sniper | 7 | 2 |
| bomber | 6 | 2 |
| armored | 9 | 2 |
| rocketeer | 8 | 2 |

**Tunnel legs** (`hallWave(n)`) substitute the open-air types for
close-quarters ones (laser→rusher, sniper→gunner, rocketeer→heavy,
bomber→shotgunner) and set the quota to **12** (door 1), **15** (door 2),
then `min(12 + 2n, 24)`.

---

## 6. Spawn pacing

| Knob | Tunnel | City / Rush |
|---|---|---|
| Alive at once (`maxAlive`) | `min(3 + ⌊wave/2⌋, 6)` | `min(6 + ⌊wave/2⌋, 10)` |
| Gap after a spawn | `(empty ? 0.9 : 1.4 + 2.2·fill) × (0.85–1.15)` | `(0.7 + 2.6·fill) × (0.85–1.15)`, +1.6 s when ≤2 left |
| Gap after a kill | pulled forward to 0.5–1.4 s | same |
| Cluster size | 1–3 round the corner together | rushers arrive as packs of 3–4 |

`fill` = live enemies ÷ `maxAlive`. Spawns are suppressed while a message
card is on screen, and in the tunnel they are hard-gated to at least 4 m
**ahead** of the player. The last `HALL_FINALE = 2` of a leg stage on the
door approach so the door opens in view.

**Sight grace:** an enemy must be in the player's line of sight for 0.45 s
before its telegraph may begin — rounding a corner never means eating an
already-charged shot.

---

## 7. Time control

`const SLOWMO = { base: 5, bonus: 2, cap: 10, drain: 1 }`

- `base` — seconds in the tank at wave start (and the floor every wave).
- `bonus` — seconds refunded per kill.
- `cap` — maximum bank.
- `drain` — seconds per second while frozen, scaled by the difficulty curve
  above.

Time scale: `TIME_SLOW = 0.05` standing still, rising to
`TIME_MOVE_MAX = 0.3` at full stick — moving costs the world time.

---

## 8. Movement, camera, misc

| Constant | Value | Meaning |
|---|---|---|
| `MOVE_SPEED` | 5.5 | m/s at full stick |
| `LOOK_SENS` | 4.4 | rad per screen-width, horizontal |
| `LOOK_SENS_Y` | 1.15 | rad per screen-width, vertical |
| `PITCH_LIMIT` | 0.42 | rad, the torso↔head band |
| `BLAST_R` | 2.3 | enemy grenade blast radius |
| `RUSH.crowd` | 30 | pedestrians in Rush Hour |
| `HALL.cell` | 4 | corridor cell size (m) |
| `CITY.street` | 7.5 | road width (m) |

---

## 9. Rush Hour

- Crowd of 30, **55 %** of whom are sleepers.
- Sleeper clusters wake every `max(4, 10 − rushT × 0.045) × (0.8–1.3)` s;
  cluster size 1, then 2 after 30 s, 3 after 90 s.
- Slow-mo drains at a flat **0.4×** all run — freezing time is the mode's
  core verb.
- Shooting a civilian costs **2 s** of bank.
