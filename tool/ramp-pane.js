// ---------------------------------------------------------------------------
// THE RAMP PANE — the opening curve, visible and adjustable
//
// Four dials decide what the first thirty doors feel like, and until this pane
// existed the only way to know what they added up to was to play thirty doors.
// It reads `OPENING` and `RAMP` out of src/balance.js — the same module the
// game imports, so what the table says is what the game does — recomputes the
// whole curve on every change, and writes the result into the tool's balance
// override so the preview and the export carry it.
//
// The point of the shape: HOLD A VALUE, STEP UP BY ONE, THEN HOLD THE NEXT ONE
// FOR LONGER. The bands widen, so each new number gets more room than the one
// before it. That is the opposite of a curve that compounds, and it is why the
// old rule had a cliff — one body at door 4, twenty-four at door 5.
// ---------------------------------------------------------------------------
import { OPENING, RAMP, SPEED, SCHOOL, ramp } from '../src/balance.js';

const $ = (id) => document.getElementById(id);
const DOORS = 96;   // far enough to show the unlock and the school

// The live values. Seeded from balance.js, edited here, handed back by read().
let V = null;
let onChange = () => {};

function seed() {
  V = {
    legsEvery: OPENING.legsEvery,
    bodiesEvery: OPENING.bodiesEvery,
    aliveEvery: OPENING.aliveEvery,
    legsCap: OPENING.legsCap,
    corridorDoors: OPENING.corridorDoors,
    gapDoors: OPENING.gapDoors,
    holdSlack: OPENING.holdSlack,
    gapFrom: OPENING.gapFrom,
    gapTo: OPENING.gapTo,
    gapBy: OPENING.gapBy,
    rampWaves: RAMP.rampWaves,
    // the speed staircase
    openM: SPEED.openM, openDoors: SPEED.openDoors,
    holdM: SPEED.holdM, holdDoors: SPEED.holdDoors,
    stepM: SPEED.stepM, stepDoors: SPEED.stepDoors,
    unlockM: SPEED.unlockM, schoolDoors: SPEED.schoolDoors, capM: SPEED.capM,
    // the school
    volley: SCHOOL.volley, volleyBuild: SCHOOL.volleyBuild,
    volleyGap: SCHOOL.volleyGap, volleySpread: SCHOOL.volleySpread, clusterM: SCHOOL.clusterM, spare: SCHOOL.spare,
    drainMul: SCHOOL.drainMul, bonusMul: SCHOOL.bonusMul, calmGap: SCHOOL.calmGap,
  };
}

// THE DOOR THE POWER LANDS ON IS NOT A DIAL. It is wherever the staircase
// first reaches `unlockM` — the same solve balance.js does, so the pane and
// the game can never disagree about it.
export function unlockDoorOf(v = V) {
  const first = v.openDoors + v.holdDoors + 1;
  const treads = Math.max(1, Math.ceil((v.unlockM - v.holdM) / v.stepM));
  return first + (treads - 1) * v.stepDoors;
}
export function speedOf(d, v = V) {
  const first = v.openDoors + v.holdDoors + 1;
  const gate = unlockDoorOf(v);
  if (d <= v.openDoors) return v.openM;
  if (d < first) return v.holdM;
  if (d < gate) return v.holdM + v.stepM * (Math.floor((d - first) / v.stepDoors) + 1);
  if (d < gate + v.schoolDoors) return v.unlockM;
  const n = Math.floor((d - gate - v.schoolDoors) / v.stepDoors) + 1;
  return Math.min(v.capM, v.unlockM + v.stepM * n);
}
// A volley on school door `d`, and the body floor that goes with it.
export function volleyOf(d, v = V) {
  const k = d - unlockDoorOf(v);
  if (k < 0 || k >= v.schoolDoors) return 0;
  const t = Math.min(1, k / Math.max(1, v.volleyBuild));
  return Math.max(2, Math.round(2 + (v.volley - 2) * t));
}

