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
| `physics.js`, `halldoor3.js`, `timebtn.js`, `slots.js`, `meterfloor.js` | the rest of the game, so a tutorial change that breaks it is caught |
