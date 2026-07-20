// TIMESHARD — a first-person time-manipulation arcade shooter for portrait mobile.
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

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
  new THREE.MeshLambertMaterial({ map: makeFloorTexture() })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

for (let i = 0; i < 4; i++) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(ARENA_HALF * 2 + 1, 5, 0.5), MAT_WHITE);
  const a = (i * Math.PI) / 2;
  wall.position.set(Math.sin(a) * (ARENA_HALF + 0.25), 2.5, Math.cos(a) * (ARENA_HALF + 0.25));
  wall.rotation.y = a;
  scene.add(wall);
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

function resolvePlayerCollisions() {
  const p = player.pos;
  const lim = ARENA_HALF - 0.6;
  p.x = Math.min(Math.max(p.x, -lim), lim);
  p.z = Math.min(Math.max(p.z, -lim), lim);
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
        Math.abs(m.pos.x) > ARENA_HALF || Math.abs(m.pos.z) > ARENA_HALF) {
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
// Enemies — red boxy humanoids. States: advance -> aim -> fire, melee up close.
// ---------------------------------------------------------------------------
const enemies = [];

function buildEnemyMesh(type) {
  const g = new THREE.Group();
  // armored units are gunmetal with a bright red head — the head is the target
  const bodyMat = type === 'armored' ? MAT_GUNMETAL
    : (type === 'rusher' || type === 'sniper') ? MAT_DARKRED : MAT_RED;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.26), bodyMat);
  torso.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), MAT_RED);
  head.position.y = 1.62;
  if (type === 'armored') head.scale.setScalar(1.25);
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.24), type === 'armored' ? MAT_GUNMETAL : MAT_DARKRED);
  hips.position.y = 0.74;

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.64, 0.17), bodyMat);
  legL.geometry = legL.geometry.clone();
  legL.geometry.translate(0, -0.32, 0);
  legL.position.set(-0.11, 0.66, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.13), bodyMat);
  armL.geometry = armL.geometry.clone();
  armL.geometry.translate(0, -0.25, 0);
  armL.position.set(-0.29, 1.4, 0);

  // gun arm: pivots at the shoulder, raises to horizontal when aiming
  const armR = new THREE.Group();
  armR.position.set(0.29, 1.4, 0);
  const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.13), bodyMat);
  armRMesh.position.y = -0.25;
  armR.add(armRMesh);
  // Guns live in the gun arm's local space, where -y runs from the shoulder
  // down the arm and out past the hand. Barrels extend along -y, so when the
  // arm raises to horizontal the barrel points straight at the player —
  // every gun reads as grip + receiver + barrel, not a floating handle.
  let egun = null;
  if (type === 'bomber') {   // a grenade in the throwing hand
    egun = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), MAT_BLACK);
    egun.position.set(0, -0.52, -0.05);
    armR.add(egun);
  } else if (type !== 'rusher') {   // rushers come at you bare-handed
    egun = new THREE.Group();
    const addBarrel = (len, thick, x = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(thick, len, thick), MAT_BLACK);
      m.position.set(x, -0.62 - len / 2, 0);
      egun.add(m);   // first barrel added = the flash target
      return m;
    };
    if (type === 'sniper') {
      addBarrel(0.55, 0.04);
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.045), MAT_GUNMETAL);
      scope.position.set(0, -0.62, 0.08);
      egun.add(scope);
    } else if (type === 'shotgunner') {
      // mirrors the player's shotgun: touching side-by-side barrels and a
      // straight stock. Each barrel splits 70/30 so the muzzle tips (the far
      // 30%) can light up on the firing telegraph.
      const mkBarrel = (x) => {
        const rear = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.294, 0.045), MAT_BLACK);
        rear.position.set(x, -0.62 - 0.147, 0);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.126, 0.045), MAT_BLACK);
        tip.position.set(x, -0.62 - 0.294 - 0.063, 0);
        egun.add(rear, tip);
        return tip;
      };
      egun.userData.flash = [mkBarrel(-0.0225), mkBarrel(0.0225)];
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.075), MAT_BLACK);
      stock.position.set(0, -0.4, 0);
      egun.add(stock);
    } else if (type === 'heavy') {
      addBarrel(0.32, 0.07);
    } else if (type === 'rocketeer') {   // a fat launch tube
      addBarrel(0.44, 0.12);
    } else {   // gunner, armored, shieldbearer: a pistol
      addBarrel(0.2, 0.05);
    }
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.1), MAT_BLACK);
    receiver.position.set(0, -0.55, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.13), MAT_BLACK);
    grip.position.set(0, -0.49, 0.08);
    egun.add(receiver, grip);
    armR.add(egun);
  }

  // fake blob shadow to ground them without real-time shadow maps
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 16),
    new THREE.MeshBasicMaterial({ color: 0x16181d, transparent: true, opacity: 0.14 })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;

  g.add(torso, head, hips, legL, legR, armL, armR, blob);
  if (type === 'bomber') {   // grenadier's backpack
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.2), MAT_BLACK);
    pack.position.set(0, 1.12, -0.26);
    g.add(pack);
  }
  if (type === 'shieldbearer') {   // riot shield held toward the player
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.5, 0.07), MAT_GUNMETAL);
    shield.position.set(0, 0.95, 0.44);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.02), MAT_RED);
    slit.position.set(0, 1.35, 0.49);
    g.add(shield, slit);
  }
  return { g, legL, legR, armL, armR, egun };
}

