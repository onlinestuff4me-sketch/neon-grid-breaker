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

## ~~1. The fire telegraph~~ — **shipped**

Built. Each enemy now owns its material set (the shared cache would have
tinted every enemy of a type at once) and `setTelegraph` ramps `emissive`
along a black → ember → amber curve, weighted per body group: chest 1.0,
pelvis 0.95, limbs 0.7, **head 0.25** so the silhouette survives the glow.
It ramps over the aim window, holds at full while a stagger delays the shot,
cools over 0.3 s, and is killed outright on death — an interrupted telegraph
has to read as interrupted.

The weights are why `docs/BLENDER.md` insists on four named material slots:
a single-material mesh can only glow uniformly, which is the blob we avoided.

## ~~2. The archive screen~~ — **shipped**

Built. **35 slots** across three sections — enemies, protocols, weapons —
every one visible from the first run. A locked row keeps its designation and
hides its name behind a bar as wide as the real name, so you can always see
how much is left without being told what it is.

Three things the build had to get right that the plan didn't say:

- **Unlocking is meeting, and the menu is not a meeting.** The attract loop
  behind the title spawns and shatters enemies for show; filing those would
  have handed every new player the heavy before they pressed PLAY.
- **Leg 1 was never filed.** `recordMet` only ran on crossing a door, so the
  form you played through first was the one the archive never knew about.
- **Weapons went into the registry** with ids matching the `WEAPONS` keys, so
  a pickup files itself with no mapping table.

The death screen now reports `+N FILED TO THE ARCHIVE` when a life turned
something up, which is the only place the archive advertises itself — and
dying with a find is exactly when you go and look.

## ~~3. Per-part shatter, and where you hit~~ — **shipped**

Built. Four zones; the one you hit throws more pieces, faster, and the rest
follow outward a beat at a time. Head pays **1.6×** the time bank, legs
**0.7×** — seconds rather than points, so precision plugs into the scarcity
loop instead of sitting outside it. A knife jab is always a body hit.

The part the plan missed: removing the mesh on the frame of the kill left
any zone whose shards were still held as neither mesh nor debris. In bullet
time that gap is three real seconds of a body with no legs. The body now
stays in the scene and is hidden zone by zone on the same clock, which is
also what makes a headshot read as a head coming off with the torso still
standing. See `docs/TUNNEL_META.md`.

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
