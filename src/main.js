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

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const ARENA_HALF = 21;            // arena is a square, walls at ±ARENA_HALF
const EYE_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.32;

const TIME_SLOW = 0.05;           // time scale while finger is down and still
const TIME_MOVE_MAX = 0.3;        // ... creeping up to this while you drag-dodge
const TIME_FULL = 1.0;
const TIME_EASE = 14;             // easing rate between the two

const PLAYER_BULLET_SPEED = 46;
const ENEMY_BULLET_SPEED = 11;    // base; creeps up slightly with each wave
const BULLET_GRAVITY = 4;         // gentle drop, visible on long shots

const WEAPONS = {
  pistol: { cd: 0.22, pellets: 1, spread: 0, ammo: Infinity, kick: 1, speed: 46 },
  shotgun: { cd: 0.55, pellets: 6, spread: 0.055, ammo: 3, kick: 1.8, speed: 46 },
  sniper: { cd: 0.9, pellets: 1, spread: 0, ammo: 3, kick: 2.4, speed: 95, pierce: 3 },
};

// Soft aim assist: the camera never swings on its own — after you stop
// aiming for a while (in slow motion only), it gently settles the crosshair
// onto a nearby target. It never pulls your pitch off the head, so headshots
// stay yours. Off-screen threats get edge arrows.
const AIM_ASSIST_CONE = 0.3;      // radians off-crosshair where assist engages
const AIM_ASSIST_RATE = 3.5;      // gentle easing rate
const AIM_ASSIST_DELAY = 2.5;     // seconds of free aiming before it engages
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
scene.background = new THREE.Color(0xe8eaee);
scene.fog = new THREE.Fog(0xe8eaee, 24, 58);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 120);

const hemi = new THREE.HemisphereLight(0xffffff, 0xc9ccd4, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(8, 18, 6);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.4);
fill.position.set(-6, 10, -8);
scene.add(fill);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Arena: floor with a faint grid, four walls, chunky white cover blocks
// ---------------------------------------------------------------------------
const MAT_WHITE = new THREE.MeshLambertMaterial({ color: 0xf4f5f7 });
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
  street: 12,      // road width (m)
  floor1: 4,       // shopfront storey height (m)
  floorH: 3,       // upper storey height (m)
  win: 0.62,       // upper window fill 0..1
  hMin: 9, hMax: 24,
  density: 0.75,   // odds a distant lot gets a tower
  fogNear: 55, fogFar: 200,
  reach: 3,        // distant rings of 40m city cells
};
scene.fog = new THREE.Fog(0xe8eaee, CITY.fogNear, CITY.fogFar);

function makeStreetTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const S = 1024, road = CITY.street / (ARENA_HALF * 2);
  g.fillStyle = '#eceef1'; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(22,24,29,0.08)'; g.lineWidth = 2;
  for (let i = 0; i <= 16; i++) {
    g.beginPath(); g.moveTo((i / 16) * S, 0); g.lineTo((i / 16) * S, S); g.stroke();
    g.beginPath(); g.moveTo(0, (i / 16) * S); g.lineTo(S, (i / 16) * S); g.stroke();
  }
  g.fillStyle = '#e2e4e8';
  g.fillRect(S / 2 - S * road / 2, 0, S * road, S);
  g.fillRect(0, S / 2 - S * road / 2, S, S * road);
  g.strokeStyle = 'rgba(22,24,29,0.16)'; g.lineWidth = 4;
  for (const p of [S / 2 - S * road / 2, S / 2 + S * road / 2]) {
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
  }
  g.strokeStyle = 'rgba(22,24,29,0.28)'; g.lineWidth = 5;
  g.setLineDash([28, 26]);
  g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.stroke();
  g.beginPath(); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  const cw = S * road, half = cw / 2;
  for (const side of [-1, 1]) {
    const edge = S / 2 + side * (half + 30) - (side < 0 ? 60 : 0);
    for (let i = 0; i < 10; i++) {
      const o = S / 2 - half + 8 + i * (cw / 10);
      g.fillRect(o, edge, cw / 10 - 8, 60);
      g.fillRect(edge, o, 60, cw / 10 - 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// per-building facade: a shopfront ground floor (floor-to-ceiling glass,
// mullions, a recessed door) under rows of apartment/office windows sized
// by the building's real height
function makeFacadeTexture(seed, h) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f5f7'; g.fillRect(0, 0, 256, 512);
  const shopH = Math.round(512 * (CITY.floor1 / h));
  // shopfront band
  g.fillStyle = 'rgba(22,24,29,0.13)';                  // the glass
  g.fillRect(6, 512 - shopH + 6, 244, shopH - 8);
  g.fillStyle = '#f4f5f7';
  for (let i = 1; i < 4; i++) g.fillRect(6 + i * 61, 512 - shopH + 6, 6, shopH - 8);  // mullions
  const doorX = 20 + Math.floor(rnd01(seed * 3.7) * 3) * 61;
  g.fillStyle = 'rgba(22,24,29,0.55)';                  // the door pane
  g.fillRect(doorX, 512 - shopH + 10, 44, shopH - 12);
  g.fillStyle = 'rgba(22,24,29,0.32)';                  // awning line
  g.fillRect(0, 512 - shopH - 6, 256, 8);
  // upper storeys
  const rows = Math.max(1, Math.round((h - CITY.floor1) / CITY.floorH));
  const rowH = (512 - shopH - 16) / rows;
  const wpx = Math.max(10, Math.round(40 * CITY.win));
  for (let y = 0; y < rows; y++) for (let x = 0; x < 5; x++) {
    const r = rnd01(seed * 31.7 + y * 13.1 + x * 7.3);
    g.fillStyle = r > 0.96 ? 'rgba(255,45,26,0.75)'
      : r > 0.62 ? 'rgba(22,24,29,0.20)' : 'rgba(22,24,29,0.10)';
    g.fillRect(24 + x * 46, 10 + y * rowH, wpx, Math.min(rowH - 10, 26));
  }
  return new THREE.CanvasTexture(c);
}

const CELL = ARENA_HALF * 2;
const streetTex = makeStreetTexture();
streetTex.repeat.set(CITY.reach * 2 + 1, CITY.reach * 2 + 1);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(CELL * (CITY.reach * 2 + 1), CELL * (CITY.reach * 2 + 1)),
  new THREE.MeshLambertMaterial({ map: streetTex })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// invisible physics walls; the VISIBLE boundary is the city itself
for (let i = 0; i < 4; i++) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(ARENA_HALF * 2 + 1, 5, 0.5), MAT_WHITE);
  const a = (i * Math.PI) / 2;
  wall.position.set(Math.sin(a) * (ARENA_HALF + 0.25), 2.5, Math.cos(a) * (ARENA_HALF + 0.25));
  wall.rotation.y = a;
  wall.visible = false;
  scene.add(wall);
}