// Per-type combat config. drop: chance of a shotgun (shotgunners only — you
// loot what they carry), or a weapon name for a guaranteed named drop.
// mul: bullet speed multiplier. armored: body shots
// bounce off — only headshots kill.
const ENEMY_TYPES = {
  gunner: { speed: 2.0, scale: [1, 1, 1], drop: 0, aimTime: 0.55, cd: [0.9, 0.8], mul: 1, pellets: 1 },
  rusher: { speed: 3.4, scale: [0.85, 0.97, 0.85], drop: 0 },
  heavy: { speed: 1.6, scale: [1.14, 1.05, 1.14], drop: 0, aimTime: 0.55, cd: [1.8, 1.0], mul: 1, pellets: 1, burst: 3 },
  shotgunner: { speed: 1.8, scale: [1.06, 1, 1.06], drop: 0.8, aimTime: 0.65, cd: [1.6, 0.9], mul: 0.85, pellets: 5, spread: 0.09, engage: [8, 4] },
  armored: { speed: 1.4, scale: [1.1, 1.06, 1.1], drop: 0, aimTime: 0.6, cd: [1.2, 0.8], mul: 1, pellets: 1, armored: true },
  sniper: { speed: 1.2, scale: [0.92, 1.05, 0.92], drop: 'sniper', aimTime: 1.35, cd: [2.4, 1.0], mul: 2.3, pellets: 1, engage: [26, 4] },
  bomber: { speed: 1.7, scale: [1.05, 1, 1.05], drop: 0, aimTime: 0.8, cd: [2.4, 1.2], mul: 1, pellets: 1, engage: [9, 5] },
  shieldbearer: { speed: 1.5, scale: [1.08, 1, 1.08], drop: 0, aimTime: 0.7, cd: [1.6, 1.0], mul: 1, pellets: 1, shielded: true },
  rocketeer: { speed: 1.4, scale: [1.05, 1.02, 1.05], drop: 0, aimTime: 1.0, cd: [3.4, 1.4], mul: 1, pellets: 1, engage: [13, 6] },
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
  enemies.push({
    ...parts,
    type,
    speed: spec.speed,
    pos: parts.g.position,
    state: 'advance',
    stateT: 0,
    walkPhase: Math.random() * Math.PI * 2,
    strafe: Math.random() < 0.5 ? 1 : -1,
    strafeT: 1 + Math.random() * 2,
    fireCd: ((type === 'sniper' ? 1.2 : 0.15) + Math.random() * 0.35) * aimSpeedFactor(),
    engageDist: spec.engage
      ? spec.engage[0] + Math.random() * spec.engage[1]
      : 15 + Math.random() * 6,           // open fire from range, not point-blank
    burstLeft: 0,
    burstT: 0,
    alive: true,
  });
  if (type === 'sniper') {
    warnFlash(['SNIPER.']);
    sfx.wave();
  }
}

