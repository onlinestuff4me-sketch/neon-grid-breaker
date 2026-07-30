# The Tunnel — variety and meta

Working design notes. Nothing here is built yet except where marked; this
is the menu we pick from.

The brief: **a reason to go deep that isn't points and isn't power.** A
roguelike's repeatability dies the moment runs stop starting equal, so the
meta has to reward *going far* without making the next run easier. The
answer is that the thing you accumulate is **knowledge and access, not
strength** — you unlock what the game will *show* you, not what you bring.

---

## 1. Variety inside a run

Things that make hallway N feel unlike hallway N−1.

**Built already:** chambers that widen mid-leg, pillars for cover, ceiling
light strips, pilaster ribs, forward-only branches, a straight door
approach where the last enemies stage.

**Next, roughly in value order:**

- **Leg archetypes.** Instead of one generator with noise, give each leg a
  named shape drawn from a deck: *the gauntlet* (long, narrow, no cover),
  *the atrium* (one big room, pillars, enemies on all sides), *the
  service run* (tight zig-zag, constant corners), *the gallery* (long
  sightlines, snipers), *the flooded floor* (slow movement, no sprinting
  away). The deck is what makes runs feel authored rather than generated.
- **The lights go out.** One leg per run runs on emergency lighting: strips
  dark, red wash, visibility to ~8 m. Enemies are audible before visible.
  Freezing time becomes a torch as much as a shield.
- **Breach walls.** Marked wall panels that enemies come *through*
  mid-leg — the shatter language we already have, applied to architecture.
  Turns a cleared corridor back into a live one.
- **Glass partitions.** See the next room before you're in it, shoot
  through it, and it shatters into the same debris. Sightline and cover
  become the same object.
- **Elevation.** Short stair runs and mezzanines: enemies above you change
  the pitch band the camera actually needs.
- **One-way doors mid-leg.** A door that seals behind you *inside* a leg,
  committing you to the second half. Cheap to build, real tension.
- **The window.** A leg with one wall of glass looking out on the white
  city — the tunnel is inside one of those towers. Ties the modes into one
  world for the cost of a texture and a hole in a wall.

## 2. Meta that isn't power

Rules for anything here: **it never changes your starting loadout, your
health, or enemy difficulty.** It changes what you *know*, what you can
*see*, and what the game is *allowed to show you*.

### 2a. The archive (discovery as the spine)

Every enemy type, weapon, and leg archetype you meet gets recorded on a
persistent **ARCHIVE** screen — a grid of silhouettes, most of them blank.
Meeting one for the first time fills it in with its name, its tell, and
one line of world-fiction. This is the primary meta.

- It is pure *discovery*: you can't grind it, and it gives no advantage.
- It answers "why go deeper" honestly — deeper is the only place the
  unmet ones live (laser at door 12, rocketeer at 11).
- It costs almost nothing to build: we already track `game.seenTypes`.
- The blank slots are the hook. A half-filled grid is a to-do list.

### 2b. Depth records per archetype

Not "high score" — a **furthest door reached** per leg archetype, so the
grid doubles as a map of where you fall apart. "You have never got past
the gallery" is a more interesting fact about a player than a number.

### 2c. Fragments (the story, doled out)

Each new *deepest* door reached — a personal record, not every run —
releases one fragment of text: an intercepted memo, a maintenance log, a
line of dialogue from whoever is sending these people at you. Twenty or so
fragments across the whole depth range, assembling the answer to *what
this building is and why the crowd complies.* Missable only in the sense
that you have to go deeper to keep reading.

### 2d. Keys and sealed doors

Occasionally a leg has a **second, sealed door** — different colour, never
required. Opening it costs something real *in that run*: it only opens
while time is frozen, and it drains the whole bank. Behind it: a fragment,
an archive entry for something that appears nowhere else, or a weapon you
have not seen. This is the "secret" instinct done without power creep —
the reward is content, the cost is your safety net for that fight.

### 2e. Modifiers you choose, not earn

Once the archive is meaningfully full, unlock **run modifiers** as
*options*, never as upgrades: knife-only, no slow-mo, doors on a timer,
double crowd. They make runs harder or stranger, not easier, and they give
veterans a reason to keep starting over. Each has its own depth record.

### What I would deliberately not build

- Persistent stat upgrades, currency, or a shop — they break the flat start.
- Unlockable starting weapons — same reason; weapons should be found.
- Daily challenges before the core loop is settled — dilutes attention.

---

## 3. Suggested build order

1. **The archive** — cheapest, and it is the spine everything else hangs on.
2. **Leg archetypes** — the single biggest change to how a run *feels*.
3. **Fragments** on personal-record doors — gives depth a narrative payoff.
4. **Sealed doors** — once there is content worth hiding behind them.
5. **Lights-out legs / breach walls** — set-piece variety.
6. **Modifiers** — last; they need a full archive to mean anything.
