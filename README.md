# GRIDBREAKER

A physics-based arcade smasher for mobile web (portrait), built with **three.js**
and **cannon-es**. Glossy retro-future aesthetic: chrome, neon, reflections,
TRON grid corridor, synthwave sun.

You fly forward through an endless neon corridor. **Tap to hurl chrome balls**
— real rigid bodies with real ballistics — and shatter the glass walls before
you fly into them. Every pane fractures into physical shards that tumble,
bounce and scatter. Simple to start, hard to master: the corridor speeds up,
obstacles start moving, and ball economy punishes sloppy throws.

Inspired by the design of [Smash Hit](https://en.wikipedia.org/wiki/Smash_Hit)
(Mediocre AB), with the classic
[multiball streak](https://smashhit.fandom.com/wiki/Multiball) mastery
mechanic, re-skinned into an 80s TRON world.

---

## Play it

Any static file server works — there is **no build step**:

```bash
cd physics-arcade-game
python3 -m http.server 8000
# open http://localhost:8000 — on your phone, use your machine's LAN IP
```

Works with mouse on desktop too (click = tap).

## The rules

| Mechanic | Detail |
|---|---|
| Throw | Tap anywhere: a chrome ball launches at the tap point. Balls obey gravity — learn the drop. |
| Ammo | You start with 20 balls. Run ends when a crash leaves you at 0. |
| Crash | Fly into unbroken glass: you smash through face-first, **−8 balls**, chain resets. |
| Crystals | Green octahedra: **+3 balls** each. Missing one (it passes you) breaks your chain. |
| Multiball | Smash **10 crystals in a row** → +1 ball per throw (up to ×5). The core skill loop. |
| Combo | Breaking panes in quick succession multiplies smash points (up to ×8). |
| Score | Distance in meters + smash points. Pure skill, no upgrades, no currency. |

## Weekly generated levels

The endless layout is produced by a **seeded procedural generator**
(`src/levelgen.js`). The seed derives from the ISO week
(`gridbreaker/v1/2026-W29`), so:

- every player worldwide plays the **same layout all week** — a fair contest;
- next Monday a **brand-new level** appears automatically, forever;
- each week is its own leaderboard bucket.

Room patterns currently in the pool: floating free glass, gap walls,
half-covered windows, 3×3 pane grids, sliding panes, swinging blades,
pillar slaloms — all gated and scaled by the difficulty curve.

## Leaderboards & streaks (prototype = local)

`src/scores.js` tracks, in `localStorage`: **all-time best**, **best per
weekly level**, **best today**, **runs this week**, and a **consecutive-day
play streak**. It exposes a tiny `recordRun / summary` contract designed to be
swapped for a real backend (see roadmap).

## Balancing the game

Everything lives in **`src/config.js`** (`TUNING`) — no engine code needed:

- `speed` — base scroll speed, per-room ramp, cap. *The* difficulty dial.
- `balls` — starting ammo, crash penalty, throw speed, gravity.
- `multiball` / `crystal` — streak length, refund size, spawn cadence.
- `difficulty` — linear ramps (`from`, `to`, `at` room N) for corridor
  blockage, obstacle movement speed, hard-pattern probability, room density.
- `shatter` — fracture grid resolution, burst impulse, shard lifetime, and a
  hard cap on live shard bodies (the mobile perf guard).

## Architecture

```
index.html        UI shell: HUD, start/game-over screens, neon CSS
vendor/           three.js + cannon-es, vendored (no CDN, no bundler)
src/
  config.js       every tuning knob + palette
  rng.js          mulberry32 PRNG, ISO-week seed derivation
  levelgen.js     seeded room/pattern generator (pure data out)
  main.js         renderer, physics world, destruction, game loop, input
  audio.js        procedural WebAudio SFX + synthwave bass loop (no samples)
  scores.js       local leaderboard + day-streak persistence
```

Engineering notes:

- **Physics**: cannon-es world, fixed 60 Hz step. Balls are dynamic spheres;
  panes are kinematic boxes; shards are dynamic boxes spawned from a jittered
  fracture grid with a radial impulse centered on the impact point (plus a
  share of the ball's incoming velocity — hitting harder looks harder).
- **Smash-through feel**: on impact the pane's body is removed and the ball's
  pre-impact velocity is mostly restored, so balls punch *through* glass
  instead of bouncing off — the single most important feel decision.
- **Perf guards**: shard collision is filtered to the floor only, live shard
  bodies are capped, off-screen objects are recycled, pixel ratio capped at 2.
- **Reflections**: a procedural equirect canvas (sun, horizon glow, city
  streaks) drives `scene.environment` — free chrome, no HDR file.
- **Crash detection**: player AABB vs. blocking panes crossing the camera
  plane (handles moving/spinning panes via their physics AABB).

## Roadmap to iOS

1. **Backend leaderboards** — replace `scores.js` with an API client
   (`POST /runs {week, score}`, `GET /leaderboard/{week}`), plus daily bests
   and streaks server-side. Weekly seeds already make buckets trivial.
2. **Wrap or port**:
   - fastest: Capacitor/WKWebView wrapper of this exact code (portrait lock,
     haptics via plugin, Game Center auth);
   - best: native port — SceneKit/Metal + a physics engine, reusing
     `levelgen.js` logic and the same seed derivation so web and iOS play the
     identical weekly level.
3. **Juice pass** — bloom on capable GPUs, haptic on shatter, ball trails,
   instanced shard rendering, more room patterns, daily challenge modifiers.
4. **Anti-cheat** — server-side replay validation (deterministic seed + input
   log makes runs replayable).

## Verified

Headless Chromium (390×844 portrait, touch): boots clean, full loop
menu → run → shatter → combo → crash → game-over stats → retry; weekly seed
stable; scores persist; ~60 fps on desktop GPU (mobile perf to be profiled on
device).
