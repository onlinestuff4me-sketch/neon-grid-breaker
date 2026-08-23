// Regenerates docs/BALANCE.md from src/balance.js — the values in the doc can
// never drift from the values the game reads, because they are the same
// objects. Run after changing anything in src/balance.js:
//
//   node tools/gen-balance-doc.mjs
//
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  WEAPONS, TYPE_INTRO, TYPE_SHARE, TYPE_DROP, DROPS, RAMP, COMP, LEG, PACING, TIME,
  SHATTER, SCARCITY, CONDITION_TAX, EARLY, VIS, SIMPLE, SPEED, scarcity,
  speedAt, unlockDoor,
} from '../src/balance.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const n = (v) => (v === Infinity ? '∞' : String(Math.round(v * 1000) / 1000));

const diffT = (w) => Math.min((w - 1) / RAMP.rampWaves, 1);
// Speed is no longer on diffT — it is the staircase in SPEED, read by door.
const speed = (w) => speedAt(w);
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

const rampRows = [1, SPEED.openDoors + 1, Math.ceil((RAMP.rampWaves + 1) / 2),
  RAMP.rampWaves + 1, unlockDoor()]
  .map((w) => `| door ${w} | ${n(speed(w))} | ${n(aim(w))}× | ${n(drain(w))}× |`).join('\n');

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

### The opening doors

The first few doors are a metronome, not a fight: the four-beat rhythm — see
him, watch the round leave, step out of it, shatter him — has to be learnable
once before it is asked for twice. See docs/PILLARS.md section 3.

\`\`\`js
${Object.entries(EARLY).map(([k, v]) => `${k.padEnd(17)}: ${v}`).join('\n')}
\`\`\`

### The condition tax

A condition multiplies the same curves a **second** time, so a fog leg at
door 6 pays the door-6 rate *and* the fog rate. A condition that only changes
what you can see is a lighting effect; changing what you can **afford** is
what makes it a condition. Blackout is the only one that taxes time, because
in a blackout the freeze is how you see — light itself costs you seconds.

\`\`\`js
${Object.entries(CONDITION_TAX).map(([k, v]) => `${k.padEnd(9)}: ${JSON.stringify(v)}`).join('\n')}
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
${RAMP.rampWaves + 1}) and drives the telegraph and the slow-mo cost. **Bullet
speed is not on it** — it is the staircase in \`SPEED\`, stepped by door, and
the column below is \`speedAt(door)\`. In Rush Hour the wave number is replaced
by \`1 + rushT / 25\`, so everything ramps on the run clock instead.

| | Bullet speed (m/s) | Telegraph scale | Slow-mo cost |
|---|---|---|---|
${rampRows}

Slow time unlocks on **door ${unlockDoor()}**, where the staircase reaches
${n(SPEED.unlockM)} m/s; it holds there for the ${SPEED.schoolDoors}-door
school and then climbs again to a ceiling of ${n(SPEED.capM)} m/s. Rush Hour
drains the bank at a flat ${n(RAMP.rushDrain)}×. An enemy must be in view for
**${n(RAMP.sightGrace)} s** before its telegraph may begin.

## Visibility, and the FOG condition

| Knob | Value | Meaning |
|---|---|---|
| \`hallNear\` / \`hallFar\` | ${n(VIS.hallNear)} / ${n(VIS.hallFar)} m | the ordinary corridor |
| \`fogNear\` / \`fogFar\` | ${n(VIS.fogNear)} / ${n(VIS.fogFar)} m | a **fog** leg — what its archive line promises |
| \`farMargin\` | ${n(VIS.farMargin)} m | the far plane is never nearer than \`spawnMin + this\` |
| \`tau\` | ${n(VIS.tau)} s | eased on a time constant, so every leg change lands in ~1.3 s |

**BLACKOUT** is about light, not distance. Pulling the far plane to the 8 m the
design note first asked for would put the whole ${n(LEG.spawnMin)}–${n(LEG.spawnMax)} m spawn range
outside sight; edge arrows cannot cover it either, because their 19.5° bearing
threshold sits just inside the ~21° screen half-width, so an enemy dead ahead
gets no arrow and no pixels.

| Knob | Dark | Frozen | Meaning |
|---|---|---|---|
| far plane | ${n(VIS.blackFar)} m | ${n(VIS.blackFrozenFar)} m | **stopping time is the torch** |
| light intensity | ${n(VIS.blackAmbient)}× | ${n(VIS.blackFrozenAmbient)}× | hemisphere, sun and fill together |
| surface colour | ${n(VIS.blackSurface)}× | ${n(VIS.blackFrozenSurface)}× | ceiling and beams are unlit materials, so only colour reaches them |
| fog colour | \`#${VIS.blackFog.toString(16).padStart(6,'0')}\` | — | left pale, the corridor faded into a bright haze that read as light at the end of the tunnel |
| lit strips | every ${n(VIS.blackLitEvery)} cells | — | ${n(VIS.blackLitEvery * LEG.cellM)} m apart, inside the ${n(VIS.blackFar)} m range — at 8 and at 5 the next strip was fogged to nothing |
| strip colour | \`#${VIS.blackLight.toString(16)}\` | — | emergency amber, deliberately not the signal red |

Measured on a real frame: a blackout corridor is **40% of a lit one's mean
luminance**, with the emergency strips the only warm pixels in view.

The safety constraint is \`LEG.spawnMin\` (${n(LEG.spawnMin)} m). Bodies are born
${n(LEG.spawnMin)}–${n(LEG.spawnMax)} m out and the door opens only on an empty floor, so a far
plane below the spawn floor would hide every arrival. The effective floor is
therefore **${n(Math.max(VIS.fogFar, LEG.spawnMin + VIS.farMargin))} m**, derived rather than hand-picked.

It cannot soft-lock structurally, not just empirically: the tunnel substitutes
away every long-range type (sniper, laser, rocketeer, bomber) and no remaining
type holds position at range, so every enemy that can appear in a fog leg
closes distance and enters visibility.

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

## The simplified modes

One movement mechanic, no look axis, no time button — and therefore no bank,
which is why each of the two owns time by a different rule. See
\`docs/MODES.md\` for what each rule is for.

Shared: a straight strip **${SIMPLE.legWide * 2 + 1} cells wide**, a tap
within **${n(SIMPLE.tapMagnetPx)} px** of a body takes the body.

| Knob | Corridor duel | Stand still |
|---|---|---|
| Leg length | ${n(SIMPLE.duel.legCells)} cells (${n(SIMPLE.duel.legCells * LEG.cellM)} m) | ${n(SIMPLE.stop.legCells)} cells (${n(SIMPLE.stop.legCells * LEG.cellM)} m) |
| World speed, idle | ${n(1)} | ${n(SIMPLE.stop.still)} (thumb still) |
| World speed, engaged | ${n(SIMPLE.duel.slow)} (round inbound) | ${n(SIMPLE.stop.full)} (full drag) |
| What moves time | an enemy round in the air | your thumb, and your trigger |
| Inbound window | ${n(SIMPLE.duel.lead)} s out, within ${n(SIMPLE.duel.miss)} m | — |
| Cost of a shot | — | ${n(SIMPLE.stop.shotTime)} s of world time at ${n(SIMPLE.stop.shotRate)}× |
| Ease onto target | ${n(SIMPLE.duel.ease)} /s | ${n(14)} /s (TIME_EASE) |
| March to the open door | ${n(SIMPLE.duel.walkSpeed)} m/s | you walk it yourself |

`;