function killEnemy(i, impulseDir) {
  const e = enemies[i];
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
  const tips = e.egun.isGroup && e.egun.userData.flash;
  if (tips) {
    for (const t of tips) t.material = mat;
    return;
  }
  (e.egun.isGroup ? e.egun.children[0] : e.egun).material = mat;
}

// Enemies get on the trigger faster as waves progress: a touch quicker at
// wave 1 (x0.95), down to x0.6 telegraphs and cooldowns by wave ~8.
function aimSpeedFactor() {
  return Math.max(0.6, 0.95 - (game.wave - 1) * 0.05);
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
    const maxTurn = 1.1 * sdt;
    e.g.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, dYaw));
  } else {
    e.g.rotation.y = wantYaw;
  }
  e.stateT += sdt;
  e.fireCd -= sdt;

  let moveSpeed = 0;

  // a burst, once started, always completes — no melee interrupt mid-volley
  if (dist < 1.5 && e.state !== 'melee' && e.state !== 'burst') { e.state = 'melee'; e.stateT = 0; }

  switch (e.state) {
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
      const lim = ARENA_HALF - 1;
      e.pos.x = Math.min(Math.max(e.pos.x, -lim), lim);
      e.pos.z = Math.min(Math.max(e.pos.z, -lim), lim);

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
      e.armR.rotation.x = -t * (Math.PI / 2 - 0.06);
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
      // relax whichever arm is out of position back toward rest
      e.armR.rotation.x = Math.min(0, e.armR.rotation.x + sdt * 4.5);
      e.armL.rotation.x = Math.min(0, e.armL.rotation.x + sdt * 6);
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

  // walk cycle
  if (moveSpeed > 0) {
    e.walkPhase += sdt * 9;
    const sw = Math.sin(e.walkPhase) * 0.6;
    e.legL.rotation.x = sw;
    e.legR.rotation.x = -sw;
    e.armL.rotation.x = -sw * 0.5;
  } else {
    e.legL.rotation.x *= 0.9;
    e.legR.rotation.x *= 0.9;
  }
}

