// ---------------------------------------------------------------------------
// SYNTHETIC TEST CHARACTER
//
// The real `assets/models/enemy.glb` is still with the artist, but the loading
// path in `src/characters.js` needs something to load or it is only theory.
// This writes a genuine glTF 2.0 binary — not a fixture the loader is lenient
// about — carrying exactly the contract the artist brief promises: a skinned
// mesh, the four named material slots, and a named `walk` clip. If the brief
// changes, change this file too; it is the executable half of the brief.
//
//   node tools/make-test-glb.mjs
//
// Output: test-assets/enemy-test.glb
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A second fixture reproduces what Blender ACTUALLY exports when a material
// datablock name collides: `MAT_CHEST.001`. Pass --mangled to emit it. The
// loader has to map those to the same four slots, because the alternative is
// a silent unrecoloured body group on the artist's very first hand-off.
const MANGLED = process.argv.includes('--mangled');
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets',
  MANGLED ? 'enemy-test-mangled.glb' : 'enemy-test.glb');
const decorate = (n) => (MANGLED ? `${n.toLowerCase()}.001` : n);

// --- binary buffer accumulation --------------------------------------------
//
// Every accessor gets its own bufferView into one buffer. glTF requires each
// view to start on a 4-byte boundary (the largest component we use is 4
// bytes), so the padding here is a spec requirement, not tidiness.
const chunks = [];
let bufLen = 0;

function append(bytes) {
  while (bufLen % 4 !== 0) { chunks.push(Buffer.alloc(1)); bufLen += 1; }
  const byteOffset = bufLen;
  chunks.push(bytes);
  bufLen += bytes.length;
  return byteOffset;
}

const bufferViews = [];
const accessors = [];

const FLOAT = 5126, USHORT = 5123;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

function accessor(bytes, componentType, type, count, target, extra = {}) {
  const byteOffset = append(bytes);
  bufferViews.push({
    buffer: 0, byteOffset, byteLength: bytes.length,
    ...(target ? { target } : {}),
  });
  accessors.push({
    bufferView: bufferViews.length - 1, componentType, count, type, ...extra,
  });
  return accessors.length - 1;
}

const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
const u16 = (a) => Buffer.from(new Uint16Array(a).buffer);

// --- the character ---------------------------------------------------------
//
// Four horizontal quads stacked head-to-toe, one per material slot, each
// weighted entirely to one of two bones. Trivial geometry on purpose: the
// point under test is the rig and the naming, not the modelling.
const SLOTS = [
  { name: decorate('MAT_PELVIS'), y0: 0.0, y1: 0.5, joint: 0, color: [0.78, 0.09, 0.01, 1] },
  { name: decorate('MAT_BODY'),   y0: 0.5, y1: 1.0, joint: 0, color: [0.09, 0.09, 0.11, 1] },
  { name: decorate('MAT_CHEST'),  y0: 1.0, y1: 1.5, joint: 1, color: [1.00, 0.18, 0.10, 1] },
  { name: decorate('MAT_HEAD'),   y0: 1.5, y1: 2.0, joint: 1, color: [0.87, 0.91, 0.93, 1] },
];

const HALF_WIDTH = 0.3;

const primitives = SLOTS.map((slot, i) => {
  const { y0, y1, joint } = slot;
  const position = accessor(
    f32([-HALF_WIDTH, y0, 0, HALF_WIDTH, y0, 0, HALF_WIDTH, y1, 0, -HALF_WIDTH, y1, 0]),
    FLOAT, 'VEC3', 4, ARRAY_BUFFER,
    { min: [-HALF_WIDTH, y0, 0], max: [HALF_WIDTH, y1, 0] },   // required on POSITION
  );
  const normal = accessor(
    f32([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    FLOAT, 'VEC3', 4, ARRAY_BUFFER,
  );
  const joints = accessor(
    u16([joint, 0, 0, 0, joint, 0, 0, 0, joint, 0, 0, 0, joint, 0, 0, 0]),
    USHORT, 'VEC4', 4, ARRAY_BUFFER,
  );
  const weights = accessor(
    f32([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    FLOAT, 'VEC4', 4, ARRAY_BUFFER,
  );
  const indices = accessor(
    u16([0, 1, 2, 0, 2, 3]),
    USHORT, 'SCALAR', 6, ELEMENT_ARRAY_BUFFER,
  );
  return {
    attributes: { POSITION: position, NORMAL: normal, JOINTS_0: joints, WEIGHTS_0: weights },
    indices,
    material: i,
  };
});

// Bone 0 sits at the origin, bone 1 a metre up; the inverse bind matrices are
// therefore identity and a -1 translation. Column-major, as glTF specifies.
const inverseBindMatrices = accessor(
  f32([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1,
  ]),
  FLOAT, 'MAT4', 2,
);

// --- the walk clip ---------------------------------------------------------
//
// One channel: the spine bone swinging about Z and back. Big enough that a
// test can measure the bone actually moving without fighting float noise.
const animInput = accessor(f32([0, 0.5, 1]), FLOAT, 'SCALAR', 3, undefined, { min: [0], max: [1] });
const HALF = Math.sin(0.25), COS = Math.cos(0.25);   // 0.5 rad about Z
const animOutput = accessor(
  f32([0, 0, 0, 1, 0, 0, HALF, COS, 0, 0, 0, 1]),
  FLOAT, 'VEC4', 3,
);

const json = {
  asset: { version: '2.0', generator: 'TIME SHATTER tools/make-test-glb.mjs' },
  scene: 0,
  scenes: [{ name: 'Scene', nodes: [0, 1] }],
  nodes: [
    { name: 'EnemyBody', mesh: 0, skin: 0 },
    { name: 'Bone_Root', children: [2] },
    { name: 'Bone_Spine', translation: [0, 1, 0] },
  ],
  meshes: [{ name: 'EnemyMesh', primitives }],
  skins: [{ name: 'EnemyRig', skeleton: 1, joints: [1, 2], inverseBindMatrices }],
  materials: SLOTS.map((s) => ({
    name: s.name,
    pbrMetallicRoughness: { baseColorFactor: s.color, metallicFactor: 0, roughnessFactor: 1 },
  })),
  animations: [{
    name: 'walk',
    samplers: [{ input: animInput, output: animOutput, interpolation: 'LINEAR' }],
    channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }],
  }],
  bufferViews,
  accessors,
  buffers: [{ byteLength: bufLen }],
};

// --- GLB container ---------------------------------------------------------
// Both chunks are padded to 4 bytes: JSON with spaces, BIN with zeros, per spec.
function pad(buf, filler) {
  const extra = (4 - (buf.length % 4)) % 4;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra, filler)]) : buf;
}

const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
const binChunk = pad(Buffer.concat(chunks), 0x00);

function chunk(data, type) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(data.length, 0);
  header.writeUInt32LE(type, 4);
  return Buffer.concat([header, data]);
}

const body = Buffer.concat([chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);    // 'glTF'
header.writeUInt32LE(2, 4);             // version
header.writeUInt32LE(12 + body.length, 8);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, body]));
console.log(`wrote ${OUT} (${12 + body.length} bytes, ${accessors.length} accessors, bin ${bufLen} B)`);