// --- the curve, computed exactly the way main.js computes it ---------------
export function doorRow(d, v = V) {
  const legs = Math.min(v.legsCap, ramp(d, v.legsEvery));
  const bodies = ramp(d, v.bodiesEvery);
  const alive = Math.min(bodies, ramp(d, v.aliveEvery));
  // a door's budget, split evenly across its legs, remainder to the last of
  // them — so walking deeper into a door is walking into more of it
  const base = Math.floor(bodies / legs);
  const extra = bodies - base * legs;
  const split = Array.from({ length: legs }, (_, i) => base + (i >= legs - extra ? 1 : 0));
  const t = Math.max(0, Math.min(1, (d - v.gapDoors) / Math.max(1, v.gapBy - v.gapDoors)));
  const volley = volleyOf(d, v);
  // The school overrides the ramp's own answers wherever it is in session.
  const gap = volley ? v.volleyGap : v.gapFrom + (v.gapTo - v.gapFrom) * t;
  const floor = volley ? volley + v.spare : 0;
  const split2 = split.map((n) => Math.max(n, floor));
  return { d, legs,
    bodies: volley ? split2.reduce((a, x) => a + x, 0) : bodies,
    alive: Math.max(alive, floor), split: split2, gap, volley,
    speed: speedOf(d, v),
    form: d <= v.corridorDoors ? 'corridor' : 'any',
    slow: d >= unlockDoorOf(v) };
}

