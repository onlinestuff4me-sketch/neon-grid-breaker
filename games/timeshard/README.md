# TIMESHARD

A mobile-portrait Superhot-like built with **three.js** and **cannon-es**:
**time moves only while you act**. You stand inside a frozen diorama of
crystal drones and magenta bolts hanging mid-air. Press to let time flow and
aim; release to fire a chrome shard. Clear each "moment" in the least flowed
time.

Frozen-time slow motion is *real simulation*, not animation: one physics
world stepped at `dt × timeScale`, so debris, your shots and enemy fire all
crawl and bloom together.

---

## Play it

Any static file server works — there is **no build step**:

```bash
# from the repo root:
python3 -m http.server 8000
# open http://localhost:8000/games/timeshard/ — on a phone, use your LAN IP
```

Works with mouse on desktop too (press/drag/release).

## The rules

| Mechanic | Detail |
|---|---|
| Time | World runs at **2% speed** while you do nothing. Touching the screen ramps it to 100%. |
| Aim | **Press & drag** — a reticle follows your finger while time flows (aiming costs time!). |
| Fire | **Release** to launch a chrome shard at the reticle. Firing pushes time briefly so the shard flies. |
| Drones | Crystal octahedra. One hit shatters them into rigid-body ice. **+30 pts.** |
| Telegraph | A drone's magenta core swells ~0.8 s (game time) before it fires — readable even frozen. |
| Bolts | Enemy fire creeps toward you. Shoot one out of the air: **DEFLECT +40**. |
| Shields | You can take **3 hits**. A hit vaporizes nearby bolts (mercy) but breaks nothing else. |
| Moment | Shatter every drone to clear the moment: **+100** plus a **time bonus** (up to +150) that drains the longer time flows. |
| Score | Sum across moments until your shields run out. Pure skill, no upgrades. |

## Weekly generated moments

The sequence of dioramas comes from a **seeded generator**
(`src/levelgen.js`). The seed derives from the ISO week
(`timeshard/v1/2026-W29`), so every player worldwide unpicks the same
moments all week, and each week is its own leaderboard bucket. Difficulty
ramps by moment index: more drones, faster bolts, shorter fire intervals,
more bolts pre-frozen mid-air, wider strafing.

## Leaderboards & streaks (prototype = local)

`shared/scores.js` tracks all-time / weekly / daily bests and a
consecutive-day play streak in `localStorage`, behind the same
`recordRun / summary` contract the future backend will implement.

## Balancing the game

Everything lives in **`src/config.js`** (`TUNING`) — no engine code needed:

- `time` — idle crawl speed, ramp rates, post-shot flow pulse. *The* feel dial.
- `player` — shields, shot speed, aim plane, hit radius.
- `drones` / `bolts` — sizes, hitbox generosity, telegraph window, aim jitter.
- `score` — par seconds, time-bonus size and drain rate.
- `difficulty` — linear ramps (`from`, `to`, `at` moment N) for drone count,
  bolt speed, fire interval, initial frozen bolts, strafe.
- `shatter` — shards per drone, burst impulse, debris TTL and body cap.

## Architecture

```
index.html        UI shell: HUD (shields/score/time-bonus), screens, ice CSS
src/
  config.js       every tuning knob + palette
  levelgen.js     seeded moment generator (pure data out)
  main.js         renderer, physics, time dial, input, game loop
  audio.js        procedural WebAudio (pad filter opens as time flows)
../../vendor/     three.js + cannon-es, vendored (no CDN, no bundler)
../../shared/     seeded RNG + week ids, local leaderboard/streak store
```

Engineering notes:

- **The time dial**: `timeScale` lerps between 0.02 and 1.0 (fast attack,
  faster release — freezing must feel snappy). Everything world-side consumes
  `dtGame = dt × timeScale`; UI feedback (sparks, banners, shake) runs on
  real time so the game always feels responsive.
- **One physics world**: `world.step(dtGame)` as a single variable step.
  Player shots and debris are dynamic bodies; drones are kinematic boxes.
- **Ballistic-compensated aim**: shots get `vy += -0.5·g·t` at launch so a
  tap hits exactly what it points at — the skill is *when* and *how long you
  dare to aim*, not gravity arithmetic.
- **Tunnel-proof deflects**: enemy bolts are lightweight kinematic visuals;
  shot-vs-bolt collision is a per-frame segment/sphere sweep of each shot's
  motion, so fast shards can't skip past small bolts at low frame rates.
  Destruction debris stays 100% rigid-body, per the repo pillar.
- **Frozen ↔ flowing look**: fog color, exposure, hemisphere light, edge
  tints and the music's lowpass cutoff all track `timeScale` — the world
  visibly and audibly blooms when time runs.
- **Perf guards**: shard body cap, bolt cap, shot cap, floor-only debris
  collisions, pixel ratio capped at 2.

## Roadmap to iOS

1. **Backend leaderboards** — same weekly buckets as Gridbreaker
   (`POST /runs`, `GET /leaderboard/{week}`).
2. **Wrap or port** — Capacitor/WKWebView wrapper first (portrait lock,
   haptics on shatter/deflect); native only if the game earns it.
3. **Juice pass** — bolt trails, shard glint sparkles, slow-mo audio doppler,
   drone variants (shielded, splitting), boss moments every 10th.
4. **Anti-cheat** — deterministic seeds + input log → server replay
   validation.

## Verified

Headless Chromium (390×844 portrait, touch): boots clean, full loop
menu → moments → shatter → deflect → shields lost → game-over stats → retry;
weekly seed stable; scores persist.
