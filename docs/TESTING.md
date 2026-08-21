# Testing — the harness and the traps in it

Playwright over a static server, driving the real game in a real browser.
There is no unit layer: almost everything worth checking here is emergent —
"does the door open", "is he inside the wall", "did the prompt leave while the
player was still reading it" — and none of that survives being mocked.

```
python3 -m http.server 8321          # from the repo root
node test/<name>.js                  # playwright-core, chromium at /opt/pw-browsers
```

Launch options that matter: `--no-sandbox`, viewport **402×874**, `hasTouch`,
`isMobile`. Always attach `page.on('pageerror')` and print what it caught — a
silent exception in the frame loop looks exactly like a feature not working.

Any test that does not want the onboarding must set it aside before the page
scripts run:

```js
await c.addInitScript(() => { localStorage.setItem('timeshard_taught', '1') });
```

A fresh profile is a first run, and a first run teaches itself.

---

## The trap that has cost the most: wall clock is not game clock

`game.stateT`, every step of the onboarding, and every AI state machine advance
on `dt` — and the frame loop **clamps `dt` at 0.05 s**:

```js
const dt = Math.min((now - lastT) / 1000, 0.05);
```

Under headless SwiftShader the game runs well below 20 fps, so *game time runs
slower than wall-clock time*. At 10 fps, two real seconds are one game second.

Every `await page.waitForTimeout(n)` used as "by now the game will have…" is
therefore a race that fails on a loaded machine and passes on an idle one.
**Three separate tests** had this bug and all three failed the same way — the
run was still in `intro`, where `closeSeal` is gated off and a fired round hits
a player who has not started yet:

* `seal.js` — "it shut when crossed", "nobody was left trapped", "their release
  was refunded"
* `physics.js` — "bullet → player" did not kill
* `meterfloor.js` — watched a 28 s window for a drain that settles at ~24.5 s
  and called the descent a failure

**Wait for the state, never for a clock:**

```js
await page.evaluate(async () => {
  const t = window.__ts;
  for (let i = 0; i < 900 && t.game.state !== 'play'; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
});
```

The same applies to any threshold: wait for the bank to reach the floor, not
for the number of seconds you think it takes.

## The trap that hid a whole feature

`seal.js` verified "the player cannot walk back through it" by pushing
`input.stickY = -1`. The movement code is

```js
const dirZ = -sinY * sx + -cosY * -sy;   // right*stickX + fwd*(-stickY)
```

so `stickY = -1` is **forward**. The check walked the player twenty metres
further *in* and then congratulated itself that they had not gone back. It had
passed on every run since it was written, and the one-way property had never
actually been under test. (It holds: pushing `+1` for 240 frames, the player
gets from z 55.2 to 54.52 against a seal at 54.00 and no further.)

The lesson is not "check your signs". It is that **a test which can only pass
is not a test** — if you cannot describe the run in which it fails, it is not
measuring anything.

## Round-trip time is the budget

A `page.evaluate` costs ~100–150 ms. That is longer than the flight of a
tutorial bullet, so anything asking "what was on screen at the time" has to be
asked from *inside* one evaluate, sampling every `requestAnimationFrame`:

```js
const out = await page.evaluate(async () => {
  const t = window.__ts, log = [];
  for (let i = 0; i < 900; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    log.push(/* whatever changes fast */);
  }
  return log;
});
```

Polling from Node produced three consecutive "the arm never went up" failures
against a build whose arm demonstrably went up.

Keep a single `node` run under about four minutes; split into several files
rather than one long one. Walking the tutorial's 148 m teaching leg at
`MOVE_SPEED` takes minutes of wall clock in headless — when what is under test
is the *lesson gates* rather than the physics of a footstep, step the player
along `hall().legs[cur].spine` directly.

## Absolute frame times mean nothing here

SwiftShader is a software rasteriser. A millisecond count from it says nothing
about a phone. Only **A/B within one page load** is trustworthy: measure the
thing with the feature on, then off, in the same tab, and compare.

## Screenshots are evidence, not decoration

Several bugs were invisible to every assertion and obvious in a picture: a
prompt rendering as one line off both edges of the screen, an enemy standing
in a wall, `DOOR 1 · OPEN — GO` printed over `DRAG TO MOVE`. Take them at
402×874 and actually look at them.

Note that the page keeps running between an `await` and the screenshot that
follows it, so a picture taken after a chain of reads can be of a much later
moment. Set `game.paused = true` first when the frame matters.

## `window.__ts`

The debug surface. Not shipped behind a flag — it is a few closures over
existing state and costs nothing — but nothing in `src/` may depend on it.

| call | gives |
|---|---|
| `tutor()` | the onboarding's whole state: step, dodged, meterOn, held, legIx, spineIx, barrierZ, deadPending |
| `tutorSpec()` | the live spec the run is using, including the tool's override |
| `tutorGrants()` / `tutorCues()` | what the current step allows; which cues are live |
| `setTutorStep(id)` | jump to a beat **and build its furniture** — setting the variable by hand skipped that and left the beat with nobody in the corridor |
| `bodies()` | every enemy's x, z, state, arm angle |
| `hall()` | legs, `cur`, `doorsPassed`; a leg carries `cells`, `spine`, `door`, `seal` |
| `slow()` | bank, cap, locked |
| `killAt(i)`, `spawnEnemy(t)`, `shot(...)`, `fire()` | make things happen |
| `restartHall()`, `forceMeasures([])`, `forceCondition()` | put the world in a specific state |

