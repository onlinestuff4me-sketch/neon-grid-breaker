// ---------------------------------------------------------------------------
// THE TOOL'S TUTORIAL SECTION
//
// Four things, which is what the onboarding actually consists of:
//
//   1. the LEGS it builds        — left rail
//   2. what the player MAY DO    — the mechanics matrix on each step
//   3. what it SAYS, where, and when it comes and goes — the cue editor
//   4. the game, running it      — the preview on the right
//
// It edits the same object src/tutorial.js exports and src/main.js consumes.
// Nothing here reimplements the lesson: the preview is the real game with the
// real spec, which is the only kind of preview worth having.
// ---------------------------------------------------------------------------
import {
  DEFAULT_SPEC, MECHANICS, NO_GRANTS, CUE_SLOTS, CUE_ARROWS, CUE_HANDS,
  CUE_EVENTS, CUE_SHOW, ADVANCE_KINDS, OVERRIDE_KEY, PREVIEW_PARAM,
} from '../src/tutorial.js';
import { ELEMENTS } from '../src/protocols.js';
import { initTutorialMap, setMapLeg, refreshMap, fitMap } from './tutorial-map.js';

const $ = (id) => document.getElementById(id);
const clone = (v) => JSON.parse(JSON.stringify(v));
const FORMS = ELEMENTS.filter((e) => e.kind === 'form').map((e) => e.id);

// The live spec. Seeded from the shipped one, then whatever was left in the
// override key — so closing the tab does not lose an afternoon's wording.
let spec = clone(DEFAULT_SPEC);
try {
  const raw = localStorage.getItem(OVERRIDE_KEY);
  if (raw) {
    const o = JSON.parse(raw);
    if (o && o.TUTOR) Object.assign(spec.TUTOR, o.TUTOR);
    if (o && o.LEGS && o.LEGS.length) spec.LEGS = o.LEGS;
    if (o && o.STEPS && o.STEPS.length) spec.STEPS = o.STEPS;
  }
} catch { /* private mode, or a spec from an older build */ }

let open = new Set([spec.STEPS[0] && spec.STEPS[0].id]);
let dirty = false;

export function tutorialSpec() { return spec; }
export { fitMap };

// --- persistence -----------------------------------------------------------
// The preview reads this key, and ONLY under ?tutorpreview=1 — see the note in
// src/tutorial.js. An override left here cannot reach an ordinary run.
function save() {
  try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(spec)); } catch { /* private */ }
}
function markDirty(refresh = true) {
  dirty = true; save(); paintApply();
  if (refresh) { try { refreshMap(); } catch { /* map not up yet */ } }
}
function paintApply() {
  const b = $('tutApply');
  if (b) { b.classList.toggle('on', dirty); b.textContent = dirty ? 'Apply to preview ●' : 'Apply to preview'; }
}

// --- small builders --------------------------------------------------------
function sel(value, options, onChange, title) {
  const s = document.createElement('select');
  if (title) s.title = title;
  for (const [id, label] of options) {
    const o = document.createElement('option');
    o.value = id; o.textContent = label;
    if (id === value) o.selected = true;
    s.appendChild(o);
  }
  s.onchange = () => onChange(s.value);
  return s;
}
function field(label, node) {
  const w = document.createElement('div');
  const l = document.createElement('label');
  l.textContent = label;
  w.append(l, node);
  return w;
}
function btn(text, onClick, title) {
  const b = document.createElement('button');
  b.textContent = text; b.onclick = onClick;
  if (title) b.title = title;
  return b;
}

