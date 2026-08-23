// ---------------------------------------------------------------------------
// TIME SHATTER — LEVEL TOOL
//
// An overhead editor for the corridor legs, their enemy spawns, and the
// numbers that govern how a fight in one feels.
//
// It imports the GAME'S OWN modules — src/genleg.js, src/protocols.js,
// src/balance.js — rather than reimplementing any of them. What you see here
// is literally what buildHallLeg is handed, so the tool cannot drift from the
// game: if a layout looks wrong here it is wrong there too.
//
// Edits are overlaid on the generated layout and kept per door. Nothing is
// written back to the repo from the browser; "Export JSON" produces a patch
// of layouts and balance overrides to hand back.
// ---------------------------------------------------------------------------
import { HALL, genHallLeg } from '../src/genleg.js';
import { composeProtocol, newRunMemory, ELEMENTS } from '../src/protocols.js';
import * as B from '../src/balance.js';
import { initTutorialPane, tutorialSpec, reload as reloadPreview, fitMap } from './tutorial-pane.js';
import { initRampPane } from './ramp-pane.js';

const $ = (id) => document.getElementById(id);
const C = HALL.cell;
const DOORS = 12;
const TYPES = ELEMENTS.filter((e) => e.kind === 'enemy').map((e) => e.id);

// --- the model ------------------------------------------------------------
// One entry per door: the generated geometry plus whatever has been edited on
// top of it. `base` is kept so "Revert door" is a real revert.
const doors = [];
let cur = 0;
let seedMem = null;

function makeDoor(n) {
  const grid = new Set();
  const proto = composeProtocol(n, n * 3, seedMem);
  const leg = genHallLeg(0, 0, proto, grid, B.LEG ? 7 : 7);
  const spine = leg.spine.map(([x, z]) => [x, z]);
  const d = {
    n, proto,
    cells: leg.cells.map(([x, z]) => [x, z]),
    spine,
    pillars: (leg.pillars || []).map(([x, z]) => [x / C, z / C]),
    covers: (leg.covers || []).map((c) => [c[0] / C, c[1] / C]),
    entry: spine[0].slice(),
    exit: [leg.endGx, leg.endGz],
    spawns: seedSpawns(leg, n),
  };
  d.base = JSON.parse(JSON.stringify({ cells: d.cells, pillars: d.pillars,
    covers: d.covers, entry: d.entry, exit: d.exit, spawns: d.spawns }));
  return d;
}

// Where the game would actually put bodies: the approach carries the last
// group, and the rest are spread along the stretches that precede it. The
// early doors are deliberately a single gunner — see EARLY in balance.js.
function seedSpawns(leg, n) {
  const out = [];
  const solo = n <= (B.EARLY ? B.EARLY.oneBodyDoors : 0);
  const app = leg.approach;
  out.push({ gx: app[Math.max(0, app.length - 2)][0], gz: app[Math.max(0, app.length - 2)][1], type: 'gunner' });
  if (solo) return out;
  const per = Math.min(6, 1 + Math.floor(n / 2));
  for (let i = 0; i < per; i++) {
    const s = leg.stretches[Math.min(leg.stretches.length - 1,
      Math.floor((i / per) * leg.stretches.length))];
    const c = s.cells[Math.floor(s.cells.length / 2)] || leg.spine[0];
    out.push({ gx: c[0], gz: c[1], type: i % 3 === 2 ? 'rusher' : 'gunner' });
  }
  return out;
}

// --- view -----------------------------------------------------------------
const cv = $('map'), ctx = cv.getContext('2d');
let px = 0, py = 0, zoom = 22;         // pan in screen px, zoom in px per cell
let tool = 'corridor', etype = 'gunner';
let sel = null;                         // { kind, i } or { kind:'cell', gx,gz }
let drag = null, panning = false, space = false;

const TOOLS = [
  ['corridor', 'Corridor', '#4a5563'],
  ['room', 'Room / chamber', '#5a6470'],
  ['pillar', 'Pillar', '#8b939d'],
  ['cover', 'Low cover', '#6f7a86'],
  ['spawn', 'Enemy spawn', '#ff2d1a'],
  ['entry', 'Entry door', '#3ec46d'],
  ['exit', 'Exit door', '#ff8a2e'],
  ['erase', 'Erase', '#7a2a22'],
];

