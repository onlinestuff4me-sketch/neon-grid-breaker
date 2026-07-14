# TIMESHARD (in development)

A mobile-portrait Superhot-like: **time moves only when you act**.

## Premise

You stand in a frozen diorama — attackers, projectiles, and glass mid-air,
all crystallized. While your finger is still, the world crawls at ~2% speed.
Drag to aim, release to fire/deflect — and while you interact, time runs.
Every level is a single readable "moment" you unpick with planning and
precise, minimal motion.

## Design pillars (draft)

- **Frozen-time physics**: one global time-scale multiplier on the physics
  step (cannon-es supports this trivially: `world.step(fixed * timeScale)`),
  so slow-motion is *real* simulation, not animation.
- **Same shatter tech as Gridbreaker**: shared destruction/fracture code —
  break crystalline enemies into physical shards.
- **Skill scoring**: clear the moment in the least *moved time*; leaderboards
  per weekly generated arena, reusing `shared/rng.js` + `shared/scores.js`.
- **Aesthetic**: same neon/chrome world as Gridbreaker but inverted — bright
  frozen white-cyan scenes that bloom into motion color when time flows.

## Status

Stub only. See the repo root `CLAUDE.md` for build conventions before
starting implementation.
