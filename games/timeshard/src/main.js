// ============================================================================
// TIMESHARD — main game.
// A frozen diorama of crystal drones and bolts hanging mid-air. Time moves
// only while you act: press-and-drag to aim (time flows while your finger is
// down), release to fire a chrome shard (firing pushes time briefly so the
// shard flies). Clear each moment in the least flowed time.
//
// The pillar: ONE physics world stepped at (dt × timeScale). Slow motion is
// real simulation, never animation — debris, shots and bolts all obey it.
// ============================================================================

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TUNING, PALETTE } from './config.js';
import { weeklySeed, weekId } from '../../../shared/rng.js';
import { createScoreStore } from '../../../shared/scores.js';
import { MomentGen } from './levelgen.js';
import { TimeshardAudio } from './audio.js';

const scores = createScoreStore('timeshard');
const weeklyTag = () => `timeshard/v${TUNING.weekly.generatorVersion}`;

// ---------------------------------------------------------------------------
// Collision groups
// ---------------------------------------------------------------------------
const G_SHOT = 1, G_DRONE = 2, G_WORLD = 4, G_SHARD = 8;

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fogFrozen = new THREE.Color(PALETTE.fogFrozen);
const fogFlow = new THREE.Color(PALETTE.fogFlow);
scene.fog = new THREE.Fog(PALETTE.fogFrozen, TUNING.arena.fogNear, TUNING.arena.fogFar);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, TUNING.arena.eyeHeight, 0);
const playerPos = new THREE.Vector3(0, TUNING.arena.eyeHeight, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Frozen sky: icy gradient + stars + aurora ribbons → background + chrome env
// ---------------------------------------------------------------------------
function makeSkyTexture() {
  const w = 1024, h = 512;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#061626');
  grad.addColorStop(0.44, '#0a2438');
  grad.addColorStop(0.5, '#1a4a5e');
  grad.addColorStop(0.53, '#04101c');
  grad.addColorStop(1, '#020810');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // stars
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * h * 0.46;
    g.fillStyle = `rgba(220,245,255,${0.2 + Math.random() * 0.6})`;
    g.fillRect(Math.random() * w, y, 1.5, 1.5);
  }

  // aurora ribbons
  for (let band = 0; band < 3; band++) {
    const baseY = h * (0.12 + band * 0.09);
    g.strokeStyle = band % 2
      ? 'rgba(127,220,255,0.10)' : 'rgba(180,255,240,0.08)';
    for (let s = 0; s < 14; s++) {
      g.lineWidth = 6 + Math.random() * 16;
      g.beginPath();
      const y0 = baseY + Math.random() * 24;
      g.moveTo(0, y0);
      for (let x = 0; x <= w; x += 64) {
        g.lineTo(x, y0 + Math.sin(x * 0.006 + band * 2 + s) * 26);
      }
      g.stroke();
    }
  }

  // pale frozen suns ahead and behind (u=0.25 faces -Z) for reflections
  for (const cx of [w * 0.25, w * 0.75]) {
    const cy = h * 0.47, r = 26;
    const sg = g.createRadialGradient(cx, cy, 2, cx, cy, r * 2.2);
    sg.addColorStop(0, 'rgba(230,250,255,0.75)');
    sg.addColorStop(0.4, 'rgba(150,225,255,0.3)');
    sg.addColorStop(1, 'rgba(127,220,255,0)');
    g.fillStyle = sg;
    g.fillRect(cx - r * 2.4, cy - r * 2.4, r * 4.8, r * 4.8);
  }

  // horizon glow line
  const hg = g.createLinearGradient(0, h * 0.48, 0, h * 0.53);
  hg.addColorStop(0, 'rgba(127,220,255,0)');
  hg.addColorStop(0.5, 'rgba(200,245,255,0.7)');
  hg.addColorStop(1, 'rgba(127,220,255,0)');
  g.fillStyle = hg;
  g.fillRect(0, h * 0.48, w, h * 0.05);

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const sky = makeSkyTexture();
scene.background = sky;
scene.environment = sky;

const hemi = new THREE.HemisphereLight(0xcfeeff, 0x0a2030, 0.9);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xeaffff, 0.9);
keyLight.position.set(3, 8, 2);
scene.add(keyLight);