## What the suite covers

| file | what it is for |
|---|---|
| `walk.js` | the onboarding driven end to end against `docs/TUTORIAL-GOALS.md` |
| `tut3/4/5.js` | the hallway and prompts, the dodge beat with its death and retry, the telegraph and the round |
| `dodge.js` | trigger discipline: nobody telegraphs unbidden, and the scripted round is byte-identical to an ordinary one |
| `tutiso.js` | isolation — after a **failed** lesson, an ordinary run carries none of it |
| `mapround.js` / `toolround.js` | the tool's edits reaching the running game, and the override never reaching an ordinary run |
| `seal.js` | the one-way bulkhead, including that it actually blocks |
| `fixbatch.js` | the wedges: the meter beat's early tap, the long press on the freeze, the retry's clock, the barrier after END RUN, six bodies in six places |
| `signwalk.js` / `four.js` | STAND HERE as an object — hidden round the corners, and width × distance constant down the straight |
| `pastbar.js` | the men past the barrier stand where they are put, and a death rebuilds the fight behind a shut door |
| `coachcue.js` | the words and the arrow that name the time button, sampled on the frame the world stops |
| `tips.js` | the per-area reminder rules: the first room nags, the rest are spent by the action they asked for, and the trigger prompt waits for both halves of the clock |
| `handover.js` | one banner at the end, door 1 with somebody in it, and the 1/1/2/2 opening ramp |
| `ramp.js` | the training rooms: the reminder loop, the half-price drain, the TRAINING line, and the pause button surviving a retry |
| `shatter.js` | the shooting lesson driven with the REAL weapon: three shatters, the barrier down, the door open |
| `beat.js` | the dodge beat — fires, freezes on the round, tap, readable flight, sideways coach, and the loop repeating for all three |
| `corner.js` | the barrier is up from frame one and its sign is on from the last corner |
| `tutool.js` | the tutorial pane: a clean spec warns about nothing, a duplicate id is named, the revert leaves the map on the live object, and a new leg is editable |
| `physics.js`, `halldoor3.js`, `timebtn.js`, `slots.js`, `meterfloor.js` | the rest of the game, so a tutorial change that breaks it is caught |

## A test that cannot fail is worse than no test

Six files in this suite were passing into nothing, and the audit that found
them is the reason `__ts.setTutorStep` now warns. Four of them asked for a step
called `aim` or `incoming` — names deleted two rewrites ago — got a silent
no-op, and went on to assert things about a run that had never moved. Two more
read `#tutormsg` and `#tutortop`, single elements that became six cue slots.
`toolround.js`, the round-trip test for the tool, had been crashing on its own
first step since that change, and asserted 2 legs and 8 steps against a spec
with 7 and 18.

Every debug hook a harness steers with should be **loud when it cannot do what
it was asked**. `setTutorStep` returns false and names the ids there are;
`timeTap()` exists so a beat waiting on the time button can be answered without
a pointer.

And repairing a stale test can find a real bug. `seal.js` asserted
`sealShut === true` from a loop that stopped on the frame the door unlocked —
metres short of the seal, on a leg that might not have been given one. Walked
past the seal, the property it was written to check holds. It had never once
been checked.

## Nothing in the suite had ever pulled the trigger

`walk.js` clears a floor with `__ts.killAt(0)`, which calls `killEnemy`
directly. So did every other test that needed a room emptied. Which meant the
whole suite could be green while the player's own weapon was broken inside the
lesson that teaches shooting — and it was, by a one-line variable-name
collision, for as long as the cue system had existed.

If a lesson teaches an input, a test has to make that input the way a player
does. `shatter.js` fires the weapon; `beat.js` presses the time button;
`coachcue.js` reads what is on the glass on the frame the world stops.

Related trap, an hour of it: `playerFire` aims with
`camera.getWorldDirection`, and the camera takes its yaw from the player in the
frame loop. Set `player.yaw` and fire on the same tick and the round goes
wherever you were looking *before* the turn — which looks exactly like one
particular enemy being unkillable. Let a frame pass after a scripted turn.

## Rates are per FRAME, never per wall-clock second

Measuring the tutorial's half-price meter drain took three goes, and the first
two both looked like a bug in the game:

* **amount spent in a fixed window** empties the tank in the ordinary run,
  which unlocks the clock and stops the drain — so the ordinary rate reads
  lower than it is, and the ratio comes out around 0.6.
* **wall-clock seconds are not the game's seconds.** The frame loop clamps
  `dt` at 0.05 and headless runs below 20 fps, at *different* frame rates in
  the two halves being compared — so the clamp throws away a different
  fraction of each. The ratio wandered between 0.53 and 0.63 for a multiplier
  that is exactly 0.5 in the source.

Below 20 fps every frame contributes exactly 0.05 s of game time, so **drain
per frame is the rate, exactly**. Measured that way: 0.500×, run after run.

## The dodge simulator that never worked

`walk.js` section 6 spent two rewrites trying to sidestep a round: 1.3 m did
not clear one travelling at 8.8 m/s, so the harness died on the second shot;
2.1 m put it inside the wall, where the next gunner in the rotation never got a
shot away. Both failures cascaded into every assertion after them, and both
looked exactly like a broken tutorial.

What that section tests is the **script** — one round at a time, then the squad,
then the meter — not whether a machine can dodge. So the player stands still
and is immortal, and the rounds go past. Decide what a test is for, and do not
let the part that is only scaffolding be the part that fails.
