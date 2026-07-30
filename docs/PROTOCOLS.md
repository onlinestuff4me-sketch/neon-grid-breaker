# Protocols — the content system

Design spec. Not built yet; this is the thing to build against.

---

## 1. The name

Yes — "leg archetypes" meant the *shape* of a stretch of tunnel. But shapes
and events shouldn't be two systems, because they answer the same question:
**what is the building doing to you on this floor?**

So one term covers both: a **PROTOCOL**.

The fiction earns it. The city runs on schedule; the building is part of the
system; when you refuse to comply it *reconfigures itself* to contain you. A
long open gallery is a protocol. Killing the lights is a protocol. Sending a
grinder down the corridor behind you is a protocol. They are all the same
kind of thing — something the building does to contain you — which is why
they belong in one registry, one deck, and one archive.

It also gives every entry a voice: the archive lists them by the building's
own designation.

> **P-07 · BLACKOUT** — *Emergency lighting only. Illumination reduced to
> eight metres. Compliance is not required to see.*

**Three flavours, one type.** An earlier draft had two — "form" and
"measure, a rule laid over it" — which broke the moment the grinder went in:
a machine advancing down the corridor is not a *rule*, it is a thing with a
timeline. One bucket was hiding three kinds of content. The split that
actually holds answers three different questions:

| Flavour | Question | True for | Examples |
|---|---|---|---|
| **Form** | what the leg *is* | the whole leg, structural | corridor, gauntlet, atrium, gallery, stairwell |
| **Condition** | how the leg *is* | the whole leg, no timing | blackout, flood, fog, dead air (no audio tells) |
| **Measure** | what the building *does* | a moment or a timeline | grinder, breach walls, one-way seal, turret drop |

The distinction is operational, not poetic: **a condition needs no
scheduling — it is simply true from the moment you enter. A measure needs a
trigger and a clock.** That is exactly the line the composer needs to draw,
which is how you know it is the right one.

Slots per leg: **one form, at most one condition, one or two measures.**
Categories do most of the conflict-prevention for free — you can't roll
blackout *and* flood, because there is only one condition slot.

*(Alternatives considered: MEASURES — good fiction, weaker as a noun for a
room shape. MODULES — accurate, lifeless. DIRECTIVES — implies orders to
someone else. PROTOCOL wins because it reads as both architecture and
aggression.)*

---

## 2. The registry

One flat list. Adding content = adding a row. Nothing else changes.

```js
{
  id: 'grinder',
  name: 'GRINDER',
  flavour: 'measure',        // 'form' | 'condition' | 'measure'
  tier: 3,                   // 1 cheap ... 4 punishing — drives cost & order
  minDoor: 4,                // never before this door, even for a veteran
  unlockAt: 60,              // lifetime doors cleared before it is eligible
  tags: ['pressure'],        // for conflicts
  conflicts: ['flood'],      // never in the same leg
  archive: 'Sanitation unit dispatched. Do not remain stationary.',
}
```

**Tier is the only difficulty dial.** It sets cost, gates how early a
protocol can appear in a run, and orders the whole archive.

### Starting deck

| Tier | Forms | Conditions | Measures |
|---|---|---|---|
| 1 | corridor (default), service run | dim strips | side alcoves |
| 2 | atrium, gauntlet | fog | one-way seal, breach walls |
| 3 | gallery, stairwell | blackout | grinder, turret drop |
| 4 | the spiral, the shaft | flood, dead air | grinder + blackout pairing |

Ten to twelve entries is enough to start; the system does not care how
many there eventually are.

---

## 3. Composing one leg

Each leg gets a **complexity budget** that grows with depth:

```
budget(door) = min(1 + floor(door / 3), 5)
```

- Door 1–2 → 1 · Door 3–5 → 2 · Door 6–8 → 3 · Door 9–11 → 4 · Door 12+ → 5

Spend it in slot order: **form** (cost = its tier), then **condition** if
anything is left, then **measures** while budget remains. A tier-3 form on
door 6 leaves nothing else; a tier-1 form leaves room for a condition and a
measure. That single rule produces the whole texture — some legs are strange
rooms, some are plain corridors under a nasty condition, some are ordinary
rooms the building actively attacks, deep legs are all three.