// a corner lot of towers for one city cell; the near ring gets full shopfront
// facades, distant rings get plain fogged silhouettes
function buildLot(cx, cz, near, si) {
  const half = CELL / 2, sw = CITY.street / 2 + 1;
  for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    let bi = 0;
    for (let k = 0; k < 2; k++) {
      if (rnd01(si * 7.9 + bi * 3.1 + k * 41.7) > CITY.density) { bi++; continue; }
      const w = 6 + rnd01(si * 91.3 + bi * 17.7) * 6;
      const h = CITY.hMin + rnd01(si * 53.9 + bi * 29.3) * (CITY.hMax - CITY.hMin);
      const px = cx + qx * (sw + 3.5 + w / 2 + k * 8 + rnd01(si + bi * 5.1) * 3);
      const pz = cz + qz * (sw + 3.5 + w / 2 + (1 - k) * 8 + rnd01(si + bi * 9.7) * 3);
      const mat = near ? new THREE.MeshLambertMaterial({ map: makeFacadeTexture(si * 10 + bi, h) }) : MAT_WHITE;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (0.7 + rnd01(bi * 13.3) * 0.6)), mat);
      b.position.set(px, h / 2, pz);
      scene.add(b);
      bi++;
    }
  }
}
// the arena's own cell gets a tight perimeter ring (its lots would otherwise
// intrude on the playfield); streets' mouths stay open at every side
function buildPerimeter() {
  for (let side = 0; side < 4; side++) {
    const a = (side * Math.PI) / 2;
    let along = -ARENA_HALF, bi = 0;
    while (along < ARENA_HALF - 2) {
      const w = 5 + rnd01(side * 91.3 + bi * 17.7) * 5;
      const mid = along + w / 2;
      if (Math.abs(mid) > CITY.street / 2 + 1.5) {
        const h = CITY.hMin + rnd01(side * 53.9 + bi * 29.3) * (CITY.hMax - CITY.hMin);
        const b = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, h, 7),
          new THREE.MeshLambertMaterial({ map: makeFacadeTexture(side * 10 + bi, h) }));
        b.position.set(Math.sin(a) * (ARENA_HALF + 3.6) + Math.cos(a) * mid, h / 2,
          Math.cos(a) * (ARENA_HALF + 3.6) - Math.sin(a) * mid);
        b.rotation.y = a;
        scene.add(b);
      }
      along += w; bi++;
    }
  }
}
buildPerimeter();
for (let gx = -CITY.reach; gx <= CITY.reach; gx++)
  for (let gz = -CITY.reach; gz <= CITY.reach; gz++) {
    if (gx === 0 && gz === 0) continue;
    buildLot(gx * CELL, gz * CELL, false, 60);   // one seed: the city repeats every block
  }

// Cover blocks double as physics obstacles: {min, max} AABBs.
// Three arena layouts, rotated every 3 waves. [x, z, w, h, d] per block.
const LAYOUTS = [
  [ // scattered cover
    [-7, -6, 3.2, 2.6, 1.4], [8, -8, 1.6, 3.4, 1.6], [6, 5, 4.0, 2.2, 1.4],
    [-9, 7, 1.6, 3.8, 1.6], [0, -13, 5.0, 2.0, 1.4], [-2, 12, 1.6, 3.0, 1.6],
    [13, -1, 1.4, 2.8, 3.6], [-14, -2, 1.4, 2.4, 3.6],
  ],
  [ // pillar court
    [-6, -6, 1.7, 3.4, 1.7], [6, -6, 1.7, 3.4, 1.7], [-6, 5, 1.7, 3.4, 1.7],
    [6, 5, 1.7, 3.4, 1.7], [0, -1, 4.5, 2.4, 2.0], [0, -15, 6.0, 2.0, 1.4],
    [13, 2, 1.4, 2.6, 4.0], [-13, 2, 1.4, 2.6, 4.0],
  ],
  [ // corridors
    [-4.5, 2, 1.4, 2.8, 9.0], [4.5, -2, 1.4, 2.8, 9.0], [0, -9, 5.0, 2.2, 1.4],
    [0, 7, 5.0, 2.2, 1.4], [11, 9, 2.2, 3.0, 2.2], [-11, -9, 2.2, 3.0, 2.2],
    [12, -7, 1.5, 2.4, 1.5], [-12, 7, 1.5, 2.4, 1.5],
  ],
  [ // the boulevard: abandoned cars along the lanes, kiosks on the corners
    [-3.6, -9, 2.0, 1.4, 4.4], [3.6, -14, 2.0, 1.4, 4.4], [-3.6, 6, 2.0, 1.4, 4.4],
    [3.6, 12, 2.0, 1.4, 4.4], [-10, -3.6, 4.4, 1.4, 2.0], [12, 3.6, 4.4, 1.4, 2.0],
    [-9, 9, 2.4, 2.8, 2.4], [9, -8, 2.4, 2.8, 2.4],
  ],
];

const obstacles = [];
const obstacleMeshes = [];
let currentLayout = -1;

function setLayout(idx) {
  if (idx === currentLayout) return;
  currentLayout = idx;
  for (const m of obstacleMeshes) scene.remove(m);
  obstacleMeshes.length = 0;
  obstacles.length = 0;
  for (const [x, z, w, h, d] of LAYOUTS[idx]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT_WHITE);
    m.position.set(x, h / 2, z);
    scene.add(m);
    obstacleMeshes.push(m);
    obstacles.push({
      min: new THREE.Vector3(x - w / 2, 0, z - d / 2),
      max: new THREE.Vector3(x + w / 2, h, z + d / 2),
    });
  }
}
setLayout(0);

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

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
  ammo: Infinity,
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
}
function recenterWorld() {
  for (const ax of ['x', 'z']) {
    if (Math.abs(player.pos[ax]) > CELL / 2) shiftWorld(ax, -Math.sign(player.pos[ax]) * CELL);
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
  sniperVM.rotation.y = 0.16;
  sniperVM.rotation.x = -0.02;
}
sniperVM.visible = false;
gun.add(pistolVM, shotgunVM, sniperVM);
// camera-attached meshes must never be frustum-culled: a stale bound can
// blink the equipped gun out of existence
gun.traverse((o) => { o.frustumCulled = false; });

const muzzle = new THREE.Mesh(
  new THREE.SphereGeometry(0.045, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0 })
);
muzzle.position.set(0, 0.02, -0.3);
gun.add(muzzle);
gun.scale.setScalar(0.45);
gun.rotation.y = -0.06;
gun.position.set(0.14, -0.19, -0.5);   // low & slightly right — thumb-friendly in portrait
camera.add(gun);
scene.add(camera);
let gunKick = 0;

function setWeapon(type) {
  player.weapon = type;
  player.ammo = WEAPONS[type].ammo;
  pistolVM.visible = type === 'pistol';
  shotgunVM.visible = type === 'shotgun';
  sniperVM.visible = type === 'sniper';
  updateAmmoHud();
}

// ---------------------------------------------------------------------------
// Bullets — simple projectile physics with swept capsule collision
// ---------------------------------------------------------------------------
const bullets = [];   // {mesh, trail, pos, vel, prev, fromPlayer, life}
const bulletGeo = new THREE.SphereGeometry(0.04, 8, 8);
const bulletMatP = new THREE.MeshBasicMaterial({ color: 0x16181d });

// bullet scars: temporary marks where rounds strike walls and cover
const markGeo = new THREE.PlaneGeometry(0.15, 0.15);
const marks = [];
function addBulletMark(b, at) {
  const p = (at || b.pos).clone();
  const m = new THREE.Mesh(markGeo,
    new THREE.MeshBasicMaterial({ color: 0x16181d, transparent: true, opacity: 0.38 }));
  m.position.copy(p).addScaledVector(_v1.copy(b.vel).normalize(), -0.03);
  m.lookAt(m.position.x - b.vel.x, m.position.y - b.vel.y, m.position.z - b.vel.z);
  marks.push({ m, t: 0 });
  scene.add(m);
  if (marks.length > 70) { scene.remove(marks[0].m); marks[0].m.material.dispose(); marks.shift(); }
}
function updateMarks(dt2) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const k = marks[i]; k.t += dt2;
    k.m.material.opacity = 0.38 * Math.max(0, 1 - k.t / 10);
    if (k.t >= 10) { scene.remove(k.m); k.m.material.dispose(); marks.splice(i, 1); }
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
  const mesh = new THREE.Mesh(bulletGeo, fromPlayer ? bulletMatP : bulletMatE);
  mesh.position.copy(pos);
  if (!fromPlayer) {
    // enemy shots are the thing you dodge — make them impossible to miss:
    // a big red orb with a white-hot core and a soft halo
    mesh.scale.setScalar(3.2);
    const core = new THREE.Mesh(bulletGeo, bulletMatCore);
    core.scale.setScalar(0.45);
    const halo = new THREE.Mesh(bulletGeo, bulletMatHalo);
    halo.scale.setScalar(2.2);
    mesh.add(core, halo);
  }
  scene.add(mesh);
  // tracer line so hanging bullets are legible in frozen time
  const trailGeo = new THREE.BufferGeometry().setFromPoints([pos.clone(), pos.clone()]);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    color: fromPlayer ? 0x16181d : 0xff2d1a, transparent: true, opacity: fromPlayer ? 0.35 : 0.85,
  }));
  scene.add(trail);
  const speed = fromPlayer
    ? (opt || PLAYER_BULLET_SPEED)
    : Math.min(ENEMY_BULLET_SPEED + (game.wave - 1) * 0.5, 16) * (opt || 1);
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