// ---------------------------------------------------------------------------
// Ice grid floor (world-locked lines, manual fog, fog color animatable)
// ---------------------------------------------------------------------------
const floorMat = new THREE.ShaderMaterial({
  uniforms: {
    uMinor: { value: new THREE.Color(PALETTE.gridLine) },
    uMajor: { value: new THREE.Color(PALETTE.gridMajor) },
    uBase: { value: new THREE.Color(0x03121e) },
    uFog: { value: fogFrozen.clone() },
    uFogNear: { value: TUNING.arena.fogNear },
    uFogFar: { value: TUNING.arena.fogFar },
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
    uniform vec3 uMinor, uMajor, uBase, uFog, uCam;
    uniform float uFogNear, uFogFar;
    float lineAt(vec2 p, float spacing, float width) {
      vec2 q = p / spacing;
      vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * width);
      return 1.0 - min(min(g.x, g.y), 1.0);
    }
    void main() {
      vec2 p = vW.xz;
      float minor = lineAt(p, 1.6, 1.3);
      float major = lineAt(p, 12.8, 2.0);
      vec3 col = uBase + uMinor * minor * 0.55 + uMajor * major * 0.5;
      float d = distance(vW, uCam);
      float f = smoothstep(uFogNear, uFogFar, d);
      col = mix(col, uFog, f);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), floorMat);
floorMesh.rotation.x = -Math.PI / 2;
scene.add(floorMesh);

// Distant ring of crystal monoliths (decor; seeded so it never pops between loads)
{
  const mono = new THREE.MeshStandardMaterial({
    color: 0x9fd8e8, metalness: 0.4, roughness: 0.25, envMapIntensity: 1.2,
    emissive: PALETTE.iceEdge, emissiveIntensity: 0.06, flatShading: true,
  });
  let a = 1234567;
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 + r() * 0.3;
    const dist = 26 + r() * 12;
    const hgt = 3 + r() * 9;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.4 + r() * 2, hgt, 1.4 + r() * 2), mono);
    m.position.set(Math.sin(ang) * dist, hgt / 2 - 0.2, -Math.cos(ang) * dist);
    m.rotation.y = r() * Math.PI;
    scene.add(m);
  }
}

// ---------------------------------------------------------------------------
// Physics world — stepped at (dt × timeScale) every frame. One clock for all.
// ---------------------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, TUNING.player.gravity, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = false; // tiny frozen steps must never put debris to sleep mid-air

const matGround = new CANNON.Material('ground');
const matShot = new CANNON.Material('shot');
const matShard = new CANNON.Material('shard');
world.addContactMaterial(new CANNON.ContactMaterial(matGround, matShot, { restitution: 0.5, friction: 0.3 }));
world.addContactMaterial(new CANNON.ContactMaterial(matGround, matShard, { restitution: 0.25, friction: 0.55 }));

