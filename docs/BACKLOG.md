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

## 1. The fire telegraph — **built, then removed**

Shipped in `5b5b2f6` and reverted the same day after playtest. It read as
**confusing rather than informative**: the game already telegraphs a shot
twice — the enemy raises his gun arm, and the muzzle flashes white just
before firing — and a third signal on the body competed with those instead
of reinforcing them.

Do not rebuild it as-is. The premise it was built on (that a gun-tip flash
is only a few pixels at a 42-degree horizontal field, so the warning needs to
be body-scale) was not wrong about the geometry, but the arm-raise is already
body-scale and already reads. If this is revisited, the question to answer
first is whether the arm-raise is legible **in peripheral vision**, and if
not, the fix is probably to exaggerate the arm-raise rather than to add a
second channel.

The code is recoverable from `5b5b2f6` if it is ever wanted.

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

## 3. Per-part shatter — **built, then removed; needs its own workstream**

Shipped in `4653f43` and reverted the same day. Two independent problems:

1. **It looked bad.** Four zones breaking in sequence, with the body hidden a
   zone at a time to match, produced a body that came apart in visible
   chunks-of-schedule rather than shattering. The still frames read well,
   which is exactly why stills were the wrong verification.
2. **Headshots did not register**, in the sense that mattered: the bonus was
   paid into the slow-mo bank, and the bank caps at 10 s while a kill already
   refunds 2 s. Land a headshot with a nearly-full bank — which is most of
   the early game — and it pays nothing, flashes nothing, and says nothing.
   The reward was real in the model and invisible in the hand.

**What a real workstream has to settle before any code:**

- Where the reward lands so it is always felt. A bank that is usually full
  cannot carry it. Options: overfill the cap briefly, pay a separate
  resource, or make the payoff non-numeric (a longer freeze on the kill).
- What "coming apart" should look like frame by frame at 60 fps and at the
  0.05x freeze scale — the two are very different problems, and the freeze is
  where the effect is actually looked at.
- Whether the body should be hidden at all, or replaced by per-part rigid
  bodies that fall. That is a bigger build and probably the right one, and it
  wants the glTF characters to land first so the parts already exist.

The code is recoverable from `4653f43`.

## 4. Protocol elements, cheapest first

Nine left. They are designed, registered and gated but not built; `impl:
false` keeps the composer from picking them, so each ships by flipping a flag
once the geometry exists.

| Element | Kind | Why it's worth building |
|---|---|---|
| ~~One-way seal~~ | measure | **Shipped.** A bulkhead halfway to the door that comes up behind you. Placed only where the row it spans — and the row before it — hold a single cell, so no branch lane can walk around the thing that just shut; about a quarter of corridors offer no such spot past the halfway mark and simply get no seal, which is better than one that shuts eight metres in. Anyone still on the far side is **redeployed**, not trapped and not shattered: pulled out and pushed to the front of the spawn queue with their release refunded. Trapping would soft-lock the door, which waits on an empty floor, and killing them would pay you kills and time bank for walking forward. |
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
