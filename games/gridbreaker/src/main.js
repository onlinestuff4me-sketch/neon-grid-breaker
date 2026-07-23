// ============================================================================
// TIMESHARD — main game.
// You speed down an endless generated track — open grid plains, neon
// corridors, enclosed tunnels. Crystal drones emerge from doors in the
// floor and walls (or dive in from above) and harass you with ethereal
// wisp-bolts. HOLD a finger to slow time to a crawl and DRAG it to weave;
// TAP (a second finger, or a quick single tap) to fire back. Ammo is
// limited: kills leave a soul — fly through it to absorb it.
//
// The pillar: ONE physics world stepped at (dt × timeScale). Slow motion is
// real simulation, never animation — debris, shots and bolts all obey it.
// ============================================================================

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TUNING, PALETTE, ZONES, ramp } from './config.js';
import { weeklySeed, weekId, mulberry32, hashString } from '../../../shared/rng.js';
import { createScoreStore } from '../../../shared/scores.js';
import { TrackGen } from './levelgen.js';
import { TimeshardAudio } from './audio.js';

// NOTE: the game was renamed GRID BREAKER, but the storage key and weekly
// seed tag keep the original 'timeshard' id — renaming them would orphan
// players' local scores and reroll this week's level mid-week.
const scores = createScoreStore('timeshard');
const weeklyTag = () => `timeshard/v${TUNING.weekly.generatorVersion}`;

// ---------------------------------------------------------------------------
// Collision groups
// ---------------------------------------------------------------------------
const G_SHOT = 1, G_DRONE = 2, G_WORLD = 4, G_SHARD = 8, G_OBST = 16;

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
const fogFast = new THREE.Color(PALETTE.fogFast);
const fogSlow = new THREE.Color(PALETTE.fogSlow);
scene.fog = new THREE.Fog(PALETTE.fogFast, TUNING.track.fogNear, TUNING.track.fogFar);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 260);
camera.position.set(0, TUNING.track.eyeHeight, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Icy sky: gradient + stars + aurora ribbons → background + chrome env
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

  for (let i = 0; i < 260; i++) {
    const y = Math.random() * h * 0.46;
    g.fillStyle = `rgba(220,245,255,${0.2 + Math.random() * 0.6})`;
    g.fillRect(Math.random() * w, y, 1.5, 1.5);
  }

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

  // pale suns ahead and behind (u=0.25 faces -Z) for chrome reflections
  for (const cx of [w * 0.25, w * 0.75]) {
    const cy = h * 0.47, r = 26;
    const sg = g.createRadialGradient(cx, cy, 2, cx, cy, r * 2.2);
    sg.addColorStop(0, 'rgba(230,250,255,0.75)');
    sg.addColorStop(0.4, 'rgba(150,225,255,0.3)');
    sg.addColorStop(1, 'rgba(127,220,255,0)');
    g.fillStyle = sg;
    g.fillRect(cx - r * 2.4, cy - r * 2.4, r * 4.8, r * 4.8);
  }

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
// Grid shader (floor / walls / ceiling), world-locked lines with manual fog
// ---------------------------------------------------------------------------
function gridMaterial(mode, baseHex, gain = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMode: { value: mode }, // 0: lines on xz (floor/ceiling), 1: on zy (walls)
      uGain: { value: gain },
      uMinor: { value: new THREE.Color(PALETTE.gridLine) },
      uMajor: { value: new THREE.Color(PALETTE.gridMajor) },
      uBase: { value: new THREE.Color(baseHex) },
      uFog: { value: fogFast.clone() },
      uFogNear: { value: TUNING.track.fogNear },
      uFogFar: { value: TUNING.track.fogFar },
      uCam: { value: new THREE.Vector3() },
    },
    side: THREE.DoubleSide,
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
      uniform float uFogNear, uFogFar, uGain;
      float lineAt(vec2 p, float spacing, float width) {
        vec2 q = p / spacing;
        vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * width);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        vec2 p = uMode == 0 ? vW.xz : vW.zy;
        float minor = lineAt(p, 1.6, 1.3);
        float major = lineAt(p, 12.8, 2.0);
        vec3 col = uBase + (uMinor * minor * 0.55 + uMajor * major * 0.5) * uGain;
        float d = distance(vW, uCam);
        float f = smoothstep(uFogNear, uFogFar, d);
        col = mix(col, uFog, f);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

const floorMat = gridMaterial(0, 0x03121e);
const wallMat = gridMaterial(1, 0x0a2438, 1.6);
const ceilMat = gridMaterial(0, 0x081c2e, 1.4);
const gridMats = [floorMat, wallMat, ceilMat];

const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 320), floorMat);
floorMesh.rotation.x = -Math.PI / 2;
scene.add(floorMesh);

// ---------------------------------------------------------------------------
// Physics world — stepped at (dt × timeScale) every frame. One clock for all.
// ---------------------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, TUNING.player.gravity, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = false; // tiny slow-mo steps must never put debris to sleep

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
const droneGeo = new THREE.OctahedronGeometry(TUNING.enemies.size);
const droneMat = new THREE.MeshStandardMaterial({
  color: PALETTE.ice, metalness: 0.25, roughness: 0.12, envMapIntensity: 1.6,
  emissive: PALETTE.iceEdge, emissiveIntensity: 0.3, flatShading: true,
  // translucent crystal so the magenta telegraph core inside stays readable
  transparent: true, opacity: 0.75,
});
const shotGeo = new THREE.SphereGeometry(TUNING.player.shotRadius, 18, 12);
const shotMat = new THREE.MeshStandardMaterial({
  color: PALETTE.chrome, metalness: 1.0, roughness: 0.07, envMapIntensity: 2.2,
});
const shardGeo = new THREE.BoxGeometry(1, 1, 1);
const shardMat = new THREE.MeshStandardMaterial({
  color: PALETTE.shard, metalness: 0.3, roughness: 0.1, envMapIntensity: 1.8,
  transparent: true, opacity: 0.85, flatShading: true,
});
const doorMat = new THREE.MeshStandardMaterial({
  color: 0x0a2438, metalness: 0.5, roughness: 0.3,
  emissive: PALETTE.door, emissiveIntensity: 0.5,
});
const frameMat = new THREE.MeshBasicMaterial({ color: PALETTE.door });
const gateMat = new THREE.MeshBasicMaterial({ color: 0xff7ae4 });
const portalMat = new THREE.MeshStandardMaterial({
  color: PALETTE.ice, metalness: 0.4, roughness: 0.15, envMapIntensity: 1.6,
  emissive: PALETTE.iceEdge, emissiveIntensity: 0.7,
});

// Floating "GATE N" title rendered to a canvas — lives above the portal in
// the world instead of flashing on the HUD.
function makeGateLabel(n) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.font = '900 italic 84px -apple-system, "Segoe UI", Roboto, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(127,220,255,0.9)';
  g.shadowBlur = 22;
  const grad = g.createLinearGradient(0, 22, 0, 106);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#bfeaff');
  grad.addColorStop(1, '#5ecfff');
  g.fillStyle = grad;
  g.fillText(`GATE ${n}`, 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  s.scale.set(3.6, 0.9, 1);
  return s;
}
const ringMat = new THREE.MeshBasicMaterial({ color: 0x9ff0ff });
const pylonMat = new THREE.MeshStandardMaterial({
  color: 0x9fd8e8, metalness: 0.4, roughness: 0.25, envMapIntensity: 1.2,
  emissive: PALETTE.iceEdge, emissiveIntensity: 0.08, flatShading: true,
});
const paneMat = new THREE.MeshPhysicalMaterial({
  color: 0x7fe9ff, metalness: 0.1, roughness: 0.06,
  transparent: true, opacity: 0.3, side: THREE.DoubleSide,
  envMapIntensity: 1.8, depthWrite: false,
  emissive: 0x0d3340, emissiveIntensity: 0.5,
});
const paneEdgeMat = new THREE.LineBasicMaterial({ color: PALETTE.iceEdge, transparent: true, opacity: 0.9 });
const shellMat = new THREE.MeshStandardMaterial({
  color: 0xbfeeff, metalness: 0.1, roughness: 0.05, envMapIntensity: 1.8,
  transparent: true, opacity: 0.4, flatShading: true,
  emissive: PALETTE.iceEdge, emissiveIntensity: 0.25,
});
const turretMat = new THREE.MeshStandardMaterial({
  color: 0xdff6ff, metalness: 0.5, roughness: 0.2, envMapIntensity: 1.6,
  emissive: 0xff2fd6, emissiveIntensity: 0.15, flatShading: true,
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
const glowIce = makeGlowTexture('rgba(255,255,255,0.9)', 'rgba(127,220,255,0.45)');
const glowWisp = makeGlowTexture('rgba(255,255,255,0.95)', 'rgba(201,166,255,0.55)');
const glowMagenta = makeGlowTexture('rgba(255,255,255,0.95)', 'rgba(255,47,214,0.5)');
const glowSoul = makeGlowTexture('rgba(255,255,255,0.95)', 'rgba(174,247,232,0.55)');

function sprite(map, color, scale, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, blending: THREE.AdditiveBlending, transparent: true,
    depthWrite: false, opacity,
  }));
  s.scale.setScalar(scale);
  return s;
}

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
  mode: 'menu',          // menu | playing | dead
  shields: TUNING.player.shields,
  ammo: TUNING.player.ammoStart,
  score: 0,              // SCORE == DISTANCE (meters), by design
  distance: 0,
  camZ: 0,
  camX: 0,
  steerX: 0,             // where the drag wants you
  trackHalf: ZONES.open.halfWidth,
  zoneIdx: 0,
  speed: TUNING.speed.base,
  targetSpeed: TUNING.speed.base, // speed eases toward this — no sudden jumps
  gateGraceT: 0,         // countdown before enemies may appear again
  gateT: -1,             // seconds since last gate pass (-1 = idle)
  wind: 0,               // current zone crosswind (m/s, signed)
  fogFarT: TUNING.track.fogFar, // fog distance target (fog-bank zones shrink it)
  fogFar: TUNING.track.fogFar,
  timeScale: 1,
  focus: TUNING.time.focusMax,
  focusOk: true,
  holdActive: false,
  gameTime: 0,
  time: 0,
  shakeT: 0,
  invulnT: 0,
  deadTimer: 0,
  stats: { shots: 0, kills: 0, deflects: 0, souls: 0, gates: 0 },
};