// --- 1. the legs -----------------------------------------------------------
function renderLegs() {
  const host = $('tutlegs');
  if (!host) return;
  host.innerHTML = '';
  spec.LEGS.forEach((leg, i) => {
    const row = document.createElement('div');
    row.className = 'legrow';
    const name = document.createElement('input');
    name.type = 'text'; name.value = leg.id;
    name.oninput = () => { leg.id = name.value; markDirty(); };
    const form = sel(leg.form, FORMS.map((f) => [f, f]), (v) => { leg.form = v; markDirty(); reload(); }, 'The space this leg is');
    // An authored leg's length is its PATH — edit it on the map, not here.
    const len = document.createElement('span');
    len.style.cssText = 'font-size:10.5px;color:var(--dim);white-space:nowrap';
    // the same number the map's readout gives, in the same units
    len.textContent = `${(leg.plan && leg.plan.moves || []).reduce((n, [, k]) => n + k, 0) * 4} m`;
    const st = document.createElement('label');
    st.style.cssText = 'font-size:10.5px;color:var(--dim);display:flex;gap:4px;align-items:center';
    const stc = document.createElement('input');
    stc.type = 'checkbox'; stc.checked = !!leg.straight;
    stc.onchange = () => { leg.straight = stc.checked; markDirty(); reload(); };
    st.append(stc, document.createTextNode('straight'));
    const ba = document.createElement('label');
    ba.style.cssText = st.style.cssText;
    ba.title = 'A wall-to-wall block already standing when the leg begins, so the '
      + 'move lesson has somewhere to walk to and the rounds have something to clear.';
    const bac = document.createElement('input');
    bac.type = 'checkbox'; bac.checked = !!leg.barrier;
    bac.onchange = () => { leg.barrier = bac.checked; markDirty(); reload(); };
    ba.append(bac, document.createTextNode('barrier'));
    const del = btn('✕', () => {
      if (spec.LEGS.length <= 1) return;
      spec.LEGS.splice(i, 1); markDirty(); renderLegs(); reload();
    }, 'Remove this leg');
    const pick = btn('▦', () => { setMapLeg(i); renderLegs(); }, 'Show this leg on the map');
    const r1 = document.createElement('div'); r1.className = 'r1';
    r1.append(pick, name, del);
    const r2 = document.createElement('div'); r2.className = 'r2';
    r2.append(form, len);
    const r3 = document.createElement('div'); r3.className = 'r2';
    r3.style.marginTop = '5px';
    r3.append(st, ba);
    row.append(r1, r2, r3);
    if (leg.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = leg.note;
      row.appendChild(note);
    }
    host.appendChild(row);
  });
}
function addLeg() {
  spec.LEGS.push({ id: `leg${spec.LEGS.length + 1}`, form: 'corridor',
    straight: false, cells: 7, barrier: false, note: '' });
  markDirty(); renderLegs(); reload();
}

// --- the numbers -----------------------------------------------------------
const NUM_HELP = {
  moveNeeded: 'metres walked before the move lesson is satisfied',
  lookNeeded: 'radians of yaw swept before the look lesson is',
  barrierAt: 'metres ahead the barrier already stands',
  barrierH: 'barrier height — low enough to see and shoot over',
  enemyAt: 'metres ahead the first gunner stands',
  enemyX: 'how far to either side the other two stand (±1.7 is the wall)',
  aimBeat: 'seconds the prompt is up before his arm starts to rise',
  reshoot: 'gap before he tries again after a miss',
  shots: 'most rounds the beat will ever fire',
  afterBarrier: 'beat after a round clears the barrier',
  meterSecs: 'meter: full to half, in seconds',
  meterCrawlSecs: 'meter: the rate below the knee',
  meterKnee: 'meter: where the drain slows',
  meterFloor: 'meter: how low it is ever allowed to go',
  resumeDelay: 'beat between the warning and what to do about it',
  faceRate: 'how fast the view is eased back down the hallway',
  gunRise: 'seconds for the weapon to swing up into frame',
  finalEnemies: 'how many stand there for the shooting lesson',
  hallCells: 'default straight cells, when a leg does not say',
};
function renderNums() {
  const host = $('tutnums');
  if (!host) return;
  host.innerHTML = '';
  for (const [k, v] of Object.entries(spec.TUTOR)) {
    if (typeof v !== 'number') continue;
    const wrap = document.createElement('div');
    wrap.className = 'fld';
    wrap.style.gridTemplateColumns = '92px 1fr 42px';
    const lab = document.createElement('label');
    lab.textContent = k; lab.title = NUM_HELP[k] || k;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = 0; inp.max = Math.max(1, Math.abs(v) * 2.5);
    inp.step = Math.abs(v) >= 8 ? 1 : Math.abs(v) >= 1 ? 0.05 : 0.005;
    inp.value = v;
    const out = document.createElement('output');
    out.textContent = v;
    inp.oninput = () => {
      const nv = parseFloat(inp.value);
      out.textContent = nv; spec.TUTOR[k] = nv; markDirty();
    };
    wrap.append(lab, inp, out);
    host.appendChild(wrap);
  }
}