function fit() {
  const d = doors[cur];
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  for (const [x, z] of d.cells) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mnz = Math.min(mnz, z); mxz = Math.max(mxz, z); }
  const w = cv.width / devicePixelRatio, h = cv.height / devicePixelRatio;
  zoom = Math.max(8, Math.min(46, Math.min(w / (mxx - mnx + 6), h / (mxz - mnz + 6))));
  px = w / 2 - ((mnx + mxx) / 2) * zoom;
  py = h / 2 - ((mnz + mxz) / 2) * zoom;
}
const s2g = (sx, sy) => [Math.round((sx - px) / zoom), Math.round((sy - py) / zoom)];
const g2s = (gx, gz) => [px + gx * zoom, py + gz * zoom];

function resize() {
  const r = cv.getBoundingClientRect();
  cv.width = r.width * devicePixelRatio;
  cv.height = r.height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  draw();
}

function draw() {
  const d = doors[cur];
  const w = cv.width / devicePixelRatio, h = cv.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  // grid
  ctx.strokeStyle = '#171a20'; ctx.lineWidth = 1;
  const step = zoom;
  for (let x = px % step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = py % step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // floor cells
  const spineKey = new Set(d.spine.map(([x, z]) => x + ',' + z));
  for (const [gx, gz] of d.cells) {
    const [sx, sy] = g2s(gx, gz);
    ctx.fillStyle = spineKey.has(gx + ',' + gz) ? '#39404b' : '#2a3038';
    ctx.fillRect(sx - zoom / 2 + 1, sy - zoom / 2 + 1, zoom - 2, zoom - 2);
  }
  // pillars, covers
  for (const [gx, gz] of d.pillars) {
    const [sx, sy] = g2s(gx, gz);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(sx - zoom * 0.16, sy - zoom * 0.1, zoom * 0.32, zoom * 0.2);
  }
  for (const [gx, gz] of d.covers) {
    const [sx, sy] = g2s(gx, gz);
    ctx.fillStyle = '#6f7a86';
    ctx.fillRect(sx - zoom * 0.4, sy - zoom * 0.18, zoom * 0.8, zoom * 0.36);
  }
  // doors
  const mark = (g, col, txt) => {
    const [sx, sy] = g2s(g[0], g[1]);
    ctx.fillStyle = col;
    ctx.fillRect(sx - zoom * 0.42, sy - zoom * 0.12, zoom * 0.84, zoom * 0.24);
    ctx.fillStyle = '#0c0d10'; ctx.font = '700 9px ui-sans-serif';
    ctx.textAlign = 'center'; ctx.fillText(txt, sx, sy + 3);
  };
  mark(d.entry, '#3ec46d', 'IN');
  mark(d.exit, '#ff8a2e', 'OUT');
  // spawns
  d.spawns.forEach((s, i) => {
    const [sx, sy] = g2s(s.gx, s.gz);
    const on = sel && sel.kind === 'spawn' && sel.i === i;
    ctx.beginPath(); ctx.arc(sx, sy, zoom * 0.26, 0, 7);
    ctx.fillStyle = on ? '#fff' : '#ff2d1a'; ctx.fill();
    ctx.fillStyle = on ? '#ff2d1a' : '#0c0d10';
    ctx.font = '800 9px ui-sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(s.type.slice(0, 2).toUpperCase(), sx, sy + 3);
  });
  if (sel && sel.kind === 'cell') {
    const [sx, sy] = g2s(sel.gx, sel.gz);
    ctx.strokeStyle = '#ff8a2e'; ctx.lineWidth = 2;
    ctx.strokeRect(sx - zoom / 2, sy - zoom / 2, zoom, zoom);
  }
  $('hud').innerHTML = `door <b>${d.n}</b> · ${d.cells.length} cells · `
    + `${d.spawns.length} spawns · ${(d.cells.length * C * C).toFixed(0)} m² · `
    + `cell ${C} m · zoom ${zoom.toFixed(0)}px`;
}

// --- editing --------------------------------------------------------------
const hasCell = (d, gx, gz) => d.cells.some(([x, z]) => x === gx && z === gz);
function addCell(d, gx, gz) { if (!hasCell(d, gx, gz)) d.cells.push([gx, gz]); }
function delCell(d, gx, gz) {
  const i = d.cells.findIndex(([x, z]) => x === gx && z === gz);
  if (i >= 0) d.cells.splice(i, 1);
}
function nearestSpawn(d, gx, gz) {
  let best = -1, bd = 0.8;
  d.spawns.forEach((s, i) => {
    const dd = Math.hypot(s.gx - gx, s.gz - gz);
    if (dd < bd) { bd = dd; best = i; }
  });
  return best;
}

function apply(gx, gz, alt) {
  const d = doors[cur];
  if (alt || tool === 'erase') {
    delCell(d, gx, gz);
    const i = nearestSpawn(d, gx, gz); if (i >= 0) d.spawns.splice(i, 1);
    d.pillars = d.pillars.filter(([x, z]) => Math.hypot(x - gx, z - gz) > 0.6);
    d.covers = d.covers.filter(([x, z]) => Math.hypot(x - gx, z - gz) > 0.6);
    return;
  }
  switch (tool) {
    case 'corridor': addCell(d, gx, gz); break;
    case 'room':
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) addCell(d, gx + dx, gz + dz);
      break;
    case 'pillar': d.pillars.push([gx, gz]); break;
    case 'cover': d.covers.push([gx, gz]); break;
    case 'spawn': d.spawns.push({ gx, gz, type: etype }); break;
    case 'entry': d.entry = [gx, gz]; break;
    case 'exit': d.exit = [gx, gz]; break;
    default: break;
  }
}

