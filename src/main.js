// TIME SHATTER — a first-person time-manipulation arcade shooter for portrait mobile.
//
// Core mechanic: time only flows when your finger is off the screen.
//   HOLD + DRAG  -> time freezes (~5%), look around and aim
//   RELEASE      -> time resumes
//   TAP          -> fire at the crosshair
//   FLICK        -> dash / dodge in the flicked direction
//   second-finger TAP while holding -> fire without unfreezing time
//
// Everything simulates in scaled time (enemies, bullets, debris) while the
// camera and your own dash run in real time — so you aim and dodge at full
// speed while the world crawls.

import * as THREE from '../lib/three.module.min.js';
import { WEAPONS, TYPE_INTRO, TYPE_SHARE, TYPE_DROP, DROPS, RAMP, COMP, PACING, TIME, LEG, SHATTER,
  VIS, GRIND, EARLY, scarcity, condTax } from './balance.js';
import { composeProtocol, newRunMemory, enemyRoster, ELEMENTS } from './protocols.js';
// The corridor generator lives in its own module so the level tool at /tool
// draws the real layouts rather than a second implementation of them.
import { HALL, genHallLeg } from './genleg.js';
import { haptic, persist, hydrateStorage, shellSetup, isNative } from './native.js';

// ---------------------------------------------------------------------------
// LIFETIME PROGRESS — every door ever passed, and every element ever met.
//
// These are the two keys the protocol system gates on, so they outlive runs.
// They live at the very top because `recordMet` is called from the moment a
// weapon is put in your hand, which happens before the hallway code is even
// reached; a `let` further down would still be in its temporal dead zone.
// ---------------------------------------------------------------------------
let lifetimeDoors = 0;
let archive = new Set();
try {
  lifetimeDoors = parseInt(localStorage.getItem('timeshard_doors') || '0', 10) || 0;
  archive = new Set(JSON.parse(localStorage.getItem('timeshard_archive') || '[]'));
} catch { /* private mode */ }
function saveProgress() {
  try {
    persist('timeshard_doors', String(lifetimeDoors));
    persist('timeshard_archive', JSON.stringify([...archive]));
  } catch { /* private mode */ }
}
function recordMet(ids) {
  let fresh = 0;
  for (const id of ids) if (id && !archive.has(id)) { archive.add(id); fresh++; }
  if (fresh) { runFiled += fresh; saveProgress(); archiveDirty = true; }
}
let archiveDirty = true;   // the screen is rebuilt only when something changed
let runFiled = 0;          // filed THIS life — the death screen reports it

// Everything a leg is made of is met the moment you walk into it.
function recordMetProto(p) {
  if (!p) return;
  recordMet([p.form && p.form.id, p.condition && p.condition.id,
    ...p.measures.map((m) => m.id), p.enemyDebut && p.enemyDebut.id]);
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const ARENA_HALF = 21;            // arena is a square, walls at ±ARENA_HALF
const EYE_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.32;

const TIME_SLOW = TIME.slowScale;           // time scale while finger is down and still
const TIME_MOVE_MAX = TIME.moveScale;        // ... creeping up to this while you drag-dodge
const TIME_FULL = 1.0;
const TIME_EASE = 14;             // easing rate between the two

const PLAYER_BULLET_SPEED = 46;
const ENEMY_BULLET_SPEED = 11;    // base; creeps up slightly with each wave
// Was 4, which bows a 30 m shot by 0.85 m. Once the tracer is a visible
// ribbon rather than a hairline, a curve that size reads as a bug.
const BULLET_GRAVITY = 1.2;       // barely there, but long shots still settle

// The ammo economy: `mag` bullets per clip, at most `maxClips` clips held.
// The pistol is the only weapon with a deep clip (5); everything heavier
// carries 2 per clip, and picking the same weapon up again buys you another
// clip. Reload time scales with the weight of the thing you are racking.
// Run every clip dry and you are down to the knife.
const CLIP = 'clip';   // a pistol magazine on the floor

// Soft aim assist — MAGNETISM, not auto-aim. While you are dragging the view,
// a target inside the cone bends the drag toward itself. It never pulls your
// pitch off the head, so headshots stay yours. Off-screen threats get edge
// arrows. It runs in normal time as well as in slow motion.
//
// It used to work the other way round: hold WITHOUT correcting for 2.5 s and
// it settled the crosshair on its own. That is a camera that moves when your
// thumb does not, and it is the "jitter with enemies on screen" the playtest
// kept reporting — measured at 13.5 degrees of unasked-for rotation over five
// still seconds with a single enemy 2.2 m off-axis, and exactly zero with an
// empty corridor, which is why it only ever showed up looking at someone. It
// also bit hardest right after a freeze, because stopped time is precisely
// when you hold still for longer than 2.5 s.
//
// Coupling it to look travel instead makes the rule simple: a still thumb
// never moves the camera, and the help arrives while you are already turning.
const AIM_ASSIST_CONE = 0.3;      // radians off-crosshair where assist engages
const AIM_ASSIST_RATE = 3.5;      // gentle easing rate, at full drive
const AIM_ASSIST_RAMP = 4;        // px of look travel in a frame for full drive
const AIM_ASSIST_TAPER = 26;      // ...above this, drive falls off: a sweep PAST
                                  // a target must not stick to it
// THE ASSIST MAY NEVER OUT-TURN YOU. Its correction is proportional to how far
// OFF the target is, not to how much you are turning, so a body appearing at
// the edge of the 0.3 rad cone produced a ~1 deg-per-frame nudge on top of a
// gentle 1 deg-per-frame track -- it doubled your turn rate for a moment, which
// is a lurch, and it landed exactly when someone walked into view. Capping the
// correction at a fraction of your OWN yaw this frame makes it a nudge at every
// speed: proportional by construction, and zero when you are still.
const AIM_ASSIST_SHARE = 0.5;     // most it may add, as a fraction of your turn
let assistGain = 0;               // eased drive, so acquiring is not a step
const EDGE_ARROW_MIN = 0.34;      // bearing (rad) beyond which an enemy gets an arrow
const FOV_NORMAL = 80;
const FOV_SLOW = 66;              // bullet-time zoom

const GRAVITY = 9.8;

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// The world is NOT white. Measured off the reference: its mid-tones sit ~30%
// darker than ours with a strong cyan cast (B-R about +30), and only the
// windows and openings reach pure 255. That gap is the entire look — you
// cannot make a white opening blow out against a near-white wall, because
// there is no headroom left. So: cool, dropped surfaces; neutral clipped
// light. The background stays near-white on purpose while the fog goes
// blue-grey, so distant GEOMETRY hazes but OPENINGS stay pure.
scene.background = new THREE.Color(0xf6fcff);
scene.fog = new THREE.Fog(0xa8cadb, 24, 58);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 120);

// sky is cyan and does most of the work; the sun is a fraction of what it
// was, because the reference's shadow bands are only 0.90x their lit floor
const hemi = new THREE.HemisphereLight(0xcfeeff, 0x9cb4c2, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
// Nearly overhead (0.37,0.83,0.28) lit all four faces of a column almost
// identically, so our pillars read as flat silhouettes. Swung to the side
// they get a 2.75x ratio between adjacent vertical faces — which is what
// makes a column read as a volume you can put yourself behind.
sun.position.set(14, 9, 5);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xd6f0ff, 0.18);
fill.position.set(-6, 10, -8);
scene.add(fill);

// MUZZLE FLASH — the only thing that lights a blacked-out corridor.
//
// Created here, at boot, and never added to or removed from the scene again.
// three compiles a material's shader against the scene's LIGHT COUNT, so
// adding a light later recompiles every material in it — and doing that on
// the frame someone pulls a trigger is precisely the stall this project has
// spent two rounds hunting. They idle at zero intensity instead, which costs
// a uniform and nothing else.
//
// It cuts both ways on purpose: your shot shows you the room, and their shot
// shows you where they are. In the dark, firing is information you give as
// well as get.
const muzzleLights = [];
for (let i = 0; i < VIS.muzzleLights; i++) {
  const l = new THREE.PointLight(VIS.muzzleColor, 0, VIS.muzzleRange, 1.15);
  l.position.set(0, 1.4, 0);
  scene.add(l);
  muzzleLights.push({ l, t: 0, peak: 0, life: VIS.muzzleLife });
}
let muzzleNext = 0;
function muzzleFlash(x, y, z, scale = 1) {
  // round-robin rather than "the dimmest": a burst of shots should read as a
  // stutter of separate flashes, not as one that keeps being restarted
  const m = muzzleLights[muzzleNext++ % muzzleLights.length];
  m.l.position.set(x, y, z);
  // the life is captured per flash, not read back from VIS on the way out:
  // otherwise retuning it mid-run rescales flashes already in the air
  m.t = m.life = VIS.muzzleLife;
  const dark = condNow === 'fog' || condNow === 'blackout';
  m.peak = (dark ? VIS.muzzleDark : VIS.muzzlePlain) * scale;
}
function updateMuzzleFlashes(dtReal) {
  for (const m of muzzleLights) {
    if (m.t <= 0) { if (m.l.intensity) m.l.intensity = 0; continue; }
    m.t -= dtReal;
    // squared decay: a hard spike and a fast fall, which is what a muzzle
    // flash looks like and what keeps it from reading as a lamp
    const k = Math.max(0, m.t / m.life);
    m.l.intensity = m.peak * k * k;
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeRippleFX();
});

// ---------------------------------------------------------------------------
// Arena: floor with a faint grid, four walls, chunky white cover blocks
// ---------------------------------------------------------------------------
const MAT_WHITE = new THREE.MeshLambertMaterial({ color: 0xdfe8ec });
const MAT_RED = new THREE.MeshLambertMaterial({ color: 0xff2d1a });
const MAT_DARKRED = new THREE.MeshLambertMaterial({ color: 0xc61703 });
const MAT_BLACK = new THREE.MeshLambertMaterial({ color: 0x16181d });
const MAT_GUNMETAL = new THREE.MeshLambertMaterial({ color: 0x3a3d45 });

function makeFloorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#eef0f3';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(22,24,29,0.10)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ARENA_HALF, ARENA_HALF);
  return tex;
}

// ---------------------------------------------------------------------------
// The city. One 40m intersection cell, tiled to the horizon; towers with
// shopfront ground floors ring the arena and thin out into fogged blocks.
// ---------------------------------------------------------------------------
const CITY = {
  street: 7.5,     // road width (m) — narrow: the city presses in on the fight
  floor1: 4,       // shopfront storey height (m)
  floorH: 3,       // upper storey height (m)
  win: 0.62,       // upper window fill 0..1
  hMin: 9, hMax: 24,
  density: 0.92,   // odds a lot gets a tower — dense, few empty gaps
  fogNear: 55, fogFar: 200,
  reach: 4,        // distant rings of 40m city cells
};
const CITY_FOG_HEX = 0xc2dcea;
scene.fog = new THREE.Fog(CITY_FOG_HEX, CITY.fogNear, CITY.fogFar);

function makeStreetTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const S = 1024, ppm = S / (ARENA_HALF * 2);       // pixels per metre
  const rHalf = (CITY.street / 2) * ppm;            // road half-width
  const walk = 2.2 * ppm;                           // curb -> building face
  // block interior: plain pale slab with a faint coarse grid
  g.fillStyle = '#edeff2'; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(22,24,29,0.07)'; g.lineWidth = 2;
  for (let i = 0; i <= 16; i++) {
    g.beginPath(); g.moveTo((i / 16) * S, 0); g.lineTo((i / 16) * S, S); g.stroke();
    g.beginPath(); g.moveTo(0, (i / 16) * S); g.lineTo(S, (i / 16) * S); g.stroke();
  }
  // sidewalks: a real paved band on BOTH sides of every road, running from
  // the curb to the building faces, with transverse expansion joints
  g.fillStyle = '#e2e4e9';
  g.fillRect(S / 2 - rHalf - walk, 0, walk, S);
  g.fillRect(S / 2 + rHalf, 0, walk, S);
  g.fillRect(0, S / 2 - rHalf - walk, S, walk);
  g.fillRect(0, S / 2 + rHalf, S, walk);
  g.strokeStyle = 'rgba(22,24,29,0.16)'; g.lineWidth = 2;
  const joint = 2 * ppm;                            // a slab every 2m
  for (let p = 0; p < S; p += joint) {
    for (const x0 of [S / 2 - rHalf - walk, S / 2 + rHalf]) {
      g.beginPath(); g.moveTo(x0, p); g.lineTo(x0 + walk, p); g.stroke();
      g.beginPath(); g.moveTo(p, x0); g.lineTo(p, x0 + walk); g.stroke();
    }
  }
  // roads over the top (the intersection reads as road, not sidewalk)
  g.fillStyle = '#d2d5da';
  g.fillRect(S / 2 - rHalf, 0, rHalf * 2, S);
  g.fillRect(0, S / 2 - rHalf, S, rHalf * 2);
  // curbs: a strong line where road meets sidewalk, a faint one at the
  // building line
  for (const [off, a] of [[rHalf, 0.35], [rHalf + walk, 0.13]]) {
    g.strokeStyle = `rgba(22,24,29,${a})`; g.lineWidth = 4;
    for (const p of [S / 2 - off, S / 2 + off]) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
  }
  g.strokeStyle = 'rgba(22,24,29,0.4)'; g.lineWidth = 5;
  g.setLineDash([28, 26]);
  g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.stroke();
  g.beginPath(); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  const cw = rHalf * 2;
  for (const side of [-1, 1]) {
    const edge = S / 2 + side * (rHalf + 30) - (side < 0 ? 60 : 0);
    for (let i = 0; i < 10; i++) {
      const o = S / 2 - rHalf + 8 + i * (cw / 10);
      g.fillRect(o, edge, cw / 10 - 8, 60);
      g.fillRect(edge, o, 60, cw / 10 - 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Per-building facades in four styles pulled from NYC street references
// (all monochrome, in the game's white-world palette):
//   0 prewar masonry — paired punched windows in bays, sill lines, cornice
//   1 loft/warehouse — tall bay windows between pilasters, arched top row
//   2 glass tower    — full curtain-wall grid over a glass lobby
//   3 arched civic   — arcades of round-top windows over an arched base
function makeFacadeTexture(seed, h, style = 0) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 1024;
  const g = c.getContext('2d');
  g.scale(2, 2);   // draw in 256x512 coordinates at double resolution
  const ink = (a) => `rgba(22,24,29,${a})`;
  const RED = 'rgba(255,45,26,0.8)';
  const base = ['#f3f4f6', '#edeff2', '#e9ecef', '#f1f0ec'][style];
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 512);
  const shopH = Math.round(512 * (CITY.floor1 / h));
  const rr = (k) => rnd01(seed * 31.7 + k);
  // cornice + parapet cap
  g.fillStyle = ink(style === 2 ? 0.14 : 0.3); g.fillRect(0, 0, 256, 8);
  g.fillStyle = ink(0.16); g.fillRect(0, 9, 256, 3);
  const bodyY = 16, bodyH = 512 - shopH - bodyY - 6;
  const rows = Math.max(1, Math.round((h - CITY.floor1) / CITY.floorH));
  const rowH = bodyH / rows;

  if (style === 0) {
    // prewar masonry: 4 bays x paired windows, sills, faint pier shading
    g.fillStyle = ink(0.07);
    for (let b = 1; b < 4; b++) g.fillRect(4 + b * 62 - 5, bodyY, 5, bodyH);
    for (let y = 0; y < rows; y++) {
      const wy = bodyY + y * rowH + rowH * 0.2, wh = Math.min(rowH * 0.6, 30);
      for (let b = 0; b < 4; b++) {
        for (let i = 0; i < 2; i++) {
          const r = rr(y * 13.1 + b * 7.3 + i * 3.7);
          g.fillStyle = r > 0.965 ? RED : ink(r > 0.6 ? 0.38 : 0.24);
          g.fillRect(12 + b * 62 + i * 25, wy, 19, wh);
        }
      }
      g.fillStyle = ink(0.17);
      g.fillRect(8, wy + wh + 2, 240, 2);   // continuous sill line
    }
  } else if (style === 1) {
    // loft: 3 wide glass bays between pilasters; the top row reads arched
    for (let y = 0; y < rows; y++) {
      const wy = bodyY + y * rowH + rowH * 0.12, wh = rowH * 0.72;
      for (let b = 0; b < 3; b++) {
        const wx = 20 + b * 78;
        const r = rr(y * 11.3 + b * 5.1);
        g.fillStyle = r > 0.97 ? RED : ink(r > 0.55 ? 0.34 : 0.22);
        if (y === 0 && rows > 2) {
          const rad = 27;
          g.beginPath();
          g.moveTo(wx, wy + wh); g.lineTo(wx, wy + Math.min(rad, wh * 0.5));
          g.arc(wx + rad, wy + Math.min(rad, wh * 0.5), rad, Math.PI, 0);
          g.lineTo(wx + 54, wy + wh); g.closePath(); g.fill();
        } else {
          g.fillRect(wx, wy, 54, wh);
        }
        g.fillStyle = base;                 // sash mullions inside the bay
        g.fillRect(wx + 16, wy, 3, wh); g.fillRect(wx + 35, wy, 3, wh);
      }
      g.fillStyle = ink(0.13);
      g.fillRect(6, bodyY + (y + 1) * rowH - 2, 244, 2);   // spandrel line
    }
    g.fillStyle = ink(0.24);                // pilasters over everything
    for (let b = 0; b <= 3; b++) g.fillRect(6 + b * 78, bodyY - 2, 8, bodyH + 4);
  } else if (style === 2) {
    // glass tower: one dark sheet, panes picked out, light mullion grid
    g.fillStyle = ink(0.3); g.fillRect(4, bodyY, 248, bodyH);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < 8; x++) {
        const r = rr(y * 17.3 + x * 9.1);
        if (r > 0.78) {
          g.fillStyle = r > 0.99 ? RED : ink(r > 0.9 ? 0.48 : 0.16);
          g.fillRect(4 + x * 31, bodyY + y * rowH, 31, rowH);
        }
      }
    }
    g.fillStyle = base;
    for (let x = 0; x <= 8; x++) g.fillRect(3 + x * 31, bodyY, 2, bodyH);
    for (let y = 0; y <= rows; y++) g.fillRect(4, bodyY + Math.min(y * rowH, bodyH) - 1, 248, 2);
  } else {
    // arched civic: rows of round-top windows over string courses
    for (let y = 0; y < rows; y++) {
      const wy = bodyY + y * rowH + rowH * 0.15, wh = rowH * 0.68;
      const rad = Math.min(15, wh * 0.4);
      for (let x = 0; x < 4; x++) {
        const wx = 18 + x * 58;
        const r = rr(y * 7.7 + x * 3.1);
        g.fillStyle = r > 0.97 ? RED : ink(r > 0.6 ? 0.36 : 0.23);
        g.beginPath();
        g.moveTo(wx, wy + wh); g.lineTo(wx, wy + rad);
        g.arc(wx + rad, wy + rad, rad, Math.PI, 0);
        g.lineTo(wx + rad * 2, wy + wh); g.closePath(); g.fill();
        g.fillStyle = ink(0.12);            // arch surround
        g.fillRect(wx - 4, wy + wh + 1, rad * 2 + 8, 2);
      }
      g.fillStyle = ink(0.15);
      g.fillRect(8, bodyY + (y + 1) * rowH - 2, 240, 2);
    }
  }

  // ground floor, per style: shopfront / glass lobby / arched arcade
  const gy = 512 - shopH;
  g.fillStyle = ink(0.45); g.fillRect(0, gy - 6, 256, 8);   // string course
  if (style === 3) {
    // arcade: three tall arched openings, the middle one is the door
    for (let i = 0; i < 3; i++) {
      const ax = 20 + i * 78, aw = 62, rad = aw / 2;
      g.fillStyle = ink(i === 1 ? 0.65 : 0.3);
      g.beginPath();
      g.moveTo(ax, 512); g.lineTo(ax, gy + 12 + rad);
      g.arc(ax + rad, gy + 12 + rad, rad, Math.PI, 0);
      g.lineTo(ax + aw, 512); g.closePath(); g.fill();
    }
  } else if (style === 2) {
    // lobby: full-height glass, wide panels, one darker entry panel
    g.fillStyle = ink(0.34); g.fillRect(4, gy + 4, 248, shopH - 6);
    g.fillStyle = base;
    for (let i = 1; i < 5; i++) g.fillRect(4 + i * 50, gy + 4, 3, shopH - 6);
    g.fillStyle = ink(0.68);
    g.fillRect(4 + 2 * 50 + 6, gy + 8, 40, shopH - 10);
  } else {
    // shopfront: floor-to-ceiling glass, mullions, a recessed door
    g.fillStyle = ink(0.28); g.fillRect(6, gy + 6, 244, shopH - 8);
    g.fillStyle = base;
    for (let i = 1; i < 4; i++) g.fillRect(6 + i * 61, gy + 6, 6, shopH - 8);
    const doorX = 20 + Math.floor(rnd01(seed * 3.7) * 3) * 61;
    g.fillStyle = ink(0.7);
    g.fillRect(doorX, gy + 10, 44, shopH - 12);
  }
  const ao = g.createLinearGradient(0, 0, 0, 512);
  ao.addColorStop(0, 'rgba(22,24,29,0.08)');
  ao.addColorStop(0.22, 'rgba(22,24,29,0)');
  ao.addColorStop(0.92, 'rgba(22,24,29,0)');
  ao.addColorStop(1, 'rgba(22,24,29,0.07)');
  g.fillStyle = ao; g.fillRect(0, 0, 256, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

const CELL = ARENA_HALF * 2;
// The city tiles from a 3x3 set of UNIQUE block designs, so the pattern only
// repeats every PERIOD metres — walking reveals nine different blocks with
// their own alleys and skylines before the city rhymes. The endless-walk
// recenter shifts by a full PERIOD, so it stays pixel-invisible.
const TILE = 3;
const PERIOD = CELL * TILE;
const LIVE_BOUND = PERIOD / 2 + 30;   // bullets/missiles die past here
const streetTex = makeStreetTexture();
streetTex.repeat.set(CITY.reach * 2 + 1, CITY.reach * 2 + 1);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(CELL * (CITY.reach * 2 + 1), CELL * (CITY.reach * 2 + 1)),
  new THREE.MeshLambertMaterial({ map: streetTex })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// The city as street canyons: each block quadrant is walled off from the
// avenues by a packed row of buildings (rare slim gaps read as alley
// pockets), with a solid core plugging the block interior. Every cell is
// deterministic from one seed and identical to every other cell, so the
// endless-street recenter stays pixel-invisible — and no two buildings ever
// overlap, so walls can't z-fight (the old flickering-window bug).
const STREET_FACE = CITY.street / 2 + 2.2;   // building faces this far off the road axis

// facade pool: a dozen shared textures reused across every row building —
// per-building canvases would eat GPU memory at this density
const facadePool = [];
function facadeMat(v, h) {
  const bucket = h < 13 ? 0 : h < 19 ? 1 : h < 27 ? 2 : 3;
  const style = v % 4;   // each variant is a different reference style
  const idx = bucket * 4 + style;
  if (!facadePool[idx]) {
    facadePool[idx] = new THREE.MeshLambertMaterial({
      map: makeFacadeTexture(idx * 7.3 + 2, [11, 16, 22, 36][bucket], style),
    });
  }
  return facadePool[idx];
}

// merge helper: the whole city renders as a handful of meshes (one per
// facade variant plus one slab of plain concrete) instead of ~900 draw calls
function mergedCityMesh(boxes, mat) {
  const pos = [], norm = [], uv = [], idx = [];
  let vo = 0;
  for (const [px, py, pz, w, h, d] of boxes) {
    const g = new THREE.BoxGeometry(w, h, d);
    const pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv.array;
    for (let i = 0; i < pa.length; i += 3) {
      pos.push(pa[i] + px, pa[i + 1] + py, pa[i + 2] + pz);
      norm.push(na[i], na[i + 1], na[i + 2]);
    }
    for (let i = 0; i < ua.length; i++) uv.push(ua[i]);
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx.push(ia[i] + vo);
    vo += pa.length / 3;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  scene.add(m);
  return m;
}

const towerObstacles = [];
const cityMeshes = [];
{
  const half = CELL / 2, face = STREET_FACE;
  const buckets = new Map();           // material -> merged box list
  const put = (mat, px, pz, w, h, d, solid) => {
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push([px, h / 2, pz, w, h, d]);
    if (solid) {
      towerObstacles.push({
        min: new THREE.Vector3(px - w / 2, 0, pz - d / 2),
        max: new THREE.Vector3(px + w / 2, h, pz + d / 2),
      });
    }
  };
  const buildCell = (cx, cz, ring, si) => {
    const solid = ring <= 2;   // physics wherever the player can actually roam
    for (const [qi, [qx, qz]] of [[-1, -1], [1, -1], [-1, 1], [1, 1]].entries()) {
      let bi = qi * 37;
      if (ring <= 3) {
        // exact occupancy in quadrant-local coords (u along x, v along z):
        // nothing is ever allowed to interpenetrate anything else
        const placed = [];
        const isFree = (u0, u1, v0, v1) => {
          for (const [a0, a1, b0, b1] of placed) {
            if (u0 < a1 - 0.05 && u1 > a0 + 0.05 && v0 < b1 - 0.05 && v1 > b0 + 0.05) return false;
          }
          return true;
        };
        const putL = (mat, u0, u1, v0, v1, h) => {
          placed.push([u0, u1, v0, v1]);
          put(mat, cx + qx * ((u0 + u1) / 2), cz + qz * ((v0 + v1) / 2), u1 - u0, h, v1 - v0, solid);
        };
        // two packed street walls per quadrant, one along each avenue. The
        // corner belongs to the first wall's corner building; the second
        // wall starts past its back face.
        let corner = face;
        for (const axis of [0, 1]) {
          let cur = axis === 0 ? face : corner;
          while (cur < half - 4) {
            const w = 5 + rnd01(si * 3.1 + bi * 7.7) * 6;      // along-street
            if (cur + w > half - 1.0) break;
            const dep = 5 + rnd01(si * 5.3 + bi * 11.9) * 5;   // into the block
            if (axis === 0 && cur === face) corner = face + dep;   // seam-free corner
            let h = CITY.hMin + rnd01(si * 53.9 + bi * 29.3) * (CITY.hMax - CITY.hMin);
            if (rnd01(si * 21.1 + bi * 6.9) > 0.8) h *= 1.7;   // the odd high-rise
            const v = Math.floor(rnd01(si * 2.9 + bi * 4.7) * 4);
            const u0 = axis === 0 ? face : cur, u1 = axis === 0 ? face + dep : cur + w;
            const v0 = axis === 0 ? cur : face, v1 = axis === 0 ? cur + w : face + dep;
            if (isFree(u0, u1, v0, v1)) {
              putL(facadeMat(v, h), u0, u1, v0, v1, h);
              // back wing: a lower annex fused flush to the building's rear,
              // so interior masses read as parts of buildings, never as
              // stray blocks floating in the courtyard
              if (rnd01(si * 6.1 + bi * 3.9) < 0.75) {
                const ad = 5 + rnd01(si * 8.9 + bi * 5.3) * 8;
                const ah = Math.max(6, h * (0.5 + rnd01(si * 12.7 + bi * 7.1) * 0.35));
                const aw = w * (0.6 + rnd01(si * 3.3 + bi * 9.7) * 0.3);
                const o = (w - aw) * rnd01(si * 7.7 + bi * 1.9);
                const b0 = axis === 0 ? face + dep : cur + o;
                const b1 = Math.min(axis === 0 ? face + dep + ad : cur + o + aw, half);
                const c0 = axis === 0 ? cur + o : face + dep;
                const c1 = Math.min(axis === 0 ? cur + o + aw : face + dep + ad, half);
                if (b1 - b0 > 1.5 && c1 - c0 > 1.5 && isFree(b0, b1, c0, c1)) {
                  putL(facadeMat(v, ah), b0, b1, c0, c1, ah);
                }
              }
            }
            // party walls: buildings abut flush unless the gap is a REAL
            // alley — no more senseless 40cm slits between towers
            cur += w + (rnd01(si * 1.7 + bi * 13.3) < 0.32
              ? 2.0 + rnd01(si * 2.3 + bi * 4.1) * 1.0 : 0);
            bi++;
          }
        }
      } else {
        // far ring: two chunky slabs per quadrant — silhouette in the fog
        for (const axis of [0, 1]) {
          let h = CITY.hMin + rnd01(si * 9.1 + qi * 3.7 + axis * 5.9) * (CITY.hMax - CITY.hMin);
          if (rnd01(si * 4.3 + qi * 9.1 + axis * 2.7) > 0.7) h *= 1.7;   // skyline spikes
          if (axis === 0) put(MAT_WHITE, cx + qx * (face + 4.5), cz + qz * ((face + half) / 2), 9, h, half - face, false);
          else put(MAT_WHITE, cx + qx * ((face + half) / 2), cz + qz * (face + 4.5), half - face, h, 9, false);
        }
      }
    }
  };
  for (let gx = -CITY.reach; gx <= CITY.reach; gx++) {
    for (let gz = -CITY.reach; gz <= CITY.reach; gz++) {
      const si = 60 + (((gx % TILE) + TILE) % TILE) * 7 + (((gz % TILE) + TILE) % TILE) * 29;
      buildCell(gx * CELL, gz * CELL, Math.max(Math.abs(gx), Math.abs(gz)), si);
    }
  }
  for (const [mat, boxes] of buckets) cityMeshes.push(mergedCityMesh(boxes, mat));
}

// The streets ARE the arena: the only solid things in the world are the
// city towers, and they never change or move — no more cover blocks popping
// in and out between waves.
const obstacles = [];
function setLayout() {
  obstacles.length = 0;
  for (const t of towerObstacles) obstacles.push(t);
}
setLayout();

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _vMuz = new THREE.Vector3();

// Squared distance between segments p1->q1 and p2->q2 (Ericson, RTCD 5.1.9).
// Pure scalar math — must not touch the shared _v* scratch vectors, since
// callers pass those in as arguments.
function segSegDistSq(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) return rx * rx + ry * ry + rz * rz;
  if (a <= 1e-9) { s = 0; t = clamp01(f / e); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) { t = 0; s = clamp01(-c / a); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const dx = (p1.x + d1x * s) - (p2.x + d2x * t);
  const dy = (p1.y + d1y * s) - (p2.y + d2y * t);
  const dz = (p1.z + d1z * s) - (p2.z + d2z * t);
  return dx * dx + dy * dy + dz * dz;
}

// Squared distance from point c to segment p->q.
function segPointDistSq(p, q, cx, cy, cz) {
  const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 1e-9 ? ((cx - p.x) * dx + (cy - p.y) * dy + (cz - p.z) * dz) / len2 : 0;
  t = Math.min(Math.max(t, 0), 1);
  const ex = p.x + dx * t - cx, ey = p.y + dy * t - cy, ez = p.z + dz * t - cz;
  return ex * ex + ey * ey + ez * ez;
}

// Segment vs AABB (slab test). Returns entry fraction [0,1] or -1.
function segAABB(p, q, box) {
  let tmin = 0, tmax = 1;
  const d = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-9) {
      if (p[ax] < box.min[ax] || p[ax] > box.max[ax]) return -1;
    } else {
      let t1 = (box.min[ax] - p[ax]) / d[ax];
      let t2 = (box.max[ax] - p[ax]) / d[ax];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

function hasLineOfSight(a, b) {
  for (const o of obstacles) if (segAABB(a, b, o) >= 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Faceted polygon wordmark — custom angular letterforms where every stroke is
// a red facet lit from the upper-left, like low-poly cut glass. Used for the
// menu title (with a periodic shimmer sweep) and the kill-flash words.
// ---------------------------------------------------------------------------
const SHIMMER_FIRST_DELAY = 1;   // seconds after the menu appears
const SHIMMER_INTERVAL = 5;      // seconds of rest after a sweep finishes
const SHIMMER_DUR = 1.2;         // seconds for the light band to cross

const LFONT = {
  widths: { S: 80, H: 80, A: 80, R: 80, D: 80, T: 80, I: 36, M: 96, E: 72 },
  gap: 16,
  letters: {
    S: [
      [[10,0],[80,0],[80,24],[0,24],[0,10]],
      [[0,10],[24,10],[24,62],[0,62]],
      [[0,38],[80,38],[80,62],[0,62]],
      [[56,38],[80,38],[80,90],[56,90]],
      [[0,76],[80,76],[80,90],[70,100],[0,100]],
    ],
    H: [
      [[0,10],[10,0],[24,0],[24,100],[0,100]],
      [[56,0],[80,0],[80,90],[70,100],[56,100]],
      [[0,38],[80,38],[80,62],[0,62]],
    ],
    A: [
      [[28,0],[52,0],[24,100],[0,100]],
      [[28,0],[52,0],[80,100],[56,100]],
      [[16,62],[64,62],[68,84],[12,84]],
    ],
    R: [
      [[0,0],[24,0],[24,100],[10,100],[0,90]],
      [[0,0],[58,0],[80,18],[80,24],[0,24]],
      [[56,10],[80,18],[80,44],[56,52]],
      [[0,38],[70,38],[62,60],[0,60]],
      [[38,52],[62,52],[80,92],[80,100],[58,100]],
    ],
    D: [
      [[0,10],[10,0],[24,0],[24,100],[10,100],[0,90]],
      [[0,0],[54,0],[68,24],[0,24]],
      [[0,76],[68,76],[54,100],[0,100]],
      [[52,8],[80,30],[80,70],[52,92]],
    ],
    T: [
      [[0,10],[10,0],[70,0],[80,10],[80,24],[0,24]],
      [[28,24],[52,24],[52,92],[44,100],[28,100]],
    ],
    I: [
      [[4,8],[12,0],[32,0],[32,94],[26,100],[4,100]],
    ],
    M: [
      [[0,10],[10,0],[24,0],[24,100],[0,100]],
      [[72,0],[86,0],[96,10],[96,100],[72,100]],
      [[14,0],[32,0],[56,60],[44,82]],
      [[64,0],[82,0],[52,82],[40,60]],
    ],
    E: [
      [[0,10],[10,0],[24,0],[24,100],[10,100],[0,90]],
      [[0,0],[62,0],[72,10],[72,24],[0,24]],
      [[0,38],[58,38],[58,60],[0,60]],
      [[0,76],[72,76],[72,90],[62,100],[0,100]],
    ],
  },
};

// highlight -> deep shadow, lit from the upper-left
const TONES = ['#ff8f6e', '#ff5a3c', '#ff2d1a', '#e01505', '#b81205', '#8f0d02'];

function mixColor(hexA, hexB, k) {
  const c = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const a = c(hexA), b = c(hexB);
  return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',') + ')';
}

function buildWordSVG(word, height) {
  const polys = [];
  let dx = 0;
  for (const ch of word) {
    for (const poly of LFONT.letters[ch]) {
      polys.push(poly.map((p) => [p[0] + dx, p[1]]));
    }
    dx += LFONT.widths[ch] + LFONT.gap;
  }
  const W = dx - LFONT.gap;
  let inner = '';
  let n = 0;
  for (const poly of polys) {
    let cx = 0, cy = 0;
    for (const p of poly) { cx += p[0]; cy += p[1]; }
    cx /= poly.length; cy /= poly.length;
    const lit = (cx / W) * 0.6 + (cy / 100) * 0.4;
    const jit = Math.abs((Math.sin(++n * 127.1) * 43758.5453) % 1);
    const tone = Math.max(0, Math.min(TONES.length - 1, Math.floor(lit * 4.2 + jit * 2.2 - 0.6)));
    inner += `<polygon points="${poly.map((p) => p[0] + ',' + p[1]).join(' ')}" ` +
      `data-cx="${cx.toFixed(1)}" data-cy="${cy.toFixed(1)}" data-tone="${tone}" fill="${TONES[tone]}"/>`;
  }
  const w = Math.round(W * height / 100);
  return {
    svg: `<svg width="${w}" height="${height}" viewBox="0 0 ${W} 100" overflow="visible">${inner}</svg>`,
    W,
  };
}

// menu-title shimmer state
let titleFacets = [];
let titleW = 464;
let shimmerAt = Infinity;

function collectTitleFacets() {
  const h1 = document.querySelector('#overlay h1');
  titleFacets = [...h1.querySelectorAll('svg polygon')].map((p) => ({
    el: p, cx: +p.dataset.cx, cy: +p.dataset.cy, tone: +p.dataset.tone,
  }));
}

function updateShimmer(nowSec) {
  if (nowSec < shimmerAt || !titleFacets.length) return;
  const p = (nowSec - shimmerAt) / SHIMMER_DUR;
  if (p >= 1) {   // sweep done: settle and schedule the next one
    for (const f of titleFacets) f.el.setAttribute('fill', TONES[f.tone]);
    shimmerAt = nowSec + SHIMMER_INTERVAL;
    return;
  }
  const bandX = -180 + p * (titleW + 360);
  for (const f of titleFacets) {
    const d = Math.abs(f.cx - bandX + (f.cy - 50) * 0.45);
    const boost = Math.exp(-((d / 85) ** 2));
    f.el.setAttribute('fill', boost > 0.02 ? mixColor(TONES[f.tone], '#ffe3d6', boost * 0.75) : TONES[f.tone]);
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const player = {
  pos: new THREE.Vector3(0, 0, 14),
  vel: new THREE.Vector3(),   // smoothed body velocity (the dodge feel)
  yaw: 0,                     // yaw 0 looks down -Z, toward the arena center
  pitch: 0,
  roll: 0,                    // subtle strafe lean
  iframes: 0,
  fireCd: 0,
  weapon: 'pistol',
  clips: 3,
  mag: 5,
  reloadT: 0,
  alive: true,
};

// Endless streets: the city is periodic per 40m block, so when the player
// crosses a block boundary we quietly shift the whole fight back one block.
function shiftWorld(ax, d) {
  player.pos[ax] += d;
  for (const e of enemies) { e.pos[ax] += d; if (e.beam) e.beam.g.position[ax] += d; }
  for (const n of crowd) n.pos[ax] += d;
  for (const b of bullets) { b.pos[ax] += d; b.prev[ax] += d; }
  for (const p2 of pickups) p2.g.position[ax] += d;
  for (const k of marks) k.m.position[ax] += d;
  for (const d2 of npcDebris) d2.m.position[ax] += d;
  for (const g2 of grenades) { g2.pos[ax] += d; if (g2.mesh && g2.mesh.position !== g2.pos) g2.mesh.position[ax] += d; if (g2.ring && g2.ring.position !== g2.pos) g2.ring.position[ax] += d; }
  for (const m2 of missiles) { m2.pos[ax] += d; if (m2.mesh && m2.mesh.position !== m2.pos) m2.mesh.position[ax] += d; }
  for (const s2 of shells) { s2.pos[ax] += d; s2.prev[ax] += d; s2.mesh.position[ax] += d; }
}
function recenterWorld() {
  if (game.mode === 'hall') return;   // the hallway is not periodic
  for (const ax of ['x', 'z']) {
    if (Math.abs(player.pos[ax]) > PERIOD / 2) shiftWorld(ax, -Math.sign(player.pos[ax]) * PERIOD);
  }
}
function resolvePlayerCollisions() {
  const p = player.pos;
  // no walls: the player may walk forever — the world recenters around them
  for (const o of obstacles) {
    const ex = PLAYER_RADIUS;
    if (p.x > o.min.x - ex && p.x < o.max.x + ex && p.z > o.min.z - ex && p.z < o.max.z + ex) {
      // push out along the axis of least penetration
      const dxl = p.x - (o.min.x - ex), dxr = (o.max.x + ex) - p.x;
      const dzl = p.z - (o.min.z - ex), dzr = (o.max.z + ex) - p.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) p.x = o.min.x - ex;
      else if (m === dxr) p.x = o.max.x + ex;
      else if (m === dzl) p.z = o.min.z - ex;
      else p.z = o.max.z + ex;
    }
  }
}

// ---------------------------------------------------------------------------
// Viewmodels (black, boxy pistol & double-barrel shotgun) + muzzle flash
// ---------------------------------------------------------------------------
const gun = new THREE.Group();

const pistolVM = new THREE.Group();
{
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.34), MAT_BLACK);
  slide.position.set(0, 0.02, -0.1);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), MAT_BLACK);
  grip.position.set(0, -0.09, 0.03);
  grip.rotation.x = 0.28;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.1), MAT_BLACK);
  guard.position.set(0, -0.035, -0.05);
  pistolVM.add(slide, grip, guard);
}

const shotgunVM = new THREE.Group();
{
  const barrelL = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.52), MAT_BLACK);
  barrelL.position.set(-0.026, 0.03, -0.2);
  const barrelR = barrelL.clone();
  barrelR.position.x = 0.026;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.18), MAT_BLACK);
  receiver.position.set(0, 0.01, 0.1);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.08), MAT_BLACK);
  grip.position.set(0, -0.09, 0.16);
  grip.rotation.x = 0.35;
  shotgunVM.add(barrelL, barrelR, receiver, grip);
}
shotgunVM.visible = false;

const sniperVM = new THREE.Group();
{
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, 0.85), MAT_BLACK);
  barrel.position.set(0, 0.02, -0.32);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.32), MAT_BLACK);
  body.position.set(0, 0, 0.05);
  const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), MAT_GUNMETAL);
  scope.position.set(0, 0.09, 0.02);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.08), MAT_BLACK);
  grip.position.set(0, -0.1, 0.14);
  grip.rotation.x = 0.3;
  sniperVM.add(barrel, body, scope, grip);
  // canted slightly inward so the long barrel shows in profile at rest —
  // dead-straight it foreshortens to almost nothing and looks unequipped
  sniperVM.rotation.y = 0;      // group yaw supplies the flank reveal
  sniperVM.rotation.x = -0.02;
}
sniperVM.visible = false;

// BURST: boxy machine pistol with a stick magazine — clearly not the pistol
const burstVM = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.085, 0.42), MAT_BLACK);
  body.position.set(0, 0.015, -0.12);
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.14), MAT_GUNMETAL);
  vent.position.set(0, 0.045, -0.3);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.19, 0.06), MAT_BLACK);
  mag.position.set(0, -0.11, -0.02);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.075), MAT_BLACK);
  grip.position.set(0, -0.09, 0.14);
  grip.rotation.x = 0.3;
  burstVM.add(body, vent, mag, grip);
}
burstVM.visible = false;

// LAUNCHER: fat stubby tube with a drum — reads nothing like the shotgun
const launcherVM = new THREE.Group();
{
  const tube = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.115, 0.46), MAT_BLACK);
  tube.position.set(0, 0.03, -0.2);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.07), MAT_GUNMETAL);
  mouth.position.set(0, 0.03, -0.42);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), MAT_BLACK);
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0, -0.01, 0.04);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), MAT_BLACK);
  grip.position.set(0, -0.11, 0.14);
  grip.rotation.x = 0.3;
  launcherVM.add(tube, mouth, drum, grip);
}
launcherVM.visible = false;

// ROCKET: long shoulder tube with a rear venturi and a top sight
const rocketVM = new THREE.Group();
{
  const tube = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.95), MAT_BLACK);
  tube.position.set(0, 0.05, -0.24);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.09), MAT_GUNMETAL);
  mouth.position.set(0, 0.05, -0.7);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.1), MAT_GUNMETAL);
  rear.position.set(0, 0.05, 0.22);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.12), MAT_GUNMETAL);
  sight.position.set(0, 0.14, -0.16);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.08), MAT_BLACK);
  grip.position.set(0, -0.05, 0.02);
  grip.rotation.x = 0.28;
  rocketVM.add(tube, mouth, rear, sight, grip);
  rocketVM.rotation.y = 0;      // group yaw supplies the flank reveal
}
rocketVM.visible = false;

// KNIFE: a short blade held low — no barrel, nothing to aim, all reach
const knifeVM = new THREE.Group();
{
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.3), MAT_GUNMETAL);
  blade.position.set(0, 0.01, -0.16);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.08), MAT_GUNMETAL);
  tip.position.set(0, 0.01, -0.34);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.02), MAT_BLACK);
  guard.position.set(0, 0, -0.02);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 0.13), MAT_BLACK);
  handle.position.set(0, -0.01, 0.06);
  knifeVM.add(blade, tip, guard, handle);
  knifeVM.rotation.y = -0.04;   // a blade wants less reveal than a slide
  knifeVM.rotation.z = -0.12;
}
knifeVM.visible = false;
gun.add(pistolVM, shotgunVM, sniperVM, burstVM, launcherVM, rocketVM, knifeVM);
// camera-attached meshes must never be frustum-culled: a stale bound can
// blink the equipped gun out of existence
gun.traverse((o) => { o.frustumCulled = false; });

const muzzle = new THREE.Mesh(
  new THREE.SphereGeometry(0.045, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0 })
);
muzzle.position.set(0, 0.02, -0.3);
gun.add(muzzle);
// THE VIEWMODEL BASE POSE, in one place: it is read by the init and by both
// branches of the per-frame rig, and three hand-copied literals drift.
//
// The reference gun looks canted about 42 degrees, and the obvious reading —
// that the model is rolled — is wrong. Measured, its roll and yaw are both
// effectively ZERO; the cant is pure perspective, from sitting 16 degrees
// off-axis inside a 91-degree field. We cannot buy that offset in portrait:
// 16 degrees of our 42-degree horizontal field puts the gun on top of the
// time button. So we fake the same reveal with yaw — and the old -0.06
// yawed it the wrong way, cancelling what little our 5.7-degree offset gave
// and projecting the pistol as a featureless slab. Turning it inward widens
// the silhouette by 116% with nothing else changed.
const VM = { x: 0.045, y: -0.215, z: -0.5, s: 0.66, yaw: 0.2 };
// The held weapon gets its own materials so it can be reflective without
// making every gun in the world reflective. Phong rather than Lambert: a
// gun needs a moving highlight, and Lambert has no specular term at all.
// The env map is a tiny painted equirect — bright ceiling, mid walls, dark
// floor, with two hot bands where the strips are. Because the viewmodel is
// parented to the camera, its world normals swing as you look around, so
// the reflection sweeps across the slide instead of sitting still on it.
const vmEnv = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  // A HARD horizon, not a gradient. A smooth falloff lifted every side face
  // of the gun toward grey, which is what made it read as a solid slab: the
  // slab was the SIDES, not the top. Above the line is ceiling and it is
  // white; below it is corridor and it is essentially black. So an up-facing
  // surface — the top of the slide, the top of the grip — catches a hard
  // white glint that slides across it as you turn, and every other face on
  // the weapon stays black.
  g.fillStyle = '#05070a'; g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#c8dae2'; g.fillRect(0, 0, 64, 8);       // the ceiling plane
  // ...but the real ceiling is STRIPS with dark between them, and that is
  // what makes the glint move. A uniform white band reflects as a painted
  // stripe that never changes; broken bands sweep across the slide as you
  // turn, which is the difference between a highlight and a decal.
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 2, 0, 9, 8);
  g.fillStyle = '#5d7480';
  for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 12, 1, 4, 6);
  g.fillStyle = '#7e939e'; g.fillRect(0, 8, 64, 2);       // the wall tops
  g.fillStyle = '#151d23'; g.fillRect(0, 10, 64, 5);      // wall
  // Two bright strips just under the horizon so a NEARLY-level face can also
  // catch something — that is the light running away down the corridor, and
  // it is what keeps the barrel from going dead when you look level.
  g.fillStyle = '#e8f4f8';
  g.fillRect(0, 11, 64, 1);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 8; i++) g.fillRect(i * 8, 13, 5, 1);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
})();
// The gun stays BLACK. Mixing the environment into the base colour lifted
// it to a grey slab and lost the silhouette, which is the thing that made it
// readable in the first place. AddOperation instead: black stays black
// everywhere the reflection is dark, and only the bright parts of the
// environment — the ceiling strips — actually land on the metal. Reflectivity
// is lower and the specular is pure white and tighter, so what you see is a
// hard highlight sliding over a black shape, not a tinted one.
// Black bodies, white glints. AddOperation means the environment can only
// ever ADD light, so the gun cannot be tinted grey — it stays black wherever
// what it reflects is dark, and the reflectivity can be pushed hard because
// the only bright thing in the map is the ceiling.
const VM_BLACK = new THREE.MeshPhongMaterial({
  color: 0x07090b, specular: 0xffffff, shininess: 260,
  envMap: vmEnv, reflectivity: 0.95, combine: THREE.AddOperation,
});
const VM_GUNMETAL = new THREE.MeshPhongMaterial({
  color: 0x0e1216, specular: 0xffffff, shininess: 300,
  envMap: vmEnv, reflectivity: 1.0, combine: THREE.AddOperation,
});
gun.traverse((o) => {
  if (!o.isMesh) return;
  if (o.material === MAT_BLACK) o.material = VM_BLACK;
  else if (o.material === MAT_GUNMETAL) o.material = VM_GUNMETAL;
});

gun.scale.setScalar(VM.s);
gun.rotation.y = VM.yaw;
gun.position.set(VM.x, VM.y, VM.z);   // anchored low: the reference's is clipped by the frame edge
camera.add(gun);
scene.add(camera);
let gunKick = 0;
// the knife has no recoil to model: it has a stroke. jabT runs 1 -> 0 over
// one thrust and drives its own animation path, separate from the gun rig.
let jabT = 0;

function setWeapon(type, clips) {
  const spec = WEAPONS[type];
  player.weapon = type;
  player.clips = clips !== undefined ? clips : (type === 'knife' ? 0 : 1);
  player.mag = spec.mag === Infinity ? Infinity : spec.mag;
  player.reloadT = 0;
  pistolVM.visible = type === 'pistol';
  shotgunVM.visible = type === 'shotgun';
  sniperVM.visible = type === 'sniper';
  burstVM.visible = type === 'burst';
  launcherVM.visible = type === 'launcher';
  rocketVM.visible = type === 'rocket';
  knifeVM.visible = type === 'knife';
  updateAmmoHud();
}

// Picking a weapon off the floor: a fresh one if it is new, another clip if
// you already carry it (capped), and a pistol clip just tops the pistol up.
function takePickup(type) {
  recordMet([type === CLIP ? 'pistol' : type]);   // ids match the registry's
  if (type === CLIP) {
    if (player.weapon === 'pistol') {
      player.clips = Math.min(WEAPONS.pistol.maxClips, player.clips + 1);
      updateAmmoHud();
    } else {
      setWeapon('pistol', 1);   // back to the sidearm with a fresh clip
    }
    return;
  }
  const spec = WEAPONS[type];
  if (player.weapon === type) {
    player.clips = Math.min(spec.maxClips, player.clips + 1);
    updateAmmoHud();
  } else {
    setWeapon(type, 1);
  }
}

// Out of everything: the knife. Lethal, silent, and it demands you close
// the distance — which is the point.
function dropToKnife() {
  recordMet(['knife']);
  setWeapon('knife', 0);
  showBanner('KNIFE ONLY', 1700);
  vibrate([40, 40, 40]);
}

// A reload is the risk you take: seconds where all you can do is dodge.
// It runs on REAL time, so freezing the world does not refill your gun.
function startReload() {
  const spec = WEAPONS[player.weapon];
  if (player.reloadT > 0 || spec.mag === Infinity) return;
  if (player.mag >= spec.mag) return;
  if (player.clips <= 0) {
    if (player.mag <= 0) dropToKnife();
    return;
  }
  player.reloadT = spec.reload;
  sfx.pickup();
  updateAmmoHud();
}
function updateReload(dt) {
  if (player.reloadT <= 0) {
    if (el.reloadbar.style.display !== 'none') el.reloadbar.style.display = 'none';
    return;
  }
  const spec = WEAPONS[player.weapon];
  el.reloadbar.style.display = 'block';
  el.reloadfill.style.width = Math.max(0, Math.min(1, player.reloadT / spec.reload)) * 100 + '%';
  player.reloadT -= dt;
  if (player.reloadT <= 0) {
    player.reloadT = 0;
    player.clips--;
    player.mag = spec.mag;
    vibrate(12);
  }
  updateAmmoHud();
}

// ---------------------------------------------------------------------------
// Bullets — simple projectile physics with swept capsule collision
// ---------------------------------------------------------------------------
const bullets = [];   // {mesh, trail, pos, vel, prev, fromPlayer, life}
const bulletGeo = new THREE.SphereGeometry(0.04, 8, 8);
// A ROUND, not a ball. Lathed ogive profile — flat base, straight shank,
// curved nose — spun about Y, then tipped so its axis is +Z, which is the
// axis we align to velocity every frame.
const bulletShapeGeo = (() => {
  const pts = [];
  pts.push(new THREE.Vector2(0, -0.5));
  pts.push(new THREE.Vector2(1, -0.5));
  pts.push(new THREE.Vector2(1, 0.05));
  for (let i = 1; i <= 5; i++) {          // the nose
    const t = i / 5;
    pts.push(new THREE.Vector2(Math.cos(t * Math.PI / 2) * 1, 0.05 + t * 0.45));
  }
  const g = new THREE.LatheGeometry(pts, 10);
  g.rotateX(Math.PI / 2);                 // axis +Y -> +Z
  return g;
})();
const AXIS_Z = new THREE.Vector3(0, 0, 1);
// its own scratch: spawnBullet's callers pass _v2/_v3-derived vectors
const _vBul = new THREE.Vector3();
// one shared head-to-tail alpha ramp for every tracer ribbon
const trailTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 1;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');      // tail
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');      // head
  g.fillStyle = grad; g.fillRect(0, 0, 64, 1);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
})();
function makeTrailGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(
    new Float32Array([1, 0, 1, 1, 0, 0, 0, 1]), 2));   // u=1 head, u=0 tail
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);   // never cull
  return g;
}
const bulletMatP = new THREE.MeshBasicMaterial({ color: 0x16181d });

// bullet scars: temporary marks where rounds strike walls and cover
// ---------------------------------------------------------------------------
// MATERIAL POOLS — the "screen locks for a second, then jumps" bug.
//
// Ripples, bullet marks and grenade rings each built a fresh material and
// DISPOSED it when the effect died. three.js refcounts shader programs by how
// many live materials use them, so the moment the last ripple expired that
// program's count hit zero and the program was deleted — and the next shot
// linked it again from source. Measured over a real session: the program
// count cycles 16 -> 15 -> 16 -> 15 for the whole run.
//
// A GL link is sub-millisecond on this desktop and can be hundreds of
// milliseconds on a phone, and it blocks the GL thread. Look is applied in
// the pointer handler rather than in the frame loop, so the camera keeps
// ACCUMULATING rotation right through the stall and then delivers all of it
// on the frame that finally lands. That is exactly "the screen locks for a
// second, then jumps" — and it is worst around slow-mo, because a ripple
// lives 0.8 s of WORLD time, which at the 0.05x scale is sixteen real
// seconds: the pool drains between fights and every re-entry pays the link.
//
// So effect materials are never disposed. They are returned here and reused,
// which keeps every program's refcount above zero for the life of the page.
// ---------------------------------------------------------------------------
const matPools = new Map();
function takeMat(kind, make) {
  const pool = matPools.get(kind);
  return (pool && pool.length) ? pool.pop() : make();
}
function freeMat(kind, m) {
  let pool = matPools.get(kind);
  if (!pool) matPools.set(kind, pool = []);
  // Every caller already caps its own effect count (70 marks, 90 ripples), so
  // this ceiling is a runaway guard rather than a working limit.
  if (pool.length < 256) pool.push(m);
}

const markGeo = new THREE.PlaneGeometry(0.15, 0.15);
const marks = [];
function addBulletMark(b, at) {
  const p = (at || b.pos).clone();
  const mat = takeMat('mark', () =>
    new THREE.MeshBasicMaterial({ color: 0x16181d, transparent: true, opacity: 0.38 }));
  mat.opacity = 0.38;
  const m = new THREE.Mesh(markGeo, mat);
  m.position.copy(p).addScaledVector(_v1.copy(b.vel).normalize(), -0.03);
  m.lookAt(m.position.x - b.vel.x, m.position.y - b.vel.y, m.position.z - b.vel.z);
  marks.push({ m, t: 0 });
  scene.add(m);
  if (marks.length > 70) {
    scene.remove(marks[0].m); freeMat('mark', marks[0].m.material); marks.shift();
  }
}
function updateMarks(dt2) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const k = marks[i]; k.t += dt2;
    k.m.material.opacity = 0.38 * Math.max(0, 1 - k.t / 10);
    if (k.t >= 10) { scene.remove(k.m); freeMat('mark', k.m.material); marks.splice(i, 1); }
  }
}
const bulletMatE = new THREE.MeshBasicMaterial({ color: 0xff2d1a });
const bulletMatCore = new THREE.MeshBasicMaterial({ color: 0xffffff });
const bulletMatHalo = new THREE.MeshBasicMaterial({
  color: 0xff2d1a, transparent: true, opacity: 0.22, depthWrite: false,
});

// fromPlayer: opt = absolute speed (m/s), pierce = enemies it can pass through
// enemy fire: opt = multiplier on the wave-scaled base speed
function spawnBullet(pos, dir, fromPlayer, opt = 0, pierce = 0) {
  const mesh = new THREE.Mesh(bulletShapeGeo, fromPlayer ? bulletMatP : bulletMatE);
  mesh.position.copy(pos);
  mesh.quaternion.setFromUnitVectors(AXIS_Z, _vBul.copy(dir).normalize());
  if (fromPlayer) mesh.scale.set(0.05, 0.05, 0.13);
  else {
    // enemy shots are the thing you dodge — keep them big enough to read at
    // arm's length on a phone, with a white-hot nose and a soft halo
    mesh.scale.set(0.085, 0.085, 0.3);
    const core = new THREE.Mesh(bulletShapeGeo, bulletMatCore);
    core.scale.set(0.45, 0.45, 0.5);
    core.position.z = 0.18;                  // the nose, not the whole round
    const halo = new THREE.Mesh(bulletShapeGeo, bulletMatHalo);
    halo.scale.set(1.9, 1.9, 1.25);
    mesh.add(core, halo);
  }
  scene.add(mesh);
  // TRACER RIBBON. This was a THREE.Line, and linewidth is a documented
  // no-op in WebGL — it drew a single device pixel, half a CSS pixel at
  // DPR 2, which is why incoming fire was so hard to read. It is now a
  // camera-facing quad that tapers head to tail, so a lane of fire is a
  // shape on screen rather than a hairline.
  const trail = new THREE.Mesh(makeTrailGeo(), new THREE.MeshBasicMaterial({
    color: fromPlayer ? 0x16181d : 0xf41111,
    map: trailTex, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, opacity: fromPlayer ? 0.5 : 0.95,
  }));
  scene.add(trail);
  const speed = fromPlayer
    ? (opt || PLAYER_BULLET_SPEED)
    : enemyBulletSpeed() * (opt || 1);
  bullets.push({
    mesh, trail,
    pos: pos.clone(), prev: pos.clone(),
    vel: dir.clone().multiplyScalar(speed),
    fromPlayer, pierce, life: 6, rippleAcc: 0,
    whoosh: fromPlayer ? null : sfx.attachWhoosh(),   // incoming rounds sing
  });
}

function killBullet(i, sparkAt) {
  const b = bullets[i];
  if (b.whoosh) sfx.detachWhoosh(b.whoosh);
  scene.remove(b.mesh); scene.remove(b.trail);
  b.trail.geometry.dispose();
  if (sparkAt) spawnSparks(sparkAt, b.fromPlayer ? 0x16181d : 0xff2d1a);
  bullets.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Ripples — bullets push expanding rings through the air like a wake through
// water. Spawned by distance travelled, so the wake hangs in frozen time.
// ---------------------------------------------------------------------------
const rippleGeo = new THREE.RingGeometry(0.82, 1, 24);
const ripples = [];   // {mesh, life, maxLife, grow}

// ---------------------------------------------------------------------------
// RIPPLE REFRACTION
//
// The wake rings are shockwaves in air, so they should bend what is behind
// them, not just draw over it. That needs the frame as a texture, which
// means one post pass — the only one in the game, and the project's rule
// against postprocessing was written about BLOOM, which we still fake with
// emissive geometry and still will.
//
// It pays for itself only when there is something to refract: with no live
// ripples the scene renders straight to the screen and this costs nothing
// at all. When it is on, it is a single full-screen quad — the scene is
// rendered once, into a target, never twice.
//
// The distortion is deliberately NOT depth-aware. Making it so would need a
// depth texture and a second sampler; at our scale a ring bending a wall
// slightly in front of it is invisible, and the cost is not.
// Four, not more: rings grow, and a ring near the camera can cover half the
// screen on its own, so the cost here is FILL, not ring count.
const RIPPLE_FX_MAX = 4;          // strongest N rings; the rest just draw
let rippleRT = null, fxScene = null, fxCam = null, fxBlit = null;
let fxQuads = [], fxOn = true, fxSlowT = 0;
// The canvas is sRGB; the render target is not. Every pass that draws the
// target to the screen has to do this conversion itself.
const LINEAR_TO_SRGB = `
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055,
               step(vec3(0.0031308), c));
  }
`;
const RIPPLE_FX_SRC = `
  precision mediump float;
  uniform sampler2D tDiffuse;
  uniform vec2 uRes;
  uniform float uAspect;
  uniform vec4 uR;            // xy = screen centre (0..1), z = radius, w = strength
  ${LINEAR_TO_SRGB}
  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 d = vec2((uv.x - uR.x) * uAspect, uv.y - uR.y);
    float dist = length(d);
    float w = uR.z * 0.42 + 0.012;
    float band = 1.0 - smoothstep(0.0, w, abs(dist - uR.z));
    vec2 n = dist > 1e-5 ? d / dist : vec2(0.0, 1.0);
    // outward ahead of the crest, inward behind it: a real wavefront, not a bulge
    float lobe = sin(clamp((dist - uR.z) / w, -1.0, 1.0) * 3.14159);
    vec2 suv = uv + vec2(n.x / uAspect, n.y) * lobe * band * uR.w;
    vec4 c = texture2D(tDiffuse, suv);
    float blur = band * uR.w;
    if (blur > 0.0005) {   // air you cannot quite focus through
      float o = blur * 0.8;
      c += texture2D(tDiffuse, suv + vec2(o, o));
      c += texture2D(tDiffuse, suv - vec2(o, o));
      c *= 0.3333;
    }
    gl_FragColor = vec4(toSRGB(c.rgb), 1.0);
  }
`;
function initRippleFX() {
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  rippleRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
  });
  // The render target holds LINEAR light — three only applies the output
  // colour transform when it draws to the canvas, not into a target. So both
  // of our passes below encode it themselves on the way out. Doing it here
  // by tagging the texture does not work: it makes the sampler DECODE on
  // read instead, which darkens the frame a second time.
  fxCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  fxScene = new THREE.Scene();
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  // the base image: one texture fetch per pixel, nothing else
  fxBlit = new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: rippleRT.texture } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      ${LINEAR_TO_SRGB}
      void main() { gl_FragColor = vec4(toSRGB(texture2D(tDiffuse, vUv).rgb), 1.0); }
    `,
    depthTest: false, depthWrite: false,
  }));
  fxBlit.frustumCulled = false;
  fxBlit.renderOrder = 0;
  fxScene.add(fxBlit);
  // ...then one small quad per ring, covering ONLY that ring's annulus. The
  // first version ran the whole ring set as a loop over every pixel on the
  // screen, and measured twice the cost of the render target itself.
  for (let i = 0; i < RIPPLE_FX_MAX; i++) {
    const m = new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rippleRT.texture },
        uRes: { value: new THREE.Vector2(size.x, size.y) },
        uAspect: { value: size.x / size.y },
        uR: { value: new THREE.Vector4() },
      },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: RIPPLE_FX_SRC,
      depthTest: false, depthWrite: false,
    }));
    m.frustumCulled = false;
    m.renderOrder = 1 + i;
    m.visible = false;
    fxScene.add(m);
    fxQuads.push(m);
  }
  initGradeFX(quadGeo, size);
}
// --- THE REVEAL -----------------------------------------------------------
// Stopping time inside a condition is meant to look like equipment coming on,
// not like a fog slider moving. Two full-screen grades, both driven by the
// same eased gradeK, both cheap enough to leave on a phone: neither reads the
// framebuffer, so no extra render target is needed and the scene can still go
// straight to the screen when no ripple wants the refraction pass.
//
// NIGHT VISION is a MULTIPLY: the tint kills red and blue (which is what
// makes a monochrome phosphor image), the rim colour is the vignette, and the
// scanlines ride on top. Then one ADDITIVE pass for grain and the centre
// bloom, because multiply can only ever darken.
//
// THE FOG TUNNEL is an alpha blend of the fog colour back over everything
// outside a soft central disc. The scene behind it has already been rendered
// with the far plane opened up, so the middle of the screen clears and the
// edges stay soup: seeing through fog means pointing at what you want to see.
let gradeMul = null, gradeTun = null;
// The reveal is ONE quad per condition, not two. Night vision started as a
// multiply for the tint plus an additive pass for phosphor grain and a centre
// bloom, and measured 42.9% of a frame against 26.6% for the fog tunnel's
// single quad -- the second pass was the whole difference. Grain that only
// ever darkens still reads as grain, so it folds into the multiply and the
// bloom goes. There is also a self-limiter below: I cannot profile a real
// phone from here, so the effect has to be able to get out of the way, and
// the condition still works without it because the far plane and the light
// rig open up either way.
const GRADE_COMMON = `
  precision mediump float;
  varying vec2 vUv;
  uniform float uAspect, uK;
  ${LINEAR_TO_SRGB}
  // NOT aspect-corrected, deliberately. A true screen-space circle on a 402 x
  // 874 frame reaches the left and right edges at 0.46 of its vertical
  // radius, so a vignette tuned to bite at the top and bottom does almost
  // nothing at the sides -- measured: 10% coverage where 90% was wanted, and
  // the "tunnel" left the corridor's flanks wide open. An ellipse that
  // matches the frame is what a vignette actually means here: 1.0 at every
  // edge, 1.41 in the corners, whatever the phone's aspect.
  float radial() { return length(vUv - 0.5) * 2.0; }
`;
function initGradeFX(quadGeo, size) {
  const mk = (frag, uniforms, blending, order) => {
    const m = new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
      // transparent:true is not decoration -- three only honours `blending` at
      // all when a material is transparent, and silently draws opaque
      // otherwise. Both grades composite, so both must say so.
      uniforms, blending, transparent: true,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: frag, depthTest: false, depthWrite: false,
    }));
    m.frustumCulled = false;
    m.renderOrder = order;
    m.visible = false;
    fxScene.add(m);
    return m;
  };
  const aspect = { value: size.x / size.y };
  // NIGHT VISION. The tint kills red and blue, which is what makes a
  // monochrome phosphor image; the rim colour is the vignette; scanlines and
  // grain ride on top. All of it darkens, so all of it is one multiply.
  gradeMul = mk(`${GRADE_COMMON}
    uniform vec3 uTint, uEdge;
    uniform float uScan, uGrain, uT;
    void main() {
      float r = radial();
      vec3 c = mix(toSRGB(uTint), toSRGB(uEdge), smoothstep(0.35, 1.15, r));
      float s = 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * 900.0 + uT * 3.0));
      float g = fract(sin(dot(vUv + uT, vec2(12.9898, 78.233))) * 43758.5453);
      s *= 1.0 - uGrain * g;
      gl_FragColor = vec4(mix(vec3(1.0), c * s, uK), 1.0);
    }`,
  { uAspect: aspect, uK: { value: 0 }, uT: { value: 0 },
    uTint: { value: new THREE.Color(VIS.nvTint) },
    uEdge: { value: new THREE.Color(VIS.nvEdge) },
    uScan: { value: VIS.nvScan }, uGrain: { value: VIS.nvGrain } }, THREE.MultiplyBlending, 90);
  // THE FOG TUNNEL. The fog colour alpha-blended back over everything outside
  // a soft central disc. The scene behind it has already been rendered with
  // the far plane opened up, so the middle of the screen clears and the edges
  // stay soup: seeing through fog means pointing at what you want to see.
  // Premultiplied, because the renderer runs with premultipliedAlpha (the
  // default) and an un-premultiplied vec4 comes out both too bright and the
  // wrong hue -- measured as a warm brown edge where a cold grey one was
  // asked for.
  gradeTun = mk(`${GRADE_COMMON}
    uniform vec3 uFog;
    uniform float uR0, uR1, uMax;
    void main() {
      float a = smoothstep(uR0, uR1, radial()) * uMax * uK;
      gl_FragColor = vec4(toSRGB(uFog) * a, a);
    }`,
  { uAspect: aspect, uK: { value: 0 },
    uFog: { value: new THREE.Color(VIS.hallFog) },
    uR0: { value: VIS.tunnelR0 }, uR1: { value: VIS.tunnelR1 },
    uMax: { value: VIS.tunnelMax } }, THREE.NormalBlending, 91);
}
let gradeOff = false;      // test hook: A/B the reveal's cost against itself
let gradeAllowed = true;   // self-limiter: off for the rest of the run if slow
let gradeSlowT = 0, dtCalm = 0.0167;
// Returns true if anything has to be composited on top of the scene.
function updateGradeFX(nowMs) {
  if (!gradeMul) return false;
  const nv = gradeAllowed && !gradeOff && gradeK > 0 && gradeWant === 'nv';
  const tun = gradeAllowed && !gradeOff && gradeK > 0 && gradeWant === 'tunnel';
  gradeMul.visible = nv;
  gradeTun.visible = tun;
  if (nv) {
    gradeMul.material.uniforms.uK.value = gradeK;
    // Grain has to move or it reads as dirt on the lens. Stepped, not
    // continuous: a phosphor image flickers, it does not slide.
    gradeMul.material.uniforms.uT.value = Math.floor(nowMs / 55) * 0.137;
  }
  if (tun) {
    gradeTun.material.uniforms.uK.value = gradeK;
    gradeTun.material.uniforms.uFog.value.copy(scene.fog.color);
  }
  return nv || tun;
}

function resizeRippleFX() {
  if (!rippleRT) return;
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  rippleRT.setSize(size.x, size.y);
  for (const q of fxQuads) {
    q.material.uniforms.uRes.value.set(size.x, size.y);
    q.material.uniforms.uAspect.value = size.x / size.y;
  }
  const a = size.x / size.y;
  for (const q of [gradeMul, gradeTun]) {
    if (q) q.material.uniforms.uAspect.value = a;
  }
}
const _vFx = new THREE.Vector3();
// Project the live rings to screen space and hand the strongest few to their
// own quads. Strength follows remaining life and size on screen, so a ring in
// your face bends hard and a distant one barely at all.
function collectRippleFX() {
  if (!fxQuads.length) return 0;
  const out = [];
  for (const r of ripples) {
    _vFx.copy(r.mesh.position).project(camera);
    if (_vFx.z > 1) continue;                      // behind the camera
    const sx = _vFx.x * 0.5 + 0.5, sy = _vFx.y * 0.5 + 0.5;
    if (sx < -0.35 || sx > 1.35 || sy < -0.35 || sy > 1.35) continue;
    const dist = camera.position.distanceTo(r.mesh.position);
    if (dist < 0.25) continue;
    const world = r.mesh.scale.x;                  // ring radius in metres
    // radius as a fraction of screen HEIGHT: world size over distance, through the FOV
    const rad = world / (dist * Math.tan(camera.fov * Math.PI / 360)) * 0.5;
    // A ring bigger than half the screen is no longer a shockwave you can
    // read, it is a full-screen warp — and it is where all the fill goes.
    if (rad < 0.012 || rad > 0.5) continue;
    const fade = Math.max(0, r.life / r.maxLife);
    const strength = 0.030 * fade * Math.min(1, rad / 0.22);
    if (strength < 0.0016) continue;
    out.push({ sx, sy, rad, strength });
  }
  out.sort((a, b) => b.strength - a.strength);
  const n = Math.min(out.length, RIPPLE_FX_MAX);
  for (let i = 0; i < fxQuads.length; i++) {
    const q = fxQuads[i];
    if (i >= n) { q.visible = false; continue; }
    const o = out[i];
    const w = o.rad * 0.42 + 0.012;
    const ax = q.material.uniforms.uAspect.value;
    q.material.uniforms.uR.value.set(o.sx, o.sy, o.rad, o.strength);
    // cover only the annulus, in NDC: a fraction f of screen height is 2f of NDC
    q.scale.set(Math.min(1, (o.rad + w) * 2 / ax), Math.min(1, (o.rad + w) * 2), 1);
    q.position.set(o.sx * 2 - 1, o.sy * 2 - 1, 0);
    q.visible = true;
  }
  return n;
}
// Compile everything BEFORE it is first needed.
//
// A material's shader is compiled the first time it is drawn, and that stalls
// the frame it lands on. Measured across three doors, the only spike over
// 120 ms in a whole run was a single 150 ms frame that did NOT coincide with
// a leg being built — it was the refraction pass compiling the first time a
// ripple appeared, which is to say the first time anyone shot at you. The
// camera does not stop responding during a stall like that (look is applied
// in the pointer handler, not the frame loop) but the SCREEN does, and then
// catches up in one jump — which is indistinguishable from input sticking.
function warmUp() {
  try {
    // A contact sprite has its own program too; put one in the scene before
    // the compile so it is not the first freeze in fog that pays for it.
    if (contacts.length === 0) { takeContact(0).visible = true; }
    renderer.compile(scene, camera);
    if (!rippleRT) initRippleFX();
    // draw one throwaway frame through the whole post path so the refraction
    // shader and the render target are both real before anything shoots
    for (let i = 0; i < fxQuads.length; i++) {
      fxQuads[i].material.uniforms.uR.value.set(0.5, 0.5, 0.1, 0.001);
      fxQuads[i].visible = i === 0;
    }
    renderer.setRenderTarget(rippleRT);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(fxScene, fxCam);
    for (const q of fxQuads) q.visible = false;
    // ...and the same for the reveal grades, or the first freeze inside a
    // condition would compile three shaders on the frame it lands on. Drawn
    // at uK = 0, so they are compiled without being seen.
    const grades = [gradeMul, gradeTun].filter(Boolean);
    for (const q of grades) { q.material.uniforms.uK.value = 0; q.visible = true; }
    if (grades.length) {
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(fxScene, fxCam);
      renderer.autoClear = auto;
    }
    for (const q of grades) q.visible = false;
    if (contacts.length) contacts[0].visible = false;
  } catch { /* a warm-up must never be able to break a boot */ }
}

function renderFrame(dt) {
  if (!rippleRT) initRippleFX();
  // Self-limiting: if frames are consistently long while the pass is on, it
  // turns itself off for the rest of the run. I cannot profile a real phone
  // from here, so the effect has to be able to get out of the way.
  if (fxOn && dt > 0.028) { fxSlowT += dt; if (fxSlowT > 2.5) fxOn = false; }
  else fxSlowT = Math.max(0, fxSlowT - dt);
  const graded = updateGradeFX(performance.now());
  // Same bargain the refraction pass makes: if frames stay long while the
  // grade is up, it gives up for the rest of the run. The condition still
  // works without it — the far plane and the light rig open up either way —
  // so the worst case is a plainer reveal, never a stutter.
  //
  // But the test has to be the grade's MARGINAL cost, not the absolute frame
  // time. An absolute threshold copied from the refraction pass meant any
  // device already at 30 fps lost the effect the moment it appeared, and it
  // fired every time in the headless harness — which is uniformly slow, not
  // slow BECAUSE of this. So it compares against a calm baseline measured
  // while no grade is up.
  if (!graded) {
    dtCalm += (Math.min(dt, 0.1) - dtCalm) * 0.05;
    gradeSlowT = Math.max(0, gradeSlowT - dt);
  } else if (dt > Math.max(0.028, dtCalm * 1.6)) {
    gradeSlowT += dt;
    if (gradeSlowT > 3) gradeAllowed = false;
  } else {
    gradeSlowT = Math.max(0, gradeSlowT - dt);
  }
  const n = (fxOn && ripples.length) ? collectRippleFX() : 0;
  if (n === 0 && !graded) {          // nothing to bend: straight to the screen
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return;
  }
  if (n === 0) {
    // A grade with no ripples needs no render target — draw the world to the
    // screen and lay the grade quads over it. The blit has to sit out, or it
    // would paint an empty texture over the frame we just drew — and so do
    // the ripple quads, which collectRippleFX has not run to update and are
    // still holding last frame's uniforms over a stale render target. Leaving
    // them in smeared an old frame's muzzle flashes across the grade, which
    // is why a cold grey fog wash measured warm brown at the edges.
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    fxBlit.visible = false;
    for (const q of fxQuads) q.visible = false;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(fxScene, fxCam);
    renderer.autoClear = auto;
    fxBlit.visible = true;
    return;
  }
  renderer.setRenderTarget(rippleRT);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(fxScene, fxCam);
}

function spawnRipple(pos, vel, big) {
  const mat = takeMat('ripple', () => new THREE.MeshBasicMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  }));
  mat.color.setHex(big ? 0xd88a80 : 0x8aa8c4);
  mat.opacity = 0.5;
  const mesh = new THREE.Mesh(rippleGeo, mat);
  mesh.position.copy(pos);
  mesh.lookAt(_v1.copy(pos).add(vel));
  mesh.scale.setScalar(0.05);
  scene.add(mesh);
  ripples.push({ mesh, life: 0.8, maxLife: 0.8, grow: big ? 1.0 : 0.55 });
  if (ripples.length > 90) {   // hard cap; oldest rings pop first
    const r = ripples.shift();
    scene.remove(r.mesh);
    freeMat('ripple', r.mesh.material);
  }
}

function updateRipples(sdt) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.life -= sdt;
    if (r.life <= 0) {
      scene.remove(r.mesh);
      freeMat('ripple', r.mesh.material);
      ripples.splice(i, 1);
      continue;
    }
    const t = 1 - r.life / r.maxLife;   // rings expand as they fade
    r.mesh.scale.setScalar(0.05 + t * r.grow);
    r.mesh.material.opacity = 0.5 * (r.life / r.maxLife);
  }
}

// ---------------------------------------------------------------------------
// Debris — shatter shards & impact sparks with gravity + floor bounce
// ---------------------------------------------------------------------------
const shardGeo = new THREE.TetrahedronGeometry(0.12);

// ---------------------------------------------------------------------------
// SHARD POOLS
//
// Every shard used to be its own THREE.Mesh. A kill made 26 of them and a
// materialising enemy made ~156, none of it capped — so a busy corridor could
// be carrying a thousand meshes and a thousand draw calls, for an effect that
// is the same tetrahedron every time.
//
// Both are now fixed-size InstancedMesh pools: one draw call each, a ring
// buffer so the oldest shard is recycled instead of the count growing without
// bound, and per-instance colour so the whole palette still fits in one call.
// This is cheaper than what it replaces AND allows more than twice the pieces.
function makeShardPool(count, material) {
  const mesh = new THREE.InstancedMesh(shardGeo, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;   // a pool has no meaningful bounds
  scene.add(mesh);
  const items = new Array(count);
  for (let i = 0; i < count; i++) items[i] = { on: false };
  return { mesh, items, head: 0, count };
}
// white base: the per-instance colour is what you actually see
const MAT_SHARD = new THREE.MeshLambertMaterial({ color: 0xffffff });
const _sm = new THREE.Matrix4();
const _sq = new THREE.Quaternion();
const _se = new THREE.Euler();
const _sv = new THREE.Vector3();
const _sc = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

let debrisPool = null, assemblePool = null;
function claimShard(pool, color) {
  const i = pool.head;
  pool.head = (pool.head + 1) % pool.count;
  const it = pool.items[i];
  it.on = true;
  it.idx = i;
  // A ring buffer hands the same slot out again under load. Anything holding
  // a reference (an assembling enemy holds 156 of them) must be able to tell
  // that its shard has been recycled, or it will animate someone else's.
  it.gen = (it.gen || 0) + 1;
  if (color !== undefined) {
    _sc.set(color);
    pool.mesh.instanceColor.setXYZ(i, _sc.r, _sc.g, _sc.b);
    pool.mesh.instanceColor.needsUpdate = true;
  }
  return it;
}
function writeShard(pool, it) {
  if (!it.on || it.hold > 0) { pool.mesh.setMatrixAt(it.idx, HIDDEN); return; }
  _se.set(it.rx, it.ry, it.rz);
  _sq.setFromEuler(_se);
  _sv.setScalar(it.s);
  _sm.compose({ x: it.px, y: it.py, z: it.pz }, _sq, _sv);
  pool.mesh.setMatrixAt(it.idx, _sm);
}

function clearShardPool(pool) {
  if (!pool) return;
  for (let i = 0; i < pool.count; i++) {
    pool.items[i].on = false;
    pool.mesh.setMatrixAt(i, HIDDEN);
  }
  pool.mesh.instanceMatrix.needsUpdate = true;
  pool.live = 0;
}

debrisPool = makeShardPool(SHATTER.pool, MAT_SHARD);
// Its own pool on purpose. The materialising swarm is the first thing the
// game shows you and it has no equivalent in the reference; sharing a ring
// buffer with the debris would let a busy fight eat it alive.
assemblePool = makeShardPool(SHATTER.assemblePool, MAT_SHARD);

// Three shades of the same red, and nothing else. The amber and near-white
// flecks came off the reference, but there they are a fire TELEGRAPH burning
// on the body at the instant it breaks — not a property of the debris. We
// have no such telegraph, so hot pieces were just confetti.
function shardColor() {
  const r = Math.random();
  if (r < SHATTER.ratioBright) return SHATTER.colBright;
  if (r < SHATTER.ratioBright + SHATTER.ratioDark) return SHATTER.colDark;
  return SHATTER.colDeep;
}

function spawnShatter(center, impulseDir, count) {
  const n = count || SHATTER.perKill;
  for (let i = 0; i < n; i++) {
    const it = claimShard(debrisPool, shardColor());
    // TWO CLASSES. A third are the original big chunks — pieces large enough
    // to follow with your eye as they tumble — and the rest is grit around
    // them. All-grit read as sand; all-chunks read as meat. Both together is
    // a body coming apart.
    const chunk = Math.random() < SHATTER.chunkFrac;
    it.s = chunk
      ? SHATTER.chunkMin + Math.random() * SHATTER.chunkVar
      : SHATTER.gritMin + SHATTER.gritVar * Math.pow(Math.random(), SHATTER.gritCurve);
    it.px = center.x + (Math.random() - 0.5) * 0.5;
    it.py = 0.25 + Math.random() * 1.5;
    it.pz = center.z + (Math.random() - 0.5) * 0.5;
    // isotropic direction, most of them SLOW with a fast tail, plus a shove
    // along the killing blow and a constant lift — that lift is what puts the
    // cloud above the wound instead of level with it
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    const sp = SHATTER.speedBase + SHATTER.speedVar * Math.pow(Math.random(), SHATTER.speedCurve);
    const im = SHATTER.impulse + Math.random() * SHATTER.impulseVar;
    it.vx = Math.sin(ph) * Math.cos(th) * sp + impulseDir.x * im;
    it.vy = Math.cos(ph) * sp + SHATTER.rise;
    it.vz = Math.sin(ph) * Math.sin(th) * sp + impulseDir.z * im;
    it.rx = Math.random() * 6.28; it.ry = Math.random() * 6.28; it.rz = Math.random() * 6.28;
    it.wx = (Math.random() - 0.5) * 2 * SHATTER.spin;
    it.wy = (Math.random() - 0.5) * 2 * SHATTER.spin;
    it.wz = (Math.random() - 0.5) * 2 * SHATTER.spin;
    it.life = SHATTER.life + Math.random() * SHATTER.lifeVar;
    it.maxLife = it.life;
    // the body does not vanish between two frames: pieces arrive across a
    // short window, so you see it come apart rather than pop
    it.hold = SHATTER.breakWindow * Math.pow(Math.random(), 1.6);
  }
}

function spawnSparks(at, color, count) {
  const n = count || SHATTER.sparkWall;
  for (let i = 0; i < n; i++) {
    const it = claimShard(debrisPool, color);
    it.s = 0.1 + Math.random() * 0.14;
    it.px = at.x; it.py = at.y; it.pz = at.z;
    it.vx = (Math.random() - 0.5) * 5;
    it.vy = Math.random() * 3;
    it.vz = (Math.random() - 0.5) * 5;
    it.rx = Math.random() * 6.28; it.ry = Math.random() * 6.28; it.rz = Math.random() * 6.28;
    it.wx = (Math.random() - 0.5) * 40;
    it.wy = (Math.random() - 0.5) * 40;
    it.wz = (Math.random() - 0.5) * 40;
    it.life = 1.8 + Math.random() * 0.8;
    it.maxLife = it.life;
    it.hold = 0;
  }
}

function updateDebris(sdt) {
  const pool = debrisPool;
  if (!pool) return;
  let live = 0;
  for (let i = 0; i < pool.count; i++) {
    const d = pool.items[i];
    if (!d.on) { pool.mesh.setMatrixAt(i, HIDDEN); continue; }
    if (d.hold > 0) {                    // still part of the body coming apart
      d.hold -= sdt;
      pool.mesh.setMatrixAt(i, HIDDEN);
      live++;
      continue;
    }
    d.life -= sdt;
    if (d.life <= 0) { d.on = false; pool.mesh.setMatrixAt(i, HIDDEN); continue; }
    live++;
    d.vy -= GRAVITY * sdt;
    // air drag: without it the cloud expands forever. With it the spray
    // stops growing at about a metre and then hangs, which is the thing that
    // makes frozen time read as frozen AIR rather than frozen objects.
    const k = Math.max(0, 1 - SHATTER.drag * sdt);
    d.vx *= k; d.vy *= k; d.vz *= k;
    d.px += d.vx * sdt; d.py += d.vy * sdt; d.pz += d.vz * sdt;
    d.rx += d.wx * sdt; d.ry += d.wy * sdt; d.rz += d.wz * sdt;
    const r = 0.1 * d.s;
    if (d.py < r && d.vy < 0) {          // floor bounce with friction
      d.py = r;
      d.vy *= -SHATTER.restitution;
      d.vx *= SHATTER.friction; d.vz *= SHATTER.friction;
      d.wx *= SHATTER.angDamp; d.wy *= SHATTER.angDamp; d.wz *= SHATTER.angDamp;
    }
    if (d.life < 0.5) d.s = Math.max(0, d.s * (1 - sdt * 2));   // shrink out
    writeShard(pool, d);
  }
  pool.mesh.instanceMatrix.needsUpdate = true;
  pool.live = live;
}

// ---------------------------------------------------------------------------
// Grenades — bombers lob these in an arc onto a marked red landing ring.
// Anything inside the blast when it lands goes down, enemies included.
// ---------------------------------------------------------------------------
const grenades = [];   // {mesh, ring, pos, vel, t}
const grenadeGeo = new THREE.SphereGeometry(0.14, 10, 10);
// shared, like every other effect geometry: the target ring used to build a
// fresh RingGeometry per grenade and never dispose it
const grenadeRingGeo = new THREE.RingGeometry(0.6, 0.78, 24);
const BLAST_R = 2.3;

function spawnGrenade(e) {
  const origin = new THREE.Vector3(e.pos.x, 1.4, e.pos.z);
  const target = new THREE.Vector3(
    player.pos.x + (Math.random() - 0.5) * 0.8, 0.12,
    player.pos.z + (Math.random() - 0.5) * 0.8
  );
  const T = 1.15;   // world-seconds of hang time — plenty to see it coming
  const vel = new THREE.Vector3(
    (target.x - origin.x) / T,
    (target.y - origin.y + 0.5 * 9.8 * T * T) / T,
    (target.z - origin.z) / T
  );
  const mesh = new THREE.Mesh(grenadeGeo, MAT_BLACK);
  mesh.position.copy(origin);
  scene.add(mesh);
  const ringMat = takeMat('gring', () => new THREE.MeshBasicMaterial({
    color: 0xff2d1a, transparent: true, side: THREE.DoubleSide,
  }));
  ringMat.opacity = 0.5;
  const ring = new THREE.Mesh(grenadeRingGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(target.x, 0.02, target.z);
  scene.add(ring);
  grenades.push({ mesh, ring, pos: origin.clone(), vel, t: 0 });
  sfx.lob();
}

function explodeGrenade(i) {
  const gr = grenades[i];
  const at = gr.pos.clone();
  scene.remove(gr.mesh);
  scene.remove(gr.ring);
  freeMat('gring', gr.ring.material);
  grenades.splice(i, 1);
  spawnSparks(at, 0xff2d1a);
  spawnSparks(at, 0x16181d);
  spawnRipple(new THREE.Vector3(at.x, 0.5, at.z), _v1.set(0, 1, 0), true);   // shockwave
  sfx.boom();
  vibrate(30);
  if (player.alive && player.iframes <= 0 &&
      Math.hypot(player.pos.x - at.x, player.pos.z - at.z) < BLAST_R) {
    hitPlayer();
  }
  for (let j = enemies.length - 1; j >= 0; j--) {   // friendly fire is fair game
    const e = enemies[j];
    if (e.state === 'assemble') continue;   // not material yet
    if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) < BLAST_R * 0.8) {
      killEnemy(j, _v1.set(e.pos.x - at.x, 0.5, e.pos.z - at.z).normalize());
    }
  }
}

function updateGrenades(sdt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const gr = grenades[i];
    gr.t += sdt;
    gr.vel.y -= 9.8 * sdt;
    gr.pos.addScaledVector(gr.vel, sdt);
    gr.mesh.position.copy(gr.pos);
    gr.mesh.rotation.x += sdt * 7;
    gr.ring.material.opacity = 0.35 + 0.3 * Math.abs(Math.sin(gr.t * 9));   // pulse
    if (gr.pos.y <= 0.12) explodeGrenade(i);
  }
}

// ---------------------------------------------------------------------------
// Homing missiles — slow but they steer toward you with a limited turn rate.
// Dodge with a hard sideways cut, or put a wall between you and it.
// ---------------------------------------------------------------------------
const missiles = [];   // {mesh, pos, vel, life, rippleAcc}
const MISSILE_SPEED = 7.5;
const MISSILE_TURN = 1.7;      // rad/s of steering authority (world time)
const MISSILE_BLAST = 1.6;

function spawnMissile(e) {
  const pos = new THREE.Vector3(e.pos.x, 1.5, e.pos.z);
  const dir = new THREE.Vector3(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z).normalize();
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.34), MAT_BLACK);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2d1a })
  );
  glow.position.z = 0.2;   // exhaust at the tail
  mesh.add(body, glow);
  mesh.position.copy(pos);
  scene.add(mesh);
  missiles.push({ mesh, pos, vel: dir.multiplyScalar(MISSILE_SPEED), life: 8, rippleAcc: 0 });
  sfx.rocket();
}

function explodeMissile(i) {
  const m = missiles[i];
  const at = m.pos.clone();
  scene.remove(m.mesh);
  missiles.splice(i, 1);
  spawnSparks(at, 0xff2d1a);
  spawnSparks(at, 0x16181d);
  spawnRipple(at, _v1.set(0, 1, 0), true);
  sfx.boom();
  if (player.alive && player.iframes <= 0 &&
      Math.hypot(player.pos.x - at.x, player.pos.z - at.z) < MISSILE_BLAST) {
    hitPlayer();
  }
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (e.state === 'assemble') continue;   // not material yet
    if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) < MISSILE_BLAST * 0.8) {
      killEnemy(j, _v1.set(e.pos.x - at.x, 0.5, e.pos.z - at.z).normalize());
    }
  }
}

function updateMissiles(sdt) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.life -= sdt;
    if (m.life <= 0) { explodeMissile(i); continue; }
    // limited-authority homing: blend flight dir toward the player
    _v1.set(player.pos.x - m.pos.x, 1.1 - m.pos.y, player.pos.z - m.pos.z).normalize();
    m.vel.normalize().addScaledVector(_v1, MISSILE_TURN * sdt).normalize().multiplyScalar(MISSILE_SPEED);
    const prev = _v2.copy(m.pos);
    m.pos.addScaledVector(m.vel, sdt);
    m.mesh.position.copy(m.pos);
    m.mesh.lookAt(_v3.copy(m.pos).add(m.vel));
    // smoke wake
    m.rippleAcc += m.pos.distanceTo(prev);
    if (m.rippleAcc > 0.5) { m.rippleAcc = 0; spawnRipple(m.pos, m.vel, false); }
    // detonate on player proximity, terrain, or cover
    const pd = Math.hypot(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
    if ((pd < 0.6 && Math.abs(m.pos.y - 1.1) < 1.2) || m.pos.y <= 0.1 ||
        Math.abs(m.pos.x - player.pos.x) > LIVE_BOUND ||
        Math.abs(m.pos.z - player.pos.z) > LIVE_BOUND) {
      explodeMissile(i);
      continue;
    }
    let hitWall = false;
    for (const o of obstacles) {
      if (segAABB(prev, m.pos, o) >= 0) { hitWall = true; break; }
    }
    if (hitWall) explodeMissile(i);
  }
}

// ---------------------------------------------------------------------------
// Weapon pickups — shotgunners usually drop their gun; snipers always do.
// ---------------------------------------------------------------------------
const pickups = [];   // {g, spin, ring, t, life}
const PICKUP_LIFE = DROPS.life;
const PICKUP_SINK = 1.2;   // final seconds: the gun sinks into the floor

function spawnPickup(pos, type = 'shotgun') {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  if (type === CLIP) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.4, 0.1), MAT_BLACK);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.13), MAT_GUNMETAL);
    lip.position.y = 0.22;
    spin.add(body, lip);
  } else if (type === 'launcher' || type === 'rocket') {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.0), MAT_BLACK);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.14), MAT_GUNMETAL);
    mouth.position.z = -0.5;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.1), MAT_BLACK);
    grip.position.set(0, -0.15, 0.12);
    spin.add(tube, mouth, grip);
  } else if (type === 'sniper') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.15), MAT_BLACK);
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.2), MAT_GUNMETAL);
    scope.position.set(0, 0.08, 0.15);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.28), MAT_BLACK);
    stock.position.set(0, -0.03, 0.55);
    spin.add(barrel, scope, stock);
  } else {
    const barrelL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.8), MAT_BLACK);
    barrelL.position.x = -0.04;
    const barrelR = barrelL.clone();
    barrelR.position.x = 0.04;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.3), MAT_BLACK);
    stock.position.set(0, -0.03, 0.45);
    spin.add(barrelL, barrelR, stock);
  }
  spin.position.y = 0.85;
  spin.rotation.z = 0.25;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.88, 24),
    new THREE.MeshBasicMaterial({ color: 0xff2d1a, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(spin, ring);
  g.position.set(pos.x, 0, pos.z);
  scene.add(g);
  pickups.push({ g, spin, ring, type, t: Math.random() * 6, life: PICKUP_LIFE });
  if (!spawnPickup.hinted) {   // one-time tutorial nudge
    spawnPickup.hinted = true;
    showBanner('WALK OVER IT TO TAKE IT', 1800);
  }
}

function removePickup(i) {
  if (pickups[i] === sprintTo) sprintTo = null;
  scene.remove(pickups[i].g);
  pickups.splice(i, 1);
}

function updatePickups(dt, sdt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    p.life -= sdt;               // world clock: frozen time doesn't eat the timer
    p.spin.rotation.y += dt * 2; // but it keeps spinning so you can spot it
    p.spin.position.y = 0.85 + Math.sin(p.t * 2.2) * 0.07;
    if (p.life <= 0) { removePickup(i); continue; }
    if (p.life < PICKUP_SINK) {   // time's up: the gun sinks into the ground
      const s = 1 - p.life / PICKUP_SINK;
      p.spin.position.y = 0.85 - s * 1.7;
      p.ring.material.opacity = 0.5 * (1 - s);
      continue;   // no bob, no magnet chase while sinking
    }
    p.ring.material.opacity = 0.5;
    if (player.alive) {
      const dx = p.g.position.x - player.pos.x, dz = p.g.position.z - player.pos.z;
      const d2 = dx * dx + dz * dz;
      // no magnet: the drop stays where it fell, so crossing the room for
      // it is a real decision. PICKUP_R is generous enough that walking
      // over it always registers.
      if (d2 < DROPS.pickupR * DROPS.pickupR) {
        takePickup(p.type);
        sfx.pickup();
        vibrate(20);
        removePickup(i);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Enemies — sculpted crystal humanoids (ported 1:1 from the Character Tuner).
// States: advance -> aim -> fire, melee up close.
// ---------------------------------------------------------------------------
const enemies = [];

// tuner-approved body parameters (the values line)
const EP = { head: 0.29, neck: 0.05, shld: 0.5, waist: 0.3, chest: 0.24, hip: 0.36,
  lean: 3 * Math.PI / 180, musc: 0.45, armt: 0.1, legt: 0.14,
  elbow: 22 * Math.PI / 180, knee: 8 * Math.PI / 180, jit: 0.018 };
const LOFT_N = 8;   // SCULPTED · 8

const enemyMatCache = {};
function EM(hex) {
  return enemyMatCache[hex] || (enemyMatCache[hex] = new THREE.MeshLambertMaterial({ color: hex }));
}
const MAT_SASH = new THREE.MeshLambertMaterial({ color: 0x16181d, side: THREE.DoubleSide });

function rnd01(s) { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); }

// polygon soup -> flat-shaded BufferGeometry; each triangle is wound so its
// normal points away from the hull's centroid (keeps Lambert lighting sane)
function facesToGeo(v, faces, orient = true) {
  let cx = 0, cy = 0, cz = 0;
  for (const p of v) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= v.length; cy /= v.length; cz /= v.length;
  const pos = [];
  for (const f of faces) {
    for (let i = 1; i < f.length - 1; i++) {
      let a = v[f[0]], b = v[f[i]], c = v[f[i + 1]];
      if (orient) {
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const ox = (a[0] + b[0] + c[0]) / 3 - cx, oy = (a[1] + b[1] + c[1]) / 3 - cy, oz = (a[2] + b[2] + c[2]) / 3 - cz;
        if (nx * ox + ny * oy + nz * oz < 0) { const t = b; b = c; c = t; }
      }
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

const BOXF = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 3, 7, 4], [1, 2, 6, 5]];
function tboxGeo(wb, wt, h, db, dt) {   // tapered box, hangs from its pivot
  return facesToGeo([
    [-wb / 2, -h, -db / 2], [wb / 2, -h, -db / 2], [wt / 2, 0, -dt / 2], [-wt / 2, 0, -dt / 2],
    [-wb / 2, -h, db / 2], [wb / 2, -h, db / 2], [wt / 2, 0, dt / 2], [-wt / 2, 0, dt / 2]], BOXF);
}

// stacked N-gon rings -> faceted organic volume; jitter is bilaterally
// symmetric and mostly tangential, so contours stay smooth and human
function loftGeo(prof, pid, jit, seed) {
  const N = LOFT_N, v = [];
  const mir = (i) => ((N / 2 - 1 - i) % N + N) % N;
  prof.forEach((r, ri) => {
    const j = jit * (r.jm !== undefined ? r.jm : 1);
    for (let i = 0; i < N; i++) {
      const c = Math.min(i, mir(i));
      const k = seed * 57.3 + pid * 13.7 + (ri * N + c) * 3.1;
      const sgn = i === c ? 1 : -1;
      const da = i === mir(i) ? 0 : sgn * (rnd01(k) * 2 - 1) * j * 1.6 / Math.max(r.rx + r.rz, 0.12);
      const dy = (rnd01(k + 71.7) * 2 - 1) * j * 0.6;
      const dr = 1 + (rnd01(k + 143.9) * 2 - 1) * j * 3;
      const a = ((i + 0.5) / N) * Math.PI * 2 + da;
      v.push([Math.cos(a) * r.rx * dr, r.y + dy, Math.sin(a) * r.rz * dr + (r.oz || 0)]);
    }
  });
  const f = [];
  for (let r = 0; r < prof.length - 1; r++)
    for (let i = 0; i < N; i++)
      f.push([r * N + i, r * N + (i + 1) % N, (r + 1) * N + (i + 1) % N, (r + 1) * N + i]);
  f.push([...Array(N).keys()]);
  f.push([...Array(N).keys()].map(i => (prof.length - 1) * N + i));
  return facesToGeo(v, f);
}

const limbProf2 = (len, r0, r1, r2) => [
  { y: 0, rx: r0, rz: r0 * 0.92, jm: 0.35 },
  { y: -len * 0.42, rx: r1, rz: r1 * 0.92 },
  { y: -len * 0.85, rx: (r1 + r2) * 0.42, rz: (r1 + r2) * 0.4 },
  { y: -len, rx: r2, rz: r2 * 0.92, jm: 0.4 },
];

function buildEnemyMesh(type) {
  const g = new THREE.Group();
  const P = { ...EP };
  // per-type builds: the heavy is broader everywhere, the bomber pear-shaped
  if (type === 'heavy') { P.shld *= 1.18; P.waist *= 1.22; P.chest *= 1.15; P.hip *= 1.1; P.armt *= 1.3; P.legt *= 1.15; }
  if (type === 'bomber') { P.waist *= 1.35; P.hip *= 1.12; P.chest *= 1.12; }
  const seed = 1 + Math.floor(Math.random() * 97);
  const jit = P.jit, m = P.musc;
  const C = type === 'armored' ? { body: 0x3a3d45, chest: 0x3a3d45, pelvis: 0x33363d, head: 0xe03222 }
    : type === 'sniper' ? { body: 0xb81205, chest: 0xa21507, pelvis: 0x8c1004, head: 0xc8281a }
    : type === 'rusher' ? { body: 0xe0321f, chest: 0xe83a26, pelvis: 0xc8281a, head: 0xf5533f }
    : { body: 0xc8281a, chest: 0xd3291b, pelvis: 0xa21507, head: 0xe03222 };
  const M = { body: EM(C.body), chest: EM(C.chest), pelvis: EM(C.pelvis), head: EM(C.head) };
  const lean = P.lean + (type === 'rusher' ? 0.22 : 0);   // the rusher stalks hunched
  const headH = P.head * 1.08;
  const headBot = 1.62 - headH / 2;
  const torsoTop = headBot - P.neck;
  const hipTop = 0.86, torsoBot = hipTop - 0.05;   // chest bottom tucks into pelvis
  const th = torsoTop - torsoBot;

  const chestProf = [
    { y: -th, rx: P.waist / 2, rz: P.chest * 0.4 },
    { y: -th * 0.6, rx: (P.waist + (P.shld - P.waist) * 0.42) / 2 + m * 0.012, rz: P.chest * 0.52 + m * 0.012 },
    { y: -th * 0.18, rx: P.shld / 2 * 0.98 + m * 0.02, rz: P.chest * 0.5, jm: 0.35 },
    { y: -th * 0.06, rx: P.shld / 2 * 0.86, rz: P.chest * 0.44, jm: 0.25 },
    { y: 0, rx: P.shld / 2 * 0.56, rz: P.chest * 0.34, jm: 0.2 },
  ];
  // the hunch pivots at the WAIST so it can never open a gap at the beltline;
  // `collar` holds everything expressed in collar-relative coordinates
  const chestG = new THREE.Group();
  chestG.position.y = torsoBot;
  chestG.rotation.x = lean;
  g.add(chestG);
  const collar = new THREE.Group();
  collar.position.y = th;
  chestG.add(collar);
  const chest = new THREE.Mesh(loftGeo(chestProf, 1, jit, seed), M.chest);
  collar.add(chest);

  if (P.neck > 0.005) {
    const neck = new THREE.Mesh(loftGeo([
      { y: -(P.neck + 0.02), rx: P.head * 0.24, rz: P.head * 0.24 },
      { y: 0, rx: P.head * 0.21, rz: P.head * 0.22 },
    ], 2, jit * 0.6, seed), M.body);
    neck.position.y = P.neck + 0.01;
    collar.add(neck);
  }
  const hh = headH, hr = P.head;
  // the sniper's head wears a swept-back hood
  const headProf = type === 'sniper' ? [
    { y: -hh, rx: hr * 0.3, rz: hr * 0.34, jm: 0.3 },
    { y: -hh * 0.75, rx: hr * 0.46, rz: hr * 0.52, oz: -hr * 0.03 },
    { y: -hh * 0.48, rx: hr * 0.51, rz: hr * 0.58, oz: -hr * 0.06 },
    { y: -hh * 0.22, rx: hr * 0.48, rz: hr * 0.56, oz: -hr * 0.14 },
    { y: 0.05, rx: hr * 0.24, rz: hr * 0.4, oz: -hr * 0.3, jm: 0.12 },
  ] : [
    { y: -hh, rx: hr * 0.3, rz: hr * 0.34, jm: 0.3 },
    { y: -hh * 0.78, rx: hr * 0.44, rz: hr * 0.49 },
    { y: -hh * 0.52, rx: hr * 0.5, rz: hr * 0.545 },
    { y: -hh * 0.3, rx: hr * 0.5, rz: hr * 0.54 },
    { y: -hh * 0.12, rx: hr * 0.44, rz: hr * 0.48, jm: 0.3 },
    { y: 0, rx: hr * 0.26, rz: hr * 0.3, jm: 0.15 },
  ];
  const head = new THREE.Mesh(loftGeo(headProf, 3, jit, seed), M.head);
  head.position.y = 1.62 + hh / 2 - torsoTop;   // head center stays at 1.62
  collar.add(head);

  const ph2 = hipTop - 0.62;
  const pelvis = new THREE.Mesh(loftGeo([
    { y: -ph2, rx: P.hip / 2 * 0.8, rz: P.chest * 0.36 },
    { y: -ph2 * 0.45, rx: P.hip / 2, rz: P.chest * 0.4 },
    { y: 0, rx: P.hip / 2 * 0.9, rz: P.chest * 0.43 },
  ], 4, jit, seed), M.pelvis);
  pelvis.position.y = hipTop;
  g.add(pelvis);

  // legs: thigh group at the hip (game swings rotation.x), shin group at the
  // knee with the resting bend, wedge shoe rigid at 90° to the shin
  const thighL = 0.44, shinLen = 0.36;
  const mkLeg = (side) => {
    const leg = new THREE.Group();
    leg.position.set(side * (P.hip / 2 - P.legt / 2 + 0.01), 0.86, 0);
    leg.add(new THREE.Mesh(loftGeo(limbProf2(thighL, P.legt * 0.62, P.legt * (0.58 + 0.22 * m), P.legt * 0.42), 5 + side, jit, seed), M.body));
    const shin = new THREE.Group();
    shin.position.y = -thighL;
    shin.rotation.x = EP.knee;
    shin.add(new THREE.Mesh(loftGeo(limbProf2(shinLen, P.legt * 0.46, P.legt * (0.48 + 0.26 * m), P.legt * 0.3), 7 + side, jit, seed), M.body));
    const fw = P.legt, ft = fw * 0.72;
    const foot = new THREE.Mesh(facesToGeo([
      [-fw / 2, 0, -0.11], [fw / 2, 0, -0.11], [fw / 2, 0.085, -0.11], [-fw / 2, 0.085, -0.11],
      [-ft / 2, 0, 0.23], [ft / 2, 0, 0.23], [ft / 2, 0.028, 0.23], [-ft / 2, 0.028, 0.23]], BOXF), M.pelvis);
    foot.position.y = -shinLen - 0.02;
    shin.add(foot);
    leg.add(shin);
    g.add(leg);
    return { leg, shin };
  };
  const LG = mkLeg(-1), RG = mkLeg(1);
  const legL = LG.leg, legR = RG.leg;

  // arms: shoulder group on the collar (rides the hunch), forearm group at
  // the elbow. The gun arm rests nearly straight so the aim raise points true.
  const upperL = 0.3, foreL = 0.28;
  const mkArm = (side) => {
    const arm = new THREE.Group();
    arm.position.set(side * (P.shld / 2 + P.armt * 0.1), -0.05, 0);
    collar.add(arm);
    const ur0 = P.armt * (0.62 + 0.1 * m);
    arm.add(new THREE.Mesh(loftGeo([
      { y: 0.045, rx: ur0 * 0.55, rz: ur0 * 0.5, jm: 0.2 },
      { y: -0.01, rx: ur0, rz: ur0 * 0.92, jm: 0.35 },
      { y: -upperL * 0.42, rx: P.armt * (0.56 + 0.3 * m), rz: P.armt * (0.56 + 0.3 * m) * 0.92 },
      { y: -upperL * 0.85, rx: (P.armt * (0.56 + 0.3 * m) + P.armt * 0.42) * 0.42, rz: (P.armt * (0.56 + 0.3 * m) + P.armt * 0.42) * 0.4 },
      { y: -upperL, rx: P.armt * 0.42, rz: P.armt * 0.42 * 0.92, jm: 0.4 },
    ], 11 + side, jit, seed), M.body));
    const fore = new THREE.Group();
    fore.position.y = -upperL;
    fore.rotation.x = -(side > 0 ? 0.12 : EP.elbow);
    fore.add(new THREE.Mesh(loftGeo(limbProf2(foreL + 0.06, P.armt * 0.46, P.armt * (0.48 + 0.2 * m), P.armt * 0.3), 13 + side, jit, seed), M.body));
    arm.add(fore);
    return { arm, fore };
  };
  const AL = mkArm(-1), AR = mkArm(1);
  const armL = AL.arm;
  // gun arm keeps the original group contract for the aim animation
  const armR = AR.arm;
  // hands + weapons live in FOREARM space; the wrist is at y = -foreL. Guns
  // sit DISTAL of the closed fist (grip covered, butt showing) so black never
  // interpenetrates red — barrels still run along -y for the aim raise.
  const addHand = (fa, side, fist) => {
    if (fist) {
      const f = new THREE.Mesh(tboxGeo(P.armt * 0.95, P.armt * 0.85, 0.11, P.armt * 0.95, P.armt * 0.85), M.body);
      f.position.set(0, -foreL - 0.04, -0.055);
      fa.add(f);
    } else {
      const palm = new THREE.Mesh(tboxGeo(P.armt * 0.82, P.armt * 0.62, 0.14, P.armt * 0.52, P.armt * 0.4), M.body);
      palm.position.set(0, -foreL - 0.02, 0.008);
      const thumb = new THREE.Mesh(tboxGeo(0.032, 0.026, 0.07, 0.04, 0.032), M.body);
      thumb.position.set(-side * P.armt * 0.5, -foreL - 0.03, 0.025);
      fa.add(palm, thumb);
    }
  };
  const handheld = type !== 'rusher' && type !== 'rocketeer' && type !== 'laser';
  addHand(AL.fore, -1, false);
  addHand(AR.fore, 1, type === 'rocketeer' || (handheld && type !== 'bomber'));
  let egun = null;
  if (handheld && type !== 'bomber') {
    egun = new THREE.Group();
    egun.position.y = -foreL;
    const bar = (len, thick, x = 0) => {
      const b = new THREE.Mesh(tboxGeo(thick, thick, len, thick, thick), MAT_BLACK);
      b.position.set(x, -0.3, 0);
      egun.add(b);   // first barrel added = the flash target
      return b;
    };
    if (type === 'sniper') {
      bar(0.55, 0.04);
      const scope = new THREE.Mesh(tboxGeo(0.045, 0.045, 0.12, 0.045, 0.045), MAT_GUNMETAL);
      scope.position.set(0, -0.24, 0.07);
      egun.add(scope);
    } else if (type === 'shotgunner') {
      egun.userData.flash = [bar(0.34, 0.045, -0.0225), bar(0.34, 0.045, 0.0225)];
      const stock = new THREE.Mesh(tboxGeo(0.055, 0.055, 0.1, 0.075, 0.075), MAT_BLACK);
      stock.position.set(0, -0.16, -0.075);
      egun.add(stock);
    } else if (type === 'heavy') {
      bar(0.32, 0.07);
    } else {   // gunner, armored, shieldbearer: a pistol
      bar(0.2, 0.05);
    }
    const receiver = new THREE.Mesh(tboxGeo(0.09, 0.09, 0.16, 0.1, 0.1), MAT_BLACK);
    receiver.position.set(0, -0.16, 0);
    const grip = new THREE.Mesh(tboxGeo(0.045, 0.045, 0.07, 0.11, 0.11), MAT_BLACK);
    grip.position.set(0, -0.17, -0.085);
    egun.add(receiver, grip);
    AR.fore.add(egun);
  }
  if (type === 'bomber') {   // a grenade in the throwing hand
    egun = new THREE.Mesh(tboxGeo(0.14, 0.14, 0.14, 0.14, 0.14), MAT_BLACK);
    egun.position.set(0, -foreL - 0.16, -0.02);
    AR.fore.add(egun);
  }
  if (type === 'rusher') {   // crystal claws past each open hand
    for (const fa of [AL.fore, AR.fore]) {
      for (const off of [-0.026, 0.026]) {
        const claw = new THREE.Mesh(tboxGeo(0.018, 0.06, 0.22, 0.018, 0.052), M.head);
        claw.position.set(off, -foreL - 0.17, 0.01);
        fa.add(claw);
      }
    }
  }

  // ---- type dressing on the chest (rides the hunch and walk exactly) ----
  let armLock = false, armRLock = false, armLRest = 0, armRRest = 0;
  if (type === 'shotgunner') {
    // bandolier: closed loop hugging the torso's own surface — over the
    // shoulder by the neck, across chest AND back, under the opposite arm
    const chestSurf = (y) => {
      const pr = chestProf;
      if (y <= pr[0].y) return pr[0];
      for (let i = 1; i < pr.length; i++) if (y <= pr[i].y) {
        const a = pr[i - 1], b = pr[i], k = (y - a.y) / (b.y - a.y);
        return { rx: a.rx + (b.rx - a.rx) * k, rz: a.rz + (b.rz - a.rz) * k };
      }
      return pr[pr.length - 1];
    };
    const ySurf3 = (x, z) => {
      const pr = chestProf;
      const e2 = (r) => (x / r.rx) * (x / r.rx) + (z / r.rz) * (z / r.rz);
      let u = pr[pr.length - 1];
      if (e2(u) <= 1) return u.y;
      for (let i = pr.length - 2; i >= 0; i--) {
        const l = pr[i], eu = e2(u), el = e2(l);
        if (el <= 1) return u.y + (l.y - u.y) * ((eu - 1) / ((eu - el) || 1e-6));
        u = l;
      }
      return -1e9;
    };
    const NS = 44, yTopS = -0.005, yBotS = -th * 0.68, HW = 0.033, TH2 = 0.02;
    const sashPt = (a, off = 0) => {
      const aw = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      let y = yBotS + (yTopS - yBotS) * Math.pow(1 - aw / Math.PI, 1.25);
      const s = chestSurf(y);
      const gap = 0.006 + off + jit * 3 * (s.rx + s.rz) * 0.5;
      const shrink = 1 - 0.3 * Math.pow(Math.max(0, Math.cos(a)), 4);
      const x = Math.cos(a) * (s.rx + gap) * shrink;
      const z = Math.sin(a) * (s.rz + gap);
      if (aw < 1.2) y = Math.max(y, ySurf3(x, z) + 0.006 + off);
      return [x, y, z];
    };
    const IN0 = [], IN1 = [], OUT0 = [], OUT1 = [];
    for (let i = 0; i < NS; i++) {
      const a = (i / NS) * Math.PI * 2;
      const aw = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      const p = sashPt(a), pa = sashPt(a + 0.09), pb = sashPt(a - 0.09);
      let tx0 = pa[0] - pb[0], ty0 = pa[1] - pb[1], tz0 = pa[2] - pb[2];
      const tl = Math.hypot(tx0, ty0, tz0) || 1; tx0 /= tl; ty0 /= tl; tz0 /= tl;
      const s0 = Math.min(1, Math.max(0, 1 - aw / 1.1));
      const sB = s0 * s0 * (3 - 2 * s0);
      const rl = Math.hypot(p[0], p[2]) || 1;
      let nx0 = (p[0] / rl) * (1 - sB), ny0 = sB, nz0 = (p[2] / rl) * (1 - sB);
      const nn = Math.hypot(nx0, ny0, nz0) || 1; nx0 /= nn; ny0 /= nn; nz0 /= nn;
      let wx = ny0 * tz0 - nz0 * ty0, wy = nz0 * tx0 - nx0 * tz0, wz = nx0 * ty0 - ny0 * tx0;
      const wl = Math.hypot(wx, wy, wz) || 1; wx /= wl; wy /= wl; wz /= wl;
      const e0 = [p[0] - wx * HW, p[1] - wy * HW, p[2] - wz * HW];
      const e1 = [p[0] + wx * HW, p[1] + wy * HW, p[2] + wz * HW];
      if (aw < 1.2) {
        e0[1] = Math.max(e0[1], ySurf3(e0[0], e0[2]) + 0.006);
        e1[1] = Math.max(e1[1], ySurf3(e1[0], e1[2]) + 0.006);
      }
      IN0.push(e0); IN1.push(e1);
      OUT0.push([e0[0] + nx0 * TH2, e0[1] + ny0 * TH2, e0[2] + nz0 * TH2]);
      OUT1.push([e1[0] + nx0 * TH2, e1[1] + ny0 * TH2, e1[2] + nz0 * TH2]);
    }
    const sv = IN0.concat(IN1, OUT0, OUT1), sf = [];
    for (let i = 0; i < NS; i++) {
      const j2 = (i + 1) % NS;
      sf.push([2 * NS + i, 2 * NS + j2, 3 * NS + j2, 3 * NS + i]);
      sf.push([i, j2, 2 * NS + j2, 2 * NS + i]);
      sf.push([NS + i, NS + j2, 3 * NS + j2, 3 * NS + i]);
    }
    collar.add(new THREE.Mesh(facesToGeo(sv, sf, false), MAT_SASH));
    for (const aa of [0.4 * Math.PI, 0.5 * Math.PI, 0.6 * Math.PI]) {
      const p = sashPt(aa);
      const shell = new THREE.Mesh(tboxGeo(0.042, 0.042, 0.1, 0.042, 0.042), MAT_GUNMETAL);
      shell.position.set(p[0], p[1] + 0.05, p[2] + 0.018);
      collar.add(shell);
    }
  }
  if (type === 'heavy') {   // armored pauldrons enclose the deltoids
    for (const sd of [-1, 1]) {
      const pd = new THREE.Mesh(loftGeo([
        { y: -0.15, rx: P.armt * 1.18, rz: P.armt * 1.08, jm: 0.4 },
        { y: 0.05, rx: P.armt * 0.55, rz: P.armt * 0.55, jm: 0.2 },
      ], 26, jit, seed), M.pelvis);
      pd.position.set(sd * (P.shld / 2 + P.armt * 0.1), 0.02, 0);
      collar.add(pd);
    }
  }
  if (type === 'sniper') {   // cloak panel down the back (hood is the head)
    const cape = new THREE.Mesh(tboxGeo(0.34, 0.44, 0.62, 0.028, 0.028), EM(0x7c0f05));
    cape.position.set(0, -0.01, -P.chest * 0.58 - 0.052);
    collar.add(cape);
  }
  if (type === 'bomber') {   // backpack + belly harness with spare grenades
    const pack = new THREE.Mesh(tboxGeo(0.36, 0.34, 0.42, 0.2, 0.18), MAT_BLACK);
    pack.position.set(0, -th * 0.12, -P.chest * 0.56 - 0.12);
    collar.add(pack);
    const NB = 14, yb = -th * 0.62;
    const bs = chestProf[1];   // belt height sits at the rib/belly ring
    const bv = [], bf = [];
    for (const half of [-0.032, 0.032])
      for (let i = 0; i < NB; i++) {
        const a = (i / NB) * Math.PI * 2;
        bv.push([Math.cos(a) * (bs.rx + 0.028), yb + half, Math.sin(a) * (bs.rz + 0.028)]);
      }
    for (let i = 0; i < NB; i++) bf.push([i, (i + 1) % NB, NB + (i + 1) % NB, NB + i]);
    collar.add(new THREE.Mesh(facesToGeo(bv, bf, false), MAT_SASH));
    for (const ga of [0.42 * Math.PI, 0.58 * Math.PI]) {
      const gr = new THREE.Mesh(tboxGeo(0.09, 0.07, 0.11, 0.09, 0.07), MAT_BLACK);
      gr.position.set(Math.cos(ga) * (bs.rx + 0.028), yb + 0.06, Math.sin(ga) * (bs.rz + 0.028) + 0.03);
      collar.add(gr);
    }
  }
  if (type === 'rocketeer') {   // shoulder-mounted launch tube + spare rockets
    const tube = new THREE.Mesh(tboxGeo(0.15, 0.13, 0.95, 0.15, 0.13), MAT_GUNMETAL);
    tube.rotation.x = -Math.PI / 2;
    tube.position.set(0.24, 0.05, -0.35);
    const muzzle = new THREE.Mesh(tboxGeo(0.19, 0.19, 0.1, 0.19, 0.19), MAT_BLACK);
    muzzle.rotation.x = -Math.PI / 2;
    muzzle.position.set(0.24, 0.05, 0.6);
    const rear = new THREE.Mesh(tboxGeo(0.11, 0.11, 0.12, 0.11, 0.11), MAT_BLACK);
    rear.rotation.x = -Math.PI / 2;
    rear.position.set(0.24, 0.05, -0.47);
    collar.add(tube, muzzle, rear);
    for (const bx of [-0.09, 0.07]) {
      const rk = new THREE.Mesh(tboxGeo(0.1, 0.08, 0.4, 0.1, 0.08), bx < 0 ? MAT_GUNMETAL : MAT_BLACK);
      rk.position.set(bx, -th * 0.1, -P.chest * 0.5 - 0.09);
      collar.add(rk);
    }
    egun = muzzle;
    armRLock = true; armRRest = -1.25;
    armR.rotation.x = -1.25; AR.fore.rotation.x = -0.75;
  }
  if (type === 'laser') {   // emitter crystal + twin antenna masts
    const cy = -0.5, cz = P.chest * 0.5 + 0.2;
    const low = new THREE.Mesh(tboxGeo(0.04, 0.15, 0.13, 0.04, 0.15), EM(0xff2d1a));
    low.position.set(0, cy, cz);
    const up = new THREE.Mesh(tboxGeo(0.15, 0.04, 0.13, 0.15, 0.04), EM(0xff2d1a));
    up.position.set(0, cy + 0.13, cz);
    collar.add(low, up);
    for (const ax of [-0.14, 0.14]) {
      const mast = new THREE.Mesh(tboxGeo(0.035, 0.028, 0.55, 0.035, 0.028), MAT_GUNMETAL);
      mast.position.set(ax, 0.18, -P.chest * 0.5 - 0.06);
      const tip = new THREE.Mesh(tboxGeo(0.05, 0.05, 0.05, 0.05, 0.05), EM(0xff2d1a));
      tip.position.set(ax, 0.24, -P.chest * 0.5 - 0.06);
      collar.add(mast, tip);
    }
    egun = up;
    armLock = true; armRLock = true; armLRest = -0.4; armRRest = -0.4;
    armL.rotation.x = -0.4; AL.fore.rotation.x = -0.5;
    armR.rotation.x = -0.4; AR.fore.rotation.x = -0.5;
  }
  if (type === 'shieldbearer') {
    // plate on the bracing side, bottom clear of the stride, right edge clear
    // of the gun arm; the left arm permanently braces it
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.25, 0.07), MAT_GUNMETAL);
    shield.position.set(-0.24, 1.125, 0.52);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.02), MAT_RED);
    slit.position.set(-0.24, 1.54, 0.555);
    g.add(shield, slit);
    armLock = true; armLRest = -0.5;
    armL.rotation.x = -0.5; AL.fore.rotation.x = -0.35;
  }

  // fake blob shadow to ground them without real-time shadow maps
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 16),
    new THREE.MeshBasicMaterial({ color: 0x16181d, transparent: true, opacity: 0.14 })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;
  g.add(blob);

  return { g, legL, legR, armL, armR, egun,
    shinL: LG.shin, shinR: RG.shin, kneeRest: EP.knee,
    armLock, armRLock, armLRest, armRRest,
    egunBaseMat: type === 'laser' ? EM(0xff2d1a) : MAT_BLACK };
}

// Per-type combat config. drop: chance of a shotgun (shotgunners only — you
// loot what they carry), or a weapon name for a guaranteed named drop.
// mul: bullet speed multiplier. armored: body shots
// bounce off — only headshots kill.
const ENEMY_TYPES = {
  gunner: { speed: 2.0, scale: [1, 1, 1], drop: 0, aimTime: 0.55, cd: [0.9, 0.8], mul: 1, pellets: 1 },
  rusher: { speed: 3.4, scale: [0.85, 0.97, 0.85], drop: 0 },
  heavy: { speed: 1.6, scale: [1.14, 1.05, 1.14], drop: 0.35, aimTime: 0.55, cd: [1.8, 1.0], mul: 1, pellets: 1, burst: 3 },
  shotgunner: { speed: 1.8, scale: [1.06, 1, 1.06], drop: 0.55, aimTime: 0.65, cd: [1.6, 0.9], mul: 0.85, pellets: 5, spread: 0.09, engage: [10, 4] },
  armored: { speed: 1.4, scale: [1.1, 1.06, 1.1], drop: 0.3, aimTime: 0.6, cd: [1.2, 0.8], mul: 1, pellets: 1, armored: true },
  sniper: { speed: 1.2, scale: [0.92, 1.05, 0.92], drop: 'sniper', aimTime: 1.35, cd: [2.4, 1.0], mul: 2.3, pellets: 1, engage: [26, 4] },
  bomber: { speed: 1.7, scale: [1.05, 1, 1.05], drop: 0, aimTime: 0.8, cd: [2.4, 1.2], mul: 1, pellets: 1, engage: [11, 5] },
  shieldbearer: { speed: 1.5, scale: [1.08, 1, 1.08], drop: 0, aimTime: 0.7, cd: [1.6, 1.0], mul: 1, pellets: 1, shielded: true },
  rocketeer: { speed: 1.4, scale: [1.05, 1.02, 1.05], drop: 0, aimTime: 1.0, cd: [3.4, 1.4], mul: 1, pellets: 1, engage: [16, 6] },
  // anchors at range, charges, then sweeps an arena-wide beam — cover won't
  // help and neither will running: killing him is the only way out
  laser: { speed: 0.9, scale: [1, 1, 1], drop: 0, aimTime: 2.6, cd: [5.0, 1.5], mul: 1, pellets: 1, engage: [30, 6], laser: true },
};

function pointInObstacle(x, z, pad) {
  for (const o of obstacles) {
    if (x > o.min.x - pad && x < o.max.x + pad && z > o.min.z - pad && z < o.max.z + pad) return true;
  }
  return false;
}

function spawnEnemy(type = 'gunner') {
  // The archive files what you MEET, not what you kill — but the attract loop
  // behind the title is a shop window, not a meeting, so the menu files
  // nothing. Otherwise every player would "know" the heavy before playing.
  if (game.state !== 'menu') recordMet([type]);
  const parts = buildEnemyMesh(type);
  const spec = ENEMY_TYPES[type];
  parts.g.scale.set(...spec.scale);
  // the wave attacks from one flank: spawn in an arc around the wave bearing
  // so the fight stays in front of you instead of whipping side to side
  let x = 0, z = 0, placed = false, holdZ;
  if (game.mode === 'hall' && hall) {
    const L = hall.legs[hall.cur], C = HALL.cell;
    // The wave's last few stage on the door approach: you fight them with
    // the door in frame, so the opening lands as visible payoff and you are
    // never left hunting for where to go next.
    const finale = game.spawnQueue.length < HALL_FINALE && L.approach && L.approach.length;
    // Everyone else comes out of the stretch the player is walking THROUGH,
    // or the next one — never the whole remaining corridor. Bodies therefore
    // travel with you down the leg instead of accumulating in whatever is
    // still ahead, which is what stacked a whole wave in front of the door.
    const approachZ = L.approach && L.approach.length ? L.approach[0][1] * HALL.cell : 1e9;
    let pool;
    if (finale) pool = L.approach;
    else if (L.stretches && L.stretches.length > 1) {
      const body = L.stretches.length - 2;   // last stretch before the approach
      const k = Math.min(playerStretch(L), body);
      const hi = Math.min(k + LEG.lookahead, body);
      const z0 = L.stretches[k].z0, z1 = L.stretches[hi].z1;
      pool = L.cells.filter(([, cgz]) =>
        cgz * C >= z0 - C && cgz * C <= z1 + C && cgz * C < approachZ - 2);
    }
    if (!pool || !pool.length) {
      pool = L.cells.filter(([, cgz]) => cgz * HALL.cell < approachZ - 2);
    }
    if (!pool.length) pool = L.cells;
    // The door's own sightline: the last approach cell, which the slab sits
    // at the end of. Anything that can see this cell can see the door open.
    const doorView = finale
      ? L.approach[L.approach.length - 1]
      : null;
    // and they hold there — see holdZ in advance(): a finale enemy may close
    // on you but never retreats back round a corner out of the door's frame
    if (finale) holdZ = approachZ - C;
    let fbX = 0, fbZ = 0, fbOk = false;
    for (let tries = 0; tries < 40 && !placed; tries++) {
      const [cgx, cgz] = pool[Math.floor(Math.random() * pool.length)];
      const px = cgx * C + (Math.random() - 0.5) * 1.6;
      const pz = cgz * C + (Math.random() - 0.5) * 1.6;
      const d = Math.hypot(px - player.pos.x, pz - player.pos.z);
      // NEVER behind you: the tunnel's whole promise is forward momentum
      if (pz < player.pos.z + PACING.aheadMin) continue;
      if (finale) {
        // no 12m floor here: if you are already deep in the approach the
        // stage still has to happen, and it has to happen where you can see
        // the door — never in a branch lane off to the side of it
        if (d < 4) continue;
        if (!hasLineOfSight(_v2.set(px, 1.4, pz),
          _v3.set(doorView[0] * C, 1.4, doorView[1] * C))) continue;
        x = px; z = pz; placed = true; break;
      }
      // a vault room is only 16 m deep: the normal 9 m floor would push
      // every refill clean out of it and back into the corridor
      const minD = (L.proto && L.proto.form && L.proto.form.id === 'vault')
        ? LEG.vaultSpawnMin : LEG.spawnMin;
      if (d < minD || d > LEG.spawnMax) continue;
      if (!hasLineOfSight(_v2.set(px, 1.4, pz), _v3.set(player.pos.x, EYE_HEIGHT, player.pos.z))) {
        x = px; z = pz; placed = true;   // prefer stepping out from cover
        break;
      }
      if (!fbOk) { fbOk = true; fbX = px; fbZ = pz; }
    }
    if (!placed && fbOk) { x = fbX; z = fbZ; placed = true; }
    if (!placed) {
      // Last resort: the furthest-ahead cell of THIS spawn's own pool. It
      // used to fall back to the door approach, which is how a whole wave
      // ended up waiting at the exit once the player outwalked its release.
      let bx = null, bz = -1e9;
      for (const [cgx, cgz] of pool) {
        if (cgz * C > bz && cgz * C >= player.pos.z + PACING.aheadMin) { bz = cgz * C; bx = cgx * C; }
      }
      if (bx !== null) { x = bx; z = bz; }
      else {   // nothing ahead at all: hand it to the approach, clamped short
        const app = L.approach && L.approach.length ? L.approach : null;
        const [cgx, cgz] = (app && app[0]) || L.cells[L.cells.length - 1];
        const cap = app ? app[app.length - 1][1] * C : cgz * C;
        x = cgx * C;
        z = Math.min(cap, Math.max(cgz * C, player.pos.z + 6));
      }
    }
    L.released = (L.released || 0) + 1;   // the stretch budget is spent here
  } else {
    // valid ground = ON a street (never a block-interior pocket the player
    // can't reach), inside the live world, and clear of buildings
    const cellLocal = (v) => v - Math.round(v / CELL) * CELL;
    const validGround = (px, pz) =>
      Math.abs(px) < PERIOD / 2 + 24 && Math.abs(pz) < PERIOD / 2 + 24 &&
      (Math.abs(cellLocal(px)) < STREET_FACE - 0.7 || Math.abs(cellLocal(pz)) < STREET_FACE - 0.7) &&
      !pointInObstacle(px, pz, 0.8);
    let fbX = 0, fbZ = 0, fbOk = false;
    for (let tries = 0; tries < 30 && !placed; tries++) {
      const a = game.waveBearing + (Math.random() - 0.5) * 1.1;   // ±32°
      const d = type === 'sniper' ? 17 + Math.random() * 6 : 13 + Math.random() * 8;
      x = player.pos.x + Math.sin(a) * d;
      z = player.pos.z + Math.cos(a) * d;
      if (!validGround(x, z)) continue;
      // prefer stepping out of cover: a spot you CAN'T see right now, so they
      // round the corner toward you instead of popping in mid-street
      if (!hasLineOfSight(_v2.set(x, 1.4, z), _v3.set(player.pos.x, EYE_HEIGHT, player.pos.z))) {
        placed = true;
        break;
      }
      if (!fbOk) { fbOk = true; fbX = x; fbZ = z; }
    }
    if (!placed && fbOk) { x = fbX; z = fbZ; placed = true; }   // visible beats invalid
    for (let tries = 0; tries < 40 && !placed; tries++) {   // any street nearby
      const a = Math.random() * Math.PI * 2;
      const d = 10 + Math.random() * 10;
      x = player.pos.x + Math.sin(a) * d;
      z = player.pos.z + Math.cos(a) * d;
      placed = validGround(x, z);
    }
    if (!placed) { x = player.pos.x * 0.5; z = player.pos.z * 0.5; }   // mid-avenue, last resort
  }
  parts.g.position.set(x, 0, z);
  scene.add(parts.g);
  // materialize: red shards fly in from thin air and assemble into the body —
  // the death shatter, reversed. It starts as a sparse dozen and accelerates,
  // shard after shard, until the swarm almost silhouettes the full figure;
  // only then does the real model take its place. Unhittable until formed.
  parts.g.visible = false;
  const shards = [];
  const sy = spec.scale[1], sxz = spec.scale[0];
  // target points sampled from the REAL body-part boxes, so the finished
  // swarm matches the model's silhouette and the reveal is near-seamless
  const PARTS = [
    [0.45, 0, 1.12, 0.44, 0.62, 0.26],     // weight, cx, cy, w, h, d — torso
    [0.12, 0, 1.62, 0.26, 0.28, 0.26],     // head
    [0.10, 0, 0.74, 0.38, 0.20, 0.24],     // hips
    [0.11, -0.11, 0.34, 0.15, 0.64, 0.17], // legs
    [0.11, 0.11, 0.34, 0.15, 0.64, 0.17],
    [0.055, -0.29, 1.15, 0.11, 0.5, 0.13], // arms
    [0.055, 0.29, 1.15, 0.11, 0.5, 0.13],
  ];
  const bodyPoint = () => {
    let pick = Math.random(), part = PARTS[0];
    for (const p of PARTS) { pick -= p[0]; if (pick <= 0) { part = p; break; } }
    return new THREE.Vector3(
      x + (part[1] + (Math.random() - 0.5) * part[3]) * sxz,
      (part[2] + (Math.random() - 0.5) * part[4]) * sy,
      z + (Math.random() - 0.5) * part[5] * sxz
    );
  };
  // tuner-approved: N_INIT 6, N_LATE 150, WINDOW 0.9T, CURVE 0.35,
  // TRAVEL 0.06s, REVEAL 0.95, RADIUS 1.1m
  const N_INIT = 6, N_LATE = 150;
  for (let i = 0; i < N_INIT + N_LATE; i++) {
    const late = i >= N_INIT;
    const it = claimShard(assemblePool, Math.random() < 0.75 ? 0xff2d1a : 0xc61703);
    const size = late ? 0.35 + Math.random() * 0.4 : 0.6 + Math.random() * 0.6;
    const a = Math.random() * Math.PI * 2;
    const r = 1.1 + Math.random() * 1.8;
    const from = new THREE.Vector3(x + Math.sin(a) * r, 0.2 + Math.random() * 2.6, z + Math.cos(a) * r);
    const to = bodyPoint();
    it.s = size;
    it.px = from.x; it.py = from.y; it.pz = from.z;
    it.rx = Math.random() * 6.28; it.ry = Math.random() * 6.28; it.rz = Math.random() * 6.28;
    it.hold = 0;
    shards.push({
      it, gen: it.gen, from, to, size,
      // hard-accelerating schedule (curve 0.35): a trickle at first, then a
      // torrent — the figure floods in right before the reveal
      activeAt: late ? ASSEMBLE_T * 0.9 * Math.pow((i - N_INIT) / N_LATE, 0.35) : 0,
      travel: late ? 0.06 : ASSEMBLE_T * 0.48,
      spin: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
      shown: !late,
    });
  }
  enemies.push({
    ...parts,
    type,
    speed: spec.speed,
    pos: parts.g.position,
    state: 'assemble',
    shards,
    stateT: 0,
    walkPhase: Math.random() * Math.PI * 2,
    strafe: Math.random() < 0.5 ? 1 : -1,
    strafeT: 1 + Math.random() * 2,
    fireCd: ((type === 'sniper' ? 1.2 : 0.3) + Math.random() * 1.1) * aimSpeedFactor(),
    engageDist: spec.engage
      ? spec.engage[0] + Math.random() * spec.engage[1]
      : 19 + Math.random() * 6,           // guns come up early — pressure from range
    burstLeft: 0,
    burstT: 0,
    tell: 0,                              // fire-telegraph heat, 0..1
    holdZ,                                // set for the door-approach finale
    alive: true,
  });
  // snipers and lasers announce every entrance; everyone else gets a warning
  // flash the first time the run meets them — new waves, new threats
  const seen = game.seenTypes || (game.seenTypes = {});
  if (type === 'sniper' || type === 'laser') {
    warnFlash([type.toUpperCase() + '.']);
    sfx.alert();   // its own stinger — sfx.wave() is the wave VO now
  } else if (!seen[type] && type !== 'gunner' && game.state !== 'menu') {
    warnFlash([type.toUpperCase() + '.']);   // silent card: the name is enough
  }
  seen[type] = true;
}

// ---------------------------------------------------------------------------
// RUSH HOUR: the street is full of black silhouettes walking their routes.
// Some are the system's sleepers. Freeze time and their bodies burn red.
// ---------------------------------------------------------------------------
const crowd = [];
const npcDebris = [];
const RUSH = {
  crowd: 30,
  ghostSpeed: 3.0,   // how much faster you move inside frozen time
  markBonus: 3,      // seconds of bank for executing the mark
  markMin: 9, markMax: 34,   // how far away a new mark may hide
};
let rushT = 0, nextSleeperT = 5;
const MAT_CROWD = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
const MAT_REVEAL = new THREE.MeshBasicMaterial({ color: 0xff2d1a });
// the mark burns white-hot: the one face in the crowd you are hunting
const MAT_MARK = new THREE.MeshBasicMaterial({ color: 0xffffff });
let rushMark = null, markPips = 0, markRespawnT = 0;
const markPin = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.34),
  new THREE.MeshBasicMaterial({ color: 0xff2d1a })
);
markPin.visible = false;
scene.add(markPin);

function spawnNPC(anywhere = false) {
  const parts = buildEnemyMesh('gunner');
  const horiz = Math.random() < 0.5;
  // pedestrians keep to the sidewalks: the band between the curb and the
  // shopfronts, on either side of the road
  const side = Math.random() < 0.5 ? -1 : 1;
  // the crowd walks the street the PLAYER is on: snap the lane to the
  // avenue of the city grid nearest to them (streets repeat every CELL)
  const perp = horiz ? player.pos.z : player.pos.x;
  const lane = Math.round(perp / CELL) * CELL +
    side * (CITY.street / 2 + 0.8 + Math.random() * 0.8);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const n = { ...parts, horiz, lane, dir, pos: parts.g.position,
    walkPhase: Math.random() * 6.28, sleeper: Math.random() < 0.55, revealed: false,
    speed: 1.0 + Math.random() * 0.6 };
  const pAlong = horiz ? player.pos.x : player.pos.z;
  const along = pAlong + (anywhere
    ? (Math.random() * 2 - 1) * (ARENA_HALF - 1)
    : -dir * (ARENA_HALF - 0.6));
  if (horiz) n.pos.set(along, 0, lane); else n.pos.set(lane, 0, along);
  if (Math.hypot(n.pos.x - player.pos.x, n.pos.z - player.pos.z) < 4) n.pos.x += 6;
  n.g.traverse(o => { if (o.isMesh) { if (!o.userData.m0) o.userData.m0 = o.material; o.material = MAT_CROWD; } });
  if (n.egun) n.egun.visible = false;   // civilians are unarmed — until they aren't
  scene.add(n.g);
  crowd.push(n);
}
function clearCrowd() {
  for (const n of crowd) scene.remove(n.g);
  crowd.length = 0;
  for (const d of npcDebris) scene.remove(d.m);
  npcDebris.length = 0;
}
function shatterNPC(n) {
  scene.remove(n.g);
  for (let i = 0; i < 12; i++) {
    const m2 = new THREE.Mesh(shardGeo, MAT_CROWD);
    m2.position.set(n.pos.x, 0.4 + Math.random() * 1.2, n.pos.z);
    m2.scale.setScalar(0.5 + Math.random() * 0.5);
    scene.add(m2);
    npcDebris.push({ m: m2, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 3,
      vz: (Math.random() - 0.5) * 5, t: 0 });
  }
  vibrate(10);
}
function activateSleeper(n) {
  // the mask comes off: the crystal body returns, and it joins the fight
  n.g.traverse(o => { if (o.isMesh && o.userData.m0) o.material = o.userData.m0; });
  if (n.egun) n.egun.visible = true;   // the gun appears with the red
  const idx = crowd.indexOf(n);
  if (idx >= 0) crowd.splice(idx, 1);
  enemies.push({
    g: n.g, legL: n.legL, legR: n.legR, armL: n.armL, armR: n.armR, egun: n.egun,
    shinL: n.shinL, shinR: n.shinR, kneeRest: n.kneeRest,
    armLock: false, armRLock: false, armLRest: 0, armRRest: 0, egunBaseMat: n.egunBaseMat,
    type: 'gunner', speed: 2.0, pos: n.g.position, state: 'advance', shards: [],
    stateT: 0, walkPhase: n.walkPhase, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 1.5,
    fireCd: 0.35, engageDist: 26, burstLeft: 0, burstT: 0, alive: true,
  });
  spawnNPC();
}
function initRush() {
  game.wave = 1;
  game.state = 'intro';
  game.stateT = 0;
  game.introLen = 1.2;
  game.spawnQueue = [];
  clearCrowd();
  rushT = 0; nextSleeperT = 5;
  rushMark = null; markPips = 0; markRespawnT = 1.5;
  markPin.visible = false;
  for (let i = 0; i < RUSH.crowd; i++) spawnNPC(true);
  el.pausebtn.style.display = 'block';
  el.ammo.style.display = '';
  setTimeLocked(false);
  slowBank = SLOWMO.base;
  updateSlowMeter();
  updateModeUI();   // shows the time button + meter in button mode
  showBanner('FREEZE AND WALK THROUGH THEM', 2800);
}
// THE MARK: one face in the crowd is the one that matters. It only shows
// itself inside frozen time, so the loop is — freeze, ghost through the
// crowd at speed, find the white one, execute, let time go.
function pickMark() {
  const pool = crowd.filter((n) => {
    if (!n.sleeper) return false;
    const d = Math.hypot(n.pos.x - player.pos.x, n.pos.z - player.pos.z);
    return d > RUSH.markMin && d < RUSH.markMax;
  });
  if (!pool.length) return;
  rushMark = pool[Math.floor(Math.random() * pool.length)];
  markPin.visible = false;
  showBanner('FREEZE TO FIND THE MARK', 1800);
  sfx.alert();
}

function updateMark(sdt, slow) {
  // the pin floats over the mark, but only while time is frozen — at full
  // speed they are just another body in the crowd
  if (rushMark && crowd.includes(rushMark)) {
    markPin.visible = slow;
    if (slow) {
      markPin.position.set(rushMark.pos.x, 2.35 + Math.sin(rushT * 3) * 0.08, rushMark.pos.z);
      markPin.rotation.y += sdt * 2.5;
    }
  } else {
    if (rushMark) rushMark = null;   // shattered, activated or recycled away
    markPin.visible = false;
    markRespawnT -= sdt;
    if (markRespawnT <= 0) { pickMark(); markRespawnT = 4; }
  }
}

function markDown() {
  markPips++;
  slowBank = Math.min(SLOWMO.cap, slowBank + RUSH.markBonus);
  updateSlowMeter();
  rushMark = null;
  markPin.visible = false;
  markRespawnT = 3.5;
  showBanner('MARK DOWN · +' + RUSH.markBonus + 'S', 1400);
  vibrate([20, 40, 20]);
}

function updateCrowd(sdt) {
  const slow = timeScale < 0.55;
  for (let i = crowd.length - 1; i >= 0; i--) {
    const n = crowd[i];
    const vx = n.horiz ? n.dir : 0, vz = n.horiz ? 0 : n.dir;
    n.pos.x += vx * n.speed * sdt;
    n.pos.z += vz * n.speed * sdt;
    n.g.rotation.y = Math.atan2(vx, vz);
    n.walkPhase += sdt * 7;
    const sw = Math.sin(n.walkPhase) * 0.55;
    n.legL.rotation.x = sw; n.legR.rotation.x = -sw;
    n.shinL.rotation.x = n.kneeRest + Math.max(0, -Math.cos(n.walkPhase)) * 0.5;
    n.shinR.rotation.x = n.kneeRest + Math.max(0, Math.cos(n.walkPhase)) * 0.5;
    n.armL.rotation.x = -sw * 0.5;
    n.armR.rotation.x = sw * 0.5;
    if (n.sleeper && n.revealed !== slow) {
      n.revealed = slow;
      const m = slow ? (n === rushMark ? MAT_MARK : MAT_REVEAL) : MAT_CROWD;
      n.g.traverse(o => { if (o.isMesh) o.material = m; });
    }
    // walked out of the player's stretch of street (or the player moved on,
    // possibly to a different avenue): recycle them near the player
    const pAlong = n.horiz ? player.pos.x : player.pos.z;
    const pPerp = n.horiz ? player.pos.z : player.pos.x;
    const nPerp = n.horiz ? n.pos.z : n.pos.x;
    if (Math.abs((n.horiz ? n.pos.x : n.pos.z) - pAlong) > ARENA_HALF + 4 ||
        Math.abs(nPerp - pPerp) > ARENA_HALF + 4) {
      scene.remove(n.g); crowd.splice(i, 1); spawnNPC();
    }
  }
  while (crowd.length + enemies.length < RUSH.crowd) spawnNPC();
  updateMark(sdt, slow);
  for (let i = npcDebris.length - 1; i >= 0; i--) {
    const d = npcDebris[i]; d.t += sdt;
    d.vy -= 12 * sdt;
    d.m.position.x += d.vx * sdt; d.m.position.y += d.vy * sdt; d.m.position.z += d.vz * sdt;
    d.m.rotation.x += 5 * sdt; d.m.rotation.z += 4 * sdt;
    if (d.m.position.y < 0 || d.t > 1.2) { scene.remove(d.m); npcDebris.splice(i, 1); }
  }
  if (game.state !== 'play') return;
  rushT += sdt;
  nextSleeperT -= sdt;
  if (nextSleeperT <= 0) {
    // clusters, not a metronome: a knot of sleepers near you turns at once,
    // then the street goes quiet long enough to deal with them before the
    // next knot wakes further on
    nextSleeperT = Math.max(4, 10 - rushT * 0.045) * (0.8 + Math.random() * 0.5);
    const want = 1 + (rushT > 30 ? 1 : 0) + (rushT > 90 ? 1 : 0);
    let best = null, bd = 1e9;
    for (const n of crowd) {
      if (!n.sleeper) continue;
      const d = Math.hypot(n.pos.x - player.pos.x, n.pos.z - player.pos.z);
      if (d > 5 && d < 26 && d < bd) { bd = d; best = n; }
    }
    if (best) {
      const cluster = [best];
      for (const n of crowd) {
        if (cluster.length >= want) break;
        if (n === best || !n.sleeper) continue;
        if (Math.hypot(n.pos.x - best.pos.x, n.pos.z - best.pos.z) < 9) cluster.push(n);
      }
      for (const n of cluster) activateSleeper(n);
      sfx.alert();
    }
  }
}

const ASSEMBLE_T = 0.25;      // seconds (world time) for a spawn to pull together
const ASSEMBLE_REVEAL = 0.95; // fraction of T when the body appears under the
                              // shards, which then shrink into its surface —
                              // the swap reads as a settle, not a pop

function removeEnemyShards(e) {
  if (!e.shards) return;
  for (const s of e.shards) {
    if (s.it.gen !== s.gen) continue;   // already recycled to someone else
    s.it.on = false;
    assemblePool.mesh.setMatrixAt(s.it.idx, HIDDEN);
  }
  assemblePool.mesh.instanceMatrix.needsUpdate = true;
  e.shards = null;
}

function killEnemy(i, impulseDir) {
  const e = enemies[i];
  // Kill the glow on the same frame. In the reference an enemy shot mid-aim
  // goes flat red instantly, and that snap is what makes an interrupted
  // telegraph read as interrupted rather than as a death animation.
  removeEnemyShards(e);   // a mid-assembly kill (menu demo) must not leak shards
  removeBeam(e);          // shattering the laser cuts his sweep instantly
  if (timeMode === 'toggle' && (game.state === 'play' || game.state === 'intro')) {
    // kills buy time — but they buy LESS of it as you go deeper, which is
    // what turns the freeze from a habit into a decision
    slowBank = Math.min(SLOWMO.cap,
      slowBank + SLOWMO.bonus * scarcity('timeGain', game.mode === 'hall' ? game.wave : 1)
        * condTax(legCondition(), 'timeGain'));
  }
  if (game.state !== 'menu') vibrate(15);   // every kill lands in the thumb
  spawnShatter(e.pos, impulseDir);
  const drop = ENEMY_TYPES[e.type].drop;
  const kind = TYPE_DROP[e.type];
  const r = Math.random();
  // Only someone who was carrying a gun can leave ammo behind. A rusher
  // comes at you with his hands, so a pistol clip dropping off his body was
  // loot appearing from nowhere.
  const armed = e.type !== 'rusher';
  // SCARCITY: the tap closes with depth. This is the lever the whole game
  // hangs off — once clips stop arriving you start hiding, picking shots and
  // spending the freeze to line them up, which is the actual game.
  //
  // A CONDITION taxes the same curves a second time. Fog and blackout used to
  // change only what you could see, which makes them a lighting effect; what
  // makes them conditions is that they change what you can afford. A fog leg
  // at door 6 pays the door-6 rate AND the fog rate.
  const door = game.mode === 'hall' ? game.wave : 1;
  const cond = legCondition();
  if (typeof drop === 'string') spawnPickup(e.pos, drop);           // named loot
  else if (kind && r < drop * scarcity('weaponDrop', door) * condTax(cond, 'weaponDrop')) {
    spawnPickup(e.pos, kind);
  } else if (armed && r < DROPS.clipRate * scarcity('ammoDrop', door) * condTax(cond, 'ammoDrop')) {
    spawnPickup(e.pos, CLIP);
  }
  scene.remove(e.g);
  enemies.splice(i, 1);
  game.kills++;
  // the flow: a kill pulls the next spawn forward, so the street never
  // stays empty for long
  if (game.mode !== 'rush' && game.state === 'play') {
    game.spawnTimer = Math.min(game.spawnTimer, PACING.killPullMin + Math.random() * PACING.killPullRange);
  }
  killWord();
  sfx.shatter();
  vibrate(30);
}

// The last moment ANY enemy pulled a trigger. Two of them resolving their
// telegraphs on the same frame reads as one loud event you cannot parse;
// the same two shots a beat apart read as a room reacting to you. So the
// room holds a single floor: whoever is second waits his turn.
let lastEnemyShotAt = -1e9;
let worldT = 0;
// measured in WORLD seconds, not real ones: in bullet time the gap has to
// stretch with everything else or the stagger collapses the moment you freeze
const ENEMY_SHOT_GAP = 0.28;

// Early doors fire ONE round at a time: nobody pulls a trigger while a round
// is still on its way to you. "Still on its way" is a direction test, not a
// distance one — a round that has already gone past is no longer something
// you have to answer, and waiting on it would stall the fight.
const _vFlight = new THREE.Vector3();
function earlyRoundInFlight() {
  if (game.mode !== 'hall' || game.wave > EARLY.oneRoundDoors) return false;
  for (const b of bullets) {
    if (b.fromPlayer) continue;
    _vFlight.set(player.pos.x - b.pos.x, 0, player.pos.z - b.pos.z);
    if (b.vel.x * _vFlight.x + b.vel.z * _vFlight.z > 0) return true;
  }
  return false;
}

function enemyFire(e, toPlayer) {
  const spec = ENEMY_TYPES[e.type];
  if (e.type === 'laser') {   // the charge completes: begin the sweep
    startBeam(e);
    return;
  }
  if (e.type === 'bomber') {   // bombers lob instead of shooting
    spawnGrenade(e);
    return;
  }
  if (e.type === 'rocketeer') {   // rocketeers launch a homing missile
    spawnMissile(e);
    return;
  }
  // Rounds leave the muzzle, pointing where the muzzle points. The
  // shield-bearer slews slowly, so if he has not finished turning the shot
  // simply does not happen — no more firing sideways out of his ribs.
  const fx = Math.sin(e.g.rotation.y), fz = Math.cos(e.g.rotation.y);
  if (fx * toPlayer.x + fz * toPlayer.z < 0.94) {
    e.fireCd = 0.25;   // still coming round: hold
    return;
  }
  lastEnemyShotAt = worldT;   // the room's shot floor: everyone else waits
  const origin = _v2.set(e.pos.x, 1.35, e.pos.z).addScaledVector(toPlayer, 0.45);
  // shots go where you ARE — if you don't slide out of the way, they connect
  const target = _v3.set(
    player.pos.x + (Math.random() - 0.5) * 0.24,
    EYE_HEIGHT - 0.25 + (Math.random() - 0.5) * 0.24,
    player.pos.z + (Math.random() - 0.5) * 0.24
  );
  const baseDir = target.sub(origin).normalize();
  for (let p = 0; p < (spec.pellets || 1); p++) {
    const d = baseDir.clone();
    if (spec.spread) {
      d.x += (Math.random() - 0.5) * 2 * spec.spread;
      d.y += (Math.random() - 0.5) * 2 * spec.spread;
      d.z += (Math.random() - 0.5) * 2 * spec.spread;
      d.normalize();
    }
    spawnBullet(origin, d, false, (spec.mul || 1) * tutorBulletScale());
  }
  muzzleFlash(origin.x, origin.y, origin.z, 0.85);
  sfx.enemyShot();
}

// Telegraph flash: shotgunners light up both muzzle tips; other grouped guns
// flash their first barrel; a bare mesh (bomber's grenade) flashes whole.
function setEgunFlash(e, mat) {
  // "off" restores the gun's own base material (the laser's crystal is red)
  const m = mat === MAT_BLACK ? (e.egunBaseMat || MAT_BLACK) : mat;
  const tips = e.egun.isGroup && e.egun.userData.flash;
  if (tips) {
    for (const t of tips) t.material = m;
    return;
  }
  (e.egun.isGroup ? e.egun.children[0] : e.egun).material = m;
}

// One dial for the whole difficulty curve: 0 on wave 1, 1 by wave 8.
// Rush hour has no waves, so it ramps on the run clock instead (~3 minutes
// to full heat).
function diffT() {
  const w = game.mode === 'rush' ? 1 + rushT / 25 : game.wave;
  return Math.min((w - 1) / RAMP.rampWaves, 1);
}

// Enemy rounds open slow enough to sidestep at a walk (wave 1: ~55% speed),
// reach full pace by wave 8, then keep creeping (+2%/wave, capped at +35%).
function enemyBulletSpeed() {
  const w = game.mode === 'rush' ? 1 + rushT / 25 : game.wave;
  const late = Math.max(0, w - (RAMP.rampWaves + 1)) * RAMP.lateCreep;
  return RAMP.bulletBase * Math.min(RAMP.bulletFloor + RAMP.bulletRange * diffT() + late, RAMP.bulletCap);
}

// Telegraphs and cooldowns ride the same dial: leisurely on the opening
// waves (x1.15), tightening to ~x0.5 by wave 8.
function aimSpeedFactor() {
  return RAMP.aimBase - RAMP.aimRange * diffT();
}

// Same slab push-out the player uses: an enemy can never end a frame inside
// a wall block, no matter what the steering did.
function resolveEnemyCollisions(e) {
  const r = 0.5;
  const lim = LIVE_BOUND;   // free-roam, but never further than the live zone
  e.pos.x = Math.min(Math.max(e.pos.x, player.pos.x - lim), player.pos.x + lim);
  e.pos.z = Math.min(Math.max(e.pos.z, player.pos.z - lim), player.pos.z + lim);
  for (const o of obstacles) {
    if (e.pos.x > o.min.x - r && e.pos.x < o.max.x + r &&
        e.pos.z > o.min.z - r && e.pos.z < o.max.z + r) {
      const dxl = e.pos.x - (o.min.x - r), dxr = (o.max.x + r) - e.pos.x;
      const dzl = e.pos.z - (o.min.z - r), dzr = (o.max.z + r) - e.pos.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) e.pos.x = o.min.x - r;
      else if (m === dxr) e.pos.x = o.max.x + r;
      else if (m === dzl) e.pos.z = o.min.z - r;
      else e.pos.z = o.max.z + r;
    }
  }
}

function updateEnemy(e, sdt) {
  const toPlayer = _v1.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z);
  const dist = toPlayer.length();
  toPlayer.normalize();
  const wantYaw = Math.atan2(toPlayer.x, toPlayer.z);
  if (ENEMY_TYPES[e.type].shielded) {
    // The shield is only beatable if you can outpace his pivot: he slews at a
    // fixed rate (in world time, so bullet time helps you circle him).
    let dYaw = wantYaw - e.g.rotation.y;
    dYaw = ((dYaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const maxTurn = 0.7 * sdt;   // slow slew: circling him is a real option
    e.g.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, dYaw));
  } else {
    e.g.rotation.y = wantYaw;
  }
  e.stateT += sdt;
  e.fireCd -= sdt;

  let moveSpeed = 0;

  if (e.beam) updateBeam(e, sdt);   // the sweep, if one is live

  // a burst, once started, always completes — no melee interrupt mid-volley.
  // Rushers never use this: their whole attack is the telegraphed lunge.
  if (dist < 1.5 && e.type !== 'rusher' &&
      e.state !== 'melee' && e.state !== 'burst' && e.state !== 'assemble') {
    e.state = 'melee'; e.stateT = 0;
  }
  if (e.lungeCd) e.lungeCd -= sdt;

  switch (e.state) {
    case 'assemble': {
      // shards converge from thin air into the body — the shatter, reversed.
      // Each shard has its own arrival time, so the figure fills in piece by
      // piece until the swarm almost IS the enemy. In the final stretch the
      // real model fades up UNDERNEATH the shards while they shrink into its
      // surface, so there is no visible pop — just a settle.
      const shrinkP = Math.max(0, (e.stateT / ASSEMBLE_T - ASSEMBLE_REVEAL) / (1 - ASSEMBLE_REVEAL));
      if (shrinkP > 0) e.g.visible = true;
      for (const s of e.shards) {
        const it = s.it;
        if (!it.on) continue;
        if (it.gen !== s.gen) continue;          // recycled out from under us
        if (e.stateT < s.activeAt) {              // has not flown in yet
          assemblePool.mesh.setMatrixAt(it.idx, HIDDEN);
          continue;
        }
        s.shown = true;
        const p = Math.min((e.stateT - s.activeAt) / s.travel, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        it.px = s.from.x + (s.to.x - s.from.x) * ease;
        it.py = s.from.y + (s.to.y - s.from.y) * ease;
        it.pz = s.from.z + (s.to.z - s.from.z) * ease;
        it.rx += s.spin.x * sdt * (1 - ease);
        it.ry += s.spin.y * sdt * (1 - ease);
        it.rz += s.spin.z * sdt * (1 - ease);
        if (shrinkP > 0) it.s = s.size * (1 - shrinkP);
        writeShard(assemblePool, it);
      }
      assemblePool.mesh.instanceMatrix.needsUpdate = true;
      if (e.stateT >= ASSEMBLE_T) {
        removeEnemyShards(e);
        e.g.visible = true;
        e.state = 'advance';
        e.stateT = 0;
      }
      return;   // not hittable, not moving, not shooting yet
    }
    case 'advance': {
      moveSpeed = e.speed;
      e.strafeT -= sdt;
      if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = 1 + Math.random() * 2; }
      // in the tunnel, walk the corridor graph; elsewhere press straight in
      const flow = game.mode === 'hall' ? hallSteer(e) : null;
      const strafeDir = _v2.set(-toPlayer.z, 0, toPlayer.x)
        .multiplyScalar(e.strafe * (flow ? 0.12 : 0.55));
      const dir = _v3.copy(flow || toPlayer).add(strafeDir).normalize();
      // Steer around cover, pushing away from the NEAREST POINT on each box
      // rather than its centre. A wall segment is 4 m long, so its centre can
      // be metres away along the wall — the repulsion pointed sideways
      // instead of outwards, and at a corner two segments pushed in
      // contradicting directions. That is the jitter against walls.
      for (const o of obstacles) {
        const nx = Math.min(Math.max(e.pos.x, o.min.x), o.max.x);
        const nz = Math.min(Math.max(e.pos.z, o.min.z), o.max.z);
        const dx = e.pos.x - nx, dz = e.pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < 4) {
          const inv = 0.9 / Math.max(Math.sqrt(d2), 0.35);
          dir.x += dx * inv * 0.4; dir.z += dz * inv * 0.4;
        }
      }
      // separation from other enemies
      for (const o of enemies) {
        if (o === e) continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 4 && d2 > 1e-4) {
          const inv = 1 / Math.sqrt(d2);
          dir.x += dx * inv * 0.8; dir.z += dz * inv * 0.8;
        }
      }
      dir.normalize();
      // Smooth the heading. Flow fields snap between cells and repulsion
      // fights itself in corners; without this an enemy can shiver in place
      // instead of walking. Fast enough to still turn on a corner.
      if (!e.dirS) e.dirS = dir.clone();
      else e.dirS.lerp(dir, Math.min(1, sdt * 9)).normalize();
      dir.copy(e.dirS);
      // The last few of a wave hold the door approach. They may close on you
      // and they may strafe, but they never walk back down the corridor and
      // round a corner — so the fight that opens the door is always fought
      // with the door in frame.
      if (e.holdZ !== undefined && dir.z < 0 && e.pos.z <= e.holdZ) dir.z = 0;
      e.pos.x += dir.x * moveSpeed * sdt;
      e.pos.z += dir.z * moveSpeed * sdt;
      resolveEnemyCollisions(e);   // hard guarantee: steering can fail, this can't

      if (e.type === 'rusher' && dist < 3.4 && (e.lungeCd || 0) <= 0) {
        e.state = 'windup'; e.stateT = 0;
        break;
      }
      // visibility grace: stepping out of cover doesn't mean instant fire —
      // you get a beat to SEE him before his telegraph may even begin
      const los = hasLineOfSight(_v2.set(e.pos.x, 1.35, e.pos.z),
        _v3.set(player.pos.x, EYE_HEIGHT - 0.3, player.pos.z));
      e.seenT = los ? (e.seenT || 0) + sdt : 0;
      if (e.type !== 'rusher' && dist < e.engageDist && e.fireCd <= 0 &&
          (!ENEMY_TYPES[e.type].shielded || Math.cos(e.g.rotation.y - wantYaw) > 0.8) &&
          performance.now() >= game.noFireBefore && !tutorHoldsFire() &&
          !earlyRoundInFlight() &&
          los && e.seenT > RAMP.sightGrace) {
        // take turns on the trigger: only a couple of guns telegraph at once,
        // so fire arrives as a steady stream you can dodge, never a volley
        let aiming = 0;
        for (const o of enemies) if (o.state === 'aim' || o.state === 'burst') aiming++;
        if (aiming >= 2 + Math.floor(game.wave / 4)) {
          e.fireCd = 0.25 + Math.random() * 0.45;   // wait for a lane
        } else {
          e.state = 'aim'; e.stateT = 0;
        }
      }
      break;
    }
    case 'aim': {
      // telegraph: raise the gun arm, flash the gun white just before firing
      const spec = ENEMY_TYPES[e.type];
      const aimT = spec.aimTime * aimSpeedFactor();
      const t = Math.min(e.stateT / aimT, 1);
      if (!e.armRLock) e.armR.rotation.x = -t * (Math.PI / 2 - 0.06);
      setEgunFlash(e, e.stateT > aimT * 0.7 ? MAT_WHITEFLASH : MAT_BLACK);
      if (e.stateT >= aimT) {
        // Someone else just pulled a trigger? Hold, arm still up, and take
        // your turn a beat later. Two shots on the same frame read as one
        // loud event you cannot parse. The 0.6 s ceiling stops a crowd from
        // deadlocking each other into never firing at all.
        const held = e.holdFireT || 0;
        if (worldT - lastEnemyShotAt < ENEMY_SHOT_GAP && held < 0.6) {
          e.holdFireT = held + sdt;
        } else {
          e.holdFireT = 0;
          enemyFire(e, toPlayer);
          setEgunFlash(e, MAT_BLACK);
          if (spec.burst) {   // heavies always fire exactly spec.burst rounds
            e.state = 'burst'; e.stateT = 0;
            e.burstLeft = spec.burst - 1; e.burstT = 0.22;
          } else {
            e.state = 'recover'; e.stateT = 0;
            e.fireCd = (spec.cd[0] + Math.random() * spec.cd[1]) * aimSpeedFactor();
          }
        }
      }
      break;
    }
    case 'burst': {
      e.burstT -= sdt;
      if (e.burstT <= 0) {
        enemyFire(e, toPlayer);
        e.burstLeft--;
        e.burstT = 0.22;
        if (e.burstLeft <= 0) {
          const spec = ENEMY_TYPES[e.type];
          e.state = 'recover'; e.stateT = 0;
          e.fireCd = (spec.cd[0] + Math.random() * spec.cd[1]) * aimSpeedFactor();
        }
      }
      break;
    }
    case 'recover': {
      // relax each arm back toward its own rest pose (braced arms have one)
      if (!e.armRLock) e.armR.rotation.x = Math.min(0, e.armR.rotation.x + sdt * 4.5);
      e.armL.rotation.x += ((e.armLRest || 0) - e.armL.rotation.x) * Math.min(1, sdt * 6);
      if (e.stateT >= 0.5) { e.state = 'advance'; e.stateT = 0; }
      break;
    }
    case 'melee': {
      e.armL.rotation.x = -Math.min(e.stateT / 0.45, 1) * 2.2;   // windup swing
      if (e.stateT >= 0.45) {
        if (dist < 1.8) hitPlayer();
        e.state = 'recover'; e.stateT = 0;
      }
      break;
    }
    case 'windup': {
      // the rusher's tell: he plants, coils, and the claw reaches back.
      // In slow motion it reads like a sentence; at full speed it's a beat.
      const t = Math.min(e.stateT / 0.55, 1);
      e.armR.rotation.x = t * 1.5;
      if (e.stateT >= 0.55) {
        e.state = 'lunge'; e.stateT = 0;
        e.lungeYaw = wantYaw;                 // committed: he flies where you WERE
        e.lungeDx = toPlayer.x; e.lungeDz = toPlayer.z;
      }
      break;
    }
    case 'lunge': {
      e.g.rotation.y = e.lungeYaw;
      e.armR.rotation.x = 1.5 - Math.min(e.stateT / 0.14, 1) * 3.8;   // the swipe
      e.pos.x += e.lungeDx * 10.5 * sdt;
      e.pos.z += e.lungeDz * 10.5 * sdt;
      resolveEnemyCollisions(e);
      if (dist < 1.35 || e.stateT >= 0.34) {
        if (dist < 1.35) hitPlayer();
        e.state = 'lungerest'; e.stateT = 0; e.lungeCd = 1.5;
      }
      break;
    }
    case 'lungerest': {
      // overextended: claws down, wide open — the free-kill window
      e.armR.rotation.x += (0 - e.armR.rotation.x) * Math.min(1, sdt * 5);
      if (e.stateT >= 0.6) { e.state = 'advance'; e.stateT = 0; }
      break;
    }
  }

  // walk cycle: legs swing at the hip, knees fold on the recovery leg (the
  // wedge shoes are rigid at 90° to the shin, tuner-approved)
  if (moveSpeed > 0) {
    e.walkPhase += sdt * 9;
    const sw = Math.sin(e.walkPhase) * 0.6;
    e.legL.rotation.x = sw;
    e.legR.rotation.x = -sw;
    if (e.shinL) {
      e.shinL.rotation.x = e.kneeRest + Math.max(0, -Math.cos(e.walkPhase)) * 0.55;
      e.shinR.rotation.x = e.kneeRest + Math.max(0, Math.cos(e.walkPhase)) * 0.55;
    }
    if (!e.armLock) e.armL.rotation.x = -sw * 0.5;
  } else {
    e.legL.rotation.x *= 0.9;
    e.legR.rotation.x *= 0.9;
    if (e.shinL) {
      e.shinL.rotation.x += (e.kneeRest - e.shinL.rotation.x) * 0.1;
      e.shinR.rotation.x += (e.kneeRest - e.shinR.rotation.x) * 0.1;
    }
  }
}

const MAT_WHITEFLASH = new THREE.MeshBasicMaterial({ color: 0xffffff });

// ---------------------------------------------------------------------------
// The laser's sweeping beam: an arena-length line pivoting slowly around the
// emitter. It ignores cover, and the sweep spans the whole field — the only
// way out is to shatter the emitter before the line reaches you.
// ---------------------------------------------------------------------------
const BEAM_LEN = 60, BEAM_SWEEP = 2.2, BEAM_TIME = 6.5;
function startBeam(e) {
  const base = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const gGroup = new THREE.Group();
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, BEAM_LEN), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, BEAM_LEN),
    new THREE.MeshBasicMaterial({ color: 0xff2d1a, transparent: true, opacity: 0.55 }));
  core.position.z = BEAM_LEN / 2;
  glow.position.z = BEAM_LEN / 2;
  gGroup.add(glow, core);
  gGroup.position.set(e.pos.x, 1.05, e.pos.z);
  scene.add(gGroup);
  e.beam = { g: gGroup, angle: base - (BEAM_SWEEP / 2) * dir, dir, t: 0 };
  sfx.alert();   // the same spine-tap the sniper gets — you have seconds
}
function updateBeam(e, sdt) {
  const b = e.beam;
  b.t += sdt;
  b.angle += (BEAM_SWEEP / BEAM_TIME) * b.dir * sdt;
  b.g.position.set(e.pos.x, 1.05, e.pos.z);
  b.g.rotation.y = b.angle;
  // distance from the player to the beam ray, in the ground plane
  const dx = Math.sin(b.angle), dz = Math.cos(b.angle);
  const px = player.pos.x - e.pos.x, pz = player.pos.z - e.pos.z;
  const t = px * dx + pz * dz;
  if (t > 0 && t < BEAM_LEN) {
    const d = Math.abs(px * dz - pz * dx);
    if (d < 0.35 && player.alive) hitPlayer();
  }
  if (b.t >= BEAM_TIME) removeBeam(e);
}
function removeBeam(e) {
  if (!e.beam) return;
  scene.remove(e.beam.g);
  e.beam = null;
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------
const _dir = new THREE.Vector3();
// tap buffering: a tap that lands during the fire cooldown is BANKED for a
// beat instead of dropped, so rapid tapping fires at the weapon's full rate
let pendingFireUntil = 0;
function playerFire() {
  if (!player.alive || game.state !== 'play') return;
  if (tutorHoldsPlayerFire()) return;   // no weapon on screen yet, no round
  if (player.reloadT > 0) return;                       // hands are busy
  if (player.fireCd > 0) { pendingFireUntil = performance.now() + 300; return; }
  const spec = WEAPONS[player.weapon];
  if (spec.melee) { knifeStrike(spec); return; }
  if (player.mag <= 0) { startReload(); return; }       // dry: rack a new mag
  player.fireCd = spec.cd;
  camera.getWorldDirection(_dir);
  // fire from the gun muzzle, converging on the crosshair ~30m out, so the
  // bullet doesn't hang in front of the lens when time is frozen
  camera.updateMatrixWorld();
  const origin = muzzle.getWorldPosition(new THREE.Vector3());
  const aimPoint = camera.position.clone().addScaledVector(_dir, 30);
  const baseDir = aimPoint.sub(origin).normalize();
  for (let p = 0; p < spec.pellets; p++) {
    const d = baseDir.clone();
    if (spec.spread) {
      d.x += (Math.random() - 0.5) * 2 * spec.spread;
      d.y += (Math.random() - 0.5) * 2 * spec.spread;
      d.z += (Math.random() - 0.5) * 2 * spec.spread;
      d.normalize();
    }
    if (spec.blast) spawnPlayerShell(origin, d, spec);
    else spawnBullet(origin, d, true, spec.speed, spec.pierce || 0);
  }
  gunKick = spec.kick;
  muzzle.material.opacity = 1;
  tutorFired = true;
  // your own shot lights the room too — the flash sits a little ahead of the
  // camera rather than at the viewmodel, so it throws light down the corridor
  // instead of blowing out the gun in your hands
  {
    const mp = muzzle.getWorldPosition(_vMuz);
    muzzleFlash(mp.x, mp.y, mp.z, 1);
  }
  sfx.shot(player.weapon);
  vibrate(spec.pellets > 1 ? 26 : 12);
  // the heavy fires a staggered burst, the way its owner does — three
  // rounds in quick succession, not a shotgun's single cloud
  if (spec.burst) {
    for (let k = 1; k < spec.burst; k++) {
      setTimeout(() => {
        if (!player.alive || game.state !== 'play') return;
        const d2 = baseDir.clone();
        d2.x += (Math.random() - 0.5) * 2 * spec.spread;
        d2.y += (Math.random() - 0.5) * 2 * spec.spread;
        d2.z += (Math.random() - 0.5) * 2 * spec.spread;
        spawnBullet(muzzle.getWorldPosition(new THREE.Vector3()), d2.normalize(), true, spec.speed, 0);
        gunKick = spec.kick * 0.7;
        sfx.shot(player.weapon);
      }, k * spec.burstGap * 1000);
    }
  }
  player.mag--;
  updateAmmoHud();
  if (player.mag <= 0) {
    if (player.clips > 0) startReload();   // auto-rack the moment it goes dry
    else dropToKnife();                    // nothing left to rack
  }
}

// The knife: a short lunge-free slash with real reach. No ammo, no reload,
// but you have to be close enough to smell them.
function knifeStrike(spec) {
  player.fireCd = spec.cd;
  jabT = 1;                  // a thrust, not a recoil
  camera.getWorldDirection(_dir);
  sfx.swipe();
  vibrate(12);
  let best = -1, bestD = 1e9;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.state === 'assemble') continue;
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > spec.melee) continue;
    if ((dx / d) * _dir.x + (dz / d) * _dir.z < 0.55) continue;   // in front only
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) {
    const e = enemies[best];
    killEnemy(best, _v1.set(e.pos.x - player.pos.x, 0.4, e.pos.z - player.pos.z).normalize());
  }
}

// Player ordnance: a slow shell that detonates on contact with the world,
// with a blast radius that clears a whole knot of enemies.
const shells = [];
const shellGeo = new THREE.SphereGeometry(0.1, 8, 8);
function spawnPlayerShell(origin, dir, spec) {
  const mesh = new THREE.Mesh(shellGeo, MAT_BLACK);
  mesh.position.copy(origin);
  scene.add(mesh);
  shells.push({
    mesh, pos: origin.clone(), prev: origin.clone(),
    vel: dir.clone().multiplyScalar(spec.speed), blast: spec.blast, life: 4,
  });
}
function detonateShell(i) {
  const sh = shells[i];
  const at = sh.pos.clone();
  scene.remove(sh.mesh);
  shells.splice(i, 1);
  spawnSparks(at, 0xff2d1a);
  spawnSparks(at, 0x16181d);
  spawnRipple(new THREE.Vector3(at.x, 0.5, at.z), _v1.set(0, 1, 0), true);
  sfx.boom();
  vibrate(34);
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (e.state === 'assemble') continue;
    if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) < sh.blast) {
      killEnemy(j, _v1.set(e.pos.x - at.x, 0.5, e.pos.z - at.z).normalize());
    }
  }
  // your own ordnance can absolutely kill you — mind the walls
  if (player.alive && player.iframes <= 0 &&
      Math.hypot(player.pos.x - at.x, player.pos.z - at.z) < sh.blast * 0.55) {
    hitPlayer();
  }
}
function updateShells(sdt) {
  for (let i = shells.length - 1; i >= 0; i--) {
    const sh = shells[i];
    sh.prev.copy(sh.pos);
    sh.vel.y -= 3.2 * sdt;
    sh.pos.addScaledVector(sh.vel, sdt);
    sh.mesh.position.copy(sh.pos);
    sh.life -= sdt;
    let hit = sh.pos.y <= 0.1;
    if (!hit) {
      for (const e of enemies) {
        if (e.state === 'assemble') continue;
        if (Math.hypot(e.pos.x - sh.pos.x, e.pos.z - sh.pos.z) < 0.6 &&
            sh.pos.y > 0.2 && sh.pos.y < 2.1) { hit = true; break; }
      }
    }
    if (!hit) hit = pointInObstacle(sh.pos.x, sh.pos.z, 0.1);
    if (hit || sh.life <= 0) detonateShell(i);
  }
}

function updateBullets(sdt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.prev.copy(b.pos);
    // your rounds arc a touch on long shots; incoming fire flies dead
    // straight — slow enough to read, honest enough to feel like bullets
    if (b.fromPlayer) b.vel.y -= BULLET_GRAVITY * sdt;
    b.pos.addScaledVector(b.vel, sdt);
    b.life -= sdt;
    b.mesh.position.copy(b.pos);

    // trail stretches behind the bullet, longer at speed (enemy tracers extra
    // long so incoming fire reads instantly in frozen time)
    const dir = _v1.copy(b.vel).normalize();
    b.mesh.quaternion.setFromUnitVectors(AXIS_Z, dir);
    const len = Math.min(b.vel.length() * (b.fromPlayer ? 0.05 : 0.2), b.fromPlayer ? 1.2 : 2.6);
    // billboard the ribbon: its lateral axis is perpendicular to both the
    // flight path and the line of sight, so it keeps its width from anywhere
    const side = _v2.copy(dir).cross(_v3.copy(camera.position).sub(b.pos));
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0); else side.normalize();
    const hw = b.fromPlayer ? 0.035 : 0.09;    // head half-width
    const tw = b.fromPlayer ? 0.008 : 0.022;   // tail half-width
    const tp = b.trail.geometry.attributes.position.array;
    const tx = b.pos.x - dir.x * len, ty = b.pos.y - dir.y * len, tz = b.pos.z - dir.z * len;
    tp[0] = b.pos.x + side.x * hw; tp[1] = b.pos.y + side.y * hw; tp[2] = b.pos.z + side.z * hw;
    tp[3] = b.pos.x - side.x * hw; tp[4] = b.pos.y - side.y * hw; tp[5] = b.pos.z - side.z * hw;
    tp[6] = tx + side.x * tw; tp[7] = ty + side.y * tw; tp[8] = tz + side.z * tw;
    tp[9] = tx - side.x * tw; tp[10] = ty - side.y * tw; tp[11] = tz - side.z * tw;
    b.trail.geometry.attributes.position.needsUpdate = true;

    // whoosh: volume follows your live distance to the round; pitch rides the
    // doppler of its radial speed (climbs while closing, sinks once past)
    if (!b.fromPlayer && b.whoosh) {
      const wx = b.pos.x - player.pos.x, wy = b.pos.y - EYE_HEIGHT, wz = b.pos.z - player.pos.z;
      const dist = Math.sqrt(wx * wx + wy * wy + wz * wz);
      const vr = dist > 1e-4 ? -(b.vel.x * wx + b.vel.y * wy + b.vel.z * wz) / dist : 0;
      sfx.updateWhoosh(b.whoosh, player.alive ? dist : Infinity, vr);
    }

    // wake: drop an expanding ring every fixed distance travelled
    b.rippleAcc += b.pos.distanceTo(b.prev);
    const spacing = b.fromPlayer ? 1.1 : 0.5;
    if (b.rippleAcc >= spacing) {
      b.rippleAcc %= spacing;
      spawnRipple(b.pos, b.vel, !b.fromPlayer);
    }

    if (b.life <= 0 || b.pos.y <= 0.02 ||
        Math.abs(b.pos.x - player.pos.x) > LIVE_BOUND ||
        Math.abs(b.pos.z - player.pos.z) > LIVE_BOUND) {
      killBullet(i, b.pos.y <= 0.05 ? b.pos : null);
      continue;
    }

    let hit = false;
    for (const o of obstacles) {
      const t = segAABB(b.prev, b.pos, o);
      if (t >= 0) {
        killBullet(i, _v2.lerpVectors(b.prev, b.pos, t));
        addBulletMark(b, _v2);
        hit = true;
        break;
      }
    }
    if (hit) continue;

    if (b.fromPlayer && game.mode === 'rush') {
      let hitC = false;
      for (let ci = crowd.length - 1; ci >= 0; ci--) {
        const n = crowd[ci];
        _v2.set(n.pos.x, 0.45, n.pos.z); _v3.set(n.pos.x, 1.5, n.pos.z);
        if (segSegDistSq(b.prev, b.pos, _v2, _v3) < 0.3 * 0.3) {
          const wasMark = n === rushMark;
          shatterNPC(n);
          crowd.splice(ci, 1);
          spawnNPC();
          if (wasMark) {
            game.kills++;
            markDown();            // the one you were hunting
          } else if (timeMode === 'toggle') {
            slowBank = Math.max(0, slowBank - 2);   // a civilian: the system docks you
          }
          killBullet(i, b.pos);
          hitC = true;
          break;
        }
      }
      if (hitC) continue;
    }
    if (b.fromPlayer) {
      let consumed = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (e.state === 'assemble') continue;   // still thin air — no hitbox
        const sy = e.g.scale.y, sx = Math.max(e.g.scale.x, 1);
        // head first: a sphere around the skull (bigger on armored units)
        const headR = (e.type === 'armored' ? 0.3 : 0.24) * sx;
        const headshot = segPointDistSq(b.prev, b.pos, e.pos.x, 1.62 * sy, e.pos.z) < headR * headR;
        let bodyshot = false;
        if (!headshot) {
          _v2.set(e.pos.x, 0.15, e.pos.z);
          _v3.set(e.pos.x, 1.5 * sy, e.pos.z);
          bodyshot = segSegDistSq(b.prev, b.pos, _v2, _v3) < 0.34 * 0.34;
        }
        if (!headshot && !bodyshot) continue;
        if (ENEMY_TYPES[e.type].shielded) {
          // only the PLATE blocks: intersect the bullet's path with the
          // shield rectangle in his local frame — his gun side, head-over
          // and legs-under are all fair targets now
          const cyw = Math.cos(e.g.rotation.y), syw = Math.sin(e.g.rotation.y);
          const lx = (p) => ((p.x - e.pos.x) * cyw - (p.z - e.pos.z) * syw) / sx;
          const lz = (p) => ((p.x - e.pos.x) * syw + (p.z - e.pos.z) * cyw) / sx;
          const az = lz(b.prev), bz = lz(b.pos);
          const t2 = bz !== az ? (0.52 - az) / (bz - az) : -1;
          if (t2 >= 0 && t2 <= 1) {
            const xi = lx(b.prev) + (lx(b.pos) - lx(b.prev)) * t2;
            const yi = (b.prev.y + (b.pos.y - b.prev.y) * t2) / sy;
            if (xi > -0.7 && xi < 0.22 && yi > 0.47 && yi < 1.78) {
              spawnSparks(b.pos, 0xf4f5f7);
              sfx.clank();
              consumed = true;
              break;
            }
          }
        }
        if (bodyshot && e.type === 'armored') {
          // armor shrugs it off — only headshots take these down
          spawnSparks(b.pos, 0xf4f5f7);
          sfx.clank();
          consumed = true;
          break;
        }
        const impulse = _v1.copy(b.vel).normalize();
        killEnemy(j, impulse);
        if (b.pierce > 0) { b.pierce--; continue; }   // sniper rounds keep going
        consumed = true;
        break;
      }
      if (consumed) {
        killBullet(i, null);
        continue;
      }
    } else if (player.alive && player.iframes <= 0) {
      _v2.set(player.pos.x, 0.2, player.pos.z);
      _v3.set(player.pos.x, EYE_HEIGHT + 0.1, player.pos.z);
      if (segSegDistSq(b.prev, b.pos, _v2, _v3) < PLAYER_RADIUS * PLAYER_RADIUS) {
        killBullet(i, b.pos);
        hitPlayer();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Input — multi-touch, zone-based:
//   any finger held            -> bullet time (time creeps while you move)
//   LEFT-half drag             -> floating virtual stick: smooth move / dodge
//   RIGHT-half drag            -> look / manual aim (auto-aim yields to it)
//   quick tap                  -> fire at the crosshair
//   quick tap on a dropped gun -> auto-sprint to it and equip
// Both thumbs work at once: dodge with the left while aiming with the right,
// tapping to fire — all inside bullet time.
// ---------------------------------------------------------------------------
const STICK_RADIUS = 70;        // px of thumb travel = full deflection
const MOVE_SPEED = 5.5;         // m/s at full stick (real time)
const SPRINT_SPEED = 9;         // m/s while auto-sprinting to a pickup
const MOVE_EASE = 10;           // velocity smoothing rate — the "weight"
const LOOK_SENS = 4.4;          // radians per screen-width of horizontal drag
// Vertical is a fraction of horizontal and clamped to a narrow band: the
// only reason to look up or down is to shift between torso and head, so
// whipping left/right stays cheap while your aim height stays parked.
const LOOK_SENS_Y = 1.15;
const PITCH_LIMIT = 0.42;
const TAP_MS = 380, TAP_PX = 18;  // thresholds on NET displacement — real
                                  // thumbs jitter, so never sum path length
const PICKUP_TAP_PX = 120;      // generous screen-px hit radius for tapping a
                                // drop — near-misses should grab, not fire

const input = {
  pointers: new Map(),          // id -> {sx,sy,x,y,ox,oy,role,downT}
  holding: false,
  stickX: 0, stickY: 0,         // -1..1 move-stick deflection
  lookIdle: 99,                 // seconds since the last manual look drag
  lookPx: 0,                    // look travel applied this frame; drives the assist
  lookYaw: 0,                   // ...signed, so the assist can never resist a turn
};
let sprintTo = null;            // pickup currently being sprinted to
let sprintStuckT = 0;           // time spent blocked against a wall mid-sprint

function stickUI(show, ox, oy, x, y) {
  const base = el.stickBase, nub = el.stickNub;
  base.style.display = nub.style.display = show ? 'block' : 'none';
  if (!show) return;
  base.style.left = `${ox}px`; base.style.top = `${oy}px`;
  nub.style.left = `${x}px`; nub.style.top = `${y}px`;
}


function onPointerDown(ev) {
  // "inside settings" means inside the CARD — the backdrop covers the screen
  const inSettings = ev.target && ev.target.closest && ev.target.closest('#settings .htpcard');
  // Two places need the browser's own touch handling: the settings sliders,
  // and the archive's scroll pane. `touch-action:none` on <body> means an
  // un-prevented pointerdown is the only thing that lets either one work.
  const inArchScroll = ev.target && ev.target.closest && ev.target.closest('#archlist');
  if (!inSettings && !inArchScroll) ev.preventDefault();
  sfx.init();
  if (el.settings.style.display === 'flex') {   // settings modal open
    if (inSettings) {
      if (ev.target.closest && ev.target.closest('#sethaptics')) {
        setHaptics(!hapticsOn);
        el.sethaptics.textContent = hapticsOn ? 'ON' : 'OFF';
        el.sethaptics.classList.toggle('on', hapticsOn);
        vibrate(15);   // demo thump so the toggle speaks for itself
      }
      if (ev.target.closest && ev.target.closest('#condlink')) {
        const i = COND_CYCLE.indexOf(testCondition);
        setTestCondition(COND_CYCLE[(i + 1) % COND_CYCLE.length]);
        vibrate(12);
      }
      if (ev.target.closest && ev.target.closest('#tutlink')) {
        setTutorArmed(!tutorArmed);
        vibrate(12);
      }
      if (ev.target.closest && ev.target.closest('#modelink')) {
        timeMode = timeMode === 'toggle' ? 'classic' : 'toggle';
        try { localStorage.setItem('timeshard_mode', timeMode); } catch { /* private mode */ }
        updateModeUI();
      }
      return;   // taps inside the card (incl. sliders) don't close it
    }
    el.settings.style.display = 'none';   // tap outside closes
    if (game.state === 'paused') el.pausemenu.style.display = 'flex';
    return;
  }
  if (game.state === 'paused') {
    if (ev.target && ev.target.closest) {
      if (ev.target.closest('#psettings')) {
        el.pausemenu.style.display = 'none';   // one card at a time
        openSettings();
        return;
      }
      if (ev.target.closest('#pendrun')) {
        el.pausemenu.style.display = 'none';
        game.state = game.pausedFrom || 'play';
        hitPlayer(true);
        return;
      }
    }
    closePause();   // RESUME or any tap outside the buttons
    return;
  }
  if (el.htp.style.display === 'flex') {   // how-to modal open
    if (ev.target && ev.target.closest && ev.target.closest('#htp .htpcard')) {
      if (ev.target.closest('#enmlink')) {
        el.htp.style.display = 'none';
        el.enm.style.display = 'flex';   // hop over to the enemies page
      }
      return;   // taps inside the card don't close it — only outside does
    }
    el.htp.style.display = 'none';
    return;
  }
  if (el.enm.style.display === 'flex') {   // enemies modal open
    if (ev.target && ev.target.closest && ev.target.closest('#enm .htpcard')) {
      if (ev.target.closest('#enmback')) {
        el.enm.style.display = 'none';
        el.htp.style.display = 'flex';   // back to how-to
      }
      return;
    }
    el.enm.style.display = 'none';
    return;
  }
  if (el.arch.style.display === 'flex') {   // archive open
    if (ev.target && ev.target.closest && ev.target.closest('#arch .htpcard')) return;
    el.arch.style.display = 'none';
    return;
  }
  if (game.state === 'menu' || game.state === 'dead' || game.state === 'gameover') {
    // brief lockout after dying so panic taps don't skip the death screen
    if (game.state === 'dead' && performance.now() - deathAt < 1000) return;
    if (game.state === 'dead' && ev.target && ev.target.id === 'menubtn') {
      showMenu();
      return;
    }
    if (game.state === 'menu' && ev.target && ev.target.closest) {
      if (ev.target.closest('#sndbtn')) {   // sound toggle, not a game start
        sfx.setMuted(!sfx.isMuted());
        updateSndBtn();
        return;
      }
      if (ev.target.closest('#howtolink')) {   // open the how-to modal
        document.getElementById('htptime').textContent =
          timeMode === 'toggle' ? 'TIME BUTTON — stops time' : 'HOLD — freezes time';
        el.htp.style.display = 'flex';
        return;
      }
      if (ev.target.closest('#archlink')) {
        openArchive();
        return;
      }
      if (ev.target.closest('#setlink')) {
        openSettings();
        return;
      }
      const pill = ev.target.closest('.scpill');
      if (pill) {   // re-sort the score table
        scoreMetric = pill.dataset.m;
        renderScores();
        return;
      }
      const vtab = ev.target.closest('.svtab');
      if (vtab) {   // TOP ranks by metric, RECENT lists newest first
        scoreView = vtab.dataset.v;
        renderScores();
        return;
      }
      if (ev.target.closest('#scores') || ev.target.closest('.rules')) return;   // reading
    }
    if (game.state === 'menu' && ev.target && ev.target.closest && ev.target.closest('#rushlink')) {
      game.mode = 'rush';
      advanceFromOverlay();
      return;
    }
    if (game.state === 'menu' && ev.target && ev.target.closest && ev.target.closest('#citylink')) {
      game.mode = 'wave';
      advanceFromOverlay();
      return;
    }
    // on the main menu only TAP TO BEGIN starts a run — a stray tap right
    // after closing settings must not launch you into a wave
    if (game.state === 'menu' &&
        !(ev.target && ev.target.closest && ev.target.closest('.go'))) return;
    if (game.state === 'menu') game.mode = 'hall';   // TAP TO BEGIN = the tunnel
    advanceFromOverlay();
    return;   // this pointer is never registered, so its release is inert
  }
  if (ev.target && ev.target.closest && ev.target.closest('#pausebtn')) {
    openPause();
    return;            // never registered, so its release is inert
  }
  if (timeMode === 'toggle' && ev.target && ev.target.closest && ev.target.closest('#timebtn')) {
    // press = slow immediately; a quick release keeps it locked (tap-toggle),
    // a long press means "only while held" and releases on lift
    timeBtnPointer = ev.pointerId;
    timeBtnDownAt = performance.now();
    timeBtnDownX = ev.clientX; timeBtnDownY = ev.clientY;
    timeBtnWasLocked = timeLocked;
    timeBtnYaw = player.yaw; timeBtnPitch = player.pitch;
    if (!timeLocked) setTimeLocked(true);
    vibrate(8);
    // AND it is a look pointer from this instant. The button is 146 px in
    // the bottom-right corner, which is half of where a right thumb
    // re-plants to aim after freezing time — so this is the touch the player
    // makes constantly, and it used to apply NO look until the thumb had
    // travelled 26 px, then replay all of it at once. That is the residual
    // jump. The threshold still decides whether this was a button press or a
    // look gesture (below); it no longer decides whether the camera moves.
    input.pointers.set(ev.pointerId, {
      sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY,
      ox: ev.clientX, oy: ev.clientY, role: 'look',
      downT: performance.now(), t: performance.now(),
    });
    input.holding = true;
    return;   // the button never fires the gun
  }
  input.pointers.set(ev.pointerId, {
    sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY,
    ox: ev.clientX, oy: ev.clientY, role: null,
    downT: performance.now(), t: performance.now(),
  });
  input.holding = true;
}

function onPointerMove(ev) {
  // A swipe that starts on the time button is a look gesture, not a press:
  // once it has travelled far enough to say so, undo the activation it
  // caused on the way down. The camera has been tracking it all along.
  if (ev.pointerId === timeBtnPointer &&
      Math.hypot(ev.clientX - timeBtnDownX, ev.clientY - timeBtnDownY) > TIMEBTN_SLIP_PX) {
    if (!timeBtnWasLocked) setTimeLocked(false);
    timeBtnPointer = null;
  }
  const p = input.pointers.get(ev.pointerId);
  if (!p) return;
  ev.preventDefault();
  // Every sample the browser had, not just the latest. Phones deliver touch
  // at a higher rate than they fire pointermove, and Chrome hands the skipped
  // ones over here; using them turns a coarse staircase into a smooth arc.
  const samples = ev.getCoalescedEvents ? ev.getCoalescedEvents() : null;
  if (samples && samples.length > 1) {
    for (const c of samples) movePointer(p, c.clientX, c.clientY);
  } else {
    movePointer(p, ev.clientX, ev.clientY);
  }
}

// The look control used to do NOTHING for the first TAP_PX (18) of thumb
// travel, because the role was not assigned until the gesture cleared the
// tap dead-zone — and then it replayed the whole swallowed distance in one
// step. That is the "I move my thumb, nothing happens, then it jumps" feel:
// it was ours, not the browser's. The role is now decided on the first real
// movement and look is applied from the first pixel. Tap-to-fire is
// unaffected, because that test was always about NET displacement at
// release, which a tap still passes.
const ROLE_PX = 2;   // just enough not to assign a role to a still thumb

function movePointer(p, cx, cy) {
  // A stale entry (mobile browsers sometimes lose a pointerup at the screen
  // edge) makes the NEXT touch look like a huge instant swipe — the camera
  // "jumps". Any implausible hop is treated as a re-plant, not a move: the
  // anchors are carried along so nothing is applied.
  //
  // But distance alone is not enough evidence. A genuinely fast flick after a
  // dropped frame can cover 140 px in one sample, and swallowing that is
  // itself a stall — the exact bug this is meant to prevent, arriving from
  // the other direction. A re-plant is a GAP in the pointer stream, so it has
  // to be far AND late; a flick delivers samples every 8-16 ms.
  const now = performance.now();
  const gap = now - (p.t || now);
  p.t = now;
  if (Math.hypot(cx - p.x, cy - p.y) > 140 && gap > 120) {
    p.ox += cx - p.x; p.oy += cy - p.y;
    p.sx += cx - p.x; p.sy += cy - p.y;
    p.x = cx; p.y = cy;
  }
  const dx = cx - p.x, dy = cy - p.y;
  p.x = cx; p.y = cy;
  if (!p.role && Math.hypot(p.x - p.sx, p.y - p.sy) > ROLE_PX) {
    // if the other thumb is already steering, this finger is LOOK no matter
    // where it landed — two-handed play shouldn't care about screen halves
    let hasMove = false;
    for (const q of input.pointers.values()) if (q !== p && q.role === 'move') hasMove = true;
    p.role = hasMove ? 'look' : (p.sx < window.innerWidth * 0.5 ? 'move' : 'look');
    p.ox = p.x; p.oy = p.y;         // the stick anchors where the drag begins
    if (p.role === 'move') sprintTo = null;   // manual move cancels a sprint
    // apply the couple of pixels that assigned the role, so even the very
    // first sample of a flick counts
    if (p.role === 'look') applyLook(p.x - dx - p.sx, p.y - dy - p.sy, gap);
  }
  if (p.role === 'move') {
    let ddx = p.x - p.ox, ddy = p.y - p.oy;
    const len = Math.hypot(ddx, ddy);
    if (len > STICK_RADIUS) {       // floating stick: the origin trails the thumb
      p.ox = p.x - (ddx / len) * STICK_RADIUS;
      p.oy = p.y - (ddy / len) * STICK_RADIUS;
      ddx = p.x - p.ox; ddy = p.y - p.oy;
    }
    input.stickX = ddx / STICK_RADIUS;
    input.stickY = ddy / STICK_RADIUS;
    stickUI(true, p.ox, p.oy, p.x, p.y);
  } else if (p.role === 'look') {
    applyLook(dx, dy, gap);
  }
}

// ---------------------------------------------------------------------------
// LOOK, AND WHY A BURST IS NOT A CUT.
//
// Measured off a screen recording, frame by frame: through the "freeze" the
// renderer never misses a beat — every frame differs, there is not one
// duplicate — and the camera sits at EXACTLY zero for 20-27 frames before
// moving 15 px of thumb travel in a single frame and then tracking smoothly
// at about 1 px per frame. Nothing was rendered late. The first ~350 ms of
// pointermove simply never reached us, and then arrived all at once.
//
// We cannot fix what we are not told. What we can fix is what we do with it:
// applying 15 px in one frame is a 7.6 degree snap, which reads as a jump
// even though the total rotation is correct.
//
// So an ordinary sample goes straight through with no added latency, and an
// oversized one is spread across the next few frames instead. The threshold
// discriminates correctly because of coalesced events: genuine fast motion
// arrives as MANY small samples (the browser hands over every sample it
// had), so only a real gap in the event stream can produce one big delta.
// ---------------------------------------------------------------------------
// A burst is paid out per FRAME, not per second. Two earlier shapes failed
// for the same reason: an exponential put 40-plus per cent of the burst on
// its first frame, and a rate-per-second let a single long frame swallow the
// whole thing — which is precisely when this happens, because a starved
// event stream and a long frame travel together. A per-frame budget spreads
// a burst over at least three frames whatever the frame rate is doing.
// ---------------------------------------------------------------------------
// SIZE ALONE IS NOT THE TEST. The paragraph above says a burst is recognised
// "because of coalesced events: only a real gap in the event stream can
// produce one big delta" — but the first version never actually looked at the
// gap, only at the pixels, and 6 px is not big. Measured on a plain 7 px per
// frame drag (a SLOW aim, not a flick): 70 samples, 70 "bursts", and 13.6 px
// of camera permanently owed to the thumb. Every ordinary aiming drag was
// going down the smoothing path, and under the uneven sample delivery a real
// phone produces that measured 19% variation in the per-frame step and 28%
// frame-to-frame roughness. The smoothing meant to remove a jump was itself
// the jitter.
//
// So the discriminator is now the one the comment always claimed: a sample is
// a burst when it is big AND late. A starved stream (the measured case was a
// ~350 ms hole) trips it; a fast flick delivered every 8-16 ms does not.
const LOOK_SNAP_PX = 10;       // a late sample bigger than this is spread
const LOOK_GAP_MS = 28;        // ...and only if the stream went quiet for this
const LOOK_DRAIN_MIN = 6;      // px per frame the drain always manages...
const LOOK_DRAIN_FRAC = 0.34;  // ...so three frames, more if it is large
let lookPendX = 0, lookPendY = 0;
// How often the event stream starves, and by how much. Cheap enough to leave
// in: the next time this is investigated it should start from a number.
const lookStats = { bursts: 0, worstPx: 0, lastAt: 0 };

function applyLook(dx, dy, gap) {
  // Once anything is queued, everything queues. A mixed path applies later
  // small samples AHEAD of earlier large ones, which reorders a 1-D motion
  // stream — the camera runs, waits, runs. Order is worth more than latency.
  const queued = lookPendX !== 0 || lookPendY !== 0;
  const big = Math.hypot(dx, dy) > LOOK_SNAP_PX && (gap === undefined || gap > LOOK_GAP_MS);
  if (!queued && !big) {
    lookNow(dx, dy);   // the common path: no added latency at all
    return;
  }
  if (big) {
    lookStats.bursts++;
    lookStats.worstPx = Math.max(lookStats.worstPx, +Math.hypot(dx, dy).toFixed(1));
    lookStats.lastAt = performance.now();
  }
  lookPendX += dx; lookPendY += dy;
}

function lookNow(dx, dy) {
  const w = window.innerWidth;
  player.yaw -= (dx / w) * LOOK_SENS;
  player.pitch -= (dy / w) * LOOK_SENS_Y;
  player.pitch = Math.min(Math.max(player.pitch, -PITCH_LIMIT), PITCH_LIMIT);
  input.lookIdle = 0;
  input.lookPx += Math.hypot(dx, dy);   // this frame's look travel; drives the assist
  input.lookYaw -= (dx / w) * LOOK_SENS;   // ...and its direction, so it never fights you
}

// Drained once per rendered frame, like the rest of the camera — freezing the
// world must never slow down how fast you can look around.
function drainLook() {
  if (lookPendX === 0 && lookPendY === 0) return;
  const len = Math.hypot(lookPendX, lookPendY);
  // one budget for the whole 2-D delta, so the direction of the sweep is
  // preserved instead of x and y draining at different speeds
  const step = Math.min(len, Math.max(LOOK_DRAIN_MIN, len * LOOK_DRAIN_FRAC));
  const f = step / len;
  const ax = lookPendX * f, ay = lookPendY * f;
  lookPendX -= ax; lookPendY -= ay;
  if (Math.hypot(lookPendX, lookPendY) < 0.01) { lookPendX = lookPendY = 0; }
  lookNow(ax, ay);
}

function clearPendingLook() { lookPendX = lookPendY = 0; }

function releasePointer(ev, isTapEligible) {
  const p = input.pointers.get(ev.pointerId);
  if (!p) return;
  ev.preventDefault();
  // NOT gated on p.role any more: the role is now assigned after 2 px, so a
  // real tap almost always has one. Net displacement is the honest test.
  if (isTapEligible && performance.now() - p.downT < TAP_MS &&
      Math.hypot(p.x - p.sx, p.y - p.sy) <= TAP_PX) {
    playerFire();   // a tap is always a shot: weapons are collected on foot
  }
  input.pointers.delete(ev.pointerId);
  let stillMoving = false;
  for (const q of input.pointers.values()) if (q.role === 'move') stillMoving = true;
  if (!stillMoving && p.role === 'move') {
    input.stickX = input.stickY = 0;
    stickUI(false);
  }
  input.holding = input.pointers.size > 0;
}

let timeBtnPointer = null, timeBtnDownAt = 0, timeBtnWasLocked = false;
let timeBtnDownX = 0, timeBtnDownY = 0;
// Where the camera was pointing when the thumb landed on the button. A
// gesture that turns out to be a PRESS rather than a look has its rotation
// handed back, so tracking from the first pixel costs a tap nothing: no dead
// zone on a drag, and no nudge to your aim on a tap.
let timeBtnYaw = 0, timeBtnPitch = 0;
function undoTimeBtnLook() {
  clearPendingLook();
  player.yaw = timeBtnYaw;
  player.pitch = timeBtnPitch;
}
const TIMEBTN_TAP_MS = 280;
const TIMEBTN_SLIP_PX = 26;   // slide this far off the button = look gesture

function onPointerUp(ev) {
  sfx.init();   // some browsers only allow audio resume on the gesture's END
  if (ev.pointerId === timeBtnPointer) {
    // still the button's pointer, so it never slipped: this was a press, and
    // whatever the thumb wobbled is given back
    timeBtnPointer = null;
    undoTimeBtnLook();
    if (performance.now() - timeBtnDownAt < TIMEBTN_TAP_MS) {
      // quick tap: toggle (was locked -> off, was off -> stays locked)
      if (timeBtnWasLocked) setTimeLocked(false);
    } else {
      setTimeLocked(false);   // long press: time flows again when you let go
    }
    releasePointer(ev, false);   // clean up its look pointer; never fires
    return;
  }
  releasePointer(ev, true);
}
function onPointerCancel(ev) {
  if (ev.pointerId === timeBtnPointer) {
    timeBtnPointer = null;
    undoTimeBtnLook();
    setTimeLocked(false);
  }
  releasePointer(ev, false);
}

renderer.domElement.style.touchAction = 'none';
window.addEventListener('pointerdown', onPointerDown, { passive: false });
window.addEventListener('pointermove', onPointerMove, { passive: false });
window.addEventListener('pointerup', onPointerUp, { passive: false });
window.addEventListener('pointercancel', onPointerCancel, { passive: false });
window.addEventListener('contextmenu', (e) => e.preventDefault());

// iOS Safari sometimes swallows the pointerup when a thumb slides off the
// screen edge (walking backwards drags it into the home-indicator zone),
// leaving the stick pinned. The touch layer is the ground truth: whenever it
// says no fingers remain, drop every tracked pointer.
function dropAllPointers() {
  clearPendingLook();
  if (input.pointers.size === 0) return;
  input.pointers.clear();
  input.stickX = input.stickY = 0;
  input.holding = false;
  stickUI(false);
}
window.addEventListener('touchend', (ev) => { if (ev.touches.length === 0) dropAllPointers(); }, { passive: true });
window.addEventListener('touchcancel', (ev) => { if (ev.touches.length === 0) dropAllPointers(); }, { passive: true });
window.addEventListener('blur', dropAllPointers);

// Belt-and-braces audio unlock: browsers differ on which gesture type is
// allowed to start audio (touchend vs click vs pointerdown), so hook them
// all and keep trying until the context is actually running.
const unlockEvs = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'keydown'];
function tryUnlockAudio() {
  sfx.init();
  if (sfx.running()) {
    for (const n of unlockEvs) window.removeEventListener(n, tryUnlockAudio, true);
  }
}
for (const n of unlockEvs) window.addEventListener(n, tryUnlockAudio, { capture: true, passive: true });

// Settings > TEST. null is off; otherwise every corridor leg is pinned to
// this element. A playtest switch, so built-but-unapproved content can be
// judged on door 1 instead of waiting for door 13 and eighty lifetime doors,
// and without the composer ever being able to pick it in a normal run.
//
// It carries MEASURES as well as conditions now, because the grinder has the
// same problem the conditions had: gated to door 6 at lifetime 80, it would
// be unplayable for a fortnight of testing.
const COND_CYCLE = [null, 'fog', 'blackout', 'grinder'];
const TEST_MEASURES = new Set(['grinder']);
let testCondition = null;
try {
  const v = localStorage.getItem('timeshard_cond');
  if (v && COND_CYCLE.includes(v)) testCondition = v;
} catch { /* private mode */ }
function setTestCondition(v) {
  testCondition = v;
  try { persist('timeshard_cond', v || ''); } catch { /* private mode */ }
  updateCondPill();
}
function updateCondPill() {
  if (!el.condlink) return;
  el.condlink.textContent = testCondition ? testCondition.toUpperCase() : 'OFF';
  el.condlink.classList.toggle('on', !!testCondition);
}

// Settings > TUTORIAL. Arms the onboarding for the NEXT run and then clears
// itself, so it is a one-shot rather than a mode you can forget you are in.
function updateTutPill() {
  if (!el.tutlink) return;
  el.tutlink.textContent = tutorArmed ? 'NEXT RUN' : 'OFF';
  el.tutlink.classList.toggle('on', tutorArmed);
}
function setTutorArmed(v) {
  tutorArmed = v;
  try { persist('timeshard_tutarm', v ? '1' : ''); } catch { /* private mode */ }
  updateTutPill();
}

let hapticsOn = true;
try { hapticsOn = localStorage.getItem('timeshard_haptics') !== '0'; } catch { /* private mode */ }

function vibrate(ms) {
  // haptic() routes to Core Haptics inside the app and to navigator.vibrate
  // on the web. On iOS Safari there is no third option — navigator.vibrate
  // does not exist there, which is why none of this has ever been felt on a
  // phone. Call sites are unchanged: they still speak in milliseconds.
  if (hapticsOn) haptic(ms);
}
function setHaptics(on) {
  hapticsOn = on;
  try { localStorage.setItem('timeshard_haptics', on ? '1' : '0'); } catch { /* private mode */ }
}

// ---------------------------------------------------------------------------
// Audio — synthesized, no assets. A dark synthwave loop is rendered offline
// at startup and played on a chain whose playback rate, lowpass filter, and
// echo send all track the time scale: enter bullet time and the whole
// soundtrack tape-slows into a deep, muffled, echoing version of itself.
// World SFX (enemy shots, bullet whizzes) sink with it.
// ---------------------------------------------------------------------------
const sfx = (() => {
  let ctx = null, master = null, sfxBus = null;
  let echoIn = null, echoWet = null, echoSendBus = null, voiceBus = null;
  let echoFb = null, echoDelay = null;
  let musicSrc = null, musicGain = null, musicFilter = null, musicBuf = null;
  let musicRate = 1, lastTs = 1, building = false;
  let faded = false;   // pause/death silence
  let muted = false;
  try { muted = localStorage.getItem('timeshard_muted') === '1'; } catch { /* private mode */ }
  let musicVol = 1, sfxVol = 1;
  try {
    const mv = parseFloat(localStorage.getItem('timeshard_musicvol'));
    const sv = parseFloat(localStorage.getItem('timeshard_sfxvol'));
    if (!Number.isNaN(mv)) musicVol = Math.min(Math.max(mv, 0), 1);
    if (!Number.isNaN(sv)) sfxVol = Math.min(Math.max(sv, 0), 1);
  } catch { /* private mode */ }

  // --- sampled sounds (recorded SFX in assets/sfx, mp3 for universal decode)
  // Fetched immediately so bytes are in flight during the menu; decoded once
  // the AudioContext exists. Every play falls back to the old synth recipe if
  // a sample hasn't loaded, so audio never goes missing.
  const SAMPLE_SRC = {
    gunshot: ['assets/sfx/gunshot.mp3', 0.9],      // 7.62x54R rifle crack
    shotgun: ['assets/sfx/shotgun.mp3', 2.8],      // quiet master -> boosted
    pickup: ['assets/sfx/pickup.mp3', 0.9],
    explosion: ['assets/sfx/explosion.mp3', 1.1],
    shatter1: ['assets/sfx/shatter1.mp3', 0.8],
    shatter2: ['assets/sfx/shatter2.mp3', 0.8],
    shatter3: ['assets/sfx/shatter3.mp3', 0.8],
    nextwave: ['assets/sfx/nextwave.mp3', 1.6],
    timeslow: ['assets/sfx/timeslow.mp3', 3.4],   // very quiet master -> boosted
    time: ['assets/sfx/time.mp3', 2.6],
    shatterw: ['assets/sfx/shatterword.mp3', 1.7],
  };
  // announcer voicing: pitched down and echoed like the Next Wave hit
  const VOICE = { rate: 0.8, send: 0.6 };
  const sampleFetch = {};
  const samples = {};
  for (const [name, [url]] of Object.entries(SAMPLE_SRC)) {
    sampleFetch[name] = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  }
  let shatterIdx = 0;      // the three glass breaks cycle so kills never repeat
  let surfaceBuf = null;   // synth fallback resume (reversed synth plunge)
  let resumeBuf = null;    // the timeslow recording reversed — preferred resume
  let resumeRetryT = 0;    // throttle for stuck-context resume attempts
  let slowPhase = false;   // stinger hysteresis: are we in the slow regime?
  let slowFromCombat = false;   // did this slow phase begin during combat?
  let whooshBuf = null;    // shared 2s noise loop for all bullet whooshes
  let whooshCount = 0;
  const liveWhooshes = [];   // so a flush can cut every one of them at once
  const WHOOSH_MAX = 12;   // concurrent whoosh voices — plenty, and bounded
  let voUntilMs = 0;       // a voice line is playing until then — never overlap
  let waveVoEndMs = 0;     // when the wave-intro VO finishes
  let waveWords = 0;       // kill words spoken this wave (max 2: TIME then SHATTER)

  // returns the played duration in seconds (truthy), or false if no sample
  function playSample(name, { rate = 1, send = 0.2, gainMul = 1, fadeAfter = 0, voice = false } = {}) {
    const s = samples[name];
    if (!ctx || !s) return false;
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = s.gain * gainMul;
    src.connect(g);
    if (voice) {
      g.connect(voiceBus);
      if (send > 0) {
        const sg = ctx.createGain();
        sg.gain.value = send;
        g.connect(sg); sg.connect(echoSendBus);
      }
    } else {
      route(g, send);
    }
    src.start(ctx.currentTime);
    if (fadeAfter > 0) {   // long tails get eased out so overlaps don't pile up
      const t = ctx.currentTime + fadeAfter / rate;
      g.gain.setValueAtTime(s.gain * gainMul, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      src.stop(t + 1.05);
    }
    return s.buf.duration / rate;
  }

  // iOS plays plain WebAudio in the "ambient" session, which the ring/silent
  // switch mutes outright. A looping (silent) HTML <audio> element flips the
  // session to "playback", which ignores the switch — the unmute.js trick.
  let mediaShim = null;
  function silentWavURI() {
    const n = 2205;   // 0.05s of silence @44.1kHz mono 16-bit
    const bytes = new Uint8Array(44 + n * 2);
    const dv = new DataView(bytes.buffer);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 44100, true); dv.setUint32(28, 88200, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, n * 2, true);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  function startMediaShim() {   // must be called from inside a user gesture
    try {
      if (!mediaShim) {
        mediaShim = new Audio(silentWavURI());
        mediaShim.loop = true;
        mediaShim.setAttribute('playsinline', '');   // no fullscreen takeover
      }
      if (mediaShim.paused) mediaShim.play().catch(() => {});
    } catch { /* no HTMLAudioElement — WebAudio alone will have to do */ }
  }

  // Mobile browsers only allow speechSynthesis after it has spoken inside a
  // user gesture — prime it with a silent utterance on the first tap, and
  // keep a live reference so Chrome doesn't GC the utterance mid-speech.
  // (TTS is now only the fallback announcer if time/shard samples fail.)
  let ttsPrimed = false, lastUtter = null;
  function primeTTS() {
    if (ttsPrimed || !('speechSynthesis' in window)) return;
    ttsPrimed = true;
    try {
      speechSynthesis.getVoices();   // kicks off async voice loading
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      lastUtter = u;
      speechSynthesis.speak(u);
    } catch { /* no TTS on this browser */ }
  }

  function init() {
    primeTTS();        // must run inside the gesture, even once audio is set up
    startMediaShim();  // ditto — re-kicks the playback session if iOS paused it
    if (ctx) {
      // 'suspended' after backgrounding, 'interrupted' on iOS — either way,
      // any user gesture should bring the sound back
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      return;
    }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    // some browsers hand out a suspended context even inside a gesture —
    // resume immediately while we still count as user-initiated
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();   // keep the louder mix clean
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp);
    comp.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    voiceBus = ctx.createGain();   // the announcer rides above the duck
    voiceBus.connect(master);
    // feedback echo bus — dry at full speed, cavernous in bullet time
    echoIn = ctx.createGain();
    echoSendBus = ctx.createGain();   // ducked with sfxBus (menu silences it)
    echoSendBus.connect(echoIn);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.29;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 1500;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    echoIn.connect(delay); delay.connect(damp); damp.connect(fb); fb.connect(delay);
    echoFb = fb; echoDelay = delay;
    echoWet = ctx.createGain();
    echoWet.gain.value = 0.06;
    damp.connect(echoWet); echoWet.connect(master);
    // music chain: buffer -> lowpass -> gain -> master (+ echo send)
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass'; musicFilter.frequency.value = 18000;
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicFilter.connect(musicGain); musicGain.connect(master);
    const msend = ctx.createGain();
    msend.gain.value = 0.4;
    musicGain.connect(msend); msend.connect(echoIn);
    buildMusic();
    // decode the sampled SFX now that a context exists
    for (const [name, [, gainV]] of Object.entries(SAMPLE_SRC)) {
      sampleFetch[name]
        .then((ab) => (ab ? ctx.decodeAudioData(ab) : null))
        .then((buf) => {
          if (!buf) return;
          samples[name] = { buf, gain: gainV };
          if (name === 'timeslow') resumeBuf = buildResume(buf);
        })
        .catch(() => { /* keep the synth fallback */ });
    }
    buildSurface();
  }

  // The resume keeps ONLY the recording's decay segment (1.4s-2.2s),
  // reversed: a soft rev-up with the loud body of the clip dropped entirely.
  function buildResume(buf) {
    const sr = buf.sampleRate;
    const a = Math.min(Math.floor(sr * 1.4), buf.length - 1);
    const b = Math.min(Math.floor(sr * 2.2), buf.length);
    const n = Math.max(b - a, sr * 0.2);
    const r = ctx.createBuffer(buf.numberOfChannels, n, sr);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const s = buf.getChannelData(c), d = r.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = s[Math.max(b - 1 - i, 0)];
      const inN = Math.floor(sr * 0.02);
      for (let i = 0; i < inN; i++) d[i] *= i / inN;
      const outN = Math.floor(sr * 0.08);
      for (let i = 0; i < outN; i++) d[n - 1 - i] *= i / outN;
    }
    return r;
  }

  // Render the slow-mo plunge offline, then flip it: the same sound played
  // backwards becomes the "time resuming" cue. Noise-only — no tonal "boop".
  // (Synth fallback — the timeslow recording is preferred when it loads.)
  async function buildSurface() {
    try {
      const off = new OfflineAudioContext(1, Math.ceil(ctx.sampleRate * 1.5), ctx.sampleRate);
      const n = Math.floor(off.sampleRate * 0.9);
      const nb = off.createBuffer(1, n, off.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < n; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const ns = off.createBufferSource();
      ns.buffer = nb;
      ns.playbackRate.value = 0.7;
      const nf = off.createBiquadFilter();
      nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.4;
      const ng = off.createGain();
      ng.gain.value = 0.6;
      ns.connect(nf).connect(ng); ng.connect(off.destination);
      ns.start(0);
      const buf = await off.startRendering();
      const d = buf.getChannelData(0);
      d.reverse();
      // reversed, the loud attack lands at the END — fade it out (and ease the
      // first instant in) so time resuming doesn't end on a hard click
      const outN = Math.floor(off.sampleRate * 0.09);
      for (let i = 0; i < outN; i++) d[d.length - 1 - i] *= i / outN;
      const inN = Math.floor(off.sampleRate * 0.02);
      for (let i = 0; i < inN; i++) d[i] *= i / inN;
      surfaceBuf = buf;
    } catch { /* fall back to the old snap */ }
  }

  // --- the soundtrack: 8 bars of Am-F-C-G synthwave rendered offline
  async function buildMusic() {
    if (building) return;
    building = true;
    const sr = ctx.sampleRate, BEAT = 0.6, DUR = 32 * BEAT;   // 100bpm, 8 bars
    let off;
    try { off = new OfflineAudioContext(2, Math.ceil(sr * DUR), sr); } catch { return; }

    const hatBuf = off.createBuffer(1, Math.floor(sr * 0.05), sr);
    { const d = hatBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); }

    function note(freq, t, len, { type = 'sawtooth', gain = 0.08, att = 0.01, lp = 0, pan = 0, detune = 0, f1 = 0 } = {}) {
      const o = off.createOscillator();
      o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
      if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + len);
      const g = off.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + att);
      g.gain.exponentialRampToValueAtTime(0.0008, t + len);
      let tail = g;
      if (lp) { const f = off.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; g.connect(f); tail = f; }
      const p = off.createStereoPanner(); p.pan.value = pan;
      o.connect(g); tail.connect(p); p.connect(off.destination);
      o.start(t); o.stop(t + len + 0.05);
    }
    function hat(t, gain) {
      const s = off.createBufferSource(); s.buffer = hatBuf;
      const f = off.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
      const g = off.createGain(); g.gain.value = gain;
      s.connect(f); f.connect(g); g.connect(off.destination);
      s.start(t);
    }

    // Am, F, C, G — two bars each
    const CHORDS = [
      { root: 55.0, pad: [110.0, 130.81, 164.81], arp: [110.0, 164.81, 220.0, 261.63] },
      { root: 43.65, pad: [87.31, 110.0, 130.81], arp: [87.31, 130.81, 174.61, 220.0] },
      { root: 65.41, pad: [130.81, 164.81, 196.0], arp: [130.81, 196.0, 261.63, 329.63] },
      { root: 49.0, pad: [98.0, 123.47, 146.83], arp: [98.0, 146.83, 196.0, 246.94] },
    ];
    CHORDS.forEach((c, ci) => {
      const t0 = ci * 8 * BEAT;
      for (const f of c.pad) {       // slow detuned pad
        note(f, t0, 8 * BEAT, { gain: 0.028, att: 1.2, lp: 750, detune: 5, pan: -0.25 });
        note(f, t0, 8 * BEAT, { gain: 0.028, att: 1.2, lp: 750, detune: -5, pan: 0.25 });
      }
      for (let k = 0; k < 16; k++) {  // driving eighth-note bass
        note(c.root, t0 + k * BEAT * 0.5, 0.26, { gain: k % 2 ? 0.055 : 0.1, lp: 320 });
      }
      for (let b = 0; b < 8; b++) {   // kick pulse + offbeat hats
        note(120, t0 + b * BEAT, 0.13, { type: 'sine', gain: 0.42, f1: 44 });
        hat(t0 + b * BEAT + BEAT / 2, 0.045);
      }
      for (let k = 0; k < 32; k++) {  // 16th-note arpeggio
        note(c.arp[k % 4], t0 + k * BEAT * 0.25, 0.12, { type: 'triangle', gain: 0.04, pan: k % 2 ? 0.35 : -0.35 });
      }
    });

    try {
      musicBuf = await off.startRendering();
      startMusic(1.2);
    } catch { /* keep SFX even if music fails */ }
  }

  // Seating the loop is its own function because a retry has to restart it
  // from the top: fading the master leaves the loop running underneath, so
  // the next run would otherwise pick the track up mid-phrase.
  function startMusic(fade = 0.4) {
    if (!ctx || !musicBuf || !musicFilter || muted) return;
    if (musicSrc) { try { musicSrc.stop(); } catch { /* already stopped */ } musicSrc.disconnect(); }
    musicSrc = ctx.createBufferSource();
    musicSrc.buffer = musicBuf;
    musicSrc.loop = true;
    musicSrc.playbackRate.value = musicRate;
    musicSrc.connect(musicFilter);
    musicSrc.start();
    musicGain.gain.setTargetAtTime(0.26 * musicVol, ctx.currentTime, fade);
  }

  // --- one-shot helpers, routed through the sfx bus + echo send
  function route(g, send) {
    g.connect(sfxBus);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      // sends go through the ducked echo bus, so menu-demo sounds can't
      // leak their echoes into the start of a run
      g.connect(s); s.connect(echoSendBus);
    }
  }
  function noise(dur, freq, q, gainV, rate = 1, send = 0.2, at = 0) {
    if (!ctx) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gainV;
    src.connect(filt).connect(g);
    route(g, send);
    src.start(ctx.currentTime + at);
  }
  function tone(f0, f1, dur, gainV, type = 'square', rate = 1, send = 0.15, at = 0, att = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * rate, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1 * rate, 1), t0 + dur / rate);
    const g = ctx.createGain();
    if (att > 0) {   // soft attack: an instant-on oscillator clicks
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gainV, t0 + att);
    } else {
      g.gain.setValueAtTime(gainV, t0);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / rate);
    o.connect(g);
    route(g, send);
    o.start(t0); o.stop(t0 + dur / rate);
  }

  // world sounds sink in pitch & speed as time slows; your own gun less so
  const worldRate = () => 0.4 + 0.6 * timeScale;
  const selfRate = () => 0.75 + 0.25 * timeScale;

  return {
    init,
    // called every frame: tape-slow the music, close the filter, open the echo
    // the announcer: a low, slow synthesized voice speaking the kill words
    newWave() { waveWords = 0; },   // called at wave start: re-arm TIME + SHATTER
    say() {
      // The announcer speaks exactly twice per wave — TIME for the first
      // eligible kill, SHATTER for the next — and never talks over itself or
      // the wave VO (the first word also waits 5s after the wave VO ends).
      // Returns the word spoken (the kill flash shows only when it did).
      if (muted) return null;
      const now = performance.now();
      if (waveWords >= 2) return null;
      if (waveWords === 0 && now < waveVoEndMs + 5000) return null;
      if (now < voUntilMs) return null;
      const key = waveWords === 0 ? 'time' : 'shatterw';
      const d = playSample(key, { rate: VOICE.rate, send: VOICE.send, voice: true });
      if (d) {
        waveWords++;
        voUntilMs = now + d * 1000 + 150;
        return key === 'shatterw' ? 'SHATTER' : 'TIME';
      }
      if (!('speechSynthesis' in window)) return null;
      try {   // TTS fallback, same quota rules
        const u = new SpeechSynthesisUtterance((key === 'shatterw' ? 'shatter' : key) + '.');
        u.rate = 0.75;
        u.pitch = 0.3;
        u.volume = 1;
        lastUtter = u;   // hold the reference — GC'd utterances go silent
        speechSynthesis.speak(u);
        waveWords++;
        voUntilMs = now + 1200;
        return key === 'shatterw' ? 'SHATTER' : 'TIME';
      } catch { return null; }
    },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('timeshard_muted', m ? '1' : '0'); } catch { /* private mode */ }
      if (master) master.gain.value = m ? 0 : 0.9;
      if (m) { try { speechSynthesis.cancel(); } catch { /* no TTS */ } }
    },
    isMuted() { return muted; },
    running() { return !!(ctx && ctx.state === 'running'); },
    setMusicVol(v) {
      musicVol = Math.min(Math.max(v, 0), 1);
      try { localStorage.setItem('timeshard_musicvol', String(musicVol)); } catch { /* private mode */ }
      if (ctx && musicGain) musicGain.gain.setTargetAtTime(0.26 * musicVol, ctx.currentTime, 0.1);
    },
    setSfxVol(v) {
      sfxVol = Math.min(Math.max(v, 0), 1);   // the duck loop applies it next frame
      try { localStorage.setItem('timeshard_sfxvol', String(sfxVol)); } catch { /* private mode */ }
    },
    vols() { return { music: musicVol, sfx: sfxVol }; },
    update(ts, dt) {
      if (!ctx) return;
      // keep nudging a stuck context back to life (iOS backgrounding etc.)
      resumeRetryT -= dt;
      if (ctx.state !== 'running' && resumeRetryT <= 0) {
        resumeRetryT = 1;
        ctx.resume().catch(() => { /* needs a gesture — the unlock hooks retry */ });
      }
      // the title screen keeps the music but silences the demo fight's SFX
      if (sfxBus) {
        const want = (game.state === 'menu' ? 0 : 1) * sfxVol;
        // quick, smooth duck under the announcer so voice lines cut through
        const duckF = performance.now() < voUntilMs ? 0.3 : 1;
        sfxBus.gain.value += (want * duckF - sfxBus.gain.value) * Math.min(dt * 8, 1);
        if (echoSendBus) echoSendBus.gain.value = sfxBus.gain.value;
        if (voiceBus) voiceBus.gain.value += (want - voiceBus.gain.value) * Math.min(dt * 8, 1);
      }
      // slower easing = a long, audible turntable-style pitch glide
      const k = Math.min(dt * 4.5, 1);
      musicRate += ((0.3 + 0.7 * ts) - musicRate) * k;
      if (musicSrc) musicSrc.playbackRate.value = musicRate;
      if (musicFilter) musicFilter.frequency.value = 380 + 17100 * Math.pow(ts, 1.4);
      if (echoWet) echoWet.gain.value = 0.06 + (1 - ts) * 0.48;
      // stinger state machine with hysteresis (slow below 0.45, fast above
      // 0.55). The menu idles at exactly 0.5, and death/menu transitions move
      // timeScale too — stingers only play for transitions that BEGAN in
      // combat, so run starts and retries stay silent.
      const inCombat = game.state === 'play' || game.state === 'intro';
      const enteringSlow = ts < 0.45 && !slowPhase;
      const leavingSlow = ts > 0.55 && slowPhase;
      if (enteringSlow) { slowPhase = true; slowFromCombat = inCombat; }
      if (leavingSlow) slowPhase = false;
      if (enteringSlow && inCombat) {   // plunge: the timeslow recording
        const s = samples.timeslow;
        if (s) {
          // tape slowing down: the playback rate eases from 1 to half speed,
          // dragging the ending out longer and deeper, drenched in echo
          const src = ctx.createBufferSource();
          src.buffer = s.buf;
          const t0 = ctx.currentTime;
          src.playbackRate.setValueAtTime(1, t0);
          src.playbackRate.exponentialRampToValueAtTime(0.5, t0 + s.buf.duration * 1.5);
          const g = ctx.createGain();
          g.gain.value = s.gain;
          src.connect(g);
          route(g, 0.95);
          src.start(t0);
        } else {
          noise(0.9, 700, 0.4, 0.6, 0.7, 0.95);
        }
      } else if (leavingSlow && inCombat && slowFromCombat) {   // surface: the plunge, reversed
        if (resumeBuf) {
          // a record spinning back up: just the soft rev, quick and clean
          const src = ctx.createBufferSource();
          src.buffer = resumeBuf;
          const t0 = ctx.currentTime;
          src.playbackRate.setValueAtTime(1.4, t0);
          src.playbackRate.exponentialRampToValueAtTime(2.4, t0 + 0.5);
          const g = ctx.createGain();
          g.gain.value = samples.timeslow ? samples.timeslow.gain : 1;
          src.connect(g);
          route(g, 0.5);
          src.start(t0);
        } else if (surfaceBuf) {
          const src = ctx.createBufferSource();
          src.buffer = surfaceBuf;
          const g = ctx.createGain();
          g.gain.value = 1.1;
          src.connect(g);
          route(g, 0.85);
          src.start();
        } else {
          noise(0.12, 2400, 0.9, 0.18, 1.5, 0.08);
          tone(600, 1300, 0.09, 0.1, 'triangle');
        }
      }
      lastTs = ts;
    },
    debug() {
      return ctx ? { state: ctx.state, musicRate: +musicRate.toFixed(2), music: !!musicSrc,
        shim: !!(mediaShim && !mediaShim.paused),
        samples: Object.keys(samples).length, surface: !!surfaceBuf,
        voWords: waveWords, voWait: Math.max(0, Math.round(waveVoEndMs + 5000 - performance.now())),
        filter: musicFilter ? Math.round(musicFilter.frequency.value) : 0,
        echo: echoWet ? +echoWet.gain.value.toFixed(2) : 0,
        sbus: sfxBus ? +sfxBus.gain.value.toFixed(2) : 0,
        master: master ? +master.gain.value.toFixed(2) : 0 } : null;
    },
    shot(weapon) {
      if (game.state === 'menu') return;   // demo stays silent
      const r = selfRate();
      if (weapon === 'shotgun') {
        // It read as "far away", and the two causes were both here. Playing it
        // at 0.75 rate stretched the transient until the blast had no crack
        // left, and a 0.35 echo send meant a third of what you heard was the
        // ROOM rather than the gun — which is exactly how distance is encoded.
        // At full speed it now runs near its own pitch with a much drier send
        // and a hard noise spike in front of it for the attack. selfRate()
        // still stretches and drowns it in bullet time, where the cavernous
        // version is the one that sounds right.
        if (playSample('shotgun', { rate: r * 0.92, gainMul: 1.25, send: 0.12 * r, fadeAfter: 1.4 })) {
          noise(0.035, 5200, 0.7, 0.5, 1, 0.02);        // the crack, real-time
          tone(150, 32, 0.28, 0.5, 'sine', r, 0.08);    // sub-thump under it
          return;
        }
        noise(0.05, 4800, 0.6, 0.6, 1, 0.03);
        noise(0.28, 550, 0.5, 0.75, r, 0.12); tone(160, 40, 0.18, 0.3, 'square', r);
      } else if (weapon === 'sniper') {   // same rifle crack, pitched down a touch
        if (playSample('gunshot', { rate: r * 0.85, send: 0.4 })) return;
        noise(0.09, 3200, 0.6, 0.7, r, 0.2);
        noise(0.45, 900, 0.5, 0.55, r, 0.5);
        tone(520, 45, 0.3, 0.35, 'sawtooth', r, 0.4);
      } else {
        if (playSample('gunshot', { rate: r, send: 0.25 })) return;
        noise(0.14, 1600, 0.7, 0.5, r, 0.25); tone(320, 70, 0.1, 0.25, 'square', r);
      }
    },
    // the knife: air over an edge, not powder. A short band of noise whose
    // filter sweeps up and back down across the swing — no crack, no body.
    swipe() {
      if (!ctx || game.state === 'menu') return;
      const r = selfRate();
      const dur = 0.17 / r;
      const n = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      // swells to the middle of the stroke and dies: the sound of the arm,
      // not of an impact
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / n) * Math.PI) ** 1.4;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.Q.value = 1.5;
      const t0 = ctx.currentTime;
      filt.frequency.setValueAtTime(600 * r, t0);
      filt.frequency.exponentialRampToValueAtTime(3200 * r, t0 + dur * 0.5);
      filt.frequency.exponentialRampToValueAtTime(800 * r, t0 + dur);
      const g = ctx.createGain();
      g.gain.value = 0.3;
      src.connect(filt).connect(g);
      route(g, 0.08);
      src.start(t0);
    },
    clank() {
      if (game.state === 'menu') return;   // demo stays silent   // armor shrugging off a body shot
      noise(0.06, 3200, 2.2, 0.45, 1, 0.25);
      tone(950, 320, 0.11, 0.3, 'square', 1, 0.25);
    },
    // --- per-bullet whoosh: every enemy round carries a looping bed of surf
    // noise. Volume tracks your live distance to the round; pitch rides a
    // doppler shift, so it climbs as it closes and sinks as it passes.
    attachWhoosh() {
      if (!ctx || whooshCount >= WHOOSH_MAX || game.state === 'menu') return null;
      if (!whooshBuf) {
        const n = ctx.sampleRate * 2;
        whooshBuf = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = whooshBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = whooshBuf;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 1000;   // ocean-wave voicing, not hissy white noise
      filt.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filt).connect(g);
      g.connect(sfxBus);
      const send = ctx.createGain();   // per-voice echo send — opens after the pass
      send.gain.value = 0.25;
      g.connect(send); send.connect(echoSendBus);
      src.start(ctx.currentTime, Math.random() * 2);   // decorrelate the loops
      whooshCount++;
      const h = { src, g, send, dead: false };
      liveWhooshes.push(h);
      return h;
    },
    updateWhoosh(h, dist, vr) {   // vr: radial closing speed, + = approaching
      if (!h || h.dead) return;
      // volume: a soft 0.05 floor so distant rounds are present but never
      // intrusive, then a very steep quintic ramp — a round must be within
      // ~1.7m to clear 0.15, and a true graze escalates fast toward 0.5
      const prox = Math.max(0, 1 - dist / 6);
      let want = isFinite(dist) ? 0.05 + 0.45 * Math.pow(prox, 5) : 0;
      const receding = vr < 0;
      if (receding && !h.receded) {   // the instant it passes: a graze tick
        h.receded = true;
        if (dist < 1.6 && game.state !== 'menu') vibrate(6);
      }
      // once it's past you the dry sound collapses toward zero — only the echo
      // lingers. A slightly higher cut and a slower fade keep it from feeling
      // like a hard cutoff.
      if (receding) want = (want - 0.05) * 0.15;
      const k = receding && want < h.g.gain.value ? 0.12 : 0.25;   // gentler decay
      h.g.gain.value += (want - h.g.gain.value) * k;
      // doppler on the WORLD-frame radial speed (not the slowed clock), so the
      // pitch drop is just as audible in bullet time as at full speed
      const dopp = receding ? Math.max(0.35, 1 + vr / 23) : 1;   // divisor tracks bulletBase
      const rate = (0.4 + 0.6 * timeScale) * dopp;
      h.src.playbackRate.value += (rate - h.src.playbackRate.value) * k;
      h.send.gain.value += ((receding ? 1.6 : 0.2) - h.send.gain.value) * k;
    },
    detachWhoosh(h) {
      if (!h || h.dead) return;
      h.dead = true;
      whooshCount--;
      const li = liveWhooshes.indexOf(h);
      if (li >= 0) liveWhooshes.splice(li, 1);
      try {   // quick fade so a bullet dying mid-swell doesn't click
        h.g.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        h.src.stop(ctx.currentTime + 0.15);
      } catch { /* already stopped */ }
    },
    pickup() {
      if (game.state === 'menu') return;   // demo stays silent   // the pump-action rack when you grab a gun
      if (playSample('pickup', { send: 0.12 })) return;
      noise(0.035, 1900, 1.4, 0.5, 1, 0.08, 0);
      noise(0.1, 750, 0.9, 0.5, 1, 0.12, 0.09);
      noise(0.05, 2500, 1.6, 0.65, 1, 0.15, 0.21);
      tone(230, 150, 0.09, 0.35, 'square', 1, 0.1, 0.21);
    },
    enemyShot() {
      if (game.state === 'menu') return;   // demo stays silent
      const r = worldRate();
      const loud = 1 + (1 - timeScale) * 0.7;
      // the same iron as the player's pistol — their guns are just as real,
      // pitched slightly loose so volleys don't machine-gun into one tone
      if (playSample('gunshot', { rate: r * (0.94 + Math.random() * 0.08), send: 0.3, gainMul: 0.75 * loud })) return;
      noise(0.2, 700, 0.8, 0.55 * loud, r, 0.5);
      tone(190, 45, 0.16, 0.3 * loud, 'square', r, 0.45);
    },
    shatter() {
      if (game.state === 'menu') return;   // demo stays silent   // heavy glass breaks, cycling 1-2-3 so kills never repeat
      const r = worldRate();
      shatterIdx = (shatterIdx % 3) + 1;
      // heavy echo send so kills ring out like the rest of the world
      if (playSample('shatter' + shatterIdx, { rate: r, send: 0.65, fadeAfter: 2.0 })) return;
      noise(0.5, 2600, 0.4, 0.5, r, 0.35); noise(0.35, 4200, 0.6, 0.3, r, 0.35);
    },
    die() {
      if (game.state === 'menu') return;   // demo stays silent   // slowed way down: a long, deep grind as the run ends
      tone(220, 30, 0.9, 0.4, 'sawtooth', 0.55, 0.5);
      noise(0.6, 400, 0.8, 0.4, 0.5, 0.5);
    },
    wave() {   // the wave VO, played the moment its banner card appears
      const now = performance.now();
      const d = playSample('nextwave', { rate: 0.8, send: 0.25, voice: true });
      if (!d) tone(440, 880, 0.18, 0.2, 'triangle');
      waveVoEndMs = now + (d ? d * 1000 : 400);
      voUntilMs = Math.max(voUntilMs, waveVoEndMs);
    },
    alert() {   // sniper warning
      if (game.state === 'menu') return;   // demo stays silent
      tone(1100, 500, 0.3, 0.22, 'square', 1, 0.3);
    },
    lob() {
      if (game.state === 'menu') return;   // demo stays silent
      const r = worldRate();
      noise(0.16, 420, 1.1, 0.28, r, 0.3);
    },
    rocket() {
      if (game.state === 'menu') return;   // demo stays silent
      const r = worldRate();
      noise(0.5, 600, 0.7, 0.5, r, 0.5);
      tone(240, 90, 0.4, 0.2, 'sawtooth', r, 0.4);
    },
    boom() {
      if (game.state === 'menu') return;   // demo stays silent
      const r = worldRate();
      if (playSample('explosion', { rate: r, send: 0.4, fadeAfter: 2.2 })) return;
      noise(0.6, 180, 0.5, 0.85, r, 0.55);
      noise(0.3, 900, 0.6, 0.4, r, 0.4);
      tone(110, 26, 0.55, 0.5, 'sine', r, 0.5);
    },
    // Airlock: pneumatic hiss, heavy clunk, and the slab running down its
    // track — the sound of somewhere sealed being opened for you.
    airlock() {
      if (!ctx || muted) return;
      noise(0.55, 2600, 0.55, 0.16, 1, 0.25);           // pressure release
      tone(70, 44, 0.5, 0.55, 'sine', 1, 0.35);         // the clunk
      setTimeout(() => {
        if (!ctx || muted) return;
        noise(0.85, 420, 0.5, 0.2, 1, 0.3);             // slab on its track
        tone(150, 96, 0.75, 0.16, 'sawtooth', 1, 0.3);
      }, 130);
    },
    // Death fades the MASTER, which attenuates the output but leaves the
    // world still running underneath it: the delay line keeps circulating the
    // last shots at full amplitude (0.29 s tap, 0.45 feedback, so a tail of
    // roughly two seconds), the music loop keeps playing, and any voice with
    // a long tail keeps ringing. Bring the master back up for the next run
    // inside that window and you hear the end of the run you just lost.
    //
    // So a retry does not merely un-duck: it FLUSHES. The feedback path is
    // opened for long enough to drain, every whoosh voice is cut, and the
    // music is re-seated at the top of its loop.
    flush() {
      if (!ctx) return;
      const now = ctx.currentTime;
      for (const node of [echoIn, echoWet, echoFb]) {
        if (!node) continue;
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(0.0001, now);
      }
      for (const h of liveWhooshes.slice()) this.detachWhoosh(h);
      if (musicSrc) {
        try { musicSrc.stop(); } catch { /* already stopped */ }
        musicSrc.disconnect();
        musicSrc = null;
      }
      if (musicGain) {
        musicGain.gain.cancelScheduledValues(now);
        musicGain.gain.setValueAtTime(0, now);
      }
      // re-arm once the line has certainly drained
      setTimeout(() => {
        if (!ctx || !echoIn) return;
        const t = ctx.currentTime;
        echoIn.gain.setValueAtTime(1, t);
        if (echoWet) echoWet.gain.setValueAtTime(0.06, t);
        if (echoFb) echoFb.gain.setValueAtTime(0.45, t);
        startMusic();
      }, 90);
    },
    // Everything ducks to silence for pause/death and swells back on resume.
    // Ramping the master (not stopping voices) is what kills the buzzing
    // loop a sample used to make when the world froze mid-playback.
    fadeAll(to, seconds) {
      if (!ctx || !master) return;
      const now = ctx.currentTime;
      const target = Math.max(0.0001, to);
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(target, now + Math.max(0.02, seconds));
      faded = to <= 0.001;
    },
    isFaded() { return faded; },
  };
})();

// ---------------------------------------------------------------------------
// Game state, waves, HUD
// ---------------------------------------------------------------------------
const game = {
  state: 'menu',   // menu | intro | play | clear | dead | gameover
  wave: 1,
  kills: 0,
  spawnQueue: [],
  mode: 'wave',
  spawnTimer: 0,
  stateT: 0,
  waveBearing: 0,
  noFireBefore: 0,   // enemies hold fire until this timestamp (onboarding grace)
  introLen: 1.2,
};

let bestWave = 1;
try { bestWave = Math.max(1, +localStorage.getItem('timeshard_best') || 1); } catch { /* private mode */ }

// --- recent-runs table (last 5 runs; a run = menu start until death)
let runStartAt = 0;
let runPlayT = 0;   // real seconds actually in combat this run (all retries)
let scoreMetric = 'w';   // 'w' = wave, 'k' = shards (kills)
let scoreView = 'top';   // 'top' = ranked by metric, 'recent' = newest first

function loadRuns() {
  try { return JSON.parse(localStorage.getItem('timeshard_runs') || '[]'); } catch { return []; }
}

function recordRun() {
  if (game.mode !== 'wave') return;   // TOP RUNS is the wave-mode board
  const runs = loadRuns();
  const e = runs.find((r) => r.id === runStartAt);
  if (e) {   // retries extend the same run instead of adding a new row
    e.w = Math.max(e.w, game.wave);
    e.k = Math.max(e.k, game.kills);
    e.d = Math.round(runPlayT);
    e.at = Date.now();
  } else {
    runs.unshift({ id: runStartAt, w: game.wave, k: game.kills, d: Math.round(runPlayT), at: Date.now() });
  }
  runs.sort((a, b) => b.at - a.at);
  try { persist('timeshard_runs', JSON.stringify(runs.slice(0, 5))); } catch { /* private mode */ }
}

function fmtWhen(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function renderScores() {
  // only real, complete runs make the table — no placeholder rows
  const display = loadRuns().filter((r) => r.w != null && r.k != null && r.at);
  if (!display.length) {   // nothing to show until you've played
    el.scores.style.display = 'none';
    return;
  }
  el.scores.style.display = 'block';
  // TOP ranks by the chosen metric so #1 is your best; RECENT is just the
  // last few runs in order — two different questions, one table
  if (scoreView === 'recent') display.sort((a, b) => b.at - a.at);
  else display.sort((a, b) => ((b[scoreMetric] || 0) - (a[scoreMetric] || 0)) || (b.at - a.at));
  const fmtVal = (r) => {
    if (scoreMetric === 'd') {   // survival time as M:SS
      if (r.d == null) return '—<em></em>';
      const m = Math.floor(r.d / 60), s = String(r.d % 60).padStart(2, '0');
      return `${m}:${s}<em>ALIVE</em>`;
    }
    const v = r[scoreMetric];
    const unit = scoreMetric === 'w' ? (v === 1 ? 'WAVE' : 'WAVES') : (v === 1 ? 'ENEMY' : 'ENEMIES');
    return `${v}<em>${unit}</em>`;
  };
  const rows = display.slice(0, 5).map((r) =>
    `<div class="scrow"><span class="scval">${fmtVal(r)}</span>` +
    `<span class="scdate">${fmtWhen(r.at)}</span></div>`).join('');
  el.scores.innerHTML =
    '<div class="schead">' +
    `<span class="svtab${scoreView === 'top' ? ' active' : ''}" data-v="top">TOP RUNS</span>` +
    `<span class="svtab${scoreView === 'recent' ? ' active' : ''}" data-v="recent">RECENT</span>` +
    '</div>' +
    // the metric pills only rank TOP; RECENT is already answered by its order
    (scoreView === 'top'
      ? `<div class="scpills">` +
        `<span class="scpill${scoreMetric === 'w' ? ' active' : ''}" data-m="w">WAVES</span>` +
        `<span class="scpill${scoreMetric === 'k' ? ' active' : ''}" data-m="k">ENEMIES</span>` +
        `<span class="scpill${scoreMetric === 'd' ? ' active' : ''}" data-m="d">TIME</span>` +
        `</div>`
      : '') + rows;
}

// Each wave is a street encounter: a quota big enough to roam through, and
// exactly one new enemy type debuting per wave so the game keeps introducing
// itself. The debut headlines its wave and is the first thing you meet.
// One debut per wave, and the two attrition types that made wave 8 spike
// (armored needs headshots, shieldbearer needs flanking) are now separated
// by three waves instead of landing together as the ramp maxes out.
function composeWave(n) {
  const total = Math.min(COMP.baseTotal + COMP.perWave * n, COMP.totalCap);
  const debut = Object.keys(TYPE_INTRO).find((t) => TYPE_INTRO[t] === n);
  const queue = [];
  // the horde core: rushers scale up fast once they debut — this is a game
  // about managing the melee crush while gunfire crosses the street
  const rushers = n >= TYPE_INTRO.rusher ? Math.min(Math.round(total * COMP.rusherFrac), 2 + n) : 0;
  for (let i = 0; i < rushers; i++) queue.push('rusher');
  // the debuting type gets a real showing
  if (debut && debut !== 'gunner' && debut !== 'rusher' && debut !== 'laser') {
    for (let i = 0; i < Math.max(2, Math.round(total * COMP.debutFrac)); i++) queue.push(debut);
  }
  // veteran shooters fill in, capped so gunners keep at least ~25% of the wave
  const specials = [];
  for (const t in TYPE_SHARE) {
    if (n <= TYPE_INTRO[t]) continue;
    const [share, cap] = TYPE_SHARE[t];
    for (let i = 0; i < Math.min(cap, Math.floor(total / share)); i++) specials.push(t);
  }
  for (let i = specials.length - 1; i > 0; i--) {   // shuffle before truncating
    const j = Math.floor(Math.random() * (i + 1));
    [specials[i], specials[j]] = [specials[j], specials[i]];
  }
  const room = Math.max(0, total - queue.length - Math.ceil(total * COMP.gunnerFloor));
  queue.push(...specials.slice(0, room));
  while (queue.length < total) queue.push('gunner');
  for (let i = queue.length - 1; i > 0; i--) {   // shuffle
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  if (debut && debut !== 'gunner') {
    const i = queue.indexOf(debut);
    if (i > 0) { queue.splice(i, 1); queue.unshift(debut); }
  }
  // one laser anchors every other wave from its debut on
  if (n >= 10 && n % 2 === 0) queue.unshift('laser');
  return queue;
}

let timeScale = 1;

// --- time-control mode: 'classic' (hold to slow) or 'toggle' (button locks it)
let timeMode = 'toggle';   // button mode is the default
try { if (localStorage.getItem('timeshard_mode') === 'classic') timeMode = 'classic'; } catch { /* private mode */ }
let timeLocked = false;

// Button mode runs on a slow-mo bank: each wave charges it to BASE seconds,
// it drains in real time while locked, and every kill pours BONUS back in.
// Empty bank -> time snaps back (the usual resume sound/visuals fire).
const SLOWMO = { base: TIME.base, bonus: TIME.bonus, cap: TIME.cap, drain: TIME.drain,
  low: TIME.low, crit: TIME.crit };
let slowBank = SLOWMO.base;

function setTimeLocked(v) {
  if (v && timeMode === 'toggle' && slowBank <= 0) return;   // dry tank
  if (v && !timeLocked) noteTimeUse();
  timeLocked = v;
  el.timebtn.classList.toggle('locked', v);
  if (v && timeUses >= 6) el.timebtn.classList.remove('hint');   // lesson learned
}

// --- pause: freezes the whole simulation; settings + end run live inside
function openPause() {
  if (game.state !== 'play' && game.state !== 'intro' && game.state !== 'clear') return;
  game.pausedFrom = game.state;
  game.state = 'paused';
  sfx.fadeAll(0, 0.16);   // silence: a frozen world must not drone
  el.pausemenu.style.display = 'flex';
  input.pointers.clear();
  input.stickX = input.stickY = 0;
  input.holding = false;
  stickUI(false);
}
function closePause() {
  if (game.state !== 'paused') return;
  game.state = game.pausedFrom || 'play';
  el.pausemenu.style.display = 'none';
  sfx.fadeAll(1, 0.22);   // and back up as the world resumes
}
function openSettings() {
  updateCondPill();
  updateTutPill();
  const v = sfx.vols();
  el.setmusic.value = v.music;
  el.setsfx.value = v.sfx;
  el.sethaptics.textContent = hapticsOn ? 'ON' : 'OFF';
  el.sethaptics.classList.toggle('on', hapticsOn);
  el.modelink.textContent = timeMode === 'toggle' ? 'BUTTON' : 'CLASSIC';
  el.modelink.classList.toggle('on', timeMode === 'toggle');
  el.settings.style.display = 'flex';
}
function taglineFor() {
  return 'STOP TIME. SHATTER THEM ALL.';
}

function updateModeUI() {
  el.modelink.textContent = timeMode === 'toggle' ? 'BUTTON' : 'CLASSIC';
  el.modelink.classList.toggle('on', timeMode === 'toggle');
  if (game.state === 'menu') el.overlay.querySelector('.sub').textContent = taglineFor();
  const inRun = game.state === 'play' || game.state === 'intro' || game.state === 'clear';
  // The onboarding hides the button and the meter until it has taught the
  // rest of the controls, and updateModeUI runs from several places that
  // would otherwise hand them straight back.
  const on = timeMode === 'toggle' && inRun;
  el.timebtn.style.display = (on && !tutorBefore('incoming')) ? 'flex' : 'none';
  el.slowmeter.style.display = (on && !tutorBefore('dodged')) ? 'block' : 'none';
  el.gtime.style.display = timeMode === 'toggle' ? '' : 'none';
}
function updateSlowMeter() {
  el.slowfill.style.width = Math.max(0, Math.min(1, slowBank / SLOWMO.cap)) * 100 + '%';
  el.timebtn.classList.toggle('empty', slowBank <= 0);
  // Running dry is measured in SECONDS LEFT, not in fraction of the bar: the
  // bar's full height is the cap, which you rarely hold, so a fraction of it
  // would warn at wildly different real times. These are seconds of frozen
  // world at wave-1 cost, which is what the player is actually spending.
  const low = slowBank > 0 && slowBank <= SLOWMO.low;
  const crit = slowBank > 0 && slowBank <= SLOWMO.crit;
  el.slowmeter.classList.toggle('low', low && !crit);
  el.slowmeter.classList.toggle('crit', crit);
}
// ---------------------------------------------------------------------------
// ONBOARDING
//
// Four controls, taught in the order you need them, each step waiting on the
// player DOING the thing rather than on a clock. Nothing here is a modal: the
// game is running underneath the whole time, which is the only way a control
// tutorial can teach the feel of the control.
//
// The corridor is held empty until the shatter step, and the enemies that do
// arrive hold their fire until the last one — a player who has not yet been
// told what the freeze is for cannot be expected to dodge.
// ---------------------------------------------------------------------------
const TUTOR = {
  hallCells: 7,         // the straight teaching hallway, in 4 m cells
  moveNeeded: 2.2,      // metres walked before the move lesson is satisfied
  lookNeeded: 0.9,      // radians of yaw swept before the look lesson is
  barrierAt: 8,         // metres ahead the barrier already stands at the start
  barrierH: 1.05,       // low enough to see and shoot over
  enemyAt: 13,          // metres ahead of the player the first one stands
  // Rounds are SLOW in both clocks. The lesson is "step out of the way", and
  // a round you cannot see arrive teaches nothing. At 0.42x that is about
  // 4 m/s, so thirteen metres is a bit over two seconds of flight.
  bulletMul: 0.42,
  shots: 5,             // how many he fires, one at a time
  afterBarrier: 2.0,    // seconds after a round clears the barrier before the next
  meterSecs: 18,        // the scripted meter drains from full over this long
  faceRate: 5.5,        // how fast the view is eased back down the hallway
  gunRise: 0.6,         // seconds for the weapon to swing up into frame
  finalEnemies: 3,      // ...then two more join him and you shoot all three
};
const TUTOR_ORDER = ['move', 'look', 'aim', 'incoming', 'gunup', 'shoot',
  'advance', 'done'];
let tutorStep = null;      // null = not onboarding
let tutorT = 0, tutorSub = 0;
let tutorMoved = 0, tutorLooked = 0, tutorFroze = false;
let tutorMark = null;      // the enemy the hallway beat is about
let tutorRound = null;     // the one round currently in the air
let tutorShotsFired = 0, tutorDodged = 0, tutorCrossed = false;
let tutorMeterOn = false;
let tutorBar = null;
let tutorArmed = false, tutorSeen = false;
let tutorShaping = false, tutorLegsBuilt = 0;
try {
  tutorSeen = localStorage.getItem('timeshard_taught') === '1';
  tutorArmed = localStorage.getItem('timeshard_tutarm') === '1';
} catch { /* private */ }

const tutorActive = () => tutorStep !== null;
// Every "is this on screen yet" question is answered from the sequence order,
// never from a hand-written list of step names.
const tutorBefore = (step) => tutorStep !== null &&
  TUTOR_ORDER.indexOf(tutorStep) < TUTOR_ORDER.indexOf(step);
const tutorHoldsFire = () => tutorStep !== null;   // every round here is scripted
const tutorHoldsSpawns = () => tutorStep !== null;
const tutorBulletScale = () => (tutorStep !== null ? TUTOR.bulletMul : 1);
// YOU CANNOT SHOOT WHAT YOU HAVE NOT BEEN GIVEN. Tapping fired a round with no
// weapon on screen, which is the sort of thing a tutorial exists to prevent.
const tutorHoldsPlayerFire = () => tutorBefore('shoot');
// The first freeze is free: until the meter appears, stopping time costs
// nothing, because you are being taught what the button does.
const tutorFreeIsFree = () => tutorStep !== null && !tutorMeterOn;

function tutorMsg(html, where, pulse) {
  if (!el.tutormsg) return;
  el.tutormsg.innerHTML = html;
  el.tutormsg.className = `${where}${pulse ? ' pulse' : ''} show`;
  const wantsDown = where === 'btn' || where === 'twin';
  if (el.tutorarrow) el.tutorarrow.classList.toggle('on', wantsDown);
  if (el.tutorup) el.tutorup.classList.toggle('on', where === 'twin');
}
function tutorHideMsg() {
  if (el.tutormsg) el.tutormsg.className = '';
  if (el.tutorarrow) el.tutorarrow.classList.remove('on');
  if (el.tutorup) el.tutorup.classList.remove('on');
}
function tutorHand(kind) { if (el.tutorhand) el.tutorhand.className = kind ? `${kind} on` : ''; }
function tutorLine(on) { if (el.tutorline) el.tutorline.classList.toggle('on', !!on); }
function tutorShowMeter(on) { if (el.slowmeter) el.slowmeter.style.display = on ? 'block' : 'none'; }

// --- the teaching hallway's furniture -------------------------------------
// The barrier is already standing when the run begins, a couple of cells
// ahead, so the move lesson has somewhere to walk TO. It rises out of nothing
// only when it is built mid-lesson, which it no longer is — hence no stray
// airlock thump on the opening frame.
const TUTOR_BAR_MAT = new THREE.MeshLambertMaterial({ color: 0x3b4148 });
function tutorBuildBarrier() {
  if (tutorBar || game.mode !== 'hall' || !hall) return;
  const L = hall.legs[hall.cur], C = HALL.cell;
  const z = player.pos.z + TUTOR.barrierAt;
  // WALL TO WALL, derived from the leg's own extent: it is a barrier, not a
  // crate, and there must be no edge to walk round.
  let minGx = Infinity, maxGx = -Infinity;
  for (const [gx] of L.cells) { minGx = Math.min(minGx, gx); maxGx = Math.max(maxGx, gx); }
  const w = (maxGx - minGx + 1) * C + 1.6;
  const x = (minGx + maxGx) / 2 * C;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, TUTOR.barrierH, 0.5), TUTOR_BAR_MAT);
  m.position.set(x, TUTOR.barrierH / 2, z);
  scene.add(m);
  const ob = { min: new THREE.Vector3(x - w / 2, 0, z - 0.25),
    max: new THREE.Vector3(x + w / 2, TUTOR.barrierH, z + 0.25) };
  L.obs.push(ob);
  rebuildHallObstacles();
  tutorBar = { m, ob, L, z, y: TUTOR.barrierH / 2 };
}
function tutorDropBarrier() {
  if (!tutorBar) return;
  const i = tutorBar.L.obs.indexOf(tutorBar.ob);
  if (i >= 0) tutorBar.L.obs.splice(i, 1);
  rebuildHallObstacles();
  tutorBar.sinking = true;
  sfx.airlock();
}
function tutorUpdateBarrier(dtReal) {
  if (!tutorBar || !tutorBar.sinking) return;
  tutorBar.y -= dtReal * 2.4;
  tutorBar.m.position.y = tutorBar.y;
  if (tutorBar.y < -TUTOR.barrierH) { scene.remove(tutorBar.m); tutorBar = null; }
}

// --- the script's own trigger finger --------------------------------------
function tutorShot(e) {
  if (!e || !e.alive) return null;
  const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
  e.g.rotation.y = Math.atan2(dx, dz) + Math.PI;
  const origin = _v2.set(e.pos.x, 1.35, e.pos.z);
  const target = _v3.set(player.pos.x, EYE_HEIGHT - 0.2, player.pos.z);
  const d = target.sub(origin).normalize();
  spawnBullet(origin, d, false, TUTOR.bulletMul);
  muzzleFlash(origin.x, origin.y, origin.z, 0.85);
  sfx.enemyShot();
  const b = bullets[bullets.length - 1];
  return b ? { b, passedBar: false, counted: false } : null;
}
function tutorPlaceEnemy(z, xOff = 0) {
  spawnEnemy('gunner');
  const e = enemies[enemies.length - 1];
  if (!e) return null;
  e.hold = { x: player.pos.x + xOff, z };
  e.pos.set(e.hold.x, 0, z);
  e.g.position.set(e.hold.x, 0, z);
  return e;
}

function startTutorial() {
  tutorStep = 'move';
  tutorT = 0; tutorSub = 0;
  tutorMoved = 0; tutorLooked = 0; tutorFroze = false;
  tutorMark = null; tutorRound = null;
  tutorShotsFired = 0; tutorDodged = 0; tutorMeterOn = false; tutorCrossed = false;
  document.body.classList.add('tutoring');
  gun.visible = false;
  el.timebtn.style.display = 'none';
  tutorShowMeter(false);
  hideTimeTip();
  tutorBuildBarrier();          // already standing: nothing to hear
  tutorLine(true);
  tutorMsg('DRAG TO MOVE', 'left');
  tutorHand('up');
}
function endTutorial(taught = true) {
  tutorStep = null;
  tutorShaping = false;
  document.body.classList.remove('tutoring');
  tutorHideMsg(); tutorHand(null); tutorLine(false);
  el.timebtn.classList.remove('arrive', 'hint');
  gun.visible = true;
  if (el.ammo) el.ammo.style.display = '';
  if (tutorBar) tutorDropBarrier();
  for (const e of enemies) e.hold = null;
  updateModeUI();
  tutorSeen = true;
  try { persist('timeshard_taught', '1'); } catch { /* private */ }
  tutorArmed = false;
  try { persist('timeshard_tutarm', ''); } catch { /* private */ }
  updateTutPill();
  if (taught) { const t = 'REACH THE RED DOOR'; setTimeout(() => showBanner(t, 2200), 60); }
}
function tutorNext(step) { tutorStep = step; tutorT = 0; tutorSub = 0; }
function tutorRevealButton() {
  updateModeUI();
  el.timebtn.classList.remove('arrive');
  void el.timebtn.offsetWidth;
  el.timebtn.classList.add('arrive', 'hint');
}
const TUTOR_TWIN =
  'YOUR TIME METER IS RUNNING OUT<span>TAP TO RESUME TIME</span>';

// Driven on REAL time from the frame loop, after input and movement have been
// applied, so "did they do it yet" is answered against this frame's state.
function updateTutorial(dtReal, movedM, yawDelta) {
  if (tutorStep === null) return;
  tutorT += dtReal;
  tutorSub -= dtReal;
  if (!player.alive) { endTutorial(false); return; }
  tutorUpdateBarrier(dtReal);
  tutorShowMeter(tutorMeterOn);
  if (el.ammo) el.ammo.style.display = tutorBefore('shoot') ? 'none' : '';

  // the one round in the air: has it cleared the barrier, and has it gone past
  if (tutorRound) {
    const alive = bullets.indexOf(tutorRound.b) >= 0;
    if (alive) {
      const bz = tutorRound.b.pos.z;
      if (!tutorRound.passedBar && tutorBar && bz < tutorBar.z) {
        tutorRound.passedBar = true;
        tutorSub = TUTOR.afterBarrier;   // two seconds, then the next one
      }
      if (!tutorRound.counted && bz < player.pos.z - 0.3) {
        tutorRound.counted = true;
        tutorDodged++;
        if (!tutorMeterOn) {   // the meter lesson starts on the FIRST dodge
          tutorMeterOn = true;
          slowBank = SLOWMO.cap;
          updateSlowMeter();
          tutorMsg(TUTOR_TWIN, 'twin', true);
        }
      }
    } else if (!tutorRound.counted) {
      tutorRound = null;   // it hit something; the next shot still comes
    }
    if (tutorRound && tutorRound.counted) tutorRound = null;
  }
  // once the meter lesson is on, the bank drains on the SCRIPT's clock so the
  // beat is readable rather than tied to whatever the drain rate happens to be
  if (tutorMeterOn && timeLocked) {
    slowBank = Math.max(0, slowBank - dtReal * SLOWMO.cap / TUTOR.meterSecs);
    updateSlowMeter();
  }

  switch (tutorStep) {
    case 'move':
      tutorMoved += movedM;
      if (tutorMoved > TUTOR.moveNeeded) {
        tutorNext('look');
        tutorMsg('DRAG TO LOOK', 'right');
        tutorHand('side');
      }
      break;

    case 'look':
      tutorLooked += Math.abs(yawDelta);
      if (tutorLooked > TUTOR.lookNeeded) {
        tutorNext('aim');
        tutorLine(false); tutorHand(null); tutorHideMsg();
      }
      break;

    case 'aim': {
      // FACE THE HALLWAY AGAIN. The look lesson ends wherever the thumb left
      // them, which can be a blank wall, and the next beat is "a man is
      // standing down there and he has just shot at you".
      const k = 1 - Math.exp(-TUTOR.faceRate * dtReal);
      let d = Math.PI - player.yaw;                     // +z is yaw = PI
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      player.yaw += d * k;
      player.pitch += (0 - player.pitch) * k;
      if (Math.abs(d) < 0.05) {
        tutorNext('incoming');
        tutorMark = tutorPlaceEnemy(player.pos.z + TUTOR.enemyAt);
        tutorRevealButton();
        tutorMsg('TAP TO SLOW TIME', 'btn', true);
        tutorRound = tutorShot(tutorMark);
        tutorShotsFired = 1;
        tutorSub = 6;   // a fallback, in case the round dies early
      }
      break;
    }

    case 'incoming':
      // one at a time, the next two seconds after the last cleared the barrier
      // He keeps firing until five have been DODGED, not until five have been
      // fired. Capping the shots instead means a player who takes a hit runs
      // out of rounds to practise on and the step can never complete — a
      // soft-lock in the one place in the game that must not have one.
      if (!tutorRound && tutorSub <= 0 && tutorDodged < TUTOR.shots) {
        tutorRound = tutorShot(tutorMark);
        tutorShotsFired++;
        tutorSub = 6;
      }
      if (tutorFroze) el.timebtn.classList.remove('hint');
      if (tutorDodged >= TUTOR.shots && !timeLocked) {
        tutorNext('gunup');
        tutorHideMsg();
        gunRiseT = TUTOR.gunRise;
        game.noFireBefore = 0;
      }
      break;

    case 'gunup':
      if (gunRiseT <= 0) {
        tutorNext('shoot');
        // two more join him: three to clear before the door opens
        for (let i = 1; i < TUTOR.finalEnemies; i++) {
          tutorPlaceEnemy(player.pos.z + TUTOR.enemyAt + (i - 1) * 1.5,
            i === 1 ? -2.4 : 2.4);
        }
        tutorMsg('TAP ANYWHERE TO SHOOT', 'mid', true);
      }
      break;

    case 'shoot':
      // never let them run dry while they are learning to pull the trigger
      if (player.mag <= 0 && player.reloadT <= 0) {
        player.mag = WEAPONS[player.weapon].mag;
        player.clips = Math.max(player.clips, 1);
        updateAmmoHud();
      }
      if (!enemies.length) {
        tutorNext('advance');
        tutorMark = null;
        tutorDropBarrier();
        if (hall && hall.legs[hall.cur] && !hall.legs[hall.cur].door.open) openHallDoor();
        tutorMsg('ENTER THE NEXT ROOM', 'mid');
      }
      break;

    case 'advance':
      if (hall && hall.doorsPassed >= 1) { tutorNext('done'); tutorSub = 0.4; }
      break;

    case 'done':
      if (tutorSub <= 0) endTutorial(true);
      break;

    default: break;
  }
}

let gunRiseT = 0;   // seconds left of the weapon's rise into frame
let tutorPrevX = 0, tutorPrevZ = 0, tutorPrevYaw = 0;

let demoT = 0, demoSpawnT = 0.3, demoKillT = 4;   // menu attract-mode clocks

// New players were missing the time button entirely. It now re-teaches
// itself at the start of every wave until it has been used several times.
let timeUses = 0;
try { timeUses = parseInt(localStorage.getItem('timeshard_timeuses') || '0', 10) || 0; } catch { /* private */ }
function noteTimeUse() {
  tutorFroze = true;
  if (timeUses >= 99) return;
  timeUses++;
  try { localStorage.setItem('timeshard_timeuses', String(timeUses)); } catch { /* private */ }
  hideTimeTip();
}
function showTimeTip() {
  if (timeMode !== 'toggle' || timeUses >= 6) return;
  el.timetip.classList.add('show');
  el.timebtn.classList.add('hint');
  clearTimeout(showTimeTip._t);
  showTimeTip._t = setTimeout(hideTimeTip, 3600);
}
function hideTimeTip() {
  clearTimeout(showTimeTip._t);
  el.timetip.classList.remove('show');
  if (timeUses >= 6) el.timebtn.classList.remove('hint');
}

const el = {
  overlay: document.getElementById('overlay'),
  score: document.getElementById('score'),
  menubtn: document.getElementById('menubtn'),
  pausebtn: document.getElementById('pausebtn'),
  pausemenu: document.getElementById('pausemenu'),
  settings: document.getElementById('settings'),
  setlink: document.getElementById('setlink'),
  setmusic: document.getElementById('setmusic'),
  setsfx: document.getElementById('setsfx'),
  sethaptics: document.getElementById('sethaptics'),
  timebtn: document.getElementById('timebtn'),
  modelink: document.getElementById('modelink'),
  condlink: document.getElementById('condlink'),
  gtime: document.getElementById('gtime'),
  slowmeter: document.getElementById('slowmeter'),
  tutormsg: document.getElementById('tutormsg'),
  tutorhand: document.getElementById('tutorhand'),
  tutorline: document.getElementById('tutorline'),
  tutorarrow: document.getElementById('tutorarrow'),
  tutorup: document.getElementById('tutorup'),
  tutlink: document.getElementById('tutlink'),
  slowfill: document.getElementById('slowfill'),
  flash: document.getElementById('flash'),
  banner: document.getElementById('banner'),
  tint: document.getElementById('tint'),
  redflash: document.getElementById('redflash'),
  crosshair: document.getElementById('crosshair'),
  ammo: document.getElementById('ammo'),
  stickBase: document.getElementById('stickbase'),
  stickNub: document.getElementById('sticknub'),
  warn: document.getElementById('warn'),
  guide: document.getElementById('guide'),
  scores: document.getElementById('scores'),
  sndbtn: document.getElementById('sndbtn'),
  howtolink: document.getElementById('howtolink'),
  htp: document.getElementById('htp'),
  enm: document.getElementById('enm'),
  arch: document.getElementById('arch'),
  archlist: document.getElementById('archlist'),
  archmeta: document.getElementById('archmeta'),
  menurow: document.getElementById('menurow'),
  moderow: document.getElementById('moderow'),
  rushlink: document.getElementById('rushlink'),
  citylink: document.getElementById('citylink'),
  altwrap: document.getElementById('altwrap'),
  timetip: document.getElementById('timetip'),
  reloadbar: document.getElementById('reloadbar'),
  reloadfill: document.getElementById('reloadfill'),
};

// ---------------------------------------------------------------------------
// THE ARCHIVE
//
// Depth is a number — "34 doors" — and a number is not a reason to go back in.
// The archive turns it into a ledger of what the building has shown you, and
// what it still hasn't. Every slot is visible from the very first run: a
// locked row hides the NAME and keeps the DESIGNATION, so you can always see
// how much is left without being told what it is.
//
// Unlocking is MEETING, not defeating. Walking into a fog leg files FOG;
// living through it is a separate matter.
// ---------------------------------------------------------------------------
const ARCH_SECTIONS = [
  { title: 'ENEMIES', kinds: ['enemy'] },
  { title: 'PROTOCOLS', kinds: ['form', 'condition', 'measure'] },
  { title: 'WEAPONS', kinds: ['weapon'] },
];

function renderArchive() {
  let html = '', known = 0, total = 0;
  for (const sec of ARCH_SECTIONS) {
    const rows = ELEMENTS.filter((e) => sec.kinds.includes(e.kind));
    const got = rows.reduce((n, e) => n + (archive.has(e.id) ? 1 : 0), 0);
    known += got; total += rows.length;
    html += `<div class="asec">${sec.title}<i>${got}/${rows.length}</i></div>`;
    for (const e of rows) {
      const on = archive.has(e.id);
      // The redaction is as wide as the real name, so a long name reads as a
      // long bar — the only thing a locked row gives you, and a good hook.
      // It is drawn in CSS rather than typed as block characters: U+2588 is
      // missing from plenty of system stacks and falls back to tofu.
      const bar = `<b class="redact" style="width:${Math.round(
        Math.max(4, Math.min(11, e.name.length)) * 7.4)}px"></b>`;
      html += `<div class="arow${on ? '' : ' locked'}">` +
        `<div class="adesig">${e.designation}</div><div>` +
        (on ? `<b>${e.name}</b><span>${e.archive}</span>` : bar) + `</div></div>`;
    }
  }
  el.archlist.innerHTML = html;
  el.archmeta.textContent =
    `${known} OF ${total} RECOVERED · ${lifetimeDoors} DOOR${lifetimeDoors === 1 ? '' : 'S'}`;
  archiveDirty = false;
}

function openArchive() {
  if (archiveDirty) renderArchive();
  el.arch.style.display = 'flex';
  el.archlist.scrollTop = 0;
}

renderScores();

// swap the h1's plain SHARD for the faceted polygon wordmark BEFORE the menu
// snapshot below, so MAIN MENU restores the styled title too
{
  const tw = Math.min(Math.round(window.innerWidth * 0.84), 330);
  const built = buildWordSVG('SHATTER', Math.round(tw * 100 / 648));
  titleW = built.W;
  el.overlay.querySelector('h1').innerHTML = 'TIME' + built.svg;
  collectTitleFacets();
  shimmerAt = performance.now() / 1000 + SHIMMER_FIRST_DELAY;
}

// flat, single-color speaker glyphs
const SND_ON_SVG =
  '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>' +
  '<path d="M16 8.6a4.4 4.4 0 010 6.8M18.6 6.2a8 8 0 010 11.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SND_OFF_SVG =
  '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>' +
  '<path d="M16.2 9.7l4.6 4.6M20.8 9.7l-4.6 4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function updateSndBtn() {
  el.sndbtn.innerHTML = sfx.isMuted() ? SND_OFF_SVG : SND_ON_SVG;
  el.sndbtn.classList.toggle('muted', sfx.isMuted());
}
updateSndBtn();

// the title screen's original copy, so MAIN MENU can restore it after a death
const MENU_HTML = {
  h1: el.overlay.querySelector('h1').innerHTML,
  sub: el.overlay.querySelector('.sub').innerHTML,
  rules: el.overlay.querySelector('.rules').innerHTML,
  go: el.overlay.querySelector('.go').innerHTML,
};

function showMenu() {
  sfx.fadeAll(1, 0.35);
  clearMessages();
  clearField();
  el.pausebtn.style.display = 'none';
  setTimeLocked(false);
  updateModeUI();
  player.alive = true;
  player.pos.set(0, 0, 14);
  player.vel.set(0, 0, 0);
  player.yaw = 0; player.pitch = 0; player.roll = 0;
  input.pointers.clear();
  input.stickX = input.stickY = 0;
  input.holding = false;
  stickUI(false);
  sprintTo = null;
  setWeapon('pistol');
  game.state = 'menu';
  game.wave = 1;
  game.kills = 0;
  game.noFireBefore = 0;
  el.guide.style.opacity = 0;
  el.guide.style.display = 'none';
  el.overlay.querySelector('h1').innerHTML = MENU_HTML.h1;
  el.overlay.querySelector('.sub').textContent = taglineFor();
  el.overlay.querySelector('.rules').innerHTML = MENU_HTML.rules;
  el.overlay.querySelector('.go').innerHTML = MENU_HTML.go;
  el.overlay.querySelector('.go').classList.remove('long');
  el.overlay.querySelector('.rules').style.display = 'none';
  el.menurow.style.display = 'flex';
  el.moderow.style.display = 'flex';
  el.altwrap.style.display = '';
  for (const d of document.querySelectorAll('.mdiv')) d.style.display = '';
  setEnvironment('city');
  renderScores();
  updateSndBtn();
  el.menubtn.style.display = 'none';
  el.redflash.style.opacity = 0;
  el.overlay.classList.remove('hidden');
  collectTitleFacets();   // the restore above created fresh title nodes
  shimmerAt = performance.now() / 1000 + SHIMMER_FIRST_DELAY;
}

function updateAmmoHud() {
  const spec = WEAPONS[player.weapon];
  const name = player.weapon.toUpperCase();
  if (player.weapon === 'knife') {
    el.ammo.textContent = 'KNIFE · NO AMMO';
  } else if (player.reloadT > 0) {
    el.ammo.textContent = `${name} · RELOADING`;
  } else {
    const pips = '▮'.repeat(Math.max(player.mag, 0)) +
      '▯'.repeat(Math.max(spec.mag - Math.max(player.mag, 0), 0));
    el.ammo.textContent = `${name} · ${pips}` +
      (player.clips > 0 ? ' · +' + player.clips : '');
  }
  el.ammo.classList.remove('shotgun');   // the HUD stays ink; red is the bank
}

let lastWarnAt = -10;
function warnFlash(words) {
  const now = performance.now() / 1000;
  if (now - lastWarnAt < 4) return;   // don't nag
  if (performance.now() < messageBusyUntil) return;   // a card already owns the screen
  lastWarnAt = now;
  messageBusyUntil = performance.now() + 1900;
  el.warn.innerHTML = words
    .map((w, i) => `<span class="warnword${i ? ' w2' : ''}">${w}</span>`)
    .join('');
  clearTimeout(warnFlash._t);
  warnFlash._t = setTimeout(() => { el.warn.innerHTML = ''; }, 1500);
}

// red chevrons at the screen edge pointing toward off-screen enemies
const edgeArrows = [];
function updateEdgeArrows(playing) {
  const dirs = [];
  if (playing && player.alive) {
    for (const e of enemies) {
      let dYaw = Math.atan2(-(e.pos.x - player.pos.x), -(e.pos.z - player.pos.z)) - player.yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      if (Math.abs(dYaw) > EDGE_ARROW_MIN) dirs.push(dYaw);
      if (dirs.length >= 6) break;
    }
  }
  while (edgeArrows.length < dirs.length) {
    const d = document.createElement('div');
    d.className = 'edgearrow';
    d.textContent = '▲';
    document.getElementById('hud').appendChild(d);
    edgeArrows.push(d);
  }
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const R = Math.min(window.innerWidth, window.innerHeight) * 0.38;
  for (let i = 0; i < edgeArrows.length; i++) {
    const a = edgeArrows[i];
    if (i < dirs.length) {
      // positive dYaw = enemy to the LEFT (yaw increases counter-clockwise),
      // so mirror: left-enemy arrow sits on the left edge pointing left
      const th = -dirs[i];
      a.style.display = 'block';
      a.style.left = `${cx + Math.sin(th) * R}px`;
      a.style.top = `${cy - Math.cos(th) * R}px`;
      a.style.transform = `translate(-50%,-50%) rotate(${th}rad)`;
    } else {
      a.style.display = 'none';
    }
  }
}

const KILLFLASH_MS = 1600;       // long enough for the slowed recorded word
let killFlashUntil = 0;          // wave-clear waits for the last flash to finish

function killWord() {
  // the flash appears only when the announcer actually speaks the word —
  // first two eligible kills of a wave — so sight and sound always agree
  if (game.state === 'menu') return;
  const word = sfx.say();
  if (!word) return;
  const { svg } = buildWordSVG(word, word.length > 5 ? 44 : 58);   // fits SHATTER
  el.flash.innerHTML = '<span class="kwskew"><span class="kwflash">' + svg + '</span></span>';
  killFlashUntil = performance.now() + KILLFLASH_MS;
  clearTimeout(killWord._t);
  killWord._t = setTimeout(() => { el.flash.innerHTML = ''; }, KILLFLASH_MS + 50);
}

// A single message channel. Cards queue behind one another with a beat of
// clear screen between them, so a wave card and an enemy-name card can
// never land together — and spawns hold off while one is up (see
// messageBusyUntil, read by the spawner).
let messageBusyUntil = 0;
const messageQueue = [];
// ONE LINE, THE NEWEST THING, AND WHAT TO DO ABOUT IT.
//
// The door banner used to read "CHECKPOINT / DOOR 6 / CORRIDOR · FOG · ALCOVES"
// — three lines listing everything the leg is, in a moment where you are
// walking into a fight and reading none of it. Playtest: "simplify our
// messages upon entering each room, so that the text is clear, just one line,
// the most important thing that's new, actionable, in just a few words."
//
// So there is a priority, not a list: a CONDITION changes how you play, so it
// wins; then a MEASURE, which changes what the building does to you; then the
// FORM; and if the leg is plain, the door number is the news.
const LEG_HEADLINES = {
  fog: 'FOG · FREEZE TO SEE',
  blackout: 'BLACKOUT · FREEZE TO SEE',
  dimStrips: 'LIGHTS AT HALF',
  flood: 'FLOODED · YOU ARE SLOW',
  deadAir: 'DEAD AIR · YOU WON\'T HEAR THEM',
  oneWaySeal: 'IT SEALS BEHIND YOU',
  grinder: 'GRINDER · KEEP MOVING',
  breachWalls: 'THEY COME THROUGH THE WALLS',
  turretDrop: 'TURRET · IT DOES NOT RELOAD',
  vault: 'PILLARS ARE YOUR ONLY COVER',
  gauntlet: 'NO COVER · DO NOT STOP',
  atrium: 'IT OPENS UP',
  serviceRun: 'TIGHT TURNS',
  gallery: 'THEY CAN SEE THE WHOLE RUN',
  stairwell: 'MIND THE LEVEL ABOVE',
  spiral: 'NO STRAIGHT LINE OUT',
};
function legHeadline(proto) {
  const pick = (e) => e && LEG_HEADLINES[e.id];
  const line = pick(proto && proto.condition)
    || (proto && proto.measures || []).map(pick).find(Boolean)
    || pick(proto && proto.form);
  return line || `DOOR ${hall ? hall.doorsPassed : 1}`;
}

function showBanner(html, dur = 1600) {
  // The onboarding owns the screen. "THE DOOR IS OPEN" landing on top of
  // "DRAG TO MOVE" is two instructions at once, and the one the player needs
  // is the smaller of the two.
  if (tutorStep !== null) return;
  messageQueue.push({ html, dur });
  pumpMessages();
}
function pumpMessages() {
  if (!messageQueue.length) return;
  const now = performance.now();
  if (now < messageBusyUntil) {
    clearTimeout(pumpMessages._t);
    pumpMessages._t = setTimeout(pumpMessages, messageBusyUntil - now + 30);
    return;
  }
  const m = messageQueue.shift();
  el.banner.innerHTML = m.html;
  el.banner.classList.add('show');
  messageBusyUntil = now + m.dur + 500;   // the gap between cards
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.banner.classList.remove('show'), m.dur);
  if (messageQueue.length) {
    clearTimeout(pumpMessages._t);
    pumpMessages._t = setTimeout(pumpMessages, m.dur + 520);
  }
}
function clearMessages() {
  messageQueue.length = 0;
  messageBusyUntil = 0;
  clearTimeout(pumpMessages._t);
  clearTimeout(showBanner._t);
  el.banner.classList.remove('show');
}

function startWave(n, quiet = false) {   // quiet: the clear card already announced it
  game.wave = n;
  game.state = 'intro';
  game.stateT = 0;
  game.spawnQueue = composeWave(n);
  game.spawnTimer = 0;
  recordMet(['pistol']);   // it is already in your hand
  // attack bearing: toward the open arena from wherever the player stands,
  // or a random direction if they're near the middle
  const dx = -player.pos.x, dz = -player.pos.z;
  game.waveBearing = Math.hypot(dx, dz) > 3 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2;
  if (n > bestWave) {
    bestWave = n;
    try { persist('timeshard_best', String(n)); } catch { /* private mode */ }
  }
  if (!quiet) {
    showBanner(`WAVE ${n}`, 1300);
    showTimeTip();
    if (n > 1) sfx.wave();   // wave 1 is the onboarding — it starts silent
  }
  sfx.newWave();
  el.pausebtn.style.display = 'block';
  el.ammo.style.display = '';
  setTimeLocked(false);   // each wave starts at full speed in button mode
  // new run: fresh tank; later waves carry surplus over but never start dry
  slowBank = n === 1 ? SLOWMO.base : Math.max(slowBank, SLOWMO.base);
  updateSlowMeter();
  updateModeUI();
}

// how many are ON the street — the aim-token cap keeps most of them
// stalking rather than shooting, so density can run higher than pressure
function maxAlive() {
  // how many can be ON you at once — the dial that decides whether a fight
  // is a queue or a swarm, so it is the one that moves least
  if (game.mode === 'hall') {
    // A condition thins the crowd as well as the loot: two bodies met
    // separately are two searches, where a clump is one problem solved once.
    if (game.wave <= EARLY.soloDoors) return 1;
    return Math.max(1, Math.round(
      Math.min(PACING.hallAliveBase + Math.floor(game.wave / 2), PACING.hallAliveCap)
      * scarcity('groupSize', game.wave) * condTax(legCondition(), 'groupSize')));
  }
  return Math.min(PACING.cityAliveBase + Math.floor(game.wave / 2), PACING.cityAliveCap);
}

let deathAt = 0;

function hitPlayer(ended = false) {
  if (!player.alive || (player.iframes > 0 && !ended)) return;
  // You cannot fail the onboarding. Being hit while learning to dodge stings
  // — the screen flashes, the phone thumps — and then the lesson continues,
  // because a first-time player who dies during the tutorial has learned
  // only that the tutorial can be lost.
  if (tutorStep !== null && !ended) {
    player.iframes = 0.9;
    el.redflash.style.opacity = '1';
    setTimeout(() => { el.redflash.style.opacity = '0'; }, 130);
    vibrate([40, 60, 40]);
    return;
  }
  player.alive = false;
  sprintTo = null;
  game.state = 'dead';
  game.stateT = 0;
  deathAt = performance.now();
  sfx.fadeAll(0, ended ? 0.3 : 1.1);   // the run's audio dies with you
  recordRun();
  el.guide.style.opacity = 0;
  el.guide.style.display = 'none';
  el.pausebtn.style.display = 'none';
  el.ammo.style.display = 'none';   // the overlay's stats line lands there
  setTimeLocked(false);
  el.timebtn.style.display = 'none';
  el.slowmeter.style.display = 'none';   // the meter goes with its button
  hideTimeTip();
  clearMessages();
  for (const d of document.querySelectorAll('.mdiv')) d.style.display = 'none';
  el.reloadbar.style.display = 'none';
  // retry retries THIS mode only — the alternates leave the death screen
  el.altwrap.style.display = 'none';
  if (!ended) {   // a chosen exit skips the death drama
    el.redflash.style.opacity = 1;
    sfx.die();
    vibrate([60, 40, 120]);
  }
  setTimeout(() => {
    if (game.state !== 'dead') return;   // already retried — don't resurrect the overlay
    el.overlay.querySelector('h1').innerHTML = ended ? 'RUN<br><em>ENDED</em>' : 'YOU<br><em>DIED</em>';
    el.overlay.querySelector('.sub').textContent = ended ? 'YOU CALLED IT' : 'ONE HIT IS ALL IT TAKES';
    const r = el.overlay.querySelector('.rules');
    // A run that showed you something new says so. It is the only place the
    // archive advertises itself, and dying with a find is the moment you are
    // most likely to go and look at it.
    const filed = runFiled ? `<div class="filed">+${runFiled} FILED TO THE ARCHIVE</div>` : '';
    r.innerHTML = (game.mode === 'rush'
      ? `<div class="stats">RUSH HOUR · ${markPips} ${markPips === 1 ? 'MARK' : 'MARKS'} · ` +
        `${game.kills} SHATTERED · ${Math.round(runPlayT)}S</div>`
      : game.mode === 'hall'
      ? `<div class="stats">TUNNEL · ${hall ? hall.doorsPassed : 0} ` +
        `${hall && hall.doorsPassed === 1 ? 'DOOR' : 'DOORS'} · ${game.kills} SHATTERED</div>`
      : `<div class="stats">${game.wave} ${game.wave === 1 ? 'WAVE' : 'WAVES'} · ` +
        `${game.kills} SHATTERED · BEST ${bestWave} ${bestWave === 1 ? 'WAVE' : 'WAVES'}</div>`) + filed;
    r.style.display = 'flex';
    el.scores.style.display = 'none';
    el.menurow.style.display = 'none';
    el.moderow.style.display = 'none';   // keep the stats line's row clear
    const goEl = el.overlay.querySelector('.go');
    goEl.textContent = game.mode === 'rush' ? 'RETRY RUSH HOUR'
      : game.mode === 'hall' ? 'RETRY FROM LAST DOOR' : 'RETRY WAVE';
    goEl.classList.add('long');
    el.menubtn.style.display = 'inline-block';
    el.overlay.classList.remove('hidden');
  }, ended ? 400 : 900);
}

function clearField() {
  clearCrowd();
  for (let i = enemies.length - 1; i >= 0; i--) {
    removeEnemyShards(enemies[i]);
    removeBeam(enemies[i]);
    scene.remove(enemies[i].g);
    enemies.splice(i, 1);
  }
  for (let i = bullets.length - 1; i >= 0; i--) killBullet(i, null);
  clearShardPool(debrisPool);
  clearShardPool(assemblePool);
  for (let i = ripples.length - 1; i >= 0; i--) {
    scene.remove(ripples[i].mesh);
    freeMat('ripple', ripples[i].mesh.material);
    ripples.splice(i, 1);
  }
  for (let i = grenades.length - 1; i >= 0; i--) {
    scene.remove(grenades[i].mesh);
    scene.remove(grenades[i].ring);
    freeMat('gring', grenades[i].ring.material);
    grenades.splice(i, 1);
  }
  for (let i = missiles.length - 1; i >= 0; i--) {
    scene.remove(missiles[i].mesh);
    missiles.splice(i, 1);
  }
  for (let i = shells.length - 1; i >= 0; i--) {
    scene.remove(shells[i].mesh);
    shells.splice(i, 1);
  }
  for (let i = pickups.length - 1; i >= 0; i--) removePickup(i);
}

function showGuide() {
  // the guide IS the intro — suppress the WAVE 1 banner underneath it
  clearMessages();
  const g = el.guide;
  g.style.display = 'flex';
  g.style.opacity = 1;
  // in button mode, the clock pulses until it's pressed for the first time
  if (timeMode === 'toggle') el.timebtn.classList.add('hint');
  setTimeout(() => { g.style.opacity = 0; }, 3000);   // hold 3s...
  setTimeout(() => { g.style.display = 'none'; }, 5200);   // ...fade 2s, gone
  game.introLen = 3;   // the first enemy steps out as the guide starts to fade
  game.noFireBefore = performance.now() + 6000;   // ...and holds fire 1s after it clears
}

function advanceFromOverlay() {
  sfx.fadeAll(1, 0.25);
  el.overlay.classList.add('hidden');
  el.redflash.style.opacity = 0;
  runFiled = 0;   // a retry is a new life, so it gets its own tally
  if (game.state === 'menu') {
    clearField();   // sweep away the attract-mode fight
    player.alive = true;
    player.pos.set(0, 0, 14);
    player.vel.set(0, 0, 0);
    player.yaw = 0; player.pitch = 0; player.roll = 0;
    player.iframes = 1;
    game.kills = 0;
    game.seenTypes = {};   // fresh run: every type announces itself again
    runStartAt = Date.now();
    runPlayT = 0;
    setWeapon('pistol');
    sfx.flush();   // a fresh run starts silent, whatever the last one was doing
    if (game.mode === 'rush') initRush();
    else if (game.mode === 'hall') initHall();
    else { startWave(1); showGuide(); }
  } else {   // retry current wave
    clearField();
    sfx.flush();   // drain the dead run's echo tail and re-seat the music
    player.alive = true;
    player.pos.set(0, 0, 14);
    player.vel.set(0, 0, 0);
    player.yaw = 0; player.pitch = 0; player.roll = 0;
    player.iframes = 1;
    input.pointers.clear();
    input.stickX = input.stickY = 0;
    input.holding = false;
    stickUI(false);
    sprintTo = null;
    setWeapon('pistol');
    if (game.mode === 'rush') initRush();
    else if (game.mode === 'hall') retryHall();
    else startWave(game.wave);
  }
}

// ---------------------------------------------------------------------------
// HALLWAY mode: door-to-door corridor legs. Each leg is a wave — clear it
// and the red door slides into the floor; crossing it is a checkpoint, and
// the door seals shut behind you. Corridors turn and branch, but every
// route leads to the next door.
const HALL_FINALE = LEG.finaleWave;   // the one final group staged at the door
function makeHallWallTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#cfdce2'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(28,52,66,0.14)';
  for (let i = 0; i < 2; i++) g.fillRect(i * 128 + 62, 0, 4, 256);   // panel seams every 2m
  g.fillStyle = 'rgba(28,52,66,0.08)';
  g.fillRect(0, 74, 256, 3);                                          // datum line
  g.fillStyle = 'rgba(28,52,66,0.35)';
  g.fillRect(0, 236, 256, 20);                                        // baseboard
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function makeHallFloorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c2d2d9'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(28,52,66,0.12)'; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {                                      // 1m tile grid
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const HALL_WALL_MAT = new THREE.MeshLambertMaterial({ map: makeHallWallTexture() });
// unlit: Lambert undersides get no directional light and go near-black
// The ceiling is roughly half of a portrait frame and it was ONE FLAT COLOUR
// — the single largest dead area on screen. Beams break it up further down
// the corridor, but directly overhead there is nothing for the eye to hold.
// A texture costs nothing at runtime and gives the near ceiling panel joints,
// a service run and the odd access hatch.
function makeHallCeilTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#97a9b3'; g.fillRect(0, 0, 256, 256);
  // coffer grid: a 2 m panel joint, darker in one axis than the other so the
  // ceiling reads as spanning rather than as a checkerboard
  g.strokeStyle = 'rgba(20,38,48,0.30)'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke();
  g.strokeStyle = 'rgba(20,38,48,0.16)'; g.lineWidth = 3;
  for (const y of [64, 128, 192]) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  // a service duct running the length of it, offset from centre
  g.fillStyle = 'rgba(20,38,48,0.13)'; g.fillRect(40, 0, 34, 256);
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(40, 0, 5, 256);
  // access hatches and a couple of bolt rows, so no two glances read alike
  g.fillStyle = 'rgba(20,38,48,0.22)';
  g.fillRect(168, 30, 44, 44);
  g.fillRect(178, 168, 26, 26);
  g.fillStyle = 'rgba(20,38,48,0.35)';
  for (let i = 0; i < 8; i++) { g.fillRect(150, 12 + i * 30, 3, 3); g.fillRect(232, 12 + i * 30, 3, 3); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const HALL_CEIL_MAT = new THREE.MeshBasicMaterial({ map: makeHallCeilTexture() });
// beams must be their own value or they vanish into the ceiling they hang from
const HALL_BEAM_MAT = new THREE.MeshBasicMaterial({ color: 0x7c8d97 });
// unlit and bright: the strips read as the light source, not a lit surface
const HALL_LIGHT_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff });
// Emergency lighting for a BLACKOUT leg. Deliberately amber and not the
// signal red: in a world this pale red means threat, and a corridor lit in
// the threat colour would wreck enemy-reading at exactly the moment the
// darkness already makes it hardest.
const HALL_EMERG_MAT = new THREE.MeshBasicMaterial({ color: VIS.blackLight });

const HALL_FLOOR_MAT = new THREE.MeshLambertMaterial({ map: makeHallFloorTexture() });

// A BLACKOUT needs its own surfaces, not just dimmer lights. The ceiling and
// the drop beams are MeshBasicMaterial — unlit — so turning the hemisphere
// down does almost nothing to them, and the first attempt at this came out
// 6% darker than a lit corridor. These are colour-multiplied copies, and
// because only one leg is ever active they can be animated in place: the
// freeze brightens them, which is the torch.
const DARK = (m) => { const c = m.clone(); c.color = new THREE.Color(0xffffff); return c; };
const HALL_WALL_DARK = DARK(HALL_WALL_MAT);
const HALL_CEIL_DARK = DARK(HALL_CEIL_MAT);
const HALL_FLOOR_DARK = DARK(HALL_FLOOR_MAT);
const HALL_BEAM_DARK = DARK(HALL_BEAM_MAT);
const DARK_MATS = [HALL_WALL_DARK, HALL_CEIL_DARK, HALL_FLOOR_DARK, HALL_BEAM_DARK];
function setDarkness(k) {   // k = 1 is fully lit, VIS.blackSurface is blackout
  for (const m of DARK_MATS) m.color.setScalar(k);
}
// The door was the largest red mass on screen and it competed with the
// enemies for the eye — in a world this pale, red should mean threat and
// nothing else. Black, not white: white would compete with the ceiling
// strips, which are the one thing that should blow out.
const DOOR_RED_MAT = new THREE.MeshBasicMaterial({ color: 0x101418 });
const DOOR_SEAL_MAT = new THREE.MeshLambertMaterial({ color: 0x24262c });
let hall = null;

function setEnvironment(env) {
  const inHall = env === 'hall';
  for (const m of cityMeshes) m.visible = !inHall;
  floor.visible = !inHall;
  scene.fog.near = inHall ? VIS.hallNear : CITY.fogNear;
  scene.fog.far = inHall ? VIS.hallFar : CITY.fogFar;
  fogWant.near = scene.fog.near; fogWant.far = scene.fog.far; fogWant.amb = 1;
  if (!inHall) { hemi.intensity = HEMI_BASE; sun.intensity = SUN_BASE;
    fill.intensity = FILL_BASE; darkNow = 1; setDarkness(1); }
  fogWant.col.setHex(inHall ? VIS.hallFog : CITY_FOG_HEX);
  scene.fog.color.copy(fogWant.col);
  if (!inHall) { gradeWant = null; condNow = null; gradeK = 0; }   // updateFog hides them next frame
  if (!inHall && hall) {
    for (const L of hall.legs) {
      if (!L) continue;
      for (const m of L.meshes) scene.remove(m);
      scene.remove(L.door.slab);
      if (L.seal) scene.remove(L.seal.slab);
    }
    hall = null;
    setLayout();   // restore the city's obstacles
  }
}

// One corridor leg: forward runs with 90° jogs, plus 1-2 side loops that
// rejoin the spine further along — branches, but every route reaches the door

// A STRETCH is one straight run plus the turn that ends it — the unit the
// fight is budgeted in. Walking the spine, a new stretch begins wherever the
// corridor straightens out again after a lateral jog. Derived from the
// finished spine rather than tracked during generation, so every path
// through genHallLeg (jogs, the no-jog fallback, forms) segments the same.
// The approach is always the last stretch, however the leg was built.

function buildHallLeg(sgx, sgz, proto) {
  const { cells, approach, stretches, doorways, pillars, covers, endGx, endGz } =
    genHallLeg(sgx, sgz, proto, hall.grid, TUTOR.hallCells);
  const cond = (proto && proto.condition && proto.condition.id) || null;
  const measures = new Set((proto && proto.measures || []).map((m) => m.id));
  const C = HALL.cell, H = HALL.h, W = HALL.wall;
  const walls = [], floors = [], ceils = [], lights = [], ribs = [], beams = [];
  const obs = [];
  const wallBox = (px, pz, w, d) => {
    walls.push([px, H / 2, pz, w, H, d]);
    obs.push({
      min: new THREE.Vector3(px - w / 2, 0, pz - d / 2),
      max: new THREE.Vector3(px + w / 2, H, pz + d / 2),
    });
  };
  for (const [gx, gz] of cells) {
    const x = gx * C, z = gz * C;
    floors.push([x, -0.06, z, C, 0.12, C]);
    ceils.push([x, H + 0.1, z, C + 0.2, 0.2, C + 0.2]);
    // recessed ceiling strip every other cell: the corridor finally has a
    // rhythm to measure your own movement against
    // DIM STRIPS halves the lighting; otherwise every other cell is lit
    const lit = cond === 'blackout' ? (gx + gz) % VIS.blackLitEvery === 0
      : cond === 'dimStrips' ? (gx + gz) % 4 === 0
      : (gx + gz) % 2 === 0;
    // The panel is the same shape in every corridor. In a blackout it is
    // simply switched off (VIS.blackLight is a dark grey, not an amber), so
    // it reads as a fitting rather than as emergency lighting.
    if (lit) lights.push([x, H - 0.04, z, 1.5, 0.08, 2.6]);
    // Half the portrait frame is ceiling, and it was one flat slab. A drop
    // beam on every cell the strips skip gives it a 4 m rhythm and puts the
    // soffit at 2.80 m — the clear height measured off the reference. Visual
    // only: it never goes through wallBox(), so it adds no collision.
    else beams.push([x, H - LEG.beamDrop / 2, z, C, LEG.beamDrop, LEG.beamW]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (hall.grid.has((gx + dx) + ',' + (gz + dz))) continue;
      if (gx === endGx && gz === endGz && dz === 1) continue;   // the doorway
      if (dx !== 0) wallBox(x + dx * (C / 2 - W / 2), z, W, C);
      else wallBox(x, z + dz * (C / 2 - W / 2), C, W);
      // a pilaster rib now and then: it sits just proud of the wall face
      // (never intersecting it, so nothing can z-fight) and gives blank
      // runs something for the eye to clock as you move past
      if (measures.has('alcoves') && rnd01(gx * 12.7 + gz * 5.3 + dx * 3.1 + dz * 7.9) > 0.55) {
        const inset = C / 2 - W - 0.07;
        if (dx !== 0) ribs.push([x + dx * inset, H / 2 - 0.1, z, 0.13, H - 0.2, 0.62]);
        else ribs.push([x, H / 2 - 0.1, z + dz * inset, 0.62, H - 0.2, 0.13]);
      }
    }
  }
  // door frame: jambs + lintel around a 2m opening at the leg's far edge
  const dx0 = endGx * C, dz0 = endGz * C + C / 2 - W / 2;
  wallBox(dx0 - 1.35, dz0, 0.7, W);   // jambs abut the side walls, no overlap
  wallBox(dx0 + 1.35, dz0, 0.7, W);
  // the lintel is VISUAL only: ground collision is 2D, so a solid lintel
  // would read as an invisible wall filling the open doorway
  walls.push([dx0, 2.8, dz0, 2, 0.6, W]);
  // Interior doorways (the vault's way in and way out). The corridor cell is
  // C wide and the room beyond is wider, so the opening between them is
  // already exactly one cell — these jambs narrow it to a doorway and give it
  // a frame, which is what makes the room read as a place you ENTER rather
  // than a wide bit of hallway. The jamb reaches from the opening's edge out
  // to the corridor's own side wall, so no gap can appear beside it.
  for (const [dgx, dgz, ddz] of (doorways || [])) {
    const ox = dgx * C, oz = dgz * C + ddz * (C / 2);
    const half = LEG.vaultDoorW / 2;
    const jw = C / 2 - W / 2 - half;        // from opening edge to the side wall
    if (jw > 0.05) {
      wallBox(ox - half - jw / 2, oz, jw, W);
      wallBox(ox + half + jw / 2, oz, jw, W);
    }
    // lintel is VISUAL only — ground collision is 2D, so a solid one would
    // read as an invisible wall filling the opening
    walls.push([ox, H - 0.42, oz, LEG.vaultDoorW, 0.55, W]);
  }
  // LOW COVER: see over it, cannot shoot or be shot through it. The height
  // is exact rather than a taste call — the enemy's sight ray and his muzzle
  // both sit at 1.35 m and the player's eye at 1.6 m, so 1.45 m blocks him
  // outright while you shoot down over the top. segAABB is 3D so bullets and
  // line of sight respect the height for free; pointInObstacle is 2D so you
  // still cannot walk over it, which is what makes it cover and not a step.
  for (const [cx, cz, cw, cd, ch] of (covers || [])) {
    walls.push([cx, ch / 2, cz, cw, ch, cd]);
    obs.push({
      min: new THREE.Vector3(cx - cw / 2, 0, cz - cd / 2),
      max: new THREE.Vector3(cx + cw / 2, ch, cz + cd / 2),
    });
  }
  // pillars: solid cover standing in the chamber
  for (const [px, pz] of pillars) {
    const pw = LEG.pillarW, pd = LEG.pillarD;
    walls.push([px, H / 2, pz, pw, H, pd]);
    obs.push({
      min: new THREE.Vector3(px - pw / 2, 0, pz - pd / 2),
      max: new THREE.Vector3(px + pw / 2, H, pz + pd / 2),
    });
  }
  // ONE-WAY SEAL. A bulkhead sitting in the floor halfway down the leg; walk
  // past it and it comes up behind you. It is placed at a straight forward
  // step whose row — and the row before it — hold exactly one cell of the
  // leg, so no branch lane can walk around the thing that just shut.
  let seal = null;
  if (measures.has('oneWaySeal') && stretches.length > 1) {
    const spine = stretches.slice(0, -1).reduce((a, s) => a.concat(s.cells), []);
    const rows = new Map();
    for (const [, cgz] of cells) rows.set(cgz, (rows.get(cgz) || 0) + 1);
    // Halfway to the DOOR, measured in z rather than in spine index: a leg
    // with lateral jogs spends indices without gaining ground, so the index
    // midpoint lands a third of the way along and the seal shuts too early
    // to commit you to anything.
    const midZ = (spine[0][1] + endGz) / 2;
    const cand = [];
    for (let i = 1; i < spine.length; i++) {
      const [gx, gz] = spine[i], [px, pz] = spine[i - 1];
      if (gx !== px || gz !== pz + 1) continue;             // a straight step
      if (rows.get(gz) !== 1 || rows.get(pz) !== 1) continue;   // no bypass
      cand.push(i);
    }
    // The first candidate at or past halfway, so it never shuts before you
    // have committed to anything. Branch lanes veto whole rows, so roughly a
    // quarter of corridors offer none past the mark — those legs simply get
    // no seal. A bulkhead that shuts eight metres in commits you to nothing
    // and is worse than not having one.
    let best = -1;
    for (const i of cand) if (spine[i][1] >= midZ) { best = i; break; }
    if (best > 0) {
      const [gx, gz] = spine[best];
      const sx = gx * C, sz = gz * C - C / 2;
      wallBox(sx - 1.35, sz, 0.7, W);   // jambs, exactly the exit door's
      wallBox(sx + 1.35, sz, 0.7, W);
      walls.push([sx, 2.8, sz, 2, 0.6, W]);   // lintel: visual only, as above
      const sl = new THREE.Mesh(new THREE.BoxGeometry(2, 2.72, 0.18), DOOR_SEAL_MAT);
      sl.position.set(sx, -1.55, sz);         // waiting in the floor
      scene.add(sl);
      seal = { slab: sl, x: sx, z: sz, shut: false,
        ob: { min: new THREE.Vector3(sx - 1, 0, sz - 0.2),
          max: new THREE.Vector3(sx + 1, H, sz + 0.2) } };
    }
  }
  // THE GRINDER wakes behind wherever you enter the leg, spanning its whole
  // width. Built here so it is part of the leg and dies with it.
  const grind = measures.has('grinder')
    ? buildGrinder(cells, sgz - Math.ceil(GRIND.startBehind / C)) : null;

  const black = cond === 'blackout';
  const meshes = [
    mergedCityMesh(walls, black ? HALL_WALL_DARK : HALL_WALL_MAT),
    mergedCityMesh(floors, black ? HALL_FLOOR_DARK : HALL_FLOOR_MAT),
    mergedCityMesh(ceils, black ? HALL_CEIL_DARK : HALL_CEIL_MAT),
    mergedCityMesh(lights, black ? HALL_EMERG_MAT : HALL_LIGHT_MAT),
    mergedCityMesh(ribs, black ? HALL_CEIL_DARK : HALL_CEIL_MAT),   // ribs read a shade darker
    mergedCityMesh(beams, black ? HALL_BEAM_DARK : HALL_BEAM_MAT),
  ];
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2, 2.72, 0.18), DOOR_RED_MAT);
  slab.position.set(dx0, 1.36, dz0);
  scene.add(slab);
  const door = {
    slab, x: dx0, z: endGz * C + C / 2, open: false,
    ob: {
      min: new THREE.Vector3(dx0 - 1, 0, dz0 - 0.2),
      max: new THREE.Vector3(dx0 + 1, H, dz0 + 0.2),
    },
  };
  return { cells, approach, stretches, doorways, pillars, meshes, obs, door, seal, grind,
    endGx, endGz, proto, retired: false, nextBuilt: false };
}

// ---------------------------------------------------------------------------
// THE GRINDER
//
// "A slab that seals the leg behind you and advances -- and does not stop
// while time is frozen, because it is the building, not a person."
//
// Built once per leg that asks for it, spanning the leg's FULL x extent so no
// branch lane can be used to slip round it, and parked behind the player's
// start. It wakes a few seconds in, then walks toward the door on real time.
// ---------------------------------------------------------------------------
const GRIND_HOUSING = new THREE.MeshLambertMaterial({ color: 0x2e323a });
// The blades and the hazard bars are UNLIT on purpose. A blackout leg has no
// working lights, and a lethal object you cannot see is not a hazard, it is a
// bug — these two read at any brightness the corridor happens to be at.
const GRIND_BLADE = new THREE.MeshBasicMaterial({ color: 0xd6dde2 });
const GRIND_HAZARD = new THREE.MeshBasicMaterial({ color: 0xff2d1a });

function buildGrinder(cells, startGz) {
  const C = HALL.cell;
  const W = GRIND.w;
  const g = new THREE.Group();
  const box = (mat, sx, sy, sz, px, py, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(px, py, pz);
    return m;
  };
  // housing: a sill, a header, side posts and a back plate
  g.add(box(GRIND_HOUSING, W, 0.34, 0.6, 0, GRIND.h - 0.17, -0.08));
  g.add(box(GRIND_HOUSING, W, 0.3, 0.6, 0, 0.15, -0.08));
  g.add(box(GRIND_HOUSING, 0.45, GRIND.h, 0.6, -W / 2 + 0.22, GRIND.h / 2, -0.08));
  g.add(box(GRIND_HOUSING, 0.45, GRIND.h, 0.6, W / 2 - 0.22, GRIND.h / 2, -0.08));
  g.add(box(GRIND_HOUSING, W, GRIND.h, 0.14, 0, GRIND.h / 2, -0.5));
  // hazard bars: unmistakable, and unlit so they read in a blackout
  g.add(box(GRIND_HAZARD, W - 0.9, GRIND.hazard, 0.1, 0, GRIND.h - 0.36, 0.26));
  g.add(box(GRIND_HAZARD, W - 0.9, GRIND.hazard, 0.1, 0, 0.36, 0.26));

  // TEETH, as ONE InstancedMesh per drum.
  //
  // Full-width plates merged into a solid band at any radius that fits the
  // corridor. Real shredders are STACKS of toothed discs, and that is what
  // reads: teeth around the drum AND across it, with gaps between the stacks,
  // so the silhouette is jagged from every angle. Instanced because the
  // honest version is 36 little boxes per drum and this is one draw call --
  // the drum's rotation lives on the parent group, so every tooth follows for
  // free.
  const segW = W / GRIND.teeth;
  const toothGeo = new THREE.BoxGeometry(1, 1, 1);
  const drums = [];
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _ax = new THREE.Vector3(1, 0, 0);
  for (let d = 0; d < GRIND.drumY.length; d++) {
    const drum = new THREE.Group();
    drum.position.set(0, GRIND.drumY[d], 0);
    drum.add(box(GRIND_HOUSING, W - 0.5, 0.22, 0.22, 0, 0, 0));   // the shaft
    const im = new THREE.InstancedMesh(toothGeo, GRIND_BLADE, GRIND.teeth * GRIND.blades);
    let i = 0;
    for (let t = 0; t < GRIND.teeth; t++) {
      const x = -W / 2 + (t + 0.5) * segW;
      for (let bl = 0; bl < GRIND.blades; bl++) {
        // half a tooth of stagger between neighbouring stacks, so the rim
        // never lines up into a continuous edge
        const a = (bl / GRIND.blades + (t % 2) * 0.5 / GRIND.blades) * Math.PI * 2;
        const r = GRIND.drumR * 0.62;
        _p.set(x, Math.cos(a) * r, Math.sin(a) * r);
        _q.setFromAxisAngle(_ax, a);
        _s.set(segW * 0.42, GRIND.drumR * 1.15, GRIND.bladeT);
        im.setMatrixAt(i++, _m.compose(_p, _q, _s));
      }
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    drum.add(im);
    g.add(drum);
    drums.push(drum);
  }
  g.position.set(0, 0, startGz * C);
  scene.add(g);
  return { g, drums, z: startGz * C, x: 0, a: 0, wake: GRIND.wake, live: false, done: false };
}

// Real time, always: a freeze does not stop the building.
function updateGrinder(dtReal) {
  if (game.mode !== 'hall' || !hall) return;
  const L = hall.legs[hall.cur];
  const G = L && L.grind;
  if (!G || G.done) return;
  if (!G.live) {
    if (game.state !== 'play') return;
    G.wake -= dtReal;
    if (G.wake > 0) return;
    G.live = true;
    showBanner('GRINDER · KEEP MOVING', 1800);
    sfx.airlock();
    vibrate([30, 50, 30]);
  }
  G.z += GRIND.speed * dtReal;
  // The visible unit slides to wherever you are, because the corridor jogs
  // and the only part of it you can ever see is the part filling the run you
  // are standing in. The lethal part is a plane across the whole leg either
  // way, so nothing about the rule changes when it slides.
  G.x += (player.pos.x - G.x) * (1 - Math.exp(-GRIND.followRate * dtReal));
  G.g.position.set(G.x, 0, G.z);
  G.a += GRIND.spin * dtReal;
  G.drums[0].rotation.x = G.a;
  if (G.drums[1]) G.drums[1].rotation.x = -G.a;
  // it stops at the door: past that it is out of the leg and has nothing left
  // to sweep, and it must never be sitting in the next corridor's mouth
  if (G.z > L.door.z - 1.5) { G.done = true; G.g.visible = false; return; }
  // anything it reaches is gone. Bodies shatter for the look of it but pay
  // nothing — no time, no drop — and go back in the queue ahead of you, so a
  // leg stays finishable and the grinder is never a way to farm the bank.
  const face = G.z + GRIND.killAhead;
  const eaten = [];
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.pos.z > face) continue;
    spawnShatter(e.pos, _v1.set(0, 0.6, 1).normalize());
    removeEnemyShards(e);
    removeBeam(e);
    scene.remove(e.g);
    enemies.splice(i, 1);
    eaten.push(e.type);
  }
  if (eaten.length) {
    game.spawnQueue.unshift(...eaten);
    L.released = Math.max(0, (L.released || 0) - eaten.length);
    game.spawnTimer = Math.min(game.spawnTimer, 1.2);
  }
  if (player.alive && game.state === 'play' && player.pos.z < face) hitPlayer();
}

function rebuildHallObstacles() {
  obstacles.length = 0;
  for (const L of hall.legs) {
    if (!L || L.retired) continue;
    for (const o of L.obs) obstacles.push(o);
    if (!L.door.open) obstacles.push(L.door.ob);
  }
}

// corridor-safe cast: no lasers (the beam ignores walls) and no snipers /
// rocketeers / bombers (they want open air) — their slots become fighters
// Which stretch of the leg the player is standing in. Stretches run in
// walking order, so it is simply the last one whose start is behind you.
function playerStretch(L) {
  if (!L || !L.stretches) return 0;
  let k = 0;
  for (let i = 0; i < L.stretches.length; i++) {
    if (L.stretches[i].z0 <= player.pos.z + 2) k = i;
  }
  return k;
}

// What each stretch of this leg is worth, and therefore what the whole leg
// is worth: a longer corridor is a bigger fight because it has more rooms to
// have it in, not because a number went up. The approach is always exactly
// one final group.
function stretchQuota(L, n) {
  const per = Math.min(LEG.perCellCap,
    (LEG.perCell + n * LEG.perCellPerDoor) * scarcity('legSize', n));
  const body = L.stretches.slice(0, -1);          // everything but the approach
  if (!body.length) return [LEG.finaleWave];
  const cells = body.reduce((a, s) => a + s.cells.length, 0) || 1;
  const budget = Math.max(body.length * LEG.stretchMin, Math.round(cells * per));
  const q = body.map((s) => Math.max(LEG.stretchMin, Math.min(LEG.stretchCap,
    Math.round(budget * s.cells.length / cells))));
  q.push(LEG.finaleWave);
  return q;
}

// How many more bodies the corridor may release right now: the share of the
// stretch you are standing in plus the next one, and nothing else. The window
// REBASES when you walk into a new stretch, which is the load-bearing part —
// a cumulative allowance would let three stretches' worth of backlog drain
// into whichever room you happened to stop in, and the last of it would
// arrive at the door. What you walk past, you walk past: the leftover is
// dropped from the queue (never the head, which carries the leg's debut, and
// never the finale tail waiting at the door), so the count on the HUD stays
// honest and pushing forward genuinely trades kills for ground.
function hallAllowance() {
  if (game.mode !== 'hall' || !hall) return Infinity;
  const L = hall.legs[hall.cur];
  if (!L || !L.quota) return Infinity;
  const k = playerStretch(L);
  if (L.markK === undefined || k > L.markK) {
    // Only what is genuinely BEHIND you is forfeited. The old window reached
    // one stretch past where you were standing, and that stretch may be the
    // one you have just walked into — charging it as skipped would punish you
    // for arriving. So keep the part of the window still ahead of you.
    let ahead = 0;
    if (L.markK !== undefined) {
      for (let i = k; i <= Math.min(L.markK + LEG.lookahead, L.quota.length - 1); i++) ahead += L.quota[i];
    }
    const leftover = L.markK === undefined ? 0
      : Math.max(0, (L.budget - L.released) - ahead);
    if (leftover > 0) {
      const tail = LEG.finaleWave;
      const n = Math.min(leftover, Math.max(0, game.spawnQueue.length - tail));
      if (n > 0) game.spawnQueue.splice(game.spawnQueue.length - tail - n, n);
    }
    let win = 0;
    for (let i = k; i <= Math.min(k + LEG.lookahead, L.quota.length - 1); i++) win += L.quota[i];
    L.markK = k;
    L.budget = (L.released || 0) + win;
  }
  return L.budget - (L.released || 0);
}

function hallWave(n) {
  // The opening doors are a metronome: one body in the whole leg, so the
  // four-beat rhythm — see him, watch the round leave, step out of it,
  // shatter him — can be learned once before it is asked for twice.
  if (game.mode === 'hall' && n <= EARLY.oneBodyDoors) {
    const leg = hall && hall.legs[hall.cur];
    if (leg && leg.stretches) {
      leg.quota = leg.stretches.map((_, i) => (i === leg.stretches.length - 1 ? 1 : 0));
      leg.released = 0; leg.markK = undefined; leg.budget = 0;
    }
    return ['gunner'];
  }
  const sub = { laser: 'rusher', sniper: 'gunner', rocketeer: 'heavy', bomber: 'shotgunner' };
  // Only types this player has actually unlocked may appear — the same two
  // keys the protocols use, so the cast is metered across runs too.
  const roster = n <= EARLY.gunnerOnlyDoors ? new Set(['gunner'])
    : new Set(enemyRoster(n, lifetimeDoors).map((t) => sub[t] || t));
  roster.add('gunner');
  const q = composeWave(n).map((t) => sub[t] || t).filter((t) => roster.has(t));
  // The leg's size comes from the leg itself: every stretch is worth a few
  // bodies and the approach is worth one last group. A wave is therefore
  // always exactly as big as there is corridor to fight it in.
  const leg = hall && hall.legs[hall.cur];
  let want = COMP.baseTotal + n * COMP.perWave;
  if (leg && leg.stretches) {
    leg.quota = stretchQuota(leg, n);
    leg.released = 0;
    leg.markK = undefined;   // the release window re-arms with the wave
    leg.budget = 0;
    want = leg.quota.reduce((a, b) => a + b, 0);
  }
  const filler = roster.has('rusher') ? ['gunner', 'rusher'] : ['gunner'];
  while (q.length < want) q.push(filler[Math.floor(Math.random() * filler.length)]);
  q.length = Math.min(q.length, want);
  // the leg's debut enemy leads the wave, so the introduction actually lands
  const debut = leg && leg.proto && leg.proto.enemyDebut;
  if (debut) {
    const mapped = sub[debut.id] || debut.id;
    const i = q.indexOf(mapped);
    if (i > 0) { q.splice(i, 1); q.unshift(mapped); }
    else if (i < 0) { q.pop(); q.unshift(mapped); }
  }
  return q;
}

function initHall() {
  // Decided BEFORE the first leg is composed, because the onboarding shapes
  // its own two legs (a straight hallway, then a room) and `forced` runs
  // during construction.
  tutorShaping = (!tutorSeen || tutorArmed) && timeMode === 'toggle';
  tutorLegsBuilt = 0;
  game.wave = 1;
  game.state = 'intro';
  game.stateT = 0;
  game.introLen = 1.6;
  game.seenTypes = {};
  setEnvironment('hall');
  hall = { legs: [], grid: new Set(), cur: 0, doorsPassed: 0, checkpoint: { x: 0, z: 0 },
    mem: newRunMemory(archive) };
  hall.legs.push(buildHallLeg(0, 0, forced(composeProtocol(1, lifetimeDoors, hall.mem))));
  recordMetProto(hall.legs[0].proto);   // leg 1 counts too; only 2+ used to
  applyLegVisibility(true);             // leg 1 starts in its own weather
  recordMet(['pistol']);                // it is already in your hand
  rebuildHallObstacles();
  game.spawnQueue = hallWave(1);
  game.spawnTimer = 0.5;
  player.pos.set(0, 0, 0);
  player.vel.set(0, 0, 0);
  player.yaw = Math.PI;   // the corridor runs +z
  player.pitch = 0;
  game.noFireBefore = performance.now() + 2500;
  el.pausebtn.style.display = 'block';
  // The first leg is built, so every material the tunnel uses is now in the
  // scene. Compile it all here, under the intro card, where a stall is
  // invisible — requestIdleCallback was worse than useless because it can
  // just as easily fire mid-fight.
  warmUp();
  el.ammo.style.display = '';
  setTimeLocked(false);
  slowBank = SLOWMO.base;
  updateSlowMeter();
  updateModeUI();
  // A first run teaches itself. So does one the player has re-armed from
  // Settings — which then disarms, because it is a one-shot, not a mode.
  if (tutorShaping) {
    tutorPrevX = player.pos.x; tutorPrevZ = player.pos.z; tutorPrevYaw = player.yaw;
    startTutorial();
  } else {
    showBanner('REACH THE RED DOOR', 2600);
    setTimeout(showTimeTip, 2600);
  }
  if (!tutorShaping) sfx.newWave();   // the onboarding opens in silence
}

function retryHall() {
  // back to the last checkpoint: the current leg resets, door shut
  const L = hall.legs[hall.cur];
  if (L.door.open) {
    L.door.open = false;
    L.door.slab.material = DOOR_RED_MAT;
    L.door.slab.position.y = 1.36;
  }
  rebuildHallObstacles();
  game.state = 'intro';
  game.stateT = 0;
  game.introLen = 1.2;
  game.spawnQueue = hallWave(game.wave);
  game.spawnTimer = 0.5;
  player.pos.set(hall.checkpoint.x, 0, hall.checkpoint.z);
  player.yaw = Math.PI;
  player.pitch = 0;
  game.noFireBefore = performance.now() + 2000;
  el.pausebtn.style.display = 'block';
  el.ammo.style.display = '';
  setTimeLocked(false);
  slowBank = Math.max(slowBank, SLOWMO.base);
  updateSlowMeter();
  updateModeUI();
  applyLegVisibility(true);   // a retry starts inside the leg's own air
  if (L.grind) {              // ...and with the grinder back where it started
    L.grind.z = hall.checkpoint.z - GRIND.startBehind;
    L.grind.g.position.z = L.grind.z;
    L.grind.g.visible = true;
    L.grind.wake = GRIND.wake;
    L.grind.live = false;
    L.grind.done = false;
  }
  showBanner(`DOOR ${hall.doorsPassed + 1} · AGAIN`, 1500);
}

// Test hook only: `__ts.forceMeasures([...])` pins a leg's measures so a
// rarely-composed element can be reached without playing to door 8. Null in
// every real run, which is why it can sit in the composer's path.
let forcedMeasures = null, forcedCondition;
function forced(proto) {
  if (forcedMeasures) {
    proto.measures = forcedMeasures.map((id) => ELEMENTS.find((e) => e.id === id)).filter(Boolean);
  }
  // Settings > CONDITIONS pins every leg to one condition, so a thing gated
  // to door 13 can be played on door 1. The composer still cannot pick these
  // (impl: false), so a normal run is completely unaffected by their
  // existence — this is the only door into them until they are approved.
  // THE ONBOARDING'S TWO LEGS: a straight hallway, then a room. Nothing else
  // is allowed on them — no condition, no measure — because every one of them
  // changes a rule the player has not been taught yet.
  if (tutorShaping) {
    proto.condition = null;
    proto.measures = [];
    if (tutorLegsBuilt === 0) {
      proto.form = ELEMENTS.find((e) => e.id === 'corridor') || proto.form;
      proto.straight = true;
    } else {
      proto.form = ELEMENTS.find((e) => e.id === 'vault') || proto.form;
    }
    tutorLegsBuilt++;
    return proto;
  }
  const pin = forcedCondition !== undefined ? forcedCondition : testCondition;
  if (pin && TEST_MEASURES.has(pin)) {
    const m = ELEMENTS.find((e) => e.id === pin);
    // pinned ON TOP of whatever the composer chose, not instead of it: a
    // measure is something the building adds, not something it is
    if (m && !proto.measures.some((x) => x.id === pin)) proto.measures = [...proto.measures, m];
  } else if (pin) {
    proto.condition = ELEMENTS.find((e) => e.id === pin) || null;
  } else if (forcedCondition === null) {
    proto.condition = null;
  }
  return proto;
}

// ---------------------------------------------------------------------------
// PER-LEG VISIBILITY — what the FOG condition should always have done.
//
// `fog` shipped as `impl: true` and was never implemented: `cond` was only
// ever compared against 'dimStrips', so a fog leg looked exactly like a plain
// corridor while the archive told the player "Visibility twelve metres". The
// condition was pickable from door 5, filed itself into the archive, and
// delivered nothing.
//
// The safety constraint is LEG.spawnMin. Bodies are born 9-40 m out and the
// door opens only on an empty floor, so a far plane below the spawn floor
// would hide every arrival and could leave a leg unfinishable. The floor is
// derived from spawnMin rather than hand-picked, so it stays correct if the
// spawn distance is ever retuned.
//
// Eased rather than snapped: crossing a door into fog should read as walking
// into it. The ease runs on REAL time — a leg change is not part of the
// world's clock, and freezing time must not freeze the reveal.
const fogWant = { near: VIS.hallNear, far: VIS.hallFar, amb: 1, surf: 1,
  col: new THREE.Color(VIS.hallFog) };
const HEMI_BASE = hemi.intensity, SUN_BASE = sun.intensity, FILL_BASE = fill.intensity;
let darkNow = 1;
// Which screen-space reveal the current leg wants ('nv' | 'tunnel' | null),
// which condition it is under, and how far up the grade has eased.
let gradeWant = null, condNow = null, gradeK = 0;

// The floor every condition is held above: below `spawnMin + margin` a body
// is born outside sight, and the door waits on an empty floor.
const visFloor = () => LEG.spawnMin + VIS.farMargin;

// The condition the leg you are standing in is under, or null. Read by the
// visibility rig, the contacts and the drop tax alike, so there is one answer.
function legCondition() {
  if (game.mode !== 'hall' || !hall) return null;
  const L = hall.legs[hall.cur];
  return (L && L.proto && L.proto.condition && L.proto.condition.id) || null;
}

// The floor is only enforced on the REVEALED state: unfrozen you are meant to
// be blind, and it is the freeze that has to guarantee a leg is finishable.
function legVisibility(L, frozen) {
  const cond = L && L.proto && L.proto.condition && L.proto.condition.id;
  if (cond === 'fog') {
    return {
      near: VIS.fogNear,
      far: frozen ? Math.max(VIS.fogFrozenFar, visFloor()) : VIS.fogFar,
      amb: VIS.fogAmbient, surf: 1, col: VIS.fogCol,
      grade: frozen ? 'tunnel' : null,
    };
  }
  if (cond === 'blackout') {
    // Stopping time is the torch. This is the whole point of the condition:
    // the freeze stops being purely defensive and becomes how you SEE.
    return {
      near: VIS.blackNear,
      far: frozen ? Math.max(VIS.blackFrozenFar, visFloor()) : VIS.blackFar,
      amb: frozen ? VIS.blackFrozenAmbient : VIS.blackAmbient,
      surf: frozen ? VIS.blackFrozenSurface : VIS.blackSurface,
      col: VIS.blackFog, grade: frozen ? 'nv' : null,
    };
  }
  return { near: VIS.hallNear, far: VIS.hallFar, amb: 1, surf: 1, col: VIS.hallFog, grade: null };
}

// --- CONTACTS -------------------------------------------------------------
// What is left of an enemy the murk has taken. One fog-exempt pinprick at head
// height, so a leg stays finishable at any visibility without handing the
// player a wallhack: it is depth-tested, so a wall still hides it, and it
// carries a bearing and nothing else — not the type, not the range, not where
// the head is. It fades in only as a body leaves sight, so it never competes
// with an enemy you can already read.
let contactTex = null;
const contacts = [];
function makeContactTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function takeContact(i) {
  while (contacts.length <= i) {
    if (!contactTex) contactTex = makeContactTex();
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: contactTex, transparent: true, depthWrite: false,
      fog: false,          // the whole point: the murk does not eat it
      blending: THREE.AdditiveBlending,
    }));
    s.scale.setScalar(VIS.contactSize);
    s.visible = false;
    scene.add(s);
    contacts.push(s);
  }
  return contacts[i];
}
function updateContacts() {
  let n = 0;
  const on = condNow === 'fog' || condNow === 'blackout';
  if (on && player.alive && (game.state === 'play' || game.state === 'intro')) {
    const far = scene.fog.far;
    const black = condNow === 'blackout';
    const hex = black ? VIS.contactBlackCol : VIS.contactFogCol;
    const amt = black ? VIS.contactBlackAmt : VIS.contactFogAmt;
    const inAt = black ? VIS.contactInBlack : VIS.contactInFog;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      // 0 while he is inside sight, 1 once the air has taken him
      const t01 = (d - far * inAt) / (far * (VIS.contactOut - inAt));
      const a = Math.min(1, Math.max(0, t01));
      if (a <= 0.02) continue;
      const s = takeContact(n++);
      s.position.set(e.pos.x, VIS.contactY, e.pos.z);
      s.material.color.setHex(hex);
      s.material.opacity = a * a * amt;   // squared: it arrives late and softly
      s.visible = true;
    }
  }
  for (let i = n; i < contacts.length; i++) contacts[i].visible = false;
}

function applyLegVisibility(snap) {
  if (game.mode !== 'hall' || !hall) return;
  const v = legVisibility(hall.legs[hall.cur], timeLocked || timeScale < 0.55);
  fogWant.near = v.near; fogWant.far = v.far; fogWant.amb = v.amb; fogWant.surf = v.surf;
  fogWant.col.setHex(v.col);
  gradeWant = v.grade;
  condNow = legCondition();
  if (snap) {
    scene.fog.near = v.near; scene.fog.far = v.far;
    hemi.intensity = HEMI_BASE * v.amb;
    sun.intensity = SUN_BASE * v.amb; fill.intensity = FILL_BASE * v.amb;
    darkNow = v.surf; setDarkness(darkNow);
    scene.fog.color.copy(fogWant.col);
    renderer.setClearColor(fogWant.col, 1);
  }
}

function updateFog(dtReal) {
  if (!scene.fog) return;
  // Re-read every frame: a blackout leg's target depends on whether time is
  // stopped, so the torch has to follow the freeze rather than the door.
  if (game.mode === 'hall' && hall) applyLegVisibility(false);
  const k = 1 - Math.exp(-dtReal / VIS.tau);
  for (const key of ['near', 'far']) {
    const d = fogWant[key] - scene.fog[key];
    if (Math.abs(d) < 0.05) scene.fog[key] = fogWant[key];
    else scene.fog[key] += d * k;
  }
  const want = HEMI_BASE * fogWant.amb;
  const da = want - hemi.intensity;
  hemi.intensity = Math.abs(da) < 0.002 ? want : hemi.intensity + da * k;
  sun.intensity = SUN_BASE * fogWant.amb;
  fill.intensity = FILL_BASE * fogWant.amb;
  const ds = fogWant.surf - darkNow;
  darkNow = Math.abs(ds) < 0.002 ? fogWant.surf : darkNow + ds * k;
  setDarkness(darkNow);
  scene.fog.color.lerp(fogWant.col, k);
  renderer.setClearColor(scene.fog.color, 1);
  // The grade comes up faster than the air does: the equipment switching on
  // should read as instant next to the corridor slowly opening out.
  const gk = 1 - Math.exp(-dtReal / VIS.gradeTau);
  gradeK += ((gradeWant ? 1 : 0) - gradeK) * gk;
  if (gradeK < 0.004) gradeK = 0;
  document.body.classList.toggle('grading', !!gradeWant && gradeK > 0.4);
  updateContacts();
}

function openHallDoor() {
  const L = hall.legs[hall.cur];
  L.door.open = true;
  if (!L.nextBuilt) {   // the corridor beyond appears as the door opens
    L.nextBuilt = true;
    const proto = forced(composeProtocol(hall.doorsPassed + 2, lifetimeDoors, hall.mem));
    hall.legs.push(buildHallLeg(L.endGx, L.endGz + 1, proto));
  }
  rebuildHallObstacles();
  showBanner('THE DOOR IS OPEN', 1800);
  sfx.airlock();   // the door speaks for itself; the VO waits for the crossing
  vibrate(20);
}

function crossHallDoor() {
  const prev = hall.legs[hall.cur];
  prev.door.open = false;   // sealed behind you — no going back
  prev.door.slab.material = DOOR_SEAL_MAT;
  prev.door.slab.position.y = 1.36;
  hall.cur++;
  hall.doorsPassed++;
  game.wave++;
  lifetimeDoors++;
  saveProgress();
  recordMetProto(hall.legs[hall.cur] && hall.legs[hall.cur].proto);
  applyLegVisibility(false);   // eased, so you walk INTO the next leg's air
  hall.checkpoint = { x: prev.door.x, z: prev.door.z + 2 };
  const old = hall.legs[hall.cur - 2];
  if (old && !old.retired) {   // two doors back is gone for good
    old.retired = true;
    for (const m of old.meshes) scene.remove(m);
    scene.remove(old.door.slab);
    if (old.seal) scene.remove(old.seal.slab);
    if (old.grind) scene.remove(old.grind.g);
  }
  rebuildHallObstacles();
  game.spawnQueue = hallWave(game.wave);
  game.spawnTimer = 0.9;
  slowBank = Math.max(slowBank, SLOWMO.base);
  updateSlowMeter();
  showBanner(legHeadline(hall.legs[hall.cur] && hall.legs[hall.cur].proto), 2000);
  showTimeTip();
  sfx.wave();
  vibrate([15, 30, 15]);
}

// Corridor AI steers straight at the player, so a wall corner or a branch
// lane can wedge someone permanently — and the door waits on the last kill.
// Any enemy that stops closing the distance, unseen, gets re-routed to the
// approach ahead of the player. A wave can therefore always be finished.
function unstickHallEnemies(dt) {
  const L = hall.legs[hall.cur], C = HALL.cell;
  for (const e of enemies) {
    if (e.state === 'assemble') continue;
    // A body the ONBOARDING placed is meant to stand there. This rescues
    // enemies that stop closing the distance — which is every one of them
    // during the tutorial — and it teleports them "to the approach ahead of
    // the player", which is how the enemy you were supposed to dodge left
    // the hallway and was never seen again.
    if (e.hold) continue;
    const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
    const seen = hasLineOfSight(_v2.set(e.pos.x, 1.35, e.pos.z),
      _v3.set(player.pos.x, EYE_HEIGHT - 0.3, player.pos.z));
    if (seen || d < (e.bestD || 1e9) - 0.6) {
      e.bestD = Math.min(d, e.bestD || 1e9);
      e.stuckT = 0;
      continue;
    }
    e.stuckT = (e.stuckT || 0) + dt;
    // the last few of a wave get rescued sooner: they gate the door
    const limit = game.spawnQueue.length === 0 ? 4 : 8;
    if (e.stuckT < limit) continue;
    // Re-place them in the player's own stretch, not at the door: dropping a
    // mid-leg straggler onto the approach is exactly the pile-up the stretch
    // budget exists to prevent. Only the last group falls back to the door.
    const k = playerStretch(L);
    const body = L.stretches ? L.stretches.length - 2 : -1;
    const pool = (game.spawnQueue.length === 0 && enemies.length <= HALL_FINALE)
        || !L.stretches || k > body
      ? (L.approach && L.approach.length ? L.approach : L.cells)
      : L.stretches[Math.min(k + LEG.lookahead, body)].cells;
    let best = null, bestScore = -1e9;
    for (const [cgx, cgz] of pool) {
      const px = cgx * C, pz = cgz * C;
      if (pz < player.pos.z + 5) continue;
      const score = -Math.abs(Math.hypot(px - player.pos.x, pz - player.pos.z) - 14);
      if (score > bestScore) { bestScore = score; best = [px, pz]; }
    }
    if (!best) continue;
    e.pos.x = best[0] + (Math.random() - 0.5) * 1.2;
    e.pos.z = best[1] + (Math.random() - 0.5) * 1.2;
    e.stuckT = 0;
    e.bestD = 1e9;
    e.state = 'advance';
    e.stateT = 0;
  }
}

// Breadth-first distance field over the current leg's cells. Enemies read
// the gradient, so they turn corners and take forks like people instead of
// grinding into a wall on the straight line to the player.
function hallFlow(fromKey) {
  const L = hall.legs[hall.cur];
  const open = new Set(L.cells.map(([gx, gz]) => gx + ',' + gz));
  const dist = new Map([[fromKey, 0]]);
  const q = [fromKey];
  for (let i = 0; i < q.length; i++) {
    const [gx, gz] = q[i].split(',').map(Number);
    const d = dist.get(q[i]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (gx + dx) + ',' + (gz + dz);
      if (!open.has(k) || dist.has(k)) continue;
      dist.set(k, d + 1);
      q.push(k);
    }
  }
  return dist;
}
const cellKeyOf = (x, z) => Math.round(x / HALL.cell) + ',' + Math.round(z / HALL.cell);
const _vFlow = new THREE.Vector3();   // its own scratch: _v2 is reused downstream

function updateHallFlow() {
  const L = hall.legs[hall.cur], C = HALL.cell;
  hall.toPlayer = hallFlow(cellKeyOf(player.pos.x, player.pos.z));
  // The rally: where anyone caught behind the player is sent so they loop
  // around and re-engage from the front. Once the wave is down to its last
  // few it becomes the door approach itself, so stragglers converge on the
  // exit instead of being hunted down in some branch lane behind you.
  let rally = null, bestD = 1e9;
  if (game.spawnQueue.length === 0 && enemies.length <= HALL_FINALE &&
      L.approach && L.approach.length) {
    const [ax, az] = L.approach[Math.min(1, L.approach.length - 1)];
    if (az * C > player.pos.z + 3) rally = [ax, az];
    // survivors of earlier spawns inherit the hold too: whoever happens to
    // be last is the one you finish in front of the door, not just whoever
    // was queued last
    const line = L.approach[0][1] * C - C;
    for (const e of enemies) if (e.holdZ === undefined) e.holdZ = line;
  }
  if (!rally) {
    for (const [gx, gz] of L.cells) {
      if (gz * C < player.pos.z + 6) continue;
      const d = Math.abs(gz * C - (player.pos.z + 13)) + Math.abs(gx * C - player.pos.x) * 0.4;
      if (d < bestD) { bestD = d; rally = [gx, gz]; }
    }
  }
  hall.rallyKey = rally ? rally[0] + ',' + rally[1] : null;
  hall.toRally = rally ? hallFlow(hall.rallyKey) : null;
}

// Direction an enemy should walk this frame, following the corridor.
// Returns null when there is no useful field (fall back to straight-line).
function hallSteer(e) {
  if (!hall || !hall.toPlayer) return null;
  const C = HALL.cell;
  // Only someone GENUINELY behind you loops around to re-engage from the
  // front. The previous rule counted anyone within 1.5 m of your own z as
  // behind, which in a 16 m-wide room is half the fight — so enemies level
  // with you turned and ran up the corridor. That is the bug that looked
  // like rushers fleeing.
  //
  // Hysteresis, or an enemy sitting on the boundary flips every frame and
  // jitters on the spot. And rushers never rally at all: a close-quarters
  // attacker turning tail reads as broken however far away he is.
  const behindBy = player.pos.z - e.pos.z;        // positive = behind you
  if (e.type === 'rusher') e.rally = false;
  else e.rally = e.rally ? behindBy > 1 : behindBy > 4;
  const field = e.rally && hall.toRally ? hall.toRally : hall.toPlayer;
  const here = cellKeyOf(e.pos.x, e.pos.z);
  const d0 = field.get(here);
  if (d0 === undefined) return null;
  if (d0 === 0) return null;   // same cell as the goal: close the last metre directly
  const [gx, gz] = here.split(',').map(Number);
  let best = null, bestD = d0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const k = (gx + dx) + ',' + (gz + dz);
    const d = field.get(k);
    if (d !== undefined && d < bestD) { bestD = d; best = [gx + dx, gz + dz]; }
  }
  if (!best) return null;
  return _vFlow.set(best[0] * C - e.pos.x, 0, best[1] * C - e.pos.z).normalize();
}

function updateHall(dt) {
  if (!hall) return;
  hall.flowT = (hall.flowT || 0) - dt;
  if (hall.flowT <= 0) { updateHallFlow(); hall.flowT = 0.3; }
  unstickHallEnemies(dt);
  // Re-pin after the AI has had its turn. Pinning inside updateTutorial runs
  // BEFORE the enemy update, so the walk cycle simply undid it every frame
  // and the scripted body drifted off down the corridor.
  if (tutorStep !== null) {
    for (const e of enemies) {
      if (!e.hold) continue;
      e.pos.set(e.hold.x, 0, e.hold.z);
      e.g.position.set(e.hold.x, 0, e.hold.z);
      const dx = player.pos.x - e.hold.x, dz = player.pos.z - e.hold.z;
      e.g.rotation.y = Math.atan2(dx, dz) + Math.PI;   // always facing you
    }
  }
  const L = hall.legs[hall.cur];
  if (game.state === 'play' && !L.door.open &&
      game.spawnQueue.length === 0 && enemies.length === 0 &&
      performance.now() >= killFlashUntil) {
    openHallDoor();
  }
  if (L.door.open && L.door.slab.position.y > -1.55) {
    L.door.slab.position.y -= dt * 3.5;   // slides into the floor
  }
  if (L.seal) {
    if (!L.seal.shut && game.state === 'play' && player.pos.z > L.seal.z + 0.7) closeSeal(L);
    if (L.seal.shut && L.seal.slab.position.y < 1.36) {
      L.seal.slab.position.y = Math.min(1.36, L.seal.slab.position.y + dt * 4.2);
    }
  }
  if (L.door.open && player.pos.z > L.door.z + 0.5) crossHallDoor();
}

// The bulkhead comes up behind you. Anything still on the far side is
// neither trapped nor free: it is REDEPLOYED — pulled out of the world and
// pushed back to the front of the spawn queue, with its release refunded so
// the stretch budget will let it out again. Trapping would soft-lock the
// door, which waits on an empty floor; shattering them would hand you kills
// and time bank for walking forward. Neither is what a closed door means.
function closeSeal(L) {
  const S = L.seal;
  S.shut = true;
  L.obs.push(S.ob);
  rebuildHallObstacles();
  const back = [];
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.pos.z > S.z) continue;
    removeEnemyShards(e);
    removeBeam(e);
    scene.remove(e.g);
    enemies.splice(i, 1);
    back.push(e.type);
  }
  if (back.length) {
    game.spawnQueue.unshift(...back);
    L.released = Math.max(0, (L.released || 0) - back.length);
    game.spawnTimer = Math.min(game.spawnTimer, 1.2);
  }
  sfx.airlock();
  vibrate([20, 40, 20]);
  showBanner('NO WAY BACK', 1700);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastT = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;

  if (game.state === 'paused') {   // hard freeze: just keep the frame up
    clearPendingLook();
    renderFrame(dt);
    return;
  }
  drainLook();   // per frame, so freezing the world never slows down looking
  updateFog(dt);
  updateMuzzleFlashes(dt);
  updateGrinder(dt);   // real time: the building does not care that you froze

  // --- time scale: frozen while a finger is down — but time moves (a little)
  // when YOU move, so dodging costs the world a few frames
  const playing = game.state === 'play' || game.state === 'intro';
  // button mode: the bank drains in real time while locked; empty = snap back
  if (timeMode === 'toggle' && playing) {
    if (timeLocked && tutorFreeIsFree()) {
      // The onboarding's first freeze costs nothing: see tutorFreeIsFree.
    } else if (timeLocked) {
      // the tank drains slower early on — nearly double the frozen seconds
      // on the opening waves, full price once the run heats up. Rush hour is
      // built AROUND frozen time (it's how you see the sleepers), so its
      // tank is cheap for the whole run.
      slowBank -= dt * SLOWMO.drain * (game.mode === 'rush' ? RAMP.rushDrain
        : (RAMP.drainFloor + RAMP.drainRange * diffT())
          * scarcity('timeDrain', game.mode === 'hall' ? game.wave : 1));
      if (slowBank <= 0) {
        slowBank = 0;
        setTimeLocked(false);   // time rushes back — resume SFX fires as usual
        vibrate([30, 40, 30]);  // double thump: the tank just ran dry
      }
    }
    updateSlowMeter();
  }
  let target = TIME_FULL;
  // classic: any touch slows time. button mode: only the time button does.
  const slowActive = timeMode === 'toggle' ? timeLocked : input.holding;
  if (playing && slowActive) {
    const speedNorm = Math.min(player.vel.length() / MOVE_SPEED, 1);
    target = TIME_SLOW + (TIME_MOVE_MAX - TIME_SLOW) * speedNorm;
  }
  if (game.state === 'dead') target = 0.12;
  if (game.state === 'menu') target = 0.5;   // dreamy half-speed attract mode
  timeScale += (target - timeScale) * Math.min(dt * TIME_EASE, 1);
  const sdt = dt * timeScale;   // scaled dt: the world's clock
  worldT += sdt;                // ...and its running total, for world-time gaps

  // --- player (real time)
  player.fireCd -= dt;
  player.iframes -= dt;
  // Seconds of CONTINUOUS HOLDING without a manual correction — not wall
  // clock. This gates the soft aim assist, and it used to keep counting while
  // the thumb was off the glass. So any pause longer than AIM_ASSIST_DELAY
  // armed the assist to fire on the very frame you touched down again, and
  // freeze-lift-read-replant is a pause of exactly that shape. The result was
  // the camera easing toward a target on its own the instant you re-planted
  // to aim — and only when there WAS a target, which is why it happened
  // looking at enemies and not at a blank wall.
  if (input.holding) input.lookIdle += dt;
  else input.lookIdle = 0;
  updateReload(dt);
  if (pendingFireUntil > performance.now() && player.fireCd <= 0 &&
      player.alive && game.state === 'play') {
    pendingFireUntil = 0;
    playerFire();   // the banked tap fires the instant the cooldown clears
  }

  // movement: stick deflection (or an active sprint) sets a target velocity,
  // and the body eases toward it — smooth in, smooth out
  let tvx = 0, tvz = 0;
  if (player.alive && (playing || game.state === 'clear')) {   // roam between waves
    if (sprintTo) {
      const dx = sprintTo.g.position.x - player.pos.x;
      const dz = sprintTo.g.position.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) sprintTo = null;
      else { tvx = (dx / d) * SPRINT_SPEED; tvz = (dz / d) * SPRINT_SPEED; }
    } else {
      let sx = input.stickX, sy = input.stickY;
      const sm = Math.min(Math.hypot(sx, sy), 1);
      if (sm > 0.02) {
        sx /= Math.max(sm, 1e-6); sy /= Math.max(sm, 1e-6);
        const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
        const dirX = cosY * sx + -sinY * -sy;   // right*stickX + fwd*(-stickY)
        const dirZ = -sinY * sx + -cosY * -sy;
        // GHOST: inside frozen time in Rush Hour you move at speed — the
        // mode's verb is hunting through a stopped crowd, not just dodging
        const ghost = game.mode === 'rush' && timeScale < 0.55 ? RUSH.ghostSpeed : 1;
        tvx = dirX * sm * MOVE_SPEED * ghost;
        tvz = dirZ * sm * MOVE_SPEED * ghost;
      }
    }
  }
  const mk = 1 - Math.exp(-MOVE_EASE * dt);
  player.vel.x += (tvx - player.vel.x) * mk;
  player.vel.z += (tvz - player.vel.z) * mk;
  if (player.vel.lengthSq() > 1e-4) {
    const preX = player.pos.x, preZ = player.pos.z;
    player.pos.x += player.vel.x * dt;
    player.pos.z += player.vel.z * dt;
    resolvePlayerCollisions();
    recenterWorld();
    // a sprint grinding against a wall gives up instead of pinning you there
    if (sprintTo) {
      const moved = Math.hypot(player.pos.x - preX, player.pos.z - preZ);
      if (moved < SPRINT_SPEED * dt * 0.25) {
        sprintStuckT += dt;
        if (sprintStuckT > 0.35) { sprintTo = null; sprintStuckT = 0; }
      } else {
        sprintStuckT = 0;
      }
    }
  }

  // soft aim assist: normal time AND slow motion, in proportion to how much
  // you are ALREADY turning. Pitch is never corrected while you're aiming
  // anywhere on the body column (chest to top of head), so lining up
  // headshots is never fought.
  const lookPx = input.lookPx, lookYaw = input.lookYaw;
  input.lookPx = 0; input.lookYaw = 0;
  const driveWant = Math.min(1, lookPx / AIM_ASSIST_RAMP) *
    Math.min(1, AIM_ASSIST_TAPER / Math.max(lookPx, AIM_ASSIST_TAPER));
  // Eased, and asymmetrically: ~125 ms to come on so acquiring a target is
  // not a step in the middle of a sweep, ~40 ms to let go so stopping your
  // thumb still stops the camera.
  assistGain += (driveWant - assistGain) *
    (1 - Math.exp(-(driveWant > assistGain ? 8 : 25) * dt));
  const drive = assistGain;
  if (player.alive && playing && enemies.length && drive > 0.02) {
    let best = null, bestAng = AIM_ASSIST_CONE, bestYawD = 0, bestDist = 1;
    for (const e of enemies) {
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const dist = Math.max(Math.hypot(dx, dz), 0.001);
      let dYaw = Math.atan2(-dx, -dz) - player.yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const wantPitch = Math.atan2(1.15 - EYE_HEIGHT, dist);
      const ang = Math.hypot(dYaw, wantPitch - player.pitch);
      if (ang < bestAng) { bestAng = ang; best = e; bestYawD = dYaw; bestDist = dist; }
    }
    if (best) {
      const k = (1 - Math.exp(-AIM_ASSIST_RATE * dt)) * drive;
      // Only ever in the direction you are ALREADY turning. Magnetism that
      // also pulls back when you sweep away is "stickiness", and it made a
      // steady 4 px drag arrive in steps that varied better than two to one
      // — the drag was being fought. It may speed you onto a target; it may
      // never slow you off one. And never by more than half of what you did.
      if (lookYaw * bestYawD > 0) {
        const add = bestYawD * k;
        const cap = Math.abs(lookYaw) * AIM_ASSIST_SHARE;
        player.yaw += Math.sign(add) * Math.min(Math.abs(add), cap);
      }
      const pitchChest = Math.atan2(1.15 - EYE_HEIGHT, bestDist);
      const pitchHeadTop = Math.atan2(1.62 * best.g.scale.y + 0.2 - EYE_HEIGHT, bestDist);
      const lo = Math.min(pitchChest, pitchHeadTop), hi = Math.max(pitchChest, pitchHeadTop);
      const pcap = Math.abs(lookPx / window.innerWidth * LOOK_SENS_Y) * AIM_ASSIST_SHARE;
      const nudge = (want) => {
        const d = (want - player.pitch) * k;
        player.pitch += Math.sign(d) * Math.min(Math.abs(d), pcap);
      };
      if (player.pitch < lo) nudge(lo);
      else if (player.pitch > hi) nudge(hi);
    }
  }
  updateEdgeArrows(playing);
  if (tutorStep !== null) {
    updateTutorial(dt,
      Math.hypot(player.pos.x - tutorPrevX, player.pos.z - tutorPrevZ),
      player.yaw - tutorPrevYaw);
  }
  tutorPrevX = player.pos.x; tutorPrevZ = player.pos.z; tutorPrevYaw = player.yaw;

  // subtle lean into strafes — sells the dodge
  const velRight = player.vel.x * Math.cos(player.yaw) + player.vel.z * -Math.sin(player.yaw);
  player.roll += (-velRight / MOVE_SPEED * 0.05 - player.roll) * Math.min(dt * 8, 1);

  if (game.state === 'menu') {
    // attract mode: slow orbit around the arena, gun hidden
    gun.visible = false;
    const a = demoT * 0.07;
    camera.position.set(Math.sin(a) * 12, 4.2 + Math.sin(demoT * 0.11), Math.cos(a) * 12);
    camera.lookAt(0, 1.2, 0);
  } else {
    gun.visible = !tutorBefore('shoot');
    camera.position.set(player.pos.x, EYE_HEIGHT, player.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    camera.rotation.z = player.roll;
  }

  // bullet-time zoom: FOV tightens as time slows
  const wantFov = FOV_SLOW + (FOV_NORMAL - FOV_SLOW) * Math.min(timeScale, 1);
  if (Math.abs(camera.fov - wantFov) > 0.05) {
    camera.fov = wantFov;
    camera.updateProjectionMatrix();
  }

  // The viewmodel is parented to the camera, so the bullet-time zoom
  // magnifies it: uncompensated, the pistol goes from 22% of the frame
  // width to 29% and its grip drops off the bottom of the screen through
  // the ammo readout. Scaling it (and its x/y offset, but never z) by the
  // tangent ratio holds the framing identical at every FOV.
  const vmK = Math.tan(camera.fov * Math.PI / 360) / Math.tan(FOV_NORMAL * Math.PI / 360);
  gun.scale.setScalar(VM.s * vmK);

  // gun kick + sway
  gunKick = Math.max(0, gunKick - dt * 8);
  jabT = Math.max(0, jabT - dt * 4.4);   // ~0.23s stroke
  muzzle.material.opacity = Math.max(0, muzzle.material.opacity - dt * 14);
  const sway = Math.sin(now * 0.0011) * 0.004;
  // reload: the weapon folds forward and down out of frame, then swings
  // back up as the fresh magazine seats — every weapon uses the same rig
  const spec = WEAPONS[player.weapon];
  const rp = player.reloadT > 0 ? 1 - player.reloadT / spec.reload : 1;
  // The onboarding draws the weapon with the SAME rig — it swings up from
  // below the frame exactly as a fresh magazine seating does, so the first
  // time you see your gun and every reload after it read as one motion.
  const fold = player.reloadT > 0
    ? Math.sin(Math.min(rp, 1) * Math.PI) ** 0.6   // out and back within the reload
    : (gunRiseT > 0 ? Math.min(1, gunRiseT / TUTOR.gunRise) ** 0.6 : 0);
  const bob = Math.cos(now * 0.0017) * 0.004;
  if (spec.melee) {
    // The knife has no recoil and nothing to rack, so it gets its own path:
    // a fast punch straight down the sightline and a slower recovery, with
    // the blade levelling out as it goes in. Nothing about it reads as a gun.
    const p = 1 - jabT;
    const out = jabT > 0 ? (p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7) : 0;
    const push = out * out * (3 - 2 * out);            // smoothstep out and back
    gun.position.set(
      (VM.x + sway - push * 0.055) * vmK,
      (VM.y + bob + push * 0.055) * vmK,
      VM.z - push * 0.34
    );
    gun.rotation.x = -push * 0.36;    // tip drops level with the throat
    gun.rotation.z = -push * 0.2;     // the wrist rolls over with the thrust
  } else {
    gun.position.set(
      (VM.x + sway + fold * 0.06) * vmK,
      (VM.y + bob + gunKick * 0.03 - fold * 0.42) * vmK,
      VM.z + gunKick * 0.06 + fold * 0.12
    );
    gun.rotation.x = gunKick * 0.22 - fold * 1.15;
    gun.rotation.z = 0;
  }
  if (gunRiseT > 0) gunRiseT = Math.max(0, gunRiseT - dt);

  // --- world (scaled time)
  if (playing) {
    runPlayT += dt;   // survival clock for the TIME leaderboard
    // spawning
    if (game.state === 'intro') {
      game.stateT += dt;
      if (game.stateT > game.introLen) {
        game.state = 'play';
        game.introLen = 1.2;   // only the guided first wave has a long intro
      }
    }
    // The corridor releases by POSITION as well as by clock: a stretch's
    // share of the wave unlocks when you walk into it. Push forward and the
    // fights come sooner; hang back and the rest of the leg waits for you.
    // The corridor stays empty until the tutorial has taught the freeze: a
    // player who does not yet know what the button does cannot be asked to
    // use it, and a body arriving mid-lesson is the loudest thing on screen.
    if (tutorHoldsSpawns()) game.spawnQueue.length = 0;
    const room = hallAllowance();
    if (game.state === 'play' && game.spawnQueue.length > 0 &&
        enemies.length < maxAlive() && room > 0) {
      game.spawnTimer -= sdt;
      // hold entrances while a card is on screen: one thing to read at a time
      if (game.spawnTimer <= 0 && performance.now() >= messageBusyUntil) {
        // one at a time: a figure stepping out of an alley or around the far
        // corner, usually somewhere ahead of where you're walking/looking.
        // The emptier the street, the sooner the next one appears — a steady
        // flow, not volleys — and a nearly-spent wave trickles its last few.
        game.waveBearing = player.yaw + Math.PI + (Math.random() - 0.5) *
          (Math.random() < 0.2 ? Math.PI * 2 : 2.4);
        const next = game.spawnQueue.shift();
        spawnEnemy(next);
        if (next === 'rusher') {
          // rushers hunt in packs of 3-4: pull the rest of the pack from
          // anywhere in the wave and send them out the same alley together
          let extra = Math.min(2 + (Math.random() < 0.5 ? 1 : 0),
            maxAlive() - enemies.length, room - 1);
          for (let i = 0; i < game.spawnQueue.length && extra > 0;) {
            if (game.spawnQueue[i] === 'rusher') {
              game.spawnQueue.splice(i, 1);
              spawnEnemy('rusher');
              extra--;
            } else i++;
          }
        } else if (game.mode === 'hall') {
          // corridors fight in clusters: 1-3 round the corner together — but
          // NOT under a condition. A clump in the dark is a single problem
          // you solve with one burst or one knife sweep; the same bodies met
          // one at a time are separate searches, which is the harder and more
          // interesting version of a corridor you cannot see down.
          const clumps = !legCondition();
          let extra = clumps ? Math.min(
            (Math.random() < 0.65 ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0),
            game.spawnQueue.length, maxAlive() - enemies.length, room - 1) : 0;
          while (extra-- > 0) spawnEnemy(game.spawnQueue.shift());
        }
        // the fuller the street (a fresh pack fills it fast), the longer
        // until the next arrival
        const fill = enemies.length / maxAlive();
        if (game.mode === 'hall') {
          // A cleared corridor stays quiet only briefly — long enough to
          // breathe and push forward, never long enough to feel empty.
          game.spawnTimer = (enemies.length === 0 ? PACING.hallEmptyGap
            : PACING.hallFullGap + PACING.hallFillGap * fill) * (0.85 + Math.random() * 0.3);
        } else {
          game.spawnTimer = (PACING.cityBaseGap + PACING.cityFillGap * fill) *
            (0.85 + Math.random() * 0.3) + (game.spawnQueue.length <= 2 ? 1.6 : 0);
        }
      }
    }
    for (const e of enemies) updateEnemy(e, sdt);
    updateBullets(sdt);
    if (game.mode === 'rush') updateCrowd(sdt);
    if (game.mode === 'hall') updateHall(dt);
    updateMarks(sdt);

    if (game.mode === 'wave' && game.state === 'play' && game.spawnQueue.length === 0 && enemies.length === 0 &&
        performance.now() >= killFlashUntil) {   // let the final kill's word land first
      game.state = 'clear';
      game.stateT = 0;
      setTimeLocked(false);   // the break runs at full speed; button resets
      vibrate(20);
      // one readable card for the whole break — the next wave starts quietly
      const next = game.wave + 1;
      showBanner(`WAVE ${game.wave} CLEARED`, 2600);
      sfx.wave();   // the wave VO lands with this card
    }
  } else if (game.state === 'clear') {
    updateBullets(sdt);
    game.stateT += dt;
    if (game.stateT > 3.5) startWave(game.wave + 1, true);
  } else if (game.state === 'dead') {
    for (const e of enemies) updateEnemy(e, sdt);
    updateBullets(sdt);
    if (game.mode === 'rush') updateCrowd(sdt);
    updateMarks(sdt);
  } else if (game.state === 'menu') {
    // the arena fights itself behind the title: enemies stalk and shoot at a
    // ghost target, and every few seconds one of them shatters
    demoT += dt;
    player.iframes = 2;   // the ghost can't die
    player.pos.set(Math.sin(demoT * 0.23) * 6, 0, Math.cos(demoT * 0.31) * 6);
    if (enemies.length < 4) {
      demoSpawnT -= sdt;
      if (demoSpawnT <= 0) {
        game.waveBearing = Math.random() * Math.PI * 2;
        spawnEnemy(['gunner', 'gunner', 'shotgunner', 'heavy', 'bomber', 'shieldbearer'][Math.floor(Math.random() * 6)]);
        demoSpawnT = 0.9;
      }
    }
    demoKillT -= sdt;
    if (demoKillT <= 0 && enemies.length > 1) {
      const a = Math.random() * Math.PI * 2;
      killEnemy(Math.floor(Math.random() * enemies.length), _v1.set(Math.sin(a), 0.3, Math.cos(a)));
      demoKillT = 3 + Math.random() * 2.5;
    }
    for (const e of enemies) updateEnemy(e, sdt);
    updateBullets(sdt);
    if (game.mode === 'rush') updateCrowd(sdt);
    updateMarks(sdt);
  }
  updateShells(sdt);
  updateDebris(sdt);
  updateRipples(sdt);
  updateGrenades(sdt);
  updateMissiles(sdt);
  updatePickups(dt, sdt);

  // --- HUD
  const left = game.spawnQueue.length + enemies.length;
  const SEP = '\u00A0\u00A0\u00B7\u00A0\u00A0';
  el.score.textContent = game.mode === 'rush'
    ? `RUSH${SEP}${markPips} ${markPips === 1 ? 'MARK' : 'MARKS'}`
    : game.mode === 'hall' && hall
      ? (hall.legs[hall.cur].door.open
          ? `DOOR ${hall.doorsPassed + 1}${SEP}OPEN \u2014 GO`
          : `DOOR ${hall.doorsPassed + 1}${SEP}${left} ${left === 1 ? 'ENEMY' : 'ENEMIES'} LEFT`)
      : game.state === 'play' && left > 0
        ? `WAVE ${game.wave}${SEP}${left} ${left === 1 ? 'ENEMY' : 'ENEMIES'} LEFT`
        : `WAVE ${game.wave}${SEP}${game.kills}`;
  el.tint.style.opacity = playing ? (1 - timeScale / TIME_FULL) : 0;
  document.body.classList.toggle('slowmo', playing && timeScale < 0.55);
  document.body.classList.toggle('inmenu', game.state === 'menu');
  if (game.state === 'menu') updateShimmer(now / 1000);
  sfx.update(playing || game.state === 'clear' ? timeScale : 1, dt);
  el.crosshair.classList.toggle('hot', player.fireCd > 0);

  renderFrame(dt);
}
requestAnimationFrame(frame);

// Pause the world clock while backgrounded so nothing "catches up" on return,
// and revive the audio context when the tab comes back.
document.addEventListener('visibilitychange', () => {
  lastT = performance.now();
  if (!document.hidden) sfx.init();
});

// Debug hook for automated tests.
// settings sliders drive the mixer live
el.setmusic.addEventListener('input', () => sfx.setMusicVol(+el.setmusic.value));
el.setsfx.addEventListener('input', () => sfx.setSfxVol(+el.setsfx.value));

// network-first service worker: home-screen installs pick up every deploy
// automatically and keep working offline
// Not inside the app: every asset is already on the device there, so a cache
// layer buys nothing and can only serve something stale after an update.
if (!isNative() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* http or old browser */ });
}

window.__ts = {
  game, player, enemies, bullets, pickups, ripples, camera, input, obstacles, crowd,
  sprint: () => sprintTo,
  audio: () => sfx.debug(), sfx,
  slow: () => ({ bank: +slowBank.toFixed(2), locked: timeLocked, mode: timeMode }),
  setSlow: (v) => { slowBank = v; updateSlowMeter(); },
  look: applyLook,   // inject a look sample exactly as the pointer handler does
  lookStats: () => ({ ...lookStats, pending: +Math.hypot(lookPendX, lookPendY).toFixed(2) }),
  hall: () => hall,
  leg: () => {
    if (!hall) return null;
    const L = hall.legs[hall.cur];
    return { k: playerStretch(L), room: hallAllowance(), released: L.released || 0,
      quota: L.quota || null, form: L.proto && L.proto.form && L.proto.form.id,
      stretches: (L.stretches || []).map((s) => ({ z0: s.z0, z1: s.z1, n: s.cells.length })),
      doorZ: L.door.z };
  },
  fx: () => ({ on: fxOn, slowT: +fxSlowT.toFixed(2),
    active: fxQuads.filter((q) => q.visible).length }),
  setFx: (v) => { fxOn = !!v; fxSlowT = 0; },
  render: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    programs: renderer.info.programs ? renderer.info.programs.length : -1,
    debrisLive: debrisPool ? debrisPool.live : -1 }),
  progress: () => ({ lifetimeDoors, archive: [...archive], runFiled }),
  die: (ended) => hitPlayer(!!ended),
  // shards spawned but not yet released: the per-part cascade in one number
  seal: () => {
    const L = hall && hall.legs[hall.cur];
    return L && L.seal
      ? { x: L.seal.x, z: L.seal.z, shut: L.seal.shut, y: +L.seal.slab.position.y.toFixed(2) }
      : null;
  },
  forceMeasures: (ids) => { forcedMeasures = ids || null; },
  forceCondition: (id) => { forcedCondition = id; },
  fog: () => ({ near: +scene.fog.near.toFixed(2), far: +scene.fog.far.toFixed(2),
    wantNear: fogWant.near, wantFar: fogWant.far,
    cond: (hall && hall.legs[hall.cur] && hall.legs[hall.cur].proto
      && hall.legs[hall.cur].proto.condition || {}).id || null,
    amb: +hemi.intensity.toFixed(3), surf: +darkNow.toFixed(3),
    grade: gradeWant, gradeK: +gradeK.toFixed(3),
    contacts: contacts.filter((c) => c.visible).length }),
  setGrade: (v) => { gradeOff = !v; gradeAllowed = true; gradeSlowT = 0; },
  vis: () => VIS,          // tests poke muzzleLife etc. to hold an effect open
  mode: () => timeMode,
  tutor: () => ({ step: tutorStep, armed: tutorArmed, seen: tutorSeen,
    shaping: tutorShaping, legs: tutorLegsBuilt,
    dodged: tutorDodged, shots: tutorShotsFired, meterOn: tutorMeterOn,
    moved: +tutorMoved.toFixed(2), looked: +tutorLooked.toFixed(2) }),
  gunVisible: () => gun.visible,
  tutorBar: () => (tutorBar ? +tutorBar.m.position.z.toFixed(1) : null),
  tutorBarW: () => (tutorBar ? +tutorBar.m.geometry.parameters.width.toFixed(1) : null),
  setTutorStep: (v) => { tutorStep = v; tutorT = 0; tutorSub = 0; },
  flash: (s = 1) => muzzleFlash(player.pos.x, 1.4, player.pos.z, s),
  muzzle: () => muzzleLights.map((m) => +m.l.intensity.toFixed(2)),
  gradeState: () => ({ allowed: gradeAllowed, slowT: +gradeSlowT.toFixed(2),
    calm: +dtCalm.toFixed(4) }),
  restartHall: () => { setEnvironment('city'); clearField(); initHall(); },
  killAt: (i) => killEnemy(i, _v1.set(0, 0.5, -1).normalize()),
  banner: showBanner,
  diff: () => ({ speed: enemyBulletSpeed(), aim: aimSpeedFactor(), t: diffT() }),
  fire: playerFire, setWeapon, spawnEnemy, spawnPickup,
  shot: (px, py, pz, dx, dy, dz, fromPlayer) =>
    spawnBullet(new THREE.Vector3(px, py, pz), new THREE.Vector3(dx, dy, dz).normalize(), fromPlayer),
};
