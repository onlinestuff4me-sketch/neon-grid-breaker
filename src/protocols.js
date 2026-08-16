// ---------------------------------------------------------------------------
// PROTOCOLS — the content system.
//
// A PROTOCOL is the whole configuration of one leg: the FORM it is, the
// CONDITION it is under, and the MEASURES the building runs against you.
// Those three are kinds of ELEMENT, and they all live in one registry, so
// adding content is adding a row.
//
// Values mirror the Protocol Pacing artifact and docs/PROTOCOLS.md.
// `impl: false` means the composer never picks it, so the registry can run
// ahead of the game. It covers two cases: not built yet, and BUILT BUT NOT
// YET APPROVED FOR THE MAIN FLOW — fog and blackout are both built and are
// reachable through Settings > Conditions for playtesting, which is why their
// minDoor is set for where they should eventually land rather than where they
// can currently be seen.
// ---------------------------------------------------------------------------

export const ELEMENTS = [
  // --- forms: what the leg IS ---------------------------------------------
  { id: 'corridor', name: 'CORRIDOR', kind: 'form', tier: 1, minDoor: 1, unlockAt: 0, weight: 10, impl: true,
    archive: 'Standard service corridor. No deviation logged.' },
  { id: 'serviceRun', name: 'SERVICE RUN', kind: 'form', tier: 1, minDoor: 2, unlockAt: 0, weight: 7, impl: true,
    archive: 'Maintenance route. Frequent turns. Sightlines under four metres.' },
  { id: 'vault', name: 'VAULT', kind: 'form', tier: 1, minDoor: 2, unlockAt: 0, weight: 8, impl: true,
    archive: 'Plant hall. One way in, one way out, columns between.' },
  { id: 'atrium', name: 'ATRIUM', kind: 'form', tier: 2, minDoor: 3, unlockAt: 15, weight: 6, impl: true,
    archive: 'Assembly volume. Columns load-bearing. Occupancy unlimited.' },
  { id: 'gauntlet', name: 'GAUNTLET', kind: 'form', tier: 2, minDoor: 4, unlockAt: 40, weight: 5, impl: true,
    archive: 'Transit spine. No recesses. Do not stop walking.' },
  { id: 'gallery', name: 'GALLERY', kind: 'form', tier: 3, minDoor: 6, unlockAt: 80, weight: 4, impl: false,
    archive: 'Observation run. Full length sightline maintained.' },
  { id: 'stairwell', name: 'STAIRWELL', kind: 'form', tier: 3, minDoor: 7, unlockAt: 140, weight: 3, impl: false,
    archive: 'Vertical circulation. Mind the level above you.' },
  { id: 'spiral', name: 'SPIRAL', kind: 'form', tier: 4, minDoor: 10, unlockAt: 200, weight: 2, impl: false,
    archive: 'Containment geometry. There is no straight line out.' },

  // --- conditions: how the leg IS -----------------------------------------
  { id: 'dimStrips', name: 'DIM STRIPS', kind: 'condition', tier: 1, minDoor: 3, unlockAt: 15, weight: 6, impl: true,
    archive: 'Illumination at half. Power is needed elsewhere.' },
  { id: 'fog', name: 'FOG', kind: 'condition', tier: 2, minDoor: 13, unlockAt: 120, weight: 5, impl: false,
    archive: 'Suppressant discharged. Visibility eight metres. Stop the clock and it parts.' },
  { id: 'blackout', name: 'BLACKOUT', kind: 'condition', tier: 3, minDoor: 15, unlockAt: 180, weight: 4, impl: false,
    archive: 'Emergency lighting only. Compliance is not required to see.' },
  { id: 'flood', name: 'FLOOD', kind: 'condition', tier: 4, minDoor: 11, unlockAt: 200, weight: 2, impl: false,
    archive: 'Level breached. Movement impaired. Proceed.' },
  { id: 'deadAir', name: 'DEAD AIR', kind: 'condition', tier: 4, minDoor: 12, unlockAt: 260, weight: 2, impl: false,
    archive: 'Acoustic dampening active. You will not hear them coming.' },

  // --- measures: what the building DOES ------------------------------------
  { id: 'alcoves', name: 'ALCOVES', kind: 'measure', tier: 1, minDoor: 2, unlockAt: 0, weight: 7, impl: true,
    archive: 'Recessed bays. Not designed as cover. Usable as cover.' },
  { id: 'oneWaySeal', name: 'ONE-WAY SEAL', kind: 'measure', tier: 2, minDoor: 4, unlockAt: 40, weight: 5, impl: true,
    archive: 'Section closed behind you. Return is not authorised.' },
  { id: 'breachWalls', name: 'BREACH WALLS', kind: 'measure', tier: 2, minDoor: 5, unlockAt: 40, weight: 5, impl: false,
    archive: 'Panels rated for personnel egress. From either side.' },
  { id: 'grinder', name: 'GRINDER', kind: 'measure', tier: 3, minDoor: 6, unlockAt: 80, weight: 4, impl: false,
    archive: 'Sanitation unit dispatched. Do not remain stationary.' },
  { id: 'turretDrop', name: 'TURRET', kind: 'measure', tier: 3, minDoor: 8, unlockAt: 140, weight: 3, impl: false,
    archive: 'Fixed emplacement lowered. It does not need to reload.' },

  // --- enemies: same schedule, different kind ------------------------------
  { id: 'gunner', name: 'GUNNER', kind: 'enemy', tier: 1, minDoor: 1, unlockAt: 0, weight: 10, impl: true,
    archive: 'Compliant. Armed. The building has many.' },
  { id: 'rusher', name: 'RUSHER', kind: 'enemy', tier: 1, minDoor: 2, unlockAt: 0, weight: 8, impl: true,
    archive: 'Close-quarters directive. Watch the arm come back.' },
  { id: 'shotgunner', name: 'SHOTGUNNER', kind: 'enemy', tier: 2, minDoor: 3, unlockAt: 0, weight: 6, impl: true,
    archive: 'Wide pattern. Effective only near. Get past him.' },
  { id: 'shieldbearer', name: 'SHIELD', kind: 'enemy', tier: 2, minDoor: 4, unlockAt: 15, weight: 5, impl: true,
    archive: 'Plate rated for small arms. The plate only.' },
  { id: 'heavy', name: 'HEAVY', kind: 'enemy', tier: 2, minDoor: 5, unlockAt: 15, weight: 5, impl: true,
    archive: 'Three rounds, in quick succession, every time.' },
  { id: 'sniper', name: 'SNIPER', kind: 'enemy', tier: 3, minDoor: 6, unlockAt: 40, weight: 4, impl: true,
    archive: 'Long authorisation delay. Longer reach.' },
  { id: 'bomber', name: 'BOMBER', kind: 'enemy', tier: 3, minDoor: 7, unlockAt: 40, weight: 4, impl: true,
    archive: 'Area denial. The floor is the weapon.' },
  { id: 'armored', name: 'ARMORED', kind: 'enemy', tier: 3, minDoor: 8, unlockAt: 80, weight: 3, impl: true,
    archive: 'Body plated. The head was not considered a risk.' },
  { id: 'rocketeer', name: 'ROCKETEER', kind: 'enemy', tier: 4, minDoor: 10, unlockAt: 140, weight: 3, impl: true,
    archive: 'Guided munition. It will follow. Break the line.' },
  { id: 'laser', name: 'LASER', kind: 'enemy', tier: 4, minDoor: 12, unlockAt: 200, weight: 2, impl: true,
    archive: 'Sweep emitter. Cover is irrelevant. Kill it.' },

  // --- weapons: ids match the WEAPONS keys, so a pickup files itself --------
  { id: 'knife', name: 'KNIFE', kind: 'weapon', tier: 1, minDoor: 1, unlockAt: 0, weight: 0, impl: true,
    archive: 'Not a service item. What is left when the count reaches zero.' },
  { id: 'pistol', name: 'PISTOL', kind: 'weapon', tier: 1, minDoor: 1, unlockAt: 0, weight: 0, impl: true,
    archive: 'Sidearm. Five rounds. Sufficient, in the right order.' },
  { id: 'shotgun', name: 'SHOTGUN', kind: 'weapon', tier: 1, minDoor: 3, unlockAt: 0, weight: 0, impl: true,
    archive: 'Six pellets on one authorisation. Distance is the price.' },
  { id: 'burst', name: 'BURST RIFLE', kind: 'weapon', tier: 2, minDoor: 5, unlockAt: 15, weight: 0, impl: true,
    archive: 'Three rounds per pull. The building prefers certainty.' },
  { id: 'sniper', name: 'RAIL', kind: 'weapon', tier: 3, minDoor: 6, unlockAt: 40, weight: 0, impl: true,
    archive: 'Rated to pass through three. It usually finds them.' },
  { id: 'launcher', name: 'LAUNCHER', kind: 'weapon', tier: 3, minDoor: 7, unlockAt: 40, weight: 0, impl: true,
    archive: 'Arcing charge. Mind what is between you and the arc.' },
  { id: 'rocket', name: 'ROCKET', kind: 'weapon', tier: 4, minDoor: 10, unlockAt: 140, weight: 0, impl: true,
    archive: 'Direct munition. Not intended for corridors. Used in them anyway.' },
];