const floorBody = new CANNON.Body({
  type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: matGround,
  collisionFilterGroup: G_WORLD, collisionFilterMask: G_SHOT | G_SHARD,
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
const droneGeo = new THREE.OctahedronGeometry(TUNING.drones.size);
const droneMat = new THREE.MeshStandardMaterial({
  color: PALETTE.ice, metalness: 0.25, roughness: 0.12, envMapIntensity: 1.6,
  emissive: PALETTE.iceEdge, emissiveIntensity: 0.3, flatShading: true,
  // translucent crystal so the magenta telegraph core inside stays readable
  transparent: true, opacity: 0.75,
});
const coreGeo = new THREE.SphereGeometry(0.14, 12, 10);
const coreMat = new THREE.MeshBasicMaterial({ color: PALETTE.core });
const boltGeo = new THREE.SphereGeometry(TUNING.bolts.radius, 12, 10);
const boltMat = new THREE.MeshBasicMaterial({ color: PALETTE.bolt });
const shotGeo = new THREE.SphereGeometry(TUNING.player.shotRadius, 18, 12);
const shotMat = new THREE.MeshStandardMaterial({
  color: PALETTE.chrome, metalness: 1.0, roughness: 0.07, envMapIntensity: 2.2,
});
const shardGeo = new THREE.BoxGeometry(1, 1, 1);
const shardMat = new THREE.MeshStandardMaterial({
  color: PALETTE.shard, metalness: 0.3, roughness: 0.1, envMapIntensity: 1.8,
  transparent: true, opacity: 0.85, flatShading: true,
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
const glowMagenta = makeGlowTexture('rgba(255,255,255,0.95)', 'rgba(255,47,214,0.5)');
const glowIce = makeGlowTexture('rgba(255,255,255,0.9)', 'rgba(127,220,255,0.45)');

// ---------------------------------------------------------------------------
// Impact sparks (pooled additive sprites)
// ---------------------------------------------------------------------------
const sparks = [];
const sparkMatBase = new THREE.SpriteMaterial({
  map: glowIce, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
});
function spawnSpark(pos, scale = 1.6, color = null) {
  let s = sparks.find((sp) => sp.life <= 0);
  if (!s) {
    s = { sprite: new THREE.Sprite(sparkMatBase.clone()), life: 0 };
    scene.add(s.sprite);
    sparks.push(s);
  }
  s.sprite.material.opacity = 1;
  s.sprite.material.color.set(color || 0xffffff);
  s.sprite.position.copy(pos);
  s.sprite.scale.setScalar(scale * 0.4);
  s.life = 0.3;
  s.maxScale = scale;
}
function updateSparks(dt) {
  for (const s of sparks) {
    if (s.life <= 0) { s.sprite.visible = false; continue; }
    s.life -= dt;
    const t = 1 - Math.max(0, s.life) / 0.3;
    s.sprite.visible = true;
    s.sprite.scale.setScalar(0.4 * s.maxScale + t * s.maxScale);
    s.sprite.material.opacity = 1 - t;
  }
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const S = {
  mode: 'menu',          // menu | playing | clearing | dead
  shields: TUNING.player.shields,
  score: 0,
  moment: 0,             // current moment index
  flowed: 0,             // game-time elapsed inside the current moment
  timeScale: TUNING.time.idleScale,
  holding: false,        // finger down = time flows
  pulseT: 0,             // real-seconds of flow left from the last shot
  gameTime: 0,           // total scaled time (drives all world motion)
  time: 0,               // real time
  shakeT: 0,
  deadTimer: 0,
  clearT: 0,
  stats: { shots: 0, drones: 0, deflects: 0, moments: 0 },
};

let momentGen = new MomentGen(weeklySeed(weeklyTag()));
const drones = [];
const bolts = [];   // pure kinematic visuals: {mesh, pos, vel} — manual sweeps
const shots = [];
const shards = [];
const audio = new TimeshardAudio();

// Debug/replay hook (also used by the Playwright verification script).
window.__timeshard = { S, drones, bolts, camera };

// ---------------------------------------------------------------------------
// Drones
// ---------------------------------------------------------------------------
function spawnDrone(spec) {
  const mesh = new THREE.Mesh(droneGeo, droneMat);
  mesh.scale.set(1, 1.35, 1);
  const core = new THREE.Mesh(coreGeo, coreMat.clone());
  mesh.add(core);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowIce, blending: THREE.AdditiveBlending, transparent: true,
    depthWrite: false, opacity: 0.75,
  }));
  glow.scale.setScalar(2.2);
  mesh.add(glow);
  mesh.position.set(spec.x, spec.y, -spec.z);
  scene.add(mesh);

  const hb = TUNING.drones.size + TUNING.drones.hitboxPad;
  const body = new CANNON.Body({
    type: CANNON.Body.KINEMATIC,
    shape: new CANNON.Box(new CANNON.Vec3(hb, hb * 1.35, hb)),
    position: new CANNON.Vec3(spec.x, spec.y, -spec.z),
    collisionFilterGroup: G_DRONE,
    collisionFilterMask: G_SHOT,
  });
  world.addBody(body);

  const drone = {
    mesh, core, body,
    x0: spec.x, y0: spec.y, z0: -spec.z,
    strafe: spec.strafe,
    bobPhase: spec.strafe.phase * 1.7,
    fireEvery: spec.fireEvery,
    nextFire: spec.fireAt,
    boltSpeed: 0, // filled by spawnMoment from the moment spec
    alive: true,
  };
  body.ts = { drone };
  drones.push(drone);
  return drone;
}

function updateDrones(dtGame) {
  for (const d of drones) {
    if (!d.alive) continue;
    const t = S.gameTime;
    const x = d.x0 + Math.sin(t * d.strafe.speed + d.strafe.phase) * d.strafe.amp;
    const y = d.y0 + Math.sin(t * TUNING.drones.bobSpeed + d.bobPhase) * TUNING.drones.bobAmp;
    d.mesh.position.set(x, y, d.z0);
    d.mesh.rotation.y += dtGame * 0.8;
    d.body.position.set(x, y, d.z0);

    // fire control + telegraph: the magenta core swells before a shot
    d.nextFire -= dtGame;
    const warn = Math.max(0, 1 - Math.max(0, d.nextFire) / TUNING.drones.telegraph);
    d.core.scale.setScalar(1 + warn * 2.6);
    d.core.material.color.setHex(PALETTE.core).multiplyScalar(0.5 + warn * 0.8);
    if (d.nextFire <= 0 && S.mode === 'playing') {
      fireBolt(d);
      d.nextFire = d.fireEvery;
    }
  }
}

function shatterDrone(drone, impact, shotVel) {
  if (!drone.alive) return;
  drone.alive = false;
  drone.body.collisionResponse = false;
  queueRemove(drone.body);
  scene.remove(drone.mesh);

  const C = TUNING.shatter;
  for (let i = 0; i < C.shardsPerDrone; i++) {
    const off = new THREE.Vector3(
      (Math.random() - 0.5), (Math.random() - 0.5) * 1.5, (Math.random() - 0.5)
    ).multiplyScalar(TUNING.drones.size * 1.2);
    const pos = drone.mesh.position.clone().add(off);
    const dir = pos.clone().sub(impact);
    const dist = Math.max(0.12, dir.length());
    dir.normalize();
    const power = C.impulse / (1 + dist * 1.4);
    const vel = new THREE.Vector3(
      dir.x * power + shotVel.x * C.inheritShot,
      dir.y * power + 0.8,
      dir.z * power + shotVel.z * C.inheritShot
    );
    const sz = 0.08 + Math.random() * 0.18;
    spawnShard(pos, sz, sz * (0.6 + Math.random()), vel);
  }

  spawnSpark(impact, 3.0, PALETTE.iceEdge);
  audio.shatter(1.1);
  S.score += TUNING.drones.scoreEach;
  S.stats.drones += 1;
  S.shakeT = Math.max(S.shakeT, 0.15);

  if (S.mode === 'playing' && drones.every((d) => !d.alive)) momentCleared();
}

// ---------------------------------------------------------------------------
// Enemy bolts — simple linear projectiles, moved manually with game time.
// No physics bodies: small + fast means manual segment/sphere sweeps are both
// cheaper and tunnel-proof. (Debris stays 100% rigid-body, per the pillar.)
// ---------------------------------------------------------------------------
function spawnBoltAt(pos, vel) {
  if (bolts.length >= TUNING.bolts.maxLive) return;
  const mesh = new THREE.Mesh(boltGeo, boltMat);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowMagenta, blending: THREE.AdditiveBlending, transparent: true,
    depthWrite: false, opacity: 0.95,
  }));
  glow.scale.setScalar(1.5);
  mesh.add(glow);
  mesh.position.copy(pos);
  scene.add(mesh);
  bolts.push({ mesh, pos: pos.clone(), vel: vel.clone() });
}

