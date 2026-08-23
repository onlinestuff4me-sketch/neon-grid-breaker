# Saves

A save is **made, not allocated**.

There used to be exactly three slots, always present, mostly empty — a shape
borrowed from cartridges. What a player actually wants is a list of the runs
they have going: make one when you want one, come back to the one you were on,
delete the ones you are done with.

## Every game has its own saves

A save belongs to **one mode**. The tunnel's runs are not in the city's list,
`CONTINUE` in the city never offers a tunnel run, and starting a city game does
not disturb the tunnel save you were on. `MAX_SAVES` is per mode.

The menu is therefore a **page about one game at a time**. `CHOOSE A GAME`
selects which:

| what selecting a game changes |
|---|
| the line under the title (the mode's own one-liner) |
| what the big button says and starts |
| whether `LOAD GAME` is offered at all |
| the list behind `LOAD GAME`, and its title |
| the leaderboard |
| the world rendered behind the menu — city for City Streets and Rush Hour, corridor for the other three |

The choice is remembered in `ts_menumode`: somebody who plays the city does not
want to re-pick it every launch. It is validated against the registry on read,
so a mode that stops existing falls back to the tunnel rather than showing a
menu for a game that is gone.

> The row used to **launch** a mode on tap. That was fine while it was a
> shortcut and wrong the moment it decides what the page is about: City
> Streets — the only mode filing runs at the time — could only be reached by a
> button that skipped straight past its own saves, so it could not be
> continued at all. For the same reason the row now includes **the main game**,
> which it used to leave out; without it there was no way back to the tunnel
> once you had selected something else.
>
> It also **wraps**. Five games at their full names are ~760 px of chips, and a
> centred non-wrapping flex row that wide in a 402 px viewport puts the first
> and last games off *both* edges of the screen with nothing to scroll —
> `THE TUNNEL` among them.

## Two buttons on the menu, one page behind the second

A menu whose big button always starts from door 1 quietly tells the player
their last run did not count. So, **for the selected game**:

| what is on the disk for this game | the big button | underneath it |
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

A save's default name is **the game's**, numbered within that game: the
tunnel's third run is `THE TUNNEL 3` whatever global slot index it happens to
occupy. A name never has to be read alongside a mode to mean anything.

The number is the **save's own** (`num` in the index, the lowest free one in
its mode at creation), not its position in the list. Numbering by position
renamed everybody below a deletion — delete `THE TUNNEL 1` and the save the
player knew as `THE TUNNEL 2` silently became `THE TUNNEL 1`, which is then
the name on the CONTINUE button and in the delete confirmation.

Each row also describes itself **in its own game's words**: the tunnel by the
door it resumes at and the doors it has cleared, everything else by its best
run. Every save used to read `DOOR 1 · 0 doors`, which made two City Streets
saves indistinguishable.

`ⓘ` opens **SAVE DETAILS**: name, a unique identifier, when it was created,
when it was last played, where it resumes, doors cleared, filed, best wave,
which game it belongs to, and which slot it occupies. That panel answers
*which one is this*, which the list cannot — two saves at similar depth look
identical until you can see when each was started.

### The name is yours; everything under it is the file's

`NAME` is the one editable field on that panel. It is committed **on the way
out**, so there is no SAVE button to forget and no half-typed name lost to a
stray tap.

Clearing it is not "no name" — it restores the **default**, which is what the
placeholder has been promising. Storing the default *as* a name would freeze
it: rename `THE TUNNEL 2` to "THE TUNNEL 2" and deleting `THE TUNNEL 1` would
leave a "THE TUNNEL 2" sitting at position one.

A typed name is **text, not markup**, everywhere it is rendered. Unescaped, a
name of `<div style="display:none">` hid the rest of its own row — including
`DELETE`, so the save could not be got rid of — and the same string in the
primary button destroyed the menu.

A string shaped like a default (`THE TUNNEL 4`) is not stored as a name at
all. Storing one freezes it, and typing a *sibling's* default gives two rows
that read identically, delete confirmation included.

Everything else on the panel is the file's own account of itself and **cannot
be typed**. `CREATED` and `LAST PLAYED` are part of the save, not decorations
on it — a save whose dates could be edited is a record of nothing. Renaming
moves neither, nor the identifier.

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

