# NEON ARCADE

A collection of **physics-based, skill-focused arcade games** for mobile web
(portrait), built with three.js + cannon-es — glossy 80s chrome/neon/TRON
aesthetic, real rigid-body destruction, weekly procedurally-generated levels,
and high-score chasing. Each game is a prototype on a path to becoming an
iOS app.

**Play:** https://onlinestuff4me-sketch.github.io/neon-grid-breaker/

| Game | Status | One-liner |
|---|---|---|
| [GRIDBREAKER](games/gridbreaker/) | 🟢 Playable | Fly down a TRON corridor, hurl chrome balls, shatter real-physics glass, chain crystals for multiball. |
| [TIMESHARD](games/timeshard/) | 🔧 In development | Superhot-like: time moves only when you act. Unpick frozen moments. |

## Run locally

No build step — any static server from the repo root:

```bash
python3 -m http.server 8000
# hub:        http://localhost:8000/
# gridbreaker http://localhost:8000/games/gridbreaker/
# on a phone, use your machine's LAN IP
```

## Deployment

Every push to `main` auto-deploys the whole repo to GitHub Pages via
`.github/workflows/pages.yml`. Feature branches are for development; merging
is releasing.

## Repo structure & conventions

See [CLAUDE.md](CLAUDE.md) — the canonical guide for humans and AI agents
working here: repo map, hard conventions (no build step, physics-first,
all balance knobs in `config.js`, seeded weekly levels, shared score store),
the mobile-testing recipe, and the checklist for adding a new game.

```
index.html          arcade hub page
games/<game>/       one self-contained folder per game
shared/             seeded RNG + week ids, local leaderboards/streaks
vendor/             vendored three.js + cannon-es
```

## Shared design pillars

- **Instantly rewarding**: realistic physics destruction is the first-minute
  hook; no tutorials needed.
- **Skill-based scoring**: distance/efficiency + streak mechanics; no
  upgrades or currencies — you get better, not your save file.
- **Weekly worlds**: one seed per ISO week per game — everyone plays the same
  generated level all week, each week is its own leaderboard bucket.
- **Tunable difficulty**: every ramp is data in the game's `config.js`.

## Roadmap

1. Playtest & balance Gridbreaker (config-only tuning passes).
2. Backend leaderboards (weekly buckets, daily bests, streaks) shared by all
   games; then swap each game's local store for the API client.
3. Timeshard prototype (shares the shatter/physics/seed/score foundations).
4. iOS: Capacitor wrapper per game (portrait lock, haptics, Game Center),
   native port for whichever game earns it.
