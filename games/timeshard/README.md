# TIMESHARD

A mobile-portrait time-bending rail shooter built with **three.js** and
**cannon-es**. You speed across the neon grid — open plains, walled
corridors, enclosed tunnels — while crystal drones burst out of doors in
the floor and walls and rain ethereal wisp-fire on you. **Hold a finger and
time slows to a crawl**; drag it to weave between bolts; tap with a second
finger to fire back. Ammo is scarce: kills leave a **soul** behind — fly
through it to absorb it.

Slow motion is *real simulation*, not animation: one physics world stepped
at `dt × timeScale`, so debris, your shots and enemy fire all crawl and
bloom together.

---

## Play it

Any static file server works — there is **no build step**:

```bash
# from the repo root:
python3 -m http.server 8000
# open http://localhost:8000/games/timeshard/ — on a phone, use your LAN IP
```

Works with mouse on desktop too (click = fire, long-press + drag = slow-mo
and steer).

## The rules

| Mechanic | Detail |
|---|---|
| Speed | You fly forward automatically; each zone crossed makes you faster. Distance = score backbone. |
| Slow-mo | **Hold** a finger: time drops to 13%. Limited by the **FOCUS** meter (drains while slowed, refills at speed). |
| Steer | **Drag** the held finger to weave across the track. Steering reads real time — weaving through a slowed world is the power fantasy. |
| Fire | **Tap** with a second finger (or a quick single tap). Shots are ballistic-compensated and softly aim-assisted: a tap hits what it points at. |
| Bullet time | **Your shards live outside time**: they fly at full speed while the world crawls — firing in slow-mo is precision mode, not a dead trigger. |
| Pause | ⏸ button: resume/restart/exit, the sound toggle, and local top-10 + recent-run boards. Sound is ON by default (and survives the iPhone mute switch). |
| Ammo | You start with 14 shards, max 30. Empty tank = dry click — go soul hunting. |
| Enemies | Drones emerge from doors in the floor/walls (or dive from the sky), match your speed ahead of you, and fire. One hit shatters them (**+50**). |
| Telegraph | A drone's magenta core swells ~0.7 s before each bolt — readable even in slow-mo. |
| Bolts | Ethereal comet-wisps with a spiral tail (the true path is straight = fair). Dodge them or shoot them down (**DEFLECT +40**). |
| Souls | Kills leave a glowing wisp (**+3 ammo, +15**) that drifts gently toward you if you pass close. Some zones carry a free ambient soul. |
| Shields | You can take **3 hits** (brief invulnerability after each). Third hit ends the run. |

## Weekly generated track

The zone sequence comes from a **seeded generator** (`src/levelgen.js`).
The seed derives from the ISO week (`timeshard/v2/2026-W29`), so every
player worldwide races the same track all week, and each week is its own
leaderboard bucket. Difficulty ramps by zone index: more enemies, faster
bolts, shorter fire intervals, longer engagements, more tunnels.

## Leaderboards & streaks (prototype = local)

`shared/scores.js` tracks all-time / weekly / daily bests and a
consecutive-day play streak in `localStorage`, behind the same
`recordRun / summary` contract the future backend will implement.

## Balancing the game

Everything lives in **`src/config.js`** (`TUNING`) — no engine code needed:

- `speed` / `steer` — pace and handling. *The* feel dials.
- `time` — slow-mo depth, ramp rates, focus tank size/drain/regen.
- `player` — shields, ammo economy, shot speed, aim plane.
- `enemies` / `bolts` — engagement distance, telegraph, aim lead + jitter.
- `souls` — bonus size, capture/homing radii, ambient frequency.
- `difficulty` — linear ramps (`from`, `to`, `at` zone N) for enemy count,
  concurrency, bolt speed, fire interval, tunnel frequency.
- `ZONES` — track widths and wall/ceiling heights per zone type.

## Architecture

```
index.html        UI shell: HUD (shields/ammo/score/focus), screens, ice CSS
src/
  config.js       every tuning knob + palette + zone geometry
  levelgen.js     seeded zone/spawn generator (pure data out)
  main.js         renderer, physics, time dial, steering, game loop
  audio.js        procedural WebAudio (pad filter tracks the time scale)
../../vendor/     three.js + cannon-es, vendored (no CDN, no bundler)
../../shared/     seeded RNG + week ids, local leaderboard/streak store
```

Engineering notes:

- **The time dial**: `timeScale` lerps between 1.0 and 0.13 (fast collapse,
  slightly slower recovery). Everything world-side consumes
  `dtGame = dt × timeScale`; steering and UI feedback (sparks, banners,
  shake) run on real time so the game always feels responsive.
- **One physics world**: `world.step(dtGame)` as a single variable step.
  Player shots and debris are dynamic bodies; drones are kinematic boxes.
- **True intercept aiming, both directions**: drones solve the closing-speed
  quadratic `(v²−b²)t² − 2·dz·v·t + |D|² = 0` so bolts genuinely arrive where
  you will be (`aimLead < 1` + jitter keep them dodgeable) — and YOUR taps
  raycast from a clean un-banked camera pose with soft aim assist
  (`player.aimAssist`) that snaps to the nearest drone/bolt near the ray and
  leads it with the same solve.
- **Shards outside time**: the slowed world step only advances your shots by
  `dtGame`, so each frame tops their integration up to real `dt` (full
  velocity + full gravity). Same arc at any time scale; collisions still
  resolve through the physics narrowphase.
- **Ethereal bolts**: additive sprite comet (bright core, violet tail,
  magenta halo) spiraling around a straight path — the wobble is visual
  dressing, the hit path is fair.
- **Tunnel-proof deflects**: bolts are lightweight kinematic visuals;
  shot-vs-bolt collision is a per-frame segment/sphere sweep of the shot's
  motion. Destruction debris stays 100% rigid-body, per the repo pillar.
- **Zone streaming**: zones (walls, ceilings, light rings, arches, pylons)
  build ahead of the camera and recycle behind it; spawn events trigger by
  proximity and respect a concurrency cap.
- **Perf guards**: shard/bolt/shot caps, floor-only debris collisions,
  pixel ratio capped at 2.

## Roadmap to iOS

1. **Backend leaderboards** — same weekly buckets as Gridbreaker
   (`POST /runs`, `GET /leaderboard/{week}`).
2. **Wrap or port** — Capacitor/WKWebView wrapper first (portrait lock,
   haptics on kill/deflect/hit); native only if the game earns it.
3. **Juice pass** — speed-lines in slow-mo, drone variants (shielded,
   weaving, turret pods on walls), boss gates every 10th zone, near-miss
   score bonus for grazing bolts.
4. **Anti-cheat** — deterministic seeds + input log → server replay
   validation.

## Verified

Headless Chromium (390×844 portrait, touch): boots clean, full loop
menu → run → kill → soul pickup → slow-mo hold → drag steering →
two-finger fire (CDP touch) → 3 hits → game-over stats → retry; weekly
zone sequence deterministic; scores persist; no console errors.
