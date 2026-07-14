// TIMESHARD — a SUPERHOT-inspired first-person arcade shooter for portrait mobile.
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

const TIME_SLOW = 0.05;           // time scale while finger is down
const TIME_FULL = 1.0;
const TIME_EASE = 14;             // easing rate between the two

const PLAYER_BULLET_SPEED = 46;
const ENEMY_BULLET_SPEED = 11;    // slow enough to see coming and dodge
const BULLET_GRAVITY = 4;         // gentle drop, visible on long shots
const FIRE_COOLDOWN = 0.22;       // real-time seconds between player shots

const DASH_SPEED = 13;
const DASH_DECAY = 7.5;           // exponential decay rate of dash velocity
const DASH_COOLDOWN = 0.9;
const DASH_IFRAMES = 0.28;        // brief invulnerability at the start of a dash

const TAP_MAX_MS = 220;
const TAP_MAX_PX = 12;
const FLICK_MIN_SPEED = 1.05;     // px per ms, measured over the last ~90ms
const FLICK_MIN_PX = 48;

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
const obstacles = [];
function addBlock(x, z, w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT_WHITE);
  m.position.set(x, h / 2, z);
  scene.add(m);
  obstacles.push({
    min: new THREE.Vector3(x - w / 2, 0, z - d / 2),
    max: new THREE.Vector3(x + w / 2, h, z + d / 2),
  });
}
addBlock(-7, -6, 3.2, 2.6, 1.4);
addBlock(8, -8, 1.6, 3.4, 1.6);
addBlock(6, 5, 4.0, 2.2, 1.4);
addBlock(-9, 7, 1.6, 3.8, 1.6);
addBlock(0, -13, 5.0, 2.0, 1.4);
addBlock(-2, 12, 1.6, 3.0, 1.6);
addBlock(13, -1, 1.4, 2.8, 3.6);
addBlock(-14, -2, 1.4, 2.4, 3.6);

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
  yaw: 0,                     // yaw 0 looks down -Z, toward the arena center
  pitch: 0,
  dashVel: new THREE.Vector3(),
  dashCd: 0,
  iframes: 0,
  fireCd: 0,
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
// Viewmodel pistol (black, boxy) + muzzle flash
// ---------------------------------------------------------------------------
const gun = new THREE.Group();
{
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.34), MAT_BLACK);
  slide.position.set(0, 0.02, -0.1);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), MAT_BLACK);
  grip.position.set(0, -0.09, 0.03);
  grip.rotation.x = 0.28;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.1), MAT_BLACK);
  guard.position.set(0, -0.035, -0.05);
  gun.add(slide, grip, guard);
}
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

// ---------------------------------------------------------------------------
// Bullets — simple projectile physics with swept capsule collision
// ---------------------------------------------------------------------------
const bullets = [];   // {mesh, trail, pos, vel, prev, fromPlayer, life}
const bulletGeo = new THREE.SphereGeometry(0.04, 8, 8);
const bulletMatP = new THREE.MeshBasicMaterial({ color: 0x16181d });
const bulletMatE = new THREE.MeshBasicMaterial({ color: 0xff2d1a });