// --- what each dial is FOR, in the pane rather than only in the docs -------
const DIALS = [
  ['legsEvery', 'Legs per door', 1, 10, 1,
    'How many corridors and rooms stand behind one door. Value 1 covers doors '
    + '1..N, value 2 the next N+1, value 3 the next N+2 — so "deeper" is a '
    + 'longer walk before the next door as well as a busier one. Only the LAST '
    + 'leg of a door counts as the door.'],
  ['bodiesEvery', 'Bodies per door', 1, 10, 1,
    'How many enemies the WHOLE door holds, across all its legs. This is the '
    + 'primary dial: the legs split its budget evenly, remainder to the last '
    + 'of them, so there is no separate per-leg number to fight with it.'],
  ['aliveEvery', 'Alive at once', 1, 10, 1,
    'How many may be on you at the same time. Moved on its own schedule so '
    + '"more enemies" and "harder fight" never arrive on the same door — door '
    + '3 is two men one at a time, door 4 is the first pair you meet together.'],
  ['legsCap', 'Legs ceiling', 1, 8, 1,
    'The most legs a single door will ever have. Past this the walk stops '
    + 'getting longer and only the fights keep growing.'],
  ['corridorDoors', 'Corridors only, until', 0, 12, 1,
    'No rooms, vaults or atria before this door. One shape to learn first: a '
    + 'vault is a second thing to read on a door whose job is the four beats — '
    + 'see him, watch the round leave, step out of it, shatter him.'],
  ['gapFrom', 'Shot gap · from', 0.2, 5, 0.1,
    'World seconds between one enemy firing and the next. Three seconds means '
    + 'every round is its own event rather than a room going off at once.'],
  ['gapDoors', 'Shot gap · held until', 1, 30, 1,
    'The gap stays at its opening value for this many doors before it starts '
    + 'closing.'],
  ['gapBy', 'Shot gap · closed by', 2, 60, 1,
    'The door at which the gap has reached its final value.'],
  ['gapTo', 'Shot gap · to', 0.1, 3, 0.02,
    'What it closes to — the reflex gap the deep game runs on.'],
  ['holdSlack', 'Shot gap · deadlock slack', 0.1, 3, 0.05,
    'How long past the gap a man will wait his turn before firing anyway. '
    + 'There has to be a ceiling or a crowd can hold each other into never '
    + 'firing — but it used to be a flat 0.6 s, which is SHORTER than the gap '
    + 'for every door up to about 20, so the gap never actually applied. '
    + 'Lower this to make the middle doors fire as loosely as they used to.'],
  // --- THE SPEED STAIRCASE -------------------------------------------------
  ['openM', 'Speed · opening tread', 3, 12, 0.1,
    'Enemy bullet speed in m/s for the first doors. At 5.4 a round crosses a '
    + '16 m room in three seconds: something you watch coming and walk out of, '
    + 'before anybody has been given a way to slow it down.'],
  ['openDoors', 'Speed · hold it for', 1, 20, 1,
    'How many doors stay on the opening tread. Wide treads are the whole point '
    + 'of a staircase: nobody acclimatises to a number that never sits still.'],
  ['holdM', 'Speed · second tread', 3, 14, 0.1,
    'The first step up, held just as long as the opening one — the smallest '
    + 'change the player is ever asked to notice.'],
  ['holdDoors', 'Speed · hold that for', 1, 20, 1,
    'Doors on the second tread before the staircase starts climbing.'],
  ['stepM', 'Speed · tread height', 0.05, 1, 0.05,
    'How much faster each tread is than the one below it.'],
  ['stepDoors', 'Speed · tread width', 1, 10, 1,
    'Doors per tread once it is climbing. THIS IS THE DIAL THAT MOVES THE '
    + 'UNLOCK: halve it and the power arrives twice as early.'],
  ['unlockM', 'Speed · power arrives at', 6, 20, 0.2,
    'The speed at which walking out of a round stops being enough — and so '
    + 'the moment slow time is worth having. The unlock DOOR is solved from '
    + 'this rather than typed, so it can never drift out of step with it.'],
  ['schoolDoors', 'School · doors', 0, 30, 1,
    'How long the staircase stops while slow time is taught. The speed holds '
    + 'flat here on purpose: one new thing at a time.'],
  ['rampWaves', 'Telegraph · full heat by', 4, 90, 1,
    'Doors until telegraphs and cooldowns reach their tightest. This is NOT '
    + 'bullet speed any more — the staircase above owns that — it is only how '
    + 'long an enemy takes to raise his arm.'],
  // --- THE SCHOOL ----------------------------------------------------------
  ['volley', 'School · volley size', 2, 8, 1,
    'How many fire together once the school is in session. A volley is the one '
    + 'shape a sidestep cannot answer, which is what makes the button wanted.'],
  ['volleyBuild', 'School · built over', 1, 20, 1,
    'Doors taken to grow from two firing together to the full volley.'],
  ['volleyGap', 'School · between volleys', 0.5, 6, 0.1,
    'World seconds of quiet between one volley and the next.'],
  ['volleySpread', 'School · inside a volley', 0.02, 1, 0.02,
    'World seconds between the rounds OF one volley. Not zero: the school '
    + 'starts a volley\u2019s telegraphs on the same frame, so with no floor '
    + 'they finished on the same frame too and three rounds left three muzzles '
    + 'simultaneously. A fifth of a second still reads as one volley, and reads '
    + 'as three men.'],
  ['clusterM', 'School · how close they stand', 2, 12, 0.5,
    'Metres. A volley spread down forty metres of corridor costs a full tank '
    + 'and returns one kill; a group you can sweep pays for itself.'],
  ['spare', 'School · bodies over a volley', 0, 4, 1,
    'How many more than a volley a room holds, so there is still somebody left '
    + 'to shoot once it has been answered.'],
  ['drainMul', 'School · slow time costs', 0.1, 1, 0.05,
    'Multiplier on the drain here. Cheap on purpose: this lesson is about what '
    + 'the power is FOR, not what it costs.'],
  ['bonusMul', 'School · kills pay', 1, 4, 0.25,
    'Multiplier on the seconds a kill returns, so sweeping a cluster refills '
    + 'what the sweep spent.'],
  ['calmGap', 'School · the mercy gap', 1, 6, 0.1,
    'When the bank runs dry the room drops back to one round at a time, at '
    + 'this gap — the opening doors\u2019 metronome — until the meter is worth '
    + 'spending again.'],
];

function renderDials() {
  const host = $('rampdials');
  if (!host) return;
  host.innerHTML = '';
  for (const [key, label, min, max, step, why] of DIALS) {
    const wrap = document.createElement('div');
    wrap.className = 'fld';
    wrap.style.gridTemplateColumns = '150px 1fr 52px';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.title = why;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min; inp.max = max; inp.step = step;
    inp.value = V[key];
    const out = document.createElement('span');
    out.className = 'num';
    out.textContent = V[key];
    inp.oninput = () => {
      V[key] = parseFloat(inp.value);
      out.textContent = V[key];
      renderTable();
      onChange(read());
    };
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = why;
    wrap.append(lab, inp, out);
    host.append(wrap, note);
  }
}