// Rotate the tail of the leg about a chosen cell. This is the "make the
// hallway curve" operation: pick a cell on the spine and everything beyond it
// swings 90 degrees, carrying its pillars, covers, spawns and exit with it.
function rotateFrom(gx, gz, dir) {
  const d = doors[cur];
  const rot = ([x, z]) => {
    const rx = x - gx, rz = z - gz;
    return dir > 0 ? [gx - rz, gz + rx] : [gx + rz, gz - rx];
  };
  const past = ([, z]) => z > gz;
  d.cells = d.cells.map((c) => (past(c) ? rot(c) : c));
  d.spine = d.spine.map((c) => (past(c) ? rot(c) : c));
  d.pillars = d.pillars.map((c) => (past(c) ? rot(c) : c));
  d.covers = d.covers.map((c) => (past(c) ? rot(c) : c));
  d.spawns = d.spawns.map((s) => {
    if (s.gz <= gz) return s;
    const [x, z] = rot([s.gx, s.gz]);
    return { ...s, gx: x, gz: z };
  });
  if (d.exit[1] > gz) d.exit = rot(d.exit);
  draw();
}

// --- input ----------------------------------------------------------------
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  if (e.button === 1 || space) { panning = true; drag = { x: e.offsetX, y: e.offsetY }; return; }
  const [gx, gz] = s2g(e.offsetX, e.offsetY);
  const d = doors[cur];
  const si = nearestSpawn(d, gx, gz);
  if (si >= 0 && tool !== 'erase' && !e.altKey) {
    sel = { kind: 'spawn', i: si };
    drag = { moveSpawn: si };
    render();
    return;
  }
  sel = { kind: 'cell', gx, gz };
  drag = { paint: true, alt: e.altKey };
  apply(gx, gz, e.altKey);
  render();
});
cv.addEventListener('pointermove', (e) => {
  if (panning && drag) {
    px += e.offsetX - drag.x; py += e.offsetY - drag.y;
    drag = { x: e.offsetX, y: e.offsetY }; draw(); return;
  }
  if (!drag) return;
  const [gx, gz] = s2g(e.offsetX, e.offsetY);
  if (drag.moveSpawn !== undefined) {
    const s = doors[cur].spawns[drag.moveSpawn];
    if (s) { s.gx = gx; s.gz = gz; }
    draw(); return;
  }
  if (drag.paint) { apply(gx, gz, drag.alt); draw(); }
});
const endDrag = () => { drag = null; panning = false; render(); };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [gx, gz] = [(e.offsetX - px) / zoom, (e.offsetY - py) / zoom];
  zoom = Math.max(6, Math.min(60, zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
  px = e.offsetX - gx * zoom; py = e.offsetY - gz * zoom;
  draw();
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { space = true; cv.style.cursor = 'grab'; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (sel && sel.kind === 'spawn') { doors[cur].spawns.splice(sel.i, 1); sel = null; render(); }
  }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') { space = false; cv.style.cursor = 'crosshair'; } });

// --- chrome ---------------------------------------------------------------
function buildDoors() {
  $('doors').innerHTML = '';
  for (let i = 0; i < DOORS; i++) {
    const b = document.createElement('button');
    b.textContent = i + 1;
    b.className = i === cur ? 'on' : '';
    b.onclick = () => { cur = i; fit(); render(); };
    $('doors').appendChild(b);
  }
}
function buildTools() {
  $('tools').innerHTML = '';
  for (const [id, label, col] of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool' + (tool === id ? ' on' : '');
    b.innerHTML = `<i style="background:${col}"></i>${label}`;
    b.onclick = () => { tool = id; render(); };
    $('tools').appendChild(b);
  }
}
function render() {
  buildDoors(); buildTools();
  const d = doors[cur];
  const nm = (e) => (e ? e.name : '—');
  $('proto').innerHTML = `<b>${nm(d.proto.form)}</b><br>condition ${nm(d.proto.condition)}<br>`
    + `measures ${(d.proto.measures || []).map((m) => m.name).join(', ') || '—'}`;
  $('sel').textContent = !sel ? 'Nothing selected.'
    : sel.kind === 'spawn' ? `Spawn ${sel.i + 1} · ${d.spawns[sel.i] ? d.spawns[sel.i].type : '?'}`
      : `Cell ${sel.gx}, ${sel.gz}`;
  draw();
}

// --- balance --------------------------------------------------------------
// Every numeric leaf of the interesting groups gets a slider, with a range
// derived from the shipped value so the handle starts in a sane place.
const overrides = {};
const GROUPS = ['RAMP', 'PACING', 'TIME', 'DROPS', 'LEG', 'COMP', 'EARLY', 'GRIND', 'VIS'];
function buildBalance() {
  const host = $('balance');
  host.innerHTML = '';
  for (const g of GROUPS) {
    const obj = B[g];
    if (!obj || typeof obj !== 'object') continue;
    const box = document.createElement('div'); box.className = 'grp';
    box.innerHTML = `<h3>${g}</h3>`;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'number') continue;
      const lo = v === 0 ? 0 : Math.min(0, v * 2);
      const hi = v === 0 ? 1 : Math.abs(v) * 2.5;
      const stepv = Math.abs(v) >= 8 ? 1 : Math.abs(v) >= 1 ? 0.05 : 0.005;
      const row = document.createElement('div'); row.className = 'fld';
      row.innerHTML = `<label title="${g}.${k}">${k}</label><output>${v}</output>`;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = lo; inp.max = hi; inp.step = stepv; inp.value = v;
      inp.oninput = () => {
        const nv = parseFloat(inp.value);
        row.querySelector('output').textContent = nv;
        (overrides[g] = overrides[g] || {})[k] = nv;
        B[g][k] = nv;                 // live, so a reroll uses the new number
      };
      const wrap = document.createElement('div'); wrap.className = 'fld';
      wrap.appendChild(row.firstChild);
      wrap.appendChild(inp);
      wrap.appendChild(row.querySelector('output'));
      wrap.style.gridTemplateColumns = '86px 1fr 46px';
      box.appendChild(wrap);
    }
    // WEAPONS is a map of maps; give each weapon its own line of key numbers
    host.appendChild(box);
  }
  const wbox = document.createElement('div'); wbox.className = 'grp';
  wbox.innerHTML = '<h3>WEAPONS</h3>';
  for (const [wid, spec] of Object.entries(B.WEAPONS)) {
    const h = document.createElement('div');
    h.style.cssText = 'font-size:10px;letter-spacing:.14em;color:#8b929c;margin:8px 0 4px';
    h.textContent = wid.toUpperCase();
    wbox.appendChild(h);
    for (const [k, v] of Object.entries(spec)) {
      if (typeof v !== 'number' || !isFinite(v)) continue;
      const wrap = document.createElement('div'); wrap.className = 'fld';
      wrap.style.gridTemplateColumns = '86px 1fr 46px';
      const lab = document.createElement('label'); lab.textContent = k;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = 0; inp.max = Math.abs(v) * 2.5 || 1;
      inp.step = Math.abs(v) >= 8 ? 1 : 0.01; inp.value = v;
      const out = document.createElement('output'); out.textContent = v;
      inp.oninput = () => {
        const nv = parseFloat(inp.value);
        out.textContent = nv;
        ((overrides.WEAPONS = overrides.WEAPONS || {})[wid] =
          overrides.WEAPONS[wid] || {})[k] = nv;
        B.WEAPONS[wid][k] = nv;
      };
      wrap.append(lab, inp, out);
      wbox.appendChild(wrap);
    }
  }
  host.appendChild(wbox);
}