## The board is the game's too

Runs are filed **per slot**, and a slot belongs to one game, so `TOP RUNS`
under the menu is already the selected game's board. `recordRun` used to return
early unless the mode was `wave` — fine when the city was the only place a run
meant anything, and the reason **the main game's board was permanently empty**.
Every mode files its runs now.

Each mode declares what one step of progress is **called** — `unit` in
`src/modes.js`: `DOOR` for the tunnel, `WAVE` for City Streets, `ROUND` for the
two simplified modes. A board over tunnel runs that ranks people by "WAVES" is
describing a different game.

`unit: null` (Rush Hour) means the count does not move in that mode, so the
metric is dropped from the pills rather than ranking every run equal-first, and
a metric remembered from another game falls back to `ENEMIES`.

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

> **A save the player made exists.** "Used" was `at > 0 || doors > 0`, and `at`
> is written only by `saveProgress()` (which needs something new archived) and
> `slotNoteDoor()` (tunnel only). A **Rush Hour** save — a game that archives
> nothing and crosses no doors — was therefore never *used*, survived only
> while it happened to be the active slot, and was **deleted** the moment the
> player selected another game. `born` is stamped at creation and removed by
> `slotClear`, which is exactly the fact wanted, so it counts too; and
> `recordRun` stamps `at`, because a run was played there.

In the app the whole save system is **mirrored to durable storage**
(`src/native.js`): `ts_saves`, `ts_slot`, `ts_menumode` and every `ts_s{i}_*`
key. WKWebView's localStorage can be evicted by iOS under disk pressure, and
the mirror list was a fixed set of legacy `timeshard_*` names — so the runs
themselves were the one thing left in the evictable store. Slot keys are
matched by shape rather than named, since there are up to `MAX_SLOTS` of them,
and `hydrateStorage` asks Preferences which ones exist.

Deleting goes through `forget`, which reaches **both** stores. A mirrored key
removed from localStorage alone comes back on the next launch, when hydration
finds it in Preferences — a deleted save resurrecting itself.

Ceiling: `MAX_SAVES` (6) **per mode**, drawn from a pool of `MAX_SLOTS` (40)
global indices — enough for a shared phone, few enough to scan.

`ts_saves` entries carry `{ i, name, mode }`. An entry written before modes had
saves has no `mode` and is repaired to `hall` on read, because the tunnel is
the only mode there was then. Nothing on disk had to move for per-mode saves:
the `ts_s{i}_*` keys are untouched and the change is entirely in the index.

## Deleting

The only irreversible thing on the screen, so it asks — and it asks **inside
the row**, naming what is about to go, rather than in a dialogue that has lost
track of which one you tapped. `DELETE` recedes until it is chosen and only
then goes red.

Deleting the active save moves the active index to whatever is left **of the
same game first**, because that is the list the player is looking at, so the
game is never pointed at a save that does not exist. Deleting the last one
leaves a menu that still works: the button goes back to `PLAY`.

## One way in, and it is the menu

`SETTINGS → MODES` is a **catalogue**, and tapping a row selects that game and
closes the card — the same thing the menu's own row does. It used to start a
run, setting `game.mode` and nothing else: no `menuMode`, no active save, no
`makeSave`. The run then wrote its doors, its best and its runs into whatever
slot happened to be active, so a city game filed itself into a tunnel save; and
on a fresh profile the orphan sweep later adopted that slot as a **tunnel**
save whatever mode had actually been played.

The death screen shows neither `LOAD GAME` nor the selector. Both used to sit
under `RETRY`, and `LOAD GAME` did nothing when tapped — its handler requires
the menu.

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
| renaming, and what a blank name means | `commitSaveName` / `closeSaveInfo` |
| which game the menu is showing | `menuMode` / `selectMenuMode` |
| the game selector row | `renderAltRow`, `#altrow` in `index.html` |
| the world behind the menu | `menuBackdrop` / `menuIsCity` |
| the default name of a save | `saveName` |
| what a run is worth, and what it is called | `recordRun` / `scoreUnit` / `unit` in `src/modes.js` |
| the whole surface, tested | `saves.js` in the harness |