let trackGen = new TrackGen(weeklySeed(weeklyTag()));
const zones = [];        // {spec, startZ, endZ, meshes[]}
const panes = [];        // glass walls: shoot them or weave the gap
const pylons = [];       // crystal slalom columns
const gates = [];        // speed-tier gateways: {z, pos, passed}
const pendingEvents = []; // spawn events waiting for their trigger distance
const drones = [];
const bolts = [];        // ethereal wisps: manual kinematics + sweeps
const souls = [];
const shots = [];
const shards = [];
const audio = new TimeshardAudio();
let nextZoneZ = -8;

// Debug/replay hook (also used by the Playwright verification script).
window.__timeshard = { S, drones, bolts, souls, shots, zones, gates, panes, pylons, camera, audio };

// ---------------------------------------------------------------------------
// Zone environment building + streaming
// ---------------------------------------------------------------------------
function buildZoneMeshes(spec, startZ) {
  const meshes = [];
  const geo = ZONES[spec.type];
  const midZ = startZ - spec.length / 2;
  const add = (m) => { scene.add(m); meshes.push(m); };

  if (geo.wallH > 0) {
    const wallGeo = new THREE.PlaneGeometry(spec.length, geo.wallH);
    const wl = new THREE.Mesh(wallGeo, wallMat);
    wl.rotation.y = Math.PI / 2;
    wl.position.set(-spec.halfWidth - 0.02, geo.wallH / 2, midZ);
    add(wl);
    const wr = new THREE.Mesh(wallGeo, wallMat);
    wr.rotation.y = -Math.PI / 2;
    wr.position.set(spec.halfWidth + 0.02, geo.wallH / 2, midZ);
    add(wr);
    // glowing rim strips where walls meet the floor
    const rimGeo = new THREE.BoxGeometry(0.07, 0.07, spec.length);
    const rl = new THREE.Mesh(rimGeo, ringMat);
    rl.position.set(-spec.halfWidth, 0.035, midZ);
    add(rl);
    const rr = new THREE.Mesh(rimGeo, ringMat);
    rr.position.set(spec.halfWidth, 0.035, midZ);
    add(rr);
  }

  if (geo.ceiling > 0) {
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(spec.halfWidth * 2 + 0.1, spec.length), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, geo.ceiling, midZ);
    add(ceil);
    // light rings every ~8m sell the tunnel rush
    for (let z = 5; z < spec.length - 2; z += 8) {
      const ring = makeRing(spec.halfWidth, geo.ceiling, 0.09);
      ring.position.z = startZ - z;
      add(ring);
    }
  }

  // entry arch where an enclosed zone begins — the frame into the tunnel
  if (spec.type !== 'open') {
    const arch = makeRing(spec.halfWidth + 0.2, (geo.ceiling || geo.wallH) + 0.2, 0.13);
    arch.position.z = startZ - 0.5;
    add(arch);
  }

  // GATEWAY every Nth zone: a round portal you fly through to shift up a
  // speed tier. Ice torus + magenta energy ring + faint portal surface,
  // slowly spinning, with a floating GATE N title above it.
  if (spec.index > 0 && spec.index % TUNING.gates.everyZones === 0) {
    const num = spec.index / TUNING.gates.everyZones;
    const R = Math.min(spec.halfWidth - 0.2, 2.1);
    const cy = R + 0.35;
    const gz = startZ - 1.2;
    const group = new THREE.Group();
    const ring = new THREE.Group();
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.13, 10, 48), portalMat));
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(R - 0.26, 0.05, 8, 48), gateMat));
    ring.add(sprite(glowMagenta, PALETTE.wispHalo, R * 2.6, 0.2)); // portal surface
    group.add(ring);
    const label = makeGateLabel(num);
    // enclosed zones have no headroom — tuck the title inside the ring's top
    label.position.set(0, geo.ceiling ? R * 0.5 : R + 0.9, 0.05);
    group.add(label);
    group.position.set(0, cy, gz);
    add(group);
    gates.push({ z: gz, pos: new THREE.Vector3(0, cy, gz), R, ring, group, passed: false });
  }

  // open plains get off-track crystal pylons streaming past (speed feel)
  if (spec.type === 'open') {
    const rng = mulberry32(hashString(`decor:${spec.index}`));
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const hgt = 2.5 + rng() * 7;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.9 + rng() * 1.6, hgt, 0.9 + rng() * 1.6), pylonMat);
      p.position.set(side * (spec.halfWidth + 2.5 + rng() * 9), hgt / 2, startZ - rng() * spec.length);
      p.rotation.y = rng() * Math.PI;
      add(p);
    }
  }

  return meshes;
}

function makeRing(halfW, height, thick) {
  const g = new THREE.Group();
  const bar = (w, h, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, thick), ringMat);
    m.position.set(x, y, 0);
    g.add(m);
  };
  bar(halfW * 2 + thick * 2, thick, 0, height);       // top
  bar(thick, height, -halfW - thick / 2, height / 2); // left
  bar(thick, height, halfW + thick / 2, height / 2);  // right
  return g;
}

function streamZones() {
  while (nextZoneZ > S.camZ - TUNING.track.horizon) {
    const index = zones.length ? zones[zones.length - 1].spec.index + 1 : 0;
    const spec = trackGen.nextZone(index);
    const startZ = nextZoneZ;
    const meshes = buildZoneMeshes(spec, startZ);
    zones.push({ spec, startZ, endZ: startZ - spec.length, meshes });

    for (const e of spec.events) {
      pendingEvents.push({ ...e, worldZ: startZ - e.z, zoneIdx: index, halfWidth: spec.halfWidth });
    }
    for (const sl of spec.souls) {
      spawnSoul(new THREE.Vector3(sl.x, sl.y, startZ - sl.z), true);
    }
    for (const o of spec.obstacles ?? []) {
      if (o.type === 'panewall') spawnPaneWall(o, startZ, spec.halfWidth);
      else if (o.type === 'pylons') spawnPylons(o, startZ, spec.halfWidth);
    }
    nextZoneZ -= spec.length;
  }

  // recycle zones behind the camera
  while (zones.length && zones[0].endZ > S.camZ + TUNING.track.cleanupBehind) {
    const z = zones.shift();
    for (const m of z.meshes) {
      scene.remove(m);
      m.traverse?.((c) => c.geometry?.dispose());
      m.geometry?.dispose();
    }
  }

  // current zone drives speed and steering clamp
  const cur = zones.find((z) => S.camZ <= z.startZ && S.camZ > z.endZ);
  if (cur) {
    if (cur.spec.index !== S.zoneIdx) enterZone(cur.spec);
    S.zoneIdx = cur.spec.index;
    updateSpeed();
    const targetHalf = cur.spec.halfWidth;
    S.trackHalf += (targetHalf - S.trackHalf) * Math.min(1, 2.5 * (1 / 60));
  }
}

// Zone modifiers: crosswind pushes you off-line; fog banks eat your sight.
function enterZone(spec) {
  const m = spec.modifier;
  S.wind = m && m.kind === 'wind' ? m.dir * m.strength : 0;
  S.fogFarT = m && m.kind === 'fog' ? TUNING.modifiers.fogFar : TUNING.track.fogFar;
  if (S.mode === 'playing' && m) {
    if (m.kind === 'wind') showMsg(m.dir > 0 ? 'CROSSWIND ⟶' : '⟵ CROSSWIND', 'neon-ice');
    else showMsg('FOG BANK', 'neon-ice');
  }
}

function updateSpeed() {
  // sets the TARGET — S.speed eases toward it in the tick, so a gate feels
  // like winding up, not a teleport to a new velocity
  S.targetSpeed = Math.min(TUNING.speed.max,
    TUNING.speed.base + S.zoneIdx * TUNING.speed.perZone + S.stats.gates * TUNING.speed.perGate);
}

function passGates() {
  for (let i = gates.length - 1; i >= 0; i--) {
    const g = gates[i];
    if (!g.passed && S.camZ < g.z) {
      g.passed = true;
      if (S.mode === 'playing') {
        S.stats.gates += 1;
        updateSpeed(); // the new tier is permanent — perGate never decays
        audio.gate(); // huge crystalline crash → rising whoosh

        // the portal shatters into real rigid ice around its circumference
        scene.remove(g.group);
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          const p = new THREE.Vector3(Math.cos(a) * g.R, g.pos.y + Math.sin(a) * g.R, g.z);
          const v = new THREE.Vector3(
            Math.cos(a) * 3.2, Math.sin(a) * 3.2 + 1, -S.speed * 0.35);
          const sz = 0.1 + Math.random() * 0.16;
          spawnShard(p, sz, sz * 1.4, v);
        }
        spawnSpark(g.pos, 5, PALETTE.wispHalo);
        flash('rgba(255,47,214,0.15)', 450);
        spawnStreaks(g.z); // hyperspace lines rushing past
        S.gateT = 0; // starts the fov surge (ramps in, eases out)
        S.gateGraceT = TUNING.gates.graceAfter; // breathing room before enemies
        S.shakeT = Math.max(S.shakeT, 0.2);
        updateHUD();
      }
    }
    if (g.z > S.camZ + TUNING.track.cleanupBehind) gates.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Track obstacles: glass pane walls (weave the gap or shoot through — smash
// into one and it costs a shield) and crystal pylon slaloms. All destruction
// is real rigid-body shatter.
// ---------------------------------------------------------------------------
function spawnPaneSegment(x0, x1, worldZ) {
  const O = TUNING.obstacles;
  const w = x1 - x0;
  if (w < 0.3) return;
  const cx = (x0 + x1) / 2;
  const geo = new THREE.BoxGeometry(w, O.paneH, O.paneThick);
  const mesh = new THREE.Mesh(geo, paneMat);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), paneEdgeMat));
  mesh.position.set(cx, O.paneH / 2, worldZ);
  scene.add(mesh);
  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(w / 2, O.paneH / 2, O.paneThick / 2)),
    position: new CANNON.Vec3(cx, O.paneH / 2, worldZ),
    collisionFilterGroup: G_OBST,
    collisionFilterMask: G_SHOT,
  });
  world.addBody(body);
  const pane = { mesh, geo, body, x0, x1, w, z: worldZ, broken: false };
  body.ts = { pane };
  panes.push(pane);
}

