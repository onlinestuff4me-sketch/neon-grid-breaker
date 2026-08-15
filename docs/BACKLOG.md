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

## 0b. The look jump — two causes fixed, one smoothed

There were **three** causes, overlapping, which is why each fix helped
without curing it. Kept at the top because fluidity of look and
movement outranks everything else here.

### Cause 1 — the time button ate the first 26 px (fixed)

The freeze button is 146 px in the bottom-right corner: **half of where a
right thumb re-plants to aim after tapping it**. A pointer landing there
applied no look at all until the thumb had travelled 26 px, then replayed the
whole distance in one `applyLook`. So the exact gesture the player makes
constantly — freeze, lift, re-plant, aim — had a guaranteed dead zone.

The 26 px threshold still does its real job, deciding whether the gesture was
a button press or a look, but it no longer decides whether the camera moves.
The pointer is a look pointer from the first pixel, and if the gesture turns
out to be a press its rotation is **handed back** on release, so a tap costs
your aim nothing. No dead zone on a drag, no nudge on a tap.

### Cause 2 — the aim assist fired the instant you re-planted (fixed)

The one that only happens **with enemies on screen**, which is the clue that
found it. There is a soft aim assist: after a stretch of free aiming it eases
the crosshair onto the nearest target inside a 0.3 rad cone. It is gated on
`input.lookIdle > 2.5 s`.

`lookIdle` was wall clock. It kept counting while your thumb was **off the
glass**, so any pause longer than 2.5 s armed the assist to fire on the very
frame you touched down again — and freeze, lift, read the frozen scene,
re-plant is a pause of exactly that shape. The camera then eased toward a
target on its own until your first drag sample reset the timer. No target in
the cone, no drift: hence blank wall fine, enemies not.

Measured across twenty-one runs of the flow — sixteen frozen, five in normal
time. Before the fix: **12 of 16 frozen runs drifted 1.1–6.5 degrees with no
input at all**, and **4 of 5 normal-time runs drifted 7.6–8.9 degrees**. The
clean ones were enemies outside the cone, an empty corridor, and pauses
shorter than the delay — exactly the cases that felt fine in play. After: 0
in all twenty-one.

The fix is that `lookIdle` now measures what its name and its comment always
claimed — **seconds of continuous holding without a manual correction** — so
it resets when the thumb leaves. The assist itself is untouched and still
engages after 2.5 s of holding still (verified: 15.5 degrees onto a target
2.2 m off the crosshair at 9 m).

**Decided:** the assist runs in **normal time and slow motion**, which is
what the code always did — two comments claimed slow-motion only and were
simply wrong. The playtester felt the drift in both modes, which settled it;
the comments are now corrected to match.

That decision matters because the bug was worse in normal time, not better:
re-running the same flow unfrozen, before the fix, gave **7.6–8.9 degrees** of
unasked drift against 1.1–6.5 in slow motion. Both are now 0, and the assist
is verified to still engage in both modes after 2.5 s of holding still.

### Cause 3 — input starves for ~350 ms after a fresh touch (smoothed only)

Measured frame by frame off a 60 fps screen recording of the real device:

- The renderer **never stalls**. Not one duplicate frame; the max pixel delta
  between consecutive frames stays at 78–253 right through the "freeze".
- The camera sits at **exactly zero for 20–27 frames** (350–450 ms), then
  applies about **15 px of thumb travel in a single frame** — a 7.6 degree
  snap — and then tracks smoothly at roughly 1 px per frame.
- A thumb moving at 1 px/frame does not do 15 px in one frame and then go
  back to 1 px/frame. That is buffered input being released, not motion.
- It is **not** the 26 px time-button slip threshold. Calibrated against
  known rotations with the scene frozen, 26 px of travel would produce a
  149 px image shift; the recorded jumps are 71 and 75 px, which land on the
  13 px calibration point.
- It is **not** a shader-compile stall. That was a real bug and is fixed, but
  it would have shown as duplicate frames, and there are none.

So the first ~350 ms of `pointermove` after a fresh touch are not reaching
the page. Our own code applies look from the first pixel (`ROLE_PX = 2`), so
the buffering is upstream. What could not be tested from here: iOS gesture
arbitration on a touch that lands near the bottom edge — which is exactly
where a right thumb re-plants after tapping the time button — or a stale
cached build on the device.