// --- 2 + 3. the steps ------------------------------------------------------
function renderSteps() {
  const host = $('tutsteps');
  if (!host) return;
  host.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'sub';
  head.style.margin = '0 0 8px';
  head.textContent = 'STEPS — WHAT THEY MAY DO, AND WHAT IT SAYS';
  host.appendChild(head);

  spec.STEPS.forEach((st, i) => host.appendChild(stepCard(st, i)));

  const add = btn('+ Add step', () => {
    spec.STEPS.push({ id: `step${spec.STEPS.length + 1}`, label: 'New step',
      advance: { kind: 'none' }, grants: {}, cues: [] });
    markDirty(); renderSteps(); renderJump();
  });
  add.style.marginTop = '4px';
  host.appendChild(add);

  const warn = document.createElement('div');
  warn.className = 'warn';
  warn.innerHTML = 'The <b>advance condition</b> is the one part of a step that has to be '
    + 'code — "moved 2.2 m" is not something a text box can express — so it is chosen from '
    + 'the list rather than typed. Everything else here is yours.';
  host.appendChild(warn);
}

function stepCard(st, i) {
  const card = document.createElement('div');
  card.className = 'step' + (open.has(st.id) ? ' open' : '');

  // --- header
  const hd = document.createElement('div');
  hd.className = 'hd';
  const ix = document.createElement('span'); ix.className = 'ix'; ix.textContent = i + 1;
  const nm = document.createElement('span'); nm.className = 'nm';
  nm.textContent = st.label || st.id;
  const tag = document.createElement('span'); tag.className = 'tag';
  tag.textContent = st.advance.kind;
  hd.onclick = (ev) => {
    if (ev.target.closest('.mv')) return;
    if (open.has(st.id)) open.delete(st.id); else open.add(st.id);
    renderSteps();
  };
  const up = btn('↑', () => move(i, -1), 'Earlier'); up.className = 'mv';
  const dn = btn('↓', () => move(i, 1), 'Later'); dn.className = 'mv';
  const rm = btn('✕', () => {
    if (spec.STEPS.length <= 1) return;
    spec.STEPS.splice(i, 1); markDirty(); renderSteps(); renderJump();
  }, 'Remove'); rm.className = 'mv';
  hd.append(ix, nm, tag, up, dn, rm);

  // --- body
  const bd = document.createElement('div');
  bd.className = 'bd';

  const idRow = document.createElement('div'); idRow.className = 'grid2';
  const idIn = document.createElement('input');
  idIn.type = 'text'; idIn.value = st.id;
  idIn.oninput = () => { st.id = idIn.value.trim() || st.id; markDirty(); renderJump(); };
  const lbIn = document.createElement('input');
  lbIn.type = 'text'; lbIn.value = st.label || '';
  lbIn.oninput = () => { st.label = lbIn.value; nm.textContent = lbIn.value || st.id; markDirty(); };
  idRow.append(field('id', idIn), field('name', lbIn));
  bd.appendChild(idRow);

  const advRow = document.createElement('div'); advRow.className = 'grid2';
  advRow.style.marginTop = '6px';
  const kindSel = sel(st.advance.kind, ADVANCE_KINDS.map(([k, d]) => [k, `${k} — ${d}`]),
    (v) => { st.advance.kind = v; tag.textContent = v; markDirty(); });
  const needIn = document.createElement('input');
  needIn.type = 'number'; needIn.step = '0.05';
  needIn.value = st.advance.need != null ? st.advance.need : '';
  needIn.placeholder = 'default';
  needIn.oninput = () => {
    const v = parseFloat(needIn.value);
    st.advance.need = isFinite(v) ? v : undefined;
    markDirty();
  };
  advRow.append(field('ends when', kindSel), field('threshold', needIn));
  bd.appendChild(advRow);

  // --- 2. mechanics
  const mh = document.createElement('div'); mh.className = 'sub';
  mh.textContent = 'THE PLAYER MAY';
  bd.appendChild(mh);
  const mech = document.createElement('div'); mech.className = 'mech';
  for (const [key, label, why] of MECHANICS) {
    const on = !!({ ...NO_GRANTS, ...(st.grants || {}) })[key];
    const l = document.createElement('label');
    l.className = on ? 'on' : ''; l.title = why;
    const c = document.createElement('input');
    c.type = 'checkbox'; c.checked = on;
    c.onchange = () => {
      st.grants = { ...NO_GRANTS, ...(st.grants || {}) };
      st.grants[key] = c.checked;
      l.className = c.checked ? 'on' : '';
      markDirty();
    };
    l.append(c, document.createTextNode(label));
    mech.appendChild(l);
  }
  bd.appendChild(mech);

  // --- the furniture the step brings with it
  const fh = document.createElement('div'); fh.className = 'sub';
  fh.textContent = 'AND ON ENTERING IT';
  bd.appendChild(fh);
  const furn = document.createElement('div'); furn.className = 'mech';
  // ALL of them. Five of these used to be missing, and the omission had teeth:
  // moving `placeEnemy` to another step — which the code specifically invites —
  // moved the gunner and left `hardFreeze` behind on the old step, silently
  // killing the freeze that makes the first round survivable. A tool that can
  // author some of what the game reads is a second source of truth.
  const FURNITURE = [
    ['buildBarrier', 'Raise the barrier', 'The wall-to-wall block the STAND HERE label hangs over.'],
    ['placeEnemy', 'Place one gunner', 'One body enemyCells beyond the barrier.'],
    ['placeSquad', 'Place the squad', 'finalEnemies − 1 more, abreast at ±enemyX.'],
    ['hardFreeze', 'Stop the world', 'Hold everything mid-telegraph until the time button is pressed.'],
    ['startMeter', 'Reveal the meter', 'The bar appears full and begins to drain.'],
    ['raiseGun', 'Raise the weapon', 'The viewmodel swings up on the reload rig.'],
    ['dropBarrier', 'Drop the barrier', 'It sinks into the floor.'],
    ['openDoor', 'Open the door', 'The red door at the end of the leg.'],
    ['checkpoint', 'Checkpoint', 'Dying rewinds to here, and the area is rebuilt.'],
    ['divider', 'Dotted divider', 'The centre line that splits move from look.'],
  ];
  for (const [key, label, why] of FURNITURE) {
    const l = document.createElement('label');
    l.className = st[key] ? 'on' : ''; l.title = why;
    const c = document.createElement('input');
    c.type = 'checkbox'; c.checked = !!st[key];
    c.onchange = () => { st[key] = c.checked; l.className = c.checked ? 'on' : ''; markDirty(); };
    l.append(c, document.createTextNode(label));
    furn.appendChild(l);
  }
  bd.appendChild(furn);

  // --- 3. the words
  const ch = document.createElement('div'); ch.className = 'sub';
  ch.textContent = `ON SCREEN (${(st.cues || []).length})`;
  bd.appendChild(ch);
  (st.cues || []).forEach((cue, ci) => bd.appendChild(cueCard(st, cue, ci, ch)));
  const addCue = btn('+ Add text', () => {
    st.cues = st.cues || [];
    st.cues.push({ text: 'NEW TEXT', slot: 'mid', arrow: 'none', hand: 'none',
      pulse: false, on: 'enter', off: 'advance' });
    markDirty(); renderSteps();
  });
  addCue.style.fontSize = '11px';
  bd.appendChild(addCue);

  card.append(hd, bd);
  return card;
}