function fireBolt(drone) {
  const from = drone.mesh.position.clone();
  const jit = TUNING.bolts.aimJitter;
  const target = playerPos.clone().add(new THREE.Vector3(
    (Math.random() - 0.5) * jit * 2, (Math.random() - 0.5) * jit * 2, 0));
  const vel = target.sub(from).normalize().multiplyScalar(drone.boltSpeed);
  spawnBoltAt(from, vel);
  spawnSpark(from, 1.2, PALETTE.bolt);
}

function removeBolt(i, sparkColor = null) {
  const b = bolts[i];
  if (sparkColor) spawnSpark(b.pos, 2.0, sparkColor);
  scene.remove(b.mesh);
  bolts.splice(i, 1);
}

function updateBolts(dtGame) {
  const hitR = TUNING.player.hitRadius;
  for (let i = bolts.length - 1; i >= 0; i--) {
    // playerHit's mercy blast can shrink the array by several entries mid-loop
    if (i >= bolts.length) { i = bolts.length; continue; }
    const b = bolts[i];
    b.pos.addScaledVector(b.vel, dtGame);
    b.mesh.position.copy(b.pos);
    if (S.mode === 'playing' && b.pos.distanceTo(playerPos) < hitR) {
      removeBolt(i, PALETTE.bolt);
      playerHit();
      continue;
    }
    // passed behind you or drifted far out: it missed
    if (b.pos.z > camera.position.z + 1.5 || b.pos.length() > 60) removeBolt(i);
  }
}

