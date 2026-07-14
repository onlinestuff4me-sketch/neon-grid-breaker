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
  shotgun: { cd: 0.55, pellets: 6, spread: 0.055, ammo: 4, kick: 1.8, speed: 46 },
  sniper: { cd: 0.9, pellets: 1, spread: 0, ammo: 3, kick: 2.4, speed: 95, pierce: 3 },
};

// Soft aim assist: the camera never swings on its own — it only eases onto a
// target that's already near your crosshair. Off-screen threats get edge arrows.
const AIM_ASSIST_CONE = 0.3;      // radians off-crosshair where assist engages
const AIM_ASSIST_HOLD = 5;        // easing rate while time is frozen
const AIM_ASSIST_FREE = 2.5;      // ... and while time flows
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
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.85), MAT_BLACK);
  barrel.position.set(0, 0.02, -0.32);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.32), MAT_BLACK);
  body.position.set(0, 0, 0.05);
  const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), MAT_GUNMETAL);
  scope.position.set(0, 0.08, 0.02);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.08), MAT_BLACK);
  grip.position.set(0, -0.1, 0.14);
  grip.rotation.x = 0.3;
  sniperVM.add(barrel, body, scope, grip);
}
sniperVM.visible = false;
gun.add(pistolVM, shotgunVM, sniperVM);

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
    fromPlayer, pierce, life: 6, rippleAcc: 0, whizzed: false,
  });
}

function killBullet(i, sparkAt) {
  const b = bullets[i];
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
// Weapon pickups — shattered gunners sometimes drop a shotgun. Dash over it.
// ---------------------------------------------------------------------------
const pickups = [];   // {g, spin, ring, t, life}
const PICKUP_LIFE = 14;

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
    p.ring.material.opacity = p.life < 3 ? 0.5 * (0.4 + 0.6 * Math.abs(Math.sin(p.t * 6))) : 0.5;
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
  let egun = null;
  if (type !== 'rusher') {   // rushers come at you bare-handed
    if (type === 'sniper') {
      // the looming silhouette: a long, thin rifle with a scope
      egun = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.78), MAT_BLACK);
      barrel.position.z = -0.18;
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), MAT_BLACK);
      scope.position.set(0, 0.07, 0.02);
      egun.add(barrel, scope);
      egun.position.set(0, -0.52, -0.1);
    } else {
      const w = type === 'shotgunner' ? 0.1 : type === 'heavy' ? 0.08 : 0.06;
      const h = type === 'heavy' ? 0.11 : 0.09;
      const l = type === 'shotgunner' ? 0.36 : type === 'heavy' ? 0.42 : 0.3;
      egun = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), MAT_BLACK);
      egun.position.set(0, -0.52, -0.1);
    }
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
  return { g, legL, legR, armL, armR, egun };
}

// Per-type combat config. drop: chance of a shotgun, or a weapon name for a
// guaranteed named drop. mul: bullet speed multiplier. armored: body shots
// bounce off — only headshots kill.
const ENEMY_TYPES = {
  gunner: { speed: 2.0, scale: [1, 1, 1], drop: 0.25, aimTime: 0.55, cd: [0.9, 0.8], mul: 1, pellets: 1 },
  rusher: { speed: 3.4, scale: [0.85, 0.97, 0.85], drop: 0 },
  heavy: { speed: 1.6, scale: [1.14, 1.05, 1.14], drop: 0.6, aimTime: 0.55, cd: [1.8, 1.0], mul: 1, pellets: 1, burst: true },
  shotgunner: { speed: 1.8, scale: [1.06, 1, 1.06], drop: 0.8, aimTime: 0.65, cd: [1.6, 0.9], mul: 0.85, pellets: 5, spread: 0.09, engage: [8, 4] },
  armored: { speed: 1.4, scale: [1.1, 1.06, 1.1], drop: 0.35, aimTime: 0.6, cd: [1.2, 0.8], mul: 1, pellets: 1, armored: true },
  sniper: { speed: 1.2, scale: [0.92, 1.05, 0.92], drop: 'sniper', aimTime: 1.35, cd: [2.4, 1.0], mul: 2.3, pellets: 1, engage: [26, 4] },
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
    fireCd: (type === 'sniper' ? 1.2 : 0.15) + Math.random() * 0.35,
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
    spawnBullet(origin, d, false, spec.mul || 1);
  }
  sfx.enemyShot();
}

// snipers carry their gun as a Group — flash its barrel, not the group
function egunFlashTarget(e) {
  return e.egun.isGroup ? e.egun.children[0] : e.egun;
}

