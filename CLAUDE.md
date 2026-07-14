# NEON ARCADE — agent guide

Monorepo of physics-based, skill-focused arcade games for **mobile web,
portrait orientation**, each with a path to becoming an iOS app. Read this
before changing anything; it encodes the conventions every game follows.

## Repo map

```
index.html                  arcade hub page (lists all games; add new games here)
games/<game>/               one folder per game, fully self-contained playable page
  index.html                UI shell: HUD + screens + importmap + neon CSS
  src/config.js             EVERY tuning/balance knob + palette (never hardcode feel values)
  src/levelgen.js           seeded procedural generator (pure data out, no three.js in it)
  src/main.js               renderer, physics, game loop, input
  src/audio.js              procedural WebAudio (no samples, no network assets)
shared/rng.js               mulberry32, hashString, ISO-week ids, weeklySeed(tag)
shared/scores.js            createScoreStore(gameId): local bests + day streak
vendor/                     vendored libs (three.module.js + three.core.js, cannon-es.js)
.github/workflows/pages.yml deploys the WHOLE repo to GitHub Pages on push to main
```

## Hard conventions

- **No build step.** Plain ES modules + importmap pointing at `../../vendor/`.
  Never add a bundler, framework, or CDN URL. New libs get vendored.
- **Real physics is the product.** Destruction, projectiles, and debris are
  rigid bodies (cannon-es), not animations. Fake only what's invisible.
- **All balance in `config.js`.** Feedback like "too hard early" must be a
  one-line change. Difficulty curves use `{from, to, at}` linear ramps.
- **Weekly levels are seeded.** `weeklySeed('<game>/v<generatorVersion>')`
  from `shared/rng.js`. Bump `generatorVersion` when the generator changes
  mid-week compatibility. Determinism is sacred (future replay validation).
- **Scores** via `createScoreStore('<game>')` — never touch localStorage
  directly. The recordRun/summary contract will become a backend API.
- **Mobile-first**: portrait, `touch-action: none`, pointer events (mouse
  works automatically), pixel ratio capped at 2, safe-area insets, audio
  unlocked on first gesture, pause on `visibilitychange`.
- **Perf guards**: cap live debris bodies, filter debris collisions down,
  recycle everything behind the camera, prefer emissive + additive sprites
  over postprocessing bloom.

## Testing (do this before every push)

Serve statically and drive with Playwright at iPhone portrait size:

```bash
python3 -m http.server 8137   # repo root
# Playwright: viewport 390x844, hasTouch, isMobile,
# executablePath /opt/pw-browsers/chromium (in Claude cloud envs)
```

Verify: no console/page errors, full loop (menu → play → destruction →
game over stats → retry), and take screenshots and LOOK at them — visual
bugs don't throw. Use `page.touchscreen.tap()` (overlays swallow
`page.tap('#app')`).

## Iteration workflow

- Work on a feature branch; merge to `main` deploys automatically to
  GitHub Pages (the shareable/testable URL).
- For instant phone playtesting of a WIP, also publish a Claude Artifact:
  bundle with `esbuild --bundle --minify --alias:three=<abs>/vendor/three.module.js
  --alias:cannon-es=<abs>/vendor/cannon-es.js`, inline into a single HTML file
  (artifacts allow no external requests).
- Keep game-over screens screenshot-worthy: they're the feedback loop with
  the user (score + bests + streak visible).

## Adding a new game

1. Copy the `games/gridbreaker/` structure; give it a `config.js` first.
2. Use `shared/` for RNG, weekly seeds, and scores from day one.
3. Add a card to the hub `index.html` (badge: PLAYABLE / IN DEVELOPMENT).
4. Write a README in the game folder: rules table, tuning guide, roadmap.
5. Same neon/chrome family, but each game gets its own accent identity.

## Roadmap conventions (per game)

Prototype (mobile web, local scores) → backend leaderboards (weekly buckets
already seeded) → iOS via Capacitor wrapper first, native port only if the
game earns it. Design docs live in the game folder's README.
