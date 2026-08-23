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
import { OPENING, RAMP, TIME, ramp } from '../src/balance.js';

const $ = (id) => document.getElementById(id);
const DOORS = 40;

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
    gapFrom: OPENING.gapFrom,
    gapTo: OPENING.gapTo,
    gapBy: OPENING.gapBy,
    bulletBase: RAMP.bulletBase,
    bulletFloor: RAMP.bulletFloor,
    bulletRange: RAMP.bulletRange,
    rampWaves: RAMP.rampWaves,
    unlockDoor: TIME.unlockDoor,
  };
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
  const gap = v.gapFrom + (v.gapTo - v.gapFrom) * t;
  const diffT = Math.max(0, Math.min(1, (d - 1) / Math.max(1, v.rampWaves)));
  const speed = v.bulletBase * Math.min(v.bulletFloor + v.bulletRange * diffT, RAMP.bulletCap);
  return { d, legs, bodies, alive, split, gap, speed,
    form: d <= v.corridorDoors ? 'corridor' : 'any',
    slow: d >= v.unlockDoor };
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
  ['bulletFloor', 'Bullet speed · door 1', 0.1, 1, 0.01,
    'Fraction of the reference speed on door 1. At 0.34 a round crosses a 16 m '
    + 'room in three seconds: something you can watch coming and walk out of, '
    + 'before anybody has been given a way to slow it down.'],
  ['rampWaves', 'Bullet speed · full by', 4, 40, 1,
    'Doors until the round reaches reference speed. Longer means the opening '
    + 'has more room to teach the timing before it tightens.'],
  ['unlockDoor', 'Slow motion unlocks at', 1, 20, 1,
    'The door the time button and the meter arrive on. Before it neither is '
    + 'drawn and the control is inert: nothing to discover early, nothing to '
    + 'miss. See docs/TUTORIAL-GOALS.md §5 for why it is deferred at all.'],
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
  const rows = [];
  let prev = null;
  for (let d = 1; d <= DOORS; d++) {
    const r = doorRow(d);
    // A ROW IS INTERESTING WHEN SOMETHING CHANGED. Forty identical-looking
    // lines is not a curve you can read; the doors where a dial moves are.
    const key = `${r.legs}|${r.bodies}|${r.alive}|${r.form}|${r.slow}`;
    const stepped = key !== prev;
    prev = key;
    rows.push(`<tr class="${stepped ? 'step' : ''}">
      <td>${d}</td>
      <td>${r.legs}</td>
      <td>${r.bodies}</td>
      <td class="dim">${r.split.join('+')}</td>
      <td>${r.alive}</td>
      <td class="dim">${r.form === 'corridor' ? 'corridor' : '—'}</td>
      <td>${r.speed.toFixed(1)}</td>
      <td>${r.gap.toFixed(2)}</td>
      <td class="dim">${r.slow ? '●' : ''}</td>
    </tr>`);
  }
  host.innerHTML = `<table class="ramp">
    <thead><tr><th>door</th><th>legs</th><th>bodies</th><th>split</th>
      <th>alive</th><th>form</th><th>m/s</th><th>gap</th><th>slow-mo</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;
}

// What the pane hands back: the same keys `OPENING`, `RAMP` and `TIME` carry,
// so an export is a patch against balance.js rather than a shape of its own.
export function read() {
  return {
    OPENING: { legsEvery: V.legsEvery, bodiesEvery: V.bodiesEvery,
      aliveEvery: V.aliveEvery, legsCap: V.legsCap,
      corridorDoors: V.corridorDoors, gapDoors: V.gapDoors,
      gapFrom: V.gapFrom, gapTo: V.gapTo, gapBy: V.gapBy },
    RAMP: { bulletFloor: V.bulletFloor, rampWaves: V.rampWaves },
    TIME: { unlockDoor: V.unlockDoor },
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