function spawnRipple(pos, vel, big) {
  const mat = new THREE.MeshBasicMaterial({
    color: big ? 0xd88a80 : 0x8aa8c4, transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(rippleGeo, mat);
  mesh.position.copy(pos);
  mesh.lookAt(_v1.copy(pos).add(vel));
  mesh.scale.setScalar(0.05);
  scene.add(mesh);
  ripples.push({ mesh, life: 0.8, maxLife: 0.8, grow: big ? 1.0 : 0.55 });
  if (ripples.length > 90) {   // hard cap; oldest rings pop first
    const r = ripples.shift();
    scene.remove(r.mesh);
    r.mesh.material.dispose();
  }
}

function updateRipples(sdt) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.life -= sdt;
    if (r.life <= 0) {
      scene.remove(r.mesh);
      r.mesh.material.dispose();
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
const debris = [];   // {mesh, vel, angVel, life, maxLife}
const shardGeo = new THREE.TetrahedronGeometry(0.12);

function spawnShatter(center, impulseDir) {
  for (let i = 0; i < 26; i++) {
    const mesh = new THREE.Mesh(shardGeo, Math.random() < 0.75 ? MAT_RED : MAT_DARKRED);
    const s = 0.5 + Math.random() * 1.4;
    mesh.scale.setScalar(s);
    mesh.position.set(
      center.x + (Math.random() - 0.5) * 0.5,
      0.25 + Math.random() * 1.5,
      center.z + (Math.random() - 0.5) * 0.5
    );
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 4.5,
      Math.random() * 3.5 + 0.5,
      (Math.random() - 0.5) * 4.5
    ).addScaledVector(impulseDir, 2.2 + Math.random() * 2);
    scene.add(mesh);
    debris.push({
      mesh, vel,
      angVel: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
      life: 2.8 + Math.random(), maxLife: 3.8,
    });
  }
}

function spawnSparks(at, color) {
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(shardGeo, mat);
    mesh.scale.setScalar(0.25 + Math.random() * 0.25);
    mesh.position.copy(at);
    scene.add(mesh);
    debris.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5),
      angVel: new THREE.Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20),
      life: 0.6 + Math.random() * 0.4, maxLife: 1,
    });
  }
}

function updateDebris(sdt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= sdt;
    if (d.life <= 0) {
      scene.remove(d.mesh);
      debris.splice(i, 1);
      continue;
    }
    d.vel.y -= GRAVITY * sdt;
    d.mesh.position.addScaledVector(d.vel, sdt);
    d.mesh.rotation.x += d.angVel.x * sdt;
    d.mesh.rotation.y += d.angVel.y * sdt;
    d.mesh.rotation.z += d.angVel.z * sdt;
    const r = 0.1 * d.mesh.scale.x;
    if (d.mesh.position.y < r && d.vel.y < 0) {   // floor bounce with friction
      d.mesh.position.y = r;
      d.vel.y *= -0.32;
      d.vel.x *= 0.6; d.vel.z *= 0.6;
      d.angVel.multiplyScalar(0.5);
    }
    if (d.life < 0.5) d.mesh.scale.multiplyScalar(Math.max(0.0, 1 - sdt * 2));
  }
}