Constraints while picking:
- `tier <= budget` and `door >= minDoor` and `lifetimeDoors >= unlockAt`
- one form, ≤1 condition, ≤2 measures — the slots are the first guard
- `conflicts` handles the rest (grinder vs one-way seal: both own the leg's
  back wall, so they can never share a leg)
- no form repeated within 3 legs; no condition or measure within 4
- weighted random among what survives — **this is the run-to-run variety**

---

## 4. Pacing *within* a run

The rule that matters: **never introduce two unfamiliar things at once.**

- **One debut per leg, maximum.** A leg introducing a new protocol *or* a
  new enemy type may not introduce the other.
- **Debut legs run light.** After a debut, the rest of the budget may only
  be spent on tier-1 protocols. You meet the grinder in a plain corridor,
  not in a blackout gallery.
- **Two doors of silence** after any debut before the next one.
- **Nothing new before door 2.** Door 1 is always the plain corridor: it is
  the control against which every later change reads as change.

That yields roughly **one new thing every three doors** in a fresh run —
and because the budget is small early, a deep run still feels like it is
escalating rather than dumping.

---

## 5. Pacing *across* runs — and fixing the enemy problem

You're right that the current schedule burns the whole cast in 8–10 short
segments. The fix is that **depth alone shouldn't unlock anything**;
eligibility needs two keys:

```
eligible = (door >= minDoor) && (lifetimeDoors >= unlockAt)
```

`lifetimeDoors` is every door you have ever passed, across all runs, saved
locally. `minDoor` keeps a thing from appearing too early *within* a run;
`unlockAt` keeps the archive from emptying itself in your first good run.

Suggested `unlockAt` spread (doors cleared, lifetime):

| Cohort | unlockAt | Roughly |
|---|---|---|
| starting cast (gunner, rusher, shotgunner; corridor, service run) | 0 | run 1 |
| second wave (shieldbearer, heavy; atrium, alcoves) | 15 | runs 2–4 |
| third (sniper, bomber; gauntlet, breach walls, one-way door) | 40 | runs 5–9 |
| fourth (armored, rocketeer; gallery, blackout, grinder) | 80 | runs 10–18 |
| deep cast (laser; stairwell, flood, spiral) | 140 | runs 19–30 |

With a good run reaching ~8 doors, that is **25–30 runs to fill the
archive** — and every one of those runs is still winnable with what you
already know, because nothing gated is *required*.

A veteran's run is not easier; it is **more varied**. That is the whole
trick: the archive buys you strangeness, never strength.

---

## 6. The grinder (your idea, specified)

**P-?? · GRINDER**, tier 3, *measure* — it has a clock, so it is not a
condition. A slab of the building's machinery
seals the leg behind you and advances at a steady walk — slower than you,
faster than fighting carefully allows. It kills on contact, grinds shards
of anything it catches, and it does **not** stop while time is frozen
(it is the building, not a person) — so freezing time no longer buys you
safety, only aim. It ends at the door.

That last clause is the reason it is worth building: it is the first
protocol that attacks the slow-mo mechanic itself, which is exactly the
kind of thing tier 3 and 4 should be doing.

---

## 7. What the archive shows

One grid, three sections: **enemies**, **weapons**, **protocols**. Locked
entries are silhouettes with the designation visible and the name hidden —
`P-07 · ████████` — so you can see how much is left.

Unlocking is *meeting*, not defeating. The entry fills in with the name,
its tell, and the building's line about it. Each entry also records the
**deepest door you have seen it at**, which quietly becomes a personal map
of where the run breaks down.

---

## 8. Build order

1. **Registry + budget composer** — replaces the current leg generator;
   ship with the existing forms only, so nothing visibly changes but the
   plumbing is in.
2. **`lifetimeDoors` + eligibility** — and re-gate the enemy cast through
   the same two keys, which fixes the burn-through immediately.
3. **Archive screen** — reads the registry; empty slots appear the moment
   the registry has entries.
4. **New protocols**, cheapest first: blackout, one-way door, breach walls,
   then grinder.
5. **Fragments** on personal-record doors, once there is a place to read
   them.