function spawnBullet(pos, dir, fromPlayer) {
  const mesh = new THREE.Mesh(bulletGeo, fromPlayer ? bulletMatP : bulletMatE);
  mesh.position.copy(pos);
  if (!fromPlayer) mesh.scale.setScalar(1.7);   // enemy shots read bigger = dodgeable
  scene.add(mesh);
  // tracer line so hanging bullets are legible in frozen time
  const trailGeo = new THREE.BufferGeometry().setFromPoints([pos.clone(), pos.clone()]);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    color: fromPlayer ? 0x16181d : 0xff2d1a, transparent: true, opacity: 0.35,
  }));
  scene.add(trail);
  bullets.push({
    mesh, trail,
    pos: pos.clone(), prev: pos.clone(),
    vel: dir.clone().multiplyScalar(fromPlayer ? PLAYER_BULLET_SPEED : ENEMY_BULLET_SPEED),
    fromPlayer, life: 6,
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
// Enemies — red boxy humanoids. States: advance -> aim -> fire, melee up close.
// ---------------------------------------------------------------------------
const enemies = [];

function buildEnemyMesh() {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.26), MAT_RED);
  torso.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), MAT_RED);
  head.position.y = 1.62;
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.24), MAT_DARKRED);
  hips.position.y = 0.74;

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.64, 0.17), MAT_RED);
  legL.geometry.translate(0, -0.32, 0);
  legL.position.set(-0.11, 0.66, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.13), MAT_RED);
  armL.geometry.translate(0, -0.25, 0);
  armL.position.set(-0.29, 1.4, 0);

  // gun arm: pivots at the shoulder, raises to horizontal when aiming
  const armR = new THREE.Group();
  armR.position.set(0.29, 1.4, 0);
  const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.13), MAT_RED);
  armRMesh.position.y = -0.25;
  const egun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.3), MAT_BLACK);
  egun.position.set(0, -0.52, -0.1);
  armR.add(armRMesh, egun);

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

function spawnEnemy() {
  const parts = buildEnemyMesh();
  // spawn on the arena rim, away from the player, outside cover
  let x, z;
  for (let tries = 0; tries < 20; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = ARENA_HALF - 2.5;
    x = Math.cos(a) * r; z = Math.sin(a) * r;
    if (_v1.set(x - player.pos.x, 0, z - player.pos.z).lengthSq() > 100) break;
  }
  parts.g.position.set(x, 0, z);
  scene.add(parts.g);
  enemies.push({
    ...parts,
    pos: parts.g.position,
    state: 'advance',
    stateT: 0,
    walkPhase: Math.random() * Math.PI * 2,
    strafe: Math.random() < 0.5 ? 1 : -1,
    strafeT: 1 + Math.random() * 2,
    fireCd: 0.8 + Math.random() * 1.2,
    engageDist: 7 + Math.random() * 6,
    alive: true,
  });
}

