// ---------------------------------------------------------------------------
// THE TUTORIAL'S MAP EDITOR
//
// The same overhead editing the LEVELS mode gives a generated door, applied to
// an authored tutorial leg. It draws the leg by calling the GAME'S OWN
// genAuthoredLeg, so what is on the canvas is what buildHallLeg will be handed
// — the property that makes the preview next to it worth looking at.
//
// What can be edited, and what it writes back into the leg's plan:
//
//   spine   — drag a spine cell and the leg's `moves` are re-derived from the
//             new path, so a corner stays a corner rather than becoming a
//             list of coordinates nobody can read
//   floor   — paint or erase `extra` cells: a room's width, a fork's lane
//   spawn   — the leg's own enemies, dragged, added, deleted
//   pillar  — cover to hide behind
//
// The barrier and the door are drawn but not painted: the barrier's place is
// derived from the fork mark and the door is the end of the spine, so both
// move when the geometry does rather than being separately maintained.
// ---------------------------------------------------------------------------
import { HALL, genAuthoredLeg, planToCells } from '../src/genleg.js';

const $ = (id) => document.getElementById(id);
const C = HALL.cell;

let spec = null;              // the live tutorial spec, handed in
let legIx = 0;
let onChange = () => {};
let cv = null, ctx = null;
let px = 0, py = 0, zoom = 14;
let tool = 'floor';
let drag = null, panning = false, sel = null;
let etype = 'gunner';

const TOOLS = [
  ['floor',  'Floor',  '#39404b'],
  ['spine',  'Path',   '#6b7684'],
  ['spawn',  'Enemy',  '#ff2d1a'],
  ['pillar', 'Pillar', '#9aa3ad'],
  ['erase',  'Erase',  '#7a2a22'],
];

export function initTutorialMap(liveSpec, changed) {
  spec = liveSpec;
  onChange = changed || (() => {});
  cv = $('tutcanvas');
  if (!cv) return;
  ctx = cv.getContext('2d');
  bindInput();
  buildBar();
  addEventListener('resize', resize);
  resize();
  fit();
}

export function setMapLeg(i) { legIx = i; sel = null; resize(); fit(); draw(); buildBar(); }
export function refreshMap() { buildBar(); draw(); }
// The pane has no size until the mode is switched to, so the fit done at boot
// measured a zero-width canvas and left the leg drawn off the side.
export function fitMap() { resize(); fit(); draw(); }

// --- the leg, as geometry --------------------------------------------------
const leg = () => (spec && spec.LEGS[legIx]) || null;
function built() {
  const L = leg();
  if (!L || !L.plan) return null;
  try { return genAuthoredLeg(0, 0, L.plan, new Set()); } catch { return null; }
}

// --- drawing ---------------------------------------------------------------
function resize() {
  if (!cv) return;
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  cv.width = r.width * devicePixelRatio;
  cv.height = r.height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  draw();
}
function fit() {
  const g = built();
  if (!g || !cv) return;
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  for (const [x, z] of g.cells) {
    mnx = Math.min(mnx, x); mxx = Math.max(mxx, x);
    mnz = Math.min(mnz, z); mxz = Math.max(mxz, z);
  }
  const w = cv.width / devicePixelRatio, h = cv.height / devicePixelRatio;
  if (!w || !h) return;
  zoom = Math.max(5, Math.min(40, Math.min(w / (mxx - mnx + 4), h / (mxz - mnz + 4))));
  px = w / 2 - ((mnx + mxx) / 2) * zoom;
  py = h / 2 - ((mnz + mxz) / 2) * zoom;
}
const s2g = (sx, sy) => [Math.round((sx - px) / zoom), Math.round((sy - py) / zoom)];
const g2s = (gx, gz) => [px + gx * zoom, py + gz * zoom];