**What shipped for cause 3:** an oversized single sample is now paid out across
at least three frames rather than applied at once, so a starved burst reads
as a fast pan instead of a cut. The common path is untouched — coalesced
events mean genuine fast motion arrives as many small samples, so only a real
gap in the event stream can produce one oversized delta. `__ts.lookStats()`
counts them, so the next look at this starts from a number.

**If it still reads wrong**, the next real step is the native build: inside
the app the touch pipeline is ours, and `UIGestureRecognizer` delays can be
disabled outright.

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
| **Blackout** | condition | Emergency lighting. **Do not use ~8 m** — see below. Freezing time becomes a torch as well as a shield. Design settled, build outstanding. |
| **Breach walls** | measure | Marked panels enemies come *through* mid-leg, using the shatter language we already have on architecture. Turns a cleared corridor live again. |
| **Grinder** | measure | Your idea. A slab that seals the leg behind you and advances — and **does not stop while time is frozen**, because it is the building, not a person. The first element that attacks the slow-mo mechanic itself. |
| Gallery / stairwell / spiral | forms | New skeletons. Stairwell needs vertical movement, which is the only one here that touches the physics. |
| Turret drop, flood, dead air | mixed | Later. Flood and dead air both need systems that do not exist yet. |

### FOG was a lie, and is now fixed

`fog` shipped as `impl: true` and was never implemented — the leg condition
was read once and only ever compared against `dimStrips`, so a fog leg
rendered as a plain corridor while the archive told the player "Visibility
twelve metres". Now a real per-leg visibility override, eased on a time
constant, applied on leg 1 / on crossing / on retry, and guarded so the far
plane can never fall below `LEG.spawnMin + margin`. See `docs/BALANCE.md`.

That mechanism is what blackout needs, so blackout is now mostly a lighting
job rather than a from-scratch build.

### Blackout: the number to avoid, worked out before building

**~8 m visibility is unplayable, arithmetically.** `LEG.spawnMin` is 9 m and
`spawnMax` 40 m, so an 8 m far plane puts the *entire* spawn range outside
visibility — every enemy is born invisible.

Edge arrows do not rescue it. `EDGE_ARROW_MIN` is 0.34 rad ≈ 19.5° of
bearing, and arrows only appear *beyond* that. The 80° vertical FOV at
402×874 is ~42° horizontal, so the screen half-width is ~21°: the arrow
threshold sits just inside the screen edge, by design, so arrows mark
genuinely off-screen threats. An enemy dead ahead at 12 m in an 8 m blackout
therefore gets **no arrow and no pixels** — and dead ahead is the common case,
because the corridor runs forward. Arrows solve flanks, not the axis the game
is built along.

So blackout should be about **light**, not distance — cut the strips hard,
keep the far plane above the derived floor, and deliver "the freeze is a
torch" by having the freeze *extend* visibility rather than by making the
baseline lethal. Avoid `#ff2d1a` for emergency strips: red means threat in
this game, and a corridor lit in the signal colour destroys enemy-reading at
exactly the moment it is hardest.

## 5. Higher-fidelity characters — **engine side done; needs your asset**

The engine work is finished and tested. `lib/GLTFLoader.js`,
`lib/SkeletonUtils.js` and `lib/BufferGeometryUtils.js` are vendored from
three r170 with only their import specifiers rewritten, and `src/characters.js`
loads, clones per enemy, maps the four named material slots, and drives named
clips with crossfades.

It is **completely inert without the asset** — the change is purely additive,
`src/main.js` and `index.html` are untouched, and the running game fetches
none of it. Verified against a hand-authored fixture that the Khronos glTF
validator passes clean, plus a second fixture using the mangled names Blender
actually exports (`MAT_CHEST.001`), which the loader now tolerates.

What is left is wiring it into enemy rendering, and that needs the real model
to judge. Two risks to check the moment the file lands: **Draco or KTX2
compression** would need a decoder vendored separately, and clip names must
match `walk` / `aim` / `idle` / `fire` / `lunge` / `hit`.

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
