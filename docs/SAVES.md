# Saves

A save is **made, not allocated**.

There used to be exactly three slots, always present, mostly empty — a shape
borrowed from cartridges. What a player actually wants is a list of the runs
they have going: make one when you want one, come back to the one you were on,
delete the ones you are done with.

## Two buttons on the menu, one page behind the second

A menu whose big button always starts from door 1 quietly tells the player
their last run did not count. So:

| what is on the disk | the big button | underneath it |
|---|---|---|
| nothing | **PLAY** — makes a save, starts at door 1 | *(nothing)* |
| any save | **CONTINUE** · *save name* · **DOOR n** | **LOAD GAME** |

"The most recent one" is the save with the latest `at`, which every completed
door touches. A first launch therefore has **one** action and no list, and the
run it starts still gets a save to live in — a run the player cannot come back
to is the thing this whole system exists to prevent.

`LOAD GAME` **opens the page and starts nothing**. CONTINUE already answers
"carry on with the obvious one", so everything else — a *different* save, a new
one, deleting one, looking at what a save actually is — is one screen with the
list on it, reached by one button. `NEW GAME` lives on that page rather than on
the menu, because "start again" belongs next to the runs it is an alternative
to.

There is no separate SAVES link on the menu row any more. Two doors to one
screen is one too many.

Keying the second button on "the most recent save has *depth*" was wrong and
briefly shipped: starting a second run and stopping on door 1 hid it, with a
door-13 save one row down and no way to reach the list. The question is whether
there is a run to go back to, and a run on its first door is still a run.

## The list

Ordered by **last played**, newest first — which is the order you think about
your own saves in. Each row carries the door it resumes at, its doors cleared
and archive count, and the last-played date **labelled as such**: on a list
sorted by recency an unlabelled date reads as "created", which is a different
fact and usually a different day.

`ⓘ` opens **SAVE DETAILS**: name, a unique identifier, when it was created,
when it was last played, where it resumes, doors cleared, filed, best wave, and
which slot of `MAX_SAVES` it occupies. That panel answers *which one is this*,
which the list cannot — two saves at similar depth look identical until you can
see when each was started.

`born` and `id` are stamped once at creation and never touched again. Saves
that predate them backfill: `born` from the last-played stamp (the only
evidence left that the save existed) shown as "*or earlier*", and `id` derived
from the slot and that date so it is stable across reads rather than newly
random every time the panel opens.

> `slotClear` is the low-level wipe and removes identity too, which is right
> when an index is being **recycled** for a different save. `beginNewGame`
> clears the slot it was just handed, so both it and `makeSave` re-stamp —
> without that, a save made seconds earlier reported its creation date as
> unknown.

## The door is the resume point, and it is honest about that

`initHall(from)` starts the run on a door. A leg is procedurally generated and
a fight is live, so the door is the finest grain that can be restored
**truthfully** rather than approximately: you get the corridor that door
composes, at that door's place on every ramp, with the opening loadout.

`slotNoteDoor` moves the resume point **forward only** — a run that ends early
never costs you ground you had already taken. The slot is a record of how deep
you have been, not of how the last attempt went.

Resuming past door 1 never plays the onboarding. Somebody dropping back in at
door 40 has been taught, and replaying the first lesson because a flag happened
to be clear would be the rudest possible welcome back.

> **This had never worked.** `rdoor` was written on every completed door and
> shown on the saves screen, and **nothing read it**. CONTINUE switched the
> active slot and started at door 1, and the comment claiming otherwise had
> been sitting above the code for as long as the code had. `saves.js` §3 is
> the assertion that would have caught it.

## Storage

Keys are unchanged — `ts_s{i}_doors`, `_archive`, `_best`, `_runs`, `_rdoor`,
`_at`, `_timeuses` — so every existing save survived the change untouched.

`ts_saves` is an **index over them**: which indices exist, in what order, under
what name. Anything not in that index is not a save, which is also how deleting
works. `ts_slot` is the active index.

The index is **repaired on every read**: an entry whose slot holds nothing is
dropped, and a slot holding something that nobody indexed is adopted. Neither
can happen through the UI, but a half-finished write or a hand-edited profile
should not cost somebody a run. That same sweep is the migration from the three
fixed slots — any of them that was played is a save now.

The one exception to "empty entries are dropped" is the **active** save: one
made seconds ago has nothing in it yet and must not vanish between being
created and being played.

Ceiling: `MAX_SAVES` (8) — enough for a shared phone, few enough to scan.

## Deleting

The only irreversible thing on the screen, so it asks — and it asks **inside
the row**, naming what is about to go, rather than in a dialogue that has lost
track of which one you tapped. `DELETE` recedes until it is chosen and only
then goes red.

Deleting the active save moves the active index to whatever is left, so the
game is never pointed at a save that does not exist. Deleting the last one
leaves a menu that still works: the button goes back to `PLAY`.

## Where to change it

| what | where |
|---|---|
| the index, making, deleting | `saveIndex` / `makeSave` / `deleteSave` in `src/main.js` |
| what CONTINUE resumes | `latestSave` and `continueSave` |
| what the big button says | `refreshMenuPrimary` |
| the door a run starts on | `initHall(from)` |
| the list, and its confirm-in-row delete | `renderSlots` / `askDelete` |
| the details panel | `openSaveInfo` |
| a save's identity | `stampSave` / `saveIdFor` |
| the whole surface, tested | `saves.js` in the harness |