// Every entry carries a stable designation, because a LOCKED entry has to
// show something: the archive hides the name, never the fact that a slot
// exists. Derived from registry order so adding a row needs no bookkeeping.
const KIND_TAG = { form: 'F', condition: 'C', measure: 'M', enemy: 'E', weapon: 'W' };
{
  const seq = {};
  for (const e of ELEMENTS) {
    seq[e.kind] = (seq[e.kind] || 0) + 1;
    e.designation = `${KIND_TAG[e.kind] || 'X'}-${String(seq[e.kind]).padStart(2, '0')}`;
  }
}

// Pairs that break each other mechanically. Slots handle the rest.
export const CONFLICTS = [
  ['grinder', 'oneWaySeal'],    // both own the leg's back wall
  ['grinder', 'flood'],         // the grinder outruns a slowed player
  ['blackout', 'gallery'],      // a gallery is FOR sightlines
  ['deadAir', 'breachWalls'],   // the breach is telegraphed by sound
  ['turretDrop', 'atrium'],     // 360 degrees of open room, no counterplay
];

export const COMP = {
  budgetBase: 1, budgetPerDoors: 3, budgetCap: 5,
  maxConditions: 1, maxMeasures: 2,
  formRepeatGap: 3, otherRepeatGap: 4,
};