function spawnPaneWall(o, startZ, halfWidth) {
  const z = startZ - o.z;
  spawnPaneSegment(-halfWidth, o.gapX - o.gapW / 2, z);
  spawnPaneSegment(o.gapX + o.gapW / 2, halfWidth, z);
}

function shatterPane(pane, impact, vel) {
  if (pane.broken) return;
  pane.broken = true;
  scene.remove(pane.mesh);
  pane.geo.dispose();
  queueRemove(pane.body);
  const O = TUNING.obstacles;
  const cw = pane.w / O.shatterCols, ch = O.paneH / O.shatterRows;
  for (let r = 0; r < O.shatterRows; r++) {
    for (let c = 0; c < O.shatterCols; c++) {
      const px = pane.x0 + cw * (c + 0.5) + (Math.random() - 0.5) * cw * 0.5;
      const py = ch * (r + 0.5) + (Math.random() - 0.5) * ch * 0.5;
      const pos = new THREE.Vector3(px, py, pane.z);
      const dir = pos.clone().sub(impact);
      const dist = Math.max(0.15, dir.length());
      dir.normalize();
      const power = 5 / (1 + dist * 1.5);
      spawnShard(pos, cw * 0.6, ch * 0.6, new THREE.Vector3(
        dir.x * power + vel.x * 0.3, dir.y * power + 0.6, dir.z * power + vel.z * 0.35));
    }
  }
  spawnSpark(impact, 2.6, PALETTE.iceEdge);
  audio.shatter(1.2);
}

function spawnPylons(o, startZ, halfWidth) {
  const O = TUNING.obstacles;
  for (const it of o.items) {
    const geo = new THREE.CylinderGeometry(O.pylonR * 0.7, O.pylonR, O.pylonH, 6);
    const mesh = new THREE.Mesh(geo, pylonMat);
    const x = THREE.MathUtils.clamp(it.x, -halfWidth + 0.8, halfWidth - 0.8);
    mesh.position.set(x, O.pylonH / 2, startZ - it.z);
    scene.add(mesh);
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(O.pylonR, O.pylonH / 2, O.pylonR)),
      position: new CANNON.Vec3(x, O.pylonH / 2, startZ - it.z),
      collisionFilterGroup: G_OBST,
      collisionFilterMask: G_SHOT,
    });
    world.addBody(body);
    const pylon = { mesh, geo, body, x, z: startZ - it.z, broken: false };
    body.ts = { pylon };
    pylons.push(pylon);
  }
}

function shatterPylon(pylon, impact, vel) {
  if (pylon.broken) return;
  pylon.broken = true;
  scene.remove(pylon.mesh);
  pylon.geo.dispose();
  queueRemove(pylon.body);
  const O = TUNING.obstacles;
  for (let i = 0; i < 12; i++) {
    const pos = new THREE.Vector3(
      pylon.x + (Math.random() - 0.5) * O.pylonR * 1.6,
      Math.random() * O.pylonH,
      pylon.z + (Math.random() - 0.5) * O.pylonR);
    const dir = pos.clone().sub(impact);
    const dist = Math.max(0.15, dir.length());
    dir.normalize();
    const power = 4.5 / (1 + dist * 1.2);
    const sz = 0.12 + Math.random() * 0.2;
    spawnShard(pos, sz, sz * 1.5, new THREE.Vector3(
      dir.x * power + vel.x * 0.3, dir.y * power + 0.7, dir.z * power + vel.z * 0.35));
  }
  spawnSpark(impact, 2.6, PALETTE.iceEdge);
  audio.shatter(1.1);
}

// Smashing through terrain face-first: it breaks, and so does a shield.
const PLAYER_HALF = 0.45;
function checkTerrainCrash(dt) {
  if (S.invulnT > 0) return;
  const reach = 0.5 + S.speed * dt;
  for (const p of panes) {
    if (p.broken || p.z < S.camZ - reach || p.z > S.camZ + 0.4) continue;
    if (S.camX + PLAYER_HALF > p.x0 && S.camX - PLAYER_HALF < p.x1) {
      const impact = new THREE.Vector3(S.camX, TUNING.track.eyeHeight, p.z);
      shatterPane(p, impact, new THREE.Vector3(0, 0, -S.speed));
      terrainHit();
      return;
    }
  }
  const O = TUNING.obstacles;
  for (const p of pylons) {
    if (p.broken || p.z < S.camZ - reach || p.z > S.camZ + 0.4) continue;
    if (Math.abs(S.camX - p.x) < O.pylonR + PLAYER_HALF - 0.1) {
      const impact = new THREE.Vector3(p.x, TUNING.track.eyeHeight, p.z);
      shatterPylon(p, impact, new THREE.Vector3(0, 0, -S.speed));
      terrainHit();
      return;
    }
  }
}

function terrainHit() {
  S.shields -= TUNING.obstacles.crashShields;
  S.invulnT = TUNING.player.invuln;
  audio.hurt();
  S.shakeT = 0.45;
  flash('rgba(180,235,255,0.4)', 380);
  updateHUD();
  if (S.shields <= 0) {
    S.mode = 'dead';
    S.deadTimer = 1.0;
    clearPointers();
  } else {
    showMsg('SMASHED THROUGH', 'neon-pink');
  }
}