// ---------------------------------------------------------------------------
// Player shots — dynamic chrome shards, ballistic-compensated at launch so a
// tap hits what it points at; physics vs drones, manual sweeps vs bolts.
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function fireShot(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const dir = raycaster.ray.direction.clone();
  const t = TUNING.player.aimDistance / Math.max(0.2, -dir.z);
  const target = camera.position.clone().add(dir.multiplyScalar(t));

  const origin = camera.position.clone().add(new THREE.Vector3(0, -0.35, -0.45));
  const disp = target.clone().sub(origin);
  const flight = disp.length() / TUNING.player.shotSpeed;
  const vel = disp.divideScalar(flight);
  vel.y -= 0.5 * TUNING.player.gravity * flight; // cancel gravity drop at the target

  spawnShot(origin, vel);
  audio.fire();
  S.stats.shots += 1;
  S.shakeT = Math.max(S.shakeT, 0.06);
}

function spawnShot(pos, vel) {
  while (shots.length >= TUNING.player.maxLiveShots) disposeShot(shots.shift());
  const mesh = new THREE.Mesh(shotGeo, shotMat);
  mesh.position.copy(pos);
  scene.add(mesh);
  const body = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Sphere(TUNING.player.shotRadius),
    position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    velocity: new CANNON.Vec3(vel.x, vel.y, vel.z),
    material: matShot,
    collisionFilterGroup: G_SHOT,
    collisionFilterMask: G_DRONE | G_WORLD,
  });
  body.ts = { shot: true, prevVel: new CANNON.Vec3(vel.x, vel.y, vel.z) };
  body.addEventListener('collide', onShotCollide);
  world.addBody(body);
  shots.push({ mesh, body, age: 0, prevPos: pos.clone() });
}

function disposeShot(s) {
  scene.remove(s.mesh);
  queueRemove(s.body);
}

function onShotCollide(e) {
  const self = e.target, other = e.body;
  if (!other.ts || !other.ts.drone) return;
  const drone = other.ts.drone;
  if (!drone.alive) return;
  const cp = new CANNON.Vec3();
  (e.contact.bi === self ? e.contact.bi : e.contact.bj).position.vadd(
    e.contact.bi === self ? e.contact.ri : e.contact.rj, cp);
  const pv = self.ts.prevVel;
  shatterDrone(drone, new THREE.Vector3(cp.x, cp.y, cp.z), new THREE.Vector3(pv.x, pv.y, pv.z));
  // punch through: restore most of the pre-impact velocity
  self.velocity.set(pv.x * 0.8, pv.y * 0.8, pv.z * 0.8);
}

// Segment/sphere sweep of each shot's frame motion against every bolt —
// deflection can't tunnel no matter the frame rate.
function sweepShotsVsBolts() {
  const R = TUNING.bolts.radius + TUNING.bolts.hitboxPad + TUNING.player.shotRadius;
  const seg = new THREE.Vector3(), toB = new THREE.Vector3(), close = new THREE.Vector3();
  for (const s of shots) {
    const p0 = s.prevPos;
    const p1 = s.mesh.position;
    seg.subVectors(p1, p0);
    const len2 = seg.lengthSq();
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      toB.subVectors(b.pos, p0);
      const t = len2 > 1e-8 ? THREE.MathUtils.clamp(toB.dot(seg) / len2, 0, 1) : 0;
      close.copy(p0).addScaledVector(seg, t);
      if (close.distanceToSquared(b.pos) < R * R) {
        removeBolt(i, 0xffffff);
        audio.deflect();
        S.score += TUNING.bolts.deflectScore;
        S.stats.deflects += 1;
        showMsg('DEFLECT +' + TUNING.bolts.deflectScore, 'neon-ice');
      }
    }
  }
}

