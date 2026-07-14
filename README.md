# TIMESHARD

A SUPERHOT-inspired first-person arcade shooter built for **portrait-mode mobile**,
where **time only moves when you let go of the screen**.

White world. Red enemies. One hit and you shatter — them, or you.

## The one-finger control scheme

The whole game is played with a single finger at a time:

| Gesture | Effect |
|---|---|
| **Hold & drag** | Time freezes (~5% speed) while you look around, line up shots, and watch bullets hang in the air |
| **Release** | Time snaps back to full speed |
| **Tap** | Fire at the crosshair |
| **Flick** | Dash / dodge in the flicked direction (brief invulnerability at the start) |
| **Second-finger tap** *(optional)* | While holding to aim, tap with another finger to fire without unfreezing time |

## Features

- **First-person 3D** (Three.js, vendored — no CDN, works offline) tuned for a tall portrait viewport
- **Time dilation**: enemies, bullets, and debris all run on a scaled world clock, while your camera and dash run in real time — aim and dodge at full speed while the world crawls
- **Projectile physics**: bullets have real travel time and gravity drop; enemy shots are slow and visible so you can dodge them; swept segment-vs-capsule collision so nothing tunnels through
- **Shatter physics**: enemies burst into red shards with gravity, spin, and floor bounces
- **Enemy AI**: advance with strafing, steer around cover, keep separation, telegraphed aiming (white gun flash before firing), melee when they get close
- **Superhot rules**: one hit kills you; one hit shatters them; endless escalating waves
- Synthesized sound effects (WebAudio, no assets), haptic feedback, kill-word flashes

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
