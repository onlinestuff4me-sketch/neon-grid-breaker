# TIMESHARD

A first-person time-manipulation arcade shooter built for **portrait-mode mobile**,
where **time only moves when you let go of the screen**.

White world. Red enemies. One hit and you shatter — them, or you.

## The touch control scheme

Everything runs off holds, drags, and taps — one thumb works, two thumbs sing:

| Gesture | Effect |
|---|---|
| **Hold** (any finger) | Bullet time: ~5% speed standing still, creeping up to ~30% while you move — dodging costs the world a few frames |
| **Left-half drag** | Floating virtual stick: smooth, velocity-eased movement to weave between hanging bullets |
| **Right-half drag** | Manual look/aim. Let go of the camera and it auto-tracks the nearest visible enemy (with a fast snap to the next target after each kill) |
| **Tap** | Fire at the crosshair — tap repeatedly to work through a whole squad in one freeze |
| **Tap a dropped gun** | Auto-sprint to it and equip it, one tap; your aim recovers onto the remaining enemies |

## Features

- **First-person 3D** (Three.js, vendored — no CDN, works offline) tuned for a tall portrait viewport
- **Time dilation**: enemies, bullets, and debris all run on a scaled world clock, while your camera and dash run in real time — aim and dodge at full speed while the world crawls
- **Projectile physics**: bullets have real travel time and gravity drop; enemy shots are slow glowing orbs that push a water-like ripple wake through the air; swept segment-vs-capsule collision so nothing tunnels through
- **Shatter physics**: enemies burst into red shards with gravity, spin, and floor bounces
- **Enemy AI**: each wave attacks from one flank so the fight stays in front of you; they open fire from range, strafe, steer around cover, keep separation, telegraph shots (white gun flash), and melee up close
- **Three enemy types**: gunners, fast bare-handed rushers (from wave 2), and slow heavies that fire 3-round bursts (from wave 4)
- **Weapon pickups**: shattered gunners and heavies sometimes drop a shotgun (marked with a red ring) — drag up to run over it (drops magnetize to you when close) for 4 shells of 6-pellet spread, then you're back to the infinite pistol; your aim auto-recovers onto the remaining enemies
- **TIMESHARD rules**: one hit kills you; one hit shatters them; endless escalating waves with enemy bullets creeping faster each wave
- **Rotating arenas**: the cover layout changes every 3 waves (scattered cover → pillar court → corridors)
- Synthesized sound effects (WebAudio, no assets), haptic feedback, kill-word flashes, best-wave tracking (localStorage)

## Run it

It's a static page — serve the folder and open it on a phone (or a mobile
emulation viewport in desktop devtools):

```bash
python3 -m http.server 8000
# then open http://localhost:8000 (portrait viewport recommended)
```

For real haptics/audio on a phone, serve over HTTPS or localhost port-forwarding
(e.g. `adb reverse tcp:8000 tcp:8000` for Android).

## Structure

- `index.html` — HUD, overlays, menus (pure DOM/CSS on top of the canvas)
- `src/main.js` — the whole game: rendering, input, physics, AI, waves, audio
- `lib/three.module.min.js` — vendored Three.js r170