function updateShots(dtGame) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.age += dtGame;
    if (s.age > TUNING.player.shotTtl || s.body.position.z < -70 || s.body.position.y < -2) {
      disposeShot(s);
      shots.splice(i, 1);
      continue;
    }
    s.prevPos.copy(s.mesh.position);
    s.mesh.position.copy(s.body.position);
    s.mesh.quaternion.copy(s.body.quaternion);
  }
}

// ---------------------------------------------------------------------------
// Debris shards (real rigid bodies, floor-only collisions, capped + recycled)
// ---------------------------------------------------------------------------
function spawnShard(pos, w, h, vel) {
  while (shards.length >= TUNING.shatter.maxShardBodies) {
    const old = shards.shift();
    scene.remove(old.mesh);
    old.mesh.material.dispose();
    queueRemove(old.body);
  }
  const mesh = new THREE.Mesh(shardGeo, shardMat.clone());
  mesh.scale.set(w, h, w * 0.5);
  mesh.position.copy(pos);
  scene.add(mesh);
  const body = new CANNON.Body({
    mass: 0.12,
    shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, w / 4)),
    position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    velocity: new CANNON.Vec3(vel.x, vel.y, vel.z),
    angularVelocity: new CANNON.Vec3(
      (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
    material: matShard,
    collisionFilterGroup: G_SHARD,
    collisionFilterMask: G_WORLD,
  });
  world.addBody(body);
  shards.push({ mesh, body, ttl: TUNING.shatter.ttl });
}

function updateShards(dtGame) {
  for (let i = shards.length - 1; i >= 0; i--) {
    const sh = shards[i];
    sh.ttl -= dtGame;
    if (sh.ttl <= 0) {
      scene.remove(sh.mesh);
      sh.mesh.material.dispose();
      queueRemove(sh.body);
      shards.splice(i, 1);
      continue;
    }
    sh.mesh.position.copy(sh.body.position);
    sh.mesh.quaternion.copy(sh.body.quaternion);
    if (sh.ttl < 0.6) sh.mesh.material.opacity = 0.85 * (sh.ttl / 0.6);
  }
}

// ---------------------------------------------------------------------------
// Moment lifecycle
// ---------------------------------------------------------------------------
function spawnMoment(index) {
  const spec = momentGen.nextMoment(index);
  for (const d of spec.drones) {
    const drone = spawnDrone(d);
    drone.boltSpeed = spec.boltSpeed;
  }
  for (const b of spec.bolts) {
    const pos = new THREE.Vector3(b.x, b.y, -b.z);
    const vel = playerPos.clone().sub(pos).normalize().multiplyScalar(b.speed);
    spawnBoltAt(pos, vel);
  }
  S.flowed = 0;
  updateHUD();
}

function momentCleared() {
  const C = TUNING.score;
  const over = Math.max(0, S.flowed - C.parFreeSeconds);
  const timeBonus = Math.max(0, Math.round(C.timeBonusMax - over * C.timeBonusDrain));
  S.score += C.momentBase + timeBonus;
  S.stats.moments += 1;
  S.mode = 'clearing';
  S.clearT = 1.4;
  S.holding = false;
  S.pulseT = 0;

  // leftover bolts freeze-shatter harmlessly
  for (let i = bolts.length - 1; i >= 0; i--) removeBolt(i, PALETTE.iceEdge);

  audio.clear();
  showMsg(
    `MOMENT ${S.moment + 1} SHATTERED  +${C.momentBase + timeBonus}` +
    (timeBonus >= C.timeBonusMax ? '  ★ PERFECT' : ''),
    'neon-ice');
  flash('rgba(127,220,255,0.22)', 400);
  updateHUD();
}

