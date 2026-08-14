// Regenerates docs/BALANCE.md from src/balance.js — the values in the doc can
// never drift from the values the game reads, because they are the same
// objects. Run after changing anything in src/balance.js:
//
//   node tools/gen-balance-doc.mjs
//
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  WEAPONS, TYPE_INTRO, TYPE_SHARE, TYPE_DROP, DROPS, RAMP, COMP, LEG, PACING, TIME,
  SHATTER, SCARCITY, scarcity,
} from '../src/balance.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const n = (v) => (v === Infinity ? '∞' : String(Math.round(v * 1000) / 1000));
const s2 = (v) => v.toFixed(2).replace(/\.?0+$/, '');

const diffT = (w) => Math.min((w - 1) / RAMP.rampWaves, 1);
const speed = (w) => RAMP.bulletBase * Math.min(
  RAMP.bulletFloor + RAMP.bulletRange * diffT(w) +
  Math.max(0, w - (RAMP.rampWaves + 1)) * RAMP.lateCreep, RAMP.bulletCap);
const aim = (w) => RAMP.aimBase - RAMP.aimRange * diffT(w);
const drain = (w) => RAMP.drainFloor + RAMP.drainRange * diffT(w);

const NOTES = {
  knife: 'melee only, front arc', pistol: 'the only deep clip',
  shotgun: '6 pellets, spread 0.055', burst: '3-round burst, 0.09 s apart',
  sniper: 'pierces 3', launcher: '5.5 m blast', rocket: '8.0 m blast',
};
const ROLES = {
  gunner: 'the backbone', rusher: 'telegraphed lunge, packs of 3–4',
  shotgunner: 'close-range cloud', shieldbearer: 'attrition: flank the plate',
  heavy: '3-round burst', sniper: 'long telegraph, heavy round',
  bomber: 'area denial', armored: 'attrition: headshots only',
  rocketeer: 'homing missile', laser: 'unavoidable sweep',
};

const weaponRows = Object.entries(WEAPONS).map(([k, w]) =>
  `| ${k} | ${n(w.mag)} | ${w.maxClips} | ${w.reload ? n(w.reload) : '—'} | ${n(w.cd)} | ${w.speed || '—'} | ${NOTES[k] || ''} |`).join('\n');

const enemyRows = Object.keys(TYPE_INTRO).map((k) => {
  const sh = TYPE_SHARE[k];
  return `| ${k} | ${TYPE_INTRO[k]} | ${sh ? sh[0] : '—'} | ${sh ? sh[1] : '—'} | ${TYPE_DROP[k] || '—'} | ${ROLES[k] || ''} |`;
}).join('\n');

const rampRows = [1, Math.ceil((RAMP.rampWaves + 1) / 2), RAMP.rampWaves + 1]
  .map((w) => `| wave ${w} | ${n(speed(w))} | ${n(aim(w))}× | ${n(drain(w))}× |`).join('\n');