function killEnemy(i, impulseDir) {
  const e = enemies[i];
  spawnShatter(e.pos, impulseDir);
  scene.remove(e.g);
  enemies.splice(i, 1);
  game.kills++;
  killWord();
  sfx.shatter();
  vibrate(30);
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
      moveSpeed = 2.0;
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

      if (dist < e.engageDist && e.fireCd <= 0 &&
          hasLineOfSight(_v2.set(e.pos.x, 1.35, e.pos.z), _v3.set(player.pos.x, EYE_HEIGHT - 0.3, player.pos.z))) {
        e.state = 'aim'; e.stateT = 0;
      }
      break;
    }
    case 'aim': {
      // telegraph: raise the gun arm, flash the gun white just before firing
      const t = Math.min(e.stateT / 0.55, 1);
      e.armR.rotation.x = -t * (Math.PI / 2 - 0.06);
      e.egun.material = e.stateT > 0.38 ? MAT_WHITEFLASH : MAT_BLACK;
      if (e.stateT >= 0.55) {
        const origin = _v2.set(e.pos.x, 1.35, e.pos.z).addScaledVector(toPlayer, 0.45);
        const target = _v3.set(
          player.pos.x + (Math.random() - 0.5) * 0.7,
          EYE_HEIGHT - 0.25 + (Math.random() - 0.5) * 0.4,
          player.pos.z + (Math.random() - 0.5) * 0.7
        );
        spawnBullet(origin, target.sub(origin).normalize(), false);
        sfx.enemyShot();
        e.egun.material = MAT_BLACK;
        e.state = 'recover'; e.stateT = 0;
        e.fireCd = 1.5 + Math.random() * 1.3;
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
  player.fireCd = FIRE_COOLDOWN;
  camera.getWorldDirection(_dir);
  // fire from the gun muzzle, converging on the crosshair ~30m out, so the
  // bullet doesn't hang in front of the lens when time is frozen
  camera.updateMatrixWorld();
  const origin = muzzle.getWorldPosition(new THREE.Vector3());
  const aimPoint = camera.position.clone().addScaledVector(_dir, 30);
  spawnBullet(origin, aimPoint.sub(origin).normalize(), true);
  gunKick = 1;
  muzzle.material.opacity = 1;
  sfx.shot();
  vibrate(12);
}

function updateBullets(sdt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.prev.copy(b.pos);
    b.vel.y -= BULLET_GRAVITY * sdt;
    b.pos.addScaledVector(b.vel, sdt);
    b.life -= sdt;
    b.mesh.position.copy(b.pos);

    // trail stretches behind the bullet, longer at speed
    const tp = b.trail.geometry.attributes.position.array;
    const back = _v1.copy(b.vel).normalize().multiplyScalar(-Math.min(b.vel.length() * 0.05, 1.2));
    tp[0] = b.pos.x + back.x; tp[1] = b.pos.y + back.y; tp[2] = b.pos.z + back.z;
    tp[3] = b.pos.x; tp[4] = b.pos.y; tp[5] = b.pos.z;
    b.trail.geometry.attributes.position.needsUpdate = true;

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
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        _v2.set(e.pos.x, 0.15, e.pos.z);
        _v3.set(e.pos.x, 1.76, e.pos.z);
        if (segSegDistSq(b.prev, b.pos, _v2, _v3) < 0.34 * 0.34) {
          const impulse = _v1.copy(b.vel).normalize();
          killBullet(i, null);
          killEnemy(j, impulse);
          hit = true;
          break;
        }
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
// Input — Pointer Events: one primary finger drives everything
// ---------------------------------------------------------------------------
const input = {
  primaryId: null,
  holding: false,
  downTime: 0,
  totalMove: 0,
  history: [],          // recent {t, x, y} samples for flick detection
};

const LOOK_SENS = 3.0;  // radians of yaw per full screen-width drag

function onPointerDown(ev) {
  ev.preventDefault();
  sfx.init();
  if (game.state === 'menu' || game.state === 'dead' || game.state === 'gameover') {
    advanceFromOverlay();
    return;
  }
  if (input.primaryId === null) {
    input.primaryId = ev.pointerId;
    input.holding = true;
    input.downTime = performance.now();
    input.totalMove = 0;
    input.history = [{ t: performance.now(), x: ev.clientX, y: ev.clientY }];
  } else {
    playerFire();   // second finger taps fire while the first holds time frozen
  }
}

function onPointerMove(ev) {
  if (ev.pointerId !== input.primaryId) return;
  ev.preventDefault();
  const now = performance.now();
  const last = input.history[input.history.length - 1];
  const dx = ev.clientX - last.x;
  const dy = ev.clientY - last.y;
  input.totalMove += Math.abs(dx) + Math.abs(dy);
  input.history.push({ t: now, x: ev.clientX, y: ev.clientY });
  if (input.history.length > 24) input.history.shift();

  const w = window.innerWidth;
  player.yaw -= (dx / w) * LOOK_SENS;
  player.pitch -= (dy / w) * LOOK_SENS;
  player.pitch = Math.min(Math.max(player.pitch, -1.35), 1.35);
}

function onPointerUp(ev) {
  if (ev.pointerId !== input.primaryId) return;
  ev.preventDefault();
  const now = performance.now();
  const held = now - input.downTime;

  if (held < TAP_MAX_MS && input.totalMove < TAP_MAX_PX) {
    playerFire();
  } else {
    // flick? measure velocity over the trailing ~90ms of the gesture
    let j = input.history.length - 1;
    while (j > 0 && now - input.history[j - 1].t < 90) j--;
    const a = input.history[j];
    const b = input.history[input.history.length - 1];
    const dt = Math.max(now - a.t, 1);
    const fx = b.x - a.x, fy = b.y - a.y;
    const d = Math.hypot(fx, fy);
    if (d / dt > FLICK_MIN_SPEED && d > FLICK_MIN_PX) tryDash(fx, fy);
  }
  input.primaryId = null;
  input.holding = false;
}

function tryDash(screenX, screenY) {
  if (player.dashCd > 0 || !player.alive || game.state !== 'play') return;
  player.dashCd = DASH_COOLDOWN;
  player.iframes = DASH_IFRAMES;
  // map screen flick to world direction relative to where you're looking:
  // flick up = forward, flick left = strafe left, etc.
  const len = Math.hypot(screenX, screenY);
  const fx = screenX / len, fy = screenY / len;
  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  const fwd = { x: -sinY, z: -cosY };
  const right = { x: cosY, z: -sinY };
  player.dashVel.set(
    (right.x * fx + fwd.x * -fy) * DASH_SPEED,
    0,
    (right.z * fx + fwd.z * -fy) * DASH_SPEED
  );
  sfx.dash();
  vibrate(18);
}

renderer.domElement.style.touchAction = 'none';
window.addEventListener('pointerdown', onPointerDown, { passive: false });
window.addEventListener('pointermove', onPointerMove, { passive: false });
window.addEventListener('pointerup', onPointerUp, { passive: false });
window.addEventListener('pointercancel', onPointerUp, { passive: false });
window.addEventListener('contextmenu', (e) => e.preventDefault());

function vibrate(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// ---------------------------------------------------------------------------
// Audio — tiny synthesized SFX via WebAudio (no assets)
// ---------------------------------------------------------------------------
const sfx = (() => {
  let ctx = null;
  function init() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function noise(dur, freq, q, gainV, rate = 1) {
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
    src.connect(filt).connect(g).connect(ctx.destination);
    src.start();
  }
  function tone(f0, f1, dur, gainV, type = 'square') {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainV, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  }
  return {
    init,
    shot() { noise(0.14, 1600, 0.7, 0.5); tone(320, 70, 0.1, 0.25); },
    enemyShot() { const r = 0.6 + timeScale * 0.4; noise(0.18, 700, 0.8, 0.4, r); tone(180, 50, 0.14, 0.2); },
    shatter() { noise(0.5, 2600, 0.4, 0.5); noise(0.35, 4200, 0.6, 0.3); },
    dash() { noise(0.22, 900, 1.5, 0.35, 0.8); },
    die() { tone(220, 40, 0.7, 0.4, 'sawtooth'); noise(0.5, 400, 0.8, 0.4); },
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
  toSpawn: 0,
  spawnTimer: 0,
  stateT: 0,
};

let timeScale = 1;

const el = {
  overlay: document.getElementById('overlay'),
  score: document.getElementById('score'),
  timefill: document.getElementById('timefill'),
  flash: document.getElementById('flash'),
  banner: document.getElementById('banner'),
  tint: document.getElementById('tint'),
  redflash: document.getElementById('redflash'),
  crosshair: document.getElementById('crosshair'),
  hint: document.getElementById('hint'),
};

let killWordFlip = false;
function killWord() {
  killWordFlip = !killWordFlip;
  const span = document.createElement('span');
  span.className = 'killword';
  span.textContent = killWordFlip ? 'SUPER' : 'HOT';
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
  game.toSpawn = Math.min(1 + n, 12);
  game.spawnTimer = 0;
  showBanner(`WAVE ${n}<small>THEY ARE COMING</small>`, 1500);
  sfx.wave();
}

function maxAlive() { return Math.min(2 + Math.floor(game.wave / 2), 5); }

function hitPlayer() {
  if (!player.alive || player.iframes > 0) return;
  player.alive = false;
  game.state = 'dead';
  game.stateT = 0;
  el.redflash.style.opacity = 1;
  sfx.die();
  vibrate([60, 40, 120]);
  setTimeout(() => {
    el.overlay.querySelector('h1').innerHTML = 'YOU<br><em>DIED</em>';
    el.overlay.querySelector('.sub').textContent = 'ONE HIT IS ALL IT TAKES';
    el.overlay.querySelector('.rules').innerHTML =
      `<div class="stats">WAVE ${game.wave} · ${game.kills} SHATTERED</div>`;
    el.overlay.querySelector('.go').textContent = 'TAP TO RETRY WAVE';
    el.overlay.classList.remove('hidden');
  }, 900);
}

function clearField() {
  for (let i = enemies.length - 1; i >= 0; i--) { scene.remove(enemies[i].g); enemies.splice(i, 1); }
  for (let i = bullets.length - 1; i >= 0; i--) killBullet(i, null);
  for (let i = debris.length - 1; i >= 0; i--) { scene.remove(debris[i].mesh); debris.splice(i, 1); }
}

function advanceFromOverlay() {
  el.overlay.classList.add('hidden');
  el.redflash.style.opacity = 0;
  if (game.state === 'menu') {
    startWave(1);
  } else {   // retry current wave
    clearField();
    player.alive = true;
    player.pos.set(0, 0, 14);
    player.yaw = 0; player.pitch = 0;
    player.dashVel.set(0, 0, 0);
    player.iframes = 1;
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

  // --- time scale: frozen while a finger is down, full speed otherwise
  const playing = game.state === 'play' || game.state === 'intro';
  let target = TIME_FULL;
  if (playing && input.holding) target = TIME_SLOW;
  if (game.state === 'dead') target = 0.12;
  if (game.state === 'menu') target = 0;
  timeScale += (target - timeScale) * Math.min(dt * TIME_EASE, 1);
  const sdt = dt * timeScale;   // scaled dt: the world's clock

  // --- player (real time)
  player.fireCd -= dt;
  player.dashCd -= dt;
  player.iframes -= dt;
  if (player.dashVel.lengthSq() > 0.01) {
    player.pos.addScaledVector(player.dashVel, dt);
    player.dashVel.multiplyScalar(Math.exp(-DASH_DECAY * dt));
    resolvePlayerCollisions();
  }

  camera.position.set(player.pos.x, EYE_HEIGHT, player.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

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
      if (game.stateT > 1.2) game.state = 'play';
    }
    if (game.state === 'play' && game.toSpawn > 0 && enemies.length < maxAlive()) {
      game.spawnTimer -= sdt;
      if (game.spawnTimer <= 0) {
        spawnEnemy();
        game.toSpawn--;
        game.spawnTimer = 1.2 + Math.random();
      }
    }
    for (const e of enemies) updateEnemy(e, sdt);
    updateBullets(sdt);

    if (game.state === 'play' && game.toSpawn === 0 && enemies.length === 0) {
      game.state = 'clear';
      game.stateT = 0;
      showBanner(`WAVE ${game.wave} CLEAR<small>SUPER · HOT · SUPER · HOT</small>`, 2000);
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

  // --- HUD
  el.score.textContent = `WAVE ${game.wave}  ·  ${game.kills}`;
  el.timefill.style.width = `${Math.round(timeScale * 100)}%`;
  el.timefill.classList.toggle('slow', timeScale < 0.5);
  el.tint.style.opacity = playing ? (1 - timeScale / TIME_FULL) * 0.9 : 0;
  el.crosshair.classList.toggle('hot', player.fireCd > 0);

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Pause the world clock while backgrounded so nothing "catches up" on return.
document.addEventListener('visibilitychange', () => { lastT = performance.now(); });

// Debug hook for automated tests.
window.__ts = {
  game, player, enemies, bullets, camera, fire: playerFire,
  shot: (px, py, pz, dx, dy, dz, fromPlayer) =>
    spawnBullet(new THREE.Vector3(px, py, pz), new THREE.Vector3(dx, dy, dz).normalize(), fromPlayer),
};