function cueCard(st, cue, ci, countEl) {
  const box = document.createElement('div'); box.className = 'cue';
  const top = document.createElement('div'); top.className = 'cuetop';
  const t = document.createElement('b'); t.textContent = `TEXT ${ci + 1}`;
  const up = btn('↑', () => { swap(st.cues, ci, ci - 1); markDirty(); renderSteps(); });
  const dn = btn('↓', () => { swap(st.cues, ci, ci + 1); markDirty(); renderSteps(); });
  const rm = btn('✕', () => { st.cues.splice(ci, 1); markDirty(); renderSteps(); });
  top.append(t, up, dn, rm);

  const ta = document.createElement('textarea');
  ta.value = cue.text;
  ta.spellcheck = false;
  ta.title = 'A <span> makes a second, smaller line underneath — that is how '
    + 'DODGE THE BULLET carries TAP TO SLOW TIME.';
  ta.oninput = () => { cue.text = ta.value; markDirty(); };

  const g1 = document.createElement('div'); g1.className = 'grid2';
  g1.style.marginTop = '6px';
  g1.append(
    field('where', sel(cue.slot, CUE_SLOTS, (v) => { cue.slot = v; markDirty(); })),
    field('pointer', sel(cue.arrow, CUE_ARROWS, (v) => { cue.arrow = v; markDirty(); })),
  );
  const g2 = document.createElement('div'); g2.className = 'grid2';
  g2.style.marginTop = '5px';
  g2.append(
    field('appears on', sel(cue.on, CUE_SHOW.map(([k, d]) => [k, `${k} — ${d}`]),
      (v) => { cue.on = v; markDirty(); })),
    field('leaves on', sel(cue.off, CUE_EVENTS.map(([k, d]) => [k, `${k} — ${d}`]),
      (v) => { cue.off = v; markDirty(); })),
  );
  const g3 = document.createElement('div'); g3.className = 'grid2';
  g3.style.marginTop = '5px';
  const pl = document.createElement('label');
  pl.className = 'chk' + (cue.pulse ? ' on' : '');
  pl.title = 'Fade in and out on a beat, the way an unpressed control does.';
  const plc = document.createElement('input');
  plc.type = 'checkbox'; plc.checked = !!cue.pulse;
  plc.onchange = () => { cue.pulse = plc.checked; pl.className = 'chk' + (plc.checked ? ' on' : ''); markDirty(); };
  pl.append(plc, document.createTextNode('pulse'));
  g3.append(field('hand', sel(cue.hand, CUE_HANDS, (v) => { cue.hand = v; markDirty(); })), pl);

  box.append(top, ta, g1, g2, g3);
  if (countEl) countEl.textContent = `ON SCREEN (${st.cues.length})`;
  return box;
}