function cleanupObstacles() {
  const behind = S.camZ + TUNING.track.cleanupBehind;
  for (let i = panes.length - 1; i >= 0; i--) {
    if (panes[i].z > behind) {
      const p = panes[i];
      if (!p.broken) { scene.remove(p.mesh); p.geo.dispose(); queueRemove(p.body); }
      panes.splice(i, 1);
    }
  }
  for (let i = pylons.length - 1; i >= 0; i--) {
    if (pylons[i].z > behind) {
      const p = pylons[i];
      if (!p.broken) { scene.remove(p.mesh); p.geo.dispose(); queueRemove(p.body); }
      pylons.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Acceleration streaks — thin light lines seeded ahead of a passed gate; the
// camera rushing past them at the new speed IS the effect.
// ---------------------------------------------------------------------------
const streaks = [];
const streakMatBase = new THREE.MeshBasicMaterial({
  color: 0xcfefff, transparent: true, opacity: 0.7,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
function spawnStreaks(fromZ) {
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(shardGeo, streakMatBase.clone());
    const side = Math.random() < 0.5 ? -1 : 1;
    m.scale.set(0.035, 0.035, 3 + Math.random() * 5);
    m.position.set(
      side * (1.3 + Math.random() * 4.5),
      0.3 + Math.random() * 4.2,
      fromZ - 6 - Math.random() * 50);
    scene.add(m);
    streaks.push({ mesh: m, life: 1.6 });
  }
}
function updateStreaks(dt) {
  for (let i = streaks.length - 1; i >= 0; i--) {
    const st = streaks[i];
    st.life -= dt;
    st.mesh.material.opacity = 0.7 * Math.max(0, Math.min(1, st.life / 1.2));
    if (st.life <= 0 || st.mesh.position.z > S.camZ + 2) {
      scene.remove(st.mesh);
      st.mesh.material.dispose();
      streaks.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Doors + drones. A drone's life: door → emerge → attack → retreat.
// ---------------------------------------------------------------------------
function triggerPendingEvents() {
  // Gates get a clean approach: remaining enemies break off and flee when a
  // gate is close, and nothing new spawns until the post-gate grace expires.
  const ng = gates.find((g) => !g.passed);
  const gateNear = ng && (S.camZ - ng.z) < TUNING.gates.clearAhead && S.camZ > ng.z;
  if (gateNear) {
    for (const d of drones) {
      if (!d.alive) continue;
      if (d.state === 'attack' || d.state === 'dive') {
        if (d.state !== 'retreat') { d.state = 'retreat'; d.t = 0; }
      } else if (d.state === 'door' || d.state === 'emerge') {
        removeDrone(d); // not fully out yet — the door just closes on them
      }
    }
  }
  if (gateNear || S.gateGraceT > 0) return;

  const cap = Math.round(ramp(TUNING.difficulty.concurrent, S.zoneIdx));
  for (let i = pendingEvents.length - 1; i >= 0; i--) {
    const e = pendingEvents[i];
    if (S.camZ < e.worldZ - 4) { pendingEvents.splice(i, 1); continue; } // missed window
    const ahead = S.camZ - e.worldZ;
    if (ahead > TUNING.enemies.triggerAhead) continue;
    // retreating drones have broken off — they don't hold an attack slot
    const active = drones.filter((d) => d.alive && d.state !== 'retreat').length;
    if (active >= cap) continue;
    pendingEvents.splice(i, 1);
    spawnDroneFromEvent(e);
  }
}

function spawnDroneFromEvent(e) {
  const E = TUNING.enemies;
  // per-drone material clone: the crystal dims once its soul is spent
  const mesh = new THREE.Mesh(droneGeo, droneMat.clone());
  mesh.scale.set(1, 1.35, 1);
  // the telegraph: a wisp — the same glow it fires — growing inside the crystal
  const core = new THREE.Group();
  core.add(sprite(glowWisp, PALETTE.wispCore, 0.34));
  core.add(sprite(glowMagenta, PALETTE.wispHalo, 0.8, 0.55));
  mesh.add(core);
  const halo = sprite(glowIce, 0xffffff, 2.2, 0.75);
  mesh.add(halo);
  // wardens wear an ice shell — one extra hit to crack it open
  let shell = null;
  if (e.kind === 'warden') {
    shell = new THREE.Mesh(new THREE.OctahedronGeometry(E.wardenShellR), shellMat);
    shell.scale.set(1, 1.3, 1);
    mesh.add(shell);
  }
  if (e.kind === 'turret') {
    // wall-riders read as machinery, not crystal fauna
    mesh.geometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    mesh.material = turretMat;
    mesh.scale.set(1, 1, 1);
  }
  scene.add(mesh);

  const hb = E.size + E.hitboxPad;
  const body = new CANNON.Body({
    type: CANNON.Body.KINEMATIC,
    shape: new CANNON.Box(new CANNON.Vec3(hb, hb * 1.35, hb)),
    collisionFilterGroup: G_DRONE,
    collisionFilterMask: G_SHOT,
  });
  world.addBody(body);

  // entrance start position + optional door prop
  let start, door = null, streak = null;
  const doorZ = e.worldZ;
  const hx = THREE.MathUtils.clamp(e.hoverX, -e.halfWidth + 1, e.halfWidth - 1);
  if (e.entrance === 'floor') {
    start = new THREE.Vector3(hx, -0.7, doorZ);
    door = makeDoor('floor', new THREE.Vector3(hx, 0, doorZ));
  } else if (e.entrance === 'wallL' || e.entrance === 'wallR') {
    const side = e.entrance === 'wallL' ? -1 : 1;
    start = new THREE.Vector3(side * (e.halfWidth + 0.6), e.hoverY, doorZ);
    door = makeDoor('wall', new THREE.Vector3(side * e.halfWidth, e.hoverY, doorZ), side);
  } else if (e.entrance === 'ceiling') {
    start = new THREE.Vector3(hx, ZONES.tunnel.ceiling + 0.7, doorZ);
    door = makeDoor('ceiling', new THREE.Vector3(hx, ZONES.tunnel.ceiling, doorZ));
  } else { // 'above' — dive in from the sky trailing light
    start = new THREE.Vector3(hx, e.hoverY + 13, S.camZ - E.engageAhead);
    streak = sprite(glowIce, PALETTE.iceEdge, 1, 0.8);
    streak.scale.set(0.7, 9, 1);
    scene.add(streak);
  }
  mesh.position.copy(start);
  body.position.set(start.x, start.y, start.z);

  const drone = {
    mesh, core, halo, shell, body, door, streak,
    kind: e.kind ?? 'drone',
    fan: !!e.fan,
    hp: e.kind === 'warden' ? 2 : 1,
    side: e.entrance === 'wallL' ? -1 : 1,
    state: door ? 'door' : 'dive',
    t: 0,
    start: start.clone(),
    hoverX: hx, hoverY: e.hoverY,
    strafePhase: Math.random() * Math.PI * 2,
    fireEvery: e.fireEvery,
    nextFire: e.fireEvery * 0.5 + E.telegraph,
    engageLeft: e.engageTime,
    boltSpeed: e.boltSpeed,
    hasFired: false, // beat it to the shot and its soul is yours
    alive: true,
  };
  body.ts = { drone };
  drones.push(drone);
  audio.door();
  if (door) spawnSpark(door.group.position, 2.4, PALETTE.door); // the burst sells the opening
}

function makeDoor(kind, at, side = 0) {
  const g = new THREE.Group();
  const W = 1.5, H = kind === 'wall' ? 1.8 : 1.5, T = 0.06;
  // glowing frame
  const frame = makeRingFlat(W, H, 0.09);
  g.add(frame);
  // two panels that slide apart
  const pGeo = new THREE.BoxGeometry(W / 2 - 0.02, H, T);
  const p1 = new THREE.Mesh(pGeo, doorMat);
  const p2 = new THREE.Mesh(pGeo, doorMat);
  p1.position.x = -W / 4;
  p2.position.x = W / 4;
  g.add(p1, p2);

  if (kind === 'floor') { g.rotation.x = -Math.PI / 2; }
  else if (kind === 'ceiling') { g.rotation.x = Math.PI / 2; }
  else { g.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; }
  g.position.copy(at);
  scene.add(g);
  return { group: g, p1, p2, w: W, open: 0 };
}

function makeRingFlat(w, h, t) {
  const g = new THREE.Group();
  const bar = (bw, bh, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, t), frameMat);
    m.position.set(x, y, 0);
    g.add(m);
  };
  bar(w + t * 2, t, 0, h / 2 + t / 2);
  bar(w + t * 2, t, 0, -h / 2 - t / 2);
  bar(t, h, -w / 2 - t / 2, 0);
  bar(t, h, w / 2 + t / 2, 0);
  return g;
}

function disposeDoor(door) {
  scene.remove(door.group);
  door.group.traverse((c) => c.geometry?.dispose());
}

function updateDrones(dtGame) {
  const E = TUNING.enemies;
  for (const d of drones) {
    if (!d.alive) continue;
    d.t += dtGame;

    // door slide
    if (d.door) {
      const open = d.state === 'door' ? Math.min(1, d.t / E.doorTime)
        : d.state === 'emerge' ? 1
        : Math.max(0, 1 - (d.t - 0.3) / E.doorTime); // closing behind it
      d.door.p1.position.x = -d.door.w / 4 - (d.door.w / 2) * open;
      d.door.p2.position.x = d.door.w / 4 + (d.door.w / 2) * open;
      if (d.state === 'attack' && open <= 0 && !d.door.closed) {
        d.door.closed = true;
        disposeDoor(d.door);
        d.door = null;
      }
    }

    const hoverZ = S.camZ - E.engageAhead;
    if (d.state === 'door') {
      if (d.t >= E.doorTime) { d.state = 'emerge'; d.t = 0; }
    } else if (d.state === 'emerge' || d.state === 'dive') {
      const dur = d.state === 'dive' ? E.diveTime : E.emergeTime;
      const k = Math.min(1, d.t / dur);
      const ease = 1 - (1 - k) * (1 - k);
      d.mesh.position.set(
        THREE.MathUtils.lerp(d.start.x, d.hoverX, ease),
        THREE.MathUtils.lerp(d.start.y, d.hoverY, ease),
        THREE.MathUtils.lerp(d.start.z, hoverZ, ease)
      );
      if (d.streak) {
        d.streak.position.copy(d.mesh.position).y += 4.5;
        d.streak.material.opacity = 0.8 * (1 - k);
        if (k >= 1) { scene.remove(d.streak); d.streak = null; }
      }
      if (k >= 1) {
        d.state = 'attack';
        d.t = 0.31; // past the door-close grace
        // position set → the energy appears NOW and builds for the full
        // telegraph second before the first shot
        d.nextFire = E.telegraph;
        d.chargeSounded = false;
        spawnSpark(d.mesh.position, 2.2, PALETTE.iceEdge);
      }
    } else if (d.state === 'attack') {
      // hover ahead of you, strafing, matching your speed — except turrets,
      // which stay pinned to their wall and slide along it
      const half = Math.max(1, S.trackHalf - 0.9);
      const x = d.kind === 'turret'
        ? d.side * (S.trackHalf - 0.45)
        : THREE.MathUtils.clamp(
            d.hoverX + Math.sin(S.gameTime * 0.9 + d.strafePhase) * 0.8, -half, half);
      const y = d.kind === 'turret'
        ? d.hoverY
        : d.hoverY + Math.sin(S.gameTime * 1.4 + d.strafePhase * 1.7) * 0.25;
      d.mesh.position.x += (x - d.mesh.position.x) * Math.min(1, 3 * dtGame);
      d.mesh.position.y += (y - d.mesh.position.y) * Math.min(1, 3 * dtGame);
      d.mesh.position.z += (hoverZ - d.mesh.position.z) * Math.min(1, 4 * dtGame);
      d.mesh.rotation.y += dtGame * (d.kind === 'turret' ? 0.4 : 1.2);

      // fire cycle: the wisp charges up inside the crystal — a shot being born
      d.nextFire -= dtGame;
      const warn = Math.max(0, 1 - Math.max(0, d.nextFire) / E.telegraph);
      const shimmer = 1 + Math.sin(S.gameTime * (6 + warn * 12)) * 0.1 * warn;
      d.core.scale.setScalar((0.35 + warn * 1.9) * shimmer);
      d.core.children[0].material.opacity = 0.3 + warn * 0.7;
      d.core.children[1].material.opacity = 0.15 + warn * 0.6;
      // the charge-up is audible, not just visible
      if (!d.chargeSounded && warn > 0 && S.mode === 'playing') {
        d.chargeSounded = true;
        audio.charge(E.telegraph);
      }
      // menu (attract mode) drones fire too — bolts just sail past the camera;
      // without this the telegraph wisp sticks at full swell forever
      if (d.nextFire <= 0 && (S.mode === 'playing' || S.mode === 'menu')) {
        if (d.fan) {
          // 3-bolt fan: dodge through the gap between them
          const sp = E.fanSpread;
          fireBolt(d, -sp); fireBolt(d, 0); fireBolt(d, sp);
        } else {
          fireBolt(d);
        }
        // a shard can never fire faster than it charges
        d.nextFire = Math.max(d.fireEvery, E.telegraph);
        d.chargeSounded = false;
      }

      d.engageLeft -= dtGame;
      if (d.engageLeft <= 0) { d.state = 'retreat'; d.t = 0; }
    } else if (d.state === 'retreat') {
      // drones peel off upward; turrets just power down and fall behind
      if (d.kind !== 'turret') d.mesh.position.y += 6 * dtGame;
      d.mesh.rotation.y += dtGame * 3;
    }

    d.body.position.set(d.mesh.position.x, d.mesh.position.y, d.mesh.position.z);

    // recycle once well behind the camera (or retreated far up)
    if (d.mesh.position.z > S.camZ + TUNING.track.cleanupBehind ||
        (d.state === 'retreat' && d.t > 4)) {
      removeDrone(d);
    }
  }
  for (let i = drones.length - 1; i >= 0; i--) {
    if (!drones[i].alive) drones.splice(i, 1);
  }
}

function removeDrone(d) {
  if (!d.alive) return;
  d.alive = false;
  scene.remove(d.mesh);
  d.mesh.material.dispose(); // per-drone clone
  if (d.streak) scene.remove(d.streak);
  if (d.door && !d.door.closed) disposeDoor(d.door);
  queueRemove(d.body);
}

function shatterDrone(drone, impact, shotVel) {
  if (!drone.alive) return;
  const pos = drone.mesh.position.clone();
  drone.body.collisionResponse = false;
  removeDrone(drone);

  const C = TUNING.shatter;
  for (let i = 0; i < C.shardsPerDrone; i++) {
    const off = new THREE.Vector3(
      (Math.random() - 0.5), (Math.random() - 0.5) * 1.5, (Math.random() - 0.5)
    ).multiplyScalar(TUNING.enemies.size * 1.2);
    const p = pos.clone().add(off);
    const dir = p.clone().sub(impact);
    const dist = Math.max(0.12, dir.length());
    dir.normalize();
    const power = C.impulse / (1 + dist * 1.4);
    const vel = new THREE.Vector3(
      dir.x * power + shotVel.x * C.inheritShot,
      dir.y * power + 0.8,
      dir.z * power + shotVel.z * C.inheritShot
    );
    const sz = 0.08 + Math.random() * 0.18;
    spawnShard(p, sz, sz * (0.6 + Math.random()), vel);
  }

  spawnSpark(impact, 3.0, PALETTE.iceEdge);
  audio.shatter(1.1);
  S.stats.kills += 1;
  S.shakeT = Math.max(S.shakeT, 0.14);
  updateHUD();

  // beat it to the trigger and you keep its soul; once it has fired, the
  // soul is spent — the dimmed crystal told you so
  if (!drone.hasFired) spawnSoul(pos, false);
  // debug/replay hook: what the last kill was worth
  window.__timeshard.lastKill = { fired: drone.hasFired, soul: !drone.hasFired };
}

// ---------------------------------------------------------------------------
// Ethereal wisp-bolts — manual kinematics (tunnel-proof sweeps), a bright
// core trailing a comet tail that spirals visually while the true path
// stays straight (fair to dodge). No solid pink dots here.
// ---------------------------------------------------------------------------
function fireBolt(drone, targetOffsetX = 0) {
  if (bolts.length >= TUNING.bolts.maxLive) return;
  const B = TUNING.bolts;
  const from = drone.mesh.position.clone();

  // true intercept solve: you fly toward the bolt, so time-to-hit is set by
  // the CLOSING speed, not the raw distance. (v²−b²)t² − 2·dz·v·t + |D|² = 0
  const px = S.camX, py = TUNING.track.eyeHeight, pz = S.camZ;
  const dx = px - from.x, dy = py - from.y, dz = pz - from.z;
  const v = S.speed, b2 = drone.boltSpeed * drone.boltSpeed;
  const a = v * v - b2, bq = -2 * dz * v, c = dx * dx + dy * dy + dz * dz;
  let t;
  if (Math.abs(a) < 1e-6) t = c / Math.max(0.1, -bq);
  else {
    const disc = bq * bq - 4 * a * c;
    if (disc < 0) t = Math.sqrt(c) / drone.boltSpeed; // no intercept: aim at now
    else {
      const r1 = (-bq - Math.sqrt(disc)) / (2 * a);
      const r2 = (-bq + Math.sqrt(disc)) / (2 * a);
      t = Math.min(r1 > 0.05 ? r1 : Infinity, r2 > 0.05 ? r2 : Infinity);
      if (!isFinite(t)) t = Math.sqrt(c) / drone.boltSpeed;
    }
  }
  // aimLead < 1 aims slightly behind the perfect intercept (dodgeable), and
  // jitter keeps volleys from being a single fair-but-cruel line
  const target = new THREE.Vector3(
    px + targetOffsetX + (Math.random() - 0.5) * B.aimJitter * 2,
    py + (Math.random() - 0.5) * B.aimJitter,
    pz - v * t * B.aimLead
  );
  const vel = target.sub(from).normalize().multiplyScalar(drone.boltSpeed);

  // soul spent: the crystal visibly goes cold
  if (!drone.hasFired) {
    drone.hasFired = true;
    drone.mesh.material.emissiveIntensity = 0.1;
    drone.halo.material.opacity = 0.3;
  }

  if (S.mode === 'playing') audio.laser(); // the release, coming at you

  const group = new THREE.Group();
  const head = sprite(glowWisp, PALETTE.wispCore, 0.55);
  const halo = sprite(glowMagenta, PALETTE.wispHalo, 1.5, 0.3);
  group.add(head, halo);
  const trail = [];
  const cWisp = new THREE.Color(PALETTE.wisp);
  const cHalo = new THREE.Color(PALETTE.wispHalo);
  for (let i = 0; i < B.trailLen; i++) {
    const k = i / (B.trailLen - 1);
    const t = sprite(glowWisp, cWisp.clone().lerp(cHalo, k), 0.42 * (1 - k * 0.75), 0.85 * (1 - k * 0.8));
    group.add(t);
    trail.push(t);
  }
  scene.add(group);
  bolts.push({ group, trail, pos: from.clone(), vel, phase: Math.random() * Math.PI * 2 });
  spawnSpark(from, 1.3, PALETTE.wispHalo);
}

function removeBolt(i, sparkColor = null) {
  const b = bolts[i];
  if (sparkColor) spawnSpark(b.pos, 2.0, sparkColor);
  scene.remove(b.group);
  bolts.splice(i, 1);
}

const _perp1 = new THREE.Vector3(), _perp2 = new THREE.Vector3(), _dirN = new THREE.Vector3();
let lastGrazeMsg = -9;
function updateBolts(dtGame) {
  const B = TUNING.bolts;
  const playerPos = new THREE.Vector3(S.camX, TUNING.track.eyeHeight, S.camZ);
  for (let i = bolts.length - 1; i >= 0; i--) {
    // the mercy blast in playerHit can shrink the array by several entries
    if (i >= bolts.length) { i = bolts.length; continue; }
    const b = bolts[i];
    b.pos.addScaledVector(b.vel, dtGame);

    // spiral dressing around the (straight, fair) path
    _dirN.copy(b.vel).normalize();
    _perp1.set(-_dirN.z, 0, _dirN.x).normalize();
    _perp2.crossVectors(_dirN, _perp1);
    const th = S.gameTime * B.wobbleFreq + b.phase;
    b.group.position.copy(b.pos)
      .addScaledVector(_perp1, Math.sin(th) * B.wobbleAmp)
      .addScaledVector(_perp2, Math.cos(th) * B.wobbleAmp);
    for (let k = 0; k < b.trail.length; k++) {
      const back = (k + 1) * 0.34;
      const tth = th - (k + 1) * 0.55;
      b.trail[k].position.copy(_dirN).multiplyScalar(-back)
        .addScaledVector(_perp1, Math.sin(tth) * B.wobbleAmp * 1.3)
        .addScaledVector(_perp2, Math.cos(tth) * B.wobbleAmp * 1.3);
    }

    if (S.mode === 'playing' && S.invulnT <= 0 &&
        b.pos.distanceTo(playerPos) < TUNING.player.hitRadius) {
      removeBolt(i, PALETTE.wispHalo);
      playerHit();
      continue;
    }
    // near miss: a bolt crossing your plane inside the graze radius (without
    // hitting) refunds focus — dodging CLOSE is how you keep slow-mo flowing
    if (S.mode === 'playing' && !b.grazed && b.pos.z > S.camZ) {
      b.grazed = true;
      const d2 = b.pos.distanceTo(playerPos);
      if (d2 < TUNING.time.nearMissRadius) {
        S.focus = Math.min(TUNING.time.focusMax, S.focus + TUNING.time.nearMissRefund);
        spawnSpark(b.pos, 1.4, 0xffffff);
        if (S.time - lastGrazeMsg > 1.4) {
          lastGrazeMsg = S.time;
          showMsg('CLOSE — +FOCUS', 'neon-ice');
        }
      }
    }
    if (b.pos.z > S.camZ + 2.5 || b.pos.distanceTo(playerPos) > 90) removeBolt(i);
  }
}

// ---------------------------------------------------------------------------
// Souls — the ammo economy. Kills leave one; fly through it to absorb.
// ---------------------------------------------------------------------------
function spawnSoul(pos, ambient) {
  const group = new THREE.Group();
  group.add(sprite(glowSoul, PALETTE.soulCore, 0.7));
  group.add(sprite(glowSoul, PALETTE.soul, 1.9, 0.55));
  group.position.copy(pos);
  scene.add(group);
  souls.push({ group, pos: pos.clone(), ambient, phase: Math.random() * Math.PI * 2, t: 0 });
}

function updateSouls(dtGame) {
  const C = TUNING.souls;
  const playerPos = new THREE.Vector3(S.camX, TUNING.track.eyeHeight, S.camZ);
  for (let i = souls.length - 1; i >= 0; i--) {
    const s = souls[i];
    s.t += dtGame;
    // freshly-freed souls float up to eye level
    if (!s.ambient && s.pos.y < C.riseHeight) s.pos.y += 1.6 * dtGame;
    // gentle homing once you're close — forgiving, not automatic
    const d = s.pos.distanceTo(playerPos);
    if (d < C.homingRadius) {
      s.pos.lerp(playerPos, Math.min(1, C.homingLerp * dtGame));
    }
    s.group.position.copy(s.pos);
    s.group.position.y += Math.sin(S.gameTime * 2.4 + s.phase) * 0.1;
    const pulse = 1 + Math.sin(S.gameTime * 5 + s.phase) * 0.14;
    s.group.children[0].scale.setScalar(0.7 * pulse);
    s.group.children[1].scale.setScalar(1.9 * pulse);

    if (S.mode === 'playing' && d < C.captureRadius) {
      S.ammo = Math.min(TUNING.player.ammoMax, S.ammo + C.ammoBonus);
      S.stats.souls += 1;
      audio.pickup();
      spawnSpark(s.pos, 2.6, PALETTE.soul);
      showMsg(`SOUL +${C.ammoBonus} AMMO`, 'neon-ice');
      scene.remove(s.group);
      souls.splice(i, 1);
      updateHUD();
      continue;
    }
    if (s.pos.z > S.camZ + TUNING.track.cleanupBehind) {
      scene.remove(s.group);
      souls.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Player shots — dynamic chrome shards, ballistic-compensated at launch;
// physics vs drones, manual segment/sphere sweeps vs bolts (tunnel-proof).
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
// Aiming uses a CLEAN camera pose — no steering bank, no shake — so the same
// tap always maps to the same spot in the world. The rolled render camera was
// skewing shots whenever you fired mid-weave.
const aimCam = new THREE.PerspectiveCamera(72, 1, 0.1, 260);
let lastDryMsg = -9;

// Where to aim so a projectile at `speed` meets a target moving at `vel`:
// |P + V·t − O| = s·t. Smallest positive root, else aim at where it is now.
function interceptPoint(origin, pos, vel, speed) {
  const D = pos.clone().sub(origin);
  const a = vel.lengthSq() - speed * speed;
  const b = 2 * D.dot(vel);
  const c = D.lengthSq();
  let t;
  if (Math.abs(a) < 1e-6) t = c / Math.max(0.1, -b);
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) t = Math.sqrt(c) / speed;
    else {
      const r1 = (-b - Math.sqrt(disc)) / (2 * a);
      const r2 = (-b + Math.sqrt(disc)) / (2 * a);
      t = Math.min(r1 > 0.02 ? r1 : Infinity, r2 > 0.02 ? r2 : Infinity);
      if (!isFinite(t)) t = Math.sqrt(c) / speed;
    }
  }
  return pos.clone().addScaledVector(vel, t);
}

function fireShot(clientX, clientY) {
  if (S.ammo <= 0) {
    audio.dryFire();
    if (S.time - lastDryMsg > 1.6) {
      lastDryMsg = S.time;
      showMsg('NO AMMO — CATCH A SOUL', 'neon-pink');
    }
    return;
  }
  S.ammo -= 1;

  aimCam.fov = camera.fov;
  aimCam.aspect = camera.aspect;
  aimCam.position.set(S.camX, TUNING.track.eyeHeight, S.camZ);
  aimCam.rotation.set(0, 0, 0);
  aimCam.updateProjectionMatrix();
  aimCam.updateMatrixWorld();
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, aimCam);
  const ray = raycaster.ray;

  const origin = aimCam.position.clone().add(new THREE.Vector3(0, -0.35, -0.45));
  const spd = TUNING.player.shotSpeed;

  // Soft aim assist: if the tap ray passes near a drone or bolt, aim exactly
  // at it — with a lead solve, because shards fly real-time while the world
  // may be crawling (target's effective velocity scales with timeScale).
  let target = null, bestD = Infinity;
  for (const d of drones) {
    if (!d.alive || d.state === 'door' || d.state === 'retreat') continue;
    const p = d.mesh.position;
    if (p.z > S.camZ - 1) continue; // must be ahead of you
    const perp = ray.distanceToPoint(p);
    if (perp < TUNING.player.aimAssist && perp < bestD) {
      bestD = perp;
      const effVel = new THREE.Vector3(0, 0, -S.speed * S.timeScale);
      target = interceptPoint(origin, p, effVel, spd);
    }
  }
  for (const b of bolts) {
    if (b.pos.z > S.camZ - 1) continue;
    const perp = ray.distanceToPoint(b.pos);
    if (perp < TUNING.player.aimAssistBolt && perp < bestD) {
      bestD = perp;
      const effVel = b.vel.clone().multiplyScalar(S.timeScale);
      target = interceptPoint(origin, b.pos, effVel, spd);
    }
  }
  if (!target) {
    const t = TUNING.player.aimDistance / Math.max(0.2, -ray.direction.z);
    target = ray.origin.clone().addScaledVector(ray.direction, t);
  }

  const disp = target.sub(origin);
  const flight = disp.length() / spd;
  const vel = disp.divideScalar(flight);
  vel.y -= 0.5 * TUNING.player.gravity * flight; // cancel gravity drop at the target

  spawnShot(origin, vel);
  audio.fire();
  S.stats.shots += 1;
  S.shakeT = Math.max(S.shakeT, 0.05);
  updateHUD();
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
    collisionFilterMask: G_DRONE | G_WORLD | G_OBST,
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
  if (!other.ts) return;
  const drone = other.ts ? other.ts.drone : null;
  const cp = new CANNON.Vec3();
  (e.contact.bi === self ? e.contact.bi : e.contact.bj).position.vadd(
    e.contact.bi === self ? e.contact.ri : e.contact.rj, cp);
  const impact = new THREE.Vector3(cp.x, cp.y, cp.z);
  const pv = self.ts.prevVel;
  const shotVel = new THREE.Vector3(pv.x, pv.y, pv.z);

  if (other.ts && other.ts.pane) {
    shatterPane(other.ts.pane, impact, shotVel);
    self.velocity.set(pv.x * 0.85, pv.y * 0.85, pv.z * 0.85);
    return;
  }
  if (other.ts && other.ts.pylon) {
    shatterPylon(other.ts.pylon, impact, shotVel);
    self.velocity.set(pv.x * 0.8, pv.y * 0.8, pv.z * 0.8);
    return;
  }
  if (!drone || !drone.alive || drone.state === 'door') return;

  // a warden's shell soaks the first hit — and shatters, physically
  if (drone.hp > 1) {
    drone.hp -= 1;
    if (drone.shell) {
      drone.mesh.remove(drone.shell);
      drone.shell.geometry.dispose();
      drone.shell = null;
      const c = drone.mesh.position;
      for (let i = 0; i < 8; i++) {
        const off = new THREE.Vector3(
          (Math.random() - 0.5), (Math.random() - 0.5) * 1.4, (Math.random() - 0.5))
          .normalize().multiplyScalar(TUNING.enemies.wardenShellR);
        const sz = 0.08 + Math.random() * 0.12;
        spawnShard(c.clone().add(off), sz, sz * 1.3,
          off.clone().multiplyScalar(4).add(new THREE.Vector3(0, 1, 0)));
      }
      spawnSpark(impact, 2.2, 0xffffff);
      audio.shatter(0.7);
    }
    self.velocity.set(pv.x * 0.7, pv.y * 0.7, pv.z * 0.7);
    return;
  }
  shatterDrone(drone, impact, shotVel);
  self.velocity.set(pv.x * 0.8, pv.y * 0.8, pv.z * 0.8); // punch through
}

const _seg = new THREE.Vector3(), _toB = new THREE.Vector3(), _close = new THREE.Vector3();
function sweepShotsVsBolts() {
  const R = TUNING.bolts.radius + TUNING.bolts.hitboxPad + TUNING.player.shotRadius;
  for (const s of shots) {
    const p0 = s.prevPos;
    const p1 = s.mesh.position;
    _seg.subVectors(p1, p0);
    const len2 = _seg.lengthSq();
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      _toB.subVectors(b.pos, p0);
      const t = len2 > 1e-8 ? THREE.MathUtils.clamp(_toB.dot(_seg) / len2, 0, 1) : 0;
      _close.copy(p0).addScaledVector(_seg, t);
      if (_close.distanceToSquared(b.pos) < R * R) {
        removeBolt(i, 0xffffff);
        audio.deflect();
        S.stats.deflects += 1;
        showMsg('DEFLECT', 'neon-ice');
      }
    }
  }
}

// YOUR shards live outside time (the bullet-time power fantasy): the world
// step only advanced them by dtGame, so top up the integration to real dt —
// full velocity and full gravity — while everything else crawls. Collisions
// still resolve through the physics narrowphase on the updated positions.
function updateShots(dt, dtGame) {
  const extra = Math.max(0, dt - dtGame);
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.age += dt;
    if (extra > 0) {
      const b = s.body;
      b.velocity.y += TUNING.player.gravity * extra;
      b.position.x += b.velocity.x * extra;
      b.position.y += b.velocity.y * extra;
      b.position.z += b.velocity.z * extra;
    }
    if (s.age > TUNING.player.shotTtl || s.body.position.z < S.camZ - 80 ||
        s.body.position.z > S.camZ + 4 || s.body.position.y < -2) {
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
    if (sh.ttl <= 0 || sh.body.position.z > S.camZ + TUNING.track.cleanupBehind) {
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
// Getting hit
// ---------------------------------------------------------------------------
function playerHit() {
  S.shields -= 1;
  S.invulnT = TUNING.player.invuln;
  audio.hurt();
  S.shakeT = 0.5;
  flash('rgba(255,40,90,0.5)', 420);

  // mercy: vaporize anything about to combo you
  const playerPos = new THREE.Vector3(S.camX, TUNING.track.eyeHeight, S.camZ);
  for (let i = bolts.length - 1; i >= 0; i--) {
    if (bolts[i].pos.distanceTo(playerPos) < 4.5) removeBolt(i, PALETTE.wispHalo);
  }
  updateHUD();

  if (S.shields <= 0) {
    S.mode = 'dead';
    S.deadTimer = 1.0;
    clearPointers();
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
  el('ammoCount').textContent = S.ammo;
  el('hudAmmo').style.color = S.ammo <= 3 ? '#ff2fd6' : '#dff6ff';
  el('shardCount').textContent = S.stats.kills;
  el('gateCount').textContent = S.stats.gates;
  el('shields').textContent =
    '◆'.repeat(Math.max(0, S.shields)) + '◇'.repeat(TUNING.player.shields - Math.max(0, S.shields));
}

function updateFocusBar() {
  const k = S.focus / TUNING.time.focusMax;
  el('focusBar').style.width = `${k * 100}%`;
  el('focusBar').style.background = S.focusOk ? '#7fdcff' : '#ff2fd6';
  const full = k >= 0.999;
  el('focusTrack').classList.toggle('full', full);
  el('focusLabel').classList.toggle('full', full);
  el('focusLabel').textContent = full ? 'FOCUS FULL' : 'FOCUS';
}

// In-run directions: pop up at run start, fade out after 5 s.
let howtoTimer = null, howtoFade = null;
function showHowto() {
  const h = el('howto');
  clearTimeout(howtoTimer);
  clearTimeout(howtoFade);
  h.style.display = 'flex';
  h.style.opacity = '1';
  howtoTimer = setTimeout(() => {
    h.style.opacity = '0';
    howtoFade = setTimeout(() => { h.style.display = 'none'; }, 750);
  }, 5000);
}
function hideHowto() {
  clearTimeout(howtoTimer);
  clearTimeout(howtoFade);
  el('howto').style.display = 'none';
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

// Three-column score rows: rank · value · timestamp ("07.14.2026 01:05:26")
function fmtDate(at) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())}.${d.getFullYear()} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fillScoreRows(container, rows) {
  container.innerHTML = rows
    .map(([k, v, d]) => `<div class="dim">${k}</div><div class="v">${v}</div><div class="d">${d}</div>`)
    .join('');
}

// One metric at a time on the start board, switched by chips — no glyph soup.
// Ranks are computed against this device's top runs for the SELECTED metric
// (they become global placements once the leaderboard backend lands).
let startMetric = 'score';
function renderStartBoard() {
  const s = scores.summary();
  el('startHead').textContent = s.history.length
    ? `RECENT RUNS · BEST ${s.allTimeBest}` + (s.streak > 1 ? ` · ${s.streak}\u{1F525}` : '')
    : '';
  el('startChips').style.display = s.history.length ? 'flex' : 'none';
  const val = (r) => startMetric === 'score' ? r.score : (r[startMetric] ?? 0);
  fillScoreRows(el('startRecent'), s.history.slice(0, 3).map((r) => {
    const better = s.top.filter((t) => val(t) > val(r)).length;
    const onBoard = s.top.some((t) => t.at === r.at);
    return [onBoard ? `#${better + 1}` : '—', String(val(r)), fmtDate(r.at)];
  }));
}
for (const chip of document.querySelectorAll('#startChips .chip')) {
  chip.addEventListener('click', () => {
    startMetric = chip.dataset.m;
    for (const c of document.querySelectorAll('#startChips .chip')) {
      c.classList.toggle('on', c === chip);
    }
    renderStartBoard();
  });
}

function showStart() {
  renderStartBoard();
  el('startScreen').classList.add('visible');
  el('overScreen').classList.remove('visible');
  el('pauseScreen').classList.remove('visible');
  el('btnPause').style.display = 'none';
  el('btnSound').style.display = 'block';
  updateSoundLabel();
  hideHowto();
  hud.style.display = 'none';
  S.mode = 'menu';
}

// ---------------------------------------------------------------------------
// Pause menu (settings + local score history/leaderboard live here)
// ---------------------------------------------------------------------------
function pauseGame() {
  if (S.mode !== 'playing') return;
  S.mode = 'paused';
  clearPointers();
  audio.stopMusic();
  el('pauseScore').textContent = `${S.score}m`;
  el('pauseShards').textContent = `ENEMIES ✦${S.stats.kills} · GATES ∩${S.stats.gates}`;
  hideHowto();
  const s = scores.summary();
  const row = (r) => `${r.score} ✦${r.shards ?? 0} ∩${r.gates ?? 0}`;
  fillStats(el('pauseTop'), s.top.length
    ? s.top.slice(0, 5).map((r, i) => [`#${i + 1}  ${r.week}`, row(r)])
    : [['NO RUNS YET', '—']]);
  fillStats(el('pauseRecent'), s.history.length
    ? s.history.slice(0, 5).map((r) => [new Date(r.at).toLocaleDateString(), row(r)])
    : [['NO RUNS YET', '—']]);
  updateSoundLabel();
  el('pauseScreen').classList.add('visible');
  hud.style.display = 'none';
}

function resumeGame() {
  if (S.mode !== 'paused') return;
  S.mode = 'playing';
  el('pauseScreen').classList.remove('visible');
  hud.style.display = 'block';
  if (!audio.muted) audio.startMusic();
}

let overShownAt = 0;
function showGameOver(title = 'YOU DIED') {
  const r = scores.recordRun(S.score, { shards: S.stats.kills, gates: S.stats.gates });
  el('overTitle').textContent = title;
  el('finalScore').textContent = `${S.score}m`;
  el('bestBadge').textContent = r.isAllTimeBest ? '★ NEW ALL-TIME BEST ★'
    : r.isWeekBest ? '★ NEW WEEK BEST ★'
    : r.isDayBest ? 'NEW DAILY BEST' : '';
  const acc = S.stats.shots
    ? Math.round(100 * (S.stats.kills + S.stats.deflects) / S.stats.shots) : 0;
  fillStats(el('overStats'), [
    ['ENEMIES', `✦${S.stats.kills}`],
    ['GATES', `∩${S.stats.gates}`],
    ['DEFLECTS', S.stats.deflects],
    ['SOULS', S.stats.souls],
    ['ACCURACY', `${acc}%`],
    ['WEEK BEST', r.weekBest],
    ['ALL-TIME BEST', r.allTimeBest],
    ['DAY STREAK', `${r.streak}\u{1F525}`],
  ]);
  const sum = scores.summary();
  fillScoreRows(el('overRecent'), sum.history.slice(0, 3).map((h) => {
    const better = sum.top.filter((t) => t.score > h.score).length;
    const onBoard = sum.top.some((t) => t.at === h.at);
    return [onBoard ? `#${better + 1}` : '—', String(h.score), fmtDate(h.at)];
  }));
  el('pauseScreen').classList.remove('visible');
  el('overScreen').classList.add('visible');
  el('btnPause').style.display = 'none';
  hideHowto();
  hud.style.display = 'none';
  audio.stopMusic();
  audio.gameOver();
  overShownAt = performance.now();
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------
function clearWorldObjects() {
  for (const d of drones) removeDrone(d);
  drones.length = 0;
  for (let i = bolts.length - 1; i >= 0; i--) removeBolt(i);
  for (const s of souls) scene.remove(s.group);
  souls.length = 0;
  for (const s of shots) disposeShot(s);
  shots.length = 0;
  for (const sh of shards) { scene.remove(sh.mesh); sh.mesh.material.dispose(); queueRemove(sh.body); }
  shards.length = 0;
  for (const st of streaks) { scene.remove(st.mesh); st.mesh.material.dispose(); }
  streaks.length = 0;
  for (const pn of panes) if (!pn.broken) { scene.remove(pn.mesh); pn.geo.dispose(); queueRemove(pn.body); }
  panes.length = 0;
  for (const py of pylons) if (!py.broken) { scene.remove(py.mesh); py.geo.dispose(); queueRemove(py.body); }
  pylons.length = 0;
  for (const z of zones) {
    for (const m of z.meshes) {
      scene.remove(m);
      m.traverse?.((c) => c.geometry?.dispose());
    }
  }
  zones.length = 0;
  gates.length = 0; // gate meshes belong to their zones (already removed)
  pendingEvents.length = 0;
  flushRemovals();
}

function startRun() {
  clearWorldObjects();
  Object.assign(S, {
    mode: 'playing', shields: TUNING.player.shields, ammo: TUNING.player.ammoStart,
    score: 0, distance: 0, camZ: 0, camX: 0, steerX: 0,
    trackHalf: ZONES.open.halfWidth, zoneIdx: 0, speed: TUNING.speed.base,
    targetSpeed: TUNING.speed.base, gateGraceT: 0, gateT: -1,
    wind: 0, fogFarT: TUNING.track.fogFar, fogFar: TUNING.track.fogFar,
    timeScale: 1, focus: TUNING.time.focusMax, focusOk: true, holdActive: false,
    gameTime: 0, shakeT: 0, invulnT: 0, deadTimer: 0,
    stats: { shots: 0, kills: 0, deflects: 0, souls: 0, gates: 0 },
  });
  trackGen = new TrackGen(weeklySeed(weeklyTag()));
  nextZoneZ = -8;
  streamZones();
  el('startScreen').classList.remove('visible');
  el('overScreen').classList.remove('visible');
  el('pauseScreen').classList.remove('visible');
  el('btnPause').style.display = 'block';
  el('btnSound').style.display = 'none';
  hud.style.display = 'block';
  showHowto();
  updateHUD();
  if (!audio.muted) audio.startMusic();
}

// ---------------------------------------------------------------------------
// Input. One finger HELD = slow time; DRAG it = steer. A second finger's tap
// (or a quick single tap) = fire. Mouse gets the same rules.
// ---------------------------------------------------------------------------
const pointers = new Map(); // pointerId -> {x0,y0,t0,lastX,hold}
let primaryId = null;

function clearPointers() {
  pointers.clear();
  primaryId = null;
}

window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.cornerbtns') || e.target.closest('button')) return;
  audio.unlock();

  if (S.mode === 'menu') { startRun(); return; }
  if (S.mode === 'dead') {
    if (S.deadTimer <= 0 && performance.now() - overShownAt > 600) startRun();
    return;
  }
  if (S.mode !== 'playing') return;

  if (primaryId === null) {
    primaryId = e.pointerId;
    pointers.set(e.pointerId, {
      x0: e.clientX, y0: e.clientY, t0: performance.now(),
      lastX: e.clientX, hold: false,
    });
  } else {
    // second finger while one is held: instant aimed shot
    fireShot(e.clientX, e.clientY);
  }
});

window.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || S.mode !== 'playing') return;
  const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
  if (!p.hold && moved > TUNING.tap.maxMovePx) p.hold = true;
  if (p.hold) {
    const dx = e.clientX - p.lastX;
    S.steerX += (dx / window.innerWidth) * TUNING.steer.sense;
  }
  p.lastX = e.clientX;
});

function onPointerEnd(e, canFire) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (e.pointerId === primaryId) primaryId = null;
  if (!p || S.mode !== 'playing') return;
  const quick = performance.now() - p.t0 < TUNING.tap.maxMs && !p.hold;
  if (quick && canFire) fireShot(e.clientX, e.clientY);
}
window.addEventListener('pointerup', (e) => onPointerEnd(e, true));
window.addEventListener('pointercancel', (e) => onPointerEnd(e, false));

// a press becomes a "hold" purely by lasting long enough
function primaryHoldActive() {
  if (primaryId === null) return false;
  const p = pointers.get(primaryId);
  if (!p) return false;
  return p.hold || performance.now() - p.t0 >= TUNING.tap.maxMs;
}

// Sound: ON by default, preference persisted. The toggle lives in the pause
// menu (per playtest feedback — fewer floating buttons over the action).
const SOUND_KEY = 'timeshard.sound.v1';
try { audio.muted = localStorage.getItem(SOUND_KEY) === 'off'; } catch { /* private mode */ }
audio.musicOn = !audio.muted;

function updateSoundLabel() {
  el('btnSoundToggle').textContent = audio.muted ? 'SOUND: OFF' : 'SOUND: ON';
  el('btnSoundToggle').classList.toggle('off', audio.muted);
  el('btnSound').classList.toggle('off', audio.muted);
}

el('btnPause').addEventListener('click', () => { audio.unlock(); pauseGame(); });
el('btnResume').addEventListener('click', () => { audio.unlock(); resumeGame(); });
el('btnRestart').addEventListener('click', () => { audio.unlock(); startRun(); });
el('btnMenu').addEventListener('click', () => showStart());

// END RUN: bank the run right here — record it and show the final screen.
el('btnEndRun').addEventListener('click', () => {
  if (S.mode !== 'paused') return;
  S.mode = 'dead';
  S.deadTimer = 0;
  showGameOver('RUN ENDED');
});

function toggleSound() {
  audio.unlock();
  audio.setMuted(!audio.muted);
  audio.musicOn = !audio.muted;
  try { localStorage.setItem(SOUND_KEY, audio.muted ? 'off' : 'on'); } catch { /* private mode */ }
  updateSoundLabel();
}
el('btnSoundToggle').addEventListener('click', toggleSound);
el('btnSound').addEventListener('click', toggleSound);

// iOS only counts touchend/click as an audio-unlock gesture — unlocking on
// pointerdown alone left the context suspended until some button was pressed
// (which is why sound seemed to arrive only after opening the pause menu).
window.addEventListener('pointerup', () => audio.unlock());
window.addEventListener('click', () => audio.unlock());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    lastT = null;
    if (S.mode === 'playing') pauseGame(); // stepping away shouldn't cost a run
    else { clearPointers(); audio.stopMusic(); }
  }
});

