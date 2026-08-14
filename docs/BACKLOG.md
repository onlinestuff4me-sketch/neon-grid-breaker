# What's left

Ordered by value per unit of effort, for a game that is live on the web and
cheap to iterate on. Everything here is web-iterable unless marked otherwise.

---

## 0. Playtest the scarcity curves — before anything else

The four levers went in and **have never been played**. Doors 1–3 should feel
generous, 4–6 should tighten, and by 8 you should be counting rounds and
hoarding the freeze. Numbers at door 8 currently work out to about **1.1
rounds per enemy**, which is the "most shots must land" band.

Everything below is speculative until this is validated, because if the ramp
is wrong the fix is a keyframe drag in the Scarcity Console, not new content.

---

## 1. The fire telegraph — the biggest single gap

The reference's signature look, and we don't have it. Amber "veins" ramp up
across an enemy's whole body over roughly a second before he fires, peak on
the shot, then cool. **We originally mistook this for a hit flash** and
copied it onto our debris, where it was meaningless confetti; it was removed.
The real thing was never built.

This is not decoration. Our telegraph today is `setEgunFlash` — a white gun
tip, which at portrait scale is a few pixels. At a 42° horizontal field,
knowing *who is about to shoot* is the whole skill of the mode, and right now
that information is nearly invisible. A body-wide ramp is legible at any
distance and in peripheral vision.

Ramp 0.30 s scaled up, hold through the shot, cool 0.30 s, and **kill it
instantly on death** — the reference's body goes flat red the moment it is
hit, which is what makes an interrupted telegraph read as interrupted.
Colour ramp `#ff2d1a → #ff7030 → #ffa83c → #fff020`, concentrated on chest,
hips, knees and feet.

## 2. The archive screen

The spine of the meta, and the expensive part is already built: `protocols.js`
is a registry of 20 entries with names, tiers, unlock keys and archive lines,
and `lifetimeDoors` + the `archive` set are already persisted. What is missing
is the screen that reads them.

One grid, three sections — enemies, protocols, weapons. Locked entries show
as silhouettes with the designation visible and the name hidden (`P-07 ·
████████`), so you can see how much is left. Unlocking is *meeting*, not
defeating.

Cheap, and it converts depth from a number into a reason.

## 3. Per-part shatter, and where you hit

Bookmarked in `TUNNEL_META.md`. Break each body part separately, with the
head worth more **time bank** than the torso. The reward is seconds rather
than points on purpose: as ammo tightens and time-per-kill falls, precision
becomes the way to keep the bank alive — the same spray-to-choose progression
the scarcity curves encode. Points would sit outside that loop.

Also makes the knife's reach meaningful, since a jab is always a body hit.

## 4. Protocol elements, cheapest first

Ten are designed, registered and gated but not built. `impl: false` keeps the
composer from picking them, so each one ships by flipping a flag.

| Element | Kind | Why it's worth building |
|---|---|---|
| **One-way seal** | measure | Cheapest. A door that shuts behind you mid-leg, committing you to the second half. Real tension for very little code. |
| **Blackout** | condition | Emergency lighting, visibility ~8 m. Freezing time becomes a torch as well as a shield — it changes what the mechanic is *for*. |
| **Breach walls** | measure | Marked panels enemies come *through* mid-leg, using the shatter language we already have on architecture. Turns a cleared corridor live again. |
| **Grinder** | measure | Your idea. A slab that seals the leg behind you and advances — and **does not stop while time is frozen**, because it is the building, not a person. The first element that attacks the slow-mo mechanic itself. |
| Gallery / stairwell / spiral | forms | New skeletons. Stairwell needs vertical movement, which is the only one here that touches the physics. |
| Turret drop, flood, dead air | mixed | Later. Flood and dead air both need systems that do not exist yet. |

## 5. Higher-fidelity characters — **needs you**

Three.js already has `SkinnedMesh` and `AnimationMixer`; we would vendor
`GLTFLoader` (~50 KB) and load rigged characters with real animation clips.
The engine is not the blocker.

**Blender is.** Our enemies are box puppets whose limbs are rotated by
arithmetic — no hands, no weapon actually held, no animation blending. Fixing
that means authoring rigged meshes, and that is art direction, not code.
Worth remembering Unity would not help here either: you author in Blender for
both.

The reference is deliberately low-poly and untextured, so the target is
cheap — the gap is rigging and animation, not polygon count.

---

## Not on this list, and why

**Haptics** are done to the limit of the web. `navigator.vibrate` is not
implemented by iOS Safari at all, so nothing we write can fire on an iPhone
browser. The Core Haptics path is already wired and waiting in
`src/native.js`; it starts working the moment the app runs, not before.

**Offline** already works — service worker on the web, bundled assets in the
app. There is nothing left to add.

Both were real work; they are just finished, and their payoff arrives with
TestFlight rather than with a web deploy.