const md = `# TIME SHATTER — balance reference

<!-- GENERATED FILE — do not edit by hand.
     Source of truth: src/balance.js
     Regenerate:      node tools/gen-balance-doc.mjs -->

Every tunable number the game reads, straight out of \`src/balance.js\`. The
game imports that file, this document is generated from it, and the Balance
Tuner artifact mirrors the same shape — so none of the three can drift.

---

## Scarcity — the primary levers

The loop the game is about: **limited ammo** forces you to hide, pick your
shots and freeze time to line them up → **limited time** forces you to hoard
the freeze, so when you spend it you make it count → out of both, you close
with a knife and freezing is the only way to land the jab.

A beginner sprays and never notices. The moment ammo gets tight the whole
game becomes resource management, and that is the fun. So these four are the
top-level dials and everything below is detail. Doors 1–3 stay generous —
that is where you learn to spray. 4–6 tighten. By 8 you are counting rounds.

Each curve is keyframes of \`[door, multiplier]\`, linearly interpolated and
flat outside its ends.

| Door | Ammo drops | Weapon drops | Time per kill | Time drain | Leg size | Group size |
|---|---|---|---|---|---|---|
${[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((d) => `| ${d} | ${scarcity('ammoDrop', d).toFixed(2)}× | ${scarcity('weaponDrop', d).toFixed(2)}× | ${scarcity('timeGain', d).toFixed(2)}× | ${scarcity('timeDrain', d).toFixed(2)}× | ${scarcity('legSize', d).toFixed(2)}× | ${scarcity('groupSize', d).toFixed(2)}× |`).join('\n')}

What each multiplies:

| Curve | Multiplies | Effect |
|---|---|---|
| \`ammoDrop\` | \`DROPS.clipRate\` (${n(DROPS.clipRate)}) | how often a kill leaves a pistol clip |
| \`weaponDrop\` | the per-type weapon drop chance | falls slower than ammo — a floor gun matters more once clips dry up |
| \`timeGain\` | \`TIME.bonus\` (${n(TIME.bonus)} s) | seconds of bank refunded per kill |
| \`timeDrain\` | the drain rate while frozen | above 1× the bank empties faster |
| \`legSize\` | \`LEG.perCell\` | total enemies in the level |
| \`groupSize\` | \`maxAlive\` | how many can be on you at once |

Raw keyframes:

\`\`\`js
${Object.entries(SCARCITY).map(([k, v]) => `${k.padEnd(11)}: ${JSON.stringify(v)}`).join('\n')}
\`\`\`

## Weapons

A weapon holds **\`mag\` bullets per clip** and up to **\`maxClips\` spares**.
Reload burns one spare and runs on **real time**, so freezing the world never
refills a gun. Picking up a weapon you already carry adds a clip. Empty every
clip and you drop to the knife.

| Weapon | Rounds / clip | Max clips | Reload (s) | Fire cd (s) | Muzzle speed | Notes |
|---|---|---|---|---|---|---|
${weaponRows}

## Enemies

The debut wave headlines its type: it spawns first and gets a warning card.
After that the type fills in at \`min(cap, floor(total / share))\` per wave.

| Enemy | Debut | Fill share | Fill cap | Drops | Role |
|---|---|---|---|---|---|
${enemyRows}

Drop chances live per-type in \`ENEMY_TYPES\` in \`src/main.js\`; the table above
is what each one leaves behind when it rolls.

## Drops and collection

| Knob | Value | Meaning |
|---|---|---|
| \`clipRate\` | ${n(DROPS.clipRate)} | chance a non-weapon kill leaves a pistol clip |
| \`life\` | ${n(DROPS.life)} s | time on the floor before it sinks |
| \`pickupR\` | ${n(DROPS.pickupR)} m | walk this close and it is yours |

There is **no magnet**. A drop stays where it fell, so crossing the room for
it is a real decision — which is the whole point of collecting on foot.

## Difficulty ramp

\`diffT\` runs 0 → 1 across **${RAMP.rampWaves} waves** (full heat at wave
${RAMP.rampWaves + 1}). In Rush Hour the wave number is replaced by
\`1 + rushT / 25\`, so it ramps on the run clock instead.

| | Bullet speed (m/s) | Telegraph scale | Slow-mo cost |
|---|---|---|---|
${rampRows}

Past wave ${RAMP.rampWaves + 1}, speed creeps ${n(RAMP.lateCreep * 100)} % per
wave to a hard cap of ${n(RAMP.bulletCap)}× base. Rush Hour drains the bank at
a flat ${n(RAMP.rushDrain)}×. An enemy must be in view for
**${n(RAMP.sightGrace)} s** before its telegraph may begin.

## Wave composition

- **Total** = \`min(${COMP.baseTotal} + ${COMP.perWave}n, ${COMP.totalCap})\`
- **Rushers** (once debuted) = \`min(round(total × ${n(COMP.rusherFrac)}), 2 + n)\`
- **Debut type** gets \`max(2, round(total × ${n(COMP.debutFrac)}))\`
- **Gunners** keep at least ${n(COMP.gunnerFloor * 100)} % of the wave

Tunnel legs do not use a wave total at all — see below.

## The tunnel leg, stretch by stretch

A leg is a chain of **stretches** — one straight run plus the turn that ends
it — followed by the **approach**, the straight stare down at the door. A
**vault** leg replaces one of its turns with a pillared room: one framed
doorway in, one out on the far side offset laterally so you must cross it,
four columns down the middle, and no branch lane may reach it. The room is
its own stretch, so it gets its own share of the wave.

**Cover comes in grades.** Everything in the tunnel used to be
floor-to-ceiling, so every occluder was binary. \`coverLowH\` is not a taste
value: the enemy's sight ray and his muzzle both sit at **1.35 m** and the
player's eye at **1.6 m**, so a **1.45 m** block hides him from you
completely while you see over it and shoot down. \`segAABB\` is 3D so bullets
and line of sight respect the height with no engine change, and
\`pointInObstacle\` is 2D so you still cannot walk over it.

**Width is the axis a portrait phone cannot show.** The camera is 80° in
three.js, which is *vertical* — at 390×844 that is only **42.4° horizontal**,
under half the reference's 90°. Visible width is \`0.776 × distance\`, so from
the entry of a 16 m-deep room you frame 12.4 m of the far wall. A 20 m room
would hide 8 m of itself permanently. Budget that would have gone into floor
area goes into height (\`beamDrop\`) and cover grading instead. A
stretch's share of the wave is released when you **walk into it**, so the
fight travels with you and nothing can accumulate in front of the door. The
approach is worth exactly one group: the final wave you clear with the door
in frame.

| Knob | Value | Meaning |
|---|---|---|
| \`fwdBase\` / \`fwdVar\` | ${LEG.fwdBase} + 0–${LEG.fwdVar - 1} cells | forward length of a normal leg (${LEG.fwdBase * LEG.cellM}–${(LEG.fwdBase + LEG.fwdVar - 1) * LEG.cellM} m before jogs) |
| \`fwdGauntlet\` | ${LEG.fwdGauntlet} + 0–${LEG.fwdGauntletVar - 1} cells | ...and of a gauntlet |
| \`runBase\` / \`runVar\` | ${LEG.runBase} + 0–${LEG.runVar - 1} cells | one stretch's straight, ${LEG.runBase * LEG.cellM}–${(LEG.runBase + LEG.runVar - 1) * LEG.cellM} m |
| \`runServiceRun\` | ${LEG.runServiceRun} + 0–${LEG.runServiceVar - 1} | a service run turns constantly |
| \`runGauntlet\` | ${LEG.runGauntlet} + 0–${LEG.runGauntletVar - 1} | a gauntlet barely turns at all |
| \`approach\` | ${LEG.approach} cells (${LEG.approach * LEG.cellM} m) | straight run in front of the door |
| \`vaultWide\` / \`vaultDeep\` | ${LEG.vaultWide} × ${LEG.vaultDeep} cells (${LEG.vaultWide * LEG.cellM} × ${LEG.vaultDeep * LEG.cellM} m) | the vault room |
| \`vaultDoorW\` | ${n(LEG.vaultDoorW)} m | its two framed doorways |
| \`vaultExitOffset\` | ${LEG.vaultExitOffset} cells (${LEG.vaultExitOffset * LEG.cellM} m) | how far the exit sits off the entry line |
| \`vaultSpawnMin\` | ${LEG.vaultSpawnMin} m | \`spawnMin\` would push refills out of a 16 m room |
| \`pillarW\` × \`pillarD\` | ${n(LEG.pillarW)} × ${n(LEG.pillarD)} m | columns are rectangular, wide face across the crossing |
| \`pillarsChamber\` | ${LEG.pillarsChamber} | two rows, not one — each row is a spawn shadow |
| \`coverLowH\` | ${n(LEG.coverLowH)} m | LOW cover: see over, cannot shoot through |
| \`coverLowW\` × \`coverLowD\` | ${n(LEG.coverLowW)} × ${n(LEG.coverLowD)} m | its footprint |
| \`beamDrop\` / \`beamW\` | ${n(LEG.beamDrop)} / ${n(LEG.beamW)} m | ceiling beams — soffit lands at ${n(3.1 - LEG.beamDrop)} m |
| \`perCell\` | ${n(LEG.perCell)} + ${n(LEG.perCellPerDoor)}·door | bodies per corridor cell, capped at ${n(LEG.perCellCap)} |
| \`stretchMin\` / \`stretchCap\` | ${LEG.stretchMin} / ${LEG.stretchCap} | no stretch is ever emptier or fuller |
| \`finaleWave\` | ${LEG.finaleWave} | the one final group waiting at the door |
| \`lookahead\` | ${LEG.lookahead} | stretches past yours that may also spawn |
| \`spawnMin\` / \`spawnMax\` | ${LEG.spawnMin}–${LEG.spawnMax} m | how far ahead a corridor spawn may appear |

**Leg total** = \`round(bodyCells × perCell(door)) + ${LEG.finaleWave}\`, split
between the stretches in proportion to their length. A longer corridor is a
bigger fight because there is more of it — not because a number went up, and
not because it happens to turn more often. Budgeting by stretch *count* would
make a zig-zagging service run, which is shorter to walk, the bigger fight.

## Spawn pacing

| Knob | Tunnel | City / Rush |
|---|---|---|
| Alive at once | \`min(${PACING.hallAliveBase} + ⌊wave/2⌋, ${PACING.hallAliveCap})\` | \`min(${PACING.cityAliveBase} + ⌊wave/2⌋, ${PACING.cityAliveCap})\` |
| Gap when empty | ${n(PACING.hallEmptyGap)} s | — |
| Gap when busy | \`${n(PACING.hallFullGap)} + ${n(PACING.hallFillGap)}·fill\` | \`${n(PACING.cityBaseGap)} + ${n(PACING.cityFillGap)}·fill\` |
| Gap after a kill | pulled to ${n(PACING.killPullMin)}–${n(PACING.killPullMin + PACING.killPullRange)} s | same |

All gaps are multiplied by a 0.85–1.15 jitter. Spawns are suppressed while a
message card is on screen, and in the tunnel they are hard-gated to at least
**${n(PACING.aheadMin)} m ahead** of the player, and to the stretch the player
is in (plus ${LEG.lookahead}). The last **${LEG.finaleWave}** of a leg stage on
the door approach, in line of sight of the slab, so the door opens in view.

## Time control

| Knob | Value | Meaning |
|---|---|---|
| \`base\` | ${n(TIME.base)} s | bank at wave start, and the floor each wave |
| \`bonus\` | ${n(TIME.bonus)} s | refunded per kill |
| \`cap\` | ${n(TIME.cap)} s | bank ceiling |
| \`drain\` | ${n(TIME.drain)} | seconds spent per second frozen, before ramp scaling |
| \`slowScale\` | ${n(TIME.slowScale)} | world speed while standing still |
| \`moveScale\` | ${n(TIME.moveScale)} | world speed at full stick |

### Where you hit

The kill bonus is multiplied by where the round landed. It pays in **seconds
rather than points** on purpose: as ammo tightens and \`timeGain\` falls with
depth, precision becomes the only way to keep the bank alive. Points would
sit outside that loop.

A knife jab is always a body hit — part of the cost of closing — and a blast
has no single wound, so it pays the flat rate.

| Zone | × bonus | At door 1 | At door 8 |
|---|---|---|---|
${SHATTER.zoneOrder.map((k) => `| ${k} | ${n(TIME.partBonus[k])}× | ` +
  `${s2(TIME.bonus * TIME.partBonus[k] * scarcity('timeGain', 1))} s | ` +
  `${s2(TIME.bonus * TIME.partBonus[k] * scarcity('timeGain', 8))} s |`).join('\n')}
| blast / no wound | 1× | ${s2(TIME.bonus * scarcity('timeGain', 1))} s | ${s2(TIME.bonus * scarcity('timeGain', 8))} s |

---

## The shatter

${n(SHATTER.perKill)} pieces per body from a pool of ${n(SHATTER.pool)} instanced slots
(materialising enemies draw on their own pool of ${n(SHATTER.assemblePool)}, so a
big fight cannot starve the effect the game opens with).

Sizes are **scale multipliers** on a shared tetrahedron of circumradius 0.12,
so an edge is 0.196 × scale. Two classes in every burst: ${Math.round(SHATTER.chunkFrac * 100)}%
are chunks big enough to follow with your eye, and the rest is grit.

| Knob | Value | Meaning |
|---|---|---|
| \`chunkFrac\` | ${n(SHATTER.chunkFrac)} | share that are big pieces |
| \`chunkMin\` / \`chunkVar\` | ${n(SHATTER.chunkMin)} / ${n(SHATTER.chunkVar)} | chunk scale range |
| \`gritMin\` / \`gritVar\` | ${n(SHATTER.gritMin)} / ${n(SHATTER.gritVar)} | grit scale range, weighted small by \`gritCurve\` ${n(SHATTER.gritCurve)} |
| \`speedBase\` / \`speedVar\` | ${n(SHATTER.speedBase)} / ${n(SHATTER.speedVar)} | m/s, most slow with a fast tail |
| \`impulse\` / \`impulseVar\` | ${n(SHATTER.impulse)} / ${n(SHATTER.impulseVar)} | shove along the killing blow |
| \`rise\` | ${n(SHATTER.rise)} | upward bias, so the cloud sits above the wound |
| \`drag\` / \`spin\` | ${n(SHATTER.drag)} / ${n(SHATTER.spin)} | settle rate, rad/s per axis |
| \`life\` / \`lifeVar\` | ${n(SHATTER.life)} / ${n(SHATTER.lifeVar)} s | seconds on screen |
| \`breakWindow\` | ${n(SHATTER.breakWindow)} s | world time a single zone crumbles over |

### The per-part break

The body is four zones. The zone you hit throws **${n(SHATTER.hitShare)}× its share**
of the pieces at **${n(SHATTER.hitSpeed)}× the speed**, and the rest follow outward
at **${n(SHATTER.cascade)} s of world time per zone away from the wound** — so a
headshot reads as a head coming off and the body collapsing after it.

The mesh is hidden zone by zone on the same clock, rather than removed on the
frame of the kill. Otherwise a zone whose shards are still held would be
neither mesh nor debris, and in bullet time that gap stretches with
everything else.

Weights are renormalised, so every kill throws the same amount of debris —
only its distribution moves.

| Zone | Height (m) | Share | Lateral spread |
|---|---|---|---|
${SHATTER.zoneOrder.map((k) => { const z = SHATTER.zones[k];
  return `| ${k} | ${n(z.y0)} – ${n(z.y1)} | ${Math.round(z.share * 100)}% | ±${n(z.r)} m |`;
}).join('\n')}
`;

writeFileSync(join(root, 'docs/BALANCE.md'), md);
console.log('docs/BALANCE.md regenerated from src/balance.js');
