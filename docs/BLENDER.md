# Blender brief — rigged enemies for TIME SHATTER

What to build, to what spec, and how to hand it over. **Read section 1 before
opening Blender** — the most common way this goes wrong is making something
beautiful that the game cannot use.

---

## 0. The single most important constraint

**Do not sculpt detail. Do not texture. Do not add materials.**

The reference is deliberately low-poly, untextured and flat-shaded, and so is
our game. What makes our enemies look crude is not polygon count — it is that
they have **no hands, no weapon actually held, and no animation**. Their limbs
are rotated by arithmetic in `updateEnemy`.

So the whole job is **silhouette and motion**, not surface. A 900-triangle
figure with a real walk cycle will look dramatically better than a
20,000-triangle sculpt that slides around stiffly.

The game assigns every enemy's colour at runtime. **Any material you assign
will be replaced.** What it cannot do is invent groups that are not there, so
what matters is that the mesh is *split into the right four slots*.

---

## 1. Hard requirements

Get these wrong and the model cannot be loaded without rework.

| | Spec | Why |
|---|---|---|
| **Export format** | **glTF 2.0 Binary (`.glb`)** | The only format three.js loads without extra parsers. |
| **Units** | Metres. **Figure is 1.8 m tall.** | The whole game is metric — cover heights, sight lines and the 1.35 m muzzle line are all tuned to a 1.8 m enemy. |
| **Up axis** | **+Y up, −Z forward** | glTF convention. Blender's exporter does this for you; do not "fix" it. |
| **Origin** | **Between the feet, on the floor**, at world origin | The game sets `pos.y = 0` and expects feet on the ground. |
| **Triangle budget** | **≤ 1,500 per enemy** | Up to 6 on screen plus 500 instanced shards. |
| **Bones** | **≤ 24**, single armature | Skinning cost is per-bone per-vertex. |
| **Influences** | **Max 4 bones per vertex** (Blender: Limit Total → 4) | More than 4 is silently dropped by glTF and deforms wrongly. |
| **Modifiers** | **Apply all** except Armature | Un-applied modifiers do not export. |
| **Transforms** | **Apply all** (Ctrl+A → All Transforms) | A non-uniform scale on an armature breaks skinning. |
| **Materials** | Exactly **four**, named below | The game shades each group separately, per enemy type. |

### The four material slots — this is the part people miss

Name them exactly. The game looks them up by name and replaces them.

| Slot name | Covers |
|---|---|
| `MAT_HEAD` | head, neck |
| `MAT_CHEST` | torso, shoulders |
| `MAT_PELVIS` | hips, upper legs |
| `MAT_BODY` | arms, forearms, hands, lower legs, feet |

Four rather than one because the game shades them separately per enemy type —
the sniper is darker, the rusher hotter — and because on the **armored unit
the head is a bright red weak point on an otherwise grey body**, which is the
only way a player knows where to shoot it. A single-material figure makes
that enemy look unkillable.

---

## 2. What to actually model

One base figure. Every enemy type is a variation, and **variations are cheap
if the rig is shared** — same skeleton, different proportions and props.

### The base figure

- **Faceted, not smooth.** Flat shading throughout. No subdivision surface, no
  smooth normals. The planes catching light differently is the entire look.
- **Featureless head.** No face. A blank angular head is more menacing and
  ages better than a bad face.
- **Real hands.** Even blocky ones. This is the single biggest silhouette
  upgrade available — our current enemies end in stumps, and it shows most in
  exactly the frames a player looks hardest at.
- **Slight forward lean.** They advance on you; they should look like it.

### Rig

A standard humanoid chain is plenty:

```
root → hips → spine → chest → neck → head
                    → shoulder.L/R → upperarm → forearm → hand
       hips        → thigh.L/R → shin → foot
```

That is 21 bones with both sides. Name them anything consistent; I map them on
import. **One armature, no IK constraints in the export** — bake IK to FK
before exporting, since glTF stores only the resulting transforms.

---

## 3. The animations — in priority order