// ---------------------------------------------------------------------------
// Grenades — bombers lob these in an arc onto a marked red landing ring.
// Anything inside the blast when it lands goes down, enemies included.
// ---------------------------------------------------------------------------
const grenades = [];   // {mesh, ring, pos, vel, t}
const grenadeGeo = new THREE.SphereGeometry(0.14, 10, 10);
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
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 0.78, 24),
    new THREE.MeshBasicMaterial({ color: 0xff2d1a, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
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
  gr.ring.material.dispose();
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
        Math.abs(m.pos.x) > CELL || Math.abs(m.pos.z) > CELL) {
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
const PICKUP_LIFE = 12;
const PICKUP_SINK = 1.2;   // final seconds: the gun sinks into the floor

function spawnPickup(pos, type = 'shotgun') {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  if (type === 'sniper') {
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
    showBanner('WEAPON DROP<small>TAP IT TO SPRINT &amp; EQUIP</small>', 1600);
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
      if (d2 < 3.2 * 3.2 && d2 > 0.01) {
        // magnet: run near a drop and it slides to your hand (real time)
        const d = Math.sqrt(d2);
        const pull = Math.min(5 * dt, d);
        p.g.position.x -= (dx / d) * pull;
        p.g.position.z -= (dz / d) * pull;
      }
      if (d2 < 1.8 * 1.8) {
        setWeapon(p.type);
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
  const chest = new THREE.Mesh(loftGeo(chestProf, 1, jit, seed), EM(C.chest));
  collar.add(chest);

  if (P.neck > 0.005) {
    const neck = new THREE.Mesh(loftGeo([
      { y: -(P.neck + 0.02), rx: P.head * 0.24, rz: P.head * 0.24 },
      { y: 0, rx: P.head * 0.21, rz: P.head * 0.22 },
    ], 2, jit * 0.6, seed), EM(C.body));
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
  const head = new THREE.Mesh(loftGeo(headProf, 3, jit, seed), EM(C.head));
  head.position.y = 1.62 + hh / 2 - torsoTop;   // head center stays at 1.62
  collar.add(head);

  const ph2 = hipTop - 0.62;
  const pelvis = new THREE.Mesh(loftGeo([
    { y: -ph2, rx: P.hip / 2 * 0.8, rz: P.chest * 0.36 },
    { y: -ph2 * 0.45, rx: P.hip / 2, rz: P.chest * 0.4 },
    { y: 0, rx: P.hip / 2 * 0.9, rz: P.chest * 0.43 },
  ], 4, jit, seed), EM(C.pelvis));
  pelvis.position.y = hipTop;
  g.add(pelvis);

  // legs: thigh group at the hip (game swings rotation.x), shin group at the
  // knee with the resting bend, wedge shoe rigid at 90° to the shin
  const thighL = 0.44, shinLen = 0.36;
  const mkLeg = (side) => {
    const leg = new THREE.Group();
    leg.position.set(side * (P.hip / 2 - P.legt / 2 + 0.01), 0.86, 0);
    leg.add(new THREE.Mesh(loftGeo(limbProf2(thighL, P.legt * 0.62, P.legt * (0.58 + 0.22 * m), P.legt * 0.42), 5 + side, jit, seed), EM(C.body)));
    const shin = new THREE.Group();
    shin.position.y = -thighL;
    shin.rotation.x = EP.knee;
    shin.add(new THREE.Mesh(loftGeo(limbProf2(shinLen, P.legt * 0.46, P.legt * (0.48 + 0.26 * m), P.legt * 0.3), 7 + side, jit, seed), EM(C.body)));
    const fw = P.legt, ft = fw * 0.72;
    const foot = new THREE.Mesh(facesToGeo([
      [-fw / 2, 0, -0.11], [fw / 2, 0, -0.11], [fw / 2, 0.085, -0.11], [-fw / 2, 0.085, -0.11],
      [-ft / 2, 0, 0.23], [ft / 2, 0, 0.23], [ft / 2, 0.028, 0.23], [-ft / 2, 0.028, 0.23]], BOXF), EM(C.pelvis));
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
    ], 11 + side, jit, seed), EM(C.body)));
    const fore = new THREE.Group();
    fore.position.y = -upperL;
    fore.rotation.x = -(side > 0 ? 0.12 : EP.elbow);
    fore.add(new THREE.Mesh(loftGeo(limbProf2(foreL + 0.06, P.armt * 0.46, P.armt * (0.48 + 0.2 * m), P.armt * 0.3), 13 + side, jit, seed), EM(C.body)));
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
      const f = new THREE.Mesh(tboxGeo(P.armt * 0.95, P.armt * 0.85, 0.11, P.armt * 0.95, P.armt * 0.85), EM(C.body));
      f.position.set(0, -foreL - 0.04, -0.055);
      fa.add(f);
    } else {
      const palm = new THREE.Mesh(tboxGeo(P.armt * 0.82, P.armt * 0.62, 0.14, P.armt * 0.52, P.armt * 0.4), EM(C.body));
      palm.position.set(0, -foreL - 0.02, 0.008);
      const thumb = new THREE.Mesh(tboxGeo(0.032, 0.026, 0.07, 0.04, 0.032), EM(C.body));
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
        const claw = new THREE.Mesh(tboxGeo(0.018, 0.06, 0.22, 0.018, 0.052), EM(C.head));
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
      ], 26, jit, seed), EM(C.pelvis));
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
  heavy: { speed: 1.6, scale: [1.14, 1.05, 1.14], drop: 0, aimTime: 0.55, cd: [1.8, 1.0], mul: 1, pellets: 1, burst: 3 },
  shotgunner: { speed: 1.8, scale: [1.06, 1, 1.06], drop: 0.8, aimTime: 0.65, cd: [1.6, 0.9], mul: 0.85, pellets: 5, spread: 0.09, engage: [10, 4] },
  armored: { speed: 1.4, scale: [1.1, 1.06, 1.1], drop: 0, aimTime: 0.6, cd: [1.2, 0.8], mul: 1, pellets: 1, armored: true },
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
  const parts = buildEnemyMesh(type);
  const spec = ENEMY_TYPES[type];
  parts.g.scale.set(...spec.scale);
  // the wave attacks from one flank: spawn in an arc around the wave bearing
  // so the fight stays in front of you instead of whipping side to side
  let x = 0, z = 0, placed = false;
  for (let tries = 0; tries < 24 && !placed; tries++) {
    const a = game.waveBearing + (Math.random() - 0.5) * 1.1;   // ±32°
    const d = type === 'sniper' ? 16 + Math.random() * 4 : 12 + Math.random() * 7;
    x = player.pos.x + Math.sin(a) * d;
    z = player.pos.z + Math.cos(a) * d;
    const lim = ARENA_HALF - 2;
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    if (pointInObstacle(x, z, 0.8)) continue;
    placed = true;
  }
  if (!placed) {   // fallback: arena rim, away from the player
    const a = game.waveBearing + (Math.random() - 0.5) * 1.5;
    const r = ARENA_HALF - 2.5;
    x = Math.sin(a) * r; z = Math.cos(a) * r;
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
    const mesh = new THREE.Mesh(shardGeo, Math.random() < 0.75 ? MAT_RED : MAT_DARKRED);
    const size = late ? 0.35 + Math.random() * 0.4 : 0.6 + Math.random() * 0.6;
    mesh.scale.setScalar(size);
    const a = Math.random() * Math.PI * 2;
    const r = 1.1 + Math.random() * 1.8;
    const from = new THREE.Vector3(x + Math.sin(a) * r, 0.2 + Math.random() * 2.6, z + Math.cos(a) * r);
    const to = bodyPoint();
    mesh.position.copy(from);
    mesh.visible = !late;
    scene.add(mesh);
    shards.push({
      mesh, from, to, size,
      // hard-accelerating schedule (curve 0.35): a trickle at first, then a
      // torrent — the figure floods in right before the reveal
      activeAt: late ? ASSEMBLE_T * 0.9 * Math.pow((i - N_INIT) / N_LATE, 0.35) : 0,
      travel: late ? 0.06 : ASSEMBLE_T * 0.48,
      spin: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
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
    fireCd: ((type === 'sniper' ? 1.2 : 0.15) + Math.random() * 0.35) * aimSpeedFactor(),
    engageDist: spec.engage
      ? spec.engage[0] + Math.random() * spec.engage[1]
      : 19 + Math.random() * 6,           // guns come up early — pressure from range
    burstLeft: 0,
    burstT: 0,
    alive: true,
  });
  if (type === 'sniper') {
    warnFlash(['SNIPER.']);
    sfx.alert();   // its own stinger — sfx.wave() is the wave VO now
  }
  if (type === 'laser') {
    warnFlash(['LASER.']);
    sfx.alert();
  }
}

// ---------------------------------------------------------------------------
// RUSH HOUR: the street is full of black silhouettes walking their routes.
// Some are the system's sleepers. Freeze time and their bodies burn red.
// ---------------------------------------------------------------------------
const crowd = [];
const npcDebris = [];
const RUSH = { crowd: 24 };
let rushT = 0, nextSleeperT = 5;
const MAT_CROWD = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
const MAT_REVEAL = new THREE.MeshBasicMaterial({ color: 0xff2d1a });

function spawnNPC(anywhere = false) {
  const parts = buildEnemyMesh('gunner');
  const horiz = Math.random() < 0.5;
  const lane = (Math.random() - 0.5) * (CITY.street - 3);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const n = { ...parts, horiz, lane, dir, pos: parts.g.position,
    walkPhase: Math.random() * 6.28, sleeper: Math.random() < 0.4, revealed: false,
    speed: 1.0 + Math.random() * 0.6 };
  const along = anywhere ? (Math.random() * 2 - 1) * (ARENA_HALF - 1) : -dir * (ARENA_HALF - 0.6);
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
  setLayout(3);   // the boulevard
  clearCrowd();
  rushT = 0; nextSleeperT = 5;
  for (let i = 0; i < RUSH.crowd; i++) spawnNPC(true);
  el.pausebtn.style.display = 'block';
  el.ammo.style.display = '';
  setTimeLocked(false);
  slowBank = SLOWMO.base;
  updateSlowMeter();
  updateModeUI();   // shows the time button + meter in button mode
  showBanner('RUSH HOUR<small>FREEZE TIME TO SEE WHO THEY REALLY ARE</small>', 3200);
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
      n.g.traverse(o => { if (o.isMesh) o.material = slow ? MAT_REVEAL : MAT_CROWD; });
    }
    if (Math.abs(n.horiz ? n.pos.x : n.pos.z) > ARENA_HALF - 0.4) {
      scene.remove(n.g); crowd.splice(i, 1); spawnNPC();
    }
  }
  while (crowd.length + enemies.length < RUSH.crowd) spawnNPC();
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
    nextSleeperT = Math.max(2.2, 6.5 - rushT * 0.06) * (0.7 + Math.random() * 0.6);
    let best = null, bd = 1e9;
    for (const n of crowd) {
      if (!n.sleeper) continue;
      const d = Math.hypot(n.pos.x - player.pos.x, n.pos.z - player.pos.z);
      if (d > 5 && d < 24 && d < bd) { bd = d; best = n; }
    }
    if (best) { activateSleeper(best); sfx.alert(); }
  }
}