function updateEnemy(e, sdt) {
  const toPlayer = _v1.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z);
  const dist = toPlayer.length();
  toPlayer.normalize();
  e.g.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
  e.stateT += sdt;
  e.fireCd -= sdt;

  let moveSpeed = 0;

  if (dist < 1.5 && e.state !== 'melee') { e.state = 'melee'; e.stateT = 0; }

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
          performance.now() >= game.noFireBefore &&
          hasLineOfSight(_v2.set(e.pos.x, 1.35, e.pos.z), _v3.set(player.pos.x, EYE_HEIGHT - 0.3, player.pos.z))) {
        e.state = 'aim'; e.stateT = 0;
      }
      break;
    }
    case 'aim': {
      // telegraph: raise the gun arm, flash the gun white just before firing
      const spec = ENEMY_TYPES[e.type];
      const aimT = spec.aimTime;
      const t = Math.min(e.stateT / aimT, 1);
      e.armR.rotation.x = -t * (Math.PI / 2 - 0.06);
      egunFlashTarget(e).material = e.stateT > aimT * 0.7 ? MAT_WHITEFLASH : MAT_BLACK;
      if (e.stateT >= aimT) {
        enemyFire(e, toPlayer);
        egunFlashTarget(e).material = MAT_BLACK;
        if (spec.burst) {   // heavies fire a 3-round burst
          e.state = 'burst'; e.stateT = 0;
          e.burstLeft = 2; e.burstT = 0.22;
        } else {
          e.state = 'recover'; e.stateT = 0;
          e.fireCd = spec.cd[0] + Math.random() * spec.cd[1];
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
          e.fireCd = spec.cd[0] + Math.random() * spec.cd[1];
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

    // whizz: an enemy round passing near your head gets a doppler-ish whoosh
    if (!b.fromPlayer && !b.whizzed && player.alive) {
      const wx = b.pos.x - player.pos.x, wy = b.pos.y - EYE_HEIGHT, wz = b.pos.z - player.pos.z;
      if (wx * wx + wy * wy + wz * wz < 2.4 * 2.4) {
        b.whizzed = true;
        sfx.whizz();
      }
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
    const sx = (_v1.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-_v1.y * 0.5 + 0.5) * window.innerHeight;
    if (Math.hypot(sx - px, sy - py) < PICKUP_TAP_PX) return p;
  }
  return null;
}

function onPointerDown(ev) {
  ev.preventDefault();
  sfx.init();
  if (game.state === 'menu' || game.state === 'dead' || game.state === 'gameover') {
    // brief lockout after dying so panic taps don't skip the death screen
    if (game.state === 'dead' && performance.now() - deathAt < 1000) return;
    if (game.state === 'dead' && ev.target && ev.target.id === 'menubtn') {
      showMenu();
      return;
    }
    advanceFromOverlay();
    return;   // this pointer is never registered, so its release is inert
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

  function init() {
    if (ctx) {
      // 'suspended' after backgrounding, 'interrupted' on iOS — either way,
      // any user gesture should bring the sound back
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      return;
    }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = ctx.createGain();
    master.gain.value = 0.9;
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
  function tone(f0, f1, dur, gainV, type = 'square', rate = 1, send = 0.15, at = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * rate, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1 * rate, 1), t0 + dur / rate);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainV, t0);
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
    update(ts, dt) {
      if (!ctx) return;
      // slower easing = a long, audible turntable-style pitch glide
      const k = Math.min(dt * 4.5, 1);
      musicRate += ((0.3 + 0.7 * ts) - musicRate) * k;
      if (musicSrc) musicSrc.playbackRate.value = musicRate;
      if (musicFilter) musicFilter.frequency.value = 380 + 17100 * Math.pow(ts, 1.4);
      if (echoWet) echoWet.gain.value = 0.06 + (1 - ts) * 0.48;
      if (ts < 0.5 && lastTs >= 0.5) {          // plunge: deep sub-drop
        tone(170, 28, 0.8, 0.5, 'sine', 1, 0.55);
        noise(0.7, 260, 0.7, 0.22, 0.55, 0.55);
      } else if (ts >= 0.5 && lastTs < 0.5) {   // surface: bright snap
        noise(0.12, 2400, 0.9, 0.18, 1.5, 0.08);
        tone(600, 1300, 0.09, 0.1, 'triangle');
      }
      lastTs = ts;
    },
    debug() {
      return ctx ? { state: ctx.state, musicRate: +musicRate.toFixed(2), music: !!musicSrc,
        filter: musicFilter ? Math.round(musicFilter.frequency.value) : 0,
        echo: echoWet ? +echoWet.gain.value.toFixed(2) : 0 } : null;
    },
    shot(weapon) {
      const r = selfRate();
      if (weapon === 'shotgun') { noise(0.28, 550, 0.5, 0.75, r, 0.3); tone(160, 40, 0.18, 0.3, 'square', r); }
      else if (weapon === 'sniper') {   // a whip-crack with a long tail
        noise(0.09, 3200, 0.6, 0.7, r, 0.2);
        noise(0.45, 900, 0.5, 0.55, r, 0.5);
        tone(520, 45, 0.3, 0.35, 'sawtooth', r, 0.4);
      }
      else { noise(0.14, 1600, 0.7, 0.5, r, 0.25); tone(320, 70, 0.1, 0.25, 'square', r); }
    },
    clank() {   // armor shrugging off a body shot
      noise(0.06, 3200, 2.2, 0.45, 1, 0.25);
      tone(950, 320, 0.11, 0.3, 'square', 1, 0.25);
    },
    whizz() {   // an enemy round passing your head — long and cavernous when slowed
      const r = worldRate();
      const loud = 1 + (1 - timeScale) * 0.8;   // slowed bullets DOMINATE the mix
      noise(1.0, 480, 1.3, 0.55 * loud, r, 0.7);
      noise(0.7, 950, 1.8, 0.3 * loud, r, 0.6);
      tone(420, 90, 0.8, 0.22 * loud, 'sine', r, 0.6);
    },
    pickup() {   // the pump-action "shk-SHK": grab, slide back, slam forward
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
    shatter() { const r = worldRate(); noise(0.5, 2600, 0.4, 0.5, r, 0.35); noise(0.35, 4200, 0.6, 0.3, r, 0.35); },
    die() { tone(220, 40, 0.7, 0.4, 'sawtooth', 1, 0.5); noise(0.5, 400, 0.8, 0.4, 1, 0.5); },
    wave() { tone(440, 880, 0.18, 0.2, 'triangle'); },
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

// Mix of enemy types for wave n: rushers from wave 2, shotgunners from 3,
// heavies + one sniper from 4, armored (headshot-only) from 5.
function composeWave(n) {
  const total = Math.min(1 + n, 12);
  const queue = [];
  if (n >= 2) for (let i = 0; i < Math.floor(total / 3); i++) queue.push('rusher');
  if (n >= 3) for (let i = 0; i < Math.floor(total / 4); i++) queue.push('shotgunner');
  if (n >= 4) for (let i = 0; i < Math.floor(total / 4); i++) queue.push('heavy');
  if (n >= 5) for (let i = 0; i < Math.floor(total / 5); i++) queue.push('armored');
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

const el = {
  overlay: document.getElementById('overlay'),
  score: document.getElementById('score'),
  menubtn: document.getElementById('menubtn'),
  flash: document.getElementById('flash'),
  banner: document.getElementById('banner'),
  tint: document.getElementById('tint'),
  redflash: document.getElementById('redflash'),
  crosshair: document.getElementById('crosshair'),
  hint: document.getElementById('hint'),
  ammo: document.getElementById('ammo'),
  stickBase: document.getElementById('stickbase'),
  stickNub: document.getElementById('sticknub'),
  warn: document.getElementById('warn'),
  guide: document.getElementById('guide'),
};

// the title screen's original copy, so MAIN MENU can restore it after a death
const MENU_HTML = {
  h1: el.overlay.querySelector('h1').innerHTML,
  sub: el.overlay.querySelector('.sub').innerHTML,
  rules: el.overlay.querySelector('.rules').innerHTML,
  go: el.overlay.querySelector('.go').innerHTML,
};

function showMenu() {
  clearField();
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
  el.overlay.querySelector('h1').innerHTML = MENU_HTML.h1;
  el.overlay.querySelector('.sub').innerHTML = MENU_HTML.sub;
  el.overlay.querySelector('.rules').innerHTML = MENU_HTML.rules;
  el.overlay.querySelector('.go').innerHTML = MENU_HTML.go;
  el.menubtn.style.display = 'none';
  el.redflash.style.opacity = 0;
  el.overlay.classList.remove('hidden');
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

let killWordFlip = false;
function killWord() {
  killWordFlip = !killWordFlip;
  const span = document.createElement('span');
  span.className = 'killword';
  span.textContent = killWordFlip ? 'TIME' : 'SHARD';
  el.flash.innerHTML = '';
  el.flash.appendChild(span);
  setTimeout(() => { if (span.parentNode) span.remove(); }, 650);
}

function showBanner(html, dur = 1600) {
  el.banner.innerHTML = html;
  el.banner.classList.add('show');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.banner.classList.remove('show'), dur);
}

function startWave(n) {
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
  showBanner(`WAVE ${n}<small>${arenaChanged && n > 1 ? 'NEW ARENA' : 'THEY ARE COMING'}</small>`, 1500);
  sfx.wave();
}

function maxAlive() { return Math.min(2 + Math.floor(game.wave / 2), 5); }

let deathAt = 0;

function hitPlayer() {
  if (!player.alive || player.iframes > 0) return;
  player.alive = false;
  sprintTo = null;
  game.state = 'dead';
  game.stateT = 0;
  deathAt = performance.now();
  el.redflash.style.opacity = 1;
  sfx.die();
  vibrate([60, 40, 120]);
  setTimeout(() => {
    if (game.state !== 'dead') return;   // already retried — don't resurrect the overlay
    el.overlay.querySelector('h1').innerHTML = 'YOU<br><em>DIED</em>';
    el.overlay.querySelector('.sub').textContent = 'ONE HIT IS ALL IT TAKES';
    el.overlay.querySelector('.rules').innerHTML =
      `<div class="stats">WAVE ${game.wave} · ${game.kills} SHATTERED · BEST WAVE ${bestWave}</div>`;
    el.overlay.querySelector('.go').textContent = 'TAP TO RETRY WAVE';
    el.menubtn.style.display = 'inline-block';
    el.overlay.classList.remove('hidden');
  }, 900);
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
  for (let i = pickups.length - 1; i >= 0; i--) removePickup(i);
}

function showGuide() {
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
  if (game.state === 'menu') target = 0;
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
    player.pos.x += player.vel.x * dt;
    player.pos.z += player.vel.z * dt;
    resolvePlayerCollisions();
  }

  // soft aim assist: never swings the camera on its own — only eases onto the
  // enemy already closest to your crosshair, and yields to your look drags
  if (player.alive && playing && enemies.length && input.lookIdle > 0.3) {
    let best = null, bestAng = AIM_ASSIST_CONE, bestYawD = 0, bestPitch = 0;
    for (const e of enemies) {
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const dist = Math.max(Math.hypot(dx, dz), 0.001);
      let dYaw = Math.atan2(-dx, -dz) - player.yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const wantPitch = Math.atan2(1.15 - EYE_HEIGHT, dist);
      const ang = Math.hypot(dYaw, wantPitch - player.pitch);
      if (ang < bestAng) { bestAng = ang; best = e; bestYawD = dYaw; bestPitch = wantPitch; }
    }
    if (best) {
      const k = 1 - Math.exp(-(input.holding ? AIM_ASSIST_HOLD : AIM_ASSIST_FREE) * dt);
      player.yaw += bestYawD * k;
      player.pitch += (bestPitch - player.pitch) * k;
    }
  }
  updateEdgeArrows(playing);

  // subtle lean into strafes — sells the dodge
  const velRight = player.vel.x * Math.cos(player.yaw) + player.vel.z * -Math.sin(player.yaw);
  player.roll += (-velRight / MOVE_SPEED * 0.05 - player.roll) * Math.min(dt * 8, 1);

  camera.position.set(player.pos.x, EYE_HEIGHT, player.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.rotation.z = player.roll;

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

    if (game.state === 'play' && game.spawnQueue.length === 0 && enemies.length === 0) {
      game.state = 'clear';
      game.stateT = 0;
      showBanner(`WAVE ${game.wave} CLEAR<small>TIME · SHARD · TIME · SHARD</small>`, 2000);
    }
  } else if (game.state === 'clear') {
    updateBullets(sdt);
    game.stateT += dt;
    if (game.stateT > 2.2) startWave(game.wave + 1);
  } else if (game.state === 'dead') {
    for (const e of enemies) updateEnemy(e, sdt);
    updateBullets(sdt);
  }
  updateDebris(sdt);
  updateRipples(sdt);
  updatePickups(dt, sdt);

  // --- HUD
  el.score.textContent = `WAVE ${game.wave}  ·  ${game.kills}`;
  el.tint.style.opacity = playing ? (1 - timeScale / TIME_FULL) : 0;
  document.body.classList.toggle('slowmo', playing && timeScale < 0.55);
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
