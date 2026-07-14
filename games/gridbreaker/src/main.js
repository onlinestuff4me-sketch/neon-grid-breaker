// ============================================================================
// GRIDBREAKER — main game.
// Endless Smash-Hit-style runner: the camera flies down a TRON corridor,
// taps hurl chrome balls (real cannon-es rigid bodies), glass shatters into
// physical shards, crystals refill ammo, streaks earn multiball.
// ============================================================================

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TUNING, PALETTE } from './config.js';
import { weeklySeed, weekId } from '../../../shared/rng.js';
import { createScoreStore } from '../../../shared/scores.js';
import { LevelGen } from './levelgen.js';
import { SynthAudio } from './audio.js';

const scores = createScoreStore('gridbreaker');
const weeklyTag = () => `gridbreaker/v${TUNING.weekly.generatorVersion}`;

// ---------------------------------------------------------------------------
// Collision groups
// ---------------------------------------------------------------------------
const G_BALL = 1, G_GLASS = 2, G_SHARD = 4, G_WORLD = 8;

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.fog, TUNING.corridor.fogNear, TUNING.corridor.fogFar);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, TUNING.corridor.eyeHeight, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Synthwave sky: procedural equirect canvas → background + reflections
// ---------------------------------------------------------------------------
function makeSkyTexture() {
  const w = 1024, h = 512;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#12042e');
  grad.addColorStop(0.42, '#0a0220');
  grad.addColorStop(0.5, '#1b0533');
  grad.addColorStop(0.52, '#05010f');
  grad.addColorStop(1, '#02000a');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // stars
  for (let i = 0; i < 240; i++) {
    const y = Math.random() * h * 0.45;
    g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`;
    g.fillRect(Math.random() * w, y, 1.5, 1.5);
  }

  // two suns so a bright disc sits both ahead and behind for reflections
  for (const cx of [w * 0.25, w * 0.75]) {
    const cy = h * 0.472, r = 30;
    const sg = g.createRadialGradient(cx, cy, 2, cx, cy, r * 1.9);
    sg.addColorStop(0, 'rgba(255,170,235,0.7)');
    sg.addColorStop(0.45, 'rgba(255,80,200,0.28)');
    sg.addColorStop(1, 'rgba(255,47,214,0)');
    g.fillStyle = sg;
    g.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    const dg = g.createLinearGradient(0, cy - r, 0, cy + r);
    dg.addColorStop(0, '#ffd9f4'); dg.addColorStop(0.55, '#ff5ecb'); dg.addColorStop(1, '#ff9d3f');
    g.fillStyle = dg;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    // retro scanline slits across the lower half of the sun
    g.fillStyle = '#0a0220';
    for (let i = 0; i < 5; i++) {
      const yy = cy + 3 + i * 6;
      g.fillRect(cx - r, yy, r * 2, 1.6 + i * 0.7);
    }
    g.restore();
  }

  // horizon glow line
  const hg = g.createLinearGradient(0, h * 0.47, 0, h * 0.53);
  hg.addColorStop(0, 'rgba(0,234,255,0)');
  hg.addColorStop(0.5, 'rgba(0,234,255,0.75)');
  hg.addColorStop(1, 'rgba(0,234,255,0)');
  g.fillStyle = hg;
  g.fillRect(0, h * 0.47, w, h * 0.06);

  // distant city light streaks
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w;
    const hh = 4 + Math.random() * 26;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,234,255,0.35)' : 'rgba(255,47,214,0.3)';
    g.fillRect(x, h * 0.5 - hh, 1.6, hh);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const sky = makeSkyTexture();
scene.background = sky;
scene.environment = sky;
// (equirect u=0.25 faces -Z, so a sun sits straight down the corridor)

scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x1a0533, 0.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
keyLight.position.set(2, 6, 3);
scene.add(keyLight);

// ---------------------------------------------------------------------------
// Neon grid shader (floor + walls), world-locked lines with manual fog
// ---------------------------------------------------------------------------
function gridMaterial(mode) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMode: { value: mode }, // 0 floor (xz), 1 wall (zy)
      uMinor: { value: new THREE.Color(PALETTE.gridCyan) },
      uMajor: { value: new THREE.Color(PALETTE.gridMagenta) },
      uBase: { value: new THREE.Color(0x040112) },
      uFog: { value: new THREE.Color(PALETTE.fog) },
      uFogNear: { value: TUNING.corridor.fogNear },
      uFogFar: { value: TUNING.corridor.fogFar },
      uCam: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vW;
      uniform int uMode;
      uniform vec3 uMinor, uMajor, uBase, uFog, uCam;
      uniform float uFogNear, uFogFar;
      float lineAt(vec2 p, float spacing, float width) {
        vec2 q = p / spacing;
        vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * width);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        vec2 p = uMode == 0 ? vW.xz : vW.zy;
        float minor = lineAt(p, 2.0, 1.4);
        float major = lineAt(p, 16.0, 2.2);
        vec3 col = uBase + uMinor * minor * 0.9 + uMajor * major * 1.1;
        float d = distance(vW, uCam);
        float f = smoothstep(uFogNear, uFogFar, d);
        col = mix(col, uFog, f);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

const floorMat = gridMaterial(0);
const wallMat = gridMaterial(1);
const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(64, 300), floorMat);
floorMesh.rotation.x = -Math.PI / 2;
scene.add(floorMesh);
const wallL = new THREE.Mesh(new THREE.PlaneGeometry(300, 14), wallMat);
wallL.rotation.y = Math.PI / 2;
wallL.position.set(-TUNING.corridor.halfWidth - 0.55, 7, 0);
scene.add(wallL);
const wallR = wallL.clone();
wallR.rotation.y = -Math.PI / 2;
wallR.position.x = TUNING.corridor.halfWidth + 0.55;
scene.add(wallR);

// glowing rim strips where walls meet the floor
const rimMat = new THREE.MeshBasicMaterial({ color: PALETTE.gridCyan });
const rimL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 300), rimMat);
rimL.position.set(-TUNING.corridor.halfWidth - 0.5, 0.04, 0);
scene.add(rimL);
const rimR = rimL.clone();
rimR.position.x = TUNING.corridor.halfWidth + 0.5;
scene.add(rimR);

// ---------------------------------------------------------------------------
// Physics world
// ---------------------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, TUNING.balls.gravity, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;

const matGround = new CANNON.Material('ground');
const matBall = new CANNON.Material('ball');
const matShard = new CANNON.Material('shard');
world.addContactMaterial(new CANNON.ContactMaterial(matGround, matBall, { restitution: 0.55, friction: 0.25 }));
world.addContactMaterial(new CANNON.ContactMaterial(matGround, matShard, { restitution: 0.28, friction: 0.5 }));

const floorBody = new CANNON.Body({
  type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: matGround,
  collisionFilterGroup: G_WORLD, collisionFilterMask: G_BALL | G_SHARD,
});
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);

const removeQueue = [];
function queueRemove(body) { removeQueue.push(body); }
function flushRemovals() {
  while (removeQueue.length) world.removeBody(removeQueue.pop());
}

// ---------------------------------------------------------------------------
// Shared materials / geometry
// ---------------------------------------------------------------------------
const glassMat = new THREE.MeshPhysicalMaterial({
  color: PALETTE.glass, metalness: 0.1, roughness: 0.06,
  transparent: true, opacity: 0.32, side: THREE.DoubleSide,
  envMapIntensity: 1.8, depthWrite: false,
  emissive: 0x0d3340, emissiveIntensity: 0.5,
});
const shardMat = new THREE.MeshPhysicalMaterial({
  color: PALETTE.glass, metalness: 0.15, roughness: 0.05,
  transparent: true, opacity: 0.6, side: THREE.DoubleSide, envMapIntensity: 2.0,
});
const edgeMat = new THREE.LineBasicMaterial({ color: PALETTE.glassEdge, transparent: true, opacity: 0.9 });
const ballMat3 = new THREE.MeshStandardMaterial({
  color: PALETTE.chrome, metalness: 1.0, roughness: 0.06, envMapIntensity: 2.2,
});
const ballGeo = new THREE.SphereGeometry(TUNING.balls.radius, 20, 14);
const shardGeo = new THREE.BoxGeometry(1, 1, 1);
const crystalGeo = new THREE.OctahedronGeometry(0.4);
const crystalMat = new THREE.MeshStandardMaterial({
  color: PALETTE.crystal, emissive: PALETTE.crystal, emissiveIntensity: 0.9,
  metalness: 0.3, roughness: 0.25,
});

function makeGlowTexture(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  rg.addColorStop(0, inner);
  rg.addColorStop(0.4, outer);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glowTexGreen = makeGlowTexture('rgba(255,255,255,0.9)', 'rgba(37,255,200,0.5)');
const glowTexCyan = makeGlowTexture('rgba(255,255,255,0.9)', 'rgba(0,234,255,0.45)');

// ---------------------------------------------------------------------------
// Impact sparks (pooled additive sprites)
// ---------------------------------------------------------------------------
const sparks = [];
const sparkMat = new THREE.SpriteMaterial({
  map: glowTexCyan, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
});
function spawnSpark(pos, scale = 1.6, color = null) {
  let s = sparks.find((sp) => sp.life <= 0);
  if (!s) {
    s = { sprite: new THREE.Sprite(sparkMat.clone()), life: 0 };
    scene.add(s.sprite);
    sparks.push(s);
  }
  s.sprite.material.opacity = 1;
  s.sprite.material.color.set(color || 0xffffff);
  s.sprite.position.copy(pos);
  s.sprite.scale.setScalar(scale * 0.4);
  s.life = 0.28;
  s.maxScale = scale;
}
function updateSparks(dt) {
  for (const s of sparks) {
    if (s.life <= 0) { s.sprite.visible = false; continue; }
    s.life -= dt;
    const t = 1 - Math.max(0, s.life) / 0.28;
    s.sprite.visible = true;
    s.sprite.scale.setScalar(0.4 * s.maxScale + t * s.maxScale);
    s.sprite.material.opacity = 1 - t;
  }
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const S = {
  mode: 'menu',            // menu | playing | dead
  camZ: 0,
  distance: 0,
  smashPoints: 0,
  score: 0,
  balls: TUNING.balls.start,
  multiTier: 1,            // balls per throw
  crystalStreak: 0,        // 0..streakPerTier progress toward next tier
  combo: 1,
  lastBreakTime: -99,
  roomIndex: 0,
  nextRoomZ: -6,
  speed: TUNING.speed.base,
  shakeT: 0,
  deadTimer: 0,
  time: 0,
};

let levelGen = new LevelGen(weeklySeed(weeklyTag()));
const panes = [];     // live glass panes
const crystals = [];
const balls = [];
const shards = [];
const audio = new SynthAudio();

// ---------------------------------------------------------------------------
// Glass panes
// ---------------------------------------------------------------------------
const PANE_T = 0.07;

function spawnPane(spec, worldZ) {
  const geo = new THREE.BoxGeometry(spec.w, spec.h, PANE_T);
  const mesh = new THREE.Mesh(geo, glassMat);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
  mesh.add(edges);
  mesh.position.set(spec.x, spec.y, worldZ);
  scene.add(mesh);

  const body = new CANNON.Body({
    type: CANNON.Body.KINEMATIC,
    shape: new CANNON.Box(new CANNON.Vec3(spec.w / 2, spec.h / 2, PANE_T / 2)),
    position: new CANNON.Vec3(spec.x, spec.y, worldZ),
    collisionFilterGroup: G_GLASS,
    collisionFilterMask: G_BALL,
  });
  world.addBody(body);

  const pane = {
    mesh, body, geo,
    w: spec.w, h: spec.h,
    x0: spec.x, y0: spec.y, z: worldZ,
    blocking: spec.blocking,
    motion: spec.motion,
    broken: false,
  };
  body.gb = { pane };
  panes.push(pane);
  return pane;
}

function disposePane(pane) {
  scene.remove(pane.mesh);
  pane.geo.dispose();
  pane.mesh.children[0]?.geometry.dispose();
  queueRemove(pane.body);
}

// Radial-ish jittered grid fracture. Returns shards with real physics bodies.
function shatterPane(pane, impactWorld, ballVel) {
  if (pane.broken) return;
  pane.broken = true;
  pane.body.collisionResponse = false;
  queueRemove(pane.body);
  scene.remove(pane.mesh);
  pane.geo.dispose();

  const C = TUNING.shatter;
  const rng = Math.random;
  const cols = C.cols, rows = C.rows;
  const cw = pane.w / cols, ch = pane.h / rows;
  const q = pane.mesh.quaternion.clone();
  const paneVel = pane.motion ? paneVelocity(pane) : new THREE.Vector3();

  const local = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = (rng() - 0.5) * C.jitter * cw;
      const jy = (rng() - 0.5) * C.jitter * ch;
      local.set(-pane.w / 2 + cw * (c + 0.5) + jx, -pane.h / 2 + ch * (r + 0.5) + jy, 0);
      const worldPos = local.clone().applyQuaternion(q).add(pane.mesh.position);

      const dir = worldPos.clone().sub(impactWorld);
      const dist = Math.max(0.15, dir.length());
      dir.normalize();
      const power = C.impulse / (1 + dist * C.impulseFalloff);
      const vel = new THREE.Vector3(
        dir.x * power + ballVel.x * C.inheritBall,
        dir.y * power + Math.abs(ballVel.y) * 0.1 + 0.6,
        dir.z * power + ballVel.z * C.inheritBall
      ).add(paneVel);

      spawnShard(worldPos, q, cw * (0.55 + rng() * 0.4), ch * (0.55 + rng() * 0.4), vel);
    }
  }

  spawnSpark(impactWorld, 2.4);
  audio.shatter(Math.min(1.5, 0.7 + pane.w * pane.h * 0.08));

  // scoring + combo
  if (S.mode === 'playing') {
    const now = S.time;
    S.combo = now - S.lastBreakTime < TUNING.score.comboWindow
      ? Math.min(TUNING.score.comboMax, S.combo + 1) : 1;
    S.lastBreakTime = now;
    S.smashPoints += TUNING.score.glassPane * S.combo;
    if (S.combo > 1) showCombo(S.combo);
  }
}

function paneVelocity(pane) {
  // finite-difference velocity for moving panes so shards inherit motion
  const m = pane.motion;
  if (!m) return new THREE.Vector3();
  if (m.kind === 'slide') {
    const t = S.time * m.speed + m.phase;
    return new THREE.Vector3(Math.cos(t) * m.speed * m.range, 0, 0);
  }
  return new THREE.Vector3();
}

function spawnShard(pos, quat, w, h, vel) {
  // Cap live shard bodies: fade the oldest early instead of exploding perf.
  while (shards.length >= TUNING.shatter.maxShardBodies) {
    const old = shards.shift();
    scene.remove(old.mesh);
    old.mesh.material.dispose();
    queueRemove(old.body);
  }
  const mesh = new THREE.Mesh(shardGeo, shardMat.clone());
  mesh.scale.set(w, h, PANE_T);
  mesh.position.copy(pos);
  mesh.quaternion.copy(quat);
  scene.add(mesh);

  const body = new CANNON.Body({
    mass: 0.18,
    shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, PANE_T / 2)),
    position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    quaternion: new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w),
    velocity: new CANNON.Vec3(vel.x, vel.y, vel.z),
    angularVelocity: new CANNON.Vec3(
      (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
    material: matShard,
    collisionFilterGroup: G_SHARD,
    collisionFilterMask: G_WORLD,
  });
  world.addBody(body);
  shards.push({ mesh, body, ttl: TUNING.shatter.ttl });
}

// ---------------------------------------------------------------------------
// Crystals
// ---------------------------------------------------------------------------
function spawnCrystal(spec, worldZ) {
  const mesh = new THREE.Mesh(crystalGeo, crystalMat);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexGreen, blending: THREE.AdditiveBlending, transparent: true,
    depthWrite: false, opacity: 0.9,
  }));
  glow.scale.setScalar(2.0);
  mesh.add(glow);
  mesh.position.set(spec.x, spec.y, worldZ);
  scene.add(mesh);

  const body = new CANNON.Body({
    type: CANNON.Body.KINEMATIC,
    shape: new CANNON.Box(new CANNON.Vec3(0.42, 0.42, 0.42)),
    position: new CANNON.Vec3(spec.x, spec.y, worldZ),
    collisionFilterGroup: G_GLASS,
    collisionFilterMask: G_BALL,
  });
  world.addBody(body);

  const crystal = { mesh, body, z: worldZ, y0: spec.y, collected: false, missed: false };
  body.gb = { crystal };
  crystals.push(crystal);
}

function collectCrystal(crystal, impactWorld) {
  if (crystal.collected) return;
  crystal.collected = true;
  crystal.body.collisionResponse = false;
  queueRemove(crystal.body);
  scene.remove(crystal.mesh);

  S.balls += TUNING.crystal.ballBonus;
  S.smashPoints += TUNING.crystal.scoreBonus;
  S.crystalStreak += 1;
  audio.crystal();
  spawnSpark(impactWorld, 3.2, PALETTE.crystal);

  if (S.crystalStreak >= TUNING.multiball.streakPerTier &&
      S.multiTier < TUNING.multiball.maxPerThrow) {
    S.multiTier += 1;
    S.crystalStreak = 0;
    audio.multiballUp();
    showMsg(`MULTIBALL ×${S.multiTier}`, 'neon-cyan');
    flash('rgba(0,234,255,0.25)', 300);
  }
  updateHUD();
}

function missCrystal(crystal) {
  crystal.missed = true;
  if (S.multiTier > 1 || S.crystalStreak > 0) {
    S.multiTier = 1;
    S.crystalStreak = 0;
    showMsg('CHAIN BROKEN', 'neon-pink');
    updateHUD();
  }
}

// ---------------------------------------------------------------------------
// Balls
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function throwBalls(clientX, clientY) {
  if (S.balls <= 0) return;
  const n = Math.min(S.multiTier, S.balls);
  S.balls -= n;

  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const dir = raycaster.ray.direction.clone();
  // aim at the point where the ray crosses a plane `aimDistance` ahead
  const t = TUNING.balls.aimDistance / Math.max(0.2, -dir.z);
  const target = camera.position.clone().add(dir.multiplyScalar(t));

  const right = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * TUNING.multiball.spread;
    const origin = camera.position.clone()
      .add(new THREE.Vector3(0, -0.42, -0.5))
      .add(right.clone().multiplyScalar(off * 0.5));
    const vel = target.clone()
      .add(right.clone().multiplyScalar(off * 2.2))
      .sub(origin).normalize().multiplyScalar(TUNING.balls.throwSpeed);
    spawnBall(origin, vel);
  }
  audio.throw();
  S.shakeT = Math.max(S.shakeT, 0.08);
  updateHUD();
}

function spawnBall(pos, vel) {
  while (balls.length >= TUNING.balls.maxLive) disposeBall(balls.shift());

  const mesh = new THREE.Mesh(ballGeo, ballMat3);
  mesh.position.copy(pos);
  scene.add(mesh);
  const body = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Sphere(TUNING.balls.radius),
    position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    velocity: new CANNON.Vec3(vel.x, vel.y, vel.z),
    material: matBall,
    collisionFilterGroup: G_BALL,
    collisionFilterMask: G_GLASS | G_WORLD,
  });
  body.gb = { ball: true, prevVel: new CANNON.Vec3(vel.x, vel.y, vel.z) };
  body.addEventListener('collide', onBallCollide);
  world.addBody(body);
  balls.push({ mesh, body, age: 0 });
}

function disposeBall(b) {
  scene.remove(b.mesh);
  queueRemove(b.body);
}

function onBallCollide(e) {
  const self = e.target, other = e.body;
  if (!other.gb) return;
  const cp = new CANNON.Vec3();
  (e.contact.bi === self ? e.contact.bi : e.contact.bj).position.vadd(
    e.contact.bi === self ? e.contact.ri : e.contact.rj, cp);
  const impact = new THREE.Vector3(cp.x, cp.y, cp.z);
  const pv = self.gb.prevVel;
  const ballVel = new THREE.Vector3(pv.x, pv.y, pv.z);

  if (other.gb.pane && !other.gb.pane.broken) {
    shatterPane(other.gb.pane, impact, ballVel);
    // smash-through: restore most of the pre-impact velocity
    self.velocity.set(pv.x * 0.86, pv.y * 0.86, pv.z * 0.86);
  } else if (other.gb.crystal && !other.gb.crystal.collected) {
    collectCrystal(other.gb.crystal, impact);
    self.velocity.set(pv.x * 0.9, pv.y * 0.9, pv.z * 0.9);
  }
}

// ---------------------------------------------------------------------------
// Level streaming
// ---------------------------------------------------------------------------
function streamRooms() {
  while (S.nextRoomZ > S.camZ - TUNING.corridor.horizon) {
    const room = levelGen.nextRoom(S.roomIndex);
    for (const item of room.items) {
      const z = S.nextRoomZ - item.z;
      if (item.type === 'pane') spawnPane(item, z);
      else if (item.type === 'crystal') spawnCrystal(item, z);
    }
    S.nextRoomZ -= room.length;
    S.roomIndex += 1;
    S.speed = Math.min(TUNING.speed.max, TUNING.speed.base + S.roomIndex * TUNING.speed.perRoom);
  }
}

function cleanupBehind() {
  const behind = S.camZ + 9;
  for (let i = panes.length - 1; i >= 0; i--) {
    if (panes[i].z > behind) {
      if (!panes[i].broken) disposePane(panes[i]);
      panes.splice(i, 1);
    }
  }
  for (let i = crystals.length - 1; i >= 0; i--) {
    const c = crystals[i];
    if (!c.collected && !c.missed && c.z > S.camZ + 0.5) missCrystal(c);
    if (c.z > behind) {
      if (!c.collected) { scene.remove(c.mesh); queueRemove(c.body); }
      crystals.splice(i, 1);
    }
  }
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    if (b.body.position.z > S.camZ + 4 || b.body.position.z < S.camZ - 130 || b.age > 8) {
      disposeBall(b);
      balls.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Crash detection: player box vs unbroken blocking panes crossing the camera
// ---------------------------------------------------------------------------
const PLAYER_HALF = { x: 0.38, y: 0.5 };
function checkCrash(dt) {
  const reach = 0.4 + S.speed * dt;
  for (const pane of panes) {
    if (pane.broken || !pane.blocking) continue;
    if (Math.abs(pane.body.position.z - S.camZ) > reach + 1.2) continue;
    pane.body.updateAABB();
    const a = pane.body.aabb;
    const px = camera.position.x, py = TUNING.corridor.eyeHeight;
    if (a.lowerBound.x < px + PLAYER_HALF.x && a.upperBound.x > px - PLAYER_HALF.x &&
        a.lowerBound.y < py + PLAYER_HALF.y && a.upperBound.y > py - PLAYER_HALF.y &&
        a.lowerBound.z < S.camZ + 0.3 && a.upperBound.z > S.camZ - reach) {
      crash(pane);
      return;
    }
  }
}

function crash(pane) {
  // smashing through with your face: shards blast forward, balls drain
  const impact = new THREE.Vector3(camera.position.x, TUNING.corridor.eyeHeight, pane.body.position.z);
  const fakeVel = new THREE.Vector3(0, 0, -S.speed * 1.4);
  shatterPane(pane, impact, fakeVel);
  audio.crash();
  S.shakeT = 0.5;
  flash('rgba(255,40,80,0.45)', 380);

  S.balls = Math.max(0, S.balls - TUNING.balls.crashPenalty);
  S.multiTier = 1;
  S.crystalStreak = 0;
  S.combo = 1;
  updateHUD();

  if (S.balls <= 0) {
    S.mode = 'dead';
    S.deadTimer = 0.9; // let the smash play out before the score screen
  } else {
    showMsg(`-${TUNING.balls.crashPenalty} BALLS`, 'neon-pink');
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const hud = el('hud');
const pipsBox = el('pips');
for (let i = 0; i < TUNING.multiball.streakPerTier; i++) pipsBox.appendChild(document.createElement('span'));

function updateHUD() {
  el('ballCount').textContent = S.balls;
  el('multiCount').textContent = S.multiTier;
  const pips = pipsBox.children;
  for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < S.crystalStreak);
  el('hudBalls').style.color = S.balls <= 5 ? '#ff2fd6' : '#cfefff';
}

let comboTimer = null;
function showCombo(c) {
  const box = el('hudCombo');
  box.textContent = `COMBO ×${c}`;
  box.classList.add('show');
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => box.classList.remove('show'), 900);
}

let msgTimer = null;
function showMsg(text, cls) {
  const box = el('hudMsg');
  box.textContent = text;
  box.className = cls + ' show';
  box.id = 'hudMsg';
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => box.classList.remove('show'), 1300);
}

function flash(color, ms) {
  const f = el('flash');
  f.style.background = color;
  f.style.transition = 'none';
  f.style.opacity = '1';
  requestAnimationFrame(() => {
    f.style.transition = `opacity ${ms}ms ease-out`;
    f.style.opacity = '0';
  });
}

function fillStats(container, rows) {
  container.innerHTML = rows
    .map(([k, v]) => `<div class="dim">${k}</div><div class="v">${v}</div>`)
    .join('');
}

function showStart() {
  const s = scores.summary();
  el('weekLabel').textContent = `${weekId()} GRID`;
  fillStats(el('startStats'), [
    ['WEEK BEST', s.weekBest],
    ['ALL-TIME BEST', s.allTimeBest],
    ['TODAY’S BEST', s.dayBest],
    ['DAY STREAK', s.streak ? `${s.streak}\u{1F525}` : '—'],
  ]);
  el('startScreen').classList.add('visible');
  el('overScreen').classList.remove('visible');
  hud.style.display = 'none';
}

function showGameOver() {
  const r = scores.recordRun(S.score);
  el('finalScore').textContent = S.score;
  el('bestBadge').textContent = r.isAllTimeBest ? '★ NEW ALL-TIME BEST ★'
    : r.isWeekBest ? '★ NEW WEEK BEST ★'
    : r.isDayBest ? 'NEW DAILY BEST' : '';
  fillStats(el('overStats'), [
    ['DISTANCE', `${Math.floor(S.distance)}m`],
    ['SMASH PTS', S.smashPoints],
    ['WEEK BEST', r.weekBest],
    ['ALL-TIME BEST', r.allTimeBest],
    ['RUNS THIS WEEK', r.weekRuns],
    ['DAY STREAK', `${r.streak}\u{1F525}`],
  ]);
  el('overScreen').classList.add('visible');
  hud.style.display = 'none';
  audio.stopMusic();
  audio.gameOver();
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------
function clearWorldObjects() {
  for (const p of panes) if (!p.broken) disposePane(p);
  panes.length = 0;
  for (const c of crystals) if (!c.collected) { scene.remove(c.mesh); queueRemove(c.body); }
  crystals.length = 0;
  for (const b of balls) disposeBall(b);
  balls.length = 0;
  for (const sh of shards) { scene.remove(sh.mesh); sh.mesh.material.dispose(); queueRemove(sh.body); }
  shards.length = 0;
  flushRemovals();
}

function startRun() {
  clearWorldObjects();
  Object.assign(S, {
    mode: 'playing', camZ: 0, distance: 0, smashPoints: 0, score: 0,
    balls: TUNING.balls.start, multiTier: 1, crystalStreak: 0, combo: 1,
    lastBreakTime: -99, roomIndex: 0, nextRoomZ: -6,
    speed: TUNING.speed.base, shakeT: 0, time: 0,
  });
  camera.position.set(0, TUNING.corridor.eyeHeight, 0);
  levelGen = new LevelGen(weeklySeed(weeklyTag()));
  streamRooms();
  el('startScreen').classList.remove('visible');
  el('overScreen').classList.remove('visible');
  hud.style.display = 'block';
  updateHUD();
  audio.startMusic();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
let overShownAt = 0;
window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.cornerbtns')) return;
  audio.unlock();
  if (S.mode === 'menu') startRun();
  else if (S.mode === 'playing') throwBalls(e.clientX, e.clientY);
  else if (S.mode === 'dead' && S.deadTimer <= 0 && performance.now() - overShownAt > 600) {
    startRun();
  }
});

el('btnSound').addEventListener('click', (e) => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  audio.musicOn = !audio.muted;
  if (audio.muted) audio.stopMusic();
  else if (S.mode === 'playing') audio.startMusic();
  e.target.classList.toggle('off', audio.muted);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { lastT = null; audio.stopMusic(); }
  else if (S.mode === 'playing' && !audio.muted) audio.startMusic();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const FIXED = 1 / 60;
let lastT = null;

function tick(tNow) {
  requestAnimationFrame(tick);
  if (lastT === null) { lastT = tNow; return; }
  let dt = Math.min(0.05, (tNow - lastT) / 1000);
  lastT = tNow;
  S.time += dt;

  if (S.mode === 'playing') {
    S.camZ -= S.speed * dt;
    S.distance += S.speed * dt;
    streamRooms();
    checkCrash(dt);
  } else if (S.mode === 'dead' && S.deadTimer > 0) {
    S.deadTimer -= dt;
    S.camZ -= S.speed * dt * Math.max(0, S.deadTimer); // glide to a stop
    if (S.deadTimer <= 0) { overShownAt = performance.now(); showGameOver(); }
  }

  // animate kinematic panes
  for (const pane of panes) {
    if (pane.broken || !pane.motion) continue;
    const m = pane.motion;
    if (m.kind === 'slide') {
      const x = pane.x0 + Math.sin(S.time * m.speed + m.phase) * m.range;
      pane.body.position.x = x;
      pane.mesh.position.x = x;
    } else if (m.kind === 'spin') {
      // blade hanging from a top pivot, spinning in the screen plane
      const th = S.time * m.speed * 1.6 + m.phase;
      const radius = pane.h / 2 + 0.7;
      const pivotY = pane.y0 + radius;
      const cx = pane.x0 + Math.sin(th) * radius;
      const cy = pivotY - Math.cos(th) * radius;
      pane.body.position.x = cx;
      pane.body.position.y = cy;
      pane.body.quaternion.setFromEuler(0, 0, th);
      pane.mesh.position.set(cx, cy, pane.z);
      pane.mesh.quaternion.copy(pane.body.quaternion);
    }
  }

  // physics
  for (const b of balls) { b.age += dt; b.body.gb.prevVel.copy(b.body.velocity); }
  world.step(FIXED, dt, 3);
  flushRemovals();

  // sync dynamic meshes
  for (const b of balls) {
    b.mesh.position.copy(b.body.position);
    b.mesh.quaternion.copy(b.body.quaternion);
  }
  for (let i = shards.length - 1; i >= 0; i--) {
    const sh = shards[i];
    sh.ttl -= dt;
    if (sh.ttl <= 0 || sh.body.position.z > S.camZ + 8) {
      scene.remove(sh.mesh);
      sh.mesh.material.dispose();
      queueRemove(sh.body);
      shards.splice(i, 1);
      continue;
    }
    sh.mesh.position.copy(sh.body.position);
    sh.mesh.quaternion.copy(sh.body.quaternion);
    if (sh.ttl < 0.6) sh.mesh.material.opacity = 0.6 * (sh.ttl / 0.6);
  }

  // crystals idle animation
  for (const c of crystals) {
    if (c.collected) continue;
    c.mesh.rotation.y += dt * 1.6;
    c.mesh.position.y = c.y0 + Math.sin(S.time * 2.2 + c.z) * 0.12;
    c.body.position.y = c.mesh.position.y;
  }

  updateSparks(dt);
  if (S.mode === 'playing' || S.mode === 'dead') cleanupBehind();
  flushRemovals();

  // camera: gentle sway + shake
  const sway = Math.sin(S.distance * 0.06) * 0.1;
  let sx = 0, sy = 0;
  if (S.shakeT > 0) {
    S.shakeT -= dt;
    const m = S.shakeT * 0.5;
    sx = (Math.random() - 0.5) * m;
    sy = (Math.random() - 0.5) * m;
  }
  camera.position.set(sway + sx, TUNING.corridor.eyeHeight + sy, S.camZ);
  camera.rotation.z = sway * 0.12;

  // environment follows the camera (infinite corridor)
  floorMesh.position.z = S.camZ - 110;
  wallL.position.z = wallR.position.z = S.camZ - 110;
  rimL.position.z = rimR.position.z = S.camZ - 110;
  floorMat.uniforms.uCam.value.copy(camera.position);
  wallMat.uniforms.uCam.value.copy(camera.position);

  // score
  if (S.mode === 'playing') {
    S.score = Math.floor(S.distance * TUNING.score.perMeter) + S.smashPoints;
    el('hudScore').textContent = S.score;
  }

  renderer.render(scene, camera);
}

showStart();
updateHUD();
requestAnimationFrame(tick);