// --- actions --------------------------------------------------------------
$('reroll').onclick = () => { doors[cur] = makeDoor(cur + 1); sel = null; fit(); render(); };
$('reset').onclick = () => {
  const d = doors[cur];
  Object.assign(d, JSON.parse(JSON.stringify(d.base)));
  sel = null; render();
};
$('export').onclick = () => {
  const payload = {
    generatedAt: new Date().toISOString(),
    balanceOverrides: overrides,
    // ...and the opening ramp, if the RAMP pane has been opened. Shaped like
    // the balance module's own keys, so this is a patch to paste rather than
    // a format somebody has to translate.
    ramp: rampOverride,
    tutorial: tutorialSpec(),
    layouts: doors.map((d) => ({
      door: d.n,
      form: d.proto.form && d.proto.form.id,
      condition: d.proto.condition && d.proto.condition.id,
      measures: (d.proto.measures || []).map((m) => m.id),
      cells: d.cells, pillars: d.pillars, covers: d.covers,
      entry: d.entry, exit: d.exit, spawns: d.spawns,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'timeshatter-levels.json';
  a.click();
};
$('rotL').onclick = () => { if (sel && sel.kind === 'cell') rotateFrom(sel.gx, sel.gz, -1); };
$('rotR').onclick = () => { if (sel && sel.kind === 'cell') rotateFrom(sel.gx, sel.gz, 1); };
$('etype').innerHTML = TYPES.map((t) => `<option>${t}</option>`).join('');
$('etype').onchange = (e) => { etype = e.target.value; };

// --- modes ----------------------------------------------------------------
// LEVELS is the overhead corridor editor. TUTORIAL is the onboarding: its
// legs, what the player is allowed to do on each step, what it says and when,
// and the real game running all of it in the pane on the right.
let mode = 'levels';
let tutorBooted = false;
// The opening ramp's dials, once somebody has opened that pane. Held here
// rather than inside it so the export picks them up like any other override.
let rampBooted = false, rampOverride = null;
function markRampDirty() {
  const b = document.getElementById('rampRevert');
  if (b) b.classList.add('on');
}
function setMode(m) {
  mode = m;
  document.body.classList.toggle('tutmode', m === 'tutor');
  document.body.classList.toggle('rampmode', m === 'ramp');
  $('mLevels').classList.toggle('on', m === 'levels');
  $('mTutor').classList.toggle('on', m === 'tutor');
  $('mRamp').classList.toggle('on', m === 'ramp');
  for (const n of document.querySelectorAll('.tutonly')) n.hidden = m !== 'tutor';
  for (const n of document.querySelectorAll('.lvlonly')) n.hidden = m !== 'levels';
  for (const n of document.querySelectorAll('.ramponly')) n.hidden = m !== 'ramp';
  if (m === 'ramp' && !rampBooted) {
    rampBooted = true;
    // The ramp's numbers go into the same override the balance sliders write,
    // so the preview and the export carry them like any other tuning.
    initRampPane((v) => { rampOverride = v; markRampDirty(); });
  }
  if (m === 'tutor') {
    if (!tutorBooted) {
      tutorBooted = true;
      initTutorialPane();
      reloadPreview();        // the preview only starts when it is looked at
    }
    // the map pane has a size only now that it is on screen
    requestAnimationFrame(() => { try { fitMap(); } catch { /* not up yet */ } });
  }
  if (m === 'levels') { resize(); fit(); render(); }
}
$('mLevels').onclick = () => setMode('levels');
$('mTutor').onclick = () => setMode('tutor');
$('mRamp').onclick = () => setMode('ramp');

// --- boot -----------------------------------------------------------------
try {
  seedMem = newRunMemory([]);
  for (let i = 1; i <= DOORS; i++) doors.push(makeDoor(i));
  buildBalance();
  addEventListener('resize', resize);
  resize(); fit(); render();
} catch (err) {
  $('err').style.display = 'flex';
  $('err').textContent = 'Could not build the levels: ' + (err && err.message ? err.message : err);
  console.error(err);
}
