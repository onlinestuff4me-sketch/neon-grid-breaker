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
  WEAPONS, TYPE_INTRO, TYPE_SHARE, TYPE_DROP, DROPS, RAMP, COMP, PACING, TIME,
} from '../src/balance.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const n = (v) => (v === Infinity ? '∞' : String(Math.round(v * 1000) / 1000));

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
- **Tunnel legs**: ${COMP.hallDoor1} at door 1, ${COMP.hallDoor2} at door 2,
  then \`min(${COMP.hallBase} + ${COMP.hallPerDoor}n, ${COMP.hallCap})\`

## Spawn pacing

| Knob | Tunnel | City / Rush |
|---|---|---|
| Alive at once | \`min(${PACING.hallAliveBase} + ⌊wave/2⌋, ${PACING.hallAliveCap})\` | \`min(${PACING.cityAliveBase} + ⌊wave/2⌋, ${PACING.cityAliveCap})\` |
| Gap when empty | ${n(PACING.hallEmptyGap)} s | — |
| Gap when busy | \`${n(PACING.hallFullGap)} + ${n(PACING.hallFillGap)}·fill\` | \`${n(PACING.cityBaseGap)} + ${n(PACING.cityFillGap)}·fill\` |
| Gap after a kill | pulled to ${n(PACING.killPullMin)}–${n(PACING.killPullMin + PACING.killPullRange)} s | same |

All gaps are multiplied by a 0.85–1.15 jitter. Spawns are suppressed while a
message card is on screen, and in the tunnel they are hard-gated to at least
**${n(PACING.aheadMin)} m ahead** of the player. The last **${PACING.finale}**
of a leg stage on the door approach so the door opens in view.

## Time control

| Knob | Value | Meaning |
|---|---|---|
| \`base\` | ${n(TIME.base)} s | bank at wave start, and the floor each wave |
| \`bonus\` | ${n(TIME.bonus)} s | refunded per kill |
| \`cap\` | ${n(TIME.cap)} s | bank ceiling |
| \`drain\` | ${n(TIME.drain)} | seconds spent per second frozen, before ramp scaling |
| \`slowScale\` | ${n(TIME.slowScale)} | world speed while standing still |
| \`moveScale\` | ${n(TIME.moveScale)} | world speed at full stick |
`;

writeFileSync(join(root, 'docs/BALANCE.md'), md);
console.log('docs/BALANCE.md regenerated from src/balance.js');