function playerHit() {
  S.shields -= 1;
  audio.hurt();
  S.shakeT = 0.5;
  S.pulseT = 0;
  flash('rgba(255,40,90,0.5)', 420);

  // mercy: vaporize anything about to combo you
  for (let i = bolts.length - 1; i >= 0; i--) {
    if (bolts[i].pos.distanceTo(playerPos) < TUNING.player.mercyRadius) {
      removeBolt(i, PALETTE.bolt);
    }
  }
  updateHUD();

  if (S.shields <= 0) {
    S.mode = 'dead';
    S.deadTimer = 1.0;
    S.holding = false;
  } else {
    showMsg('SHIELD DOWN', 'neon-pink');
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const hud = el('hud');

function updateHUD() {
  el('hudScore').textContent = S.score;
  el('shields').textContent =
    '◆'.repeat(Math.max(0, S.shields)) + '◇'.repeat(TUNING.player.shields - Math.max(0, S.shields));
  el('momentNum').textContent = S.moment + 1;
}

function updateFlowBar() {
  const C = TUNING.score;
  const total = C.parFreeSeconds + C.timeBonusMax / C.timeBonusDrain;
  const rem = Math.max(0, 1 - S.flowed / total);
  el('flowBar').style.width = `${rem * 100}%`;
  el('flowBar').style.background = rem > 0.4 ? '#7fdcff' : '#ff2fd6';
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
  el('weekLabel').textContent = `${weekId()} MOMENTS`;
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

let overShownAt = 0;
function showGameOver() {
  const r = scores.recordRun(S.score);
  el('finalScore').textContent = S.score;
  el('bestBadge').textContent = r.isAllTimeBest ? '★ NEW ALL-TIME BEST ★'
    : r.isWeekBest ? '★ NEW WEEK BEST ★'
    : r.isDayBest ? 'NEW DAILY BEST' : '';
  const acc = S.stats.shots ? Math.round(100 * (S.stats.drones + S.stats.deflects) / S.stats.shots) : 0;
  fillStats(el('overStats'), [
    ['MOMENTS SHATTERED', S.stats.moments],
    ['DRONES', S.stats.drones],
    ['DEFLECTS', S.stats.deflects],
    ['ACCURACY', `${acc}%`],
    ['WEEK BEST', r.weekBest],
    ['ALL-TIME BEST', r.allTimeBest],
    ['RUNS THIS WEEK', r.weekRuns],
    ['DAY STREAK', `${r.streak}\u{1F525}`],
  ]);
  el('overScreen').classList.add('visible');
  hud.style.display = 'none';
  audio.stopMusic();
  audio.gameOver();
  overShownAt = performance.now();
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------
function clearWorldObjects() {
  for (const d of drones) if (d.alive) { scene.remove(d.mesh); queueRemove(d.body); }
  drones.length = 0;
  for (let i = bolts.length - 1; i >= 0; i--) removeBolt(i);
  for (const s of shots) disposeShot(s);
  shots.length = 0;
  for (const sh of shards) { scene.remove(sh.mesh); sh.mesh.material.dispose(); queueRemove(sh.body); }
  shards.length = 0;
  flushRemovals();
}

function startRun() {
  clearWorldObjects();
  Object.assign(S, {
    mode: 'playing', shields: TUNING.player.shields, score: 0, moment: 0,
    flowed: 0, timeScale: TUNING.time.idleScale, holding: false, pulseT: 0,
    gameTime: 0, shakeT: 0, deadTimer: 0, clearT: 0,
    stats: { shots: 0, drones: 0, deflects: 0, moments: 0 },
  });
  momentGen = new MomentGen(weeklySeed(weeklyTag()));
  spawnMoment(0);
  el('startScreen').classList.remove('visible');
  el('overScreen').classList.remove('visible');
  hud.style.display = 'block';
  updateHUD();
  audio.startMusic();
}

// ---------------------------------------------------------------------------
// Input: press = time flows (aim), release = fire. Firing grants a short
// pulse of flow so your shard actually travels. Quick tap = snap shot.
// ---------------------------------------------------------------------------
const reticle = el('reticle');
let aimX = 0, aimY = 0;
let ignoreNextUp = false;

function setReticle(x, y, on) {
  reticle.style.display = on ? 'block' : 'none';
  if (on) reticle.style.transform = `translate(${x - 23}px, ${y - 23}px)`;
}

window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.cornerbtns')) return;
  audio.unlock();
  if (S.mode === 'menu') {
    startRun();
    ignoreNextUp = true;
  } else if (S.mode === 'playing') {
    S.holding = true;
    aimX = e.clientX; aimY = e.clientY;
    setReticle(aimX, aimY, true);
  } else if (S.mode === 'dead' && S.deadTimer <= 0 && performance.now() - overShownAt > 600) {
    startRun();
    ignoreNextUp = true;
  }
});

window.addEventListener('pointermove', (e) => {
  if (!S.holding) return;
  aimX = e.clientX; aimY = e.clientY;
  setReticle(aimX, aimY, true);
});

function endHold(fire) {
  setReticle(0, 0, false);
  if (ignoreNextUp) { ignoreNextUp = false; S.holding = false; return; }
  if (S.holding && S.mode === 'playing' && fire) {
    fireShot(aimX, aimY);
    S.pulseT = TUNING.time.shotPulse;
  }
  S.holding = false;
}
window.addEventListener('pointerup', () => endHold(true));
window.addEventListener('pointercancel', () => endHold(false));

el('btnSound').addEventListener('click', (e) => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  audio.musicOn = !audio.muted;
  if (audio.muted) audio.stopMusic();
  else if (S.mode === 'playing' || S.mode === 'clearing') audio.startMusic();
  e.target.classList.toggle('off', audio.muted);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    lastT = null;
    S.holding = false;
    audio.stopMusic();
  } else if ((S.mode === 'playing' || S.mode === 'clearing') && !audio.muted) {
    audio.startMusic();
  }
});

