# TIMESHARD

A first-person time-manipulation arcade shooter built for **portrait-mode mobile**,
where **time only moves when you let go of the screen**.

White world. Red enemies. One hit and you shatter — them, or you.

## The touch control scheme

Everything runs off holds, drags, and taps — one thumb works, two thumbs sing:

| Gesture | Effect |
|---|---|
| **Hold** (any finger) | Bullet time: ~5% speed standing still, creeping up to ~30% while you move. The tank holds ~6 seconds (energy ring around the crosshair + top bar); run it dry and you're stuck at full speed until it recharges to 30% |
| **Left-half drag** | Floating virtual stick: smooth, velocity-eased movement to weave between hanging bullets |
| **Right-half drag** | Look/aim — the camera is yours; a soft assist only settles your crosshair onto targets you're already pointing at, and red edge arrows point toward off-screen threats |
| **Tap** | Fire at the crosshair — tap repeatedly to work through a whole squad in one freeze |
| **Tap a dropped gun** | Auto-sprint to it and equip it, one tap |

## Features

- **First-person 3D** (Three.js, vendored — no CDN, works offline) tuned for a tall portrait viewport
- **Time dilation**: enemies, bullets, and debris all run on a scaled world clock, while your camera and dash run in real time — aim and dodge at full speed while the world crawls
- **Projectile physics**: bullets have real travel time and gravity drop; enemy shots are slow glowing orbs that push a water-like ripple wake through the air; swept segment-vs-capsule collision so nothing tunnels through
- **Shatter physics**: enemies burst into red shards with gravity, spin, and floor bounces
- **Enemy AI**: each wave attacks from one flank so the fight stays in front of you; they open fire from range, strafe, steer around cover, keep separation, telegraph shots (white gun flash), and melee up close
- **Six enemy types**: gunners, fast bare-handed rushers (wave 2), spread-firing shotgunners (wave 3), burst-firing heavies and a looming long-barrel sniper whose shots fly twice as fast (wave 4), and gunmetal armored units that only headshots can crack — aim for the red head (wave 5)
- **Weapon pickups**: enemies drop shotguns (4 shells, 6-pellet spread), and a slain sniper always drops his rifle — 3 rounds that pierce through multiple enemies. Tap a drop to sprint to it, or run over it (drops magnetize when close); grabbing one racks a satisfying pump-action
- **First-run onboarding**: wave 1 opens with a zone guide (move left / look right / tap to fire) and enemies hold their fire until it clears
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