function draw() {
  if (!ctx) return;
  const w = cv.width / devicePixelRatio, h = cv.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  const g = built();
  const L = leg();
  if (!g) { hud('this leg has no plan'); return; }

  ctx.strokeStyle = '#171a20'; ctx.lineWidth = 1;
  for (let x = px % zoom; x < w; x += zoom) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = py % zoom; y < h; y += zoom) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  const spineKey = new Set(g.spine.map(([x, z]) => x + ',' + z));
  for (const [gx, gz] of g.cells) {
    const [sx, sy] = g2s(gx, gz);
    ctx.fillStyle = spineKey.has(gx + ',' + gz) ? '#39404b' : '#2a3038';
    ctx.fillRect(sx - zoom / 2 + 1, sy - zoom / 2 + 1, zoom - 2, zoom - 2);
  }
  // the walked path, so a corner reads as a corner
  ctx.strokeStyle = '#6b7684'; ctx.lineWidth = Math.max(1.5, zoom * 0.1);
  ctx.beginPath();
  g.spine.forEach(([gx, gz], i) => {
    const [sx, sy] = g2s(gx, gz);
    if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
  });
  ctx.stroke();

  for (const [mx, mz] of g.pillars) {
    const [sx, sy] = g2s(mx / C, mz / C);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(sx - zoom * 0.18, sy - zoom * 0.18, zoom * 0.36, zoom * 0.36);
  }

  // START and DOOR: derived, never painted
  const tag = (gx, gz, col, txt) => {
    const [sx, sy] = g2s(gx, gz);
    ctx.fillStyle = col;
    ctx.fillRect(sx - zoom * 0.45, sy - zoom * 0.14, zoom * 0.9, zoom * 0.28);
    ctx.fillStyle = '#0c0d10';
    ctx.font = `800 ${Math.max(7, zoom * 0.34)}px ui-sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(txt, sx, sy + zoom * 0.12);
  };
  tag(g.spine[0][0], g.spine[0][1], '#3ec46d', 'IN');
  tag(g.endGx, g.endGz, '#ff8a2e', 'DOOR');

  // the barrier, where the marks say it is
  if (L && L.barrier && L.marks && L.marks.forkEnd != null) {
    const a = g.spine[Math.min(g.spine.length - 1, L.marks.forkEnd)];
    if (a) {
      const bz = a[1] + (spec.TUTOR.barrierCells || 6);
      const [sx, sy] = g2s(a[0], bz);
      ctx.fillStyle = '#16181d';
      ctx.fillRect(sx - zoom * 0.5, sy - zoom * 0.16, zoom, zoom * 0.32);
      ctx.fillStyle = '#8b929c';
      ctx.font = `800 ${Math.max(7, zoom * 0.3)}px ui-sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('STAND HERE', sx, sy - zoom * 0.34);
      // ...and the gunner the lesson puts beyond it
      const [ex, ey] = g2s(a[0], bz + (spec.TUTOR.enemyCells || 5));
      ctx.beginPath(); ctx.arc(ex, ey, zoom * 0.3, 0, 7);
      ctx.fillStyle = 'rgba(255,45,26,.55)'; ctx.fill();
    }
  }

  // the leg's own bodies
  (L && L.enemies || []).forEach((e, i) => {
    const [sx, sy] = g2s(g.spine[0][0] + (e.x || 0), g.spine[0][1] + (e.z || 0));
    const on = sel && sel.kind === 'spawn' && sel.i === i;
    ctx.beginPath(); ctx.arc(sx, sy, zoom * 0.3, 0, 7);
    ctx.fillStyle = on ? '#fff' : '#ff2d1a'; ctx.fill();
    ctx.fillStyle = on ? '#ff2d1a' : '#0c0d10';
    ctx.font = `800 ${Math.max(7, zoom * 0.32)}px ui-sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText((e.type || 'gunner').slice(0, 2).toUpperCase(), sx, sy + zoom * 0.11);
  });

  hud(`<b>${L.id}</b> · ${g.cells.length} cells · path ${g.spine.length} · `
    + `${(L.enemies || []).length} enemies · ${(g.endGz - g.spine[0][1]) * C} m long`);
}
function hud(html) { const n = $('tutmaphud'); if (n) n.innerHTML = html; }

// --- editing ---------------------------------------------------------------
// The spine is stored as MOVES, not coordinates, because that is what a person
// editing a corridor is actually thinking about. Dragging a cell rewrites the
// path and the moves are re-derived from it, so the data stays readable.
function movesFromPath(path) {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0], dz = path[i][1] - path[i - 1][1];
    const dir = dz > 0 ? 'f' : dz < 0 ? 'b' : dx > 0 ? 'r' : 'l';
    if (out.length && out[out.length - 1][0] === dir) out[out.length - 1][1]++;
    else out.push([dir, 1]);
  }
  return out;
}
function pathOf(L) { return planToCells(0, 0, L.plan.moves).spine; }

// Extend or trim the walked path so its last cell is where you dropped it.
// Only orthogonal steps, and only forward-ish ones, because a leg that asks
// you to walk back the way you came is not a leg this game builds.
function retargetPath(gx, gz) {
  const L = leg();
  if (!L || !L.plan) return;
  const path = pathOf(L);
  const [lx, lz] = path[path.length - 1];
  let x = lx, z = lz, guard = 0;
  while ((x !== gx || z !== gz) && guard++ < 60) {
    if (z !== gz) z += Math.sign(gz - z);
    else x += Math.sign(gx - x);
    path.push([x, z]);
  }
  L.plan.moves = movesFromPath(path);
  onChange();
}

const hasExtra = (L, gx, gz) => (L.plan.extra || []).some(([x, z]) => x === gx && z === gz);
function paint(gx, gz, alt) {
  const L = leg();
  if (!L || !L.plan) return;
  L.plan.extra = L.plan.extra || [];
  L.plan.pillars = L.plan.pillars || [];
  const spineHas = pathOf(L).some(([x, z]) => x === gx && z === gz);
  if (alt || tool === 'erase') {
    L.plan.extra = L.plan.extra.filter(([x, z]) => x !== gx || z !== gz);
    L.plan.pillars = L.plan.pillars.filter(([x, z]) => x !== gx || z !== gz);
    const si = nearestSpawn(gx, gz);
    if (si >= 0) L.enemies.splice(si, 1);
    onChange(); return;
  }
  switch (tool) {
    case 'floor': if (!spineHas && !hasExtra(L, gx, gz)) L.plan.extra.push([gx, gz]); break;
    case 'spine': retargetPath(gx, gz); return;
    case 'pillar': L.plan.pillars.push([gx, gz]); break;
    case 'spawn':
      L.enemies = L.enemies || [];
      L.enemies.push({ x: gx, z: gz, type: etype });
      break;
    default: break;
  }
  onChange();
}
function nearestSpawn(gx, gz) {
  const L = leg();
  let best = -1, bd = 0.9;
  (L && L.enemies || []).forEach((e, i) => {
    const d = Math.hypot((e.x || 0) - gx, (e.z || 0) - gz);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function bindInput() {
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.shiftKey) { panning = true; drag = { x: e.offsetX, y: e.offsetY }; return; }
    const [gx, gz] = s2g(e.offsetX, e.offsetY);
    const si = nearestSpawn(gx, gz);
    if (si >= 0 && tool !== 'erase' && !e.altKey) {
      sel = { kind: 'spawn', i: si }; drag = { moveSpawn: si }; draw(); return;
    }
    drag = { paint: true, alt: e.altKey };
    paint(gx, gz, e.altKey);
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (panning && drag) {
      px += e.offsetX - drag.x; py += e.offsetY - drag.y;
      drag = { x: e.offsetX, y: e.offsetY }; draw(); return;
    }
    if (!drag) return;
    const [gx, gz] = s2g(e.offsetX, e.offsetY);
    if (drag.moveSpawn !== undefined) {
      const L = leg();
      const s = L && L.enemies && L.enemies[drag.moveSpawn];
      if (s) { s.x = gx; s.z = gz; onChange(); }
      draw(); return;
    }
    if (drag.paint && tool !== 'spine') { paint(gx, gz, drag.alt); draw(); }
  });
  const end = () => { drag = null; panning = false; draw(); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [ax, az] = [(e.offsetX - px) / zoom, (e.offsetY - py) / zoom];
    zoom = Math.max(4, Math.min(48, zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    px = e.offsetX - ax * zoom; py = e.offsetY - az * zoom;
    draw();
  }, { passive: false });
}

function buildBar() {
  const bar = $('tutmapbar');
  if (!bar || !spec) return;
  bar.innerHTML = '';
  // which leg
  spec.LEGS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'lg' + (i === legIx ? ' on' : '');
    b.textContent = L.id;
    b.onclick = () => { setMapLeg(i); onChange(true); };
    bar.appendChild(b);
  });
  const gap = document.createElement('span');
  gap.style.cssText = 'width:10px;display:inline-block';
  bar.appendChild(gap);
  for (const [id, label] of TOOLS) {
    const b = document.createElement('button');
    b.className = tool === id ? 'on' : '';
    b.textContent = label;
    b.title = id === 'spine' ? 'Click where the corridor should go: the path is '
      + 'extended to there and the leg\'s moves are rewritten from it.'
      : id === 'floor' ? 'Paint width onto the path — a room, or a fork\'s second lane.'
        : id === 'erase' ? 'Remove floor, pillars and enemies (alt-drag does this too).'
          : `Place a ${id}.`;
    b.onclick = () => { tool = id; buildBar(); };
    bar.appendChild(b);
  }
  const f = document.createElement('button');
  f.textContent = '⤢'; f.title = 'Fit the leg to the pane';
  f.onclick = () => { fit(); draw(); };
  bar.appendChild(f);
}

export function mapLegIndex() { return legIx; }