const swap = (a, i, j) => {
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
};
function move(i, d) {
  swap(spec.STEPS, i, i + d);
  markDirty(); renderSteps(); renderJump();
}

// --- 4. the preview --------------------------------------------------------
// The REAL game, in an iframe, under ?tutorpreview=1 — which is the only flag
// that makes src/tutorial.js look at the override this pane writes.
function previewURL() {
  return `../index.html?${PREVIEW_PARAM}=1&t=${previewURL.n = (previewURL.n || 0) + 1}`;
}
export function reload() {
  save();
  dirty = false; paintApply();
  const f = $('pFrame');
  if (f) f.src = previewURL();
  const live = $('plive');
  if (live) live.textContent = 'restarting…';
}
function renderJump() {
  const j = $('pJump');
  if (!j) return;
  const keep = j.value;
  j.innerHTML = '<option value="">jump to step…</option>'
    + spec.STEPS.map((s) => `<option value="${s.id}">${s.label || s.id}</option>`).join('');
  if (spec.STEPS.some((s) => s.id === keep)) j.value = keep;
}
function scalePreview() {
  const f = $('pFrame');
  const z = parseFloat($('pZoom').value) || 0.75;
  if (!f) return;
  f.style.transform = `scale(${z})`;
  // scale() does not change layout size, so the stage would keep reserving the
  // full 874 px and scroll for no reason. Reserve what is actually drawn.
  f.style.margin = `${(874 * z - 874) / 2}px ${(402 * z - 402) / 2}px`;
}

// The game posts its beat back every quarter second; this is the readout that
// tells you the cue you just wrote is the cue that is up.
addEventListener('message', (ev) => {
  const m = ev.data;
  if (!m || m.ts !== 'preview' || m.step === undefined) return;
  const live = $('plive');
  if (!live) return;
  const g = m.grants || {};
  const on = Object.keys(g).filter((k) => g[k]);
  live.innerHTML = m.step === null
    ? `<b>lesson over</b> — ${m.state}`
    : `step <b>${m.step}</b> · fired: ${(m.fired || []).join(', ') || '—'}\n`
      + `may: ${on.join(', ') || 'nothing'}${m.alive ? '' : ' · DEAD'}`;
});

// --- wiring ----------------------------------------------------------------
export function initTutorialPane() {
  renderLegs(); renderNums(); renderSteps(); renderJump(); paintApply();
  // The map edits the SAME spec object, so painting a room and typing a cue
  // are the same edit as far as everything downstream is concerned.
  initTutorialMap(spec, (legChanged) => {
    dirty = true; save(); paintApply();
    if (legChanged) renderLegs();
  });
  $('legAdd').onclick = addLeg;
  $('pReload').onclick = reload;
  $('tutApply').onclick = reload;
  $('tutRevert').onclick = () => {
    spec = clone(DEFAULT_SPEC);
    open = new Set([spec.STEPS[0].id]);
    try { localStorage.removeItem(OVERRIDE_KEY); } catch { /* private */ }
    renderLegs(); renderNums(); renderSteps(); renderJump(); reload();
  };
  $('pJump').onchange = (e) => {
    const f = $('pFrame');
    if (f && f.contentWindow && e.target.value) {
      f.contentWindow.postMessage({ ts: 'preview', cmd: 'step', step: e.target.value }, '*');
    }
  };
  $('pZoom').onchange = scalePreview;
  $('pOpen').onclick = () => window.open(previewURL(), '_blank');
  scalePreview();
}