Export as **separate NLA strips** or separate actions; the glTF exporter
writes each as a named clip and three.js `AnimationMixer` plays them by name.

**Build them in this order and stop wherever you run out of time.** Even the
first two alone would transform the game.

| # | Clip name | Length | What it is |
|---|---|---|---|
| 1 | `walk` | 1.0 s, **looping** | The advance. Most-seen animation by an order of magnitude. Keep the arms low and the stride short — a *stalk*, not a march. |
| 2 | `aim` | 0.6 s, **not looping** | Gun comes up to the shoulder. This is the game's **primary warning that a shot is coming**, so the pose must read clearly from the front at 8–20 m on a phone. |
| 3 | `idle` | 2.0 s, looping | A breathing shift, very subtle. Plays when they hold position. |
| 4 | `fire` | 0.25 s | Recoil kick from the aim pose. Additive on top of `aim` if you can; a standalone clip is fine. |
| 5 | `lunge` | 0.5 s | The rusher's attack. Needs an unmistakable **wind-up** in the first 60% — the player reads that windup to dodge, so exaggerate it beyond what looks natural. |
| 6 | `hit` | 0.2 s | A stagger. Optional; the shatter mostly covers this. |

Two notes that matter more than they sound:

- **`walk` must loop seamlessly.** First and last keyframe identical, and no
  root translation — the game moves the body, the animation only cycles the
  limbs. Root motion would fight the movement code and double the speed.
- **`aim` must end in a pose that holds.** The game freezes on the last frame
  while the enemy waits its turn to fire; a final pose caught mid-motion looks
  stuck rather than held.

---

## 4. Export settings

`File → Export → glTF 2.0 (.glb)`

- **Format** glTF Binary (`.glb`)
- **Include** → Limit to **Selected Objects** (mesh + armature only)
- **Transform** → **+Y Up** ✓
- **Data → Mesh** → Apply Modifiers ✓, UVs ✗, Normals ✓, Tangents ✗, Vertex Colors ✗
- **Data → Material** → **No Export** *(the game replaces them; exporting materials only bloats the file)*
- **Data → Shape Keys** ✗
- **Animation** → ✓, **Group by NLA Track** ✓, Always Sample Animations ✓,
  **Optimize Animation Size** ✓
- **Animation → Rest & Ranges** → Use Current Frame ✗, Limit to Playback Range ✓

Target file size: **under 400 KB**. If it is over 1 MB something unintended is
in there — usually materials, textures or an un-culled subdivision modifier.

---

## 5. Handing it over

Drop the file at `assets/models/enemy.glb` in the repo and tell me. I will:

1. Vendor `GLTFLoader` (~50 KB) — three.js core already has `SkinnedMesh` and
   `AnimationMixer`, so nothing else is needed.
2. Load once and **clone per enemy** with `SkeletonUtils.clone`, so six on
   screen is one load.
3. Map your bone names and material slots to the game's.
4. Drive the mixer from the existing state machine — `advance` → `walk`,
   `aim` → `aim`, and so on — with crossfades.
5. Keep the shatter working: the shard cloud is spawned from the body's world
   position, so it is independent of how the body is built.

**Send me one enemy first**, before doing any variations. I will load it, tell
you what looks wrong at actual game distance on a phone, and then you make the
rest. Getting one right and iterating beats making eight and finding a
systematic problem in all of them.

---

## 6. If you would rather not model

Two honest alternatives, in order:

1. **Buy a base mesh.** A rigged low-poly humanoid from Sketchfab or Quaternius
   (many CC0) gets you a correct rig and clean topology, and you retopologise
   the silhouette to taste. Check the licence allows commercial use.
2. **Mixamo for animation only.** Upload your mesh, get a rigged skeleton and
   professional clips free. The rig it produces is glTF-compatible. Watch two
   things: its bone count can exceed 24 (delete the finger bones — at our
   distance they cost skinning time and change nothing), and its default clips
   have root motion that must be disabled on export.

Either path still needs section 1's constraints applied before export.
