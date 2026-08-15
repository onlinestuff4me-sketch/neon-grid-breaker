// ---------------------------------------------------------------------------
// CHARACTER MODELS
//
// The enemy is a procedural hull today (see the sculpt code in main.js). This
// module is the other end of the pipe: it loads a rigged glTF the artist
// delivers as `assets/models/enemy.glb` and hands out cheap instances of it.
//
// It is written to be completely inert until that file exists. Nothing here
// runs at import time, `loadEnemyModel` resolves to `null` rather than
// throwing when the file is missing, and no call site is wired up yet — so
// the game boots and plays exactly as it did before whether or not the asset
// has landed. That is deliberate: swapping the enemy over to a skinned mesh
// is a judgement call that needs the real model in front of us, and it should
// be its own change.
// ---------------------------------------------------------------------------

import * as THREE from '../lib/three.module.min.js';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { clone as cloneSkeleton } from '../lib/SkeletonUtils.js';

// The artist brief fixes these two contracts, so they are the only thing this
// module knows about the model. Anything the brief does not promise, we treat
// as absent rather than as an error — a half-correct export should degrade to
// a missing slot or a missing clip, never to a broken frame.
const SLOT_BY_MATERIAL_NAME = {
  MAT_HEAD: 'head',
  MAT_CHEST: 'chest',
  MAT_PELVIS: 'pelvis',
  MAT_BODY: 'body',
};

// Blender guarantees unique datablock names by suffixing duplicates —
// `MAT_CHEST.001` — and an exporter will happily carry that through. Exact
// matching would then drop the slot SILENTLY, which is the worst failure
// shape available: the model loads, nothing throws, and one body group is
// simply never recoloured. Case and surrounding whitespace are normalised for
// the same reason. This is deliberately forgiving in one direction only: a
// name that is not one of the four is still left alone.
function slotForMaterialName(name) {
  if (!name) return null;
  const key = String(name).trim().replace(/\.\d+$/, '').toUpperCase();
  return SLOT_BY_MATERIAL_NAME[key] || null;
}

export const CLIPS = ['walk', 'aim', 'idle', 'fire', 'lunge', 'hit'];

// Colours only matter so an unmapped instance is visibly wrong in a
// screenshot rather than invisibly wrong; the game overwrites them per enemy.
const SLOT_DEFAULT_COLOR = {
  head: 0xdfe8ec, chest: 0xff2d1a, pelvis: 0xc61703, body: 0x16181d,
};

let gltf = null;          // the parsed document, once
let loadPromise = null;   // in-flight or settled load, so we only fetch once

export function hasModel() {
  return gltf !== null;
}

// Resolves to the parsed gltf, or to `null` if the file is absent or does not
// parse. Callers are expected to branch on the result, not to catch — a
// rejected promise here would surface as an unhandled rejection in the boot
// path and that is exactly the console noise we are avoiding.
export function loadEnemyModel(url = 'assets/models/enemy.glb') {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve) => {
    let loader;
    try {
      loader = new GLTFLoader();
    } catch {
      resolve(null);
      return;
    }
    loader.load(
      url,
      (doc) => {
        // A file that fetches and parses but carries no skinned mesh is not
        // usable as a character, and treating it as a success would only push
        // the failure into makeEnemyInstance.
        if (!doc || !doc.scene || !findSkinnedMesh(doc.scene)) { resolve(null); return; }
        gltf = doc;
        resolve(doc);
      },
      undefined,
      // Three's FileLoader logs its own 404 to the console before it gets
      // here; that is a network log line, not a page error, and the game is
      // shipped with the asset present.
      () => resolve(null),
    );
  });
  return loadPromise;
}

function findSkinnedMesh(root) {
  let found = null;
  root.traverse((o) => { if (!found && o.isSkinnedMesh) found = o; });
  return found;
}

// Every mesh material slot, flattened — a multi-material mesh exposes an
// array, a single-material mesh a bare material, and the brief allows either.
function eachMaterialSlot(root, fn) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    if (Array.isArray(o.material)) {
      for (let i = 0; i < o.material.length; i++) fn(o, i, o.material[i]);
    } else if (o.material) {
      fn(o, -1, o.material);
    }
  });
}

function assignSlot(mesh, index, material) {
  if (index < 0) mesh.material = material; else mesh.material[index] = material;
}

// Returns a fresh, independently-skinned enemy sharing the loaded geometry,
// or `null` when there is no model. `mats` is keyed by slot, and its values
// are materials this instance owns — the game recolours enemies per wave and
// per element, so instances must not share material objects with each other
// or with the artist's originals.
export function makeEnemyInstance() {
  if (!gltf) return null;

  // SkeletonUtils.clone is what makes one load serve many enemies: a plain
  // Object3D.clone() copies the bone hierarchy but leaves every SkinnedMesh
  // bound to the ORIGINAL skeleton, so all the copies animate as one.
  const root = cloneSkeleton(gltf.scene);

  const mats = { head: null, chest: null, pelvis: null, body: null };
  eachMaterialSlot(root, (mesh, index, material) => {
    const slot = slotForMaterialName(material && material.name);
    if (!slot) return;
    // One material per slot even if several meshes share the slot name, so
    // recolouring a slot moves everything that belongs to it.
    if (!mats[slot]) {
      mats[slot] = new THREE.MeshLambertMaterial({ color: SLOT_DEFAULT_COLOR[slot] });
      mats[slot].name = material.name;
    }
    assignSlot(mesh, index, mats[slot]);
  });

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of gltf.animations || []) {
    if (clip && clip.name) actions[clip.name] = mixer.clipAction(clip);
  }

  let current = null;
  function play(clipName, fadeSeconds = 0.15) {
    const next = actions[clipName];
    // Missing clips are a delivery problem, not a runtime one: keep playing
    // whatever we were playing rather than dropping the enemy to a T-pose.
    if (!next || next === current) return current;
    next.reset().play();
    if (current) current.crossFadeTo(next, Math.max(0, fadeSeconds), false);
    else if (fadeSeconds > 0) { next.fadeIn(fadeSeconds); }
    current = next;
    return next;
  }

  return {
    root,
    mixer,
    mats,
    play,
    // Named clips this particular instance actually has, so a caller can
    // check rather than discover by silence.
    clips: Object.keys(actions),
    current: () => current,
    // Materials and the mixer's internal caches are per-instance; geometry
    // and clips belong to the shared document and are deliberately left be.
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      for (const k of Object.keys(mats)) if (mats[k]) mats[k].dispose();
    },
  };
}

// Test seam. The loader memoises hard on purpose (one fetch per page life),
// which a test that wants to try both a good and a missing URL cannot work
// around otherwise.
export function _resetForTests() {
  gltf = null;
  loadPromise = null;
}