// ---------------------------------------------------------------------------
// Full-speed ↔ slow-mo presentation: fog, exposure, tint, audio filter
// ---------------------------------------------------------------------------
const flowTint = el('flowTint');
const fogNow = new THREE.Color();

function applyFlowLook(ts) {
  const slow = THREE.MathUtils.clamp((1 - ts) / (1 - TUNING.time.slowScale), 0, 1);
  fogNow.lerpColors(fogFast, fogSlow, slow);
  scene.fog.color.copy(fogNow);
  for (const m of gridMats) m.uniforms.uFog.value.copy(fogNow);
  renderer.toneMappingExposure = 1.1 + slow * 0.25;
  hemi.intensity = 0.9 - slow * 0.25;
  flowTint.style.opacity = (slow * 0.35).toFixed(3);
  audio.setFlow(ts);
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

  if (S.mode === 'paused') { renderer.render(scene, camera); return; } // frozen frame

  // --- the time dial (focus-limited) ---
  const T = TUNING.time;
  S.holdActive = S.mode === 'playing' && primaryHoldActive();
  const wantSlow = S.holdActive && S.focusOk;
  const target = wantSlow ? T.slowScale : 1;
  const rate = target < S.timeScale ? T.rampDown : T.rampUp;
  S.timeScale += (target - S.timeScale) * Math.min(1, rate * dt);
  const slowed = S.timeScale < 0.5;
  if (slowed) {
    S.focus = Math.max(0, S.focus - T.focusDrain * dt);
    if (S.focus <= 0) S.focusOk = false;
  } else {
    S.focus = Math.min(T.focusMax, S.focus + T.focusRegen * dt);
    if (S.focus >= T.reengageAt) S.focusOk = true;
  }
  const dtGame = dt * S.timeScale;
  S.gameTime += dtGame;
  if (S.invulnT > 0) S.invulnT -= dt;

  // --- forward motion + steering (steering reads REAL time: weaving through
  // a slowed world is the whole power fantasy) ---
  if (S.mode === 'playing' || S.mode === 'dead') {
    const glide = S.mode === 'dead' ? Math.max(0, S.deadTimer) : 1;
    S.camZ -= S.speed * dtGame * glide;
    if (S.mode === 'playing') S.distance += S.speed * dtGame;
    if (S.mode === 'playing' && S.wind) S.steerX += S.wind * dtGame; // crosswind
    const clampX = Math.max(0.4, S.trackHalf - TUNING.steer.clampPad);
    S.steerX = THREE.MathUtils.clamp(S.steerX, -clampX, clampX);
    S.camX += (S.steerX - S.camX) * Math.min(1, TUNING.steer.lerp * dt);
    streamZones();
    triggerPendingEvents();
    passGates();
    if (S.mode === 'playing') checkTerrainCrash(dtGame);
    cleanupObstacles();
  } else if (S.mode === 'menu') {
    // attract mode: drift down the track behind the title, drones and all
    S.camZ -= 3 * dt;
    streamZones();
    triggerPendingEvents();
    passGates(); // marks them silently (no fanfare outside a run)
  }

  // --- world update, all on the scaled clock ---
  updateDrones(dtGame);
  updateBolts(dtGame);
  updateSouls(dtGame);
  world.step(Math.max(1e-6, dtGame));
  flushRemovals();
  updateShots(dt, dtGame);
  if (S.mode === 'playing') sweepShotsVsBolts();
  updateShards(dtGame);
  updateSparks(dt); // feedback runs on real time — always snappy
  flushRemovals();

  if (S.mode === 'dead' && S.deadTimer > 0) {
    S.deadTimer -= dt;
    if (S.deadTimer <= 0) showGameOver();
  }

  // gate portals idle-spin; the label sprite stays upright (it's a sibling)
  for (const g of gates) if (!g.passed) g.ring.rotation.z += dt * 0.5;

  // gate-pass speed surge: fov winds UP over ~0.25s (the lurch of
  // acceleration), then eases home slowly as the new speed settles in
  if (S.gateT >= 0) {
    S.gateT += dt;
    const wind = Math.min(1, S.gateT / 0.25);
    const settle = Math.max(0, 1 - Math.max(0, S.gateT - 0.25) / 1.6);
    camera.fov = 72 + wind * settle * 18;
    camera.updateProjectionMatrix();
    if (settle <= 0) { S.gateT = -1; camera.fov = 72; camera.updateProjectionMatrix(); }
  }
  // speed itself eases toward its tier — acceleration, not teleportation
  S.speed += (S.targetSpeed - S.speed) *
    Math.min(1, (3 / TUNING.gates.accelTime) * dt);
  if (S.gateGraceT > 0) S.gateGraceT -= dtGame;
  updateStreaks(dt);

  // --- camera: strafe bank + shake ---
  let sx = 0, sy = 0;
  if (S.shakeT > 0) {
    S.shakeT -= dt;
    const m = S.shakeT * 0.4;
    sx = (Math.random() - 0.5) * m;
    sy = (Math.random() - 0.5) * m;
  }
  const strafeVel = (S.steerX - S.camX) * TUNING.steer.lerp;
  camera.position.set(S.camX + sx, TUNING.track.eyeHeight + Math.sin(S.time * 0.8) * 0.02 + sy, S.camZ);
  camera.rotation.z = THREE.MathUtils.clamp(-strafeVel * TUNING.steer.bank, -0.22, 0.22);

  // environment follows the camera (infinite floor)
  floorMesh.position.z = S.camZ - 120;
  floorMesh.position.x = S.camX * 0.4;
  for (const m of gridMats) m.uniforms.uCam.value.copy(camera.position);

  // fog banks close in and lift smoothly
  S.fogFar += (S.fogFarT - S.fogFar) * Math.min(1, 1.5 * dt);
  scene.fog.far = S.fogFar;
  scene.fog.near = S.fogFar * 0.22;
  for (const m of gridMats) {
    m.uniforms.uFogFar.value = S.fogFar;
    m.uniforms.uFogNear.value = S.fogFar * 0.22;
  }

  applyFlowLook(S.timeScale);

  if (S.mode === 'playing') {
    S.score = Math.floor(S.distance * TUNING.score.perMeter);
    el('hudScore').textContent = `${S.score}m`;
    updateFocusBar();
  }

  renderer.render(scene, camera);
}

showStart();
updateHUD();
requestAnimationFrame(tick);