const ASSEMBLE_T = 0.25;      // seconds (world time) for a spawn to pull together
const ASSEMBLE_REVEAL = 0.95; // fraction of T when the body appears under the
                              // shards, which then shrink into its surface —
                              // the swap reads as a settle, not a pop

function removeEnemyShards(e) {
  if (!e.shards) return;
  for (const s of e.shards) scene.remove(s.mesh);
  e.shards = null;
}

function killEnemy(i, impulseDir) {
  const e = enemies[i];
  removeEnemyShards(e);   // a mid-assembly kill (menu demo) must not leak shards
  removeBeam(e);          // shattering the laser cuts his sweep instantly
  if (timeMode === 'toggle' && (game.state === 'play' || game.state === 'intro')) {
    slowBank = Math.min(SLOWMO.cap, slowBank + SLOWMO.bonus);   // kills buy time
  }
  if (game.state !== 'menu') vibrate(15);   // every kill lands in the thumb
  spawnShatter(e.pos, impulseDir);
  const drop = ENEMY_TYPES[e.type].drop;
  if (typeof drop === 'string') spawnPickup(e.pos, drop);           // named loot
  else if (Math.random() < drop) spawnPickup(e.pos, 'shotgun');
  scene.remove(e.g);
  enemies.splice(i, 1);
  game.kills++;
  killWord();
  sfx.shatter();
  vibrate(30);
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
  const origin = _v2.set(e.pos.x, 1.35, e.pos.z).addScaledVector(toPlayer, 0.45);
  // shots go where you ARE — if you don't slide out of the way, they connect
  const target = _v3.set(
    player.pos.x + (Math.random() - 0.5) * 0.24,
    EYE_HEIGHT - 0.25 + (Math.random() - 0.5) * 0.24,
    player.pos.z + (Math.random() - 0.5) * 0.24
  );
  // ballistic compensation: aim above the torso by the gravity drop over the
  // flight, so the round arrives at chest height instead of plowing the dirt
  const speed = Math.min(ENEMY_BULLET_SPEED + (game.wave - 1) * 0.5, 16) * (spec.mul || 1);
  const tFly = origin.distanceTo(target) / speed;
  target.y += 0.5 * BULLET_GRAVITY * tFly * tFly;
  const baseDir = target.sub(origin).normalize();
  for (let p = 0; p < (spec.pellets || 1); p++) {
    const d = baseDir.clone();
    if (spec.spread) {
      d.x += (Math.random() - 0.5) * 2 * spec.spread;
      d.y += (Math.random() - 0.5) * 2 * spec.spread;
      d.z += (Math.random() - 0.5) * 2 * spec.spread;
      d.normalize();
    }
    spawnBullet(origin, d, false, spec.mul || 1);
  }
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

// Enemies get on the trigger faster as waves progress: already quick at
// wave 1 (x0.8), down to x0.5 telegraphs and cooldowns by wave ~7.
function aimSpeedFactor() {
  return Math.max(0.5, 0.8 - (game.wave - 1) * 0.05);
}

// Same slab push-out the player uses: an enemy can never end a frame inside
// a wall block, no matter what the steering did.
function resolveEnemyCollisions(e) {
  const r = 0.5;
  const lim = ARENA_HALF - 1;
  e.pos.x = Math.min(Math.max(e.pos.x, -lim), lim);
  e.pos.z = Math.min(Math.max(e.pos.z, -lim), lim);
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

  // a burst, once started, always completes — no melee interrupt mid-volley
  if (dist < 1.5 && e.state !== 'melee' && e.state !== 'burst' && e.state !== 'assemble') {
    e.state = 'melee'; e.stateT = 0;
  }

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
        if (e.stateT < s.activeAt) continue;
        s.mesh.visible = true;
        const p = Math.min((e.stateT - s.activeAt) / s.travel, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        s.mesh.position.lerpVectors(s.from, s.to, ease);
        s.mesh.rotation.x += s.spin.x * sdt * (1 - ease);
        s.mesh.rotation.y += s.spin.y * sdt * (1 - ease);
        s.mesh.rotation.z += s.spin.z * sdt * (1 - ease);
        if (shrinkP > 0) s.mesh.scale.setScalar(s.size * (1 - shrinkP));
      }
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
      const strafeDir = _v2.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(e.strafe * 0.55);
      const dir = _v3.copy(toPlayer).add(strafeDir).normalize();
      // steer around cover
      for (const o of obstacles) {
        const cx = (o.min.x + o.max.x) / 2, cz = (o.min.z + o.max.z) / 2;
        const dx = e.pos.x - cx, dz = e.pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < 9) {
          const inv = 1.6 / Math.max(Math.sqrt(d2), 0.3);
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
      e.pos.x += dir.x * moveSpeed * sdt;
      e.pos.z += dir.z * moveSpeed * sdt;
      resolveEnemyCollisions(e);   // hard guarantee: steering can fail, this can't

      if (e.type !== 'rusher' && dist < e.engageDist && e.fireCd <= 0 &&
          (!ENEMY_TYPES[e.type].shielded || Math.cos(e.g.rotation.y - wantYaw) > 0.8) &&
          performance.now() >= game.noFireBefore &&
          hasLineOfSight(_v2.set(e.pos.x, 1.35, e.pos.z), _v3.set(player.pos.x, EYE_HEIGHT - 0.3, player.pos.z))) {
        e.state = 'aim'; e.stateT = 0;
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
function playerFire() {
  if (!player.alive || game.state !== 'play') return;
  if (player.fireCd > 0) return;
  const spec = WEAPONS[player.weapon];
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
    spawnBullet(origin, d, true, spec.speed, spec.pierce || 0);
  }
  gunKick = spec.kick;
  muzzle.material.opacity = 1;
  sfx.shot(player.weapon);
  vibrate(spec.pellets > 1 ? 26 : 12);
  if (player.ammo !== Infinity) {
    player.ammo--;
    if (player.ammo <= 0) setWeapon('pistol');
    else updateAmmoHud();
  }
}

function updateBullets(sdt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.prev.copy(b.pos);
    b.vel.y -= BULLET_GRAVITY * sdt;
    b.pos.addScaledVector(b.vel, sdt);
    b.life -= sdt;
    b.mesh.position.copy(b.pos);

    // trail stretches behind the bullet, longer at speed (enemy tracers extra
    // long so incoming fire reads instantly in frozen time)
    const tp = b.trail.geometry.attributes.position.array;
    const back = _v1.copy(b.vel).normalize()
      .multiplyScalar(-Math.min(b.vel.length() * (b.fromPlayer ? 0.05 : 0.2), b.fromPlayer ? 1.2 : 2.6));
    tp[0] = b.pos.x + back.x; tp[1] = b.pos.y + back.y; tp[2] = b.pos.z + back.z;
    tp[3] = b.pos.x; tp[4] = b.pos.y; tp[5] = b.pos.z;
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
        Math.abs(b.pos.x) > CELL || Math.abs(b.pos.z) > CELL) {
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
          // a civilian: shatters black — and the system docks your frozen time
          shatterNPC(n);
          crowd.splice(ci, 1);
          spawnNPC();
          if (timeMode === 'toggle') slowBank = Math.max(0, slowBank - 2);
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
const LOOK_SENS = 2.6;          // radians per screen-width of look drag
const TAP_MS = 280, TAP_PX = 18;  // thresholds on NET displacement — real
                                  // thumbs jitter, so never sum path length
const PICKUP_TAP_PX = 120;      // generous screen-px hit radius for tapping a
                                // drop — near-misses should grab, not fire

const input = {
  pointers: new Map(),          // id -> {sx,sy,x,y,ox,oy,role,downT}
  holding: false,
  stickX: 0, stickY: 0,         // -1..1 move-stick deflection
  lookIdle: 99,                 // seconds since the last manual look drag
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

function pickupAtScreen(px, py) {
  for (const p of pickups) {
    _v1.set(p.g.position.x, 0.9, p.g.position.z).project(camera);
    if (_v1.z > 1) continue;   // behind the camera
    // no sprinting at guns hidden behind cover — you'd just run into the wall
    if (!hasLineOfSight(
      _v2.set(player.pos.x, EYE_HEIGHT, player.pos.z),
      _v3.set(p.g.position.x, 0.9, p.g.position.z))) continue;
    const sx = (_v1.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-_v1.y * 0.5 + 0.5) * window.innerHeight;
    if (Math.hypot(sx - px, sy - py) < PICKUP_TAP_PX) return p;
  }
  return null;
}

function onPointerDown(ev) {
  // "inside settings" means inside the CARD — the backdrop covers the screen
  const inSettings = ev.target && ev.target.closest && ev.target.closest('#settings .htpcard');
  if (!inSettings) ev.preventDefault();   // sliders need native pointer handling
  sfx.init();
  if (el.settings.style.display === 'flex') {   // settings modal open
    if (inSettings) {
      if (ev.target.closest && ev.target.closest('#sethaptics')) {
        setHaptics(!hapticsOn);
        el.sethaptics.textContent = hapticsOn ? 'ON' : 'OFF';
        el.sethaptics.classList.toggle('on', hapticsOn);
        vibrate(15);   // demo thump so the toggle speaks for itself
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
      if (ev.target.closest('#scores') || ev.target.closest('.rules')) return;   // reading
    }
    if (game.state === 'menu' && ev.target && ev.target.closest && ev.target.closest('#rushlink')) {
      game.mode = 'rush';
      advanceFromOverlay();
      return;
    }
    // on the main menu only TAP TO BEGIN starts a run — a stray tap right
    // after closing settings must not launch you into a wave
    if (game.state === 'menu' &&
        !(ev.target && ev.target.closest && ev.target.closest('.go'))) return;
    if (game.state === 'menu') game.mode = 'wave';
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
    if (!timeLocked) setTimeLocked(true);
    vibrate(8);
    return;   // the button never fires the gun
  }
  input.pointers.set(ev.pointerId, {
    sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY,
    ox: ev.clientX, oy: ev.clientY, role: null, downT: performance.now(),
  });
  input.holding = true;
}

function onPointerMove(ev) {
  if (ev.pointerId === timeBtnPointer) {
    // a swipe that starts on the time button is a look flick, not a press —
    // undo the accidental toggle and hand the pointer over to the look control
    if (Math.hypot(ev.clientX - timeBtnDownX, ev.clientY - timeBtnDownY) > TIMEBTN_SLIP_PX) {
      if (!timeBtnWasLocked) setTimeLocked(false);
      timeBtnPointer = null;
      input.pointers.set(ev.pointerId, {
        sx: timeBtnDownX, sy: timeBtnDownY, x: ev.clientX, y: ev.clientY,
        ox: ev.clientX, oy: ev.clientY, role: 'look', downT: performance.now(),
      });
      input.holding = true;
      applyLook(ev.clientX - timeBtnDownX, ev.clientY - timeBtnDownY);
    }
    return;
  }
  const p = input.pointers.get(ev.pointerId);
  if (!p) return;
  ev.preventDefault();
  const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
  p.x = ev.clientX; p.y = ev.clientY;
  if (!p.role && Math.hypot(p.x - p.sx, p.y - p.sy) > TAP_PX) {
    // if the other thumb is already steering, this finger is LOOK no matter
    // where it landed — two-handed play shouldn't care about screen halves
    let hasMove = false;
    for (const q of input.pointers.values()) if (q !== p && q.role === 'move') hasMove = true;
    p.role = hasMove ? 'look' : (p.sx < window.innerWidth * 0.5 ? 'move' : 'look');
    p.ox = p.x; p.oy = p.y;         // the stick anchors where the drag begins
    if (p.role === 'move') sprintTo = null;   // manual move cancels a sprint
    // the tap dead-zone swallowed the first ~18px of the gesture; replay it
    // (minus this event's dx/dy, applied below) so fast flicks aren't blunted
    if (p.role === 'look') applyLook(p.x - dx - p.sx, p.y - dy - p.sy);
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
    applyLook(dx, dy);
  }
}

function applyLook(dx, dy) {
  const w = window.innerWidth;
  player.yaw -= (dx / w) * LOOK_SENS;
  player.pitch -= (dy / w) * LOOK_SENS;
  player.pitch = Math.min(Math.max(player.pitch, -1.2), 1.2);
  input.lookIdle = 0;
}

function releasePointer(ev, isTapEligible) {
  const p = input.pointers.get(ev.pointerId);
  if (!p) return;
  ev.preventDefault();
  if (isTapEligible && !p.role && performance.now() - p.downT < TAP_MS &&
      Math.hypot(p.x - p.sx, p.y - p.sy) <= TAP_PX) {
    const hit = pickupAtScreen(p.x, p.y);
    if (hit) {
      sprintTo = hit;               // one tap: run there and take the gun
      vibrate(10);
    } else {
      playerFire();
    }
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
const TIMEBTN_TAP_MS = 280;
const TIMEBTN_SLIP_PX = 26;   // slide this far off the button = look gesture

function onPointerUp(ev) {
  sfx.init();   // some browsers only allow audio resume on the gesture's END
  if (ev.pointerId === timeBtnPointer) {
    timeBtnPointer = null;
    if (performance.now() - timeBtnDownAt < TIMEBTN_TAP_MS) {
      // quick tap: toggle (was locked -> off, was off -> stays locked)
      if (timeBtnWasLocked) setTimeLocked(false);
    } else {
      setTimeLocked(false);   // long press: time flows again when you let go
    }
    return;
  }
  releasePointer(ev, true);
}
function onPointerCancel(ev) {
  if (ev.pointerId === timeBtnPointer) {
    timeBtnPointer = null;
    setTimeLocked(false);
    return;
  }
  releasePointer(ev, false);
}

renderer.domElement.style.touchAction = 'none';
window.addEventListener('pointerdown', onPointerDown, { passive: false });
window.addEventListener('pointermove', onPointerMove, { passive: false });
window.addEventListener('pointerup', onPointerUp, { passive: false });
window.addEventListener('pointercancel', onPointerCancel, { passive: false });
window.addEventListener('contextmenu', (e) => e.preventDefault());

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

let hapticsOn = true;
try { hapticsOn = localStorage.getItem('timeshard_haptics') !== '0'; } catch { /* private mode */ }

function vibrate(ms) {
  if (hapticsOn && navigator.vibrate) navigator.vibrate(ms);
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
  let musicSrc = null, musicGain = null, musicFilter = null;
  let musicRate = 1, lastTs = 1, building = false;
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
      const buf = await off.startRendering();
      musicSrc = ctx.createBufferSource();
      musicSrc.buffer = buf;
      musicSrc.loop = true;
      musicSrc.connect(musicFilter);
      musicSrc.start();
      musicGain.gain.setTargetAtTime(0.26 * musicVol, ctx.currentTime, 1.2);   // fade in
    } catch { /* keep SFX even if music fails */ }
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
        // pitched down for depth, with a synth sub-thump under the blast
        if (playSample('shotgun', { rate: r * 0.75, gainMul: 1.15, send: 0.35, fadeAfter: 1.4 })) {
          tone(150, 32, 0.28, 0.45, 'sine', r, 0.2);
          return;
        }
        noise(0.28, 550, 0.5, 0.75, r, 0.3); tone(160, 40, 0.18, 0.3, 'square', r);
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
      return { src, g, send, dead: false };
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
      const dopp = receding ? Math.max(0.35, 1 + vr / 18) : 1;
      const rate = (0.4 + 0.6 * timeScale) * dopp;
      h.src.playbackRate.value += (rate - h.src.playbackRate.value) * k;
      h.send.gain.value += ((receding ? 1.6 : 0.2) - h.send.gain.value) * k;
    },
    detachWhoosh(h) {
      if (!h || h.dead) return;
      h.dead = true;
      whooshCount--;
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

function loadRuns() {
  try { return JSON.parse(localStorage.getItem('timeshard_runs') || '[]'); } catch { return []; }
}

function recordRun() {
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
  try { localStorage.setItem('timeshard_runs', JSON.stringify(runs.slice(0, 5))); } catch { /* private mode */ }
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
  // a real leaderboard: sorted by the chosen metric, so #1 IS your best
  display.sort((a, b) => ((b[scoreMetric] || 0) - (a[scoreMetric] || 0)) || (b.at - a.at));
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
    '<div class="schead">TOP RUNS</div>' +
    `<div class="scpills">` +
    `<span class="scpill${scoreMetric === 'w' ? ' active' : ''}" data-m="w">WAVES</span>` +
    `<span class="scpill${scoreMetric === 'k' ? ' active' : ''}" data-m="k">ENEMIES</span>` +
    `<span class="scpill${scoreMetric === 'd' ? ' active' : ''}" data-m="d">TIME</span>` +
    `</div>${rows}`;
}

// Mix of enemy types for wave n: shotgunners + bombers from wave 3, heavies,
// shield-bearers + one sniper from 4, armored (headshot-only) from 5.
function composeWave(n) {
  const total = Math.min(1 + n, 12);
  const queue = [];
  if (n >= 3) for (let i = 0; i < Math.floor(total / 3); i++) queue.push('shotgunner');
  if (n >= 3) for (let i = 0; i < Math.floor(total / 4); i++) queue.push('bomber');
  if (n >= 4) for (let i = 0; i < Math.floor(total / 4); i++) queue.push('heavy');
  if (n >= 4) for (let i = 0; i < Math.floor(total / 5); i++) queue.push('shieldbearer');
  if (n >= 5) for (let i = 0; i < Math.floor(total / 5); i++) queue.push('armored');
  if (n >= 6) for (let i = 0; i < Math.floor(total / 6); i++) queue.push('rocketeer');
  if (n >= 6) for (let i = 0; i < Math.floor(total / 6); i++) queue.push('rusher');
  if (n >= 4) queue.push('sniper');
  if (n >= 7 && n % 2 === 1) queue.push('laser');
  queue.length = Math.min(queue.length, total);
  while (queue.length < total) queue.push('gunner');
  for (let i = queue.length - 1; i > 0; i--) {   // shuffle
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
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
const SLOWMO = { base: 5, bonus: 2, cap: 10, drain: 1 };
let slowBank = SLOWMO.base;

function setTimeLocked(v) {
  if (v && timeMode === 'toggle' && slowBank <= 0) return;   // dry tank
  timeLocked = v;
  el.timebtn.classList.toggle('locked', v);
  if (v) el.timebtn.classList.remove('hint');   // lesson learned
}

// --- pause: freezes the whole simulation; settings + end run live inside
function openPause() {
  if (game.state !== 'play' && game.state !== 'intro' && game.state !== 'clear') return;
  game.pausedFrom = game.state;
  game.state = 'paused';
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
}
function openSettings() {
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
  const on = timeMode === 'toggle' && inRun;
  el.timebtn.style.display = on ? 'flex' : 'none';
  el.slowmeter.style.display = on ? 'block' : 'none';
  el.gtime.style.display = timeMode === 'toggle' ? '' : 'none';
}
function updateSlowMeter() {
  el.slowfill.style.width = Math.max(0, Math.min(1, slowBank / SLOWMO.cap)) * 100 + '%';
  el.timebtn.classList.toggle('empty', slowBank <= 0);
}
let demoT = 0, demoSpawnT = 0.3, demoKillT = 4;   // menu attract-mode clocks

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
  gtime: document.getElementById('gtime'),
  slowmeter: document.getElementById('slowmeter'),
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
  menurow: document.getElementById('menurow'),
  moderow: document.getElementById('moderow'),
};
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
  el.overlay.querySelector('.rules').style.display = 'none';
  el.menurow.style.display = 'flex';
  el.moderow.style.display = 'flex';
  renderScores();
  updateSndBtn();
  el.menubtn.style.display = 'none';
  el.redflash.style.opacity = 0;
  el.overlay.classList.remove('hidden');
  collectTitleFacets();   // the restore above created fresh title nodes
  shimmerAt = performance.now() / 1000 + SHIMMER_FIRST_DELAY;
}

function updateAmmoHud() {
  if (player.weapon === 'pistol') {
    el.ammo.textContent = 'PISTOL · ∞';
    el.ammo.classList.remove('shotgun');
  } else {
    el.ammo.textContent = `${player.weapon.toUpperCase()} · ` + '▮'.repeat(Math.max(player.ammo, 0));
    el.ammo.classList.add('shotgun');
  }
}

let lastWarnAt = -10;
function warnFlash(words) {
  const now = performance.now() / 1000;
  if (now - lastWarnAt < 4) return;   // don't nag
  lastWarnAt = now;
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

function showBanner(html, dur = 1600) {
  el.banner.innerHTML = html;
  el.banner.classList.add('show');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.banner.classList.remove('show'), dur);
}

function startWave(n, quiet = false) {   // quiet: the clear card already announced it
  game.wave = n;
  game.state = 'intro';
  game.stateT = 0;
  game.spawnQueue = composeWave(n);
  game.spawnTimer = 0;
  // attack bearing: toward the open arena from wherever the player stands,
  // or a random direction if they're near the middle
  const dx = -player.pos.x, dz = -player.pos.z;
  game.waveBearing = Math.hypot(dx, dz) > 3 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2;
  if (n > bestWave) {
    bestWave = n;
    try { localStorage.setItem('timeshard_best', String(n)); } catch { /* private mode */ }
  }
  const newArena = Math.floor((n - 1) / 3) % LAYOUTS.length;
  const arenaChanged = newArena !== currentLayout;
  setLayout(newArena);
  if (arenaChanged) {
    resolvePlayerCollisions();   // in case a new block landed on the player
    recenterWorld();
    for (let i = pickups.length - 1; i >= 0; i--) removePickup(i);
  }
  if (!quiet) {
    showBanner(`WAVE ${n}<small>${arenaChanged && n > 1 ? 'NEW ARENA' : 'THEY ARE COMING'}</small>`, 1500);
    if (n > 1) sfx.wave();   // wave 1 is the onboarding — it starts silent
  }
  sfx.newWave();
  el.pausebtn.style.display = 'block';
  el.ammo.style.display = '';
  setTimeLocked(false);   // each wave starts at full speed in button mode
  if (n === 1) slowBank = SLOWMO.base;   // new run: fresh tank; waves carry over
  updateSlowMeter();
  updateModeUI();
}

function maxAlive() { return Math.min(2 + Math.floor(game.wave / 2), 5); }

let deathAt = 0;

function hitPlayer(ended = false) {
  if (!player.alive || (player.iframes > 0 && !ended)) return;
  player.alive = false;
  sprintTo = null;
  game.state = 'dead';
  game.stateT = 0;
  deathAt = performance.now();
  recordRun();
  el.guide.style.opacity = 0;
  el.guide.style.display = 'none';
  el.pausebtn.style.display = 'none';
  el.ammo.style.display = 'none';   // the overlay's stats line lands there
  setTimeLocked(false);
  el.timebtn.style.display = 'none';
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
    r.innerHTML = `<div class="stats">${game.wave} ${game.wave === 1 ? 'WAVE' : 'WAVES'} · ` +
      `${game.kills} SHATTERED · BEST ${bestWave} ${bestWave === 1 ? 'WAVE' : 'WAVES'}</div>`;
    r.style.display = 'flex';
    el.scores.style.display = 'none';
    el.menurow.style.display = 'none';
    el.moderow.style.display = 'none';   // keep the stats line's row clear
    el.overlay.querySelector('.go').textContent = 'TAP TO RETRY WAVE';
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
  for (let i = debris.length - 1; i >= 0; i--) { scene.remove(debris[i].mesh); debris.splice(i, 1); }
  for (let i = ripples.length - 1; i >= 0; i--) {
    scene.remove(ripples[i].mesh);
    ripples[i].mesh.material.dispose();
    ripples.splice(i, 1);
  }
  for (let i = grenades.length - 1; i >= 0; i--) {
    scene.remove(grenades[i].mesh);
    scene.remove(grenades[i].ring);
    grenades[i].ring.material.dispose();
    grenades.splice(i, 1);
  }
  for (let i = missiles.length - 1; i >= 0; i--) {
    scene.remove(missiles[i].mesh);
    missiles.splice(i, 1);
  }
  for (let i = pickups.length - 1; i >= 0; i--) removePickup(i);
}

function showGuide() {
  // the guide IS the intro — suppress the WAVE 1 banner underneath it
  clearTimeout(showBanner._t);
  el.banner.classList.remove('show');
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
  el.overlay.classList.add('hidden');
  el.redflash.style.opacity = 0;
  if (game.state === 'menu') {
    clearField();   // sweep away the attract-mode fight
    player.alive = true;
    player.pos.set(0, 0, 14);
    player.vel.set(0, 0, 0);
    player.yaw = 0; player.pitch = 0; player.roll = 0;
    player.iframes = 1;
    game.kills = 0;
    runStartAt = Date.now();
    runPlayT = 0;
    setWeapon('pistol');
    if (game.mode === 'rush') initRush(); else { startWave(1); showGuide(); }
  } else {   // retry current wave
    clearField();
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
    if (game.mode === 'rush') initRush(); else startWave(game.wave);
  }
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
    renderer.render(scene, camera);
    return;
  }

  // --- time scale: frozen while a finger is down — but time moves (a little)
  // when YOU move, so dodging costs the world a few frames
  const playing = game.state === 'play' || game.state === 'intro';
  // button mode: the bank drains in real time while locked; empty = snap back
  if (timeMode === 'toggle' && playing) {
    if (timeLocked) {
      slowBank -= dt * SLOWMO.drain;
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

  // --- player (real time)
  player.fireCd -= dt;
  player.iframes -= dt;
  input.lookIdle += dt;

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
        tvx = dirX * sm * MOVE_SPEED;
        tvz = dirZ * sm * MOVE_SPEED;
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

  // soft aim assist: slow-motion only, and only after a stretch of free
  // aiming — then it gently drifts the crosshair onto the nearest target.
  // Pitch is never corrected while you're aiming anywhere on the body column
  // (chest to top of head), so lining up headshots is never fought.
  if (player.alive && playing && enemies.length &&
      input.holding && input.lookIdle > AIM_ASSIST_DELAY) {
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
      const k = 1 - Math.exp(-AIM_ASSIST_RATE * dt);
      player.yaw += bestYawD * k;
      const pitchChest = Math.atan2(1.15 - EYE_HEIGHT, bestDist);
      const pitchHeadTop = Math.atan2(1.62 * best.g.scale.y + 0.2 - EYE_HEIGHT, bestDist);
      const lo = Math.min(pitchChest, pitchHeadTop), hi = Math.max(pitchChest, pitchHeadTop);
      if (player.pitch < lo) player.pitch += (lo - player.pitch) * k;
      else if (player.pitch > hi) player.pitch += (hi - player.pitch) * k;
    }
  }
  updateEdgeArrows(playing);

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
    gun.visible = true;
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

  // gun kick + sway
  gunKick = Math.max(0, gunKick - dt * 8);
  muzzle.material.opacity = Math.max(0, muzzle.material.opacity - dt * 14);
  const sway = Math.sin(now * 0.0011) * 0.004;
  gun.position.set(0.14 + sway, -0.19 + Math.cos(now * 0.0017) * 0.004 + gunKick * 0.03, -0.5 + gunKick * 0.06);
  gun.rotation.x = gunKick * 0.22;

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
    if (game.state === 'play' && game.spawnQueue.length > 0 && enemies.length < maxAlive()) {
      game.spawnTimer -= sdt;
      if (game.spawnTimer <= 0) {
        spawnEnemy(game.spawnQueue.shift());
        game.spawnTimer = 0.8 + Math.random() * 0.6;
      }
    }
    for (const e of enemies) updateEnemy(e, sdt);
    updateBullets(sdt);
    if (game.mode === 'rush') updateCrowd(sdt);
    updateMarks(sdt);

    if (game.mode !== 'rush' && game.state === 'play' && game.spawnQueue.length === 0 && enemies.length === 0 &&
        performance.now() >= killFlashUntil) {   // let the final kill's word land first
      game.state = 'clear';
      game.stateT = 0;
      setTimeLocked(false);   // the break runs at full speed; button resets
      vibrate(20);
      // one readable card for the whole break — the next wave starts quietly
      const next = game.wave + 1;
      const nextArena = Math.floor((next - 1) / 3) % LAYOUTS.length !== currentLayout;
      showBanner(`WAVE ${game.wave} CLEARED<small>NEXT: WAVE ${next}${nextArena ? ' · NEW ARENA' : ''}</small>`, 3300);
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
  updateDebris(sdt);
  updateRipples(sdt);
  updateGrenades(sdt);
  updateMissiles(sdt);
  updatePickups(dt, sdt);

  // --- HUD
  el.score.textContent = `WAVE ${game.wave}  ·  ${game.kills}`;
  el.tint.style.opacity = playing ? (1 - timeScale / TIME_FULL) : 0;
  document.body.classList.toggle('slowmo', playing && timeScale < 0.55);
  document.body.classList.toggle('inmenu', game.state === 'menu');
  if (game.state === 'menu') updateShimmer(now / 1000);
  sfx.update(playing || game.state === 'clear' ? timeScale : 1, dt);
  el.crosshair.classList.toggle('hot', player.fireCd > 0);

  renderer.render(scene, camera);
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
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* http or old browser */ });
}

window.__ts = {
  game, player, enemies, bullets, pickups, ripples, camera, input, obstacles,
  sprint: () => sprintTo,
  audio: () => sfx.debug(), sfx,
  slow: () => ({ bank: +slowBank.toFixed(2), locked: timeLocked, mode: timeMode }),
  fire: playerFire, setWeapon, spawnEnemy, spawnPickup,
  shot: (px, py, pz, dx, dy, dz, fromPlayer) =>
    spawnBullet(new THREE.Vector3(px, py, pz), new THREE.Vector3(dx, dy, dz).normalize(), fromPlayer),
};