const MAT_WHITEFLASH = new THREE.MeshBasicMaterial({ color: 0xffffff });

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
        Math.abs(b.pos.x) > ARENA_HALF || Math.abs(b.pos.z) > ARENA_HALF) {
      killBullet(i, b.pos.y <= 0.05 ? b.pos : null);
      continue;
    }

    let hit = false;
    for (const o of obstacles) {
      const t = segAABB(b.prev, b.pos, o);
      if (t >= 0) {
        killBullet(i, _v2.lerpVectors(b.prev, b.pos, t));
        hit = true;
        break;
      }
    }
    if (hit) continue;

    if (b.fromPlayer) {
      let consumed = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
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
          // the riot shield eats anything arriving from the front — flank him
          const fx = Math.sin(e.g.rotation.y), fz = Math.cos(e.g.rotation.y);   // shield faces this way
          const bl = Math.max(Math.hypot(b.vel.x, b.vel.z), 1e-6);
          const frontal = (b.vel.x / bl) * fx + (b.vel.z / bl) * fz < -0.35;
          if (frontal) {
            spawnSparks(b.pos, 0xf4f5f7);
            sfx.clank();
            consumed = true;
            break;
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
  ev.preventDefault();
  sfx.init();
  if (el.htp.style.display === 'flex') {   // how-to modal open
    el.htp.style.display = 'none';
    if (ev.target && ev.target.closest && ev.target.closest('#enmlink')) {
      el.enm.style.display = 'flex';   // hop over to the enemies page
    }
    return;
  }
  if (el.enm.style.display === 'flex') {   // enemies modal open
    el.enm.style.display = 'none';
    if (ev.target && ev.target.closest && ev.target.closest('#enmback')) {
      el.htp.style.display = 'flex';   // back to how-to
    }
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
        el.htp.style.display = 'flex';
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
    advanceFromOverlay();
    return;   // this pointer is never registered, so its release is inert
  }
  if (ev.target && ev.target.closest && ev.target.closest('#endrun')) {
    hitPlayer(true);   // walk away: same screen as death, gentler framing
    return;            // never registered, so its release is inert
  }
  input.pointers.set(ev.pointerId, {
    sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY,
    ox: ev.clientX, oy: ev.clientY, role: null, downT: performance.now(),
  });
  input.holding = true;
}

function onPointerMove(ev) {
  const p = input.pointers.get(ev.pointerId);
  if (!p) return;
  ev.preventDefault();
  const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
  p.x = ev.clientX; p.y = ev.clientY;
  if (!p.role && Math.hypot(p.x - p.sx, p.y - p.sy) > TAP_PX) {
    p.role = p.sx < window.innerWidth * 0.5 ? 'move' : 'look';
    p.ox = p.x; p.oy = p.y;         // the stick anchors where the drag begins
    if (p.role === 'move') sprintTo = null;   // manual move cancels a sprint
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
    const w = window.innerWidth;
    player.yaw -= (dx / w) * LOOK_SENS;
    player.pitch -= (dy / w) * LOOK_SENS;
    player.pitch = Math.min(Math.max(player.pitch, -1.2), 1.2);
    input.lookIdle = 0;
  }
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

function onPointerUp(ev) {
  sfx.init();   // some browsers only allow audio resume on the gesture's END
  releasePointer(ev, true);
}
function onPointerCancel(ev) { releasePointer(ev, false); }

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

function vibrate(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
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
  let echoIn = null, echoWet = null;
  let musicSrc = null, musicGain = null, musicFilter = null;
  let musicRate = 1, lastTs = 1, building = false;
  let muted = false;
  try { muted = localStorage.getItem('timeshard_muted') === '1'; } catch { /* private mode */ }

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
    time: ['assets/sfx/time.mp3', 2.6],
    shard: ['assets/sfx/shard.mp3', 2.6],
  };
  const sampleFetch = {};
  const samples = {};
  for (const [name, [url]] of Object.entries(SAMPLE_SRC)) {
    sampleFetch[name] = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  }
  let shatterIdx = 0;      // the three glass breaks cycle so kills never repeat
  let surfaceBuf = null;   // the time plunge, reversed — played when time resumes
  let resumeRetryT = 0;    // throttle for stuck-context resume attempts
  let whooshBuf = null;    // shared 2s noise loop for all bullet whooshes
  let whooshCount = 0;
  const WHOOSH_MAX = 12;   // concurrent whoosh voices — plenty, and bounded
  let voUntilMs = 0;       // a voice line is playing until then — never overlap
  let waveVoEndMs = 0;     // when the wave-intro VO finishes
  let waveWords = 0;       // kill words spoken this wave (max 2: TIME then SHARD)

  // returns the played duration in seconds (truthy), or false if no sample
  function playSample(name, { rate = 1, send = 0.2, gainMul = 1, fadeAfter = 0 } = {}) {
    const s = samples[name];
    if (!ctx || !s) return false;
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = s.gain * gainMul;
    src.connect(g);
    route(g, send);
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
    // feedback echo bus — dry at full speed, cavernous in bullet time
    echoIn = ctx.createGain();
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
        .then((buf) => { if (buf) samples[name] = { buf, gain: gainV }; })
        .catch(() => { /* keep the synth fallback */ });
    }
    buildSurface();
  }

  // Render the slow-mo plunge offline, then flip it: the same sound played
  // backwards becomes the "time resuming" cue.
  async function buildSurface() {
    try {
      const off = new OfflineAudioContext(1, Math.ceil(ctx.sampleRate * 1.1), ctx.sampleRate);
      const o = off.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(170, 0);
      o.frequency.exponentialRampToValueAtTime(28, 0.8);
      const og = off.createGain();
      og.gain.setValueAtTime(0.5, 0);
      og.gain.exponentialRampToValueAtTime(0.0001, 0.8);
      o.connect(og); og.connect(off.destination);
      o.start(0); o.stop(0.85);
      const n = Math.floor(off.sampleRate * 0.7);
      const nb = off.createBuffer(1, n, off.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < n; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const ns = off.createBufferSource();
      ns.buffer = nb;
      ns.playbackRate.value = 0.55;
      const nf = off.createBiquadFilter();
      nf.type = 'bandpass'; nf.frequency.value = 260; nf.Q.value = 0.7;
      const ng = off.createGain();
      ng.gain.value = 0.22;
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
      musicGain.gain.setTargetAtTime(0.26, ctx.currentTime, 1.2);   // fade in
    } catch { /* keep SFX even if music fails */ }
  }

  // --- one-shot helpers, routed through the sfx bus + echo send
  function route(g, send) {
    g.connect(sfxBus);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s); s.connect(echoIn);
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
    newWave() { waveWords = 0; },   // called at wave start: re-arm TIME + SHARD
    say() {
      // The announcer speaks exactly twice per wave — TIME for the first
      // eligible kill, SHARD for the next — and never talks over itself or
      // the wave VO (the first word also waits 5s after the wave VO ends).
      // Returns the word spoken (the kill flash shows only when it did).
      if (muted) return null;
      const now = performance.now();
      if (waveWords >= 2) return null;
      if (waveWords === 0 && now < waveVoEndMs + 5000) return null;
      if (now < voUntilMs) return null;
      const key = waveWords === 0 ? 'time' : 'shard';
      const d = playSample(key, { send: 0.25 });
      if (d) {
        waveWords++;
        voUntilMs = now + d * 1000 + 150;
        return key.toUpperCase();
      }
      if (!('speechSynthesis' in window)) return null;
      try {   // TTS fallback, same quota rules
        const u = new SpeechSynthesisUtterance(key + '.');
        u.rate = 0.75;
        u.pitch = 0.3;
        u.volume = 1;
        lastUtter = u;   // hold the reference — GC'd utterances go silent
        speechSynthesis.speak(u);
        waveWords++;
        voUntilMs = now + 1200;
        return key.toUpperCase();
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
        const want = game.state === 'menu' ? 0 : 1;
        sfxBus.gain.value += (want - sfxBus.gain.value) * Math.min(dt * 8, 1);
      }
      // slower easing = a long, audible turntable-style pitch glide
      const k = Math.min(dt * 4.5, 1);
      musicRate += ((0.3 + 0.7 * ts) - musicRate) * k;
      if (musicSrc) musicSrc.playbackRate.value = musicRate;
      if (musicFilter) musicFilter.frequency.value = 380 + 17100 * Math.pow(ts, 1.4);
      if (echoWet) echoWet.gain.value = 0.06 + (1 - ts) * 0.48;
      if (ts < 0.5 && lastTs >= 0.5) {          // plunge: deep sub-drop
        tone(170, 28, 0.8, 0.5, 'sine', 1, 0.55, 0, 0.05);   // soft onset — no click
        noise(0.7, 260, 0.7, 0.22, 0.55, 0.55);
      } else if (ts >= 0.5 && lastTs < 0.5) {   // surface: the plunge, reversed
        if (surfaceBuf) {
          const src = ctx.createBufferSource();
          src.buffer = surfaceBuf;
          const g = ctx.createGain();
          g.gain.value = 0.9;
          src.connect(g);
          route(g, 0.25);
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
    clank() {   // armor shrugging off a body shot
      noise(0.06, 3200, 2.2, 0.45, 1, 0.25);
      tone(950, 320, 0.11, 0.3, 'square', 1, 0.25);
    },
    // --- per-bullet whoosh: every enemy round carries a looping bed of surf
    // noise. Volume tracks your live distance to the round; pitch rides a
    // doppler shift, so it climbs as it closes and sinks as it passes.
    attachWhoosh() {
      if (!ctx || whooshCount >= WHOOSH_MAX) return null;
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
      g.connect(send); send.connect(echoIn);
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
      const want = isFinite(dist) ? 0.05 + 0.45 * Math.pow(prox, 5) : 0;
      const k = 0.25;   // per-frame smoothing — no zipper, quick response
      h.g.gain.value += (want - h.g.gain.value) * k;
      // doppler kicks in only once it's PAST you: neutral on approach, then
      // the tail sinks hard and drowns in the echo as it recedes
      const receding = vr < 0;
      const dopp = receding ? Math.max(0.35, 1 + (vr * timeScale) / 18) : 1;
      const rate = (0.4 + 0.6 * timeScale) * dopp;
      h.src.playbackRate.value += (rate - h.src.playbackRate.value) * k;
      h.send.gain.value += ((receding ? 1.0 : 0.2) - h.send.gain.value) * k;
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
    pickup() {   // the pump-action rack when you grab a gun
      if (playSample('pickup', { send: 0.12 })) return;
      noise(0.035, 1900, 1.4, 0.5, 1, 0.08, 0);
      noise(0.1, 750, 0.9, 0.5, 1, 0.12, 0.09);
      noise(0.05, 2500, 1.6, 0.65, 1, 0.15, 0.21);
      tone(230, 150, 0.09, 0.35, 'square', 1, 0.1, 0.21);
    },
    enemyShot() {
      const r = worldRate();
      const loud = 1 + (1 - timeScale) * 0.7;
      noise(0.2, 700, 0.8, 0.55 * loud, r, 0.5);
      tone(190, 45, 0.16, 0.3 * loud, 'square', r, 0.45);
    },
    shatter() {   // heavy glass breaks, cycling 1-2-3 so kills never repeat
      const r = worldRate();
      shatterIdx = (shatterIdx % 3) + 1;
      // heavy echo send so kills ring out like the rest of the world
      if (playSample('shatter' + shatterIdx, { rate: r, send: 0.65, fadeAfter: 2.0 })) return;
      noise(0.5, 2600, 0.4, 0.5, r, 0.35); noise(0.35, 4200, 0.6, 0.3, r, 0.35);
    },
    die() {   // slowed way down: a long, deep grind as the run ends
      tone(220, 30, 0.9, 0.4, 'sawtooth', 0.55, 0.5);
      noise(0.6, 400, 0.8, 0.4, 0.5, 0.5);
    },
    wave() {   // the wave VO, played the moment its banner card appears
      const now = performance.now();
      const d = playSample('nextwave', { rate: 0.8, send: 0.25 });
      if (!d) tone(440, 880, 0.18, 0.2, 'triangle');
      waveVoEndMs = now + (d ? d * 1000 : 400);
      voUntilMs = Math.max(voUntilMs, waveVoEndMs);
    },
    lob() { const r = worldRate(); noise(0.16, 420, 1.1, 0.28, r, 0.3); },
    rocket() { const r = worldRate(); noise(0.5, 600, 0.7, 0.5, r, 0.5); tone(240, 90, 0.4, 0.2, 'sawtooth', r, 0.4); },
    boom() {
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
    e.at = Date.now();
  } else {
    runs.unshift({ id: runStartAt, w: game.wave, k: game.kills, at: Date.now() });
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
  display.sort((a, b) => (b[scoreMetric] - a[scoreMetric]) || (b.at - a.at));
  const unit = (v) => (scoreMetric === 'w' ? (v === 1 ? 'WAVE' : 'WAVES') : (v === 1 ? 'ENEMY' : 'ENEMIES'));
  const rows = display.slice(0, 5).map((r) =>
    `<div class="scrow"><span class="scval">${r[scoreMetric]}<em>${unit(r[scoreMetric])}</em></span>` +
    `<span class="scdate">${fmtWhen(r.at)}</span></div>`).join('');
  el.scores.innerHTML =
    '<div class="schead">TOP RUNS</div>' +
    `<div class="scpills">` +
    `<span class="scpill${scoreMetric === 'w' ? ' active' : ''}" data-m="w">WAVES</span>` +
    `<span class="scpill${scoreMetric === 'k' ? ' active' : ''}" data-m="k">ENEMIES</span>` +
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
  if (n >= 4) queue.push('sniper');
  queue.length = Math.min(queue.length, total);
  while (queue.length < total) queue.push('gunner');
  for (let i = queue.length - 1; i > 0; i--) {   // shuffle
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue;
}

let timeScale = 1;
let demoT = 0, demoSpawnT = 0.3, demoKillT = 4;   // menu attract-mode clocks

const el = {
  overlay: document.getElementById('overlay'),
  score: document.getElementById('score'),
  menubtn: document.getElementById('menubtn'),
  endrun: document.getElementById('endrun'),
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
};
renderScores();

// swap the h1's plain SHARD for the faceted polygon wordmark BEFORE the menu
// snapshot below, so MAIN MENU restores the styled title too
{
  const tw = Math.min(Math.round(window.innerWidth * 0.84), 330);
  const built = buildWordSVG('SHARD', Math.round(tw * 100 / 464));
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
  el.endrun.style.display = 'none';
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
  el.overlay.querySelector('.sub').innerHTML = MENU_HTML.sub;
  el.overlay.querySelector('.rules').innerHTML = MENU_HTML.rules;
  el.overlay.querySelector('.go').innerHTML = MENU_HTML.go;
  el.overlay.querySelector('.rules').style.display = 'none';
  el.menurow.style.display = 'flex';
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

const KILLFLASH_MS = 1300;       // long enough for the recorded word to land
let killFlashUntil = 0;          // wave-clear waits for the last flash to finish

function killWord() {
  // the flash appears only when the announcer actually speaks the word —
  // first two eligible kills of a wave — so sight and sound always agree
  if (game.state === 'menu') return;
  const word = sfx.say();
  if (!word) return;
  const { svg } = buildWordSVG(word, 58);   // faceted letterforms, no shimmer
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
    for (let i = pickups.length - 1; i >= 0; i--) removePickup(i);
  }
  if (!quiet) {
    showBanner(`WAVE ${n}<small>${arenaChanged && n > 1 ? 'NEW ARENA' : 'THEY ARE COMING'}</small>`, 1500);
    if (n > 1) sfx.wave();   // wave 1 is the onboarding — it starts silent
  }
  sfx.newWave();
  el.endrun.style.display = 'block';
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
  el.endrun.style.display = 'none';
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
    r.innerHTML = `<div class="stats">${game.wave} WAVES · ${game.kills} SHATTERED · BEST ${bestWave} WAVES</div>`;
    r.style.display = 'flex';
    el.scores.style.display = 'none';
    el.menurow.style.display = 'none';
    el.overlay.querySelector('.go').textContent = 'TAP TO RETRY WAVE';
    el.menubtn.style.display = 'inline-block';
    el.overlay.classList.remove('hidden');
  }, ended ? 400 : 900);
}

function clearField() {
  for (let i = enemies.length - 1; i >= 0; i--) { scene.remove(enemies[i].g); enemies.splice(i, 1); }
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
    setWeapon('pistol');
    startWave(1);
    showGuide();
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
    startWave(game.wave);
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

  // --- time scale: frozen while a finger is down — but time moves (a little)
  // when YOU move, so dodging costs the world a few frames
  const playing = game.state === 'play' || game.state === 'intro';
  let target = TIME_FULL;
  if (playing && input.holding) {
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
  if (player.alive && playing) {
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

    if (game.state === 'play' && game.spawnQueue.length === 0 && enemies.length === 0 &&
        performance.now() >= killFlashUntil) {   // let the final kill's word land first
      game.state = 'clear';
      game.stateT = 0;
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
window.__ts = {
  game, player, enemies, bullets, pickups, ripples, camera, input,
  sprint: () => sprintTo,
  audio: () => sfx.debug(),
  fire: playerFire, setWeapon, spawnEnemy, spawnPickup,
  shot: (px, py, pz, dx, dy, dz, fromPlayer) =>
    spawnBullet(new THREE.Vector3(px, py, pz), new THREE.Vector3(dx, dy, dz).normalize(), fromPlayer),
};