// THE PROSE ABOVE THE MARKER IS NOT GENERATED, AND MUST SURVIVE.
// docs/BALANCE.md opens with a hand-written account of the opening ramp, the
// speed staircase and the slow-time school — the WHY, which no generator can
// produce — and the generated tables follow it. This script used to write the
// whole file, so running it would have silently deleted two hundred lines of
// reasoning and left a header claiming the file was generated. Keep whatever
// stands above the marker and regenerate only what is below it.
const OUT = join(root, 'docs/BALANCE.md');
const MARK = '<!-- GENERATED FILE';
let prelude = '';
if (existsSync(OUT)) {
  const cur = readFileSync(OUT, 'utf8');
  const at = cur.indexOf(MARK);
  // Only the FIRST occurrence counts, and only if there is prose before it —
  // a file that begins with the marker has no prelude to keep.
  if (at > 0) prelude = cur.slice(0, at).replace(/#\s*TIME SHATTER — balance reference\n*/, '');
}
// THE PROSE IS NOT ALLOWED TO NAME THE WRONG DOOR. The prelude explains the
// unlock in words, which means it states a door number, which means it can go
// stale the moment a speed tread moves — and it did, within an hour of being
// written. Every "door N" in the prelude that sits near the words unlock,
// school or power must be the door `unlockDoor()` actually solves to. This is
// a build failure, not a warning: a document that confidently names the wrong
// door is worse than no document.
if (prelude) {
  const want = unlockDoor();
  const ok = new Set([want, want + SPEED.schoolDoors - 1, want + SPEED.schoolDoors]);
  const bad = [];
  // A CHARACTER WINDOW, NOT A LINE. The first version of this check tested
  // each LINE for the words unlock/school/power and then for a door number,
  // and it sailed straight past the one sentence it existed to catch —
  // "...that happens on. On the shipped numbers that is **door 81**." — because
  // the word "unlock" had wrapped onto the line above. Prose does not respect
  // line boundaries, so neither can the guard.
  for (const m of prelude.matchAll(/\bdoors?\s+\*{0,2}(\d{1,3})\*{0,2}/gi)) {
    const around = prelude.slice(Math.max(0, m.index - 160), m.index + 160);
    if (!/\b(unlock|school|the power)\b/i.test(around)) continue;
    if (around.includes('<!--door-ok-->')) continue;   // an explicit what-if
    if (ok.has(+m[1])) continue;
    const line = prelude.slice(0, m.index).split('\n').length;
    bad.push([+m[1], line, prelude.slice(Math.max(0, m.index - 70), m.index + 70)
      .replace(/\n/g, ' ').trim()]);
  }
  if (bad.length) {
    console.error('\ndocs/BALANCE.md names a door the code does not agree with.');
    console.error(`unlockDoor() solves to ${want}; the school is `
      + `${want}-${want + SPEED.schoolDoors - 1}.\n`);
    for (const [n, line, ctx] of bad) {
      console.error(`  line ~${line}, says door ${n}:  ...${ctx}...`);
    }
    console.error('\nFix the prose, or mark a deliberate what-if with '
      + '<!--door-ok--> nearby, then run this again.');
    process.exit(1);
  }
}
writeFileSync(OUT, prelude ? `# TIME SHATTER — balance reference\n\n${prelude.trim()}\n\n${md.replace(/^# TIME SHATTER — balance reference\n*/, '')}` : md);
console.log(prelude
  ? 'docs/BALANCE.md regenerated (hand-written prelude kept)'
  : 'docs/BALANCE.md regenerated from src/balance.js');
