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

* `seal.js` — "the slab rose out of floor" waits on **the slab**, not on a clock.
  It was `setTimeout(900)` — wall clock against an animation that runs on the
  world clock — so under suite load those 900 ms delivered fewer frames, the
  bulkhead was caught mid-rise at y 1.18 against a 1.3 bar, and a correct build
  reported a seal that never closed. It now runs until the height stops climbing.
* `seal.js` — its placement claim ("builds on most legs") is **sequential**, not a
  fixed sample: leg generation is random, and a fixed 16 draws against a ≥10 bar
  failed on an unlucky 9/16 while the same build drew 12 and 14 on reruns. It now
  keeps drawing until ten builds prove the claim or a 28-attempt cap proves it
  broken — a working build exits early, a broken one cannot reach ten.
* `seal.js` — "it shut when crossed", "nobody was left trapped", "their release
  was refunded"
* `physics.js` — "bullet → player" did not kill
* `meterfloor.js` (since deleted with the lesson it tested) — watched a 28 s
  window for a drain that settles at ~24.5 s
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
| `slowlesson.js` | the slow-time course, played beat by beat — the button-released freeze, the meter demo that cannot wedge, and the per-area reminders |
| `schoolflow.js` | the numbers: each tread of the speed staircase holds for the doors it claims, the unlock door is where it reaches 12 m/s, the button is not on screen a door earlier, volleys build, and the mercy rule is hysteretic |
| `saves.js` | the save list end to end: a first launch has one action and no list; depth makes the button say CONTINUE and name the door; **continuing actually starts on that door** (it never used to — see docs/SAVES.md); LOAD GAME opens the list and starts nothing; NEW GAME on that page is a separate save at door 1 that leaves the old one alone; the list is newest-first with its date labelled; the info panel carries a unique identifier and a creation date distinct from last-played; delete asks in the row, KEEP keeps, confirm removes; and deleting the last save leaves a menu that still starts a run. §7 is **per-mode**: selecting a game starts nothing, marks itself, is remembered, changes the tagline, and offers PLAY rather than a tunnel save to continue — then the run it starts makes a save tagged with that mode, the list behind LOAD GAME is titled with the game and holds only its runs, and switching back finds the tunnel's list unchanged. §8 is **rename**: NAME is the only editable field on the details panel, it starts on the default, the new name reaches the list, the disk and CONTINUE, the identifier and both timestamps are unmoved by it, and clearing the field restores the default rather than storing an empty name — timestamps checked **to the millisecond on disk**, since the panel prints only to the minute, and neither this save's default nor a sibling's sticks as a name. §10 **relaunches the page** — the only reload in the file — so "the chosen game is remembered" is not read back from the key that just wrote it, and the menu's first paint (which `showMenu` never draws) is looked at. §11 taps a **row's** CONTINUE and lands on that save's door. §12 is the death screen: no LOAD GAME, no selector, and a retry button in this game's words. §13 is a **Rush Hour** save — a game that archives nothing and crosses no doors — surviving a trip through another game, listed in its own words, with no other game's board under it. §14 is Settings/MODES **choosing** a game instead of launching one. §9 is the **archive teaser** that replaced the leaderboard: real kills reach the lifetime counter, the four rows are the archive's sections in the same order, every row lights exactly its own numerator, the SEE ALL link is their sum, tapping the block opens the Archive whose meta line and sections agree, and another game's teaser is its own. §16 is the teaser being **per save**: the menu's NEW RUN pill asks about the lesson, the new save's teaser starts from zero, and the old save keeps its counter and archive on disk. §15 is the mode picker: the button names the current game, the list behind it holds every game **with its one-line description**, CLOSE changes nothing, picking one closes the list and renames the button while the title keeps its own single line, the list/rows/CLOSE share one column, and it cannot be opened over a live run |
| `trigger.js` | the REAL weapon — every round a genuine pointer gesture, never `__ts.fire`. A tap kills; a 112 px drag does not; a 700 ms press does not; a tap on the time button stops time and fires nothing |
| `schoolbody.js` | the school as behaviour rather than arithmetic: the composed corridor's body budget, the unlock as a functional gate, and the mercy rule counted in rounds actually in the air — full bank 5 up at once, dry 2, the same six rounds taking 13.2 s of world time instead of 4.7 |
| `crossparity.js` | that `__ts.crossDoor()` really is a door crossing (checked against one walked on foot), and that the slow course arms on the unlock door and neither neighbour |
| `mutdemo.js` | (its aim is re-established immediately before the shot: the gunner is placed in `advance` and then left alone across two Playwright round trips, which are **wall clock**, so under load he drifted out of the crosshair and the *healthy* case went red on a build with nothing wrong with it) | drives the game into the state each important assertion's mutation would produce and requires that assertion to go RED, and the weak version of it to stay green. The suite's own smoke alarm |
| `modes.js` | the two one-thumb modes share the opening ramp and must NOT get the school, its volley gap, its body floor, its coach, the button or the meter — with the tunnel at the same door as a control |
| `shotrhythm.js` | what the rounds actually DO, measured in world seconds off `lastEnemyShotAt`: door 8 is a metronome with no double-taps, and a school door repeats spread-spread-quiet. Every other test asks what the code *says* the gap is — for a long time those were different things |
| `schoolentry.js` | the door: standing on the last leg before the unlock, opening it and stepping through has to produce the lesson's own corridor, its barrier, `STAND HERE`, and the button taken away until `slowIntro` hands it over |
| `ramppane.js` | the tool's RAMP pane: every dial has a slider, the table matches the code out to door 96, moving a dial recomputes it, and the export carries the speed and school blocks |
| `newflow.js` | the opening as it is now: no slow-motion control anywhere in it, the round dodged by MOVING, the gun and the squad together, and a magazine that never runs down |
| `backdrop.js` | the shop window behind the title: a corridor game is shown from **inside** a corridor (camera at eye height on the spine, not the radius-12 orbit that renders the walls' backs), the attract fight follows the **selected** mode rather than the last one played — Rush Hour keeps its crowd, the city drops it — every mode starts a live run from that menu in exactly **one** leg, and a second tunnel run does not stack a second corridor (legs were never torn down when a run ended) |
| `playtest.js` | six things a playtest found: no door announces `LIGHTS AT HALF` (a condition whose effect — every fourth ceiling panel instead of every second — nobody could see); a door's banner and the HUD show the **same** number at the same instant (they were one apart); lesson 5's rounds come about a second apart in **world time** rather than 3.2s; the announcer is silent during the onboarding but not outside it; a round closing on a still player in a training room brings the dodge prompt back, released by stepping aside and firing **once per room**; and its swipe is on the MOVE half of the screen with the divider drawn |
| `handover.js` | one banner at the end, door 1 with somebody in it, and the opening ramp against the table in balance.js. Its hold-fire beat is measured in **world seconds**, not frames: door 4 releases its second body twelve world seconds after the first, which was 253 frames on the box it was measured on, so a 90-frame hold made `lets them meet you together` pass or fail on machine load rather than on the game |
| `ramp.js` | the TRAINING line at the top of the screen, and the pause button surviving a retry |
| `shatter.js` | the shooting lesson driven with the REAL weapon: three shatters, the barrier down, the door open |
| `corner.js` | the barrier is up from frame one and its sign is on from the last corner |
| `tutool.js` | (its cue linter knows that a step granting `rescue` can fire `held` and `dodge` — those used to belong to hardFreeze beats alone, which made them dead events on a `crossed` step until the training rooms started adopting a round) |
| `tutool.js` | the tutorial pane: a clean spec warns about nothing, a duplicate id is named, the revert leaves the map on the live object, and a new leg is editable |
| `physics.js`, `halldoor3.js`, `timebtn.js`, `slots.js` | the rest of the game, so a tutorial change that breaks it is caught |

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

## ...and the RUNNER could not fail either

The worst instance of the above was not a test. `runall.sh` decided pass/fail
by grepping stdout for the word `FAIL`, which is a hope rather than a
criterion, and it was wrong in five ways at once:

* a file that **crashed** printed a stack trace, no `FAIL` line, and was
  reported `ok`. `timebtn.js` had been doing exactly that since the time button
  moved behind the unlock door — `boundingBox()` on a `display:none` element
  returns null — executing **zero** assertions for weeks while counted green;
A grader can also be wrong in the *other* direction, and this one was: the
pattern for "an assertion printed `PASS ... : false`" used `[^:]*` to stop at
the assertion's own colon, and `[^:]*` runs happily across `| {"asking"` —
which contains no colon — so a **passing** assertion whose payload is an
object with a false field was graded as a failure. The assertion's own colon
has whitespace before it and a JSON one has a quote, so the character before
the colon is what tells them apart; and the boolean is the whole word, not the
head of `false,`.

* so was a file killed by the **timeout** (600s per file — `handover.js` walks the whole onboarding and then five doors at their real pace, about five minutes on an idle box);
* so was an **empty** file. `modes.js` was zero bytes and sat in the list;
* four files printed `console.log('   PASS name :', cond)`, where PASS is a
  **literal**. A red assertion read `PASS the slab rose : false`, and the
  runner was grepping for `FAIL`. Forty assertions across `tool.js`,
  `seal.js`, `slots.js` and `timebtn.js` could not fail the suite whatever they
  measured;
* and five files print `ERRORS:` in capitals while the runner matched
  `^errors:`, so their `pageerror` wiring was decorative.

It reported "1 file with failures". The true number was ten.

It now requires **positive evidence of success**: exit code 0, an errors line
in either spelling, at least one assertion line, no `FAIL`, and no
`PASS <name> : false`. The `[^:]*` in that last pattern earns its place —
`.*: *false` also matches a payload like `{"grantsFire":false}` on a green
line, which turned two passing files red the first time it ran.

**If you add a test:** print `PASS`/`FAIL` per assertion, print an errors line,
exit non-zero on failure. A file that cannot report a red is not a test.

## Nothing in the suite had ever pulled the trigger

`walk.js` clears a floor with `__ts.killAt(0)`, which calls `killEnemy`
directly. So did every other test that needed a room emptied. Which meant the
whole suite could be green while the player's own weapon was broken inside the
lesson that teaches shooting — and it was, by a one-line variable-name
collision, for as long as the cue system had existed.

If a lesson teaches an input, a test has to make that input the way a player
does. `shatter.js` fires the weapon; `newflow.js` steps the player out of a
frozen round's lane, which is the only thing that releases it.

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