export const PACE = {
  debutsPerLeg: 1,      // unfamiliar things introduced at once
  debutCooldown: 2,     // doors of silence after a debut
  firstDebutDoor: 2,    // door 1 is the control
  debutLegTierCap: 1,   // a debut leg stays legible
  enemyDebutGap: 2,
};

const byId = new Map(ELEMENTS.map((e) => [e.id, e]));
export const element = (id) => byId.get(id);
const conflicts = (a, b) =>
  CONFLICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/**
 * Compose one leg's protocol.
 *
 * @param door           1-based door number within this run
 * @param lifetimeDoors  doors cleared across every run, ever
 * @param mem            { seen:Set, lastUsed:{}, lastDebutDoor, lastEnemyDebut }
 *                       — carried for the whole run, mutated here
 * @param rand           () => [0,1)
 * @returns { door, budget, form, condition, measures[], enemyDebut, debuts[] }
 */
export function composeProtocol(door, lifetimeDoors, mem, rand = Math.random) {
  const budget = Math.min(
    COMP.budgetBase + Math.floor(door / COMP.budgetPerDoors), COMP.budgetCap);
  let left = budget;
  const chosen = [];
  const debuts = [];
  const canDebut = door >= PACE.firstDebutDoor &&
    door - mem.lastDebutDoor > PACE.debutCooldown;

  const eligible = (e) =>
    e.impl && door >= e.minDoor && lifetimeDoors >= e.unlockAt;

  const pick = (kind, slots) => {
    for (let s = 0; s < slots; s++) {
      const strict = ELEMENTS.filter((e) => {
        if (e.kind !== kind || !eligible(e) || e.tier > left) return false;
        if (chosen.some((c) => c.id === e.id || conflicts(c.id, e.id))) return false;
        const gap = kind === 'form' ? COMP.formRepeatGap : COMP.otherRepeatGap;
        if (mem.lastUsed[e.id] !== undefined && door - mem.lastUsed[e.id] <= gap) return false;
        const isNew = !mem.seen.has(e.id);
        if (isNew && (!canDebut || debuts.length >= PACE.debutsPerLeg)) return false;
        // a debut leg stays readable: nothing heavy alongside the new thing
        if (!isNew && debuts.length > 0 && e.tier > PACE.debutLegTierCap) return false;
        return true;
      });
      // the no-repeat window can empty the pool; relax it rather than
      // collapsing to the same default leg after leg
      const pool = strict.length ? strict : ELEMENTS.filter((e) =>
        e.kind === kind && eligible(e) && e.tier <= left && mem.seen.has(e.id) &&
        !chosen.some((c) => c.id === e.id || conflicts(c.id, e.id)));
      if (!pool.length) return;
      const total = pool.reduce((a, e) => a + e.weight, 0);
      let r = rand() * total, hit = pool[0];
      for (const e of pool) { r -= e.weight; if (r <= 0) { hit = e; break; } }
      if (!mem.seen.has(hit.id)) { debuts.push(hit); mem.lastDebutDoor = door; }
      mem.seen.add(hit.id);
      mem.lastUsed[hit.id] = door;
      left -= hit.tier;
      chosen.push(hit);
      if (kind === 'form') return;   // exactly one form per leg
    }
  };

  pick('form', 1);
  if (!chosen.length) {   // nothing eligible at all: the plain corridor
    const c = element('corridor');
    mem.seen.add(c.id); mem.lastUsed[c.id] = door;
    chosen.push(c); left -= c.tier;
  }
  pick('condition', COMP.maxConditions);
  pick('measure', COMP.maxMeasures);

  // Enemy debuts run on their own clock and never share a leg with a
  // protocol debut — one unfamiliar thing at a time is the whole rule.
  let enemyDebut = null;
  if (debuts.length === 0 && canDebut &&
      door - mem.lastEnemyDebut > PACE.enemyDebutGap) {
    const pool = ELEMENTS.filter((e) => e.kind === 'enemy' && eligible(e) && !mem.seen.has(e.id));
    if (pool.length) {
      const total = pool.reduce((a, e) => a + e.weight, 0);
      let r = rand() * total, hit = pool[0];
      for (const e of pool) { r -= e.weight; if (r <= 0) { hit = e; break; } }
      enemyDebut = hit;
      mem.seen.add(hit.id);
      mem.lastEnemyDebut = door;
      mem.lastDebutDoor = door;
      debuts.push(hit);
    }
  }

  return {
    door, budget, spent: budget - left,
    form: chosen.find((c) => c.kind === 'form'),
    condition: chosen.find((c) => c.kind === 'condition') || null,
    measures: chosen.filter((c) => c.kind === 'measure'),
    enemyDebut, debuts,
  };
}

/** Fresh per-run memory. `known` is the player's archive, so anything they
 *  have already met is not treated as a debut again. */
export function newRunMemory(known) {
  return {
    seen: new Set(known || []),
    lastUsed: {},
    lastDebutDoor: -99,
    lastEnemyDebut: -99,
  };
}

/** Every enemy this player may meet at their experience, for wave building. */
export function enemyRoster(door, lifetimeDoors) {
  return ELEMENTS.filter((e) =>
    e.kind === 'enemy' && e.impl && door >= e.minDoor && lifetimeDoors >= e.unlockAt)
    .map((e) => e.id);
}