// ---------------------------------------------------------------------------
// Frozen ↔ flowing presentation: fog, exposure, overlay tints, audio filter
// ---------------------------------------------------------------------------
const flowTint = el('flowTint');
const freezeTint = el('freezeTint');
const fogNow = new THREE.Color();

function applyFlowLook(flow) {
  fogNow.lerpColors(fogFrozen, fogFlow, flow);
  scene.fog.color.copy(fogNow);
  floorMat.uniforms.uFog.value.copy(fogNow);
  renderer.toneMappingExposure = 1.1 + flow * 0.2;
  hemi.intensity = 0.9 - flow * 0.25;
  flowTint.style.opacity = (flow * 0.3).toFixed(3);
  freezeTint.style.opacity = ((1 - flow) * 0.22).toFixed(3);
  audio.setFlow(flow);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastT = null;

function tick(tNow) {
  requestAnimationFrame(tick);
  if (lastT === null) { lastT = tNow; return; }
  const dt = Math.min(0.05, (tNow - lastT) / 1000);
  lastT = tNow;
  S.time += dt;

  // --- the time dial ---
  const T = TUNING.time;
  if (S.pulseT > 0) S.pulseT -= dt;
  const active = S.mode === 'playing' && (S.holding || S.pulseT > 0);
  const target = S.mode === 'playing' ? (active ? 1 : T.idleScale) : T.idleScale;
  const rate = target > S.timeScale ? T.rampUp : T.rampDown;
  S.timeScale += (target - S.timeScale) * Math.min(1, rate * dt);
  const dtGame = dt * S.timeScale;
  S.gameTime += dtGame;
  if (S.mode === 'playing') S.flowed += dtGame;

  // --- world update, all on the scaled clock ---
  updateDrones(dtGame);
  updateBolts(dtGame);
  world.step(Math.max(1e-6, dtGame));
  flushRemovals();
  updateShots(dtGame);
  if (S.mode === 'playing') sweepShotsVsBolts();
  updateShards(dtGame);
  updateSparks(dt); // UI feedback runs on real time — always snappy
  flushRemovals();

  // --- mode timers ---
  if (S.mode === 'clearing') {
    S.clearT -= dt;
    if (S.clearT <= 0) {
      S.moment += 1;
      S.mode = 'playing';
      spawnMoment(S.moment);
    }
  } else if (S.mode === 'dead' && S.deadTimer > 0) {
    S.deadTimer -= dt;
    if (S.deadTimer <= 0) showGameOver();
  }

  // --- camera: micro sway + shake ---
  let sx = 0, sy = 0;
  if (S.shakeT > 0) {
    S.shakeT -= dt;
    const m = S.shakeT * 0.4;
    sx = (Math.random() - 0.5) * m;
    sy = (Math.random() - 0.5) * m;
  }
  const sway = Math.sin(S.time * 0.5) * 0.03;
  camera.position.set(sway + sx, TUNING.arena.eyeHeight + Math.sin(S.time * 0.8) * 0.02 + sy, 0);
  camera.rotation.z = sway * 0.1;
  floorMat.uniforms.uCam.value.copy(camera.position);

  applyFlowLook(S.timeScale);

  if (S.mode === 'playing') {
    el('hudScore').textContent = S.score;
    updateFlowBar();
  }

  renderer.render(scene, camera);
}

showStart();
updateHUD();
requestAnimationFrame(tick);