function renderTable() {
  const host = $('ramptable');
  if (!host) return;
  // THE ANSWER, ABOVE THE TABLE. Every speed dial moves the unlock door, and
  // scrolling seventy rows to find out where it landed is not a readout.
  const head = $('rampsolve');
  if (head) {
    const u = unlockDoorOf();
    head.innerHTML = `<b>Slow time unlocks on door ${u}</b> — the first door at `
      + `${V.unlockM.toFixed(1)} m/s. The school runs doors ${u}–${u + V.schoolDoors - 1}, `
      + `then the staircase climbs again to ${V.capM.toFixed(1)} m/s.`;
  }
  const rows = [];
  let prev = null;
  for (let d = 1; d <= DOORS; d++) {
    const r = doorRow(d);
    // A ROW IS INTERESTING WHEN SOMETHING CHANGED. Forty identical-looking
    // lines is not a curve you can read; the doors where a dial moves are.
    // SPEED IS DELIBERATELY NOT IN THIS KEY. It steps every two doors, so
    // including it marked half the table and the marker stopped meaning
    // anything. The m/s column reads as a staircase on its own.
    const key = `${r.legs}|${r.bodies}|${r.alive}|${r.form}|${r.slow}|${r.volley}`;
    const stepped = key !== prev;
    prev = key;
    rows.push(`<tr class="${stepped ? 'step' : ''}${r.volley ? ' school' : ''}">
      <td>${d}</td>
      <td>${r.legs}</td>
      <td>${r.bodies}</td>
      <td class="dim">${r.split.join('+')}</td>
      <td>${r.alive}</td>
      <td class="dim">${r.form === 'corridor' ? 'corridor' : '—'}</td>
      <td>${r.speed.toFixed(1)}</td>
      <td>${r.gap.toFixed(2)}</td>
      <td class="dim">${r.volley || ''}</td>
      <td class="dim">${r.slow ? '●' : ''}</td>
    </tr>`);
  }
  host.innerHTML = `<table class="ramp">
    <thead><tr><th>door</th><th>legs</th><th>bodies</th><th>split</th>
      <th>alive</th><th>form</th><th>m/s</th><th>gap</th><th>volley</th>
      <th>slow-mo</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;
}

// What the pane hands back: the same keys `OPENING`, `RAMP` and `TIME` carry,
// so an export is a patch against balance.js rather than a shape of its own.
export function read() {
  return {
    OPENING: { legsEvery: V.legsEvery, bodiesEvery: V.bodiesEvery,
      aliveEvery: V.aliveEvery, legsCap: V.legsCap,
      corridorDoors: V.corridorDoors, gapDoors: V.gapDoors,
      gapFrom: V.gapFrom, gapTo: V.gapTo, gapBy: V.gapBy,
      holdSlack: V.holdSlack },
    RAMP: { rampWaves: V.rampWaves },
    SPEED: { openM: V.openM, openDoors: V.openDoors, holdM: V.holdM,
      holdDoors: V.holdDoors, stepM: V.stepM, stepDoors: V.stepDoors,
      unlockM: V.unlockM, schoolDoors: V.schoolDoors },
    SCHOOL: { volley: V.volley, volleyBuild: V.volleyBuild,
      volleyGap: V.volleyGap, volleySpread: V.volleySpread,
      clusterM: V.clusterM, spare: V.spare,
      drainMul: V.drainMul, bonusMul: V.bonusMul, calmGap: V.calmGap },
  };
}

export function initRampPane(changed) {
  onChange = changed || (() => {});
  seed();
  renderDials();
  renderTable();
  const rv = $('rampRevert');
  if (rv) rv.onclick = () => { seed(); renderDials(); renderTable(); onChange(read()); };
}
